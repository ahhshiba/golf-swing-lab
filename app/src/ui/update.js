// ui/update.js — P8 service-worker update flow: banner 「有新版本，點此更新」, never reload during practice.
//
//   createUpdater({ store, reload, canApply? }) -> { attach(registration, serviceWorkerContainer), request(),
//                                                     onControllerChange() }
// request(): the user tapped the banner. Outside a session: tell the waiting worker to activate (SKIP_WAITING),
// then reload on controllerchange. During a session: remember (updatePending) and do it when the session ends.
//
//   createOfflineTracker({ container?, store?, env? }) -> app.offline (PRODUCT-SPEC §8.0.4, R11 / PF-1):
//     { ready() -> boolean, progress() -> { done, total, bytes }, onProgress(fn) -> off, refresh(),
//       storageRisk() -> Promise<{ persisted, standalone, atRisk }> }
//   It listens to the service worker's PRECACHE_PROGRESS / PRECACHE_DONE / PRECACHE_STATUS / VERSION messages
//   (app/sw.template.js) and asks with GET_PRECACHE once a worker is active. ready() = every precached file is in the
//   caches. atRisk = storage not persisted and not a home-screen app (iOS may evict the data after 7 days unused).
//   The updater makes one (updater.offline); offlineTracker() returns the last one made (e2e reads it by module URL).
//   state.offline mirrors it ({ ready, done, total, bytes }) when a store is given; diag offline.* records it.

import { canApplyUpdate } from '../state.js';

let lastTracker = null;
/** The most recent tracker (null before the updater ran). */
export function offlineTracker() { return lastTracker; }

export function createOfflineTracker({ container, store = null, env = globalThis, record = null } = {}) {
  const sw = container ?? env.navigator?.serviceWorker ?? null;
  let prog = { done: 0, total: 0, bytes: 0 };
  let complete = false;
  const listeners = new Set();
  const rec = (p, v) => { try { record?.(p, v); } catch (_) { /* best effort */ } };
  const publish = () => {
    const snap = { ...prog, ready: complete };
    try { store?.set({ offline: snap }); } catch (_) { /* ignore */ }
    rec('offline.progress', snap);
    for (const fn of [...listeners]) { try { fn({ ...prog }, complete); } catch (_) { /* UI */ } }
  };
  const onMsg = (ev) => {
    const d = ev && ev.data;
    if (!d || typeof d.type !== 'string') return;
    const num = (x, dflt) => (Number.isFinite(x) ? x : dflt);
    if (d.type === 'PRECACHE_PROGRESS' || d.type === 'PRECACHE_DONE' || d.type === 'PRECACHE_STATUS') {
      prog = { done: num(d.done, prog.done), total: num(d.total, prog.total), bytes: num(d.bytes, prog.bytes) };
      if (d.type === 'PRECACHE_DONE' || (d.type === 'PRECACHE_STATUS' && d.complete === true)) complete = prog.total > 0 && prog.done >= prog.total;
      else if (d.type === 'PRECACHE_STATUS' && d.complete === false) complete = false;
      if (complete) rec('offline.ready_at', new Date().toISOString());
      publish();
    } else if (d.type === 'VERSION' && d.precache_complete === 1 && !complete) {
      complete = true; // every precached file is in the caches (counted by the worker)
      publish();
    }
  };
  try { sw?.addEventListener?.('message', onMsg); } catch (_) { /* no service worker */ }
  const t = {
    ready: () => complete,
    progress: () => ({ ...prog }),
    onProgress(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Ask the active worker for its cache count (PRECACHE_STATUS answers). */
    refresh(registration) {
      try {
        const w = sw?.controller ?? registration?.active ?? null;
        w?.postMessage?.({ type: 'GET_PRECACHE' });
      } catch (_) { /* ignore */ }
    },
    async storageRisk() {
      let persisted = null;
      try { persisted = env.navigator?.storage?.persisted ? Boolean(await env.navigator.storage.persisted()) : null; } catch (_) { persisted = null; }
      let standalone = false;
      try { standalone = Boolean(env.matchMedia?.('(display-mode: standalone)').matches || env.navigator?.standalone); } catch (_) { standalone = false; }
      return { persisted, standalone, atRisk: persisted !== true && !standalone };
    },
    _onMessage: onMsg,
  };
  lastTracker = t;
  return t;
}

export function createUpdater({ store, reload, canApply = canApplyUpdate, container, record }) {
  let reg = null;
  const offline = createOfflineTracker({ container, store, record });
  let requested = false;
  let reloading = false;

  function waitingWorker() { return reg?.waiting ?? null; }

  function markAvailable() { store.set({ updateAvailable: true }); }

  function activate() {
    const w = waitingWorker();
    requested = true;
    if (w) w.postMessage({ type: 'SKIP_WAITING' });
    else doReload();
  }

  function doReload() {
    if (reloading) return;
    if (!canApply(store.get())) { store.set({ updatePending: true }); return; }
    reloading = true;
    reload();
  }

  const api = {
    offline,
    attach(registration, container) {
      reg = registration;
      if (!reg) return;
      // offline readiness: ask once the worker is active (a first install answers with PRECACHE_PROGRESS anyway)
      const askPrecache = () => offline.refresh(reg);
      if (reg.active) askPrecache();
      container?.addEventListener?.('controllerchange', askPrecache);
      reg.installing?.addEventListener?.('statechange', (e) => { if (e?.target?.state === 'activated') askPrecache(); });
      if (reg.waiting && container?.controller) markAvailable();
      reg.addEventListener?.('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener?.('statechange', () => {
          if (nw.state === 'installed' && container?.controller) markAvailable();
        });
      });
      container?.addEventListener?.('controllerchange', () => api.onControllerChange());
    },
    request() {
      if (!canApply(store.get())) {
        store.set({ updatePending: true });
        return 'deferred';
      }
      activate();
      return 'applying';
    },
    onControllerChange() {
      if (requested) doReload();
    },
    /** Call when a session ends: apply an update the user asked for during practice. */
    sessionEnded() {
      const s = store.get();
      if (s.updatePending && canApply(s)) { store.set({ updatePending: false }); activate(); }
    },
  };
  return api;
}

