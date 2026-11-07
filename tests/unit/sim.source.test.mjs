// V04-SPEC §G.3 V4-C acceptance 5: §B.1 source table row by row (source × view): validity, origin, reason codes;
// validity never 'valid'; every non-manual number carries ci95 or sigma; unobservedSide 'center' → side = μ;
// manual numbers stay manual (never a golf-shot: MANUAL_FEEDS_GAPPING = false).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shotOutcome } from '../../app/src/sim/engine.js';
import { priorCarry, sidePrior, referenceCarry } from '../../app/src/sim/source.js';
import { MANUAL_FEEDS_GAPPING } from '../../app/src/sim/settings.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { REFERENCE_CARRY_M } from '../../app/src/practice/drills.js';
import { mulberry32 } from '../../app/src/geom/rng.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const shot = (name) => JSON.parse(readFileSync(join(ROOT, `tests/fixtures/shots/v2/${name}.json`), 'utf8'));
const owner = { player_id: 'p1', kind: 'owner', handedness: 'right', driver_carry_m: null, putt_skill: 20 };
const guest = { player_id: 'p2', kind: 'guest', handedness: 'right', driver_carry_m: 220, putt_skill: 20 };
const gapRow = (club, median, n = 12) => ({ club, n, carry: { n, median, p10: median - 12, p90: median + 12 } });
const sideRow = (mean, sd, n = 14, indistinguishable = false) => ({ n, mean, sd_est: sd, indistinguishable });
const quick = (value, sigma, codes = ['SMASH_ASSUMED', 'LAUNCH_V_ASSUMED', 'FLIGHT_MODELLED'], carry_source = 'pose') => ({
  kind: 'quick', result: { stage: 'provisional', t_impact: 1, carry_source, timings_ms: {},
    metrics: { carry_m: value === null ? null : { value, unit: 'm', ci95: [value - 1.96 * sigma, value + 1.96 * sigma], sigma, validity: 'low_confidence', value_origin: 'flight_model', measured: false, reason_codes: ['PROVISIONAL', ...codes] } } },
});
const run = (o) => shotOutcome({ rules: { unobservedSide: 'sample' }, rows: { gap: null, side: null }, player: owner, rng: mulberry32(1), ...o });
const honest = (o) => {
  for (const v of [o.carry, o.side]) {
    assert.notEqual(v.validity, 'valid');
    if (v.origin !== 'manual') assert.ok(v.ci95 !== null || v.sigma !== null, 'non-manual needs ci95 or sigma');
    else assert.ok(v.reason_codes.includes(RC.MANUAL_ENTRY));
  }
  assert.equal(o.draw.carry_m, o.carry.value);
};
const has = (v, ...codes) => codes.every((c) => v.reason_codes.includes(c));

test('imported 240 fps face_on: carry from the shot (estimated); side not observable → sampled (LAUNCH_DIR_UNOBSERVABLE + SIDE_SAMPLED)', () => {
  const s = shot('valid_face_on_240');
  const o = run({ input: { kind: 'shot', shot: s }, club: 'driver' });
  honest(o);
  assert.equal(o.source, 'shot');
  assert.equal(o.shot_id, s.shot_id);
  assert.equal(o.carry.value, s.metrics.carry_m.value);
  assert.equal(o.carry.validity, 'estimated');
  assert.equal(o.carry.origin, s.metrics.carry_m.value_origin);
  assert.deepEqual(o.carry.ci95, s.metrics.carry_m.ci95);
  assert.ok(has(o.side, RC.LAUNCH_DIR_UNOBSERVABLE, RC.SIDE_SAMPLED));
  assert.equal(o.side.validity, 'low_confidence');
  assert.equal(o.side.origin, 'prior');
  assert.equal(o.draw.side_m, o.side.value);
});

test('imported 240 fps high_behind: carry (low) and side carry_side_m (low) keep their metric codes', () => {
  const s = shot('valid_high_behind_240');
  const o = run({ input: { kind: 'shot', shot: s }, club: '7i' });
  honest(o);
  assert.equal(o.carry.validity, 'low_confidence');
  assert.equal(o.side.value, s.metrics.carry_side_m.value);
  assert.equal(o.side.validity, 'low_confidence');
  assert.deepEqual(o.side.reason_codes, s.metrics.carry_side_m.reason_codes);
  assert.ok(!o.side.reason_codes.includes(RC.SIDE_SAMPLED));
});

