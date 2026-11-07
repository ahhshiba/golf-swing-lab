// V04-SPEC §G.3 V4-F 2: interval wholly beyond the threshold -> fault; interval across it -> possible +
// FAULT_INCONCLUSIVE; point estimate inside -> ok; null value -> unknown with the value's reason codes; relaxed widens
// every threshold's distance from its neutral point by 1.5; the record is golf-lab/1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFaults, judge, faultValidity, confidenceKey, labAlgorithm, shownFaults } from '../../app/src/lab/faults.js';
import { ruleFor, LAB_PARAMS, FAULT_IDS } from '../../app/src/lab/params.js';
import { validateLabRecord, LAB_SCHEMA } from '../../app/src/contract/round.js';
import { normalizeLab } from '../../app/src/lab/settings.js';

const metric = (value, sigma, o = {}) => (value === null
  ? { value: null, unit: 'm', ci95: null, sigma: null, validity: o.validity ?? 'not_computed', value_origin: 'pose', reason_codes: o.codes ?? ['EVENTS_UNCERTAIN'] }
  : { value, unit: 'm', ci95: o.ci95 ?? [value - 1.96 * sigma, value + 1.96 * sigma], sigma, validity: o.validity ?? 'valid', value_origin: 'pose', reason_codes: o.codes ?? [] });
const run = (view, fps, metrics, settings = {}) => evaluateFaults({ shot: { shot_id: 'x', capture: { view, nominal_fps: fps }, metrics, events: {} }, poseSeq: null, view, fps, settings, at: '2026-11-07T01:02:03.000Z' });
const get = (rec, id) => rec.faults.find((f) => f.id === id);

test('judge: one-sided and band rules', () => {
  assert.equal(judge({ value: 0.1, sigma: 0.01 }, '>', 0.05), 'fault');
  assert.equal(judge({ value: 0.06, sigma: 0.01 }, '>', 0.05), 'possible');
  assert.equal(judge({ value: 0.05, sigma: 0.01 }, '>', 0.05), 'ok');
  assert.equal(judge({ value: 0.02, sigma: 0.2 }, '>', 0.05), 'ok');
  assert.equal(judge({ value: -10, sigma: 0.5 }, '<', -8), 'fault');
  assert.equal(judge({ value: -9, sigma: 2 }, '<', -8), 'possible');
  assert.equal(judge({ value: 2.0, sigma: 0.1 }, 'outside', [2.4, 3.6]), 'fault');
  assert.equal(judge({ value: 2.3, sigma: 0.1 }, 'outside', [2.4, 3.6]), 'possible');
  assert.equal(judge({ value: 4.2, sigma: 0.2 }, 'outside', [2.4, 3.6]), 'fault');
  assert.equal(judge({ value: 3.0, sigma: 2 }, 'outside', [2.4, 3.6]), 'ok');
  // a stored ci95 wins over sigma (asymmetric intervals)
  assert.equal(judge({ value: 0.08, sigma: 0.001, ci95: [0.04, 0.09] }, '>', 0.05), 'possible');
});

test('dtl early extension: fault / possible (+ FAULT_INCONCLUSIVE) / ok, value and threshold stored', () => {
  const f1 = get(run('dtl', 30, { early_extension_m: metric(0.1, 0.01) }), 'early_extension');
  assert.equal(f1.status, 'fault'); assert.equal(f1.value, 0.1); assert.equal(f1.threshold, 0.05); assert.equal(f1.event, 'impact');
  assert.ok(!f1.reason_codes.includes('FAULT_INCONCLUSIVE'));
  const f2 = get(run('dtl', 30, { early_extension_m: metric(0.06, 0.02) }), 'early_extension');
  assert.equal(f2.status, 'possible'); assert.ok(f2.reason_codes.includes('FAULT_INCONCLUSIVE'));
  const f3 = get(run('dtl', 30, { early_extension_m: metric(0.01, 0.01) }), 'early_extension');
  assert.equal(f3.status, 'ok'); assert.ok(!f3.reason_codes.includes('FAULT_INCONCLUSIVE'));
});

test('a null value -> unknown carrying the value\'s own reason codes; a missing metric -> DEPENDS_ON_NULL', () => {
  const f = get(run('dtl', 30, { early_extension_m: metric(null, null, { codes: ['POSE_LOW_VISIBILITY', 'OUT_OF_FRAME'] }) }), 'early_extension');
  assert.equal(f.status, 'unknown'); assert.deepEqual(f.reason_codes, ['POSE_LOW_VISIBILITY', 'OUT_OF_FRAME']); assert.equal(f.value, null);
  const g = get(run('face_on', 30, {}), 'head_dip');
  assert.equal(g.status, 'unknown'); assert.deepEqual(g.reason_codes, ['DEPENDS_ON_NULL']);
});

