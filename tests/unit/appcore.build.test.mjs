// scripts/build.mjs + app/sw.template.js: output layout, VERSION format and determinism, budgets, precache
// completeness, and the service worker's install / offline navigation / activate / update behaviour (fake SW env).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build, versionOf, listFiles, BUDGETS, RUNTIME_ONLY } from '../../scripts/build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `gsl-${p}-`));
const sha = (b) => createHash('sha256').update(b).digest('hex');

function treeHash(dir) {
  const out = {};
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else out[r] = sha(fs.readFileSync(path.join(d, e.name)));
    }
  };
  walk(dir, '');
  return out;
}

const outA = tmp('buildA');
const outB = tmp('buildB');
const rA = build({ out: outA });
const rB = build({ out: outB });
test.after(() => { for (const d of [outA, outB]) fs.rmSync(d, { recursive: true, force: true }); });

test('build: VERSION = semver + 10 hex of the precache hash, and two builds are byte-identical', () => {
  assert.match(rA.version, /^\d+\.\d+\.\d+\+[0-9a-f]{10}$/);
  assert.ok(rA.version.startsWith(`${PKG.version}+`));
  assert.equal(rA.version, rB.version);
  assert.deepEqual(treeHash(outA), treeHash(outB));
});

test('build: precache-manifest.json and sw.js agree; the hash recomputes from the files in dist/', () => {
  const man = JSON.parse(fs.readFileSync(path.join(outA, 'precache-manifest.json'), 'utf8'));
  assert.equal(man.schema, 'gsl-precache/1');
  assert.equal(man.version, rA.version);
  const pre = [...man.shell, ...man.assets.filter((a) => a.precache)];
  for (const e of pre) {
    assert.ok(!e.url.startsWith('/') && !e.url.includes('..'), `relative url ${e.url}`);
    assert.equal(sha(fs.readFileSync(path.join(outA, e.url))), e.sha256, e.url);
  }
  assert.equal(versionOf(PKG.version, pre.map((e) => ({ url: e.url, sha256: e.sha256 }))), rA.version);
  const sw = fs.readFileSync(path.join(outA, 'sw.js'), 'utf8');
  assert.ok(!sw.includes('__GSL_MANIFEST__'), 'markers replaced');
  assert.ok(sw.includes(JSON.stringify(rA.version)));
  new vm.Script(sw, { filename: 'sw.js' }); // syntax check
  assert.ok(!fs.existsSync(path.join(outA, 'sw.template.js')));
  assert.ok(fs.existsSync(path.join(outA, '.nojekyll')));
});

test('build: budgets (shell ≤ 1 MB, precache ≤ 35 MB); heavy model and classic wasm are runtime-only', () => {
  assert.deepEqual(rA.problems, []);
  assert.ok(rA.shellBytes <= BUDGETS.shell_bytes, `shell ${rA.shellBytes}`);
  assert.ok(rA.precacheBytes <= BUDGETS.precache_bytes, `precache ${rA.precacheBytes}`);
  const runtime = rA.assets.filter((a) => !a.precache).map((a) => a.url);
  for (const r of RUNTIME_ONLY) if (fs.existsSync(path.join(ROOT, 'app', r))) assert.ok(runtime.includes(r), r);
  const shell = rA.shell.map((e) => e.url);
  for (const must of ['index.html', 'manifest.webmanifest', 'styles/app.css', 'src/main.js', 'src/state.js', 'icons/icon-192.png', 'icons/apple-touch-icon-180.png']) assert.ok(shell.includes(must), must);
  assert.ok(!shell.some((u) => u.startsWith('vendor/') || u.startsWith('models/')));
});

test('build: every file the app imports or references is precached (offline start)', () => {
  const pre = new Set([...rA.shell.map((e) => e.url), ...rA.assets.filter((a) => a.precache).map((a) => a.url)]);
  for (const f of listFiles(path.join(ROOT, 'app')).filter((x) => x.startsWith('src/') && x.endsWith('.js'))) {
    assert.ok(pre.has(f), `${f} not precached`);
  }
  const html = fs.readFileSync(path.join(outA, 'index.html'), 'utf8');
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(pre.has(m[1]), `index.html → ${m[1]}`);
  const man = JSON.parse(fs.readFileSync(path.join(outA, 'manifest.webmanifest'), 'utf8'));
  for (const i of man.icons) assert.ok(pre.has(i.src), i.src);
});

