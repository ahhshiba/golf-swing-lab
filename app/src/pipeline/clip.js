// pipeline/clip.js - one clip -> golf-shot/1 (CAFCR P5; also the live per-swing segment of P4). Runs in the worker.
//
//   analyzeClip(file, options, deps?) -> Promise<{ shot, timings_ms, debug, poseSeq, events, events_source, probe,
//                                                  time_scale, reasons }>
//   options = { view, calibration, club, handedness = 'right', venue, ids: { shot_id, session_id, venue_id, preset_id,
//               created_at, app_version, ... }, mode = 'highspeed'|'live', source = 'import'|'camera', orientation?,
//               clip_ref = null, trim_s?: [from, to], pose_hz = 60, pose_model = 'full', pose_roi?, ball_roi?,
//               restBall?: { u, v, w_px }, impact_pre = 30, impact_post = 60, audioOnset_t?, warnings = [], seed = 1,
//               use_tcn = true (false: rules only even when deps.tcn is given), research_model = false }
//   No swing found (too few pose frames, no impact event, detection error) -> WorkerError NO_SWING_FOUND: a clip
//   without a swing never becomes a shot (PRODUCT-SPEC UX-08; options.allowNoSwing is ignored).
//   calibration null -> placeholderCalibration() + NO_CALIBRATION, ball/club rows nulled (uncalibrated())
//   Slow motion with the speed baked in (EV-3): events/timescale.js picks a time scale k (1, 4, 8); with k > 1 the
//   shot carries SLOWMO_CORRECTED, capture.{nominal,effective}_fps are the real rates (container × k) and every
//   metric is computed in real time; event t_s stay in clip (media) seconds so replay seeks the right frame.
//   deps (dependency injection; the worker passes the browser ones, Node tests pass fakes) = {
//     probe(file) -> Probe,  decode(file, { onFrame, from_s, to_s, hz, signal, probe }) -> result,
//     pose(frame, t_s, { rotation, roi }) -> { img: Float32Array(132), world: Float32Array(99) } (full-frame normalised),
//     newPoseSequence?(), toGray(frame, { rotation, roi }) -> { data, W, H, origin: {u, v} },
//     detect?(poseSeq, opts) -> EventSet (default events/detect.js), assembleShot?(args) (default ./assemble.js),
//     tcn?: { predict(features), meta } (events/tcn.js loadTcn of an owner-imported model; used only when its model
//           card passes events/card.js tcnRejection) - see detectWithTcn,
//     onProgress?(stage, frac), signal?, now?() -> ms }
//   captureFromProbe(probe, options) -> capture{}      orientationFromProbe(probe)
//   ballRoiFor(W, H, options) -> {x,y,w,h}  (ball_roi, else frames.js suggestBallRoi around restBall / projected spot)
//
// Steps: probe -> pass 1 pose on a pose_hz grid (subsampled decode) -> events -> pass 2 full-rate decode of the
// impact window (impact - impact_pre .. impact + impact_post frames) -> grayscale ROI frames -> assembleShot.
// Progress stages: 'probe', 'pose', 'events', 'impact', 'assemble' (frac 0..1 each).

import { detect as detectEvents } from '../events/detect.js';
import { detectTimeScaled, scalePoseTime } from '../events/timescale.js';
import { tcnRejection } from '../events/card.js';
import { RC } from '../contract/reason-codes.js';
import { impactWindow } from '../import/timebase.js';
import { createPoseSeqBuilder } from '../pose/convert.js';
import { WorkerError, ERR } from '../workers/protocol.js';
import { project } from '../geom/camera.js';
import { suggestBallRoi } from './frames.js';
import { diagRecord } from '../workers/diag.js';
import { nominalCamera } from '../geom/camera.js';
import { nominalF } from '../calib/pnp.js';
import { makeCalibration } from '../calib/report.js';
import { BALL_CLUB_IDS, METRIC_UNITS } from '../contract/enums.js';
import { metricNull } from '../contract/metric.js';
import { attributeWarnings } from '../contract/shot.js';
import { validateShot } from '../contract/validate.js';
import { REGISTRY } from '../metrics/registry.js';

