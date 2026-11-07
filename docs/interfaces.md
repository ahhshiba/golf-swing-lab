# Interfaces and conventions (v1, 2026-11-04)

Every module agent reads this file first. It is the contract between modules that are built in parallel.
If something here is wrong or missing, do not silently deviate: implement the closest compliant thing and
report the gap. The product spec is `docs/CAFCR.md` (Traditional Chinese); section names below refer to it.

## 1. Code rules

- Plain ES modules (`.js`, `"type":"module"`), no bundler, **no runtime npm dependencies**. Code under `app/src/`
  must run unchanged in Safari (iOS 17+) and in Node 18.19 for tests.
- Pure modules (`geom, calib, physics, track, events, metrics, contract, store/core`) must not touch `window`,
  `document`, `navigator`, `self`, DOM, timers or randomness. Randomness is passed in as a seeded PRNG
  (`app/src/geom/rng.js`, `mulberry32(seed)`), so every test is deterministic.
- Forbidden in `app/src/**`: `location.hash`, `history.pushState`, `history.replaceState`, any hard-coded
  `http://` or `https://` URL (vendor files are local), `eval`, `new Function`.
- Each module directory has `index.js` that re-exports its public API. Import by relative path with extension
  (`../geom/camera.js`).
- Numbers: SI units (m, s, m/s, rad internally; degrees only at report/UI boundaries, named `*_deg`).
  Use `Float64Array` or plain arrays for math.
- Tests: `tests/unit/<module>.<topic>.test.mjs` using `node:test` and `node:assert/strict`. Run all with
  `node --test tests/unit/`. Synthetic data generators live in `tests/synth/` (they may also be imported by
  `scripts/*.mjs` gates). Tests must finish in < 60 s per file.
- Comments and identifiers in English; user-facing strings (reason-code descriptions, UI) in Traditional Chinese.

## 2. Frames and units

**World frame M (venue mat frame)**, right-handed, metres:
- origin = the *ball spot*: the ground point under the resting ball (all clubs use the same spot, ±10 cm);
- `+x` = toward the target, along the mat long edge;
- `+z` = up (gravity is `-z`, `G = 9.80665`);
- `+y = z × x` = toward a right-handed golfer. A left-handed golfer stands at `-y`; geometry stays in this
  same frame, and `metrics/` mirrors with `handedness`.

**Mat** (venue fields `mat_L` along x, `mat_W` along y, `ball_edge_m` default 0.30, `ball_x_m` default 0):
the ball spot is `ball_edge_m` from the long edge on the `-y` side and `ball_x_m` from the mat x-centre.
Corners in M (z = 0), named by side (`t` trail = `-x`, `l` lead = `+x`) and edge (`n` near = `-y`, `f` far = `+y`):
```
tn = (-mat_L/2 - ball_x_m, -ball_edge_m)        ln = (+mat_L/2 - ball_x_m, -ball_edge_m)
tf = (-mat_L/2 - ball_x_m, mat_W - ball_edge_m) lf = (+mat_L/2 - ball_x_m, mat_W - ball_edge_m)
```
Corner arrays are always ordered `[tn, ln, lf, tf]`.

**Camera** (OpenCV pinhole): camera frame `+x` right, `+y` down, `+z` forward; `Xc = R·Xw + t`, centre
`C = -Rᵀ t`. `K = [[f,0,cx],[0,f,cy],[0,0,1]]`, square pixels, zero skew, principal point fixed at the image
centre (`cx = W/2`, `cy = H/2`, not estimated). Optional radial `k1` on normalised coordinates:
`xd = x·(1 + k1·r²)`.
**Image coordinates**: `u` right, `v` down, pixels, continuous, origin at the top-left *corner* of the image;
pixel `(i, j)` has its centre at `(i + 0.5, j + 0.5)`.

Camera object (plain JSON, produced by `geom/camera.js`):
```
{ W, H, f, cx, cy, k1: 0, R: [9 numbers row-major], t: [3], readout: { ms: 3.0, axis: 'u'|'v', dir: +1|-1 } }
```
`geom/camera.js` exports `makeCamera`, `project(cam, X) -> {u, v, z}`, `projectMany`, `ray(cam, u, v) -> {C, d}`
(unit `d` in world), `center(cam)`, `lookAt(C, target, up, rollRad)`, `eulerFromR` / `rFromEuler`
(view-relative yaw/pitch/roll, see §6), `fFromHfov(W, hfovDeg)`.

