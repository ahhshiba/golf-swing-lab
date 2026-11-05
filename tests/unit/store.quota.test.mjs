import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../app/src/geom/rng.js';
import { planCleanup, requestPersist, estimateStorage, policyClips, isDeletableClip, DEFAULT_POLICY, clipSpaceCheck, freeBytes } from '../../app/src/store/quota.js';
import { makeClipRecord, openRepository, isQuotaError, StoreError } from '../../app/src/store/core.js';
import { MemBackend } from '../../app/src/store/mem.js';
import { hasChinese } from './store.fixtures.mjs';

const MB = 1024 * 1024;
const GB = 1024 * MB;
const clip = (id, mb, day, extra = {}) => ({ clip_id: id, shot_id: `shot-${id}`, bytes: mb * MB, created_at: `2026-10-${String(day).padStart(2, '0')}T00:00:00.000Z`, starred: false, kind: 'raw', ...extra });

// ---------------------------------------------------------------------------------------- planCleanup

test('under the limit: nothing to do', () => {
  const p = planCleanup({ usage: 5 * GB, quota: 10 * GB, clips: [clip('a', 100, 1)] });
  assert.equal(p.status, 'ok');
  assert.deepEqual(p.deleteIds, []);
  assert.equal(p.bytesToFree, 0);
  assert.equal(p.lowSpace, false);
  assert.deepEqual(p.msg, { code: 'storage.ok', params: {} });
  assert.equal('message' in p, false, 'no prose: the UI renders t(msg.code, msg.params)');
  assert.equal(DEFAULT_POLICY.highWater, 0.8);
});

test('over the limit: oldest unstarred raw clips go first, just enough to get below the low-water mark', () => {
  // quota 10 GB: high 8 GB, low 6 GB; usage 8.5 GB -> must free 2.5 GB
  const clips = [clip('c5', 700, 5), clip('c1', 900, 1), clip('c3', 800, 3), clip('c2', 900, 2), clip('c4', 600, 4)];
  const p = planCleanup({ usage: 8.5 * GB, quota: 10 * GB, clips });
  assert.equal(p.status, 'over');
  assert.equal(p.highBytes, 8 * GB);
  assert.equal(p.lowBytes, 6 * GB);
  assert.equal(p.bytesToFree, 2.5 * GB);
  assert.deepEqual(p.deleteIds, ['c1', 'c2', 'c3']); // 900+900+800 = 2600 MB >= 2560 MB
  assert.equal(p.freedBytes, 2600 * MB);
  assert.equal(p.satisfied, true);
  assert.equal(p.warnOnly, false);
  assert.deepEqual(p.msg, { code: 'storage.over_limit', params: { usedMb: Math.round(8.5 * 1024), n: 3, freedMb: 2600 } });
  // input is not modified
  assert.deepEqual(clips.map((c) => c.clip_id), ['c5', 'c1', 'c3', 'c2', 'c4']);
});

test('absolute thresholds', () => {
  const clips = [clip('a', 300, 1), clip('b', 300, 2), clip('c', 300, 3)];
  const p = planCleanup({ usage: 1000 * MB, quota: null, clips, highBytes: 800 * MB, lowBytes: 500 * MB });
  assert.equal(p.status, 'over');
  assert.equal(p.bytesToFree, 500 * MB);
  assert.deepEqual(p.deleteIds, ['a', 'b']);
  const q = planCleanup({ usage: 1000 * MB, quota: null, clips, highBytes: 800 * MB });
  assert.equal(q.lowBytes, 600 * MB); // default ratio 0.6 / 0.8
});

