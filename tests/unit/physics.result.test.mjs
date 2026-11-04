import test from 'node:test';
import assert from 'node:assert/strict';
import { RC, REASON_CODES } from '../../app/src/contract/reason-codes.js';
import { validateMetric } from '../../app/src/contract/validate.js';
import { mulberry32 } from '../../app/src/geom/rng.js';
import { nominalCamera } from '../../app/src/geom/camera.js';
import { BALL_R } from '../../app/src/geom/constants.js';
import { toMetrics, PHYSICS_METRIC_IDS } from '../../app/src/physics/result.js';
import { GATES, isPlausible, fitChecks, ballPlausibility } from '../../app/src/physics/plausibility.js';
import { analyzeFaceOn } from '../../app/src/physics/pipeline.js';
import { startFromStaticBall } from '../../app/src/physics/fit3d.js';
import { simulateShot, simulateClubHead, staticBallPixel } from '../synth/ballflight.js';

function checkAll(metrics) {
  assert.deepEqual(Object.keys(metrics).sort(), [...PHYSICS_METRIC_IDS].sort());
  for (const [id, m] of Object.entries(metrics)) {
    assert.deepEqual(validateMetric(m, id), [], `${id}: ${JSON.stringify(m)}`);
    assert.equal(m.measured, false);
    for (const c of m.reason_codes) assert.ok(c in REASON_CODES, c);
    if (m.value === null) assert.ok(m.reason_codes.length > 0, id);
  }
}

function realShot({ fps = 240, lie = 'mat', lift = 0, liftSource = 'measured', seed = 1, club = true } = {}) {
  const cam = nominalCamera('face_on', { readout: { ms: 3, axis: 'v', dir: 1 } });
  const rng = mulberry32(seed);
  const startX = [0, 0, BALL_R + lift];
  const sim = simulateShot({ cam, speed_mps: 55, launch_v_deg: 16, psi_deg: 2, spin_rpm: 6800, start: startX, rng, fps, t_impact: 0.0541 });
  const head = simulateClubHead({ cam, speed_mps: 39, t_impact: 0.0541, fps, start: startX, rng });
  const px = staticBallPixel(cam, startX, rng, 0.3);
  const start = startFromStaticBall(cam, px.u, px.v, { lift_m: liftSource === 'assumed' ? 0.03 : lift });
  return analyzeFaceOn({
    cam, ballObs: sim.obs, clubObs: club ? head.obs : null, start, fps,
    club: { type: '7i', lie, tee_lift_m: lift, tee_lift_source: liftSource }, t_impact_guess: 0.0541, seed, nMC: 1000, nCarry: 200,
  });
}

test('face_on 240 fps: every physics metric is contract-valid; carry estimated + SPIN_ASSUMED + WIND_IGNORED', () => {
  const r = realShot();
  checkAll(r.metrics);
  const m = r.metrics;
  for (const id of ['ball_speed_mps', 'launch_v_deg', 'carry_m', 'club_speed_mps', 'smash_factor']) {
    assert.notEqual(m[id].value, null, `${id}: ${JSON.stringify(m[id])}`);
    assert.ok(m[id].ci95 && m[id].sigma > 0, id);
  }
  assert.equal(m.ball_speed_mps.validity, 'estimated');
  assert.equal(m.ball_speed_mps.value_origin, 'ball_fit3d');
  assert.ok(Math.abs(m.ball_speed_mps.value / 55 - 1) < 0.03);
  assert.equal(m.carry_m.validity, 'estimated');
  assert.ok(m.carry_m.reason_codes.includes(RC.SPIN_ASSUMED) && m.carry_m.reason_codes.includes(RC.WIND_IGNORED));
  assert.ok(m.ball_speed_mps.reason_codes.includes(RC.ROLLING_SHUTTER_ASSUMED));
  assert.equal(m.launch_h_deg.value, null);
  assert.deepEqual(m.launch_h_deg.reason_codes, [RC.LAUNCH_DIR_UNOBSERVABLE]);
  assert.equal(m.smash_factor.value_origin, 'derived');
  assert.ok(Math.abs(m.smash_factor.value - m.ball_speed_mps.value / m.club_speed_mps.value) < 1e-12);
});

test('teed with assumed lift → TEE_LIFT_ASSUMED and a wider ball-speed ci95 than a measured lift', () => {
  const a = realShot({ lie: 'tee', lift: 0.03, liftSource: 'assumed', seed: 2 });
  const b = realShot({ lie: 'tee', lift: 0.03, liftSource: 'measured', seed: 2 });
  checkAll(a.metrics);
  assert.ok(a.metrics.ball_speed_mps.reason_codes.includes(RC.TEE_LIFT_ASSUMED));
  assert.ok(!b.metrics.ball_speed_mps.reason_codes.includes(RC.TEE_LIFT_ASSUMED));
  const w = (m) => m.ci95[1] - m.ci95[0];
  assert.ok(w(a.metrics.ball_speed_mps) > 1.5 * w(b.metrics.ball_speed_mps));
});

