// diag/report.js - buildReport() -> 'gsl-device-report/1' (docs/app-architecture.md section 6).
//
//   buildReport(opts?) -> Promise<report>      opts: { env = globalThis, swTimeoutMs = 1500 }
//
// Measured values come from diag.record(path, value) (record.js); everything that can be detected from the
// platform (standalone, service worker, precache, storage, WebCodecs, MediaRecorder) is read here. A field that was
// never measured is null, never a guess: scripts/check_device_report.mjs treats null as FAIL.
//
// Service-worker contract (app/sw.template.js): the page posts {type:'GET_VERSION'} to the controller and the SW answers
// on the serviceWorker 'message' channel with {type:'VERSION', version, precache_complete: 0..1}. Without an answer the
// report counts how many entries of the MANIFEST embedded in sw.js (shell + precached assets) are in the caches.

import { get, events } from './record.js';

export const REPORT_SCHEMA = 'gsl-device-report/1';
export const CODEC_AVC = 'avc1.64002A';
export const CODEC_HEVC = 'hvc1.1.6.L153.B0';
export const RECORDER_TYPES = Object.freeze([
  'video/mp4', 'video/mp4;codecs=avc1', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=hvc1',
  'video/webm', 'video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm;codecs=h264', 'audio/mp4', 'audio/webm',
]);

/** Skeleton with every section of the schema present and every unmeasured leaf null. */
export function emptyReport() {
  return {
    schema: REPORT_SCHEMA, app_version: null, created_at: null, ua: null,
    standalone: null, sw_controlled: null, precache_complete: null,
    storage: { persisted: null, usage: null, quota: null },
    webcodecs: { avc1: null, hevc: null },
    media_recorder: { types: [] },
    gum: { calls: null, requested_fps: null, actual_fps: null, width: null, height: null },
    motion: { permission: null, available: null, same_click: null },
    pose: { delegate: null, lite_ms_p50: null, full_ms_p50: null },
    live: { latency_p95_s: null, frames_dropped_pct: null, detections: null, touches_per_shot: null },
    import: { last: { effective_fps: null, decoded: null, sample_count: null, hevc: null } },
    setup: { durations_s: {}, total_s: null, view: null },
    calibration: null,
    thermal: { degraded: null },
  };
}

/**
 * Human summary of a report for the Diagnostics screen (V19 / R12): ids + values only, the screen formats and
 * labels them (t('diag.row.<id>')). -> [{ id, icon, value, ok: true|false|null }]   (ok null = unknown)
 */
export function summarize(rep) {
  const r = rep || {};
  const n = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const errs = Array.isArray(r.events) ? r.events.filter((e) => e && e.kind === 'error') : [];
  const quota = n(r.storage?.quota);
  const usage = n(r.storage?.usage);
  return [
    { id: 'version', icon: 'info', value: r.app_version ?? null, ok: r.app_version ? true : null },
    { id: 'camera_fps', icon: 'camera', value: n(r.gum?.actual_fps), ok: n(r.gum?.actual_fps) === null ? null : r.gum.actual_fps >= 30 },
    { id: 'camera_size', icon: 'camera', value: n(r.gum?.width) && n(r.gum?.height) ? `${r.gum.width}x${r.gum.height}` : null, ok: n(r.gum?.width) === null ? null : r.gum.width <= 1280 },
    { id: 'decoder', icon: 'video', value: r.webcodecs?.avc1 === true ? 'webcodecs' : (r.webcodecs?.avc1 === false ? 'video' : null), ok: r.webcodecs?.avc1 ?? null },
    { id: 'pose', icon: 'person', value: r.pose?.delegate ?? null, ok: r.pose?.delegate ? true : null },
    { id: 'storage', icon: 'storage', value: usage !== null && quota !== null ? { usage, quota } : null, ok: usage !== null && quota !== null ? quota - usage > 500 * 1048576 : null },
    { id: 'persisted', icon: 'lock', value: r.storage?.persisted ?? null, ok: r.storage?.persisted ?? null },
    { id: 'offline', icon: 'download', value: r.precache_complete ?? null, ok: typeof r.precache_complete === 'number' ? r.precache_complete >= 1 : null },
    { id: 'standalone', icon: 'home', value: r.standalone ?? null, ok: r.standalone ?? null },
    { id: 'errors', icon: 'alert', value: errs.length, ok: errs.length === 0 },
  ];
}

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Recorded values win over the skeleton (deep merge; arrays and scalars replace).
function merge(base, over) {
  if (!isObj(over)) return base;
  const out = { ...base };
  for (const k of Object.keys(over)) {
    out[k] = isObj(base[k]) && isObj(over[k]) ? merge(base[k], over[k]) : over[k];
  }
  return out;
}

async function safe(fn, fallback = null) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function detectStandalone(env) {
  let mq = false;
  try {
    mq = !!(env.matchMedia && env.matchMedia('(display-mode: standalone)').matches);
  } catch { /* ignore */ }
  const ios = !!(env.navigator && env.navigator.standalone === true);
  return mq || ios;
}

async function codecSupported(env, kind, codec) {
  const api = kind === 'decode' ? env.VideoDecoder : env.VideoEncoder;
  if (!api || typeof api.isConfigSupported !== 'function') return false;
  const cfg = kind === 'decode' ? { codec, codedWidth: 1280, codedHeight: 720 } : { codec, width: 1280, height: 720 };
  const r = await safe(() => api.isConfigSupported(cfg), null);
  return !!(r && r.supported);
}

