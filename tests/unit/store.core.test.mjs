import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../app/src/geom/rng.js';
import {
  openRepository, StoreError, STORE_DEFS, STORE_NAMES, makeClipRecord, filterShots, SCHEMA_VERSION, V1_STORE_NAMES, MIGRATIONS,
} from '../../app/src/store/core.js';
import { MemBackend } from '../../app/src/store/mem.js';
import { readdirSync, readFileSync } from 'node:fs';
import { RC } from '../../app/src/contract/reason-codes.js';
import { validateShot } from '../../app/src/contract/validate.js';
import { openMem, makeVenue, makePreset, makeSession, makeShot, makeDataset, fillRepo, hasChinese } from './store.fixtures.mjs';

// PRODUCT-SPEC §3.4: store errors carry a code (UI text = t('error.' + code)); the message is English developer detail
const rejectsStore = (p, code) => assert.rejects(p, (e) => e instanceof StoreError && e.code === code && typeof e.message === 'string' && e.message.length > 0 && !hasChinese(e.message));

test('schema declares the six v1 stores, the two v2 stores, the v3 trash store, the v4 drills store, the v5 rounds + lab stores and the required shot indexes', () => {
  assert.deepEqual([...STORE_NAMES], ['venues', 'presets', 'sessions', 'shots', 'poses', 'clips', 'labels', 'models', 'trash', 'drills', 'rounds', 'lab']);
  assert.deepEqual([...V1_STORE_NAMES], STORE_NAMES.slice(0, 6));
  assert.equal(SCHEMA_VERSION, 5);
  assert.equal(STORE_DEFS.trash.keyPath, 'shot_id');
  assert.deepEqual(MIGRATIONS.map((m) => m.version), [2, 3, 4, 5]);
  assert.equal(STORE_DEFS.rounds.keyPath, 'round_id');
  assert.deepEqual({ ...STORE_DEFS.rounds.indexes }, { created_at: 'created_at', status: 'status' });
  assert.equal(STORE_DEFS.lab.keyPath, 'shot_id');
  assert.deepEqual({ ...STORE_DEFS.lab.indexes }, { computed_at: 'computed_at', view: 'view' });
  assert.equal(STORE_DEFS.drills.keyPath, 'drill_id');
  assert.deepEqual({ ...STORE_DEFS.drills.indexes }, { created_at: 'created_at', template: 'template' });
  assert.equal(STORE_DEFS.labels.keyPath, 'shot_id');
  assert.equal(STORE_DEFS.models.keyPath, 'slot');
  const idx = STORE_DEFS.shots.indexes;
  assert.equal(idx.session_id, 'session_id');
  assert.equal(idx.preset_id, 'preset_id');
  assert.equal(idx.view, 'capture.view');
  assert.equal(idx.club_type, 'club.type');
  assert.equal(idx.created_at, 'created_at');
});

test('CRUD on every store (mem backend)', async () => {
  const repo = await openMem();
  const recs = {
    venues: makeVenue('v1'),
    presets: makePreset('p1'),
    sessions: makeSession('s1'),
    shots: makeShot({ id: 'sh1' }),
    poses: { shot_id: 'sh1', session_id: 's1', created_at: '2026-11-02T10:01:00.000Z', W: 1920, H: 1080, model: 'synthetic', t_s: new Float64Array([0, 1 / 60, 2 / 60]), img: new Float32Array(3 * 33 * 4).fill(0.5), world: new Float32Array(3 * 33 * 3) },
    clips: makeClipRecord({ clip_id: 'c1', shot_id: 'sh1', session_id: 's1', created_at: '2026-11-02T10:01:00.000Z', blob: new Blob([Uint8Array.of(1, 2, 3, 4)], { type: 'video/mp4' }) }),
  };
  for (const [store, rec] of Object.entries(recs)) {
    const key = STORE_DEFS[store].keyPath;
    assert.equal(await repo.get(store, rec[key]), null, `${store}: absent`);
    assert.equal(await repo.put(store, rec), rec[key]);
    const back = await repo.get(store, rec[key]);
    if (store === 'clips') {
      assert.deepEqual(Object.keys(back).sort(), Object.keys(rec).sort());
      assert.equal(back.blob.size, 4);
      assert.equal(back.blob.type, 'video/mp4');
      assert.deepEqual(new Uint8Array(await back.blob.arrayBuffer()), Uint8Array.of(1, 2, 3, 4));
    } else {
      assert.deepStrictEqual(back, rec, `${store}: round trip`); // typed arrays included
    }
    assert.equal(await repo.count(store), 1);
    // replace
    await repo.put(store, { ...rec, note: 'changed' });
    assert.equal((await repo.get(store, rec[key])).note, 'changed');
    assert.equal(await repo.count(store), 1);
    await repo.delete(store, rec[key]);
    assert.equal(await repo.get(store, rec[key]), null);
    assert.equal(await repo.count(store), 0);
  }
  // per-store shortcuts
  await repo.shots.put(makeShot({ id: 'x' }));
  assert.equal((await repo.shots.get('x')).shot_id, 'x');
  assert.equal(await repo.shots.count(), 1);
  await repo.shots.delete('x');
  assert.deepEqual(await repo.shots.list(), []);
});