test('the value\'s reason codes travel with the judgement and set its validity words', () => {
  const rec = run('face_on', 60, { head_lift_z_m: metric(-0.2, 0.01, { codes: ['BODY_PLANE_ASSUMED'], validity: 'low_confidence' }), weight_shift_pct: metric(80, 5, { validity: 'estimated' }) });
  const dip = get(rec, 'head_dip');
  assert.equal(dip.status, 'fault'); assert.deepEqual(dip.reason_codes, ['BODY_PLANE_ASSUMED']);
  assert.equal(faultValidity(dip), 'low_confidence');
  assert.equal(confidenceKey(dip), 'likely');
  const wb = get(rec, 'weight_back');
  assert.equal(wb.status, 'ok'); assert.equal(confidenceKey(wb), null);
  // never better than estimated: the thresholds are rules of thumb
  assert.equal(faultValidity({ id: 'early_extension', status: 'fault', reason_codes: [] }, { capture: { view: 'dtl' }, metrics: { early_extension_m: metric(0.1, 0.01) } }), 'estimated');
  assert.equal(faultValidity({ id: 'early_extension', status: 'fault', reason_codes: [] }, { capture: { view: 'dtl' }, metrics: { early_extension_m: metric(0.1, 0.01, { validity: 'low_confidence' }) } }), 'low_confidence');
  assert.equal(faultValidity({ id: 'sway', status: 'unknown', reason_codes: ['VIEW_DEPTH_AXIS'] }), null);
  assert.equal(confidenceKey({ status: 'possible' }), 'possible');
  assert.equal(confidenceKey({ status: 'unknown' }), 'unknown');
});

test('relaxed: |threshold − neutral| × 1.5 for every rule (always more lenient)', () => {
  assert.equal(LAB_PARAMS.relaxedFactor, 1.5);
  for (const id of FAULT_IDS) {
    for (const view of ['face_on', 'dtl', 'high_behind']) {
      const s = ruleFor(id, view, 'standard');
      if (!s.allowed) continue;
      const r = ruleFor(id, view, 'relaxed');
      const n = LAB_PARAMS.faults[id].neutral;
      const pairs = Array.isArray(s.threshold) ? s.threshold.map((x, i) => [x, r.threshold[i]]) : [[s.threshold, r.threshold]];
      for (const [a, b] of pairs) assert.ok(Math.abs((b - n) - 1.5 * (a - n)) < 1e-9, `${id} ${view}: ${a} -> ${b}`);
    }
  }
  assert.ok(Math.abs(ruleFor('early_extension', 'dtl', 'relaxed').threshold - 0.075) < 1e-12);
  assert.equal(ruleFor('loss_of_posture', 'dtl', 'relaxed').threshold, -12);
  assert.deepEqual(ruleFor('tempo_off', 'face_on', 'relaxed').threshold.map((x) => +x.toFixed(6)), [2.1, 3.9]);
  assert.equal(ruleFor('weight_back', 'face_on', 'standard').threshold, 0);
  assert.equal(ruleFor('weight_back', 'face_on', 'relaxed').threshold, -12.5);
  // a value that is a fault under standard is ok under relaxed
  const m = { early_extension_m: metric(0.07, 0.005) };
  assert.notEqual(get(run('dtl', 30, m), 'early_extension').status, 'ok');
  assert.equal(get(run('dtl', 30, m, { sensitivity: 'relaxed' }), 'early_extension').status, 'ok');
  assert.ok(Math.abs(get(run('dtl', 30, m, { sensitivity: 'relaxed' }), 'early_extension').threshold - 0.075) < 1e-12);
});

test('default sensitivity is standard (owner decision Q5)', () => {
  assert.equal(normalizeLab(undefined).sensitivity, 'standard');
  const m = { early_extension_m: metric(0.07, 0.005) };
  assert.notEqual(get(run('dtl', 30, m, undefined), 'early_extension').status, 'ok');
});

test('tempo band stores the bound on the value\'s side; whole-swing event null', () => {
  const lo = get(run('high_behind', 240, { tempo_ratio: metric(1.8, 0.05) }), 'tempo_off');
  assert.equal(lo.status, 'fault'); assert.equal(lo.threshold, 2.4); assert.equal(lo.event, null);
  const hi = get(run('high_behind', 240, { tempo_ratio: metric(4.5, 0.05) }), 'tempo_off');
  assert.equal(hi.threshold, 3.6);
});

test('record: golf-lab/1 shape, algo version + sha256 of the params, computed_at', () => {
  const rec = run('dtl', 30, { early_extension_m: metric(0.1, 0.01) });
  assert.ok(validateLabRecord(rec).ok, JSON.stringify(validateLabRecord(rec).errors));
  assert.equal(LAB_SCHEMA, 'golf-lab/1');
  assert.equal(rec.algo.version, LAB_PARAMS.version);
  assert.match(rec.algo.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(labAlgorithm(), rec.algo);
  assert.equal(rec.computed_at, '2026-11-07T01:02:03.000Z');
  assert.deepEqual(rec.faults.map((f) => f.id), [...FAULT_IDS]);
  for (const f of rec.faults) assert.deepEqual(Object.keys(f).sort(), ['event', 'id', 'reason_codes', 'sigma', 'status', 'threshold', 'value']);
  assert.deepEqual(shownFaults(rec).map((f) => f.id), ['early_extension']);
  assert.throws(() => evaluateFaults({ shot: {}, view: 'side', fps: 30 }), RangeError);
});

test('sysSigma: the systematic allowance widens the judgement interval (dtl early extension, head lift)', () => {
  const ee = get(run('dtl', 30, { early_extension_m: metric(0.07, 0.005) }), 'early_extension');
  assert.ok(Math.abs(ee.sigma - Math.hypot(0.005, 0.010)) < 1e-9);
  assert.equal(ee.status, 'possible', '0.07 ± 1.96·0.011 reaches back over 0.05');
  const fo = get(run('face_on', 30, { head_lift_z_m: metric(-0.2, 0.01) }), 'head_dip');
  assert.ok(Math.abs(fo.sigma - Math.hypot(0.01, 0.007)) < 1e-9);
  assert.equal(ruleFor('head_dip', 'dtl').sysSigma, 0.013);
  assert.equal(ruleFor('sway', 'face_on').sysSigma, 0);
});
