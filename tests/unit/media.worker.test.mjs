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
  assert.match(b.seen.at(-1).message, /[一-鿿]/);
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
