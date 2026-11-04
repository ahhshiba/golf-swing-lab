// Levenberg–Marquardt nonlinear least squares (Marquardt diagonal scaling), ported from
// baseball-digital-twin-demo tools/monocular/mono/estimate.py refine_model, generalised.
//
// cost = Σ r_i² (the plain sum of squares, not ½Σ). Residuals should be whitened (divided by their sigma)
// so that `cov` is a parameter covariance in parameter units.

import { cholesky, choleskySolve, gram, gramVec, inverseSPD, solve } from './linalg.js';

function sumSq(r) {
  let s = 0;
  for (let i = 0; i < r.length; i++) s += r[i] * r[i];
  return s;
}

function norm(x) { return Math.sqrt(sumSq(x)); }

/** Evaluate a residual function; null when it returns null or any non-finite entry. */
function evalResidual(fn, theta) {
  const r = fn(Float64Array.from(theta));
  if (r == null) return null;
  const out = r instanceof Float64Array ? r : Float64Array.from(r);
  for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) return null;
  return out;
}

function stepsFor(theta, step, relStep) {
  const n = theta.length;
  const h = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    if (step != null) h[k] = typeof step === 'number' ? step : step[k];
    else h[k] = relStep * Math.max(Math.abs(theta[k]), 1);
    if (!(h[k] > 0)) throw new RangeError(`lm: step for parameter ${k} must be > 0`);
  }
  return h;
}

/**
 * Numerical Jacobian (m×n, rows) of residual at theta.
 * opts: { r0 (residual at theta, optional), diff: 'central'|'forward' (default 'central'),
 *         step: number | per-parameter array of absolute steps, relStep (default 6e-6 central, 1.5e-8 forward;
 *         h_k = relStep·max(|θ_k|, 1)) }.
 * When θ±h is invalid (residual null) a one-sided difference is used; a column with no valid side is zero
 * and its index is listed in `badColumns`. Returns { J, nEval, badColumns }.
 */
export function numericJacobian(residual, theta, opts = {}) {
  const diff = opts.diff ?? 'central';
  if (diff !== 'central' && diff !== 'forward') throw new RangeError("lm: diff must be 'central' or 'forward'");
  const relStep = opts.relStep ?? (diff === 'central' ? 6e-6 : 1.5e-8);
  let nEval = 0;
  let r0 = opts.r0 ?? null;
  if (!r0) {
    r0 = evalResidual(residual, theta);
    nEval++;
    if (!r0) return { J: null, nEval, badColumns: [] };
  }
  const m = r0.length;
  const n = theta.length;
  const h = stepsFor(theta, opts.step ?? null, relStep);
  const J = Array.from({ length: m }, () => new Float64Array(n));
  const badColumns = [];
  const tp = Float64Array.from(theta);
  for (let k = 0; k < n; k++) {
    const plus = theta[k] + h[k];
    const minus = theta[k] - h[k];
    const hp = plus - theta[k]; // exactly representable step
    const hm = theta[k] - minus;
    tp[k] = plus;
    const rp = evalResidual(residual, tp);
    nEval++;
    let rm = null;
    if (diff === 'central' || !rp) {
      tp[k] = minus;
      rm = evalResidual(residual, tp);
      nEval++;
    }
    tp[k] = theta[k];
    if (rp && rp.length !== m) throw new RangeError('lm: residual length changed between evaluations');
    if (rm && rm.length !== m) throw new RangeError('lm: residual length changed between evaluations');
    if (rp && rm && diff === 'central') {
      const d = hp + hm;
      for (let i = 0; i < m; i++) J[i][k] = (rp[i] - rm[i]) / d;
    } else if (rp) {
      for (let i = 0; i < m; i++) J[i][k] = (rp[i] - r0[i]) / hp;
    } else if (rm) {
      for (let i = 0; i < m; i++) J[i][k] = (r0[i] - rm[i]) / hm;
    } else {
      badColumns.push(k);
    }
  }
  return { J, nEval, badColumns };
}

function analyticJacobian(jacobian, theta, m, n) {
  const Jin = jacobian(Float64Array.from(theta));
  let J;
  if (Jin && typeof Jin[0] === 'number' && Jin.length === m * n) {
    J = Array.from({ length: m }, (_, i) => Float64Array.from(Jin.subarray ? Jin.subarray(i * n, (i + 1) * n) : Jin.slice(i * n, (i + 1) * n)));
  } else if (Jin && Jin.length === m) {
    J = Array.from(Jin, (row) => Float64Array.from(row));
  } else {
    throw new RangeError('lm: jacobian must return m rows of n (or a flat m·n row-major array)');
  }
  for (const row of J) {
    if (row.length !== n) throw new RangeError('lm: jacobian row length must equal theta length');
    for (let k = 0; k < n; k++) if (!Number.isFinite(row[k])) throw new RangeError('lm: jacobian has a non-finite entry');
  }
  return J;
}

