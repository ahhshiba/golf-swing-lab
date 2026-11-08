// V4-D: course/draw2d.js, course/draw3d.js, course/palette.js and the pure helpers of ui/round.js / ui/course.js with a
// recording fake canvas (no browser). Engine-played round fixtures: tests/fixtures/rounds/v4c/*.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drawHole2d, sourceKind, sideKind, strokeSigmas, fitView } from '../../app/src/course/draw2d.js';
import { createFlyover, flyCamera } from '../../app/src/course/draw3d.js';
import { coursePalette, PLAYER_TOKENS } from '../../app/src/course/palette.js';
import { rotateAim, defaultAim, previewEllipse, demoRound } from '../../app/src/ui/round.js';
import { parseCourseNumber, courseNumber } from '../../app/src/ui/course.js';
import { generateCourse } from '../../app/src/course/generate.js';
import { scorecard } from '../../app/src/sim/round.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const V4C = join(ROOT, 'tests/fixtures/rounds/v4c');
const rounds = readdirSync(V4C).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(V4C, f), 'utf8')));

// a palette whose every colour is a recognisable token name: anything else drawn is a literal colour
const TOKENS = ['--course-fairway', '--course-rough', '--course-green', '--course-bunker', '--course-water', '--course-tree', '--course-ob',
  '--course-pin', '--course-outline', '--media-bg', '--trail-1', '--trail-3', '--trail-4', '--trail-5', '--trail-6', '--trail-7', '--font'];
function fakeEl(outline = 'transparent') {
  const vals = Object.fromEntries(TOKENS.map((k) => [k, `tok(${k})`]));
  vals['--course-outline'] = outline;
  return { ownerDocument: { defaultView: { getComputedStyle: () => ({ color: 'tok(color)', getPropertyValue: (k) => vals[k] ?? '' }) } } };
}

function recordingCanvas(w = 360, h = 480) {
  const log = { fills: new Set(), strokes: new Set(), ellipses: 0, frames: 0, text: [] };
  const ctx = {
    set fillStyle(v) { log.fills.add(v); }, get fillStyle() { return ''; },
    set strokeStyle(v) { log.strokes.add(v); }, get strokeStyle() { return ''; },
    lineWidth: 1, globalAlpha: 1, font: '', textBaseline: '',
    setTransform() {}, clearRect() {}, fillRect() { log.frames += 0; }, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    quadraticCurveTo() {}, arc() {}, rect() {}, ellipse() { log.ellipses++; }, fill() {}, stroke() {}, clip() {}, save() {}, restore() {},
    setLineDash() {}, measureText: (s) => ({ width: s.length * 6 }), fillText: (s) => log.text.push(s), strokeText() {},
  };
  const attrs = {};
  return { log, canvas: { clientWidth: w, clientHeight: h, width: 0, height: 0, dataset: {}, getContext: () => ctx, setAttribute: (k, v) => { attrs[k] = v; }, attrs } };
}

const isToken = (c) => /^tok\(--(course|media|trail)-[\w-]+\)$/.test(c) || c === 'transparent';

test('palette: reads the --course-* and trail tokens; sun outline switches outlined on', () => {
  const p = coursePalette(fakeEl());
  assert.equal(p.fairway, 'tok(--course-fairway)');
  assert.equal(p.players.length, 4);
  assert.deepEqual(p.players, PLAYER_TOKENS.map((k) => `tok(${k})`));
  assert.equal(p.outlined, false);
  assert.equal(coursePalette(fakeEl('#000000')).outlined, true);
});

test('drawHole2d: every stroke with an uncertainty gets its 95 % ellipse; colours only from the palette; a11y + params', () => {
  const pal = coursePalette(fakeEl('#000000'));
  for (const r of rounds) {
    for (const holeN of [1, 2]) {
      const hole = r.course.holes[holeN - 1];
      const strokes = r.strokes.filter((s) => s.hole === holeN);
      const { canvas, log } = recordingCanvas();
      const res = drawHole2d(canvas, { hole, strokes, ellipse: null, aim: null, palette: pal, units: { distance: 'm' }, players: r.players, labels: { simulated: 'Simulated' } });
      const want = strokes.filter((s) => s.source !== 'pickup' && s.club !== 'putter' && strokeSigmas(s).carry && strokeSigmas(s).side).length;
      assert.equal(res.params.ellipses, want, `${r.round_id} hole ${holeN}`);
      assert.equal(res.params.ellipse, want > 0);
      assert.equal(res.params.strokes, strokes.filter((s) => s.source !== 'pickup').length);
      const bad = [...log.fills, ...log.strokes].filter((c) => !isToken(c) && c !== '#000000');
      assert.deepEqual(bad, [], 'every colour is a palette token');
      assert.ok(res.a11y.length > 10);
      assert.equal(canvas.attrs['aria-label'], res.a11y);
      assert.deepEqual(JSON.parse(canvas.dataset.params), res.params);
    }
  }
});