test('fps < 200: 16, 17, 19, 20 null with FPS_TOO_LOW; club speed low_confidence', () => {
  const r = realShot({ fps: 60 });
  checkAll(r.metrics);
  for (const id of ['ball_speed_mps', 'launch_v_deg', 'carry_m', 'smash_factor']) {
    assert.equal(r.metrics[id].value, null);
    assert.deepEqual(r.metrics[id].reason_codes, [RC.FPS_TOO_LOW]);
  }
  assert.equal(r.metrics.club_speed_mps.validity, 'low_confidence');
});

test('missing ball track → TRACK_TOO_SHORT and DEPENDS_ON_NULL downstream; missing club → smash DEPENDS_ON_NULL', () => {
  const m = toMetrics({ fit: { ok: false, flags: [RC.TRACK_TOO_SHORT] }, fps: 240, view: 'face_on', club: null });
  checkAll(m);
  assert.deepEqual(m.ball_speed_mps.reason_codes, [RC.TRACK_TOO_SHORT]);
  assert.deepEqual(m.carry_m.reason_codes, [RC.DEPENDS_ON_NULL]);
  assert.deepEqual(m.smash_factor.reason_codes, [RC.DEPENDS_ON_NULL]);
  const r = realShot({ club: false, seed: 3 });
  checkAll(r.metrics);
  assert.notEqual(r.metrics.ball_speed_mps.value, null);
  assert.deepEqual(r.metrics.smash_factor.reason_codes, [RC.DEPENDS_ON_NULL]);
});

test('other views: honest nulls per F2 (VIEW_DEPTH_AXIS, LAUNCH_DIR_UNOBSERVABLE)', () => {
  for (const view of ['dtl', 'high_behind']) {
    const m = toMetrics({ fit: null, fps: 240, view });
    checkAll(m);
    for (const id of ['ball_speed_mps', 'launch_v_deg', 'club_speed_mps']) assert.ok(m[id].reason_codes.includes(RC.VIEW_DEPTH_AXIS));
    assert.ok(m.carry_m.reason_codes.includes(RC.DEPENDS_ON_NULL));
  }
  assert.deepEqual(toMetrics({ fps: 240, view: 'dtl' }).launch_h_deg.reason_codes, [RC.LAUNCH_DIR_UNOBSERVABLE]);
});

test('DEPTH_DRIFT_SUSPECT fit → low_confidence with the code on ball and carry', () => {
  const r = realShot({ seed: 4 });
  const fit = { ...r.fit, flags: [RC.DEPTH_DRIFT_SUSPECT] };
  const m = toMetrics({ fit, mc: null, carry: r.carry, club: r.club, fps: 240, view: 'face_on' });
  checkAll(m);
  assert.equal(m.ball_speed_mps.validity, 'low_confidence');
  assert.ok(m.ball_speed_mps.reason_codes.includes(RC.DEPTH_DRIFT_SUSPECT));
  assert.equal(m.carry_m.validity, 'estimated');
  assert.ok(m.carry_m.reason_codes.includes(RC.DEPTH_DRIFT_SUSPECT));
});

test('plausibility gates (ball 10–90 m/s, launch −5…45°, club 10–65 m/s, smash 0.9–1.6)', () => {
  assert.deepEqual([...GATES.ball_speed_mps], [10, 90]);
  assert.deepEqual([...GATES.launch_v_deg], [-5, 45]);
  assert.deepEqual([...GATES.club_speed_mps], [10, 65]);
  assert.deepEqual([...GATES.smash_factor], [0.9, 1.6]);
  for (const [id, ok, bad] of [['ball_speed_mps', 60, 150], ['launch_v_deg', 12, 50], ['club_speed_mps', 40, 70], ['smash_factor', 1.4, 2]]) {
    assert.ok(isPlausible(id, ok));
    assert.ok(!isPlausible(id, bad));
  }
  assert.ok(!isPlausible('ball_speed_mps', NaN));
  const r = realShot({ seed: 5 });
  assert.deepEqual(fitChecks(r.fit, 0.0541), []);
  assert.ok(ballPlausibility({ ...r.fit, ball_speed_mps: 150 }).failed.includes('ball_speed_mps'));
  assert.ok(fitChecks({ ...r.fit, cd: 2 }).includes('cd'));
  const m = toMetrics({ fit: r.fit, mc: r.mc, carry: r.carry, club: { ...r.club, club_speed_mps: 25 }, fps: 240, view: 'face_on' });
  checkAll(m);
  assert.equal(m.smash_factor.validity, 'implausible'); // 55 / 25 = 2.2
  assert.deepEqual(m.smash_factor.reason_codes, [RC.IMPLAUSIBLE_VALUE]);
});
