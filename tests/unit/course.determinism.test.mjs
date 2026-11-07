// V04-SPEC §G.3 V4-C acceptance 1: the course generator is deterministic and engine-independent.
// Golden: tests/fixtures/v4/course-golden.json (sha256 of the canonical JSON per style × seed; regenerate ONLY when the
// generator version COURSE_GENERATOR changes: UPDATE_GOLDEN=1 node --test tests/unit/course.determinism.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCourse, courseCanonical, COURSE_GENERATOR } from '../../app/src/course/generate.js';
import { dsin, dcos, q1, q2, rngOf } from '../../app/src/course/detmath.js';
import { mulberry32 } from '../../app/src/geom/rng.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GOLDEN = join(ROOT, 'tests/fixtures/v4/course-golden.json');
const sha = (c) => createHash('sha256').update(courseCanonical(c)).digest('hex');
const CASES = [];
for (const style of ['parkland', 'links', 'desert']) for (const seed of [1, 42, 987654]) CASES.push({ seed, style, holes: 18, tees: 'middle' });
CASES.push({ seed: 42, style: 'mixed', holes: 18, tees: 'middle' }, { seed: 42, style: 'links', holes: 9, tees: 'back' }, { seed: 7, style: 'desert', holes: 9, tees: 'forward' });
const key = (c) => `${c.style}/${c.seed}/${c.holes}/${c.tees}`;

test('same input twice → identical canonical JSON (sha256)', () => {
  for (const c of CASES) assert.equal(sha(generateCourse(c)), sha(generateCourse(c)), key(c));
});

test('golden: every style × seed {1, 42, 987654} matches tests/fixtures/v4/course-golden.json', () => {
  const now = Object.fromEntries(CASES.map((c) => [key(c), sha(generateCourse(c))]));
  if (process.env.UPDATE_GOLDEN === '1') {
    const doc = {
      schema: 'gsl-course-golden/1', generator: COURSE_GENERATOR,
      note: 'sha256 of course/generate.js courseCanonical(generateCourse(opts)); key = style/seed/holes/tees. V4-D v4-d-perf compares the browser value of links/42/18/middle.',
      cases: now,
    };
    writeFileSync(GOLDEN, `${JSON.stringify(doc, null, 2)}\n`);
  }
  const g = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  assert.equal(g.generator, COURSE_GENERATOR);
  assert.deepEqual(now, g.cases);
});

test('no engine-dependent maths or clock in course/{model,detmath,generate,styles,validate}.js', () => {
  let hits = 0;
  for (const f of ['model', 'detmath', 'generate', 'styles', 'validate']) {
    const src = readFileSync(join(ROOT, `app/src/course/${f}.js`), 'utf8');
    const m = src.match(/Math\.(sin|cos|tan|atan2?|exp|log|pow|random)|Date\.now/g);
    if (m) hits += m.length;
  }
  assert.equal(hits, 0);
});

test('detmath: sin / cos agree with Math to 1e-12; quantisation never yields −0; rngOf = geom/rng mulberry32', () => {
  for (let x = -20; x <= 20; x += 0.0137) {
    assert.ok(Math.abs(dsin(x) - Math.sin(x)) < 1e-12, `sin ${x}`);
    assert.ok(Math.abs(dcos(x) - Math.cos(x)) < 1e-12, `cos ${x}`);
  }
  assert.ok(Object.is(q1(-0.04), 0) && Object.is(q2(-0.004), 0));
  assert.equal(q1(1.25), 1.3);
  assert.equal(q1(-1.25), -1.3);
  const a = rngOf(123), b = mulberry32(123);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
});

test('every coordinate is quantised to 0.1 m; geometry snapshot fits the round budget', () => {
  const c = generateCourse({ seed: 42, style: 'parkland', holes: 18, tees: 'middle' });
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'number') assert.ok(Math.abs(v * 10 - Math.round(v * 10)) < 1e-9, String(v));
  };
  for (const h of c.holes) walk([h.tees, h.pin, h.green.poly, h.fairway, h.bunkers, h.water, h.trees, h.bounds, h.centerline, h.length_m]);
  assert.ok(JSON.stringify(c).length < 120 * 1024);
});

test('tees: forward / middle / back lengths are 0.85 / 1 / 1.12 of the middle length; bad options throw', () => {
  const m = generateCourse({ seed: 5, style: 'links', holes: 9, tees: 'middle' });
  const f = generateCourse({ seed: 5, style: 'links', holes: 9, tees: 'forward' });
  const b = generateCourse({ seed: 5, style: 'links', holes: 9, tees: 'back' });
  m.holes.forEach((h, i) => {
    assert.deepEqual(h.pin, f.holes[i].pin);
    assert.ok(Math.abs(f.holes[i].length_m - 0.85 * h.length_m) <= 0.2);
    assert.ok(Math.abs(b.holes[i].length_m - 1.12 * h.length_m) <= 0.2);
  });
  assert.throws(() => generateCourse({ seed: -1, style: 'links', holes: 9, tees: 'middle' }), RangeError);
  assert.throws(() => generateCourse({ seed: 1, style: 'real-course', holes: 9, tees: 'middle' }), RangeError);
  assert.throws(() => generateCourse({ seed: 1, style: 'links', holes: 12, tees: 'middle' }), RangeError);
});