**Rolling shutter.** A detection at `(u, v)` in a frame with timestamp `t_frame` (time at which readout passes
the image centre) happened at
`t = t_frame + (readout.ms / 1000) · dir · (s / S − 0.5)`, where `s = u, S = W` for `axis 'u'` and
`s = v, S = H` for `axis 'v'`. `physics/shutter.js` owns the mapping from `screen.orientation` + view to
`{axis, dir}`; until measured, `ms = 3.0`, `readout_source = 'assumed'`, reason code `ROLLING_SHUTTER_ASSUMED`.

**Time.** Seconds of media time (container CTS). If CTS is missing or non-monotonic, fall back to
`frame / nominal_fps` and add `TIMESTAMPS_NOMINAL`.

## 3. Constants (`app/src/geom/constants.js`)

`G = 9.80665`, `BALL_D = 0.04267`, `BALL_R = 0.021335`, `BALL_MASS = 0.04593`, `AIR_RHO = 1.204`
(20 °C sea level), `IPHONE_HFOV_1080P240_DEG = 68.161`, `DEFAULT_READOUT_MS = 3.0`, `TEE_LIFT_PRIOR_M = 0.030`,
`TEE_LIFT_PRIOR_SIGMA_M = 0.015`.

## 4. Data types

**Ball observation** (from `track/`):
`{ frame, t_s, u, v, w_px, h_px, r_px, area, peak }` — `w_px` = horizontal width of the blob, `r_px` = radius from
the blob minor axis (motion blur stretches the major axis), `peak` = max background difference.
**Track**: `{ obs: Observation[], gaps: number, n: number }` (sorted by `t_s`).

**Club-head observation**: `{ frame, t_s, u, v, conf }`.

**PoseSeq** (from `pose/` worker; tests use `tests/synth/swing.js`):
```
{ t_s: Float64Array(T), img: Float32Array(T*33*4)  // per landmark: x_norm, y_norm, z, visibility (MediaPipe order)
  world: Float32Array(T*33*3), W, H, model: 'lite'|'full'|'heavy'|'synthetic' }
```
Landmark indices follow MediaPipe BlazePose-33 (0 nose … 11/12 shoulders, 13/14 elbows, 15/16 wrists,
23/24 hips, 25/26 knees, 27/28 ankles, 29/30 heels, 31/32 foot index).

**Events** (GolfDB order): `EVENTS = ['address','toe_up','mid_backswing','top','mid_downswing','impact',
'mid_follow_through','finish']`. EventSet: `{ [name]: { frame, t_s, conf, source: 'rules'|'tcn'|'manual' } }`.
Frames must be non-decreasing in this order.

**Metric value** (every number shown to the user):
```
{ value: number|null, unit, ci95: [lo, hi]|null, sigma: number|null,
  validity: 'valid'|'estimated'|'low_confidence'|'occluded'|'ambiguous'|'dropped'|'stale'|'not_observable'|
            'implausible'|'not_computed',
  value_origin: 'pose'|'ball_fit3d'|'ball_fit2d'|'club_track'|'ballistics'|'derived'|'manual',
  measured: false, reason_codes: string[] }
```
Invariants (enforced by `contract/validate.js`): `value !== null ⇔ validity ∈ {valid, estimated, low_confidence}`;
`value === null ⇒ reason_codes.length > 0`; `value !== null ⇒ ci95 !== null || sigma !== null`; every code is
defined in `contract/reason-codes.js` (codes only: `REASON_CODE_LIST`, `REASON_CODES`/`RC` = `{ NAME: 'NAME' }`) and has
a Traditional Chinese description in the zh-Hant catalog, `reason.<NAME>.long` (`app/i18n/zh-Hant/reason.json`).
Helper: `contract/metric.js` exports `metricValue({...})`, `metricNull(validity, codes, unit)`.

**Calibration** (from `calib/`), exactly the `calibration{…}` object of CAFCR §F3:
```
{ method: 'mat_pnp'|'club_line'|'ball_only', source: 'live'|'clip', f_px, f_locked,
  pose: { yaw_deg, pitch_deg, roll_deg, X_m, Y_m, h_m, D_m }, pose_sigma: { same keys },
  reproj_rmse_px, slope_deg, preset_dev: { same keys as pose, or null }, readout_ms,
  readout_source: 'assumed'|'measured', camera: <camera object> }
```
(`camera` is the full camera object so downstream code never re-derives it.)

