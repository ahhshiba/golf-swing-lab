// Resting ball on the ball spot (CAFCR C3 step C7, C1.4 tee lift) and the flight-frame budget (C1.1 飛行幀數).

import { BALL_R, DEG, G, TEE_LIFT_PRIOR_M, TEE_LIFT_PRIOR_SIGMA_M } from '../geom/constants.js';
import { ray, intersectRayZ, toCamera, nominalCamera, makeCamera, center, distortNormalized } from '../geom/camera.js';
import { RC } from '../contract/reason-codes.js';

/** Sigma of a measured tee lift (CAFCR C1.4: measured to ±5 mm). */
export const TEE_LIFT_MEASURED_SIGMA_M = 0.005;
/** Minimum flight frames before the setup warns (CAFCR C1.1: budget < 6 → TRACK_MAY_BE_SHORT). */
export const FRAMES_BUDGET_MIN = 6;

/**
 * Ball-centre height model for a lie: { z_m (ball centre), sigma_z_m, tee_lift_m, tee_lift_source, reason_codes }.
 * lie 'mat': centre at BALL_R. lie 'tee': BALL_R + tee lift; 'measured' uses tee_lift_m ± 5 mm, 'assumed' uses
 * TEE_LIFT_PRIOR_M ± TEE_LIFT_PRIOR_SIGMA_M and adds TEE_LIFT_ASSUMED (tee_lift_m is ignored then); a 'measured'
 * source without a finite tee_lift_m is treated as assumed.
 */
export function ballHeight(lie = 'mat', tee_lift_m = null, tee_lift_source = 'measured') {
  if (lie === 'mat') return { z_m: BALL_R, sigma_z_m: 0, tee_lift_m: 0, tee_lift_source: 'measured', reason_codes: [] };
  if (lie !== 'tee') throw new RangeError(`ballHeight: lie must be 'mat' or 'tee' (got '${lie}')`);
  if (tee_lift_source === 'measured' && Number.isFinite(tee_lift_m)) {
    return { z_m: BALL_R + tee_lift_m, sigma_z_m: TEE_LIFT_MEASURED_SIGMA_M, tee_lift_m, tee_lift_source, reason_codes: [] };
  }
  return {
    z_m: BALL_R + TEE_LIFT_PRIOR_M,
    sigma_z_m: TEE_LIFT_PRIOR_SIGMA_M,
    tee_lift_m: TEE_LIFT_PRIOR_M,
    tee_lift_source: 'assumed',
    reason_codes: [RC.TEE_LIFT_ASSUMED],
  };
}

function hitPlane(cam, u, v, z) {
  return intersectRayZ(ray(cam, u, v), z);
}

/**
 * 3D position of a resting ball from its image centre (u, v): the viewing ray intersected with the horizontal
 * plane z = BALL_R + tee_lift. opts: { sigma_px = 0.5 (centroid sigma per axis) }.
 * Returns { X: [x, y, z] | null, sigma: [sx, sy, sz] | null, cov (3×3 rows) | null, z_plane_m, tee_lift_m,
 *           tee_lift_source, reason_codes }. A ray that misses the plane gives X = null with IMPLAUSIBLE_VALUE.
 */
export function restBall3D(cam, u, v, lie = 'mat', tee_lift_m = null, tee_lift_source = 'measured', opts = {}) {
  const hgt = ballHeight(lie, tee_lift_m, tee_lift_source);
  const sp = opts.sigma_px ?? 0.5;
  const base = { z_plane_m: hgt.z_m, tee_lift_m: hgt.tee_lift_m, tee_lift_source: hgt.tee_lift_source };
  const X = hitPlane(cam, u, v, hgt.z_m);
  if (!X) return { X: null, sigma: null, cov: null, ...base, reason_codes: [...hgt.reason_codes, RC.IMPLAUSIBLE_VALUE] };
  const h = 0.25;
  const dz = 0.001;
  const cols = [];
  const pu = hitPlane(cam, u + h, v, hgt.z_m);
  const mu = hitPlane(cam, u - h, v, hgt.z_m);
  const pv = hitPlane(cam, u, v + h, hgt.z_m);
  const mv = hitPlane(cam, u, v - h, hgt.z_m);
  const pz = hitPlane(cam, u, v, hgt.z_m + dz);
  const mz = hitPlane(cam, u, v, hgt.z_m - dz);
  if (!pu || !mu || !pv || !mv || !pz || !mz) {
    return { X, sigma: null, cov: null, ...base, reason_codes: [...hgt.reason_codes, RC.IMPLAUSIBLE_VALUE] };
  }
  cols.push([0, 1, 2].map((k) => ((pu[k] - mu[k]) / (2 * h)) * sp));
  cols.push([0, 1, 2].map((k) => ((pv[k] - mv[k]) / (2 * h)) * sp));
  cols.push([0, 1, 2].map((k) => ((pz[k] - mz[k]) / (2 * dz)) * hgt.sigma_z_m));
  const cov = [0, 1, 2].map((a) => [0, 1, 2].map((b) => cols.reduce((s, c) => s + c[a] * c[b], 0)));
  return { X, sigma: [0, 1, 2].map((k) => Math.sqrt(cov[k][k])), cov, ...base, reason_codes: hgt.reason_codes };
}

