// Club-head speed from pose alone (CAFCR F2 #14, face_on at 30–199 fps: 低 ±25 %; at ≥ 200 fps the club-head
// track estimate of physics/club.js is used instead).
//
// Model (two-segment swing, lead arm + club, hub at the lead shoulder):
//   v_head(impact) = v_hand,peak · K · (r + L) / r
// v_hand,peak = the largest lead-wrist chord speed from impact − 0.12 s to impact + 0.02 s (the lead
// hand peaks 0.03–0.06 s before impact and slows into impact while the club releases); r = lead shoulder → wrist
// distance at address (pose, clamped to ARM_RANGE_M; prior ARM_PRIOR_M when not measurable); L = wrist → club-head
// centre ≈ club length (the lead wrist sits about as far above the grip end as the head centre is short of the
// toe end of the club length). (r + L)/r is the rigid-lever ratio (arm and club in line at impact); K > 1 is the
// extra club angular velocity from the wrist release.
// K = 1.9: published hand-speed vs club-speed figures (lead-hand peak 7–10 m/s for club speeds 36–50 m/s, i.e. a
// ratio of 4.8–5.5 for drivers with r ≈ 0.58 m, L ≈ 1.12 m) give K ≈ 1.8; the two-segment downswing model of
// tests/synth/cells.js gives 1.96 (SD 11 %). K_SIGMA_REL = 0.12 covers the swing-to-swing spread of the release
// (1σ). Both are UNVERIFIED until owner clips with a launch monitor.
// Chord-speed bias (K6: median correction, rest in σ): at 30 fps a chord spans 33 ms and averages over the hand
// peak, at 60 fps the max of noisy chords is biased up by the landmark + motion-blur noise (a 60 fps chord is
// ~70 px with several px of blur noise). Per-rate corrections CHORD_BIAS_BY_FPS come from a synthetic sweep
// independent of the gate (tests/synth/cells.js clubSpeedSwing seed 7, 40 swings per rate, detected events: median
// of true / estimated head speed 1.00 at 30 fps and 0.90 at 60 fps, divided by K_synth/K = 1.03; the residual σ
// is the log-SD of that ratio with the K spread removed, floor 5 %), interpolated in 1/fps, clamped outside.
// Known biases not modelled: MediaPipe's temporal smoothing of fast hands (would read the peak low), motion blur of
// the hands at 1/60 s exposures, hands far outside the body plane depth. ci95 half-width is
// max(CI95_MIN_FRAC = 25 %, 1.96 σ_rel) of the value (F2 "±25 %").

import { RC } from '../contract/reason-codes.js';
import { fpsAtLeast } from '../geom/constants.js';

export const POSE_CLUB_K = 1.9;
export const POSE_CLUB_K_SIGMA_REL = 0.12;
export const ARM_PRIOR_M = 0.58;
export const ARM_PRIOR_SIGMA_M = 0.05;
export const ARM_RANGE_M = Object.freeze([0.42, 0.75]);
export const WRIST_TO_HEAD_SIGMA_M = 0.05;
export const POSE_CLUB_WINDOW_S = Object.freeze([-0.12, 0.02]);
export const POSE_CLUB_MIN_FPS = 30;
export const POSE_CLUB_MAX_FPS = 200;
export const CI95_MIN_FRAC = 0.25;
/** [fps, multiplicative correction of the max chord speed, residual 1σ (relative)] from the synthetic sweep. */
export const CHORD_BIAS_BY_FPS = Object.freeze([
  Object.freeze([30, 0.97, 0.08]),
  Object.freeze([60, 0.87, 0.05]),
]);

function nullPose(validity, codes, extra = {}) {
  return { ok: false, club_speed_mps: null, sigma: null, ci95: null, validity, reason_codes: codes, value_origin: 'pose', ...extra };
}

