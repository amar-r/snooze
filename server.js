const express = require('express');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { version } = require('./package.json');
const M = require('./public/metrics.js');

const app = express();
const PORT = process.env.PORT || 8430;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'nights.json');

// Refuse to keep growing the data file without bound. One night a day means
// this is a century of sleep — it's here so a stuck client or a loop on the
// network can't fill the disk.
const MAX_NIGHTS = Number(process.env.MAX_NIGHTS || 50000);

// Ensure data dir/file exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');

// Never fall back to an empty list here. Returning [] on a parse failure and
// then letting a later write persist it is a silent, unrecoverable wipe of
// every night. Throwing instead leaves the bad file untouched on disk, so it
// stays recoverable by hand.
function readNights() {
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw || '[]');
  } catch (e) {
    throw new Error(
      `${DATA_FILE} is not valid JSON (${e.message}). Refusing to read or ` +
      `overwrite it so your nights stay recoverable — repair or move the file, ` +
      `then restart.`
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${DATA_FILE} does not contain a JSON array. Refusing to overwrite it.`);
  }
  return parsed;
}

function writeNights(nights) {
  // atomic-ish write: write to temp file then rename
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(nights, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

// Any read failure means we must not write: reply 500 and leave the file be.
function dataError(res, e) {
  console.error(e.message);
  res.status(500).json({ error: e.message });
}

// Ids arrive from the URL as strings, so always compare stringified.
const sameId = (a, b) => String(a) === String(b);

// ---------------------------------------------------------------------------
// Validation
//
// A bad night is worse here than a missing one: the strip is all averages and
// medians, so one 40-hour night or one negative duration silently distorts what
// the page says about every other night rather than showing up as an obvious
// hole. So the shape is checked on the way in, and anything that can't be true
// is refused rather than stored and worked around later.
// ---------------------------------------------------------------------------

class ValidationError extends Error {}

const MAX_INTERRUPTIONS = 50;
const MAX_NOTES = 2000;
const MAX_REASON = 200;

function isBlank(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

function requireTime(value, label) {
  const d = M.parseLocal(value);
  if (!d) throw new ValidationError(`${label} must be a date and time like 2026-08-14T23:10`);
  return d;
}

function optionalTime(value, label) {
  if (isBlank(value)) return null;
  return requireTime(value, label);
}

function normalizeInterruptions(raw, bedFrom, bedTo) {
  if (isBlank(raw)) return [];
  if (!Array.isArray(raw)) throw new ValidationError('interruptions must be a list');
  if (raw.length > MAX_INTERRUPTIONS) {
    throw new ValidationError(`No more than ${MAX_INTERRUPTIONS} interruptions per night`);
  }

  const out = raw.map((item, i) => {
    const label = `Interruption ${i + 1}`;
    if (!item || typeof item !== 'object') throw new ValidationError(`${label} is not an object`);

    const at = requireTime(item.at, `${label} time`);
    // An interruption outside the night it belongs to is a resolution bug or a
    // typo'd date, and it would count awake minutes against a night you weren't
    // in bed for. Reject rather than clamp: clamping hides which end was wrong.
    if (at < bedFrom || at > bedTo) {
      throw new ValidationError(`${label} at ${item.at} falls outside the night (in bed to out of bed)`);
    }

    let minutes = 0;
    if (!isBlank(item.minutes)) {
      minutes = Number(item.minutes);
      if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) {
        throw new ValidationError(`${label} length must be between 0 and 1440 minutes`);
      }
      minutes = Math.round(minutes);
    }

    const reason = isBlank(item.reason) ? '' : String(item.reason).trim().slice(0, MAX_REASON);
    return { at: M.toLocalString(at), minutes, reason };
  });

  // Stored in the order they happened, whatever order they were typed in, so
  // the list and the CSV read like the night did.
  out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return out;
}

// Build the stored record field by field rather than spreading the request
// body: the file stays exactly the shape this app knows how to read, and a
// client can't park arbitrary keys (or its own `id`) in it.
function normalizeNight(body) {
  if (!body || typeof body !== 'object') throw new ValidationError('Expected a night object');

  const date = String(body.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !M.parseLocal(`${date}T00:00`)) {
    throw new ValidationError('date must be a real calendar date like 2026-08-15 (the morning you woke up)');
  }

  const bedAt = requireTime(body.bedAt, 'Time in bed');
  const wakeAt = requireTime(body.wakeAt, 'Wake time');
  const sleepAt = optionalTime(body.sleepAt, 'Time fell asleep');
  const upAt = optionalTime(body.upAt, 'Time out of bed');

  if (wakeAt <= bedAt) {
    throw new ValidationError('Wake time must be after the time you got in bed');
  }
  if (sleepAt && (sleepAt < bedAt || sleepAt > wakeAt)) {
    throw new ValidationError('Time you fell asleep must be between getting in bed and waking');
  }
  if (upAt && upAt < wakeAt) {
    throw new ValidationError('Time out of bed cannot be before you woke');
  }

  const bedTo = upAt || wakeAt;
  const hours = (bedTo - bedAt) / (60 * 60 * 1000);
  // 24h is not a night, it's a mistyped date — and left in, it would outweigh a
  // fortnight of real ones in every average on the page.
  if (hours > 24) {
    throw new ValidationError('That night spans more than 24 hours — check the dates on the times');
  }

  const night = {
    date,
    bedAt: M.toLocalString(bedAt),
    sleepAt: sleepAt ? M.toLocalString(sleepAt) : '',
    wakeAt: M.toLocalString(wakeAt),
    upAt: upAt ? M.toLocalString(upAt) : '',
    interruptions: normalizeInterruptions(body.interruptions, bedAt, bedTo),
    notes: isBlank(body.notes) ? '' : String(body.notes).slice(0, MAX_NOTES)
  };

  return night;
}

function validationError(res, e) {
  if (e instanceof ValidationError) {
    res.status(400).json({ error: e.message });
    return true;
  }
  return false;
}

// An entry is a couple dozen short fields plus a handful of interruptions, so
// 32kb is generous for one and well under Express's 100kb default — a client
// can't push large payloads at us.
app.use(express.json({ limit: '32kb' }));

// Everything the page loads is served from this origin, and the app makes no
// third-party requests at all, so this policy is exactly true rather than
// aspirational. 'unsafe-inline' is unavoidable while index.html keeps its
// <script>/<style> blocks inline, which blunts the anti-XSS value — but
// connect-src still stops injected code from shipping your sleep history off to
// another host, and frame-ancestors blocks clickjacking.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'"
].join('; ');

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// GET all nights, newest first
app.get('/api/nights', (req, res) => {
  try {
    res.json(readNights());
  } catch (e) {
    dataError(res, e);
  }
});

// POST a new night
app.post('/api/nights', (req, res) => {
  let night;
  try {
    night = normalizeNight(req.body);
  } catch (e) {
    if (validationError(res, e)) return;
    throw e;
  }

  try {
    const nights = readNights();
    if (nights.length >= MAX_NIGHTS) {
      return res.status(507).json({
        error: `Night limit reached (${MAX_NIGHTS}). Delete old nights or raise MAX_NIGHTS.`
      });
    }

    // One record per morning. Without this you get two half-filled nights for
    // the same date — one from the phone, one from the laptop — and every
    // average quietly counts that night twice. The client turns this into an
    // offer to edit the night that's already there.
    const existing = nights.find(n => n.date === night.date);
    if (existing) {
      return res.status(409).json({
        error: `A night is already logged for ${night.date}.`,
        existingId: existing.id
      });
    }

    // id last: the body must never be able to choose its own id, or a client
    // can collide with (and later delete) an existing night.
    const saved = { ...night, id: randomUUID() };
    nights.unshift(saved);
    sortNights(nights);
    writeNights(nights);
    res.status(201).json(saved);
  } catch (e) {
    dataError(res, e);
  }
});

// PUT (update) an existing night by id
app.put('/api/nights/:id', (req, res) => {
  let night;
  try {
    night = normalizeNight(req.body);
  } catch (e) {
    if (validationError(res, e)) return;
    throw e;
  }

  try {
    const nights = readNights();
    const idx = nights.findIndex(n => sameId(n.id, req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Night not found' });

    const clash = nights.find(n => n.date === night.date && !sameId(n.id, req.params.id));
    if (clash) {
      return res.status(409).json({
        error: `A different night is already logged for ${night.date}.`,
        existingId: clash.id
      });
    }

    nights[idx] = { ...night, id: nights[idx].id };
    const saved = nights[idx];
    sortNights(nights);
    writeNights(nights);
    res.json(saved);
  } catch (e) {
    dataError(res, e);
  }
});

// DELETE a night by id
app.delete('/api/nights/:id', (req, res) => {
  try {
    const nights = readNights();
    const remaining = nights.filter(n => !sameId(n.id, req.params.id));
    if (remaining.length === nights.length) {
      return res.status(404).json({ error: 'Night not found' });
    }
    writeNights(remaining);
    res.status(204).end();
  } catch (e) {
    dataError(res, e);
  }
});

// Newest first. Kept sorted on disk rather than only in the UI, so the file
// reads chronologically and every consumer — page, export, a future script —
// sees the same order without repeating the comparison.
function sortNights(nights) {
  nights.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

// Simple health check for docker-compose healthchecks. Reports the version so
// you can tell which build a running container actually is.
app.get('/api/health', (req, res) => res.json({ status: 'ok', version }));

// Full export: every night, as one JSON file
app.get('/api/export', (req, res) => {
  let nights;
  try {
    nights = readNights();
  } catch (e) {
    return dataError(res, e);
  }
  const payload = { exportedAt: new Date().toISOString(), nights };
  const filename = `snooze-export-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(payload, null, 2));
});

