// K6: systematic terms are per-draw offsets shared by everything they affect, not root-sum-squared noise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../app/src/geom/rng.js';
import { std, mean } from '../../app/src/geom/stats.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { propagate, systematicsFrom, SYSTEMATICS_DEFAULTS } from '../../app/src/physics/mc.js';
import { fit3d, startFromStaticBall } from '../../app/src/physics/fit3d.js';
import { SPIN_PRIORS } from '../../app/src/physics/ballistics.js';
import { faceOnBatch } from '../synth/ballflight.js';

const ZERO = { calib_scale_sigma: 0, mat_scale_halfwidth: 0, distortion_sigma: 0, distortion_corner_sigma: 0, roll_sigma_deg: 0, readout_source: 'measured', readout_sigma_ms: 0, lie: 'mat' };

function fakeFit(extra = {}) {
  const v = [60 * Math.cos(0.25), 0, 60 * Math.sin(0.25)];
  const cov = Array.from({ length: 9 }, (_, i) => Array.from({ length: 9 }, (_, j) => (i === j ? 1e-12 : 0)));
  return {
    ok: true, ball_speed_mps: 60, launch_v_deg: 0.25 * 180 / Math.PI, v_vec: v, cov, flags: [], t_factor: 1,
    sens: { lift: { speed: -75, launch_deg: 2 }, readout: { speed: 0.45, launch_deg: 0.01 } }, ...extra,
  };
}
const club = { ok: true, club_speed_mps: 42, sigma: 0, readout_frac_per_ms: 0, depth_sys_frac: 0, lowfps_ci95_frac: 0, validity: 'estimated' };

test('a shared scale term (calibration scale) cancels in the smash factor', () => {
  const r = propagate({ fit: fakeFit(), club, systematics: { ...ZERO, calib_scale_sigma: 0.01 }, rng: mulberry32(1), n: 4000 });
  const sb = std(r.draws.ball_speed) / 60;
  const sc = std(r.draws.club_speed) / 42;
  const ss = std(r.draws.smash) / (60 / 42);
  assert.ok(sb > 0.009 && sc > 0.009, `${sb} ${sc}`);
  assert.ok(ss < 1e-6, `smash relative sd ${ss} (RSS would give ${Math.hypot(sb, sc)})`);
  assert.ok(Math.abs(r.smash.value - 60 / 42) < 1e-12);
});

test('assumed readout is a uniform per-draw offset through the per-shot sensitivity (not gaussian, not RSS)', () => {
  const r = propagate({ fit: fakeFit(), systematics: { ...ZERO, readout_source: 'assumed', readout_halfwidth_ms: 1 }, rng: mulberry32(2), n: 20000 });
  const d = Array.from(r.draws.ball_speed, (x) => x - 60);
  assert.ok(Math.max(...d) <= 0.45 + 1e-9 && Math.min(...d) >= -0.45 - 1e-9, 'bounded by ±sensitivity × 1 ms');
  const m4 = mean(d.map((x) => x ** 4)) / mean(d.map((x) => x * x)) ** 2;
  assert.ok(m4 > 1.6 && m4 < 2.0, `kurtosis ${m4} (uniform 1.8, gaussian 3)`);
  assert.ok(Math.abs(std(d) - 0.45 / Math.sqrt(3)) < 0.01);
});

test('tee lift: measured ±5 mm uniform vs assumed 15 mm gaussian, via the lift sensitivity', () => {
  const m = propagate({ fit: fakeFit(), systematics: { ...ZERO, lie: 'tee', tee_lift_source: 'measured' }, rng: mulberry32(3), n: 20000 });
  const a = propagate({ fit: fakeFit(), systematics: { ...ZERO, lie: 'tee', tee_lift_source: 'assumed' }, rng: mulberry32(3), n: 20000 });
  assert.ok(Math.abs(m.ball_speed.sigma - 75 * 0.005 / Math.sqrt(3)) < 0.01, String(m.ball_speed.sigma));
  assert.ok(Math.abs(a.ball_speed.sigma - 75 * 0.015) < 0.03, String(a.ball_speed.sigma));
  const mat = propagate({ fit: fakeFit(), systematics: { ...ZERO, lie: 'mat', tee_lift_source: 'assumed' }, rng: mulberry32(3), n: 2000 });
  assert.ok(mat.ball_speed.sigma < 1e-4);
});

test('DEPTH_DRIFT_SUSPECT inflates the fit part by depth_drift_inflate; t_factor widens it too', () => {
  const cov = Array.from({ length: 9 }, (_, i) => Array.from({ length: 9 }, (_, j) => (i === j ? 0.04 : 0)));
  const base = propagate({ fit: fakeFit({ cov }), systematics: ZERO, rng: mulberry32(4), n: 20000 }).ball_speed.sigma;
  const dd = propagate({ fit: fakeFit({ cov, flags: [RC.DEPTH_DRIFT_SUSPECT] }), systematics: ZERO, rng: mulberry32(4), n: 20000 }).ball_speed.sigma;
  const tf = propagate({ fit: fakeFit({ cov, t_factor: 1.5 }), systematics: ZERO, rng: mulberry32(4), n: 20000 }).ball_speed.sigma;
  assert.ok(Math.abs(dd / base - SYSTEMATICS_DEFAULTS.depth_drift_inflate) < 0.05, `${dd / base}`);
  assert.ok(Math.abs(tf / base - 1.5) < 0.05);
});

