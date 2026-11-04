// physics/ground.js, clubpath.js (F2 #15), launch_h.js (F2 #18), clubspeed_pose.js (F2 #14 face_on < 200 fps):
// geometry identities, sign conventions (+ in-to-out / + away from the golfer, left-handed mirror), honest nulls,
// noise-free recovery and the ±25 % floor of the pose club speed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BALL_R, DEG } from '../../app/src/geom/constants.js';
import { mulberry32 } from '../../app/src/geom/rng.js';
import { nominalCamera, project } from '../../app/src/geom/camera.js';
import { matCorners, DEFAULT_VENUE } from '../../app/src/calib/mat.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { rayToGround, yawAboutPoint, groundDirSigmaDeg, groundCalibSigmas, sideOffset } from '../../app/src/physics/ground.js';
import { clubPath, CLUB_PATH_WINDOW_M } from '../../app/src/physics/clubpath.js';
import { launchHighBehind } from '../../app/src/physics/launch_h.js';
import { clubSpeedFromPose, chordBias, POSE_CLUB_K, CI95_MIN_FRAC } from '../../app/src/physics/clubspeed_pose.js';
import { startFromStaticBall, fit3d } from '../../app/src/physics/fit3d.js';
import { analyzeHighBehind } from '../../app/src/physics/pipeline.js';
import { simulateClubHead, simulateShot } from '../synth/ballflight.js';
import { mirrorCamera } from '../synth/swing.js';
import { highBehindShot } from '../synth/cells.js';

const cam = nominalCamera('high_behind', { readout: { ms: 0, axis: 'v', dir: 1 } });

test('rayToGround inverts project on flat and tilted planes; yawAboutPoint keeps the ball pixel and turns directions 1:1', () => {
  for (const X of [[0.1, 0.05, 0], [-0.2, -0.1, 0.03], [0.4, 0.2, 0.01]]) {
    const p = project(cam, X);
    const G = rayToGround(cam, p.u, p.v, X[2]);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(G[k] - X[k]) < 1e-9);
  }
  const tanA = Math.tan(4 * DEG);
  const X = [0.12, 0.03, 0.02 + 0.12 * tanA];
  const p = project(cam, X);
  const G = rayToGround(cam, p.u, p.v, 0.02, tanA, 0);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(G[k] - X[k]) < 1e-9);
  const c2 = yawAboutPoint(cam, 1 * DEG);
  const b0 = project(cam, [0, 0, 0]);
  const b1 = project(c2, [0, 0, 0]);
  assert.ok(Math.hypot(b1.u - b0.u, b1.v - b0.v) < 1e-6);
  // a ground segment along x seen by the yawed camera maps back (through the original camera) turned by −1°
  const A = project(c2, [-0.15, 0, 0]);
  const B = project(c2, [0.15, 0, 0]);
  const a = rayToGround(cam, A.u, A.v, 0);
  const b = rayToGround(cam, B.u, B.v, 0);
  assert.ok(Math.abs(Math.atan2(b[1] - a[1], b[0] - a[0]) / DEG + 1) < 1e-6);
  assert.ok(Math.abs(sideOffset(nominalCamera('high_behind', { y: 0.1 })) - 0.1) < 1e-12);
});

test('groundDirSigmaDeg: ≈ 0.2–0.35° for the nominal high_behind mat at 3 px, linear in the corner noise', () => {
  const s3 = groundDirSigmaDeg(cam, matCorners(DEFAULT_VENUE), 3);
  const s1 = groundDirSigmaDeg(cam, matCorners(DEFAULT_VENUE), 1);
  assert.ok(s3 > 0.2 && s3 < 0.35, String(s3));
  assert.ok(Math.abs(s3 - 3 * s1) < 1e-9);
  const cs = groundCalibSigmas(cam, { pose_sigma: { roll_deg: 0.2 } }, DEFAULT_VENUE);
  assert.ok(Math.abs(cs.yaw_deg - s3) < 1e-12 && cs.roll_deg === 0.2);
});

