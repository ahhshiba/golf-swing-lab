import test from 'node:test';
import assert from 'node:assert/strict';
import { dropTest, detectionTime, DROP_TEST_RULE } from '../../app/src/calib/droptest.js';
import { solveMatPose } from '../../app/src/calib/pnp.js';
import { makeCalibration } from '../../app/src/calib/report.js';
import { nominalCamera } from '../../app/src/geom/camera.js';
import { G } from '../../app/src/geom/constants.js';
import { mulberry32 } from '../../app/src/geom/rng.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { synthDrop, synthMatScene, scaledCamera } from '../synth/mat.js';

test('noiseless face_on drop recovers g within 1 % (with and without rolling shutter)', () => {
  const rng = mulberry32(1);
  for (const readout of [{ ms: 0, axis: 'v', dir: 1 }, { ms: 3, axis: 'v', dir: 1 }, { ms: 3, axis: 'u', dir: -1 }, { ms: 4, axis: 'v', dir: -1 }]) {
    const cam = nominalCamera('face_on', { readout });
    const d = synthDrop({ cam, rng });
    assert.ok(d.obs.length > 90, `${d.obs.length}`);
    const r = dropTest(d, cam);
    assert.ok(r.ok && r.pass);
    assert.ok(Math.abs(r.g / G - 1) < 0.01, `${JSON.stringify(readout)}: g ${r.g}`);
    assert.ok(Math.abs(r.g / G - 1) < 1e-6, 'exact model → exact g');
    assert.ok(Math.abs(r.z0 - 1.0) < 1e-3);
  }
});

test('scale errors of ±5 % fail, ±2 % pass (9.81 ± 3 %); via a wrong mat size as in practice', () => {
  const rng = mulberry32(2);
  const cam = nominalCamera('face_on');
  const d = synthDrop({ cam, rng, sigmaPx: 0.5 });
  for (const [k, pass] of [[0.95, false], [0.98, true], [1.0, true], [1.02, true], [1.05, false]]) {
    const r = dropTest(d, scaledCamera(cam, k), { sigma_px: 0.5 });
    assert.equal(r.pass, pass, `scale ${k}: g ${r.g}`);
    assert.ok(Math.abs(r.g / G - k) < 0.01, `scale ${k}: g ${r.g}`);
  }
  for (const [k, pass] of [[0.95, false], [1.0, true], [1.05, false]]) {
    const sc = synthMatScene({ view: 'face_on', rng, sigmaPx: 0 });
    const venue = { mat_L: 1.5 * k, mat_W: 1.25 * k, ball_edge_m: 0.3 * k };
    const s = solveMatPose({ corners: sc.corners, venue, view: 'face_on', W: sc.cam.W, H: sc.cam.H, f: sc.cam.f });
    const cal = makeCalibration({ method: 'mat_pnp', cam: s.cam, view: 'face_on', f_locked: true, sigma: s.sigma, rmse_px: s.rmse });
    const r = dropTest(synthDrop({ cam: sc.cam, rng }), cal);
    assert.equal(r.pass, pass, `mat scale ${k}: g ${r.g}`);
  }
});

test('a wrong time base (120 fps clip labelled 240) fails; too few detections → TRACK_TOO_SHORT', () => {
  const rng = mulberry32(3);
  const cam = nominalCamera('face_on');
  const d = synthDrop({ cam, rng, fps: 240 });
  const slowed = d.obs.map((o) => ({ ...o, t_s: o.t_s * 1.1 }));
  const r = dropTest(slowed, cam);
  assert.equal(r.pass, false);
  assert.ok(Math.abs(r.g / G - 1 / 1.21) < 0.01);
  const few = dropTest(d.obs.slice(0, 4), cam);
  assert.equal(few.ok, false);
  assert.equal(few.pass, null);
  assert.deepEqual(few.reason_codes, [RC.TRACK_TOO_SHORT]);
  assert.equal(DROP_TEST_RULE.tol_frac, 0.03);
});

test('noisy drops: sigma_g is honest and |g error| stays small at 1 px', () => {
  const rng = mulberry32(4);
  const cam = nominalCamera('face_on');
  const errs = [];
  const sigs = [];
  for (let k = 0; k < 60; k++) {
    const r = dropTest(synthDrop({ cam, rng, sigmaPx: 1 }), cam, { sigma_px: 1 });
    errs.push(r.g - G);
    sigs.push(r.sigma_g);
  }
  const sd = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);
  const ms = sigs.reduce((a, b) => a + b, 0) / sigs.length;
  assert.ok(sd / ms > 0.7 && sd / ms < 1.4, `sd ${sd} vs sigma ${ms}`);
  assert.ok(sd / G < 0.005);
  assert.equal(detectionTime({ W: 1920, H: 1080, readout: { ms: 3, axis: 'v', dir: 1 } }, 1, 0, 1080), 1.0015);
});
