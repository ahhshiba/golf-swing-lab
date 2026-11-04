import test from 'node:test';
import assert from 'node:assert/strict';
import { createSetupTimer, summarizeSetup, p90, setupTimeGate, SETUP_STEPS, STEP_ESTIMATE_S } from '../../app/src/calib/timer.js';

test('timer durations per step, total, mode and CAFCR estimates (live 230–245 s, high-speed 270 s)', () => {
  const t = createSetupTimer();
  let now = 100;
  t.record('start', now);
  for (const s of ['C0', 'C1', 'C2', 'C4', 'C5', 'C7', 'C8', 'C9']) { now += STEP_ESTIMATE_S[s]; t.record(s, now); }
  const s = t.summary();
  assert.equal(s.mode, 'live');
  assert.equal(s.steps.C4, 75);
  assert.equal(s.total_s, 237.5);
  assert.equal(s.within_budget, true);
  assert.ok(s.estimate_s >= 230 && s.estimate_s <= 245);
  const hs = summarizeSetup([{ step: 'start', t_s: 0 }, { step: 'C10', t_s: 70 }]);
  assert.equal(hs.mode, 'highspeed');
  assert.equal(hs.estimate_s, 270);
  assert.equal(SETUP_STEPS.length, 11);
  assert.throws(() => t.record('C11', now + 1), RangeError);
  assert.throws(() => t.record('C1', now - 1), RangeError);
  t.record('C4', now + 10); // redo accumulates
  assert.equal(t.summary().steps.C4, 85);
  assert.equal(t.events().length, 10);
});

test('P90 helper and the M2b timing gate (n ≥ 10, P90 ≤ 300 s)', () => {
  assert.equal(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), 10);
  const ok = setupTimeGate([240, 250, 260, 230, 245, 255, 270, 280, 235, 290]);
  assert.equal(ok.pass, true);
  assert.ok(ok.p90_s <= 300);
  assert.equal(setupTimeGate([200, 210]).pass, false);
  const slow = setupTimeGate([240, 250, 260, 230, 245, 255, 270, 380, 335, 390]);
  assert.equal(slow.pass, false);
  assert.ok(slow.p90_s > 300);
  assert.equal(setupTimeGate([500, 520, 540], { limit_s: 600, min_n: 3 }).pass, true);
});
