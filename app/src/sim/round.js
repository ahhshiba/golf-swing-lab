// sim/round.js — applying strokes to a golf-round/1 record, the derived scorecard and the deterministic replay
// (V04-SPEC §C.3, §F.2). Lazy, pure. STUB created by V4-A drop 1 with the FROZEN signatures; owner V4-C.
// contract/round.js validateRound(round, { replayRound }) uses replayRound for its replay_matches rule.

/**
 * Land an outcome from the current ball position toward `aim`: flight vs slope, trees, water, OB, roll, penalties,
 * max score, next player. Returns a NEW round (input untouched) and the stroke appended to it.
 * @param {object} round      golf-round/1
 * @param {import('./engine.js').Outcome} outcome
 * @param {{ x: number, y: number }} aim
 * @returns {{ round: object, stroke: object }}
 */
export function playStroke(round, outcome, aim) {
  throw Object.assign(new Error('playStroke: V4-C pending'), { code: 'PACKAGE_PENDING' });
}

/**
 * The scorecard (never stored): per player per hole strokes, putts, penalties; out / in / total; to par.
 * @param {object} round
 * @returns {{ players: Array<{ player_id: string, holes: Array<{ hole: number, par: number, strokes: number|null,
 *   putts: number|null, penalties: number, picked_up: boolean }>, out: number|null, in: number|null, total: number|null,
 *   to_par: number|null }> }}
 */
export function scorecard(round) {
  throw Object.assign(new Error('scorecard: V4-C pending'), { code: 'PACKAGE_PENDING' });
}

/**
 * Re-run every stroke from its stored draw and the round rules; same order and length as round.strokes.
 * @param {object} round
 * @returns {{ strokes: Array<{ rest: { x: number, y: number, lie: string } }> }}
 */
export function replayRound(round) {
  throw Object.assign(new Error('replayRound: V4-C pending'), { code: 'PACKAGE_PENDING' });
}
