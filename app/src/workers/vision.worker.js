// workers/vision.worker.js - module worker: pose, clip decode + analysis (app-architecture.md section 5, CAFCR R1).
// Create with: new Worker(new URL('./vision.worker.js', import.meta.url), { type: 'module' }) (workers/client.js).
//
//   createWorkerHandler({ post(msg, transfer), createLandmarker?, probe?, decode?, analyze?, converter?, env?, loadTcn? })
//     -> { handle(msg) -> Promise<void> }     (the worker wires self.onmessage to it; Node tests inject fakes)
//   loadTcn(env) -> Promise<{ predict } | null>: the default event model of the build. The product ships none (owner
//     decision, PRODUCT-SPEC §7.1): the default loader returns null WITHOUT any request, so a clip uses the rules
//     (pipeline/clip.js); the owner's own retrained model arrives with { type: 'set_model' } (session/models.js).
//     Tests may inject a loader. The result is recorded in diag events.tcn ({ loaded, version } | { loaded: false, source }).
//   Probe guard (R9): a clip whose sample table points past the end of the file (truncated copy) is refused with
//     FILE_TRUNCATED before any decode; the sample count is sent as { type: 'job_info', id, frames } so the client can
//     size the clip timeout.
//   PV-2: blockForeignRequests() (pose/landmarker.js) is installed when the worker starts: fetch, XMLHttpRequest.open,
//     navigator.sendBeacon and WebSocket cannot reach another origin.
// Messages: see workers/protocol.js. Every bitmap received is closed after use; every VideoFrame is closed by
// import/decode.js. Errors are replied as { type: 'error', id, code, params, detail } with a code from ERROR_CODES.

import { validateMessage, errorReply, transferablesOf, WorkerError, ERR } from './protocol.js';
import { setDiagSink, diagRecord } from './diag.js';
import { createPoseLandmarker, blockForeignRequests } from '../pose/landmarker.js';
import { probeFile } from '../import/probe.js';
import { decodeFile } from '../import/decode.js';
import { createFrameConverter } from '../import/gray.js';
import { analyzeClip } from '../pipeline/clip.js';
import { loadTcn as parseTcn } from '../events/tcn.js';

const POSE_MAX_WIDTH = 640;

/** Default event-model loader: the shipped build has no bundled model, so nothing is fetched (no 404s, no request). */
export async function noBundledModel() {
  return null;
}