test('systematicsFrom: calibration σ_D/D, roll σ, readout source and club lie are picked up', () => {
  const s = systematicsFrom({
    calibration: { readout_source: 'measured', pose: { D_m: 2.7 }, pose_sigma: { D_m: 0.0081, roll_deg: 0.22 } },
    club: { lie: 'tee', tee_lift_source: 'assumed' },
  });
  assert.equal(s.readout_source, 'measured');
  assert.ok(Math.abs(s.calib_scale_sigma - 0.003) < 1e-12);
  assert.equal(s.roll_sigma_deg, 0.22);
  assert.equal(systematicsFrom({}).roll_sigma_deg, SYSTEMATICS_DEFAULTS.roll_sigma_deg);
  assert.equal(s.lie, 'tee');
  assert.equal(s.tee_lift_source, 'assumed');
  assert.equal(systematicsFrom({ overrides: { distortion_sigma: 0 } }).distortion_sigma, 0);
  assert.equal(propagate({ fit: { ok: false }, rng: mulberry32(1) }), null);
});

test('an injected calibration-scale error is covered when mc models it (systematic actually present)', () => {
  // The estimator's camera centre is scaled by (1 + s), s ~ N(0, 0.4 %), i.e. a wrong f/D scale; mc models
  // calib_scale_sigma = 0.004. Coverage must stay honest (the default 0.3 % is the CAFCR midpoint).
  const shots = faceOnBatch({ seed: 31, n: 40, spinPriors: SPIN_PRIORS });
  const rng = mulberry32(99);
  let covered = 0;
  let n = 0;
  for (const s of shots) {
    const z = Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
    const k = 1 + 0.004 * z;
    const camEst = { ...s.cam, t: s.cam.t.map((x) => x * k) }; // C = −Rᵀt scales with t
    const start = startFromStaticBall(camEst, s.staticPx.u, s.staticPx.v, { lift_m: s.lift_measured });
    const f = fit3d({ cam: camEst, obs: s.obs, start, fps: 240, club: { type: s.category } });
    if (!f.ok) continue;
    const m = propagate({ fit: f, systematics: { ...ZERO, calib_scale_sigma: 0.004, lie: s.lie, tee_lift_source: 'measured' }, rng: mulberry32(s.i), n: 2000 });
    n++;
    if (s.truth.speed >= m.ball_speed.ci95[0] && s.truth.speed <= m.ball_speed.ci95[1]) covered++;
  }
  assert.ok(n >= 38);
  assert.ok(covered / n >= 0.85, `coverage ${covered}/${n}`);
});

test('distortion and roll are drawn in physical units through the fit sensitivities (speed and launch)', () => {
  // per unit corner-distortion fraction: −15 m/s and −12°; per degree of roll: +0.01 m/s and +0.95°
  const sens = { lift: { speed: 0, launch_deg: 0 }, readout: { speed: 0, launch_deg: 0 },
    distortion: { speed: -15, launch_deg: -12 }, roll: { speed: 0.01, launch_deg: 0.95 } };
  const S = { ...ZERO, distortion_corner_sigma: 0.01, roll_sigma_deg: 0.15 };
  const r = propagate({ fit: fakeFit({ sens }), club, systematics: S, rng: mulberry32(5), n: 20000 });
  assert.ok(Math.abs(r.ball_speed.sigma - Math.hypot(15 * 0.01, 0.01 * 0.15)) < 0.006, String(r.ball_speed.sigma));
  assert.ok(Math.abs(r.launch_v.sigma - Math.hypot(12 * 0.01, 0.95 * 0.15)) < 0.006, String(r.launch_v.sigma));
  // the club speed of the same draw gets the same relative distortion effect, so it cancels in the smash factor
  assert.ok(std(r.draws.club_speed) / 42 > 0.002);
  assert.ok(std(r.draws.smash) / (60 / 42) < 1e-4, String(std(r.draws.smash)));
  // fallbacks without per-shot sensitivities: distortion = speed scale distortion_sigma, roll 1:1 on launch
  const fb = propagate({ fit: fakeFit(), systematics: { ...ZERO, distortion_sigma: 0.004, roll_sigma_deg: 0.15 }, rng: mulberry32(6), n: 20000 });
  assert.ok(Math.abs(fb.ball_speed.sigma - 60 * 0.004) < 0.01, String(fb.ball_speed.sigma));
  assert.ok(Math.abs(fb.launch_v.sigma - 0.15) < 0.005, String(fb.launch_v.sigma));
});

test('defaults: every C1.1 calibration term is non-zero (nothing silently switched off)', () => {
  for (const k of ['calib_scale_sigma', 'mat_scale_halfwidth', 'distortion_corner_sigma', 'distortion_sigma', 'roll_sigma_deg', 'readout_halfwidth_ms']) {
    assert.ok(SYSTEMATICS_DEFAULTS[k] > 0, k);
  }
  assert.equal(SYSTEMATICS_DEFAULTS.readout_source, 'assumed');
});
