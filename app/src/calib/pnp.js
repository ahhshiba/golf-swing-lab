// Camera pose from the 4 mat corners (CAFCR K1, K3, C3 step C5–C6; interfaces.md §2, §4, §6).
//
// Pipeline: normalised DLT homography (≥4 planar points) → focal length from the homography with the principal
// point fixed at the image centre (two orthogonality constraints, least-squares in w = (f0/f)²) → pose
// decomposition → Levenberg–Marquardt refinement (geom/lm.js) of a rotation increment (axis-angle), the camera
// centre C and optionally f, minimising whitened reprojection error, with an optional gravity prior on pitch and
// roll. Pose sigmas come from the LM covariance propagated through the report transform (numerical Jacobian).

import { RAD2DEG, DEG, IPHONE_HFOV_1080P240_DEG } from '../geom/constants.js';
import {
  hartleyNormalize, smallestSingularVector, mat3Mul, mat3Inverse, orthonormalize, rodrigues, cross3, norm3,
} from '../geom/linalg.js';
import { lm, numericJacobian } from '../geom/lm.js';
import { makeCamera, project, eulerFromR, fFromHfov } from '../geom/camera.js';
import { RC } from '../contract/reason-codes.js';
import { matCorners } from './mat.js';

/** Pose-report keys in the order used by covariance propagation (interfaces.md §6). */
export const POSE_KEYS = Object.freeze(['yaw_deg', 'pitch_deg', 'roll_deg', 'X_m', 'Y_m', 'h_m', 'D_m']);

/** Default accelerometer sigma for the gravity prior on pitch and roll (CAFCR C1.1: ±0.3–0.5°, UNVERIFIED). */
export const GRAVITY_SIGMA_DEG = 0.4;

/** Corner localisation sigma by source (CAFCR C3 C5: magnifier tap 1 px, automatic detection 3 px). */
export const CORNER_SIGMA_PX = Object.freeze({ manual: 1, auto: 3 });

/** Nominal focal length (px) for an image W×H: 1x lens, 1080p240 FOV across the long side. */
export function nominalF(W, H) {
  return fFromHfov(Math.max(W, H), IPHONE_HFOV_1080P240_DEG);
}

function wrapPi(x) {
  const twoPi = 2 * Math.PI;
  let y = x - twoPi * Math.round(x / twoPi);
  if (y <= -Math.PI) y += twoPi;
  return y;
}

/**
 * Homography H (row-major 9, H[8] scaled to 1 when possible) mapping planar world [x, y, 1] to pixels [u, v, 1]
 * by the normalised DLT. world: [[x, y] | [x, y, z]] (z ignored), img: [[u, v]], N ≥ 4. Returns null if degenerate.
 */
export function homographyDLT(world, img) {
  const N = world.length;
  if (N < 4 || img.length !== N) throw new RangeError('homographyDLT: need ≥4 matching points');
  const nw = hartleyNormalize(world.map((p) => [p[0], p[1]]));
  const ni = hartleyNormalize(img.map((p) => [p[0], p[1]]));
  const A = [];
  for (let i = 0; i < N; i++) {
    const [x, y] = nw.pts[i];
    const [u, v] = ni.pts[i];
    A.push([-x, -y, -1, 0, 0, 0, u * x, u * y, u]);
    A.push([0, 0, 0, -x, -y, -1, v * x, v * y, v]);
  }
  const { v: h } = smallestSingularVector(A);
  const Ti = mat3Inverse(ni.T);
  if (!Ti) return null;
  let Hm = mat3Mul(mat3Mul(Ti, Array.from(h)), nw.T);
  const s = Math.abs(Hm[8]) > 1e-12 ? Hm[8] : norm3([Hm[6], Hm[7], Hm[8]]) || 1;
  Hm = Hm.map((x) => x / s);
  if (!Hm.every(Number.isFinite)) return null;
  return Hm;
}

/**
 * Focal length from a plane homography with the principal point fixed at (cx, cy).
 * With Hn = diag(1/f0, 1/f0, 1)·[[1,0,−cx],[0,1,−cy],[0,0,1]]·H and w = (f0/f)², the constraints r1·r2 = 0 and
 * |r1| = |r2| are a1·w + b1 = 0 and a2·w + b2 = 0. Both are solved jointly by least squares; when that is not
 * positive or is outside [f0/3, 3·f0] the better-conditioned single constraint is tried, then f0.
 * Returns { f, source: 'ls'|'orth'|'norm'|'fallback', w_ls, w_orth, w_norm }.
 */
