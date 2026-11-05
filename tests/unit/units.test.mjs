// units (PRODUCT-SPEC §3.3, §10): conversions to 1e-9 relative, CI scaling, digits table, defaults, parsing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { convert, toSI, fmtMetric, fmtQuantity, parseInput, parseLength, unitLabel, defaultUnits, normalizeUnits, DEFAULT_UNITS, metricKind, BODY_METRIC_IDS } from '../../app/src/i18n/units.js';
import { initI18n, setCatalog } from '../../app/src/i18n/index.js';
import { METRIC_IDS, METRIC_UNITS } from '../../app/src/contract/enums.js';

const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
const close = (a, b, what) => assert.ok(rel(a, b) < 1e-9, `${what}: ${a} vs ${b}`);

test('conversion factors (§3.3) to 1e-9 relative, both directions', () => {
  close(convert(1, 'm', 'yd'), 1.09361, 'm→yd');
  close(convert(1, 'm/s', 'mph'), 2.23694, 'm/s→mph');
  close(convert(1, 'm/s', 'km/h'), 3.6, 'm/s→km/h');
  close(convert(1, 'm', 'cm'), 100, 'm→cm');
  close(convert(1, 'm', 'in'), 39.3701, 'm→in');
  close(convert(1, 'mps', 'kmh'), 3.6, 'aliases');
  for (const [a, b] of [['m', 'yd'], ['m/s', 'mph'], ['m/s', 'km/h'], ['m', 'cm'], ['m', 'in'], ['yd', 'in']]) {
    for (const x of [0.013, 1, 41.7, 156.25]) close(convert(convert(x, a, b), b, a), x, `${a}↔${b} ${x}`);
  }
  close(toSI(150, 'yd'), 150 / 1.09361, 'toSI yd');
  close(toSI(100, 'mph'), 100 / 2.23694, 'toSI mph');
  assert.equal(convert(3, 'deg', 'deg'), 3);
  assert.throws(() => convert(1, 'm', 'mph'), RangeError);
  assert.throws(() => convert(1, 'm', 'furlong'), RangeError);
  assert.ok(Number.isNaN(convert(NaN, 'm', 'yd')));
});

test('defaults (§10): yd/mph/cm/in/cm; en-US adds body in and height ft/in; normalizeUnits', () => {
  assert.deepEqual({ ...DEFAULT_UNITS }, { distance: 'yd', speed: 'mph', body: 'cm', clubLength: 'in', height: 'cm' });
  assert.deepEqual(defaultUnits(['zh-TW']), { ...DEFAULT_UNITS });
  assert.deepEqual(defaultUnits(['en-US']), { ...DEFAULT_UNITS, body: 'in', height: 'ftin' });
  assert.deepEqual(defaultUnits(['en-GB']), { ...DEFAULT_UNITS });
  assert.deepEqual(normalizeUnits({ distance: 'm', speed: 'furlongs' }), { ...DEFAULT_UNITS, distance: 'm' });
});

test('metric kinds: body metrics in body units, carry in distance, speeds, fixed units', () => {
  for (const id of METRIC_IDS) {
    const k = metricKind(id, METRIC_UNITS[id]);
    if (BODY_METRIC_IDS.includes(id)) assert.equal(k, 'body', id);
    else if (METRIC_UNITS[id] === 'm') assert.equal(k, 'distance', id);
    else if (METRIC_UNITS[id] === 'm/s') assert.equal(k, 'speed', id);
  }
  assert.equal(metricKind('carry_m', 'm'), 'distance');
  assert.equal(metricKind('head_sway_x_m', 'm'), 'body');
});