/**
 * Predicted horizontal image width (px) of a ball of radius r centred at world X: the exact u-extent of the
 * sphere's silhouette (tangent planes through the camera y axis), with k1 applied at the two tangent points.
 * NaN when the ball is not fully in front of the camera.
 */
export function predictedBallWidthPx(cam, X, r = BALL_R) {
  const P = toCamera(cam, X);
  const a = P[2] * P[2] - r * r;
  const q = P[0] * P[0] + P[2] * P[2] - r * r;
  if (!(P[2] > r && a > 0 && q > 0)) return NaN;
  const sq = r * Math.sqrt(q);
  const x1 = (P[0] * P[2] - sq) / a;
  const x2 = (P[0] * P[2] + sq) / a;
  if (!cam.k1) return cam.f * (x2 - x1);
  const y = P[1] / P[2];
  const d1 = distortNormalized(cam.k1, x1, y);
  const d2 = distortNormalized(cam.k1, x2, y);
  return cam.f * (d2[0] - d1[0]);
}

/**
 * Flight-frame budget, CAFCR C1.1 conservative model: the ball leaves the spot at t = 0 with speed_mps at
 * launch_deg (vertical) toward +x (opts.launch_h_deg rotates toward +y), under gravity, no drag; it counts as
 * tracked while its projected centre stays inside the centred `box` (90 %) of the image; frames = exit time ×
 * fps − 1 (the impact frame is not usable).
 * cam: camera, or null for nominalCamera(view). shift (optional, face_on only): overrides the camera centre X
 * (camera translated along the target line, not rotated); ignored for other views.
 * opts: { fps = 240, box = 0.9, launch_h_deg = 0, z0_m = BALL_R (ball-centre start height), max_s = 1 }.
 * Returns { frames, exit_s, exit: 'right'|'left'|'top'|'bottom'|'behind'|'none', reason_codes }
 * ('none' = still inside the box at max_s; reason_codes has TRACK_MAY_BE_SHORT when frames < 6).
 */
export function framesBudget(cam, view, speed_mps, launch_deg, shift, opts = {}) {
  const fps = opts.fps ?? 240;
  const box = opts.box ?? 0.9;
  const maxS = opts.max_s ?? 1;
  const z0 = opts.z0_m ?? BALL_R;
  let c = cam ?? nominalCamera(view);
  if (Number.isFinite(shift) && view === 'face_on') {
    const C = center(c);
    c = makeCamera({ ...c, R: c.R, t: undefined, C: [shift, C[1], C[2]] });
  }
  const la = launch_deg * DEG;
  const lh = (opts.launch_h_deg ?? 0) * DEG;
  const vx = speed_mps * Math.cos(la) * Math.cos(lh);
  const vy = speed_mps * Math.cos(la) * Math.sin(lh);
  const vz = speed_mps * Math.sin(la);
  const hu = (box * c.W) / 2;
  const hv = (box * c.H) / 2;
  const state = (t) => {
    const P = toCamera(c, [vx * t, vy * t, z0 + vz * t - 0.5 * G * t * t]);
    if (!(P[2] > 1e-6)) return 'behind';
    let x = P[0] / P[2];
    let y = P[1] / P[2];
    if (c.k1) [x, y] = distortNormalized(c.k1, x, y);
    const du = c.f * x;
    const dv = c.f * y;
    if (du > hu) return 'right';
    if (du < -hu) return 'left';
    if (dv < -hv) return 'top';
    if (dv > hv) return 'bottom';
    return null;
  };
  const codes = [];
  if (state(0) !== null) {
    codes.push(RC.TRACK_MAY_BE_SHORT);
    return { frames: 0, exit_s: 0, exit: state(0), reason_codes: codes };
  }
  const dt = 1e-4;
  let t = 0;
  let side = null;
  while (t < maxS) {
    const s = state(t + dt);
    if (s !== null) { side = s; break; }
    t += dt;
  }
  if (side === null) return { frames: maxS * fps - 1, exit_s: Infinity, exit: 'none', reason_codes: codes };
  let lo = t;
  let hi = t + dt;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    if (state(mid) === null) lo = mid; else hi = mid;
  }
  const exit_s = 0.5 * (lo + hi);
  const frames = exit_s * fps - 1;
  if (frames < FRAMES_BUDGET_MIN) codes.push(RC.TRACK_MAY_BE_SHORT);
  return { frames, exit_s, exit: state(hi) ?? side, reason_codes: codes };
}