/**
 * Levenberg–Marquardt.
 * opts: {
 *   residual(theta: Float64Array) -> Float64Array | number[] | null   (null / non-finite = invalid region),
 *   theta0: number[],
 *   jacobian?(theta) -> rows m×n (or flat row-major m·n); default numeric (see numericJacobian),
 *   diff = 'central', step?, relStep?   (numeric Jacobian controls),
 *   maxIter = 100 (Jacobian evaluations), lambda0 = 1e-3, tol = 1e-12 (relative cost decrease and relative
 *   step size), gtol = 1e-10 (max_k |gₖ| / sqrt(A_kk·cost), A = JᵀJ, g = Jᵀr), lambdaMax = 1e16 }
 * Returns { theta: Float64Array, cost, iterations, converged, reason, cov, covScaled, covRaw, dof,
 *   reducedChi2, J, r, nEval, badColumns }
 *   reason ∈ 'zero_cost'|'gtol'|'ftol'|'xtol'|'max_iter'|'lambda_max'|'invalid_start';
 *   covRaw = (JᵀJ)⁻¹ at the solution; cov = covScaled = covRaw · max(cost/dof, 1) with dof = max(m − n, 1);
 *   both null when JᵀJ is singular. J (rows) and r are evaluated at the returned theta.
 */
export function lm(opts) {
  const {
    residual,
    theta0,
    jacobian = null,
    maxIter = 100,
    lambda0 = 1e-3,
    tol = 1e-12,
    gtol = 1e-10,
    lambdaMax = 1e16,
    diff = 'central',
    step = null,
    relStep = null,
  } = opts;
  if (typeof residual !== 'function') throw new TypeError('lm: residual must be a function');
  const n = theta0.length;
  let theta = Float64Array.from(theta0);
  let nEval = 0;
  let r = evalResidual(residual, theta);
  nEval++;
  if (!r) {
    return {
      theta, cost: Infinity, iterations: 0, converged: false, reason: 'invalid_start', cov: null, covScaled: null,
      covRaw: null, dof: NaN, reducedChi2: NaN, J: null, r: null, nEval, badColumns: [],
    };
  }
  const m = r.length;
  let badColumns = [];
  const jac = (th, rr) => {
    if (jacobian) return analyticJacobian(jacobian, th, m, n);
    const res = numericJacobian(residual, th, { r0: rr, diff, step, relStep: relStep ?? undefined });
    nEval += res.nEval;
    badColumns = res.badColumns;
    return res.J;
  };
  let cost = sumSq(r);
  let lambda = lambda0;
  let iterations = 0;
  let converged = false;
  let reason = 'max_iter';
  let J = jac(theta, r);

  outer: while (iterations < maxIter) {
    iterations++;
    const A = gram(J);
    const g = gramVec(J, r);
    let gScaled = 0;
    let maxDiag = 0;
    for (let k = 0; k < n; k++) {
      maxDiag = Math.max(maxDiag, A[k][k]);
      const den = Math.sqrt(A[k][k] * cost);
      if (den > 0) gScaled = Math.max(gScaled, Math.abs(g[k]) / den);
    }
    if (cost === 0) { converged = true; reason = 'zero_cost'; break; }
    if (gScaled <= gtol) { converged = true; reason = 'gtol'; break; }
    const floor = 1e-12 * maxDiag + 1e-300;
    for (;;) {
      const M = A.map((row) => Float64Array.from(row));
      for (let k = 0; k < n; k++) M[k][k] += lambda * (A[k][k] + floor);
      const negG = g.map((x) => -x);
      const L = cholesky(M);
      const delta = L ? choleskySolve(L, negG) : solve(M, negG);
      if (!delta) {
        lambda = Math.max(lambda * 10, 1e-12);
        if (lambda > lambdaMax) { reason = 'lambda_max'; break outer; }
        continue;
      }
      const thetaNew = new Float64Array(n);
      for (let k = 0; k < n; k++) thetaNew[k] = theta[k] + delta[k];
      const stepSmall = norm(delta) <= tol * (norm(theta) + tol);
      const rNew = evalResidual(residual, thetaNew);
      nEval++;
      if (rNew && rNew.length !== m) throw new RangeError('lm: residual length changed between evaluations');
      const costNew = rNew ? sumSq(rNew) : Infinity;
      if (costNew < cost) {
        const rel = (cost - costNew) / cost;
        theta = thetaNew;
        r = rNew;
        cost = costNew;
        lambda = Math.max(lambda * 0.3, 1e-15);
        J = jac(theta, r);
        if (rel <= tol) { converged = true; reason = 'ftol'; break outer; }
        if (stepSmall) { converged = true; reason = 'xtol'; break outer; }
        break;
      }
      if (stepSmall) { converged = true; reason = 'xtol'; break outer; }
      lambda = Math.max(lambda * 10, 1e-12);
      if (lambda > lambdaMax) { reason = 'lambda_max'; break outer; }
    }
  }

  const dof = Math.max(m - n, 1);
  const reducedChi2 = cost / dof;
  const covRaw = inverseSPD(gram(J));
  const k = Math.max(reducedChi2, 1);
  const cov = covRaw ? covRaw.map((row) => row.map((x) => x * k)) : null;
  return { theta, cost, iterations, converged, reason, cov, covScaled: cov, covRaw, dof, reducedChi2, J, r, nEval, badColumns };
}