export function createWorkerHandler(o) {
  const post = o.post;
  const env = o.env ?? globalThis;
  const makeLm = o.createLandmarker ?? createPoseLandmarker;
  const probe = o.probe ?? probeFile;
  const decode = o.decode ?? decodeFile;
  const analyze = o.analyze ?? analyzeClip;
  let converter = o.converter ?? null;
  const loadTcn = o.loadTcn ?? noBundledModel;
  let tcnP = null;
  const tcn = () => (tcnP ??= Promise.resolve().then(() => loadTcn(env)).then((m) => {
    if (m) diagRecord('events.tcn', { loaded: true, version: m.meta && m.meta.version ? m.meta.version : null });
    else diagRecord('events.tcn', { loaded: false, source: 'none' });
    return m && typeof m.predict === 'function' ? m : null;
  }, (e) => {
    diagRecord('events.tcn', { loaded: false, error: String(e && e.message ? e.message : e) });
    return null;
  }));
  const conv = () => (converter ??= createFrameConverter({ env }));
  let delegate = null;
  const landmarkers = new Map(); // model -> Promise<landmarker>
  const jobs = new Map(); // id -> AbortController
  const remote = new Map(); // req -> { onFrame, resolve, reject, chain }
  let reqSeq = 0;
  let e2eEnabled = false;
  let e2eClipPose = false; // e2e only: analyze_clip asks the page's __GSL_E2E__.clipPose for the landmarks (see protocol.js)
  const e2ePose = new Map(); // req -> { resolve, id }

  const send = (msg) => post(msg, transferablesOf(msg));

  function landmarker(model) {
    if (!delegate) throw new WorkerError(ERR.NOT_INITIALIZED);
    if (!landmarkers.has(model)) {
      const p = Promise.resolve().then(() => makeLm({ model, delegate })).catch((e) => {
        landmarkers.delete(model);
        const msg = String(e && e.message ? e.message : e);
        throw new WorkerError(/wasm|fileset|loader/i.test(msg) ? ERR.WASM_LOAD_FAILED : ERR.MODEL_LOAD_FAILED, msg);
      });
      landmarkers.set(model, p);
    }
    return landmarkers.get(model);
  }

  function remoteDecode(id, file, d) {
    const req = ++reqSeq;
    return new Promise((resolve, reject) => {
      remote.set(req, { onFrame: d.onFrame, resolve, reject, chain: Promise.resolve(), id, signal: d.signal });
      send({ type: 'decode_request', id, req, from_s: d.from_s ?? -Infinity, to_s: d.to_s ?? Infinity, hz: d.hz ?? 0,
        purpose: d.purpose ?? null, probe: d.probe ? { cts_s: d.probe.cts_s, timestamps: d.probe.timestamps, codec: d.probe.codec, reason_codes: d.probe.reason_codes } : null });
    });
  }

  function decodeDep(id) {
    return async (file, d) => {
      if (typeof env.VideoDecoder === 'function') {
        try {
          return await decode(file, d);
        } catch (e) {
          if (!e || (e.code !== 'UNSUPPORTED_CODEC' && e.code !== 'WEBCODECS_UNAVAILABLE')) throw e;
        }
      }
      return remoteDecode(id, file, d); // main thread decodes (<video> + rVFC) and sends frames
    };
  }

  async function onAnalyze(msg) {
    const ctl = new AbortController();
    jobs.set(msg.id, ctl);
    const opts = msg.options || {};
    const now = () => (env.performance ? env.performance.now() : Date.now());
    const job = { t0: now(), pose_frames: 0, pose_ms: 0, decode: [], mode: opts.mode ?? null, model: opts.pose_model ?? 'full' };
    const finishJob = (outcome) => {
      job.total_ms = Math.round(now() - job.t0);
      job.pose_ms = Math.round(job.pose_ms);
      diagRecord('worker.last_job', { ...job, outcome, t0: undefined });
    };
    try {
      const lm = await landmarker(opts.pose_model ?? 'full');
      const tcnModel = opts.use_tcn === false ? null : await tcn();
      const c = conv();
      const dec = decodeDep(msg.id);
      const res = await analyze(msg.file, opts, {
        probe: async (f) => {
          const p = await probe(f);
          if (p && p.truncated) {
            diagRecord('import.last.truncated', true);
            throw new WorkerError(ERR.FILE_TRUNCATED, `sample table ends at ${p.table_end_bytes ?? '?'} B, file has ${p.file_bytes ?? '?'} B`);
          }
          if (p && Number.isFinite(p.sample_count)) send({ type: 'job_info', id: msg.id, frames: p.sample_count });
          return p;
        },
        decode: async (file, d) => {
          const t = now();
          const r = await dec(file, d);
          job.decode.push({ purpose: d?.purpose ?? null, hz: d?.hz ?? null, ms: Math.round(now() - t), decoded: r?.decoded ?? null, path: r?.path ?? null });
          return r;
        },
        newPoseSequence: () => lm.newSequence(),
        pose: async (frame, t_s, { rotation, roi }) => {
          const t = now();
          const b = await c.toBitmap(frame, { rotation, roi, maxWidth: POSE_MAX_WIDTH });
          try {
            const r = lm.detect(b.bitmap, t_s, { roi: b.roi, W: b.W, H: b.H });
            if (e2eClipPose && typeof env.createImageBitmap === 'function') {
              // e2e stand-in seam: the worker's own pose ran (its cost is measured); the rows come from the page
              const copy = await env.createImageBitmap(b.bitmap);
              const req = ++reqSeq;
              const reply = await new Promise((resolve) => {
                e2ePose.set(req, { resolve, id: msg.id });
                send({ type: 'e2e_pose_request', id: msg.id, req, bitmap: copy, t_s, crop: { roi: b.roi ?? null, W: b.W, H: b.H } });
              });
              if (reply && reply.img && reply.world) return { img: reply.img, world: reply.world };
            }
            return { img: r.img, world: r.world };
          } finally {
            try { b.bitmap.close(); } catch { /* closed */ }
            job.pose_frames += 1;
            job.pose_ms += now() - t;
          }
        },
        toGray: (frame, { rotation, roi }) => c.toGray(frame, { rotation, roi }),
        tcn: tcnModel,
        onProgress: (stage, frac) => send({ type: 'progress', id: msg.id, stage, frac: Math.max(0, Math.min(1, frac)) }),
        signal: ctl.signal,
      });
      if (ctl.signal.aborted) { finishJob('cancelled'); send({ type: 'cancelled', id: msg.id }); return; }
      finishJob('ok');
      send({ type: 'clip_result', id: msg.id, shot: res.shot, timings_ms: res.timings_ms });
    } catch (e) {
      finishJob(e && e.code ? e.code : 'INTERNAL');
      if (ctl.signal.aborted || (e && e.code === ERR.CANCELLED)) send({ type: 'cancelled', id: msg.id });
      else send(errorReply(msg.id, e));
    } finally {
      jobs.delete(msg.id);
      for (const [req, r] of remote) if (r.id === msg.id) { remote.delete(req); r.reject(new WorkerError(ERR.CANCELLED)); }
      for (const [req, r] of e2ePose) if (r.id === msg.id) { e2ePose.delete(req); r.resolve(null); }
    }
  }

  async function handle(msg) {
    const v = validateMessage(msg, 'to_worker');
    if (!v.ok) {
      if (msg && msg.bitmap && typeof msg.bitmap.close === 'function') { try { msg.bitmap.close(); } catch { /* ignore */ } }
      send({ ...errorReply(msg && msg.id, new WorkerError(ERR.BAD_MESSAGE)), detail: v.error });
      return;
    }
    switch (msg.type) {
      case 'init': {
        if (msg.e2e === true) e2eEnabled = true;
        if (msg.e2e === true && msg.e2e_clip_pose === true) e2eClipPose = true;
        try {
          delegate = msg.delegate;
          const models = Array.isArray(msg.models) && msg.models.length ? msg.models : ['lite'];
          const lms = await Promise.all(models.map((m) => landmarker(m)));
          delegate = lms[0] ? lms[0].delegate : delegate; // GPU may have fallen back to CPU
          send({ type: 'ready', delegate, models });
        } catch (e) {
          delegate = null;
          landmarkers.clear();
          const code = e && e.code ? e.code : ERR.INIT_FAILED;
          send(errorReply(null, new WorkerError(code, e && e.message)));
        }
        return;
      }
      case 'pose': {
        const bmp = msg.bitmap;
        try {
          const lm = await landmarker(msg.model);
          if (msg.seq) lm.newSequence();
          const r = lm.detect(bmp, msg.t_s, msg.crop ?? null);
          send({ type: 'pose_result', id: msg.id, t_s: msg.t_s, img: r.img, world: r.world, ms: r.ms });
        } catch (e) {
          send(errorReply(msg.id, e && e.code ? e : new WorkerError(ERR.POSE_FAILED, e && e.message)));
        } finally {
          try { bmp.close(); } catch { /* closed */ }
        }
        return;
      }
      case 'analyze_clip':
        await onAnalyze(msg);
        return;
      case 'set_model': {
        // P9 (flows owner): the owner's imported event model replaces the default one; json null = back to the
        // default (bundled model fetched on the next clip, or the rules when the build has none)
        try {
          if (msg.json) {
            const m = parseTcn(msg.json, msg.bin);
            tcnP = Promise.resolve(m);
            diagRecord('events.tcn', { loaded: true, version: m.meta && m.meta.version ? m.meta.version : null, source: 'imported' });
            send({ type: 'model_set', ok: true, version: m.meta && m.meta.version ? m.meta.version : null });
          } else {
            tcnP = null;
            send({ type: 'model_set', ok: true, version: null });
          }
        } catch (e) {
          tcnP = null;
          send({ type: 'model_set', ok: false, version: null, message: String(e && e.message ? e.message : e) });
        }
        return;
      }
      case 'e2e_crash': {
        // e2e gate d-worker-crash only: an uncaught error reaches the page's worker.onerror like a real crash
        if (e2eEnabled) setTimeout(() => { throw new Error('e2e: simulated worker crash'); }, 0);
        return;
      }
      case 'e2e_pose_reply': {
        const r = e2ePose.get(msg.req);
        if (r) { e2ePose.delete(msg.req); r.resolve(msg.img && msg.world ? { img: msg.img, world: msg.world } : null); }
        return;
      }
      case 'cancel': {
        const ctl = jobs.get(msg.id);
        if (ctl) ctl.abort();
        else send({ type: 'cancelled', id: msg.id });
        return;
      }
      case 'decode_frame': {
        const r = remote.get(msg.req);
        const bmp = msg.bitmap;
        if (!r) { try { bmp.close(); } catch { /* ignore */ } return; }
        r.chain = r.chain
          .then(() => r.onFrame(bmp, msg.t_s, msg.index))
          .catch((e) => { r.failed = r.failed || e; })
          .finally(() => {
            try { bmp.close(); } catch { /* closed */ }
            send({ type: 'decode_ack', id: msg.id, req: msg.req });
          });
        return;
      }
      case 'decode_done': {
        const r = remote.get(msg.req);
        if (!r) return;
        remote.delete(msg.req);
        await r.chain;
        if (r.failed) r.reject(r.failed);
        else r.resolve(msg.result);
        return;
      }
      case 'decode_error': {
        const r = remote.get(msg.req);
        if (!r) return;
        remote.delete(msg.req);
        await r.chain;
        r.reject(new WorkerError(msg.code, msg.message));
        return;
      }
      default:
    }
  }

  return { handle };
}

// Wire up when running as a worker (no document, has postMessage).
if (typeof globalThis.WorkerGlobalScope !== 'undefined' && typeof globalThis.document === 'undefined' &&
    typeof globalThis.postMessage === 'function') {
  const post = (msg, transfer) => {
    try { globalThis.postMessage(msg, transfer && transfer.length ? transfer : undefined); } catch (e) {
      globalThis.postMessage({ type: 'error', id: msg && msg.id, code: 'INTERNAL', params: {}, detail: String(e && e.message ? e.message : e) });
    }
  };
  try { blockForeignRequests(globalThis); } catch { /* best effort: the landmarker installs the fetch guard too */ }
  setDiagSink((path, value) => post({ type: 'diag', path, value }));
  const h = createWorkerHandler({ post });
  globalThis.onmessage = (ev) => { h.handle(ev.data); };
}