export function focalFromHomography(H, cx, cy, f0) {
  const Hc = [
    H[0] - cx * H[6], H[1] - cx * H[7], H[2] - cx * H[8],
    H[3] - cy * H[6], H[4] - cy * H[7], H[5] - cy * H[8],
    H[6], H[7], H[8],
  ];
  const h11 = Hc[0] / f0;
  const h12 = Hc[1] / f0;
  const h21 = Hc[3] / f0;
  const h22 = Hc[4] / f0;
  const h31 = Hc[6];
  const h32 = Hc[7];
  const a1 = h11 * h12 + h21 * h22;
  const b1 = h31 * h32;
  const a2 = h11 * h11 + h21 * h21 - h12 * h12 - h22 * h22;
  const b2 = h31 * h31 - h32 * h32;
  const den = a1 * a1 + a2 * a2;
  const wLs = den > 0 ? -(a1 * b1 + a2 * b2) / den : NaN;
  const wOrth = Math.abs(a1) > 1e-15 ? -b1 / a1 : NaN;
  const wNorm = Math.abs(a2) > 1e-15 ? -b2 / a2 : NaN;
  const okW = (w) => Number.isFinite(w) && w > 1 / 9 && w < 9;
  let f = f0;
  let source = 'fallback';
  if (okW(wLs)) { f = f0 / Math.sqrt(wLs); source = 'ls'; } else {
    const cand = [['orth', wOrth, Math.abs(a1)], ['norm', wNorm, Math.abs(a2)]].filter((c) => okW(c[1]));
    cand.sort((p, q) => q[2] - p[2]);
    if (cand.length) { f = f0 / Math.sqrt(cand[0][1]); source = cand[0][0]; }
  }
  return { f, source, w_ls: wLs, w_orth: wOrth, w_norm: wNorm };
}

/**
 * Pose from a plane homography and known f (principal point at cx, cy): R (row-major 9, orthonormalised) and t
 * with the world points' centroid in front of the camera. worldCentroid: [x, y] of the planar points.
 */
export function poseFromHomography(H, f, cx, cy, worldCentroid = [0, 0]) {
  const Kinv = [1 / f, 0, -cx / f, 0, 1 / f, -cy / f, 0, 0, 1];
  const M = mat3Mul(Kinv, H);
  const m1 = [M[0], M[3], M[6]];
  const m2 = [M[1], M[4], M[7]];
  const m3 = [M[2], M[5], M[8]];
  let lam = 2 / (norm3(m1) + norm3(m2));
  const zc = m1[2] * worldCentroid[0] + m2[2] * worldCentroid[1] + m3[2];
  if (lam * zc < 0) lam = -lam;
  const r1 = m1.map((x) => x * lam);
  const r2 = m2.map((x) => x * lam);
  const r3 = cross3(r1, r2);
  const R = orthonormalize([r1[0], r2[0], r3[0], r1[1], r2[1], r3[1], r1[2], r2[2], r3[2]]);
  const t = m3.map((x) => x * lam);
  return { R, t };
}

/**
 * Parameter vector θ = [δ (3, axis-angle increment applied as R = rodrigues(δ)·R0), C (3, camera centre in M),
 * s (only when fFree: f = s·f0), …extra]. Returns a light camera { W, H, f, cx, cy, k1, R, t }.
 */
export function cameraFromParams(theta, base) {
  const R = mat3Mul(rodrigues([theta[0], theta[1], theta[2]]), base.R0);
  const C = [theta[3], theta[4], theta[5]];
  const f = base.fFree ? base.f0 * theta[6] : base.f0;
  const t = [
    -(R[0] * C[0] + R[1] * C[1] + R[2] * C[2]),
    -(R[3] * C[0] + R[4] * C[1] + R[5] * C[2]),
    -(R[6] * C[0] + R[7] * C[1] + R[8] * C[2]),
  ];
  return { W: base.W, H: base.H, f, cx: base.W / 2, cy: base.H / 2, k1: base.k1 ?? 0, R, t };
}

/** Report vector [yaw_deg, pitch_deg, roll_deg, X_m, Y_m, h_m, D_m, f_px] for a parameter vector. */
export function reportVector(theta, base, view) {
  const cam = cameraFromParams(theta, base);
  const e = eulerFromR(cam.R, view);
  const C = [theta[3], theta[4], theta[5]];
  return [e.yaw * RAD2DEG, e.pitch * RAD2DEG, e.roll * RAD2DEG, C[0], C[1], C[2], Math.hypot(C[0], C[1]), cam.f];
}

