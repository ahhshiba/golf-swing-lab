// ui/quickcard.js on the fake DOM (zh-Hant and en catalogs from disk): the provisional card has data-stage
// "provisional", every number tile carries the 速報 tag and a ± range (.mt-ci), carry says where it comes from (never
// "measured"); refined() turns the same card into the full analysis in place with "quick a → full b" on changed
// numbers, keeps a quick-only number (carry in live mode) tagged as quick, and leaves a newer quick read alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeDocument } from './_fakedom.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const I18N = path.join(ROOT, 'app', 'i18n');
const fsFetch = (url) => {
  const p = path.join(I18N, String(url).replace(/^mem:\//, ''));
  if (!fs.existsSync(p)) return Promise.resolve({ ok: false, status: 404, json: async () => { throw new Error('404'); } });
  const txt = fs.readFileSync(p, 'utf8');
  return Promise.resolve({ ok: true, status: 200, json: async () => JSON.parse(txt) });
};
const metric = (value, half, unit, extra = {}) => ({ value, unit, ci95: [value - half, value + half], sigma: half / 1.96, validity: 'low_confidence', value_origin: 'pose', measured: false, reason_codes: ['PROVISIONAL'], ...extra });
const quickResult = (t, src = 'gapping') => ({
  stage: 'provisional', t_impact: t, carry_source: src, carry_merge: null,
  metrics: { tempo_ratio: metric(3.1, 0.4, 'ratio'), club_speed_mps: { value: null, unit: 'm/s', ci95: null, sigma: null, validity: 'not_observable', value_origin: 'pose', measured: false, reason_codes: ['PROVISIONAL', 'VIEW_DEPTH_AXIS'] }, carry_m: metric(150, 30, 'm', { value_origin: 'prior' }) },
});

for (const locale of ['zh-Hant', 'en']) {
  test(`quick card (${locale}): provisional tiles, refined in place, quick-only carry stays tagged`, async () => {
    const I = await import('../../app/src/i18n/index.js');
    await I.initI18n({ locale, fetchImpl: fsFetch, base: 'mem:/' });
    const doc = fakeDocument();
    globalThis.document = doc;
    globalThis.Node = Object.getPrototypeOf(doc.createTextNode('').constructor);
    try {
      const { mountQuickCard, quickIds } = await import('../../app/src/ui/quickcard.js');
      assert.deepEqual(quickIds(undefined), ['tempo_ratio', 'club_speed_mps', 'carry_m']);
      assert.deepEqual(quickIds({ metrics: ['head_sway_x_m', 'tempo_ratio'] }), ['tempo_ratio']);
      const el = doc.createElement('div');
      doc.body.append(el);
      const app = { settings: () => ({ live: {} }), units: () => undefined };
      const card = mountQuickCard(el, app);
      const r = quickResult(10.5);
      card.provisional(r);
      const c = el.querySelector('[data-testid="quick-card"]');
      assert.ok(c);
      assert.equal(c.getAttribute('data-stage'), 'provisional');
      assert.equal(c.getAttribute('data-t-impact'), '10.500');
      const tiles = c.querySelectorAll('.qc-tile');
      assert.equal(tiles.length, 3);
      for (const tl of tiles) {
        assert.ok(tl.textContent.includes(I.t('quick.provisional')), 'every tile says 速報');
        const id = tl.getAttribute('data-metric');
        if (r.metrics[id].value !== null) assert.ok(tl.querySelector('.mt-ci'), `${id}: ± range`);
      }
      const carry = c.querySelector('[data-metric="carry_m"]');
      assert.ok(carry.textContent.includes(I.t('quick.source.gapping')));
      // refined: tempo changes 3.1 -> 2.8, club speed appears, carry stays the quick value
      const shot = { metrics: { tempo_ratio: { value: 2.8, unit: 'ratio', ci95: [2.6, 3.0], sigma: null, validity: 'valid', value_origin: 'derived', measured: false, reason_codes: [] },
        club_speed_mps: { value: 41, unit: 'm/s', ci95: [31, 51], sigma: 5, validity: 'low_confidence', value_origin: 'pose', measured: false, reason_codes: [] },
        carry_m: { value: null, unit: 'm', ci95: null, sigma: null, validity: 'not_computed', value_origin: 'ballistics', measured: false, reason_codes: ['DEPENDS_ON_NULL'] } } };
      assert.equal(card.refined(shot, { quick: r, hold: true }), true);
      const c2 = el.querySelector('[data-testid="quick-card"]');
      assert.equal(c2.getAttribute('data-stage'), 'refined');
      const tempo = c2.querySelector('[data-metric="tempo_ratio"]');
      assert.equal(tempo.getAttribute('data-stage'), 'refined');
      assert.ok(tempo.textContent.includes(I.t('quick.refined')));
      const { fmtMetric } = await import('../../app/src/i18n/units.js');
      const fmt = (m) => fmtMetric(m, undefined, { id: 'tempo_ratio' }).value;
      assert.equal(tempo.querySelector('.qc-change').textContent, I.t('quick.change', { from: fmt(r.metrics.tempo_ratio), to: fmt(shot.metrics.tempo_ratio) }));
      assert.equal(c2.querySelector('[data-metric="club_speed_mps"]').querySelector('.qc-change'), null, 'no quick number to compare');
      const carry2 = c2.querySelector('[data-metric="carry_m"]');
      assert.equal(carry2.getAttribute('data-stage'), 'provisional');
      assert.ok(carry2.textContent.includes(I.t('quick.provisional')));
      // an older swing's refined shot while a newer quick read is on screen: the card stays
      const r2 = quickResult(20);
      card.provisional(r2);
      assert.equal(card.refined(shot, { quick: r }), false);
      assert.equal(el.querySelector('[data-testid="quick-card"]').getAttribute('data-t-impact'), '20.000');
      assert.equal(card.drop(r2), true);
      assert.equal(el.querySelector('[data-testid="quick-card"]'), null);
      // nav focus (V4-F practice card): that metric first, even one the quick read does not have (honest null + reason)
      const el2 = doc.createElement('div');
      doc.body.append(el2);
      const fcard = mountQuickCard(el2, app, { focus: () => 'early_extension_m' });
      fcard.provisional(quickResult(30));
      const ft = el2.querySelectorAll('.qc-tile');
      assert.equal(ft[0].getAttribute('data-metric'), 'early_extension_m');
      assert.equal(ft.length, 3);
      assert.ok(ft[0].textContent.includes('—'));
      assert.equal(ft[0].querySelector('.qc-tag'), null, 'no quick tag on a metric the quick read does not have');
      assert.equal(ft[0].getAttribute('data-stage'), 'none');
      assert.equal(ft[0].querySelector('.qc-note').textContent, I.t('quick.not_quick'));
      assert.ok(!I.t('quick.not_quick').startsWith('quick.'), 'catalog has quick.not_quick');
      // no measured wording anywhere in the quick catalog
      for (const k of ['provisional', 'source.pose', 'source.gapping', 'source.reference']) assert.ok(!/量到|measured/i.test(I.t(`quick.${k}`)), k);
    } finally {
      delete globalThis.document;
      delete globalThis.Node;
    }
  });
}

test('quick catalogs: same keys and placeholders in both locales', () => {
  const zh = JSON.parse(fs.readFileSync(path.join(I18N, 'zh-Hant', 'quick.json'), 'utf8'));
  const en = JSON.parse(fs.readFileSync(path.join(I18N, 'en', 'quick.json'), 'utf8'));
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  const ph = (v) => [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const k of Object.keys(zh)) assert.deepEqual(ph(zh[k]), ph(en[k]), k);
});
