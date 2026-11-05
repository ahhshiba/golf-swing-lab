# App architecture (v1, 2026-11-04)

Companion to `docs/interfaces.md` (pure modules) and `docs/CAFCR.md` (spec; process ids P0–P19, steps C0–C10).
This file fixes the contracts between the three app-layer owners so they can work in parallel.

## 1. Owners

| Owner | Paths |
|---|---|
| **app-core** | `app/index.html`, `app/manifest.webmanifest`, `app/styles/`, `app/icons/`, `app/src/main.js`, `app/src/state.js`, `app/src/ui/`, `app/src/session/`, `app/sw.template.js`, `scripts/build.mjs`, `scripts/make_icons.mjs` |
| **media** | `app/src/capture/`, `app/src/sensors/`, `app/src/audio/`, `app/src/import/`, `app/src/pose/`, `app/src/workers/`, `app/src/pipeline/` |
| **devtools** | `app/src/diag/`, `scripts/check-sw.mjs`, `scripts/check_device_report.mjs`, `scripts/make_fixtures.mjs`, `scripts/make_y4m.py`, `tests/e2e/`, `tests/fixtures/media/` (generated media is git-ignored under `tests/fixtures/generated/`), `package.json` devDependencies (Playwright 1.49.1 only) |

## 2. Screens (no URL routing)

One page; screens switch by app state only (never `location.hash`, `history.*`). Each screen root has
`data-screen="<id>"`. Ids: `home`, `venue` (P1 wizard), `setup` (P3), `live` (P4), `import` (P5), `shot`
(results card + replay + event correction, P6), `history` (P7), `diag` (P11), `settings`, `about`
(licences: MediaPipe Apache-2.0, mp4box BSD-3, GolfDB CC BY-NC attribution).
When boot finishes, `main.js` adds an element `<div id="app-ready" hidden>` (end-to-end tests wait for it).
Language: Traditional Chinese UI. Phone-first: safe-area insets, `100dvh`, no hover-only affordances,
inputs ≥16px font, `touch-action: manipulation`, large tap targets (≥44px).

## 3. Session controller (app-core, `app/src/session/controller.js`)

- `startPractice()` must be called **synchronously from the click handler** of 「開始練習」. Order (P2):
  `DeviceMotionEvent.requestPermission?.()` is invoked first, before any `await`; then
  `capture.openCamera()` (one getUserMedia with video+audio; `gum_calls` counter), `AudioContext.resume()`,
  Wake Lock. Each result is recorded into the diagnostic report.
- Then P3 setup (calib live solve on frames from `capture.frameTap`), lock (C9) → P4 live loop or P5 import.
- P16 angle change, P17 interruptions (track ended → prompt re-open, counted), P18 thermal guard
  (latency p95 > 12 s or drops > 10 % → downgrade full→lite and halve sampling; mark `THERMAL_DEGRADED`).
- Persists venues/presets/sessions/shots through `app/src/store/` (IndexedDB backend).

## 4. Media APIs (media owner)

```
capture/camera.js   openCamera({width=1920,height=1080,frameRate=60,facingMode='environment',audio=true})
                      -> {stream, videoTrack, audioTrack, settings}; closeCamera(); getGumCalls()
capture/recorder.js createSegmentRecorder(stream, {mimeType?}) -> {start(), cut() -> Promise<Blob>, stop()}
capture/frametap.js createFrameTap(videoEl, {fps, roi: () => {x,y,w,h}, maxWidth=384, onFrame(bitmap, t_media_s, meta)})
                      (requestVideoFrameCallback when available, else rAF; transfers ImageBitmap)
sensors/gravity.js  requestMotionPermission() (sync-call-safe), startGravity(onSample) -> stop
audio/onset.js      startOnsetDetector(audioCtx, stream, {onOnset(t_s, level)}) (AudioWorklet onset.worklet.js)
import/probe.js     probeFile(file) -> {codec, width, height, rotation, sample_count, effective_fps, vfr, cts_s[]}
import/decode.js    decodeFile(file, {onFrame(frame: VideoFrame|ImageBitmap, t_s, index), from_s?, to_s?, signal?})
                      WebCodecs + mp4box demux; fallback <video> seek + rVFC (sets TIMESTAMPS_NOMINAL if CTS missing)
pose/landmarker.js  createPoseLandmarker({model:'lite'|'full'|'heavy', delegate:'GPU'|'CPU'}) with GPU→CPU fallback,
                      local wasm/model paths only (app/vendor/mediapipe/wasm, app/models/*.task)
pipeline/clip.js    analyzeClip(file, {view, calibration, club, handedness, venue}) -> golf-shot/1 (runs in worker)
pipeline/live.js    live per-swing analysis from the frame tap (lite pose at 10 Hz idle, full rate inside a swing)
```

## 5. Worker protocol (`app/src/workers/vision.worker.js`, module worker)

Main → worker | Worker → main
---|---
`{type:'init', delegate:'GPU'}` | `{type:'ready', delegate, models:[...]}` or `{type:'error', code}`
`{type:'pose', id, bitmap, t_s, model}` (bitmap transferred) | `{type:'pose_result', id, t_s, img:Float32Array(132), world:Float32Array(99), ms}`
`{type:'analyze_clip', id, file, options}` | `{type:'progress', id, stage, frac}` … `{type:'clip_result', id, shot, timings_ms}`
`{type:'cancel', id}` | `{type:'cancelled', id}`
any failure | `{type:'error', id, code, message}` (codes are upper-snake strings, shown via a Chinese message table)

All bitmaps/frames are `close()`d immediately after use; ring buffer ≤ 6 s × 384 px.

## 6. Diagnostic report (`app/src/diag/report.js`, devtools owner)

