# Course simulation parameters (V4-C, `sim-1`)

Every number in `app/src/sim/params.js` (`SIM_PARAMS.version = 'sim-1'`, written into each round's
`rules.params_version`) and the ranges in `app/src/course/styles.js`. **All of them are UNVERIFIED**: they are
rule-of-thumb values chosen to make a simulated round feel plausible, not measurements, and nothing in the product
may present them as accurate. None was taken from any real course, licensed course data or a commercial simulator.

## What the simulation can and cannot claim

- The ball's carry and side come from `sim/source.js` (§B.1 of `docs/V04-SPEC.md`): an imported shot's estimate, a
  quick read, the player's own distance table, a reference table, or a number the player typed. The engine never
  upgrades their validity (`valid` is reported as `estimated`) and every non-manual value carries a σ.
- A simulated score is a consequence of those estimates plus the models below. It is not a real-course score
  (`score.disclaimer`).
- Replays (`sim/round.js replayRound`) reproduce the stored rests exactly from the stored draws: the stroke path uses
  only + − × ÷ sqrt and table lookups. Sampling (Box–Muller in `geom/rng.js gauss`, `Math.exp` in putting) happens
  once, when the stroke is played; its result is stored in `draw`, so other engines never need to repeat it.

## Parameters

| Parameter | Value | Note (UNVERIFIED) |
|---|---|---|
| `reference_sigma_frac` | 0.12 | 1σ of a reference carry (§B.1). |
| `gapping_min_n` | 5 | Same small-sample threshold as `store/stats.js SMALL_N`. |
| `side_min_n`, `side_sigma_frac` | 10; 0.06 (driver 0.08) | §B.2 reference side spread. Own spread = `summarize().sd_est` (floor 1 m), not used when `indistinguishable`. |
| `lie` | rough ×0.90 (woods ×0.85), σ ×1.3; bunker ×0.85 (woods ×0.70), σ ×1.5 | §C.3. The bunker σ (×1.5) is a V4-C choice (spec gives none). Woods = driver, 3w. |
| Style traits | desert rough: carry ×0.9 more, σ ×1.15 more; links fairways roll as `firm` | "Waste ground penalised harder" and "firm links turf" (§C.2). |
| `land_deg` / `land_tan` | driver 38° … sw 52° | Landing-angle priors for slope and roll; tan tabulated so the replay path has no `Math.tan`. |
| `apex_frac`, `apex_at` | driver 0.13 … sw 0.25 × carry; apex at 58 % | Only used for tree collisions (two half-parabolas). |
| Roll | `physics/lm/roll.js rollFrac(land_deg, ground)` × rough 0.35, bunker/water 0; green `soft` | §C.3. Rolls in 0.5 m steps; stops on entering sand. |
| Water | +1; 2 m behind the dry point on the incoming line | §C.3. |
| OB | `drop_2` (default, owner Q2): +2, nearest fairway edge point to where the ball left, 1 m inside; `stroke_distance`: +1, same spot | §C.3. A simplified local-rule style option. |
| Max score | 2 × par, then picked up (scored 2 × par); `maxScore: 'none'` plays on | §C.3. |
| Putting `d50` | handicap band 0 / 10 / 20 / 30 → 2.4 / 1.8 / 1.4 / 1.1 m (default 20, owner Q1) | §C.3. |
| Putting curve | `p(d) = clamp(exp(−(max(0, d − 0.45) / (d50 − 0.45))^1.3 · ln 2), 0.02, 0.995)` | **Deviation**: the spec curve without the 0.45 m tap-in offset gives only 0.78 (band 30) – 0.91 (band 0) at 0.5 m, failing the spec's own acceptance (one-putt ≥ 0.95 at 0.5 m). The offset keeps `d50` the 50 % distance and the long-putt tail. |
| Missed putt | stops `|N(0, 0.08 d + 0.25)|` (≥ 0.1 m) from the hole, random direction; the 4th putt always drops | §C.3. |
| Green slope | `d50 / (1 + 0.08 · max(0, slope_pct − 1))` | V4-C choice: "slope only changes the auto-putt difficulty" (§C.1). |
| Auto chip | leave `|N(0, 0.12 d)|` × band factor 0.8 / 1 / 1.2 / 1.45, pulled onto the green | §C.3; band factor is a V4-C choice. |
| Recommendation | plays-like = distance + dz; nearest lie-scaled median carry; driver only from the tee | §C.3; "driver only from the tee" is a V4-C choice (spec: never from sand). |

## Course generator (`course-1`)

- 3 original styles × 7 hand templates (par 3 ×2, par 4 ×3, par 5 ×2) in `course/styles.js`: lengths, dogleg angle,
  corner position, fairway width / islands, green size, bunker and water placements, tree rows or scatter, corridor width.
- Template lengths sit ≥ 5 m inside the validator's par windows; widths keep a ≥ 25 m landing zone 160–240 m out on
  every par 4/5 (`validateCourse`, checked for 3 × 3,334 seeds in `tests/unit/course.validate.test.mjs`).
- Elevation is one plane per hole (tee → green), no undulation (§C.1 decision); wind is not modelled (`WIND_IGNORED`).

## Known limits

- The stroke path is a straight line in plan with a parametric height. An imported shot's `flight.samples` are not
  stored in a round, but their SHAPE is: `sim/engine.js flightShape(samples)` reduces them to `draw.apex_m` (apex above
  the start) and `draw.land_deg` (landing angle of the last segment, clamped 10–75°), stored in the stroke's `draw`
  (golf-round/1 schema: optional, 2026-11-07 integration), and `sim/rules.js` uses them instead of the club prior for
  the slope intersection, tree collision height and roll — so the replay (arithmetic only) still reproduces them.
  Live (quick) and typed-in strokes, and shots without samples, keep the club prior (`land_deg`, `apex_frac`).
- No curvature (draw / fade), no bounce off trees, no lie inside a tree's drip line, no plugged lies.
