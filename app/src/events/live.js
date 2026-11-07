// Live-mode swing state machine (CAFCR P4): IDLE -> ADDRESS -> SWING -> IMPACT -> FINISH, driven by 10 Hz wrist
// samples in the body plane and audio onsets. Pure: no timers, no clock; time comes from the samples.
//
//   ADDRESS  wrist speed < 0.15 m/s for >= 0.5 s
//   SWING    wrist speed > 1 m/s (from ADDRESS)
//   IMPACT   an audio onset inside the swing (closest to the wrist-speed peak, within ±0.3 s of it); without one,
//            the wrist-speed peak once the speed has dropped below half of it
//   FINISH   wrist still (< 0.15 m/s) for >= 0.7 s after impact -> emits a 'shot'
// Audio with no motion (IDLE / ADDRESS, or far from the peak) is a neighbour's shot and is ignored.
// Motion with no audio is a practice swing ('practice') unless the wrist-speed profile matches a real swing
// (peak >= 2.5 m/s, rise >= 0.45 m, backswing 0.35–2.5 s): then it is a 'swing' with impact from the wrist peak,
// low confidence and RC.AUDIO_UNAVAILABLE (no microphone) or RC.EVENTS_UNCERTAIN (microphone on, nothing heard).
//
//   createLiveDetector(opts?) -> { feed(sample) -> Event[], state(), reset() }
//   liveStep(state, sample) -> { state, events }        initialLiveState(opts?) -> state
// sample: { type: 'wrist', t_s, x_m, y_m, vis? } (x along the target line, y up, metres) | { type: 'audio', t_s }
// Event: { type: 'state', from, to, t_s } | { type: 'audio_ignored', t_s, reason }
//      | { type: 'motion_ignored', t_s, peak_mps, rise_m }   (hands rose < 0.2 m: not a swing)
//      | { type: 'shot', kind: 'swing'|'practice', t_address, t_swing, t_peak, t_impact, t_finish,
//          impact_source: 'audio'|'wrist_peak', peak_mps, rise_m, conf, reason_codes }
//      | { type: 'impact', t_impact, impact_source, t_address, t_swing, t_top, peak_mps, conf, reason_codes }
// 'impact' (0.4.0 quick read, V04-SPEC §A.3) is extra and changes nothing else (the 'shot' events are the 0.3.0 ones):
// at most one per swing, on the first wrist sample at or after an audio onset (after the top) once the hands are back
// below half their rise (the downswing; a sound in the backswing waits for it and goes stale after 0.3 s), or - with
// no onset - when the wrist speed falls below half its downswing peak and the profile is a real swing's (impact = that
// peak, conf 0.5, the shot's reason code; with a microphone only 0.3 s after that peak, when no sound came). The IMPACT state itself is not used: at 10 Hz it can trip at the top of the
// backswing. t_top = the highest wrist sample before the downswing. The 'shot' may still settle on another impact.

import { RC } from '../contract/reason-codes.js';

export const LIVE = Object.freeze({
  still_mps: 0.15,
  address_hold_s: 0.5,
  swing_mps: 1.0,
  finish_hold_s: 0.7,
  audio_peak_window_s: 0.3,
  real_peak_mps: 2.5,
  real_rise_m: 0.45,
  practice_rise_m: 0.2, // below this the motion is not a swing at all (walking, picking up a ball)
  real_backswing_min_s: 0.35,
  real_backswing_max_s: 2.5,
  swing_timeout_s: 4.0,
  address_fidget_s: 1.5,
  min_vis: 0.3,
});

export function initialLiveState(opts = {}) {
  return {
    mode: 'IDLE',
    audioAvailable: opts.audioAvailable !== false,
    hist: [], // last wrist samples [{t, x, y}]
    stillSince: null,
    fidgetSince: null,
    t_address: null,
    y_address: null,
    t_swing: null,
    peak: 0,
    t_peak: null,
    maxY: -Infinity,
    t_impact: null,
    impact_source: null,
    audioCands: [],
    holdSince: null,
    t_top: null,
    qTopY: -Infinity,
    qDown: false, // hands back below half their rise after the top: the downswing
    qPk: 0,
    qTpk: null,
    qSent: false,
    qAud: [], // onsets of this swing not yet judged for the 'impact' event
  };
}

