// high_behind club-head speed (LAUNCH-MONITOR-SPEC §1.2 #1 hb 低, RN §7; UNVERIFIED). The club-head image track
// (track/club.js) is intersected with the surface the head travels on just before impact: height
// z(s) = z0 + s·tanA + ½·κ_z·s² (s = x − x_impact ≤ 0: the attack prior A plus the vertical arc curvature κ_z;
// the head is higher and descends more steeply earlier), z0 = head-centre height at contact. The speed is the 3D
// polyline length of the last LM_PARAMS.hb_speed.max_samples pre-impact samples (ground x within window_m before the
// impact point) over their rolling-shutter observation times. Monte Carlo (seeded rng): pixel noise
// (physics/club.js CLUB_SIGMA_PX), z0 ~ U(head_height_range_m), A ~ the club's attack prior, κ_z ~ N(kappa_z_per_m,
// kappa_z_sigma), × N(1, sys_sigma_frac) (camera yaw / scale, readout); ci95 = 2.5–97.5 % of the draws, sigma = SD.
// The camera looks almost along the head's motion, so the head height (attack, arc) maps into distance: the synthetic
// sweep (tests/unit/lm.physics.club.test.mjs, simulateClubHead) gives σ ≈ 15–20 % (RN §7; not the 5–8 % first
// estimated there). Validity low_confidence always.

import { ray } from '../../geom/camera.js';
import { gauss, uniform } from '../../geom/rng.js';
import { percentile, std } from '../../geom/stats.js';
import { RC } from '../../contract/reason-codes.js';
import { CLUB_SIGMA_PX } from '../club.js';
import { HEAD_BEHIND_BALL_M } from '../clubpath.js';
import { observationTimes } from '../shutter.js';
import { LM_PARAMS } from './params.js';

const D = Math.PI / 180;

/** Ray of (u, v) ∩ the surface z(s) above; [x, y, z] or null. */
function onSurface(cam, u, v, xImp, z0, tanA, kap) {
  const { C, d } = ray(cam, u, v);
  if (!Number.isFinite(d[0])) return null;
  let x = xImp;
  let P = null;
  for (let k = 0; k < 6; k++) {
    const s = Math.min(0, x - xImp);
    const zs = z0 + s * tanA + 0.5 * kap * s * s;
    const slope = tanA + kap * s; // dz/dx at s, local plane z = zs + (X − x)·slope
    const den = d[2] - d[0] * slope;
    if (!(Math.abs(den) > 1e-12)) return null;
    const t = (zs + (C[0] - x) * slope - C[2]) / den;
    if (!(t > 0)) return null;
    P = [C[0] + t * d[0], C[1] + t * d[1], C[2] + t * d[2]];
    if (Math.abs(P[0] - x) < 1e-6) break;
    x = P[0];
  }
  return P;
}

function speedOf(cam, pts, times, xImp, z0, tanA, kap) {
  let len = 0;
  let prev = null;
  for (const q of pts) {
    const P = onSurface(cam, q.u, q.v, xImp, z0, tanA, kap);
    if (!P) return NaN;
    if (prev) len += Math.hypot(P[0] - prev[0], P[1] - prev[1], P[2] - prev[2]);
    prev = P;
  }
  const T = times[times.length - 1] - times[0];
  return T > 0 ? len / T : NaN;
}

/**
 * o: { cam, obs: [{ frame, t_s, u, v }], ball: [x, y] (resting ball on the ground), aoa: { mean, sd } (club attack
 *   prior, °), rng, n = hb_speed.mc_draws }.
 * Returns { ok, value, sigma, ci95, n_used, reason_codes } or { ok: false, reason_codes }.
 */
export function hbClubSpeed(o) {
  const P = LM_PARAMS.hb_speed;
  const cam = o.cam;
  const ball = o.ball ?? [0, 0];
  const xImp = ball[0] - HEAD_BEHIND_BALL_M;
  const good = (o.obs ?? []).filter((q) => Number.isFinite(q.u) && Number.isFinite(q.v) && Number.isFinite(q.t_s));
  if (!cam || good.length < 2) return { ok: false, reason_codes: [RC.TRACK_TOO_SHORT] };
  const times = observationTimes(good, cam);
  const aoa = o.aoa ?? { mean: -3, sd: 2.5 };
  const tan0 = Math.tan(aoa.mean * D);
  const sel = [];
  for (let i = 0; i < good.length; i++) {
    const Q = onSurface(cam, good[i].u, good[i].v, xImp, P.head_height_m, tan0, P.kappa_z_per_m);
    if (Q && Q[0] <= xImp + P.ahead_m && Q[0] >= xImp - P.window_m && Math.abs(Q[1] - ball[1]) <= 0.5) sel.push({ ...good[i], t: times[i] });
  }
  sel.sort((a, b) => a.t - b.t);
  const pts = sel.slice(-P.max_samples);
  const frames = new Set(pts.map((q) => q.frame ?? q.t));
  if (pts.length < 2 || frames.size < 2) return { ok: false, reason_codes: [RC.TRACK_TOO_SHORT], n_used: pts.length };
  const tt = pts.map((q) => q.t);
  const value0 = speedOf(cam, pts, tt, xImp, P.head_height_m, tan0, P.kappa_z_per_m);
  if (!(value0 > 0)) return { ok: false, reason_codes: [RC.TRACK_TOO_SHORT], n_used: pts.length };
  const value = value0 * (1 + P.bias_frac);
  const rng = o.rng;
  const n = o.n ?? P.mc_draws;
  const draws = [];
  for (let k = 0; k < n; k++) {
    const noisy = pts.map((q) => ({ u: q.u + gauss(rng, 0, CLUB_SIGMA_PX), v: q.v + gauss(rng, 0, CLUB_SIGMA_PX) }));
    const z0 = uniform(rng, P.head_height_range_m[0], P.head_height_range_m[1]);
    const ta = Math.tan(gauss(rng, aoa.mean, aoa.sd) * D);
    const kap = Math.max(0, gauss(rng, P.kappa_z_per_m, P.kappa_z_sigma));
    const s = speedOf(cam, noisy, tt, xImp, z0, ta, kap) * (1 + P.bias_frac) * (1 + gauss(rng, 0, P.sys_sigma_frac));
    if (Number.isFinite(s)) draws.push(s);
  }
  if (draws.length < n / 2) return { ok: false, reason_codes: [RC.TRACK_TOO_SHORT], n_used: pts.length };
  const lo = Math.min(percentile(draws, 2.5), value);
  const hi = Math.max(percentile(draws, 97.5), value);
  return {
    ok: true, value, sigma: std(draws), ci95: [lo, hi], n_used: pts.length,
    reason_codes: pts.length < P.max_samples ? [RC.TRACK_MAY_BE_SHORT] : [],
  };
}
