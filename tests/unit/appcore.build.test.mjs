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
  // LAUNCH-MONITOR-SPEC §5.3 (integration): the final shell, read back from the written manifest, fits the 1,000,000 B
  // budget; the budget itself (BUDGETS) never changes (the drop-1 interim cap of 969,715 B is retired)
  const manTotals = JSON.parse(fs.readFileSync(path.join(outA, 'precache-manifest.json'), 'utf8')).totals;
  assert.equal(manTotals.shell_bytes, rA.shellBytes);
  assert.ok(manTotals.shell_bytes <= 1_000_000, `shell ${manTotals.shell_bytes} > 1,000,000`);
  assert.ok(manTotals.precache_bytes <= 35_000_000, `precache ${manTotals.precache_bytes} > 35,000,000`);
  assert.deepEqual({ ...BUDGETS }, { shell_bytes: 1_000_000, precache_bytes: 35_000_000 });
  // the launch-monitor modules are lazy (§5.0-11): in the precache, never in the shell
  for (const f of ['src/ui/drills.js', 'src/ui/drill.js', 'src/ui/stats.js', 'src/ui/gapping.js', 'src/viz/index.js', 'src/physics/lm/index.js', 'src/practice/drills.js', 'src/store/stats.js']) {
    assert.ok(!rA.shell.some((e) => e.url === f) && rA.assets.some((a) => a.url === f && a.precache), f);
  }
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
  assert.equal(await js.text(), fs.readFileSync(path.join(dist, 'src/main.js'), 'utf8')); // the built (squeezed) bytes
  assert.match(await (await sw.dispatch('fetch', { request: { method: 'GET', mode: 'cors', url: `${scope}src/main.js` } })).text(), /^export ?\{\};$/);
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

// ---- i18n catalogs merged into dist/i18n/<locale>.json; comments stripped from app JS/CSS (PRODUCT-SPEC §3.1, PF-1) ----
import { mergeCatalogs, catalogTree, stripJsComments, stripCssComments, CATALOG_SOURCE_RE, LAZY_FILES, LAZY_I18N_NAMESPACES } from '../../scripts/build.mjs';
import { expandCatalog } from '../../app/src/i18n/index.js';

test('build: dist/i18n/zh-Hant.json and en.json are merged, precached, and the namespace sources are not shipped', () => {
  for (const loc of ['zh-Hant', 'en']) {
    const p = path.join(outA, 'i18n', `${loc}.json`);
    assert.ok(fs.existsSync(p), p);
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(raw.$tree, 1, 'merged catalog is the prefix tree (build.mjs catalogTree)');
    const flat = expandCatalog(raw);
    assert.ok(fs.statSync(p).size < Buffer.byteLength(JSON.stringify(flat)), 'the tree is smaller than the flat catalog');
    assert.equal(typeof flat['app.name'], 'string');
    assert.ok(!Object.keys(flat).some((k) => k.endsWith('._context')));
    assert.deepEqual(Object.keys(flat), Object.keys(flat).slice().sort());
    assert.ok(rA.shell.some((e) => e.url === `i18n/${loc}.json`), `${loc} precached`);
  }
  assert.ok(!rA.shell.some((e) => CATALOG_SOURCE_RE.test(e.url)), 'no namespace source file in the shell');
  const merged = mergeCatalogs(path.join(ROOT, 'app'));
  for (const loc of ['zh-Hant', 'en']) {
    // core (shell) + the lazy part of the rare screens (gsl-assets, precached) = the merged catalog
    const core = JSON.parse(fs.readFileSync(path.join(outA, 'i18n', `${loc}.json`), 'utf8'));
    assert.equal(core.$lazy, `${loc}.more.json`);
    const more = expandCatalog(JSON.parse(fs.readFileSync(path.join(outA, 'i18n', core.$lazy), 'utf8')));
    assert.ok(Object.keys(more).length > 0 && Object.keys(more).every((k) => LAZY_I18N_NAMESPACES.includes(k.split('.')[0])));
    assert.ok(!Object.keys(expandCatalog(core)).some((k) => LAZY_I18N_NAMESPACES.includes(k.split('.')[0])));
    const all = { ...expandCatalog(core), ...more };
    assert.deepEqual(Object.fromEntries(Object.keys(all).sort().map((k) => [k, all[k]])), merged[loc]);
    assert.ok(rA.assets.find((a) => a.url === `i18n/${loc}.more.json`)?.precache, 'lazy part precached (gsl-assets)');
  }
});