function speedOf(hist, lag) {
  const n = hist.length;
  if (n <= lag) return null;
  const a = hist[n - 1 - lag];
  const b = hist[n - 1];
  const dt = b.t - a.t;
  if (!(dt > 0)) return null;
  return Math.hypot(b.x - a.x, b.y - a.y) / dt;
}

function resetSwing(s) {
  s.t_swing = null; s.peak = 0; s.t_peak = null; s.maxY = -Infinity; s.t_impact = null; s.impact_source = null;
  s.audioCands = []; s.holdSince = null; s.t_top = null; s.qTopY = -Infinity; s.qDown = false; s.qPk = 0; s.qTpk = null; s.qSent = false; s.qAud = [];
}

function realProfile(s, rise, peak = s.peak, tPeak = s.t_peak) {
  const back = tPeak - s.t_swing;
  return peak >= LIVE.real_peak_mps && rise >= LIVE.real_rise_m && back >= LIVE.real_backswing_min_s && back <= LIVE.real_backswing_max_s;
}

/** The 'impact' event bookkeeping of one wrist sample in SWING / IMPACT (does not touch the 0.3.0 state). */
function qStep(s, t, y, v1, tMid, events) {
  if (s.qSent) return;
  if (!s.qDown) {
    if (y > s.qTopY) { s.qTopY = y; s.t_top = t; }
    if (s.t_top !== null && t > s.t_top && y <= s.y_address + 0.5 * (s.qTopY - s.y_address)) s.qDown = true;
  }
  if (s.qDown) {
    if (v1 > s.qPk) { s.qPk = v1; s.qTpk = tMid; }
    const ta = s.qAud.find((a) => a > s.t_top);
    if (ta !== undefined) { qEvent(s, ta, 'audio', events); return; }
    // with a microphone the impact sound may still come (down the line the hands slow before impact): wait 0.3 s
    if (s.qPk > LIVE.swing_mps && v1 < 0.5 * s.qPk && (!s.audioAvailable || t - s.qTpk > LIVE.audio_peak_window_s) && realProfile(s, s.qTopY - s.y_address, s.qPk, s.qTpk)) {
      qEvent(s, s.qTpk, 'wrist_peak', events);
      return;
    }
  }
  s.qAud = s.qAud.filter((a) => a > t - LIVE.audio_peak_window_s);
}

function qEvent(s, t, src, events) {
  s.qSent = true;
  s.qAud = [];
  const audio = src === 'audio';
  events.push({
    type: 'impact', t_impact: t, impact_source: src, t_address: s.t_address, t_swing: s.t_swing, t_top: s.t_top,
    peak_mps: s.peak, conf: audio ? 0.9 : 0.5, reason_codes: audio ? [] : [s.audioAvailable ? RC.EVENTS_UNCERTAIN : RC.AUDIO_UNAVAILABLE],
  });
}

function go(s, to, t, events) {
  events.push({ type: 'state', from: s.mode, to, t_s: t });
  s.mode = to;
}

function bestAudio(s) {
  if (s.t_peak === null) return null;
  let best = null;
  for (const a of s.audioCands) {
    const d = Math.abs(a - s.t_peak);
    if (d <= LIVE.audio_peak_window_s && (best === null || d < Math.abs(best - s.t_peak))) best = a;
  }
  return best;
}

function finishShot(s, t_finish, events) {
  const audio = bestAudio(s);
  for (const a of s.audioCands) if (a !== audio) events.push({ type: 'audio_ignored', t_s: a, reason: 'not_at_wrist_peak' });
  const rise = s.maxY - s.y_address;
  let kind;
  let codes = [];
  let conf;
  let tImp;
  let src;
  if (audio !== null) {
    kind = 'swing'; tImp = audio; src = 'audio'; conf = 0.9;
  } else if (realProfile(s, rise)) {
    kind = 'swing'; tImp = s.t_peak; src = 'wrist_peak'; conf = 0.5;
    codes = [s.audioAvailable ? RC.EVENTS_UNCERTAIN : RC.AUDIO_UNAVAILABLE];
  } else if (rise >= LIVE.practice_rise_m) {
    kind = 'practice'; tImp = s.t_peak; src = 'wrist_peak'; conf = 0.3;
  } else {
    events.push({ type: 'motion_ignored', t_s: s.t_swing, peak_mps: s.peak, rise_m: rise });
    return;
  }
  if (t_finish === null) { conf = Math.min(conf, 0.4); if (!codes.includes(RC.EVENTS_UNCERTAIN)) codes.push(RC.EVENTS_UNCERTAIN); }
  events.push({
    type: 'shot', kind, t_address: s.t_address, t_swing: s.t_swing, t_peak: s.t_peak, t_impact: tImp,
    t_finish, impact_source: src, peak_mps: s.peak, rise_m: rise, conf, reason_codes: codes,
  });
}

