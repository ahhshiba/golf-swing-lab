import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gravityPose, accelFromPose, cameraAxesInDevice, orientationName, lowPassStep, stabilityCheck, createGravityTracker,
  flatSlope, gravityPrior,
} from '../../app/src/calib/gravity.js';
import { rFromEuler, eulerFromR } from '../../app/src/geom/camera.js';
import { cross3 } from '../../app/src/geom/linalg.js';
import { DEG } from '../../app/src/geom/constants.js';
import { mulberry32, gauss } from '../../app/src/geom/rng.js';

const ORIENTS = ['portrait', 'landscape_ccw', 'landscape_cw', 'portrait_upside'];

test('camera axes in device coordinates are right-handed with the optical axis out of the back', () => {
  for (const o of ORIENTS) {
    const [x, y, z] = cameraAxesInDevice(o);
    assert.deepEqual(cross3(x, y).map((v) => v + 0), z.map((v) => v + 0), o);
    assert.deepEqual(z, [0, 0, -1]);
  }
  assert.equal(orientationName(0), 'portrait');
  assert.equal(orientationName(90), 'landscape_ccw');
  assert.equal(orientationName(-90), 'landscape_cw');
  assert.equal(orientationName(270), 'landscape_cw');
  assert.equal(orientationName(180), 'portrait_upside');
  assert.throws(() => orientationName(45), RangeError);
  assert.throws(() => orientationName('sideways'), RangeError);
});

test('gravityPose agrees with geom eulerFromR: up vector of R in camera axes → same pitch and roll', () => {
  const rng = mulberry32(4);
  for (const view of ['face_on', 'dtl', 'high_behind']) {
    for (let k = 0; k < 20; k++) {
      const e = { yaw: gauss(rng, 0, 0.3), pitch: gauss(rng, 0, 0.5), roll: gauss(rng, 0, 0.3) };
      const R = rFromEuler(e, view);
      const back = eulerFromR(R, view);
      const upCam = [R[2], R[5], R[8]]; // world +z in camera coordinates
      for (const o of ORIENTS) {
        // device reading = up expressed in device axes (W3C sign), built from the camera axes
        const ax = cameraAxesInDevice(o);
        const dev = [0, 1, 2].map((i) => 9.81 * (ax[0][i] * upCam[0] + ax[1][i] * upCam[1] + ax[2][i] * upCam[2]));
        const g = gravityPose({ x: dev[0], y: dev[1], z: dev[2] }, o);
        assert.ok(Math.abs(g.pitch - back.pitch) < 1e-12 && Math.abs(g.roll - back.roll) < 1e-12, `${view} ${o}`);
        const a = accelFromPose(back.pitch, back.roll, o, 1, 9.81);
        for (let i = 0; i < 3; i++) assert.ok(Math.abs(a[i] - dev[i]) < 1e-12);
      }
    }
  }
});

test('level landscape phone reads +g along the device axis that points up; sign switch for inverted platforms', () => {
  // landscape_ccw, camera level: image down = −dev_x, so "up" is +dev_x and the W3C reading is (+9.81, 0, 0)
  const g = gravityPose([9.81, 0, 0], 'landscape_ccw');
  assert.ok(Math.abs(g.pitch_deg) < 1e-12 && Math.abs(g.roll_deg) < 1e-12);
  const inv = gravityPose([-9.81, 0, 0], 'landscape_ccw', -1);
  assert.ok(Math.abs(inv.pitch_deg) < 1e-12 && Math.abs(inv.roll_deg) < 1e-12);
  // tilted 30° down (high_behind): the screen faces up a little, so the +z (screen-normal) component is positive
  const hb = accelFromPose(-30 * DEG, 0, 'landscape_ccw');
  assert.ok(hb[2] > 0 && hb[0] > 0);
  assert.ok(Math.abs(gravityPose(hb, 'landscape_ccw').pitch_deg + 30) < 1e-9);
  // portrait: a clockwise roll of the camera (image content turns counter-clockwise)
  const p = accelFromPose(0, 2 * DEG, 'portrait');
  assert.ok(Math.abs(gravityPose(p, 'portrait').roll_deg - 2) < 1e-9);
  assert.equal(gravityPose([0, 0, 0], 'portrait'), null);
  assert.equal(gravityPose({ x: NaN, y: 1, z: 0 }, 'portrait'), null);
});

test('flatSlope and gravityPrior', () => {
  const s = flatSlope([0, 9.81 * Math.sin(1.5 * DEG), 9.81 * Math.cos(1.5 * DEG)]);
  assert.ok(Math.abs(s.slope_deg - 1.5) < 1e-9);
  assert.ok(Math.abs(s.dir_deg - 90) < 1e-9);
  const gp = gravityPrior({ pitch_deg: 0.5, roll_deg: -0.2 }, { slope_roll_deg: -0.3 });
  assert.ok(gp.pitch_deg === 0.5 && Math.abs(gp.roll_deg - 0.1) < 1e-12 && gp.sigma_deg === 0.4);
  assert.equal(gravityPrior(null), null);
});

test('lowPassStep: exponential response with α = 1 − exp(−dt/τ)', () => {
  let s = lowPassStep(null, [0, 0, 0], 0, 0.5);
  s = lowPassStep(s, [1, 2, 3], 0.5, 0.5);
  const a = 1 - Math.exp(-1);
  assert.ok(Math.abs(s.value[0] - a) < 1e-12 && Math.abs(s.value[2] - 3 * a) < 1e-12);
  const prev = { t_s: 0, value: [0, 0, 0] };
  lowPassStep(prev, [5, 5, 5], 1, 0.5);
  assert.deepEqual(prev.value, [0, 0, 0], 'input state is not modified');
});

test('stabilityCheck needs the full span and a small spread; the tracker settles on a still phone', () => {
  const still = Array.from({ length: 61 }, (_, i) => ({ t_s: i / 60, pitch_deg: 0.02 * Math.sin(i), roll_deg: 0.3 }));
  assert.equal(stabilityCheck(still).stable, true);
  assert.equal(stabilityCheck(still.slice(0, 30)).covered, false);
  const moving = still.map((s, i) => ({ ...s, roll_deg: 0.3 + i * 0.01 }));
  assert.equal(stabilityCheck(moving).stable, false);
  const rng = mulberry32(12);
  const tr = createGravityTracker({ orientation: 'landscape_ccw', tau_s: 0.3, span_s: 1, tol_deg: 0.1 });
  const a = accelFromPose(0.4 * DEG, -0.25 * DEG, 'landscape_ccw');
  let out;
  for (let i = 0; i <= 240; i++) out = tr.push(a.map((x) => x + gauss(rng, 0, 0.02)), i / 60);
  assert.equal(out.stable, true);
  assert.ok(Math.abs(out.pitch_deg - 0.4) < 0.1 && Math.abs(out.roll_deg + 0.25) < 0.1, JSON.stringify(out));
  // a bump makes it unstable again
  for (let i = 241; i <= 250; i++) out = tr.push(accelFromPose(3 * DEG, 0, 'landscape_ccw'), i / 60);
  assert.equal(out.stable, false);
});
