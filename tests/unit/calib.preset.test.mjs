import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreset, updatePreset, comparePreset, comparePresets, fLockFromSolves, presetId, F_LOCK_RULE } from '../../app/src/calib/preset.js';
import { solveMatPose } from '../../app/src/calib/pnp.js';
import { makeCalibration } from '../../app/src/calib/report.js';
import { mulberry32 } from '../../app/src/geom/rng.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { synthMatScene } from '../synth/mat.js';

const pose = { yaw_deg: 0.2, pitch_deg: -0.1, roll_deg: 0.05, X_m: 0.4, Y_m: -2.7, h_m: 0.84, D_m: 2.7295 };

test('createPreset from a pose or a calibration; deterministic id; validation', () => {
  const p = createPreset({ venue_id: 'bay7', view: 'face_on', pose, f_locked: 1418.2, W: 1920, H: 1080, created_at: '2026-11-04T10:00:00Z' });
  assert.deepEqual(Object.keys(p), ['preset_id', 'venue_id', 'view', 'pose', 'f_locked', 'W', 'H', 'created_at', 'updated_at', 'revision']);
  assert.equal(p.preset_id, presetId('bay7', 'face_on', '2026-11-04T10:00:00Z'));
  assert.deepEqual(p.pose, pose);
  assert.notEqual(p.pose, pose, 'pose is copied');
  const rng = mulberry32(1);
  const sc = synthMatScene({ view: 'dtl', rng, sigmaPx: 1 });
  const s = solveMatPose({ corners: sc.corners, venue: sc.venue, view: 'dtl', W: sc.cam.W, H: sc.cam.H, f: sc.cam.f });
  const cal = makeCalibration({ method: 'mat_pnp', cam: s.cam, view: 'dtl', f_locked: true, sigma: s.sigma, rmse_px: s.rmse });
  const q = createPreset({ venue_id: 'bay7', view: 'dtl', calibration: cal, created_at: 5 });
  assert.equal(q.f_locked, cal.f_px);
  assert.equal(q.W, 1080);
  assert.equal(q.H, 1920);
  assert.throws(() => createPreset({ venue_id: 'b', view: 'top', pose, created_at: 1 }), RangeError);
  assert.throws(() => createPreset({ venue_id: 'b', view: 'dtl', pose: { ...pose, D_m: NaN }, created_at: 1 }), RangeError);
  assert.throws(() => createPreset({ venue_id: 'b', view: 'dtl', pose }), RangeError);
});

test('updatePreset is immutable and bumps the revision', () => {
  const p = createPreset({ venue_id: 'v', view: 'face_on', pose, f_locked: 1400, created_at: 1 });
  const q = updatePreset(p, { pose: { ...pose, h_m: 0.85 } }, 2);
  assert.equal(p.pose.h_m, 0.84);
  assert.equal(q.pose.h_m, 0.85);
  assert.equal(q.revision, 2);
  assert.equal(q.updated_at, 2);
  assert.equal(q.created_at, 1);
  assert.equal(updatePreset(q, { f_locked: 1410 }, 3).f_locked, 1410);
  assert.throws(() => updatePreset(p, {}), RangeError);
});

test('comparePreset / comparePresets: deviation and PRESET_MISMATCH across views or presets', () => {
  const p = createPreset({ venue_id: 'v', view: 'face_on', pose, f_locked: 1400, created_at: 1 });
  const c = comparePreset({ pose: { ...pose, D_m: pose.D_m + 0.03 } }, p, { view: 'face_on', venue_id: 'v' });
  assert.ok(Math.abs(c.dev.D_m - 0.03) < 1e-12);
  assert.deepEqual(c.reason_codes, []);
  assert.deepEqual(comparePreset(pose, p, { view: 'dtl' }).reason_codes, [RC.PRESET_MISMATCH]);
  const p2 = createPreset({ venue_id: 'v', view: 'face_on', pose, f_locked: 1400, created_at: 2 });
  assert.deepEqual(comparePresets(p, p2).reason_codes, [RC.PRESET_MISMATCH]);
  assert.deepEqual(comparePresets(p, p).reason_codes, []);
});

test('P1 f-lock: mean of ≥3 manual solves with SD ≤ 1 %', () => {
  assert.deepEqual(F_LOCK_RULE, { min_n: 3, max_sd_pct: 1 });
  const ok = fLockFromSolves([1410, 1420, 1425]);
  assert.equal(ok.ok, true);
  assert.ok(Math.abs(ok.f_locked - 1418.3333333333333) < 1e-9);
  const few = fLockFromSolves([1410, 1420]);
  assert.equal(few.ok, false);
  assert.deepEqual(few.failures.map((f) => f.check), ['f_lock_n']);
  const noisy = fLockFromSolves([1380, 1420, 1460]);
  assert.equal(noisy.ok, false);
  assert.equal(noisy.f_locked, null);
  assert.ok(noisy.sd_pct > 1);
  // end to end: three magnifier solves (1 px) on a synthetic face_on mat satisfy the rule
  const rng = mulberry32(42);
  const fs = [];
  for (let k = 0; k < 3; k++) {
    const sc = synthMatScene({ view: 'face_on', rng, sigmaPx: 1, perturb: false });
    fs.push(solveMatPose({ corners: sc.corners, venue: sc.venue, view: 'face_on', W: 1920, H: 1080, fLocked: false }).f);
  }
  const lock = fLockFromSolves(fs);
  assert.equal(lock.ok, true, JSON.stringify(lock));
});
