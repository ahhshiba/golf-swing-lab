// WP-F (trust): Settings / About / Privacy / Help / Licences / Developer.
// Catalogs (both locales, same keys and placeholders, copy rules), no CJK literals in the F modules, version
// formatting (never "dev"), delete-all-data against fakes, the 7-tap developer unlock, and the pages rendered on the
// fake DOM in en: no CJK (except the native language name), no spec codes, no GolfDB / non-commercial text.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeDocument } from './_fakedom.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const I18N = path.join(ROOT, 'app', 'i18n');
const NS = ['settings', 'about', 'privacy', 'help', 'legal', 'licence'];
const FILES = ['settings', 'about', 'privacy', 'help', 'licences', 'developer'].map((f) => path.join(ROOT, 'app', 'src', 'ui', `${f}.js`));
const CJK = /[㐀-鿿豈-﫿＀-￯]/;
const COPY_RULE = /\b[PCK]\d{1,2}\b|\b[A-Z]{3,}_[A-Z_]+\b|\.mjs\b|sha-?256|golden|GolfDB|tcn\b/i;
const FORBIDDEN_ABOUT = /GolfDB|非商業|non-commercial|CC BY-NC/i;

const readCat = (loc, ns) => JSON.parse(fs.readFileSync(path.join(I18N, loc, `${ns}.json`), 'utf8'));
const placeholders = (v) => new Set([...JSON.stringify(v).matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
const values = (v) => (typeof v === 'string' ? [v] : Object.values(v));

test('F catalogs: both locales, same keys, same placeholders, copy rules, en plurals have one/other', () => {
  for (const ns of NS) {
    const zh = readCat('zh-Hant', ns);
    const en = readCat('en', ns);
    assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort(), `${ns}: key sets differ`);
    for (const k of Object.keys(zh)) {
      assert.deepEqual([...placeholders(zh[k])].sort(), [...placeholders(en[k])].sort(), `${ns}.${k}: placeholders differ`);
      for (const v of [...values(zh[k]), ...values(en[k])]) {
        assert.equal(typeof v, 'string', `${ns}.${k}`);
        assert.ok(!COPY_RULE.test(v), `${ns}.${k}: copy rule (spec code / file name / GolfDB): ${v}`);
        assert.ok(!/非商業|non-commercial|CC BY-NC/i.test(v), `${ns}.${k}: licence wording that must not ship`);
      }
      if (typeof en[k] === 'object') assert.ok('one' in en[k] && 'other' in en[k], `${ns}.${k}: en plural needs one + other`);
      if (k !== 'language.zh') for (const v of values(en[k])) assert.ok(!CJK.test(v), `en ${ns}.${k} has CJK: ${v}`);
    }
  }
});

test('F modules: no CJK literals; every literal t() key of an F namespace exists in both locales', () => {
  const cats = { 'zh-Hant': {}, en: {} };
  for (const loc of Object.keys(cats)) for (const ns of NS) for (const k of Object.keys(readCat(loc, ns))) cats[loc][`${ns}.${k}`] = true;
  let n = 0;
  for (const f of FILES) {
    const src = fs.readFileSync(f, 'utf8');
    const code = src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    assert.ok(!CJK.test(code), `${path.basename(f)}: CJK literal in code`);
    for (const m of code.matchAll(/\bt\('((?:settings|about|privacy|help|legal|licence)\.[\w.]+)'/g)) {
      n++;
      assert.ok(cats['zh-Hant'][m[1]] && cats.en[m[1]], `${path.basename(f)}: key ${m[1]} missing`);
    }
    assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML\s*=|document\.write/.test(code), `${path.basename(f)}: HTML injection API`);
  }
  assert.ok(n > 100, `found only ${n} literal keys`);
});

test('version: "0.1.0+bc56e95160" → "0.1.0 · build bc56e95"; dev / junk → null; manifest fallback', async () => {
  const { splitVersion, formatVersion, readVersion } = await import('../../app/src/ui/about.js');
  const t = (k, p) => `${p.semver} · build ${p.build}`;
  assert.deepEqual(splitVersion('0.1.0+bc56e95160'), { semver: '0.1.0', build: 'bc56e95' });
  assert.equal(formatVersion('0.1.0+bc56e95160', t), '0.1.0 · build bc56e95');
  assert.equal(formatVersion('0.2.0', t), '0.2.0');
  for (const bad of ['dev', '', null, undefined, 'v1', '0.1+x']) assert.equal(formatVersion(bad, t), null, String(bad));
  const fetchImpl = async (u) => ({ ok: u === 'precache-manifest.json', json: async () => ({ version: '0.2.0+64c9b5d0c2' }) });
  assert.equal(await readVersion({ version: () => 'dev' }, fetchImpl), '0.2.0+64c9b5d0c2');
  assert.equal(await readVersion({ version: () => '0.3.0+aaaaaaaaaa' }, fetchImpl), '0.3.0+aaaaaaaaaa');
  assert.equal(await readVersion({ version: () => 'dev' }, async () => ({ ok: false })), null);
});

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), keys: () => [...m.keys()] };
}

