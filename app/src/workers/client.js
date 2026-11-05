// workers/client.js - main-thread client of vision.worker.js (promises over the section 5 protocol), with per-call
// timeouts and crash recovery (PRODUCT-SPEC §4.1, §4.2, R5).
//
//   createVisionClient({ worker?, createWorker?, url?, delegate = 'GPU', models = ['lite'], diag?, decodeOnMain?,
//                        timeouts?, timers?, now?, e2e? })
//     -> { init() -> Promise<{ delegate, models }>,
//          pose(bitmap, t_s, model = 'lite', { crop?, seq? }) -> Promise<{ t_s, img, world, ms }>   (bitmap transferred)
//          analyzeClip(file, options, { onProgress?(stage, frac) }) -> Promise<{ shot, timings_ms }> & { id, cancel() },
//          cancel(id), terminate(), pending() -> number, state() -> 'ok'|'restarting'|'unavailable'|'terminated',
//          setModel(json|null, bin|null) -> Promise<{ ok, version, message? }>,   (P9 imported event model)
//          crashForTest() }                                                       (e2e only: the worker throws)
//   Rejections are WorkerError { code, detail, params }; the UI shows t('error.' + code). Codes of this file:
//     ANALYSIS_TIMEOUT   init > 60 s, one pose frame > 5 s, a clip > max(30 s, frames x 1 s) (frames from job_info)
//     WORKER_CRASHED     worker.onerror / onmessageerror: every pending call is rejected, the worker is recreated once
//                        (backoff 1 s) and gets init + set_model again
//     WORKER_UNAVAILABLE a second crash within 60 s (or no way to recreate the worker): every later call rejects
//   A clip that times out is retried once automatically on a fresh worker (a hung worker is terminated), then it
//   rejects with ANALYSIS_TIMEOUT. Three pose timeouts in a row also count as a hung worker (restart).
// The worker's { type: 'diag' } messages are replayed into diag/record.js (or `diag(path, value)` when given); the
// client itself records worker.crashes / worker.restarts / worker.timeouts / worker.state.
// A { type: 'decode_request } (WebCodecs unavailable in the worker) is served by decodeOnMain (default:
// import/decode.js decodeWithVideoElement): frames go back one at a time, each waiting for the worker's decode_ack.
// e2e seams (globalThis.__GSL_E2E__ when present, docs/e2e-hooks.md): the client registers itself as
// __GSL_E2E__.vision, and __GSL_E2E__.workerDelayMs > 0 delays every message to the worker by that much (a stalled
// worker, for the timeout gate). When __GSL_E2E__.clipPose(bitmap, t_s, { crop }) -> { img, world } is a function, init
// carries e2e_clip_pose: true and the worker asks it for the landmarks of every analyze_clip frame (after running its
// own pose, so the measured cost stays real): the stand-in seam of gate d-latency (a fake camera shows no golfer).

import { validateMessage, WorkerError, ERR, ERROR_CODES } from './protocol.js';
import { diagRecord } from './diag.js';

export const CLIENT_TIMEOUTS = Object.freeze({
  init_ms: 60000, pose_ms: 5000, clip_min_ms: 30000, clip_per_frame_ms: 1000,
  restart_backoff_ms: 1000, crash_window_ms: 60000, pose_timeouts_to_restart: 3,
});

