// LM-F acceptance 1 (LAUNCH-MONITOR-SPEC §5.2): store/stats.js summarize / isMishit / gapping / gappingCSV.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { summarize, isMishit, mishitMask, gapping, gappingCSV, GAPPING_CSV_COLUMNS, percentileSorted } from '../../app/src/store/stats.js';
import { CLUBS } from '../../app/src/session/settings.js';

const near = (a, b, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);
const FIXTURE = JSON.parse(fs.readFileSync(new URL('../fixtures/lm/sessions-1000.json', import.meta.url), 'utf8'));

test('summarize([10,12,14],[0,0,0]) → mean 12, sd_obs 2, sd_est 2', () => {
  const s = summarize([10, 12, 14], [0, 0, 0]);
  assert.equal(s.n, 3);
  assert.equal(s.mean, 12);
  assert.equal(s.median, 12);
  near(s.sd_obs, 2);
  assert.equal(s.sigma_noise, 0);
  near(s.sd_est, 2);
  assert.equal(s.indistinguishable, false);
  // Student t(2) = 4.303: 12 ± 4.303 · 2 / √3
  near(s.ci95_mean[0], 12 - 4.303 * 2 / Math.sqrt(3), 1e-9);
  near(s.ci95_mean[1], 12 + 4.303 * 2 / Math.sqrt(3), 1e-9);
});

test('sd_obs = 2 with every sigma 2 → indistinguishable, sd_est 0', () => {
  const s = summarize([10, 12, 14], [2, 2, 2]);
  near(s.sd_obs, 2);
  near(s.sigma_noise, 2);
  assert.equal(s.sd_est, 0);
  assert.equal(s.indistinguishable, true);
  // 1.2 × noise is the line: just above it is distinguishable
  const t = summarize([10, 12, 14], [1.6, 1.6, 1.6]);
  assert.equal(t.indistinguishable, false);
  near(t.sd_est, Math.sqrt(4 - 1.6 ** 2));
  // sigma_noise is the root mean square of the per-shot sigmas
  near(summarize([1, 2, 3, 4], [1, 1, 3, 3]).sigma_noise, Math.sqrt(5));
});

test('P10 / P90 / median match numpy percentile(method="linear") (reference numbers written by numpy)', () => {
  // numpy: np.percentile([3.1,7.4,1.2,9.9,5.5,2.8,6.6,4.0], [10, 90], method='linear') → [2.32, 8.15]; median 4.75
  const s = summarize([3.1, 7.4, 1.2, 9.9, 5.5, 2.8, 6.6, 4.0], []);
  near(s.p10, 2.32, 1e-12, 'p10');
  near(s.p90, 8.15, 1e-12, 'p90');
  near(s.median, 4.75, 1e-12, 'median');
  // np.percentile([10,12,14,15], [10, 90]) → [10.6, 14.7]
  near(percentileSorted([10, 12, 14, 15], 0.1), 10.6, 1e-12);
  near(percentileSorted([10, 12, 14, 15], 0.9), 14.7, 1e-12);
});

test('summarize: empty, one value, non-finite values dropped with their sigma, unknown noise', () => {
  const e = summarize([], []);
  assert.deepEqual([e.n, e.mean, e.median, e.sd_obs, e.p10, e.ci95_mean, e.indistinguishable], [0, null, null, null, null, null, false]);
  const one = summarize([5], [1]);
  assert.deepEqual([one.n, one.mean, one.sd_obs, one.sd_est, one.ci95_mean], [1, 5, null, null, null]);
  const d = summarize([1, null, 3, NaN], [1, 99, 1, 99]);
  assert.equal(d.n, 2);
  assert.equal(d.sigma_noise, 1);
  const u = summarize([1, 2, 3], [null, null, null]);
  assert.equal(u.sigma_noise, null);
  assert.equal(u.sd_est, null);
  assert.equal(u.indistinguishable, false);
});

