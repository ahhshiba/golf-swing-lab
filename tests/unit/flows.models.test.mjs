// P9 event-model replacement and rollback: validation (sha256, feature_version, shapes, embedded golden), the two
// store slots, one-tap rollback, the worker's { type: 'set_model' } message, and the bundled-model probe.
import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import {
  validateEventModel, importEventModel, rollbackEventModel, activeEventModel, previousEventModel, sha256Hex,
  bundledModelAvailable, modelStatusText, goldenProblems, NO_MODEL_HINT,
} from '../../app/src/session/models.js';
import { loadTcn } from '../../app/src/events/tcn.js';
import { openRepository } from '../../app/src/store/core.js';
import { MemBackend } from '../../app/src/store/mem.js';
import { createWorkerHandler } from '../../app/src/workers/vision.worker.js';
import { validateMessage } from '../../app/src/workers/protocol.js';
import { HAVE_EVENT_MODEL, NO_MODEL_SKIP } from './_event_model.mjs';

const test = (name, fn) => nodeTest(name, { skip: NO_MODEL_SKIP }, fn);

const M = new URL('../../app/models/', import.meta.url);
const JSON0 = HAVE_EVENT_MODEL ? JSON.parse(fs.readFileSync(new URL('event-tcn-v1.json', M), 'utf8')) : null;
const BIN0 = HAVE_EVENT_MODEL ? fs.readFileSync(new URL('event-tcn-v1.bin', M)) : Buffer.alloc(0);
const GOLDEN = HAVE_EVENT_MODEL ? JSON.parse(fs.readFileSync(new URL('../fixtures/event-tcn-v1.golden.json', import.meta.url), 'utf8')) : null;
const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const clone = (o) => JSON.parse(JSON.stringify(o));
// Node 18 has no global crypto in ES modules: pass WebCrypto in (the browser uses globalThis.crypto.subtle)
const OPT = { sha256: (b) => sha256Hex(b, webcrypto.subtle) };
const validate = (j, b) => validateEventModel(j, b, OPT);

test('sha256Hex (WebCrypto) equals node:crypto', async () => {
  assert.equal(await sha256Hex(ab(BIN0), webcrypto.subtle), sha(BIN0));
  await assert.rejects(sha256Hex(ab(BIN0), null), /SHA-256/);
});

test('the bundled model passes validation; with the golden embedded the golden check passes', async () => {
  const plain = await validate(JSON0, ab(BIN0));
  assert.equal(plain.ok, true, plain.problems.join('; '));
  assert.equal(plain.golden, 'absent');
  assert.equal(plain.meta.version, 'event-tcn-v1');
  const withGolden = await validate({ ...JSON0, golden: GOLDEN }, ab(BIN0));
  assert.equal(withGolden.ok, true, withGolden.problems.join('; '));
  assert.equal(withGolden.golden, 'pass');
  assert.ok(withGolden.worst <= 1e-4);
});

test('validation rejects: wrong sha256, wrong feature version, wrong size, misshaped tensor, golden mismatch', async () => {
  const flipped = Buffer.from(BIN0);
  flipped[100] ^= 1;
  const a = await validate(JSON0, ab(flipped));
  assert.equal(a.ok, false);
  assert.ok(a.problems.some((p) => /SHA-256/.test(p)));
  const b = await validate({ ...JSON0, feature_version: 'evfeat-0' }, ab(BIN0));
  assert.ok(!b.ok && b.problems.some((p) => /特徵版本/.test(p)));
  const c = await validate(JSON0, ab(BIN0.subarray(0, BIN0.length - 4)));
  assert.ok(!c.ok && c.problems.some((p) => /大小/.test(p)));
  const bad = clone(JSON0);
  bad.tensors[0].shape = [64, 12, 3];
  const d = await validate(bad, ab(BIN0));
  assert.ok(!d.ok && d.problems.some((p) => /形狀/.test(p)), d.problems.join('; '));
  const g = clone(GOLDEN);
  g.cases[0].probs[5] += 0.01;
  const e = await validate({ ...JSON0, golden: g }, ab(BIN0));
  assert.equal(e.ok, false);
  assert.equal(e.golden, 'fail');
  assert.equal((await validate(null, ab(BIN0))).ok, false);
  assert.ok(goldenProblems(loadTcn(JSON0, ab(BIN0)), { cases: [] }).problems.length > 0);
});

