import test from 'node:test';
import assert from 'node:assert/strict';
import { nominalCamera, project } from '../../app/src/geom/camera.js';
import { mulberry32 } from '../../app/src/geom/rng.js';
import { BALL_R, DEG } from '../../app/src/geom/constants.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { fit3d, startFromStaticBall, sphereExtent, tQuantile975, PARAM_NAMES } from '../../app/src/physics/fit3d.js';
import { fit2d } from '../../app/src/physics/fit2d.js';
import { simulateShot, staticBallPixel } from '../synth/ballflight.js';
import { k1FromCornerFrac, rollAboutPoint, withK1 } from '../../app/src/physics/perturb.js';

const cam0 = nominalCamera('face_on', { yaw: 1.2 * DEG, readout: { ms: 3, axis: 'v', dir: 1 } });
const CLEAN = { noise_px: 0, noise_along_per_px: 0, dropout: 0, width_noise: 0 };

function shot({ speed = 60, launch = 15, psi = 0, spin = 6000, lift = 0, seed = 1, cam = cam0, ...rest } = {}) {
  const rng = mulberry32(seed);
  const start = [0.02, -0.01, BALL_R + lift];
  const sim = simulateShot({ cam, speed_mps: speed, launch_v_deg: launch, psi_deg: psi, spin_rpm: spin, start, rng, t_impact: 0.0517, ...rest });
  const px = staticBallPixel(cam, start, rng, rest.noise_px === 0 ? 0 : 0.3);
  return { sim, start: startFromStaticBall(cam, px.u, px.v, { lift_m: lift }), cam };
}

test('noise-free shots: fit3d recovers speed, launch and ψ for ψ ∈ {−6, 0, +6}°; planar fit is biased ≈1 %/°', () => {
  for (const psi of [-6, 0, 6]) {
    const { sim, start, cam } = shot({ psi, ...CLEAN });
    const f = fit3d({ cam, obs: sim.obs, start, fps: 240, club: { type: '7i' } });
    assert.ok(f.ok, String(f.flags));
    assert.ok(Math.abs(f.ball_speed_mps / 60 - 1) < 0.002, `ψ ${psi}: speed ${f.ball_speed_mps}`);
    assert.ok(Math.abs(f.launch_v_deg - 15) < 0.05, `ψ ${psi}: launch ${f.launch_v_deg}`);
    assert.ok(Math.abs(f.launch_h_deg - psi) < 0.2, `ψ ${psi}: ψ̂ ${f.launch_h_deg}`);
    assert.ok(f.residual_rmse_px < 0.1, `rmse ${f.residual_rmse_px}`);
    assert.deepEqual(f.flags, []);
    const b = fit2d({ cam, obs: sim.obs, start });
    const e2 = b.ball_speed_mps / 60 - 1;
    if (psi === 0) assert.ok(Math.abs(e2) < 0.015, `fit2d ψ 0: ${e2}`);
    else {
      // toward the camera (+ψ) reads fast, away reads slow (CAFCR C1.1)
      assert.equal(Math.sign(e2), Math.sign(psi), `fit2d ψ ${psi}: ${e2}`);
      assert.ok(Math.abs(e2) > 0.03 && Math.abs(e2) < 0.10, `fit2d ψ ${psi}: ${e2}`);
    }
  }
});

test('fit3d output shape: covariance, parameter names, t0 near impact, priors, sensitivities', () => {
  const { sim, start, cam } = shot({ psi: 3, seed: 3 });
  const f = fit3d({ cam, obs: sim.obs, start, fps: 240, club: { type: 'driver' } });
  assert.ok(f.ok);
  assert.equal(f.cov.length, 9);
  assert.deepEqual([...f.param_names], [...PARAM_NAMES]);
  assert.ok(Math.abs(f.t0 - 0.0517) < 0.002, `t0 ${f.t0}`);
  assert.ok(f.speed_sigma > 0 && f.speed_sigma < 1, String(f.speed_sigma));
  assert.ok(f.launch_sigma_deg > 0 && f.launch_sigma_deg < 0.5);
  assert.ok(f.n_used >= 5 && f.n_used <= f.n_obs);
  assert.ok(f.t_factor > 1 && f.t_factor < 1.5);
  assert.ok(f.kappa >= 0.25 && f.kappa <= 4);
  // C1.4: assuming the ball 10 mm higher than it is moves the start along the ray, ≈1.25–1.3 %/10 mm on speed
  const perCm = (Math.abs(f.sens.lift.speed) * 0.01) / f.ball_speed_mps;
  assert.ok(perCm > 0.008 && perCm < 0.018, `lift sensitivity ${perCm}/cm`);
  // readout sensitivity of a rising ball, top→bottom readout: ≈ +0.5–1 %/ms
  const perMs = f.sens.readout.speed / f.ball_speed_mps;
  assert.ok(perMs > 0.002 && perMs < 0.015, `readout sensitivity ${perMs}/ms`);
});

