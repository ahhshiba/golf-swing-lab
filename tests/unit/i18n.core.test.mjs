// i18n core (PRODUCT-SPEC §3.2, WP-A acceptance): fallback chain, plurals, ListFormat, local date-time, U+2212 minus,
// resolveLocale table, the namespace loader (merged file first, namespace files second, missing files skipped).
process.env.TZ = 'Asia/Taipei';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as I from '../../app/src/i18n/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const I18N = path.join(ROOT, 'app', 'i18n');
/** fetch over the file system, rooted at app/i18n/ (base 'mem:/'); missing files are 404. */
function fsFetch(root = I18N, log = []) {
  return async (url) => {
    log.push(url);
    const p = path.join(root, String(url).replace(/^mem:\//, ''));
    if (!fs.existsSync(p)) return { ok: false, status: 404, json: async () => { throw new Error('404'); } };
    const txt = fs.readFileSync(p, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(txt) };
  };
}

test('resolveLocale: preference wins; zh-TW/HK/MO/Hant/CN/Hans → zh-Hant; en* → en; anything else → en', () => {
  const T = [
    [['zh-TW'], 'zh-Hant'], [['zh-HK'], 'zh-Hant'], [['zh-MO'], 'zh-Hant'], [['zh-Hant-TW'], 'zh-Hant'], [['zh-CN'], 'zh-Hant'],
    [['zh-Hans'], 'zh-Hant'], [['zh'], 'zh-Hant'], [['en-US'], 'en'], [['en-GB'], 'en'], [['en'], 'en'], [['ja-JP'], 'en'],
    [['fr-FR', 'zh-TW'], 'zh-Hant'], [[], 'en'],
  ];
  for (const [langs, want] of T) assert.equal(I.resolveLocale('auto', langs), want, langs.join(','));
  assert.equal(I.resolveLocale('en', ['zh-TW']), 'en');
  assert.equal(I.resolveLocale('zh-Hant', ['en-US']), 'zh-Hant');
  assert.equal(I.resolveLocale('xx', ['zh-TW']), 'zh-Hant', 'unknown preference = auto');
});

test('t(): active → zh-Hant → key; params; missing keys reported once; has(); msg()', async () => {
  I.setCatalog('zh-Hant', { 'a.only_zh': '只有中文', 'a.both': '兩者', 'a.p': '第 {n} 球，{name}', 'a.x._context': 'note' });
  I.setCatalog('en', { 'a.both': 'both', 'a.p': 'Shot {n}, {name}' });
  await I.initI18n({ locale: 'en', fetchImpl: null });
  assert.equal(I.getLocale(), 'en');
  assert.equal(I.t('a.both'), 'both');
  assert.equal(I.t('a.only_zh'), '只有中文', 'falls back to zh-Hant');
  assert.equal(I.t('a.p', { n: 12, name: 'Ann' }), 'Shot 12, Ann');
  assert.equal(I.t('a.p', { n: 1 }), 'Shot 1, {name}', 'unknown params stay visible');
  const seen = [];
  const off = I.onMissing((k) => seen.push(k));
  assert.equal(I.t('a.nope'), 'a.nope');
  assert.equal(I.t('a.nope'), 'a.nope');
  off();
  assert.deepEqual(seen, ['a.nope'], 'reported once');
  assert.ok(I.missingKeys().includes('a.nope'));
  assert.equal(I.has('a.both'), true);
  assert.equal(I.has('a.x._context'), false, '_context notes are stripped');
  assert.equal(I.has('a.nope'), false);
  assert.equal(I.msg({ code: 'a.p', params: { n: 3, name: 'B' } }), 'Shot 3, B');
  assert.equal(I.msg('plain'), 'plain');
  assert.equal(I.msg(null), '');
});

test('plural(): en one/other, zh-Hant other only; numbers in params use the locale format', async () => {
  I.setCatalog('zh-Hant', { 's.n': { other: '{n} 球' } });
  I.setCatalog('en', { 's.n': { one: '{n} shot', other: '{n} shots' } });
  await I.initI18n({ locale: 'en', fetchImpl: null });
  assert.equal(I.plural('s.n', 1), '1 shot');
  assert.equal(I.plural('s.n', 0), '0 shots');
  assert.equal(I.plural('s.n', 2), '2 shots');
  assert.equal(I.plural('s.n', 1500), '1,500 shots');
  await I.setLocale('zh-Hant');
  assert.equal(I.plural('s.n', 1), '1 球');
  assert.equal(I.plural('s.n', 7), '7 球');
});

test('list(), fmtNum (U+2212 minus, no −0, sign), fmtDateTime in Asia/Taipei, fmtRelativeDays', async () => {
  await I.initI18n({ locale: 'en', fetchImpl: null });
  assert.equal(I.list(['a', 'b', 'c']), 'a, b, and c');
  assert.equal(I.list(['a', 'b'], 'disjunction'), 'a or b');
  assert.equal(I.fmtNum(-3.25, { digits: 1 }), '−3.3');
  assert.ok(!I.fmtNum(-3.25, { digits: 1 }).includes('-'));
  assert.equal(I.fmtNum(-0.04, { digits: 1 }), '0.0');
  assert.equal(I.fmtNum(2.5, { digits: 1, sign: true }), '+2.5');
  assert.equal(I.fmtNum(NaN), '—');
  assert.equal(I.fmtNum(1234.5, { digits: 0 }), '1,235');
  const iso = '2026-11-04T23:30:00Z';
  const en = I.fmtDateTime(iso);
  assert.match(en, /Nov 5, 2026/);
  assert.match(en, /7:30/);
  assert.match(I.fmtTime(iso), /^7:30\s?AM$/);
  assert.equal(I.fmtDate(iso), 'Nov 5, 2026');
  assert.equal(I.fmtDateTime('not a date'), '—');
  assert.equal(I.fmtRelativeDays(-1), 'yesterday');
  await I.setLocale('zh-Hant');
  const zh = I.fmtDateTime(iso);
  assert.match(zh, /2026年11月5日/);
  assert.match(zh, /7:30/);
  assert.equal(I.list(['甲', '乙', '丙']), '甲、乙和丙');
  assert.equal(I.fmtRelativeDays(0), '今天');
  assert.equal(I.fmtNum(-1.5, { digits: 1 }), '−1.5');
});

test('setLocale notifies listeners and sets <html lang> when a document exists', async () => {
  const doc = { documentElement: { lang: '' } };
  globalThis.document = doc;
  try {
    I.setCatalog('en', { 'k.v': 'v' });
    await I.initI18n({ locale: 'zh-Hant', fetchImpl: null });
    assert.equal(doc.documentElement.lang, 'zh-Hant');
    const calls = [];
    const off = I.onLocaleChange((l, prev) => calls.push([l, prev]));
    await I.setLocale('en');
    off();
    await I.setLocale('zh-Hant');
    assert.deepEqual(calls, [['en', 'zh-Hant']]);
    assert.equal(doc.documentElement.lang, 'zh-Hant');
  } finally {
    delete globalThis.document;
  }
});

test('loader: merged i18n/<locale>.json first; else namespace files from namespaces.json; missing files skipped', async () => {
  // namespace files (dev / unit tests): app/i18n as it is in the repository
  const log = [];
  const loc = await I.initI18n({ locale: 'en', fetchImpl: fsFetch(I18N, log), base: 'mem:/' });
  assert.equal(loc, 'en');
  assert.equal(I.t('app.name'), 'Golf Swing Lab');
  assert.equal(I.t('reason.NO_CALIBRATION.short'), 'No mat calibration');
  assert.ok(log.includes('mem:/en.json') && log.includes('mem:/namespaces.json') && log.includes('mem:/en/app.json'));
  await I.setLocale('zh-Hant');
  assert.equal(I.t('app.name'), '揮桿實驗室');
  // merged file (dist/): only that file is fetched per locale
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'gsl-i18n-'));
  try {
    fs.writeFileSync(path.join(tmp, 'zh-Hant.json'), JSON.stringify({ 'app.name': '合併版', 'x.y._context': 'dropped' }));
    fs.writeFileSync(path.join(tmp, 'en.json'), JSON.stringify({ 'app.name': 'Merged' }));
    const log2 = [];
    await I.initI18n({ locale: 'en', fetchImpl: fsFetch(tmp, log2), base: 'mem:/' });
    assert.equal(I.t('app.name'), 'Merged');
    assert.deepEqual(log2, ['mem:/zh-Hant.json', 'mem:/en.json']);
    assert.equal(I.has('x.y._context'), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  // no catalog at all: keys stay visible, nothing throws
  const r = await I.initI18n({ locale: 'auto', languages: ['ja'], fetchImpl: async () => { throw new Error('offline'); }, base: 'mem:/' });
  assert.equal(r, 'en');
  assert.equal(I.t('app.name'), 'app.name');
});

test('default base resolves to app/i18n/ next to the module (works for app/ and dist/)', async () => {
  const log = [];
  await I.initI18n({ locale: 'en', fetchImpl: async (u) => { log.push(u); return { ok: false }; } });
  assert.equal(log[0], pathToFileURL(path.join(I18N, 'zh-Hant.json')).href);
});
