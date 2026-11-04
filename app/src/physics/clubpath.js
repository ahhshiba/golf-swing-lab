// Club path at impact (CAFCR F2 #15, high_behind only, ≥ 240 fps, 低 ±2–4°; C1.3).
//
// Model. The club-head image track near impact (track/club.js observations) is mapped onto the ground through the
// calibrated camera (physics/ground.js rayToGround): the head centre is assumed to move in a horizontal plane at
// HEAD_HEIGHT_NOMINAL_M (C1.3: head 0–5 cm above the ground). A constant plane height does not change ground
// directions (homothety about the camera foot), so only its variation along the path (attack angle) and the
// camera's side offset enter, as a systematic term computed with the actual camera (below).
// Samples whose ground x lies within ±CLUB_PATH_WINDOW_M of the impact point (ball spot − HEAD_BEHIND_BALL_M along
// x) are fitted with a total-least-squares line; fewer than CLUB_PATH_MIN_SAMPLES → TRACK_TOO_SHORT (C1.3: at
// 40 m/s and 240 fps the head moves 16.7 cm per frame, so ±0.15 m holds 1–2 samples, 20 % of shots only one).
// Arc correction: the horizontal projection of the swing arc curves (curvature κ ≈ cos(plane)/radius, 0.25–0.5 /m
// for plane 50–65° and hub-to-head radius 1.3–1.8 m), so the chord direction is the tangent at the samples'
// mean position s̄ (along the path, from impact), not at impact: path(0) = chord + κ·s̄ (canonical frame,
// + in-to-out; before impact the path is more in-to-out). κ prior PATH_CURVATURE_PER_M ± PATH_CURVATURE_SIGMA.
// Sign: canonical right-handed frame (left-handed: y mirrored), path = atan2(−v_y, v_x), + = in-to-out (toward
// −y, away from the golfer, while moving to the target).
// Uncertainty (Monte Carlo, n draws, seeded rng): per draw the pixels get N(0, CLUB_SIGMA_PX) noise (blurred head
// centroid, C1.3 1.0–1.5°/px), the camera gets a yaw error about the ball spot (1:1 on ground directions) with
// σ = the ground-direction σ of the mat solve (physics/ground.js groundCalibSigmas, ≈ 0.27° at 3 px corners; it
// contains the roll/heading coupling of the solve, see physics/launch_h.js), the head
// height z0 ~ U(HEAD_HEIGHT_RANGE_M) with an attack angle ~ U(ATTACK_RANGE_DEG) (plane assumption, C1.3 ≤0.35° on
// the ball line, ~1° for a descending blow, 0.4–2.2° at 0.3 m side offset), and κ ~ N(prior). sigma = SD of the
// draws, ci95 = 2.5–97.5 % percentiles (widened to contain the value). All numbers UNVERIFIED (assumed head
// blur, swing geometry) until owner clips with a reference launch monitor.
// Side offset of the camera > SIDE_OFFSET_RED_M (C1.3 red light): returned as side_offset_red; the plane term
// above already widens σ for it.

import { DEG, RAD2DEG } from '../geom/constants.js';
import { gauss, uniform } from '../geom/rng.js';
import { percentile, std } from '../geom/stats.js';
import { RC } from '../contract/reason-codes.js';
import { CLUB_SIGMA_PX } from './club.js';
import { groundCalibSigmas, rayToGround, sideOffset, yawAboutPoint } from './ground.js';
import { fpsAtLeast } from '../geom/constants.js';

export const CLUB_PATH_MIN_FPS = 240;
export const CLUB_PATH_WINDOW_M = 0.15;
export const CLUB_PATH_MIN_SAMPLES = 2;
export const HEAD_HEIGHT_NOMINAL_M = 0.025;
export const HEAD_HEIGHT_RANGE_M = Object.freeze([0, 0.05]);
export const ATTACK_RANGE_DEG = Object.freeze([-5, 5]);
/** Head centre behind the ball centre along the path at contact: ball radius + face-to-centre ≈ 2 cm. */
export const HEAD_BEHIND_BALL_M = 0.04;
export const PATH_CURVATURE_PER_M = 0.35;
export const PATH_CURVATURE_SIGMA = 0.08;
export const SIDE_OFFSET_RED_M = 0.15;

function nullPath(validity, codes, extra = {}) {
  return { ok: false, club_path_deg: null, sigma: null, ci95: null, validity, reason_codes: codes, value_origin: 'club_track', ...extra };
}

/** TLS direction (unit [dx, dy], oriented to +x) of 2D points; null when degenerate. */
function tlsDirection(pts) {
  const n = pts.length;
  let mx = 0, my = 0;
  for (const p of pts) { mx += p[0]; my += p[1]; }
  mx /= n; my /= n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) {
    const dx = p[0] - mx, dy = p[1] - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  if (!(sxx + syy > 1e-10)) return null;
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let d = [Math.cos(th), Math.sin(th)];
  if (d[0] < 0) d = [-d[0], -d[1]];
  return { d, mx, my };
}

/** Path (deg, canonical) from ground points; s̄ relative to xImp; κ arc correction. */
function pathOf(pts, xImp, kappa, mirror) {
  const fit = tlsDirection(pts);
  if (!fit) return null;
  const dy = mirror ? -fit.d[1] : fit.d[1];
  const chord = Math.atan2(-dy, fit.d[0]);
  const sMid = fit.mx - xImp;
  return { deg: (chord + kappa * sMid) * RAD2DEG, chord_deg: chord * RAD2DEG, s_mid: sMid };
}

