// share/card.js — static share cards (V04-SPEC §D.3): every distance / speed carries ± or a range, never the word
// "measured"; a round card says "simulated". Lazy. STUB created by V4-A drop 1 with the FROZEN signatures; owner V4-E.

/**
 * One shot, 1080 × 1350.
 * @param {HTMLCanvasElement} canvas
 * @param {{ shot: object, units: object, palette: object, locale: string }} opts
 * @returns {{ a11y: string, params: object }}
 */
export function drawShotCard(canvas, opts) {
  throw Object.assign(new Error('drawShotCard: V4-E pending'), { code: 'PACKAGE_PENDING' });
}

/**
 * One practice session, 1080 × 1350.
 * @param {HTMLCanvasElement} canvas
 * @param {{ shots: object[], filter: object, units: object, palette: object }} opts
 * @returns {{ a11y: string, params: object }}
 */
export function drawSessionCard(canvas, opts) {
  throw Object.assign(new Error('drawSessionCard: V4-E pending'), { code: 'PACKAGE_PENDING' });
}

/**
 * A round's scorecard for one player.
 * @param {HTMLCanvasElement} canvas
 * @param {{ round: object, playerId: string }} opts
 * @returns {{ a11y: string, params: object }}
 */
export function drawRoundCard(canvas, opts) {
  throw Object.assign(new Error('drawRoundCard: V4-E pending'), { code: 'PACKAGE_PENDING' });
}