test('drawHole2d: the next shot adds an aim line, a carry band and its ellipse (params.aim, ellipse)', () => {
  const r = demoRound();
  const hole = r.course.holes[0];
  const { canvas } = recordingCanvas();
  const from = { x: 0, y: 0 };
  const pv = previewEllipse(from, { x: hole.pin[0], y: hole.pin[1] }, 'driver', r.players[0], null, 'tee', hole.style);
  const res = drawHole2d(canvas, { hole, strokes: [], ellipse: pv.ellipse, aim: { x: 0, y: 200 }, from, band: pv.band, palette: coursePalette(fakeEl()), units: { distance: 'yd' } });
  assert.equal(res.params.aim, true);
  assert.equal(res.params.ellipse, true);
  assert.equal(res.params.source, null);
  assert.ok(pv.ellipse.sx > 0 && pv.ellipse.sy > 0 && pv.band.p90 > pv.band.p10);
});

test('sourceKind / sideKind: every source of the honesty table (gapping, reference, estimated, sampled, manual, auto)', () => {
  const kinds = new Set();
  for (const r of rounds) for (const s of r.strokes) { kinds.add(`c:${sourceKind(s)}`); kinds.add(`s:${sideKind(s)}`); }
  for (const k of ['c:gapping', 'c:reference', 'c:estimated', 'c:manual', 'c:auto', 's:sampled', 's:manual', 's:auto']) assert.ok(kinds.has(k), k);
  const dtl = rounds.filter((r) => r.rules.unobservedSide === 'sample').flatMap((r) => r.strokes).find((s) => s.source === 'quick' && s.carry.origin === 'prior' && s.carry.reason_codes.includes('GAPPING_PRIOR'));
  assert.equal(sourceKind(dtl), 'gapping');
  assert.equal(sideKind(dtl), 'sampled');
  const centre = rounds.find((r) => r.rules.unobservedSide === 'center').strokes.find((s) => s.source === 'quick');
  assert.equal(sideKind(centre), 'straight', 'straight mode is named, never sampled');
});

test('fitView maps world ↔ px both ways', () => {
  const v = fitView([[-50, 0], [50, 400]], 300, 500, 10);
  const [px, py] = v.toPx(10, 123);
  const [x, y] = v.toWorld(px, py);
  assert.ok(Math.abs(x - 10) < 1e-9 && Math.abs(y - 123) < 1e-9);
  assert.ok(v.toPx(0, 400)[1] < v.toPx(0, 0)[1], 'north is up');
});

test('flyover: reduced motion draws exactly one frame and waits for skip(); animated runs to onDone', () => {
  const hole = generateCourse({ seed: 42, style: 'links', holes: 18, tees: 'middle' }).holes[0];
  const pal = coursePalette(fakeEl());
  const a = recordingCanvas(360, 240);
  let done = 0;
  const raf = () => { throw new Error('no animation frames with reduced motion'); };
  const f = createFlyover(a.canvas, { hole, palette: pal, reducedMotion: true, onDone: () => done++, raf });
  f.start();
  assert.equal(f.stats().frames, 1);
  assert.equal(done, 0);
  f.skip();
  assert.equal(done, 1);
  f.skip();
  assert.equal(done, 1, 'onDone once');

  let clock = 0;
  const queue = [];
  const b = recordingCanvas(360, 240);
  let done2 = 0;
  const g = createFlyover(b.canvas, { hole, palette: pal, reducedMotion: false, onDone: () => done2++, now: () => clock, raf: (fn) => { queue.push(fn); return queue.length; }, caf: () => {} });
  g.start();
  while (queue.length && clock < 10000) { clock += 16.7; queue.shift()(); }
  assert.equal(done2, 1);
  assert.ok(g.stats().frames >= 200 && g.stats().frames <= 260, `frames ${g.stats().frames}`);
  assert.ok(g.stats().done);
  const bad = [...b.log.fills, ...b.log.strokes].filter((c) => !isToken(c));
  assert.deepEqual(bad, []);
});

test('flyCamera: the camera stays above the ground and looks forward along the hole', () => {
  const hole = generateCourse({ seed: 7, style: 'parkland', holes: 9, tees: 'middle' }).holes[2];
  for (const u of [0, 0.25, 0.5, 0.75, 1, 'static']) {
    const c = flyCamera(hole, u, 400, 250);
    assert.ok(c.eye[2] > 10, `eye z at ${u}`);
    assert.ok(c.fwd[2] < 0, 'looks down');
    assert.ok(Math.abs(Math.hypot(...c.fwd) - 1) < 1e-9);
  }
});

