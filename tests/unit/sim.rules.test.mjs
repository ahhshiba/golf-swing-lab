// V04-SPEC §G.3 V4-C acceptance 4: lie factors, OB (both rules), water, tree collision (flight.samples and the
// parametric path), slope intersection, max score, auto putting (monotone expected putts, ≥ 0.95 one-putt at 0.5 m,
// at most 4 putts), auto chip. Table cases on a hand-built flat test hole.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lieFactors, rollFraction } from '../../app/src/sim/lies.js';
import { resolveStroke, samplesToPath, parametricPath, slopeLanding, firstTreeHit, slopeCarry } from '../../app/src/sim/rules.js';
import { newRound, playStroke, scorecard, replayRound, ballOf } from '../../app/src/sim/round.js';
import { autoPutt, autoChip, manualPutts, puttProbability, expectedPutts } from '../../app/src/sim/putting.js';
import { SIM_PARAMS } from '../../app/src/sim/params.js';
import { validateRound } from '../../app/src/contract/round.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { mulberry32 } from '../../app/src/geom/rng.js';

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const circle = (cx, cy, r) => Array.from({ length: 12 }, (_, i) => [cx + r * Math.cos((i * Math.PI) / 6), cy + r * Math.sin((i * Math.PI) / 6)]);
/** Flat par 4: fairway x ±15 (y 60–360), water x −40…−20 (y 150–250), bunker right, a tree at (0, 175), green r 12 at the pin. */
function testHole(n = 1, { greenZ = 0, trees = [[0, 175, 4, 15]] } = {}) {
  return {
    n, par: 4, style: 'parkland', template: null, length_m: 380,
    tees: { forward: [0, 57, 0], middle: [0, 0, 0], back: [0, -45.6, 0] },
    pin: [0, 380], green: { poly: circle(0, 380, 12), z: greenZ, slope_pct: 1.5 },
    fairway: [rect(-15, 60, 15, 360)], bunkers: [rect(16, 200, 26, 215)], water: [rect(-40, 150, -20, 250)],
    trees, bounds: rect(-40, -60, 40, 420), centerline: [[0, 0], [0, 190], [0, 380]], elevation: { tee_z: 0, green_z: greenZ },
  };
}
const course = (opts) => ({ generator: 'course-1', style: 'parkland', seed: 1, holes_n: 9, tees: 'middle', holes: Array.from({ length: 9 }, (_, i) => testHole(i + 1, opts)) });
const R = (h, from, aim, carry, side, club = '7i', extra = {}) => resolveStroke(h, { from, aim, draw: { carry_m: carry, side_m: side }, club, source: 'manual', handedness: 'right', rules: { ob: 'drop_2' }, style: 'parkland', ...extra });
const manual = (club, carry, side = 0) => ({
  carry: { value: carry, ci95: null, sigma: null, validity: 'estimated', origin: 'manual', reason_codes: [RC.MANUAL_ENTRY] },
  side: { value: side, ci95: null, sigma: null, validity: 'estimated', origin: 'manual', reason_codes: [RC.MANUAL_ENTRY] },
  draw: { seed: 0, carry_m: carry, side_m: side }, source: 'manual', shot_id: null, ellipse: { sx: 0, sy: 0 }, club,
});
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

test('lie factors (§C.3 table)', () => {
  const rows = [
    ['tee', '7i', 1, 1], ['fairway', 'driver', 1, 1], ['rough', '7i', 0.9, 1.3], ['rough', 'driver', 0.85, 1.3], ['rough', '3w', 0.85, 1.3],
    ['bunker', '7i', 0.85, 1.5], ['bunker', '3w', 0.7, 1.5], ['green', 'putter', 1, 1],
  ];
  for (const [lie, club, c, s] of rows) {
    const f = lieFactors(lie, club);
    assert.ok(near(f.carry, c, 1e-9) && near(f.sigma, s, 1e-9), `${lie} ${club}`);
    assert.equal(f.adjusted, c !== 1 || s !== 1);
  }
  const d = lieFactors('rough', '7i', 'desert');
  assert.ok(d.carry < 0.9 && d.sigma > 1.3, 'desert waste ground is heavier');
  assert.equal(rollFraction('7i', 'bunker'), 0);
  assert.ok(near(rollFraction('7i', 'rough'), 0.35 * rollFraction('7i', 'fairway'), 1e-12));
  assert.ok(rollFraction('7i', 'fairway', 'links') > rollFraction('7i', 'fairway', 'parkland'), 'links fairways are firm');
});