/** Pose sigmas of the placeholder calibration: deliberately wide (nothing is measured). */
const PLACEHOLDER_SIGMA = Object.freeze({ yaw_deg: 5, pitch_deg: 2, roll_deg: 2, X_m: 0.3, Y_m: 0.3, h_m: 0.1, D_m: 0.3 });

/**
 * Placeholder calibration for a clip analysed without one (import without a mat calibration, live without lock). The shot
 * contract and assembleShot require a Calibration; this one is the nominal C2 camera for the view and is never used
 * for numbers: ball/club rows are nulled with NO_CALIBRATION afterwards (see uncalibrated()).
 */
export function placeholderCalibration(view, W, H) {
  const cam = nominalCamera(view, { W, H, f: nominalF(W, H) });
  return makeCalibration({ method: 'ball_only', source: 'clip', cam, view, f_locked: false, sigma: PLACEHOLDER_SIGMA, readout_source: 'assumed' });
}

/** Ball / club rows of an uncalibrated shot -> honest nulls (NO_CALIBRATION); registry nulls are kept. */
export function uncalibrated(shot) {
  if (!shot || !shot.metrics || !shot.quality) return shot; // not a golf-shot/1 (injected assemble in tests)
  const metrics = { ...shot.metrics };
  for (const id of BALL_CLUB_IDS) {
    const m = metrics[id];
    if (!m) continue;
    const registryNull = m.value === null && (m.validity === 'not_observable' || m.reason_codes.includes(RC.NOT_IMPLEMENTED));
    if (!registryNull) metrics[id] = metricNull('not_computed', [RC.NO_CALIBRATION], METRIC_UNITS[id], REGISTRY[id]?.value_origin ?? 'derived');
  }
  const out = attributeWarnings({ ...shot, metrics });
  validateShot(out);
  return out;
}

let assembleMod = null;
async function defaultAssemble(args) {
  if (!assembleMod) assembleMod = import('./assemble.js');
  const m = await assembleMod;
  return m.assembleShot(args);
}

export function orientationFromProbe(probe) {
  if (!probe || !(probe.width > 0)) return 'unknown';
  const W = probe.display_width ?? probe.width;
  const H = probe.display_height ?? probe.height;
  switch (probe.rotation) {
    case 90: return 'portrait-primary';
    case 270: return 'portrait-secondary';
    case 180: return W >= H ? 'landscape-secondary' : 'portrait-secondary';
    default: return W >= H ? 'landscape-primary' : 'portrait-primary';
  }
}

export function captureFromProbe(probe, o = {}) {
  const ts = probe.cts_s || [];
  const trim = Array.isArray(o.trim_s) && o.trim_s.length === 2 ? o.trim_s : null;
  return {
    mode: o.mode ?? 'highspeed',
    view: o.view,
    source: o.source ?? (o.mode === 'live' ? 'camera' : 'import'),
    orientation: o.orientation ?? orientationFromProbe(probe),
    width: probe.display_width ?? probe.width,
    height: probe.display_height ?? probe.height,
    nominal_fps: probe.nominal_fps,
    effective_fps: probe.effective_fps,
    vfr: !!probe.vfr,
    timestamps: probe.timestamps,
    clip_ref: o.clip_ref ?? null,
    trim_s: trim ?? (ts.length > 1 ? [Math.max(0, ts[0]), Math.max(0, ts[ts.length - 1])] : null),
  };
}

/** Ball ROI in display pixels: suggestBallRoi around the rest ball (given, or the projected ball spot). */
export function ballRoiFor(W, H, options = {}) {
  if (options.ball_roi) return options.ball_roi;
  const cam = options.calibration && options.calibration.camera;
  let rest = options.restBall && Number.isFinite(options.restBall.u) ? options.restBall : null;
  let dir = options.ball_dir ?? null;
  if (cam && cam.W === W && cam.H === H) {
    try {
      const p0 = project(cam, [0, 0, 0]);
      const p1 = project(cam, [1, 0, 0.3]);
      if (!rest && p0.z > 0) rest = { u: p0.u, v: p0.v, w_px: 0 };
      if (!dir && p0.z > 0 && p1.z > 0) dir = [p1.u - p0.u, p1.v - p0.v];
    } catch { /* fall through */ }
  }
  if (rest && rest.u >= 0 && rest.u <= W && rest.v >= 0 && rest.v <= H) {
    const r = suggestBallRoi({ W, H, rest, dir: dir ?? [1, 0] });
    if (r) return r;
  }
  return defaultBallRoi(W, H, rest);
}

