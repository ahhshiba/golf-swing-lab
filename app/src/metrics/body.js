// 3D body reconstruction for the pose metrics: every landmark is put on its own viewing ray through the calibrated
// camera, at a camera-frame depth = body depth (from the feet's ground contact through the mat calibration) +
// the landmark's MediaPipe world-z offset from the hips. Results are in the canonical right-handed mat frame
// (left-handed swings are mirrored through y = 0 and relabelled). Model and error budget: docs/metrics-by-view.md.
// Pure.

import { RC } from '../contract/reason-codes.js';
import { ray, intersectRayZ, pixelToNormalized, toCamera, nominalCamera } from '../geom/camera.js';
import { mat3TMulVec, sub3, add3, scale3, dot3 } from '../geom/linalg.js';
import { median } from '../geom/stats.js';
import { LR_SWAP } from '../events/features.js';
import { movingAverage, oddWindow, nearestIndex } from '../events/signal.js';

/** Ground-contact priors (m above the mat, sigma) for the foot landmarks with the foot flat at address. */
export const FOOT_PRIORS = Object.freeze({
  27: [0.075, 0.012], 28: [0.075, 0.012], 29: [0.032, 0.008], 30: [0.032, 0.008], 31: [0.022, 0.006], 32: [0.022, 0.006],
});
/** Assumed 1-sigma landmark placement error of the pose model in pixels (UNVERIFIED; M3 owner footage). */
export const LANDMARK_SIGMA_PX = 3;
/** BODY_PLANE_ASSUMED fallback: hip-joint-to-ankle length along thigh + shank (m) and its relative sigma. */
export const LEG_LENGTH_M = 0.8;
export const LEG_LENGTH_SIGMA_REL = 0.1;
/** Mat used for the "ankles on the mat" check when no venue is given (CAFCR A: 1.50 × 1.25, ball 0.30 from edge). */
export const DEFAULT_MAT = Object.freeze({ mat_L: 1.5, mat_W: 1.25, ball_edge_m: 0.3, ball_x_m: 0 });
export const MAT_MARGIN_M = 0.15;
export const ADDRESS_WINDOW_S = 0.3;
export const EVENT_WINDOW_S = 0.035;
export const VIS_MIN = 0.3;

/** Point on the viewing ray of pixel (u, v) at camera-frame depth Z (world M). */
export function pointAtDepth(cam, u, v, Z) {
  const [x, y] = pixelToNormalized(cam, u, v);
  return mat3TMulVec(cam.R, sub3([x * Z, y * Z, Z], cam.t));
}

/**
 * Body context for one clip. opts: { poseSeq, calibration, view, handedness, events, venue? }.
 * Returns an object with
 *   T, t_s, cam, mirror, codes (clip-level reason codes), depth: { Z, sigma_rel, assumed, source },
 *   pix(i, j) -> [u, v] | null (canonical label j; null when outside the image or vis < VIS_MIN),
 *   vis(i, j), P(i, j) -> [x, y, z] canonical M (or null), onGround(i, j, z0) -> canonical [x, y, z0] | null,
 *   frames(t0, t1) -> frame indices, eventFrames(name) / addressFrames().
 */
