// sim/params.js — every tunable number of the course simulation in one place (V04-SPEC §B, §C.3). Lazy, pure data.
// ALL VALUES ARE UNVERIFIED teaching / rule-of-thumb values (sources and caveats: docs/research/sim-params.md).
// A round stores rules.params_version = SIM_PARAMS.version; bump it whenever a number below changes.

const f = Object.freeze;

/**
 * Radius, in σ, of a 95 % ellipse of a 2-D normal (chi-square, 2 dof: √(−2 ln 0.05) = 2.4477). Every map ellipse
 * labelled "95 %" uses this, NOT 1.96 per axis (that box-ellipse holds only ~85 % jointly). One-axis ± texts stay 1.96.
 */
export const ELLIPSE_K95 = 2.4477;

export const SIM_PARAMS = f({
  version: 'sim-1',
  /** Reference-prior 1σ as a fraction of the carry (§B.1). */
  reference_sigma_frac: 0.12,
  /** Gapping rows need this many shots to act as the player's prior (§B.1; store/stats.js SMALL_N). */
  gapping_min_n: 5,
  /** Own high_behind side records needed before their mean / sd_est replace the reference side spread (§B.2). */
  side_min_n: 10,
  /** Reference side 1σ as a fraction of the carry (§B.2): driver 0.08, everything else 0.06. */
  side_sigma_frac: f({ driver: 0.08, default: 0.06 }),
  /** Floor for an own side 1σ (m): sd_est can be ~0 with few shots. */
  side_sigma_min_m: 1,
  /** Next-stroke lie factors (§C.3): carry multiplier, σ multiplier. woods = clubs using the `wood` column. */
  woods: f(['driver', '3w']),
  lie: f({
    tee: f({ carry: 1, wood: 1, sigma: 1 }),
    fairway: f({ carry: 1, wood: 1, sigma: 1 }),
    green: f({ carry: 1, wood: 1, sigma: 1 }),
    rough: f({ carry: 0.9, wood: 0.85, sigma: 1.3 }),
    bunker: f({ carry: 0.85, wood: 0.7, sigma: 1.5 }),
  }),
  /** A bunker within this distance of the pin is a greenside bunker (auto chip allowed, recommendation: sw). */
  greenside_bunker_m: 30,
  /** Landing angle prior (°) per club for the slope intersection and roll (§C.3). */
  land_deg: f({ driver: 38, '3w': 41, hybrid: 44, '5i': 45, '7i': 47, '9i': 49, pw: 50, sw: 52, default: 46 }),
  /** tan(land_deg) precomputed (no Math.tan in the replay path, so replays are engine-independent). */
  land_tan: f({ driver: 0.7813, '3w': 0.8693, hybrid: 0.9657, '5i': 1, '7i': 1.0724, '9i': 1.1504, pw: 1.1918, sw: 1.2799, default: 1.0355 }),
  /** Apex height as a fraction of the carry, and where along the carry it sits (tree collision path). */
  apex_frac: f({ driver: 0.13, '3w': 0.14, hybrid: 0.16, '5i': 0.17, '7i': 0.19, '9i': 0.21, pw: 0.23, sw: 0.25, default: 0.18 }),
  apex_at: 0.58,
  /** Collision path sampling step (m) and the minimum flight before a tree can be hit (m). */
  path_step_m: 2,
  /** Roll: fraction from physics/lm/roll.js rollFrac(land_deg, ground) × these lie multipliers (§C.3). */
  roll_mult: f({ fairway: 1, tee: 1, green: 1, rough: 0.35, bunker: 0, water: 0, ob: 0 }),
  roll_step_m: 0.5,
  /** Water drop: back along the incoming line to the nearest dry point, then this much further (§C.3). */
  water_drop_back_m: 2,
  /** OB drop_2: the nearest fairway edge point, moved this far inside the fairway. */
  ob_drop_inside_m: 1,
  /** Max score (§C.3): double par, then the ball is picked up. */
  max_score_par_mult: 2,
  /** Cup radius (m): a rest this close to the pin is holed. A missed putt leaves at least miss_min_m. */
  cup_m: 0.054,
  /** Putting (§C.3, sim/putting.js). d50 = distance holed half the time, by handicap band 0 / 10 / 20 / 30.
   *  p(d) = clamp(exp(−(max(0, d − tap_in_m) / (d50 − tap_in_m))^k · ln 2), p_min, p_max)  — tap_in_m is a V4-C
   *  addition (see docs/research/sim-params.md): the spec curve alone gives ~0.78 at 0.5 m for band 30. */
  putt: f({
    d50: f({ 0: 2.4, 10: 1.8, 20: 1.4, 30: 1.1 }),
    k: 1.3, tap_in_m: 0.45, p_min: 0.02, p_max: 0.995,
    leave_sigma_frac: 0.08, leave_sigma_m: 0.25, miss_min_m: 0.1, max_putts: 4,
    /** Green slope makes d50 shorter: d50 / (1 + slope_k · max(0, slope_pct − slope_ref)). */
    slope_k: 0.08, slope_ref: 1,
  }),
  /** Auto chip (§C.3): leave |N(0, sigma_frac · d)| × skill factor from the pin, on the green. */
  chip: f({ sigma_frac: 0.12, skill: f({ 0: 0.8, 10: 1, 20: 1.2, 30: 1.45 }), club: 'sw' }),
  /** Recommendation: plays-like = (distance + dz · dz_factor) / lie carry factor. */
  dz_factor: 1,
});