function headObs(pathDeg, o = {}) {
  return simulateClubHead({
    cam: o.cam ?? cam, rng: mulberry32(o.seed ?? 3), fps: 240, t_impact: 0.1 + (o.phase ?? 0.4) / 240, speed_mps: o.speed ?? 35,
    start: [-0.04, 0, 0.02], radius_m: 1.5, plane_deg: 58, path_deg: pathDeg, attack_deg: 0, depth_m: 0.02,
    post_factor: 0.75, frames_before: 6, frames_after: 4, noise_px: o.noise ?? 0,
  }).obs;
}

test('clubPath: noise-free arc recovers the path (arc correction), + = in-to-out, mirror-invariant for left-handers', () => {
  for (const path of [-5, 0, 3, 6]) {
    const r = clubPath({ cam, obs: headObs(path), fps: 240, rng: mulberry32(1), n: 200 });
    assert.ok(r.ok, JSON.stringify(r.reason_codes));
    assert.equal(r.validity, 'low_confidence');
    assert.ok(Math.abs(r.club_path_deg - path) < 0.6, `${path}: ${r.club_path_deg}`);
    assert.ok(r.ci95[0] <= r.club_path_deg && r.club_path_deg <= r.ci95[1] && r.sigma > 0.5);
    // left-handed: the mirrored scene (camera and image mirrored, ball at −y) gives the same in-to-out value
    const cm = mirrorCamera(cam);
    const obsM = headObs(path).map((q) => ({ ...q, u: cam.W - q.u }));
    const l = clubPath({ cam: cm, obs: obsM, fps: 240, handedness: 'left', rng: mulberry32(1), n: 200 });
    assert.ok(Math.abs(l.club_path_deg - r.club_path_deg) < 1e-6, `${l.club_path_deg} vs ${r.club_path_deg}`);
  }
  // deterministic given the rng seed
  const a = clubPath({ cam, obs: headObs(2, { noise: 1.5 }), fps: 240, rng: mulberry32(9), n: 300 });
  const b = clubPath({ cam, obs: headObs(2, { noise: 1.5 }), fps: 240, rng: mulberry32(9), n: 300 });
  assert.deepEqual([a.club_path_deg, a.sigma, a.ci95], [b.club_path_deg, b.sigma, b.ci95]);
});

test('clubPath: honest nulls (FPS_TOO_LOW below 240 fps, TRACK_TOO_SHORT with < 2 samples within ±0.15 m)', () => {
  assert.deepEqual(clubPath({ cam, obs: headObs(0), fps: 120, rng: mulberry32(1) }).reason_codes, [RC.FPS_TOO_LOW]);
  const far = headObs(0).filter((q) => {
    const G = rayToGround(cam, q.u, q.v, 0.025);
    return Math.abs(G[0] + 0.04) > CLUB_PATH_WINDOW_M;
  });
  const r = clubPath({ cam, obs: far, fps: 240, rng: mulberry32(1) });
  assert.equal(r.ok, false);
  assert.deepEqual(r.reason_codes, [RC.TRACK_TOO_SHORT]);
  assert.equal(clubPath({ cam, obs: [], fps: 240, rng: mulberry32(1) }).validity, 'not_computed');
});

test('clubPath: Monte Carlo terms — pixel noise dominates, a camera off the ball line widens σ and is flagged', () => {
  const obs = headObs(1, { noise: 0 });
  const all = clubPath({ cam, obs, fps: 240, rng: mulberry32(2), n: 400 });
  const pix = clubPath({ cam, obs, fps: 240, rng: mulberry32(2), n: 400, terms: { yaw: false, plane: false, kappa: false } });
  assert.ok(pix.sigma > 0.6 && pix.sigma <= all.sigma, `${pix.sigma} ${all.sigma}`);
  const off = nominalCamera('high_behind', { y: 0.3, readout: { ms: 0, axis: 'v', dir: 1 } });
  const ro = clubPath({ cam: off, obs: headObs(1, { cam: off }), fps: 240, rng: mulberry32(2), n: 400, terms: { pixel: false, yaw: false, kappa: false } });
  const rc = clubPath({ cam, obs, fps: 240, rng: mulberry32(2), n: 400, terms: { pixel: false, yaw: false, kappa: false } });
  assert.ok(ro.side_offset_red && !rc.side_offset_red);
  assert.ok(ro.sigma > rc.sigma, `plane term off-line ${ro.sigma} vs on-line ${rc.sigma}`);
});