test('starred clips are never selected, even when they are the oldest or the only way to get space back', () => {
  const clips = [clip('old-starred', 5000, 1, { starred: true }), clip('b', 100, 2), clip('c', 100, 3)];
  const p = planCleanup({ usage: 9 * GB, quota: 10 * GB, clips });
  assert.deepEqual(p.deleteIds, ['b', 'c']);
  assert.equal(p.satisfied, false, 'not enough without the starred clip');
  assert.equal(p.freedBytes, 200 * MB);
  assert.equal(p.msg.code, 'storage.over_limit_unsatisfied');
  assert.deepEqual(p.msg.params, { usedMb: 9 * 1024, n: 2, freedMb: 200 });
  // clips of protected (starred) shots are kept too, via protectShotIds
  const p2 = planCleanup({ usage: 9 * GB, quota: 10 * GB, clips: [clip('b', 100, 2), clip('c', 100, 3)], protectShotIds: ['shot-b'] });
  assert.deepEqual(p2.deleteIds, ['c']);
  // `protected` flag
  assert.equal(isDeletableClip(clip('p', 1, 1, { protected: true }), new Set()), false);
});

test('only raw clips: shot data, poses and unknown kinds are never selected', () => {
  const clips = [
    { clip_id: 'pose-1', shot_id: 's', kind: 'pose', bytes: 900 * MB, created_at: '2026-01-01T00:00:00.000Z' },
    { clip_id: 'shot-1', shot_id: 's', kind: 'shot', bytes: 900 * MB, created_at: '2026-01-02T00:00:00.000Z' },
    { clip_id: 'thumb-1', shot_id: 's', kind: 'thumbnail', bytes: 900 * MB, created_at: '2026-01-03T00:00:00.000Z' },
    { shot_id: 'no-clip-id', kind: 'raw', bytes: 900 * MB, created_at: '2026-01-04T00:00:00.000Z' },
    { clip_id: '', kind: 'raw', bytes: 900 * MB, created_at: '2026-01-05T00:00:00.000Z' },
    { clip_id: 'zero', kind: 'raw', bytes: 0, created_at: '2026-01-06T00:00:00.000Z' },
    { clip_id: 'nan', kind: 'raw', bytes: NaN, created_at: '2026-01-07T00:00:00.000Z' },
    { clip_id: 'neg', kind: 'raw', bytes: -5, created_at: '2026-01-08T00:00:00.000Z' },
    null,
    'a string',
    clip('real', 50, 20),
  ];
  const p = planCleanup({ usage: 9 * GB, quota: 10 * GB, clips });
  assert.deepEqual(p.deleteIds, ['real']);
  assert.equal(p.satisfied, false);
  // a clip without `kind` is a raw clip
  assert.deepEqual(planCleanup({ usage: 9 * GB, quota: 10 * GB, clips: [{ clip_id: 'k', bytes: 4 * GB, created_at: 'a' }] }).deleteIds, ['k']);
});

test('property: for random inputs the plan only names unstarred raw clips, oldest first, with a minimal prefix', () => {
  const rng = mulberry32(1234);
  let overCount = 0;
  for (let t = 0; t < 300; t++) {
    const n = Math.floor(rng() * 12);
    const clips = [];
    for (let i = 0; i < n; i++) {
      const r = rng();
      clips.push({
        clip_id: `c${t}-${i}`,
        shot_id: `s${i % 4}`,
        bytes: Math.floor(rng() * 800) * MB,
        created_at: rng() < 0.1 ? undefined : `2026-${String(1 + Math.floor(rng() * 11)).padStart(2, '0')}-${String(1 + Math.floor(rng() * 28)).padStart(2, '0')}T00:00:00.000Z`,
        starred: rng() < 0.3,
        kind: r < 0.15 ? 'pose' : (r < 0.25 ? 'shot' : (r < 0.6 ? 'raw' : undefined)),
      });
    }
    const protect = rng() < 0.3 ? ['s1'] : [];
    const quota = 10 * GB;
    const usage = rng() * 12 * GB;
    const practiceActive = rng() < 0.15;
    const p = planCleanup({ usage, quota, clips, protectShotIds: protect, practiceActive });
    const byId = new Map(clips.map((c) => [c.clip_id, c]));
    for (const id of p.deleteIds) {
      const c = byId.get(id);
      assert.ok(c, 'only ids that were in the input');
      assert.ok(!c.starred, 'never starred');
      assert.ok(c.kind === undefined || c.kind === 'raw', 'only raw clips');
      assert.ok(!protect.includes(c.shot_id), 'never a protected shot');
      assert.ok(c.bytes > 0);
    }
    assert.equal(new Set(p.deleteIds).size, p.deleteIds.length);
    if (practiceActive || usage <= 8 * GB) assert.deepEqual(p.deleteIds, [], 'nothing deleted when ok or during practice');
    if (usage > 8 * GB) overCount++;
    if (p.status === 'over' && !practiceActive) {
      const chosen = p.deleteIds.map((id) => byId.get(id));
      for (let i = 1; i < chosen.length; i++) {
        const a = chosen[i - 1].created_at ?? '￿';
        const b = chosen[i].created_at ?? '￿';
        assert.ok(a <= b, 'oldest first');
      }
      const freed = chosen.reduce((s, c) => s + c.bytes, 0);
      assert.equal(freed, p.freedBytes);
      if (p.satisfied) {
        assert.ok(freed >= p.bytesToFree);
        if (chosen.length) assert.ok(freed - chosen.at(-1).bytes < p.bytesToFree, 'minimal prefix');
      } else {
        // everything deletable was taken
        const deletable = clips.filter((c) => isDeletableClip(c, new Set(protect)));
        assert.equal(p.deleteIds.length, deletable.length);
      }
    }
  }
  assert.ok(overCount > 50);
});

