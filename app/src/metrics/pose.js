// Pose-metric primitives for F2 rows 2–13, shared by the view modules. All geometry is in the canonical
// right-handed mat frame produced by body.js. Each primitive returns either
//   { value, sigma, codes, cap }      cap = weakest validity this measurement allows
//   { nullValidity, codes }           an honest null
// and finalize() turns it into a contract Metric under the registry cell. Definitions: docs/metrics-by-view.md.

import { RC } from '../contract/reason-codes.js';
import { RAD2DEG } from '../geom/constants.js';
import { median } from '../geom/stats.js';
import { POSE_SIGMA, EVENT_CONF_MIN, rss, worseValidity, valueMetric, nullMetric } from './common.js';
import { meanOver, midOf, meanVis, missingCode, segmentOnRays, azimuth } from './body.js';
import { wrapPi, nearestIndex } from '../events/signal.js';
import { ray as rayOfPixel } from '../geom/camera.js';

/** Plausibility limits; a value outside becomes an implausible null. */
export const LIMITS = Object.freeze({
  head_sway_x_m: [-0.4, 0.4], head_lift_z_m: [-0.4, 0.4], head_depth_y_m: [-0.4, 0.4],
  spine_forward_tilt_deg: [0, 80], spine_side_tilt_deg: [-30, 50],
  shoulder_turn_deg: [-60, 180], hip_turn_deg: [-60, 150], x_factor_deg: [-90, 150],
  hand_plane_dev_m: [-0.8, 0.8], top_shaft_angle_deg: [-90, 90], weight_shift_pct: [-150, 150],
  early_extension_m: [-0.4, 0.4],
});

/** Shared per-clip state for the primitives. */
export function poseContext({ body, events, calibration, fps, club, clubObs }) {
  const conf = (name) => (events?.[name] && Number.isFinite(events[name].conf) ? events[name].conf : 0);
  return { body, events, calibration, fps, club, clubObs, conf, roll_sigma_deg: calibration?.pose_sigma?.roll_deg ?? 1.0,
    pitch_sigma_deg: calibration?.pose_sigma?.pitch_deg ?? 1.0 };
}

function need(ctx, names) {
  for (const n of names) {
    const e = ctx.events?.[n];
    if (!e || !Number.isFinite(e.t_s)) return { nullValidity: 'not_computed', codes: [RC.EVENTS_UNCERTAIN] };
  }
  return null;
}

function eventCodes(ctx, names) {
  const low = names.some((n) => ctx.conf(n) < EVENT_CONF_MIN);
  return low ? { codes: [RC.EVENTS_UNCERTAIN], cap: 'low_confidence' } : { codes: [], cap: 'valid' };
}

function visCodes(body, frames, js) {
  return meanVis(body, frames, js) < 0.5 ? { codes: [RC.POSE_LOW_VISIBILITY], cap: 'low_confidence' } : { codes: [], cap: 'valid' };
}

function merge(...parts) {
  const codes = [];
  let cap = 'valid';
  for (const p of parts) {
    for (const c of p.codes) if (!codes.includes(c)) codes.push(c);
    cap = worseValidity(cap, p.cap);
  }
  return { codes, cap };
}

/** Window mean of the mid-point of canonical landmarks js (1 or 2 landmarks). */
function windowMean(body, frames, js) {
  const fn = js.length === 2 ? (i) => midOf(body, i, js[0], js[1]) : (i) => body.P(i, js[0]);
  return meanOver(frames, fn);
}

function nullMissing(body, frames, js) {
  return { nullValidity: 'occluded', codes: [missingCode(body, frames, js)] };
}

function dispSigma(level, value, jitter, scaleRel) {
  return rss(POSE_SIGMA.disp_rel[level] * Math.abs(value), POSE_SIGMA.disp_abs_m[level], jitter, scaleRel * Math.abs(value));
}

