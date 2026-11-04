// store/mem.js — in-memory backend for Node tests (same contract as idb.js; see core.js header).
// Values are structured-cloned on the way in and out, like IndexedDB. Transactions run one at a time; a readwrite
// transaction works on a staged copy that replaces the real data only if fn succeeds (rollback on throw).
// close() keeps the data, so a test can reopen the same instance with a higher version to exercise migrations.

import { StoreError, getPath, isValidKey, compareKeys, matchesQuery } from './core.js';

function clone(v) {
  try {
    return structuredClone(v);
  } catch (e) {
    throw new StoreError('BAD_RECORD', `資料無法儲存：${e.message}`, e);
  }
}

const noop = () => {};

export class MemBackend {
  constructor({ name = 'mem' } = {}) {
    this.name = name;
    this.kind = 'mem';
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
        throw new StoreError('VERSION_NEWER', `本機資料庫版本（${this._version}）比這個 App（${version}）新，請先更新 App`);
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
      if (!this._open) throw new StoreError('CLOSED', '資料庫尚未開啟或已關閉');
      const staged = new Map();
      for (const n of names) {
        if (!this._defs[n]) throw new StoreError('BAD_STORE', `沒有這個儲存區：${n}`);
        staged.set(n, new Map(this._data.get(n)));
      }
      const writable = mode === 'readwrite';
      const state = { active: true };
      try {
        const out = await fn(this._txApi(staged, this._defs, writable, state));
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

  _txApi(staged, defs, writable, state) {
    const live = (s) => {
      if (!state.active) throw new StoreError('CLOSED', '交易已結束，不能再使用');
      const m = staged.get(s);
      if (!m) throw new StoreError('BAD_STORE', `這個交易沒有包含儲存區：${s}`);
      return m;
    };
    const canWrite = () => {
      if (!writable) throw new StoreError('READONLY', '唯讀交易不能寫入');
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
        if (!isValidKey(key)) throw new StoreError('BAD_RECORD', `${s}：主鍵 ${defs[s].keyPath} 不正確`);
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
        if (!path) throw new StoreError('BAD_QUERY', `${s} 沒有索引 ${index}`);
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