test('during a practice: warn only, delete nothing', () => {
  const p = planCleanup({ usage: 9 * GB, quota: 10 * GB, clips: [clip('a', 5000, 1)], practiceActive: true });
  assert.equal(p.status, 'over');
  assert.equal(p.warnOnly, true);
  assert.deepEqual(p.deleteIds, []);
  assert.deepEqual(p.msg, { code: 'storage.over_limit_practice', params: { usedMb: 9 * 1024 } });
});

test('unknown or invalid numbers: no plan, no deletion', () => {
  for (const input of [undefined, {}, { usage: 'x', quota: 5 }, { usage: 5, quota: undefined }, { usage: NaN, quota: 5 }, { usage: -1, quota: 5 }]) {
    const p = planCleanup(input);
    assert.equal(p.status, 'unknown');
    assert.deepEqual(p.deleteIds, []);
    assert.equal(p.msg.code, 'storage.unknown');
  }
});

test('lowSpace flag: less than 500 MiB free', () => {
  assert.equal(planCleanup({ usage: 9.7 * GB, quota: 10 * GB, clips: [] }).lowSpace, true);
  assert.equal(planCleanup({ usage: 1 * GB, quota: 10 * GB, clips: [] }).lowSpace, false);
  const p = planCleanup({ usage: 100 * MB, quota: 400 * MB, clips: [] });
  assert.equal(p.status, 'ok');
  assert.equal(p.lowSpace, true);
  assert.deepEqual(p.msg, { code: 'storage.low_free', params: { freeMb: 300, minMb: 500 } });
  assert.equal(planCleanup({ usage: 100 * MB, quota: 400 * MB, clips: [], minFreeBytes: 100 * MB }).lowSpace, false);
});

test('policyClips maps stored clip records without carrying the Blob', () => {
  const rec = makeClipRecord({ clip_id: 'c', shot_id: 's', session_id: 'x', created_at: 'd', blob: new Blob([new Uint8Array(1234)]), starred: true });
  const [info] = policyClips([rec, { clip_id: 'legacy', blob: { size: 7 } }]);
  assert.deepEqual(info, { clip_id: 'c', shot_id: 's', kind: 'raw', created_at: 'd', starred: true, bytes: 1234 });
  assert.equal(policyClips([{ clip_id: 'legacy', blob: { size: 7 } }])[0].bytes, 7);
  assert.equal(policyClips([{ clip_id: 'none' }])[0].bytes, 0);
  assert.equal('blob' in info, false);
});

// ------------------------------------------------------------------------------------ requestPersist

const fakeNav = ({ persisted = false, grant = true, persistThrows = false, estimate = { usage: 5, quota: 100 }, estimateThrows = false, hasPersisted = true } = {}) => {
  const calls = { persist: 0, persisted: 0, estimate: 0 };
  const storage = {
    persist: async () => { calls.persist++; if (persistThrows) throw new Error('denied by policy'); return grant; },
    estimate: async () => { calls.estimate++; if (estimateThrows) throw new Error('no estimate'); return estimate; },
  };
  if (hasPersisted) storage.persisted = async () => { calls.persisted++; return persisted; };
  return { nav: { storage }, calls };
};