test('import keeps the previous model; rollback swaps (one tap back, one tap forward); back to builtin clears', async () => {
  const repo = await openRepository(new MemBackend());
  const check = await validate(JSON0, ab(BIN0));
  assert.equal(await activeEventModel(repo), null);
  const r1 = await importEventModel(repo, { json: JSON0, bin: ab(BIN0), check, imported_at: '2026-11-04T10:00:00Z', file_names: ['a.json', 'a.bin'] });
  assert.equal(r1.slot, 'active');
  assert.equal((await previousEventModel(repo)).source, 'builtin');
  const json2 = { ...clone(JSON0), version: 'event-tcn-v2' };
  const r2 = await importEventModel(repo, { json: json2, bin: ab(BIN0), check, imported_at: '2026-11-04T11:00:00Z' });
  assert.equal((await activeEventModel(repo)).version, 'event-tcn-v2');
  assert.equal((await previousEventModel(repo)).version, 'event-tcn-v1');
  assert.equal((await activeEventModel(repo)).bin.byteLength, BIN0.length);
  let rb = await rollbackEventModel(repo);
  assert.ok(rb.ok);
  assert.equal((await activeEventModel(repo)).version, 'event-tcn-v1');
  assert.equal((await previousEventModel(repo)).version, 'event-tcn-v2');
  rb = await rollbackEventModel(repo); // forward again
  assert.equal((await activeEventModel(repo)).version, r2.version);
  // a fresh repo: import once, roll back → builtin (bundled model or rules)
  const repo2 = await openRepository(new MemBackend());
  await importEventModel(repo2, { json: JSON0, bin: ab(BIN0), check, imported_at: '2026-11-04T10:00:00Z' });
  rb = await rollbackEventModel(repo2);
  assert.ok(rb.ok);
  assert.equal(await activeEventModel(repo2), null);
  assert.equal((await previousEventModel(repo2)).source, 'imported'); // roll forward stays possible
  assert.equal((await rollbackEventModel(repo2)).ok, true);
  assert.equal((await activeEventModel(repo2)).version, 'event-tcn-v1');
  await assert.rejects(importEventModel(repo2, { json: JSON0, bin: ab(BIN0), check: { ok: false }, imported_at: 'x' }));
  const empty = await openRepository(new MemBackend());
  assert.equal((await rollbackEventModel(empty)).ok, false);
});

test('worker: set_model loads an imported model, json null returns to the default, a bad model replies ok:false', async () => {
  const sent = [];
  let defaultLoads = 0;
  const h = createWorkerHandler({ post: (m) => sent.push(m), loadTcn: async () => { defaultLoads++; return null; } });
  assert.equal(validateMessage({ type: 'set_model', json: JSON0, bin: ab(BIN0) }, 'to_worker').ok, true);
  assert.equal(validateMessage({ type: 'set_model', json: null, bin: null }, 'to_worker').ok, true);
  assert.equal(validateMessage({ type: 'set_model', json: JSON0 }, 'to_worker').ok, false);
  await h.handle({ type: 'set_model', json: JSON0, bin: ab(BIN0) });
  assert.deepEqual(sent.at(-1), { type: 'model_set', ok: true, version: 'event-tcn-v1' });
  assert.equal(validateMessage(sent.at(-1), 'to_main').ok, true);
  await h.handle({ type: 'set_model', json: null, bin: null });
  assert.deepEqual(sent.at(-1), { type: 'model_set', ok: true, version: null });
  await h.handle({ type: 'set_model', json: { ...JSON0, feature_version: 'nope' }, bin: ab(BIN0) });
  assert.equal(sent.at(-1).type, 'model_set');
  assert.equal(sent.at(-1).ok, false);
  assert.equal(defaultLoads, 0); // the default loader runs only on the next analyze_clip
});

test('bundledModelAvailable reads precache-manifest.json, falls back to the model file; status text has the import hint', async () => {
  const resp = (ok, body) => ({ ok, status: ok ? 200 : 404, json: async () => body });
  const withModel = { shell: [{ url: 'index.html' }], assets: [{ url: 'models/event-tcn-v1.json' }, { url: 'models/event-tcn-v1.bin' }] };
  const without = { shell: [{ url: 'index.html' }], assets: [{ url: 'models/pose_landmarker_lite.task' }] };
  assert.equal(await bundledModelAvailable(async (u) => resp(true, u === 'precache-manifest.json' ? withModel : {})), true);
  assert.equal(await bundledModelAvailable(async (u) => resp(true, u === 'precache-manifest.json' ? without : {})), false);
  assert.equal(await bundledModelAvailable(async (u) => resp(u !== 'precache-manifest.json', {})), true);
  assert.equal(await bundledModelAvailable(async () => { throw new Error('offline'); }), false);
  assert.equal(await bundledModelAvailable(null), false);
  assert.match(modelStatusText({ bundled: false }), new RegExp(NO_MODEL_HINT));
  assert.match(modelStatusText({ bundled: true }), /內建事件模型/);
});