// ---- on-demand runtime assets (R10): the heavy pose model is not precached (+30.7 MB); Developer offers a download ----
//   runtimeAsset(path, { env? }) -> { url, cached() -> Promise<boolean>, download({ onProgress?(got, total), signal? })
//                                     -> Promise<{ ok, bytes, code? }> }
//   download() fetches through the service worker, which keeps the file in gsl-assets (sw.template.js fromAssets), so
//   it is there offline afterwards. code: 'OFFLINE' (no network and not cached) | 'DOWNLOAD_FAILED'.
export const HEAVY_POSE_MODEL = 'models/pose_landmarker_heavy.task';

export function runtimeAsset(path, { env = globalThis } = {}) {
  const base = env.location?.href;
  const url = base ? new URL(path, base).href : path;
  return {
    url,
    async cached() {
      try {
        if (!env.caches) return false;
        const hit = await env.caches.match(url, { ignoreSearch: true });
        return Boolean(hit);
      } catch (_) {
        return false;
      }
    },
    async download({ onProgress, signal } = {}) {
      try {
        if (env.navigator?.onLine === false && !(await this.cached())) return { ok: false, bytes: 0, code: 'OFFLINE' };
        const res = await env.fetch(url, { signal });
        if (!res.ok) return { ok: false, bytes: 0, code: 'DOWNLOAD_FAILED' };
        const total = Number(res.headers?.get?.('content-length')) || null;
        let got = 0;
        if (res.body && typeof res.body.getReader === 'function') {
          const reader = res.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            got += value.byteLength;
            try { onProgress?.(got, total); } catch (_) { /* UI */ }
          }
        } else {
          got = (await res.arrayBuffer()).byteLength;
          try { onProgress?.(got, total); } catch (_) { /* UI */ }
        }
        return { ok: true, bytes: got };
      } catch (e) {
        return { ok: false, bytes: 0, code: e?.name === 'AbortError' ? 'CANCELLED' : (env.navigator?.onLine === false ? 'OFFLINE' : 'DOWNLOAD_FAILED') };
      }
    },
  };
}