**Shot** `golf-shot/1`: CAFCR §F3, JSON Schema in `schema/shot-v1.schema.json`. `club` is
`{ type, length_m, lie: 'mat'|'tee', tee_lift_m, tee_lift_source: 'measured'|'assumed' }`.

## 5. Views

`view ∈ {'face_on', 'dtl', 'high_behind'}`. Nominal geometry (CAFCR §C2):
- `face_on`: camera at `(+shift, -D, h)` looking along `+y` (optical axis ⊥ target line), landscape,
  `D = 2.7`, `h = 0.84`, `shift = 0.4` (camera moved toward target, not rotated).
- `dtl`: camera on the mat centre line extension behind the ball, at `(-Db, y_hands, 1.0)` with
  `Db = 3.0–3.5`, `y_hands ≈ 0.35` (mat centre line), looking along `+x`, portrait.
- `high_behind`: camera on the ball line at `(-Db, 0, h)` with `Db = 2.75–3.0`, `h ≈ 1.7`, aimed at the ball,
  landscape; lateral offset |y| ≤ 0.15.

## 6. View-relative pose report

`calib` reports `pose{yaw_deg, pitch_deg, roll_deg}` relative to the view's nominal axis: yaw = rotation about
world `z` away from the nominal optical-axis heading (positive = counter-clockwise seen from above), pitch =
elevation of the optical axis above horizontal (positive = up; high_behind is negative ≈ −30°), roll = rotation
about the optical axis (positive = clockwise as seen by the camera, i.e. image content rotates counter-clockwise).
`X_m, Y_m, h_m` = camera centre in M; `D_m` = horizontal distance from camera centre to the ball spot.
`geom/camera.js` owns `eulerFromR(R, view)` and `rFromEuler({yaw, pitch, roll}, view)` and their tests.

## 7. Ownership (write only inside your paths)

| Owner | Paths |
|---|---|
| geom | `app/src/geom/`, `tests/unit/geom.*` |
| contract | `app/src/contract/`, `schema/`, `tests/unit/contract.*`, `docs/contract.md` |
| calib | `app/src/calib/`, `tests/unit/calib.*`, `tests/synth/mat.js`, `scripts/synth_calib.mjs` |
| physics | `app/src/physics/`, `tests/unit/physics.*`, `tests/synth/ballflight.js` |
| track | `app/src/track/`, `tests/unit/track.*`, `tests/synth/render.js` |
| events+metrics | `app/src/events/`, `app/src/metrics/`, `tests/unit/events.*`, `tests/unit/metrics.*`, `tests/synth/swing.js`, `docs/metrics-by-view.md` |
| store | `app/src/store/`, `tests/unit/store.*` |
| scaffold | `scripts/verify.sh`, `scripts/devserve.py`, `README.md`, `docs/device-checklist.md`, `docs/setup-guide.md` |
| vendor | `scripts/vendor.mjs`, `app/vendor/`, `app/models/` (downloaded files), `docs/ADR/0001-vendor.md` |
| training | `training/`, `~/.local/share/golf-swing-lab-venv` |
| app shell (later) | `app/index.html`, `app/manifest.webmanifest`, `app/sw.template.js`, `app/styles/`, `app/icons/`, `app/src/{main.js,ui,capture,sensors,import,pose,audio,diag,workers}`, `scripts/{build.mjs,check-sw.mjs}`, `tests/e2e/` |

## 8. Safety rules for every agent

- Do not commit or push; do not create GitHub repos; do not run `tailscale serve` (owner approval pending).
- Do not touch other projects' virtual environments or directories on the development machine. Reading the
  monocular tracker in `baseball-digital-twin-demo` (`tools/monocular/mono/*.py`, `src/fielding.js`) for porting
  is allowed.
- Downloads go into their own empty directory; run Python that reads downloaded data with `-I`.
- No Ultralytics (AGPL), no OpenCV.js. GolfDB is CC BY-NC: personal, non-commercial use only.

## 9. Reason codes and metric ids (shared, fixed)

User-visible text for codes, metric ids, clubs, views and events comes from the catalogs (docs/i18n.md §4); pure
modules return codes / `{ code, params }`, never prose. Codes added in the 2026-11 round: RC `NO_CALIBRATION`,
`CLIP_NOT_SAVED`, `SLOWMO_CORRECTED`; error codes in `APP_ERROR_CODES` (contract/reason-codes.js).