export function makeBody({ poseSeq, calibration, view, handedness = 'right', events, venue }) {
  const T = poseSeq.t_s.length;
  const ts = poseSeq.t_s;
  const img = poseSeq.img;
  const world = poseSeq.world && poseSeq.world.length >= T * 99 ? poseSeq.world : null;
  const mirror = handedness === 'left';
  const codes = [];
  let cam = calibration?.camera ?? null;
  let camAssumed = false;
  if (!cam) {
    cam = nominalCamera(view, { W: poseSeq.W, H: poseSeq.H });
    if (mirror) cam = mirrorCam(cam);
    camAssumed = true;
    codes.push(RC.BODY_PLANE_ASSUMED);
  }
  const W = cam.W;
  const H = cam.H;
  const phys = (j) => (mirror ? LR_SWAP[j] : j);
  const canon = (X) => (mirror ? [X[0], -X[1], X[2]] : X);

  // MediaPipe world z (depth offset from the hips, camera-aligned), lightly smoothed over time
  const wz = new Float64Array(T * 33);
  if (world) {
    const w = oddWindow(0.15, estimateRate(ts));
    const col = new Float64Array(T);
    for (let j = 0; j < 33; j++) {
      for (let i = 0; i < T; i++) col[i] = world[i * 99 + j * 3 + 2];
      const s = movingAverage(col, w);
      for (let i = 0; i < T; i++) wz[i * 33 + j] = s[i];
    }
  }
  const rawPix = (i, jp) => [img[i * 132 + jp * 4] * W, img[i * 132 + jp * 4 + 1] * H];
  const rawVis = (i, jp) => img[i * 132 + jp * 4 + 3];
  const inside = (p) => p[0] >= 0 && p[0] <= W && p[1] >= 0 && p[1] <= H;
  const pix = (i, j) => {
    const jp = phys(j);
    const p = rawPix(i, jp);
    return inside(p) && rawVis(i, jp) >= VIS_MIN ? p : null;
  };
  const vis = (i, j) => rawVis(i, phys(j));
  const outOfFrame = (i, j) => !inside(rawPix(i, phys(j)));

  const frames = (t0, t1) => {
    const out = [];
    for (let i = 0; i < T; i++) if (ts[i] >= t0 - 1e-9 && ts[i] <= t1 + 1e-9) out.push(i);
    if (out.length === 0) out.push(nearestIndex(ts, (t0 + t1) / 2));
    return out;
  };
  const ev = (name) => {
    const e = events?.[name];
    return e && Number.isFinite(e.t_s) ? e.t_s : null;
  };
  const addressFrames = () => {
    const ta = ev('address');
    return ta === null ? [] : frames(ta - ADDRESS_WINDOW_S, ta);
  };
  const eventFrames = (name) => {
    const te = ev(name);
    return te === null ? [] : frames(te - EVENT_WINDOW_S, te + EVENT_WINDOW_S);
  };

  // ---- body depth from the feet's ground contact at address ----
  const depth = bodyDepth();
  function bodyDepth() {
    const fr = addressFrames();
    const mat = { ...DEFAULT_MAT, ...(venue ?? {}) };
    const xLo = -mat.mat_L / 2 - mat.ball_x_m - MAT_MARGIN_M;
    const xHi = mat.mat_L / 2 - mat.ball_x_m + MAT_MARGIN_M;
    const yLo = -mat.ball_edge_m - MAT_MARGIN_M;
    const yHi = mat.mat_W - mat.ball_edge_m + MAT_MARGIN_M;
    const est = [];
    let offMat = false;
    for (const [js, [h, sh]] of Object.entries(FOOT_PRIORS)) {
      const j = +js;
      const zs = [];
      for (const i of fr) {
        const p = pix(i, j);
        if (!p || vis(i, j) < 0.5) continue;
        const G = intersectRayZ(ray(cam, p[0], p[1]), h);
        if (!G) continue;
        const Gc = canon(G);
        if (Gc[0] < xLo || Gc[0] > xHi || Gc[1] < yLo || Gc[1] > yHi) { offMat = true; continue; }
        zs.push(toCamera(cam, G)[2] - wz[i * 33 + phys(j)]);
      }
      if (zs.length === 0) continue;
      // sensitivity of the depth to the height prior and to the landmark pixel error, at the median sample
      const i0 = fr[fr.length >> 1];
      const p = pix(i0, j) ?? pix(fr[0], j);
      let sig = 0.05;
      if (p) {
        const Z0 = depthAt(p[0], p[1], h);
        const Zh = depthAt(p[0], p[1], h + sh);
        const Zp = depthAt(p[0], p[1] + LANDMARK_SIGMA_PX, h);
        if (Z0 !== null && Zh !== null && Zp !== null) sig = Math.hypot(Zh - Z0, Zp - Z0);
      }
      est.push({ Z: median(zs), sig });
    }
    if (est.length >= 2 && !offMat) {
      let sw = 0;
      let swz = 0;
      for (const e of est) { const w = 1 / (e.sig * e.sig); sw += w; swz += w * e.Z; }
      const Z = swz / sw;
      // the priors are shared between feet, so the errors do not average down fully: keep half of the mean sigma
      const sigZ = Math.max(Math.sqrt(1 / sw), 0.5 * (est.reduce((s, e) => s + e.sig, 0) / est.length));
      return { Z, sigma_rel: sigZ / Z, assumed: camAssumed, source: camAssumed ? 'nominal_camera' : 'ground_contact' };
    }
    // fallback: apparent leg length against a height prior
    if (!codes.includes(RC.BODY_PLANE_ASSUMED)) codes.push(RC.BODY_PLANE_ASSUMED);
    const lens = [];
    for (const i of fr) {
      for (const [a, b, c] of [[23, 25, 27], [24, 26, 28]]) {
        const pa = pix(i, a); const pb = pix(i, b); const pc = pix(i, c);
        if (pa && pb && pc) lens.push(Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) + Math.hypot(pb[0] - pc[0], pb[1] - pc[1]));
      }
    }
    const Lpx = lens.length ? median(lens) : NaN;
    const Z = Number.isFinite(Lpx) && Lpx > 0 ? (cam.f * LEG_LENGTH_M) / Lpx : NaN;
    return { Z, sigma_rel: camAssumed ? 0.15 : LEG_LENGTH_SIGMA_REL, assumed: true, source: 'leg_length_prior' };
  }
  function depthAt(u, v, h) {
    const G = intersectRayZ(ray(cam, u, v), h);
    return G ? toCamera(cam, G)[2] : null;
  }

  const cache = new Map();
  const P = (i, j) => {
    const key = i * 33 + j;
    if (cache.has(key)) return cache.get(key);
    const p = pix(i, j);
    let X = null;
    if (p && Number.isFinite(depth.Z)) X = canon(pointAtDepth(cam, p[0], p[1], depth.Z + wz[i * 33 + phys(j)]));
    cache.set(key, X);
    return X;
  };
  const onGround = (i, j, z0) => {
    const p = pix(i, j);
    if (!p) return null;
    const G = intersectRayZ(ray(cam, p[0], p[1]), z0);
    return G ? canon(G) : null;
  };
  /** Camera-frame depth of landmark j in frame i under the depth model. */
  const Zof = (i, j) => depth.Z + wz[i * 33 + phys(j)];
  /** Physical (unmirrored) ray of canonical landmark j in frame i. */
  const rayOf = (i, j) => { const p = pix(i, j); return p ? ray(cam, p[0], p[1]) : null; };
  const wzOf = (i, j) => wz[i * 33 + phys(j)];
  const worldDist = (i, a, b) => {
    if (!world) return NaN;
    const pa = phys(a); const pb = phys(b);
    let s = 0;
    for (let c = 0; c < 3; c++) { const d = world[i * 99 + pa * 3 + c] - world[i * 99 + pb * 3 + c]; s += d * d; }
    return Math.sqrt(s);
  };

  return {
    T, t_s: ts, cam, camAssumed, mirror, codes, depth, view,
    pix, vis, outOfFrame, P, onGround, Zof, rayOf, wzOf, worldDist, canon,
    frames, addressFrames, eventFrames, ev, hasWorld: world !== null,
  };
}

