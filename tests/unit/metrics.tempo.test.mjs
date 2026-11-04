import test from 'node:test';
import assert from 'node:assert/strict';
import { tempoInterval, tempoMetrics, eventHalfWidth } from '../../app/src/metrics/common.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { validateMetric } from '../../app/src/contract/validate.js';

test('tempo quantisation reproduces the F2 note (tempo 3.0, ±0.5 frame × 3 events) within 0.02', () => {
  // F2: 30 fps 2.56–3.57, 60 fps 2.77–3.27, 240 fps 2.94–3.06 (a 0.8 s backswing, tempo 3.0)
  const F2 = { 30: [2.56, 3.57], 60: [2.77, 3.27], 240: [2.94, 3.06] };
  for (const [fps, [lo, hi]] of Object.entries(F2)) {
    const iv = tempoInterval(0.8, 0.8 / 3, +fps).ratio;
    assert.ok(Math.abs(iv[0] - lo) <= 0.02 && Math.abs(iv[1] - hi) <= 0.02, `${fps} fps: ${iv[0].toFixed(3)}–${iv[1].toFixed(3)}`);
  }
  assert.equal(eventHalfWidth(30, 1), 0.5 / 30);
  assert.equal(eventHalfWidth(30, 0.5), 1 / 30);
  assert.equal(eventHalfWidth(30, 0.01), 2 / 30);
});

const ev = (a, t, i, c = [1, 1, 1]) => ({
  address: { frame: 0, t_s: a, conf: c[0], source: 'manual' },
  top: { frame: 1, t_s: t, conf: c[1], source: 'manual' },
  impact: { frame: 2, t_s: i, conf: c[2], source: 'manual' },
});
const cells = { backswing_s: 'valid', downswing_s: 'valid', tempo_ratio: 'valid' };

test('tempoMetrics: values, ci95 from quantisation, contract-valid', () => {
  const m = tempoMetrics(ev(1.0, 1.8, 1.8 + 0.8 / 3), 60, cells);
  assert.ok(Math.abs(m.backswing_s.value - 0.8) < 1e-12);
  assert.ok(Math.abs(m.tempo_ratio.value - 3) < 1e-9);
  assert.ok(Math.abs(m.tempo_ratio.ci95[0] - 2.765) < 0.01 && Math.abs(m.tempo_ratio.ci95[1] - 3.267) < 0.01);
  for (const [id, x] of Object.entries(m)) {
    assert.deepEqual(validateMetric(x, id), []);
    assert.equal(x.validity, 'valid');
  }
  assert.equal(m.tempo_ratio.value_origin, 'derived');
});

test('tempoMetrics: low event confidence -> low_confidence + EVENTS_UNCERTAIN and a wider interval', () => {
  const sure = tempoMetrics(ev(1.0, 1.8, 2.07), 30, cells).tempo_ratio;
  const m = tempoMetrics(ev(1.0, 1.8, 2.07, [0.9, 0.3, 0.9]), 30, cells).tempo_ratio;
  assert.equal(m.validity, 'low_confidence');
  assert.ok(m.reason_codes.includes(RC.EVENTS_UNCERTAIN));
  assert.ok(m.ci95[1] - m.ci95[0] > sure.ci95[1] - sure.ci95[0]);
});

test('tempoMetrics: missing events, implausible and suspect timebases', () => {
  const miss = tempoMetrics({ address: { frame: 0, t_s: 1, conf: 1 } }, 30, cells);
  assert.equal(miss.tempo_ratio.value, null);
  assert.deepEqual(miss.tempo_ratio.reason_codes, [RC.EVENTS_UNCERTAIN]);
  const crazy = tempoMetrics(ev(1.0, 1.8, 1.82), 30, cells);
  assert.equal(crazy.downswing_s.validity, 'implausible');
  assert.ok(crazy.downswing_s.reason_codes.includes(RC.IMPLAUSIBLE_VALUE));
  const slow = tempoMetrics(ev(1.0, 2.0, 2.8), 30, cells);
  assert.equal(slow.downswing_s.validity, 'low_confidence');
  assert.ok(slow.downswing_s.reason_codes.includes(RC.TIMEBASE_SUSPECT));
});
