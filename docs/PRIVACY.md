# Privacy — Golf Swing Lab (揮桿實驗室)

Owner: package F (trust). The in-app text is the `privacy` catalog (`app/i18n/{zh-Hant,en}/privacy.json`), shown at
Settings › Privacy (`app/src/ui/privacy.js`). This file is the same promise in long form, and it describes how the
code keeps it. When the two disagree, the code wins and this file must be fixed.

## The promise

- **No account.** Nothing to sign up for. The app does not know who you are.
- **No network after install.** The first visit downloads the app (about 32 MB, precached by the service worker).
  After that, practice, analysis and results run on the phone. The app sends no requests.
- **Data stays on this phone.** Videos, poses, results, venues, settings and records live in this browser's
  storage on this device: IndexedDB database `golf-swing-lab`, `localStorage` keys starting with `gsl`, and Cache
  Storage `gsl-shell-*` / `gsl-assets` (app files only).
- **Shared with no one.** Neither the authors nor any third party receive data. There are no ads, analytics,
  crash reporters or trackers.
- **Sensors only while practising.** Camera (films the swing), microphone (hears the strike), motion (levels the
  phone). If you refuse one, everything else still works.
- **Backups are yours.** History › Back up writes one file wherever you choose. Nothing is uploaded.
- **iOS may delete website data.** Safari can evict the data of a site that is not opened for a while. Adding the
  app to the Home Screen and tapping Settings › Storage › Protect my data (`navigator.storage.persist()`) makes this
  less likely. Back up regularly.

## How the code keeps it

| promise | mechanism | where |
|---|---|---|
| no requests leave the origin | Content-Security-Policy `default-src 'self'; connect-src 'self' blob: data:` | `app/index.html` (A) |
| MediaPipe logger blocked | `blockForeignFetch` + XHR / sendBeacon guard in the worker | `app/src/pose/landmarker.js`, `app/src/workers/` (D) |
| no CDN, no external fonts | everything vendored and precached | `app/vendor/`, `scripts/build.mjs` |
| no external URL in code | static test: no `http(s)://` in the app shell | `tests/unit/appcore.static.test.mjs` |
| the only outbound link | About / Help › "Report a problem on GitHub" is a plain `<a href>` the user taps (catalog key `about.support.url`); the app itself never requests it | `app/src/ui/help.js` |
| e2e | every gate fails on a request that leaves the local server | `tests/e2e/lib.mjs` `watchPage` |

## Delete all data

Settings › Privacy › Delete all data → confirm sheet (the safe action is the primary button) →
`deleteAllData()` in `app/src/ui/privacy.js`, then the page reloads and the app starts as on first launch
(onboarding shows again).

1. Repository: `repo.deleteAll()` (or every store cleared in one transaction), then closed.
2. IndexedDB: `deleteDatabase('golf-swing-lab')` and any other database named `golf-swing-lab*` / `gsl*`.
3. Cache Storage: every `gsl-*` cache except the app files (`gsl-shell-*`, `gsl-assets`: code, wasm and pose
   models, no user data), so the app still starts offline afterwards.
4. `localStorage` / `sessionStorage`: every key starting with `gsl` (settings, onboarding flag, calibration health,
   diagnostics mirror), after the in-memory diagnostics are reset.

Only our own names are touched: on GitHub Pages the origin `*.github.io` is shared with other projects, so the app
never calls `localStorage.clear()` or deletes caches it does not own. Machine check: e2e gate `f-privacy`
(`tests/e2e/gates/f-trust.mjs`). iPhone check: in the standalone Home Screen app, delete all data, reopen, confirm
that history is empty and onboarding shows (`docs/device-checklist.md`).

## Swing phase detection

The shipped app detects swing phases with rules (no trained model, nothing derived from third-party datasets). An
owner can import a model trained on their own labelled swings (Settings › Developer options); it is stored in the
same local database and deleted with everything else.
