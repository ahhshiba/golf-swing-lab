// workers/vision.worker.js handler + workers/client.js over an in-process message bus (structured clone, transfer).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerHandler } from '../../app/src/workers/vision.worker.js';
import { createVisionClient } from '../../app/src/workers/client.js';
import { validateMessage } from '../../app/src/workers/protocol.js';

const bitmap = () => ({ width: 64, height: 48, closed: false, close() { this.closed = true; } });

function fakeLandmarkerFactory(log, { failGpu = false, failModel = null } = {}) {
  return async ({ model, delegate }) => {
    log.push(['create', model, delegate]);
    if (model === failModel) throw new Error('fetch model failed');
    const d = failGpu && delegate === 'GPU' ? 'CPU' : delegate;
    return {
      model, delegate: d,
      detect(img, t_s, crop) {
        log.push(['detect', model, t_s, crop ? crop.roi.x : null]);
        const imgA = new Float32Array(132).fill(0.25);
        return { img: imgA, world: new Float32Array(99), found: true, ms: 7 };
      },
      newSequence() { log.push(['seq', model]); },
    };
  };
}

// Connect a client and a handler: messages are delivered asynchronously like postMessage.
function bus(handlerOpts) {
  const toMain = [];
  const seen = [];
  let client;
  const worker = {
    onmessage: null,
    postMessage(msg) { setTimeout(() => h.handle(msg), 0); },
    terminate() {},
  };
  const h = createWorkerHandler({
    ...handlerOpts,
    post: (msg) => {
      const v = validateMessage(msg, 'to_main');
      assert.equal(v.ok, true, `${msg.type}: ${v.error}`);
      seen.push(msg);
      setTimeout(() => worker.onmessage && worker.onmessage({ data: msg }), 0);
    },
  });
  return { worker, seen, toMain, h, client };
}

test('init -> ready (GPU fell back to CPU) -> pose -> pose_result; bitmap closed', async () => {
  const log = [];
  const b = bus({ createLandmarker: fakeLandmarkerFactory(log, { failGpu: true }), env: {} });
  const diag = [];
  const c = createVisionClient({ worker: b.worker, delegate: 'GPU', models: ['lite'], diag: (p, v) => diag.push([p, v]) });
  const r = await c.init();
  assert.deepEqual(r, { delegate: 'CPU', models: ['lite'] });
  const bm = bitmap();
  const pr = await c.pose(bm, 1.25, 'lite', { crop: { roi: { x: 10, y: 0, w: 64, h: 48 }, W: 640, H: 480 } });
  assert.equal(pr.t_s, 1.25);
  assert.equal(pr.img.length, 132);
  assert.equal(pr.ms, 7);
  assert.equal(bm.closed, true);
  assert.deepEqual(log.find((l) => l[0] === 'detect'), ['detect', 'lite', 1.25, 10]);
  assert.equal(c.pending(), 0);
});

test('bad message, uninitialised pose and model load failure are typed errors', async () => {
  const log = [];
  const b = bus({ createLandmarker: fakeLandmarkerFactory(log, { failModel: 'heavy' }), env: {} });
  await b.h.handle({ type: 'pose', id: 'x', t_s: 1, model: 'lite' });
  assert.equal(b.seen.at(-1).code, 'BAD_MESSAGE');
  const bm = bitmap();
  await b.h.handle({ type: 'pose', id: 'y', bitmap: bm, t_s: 1, model: 'lite' });
  assert.equal(b.seen.at(-1).code, 'NOT_INITIALIZED');
  assert.equal(bm.closed, true);
  await b.h.handle({ type: 'init', delegate: 'CPU', models: ['lite'] });
  assert.equal(b.seen.at(-1).type, 'ready');
  await b.h.handle({ type: 'pose', id: 'z', bitmap: bitmap(), t_s: 1, model: 'heavy' });
  assert.equal(b.seen.at(-1).code, 'MODEL_LOAD_FAILED');
  assert.match(b.seen.at(-1).detail, /fetch model failed/, 'developer detail for diag');
  assert.ok(!/[一-鿿]/.test(JSON.stringify(b.seen)), 'no prose from the worker');
});

