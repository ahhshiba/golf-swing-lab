// physics/lm club-head inputs on synthetic club-head tracks (tests/synth/ballflight.js simulateClubHead):
// face_on attack angle (./attack.js, LAUNCH-MONITOR-SPEC §1.2 #2) and high_behind club speed (./hbspeed.js, §1.2 #1).
// Independent seeds from the fitting sweeps quoted in docs/research/launch-monitor-physics.md §7.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nominalCamera } from '../../app/src/geom/camera.js';
import { gauss, mulberry32, uniform } from '../../app/src/geom/rng.js';
import { BALL_R, DEG } from '../../app/src/geom/constants.js';
import { median, percentile } from '../../app/src/geom/stats.js';
import { DEFAULT_VENUE } from '../../app/src/calib/mat.js';
import { clubSpeed } from '../../app/src/physics/club.js';
import { attackFromClub } from '../../app/src/physics/lm/attack.js';
import { hbClubSpeed } from '../../app/src/physics/lm/hbspeed.js';
import { LM_PARAMS } from '../../app/src/physics/lm/params.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { simulateClubHead } from '../synth/ballflight.js';
import { trueCameraFor, solveCalibration } from '../synth/e2e.js';

test('face_on attack angle: unbiased (|median| ≤ 0.6°), median |error| ≤ 2.5°, σ 1.5–3°, ±1.96σ covers 85–99 %', () => {
  const rng = mulberry32(4242);
  const err = [], sig = [];
  let hit = 0;
  for (let i = 0; i < 240; i++) {
    const fps = 240;
    const cam = nominalCamera('face_on', { yaw: uniform(rng, -2, 2) * DEG, readout: { ms: uniform(rng, 2, 4), axis: 'v', dir: rng() < 0.5 ? 1 : -1 } });
    const a = uniform(rng, -5, 4);
    const tI = 0.1 + uniform(rng, 0, 1 / fps);
    const h = simulateClubHead({ cam, speed_mps: uniform(rng, 25, 50), t_impact: tI, fps, start: [0, 0, BALL_R], rng, radius_m: uniform(rng, 1.0, 1.8),
      plane_deg: uniform(rng, 48, 66), attack_deg: a, path_deg: uniform(rng, -4, 4), depth_m: uniform(rng, 0, 0.05), noise_px: 1.5 });
    const r = attackFromClub(clubSpeed({ cam, obs: h.obs, start: { X: [0, 0, BALL_R] }, t_impact: tI, fps }));
    assert.ok(r.ok);
    err.push(r.value - a);
    sig.push(r.sigma);
    if (Math.abs(r.value - a) <= 1.959964 * r.sigma) hit++;
  }
  const cov = hit / err.length;
  console.log(`# attack: median ${median(err).toFixed(2)}° |err| median ${median(err.map(Math.abs)).toFixed(2)}° σ median ${median(sig).toFixed(2)}° coverage ${(100 * cov).toFixed(1)} %`);
  assert.ok(Math.abs(median(err)) <= 0.6 && median(err.map(Math.abs)) <= 2.5);
  assert.ok(median(sig) >= 1.5 && median(sig) <= 3);
  assert.ok(cov >= 0.85 && cov <= 0.99, `coverage ${cov}`);
  assert.equal(attackFromClub(null).ok, false);
  assert.equal(attackFromClub({ ok: true, v_vec: [1, 0, 0], club_speed_mps: 30 }).ok, false, 'no t_mid');
});

test('high_behind club speed: |median error| ≤ 4 %, ci95 covers 85–99 %; fewer than 2 samples -> TRACK_TOO_SHORT', () => {
  const rng = mulberry32(9090);
  const aoa = LM_PARAMS.clubs.iron_mid.aoa;
  const err = [], rel = [];
  let hit = 0, n = 0, tried = 0;
  for (let i = 0; i < 120; i++) {
    const fps = 240;
    const tc = trueCameraFor({ view: 'high_behind', yaw_deg: uniform(rng, -1, 1), readout_ms: uniform(rng, 2, 4), readout_dir: rng() < 0.5 ? 1 : -1 }, rng);
    const { calibration } = solveCalibration(tc.cam, 'high_behind', tc.orientation, DEFAULT_VENUE, rng, 3, undefined);
    const tI = 0.1 + uniform(rng, 0, 1 / fps);
    const V = uniform(rng, 30, 45);
    const start = [uniform(rng, -0.03, 0.03), uniform(rng, -0.03, 0.03), BALL_R];
    const h = simulateClubHead({ cam: tc.cam, rng, fps, t_impact: tI, speed_mps: V, start: [start[0] - 0.04, start[1], uniform(rng, 0, 0.05)],
      radius_m: uniform(rng, 1.3, 1.8), plane_deg: uniform(rng, 50, 65), path_deg: uniform(rng, -6, 6), attack_deg: gauss(rng, aoa.mean, aoa.sd),
      depth_m: uniform(rng, 0.005, 0.04), post_factor: 0.75, frames_before: 6, frames_after: 4, noise_px: 1.5 });
    tried++;
    const r = hbClubSpeed({ cam: calibration.camera, obs: h.obs, ball: [start[0], start[1]], aoa, rng });
    if (!r.ok) continue;
    n++;
    err.push(r.value / V - 1);
    rel.push(r.sigma / r.value);
    if (r.ci95[0] <= V && V <= r.ci95[1]) hit++;
  }
  console.log(`# hb club speed: n ${n}/${tried} median ${(100 * median(err)).toFixed(1)} % P10 ${(100 * percentile(err, 10)).toFixed(1)} P90 ${(100 * percentile(err, 90)).toFixed(1)} σ median ${(100 * median(rel)).toFixed(1)} % coverage ${(100 * hit / n).toFixed(1)} %`);
  assert.ok(n >= 0.9 * tried);
  assert.ok(Math.abs(median(err)) <= 0.04);
  assert.ok(hit / n >= 0.85 && hit / n <= 0.99);
  const one = hbClubSpeed({ cam: nominalCamera('high_behind'), obs: [{ frame: 1, t_s: 0.1, u: 900, v: 600 }], ball: [0, 0], aoa, rng });
  assert.deepEqual(one.reason_codes, [RC.TRACK_TOO_SHORT]);
});
