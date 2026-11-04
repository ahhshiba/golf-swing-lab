import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cross3, dot3, normalize3, mat3Mul, mat3Inverse, mat3Det, mat3Transpose, mat3Identity, mat3MulVec, mat3TMulVec,
  solve, inverse, inverseSPD, det, cholesky, choleskySolve, matMul, matVec, transpose, gram, gramVec, identity,
  eigenSym, smallestSingularVector, hartleyNormalize, rodrigues, rvecFromR, rotAxisAngle, quatFromR, rFromQuat,
  orthonormalize, isRotation,
} from '../../app/src/geom/linalg.js';
import { mulberry32, gauss } from '../../app/src/geom/rng.js';

const maxAbsDiff = (a, b) => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
};
const maxAbsDiffRows = (A, B) => Math.max(...A.map((row, i) => maxAbsDiff(row, B[i])));

test('vec3 and mat3 basics', () => {
  assert.deepEqual(cross3([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
  assert.equal(dot3([1, 2, 3], [4, 5, 6]), 32);
  assert.throws(() => normalize3([0, 0, 0]), RangeError);
  const A = [2, 1, 0, 1, 3, 1, 0, 1, 4];
  const Ai = mat3Inverse(A);
  assert.ok(maxAbsDiff(mat3Mul(A, Ai), mat3Identity()) < 1e-15);
  assert.ok(Math.abs(mat3Det(A) - 18) < 1e-12);
  assert.equal(mat3Inverse([1, 2, 3, 2, 4, 6, 1, 1, 1]), null);
  assert.deepEqual(mat3Transpose([1, 2, 3, 4, 5, 6, 7, 8, 9]), [1, 4, 7, 2, 5, 8, 3, 6, 9]);
  assert.deepEqual(mat3TMulVec(A, [1, 2, 3]), mat3MulVec(mat3Transpose(A), [1, 2, 3]));
});

test('solve uses partial pivoting and detects singular systems', () => {
  // Zero leading pivot: fails without pivoting.
  const A = [[0, 2, 1], [1, 1, 1], [2, 1, 0]];
  const xTrue = [1, -2, 3];
  const b = matVec(A, xTrue);
  assert.ok(maxAbsDiff(solve(A, b), xTrue) < 1e-14);
  // Tiny leading pivot (1e-18): naive elimination loses everything.
  const B = [[1e-18, 1], [1, 1]];
  const xb = solve(B, [1, 2]);
  assert.ok(Math.abs(xb[0] - 1) < 1e-12 && Math.abs(xb[1] - 1) < 1e-12);
  assert.equal(solve([[1, 2], [2, 4]], [1, 2]), null);
  assert.throws(() => solve([[1, 2], [3, 4]], [1]), RangeError);
  assert.ok(Math.abs(det(A) - 3) < 1e-14);
});

test('solve and inverse on random 12×12 systems', () => {
  const r = mulberry32(42);
  for (let trial = 0; trial < 20; trial++) {
    const n = 1 + (trial % 12);
    const A = Array.from({ length: n }, () => Array.from({ length: n }, () => gauss(r)));
    const x = Array.from({ length: n }, () => gauss(r));
    const xs = solve(A, matVec(A, x));
    assert.ok(maxAbsDiff(xs, x) < 1e-9, `n=${n}`);
    const Ai = inverse(A);
    assert.ok(maxAbsDiffRows(matMul(A, Ai), identity(n)) < 1e-10);
  }
});

test('cholesky and inverseSPD', () => {
  const r = mulberry32(5);
  const M = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => gauss(r)));
  const S = gram(M); // SPD
  const L = cholesky(S);
  assert.ok(maxAbsDiffRows(matMul(L, transpose(L)), S) < 1e-12);
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) assert.equal(L[i][j], 0);
  const x = [1, 2, 3, 4, 5, 6];
  assert.ok(maxAbsDiff(choleskySolve(L, matVec(S, x)), x) < 1e-9);
  assert.equal(cholesky([[1, 2], [2, 1]]), null);
  // Badly scaled SPD matrix (parameters in very different units) still inverts.
  const D = [1e-4, 1, 1e4, 1, 1, 1];
  const Sb = S.map((row, i) => row.map((v, j) => v * D[i] * D[j]));
  const Ib = inverseSPD(Sb);
  const Si = inverse(S);
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      const ref = Si[i][j] / (D[i] * D[j]);
      assert.ok(Math.abs(Ib[i][j] - ref) <= 1e-9 * Math.abs(ref) + 1e-12, `(${i},${j})`);
    }
  }
  assert.equal(inverseSPD([[1, 1], [1, 1]]), null);
});

