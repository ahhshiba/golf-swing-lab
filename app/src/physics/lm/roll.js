// Landing roll (RN §6; LAUNCH-MONITOR-SPEC §1.2 #15, #17): roll = carry · frac(landing angle, ground), a purely
// empirical table (LM_PARAMS.roll, UNVERIFIED), linear between the knots and held beyond them. Landing spin is
// ignored (a high-spin wedge may check or back up; the model does not know) -> ROLL_MODELLED. Lazy module.

import { LM_PARAMS } from './params.js';
import { interp } from './dplane.js';

export const LM_GROUND_DEFAULT = 'normal';

/** Roll fraction of the carry for a landing angle (°) on 'firm' | 'normal' | 'soft' ground (unknown -> normal). */
export function rollFrac(landingDeg, ground = LM_GROUND_DEFAULT) {
  const R = LM_PARAMS.roll;
  const ys = R[ground] ?? R[LM_GROUND_DEFAULT];
  return Math.max(0, interp(landingDeg, R.angle_knots_deg, ys));
}
