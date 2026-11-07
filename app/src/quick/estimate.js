// quick/estimate.js — the quick read (速報) computed at IMPACT from the 30 Hz wrist samples (V04-SPEC §A.2–A.4).
// Lazy. STUB created by V4-A drop 1 with the FROZEN signature (docs/V04-INTERFACES.md §4); owner V4-B replaces the body.
// Pure: no DOM. A quick value is never written into a golf-shot (only diag live.quick_log and the round record).

/**
 * @typedef {object} Metric  contract metric shape (docs/interfaces.md §9): value, ci95, sigma, unit, validity,
 *   value_origin, reason_codes. A quick metric's validity is 'low_confidence' or null, never 'valid'; every non-null
 *   one carries ci95 and RC.PROVISIONAL.
 * @typedef {object} QuickResult
 * @property {'provisional'} stage
 * @property {number} t_impact                       seconds, media timeline
 * @property {Object<string, Metric>} metrics        backswing_s, downswing_s, tempo_ratio, club_speed_mps (face_on), carry_m
 * @property {'pose'|'gapping'|'reference'|null} carry_source
 * @property {{ compute: number }} timings_ms
 */

/**
 * @param {{ samples: Array<object>, impact: object, view: 'face_on'|'dtl'|'high_behind', fps: number, club: string,
 *   handedness: 'right'|'left', calibration: object|null, gappingRow: object|null, settings: object }} input
 *   impact = the events/live.js 'impact' event { t_impact, impact_source, t_address, t_swing, t_top, peak_mps, conf,
 *   reason_codes }; gappingRow = store/stats.js gapping() row of this club (n ≥ 5) or null.
 * @returns {QuickResult}
 */
export function quickEstimate(input) {
  throw Object.assign(new Error('quickEstimate: V4-B pending'), { code: 'PACKAGE_PENDING' });
}