test('fairway shot: lands at carry, rolls rollFrac × carry on 0.5 m steps; side + = right for a right-hander, left for a left-hander', () => {
  const h = testHole();
  const r = R(h, { x: -10, y: 40, lie: 'tee' }, { x: -10, y: 380 }, 100, 0);
  assert.deepEqual([r.landing.x, r.landing.y], [-10, 140]);
  const roll = 100 * rollFraction('7i', 'fairway', 'parkland');
  assert.ok(r.rest.y > 140 && r.rest.y <= 140 + roll + 1e-9 && r.rest.y > 140 + roll - 0.5, String(r.rest.y));
  assert.equal(r.rest.lie, 'fairway');
  assert.equal(r.penalty, 0);
  const rh = R(h, { x: 0, y: 40, lie: 'tee' }, { x: 0, y: 380 }, 60, 5);
  const lh = R(h, { x: 0, y: 40, lie: 'tee' }, { x: 0, y: 380 }, 60, 5, '7i', { handedness: 'left' });
  assert.equal(rh.landing.x, 5);
  assert.equal(lh.landing.x, -5);
});

test('water: +1, dropped 2 m behind the entry point along the incoming line', () => {
  const r = R(testHole(), { x: -30, y: 40, lie: 'rough' }, { x: -30, y: 380 }, 150, 0);
  assert.equal(r.event, 'water');
  assert.equal(r.penalty, 1);
  assert.ok(near(r.rest.x, -30) && r.rest.y < 150 - 1.75 && r.rest.y >= 150 - 2.25, JSON.stringify(r.rest));
  assert.equal(r.rest.lie, 'rough');
});

test('OB: drop_2 = +2 at the nearest fairway edge (1 m inside); stroke_distance = +1 from the same spot', () => {
  const h = testHole();
  const from = { x: 10, y: 100, lie: 'fairway' };
  const d2 = R(h, from, { x: 60, y: 100 }, 50, 0, '9i');
  assert.equal(d2.event, 'ob');
  assert.equal(d2.penalty, 2);
  assert.ok(near(d2.rest.x, 14, 0.3) && near(d2.rest.y, 100, 0.01), JSON.stringify(d2.rest));
  assert.equal(d2.rest.lie, 'fairway');
  const sd = R(h, from, { x: 60, y: 100 }, 50, 0, '9i', { rules: { ob: 'stroke_distance' } });
  assert.equal(sd.event, 'ob');
  assert.equal(sd.penalty, 1);
  assert.deepEqual(sd.rest, { x: 10, y: 100, lie: 'fairway' });
  const tee = R(h, { x: 0, y: 0, lie: 'tee' }, { x: 80, y: 60 }, 120, 0, 'driver', { rules: { ob: 'stroke_distance' } });
  assert.deepEqual(tee.rest, { x: 0, y: 0, lie: 'tee' }, 'replaying from the tee keeps the tee lie');
});

