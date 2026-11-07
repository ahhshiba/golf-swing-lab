// lab/trends.js (V04-SPEC §E.4) and lab/phases.js (§E.2): per fault × view the per-session share with a Wilson
// interval; unknown never counts; views never merge; "fewer / more" only when the intervals do not overlap; top 3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faultTrends, wilson } from '../../app/src/lab/trends.js';
import { phaseCards, faultMarks, stepFault, PHASE_METRICS } from '../../app/src/lab/phases.js';
import { EVENTS } from '../../app/src/contract/enums.js';

const rec = (shot_id, view, statuses) => ({ shot_id, view, algo: { version: 'v', sha256: 's' }, computed_at: '2026-11-01T00:00:00.000Z',
  faults: Object.entries(statuses).map(([id, status]) => ({ id, status, value: null, sigma: null, threshold: null, event: null, reason_codes: status === 'unknown' ? ['VIEW_DEPTH_AXIS'] : status === 'possible' ? ['FAULT_INCONCLUSIVE'] : [] })) });

test('wilson: known values, edges', () => {
  const w = wilson(5, 10);
  assert.ok(Math.abs(w.lo - 0.2366) < 1e-3 && Math.abs(w.hi - 0.7634) < 1e-3);
  assert.deepEqual(wilson(0, 0), { p: 0, lo: 0, hi: 1 });
  assert.equal(wilson(0, 20).lo, 0);
  assert.equal(wilson(20, 20).hi, 1);
});

test('trends: sessions, shares, unknown excluded, views separate, change only without overlap, top', () => {
  const shots = [];
  const recs = [];
  const add = (sess, day, view, i, st) => {
    const id = `${sess}-${i}`;
    shots.push({ shot_id: id, session_id: sess, created_at: `2026-11-0${day}T10:00:${String(i).padStart(2, '0')}.000+08:00` });
    recs.push(rec(id, view, st));
  };
  for (let i = 0; i < 20; i++) add('s1', 1, 'dtl', i, { early_extension: 'ok', head_dip: i < 2 ? 'fault' : 'ok', sway: 'unknown' });
  for (let i = 0; i < 20; i++) add('s2', 3, 'dtl', i, { early_extension: i < 18 ? (i % 2 ? 'fault' : 'possible') : 'ok', head_dip: i < 3 ? 'fault' : 'ok', sway: 'unknown' });
  for (let i = 0; i < 10; i++) add('s3', 2, 'face_on', i, { head_dip: 'fault', sway: i < 5 ? 'fault' : 'ok' });
  const T = faultTrends(recs, { days: null, view: null, shots, now: Date.parse('2026-11-05T00:00:00Z') });
  const row = (id, view) => T.rows.find((r) => r.id === id && r.view === view);
  const ee = row('early_extension', 'dtl');
  assert.equal(ee.n, 40); assert.equal(ee.k, 18);
  assert.deepEqual(ee.sessions.map((s) => [s.session_id, s.n, s.k]), [['s1', 20, 0], ['s2', 20, 18]]);
  assert.equal(ee.change, 'more');
  // unknown (not observable from dtl) never counts: no dtl sway row at all
  assert.equal(row('sway', 'dtl'), undefined);
  assert.equal(row('sway', 'face_on').n, 10);
  // the same fault from two views stays two rows
  assert.ok(row('head_dip', 'dtl') && row('head_dip', 'face_on'));
  assert.equal(row('head_dip', 'dtl').change, null, 'overlapping intervals: no claim');
  for (const r of T.rows) for (const s of r.sessions) assert.ok(s.lo <= s.p && s.p <= s.hi);
  assert.deepEqual(T.top, ['head_dip', 'sway', 'early_extension']); // 10/10 face_on, 5/10, 18/40
  // view filter and period filter
  assert.ok(faultTrends(recs, { view: 'face_on', shots, now: Date.parse('2026-11-05T00:00:00Z') }).rows.every((r) => r.view === 'face_on'));
  const recent = faultTrends(recs, { days: 3, shots, now: Date.parse('2026-11-05T00:00:00Z') });
  assert.equal(recent.rows.find((r) => r.id === 'early_extension').n, 20);
  // without shots: computed_at day is the session
  const bare = faultTrends(recs.slice(0, 3), { now: Date.parse('2026-11-05T00:00:00Z') });
  assert.equal(bare.rows[0].sessions[0].session_id, 'day-2026-11-01');
  assert.deepEqual(faultTrends([], {}), { top: [], rows: [] });
});

test('trends: at most the latest 10 sessions', () => {
  const shots = []; const recs = [];
  for (let s = 0; s < 14; s++) {
    const id = `x${s}`;
    shots.push({ shot_id: id, session_id: `sess${s}`, created_at: new Date(Date.UTC(2026, 9, 1 + s)).toISOString() });
    recs.push(rec(id, 'face_on', { sway: 'fault' }));
  }
  const r = faultTrends(recs, { shots, now: Date.UTC(2026, 10, 1) }).rows[0];
  assert.equal(r.sessions.length, 10);
  assert.equal(r.sessions[0].session_id, 'sess4');
});

test('phases: 8 cards in event order, metrics with numbers, faults on their phase (tempo on finish); marks and stepping', () => {
  const shot = { events: Object.fromEntries(EVENTS.map((e, i) => [e, { frame: 10 * i, t_s: i / 3 }])),
    metrics: { early_extension_m: { value: 0.1 }, tempo_ratio: { value: 2 }, head_sway_x_m: { value: null } } };
  const lab = { faults: [
    { id: 'early_extension', status: 'fault', event: 'impact' }, { id: 'tempo_off', status: 'possible', event: null },
    { id: 'sway', status: 'unknown', event: null }, { id: 'over_the_top', status: 'possible', event: 'mid_downswing' }, { id: 'head_dip', status: 'ok', event: 'impact' }] };
  const cards = phaseCards(shot, lab);
  assert.deepEqual(cards.map((c) => c.event), [...EVENTS]);
  const imp = cards.find((c) => c.event === 'impact');
  assert.deepEqual(imp.metrics, ['early_extension_m']);
  assert.deepEqual(imp.faults.map((f) => f.id), ['early_extension']);
  assert.deepEqual(cards.find((c) => c.event === 'finish').faults.map((f) => f.id), ['tempo_off']);
  assert.deepEqual(cards.find((c) => c.event === 'top').metrics, [], 'null metrics are left out');
  assert.ok(Object.values(PHASE_METRICS).flat().length >= 15);
  const marks = faultMarks(shot, lab);
  assert.deepEqual(marks.map((m) => [m.id, m.frame]), [['over_the_top', 40], ['early_extension', 50]]);
  assert.equal(stepFault(marks, 0, 1).id, 'over_the_top');
  assert.equal(stepFault(marks, 40, 1).id, 'early_extension');
  assert.equal(stepFault(marks, 50, 1), null);
  assert.equal(stepFault(marks, 50, -1).id, 'over_the_top');
  assert.equal(stepFault(marks, 40, -1), null);
  assert.equal(stepFault([], 0, 1), null);
});
