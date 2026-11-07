// V04-SPEC §G.3 V4-C acceptance 6: replayRound re-runs stored strokes to within 0.05 m (in fact exactly) of the stored
// rests; the same seeds and inputs give the same whole round twice. Goldens: tests/fixtures/rounds/v4c/*.json are
// complete rounds played by the scripted bot below through the real engine (regenerate only on purpose:
// UPDATE_GOLDEN=1 node --test tests/unit/sim.replay.test.mjs). The replay path is arithmetic-only (sim/rules.js), so
// these goldens also replay bit-identically in other JS engines; the bot's sampling (Box–Muller) is Node-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCourse } from '../../app/src/course/generate.js';
import { pointAlong } from '../../app/src/course/model.js';
import { newRound, strokeContext, playStroke, scorecard, replayRound } from '../../app/src/sim/round.js';
import { autoPutt, autoChip, manualPutts } from '../../app/src/sim/putting.js';
import { shotOutcome } from '../../app/src/sim/engine.js';
import { recommendClub } from '../../app/src/sim/recommend.js';
import { validateRound, ROUND_MAX_BYTES } from '../../app/src/contract/round.js';
import { mulberry32 } from '../../app/src/geom/rng.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'tests/fixtures/rounds/v4c');

const quickFo = (c) => ({ kind: 'quick', result: { stage: 'provisional', t_impact: 1, carry_source: 'pose', timings_ms: {},
  metrics: { carry_m: { value: c, unit: 'm', ci95: [c * 0.7, c * 1.3], sigma: c * 0.15, validity: 'low_confidence', value_origin: 'flight_model', measured: false, reason_codes: ['PROVISIONAL', 'SMASH_ASSUMED', 'LAUNCH_V_ASSUMED', 'FLIGHT_MODELLED'] } } } });
const quickDtl = () => ({ kind: 'quick', result: { stage: 'provisional', t_impact: 1, carry_source: null, timings_ms: {}, metrics: { carry_m: null } } });
/** Imported-shot flight.samples [t, down, mat-left, up]: apex 0.2 × carry at 55 %, landing at the carry (mat-left = −side). */
const samples = (c, side) => Array.from({ length: 17 }, (_, i) => {
  const s = (c * i) / 16, sa = 0.55 * c, k = s <= sa ? (sa - s) / sa : (s - sa) / (c - sa);
  return [i * 0.3, s, (-side * i) / 16, 0.2 * c * (1 - k * k)];
});
const hbShot = (id, c, side, withFlight) => ({ kind: 'shot', shot: { shot_id: id, capture: { view: 'high_behind' }, flight: withFlight ? { samples: samples(c, side) } : null, metrics: {
  carry_m: { value: c, ci95: [c - 18, c + 18], sigma: 9, validity: 'low_confidence', value_origin: 'ballistics', reason_codes: ['FLIGHT_MODELLED', 'SMASH_ASSUMED'] },
  carry_side_m: { value: side, ci95: [side - 15, side + 15], sigma: 7.5, validity: 'low_confidence', value_origin: 'flight_model', reason_codes: ['DPLANE_MODEL', 'FLIGHT_MODELLED'] } } } });
const gapRows = { '7i': { club: '7i', n: 9, carry: { median: 140, p10: 128, p90: 151 } }, driver: { club: 'driver', n: 6, carry: { median: 205, p10: 185, p90: 222 } } };

