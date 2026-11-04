import test from 'node:test';
import assert from 'node:assert/strict';
import { poseReport, presetDeviation, makeCalibration } from '../../app/src/calib/report.js';
import { poseReport as geomPoseReport, nominalCamera } from '../../app/src/geom/camera.js';
import { DEG } from '../../app/src/geom/constants.js';
import { newShot, validateShot } from '../../app/src/contract/index.js';
import { calibrate } from '../../app/src/calib/ladder.js';
import { mulberry32 } from '../../app/src/geom/rng.js';
import { synthMatScene, synthClub, synthBall } from '../synth/mat.js';

const CAL_KEYS = ['method', 'source', 'f_px', 'f_locked', 'pose', 'pose_sigma', 'reproj_rmse_px', 'slope_deg', 'preset_dev',
  'readout_ms', 'readout_source', 'camera'];
const POSE = ['yaw_deg', 'pitch_deg', 'roll_deg', 'X_m', 'Y_m', 'h_m', 'D_m'];

test('poseReport delegates to geom and follows the view-relative convention', () => {
  for (const view of ['face_on', 'dtl', 'high_behind']) {
    const cam = nominalCamera(view, { yaw: 0.7 * DEG, roll: -0.3 * DEG });
    assert.deepEqual(poseReport(cam, view), geomPoseReport(cam, view));
    const r = poseReport(cam, view);
    assert.ok(Math.abs(r.yaw_deg - 0.7) < 1e-9 && Math.abs(r.roll_deg + 0.3) < 1e-9);
  }
  const hb = poseReport(nominalCamera('high_behind'), 'high_behind');
  assert.ok(hb.pitch_deg < -25 && hb.pitch_deg > -35, `${hb.pitch_deg}`);
  const fo = poseReport(nominalCamera('face_on'), 'face_on');
  assert.ok(Math.abs(fo.X_m - 0.4) < 1e-12 && Math.abs(fo.Y_m + 2.7) < 1e-12 && Math.abs(fo.h_m - 0.84) < 1e-12);
  assert.ok(Math.abs(fo.D_m - Math.hypot(0.4, 2.7)) < 1e-12);
});

test('presetDeviation: signed differences, angles wrapped, null-safe', () => {
  const a = { yaw_deg: 179.5, pitch_deg: 0.3, roll_deg: -179.8, X_m: 0.42, Y_m: -2.7, h_m: 0.85, D_m: 2.73 };
  const b = { pose: { yaw_deg: -179.7, pitch_deg: -0.2, roll_deg: 179.9, X_m: 0.40, Y_m: -2.71, h_m: 0.84, D_m: 2.729 } };
  const d = presetDeviation(a, b);
  assert.ok(Math.abs(d.yaw_deg + 0.8) < 1e-9, `${d.yaw_deg}`);
  assert.ok(Math.abs(d.roll_deg - 0.3) < 1e-9, `${d.roll_deg}`);
  assert.ok(Math.abs(d.pitch_deg - 0.5) < 1e-12 && Math.abs(d.X_m - 0.02) < 1e-12 && Math.abs(d.h_m - 0.01) < 1e-12);
  assert.equal(presetDeviation(a, null), null);
  assert.deepEqual(Object.keys(presetDeviation(a, b.pose)), POSE);
});

test('makeCalibration builds exactly the interfaces.md §4 object', () => {
  const cam = nominalCamera('face_on');
  const sigma = Object.fromEntries(POSE.map((k) => [k, 0.1]));
  const preset = { pose: poseReport(nominalCamera('face_on', { yaw: 0.5 * DEG }), 'face_on') };
  const c = makeCalibration({ method: 'mat_pnp', source: 'clip', cam, view: 'face_on', f_locked: true, sigma, rmse_px: 0.8, preset });
  assert.deepEqual(Object.keys(c), CAL_KEYS);
  assert.deepEqual(Object.keys(c.pose), POSE);
  assert.deepEqual(Object.keys(c.pose_sigma), POSE);
  assert.equal(c.f_px, cam.f);
  assert.equal(c.readout_ms, 3.0);
  assert.equal(c.readout_source, 'assumed');
  assert.equal(c.slope_deg, null);
  assert.equal(makeCalibration({ method: 'mat_pnp', cam, view: 'face_on', sigma, slope_deg: 0.4 }).slope_deg, 0.4);
  assert.ok(Math.abs(c.preset_dev.yaw_deg + 0.5) < 1e-9);
  assert.equal(c.camera, cam);
  const n = makeCalibration({ method: 'ball_only', cam, view: 'face_on', f_locked: false, sigma, rmse_px: NaN });
  assert.equal(n.preset_dev, null);
  assert.equal(n.reproj_rmse_px, null);
  assert.equal(n.source, 'live');
  assert.throws(() => makeCalibration({ method: 'tape', cam, view: 'face_on' }), RangeError);
});

test('every ladder level produces a calibration the contract validator accepts (no calibration.* errors)', () => {
  const rng = mulberry32(3);
  for (const view of ['face_on', 'dtl', 'high_behind']) {
    const sc = synthMatScene({ view, rng, sigmaPx: 1 });
    const ctx = { venue: sc.venue, view, W: sc.cam.W, H: sc.cam.H, f: sc.cam.f, slope_deg: 0.3 };
    const club = synthClub(sc.cam, rng);
    const ball = synthBall(sc.cam, rng);
    for (const vis of [{ corners: sc.corners, gravity: sc.gravity }, { corners: null, club, ball, gravity: sc.gravity }, { corners: null, ball, gravity: null }]) {
      const r = calibrate(vis, ctx);
      assert.ok(r.ok);
      const errs = validateShot(newShot({ calibration: r.calibration })).errors.filter((e) => e.path.startsWith('calibration'));
      assert.deepEqual(errs, [], `${view} ${r.method}: ${JSON.stringify(errs)}`);
    }
  }
});
