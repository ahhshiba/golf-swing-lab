#!/usr/bin/env node
// scripts/make_v4_fixtures.mjs — V04-SPEC §F.8 fixtures of V4-A drop 1 (deterministic: fixed seeds, no clock).
//
//   node scripts/make_v4_fixtures.mjs [--check]
//
// Writes
//   tests/fixtures/rounds/valid_9_links_2p.json            9 holes, links, 2 players, active (hole 1 done, hole 2 started)
//   tests/fixtures/rounds/valid_18_parkland_1p_finished.json  18 holes (par 72), 1 player, finished, one water penalty
//   tests/fixtures/rounds/valid_manual_only.json            9 holes, 1 player, only manual strokes (MANUAL_ENTRY)
//   tests/fixtures/rounds/bad_<rule>.json                   valid_9_links_2p with one rule broken; `_expect` = rule name
//   tests/fixtures/v4/shot_v2_club_px.json                  valid_face_on_240 + tracks.club_px (golf-shot/2 rev 2)
//   tests/fixtures/v4/bad_shot_tracks_club_frame_increasing.json   the same with a club_px frame going backwards
// Hole geometry is hand-built (straight holes along +y, a simple dogleg on par 5s), NOT course/generate.js output, and
// stroke rest positions are straight-line arithmetic (no roll): they are contract fixtures, not a replay golden — the
// replay_matches rule is only exercised with an injected replayRound in the unit test. Every file is checked with
// contract/round.js (or contract/validate.js for shots) before it is written; --check verifies the files on disk equal
// what would be written (exit 1 if not).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mulberry32 } from '../app/src/geom/rng.js';
import { validateRound } from '../app/src/contract/round.js';
import { validateShot } from '../app/src/contract/validate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUNDS = 'tests/fixtures/rounds';
const V4 = 'tests/fixtures/v4';
const q = (x) => Math.round(x * 10) / 10; // 0.1 m quantisation (V04-SPEC §C.1)
const q2 = (x) => Math.round(x * 100) / 100;

const circle = (cx, cy, r, n = 12) => Array.from({ length: n }, (_, i) => {
  const a = (2 * Math.PI * i) / n;
  return [q(cx + r * Math.cos(a)), q(cy + r * Math.sin(a))];
});
const rect = (x0, y0, x1, y1) => [[q(x0), q(y0)], [q(x1), q(y0)], [q(x1), q(y1)], [q(x0), q(y1)]];

/** One hand-built hole: tee (middle) at the origin, pin straight up the y axis (par 5: dogleg right). */
function makeHole(n, par, style, len) {
  const dog = par === 5 ? 40 : 0;
  const pin = [q(dog), q(len)];
  const fairway = par === 3 ? [] : [[[q(-15), q(Math.min(150, len - 60))], [q(15), q(Math.min(150, len - 60))], [q(15 + dog), q(len - 25)], [q(-15 + dog), q(len - 25)]]];
  const bunkers = [circle(pin[0] + 20, pin[1] - 6, 5, 8)];
  if (style === 'links') bunkers.push(circle(-18, Math.min(230, len - 80), 6, 8));
  const water = style === 'desert' || par === 3 ? [rect(-30, len * 0.45, 30, len * 0.45 + 15)] : [];
  const trees = style === 'parkland' ? Array.from({ length: 8 }, (_, i) => [q(i % 2 ? 32 : -32), q(40 + i * (len - 80) / 8), 4, 12]) : [];
  return {
    n, par, style, template: `${style}-p${par}-a`, length_m: len,
    tees: { forward: [0, q(len * 0.15), 0], middle: [0, 0, 0], back: [0, q(-len * 0.12), 0] },
    pin,
    green: { poly: circle(pin[0], pin[1], 14), z: 1.5, slope_pct: 1.5 },
    fairway, bunkers, water, trees,
    bounds: rect(-60, -70, 60 + dog, len + 40),
    centerline: [[0, 0], [q(dog / 2), q(len * 0.6)], pin],
    elevation: { tee_z: 0, green_z: 1.5 },
  };
}

const PARS_18 = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 5, 4]; // 4 × par 3, 10 × par 4, 4 × par 5 = 72
const PARS_9 = [4, 4, 3, 5, 4, 4, 3, 4, 5]; // 2 / 5 / 2
const LEN = { 3: 155, 4: 360, 5: 480 };

function course({ style, seed, holes }) {
  const pars = holes === 18 ? PARS_18 : PARS_9;
  return { generator: 'course-1', style, seed, holes_n: holes, tees: 'middle', holes: pars.map((p, i) => makeHole(i + 1, p, style, LEN[p] + (i % 3) * 10)) };
}

const val = (value, { sigma = null, ci95 = null, validity = 'low_confidence', origin, codes }) => ({ value, ci95, sigma, validity, origin, reason_codes: codes });

