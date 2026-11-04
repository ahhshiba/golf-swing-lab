# Metrics by view, events and event features (v1, 2026-11-04)

Owner: events + metrics (`app/src/events/`, `app/src/metrics/`). The product spec is `docs/CAFCR.md` §F2 (the
table), §C1 (error budget), §K9, §P4, §R2; frames and types are in `docs/interfaces.md` §2, §4, §9. Behaviour is
defined by the code; this file explains it and must be updated with it.

## 1. Registry (CAFCR F2 as data)

`metrics/registry.js` holds one entry per metric id: `{ row, label_zh, unit, value_origin, views, minFps,
nullCode, fpsTiers?, depends?, runtimeCodes? }`. Cell values: `valid` (可), `estimated` (估), `low_confidence` (低),
`not` (不可). `cellFor(id, view, fps)` resolves a capture to `{ validity, code }`.

| F2 # | id | face_on | dtl | high_behind | min fps | null code (不可) |
|---|---|---|---|---|---|---|
| 1 | `backswing_s`, `downswing_s`, `tempo_ratio` | valid | valid | valid | 30 | — |
| 2 | `head_sway_x_m` | valid | not | low_confidence | 30 | VIEW_DEPTH_AXIS |
| 3 | `head_lift_z_m` | valid | valid | not | 30 | VIEW_DEPTH_AXIS |
| 4 | `head_depth_y_m` | not | valid | low_confidence | 30 | VIEW_DEPTH_AXIS |
| 5 | `spine_forward_tilt_deg` | not | valid | not | 30 | VIEW_PLANE_MISMATCH |
| 6 | `spine_side_tilt_deg` | valid | not | not | 30 | VIEW_PLANE_MISMATCH |
| 7 | `shoulder_turn_deg` | low_confidence | low_confidence | low_confidence | 30 | — |
| 8 | `hip_turn_deg` | low_confidence | low_confidence | low_confidence | 30 | — |
| 9 | `x_factor_deg` | low_confidence | low_confidence | low_confidence | 30 | — |
| 10 | `hand_plane_dev_m` | not | valid | not | 30 | VIEW_PLANE_MISMATCH |
| 11 | `top_shaft_angle_deg` | not | estimated | not | 120 | VIEW_PLANE_MISMATCH |
| 12 | `weight_shift_pct` | estimated | not | not | 30 | VIEW_DEPTH_AXIS |
| 13 | `early_extension_m` | not | valid | not | 30 | VIEW_DEPTH_AXIS |
| 14 | `club_speed_mps` | low_confidence (30–239 fps; computed from pose below 200 fps, §2b), estimated (>= 240, club-head track) | not | not | 30 | VIEW_DEPTH_AXIS |
| 15 | `club_path_deg` | not | not | low_confidence | 240 | VIEW_PLANE_MISMATCH (runtime: TRACK_TOO_SHORT) |
| 16 | `ball_speed_mps` | estimated | not | not | 200 | VIEW_DEPTH_AXIS (< 200 fps: FPS_TOO_LOW) |
| 17 | `launch_v_deg` | estimated | not | not | 200 | VIEW_DEPTH_AXIS (< 200 fps: FPS_TOO_LOW) |
| 18 | `launch_h_deg` | not | not | low_confidence | 200 | LAUNCH_DIR_UNOBSERVABLE |
| 19 | `carry_m` | estimated (needs 16, 17) | not | not | 200 | DEPENDS_ON_NULL |
| 20 | `smash_factor` | estimated (needs 14, 16) | not | not | 240 | DEPENDS_ON_NULL |

`tests/unit/metrics.registry.test.mjs` compares this cell by cell with an expected table written independently
from CAFCR, and that table with the markdown table in `docs/CAFCR.md`.

### Null precedence in `computeMetrics`

