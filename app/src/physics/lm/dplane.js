// D-plane geometry and its linearised launch model (docs/research/launch-monitor-physics.md §1, §3; LAUNCH-MONITOR-SPEC
// §1.2 #4–7, #13). Lazy module (physics/lm/*).
//
// Frame: the canonical right-handed mat frame of physics/clubpath.js and launch_h.js — x down the target line, y toward
// a right-handed golfer (left of the target line), z up. Every horizontal angle (path, face, launch direction) is
// + away from the golfer (toward −y); a left-hander's shot is mirrored into this frame before it gets here.
//   club direction  ĉ = (cosA·cosP, −cosA·sinP, sinA)      A = attack angle, P = club path
//   face normal     n̂ = (cosL·cosF, −cosL·sinF, sinL)      L = dynamic loft, F = face angle
// Spin loft = ∠(ĉ, n̂). The spin axis is ŵ ∥ ĉ × n̂ (pure backspin: ŵ = −ŷ). Its tilt from the horizontal, + when it
// curves the ball away from the golfer (open face for a right-hander: fade/slice), is atan2(−ŵ_z, ‖ŵ_xy‖) — the
// research note writes atan2(ŵ_z, …) for a frame with y to the right; in this right-handed frame the sign flips.
// Launch model (Wood, Henrikson, Broadie 2018): launch_h = h·F + (1 − h)·P, launch_v = v·L + (1 − v)·A with h(SL),
// v(SL) piecewise linear over LM_PARAMS.dplane knots (ends held). The small-angle form tan(axis) ≈ tan(F − P)/tan(SL)
// is only a cross-check in tests/unit/lm.physics.dplane.test.mjs.

import { LM_PARAMS } from './params.js';

const D = Math.PI / 180;
const P = LM_PARAMS.dplane;
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/** Piecewise-linear interpolation over increasing knots xs (values ys), constant beyond both ends. */
export function interp(x, xs, ys) {
  if (!(x > xs[0])) return ys[0];
  const n = xs.length - 1;
  if (x >= xs[n]) return ys[n];
  let k = 1;
  while (x > xs[k]) k++;
  return ys[k - 1] + ((ys[k] - ys[k - 1]) * (x - xs[k - 1])) / (xs[k] - xs[k - 1]);
}

/** Horizontal launch ratio h(spin loft °). */
export const hRatio = (sl) => interp(sl, P.sl_knots_deg, P.h);
/** Vertical launch ratio v(spin loft °). */
export const vRatio = (sl) => interp(sl, P.sl_knots_deg, P.v);

/** Unit club-head velocity direction for attack A and path P (degrees). */
export function clubDir(aoa, path) {
  const a = aoa * D, p = path * D;
  return [Math.cos(a) * Math.cos(p), -Math.cos(a) * Math.sin(p), Math.sin(a)];
}

/** Unit face normal for dynamic loft L and face angle F (degrees). */
export function faceNormal(dl, face) {
  const l = dl * D, f = face * D;
  return [Math.cos(l) * Math.cos(f), -Math.cos(l) * Math.sin(f), Math.sin(l)];
}

/** Spin loft (°): the 3D angle between the club direction and the face normal. */
export function spinLoft3D(aoa, path, dl, face) {
  const c = clubDir(aoa, path);
  const n = faceNormal(dl, face);
  const d = c[0] * n[0] + c[1] * n[1] + c[2] * n[2];
  return Math.acos(clamp(d, -1, 1)) / D;
}

/** Spin axis tilt (°, + = curves away from the golfer) from the D-plane vector ŵ ∥ ĉ × n̂. */
export function spinAxisDeg(aoa, path, dl, face) {
  const c = clubDir(aoa, path);
  const n = faceNormal(dl, face);
  const wx = c[1] * n[2] - c[2] * n[1];
  const wy = c[2] * n[0] - c[0] * n[2];
  const wz = c[0] * n[1] - c[1] * n[0];
  const hz = Math.hypot(wx, wy);
  if (!(hz + Math.abs(wz) > 1e-15)) return 0;
  return Math.atan2(-wz, hz) / D;
}

/** Forward model: { face, path, dl, aoa } (°) -> { launch_h, launch_v, spin_loft, h, v, axis } (°). */
export function forwardDplane({ face, path, dl, aoa }, o = {}) {
  const sl = spinLoft3D(aoa, path, dl, face);
  const h = clamp(hRatio(sl) + (o.dh ?? 0), P.h_min, 1);
  const v = clamp(vRatio(sl) + (o.dv ?? 0), P.v_min, 1);
  return { launch_h: h * face + (1 - h) * path, launch_v: v * dl + (1 - v) * aoa, spin_loft: sl, h, v, axis: spinAxisDeg(aoa, path, dl, face) };
}

/**
 * Vertical inverse: dynamic loft from launch_v and attack (°), v(SL) solved by fixed point (SL depends on DL).
 * o: { face = 0, path = 0 (face_on cannot see them; < 0.3° on SL at small angles), dv = 0 (per-shot ratio offset) }.
 * Returns { dl, spin_loft, v }.
 */
export function inverseVertical(lv, aoa, o = {}) {
  const face = o.face ?? 0, path = o.path ?? 0, dv = o.dv ?? 0;
  let dl = lv, sl = 0, v = 1;
  for (let k = 0; k < 200; k++) {
    sl = spinLoft3D(aoa, path, dl, face);
    v = clamp(vRatio(sl) + dv, P.v_min, 1);
    const next = (lv - (1 - v) * aoa) / v;
    const done = Math.abs(next - dl) < 1e-13;
    dl = next;
    if (done) break;
  }
  return { dl, spin_loft: spinLoft3D(aoa, path, dl, face), v };
}

/** Horizontal inverse for a given spin loft (°): { face, face_to_path, h }. dh = per-shot ratio offset. */
export function inverseHorizontal(lh, path, spinLoft, dh = 0) {
  const h = clamp(hRatio(spinLoft) + dh, P.h_min, 1);
  return { face: (lh - (1 - h) * path) / h, face_to_path: (lh - path) / h, h };
}

/** Joint inverse { launch_h, launch_v, path, aoa } -> { face, dl, spin_loft, h, v } (both ratios at the 3D spin loft). */
export function inverseDplane({ launch_h, launch_v, path, aoa }, o = {}) {
  let face = launch_h, dl = launch_v, sl = 0, h = 1, v = 1;
  for (let k = 0; k < 400; k++) {
    sl = spinLoft3D(aoa, path, dl, face);
    h = clamp(hRatio(sl) + (o.dh ?? 0), P.h_min, 1);
    v = clamp(vRatio(sl) + (o.dv ?? 0), P.v_min, 1);
    const f2 = (launch_h - (1 - h) * path) / h;
    const d2 = (launch_v - (1 - v) * aoa) / v;
    const done = Math.abs(f2 - face) + Math.abs(d2 - dl) < 1e-13;
    face = f2; dl = d2;
    if (done) break;
  }
  return { face, dl, spin_loft: spinLoft3D(aoa, path, dl, face), h, v };
}