export function defaultBallRoi(W, H, restBall) {
  if (restBall && Number.isFinite(restBall.u) && Number.isFinite(restBall.v)) {
    const w = Math.round(Math.min(W, Math.max(256, 0.6 * W)));
    const h = Math.round(Math.min(H, Math.max(192, 0.5 * H)));
    const x = Math.round(Math.min(W - w, Math.max(0, restBall.u - 0.35 * w)));
    const y = Math.round(Math.min(H - h, Math.max(0, restBall.v - 0.6 * h)));
    return { x, y, w, h };
  }
  return { x: 0, y: Math.round(H / 2), w: W, h: H - Math.round(H / 2) };
}

/** TCN guards: a person must be visible (vis_mean >= 0.5) in this share of the pose frames, and the ordered decode's
 * impact probability must reach TCN_MIN_IMPACT_P; otherwise the rules decide (a clip with no golfer stays "no swing"). */
export const TCN_MIN_VISIBLE = 0.5;
export const TCN_MIN_IMPACT_P = 0.2;
const VIS_SET = [11, 12, 13, 14, 15, 16, 23, 24];

/** Share of pose frames whose mean visibility of the evfeat-1 landmark set is >= 0.5. */
export function visibleShare(poseSeq) {
  const T = poseSeq && poseSeq.t_s ? poseSeq.t_s.length : 0;
  if (!T) return 0;
  let n = 0;
  for (let t = 0; t < T; t++) {
    let s = 0;
    for (const j of VIS_SET) { const v = poseSeq.img[t * 132 + 4 * j + 3]; s += Number.isFinite(v) ? v : 0; }
    if (s / VIS_SET.length >= 0.5) n += 1;
  }
  return n / T;
}

/**
 * Event detection (PRODUCT-SPEC §7.1): the rules, with the slow-motion time-scale search (events/timescale.js); an
 * owner-imported TCN replaces them only when its model card passed the owner-set holdout gate and covers the view
 * (events/card.js; ctx.research = a research build's bundled model), a golfer is visible and the TCN's impact is
 * confident; on any TCN failure the rules decide. -> { events, source: 'tcn'|'rules', fallback?, error?, time_scale }
 * ctx = { container_fps, duration_s, captureFpsHint, research }. Event times are in media seconds.
 * The source ends up in shot.events.*.source and shot.algorithms.events (assemble.js: 'tcn+evfeat-1' vs rules).
 */
export function detectWithTcn(detect, poseSeq, opts, tcn, ctx = {}) {
  let k = 1;
  const rules = (fallback) => {
    try {
      const events = detectTimeScaled(poseSeq, opts, { ...ctx, detect });
      k = events?.meta?.time_scale ?? 1;
      return { events, source: 'rules', fallback, time_scale: k };
    } catch (e) {
      return { events: null, source: 'rules', fallback, error: e && e.message ? e.message : String(e), time_scale: 1 };
    }
  };
  const base = rules(undefined);
  if (!tcn || typeof tcn.predict !== 'function') return base;
  const rej = tcnRejection(tcn.meta, opts.view, { research: ctx.research === true });
  if (rej) return { ...base, fallback: rej };
  if (visibleShare(poseSeq) < TCN_MIN_VISIBLE) return { ...base, fallback: 'tcn_low_visibility' };
  let ev;
  const scaled = scalePoseTime(poseSeq, k);
  try {
    ev = detect(scaled, { ...opts, audioOnset_t: Number.isFinite(opts.audioOnset_t) ? opts.audioOnset_t / k : opts.audioOnset_t, useTcn: true, tcn });
  } catch (e) {
    return { ...base, fallback: `tcn_error: ${e && e.message ? e.message : e}` };
  }
  if (!ev || !ev.impact || ev.impact.source !== 'tcn') return { ...base, fallback: (ev && ev.fallback) || 'tcn_not_used' };
  if (!(ev.impact.conf >= TCN_MIN_IMPACT_P) && ev.impact.conf !== 0.95) return { ...base, fallback: 'tcn_low_impact_p' };
  if (k !== 1) for (const name of Object.keys(ev)) if (ev[name] && Number.isFinite(ev[name].t_s)) ev[name] = { ...ev[name], t_s: ev[name].t_s * k };
  Object.defineProperty(ev, 'meta', { value: { ...(base.events?.meta ?? {}), time_scale: k }, enumerable: false });
  return { events: ev, source: 'tcn', time_scale: k };
}