test('trees: the parametric path below a tree top inside its circle stops the ball there (no roll); over it flies on', () => {
  const h = testHole();
  const low = R(h, { x: 0, y: 40, lie: 'fairway' }, { x: 0, y: 380 }, 150, 0, 'driver');
  assert.equal(low.event, 'tree');
  assert.ok(Math.hypot(low.rest.x - 0, low.rest.y - 175) < 4, JSON.stringify(low.rest));
  const high = R(h, { x: 0, y: 40, lie: 'fairway' }, { x: 0, y: 380 }, 230, 0, 'sw');
  assert.notEqual(high.event, 'tree');
  // a ball resting under a tree is not stopped by that same tree on the next stroke
  const out = R(h, { x: low.rest.x, y: low.rest.y, lie: low.rest.lie }, { x: 0, y: 380 }, 100, 0, '9i');
  assert.notEqual(out.event, 'tree');
});

test('trees with flight.samples (mat frame → course frame) and slope intersection on sample segments', () => {
  // imported-shot samples [t, down, mat-left, up]: 160 m carry, apex 25 m at 80 m, 6 m left of the line (mat +y = left)
  const samples = Array.from({ length: 33 }, (_, i) => {
    const s = i * 5;
    return [i * 0.2, s, 6 * (s / 160), 25 * (1 - ((s - 80) / 80) ** 2)];
  });
  const from = { x: 0, y: 0 };
  const path = samplesToPath(samples, from, { x: 0, y: 100 }, 0);
  assert.ok(near(path[32][0], -6, 1e-9) && near(path[32][1], 160, 1e-9), 'down → +y, mat left → −x');
  const flat = () => 0;
  const tree = [[-5.6, 150, 3, 12]];
  const hit = firstTreeHit(path, tree, flat);
  assert.ok(hit && hit.tree === tree[0], 'descending ball under 12 m inside the circle hits');
  assert.equal(firstTreeHit(path, [[-3, 80, 3, 20]], flat), null, 'over the top at the apex: no hit');
  // slope: ground rising 0.1 m per m → the ball comes down earlier than on flat ground
  const land = slopeLanding(path, (x, y) => 0.1 * y);
  assert.ok(land && land.y < 160 && land.y > 120, JSON.stringify(land));
  assert.ok(near(land.z, 0.1 * land.y, 1e-9));
  const pz = path.findIndex((p, i) => i > 0 && p[2] - 0.1 * p[1] <= 0 && path[i - 1][2] - 0.1 * path[i - 1][1] > 0);
  assert.ok(land.y >= path[pz - 1][1] && land.y <= path[pz][1]);
  // the parametric path ends exactly at the landing point
  const pp = parametricPath({ x: 0, y: 0 }, { x: 0, y: 100, z: 3 }, 0, 18);
  assert.deepEqual(pp[pp.length - 1], [0, 100, 3]);
});

test('slope without samples: Δcarry = −Δz / tan(landing-angle prior), solved on the hole plane', () => {
  const up = testHole(1, { greenZ: 20, trees: [] });
  const r = R(up, { x: -10, y: 40, lie: 'fairway' }, { x: -10, y: 380 }, 150, 0, '7i');
  const k = 20 / 380 / SIM_PARAMS.land_tan['7i'];
  assert.ok(near(r.landing.y, 40 + 150 / (1 + k), 0.05), String(r.landing.y));
  assert.ok(near(slopeCarry(150, 7.5, 1), 142.5, 1e-9));
  assert.equal(slopeCarry(100, 500, 1), 30, 'clamped to 0.3 × carry');
  const down = R(testHole(1, { greenZ: -20, trees: [] }), { x: -10, y: 40, lie: 'fairway' }, { x: -10, y: 380 }, 150, 0, '7i');
  assert.ok(down.landing.y > 190, 'downhill carries further');
});

