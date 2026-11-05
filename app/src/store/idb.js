// store/idb.js — IndexedDB backend (browser only; same contract as mem.js, see the header of core.js).
// Nothing here touches a browser global at import time: indexedDB / IDBKeyRange are looked up inside open() and
// the helpers, or injected through the options (so a test can pass a fake). Written against the standard API only.
//
// Notes:
//  * Stores/indexes that are declared but missing are created; nothing is ever deleted on upgrade.
//  * transaction(): fn(tx) must only await tx.* calls (an IndexedDB transaction commits as soon as it is idle).
//    A throw or rejection in fn aborts the transaction, so nothing is written.
//  * Clips keep their Blob as is (structured clone), PoseSeq typed arrays too.
//  * open() gives up after openTimeoutMs (default 5000) when indexedDB.open neither succeeds nor fails (R3: a stuck
//    WebKit IndexedDB would otherwise leave the app on 「載入中…」 for ever): StoreError REPO_UNAVAILABLE, and a late
//    success is closed again. `blocked` (another tab holds an older version open) waits inside the same budget.
//  * now() -> ms (Date.now): the repository's clock for soft-delete times (core.js itself reads no clock).
//  * A QuotaExceededError of a transaction is passed on as it is (core.js isQuotaError / saveShot retry without clip).

import { StoreError, isKeyRange } from './core.js';

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Plain key -> itself; { gte, gt, lte, lt } -> IDBKeyRange.
function toQuery(q, getKeyRange) {
  if (!isKeyRange(q)) return q;
  const KeyRange = getKeyRange();
  const lo = q.gte !== undefined ? q.gte : q.gt;
  const hi = q.lte !== undefined ? q.lte : q.lt;
  const loOpen = q.gte === undefined && q.gt !== undefined;
  const hiOpen = q.lte === undefined && q.lt !== undefined;
  if (lo !== undefined && hi !== undefined) return KeyRange.bound(lo, hi, loOpen, hiOpen);
  if (lo !== undefined) return KeyRange.lowerBound(lo, loOpen);
  return KeyRange.upperBound(hi, hiOpen);
}

function txApi(tx, getKeyRange) {
  const os = (s) => tx.objectStore(s);
  return {
    get: (s, key) => request(os(s).get(key)).then((v) => (v === undefined ? null : v)),
    put: (s, value) => request(os(s).put(value)),
    delete: (s, key) => request(os(s).delete(key)),
    getAll: (s) => request(os(s).getAll()),
    getAllByIndex: (s, index, q) => request(os(s).index(index).getAll(toQuery(q, getKeyRange))),
    clear: (s) => request(os(s).clear()),
  };
}

function ensureStores(db, tx, stores) {
  for (const [name, def] of Object.entries(stores)) {
    const store = db.objectStoreNames.contains(name)
      ? tx.objectStore(name)
      : db.createObjectStore(name, { keyPath: def.keyPath });
    for (const [indexName, keyPath] of Object.entries(def.indexes || {})) {
      if (!store.indexNames.contains(indexName)) store.createIndex(indexName, keyPath, { unique: false });
    }
  }
}

export const OPEN_TIMEOUT_MS = 5000;

// options: { name = 'golf-swing-lab', factory = indexedDB, keyRange = IDBKeyRange, openTimeoutMs = 5000, timers }
export function idbBackend({ name = 'golf-swing-lab', factory, keyRange, openTimeoutMs = OPEN_TIMEOUT_MS, timers } = {}) {
  let db = null;
  const getFactory = () => factory ?? globalThis.indexedDB;
  const getKeyRange = () => keyRange ?? globalThis.IDBKeyRange;

  return {
    name,
    kind: 'idb',
    openState: 'closed', // 'opening' | 'open' | 'timeout' | 'error' | 'closed'
    now: () => Date.now(),

    open({ version, stores, migrate }) {
      const self = this;
      return new Promise((resolveRaw, rejectRaw) => {
        const f = getFactory();
        if (!f) {
          self.openState = 'error';
          rejectRaw(new StoreError('UNSUPPORTED', 'this browser has no IndexedDB: nothing can be saved on this device'));
          return;
        }
        const T = timers ?? globalThis;
        let settled = false;
        let timer = null;
        const resolve = (v) => { if (settled) return; settled = true; if (timer) T.clearTimeout(timer); self.openState = 'open'; resolveRaw(v); };
        const reject = (e) => { if (settled) return; settled = true; if (timer) T.clearTimeout(timer); self.openState = 'error'; rejectRaw(e); };
        self.openState = 'opening';
        if (Number.isFinite(openTimeoutMs) && openTimeoutMs > 0) {
          timer = T.setTimeout(() => {
            if (settled) return;
            settled = true;
            self.openState = 'timeout';
            rejectRaw(new StoreError('REPO_UNAVAILABLE', `indexedDB.open did not settle within ${openTimeoutMs} ms`));
          }, openTimeoutMs);
        }
        let req;
        try {
          req = f.open(name, version);
        } catch (e) {
          reject(e);
          return;
        }
        let oldVersion = 0;
        let upgradeError = null;
        req.onupgradeneeded = (ev) => {
          oldVersion = ev.oldVersion;
          const tx = req.transaction;
          const abort = (e) => {
            upgradeError = e;
            try { tx.abort(); } catch (_) { /* already finished */ }
          };
          try {
            ensureStores(req.result, tx, stores);
            if (migrate) Promise.resolve(migrate(ev.oldVersion, version, txApi(tx, getKeyRange))).catch(abort);
          } catch (e) {
            abort(e);
          }
        };
        req.onsuccess = () => {
          if (settled) { try { req.result.close(); } catch (_) { /* ignore */ } return; } // too late: we gave up
          db = req.result;
          db.onversionchange = () => { db.close(); db = null; }; // let another tab upgrade
          resolve({ oldVersion, version });
        };
        req.onblocked = () => { /* another tab still has the old version open: wait (bounded by the timeout) */ };
        req.onerror = () => reject(upgradeError ?? req.error);
      });
    },

    transaction(names, mode, fn) {
      return new Promise((resolve, reject) => {
        if (!db) {
          reject(new StoreError('CLOSED', 'the database is closed (maybe upgraded by another tab): reload the page'));
          return;
        }
        let tx;
        try {
          tx = db.transaction(names, mode === 'readwrite' ? 'readwrite' : 'readonly');
        } catch (e) {
          reject(e);
          return;
        }
        let result;
        let failure = null;
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(failure ?? tx.error ?? new StoreError('BACKEND', 'transaction aborted'));
        const fail = (e) => {
          failure = e;
          try { tx.abort(); } catch (_) { /* already finished */ }
        };
        try {
          Promise.resolve(fn(txApi(tx, getKeyRange))).then((r) => { result = r; }, fail);
        } catch (e) {
          fail(e);
        }
      });
    },

    async close() {
      if (db) db.close();
      db = null;
      this.openState = 'closed';
    },
  };
}
