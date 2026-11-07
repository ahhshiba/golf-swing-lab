// course/generate.js — seeded, engine-independent course generator (V04-SPEC §C.2). Lazy, pure (course/detmath.js
// arithmetic only, output quantised to 0.1 m). STUB created by V4-A drop 1 with the FROZEN signature; owner V4-C.

/** Generator version written into golf-round/1 course.generator (a round stores the whole geometry snapshot). */
export const COURSE_GENERATOR = 'course-1';

/**
 * @typedef {object} Course  golf-round/1 `course` minus nothing: { generator, style, seed, holes_n, tees, holes: Hole[] }
 * @param {{ seed: number, style: 'parkland'|'links'|'desert'|'mixed', holes: 9|18, tees: 'forward'|'middle'|'back' }} opts
 *   seed: uint32. 18 holes = 4 × par 3 + 10 × par 4 + 4 × par 5 (par 72); 9 holes = 2 / 5 / 2.
 * @returns {Course}
 */
export function generateCourse(opts) {
  throw Object.assign(new Error('generateCourse: V4-C pending'), { code: 'PACKAGE_PENDING' });
}