test('analyze_clip: progress then clip_result; cancel -> cancelled', async () => {
  const log = [];
  let release;
  const analyze = async (file, opts, deps) => {
    deps.onProgress('probe', 0);
    deps.newPoseSequence();
    const row = await deps.pose(bitmap(), 0.1, { rotation: 0, roi: null });
    assert.equal(row.img.length, 132);
    deps.onProgress('pose', 1);
    if (opts.wait) await new Promise((r) => { release = r; deps.signal.addEventListener('abort', r); });
    if (deps.signal.aborted) throw Object.assign(new Error('x'), { code: 'CANCELLED' });
    return { shot: { shot_id: file.name }, timings_ms: { total: 3 } };
  };
  const converter = { toBitmap: async (f, o) => ({ bitmap: bitmap(), roi: { x: 0, y: 0, w: 64, h: 48 }, W: 64, H: 48, scale: 1 }), toGray: () => ({}) };
  const b = bus({ createLandmarker: fakeLandmarkerFactory(log), analyze, converter, env: {} });
  const c = createVisionClient({ worker: b.worker, diag: () => {} });
  await c.init();
  const prog = [];
  const r = await c.analyzeClip({ name: 'a.mov' }, { view: 'face_on', pose_model: 'full' }, { onProgress: (s, f) => prog.push(s) });
  assert.deepEqual(r, { shot: { shot_id: 'a.mov' }, timings_ms: { total: 3 } });
  assert.deepEqual(prog, ['probe', 'pose']);
  assert.ok(log.some((l) => l[0] === 'create' && l[1] === 'full'));
  assert.ok(log.some((l) => l[0] === 'seq' && l[1] === 'full'));
  const p = c.analyzeClip({ name: 'b.mov' }, { wait: true });
  await new Promise((r2) => setTimeout(r2, 20));
  p.cancel();
  await assert.rejects(p, (e) => e.code === 'CANCELLED');
  void release;
});

test('no WebCodecs in the worker: decode_request served on the main thread, one frame in flight', async () => {
  const log = [];
  const frames = [];
  const analyze = async (file, opts, deps) => {
    const res = await deps.decode(file, {
      from_s: 0, to_s: 1, hz: 60, purpose: 'pose', probe: { cts_s: [0, 0.5, 1], timestamps: 'container', codec: 'avc1', reason_codes: [] },
      onFrame: async (bm, t, i) => { frames.push([t, i, bm.closed]); await new Promise((r) => setTimeout(r, 2)); },
    });
    return { shot: { decoded: res.decoded, codes: res.reason_codes }, timings_ms: {} };
  };
  const b = bus({ createLandmarker: fakeLandmarkerFactory(log), analyze, env: {} /* no VideoDecoder */ });
  let inFlight = 0, maxInFlight = 0;
  const sent = [];
  const decodeOnMain = async (file, o) => {
    assert.equal(o.hz, 60);
    for (let i = 0; i < 5; i++) {
      const bm = bitmap();
      sent.push(bm);
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await o.onFrame(bm, i / 4, i);
      inFlight--;
    }
    return { path: 'video', decoded: 5, emitted: 5, timestamps: 'nominal', reason_codes: ['TIMESTAMPS_NOMINAL'] };
  };
  const c = createVisionClient({ worker: b.worker, diag: () => {}, decodeOnMain });
  await c.init();
  const r = await c.analyzeClip({ name: 'c.webm' }, {});
  assert.deepEqual(r.shot, { decoded: 5, codes: ['TIMESTAMPS_NOMINAL'] });
  assert.deepEqual(frames.map((f) => f[1]), [0, 1, 2, 3, 4]);
  assert.ok(frames.every((f) => f[2] === false), 'frame open while the worker uses it');
  assert.ok(sent.every((bm) => bm.closed), 'worker closes every received bitmap');
  assert.equal(maxInFlight, 1);
  assert.ok(b.seen.filter((m) => m.type === 'decode_ack').length === 5);
});

test('worker diag messages are replayed into the main-thread recorder', async () => {
  const diag = [];
  const worker = { onmessage: null, postMessage() {}, terminate() {} };
  createVisionClient({ worker, diag: (p, v) => diag.push([p, v]) });
  worker.onmessage({ data: { type: 'diag', path: 'pose.delegate', value: 'CPU' } });
  worker.onmessage({ data: { type: 'bogus' } });
  assert.deepEqual(diag[0], ['pose.delegate', 'CPU']);
  assert.equal(diag[1][0], 'worker.bad_message');
});

// ------------------------------------------------------------------- R5: timeouts and crash recovery (client)

