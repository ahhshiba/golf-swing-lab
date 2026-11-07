# Launch-monitor frozen interfaces (LM-A drop 1, 2026-11-06)

What LM-B…F build against. Spec: `docs/LAUNCH-MONITOR-SPEC.md` (§ numbers below). Behaviour is defined by the code;
this file is the index. **Stub** = a placeholder created by LM-A that the owning package replaced (it threw
`{ code: 'PACKAGE_PENDING' }` or rendered an empty screen); **done** = implemented and tested. Status 2026-11-06
(LM-A integration, §5.3-3): every package has landed, no stub and no `PACKAGE_PENDING` handling is left (§10).

## 1. Contract `golf-shot/2` (§2) — done, owner LM-A

| What | Where | Final signature / value |
|---|---|---|
| Schema | `schema/shot-v2.schema.json` (new); `schema/shot-v1.schema.json` frozen | `golf-shot/2`; v1 stays for imports |
| Ids | `contract/enums.js` | `METRIC_IDS` (36 = `METRIC_IDS_V1` 22 + `LM_METRIC_IDS` 14, order §5.0-1), `METRIC_UNITS` (+`rpm`), `METRIC_DEFAULT_ORIGIN` |
| Origins | `contract/enums.js` | `VALUE_ORIGINS` = v1 7 + `MODEL_ORIGINS` `['dplane','spin_model','flight_model','prior']` |
| Reason codes | `contract/reason-codes.js` | 38 = 29 + `DPLANE_MODEL SPIN_MODELLED SPIN_LOFT_ASSUMED FLIGHT_MODELLED ROLL_MODELLED SMASH_ASSUMED LAUNCH_V_ASSUMED CROSS_VIEW_PRIOR MIGRATED_V1`; `MODEL_CODES` (★ 4); `REASON_CODE_LIST_V1` |
| Text | `app/i18n/{zh-Hant,en}/reason.json` | every code has `.short/.long/.fix` (checked by `check_contract`) |
| Shot keys | `SHOT_REQUIRED_KEYS` | v1 keys + `flight`, `tracks`, `practice` (each `null` or an object); `algorithms.lm = { version, sha256 }` |
| Constants | `contract/enums.js` | `SCHEMA_ID = SCHEMA_V2 = 'golf-shot/2'`, `SCHEMA_V1`, `LM_ALGORITHM_NONE = { version: 'none', sha256: sha256('none') }`, `GROUNDS`, `FLIGHT_MAX_SAMPLES` 64, `TRACK_MAX_POINTS` 40, `BALL_CLUB_IDS` (21: F2 14–20 + the 14 new) |
| Builders | `contract/shot.js` | `newShot(init)` writes v2: fills `flight/tracks/practice = null`, `algorithms.lm = LM_ALGORITHM_NONE` when absent, 36 placeholders |
| Validator | `contract/validate.js` | `validateShot(shot)`: `golf-shot/2` by v2 rules, `golf-shot/1` by the frozen v1 rules. v2 rule names appear in the message: `flight_t_increasing`, `flight_z_above_ground`, `flight_needs_carry`, `flight_landing_matches_carry` (≤ 0.5 m), `tracks_frame_increasing`, `practice_target_positive`, `model_code_required` (also enforced by `metricValue`) |
| Migration | `contract/migrate.js` | `import { migrateShot, SCHEMA_V2 } from '../contract/migrate.js'`; `migrateShot(any) -> { shot, migrated }`; v1 → v2 adds the 14 ids as `not_computed` + `MIGRATED_V1`; idempotent, pure; v2 / non-shots returned as is |

Shapes (§2.2): `flight = { samples: [[t_s, x_m, y_m, z_m] …≤64], landing: { x_m, y_m, t_s }, rest: { x_m, y_m } | null,
band: { side_lo: [[x, y]…], side_hi: [[x, y]…] } | null, ground: 'firm'|'normal'|'soft', model: 'lm-1' }` (mat frame:
x down the target line, y + = left of the target line seen from behind the ball (toward a right-handed golfer), z up;
samples[0] = ball centre at impact).

