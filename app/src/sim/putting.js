// sim/putting.js — distance-model auto putting (V04-SPEC §C.3: one-putt probability by distance and putting level,
// at most 4 putts). Lazy, pure. STUB created by V4-A drop 1 with the FROZEN signature; owner V4-C.

/**
 * Putt out the given player on the current hole (strokes tagged RC.AUTO_PUTT, source 'auto_putt').
 * @param {object} round   golf-round/1 (the player's ball is on the green)
 * @param {string|object} player   player_id or the player record
 * @param {() => number} [rng]
 * @returns {{ round: object, strokes: object[] }}
 */
export function autoPutt(round, player, rng) {
  throw Object.assign(new Error('autoPutt: V4-C pending'), { code: 'PACKAGE_PENDING' });
}