test('build: lazy files go to gsl-assets (precached), never the boot graph; i18n lazy part loads in the background', async () => {
  const shell = new Set(rA.shell.map((e) => e.url));
  for (const f of LAZY_FILES) {
    assert.ok(!shell.has(f), `${f} not in the shell`);
    assert.ok(rA.assets.find((a) => a.url === f)?.precache, `${f} precached in gsl-assets`);
    assert.ok(!rA.modulepreload.includes(f), `${f} not modulepreloaded`);
  }
  assert.ok(rA.modulepreload.length > 3, 'boot graph follows the squeezed `import{a}from\'./a.js\'` of dist/');
  const i18n = await import('../../app/src/i18n/index.js');
  const files = { 'en.json': { $tree: 1, $lazy: 'en.more.json', app: { name: 'A' } }, 'en.more.json': { $tree: 1, help: { x: 'H' } }, 'zh-Hant.json': { $tree: 1, app: { name: 'Z' } } };
  let release;
  const gate = new Promise((r) => { release = r; });
  const fetchImpl = async (u) => {
    const name = String(u).split('/').pop();
    if (name === 'en.more.json') await gate;
    return files[name] ? { ok: true, json: async () => files[name] } : { ok: false };
  };
  assert.equal(await i18n.initI18n({ locale: 'en', fetchImpl, base: 'x/' }), 'en');
  assert.equal(i18n.t('app.name'), 'A');
  assert.equal(i18n.has('help.x'), false, 'lazy part not awaited by initI18n');
  release();
  await i18n.i18nComplete();
  assert.equal(i18n.t('help.x'), 'H');
});

test('catalogTree/expandCatalog: prefix keys, plurals and flat input round-trip; a plural-looking node is refused', () => {
  const flat = { 'a.b': 'x', 'a.b.c': 'y', 'a.b.d.e': { one: '1', other: 'n' }, 'a.z': 'z', 'b': 'top', 'b.c': 'under' };
  const tree = catalogTree(flat);
  assert.equal(tree.$tree, 1);
  assert.deepEqual(tree.a.b, { '': 'x', c: 'y', d: { e: { one: '1', other: 'n' } } });
  assert.deepEqual(expandCatalog(tree), flat);
  assert.deepEqual(expandCatalog({ 'k.x': 'v' }), { 'k.x': 'v' }, 'a flat (older) catalog passes through');
  assert.throws(() => catalogTree({ 'n.one': '1', 'n.other': 'n' }), /round-trip/);
});

test('build: comments stripped, line count kept, strings/templates/regex untouched; every shipped module parses', () => {
  const src = [
    '// head', 'const a = "x // not a comment"; /* inline */ const b = 1;', "const re = /\\/\\/[a-z]*/g; // tail",
    'const t = `line ${a /* c */ + `n${b}`} // kept`;', '/**', ' * doc', ' */', 'const d = 4 / 2 / 1; // div', 'return /x/.test(s);',
  ].join('\n');
  const out = stripJsComments(src);
  assert.equal(out.split('\n').length, src.split('\n').length);
  assert.ok(out.includes('"x // not a comment"'));
  assert.ok(out.includes('/\\/\\/[a-z]*/g'));
  assert.ok(out.includes('// kept`'));
  assert.ok(out.includes('4 / 2 / 1'));
  assert.ok(!/head|inline|doc|tail|div/.test(out.replace(/divide/g, '')));
  assert.equal(stripCssComments('a { color: red; } /* x */\nb { content: "/* y */"; }'), 'a { color: red; }  \nb { content: "/* y */"; }'.replace(/[ \t]+\n/g, '\n'));
  // every app module, stripped as in dist/, has the same line count and still parses (vm.SourceTextModule)
  // (src/version.js is not stripped but generated: its own test below)
  const files = listFiles(path.join(ROOT, 'app')).filter((f) => /^src\/.*\.js$/.test(f) && f !== 'src/version.js');
  const script = `
    const vm = require('node:vm'); const fs = require('node:fs'); const bad = [];
    for (const [rel, a, b] of JSON.parse(fs.readFileSync(0, 'utf8'))) {
      if (fs.readFileSync(a, 'utf8').split('\\n').length !== fs.readFileSync(b, 'utf8').split('\\n').length) bad.push(rel + ': line count');
      try { new vm.SourceTextModule(fs.readFileSync(b, 'utf8'), { identifier: rel }); }
      catch (e) { try { new vm.Script(fs.readFileSync(b, 'utf8')); } catch (e2) { bad.push(rel + ': ' + e.message); } }
    }
    process.stdout.write(JSON.stringify(bad));`;
  const r = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', '-e', script], { input: JSON.stringify(files.map((f) => [f, path.join(ROOT, 'app', f), path.join(outA, f)])), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), []);
  const before = files.reduce((s, f) => s + fs.statSync(path.join(ROOT, 'app', f)).size, 0);
  const after = files.reduce((s, f) => s + fs.statSync(path.join(outA, f)).size, 0);
  assert.ok(after < before, `${after} < ${before}`);
});