/** Displacement of a canonical point set between the address window and an event window along one axis. */
export function displacement(ctx, level, js, eventName, axis, sign = 1, method = '3d') {
  const body = ctx.body;
  const miss = need(ctx, ['address', eventName]);
  if (miss) return miss;
  const fa = body.addressFrames();
  const fe = body.eventFrames(eventName);
  const a = windowMean(body, fa, js);
  if (!a) return nullMissing(body, fa, js);
  let e;
  let extraSigma = 0;
  if (method === 'zplane') {
    // head assumed to stay at its address height: intersect the viewing ray with z = z_address
    const z0 = a.X[2];
    const g = (i) => {
      const pts = js.map((j) => body.onGround(i, j, z0));
      if (pts.some((p) => p === null)) return null;
      return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length, z0];
    };
    const ga = meanOver(fa, g);
    e = meanOver(fe, g);
    if (!ga || !e) return nullMissing(body, ga ? fe : fa, js);
    // an unmodelled head-height change of HEAD_Z_ASSUMED_M moves the intersection by dz·(d_axis/d_z)
    const r = body.rayOf(fe[fe.length >> 1], js[0]) ?? body.rayOf(fa[0], js[0]);
    const dAxis = r ? Math.abs(r.d[axis] / r.d[2]) : Infinity;
    extraSigma = HEAD_Z_ASSUMED_M * dAxis;
    // a near-horizontal ray makes this axis the depth axis: the head-height assumption alone would exceed the limit
    if (!(extraSigma <= ZPLANE_MAX_SIGMA_M)) return { nullValidity: 'not_observable', codes: [RC.VIEW_DEPTH_AXIS] };
    const value = sign * (e.X[axis] - ga.X[axis]);
    const jitter = Math.hypot(e.sd[axis] / Math.sqrt(e.n), ga.sd[axis] / Math.sqrt(ga.n));
    const m = merge(eventCodes(ctx, ['address', eventName]), visCodes(body, fe, js));
    return { value, sigma: rss(dispSigma(level, value, jitter, body.depth.sigma_rel), extraSigma), ...m };
  }
  e = windowMean(body, fe, js);
  if (!e) return nullMissing(body, fe, js);
  const value = sign * (e.X[axis] - a.X[axis]);
  const jitter = Math.hypot(e.sd[axis] / Math.sqrt(e.n), a.sd[axis] / Math.sqrt(a.n));
  const m = merge(eventCodes(ctx, ['address', eventName]), visCodes(body, fe, js), visCodes(body, fa, js), planeCodes(body));
  return { value, sigma: dispSigma(level, value, jitter, body.depth.sigma_rel), ...m };
}

/** Vertical change of the head the high_behind z-plane method does not model (1 sigma, m). */
export const HEAD_Z_ASSUMED_M = 0.03;
/** Above this sigma from the head-height assumption alone the z-plane axis is reported as VIEW_DEPTH_AXIS (m). */
export const ZPLANE_MAX_SIGMA_M = 0.1;

function planeCodes(body) {
  return body.depth.assumed ? { codes: [RC.BODY_PLANE_ASSUMED], cap: body.camAssumed ? 'low_confidence' : 'estimated' } : { codes: [], cap: 'valid' };
}

/** Spine tilt at address: forward (toward the ball, y–z plane) or side (away from target, x–z plane). */
export function spineTilt(ctx, level, which) {
  const body = ctx.body;
  const miss = need(ctx, ['address']);
  if (miss) return miss;
  const fa = body.addressFrames();
  const js = [11, 12, 23, 24];
  const per = [];
  for (const i of fa) {
    const sh = midOf(body, i, 11, 12);
    const hp = midOf(body, i, 23, 24);
    if (!sh || !hp) continue;
    const s = [sh[0] - hp[0], sh[1] - hp[1], sh[2] - hp[2]];
    per.push(Math.atan2(which === 'forward' ? -s[1] : -s[0], s[2]) * RAD2DEG);
  }
  if (per.length === 0) return nullMissing(body, fa, js);
  const value = per.reduce((s, x) => s + x, 0) / per.length;
  const sd = per.length > 1 ? Math.sqrt(per.reduce((s, x) => s + (x - value) ** 2, 0) / (per.length - 1)) : 0;
  const calib = which === 'forward' ? rss(ctx.roll_sigma_deg, 0.23 * ctx.pitch_sigma_deg) : ctx.roll_sigma_deg;
  const sigma = rss(POSE_SIGMA.angle_deg[level], sd / Math.sqrt(per.length), calib);
  const m = merge(eventCodes(ctx, ['address']), visCodes(body, fa, js), body.camAssumed ? planeCodes(body) : { codes: [], cap: 'valid' });
  return { value, sigma, ...m };
}

/** 3D length of a segment for the turn solver. */
function segmentLength(body, a, b) {
  const fa = body.addressFrames();
  if (body.view === 'face_on') {
    const ls = [];
    for (const i of fa) {
      const A = body.P(i, a);
      const B = body.P(i, b);
      if (A && B) ls.push(Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]));
    }
    if (ls.length) return median(ls);
  }
  const ws = [];
  for (let i = 0; i < body.T; i++) { const d = body.worldDist(i, a, b); if (Number.isFinite(d) && d > 0) ws.push(d); }
  return ws.length ? median(ws) : NaN;
}

