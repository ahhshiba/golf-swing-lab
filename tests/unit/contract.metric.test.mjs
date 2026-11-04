import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RC, REASON_CODES, metricValue, metricNull, downgrade, validateMetric, ContractError,
  VALUE_VALIDITIES, NULL_VALIDITIES, VALUE_ORIGINS,
} from '../../app/src/contract/index.js';

const base = () => ({ value: 58.3, unit: 'm/s', ci95: [56.5, 60.1], validity: 'estimated', value_origin: 'ball_fit3d' });

test('metricValue returns a complete Metric and fills defaults', () => {
  const m = metricValue(base());
  assert.deepEqual(m, {
    value: 58.3, unit: 'm/s', ci95: [56.5, 60.1], sigma: null, validity: 'estimated', value_origin: 'ball_fit3d',
    measured: false, reason_codes: [],
  });
  assert.deepEqual(validateMetric(m), []);
});

test('metricValue accepts ci95 only, sigma only, or both', () => {
  assert.equal(metricValue({ ...base(), ci95: undefined, sigma: 0.9 }).ci95, null);
  assert.equal(metricValue({ ...base(), sigma: 0.9 }).sigma, 0.9);
  assert.equal(metricValue({ ...base(), ci95: null, sigma: 0 }).sigma, 0);
});

test('metricValue accepts every value validity and every origin', () => {
  for (const validity of VALUE_VALIDITIES) assert.equal(metricValue({ ...base(), validity }).validity, validity);
  for (const value_origin of VALUE_ORIGINS) assert.equal(metricValue({ ...base(), value_origin }).value_origin, value_origin);
});

test('metricValue converts typed-array ci95, dedupes and accepts a single reason code', () => {
  const m = metricValue({ ...base(), ci95: new Float64Array([56.5, 60.1]), reason_codes: [RC.SPIN_ASSUMED, RC.SPIN_ASSUMED, RC.WIND_IGNORED] });
  assert.ok(Array.isArray(m.ci95));
  assert.deepEqual(m.reason_codes, [RC.SPIN_ASSUMED, RC.WIND_IGNORED]);
  assert.deepEqual(metricValue({ ...base(), reason_codes: RC.SPIN_ASSUMED }).reason_codes, [RC.SPIN_ASSUMED]);
});

test('metricValue does not alias the caller arrays', () => {
  const ci = [56.5, 60.1];
  const codes = [RC.SPIN_ASSUMED];
  const m = metricValue({ ...base(), ci95: ci, reason_codes: codes });
  ci[0] = 0;
  codes.push(RC.WIND_IGNORED);
  assert.deepEqual(m.ci95, [56.5, 60.1]);
  assert.deepEqual(m.reason_codes, [RC.SPIN_ASSUMED]);
});

test('metricValue throws on every invariant violation', () => {
  const bad = (patch, re) => assert.throws(() => metricValue({ ...base(), ...patch }), (e) => e instanceof ContractError && re.test(e.message), JSON.stringify(patch));
  bad({ ci95: null, sigma: null }, /ci95 or sigma/);
  bad({ ci95: undefined }, /ci95 or sigma/);
  bad({ ci95: [60.2, 61] }, /outside ci95/);
  bad({ ci95: [56, 55] }, /exceeds upper bound/);
  bad({ ci95: [56.5] }, /ci95/);
  bad({ ci95: ['a', 'b'] }, /ci95/);
  bad({ sigma: -0.1 }, /sigma/);
  bad({ sigma: Number.NaN }, /sigma/);
  bad({ value: Number.NaN }, /finite/);
  bad({ value: Infinity }, /finite/);
  bad({ value: null }, /metricNull/);
  bad({ value: undefined }, /metricNull/);
  bad({ validity: 'not_observable' }, /validity must be one of/);
  bad({ validity: 'bogus' }, /validity must be one of/);
  bad({ value_origin: 'guess' }, /value_origin/);
  bad({ unit: '' }, /unit/);
  bad({ unit: undefined }, /unit/);
  bad({ reason_codes: ['NOT_A_CODE'] }, /unknown reason code/);
  bad({ reason_codes: 'nope' }, /unknown reason code/);
  bad({ measured: true }, /measured/);
  bad({ extra: 1 }, /unknown option/);
});