test('aim helpers: ±2° rotation keeps the distance; default aim is the pin in reach, else the centre line at the carry', () => {
  const from = { x: 0, y: 0 };
  const a = rotateAim(from, { x: 0, y: 100 }, 2);
  assert.ok(Math.abs(Math.hypot(a.x, a.y) - 100) < 1e-9);
  assert.ok(a.x < 0, '+2° turns left');
  const hole = generateCourse({ seed: 42, style: 'links', holes: 18, tees: 'middle' }).holes.find((x) => x.par === 5);
  const tee = { x: hole.tees.middle[0], y: hole.tees.middle[1] };
  const d = defaultAim(hole, tee, 220);
  assert.ok(Math.abs(Math.hypot(d.x - tee.x, d.y - tee.y) - 220) < 3);
  const pin = defaultAim(hole, tee, 900);
  assert.deepEqual(pin, { x: hole.pin[0], y: hole.pin[1] });
});

test('course number: 6-digit display, 1–6 digit input', () => {
  assert.equal(courseNumber(42), '000042');
  assert.equal(parseCourseNumber(' 000042 '), 42);
  assert.equal(parseCourseNumber('1234567'), null);
  assert.equal(parseCourseNumber('12a'), null);
});

test('demo round: newRound shape, 2 players, scorecard derivable', () => {
  const r = demoRound();
  assert.equal(r.players.length, 2);
  assert.equal(r.status, 'active');
  assert.deepEqual(r.current, { hole: 1, player_id: 'p1' });
  const sc = scorecard(r);
  assert.equal(sc.players.length, 2);
  assert.equal(sc.players[0].total, null);
});

test('typeInUntil (e2e helper): a typed-in 18-hole round finishes and validates with replay (contract/round.js)', async () => {
  const { typeInUntil } = await import('../../app/src/ui/round.js');
  const { validateRound } = await import('../../app/src/contract/round.js');
  const { replayRound } = await import('../../app/src/sim/round.js');
  const r = typeInUntil(demoRound({ seed: 7, styleId: 'mixed', holes: 18, players: 2 }), () => false);
  assert.equal(r.current, null);
  assert.equal(r.status, 'finished');
  const v = validateRound(r, { replayRound });
  assert.ok(v.ok, JSON.stringify(v.errors.slice(0, 3)));
  const sc = scorecard(r);
  for (const p of sc.players) assert.ok(Number.isInteger(p.total) && p.total >= 18 * 2);
});

test('balls: each player\'s marker has its own shape (not colour only), as the legend swatches', async () => {
  const { PLAYER_SHAPES, playerShape } = await import('../../app/src/course/draw2d.js');
  assert.equal(new Set(PLAYER_SHAPES).size, 4);
  const r = demoRound();
  const { canvas } = recordingCanvas();
  const balls = [0, 1, 2, 3].map((k) => ({ x: k * 5, y: 10, player: k, current: k === 0 }));
  const res = drawHole2d(canvas, { hole: r.course.holes[0], strokes: [], ellipse: null, aim: null, palette: coursePalette(fakeEl()), units: { distance: 'm' }, balls });
  assert.deepEqual(res.params.balls, ['circle', 'square', 'triangle', 'diamond']);
  assert.equal(playerShape(5), 'square');
  const css = readFileSync(join(ROOT, 'app/styles/screens/sim.css'), 'utf8');
  for (const k of [1, 2, 3]) assert.match(css, new RegExp(`\\.player-swatch\\[data-p="${k}"\\][^}]*(border-radius|clip-path|transform)`), `swatch ${k} has its own shape`);
});

test('balls: two players on one spot are pulled apart (every ball visible); separate balls stay put', async () => {
  const { ballOffsets } = await import('../../app/src/course/draw2d.js');
  const off = ballOffsets([[100, 100], [101, 100], [300, 50]]);
  const a = [100 + off[0][0], 100 + off[0][1]], b = [101 + off[1][0], 100 + off[1][1]];
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) >= 14, `pulled apart ${JSON.stringify(off)}`);
  assert.deepEqual(off[2], [0, 0]);
});

test('scorecard: short column names (≤ 4 letters / 2 Han, unique) and score marks by strokes − par', async () => {
  const { shortNames, relKind } = await import('../../app/src/ui/scorecard.js');
  assert.deepEqual(shortNames(['Alex', 'Samantha', '王小明', 'Sam']), ['Alex', 'Sam.', '王小', 'Sam']);
  assert.deepEqual(shortNames(['Samuel', 'Samantha']), ['Sam.1', 'Sam.2']);
  assert.deepEqual([-3, -2, -1, 0, 1, 2, 4, null].map(relKind), ['eagle', 'eagle', 'birdie', 'par', 'bogey', 'double', 'double', '']);
});

test('honestDistance: rounded to what the ± supports; a range when ± is over 30 % of the value', async () => {
  const { honestDistance } = await import('../../app/src/ui/sim-banner.js');
  const m = { distance: 'm' };
  const wide = honestDistance(206, 104, m);
  assert.equal(wide.range, true);
  assert.match(wide.text, /^100–310 /);
  const narrow = honestDistance(107.4, 12.3, m);
  assert.equal(narrow.range, false);
  assert.match(narrow.text, /^107 ± 12 /);
  assert.equal(honestDistance(150, null, m).range, false);
});
