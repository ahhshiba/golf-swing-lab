// Per-rule acceptance on synthetic swings (V4-F follow-up; lab/params.js lab-1.1.0): for every rule judged from the
// pose or pose metrics, 50 clean swings per view (fault parameters drawn from tests/fixtures/v4/lab-sessions.json
// `rates.clean`, realistic and clear of every rule) and 50 swings with the rule's injection, at 'standard':
//   injected: fault + possible ≥ 90 %      clean: false 'fault' ≤ 5 %, false 'possible' ≤ 15 %   (every allowed view)
// The rates of all 11 rules are printed (test diagnostics) and listed in docs/research/lab-rates.md. Not synthetic:
// overswing (disabled: NOT_IMPLEMENTED, asserted unknown) and over_the_top from high_behind (club_path_deg from the
// 240 fps club track; lab.faults.logic covers its judgement).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFaults } from '../../app/src/lab/faults.js';
import { FAULT_IDS, ruleFor, LAB_PARAMS } from '../../app/src/lab/params.js';
import { loadLabSessions, rateSwing, defaultSwing, labTruth } from './lab.fixture.mjs';

const fx = loadLabSessions();
const R = fx.rates;
const runs = new Map();
function recs(view, fault) {
  const k = `${view}:${fault}`;
  if (!runs.has(k)) {
    const out = [];
    for (let i = 0; i < R.n; i++) {
      const { shot, poseSeq } = rateSwing(fx, view, i, fault);
      out.push(evaluateFaults({ shot, poseSeq, view, fps: R.fps, settings: { sensitivity: 'standard' } }));
    }
    runs.set(k, out);
  }
  return runs.get(k);
}
const rate = (list, id) => {
  const s = list.map((r) => r.faults.find((f) => f.id === id).status);
  const share = (x) => s.filter((y) => y === x).length / s.length;
  return { fault: share('fault'), possible: share('possible'), unknown: share('unknown') };
};
const pc = (x) => `${Math.round(100 * x)} %`;

test(`version ${LAB_PARAMS.version}; populations of ${R.n} at ${R.fps} fps`, () => {
  assert.equal(LAB_PARAMS.version, 'lab-1.2.0');
  assert.equal(R.n, 50);
});

for (const id of FAULT_IDS) {
  test(`${id}: clean false fault ≤ 5 %, false possible ≤ 15 %; injected found ≥ 90 %`, (t) => {
    const lines = [];
    for (const view of ['face_on', 'dtl']) {
      const rule = ruleFor(id, view);
      if (!rule.allowed) continue;
      const c = rate(recs(view, null), id);
      if (rule.disabled) {
        assert.equal(c.unknown, 1, `${id} ${view}: a disabled rule is always unknown`);
        lines.push(`${view}: disabled (${rule.disabled})`);
        continue;
      }
      assert.equal(c.unknown, 0, `${id} ${view}: unknown on clean swings`);
      assert.ok(c.fault <= 0.05, `${id} ${view}: clean false fault ${pc(c.fault)}`);
      assert.ok(c.possible <= 0.15, `${id} ${view}: clean false possible ${pc(c.possible)}`);
      let line = `${view}: clean fault ${pc(c.fault)} / possible ${pc(c.possible)}`;
      if (R.inject[id]?.view === view) {
        const j = rate(recs(view, id), id);
        assert.ok(j.fault + j.possible >= 0.9, `${id} ${view}: injected found ${pc(j.fault + j.possible)}`);
        line += `; injected found ${pc(j.fault + j.possible)} (fault ${pc(j.fault)})`;
      }
      lines.push(line);
    }
    if (ruleFor(id, 'high_behind').allowed && !ruleFor(id, 'high_behind').disabled && id !== 'tempo_off') lines.push('high_behind: not synthetic (club track metric)');
    t.diagnostic(`${id}: ${lines.join(' | ')}`);
    for (const view of ['face_on', 'dtl']) if (R.inject[id]?.view === view || ruleFor(id, view).disabled) return;
    assert.fail(`${id}: no injected population`);
  });
}

// Calibration of the judgement interval: on 100 unconstrained generator swings per view (30 and 60 fps) the value ±
// 1.96 sigma used to judge (incl. sysSigma) covers the true quantity on ≥ 93 % of swings, for every judged rule; the
// mean error is printed (the known metric offsets: early_extension_m ≈ +0.9 cm, dtl head_lift_z_m ≈ −1.2 cm).
for (const fps of [30, 60]) {
  test(`judgement interval covers the truth ≥ 93 % (unconstrained swings, ${fps} fps)`, (t) => {
    for (const view of ['face_on', 'dtl']) {
      const acc = {};
      for (let i = 0; i < 100; i++) {
        const { s, shot, poseSeq } = defaultSwing(fx, view, 12001 + i, fps);
        const rec = evaluateFaults({ shot, poseSeq, view, fps, settings: {} });
        const T = labTruth(s);
        for (const f of rec.faults) {
          if (!Number.isFinite(f.value) || T[f.id] === undefined) continue;
          const a = (acc[f.id] ??= { n: 0, cov: 0, sum: 0 });
          const e = f.value - T[f.id];
          a.n++; a.sum += e; if (Math.abs(e) <= 1.96 * f.sigma) a.cov++;
        }
      }
      for (const [id, a] of Object.entries(acc)) {
        t.diagnostic(`${view} ${fps} fps ${id}: mean error ${(a.sum / a.n).toPrecision(2)}, covered ${pc(a.cov / a.n)} of ${a.n}`);
        assert.ok(a.cov / a.n >= 0.93, `${view} ${fps} ${id}: interval covers the truth on ${pc(a.cov / a.n)}`);
      }
    }
  });
}