function checkAbort(signal) {
  if (signal && signal.aborted) throw new WorkerError(ERR.CANCELLED);
}

export async function analyzeClip(file, options = {}, deps = {}) {
  const now = deps.now ?? (() => (globalThis.performance ? globalThis.performance.now() : Date.now()));
  const progress = typeof deps.onProgress === 'function' ? deps.onProgress : () => {};
  const signal = deps.signal;
  const detect = deps.detect ?? detectEvents;
  const assemble = deps.assembleShot ?? defaultAssemble;
  const view = options.view;
  const handedness = options.handedness ?? 'right';
  const timings = { probe: 0, pose: 0, events: 0, impact_decode: 0, assemble: 0, total: 0, pose_frames: 0, impact_frames: 0 };
  const T0 = now();
  const warnings = Array.isArray(options.warnings) ? options.warnings.slice() : [];
  const addWarn = (c) => { if (c && !warnings.includes(c)) warnings.push(c); };
  const calibrated = Boolean(options.calibration && options.calibration.camera);
  // no mat calibration at all -> NO_CALIBRATION (a calibration object without a camera only nulls the rows below)
  if (!options.calibration) addWarn(RC.NO_CALIBRATION);

  // 1. probe
  progress('probe', 0);
  let t = now();
  const probe = await deps.probe(file);
  timings.probe = now() - t;
  for (const c of probe.reason_codes || []) addWarn(c);
  progress('probe', 1);
  checkAbort(signal);
  const W = probe.display_width ?? probe.width;
  const H = probe.display_height ?? probe.height;
  const rotation = probe.rotation || 0;
  const cts = probe.cts_s || [];
  const from_s = Array.isArray(options.trim_s) ? options.trim_s[0] : -Infinity;
  const to_s = Array.isArray(options.trim_s) ? options.trim_s[1] : Infinity;

  // 2. pose pass on a pose_hz grid
  const poseHz = options.pose_hz ?? 60;
  const model = options.pose_model ?? 'full';
  const builder = createPoseSeqBuilder({ W, H, model });
  const span = cts.length > 1 ? Math.min(to_s, cts[cts.length - 1]) - Math.max(from_s, cts[0]) : 0;
  const expected = Math.max(1, Math.round(span * poseHz) + 1);
  if (typeof deps.newPoseSequence === 'function') deps.newPoseSequence();
  t = now();
  progress('pose', 0);
  const decPose = await deps.decode(file, {
    probe, from_s, to_s, hz: poseHz, signal, purpose: 'pose', roi: options.pose_roi ?? null,
    onFrame: async (frame, t_s) => {
      checkAbort(signal);
      const row = await deps.pose(frame, t_s, { rotation, roi: options.pose_roi ?? null });
      builder.push(t_s, row);
      timings.pose_frames += 1;
      if (timings.pose_frames % 4 === 0) progress('pose', Math.min(1, timings.pose_frames / expected));
    },
  });
  timings.pose = now() - t;
  for (const c of (decPose && decPose.reason_codes) || []) addWarn(c);
  progress('pose', 1);
  checkAbort(signal);
  // No golfer / no swing found (too few pose frames, no impact event, detection failed): NO_SWING_FOUND, never a shot
  // of nulls (PRODUCT-SPEC UX-08).
  const noSwing = (why) => {
    diagRecord('import.last.no_swing', why);
    throw new WorkerError(ERR.NO_SWING_FOUND, why);
  };
  const poseSeq = builder.size() > 0 ? builder.build() : null;
  if (builder.size() < 8) noSwing(`only ${builder.size()} pose frames`);

  // 3. events
  t = now();
  progress('events', 0);
  let events = null;
  let eventsSource = null;
  let timeScale = 1;
  if (poseSeq && builder.size() >= 8) {
    const ctx = {
      container_fps: probe.nominal_fps > 0 ? probe.nominal_fps : probe.effective_fps,
      duration_s: cts.length > 1 ? cts[cts.length - 1] - cts[0] : undefined,
      captureFpsHint: Number.isFinite(probe.captureFpsHint) ? probe.captureFpsHint : null,
      research: options.research_model === true,
    };
    const ev = detectWithTcn(detect, poseSeq, { view, handedness, audioOnset_t: options.audioOnset_t }, options.use_tcn === false ? null : deps.tcn, ctx);
    events = ev.events;
    timeScale = ev.time_scale ?? 1;
    eventsSource = ev.fallback ? `${ev.source} (${ev.fallback})` : ev.source;
    diagRecord('import.last.events_source', eventsSource);
    if (ev.error) noSwing(`event detection failed: ${ev.error}`);
    if (events && (!events.impact || !Number.isFinite(events.impact.t_s))) { events = null; noSwing('no impact event'); }
  }
  timings.events = now() - t;
  progress('events', 1);

  // 4. impact window at full rate -> grayscale ROI frames
  checkAbort(signal);
  const fps = probe.effective_fps > 0 ? probe.effective_fps : probe.nominal_fps;
  const tMin = cts.length ? Math.max(cts[0], from_s) : undefined;
  const tMax = cts.length ? Math.min(cts[cts.length - 1], to_s) : undefined;
  let win = null;
  if (events) win = impactWindow(events.impact.t_s, fps, { pre: options.impact_pre ?? 30, post: options.impact_post ?? 60, t_min: tMin, t_max: tMax });
  const restBall = options.restBall ?? null;
  const ballRoi = ballRoiFor(W, H, options);
  const frames = [];
  const times = [];
  const indices = [];
  let gW = 0, gH = 0, origin = { u: 0, v: 0 };
  const expectedImpact = win ? Math.max(1, Math.round((win.to_s - win.from_s) * fps) + 1) : 1;
  t = now();
  progress('impact', 0);
  const decImpact = !win ? null : await deps.decode(file, {
    probe, from_s: win.from_s, to_s: win.to_s, hz: 0, signal, purpose: 'impact', roi: ballRoi,
    onFrame: async (frame, t_s, index) => {
      checkAbort(signal);
      const g = await deps.toGray(frame, { rotation, roi: ballRoi });
      gW = g.W; gH = g.H; origin = g.origin;
      frames.push(g.data);
      times.push(t_s);
      indices.push(index);
      timings.impact_frames += 1;
      if (timings.impact_frames % 8 === 0) progress('impact', Math.min(1, timings.impact_frames / expectedImpact));
    },
  });
  timings.impact_decode = now() - t;
  for (const c of (decImpact && decImpact.reason_codes) || []) addWarn(c);
  progress('impact', 1);
  checkAbort(signal);
  const ballFrames = frames.length
    ? { frames, times, W: gW, H: gH, origin, roi: null, indices, from_s: win.from_s, to_s: win.to_s, full_W: W, full_H: H, fps }
    : null;
  if (!ballFrames && calibrated) addWarn(RC.TRACK_TOO_SHORT);

  // 5. assemble (in real time: a slow-motion clip's time line is divided by the time scale k, then the shot's event
  //    times are mapped back to the clip's media time for replay)
  t = now();
  progress('assemble', 0);
  const k = timeScale;
  if (k !== 1) addWarn(RC.SLOWMO_CORRECTED);
  let capture = captureFromProbe(probe, options);
  // container CTS of the whole clip let assembleShot re-index event frames into the clip (frames.js nearestFrame)
  if (probe.timestamps === 'container' && Array.isArray(probe.cts_s) && probe.cts_s.length) capture.timestamps = probe.cts_s;
  const real = (x) => (Number.isFinite(x) ? x / k : x);
  if (k !== 1) {
    capture = {
      ...capture, nominal_fps: capture.nominal_fps * k, effective_fps: capture.effective_fps * k,
      timestamps: Array.isArray(capture.timestamps) ? capture.timestamps.map(real) : capture.timestamps,
      trim_s: Array.isArray(capture.trim_s) ? capture.trim_s.map(real) : capture.trim_s,
    };
  }
  const evReal = events && k !== 1
    ? Object.fromEntries(Object.entries(events).map(([n, e]) => [n, e && Number.isFinite(e.t_s) ? { ...e, t_s: e.t_s / k } : e]))
    : events;
  const bfReal = ballFrames && k !== 1
    ? { ...ballFrames, times: ballFrames.times.map(real), from_s: real(ballFrames.from_s), to_s: real(ballFrames.to_s), fps: ballFrames.fps * k }
    : ballFrames;
  let out;
  try {
    out = await assemble({
      capture, calibration: calibrated ? options.calibration : placeholderCalibration(view, W, H), venue: options.venue,
      club: options.club, handedness, poseSeq: k !== 1 && poseSeq ? scalePoseTime(poseSeq, k) : poseSeq,
      events: evReal ?? {}, // {} = not detected: placeholder events, no re-detect
      ballFrames: bfReal, restBall, audioOnset_t: real(options.audioOnset_t), ids: options.ids ?? {}, warnings, seed: options.seed ?? 1,
    });
  } catch (e) {
    if (e && e.code === ERR.CANCELLED) throw e;
    const err = new WorkerError(ERR.ASSEMBLE_FAILED, `assembleShot: ${e && e.message ? e.message : e}`);
    err.cause = e;
    throw err;
  }
  if (!calibrated) out = { ...out, shot: uncalibrated(out.shot) };
  if (k !== 1) out = { ...out, shot: toMediaTime(out.shot, k) };
  timings.assemble = now() - t;
  progress('assemble', 1);
  timings.total = now() - T0;
  // import.last.decoded = frames the decoder delivered in a full pass (R6 M2: decoded == sample_count). The pose pass
  // decodes every sample in [from_s, to_s] (and emits the pose_hz subset), so it is a full pass when the clip is untrimmed.
  const fullPass = !Array.isArray(options.trim_s) && decPose && Number.isFinite(decPose.decoded);
  if (fullPass) diagRecord('import.last.decoded', decPose.decoded);
  diagRecord('import.last.analysed_frames', timings.pose_frames + timings.impact_frames);
  diagRecord('import.last.timings_ms', { probe: timings.probe, pose: timings.pose, impact: timings.impact_decode, assemble: timings.assemble, total: timings.total });
  return {
    shot: out.shot,
    timings_ms: { ...timings, assemble_detail: out.timings_ms ?? null },
    debug: out.debug ?? null,
    poseSeq,
    events,
    events_source: eventsSource,
    probe,
    time_scale: k,
    reasons: out.shot?.quality?.warnings ? [...new Set([...out.shot.quality.warnings, ...warnings])] : warnings.slice(),
  };
}

/** A shot assembled in real time -> event times and the trim span back in the clip's media time (× k). */
export function toMediaTime(shot, k) {
  if (!shot || k === 1) return shot;
  const out = { ...shot };
  if (shot.events && typeof shot.events === 'object') {
    out.events = Object.fromEntries(Object.entries(shot.events).map(([n, e]) => [n, e && Number.isFinite(e.t_s) ? { ...e, t_s: e.t_s * k } : e]));
  }
  if (shot.capture && Array.isArray(shot.capture.trim_s)) out.capture = { ...shot.capture, trim_s: shot.capture.trim_s.map((x) => x * k) };
  if (shot.metrics && shot.quality) validateShot(out);
  return out;
}
