# Changelog

## 0.1.0 — 2026-08-20

First working version.

- Log a night from one sheet: date, in bed, woke, how long it took to drop off,
  out of bed, any number of interruptions, notes. Only the date and the bedtime
  are required; the wake time can wait until morning. There are no ratings — a
  score invented at 7am isn't a measurement, and everything on screen is meant
  to be one.
- The sheet asks how long you took to fall asleep, not what time you fell
  asleep, because nobody can know the second one. The record still stores a
  moment (bedtime plus the estimate), so only the question changed. Four common
  answers are one tap each.
- The night opens on last night and steps a day at a time — no calendar picker
  for a field that is nearly always already right, and it reaches no further
  ahead than tomorrow morning — the night you can still be getting into bed for.
- A night can be logged when you get into bed and finished when you wake up.
  Nothing would save without a wake time, so the bedtime had to survive the
  night in your head and be reconstructed over breakfast — and the one thing you
  can record accurately at 11pm is that it is 11pm, along with what kind of day
  it had been. A night saved without a wake time is held open: it sits above the
  hero as its own card, stays out of the stack and out of every average because
  it has no duration to contribute yet, and tapping it reopens the sheet to fill
  in the rest. Its numbers read blank rather than zero until then, on the page
  and in the CSV alike. Interruptions can go in as they happen; they're clipped
  to the night in the usual way once there is a wake time to clip them against.
  A night left open can still only cover 24 hours, so filling one in two days
  later is refused rather than quietly stretched.
- Going to bed after logging a night that ended the same morning no longer
  collides with it. In bed at 02:00 and awake at 05:00 is a night keyed to that
  morning; getting into bed again at 22:00 that evening belongs to *tomorrow*
  morning — but the sheet would only offer a morning that had already happened,
  so the second night was pushed onto the first one's key and refused as a
  duplicate of it. The stepper now reaches tomorrow morning, labelled as such,
  and a fresh sheet opens on the first morning not already logged — so with this
  morning filled in it is already on the right night, whatever time of day you
  come to write it down.
- A night is named on screen after the day it was when you got into bed, not
  the morning it ended. Waking on Tuesday from a night that started 22:30 on
  Monday, calling the entry "Tuesday" read as a mistake every time you looked at
  the stack. The name is taken from the bedtime rather than by counting a day
  back off the key, because counting back is only right for the half of nights
  that start before midnight: in bed at 00:49, it really is already Tuesday, and
  the old label was the correct one. Two adjacent nights can now carry the same
  name — one begun at 00:49 and the next at 23:30 — which is what actually
  happened. The stored key is untouched: still the morning you woke up, still
  what makes one night per day enforceable, still what the CSV carries.
- The icon is real files rather than an inline `data:` URI. Adding SNOOZE to an
  iOS home screen produced a blank square, because iOS won't take an inline SVG
  as a touch icon — it wants a PNG it can fetch. There is now an
  `apple-touch-icon.png` for the home screen, full-bleed because iOS applies its
  own rounding and masking, alongside `icon.svg`, `icon-32.png` and a
  `favicon.ico` so a bare request for the conventional path stops 404ing. Same
  mark throughout: a night as the app draws it, asleep either side of awake.
- The time axis is labelled by the hour rather than every second hour. Bedtime
  is a thing you read to the hour, and against two-hourly ticks half of them had
  to be estimated by eye off the gap between labels. It steps back up to two-
  and three-hourly only when the range is wide enough that hourly labels would
  print into each other.
- Interruption stamps above the hero ribbon are turned on their side. Two
  wakings sixteen minutes apart printed over each other and neither could be
  read: lying down a stamp is six characters wide, which is far more of the axis
  than a quarter of an hour. Stood on end it is one character wide, so it takes
  a collision of minutes rather than of hours, and nothing has to be measured
  after layout or shuffled out of the way to get there.
- A night is stored under the morning you woke up and the sheet takes plain
  clock times, which is ambiguous across midnight — so bedtime resolves to the evening
  before when it reads as an evening, everything else to the first occurrence
  after bedtime, and the resolved night is drawn back to you in the sheet before
  you save. Getting this wrong silently is the failure mode the whole design is
  arranged around.
- Nights are drawn rather than charted: each one is a ribbon on a shared clock
  axis, solid where you slept, warm where you were awake, hatched where you were
  in bed but not asleep. Stacked with median bedtime and wake time as guide
  lines, which is what makes schedule drift visible. No charting library.
- Duration, efficiency, latency and awake time are derived on read rather than
  stored, so correcting a formula corrects every night already logged.
- Efficiency tops out at 99% for any night you were woken on. Two minutes awake
  in a seven-hour night is 99.5%, and rounding that to 100% put a perfect score
  next to "woken 1×", which reads as the app being broken rather than as two
  minutes at 6am. The same rule applies to the range average and to the CSV, so
  an export and a screenshot always agree.
- Interruptions are clipped to the night and merged before they're counted. A
  length typed longer than the rest of the night ("up at 5:30 for 300 minutes"
  when you got up at 6) would otherwise subtract time you were never in bed for,
  and two that overlap would subtract their overlap twice — either one puts a
  night below what it could possibly have held. The ribbons draw from the same
  clipped list, so the picture and the number can't disagree.
- One night per date, enforced by the server. A second save for the same morning
  returns 409 and the sheet offers to open the existing night instead — without
  it you get two half-filled records for one night and every average counts it
  twice.
- Nights that can't be true are refused rather than stored: a wake time before
  bedtime, a span over 24 hours, an interruption outside the night. Each one
  would otherwise distort every average instead of showing up as an obvious
  hole.
- JSON and CSV export; the CSV carries the derived numbers so nothing has to be
  recomputed in a spreadsheet formula.