test('list returns key order; limit and reverse work', async () => {
  const repo = await openMem();
  for (const id of ['b', 'c', 'a', 'd']) await repo.venues.put(makeVenue(id));
  assert.deepEqual((await repo.venues.list()).map((v) => v.venue_id), ['a', 'b', 'c', 'd']);
  assert.deepEqual((await repo.venues.list({ reverse: true, limit: 2 })).map((v) => v.venue_id), ['d', 'c']);
});

test('bad input is rejected with a coded StoreError (English detail, no prose for the UI)', async () => {
  const repo = await openMem();
  await rejectsStore(repo.put('shots', { note: 'no key' }), 'BAD_RECORD');
  await rejectsStore(repo.put('shots', { shot_id: '' }), 'BAD_RECORD');
  await rejectsStore(repo.put('shots', { shot_id: 7 }), 'BAD_RECORD');
  await rejectsStore(repo.put('shots', null), 'BAD_RECORD');
  await rejectsStore(repo.put('nope', { shot_id: 'a' }), 'BAD_STORE');
  await rejectsStore(repo.get('nope', 'a'), 'BAD_STORE');
  await rejectsStore(repo.list('shots', { index: 'no_such_index' }), 'BAD_QUERY');
  await rejectsStore(repo.list('shots', { query: 'x' }), 'BAD_QUERY');
  await rejectsStore(repo.list('shots', { index: 'preset_id', query: { gte: {} } }), 'BAD_QUERY');
  await rejectsStore(repo.queryShots({ presetId: 'typo' }), 'BAD_QUERY');
  assert.equal(await repo.count('shots'), 0);
});

test('stored records are clones: mutating a result does not change the store', async () => {
  const repo = await openMem();
  const shot = makeShot({ id: 's' });
  await repo.shots.put(shot);
  shot.note = 'mutated after put';
  const a = await repo.shots.get('s');
  assert.equal(a.note, '');
  a.metrics.tempo_ratio.value = 99;
  assert.notEqual((await repo.shots.get('s')).metrics.tempo_ratio.value, 99);
});

test('indexes: session_id, preset_id, capture.view, club.type, created_at', async () => {
  const repo = await openMem();
  const ds = await fillRepo(repo);
  const ids = (rows) => rows.map((r) => r.shot_id);
  assert.deepEqual(ids(await repo.shots.list({ index: 'session_id', query: 'session-1' })), ['shot-1', 'shot-2']);
  assert.deepEqual(ids(await repo.shots.list({ index: 'session_id', query: 'session-2' })), ['shot-3', 'shot-4']);
  assert.deepEqual(ids(await repo.shots.list({ index: 'preset_id', query: 'preset-B' })), ['shot-3', 'shot-4']);
  assert.deepEqual(ids(await repo.shots.list({ index: 'view', query: 'dtl' })), ['shot-3', 'shot-4']);
  assert.deepEqual(ids(await repo.shots.list({ index: 'view', query: 'face_on' })), ['shot-1', 'shot-2']);
  assert.deepEqual(ids(await repo.shots.list({ index: 'club_type', query: 'driver' })), ['shot-2']);
  assert.deepEqual(ids(await repo.shots.list({ index: 'club_type', query: '7i' })), ['shot-1', 'shot-3']);
  assert.deepEqual(ids(await repo.shots.list({ index: 'club_type', query: 'wedge' })), []);
  // created_at: full order and ranges
  assert.deepEqual(ids(await repo.shots.list({ index: 'created_at' })), ds.shots.map((s) => s.shot_id));
  assert.deepEqual(ids(await repo.shots.list({ index: 'created_at', query: { gte: '2026-11-02T10:02:00.000Z', lt: '2026-11-03T10:02:00.000Z' } })), ['shot-2', 'shot-3']);
  assert.deepEqual(ids(await repo.shots.list({ index: 'created_at', query: { gt: '2026-11-03T10:01:00.000Z' } })), ['shot-4']);
  assert.deepEqual(ids(await repo.shots.list({ index: 'created_at', query: { lte: '2026-11-02T10:01:00.000Z' } })), ['shot-1']);
  // index order is index key first, then primary key
  assert.deepEqual(ids(await repo.shots.list({ index: 'club_type' })), ['shot-4', 'shot-1', 'shot-3', 'shot-2']); // '5w' < '7i' < 'driver'
  // other stores
  assert.deepEqual((await repo.presets.list({ index: 'view', query: 'dtl' })).map((p) => p.preset_id), ['preset-B']);
  assert.deepEqual((await repo.sessions.list({ index: 'venue_id', query: 'venue-1' })).length, 2);
});

test('a record without the indexed field is simply absent from that index', async () => {
  const repo = await openMem();
  const shot = makeShot({ id: 'plain' });
  delete shot.club;
  await repo.shots.put(shot);
  assert.deepEqual(await repo.shots.list({ index: 'club_type' }), []);
  assert.equal((await repo.shots.list()).length, 1);
});

