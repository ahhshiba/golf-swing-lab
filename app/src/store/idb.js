// store/idb.js — IndexedDB backend (browser only; same contract as mem.js, see the header of core.js).
// Nothing here touches a browser global at import time: indexedDB / IDBKeyRange are looked up inside open() and
// the helpers, or injected through the options (so a test can pass a fake). Written against the standard API only.
//
// Notes:
//  * Stores/indexes that are declared but missing are created; nothing is ever deleted on upgrade.
//  * transaction(): fn(tx) must only await tx.* calls (an IndexedDB transaction commits as soon as it is idle).
//    A throw or rejection in fn aborts the transaction, so nothing is written.
//  * Clips keep their Blob as is (structured clone), PoseSeq typed arrays too.

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

// options: { name = 'golf-swing-lab', factory = indexedDB, keyRange = IDBKeyRange }
export function idbBackend({ name = 'golf-swing-lab', factory, keyRange } = {}) {
  let db = null;
  const getFactory = () => factory ?? globalThis.indexedDB;
  const getKeyRange = () => keyRange ?? globalThis.IDBKeyRange;

  return {
    name,
    kind: 'idb',

    open({ version, stores, migrate }) {
      return new Promise((resolve, reject) => {
        const f = getFactory();
        if (!f) {
          reject(new StoreError('UNSUPPORTED', '這個瀏覽器不支援 IndexedDB，沒辦法在手機上儲存資料'));
          return;
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
          db = req.result;
          db.onversionchange = () => { db.close(); db = null; }; // let another tab upgrade
          resolve({ oldVersion, version });
        };
        req.onerror = () => reject(upgradeError ?? req.error);
      });
    },

    transaction(names, mode, fn) {
      return new Promise((resolve, reject) => {
        if (!db) {
          reject(new StoreError('CLOSED', '資料庫已關閉（可能被另一個分頁升級），請重新整理頁面'));
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
        tx.onabort = () => reject(failure ?? tx.error ?? new StoreError('BACKEND', '交易被中止'));
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
    },
  };
}
