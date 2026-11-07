// course/validate.js — geometric course rules (V04-SPEC §C.2: par lengths, green not touching water, pin ≥ 3 m from the
// green edge, a ≥ 25 m wide landing zone, hazards cover ≤ 35 % of the centreline, no self-intersecting polygons).
// Lazy, pure. STUB created by V4-A drop 1 with the FROZEN signature; owner V4-C. (The record shape is checked by
// contract/round.js validateRound.)

/**
 * @param {import('./generate.js').Course} course
 * @returns {{ ok: boolean, problems: Array<{ hole: number|null, rule: string, detail: string }> }}
 */
export function validateCourse(course) {
  throw Object.assign(new Error('validateCourse: V4-C pending'), { code: 'PACKAGE_PENDING' });
}
