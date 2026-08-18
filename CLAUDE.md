# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

SNOOZE is a self-hosted single-user sleep tracker: one Node/Express process, a
flat JSON file, no build step, no auth, no framework. It is built to the same
shape as its sibling [wheezer](https://github.com/amar-r/wheezer).
[CONTRIBUTING.md](CONTRIBUTING.md) explains the reasoning behind those choices
and is worth reading before any structural change.

## Commands

```bash
npm install && npm start   # serves on :8430, writes ./data/nights.json
node -c server.js          # syntax check — this is what CI runs
node -c public/metrics.js
docker compose -f docker-compose.yml up -d --build   # build from source
```

There is no test suite and no linter. CI (`.github/workflows/docker-publish.yml`)
syntax-checks both JS files, builds the image, starts it, and polls
`/api/health`. That is the whole check. Anything else has to be verified by
running the app.

`PORT`, `DATA_DIR` and `MAX_NIGHTS` are the environment knobs. Running a second
instance for testing needs both `PORT` and `DATA_DIR` overridden, or it will
fight the real one for `data/nights.json`.

## Architecture

Three files hold essentially all of it:

- **`server.js`** — Express 5. Serves `public/`, exposes
  `GET/POST/PUT/DELETE /api/nights`, `/api/export{,/csv}` and `/api/health`.
  Storage is `readNights()`/`writeNights()` against one JSON array.
- **`public/metrics.js`** — every derived number (duration, efficiency, latency,
  awake minutes, sleep midpoint) plus `parseLocal`. Loaded both by `require` in
  the server and by `<script src>` in the page, deliberately, so the CSV export
  and the ribbons can never disagree. `awakeIntervals()` is the shared source of
  truth for interruptions: clipped to the sleep window and merged, so a typed
  length that overruns the night can't subtract time you weren't in bed for, and
  two overlapping entries can't subtract their overlap twice.
- **`public/index.html`** — ~1000 lines, all CSS and JS inline. One scrolling
  screen: hero ribbon, range control, averages strip, the stack, and a
  `<dialog>` sheet for logging and editing. Dark-first palette in CSS custom
  properties, with a light branch under `prefers-color-scheme` and both pinned
  by `[data-theme]`. `renderRange()` owns the selected window: it resolves the
  night list once and hands the same list to the strip and the stack, so the
  numbers and the ribbons can't end up describing different sets of nights. The
  hero is deliberately outside it — last night is last night.

## Drawing

There is no charting library, deliberately — see CONTRIBUTING.md. A night is
drawn by `segmentsOf()`, which tiles the in-bed span with `sleep` / `brk` /
`edge` segments, and positioned by `pct()` against an axis measured in hours
since noon of the evening the night began. The noon anchor is what stops a night
wrapping around the end of the axis; `originOf()` steps back a day for a bedtime
in the small hours.

Positions are wall-clock (`hoursFrom` works off calendar fields), because the
ribbon has to line up with the tick labels. Durations are elapsed time. On the
two DST nights a year they differ by an hour, and that is correct: the duration
is the true one, the ribbon matches the clock on the wall.

Segments must tile the night exactly — a gap is a hole in the ribbon, an overlap
paints awake time over sleep — and the `sleep` segments must add up to
`asleepMinutes()`. Both are cheap to check in Node; see below.

## The timestamp rule

This is the thing to not break. A night crosses midnight, so a clock time on its
own is ambiguous.

- A night is keyed by `date`, **the morning you woke up**. That key is what
  makes one-night-per-day enforceable and it is what the CSV exports; it never
  moves.
- A night is *labelled* after **the day it was when you got into bed** — the
  calendar day of `bedAt`, via `nightDay()` in `public/index.html`. In bed 22:30
  Monday is Monday night; in bed 00:49 is Tuesday, because by then it was. The
  hero and the stack both go through `nightDay()`, so they can't disagree.
  Don't "simplify" this to `date` minus a day: that is right only for the
  before-midnight case and misnames every night that starts in the small hours.
  Two adjacent nights *can* draw the same label — one starting 00:49, the next
  23:30 the same day — which is a true statement about when you went to bed, not
  a bug to clamp. The sheet's stepper is deliberately still labelled by the
  morning: it picks the morning, and the bedtime it would need isn't typed yet.
- `sleepAt` is stored as a moment but is never *asked* for as one: the sheet
  collects a "took to drop off" estimate in minutes and adds it to `bedAt`, and
  the edit path turns it back into minutes with `latencyMinutes()`. Don't put a
  time input back — you cannot observe the minute you fell asleep.
- Stored times (`bedAt`, `sleepAt`, `wakeAt`, `upAt`, each `interruptions[].at`)
  are full local `YYYY-MM-DDTHH:mm` stamps. The ambiguity is resolved once, in
  the browser, at save time.
- `resolveBedAt()` puts bedtime on the previous day when it reads 12:00 or
  later. `atOrAfter()` puts every other time at the first occurrence of that
  clock time at or after bedtime.
- The `#echo` block in the sheet draws the resolved night back before saving.
  Keep it: it is the only place a wrong day is visible before it reaches the
  stack.

Durations are Date subtraction on those stamps, so DST is handled by
construction — a spring-forward night really does come out an hour shorter.
Don't reintroduce clock arithmetic on `HH:mm` strings.

## Invariants worth not breaking

- `readNights()` throws on a corrupt file rather than returning `[]`. Returning
  an empty list lets the next write silently destroy the whole history.
- `writeNights()` writes a temp file and renames. Never write `DATA_FILE`
  directly.
- `normalizeNight()` builds the stored record field by field. Never spread
  `req.body` into what gets saved, and never let a client choose its own `id`.
- One night per `date`, enforced with a 409 on both POST and PUT. Two records
  for one morning means every average counts that night twice.
- Nights that can't be true (wake before bed, span over 24h, an interruption
  outside the night) are refused, not clamped. One bad night distorts every
  average instead of showing up as a hole.