1. Cell `not` -> `not_observable` + the row's null code (`not_computed` for DEPENDS_ON_NULL rows).
2. `fps < minFps` -> `not_observable` + `FPS_TOO_LOW`.
3. Rows 14–20: face_on `club_speed_mps` below 200 fps is computed here from pose (§2b); every other allowed cell
   needs a ball / club-head track that `computeMetrics` does not receive -> `not_computed` + `TRACK_TOO_SHORT`,
   replaced by `pipeline/assemble.js` with the physics result (face_on rows 14 (≥ 200 fps), 16–20; high_behind 15,
   18; §2c, §2d). No allowed cell is `NOT_IMPLEMENTED` (tests: `metrics.compute`, `pipeline.assemble` "no allowed
   F2 cell returns NOT_IMPLEMENTED", synthetic-e2e gate "cells: no metric carries NOT_IMPLEMENTED").
4. Runtime: a needed event missing -> `not_computed` + `EVENTS_UNCERTAIN`; a needed landmark outside the image ->
   `occluded` + `OUT_OF_FRAME`; below visibility 0.3 -> `occluded` + `POSE_LOW_VISIBILITY`; x-factor with a null
   turn -> `DEPENDS_ON_NULL`; top shaft angle without any club-head observation -> `TRACK_TOO_SHORT` (was
   `DEPENDS_ON_NULL`: the missing input is a track, not a number); club observation not at the top ->
   `TRACK_TOO_SHORT`; outside the plausibility limits (`pose.js LIMITS`) -> `implausible` + `IMPLAUSIBLE_VALUE`;
   high_behind z-plane axis that is the depth axis at runtime (section 4.4) -> `not_observable` + `VIEW_DEPTH_AXIS`.

### Downgrades of a number (validity never better than the F2 cell)

| condition | effect |
|---|---|
| an event used has `conf < 0.5` | `low_confidence` + `EVENTS_UNCERTAIN` |
| mean visibility of the landmarks used < 0.5 | `low_confidence` + `POSE_LOW_VISIBILITY` |
| body depth from the leg-length prior (feet not on the mat / not visible) | at most `estimated` + `BODY_PLANE_ASSUMED` (displacements) |
| no calibration (nominal camera of the view) | `low_confidence` + `BODY_PLANE_ASSUMED` on every pose value (tempo unaffected) |
| downswing outside 0.15–0.6 s | tempo `low_confidence` + `TIMEBASE_SUSPECT`; outside 0.08–1.2 s (or backswing outside 0.3–3 s): implausible null |

Setup-level codes (`SETUP_UNVERIFIED`, `CALIB_STALE`, …) are never written here; the shot assembler adds them.

## 2. Metric definitions (rows 1–13)

All geometry is in the canonical right-handed mat frame M (`+x` target, `+z` up, golfer at `+y`); a left-handed
swing is mirrored through `y = 0` and its landmark labels swapped (section 6), so every sign below holds for both
handednesses. "Address window" = frames in `[t_address − 0.3 s, t_address]` (the still hold); "event window" =
frames within ±0.035 s of the event (3 frames at 30 fps, 5 at 60). Head = mid-point of the ears (7, 8); pelvis =
mid-hip (23, 24); hands = mid-wrist (15, 16); spine = mid-shoulder − mid-hip.

| id | definition | sign |
|---|---|---|
| `backswing_s` | `t_top − t_address` | |
| `downswing_s` | `t_impact − t_top` | |
| `tempo_ratio` | backswing / downswing | |
| `head_sway_x_m` | head x, top window − address window | + toward the target |
| `head_lift_z_m` | head z, impact window − address window | + up |
| `head_depth_y_m` | −(head y, impact − address) | + toward the ball |
| `spine_forward_tilt_deg` | `atan2(−s_y, s_z)` of the spine at address (projection on the y–z plane) | + toward the ball |
| `spine_side_tilt_deg` | `atan2(−s_x, s_z)` of the spine at address (projection on the x–z plane) | + away from target |
| `shoulder_turn_deg` | −Δ azimuth of the lead−trail shoulder line (11−12) in the horizontal plane, address -> top | + away from target |
| `hip_turn_deg` | same for the hip line (23−24) | + away from target |
| `x_factor_deg` | shoulder turn − hip turn (at the top) | |
| `hand_plane_dev_m` | distance of the hands at the top from the plane through the ball line (the x axis) and the hands at address: `(z_t·y_a − y_t·z_a)/hypot(y_a, z_a)` | + above the plane |
| `top_shaft_angle_deg` | `atan2(−s_y, s_x)` of the shaft (hands -> club head) at the top in the horizontal plane | + across the line (pointing right of target) |
| `weight_shift_pct` | 100 · (pelvis x, impact − address) / stance width (ankle 27 to ankle 28 along x at address) | + toward the target |
| `early_extension_m` | −(pelvis y, impact − address) | + toward the ball |

Event anchors: sway at the top (the classic backswing sway), lift / depth / weight shift / early extension at
impact, tilts at address, turns and the hand-plane distance at the top.

## 2b. Club-head speed from pose (row 14, face_on, 30–199 fps; `metrics/club.js`, `physics/clubspeed_pose.js`)

Two-segment model (lead arm + club, hub at the lead shoulder):
`v_head = v_hand,peak · c(fps) · K · (r + L) / r`.

- `v_hand,peak`: largest lead-wrist (canonical 15) chord speed with chord mid-time in impact − 0.12 s … + 0.02 s
  (impact = the detected / corrected event). The wrist is put on its viewing ray at one fixed camera depth (body
  depth + its MediaPipe depth offset at impact): near impact the face_on hand motion is in the x–z plane.
- `r`: median lead shoulder → wrist distance over the address frames (clamped 0.42–0.75 m, else prior 0.58 ± 0.05);
  `L` = club length (`club.length_m`, from the shot's club or the category default), ± 5 cm.
- `K = 1.9` (± 12 % 1σ): published hand-speed vs club-speed figures (lead-hand peak 7–10 m/s at club speeds
  36–50 m/s, ratio 4.8–5.5 for drivers with r ≈ 0.58, L ≈ 1.12) give ≈ 1.8; the two-segment downswing model of
  `tests/synth/cells.js` gives 1.96 (SD 11 %).
- `c(fps)`: chord bias (K6 median correction): 0.97 at 30 fps (a 33 ms chord averages over the peak), 0.87 at
  60 fps (max of noisy, motion-blurred chords reads high); from a synthetic sweep independent of the gate (seed 7).
- σ (relative, rss): K 12 %, chord residual 8 % / 5 %, landmark noise √2·σ_pos / chord, lever (r, L). ci95 half
  width = max(25 %, 1.96 σ) of the value (F2 "±25 %"). Validity `low_confidence` always; outside 10–65 m/s ->
  `implausible`. At ≥ 200 fps the club-head track estimate of `physics/club.js` is used instead (估).
- Known, unmodelled biases (UNVERIFIED until owner clips with a launch monitor): MediaPipe's temporal smoothing of
  fast hands (reads the peak low → club speed low), motion blur at 1/60 s exposures, the release pattern of the
  individual golfer (K), hands far out of the body-plane depth. The synthetic swing of `tests/synth/swing.js` is
  not used for accuracy: its hands nearly stop at impact; `tests/synth/cells.js clubSpeedSwing` replaces the lead
  arm near impact with the two-segment model.
- Synthetic gate (scripts/synth_e2e.mjs, 15 swings at 30 fps + 15 at 60 fps, full assembleShot incl. event
  detection): median |err| 10.2 %, P90 18.6 %, 30/30 inside the ci95.

## 2c. Club path at impact (row 15, high_behind, ≥ 240 fps; `physics/clubpath.js`, `physics/ground.js`)

- Club-head observations (track `clubTrack`) mapped onto the ground through the calibrated camera (the mat
  homography) at the assumed head-centre height 2.5 cm (C1.3: 0–5 cm). A constant plane height does not change
  ground directions (homothety about the camera foot); its variation along the path (attack angle) and the camera
  side offset do, and enter the systematic term below.
- Samples within ±0.15 m (ground x) of the impact point = resting-ball centre − 4 cm along x (head centre behind
  the ball at contact); total-least-squares direction; < 2 samples (or < 2 distinct frames) -> `not_computed` +
  `TRACK_TOO_SHORT` (C1.3: at 40 m/s and 240 fps only 1–2 samples fall in the window).
- Arc correction: the chord is the tangent at the samples' mean position s̄; the horizontal projection of the swing
  arc has curvature κ ≈ cos(plane)/radius (prior 0.35 ± 0.08 /m), so `path = chord + κ·s̄`.
- Sign: canonical frame, `path = atan2(−v_y, v_x)`, + = in-to-out (toward −y, away from the golfer, while moving to
  the target); a left-handed swing is mirrored through y = 0 (tested to give the identical value).
- σ / ci95: Monte Carlo (600 draws, seeded): pixel noise 1.5 px per sample (blurred head, C1.3 1.0–1.5°/px), mat
  solve ground-direction error (yaw about the ball spot, σ from the four corners at 3 px, `groundDirSigmaDeg`,
  ≈ 0.27°), head height U(0, 5 cm) with attack U(±5°) (plane assumption), κ prior. ci95 = 2.5–97.5 % of the draws.
  The camera more than 0.15 m off the ball line (C1.3 red light): the plane term grows with it and the assembler
  adds `SETUP_UNVERIFIED` (setup-level, downgrades the affected metrics).
- Synthetic gate (30 shots, path −6…+6°, mat corners 3 px, 1.5 px head noise, samples before and after impact):
  30/30 reported, median |err| 0.98°, P90 2.40°, ci95 coverage 96.7 %.
- Limit: `track/club.js` currently tracks the head only BEFORE impact, so on real clips many shots will have < 2
  samples in the window (TRACK_TOO_SHORT) until the tracker follows the head through impact.

## 2d. Horizontal launch direction (row 18, high_behind, ≥ 200 fps; `physics/launch_h.js`)

- The ball rises while it flies away, so the ground projection is not used; the full 3D flight is fitted with the
  fit3d machinery (known start from the resting-ball ray, free v0 and t0, gravity + drag / lift priors, rolling
  shutter, ball size). fit3d's plane initialisation is degenerate for this camera, so it starts from a grid of
  launch velocities (35 / 55 / 75 m/s × 10 / 20 / 30°, ψ = 0) and keeps the lowest χ². Speed and vertical launch
  of this fit are weakly determined from behind and are NOT reported (rows 16, 17 stay 不可 here).
- `ψ = atan2(−v_y, v_x)` canonical: + = away from the golfer = right of target for a right-hander (the same sign
  convention as club path: + in-to-out); left-handed mirrored. face_on row 18 stays `not_observable`
  (`LAUNCH_DIR_UNOBSERVABLE`, F2).
- σ = rss(fit covariance × Student-t factor, mat-solve ground-direction σ (1:1), 0.15° model term: side-spin
  curvature over the first ~0.05 s and start placement). ci95 = ± 1.96 σ. A separate roll term from
  `pose_sigma.roll_deg` is not added: the synthetic calibration-induced ψ error (SD 0.27°) equals the ground σ alone.
  Validity `low_confidence`; `ROLLING_SHUTTER_ASSUMED` when the readout is not measured; residual RMSE > 1.5 px ->
  `DEPTH_DRIFT_SUSPECT`; implausible fit or |ψ| > 30° -> `implausible`.
- Synthetic gate (30 shots, ψ −8…+8°, spin axis tilted ±20°, mat corners 3 px): median |err| 0.22°, P90 0.49°,
  coverage 96.7 %.

## 3. Event times feed tempo with a quantisation interval

Each event time carries a half-width `h = (0.5 / fps) / max(min(conf, 1), 0.25)` s (±0.5 frame for a sure event,
up to ±2 frames when `conf <= 0.25`). With the top error shared by both phases:
`backswing ∈ [B − h_a − h_t, B + h_a + h_t]`, `downswing ∈ [D − h_t − h_i, D + h_t + h_i]`,
`ratio ∈ [(B − h_a − h_t)/(D + h_t + h_i), (B + h_a + h_t)/(D − h_t − h_i)]`. This is the `ci95` (a worst-case
bound, `sigma = null`). For B = 0.8 s, tempo 3.0 and conf 1 it gives 2.556–3.571 (30 fps), 2.765–3.267 (60 fps),
2.938–3.063 (240 fps): the F2 note's 2.56–3.57 / 2.77–3.27 / 2.94–3.06.

## 4. Geometry: putting 2D landmarks back in 3D

### 4.1 Per-landmark depth model

Every landmark `j` in frame `i` is placed on its own viewing ray (calibration camera, `geom/camera.js`) at the
camera-frame depth `Z_ij = Z_hip + wz_ij`, where `wz_ij` is the MediaPipe world-landmark z (depth offset from the
hip centre, camera-aligned, smoothed over 0.15 s) and `Z_hip` is the camera depth of the hip centre at address.
This keeps the perspective right: in face_on the camera is shifted 0.4 m toward the target and the shoulders are
~0.3 m nearer the camera than the hips, which alone would bias a same-plane side-tilt estimate by ~4°.

`Z_hip` comes from the feet's ground contact through the mat calibration: for the six foot landmarks (ankles 27/28
at 0.075 ± 0.012 m, heels 29/30 at 0.032 ± 0.008 m, toes 31/32 at 0.022 ± 0.006 m above the mat, foot flat at
address) the viewing ray is intersected with the horizontal plane at the prior height; `Z_hip = Z_ground − wz_foot`.
Per landmark the median over the address window, then an inverse-variance mean; each landmark's sigma combines the
height prior and a 3 px landmark error (`LANDMARK_SIGMA_PX`). Because the priors are shared, the result keeps at
least half the mean per-landmark sigma. Its relative sigma scales every displacement (CAFCR C1.1 "誤套平面":
±3 cm -> ±0.9 %).

**BODY_PLANE_ASSUMED**: when fewer than two foot landmarks are usable or a ground point falls outside the mat
(+0.15 m margin; `venue` fields of interfaces §2, defaults 1.50 × 1.25 m, ball 0.30 m from the edge), `Z_hip` comes
from the apparent leg length (hip -> knee -> ankle) against `LEG_LENGTH_M = 0.80 m` ± 10 % (a height prior).
Without any calibration, the nominal camera of the view is used, ±15 %, everything `low_confidence`.

### 4.2 Turns: segment on two rays (face_on perspective bias corrected)

The lead and trail ends of a segment (shoulders 11/12, hips 23/24) are put on their own rays with the mid-point at
the depth model's depth and the 3D length `L` fixed: `Z_a = Z_mid + δ`, `Z_b = Z_mid − δ`, `|P_a − P_b| = L` is a
quadratic in `δ`; of its two roots the one nearer the world-z half-difference wins (no real root: closest
approach). `L` = median 3D length over the address window (face_on, where the line is parallel to the image) or
the median MediaPipe world distance (dtl, high_behind). The turn is the change of the horizontal azimuth.

CAFCR C1.1 notes that the face-on shoulder-width ratio has a perspective bias of −1° at 45° and −10° at 90°. We do
not use the width ratio: the two ends' depth difference is modelled explicitly, so that bias is removed (choice:
**correct**, not widen). On synthetic swings with 75–100° shoulder turns the face_on median absolute error is 1.9°
(30 fps) / 2.8° (60 fps) with no systematic bias (median signed error −0.1° / +0.3°). The interval still uses the
upper end of the pose-model angle error (6°) plus the measured jitter plus the sensitivity to a 5 % error in `L`.

