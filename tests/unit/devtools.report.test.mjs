import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, emptyReport, parseSwManifest, REPORT_SCHEMA } from '../../app/src/diag/report.js';
import { record, reset } from '../../app/src/diag/record.js';

const MANIFEST = { version: '0.1.0+abcdef0123', dev: false, shell: ['index.html', 'src/a.js'], assets: [{ url: 'vendor/w.wasm', sha256: 'x', precache: true }, { url: 'models/h.task', sha256: 'y', precache: false }] };
const SW = `// sw\nconst MANIFEST = ${JSON.stringify(MANIFEST)};\nconst VERSION = MANIFEST.version;\n`;

function env(over = {}) {
  const shell = { match: async (p) => (p === 'index.html' ? {} : undefined) };
  const assets = { match: async () => ({}) };
  return {
    navigator: {
      userAgent: 'UA', standalone: true, serviceWorker: { controller: null },
      storage: { persisted: async () => true, estimate: async () => ({ usage: 10, quota: 100 }) },
    },
    matchMedia: () => ({ matches: false }),
    VideoDecoder: { isConfigSupported: async (c) => ({ supported: c.codec.startsWith('avc1') }) },
    MediaRecorder: { isTypeSupported: (t) => t === 'video/mp4' },
    fetch: async () => ({ ok: true, text: async () => SW }),
    caches: { keys: async () => ['gsl-assets', 'gsl-shell-0.1.0+abcdef0123'], open: async (n) => (n === 'gsl-assets' ? assets : shell) },
    setTimeout, clearTimeout,
    ...over,
  };
}

test('report has the full gsl-device-report/1 shape with nulls for unmeasured fields', async () => {
  reset();
  const r = await buildReport({ env: env() });
  const keys = ['schema', 'app_version', 'created_at', 'ua', 'standalone', 'sw_controlled', 'precache_complete', 'storage', 'webcodecs',
    'media_recorder', 'gum', 'motion', 'pose', 'live', 'import', 'setup', 'calibration', 'thermal'];
  for (const k of keys) assert.ok(k in r, `missing ${k}`);
  assert.equal(r.schema, REPORT_SCHEMA);
  assert.equal(r.standalone, true);
  assert.equal(r.sw_controlled, false);
  assert.deepEqual(r.storage, { persisted: true, usage: 10, quota: 100 });
  assert.deepEqual(r.webcodecs, { avc1: true, hevc: false });
  assert.deepEqual(r.media_recorder.types, ['video/mp4']);
  assert.equal(r.gum.actual_fps, null);
  assert.equal(r.app_version, '0.1.0+abcdef0123');
  assert.equal(r.precache_complete, 2 / 3, 'index.html + the precached asset are cached, a.js is not');
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(r)));
  assert.deepEqual(Object.keys(emptyReport()).sort(), keys.slice().sort());
});

test('recorded values are merged in; detection fields cannot be overridden by records', async () => {
  reset();
  record('gum', { calls: 1, actual_fps: 30 });
  record('standalone', false);
  record('app_version', '9.9.9+0000000000');
  const r = await buildReport({ env: env() });
  assert.equal(r.gum.calls, 1);
  assert.equal(r.gum.actual_fps, 30);
  assert.equal(r.gum.requested_fps, null);
  assert.equal(r.standalone, true);
  assert.equal(r.app_version, '9.9.9+0000000000');
  reset();
});

test('service worker answer (GET_VERSION -> VERSION message) wins; missing platform APIs give false / empty, never throw', async () => {
  reset();
  const listeners = new Set();
  const ctl = {
    postMessage(msg) {
      assert.equal(msg.type, 'GET_VERSION');
      for (const l of listeners) l({ data: { type: 'VERSION', version: '7.7.7+0123456789', precache_complete: 1 } });
    },
  };
  const e = env();
  e.navigator.serviceWorker = { controller: ctl, addEventListener: (_t, l) => listeners.add(l), removeEventListener: (_t, l) => listeners.delete(l) };
  const r = await buildReport({ env: e });
  assert.equal(r.sw_controlled, true);
  assert.equal(r.precache_complete, 1);
  assert.equal(r.app_version, '7.7.7+0123456789');
  assert.equal(listeners.size, 0, 'listener removed');

  const bare = await buildReport({ env: { setTimeout, clearTimeout } });
  assert.equal(bare.standalone, false);
  assert.equal(bare.webcodecs.avc1, false);
  assert.deepEqual(bare.media_recorder.types, []);
  assert.equal(bare.precache_complete, null);
  assert.equal(bare.storage.persisted, null);
});

test('parseSwManifest reads the build.mjs literal, including braces inside strings', () => {
  const m = parseSwManifest(`const MANIFEST = /*__GSL_MANIFEST__*/ {"version":"1.0.0+aaaaaaaaaa","shell":["a{b}.js"],"assets":[]} /*__GSL_MANIFEST_END__*/;`);
  assert.equal(m.version, '1.0.0+aaaaaaaaaa');
  assert.deepEqual(m.shell, ['a{b}.js']);
  assert.equal(parseSwManifest('const MANIFEST = {broken'), null);
  assert.equal(parseSwManifest(''), null);
});