test('queryShots matches a brute-force filter for 300 random filters', async () => {
  const rng = mulberry32(20261104);
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const repo = await openMem();
  const shots = [];
  for (let i = 0; i < 60; i++) {
    shots.push(makeShot({
      id: `s${String(i).padStart(3, '0')}`,
      session_id: pick(['sa', 'sb', 'sc']), preset_id: pick(['p1', 'p2', 'p3']), venue_id: pick(['v1', 'v2']),
      view: pick(['face_on', 'dtl', 'high_behind']), club_type: pick(['7i', 'driver', '5w']), lie: pick(['mat', 'tee']),
      created_at: `2026-11-${String(1 + Math.floor(rng() * 20)).padStart(2, '0')}T0${Math.floor(rng() * 9)}:00:00.000Z`,
      starred: rng() < 0.3, seed: i,
    }));
  }
  await repo.putMany('shots', shots);
  const days = ['2026-11-03T00:00:00.000Z', '2026-11-10T00:00:00.000Z', '2026-11-15T12:00:00.000Z'];
  let nonEmpty = 0;
  for (let n = 0; n < 300; n++) {
    const f = {};
    if (rng() < 0.4) f.session_id = rng() < 0.3 ? ['sa', 'sb'] : pick(['sa', 'sb', 'sc']);
    if (rng() < 0.4) f.preset_id = pick(['p1', 'p2', 'p3']);
    if (rng() < 0.3) f.venue_id = pick(['v1', 'v2']);
    if (rng() < 0.4) f.view = pick(['face_on', 'dtl', 'high_behind']);
    if (rng() < 0.4) f.club_type = rng() < 0.3 ? ['7i', '5w'] : pick(['7i', 'driver', '5w']);
    if (rng() < 0.2) f.lie = pick(['mat', 'tee']);
    if (rng() < 0.3) f.from = pick(days);
    if (rng() < 0.3) f.to = pick(days);
    if (rng() < 0.2) f.starred = rng() < 0.5;
    const got = await repo.queryShots(f);
    const want = filterShots(shots, f);
    assert.deepEqual(got.map((s) => s.shot_id), want.map((s) => s.shot_id), JSON.stringify(f));
    if (got.length) nonEmpty++;
    // independent brute force of the same semantics
    const brute = shots.filter((s) => {
      const any = (w, h) => w === undefined || (Array.isArray(w) ? w.includes(h) : w === h);
      return any(f.session_id, s.session_id) && any(f.preset_id, s.preset_id) && any(f.venue_id, s.venue_id) &&
        any(f.view, s.capture.view) && any(f.club_type, s.club.type) && any(f.lie, s.club.lie) &&
        (f.starred === undefined || s.starred === f.starred) &&
        (f.from === undefined || s.created_at >= f.from) && (f.to === undefined || s.created_at <= f.to);
    }).sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.shot_id < b.shot_id ? -1 : 1));
    assert.deepEqual(got.map((s) => s.shot_id), brute.map((s) => s.shot_id), `brute ${JSON.stringify(f)}`);
  }
  assert.ok(nonEmpty > 100, `only ${nonEmpty} non-empty results; filters too selective to mean anything`);
  const lim = await repo.queryShots({ limit: 5, reverse: true });
  assert.equal(lim.length, 5);
  assert.ok(lim[0].created_at >= lim[4].created_at);
});