/** A stroke from `from` toward the pin: carry along the aim line, side perpendicular (+ = right of the line). */
function stroke(ctx, { player_id, hole, from, club, source, carry, side, shot_id = null, rng }) {
  const h = ctx.holes[hole - 1];
  const dx = h.pin[0] - from.x;
  const dy = h.pin[1] - from.y;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d, uy = dy / d;
  const c = carry.value, s = side.value ?? 0;
  const lx = q2(from.x + ux * c + uy * s), ly = q2(from.y + uy * c - ux * s);
  const remaining = Math.hypot(h.pin[0] - lx, h.pin[1] - ly);
  const lie = remaining <= 12 ? 'green' : 'fairway';
  const n = (ctx.n.get(`${player_id}/${hole}`) ?? 0) + 1;
  ctx.n.set(`${player_id}/${hole}`, n);
  const st = {
    seq: ctx.seq++, player_id, hole, n, from, aim: { x: h.pin[0], y: h.pin[1] }, club, source, shot_id, carry, side,
    draw: { seed: Math.floor(rng() * 0x100000000), carry_m: c, side_m: s },
    landing: { x: lx, y: ly, z: lie === 'green' ? 1.5 : 0 }, rest: { x: lx, y: ly, lie }, penalty: 0, event: null,
  };
  ctx.strokes.push(st);
  return st;
}

/** Auto putts to the hole from the rest of `last` (holed on the last one). */
function putts(ctx, player_id, hole, last, k, rng) {
  const h = ctx.holes[hole - 1];
  let from = { x: last.rest.x, y: last.rest.y, lie: 'green' };
  for (let i = 0; i < k; i++) {
    const d = Math.hypot(h.pin[0] - from.x, h.pin[1] - from.y);
    const holed = i === k - 1;
    const c = holed ? q2(d) : q2(d * 0.9);
    const st = stroke(ctx, {
      player_id, hole, from, club: 'putter', source: 'auto_putt', rng,
      carry: val(c, { sigma: q2(0.08 * d + 0.25), validity: 'estimated', origin: 'sim', codes: ['AUTO_PUTT'] }),
      side: val(0, { sigma: 0.1, validity: 'estimated', origin: 'sim', codes: ['AUTO_PUTT'] }),
    });
    if (holed) { st.rest = { x: h.pin[0], y: h.pin[1], lie: 'green' }; st.landing = { x: h.pin[0], y: h.pin[1], z: 1.5 }; st.event = 'holed'; }
    from = { x: st.rest.x, y: st.rest.y, lie: 'green' };
  }
}

const QUICK_CODES = ['PROVISIONAL', 'SMASH_ASSUMED', 'LAUNCH_V_ASSUMED', 'FLIGHT_MODELLED', 'GAPPING_PRIOR'];
const SIDE_CODES = ['LAUNCH_DIR_UNOBSERVABLE', 'SIDE_SAMPLED'];

function header(id, style, seed, holes, status, players, at) {
  return {
    schema: 'golf-round/1', round_id: id, created_at: at, updated_at: at, app_version: '0.4.0+fixture0000', status,
    course: course({ style, seed, holes }),
    rules: { unobservedSide: 'sample', putting: 'auto', ob: 'drop_2', maxScore: 'double_par', autoChipM: 0, params_version: 'sim-fixture-1' },
    players, strokes: [], current: null,
  };
}
const player = (id, name, kind, carry) => ({ player_id: id, name, handedness: 'right', kind, driver_carry_m: carry, putt_skill: 20 });