test('requestPersist asks once when not persisted yet and reports usage and quota', async () => {
  const { nav, calls } = fakeNav({ persisted: false, grant: true });
  const r = await requestPersist(nav);
  assert.deepEqual(r, { supported: true, persisted: true, requested: true, usage: 5, quota: 100, error: null });
  assert.equal(calls.persist, 1);
  const denied = await requestPersist(fakeNav({ persisted: false, grant: false }).nav);
  assert.equal(denied.persisted, false);
  assert.equal(denied.requested, true);
});

test('requestPersist does not ask again when already persisted', async () => {
  const { nav, calls } = fakeNav({ persisted: true });
  const r = await requestPersist(nav);
  assert.equal(r.persisted, true);
  assert.equal(r.requested, false);
  assert.equal(calls.persist, 0);
});

test('requestPersist never throws, whatever the browser does', async () => {
  const cases = [
    undefined,
    null,
    {},
    { storage: null },
    { storage: {} },
    { storage: { persist: 'not a function' } },
    { storage: { persist: async () => true } },                 // no persisted(), no estimate()
    fakeNav({ persistThrows: true }).nav,
    fakeNav({ estimateThrows: true }).nav,
    fakeNav({ estimate: undefined }).nav,
    fakeNav({ estimate: { usage: 'a', quota: -1 } }).nav,
    fakeNav({ hasPersisted: false }).nav,
    { storage: { persist: () => { throw new Error('sync throw'); }, persisted: () => { throw new Error('sync throw'); } } },
    { get storage() { throw new Error('getter throws'); } },
  ];
  for (const nav of cases) {
    const r = await requestPersist(nav);
    assert.equal(typeof r.supported, 'boolean');
    assert.ok(r.persisted === true || r.persisted === false || r.persisted === null);
    assert.ok(r.usage === null || Number.isFinite(r.usage));
    const e = await estimateStorage(nav);
    assert.equal(typeof e.supported, 'boolean');
  }
  assert.equal((await requestPersist(fakeNav({ persistThrows: true }).nav)).error, 'denied by policy');
  assert.equal((await requestPersist(undefined)).supported === false || globalThis.navigator !== undefined, true);
  assert.deepEqual(await requestPersist({}), { supported: false, persisted: null, requested: false, usage: null, quota: null, error: null });
  // estimate still reported when persist fails
  const r = await requestPersist(fakeNav({ persistThrows: true }).nav);
  assert.equal(r.usage, 5);
  assert.equal(r.quota, 100);
});

// ------------------------------------------------------------------------- R2 / R7: full disk keeps the shot

const shotRec = (id) => ({ shot_id: id, session_id: 'sess', created_at: '2026-11-05T00:00:00.000Z', quality: { warnings: [] } });
const poseRec = (id, n = 100) => ({ shot_id: id, session_id: 'sess', created_at: '2026-11-05T00:00:00.000Z', img: new Float32Array(n) });
const clipRec = (id, bytes) => makeClipRecord({ clip_id: `clip-${id}`, shot_id: id, session_id: 'sess', created_at: '2026-11-05T00:00:00.000Z', blob: { size: bytes, type: 'video/mp4' } });

test('mem backend simulates a quota: an oversized readwrite transaction rolls back with QuotaExceededError', async () => {
  const backend = new MemBackend({ quotaBytes: 64 * 1024 });
  const repo = await openRepository(backend);
  await repo.put('shots', shotRec('a'));
  const used = backend.usageBytes();
  await assert.rejects(repo.batch([{ op: 'put', store: 'shots', record: shotRec('b') }, { op: 'put', store: 'clips', record: clipRec('b', 1e6) }]),
    (e) => e.name === 'QuotaExceededError' && isQuotaError(e));
  assert.equal(await repo.shots.get('b'), null, 'all-or-nothing');
  assert.equal(backend.usageBytes(), used);
});