test('readwrite transaction rolls back when fn throws; readonly cannot write', async () => {
  const repo = await openMem();
  await repo.venues.put(makeVenue('keep'));
  await assert.rejects(
    repo.transaction(['venues', 'shots'], 'readwrite', async (tx) => {
      await tx.put('venues', makeVenue('new'));
      await tx.delete('venues', 'keep');
      await tx.put('shots', makeShot({ id: 'new' }));
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.deepEqual((await repo.venues.list()).map((v) => v.venue_id), ['keep']);
  assert.equal(await repo.shots.count(), 0);
  await rejectsStore(repo.transaction(['venues'], 'readonly', (tx) => tx.put('venues', makeVenue('x'))), 'READONLY');
  await rejectsStore(repo.transaction(['venues'], 'readwrite', (tx) => tx.get('shots', 'x')), 'BAD_STORE');
  // a leaked tx handle is dead
  let leaked;
  await repo.transaction(['venues'], 'readonly', (tx) => { leaked = tx; });
  await assert.rejects(leaked.get('venues', 'keep'), (e) => e instanceof StoreError && e.code === 'CLOSED');
});

test('concurrent read-modify-write transactions do not lose updates', async () => {
  const repo = await openMem();
  await repo.sessions.put({ ...makeSession('counter'), n: 0 });
  await Promise.all(Array.from({ length: 25 }, () =>
    repo.transaction(['sessions'], 'readwrite', async (tx) => {
      const cur = await tx.get('sessions', 'counter');
      await tx.put('sessions', { ...cur, n: cur.n + 1 });
    })));
  assert.equal((await repo.sessions.get('counter')).n, 25);
});

test('batch is all-or-nothing', async () => {
  const repo = await openMem();
  await repo.venues.put(makeVenue('v0'));
  const n = await repo.batch([
    { op: 'put', store: 'venues', record: makeVenue('v1') },
    { op: 'put', store: 'shots', record: makeShot({ id: 'a' }) },
    { op: 'delete', store: 'venues', id: 'v0' },
  ]);
  assert.equal(n, 3);
  assert.deepEqual((await repo.venues.list()).map((v) => v.venue_id), ['v1']);
  // one bad record: nothing written, including the good ones before it
  await rejectsStore(repo.batch([
    { op: 'put', store: 'venues', record: makeVenue('v2') },
    { op: 'put', store: 'shots', record: { note: 'no key' } },
  ]), 'BAD_RECORD');
  assert.deepEqual((await repo.venues.list()).map((v) => v.venue_id), ['v1']);
  await rejectsStore(repo.batch([{ op: 'frobnicate', store: 'venues' }]), 'BAD_QUERY');
  assert.equal(await repo.batch([]), 0);
});

test('merge: added / updated / kept by revision, ties keep the stored record', async () => {
  const repo = await openMem();
  await repo.shots.put(makeShot({ id: 'same', revision: 2, note: 'stored' }));
  await repo.shots.put(makeShot({ id: 'older', revision: 5, note: 'stored' }));
  await repo.shots.put(makeShot({ id: 'newer', revision: 1, note: 'stored' }));
  const counts = await repo.merge({
    shots: [
      makeShot({ id: 'same', revision: 2, note: 'incoming' }),
      makeShot({ id: 'older', revision: 4, note: 'incoming' }),
      makeShot({ id: 'newer', revision: 2, note: 'incoming' }),
      makeShot({ id: 'brand-new', revision: 0, note: 'incoming' }),
    ],
    venues: [makeVenue('v1')],
  });
  assert.deepEqual(counts.shots, { added: 1, updated: 1, kept: 2 });
  assert.deepEqual(counts.venues, { added: 1, updated: 0, kept: 0 });
  const note = async (id) => (await repo.shots.get(id)).note;
  assert.equal(await note('same'), 'stored');
  assert.equal(await note('older'), 'stored');
  assert.equal(await note('newer'), 'incoming');
  assert.equal(await note('brand-new'), 'incoming');
  // missing revision counts as 0
  const s = makeShot({ id: 'norev' });
  delete s.revision;
  await repo.shots.put(s);
  const c2 = await repo.merge({ shots: [makeShot({ id: 'norev', revision: 1, note: 'x' })] });
  assert.deepEqual(c2.shots, { added: 0, updated: 1, kept: 0 });
  // a failing merge writes nothing
  await rejectsStore(repo.merge({ shots: [makeShot({ id: 'never' }), { note: 'no key' }] }), 'BAD_RECORD');
  assert.equal(await repo.shots.get('never'), null);
});

test('deleteShot removes the shot with its pose and clips only', async () => {
  const repo = await openMem();
  await fillRepo(repo);
  await repo.poses.put({ shot_id: 'shot-1', session_id: 'session-1', created_at: 'x', t_s: new Float64Array(2) });
  await repo.poses.put({ shot_id: 'shot-2', session_id: 'session-1', created_at: 'x', t_s: new Float64Array(2) });
  const blob = new Blob(['abc']);
  await repo.clips.put(makeClipRecord({ clip_id: 'c1', shot_id: 'shot-1', session_id: 'session-1', created_at: 'x', blob }));
  await repo.clips.put(makeClipRecord({ clip_id: 'c2', shot_id: 'shot-1', session_id: 'session-1', created_at: 'y', blob }));
  await repo.clips.put(makeClipRecord({ clip_id: 'c3', shot_id: 'shot-2', session_id: 'session-1', created_at: 'z', blob }));
  assert.deepEqual(await repo.deleteShot('shot-1'), { shot: true, pose: true, clips: 2 });
  assert.equal(await repo.shots.get('shot-1'), null);
  assert.equal(await repo.poses.get('shot-1'), null);
  assert.deepEqual((await repo.clips.list()).map((c) => c.clip_id), ['c3']);
  assert.notEqual(await repo.poses.get('shot-2'), null);
  assert.equal(await repo.shots.count(), 3);
  assert.deepEqual(await repo.deleteShot('shot-1'), { shot: false, pose: false, clips: 0 });
});

test('clips: Blob round trip and lookup by shot_id', async () => {
  const repo = await openMem();
  const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
  const rec = makeClipRecord({ clip_id: 'c1', shot_id: 'sh', session_id: 's', created_at: '2026-11-02T00:00:00.000Z', blob: new Blob([bytes], { type: 'video/mp4' }), starred: true });
  assert.equal(rec.bytes, 1000);
  assert.equal(rec.kind, 'raw');
  assert.equal(rec.mime, 'video/mp4');
  await repo.clips.put(rec);
  const [back] = await repo.clips.list({ index: 'shot_id', query: 'sh' });
  assert.equal(back.starred, true);
  assert.deepEqual(new Uint8Array(await back.blob.arrayBuffer()), bytes);
  assert.deepEqual(await repo.clips.list({ index: 'shot_id', query: 'other' }), []);
});

test('clear one store or all', async () => {
  const repo = await openMem();
  await fillRepo(repo);
  await repo.clear('shots');
  assert.equal(await repo.shots.count(), 0);
  assert.equal(await repo.venues.count(), 1);
  await repo.clear();
  for (const n of STORE_NAMES) assert.equal(await repo.count(n), 0, n);
});

test('migration hook: runs once, in version order, only for versions above the stored one', async () => {
  const backend = new MemBackend();
  const v1 = await openRepository(backend, { version: 1, stores: Object.fromEntries(V1_STORE_NAMES.map((n) => [n, STORE_DEFS[n]])) });
  assert.equal(v1.schemaVersion, 1);
  assert.equal(v1.openedFromVersion, 0);
  await fillRepo(v1);
  await v1.close();

  const calls = [];
  const migrations = [
    { version: 3, up: async (tx, info) => { calls.push(['3', info.oldVersion, info.newVersion]); const all = await tx.getAll('shots'); for (const s of all) await tx.put('shots', { ...s, migrated3: true }); } },
    { version: 2, up: async (tx, info) => { calls.push(['2', info.oldVersion, info.newVersion]); const all = await tx.getAll('shots'); for (const s of all) await tx.put('shots', { ...s, migrated2: true }); } },
    { version: 4, up: async () => { calls.push(['4']); } }, // above the target: must not run
  ];
  const stores = { ...STORE_DEFS, shots: { ...STORE_DEFS.shots, indexes: { ...STORE_DEFS.shots.indexes, lie: 'club.lie' } } };
  const v3 = await openRepository(backend, { version: 3, migrations, stores });
  assert.deepEqual(calls, [['2', 1, 3], ['3', 1, 3]]);
  assert.equal(v3.openedFromVersion, 1);
  assert.equal(backend.version, 3);
  const shots = await v3.shots.list();
  assert.equal(shots.length, 4);
  assert.ok(shots.every((s) => s.migrated2 && s.migrated3));
  assert.deepEqual((await v3.shots.list({ index: 'lie', query: 'tee' })).map((s) => s.shot_id), ['shot-2']);
  await v3.close();

  // reopening at the same version does not migrate again
  calls.length = 0;
  await openRepository(backend, { version: 3, migrations, stores });
  assert.deepEqual(calls, []);
});

test('a failing migration leaves the old database untouched', async () => {
  const backend = new MemBackend();
  const v1 = await openRepository(backend, { version: 1, stores: Object.fromEntries(V1_STORE_NAMES.map((n) => [n, STORE_DEFS[n]])) });
  await fillRepo(v1);
  await v1.close();
  const bad = [{ version: 2, up: async (tx) => { await tx.clear('shots'); throw new Error('migration bug'); } }];
  await assert.rejects(openRepository(backend, { version: 2, migrations: bad }), (e) => e instanceof StoreError && e.code === 'BACKEND' && /migration bug/.test(e.message));
  assert.equal(backend.version, 1);
  const again = await openRepository(backend, { version: 1, stores: Object.fromEntries(V1_STORE_NAMES.map((n) => [n, STORE_DEFS[n]])) });
  assert.equal(await again.shots.count(), 4);
});

test('opening an older app version on a newer database is refused with VERSION_NEWER', async () => {
  const backend = new MemBackend();
  const v2 = await openRepository(backend, { version: 2 });
  await v2.venues.put(makeVenue('v'));
  await v2.close();
  await rejectsStore(openRepository(backend, { version: 1 }), 'VERSION_NEWER');
  const back = await openRepository(backend, { version: 2 });
  assert.equal(await back.venues.count(), 1);
});

test('operations after close are refused', async () => {
  const repo = await openMem();
  await repo.close();
  await rejectsStore(repo.get('shots', 'a'), 'CLOSED');
});

test('dataset fixture is JSON-safe (no undefined) so export round trips can compare exactly', () => {
  const ds = makeDataset();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ds)), ds);
});

