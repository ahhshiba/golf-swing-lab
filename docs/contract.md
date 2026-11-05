# golf-shot/1 result contract

Owner: `contract` module. Files: `app/src/contract/` (code), `schema/shot-v1.schema.json` (JSON Schema 2020-12),
`tests/fixtures/shots/` (fixtures), `scripts/check_contract.mjs` (the `contract` stage of `scripts/verify.sh`).
Spec: `docs/CAFCR.md` "F3 per-shot contract" and "F2 view x metric table"; shared ids: `docs/interfaces.md` section 4 and 9.

The contract exists for two key drivers: **KD2** every number carries its uncertainty, **KD9** the whole metric set always
has an answer: a number with `ci95` or `sigma`, or an honest null with a reason code. Nothing in the app may show a
number that did not pass through `metricValue` / `metricNull` and `validateShot`.

## 1. Shot object

All keys are required unless marked optional. Unknown keys are rejected at every level (typos must not slip through).

| Field | Type | Notes |
|---|---|---|
| `schema` | `"golf-shot/1"` | Breaking changes mean a new schema id, never a silent edit. |
| `shot_id`, `session_id` | non-empty string | |
| `venue_id`, `preset_id` | string or `null` | `null` = ad-hoc setup, nothing saved. |
| `created_at` | ISO-8601 date-time with timezone | The contract never reads a clock; the caller passes it in. |
| `app_version` | non-empty string | `semver+hash` from the build. |
| `algorithms` | `{pose, events, calib, ball, fit3d, carry}` | each `{version: string, sha256: 64 lowercase hex}`. |
| `capture` | see below | |
| `calibration` | see below | Exactly the `calibration{...}` object of CAFCR F3 plus the full `camera`. |
| `club` | `{type, length_m, lie, tee_lift_m, tee_lift_source}` | `lie` mat or tee, `tee_lift_source` measured or assumed; `length_m` 0.5 to 1.5, `tee_lift_m` 0 to 0.15. |
| `handedness` | `right` or `left` | No default: a wrong guess silently mirrors every angle. |
| `events` | the 8 GolfDB events | each `{frame: int >= 0, t_s: number >= 0, conf: 0..1, source: rules, tcn or manual}`. |
| `metrics` | object with exactly the 22 ids of section 3 | each a Metric value (section 2). |
| `quality` | `{pose_mean_vis, frames_analyzed, frames_dropped, audio_onset, touches, warnings}` | `pose_mean_vis` 0..1 or null until pose ran; `audio_onset` seconds or null; `warnings` is a list of reason codes. |
| `starred` | boolean | |
| `note` | string, at most 4000 chars | |
| `revision` | integer >= 0 | 0 for a fresh shot; see section 6. |
| `history` | optional array | one entry per human correction (section 6). |

`capture`: `mode` (`live` or `highspeed`), `view` (`face_on`, `dtl`, `high_behind`), `source` (`camera` or `import`),
`orientation` (`screen.orientation.type` value, or `unknown` for an import without rotation metadata), `width`,
`height` (integers >= 1), `nominal_fps`, `effective_fps` (> 0, the second measured from container timestamps), `vfr`
(boolean), `timestamps` (`container`, or `nominal` when `frame / nominal_fps` replaced unusable container times),
`clip_ref` (string or null), `trim_s` (null or `[start_s, end_s]` with `0 <= start < end`).

`calibration`: `method` (`mat_pnp`, `club_line`, `ball_only`), `source` (`live`, `clip`), `f_px` (> 0), `f_locked`,
`pose` and `pose_sigma` (`yaw_deg, pitch_deg, roll_deg, X_m, Y_m, h_m, D_m`; sigmas >= 0), `reproj_rmse_px` (>= 0, or
null when the method has no mat corners), `slope_deg` (null when not measured), `preset_dev` (same keys as `pose`, or
null without a preset), `readout_ms` (>= 0), `readout_source` (`assumed`, `measured`) and `camera` (the camera object
of interfaces.md section 2: `W, H, f, cx, cy, k1, R[9], t[3], readout{ms, axis, dir}`).

## 2. Metric value and invariants

```
{ value: number|null, unit, ci95: [lo, hi]|null, sigma: number|null,
  validity, value_origin, measured: false, reason_codes: string[] }
```

`validity` is one of `valid, estimated, low_confidence` (these carry a number) or `occluded, ambiguous, dropped, stale,
not_observable, implausible, not_computed` (honest nulls). `value_origin` is one of `pose, ball_fit3d, ball_fit2d,
club_track, ballistics, derived, manual`. `measured` is always `false`: this app never claims a launch-monitor reading.

