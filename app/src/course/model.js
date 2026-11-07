// course/model.js — hole geometry queries (V04-SPEC §C.1). Lazy, pure (only + − × ÷ sqrt; no Math.sin/cos/random,
// no clock: course/detmath.js). STUB created by V4-A drop 1 with the FROZEN signature; owner V4-C.

/**
 * Lie at a point of a hole: OB (outside bounds) → water → bunker → green → fairway → rough (§C.1 order).
 * @param {object} hole   golf-round/1 Hole
 * @param {number} x      metres, east
 * @param {number} y      metres, north
 * @returns {'fairway'|'rough'|'bunker'|'green'|'water'|'ob'}
 */
export function lieAt(hole, x, y) {
  throw Object.assign(new Error('lieAt: V4-C pending'), { code: 'PACKAGE_PENDING' });
}