Reason codes live in `app/src/contract/reason-codes.js` (already written; owned by contract). Import
`{ RC }` and always write `RC.TRACK_TOO_SHORT`, never a bare string, so `scripts/check_contract.mjs` can check them.
If you need a code that is missing, use the closest existing one and list the request in your report.

Metric ids (CAFCR §F2 row → id, unit). `metrics/registry.js` owns the per-view validity table; the schema uses
exactly these keys:

| F2 # | id | unit |
|---|---|---|
| 1 | `backswing_s`, `downswing_s`, `tempo_ratio` | s, s, ratio |
| 2 | `head_sway_x_m` (along target line) | m |
| 3 | `head_lift_z_m` (vertical) | m |
| 4 | `head_depth_y_m` (toward/away from ball) | m |
| 5 | `spine_forward_tilt_deg` | deg |
| 6 | `spine_side_tilt_deg` | deg |
| 7 | `shoulder_turn_deg` | deg |
| 8 | `hip_turn_deg` | deg |
| 9 | `x_factor_deg` | deg |
| 10 | `hand_plane_dev_m` (hand path vs shaft plane at address) | m |
| 11 | `top_shaft_angle_deg` | deg |
| 12 | `weight_shift_pct` (pelvis lateral shift, % stance width, proxy) | % |
| 13 | `early_extension_m` (pelvis toward ball, address→impact) | m |
| 14 | `club_speed_mps` | m/s |
| 15 | `club_path_deg` (+ = in-to-out) | deg |
| 16 | `ball_speed_mps` | m/s |
| 17 | `launch_v_deg` | deg |
| 18 | `launch_h_deg` (+ = right of target for a right-hander) | deg |
| 19 | `carry_m` | m |
| 20 | `smash_factor` | ratio |
| 21 | `attack_angle_deg` | deg |
| 22 | `dynamic_loft_deg` | deg |
| 23 | `face_angle_deg` | deg |
| 24 | `face_to_path_deg` | deg |
| 25 | `spin_loft_deg` | deg |
| 26 | `spin_rate_rpm` | rpm |
| 27 | `spin_axis_deg` | deg |
| 28 | `total_m` | m |
| 29 | `carry_side_m` | m |
| 30 | `total_side_m` | m |
| 31 | `curve_m` | m |
| 32 | `apex_m` | m |
| 33 | `landing_angle_deg` | deg |
| 34 | `hang_time_s` | s |

Rows 21–34 are golf-shot/2 (docs/LAUNCH-MONITOR-SPEC.md §1.2, §2; frozen interfaces in docs/LM-INTERFACES.md). A
golf-shot/1 record has exactly the ids of rows 1–20; contract/migrate.js appends rows 21–34 as `not_computed` +
`MIGRATED_V1`. RC added for golf-shot/2: `DPLANE_MODEL`, `SPIN_MODELLED`, `SPIN_LOFT_ASSUMED`, `FLIGHT_MODELLED`,
`ROLL_MODELLED`, `SMASH_ASSUMED`, `LAUNCH_V_ASSUMED`, `CROSS_VIEW_PRIOR`, `MIGRATED_V1`.

### 9.x WP-A shell additions (2026-11-05)
- `state.js`: `SUB_SCREENS`, `ALL_SCREENS`, `TABS`, `TABBAR_HIDDEN`, `tabOf(screen, prevTab)`, `nav.root(screen)`.
- `app.ready()` → Promise (late layers + controller loaded); `app.build` = `{ version, semver, id, devResearch,
  bundledEventModel }` from `src/version.js` (About: `${semver} · build ${id}`); `app.version()` never returns "dev"
  in a build.
- Lints: `node scripts/check_i18n.mjs [--pkg B|practice …] [--strict]`, `node scripts/check_tokens.mjs [--strict]`;
  verify stages `tokens`, `i18n` (always `--strict` since the integration commit: any finding in any package FAILS, 0 CJK literals in app/src), `event-conf`
  (`scripts/check_event_conf.mjs`, SKIP until it exists). `static` also forbids `innerHTML`, `insertAdjacentHTML`,
  `outerHTML =`, `document.write` in app/src (XML namespace URIs are exempt from the URL ban).
