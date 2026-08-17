# Contributing

SNOOZE is one person's sleep log that happens to be public. Fixes and small
features are welcome; the constraints below are what keep it maintainable by one
person in an evening, so a change that removes one needs to be worth it.

## The constraints

**One process, one HTML file, one JSON file.** `server.js` is Express with a
single runtime dependency. `public/index.html` carries its own CSS and JS
inline. Storage is a JSON array read and rewritten whole. At one record a night,
that is fast enough for a lifetime of sleep, and it means your history is a file
you can open in any text editor.

**No build step, no framework, no bundler.** Editing `public/index.html` and
reloading is the whole development loop. Nothing to install, nothing to
transpile, nothing that stops working in three years because a toolchain moved
on.

**No login.** Adding auth means sessions, password storage and a reset path, all
to protect a single-user app that belongs behind a VPN. Run it on a private
network.

**No charting library.** The ribbons, the clock axis and the guide lines are
positioned divs built from the data. A chart library would be a bigger download
than the rest of the app put together and still couldn't draw a bar that is
literally the shape of one night.

**Vendored browser dependencies.** The two fonts live in `public/vendor/` with
their licences, and the page makes no third-party requests at all. This app
knows when you sleep and wake — it shouldn't be telling anyone. New browser
dependencies get vendored the same way or not added.

**Derived numbers are never stored.** Duration, efficiency, latency and awake
time are computed from the stored times in `public/metrics.js`, which the server
`require`s and the page loads with a `<script>` tag. One definition, so the CSV
and the ribbons can't disagree, and a corrected formula corrects history.

## Working on it

```bash
npm install && npm start   # :8430, writes ./data/nights.json
node -c server.js          # syntax check — this is what CI runs
```

Run a second instance for testing with both `PORT` and `DATA_DIR` overridden, or
it will fight the real one for `data/nights.json`.

There is no test suite and no linter. CI syntax-checks the two JS files, builds
the image, starts it and polls `/api/health`. That is the whole automated check
— anything else has to be verified by running the app, and UI changes have to be
verified on a phone, since that is where this app is actually used.

## Changelog

Every user-visible change gets an entry in `CHANGELOG.md` under `## Unreleased`,
in the existing prose style: what was wrong and why it mattered, not just what
moved. Don't bump `package.json` — a commit becomes part of a release
retroactively, when someone cuts one.