function estimateRate(ts) {
  const n = ts.length;
  if (n < 2) return 30;
  const d = [];
  for (let i = 1; i < n; i++) d.push(ts[i] - ts[i - 1]);
  const m = median(d);
  return m > 0 ? 1 / m : 30;
}

function mirrorCam(cam) {
  const R = cam.R;
  return { ...cam, R: [-R[0], R[1], -R[2], R[3], -R[4], R[5], R[6], -R[7], R[8]], t: [-cam.t[0], cam.t[1], cam.t[2]] };
}

/**
 * Mean of a per-frame point function over frames. fn(i) -> [x,y,z] | null. Returns
 * { X, n, sd: [per-axis sd across frames] , missing: frames without a value } or null when no frame has a value.
 */
export function meanOver(frames, fn) {
  const pts = [];
  for (const i of frames) { const X = fn(i); if (X) pts.push(X); }
  if (pts.length === 0) return null;
  const X = [0, 0, 0];
  for (const p of pts) { X[0] += p[0]; X[1] += p[1]; X[2] += p[2]; }
  for (let c = 0; c < 3; c++) X[c] /= pts.length;
  const sd = [0, 0, 0];
  if (pts.length > 1) {
    for (const p of pts) for (let c = 0; c < 3; c++) sd[c] += (p[c] - X[c]) ** 2;
    for (let c = 0; c < 3; c++) sd[c] = Math.sqrt(sd[c] / (pts.length - 1));
  }
  return { X, n: pts.length, sd, missing: frames.length - pts.length };
}

