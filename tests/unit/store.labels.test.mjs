// P14 owner labels: record builder / validator, export with includeLabels, import merge by revision, bad labels
// reject the whole import (nothing written).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeLabelRecord, validateLabel, LabelError, LABEL_SOURCE } from '../../app/src/store/labels.js';
import { exportJSON, importJSON, ImportError } from '../../app/src/store/export.js';
import { STORE_NAMES } from '../../app/src/store/core.js';
import { openMem, fillRepo, dumpRepo, accept, hasChinese } from './store.fixtures.mjs';

const EV = ['address', 'toe_up', 'mid_backswing', 'top', 'mid_downswing', 'impact', 'mid_follow_through', 'finish'];
const events = (base = 10, fps = 60) => Object.fromEntries(EV.map((n, i) => [n, { frame: base + 10 * i, t_s: (base + 10 * i) / fps, conf: 1, source: 'manual' }]));

test('makeLabelRecord keeps frame + t_s of all 8 events, source owner, revision grows', () => {
  const r0 = makeLabelRecord({ shot_id: 'shot-1', events: events(), labelled_at: '2026-11-04T10:00:00.000Z', fps: 60 });
  assert.equal(r0.source, LABEL_SOURCE);
  assert.equal(r0.revision, 0);
  assert.deepEqual(Object.keys(r0.events), EV);
  assert.deepEqual(r0.events.impact, { frame: 60, t_s: 1 });
  const r1 = makeLabelRecord({ shot_id: 'shot-1', events: events(12), labelled_at: '2026-11-04T10:01:00.000Z', fps: 60, previous: r0 });
  assert.equal(r1.revision, 1);
  assert.equal(validateLabel(r1).ok, true);
});

test('makeLabelRecord rejects a missing event or a non-monotonic order with coded errors (no localized text)', () => {
  const ev = events();
  delete ev.top;
  assert.throws(() => makeLabelRecord({ shot_id: 's', events: ev, labelled_at: '2026-11-04T10:00:00Z', fps: 60 }),
    (e) => e instanceof LabelError && !hasChinese(e.message) && e.errors.some((x) => x.code === 'label.bad_event' && x.params.event === 'top'));
  const bad = events();
  bad.impact = { frame: 5, t_s: 5 / 60 };
  assert.throws(() => makeLabelRecord({ shot_id: 's', events: bad, labelled_at: '2026-11-04T10:00:00Z', fps: 60 }),
    (e) => e.errors.some((x) => x.code === 'label.order' && x.params.event === 'impact' && x.params.before === 'mid_downswing'));
  const v = validateLabel({ shot_id: 's', extra: 1 });
  assert.equal(v.ok, false);
  for (const x of v.errors) {
    assert.match(x.code, /^label\.[a-z_]+$/);
    assert.deepEqual(Object.keys(x).sort(), ['code', 'params']);
    assert.ok(!hasChinese(JSON.stringify(x)) && !hasChinese(String(x)));
  }
  assert.ok(v.errors.some((x) => x.code === 'label.unknown_field' && x.params.field === 'extra'));
  assert.equal(String(v.errors.find((x) => x.code === 'label.unknown_field')), 'label.unknown_field field=extra');
  assert.deepEqual(validateLabel(null).errors.map((x) => x.code), ['label.not_object']);
});