/**
 * Propagate a parameter covariance (rows) to pose-report sigmas via the numerical Jacobian of reportVector.
 * Yaw and roll are unwrapped relative to the value at theta. Returns { sigma: {POSE_KEYS…, f_px}, cov8 }.
 */
export function propagatePoseSigma(theta, cov, base, view) {
  const ref = reportVector(theta, base, view);
  const fn = (th) => {
    const r = reportVector(th, base, view);
    r[0] = ref[0] + wrapPi((r[0] - ref[0]) * DEG) * RAD2DEG;
    r[2] = ref[2] + wrapPi((r[2] - ref[2]) * DEG) * RAD2DEG;
    return r;
  };
  const { J } = numericJacobian(fn, Array.from(theta), { relStep: 1e-6 });
  const m = J.length;
  const n = theta.length;
  const cov8 = Array.from({ length: m }, () => new Float64Array(m));
  for (let a = 0; a < m; a++) {
    for (let b = a; b < m; b++) {
      let s = 0;
      for (let i = 0; i < n; i++) {
        const Ji = J[a][i];
        if (Ji === 0) continue;
        for (let j = 0; j < n; j++) s += Ji * cov[i][j] * J[b][j];
      }
      cov8[a][b] = s;
      cov8[b][a] = s;
    }
  }
  const sigma = {};
  POSE_KEYS.forEach((k, i) => { sigma[k] = Math.sqrt(Math.max(cov8[i][i], 0)); });
  sigma.f_px = base.fFree ? Math.sqrt(Math.max(cov8[7][7], 0)) : 0;
  return { sigma, cov8 };
}

function poseFromTheta(theta, base, view) {
  const r = reportVector(theta, base, view);
  const out = {};
  POSE_KEYS.forEach((k, i) => { out[k] = r[i]; });
  return out;
}

/**
 * Planar PnP with LM refinement.
 * o: { world: [[x, y, 0] …] (z must be 0; N ≥ 4), img: [[u, v] …], W, H, view,
 *      f (locked value or initial guess; default nominalF(W, H)), fLocked = true,
 *      sigmaPx = 1 (scalar or per-point array), gravity = null ({ pitch_deg, roll_deg, sigma_deg = 0.4 }: camera
 *      pitch/roll relative to the mat plane, i.e. accelerometer angles with the venue slope already removed),
 *      k1 = 0, readout (passed to the camera), covScale = 'chi2' ('chi2': covRaw·max(1, χ²/dof); 'none': covRaw) }.
 * Returns { ok, cam (full camera object), f, f_init, rmse (px), residuals_px, cov (θ rows), theta, pose,
 *           sigma: { yaw_deg, pitch_deg, roll_deg, X_m, Y_m, h_m, D_m, f_px }, lm: { converged, iterations, reason,
 *           reducedChi2, dof }, reason_codes }.
 */
