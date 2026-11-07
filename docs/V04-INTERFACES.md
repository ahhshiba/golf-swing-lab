# 0.4.0 frozen interfaces (V4-A drop 1, 2026-11-07)

**Status 2026-11-07 (integration, §G.4-4): every package (V4-A…F) has landed; no stub and no `PACKAGE_PENDING` code is left
in app/src** (`tests/unit/appcore.v4.test.mjs` "no stubs remain" greps for it and calls every frozen function). The
§4 rows below are real implementations; "stub" in this file is history. Integration changes are listed in §8.

What V4-B…F build against. Spec: `docs/V04-SPEC.md` (§ numbers below). Behaviour is defined by the code; this file is
the index (same format as `docs/LM-INTERFACES.md`). **Stub** = a placeholder created by V4-A that the owning package
replaces: a function that throws `{ code: 'PACKAGE_PENDING' }`, a screen with a header and an empty state, or an
empty constant. Signatures (names, parameters, return shapes) are FROZEN; a package may add optional inputs / outputs
but not change or remove these. `tests/unit/appcore.v4.test.mjs` checks every row of §4 (file exists, lazy, exports).

## 1. Contracts (§F.1–F.3) — done, owner V4-A

| What | Where | Value / signature |
|---|---|---|
| Reason codes | `contract/reason-codes.js` | 47 = 38 + `PROVISIONAL GAPPING_PRIOR REFERENCE_PRIOR SIDE_SAMPLED MANUAL_ENTRY LIE_ADJUSTED AUTO_PUTT AUTO_CHIP FAULT_INCONCLUSIVE` (appended, order fixed); `MODEL_CODES` += `GAPPING_PRIOR REFERENCE_PRIOR AUTO_PUTT AUTO_CHIP` (8) |
| Text | `app/i18n/{zh-Hant,en}/reason.json` | `.short/.long/.fix` for each (`check_contract` → `(47 reason codes;`) |
| golf-shot/2 rev 2 | `schema/shot-v2.schema.json` (`$comment` rev 2), `contract/validate.js` | optional `tracks.club_px: [[frame, u, v] …≤ 40]`, frames strictly increasing (rule `tracks_club_frame_increasing`). Schema id unchanged; a 0.3.0 validator rejects a shot carrying it (accepted, like LMS D6) |
| golf-round/1 | `schema/round-v1.schema.json`, `contract/round.js` (**lazy**: `import()` it; `contract/index.js` names it in its API summary but never re-exports it) | `ROUND_SCHEMA`, `validateRound(round, { replayRound }?) -> { ok, errors: [{ path, msg, rule }] }`; rules `schema shape players_count holes_count hole_shape stroke_seq_increasing stroke_player_known stroke_hole_range stroke_n_sequence manual_entry_code value_needs_uncertainty null_needs_reason validity_not_valid size_limit replay_matches`; `replay_matches` (≤ `REPLAY_TOLERANCE_M` 0.05 m) runs only when a `replayRound` is passed (V4-C `sim/round.js replayRound`); enums `ROUND_STATUSES COURSE_STYLES HOLE_STYLES TEE_IDS SIM_LIES STROKE_SOURCES STROKE_EVENTS ROUND_ORIGINS PUTT_SKILLS PLAYER_KINDS RULE_OPTIONS`, `ROUND_MAX_BYTES` 262144 |
| golf-lab/1 | `contract/round.js` (+ `$defs.lab` in the round schema) | `LAB_SCHEMA`, `validateLabRecord(rec)`, `FAULT_STATUSES ['fault','possible','ok','unknown']` (`possible` ⇒ `FAULT_INCONCLUSIVE`, `unknown` ⇒ a reason code) |

Round shape = §F.2 exactly, with these decisions: `course.tees` is the tee set played (`forward|middle|back`);
lies `SIM_LIES = tee fairway rough bunker green water ob`; value origins `ROUND_ORIGINS` = the contract
`VALUE_ORIGINS` (incl. `manual`, `prior`, `flight_model`) + `sim` (auto putt / chip, penalty, pickup); a `manual`
stroke has `shot_id: null` (manual numbers never become a golf-shot, §J Q3). Unknown top-level keys are a `shape` error.

