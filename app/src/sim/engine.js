// sim/engine.js — one simulated stroke outcome from an input (quick read, imported shot, manual entry) under the round
// rules (V04-SPEC §B, §C.3). Lazy, pure (randomness only through the given rng). Owner V4-C.
// The outcome says WHAT was hit (carry, side, their sources and the values drawn); sim/round.js playStroke says
// WHERE it ends up on the hole. Manual numbers stay in the round record only (MANUAL_FEEDS_GAPPING = false).

import { mulberry32 } from '../geom/rng.js';
import { carrySource, sideSource } from './source.js';
import { ELLIPSE_K95 } from './params.js';

/**
 * Flight shape of an imported shot from its flight.samples ([t, down, mat-left, up], LM-INTERFACES §1): apex height
 * above the start (m) and the descent angle of the last segment (°), both rounded to 0.1, or null without samples.
 * Stored in the stroke's draw so the replay (arithmetic only) reproduces tree and slope handling.
 */
export function flightShape(samples) {
  if (!Array.isArray(samples) || samples.length < 3) return null;
  const z0 = samples[0][3];
  let apex = 0;
  for (const p of samples) if (Number.isFinite(p[3]) && p[3] - z0 > apex) apex = p[3] - z0;
  const a = samples[samples.length - 2], b = samples[samples.length - 1];
  const h = Math.hypot(b[1] - a[1], b[2] - a[2]);
  const dz = a[3] - b[3];
  if (!(apex >= 1) || !(h > 0) || !(dz > 0)) return null;
  const deg = (Math.atan2(dz, h) * 180) / Math.PI;
  const r1 = (x) => Math.round(x * 10) / 10;
  return { apex_m: r1(apex), land_deg: r1(Math.min(75, Math.max(10, deg))) };
}

/**
 * @typedef {object} RoundValue  golf-round/1 stroke carry / side block: { value, ci95, sigma, validity, origin, reason_codes }
 *   (validity never 'valid'; origin 'manual' carries RC.MANUAL_ENTRY; a non-manual number carries ci95 or sigma)
 * @typedef {object} Outcome
 * @property {RoundValue} carry
 * @property {RoundValue} side                 + = away from the golfer (LM-INTERFACES §1 sign)
 * @property {{ seed: number, carry_m: number, side_m: number, apex_m?: number, land_deg?: number }} draw   the values actually
 *   used (replayable); apex_m / land_deg only for an imported shot with flight.samples (else the club prior applies)
 * @property {'quick'|'shot'|'manual'|'auto_putt'|'auto_chip'} source
 * @property {string|null} shot_id
 * @property {{ sx: number, sy: number }} ellipse   95 % landing ellipse half-axes (ELLIPSE_K95 = 2.448 σ, 2 dof), metres (lie-scaled): sx across, sy along
 * Optional extras (V4-C): club, lie, view, merge ({ pose, gap } inverse-variance weights for the details sheet) | null.
 */

/**
 * @param {{ input: { kind: 'quick', result: object } | { kind: 'shot', shot: object } | { kind: 'manual', carry_m: number, side_m: number|null },
 *   view: 'face_on'|'dtl'|'high_behind'|null, club: string, player: object, rows: { gap: object|null, side: object|null },
 *   rules: object, rng: () => number, lie?: string, style?: string, seed?: number }} args
 *   lie (optional, default 'fairway'): the lie the stroke is played from (sim/lies.js factors; manual input is never
 *   adjusted). style: the hole's style (desert rough). seed: the draw seed (default: one uint32 from rng).
 * @returns {Outcome}
 */
export function shotOutcome(args) {
  const { input, view = null, club, player = {}, rows = {}, rules = {}, rng, lie = 'fairway', style = null } = args ?? {};
  if (!input || typeof input !== 'object') throw new TypeError('shotOutcome: input is required');
  if (typeof club !== 'string' || !club) throw new TypeError('shotOutcome: club is required');
  let seed = args.seed;
  if (!(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff)) {
    if (typeof rng !== 'function') throw new TypeError('shotOutcome: rng or seed is required');
    seed = Math.floor(rng() * 4294967296) >>> 0;
  }
  const sub = mulberry32(seed);
  const c = carrySource({ input, view, club, player, rows: rows ?? {}, lie, style });
  const s = sideSource({ input, view, club, player, rows: rows ?? {}, rules: rules ?? {}, carry_m: c.value.value, lie, style, rng: sub });
  const shape = input.kind === 'shot' ? flightShape(input.shot?.flight?.samples) : null;
  return {
    carry: c.value,
    side: s.value,
    draw: shape ? { seed, carry_m: c.value.value, side_m: s.draw_m, ...shape } : { seed, carry_m: c.value.value, side_m: s.draw_m },
    source: input.kind,
    shot_id: input.kind === 'shot' ? input.shot?.shot_id ?? null : null,
    ellipse: { sx: Math.round(ELLIPSE_K95 * s.sigma_used * 100) / 100, sy: Math.round(ELLIPSE_K95 * c.sigma_used * 100) / 100 },
    club, lie, view: c.view, merge: c.merge,
  };
}
