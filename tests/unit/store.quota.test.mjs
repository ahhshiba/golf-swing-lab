import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../app/src/geom/rng.js';
import { planCleanup, requestPersist, estimateStorage, policyClips, isDeletableClip, DEFAULT_POLICY } from '../../app/src/store/quota.js';
import { makeClipRecord } from '../../app/src/store/core.js';
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
  assert.ok(hasChinese(p.message));
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
  assert.ok(hasChinese(p.message) && /匯出/.test(p.message) && /不會刪任何一球的數據或姿勢/.test(p.message));
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
  assert.ok(/仍不夠/.test(p.message) && hasChinese(p.message));
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
  assert.ok(/練習中/.test(p.message));
});

test('unknown or invalid numbers: no plan, no deletion', () => {
  for (const input of [undefined, {}, { usage: 'x', quota: 5 }, { usage: 5, quota: undefined }, { usage: NaN, quota: 5 }, { usage: -1, quota: 5 }]) {
    const p = planCleanup(input);
    assert.equal(p.status, 'unknown');
    assert.deepEqual(p.deleteIds, []);
    assert.ok(hasChinese(p.message));
  }
});

test('lowSpace flag: less than 500 MiB free', () => {
  assert.equal(planCleanup({ usage: 9.7 * GB, quota: 10 * GB, clips: [] }).lowSpace, true);
  assert.equal(planCleanup({ usage: 1 * GB, quota: 10 * GB, clips: [] }).lowSpace, false);
  const p = planCleanup({ usage: 100 * MB, quota: 400 * MB, clips: [] });
  assert.equal(p.status, 'ok');
  assert.equal(p.lowSpace, true);
  assert.ok(/停止錄製/.test(p.message));
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