function recorderTypes(env) {
  const MR = env.MediaRecorder;
  if (!MR || typeof MR.isTypeSupported !== 'function') return [];
  return RECORDER_TYPES.filter((t) => {
    try {
      return MR.isTypeSupported(t) === true;
    } catch {
      return false;
    }
  });
}

function askServiceWorker(env, timeoutMs) {
  const sw = env.navigator && env.navigator.serviceWorker;
  const ctl = sw && sw.controller;
  if (!ctl || typeof sw.addEventListener !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const onMsg = (ev) => {
      const d = ev && ev.data;
      if (d && d.type === 'VERSION') finish({ version: typeof d.version === 'string' ? d.version : null, complete: typeof d.precache_complete === 'number' && Number.isFinite(d.precache_complete) ? d.precache_complete : null });
    };
    const finish = (v) => {
      if (done) return;
      done = true;
      try { env.clearTimeout(timer); } catch { /* ignore */ }
      try { sw.removeEventListener('message', onMsg); } catch { /* ignore */ }
      resolve(v);
    };
    try {
      sw.addEventListener('message', onMsg);
      ctl.postMessage({ type: 'GET_VERSION' });
    } catch {
      finish(null);
    }
    timer = env.setTimeout(() => finish(null), timeoutMs);
  });
}

/**
 * Extract the MANIFEST literal that scripts/build.mjs embeds in sw.js:
 *   const MANIFEST = {"version":"0.1.0+abc","dev":false,"shell":[...],"assets":[{url,sha256,precache}]};
 * -> the parsed object, or null.
 */
export function parseSwManifest(text) {
  if (typeof text !== 'string') return null;
  const m = /const\s+MANIFEST\s*=\s*(?:\/\*[\s\S]*?\*\/\s*)?\{/.exec(text);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try {
        const o = JSON.parse(text.slice(start, i + 1));
        return o && typeof o === 'object' && Array.isArray(o.shell) && Array.isArray(o.assets) ? o : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function swManifest(env) {
  const f = env.fetch;
  if (typeof f !== 'function') return null;
  const res = await safe(() => f.call(env, 'sw.js', { cache: 'no-store' }), null);
  if (!res || !res.ok) return null;
  return parseSwManifest(await safe(() => res.text(), ''));
}

async function cacheFraction(env, manifest) {
  const caches = env.caches;
  if (!caches || !manifest) return null;
  const shellUrls = manifest.shell;
  const assetUrls = manifest.assets.filter((a) => a.precache).map((a) => a.url);
  const total = shellUrls.length + assetUrls.length;
  if (total === 0) return null;
  const names = await safe(() => caches.keys(), []);
  const shellName = `gsl-shell-${manifest.version}`;
  let hit = 0;
  const count = async (name, urls) => {
    if (!names.includes(name)) return;
    const cache = await safe(() => caches.open(name), null);
    if (!cache) return;
    for (const u of urls) if (await safe(() => cache.match(u), null)) hit++;
  };
  await count(shellName, shellUrls);
  await count('gsl-assets', assetUrls);
  return hit / total;
}

export async function buildReport(opts = {}) {
  const env = opts.env || globalThis;
  const nav = env.navigator || {};
  const rep = merge(emptyReport(), get());
  rep.schema = REPORT_SCHEMA;
  rep.created_at = new Date().toISOString();
  rep.ua = typeof nav.userAgent === 'string' ? nav.userAgent : null;
  rep.standalone = detectStandalone(env);
  rep.sw_controlled = !!(nav.serviceWorker && nav.serviceWorker.controller);

  const manifest = await swManifest(env);
  const answer = rep.sw_controlled ? await askServiceWorker(env, opts.swTimeoutMs ?? 1500) : null;
  if (rep.app_version === null) rep.app_version = (answer && answer.version) || (manifest && manifest.version) || null;
  rep.precache_complete = answer && answer.complete !== null ? answer.complete : await cacheFraction(env, manifest);

  const st = nav.storage;
  rep.storage.persisted = st && typeof st.persisted === 'function' ? await safe(() => st.persisted()) : null;
  const est = st && typeof st.estimate === 'function' ? await safe(() => st.estimate()) : null;
  if (est) {
    rep.storage.usage = typeof est.usage === 'number' ? est.usage : null;
    rep.storage.quota = typeof est.quota === 'number' ? est.quota : null;
  }

  // crash log + offline readiness (PRODUCT-SPEC §4.3): added by buildReport, outside the emptyReport() skeleton
  rep.events = events();
  const op = get('offline.progress');
  rep.offline = { ready: null, done: null, total: null };
  if (op && typeof op === 'object') rep.offline = { ready: op.ready ?? null, done: op.done ?? null, total: op.total ?? null };
  if (rep.offline.ready === null && typeof rep.precache_complete === 'number') rep.offline.ready = rep.precache_complete >= 1;

  rep.webcodecs.avc1 = await codecSupported(env, 'decode', CODEC_AVC);
  rep.webcodecs.hevc = await codecSupported(env, 'decode', CODEC_HEVC);
  rep.media_recorder.types = recorderTypes(env);
  return rep;
}
