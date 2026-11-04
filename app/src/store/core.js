// store/core.js — Repository over a pluggable async backend. Pure: no globals, no timers, no randomness.
//
// Stores (primary key in brackets) and their indexes (index name -> key path):
//   venues[venue_id]   name, created_at
//   presets[preset_id] venue_id, view, created_at
//   sessions[session_id] venue_id, created_at
//   shots[shot_id]     session_id, preset_id, venue_id, view (capture.view), club_type (club.type), created_at
//   poses[shot_id]     session_id, created_at           (PoseSeq typed arrays are stored as they are)
//   clips[clip_id]     shot_id, session_id, created_at  (raw video as a Blob in field `blob`)
//   labels[shot_id]    labelled_at                      (v2, P14 owner annotation: { shot_id, events, labelled_at,
//                                                         source: 'owner', revision }; see store/labels.js)
//   models[slot]       imported_at                      (v2, P9 event-model slots 'active' / 'previous': imported
//                                                         json + bin bytes; see session/models.js)
// Records are plain JSON-like objects; the repository never adds or changes fields (export -> import must be exact).
//
// Backend contract (async; see mem.js and idb.js):
//   open({ version, stores, migrate }) -> { oldVersion, version }
//       creates missing stores/indexes (never deletes), then calls migrate(oldVersion, version, tx) when the
//       stored version is lower than `version`; a throw rolls the whole upgrade back.
//   transaction(storeNames, 'readonly'|'readwrite', fn) -> Promise of fn's result; all-or-nothing for readwrite.
//       fn(tx) receives tx = { get, put, delete, getAll, getAllByIndex, clear } (all async, store name first).
//       Inside fn use ONLY tx (an IndexedDB transaction dies if fn awaits anything else) and never call the
//       repository again (the in-memory backend runs transactions one at a time).
//   close()
//
// Reads return clones: mutating a returned record never changes the stored one.

export const DB_NAME = 'golf-swing-lab';
export const SCHEMA_VERSION = 2;

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v !== null && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}

export const STORE_DEFS = deepFreeze({
  venues: { keyPath: 'venue_id', indexes: { name: 'name', created_at: 'created_at' } },
  presets: { keyPath: 'preset_id', indexes: { venue_id: 'venue_id', view: 'view', created_at: 'created_at' } },
  sessions: { keyPath: 'session_id', indexes: { venue_id: 'venue_id', created_at: 'created_at' } },
  shots: {
    keyPath: 'shot_id',
    indexes: {
      session_id: 'session_id',
      preset_id: 'preset_id',
      venue_id: 'venue_id',
      view: 'capture.view',
      club_type: 'club.type',
      created_at: 'created_at',
    },
  },
  poses: { keyPath: 'shot_id', indexes: { session_id: 'session_id', created_at: 'created_at' } },
  clips: { keyPath: 'clip_id', indexes: { shot_id: 'shot_id', session_id: 'session_id', created_at: 'created_at' } },
  // v2 (additive): owner labels (P14) and imported event models (P9)
  labels: { keyPath: 'shot_id', indexes: { labelled_at: 'labelled_at' } },
  models: { keyPath: 'slot', indexes: { imported_at: 'imported_at' } },
});

/** The stores of schema version 1 (tests open an old database with exactly these). */
export const V1_STORE_NAMES = Object.freeze(['venues', 'presets', 'sessions', 'shots', 'poses', 'clips']);

export const STORE_NAMES = Object.freeze(Object.keys(STORE_DEFS));

// Data migrations, applied in version order when a database older than SCHEMA_VERSION is opened:
//   { version: 2, up: async (tx, { oldVersion, newVersion }) => { ... } }   (tx as in the backend contract)
// v1 -> v2: only new, empty stores (labels, models); the backend creates them before migrate() runs and every v1
// record stays as it is, so the step has no data to move. It is listed so the upgrade path is explicit.
export const MIGRATIONS = Object.freeze([
  Object.freeze({ version: 2, up: async () => { /* additive: labels + models stores are created empty */ } }),
]);

