import test from 'node:test';
import assert from 'node:assert/strict';
import { nominalCamera } from '../../app/src/geom/camera.js';
import { mulberry32, uniform } from '../../app/src/geom/rng.js';
import { BALL_R, DEG } from '../../app/src/geom/constants.js';
import { median, percentile } from '../../app/src/geom/stats.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { clubSpeed, CLUB_DEPTH_SYS_FRAC } from '../../app/src/physics/club.js';
import { simulateClubHead } from '../synth/ballflight.js';

function sweep(fps, n, seed) {
  const rng = mulberry32(seed);
  const errs = [];
  const res = [];
  for (let i = 0; i < n; i++) {
    const cam = nominalCamera('face_on', { yaw: uniform(rng, -2, 2) * DEG, readout: { ms: uniform(rng, 2, 4), axis: 'v', dir: rng() < 0.5 ? 1 : -1 } });
    const V = uniform(rng, 25, 50);
    const tI = 0.1 + uniform(rng, 0, 1 / fps);
    const h = simulateClubHead({
      cam, speed_mps: V, t_impact: tI, fps, start: [0, 0, BALL_R], rng, radius_m: uniform(rng, 1.0, 1.6),
      plane_deg: uniform(rng, 48, 66), attack_deg: uniform(rng, -5, 4), path_deg: uniform(rng, -4, 4),
      depth_m: uniform(rng, 0, 0.05), noise_px: 1.0,
    });
    const c = clubSpeed({ cam, obs: h.obs, start: { X: [0, 0, BALL_R] }, t_impact: tI, fps });
    res.push(c);
    errs.push(c.club_speed_mps / V - 1);
  }
  return { errs, res };
}

test('240 fps: club-head speed median |error| ≤ 2 %, P90 ≤ 5 %, validity estimated (independent seed from the bias sweep)', () => {
  const { errs, res } = sweep(240, 120, 777);
  const a = errs.map(Math.abs);
  assert.ok(Math.abs(median(errs)) <= 0.01, `median signed ${median(errs)}`);
  assert.ok(median(a) <= 0.02 && percentile(a, 90) <= 0.05, `median ${median(a)} P90 ${percentile(a, 90)}`);
  for (const c of res) {
    assert.equal(c.validity, 'estimated');
    assert.equal(c.depth_sys_frac, CLUB_DEPTH_SYS_FRAC);
    assert.equal(c.chord, 'pre_impact');
  }
});

test('30–120 fps: low_confidence and inside the ±25 % band for ≥ 90 % of swings', () => {
  for (const fps of [30, 60, 120]) {
    const { errs, res } = sweep(fps, 80, 900 + fps);
    const inBand = errs.filter((e) => Math.abs(e) <= 0.25).length / errs.length;
    assert.ok(inBand >= 0.9, `${fps} fps: ${inBand}`);
    for (const c of res) {
      assert.equal(c.validity, 'low_confidence');
      assert.equal(c.lowfps_ci95_frac, 0.25);
    }
  }
});

test('below 30 fps → FPS_TOO_LOW; < 2 usable detections → TRACK_TOO_SHORT; no impact time → DEPENDS_ON_NULL', () => {
  const cam = nominalCamera('face_on');
  const a = clubSpeed({ cam, obs: [], start: { X: [0, 0, BALL_R] }, t_impact: 0.1, fps: 25 });
  assert.equal(a.club_speed_mps, null);
  assert.deepEqual(a.reason_codes, [RC.FPS_TOO_LOW]);
  const b = clubSpeed({ cam, obs: [{ frame: 1, t_s: 0.09, u: 900, v: 700, conf: 1 }], start: { X: [0, 0, BALL_R] }, t_impact: 0.1, fps: 240 });
  assert.deepEqual(b.reason_codes, [RC.TRACK_TOO_SHORT]);
  const c = clubSpeed({ cam, obs: [], start: { X: [0, 0, BALL_R] }, t_impact: null, fps: 240 });
  assert.deepEqual(c.reason_codes, [RC.DEPENDS_ON_NULL]);
});

test('post-impact detections are not used (the head slows after contact)', () => {
  const cam = nominalCamera('face_on', { readout: { ms: 3, axis: 'v', dir: 1 } });
  const rng = mulberry32(5);
  const h = simulateClubHead({ cam, speed_mps: 40, t_impact: 0.1013, fps: 240, start: [0, 0, BALL_R], rng, noise_px: 0, post_factor: 0.5, frames_after: 6 });
  const c = clubSpeed({ cam, obs: h.obs, start: { X: [0, 0, BALL_R] }, t_impact: 0.1013, fps: 240 });
  assert.ok(Math.abs(c.club_speed_mps / 40 - 1) < 0.03, String(c.club_speed_mps));
});