test('v1 -> current upgrade (real MIGRATIONS): every v1 record stays readable, labels, models and trash appear empty', async () => {
  const backend = new MemBackend();
  const v1 = await openRepository(backend, { version: 1, stores: Object.fromEntries(V1_STORE_NAMES.map((n) => [n, STORE_DEFS[n]])) });
  await fillRepo(v1);
  const before = {};
  for (const n of V1_STORE_NAMES) before[n] = await v1.list(n);
  await v1.close();
  assert.ok(MIGRATIONS.some((m) => m.version === 2));
  const v2 = await openRepository(backend);
  assert.equal(v2.schemaVersion, SCHEMA_VERSION);
  assert.equal(v2.openedFromVersion, 1);
  for (const n of V1_STORE_NAMES) assert.deepStrictEqual(await v2.list(n), before[n], n);
  assert.equal(await v2.labels.count(), 0);
  assert.equal(await v2.models.count(), 0);
  assert.equal(await v2.trash.count(), 0);
  await v2.labels.put({ shot_id: 'shot-1', events: {}, labelled_at: '2026-11-04T00:00:00Z', source: 'owner', revision: 0, fps: 60 });
  await v2.models.put({ slot: 'active', imported_at: '2026-11-04T00:00:00Z', json: {}, bin: new ArrayBuffer(4) });
  assert.equal((await v2.labels.get('shot-1')).source, 'owner');
  assert.equal((await v2.models.get('active')).bin.byteLength, 4);
});