test('deleteAllData: repo cleared + closed, our databases deleted, user caches dropped (shell/assets kept), only gsl keys removed', async () => {
  const { deleteAllData } = await import('../../app/src/ui/privacy.js');
  const calls = [];
  const repo = { deleteAll: async () => calls.push('deleteAll'), close: async () => calls.push('close') };
  const deleted = [];
  const idb = {
    databases: async () => [{ name: 'golf-swing-lab' }, { name: 'someone-else' }, { name: 'gsl-extra' }],
    deleteDatabase: (name) => { deleted.push(name); const r = {}; setTimeout(() => r.onsuccess?.(), 1); return r; },
  };
  const cacheNames = ['gsl-shell-0.2.0+abc', 'gsl-assets', 'gsl-heavy-tmp', 'other-site'];
  const caches = { keys: async () => [...cacheNames], delete: async (n) => { cacheNames.splice(cacheNames.indexOf(n), 1); return true; } };
  const ls = memStorage({ 'gsl-settings-v2': '{}', 'gsl-calib-health-v1': '{}', 'gsl.diag/1': '{}', 'other-app': 'keep' });
  const ss = memStorage({ 'gsl-x': '1' });
  let diagReset = 0;
  const r = await deleteAllData({ repo, indexedDB: idb, caches, storages: [ls, ss, null], diagReset: () => diagReset++ });
  assert.deepEqual(r, { ok: true, problems: [] });
  assert.deepEqual(calls, ['deleteAll', 'close']);
  assert.deepEqual(deleted.sort(), ['golf-swing-lab', 'gsl-extra']);
  assert.deepEqual(cacheNames, ['gsl-shell-0.2.0+abc', 'gsl-assets', 'other-site']);
  assert.deepEqual(ls.keys(), ['other-app']);
  assert.deepEqual(ss.keys(), []);
  assert.equal(diagReset, 1);
});

test('deleteAllData: falls back to clearing every store; failures are reported, never thrown; a hanging delete times out', async () => {
  const { deleteAllData } = await import('../../app/src/ui/privacy.js');
  const cleared = [];
  const repo = { stores: { shots: {}, clips: {} }, transaction: async (names, mode, fn) => { assert.equal(mode, 'readwrite'); await fn({ clear: async (n) => cleared.push(n) }); } };
  const r1 = await deleteAllData({ repo, indexedDB: { deleteDatabase: () => ({}) }, timeoutMs: 20 });
  assert.deepEqual(cleared, ['shots', 'clips']);
  assert.equal(r1.ok, false);
  assert.match(r1.problems.join(), /idb golf-swing-lab: timeout/);
  const r2 = await deleteAllData({ repo: { deleteAll: async () => { throw Object.assign(new Error('x'), { code: 'BACKEND' }); } }, caches: { keys: async () => { throw new Error('no'); } } });
  assert.equal(r2.ok, false);
  assert.equal(r2.problems.length, 2);
});

test('developer unlock: 7 taps within the window; slow taps do not count', async () => {
  const { createDevTapCounter, DEV_TAPS } = await import('../../app/src/ui/developer.js');
  assert.equal(DEV_TAPS, 7);
  let now = 0;
  const tap = createDevTapCounter({ now: () => now });
  for (let i = 1; i < 7; i++) { now += 200; assert.deepEqual(tap(), { remaining: 7 - i, unlocked: false }); }
  now += 200;
  assert.deepEqual(tap(), { remaining: 0, unlocked: true });
  const slow = createDevTapCounter({ now: () => now, windowMs: 1000 });
  for (let i = 0; i < 10; i++) { now += 600; assert.equal(slow().unlocked, false); }
});