test('quick face_on: pose carry merged with the own gapping prior by inverse variance (GAPPING_PRIOR); without a prior unmerged; PROVISIONAL', () => {
  const o = run({ input: quick(170, 30), view: 'face_on', club: '7i', rows: { gap: gapRow('7i', 140), side: null } });
  honest(o);
  assert.ok(has(o.carry, RC.PROVISIONAL, RC.SMASH_ASSUMED, RC.LAUNCH_V_ASSUMED, RC.FLIGHT_MODELLED, RC.GAPPING_PRIOR));
  assert.equal(o.carry.validity, 'low_confidence');
  assert.ok(o.carry.value > 140 && o.carry.value < 170);
  const sg = 24 / (2 * 1.2815515655446004);
  const want = (170 / 900 + 140 / (sg * sg)) / (1 / 900 + 1 / (sg * sg));
  assert.ok(Math.abs(o.carry.value - want) < 0.01);
  assert.ok(o.carry.sigma < sg && o.carry.sigma < 30);
  assert.ok(Math.abs(o.merge.pose.w + o.merge.gap.w - 1) < 1e-12);
  assert.ok(has(o.side, RC.LAUNCH_DIR_UNOBSERVABLE, RC.SIDE_SAMPLED));
  const solo = run({ input: quick(170, 30), view: 'face_on', club: '7i' });
  assert.equal(solo.carry.value, 170);
  assert.ok(has(solo.carry, RC.PROVISIONAL) && !has(solo.carry, RC.GAPPING_PRIOR));
  assert.equal(solo.merge, null);
  // V4-B already used the prior (carry_source gapping): not merged twice
  const pre = run({ input: quick(150, 20, ['GAPPING_PRIOR'], 'gapping'), view: 'face_on', club: '7i', rows: { gap: gapRow('7i', 140), side: null } });
  assert.equal(pre.carry.value, 150);
  assert.equal(pre.merge, null);
});

test('quick dtl / high_behind: carry = gapping median (GAPPING_PRIOR) or the reference scaled to the driver carry (REFERENCE_PRIOR); side sampled', () => {
  for (const view of ['dtl', 'high_behind']) {
    const g = run({ input: quick(null), view, club: '9i', rows: { gap: gapRow('9i', 118), side: null } });
    honest(g);
    assert.equal(g.carry.value, 118);
    assert.equal(g.carry.origin, 'prior');
    assert.equal(g.carry.validity, 'low_confidence');
    assert.ok(has(g.carry, RC.GAPPING_PRIOR));
    assert.ok(has(g.side, RC.SIDE_SAMPLED) && !g.side.reason_codes.includes(RC.LAUNCH_DIR_UNOBSERVABLE));
    const r = run({ input: quick(null), view, club: '9i', player: guest });
    honest(r);
    assert.ok(has(r.carry, RC.REFERENCE_PRIOR));
    assert.ok(Math.abs(r.carry.value - (REFERENCE_CARRY_M['9i'] * 220) / 200) < 0.01);
    assert.ok(Math.abs(r.carry.sigma - 0.12 * r.carry.value) < 0.02);
    const small = run({ input: quick(null), view, club: '9i', rows: { gap: gapRow('9i', 118, 3), side: null } });
    assert.ok(has(small.carry, RC.REFERENCE_PRIOR), 'n < 5 → reference');
  }
  // a dtl quick carry is ignored (dtl gives no pose carry; only the prior)
  const d = run({ input: quick(200, 10), view: 'dtl', club: '9i', rows: { gap: gapRow('9i', 118), side: null } });
  assert.equal(d.carry.value, 118);
});

test('manual: carry / side as entered (estimated, ci95 null, MANUAL_ENTRY); empty side → sampled; never lie-adjusted; never a golf-shot', () => {
  const m = run({ input: { kind: 'manual', carry_m: 143.27, side_m: -4 }, club: '7i', lie: 'rough' });
  honest(m);
  assert.deepEqual([m.carry.value, m.carry.ci95, m.carry.sigma, m.carry.validity, m.carry.origin], [143.27, null, null, 'estimated', 'manual']);
  assert.deepEqual(m.side.reason_codes, [RC.MANUAL_ENTRY]);
  assert.equal(m.draw.side_m, -4);
  assert.equal(m.shot_id, null);
  assert.deepEqual(m.ellipse, { sx: 0, sy: 0 });
  const e = run({ input: { kind: 'manual', carry_m: 143, side_m: null }, club: '7i' });
  honest(e);
  assert.equal(e.carry.origin, 'manual');
  assert.ok(has(e.side, RC.SIDE_SAMPLED) && e.side.origin === 'prior' && e.side.sigma > 0);
  assert.ok(e.ellipse.sx > 0 && e.ellipse.sy === 0);
  assert.equal(MANUAL_FEEDS_GAPPING, false);
  assert.throws(() => run({ input: { kind: 'manual', carry_m: -1, side_m: null }, club: '7i' }), RangeError);
  assert.throws(() => run({ input: { kind: 'putt' }, club: '7i' }), TypeError);
});

test("side prior: own high_behind spread (n ≥ 10, distinguishable) else reference 6 % (driver 8 %); 'center' → side = μ", () => {
  assert.deepEqual(sidePrior('7i', 140, sideRow(2.5, 6)), { mu: 2.5, sigma: 6, source: 'gapping' });
  assert.equal(sidePrior('7i', 140, sideRow(2.5, 6, 9)).source, 'reference');
  assert.equal(sidePrior('7i', 140, sideRow(2.5, 6, 20, true)).source, 'reference', 'indistinguishable → reference');
  assert.ok(Math.abs(sidePrior('7i', 140, null).sigma - 8.4) < 1e-9);
  assert.ok(Math.abs(sidePrior('driver', 200, null).sigma - 16) < 1e-9);
  const c = run({ input: quick(null), view: 'dtl', club: '7i', rows: { gap: null, side: sideRow(2.5, 6) }, rules: { unobservedSide: 'center' } });
  honest(c);
  assert.equal(c.side.value, 2.5);
  assert.ok(!c.side.reason_codes.includes(RC.SIDE_SAMPLED) && has(c.side, RC.GAPPING_PRIOR));
  const z = run({ input: quick(null), view: 'dtl', club: '7i', rules: { unobservedSide: 'center' } });
  assert.equal(z.side.value, 0);
  assert.equal(z.draw.side_m, 0);
});

