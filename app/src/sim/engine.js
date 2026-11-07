// sim/engine.js — one simulated stroke outcome from an input (quick read, imported shot, manual entry) under the round
// rules (V04-SPEC §B, §C.3). Lazy, pure (randomness only through the given rng). STUB created by V4-A drop 1 with the
// FROZEN signature; owner V4-C.

/**
 * @typedef {object} RoundValue  golf-round/1 stroke carry / side block: { value, ci95, sigma, validity, origin, reason_codes }
 *   (validity never 'valid'; origin 'manual' carries RC.MANUAL_ENTRY; a non-manual number carries ci95 or sigma)
 * @typedef {object} Outcome
 * @property {RoundValue} carry
 * @property {RoundValue} side                 + = away from the golfer (LM-INTERFACES §1 sign)
 * @property {{ seed: number, carry_m: number, side_m: number }} draw   the values actually used (replayable)
 * @property {'quick'|'shot'|'manual'|'auto_putt'|'auto_chip'} source
 * @property {string|null} shot_id
 * @property {{ sx: number, sy: number }} ellipse   95 % landing ellipse half-axes, metres (lie-scaled)
 */

/**
 * @param {{ input: { kind: 'quick', result: object } | { kind: 'shot', shot: object } | { kind: 'manual', carry_m: number, side_m: number|null },
 *   view: 'face_on'|'dtl'|'high_behind'|null, club: string, player: object, rows: { gap: object|null, side: object|null },
 *   rules: object, rng: () => number }} args
 * @returns {Outcome}
 */
export function shotOutcome(args) {
  throw Object.assign(new Error('shotOutcome: V4-C pending'), { code: 'PACKAGE_PENDING' });
}