export function createVisionClient(o = {}) {
  const T = { ...CLIENT_TIMEOUTS, ...(o.timeouts ?? {}) };
  const timers = o.timers ?? globalThis;
  const now = o.now ?? (() => Date.now());
  const e2e = () => (o.e2e !== undefined ? o.e2e : (globalThis.__GSL_E2E__ && typeof globalThis.__GSL_E2E__ === 'object' ? globalThis.__GSL_E2E__ : null));
  const make = typeof o.createWorker === 'function'
    ? o.createWorker
    : (o.worker ? null : () => new Worker(o.url ?? new URL('./vision.worker.js', import.meta.url), { type: 'module' }));
  const diag = typeof o.diag === 'function' ? o.diag : diagRecord;
  const rec = (p, v) => { try { diag(p, v); } catch { /* diag is best effort */ } };

  const pending = new Map(); // id -> { resolve, reject, onProgress, kind, file, options, timer, startedAt, retried }
  const acks = new Map(); // req -> resolve()
  const remoteJobs = new Map(); // id -> AbortController for main-thread decodes
  let modelWaits = []; // resolvers of setModel(), answered in order
  let seq = 0;
  let worker = null;
  let state = 'ok';
  let ready = null;
  let readyRes = null;
  let initTimer = null;
  let initRequested = false;
  let lastModel = null; // [json, bin] of the last setModel()
  let restartP = null;
  let lastCrashAt = -Infinity;
  let poseTimeoutsInARow = 0;
  const counts = { crashes: 0, restarts: 0, timeouts: 0 };

  const nextId = () => `m${++seq}`;
  const setState = (s) => { state = s; rec('worker.state', s); };

  function post(msg, transfer) {
    const w = worker;
    const send = () => {
      if (w !== worker || !w) { // the worker was replaced while the message waited: drop it (its caller was rejected)
        if (msg.bitmap && typeof msg.bitmap.close === 'function') { try { msg.bitmap.close(); } catch { /* closed */ } }
        return;
      }
      try { if (transfer && transfer.length) w.postMessage(msg, transfer); else w.postMessage(msg); } catch (e) {
        if (msg.id !== undefined) settle(msg.id, (p) => p.reject(new WorkerError(ERR.INTERNAL, String(e && e.message ? e.message : e))));
      }
    };
    const delay = Number(e2e()?.workerDelayMs);
    if (Number.isFinite(delay) && delay > 0) timers.setTimeout(send, delay);
    else send();
  }

  function clearTimer(p) {
    if (p && p.timer) { try { timers.clearTimeout(p.timer); } catch { /* ignore */ } p.timer = null; }
  }

  function settle(id, fn) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimer(p);
    fn(p);
  }

  async function serveDecode(msg) {
    const job = pending.get(msg.id);
    const file = job && job.file;
    if (!file) { post({ type: 'decode_error', id: msg.id, req: msg.req, code: ERR.DECODE_FAILED, message: 'unknown job' }); return; }
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
          post({ type: 'decode_frame', id: msg.id, req: msg.req, bitmap, t_s, index }, [bitmap]);
          await acked;
        },
      });
      post({ type: 'decode_done', id: msg.id, req: msg.req, result: { path: result.path, decoded: result.decoded,
        emitted: result.emitted, timestamps: result.timestamps, reason_codes: result.reason_codes } });
    } catch (e) {
      const code = e && typeof e.code === 'string' && Object.prototype.hasOwnProperty.call(ERROR_CODES, e.code) && e.code !== ERR.INTERNAL ? e.code : ERR.DECODE_FAILED;
      post({ type: 'decode_error', id: msg.id, req: msg.req, code, message: String(e && e.message ? e.message : e) });
    } finally {
      remoteJobs.delete(msg.id);
      acks.delete(msg.req);
    }
  }

  async function serveE2ePose(msg) {
    const fn = e2e()?.clipPose;
    let r = null;
    try {
      if (typeof fn === 'function') r = await fn(msg.bitmap, msg.t_s, { crop: msg.crop ?? null });
    } catch (e) {
      rec('worker.e2e_pose_error', String(e && e.message ? e.message : e).slice(0, 200));
    } finally {
      try { msg.bitmap?.close?.(); } catch { /* closed by the stand-in */ }
    }
    const ok = r && r.img instanceof Float32Array && r.img.length === 132 && r.world instanceof Float32Array && r.world.length === 99;
    post(ok ? { type: 'e2e_pose_reply', req: msg.req, img: r.img, world: r.world } : { type: 'e2e_pose_reply', req: msg.req },
      ok ? [r.img.buffer, r.world.buffer] : undefined);
  }

  // ---- timeouts ----

  function armClip(id, p) {
    clearTimer(p);
    const budget = Math.max(T.clip_min_ms, Number.isFinite(p.frames) ? p.frames * T.clip_per_frame_ms : 0);
    const left = Math.max(0, p.startedAt + budget - now());
    p.timer = timers.setTimeout(() => onClipTimeout(id), left);
  }

  function onClipTimeout(id) {
    const p = pending.get(id);
    if (!p) return;
    counts.timeouts += 1;
    rec('worker.timeouts', counts.timeouts);
    rec('worker.last_timeout', { kind: 'clip', retried: p.retried, frames: p.frames ?? null });
    if (p.retried) { settle(id, (q) => q.reject(new WorkerError(ERR.ANALYSIS_TIMEOUT, 'clip analysis timed out twice'))); return; }
    // the worker is busy with this clip and may be hung: start a fresh one and send the clip again (once)
    pending.delete(id);
    clearTimer(p);
    remoteJobs.get(id)?.abort();
    restart('timeout').then(() => {
      if (state === 'unavailable' || state === 'terminated') { p.reject(new WorkerError(ERR.ANALYSIS_TIMEOUT, 'clip analysis timed out; worker unavailable')); return; }
      p.retried = true;
      p.startedAt = now();
      p.frames = undefined;
      pending.set(id, p);
      armClip(id, p);
      post({ type: 'analyze_clip', id, file: p.file, options: p.options });
    }, (e) => p.reject(e));
  }

  function onPoseTimeout(id) {
    const p = pending.get(id);
    if (!p) return;
    counts.timeouts += 1;
    rec('worker.timeouts', counts.timeouts);
    rec('worker.last_timeout', { kind: 'pose' });
    settle(id, (q) => q.reject(new WorkerError(ERR.ANALYSIS_TIMEOUT, `pose frame > ${T.pose_ms} ms`)));
    poseTimeoutsInARow += 1;
    if (poseTimeoutsInARow >= T.pose_timeouts_to_restart) { poseTimeoutsInARow = 0; restart('pose_timeouts').catch(() => {}); }
  }

  // ---- crash recovery ----

  function failAll(err) {
    if (readyRes) { const r = readyRes; readyRes = null; ready = null; r.reject(err); }
    if (initTimer) { try { timers.clearTimeout(initTimer); } catch { /* ignore */ } initTimer = null; }
    for (const [id] of [...pending]) settle(id, (p) => p.reject(err));
    for (const ctl of remoteJobs.values()) { try { ctl.abort(); } catch { /* ignore */ } }
    remoteJobs.clear();
    for (const r of acks.values()) { try { r(); } catch { /* ignore */ } }
    acks.clear();
    const waits = modelWaits;
    modelWaits = [];
    for (const r of waits) r({ ok: false, version: null, message: err.code });
  }

  function killWorker() {
    const w = worker;
    worker = null;
    if (w) {
      w.onmessage = null; w.onerror = null; w.onmessageerror = null;
      try { w.terminate(); } catch { /* ignore */ }
    }
  }

  /** Replace the worker (after a crash or a hang). Second time within crash_window_ms -> unavailable. */
  function restart(why, err = null) {
    if (state === 'terminated') return Promise.reject(new WorkerError(ERR.CANCELLED));
    if (state === 'unavailable') return Promise.reject(new WorkerError(ERR.WORKER_UNAVAILABLE));
    if (restartP) return restartP;
    failAll(err ?? new WorkerError(ERR.WORKER_CRASHED, `worker restarted (${why})`));
    killWorker();
    const t = now();
    if (t - lastCrashAt < T.crash_window_ms || !make) {
      setState('unavailable');
      return Promise.reject(new WorkerError(ERR.WORKER_UNAVAILABLE, !make ? 'no worker factory' : `second failure within ${T.crash_window_ms} ms`));
    }
    lastCrashAt = t;
    setState('restarting');
    restartP = new Promise((resolve, reject) => {
      timers.setTimeout(() => {
        try {
          worker = make();
          wire(worker);
          counts.restarts += 1;
          rec('worker.restarts', counts.restarts);
          setState('ok');
          if (initRequested) {
            startInit();
            ready.then(() => { if (lastModel) { modelWaits.push(() => {}); post({ type: 'set_model', json: lastModel[0], bin: lastModel[1] }); } }, () => {});
          }
          resolve();
        } catch (e) {
          setState('unavailable');
          reject(new WorkerError(ERR.WORKER_UNAVAILABLE, String(e && e.message ? e.message : e)));
        } finally {
          restartP = null;
        }
      }, T.restart_backoff_ms);
    });
    restartP.catch(() => {});
    return restartP;
  }

  function onCrash(ev) {
    const w = ev && ev.target;
    if (w && worker && w !== worker) return;
    counts.crashes += 1;
    rec('worker.crashes', counts.crashes);
    const detail = ev && ev.message ? String(ev.message) : (ev && ev.type) || 'worker error';
    rec('worker.last_crash', { at: new Date().toISOString(), detail: detail.slice(0, 300) });
    restart('crash', new WorkerError(ERR.WORKER_CRASHED, detail)).catch(() => {});
  }

  function onMessage(ev) {
    const msg = ev.data;
    const v = validateMessage(msg, 'to_main');
    if (!v.ok) { rec('worker.bad_message', v.error); return; }
    switch (msg.type) {
      case 'diag': rec(msg.path, msg.value); return;
      case 'ready':
        if (initTimer) { try { timers.clearTimeout(initTimer); } catch { /* ignore */ } initTimer = null; }
        if (readyRes) { const r = readyRes; readyRes = null; r.resolve({ delegate: msg.delegate, models: msg.models }); }
        return;
      case 'pose_result': poseTimeoutsInARow = 0; settle(msg.id, (p) => p.resolve({ t_s: msg.t_s, img: msg.img, world: msg.world, ms: msg.ms })); return;
      case 'progress': { const p = pending.get(msg.id); if (p && p.onProgress) { try { p.onProgress(msg.stage, msg.frac); } catch { /* UI */ } } return; }
      case 'job_info': { const p = pending.get(msg.id); if (p && p.kind === 'clip') { p.frames = msg.frames; armClip(msg.id, p); } return; }
      case 'clip_result': settle(msg.id, (p) => p.resolve({ shot: msg.shot, timings_ms: msg.timings_ms })); return;
      case 'cancelled':
        remoteJobs.get(msg.id)?.abort();
        settle(msg.id, (p) => p.reject(new WorkerError(ERR.CANCELLED)));
        return;
      case 'error': {
        const err = new WorkerError(msg.code, msg.detail || msg.message || '', msg.params);
        if (msg.id === null || msg.id === undefined) {
          if (readyRes) { const r = readyRes; readyRes = null; ready = null; if (initTimer) { try { timers.clearTimeout(initTimer); } catch { /* ignore */ } initTimer = null; } r.reject(err); }
          return;
        }
        remoteJobs.get(msg.id)?.abort();
        settle(msg.id, (p) => p.reject(err));
        return;
      }
      case 'model_set': { const r = modelWaits.shift(); if (r) r({ ok: msg.ok, version: msg.version ?? null, message: msg.message }); return; }
      case 'decode_request': serveDecode(msg); return;
      case 'e2e_pose_request': serveE2ePose(msg); return;
      case 'decode_ack': { const r = acks.get(msg.req); if (r) { acks.delete(msg.req); r(); } return; }
      default:
    }
  }

  function wire(w) {
    w.onmessage = (ev) => { if (w === worker) onMessage(ev); };
    w.onerror = (ev) => {
      if (w !== worker) return;
      try { ev?.preventDefault?.(); } catch { /* handled here: not an uncaught page error */ }
      onCrash({ message: ev && typeof ev === 'object' ? (ev.message || ev.type || 'worker error') : String(ev), target: w });
    };
    w.onmessageerror = (ev) => { if (w === worker) onCrash({ message: 'messageerror', type: 'messageerror', target: w }); };
  }

  function startInit() {
    ready = new Promise((resolve, reject) => { readyRes = { resolve, reject }; });
    ready.catch(() => { ready = null; });
    if (initTimer) { try { timers.clearTimeout(initTimer); } catch { /* ignore */ } }
    initTimer = timers.setTimeout(() => {
      initTimer = null;
      if (!readyRes) return;
      counts.timeouts += 1;
      rec('worker.timeouts', counts.timeouts);
      rec('worker.last_timeout', { kind: 'init' });
      const r = readyRes;
      readyRes = null;
      ready = null;
      initRequested = false; // the next init() call asks again, on a fresh worker
      r.reject(new WorkerError(ERR.ANALYSIS_TIMEOUT, `init > ${T.init_ms} ms`));
      restart('init_timeout').catch(() => {});
    }, T.init_ms);
    post({ type: 'init', delegate: o.delegate ?? 'GPU', models: o.models ?? ['lite'], ...(e2e() ? { e2e: true, ...(typeof e2e().clipPose === 'function' ? { e2e_clip_pose: true } : {}) } : {}) });
  }

  /** Resolves when a live worker exists (waits out a restart); rejects when the client cannot work any more. */
  function alive() {
    if (state === 'unavailable') return Promise.reject(new WorkerError(ERR.WORKER_UNAVAILABLE));
    if (state === 'terminated') return Promise.reject(new WorkerError(ERR.CANCELLED));
    if (restartP) return restartP;
    return null;
  }

  worker = o.worker ?? make();
  wire(worker);

  const api = {
    init() {
      const wait = alive();
      if (wait) return wait.then(() => api.init());
      initRequested = true;
      if (!ready) startInit();
      return ready;
    },
    pose(bitmap, t_s, model = 'lite', extra = {}) {
      const wait = alive();
      if (wait) {
        return wait.then(() => api.pose(bitmap, t_s, model, extra), (e) => { try { bitmap?.close?.(); } catch { /* closed */ } throw e; });
      }
      const id = nextId();
      return new Promise((resolve, reject) => {
        const p = { resolve, reject, kind: 'pose', timer: null };
        pending.set(id, p);
        p.timer = timers.setTimeout(() => onPoseTimeout(id), T.pose_ms);
        post({ type: 'pose', id, bitmap, t_s, model, crop: extra.crop ?? null, seq: !!extra.seq }, [bitmap]);
      });
    },
    analyzeClip(file, options = {}, { onProgress } = {}) {
      const id = nextId();
      const p = new Promise((resolve, reject) => {
        const start = () => {
          const job = { resolve, reject, onProgress, kind: 'clip', file, options, timer: null, startedAt: now(), retried: false, frames: undefined };
          pending.set(id, job);
          armClip(id, job);
          post({ type: 'analyze_clip', id, file, options });
        };
        const wait = alive();
        if (wait) wait.then(start, reject);
        else start();
      });
      p.id = id;
      p.cancel = () => api.cancel(id);
      return p;
    },
    cancel(id) {
      if (worker) post({ type: 'cancel', id });
      else settle(id, (p) => p.reject(new WorkerError(ERR.CANCELLED)));
    },
    setModel(json, bin) {
      lastModel = json ? [json, bin] : null;
      const wait = alive();
      if (wait) return wait.then(() => api.setModel(json, bin), () => ({ ok: false, version: null, message: ERR.WORKER_UNAVAILABLE }));
      return new Promise((resolve) => {
        modelWaits.push(resolve);
        post({ type: 'set_model', json: json ?? null, bin: json ? bin : null });
      });
    },
    pending: () => pending.size,
    state: () => state,
    stats: () => ({ ...counts, state }),
    /** e2e only: ask the worker to throw an uncaught error (works only when init carried e2e: true). */
    crashForTest() { post({ type: 'e2e_crash' }); },
    terminate() {
      setState('terminated');
      killWorker();
      failAll(new WorkerError(ERR.CANCELLED));
    },
  };
  const hooks = e2e();
  if (hooks) { try { hooks.vision = api; } catch { /* frozen */ } }
  return api;
}