test('sampling: reproducible from draw.seed; mean / spread match the prior; lie widens it (LIE_ADJUSTED)', () => {
  const a = run({ input: quick(null), view: 'dtl', club: '7i', seed: 12345 });
  const b = run({ input: quick(null), view: 'dtl', club: '7i', seed: 12345, rng: mulberry32(999) });
  assert.deepEqual(a.draw, b.draw);
  assert.equal(a.draw.seed, 12345);
  const xs = [];
  const rng = mulberry32(7);
  for (let i = 0; i < 3000; i++) xs.push(run({ input: quick(null), view: 'dtl', club: '7i', rows: { gap: null, side: sideRow(3, 5) }, rng }).draw.side_m);
  const mean = xs.reduce((p, q) => p + q, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((p, q) => p + (q - mean) ** 2, 0) / (xs.length - 1));
  assert.ok(Math.abs(mean - 3) < 0.3 && Math.abs(sd - 5) < 0.3, `${mean} ${sd}`);
  const r = run({ input: quick(null), view: 'dtl', club: '7i', rows: { gap: gapRow('7i', 140), side: null }, lie: 'rough' });
  assert.ok(has(r.carry, RC.LIE_ADJUSTED) && has(r.side, RC.LIE_ADJUSTED));
  assert.equal(r.carry.value, 126);
  assert.ok(r.ellipse.sx > run({ input: quick(null), view: 'dtl', club: '7i', rows: { gap: gapRow('7i', 140), side: null } }).ellipse.sx);
});

test('priors: gapping row n ≥ 5 → median / P10–P90; else reference scaled to driver carry (1σ 12 %)', () => {
  const p = priorCarry('7i', owner, gapRow('7i', 140));
  assert.deepEqual([p.median, p.p10, p.p90, p.source], [140, 128, 152, 'gapping']);
  const r = priorCarry('7i', { driver_carry_m: 180 }, null);
  assert.equal(r.source, 'reference');
  assert.ok(Math.abs(r.median - referenceCarry('7i', { driver_carry_m: 180 })) < 1e-12);
  assert.ok(Math.abs(r.median - (REFERENCE_CARRY_M['7i'] * 180) / 200) < 1e-12);
  assert.equal(priorCarry('7i', owner, gapRow('7i', 140, 4)).small_sample, true);
});

test('unmeasured club: the simulated prior carry equals what recommendClub showed (scaled reference, REFERENCE_PRIOR, 12 %)', async () => {
  const { recommendClub } = await import('../../app/src/sim/recommend.js');
  const { gapping } = await import('../../app/src/store/stats.js');
  const mk = (club, c) => Array.from({ length: 8 }, (_, i) => ({ capture: { view: 'face_on' }, club: { type: club }, metrics: { carry_m: { value: c + (i - 3.5) * 2, sigma: 8 }, total_m: { value: c + 8, sigma: 9 } } }));
  const table = gapping([...mk('driver', 170), ...mk('7i', 115), ...mk('pw', 85)]);
  const short = { ...owner, gapping: table };
  for (const [d, lie] of [[150, 'fairway'], [100, 'fairway'], [180, 'tee']]) {
    const rec = recommendClub({ distance_m: d, lie, dz_m: 0, player: short });
    const o = run({ input: quick(null), view: 'dtl', club: rec.club, player: short, lie, rows: { gap: table.find((r) => r.club === rec.club) ?? null, side: null } });
    honest(o);
    assert.ok(Math.abs(o.carry.value - rec.carry.median) <= 0.05, `${rec.club}: sim ${o.carry.value} vs recommended ${rec.carry.median}`);
    if (rec.scaled) {
      assert.ok(has(o.carry, RC.REFERENCE_PRIOR) && o.carry.validity === 'low_confidence');
      assert.ok(Math.abs(o.carry.sigma - 0.12 * o.carry.value) < 0.02);
    }
  }
  // rows.gapping works the same as player.gapping; without any table the plain reference is unchanged
  const viaRows = run({ input: quick(null), view: 'dtl', club: '9i', rows: { gap: null, side: null, gapping: table } });
  const viaPlayer = run({ input: quick(null), view: 'dtl', club: '9i', player: short });
  assert.equal(viaRows.carry.value, viaPlayer.carry.value);
  assert.ok(viaRows.carry.value < REFERENCE_CARRY_M['9i'], 'scaled down for a short hitter');
  assert.equal(run({ input: quick(null), view: 'dtl', club: '9i' }).carry.value, REFERENCE_CARRY_M['9i']);
});