function ballCase(psi, o = {}) {
  const c = o.cam ?? cam;
  const start = [0, 0, BALL_R];
  const sim = simulateShot({ cam: c, rng: mulberry32(o.seed ?? 5), fps: 240, t_impact: 0.05, speed_mps: o.speed ?? 50, launch_v_deg: o.launch ?? 18,
    psi_deg: psi, spin_rpm: 5000, start, noise_px: o.noise ?? 0.05, width_noise: 0.01, dropout: 0, tMax: 0.25 });
  const p = project(c, start);
  return { obs: sim.obs, start: startFromStaticBall(c, p.u, p.v, { sigma_px: 0.3 }) };
}

test('launchHighBehind: recovers ψ from behind, + = right of target for a right-hander, mirror-invariant', () => {
  for (const psi of [-6, 0, 4]) {
    const b = ballCase(psi);
    const r = launchHighBehind({ cam, obs: b.obs, start: b.start, fps: 240 });
    assert.ok(r.ok, JSON.stringify(r.reason_codes));
    assert.equal(r.validity, 'low_confidence');
    assert.ok(Math.abs(r.launch_h_deg - psi) < 0.15, `${psi}: ${r.launch_h_deg}`);
    assert.ok(r.sigma >= 0.15 && r.ci95[0] < r.launch_h_deg && r.launch_h_deg < r.ci95[1]);
    assert.ok(r.reason_codes.includes(RC.ROLLING_SHUTTER_ASSUMED));
    const cm = mirrorCamera(cam);
    const obsM = b.obs.map((q) => ({ ...q, u: cam.W - q.u }));
    const pm = project(cm, [0, 0, BALL_R]);
    const l = launchHighBehind({ cam: cm, obs: obsM, start: startFromStaticBall(cm, pm.u, pm.v, { sigma_px: 0.3 }), fps: 240, handedness: 'left' });
    assert.ok(Math.abs(l.launch_h_deg - r.launch_h_deg) < 0.05, `${l.launch_h_deg} vs ${r.launch_h_deg}`);
  }
});

test('launchHighBehind: honest nulls (FPS_TOO_LOW, TRACK_TOO_SHORT)', () => {
  const b = ballCase(2);
  assert.deepEqual(launchHighBehind({ cam, obs: b.obs, start: b.start, fps: 120 }).reason_codes, [RC.FPS_TOO_LOW]);
  assert.deepEqual(launchHighBehind({ cam, obs: b.obs.slice(0, 3), start: b.start, fps: 240 }).reason_codes, [RC.TRACK_TOO_SHORT]);
});

test('fit3d init option: a face_on fit started from a given velocity matches the plane-initialised fit', () => {
  const fc = nominalCamera('face_on', { readout: { ms: 0, axis: 'v', dir: 1 } });
  const b = ballCase(3, { cam: fc });
  const a = fit3d({ cam: fc, obs: b.obs, start: b.start, fps: 240, sensitivities: false });
  const g = fit3d({ cam: fc, obs: b.obs, start: b.start, fps: 240, sensitivities: false, init: { v0: [40, 0, 10], t0: 0.05 } });
  assert.ok(a.ok && g.ok);
  assert.ok(Math.abs(a.ball_speed_mps - g.ball_speed_mps) < 0.05 && Math.abs(a.launch_h_deg - g.launch_h_deg) < 0.05);
});