// ---- generated src/version.js, modulepreload of the boot graph, no event model by default (PRODUCT-SPEC §6.4, PF-1, §7.1) ----
import { bootGraph, staticImports, versionModule, BOOT_ENTRIES, MODULEPRELOAD_MAX, VERSION_FILE } from '../../scripts/build.mjs';

test('build: src/version.js carries the exact VERSION (never "dev"), is precached, and is outside the VERSION hash', async () => {
  const src = fs.readFileSync(path.join(outA, VERSION_FILE), 'utf8');
  const m = await import(`data:text/javascript,${encodeURIComponent(src)}`);
  assert.equal(m.APP_VERSION, rA.version);
  assert.equal(m.APP_SEMVER, PKG.version);
  assert.equal(m.APP_BUILD, rA.version.split('+')[1].slice(0, 7));
  assert.equal(m.DEV_RESEARCH, false);
  assert.equal(m.BUNDLED_EVENT_MODEL, false);
  assert.ok(rA.shell.some((e) => e.url === VERSION_FILE), 'precached');
  // the placeholder in app/ has nulls; the hash ignores the file (it embeds the hash)
  const ph = await import('../../app/src/version.js');
  assert.equal(ph.APP_VERSION, null);
  assert.match(versionModule({ version: '1.2.3+abcdef0123', semver: '1.2.3' }), /APP_BUILD = "abcdef0"/);
  const man = JSON.parse(fs.readFileSync(path.join(outA, 'precache-manifest.json'), 'utf8'));
  const pre = [...man.shell, ...man.assets.filter((a) => a.precache)];
  assert.equal(versionOf(PKG.version, pre.filter((e) => e.url !== VERSION_FILE)), rA.version);
});

test('build: index.html gets <link rel=modulepreload> for the boot graph (≤ 30, breadth-first from main.js), all precached', () => {
  const html = fs.readFileSync(path.join(outA, 'index.html'), 'utf8');
  const links = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((x) => x[1]);
  assert.ok(links.length > 0 && links.length <= MODULEPRELOAD_MAX, `${links.length} links`);
  assert.equal(links[0], 'src/main.js');
  assert.deepEqual(links, rA.modulepreload);
  assert.ok(html.indexOf('rel="modulepreload"') < html.indexOf('<script type="module" src="src/main.js">'));
  const pre = new Set(rA.shell.map((e) => e.url));
  for (const l of links) assert.ok(pre.has(l), `${l} precached`);
  // graph helpers
  assert.deepEqual(staticImports("import { a } from './a.js';\nexport * from '../b.js';\nconst x = import('./lazy.js');"), ['./a.js', '../b.js']);
  const files = new Map([['src/main.js', Buffer.from("import './x/a.js';")], ['src/x/a.js', Buffer.from("import '../b.js'; import '../b.js';")], ['src/b.js', Buffer.from('')]]);
  assert.deepEqual(bootGraph(files, ['src/main.js', 'src/missing.js']), ['src/main.js', 'src/x/a.js', 'src/b.js']);
  assert.ok(BOOT_ENTRIES.includes('src/main.js'));
});