test('metricValue input must be an options object', () => {
  assert.throws(() => metricValue(), ContractError);
  assert.throws(() => metricValue(null), ContractError);
  assert.throws(() => metricValue([1]), ContractError);
});

test('metricNull builds an honest null for each null validity', () => {
  for (const validity of NULL_VALIDITIES) {
    const m = metricNull(validity, [RC.VIEW_DEPTH_AXIS], 'm', 'pose');
    assert.deepEqual(m, {
      value: null, unit: 'm', ci95: null, sigma: null, validity, value_origin: 'pose', measured: false,
      reason_codes: [RC.VIEW_DEPTH_AXIS],
    });
    assert.deepEqual(validateMetric(m), []);
  }
});

test('metricNull: single code, default origin, several codes', () => {
  assert.equal(metricNull('not_computed', RC.NOT_IMPLEMENTED, 'ratio').value_origin, 'derived');
  assert.deepEqual(metricNull('not_observable', [RC.FPS_TOO_LOW, RC.VIEW_DEPTH_AXIS, RC.FPS_TOO_LOW], 'm/s').reason_codes, [RC.FPS_TOO_LOW, RC.VIEW_DEPTH_AXIS]);
});

test('metricNull throws on violations', () => {
  for (const validity of VALUE_VALIDITIES) assert.throws(() => metricNull(validity, [RC.FPS_TOO_LOW], 'm'), ContractError);
  assert.throws(() => metricNull('bogus', [RC.FPS_TOO_LOW], 'm'), ContractError);
  assert.throws(() => metricNull('dropped', [], 'm'), /at least one reason code/);
  assert.throws(() => metricNull('dropped', undefined, 'm'), /at least one reason code/);
  assert.throws(() => metricNull('dropped', 'NO_SUCH', 'm'), /unknown reason code/);
  assert.throws(() => metricNull('dropped', [RC.FPS_TOO_LOW], ''), /unit/);
  assert.throws(() => metricNull('dropped', [RC.FPS_TOO_LOW], 'm', 'guess'), /value_origin/);
  assert.throws(() => metricNull('dropped', 5, 'm'), ContractError);
});

test('downgrade turns a number into low_confidence and appends the code once', () => {
  const m = metricValue({ ...base(), validity: 'valid', reason_codes: [RC.TEE_LIFT_ASSUMED] });
  const d = downgrade(m, RC.SETUP_UNVERIFIED);
  assert.equal(d.validity, 'low_confidence');
  assert.deepEqual(d.reason_codes, [RC.TEE_LIFT_ASSUMED, RC.SETUP_UNVERIFIED]);
  assert.equal(d.value, m.value);
  assert.deepEqual(d.ci95, m.ci95);
  assert.deepEqual(validateMetric(d), []);
  assert.deepEqual(downgrade(d, RC.SETUP_UNVERIFIED), d); // idempotent
});

test('downgrade does not modify its input', () => {
  const m = metricValue({ ...base(), validity: 'estimated' });
  const snapshot = JSON.stringify(m);
  const d = downgrade(m, RC.CALIB_STALE);
  assert.equal(JSON.stringify(m), snapshot);
  d.ci95[0] = 0;
  assert.equal(JSON.stringify(m), snapshot);
});

test('downgrade of a null keeps its null validity (no number to downgrade) and appends the code', () => {
  const n = metricNull('not_observable', [RC.VIEW_DEPTH_AXIS], 'm');
  const d = downgrade(n, RC.NO_GRAVITY_REF);
  assert.equal(d.validity, 'not_observable');
  assert.equal(d.value, null);
  assert.deepEqual(d.reason_codes, [RC.VIEW_DEPTH_AXIS, RC.NO_GRAVITY_REF]);
  assert.deepEqual(validateMetric(d), []);
});

test('downgrade rejects unknown codes and non-metrics', () => {
  const m = metricValue(base());
  assert.throws(() => downgrade(m, 'NOT_A_CODE'), /unknown reason code/);
  assert.throws(() => downgrade(m, undefined), ContractError);
  assert.throws(() => downgrade({}, RC.CALIB_STALE), ContractError);
  assert.throws(() => downgrade(null, RC.CALIB_STALE), ContractError);
});

test('every reason code can be carried by a metric', () => {
  for (const code of Object.keys(REASON_CODES)) {
    assert.deepEqual(metricNull('dropped', [code], 'm').reason_codes, [code]);
  }
});