function fsFetch(url) {
  const p = path.join(I18N, String(url).replace(/^mem:\//, ''));
  if (!fs.existsSync(p)) return Promise.resolve({ ok: false, status: 404, json: async () => { throw new Error('404'); } });
  const txt = fs.readFileSync(p, 'utf8');
  return Promise.resolve({ ok: true, status: 200, json: async () => JSON.parse(txt) });
}
const visibleText = (el) => {
  const out = [];
  const walk = (n) => { if (n.hidden) return; if (n.data !== undefined) { if (n.data.trim()) out.push(n.data.trim()); return; } for (const c of n.childNodes ?? []) walk(c); };
  walk(el);
  return out;
};

test('pages render on the fake DOM in en: no CJK, no spec codes, no GolfDB / non-commercial; developer row only with settings.dev', async () => {
  const I = await import('../../app/src/i18n/index.js');
  await I.initI18n({ locale: 'en', fetchImpl: fsFetch, base: 'mem:/' });
  const doc = fakeDocument();
  globalThis.document = doc;
  const ls = memStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true });
  const { createComponents } = await import('../../app/src/ui/components.js');
  const S = await import('../../app/src/ui/settings.js');
  const { renderAbout } = await import('../../app/src/ui/about.js');
  const { renderPrivacy } = await import('../../app/src/ui/privacy.js');
  const { renderHelp } = await import('../../app/src/ui/help.js');
  const { renderLicences } = await import('../../app/src/ui/licences.js');
  const C = createComponents(doc);
  const nav = { stack: () => ['home'], back() {}, go() {} };
  const app = { nav, store: { get: () => ({ screen: 'settings', sessionActive: false }), set() {} }, repo: null, version: () => 'dev', updateSettings() {}, locale: () => 'en' };
  const check = (name, nodes) => {
    const box = doc.createElement('div');
    box.append(...nodes.filter(Boolean));
    const texts = visibleText(box);
    assert.ok(texts.length > 3, `${name}: rendered nothing`);
    for (const s of texts) {
      if (s === '繁體中文') continue;
      assert.ok(!CJK.test(s), `${name}: CJK "${s}"`);
      assert.ok(!/\b[PCK]\d{1,2}\b|\b[A-Z]{3,}_[A-Z_]+\b|\.mjs\b|sha-?256|golden|\btcn\b/.test(s), `${name}: spec code "${s}"`);
      assert.ok(!FORBIDDEN_ABOUT.test(s), `${name}: "${s}"`);
    }
    return { box, texts };
  };
  const ctx = S.trustCtx(app, C, { fetchImpl: async () => ({ ok: true, text: async () => 'Apache License\nVersion 2.0' }), readVersion: async () => '0.2.0+64c9b5d0c2' });

  const root = doc.createElement('section');
  const scr = S.mountSettings(root, app);
  scr.show({});
  let r = check('settings root', [root]);
  assert.ok(!root.querySelector('[data-testid="settings-developer"]'), 'developer row hidden by default');
  for (const tid of ['settings-locale', 'settings-units', 'settings-theme', 'settings-storage', 'settings-privacy', 'settings-help', 'settings-diag', 'settings-about']) assert.ok(root.querySelector(`[data-testid="${tid}"]`), tid);
  // theme + units save through session/settings.js
  root.querySelector('[data-testid="settings-theme"]').querySelector('[data-value="sun"]').click();
  assert.equal(JSON.parse(ls.getItem('gsl-settings-v2')).theme, 'sun');
  root.querySelector('[data-testid="settings-units"]').querySelector('[data-value="m"]').click();
  assert.equal(JSON.parse(ls.getItem('gsl-settings-v2')).units.distance, 'm');
  // internal page navigation and back
  root.querySelector('[data-testid="settings-privacy"]').click();
  assert.equal(root.getAttribute('data-page'), 'privacy');
  assert.ok(root.querySelector('[data-testid="privacy-delete-all"]'));
  root.querySelector('button.back').click();
  assert.equal(root.getAttribute('data-page'), 'root');
  // developer unlocked
  ls.setItem('gsl-settings-v2', JSON.stringify({ ...JSON.parse(ls.getItem('gsl-settings-v2')), dev: true }));
  scr.hide();
  scr.show({});
  assert.ok(root.querySelector('[data-testid="settings-developer"]'), 'developer row with settings.dev');
  scr.show({ page: 'storage' });
  check('storage', [root]);

  r = check('about', renderAbout(ctx).nodes);
  await new Promise((res) => setTimeout(res, 10));
  assert.equal(r.box.querySelector('[data-testid="about-version"]').textContent, '0.2.0 · build 64c9b5d');
  assert.ok(r.texts.includes('Swing phases: automatic (rule-based)'));
  check('privacy', renderPrivacy(ctx).nodes);
  check('help', renderHelp(ctx).nodes);
  const lic = check('licences', renderLicences(ctx).nodes);
  await new Promise((res) => setTimeout(res, 10));
  assert.match(lic.box.querySelector('[data-testid="licence-text-mediapipe"]').textContent, /Apache License/);
  assert.match(lic.box.querySelector('[data-testid="licence-text-icons"]').textContent, /ISC License/);
  delete globalThis.document;
});