test('build: the default build ships no GolfDB-derived event model (dev research needs --include-golfdb-model)', () => {
  assert.equal(rA.bundledEventModel, false);
  assert.equal(rA.devResearch, false);
  assert.ok(!fs.readdirSync(path.join(outA, 'models')).some((f) => /^event-tcn-v1\./.test(f)));
  const man = JSON.parse(fs.readFileSync(path.join(outA, 'precache-manifest.json'), 'utf8'));
  assert.equal(man.dev_research, false);
  assert.ok(!JSON.stringify(man.assets).includes('event-tcn-v1'));
});

// ---- shipped-byte squeeze (integration 2026-11-05): in-line whitespace and CSS whitespace, behaviour unchanged ----
import { minifyCss } from '../../scripts/build.mjs';

test('build squeeze: JS in-line whitespace dropped only where no tokens join; results identical; lines kept', () => {
  const cases = [
    'const a = 3, b = 2; out.push(a + +b, a - -b, a+ +b, a - - b)',
    'const s = "a  b // c", t = `x  ${ 1 + 2 }  y`; out.push(s, t)',
    'out.push(1 .toString(), 10 / 2 / 5, /a b/.test("a b"))',
    'function f(x) { return typeof x === "string" ? x : void 0 } out.push(f("q"), f(1))',
    'let i = 0; i ++; out.push(i, "k" in { k: 1 }, [1, 2] instanceof Array)',
    'const re = 6 / /2/.source.length; out.push(re)',
    'class K { static #p = 4; static get v() { return K.#p } } out.push(K.v)',
    'async function g() { return await Promise.resolve(5) } out.push(typeof g)',
  ];
  for (const src of cases) {
    const sq = stripJsComments(src, { squeeze: true });
    assert.ok(sq.length <= src.length, src);
    const run = (code) => { const out = []; vm.runInNewContext(code, { out }); return JSON.stringify(out); };
    assert.equal(run(sq), run(src), `${src}\n→ ${sq}`);
  }
  const multi = 'const a = 1;   \n  if (a) {\n    x = a  +  1;\n  }\n';
  const sq = stripJsComments(multi, { squeeze: true });
  assert.equal(sq.split('\n').length, multi.split('\n').length);
  assert.equal(sq, 'const a=1;\nif(a){\nx=a+1;\n}\n');
  assert.equal(stripJsComments('a = b / c', {}), 'a = b / c', 'default (no squeeze) unchanged');
});

test('build squeeze: CSS whitespace collapsed; selectors, calc() operands and strings kept', () => {
  const css = '/* c */\n.a  .b :hover ,\n.c > .d {\n  color : red ;\n  width: calc(100% - 2px);\n  content: "x  ;  y";\n}\n@media (max-width: 500px) {\n  .e { margin: 0 auto; }\n}\n';
  assert.equal(minifyCss(css), '.a .b :hover,.c > .d{color :red;width:calc(100% - 2px);content:"x  ;  y"}@media (max-width:500px){.e{margin:0 auto}}');
});

test('default build ships nothing GolfDB-derived: no model files, no provenance text, no non-commercial notice', () => {
  const out = tmp('nogolfdb');
  build({ app: path.join(ROOT, 'app'), out, quiet: true });
  const hits = [];
  for (const f of listFiles(out)) {
    if (/\.(task|wasm|png)$/.test(f)) continue;
    const txt = fs.readFileSync(path.join(out, f), 'utf8');
    if (f === 'precache-manifest.json') { // records which files were left out; nothing of them is shipped
      const m = JSON.parse(txt);
      assert.equal(m.bundled_event_model, false);
      assert.ok(!JSON.stringify([m.shell, m.assets]).match(/event-tcn|golfdb/i));
      continue;
    }
    // shipped code may only check the card field `golfdb: false` / `golfdb !== false` (rejecting third-party models)
    const t2 = txt.replace(/"?golfdb"?\s*(===|!==|:)\s*false/gi, '');
    if (/golfdb|event-tcn-v1|CC BY-NC|non-commercial|split\s?1\b/i.test(t2)) hits.push(f);
  }
  assert.deepEqual(hits, []);
  assert.ok(!fs.existsSync(path.join(out, 'vendor/manifest.json')));
  assert.ok(!fs.existsSync(path.join(out, 'src/events/calib-conf.json')));
});