**Side sign (two frames).** The metrics `carry_side_m`, `total_side_m`, `curve_m`, `launch_h_deg`, `face_angle_deg`,
`club_path_deg`, `spin_axis_deg` are + **away from the golfer** (right of the line for a right-hander, left for a
left-hander). `flight.samples`, `flight.landing`, `flight.rest`, `flight.band` are in the **mat frame** (fixed, y + =
left of the line), so for a right-hander `flight.landing.y_m ≈ −carry_side_m`, for a left-hander `≈ +carry_side_m`
(physics/lm/index.js `toMat`; fixture `valid_high_behind_240`: side +3.1 → landing y −3.1). Viz (`drawTop` points,
`drawSide`, `createTraj3d`) takes the mat frame: the result screen passes `flight.landing.y_m` (ui/tiles.js), the stats
screen converts `carry_side_m` with the shot's `handedness` (ui/stats.js). `tracks = { ball_px: [[frame, u, v, r_px]
…≤40], impact_frame, view }` (original-resolution pixels). `practice = { drill_id, slot, target_m (> 0), attempt }`.

## 2. Registry (§1.2) — done, owner LM-A

`metrics/registry.js`: 36 rows; rows 21–34 = the new ids in contract order. `cellFor(id, view, fps)` unchanged
signature → `{ validity, code }`. New: `nullCodeFor(id, view)`, `minFpsFor(id, view)`, `LM_ROW_IDS`; entries may carry
`nullCodes: { [view]: RC }`, `minFpsByView: { high_behind: 240 }`, `depends` (array or `{ [view]: ids }`),
`runtimeCodes`. Changed cells (§1.3-2, UNVERIFIED): high_behind `club_speed_mps`, `ball_speed_mps`, `carry_m` 不可 → 低
(≥ 240 fps). Table: `docs/metrics-by-view.md` §1a; test `tests/unit/metrics.registry.test.mjs` reads the spec table.

## 3. Store (§2.1, §5.0-7) — done, owner LM-A

`store/core.js`: `SCHEMA_VERSION = 4`, new store `drills` (keyPath `drill_id`, indexes `created_at`, `template`);
`repo.drills.{get, put, list, putMany, delete, count}`. `repo.shots.get / repo.shots.list / repo.queryShots` return
golf-shot/2 (a stored v1 is migrated on read; the generic `repo.get/list/snapshot` stay raw). `repo.migrateBatch(n = 50)
-> { migrated, remaining }` (one short transaction; main.js repeats it after `#app-ready`). `store/export.js`:
`exportJSON` writes golf-shot/2; `importJSON` accepts v1 and v2 shots (stored as given); CSV gained 14 × 4 columns at
the end (151 columns). `store/metric-ids.js` = the 36 ids.

## 4. Settings, app object, screens, theme — done, owner LM-A

- `session/settings.js` (§3.9): `settings.lm = { ground: 'normal', crossView: false (D2, always false), tiles: id[]
  (1–16), tilePreset: 'auto'|'custom', gapMin: 7.3152, gapMax: 18.288 (metres = 8 / 20 yd), excludeMishits: true }`;
  `saveSettings({ lm: {…} })` merges one level. `LM_TILE_DEFAULTS { face_on, high_behind, dtl }`, `tileDefaults(view)`,
  `LM_GROUNDS`, `LM_TILE_PRESETS`, `LM_TILE_MAX`. Settings › Display (`ui/settings.js`): ground (`settings-lm-ground`),
  mishits (`settings-lm-mishits`), gap range `settings-lm-gap-min` / `settings-lm-gap-max` (typed in the distance unit,
  stored in metres, 1–50 m, min < max). `theme` default `'dark'` for new installs (D1); existing records keep
  theirs, a migrated v1 record gets `'auto'`.