- Derived values are computed in `public/metrics.js` and never stored.
- Anything user-entered that gets rendered back into the page goes through
  `escapeHtml()` (aliased to `esc` in the night-list renderer).
- Browser dependencies are vendored in `public/vendor/`, not pulled from a CDN,
  so the app makes no third-party requests with sleep data on the page. New ones
  get vendored the same way, licence included.
- No bundler, no framework, no login screen. All three are deliberate omissions.

## Changelog and versioning

Every user-visible change gets an entry in `CHANGELOG.md` under `## Unreleased`,
in the existing prose style: what was wrong and why it mattered, not just what
moved.

**Do not bump `package.json` per change.** A commit becomes part of a release
retroactively, when someone later cuts one. Cutting a release is its own
deliberate act: a bookkeeping commit that renames `## Unreleased` to the version
heading and bumps `version` in `package.json` and `package-lock.json` — no
feature work — followed by a `v*.*.*` tag. The tag is the trigger; CI refuses to
publish one that disagrees with `package.json`.

Shipping and releasing are different: every non-docs commit to `main` publishes
`:latest`, so `latest` deliberately runs ahead of the newest tag.

## Verifying changes

There are no frontend tests, so changes to `public/index.html` need the app
driven for real. **Stand up a local preview and get it confirmed on a real
device before pushing.** The engine that matters is iOS Safari, which headless
Chromium does not stand in for.

Seed a throwaway instance so the stack has something to draw:

```bash
mkdir -p /tmp/snooze-preview
curl -s http://localhost:8430/api/nights > /tmp/snooze-preview/nights.json
DATA_DIR=/tmp/snooze-preview PORT=8431 node server.js
```

Then hand over `http://<lan-ip>:8431` and wait for confirmation. Find the
address with `ip -4 -o addr show scope global` and take the real interface, not
the many `br-*` docker bridges. `public/` is served from disk per request, so
edits appear on reload without restarting the process.

The arithmetic behind the drawing is testable without a browser, and worth
testing whenever it changes. `atOrAfter()`, `resolveBedAt()`, `originOf()`,
`hoursFrom()`, `segmentsOf()`, `axisFor()`, `pct()` and `clockLabelFor()` are
all plain functions with no DOM in them: pull them out of `public/index.html`
with a regex, run them in `node:vm` against `metrics.js`, and assert on the
numbers. Cases that have mattered: an after-midnight bedtime, an interruption at
03:00 on such a night, the 11:59/12:00 boundary, a month and a year rollover,
both DST transitions, an interruption typed longer than the rest of the night,
two interruptions that overlap, and every segment landing inside 0–100%.

For anything visual, drive a real browser. Do **not** add Playwright or similar
to `package.json`: the project has one runtime dependency and no
devDependencies, deliberately. Use whatever browser automation the environment
provides, and if none is available, say the change is unverified rather than
implying otherwise. Check both themes — the light palette is a separate branch
of custom properties and only one is on screen at a time — and check the sheet
on a phone, where it becomes a bottom sheet with its own layout rules.