function meanAzimuth(body, frames, a, b, L) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  const per = [];
  for (const i of frames) {
    const seg = segmentOnRays(body, i, a, b, L);
    if (!seg) continue;
    const az = azimuth(seg[0], seg[1]);
    sx += Math.cos(az); sy += Math.sin(az); n++;
    per.push(az);
  }
  if (n === 0) return null;
  const m = Math.atan2(sy, sx);
  let sd = 0;
  for (const x of per) sd += wrapPi(x - m) ** 2;
  sd = n > 1 ? Math.sqrt(sd / (n - 1)) : 0;
  return { az: m, sd, n };
}

/** Turn (deg) of the lead–trail line a–b about the vertical from address to top (positive = away from target). */
export function turn(ctx, level, a, b) {
  const body = ctx.body;
  const miss = need(ctx, ['address', 'top']);
  if (miss) return miss;
  const fa = body.addressFrames();
  const ft = body.eventFrames('top');
  const L = segmentLength(body, a, b);
  if (!Number.isFinite(L)) return { nullValidity: 'not_computed', codes: [RC.DEPENDS_ON_NULL] };
  const A = meanAzimuth(body, fa, a, b, L);
  const Tt = meanAzimuth(body, ft, a, b, L);
  if (!A) return nullMissing(body, fa, [a, b]);
  if (!Tt) return nullMissing(body, ft, [a, b]);
  const value = -wrapPi(Tt.az - A.az) * RAD2DEG;
  const A2 = meanAzimuth(body, fa, a, b, L * 1.05);
  const T2 = meanAzimuth(body, ft, a, b, L * 1.05);
  const sL = A2 && T2 ? Math.abs(-wrapPi(T2.az - A2.az) * RAD2DEG - value) : 5;
  const jitter = Math.hypot(Tt.sd / Math.sqrt(Tt.n), A.sd / Math.sqrt(A.n)) * RAD2DEG;
  const sigma = rss(POSE_SIGMA.angle_deg[level], jitter, sL);
  const m = merge(eventCodes(ctx, ['address', 'top']), visCodes(body, ft, [a, b]), body.camAssumed ? planeCodes(body) : { codes: [], cap: 'valid' });
  return { value, sigma, ...m };
}

/** Hands (mid-wrist) at the top vs the shaft plane at address (plane through the ball line and the address hands). */
export function handPlaneDev(ctx, level) {
  const body = ctx.body;
  const miss = need(ctx, ['address', 'top']);
  if (miss) return miss;
  const fa = body.addressFrames();
  const ft = body.eventFrames('top');
  const ha = windowMean(body, fa, [15, 16]);
  if (!ha) return nullMissing(body, fa, [15, 16]);
  const ht = windowMean(body, ft, [15, 16]);
  if (!ht) return nullMissing(body, ft, [15, 16]);
  const n = Math.hypot(ha.X[1], ha.X[2]);
  const value = (ht.X[2] * ha.X[1] - ht.X[1] * ha.X[2]) / n;
  const jitter = Math.hypot(ht.sd[1], ht.sd[2]) / Math.sqrt(ht.n);
  const m = merge(eventCodes(ctx, ['address', 'top']), visCodes(body, ft, [15, 16]), planeCodes(body));
  return { value, sigma: dispSigma(level, value, jitter, body.depth.sigma_rel), ...m };
}

/** Pelvis (mid-hip) lateral shift address -> impact as % of the address stance width (ankle to ankle). */
export function weightShift(ctx, level) {
  const body = ctx.body;
  const miss = need(ctx, ['address', 'impact']);
  if (miss) return miss;
  const fa = body.addressFrames();
  const fi = body.eventFrames('impact');
  const pa = windowMean(body, fa, [23, 24]);
  const pi = windowMean(body, fi, [23, 24]);
  const al = windowMean(body, fa, [27]);
  const ar = windowMean(body, fa, [28]);
  if (!pa || !al || !ar) return nullMissing(body, fa, [23, 24, 27, 28]);
  if (!pi) return nullMissing(body, fi, [23, 24]);
  const stance = Math.abs(al.X[0] - ar.X[0]);
  if (!(stance > 0.1)) return { nullValidity: 'implausible', codes: [RC.IMPLAUSIBLE_VALUE] };
  const dx = pi.X[0] - pa.X[0];
  const value = (100 * dx) / stance;
  const jitter = Math.hypot(pi.sd[0] / Math.sqrt(pi.n), pa.sd[0] / Math.sqrt(pa.n));
  // the ratio of two lengths at the same depth: the body-plane scale cancels
  const sigma = (100 * rss(POSE_SIGMA.disp_rel[level] * Math.abs(dx), POSE_SIGMA.disp_abs_m[level], jitter)) / stance;
  const m = merge(eventCodes(ctx, ['address', 'impact']), visCodes(body, fi, [23, 24]));
  return { value, sigma, ...m };
}

