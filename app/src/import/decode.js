// import/decode.js - clip decoding: WebCodecs + mp4box, fallback <video> seek + requestVideoFrameCallback.
//
//   codecSupport({ env? }) -> Promise<{ webcodecs, avc1, hevc }>          (also recorded as webcodecs.*)
//   decoderConfig(demuxer) -> VideoDecoderConfig
//   decodeFile(file, { onFrame(frame, t_s, index) -> void | Promise, from_s?, to_s?, hz?, indices?, signal?,
//                      demuxer?, probe?, prefer?: 'webcodecs'|'video', crop?, maxWidth?, env? })
//     -> Promise<{ path: 'webcodecs'|'video', decoded, emitted, codec, hevc, timestamps, reason_codes, late }>
//   decodeWithVideoElement(file, { ... same ... }) -> same result (main thread only)
//   DecodeError { code }   codes: WEBCODECS_UNAVAILABLE, UNSUPPORTED_CODEC, DECODE_FAILED, NO_DOCUMENT, CANCELLED
//
// Frame ownership: onFrame receives a VideoFrame (WebCodecs) or an ImageBitmap (<video> path) that decode.js
// close()s as soon as onFrame's promise settles - copy what you need (gray bytes, a bitmap) before returning.
// Frames that are decoded but not selected (outside [from_s, to_s], not on the hz grid, not in `indices`) are
// closed at once. Output is delivered in presentation (CTS) order through a small reorder buffer; index is the
// presentation index in the whole clip and t_s its CTS in seconds (probe.cts_s[index]).
// Range decode starts at the last sync sample at or before from_s and stops after the last sample whose CTS is
// <= to_s, then flushes, so B-frames inside the window are all emitted.

import { RC } from '../contract/reason-codes.js';
import { openDemuxer, codecFamily } from './demux.js';
import { buildTimebase, gridIndices, rangeIndices, rotationFromMatrix } from './timebase.js';
import { diagRecord } from '../workers/diag.js';

export class DecodeError extends Error {
  constructor(code, message) { super(message); this.name = 'DecodeError'; this.code = code; }
}

const REORDER = 2;
const MAX_INFLIGHT = 6;

function abortError() {
  return new DecodeError('CANCELLED', 'cancelled');
}

export async function codecSupport(opts = {}) {
  const env = opts.env ?? globalThis;
  const VD = env.VideoDecoder;
  const out = { webcodecs: typeof VD === 'function', avc1: false, hevc: false };
  if (out.webcodecs && typeof VD.isConfigSupported === 'function') {
    const test = async (codec) => {
      try { const r = await VD.isConfigSupported({ codec, codedWidth: 1920, codedHeight: 1080 }); return !!(r && r.supported); } catch { return false; }
    };
    out.avc1 = await test('avc1.64002A');
    out.hevc = (await test('hvc1.1.6.L153.B0')) || (await test('hev1.1.6.L153.B0'));
  }
  diagRecord('webcodecs.avc1', out.avc1);
  diagRecord('webcodecs.hevc', out.hevc);
  return out;
}

export function decoderConfig(dm) {
  const cfg = { codec: dm.codec, codedWidth: dm.width, codedHeight: dm.height, optimizeForLatency: false };
  if (dm.description) cfg.description = dm.description;
  return cfg;
}

/** Selected presentation indices for the request (exported for tests). */
export function selection(t_s, { from_s = -Infinity, to_s = Infinity, hz = 0, indices = null } = {}) {
  if (indices) {
    const [i0, i1] = rangeIndices(t_s, from_s, to_s);
    return new Set(Array.from(indices).filter((i) => i >= i0 && i <= i1));
  }
  return new Set(gridIndices(t_s, hz, from_s, to_s));
}

/** Decode-order span [d0, d1] that produces every selected presentation index (exported for tests). */
export function decodeSpan(samples, tb, wanted) {
  if (!wanted.size) return null;
  let pMin = Infinity, pMax = -Infinity;
  for (const p of wanted) { if (p < pMin) pMin = p; if (p > pMax) pMax = p; }
  let dFirst = Infinity, dLast = -Infinity;
  for (let p = pMin; p <= pMax; p++) {
    const d = tb.order[p];
    if (d < dFirst) dFirst = d;
    if (d > dLast) dLast = d;
  }
  let d0 = 0;
  for (let d = dFirst; d >= 0; d--) if (samples[d].is_sync) { d0 = d; break; }
  return [d0, dLast];
}

