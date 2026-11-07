// sim/lies.js — what a lie does to the next stroke and to the roll (V04-SPEC §C.3). Lazy, pure. Owner V4-C.
//
//   lieFactors(lie, club, style?) -> { carry, sigma, adjusted }   carry / σ multipliers for a stroke played FROM `lie`
//       (rough ×0.90 carry, woods ×0.85, σ ×1.3; bunker ×0.85, woods ×0.70, σ ×1.5; desert rough heavier, STYLE_TRAITS)
//   rollGround(lie, style?) -> 'firm'|'normal'|'soft'|null   ground for physics/lm/roll.js at the landing lie
//       (green soft, links fairway firm, rough normal × roll_mult, bunker / water / OB no roll)
//   rollFraction(club, lie, style?, landDeg?) -> fraction of the carry the ball rolls after landing on `lie`
//   isWood(club)   landTan(club)   apexFrac(club)

import { SIM_PARAMS as P } from './params.js';
import { STYLE_TRAITS } from '../course/styles.js';
import { rollFrac } from '../physics/lm/roll.js';

export const isWood = (club) => P.woods.includes(club);
export const landDeg = (club) => P.land_deg[club] ?? P.land_deg.default;
export const landTan = (club) => P.land_tan[club] ?? P.land_tan.default;
export const apexFrac = (club) => P.apex_frac[club] ?? P.apex_frac.default;

export function lieFactors(lie, club, style = null) {
  const row = P.lie[lie] ?? P.lie.fairway;
  let carry = isWood(club) ? row.wood : row.carry;
  let sigma = row.sigma;
  if (lie === 'rough' && style && STYLE_TRAITS[style]) {
    carry *= STYLE_TRAITS[style].roughCarry;
    sigma *= STYLE_TRAITS[style].roughSigma;
  }
  return { carry, sigma, adjusted: carry !== 1 || sigma !== 1 };
}

export function rollGround(lie, style = null) {
  if (lie === 'green') return 'soft';
  if (lie === 'bunker' || lie === 'water' || lie === 'ob') return null;
  return style && STYLE_TRAITS[style] ? STYLE_TRAITS[style].ground : 'normal';
}

export function rollFraction(club, lie, style = null, landDegOverride = null) {
  const g = rollGround(lie, style);
  if (g === null) return 0;
  const mult = P.roll_mult[lie] ?? 1;
  return rollFrac(landDegOverride ?? landDeg(club), g) * mult;
}
