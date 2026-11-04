// Planar linear baseline ("線性擬合" of CAFCR C1.1 / the M4 comparison): every detection ray is intersected with
// the vertical plane y = start.y (the plane through the ball spot, parallel to the target line) and a
// constant-velocity line is fitted in that plane, x(t) = x₀ + vx·t and z(t) + ½·g·t² = z₀ + vz·t (gravity is
// known, so only its known curvature is removed; no drag, no depth). Times are rolling-shutter corrected exactly
// like fit3d, so the comparison isolates the depth handling. Any launch direction ψ ≠ 0 biases this fit by about
// 1 %/° (toward the camera +, away −); fit3d exists to remove that bias (K4).

import { G, RAD2DEG } from '../geom/constants.js';
import { ray } from '../geom/camera.js';
import { median, mad, MAD_TO_SIGMA } from '../geom/stats.js';
import { RC } from '../contract/reason-codes.js';
import { observationTimes } from './shutter.js';

export const MIN_TRACK_OBS = 5;
export const OUTLIER_K = 3.5;

/** Ray of pixel (u, v) intersected with the plane y = y0; null when parallel or behind the camera. */
export function rayPlaneY(cam, u, v, y0) {
  const { C, d } = ray(cam, u, v);
  if (!(Math.abs(d[1]) > 1e-12)) return null;
  const s = (y0 - C[1]) / d[1];
  if (!(s > 0)) return null;
  return [C[0] + s * d[0], y0, C[2] + s * d[2]];
}

/** Weighted LS line y = a + b·x; returns { a, b, res } or null. */
function lineFit(x, y, w, keep) {
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < x.length; i++) {
    if (!keep[i]) continue;
    sw += w[i]; sx += w[i] * x[i]; sy += w[i] * y[i]; sxx += w[i] * x[i] * x[i]; sxy += w[i] * x[i] * y[i];
  }
  const det = sw * sxx - sx * sx;
  if (!(Math.abs(det) > 1e-300)) return null;
  const b = (sw * sxy - sx * sy) / det;
  const a = (sy - b * sx) / sw;
  const varB = sw / det; // per unit weight variance
  return { a, b, varB };
}

/**
 * Plane track: points P_i (ray ∩ y = y0) with times t_i (rolling-shutter corrected), robust constant-velocity fit.
 * Returns { ok, t_ref, x0, z0, vx, vz, keep, P, t, rms_m } (x0, z0 at t_ref; z with gravity removed) or { ok: false }.
 */
export function planeTrack(cam, obs, times, y0, opts = {}) {
  const P = [];
  const t = [];
  const idx = [];
  for (let i = 0; i < obs.length; i++) {
    const X = rayPlaneY(cam, obs[i].u, obs[i].v, y0);
    if (!X || !Number.isFinite(times[i])) continue;
    P.push(X); t.push(times[i]); idx.push(i);
  }
  const n = P.length;
  if (n < (opts.minObs ?? 2)) return { ok: false, n };
  let tRef = 0;
  for (const ti of t) tRef += ti / n;
  const tt = t.map((ti) => ti - tRef);
  const xs = P.map((p) => p[0]);
  const zs = P.map((p, i) => p[2] + 0.5 * G * tt[i] * tt[i]);
  const w = new Float64Array(n).fill(1);
  let keep = new Array(n).fill(true);
  let fx = lineFit(tt, xs, w, keep);
  let fz = lineFit(tt, zs, w, keep);
  if (!fx || !fz) return { ok: false, n };
  if (opts.robust !== false && n >= (opts.minObs ?? 2) + 1) {
    const res = tt.map((ti, i) => Math.hypot(xs[i] - fx.a - fx.b * ti, zs[i] - fz.a - fz.b * ti));
    const thr = median(res) + OUTLIER_K * MAD_TO_SIGMA * mad(res) + 1e-6;
    const nk = res.map((r) => r <= thr);
    const nKeep = nk.filter(Boolean).length;
    if (nKeep < n && nKeep >= Math.max(opts.minObs ?? 2, 2)) {
      keep = nk;
      fx = lineFit(tt, xs, w, keep) ?? fx;
      fz = lineFit(tt, zs, w, keep) ?? fz;
    }
  }
  let ss = 0;
  let nk = 0;
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    const dx = xs[i] - fx.a - fx.b * tt[i];
    const dz = zs[i] - fz.a - fz.b * tt[i];
    ss += dx * dx + dz * dz; nk++;
  }
  const rms = Math.sqrt(ss / Math.max(nk, 1));
  return {
    ok: true, n, t_ref: tRef, x0: fx.a, z0: fz.a, vx: fx.b, vz: fz.b, keep, P, t, idx, rms_m: rms,
    var_vx: fx.varB, var_vz: fz.varB,
  };
}

/**
 * Planar linear fit. input: { cam, obs, start: { X }, fps }.
 * Returns { ok, method: 'fit2d', ball_speed_mps, launch_v_deg, v_vec, t0, residual_rmse_m, speed_sigma, n_used,
 *   flags } — t0 is when the line passes x = start.x; v_vec = (vx, 0, vz(t0)).
 */
export function fit2d({ cam, obs, start }) {
  const flags = [];
  const good = (obs ?? []).filter((o) => Number.isFinite(o.u) && Number.isFinite(o.v) && Number.isFinite(o.t_s));
  if (good.length < MIN_TRACK_OBS) {
    return { ok: false, method: 'fit2d', ball_speed_mps: null, launch_v_deg: null, n_used: good.length, flags: [RC.TRACK_TOO_SHORT] };
  }
  const times = observationTimes(good, cam);
  const pt = planeTrack(cam, good, times, start.X[1], { minObs: MIN_TRACK_OBS });
  const nUsed = pt.ok ? pt.keep.filter(Boolean).length : 0;
  if (!pt.ok || nUsed < MIN_TRACK_OBS || !(pt.vx > 0)) {
    return { ok: false, method: 'fit2d', ball_speed_mps: null, launch_v_deg: null, n_used: nUsed, flags: [RC.TRACK_TOO_SHORT] };
  }
  const dt0 = (start.X[0] - pt.x0) / pt.vx; // t0 − t_ref
  const vz0 = pt.vz - G * dt0;
  const speed = Math.hypot(pt.vx, vz0);
  // Residual-based σ of the speed (per-unit-weight variances scaled by the residual variance).
  const s2 = (pt.rms_m * pt.rms_m * nUsed) / Math.max(2 * nUsed - 4, 1);
  const speedSigma = Math.sqrt(((pt.vx / speed) ** 2 * pt.var_vx + (vz0 / speed) ** 2 * pt.var_vz) * s2);
  return {
    ok: true,
    method: 'fit2d',
    ball_speed_mps: speed,
    launch_v_deg: Math.atan2(vz0, pt.vx) * RAD2DEG,
    v_vec: [pt.vx, 0, vz0],
    t0: pt.t_ref + dt0,
    residual_rmse_m: pt.rms_m,
    speed_sigma: speedSigma,
    n_used: nUsed,
    flags,
  };
}