// ------------------------------------------------------------------ PRODUCT-SPEC §8.0.8 repo additions (platform)

test('v2 -> v3: a v2 database keeps every record and gains an empty trash store', async () => {
  const backend = new MemBackend();
  const names = STORE_NAMES.filter((n) => n !== 'trash');
  const v2 = await openRepository(backend, { version: 2, stores: Object.fromEntries(names.map((n) => [n, STORE_DEFS[n]])) });
  await fillRepo(v2);
  const before = {};
  for (const n of names) before[n] = await v2.list(n);
  await v2.close();
  const v3 = await openRepository(backend);
  assert.equal(v3.openedFromVersion, 2);
  for (const n of names) assert.deepStrictEqual(await v3.list(n), before[n], n);
  assert.equal(await v3.trash.count(), 0);
});

// ------------------------------------------------------------------ LAUNCH-MONITOR-SPEC §2.1 / §5.0-7 (LM-A drop 1)

const V1_FIXTURES = readdirSync(new URL('../fixtures/shots/', import.meta.url)).filter((f) => /^valid_.*\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(new URL(`../fixtures/shots/${f}`, import.meta.url), 'utf8')));

test('v3 -> v4: a v3 database opens with an empty drills store; a stored golf-shot/1 shot reads back as golf-shot/2', async () => {
  const backend = new MemBackend();
  const names = STORE_NAMES.filter((n) => !['drills', 'rounds', 'lab'].includes(n));
  const v3 = await openRepository(backend, { version: 3, stores: Object.fromEntries(names.map((n) => [n, STORE_DEFS[n]])) });
  assert.ok(V1_FIXTURES.length >= 4 && V1_FIXTURES.every((s) => s.schema === 'golf-shot/1'));
  await v3.putMany('shots', V1_FIXTURES);
  await v3.close();
  const v4 = await openRepository(backend, { version: 4, stores: Object.fromEntries([...names, 'drills'].map((n) => [n, STORE_DEFS[n]])) });
  assert.equal(v4.schemaVersion, 4);
  assert.equal(v4.openedFromVersion, 3);
  assert.equal(await v4.drills.count(), 0);
  // the upgrade itself rewrites nothing (no long transaction): the raw records are still golf-shot/1
  assert.ok((await v4.list('shots')).every((s) => s.schema === 'golf-shot/1'));
  const one = await v4.shots.get(V1_FIXTURES[0].shot_id);
  assert.equal(one.schema, 'golf-shot/2');
  assert.equal(validateShot(one).ok, true, JSON.stringify(validateShot(one).errors.slice(0, 3)));
  assert.deepEqual(one.metrics.spin_rate_rpm.reason_codes, [RC.MIGRATED_V1]);
  assert.deepEqual(one.algorithms.lm, { version: 'none', sha256: '140bedbf9c3f6d56a9846d2ba7088798683f4da0c248231336e6a05679e4fdfe' });
  for (const s of [...await v4.shots.list(), ...await v4.queryShots({})]) {
    assert.equal(s.schema, 'golf-shot/2');
    assert.equal(validateShot(s).ok, true, s.shot_id);
  }
  // background write-back in batches (one short transaction each)
  const r1 = await v4.migrateBatch(2);
  assert.deepEqual(r1, { migrated: 2, remaining: V1_FIXTURES.length - 2 });
  let r = r1;
  while (r.remaining > 0) r = await v4.migrateBatch(2);
  assert.deepEqual(await v4.migrateBatch(), { migrated: 0, remaining: 0 });
  const raw = await v4.list('shots');
  assert.ok(raw.every((s) => s.schema === 'golf-shot/2'));
  assert.deepStrictEqual(raw, await v4.shots.list(), 'written back = what the read-time migration returned');
});

// ------------------------------------------------------------------ V04-SPEC §F.2 (V4-A drop 1): schema 5

test('v4 -> v5: a v4 database keeps every shot and drill (counts unchanged) and gains empty rounds + lab stores', async () => {
  const backend = new MemBackend();
  const names = STORE_NAMES.filter((n) => !['rounds', 'lab'].includes(n));
  const v4 = await openRepository(backend, { version: 4, stores: Object.fromEntries(names.map((n) => [n, STORE_DEFS[n]])) });
  await fillRepo(v4);
  await v4.drills.put({ drill_id: 'd1', template: 'gapping', created_at: '2026-11-06T10:00:00.000Z', slots: [] });
  await v4.drills.put({ drill_id: 'd2', template: 'distance18', created_at: '2026-11-06T11:00:00.000Z', slots: [] });
  const before = {};
  for (const n of names) before[n] = await v4.list(n);
  const nShots = await v4.shots.count();
  const nDrills = await v4.drills.count();
  await v4.close();
  const v5 = await openRepository(backend);
  assert.equal(v5.schemaVersion, 5);
  assert.equal(v5.openedFromVersion, 4);
  assert.equal(await v5.shots.count(), nShots);
  assert.equal(await v5.drills.count(), nDrills);
  for (const n of names) assert.deepStrictEqual(await v5.list(n), before[n], n);
  assert.equal(await v5.rounds.count(), 0);
  assert.equal(await v5.lab.count(), 0);
});