- `main.js`: `app.drill = { current() -> drill|null, set(drill|null), onChange(fn) -> off }` (§5.0-8);
  `app.e2e = { registerState(screen, name, async fn), runState(screen, name, ...args), has(screen, name), states() }`
  (§5.0-13; `runState` of an unknown state rejects with `code: 'E2E_STATE_MISSING'`). `SCREEN_MODULES` has
  `drills → ui/drills.js mountDrills`, `drill → ui/drill.js mountDrill`, `stats → ui/stats.js mountStats`,
  `gapping → ui/gapping.js mountGapping`; mount signature as every screen: `mount(root, app, opts) -> { show(params), hide?() }`.
- `state.js`: `SUB_SCREENS` += `drills, drill` (tab practice), `stats, gapping` (tab history); `DATA_SCREENS =
  ['shot', 'stats', 'gapping', 'drill']`: while `theme === 'auto'` their roots get `data-live-theme="dark"` and
  `:root:has(...)` turns the whole page dark (tokens.css); light / dark / sun choices win.
- `index.html`: the 4 `<section data-screen>` roots; links `styles/screens/viz.css` (LM-C) and `styles/screens/stats.css` (LM-F).

## 5. Design tokens and components (§4) — done, owner LM-A

`tokens.css` (all three themes and both auto blocks): `--fs-metric-xl` = `calc(clamp(max(44px, 2rem), 11.3vw, 3.5rem) ×
--hero-scale)` (≥ 44 px at 390 px), `--fs-metric`, `--t-metric` (sun 800), `--tile-bg`, `--tile-border` (shorthand)
+ `--tile-border-color`, `--viz-bg`, `--viz-axis`, `--viz-grid`, `--viz-text`, `--viz-series-1…8`, `--viz-ci-alpha`
(number: dark .18, light .14, sun 0 = outline instead), `--viz-target`, `--viz-tracer`, `--viz-tracer-halo`. Contrast:
`tests/unit/tokens.contrast.test.mjs` (62 pairs ≥ 3.0). `app.css`: `.data-tiles` grid (2 / 3 / 4 columns), `.data-tile`,
`.dt-label`, `.dt-mark`, `.dt-value`, `.mt-num`, `.mt-unit`, `.dt-est`, `.mt-ci`, `.dt-reason`.

`ui/components.js`: `dataTile({ metric, id, units, estimatedBadge, label, onClick, testid }) -> <div|button.data-tile
data-metric data-validity>`: label, big number `.mt-num` (tabular), unit, `± range`, then for estimated / low confidence
a readable `vtag` pill `.dt-mark` (◐ / ▲ + word, the same pill as the result list); measured and null carry the validity
word for screen readers only; a model-inferred estimated number's pill says the estimated word (default
`t('tiles.estimated_badge')`) when `isInferred(metric)` (model origin or a model / prior code), `—` +
`t('reason.<first code>.short')` when null. ui/tiles.js: the automatic tile list leaves out tiles this shot has no
value for (`shownIds`; they stay in the not-measured disclosure), a custom list shows every chosen tile. `isInferred`, `INFERRED_ORIGINS`, `INFERRED_CODES`.
`segmented` unchanged. `i18n/units.js`: unit `rpm` (kind `rpm`, 0 decimals, `t('unit.rpm')`).

## 6. Build, lints, i18n — done, owner LM-A

- `scripts/build.mjs`: `LAZY_GLOBS` (`src/viz/*.js`, `src/ui/{drills,drill,stats,gapping,tiles}.js`, `src/practice/*.js`,
  `src/store/stats.js`, `src/physics/lm/*.js`), `isLazyPath(rel)`, `LAZY_FILES` (exact list + matching files). A lazy
  file statically imported from the boot graph fails the build. `LAZY_I18N_NAMESPACES` += `tiles viz drill stats
  gapping` **and `metric`, `reason`** (shell budget; only screens mounted after `i18nComplete()` use them).
- `scripts/check_tokens.mjs`: rule `js-hex-colour` (hex string literals in `src/viz/**`, `src/ui/**`): WARN until the
  integration commit sets `JS_HEX_FAILS = true` — **done**: FAIL now; the setup / magnifier video overlays read the
  theme-independent tokens `--overlay-go / -caution / -stop / -select` + `--media-bg` / `--on-media` through
  `ui/magnifier.js overlayColour(name, fallback)` (contrast-exempt: drawn on video with a `--media-bg` outline).
