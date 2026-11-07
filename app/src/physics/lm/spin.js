// Spin rate from spin loft (RN §2; LAUNCH-MONITOR-SPEC §1.2 #12): an oblique impact where the ball rolls off the face
// gives ω ≈ (5/7)·v_t/r with v_t ∝ v_club·sin(SL) (Penner 2001, reconstructed; UNVERIFIED), written per club category
// with one effective coefficient A fitted to the tour row (LM_PARAMS.clubs[*].a_spin): spin = A·v_club·sin(SL)/r.
// Above SL_MAX (friction ceiling, ≈ 45–50°) the spin stops rising: SL is clamped and the A scatter widened.
// The physics estimate is merged with the club's spin prior (physics/ballistics.js SPIN_PRIORS) by inverse variance.

import { BALL_R } from '../../geom/constants.js';
import { clubCategory } from '../ballistics.js';
import { LM_PARAMS } from './params.js';

const D = Math.PI / 180;
const RAD_S_TO_RPM = 60 / (2 * Math.PI);

/** Category key of LM_PARAMS.clubs for a club ({ type } or a type string): a CLUB_CATEGORIES name or 'unknown'. */
export function lmCategory(club) {
  const type = club && typeof club === 'object' ? club.type : club;
  return clubCategory(type) ?? 'unknown';
}

/** LM_PARAMS.clubs entry of a club. */
export function clubParams(club) {
  return LM_PARAMS.clubs[lmCategory(club)];
}

/** Relative 1σ of the spin coefficient A for a club (wider when the club is unknown or SL is over the ceiling). */
export function spinCoefSigma(club, spinLoftDeg = 0) {
  const P = LM_PARAMS.spin;
  const base = lmCategory(club) === 'unknown' ? P.a_sigma_frac_unknown : P.a_sigma_frac;
  return spinLoftDeg > P.sl_max_deg ? Math.hypot(base, P.sl_over_sigma_frac) : base;
}

/** Physics spin (rpm) for club speed (m/s), spin loft (°) and a coefficient factor (1 = the fitted A). */
export function spinFromLoft(clubSpeed, spinLoftDeg, club, aFactor = 1) {
  const sl = Math.min(Math.max(spinLoftDeg, 0), LM_PARAMS.spin.sl_max_deg);
  return (clubParams(club).a_spin * aFactor * clubSpeed * Math.sin(sl * D) / BALL_R) * RAD_S_TO_RPM;
}

/**
 * Inverse-variance merge of the physics estimate { value, sigma } with the prior { mean_rpm, sigma_rpm }; the prior σ
 * is floored at prior_sigma_floor_frac × mean (tour-average priors are narrower than an amateur population).
 */
export function mergeSpin(phys, prior) {
  const sq = Math.max(prior.sigma_rpm, LM_PARAMS.spin.prior_sigma_floor_frac * prior.mean_rpm);
  const wp = 1 / (phys.sigma * phys.sigma), wq = 1 / (sq * sq);
  return { value: (phys.value * wp + prior.mean_rpm * wq) / (wp + wq), sigma: Math.sqrt(1 / (wp + wq)), w: wp / (wp + wq) };
}
