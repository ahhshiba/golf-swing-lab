// audio/onset.js - main-thread side of the impact-sound detector (CAFCR P4, P17 AUDIO_UNAVAILABLE).
//
//   startOnsetDetector(audioCtx, stream, { onOnset(t_s, level_db), toMediaTime?(perf_ms) -> t_s | null, options? })
//     -> Promise<{ available: true, stop() } | { available: false, reason_codes: [RC.AUDIO_UNAVAILABLE], error, stop() }>
//   ctxToPerfMs(t_ctx, stamp) -> perf_ms     stamp = audioCtx.getOutputTimestamp() { contextTime, performanceTime }
//
// Time base: the worklet reports AudioContext time t_ctx; it is mapped to performance.now() by the processing clock
// (ctxToPerfMsNow: perf now - (audioCtx.currentTime - t_ctx), minus the input track's reported latency), then to media
// time by toMediaTime (the frame tap's mediaTimeAt, which pairs mediaTime with the video frame's captureTime), so
// audio onsets and wrist samples share the clock used by events/live.js. Without toMediaTime the result is
// performance time in seconds.
// Why not getOutputTimestamp() (used until 2026-11-04): its contextTime is the sample now leaving the OUTPUT device,
// so mapping an INPUT sample through it adds the whole output latency: in headless Chromium the impact clicks landed
// 0.20-0.30 s after the wrist peak, at the edge of events/live.js's +-0.3 s fusion window, and real swings fell to
// "practice" at random (gate m5). The difference between the two mappings is kept in diag audio.output_skew_ms
// (UNVERIFIED on iOS; input latency from getSettings().latency where the browser reports it).
// Never throws for a missing microphone / worklet: it resolves { available: false } and records the reason.

import { RC } from '../contract/reason-codes.js';
import { diagRecord } from '../workers/diag.js';

export function ctxToPerfMs(t_ctx, stamp) {
  if (!stamp || !Number.isFinite(stamp.contextTime) || !Number.isFinite(stamp.performanceTime)) return null;
  return stamp.performanceTime + (t_ctx - stamp.contextTime) * 1000;
}

/** Processing-clock mapping: an onset at context time t_ctx, observed when the context is at currentTime, at perfNow. */
export function ctxToPerfMsNow(t_ctx, currentTime, perfNow, inputLatency_s = 0) {
  if (![t_ctx, currentTime, perfNow].every(Number.isFinite)) return null;
  return perfNow - (currentTime - t_ctx) * 1000 - (Number.isFinite(inputLatency_s) && inputLatency_s > 0 ? inputLatency_s * 1000 : 0);
}

function unavailable(error) {
  const msg = error ? String(error.message || error) : 'no audio track';
  diagRecord('audio.available', false);
  diagRecord('audio.error', msg);
  return { available: false, reason_codes: [RC.AUDIO_UNAVAILABLE], error: msg, stop() {} };
}

export async function startOnsetDetector(audioCtx, stream, opts = {}) {
  const onOnset = typeof opts.onOnset === 'function' ? opts.onOnset : () => {};
  try {
    if (!audioCtx || !audioCtx.audioWorklet || typeof audioCtx.audioWorklet.addModule !== 'function') {
      return unavailable(new Error('AudioWorklet is not available'));
    }
    if (!stream || typeof stream.getAudioTracks !== 'function' || stream.getAudioTracks().length === 0) {
      return unavailable(new Error('no audio track (microphone denied or missing)'));
    }
    await audioCtx.audioWorklet.addModule(new URL('./onset.worklet.js', import.meta.url).href);
    const src = audioCtx.createMediaStreamSource(stream);
    const AWN = globalThis.AudioWorkletNode;
    const node = new AWN(audioCtx, 'gsl-onset', {
      numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit',
      processorOptions: opts.options ?? {},
    });
    let count = 0;
    let inLat = 0;
    try { const l = stream.getAudioTracks()[0].getSettings().latency; if (Number.isFinite(l) && l >= 0 && l < 1) inLat = l; } catch { inLat = 0; }
    diagRecord('audio.input_latency_ms', Math.round(inLat * 1000 * 10) / 10);
    node.port.onmessage = (ev) => {
      const d = ev.data;
      if (!d || d.type !== 'onset') return;
      const perfNow = globalThis.performance ? globalThis.performance.now() : NaN;
      let perf = ctxToPerfMsNow(d.t_ctx, audioCtx.currentTime, perfNow, inLat);
      let stamp = null;
      try { stamp = audioCtx.getOutputTimestamp ? audioCtx.getOutputTimestamp() : null; } catch { stamp = null; }
      const viaOutput = ctxToPerfMs(d.t_ctx, stamp);
      if (perf !== null && viaOutput !== null) diagRecord('audio.output_skew_ms', Math.round(viaOutput - perf));
      if (perf === null) perf = viaOutput;
      if (perf === null) perf = Number.isFinite(perfNow) ? perfNow : d.t_ctx * 1000;
      const media = typeof opts.toMediaTime === 'function' ? opts.toMediaTime(perf) : null;
      const t = Number.isFinite(media) ? media : perf / 1000;
      count += 1;
      diagRecord('audio.onsets', count);
      onOnset(t, d.level_db);
    };
    src.connect(node);
    diagRecord('audio.available', true);
    diagRecord('audio.sample_rate', audioCtx.sampleRate);
    return {
      available: true,
      stop() {
        try { node.port.postMessage({ type: 'stop' }); } catch { /* ignore */ }
        try { src.disconnect(); } catch { /* ignore */ }
      },
    };
  } catch (e) {
    return unavailable(e);
  }
}