export async function decodeFile(file, opts = {}) {
  const env = opts.env ?? globalThis;
  const prefer = opts.prefer ?? 'webcodecs';
  if (prefer === 'webcodecs' && typeof env.VideoDecoder === 'function') {
    try {
      return await decodeWebCodecs(file, opts);
    } catch (e) {
      if (e && e.code === 'CANCELLED') throw e;
      if (!env.document) throw e;
      diagRecord('import.last.fallback', String(e && e.code ? e.code : e));
      return decodeWithVideoElement(file, opts);
    }
  }
  if (env.document) return decodeWithVideoElement(file, opts);
  throw new DecodeError('WEBCODECS_UNAVAILABLE', 'WebCodecs VideoDecoder is not available here');
}

async function decodeWebCodecs(file, opts) {
  const env = opts.env ?? globalThis;
  const VD = env.VideoDecoder;
  const EVC = env.EncodedVideoChunk;
  const signal = opts.signal;
  const dm = opts.demuxer ?? (await openDemuxer(file));
  const tb = opts.probe && opts.probe.timebase ? opts.probe.timebase : buildTimebase(dm.samples, { nominal_fps: dm.nominal_fps });
  const family = codecFamily(dm.codec);
  const cfg = decoderConfig(dm);
  let sup = null;
  try { sup = await VD.isConfigSupported(cfg); } catch (e) { sup = null; }
  if (!sup || !sup.supported) throw new DecodeError('UNSUPPORTED_CODEC', `decoder does not support ${dm.codec}`);
  const wanted = selection(tb.t_s, opts);
  const res = { path: 'webcodecs', decoded: 0, emitted: 0, codec: dm.codec, hevc: family === 'hevc', timestamps: tb.timestamps,
    reason_codes: tb.reason_codes.slice(), late: 0, rotation: rotationFromMatrix(dm.matrix).rotation };
  const span = decodeSpan(dm.samples, tb, wanted);
  if (!span) return res;
  const tsToP = new Map();
  for (let p = 0; p < tb.t_s.length; p++) tsToP.set(Math.round(tb.t_s[p] * 1e6), p);

  const held = []; // decoded + selected, waiting for reorder
  const ready = []; // in order, waiting for onFrame
  let lastEmitted = -1;
  let failure = null;
  let waiters = [];
  const poke = () => { const w = waiters; waiters = []; for (const f of w) f(); };
  const waitPoke = () => new Promise((r) => { waiters.push(r); setTimeout(r, 5); });

  const release = (arr) => { while (arr.length) { const it = arr.pop(); try { it.frame.close(); } catch { /* closed */ } } };
  const moveHeld = (all) => {
    held.sort((a, b) => a.p - b.p);
    while (held.length > (all ? 0 : REORDER)) {
      const it = held.shift();
      if (it.p < lastEmitted) res.late += 1;
      lastEmitted = Math.max(lastEmitted, it.p);
      ready.push(it);
    }
  };

  const dec = new VD({
    output(frame) {
      res.decoded += 1;
      const p = tsToP.get(frame.timestamp);
      if (p === undefined || !wanted.has(p) || failure) { frame.close(); return; }
      held.push({ frame, p });
      moveHeld(false);
      poke();
    },
    error(e) { failure = failure || new DecodeError('DECODE_FAILED', String(e && e.message ? e.message : e)); poke(); },
  });
  dec.configure(cfg);

  let feeding = true;
  const pump = (async () => {
    while (true) {
      if (failure) return;
      if (signal && signal.aborted) return;
      const it = ready.shift();
      if (!it) {
        if (!feeding && !held.length) return;
        await waitPoke();
        continue;
      }
      try {
        await opts.onFrame(it.frame, tb.t_s[it.p], it.p);
        res.emitted += 1;
      } catch (e) {
        failure = failure || e;
      } finally {
        try { it.frame.close(); } catch { /* closed by consumer */ }
      }
      poke();
    }
  })();

  try {
    for await (const { index: d, data, sample } of dm.readSamples(span[0], span[1])) {
      if (signal && signal.aborted) throw abortError();
      if (failure) throw failure;
      while (dec.decodeQueueSize + held.length + ready.length > MAX_INFLIGHT && !failure && !(signal && signal.aborted)) await waitPoke();
      const p = tb.pres[d];
      dec.decode(new EVC({ type: sample.is_sync ? 'key' : 'delta', timestamp: Math.round(tb.t_s[p] * 1e6), duration: 0, data }));
    }
    await dec.flush();
    moveHeld(true);
    feeding = false;
    poke();
    await pump;
    if (signal && signal.aborted) throw abortError();
    if (failure) throw failure;
  } catch (e) {
    feeding = false;
    failure = failure || e;
    poke();
    await pump.catch(() => {});
    throw e && e.code ? e : new DecodeError('DECODE_FAILED', String(e && e.message ? e.message : e));
  } finally {
    release(held);
    release(ready);
    try { if (dec.state !== 'closed') dec.close(); } catch { /* ignore */ }
  }
  return res;
}