/** Top-of-backswing shaft angle vs the target line in the horizontal plane (+ = across the line), from club obs. */
export function topShaftAngle(ctx, level) {
  const body = ctx.body;
  const miss = need(ctx, ['top']);
  if (miss) return miss;
  const obs = ctx.clubObs;
  // no club-head detection at all: the head was not tracked near the top (a track problem, not a missing number)
  if (!Array.isArray(obs) || obs.length === 0) return { nullValidity: 'not_computed', codes: [RC.TRACK_TOO_SHORT] };
  const tTop = ctx.events.top.t_s;
  let best = null;
  for (const o of obs) if (Number.isFinite(o.t_s) && (best === null || Math.abs(o.t_s - tTop) < Math.abs(best.t_s - tTop))) best = o;
  const fps = ctx.fps;
  if (!best || Math.abs(best.t_s - tTop) > 1.5 / fps) return { nullValidity: 'not_computed', codes: [RC.TRACK_TOO_SHORT] };
  const ft = body.eventFrames('top');
  const i0 = nearestIndex(body.t_s, best.t_s);
  const hands = midOf(body, i0, 15, 16) ?? windowMean(body, ft, [15, 16])?.X;
  if (!hands) return nullMissing(body, ft, [15, 16]);
  const Lc = Number.isFinite(ctx.club?.length_m) ? ctx.club.length_m - GRIP_TO_HANDS_M : SHAFT_PRIOR_M;
  const sLc = Number.isFinite(ctx.club?.length_m) ? 0.03 : SHAFT_PRIOR_SIGMA_M;
  const solveAt = (L, dv) => clubHeadOnRay(body, best.u, best.v + dv, hands, L);
  const ang = (Hd) => Math.atan2(-(Hd[1] - hands[1]), Hd[0] - hands[0]) * RAD2DEG;
  const head = solveAt(Lc, 0);
  if (!head) return { nullValidity: 'not_computed', codes: [RC.DEPENDS_ON_NULL] };
  const value = ang(head);
  const hL = solveAt(Lc + sLc, 0);
  const hP = solveAt(Lc, 2);
  const sigma = rss(POSE_SIGMA.angle_deg[level], hL ? ang(hL) - value : 10, hP ? ang(hP) - value : 5, ctx.roll_sigma_deg);
  const m = merge(eventCodes(ctx, ['top']), visCodes(body, ft, [15, 16]));
  return { value, sigma, ...m };
}

/** Hands-to-club-head length prior when the club length is unknown (mid iron), and the grip offset. */
export const SHAFT_PRIOR_M = 0.88;
export const SHAFT_PRIOR_SIGMA_M = 0.07;
export const GRIP_TO_HANDS_M = 0.1;

/** Club head on its viewing ray at distance L from the (canonical) hands; the root farther from the camera. */
function clubHeadOnRay(body, u, v, handsCanon, L) {
  const r = rayFrom(body, u, v);
  if (!r) return null;
  const H = body.canon(handsCanon); // canon is its own inverse (mirror through y = 0)
  const CH = [H[0] - r.C[0], H[1] - r.C[1], H[2] - r.C[2]];
  const b = r.d[0] * CH[0] + r.d[1] * CH[1] + r.d[2] * CH[2];
  const c = CH[0] * CH[0] + CH[1] * CH[1] + CH[2] * CH[2] - L * L;
  const disc = b * b - c;
  const lam = disc >= 0 ? b + Math.sqrt(disc) : b;
  if (!(lam > 0)) return null;
  return body.canon([r.C[0] + lam * r.d[0], r.C[1] + lam * r.d[1], r.C[2] + lam * r.d[2]]);
}

function rayFrom(body, u, v) {
  const cam = body.cam;
  if (!(u >= 0 && u <= cam.W && v >= 0 && v <= cam.H)) return null;
  return rayOfPixel(cam, u, v);
}

/** Turn a primitive result into a contract Metric under the registry cell validity. */
export function finalize(id, cellValidity, r) {
  if (r.nullValidity) return nullMetric(id, r.nullValidity, r.codes);
  const lim = LIMITS[id];
  if (!Number.isFinite(r.value) || !Number.isFinite(r.sigma) || (lim && (r.value < lim[0] || r.value > lim[1]))) {
    return nullMetric(id, 'implausible', [RC.IMPLAUSIBLE_VALUE]);
  }
  return valueMetric(id, { value: r.value, sigma: r.sigma, validity: worseValidity(cellValidity, r.cap), codes: r.codes });
}