test('eigenSym on known matrices', () => {
  const e2 = eigenSym([[2, 1], [1, 2]]);
  assert.ok(maxAbsDiff(e2.values, [1, 3]) < 1e-15);
  const v1 = e2.vectors[0];
  assert.ok(Math.abs(Math.abs(v1[0]) - Math.SQRT1_2) < 1e-15 && Math.abs(v1[0] + v1[1]) < 1e-15);
  // Classic 3×3 with eigenvalues 2 − √2, 2, 2 + √2.
  const e3 = eigenSym([[2, -1, 0], [-1, 2, -1], [0, -1, 2]]);
  assert.ok(maxAbsDiff(e3.values, [2 - Math.SQRT2, 2, 2 + Math.SQRT2]) < 1e-14);
  // Diagonal input with unsorted values.
  const ed = eigenSym([[3, 0, 0], [0, -1, 0], [0, 0, 2]]);
  assert.deepEqual(Array.from(ed.values), [-1, 2, 3]);
  // Q·diag·Qᵀ with known spectrum, n = 9 (DLT size): eigenpairs, orthonormality.
  const r = mulberry32(11);
  for (const n of [4, 9, 12]) {
    const lam = Array.from({ length: n }, (_, i) => (i - 3) * 1.7 + 0.01 * i * i);
    const G = Array.from({ length: n }, () => Array.from({ length: n }, () => gauss(r)));
    // Orthonormalise G's columns (Gram–Schmidt) to get Q.
    const Q = Array.from({ length: n }, () => new Float64Array(n));
    for (let j = 0; j < n; j++) {
      const v = G.map((row) => row[j]);
      for (let k = 0; k < j; k++) {
        let d = 0;
        for (let i = 0; i < n; i++) d += v[i] * Q[i][k];
        for (let i = 0; i < n; i++) v[i] -= d * Q[i][k];
      }
      const nv = Math.hypot(...v);
      for (let i = 0; i < n; i++) Q[i][j] = v[i] / nv;
    }
    const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => {
      let s = 0;
      for (let k = 0; k < n; k++) s += Q[i][k] * lam[k] * Q[j][k];
      return s;
    }));
    const e = eigenSym(A);
    const sorted = [...lam].sort((a, b) => a - b);
    assert.ok(maxAbsDiff(e.values, sorted) < 1e-12, `n=${n}`);
    for (let k = 0; k < n; k++) {
      const Av = matVec(A, e.vectors[k]);
      const res = Av.map((x, i) => x - e.values[k] * e.vectors[k][i]);
      assert.ok(Math.max(...res.map(Math.abs)) < 1e-12);
      for (let l = 0; l < n; l++) {
        let d = 0;
        for (let i = 0; i < n; i++) d += e.vectors[k][i] * e.vectors[l][i];
        assert.ok(Math.abs(d - (k === l ? 1 : 0)) < 1e-13);
      }
    }
  }
});

test('smallestSingularVector finds the null vector of an m×n matrix', () => {
  const r = mulberry32(21);
  const n = 9;
  const vTrue = normalizeN(Array.from({ length: n }, () => gauss(r)));
  // Rows orthogonal to vTrue.
  const A = Array.from({ length: 30 }, () => {
    const a = Array.from({ length: n }, () => gauss(r));
    const d = a.reduce((s, x, i) => s + x * vTrue[i], 0);
    return a.map((x, i) => x - d * vTrue[i]);
  });
  const { v, sigma, sigmaNext } = smallestSingularVector(A);
  const sgn = Math.sign(v.reduce((s, x, i) => s + x * vTrue[i], 0));
  assert.ok(maxAbsDiff(v.map((x) => x * sgn), vTrue) < 1e-7);
  assert.ok(sigma < 1e-6 && sigmaNext > 1);
  // Sign convention: largest-magnitude component positive.
  let imax = 0;
  for (let i = 1; i < n; i++) if (Math.abs(v[i]) > Math.abs(v[imax])) imax = i;
  assert.ok(v[imax] > 0);
  assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-14);
  // gram / gramVec consistency.
  const g = gramVec(A, Array(30).fill(1));
  const g2 = matVec(transpose(A), Array(30).fill(1));
  assert.ok(maxAbsDiff(g, g2) < 1e-12);
});