`buildReport()` → JSON `{schema:'gsl-device-report/1', app_version, created_at, ua, standalone, sw_controlled,
precache_complete, storage:{persisted, usage, quota}, webcodecs:{avc1, hevc}, media_recorder:{types[]},
gum:{calls, requested_fps, actual_fps, width, height}, motion:{permission, available, same_click},
pose:{delegate, lite_ms_p50, full_ms_p50}, live:{latency_p95_s, frames_dropped_pct, detections, touches_per_shot},
import:{last:{effective_fps, decoded, sample_count, hevc}}, setup:{durations_s:{C0..C10}, total_s, view},
calibration:{…last}, thermal:{degraded}}`. Every module that measures something calls
`diag.record(path, value)`. `scripts/check_device_report.mjs report.json --milestone M1|M2|M2b|M4|M4b|M5|M6`
applies the CAFCR R6 device thresholds and exits non-zero on failure (missing field = FAIL, never PASS).

## 7. Build and service worker (app-core)

`scripts/build.mjs [--dev]` copies `app/` → `dist/`, writes `dist/sw.js` from `app/sw.template.js` with
`VERSION = <package.json version>+<first 10 hex of sha256 over the precache list contents>` and the precache list.
Two caches: `gsl-shell-<VERSION>` (replaced whole) and `gsl-assets` (large files with content-hash URLs, kept
across versions: wasm, .task models). Precache budget ≤ 35 MB, shell ≤ 1 MB (fail the build otherwise).
New version → in-app banner 「有新版本，點此更新」; never reload during a practice session.
`scripts/check-sw.mjs` (devtools) re-computes the hash from `dist/`, checks every precached file exists, and
FAILs if precache contents changed but the semver did not (compares with `deploy/last-deploy.json` when present).

## 8. Product round 2026-11 (PRODUCT-SPEC.md; foundation drop 1)

- Ownership for this round is PRODUCT-SPEC §8 (packages A–F), which supersedes §1 above where they differ.
- i18n + units: docs/i18n.md. Design system, components, icons, focus/title rules: docs/design-system.md.
- main.js boot order: settings (gsl-settings-v2, v1 migrated) → theme → `initI18n` → icon sprite → static
  `data-i18n` text → store/navigator → optional modules → repository → screens. App object additions (§8.0.4):
  `app.t`, `app.toast`, `app.units()`, `app.locale()`, `app.screenTitle(id)`, `app.applyTheme(theme)`,
  `app.errors.report(err, ctx)` / `app.errors.log()` / `app.errors.onReport(fn)`, `app.offline` (placeholder until platform provides it).
  Global `error` / `unhandledrejection` handlers report through `app.errors`.
- Build: catalogs merged into `dist/i18n/<locale>.json`; comments stripped from `src/**/*.js` and `styles/**/*.css`
  (line numbers kept; `--keep-comments` turns it off). Package semver 0.2.0.

### 8.1 Shell after WP-A (2026-11-05)
- Boot order: `boot-watchdog.js` (classic, parser-blocking, first in `<head>`: pre-boot error capture, 8 s watchdog →
  start-up error state from `<template id="boot-fallback">`, catalog preload for the user's locale in a build) →
  `main.js`: global `error`/`unhandledrejection` handlers → settings/theme → i18n → sprite → repository (5 s timeout,
  `REPO_UNAVAILABLE` → `#repo-banner`; sessionStorage `gsl.boot.unsaved=1` = "continue without saving") → first screen
  (home; home hosts onboarding and marks its root `.is-onboarding`, which hides the tab bar) → `#app-ready` → then the
  media/devtools layers (`OPTIONAL`), the session controller (`app.controller` is a proxy that queues early calls),
  `requestPersist`, service-worker registration.
- Screens are imported and mounted on first show (`SCREEN_MODULES` in main.js, mount gets `(root, app, { header: true,
  onBack })`); setup, live, import, diag, teach, developer wait for `app.ready()` first. Sub-screens (state.js
  `SUB_SCREENS`): venues (ui/venues.js `mountVenues`), teach (ui/teach.js `mountTeach`), privacy/help/licences/developer
  (ui/settings.js `mountPrivacy|mountHelp|mountLicences|mountDeveloper`). A module missing from the build
  (`version.js PRESENT_MODULES`) renders a "not part of this version" state instead of a 404.
- Tab bar (Practice · History · Settings) = `nav.root(screen)` (fresh stack `[home]`). `--topbar-h` / `--tabbar-h` are
  written by main.js (ResizeObserver); screen CSS pins bottom actions at `calc(… + var(--tabbar-h))`.
- Errors: `app.errors.report(err, ctx)` → diag `logEvent()` (D's 200-entry ring, `gsl.diag/2`) + `errors.last` +
  `onReport` sinks + `toast.error` (into the screen's `[data-error-slot]` when it has one) unless `ctx.silent`.
- Build: default has no event model; `--include-golfdb-model` = dev research (`dev_research: true`, deploy refuses it).
  Generated `src/version.js` (`APP_VERSION` = precache VERSION, outside the hash). `<link rel=modulepreload>` for the
  static graph of `BOOT_ENTRIES`. Comments and indentation are stripped from JS/CSS (line numbers kept).
- Integration (2026-11-05, §8.7 step 3): the `dom.js` `toast()` alias is gone (components `toast.info` / `toast.error`);
  verify.sh runs `check_i18n --strict` and `check_tokens --strict` (0 CJK literals in app/src); `app.offline` is the
  updater's precache tracker; History and Settings are reached through the tab bar only. The build squeezes shipped
  JS/CSS whitespace (line numbers kept) and never copies source-only files (`events/calib-conf.json`,
  `vendor/manifest.json`).