### 4.3 Top shaft angle (dtl, >= 120 fps)

Needs a club-head observation (track module, `{frame, t_s, u, v, conf}`) within 1.5 frames of the top. The club
head is put on its ray at the distance `club.length_m − 0.10 m` from the hands (prior 0.88 ± 0.07 m when the club
length is unknown), on the root farther from the camera (the shaft points toward the target at the top).

### 4.4 high_behind

The target line is close to the depth axis. Head sway along x and depth along y are read on the horizontal plane
at the address head height (the head height is assumed constant: ±3 cm, `HEAD_Z_ASSUMED_M`, propagated through the
ray direction). With the camera at 1.7 m and the head at ~1.55 m the ray to the head is nearly horizontal, so the
assumption alone gives far more than 10 cm along x: that axis is returned as `VIEW_DEPTH_AXIS` whenever the
assumption sigma exceeds `ZPLANE_MAX_SIGMA_M = 0.1 m`. In the nominal landscape framing (aimed at the ball,
vertical FOV 41.7°) the head and shoulders are above the image (the frame top is ~1.2 m high at the golfer), so
rows 2, 4, 7 and 9 are `OUT_OF_FRAME` / `DEPENDS_ON_NULL`; hip turn and tempo are computed.

## 5. Error model (sigma, 1σ; ci95 = value ± 1.96σ unless noted)

