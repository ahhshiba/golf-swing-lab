// Foundation catalogs (PRODUCT-SPEC §3.1, §3.4, §2.4): both locales complete and in sync, every code / metric / club /
// view / event / screen has its text, copy rules hold, namespaces.json covers every file with disjoint owners.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REASON_CODES, APP_ERROR_CODES } from '../../app/src/contract/reason-codes.js';
import { ERROR_CODES } from '../../app/src/workers/protocol.js';
import { METRIC_IDS, VIEWS, EVENTS, VALIDITIES } from '../../app/src/contract/enums.js';
import { CLUBS } from '../../app/src/session/settings.js';
import { SCREENS } from '../../app/src/state.js';
import { mergeCatalogs } from '../../scripts/build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const I18N = path.join(ROOT, 'app', 'i18n');
const INDEX = JSON.parse(fs.readFileSync(path.join(I18N, 'namespaces.json'), 'utf8'));
const A_NS = INDEX.owners.foundation;
const cat = mergeCatalogs(path.join(ROOT, 'app'));
const zh = cat['zh-Hant'];
const en = cat.en;
const ownedKeys = (c) => Object.keys(c).filter((k) => A_NS.includes(k.split('.')[0]));
const COPY_RULE = /\b[PCK]\d{1,2}\b|\b[A-Z]{3,}_[A-Z_]+\b|\.mjs\b|sha-?256|golden|GolfDB|tcn\b/i;
const placeholders = (v) => [...new Set([...JSON.stringify(v).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

test('namespaces.json: every namespace has one owner; every catalog file is a listed namespace of a known locale', () => {
  const all = Object.values(INDEX.owners).flat();
  assert.equal(new Set(all).size, all.length, 'owners are disjoint');
  assert.deepEqual([...all].sort(), [...INDEX.namespaces].sort());
  assert.deepEqual(INDEX.locales, ['zh-Hant', 'en']);
  for (const loc of fs.readdirSync(I18N).filter((f) => fs.statSync(path.join(I18N, f)).isDirectory())) {
    assert.ok(INDEX.locales.includes(loc), loc);
    for (const f of fs.readdirSync(path.join(I18N, loc))) assert.ok(INDEX.namespaces.includes(f.replace(/\.json$/, '')), `${loc}/${f} is not in namespaces.json`);
  }
  for (const ns of A_NS) for (const loc of INDEX.locales) assert.ok(fs.existsSync(path.join(I18N, loc, `${ns}.json`)), `${loc}/${ns}.json`);
});

test('foundation namespaces: same keys, same placeholders, plural shapes per locale (100 % coverage)', () => {
  const zk = ownedKeys(zh).sort();
  const ek = ownedKeys(en).sort();
  assert.deepEqual(zk, ek);
  assert.ok(zk.length >= 390, `${zk.length} keys`);
  for (const k of zk) {
    assert.deepEqual(placeholders(zh[k]), placeholders(en[k]), `placeholders of ${k}`);
    if (typeof zh[k] === 'object') {
      assert.deepEqual(Object.keys(zh[k]), ['other'], `${k}: zh-Hant plural uses 'other' only`);
      assert.deepEqual(Object.keys(en[k]).sort(), ['one', 'other'], `${k}: en plural has one/other`);
    } else assert.equal(typeof zh[k], 'string', k);
  }
});

test('copy rules (§2.4): no spec codes, file names or model words in any foundation value; en has no CJK', () => {
  for (const [loc, c] of [['zh-Hant', zh], ['en', en]]) {
    for (const k of ownedKeys(c)) {
      const v = JSON.stringify(c[k]);
      assert.ok(!COPY_RULE.test(v), `${loc} ${k}: ${v}`);
      if (loc === 'en') assert.ok(!/[㐀-鿿]/.test(v), `en ${k} contains CJK: ${v}`);
    }
  }
});

test('every reason code has short + long in both locales; zh long is the contract description (Traditional Chinese)', () => {
  for (const c of Object.keys(REASON_CODES)) {
    for (const f of ['short', 'long']) {
      assert.ok(typeof zh[`reason.${c}.${f}`] === 'string' && zh[`reason.${c}.${f}`], `zh reason.${c}.${f}`);
      assert.ok(typeof en[`reason.${c}.${f}`] === 'string' && en[`reason.${c}.${f}`], `en reason.${c}.${f}`);
    }
    assert.match(zh[`reason.${c}.long`], /[\u4e00-\u9fff]/, `zh reason.${c}.long is the Chinese contract description`);
    assert.equal(REASON_CODES[c], c, `REASON_CODES.${c} is a code only`);
  }
  for (const k of ownedKeys(zh).filter((x) => x.startsWith('reason.'))) assert.ok(k.split('.')[1] in REASON_CODES, `${k}: unknown reason code`);
  for (const c of ['NO_CALIBRATION', 'CLIP_NOT_SAVED', 'SLOWMO_CORRECTED']) assert.ok(c in REASON_CODES, c);
});

test('every error code (worker protocol + §8.0.7 additions) has text in both locales', () => {
  const codes = [...Object.keys(ERROR_CODES), ...Object.keys(APP_ERROR_CODES), 'GPU_UNAVAILABLE', 'MODULE_MISSING'];
  for (const c of codes) {
    assert.ok(zh[`error.${c}`], `zh error.${c}`);
    assert.ok(en[`error.${c}`], `en error.${c}`);
  }
  for (const c of ['QUOTA_EXCEEDED', 'ANALYSIS_TIMEOUT', 'WORKER_CRASHED', 'WORKER_UNAVAILABLE', 'FILE_TRUNCATED', 'REPO_UNAVAILABLE', 'CAMERA_DENIED', 'CAMERA_BUSY', 'CAMERA_MISSING']) {
    assert.equal(APP_ERROR_CODES[c], c);
  }
  assert.ok('NO_SWING_FOUND' in ERROR_CODES);
});

test('metrics, clubs, views, events, validities, screens all have their text', () => {
  for (const id of METRIC_IDS) for (const f of ['label', 'short', 'meaning', 'range', 'term']) for (const [loc, c] of [['zh', zh], ['en', en]]) assert.ok(c[`metric.${id}.${f}`], `${loc} metric.${id}.${f}`);
  for (const [type] of CLUBS) assert.ok(zh[`club.${type}`] && en[`club.${type}`], type);
  for (const v of VIEWS) assert.ok(zh[`view.${v}`] && en[`view.${v}`], v);
  for (const e of EVENTS) assert.ok(zh[`event.${e}`] && en[`event.${e}`], e);
  for (const v of [...VALIDITIES, 'not_measurable']) assert.ok(zh[`validity.${v}`] && en[`validity.${v}`], v);
  for (const s of SCREENS) assert.ok(zh[`screen.${s}.title`] && en[`screen.${s}.title`], s);
  assert.equal(en['app.name'], 'Golf Swing Lab');
  assert.equal(zh['app.name'], '揮桿實驗室');
});
