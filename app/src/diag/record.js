// diag/record.js - in-memory diagnostic store, mirrored to localStorage (try/catch everywhere).
//
//   record(path, value)    set a dotted path ('gum.actual_fps'); intermediate objects are created; value is cloned
//   increment(path, n=1)   counter helper (missing or non-number counts as 0); returns the new value
//   get(path?)             deep copy of the whole tree, or of one path (undefined when absent)
//   reset()                clear memory and the mirror
//
// The tree is hydrated once from localStorage on first use, so a report taken after a reload still has the
// numbers measured before it. Everything works without localStorage (private window, Node, blocked storage).

export const STORAGE_KEY = 'gsl.diag/1';
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

let tree = null;

function storage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function clone(v) {
  if (v === undefined) return undefined;
  if (typeof v === 'number' && !Number.isFinite(v)) return null; // JSON-safe: NaN / Infinity -> null
  if (v === null || typeof v !== 'object') return v;
  if (ArrayBuffer.isView(v)) return Array.from(v, clone);
  if (Array.isArray(v)) return v.map(clone);
  const out = {};
  for (const k of Object.keys(v)) {
    if (FORBIDDEN.has(k)) continue;
    const c = clone(v[k]);
    if (c !== undefined) out[k] = c;
  }
  return out;
}

function load() {
  if (tree) return tree;
  tree = {};
  try {
    const s = storage();
    const raw = s && s.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) tree = clone(parsed);
    }
  } catch {
    tree = {};
  }
  return tree;
}

function mirror() {
  try {
    const s = storage();
    if (s) s.setItem(STORAGE_KEY, JSON.stringify(tree));
  } catch {
    /* quota or blocked storage: memory copy is still correct */
  }
}

function parts(path) {
  if (typeof path !== 'string' || path === '') throw new TypeError('diag path must be a non-empty string');
  const p = path.split('.');
  if (p.some((s) => s === '' || FORBIDDEN.has(s))) throw new TypeError(`bad diag path '${path}'`);
  return p;
}

export function record(path, value) {
  const p = parts(path);
  const root = load();
  let node = root;
  for (let i = 0; i < p.length - 1; i++) {
    const nxt = node[p[i]];
    if (nxt === null || typeof nxt !== 'object' || Array.isArray(nxt)) node[p[i]] = {};
    node = node[p[i]];
  }
  const v = clone(value);
  if (v === undefined) delete node[p[p.length - 1]];
  else node[p[p.length - 1]] = v;
  mirror();
}

export function get(path) {
  const root = load();
  if (path === undefined) return clone(root);
  let node = root;
  for (const k of parts(path)) {
    if (node === null || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, k)) return undefined;
    node = node[k];
  }
  return clone(node);
}

export function increment(path, n = 1) {
  const cur = get(path);
  const next = (typeof cur === 'number' && Number.isFinite(cur) ? cur : 0) + n;
  record(path, next);
  return next;
}

export function reset() {
  tree = {};
  try {
    const s = storage();
    if (s) s.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
