// ui/components.js (PRODUCT-SPEC §1.5, §8.0.3) on the fake DOM (tests/unit/_fakedom.mjs): every frozen component
// exists, builds accessible DOM, keeps testids, and behaves (reason lines, radios, switches, sheets, toasts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDocument, fakeTimers } from './_fakedom.mjs';
import * as Comp from '../../app/src/ui/components.js';
import { createComponents } from '../../app/src/ui/components.js';
import { ICON_NAMES, ICON_PATHS, spriteMarkup, injectSprite } from '../../app/src/ui/icons.js';
import { setCatalog, initI18n } from '../../app/src/i18n/index.js';

setCatalog('zh-Hant', {
  'common.close': '關閉', 'common.cancel': '取消', 'common.confirm': '確定', 'common.back': '返回', 'common.eta': '約 {s} 秒',
  'common.choose_file': '選擇檔案', 'common.choose_files': '選擇影片', 'common.drop_files': '拖到這裡',
  'validity.valid': '可信', 'validity.estimated': '估計', 'validity.low_confidence': '低可信', 'validity.not_observable': '量不到',
  'validity.not_measurable': '量不到', 'validity.not_computed': '未計算', 'metric.carry_m.label': '飛行距離', 'unit.yd': '碼',
  'a11y.step_done': '已完成', 'a11y.step_active': '進行中', 'a11y.step_pending': '尚未開始', 'a11y.step_error': '失敗',
  'metric.spin_rate_rpm.label': '旋轉量', 'metric.curve_m.label': '彎曲量', 'unit.rpm': '轉/分', 'tiles.estimated_badge': '估計',
  'reason.LAUNCH_DIR_UNOBSERVABLE.short': '這個機位看不到左右',
});
setCatalog('en', {});
await initI18n({ locale: 'zh-Hant', fetchImpl: null });

const FROZEN = ['button', 'listRow', 'segmented', 'switchRow', 'metricTile', 'dataTile', 'validityTag', 'statePill', 'notice', 'emptyState', 'sheet',
  'confirmSheet', 'filePicker', 'progressSteps', 'chipRow', 'screenHeader', 'icon', 'toast'];

test('every frozen component is exported by name and by createComponents(doc)', () => {
  const C = createComponents(fakeDocument());
  for (const n of FROZEN) {
    assert.ok(n in Comp, `export ${n}`);
    assert.ok(n in C, `createComponents().${n}`);
  }
  assert.equal(typeof Comp.toast.info, 'function');
  assert.equal(typeof Comp.toast.error, 'function');
  assert.throws(() => createComponents(null), TypeError);
});