/** Scripted player: recommended club, inputs rotate through every source, aims along the centre line. */
function botRound({ id, seed, style, holes, tees = 'middle', players, settings = {}, spray = 1 }) {
  const course = generateCourse({ seed, style, holes, tees });
  let round = newRound({ round_id: id, created_at: '2026-11-07T10:00:00.000Z', app_version: '0.4.0+golden', course, settings, players });
  const kinds = ['quick_fo', 'manual', 'quick_dtl', 'shot', 'manual_noside'];
  for (let guard = 0; round.current && guard < 3000; guard++) {
    const ctx = strokeContext(round);
    const pid = ctx.player.player_id;
    if (ctx.ball.lie === 'green') {
      round = round.rules.putting === 'auto' ? autoPutt(round, pid).round : manualPutts(round, pid, 1 + (ctx.seed % 3)).round;
      continue;
    }
    if (round.rules.autoChipM > 0 && ctx.to_pin_m <= round.rules.autoChipM) { round = autoChip(round, pid).round; continue; }
    const rec = recommendClub({ distance_m: ctx.to_pin_m, lie: ctx.ball.lie, dz_m: ctx.dz_m, player: ctx.player });
    const j = mulberry32(ctx.seed ^ 0x5a5a)();
    const c = Math.round(Math.min(rec.carry.median, ctx.to_pin_m) * (0.88 + 0.24 * j) * 100) / 100;
    const k = kinds[round.strokes.length % kinds.length];
    let input, view = null;
    if (k === 'quick_fo') { input = quickFo(c); view = 'face_on'; }
    else if (k === 'quick_dtl') { input = quickDtl(); view = 'dtl'; }
    else if (k === 'shot') input = hbShot(`shot-${id}-${round.strokes.length}`, c, Math.round((j - 0.5) * 160) / 10, j < 0.6);
    else input = { kind: 'manual', carry_m: c, side_m: k === 'manual' ? Math.round((j - 0.5) * 80 * spray) / 10 : null };
    const rows = { gap: ctx.player.kind === 'owner' ? gapRows[rec.club] ?? null : null, side: null };
    const out = shotOutcome({ input, view, club: rec.club, player: ctx.player, rows, rules: round.rules, rng: mulberry32(ctx.seed), lie: ctx.ball.lie, style: ctx.style });
    let aim = { x: ctx.hole.pin[0], y: ctx.hole.pin[1] };
    if (ctx.to_pin_m > rec.carry.median + 30) {
      let best = 0, bd = Infinity;
      for (let s = 0; s < 640; s += 2) {
        const p = pointAlong(ctx.hole.centerline, s);
        const d = Math.hypot(p.x - ctx.ball.x, p.y - ctx.ball.y);
        if (d < bd) { bd = d; best = s; }
      }
      const p = pointAlong(ctx.hole.centerline, best + rec.carry.median);
      aim = { x: p.x, y: p.y };
    }
    round = playStroke(round, out, aim).round;
  }
  return round;
}

const P2 = [{ player_id: 'p1', name: 'Owner', kind: 'owner', driver_carry_m: 205 }, { player_id: 'p2', name: 'Guest', kind: 'guest', handedness: 'left', driver_carry_m: 230, putt_skill: 10 }];
const CASES = [
  { file: 'links_9_2p_seed42', id: 'golden-links-42', seed: 42, style: 'links', holes: 9, players: P2 },
  { file: 'parkland_18_1p_seed1_stroke_distance', id: 'golden-parkland-1', seed: 1, style: 'parkland', holes: 18, players: [P2[0]], settings: { ob: 'stroke_distance', puttSkill: 30 } },
  { file: 'desert_9_4p_seed987654_center_chip_manualputts', id: 'golden-desert-987654', seed: 987654, style: 'desert', holes: 9, tees: 'back',
    players: [...P2, { player_id: 'p3', name: 'C', kind: 'guest', driver_carry_m: null, putt_skill: 0 }, { player_id: 'p4', name: 'D', kind: 'guest', driver_carry_m: 180, putt_skill: 30 }],
    settings: { unobservedSide: 'center', autoChipM: 20, putting: 'manual' } },
  { file: 'parkland_9_2p_seed2024_spray', id: 'golden-parkland-spray', seed: 2024, style: 'parkland', holes: 9, players: P2, spray: 9 },
  { file: 'mixed_18_2p_seed7_forward', id: 'golden-mixed-7', seed: 7, style: 'mixed', holes: 18, tees: 'forward', players: P2, settings: { maxScore: 'none' } },
];