export function solvePlanarPnP(o) {
  const { world, img, W, H, view } = o;
  const N = world.length;
  if (N < 4 || img.length !== N) throw new RangeError('solvePlanarPnP: need ≥4 matching points');
  for (const p of world) if (Math.abs(p[2] ?? 0) > 1e-9) throw new RangeError('solvePlanarPnP: world points must have z = 0');
  const fLocked = o.fLocked ?? true;
  const fGiven = o.f ?? nominalF(W, H);
  const k1 = o.k1 ?? 0;
  const sig = Array.isArray(o.sigmaPx) ? o.sigmaPx : new Array(N).fill(o.sigmaPx ?? 1);
  const cx = W / 2;
  const cy = H / 2;
  const reason_codes = [];
  const Hm = homographyDLT(world, img);
  if (!Hm) return { ok: false, reason_codes: [RC.IMPLAUSIBLE_VALUE], error: 'degenerate homography' };
  const fInit = fLocked ? { f: fGiven, source: 'locked' } : focalFromHomography(Hm, cx, cy, fGiven);
  const wc = [world.reduce((s, p) => s + p[0], 0) / N, world.reduce((s, p) => s + p[1], 0) / N];
  const { R: R0, t: t0 } = poseFromHomography(Hm, fInit.f, cx, cy, wc);
  const C0 = [
    -(R0[0] * t0[0] + R0[3] * t0[1] + R0[6] * t0[2]),
    -(R0[1] * t0[0] + R0[4] * t0[1] + R0[7] * t0[2]),
    -(R0[2] * t0[0] + R0[5] * t0[1] + R0[8] * t0[2]),
  ];
  const base = { R0, f0: fInit.f, fFree: !fLocked, W, H, k1 };
  const grav = o.gravity && Number.isFinite(o.gravity.pitch_deg) && Number.isFinite(o.gravity.roll_deg) ? o.gravity : null;
  if (!grav) reason_codes.push(RC.NO_GRAVITY_REF);
  const gs = (grav?.sigma_deg ?? GRAVITY_SIGMA_DEG) * DEG;
  const residual = (th) => {
    const cam = cameraFromParams(th, base);
    const r = new Float64Array(2 * N + (grav ? 2 : 0));
    for (let i = 0; i < N; i++) {
      const p = project(cam, world[i]);
      if (!Number.isFinite(p.u)) return null;
      r[2 * i] = (p.u - img[i][0]) / sig[i];
      r[2 * i + 1] = (p.v - img[i][1]) / sig[i];
    }
    if (grav) {
      const e = eulerFromR(cam.R, view);
      r[2 * N] = wrapPi(e.pitch - grav.pitch_deg * DEG) / gs;
      r[2 * N + 1] = wrapPi(e.roll - grav.roll_deg * DEG) / gs;
    }
    return r;
  };
  const theta0 = [0, 0, 0, C0[0], C0[1], C0[2]];
  if (!fLocked) theta0.push(1);
  const res = lm({ residual, theta0, maxIter: 200, tol: 1e-14 });
  if (!res.r || !res.cov) {
    return { ok: false, reason_codes: [...reason_codes, RC.IMPLAUSIBLE_VALUE], error: `lm ${res.reason}`, lm: res };
  }
  const covScale = o.covScale ?? 'chi2';
  const cov = covScale === 'none' ? res.covRaw : res.covScaled;
  const camL = cameraFromParams(res.theta, base);
  const cam = makeCamera({ W, H, f: camL.f, k1, R: camL.R, t: camL.t, readout: o.readout });
  const residuals_px = [];
  let ss = 0;
  for (let i = 0; i < N; i++) {
    const p = project(cam, world[i]);
    const du = p.u - img[i][0];
    const dv = p.v - img[i][1];
    residuals_px.push([du, dv]);
    ss += du * du + dv * dv;
  }
  const { sigma } = propagatePoseSigma(res.theta, cov, base, view);
  return {
    ok: true,
    cam,
    f: cam.f,
    f_init: fInit,
    rmse: Math.sqrt(ss / N),
    residuals_px,
    cov,
    theta: Array.from(res.theta),
    base,
    pose: poseFromTheta(res.theta, base, view),
    sigma,
    lm: { converged: res.converged, iterations: res.iterations, reason: res.reason, reducedChi2: res.reducedChi2, dof: res.dof },
    reason_codes,
  };
}

/**
 * Mat PnP (CAFCR K1): corners [[u, v] × 4] in [tn, ln, lf, tf] order + venue mat model.
 * o: { corners, venue, view, W, H, f, fLocked = true, sigmaPx (default CORNER_SIGMA_PX[cornerSource]),
 *      cornerSource = 'manual'|'auto', gravity, k1, readout, covScale } — see solvePlanarPnP for the result.
 * The result adds `fFormat` when fLocked: a second, f-free solve for the C5 format check
 * ({ f_free, rel_diff, sigma_rel }), unless o.formatCheck === false.
 */
export function solveMatPose(o) {
  const world = matCorners(o.venue);
  if (!Array.isArray(o.corners) || o.corners.length !== 4) throw new RangeError('solveMatPose: need 4 corners');
  const cornerSource = o.cornerSource ?? 'manual';
  const sigmaPx = o.sigmaPx ?? CORNER_SIGMA_PX[cornerSource] ?? 1;
  const fLocked = o.fLocked ?? true;
  const out = solvePlanarPnP({ ...o, world, img: o.corners, sigmaPx, fLocked });
  if (!out.ok) return out;
  out.cornerSource = cornerSource;
  out.sigmaPx = sigmaPx;
  if (fLocked && o.formatCheck !== false) {
    const free = solvePlanarPnP({ ...o, world, img: o.corners, sigmaPx, fLocked: false, gravity: o.gravity });
    if (free.ok) {
      out.fFormat = { f_free: free.f, rel_diff: (free.f - out.f) / out.f, sigma_rel: free.sigma.f_px / free.f };
    } else {
      out.fFormat = null;
    }
  }
  return out;
}