test('saveShot: QuotaExceededError on a batch with a clip -> retried without clip, { ok, clipSaved:false, reason:CLIP_NOT_SAVED }, lowSpace', async () => {
  const backend = new MemBackend({ quotaBytes: 200 * 1024 });
  const repo = await openRepository(backend);
  let dropped = 0;
  const r = await repo.saveShot({
    shot: shotRec('s1'), pose: poseRec('s1'), clip: clipRec('s1', 5 * MB),
    onClipDropped: (s) => { dropped++; return { ...s, quality: { warnings: [...s.quality.warnings, 'CLIP_NOT_SAVED'] } }; },
  });
  assert.equal(r.ok, true);
  assert.equal(r.clipSaved, false);
  assert.equal(r.poseSaved, true);
  assert.equal(r.reason, 'CLIP_NOT_SAVED');
  assert.equal(r.lowSpace, true);
  assert.equal(dropped, 1);
  assert.deepEqual((await repo.shots.get('s1')).quality.warnings, ['CLIP_NOT_SAVED']);
  assert.ok(await repo.poses.get('s1'), 'the pose sequence is kept');
  assert.equal(await repo.clips.count(), 0);
  // with room, everything is saved
  const big = await openRepository(new MemBackend({ quotaBytes: 50 * MB }));
  const ok = await big.saveShot({ shot: shotRec('s2'), pose: poseRec('s2'), clip: clipRec('s2', 5 * MB) });
  assert.deepEqual({ ok: ok.ok, clipSaved: ok.clipSaved, poseSaved: ok.poseSaved, lowSpace: ok.lowSpace, reason: ok.reason }, { ok: true, clipSaved: true, poseSaved: true, lowSpace: false, reason: undefined });
});

test('saveShot: no room for the pose either -> the shot alone; no room at all -> ok:false QUOTA_EXCEEDED, nothing written', async () => {
  const repo = await openRepository(new MemBackend({ quotaBytes: 6 * 1024 }));
  const r = await repo.saveShot({ shot: shotRec('s1'), pose: poseRec('s1', 4000), clip: clipRec('s1', MB) });
  assert.deepEqual({ ok: r.ok, clipSaved: r.clipSaved, poseSaved: r.poseSaved, reason: r.reason }, { ok: true, clipSaved: false, poseSaved: false, reason: 'CLIP_NOT_SAVED' });
  assert.ok(await repo.shots.get('s1'));
  const none = await openRepository(new MemBackend({ quotaBytes: 10 }));
  const r2 = await none.saveShot({ shot: shotRec('s1'), pose: poseRec('s1'), clip: clipRec('s1', MB) });
  assert.equal(r2.ok, false);
  assert.equal(r2.error, 'QUOTA_EXCEEDED');
  assert.equal(await none.shots.count(), 0);
  // a non-quota failure is not swallowed
  await assert.rejects(repo.saveShot({ shot: { note: 'no id' } }), StoreError);
});

test('clipSpaceCheck / freeBytes (R7: check before each clip save)', () => {
  assert.equal(freeBytes({ usage: 1 * GB, quota: 3 * GB }), 2 * GB);
  assert.equal(freeBytes({ usage: null, quota: 3 * GB }), null);
  assert.deepEqual(clipSpaceCheck({ usage: 0, quota: 4 * MB }), { free: 4 * MB, lowSpace: true });
  assert.deepEqual(clipSpaceCheck({ usage: 1 * GB, quota: 10 * GB }), { free: 9 * GB, lowSpace: false });
  assert.equal(clipSpaceCheck({ usage: 1 * GB, quota: 1 * GB + 600 * MB }, { clipBytes: 200 * MB }).lowSpace, true);
  assert.deepEqual(clipSpaceCheck({ usage: null, quota: null }), { free: null, lowSpace: false }, 'unknown: keep saving');
});

test('estimateStorage resolves as unknown when estimate() hangs', async () => {
  const nav = { storage: { estimate: () => new Promise(() => {}) } };
  const t0 = Date.now();
  const r = await estimateStorage(nav, { timeoutMs: 50 });
  assert.deepEqual(r, { supported: true, usage: null, quota: null });
  assert.ok(Date.now() - t0 < 1000);
});