function round9links() {
  const rng = mulberry32(42);
  const r = header('round-fx-9-links-2p', 'links', 42, 9, 'active', [player('p1', 'Player 1', 'owner', null), player('p2', 'Guest', 'guest', 210)], '2026-11-07T09:00:00.000Z');
  const ctx = { holes: r.course.holes, n: new Map(), seq: 0, strokes: r.strokes };
  const tee = { x: 0, y: 0, lie: 'tee' };
  // hole 1: p1 face_on quick read (pose carry merged with the gapping prior) + manual approach; p2 dtl (gapping prior only)
  const a1 = stroke(ctx, { player_id: 'p1', hole: 1, from: tee, club: 'driver', source: 'quick', rng,
    carry: val(228.4, { sigma: 41.2, origin: 'flight_model', codes: QUICK_CODES }), side: val(4.1, { sigma: 18.3, origin: 'prior', codes: SIDE_CODES }) });
  const b1 = stroke(ctx, { player_id: 'p2', hole: 1, from: tee, club: 'driver', source: 'quick', rng,
    carry: val(205.0, { sigma: 24.6, origin: 'prior', codes: ['PROVISIONAL', 'REFERENCE_PRIOR'] }), side: val(-7.5, { sigma: 16.4, origin: 'prior', codes: ['SIDE_SAMPLED'] }) });
  const a2 = stroke(ctx, { player_id: 'p1', hole: 1, from: { x: a1.rest.x, y: a1.rest.y, lie: a1.rest.lie }, club: '9i', source: 'manual', rng,
    carry: val(q2(Math.hypot(r.course.holes[0].pin[0] - a1.rest.x, r.course.holes[0].pin[1] - a1.rest.y) - 4), { validity: 'estimated', origin: 'manual', codes: ['MANUAL_ENTRY'] }),
    side: val(1.5, { validity: 'estimated', origin: 'manual', codes: ['MANUAL_ENTRY'] }) });
  const b2 = stroke(ctx, { player_id: 'p2', hole: 1, from: { x: b1.rest.x, y: b1.rest.y, lie: b1.rest.lie }, club: '7i', source: 'manual', rng,
    carry: val(q2(Math.hypot(r.course.holes[0].pin[0] - b1.rest.x, r.course.holes[0].pin[1] - b1.rest.y) - 6), { validity: 'estimated', origin: 'manual', codes: ['MANUAL_ENTRY'] }),
    side: val(null, { validity: 'not_observable', origin: 'manual', codes: ['MANUAL_ENTRY'] }) });
  putts(ctx, 'p1', 1, a2, 2, rng);
  putts(ctx, 'p2', 1, b2, 2, rng);
  // hole 2: p1 tee shot from an imported 240 fps face_on shot (carry estimated, side sampled)
  stroke(ctx, { player_id: 'p1', hole: 2, from: tee, club: 'driver', source: 'shot', shot_id: 'shot-fx-v2-face-on-240', rng,
    carry: val(231.0, { ci95: [214.2, 247.8], validity: 'estimated', origin: 'flight_model', codes: ['FLIGHT_MODELLED'] }),
    side: val(-3.2, { sigma: 18.5, origin: 'prior', codes: SIDE_CODES }) });
  r.current = { hole: 2, player_id: 'p2' };
  r.updated_at = '2026-11-07T09:21:00.000Z';
  return r;
}

function round18parkland() {
  const rng = mulberry32(987654);
  const r = header('round-fx-18-parkland-1p', 'parkland', 987654, 18, 'finished', [player('p1', 'Player 1', 'owner', null)], '2026-11-06T08:00:00.000Z');
  const ctx = { holes: r.course.holes, n: new Map(), seq: 0, strokes: r.strokes };
  for (const h of r.course.holes) {
    let from = { x: 0, y: 0, lie: 'tee' };
    let left = Math.hypot(h.pin[0], h.pin[1]);
    let k = 0;
    while (left > 12 && k < 3) {
      const full = left > 230 ? 225 + rng() * 10 : left - 3 - rng() * 4;
      const club = full > 200 ? 'driver' : full > 160 ? '5i' : full > 120 ? '7i' : 'pw';
      const st = stroke(ctx, { player_id: 'p1', hole: h.n, from, club, source: 'quick', rng,
        carry: val(q2(full), { sigma: q2(full * 0.12), origin: 'prior', codes: ['PROVISIONAL', 'GAPPING_PRIOR'] }),
        side: val(q2((rng() - 0.5) * 6), { sigma: q2(full * 0.06), origin: 'prior', codes: ['SIDE_SAMPLED'] }) });
      if (h.n === 7 && k === 0) { st.event = 'water'; st.penalty = 1; }
      from = { x: st.rest.x, y: st.rest.y, lie: st.rest.lie };
      left = Math.hypot(h.pin[0] - from.x, h.pin[1] - from.y);
      k++;
      if (left <= 12) st.rest.lie = 'green';
    }
    putts(ctx, 'p1', h.n, ctx.strokes[ctx.strokes.length - 1], 1 + (h.n % 2), rng);
  }
  r.current = null;
  r.updated_at = '2026-11-06T11:40:00.000Z';
  return r;
}

function roundManual() {
  const rng = mulberry32(1);
  const r = header('round-fx-manual-only', 'desert', 1, 9, 'active', [player('p1', 'Player 1', 'owner', 230)], '2026-11-07T07:00:00.000Z');
  const ctx = { holes: r.course.holes, n: new Map(), seq: 0, strokes: r.strokes };
  const m = (v) => val(v, { validity: 'estimated', origin: 'manual', codes: ['MANUAL_ENTRY'] });
  const s1 = stroke(ctx, { player_id: 'p1', hole: 1, from: { x: 0, y: 0, lie: 'tee' }, club: 'driver', source: 'manual', carry: m(240), side: m(-2), rng });
  stroke(ctx, { player_id: 'p1', hole: 1, from: { x: s1.rest.x, y: s1.rest.y, lie: s1.rest.lie }, club: 'pw', source: 'manual', carry: m(110), side: m(1), rng });
  r.current = { hole: 1, player_id: 'p1' };
  return r;
}