test('max score: picked up at 2 × par (scored 2 × par); maxScore none plays on; scorecard derives it; replay matches', () => {
  const players = [{ player_id: 'a', name: 'A' }, { player_id: 'b', name: 'B' }];
  let r = newRound({ round_id: 'max', created_at: '2026-11-07T10:00:00.000Z', app_version: 't', course: course(), settings: { ob: 'stroke_distance' }, players });
  assert.deepEqual(r.current, { hole: 1, player_id: 'a' });
  r = playStroke(r, manual('driver', 150), { x: 200, y: 50 }).round; // a: OB (1 + 1), back on the tee
  assert.deepEqual(r.current, { hole: 1, player_id: 'b' }, 'everyone tees off first');
  r = playStroke(r, manual('driver', 200), { x: 0, y: 380 }).round;
  assert.deepEqual(r.current, { hole: 1, player_id: 'a' }, 'then the ball farthest from the pin');
  for (let i = 0; i < 3; i++) r = playStroke(r, manual('driver', 150), { x: 200, y: 50 }).round; // a: OB ×3 more
  const a1 = ballOf(r, 'a', 1);
  assert.ok(a1.picked_up && a1.score === 8, JSON.stringify(a1));
  assert.equal(r.strokes[r.strokes.length - 1].source, 'pickup');
  assert.deepEqual(r.current, { hole: 1, player_id: 'b' });
  const sc = scorecard(r).players[0].holes[0];
  assert.deepEqual([sc.strokes, sc.penalties, sc.picked_up, sc.putts], [8, 4, true, 0]);
  assert.ok(validateRound(r, { replayRound }).ok, JSON.stringify(validateRound(r, { replayRound }).errors));

  let n = newRound({ round_id: 'none', created_at: '2026-11-07T10:00:00.000Z', app_version: 't', course: course(), settings: { ob: 'stroke_distance', maxScore: 'none' }, players: [players[0]] });
  for (let i = 0; i < 6; i++) n = playStroke(n, manual('driver', 150), { x: 200, y: 50 }).round;
  assert.equal(ballOf(n, 'a', 1).score, 12);
  assert.equal(ballOf(n, 'a', 1).done, false);
});

test('auto putting: one-putt ≥ 0.95 at 0.5 m for every level; expected putts never decrease with distance; ≤ 4 putts; holes out', () => {
  for (const s of [0, 10, 20, 30]) {
    assert.ok(puttProbability(0.5, s) >= 0.95, `level ${s}: ${puttProbability(0.5, s)}`);
    assert.ok(Math.abs(puttProbability(SIM_PARAMS.putt.d50[s], s, 1) - 0.5) < 1e-9, 'd50 is the 50 % distance');
    let prev = 0;
    for (let d = 0.1; d <= 30; d += 0.1) {
      const e = expectedPutts(d, s);
      assert.ok(e >= prev - 1e-12, `level ${s} d ${d.toFixed(1)}: ${e} < ${prev}`);
      assert.ok(e >= 1 && e <= 4);
      prev = e;
    }
    assert.ok(expectedPutts(10, s) > expectedPutts(1, s));
  }
  assert.ok(expectedPutts(6, 30) > expectedPutts(6, 0), 'a weaker level needs more putts');
  // Monte Carlo through the real round path: every hole ends holed, never more than 4 putts, AUTO_PUTT on every stroke
  const counts = [];
  for (let seed = 1; seed <= 300; seed++) {
    let r = newRound({ round_id: `p${seed}`, created_at: '2026-11-07T10:00:00.000Z', app_version: 't', course: course({ trees: [] }), settings: { puttSkill: 30 }, players: [{ player_id: 'a' }] });
    r = playStroke(r, manual('9i', 370 + (seed % 16) * 0.5, (seed % 9) - 4), { x: 0, y: 380 }).round;
    if (ballOf(r, 'a', 1).lie !== 'green') continue;
    const out = autoPutt(r, 'a', mulberry32(seed));
    const b = ballOf(out.round, 'a', 1);
    assert.ok(b.holed && out.strokes.length >= 1 && out.strokes.length <= 4);
    for (const s of out.strokes) assert.ok(s.source === 'auto_putt' && s.carry.reason_codes.includes(RC.AUTO_PUTT) && s.club === 'putter');
    counts.push(out.strokes.length);
    if (seed % 60 === 0) assert.ok(validateRound(out.round, { replayRound }).ok);
  }
  assert.ok(counts.length > 200);
  assert.ok(counts.includes(4) || counts.includes(3), 'long putts sometimes three-putt');
});