/** One step of the state machine. Returns { state, events } (state is the same object, mutated). */
export function liveStep(s, sample) {
  const events = [];
  if (sample.type === 'audio') {
    if (s.mode === 'SWING' || s.mode === 'IMPACT') { s.audioCands.push(sample.t_s); if (!s.qSent) s.qAud.push(sample.t_s); }
    else events.push({ type: 'audio_ignored', t_s: sample.t_s, reason: 'no_motion' });
    return { state: s, events };
  }
  if (sample.type !== 'wrist') return { state: s, events };
  if (typeof sample.vis === 'number' && sample.vis < LIVE.min_vis) return { state: s, events };
  const t = sample.t_s;
  s.hist.push({ t, x: sample.x_m, y: sample.y_m });
  if (s.hist.length > 8) s.hist.shift();
  const v1 = speedOf(s.hist, 1); // 0.1 s baseline: responsive
  const v2 = speedOf(s.hist, 2); // 0.2 s baseline: quiet, for stillness
  if (v1 === null) return { state: s, events };
  const still = v2 !== null && v2 < LIVE.still_mps;
  const tMid = (s.hist[s.hist.length - 1].t + s.hist[s.hist.length - 2].t) / 2;

  switch (s.mode) {
    case 'IDLE': {
      if (still) {
        if (s.stillSince === null) s.stillSince = s.hist[Math.max(0, s.hist.length - 3)].t;
        if (t - s.stillSince >= LIVE.address_hold_s) {
          s.t_address = t; s.y_address = sample.y_m; s.fidgetSince = null;
          go(s, 'ADDRESS', t, events);
        }
      } else s.stillSince = null;
      break;
    }
    case 'ADDRESS': {
      if (v1 > LIVE.swing_mps) {
        resetSwing(s);
        s.t_swing = s.hist[s.hist.length - 2].t;
        s.peak = v1; s.t_peak = tMid; s.maxY = sample.y_m;
        go(s, 'SWING', t, events);
      } else if (still) {
        s.t_address = t; s.y_address = sample.y_m; s.fidgetSince = null;
      } else {
        if (s.fidgetSince === null) s.fidgetSince = t;
        if (t - s.fidgetSince > LIVE.address_fidget_s) { s.stillSince = null; go(s, 'IDLE', t, events); }
      }
      break;
    }
    case 'SWING':
    case 'IMPACT': {
      if (v1 > s.peak) { s.peak = v1; s.t_peak = tMid; }
      if (sample.y_m > s.maxY) s.maxY = sample.y_m;
      qStep(s, t, sample.y_m, v1, tMid, events);
      if (s.mode === 'SWING' && s.peak > LIVE.swing_mps && v1 < 0.5 * s.peak) {
        s.t_impact = s.t_peak;
        go(s, 'IMPACT', t, events);
      }
      if (s.mode === 'IMPACT') {
        if (still) {
          if (s.holdSince === null) s.holdSince = s.hist[Math.max(0, s.hist.length - 3)].t;
          if (t - s.holdSince >= LIVE.finish_hold_s) {
            go(s, 'FINISH', t, events);
            finishShot(s, s.holdSince, events);
            s.stillSince = t; s.mode = 'IDLE';
            events.push({ type: 'state', from: 'FINISH', to: 'IDLE', t_s: t });
            resetSwing(s);
          }
        } else s.holdSince = null;
      }
      if (s.t_swing !== null && t - s.t_swing > LIVE.swing_timeout_s && s.mode !== 'IDLE') {
        if (s.mode === 'IMPACT') finishShot(s, null, events);
        go(s, 'IDLE', t, events);
        resetSwing(s);
        s.stillSince = null;
      }
      break;
    }
    default:
      break;
  }
  return { state: s, events };
}

export function createLiveDetector(opts = {}) {
  let s = initialLiveState(opts);
  return {
    feed(sample) { return liveStep(s, sample).events; },
    state() { return s.mode; },
    reset() { s = initialLiveState(opts); },
  };
}