| quantity | terms (root-sum-square) |
|---|---|
| angles (tilts, turns, shaft) | pose model 3° / 4.5° / 6° for valid / estimated / low_confidence (C1.1 "角度 ±3–6°"), window jitter / √n, calibration roll σ (1:1 on both tilts), 0.23·pitch σ (dtl forward tilt, C1.2), turns: + sensitivity to `L` × 1.05, shaft: + club-length and 2 px sensitivities |
| displacements | 2 % / 3.5 % / 5 % of the value (C1.1 "位移 ±2–5%"), landmark floor 1.0 / 1.5 / 2.5 cm (UNVERIFIED), window jitter, body-depth relative sigma × value; high_behind: + head-height assumption |
| weight shift (%) | the same displacement terms divided by the stance width (scale cancels in the ratio) |
| x-factor | rss of the two turn sigmas |
| tempo | section 3 (bound, no sigma) |

## 6. Handedness

A left-handed golfer stands at `−y`. The left-handed setup is the right-handed one mirrored through the plane
`y = 0`: with `S = diag(−1, 1, 1)` and `M = diag(1, −1, 1)` the mirrored camera is `R' = S R M`, `t' = S t` (a
proper rotation), and for a mirrored point `X' = M X`: `R' X' + t' = S (R X + t)`, so `u' = W − u` (principal
point at `W/2`, radial `k1` symmetric). Hence:

