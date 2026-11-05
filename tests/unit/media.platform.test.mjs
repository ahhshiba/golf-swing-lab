// WP-D platform pieces without a browser: offline tracker (R11), on-demand assets (R10), crash-log ring (R4/R12),
// Diagnostics summary rows (V19), truncation / capture-rate helpers (R9), software-GL delegate choice (PF-2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineTracker, offlineTracker, runtimeAsset, createUpdater } from '../../app/src/ui/update.js';
import { logEvent, events, clearEvents, reset, EVENTS_MAX, record } from '../../app/src/diag/record.js';
import { buildReport, summarize } from '../../app/src/diag/report.js';
import { isTruncated, captureFpsHintOf } from '../../app/src/import/probe.js';
import { softwareRenderer } from '../../app/src/pose/landmarker.js';
import { createStore, initialState } from '../../app/src/state.js';

function fakeContainer() {
  const ls = new Set();
  const posted = [];
  return {
    posted,
    controller: { postMessage: (m) => posted.push(m) },
    addEventListener: (t, fn) => { if (t === 'message') ls.add(fn); },
    emit: (data) => { for (const fn of ls) fn({ data }); },
  };
}

test('offline tracker: PRECACHE_PROGRESS -> progress, PRECACHE_DONE -> ready; state.offline mirrors it; refresh asks GET_PRECACHE', () => {
  const sw = fakeContainer();
  const store = createStore(initialState());
  const seen = [];
  const tk = createOfflineTracker({ container: sw, store });
  assert.equal(offlineTracker(), tk);
  tk.onProgress((p, ready) => seen.push([p.done, ready]));
  assert.equal(tk.ready(), false);
  sw.emit({ type: 'PRECACHE_PROGRESS', done: 3, total: 10, bytes: 1000 });
  assert.deepEqual(tk.progress(), { done: 3, total: 10, bytes: 1000 });
  sw.emit({ type: 'PRECACHE_PROGRESS', done: 10, total: 10, bytes: 9000 });
  assert.equal(tk.ready(), false, 'ready only after PRECACHE_DONE');
  sw.emit({ type: 'PRECACHE_DONE', done: 10, total: 10, bytes: 9000 });
  assert.equal(tk.ready(), true);
  assert.deepEqual(store.get().offline, { done: 10, total: 10, bytes: 9000, ready: true });
  assert.deepEqual(seen.at(-1), [10, true]);
  sw.emit({ type: 'unrelated' });
  tk.refresh();
  assert.deepEqual(sw.posted, [{ type: 'GET_PRECACHE' }]);
  // after a reload: the status answer alone makes it ready
  const t2 = createOfflineTracker({ container: fakeContainer() });
  t2._onMessage({ data: { type: 'PRECACHE_STATUS', done: 170, total: 170, bytes: null, complete: true } });
  assert.equal(t2.ready(), true);
  t2._onMessage({ data: { type: 'PRECACHE_STATUS', done: 160, total: 170, complete: false } });
  assert.equal(t2.ready(), false, 'an evicted cache is not ready');
  const t3 = createOfflineTracker({ container: fakeContainer() });
  t3._onMessage({ data: { type: 'VERSION', version: 'x', precache_complete: 1 } });
  assert.equal(t3.ready(), true);
  // the updater carries one
  const up = createUpdater({ store, reload() {}, container: fakeContainer() });
  assert.equal(typeof up.offline.ready, 'function');
});

test('storageRisk: not persisted and not on the Home Screen -> at risk (iOS 7-day eviction)', async () => {
  const mk = (persisted, standalone) => createOfflineTracker({ container: fakeContainer(), env: { navigator: { storage: { persisted: async () => persisted }, standalone }, matchMedia: () => ({ matches: false }) } });
  assert.deepEqual(await mk(false, false).storageRisk(), { persisted: false, standalone: false, atRisk: true });
  assert.deepEqual(await mk(true, false).storageRisk(), { persisted: true, standalone: false, atRisk: false });
  assert.deepEqual(await mk(false, true).storageRisk(), { persisted: false, standalone: true, atRisk: false });
});