// ---------------------------------------------------------------------------------------------- errors

// code: VERSION_NEWER | UNSUPPORTED | CLOSED | BAD_STORE | BAD_RECORD | BAD_QUERY | READONLY | BACKEND
// `message` is Traditional Chinese and safe to show to the user.
export class StoreError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

// ----------------------------------------------------------------------------------------- key helpers

export function getPath(obj, path) {
  let cur = obj;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

// Keys the backends index: strings and non-NaN numbers (same subset IndexedDB accepts).
export function isValidKey(k) {
  return typeof k === 'string' || (typeof k === 'number' && !Number.isNaN(k));
}

export function compareKeys(a, b) {
  const ta = typeof a;
  const tb = typeof b;
  if (ta !== tb) return ta === 'number' ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isKeyRange(q) {
  return q !== null && typeof q === 'object' && !Array.isArray(q) &&
    ('gte' in q || 'gt' in q || 'lte' in q || 'lt' in q);
}

// A query is undefined (everything), one key, or a range { gte?, gt?, lte?, lt? }.
export function matchesQuery(key, q) {
  if (q === undefined) return true;
  if (!isKeyRange(q)) return key === q;
  if (q.gte !== undefined && !(compareKeys(key, q.gte) >= 0)) return false;
  if (q.gt !== undefined && !(compareKeys(key, q.gt) > 0)) return false;
  if (q.lte !== undefined && !(compareKeys(key, q.lte) <= 0)) return false;
  if (q.lt !== undefined && !(compareKeys(key, q.lt) < 0)) return false;
  return true;
}

function normalizeQuery(q) {
  if (q === undefined) return undefined;
  if (isKeyRange(q)) {
    for (const [k, v] of Object.entries(q)) {
      if (!['gte', 'gt', 'lte', 'lt'].includes(k) || !isValidKey(v)) {
        throw new StoreError('BAD_QUERY', `查詢範圍不正確：${k}`);
      }
    }
    return { ...q };
  }
  if (!isValidKey(q)) throw new StoreError('BAD_QUERY', '查詢值必須是字串或數字');
  return q;
}

// ---------------------------------------------------------------------------------------- shot filters

// Filter keys understood by queryShots / filterShots / exportJSON. Values for the id-like keys may be arrays
// (any-of). `from`/`to` bound created_at inclusively (ISO-8601 strings compare correctly as text).
export const SHOT_FILTER_KEYS = Object.freeze(['session_id', 'preset_id', 'venue_id', 'view', 'club_type', 'lie',
  'from', 'to', 'starred']);
const SHOT_QUERY_EXTRA_KEYS = ['limit', 'reverse'];

export function assertShotFilter(filter) {
  const f = filter ?? {};
  if (typeof f !== 'object' || Array.isArray(f)) throw new StoreError('BAD_QUERY', '篩選條件必須是物件');
  for (const k of Object.keys(f)) {
    if (!SHOT_FILTER_KEYS.includes(k) && !SHOT_QUERY_EXTRA_KEYS.includes(k)) {
      throw new StoreError('BAD_QUERY', `不認得的篩選條件：${k}`);
    }
  }
  return f;
}

function anyOf(want, have) {
  if (want === undefined || want === null) return true;
  return Array.isArray(want) ? want.includes(have) : want === have;
}

export function matchesShotFilter(shot, f) {
  if (!anyOf(f.session_id, shot.session_id)) return false;
  if (!anyOf(f.preset_id, shot.preset_id)) return false;
  if (!anyOf(f.venue_id, shot.venue_id)) return false;
  if (!anyOf(f.view, getPath(shot, 'capture.view'))) return false;
  if (!anyOf(f.club_type, getPath(shot, 'club.type'))) return false;
  if (!anyOf(f.lie, getPath(shot, 'club.lie'))) return false;
  if (f.starred !== undefined && f.starred !== null && Boolean(shot.starred) !== Boolean(f.starred)) return false;
  if ((f.from !== undefined && f.from !== null) || (f.to !== undefined && f.to !== null)) {
    const t = shot.created_at;
    if (!isValidKey(t)) return false;
    if (f.from !== undefined && f.from !== null && compareKeys(t, f.from) < 0) return false;
    if (f.to !== undefined && f.to !== null && compareKeys(t, f.to) > 0) return false;
  }
  return true;
}

// Chronological order, ties by shot_id (a total order, so results do not depend on the index used).
export function sortShots(shots) {
  return shots.slice().sort((a, b) =>
    compareKeys(a.created_at ?? '', b.created_at ?? '') || compareKeys(a.shot_id ?? '', b.shot_id ?? ''));
}

// Pure filter + sort (+ limit/reverse) over an array of shots.
export function filterShots(shots, filter) {
  const f = assertShotFilter(filter);
  let rows = sortShots(shots.filter((s) => matchesShotFilter(s, f)));
  if (f.reverse) rows.reverse();
  if (f.limit !== undefined && f.limit !== null) rows = rows.slice(0, f.limit);
  return rows;
}

// -------------------------------------------------------------------------------------------- revisions

export function revisionOf(rec) {
  return rec && Number.isFinite(rec.revision) ? rec.revision : 0;
}

// ------------------------------------------------------------------------------------------ repository

const INDEXED_FILTERS = [
  ['session_id', 'session_id'],
  ['preset_id', 'preset_id'],
  ['venue_id', 'venue_id'],
  ['view', 'view'],
  ['club_type', 'club_type'],
];

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export class Repository {
  constructor(backend, { stores = STORE_DEFS, version = SCHEMA_VERSION, oldVersion = 0 } = {}) {
    this._backend = backend;
    this.stores = stores;
    this.schemaVersion = version;
    this.openedFromVersion = oldVersion;
    // Per-store shortcuts: repo.shots.get(id), repo.shots.put(rec), repo.shots.list({ index, query }) ...
    for (const name of Object.keys(stores)) {
      this[name] = {
        get: (id) => this.get(name, id),
        put: (rec) => this.put(name, rec),
        putMany: (recs) => this.putMany(name, recs),
        delete: (id) => this.delete(name, id),
        list: (opts) => this.list(name, opts),
        count: () => this.count(name),
      };
    }
  }

  _def(store) {
    if (typeof store !== 'string' || !has(this.stores, store)) {
      throw new StoreError('BAD_STORE', `沒有這個儲存區：${String(store)}`);
    }
    return this.stores[store];
  }

  _key(store, rec) {
    const def = this._def(store);
    if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) {
      throw new StoreError('BAD_RECORD', `${store}：資料必須是物件`);
    }
    const key = getPath(rec, def.keyPath);
    if (typeof key !== 'string' || key === '') {
      throw new StoreError('BAD_RECORD', `${store}：缺少 ${def.keyPath}（必須是非空字串）`);
    }
    return key;
  }

  _wrapTx(raw, names, writable) {
    const use = (s) => {
      this._def(s);
      if (!names.includes(s)) throw new StoreError('BAD_STORE', `這個交易沒有包含儲存區：${s}`);
    };
    const write = () => {
      if (!writable) throw new StoreError('READONLY', '唯讀交易不能寫入');
    };
    return {
      get: async (s, id) => { use(s); return (await raw.get(s, id)) ?? null; },
      put: async (s, rec) => { use(s); write(); const key = this._key(s, rec); await raw.put(s, rec); return key; },
      delete: async (s, id) => { use(s); write(); await raw.delete(s, id); },
      getAll: async (s) => { use(s); return raw.getAll(s); },
      getAllByIndex: async (s, index, q) => {
        use(s);
        if (!has(this.stores[s].indexes, index)) throw new StoreError('BAD_QUERY', `${s} 沒有索引 ${index}`);
        return raw.getAllByIndex(s, index, normalizeQuery(q));
      },
      clear: async (s) => { use(s); write(); await raw.clear(s); },
    };
  }

  // Run fn(tx) in one transaction. readwrite is all-or-nothing: if fn throws or rejects, nothing is written.
  async transaction(storeNames, mode, fn) {
    const names = [...new Set(storeNames)];
    names.forEach((n) => this._def(n));
    if (mode !== 'readonly' && mode !== 'readwrite') throw new StoreError('BAD_QUERY', `不認得的交易模式：${mode}`);
    return this._backend.transaction(names, mode, (raw) => fn(this._wrapTx(raw, names, mode === 'readwrite')));
  }

  async get(store, id) {
    this._def(store);
    return this.transaction([store], 'readonly', (tx) => tx.get(store, id));
  }

  // Returns the stored key. Replaces any record with the same key; see merge() for revision-aware writes.
  async put(store, rec) {
    return this.transaction([store], 'readwrite', (tx) => tx.put(store, rec));
  }

  async putMany(store, recs) {
    return this.batch(recs.map((record) => ({ op: 'put', store, record })));
  }

  async delete(store, id) {
    this._def(store);
    return this.transaction([store], 'readwrite', (tx) => tx.delete(store, id));
  }

  // opts: { index, query, limit, reverse }. Without an index: key order. With an index: index-key order, then key.
  async list(store, { index, query, limit, reverse } = {}) {
    const def = this._def(store);
    if (index === undefined && query !== undefined) throw new StoreError('BAD_QUERY', '指定查詢值時必須指定索引');
    if (index !== undefined && !has(def.indexes, index)) throw new StoreError('BAD_QUERY', `${store} 沒有索引 ${index}`);
    const rows = await this.transaction([store], 'readonly', (tx) =>
      index === undefined ? tx.getAll(store) : tx.getAllByIndex(store, index, query));
    if (reverse) rows.reverse();
    return limit === undefined || limit === null ? rows : rows.slice(0, limit);
  }

  async count(store) {
    return (await this.list(store)).length;
  }

  // clear('shots') or clear() for every store.
  async clear(store) {
    const names = store === undefined ? Object.keys(this.stores) : [store];
    return this.transaction(names, 'readwrite', async (tx) => {
      for (const n of names) await tx.clear(n);
    });
  }

  // ops: [{ op: 'put', store, record } | { op: 'delete', store, id }], applied in order, all or nothing.
  async batch(ops) {
    for (const o of ops) {
      if (o.op === 'put') this._key(o.store, o.record);
      else if (o.op === 'delete') this._def(o.store);
      else throw new StoreError('BAD_QUERY', `不認得的操作：${String(o.op)}`);
    }
    const names = [...new Set(ops.map((o) => o.store))];
    if (names.length === 0) return 0;
    await this.transaction(names, 'readwrite', async (tx) => {
      await Promise.all(ops.map((o) => (o.op === 'put' ? tx.put(o.store, o.record) : tx.delete(o.store, o.id))));
    });
    return ops.length;
  }

  // Consistent read of whole stores: { venues: [...], ... } from one readonly transaction.
  async snapshot(storeNames) {
    return this.transaction(storeNames, 'readonly', async (tx) => {
      const out = {};
      for (const n of storeNames) out[n] = await tx.getAll(n);
      return out;
    });
  }

  // Revision-aware write of many records, in one transaction. byStore: { shots: [rec, ...], ... }.
  // Rule per record (matched by primary key): absent -> added; incoming revision > stored revision -> updated;
  // otherwise (equal or lower) the stored record is kept. A missing `revision` counts as 0.
  // Returns { shots: { added, updated, kept }, ... }.
  async merge(byStore) {
    const names = Object.keys(byStore);
    for (const n of names) for (const rec of byStore[n]) this._key(n, rec);
    return this.transaction(names, 'readwrite', async (tx) => {
      const counts = {};
      for (const n of names) {
        const c = { added: 0, updated: 0, kept: 0 };
        const keyPath = this.stores[n].keyPath;
        for (const rec of byStore[n]) {
          const cur = await tx.get(n, getPath(rec, keyPath));
          if (cur === null) { await tx.put(n, rec); c.added++; }
          else if (revisionOf(rec) > revisionOf(cur)) { await tx.put(n, rec); c.updated++; }
          else c.kept++;
        }
        counts[n] = c;
      }
      return counts;
    });
  }

  // Shots matching `filter` (see SHOT_FILTER_KEYS), chronological, using an index for the first selective key.
  async queryShots(filter = {}) {
    const f = assertShotFilter(filter);
    const scalar = (v) => typeof v === 'string' || typeof v === 'number';
    const pick = INDEXED_FILTERS.find(([key]) => scalar(f[key]));
    let rows;
    if (pick) rows = await this.list('shots', { index: pick[1], query: f[pick[0]] });
    else if (scalar(f.from) || scalar(f.to)) {
      const range = {};
      if (scalar(f.from)) range.gte = f.from;
      if (scalar(f.to)) range.lte = f.to;
      rows = await this.list('shots', { index: 'created_at', query: range });
    } else rows = await this.list('shots');
    return filterShots(rows, f);
  }

  // Deletes a shot together with its pose sequence and clips, atomically. Returns what existed.
  async deleteShot(shotId) {
    return this.transaction(['shots', 'poses', 'clips'], 'readwrite', async (tx) => {
      const out = { shot: false, pose: false, clips: 0 };
      if ((await tx.get('shots', shotId)) !== null) { out.shot = true; await tx.delete('shots', shotId); }
      if ((await tx.get('poses', shotId)) !== null) { out.pose = true; await tx.delete('poses', shotId); }
      for (const clip of await tx.getAllByIndex('clips', 'shot_id', shotId)) {
        await tx.delete('clips', clip.clip_id);
        out.clips++;
      }
      return out;
    });
  }

  async close() {
    await this._backend.close();
  }
}

// A clip record for the `clips` store. `blob` is a Blob (anything with a numeric `size` works in tests).
// kind 'raw' = the recorded video; quota.js deletes only unstarred raw clips.
export function makeClipRecord({ clip_id, shot_id, session_id, created_at, blob, mime, starred = false, kind = 'raw' }) {
  const bytes = blob && Number.isFinite(blob.size) ? blob.size : (blob && Number.isFinite(blob.byteLength) ? blob.byteLength : 0);
  return { clip_id, shot_id, session_id, created_at, kind, mime: mime ?? (blob && blob.type) ?? '', bytes, starred: Boolean(starred), blob };
}

function toStoreError(e) {
  if (e instanceof StoreError) return e;
  if (e && e.name === 'VersionError') {
    return new StoreError('VERSION_NEWER', '本機資料庫版本比這個 App 新，請先更新 App（資料不會被改動）', e);
  }
  return new StoreError('BACKEND', `本機儲存空間開啟失敗：${(e && e.message) || String(e)}`, e);
}

// Opens `backend` with the current schema and returns a Repository.
// opts (for tests and future versions): { version, stores, migrations }.
export async function openRepository(backend, opts = {}) {
  const version = opts.version ?? SCHEMA_VERSION;
  const stores = opts.stores ?? STORE_DEFS;
  const migrations = [...(opts.migrations ?? MIGRATIONS)].sort((a, b) => a.version - b.version);
  const migrate = async (oldVersion, newVersion, tx) => {
    if (oldVersion === 0) return; // fresh database: nothing to migrate
    for (const m of migrations) {
      if (m.version > oldVersion && m.version <= newVersion) await m.up(tx, { oldVersion, newVersion });
    }
  };
  let info;
  try {
    info = await backend.open({ version, stores, migrate });
  } catch (e) {
    throw toStoreError(e);
  }
  return new Repository(backend, { stores, version, oldVersion: info ? info.oldVersion : 0 });
}
