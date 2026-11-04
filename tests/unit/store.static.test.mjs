import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REASON_CODES } from '../../app/src/contract/reason-codes.js';
import { StoreError } from '../../app/src/store/core.js';
import { openRepository } from '../../app/src/store/core.js';

const STORE = join(dirname(fileURLToPath(import.meta.url)), '../../app/src/store');
const files = readdirSync(STORE).filter((f) => f.endsWith('.js'));
const read = (f) => readFileSync(join(STORE, f), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

// Same patterns as scripts/verify.sh (static stage) plus randomness.
const FORBIDDEN_EVERYWHERE = [
  [/Math\.random/, 'Math.random'],
  [/location\.hash/, 'location.hash'],
  [/history\.(pushState|replaceState)/, 'history API'],
  [/https?:\/\//, 'hard-coded URL'],
  [/(^|[^A-Za-z0-9_$])eval\s*\(/, 'eval'],
  [/new\s+Function([^A-Za-z0-9_$]|$)/, 'new Function'],
];
// interfaces.md section 1: pure modules touch no window/document/navigator/self, timers or randomness.
const PURE = ['core.js', 'mem.js', 'compare.js', 'metric-ids.js'];
const FORBIDDEN_PURE = [
  [/window|document|navigator/, 'browser globals'],
  [/\bself\b|\bglobalThis\b/, 'global object'],
  [/setTimeout|setInterval|requestAnimationFrame|queueMicrotask/, 'timers'],
  [/indexedDB|IDBKeyRange|localStorage|sessionStorage/, 'browser storage'],
  [/\bDate\b/, 'clock'],
];

test('store sources contain none of the forbidden patterns', () => {
  assert.ok(files.length >= 8, files.join(','));
  for (const f of files) {
    const src = read(f);
    for (const [re, what] of FORBIDDEN_EVERYWHERE) assert.ok(!re.test(src), `${f}: contains ${what}`);
  }
});

test('pure modules (core, mem, compare, metric-ids) touch no browser globals, timers or the clock', () => {
  for (const f of PURE) {
    const src = read(f);
    for (const [re, what] of FORBIDDEN_PURE) assert.ok(!re.test(src), `${f}: contains ${what}`);
  }
});

test('imports are relative with an explicit .js extension', () => {
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      assert.ok(m[1].startsWith('./') || m[1].startsWith('../'), `${f}: import '${m[1]}' must be relative`);
      assert.ok(m[1].endsWith('.js'), `${f}: import '${m[1]}' needs the .js extension`);
    }
    for (const m of src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      assert.ok(m[1].startsWith('../contract/') && m[1].endsWith('.js'), `${f}: dynamic import '${m[1]}'`);
    }
  }
});

test('reason codes are used only as RC.<NAME>, never as bare strings', () => {
  const names = Object.keys(REASON_CODES);
  for (const f of files) {
    const code = stripComments(read(f));
    for (const name of names) {
      assert.ok(!new RegExp(`['"\`]${name}['"\`]`).test(code), `${f}: bare reason code ${name}`);
    }
  }
  assert.match(read('compare.js'), /RC\.PRESET_MISMATCH/);
  assert.match(read('compare.js'), /from '\.\.\/contract\/reason-codes\.js'/);
});

test('geom is used for statistics instead of re-implementing it', () => {
  assert.match(read('compare.js'), /from '\.\.\/geom\/stats\.js'/);
});

test('index.js starts with an API summary and re-exports every public name', async () => {
  const src = read('index.js');
  assert.ok(src.startsWith('//') && src.includes('API summary'));
  const idx = await import('../../app/src/store/index.js');
  for (const f of files.filter((x) => x !== 'index.js')) {
    const mod = await import(`../../app/src/store/${f}`);
    for (const name of Object.keys(mod)) assert.ok(name in idx, `${name} from ${f} missing in index.js`);
  }
});

test('idb.js has no top-level DOM/global access: importing it with trapped globals touches none of them', async () => {
  const names = ['window', 'document', 'navigator', 'self', 'indexedDB', 'IDBKeyRange', 'IDBDatabase', 'localStorage', 'sessionStorage', 'location', 'history'];
  const saved = new Map();
  const touched = [];
  for (const n of names) {
    const d = Object.getOwnPropertyDescriptor(globalThis, n);
    if (d && !d.configurable) continue; // cannot trap; none of these exist in Node 18
    saved.set(n, d);
    Object.defineProperty(globalThis, n, { configurable: true, get() { touched.push(n); return undefined; }, set() { touched.push(`set ${n}`); } });
  }
  try {
    for (const f of ['idb.js', 'index.js', 'quota.js', 'export.js']) {
      const url = `${pathToFileURL(join(STORE, f)).href}?trap=${f}`;
      const mod = await import(url);
      assert.ok(Object.keys(mod).length > 0, f);
    }
  } finally {
    for (const [n, d] of saved) {
      if (d) Object.defineProperty(globalThis, n, d); else delete globalThis[n];
    }
  }
  assert.deepEqual(touched, [], `top-level access to: ${touched.join(', ')}`);
  const idb = await import('../../app/src/store/idb.js');
  assert.equal(typeof idb.idbBackend, 'function');
  assert.doesNotThrow(() => idb.idbBackend());
});

test('without indexedDB the backend fails with a readable Chinese StoreError instead of throwing something obscure', async () => {
  const { idbBackend } = await import('../../app/src/store/idb.js');
  assert.equal(globalThis.indexedDB, undefined);
  await assert.rejects(openRepository(idbBackend()), (e) => e instanceof StoreError && e.code === 'UNSUPPORTED' && /[一-鿿]/.test(e.message));
  const b = idbBackend();
  await assert.rejects(b.transaction(['shots'], 'readonly', () => {}), (e) => e instanceof StoreError && e.code === 'CLOSED');
  await b.close(); // closing something never opened is fine
  // a factory that throws synchronously is reported too
  const bad = idbBackend({ factory: { open() { throw new Error('SecurityError: denied'); } } });
  await assert.rejects(openRepository(bad), (e) => e instanceof StoreError && e.code === 'BACKEND' && /denied/.test(e.message));
});