test('rounds store: get / put / list by created_at and status / delete', async () => {
  const repo = await openMem();
  const r = (id, status, at) => ({ schema: 'golf-round/1', round_id: id, status, created_at: at, updated_at: at, strokes: [] });
  await repo.rounds.put(r('r1', 'active', '2026-11-07T10:00:00.000Z'));
  await repo.rounds.put(r('r2', 'finished', '2026-11-07T09:00:00.000Z'));
  assert.equal((await repo.rounds.get('r1')).status, 'active');
  assert.deepEqual((await repo.rounds.list({ index: 'created_at' })).map((x) => x.round_id), ['r2', 'r1']);
  assert.deepEqual((await repo.rounds.list({ index: 'status', query: 'active' })).map((x) => x.round_id), ['r1']);
  await repo.rounds.delete('r1');
  assert.equal(await repo.rounds.get('r1'), null);
  await rejectsStore(repo.rounds.put({ status: 'active' }), 'BAD_RECORD');
});

test('lab store: get / put / list by view; deleteStale(version) drops other algorithm versions only', async () => {
  const repo = await openMem();
  const l = (id, view, version, at) => ({ shot_id: id, view, algo: { version, sha256: 'x' }, faults: [], computed_at: at });
  await repo.lab.put(l('a', 'dtl', 'lab-1', '2026-11-07T10:00:00.000Z'));
  await repo.lab.put(l('b', 'face_on', 'lab-0', '2026-11-07T09:00:00.000Z'));
  await repo.lab.put(l('c', 'dtl', 'lab-1', '2026-11-07T11:00:00.000Z'));
  assert.deepEqual((await repo.lab.list({ index: 'view', query: 'dtl' })).map((x) => x.shot_id), ['a', 'c']);
  assert.equal(await repo.lab.deleteStale('lab-1'), 1);
  assert.deepEqual((await repo.lab.list()).map((x) => x.shot_id), ['a', 'c']);
  assert.equal((await repo.lab.get('a')).view, 'dtl');
});

test('drills store: put / get / list by created_at and template', async () => {
  const repo = await openMem();
  const d = (id, template, at) => ({ drill_id: id, template, created_at: at, slots: [] });
  await repo.drills.put(d('d1', 'distance18', '2026-11-06T10:00:00.000Z'));
  await repo.drills.put(d('d2', 'gapping', '2026-11-06T09:00:00.000Z'));
  assert.equal((await repo.drills.get('d1')).template, 'distance18');
  assert.deepEqual((await repo.drills.list({ index: 'created_at' })).map((x) => x.drill_id), ['d2', 'd1']);
  assert.deepEqual((await repo.drills.list({ index: 'template', query: 'gapping' })).map((x) => x.drill_id), ['d2']);
  await rejectsStore(repo.drills.put({ template: 'x' }), 'BAD_RECORD');
});

test('soft delete moves the shot to the trash unchanged; restore brings it back; list({ includeDeleted })', async () => {
  const repo = await openMem();
  await fillRepo(repo);
  const all = await repo.shots.list();
  const victim = all[1];
  await repo.put('clips', makeClipRecord({ clip_id: 'c-v', shot_id: victim.shot_id, session_id: victim.session_id, created_at: victim.created_at, blob: { size: 10 } }));
  const r = await repo.shots.softDelete(victim.shot_id, { at: '2026-11-05T01:00:00.000Z' });
  assert.deepEqual(r, { ok: true, deleted_at: '2026-11-05T01:00:00.000Z' });
  assert.equal((await repo.shots.list()).length, all.length - 1);
  assert.equal(await repo.shots.get(victim.shot_id), null);
  assert.equal((await repo.queryShots({})).some((s) => s.shot_id === victim.shot_id), false, 'queries never see trashed shots');
  const withDeleted = await repo.shots.list({ includeDeleted: true });
  assert.equal(withDeleted.length, all.length);
  assert.deepStrictEqual(withDeleted.find((s) => s.shot_id === victim.shot_id), victim, 'the stored shot is not modified');
  assert.equal((await repo.list('clips', { index: 'shot_id', query: victim.shot_id })).length, 1, 'clips stay until purge');
  assert.deepEqual((await repo.shots.listDeleted()).map((t) => t.shot_id), [victim.shot_id]);
  assert.deepEqual(await repo.shots.softDelete('nope', { at: '2026-11-05T01:00:00.000Z' }), { ok: false, deleted_at: null });
  assert.deepEqual(await repo.shots.restore(victim.shot_id), { ok: true });
  assert.deepStrictEqual(await repo.shots.get(victim.shot_id), victim);
  assert.equal(await repo.trash.count(), 0);
  assert.deepEqual(await repo.shots.restore(victim.shot_id), { ok: false });
  // a backend without a clock needs an explicit time
  await rejectsStore(repo.shots.softDelete(victim.shot_id), 'BAD_RECORD');
});

