// ui/update.js — P8 service-worker update flow: banner 「有新版本，點此更新」, never reload during practice.
//
//   createUpdater({ store, reload, canApply? }) -> { attach(registration, serviceWorkerContainer), request(),
//                                                     onControllerChange() }
// request(): the user tapped the banner. Outside a session: tell the waiting worker to activate (SKIP_WAITING),
// then reload on controllerchange. During a session: remember (updatePending) and do it when the session ends.

import { canApplyUpdate } from '../state.js';

export function createUpdater({ store, reload, canApply = canApplyUpdate }) {
  let reg = null;
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
    attach(registration, container) {
      reg = registration;
      if (!reg) return;
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