const clone = (o) => JSON.parse(JSON.stringify(o));
/** bad_<rule>: one mutation of valid_9_links_2p per rule (validateRound must name the rule). */
const BAD = {
  schema: (r) => { r.schema = 'golf-round/2'; },
  players_count: (r) => { for (let i = 3; i <= 5; i++) r.players.push({ ...r.players[1], player_id: `p${i}` }); },
  holes_count: (r) => { r.course.holes = r.course.holes.slice(0, 8); },
  hole_shape: (r) => { r.course.holes[2].par = 6; },
  stroke_seq_increasing: (r) => { r.strokes[1].seq = 0; },
  stroke_player_known: (r) => { r.strokes[0].player_id = 'nobody'; },
  stroke_hole_range: (r) => { r.strokes.at(-1).hole = 10; },
  stroke_n_sequence: (r) => { r.strokes[2].n = 3; },
  manual_entry_code: (r) => { r.strokes[2].carry.reason_codes = ['LIE_ADJUSTED']; },
  value_needs_uncertainty: (r) => { r.strokes[0].carry.sigma = null; },
  null_needs_reason: (r) => { r.strokes[0].side = { ...r.strokes[0].side, value: null, sigma: null, validity: 'not_observable', reason_codes: [] }; },
  validity_not_valid: (r) => { r.strokes[0].carry.validity = 'valid'; },
};

function shotFixtures() {
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/shots/v2/valid_face_on_240.json'), 'utf8'));
  const good = clone(base);
  good.shot_id = 'shot-fx-v4-club-px';
  const imp = good.tracks.impact_frame;
  // club head approaching the ball at 240 fps: 6 frames before impact to impact (original-resolution pixels)
  good.tracks.club_px = Array.from({ length: 7 }, (_, i) => [imp - 6 + i, q2(755.67 - (6 - i) * 52.5), q2(952.11 - (6 - i) * 3.1)]);
  const bad = clone(good);
  bad.shot_id = 'shot-fx-v4-club-px-bad';
  bad.tracks.club_px[4][0] = bad.tracks.club_px[2][0];
  bad._expect = 'tracks_club_frame_increasing';
  return { good, bad };
}

export function buildAll() {
  const files = new Map();
  const v9 = round9links();
  files.set(`${ROUNDS}/valid_9_links_2p.json`, v9);
  files.set(`${ROUNDS}/valid_18_parkland_1p_finished.json`, round18parkland());
  files.set(`${ROUNDS}/valid_manual_only.json`, roundManual());
  for (const [rule, mut] of Object.entries(BAD)) {
    const r = clone(v9);
    r.round_id = `round-fx-bad-${rule}`;
    mut(r);
    files.set(`${ROUNDS}/bad_${rule}.json`, { ...r, _expect: rule });
  }
  const { good, bad } = shotFixtures();
  files.set(`${V4}/shot_v2_club_px.json`, good);
  files.set(`${V4}/bad_shot_tracks_club_frame_increasing.json`, bad);
  // self-check before anything is written
  const strip = ({ _expect, ...rest }) => rest;
  for (const [rel, obj] of files) {
    const isShot = obj.schema === 'golf-shot/2';
    const res = isShot ? validateShot(strip(obj)) : validateRound(strip(obj));
    const name = path.basename(rel);
    if (name.startsWith('valid_') || name.startsWith('shot_')) {
      if (!res.ok) throw new Error(`${rel} should be valid: ${res.errors.slice(0, 3).map((e) => `${e.path}: ${e.msg}`).join('; ')}`);
    } else if (res.ok || !res.errors.some((e) => e.msg.includes(obj._expect))) {
      throw new Error(`${rel} should fail with ${obj._expect}: ${JSON.stringify(res.errors.slice(0, 3))}`);
    }
  }
  // bad_* round fixtures are one line each (they differ from valid_9_links_2p in one field; keeps the repo small)
  return new Map([...files].map(([k, v]) => [k, `${JSON.stringify(v, null, k.startsWith(`${ROUNDS}/bad_`) ? 0 : 2)}\n`]));
}

function main() {
  const check = process.argv.includes('--check');
  const files = buildAll();
  let bad = 0;
  for (const [rel, text] of files) {
    const abs = path.join(ROOT, rel);
    if (check) {
      const cur = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
      if (cur !== text) { console.log(`DIFFERS ${rel}`); bad++; }
    } else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, text);
    }
  }
  console.log(check ? `make_v4_fixtures --check: ${files.size - bad}/${files.size} files up to date` : `make_v4_fixtures: wrote ${files.size} files`);
  if (bad) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
