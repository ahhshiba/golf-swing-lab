// practice.drills — LAUNCH-MONITOR-SPEC §5.2 LM-E acceptance 2: seeded drills, the distance-control 18 template,
// assignClips by started_at, and the drill record helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DRILL_TEMPLATES, makeDrill, recordShot, practiceOf, progressOf, summaryOf, comparable, YD_M, REFERENCE_CARRY_M } from '../../app/src/practice/drills.js';
import { assignClips } from '../../app/src/practice/assign.js';
import { CLUBS } from '../../app/src/session/settings.js';
import { validateShot } from '../../app/src/contract/validate.js';

const fx = (n) => JSON.parse(fs.readFileSync(new URL(`../fixtures/shots/v2/${n}.json`, import.meta.url), 'utf8'));

test('templates are data with unique ids, including distance18', () => {
  const ids = DRILL_TEMPLATES.map((x) => x.id);
  assert.deepEqual([...new Set(ids)], ids);
  for (const id of ['target', 'gapping', 'distance18', 'clubs3']) assert.ok(ids.includes(id), id);
});

test('same seed → deep-equal drill; another seed → another order', () => {
  for (const id of ['distance18', 'clubs3']) {
    assert.deepStrictEqual(makeDrill(id, { seed: 42 }), makeDrill(id, { seed: 42 }));
    assert.notDeepStrictEqual(makeDrill(id, { seed: 42 }).slots.map((s) => s.target_m + (s.club ?? '')), makeDrill(id, { seed: 43 }).slots.map((s) => s.target_m + (s.club ?? '')));
  }
  assert.deepStrictEqual(makeDrill('target', { seed: 1, targets: [100], clubs: ['7i'] }), makeDrill('target', { seed: 1, targets: [100], clubs: ['7i'] }));
});

test('distance control 18: 2 rounds × 9 targets (40…120 yd), each target once per round', () => {
  const d = makeDrill('distance18', { seed: 7 });
  assert.equal(d.slots.length, 18);
  assert.deepEqual(d.slots.map((s) => s.slot), Array.from({ length: 18 }, (_, i) => i + 1));
  const want = [40, 50, 60, 70, 80, 90, 100, 110, 120].map((y) => (y * YD_M).toFixed(6)).sort();
  for (const r of [1, 2]) {
    const got = d.slots.filter((s) => s.round === r).map((s) => s.target_m.toFixed(6)).sort();
    assert.deepEqual(got, want, `round ${r}`);
  }
  assert.equal(d.status, 'active');
  assert.equal(d.template, 'distance18');
});

test('target practice, gapping session, full bag', () => {
  const t = makeDrill('target', { seed: 1, targets: [120], clubs: ['7i'] });
  assert.equal(t.slots.length, 10);
  assert.ok(t.slots.every((s) => s.target_m === 120 && s.club === '7i'));
  assert.equal(makeDrill('target', { seed: 1, targets: [120], count: 5 }).slots.length, 5);
  assert.throws(() => makeDrill('target', { seed: 1 }), RangeError);
  const g = makeDrill('gapping', { seed: 1 });
  assert.equal(g.slots.length, CLUBS.length * 5);
  assert.equal(makeDrill('gapping', { seed: 1, clubs: ['7i', 'pw'], perClub: 3 }).slots.length, 6);
  const b = makeDrill('clubs3', { seed: 3, targets: { '7i': 140 } });
  assert.equal(b.slots.length, CLUBS.length * 3);
  assert.ok(b.slots.filter((s) => s.club === '7i').every((s) => s.target_m === 140));
  assert.ok(b.slots.filter((s) => s.club === 'pw').every((s) => s.target_m === REFERENCE_CARRY_M.pw));
  assert.throws(() => makeDrill('nope', { seed: 1 }), /unknown template/);
});

test('assignClips: sorted by started_at onto the open slots; extra clips are not assigned and reported (slot null)', () => {
  const d = makeDrill('target', { seed: 1, targets: [100], count: 3 });
  const clips = [{ started_at: '2026-11-06T10:02:00Z' }, { started_at: '2026-11-06T10:00:00Z' }, { started_at: '2026-11-06T10:03:00Z' }, { started_at: '2026-11-06T10:01:00Z' }];
  const a = assignClips(d, clips);
  assert.deepEqual(a, [{ slot: 1, clipIndex: 1 }, { slot: 2, clipIndex: 3 }, { slot: 3, clipIndex: 0 }, { slot: null, clipIndex: 2 }]);
  // slots that already have a shot are skipped
  const d2 = recordShot(d, 1, fx('valid_face_on_240'));
  assert.deepEqual(assignClips(d2, clips.slice(0, 2)), [{ slot: 2, clipIndex: 1 }, { slot: 3, clipIndex: 0 }]);
  // unknown times go last, ties keep input order
  assert.deepEqual(assignClips(d, [{ started_at: null }, { started_at: 5 }, { started_at: 5 }]), [{ slot: 1, clipIndex: 1 }, { slot: 2, clipIndex: 2 }, { slot: 3, clipIndex: 0 }]);
});

test('recordShot / practiceOf: the shot carries a valid practice block; score marked estimated; drill done when full', () => {
  let d = makeDrill('target', { seed: 1, targets: [181], count: 2, drill_id: 'drill-t', created_at: '2026-11-06T00:00:00.000Z' });
  const shot = fx('valid_face_on_240');
  shot.practice = practiceOf(d, 1);
  assert.deepEqual(shot.practice, { drill_id: 'drill-t', slot: 1, target_m: 181, attempt: 1 });
  assert.deepEqual(validateShot(shot), { ok: true, errors: [] });
  d = recordShot(d, 1, shot, { now: '2026-11-06T00:01:00.000Z' });
  const s = d.slots[0];
  assert.equal(s.shot_id, shot.shot_id);
  assert.equal(s.score, 100); // carry 181 = target
  assert.ok(s.score_sigma > 0, 'carry has a ci95 → score has a sigma');
  assert.equal(s.estimated, true, 'modelled carry → the score is labelled estimated');
  assert.equal(s.view, 'face_on');
  assert.deepEqual(progressOf(d), { done: 1, total: 2, next: d.slots[1] });
  assert.equal(d.status, 'active');
  d = recordShot(d, 2, fx('valid_high_behind_240'), { now: '2026-11-06T00:02:00.000Z' });
  assert.equal(d.status, 'done');
  assert.equal(d.finished_at, '2026-11-06T00:02:00.000Z');
  assert.ok(Number.isFinite(d.slots[1].miss_side_m), 'hb shot has a side miss');
  const sum = summaryOf(d);
  assert.equal(sum.score.n, 2);
  assert.deepEqual(sum.views.sort(), ['face_on', 'high_behind']);
  assert.equal(comparable(d, d), false, 'mixed views are not comparable');
});
