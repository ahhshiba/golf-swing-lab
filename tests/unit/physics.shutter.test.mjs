import test from 'node:test';
import assert from 'node:assert/strict';
import { nominalCamera } from '../../app/src/geom/camera.js';
import { mulberry32 } from '../../app/src/geom/rng.js';
import { BALL_R } from '../../app/src/geom/constants.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import {
  observationTime, observationTimes, readoutFor, readoutModel, withReadoutMs, READOUT_MEDIAN_MS,
  READOUT_RESIDUAL_SIGMA_FRAC, READOUT_ASSUMED_RANGE_MS,
} from '../../app/src/physics/shutter.js';
import { fit3d, startFromStaticBall } from '../../app/src/physics/fit3d.js';
import { simulateShot, staticBallPixel } from '../synth/ballflight.js';

test('readoutFor: documented (UNVERIFIED) orientation mapping and view fallback', () => {
  assert.deepEqual(readoutFor('landscape-primary', 'face_on'), { axis: 'v', dir: 1, orientation: 'landscape-primary', verified: false });
  assert.deepEqual(readoutFor('landscape-secondary', 'face_on').dir, -1);
  assert.deepEqual(readoutFor('portrait-primary', 'dtl'), { axis: 'u', dir: -1, orientation: 'portrait-primary', verified: false });
  assert.equal(readoutFor('portrait-secondary', 'dtl').dir, 1);
  assert.equal(readoutFor(undefined, 'dtl').axis, 'u');
  assert.equal(readoutFor('unknown', 'face_on').axis, 'v');
  assert.equal(readoutFor(null, 'high_behind').orientation, 'landscape-primary');
});

test('readoutModel: median 3 ms + ROLLING_SHUTTER_ASSUMED unless measured', () => {
  const a = readoutModel({ orientationType: 'landscape-secondary', view: 'face_on' });
  assert.deepEqual(a.readout, { ms: READOUT_MEDIAN_MS, axis: 'v', dir: -1 });
  assert.equal(a.source, 'assumed');
  assert.deepEqual(a.reason_codes, [RC.ROLLING_SHUTTER_ASSUMED]);
  const m = readoutModel({ orientationType: 'landscape-primary', view: 'face_on', ms: 2.4, source: 'measured' });
  assert.equal(m.readout.ms, 2.4);
  assert.deepEqual(m.reason_codes, []);
  assert.equal(READOUT_MEDIAN_MS, 3);
  assert.deepEqual([...READOUT_ASSUMED_RANGE_MS], [2, 4]);
  assert.ok(Math.abs(READOUT_RESIDUAL_SIGMA_FRAC - 0.004) < 2e-4);
});

test('observationTime follows interfaces §2 for both axes and directions', () => {
  const cam = { W: 1920, H: 1080, readout: { ms: 4, axis: 'v', dir: 1 } };
  assert.equal(observationTime({ u: 0, v: 540 }, 1, cam), 1);
  assert.ok(Math.abs(observationTime({ u: 0, v: 0 }, 1, cam) - (1 - 0.002)) < 1e-15);
  assert.ok(Math.abs(observationTime({ u: 0, v: 1080 }, 1, cam) - (1 + 0.002)) < 1e-15);
  const cd = { ...cam, readout: { ms: 4, axis: 'v', dir: -1 } };
  assert.ok(Math.abs(observationTime({ u: 0, v: 0 }, 1, cd) - (1 + 0.002)) < 1e-15);
  const cu = { ...cam, readout: { ms: 3, axis: 'u', dir: 1 } };
  assert.ok(Math.abs(observationTime({ u: 1920 * 0.75, v: 0 }, 2, cu) - (2 + 0.003 * 0.25)) < 1e-15);
  assert.equal(observationTime({ u: 5, v: 5, t_s: 0.5 }, undefined, { ...cam, readout: { ms: 0, axis: 'v', dir: 1 } }), 0.5);
  const ts = observationTimes([{ u: 0, v: 0, t_s: 0.1 }, { u: 0, v: 1080, t_s: 0.2 }], cam);
  assert.ok(Math.abs(ts[0] - 0.098) < 1e-15 && Math.abs(ts[1] - 0.202) < 1e-15);
  assert.equal(withReadoutMs(cam, 2.5).readout.ms, 2.5);
  assert.equal(cam.readout.ms, 4);
});

test('rolling shutter: ignoring it biases ball speed by ≈ −2 % (top→bottom readout, rising ball); the correction removes it', () => {
  // CAFCR C1.1: readout 2–4 ms → horizontal and vertical speed biased −1.3…−2.8 %; sign flips with the direction.
  for (const dir of [1, -1]) {
    const cam = nominalCamera('face_on', { readout: { ms: 3, axis: 'v', dir } });
    const start = [0, 0, BALL_R];
    const rng = mulberry32(7);
    const sim = simulateShot({ cam, speed_mps: 60, launch_v_deg: 16, spin_rpm: 6000, start, rng, noise_px: 0, noise_along_per_px: 0, dropout: 0, width_noise: 0 });
    const px = staticBallPixel(cam, start, rng, 0);
    const st = startFromStaticBall(cam, px.u, px.v);
    const corrected = fit3d({ cam, obs: sim.obs, start: st, fps: 240, club: { type: '7i' }, sensitivities: false });
    const ignored = fit3d({ cam: withReadoutMs(cam, 0), obs: sim.obs, start: st, fps: 240, club: { type: '7i' }, sensitivities: false });
    const eC = corrected.ball_speed_mps / 60 - 1;
    const eI = ignored.ball_speed_mps / 60 - 1;
    assert.ok(Math.abs(eC) < 0.002, `dir ${dir}: corrected error ${eC}`);
    assert.ok(Math.abs(eI) > 0.01 && Math.abs(eI) < 0.04, `dir ${dir}: uncorrected error ${eI}`);
    assert.equal(Math.sign(eI), -dir, `dir ${dir}: sign of the uncorrected bias`);
  }
});
