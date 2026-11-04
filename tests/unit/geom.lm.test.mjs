import test from 'node:test';
import assert from 'node:assert/strict';
import { lm, numericJacobian } from '../../app/src/geom/lm.js';
import { mulberry32, gauss } from '../../app/src/geom/rng.js';
import { std, mean } from '../../app/src/geom/stats.js';
import { makeCamera, lookAt, project, fFromHfov } from '../../app/src/geom/camera.js';

const xs = Array.from({ length: 30 }, (_, i) => (2 * i) / 29);
const TRUE_EXP = [2.5, -1.3, 0.4];
const expModel = (th, x) => th[0] * Math.exp(th[1] * x) + th[2];
const yExp = xs.map((x) => expModel(TRUE_EXP, x));
const expResidual = (th) => Float64Array.from(xs, (x, i) => expModel(th, x) - yExp[i]);

test('LM recovers a synthetic exponential (central, forward, analytic Jacobian)', () => {
  for (const variant of ['central', 'forward', 'analytic']) {
    const res = lm({
      residual: expResidual,
      theta0: [1, -0.5, 0],
      diff: variant === 'forward' ? 'forward' : 'central',
      jacobian: variant === 'analytic'
        ? (th) => xs.map((x) => [Math.exp(th[1] * x), th[0] * x * Math.exp(th[1] * x), 1])
        : undefined,
    });
    assert.ok(res.converged, `${variant}: ${res.reason}`);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(res.theta[k] - TRUE_EXP[k]) < 1e-8, `${variant} θ${k}=${res.theta[k]}`);
    assert.ok(res.cost < 1e-20);
    assert.equal(res.J.length, 30);
    assert.equal(res.J[0].length, 3);
  }
});

test('LM numeric Jacobian matches analytic', () => {
  const th = Float64Array.of(2, -1, 0.5);
  const { J } = numericJacobian(expResidual, th);
  const Ja = xs.map((x) => [Math.exp(th[1] * x), th[0] * x * Math.exp(th[1] * x), 1]);
  for (let i = 0; i < xs.length; i++) for (let k = 0; k < 3; k++) assert.ok(Math.abs(J[i][k] - Ja[i][k]) < 1e-9);
  const { J: Jf } = numericJacobian(expResidual, th, { diff: 'forward' });
  for (let i = 0; i < xs.length; i++) for (let k = 0; k < 3; k++) assert.ok(Math.abs(Jf[i][k] - Ja[i][k]) < 1e-6);
});

test('LM solves Rosenbrock and handles invalid regions (residual null)', () => {
  const res = lm({ residual: (t) => [10 * (t[1] - t[0] * t[0]), 1 - t[0]], theta0: [-1.2, 1], maxIter: 200 });
  assert.ok(res.converged, res.reason);
  assert.ok(Math.abs(res.theta[0] - 1) < 1e-9 && Math.abs(res.theta[1] - 1) < 1e-9);
  // θ³ = 8 from θ0 = 0.5 with Gauss–Newton damping: the first step overshoots to θ ≈ 11, where the
  // residual is declared invalid (null); LM must back off (raise λ) and still converge to 2.
  let nulls = 0;
  const guarded = (th) => (th[0] > 5 ? (nulls++, null) : [th[0] ** 3 - 8]);
  const r2 = lm({ residual: guarded, theta0: [0.5], lambda0: 1e-12 });
  assert.ok(nulls > 0, 'guard was exercised');
  assert.ok(r2.converged, r2.reason);
  assert.ok(Math.abs(r2.theta[0] - 2) < 1e-12);
  const bad = lm({ residual: () => null, theta0: [0] });
  assert.equal(bad.converged, false);
  assert.equal(bad.reason, 'invalid_start');
});

test('LM triangulates a 3D point from three cameras', () => {
  const f = fFromHfov(1920, 68.161);
  const target = [0, 0, 0.3];
  const cams = [
    makeCamera({ W: 1920, H: 1080, f, ...lookAt([0.4, -2.7, 0.84], [0.4, 0, 0.84]) }),
    makeCamera({ W: 1080, H: 1920, f, ...lookAt([-3.25, 0.35, 1.0], [0, 0.35, 1.0]) }),
    makeCamera({ W: 1920, H: 1080, f, ...lookAt([-2.875, 0, 1.7], target) }),
  ];
  const Xtrue = [0.6, 0.15, 0.45];
  const obs = cams.map((c) => project(c, Xtrue));
  const residual = (X) => {
    const out = new Float64Array(2 * cams.length);
    for (let i = 0; i < cams.length; i++) {
      const p = project(cams[i], X);
      if (!Number.isFinite(p.u)) return null;
      out[2 * i] = p.u - obs[i].u;
      out[2 * i + 1] = p.v - obs[i].v;
    }
    return out;
  };
  const res = lm({ residual, theta0: [0.8, -0.15, 0.7] });
  assert.ok(res.converged, res.reason);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(res.theta[k] - Xtrue[k]) < 1e-9, `X${k}=${res.theta[k]}`);
  assert.equal(res.dof, 3);
  assert.ok(res.covRaw !== null);
});

test('LM covariance matches Monte-Carlo spread on a linear problem (within 20%)', () => {
  const rng = mulberry32(2026);
  const X = Array.from({ length: 40 }, (_, i) => -1 + (2 * i) / 39);
  const thTrue = [0.7, -1.2, 2.0];
  const sigma = 0.3;
  const model = (th, x) => th[0] + th[1] * x + th[2] * x * x;
  const trials = 400;
  const samples = [[], [], []];
  const corr = [];
  let covRaw = null;
  let scaleSum = 0;
  for (let t = 0; t < trials; t++) {
    const y = X.map((x) => model(thTrue, x) + gauss(rng, 0, sigma));
    const res = lm({ residual: (th) => X.map((x, i) => (model(th, x) - y[i]) / sigma), theta0: [0, 0, 0] });
    assert.ok(res.converged, res.reason);
    for (let k = 0; k < 3; k++) samples[k].push(res.theta[k]);
    covRaw = res.covRaw;
    scaleSum += res.cov[0][0] / res.covRaw[0][0];
    corr.push(res.cov[0][2] / Math.sqrt(res.cov[0][0] * res.cov[2][2]));
  }
  const meanScale = scaleSum / trials;
  assert.ok(meanScale >= 1 && meanScale < 1.25, `scale ${meanScale}`);
  for (let k = 0; k < 3; k++) {
    const mc = std(samples[k]);
    const pred = Math.sqrt(covRaw[k][k]);
    const predScaled = pred * Math.sqrt(meanScale);
    assert.ok(Math.abs(mc / pred - 1) < 0.2, `θ${k}: MC ${mc} vs raw ${pred}`);
    assert.ok(Math.abs(mc / predScaled - 1) < 0.2, `θ${k}: MC ${mc} vs scaled ${predScaled}`);
    assert.ok(Math.abs(mean(samples[k]) - thTrue[k]) < 4 * pred / Math.sqrt(trials));
  }
  // Correlation of intercept and curvature (strongly negative for x ∈ [−1, 1]).
  const a = samples[0];
  const c = samples[2];
  const ma = mean(a);
  const mcm = mean(c);
  let sac = 0;
  for (let i = 0; i < trials; i++) sac += (a[i] - ma) * (c[i] - mcm);
  const rhoMc = sac / (trials - 1) / (std(a) * std(c));
  assert.ok(Math.abs(rhoMc - mean(corr)) < 0.1, `rho MC ${rhoMc} vs ${mean(corr)}`);
});
