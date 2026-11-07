// Side sign regression (LM-INTERFACES §1 "Side sign (two frames)"): a right-hander's right miss (carry_side_m > 0,
// + = away from the golfer) must be drawn BELOW the centre line of the top view and labelled "right", on both paths:
// the result screen (ui/tiles.js topPoint: flight.landing.y_m, mat frame) and the stats screen (ui/stats.js topPoints:
// converts carry_side_m with the shot's handedness). A left-hander's carry_side_m > 0 is a miss to the LEFT (mirror).
// Fails if stats.js stops negating a right-hander's side, or if drawTop flips its y axis.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { topPoint } from '../../app/src/ui/tiles.js';
import { topPoints } from '../../app/src/ui/stats.js';
import { drawTop } from '../../app/src/viz/index.js';
import { t } from '../../app/src/i18n/index.js';

const hb = JSON.parse(fs.readFileSync(new URL('../fixtures/shots/v2/valid_high_behind_240.json', import.meta.url), 'utf8'));
const P = Object.freeze({
  series: Object.freeze([1, 2, 3, 4, 5, 6, 7, 8].map((i) => `s${i}`)), seriesGlyph: Object.freeze(['circle', 'square', 'triangle', 'diamond', 'down', 'plus', 'cross', 'ring']),
  axis: 'axis', grid: 'grid', text: 'text', target: 'target', ciAlpha: 0.18, tracer: 'tr', halo: 'halo', bg: 'bg', ink: 'ink', font: 'system-ui', dark: true,
});

/** A recording canvas: the y of the landing glyph (the last full-circle arc) is what we need. */
function canvas() {
  const arcs = [];
  const ctx = new Proxy({}, {
    get(_, k) {
      if (k === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (k === 'arc') return (x, y, r) => arcs.push({ x, y, r });
      if (k === 'ellipse') return () => {};
      return () => {};
    },
    set() { return true; },
  });
  return { width: 390, height: 330, getContext: () => ctx, arcs };
}

/** Draw one landing point; returns { y: glyph y in px, side: the a11y side text }. */
function draw(pt) {
  const c = canvas();
  const r = drawTop(c, { points: [{ ...pt, band: null, series: 0 }], units: { distance: 'm' }, palette: P });
  const g = c.arcs.filter((a) => a.r >= 4).at(-1);
  assert.ok(g, 'landing glyph drawn');
  return { y: g.y, side: r.params.side, a11y: r.a11y };
}
/** The same point mirrored across the target line: the centre line lies halfway between the two glyphs. */
const mirror = (p) => ({ ...p, y: -p.y });

const shot = (handedness, side) => ({
  handedness,
  capture: { view: 'high_behind' },
  club: { type: '7i' },
  metrics: { carry_m: { value: 150, sigma: 3, validity: 'low_confidence' }, carry_side_m: { value: side, sigma: 1, validity: 'low_confidence' } },
  // physics/lm toMat: right-hander landing y = −carry_side_m, left-hander = +carry_side_m
  flight: { landing: { x_m: 150, y_m: handedness === 'left' ? side : -side, t_s: 5 }, samples: [[0, 0, 0, 0], [5, 150, handedness === 'left' ? side : -side, 0]] },
});
const RIGHT = () => t('viz.dir.right', { v: '6', unit: t('unit.m') });
const LEFT = () => t('viz.dir.left', { v: '6', unit: t('unit.m') });

for (const [path, toPoint] of [
  ['result screen (ui/tiles.js topPoint)', (s) => topPoint(s)],
  ['stats screen (ui/stats.js topPoints)', (s) => topPoints([s])[0]],
]) {
  test(`${path}: right-hander, carry_side_m > 0 → below the centre, labelled right`, () => {
    const p = toPoint(shot('right', 6));
    assert.ok(p.y < 0, `mat-frame y ${p.y} must be negative (right of the line)`);
    const a = draw(p);
    const b = draw(mirror(p));
    assert.ok(a.y > b.y, `glyph y ${a.y} px is not below the mirrored point ${b.y} px (canvas y grows downwards)`);
    assert.equal(a.a11y, 'viz.top.one');
    assert.equal(a.side, RIGHT());
  });
  test(`${path}: left-hander, carry_side_m > 0 → above the centre, labelled left (mirror)`, () => {
    const p = toPoint(shot('left', 6));
    assert.ok(p.y > 0, `mat-frame y ${p.y} must be positive (left of the line)`);
    const a = draw(p);
    const b = draw(mirror(p));
    assert.ok(a.y < b.y, `glyph y ${a.y} px is not above the mirrored point ${b.y} px`);
    assert.equal(a.side, LEFT());
  });
}

test('fixture valid_high_behind_240 (right-hander, side + → landing y −): both paths agree', () => {
  const side = hb.metrics.carry_side_m.value;
  assert.ok(side > 0 && (hb.handedness ?? 'right') === 'right');
  const a = topPoint(hb);
  const b = topPoints([hb])[0];
  assert.ok(Math.abs(a.y - b.y) < 0.6, `tiles ${a.y} vs stats ${b.y}`);
  assert.ok(draw(a).y > draw(mirror(a)).y && draw(b).y > draw(mirror(b)).y);
});