function csvEscape(val) {
  if (val === undefined || val === null) return '';
  let s = String(val);
  // Excel/Sheets treat a leading =, +, - or @ as a formula, so a notes field
  // like "=HYPERLINK(...)" would execute on open. Prefix with an apostrophe to
  // force it back to plain text.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// CSV export. Carries the derived numbers as well as the raw times: the point
// of this file is to be read in a spreadsheet, and nobody wants to reimplement
// the duration rules in a formula column.
app.get('/api/export/csv', (req, res) => {
  let nights;
  try {
    nights = readNights();
  } catch (e) {
    return dataError(res, e);
  }

  const columns = [
    'date', 'bedAt', 'sleepAt', 'wakeAt', 'upAt',
    'asleepMinutes', 'inBedMinutes', 'awakeMinutes', 'efficiencyPct', 'latencyMinutes',
    'interruptionCount', 'interruptions', 'notes'
  ];

  const rows = [columns.join(',')];
  for (const n of nights) {
    const d = M.all(n);
    const row = {
      ...n,
      asleepMinutes: d.asleepMinutes,
      inBedMinutes: d.inBedMinutes,
      awakeMinutes: d.awakeMinutes,
      // Same number the page shows, so an export can be checked against a
      // screenshot without the two disagreeing at the top of the scale.
      efficiencyPct: M.efficiencyPct(n) === null ? '' : M.efficiencyPct(n),
      latencyMinutes: d.latencyMinutes,
      interruptionCount: d.interruptionCount,
      interruptions: M.interruptions(n)
        .map(i => `${i.at.slice(11)} ${i.minutes}m${i.reason ? ' ' + i.reason : ''}`)
        .join('; ')
    };
    rows.push(columns.map(col => csvEscape(row[col])).join(','));
  }

  const filename = `snooze-nights-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'text/csv');
  res.send(rows.join('\n'));
});

app.listen(PORT, () => {
  console.log(`SNOOZE listening on port ${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
});