test('fmtMetric: digits table, CI scaled with the same factor, hidden when it rounds to 0, nulls', async () => {
  setCatalog('zh-Hant', {});
  setCatalog('en', {});
  await initI18n({ locale: 'en', fetchImpl: null });
  const U = { ...DEFAULT_UNITS };
  const carry = fmtMetric({ value: 127.3, unit: 'm', ci95: [125.1, 129.5] }, U, { id: 'carry_m' });
  assert.equal(carry.value, String(Math.round(127.3 * 1.09361)));
  assert.equal(carry.ci, String(Math.round(2.2 * 1.09361)));
  assert.equal(carry.digits, 0);
  assert.equal(carry.unit, 'yd');
  assert.equal(carry.text, `139 ± 2 yd`);
  assert.equal(fmtMetric({ value: 127.3, unit: 'm', sigma: 1 }, { ...U, distance: 'm' }, { id: 'carry_m' }).text, '127 ± 2 m');
  const cs = fmtMetric({ value: 36.2, unit: 'm/s', sigma: 0.8 }, U, { id: 'club_speed_mps' });
  assert.equal(cs.value, (36.2 * 2.23694).toFixed(1));
  assert.equal(cs.ci, (1.96 * 0.8 * 2.23694).toFixed(1));
  assert.equal(fmtMetric({ value: 36.2, unit: 'm/s', sigma: 0.8 }, { ...U, speed: 'm/s' }, { id: 'club_speed_mps' }).text, '36.2 ± 1.6 m/s');
  assert.equal(fmtMetric({ value: 36.2, unit: 'm/s', sigma: 0.8 }, { ...U, speed: 'km/h' }, { id: 'club_speed_mps' }).digits, 0);
  const sway = fmtMetric({ value: 0.0423, unit: 'm', sigma: 0.002 }, U, { id: 'head_sway_x_m' });
  assert.equal(sway.text, '4.2 ± 0.4 cm');
  assert.equal(fmtMetric({ value: 0.0423, unit: 'm', sigma: 0.002 }, { ...U, body: 'in' }, { id: 'head_sway_x_m' }).value, (0.0423 * 39.3701).toFixed(1));
  assert.equal(fmtMetric({ value: 3.07, unit: 'ratio', sigma: 0.05 }, U, { id: 'tempo_ratio' }).text, '3.07 ± 0.10');
  assert.equal(fmtMetric({ value: 0.912, unit: 's', ci95: [0.9, 0.924] }, U, { id: 'backswing_s' }).text, '0.91 ± 0.01 s');
  assert.equal(fmtMetric({ value: -2.6, unit: 'deg', sigma: 0.1 }, U, { id: 'club_path_deg' }).text, '−3°', 'deg 0 digits, CI rounds to 0 → hidden');
  assert.equal(fmtMetric({ value: -2.6, unit: 'deg', sigma: 0.1 }, U, { id: 'club_path_deg' }).ci, null);
  assert.equal(fmtMetric({ value: 41.4, unit: '%', sigma: 2 }, U, { id: 'weight_shift_pct' }).text, '41 ± 4%');
  const nul = fmtMetric({ value: null, unit: 'm' }, U, { id: 'carry_m' });
  assert.deepEqual(nul, { value: '—', unit: '', ci: null, text: '—', digits: 0 });
  assert.equal(fmtMetric(null, U).text, '—');
  assert.equal(fmtMetric({ id: 'carry_m', value: 100, unit: 'm' }, U).unit, 'yd', 'metric.id is honoured');
});

test('fmtQuantity: height cm / ft-in, club length in / m', () => {
  assert.equal(fmtQuantity(1.75, 'height', DEFAULT_UNITS).text, '175 cm');
  assert.equal(fmtQuantity(1.778, 'height', { ...DEFAULT_UNITS, height: 'ftin' }).text, '5′10″');
  assert.equal(fmtQuantity(0.94, 'clubLength', DEFAULT_UNITS).text, `${(0.94 * 39.3701).toFixed(1)} in`);
  assert.equal(fmtQuantity(0.94, 'clubLength', { ...DEFAULT_UNITS, clubLength: 'm' }).text, '0.94 m');
  assert.equal(fmtQuantity(NaN, 'height').text, '—');
});

test('parseInput: SI result, comma decimals, ft/in forms, garbage → null', () => {
  close(parseInput('150', 'yd'), 150 / 1.09361, 'yd');
  close(parseInput('1,5', 'm'), 1.5, 'comma');
  close(parseInput('175', 'cm'), 1.75, 'cm');
  close(parseInput(' 37.5 ', 'in'), 37.5 / 39.3701, 'in');
  close(parseInput('100', 'mph'), 100 / 2.23694, 'mph');
  close(parseInput("5'10\"", 'ftin'), 70 / 39.3701, "5'10\"");
  close(parseInput('5 ft 10 in', 'ftin'), 70 / 39.3701, 'ft in words');
  close(parseInput('5′10″', 'ftin'), 70 / 39.3701, 'primes');
  close(parseInput('6', 'ftin'), 72 / 39.3701, 'bare feet');
  close(parseInput('70', 'ftin'), 70 / 39.3701, 'bare inches');
  for (const bad of ['', 'abc', '1.2.3', '5x', null, undefined]) assert.equal(parseInput(bad, 'm'), null, String(bad));
  assert.equal(parseLength, parseInput);
});

test('unitLabel: catalog label when loaded, symbol otherwise', async () => {
  setCatalog('zh-Hant', { 'unit.yd': '碼', 'unit.mph': '英里/時' });
  setCatalog('en', { 'unit.yd': 'yd' });
  await initI18n({ locale: 'zh-Hant', fetchImpl: null });
  assert.equal(unitLabel('yd'), '碼');
  assert.equal(unitLabel('m/s'), 'm/s');
  assert.equal(unitLabel('deg'), '°');
  assert.equal(unitLabel('ratio'), '');
});