function fakeWorkerFactory({ answerPose = true, answerInit = true } = {}) {
  const made = [];
  const create = () => {
    const w = {
      sent: [], terminated: false, onmessage: null, onerror: null,
      postMessage(msg) {
        this.sent.push(msg);
        const reply = (m) => setTimeout(() => this.onmessage && this.onmessage({ data: m }), 1);
        if (msg.type === 'init' && answerInit) reply({ type: 'ready', delegate: 'CPU', models: ['lite'] });
        if (msg.type === 'pose' && answerPose) reply({ type: 'pose_result', id: msg.id, t_s: msg.t_s, img: new Float32Array(132), world: new Float32Array(99), ms: 1 });
        if (msg.type === 'set_model') reply({ type: 'model_set', ok: true, version: 'v' });
        if (msg.type === 'analyze_clip' && msg.options.answer) reply({ type: 'clip_result', id: msg.id, shot: { ok: made.length }, timings_ms: {} });
      },
      terminate() { this.terminated = true; },
    };
    made.push(w);
    return w;
  };
  return { create, made };
}

const FAST = { pose_ms: 40, clip_min_ms: 60, clip_per_frame_ms: 1, restart_backoff_ms: 10, crash_window_ms: 60000, init_ms: 80 };

test('client: a crash rejects every pending call with WORKER_CRASHED, recreates the worker once and re-sends init + set_model', async () => {
  const f = fakeWorkerFactory();
  const diag = {};
  const c = createVisionClient({ createWorker: f.create, diag: (p, v) => { diag[p] = v; }, timeouts: FAST });
  await c.init();
  await c.setModel({ version: 'x' }, new ArrayBuffer(4));
  const job = c.analyzeClip({ name: 'a' }, {});
  await new Promise((r) => setTimeout(r, 5));
  f.made[0].onerror({ message: 'boom' });
  await assert.rejects(job, (e) => e.code === 'WORKER_CRASHED' && /boom/.test(e.detail));
  assert.equal(f.made[0].terminated, true);
  assert.equal(c.state(), 'restarting');
  const second = await c.analyzeClip({ name: 'b' }, { answer: true });
  assert.deepEqual(second.shot, { ok: 2 }, 'answered by the recreated worker');
  assert.equal(f.made.length, 2);
  assert.deepEqual(f.made[1].sent.slice(0, 2).map((m) => m.type), ['init', 'analyze_clip']);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(f.made[1].sent.some((m) => m.type === 'set_model' && m.json.version === 'x'), 'the imported model is pushed again');
  assert.equal(diag['worker.crashes'], 1);
  assert.equal(diag['worker.restarts'], 1);
  assert.equal(c.state(), 'ok');
});

test('client: a second crash within 60 s -> WORKER_UNAVAILABLE for every later call', async () => {
  const f = fakeWorkerFactory();
  const c = createVisionClient({ createWorker: f.create, diag: () => {}, timeouts: FAST });
  await c.init();
  f.made[0].onerror({ message: 'one' });
  await c.init();
  f.made[1].onmessageerror({});
  assert.equal(c.state(), 'unavailable');
  await assert.rejects(c.init(), (e) => e.code === 'WORKER_UNAVAILABLE');
  await assert.rejects(c.analyzeClip({}, {}), (e) => e.code === 'WORKER_UNAVAILABLE');
  const bm = bitmap();
  await assert.rejects(c.pose(bm, 0), (e) => e.code === 'WORKER_UNAVAILABLE');
  assert.equal(bm.closed, true, 'a refused bitmap is closed');
  assert.equal(f.made.length, 2);
});

test('client: a stalled pose call rejects with ANALYSIS_TIMEOUT; three in a row restart the worker', async () => {
  const f = fakeWorkerFactory({ answerPose: false });
  const diag = {};
  const c = createVisionClient({ createWorker: f.create, diag: (p, v) => { diag[p] = v; }, timeouts: FAST });
  await c.init();
  const t0 = Date.now();
  await assert.rejects(c.pose(bitmap(), 0.1), (e) => e.code === 'ANALYSIS_TIMEOUT');
  assert.ok(Date.now() - t0 >= 35);
  await assert.rejects(c.pose(bitmap(), 0.2), (e) => e.code === 'ANALYSIS_TIMEOUT');
  await assert.rejects(c.pose(bitmap(), 0.3), (e) => e.code === 'ANALYSIS_TIMEOUT');
  assert.equal(diag['worker.timeouts'], 3);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(f.made.length, 2, 'hung worker replaced');
  assert.equal(c.pending(), 0);
});

