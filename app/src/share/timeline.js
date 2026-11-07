// share/timeline.js — the tracer clip's time line (V04-SPEC §D.1). Pure (no DOM, no clock): which source time, flight
// time or card frame each 30 fps output frame shows. Lazy; owner V4-E. Unit test: tests/unit/share.timeline.test.mjs.
//
//   buildTimeline({ fps, events, clipDuration_s?, flightT_s?, ballTrack?, card?, outFps? }) -> Timeline
//     fps            source frame rate (capture.effective_fps)
//     events         shot.events ({ address: { t_s }, impact: { t_s } … }); without both the swing is the last
//                    SWING_MAX_S of the clip at the source's slow-motion factor
//     clipDuration_s decoded clip length (source times are clamped into [0, clipDuration_s])
//     flightT_s      last flight sample time (shot.flight.samples) or null; ballTrack: shot.tracks has ball_px
//   Timeline = { out_fps, frames: [{ k, seg: 'swing'|'flight'|'card', t_out, src_t, flight_t, card_frac }],
//                duration_s, swing: { n, src_t0, src_t1, speed }, flight: { n, src_t, T }, card: { n } }
//   swing:  source [address − 0.3 s, impact + 0.1 s]; speed (source s per output s) 1/4 at ≥ 200 fps (every 2nd frame
//           of 240), 1/2 at ≥ 50 fps, 1 below; longer than 4 s → sped up to exactly 4 s
//   flight: the swing's last frame (impact + 0.1 s, so the source time never goes back) is held while the trail grows; real time, compressed into ≤ 3 s; no
//           flight but a detected track → 1 s; neither → no flight segment
//   card:   2.5 s when card is on.        Total ≤ 4 + 3 + 2.5 = 9.5 s (< the 12 s cap).

export const OUT_FPS = 30;
export const SWING_MAX_S = 4;
export const FLIGHT_MAX_S = 3;
export const TRACK_ONLY_S = 1;
export const CARD_S = 2.5;
export const TOTAL_MAX_S = 12;
export const PRE_S = 0.3;
export const POST_S = 0.1;

const fin = (x) => typeof x === 'number' && Number.isFinite(x);

/** Slow-motion factor of a source frame rate: source seconds shown per output second. */
export function slowFactor(fps) {
  if (!(fps > 0)) return 1;
  if (fps >= 200) return 0.25;
  if (fps >= 50) return 0.5;
  return 1;
}

export function buildTimeline({ fps, events = null, clipDuration_s = Infinity, flightT_s = null, ballTrack = false, card = true, outFps = OUT_FPS } = {}) {
  const dur = fin(clipDuration_s) && clipDuration_s > 0 ? clipDuration_s : Infinity;
  const clamp = (t) => Math.min(Math.max(0, t), dur);
  const addr = events?.address?.t_s;
  const imp = events?.impact?.t_s;
  let speed = slowFactor(fps);
  let t0;
  let t1;
  if (fin(addr) && fin(imp) && imp > addr) {
    t0 = clamp(addr - PRE_S);
    t1 = clamp(imp + POST_S);
  } else {
    t1 = fin(dur) ? dur : (fin(imp) ? imp + POST_S : 0);
    t0 = Math.max(0, t1 - SWING_MAX_S * speed);
  }
  const span = Math.max(0, t1 - t0);
  if (span / speed > SWING_MAX_S) speed = span / SWING_MAX_S;
  const nSwing = span > 0 ? Math.max(1, Math.round((span / speed) * outFps)) : 0;
  const holdT = t1;
  const T = fin(flightT_s) && flightT_s > 0 ? flightT_s : null;
  const flightOut = T ? Math.min(FLIGHT_MAX_S, T) : ballTrack ? TRACK_ONLY_S : 0;
  const nFlight = Math.round(flightOut * outFps);
  const nCard = card ? Math.round(CARD_S * outFps) : 0;
  const frames = [];
  let k = 0;
  for (let i = 0; i < nSwing; i++, k++) {
    frames.push({ k, seg: 'swing', t_out: k / outFps, src_t: Math.min(t1, t0 + (i / outFps) * speed), flight_t: null, card_frac: null });
  }
  // the growth ends a few frames before the segment does, so the complete trail is seen before the card
  const grow = Math.max(1, nFlight - Math.round(0.3 * outFps));
  const Tg = T ?? TRACK_ONLY_S;
  for (let i = 0; i < nFlight; i++, k++) {
    frames.push({ k, seg: 'flight', t_out: k / outFps, src_t: holdT, flight_t: Math.min(Tg, ((i + 1) / grow) * Tg), card_frac: null });
  }
  for (let i = 0; i < nCard; i++, k++) {
    frames.push({ k, seg: 'card', t_out: k / outFps, src_t: holdT, flight_t: Tg, card_frac: (i + 1) / nCard });
  }
  return {
    out_fps: outFps, frames, duration_s: frames.length / outFps,
    swing: { n: nSwing, src_t0: t0, src_t1: t1, speed },
    flight: { n: nFlight, src_t: holdT, T },
    card: { n: nCard },
  };
}

/** The distinct source times the clip needs decoded (ascending): every swing frame plus the held frame. */
export function neededSourceTimes(tl) {
  const s = new Set(tl.frames.map((f) => f.src_t));
  return [...s].sort((a, b) => a - b);
}