/** Chord correction and its residual σ at a frame rate (linear in 1/fps between the table rows, clamped). */
export function chordBias(fps) {
  const T = CHORD_BIAS_BY_FPS;
  if (fps <= T[0][0]) return { k: T[0][1], s: T[0][2] };
  if (fps >= T[T.length - 1][0]) return { k: T[T.length - 1][1], s: T[T.length - 1][2] };
  for (let i = 1; i < T.length; i++) {
    if (fps <= T[i][0]) {
      const a = 1 / T[i - 1][0], b = 1 / T[i][0], x = 1 / fps;
      const w = (x - a) / (b - a);
      return { k: T[i - 1][1] + w * (T[i][1] - T[i - 1][1]), s: T[i - 1][2] + w * (T[i][2] - T[i - 1][2]) };
    }
  }
  return { k: 1, s: 0.06 };
}

/**
 * o: { t: number[] (s), wrist: ([x, y, z] | null)[] (lead wrist in metres, any fixed frame), t_impact, fps,
 *   club_length_m, arm_length_m? (lead shoulder–wrist at address), pos_sigma_m (1σ landmark position noise) }.
 * Returns { ok, club_speed_mps, sigma, ci95, validity: 'low_confidence', reason_codes: [], value_origin: 'pose',
 *   hand_peak_mps, lever, terms: { k, chord, noise, lever } (relative 1σ) } or a null result.
 */
export function clubSpeedFromPose(o) {
  const fps = o.fps;
  if (!fpsAtLeast(fps, POSE_CLUB_MIN_FPS)) return nullPose('not_observable', [RC.FPS_TOO_LOW]);
  if (!Number.isFinite(o.t_impact)) return nullPose('not_computed', [RC.EVENTS_UNCERTAIN]);
  const t = o.t;
  const W = o.wrist;
  const [w0, w1] = POSE_CLUB_WINDOW_S;
  const maxDt = 2.5 / fps;
  let best = null;
  let nChord = 0;
  let prev = -1;
  for (let i = 0; i < t.length; i++) {
    const tau = t[i] - o.t_impact;
    if (tau < w0 - maxDt || tau > w1 + maxDt) continue;
    if (!W[i]) continue;
    if (prev >= 0) {
      const dt = t[i] - t[prev];
      const mid = 0.5 * (t[i] + t[prev]) - o.t_impact;
      if (dt > 0 && dt <= maxDt && mid >= w0 && mid <= w1) {
        const a = W[prev], b = W[i];
        const sp = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / dt;
        nChord++;
        if (!best || sp > best.sp) best = { sp, dt };
      }
    }
    prev = i;
  }
  if (!best || nChord < 2) return nullPose('not_computed', [RC.POSE_LOW_VISIBILITY], { n_chords: nChord });
  const cb = chordBias(fps);
  const vHand = best.sp * cb.k;
  let r = o.arm_length_m;
  let sR = 0.02;
  if (!(Number.isFinite(r) && r >= ARM_RANGE_M[0] && r <= ARM_RANGE_M[1])) { r = ARM_PRIOR_M; sR = ARM_PRIOR_SIGMA_M; }
  const L = Number.isFinite(o.club_length_m) ? o.club_length_m : 0.94;
  const lever = (r + L) / r;
  const value = vHand * POSE_CLUB_K * lever;
  // relative 1σ terms
  const dLever = Math.hypot((L / (r * (r + L))) * sR, WRIST_TO_HEAD_SIGMA_M / (r + L));
  const noise = (Math.SQRT2 * (o.pos_sigma_m ?? 0.006)) / (best.sp * best.dt);
  const terms = { k: POSE_CLUB_K_SIGMA_REL, chord: cb.s, noise, lever: dLever };
  const sRel = Math.hypot(terms.k, terms.chord, terms.noise, terms.lever);
  const half = Math.max(CI95_MIN_FRAC, 1.959964 * sRel);
  return {
    ok: true,
    club_speed_mps: value,
    sigma: value * sRel,
    ci95: [value * (1 - half), value * (1 + half)],
    validity: 'low_confidence',
    reason_codes: [],
    value_origin: 'pose',
    hand_peak_mps: vHand,
    lever,
    arm_length_m: r,
    terms,
  };
}