test('isMishit: MAD 3.5× rule; tiny or flat samples never flag', () => {
  const all = [100, 101, 99, 102, 98, 100, 101, 60];
  assert.equal(isMishit(60, all), true);
  assert.equal(isMishit(103, all), false);
  assert.deepEqual(mishitMask(all), [false, false, false, false, false, false, false, true]);
  assert.equal(isMishit(1, [5, 5, 5, 5, 5, 1]), false); // MAD 0
  assert.equal(isMishit(0, [100, 101, 0]), false); // n < 5
});

test('gapping on the 1000-shot fixture: clubs sorted by club length, face_on only by default, small_sample when n < 5', () => {
  const rows = gapping(FIXTURE.shots);
  const order = CLUBS.map((c) => c[0]);
  const clubs = rows.map((r) => r.club);
  assert.deepEqual(clubs, [...clubs].sort((a, b) => order.indexOf(a) - order.indexOf(b)), 'longest club first');
  assert.equal(clubs[0], 'driver');
  assert.equal(rows.length, 8);
  const fo = (club) => FIXTURE.shots.filter((s) => s.capture.view === 'face_on' && s.club.type === club && Number.isFinite(s.metrics.carry_m.value)).length;
  for (const r of rows) {
    assert.equal(r.n, fo(r.club), `${r.club} n`);
    assert.equal(r.n_hb, 0);
    assert.ok(r.carry.p10 <= r.carry.median && r.carry.median <= r.carry.p90);
  }
  for (let i = 0; i < rows.length - 1; i++) near(rows[i].gap_next_m, rows[i].carry.median - rows[i + 1].carry.median, 1e-9);
  assert.equal(rows.at(-1).gap_next_m, null);
  // includeHB adds the high-behind carries
  const hb = gapping(FIXTURE.shots, { includeHB: true });
  assert.ok(hb.every((r) => r.n_hb > 0 && r.n > fo(r.club)));
  // a 3-shot club is flagged small_sample
  const swFo = FIXTURE.shots.filter((s) => s.club.type === 'sw' && s.capture.view === 'face_on').slice(3);
  const few = gapping(FIXTURE.shots.filter((s) => !swFo.includes(s)));
  const sw = few.find((r) => r.club === 'sw');
  assert.ok(sw.n < 5, `sw n ${sw.n}`);
  assert.ok(sw.flags.includes('small_sample') && sw.flag.includes('small_sample'));
  assert.ok(few.filter((r) => r.club !== 'sw').every((r) => !r.flags.includes('small_sample')));
});

test('gapping: gap thresholds, mishit exclusion, unknown clubs after the known ones', () => {
  const shot = (club, carry, view = 'face_on') => ({ club: { type: club }, capture: { view }, metrics: { carry_m: { value: carry, sigma: 2, unit: 'm' }, total_m: { value: carry + 10, sigma: 3, unit: 'm' } } });
  const many = (club, c, n = 6) => Array.from({ length: n }, (_, i) => shot(club, c + (i % 3) - 1));
  const rows = gapping([...many('7i', 140), ...many('9i', 135), ...many('pw', 100), ...many('zz', 50), shot('7i', 60)], { gapMin: 7.3152, gapMax: 18.288 });
  assert.deepEqual(rows.map((r) => r.club), ['7i', '9i', 'pw', 'zz']);
  assert.ok(rows[0].flags.includes('gap_small'));
  assert.ok(rows[1].flags.includes('gap_large'));
  assert.equal(rows[0].n, 7);
  const ex = gapping([...many('7i', 140), shot('7i', 60)], { excludeMishits: true });
  assert.equal(ex[0].n, 6);
});

test('gappingCSV: exact ASCII header, metres, no CJK', () => {
  assert.equal(GAPPING_CSV_COLUMNS.join(','), 'club,n,carry_median_m,carry_p10_m,carry_p90_m,total_median_m,gap_next_m,flag');
  const csv = gappingCSV(gapping(FIXTURE.shots));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0], 'club,n,carry_median_m,carry_p10_m,carry_p90_m,total_median_m,gap_next_m,flag');
  assert.equal(lines.length, 9);
  assert.ok(/^[\x20-\x7e\r\n]*$/.test(csv), 'ASCII only');
  assert.ok(lines.slice(1).every((l) => l.split(',').length === 8));
});