test('runtimeAsset: cached() via caches.match, download() streams with progress, offline is a code', async () => {
  const chunks = [new Uint8Array(10), new Uint8Array(5)];
  const env = {
    location: { href: 'http://127.0.0.1/golf-swing-lab/' },
    navigator: { onLine: true },
    caches: { match: async (u) => (u.endsWith('heavy.task') ? null : {}) },
    fetch: async () => ({ ok: true, headers: { get: () => '15' }, body: { getReader: () => { let i = 0; return { read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }) }; } } }),
  };
  const a = runtimeAsset('models/pose_landmarker_heavy.task', { env });
  assert.equal(a.url, 'http://127.0.0.1/golf-swing-lab/models/pose_landmarker_heavy.task');
  assert.equal(await a.cached(), false);
  const prog = [];
  assert.deepEqual(await a.download({ onProgress: (g, t) => prog.push([g, t]) }), { ok: true, bytes: 15 });
  assert.deepEqual(prog, [[10, 15], [15, 15]]);
  const off = runtimeAsset('models/pose_landmarker_heavy.task', { env: { ...env, navigator: { onLine: false } } });
  assert.deepEqual(await off.download(), { ok: false, bytes: 0, code: 'OFFLINE' });
  const bad = runtimeAsset('x.task', { env: { ...env, fetch: async () => ({ ok: false }) } });
  assert.equal((await bad.download()).code, 'DOWNLOAD_FAILED');
});

test('crash log: logEvent keeps the last 200 { at, kind, code, where, screen, detail }; reset clears it; never throws', () => {
  reset();
  assert.deepEqual(events(), []);
  for (let i = 0; i < EVENTS_MAX + 15; i++) logEvent({ code: 'ANALYSIS_TIMEOUT', where: `w${i}`, detail: 'x'.repeat(900), at: `2026-11-05T00:00:${String(i % 60).padStart(2, '0')}Z` });
  const ev = events();
  assert.equal(ev.length, EVENTS_MAX);
  assert.equal(ev[0].where, 'w15');
  assert.equal(ev.at(-1).detail.length, 500);
  assert.equal(ev.at(-1).kind, 'error');
  assert.equal(logEvent({ kind: 'nope', code: 'X' }).kind, 'error');
  assert.equal(logEvent({ kind: 'warn' }).code, 'INTERNAL');
  assert.doesNotThrow(() => logEvent(null ?? undefined));
  clearEvents();
  assert.deepEqual(events(), []);
});

test('report carries events[] and offline; summary rows have ids, icons and ok states', async () => {
  reset();
  logEvent({ code: 'WORKER_CRASHED', where: 'global' });
  record('gum', { actual_fps: 60, width: 1280, height: 720 });
  record('offline.progress', { done: 5, total: 10, bytes: 1, ready: false });
  const env = { navigator: { userAgent: 'x', storage: { persisted: async () => false, estimate: async () => ({ usage: 1e6, quota: 3e9 }) } }, fetch: async () => ({ ok: false }), matchMedia: () => ({ matches: false }), setTimeout, clearTimeout };
  const rep = await buildReport({ env });
  assert.equal(rep.events.length, 1);
  assert.equal(rep.events[0].code, 'WORKER_CRASHED');
  assert.deepEqual(rep.offline, { ready: false, done: 5, total: 10 });
  const rows = summarize(rep);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.ok(rows.every((r) => typeof r.icon === 'string' && 'value' in r && (r.ok === null || typeof r.ok === 'boolean')));
  assert.equal(by.camera_fps.value, 60);
  assert.equal(by.camera_size.ok, true);
  assert.equal(by.errors.value, 1);
  assert.equal(by.errors.ok, false);
  assert.equal(by.persisted.ok, false);
  assert.equal(by.storage.ok, true);
  reset();
});

test('R9 helpers: isTruncated compares the sample table with the file size; captureFpsHint from slow-motion edits', () => {
  assert.equal(isTruncated({ file_bytes: 3e6, table_end_bytes: 8e6 }), true);
  assert.equal(isTruncated({ file_bytes: 8e6, table_end_bytes: 8e6 }), false);
  assert.equal(isTruncated({}), false);
  assert.equal(captureFpsHintOf([{ segment_s: 1, media_s: 1, rate: 1 }], 30), null);
  assert.equal(captureFpsHintOf([{ segment_s: 0.5, media_s: 0.5, rate: 1 }, { segment_s: 8, media_s: 1, rate: 1 }], 30), 240);
  assert.equal(captureFpsHintOf([{ segment_s: 1, media_s: NaN, rate: 0.125 }], 30), 240);
  assert.equal(captureFpsHintOf(null, 30), null);
});

test('softwareRenderer: SwiftShader / llvmpipe are software (CPU delegate); a phone GPU is not', () => {
  const env = (name) => ({ OffscreenCanvas: class { getContext() { return { getExtension: (n) => (n === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 1 } : null), getParameter: () => name, RENDERER: 2 }; } } });
  assert.match(softwareRenderer(env('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)')), /SwiftShader/);
  assert.match(softwareRenderer(env('llvmpipe (LLVM 15.0.7, 256 bits)')), /llvmpipe/);
  assert.equal(softwareRenderer(env('Apple GPU')), null);
  assert.equal(softwareRenderer({}), null);
  assert.equal(softwareRenderer({ OffscreenCanvas: class { getContext() { return null; } } }), null);
});
