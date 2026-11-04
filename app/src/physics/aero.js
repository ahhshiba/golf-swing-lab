// Golf-ball aerodynamics shared by fit3d (short span after impact) and ballistics (full carry flight).
//
// Force model (per unit mass):  a = g + K·|v|·(−Cd·v + Cl·|v|·(ŵ × v̂)),  K = ρ·A / (2·m)
//   ŵ = unit spin axis, fixed in space (pure backspin: ŵ = unit(v₀ × ẑ), horizontal, ⊥ launch velocity).
// Coefficients as functions of the spin ratio S = ω·r / |v|:
//   Cd = CD1 + CD2·S,   Cl = CL1·S^0.4
// Functional form: Smits & Smith (1994), "A new aerodynamic model of a golf ball in flight", Science and Golf II,
// pp. 340–347 (published constants CD1 = 0.24, CD2 = 0.18, CL1 = 0.54, plus a Reynolds-number term in Cd that is
// left out here). With the published constants the model over-carries tour irons by 5–10 %, so CD1, CD2, CL1 were
// re-fitted (this module, 2026-11-04) to the widely quoted TrackMan PGA/LPGA tour averages (driver … PW,
// 14 clubs; carry RMS error 2.0 %, worst −4.4 % driver / +2.6 % LPGA 7-iron; apex within ±12 %). The tour table
// was taken from memory of the published charts, not re-checked against the source: UNVERIFIED, and the whole
// model is unvalidated against a launch monitor (CAFCR 待決定 5).
// Spin decay: dω/dt = −R1·ω·|v|/r with R1 = 2e-5 (the Smits & Smith decay constant; form assumed).

import { AIR_RHO, BALL_MASS, BALL_R, G } from '../geom/constants.js';

export const BALL_AREA = Math.PI * BALL_R * BALL_R;
/** K = ρ·A / (2·m) in 1/m: drag deceleration = K·Cd·|v|². */
export const K_AERO = (AIR_RHO * BALL_AREA) / (2 * BALL_MASS);

export const AERO_MODEL = Object.freeze({
  CD1: 0.225,
  CD2: 0.287,
  CL1: 0.462,
  CL_EXP: 0.4,
  SPIN_DECAY_R1: 2e-5,
  /** 1σ relative carry error of the model against the reference table (RMS 2.0 % rounded up). */
  CARRY_MODEL_SIGMA_FRAC: 0.03,
});

/** Drag prior for fit3d when no club is known (task spec: Cd ≈ 0.25 ± 0.05). */
export const CD_PRIOR = Object.freeze({ mean: 0.25, sigma: 0.05 });

export const RPM_TO_RAD_S = (2 * Math.PI) / 60;

/** Spin ratio S = ω·r / |v| (ω in rad/s). */
export function spinRatio(omegaRadS, speed) {
  return speed > 0 ? (omegaRadS * BALL_R) / speed : 0;
}

/** { cd, cl } for spin ratio S (S < 0 is treated as 0). */
export function aeroCoefficients(S) {
  const s = S > 0 ? S : 0;
  return { cd: AERO_MODEL.CD1 + AERO_MODEL.CD2 * s, cl: AERO_MODEL.CL1 * Math.pow(s, AERO_MODEL.CL_EXP) };
}

/** Backspin axis for a launch velocity v0: unit(v0 × ẑ) (horizontal, ⊥ v0). Falls back to −ŷ for vertical v0. */
export function backspinAxis(v0) {
  const wx = v0[1];
  const wy = -v0[0];
  const n = Math.hypot(wx, wy);
  return n > 1e-12 ? [wx / n, wy / n, 0] : [0, -1, 0];
}

/**
 * Acceleration for velocity (vx, vy, vz) with constant cd, cl and spin axis w; written into out[0..2].
 * Lift = K·Cl·|v|²·(ŵ × v̂) (for ŵ ⊥ v its magnitude is K·Cl·|v|²).
 */
export function accelInto(out, vx, vy, vz, cd, cl, w) {
  const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
  const kd = K_AERO * cd * sp;
  const kl = K_AERO * cl * sp; // · |v| · v̂ = · v
  // ŵ × v
  const cx = w[1] * vz - w[2] * vy;
  const cy = w[2] * vx - w[0] * vz;
  const cz = w[0] * vy - w[1] * vx;
  out[0] = -kd * vx + kl * cx;
  out[1] = -kd * vy + kl * cy;
  out[2] = -G - kd * vz + kl * cz;
  return out;
}