function groundPoints(cam, obs, z0, tanA, xImp) {
  const out = [];
  for (const o of obs) {
    const P = rayToGround(cam, o.u, o.v, z0, tanA, xImp);
    out.push(P);
  }
  return out;
}

/**
 * Club path. o: { cam (calibrated camera), obs: [{ frame, t_s, u, v, conf }], ball: [x, y] resting-ball centre on
 *   the ground (default [0, 0]), fps, handedness = 'right', calibration? (pose_sigma), venue? (mat size),
 *   rng (geom/rng.js), n = 600 }.
 * Returns { ok, club_path_deg, sigma, ci95, validity: 'low_confidence', reason_codes, value_origin: 'club_track',
 *   n_used, chord_deg, s_mid_m, side_offset_m, side_offset_red, draws } or a null result
 *   (FPS_TOO_LOW / TRACK_TOO_SHORT).
 */
export function clubPath(o) {
  const fps = o.fps;
  if (!fpsAtLeast(fps, CLUB_PATH_MIN_FPS)) return nullPath('not_observable', [RC.FPS_TOO_LOW]);
  const cam = o.cam;
  const mirror = o.handedness === 'left';
  const ball = o.ball ?? [0, 0];
  const xImp = ball[0] - HEAD_BEHIND_BALL_M;
  const good = (o.obs ?? []).filter((q) => Number.isFinite(q.u) && Number.isFinite(q.v));
  const P0 = groundPoints(cam, good, HEAD_HEIGHT_NOMINAL_M, 0, xImp);
  const sel = [];
  for (let i = 0; i < good.length; i++) {
    const P = P0[i];
    if (P && Math.abs(P[0] - xImp) <= CLUB_PATH_WINDOW_M && Math.abs(P[1] - ball[1]) <= 0.5) sel.push(i);
  }
  // distinct samples (two detections of the same frame count once)
  const frames = new Set(sel.map((i) => good[i].frame ?? i));
  if (sel.length < CLUB_PATH_MIN_SAMPLES || frames.size < CLUB_PATH_MIN_SAMPLES) {
    return nullPath('not_computed', [RC.TRACK_TOO_SHORT], { n_used: sel.length });
  }
  const pts = sel.map((i) => P0[i]);
  const nominal = pathOf(pts, xImp, PATH_CURVATURE_PER_M, mirror);
  if (!nominal) return nullPath('not_computed', [RC.TRACK_TOO_SHORT], { n_used: sel.length });

  const rng = o.rng;
  const n = o.n ?? 600;
  const cs = groundCalibSigmas(cam, o.calibration, o.venue);
  const sYaw = cs.yaw_deg;
  const selObs = sel.map((i) => good[i]);
  const draws = [];
  // o.terms (tests only): switch single Monte-Carlo terms off, e.g. { pixel: false }
  const on = { pixel: true, yaw: true, plane: true, kappa: true, ...(o.terms ?? {}) };
  for (let k = 0; k < n; k++) {
    const dYaw = gauss(rng, 0, sYaw) * DEG;
    const z0 = uniform(rng, HEAD_HEIGHT_RANGE_M[0], HEAD_HEIGHT_RANGE_M[1]);
    const aDeg = uniform(rng, ATTACK_RANGE_DEG[0], ATTACK_RANGE_DEG[1]);
    const kap0 = gauss(rng, PATH_CURVATURE_PER_M, PATH_CURVATURE_SIGMA);
    const c = on.yaw ? yawAboutPoint(cam, dYaw, [ball[0], ball[1], 0]) : cam;
    const tanA = on.plane ? Math.tan(aDeg * DEG) : 0;
    const kap = on.kappa ? Math.max(0, kap0) : PATH_CURVATURE_PER_M;
    const sPx = on.pixel ? CLUB_SIGMA_PX : 0;
    const noisy = selObs.map((q) => ({ u: q.u + gauss(rng, 0, sPx), v: q.v + gauss(rng, 0, sPx) }));
    const P = groundPoints(c, noisy, on.plane ? z0 : HEAD_HEIGHT_NOMINAL_M, tanA, xImp);
    if (P.some((x) => !x)) continue;
    const r = pathOf(P, xImp, kap, mirror);
    if (r) draws.push(r.deg);
  }
  if (draws.length < Math.max(20, 0.5 * n)) return nullPath('not_computed', [RC.TRACK_TOO_SHORT], { n_used: sel.length });
  // the draws scatter around the (already noisy) measurement: their spread is the uncertainty of the value
  const value = nominal.deg;
  let mDraw = 0;
  for (const d of draws) mDraw += d;
  mDraw /= draws.length;
  const shifted = draws.map((d) => d - mDraw + value);
  const lo = Math.min(percentile(shifted, 2.5), value);
  const hi = Math.max(percentile(shifted, 97.5), value);
  const side = sideOffset(cam);
  return {
    ok: true,
    club_path_deg: value,
    sigma: std(shifted),
    ci95: [lo, hi],
    validity: 'low_confidence',
    reason_codes: [],
    value_origin: 'club_track',
    n_used: sel.length,
    chord_deg: nominal.chord_deg,
    s_mid_m: nominal.s_mid,
    side_offset_m: side,
    side_offset_red: Math.abs(side) > SIDE_OFFSET_RED_M,
    draws: Float64Array.from(shifted),
  };
}