test('client: a clip that times out is retried once on a fresh worker, then rejects ANALYSIS_TIMEOUT; job_info sizes the budget', async () => {
  const f = fakeWorkerFactory();
  const c = createVisionClient({ createWorker: f.create, diag: () => {}, timeouts: { ...FAST, crash_window_ms: 0 } });
  await c.init();
  const t0 = Date.now();
  await assert.rejects(c.analyzeClip({ name: 'slow' }, {}), (e) => e.code === 'ANALYSIS_TIMEOUT');
  assert.ok(Date.now() - t0 >= 2 * FAST.clip_min_ms, 'two attempts');
  assert.equal(f.made.length, 2);
  assert.equal(f.made[1].sent.filter((m) => m.type === 'analyze_clip').length, 1, 'the retry went to the new worker');
  // job_info: 200 frames x 1 ms = 200 ms budget instead of 60
  const g = fakeWorkerFactory();
  const c2 = createVisionClient({ createWorker: g.create, diag: () => {}, timeouts: FAST });
  await c2.init();
  const job = c2.analyzeClip({ name: 'long' }, {});
  await new Promise((r) => setTimeout(r, 5));
  g.made[0].onmessage({ data: { type: 'job_info', id: job.id, frames: 200 } });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(c2.pending(), 1, 'still within the frame budget');
  g.made[0].onmessage({ data: { type: 'clip_result', id: job.id, shot: { done: true }, timings_ms: {} } });
  assert.deepEqual((await job).shot, { done: true });
});

test('client: init that never answers rejects with ANALYSIS_TIMEOUT; the next init asks a fresh worker', async () => {
  let n = 0;
  const f = fakeWorkerFactory({ answerInit: false });
  const create = () => { n++; const w = f.create(); if (n > 1) { const post = w.postMessage.bind(w); w.postMessage = (m) => { post(m); if (m.type === 'init') setTimeout(() => w.onmessage({ data: { type: 'ready', delegate: 'GPU', models: ['lite'] } }), 1); }; } return w; };
  const c = createVisionClient({ createWorker: create, diag: () => {}, timeouts: FAST });
  await assert.rejects(c.init(), (e) => e.code === 'ANALYSIS_TIMEOUT');
  assert.deepEqual(await c.init(), { delegate: 'GPU', models: ['lite'] });
  assert.equal(n, 2);
});

test('worker: a truncated clip is refused with FILE_TRUNCATED before decoding; job_info carries the sample count', async () => {
  const log = [];
  let decoded = 0;
  const analyze = async (file, opts, deps) => { await deps.probe(file); decoded++; return { shot: {}, timings_ms: {} }; };
  const mk = (probe) => bus({ createLandmarker: fakeLandmarkerFactory(log), analyze, probe, env: {} });
  const b = mk(async () => ({ truncated: true, sample_count: 300, file_bytes: 3e6, table_end_bytes: 8e6 }));
  await b.h.handle({ type: 'init', delegate: 'CPU', models: ['lite'] });
  await b.h.handle({ type: 'analyze_clip', id: 'j1', file: {}, options: { pose_model: 'lite' } });
  assert.equal(b.seen.at(-1).type, 'error');
  assert.equal(b.seen.at(-1).code, 'FILE_TRUNCATED');
  assert.equal(decoded, 0);
  const ok = mk(async () => ({ truncated: false, sample_count: 720 }));
  await ok.h.handle({ type: 'init', delegate: 'CPU', models: ['lite'] });
  await ok.h.handle({ type: 'analyze_clip', id: 'j2', file: {}, options: { pose_model: 'lite' } });
  assert.deepEqual(ok.seen.find((m) => m.type === 'job_info'), { type: 'job_info', id: 'j2', frames: 720 });
  assert.equal(ok.seen.at(-1).type, 'clip_result');
});

test('worker: without an imported owner model the clip gets no event model and nothing is fetched (EV-6)', async () => {
  const { noBundledModel } = await import('../../app/src/workers/vision.worker.js');
  assert.equal(await noBundledModel(), null);
  const fetched = [];
  let gotTcn;
  const analyze = async (file, opts, deps) => { gotTcn = deps.tcn; return { shot: {}, timings_ms: {} }; };
  const b = bus({ createLandmarker: fakeLandmarkerFactory([]), analyze, env: { fetch: async (u) => { fetched.push(String(u)); return { ok: false }; } } });
  await b.h.handle({ type: 'init', delegate: 'CPU', models: ['lite'] });
  await b.h.handle({ type: 'analyze_clip', id: 'j', file: {}, options: { pose_model: 'lite' } });
  assert.equal(gotTcn, null);
  assert.deepEqual(fetched, []);
});

