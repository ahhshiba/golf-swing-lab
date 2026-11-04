// Club-head speed at impact from a face_on club-head pixel track (CAFCR F2 #14, #20).
// The head centre is assumed to move in the vertical plane y = start.y + HEAD_DEPTH_OFFSET_M: the tracked head
// centroid sits 0–5 cm deeper than the ball (behind the face, toe/heel), so the plane is put at the median 2.5 cm.
// Only detections before impact are used (the head loses 20–35 % of its speed in the collision); the speed is the
// polygon length of the last CLUB_WINDOW_FRAMES pre-impact frame intervals over their elapsed time (chords follow
// the arc; a polynomial evaluated at the window end is biased by the arc curvature).
// Swing-arc bias (K6: correct a one-sided bias with its median, put the rest in σ): just before impact the head is
// still coming from inside (deeper, +y) and moving partly in depth, which the ball-plane intersection cannot see,
// so the in-plane speed reads low. A synthetic sweep (tests/synth/ballflight.js simulateClubHead: plane 48–66°,
// radius 1.0–1.6 m, attack −5…+4°, path ±4°, head depth 0–5 cm, 240 fps) gave median −1.8 %, P5 −5.0 %,
// P95 +0.2 % for this estimator. At ≥ 200 fps the speed is multiplied by (1 + CLUB_ARC_MEDIAN_FRAC) and mc.js adds
// a per-draw uniform ±CLUB_DEPTH_SYS_FRAC (±3 %; the task asked ±2 % for the 0–5 cm head depth alone, the arc
// term widens it). Both numbers come from assumed swing geometry: UNVERIFIED until M4 field clips.
// Validity: fps ≥ 200 'estimated'; 30 ≤ fps < 200 'low_confidence' with ±25 % (95 %) extra (F2 #14); < 30 null.

import { RC } from '../contract/reason-codes.js';
import { observationTimes } from './shutter.js';
import { rayPlaneY } from './fit2d.js';
import { center } from '../geom/camera.js';
import { fpsAtLeast } from '../geom/constants.js';

export const HEAD_DEPTH_OFFSET_M = 0.025;
export const CLUB_DEPTH_SYS_FRAC = 0.03;
export const CLUB_ARC_MEDIAN_FRAC = 0.018;
/** Same sweep, 120–199 fps (pre-impact chord over more arc): median −5.4 % → +6 %. Inside the ±25 % band. */
export const CLUB_LOWFPS_PRE_MEDIAN_FRAC = 0.06;
/** Same sweep, chord bracketing impact (< 120 fps; head slows to ~0.75 after contact): median −11 % (60 fps) …
 *  −18 % (30 fps) → +15 %. Inside the ±25 % band; UNVERIFIED (post-impact head speed assumed). */
export const CLUB_BRACKET_MEDIAN_FRAC = 0.15;
export const CLUB_LOWFPS_CI95_FRAC = 0.25;
export const CLUB_MIN_FPS = 30;
export const CLUB_WINDOW_FRAMES = 2;
export const PRE_IMPACT_GUARD_FRAMES = 0.15;
/** Below this frame rate a pre-impact chord spans too much arc; the chord bracketing impact is used. */
export const CLUB_PRE_ONLY_MIN_FPS = 120;
export const CLUB_ESTIMATED_MIN_FPS = 200;
/** Pixel noise of a blurred club-head centroid (px, 1σ). UNVERIFIED (track/club.js not measured yet). */
export const CLUB_SIGMA_PX = 1.5;

function nullClub(validity, codes, extra = {}) {
  return { ok: false, club_speed_mps: null, sigma: null, validity, reason_codes: codes, value_origin: 'club_track', ...extra };
}

/**
 * Club-head speed. o: { cam, obs: [{ frame, t_s, u, v, conf }], start: { X }, t_impact, fps,
 *   depth_offset_m = HEAD_DEPTH_OFFSET_M, window_frames = CLUB_WINDOW_FRAMES, min_conf = 0 }.
 * Returns { ok, club_speed_mps, sigma, v_vec, n_used, validity, reason_codes, value_origin: 'club_track',
 *   readout_frac_per_ms (relative speed change per ms of readout error), lowfps_ci95_frac, depth_sys_frac }.
 */
