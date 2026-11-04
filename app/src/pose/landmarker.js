// pose/landmarker.js - MediaPipe PoseLandmarker (tasks-vision 1.2.2, vendored) with GPU -> CPU fallback.
//
//   MODELS = ['lite', 'full', 'heavy']
//   assetUrls({ model, base? }) -> { bundle, wasm, model }       local URLs only, resolved from this module
//   createMonotonicClock() -> { next(t_s) -> ms, newSequence(), last() }   (pure; VIDEO mode needs increasing ms)
//   createPoseLandmarker({ model = 'full', delegate = 'GPU', moduleWorker?, vision?, minConf = 0.5 })
//     -> Promise<{ model, delegate, detect(image, t_s, crop?) -> { img, world, found, ms }, newSequence(),
//                  ms_p50(), close() }>
//   image: ImageBitmap / VideoFrame / OffscreenCanvas; crop: { roi, W, H } (see pose/convert.js) - output rows are
//   normalised to the full frame. Each clip calls newSequence() so its timestamps restart after a 1 s gap while
//   staying strictly increasing for the shared graph.
// `vision` injects the tasks-vision module (tests); by default it is imported from app/vendor/mediapipe.
//   blockForeignFetch(env = globalThis) -> boolean   wraps env.fetch so that cross-origin requests reject (idempotent).
//     tasks-vision 1.2.2 posts usage telemetry to Google's ODML logging endpoint every 60 s from every task (found by
//     the e2e gate real-pose, which fails on any request leaving the local server); the app is offline and private
//     (KD5), so createPoseLandmarker installs this guard first. A rejected send makes the vendored logger stop for
//     good. Blocked requests are counted in diag pose.blocked_requests.

import { poseRow } from './convert.js';
import { diagRecord } from '../workers/diag.js';

export const MODELS = Object.freeze(['lite', 'full', 'heavy']);

export function assetUrls({ model = 'full', base = import.meta.url } = {}) {
  if (!MODELS.includes(model)) throw new RangeError(`unknown pose model '${model}'`);
  return {
    bundle: new URL('../../vendor/mediapipe/vision_bundle.mjs', base).href,
    wasm: new URL('../../vendor/mediapipe/wasm', base).href,
    model: new URL(`../../models/pose_landmarker_${model}.task`, base).href,
  };
}

export function createMonotonicClock() {
  let last = -Infinity;
  let offset = 0;
  let fresh = true;
  return {
    next(t_s) {
      const raw = Math.round(t_s * 1000);
      if (fresh) { offset = (last === -Infinity ? 0 : last + 1000) - raw; fresh = false; }
      let ms = raw + offset;
      if (ms <= last) ms = last + 1;
      last = ms;
      return ms;
    },
    newSequence() { fresh = true; },
    last: () => last,
  };
}

export function blockForeignFetch(env = globalThis) {
  const orig = env && env.fetch;
  if (typeof orig !== 'function' || orig.__gslLocalOnly) return false;
  const origin = env.location && env.location.origin && env.location.origin !== 'null' ? env.location.origin : null;
  let blocked = 0;
  const guarded = function fetch(input, init) {
    let u = null;
    try { u = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, env.location ? env.location.href : undefined); } catch { u = null; }
    if (u && /^https?:$/.test(u.protocol) && origin && u.origin !== origin) {
      blocked += 1;
      diagRecord('pose.blocked_requests', blocked);
      return Promise.reject(new TypeError('blocked: the app is offline-only (no requests leave this origin)'));
    }
    return orig.call(this ?? env, input, init);
  };
  guarded.__gslLocalOnly = true;
  env.fetch = guarded;
  return true;
}

function inModuleWorker() {
  return typeof globalThis.WorkerGlobalScope !== 'undefined' && typeof globalThis.document === 'undefined';
}

function median(a) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export async function createPoseLandmarker(opts = {}) {
  const model = opts.model ?? 'full';
  const urls = assetUrls({ model });
  if (!opts.vision) blockForeignFetch(globalThis);
  const vision = opts.vision ?? (await import(urls.bundle));
  const moduleWorker = opts.moduleWorker ?? inModuleWorker();
  const fileset = await vision.FilesetResolver.forVisionTasks(urls.wasm, moduleWorker);
  const conf = opts.minConf ?? 0.5;
  // tasks-vision loads the wasm loader with import() in a module worker, reads self.ModuleFactory and then clears it.
  // A second landmarker in the same worker (lite for live + full for import, or the GPU -> CPU retry) gets the cached
  // module, which does not set it again -> "ModuleFactory not set.". Restore it from the cached module's default export.
  const restoreFactory = async () => {
    if (globalThis.ModuleFactory || !fileset || !fileset.wasmLoaderPath) return;
    try {
      const m = await import(fileset.wasmLoaderPath);
      if (typeof m.default === 'function') globalThis.ModuleFactory = m.default;
    } catch { /* classic loader (importScripts) sets it on every load */ }
  };
  const make = async (delegate) => { await restoreFactory(); return vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: urls.model, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: conf,
    minPosePresenceConfidence: conf,
    minTrackingConfidence: conf,
    outputSegmentationMasks: false,
  }); };
  let delegate = opts.delegate ?? 'GPU';
  let lm;
  try {
    lm = await make(delegate);
  } catch (e) {
    if (delegate !== 'GPU') throw e;
    diagRecord('pose.gpu_error', String(e && e.message ? e.message : e));
    delegate = 'CPU';
    lm = await make('CPU');
  }
  diagRecord('pose.delegate', delegate);
  const clock = createMonotonicClock();
  const times = [];
  const now = () => (globalThis.performance ? globalThis.performance.now() : Date.now());
  return {
    model,
    delegate,
    detect(image, t_s, crop) {
      const t0 = now();
      const r = lm.detectForVideo(image, clock.next(t_s));
      const row = poseRow(r && r.landmarks ? r.landmarks[0] : null, r && r.worldLandmarks ? r.worldLandmarks[0] : null, crop);
      const ms = now() - t0;
      times.push(ms);
      if (times.length > 200) times.shift();
      if (times.length % 20 === 0) diagRecord(`pose.${model}_ms_p50`, median(times));
      return { ...row, ms };
    },
    newSequence() { clock.newSequence(); },
    ms_p50: () => median(times),
    close() { try { lm.close(); } catch { /* ignore */ } },
  };
}
