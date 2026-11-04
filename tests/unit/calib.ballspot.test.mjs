import test from 'node:test';
import assert from 'node:assert/strict';
import { restBall3D, predictedBallWidthPx, framesBudget, ballHeight, TEE_LIFT_MEASURED_SIGMA_M } from '../../app/src/calib/ballspot.js';
import { nominalCamera, project, toCamera, makeCamera } from '../../app/src/geom/camera.js';
import { BALL_R, TEE_LIFT_PRIOR_M, TEE_LIFT_PRIOR_SIGMA_M } from '../../app/src/geom/constants.js';
import { RC } from '../../app/src/contract/reason-codes.js';

test('framesBudget reproduces the CAFCR C1.1 conservative-model numbers (face_on D 2.7, h 0.84)', () => {
  const shifted = [[40, 20, 12.0], [60, 14, 7.4], [70, 12, 6.1], [75, 10, 5.6], [80, 10, 5.2], [55, 13, 8.2], [30, 28, 17.5], [48, 17, 9.7]];
  for (const [v, l, want] of shifted) {
    const r = framesBudget(null, 'face_on', v, l, 0.4);
    assert.ok(Math.abs(r.frames - want) <= 0.15, `${v}@${l}: ${r.frames} vs ${want}`);
    assert.equal(r.exit, 'right');
  }
  const centred = [[40, 20, 9.4], [60, 14, 5.7], [70, 12, 4.7]];
  for (const [v, l, want] of centred) {
    const r = framesBudget(null, 'face_on', v, l, 0);
    assert.ok(Math.abs(r.frames - want) <= 0.15, `centred ${v}@${l}: ${r.frames} vs ${want}`);
  }
  // C2 narrow bay: D = 2.4 → 8.7 / 6.6 / 5.5 at 48 / 60 / 70 m/s
  const narrow = nominalCamera('face_on', { D: 2.4 });
  for (const [v, l, want] of [[48, 17, 8.7], [60, 14, 6.6], [70, 12, 5.5]]) {
    const r = framesBudget(narrow, 'face_on', v, l);
    assert.ok(Math.abs(r.frames - want) <= 0.15, `D2.4 ${v}@${l}: ${r.frames} vs ${want}`);
  }
});

test('framesBudget flags TRACK_MAY_BE_SHORT below 6 frames only', () => {
  assert.deepEqual(framesBudget(null, 'face_on', 70, 12, 0.4).reason_codes, []);
  assert.deepEqual(framesBudget(null, 'face_on', 75, 10, 0.4).reason_codes, [RC.TRACK_MAY_BE_SHORT]);
  const fps120 = framesBudget(null, 'face_on', 40, 20, 0.4, { fps: 120 });
  assert.ok(Math.abs(fps120.frames - (12.05 + 1) / 2 + 1) < 0.05);
  const dtl = framesBudget(null, 'dtl', 60, 14);
  assert.ok(dtl.frames > 6);
});

test('predictedBallWidthPx equals a brute-force silhouette extent and ≈22.4 px at 2.7 m on 1080p', () => {
  const cam = nominalCamera('face_on');
  for (const X of [[0, 0, BALL_R], [0.8, 0.3, 0.5], [-0.5, -0.2, BALL_R]]) {
    const w = predictedBallWidthPx(cam, X);
    let umin = Infinity;
    let umax = -Infinity;
    for (let i = 0; i < 400; i++) {
      for (let j = 0; j < 200; j++) {
        const th = (2 * Math.PI * i) / 400;
        const ph = Math.PI * (j / 199 - 0.5);
        const P = [X[0] + BALL_R * Math.cos(ph) * Math.cos(th), X[1] + BALL_R * Math.cos(ph) * Math.sin(th), X[2] + BALL_R * Math.sin(ph)];
        const u = project(cam, P).u;
        umin = Math.min(umin, u);
        umax = Math.max(umax, u);
      }
    }
    assert.ok(Math.abs(w - (umax - umin)) < 0.01, `${w} vs ${umax - umin}`);
  }
  const onAxis = makeCamera({ W: 1920, H: 1080, hfovDeg: 68.161, C: [0, -2.7, BALL_R], R: [1, 0, 0, 0, 0, -1, 0, 1, 0] });
  assert.ok(Math.abs(predictedBallWidthPx(onAxis, [0, 0, BALL_R]) - 22.4) < 0.05);
  assert.ok(Number.isNaN(predictedBallWidthPx(cam, [0.4, -2.8, 0.84])));
});

test('restBall3D: mat lie recovers the ball spot; measured tee ±5 mm; assumed tee uses the prior and TEE_LIFT_ASSUMED', () => {
  const cam = nominalCamera('face_on');
  const p = project(cam, [0.02, -0.01, BALL_R]);
  const m = restBall3D(cam, p.u, p.v, 'mat');
  assert.ok(Math.hypot(m.X[0] - 0.02, m.X[1] + 0.01, m.X[2] - BALL_R) < 1e-9);
  assert.deepEqual(m.reason_codes, []);
  assert.equal(m.sigma[2], 0);
  assert.ok(m.sigma[1] > m.sigma[0], 'depth is the weak axis');
  const pt = project(cam, [0, 0, BALL_R + 0.04]);
  const tm = restBall3D(cam, pt.u, pt.v, 'tee', 0.04, 'measured');
  assert.ok(Math.hypot(tm.X[0], tm.X[1], tm.X[2] - BALL_R - 0.04) < 1e-9);
  assert.ok(Math.abs(tm.sigma[2] - TEE_LIFT_MEASURED_SIGMA_M) < 1e-12);
  const ta = restBall3D(cam, pt.u, pt.v, 'tee', 0.04, 'assumed');
  assert.deepEqual(ta.reason_codes, [RC.TEE_LIFT_ASSUMED]);
  assert.equal(ta.tee_lift_m, TEE_LIFT_PRIOR_M);
  assert.equal(ta.tee_lift_source, 'assumed');
  assert.ok(Math.abs(ta.sigma[2] - TEE_LIFT_PRIOR_SIGMA_M) < 1e-12);
  assert.ok(ta.sigma[1] > 2.5 * tm.sigma[1], `${ta.sigma[1]} vs ${tm.sigma[1]}`);
  // the assumed 30 mm plane is 10 mm below the true 40 mm ball: the ray hits it further from the camera
  assert.ok(ta.X[1] > 0.01);
  const miss = restBall3D(cam, cam.cx, 10, 'mat');
  assert.equal(miss.X, null);
  assert.deepEqual(miss.reason_codes, [RC.IMPLAUSIBLE_VALUE]);
  assert.deepEqual(ballHeight('mat'), { z_m: BALL_R, sigma_z_m: 0, tee_lift_m: 0, tee_lift_source: 'measured', reason_codes: [] });
  assert.equal(ballHeight('tee', undefined, 'measured').tee_lift_source, 'assumed');
  assert.throws(() => ballHeight('sand'), RangeError);
  assert.ok(toCamera(cam, ta.X)[2] > 0);
});