- **features**: for `handedness = 'left'`, `x_norm -> 1 − x_norm` and every left/right landmark pair is swapped
  (`LR_PAIRS`), which turns the left-handed image into the right-handed one;
- **metrics**: rays are cast with the real (left-handed) camera, the 3D points mirrored `y -> −y`, labels swapped.

On synthetic data a left-handed swing and its right-handed mirror give the same features (|Δ| < 1.5e-5, float32
rounding of `1 − x`), the same event times (< 1e-8 s) and the same metrics (|Δ| < 5e-5).

## 7. Event features v1 (`FEATURE_VERSION = 'evfeat-1'`)

Input: a PoseSeq (`t_s` float64 seconds, `img` float32 `T × 33 × 4` = `x_norm, y_norm, z, visibility`, `W`, `H`)
and `handedness`. Output: `K × 12` float64, row-major.

1. **Resample** to `t_k = t_s[0] + k / 30`, `k = 0..K−1`, `K = floor((t_s[T−1] − t_s[0]) · 30 + 1e-9) + 1`
   (`K = 1` if `T = 1`). For each `t_k` take the bracketing input interval `i` (advance `i` while
   `i < T − 2 and t_s[i+1] < t_k`), `w = (t_k − t_s[i]) / (t_s[i+1] − t_s[i])` (0 if the times are equal), clamped
   to `[0, 1]`, and every channel `a + w·(b − a)` (float32 inputs promoted to float64).
