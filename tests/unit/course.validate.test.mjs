// V04-SPEC §G.3 V4-C acceptance 2: 3 styles × 3,334 seeds (18 holes) all pass validateCourse; par mix and lengths;
// every rule fires on a broken hole.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCourse, PAR_PLAN } from '../../app/src/course/generate.js';
import { validateCourse, middleLength, PAR_LENGTHS } from '../../app/src/course/validate.js';
import { lieAt } from '../../app/src/course/model.js';
import { STYLES, STYLE_IDS } from '../../app/src/course/styles.js';

const SEEDS = 3334;

test(`3 styles × ${SEEDS} seeds (18 holes): every course validates; par 72 = 4 × 3 + 10 × 4 + 4 × 5; lengths in range`, () => {
  const fails = [];
  for (const style of STYLE_IDS) {
    for (let i = 0; i < SEEDS; i++) {
      const seed = (i * 2654435761 + 17) >>> 0; // spread over the whole uint32 range
      const c = generateCourse({ seed, style, holes: 18, tees: 'middle' });
      const v = validateCourse(c);
      if (!v.ok) fails.push(`${style}/${seed}: ${v.problems.slice(0, 2).map((p) => `${p.hole}:${p.rule} ${p.detail}`).join('; ')}`);
      const pars = c.holes.map((h) => h.par);
      assert.equal(pars.reduce((a, b) => a + b, 0), 72);
      for (const p of [3, 4, 5]) assert.equal(pars.filter((x) => x === p).length, PAR_PLAN[18][p]);
      for (const h of c.holes) {
        const L = middleLength(h);
        assert.ok(L >= PAR_LENGTHS[h.par][0] && L <= PAR_LENGTHS[h.par][1]);
        assert.equal(h.style, style);
      }
    }
  }
  assert.deepEqual(fails.slice(0, 5), []);
});

test('9 holes = 2 / 5 / 2; mixed draws holes from all three styles', () => {
  const styles = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const c = generateCourse({ seed, style: 'mixed', holes: 9, tees: 'middle' });
    assert.ok(validateCourse(c).ok, String(seed));
    assert.deepEqual([3, 4, 5].map((p) => c.holes.filter((h) => h.par === p).length), [2, 5, 2]);
    for (const h of c.holes) styles.add(h.style);
  }
  assert.deepEqual([...styles].sort(), ['desert', 'links', 'parkland']);
});

test('templates: 3 original styles × 7 hand templates (par 3 × 2, par 4 × 3, par 5 × 2), each used', () => {
  const used = new Set();
  for (let seed = 1; seed <= 60; seed++) for (const style of STYLE_IDS) for (const h of generateCourse({ seed, style, holes: 18, tees: 'middle' }).holes) used.add(h.template);
  for (const style of STYLE_IDS) {
    const t = STYLES[style];
    assert.equal(t.length, 7);
    assert.deepEqual([3, 4, 5].map((p) => t.filter((x) => x.par === p).length), [2, 3, 2]);
    for (const x of t) assert.ok(used.has(x.id), x.id);
  }
  const c = generateCourse({ seed: 3, style: 'links', holes: 18, tees: 'middle' });
  assert.ok(c.holes.every((h) => h.trees.length === 0), 'links has no trees');
  const p = generateCourse({ seed: 3, style: 'parkland', holes: 18, tees: 'middle' });
  assert.ok(p.holes.every((h) => h.trees.length > 0 && h.trees.length <= 60), 'parkland is tree-lined');
});

test('each rule fires on a broken hole', () => {
  const base = () => JSON.parse(JSON.stringify(generateCourse({ seed: 11, style: 'parkland', holes: 9, tees: 'middle' })));
  const rulesOf = (c) => new Set(validateCourse(c).problems.map((p) => p.rule));
  let c = base();
  c.holes[0].par = c.holes[0].par === 3 ? 4 : 3;
  assert.ok(rulesOf(c).has('par_mix') && rulesOf(c).has('par_length'));

  c = base();
  const h = c.holes.find((x) => x.par === 4);
  const [px, py] = h.pin;
  h.water.push([[px - 3, py - 3], [px + 3, py - 3], [px + 3, py + 3], [px - 3, py + 3]]);
  assert.ok(rulesOf(c).has('green_water'));

  c = base();
  c.holes[1].pin = [c.holes[1].pin[0] + 500, c.holes[1].pin[1]];
  assert.ok(rulesOf(c).has('pin_edge'));

  c = base();
  const h4 = c.holes.find((x) => x.par === 4);
  h4.fairway = h4.fairway.map((poly) => poly.map(([x, y]) => [x * 0.5, y]));
  assert.ok(rulesOf(c).has('landing_zone'));

  c = base();
  const h3 = c.holes.find((x) => x.par === 4);
  h3.bunkers.push([[-3, 20], [3, 20], [3, 260], [-3, 260]]);
  assert.ok(rulesOf(c).has('hazard_centerline'));

  c = base();
  c.holes[2].bunkers.push([[0, 0], [10, 10], [10, 0], [0, 10]]);
  assert.ok(rulesOf(c).has('self_intersection'));

  c = base();
  c.holes[3].water.push([[-5, -5], [5, -5], [5, 5], [-5, 5]]);
  assert.ok(rulesOf(c).has('tee_lie'));
  assert.equal(lieAt(c.holes[3], 0, 0), 'water');
});