test('auto chip only within rules.autoChipM, off the green; ends on the green with AUTO_CHIP; manual putt count', () => {
  const mk = (autoChipM) => newRound({ round_id: 'c', created_at: '2026-11-07T10:00:00.000Z', app_version: 't', course: course({ trees: [] }), settings: { autoChipM }, players: [{ player_id: 'a' }] });
  let r = playStroke(mk(30), manual('9i', 345, 0), { x: 0, y: 380 }).round; // rests ~20 m short, on the fairway
  const b = ballOf(r, 'a', 1);
  assert.ok(b.lie === 'fairway' && b.to_pin_m <= 30, JSON.stringify(b));
  const c = autoChip(r, 'a', mulberry32(9));
  assert.equal(c.stroke.source, 'auto_chip');
  assert.ok(c.stroke.carry.reason_codes.includes(RC.AUTO_CHIP));
  assert.equal(c.stroke.rest.lie, 'green');
  assert.ok(validateRound(c.round, { replayRound }).ok);
  let off = playStroke(mk(0), manual('9i', 345, 0), { x: 0, y: 380 }).round;
  assert.throws(() => autoChip(off, 'a'), (e) => e.code === 'AUTO_CHIP_UNAVAILABLE');
  const m = manualPutts(c.round, 'a', 2);
  assert.equal(m.strokes.length, 2);
  assert.ok(m.strokes.every((s) => s.source === 'manual' && s.shot_id === null && s.carry.reason_codes.includes(RC.MANUAL_ENTRY)));
  assert.ok(ballOf(m.round, 'a', 1).holed);
  assert.equal(scorecard(m.round).players[0].holes[0].putts, 2);
  off = null;
});

test('OB drop_2 never drops onto the green: nearest fairway point whose 1 m-inside drop is fairway; else rough at the exit', async () => {
  // fairway runs right up to the green; the ball leaves the bounds beside the green
  const h = testHole(1, { trees: [] });
  h.fairway = [rect(-15, 60, 15, 375)];
  h.bounds = rect(-40, -60, 40, 420);
  const r = R(h, { x: 0, y: 300, lie: 'fairway' }, { x: 60, y: 385 }, 90, 0, 'pw');
  assert.equal(r.event, 'ob');
  assert.equal(r.penalty, 2);
  assert.equal(r.rest.lie, 'fairway', JSON.stringify(r.rest));
  // no fairway at all → the exit point if rough
  const g = testHole(1, { trees: [] });
  g.fairway = [];
  const n = R(g, { x: 0, y: 100, lie: 'rough' }, { x: 60, y: 100 }, 60, 0, '9i');
  assert.equal(n.rest.lie, 'rough');
  assert.ok(n.rest.x > 39 && n.rest.x <= 40);
  // generated courses: no drop_2 rest is ever on the green
  const { generateCourse } = await import('../../app/src/course/generate.js');
  for (const seed of [1, 2, 3, 4, 5]) {
    for (const hole of generateCourse({ seed, style: 'links', holes: 18, tees: 'middle' }).holes) {
      for (const dx of [-90, 90]) {
        const o = resolveStroke(hole, { from: { x: hole.pin[0], y: hole.pin[1] - 40, lie: 'fairway' }, aim: { x: hole.pin[0] + dx, y: hole.pin[1] }, draw: { carry_m: 120, side_m: 0 }, club: 'pw', source: 'manual', rules: { ob: 'drop_2' }, style: 'links' });
        if (o.event === 'ob') assert.notEqual(o.rest.lie, 'green', `${seed}/${hole.n}`);
      }
    }
  }
});