2. **Canonicalise**: if left-handed, permute landmarks by `LR_SWAP` (pairs 1↔4, 2↔5, 3↔6, 7↔8, 9↔10, 11↔12, 13↔14,
   15↔16, 17↔18, 19↔20, 21↔22, 23↔24, 25↔26, 27↔28, 29↔30, 31↔32; the value of canonical `j` is the resampled value
   of landmark `LR_SWAP[j]`) and replace `x_norm` by `1 − x_norm`. Then `u = x_norm · W`, `v = y_norm · H`.
3. **Torso length** `L` = median over the `K` rows of `|mid(11,12) − mid(23,24)|` in pixels (numpy median); if
   `L <= 1e-6`, `L = 0.25 · H`.
4. With `hip = mid(23,24)`, `wr = mid(15,16)` per row:

| # | name | formula |
|---|---|---|
| 0 | `wrist_x` | `(wr.u − hip.u) / L` |
| 1 | `wrist_y` | `−(wr.v − hip.v) / L` |
| 2 | `wrist_vx` | `numpy.gradient(wrist_x, 1/30)` (central differences, first-order edges; 0 if `K = 1`) |
| 3 | `wrist_vy` | `numpy.gradient(wrist_y, 1/30)` |
| 4 | `wrist_speed` | `hypot(wrist_vx, wrist_vy)` |
| 5 | `lead_wrist_h` | `−(v15 − hip.v) / L` |
| 6 | `trail_wrist_h` | `−(v16 − hip.v) / L` |
| 7 | `shoulder_angle` | `numpy.unwrap(atan2(−(v11 − v12), u11 − u12))` rad |
| 8 | `hip_angle` | `numpy.unwrap(atan2(−(v23 − v24), u23 − u24))` rad |
| 9 | `lead_elbow` | `atan2(|a × b|, a · b)`, `a = p11 − p13`, `b = p15 − p13` (pixels) rad |
| 10 | `trail_elbow` | same with 12, 14, 16 |
| 11 | `vis_mean` | mean visibility of landmarks 11, 12, 13, 14, 15, 16, 23, 24 |