test('integration (§8.7): the deprecated dom.js toast() alias is gone; no app module calls a bare toast()', async () => {
  const dom = await import('../../app/src/ui/dom.js');
  assert.ok(!('toast' in dom), 'ui/dom.js no longer exports toast');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = new URL('../../app/src/', import.meta.url).pathname;
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
  const bad = [];
  for (const f of walk(root)) {
    const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    if (/(^|[^.\w$])toast\s*\(/.test(src)) bad.push(path.relative(root, f));
  }
  assert.deepEqual(bad, []);
});

test('button: variants/sizes as classes, testid, click; reason disables and shows the reason line', () => {
  const C = createComponents(fakeDocument());
  let n = 0;
  const b = C.button({ label: '開始練習', variant: 'primary', size: 'lg', testid: 'btn-start', icon: 'camera', onClick: () => n++ });
  assert.equal(b.tagName, 'BUTTON');
  assert.equal(b.getAttribute('type'), 'button');
  assert.ok(b.classList.contains('btn-primary') && b.classList.contains('btn-lg'));
  assert.equal(b.getAttribute('data-testid'), 'btn-start');
  b.click();
  assert.equal(n, 1);
  b.setReason('先完成架設');
  assert.equal(b.disabled, true);
  assert.match(b.textContent, /開始練習.*先完成架設/);
  b.click();
  assert.equal(n, 1, 'a disabled button does not fire');
  b.setReason(null);
  assert.equal(b.disabled, false);
  assert.equal(b.querySelector('.btn-reason').hidden, true);
  const d = C.button({ label: 'x', disabled: true });
  d.setReason(null);
  assert.equal(d.disabled, true, 'explicit disabled survives setReason(null)');
  d.setDisabled(false);
  assert.equal(d.disabled, false);
  b.setLabel('回到即時模式');
  assert.match(b.textContent, /回到即時模式/);
});

test('listRow, segmented (radiogroup + arrows), chipRow, switchRow (role=switch)', () => {
  const C = createComponents(fakeDocument());
  let tapped = 0;
  const r = C.listRow({ icon: 'target', title: '角度', value: '正面', onClick: () => tapped++, testid: 'row-view' });
  assert.equal(r.tagName, 'BUTTON');
  assert.equal(r.querySelector('.lr-value').textContent, '正面');
  assert.ok(!/null|undefined/.test(r.textContent));
  // value and chevron share one trailing box (they wrap together at 200 % text)
  const end = r.querySelector('.lr-end');
  assert.ok(end && end.querySelector('.lr-value') && end.querySelector('.lr-chevron'), 'value + chevron inside .lr-end');
  assert.equal(C.listRow({ title: 'y', onClick() {} }).querySelector('.lr-end'), null, 'no value: bare chevron');
  r.click();
  assert.equal(tapped, 1);
  assert.equal(C.listRow({ title: 'x' }).tagName, 'DIV');
  const got = [];
  const s = C.segmented({ options: [['a', 'A'], ['b', 'B'], ['c', 'C']], value: 'b', onChange: (v) => got.push(v), label: 'L' });
  assert.equal(s.getAttribute('role'), 'radiogroup');
  const opts = s.querySelectorAll('[role="radio"]');
  assert.deepEqual(opts.map((o) => o.getAttribute('aria-checked')), ['false', 'true', 'false']);
  opts[2].click();
  assert.equal(s.value, 'c');
  opts[2].dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
  assert.equal(s.value, 'a');
  assert.deepEqual(got, ['c', 'a']);
  s.value = 'b';
  assert.deepEqual(got, ['c', 'a'], 'setting .value does not fire onChange');
  const chips = C.chipRow({ items: [['7i', '7 號鐵'], ['pw', '劈起桿']], value: '7i' });
  assert.ok(chips.classList.contains('chip-row'));
  assert.equal(chips.value, '7i');
  let on = null;
  const sw = C.switchRow({ label: '語音', checked: true, onChange: (v) => { on = v; }, testid: 'sw-voice' });
  assert.equal(sw.control.getAttribute('role'), 'switch');
  assert.equal(sw.control.getAttribute('data-testid'), 'sw-voice');
  assert.equal(sw.control.getAttribute('aria-checked'), 'true');
  sw.control.click();
  assert.equal(on, false);
  assert.equal(sw.checked, false);
});

test('validityTag glyphs + text; metricTile value/unit/CI/label; null tile', () => {
  const C = createComponents(fakeDocument());
  assert.equal(C.validityTag('valid').textContent, '●可信');
  assert.equal(C.validityTag('estimated').textContent, '◐估計');
  assert.equal(C.validityTag('low_confidence').textContent, '▲低可信');
  assert.equal(C.validityTag('not_observable').textContent, '—量不到');
  assert.ok(C.validityTag('weird').classList.contains('vtag-null'));
  const tile = C.metricTile({ id: 'carry_m', size: 'hero', metric: { value: 127.3, unit: 'm', ci95: [125.1, 129.5], validity: 'estimated' }, units: { distance: 'yd' } });
  assert.ok(tile.classList.contains('tile-hero'));
  assert.equal(tile.getAttribute('data-metric'), 'carry_m');
  assert.equal(tile.querySelector('.mt-label').textContent, '飛行距離');
  assert.equal(tile.querySelector('.mt-num').textContent, '139');
  assert.equal(tile.querySelector('.mt-unit').textContent, '碼');
  assert.equal(tile.querySelector('.mt-ci').textContent, '± 2');
  const nul = C.metricTile({ id: 'carry_m', metric: { value: null, unit: 'm', validity: 'not_observable' } });
  assert.ok(nul.classList.contains('is-null'));
  assert.equal(nul.querySelector('.mt-num').textContent, '—');
  assert.equal(nul.querySelector('.mt-ci'), null);
  assert.ok(!/null|undefined/.test(nul.textContent));
});

test('dataTile (LAUNCH-MONITOR-SPEC §3.2): big number, unit, ± range, validity mark with text, the estimated word, null reason', () => {
  const C = createComponents(fakeDocument());
  const spin = { value: 2650, unit: 'rpm', ci95: [1905, 3395], sigma: 380, validity: 'estimated', value_origin: 'spin_model', measured: false, reason_codes: ['SPIN_MODELLED'] };
  const t = C.dataTile({ id: 'spin_rate_rpm', metric: spin, testid: 'shot-tile' });
  assert.equal(t.tagName, 'DIV');
  assert.equal(t.getAttribute('data-metric'), 'spin_rate_rpm');
  assert.equal(t.getAttribute('data-testid'), 'shot-tile');
  assert.equal(t.getAttribute('data-validity'), 'estimated');
  assert.ok(t.classList.contains('data-tile') && t.classList.contains('is-inferred'));
  assert.equal(t.querySelector('.dt-label').textContent, '旋轉量');
  assert.equal(t.querySelector('.mt-num').textContent, '2,650');
  assert.equal(t.querySelector('.mt-unit').textContent, '轉/分');
  assert.equal(t.querySelector('.mt-ci').textContent, '± 745');
  assert.equal(t.querySelector('.dt-est').textContent, '估計');
  // estimated: a readable pill (glyph + word, the same vtag pill as the result list), not a corner sliver
  assert.ok(t.querySelector('.dt-mark').classList.contains('vtag') && t.querySelector('.dt-mark').classList.contains('vtag-est'), 'vtag pill');
  assert.ok(t.querySelector('.dt-mark').textContent.startsWith('◐'), 'glyph');
  assert.ok(t.querySelector('.dt-mark').textContent.includes('估計'), 'validity in words too (not colour only)');
  // a tracked number has no 'estimated' word; a custom badge text wins; onClick makes it a button
  let clicked = null;
  const carry = C.dataTile({ id: 'carry_m', metric: { value: 181, unit: 'm', ci95: [160, 202], sigma: null, validity: 'estimated', value_origin: 'ballistics', reason_codes: [] }, units: { distance: 'm' }, onClick: (e, id) => { clicked = id; } });
  assert.equal(carry.tagName, 'BUTTON');
  assert.equal(carry.querySelector('.dt-est'), null);
  assert.equal(carry.querySelector('.dt-mark').textContent, '◐估計', 'every estimated tile gets the pill, inferred or not');
  const low = C.dataTile({ id: 'carry_m', metric: { value: 181, unit: 'm', ci95: null, sigma: null, validity: 'low_confidence', value_origin: 'ballistics', reason_codes: [] } });
  assert.equal(low.querySelector('.dt-mark').textContent, '▲低可信');
  const ok = C.dataTile({ id: 'carry_m', metric: { value: 181, unit: 'm', ci95: null, sigma: null, validity: 'valid', value_origin: 'ballistics', reason_codes: [] } });
  assert.ok(ok.querySelector('.dt-mark').classList.contains('visually-hidden'), 'measured: words for screen readers only');
  carry.dispatchEvent({ type: 'click' });
  assert.equal(clicked, 'carry_m');
  assert.equal(C.dataTile({ id: 'spin_rate_rpm', metric: spin, estimatedBadge: 'EST' }).querySelector('.dt-est').textContent, 'EST');
  // null: '—' and the first reason's short text, no unit, no range
  const nul = C.dataTile({ id: 'curve_m', metric: { value: null, unit: 'm', ci95: null, sigma: null, validity: 'not_observable', value_origin: 'flight_model', measured: false, reason_codes: ['LAUNCH_DIR_UNOBSERVABLE'] } });
  assert.ok(nul.classList.contains('is-null') && !nul.classList.contains('is-inferred'));
  assert.equal(nul.querySelector('.mt-num').textContent, '—');
  assert.equal(nul.querySelector('.mt-unit'), null);
  assert.equal(nul.querySelector('.mt-ci'), null);
  assert.equal(nul.querySelector('.dt-reason').textContent, '這個機位看不到左右');
  assert.ok(nul.querySelector('.dt-mark').classList.contains('visually-hidden') && nul.querySelector('.dt-mark').textContent === '量不到');
  assert.ok(!/null|undefined/.test(nul.textContent));
  // isInferred: model origins or model / prior codes, numbers only
  assert.equal(Comp.isInferred(spin), true);
  assert.equal(Comp.isInferred({ value: 50, value_origin: 'derived', reason_codes: ['SMASH_ASSUMED'] }), true);
  assert.equal(Comp.isInferred({ value: null, value_origin: 'dplane', reason_codes: [] }), false);
  assert.deepEqual([...Comp.INFERRED_ORIGINS], ['dplane', 'spin_model', 'flight_model', 'prior']);
});

test('statePill is a persistent polite live region with update(); notice, emptyState', () => {
  const C = createComponents(fakeDocument());
  const p = C.statePill({ state: 'ready', text: '準備好了', testid: 'live-state' });
  assert.equal(p.getAttribute('aria-live'), 'polite');
  assert.equal(p.getAttribute('data-state'), 'ready');
  p.update('analysing', '分析中');
  assert.equal(p.getAttribute('data-state'), 'analysing');
  assert.match(p.textContent, /分析中/);
  p.update('bogus', 'x');
  assert.equal(p.getAttribute('data-state'), 'ready');
  const n = C.notice({ variant: 'caution', title: '2 項提醒', items: ['a', 'b'], collapsible: true });
  assert.equal(n.tagName, 'DETAILS');
  assert.equal(n.querySelectorAll('li').length, 2);
  assert.equal(C.notice({ variant: 'error', title: 'x' }).getAttribute('role'), 'alert');
  let act = 0;
  const e = C.emptyState({ icon: 'film-off', title: '沒有保存影片', body: 'b', action: { label: '再試', onClick: () => act++, testid: 'es-act' } });
  e.querySelector('[data-testid="es-act"]').click();
  assert.equal(act, 1);
});

test('sheet: dialog, opens into body, focus moves in and returns to the opener, Esc closes; confirmSheet resolves', async () => {
  const doc = fakeDocument();
  const C = createComponents(doc);
  const opener = C.button({ label: 'open' });
  doc.body.append(opener);
  opener.focus();
  let closed = 0;
  const s = C.sheet({ title: '球桿', content: C.button({ label: 'inside', testid: 'in' }), onClose: () => closed++ });
  s.open();
  assert.ok(s.isOpen());
  assert.equal(s.el.getAttribute('role'), 'dialog');
  assert.equal(s.el.getAttribute('aria-modal'), 'true');
  assert.ok(doc.body.querySelector('.sheet-backdrop'));
  assert.equal(doc.activeElement.getAttribute('data-testid'), 'in');
  s.el.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(s.isOpen(), false);
  assert.equal(closed, 1);
  assert.equal(doc.activeElement, opener);
  assert.equal(doc.body.querySelector('.sheet-backdrop'), null);
  const p = C.confirmSheet({ title: '結束練習？', consequence: '這次練習會被結束', confirmLabel: '結束', destructive: true });
  const yes = doc.body.querySelector('[data-testid="confirm-yes"]');
  assert.ok(yes.classList.contains('btn-destructive'));
  assert.ok(doc.body.querySelector('[data-testid="confirm-no"]').classList.contains('btn-primary'), 'the safe action is primary');
  yes.click();
  assert.equal(await p, true);
  const q = C.confirmSheet({ title: 't' });
  doc.body.querySelector('[data-testid="confirm-no"]').click();
  assert.equal(await q, false);
});

test('filePicker keeps the input testid and id; progressSteps states and ETA; screenHeader', () => {
  const C = createComponents(fakeDocument());
  let files = null;
  const fp = C.filePicker({ accept: 'video/*', multiple: true, testid: 'import-file-input', id: 'import-file', onFiles: (f) => { files = f; } });
  assert.equal(fp.tagName, 'LABEL');
  assert.equal(fp.input.getAttribute('type'), 'file');
  assert.equal(fp.input.getAttribute('data-testid'), 'import-file-input');
  assert.equal(fp.input.getAttribute('id'), 'import-file');
  assert.ok(fp.input.hasAttribute('multiple'));
  fp.input.files = [{ name: 'a.mov' }];
  fp.input.dispatchEvent({ type: 'change' });
  assert.deepEqual(files, [{ name: 'a.mov' }]);
  const ps = C.progressSteps({ steps: [{ id: 'probe', label: '探測' }, { id: 'pose', label: '姿勢' }], testid: 'import-queue' });
  ps.set('probe', 'done');
  ps.set('pose', 'active');
  const li = ps.el.querySelectorAll('li');
  assert.deepEqual(li.map((x) => x.getAttribute('data-state')), ['done', 'active']);
  assert.equal(li[1].getAttribute('aria-current'), 'step');
  ps.eta(11.6);
  assert.equal(ps.el.querySelector('.ps-eta').textContent, '約 12 秒');
  ps.reset();
  assert.equal(ps.el.querySelector('.ps-eta').hidden, true);
  let back = 0;
  const hd = C.screenHeader({ title: '歷史', back: true, onBack: () => back++ });
  assert.equal(hd.querySelector('h1').getAttribute('tabindex'), '-1');
  hd.querySelector('button.back').click();
  assert.equal(back, 1);
  assert.equal(C.screenHeader({ title: 'x' }).querySelector('button.back'), null);
});

test('toast.info auto-hides after 4000 + 60 ms × chars; toast.error is role=alert, persists, closes, mirrors to a slot', () => {
  const doc = fakeDocument();
  const timers = fakeTimers();
  const C = createComponents(doc, { timers });
  const el = C.toast.info('已儲存', { action: { label: '復原', testid: 'undo-toast' } });
  assert.equal(el.getAttribute('role'), 'status');
  assert.equal(el.hidden, false);
  assert.ok(el.querySelector('[data-testid="undo-toast"]'));
  timers.run(4000 + 60 * 3 - 1);
  assert.equal(el.hidden, false);
  timers.run(1);
  assert.equal(el.hidden, true);
  const slot = doc.createElement('div');
  doc.body.append(slot);
  const er = C.toast.error('手機儲存空間不足', { slot });
  assert.equal(er.getAttribute('role'), 'alert');
  timers.run(60000);
  assert.equal(er.hidden, false, 'errors persist');
  assert.equal(slot.querySelector('.error-slot-msg').textContent, '手機儲存空間不足');
  er.querySelector('button').click();
  assert.equal(er.hidden, true);
});

test('icons: every §1.6 name exists; sprite has one symbol per icon; icon() is aria-hidden unless labelled', () => {
  const want = ['chevron-left', 'chevron-right', 'chevron-down', 'camera', 'camera-off', 'film', 'film-off', 'history', 'settings', 'info',
    'target', 'level', 'sun', 'lock', 'play', 'pause', 'step-back', 'step-forward', 'flag', 'ruler', 'trash', 'download', 'upload', 'share',
    'check', 'alert', 'x', 'star', 'star-filled', 'undo', 'mic-off', 'tripod', 'phone-landscape', 'phone-portrait', 'help', 'shield', 'club'];
  for (const n of want) assert.ok(ICON_NAMES.includes(n), n);
  const sprite = spriteMarkup();
  assert.equal((sprite.match(/<symbol /g) || []).length, ICON_NAMES.length);
  for (const n of ICON_NAMES) assert.ok(!/https?:|url\(/.test(ICON_PATHS[n]), n);
  const doc = fakeDocument();
  assert.ok(injectSprite(doc));
  assert.equal(injectSprite(doc), doc.getElementById('icon-sprite'), 'idempotent');
});
