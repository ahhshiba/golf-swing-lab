// store/mem.js — in-memory backend for Node tests (same contract as idb.js; see core.js header).
// Values are structured-cloned on the way in and out, like IndexedDB. Transactions run one at a time; a readwrite
// transaction works on a staged copy that replaces the real data only if fn succeeds (rollback on throw).
// close() keeps the data, so a test can reopen the same instance with a higher version to exercise migrations.
// quotaBytes (optional) simulates a full disk: a readwrite transaction whose result would exceed it is rolled back
// with an error named QuotaExceededError (like IndexedDB). usageBytes() = the estimated stored size (Blob sizes +
// typed-array bytes + 2 bytes per string character + 8 per number).

import { StoreError, getPath, isValidKey, compareKeys, matchesQuery } from './core.js';

function clone(v) {
  try {
    return structuredClone(v);
  } catch (e) {
    throw new StoreError('BAD_RECORD', `record cannot be stored: ${e.message}`, e);
  }
}

const noop = () => {};

/** Rough stored size of a value (see the header). */
export function sizeOf(v, seen = new Set()) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'string') return 2 * v.length;
  if (typeof v === 'number') return 8;
  if (typeof v === 'boolean') return 4;
  if (typeof v !== 'object') return 0;
  if (seen.has(v)) return 0;
  seen.add(v);
  if (ArrayBuffer.isView(v)) return v.byteLength;
  if (v instanceof ArrayBuffer) return v.byteLength;
  if (typeof v.size === 'number' && (typeof v.slice === 'function' || typeof v.type === 'string')) return v.size; // Blob / File (or a test stand-in)
  let n = 0;
  for (const k of Object.keys(v)) n += 2 * k.length + sizeOf(v[k], seen);
  return n;
}

function quotaError(need, quota) {
  const e = new Error(`QuotaExceededError: ${need} B would exceed the simulated quota of ${quota} B`);
  e.name = 'QuotaExceededError';
  return e;
}

export class MemBackend {
  constructor({ name = 'mem', quotaBytes = null } = {}) {
    this.name = name;
    this.kind = 'mem';
    this.quotaBytes = Number.isFinite(quotaBytes) ? quotaBytes : null;
    this._version = 0;
    this._defs = null;
    this._data = new Map(); // store name -> Map(primary key -> stored clone)
    this._open = false;
    this._queue = Promise.resolve();
  }

  get version() {
    return this._version;
  }

  _enqueue(task) {
    const run = this._queue.then(task);
    this._queue = run.then(noop, noop);
    return run;
  }

  open({ version, stores, migrate }) {
    return this._enqueue(async () => {
      if (this._version > version) {
        throw new StoreError('VERSION_NEWER', `the local database (version ${this._version}) is newer than this app (${version}): update the app`);
      }
      const oldVersion = this._version;
      const staged = new Map();
      for (const [name, m] of this._data) staged.set(name, new Map(m)); // keeps stores no longer declared
      for (const name of Object.keys(stores)) if (!staged.has(name)) staged.set(name, new Map());
      if (migrate && oldVersion < version) {
        const state = { active: true };
        try {
          await migrate(oldVersion, version, this._txApi(staged, stores, true, state));
        } finally {
          state.active = false;
        }
      }
      this._data = staged;
      this._defs = stores;
      this._version = version;
      this._open = true;
      return { oldVersion, version };
    });
  }

  transaction(names, mode, fn) {
    return this._enqueue(async () => {
      if (!this._open) throw new StoreError('CLOSED', 'the database is not open');
      const staged = new Map();
      for (const n of names) {
        if (!this._defs[n]) throw new StoreError('BAD_STORE', `unknown store: ${n}`);
        staged.set(n, new Map(this._data.get(n)));
      }
      const writable = mode === 'readwrite';
      const state = { active: true };
      try {
        const out = await fn(this._txApi(staged, this._defs, writable, state));
        if (writable && this.quotaBytes !== null) {
          let total = 0;
          for (const [n, m] of this._data) if (!staged.has(n)) for (const v of m.values()) total += sizeOf(v);
          for (const m of staged.values()) for (const v of m.values()) total += sizeOf(v);
          if (total > this.quotaBytes) throw quotaError(total, this.quotaBytes);
        }
        if (writable) for (const [n, m] of staged) this._data.set(n, m);
        return out;
      } finally {
        state.active = false;
      }
    });
  }

  async close() {
    await this._queue;
    this._open = false;
  }

  /** Estimated bytes stored (all stores). */
  usageBytes() {
    let total = 0;
    for (const m of this._data.values()) for (const v of m.values()) total += sizeOf(v);
    return total;
  }

  _txApi(staged, defs, writable, state) {
    const live = (s) => {
      if (!state.active) throw new StoreError('CLOSED', 'the transaction has finished');
      const m = staged.get(s);
      if (!m) throw new StoreError('BAD_STORE', `store ${s} is not part of this transaction`);
      return m;
    };
    const canWrite = () => {
      if (!writable) throw new StoreError('READONLY', 'a readonly transaction cannot write');
    };
    const sortedEntries = (m) => [...m.entries()].sort((a, b) => compareKeys(a[0], b[0]));
    return {
      get: async (s, key) => {
        const v = live(s).get(key);
        return v === undefined ? null : clone(v);
      },
      put: async (s, value) => {
        const m = live(s);
        canWrite();
        const key = getPath(value, defs[s].keyPath);
        if (!isValidKey(key)) throw new StoreError('BAD_RECORD', `${s}: bad primary key ${defs[s].keyPath}`);
        m.set(key, clone(value));
        return key;
      },
      delete: async (s, key) => {
        const m = live(s);
        canWrite();
        m.delete(key);
      },
      getAll: async (s) => sortedEntries(live(s)).map(([, v]) => clone(v)),
      getAllByIndex: async (s, index, query) => {
        const m = live(s);
        const path = defs[s].indexes && defs[s].indexes[index];
        if (!path) throw new StoreError('BAD_QUERY', `${s} has no index ${index}`);
        const rows = [];
        for (const [key, v] of m) {
          const ik = getPath(v, path);
          if (isValidKey(ik) && matchesQuery(ik, query)) rows.push([ik, key, v]);
        }
        rows.sort((a, b) => compareKeys(a[0], b[0]) || compareKeys(a[1], b[1]));
        return rows.map((r) => clone(r[2]));
      },
      clear: async (s) => {
        const m = live(s);
        canWrite();
        m.clear();
      },
    };
  }
}