Golden: `tests/fixtures/evfeat-1.golden.json` holds a 45-frame 60 fps input with ±2 ms timestamp jitter and the
features for both handednesses (22 rows). The independent numpy implementation below reproduces both to 9e-16
(checked with the training venv's numpy; tolerance for ports: 1e-5). The training module should copy it into its
own tests and compare against the golden file.

```python
import numpy as np
PAIRS = [(1,4),(2,5),(3,6),(7,8),(9,10),(11,12),(13,14),(15,16),(17,18),(19,20),(21,22),
         (23,24),(25,26),(27,28),(29,30),(31,32)]
SWAP = list(range(33))
for a, b in PAIRS: SWAP[a], SWAP[b] = b, a

def evfeat1(t_s, img, W, H, handedness='right', hz=30.0):
    t_s = np.asarray(t_s, np.float64)
    img = np.asarray(img, np.float32).astype(np.float64).reshape(len(t_s), 33, 4)
    T = len(t_s)
    K = 1 if T == 1 else int(np.floor((t_s[-1] - t_s[0]) * hz + 1e-9)) + 1
    tg = t_s[0] + np.arange(K) / hz
    out = np.empty((K, 33, 4)); i = 0
    for k in range(K):
        if T == 1: out[k] = img[0]; continue
        while i < T - 2 and t_s[i + 1] < tg[k]: i += 1
        ta, tb = t_s[i], t_s[i + 1]
        w = min(1.0, max(0.0, (tg[k] - ta) / (tb - ta) if tb > ta else 0.0))
        out[k] = img[i] + w * (img[i + 1] - img[i])
    if handedness == 'left':
        out = out[:, SWAP, :]; out[:, :, 0] = 1.0 - out[:, :, 0]
    u, v, vis = out[:, :, 0] * W, out[:, :, 1] * H, out[:, :, 3]
    hu, hv = (u[:, 23] + u[:, 24]) / 2, (v[:, 23] + v[:, 24]) / 2
    su, sv = (u[:, 11] + u[:, 12]) / 2, (v[:, 11] + v[:, 12]) / 2
    L = np.median(np.hypot(su - hu, sv - hv))
    if not L > 1e-6: L = 0.25 * H
    wx = ((u[:, 15] + u[:, 16]) / 2 - hu) / L
    wy = -((v[:, 15] + v[:, 16]) / 2 - hv) / L
    vx = np.gradient(wx, 1 / hz) if K >= 2 else np.zeros(K)
    vy = np.gradient(wy, 1 / hz) if K >= 2 else np.zeros(K)
    def ang(a, b, c):
        ax, ay, cx, cy = u[:, a] - u[:, b], v[:, a] - v[:, b], u[:, c] - u[:, b], v[:, c] - v[:, b]
        return np.arctan2(np.abs(ax * cy - ay * cx), ax * cx + ay * cy)
    return tg, np.stack([wx, wy, vx, vy, np.hypot(vx, vy), -(v[:, 15] - hv) / L, -(v[:, 16] - hv) / L,
        np.unwrap(np.arctan2(-(v[:, 11] - v[:, 12]), u[:, 11] - u[:, 12])),
        np.unwrap(np.arctan2(-(v[:, 23] - v[:, 24]), u[:, 23] - u[:, 24])),
        ang(11, 13, 15), ang(12, 14, 16), vis[:, [11, 12, 13, 14, 15, 16, 23, 24]].mean(axis=1)], axis=1)
```

GolfDB carries no handedness label; the training side must pass `handedness` per clip (or assume right and accept
the left-handed clips as noise).

## 8. Rule-based events (`events/rules.js`, the K9 baseline)

Runs on the canonical image landmarks resampled at `clamp(native fps, 30, 60)` Hz; time constants in seconds, speeds
in torso lengths per second (0.3 ≈ 0.15 m/s for a 0.5 m torso). Output `t_s` is the sub-frame estimate, `frame` the
nearest PoseSeq frame; both non-decreasing (a violation is clamped and its conf capped at 0.2).

| event | rule | conf |
|---|---|---|
| (swing) | fastest smoothed (0.1 s) wrist sample; none above 3 L/s -> no swing, all events null, conf 0 | |
| top | back from that sample past the descent (< −1 L/s) to the last rising -> falling zero crossing of the wrist height velocity; refined by a shared-apex fit of wrist x and y with separate deceleration / acceleration parabolas (`c + a·min(0,t−t_a)² + b·max(0,t−t_a)²`, ±0.2 s, grid dt/10) | 0.85 (0.4 if no crossing: height max) |
| impact | audio onset in `[top + 0.08, top + 0.8] s` if given; else lowest raw wrist height in `(top, top + 0.8]` with a parabolic sub-frame vertex | 0.95 audio, 0.75 (0.35 at a window edge) |
| address | still run before the backswing (whole-body speed < 0.3 L/s, 0.2 s smoothing, landmarks with vis >= 0.5 per frame), then the motion onset: every visible landmark of {11–16, 23–26} and image axis fitted with `c + A·max(0, t − t0)²` over the still run + up to 0.3 s / 0.1 L of motion; `t0` = grid point (dt/10) with the smallest total residual | 0.85 (0.45 if the still run < 0.3 s, 0.35 fallback) |
| finish | first hold >= 0.7 s after impact + 0.15 s (P4 FINISH); the stop time is fitted the same way backwards (landmarks + head 0/7/8 + trail foot 28/30/32) | 0.8 (0.4 / 0.25 if no 0.7 s hold) |
| mid_backswing / mid_downswing | lead arm horizontal: lead wrist crosses the lead shoulder height (image) going up / down | 0.6 (0.3 fallback: 55 % / 60 % of the phase) |
| toe_up | face_on: lead forearm direction turned 45° from address (shaft-horizontal proxy); other views: 62 % of address -> mid_backswing | 0.4 / 0.3 |
| mid_follow_through | 10 % of impact -> finish (the forearm proxy was late on synthetic data) | 0.3 |

All confidences except an audio impact are multiplied by `clamp(vis_mean / 0.8, 0.3, 1)`. Consumers treat
`conf < 0.5` (`EVENT_CONF_MIN`) as `EVENTS_UNCERTAIN`.

`events/detect.js`: `detect(poseSeq, { useTcn, tcn })` uses the TCN only when `useTcn` is true and a predictor
`{ predict(features) -> probs[T][9] }` (classes 0–7 = events, 8 = background, SwingNet convention) is supplied; an
output of the wrong shape or with non-finite values falls back to the rules. Decoding maximises
`Σ log(p[f_e][e] + 1e-9)` subject to `f_0 <= … <= f_7` (dynamic programming, O(8·T)). An audio onset between the
decoded top and finish replaces the TCN impact (conf 0.95). high_behind has no GolfDB data: rules only (R1).

## 9. Live state machine (`events/live.js`, CAFCR P4)

Input: 10 Hz wrist samples in the body plane `{ type: 'wrist', t_s, x_m, y_m, vis }` and audio onsets
`{ type: 'audio', t_s }`, fed in time order. Speeds: 0.1 s differences for SWING / peak, 0.2 s differences for
stillness.

`IDLE -> ADDRESS` still (< 0.15 m/s) for >= 0.5 s · `ADDRESS -> SWING` > 1 m/s (back to IDLE after 1.5 s of
fidgeting) · `SWING -> IMPACT` speed below half of its peak · `IMPACT -> FINISH` still for >= 0.7 s, emits a `shot`
and returns to IDLE · timeout 4 s after the swing starts.

Classification at FINISH: an audio onset within ±0.3 s of the wrist-speed peak -> `swing` (impact = onset, conf
0.9). Otherwise a real-swing profile (peak >= 2.5 m/s at 10 Hz, hand rise >= 0.45 m, backswing 0.35–2.5 s) ->
`swing` with impact = wrist peak, conf 0.5, `AUDIO_UNAVAILABLE` (no microphone) or `EVENTS_UNCERTAIN` (microphone
on, nothing heard); a rise >= 0.2 m -> `practice`; less -> `motion_ignored`. Audio in IDLE / ADDRESS (neighbour)
-> `audio_ignored`. A full-speed practice swing with the microphone on and no sound is therefore reported as a low
confidence `swing` (open issue, owner decision).

## 10. Synthetic validation (`tests/synth/swing.js`)

Parametric golfer: stature 1.65–1.88 m, stance 0.34–0.48 m, spine forward tilt 30–45°, side tilt 3–12°, backswing
0.7–1.0 s, tempo 2.4–3.6, shoulder turn 75–100°, hip turn 30–55°, head sway −8…+1 cm at the top, head lift −5…+3
cm and depth −2…+6 cm at impact, pelvis shift / early extension, club head 34–42 m/s at impact, shaft angle at the
top 255–285° in plane ± 10° out of plane. Rendered through the nominal camera of the view (setup jitter yaw / pitch
0.5°, roll 0.3°) at 1080p; calibration = true camera + 0.15° / 1 cm / 0.3 % f error. Noise: 2 px i.i.d. + 1 px
AR(1) (ρ 0.85) + motion blur 0.1 × per-frame displacement (≤ 10 px) + 15 px when out of frame (MediaPipe-style
extrapolation, visibility 0.02–0.15); world landmarks ± 3 cm per frame + 1.5 cm per-joint bias. Ground truth
events: address = motion start, top = arm reversal, impact = club at the ball, finish = motion end, toe_up /
mid_follow_through = shaft horizontal, mid_backswing / mid_downswing = lead arm horizontal.

Results (40 swings per view and fps, every 4th left-handed; `node --test tests/unit/`):

| view @ fps | address / top / impact / finish within 1 frame at 30 Hz | tempo median abs error | key metric median abs error |
|---|---|---|---|
| face_on @ 30 | 97.5 / 100 / 100 / 100 % | 0.090 | side tilt 0.31°, head sway 0.3 cm |
| face_on @ 60 | 100 / 100 / 100 / 100 % | 0.051 | side tilt 0.29°, head sway 0.2 cm |
| dtl @ 30 | 100 / 100 / 100 / 95 % | 0.080 | forward tilt 0.30°, early extension 0.7 cm |
| dtl @ 60 | 100 / 100 / 100 / 100 % | 0.082 | forward tilt 0.18° |
| high_behind @ 30 | 95 / 100 / 100 / **82.5 %** | **0.161** | hip turn 4.0° |
| high_behind @ 60 | 92.5 / 100 / 100 / **80 %** | 0.098 | hip turn 2.5° |

Live (5 sessions of 10 real + 5 practice swings + 10 neighbour sounds): recall 10/10, 0 false triggers each.

## 11. Known limits

- The synthetic world is idealised: the real pose model's jitter, its temporal smoothing lag and its behaviour
  outside the frame are assumptions (UNVERIFIED until the M3 owner clips). high_behind events rely on the wrists
  and shoulders the nominal framing cuts off.
- `top_shaft_angle_deg` needs the track module's club-head observations at >= 120 fps near the top; no app path
  produces them yet (`track/club.js` tracks the head only just before impact), so in the app the cell is
  `TRACK_TOO_SHORT` until a top-of-swing club-head detector exists.
- Where `NOT_IMPLEMENTED` still appears legitimately: `contract/shot.js emptyMetrics()` placeholders (always
  replaced by the assembler before validation) and `pipeline/clip.js`, which only reads the code. No metric of an
  assembled shot carries it.
- The rules give no TCN-like probabilities; conf values are heuristic.
