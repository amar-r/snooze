# Changelog

## Unreleased

First working version.

- Log a night from one sheet: date, in bed, woke, how long it took to drop off,
  out of bed, any number of interruptions, notes. Only the date, bedtime and
  wake time are required. There are no ratings — a score invented at 7am isn't a
  measurement, and everything on screen is meant to be one.
- The sheet asks how long you took to fall asleep, not what time you fell
  asleep, because nobody can know the second one. The record still stores a
  moment (bedtime plus the estimate), so only the question changed. Four common
  answers are one tap each.
- The date opens on today and steps a day at a time — no calendar picker for a
  field that is nearly always already right, and no way to log tomorrow morning.
- A night is filed under the morning you woke up and the sheet takes plain clock
  times, which is ambiguous across midnight — so bedtime resolves to the evening
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
