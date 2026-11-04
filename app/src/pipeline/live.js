// pipeline/live.js - P4 live loop: 10 Hz lite pose -> events/live.js state machine -> per-swing segment analysis.
//
//   createLiveLoop({ pose(bitmap, t_s, model, { crop }) -> Promise<{ img, world }>,
//                    recorder: { cut() -> Promise<Blob> }, analyzeSegment(blob, options) -> Promise<{ shot, timings_ms }>,
//                    clipOptions (analyzeClip options: view, calibration, club, handedness, venue, ids, ...),
//                    calibration?, handedness = 'right', audioAvailable = true, mediaClock?() -> t_media_s,
//                    setFps?(hz), frameStats?() -> { dropped_pct }, thermal? ({ push(sample) -> decision }),
//                    analyzePractice = false, idle_hz = 10, swing_hz = 30, impact_min_db = 20, now?() -> ms, newIds?() -> ids,
//                    onShot?(r), onEvent?(ev), onError?(e), onDegrade?(decision), onStopLive?(decision) })
//     -> { handleFrame(bitmap, t_media_s, meta) -> Promise, handleOnset(t_media_s, level_db?) (< impact_min_db dropped; buffered until a frame at or
//          after t_media_s has its pose, so the detector sees media-time order), touch(), stats(), state(),
//          degrade(decision?), idle() -> Promise (all queued analyses done) }
//   wristSample(img, world, { calibration?, handedness }) -> { type: 'wrist', t_s?, x_m, y_m, vis } | null   (pure)
//   percentile95(xs) -> number                                                                              (pure)
//
// Times: frame-tap media time (t_media_s) for wrist samples and audio onsets alike. The recorder segment Blob carries
// t_media_start_s; event times are mapped into segment time by subtracting it (offset between the recorder and the
// <video> clock is UNVERIFIED on iOS). Segments are cut on entering ADDRESS (discarded, so the next one starts near
// the address) and on each detected swing (analysed). touches stays 0 unless the UI calls touch() (KD7).
// Latency = (media now - t_finish at detection) + (analysis done - detection), per shot; p95 over the session.
// P18: every shot pushes { latency_s, dropped_frac } into the thermal guard; 'degrade' -> pose_model lite, sampling
// halved, RC.THERMAL_DEGRADED on later shots; 'stop_live' -> onStopLive (UI suggests high-speed mode).
// Diag logs (bounded, last LOG_MAX): live.shot_log = [{ kind, t_impact, t_peak, t_finish, impact_source }] per detected
// shot and live.onset_log = [[t_media_s, level_db]] per impact-candidate onset (media time, as fed to the detector), so
// the e2e gate m5 can match detections to the fixture's truth by impact time.

import { createLiveDetector } from '../events/live.js';
import { RC } from '../contract/reason-codes.js';
import { createThermalGuard } from '../session/thermal.js';
import { diagRecord } from '../workers/diag.js';

const LOG_MAX = 64;
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
const L_WRIST = 15;
const R_WRIST = 16;

export function percentile95(xs) {
  const a = xs.filter(Number.isFinite).sort((p, q) => p - q);
  if (!a.length) return NaN;
  const r = 0.95 * (a.length - 1);
  const lo = Math.floor(r);
  const hi = Math.ceil(r);
  return a[lo] + (a[hi] - a[lo]) * (r - lo);
}