test('fewer than 5 detections → TRACK_TOO_SHORT, values null', () => {
  const { sim, start, cam } = shot({ seed: 4 });
  const f = fit3d({ cam, obs: sim.obs.slice(0, 4), start, fps: 240 });
  assert.equal(f.ok, false);
  assert.equal(f.ball_speed_mps, null);
  assert.equal(f.launch_v_deg, null);
  assert.deepEqual(f.flags, [RC.TRACK_TOO_SHORT]);
  const g = fit3d({ cam, obs: [], start, fps: 240 });
  assert.deepEqual(g.flags, [RC.TRACK_TOO_SHORT]);
});

test('one gross outlier is rejected by the 3.5·MAD pass and the fit stays accurate', () => {
  const { sim, start, cam } = shot({ seed: 5, noise_px: 0.4, dropout: 0, speed: 45, launch: 20 });
  const obs = sim.obs.map((o) => ({ ...o }));
  const k = Math.floor(obs.length / 2);
  obs[k].u += 14;
  obs[k].v -= 9;
  const f = fit3d({ cam, obs, start, fps: 240, club: { type: '9i' } });
  assert.ok(f.ok);
  assert.ok(f.rejected.includes(k), `rejected ${f.rejected}`);
  assert.ok(Math.abs(f.ball_speed_mps / 45 - 1) < 0.015, `speed ${f.ball_speed_mps}`);
});

test('DEPTH_DRIFT_SUSPECT when |ψ| > 10° (fit still reported)', () => {
  const { sim, start, cam } = shot({ psi: 13, seed: 6, speed: 40, launch: 20 });
  const f = fit3d({ cam, obs: sim.obs, start, fps: 240 });
  assert.ok(f.ok);
  assert.ok(f.launch_h_deg > 10, String(f.launch_h_deg));
  assert.ok(f.flags.includes(RC.DEPTH_DRIFT_SUSPECT));
});

test('resting-ball detections before impact are handled (X = p0 for τ ≤ 0)', () => {
  const { sim, start, cam } = shot({ seed: 8, ...CLEAN });
  const p = project(cam, [0.02, -0.01, BALL_R]);
  const rest = [0, 1, 2].map((j) => ({ frame: 9 + j, t_s: (9 + j) / 240, u: p.u, v: p.v, w_px: 22.5, h_px: 22.5, r_px: 11.2, area: 400, peak: 50 }));
  const f = fit3d({ cam, obs: [...rest, ...sim.obs], start, fps: 240, club: { type: '7i' } });
  assert.ok(f.ok);
  assert.ok(Math.abs(f.ball_speed_mps / 60 - 1) < 0.003, String(f.ball_speed_mps));
});

test('startFromStaticBall: point on the ray at the ball-centre height, dXdLift along the ray, SPD covariance', () => {
  const cam = cam0;
  const X = [0.03, 0.02, BALL_R + 0.03];
  const p = project(cam, X);
  const s = startFromStaticBall(cam, p.u, p.v, { lift_m: 0.03 });
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(s.X[k] - X[k]) < 1e-9);
  assert.equal(s.dXdLift[2], 1);
  // camera 0.84 m high, 2.7 m away: a higher ball on the same ray is closer to the camera (−y), ≈3.3 m per m
  assert.ok(s.dXdLift[1] < -2 && s.dXdLift[1] > -5, `depth per lift ${s.dXdLift[1]}`);
  assert.ok(s.cov[1][1] > s.cov[0][0], 'depth is the least constrained axis');
  assert.ok(s.sigma.every((x) => x > 0 && x < 0.01));
});

