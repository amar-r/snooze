// Everything derived from a stored night lives here, and only here.
//
// A night stores nothing but the times you typed. Duration, efficiency, latency
// and the rest are computed on read, so correcting a formula later corrects
// every night already on disk instead of only the ones logged after the fix.
//
// This file is loaded two ways — `require`d by server.js for the CSV export and
// <script src>'d by index.html for the UI — so the numbers in the export and
// the numbers on screen can never drift apart.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SleepMetrics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MINUTE = 60 * 1000;

  // Local-time parse of `YYYY-MM-DDTHH:mm[:ss]`, the shape a `datetime-local`
  // input produces. Deliberately not `new Date(string)`: that treats a
  // seconds-less datetime as UTC in some engines and local in others, which
  // would shift every night by the timezone offset depending on the browser.
  // Building the Date from parts is unambiguous, and it also means the ms
  // difference between two of these spans DST correctly — a spring-forward
  // night really is an hour shorter.
  function parseLocal(s) {
    if (typeof s !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s.trim());
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), 0);
    // Rejects things like 2026-02-31, which the Date constructor would happily
    // roll over into March.
    if (d.getFullYear() !== +m[1] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) {
      // The one legitimate exception is a clock time that doesn't exist because
      // the DST jump skipped it (02:30 on a spring-forward morning). That
      // normalises forward within the same day, so only a date rollover is a
      // real error.
      return null;
    }
    return d;
  }

  function toLocalString(d) {
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function minutesBetween(a, b) {
    if (!a || !b) return null;
    return Math.round((b - a) / MINUTE);
  }

  // `sleepAt` and `upAt` are optional: if you didn't note when you actually
  // dropped off, the best available answer is that it was when you got in bed,
  // and likewise for getting up versus waking. Falling back keeps a two-field
  // night (in bed, woke) producing sane numbers rather than nulls.
  function sleepStart(n) { return parseLocal(n.sleepAt) || parseLocal(n.bedAt); }
  function sleepEnd(n) { return parseLocal(n.wakeAt); }
  function bedStart(n) { return parseLocal(n.bedAt); }
  function bedEnd(n) { return parseLocal(n.upAt) || parseLocal(n.wakeAt); }

  function interruptions(n) {
    return Array.isArray(n.interruptions) ? n.interruptions : [];
  }

  // Interruptions as real intervals, clipped to the sleep window and merged.
  //
  // Both steps matter and both come from the same fact: these are hand-typed at
  // 7am from a half memory. A length typed longer than the rest of the night
  // ("up at 5:30 for 300 minutes" when you got up at 6) would otherwise subtract
  // time you were never in bed for, and two entries that overlap would subtract
  // their overlap twice — either one puts the duration below what the night
  // could possibly hold.
  //
  // The page draws its ribbons from this same list, so what you see and what
  // gets counted can't drift apart.
  function awakeIntervals(n) {
    var from = sleepStart(n);
    var to = sleepEnd(n);
    if (!from || !to) return [];

    var raw = interruptions(n).map(function (i) {
      var at = parseLocal(i && i.at);
      if (!at) return null;
      var mins = Number(i.minutes);
      var start = new Date(Math.max(at.getTime(), from.getTime()));
      var end = new Date(Math.min(
        at.getTime() + (Number.isFinite(mins) && mins > 0 ? mins : 0) * MINUTE,
        to.getTime()
      ));
      if (end <= start) return null;
      return { from: start, to: end };
    }).filter(Boolean).sort(function (a, b) { return a.from - b.from; });

    var merged = [];
    raw.forEach(function (iv) {
      var last = merged[merged.length - 1];
      if (last && iv.from <= last.to) {
        if (iv.to > last.to) last.to = iv.to;
      } else {
        merged.push({ from: iv.from, to: iv.to });
      }
    });
    return merged;
  }

  function awakeMinutes(n) {
    return Math.round(awakeIntervals(n).reduce(function (sum, iv) {
      return sum + (iv.to - iv.from);
    }, 0) / MINUTE);
  }

  function inBedMinutes(n) {
    return minutesBetween(bedStart(n), bedEnd(n));
  }

  // Time actually asleep: the sleep window less every minute spent awake inside
  // it. `awakeIntervals` already clips and merges, so this can't go negative on
  // its own; the clamp stays as a floor against future arithmetic.
  function asleepMinutes(n) {
    var span = minutesBetween(sleepStart(n), sleepEnd(n));
    if (span === null) return null;
    return Math.max(0, span - awakeMinutes(n));
  }

  // Asleep as a fraction of time in bed, 0..1.
  function efficiency(n) {
    var asleep = asleepMinutes(n);
    var inBed = inBedMinutes(n);
    if (asleep === null || !inBed || inBed <= 0) return null;
    return Math.min(1, asleep / inBed);
  }

  // Efficiency as a whole number, with one rule on top of the arithmetic: only
  // an unbroken night is allowed to read 100%.
  //
  // 415 minutes asleep out of 417 in bed is 99.5%, and rounding that up puts
  // "100%" directly beside "woken 1×", which reads as a bug in the app rather
  // than as two minutes at 6am. Anything short of a whole untroubled night tops
  // out at 99 instead.
  function efficiencyPct(n) {
    var eff = efficiency(n);
    if (eff === null) return null;
    if (eff >= 1 && interruptions(n).length === 0) return 100;
    return Math.min(99, Math.round(eff * 100));
  }

  // Same rule for any fraction that isn't a single night — an average over a
  // range only reads 100% if every night in it did.
  function pctLabel(fraction, perfect) {
    if (fraction === null || fraction === undefined) return '—';
    if (fraction >= 1 && perfect) return '100%';
    return Math.min(99, Math.round(fraction * 100)) + '%';
  }

  // How long it took to drop off.
  function latencyMinutes(n) {
    var bed = bedStart(n);
    var sleep = sleepStart(n);
    if (!bed || !sleep) return null;
    return Math.max(0, minutesBetween(bed, sleep));
  }

  // Midpoint of the sleep window, as hours after noon of the previous day —
  // so an 03:30 midpoint reads as 15.5 and a 23:00 one as 11, and the two sort
  // in the order you'd actually experience them. This is what makes schedule
  // drift plottable on a continuous axis without a wrap at midnight.
  function midpointHours(n) {
    var start = sleepStart(n);
    var end = sleepEnd(n);
    if (!start || !end) return null;
    var mid = new Date((start.getTime() + end.getTime()) / 2);
    var h = mid.getHours() + mid.getMinutes() / 60;
    return h < 12 ? h + 12 : h - 12;
  }

  // Clock position for the bed/wake span chart, same noon-anchored scale.
  function clockHours(d) {
    if (!d) return null;
    var h = d.getHours() + d.getMinutes() / 60;
    return h < 12 ? h + 12 : h - 12;
  }

  function all(n) {
    return {
      inBedMinutes: inBedMinutes(n),
      asleepMinutes: asleepMinutes(n),
      awakeMinutes: awakeMinutes(n),
      efficiency: efficiency(n),
      latencyMinutes: latencyMinutes(n),
      interruptionCount: interruptions(n).length,
      midpointHours: midpointHours(n)
    };
  }

  function formatDuration(mins) {
    if (mins === null || mins === undefined || !Number.isFinite(mins)) return '—';
    var sign = mins < 0 ? '-' : '';
    var m = Math.abs(Math.round(mins));
    var h = Math.floor(m / 60);
    var rem = m % 60;
    if (h === 0) return sign + rem + 'm';
    if (rem === 0) return sign + h + 'h';
    // Zero-padded: these sit in monospace tags stacked down the night list, and
    // "7h 5m" against "7h 55m" makes the column look ragged.
    return sign + h + 'h ' + String(rem).padStart(2, '0') + 'm';
  }

  return {
    MINUTE: MINUTE,
    parseLocal: parseLocal,
    toLocalString: toLocalString,
    minutesBetween: minutesBetween,
    bedStart: bedStart,
    bedEnd: bedEnd,
    sleepStart: sleepStart,
    sleepEnd: sleepEnd,
    interruptions: interruptions,
    awakeIntervals: awakeIntervals,
    inBedMinutes: inBedMinutes,
    asleepMinutes: asleepMinutes,
    awakeMinutes: awakeMinutes,
    efficiency: efficiency,
    efficiencyPct: efficiencyPct,
    pctLabel: pctLabel,
    latencyMinutes: latencyMinutes,
    midpointHours: midpointHours,
    clockHours: clockHours,
    formatDuration: formatDuration,
    all: all
  };
});
