// workers/client.js - main-thread client of vision.worker.js (promises over the section 5 protocol).
//
//   createVisionClient({ worker?, url?, delegate = 'GPU', models = ['lite'], diag?, decodeOnMain?, timeoutMs? })
//     -> { init() -> Promise<{ delegate, models }>,
//          pose(bitmap, t_s, model = 'lite', { crop?, seq? }) -> Promise<{ t_s, img, world, ms }>   (bitmap transferred)
//          analyzeClip(file, options, { onProgress?(stage, frac) }) -> Promise<{ shot, timings_ms }> & { id, cancel() },
//          cancel(id), terminate(), pending() -> number,
//          setModel(json|null, bin|null) -> Promise<{ ok, version, message? }> }   (P9 imported event model)
//   Rejections are WorkerError { code, message } (message in Traditional Chinese from ERROR_CODES).
// The worker's { type: 'diag' } messages are replayed into diag/record.js (or `diag(path, value)` when given).
// A { type: 'decode_request } (WebCodecs unavailable in the worker) is served by decodeOnMain (default:
// import/decode.js decodeWithVideoElement): frames go back one at a time, each waiting for the worker's decode_ack.

import { validateMessage, WorkerError, ERR, errorMessage } from './protocol.js';
import { diagRecord } from './diag.js';

export function createVisionClient(o = {}) {
  const worker = o.worker ?? new Worker(o.url ?? new URL('./vision.worker.js', import.meta.url), { type: 'module' });
  const diag = typeof o.diag === 'function' ? o.diag : diagRecord;
  const pending = new Map(); // id -> { resolve, reject, onProgress, kind }
  const acks = new Map(); // req -> resolve()
  const remoteJobs = new Map(); // id -> AbortController for main-thread decodes
  let seq = 0;
  const modelWaits = []; // resolvers of setModel(), answered in order
  let ready = null;
  let readyRes = null;

  const nextId = () => `m${++seq}`;

  async function serveDecode(msg) {
    const job = pending.get(msg.id);
    const file = job && job.file;
    if (!file) { worker.postMessage({ type: 'decode_error', id: msg.id, req: msg.req, code: ERR.DECODE_FAILED, message: 'unknown job' }); return; }
    const ctl = new AbortController();
    remoteJobs.set(msg.id, ctl);
    try {
      const dec = o.decodeOnMain ?? (await import('../import/decode.js')).decodeWithVideoElement;
      const result = await dec(file, {
        from_s: msg.from_s, to_s: msg.to_s, hz: msg.hz, probe: msg.probe ?? undefined, signal: ctl.signal,
        onFrame: async (frame, t_s, index) => {
          // an ImageBitmap is transferred as is (decode.js's later close() of a detached bitmap is a no-op);
          // a VideoFrame (if decodeOnMain used WebCodecs) is copied into a bitmap first
          const bitmap = frame && 'codedWidth' in frame ? await createImageBitmap(frame) : frame;
          const acked = new Promise((r) => acks.set(msg.req, r));
          worker.postMessage({ type: 'decode_frame', id: msg.id, req: msg.req, bitmap, t_s, index }, [bitmap]);
          await acked;
        },
      });
      worker.postMessage({ type: 'decode_done', id: msg.id, req: msg.req, result: { path: result.path, decoded: result.decoded,
        emitted: result.emitted, timestamps: result.timestamps, reason_codes: result.reason_codes } });
    } catch (e) {
      const code = e && e.code && errorMessage(e.code) !== errorMessage('INTERNAL') ? e.code : ERR.DECODE_FAILED;
      worker.postMessage({ type: 'decode_error', id: msg.id, req: msg.req, code, message: String(e && e.message ? e.message : e) });
    } finally {
      remoteJobs.delete(msg.id);
      acks.delete(msg.req);
    }
  }

  function settle(id, fn) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    fn(p);
  }

  worker.onmessage = (ev) => {
    const msg = ev.data;
    const v = validateMessage(msg, 'to_main');
    if (!v.ok) { diag('worker.bad_message', v.error); return; }
    switch (msg.type) {
      case 'diag': diag(msg.path, msg.value); return;
      case 'ready': if (readyRes) readyRes.resolve({ delegate: msg.delegate, models: msg.models }); return;
      case 'pose_result': settle(msg.id, (p) => p.resolve({ t_s: msg.t_s, img: msg.img, world: msg.world, ms: msg.ms })); return;
      case 'progress': { const p = pending.get(msg.id); if (p && p.onProgress) p.onProgress(msg.stage, msg.frac); return; }
      case 'clip_result': settle(msg.id, (p) => p.resolve({ shot: msg.shot, timings_ms: msg.timings_ms })); return;
      case 'cancelled':
        remoteJobs.get(msg.id)?.abort();
        settle(msg.id, (p) => p.reject(new WorkerError(ERR.CANCELLED)));
        return;
      case 'error': {
        const err = new WorkerError(msg.code, msg.message);
        err.detail = msg.detail;
        if (msg.id === null || msg.id === undefined) { if (readyRes) readyRes.reject(err); return; }
        remoteJobs.get(msg.id)?.abort();
        settle(msg.id, (p) => p.reject(err));
        return;
      }
      case 'model_set': { const r = modelWaits.shift(); if (r) r({ ok: msg.ok, version: msg.version ?? null, message: msg.message }); return; }
      case 'decode_request': serveDecode(msg); return;
      case 'decode_ack': { const r = acks.get(msg.req); if (r) { acks.delete(msg.req); r(); } return; }
      default:
    }
  };
  worker.onerror = (ev) => {
    const err = new WorkerError(ERR.INIT_FAILED, ev && ev.message ? ev.message : undefined);
    if (readyRes) readyRes.reject(err);
    for (const [id] of pending) settle(id, (p) => p.reject(err));
  };

  return {
    init() {
      if (!ready) {
        ready = new Promise((resolve, reject) => { readyRes = { resolve, reject }; });
        ready.catch(() => { ready = null; });
        worker.postMessage({ type: 'init', delegate: o.delegate ?? 'GPU', models: o.models ?? ['lite'] });
      }
      return ready;
    },
    pose(bitmap, t_s, model = 'lite', extra = {}) {
      const id = nextId();
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, kind: 'pose' });
        worker.postMessage({ type: 'pose', id, bitmap, t_s, model, crop: extra.crop ?? null, seq: !!extra.seq }, [bitmap]);
      });
    },
    analyzeClip(file, options = {}, { onProgress } = {}) {
      const id = nextId();
      const p = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, onProgress, kind: 'clip', file });
        worker.postMessage({ type: 'analyze_clip', id, file, options });
      });
      p.id = id;
      p.cancel = () => worker.postMessage({ type: 'cancel', id });
      return p;
    },
    cancel(id) { worker.postMessage({ type: 'cancel', id }); },
    setModel(json, bin) {
      return new Promise((resolve) => {
        modelWaits.push(resolve);
        worker.postMessage({ type: 'set_model', json: json ?? null, bin: json ? bin : null });
      });
    },
    pending: () => pending.size,
    terminate() {
      try { worker.terminate(); } catch { /* ignore */ }
      const err = new WorkerError(ERR.CANCELLED);
      for (const [id] of pending) settle(id, (q) => q.reject(err));
    },
  };
}