export function clubSpeed(o) {
  const fps = o.fps;
  if (!fpsAtLeast(fps, CLUB_MIN_FPS)) return nullClub('not_observable', [RC.FPS_TOO_LOW]);
  if (!Number.isFinite(o.t_impact)) return nullClub('not_computed', [RC.DEPENDS_ON_NULL]);
  const cam = o.cam;
  const minConf = o.min_conf ?? 0;
  const good = (o.obs ?? []).filter((q) => Number.isFinite(q.u) && Number.isFinite(q.v) && Number.isFinite(q.t_s)
    && !(q.conf < minConf));
  const times = observationTimes(good, cam);
  const y0 = o.start.X[1] + (o.depth_offset_m ?? HEAD_DEPTH_OFFSET_M);
  const dtF = 1 / fps;
  const pts = [];
  for (let i = 0; i < good.length; i++) {
    const P = rayPlaneY(cam, good[i].u, good[i].v, y0);
    if (P) pts.push({ t: times[i] - o.t_impact, P, u: good[i].u, v: good[i].v });
  }
  pts.sort((a, b) => a.t - b.t);
  // Pre-impact detections within the last `window_frames` frame intervals. A detection must be at least
  // PRE_IMPACT_GUARD_FRAMES before t_impact: the fit3d t0 lags the contact by up to half an exposure, and a head
  // detection just after contact has already lost 20–35 % of its speed.
  const W = (o.window_frames ?? CLUB_WINDOW_FRAMES) * dtF;
  const guard = PRE_IMPACT_GUARD_FRAMES * dtF;
  const pre = pts.filter((q) => q.t <= -guard);
  let sel = fpsAtLeast(fps, CLUB_PRE_ONLY_MIN_FPS) ? pre.filter((q) => q.t >= -W - guard - 1e-9) : [];
  if (sel.length < 2 && fpsAtLeast(fps, CLUB_PRE_ONLY_MIN_FPS)) sel = pre.slice(-2);
  if (sel.length < 2) {
    // Low frame rate (or no two pre-impact detections): the chord bracketing impact. It is centred where the arc
    // is closest to the ball plane; the post-impact slow-down and the arc keep it inside the ±25 % band.
    const after = pts.filter((q) => q.t > -guard).slice(0, 1);
    sel = [...pre.slice(-1), ...after];
  }
  if (sel.length < 2) return nullClub('not_computed', [RC.TRACK_TOO_SHORT], { n_used: sel.length });
  // Speed = polygon length / elapsed time. Chords of consecutive detections follow the arc (bias −φ²/24 per
  // chord, < 0.1 % at 240 fps) where a polynomial fit evaluated at the window end is biased by the arc curvature.
  let len = 0;
  const chordSpeeds = [];
  for (let k = 1; k < sel.length; k++) {
    const d = Math.hypot(sel[k].P[0] - sel[k - 1].P[0], sel[k].P[1] - sel[k - 1].P[1], sel[k].P[2] - sel[k - 1].P[2]);
    len += d;
    if (sel[k].t > sel[k - 1].t) chordSpeeds.push(d / (sel[k].t - sel[k - 1].t));
  }
  const first = sel[0];
  const last = sel[sel.length - 1];
  const T = last.t - first.t;
  if (!(T > 0)) return nullClub('not_computed', [RC.TRACK_TOO_SHORT], { n_used: sel.length });
  const low = !fpsAtLeast(fps, CLUB_ESTIMATED_MIN_FPS);
  const bracket = first.t <= -guard && last.t > -guard;
  const corr = bracket ? CLUB_BRACKET_MEDIAN_FRAC : low ? CLUB_LOWFPS_PRE_MEDIAN_FRAC : CLUB_ARC_MEDIAN_FRAC;
  const speed = (len / T) * (1 + corr);
  const v = [0, 1, 2].map((k) => (last.P[k] - first.P[k]) / T);
  // σ: endpoint pixel noise mapped to metres at the plane depth (interior noise largely cancels in the sum),
  // or the scatter of the chord speeds if that is larger.
  const depth = Math.abs(y0 - center(cam)[1]);
  const sPos = (CLUB_SIGMA_PX * depth) / cam.f;
  let sigma = (Math.SQRT2 * sPos) / T;
  if (chordSpeeds.length >= 3) {
    const m = chordSpeeds.reduce((a, b) => a + b, 0) / chordSpeeds.length;
    const sd = Math.sqrt(chordSpeeds.reduce((a, b) => a + (b - m) ** 2, 0) / (chordSpeeds.length - 1));
    sigma = Math.max(sigma, sd / Math.sqrt(chordSpeeds.length));
  }
  const pu = { coef: [0, (last.u - first.u) / T] };
  const pv = { coef: [0, (last.v - first.v) / T] };
  const ro = cam.readout;
  const pxVel = ro && ro.axis === 'u' ? pu.coef[1] / cam.W : pv.coef[1] / cam.H;
  const readoutFracPerMs = ro && ro.ms !== undefined ? (-ro.dir * pxVel) / 1000 : 0;
  return {
    ok: true,
    club_speed_mps: speed,
    sigma,
    v_vec: v,
    n_used: sel.length,
    validity: low ? 'low_confidence' : 'estimated',
    chord: bracket ? 'bracket' : 'pre_impact',
    bias_correction_frac: corr,
    reason_codes: [],
    value_origin: 'club_track',
    readout_frac_per_ms: readoutFracPerMs,
    lowfps_ci95_frac: low ? CLUB_LOWFPS_CI95_FRAC : 0,
    depth_sys_frac: CLUB_DEPTH_SYS_FRAC,
    fps,
  };
}
