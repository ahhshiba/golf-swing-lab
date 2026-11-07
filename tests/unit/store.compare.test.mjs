import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mulberry32 } from '../../app/src/geom/rng.js';
import { RC, REASON_CODES } from '../../app/src/contract/reason-codes.js';
import { compareShots, compareSets, tCritical95 } from '../../app/src/store/compare.js';
import { METRIC_IDS } from '../../app/src/store/metric-ids.js';
import { makeShot, hasChinese } from './store.fixtures.mjs';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (tol ${tol})`);

function withMetric(shot, id, value, { sigma, ci95, unit = 'ratio', validity = 'valid' } = {}) {
  const m = { value, unit, ci95: ci95 ?? null, sigma: sigma ?? null, validity, value_origin: 'pose', measured: false, reason_codes: [] };
  return { ...shot, metrics: { ...shot.metrics, [id]: m } };
}

test('RC.PRESET_MISMATCH exists with a Chinese description', () => {
  // reason-codes.js holds codes only (PRODUCT-SPEC §3.4); the description is the zh-Hant catalog's `.long` value
  assert.equal(RC.PRESET_MISMATCH, 'PRESET_MISMATCH');
  assert.equal(REASON_CODES.PRESET_MISMATCH, 'PRESET_MISMATCH');
  const zh = JSON.parse(fs.readFileSync(new URL('../../app/i18n/zh-Hant/reason.json', import.meta.url), 'utf8'));
  for (const part of ['short', 'long', 'fix']) assert.ok(hasChinese(zh[`PRESET_MISMATCH.${part}`]), `reason.PRESET_MISMATCH.${part}`);
});

test('same preset, view and club: no warnings, no notes, like_for_like', () => {
  const a = withMetric(makeShot({ id: 'a' }), 'tempo_ratio', 3.0, { sigma: 0.05 });
  const b = withMetric(makeShot({ id: 'b' }), 'tempo_ratio', 3.3, { sigma: 0.05 });
  const r = compareShots(a, b);
  assert.equal(r.kind, 'shots');
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.notes, []);
  assert.equal(r.like_for_like, true);
  assert.equal(r.a.shot_id, 'a');
  assert.equal(r.b.preset_id, 'preset-A');
  const t = r.metrics.tempo_ratio;
  assert.equal(t.status, 'compared');
  near(t.delta, 0.3, 1e-12);
  const half = 1.959964 * Math.hypot(0.05, 0.05);
  near(t.delta_ci95[0], 0.3 - half, 1e-9);
  near(t.delta_ci95[1], 0.3 + half, 1e-9);
  assert.equal(t.significant, true); // 0.3 > 0.139
  assert.equal(t.unit, 'ratio');
});

test('cross-preset comparison ALWAYS carries PRESET_MISMATCH (200 random pairs, plus missing ids)', () => {
  const rng = mulberry32(99);
  const presets = ['preset-A', 'preset-B', 'preset-C', 'p4', 'x'];
  const views = ['face_on', 'dtl', 'high_behind'];
  const clubs = ['7i', 'driver', '5w'];
  const pick = (a) => a[Math.floor(rng() * a.length)];
  let different = 0;
  for (let i = 0; i < 200; i++) {
    const pa = pick(presets);
    const pb = pick(presets);
    const a = makeShot({ id: 'a', preset_id: pa, view: pick(views), club_type: pick(clubs), seed: i });
    const b = makeShot({ id: 'b', preset_id: pb, view: pick(views), club_type: pick(clubs), seed: i + 1000 });
    const r = compareShots(a, b);
    if (pa !== pb) {
      different++;
      assert.ok(r.warnings.includes(RC.PRESET_MISMATCH), `${pa} vs ${pb}`);
      assert.equal(r.like_for_like, false);
    } else {
      assert.ok(!r.warnings.includes(RC.PRESET_MISMATCH), `${pa} vs ${pb}`);
    }
    assert.equal(new Set(r.warnings).size, r.warnings.length);
    // every warning is a defined reason code
    for (const w of r.warnings) assert.ok(w in REASON_CODES);
  }
  assert.ok(different > 100);
  // a missing preset id on either side cannot prove "same setup"
  const base = makeShot({ id: 'a' });
  for (const missing of [undefined, null, '']) {
    const noPreset = { ...makeShot({ id: 'b' }), preset_id: missing };
    assert.ok(compareShots(base, noPreset).warnings.includes(RC.PRESET_MISMATCH));
    assert.ok(compareShots(noPreset, base).warnings.includes(RC.PRESET_MISMATCH));
    assert.ok(compareShots(noPreset, noPreset).warnings.includes(RC.PRESET_MISMATCH));
  }
  // comparing a shot with itself is like for like
  assert.equal(compareShots(base, base).like_for_like, true);
});

test('view and club mismatches produce coded notes (no localized text)', () => {
  const a = makeShot({ id: 'a', view: 'face_on', club_type: '7i' });
  const b = makeShot({ id: 'b', view: 'dtl', club_type: 'driver', preset_id: 'preset-B' });
  const r = compareShots(a, b);
  const kinds = r.notes.map((n) => n.kind).sort();
  assert.deepEqual(kinds, ['club_mismatch', 'view_mismatch']);
  for (const n of r.notes) { assert.equal('text' in n, false); assert.ok(!hasChinese(JSON.stringify(n)), JSON.stringify(n)); }
  assert.deepEqual(r.notes.find((n) => n.kind === 'view_mismatch').params, { a: 'face_on', b: 'dtl' });
  assert.deepEqual(r.notes.find((n) => n.kind === 'club_mismatch').params, { a: '7i', b: 'driver' });
  assert.ok(r.warnings.includes(RC.PRESET_MISMATCH)); // different presets too
  // same preset but a different club: only the club note
  const c = makeShot({ id: 'c', club_type: 'driver' });
  const r2 = compareShots(a, c);
  assert.deepEqual(r2.warnings, []);
  assert.deepEqual(r2.notes.map((n) => n.kind), ['club_mismatch']);
  assert.equal(r2.like_for_like, false);
});

test('metric statuses: null, missing, unit mismatch; ordering follows the metric id list', () => {
  const a = makeShot({ id: 'a' });
  const b = makeShot({ id: 'b' });
  const r = compareShots(a, b);
  // fixture: head_depth_y_m and ball_speed_mps are null on both
  assert.equal(r.metrics.head_depth_y_m.status, 'both_null');
  assert.equal(r.metrics.head_depth_y_m.delta, null);
  assert.equal(r.metrics.head_depth_y_m.a.validity, 'not_observable');
  assert.deepEqual(r.metrics.ball_speed_mps.a.reason_codes, [RC.FPS_TOO_LOW]);
  assert.equal(r.metrics.carry_m, undefined, 'absent in both shots: not listed');
  const order = Object.keys(r.metrics);
  assert.deepEqual(order, METRIC_IDS.filter((id) => id in r.metrics));

  const withBall = withMetric(b, 'ball_speed_mps', 50, { sigma: 1, unit: 'm/s' });
  const r2 = compareShots(a, withBall);
  assert.equal(r2.metrics.ball_speed_mps.status, 'a_null');
  assert.equal(r2.metrics.ball_speed_mps.delta, null);
  assert.equal(compareShots(withBall, a).metrics.ball_speed_mps.status, 'b_null');

  const onlyB = withMetric(b, 'carry_m', 100, { sigma: 5, unit: 'm' });
  assert.equal(compareShots(a, onlyB).metrics.carry_m.status, 'missing_a');
  assert.equal(compareShots(onlyB, a).metrics.carry_m.status, 'missing_b');

  const odd = withMetric(withMetric(a, 'carry_m', 100, { sigma: 5, unit: 'm' }), 'x_custom_metric', 1, { sigma: 1 });
  const odd2 = withMetric(b, 'carry_m', 100, { sigma: 5, unit: 'yd' });
  const r3 = compareShots(odd, odd2);
  assert.equal(r3.metrics.carry_m.status, 'unit_mismatch');
  assert.equal(r3.metrics.carry_m.delta, null);
  assert.equal(Object.keys(r3.metrics).at(-1), 'x_custom_metric', 'ids unknown to the list follow');
});

test('significance uses sigma, or the ci95 half width when there is no sigma; none when uncertainty is missing', () => {
  const base = makeShot({ id: 'a' });
  // sigma derived from ci95: [2.9, 3.1] -> sigma = 0.2 / (2 * 1.959964)
  const a = withMetric(base, 'tempo_ratio', 3.0, { ci95: [2.9, 3.1] });
  const b = withMetric(makeShot({ id: 'b' }), 'tempo_ratio', 3.05, { ci95: [2.95, 3.15] });
  const r = compareShots(a, b).metrics.tempo_ratio;
  const s = 0.2 / (2 * 1.959964);
  near(r.delta_ci95[1] - r.delta, 1.959964 * Math.hypot(s, s), 1e-9);
  assert.equal(r.significant, false); // 0.05 within +-0.14
  // no uncertainty on one side: delta only
  const c = withMetric(makeShot({ id: 'c' }), 'tempo_ratio', 3.5);
  const r2 = compareShots(a, c).metrics.tempo_ratio;
  near(r2.delta, 0.5, 1e-12);
  assert.equal(r2.delta_ci95, null);
  assert.equal(r2.significant, null);
  // clearly separated
  const d = withMetric(makeShot({ id: 'd' }), 'tempo_ratio', 2.0, { sigma: 0.01 });
  const e = withMetric(makeShot({ id: 'e' }), 'tempo_ratio', 4.0, { sigma: 0.01 });
  assert.equal(compareShots(d, e).metrics.tempo_ratio.significant, true);
  assert.equal(compareShots(e, d).metrics.tempo_ratio.significant, true);
  assert.equal(compareShots(e, d).metrics.tempo_ratio.delta, -2);
});

test('compareShots does not modify its inputs', () => {
  const a = makeShot({ id: 'a' });
  const b = makeShot({ id: 'b', preset_id: 'preset-B' });
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  const r = compareShots(a, b);
  r.metrics.tempo_ratio.a.reason_codes.push('mutated');
  assert.equal(JSON.stringify(a), sa);
  assert.equal(JSON.stringify(b), sb);
});

// ------------------------------------------------------------------------------------------------- sets

const mk = (id, preset, tempo, over = {}) => withMetric(makeShot({ id, preset_id: preset, ...over }), 'tempo_ratio', tempo, { sigma: 0.05 });

test('compareSets: means, Welch interval and significance (hand-computed case)', () => {
  const A = [10, 12, 11, 13].map((v, i) => mk(`a${i}`, 'preset-A', v));
  const B = [14, 15, 16, 17].map((v, i) => mk(`b${i}`, 'preset-A', v));
  const r = compareSets(A, B);
  assert.equal(r.kind, 'sets');
  assert.deepEqual(r.warnings, []);
  assert.equal(r.like_for_like, true);
  const t = r.metrics.tempo_ratio;
  assert.equal(t.status, 'compared');
  assert.deepEqual([t.a.n, t.b.n], [4, 4]);
  near(t.a.mean, 11.5, 1e-12);
  near(t.b.mean, 15.5, 1e-12);
  near(t.a.sd, Math.sqrt(5 / 3), 1e-12);
  near(t.a.median, 11.5, 1e-12);
  near(t.delta, 4, 1e-12);
  // se = sqrt(5/12 + 5/12) = 0.912871, df = 6 -> t = 2.447
  near(t.delta_ci95[0], 4 - 2.447 * Math.sqrt(5 / 6), 1e-9);
  near(t.delta_ci95[1], 4 + 2.447 * Math.sqrt(5 / 6), 1e-9);
  assert.equal(t.significant, true);
  // overlapping sets are not significant
  const C = [11, 13, 12, 14].map((v, i) => mk(`c${i}`, 'preset-A', v));
  assert.equal(compareSets(A, C).metrics.tempo_ratio.significant, false);
  near(tCritical95(6), 2.447, 1e-12);
  assert.equal(tCritical95(1), 12.706);
  assert.ok(tCritical95(31) >= 2.0399 && tCritical95(1000) > 1.95);
});

test('compareSets across presets: PRESET_MISMATCH, in every arrangement that is not "one and the same preset"', () => {
  const A1 = [mk('a1', 'preset-A', 3), mk('a2', 'preset-A', 3.1)];
  const B1 = [mk('b1', 'preset-B', 3.2, { view: 'dtl' }), mk('b2', 'preset-B', 3.3, { view: 'dtl' })];
  const r = compareSets(A1, B1);
  assert.ok(r.warnings.includes(RC.PRESET_MISMATCH));
  assert.ok(r.notes.some((n) => n.kind === 'view_mismatch'));
  // mixed presets inside one set, even if the other set is one of them
  const mixed = [mk('m1', 'preset-A', 3), mk('m2', 'preset-B', 3.1)];
  const r2 = compareSets(mixed, A1);
  assert.ok(r2.warnings.includes(RC.PRESET_MISMATCH));
  assert.ok(r2.notes.some((n) => n.kind === 'mixed_presets'));
  assert.ok(compareSets(mixed, mixed).warnings.includes(RC.PRESET_MISMATCH));
  // missing preset ids
  const none = [{ ...mk('n1', 'x', 3), preset_id: null }];
  assert.ok(compareSets(none, none).warnings.includes(RC.PRESET_MISMATCH));
  // same single preset: clean
  const r3 = compareSets(A1, [mk('a3', 'preset-A', 3.4)]);
  assert.deepEqual(r3.warnings, []);
  // 200 random pairs of single-preset sets
  const rng = mulberry32(5);
  const ids = ['p1', 'p2', 'p3'];
  for (let i = 0; i < 200; i++) {
    const pa = ids[Math.floor(rng() * 3)];
    const pb = ids[Math.floor(rng() * 3)];
    const r4 = compareSets([mk('x', pa, 3), mk('y', pa, 3.2)], [mk('z', pb, 3.1)]);
    assert.equal(r4.warnings.includes(RC.PRESET_MISMATCH), pa !== pb);
  }
});

test('compareSets: mixed views/clubs, empty sets, one-shot sets, null handling', () => {
  const A = [mk('a1', 'preset-A', 3), mk('a2', 'preset-A', 3.1, { club_type: 'driver' })];
  const r = compareSets(A, [mk('b1', 'preset-A', 3.2)]);
  assert.ok(r.notes.some((n) => n.kind === 'mixed_clubs'));
  assert.ok(r.notes.some((n) => n.kind === 'small_sample'), 'one-shot side: no interval');
  assert.equal(r.metrics.tempo_ratio.delta_ci95, null);
  assert.equal(r.metrics.tempo_ratio.significant, null);
  near(r.metrics.tempo_ratio.delta, 3.2 - 3.05, 1e-12);
  assert.equal(r.metrics.tempo_ratio.b.sd, null);

  const e = compareSets([], A);
  assert.deepEqual(e.metrics, {});
  assert.ok(e.notes.some((n) => n.kind === 'empty_set' && n.params.side === 'A'));
  for (const n of [...e.notes, ...r.notes]) assert.ok(!hasChinese(JSON.stringify(n)), JSON.stringify(n));
  assert.equal(e.like_for_like, false);
  assert.equal(compareSets([], []).notes[0].kind, 'empty_set');

  // null values count as n_null and never enter the mean
  const withNull = mk('c1', 'preset-A', 3);
  withNull.metrics.tempo_ratio = { ...withNull.metrics.tempo_ratio, value: null, ci95: null, sigma: null, validity: 'dropped', reason_codes: [RC.EVENTS_UNCERTAIN] };
  const r2 = compareSets([withNull, mk('c2', 'preset-A', 3.4)], [mk('d1', 'preset-A', 3.0), mk('d2', 'preset-A', 3.2)]);
  assert.equal(r2.metrics.tempo_ratio.a.n, 1);
  assert.equal(r2.metrics.tempo_ratio.a.n_null, 1);
  near(r2.metrics.tempo_ratio.a.mean, 3.4, 1e-12);
  // a metric that one side never produced
  const r3 = compareSets([mk('e1', 'preset-A', 3)], [{ ...mk('f1', 'preset-A', 3), metrics: {} }]);
  assert.equal(r3.metrics.tempo_ratio.status, 'b_empty');
  assert.equal(r3.metrics.tempo_ratio.delta, null);
  // identical constant values: zero standard error handled
  const same = compareSets([mk('g1', 'preset-A', 3), mk('g2', 'preset-A', 3)], [mk('h1', 'preset-A', 3), mk('h2', 'preset-A', 3)]);
  assert.equal(same.metrics.tempo_ratio.significant, false);
  const shifted = compareSets([mk('g1', 'preset-A', 3), mk('g2', 'preset-A', 3)], [mk('h1', 'preset-A', 4), mk('h2', 'preset-A', 4)]);
  assert.equal(shifted.metrics.tempo_ratio.significant, true);
});

test('compareSets works on larger sets of the fixture shots', () => {
  const rng = mulberry32(3);
  const A = Array.from({ length: 30 }, (_, i) => makeShot({ id: `a${i}`, seed: i + 1 }));
  const B = Array.from({ length: 25 }, (_, i) => makeShot({ id: `b${i}`, seed: i + 100 }));
  const r = compareSets(A, B);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual([r.a.n, r.b.n], [30, 25]);
  // all fixture metrics come from the same distribution: the interval should cover 0
  const t = r.metrics.tempo_ratio;
  assert.ok(t.delta_ci95[0] < 0 && t.delta_ci95[1] > 0, `${t.delta_ci95}`);
  assert.ok(rng() >= 0);
});

test('diffSummary: significant differences first, codes only', async () => {
  const { diffSummary } = await import('../../app/src/store/compare.js');
  const A = [mk('a1', 'preset-A', 3.0), mk('a2', 'preset-A', 3.02), mk('a3', 'preset-A', 2.98)];
  const B = [mk('b1', 'preset-A', 2.5), mk('b2', 'preset-A', 2.52), mk('b3', 'preset-A', 2.48)];
  const rows = diffSummary(compareSets(A, B));
  assert.ok(rows.length > 0);
  const tempo = rows.find((x) => x.id === 'tempo_ratio');
  assert.equal(tempo.direction, 'lower');
  assert.equal(tempo.significant, true);
  near(tempo.delta, -0.5, 1e-9);
  const firstNonSig = rows.findIndex((x) => !x.significant);
  const lastSig = rows.map((x) => Boolean(x.significant)).lastIndexOf(true);
  assert.ok(firstNonSig === -1 || lastSig < firstNonSig, 'significant rows come first');
  for (const x of rows) assert.ok(!hasChinese(JSON.stringify(x)));
  assert.deepEqual(diffSummary(null), []);
});

// ------------------------------------------------------------------ LM-F (LAUNCH-MONITOR-SPEC §3.7, §5.2 acceptance 2)
import { compareSessions } from '../../app/src/store/stats.js';
import { gauss } from '../../app/src/geom/rng.js';

/** n shots, carry ~ N(mu, sd) (seeded), carry sigma 3 m, one preset / view / club, algorithms.lm.version = lm. */
function carrySet(prefix, n, mu, { sd = 3, lm = 'lm-1', preset = 'preset-A', seed = 1 } = {}) {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, (_, i) => {
    const s = makeShot({ id: `${prefix}${i}`, seed: seed * 100 + i, preset_id: preset });
    const c = { value: mu + gauss(rng, 0, sd), unit: 'm', ci95: null, sigma: 3, validity: 'estimated', value_origin: 'ballistics', measured: false, reason_codes: [] };
    return { ...s, schema: 'golf-shot/2', algorithms: { lm: { version: lm, sha256: 'x' } }, metrics: { ...s.metrics, carry_m: c } };
  });
}

test('compareSessions: different algorithms.lm versions → note model_mismatch and every significant false', () => {
  const A = carrySet('a', 20, 150, { lm: 'lm-1', seed: 1 });
  const B = carrySet('b', 20, 160, { lm: 'lm-2', seed: 2 });
  const r = compareSessions(A, B, ['carry_m', 'tempo_ratio', 'club_speed_mps']);
  assert.ok(r.notes.some((n) => n.kind === 'model_mismatch'), JSON.stringify(r.notes));
  assert.equal(r.like_for_like, false);
  assert.deepEqual(Object.keys(r.metrics).sort(), ['carry_m', 'club_speed_mps', 'tempo_ratio']);
  for (const m of Object.values(r.metrics)) assert.equal(m.significant, false, m.id);
  assert.equal(r.metrics.carry_m.ci_excludes_zero, true, 'the raw interval still excludes 0; only the verdict is withheld');
  // compareSets carries the same note
  assert.ok(compareSets(A, B).notes.some((n) => n.kind === 'model_mismatch'));
});

test('compareSessions: same version and preset, 10 m apart, n = 20, σ = 3 m → significant', () => {
  const A = carrySet('a', 20, 150, { seed: 3 });
  const B = carrySet('b', 20, 160, { seed: 4 });
  const r = compareSessions(A, B, ['carry_m']);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.notes, []);
  assert.equal(r.like_for_like, true);
  const m = r.metrics.carry_m;
  assert.equal(m.significant, true);
  assert.ok(m.delta > 7 && m.delta < 13, `${m.delta}`);
  assert.ok(m.delta_ci95[0] > 0);
});

test('compareSessions: n < 5 → small_sample note, not significant; different presets → PRESET_MISMATCH, not significant', () => {
  const r = compareSessions(carrySet('a', 4, 150, { seed: 5 }), carrySet('b', 4, 170, { seed: 6 }), ['carry_m']);
  assert.ok(r.notes.some((n) => n.kind === 'small_sample' && n.params.min === 5));
  assert.equal(r.metrics.carry_m.significant, false);
  const p = compareSessions(carrySet('a', 20, 150, { seed: 7 }), carrySet('b', 20, 170, { preset: 'preset-B', seed: 8 }), ['carry_m']);
  assert.ok(p.warnings.includes(RC.PRESET_MISMATCH));
  assert.equal(p.metrics.carry_m.significant, false);
  // v1 shots (no algorithms.lm) on both sides: no model note
  assert.ok(!compareSets([makeShot({ id: 'x' })], [makeShot({ id: 'y' })]).notes.some((n) => n.kind === 'model_mismatch'));
});