function normalizeN(v) {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}

test('hartleyNormalize: centroid 0, mean distance sqrt(d), T maps points', () => {
  const pts = [[100, 200], [1500, 300], [900, 1000], [50, 800]];
  const { T, pts: q } = hartleyNormalize(pts);
  const c = [0, 0];
  let md = 0;
  for (const p of q) { c[0] += p[0] / 4; c[1] += p[1] / 4; md += Math.hypot(p[0], p[1]) / 4; }
  assert.ok(Math.abs(c[0]) < 1e-12 && Math.abs(c[1]) < 1e-12);
  assert.ok(Math.abs(md - Math.SQRT2) < 1e-12);
  const p0 = mat3MulVec(T, [100, 200, 1]);
  assert.ok(Math.abs(p0[0] - q[0][0]) < 1e-12 && Math.abs(p0[1] - q[0][1]) < 1e-12 && p0[2] === 1);
  const h3 = hartleyNormalize([[0, 0, 0], [1, 0, 0], [0, 2, 0], [0, 0, 3]]);
  assert.equal(h3.T.length, 16);
});

test('rodrigues ↔ rvecFromR round trip incl. near 0 and near π', () => {
  const r = mulberry32(99);
  const angles = [0, 1e-12, 1e-9, 1e-6, 1e-3, 0.3, 1, 2, 3, Math.PI - 1e-3, Math.PI - 1e-6, Math.PI - 1e-9];
  for (const th of angles) {
    for (let k = 0; k < 20; k++) {
      const axis = normalize3([gauss(r), gauss(r), gauss(r)]);
      const rv = axis.map((a) => a * th);
      const R = rodrigues(rv);
      assert.ok(isRotation(R, 1e-14), `th=${th}`);
      const back = rvecFromR(R);
      assert.ok(maxAbsDiff(back, rv) < 1e-9, `th=${th} err=${maxAbsDiff(back, rv)}`);
      assert.ok(maxAbsDiff(rodrigues(back), R) < 1e-14);
    }
  }
  // Exactly π: the axis sign is ambiguous, the rotation is not.
  const Rpi = rotAxisAngle([1, 2, 2], Math.PI);
  assert.ok(maxAbsDiff(rodrigues(rvecFromR(Rpi)), Rpi) < 1e-14);
  // Right-hand rule: +90° about z maps x to y.
  const Rz = rotAxisAngle([0, 0, 1], Math.PI / 2);
  assert.ok(maxAbsDiff(mat3MulVec(Rz, [1, 0, 0]), [0, 1, 0]) < 1e-15);
});

test('quaternions round trip', () => {
  const r = mulberry32(8);
  for (let k = 0; k < 50; k++) {
    const R = rodrigues([gauss(r), gauss(r), gauss(r)]);
    const q = quatFromR(R);
    assert.ok(q[0] >= 0);
    assert.ok(maxAbsDiff(rFromQuat(q), R) < 1e-14);
  }
});

test('orthonormalize returns the nearest proper rotation', () => {
  const r = mulberry32(31);
  for (let k = 0; k < 30; k++) {
    const R = rodrigues([gauss(r), gauss(r), gauss(r)]);
    assert.ok(maxAbsDiff(orthonormalize(R), R) < 1e-14);
    const M = R.map((x) => x + 0.05 * gauss(r));
    const Q = orthonormalize(M);
    assert.ok(isRotation(Q, 1e-13));
    // Local optimality: no small rotation of Q is closer to M (maximises trace(Qᵀ M)).
    const score = (X) => X.reduce((s, x, i) => s + x * M[i], 0);
    const s0 = score(Q);
    for (let j = 0; j < 12; j++) {
      const dR = rodrigues([1e-4 * gauss(r), 1e-4 * gauss(r), 1e-4 * gauss(r)]);
      assert.ok(score(mat3Mul(dR, Q)) <= s0 + 1e-14);
    }
  }
  // det < 0 input still yields a proper rotation.
  const Rf = orthonormalize([1, 0, 0, 0, 1, 0, 0, 0, -1.0001].map((x, i) => x + (i === 1 ? 0.01 : 0)));
  assert.ok(isRotation(Rf, 1e-13));
  assert.equal(isRotation([1, 0, 0, 0, 1, 0, 0, 0, -1]), false);
});
