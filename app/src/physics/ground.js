// Ground-plane geometry for the high_behind view (CAFCR C1.3): viewing rays mapped onto a (near-)horizontal
// plane through the mat calibration, and the calibration-error modes used by the club-path and launch-direction
// uncertainty. Pure.
//
// The mat homography is the calibrated camera itself (calib/ solves the camera from the four mat corners), so
// "pixel -> ground" is the viewing ray intersected with z = z(x). A constant plane height z0 maps every point by
// the same homothety about the camera's ground foot (scale (h − z0)/h): directions on the ground are unchanged.
// Only a height that varies along the path (attack angle) or a camera off the ball line turns directions, which is
// why the club-path systematic is computed with the actual camera (CAFCR C1.3 "平面假設").

import { center, project, ray } from '../geom/camera.js';
import { mat3Mul, mat3MulVec, mat3Transpose, rotAxisAngle } from '../geom/linalg.js';
import { BALL_SPOT } from './perturb.js';
import { DEFAULT_VENUE, matCorners } from '../calib/mat.js';
import { CORNER_SIGMA_PX } from '../calib/pnp.js';

/** Fallback calibration sigmas (deg) when nothing better is known (C1.3: ground-homography yaw σ 0.42–0.58°). */
export const GROUND_YAW_SIGMA_FALLBACK_DEG = 0.5;
export const CALIB_ROLL_SIGMA_FALLBACK_DEG = 0.3;

/**
 * Ray of pixel (u, v) intersected with the plane z = z0 + (x − xRef)·tanA (a plane tilted along x by the attack
 * angle A). Returns [x, y, z] or null (ray parallel to the plane, or behind the camera).
 */
export function rayToGround(cam, u, v, z0 = 0, tanA = 0, xRef = 0) {
  const { C, d } = ray(cam, u, v);
  if (!Number.isFinite(d[0])) return null;
  const den = d[2] - d[0] * tanA;
  if (!(Math.abs(den) > 1e-12)) return null;
  const s = (z0 + (C[0] - xRef) * tanA - C[2]) / den;
  if (!(s > 0)) return null;
  return [C[0] + s * d[0], C[1] + s * d[1], C[2] + s * d[2]];
}

/**
 * Copy of cam rotated by angleRad about the vertical axis through P (camera centre and orientation turn together,
 * so P keeps its pixel). This is the calibration "yaw" error mode of a mat solve that pins the ball spot: every
 * ground direction seen by the camera turns by the same angle (1:1 on club path and launch direction).
 */
export function yawAboutPoint(cam, angleRad, P = BALL_SPOT) {
  const Q = rotAxisAngle([0, 0, 1], angleRad);
  const C = center(cam);
  const rel = [C[0] - P[0], C[1] - P[1], C[2] - P[2]];
  const r2 = mat3MulVec(Q, rel);
  const C2 = [P[0] + r2[0], P[1] + r2[1], P[2] + r2[2]];
  const R = mat3Mul(cam.R, mat3Transpose(Q));
  const t = mat3MulVec(R, C2);
  return { ...cam, R, t: [-t[0], -t[1], -t[2]] };
}

/** Lateral offset of the camera centre from the ball line y = 0 (m, signed, world frame). */
export function sideOffset(cam) {
  return center(cam)[1];
}

/**
 * 1σ error (deg) of a ground direction along the target line implied by the mat solve: each corner's pixel noise
 * (sigmaPx, isotropic) moves its ground point laterally by |∂y/∂(u, v)|·sigmaPx; the trail pair (x < 0) and the
 * lead pair (x > 0) each fix one lateral position (mean of the two corners), and the direction is their difference
 * over the mat length. On the nominal high_behind geometry with 3 px corners this is ≈ 0.27°; the synthetic mat
 * solves of tests/synth/cells.js give an SD of 0.24° for the actual ground-direction error, while the pose yaw σ
 * of the same solves (0.35–0.39°) over-states it because heading and lateral position errors are anti-correlated
 * when the mat is pinned. corners: the four mat corners in M ([tn, ln, lf, tf], calib/mat.js matCorners).
 */
export function groundDirSigmaDeg(cam, corners, sigmaPx) {
  const lat = corners.map(([x, y]) => {
    const p = projectGround(cam, x, y);
    if (!p) return NaN;
    const a = rayToGround(cam, p.u + 1, p.v, 0);
    const b = rayToGround(cam, p.u, p.v + 1, 0);
    const c = rayToGround(cam, p.u, p.v, 0);
    if (!a || !b || !c) return NaN;
    return Math.hypot(a[1] - c[1], b[1] - c[1]) * sigmaPx;
  });
  const xs = corners.map((c) => c[0]);
  const trail = [0, 1, 2, 3].filter((k) => xs[k] < 0);
  const lead = [0, 1, 2, 3].filter((k) => xs[k] >= 0);
  const pair = (ks) => Math.sqrt(ks.reduce((s, k) => s + lat[k] ** 2, 0)) / ks.length;
  const L = Math.max(...xs) - Math.min(...xs);
  const s = Math.hypot(pair(trail), pair(lead)) / L;
  return Number.isFinite(s) ? (s * 180) / Math.PI : NaN;
}

function projectGround(cam, x, y) {
  const p = project(cam, [x, y, 0]);
  return p.z > 0 ? p : null;
}

/**
 * Calibration terms for the high_behind ground directions: { yaw_deg (ground-direction σ, groundDirSigmaDeg with
 * the automatic-corner σ of calib/pnp.js CORNER_SIGMA_PX.auto = 3 px, the conservative case), roll_deg
 * (calibration pose_sigma.roll_deg) }. venue = { mat_L, mat_W, ball_edge_m, ball_x_m } (default calib/mat.js).
 */
export function groundCalibSigmas(cam, calibration, venue) {
  let yaw = groundDirSigmaDeg(cam, matCorners(venue ?? DEFAULT_VENUE), CORNER_SIGMA_PX.auto);
  if (!Number.isFinite(yaw)) yaw = GROUND_YAW_SIGMA_FALLBACK_DEG;
  const r = calibration?.pose_sigma?.roll_deg;
  return { yaw_deg: yaw, roll_deg: Number.isFinite(r) ? r : CALIB_ROLL_SIGMA_FALLBACK_DEG };
}