test('imported flight shape: flightShape(samples) → draw.apex_m / land_deg, used for slope, trees and roll; replayable', async () => {
  const { flightShape, shotOutcome } = await import('../../app/src/sim/engine.js');
  const samples = Array.from({ length: 17 }, (_, i) => { const s = i * 10, k = s <= 88 ? (88 - s) / 88 : (s - 88) / 72; return [i * 0.3, s, 0, 32 * (1 - k * k)]; });
  const sh = flightShape(samples);
  assert.equal(sh.apex_m, 32);
  assert.ok(sh.land_deg > 30 && sh.land_deg < 60, JSON.stringify(sh));
  assert.equal(flightShape(null), null);
  const shot = { shot_id: 's1', capture: { view: 'high_behind' }, flight: { samples },
    metrics: { carry_m: { value: 160, sigma: 9, ci95: null, validity: 'low_confidence', value_origin: 'ballistics', reason_codes: [] }, carry_side_m: { value: 0, sigma: 5, ci95: null, validity: 'low_confidence', value_origin: 'flight_model', reason_codes: [] } } };
  const o = shotOutcome({ input: { kind: 'shot', shot }, club: '7i', player: {}, rows: {}, rules: {}, seed: 5 });
  assert.deepEqual([o.draw.apex_m, o.draw.land_deg], [sh.apex_m, sh.land_deg]);
  const noFlight = shotOutcome({ input: { kind: 'shot', shot: { ...shot, flight: null } }, club: '7i', player: {}, rows: {}, rules: {}, seed: 5 });
  assert.ok(!('apex_m' in noFlight.draw) && !('land_deg' in noFlight.draw));
  // a high apex clears the tree the club-prior path hits; a shallow landing rolls further; uphill landing differs
  const h = testHole();
  const from = { x: 0, y: 40, lie: 'fairway' }, aim = { x: 0, y: 380 };
  const prior = R(h, from, aim, 150, 0, 'driver');
  const high = resolveStroke(h, { from, aim, draw: { carry_m: 150, side_m: 0, apex_m: 45, land_deg: 50 }, club: 'driver', source: 'shot', rules: { ob: 'drop_2' }, style: 'parkland' });
  assert.equal(prior.event, 'tree');
  assert.notEqual(high.event, 'tree');
  const steep = R(h, { x: -10, y: 40, lie: 'fairway' }, { x: -10, y: 380 }, 100, 0, '7i', { draw: { carry_m: 100, side_m: 0, land_deg: 55, apex_m: 20 } });
  const flat = R(h, { x: -10, y: 40, lie: 'fairway' }, { x: -10, y: 380 }, 100, 0, '7i', { draw: { carry_m: 100, side_m: 0, land_deg: 30, apex_m: 20 } });
  assert.ok(flat.rest.y - flat.landing.y > steep.rest.y - steep.landing.y);
  const up = testHole(1, { greenZ: 20, trees: [] });
  const a = R(up, { x: -10, y: 40, lie: 'fairway' }, { x: -10, y: 380 }, 150, 0, '7i', { draw: { carry_m: 150, side_m: 0, land_deg: 30, apex_m: 25 } });
  const b = R(up, { x: -10, y: 40, lie: 'fairway' }, { x: -10, y: 380 }, 150, 0, '7i', { draw: { carry_m: 150, side_m: 0, land_deg: 60, apex_m: 25 } });
  assert.ok(a.landing.y < b.landing.y, 'a shallow descent meets the upslope earlier');
  // stored in the round and replayed exactly (validateRound accepts the extra draw keys)
  let r = newRound({ round_id: 'fs', created_at: '2026-11-07T10:00:00.000Z', app_version: 't', course: course(), settings: {}, players: [{ player_id: 'a' }] });
  const res = playStroke(r, { ...o, club: 'driver' }, aim);
  assert.deepEqual([res.stroke.draw.apex_m, res.stroke.draw.land_deg], [sh.apex_m, sh.land_deg]);
  r = res.round;
  assert.ok(validateRound(r, { replayRound }).ok);
  assert.deepEqual(replayRound(r).strokes[0].rest, res.stroke.rest);
});