/** Mid-point of two canonical landmarks in frame i (null if either is missing). */
export function midOf(body, i, a, b) {
  const A = body.P(i, a);
  const B = body.P(i, b);
  return A && B ? scale3(add3(A, B), 0.5) : null;
}

/** Mean visibility of canonical landmarks over frames. */
export function meanVis(body, frames, js) {
  let s = 0;
  let n = 0;
  for (const i of frames) for (const j of js) { s += body.vis(i, j); n++; }
  return n ? s / n : 0;
}

/** Reason code for a window where landmarks are missing: OUT_OF_FRAME if any is outside the image, else visibility. */
export function missingCode(body, frames, js) {
  for (const i of frames) for (const j of js) if (body.outOfFrame(i, j)) return RC.OUT_OF_FRAME;
  return RC.POSE_LOW_VISIBILITY;
}

/**
 * Two-point segment (lead a, trail b) with a known 3D length L, each end on its own viewing ray, the mid-point at
 * the depth model's camera depth: Z_a = Zmid + δ, Z_b = Zmid − δ, |P_a − P_b| = L (quadratic in δ). Of the two
 * roots the one closer to the MediaPipe world-z half-difference is taken; with no real root, the closest approach.
 * Returns canonical [P_a, P_b] or null. This removes the perspective bias of the face-on shoulder-width ratio
 * (CAFCR C1.1: −1° at 45°, −10° at 90°) because the depth difference of the two ends is modelled explicitly.
 */
export function segmentOnRays(body, i, a, b, L) {
  const ra = body.rayOf(i, a);
  const rb = body.rayOf(i, b);
  if (!ra || !rb || !Number.isFinite(body.depth.Z)) return null;
  const R = body.cam.R;
  const fax = [R[6], R[7], R[8]];
  const ka = 1 / dot3(ra.d, fax);
  const kb = 1 / dot3(rb.d, fax);
  const wa = body.wzOf(i, a);
  const wb = body.wzOf(i, b);
  const Zmid = body.depth.Z + (wa + wb) / 2;
  const dw = (wa - wb) / 2;
  const A = scale3(ra.d, ka);
  const Bv = scale3(rb.d, kb);
  const u = scale3(sub3(A, Bv), Zmid);
  const w = add3(A, Bv);
  const uw = dot3(u, w);
  const ww = dot3(w, w);
  const disc = uw * uw - ww * (dot3(u, u) - L * L);
  let delta;
  if (disc >= 0) {
    const r1 = (-uw + Math.sqrt(disc)) / ww;
    const r2 = (-uw - Math.sqrt(disc)) / ww;
    delta = Math.abs(r1 - dw) <= Math.abs(r2 - dw) ? r1 : r2;
  } else delta = -uw / ww;
  const C = ra.C;
  const Pa = add3(C, scale3(A, Zmid + delta));
  const Pb = add3(C, scale3(Bv, Zmid - delta));
  return [body.canon(Pa), body.canon(Pb)];
}

/** Horizontal azimuth (rad) of the vector from b to a. */
export function azimuth(Pa, Pb) {
  return Math.atan2(Pa[1] - Pb[1], Pa[0] - Pb[0]);
}