test('purgeDeleted removes trashed shots with their pose, clips and label; olderThanMs keeps recent ones', async () => {
  const repo = await openMem();
  const shots = [makeShot({ id: 'a', created_at: '2026-11-01T00:00:00.000Z' }), makeShot({ id: 'b', created_at: '2026-11-02T00:00:00.000Z' }), makeShot({ id: 'c', created_at: '2026-11-03T00:00:00.000Z' })];
  for (const s of shots) {
    await repo.shots.put(s);
    await repo.put('poses', { shot_id: s.shot_id, session_id: s.session_id, created_at: s.created_at });
    await repo.put('clips', makeClipRecord({ clip_id: `clip-${s.shot_id}`, shot_id: s.shot_id, session_id: s.session_id, created_at: s.created_at, blob: { size: 5 } }));
    await repo.labels.put({ shot_id: s.shot_id, events: {}, labelled_at: s.created_at, source: 'owner', revision: 0, fps: 60 });
  }
  await repo.shots.softDelete(shots[0].shot_id, { at: '2026-11-01T00:00:00.000Z' });
  await repo.shots.softDelete(shots[1].shot_id, { at: '2026-11-05T00:00:00.000Z' });
  await rejectsStore(repo.shots.purgeDeleted({ olderThanMs: 1000 }), 'BAD_QUERY'); // no clock in the mem backend
  const r1 = await repo.shots.purgeDeleted({ olderThanMs: 2 * 86400000, now: '2026-11-05T12:00:00.000Z' });
  assert.deepEqual(r1, { purged: 1, clips: 1 });
  assert.equal(await repo.poses.get(shots[0].shot_id), null);
  assert.equal(await repo.labels.get(shots[0].shot_id), null);
  assert.equal(await repo.clips.get(`clip-${shots[0].shot_id}`), null);
  assert.ok(await repo.poses.get(shots[1].shot_id), 'recent trash keeps its pose');
  const r2 = await repo.shots.purgeDeleted();
  assert.deepEqual(r2, { purged: 1, clips: 1 });
  assert.equal(await repo.trash.count(), 0);
  assert.ok(await repo.shots.get(shots[2].shot_id), 'live shots are never purged');
  assert.ok(await repo.clips.get(`clip-${shots[2].shot_id}`));
});

test('setStar flags the shot (revision + 1) and its clips; labels.unlabelledWithClips lists the teach queue', async () => {
  const repo = await openMem();
  const a = makeShot({ id: 'a', created_at: '2026-11-01T00:00:00.000Z' });
  const b = makeShot({ id: 'b', created_at: '2026-11-02T00:00:00.000Z' });
  const c = makeShot({ id: 'c', created_at: '2026-11-03T00:00:00.000Z' });
  for (const s of [a, b, c]) await repo.shots.put(s);
  for (const s of [a, b]) await repo.put('clips', makeClipRecord({ clip_id: `clip-${s.shot_id}`, shot_id: s.shot_id, session_id: s.session_id, created_at: s.created_at, blob: { size: 5 } }));
  assert.deepEqual(await repo.shots.setStar(a.shot_id, true), { ok: true, starred: true });
  const sa = await repo.shots.get(a.shot_id);
  assert.equal(sa.starred, true);
  assert.equal(sa.revision, (a.revision ?? 0) + 1);
  assert.equal((await repo.clips.get(`clip-${a.shot_id}`)).starred, true);
  assert.deepEqual(await repo.shots.setStar('nope', true), { ok: false, starred: null });
  assert.deepEqual((await repo.labels.unlabelledWithClips()).map((s) => s.shot_id), [b.shot_id, a.shot_id], 'newest first, only shots with a clip');
  await repo.labels.put({ shot_id: b.shot_id, events: {}, labelled_at: b.created_at, source: 'owner', revision: 0, fps: 60 });
  await repo.shots.softDelete(a.shot_id, { at: '2026-11-05T00:00:00.000Z' });
  assert.deepEqual(await repo.labels.unlabelledWithClips(), [], 'labelled and trashed shots are not offered');
});

test('deleteAll empties every store and reports what was there', async () => {
  const repo = await openMem();
  await fillRepo(repo);
  const before = {};
  for (const n of STORE_NAMES) before[n] = await repo.count(n);
  assert.deepEqual(await repo.deleteAll(), before);
  for (const n of STORE_NAMES) assert.equal(await repo.count(n), 0, n);
});

test('isoFromMs / msFromIso are exact inverses (pure UTC arithmetic, no clock)', async () => {
  const { isoFromMs, msFromIso } = await import('../../app/src/store/core.js');
  for (const ms of [0, 951782400000, 1709210096789, 1730851200123, -1e10, 4102444800000]) {
    assert.equal(isoFromMs(ms), new Date(ms).toISOString());
    assert.equal(msFromIso(isoFromMs(ms)), ms);
  }
  assert.equal(msFromIso('2026-11-05T07:30:00+08:00'), Date.parse('2026-11-04T23:30:00Z'));
  assert.ok(Number.isNaN(msFromIso('yesterday')));
});
