import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, gauss, uniform } from '../../app/src/geom/rng.js';
import { mean, std, variance, median, mad, percentile, quantile, rmse, sum, MAD_TO_SIGMA } from '../../app/src/geom/stats.js';

test('mulberry32 is deterministic per seed, in [0,1), and seeds differ', () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  const c = mulberry32(12346);
  const sa = Array.from({ length: 1000 }, () => a());
  const sb = Array.from({ length: 1000 }, () => b());
  const sc = Array.from({ length: 1000 }, () => c());
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  for (const x of sa) assert.ok(x >= 0 && x < 1);
  assert.ok(Math.abs(mean(sa) - 0.5) < 0.03);
  // Regression pin: the reference mulberry32 sequence for seed 1.
  const r1 = mulberry32(1);
  assert.equal(r1(), 0.6270739405881613);
  assert.equal(r1(), 0.002735721180215478);
});

test('mulberry32 rejects non-numeric seeds', () => {
  assert.throws(() => mulberry32('x'), TypeError);
  assert.throws(() => mulberry32(NaN), TypeError);
});

test('gauss: deterministic, mean 0 / sd 1, uses two draws', () => {
  const r = mulberry32(7);
  const xs = Array.from({ length: 20000 }, () => gauss(r));
  assert.ok(Math.abs(mean(xs)) < 0.03, `mean ${mean(xs)}`);
  assert.ok(Math.abs(std(xs) - 1) < 0.03, `std ${std(xs)}`);
  const r2 = mulberry32(7);
  assert.equal(gauss(r2), xs[0]);
  const r3 = mulberry32(7);
  r3(); r3();
  assert.equal(gauss(r3), xs[1]);
  const r4 = mulberry32(9);
  const ys = Array.from({ length: 5000 }, () => gauss(r4, 3, 0.5));
  assert.ok(Math.abs(mean(ys) - 3) < 0.03);
  const u = uniform(mulberry32(1), 2, 4);
  assert.ok(u >= 2 && u < 4);
});

test('stats: known values', () => {
  const x = [2, 4, 4, 4, 5, 5, 7, 9];
  assert.equal(sum(x), 40);
  assert.equal(mean(x), 5);
  assert.equal(std(x, 0), 2);
  assert.ok(Math.abs(variance(x) - 32 / 7) < 1e-15);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(percentile([1, 2, 3, 4], 25), 1.75);
  assert.equal(percentile([1, 2, 3, 4], 0), 1);
  assert.equal(percentile([1, 2, 3, 4], 100), 4);
  assert.ok(Math.abs(percentile([10, 20, 30, 40, 50], 90) - 46) < 1e-12);
  assert.equal(quantile(Float64Array.of(5, 1, 3), 0.5), 3);
  assert.equal(mad([1, 1, 2, 2, 4, 6, 9]), 1);
  assert.ok(Math.abs(mad([1, 1, 2, 2, 4, 6, 9], MAD_TO_SIGMA) - 1.482602218505602) < 1e-15);
  assert.equal(rmse([3, 4]), Math.sqrt(12.5));
  assert.equal(rmse([1, 2, 3], [1, 2, 5]), Math.sqrt(4 / 3));
  assert.ok(Number.isNaN(mean([])));
  assert.ok(Number.isNaN(median([])));
  assert.ok(Number.isNaN(median([1, NaN, 2])));
  assert.ok(Number.isNaN(std([1])));
  assert.throws(() => percentile([1], 101), RangeError);
  assert.throws(() => rmse([1, 2], [1]), RangeError);
});

test('stats: MAD·1.4826 estimates sigma of normal data', () => {
  const r = mulberry32(3);
  const xs = Array.from({ length: 20000 }, () => gauss(r, 0, 2));
  assert.ok(Math.abs(mad(xs, MAD_TO_SIGMA) - 2) < 0.06);
});