| # | Invariant | Validator message contains | Schema |
|---|---|---|---|
| I1 | `value !== null` if and only if validity is `valid`, `estimated` or `low_confidence` | `requires a value` / `means no value` | yes |
| I2 | `value === null` implies `reason_codes` is non-empty | `requires at least one reason code` | yes |
| I3 | `value !== null` implies `ci95 !== null` or `sigma !== null` | `requires ci95 or sigma` | yes |
| I4 | `ci95 = [lo, hi]` has `lo <= hi` and `lo <= value <= hi` | `exceeds upper bound` / `is outside ci95` | no |
| I5 | `value === null` implies `ci95 === null` and `sigma === null` (no leftover uncertainty on a null) | `must be null when value is null` | yes |
| I6 | every reason code exists in `REASON_CODES` (each has `reason.<CODE>.short/long/fix` in both catalogs; the zh-Hant `.long` is its Traditional Chinese description); a list has no duplicates | `unknown reason code` / `duplicate reason code` | yes (enum, uniqueItems) |
| I7 | `unit` equals the fixed unit of the metric id (section 3) | `for this metric` | yes |
| I8 | `sigma >= 0`; `measured === false` | `sigma must be` / `measured must be false` | yes |

I5, I7 and I8 go beyond the F3 text on purpose: a null that still carries a CI, or a number in the wrong unit, is the
kind of silent lie the contract exists to stop. `estimated` and `low_confidence` may have an empty `reason_codes` (several
F2 cells say "low" without a code).

Builders (throw `ContractError` on any violation, so an invalid Metric cannot be created):

- `metricValue({value, unit, ci95?, sigma?, validity, value_origin, reason_codes?})`
- `metricNull(validity, codes, unit, value_origin = 'derived')` (`codes` is one code or an array)
- `downgrade(metric, code)`: new metric with `code` appended; a metric with a number becomes `low_confidence`, a null keeps
  its null validity (it has no number to downgrade, and `low_confidence` would break I1).

## 3. Metric ids (fixed)

`metrics` holds exactly these keys; the schema and the validator reject missing and extra ids. The registry
(`metrics/registry.js`) decides per view whether each one is a number or a null; the contract only fixes the shape.

| F2 # | id | unit | placeholder `value_origin` |
|---|---|---|---|
| 1 | `backswing_s`, `downswing_s`, `tempo_ratio` | s, s, ratio | pose, pose, derived |
| 2 | `head_sway_x_m` | m | pose |
| 3 | `head_lift_z_m` | m | pose |
| 4 | `head_depth_y_m` | m | pose |
| 5 | `spine_forward_tilt_deg` | deg | pose |
| 6 | `spine_side_tilt_deg` | deg | pose |
| 7 | `shoulder_turn_deg` | deg | pose |
| 8 | `hip_turn_deg` | deg | pose |
| 9 | `x_factor_deg` | deg | derived |
| 10 | `hand_plane_dev_m` | m | pose |
| 11 | `top_shaft_angle_deg` | deg | pose |
| 12 | `weight_shift_pct` | % | pose |
| 13 | `early_extension_m` | m | pose |
| 14 | `club_speed_mps` | m/s | club_track |
| 15 | `club_path_deg` | deg | club_track |
| 16 | `ball_speed_mps` | m/s | ball_fit3d |
| 17 | `launch_v_deg` | deg | ball_fit3d |
| 18 | `launch_h_deg` | deg | ball_fit3d |
| 19 | `carry_m` | m | ballistics |
| 20 | `smash_factor` | ratio | derived |

The placeholder origin is only used by `emptyMetrics()` / `newShot()` for `not_computed` nulls; the module that fills a
metric sets the real origin.

## 4. Warnings attribution rule (CAFCR F3)

Whole-setup conditions go into `quality.warnings`, and every **affected** metric repeats them. A condition about one
metric only goes into that metric's `reason_codes` and never into `quality.warnings`.

- **Setup-level codes**: `SETUP_UNVERIFIED`, `CALIB_STALE`, `PRESET_MISMATCH`, `NO_GRAVITY_REF` (`SETUP_LEVEL_CODES`).
  Other codes (for example `TIMESTAMPS_NOMINAL`, `THERMAL_DEGRADED`, `TRACK_MAY_BE_SHORT`) may appear in `quality.warnings`
  too, but carry no attribution duty.
