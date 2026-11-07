// Integration (V4-D verify): every map ellipse labelled "95 %" is a JOINT 95 % region of the 2-D normal (radius
// ELLIPSE_K95 = 2.448 σ, chi-square 2 dof), not 1.96 σ per axis (~85 % jointly). Monte Carlo through the real helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ELLIPSE_K95 } from '../../app/src/sim/params.js';
import { mulberry32, gauss } from '../../app/src/geom/rng.js';
import { previewEllipse, demoRound } from '../../app/src/ui/round.js';
import { drawHole2d, strokeSigmas } from '../../app/src/course/draw2d.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const Z10 = 1.2815515655446004;

/** Fraction of N(0, diag(sa², sb²)) draws inside the ellipse with half-axes (ra, rb). */
function coverage(sa, sb, ra, rb, n = 40000, seed = 7) {
  const rng = mulberry32(seed);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const a = gauss(rng, 0, sa), b = gauss(rng, 0, sb);
    if ((a / ra) ** 2 + (b / rb) ** 2 <= 1) k++;
  }
  return k / n;
}

test('ELLIPSE_K95 = √(−2 ln 0.05); Monte Carlo joint coverage ≈ 95 % (1.96 σ per axis would be ≈ 85 %)', () => {
  assert.ok(Math.abs(ELLIPSE_K95 - Math.sqrt(-2 * Math.log(0.05))) < 1e-3);
  const c = coverage(3, 11, ELLIPSE_K95 * 3, ELLIPSE_K95 * 11);
  assert.ok(Math.abs(c - 0.95) < 0.006, `joint coverage ${c}`);
  const old = coverage(3, 11, 1.96 * 3, 1.96 * 11);
  assert.ok(Math.abs(old - 0.854) < 0.01, `1.96 σ box ellipse ${old}`);
});

test('previewEllipse (ui/round.js): the next-shot ellipse covers 95 % of its own carry / side prior', () => {
  const r = demoRound();
  const hole = r.course.holes[0];
  for (const club of ['driver', '7i', 'pw']) {
    const pv = previewEllipse({ x: 0, y: 0 }, { x: hole.pin[0], y: hole.pin[1] }, club, r.players[0], null, 'tee', hole.style);
    const sc = (pv.band.p90 - pv.band.p10) / (2 * Z10); // carry σ, from the P10–P90 band
    assert.ok(Math.abs(pv.ellipse.sy - ELLIPSE_K95 * sc) < 1e-6, `${club} sy`);
    const sd = pv.ellipse.sx / ELLIPSE_K95; // side σ
    const c = coverage(sc, sd, pv.ellipse.sy, pv.ellipse.sx, 20000, 11);
    assert.ok(Math.abs(c - 0.95) < 0.01, `${club} coverage ${c}`);
  }
});

test('drawHole2d: a played stroke\'s ellipse radii are ELLIPSE_K95 × its carry / side σ (in map px)', () => {
  const dir = join(ROOT, 'tests/fixtures/rounds/v4c');
  const round = JSON.parse(readFileSync(join(dir, readdirSync(dir).filter((f) => f.endsWith('.json'))[0]), 'utf8'));
  const strokes = round.strokes.filter((s) => s.hole === 1);
  const calls = [];
  const ctx = new Proxy({}, { get: (_, k) => (k === 'ellipse' ? (...a) => calls.push(a) : k === 'measureText' ? (s) => ({ width: s.length * 6 }) : () => {}), set: () => true });
  const canvas = { clientWidth: 360, clientHeight: 480, width: 0, height: 0, dataset: {}, getContext: () => ctx, setAttribute() {} };
  const pal = new Proxy({ players: ['a', 'b', 'c', 'd'] }, { get: (o, k) => (k in o ? o[k] : 'x') });
  const res = drawHole2d(canvas, { hole: round.course.holes[0], strokes, ellipse: null, aim: null, palette: pal, units: { distance: 'm' }, players: round.players });
  const withE = strokes.filter((s) => s.source !== 'pickup' && s.club !== 'putter' && strokeSigmas(s).carry && strokeSigmas(s).side);
  assert.ok(withE.length > 0 && calls.length === withE.length, `${calls.length} ellipses for ${withE.length} strokes`);
  const k = res.view.k;
  withE.forEach((s, i) => {
    const sg = strokeSigmas(s);
    assert.ok(Math.abs(calls[i][2] - Math.max(2, ELLIPSE_K95 * sg.carry * k)) < 1e-9, 'along radius');
    assert.ok(Math.abs(calls[i][3] - Math.max(2, ELLIPSE_K95 * sg.side * k)) < 1e-9, 'across radius');
  });
});