test('goldens: stored rounds replay exactly (validateRound replay_matches ≤ 0.05 m), finish, and are regenerated identically', () => {
  mkdirSync(DIR, { recursive: true });
  for (const c of CASES) {
    const fresh = botRound(c);
    const path = join(DIR, `${c.file}.json`);
    if (process.env.UPDATE_GOLDEN === '1') writeFileSync(path, `${JSON.stringify(fresh)}\n`);
    const g = JSON.parse(readFileSync(path, 'utf8'));
    assert.deepEqual(JSON.parse(JSON.stringify(fresh)), g, `${c.file}: same seeds + inputs → the same round`);
    assert.equal(JSON.stringify(fresh), JSON.stringify(g));
    assert.equal(g.status, 'finished');
    assert.equal(g.current, null);
    const v = validateRound(g, { replayRound });
    assert.ok(v.ok, `${c.file}: ${JSON.stringify(v.errors.slice(0, 3))}`);
    const re = replayRound(g).strokes;
    re.forEach((x, i) => {
      assert.deepEqual([x.rest.x, x.rest.y, x.rest.lie], [g.strokes[i].rest.x, g.strokes[i].rest.y, g.strokes[i].rest.lie], `${c.file} stroke ${i}`);
      assert.deepEqual([x.penalty, x.event], [g.strokes[i].penalty, g.strokes[i].event]);
      assert.deepEqual([x.from.x, x.from.y, x.from.lie], [g.strokes[i].from.x, g.strokes[i].from.y, g.strokes[i].from.lie]);
    });
    assert.ok(JSON.stringify(g).length <= ROUND_MAX_BYTES);
    const sc = scorecard(g);
    for (const p of sc.players) {
      assert.ok(p.holes.every((h) => h.strokes !== null));
      assert.equal(p.total, p.holes.reduce((a, h) => a + h.strokes, 0));
      assert.equal(p.to_par, p.total - g.course.holes.reduce((a, h) => a + h.par, 0));
      if (g.course.holes_n === 18) assert.equal(p.out + p.in, p.total);
      else assert.equal(p.in, null);
    }
  }
});

test('the goldens exercise every source, penalty and event; sources stay honest', () => {
  const all = CASES.map((c) => JSON.parse(readFileSync(join(DIR, `${c.file}.json`), 'utf8')));
  const strokes = all.flatMap((g) => g.strokes);
  for (const s of ['quick', 'shot', 'manual', 'auto_putt', 'auto_chip']) assert.ok(strokes.some((x) => x.source === s), s);
  for (const e of ['holed', 'tree']) assert.ok(strokes.some((x) => x.event === e), e);
  const shaped = strokes.filter((x) => 'land_deg' in x.draw);
  assert.ok(shaped.length > 0 && shaped.every((x) => x.source === 'shot' && x.draw.apex_m > 0 && x.draw.land_deg >= 10), 'imported flight shape stored');
  assert.ok(strokes.some((x) => x.source === 'shot' && !('land_deg' in x.draw)), 'shots without samples keep the club prior');
  assert.ok(strokes.some((x) => x.from.lie === 'rough') && strokes.some((x) => x.from.lie === 'bunker'), 'played from rough and sand');
  for (const s of strokes) {
    if (s.source === 'manual') assert.equal(s.shot_id, null);
    for (const v of [s.carry, s.side]) assert.notEqual(v.validity, 'valid');
  }
});

test('same seed, same inputs → the same round twice; a tampered draw or rest is caught by replay_matches', () => {
  const c = CASES[0];
  const a = botRound(c), b = botRound(c);
  assert.deepEqual(a, b);
  const t = JSON.parse(JSON.stringify(a));
  const i = t.strokes.findIndex((s) => s.source === 'quick');
  t.strokes[i].draw.carry_m += 1;
  const v = validateRound(t, { replayRound });
  assert.ok(v.errors.some((e) => e.rule === 'replay_matches' && e.path === `strokes.${i}.rest`), JSON.stringify(v.errors.slice(0, 2)));
  const u = JSON.parse(JSON.stringify(a));
  u.strokes[3].rest.x += 0.06;
  assert.ok(validateRound(u, { replayRound }).errors.some((e) => e.rule === 'replay_matches'));
  const w = JSON.parse(JSON.stringify(a));
  w.strokes[3].rest.x += 0.04;
  assert.ok(!validateRound(w, { replayRound }).errors.some((e) => e.rule === 'replay_matches' && e.path === 'strokes.3.rest'), 'within tolerance');
});

test('size: a 4-player 18-hole parkland round of a struggling group fits the 256 KB record limit', () => {
  const players = [0, 1, 2, 3].map((i) => ({ player_id: `p${i}`, name: `P${i}`, kind: 'guest', driver_carry_m: 150, putt_skill: 30 }));
  const r = botRound({ id: 'size', seed: 99, style: 'parkland', holes: 18, players });
  const bytes = JSON.stringify(r).length;
  assert.ok(bytes <= ROUND_MAX_BYTES, `${bytes} B`);
});