export function wristSample(img, world, opts = {}) {
  const cam = opts.calibration && opts.calibration.camera;
  const vis = Math.min(img[4 * L_WRIST + 3], img[4 * R_WRIST + 3]);
  if (cam && cam.f > 0) {
    const u = 0.5 * (img[4 * L_WRIST] + img[4 * R_WRIST]) * cam.W;
    const v = 0.5 * (img[4 * L_WRIST + 1] + img[4 * R_WRIST + 1]) * cam.H;
    if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
    // metres per pixel at the golfer's distance (ball-spot distance D_m as the body-plane depth)
    const D = opts.calibration.pose && opts.calibration.pose.D_m > 0 ? opts.calibration.pose.D_m : 2.7;
    const s = D / cam.f;
    return { type: 'wrist', x_m: (u - cam.cx) * s, y_m: -(v - cam.cy) * s, vis: Number.isFinite(vis) ? vis : 0 };
  }
  if (world) {
    const x = 0.5 * (world[3 * L_WRIST] + world[3 * R_WRIST]);
    const y = 0.5 * (world[3 * L_WRIST + 1] + world[3 * R_WRIST + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { type: 'wrist', x_m: x, y_m: -y, vis: Number.isFinite(vis) ? vis : 0 }; // MediaPipe world y points down
  }
  return null;
}

export function createLiveLoop(o) {
  const now = o.now ?? (() => (globalThis.performance ? globalThis.performance.now() : Date.now()));
  const mediaClock = o.mediaClock ?? (() => null);
  const thermal = o.thermal ?? createThermalGuard({ model: o.clipOptions?.pose_model ?? 'full' });
  const det = createLiveDetector({ audioAvailable: o.audioAvailable !== false });
  const handedness = o.handedness ?? o.clipOptions?.handedness ?? 'right';
  const calibration = o.calibration ?? o.clipOptions?.calibration ?? null;
  let idleHz = o.idle_hz ?? 10;
  const impactMinDb = o.impact_min_db ?? 20;
  let swingHz = o.swing_hz ?? 30;
  let poseModel = o.clipOptions?.pose_model ?? 'full';
  let poseHz = o.clipOptions?.pose_hz ?? 60;
  let degraded = false;
  let lastCutAt = -Infinity;
  let queue = Promise.resolve();
  const st = { soft_onsets: 0, frames: 0, wrist: 0, detections: 0, shots: 0, practice: 0, analysed: 0, failed: 0, touches: 0, latencies: [] };

  // Audio onsets arrive in real time, wrist samples only after the frame tap + pose round trip (100-300 ms later), but
  // events/live.js needs its samples in media-time order: an impact click fed before the downswing frames is ignored
  // as "no motion". Onsets wait here until a frame at or after their time has been seen, then go in first.
  const pendingAudio = [];
  const shotLog = [];
  const onsetLog = [];
  const pushLog = (arr, x, path) => { arr.push(x); if (arr.length > LOG_MAX) arr.shift(); diagRecord(path, arr.slice()); };
  let lastFrameT = -Infinity;
  const flushAudio = (upTo) => {
    while (pendingAudio.length && pendingAudio[0] <= upTo) onEvents(det.feed({ type: 'audio', t_s: pendingAudio.shift() }));
  };

  const emit = (ev) => { try { o.onEvent?.(ev); } catch { /* UI */ } };

  function cutDiscard(reason) {
    const t = now();
    if (t - lastCutAt < 3000) return;
    lastCutAt = t;
    Promise.resolve().then(() => o.recorder.cut()).catch((e) => o.onError?.(e));
    emit({ type: 'segment_cut', reason });
  }

  function analyse(ev, detectedAt, lag_s) {
    const segP = Promise.resolve().then(() => o.recorder.cut());
    lastCutAt = now();
    queue = queue.then(async () => {
      let blob;
      try { blob = await segP; } catch (e) { st.failed += 1; o.onError?.(e); return; }
      const t0 = Number.isFinite(blob && blob.t_media_start_s) ? blob.t_media_start_s : 0;
      const rel = (t) => Math.max(0, t - t0);
      const warnings = [...(o.clipOptions?.warnings ?? []), ...(ev.reason_codes ?? [])];
      if (degraded && !warnings.includes(RC.THERMAL_DEGRADED)) warnings.push(RC.THERMAL_DEGRADED);
      const ids = typeof o.newIds === 'function' ? o.newIds() : o.clipOptions?.ids;
      const options = {
        ...o.clipOptions, ids, mode: 'live', source: 'camera', pose_model: poseModel, pose_hz: poseHz, warnings,
        trim_s: [rel(ev.t_address - 0.5), Math.max(rel(ev.t_address - 0.5) + 0.1, rel(ev.t_finish + 0.3))],
        audioOnset_t: ev.impact_source === 'audio' ? rel(ev.t_impact) : undefined,
        live_event: { ...ev, t_offset_s: t0 },
      };
      try {
        const res = await o.analyzeSegment(blob, options);
        const latency_s = lag_s + (now() - detectedAt) / 1000;
        st.analysed += 1;
        st.latencies.push(latency_s);
        const p95 = percentile95(st.latencies);
        diagRecord('live.latency_p95_s', p95);
        diagRecord('live.touches_per_shot', st.touches / Math.max(1, st.shots));
        const fs = typeof o.frameStats === 'function' ? o.frameStats() : null;
        const dropped_frac = fs && Number.isFinite(fs.dropped_pct) ? fs.dropped_pct / 100 : undefined;
        if (fs) diagRecord('live.frames_dropped_pct', fs.dropped_pct);
        const decision = thermal.push({ latency_s, dropped_frac });
        if (decision && decision.action === 'degrade') api.degrade(decision);
        else if (decision && decision.action === 'stop_live') { diagRecord('thermal.stop_live', true); o.onStopLive?.(decision); }
        o.onShot?.({ shot: res.shot, timings_ms: res.timings_ms, latency_s, kind: ev.kind, event: ev, segment: blob });
      } catch (e) {
        st.failed += 1;
        o.onError?.(e);
      }
    });
  }

  function onEvents(events) {
    for (const ev of events) {
      emit(ev);
      if (ev.type === 'state') {
        if (ev.to === 'ADDRESS' && ev.from === 'IDLE') cutDiscard('address');
        if (ev.to === 'SWING') o.setFps?.(swingHz);
        if (ev.to === 'IDLE' || ev.to === 'ADDRESS') o.setFps?.(idleHz);
      } else if (ev.type === 'shot') {
        st.detections += 1;
        pushLog(shotLog, { kind: ev.kind, t_impact: r3(ev.t_impact), t_peak: r3(ev.t_peak), t_finish: r3(ev.t_finish), impact_source: ev.impact_source ?? null }, 'live.shot_log');
        if (ev.kind === 'practice') st.practice += 1;
        else st.shots += 1;
        // live.detections = accepted shots (docs/e2e-hooks.md, R6 M5); practice swings are counted separately
        diagRecord('live.detections', st.shots);
        diagRecord('live.practice', st.practice);
        if (ev.kind !== 'practice') diagRecord('live.touches_per_shot', st.touches / Math.max(1, st.shots));
        if (ev.kind === 'swing' || o.analyzePractice) {
          const m = mediaClock();
          const lag = Number.isFinite(m) && Number.isFinite(ev.t_finish) ? Math.max(0, m - ev.t_finish) : 0;
          analyse(ev, now(), lag);
        } else {
          cutDiscard('practice');
        }
        o.setFps?.(idleHz);
      }
    }
  }

  const api = {
    async handleFrame(bitmap, t_s, meta = {}) {
      st.frames += 1;
      if (Number.isFinite(t_s) && t_s > lastFrameT) lastFrameT = t_s;
      const crop = meta.roi ? { roi: meta.roi, W: meta.W, H: meta.H } : null;
      let row;
      try {
        row = await o.pose(bitmap, t_s, 'lite', { crop });
      } catch (e) {
        o.onError?.(e);
        return;
      }
      flushAudio(t_s);
      const s = wristSample(row.img, row.world, { calibration, handedness });
      if (!s) return;
      st.wrist += 1;
      onEvents(det.feed({ ...s, t_s }));
    },
    handleOnset(t_s, level_db) {
      if (!Number.isFinite(t_s)) return;
      // an impact is a loud transient; a club whoosh also trips the onset detector, but softly (m5 browser run: whoosh
      // 13-17 dB, impact clicks 27-38 dB above background). Soft onsets are not impact candidates. UNVERIFIED on iOS.
      if (Number.isFinite(level_db) && level_db < impactMinDb) { st.soft_onsets += 1; diagRecord('audio.soft_onsets', st.soft_onsets); return; }
      pushLog(onsetLog, [r3(t_s), Number.isFinite(level_db) ? Math.round(level_db * 10) / 10 : null], 'live.onset_log');
      let i = pendingAudio.length;
      while (i > 0 && pendingAudio[i - 1] > t_s) i--;
      pendingAudio.splice(i, 0, t_s);
      // only when no frame is in flight past it already (the frame that covers it will flush it otherwise)
      if (t_s <= lastFrameT - 1) flushAudio(t_s);
    },
    touch() { st.touches += 1; diagRecord('live.touches_per_shot', st.touches / Math.max(1, st.shots)); },
    state: () => det.state(),
    stats: () => ({ ...st, latencies: st.latencies.slice(), latency_p95_s: percentile95(st.latencies), degraded, pose_model: poseModel, pose_hz: poseHz, idle_hz: idleHz }),
    degrade(decision) {
      if (degraded) return;
      degraded = true;
      poseModel = 'lite';
      poseHz = Math.max(15, Math.round(poseHz / 2));
      idleHz = Math.max(2, idleHz / 2);
      swingHz = Math.max(5, swingHz / 2);
      o.setFps?.(idleHz);
      diagRecord('thermal.degraded', true);
      o.onDegrade?.(decision ?? { action: 'degrade' });
    },
    idle: () => queue,
  };
  return api;
}
