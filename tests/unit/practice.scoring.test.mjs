// practice.scoring — LAUNCH-MONITOR-SPEC §5.2 LM-E acceptance 1: scoreShot table cases and the MC score sigma.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreShot, scoreOf, meanScore, SCORE_K } from '../../app/src/practice/scoring.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('table: T = 100 m, k = 0.25 (d = 0 → 100, d = 25 → 0, d = 12.5 → 50, beyond 25 → 0)', () => {
  assert.equal(SCORE_K, 0.25);
  const cases = [[100, 100], [125, 0], [75, 0], [112.5, 50], [87.5, 50], [150, 0], [106.25, 75]];
  for (const [carry, want] of cases) {
    const r = scoreShot({ target_m: 100, carry_m: carry, carry_sigma: 0, side_m: null, side_sigma: null, k: 0.25 });
    close(r.score, want);
    close(r.miss_m, carry - 100);
    assert.equal(r.miss_side_m, null);
    assert.equal(r.score_sigma, 0);
  }
});

test('with side: the 2D distance √((carry − T)² + side²) is used', () => {
  const r = scoreShot({ target_m: 100, carry_m: 107.5, carry_sigma: 0, side_m: 10, side_sigma: 0, k: 0.25 });
  close(r.score, 100 * (1 - 12.5 / 25)); // √(7.5² + 10²) = 12.5
  close(r.miss_side_m, 10);
  const left = scoreShot({ target_m: 100, carry_m: 100, carry_sigma: 0, side_m: -12.5, side_sigma: 0, k: 0.25 });
  close(left.score, 50);
  close(scoreOf(12.5, 100), 50);
});

test('score_sigma: 0 for carry_sigma 0; 18–22 for carry sigma 5 m (MC 200, fixed seed)', () => {
  assert.equal(scoreShot({ target_m: 100, carry_m: 112.5, carry_sigma: 0, side_m: null, side_sigma: null, k: 0.25 }).score_sigma, 0);
  const a = scoreShot({ target_m: 100, carry_m: 112.5, carry_sigma: 5, side_m: null, side_sigma: null, k: 0.25 });
  const b = scoreShot({ target_m: 100, carry_m: 112.5, carry_sigma: 5, side_m: null, side_sigma: null, k: 0.25 });
  assert.equal(a.score_sigma, b.score_sigma, 'fixed seed → reproducible');
  assert.ok(a.score_sigma >= 18 && a.score_sigma <= 22, `score_sigma ${a.score_sigma}`);
  console.log(`# score_sigma(carry σ 5 m, d = 12.5 m) = ${a.score_sigma.toFixed(2)}`);
});

test('no carry value → null score (not 0); bad target throws', () => {
  assert.deepEqual(scoreShot({ target_m: 100, carry_m: null, carry_sigma: null, side_m: null, side_sigma: null, k: 0.25 }), { score: null, score_sigma: null, miss_m: null, miss_side_m: null });
  assert.throws(() => scoreShot({ target_m: 0, carry_m: 100 }), RangeError);
});

test('meanScore: mean and 95 % interval from the per-shot sigmas', () => {
  const m = meanScore([{ score: 60, score_sigma: 6 }, { score: 80, score_sigma: 8 }, { score: null }]);
  assert.equal(m.n, 2);
  close(m.mean, 70);
  close(m.sigma, 5);
  close(m.ci95[0], 70 - 9.8);
  assert.equal(meanScore([]), null);
});