- `app/i18n/namespaces.json`: new namespaces with owners `lm-c: viz`, `lm-d: tiles`, `lm-e: drill`, `lm-f: stats, gapping`
  (stub catalogs; `tiles.estimated_badge` = 估計 / Estimated since the design polish: it is the word inside the ◐ pill). New keys LM-A added: `metric.<14 ids>.{label,short,meaning,range,term}`,
  `reason.<9 codes>.{short,long,fix}`, `unit.rpm`, `screen.{drills,drill,stats,gapping}.title`.

## 7. e2e — done, owner LM-A

- `tests/e2e/run.mjs` discovers `tests/e2e/gates/lm-<x>-<name>.mjs` (ids `lm-<x>-…`): `RUN_BROWSER_E2E=1 node tests/e2e/run.mjs --only 'lm-d-*'`.
- `tests/e2e/screenshot_matrix.mjs --screens shot,shot:tiles,drills,drill:result …`: `<screen>:<state>` shows the screen,
  then runs the state registered with `app.e2e.registerState(screen, state, fn)`; a missing state is a `state` finding
  (exit ≠ 0). Default (integration) = every screen and state of §5.3-4 plus `drills:setup` (the drill setup sheet) and `drill:active`; history is seeded with the v1
  and v2 `valid_*` fixtures plus eight extra face-on driver / 7-iron shots with a real carry spread (Gapping's P10–P90 band) and the shot screen opens the v2 face_on shot; while an `aria-modal` sheet is open only its
  own controls count for `overlap`. Files: `<screen>~<state>-<w>x<h>-<theme>-<locale>-<k>x.png`.
- Gate `lm-a-shell` (LM-A acceptance 6).

## 8. Fixtures — done, owner LM-A (`node scripts/make_lm_fixtures.mjs`, `--check` in the unit tests)

`tests/fixtures/shots/v2/`: `valid_face_on_240` (every face_on cell, flight + tracks), `valid_face_on_240_no_clip`
(`clip_ref: null`, `CLIP_NOT_SAVED`), `valid_high_behind_240` (hb cells 低, side, band), `valid_dtl_30`,
`migrated_v1_face_on`, `bad_<rule>.json` × 7 (`_expect` = rule). face_on / hb: `flight.samples[0]` projected with
`calibration.camera` (`geom/camera.js project`) = the impact-frame `tracks.ball_px` point (< 0.01 px). Values are
plausible typed-in numbers, not a physics model (`algorithms.lm.version = 'lm-fixture-1'`).
`tests/fixtures/lm/sessions-1000.json`: an export file (`golf-swing-lab-export/1`) with 1000 v2 shots, 8 clubs
(`CLUBS` order), 3 views, 12 sessions, fixed seed, `flight`/`tracks` null, ~4 % mishits.

## 9. Package interfaces (all landed; the File(s) column is the drop-1 stub inventory) — signatures FROZEN

| Pkg | File(s) (stub status) | Signature |
|---|---|---|
| LM-B | `physics/lm/index.js`, `physics/lm/params.js`, `dplane/spin/flight/roll/hbspeed/profile/attack.js` (done) | `deriveLaunchMonitor({ view, fps, club, metrics, fit, clubTrack, calibration, settings: { ground, crossView }, clubProfile, rng }) -> { metrics, flight, tracks, algorithm: { version, sha256 } }`; optional inputs added by LM-B: `handedness` (`'left'` mirrors into the canonical right-handed frame; default right), `start` (ball centre at impact, mat frame; default `fit.p0`, else ground / tee), `ballTrack: { obs, times }` (ball observations + capture timestamps or null → `tracks`), `n` (MC draws, default `LM_PARAMS.flight.mc_draws` 256); `clubTrack = { obs, club }` (track/club.js head observations in full-image px, physics/club.js `clubSpeed` result or null); `pipeline/clip.js` passes `settings.lm.ground` to assemble as `input.lm.ground`; `rederive(shot, { settings, clubProfile }) -> shot'` (pure, caller bumps revision); `clubProfile(shots, clubType, { days = 30, minN = 20 }) -> { n, aoa: { mean, sd }, dl, lv, spin } \| null`; `LM_PARAMS` |
| LM-B | `pipeline/assemble.js`, `metrics/compute.js` (unchanged by LM-A) | fill the allowed cells of rows 21–34 and hb rows 14/16/19; set `algorithms.lm`; remove the `LM_PENDING` exclusion in `tests/unit/pipeline.assemble.test.mjs` |
| LM-C | `viz/index.js`, `viz/palette.js`, `viz/draw.js`, `viz/plot2d.js`, `viz/traj3d.js`, `viz/tracer.js`, `viz/charts.js` (done) | `vizPalette(el)`, `drawSide`, `drawTop`, `createTraj3d`, `drawTracer`, `projectFlight(camera, samples) -> [[u,v]\|null]`, `drawBars`, `drawBox` (§5.0-4); draws return `{ a11y, params }`; `styles/screens/viz.css` (0 rules by design), `i18n/*/viz.json`. Additive options (docs/viz.md): `drawSide` flights `{ rest?, sigma?: { carry, apex }, series? }`; `drawTop` `paths?: [{ samples, club, validity }]`, points `{ band?, series? }`, `target` number or `{ x, y? }`; `createTraj3d` `{ target_m?, onChange? }`, handle `a11y / params / view`; `drawTracer` `{ size?: [W, H], times?, fps? }`; `drawBars` bars `{ lo?, hi?, club?, series?, validity? }` + `kind?, units?, unit?`; `drawBox` groups `{ values? \| stats? }`; extra exports `prefersReducedMotion`, `seriesIndex`, `GLYPHS`, `cloudEllipse`, `orbitCamera`, `project3`, `quantile` |
| LM-D | `ui/shot.js`, `ui/replay.js`, `ui/tiles.js` (new), `ui/glossary.js`, `styles/screens/results.css`, i18n `shot,replay,tiles` (`tiles.json` stub) | use `dataTile`, `settings.lm.tiles/tilePreset`, `tileDefaults(view)`; testids §5.0-12; register `shot:tiles|side|top|3d|video` states |
| LM-E | `ui/drills.js`, `ui/drill.js` (stub screens), `practice/drills.js` (stub `DRILL_TEMPLATES = []`, `makeDrill`), `practice/scoring.js` (`scoreShot`), `practice/assign.js` (`assignClips`), `ui/home.js`, `ui/import.js`, i18n `drill` (stub) | §5.0-6; drills go to `repo.drills` (record = your shape with `drill_id`, `template`, `created_at`); `app.drill`; `shot.practice` |
| LM-F | `store/stats.js` (stub: `summarize`, `gapping`, `compareSessions`, `isMishit`; re-exported by `store/index.js`), `ui/stats.js`, `ui/gapping.js` (stub screens), `styles/screens/stats.css` (stub), i18n `stats`, `gapping` (stubs) | §5.0-5; `settings.lm.gapMin/gapMax` are metres; `history-seg` lives in `ui/history.js` |

Stub screens show the screen header (h1, back) and an empty state; replace the whole file. Keep the mount export name.

## 10. Transitional items the LM-A integration commit removes (§5.3-3)

All done at integration (2026-11-06): `JS_HEX_FAILS = true` (setup / magnifier moved to tokens first); `LM_PENDING`
in `tests/unit/pipeline.assemble.test.mjs` was already gone (LM-B); no stub file remains; the `PACKAGE_PENDING`
guards in `ui/tiles.js` and `ui/stats.js` were removed; `LAZY_FILES` final = `LAZY_EXACT` (12) + `LAZY_GLOBS` (25 files:
`src/viz/*` 7, `src/physics/lm/*` 9, `src/practice/*` 3, `src/store/stats.js`, `src/ui/{drills,drill,stats,gapping,tiles}.js`);
the drop-1 shell cap of 969,715 B in `tests/unit/appcore.build.test.mjs` became the final 1,000,000 B assertion read from
the manifest (`BUDGETS` unchanged).
