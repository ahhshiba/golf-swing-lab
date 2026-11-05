// Package C: pure parts of the replay timeline and the shot card (ui/replay.js, ui/shot.js) — no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assignLanes, clampFrame, checkMonotonic, nearestIndex } from '../../app/src/ui/replay.js';
import { heroIdsFor, splitMetrics, buildLabel } from '../../app/src/ui/shot.js';
import { groupShots, buildFilter, fileStamp } from '../../app/src/ui/history.js';
import fs from 'node:fs';

const EV = ['address', 'toe_up', 'mid_backswing', 'top', 'mid_downswing', 'impact', 'mid_follow_through', 'finish'];
const fx = (n) => JSON.parse(fs.readFileSync(new URL(`../fixtures/shots/${n}.json`, import.meta.url), 'utf8'));
const overlap = (a, b, size) => a.lane === b.lane && a.left < b.left + size && b.left < a.left + size;

test('assignLanes: markers of 44 px never overlap, keep input order, stay on the track', () => {
  const size = 44;
  for (const xs of [[22, 88, 138, 188, 221, 243, 265, 342], [10, 10, 10, 10, 10, 10, 10, 10], [0, 400, 5, 395], []]) {
    const r = assignLanes(xs, { width: 350, size, gap: 4 });
    assert.equal(r.length, xs.length);
    r.forEach((m, i) => { assert.equal(m.x, xs[i]); assert.ok(m.left >= 0 && m.left <= 350 - size); });
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) assert.ok(!overlap(r[i], r[j], size + 4 - 1e-9), `${i} vs ${j}`);
  }
  const spread = assignLanes([20, 120, 220, 320], { width: 350 });
  assert.deepEqual(spread.map((m) => m.lane), [0, 0, 0, 0], 'well spaced markers share lane 0');
  assert.equal(Math.max(...assignLanes(Array(8).fill(100), { width: 350 }).map((m) => m.lane)), 7);
});

test('clampFrame and nearestIndex', () => {
  assert.equal(clampFrame(-3, 100), 0);
  assert.equal(clampFrame(101.6, 100), 100);
  assert.equal(clampFrame(4.4, Infinity), 4);
  assert.equal(nearestIndex([0, 0.5, 1], 0.7), 1);
});

test('checkMonotonic and buildLabel return codes with params, no localized text in the data', () => {
  const ev = Object.fromEntries(EV.map((n, i) => [n, { frame: 10 * i, t_s: i / 6 }]));
  assert.equal(checkMonotonic(ev).ok, true);
  ev.top = { frame: 90, t_s: 1.5 };
  const m = checkMonotonic(ev);
  assert.equal(m.ok, false);
  assert.equal(m.code, 'replay.error.order');
  assert.deepEqual(m.params, { event: 'mid_downswing', before: 'top', f: 40, fb: 90 });
  const missing = { ...ev }; delete missing.finish; missing.top = { frame: 30, t_s: 0.5 };
  const r = buildLabel({ shot_id: 's' }, missing, { at: '2026-11-04T00:00:00Z', fps: 60 });
  assert.equal(r.code, 'label.missing_events_n');
  assert.deepEqual(r.params, { n: 1, events: ['finish'] });
});

test('shot card split: hero per view, unmeasured, shared reasons shown once', () => {
  assert.deepEqual(heroIdsFor('face_on', 'highspeed'), ['carry_m', 'ball_speed_mps', 'club_speed_mps']);
  assert.deepEqual(heroIdsFor('face_on', 'live'), ['tempo_ratio', 'club_speed_mps']);
  assert.deepEqual(heroIdsFor('dtl'), ['tempo_ratio', 'spine_forward_tilt_deg', 'hand_plane_dev_m']);
  const shot = fx('valid_face_on_240');
  const sp = splitMetrics(shot);
  const all = [...sp.hero, ...Object.values(sp.groups).flat(), ...sp.unmeasured];
  assert.equal(new Set(all).size, all.length, 'every metric appears once');
  for (const id of sp.unmeasured) assert.equal(shot.metrics[id].value, null);
  for (const id of Object.values(sp.groups).flat()) assert.notEqual(shot.metrics[id].value, null);
  for (const codes of Object.values(sp.unique)) for (const c of codes) assert.ok(!sp.shared.includes(c));
  for (const w of shot.quality.warnings) assert.ok(sp.shared.includes(w));
});

test('history grouping by session, newest first; filter; file stamp from local date parts', () => {
  const s = (id, sess, at) => ({ shot_id: id, session_id: sess, created_at: at, capture: { view: 'face_on' } });
  const g = groupShots([s('a', 'S1', '2026-11-01T10:00:00Z'), s('b', 'S2', '2026-11-03T10:00:00Z'), s('c', 'S1', '2026-11-01T11:00:00Z')]);
  assert.deepEqual(g.map((x) => x.key), ['S2', 'S1']);
  assert.deepEqual(g[1].shots.map((x) => x.shot_id), ['c', 'a']);
  assert.deepEqual(buildFilter({ view: '', starred: true }), { starred: true });
  const d = new Date(2026, 10, 4, 9, 5);
  assert.equal(fileStamp(d), '2026-11-04-0905');
});
