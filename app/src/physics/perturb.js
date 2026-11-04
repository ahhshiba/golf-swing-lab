// Calibration-error modes of the estimator camera (CAFCR C1.1, K6). Used twice, with the same definitions:
//   * fit3d.js refits with a slightly perturbed camera to get per-shot sensitivities (speed, launch angle) to each
//     systematic term, which mc.js then draws as per-draw offsets;
//   * tests/synth/ballflight.js injects errors of exactly these kinds into the estimator camera, so the coverage
//     of the production ci95 is tested against data that really contains the errors mc.js assumes.
// Modes (each one keeps the ball spot's pixel fixed, as a mat calibration pins the mat around the ball):
//   scale      camera centre moved along the line to the ball spot by factor k (f/D scale, mat-size scale);
//   roll       camera rotated about the line camera centre → ball spot (image rotates about the ball spot);
//   distortion residual radial distortion, expressed as the radial displacement fraction at the image corner
//              (k1 = frac / r²corner, normalised coordinates, interfaces §2 xd = x·(1 + k1·r²)).

import { BALL_R } from '../geom/constants.js';
import { center, project, ray } from '../geom/camera.js';
import { mat3Mul, mat3MulVec, mat3Transpose, rotAxisAngle } from '../geom/linalg.js';

/** Ball spot (origin of M, interfaces §2). */
export const BALL_SPOT = Object.freeze([0, 0, 0]);

/** r² (normalised coordinates) of the image corner. */
export function cornerR2(cam) {
  return ((cam.W / 2) ** 2 + (cam.H / 2) ** 2) / (cam.f * cam.f);
}

/** k1 that displaces the image corner radially by the fraction frac (e.g. 0.01 = 1 %). */
export function k1FromCornerFrac(cam, frac) {
  return frac / cornerR2(cam);
}

/** Copy of cam with k1 replaced. */
export function withK1(cam, k1) {
  return { ...cam, k1 };
}

/** Copy of cam with its centre moved to P + k·(C − P) (orientation kept). */
export function scaleAboutPoint(cam, k, P = BALL_SPOT) {
  const C = center(cam);
  const C2 = [0, 1, 2].map((i) => P[i] + k * (C[i] - P[i]));
  const t = mat3MulVec(cam.R, C2);
  return { ...cam, t: [-t[0], -t[1], -t[2]] };
}

/** Copy of cam rotated by angleRad about the line from its centre through P (P keeps its pixel). */
export function rollAboutPoint(cam, angleRad, P = BALL_SPOT) {
  const C = center(cam);
  const axis = [P[0] - C[0], P[1] - C[1], P[2] - C[2]];
  const Q = rotAxisAngle(axis, angleRad);
  const R = mat3Mul(cam.R, mat3Transpose(Q)); // Xc = R·Qᵀ·(X − C): the camera body turns by Q
  const t = mat3MulVec(R, C);
  return { ...cam, R, t: [-t[0], -t[1], -t[2]] };
}

/**
 * The start point a camera camTo would have produced from the same static-ball pixel: the pixel of start.X in
 * camFrom, re-intersected through camTo with the plane z = start.X[2] (same ball-centre height). Other start
 * fields are kept. Returns a new start object (or the input when the ray misses the plane).
 */
export function restartOn(camFrom, camTo, start) {
  const p = project(camFrom, start.X);
  const { C, d } = ray(camTo, p.u, p.v);
  const zc = Number.isFinite(start.X[2]) ? start.X[2] : BALL_R;
  if (!(Math.abs(d[2]) > 1e-12)) return start;
  const s = (zc - C[2]) / d[2];
  if (!(s > 0)) return start;
  return { ...start, X: [C[0] + s * d[0], C[1] + s * d[1], zc] };
}