test('build CLI: prints sizes, exits 0; refuses to wipe a foreign directory; over-budget shell exits 1', () => {
  const out = tmp('cli');
  fs.rmSync(out, { recursive: true });
  const r = spawnSync(process.execPath, ['scripts/build.mjs', '--out', out, '--dev'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /VERSION \d+\.\d+\.\d+\+[0-9a-f]{10} \(dev\)/);
  assert.match(r.stdout, /shell\s+\d+\.\d+ MB/);
  assert.match(r.stdout, /precache\s+\d+\.\d+ MB/);
  const sw = fs.readFileSync(path.join(out, 'sw.js'), 'utf8');
  assert.match(sw, /"dev":true/);
  assert.match(sw, new RegExp(JSON.stringify(rA.version).replace(/[+.]/g, '\\$&')), '--dev keeps the same VERSION');
  fs.rmSync(out, { recursive: true, force: true });

  const foreign = tmp('foreign');
  fs.writeFileSync(path.join(foreign, 'keep.txt'), 'x');
  const r2 = spawnSync(process.execPath, ['scripts/build.mjs', '--out', foreign, '--quiet'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r2.status, 1);
  assert.ok(fs.existsSync(path.join(foreign, 'keep.txt')));
  fs.rmSync(foreign, { recursive: true, force: true });

  const app = tmp('bigapp');
  fs.copyFileSync(path.join(ROOT, 'app', 'sw.template.js'), path.join(app, 'sw.template.js'));
  fs.writeFileSync(path.join(app, 'index.html'), '<!doctype html>');
  fs.writeFileSync(path.join(app, 'big.js'), Buffer.alloc(BUDGETS.shell_bytes + 1, 32));
  const out3 = tmp('bigout');
  const r3 = spawnSync(process.execPath, ['scripts/build.mjs', '--app', app, '--out', out3], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r3.status, 1);
  assert.match(r3.stderr, /FAIL budget: shell/);
  fs.rmSync(app, { recursive: true, force: true });
  fs.rmSync(out3, { recursive: true, force: true });
});

// ------------------------------------------------------------------ service worker in a fake environment

function makeApp(files) {
  const app = tmp('swapp');
  fs.copyFileSync(path.join(ROOT, 'app', 'sw.template.js'), path.join(app, 'sw.template.js'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(app, rel)), { recursive: true });
    fs.writeFileSync(path.join(app, rel), body);
  }
  return app;
}

function fakeSW(dist, scope) {
  const stores = new Map();
  const listeners = {};
  const fetched = [];
  let online = true;
  const keyOf = (r) => (typeof r === 'string' ? r : r.url);
  const cacheObj = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      async match(r) { const hit = m.get(keyOf(r)); return hit ? hit.clone() : undefined; },
      async put(r, res) { m.set(keyOf(r), res.clone()); },
      async addAll(reqs) { for (const q of reqs) { const res = await self.fetch(q); if (!res.ok) throw new Error('addAll'); m.set(keyOf(q), res); } },
      async keys() { return [...m.keys()].map((u) => new Request(u)); },
      async delete(r) { return m.delete(keyOf(r)); },
    };
  };
  const self = {
    registration: { scope },
    location: new URL(scope),
    clients: { claim: async () => {} },
    skipped: false,
    skipWaiting() { this.skipped = true; },
    addEventListener(t, f) { listeners[t] = f; },
    fetch: async (req) => {
      const url = typeof req === 'string' ? req : req.url;
      fetched.push(url);
      if (!online) throw new TypeError('offline');
      const rel = new URL(url).pathname.slice(new URL(scope).pathname.length) || 'index.html';
      const p = path.join(dist, rel);
      if (!fs.existsSync(p)) return new Response('nf', { status: 404 });
      return new Response(fs.readFileSync(p), { status: 200 });
    },
  };
  const caches = {
    open: async (n) => cacheObj(n),
    keys: async () => [...stores.keys()],
    delete: async (n) => stores.delete(n),
  };
  const ctx = vm.createContext({ self, caches, fetch: self.fetch, Request, Response, Headers, URL, Map, Promise, console });
  vm.runInContext(fs.readFileSync(path.join(dist, 'sw.js'), 'utf8'), ctx);
  async function dispatch(type, extra = {}) {
    let p = Promise.resolve();
    let responded = null;
    const ev = { ...extra, waitUntil(x) { p = x; }, respondWith(x) { responded = x; } };
    listeners[type](ev);
    await p;
    return responded ? await responded : undefined;
  }
  return { stores, dispatch, fetched, setOnline: (v) => { online = v; }, self };
}