test('PV-2: blockForeignRequests guards fetch, XHR.open, sendBeacon and WebSocket for other origins only', async () => {
  const { blockForeignRequests } = await import('../../app/src/pose/landmarker.js');
  const opened = [];
  class XHR { open(m, u) { opened.push(u); } }
  class WS { constructor(u) { this.u = u; } }
  const beacons = [];
  const env = {
    location: { origin: 'http://127.0.0.1:8814', href: 'http://127.0.0.1:8814/golf-swing-lab/' },
    fetch: async (u) => ({ ok: true, u }),
    XMLHttpRequest: XHR,
    navigator: { sendBeacon: (u) => { beacons.push(u); return true; } },
    WebSocket: WS,
  };
  const r = blockForeignRequests(env);
  assert.deepEqual(r, { fetch: true, xhr: true, beacon: true, websocket: true });
  await assert.rejects(env.fetch('https://firebaselogging.googleapis.com/x'), /blocked/);
  assert.equal((await env.fetch('models/x.task')).ok, true);
  assert.throws(() => new env.XMLHttpRequest().open('POST', 'https://play.googleapis.com/log'), /blocked/);
  new env.XMLHttpRequest().open('GET', 'sw.js');
  assert.deepEqual(opened, ['sw.js']);
  assert.equal(env.navigator.sendBeacon('https://example.com/b', 'x'), false);
  assert.equal(env.navigator.sendBeacon('/local', 'x'), true);
  assert.deepEqual(beacons, ['/local']);
  assert.throws(() => new env.WebSocket('wss://example.com/s'), /blocked/);
  assert.equal(new env.WebSocket('ws://127.0.0.1:8814/x').u, 'ws://127.0.0.1:8814/x');
  assert.deepEqual(blockForeignRequests(env), { fetch: false, xhr: false, beacon: false, websocket: false }, 'idempotent');
});

test('e2e clipPose seam: the worker still runs its own pose, then uses the page stand-in rows; off without the hook', async () => {
  const copies = [];
  const env = { createImageBitmap: async (src) => { const c = bitmap(); copies.push(c); return c; } };
  const analyze = async (file, opts, deps) => {
    deps.newPoseSequence();
    const row = await deps.pose(bitmap(), 0.5, { rotation: 0, roi: null });
    return { shot: { v: row.img[0], w: row.world.length }, timings_ms: {} };
  };
  const converter = { toBitmap: async () => ({ bitmap: bitmap(), roi: { x: 0, y: 0, w: 64, h: 48 }, W: 64, H: 48, scale: 1 }), toGray: () => ({}) };
  const seen = [];
  const clipPose = async (bm, t_s, o) => { seen.push([t_s, o.crop.W, o.crop.H]); bm.close(); return { img: new Float32Array(132).fill(0.75), world: new Float32Array(99) }; };
  for (const [hooks, want] of [[{ clipPose }, 0.75], [{}, 0.25], [null, 0.25]]) {
    const log = [];
    const b = bus({ createLandmarker: fakeLandmarkerFactory(log), analyze, converter, env });
    const c = createVisionClient({ worker: b.worker, diag: () => {}, e2e: hooks });
    await c.init();
    const r = await c.analyzeClip({ name: 'x' }, { pose_model: 'full' });
    assert.equal(r.shot.v, want, `hooks ${JSON.stringify(hooks && Object.keys(hooks))}`);
    assert.equal(r.shot.w, 99);
    assert.ok(log.some((l) => l[0] === 'detect'), 'the worker pose ran (its cost is part of the job)');
    assert.equal(b.seen.some((m) => m.type === 'e2e_pose_request'), want === 0.75);
  }
  assert.deepEqual(seen, [[0.5, 64, 48]]);
  assert.equal(copies.length, 1);
  assert.equal(copies[0].closed, true);
});

test('e2e clipPose seam: a stand-in that throws or returns junk keeps the worker rows', async () => {
  const env = { createImageBitmap: async () => bitmap() };
  const analyze = async (file, opts, deps) => ({ shot: { v: (await deps.pose(bitmap(), 0.1, { rotation: 0, roi: null })).img[0] }, timings_ms: {} });
  const converter = { toBitmap: async () => ({ bitmap: bitmap(), roi: { x: 0, y: 0, w: 64, h: 48 }, W: 64, H: 48, scale: 1 }), toGray: () => ({}) };
  for (const clipPose of [async () => { throw new Error('boom'); }, async () => ({ img: new Float32Array(3), world: null })]) {
    const b = bus({ createLandmarker: fakeLandmarkerFactory([]), analyze, converter, env });
    const diag = [];
    const c = createVisionClient({ worker: b.worker, diag: (p, v) => diag.push([p, v]), e2e: { clipPose } });
    await c.init();
    const r = await c.analyzeClip({ name: 'y' }, {});
    assert.equal(r.shot.v, 0.25);
  }
});