- **Affected metric** (`isAffectedBySetup(id, metric)`): the ball and club-head metrics F2 #14-20 (`club_speed_mps,
  club_path_deg, ball_speed_mps, launch_v_deg, launch_h_deg, carry_m, smash_factor`) **or** any metric whose
  `value_origin` depends on the calibrated geometry: `ball_fit3d`, `ball_fit2d`, `club_track`, `ballistics`
  (`CALIBRATION_ORIGINS`). Pose-origin metrics (including those in metres) are not covered; a pose metric that really
  uses the ball/club geometry must be tagged with the matching origin.
- **Duty**: for every setup-level code `c` in `quality.warnings` and every affected metric **that has a number**, the
  metric has `validity === 'low_confidence'` and `c` in its `reason_codes`. Affected metrics that are null are exempt:
  there is no number to qualify, and their own reason code already explains the null.
- **Reverse direction**: a setup-level code found in any metric's `reason_codes` (null metrics included) must also be in
  `quality.warnings`; otherwise the whole-shot condition was recorded in the wrong place.
- Validator messages: `does not repeat it in reason_codes`, `must be downgraded to low_confidence`,
  `missing from quality.warnings`.

Helpers that apply the rule for you: `attributeWarnings(shot)` (idempotent) and `addWarning(shot, code)`.

## 5. Other cross-field checks (validator only)

- **Events**: all 8 present; `frame` and `t_s` non-decreasing in GolfDB order (`non-decreasing` in the message); equal
  values are allowed.
- **Camera**: `cx = W/2`, `cy = H/2` (principal point fixed at the centre), `R` is a proper rotation (via
  `geom/linalg.js` `isRotation`, tolerance 1e-6), `calibration.f_px == camera.f`, `calibration.readout_ms ==
  camera.readout.ms`.
- **History**: revisions strictly increasing and lower than the shot's `revision`.

JSON Schema cannot express I4, the attribution rule, event order, the camera checks or the history order; everything else
in `validate.js` is also in the schema, and `tests/unit/contract.schema.test.mjs` checks that the two agree (enum lists,
metric ids and units, and a 360-combination truth table for the metric invariants).

## 6. Revisions (P6)

`bumpRevision(shot, patch, {at?})` returns a **new** shot (the input is never modified) with `revision + 1` and `patch`
deep-merged (objects merge key by key, arrays and scalars replace, `undefined` is ignored). The values the patch replaced
are kept: `history` gets `{revision: <old revision>, at, before: {<top-level key>: <whole old value of that key>}}`, so the
first automatic result stays recoverable after any number of corrections. `schema, shot_id, session_id, created_at,
revision, history` cannot be patched. It throws `ContractError` if the patch introduces a validation error (for example
non-monotonic event frames, "reject on save"), but problems the shot already had do not block it.

## 7. Using the module

```js
import { RC, metricValue, metricNull, newShot, validateShot, assertValid, addWarning, bumpRevision } from '../contract/index.js';
const carry = metricValue({ value: 181, unit: 'm', ci95: [160, 202], validity: 'estimated', value_origin: 'ballistics',
                            reason_codes: [RC.SPIN_ASSUMED] });
const none = metricNull('not_observable', [RC.LAUNCH_DIR_UNOBSERVABLE], 'deg', 'ball_fit3d');
```

`newShot({...})` fills `schema`, `revision: 0`, `starred: false`, `note: ''`, `venue_id/preset_id: null`, a default `quality`
and every metric id as `not_computed` + `NOT_IMPLEMENTED`; it does not validate. Call `validateShot` (returns `{ok,
errors:[{path, msg}]}`) or `assertValid` before storing or exporting; an import with errors is refused.

Always write codes as `RC.NAME`, never as a string: `scripts/check_contract.mjs` fails on unknown `RC.*` names and on any
quoted string in `app/src` that equals a code name (outside `reason-codes.js`).

## 8. Fixtures and the contract stage

`tests/fixtures/shots/`: `valid_*.json` (face-on 240 fps with ball data, down-the-line 30 fps pose only, high-behind 240
fps, a shot with `SETUP_UNVERIFIED` + `NO_GRAVITY_REF` attributed, a corrected revision with history) and `bad_*.json`,
each a valid shot with exactly one change. A bad fixture carries `"_expect": "<substring of 'path: msg'>"` (and
`"_expect_errors": N` if it intentionally breaks N rules). Keys starting with `_` are stripped before validation.
`node tests/fixtures/shots/_build.mjs` regenerates all of them (raw objects, independent of the builders).

`node scripts/check_contract.mjs` (exit code = number of problems) checks: fixtures behave as declared (at least 3 valid
covering all views, at least 8 bad); every `RC.NAME` in `app/src/**/*.js` exists; no stray quoted code names; every code
has a Traditional Chinese description (the zh-Hant catalog's `reason.<CODE>.long`: CJK present, no Simplified-only
characters from a small list); the schema parses,
mentions each metric id exactly once and its enums and units match `enums.js` and `reason-codes.js`.

## 9. How to add a reason code

1. Add `'NAME'` to `REASON_CODE_LIST` in `app/src/contract/reason-codes.js` (UPPER_SNAKE_CASE; `REASON_CODES`/`RC` are
   derived), and `NAME.short`, `NAME.long`, `NAME.fix` to `app/i18n/zh-Hant/reason.json` and `app/i18n/en/reason.json`
   (the zh-Hant `.long` is the contract's description; no prose in the JS file, PRODUCT-SPEC §3.4).
2. Add `"NAME"` to `$defs.reasonCode.enum` in `schema/shot-v1.schema.json` (the unit test and the check fail until you do).
3. Use it as `RC.NAME` only. If it describes the whole setup (should be repeated on affected metrics), also add it to
   `SETUP_LEVEL_CODES` in `enums.js` and to section 4 above.
4. Run `node --test tests/unit/ && node scripts/check_contract.mjs`.

Never rename or delete a code: stored shots refer to it. Retire it in the description instead. Adding a metric id or
changing a field's meaning is a schema change: bump to `golf-shot/2`, keep a migration for stored `golf-shot/1` shots.