test('service worker: install precaches shell + assets; offline navigation serves index.html; scope-relative under /golf-swing-lab/', async () => {
  const app = makeApp({
    'index.html': '<!doctype html><p>gsl</p>', 'src/main.js': 'export {};', 'vendor/x/engine.wasm': Buffer.alloc(64, 1),
    'models/pose_landmarker_full.task': Buffer.alloc(32, 2), 'models/pose_landmarker_heavy.task': Buffer.alloc(16, 3),
  });
  const dist = tmp('swdist');
  const r = build({ app, out: dist });
  const scope = 'http://localhost/golf-swing-lab/';
  const sw = fakeSW(dist, scope);
  await sw.dispatch('install');
  const shell = sw.stores.get(`gsl-shell-${r.version}`);
  assert.ok(shell.has(`${scope}index.html`) && shell.has(`${scope}src/main.js`));
  const assets = sw.stores.get('gsl-assets');
  assert.ok(assets.has(`${scope}vendor/x/engine.wasm`) && assets.has(`${scope}models/pose_landmarker_full.task`));
  assert.ok(!assets.has(`${scope}models/pose_landmarker_heavy.task`), 'heavy is runtime-only');
  await sw.dispatch('activate');
  sw.setOnline(false);
  const nav = await sw.dispatch('fetch', { request: { method: 'GET', mode: 'navigate', url: `${scope}?x=1` } });
  assert.equal(await nav.text(), '<!doctype html><p>gsl</p>');
  const js = await sw.dispatch('fetch', { request: { method: 'GET', mode: 'cors', url: `${scope}src/main.js` } });
  assert.equal(await js.text(), 'export {};');
  const wasm = await sw.dispatch('fetch', { request: { method: 'GET', mode: 'cors', url: `${scope}vendor/x/engine.wasm` } });
  assert.equal((await wasm.arrayBuffer()).byteLength, 64);
  // runtime-only asset is fetched and kept in gsl-assets once online
  sw.setOnline(true);
  await sw.dispatch('fetch', { request: new Request(`${scope}models/pose_landmarker_heavy.task`) });
  // the SW stores the response asynchronously after responding; poll (up to 2 s) instead of a fixed delay
  const heavy = `${scope}models/pose_landmarker_heavy.task`;
  for (let waited = 0; !assets.has(heavy) && waited < 2000; waited += 10) await new Promise((res) => setTimeout(res, 10));
  assert.ok(assets.has(heavy), 'runtime-only heavy asset cached within 2 s');
  // GET_VERSION reports the version and a complete precache
  const msgs = [];
  await sw.dispatch('message', { data: { type: 'GET_VERSION' }, source: { postMessage: (m) => msgs.push(m) } });
  assert.deepEqual(JSON.parse(JSON.stringify(msgs)), [{ type: 'VERSION', version: r.version, precache_complete: 1 }]);
  // SKIP_WAITING only on request
  assert.equal(sw.self.skipped, false);
  await sw.dispatch('message', { data: { type: 'SKIP_WAITING' } });
  assert.equal(sw.self.skipped, true);
  fs.rmSync(app, { recursive: true, force: true });
  fs.rmSync(dist, { recursive: true, force: true });
});

test('service worker: a new version replaces gsl-shell-* and keeps unchanged assets without re-downloading', async () => {
  const files = { 'index.html': 'v1', 'src/main.js': 'export {};', 'models/pose_landmarker_lite.task': Buffer.alloc(40, 7) };
  const app = makeApp(files);
  const d1 = tmp('sw1');
  const r1 = build({ app, out: d1 });
  const scope = 'http://localhost/';
  const sw = fakeSW(d1, scope);
  await sw.dispatch('install');
  await sw.dispatch('activate');
  fs.writeFileSync(path.join(app, 'index.html'), 'v2');
  const d2 = tmp('sw2');
  const r2 = build({ app, out: d2 });
  assert.notEqual(r1.version, r2.version);
  // second worker shares the same caches
  const sw2 = fakeSW(d2, scope);
  for (const [k, v] of sw.stores) sw2.stores.set(k, v);
  await sw2.dispatch('install');
  assert.ok(!sw2.fetched.includes(`${scope}models/pose_landmarker_lite.task`), 'unchanged asset not re-fetched');
  await sw2.dispatch('activate');
  assert.deepEqual([...sw2.stores.keys()].filter((k) => k.startsWith('gsl-shell-')), [`gsl-shell-${r2.version}`]);
  sw2.setOnline(false);
  const nav = await sw2.dispatch('fetch', { request: { method: 'GET', mode: 'navigate', url: scope } });
  assert.equal(await nav.text(), 'v2');
  for (const d of [app, d1, d2]) fs.rmSync(d, { recursive: true, force: true });
});