function once(target, ok, bad, ms = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { cleanup(); reject(new DecodeError('DECODE_FAILED', `timeout waiting for ${ok}`)); }, ms);
    const onOk = (ev) => { cleanup(); resolve(ev); };
    const onBad = () => { cleanup(); reject(new DecodeError('DECODE_FAILED', `video element ${bad}`)); };
    function cleanup() { clearTimeout(t); target.removeEventListener(ok, onOk); if (bad) target.removeEventListener(bad, onBad); }
    target.addEventListener(ok, onOk);
    if (bad) target.addEventListener(bad, onBad);
  });
}

export async function decodeWithVideoElement(file, opts = {}) {
  const env = opts.env ?? globalThis;
  if (!env.document) throw new DecodeError('NO_DOCUMENT', '<video> fallback needs the main thread');
  const signal = opts.signal;
  const video = env.document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const url = env.URL.createObjectURL(file);
  const res = { path: 'video', decoded: 0, emitted: 0, codec: opts.probe ? opts.probe.codec : null, hevc: false,
    timestamps: 'container', reason_codes: [], late: 0, rotation: 0 };
  try {
    video.src = url;
    await once(video, 'loadedmetadata', 'error');
    const hasRVFC = typeof video.requestVideoFrameCallback === 'function';
    let times;
    let nominal = false;
    if (opts.probe && opts.probe.cts_s && opts.probe.cts_s.length) {
      const t0 = opts.probe.cts_s[0];
      times = opts.probe.cts_s.map((t) => t - t0); // <video> time starts at the first presented frame
      res.timestamps = opts.probe.timestamps;
      res.reason_codes.push(...(opts.probe.reason_codes || []));
    } else {
      const fps = opts.nominal_fps ?? 30;
      const n = Math.max(1, Math.floor(video.duration * fps));
      times = Array.from({ length: n }, (_, i) => i / fps);
      nominal = !hasRVFC;
    }
    const wanted = Array.from(selection(Float64Array.from(times), opts)).sort((a, b) => a - b);
    const fps = times.length > 1 ? (times.length - 1) / (times[times.length - 1] - times[0] || 1) : 30;
    for (const i of wanted) {
      if (signal && signal.aborted) throw abortError();
      const target = times[i] + 0.25 / fps;
      const seen = hasRVFC ? new Promise((r) => video.requestVideoFrameCallback((now, md) => r(md))) : null;
      video.currentTime = Math.min(target, Math.max(0, video.duration - 1e-3));
      await once(video, 'seeked', 'error');
      let t = times[i];
      if (seen) {
        const md = await Promise.race([seen, new Promise((r) => setTimeout(() => r(null), 500))]);
        if (md && Number.isFinite(md.mediaTime) && !(opts.probe && opts.probe.timestamps === 'container')) t = md.mediaTime;
      }
      const crop = opts.crop;
      const bmp = crop
        ? await env.createImageBitmap(video, crop.x, crop.y, crop.w, crop.h)
        : await env.createImageBitmap(video);
      res.decoded += 1;
      try {
        await opts.onFrame(bmp, t, i);
        res.emitted += 1;
      } finally {
        try { bmp.close(); } catch { /* closed */ }
      }
    }
    if (nominal) { res.timestamps = 'nominal'; if (!res.reason_codes.includes(RC.TIMESTAMPS_NOMINAL)) res.reason_codes.push(RC.TIMESTAMPS_NOMINAL); }
    return res;
  } finally {
    try { video.removeAttribute('src'); video.load(); } catch { /* ignore */ }
    env.URL.revokeObjectURL(url);
  }
}