test('analyzeHighBehind: contract-valid metrics from a synthetic high_behind shot', () => {
  const s = highBehindShot({ seed: 6, i: 0 });
  const start = startFromStaticBall(s.cam, s.staticPx.u, s.staticPx.v, { sigma_px: 0.3 });
  const r = analyzeHighBehind({ cam: s.cam, ballObs: s.ballObs, clubObs: s.clubObs, start, fps: 240, calibration: s.calibration, seed: 1, nMC: 300 });
  for (const id of ['club_path_deg', 'launch_h_deg']) {
    const m = r.metrics[id];
    assert.equal(m.unit, 'deg');
    if (m.value !== null) assert.equal(m.validity, 'low_confidence');
  }
  assert.ok(Math.abs(r.metrics.launch_h_deg.value - s.truth.launch_h_deg) < 2);
});

function wristSeries(fps, vPeak) {
  // lead wrist on an arc: speed peaks at τ = −0.04 s
  const t = [];
  const W = [];
  let s = 0;
  const speed = (tau) => vPeak * (0.6 + 0.4 * Math.exp(-(((tau + 0.04) / 0.05) ** 2)));
  for (let k = -30; k <= 10; k++) {
    const tt = k / fps;
    t.push(1 + tt);
    if (k > -30) s += speed(tt - 0.5 / fps) / fps;
    W.push([s, 0, 1 - 0.1 * s]);
  }
  return { t, W };
}

test('clubSpeedFromPose: v_head = v_hand,peak · chord bias · K · (r + L)/r, ci95 at least ±25 %, honest nulls', () => {
  for (const fps of [30, 60]) {
    const { t, W } = wristSeries(fps, 8);
    const r = clubSpeedFromPose({ t, wrist: W, t_impact: 1, fps, club_length_m: 1.1, arm_length_m: 0.6, pos_sigma_m: 0.004 });
    assert.ok(r.ok);
    assert.equal(r.validity, 'low_confidence');
    assert.ok(Math.abs(r.lever - 1.7 / 0.6) < 1e-12);
    assert.ok(Math.abs(r.club_speed_mps - r.hand_peak_mps * POSE_CLUB_K * r.lever) < 1e-9);
    // the chord max of this profile lies within 3 % of the true peak (8 m/s · 1.01 path factor)
    assert.ok(Math.abs(r.hand_peak_mps / chordBias(fps).k - 8 * Math.hypot(1, 0.1)) < 0.3, String(r.hand_peak_mps));
    assert.ok(r.ci95[1] - r.club_speed_mps >= CI95_MIN_FRAC * r.club_speed_mps - 1e-9);
    assert.ok(r.club_speed_mps - r.ci95[0] >= CI95_MIN_FRAC * r.club_speed_mps - 1e-9);
  }
  const { t, W } = wristSeries(60, 8);
  assert.deepEqual(clubSpeedFromPose({ t, wrist: W, t_impact: 1, fps: 24, club_length_m: 1 }).reason_codes, [RC.FPS_TOO_LOW]);
  assert.deepEqual(clubSpeedFromPose({ t, wrist: W, t_impact: NaN, fps: 60, club_length_m: 1 }).reason_codes, [RC.EVENTS_UNCERTAIN]);
  assert.deepEqual(clubSpeedFromPose({ t, wrist: W.map(() => null), t_impact: 1, fps: 60, club_length_m: 1 }).reason_codes, [RC.POSE_LOW_VISIBILITY]);
  // arm length outside the plausible range falls back to the prior
  const p = clubSpeedFromPose({ t, wrist: W, t_impact: 1, fps: 60, club_length_m: 1.1, arm_length_m: 1.4 });
  assert.equal(p.arm_length_m, 0.58);
  // chord bias: table rows and 1/fps interpolation
  assert.equal(chordBias(30).k, 0.97);
  assert.equal(chordBias(60).k, 0.87);
  const k40 = chordBias(40).k;
  assert.ok(k40 < 0.97 && k40 > 0.87);
  assert.equal(chordBias(120).k, 0.87);
});