## 2. Repository and export (§F.2) — done, owner V4-A

`store/core.js`: `SCHEMA_VERSION = 5`, stores `rounds` (keyPath `round_id`, indexes `created_at`, `status`) and `lab`
(keyPath `shot_id`, indexes `computed_at`, `view`); additive (migration 5 is a no-op, the backend creates the stores).
`repo.rounds.{get, put, list, delete, putMany, count}`, `repo.lab.{get, put, list, delete, putMany, count,
deleteStale(version) -> number deleted}` (deletes records whose `algo.version !== version`).
`store/export.js`: format stays `golf-swing-lab-export/1`; `exportJSON(repo, { includeRounds })` writes `rounds[]` by
default when there is no shot filter (a filtered export only with `includeRounds: true`); `importJSON` validates each
round with `validateRound` (lazy import; no replay) and merges by `round_id` / revision. `lab` records and drills are
never exported. The 0.3.0 importer ignores `rounds[]` (locked by `store.export` test against the 9f429da module).

## 3. App, screens, settings, theme — done, owner V4-A

- `main.js`: `app.sim = { active() -> { round_id, hole, player_id, stroke_n, club } | null, set(ctx | null),
  submit(input) -> number of listeners, onSubmit(fn(input, ctx)) -> off }`, input `{ kind: 'quick', result } |
  { kind: 'shot', shot } | { kind: 'manual', carry_m, side_m | null }` (other kinds throw TypeError).
  `app.loadStyles(name) -> Promise<HTMLLinkElement>`: adds `styles/screens/<name>.css` once (`link[data-lazy-css]`),
  resolves on `load`, rejects `STYLES_UNAVAILABLE` (retry allowed) or TypeError for a bad name.
  `SCREEN_MODULES` += `course → ui/course.js mountCourse`, `round → ui/round.js mountRound`, `scorecard →
  ui/scorecard.js mountScorecard`, `lab → ui/lab.js mountLab`, `patterns → ui/patterns.js mountPatterns`;
  `SCREEN_STYLES = { course: 'sim', round: 'sim', scorecard: 'sim', lab: 'lab', patterns: 'lab' }` — main.js awaits
  `app.loadStyles` before mounting those screens. `ui/share.js` loads `'share'` itself before opening its sheet.
- `state.js`: `SUB_SCREENS` += `course round scorecard lab patterns`; `DATA_SCREENS` += `round scorecard lab patterns`;
  tabs: course / round / scorecard → practice, patterns → history, lab keeps the tab it was opened from (like shot).
- `index.html`: the 5 `<section data-screen>` roots; it links none of the lazy screen sheets.
- `ui/home.js`: list rows `home-course` (→ `course`) and `home-lab` (→ `lab` without params: V4-F shows a picker /
  the way to `patterns`). `ui/settings.js`: switch `settings-quick` (Live group) saves `settings.quick.enabled`.
- `session/settings.js`: `settings.quick / sim / share / lab` are kept as given (plain object, else dropped) and merge
  one level in `saveSettings`; normalise them with the lazy modules below. Shell readers treat a missing
  `quick.enabled` as `true`.

| Settings module (lazy) | Exports | Defaults (§F.4, owner decisions §J) |
|---|---|---|
| `quick/settings.js` (V4-B) | `normalizeQuick`, `QUICK_DEFAULTS` | `{ enabled: true }` |
| `sim/settings.js` (V4-C) | `normalizeSim`, `SIM_DEFAULTS`, `SIM_OPTIONS`, `AUTO_CHIP_RANGE_M`, `MANUAL_FEEDS_GAPPING = false` (Q3) | `{ unobservedSide: 'sample', putting: 'auto', puttSkill: 20 (Q1), ob: 'drop_2' (Q2), maxScore: 'double_par', autoChipM: 0, flyover: true, tees: 'middle' }` |
| `share/settings.js` (V4-E) | `normalizeShare`, `SHARE_DEFAULTS`, `TRAIL_IDS`, `SHARE_LAYOUTS` | `{ ballColour: 'trail-1', clubColour: 'trail-4', layout: 'portrait', card: true, lines: false, faceMask: false, appMark: false (Q4) }`; ball ≠ club |
| `lab/settings.js` (V4-F) | `normalizeLab`, `LAB_DEFAULTS`, `LAB_LINE_IDS` (9), `LAB_SENSITIVITIES` | `{ lines: all 9, dynamic: false, sensitivity: 'standard' (Q5) }` |

