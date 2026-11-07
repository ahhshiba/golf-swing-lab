// V04-SPEC §G.3 V4-F 3: tests/fixtures/v4/lab-sessions.json — 50 dtl swings with an injected early extension of
// 0.10 m -> fault + possible ≥ 90 %; 50 clean dtl swings -> early-extension faults ≤ 10 %; sway and slide the same way
// (face_on, 50 injected each against 50 clean). The fixture is recipes for tests/synth/swing.js (lab.fixture.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFaults } from '../../app/src/lab/faults.js';
import { validateShot } from '../../app/src/contract/validate.js';
import { validateLabRecord } from '../../app/src/contract/round.js';
import { loadLabSessions, expandGroup } from './lab.fixture.mjs';

const fx = loadLabSessions();
const group = (id) => fx.groups.find((g) => g.id === id);
const rates = new Map();
function rate(groupId, faultId) {
  const g = group(groupId);
  if (!rates.has(groupId)) {
    rates.set(groupId, expandGroup(g, { fixture: fx }).map(({ shot, poseSeq }) => {
      assert.ok(validateShot(shot).ok, `${shot.shot_id}: ${JSON.stringify(validateShot(shot).errors?.slice(0, 2))}`);
      const rec = evaluateFaults({ shot, poseSeq, view: g.view, fps: g.fps, settings: {} });
      assert.ok(validateLabRecord(rec).ok);
      return rec;
    }));
  }
  const recs = rates.get(groupId);
  const st = recs.map((r) => r.faults.find((f) => f.id === faultId).status);
  return { n: st.length, hit: st.filter((s) => s === 'fault' || s === 'possible').length / st.length, fault: st.filter((s) => s === 'fault').length / st.length };
}

test('fixture: format, 5 groups of 50, face_on and dtl, each injected group names its fault', () => {
  assert.equal(fx.format, 'gsl-lab-sessions/1');
  assert.equal(fx.groups.length, 5);
  for (const g of fx.groups) assert.equal(g.seeds.n, 50, g.id);
  assert.deepEqual([...new Set(fx.groups.map((g) => g.view))].sort(), ['dtl', 'face_on']);
  assert.deepEqual(fx.groups.filter((g) => g.inject).map((g) => g.inject.fault).sort(), ['early_extension', 'slide', 'sway']);
});

for (const [inj, clean, id] of [['dtl_early_extension', 'dtl_clean', 'early_extension'], ['fo_sway', 'fo_clean', 'sway'], ['fo_slide', 'fo_clean', 'slide']]) {
  test(`${id}: injected 0.10 m -> fault + possible ≥ 90 %; clean -> false faults ≤ 10 %`, () => {
    const a = rate(inj, id);
    const b = rate(clean, id);
    assert.equal(a.n, 50); assert.equal(b.n, 50);
    assert.ok(a.hit >= 0.9, `${id} injected: ${(a.hit * 100).toFixed(0)} % found`);
    assert.ok(b.fault <= 0.1, `${id} clean: ${(b.fault * 100).toFixed(0)} % false faults`);
  });
}
