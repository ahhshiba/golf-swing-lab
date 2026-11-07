# e2e hooks (owner: foundation; previously devtools)

What `tests/e2e/*.mjs` (Playwright 1.49.1, Chromium; WebKit variants) needs from the app. Run: `npm run test:e2e`, or
`RUN_BROWSER_E2E=1 bash scripts/verify.sh --only browser-e2e`, or `node tests/e2e/run.mjs --only m1,screens,m2,m2-ui,m2-shot,m5,m6,m6-ui,real-pose,m1@webkit,screens@webkit,m2@webkit,real-pose@webkit [--dist dir]`.
Runner serves `dist/` with `scripts/devserve.py` on a free `127.0.0.1` port, prefix `/golf-swing-lab/`.
A missing hook makes that gate FAIL with the testid in the message; nothing passes silently.

## Package gates and parallel runs (PRODUCT-SPEC §8.0.12–13, drop 1)

- A package gate is a file `tests/e2e/gates/<pkg>-<name>.mjs` (`<pkg>` = a…f) exporting `meta = { id, title, timeoutMs }`
  and `run(ctx)` (returns a summary string, throws to FAIL, throws `Skip` from lib.mjs to SKIP), and/or `gates = [{ meta,
  run }]`. `run.mjs` discovers them after the built-in gates; ids must be unique (convention: `<pkg>-<name>`). A module that
  fails to import is reported as a FAIL gate with its file name.
- `ctx = { baseUrl, dist }`. Launch browsers with `launch(ctx, opts)` from `lib.mjs`: its contexts default to locale
  `zh-TW` (Playwright would report `en-US` and the app would switch to English); pass `locale` to `newContext` to test
  another locale, or set `GSL_E2E_LOCALE` for a whole run.
- Run your own gates against your own build without touching `dist/`:
  `node scripts/build.mjs --out <scratch>/dist-<pkg>` then
  `GSL_E2E_DIST=<scratch>/dist-<pkg> GSL_E2E_PORT=<8811…8816> node tests/e2e/run.mjs --only '<pkg>-*'`
  (`--dist` and `--port` do the same; `--list` prints the selected gates; `--only` takes ids and prefixes ending in `*`).
- Integration screenshot matrix (§8.7 step 4): `node tests/e2e/screenshot_matrix.mjs --dist <dist> --out <dir> [--port N]
  [--json file]` — by default every screen and state of LAUNCH-MONITOR-SPEC §5.3-4 (10 shell screens, drills, drill, stats,
  gapping, shot:tiles|side|top|3d|video, drills:setup, drill:result|active) × 390/430 (+ 844×390 for setup and live) × light/dark/sun ×
  zh-Hant/en × text 100/200 % (552 states; history seeded with the v1 and v2 `valid_*` fixtures, shot = v2 face_on), each screenshotted and checked for h-scroll, control overlap, obscured / clipped glance targets (live
  pill, hero tiles, count, club, toolbar; setup title, primary, ≥ 2 lines of the instruction in landscape), truncation,
  split words, spec codes, CJK in en and hero sizes; exit code = states with findings. verify runs it as gate
  `a-matrix` (browser-e2e stage, 0 findings required).
- Shared checks: `tests/e2e/checks.mjs` (see docs/design-system.md §6). Screenshots: `screenshotSet()` writes to
  `$GSL_SHOTS_DIR` (default `tests/e2e/.shots`).
- New testids declared by the spec (§8.0.12): `onb-next`, `onb-skip`, `onb-allow`, `setup-step` (with `data-step`),
  `setup-primary`, `camera-retry`, `camera-import-instead`, `live-state`, `live-hero`, `live-club`, `live-end`,
  `shot-hero`, `shot-unmeasured`, `event-chip`, `event-set-frame`, `event-undo`, `history-session`, `shot-star`,
  `shot-delete`, `undo-toast`, `teach-accept`, `teach-progress`, `import-queue`, `import-error-card`, `settings-locale`,
  `settings-units`, `settings-theme`, `privacy-delete-all`, `about-version`, `diag-save`, `tabbar-<id>`. Components keep
  the testid you pass (`filePicker` puts it on the `<input type=file>`; `switchRow` on the switch; `confirmSheet` uses
  `confirm-yes` / `confirm-no` unless you pass a testid).