test('export includes labels only with includeLabels; import merges them by revision', async () => {
  const repo = await openMem();
  await fillRepo(repo);
  const l0 = makeLabelRecord({ shot_id: 'shot-1', events: events(), labelled_at: '2026-11-04T10:00:00.000Z', fps: 60 });
  await repo.labels.put(l0);
  const plain = await exportJSON(repo, { now: '2026-11-04T12:00:00.000Z' });
  assert.equal('labels' in plain, false);
  const withL = JSON.parse(JSON.stringify(await exportJSON(repo, { now: '2026-11-04T12:00:00.000Z', includeLabels: true, includePoses: true })));
  assert.deepEqual(withL.labels, [l0]);
  // a filtered export keeps only the labels of the exported shots
  const other = await exportJSON(repo, { session_id: 'no-such-session', includeLabels: true });
  assert.deepEqual(other.labels, []);

  await repo.clear();
  const r = await importJSON(repo, withL, { validate: accept });
  assert.deepEqual(r.counts.labels, { added: 1, updated: 0, kept: 0 });
  assert.deepStrictEqual(await repo.labels.get('shot-1'), l0);

  // a newer label (higher revision) replaces, the same revision is kept
  const l1 = makeLabelRecord({ shot_id: 'shot-1', events: events(11), labelled_at: '2026-11-04T11:00:00.000Z', fps: 60, previous: l0 });
  const r2 = await importJSON(repo, { ...withL, labels: [l1] }, { validate: accept });
  assert.deepEqual(r2.counts.labels, { added: 0, updated: 1, kept: 0 });
  const r3 = await importJSON(repo, withL, { validate: accept });
  assert.deepEqual(r3.counts.labels, { added: 0, updated: 0, kept: 1 });
  assert.equal((await repo.labels.get('shot-1')).revision, 1);
});

test('an invalid label rejects the whole import and writes nothing', async () => {
  const repo = await openMem();
  const src = await openMem();
  await fillRepo(src);
  const file = JSON.parse(JSON.stringify(await exportJSON(src, { includeLabels: true })));
  file.labels = [{ shot_id: 'shot-1', events: { impact: { frame: -1, t_s: 0 } }, labelled_at: 'yesterday', source: 'owner', revision: 0, fps: 60 }];
  const before = await dumpRepo(repo, STORE_NAMES);
  await assert.rejects(importJSON(repo, file, { validate: accept }), (e) => e instanceof ImportError && e.reason === 'invalid' && !hasChinese(e.message) && /labels shot-1: label\./.test(e.message));
  assert.deepStrictEqual(await dumpRepo(repo, STORE_NAMES), before);
  file.labels = 'nope';
  await assert.rejects(importJSON(repo, file, { validate: accept }), (e) => e instanceof ImportError);
});

test('exportLabelSet: golf-swing-lab-labels/1 swings with label, original detections and pose, no video or text', async () => {
  const { exportLabelSet, LABEL_SET_FORMAT } = await import('../../app/src/store/export.js');
  const repo = await openMem();
  await fillRepo(repo);
  const shots = await repo.shots.list();
  const s = shots[0];
  await repo.labels.put(makeLabelRecord({ shot_id: s.shot_id, events: events(), labelled_at: '2026-11-04T10:00:00.000Z', fps: 60 }));
  await repo.labels.put(makeLabelRecord({ shot_id: 'no-such-shot', events: events(), labelled_at: '2026-11-04T10:00:00.000Z', fps: 60 }));
  const out = JSON.parse(JSON.stringify(await exportLabelSet(repo, { now: '2026-11-04T12:00:00.000Z', app_version: 't' })));
  assert.equal(out.format, LABEL_SET_FORMAT);
  assert.equal(out.format, 'golf-swing-lab-labels/1');
  assert.equal(out.swings.length, 1, 'labels without a shot are left out');
  const sw = out.swings[0];
  assert.equal(sw.shot_id, s.shot_id);
  assert.equal(sw.label.source, 'owner');
  assert.ok(sw.detected === null || typeof sw.detected === 'object');
  assert.ok(sw.pose === null || (Array.isArray(sw.pose.t_s) && typeof sw.pose.img_f32 === 'string'));
  assert.ok(!hasChinese(JSON.stringify(out)));
  assert.ok(!/blob|data_b64|clips/.test(JSON.stringify(Object.keys(sw))));
});

test('ImportError carries a reason code for the UI', async () => {
  const repo = await openMem();
  for (const [data, reason] of [['{ not json', 'not_json'], [{ format: 'x/1' }, 'not_export'], [{ format: 'golf-swing-lab-export/2' }, 'version'], [{ format: 'golf-swing-lab-export/1' }, 'missing_fields']]) {
    await assert.rejects(importJSON(repo, data, { validate: accept }), (e) => e instanceof ImportError && e.reason === reason);
  }
});