test('sphereExtent: on-axis width f·D/Z, off-axis elongation along the radial direction', () => {
  const f = 1400;
  const on = sphereExtent(f, [0, 0, 2.7]);
  assert.ok(Math.abs(on.w / ((f * 2 * BALL_R) / 2.7) - 1) < 1e-4);
  const off = sphereExtent(f, [0.8, 0, 2.7]);
  assert.ok(off.w > on.w * 1.03 && Math.abs(off.h - on.h) / on.h < 0.01);
});

test('tQuantile975 matches Student-t tables', () => {
  for (const [nu, t] of [[3, 3.182], [5, 2.571], [10, 2.228], [30, 2.042], [1e6, 1.960]]) {
    assert.ok(Math.abs(tQuantile975(nu) - t) < 0.01 * t, `ν ${nu}: ${tQuantile975(nu)}`);
  }
});

test('fit3d is deterministic', () => {
  const { sim, start, cam } = shot({ seed: 9 });
  const a = fit3d({ cam, obs: sim.obs, start, fps: 240 });
  const b = fit3d({ cam, obs: sim.obs, start, fps: 240 });
  assert.equal(a.ball_speed_mps, b.ball_speed_mps);
  assert.deepEqual(a.theta, b.theta);
});

test('roll and distortion sensitivities predict the bias of a really mis-calibrated estimator camera', () => {
  // Noise-free shots rendered by the true camera; the estimator camera is off by a known roll or residual k1.
  // fit3d's sensitivities (refits with physics/perturb.js modes) must predict the resulting bias.
  for (const [k, cfg] of [{ speed: 62, launch: 12, psi: 4 }, { speed: 40, launch: 24, psi: -5 }].entries()) {
    const camT = nominalCamera('face_on', { yaw: -0.8 * DEG, readout: { ms: 3, axis: 'v', dir: -1 } });
    const startX = [0.01, 0.02, BALL_R];
    const run = (camTrue, camEst) => {
      const sim = simulateShot({ cam: camTrue, speed_mps: cfg.speed, launch_v_deg: cfg.launch, psi_deg: cfg.psi, spin_rpm: 5000, start: startX, rng: mulberry32(20 + k), t_impact: 0.0517, ...CLEAN });
      const p = project(camTrue, startX);
      const st = startFromStaticBall(camEst, p.u, p.v);
      return fit3d({ cam: camEst, obs: sim.obs, start: st, fps: 240, club: { type: 'driver' } });
    };
    const ref = run(camT, camT);
    assert.ok(ref.ok && ref.sens.roll && ref.sens.distortion, 'sensitivities present');
    // residual distortion: true k1 = 1 % at the corner, estimator k1 = 0 → bias ≈ −sens · 0.01
    const fD = run(withK1(camT, k1FromCornerFrac(camT, 0.01)), camT);
    const bD = fD.ball_speed_mps - ref.ball_speed_mps;
    const pD = -ref.sens.distortion.speed * 0.01;
    assert.ok(Math.abs(bD - pD) < 0.25 * Math.abs(pD) + 0.01, `distortion speed bias ${bD} vs predicted ${pD}`);
    assert.ok(Math.abs(pD / cfg.speed) > 0.001 && Math.abs(pD / cfg.speed) < 0.01, `distortion effect ${pD / cfg.speed}`);
    const lD = fD.launch_v_deg - ref.launch_v_deg;
    assert.ok(Math.abs(lD + ref.sens.distortion.launch_deg * 0.01) < 0.25 * Math.abs(ref.sens.distortion.launch_deg * 0.01) + 0.01, `distortion launch ${lD}`);
    // camera roll 0.3° about the ball-spot line in the estimator → launch bias ≈ sens.roll · 0.3 ≈ ±0.3° (C1.1 1:1)
    const fR = run(camT, rollAboutPoint(camT, 0.3 * DEG));
    const lR = fR.launch_v_deg - ref.launch_v_deg;
    const pR = ref.sens.roll.launch_deg * 0.3;
    assert.ok(Math.abs(lR - pR) < 0.15 * Math.abs(pR) + 0.005, `roll launch bias ${lR} vs predicted ${pR}`);
    assert.ok(Math.abs(ref.sens.roll.launch_deg) > 0.8 && Math.abs(ref.sens.roll.launch_deg) < 1.2, `roll ${ref.sens.roll.launch_deg}°/°`);
  }
});