Tokens (`tokens.css`, `:root` only, theme-independent): `--trail-1 … --trail-8` (#FFE000 #FF8A00 #FF5C7A #00E5FF
#4DFF6A #FFFFFF #C58BFF #6FA8FF; each ≥ 4.5 on black, pairwise CIEDE2000 ≥ 23.0); `--course-fairway -rough -green
-bunker -water -tree -ob -pin -outline` (sun overrides only `-ob`, `-pin`, `-outline`). Tests: `tokens.contrast`,
`tokens.v4`. Lazy sheets `styles/screens/{sim,lab,share}.css` hold one probe rule (`--lazy-css: <name>`) the gates read;
keep it.

## 4. Package interfaces — signatures FROZEN (all landed)

| Pkg | File (stub) | Exports / signature |
|---|---|---|
| V4-B | `quick/estimate.js` | `quickEstimate({ samples, impact, view, fps, club, handedness, calibration, gappingRow \| null, settings }) -> QuickResult { stage: 'provisional', t_impact, metrics: { <id>: Metric }, carry_source: 'pose'\|'gapping'\|'reference'\|null, timings_ms }` |
| V4-B | `ui/quickcard.js` | `mountQuickCard(el, app) -> { provisional(r), refined(shot), clear() }` (`data-testid=quick-card`, `data-stage`) |
| V4-C | `course/generate.js` | `generateCourse({ seed, style, holes: 9\|18, tees }) -> Course`; `COURSE_GENERATOR = 'course-1'` (real value) |
| V4-C | `course/validate.js` | `validateCourse(course) -> { ok, problems: [{ hole, rule, detail }] }` |
| V4-C | `course/model.js` | `lieAt(hole, x, y) -> 'fairway'\|'rough'\|'bunker'\|'green'\|'water'\|'ob'` |
| V4-C | `sim/engine.js` | `shotOutcome({ input, view, club, player, rows: { gap, side }, rules, rng }) -> Outcome { carry, side, draw: { seed, carry_m, side_m }, source, shot_id, ellipse: { sx, sy } }` |
| V4-C | `sim/round.js` | `playStroke(round, outcome, aim) -> { round, stroke }` (new round object); `scorecard(round) -> { players: [{ player_id, holes: [{ hole, par, strokes, putts, penalties, picked_up }], out, in, total, to_par }] }`; `replayRound(round) -> { strokes: [{ rest }] }` |
| V4-C | `sim/putting.js` | `autoPutt(round, player, rng?) -> { round, strokes }` |
| V4-C | `sim/recommend.js` | `recommendClub({ distance_m, lie, dz_m, player }) -> { club, carry: { median, p10, p90 }, alts: [2], source: 'gapping'\|'reference', flags: ['small_sample'?] }` |
| V4-D | `course/draw2d.js` | `drawHole2d(canvas, { hole, strokes, ellipse, aim, palette, units }) -> { a11y, params }` (params at least `{ ellipse: boolean, source }`) |
| V4-D | `course/draw3d.js` | `createFlyover(canvas, { hole, palette, reducedMotion, onDone }) -> { start(), skip(), destroy() }` |
| V4-D | `ui/sim-banner.js` | `mountSimBanner(el, app, ctx) -> { quick(r), destroy() }` (ui/live.js imports it when `params.sink === 'sim'`) |
| V4-D | `ui/course.js`, `ui/round.js`, `ui/scorecard.js` (stub screens) | `mountCourse / mountRound / mountScorecard(root, app, opts) -> { show(params), hide?() }`; scorecard keeps `score-disclaimer` (`score.disclaimer`) |
| V4-E | `share/compose.js` | `composeShotVideo({ shot, clipBlob, poseSeq \| null, opts: { ballColour, clubColour, layout, card, lines, faceMask, appMark }, onProgress, signal }) -> Promise<{ blob, mime, duration_s, bytes, width, height }>` |
| V4-E | `share/card.js` | `drawShotCard(canvas, { shot, units, palette, locale })`, `drawSessionCard(canvas, { shots, filter, units, palette })`, `drawRoundCard(canvas, { round, playerId })` → `{ a11y, params }` |
| V4-E | `ui/share.js` | `openShareSheet(app, { kind: 'shot'\|'session'\|'round', … }) -> Promise<void>` |
| V4-E | `share/trails.js` | `TRAIL_TOKENS = [{ id: 'trail-1', token: '--trail-1' } … 8]` (real value) |
| V4-F | `lab/lines.js` | `computeLines({ view, poseSeq, events, calibration, handedness }) -> { [LAB_LINE_IDS]: { pts, kind: 'ref'\|'live', validity, reason_codes } \| null }` |
| V4-F | `lab/overlay.js` | `drawLines(ctx, lines, { frame, palette, enabled })` |
| V4-F | `lab/faults.js` | `evaluateFaults({ shot, poseSeq, view, fps, settings }) -> golf-lab/1` |
| V4-F | `lab/trends.js` | `faultTrends(labRecords, { days, view }) -> { top, rows: [{ id, view, n, sessions: [{ session_id, p, lo, hi, n }], change }] }` |
| V4-F | `lab/drills.js` | `LAB_DRILLS = []` (stub; shape `{ id, fault, view, metric, success }`, text `lab.drill.<id>.*`) |
| V4-F | `ui/lab.js`, `ui/patterns.js` (stub screens) | `mountLab / mountPatterns(root, app, opts)`; lab without `shot_id` = home entry |

Stub screens show the screen header (h1, back) and an empty state; replace the whole file, keep the mount export name.

## 5. Build, lints, i18n, budgets — done, owner V4-A

- `scripts/build.mjs`: `LAZY_GLOBS` += `src/quick/*.js src/course/*.js src/sim/*.js src/share/*.js src/lab/*.js
  src/contract/round.js src/ui/{course,round,scorecard,sim-banner,quickcard,share,lab,patterns}.js`; `LAZY_EXACT` +=
  `styles/screens/{sim,lab,share}.css`; `LAZY_I18N_NAMESPACES` += `quick sim course score share lab fault patterns`.
  New files in those directories are lazy automatically (B–F only add files). `BUDGETS` unchanged.
- `app/i18n/namespaces.json` owners: `v4-b: quick`, `v4-d: sim course score`, `v4-e: share`, `v4-f: lab fault patterns`
  (catalogs exist in both locales with real strings; core keys added by V4-A: `screen.{course,round,scorecard,lab,
  patterns}.title`, `home.{course,course_hint,lab,lab_hint}`, `settings.quick`, `settings.quick.hint`).
- `scripts/check_brands.mjs` + verify stage `brands` (after `static`): rules `competitor lm-brand feature-names
  accuracy-claim vendor-ban` exactly as §I; `--root DIR` (a git work tree → tracked + untracked-not-ignored files and
  `dist/`; a build output with `precache-manifest.json` → all of it as `dist/`). Decisions: binary files are skipped;
  vendor-ban in a build output skips `dist/vendor/` and `dist/models/` (the pinned MediaPipe wasm embeds OpenCV);
  comment lines with the "(OpenCV:" / "(OpenCV)" camera-axis convention are allowed.
- `scripts/budget_delta.mjs --max <n> [--max-precache <n>] [--manifest …]` → `SHELL DELTA <n> OK|FAIL`;
  baseline `tests/fixtures/v4/budget-baseline.json` (9f429da: shell 976,739 B, precache 31,880,602 B; caps per package).
- `package.json` version `0.4.0` (build → `APP_SEMVER '0.4.0'`, manifest `0.4.0+<hash>`).

## 6. e2e and fixtures — done, owner V4-A

- `tests/e2e/run.mjs` discovers `tests/e2e/gates/v4-<x>-<name>.mjs`: `RUN_BROWSER_E2E=1 node tests/e2e/run.mjs --only 'v4-d-*'`.
  Gate `v4-a-shell` (acceptance 6). The screenshot matrix default includes `course round scorecard lab patterns`
  (packages register their §F.8 states with `app.e2e.registerState` and add them to `ALL_SCREENS`).
- `node scripts/make_v4_fixtures.mjs [--check]`: `tests/fixtures/rounds/valid_9_links_2p.json`,
  `valid_18_parkland_1p_finished.json`, `valid_manual_only.json`, `bad_<rule>.json` × 12 (`_expect` = rule);
  `tests/fixtures/v4/shot_v2_club_px.json` (valid_face_on_240 + `tracks.club_px`) and
  `bad_shot_tracks_club_frame_increasing.json`. The hole geometry is hand-built and stroke rests are straight-line
  arithmetic: contract fixtures, not a replay golden (V4-C writes its own replay / course goldens).
- Not yet provided (V04-SPEC §F.8 lists them for V4-A; they depend on V4-B / V4-F algorithm inputs and come with those
  packages' first drop or a V4-A follow-up on request): `tests/fixtures/v4/quick-swings.json`, `lab-sessions.json`.

## 7. Transitional items the V4-A integration commit removes (§G.4-4)

Every `PACKAGE_PENDING` stub of §4 replaced; the stub-skipping branch in `tests/unit/appcore.v4.test.mjs` (a landed
function no longer throws `PACKAGE_PENDING`) kept or tightened; `LAZY_*` final lists; this file's status column; the
round fixtures regenerated against the real generator if V4-C asks for it.

## 8. Integration step (2026-11-07) — done

- Stubs: all replaced; the `PACKAGE_PENDING` fallbacks in `share/card.js` (scorecard fallback), `share/compose.js`
  (`lines_pending`) and `ui/shot.js` (`shot.share.clip_na`, key removed) are gone; the appcore.v4 stub test is now
  "no stubs remain".
- "95 %" landing ellipses are joint 2-D regions: radius `ELLIPSE_K95 = 2.4477 σ` (`sim/params.js`, chi-square 2 dof) in
  `sim/engine.js`, `sim/putting.js`, `course/draw2d.js` and `ui/round.js previewEllipse` (1.96 σ per axis covered only
  ~85 %); one-axis "±" texts keep 1.96 σ. Test `sim.ellipse` (Monte Carlo coverage).
- `ui/round.js simRows(player, rows, club)`: shotOutcome and previewEllipse get the whole gapping table
  (`rows.gapping`), the one recommendClub uses, so an unmeasured club flies the scaled carry it recommended
  (test `ui.sim.gapping`).
- golf-round/1: `stroke.draw` gains optional `apex_m` (> 0) and `land_deg` (10–75), no other key (schema
  `additionalProperties: false`; `validateRound` rule `shape`). Test `v4.contract.round_schema` (the engine-played
  goldens in `tests/fixtures/rounds/v4c` pass the JSON schema and the replay). The hand-built `tests/fixtures/rounds/
  valid_*` stay contract fixtures: nothing replays them, so they were not regenerated.
- Live timing (0.3.0 bug): a segment's `t_media_start_s` is its first recorded frame (`capture/recorder.js startClock`
  + `capture/frametap.js nextMediaTime`), no longer the last tapped frame; gate `v4-b-latency` measures it.
- `pipeline/assemble.js withClubPx`: no `club_px: []` key. `course/draw2d.js PLAYER_SHAPES`: per-player ball markers
  (circle / square / triangle / diamond, matching `.player-swatch`). `share/compose.js drawLinesInRect`: alignment lines
  clipped to the video rect (test in `share.compose`).
- New gates `v4-d-import`, `v4-d-share`; matrix: every 0.4.0 state, `--seed lab`, 1,080 states (`a-matrix`).