- Shell hooks: `#toast` (`role=status`, info), `#toast-alert` (`role=alert`, errors), `#icon-sprite`; diag record
  `errors.last` (until D's `events[]` ring exists) and `i18n.missing`.

## Launch-monitor packages (LM-A drop 1, 2026-11-06; docs/LM-INTERFACES.md §7)

- Gates `tests/e2e/gates/lm-<a…f>-<name>.mjs` are discovered like the package gates (ids `lm-<x>-<name>`); LM-A's is
  `lm-a-shell`.
- `__GSL_E2E__.app.e2e.registerState(screen, name, async (app) => …)` registers a named screen state;
  `screenshot_matrix.mjs --screens shot:tiles,drill:result` shows the screen, runs the state and checks it like any
  other (a state nobody registered is a `state` finding). `app.e2e.runState(screen, name, app)`, `has()`, `states()`.
- `__GSL_E2E__.app.drill` = `{ current(), set(drill | null), onChange(fn) }`.
- New screens: `drills`, `drill`, `stats`, `gapping` (`[data-screen="<id>"]`); on `theme = auto` the roots of `shot`,
  `stats`, `gapping`, `drill` carry `data-live-theme="dark"`. New installs start with `settings.theme = 'dark'`.

## UI hooks (all present since the integration step, 2026-11-04)

| Hook | Where | Used by |
|---|---|---|
| `#app-ready` (hidden element, added when boot finishes) | any | all gates |
| `[data-screen="<id>"]` on each screen root (`home`, `live`, `history`, ...) | all screens | m5, m6-ui |
| `data-testid="nav-import"` (fallback today: button text 匯入影片) | button/tab that shows the import screen (optional: m2 clicks it only if present) | m2 |
| `data-testid="import-file-input"` (fallback today: `#import-file`) | the `<input type="file">` that starts probe + decode + analysis (must exist in the DOM, may be visually hidden) | m2 |
| `data-testid="tabbar-history"` (fallback: `[data-go="history"]`) | the History tab of the bottom tab bar (the home `nav-history` row was removed at integration, 2026-11-05: History and Settings are tabs, §2.1) | m6-ui, screens, c-*, f-* |
| `data-testid="history-import-input"` (fallback: `#hist-import`) | `<input type="file">` importing an export JSON (`golf-swing-lab-export/1`) | m6-ui |
| `data-testid="shot-row"` (fallback: `[data-screen="history"] button.linklike`, one per shot) | one element per shot in the history list | m6-ui |
| `data-testid="history-export-json"` (fallback: button text 匯出 JSON; the test also clicks the `a[download]` link it produces) | button that exports all shots as JSON | m6-ui |
| `data-testid="btn-start-practice"` (fallback: `#start-practice`) | the 開始練習 button on home | m5 |
| `data-testid="btn-skip-setup"` | e2e-only, rendered only when `globalThis.__GSL_E2E__` is set before boot (`context.addInitScript`): setup -> `live` (or `import` in high-speed mode) without a calibration | m5, screens |
| `data-testid="nav-venue"` | home's "add a venue" row (`nav-diag`, `nav-settings`, `nav-about` are gone: Diagnostics and About are under Settings as `settings-diag` / `settings-about`, Settings is `tabbar-settings`) | screens, b-* |
| `data-testid="import-start"` | the 開始分析 button of the import screen | m2-shot |

## e2e-only seams (`globalThis.__GSL_E2E__`, never set by the app itself)

| Field | Effect | Gate |
|---|---|---|
| (object present) | setup shows `btn-skip-setup` | m5, screens |
| `app` (set by main.js at boot) | the app object: gates navigate with `__GSL_E2E__.app.nav.go(id, params)` and wait for the late layers with `await __GSL_E2E__.app.ready()` | a-shell |
| `pose(bitmap, t_s, model, { crop }) -> { img: Float32Array(132), world: Float32Array(99) }` | the live screen uses it instead of the vision worker's MediaPipe pose (it must `close()` the bitmap). Frame tap, recorder, onsets, live state machine and diag stay real. | m5 |
| `clipPose(bitmap, t_s, { crop }) -> { img: Float32Array(132), world: Float32Array(99) }` | when a function at boot, the worker client's `init` carries `e2e_clip_pose: true`; the worker still runs MediaPipe on every frame of the trimmed `analyze_clip` window (the cost is measured) and then asks the page for the landmarks to use (`e2e_pose` / `e2e_pose_reply` messages, workers/protocol.js) | d-latency |
| `workerDelayMs` (number > 0) | every message to the vision worker is delayed by that much (a stalled worker), so per-call timeouts fire (`ANALYSIS_TIMEOUT`) | d-worker-crash |
| `vision` (set by workers/client.js) | the live vision client (`terminate()` it to simulate a worker crash) | d-worker-crash |
| `analyzeClip(file, options, { onProgress }) -> Promise<result>` | the import queue uses it instead of the vision worker's analysis; probe, queue, save and every screen state stay real | c-import-batch |
| `onboarding` (truthy) | an automated browser (`navigator.webdriver`) shows onboarding on a fresh profile only when this is set before boot; otherwise onboarding is skipped so the older gates start on home | b-onboarding, f-privacy |

## Needed diag records (`diag.record(path, value)`, read by e2e through `src/diag/record.js`)

The e2e page code imports `<base>src/diag/record.js` and `report.js` by URL, so the app MUST import the same files by the
same relative path (no bundling, no copies) for the module instance to be shared.

| Path | Value | Written by | Gate |
|---|---|---|---|
| `import.last` | `{effective_fps, sample_count, hevc, decoded}` from the import screen's probe (`decoded: null`); after the analysis `pipeline/clip.js` sets `import.last.decoded` = frames the decoder delivered in the pose pass, which decodes every sample of an untrimmed clip (R6 M2: decoded == sample_count), and `import.last.analysed_frames` = pose + impact frames | media (import, pipeline) | m2, device M2 |
| `gum.calls` | counter (`diag.increment('gum.calls')` per getUserMedia) | media (capture) | m5, device M1/M5 |
| `gum.requested_fps`, `gum.actual_fps`, `gum.width`, `gum.height` | numbers from `track.getSettings()` | media (capture) | device M1 |
| `motion.permission` / `motion.available` / `motion.same_click` | string / bool / bool | media (sensors) + session | device M1 |
| `live.shot_log` | last 64 detected shots `[{kind, t_impact, t_peak, t_finish, impact_source}]` (media time) | pipeline/live.js | m5 (match by impact time) |
| `live.onset_log` | last 64 impact-candidate onsets `[[t_media_s, level_db]]` as fed to the detector | pipeline/live.js | m5 (audio-video offset) |
| `import.last.events_source` | `'tcn'` or `'rules'` (+ fallback reason, e.g. `rules (tcn_low_visibility)`) of the last clip | pipeline/clip.js | real-pose |
| `events.tcn` | `{loaded: true, version}` or `{loaded: false, error}` (worker loads app/models/event-tcn-v1 once) | workers/vision.worker.js | real-pose |
| `pose.blocked_requests` | count of cross-origin fetches refused by the landmarker's guard (tasks-vision telemetry) | pose/landmarker.js | real-pose (external-request check) |
| `live.detections` | integer count of accepted shots (`kind: 'swing'`) in the live session; practice swings go to `live.practice` | pipeline/live.js | m5, device M5 |
| `live.touches_per_shot`, `live.latency_p95_s`, `live.frames_dropped_pct` | numbers | session | m5, device M5 |
| `pose.delegate`, `pose.lite_ms_p50`, `pose.full_ms_p50` | string / ms | media (pose) | device M2 |
| `app_version` (optional) | string; default is VERSION parsed from `sw.js` | app-core | report |
| extension records for device gates: `repro.*`, `setup.p90_s`, `setup.n`, `setup.new_venue_s`, `droptest.g_mps2`, `ballstats.*`, `highspeed.*`, `offline.*` | see header of `scripts/check_device_report.mjs` | session / calib UI | device M2b/M4/M4b/M6 |

## Service worker (app-core)

- `scripts/build.mjs` embeds `const MANIFEST = {...}` in `sw.js`; `scripts/check-sw.mjs` and `diag/report.js` parse it with
  `parseSwManifest()` (exported by `app/src/diag/report.js`). The hash algorithm in check-sw is a copy of `build.mjs versionOf()`
  and is cross-checked against the real `build()` by `tests/unit/devtools.check_sw.test.mjs`.
- The report asks the SW with `{type:'GET_VERSION'}` and reads `{type:'VERSION', version, precache_complete}` from the
  `serviceWorker` message channel (already implemented in `app/sw.template.js`); without an answer it counts manifest entries
  present in `gsl-shell-<VERSION>` and `gsl-assets`.

## Fixtures

`node scripts/make_fixtures.mjs` (about 1 minute, deterministic, written to the git-ignored `tests/fixtures/generated/`):
`clip_240_h264.mp4`, `clip_240_vp9.mp4`, `clip_240.json`, `m5_fake_cam.y4m`, `m5_fake_mic.wav`, `m5_truth.json`.
The Chromium that Playwright ships has no H.264 decoder (`VideoDecoder.isConfigSupported('avc1...')` is false), so gate m2
uses the VP9-in-MP4 twin there and says so in its output; the real H.264 path is only exercised on Safari / system Chrome.

## Gate m5 (was a known gap; matched by time since 2026-11-04)

The fake camera plays `m5_fake_cam.y4m`, whose "wrist" is a bright disc, not a person. Gate m5 now installs the pose
stand-in above (`tests/e2e/m5.mjs` `installPoseStandIn`): luma > 180 centroid of the real frame-tap bitmap reported as both
wrists in MediaPipe world metres with the frame `FRAME_H_M = 0.8` m tall. At that scale the hands rise 0.4 m, below the
detector's motion-only real-swing profile (0.45 m), so the audio click is what separates the 10 real swings from the 5
practice swings: the gate tests frame tap + audio onsets + `events/live.js` fusion, NOT MediaPipe on a golfer (that needs a
real video: see gate real-pose).

Scoring (CAFCR R6 M5 "召回 ≥0.9、誤觸發 ≤1"): every `live.shot_log` entry of kind `swing` is matched one-to-one to a
real swing of `m5_truth.json` by impact time (|Δt| ≤ 0.5 s, closest first). recall = matched / 10 (≥ 0.9), false
triggers = accepted swings matching no real swing (≤ 1; labelled practice / neighbour / duplicate / nothing),
accepted-swing count within ±1 of 10; practice-swing and neighbour-sound rejections are reported separately, plus the
audio-video offset of the loud onsets.

Nondeterminism root cause (old gate: 9 vs 10 detections, audio.onsets 25/27/30): the fake devices loop from
getUserMedia, while the first analysed frame arrives a variable 1-6 s later (vision worker, AudioWorklet module), and
the old window ("105 + 2 s from the first frame") therefore began at a random phase of the timeline. Starting inside a
real swing's slot, that swing was seen without its ADDRESS and its next occurrence fell past the window: 9.
`audio.onsets` counts every onset since the detector started, so it varied with the same delay (it is not a gate
number). Second cause, found while matching by time: `audio/onset.js` mapped the worklet's input-sample context time to
performance time through `getOutputTimestamp()`, which adds the OUTPUT latency; impact clicks landed 0.20-0.30 s after
the wrist peak, at the edge of events/live.js's ±0.3 s audio-fusion window, so real swings became "practice" at random
(one run: recall 3/10, audio-video offset 0.295 s). The onset is now mapped with the processing clock
(`ctxToPerfMsNow`: now − (currentTime − t_ctx) − input latency): offset about 0.06 s. Third cause: the 44.1 kHz fake-mic
wav went through Chromium's fake-capture resampler into the 48 kHz context and played 0.03-0.22 % slow, run to run
(measured from the onset times: up to 0.23 s late after 100 s), so later swings drifted out of the fusion window
(recall 5/10 in two of five runs). The wav is now 48 kHz: drift ≤ 0.014 %. Fourth: the fake camera was 10 fps, so the live loop's 30 Hz SWING sampling
had nothing to sample and the wrist-speed peak (the reference for the ±0.3 s fusion) was quantised to 0.1 s; one late
frame under load moved it 0.2 s. The y4m is now 30 fps (12-bit frame code). 5 consecutive runs after these fixes
(2026-11-04, load average 10-15 from other jobs): recall 10, 10, 10, 9, 10 / 10, false triggers 0 in all, practice
rejected 5/5 and neighbour 10/10 in all, audio-video offset 0.049-0.061 s. The one miss (run 4, first real swing at
fixture 8.2 s) was its click measured below the 20 dB impact threshold (counted as a soft onset) - an onset-detector
start-up question, open. Fix without loosening anything: `m5_fake_cam.y4m` carries a frame-index code (11 bits + parity along the top
edge, luma 160 < the stand-in's 180 disc threshold; `make_fixtures.mjs FRAME_CODE`), the stand-in decodes it, the gate
maps media time to fixture time (`fixtureClock`) and evaluates exactly one loop starting at the first quiet slot
boundary ≥ 2 s after the first frame (`evalWindow`), so every event is inside the window exactly once.
`M5_DUMP=<file>` writes the codes, wrist samples, raw onset messages, window and the diag record for debugging.

## Gate real-pose (real MediaPipe on real swings)

`scripts/make_golfdb_fixture.py` (training venv python, `-I`; about 2 minutes, run automatically by the gate when the
fixture is missing) picks 6 GolfDB clips with a fixed rule: split 1 (held out from event-tcn-v1), real-time only
(`slow == 0`), the 3 lowest ids per view (face-on: 10, 29, 84; down-the-line: 33, 37, 55) with non-decreasing events.
Each is upscaled 160→720×720 (square: evfeat-1 normalises u and v separately), every frame kept and re-timed to exactly
30 fps, and written as H.264 MP4, VP9-in-MP4 and VP9 WebM plus `<id>.truth.json` (clip frame = events[k] − events[0],
Impact = events[6], `training/check_keypoints.py clip_events`) to `tests/fixtures/generated/golfdb/` (git-ignored:
GolfDB is CC BY-NC, never published). The WebM is not importable (the app demuxes with mp4box only).
Re-timing: GolfDB is 29.97 fps NTSC and the metric registry's `minFps: 30` is a strict `fps >= 30`, so at 29.97 every
tempo row is null `FPS_TOO_LOW` (first run of this gate). iPhone "30 fps" is exactly 30, so the gate uses 30; whether
29.97 should count as 30 is an open question for the metrics owner.

The gate imports each clip through 匯入影片 (角度 = the clip's view, 校正 = 不使用校正, model full), reads the saved
shot from IndexedDB and asserts: backswing_s / downswing_s / tempo_ratio non-null with ci95 on all 6; Impact within ±2
frames on ≥ 5/6 and Top within ±3 on ≥ 4/6; events from the TCN on every clip (`shot.algorithms.events.version`
`tcn+evfeat-1`, every `events.*.source` `tcn`); zero page errors and zero requests leaving 127.0.0.1. First passing run
(2026-11-04, Chromium, VP9 twin, GPU delegate): Impact 6/6 at +0 frames, Top 6/6 (four at 0, two at −1); tempo
3.25 / 3.13 / 2.88 / 4.50 / 3.22 / 3.50 vs truth 3.00 / 4.00 / 3.13 / 4.12 / 3.22 / 4.14 (the address event drives
the tempo error: TCN address PCE is 0.38, docs/training.md). About 80-130 s per clip on this machine.
The gate also found that tasks-vision 1.2.2 posts telemetry to `odml.pa.googleapis.com/v1/log` every 60 s;
`pose/landmarker.js blockForeignFetch` now refuses cross-origin fetches before MediaPipe loads.

TCN wiring: `workers/vision.worker.js` loads `app/models/event-tcn-v1.{json,bin}` once (fetch + `events/tcn.js
loadTcn`) and passes it to `analyzeClip` as `deps.tcn`; `pipeline/clip.js detectWithTcn` uses it for face_on / dtl
when ≥ 50 % of pose frames show a person and the decoded impact probability is ≥ 0.2, else (or on any TCN error) the
rules. `options.use_tcn = false` forces the rules. The source lands in `shot.events.*.source` and `shot.algorithms.events`.

## Browsers: Chromium H.264 and the WebKit (Safari) proxy

- Playwright's Chromium (chromium-1148) has no proprietary codecs: `VideoDecoder.isConfigSupported({codec:
  'avc1.64002A'})` is `false` (checked by m2, m2-shot and real-pose on every run), so those gates use the VP9-in-MP4
  twins and say so. H.264 is only exercised on WebKit / Safari / system Chrome.
- Gates `m1@webkit`, `screens@webkit`, `m2@webkit` (must decode the H.264 MP4) and `real-pose@webkit` (H.264 clips) run
  in Playwright 1.49.1 WebKit (webkit-2104, `npx playwright@1.49.1 install webkit`). On this machine (2026-11-04) WebKit
  does not launch: missing host packages `libwoff1`, `libevent-2.1-7t64`, `libavif16` (ldd: `libwoff2dec.so.1.0.2`,
  `libevent-2.1.so.7`, `libavif.so.16` not found). Installing them needs `sudo` (`playwright install-deps`), which is
  not done here, so those four gates are SKIP with exactly that reason (never PASS). After the owner installs the three
  packages they run with no code change.
- `scripts/make_fixtures.mjs` needs an ffmpeg with libx264 + libvpx-vp9: the venv's imageio-ffmpeg has both;
  Playwright's own `ffmpeg-1010` has only libvpx (VP8) and is not usable for fixtures.

## Gates added by the integration step

- `screens`: boot with 0 page errors and 0 console errors, then every screen from the UI (home -> venue / import / history /
  diag / settings / about and back, 開始練習 on the default fake camera -> setup -> live -> 結束練習, history import -> shot).
- `m2-shot`: the fixture clip through the import screen and 開始分析 -> results card; every metric row must be
  "value ± ci" or "—" with at least one Traditional Chinese reason. The fixture has no golfer and the import has no
  calibration, so today every row is an honest null (pose rows EVENTS_UNCERTAIN / POSE_LOW_VISIBILITY / registry codes,
  ball rows SETUP_UNVERIFIED); the numeric ball path in the browser is UNVERIFIED (it is covered in Node by synth_e2e).

## Gates of the foundation package (WP-A, 2026-11-05)

- `a-contracts` — drop 1 contracts (i18n, title/focus, components, error toast).
- `a-shell` — title + focus on all 10 screens, top stack vs sticky header in setup (scrolled 700 px), no horizontal
  scroll at `html { font-size: 200% }` on all 10 screens, tab bar (3 tabs ≥ 44 px, hidden on setup/live), CSP
  (0 `securitypolicyviolation`, cross-origin fetch probe blocked), error in a click handler → `role=alert` toast +
  diag `events()` ring, `indexedDB.open` that never settles → 重新載入 within 9 s and `#app-ready[data-repo="0"]`.
- `a-matrix` — the screenshot matrix above, all 264 states, 0 findings (200 % text included).
- `a-coldstart` — Fast-3G (562.5 ms RTT, 180 kB/s) + CPU ×4, no SW: `#app-ready` ≤ 6 s, `<link rel=modulepreload>` ≤ 30,
  no `capture/ import/ pipeline/ physics/ track/ vendor/` request before `#app-ready`.
- Shell hooks added: `#top-stack` (update banner, `#repo-banner`, `#session-bar`, `#health-prompts`), `#tabbar` with
  `tabbar-practice|history|settings` (`aria-current="page"` on the active one), `#boot-error` (start-up error state,
  `[data-boot="reload|unsaved|copy"]`), `#app-ready[data-repo="0|1"]`.
- CSP and Playwright: the app's CSP has no `'unsafe-eval'`, and Playwright's `page.waitForFunction` evaluates a polled
  predicate from a string. `lib.mjs` therefore replaces `waitForFunction` on every page it creates with a loop over
  `page.evaluate` (same arguments and timeout). Gates keep CSP on; never pass `bypassCSP`.

## Screen testids (integration, 2026-11-05)

Every `data-testid` in app/src, by screen (besides the ones in the tables above and the §8.0.12 list). A gate may rely
on any of them; renaming one is a contract change.

- Onboarding: `onb-next`, `onb-skip`, `onb-allow`, `onb-no-tripod`.
- Home: `home-context`, `home-venue`, `home-venue-sheet`, `home-venue-add`, `home-preset`, `home-view`, `home-club`,
  `home-mode`, `home-session`, `home-back-live`, `home-end`, `home-end-confirm`, `home-last`, `home-no-repo`.
- Venue / venues: `venue-step`, `venue-primary`, `venue-slope-status`, `venue-list`, `venue-row`, `venues-add`,
  `venue-rename-save`, `venue-delete`.
- Setup: `setup-step`, `setup-primary`, `setup-tripod`, `setup-view`, `setup-enable-level`, `setup-skip-level`,
  `setup-skip-ball`, `setup-fix`, `setup-anyway`, `setup-force`, `setup-mic-off`, `setup-sun-use`, `setup-clip-input`,
  `camera-off`, `camera-retry`, `camera-import-instead`, `health-done`, `droptest-done`.
- Live: `live-state`, `live-hero`, `live-count`, `live-club`, `live-club-sheet`, `live-last`, `live-end`,
  `live-end-confirm`, `live-reopen`.
- Import: `import-file-input`, `import-guide`, `import-settings`, `import-settings-done`, `import-view`, `import-calib`,
  `import-club`, `import-low-anyway`, `import-start`, `import-queue`, `import-steps`, `import-cancel`, `import-leave`,
  `import-error-card`, `import-error-another`, `import-error-noball`, `import-error-dismiss`, `import-next`,
  `import-open-shot`.
- Shot / replay: `shot-hero`, `shot-notices`, `shot-unmeasured`, `shot-mode`, `shot-star`, `shot-delete`, `shot-share`,
  `shot-leave`, `shot-import-next`, `shot-restore-original`, `glossary-sheet`, `replay-empty`, `replay-prev`,
  `replay-next`, `event-chips`, `event-chip`, `event-marker` (`role=slider`, `aria-valuenow` = frame), `event-set-frame`,
  `event-undo`, `event-reset`, `event-save`, `label-status`, `label-save`.
- History / compare / teach: `history-session`, `history-more-groups`, `history-more-rows`, `history-filter-view`,
  `history-filter-club`, `history-empty`, `history-empty-start`, `history-compare-toggle`, `history-compare-open`,
  `compare-sheet`, `history-export-json`, `history-export-csv`, `history-include-clips`, `history-import-input`,
  `history-restore-status`, `history-teach`, `teach-accept`, `teach-skip`, `teach-progress`, `teach-export` (writes one
  `golf-swing-lab-labels/1` file: pose sequences + labels, no video; read by `scripts/eval_owner_set.mjs` and
  `training/`), `teach-empty`, `undo-toast`, `undo-toast-undo`.
- Settings / trust: `settings-locale`, `settings-units`, `settings-theme`, `settings-hand`, `settings-height`,
  `settings-club`, `settings-club-length`, `settings-lie`, `settings-live-metrics`, `settings-voice`, `settings-venues`,
  `settings-storage`, `settings-privacy`, `settings-help`, `settings-about`, `settings-diag`, `settings-developer`,
  `storage-summary`, `storage-persist`, `storage-persisted`, `storage-evict`, `storage-backup`, `storage-cleanup`,
  `cleanup`, `privacy-delete-all`, `help-rerun-onboarding`, `help-diag`, `about-version`, `about-version-row` (7 taps
  reveal the Developer section; `dev-enabled-toast`), `about-events`, `about-privacy`, `about-licences`, `about-help`,
  `support-link`, `dev-off`, `dev-pose-model`, `dev-heavy-download`, `dev-spec-codes`, `dev-diag`, `model-status`,
  `model-import`, `model-json-input`, `model-bin-input`, `model-import-status`, `model-rollback`.
- Diagnostics: `diag-summary`, `diag-errors`, `diag-no-errors`, `diag-copy`, `diag-save`, `diag-refresh`.
