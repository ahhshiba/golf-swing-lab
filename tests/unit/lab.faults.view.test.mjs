// V04-SPEC §G.3 V4-F 1: 11 faults × 3 views × fps {30, 60, 120, 240}. A combination outside the §E.3 table is ALWAYS
// unknown + VIEW_* / FPS_TOO_LOW and never fault / possible — even when every value the rules read is far beyond its
// threshold and the pose carries the injected faults. Inside the table the same inputs are judged (never unknown for a
// view reason); a disabled rule is unknown + its code everywhere. The table below is written out from the spec, not derived from lab/params.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFaults } from '../../app/src/lab/faults.js';
import { FAULT_IDS } from '../../app/src/lab/params.js';
import { validateLabRecord } from '../../app/src/contract/round.js';
import { synthSwing } from '../synth/swing.js';
import { handsOutside } from './lab.fixture.mjs';

// §E.3 機位 column: view -> minimum fps (absent = not observable from that view)
const SPEC = {
  early_extension: { dtl: 30 },
  loss_of_posture: { dtl: 30 },
  over_the_top: { dtl: 30, high_behind: 240 },
  sway: { face_on: 30 },
  slide: { face_on: 30 },
  reverse_spine: { face_on: 30 },
  head_dip: { face_on: 30, dtl: 30 },
  early_rise: { face_on: 30, dtl: 30 },
  weight_back: { face_on: 30 },
  overswing: { dtl: 120 },
  tempo_off: { face_on: 30, dtl: 30, high_behind: 30 },
};
const VIEWS = ['face_on', 'dtl', 'high_behind'];
// rules shipped disabled because no available signal measures them (lab/params.js `disabled`)
const DISABLED = { overswing: 'NOT_IMPLEMENTED' };
const FPS = [30, 60, 120, 240];

/** Every value a rule reads, far past its threshold, with a small sigma (so allowed cells are faults). */
function extremeMetrics(lift = -0.3) {
  const m = (value, sigma) => ({ value, unit: 'x', ci95: [value - 1.96 * sigma, value + 1.96 * sigma], sigma, validity: 'valid', value_origin: 'pose', reason_codes: [] });
  return {
    early_extension_m: m(0.3, 0.01), head_lift_z_m: m(lift, 0.01), weight_shift_pct: m(-60, 3),
    top_shaft_angle_deg: m(45, 2), tempo_ratio: m(6, 0.1), club_path_deg: m(-15, 1),
  };
}
const INJECT = { fwdTiltLossImp_deg: 25, sideTiltTop_deg: -25, pelvisTop: [-0.14, 0, 0], stance: 0.4, pelvisImp: [0.34, -0.1, 0] };
const poses = new Map();
function poseFor(view, fps) {
  const k = `${view}@${fps}`;
  if (!poses.has(k)) {
    const s = synthSwing({ seed: 11, view, fps, params: INJECT });
    handsOutside(s, [0, -0.12, 0.08]); // over the top (the generator's downswing retraces the backswing path)
    const events = Object.fromEntries(Object.entries(s.truth.events).map(([n, e]) => [n, { ...e, conf: 0.9, source: 'rules' }]));
    poses.set(k, { poseSeq: s.poseSeq, events, calibration: s.calibration });
  }
  return poses.get(k);
}

test('spec table and lab/params.js name the same 11 faults', () => {
  assert.deepEqual([...FAULT_IDS].sort(), Object.keys(SPEC).sort());
});

for (const view of VIEWS) {
  for (const fps of FPS) {
    test(`${view} @ ${fps} fps: every fault outside the table is unknown + a view / fps code; inside it is judged`, () => {
      const p = poseFor(view, fps);
      for (const sensitivity of ['standard', 'relaxed']) {
        // head dip and early rise read the same number in opposite directions: two runs, each cell must fire in one
        const fired = new Set();
        for (const lift of [-0.3, 0.3]) {
          const shot = { shot_id: `s-${view}-${fps}`, capture: { view, nominal_fps: fps }, handedness: 'right', events: p.events, calibration: p.calibration, metrics: extremeMetrics(lift) };
          const rec = evaluateFaults({ shot, poseSeq: p.poseSeq, view, fps, settings: { sensitivity }, at: '2026-11-07T00:00:00.000Z' });
          assert.ok(validateLabRecord(rec).ok, JSON.stringify(validateLabRecord(rec).errors));
          assert.equal(rec.faults.length, 11);
          for (const f of rec.faults) {
            const min = SPEC[f.id][view];
            const cell = `${f.id} ${view} ${fps} ${sensitivity}`;
            if (min === undefined) {
              assert.equal(f.status, 'unknown', cell);
              assert.ok(f.reason_codes.some((c) => c === 'VIEW_DEPTH_AXIS' || c === 'VIEW_PLANE_MISMATCH'), `${cell}: ${f.reason_codes}`);
              assert.equal(f.value, null, cell);
            } else if (fps < min) {
              assert.equal(f.status, 'unknown', cell);
              assert.deepEqual(f.reason_codes, ['FPS_TOO_LOW'], cell);
            } else if (DISABLED[f.id]) {
              assert.equal(f.status, 'unknown', cell);
              assert.deepEqual(f.reason_codes, [DISABLED[f.id]], cell);
            } else {
              assert.notEqual(f.status, 'unknown', `${cell}: ${f.reason_codes}`);
              if (f.status === 'fault' || f.status === 'possible') fired.add(f.id);
            }
            assert.ok(!(f.status === 'unknown' && f.reason_codes.length === 0), cell);
          }
        }
        for (const id of Object.keys(SPEC)) {
          const min = SPEC[id][view];
          if (min !== undefined && fps >= min && !DISABLED[id]) assert.ok(fired.has(id), `${id} ${view} ${fps} ${sensitivity}: never judged a fault with values far past the threshold`);
        }
      }
    });
  }
}

test('without a pose the lab-measured faults are unknown (POSE_LOW_VISIBILITY), never a fault', () => {
  for (const view of VIEWS) {
    const shot = { shot_id: 'np', capture: { view, nominal_fps: 240 }, events: poseFor(view, 30).events, metrics: {} };
    const rec = evaluateFaults({ shot, poseSeq: null, view, fps: 240, settings: {} });
    for (const f of rec.faults) assert.ok(f.status === 'unknown', `${view} ${f.id} ${f.status}`);
    for (const id of ['loss_of_posture', 'sway', 'slide', 'reverse_spine']) {
      const f = rec.faults.find((x) => x.id === id);
      if (SPEC[id][view]) assert.deepEqual(f.reason_codes, ['POSE_LOW_VISIBILITY'], `${view} ${id}`);
    }
  }
});
