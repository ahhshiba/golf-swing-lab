// P9 event-model replacement and rollback (PRODUCT-SPEC §7.1, §7.4): validation (sha256, feature_version, shapes,
// model card, embedded golden), the two store slots, one-tap rollback, the worker's { type: 'set_model' } message,
// the research-only bundled-model probe, and the clip pipeline's card gate. Owner models are built in JS
// (_owner_model.mjs); the GolfDB research model is only exercised when present locally, in research mode.
import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import {
  validateEventModel, importEventModel, rollbackEventModel, activeEventModel, previousEventModel, sha256Hex,
  bundledModelAvailable, researchModelUrls, modelStatus, modelStatusText, goldenProblems, cardProblems, ownerGatePassed,
  MODEL_CODES, NO_MODEL_HINT,
} from '../../app/src/session/models.js';
import { tcnRejection } from '../../app/src/events/card.js';
import { loadTcn } from '../../app/src/events/tcn.js';
import { openRepository } from '../../app/src/store/core.js';
import { MemBackend } from '../../app/src/store/mem.js';
import { createWorkerHandler } from '../../app/src/workers/vision.worker.js';
import { validateMessage } from '../../app/src/workers/protocol.js';
import { HAVE_EVENT_MODEL, NO_MODEL_SKIP } from './_event_model.mjs';
import { ownerModel } from './_owner_model.mjs';

const test = nodeTest;
const researchTest = (name, fn) => nodeTest(name, { skip: NO_MODEL_SKIP }, fn);

const M = new URL('../../app/models/', import.meta.url);
const JSON0 = HAVE_EVENT_MODEL ? JSON.parse(fs.readFileSync(new URL('event-tcn-v1.json', M), 'utf8')) : null;
const BIN0 = HAVE_EVENT_MODEL ? fs.readFileSync(new URL('event-tcn-v1.bin', M)) : Buffer.alloc(0);
const GOLDEN = HAVE_EVENT_MODEL ? JSON.parse(fs.readFileSync(new URL('../fixtures/event-tcn-v1.golden.json', import.meta.url), 'utf8')) : null;
const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const clone = (o) => JSON.parse(JSON.stringify(o));
// Node 18 has no global crypto in ES modules: pass WebCrypto in (the browser uses globalThis.crypto.subtle)
const OPT = { sha256: (b) => sha256Hex(b, webcrypto.subtle) };
const validate = (j, b, o = {}) => validateEventModel(j, b, { ...OPT, ...o });
const codes = (r) => r.problems.map((p) => p.code);

test('sha256Hex (WebCrypto) equals node:crypto; no WebCrypto -> a coded error', async () => {
  const { bin } = ownerModel();
  assert.equal(await sha256Hex(bin, webcrypto.subtle), sha(Buffer.from(bin)));
  await assert.rejects(sha256Hex(bin, null), (e) => e.code === 'model.error.no_crypto');
});

test('an owner model with a golfdb:false card and holdout metrics passes; its golden is reproduced <= 1e-4', async () => {
  const { json, bin } = ownerModel();
  const r = await validate(json, bin);
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(r.golden, 'pass');
  assert.ok(r.worst <= 1e-4);
  assert.equal(r.meta.card.golfdb, false);
  assert.ok(ownerGatePassed(r.card));
});

test('model card: golfdb != false, missing card, foreign training data or no owner holdout -> rejected', async () => {
  const { json, bin } = ownerModel();
  const withCard = (card) => ({ ...clone(json), model_card: card });
  assert.deepEqual(codes(await validate(withCard({ ...json.model_card, golfdb: true }), bin)), ['model.error.card_third_party']);
  assert.deepEqual(codes(await validate(withCard(undefined), bin)), ['model.error.card_missing']);
  assert.deepEqual(codes(await validate(withCard({ ...json.model_card, training_data: ['owner', 'golfdb'] }), bin)), ['model.error.card_training']);
  assert.deepEqual(codes(await validate(withCard({ ...json.model_card, owner_holdout: null }), bin)), ['model.error.card_holdout']);
  // a research build may load an uncarded research model
  assert.deepEqual(cardProblems({}, { research: true }), []);
});

test('validation rejects: wrong sha256, wrong feature version, wrong size, misshaped tensor, golden mismatch', async () => {
  const { json, bin } = ownerModel();
  const flipped = new Uint8Array(bin.slice(0));
  flipped[100] ^= 1;
  assert.ok(codes(await validate(json, flipped.buffer)).includes('model.error.hash'));
  assert.ok(codes(await validate({ ...json, feature_version: 'evfeat-0' }, bin)).includes('model.error.feature_version'));
  assert.ok(codes(await validate(json, bin.slice(0, bin.byteLength - 4))).includes('model.error.bin_size'));
  const bad = clone(json);
  bad.tensors[0].shape = [4, 12, 5];
  assert.ok(codes(await validate(bad, bin)).includes('model.error.shape'));
  const g = clone(json);
  g.golden.cases[0].probs[5] += 0.01;
  const e = await validate(g, bin);
  assert.equal(e.golden, 'fail');
  assert.ok(codes(e).includes('model.error.golden_diff'));
  assert.equal((await validate(null, bin)).ok, false);
  assert.ok(goldenProblems(loadTcn(json, bin), { cases: [] }).problems.length > 0);
  // every problem / status code has catalog text in both locales
  for (const loc of ['zh-Hant', 'en']) {
    const cat = JSON.parse(fs.readFileSync(new URL(`../../app/i18n/${loc}/model.json`, import.meta.url), 'utf8'));
    for (const c of MODEL_CODES) assert.ok(typeof cat[c.replace(/^model\./, '')] === 'string', `${loc} ${c}`);
    assert.ok(typeof cat[NO_MODEL_HINT.replace(/^model\./, '')] === 'string');
  }
});

test('import keeps the previous model; rollback swaps (one tap back, one tap forward); back to the rules clears', async () => {
  const { json: J1, bin } = ownerModel({ version: 'owner-a' });
  const repo = await openRepository(new MemBackend());
  const check = await validate(J1, bin);
  assert.equal(await activeEventModel(repo), null);
  const r1 = await importEventModel(repo, { json: J1, bin, check, imported_at: '2026-11-04T10:00:00Z', file_names: ['a.json', 'a.bin'] });
  assert.equal(r1.slot, 'active');
  assert.equal(r1.card.golfdb, false);
  assert.equal((await previousEventModel(repo)).source, 'builtin');
  const J2 = { ...clone(J1), version: 'owner-b' };
  const r2 = await importEventModel(repo, { json: J2, bin, check, imported_at: '2026-11-04T11:00:00Z' });
  assert.equal((await activeEventModel(repo)).version, 'owner-b');
  assert.equal((await previousEventModel(repo)).version, 'owner-a');
  assert.equal((await activeEventModel(repo)).bin.byteLength, bin.byteLength);
  let rb = await rollbackEventModel(repo);
  assert.ok(rb.ok);
  assert.equal(rb.code, 'model.rollback.version');
  assert.equal((await activeEventModel(repo)).version, 'owner-a');
  rb = await rollbackEventModel(repo); // forward again
  assert.equal((await activeEventModel(repo)).version, r2.version);
  const repo2 = await openRepository(new MemBackend());
  await importEventModel(repo2, { json: J1, bin, check, imported_at: '2026-11-04T10:00:00Z' });
  rb = await rollbackEventModel(repo2);
  assert.equal(rb.code, 'model.rollback.builtin');
  assert.equal(await activeEventModel(repo2), null);
  assert.equal((await previousEventModel(repo2)).source, 'imported');
  assert.equal((await rollbackEventModel(repo2)).ok, true);
  assert.equal((await activeEventModel(repo2)).version, 'owner-a');
  await assert.rejects(importEventModel(repo2, { json: J1, bin, check: { ok: false }, imported_at: 'x' }), (e) => e.code === 'model.error.not_checked');
  const empty = await openRepository(new MemBackend());
  const none = await rollbackEventModel(empty);
  assert.equal(none.ok, false);
  assert.equal(none.code, 'model.rollback.none');
  assert.equal(typeof none.message, 'string');
});

test('worker: set_model loads an imported model, json null returns to the default, a bad model replies ok:false', async () => {
  const { json, bin } = ownerModel({ version: 'owner-w' });
  const sent = [];
  let defaultLoads = 0;
  const h = createWorkerHandler({ post: (m) => sent.push(m), loadTcn: async () => { defaultLoads++; return null; } });
  assert.equal(validateMessage({ type: 'set_model', json, bin }, 'to_worker').ok, true);
  assert.equal(validateMessage({ type: 'set_model', json: null, bin: null }, 'to_worker').ok, true);
  await h.handle({ type: 'set_model', json, bin });
  assert.deepEqual(sent.at(-1), { type: 'model_set', ok: true, version: 'owner-w' });
  await h.handle({ type: 'set_model', json: null, bin: null });
  assert.deepEqual(sent.at(-1), { type: 'model_set', ok: true, version: null });
  await h.handle({ type: 'set_model', json: { ...json, feature_version: 'nope' }, bin });
  assert.equal(sent.at(-1).ok, false);
  assert.equal(defaultLoads, 0);
});

test('bundledModelAvailable: only a research build manifest; never fetches a model file; status is codes', async () => {
  const resp = (ok, body) => ({ ok, status: ok ? 200 : 404, json: async () => body });
  const research = { dev_research: true, shell: [{ url: 'index.html' }], assets: [{ url: 'models/event-tcn-r1.json' }, { url: 'models/event-tcn-r1.bin' }] };
  const shipped = { dev_research: false, bundled_event_model: false, shell: [{ url: 'index.html' }], assets: [{ url: 'models/pose_landmarker_lite.task' }] };
  const asked = [];
  const f = (m) => async (u) => { asked.push(u); return resp(u === 'precache-manifest.json', m); };
  assert.equal(await bundledModelAvailable(f(research)), true);
  assert.deepEqual(researchModelUrls(research), { json: 'models/event-tcn-r1.json', bin: 'models/event-tcn-r1.bin' });
  assert.equal(await bundledModelAvailable(f(shipped)), false);
  assert.equal(await bundledModelAvailable(async (u) => { asked.push(u); return resp(false, {}); }), false, 'no manifest (dev server) -> rules');
  assert.equal(await bundledModelAvailable(async () => { throw new Error('offline'); }), false);
  assert.equal(await bundledModelAvailable(null), false);
  assert.ok(asked.every((u) => u === 'precache-manifest.json'), `only the manifest is fetched: ${asked}`);
  assert.deepEqual(modelStatus({}).map((m) => m.code), ['model.status.rules', 'model.status.no_back']);
  assert.deepEqual(modelStatus({ bundled: true }).map((m) => m.code), ['model.status.research', 'model.status.no_back']);
  const { json } = ownerModel();
  const st = modelStatus({ active: { version: 'v', imported_at: '2026-11-05T00:00:00Z', card: json.model_card }, previous: { source: 'builtin' } });
  assert.deepEqual(st.map((m) => m.code), ['model.status.imported', 'model.gate.passed', 'model.status.back_builtin']);
  assert.ok(!/[㐀-鿿]/.test(fs.readFileSync(new URL('../../app/src/session/models.js', import.meta.url), 'utf8')), 'models.js has no CJK literal');
  assert.equal(typeof modelStatusText({}), 'string');
});

test('clip pipeline card gate: owner model used only when its gate passed and the view is covered', () => {
  const { json } = ownerModel();
  const meta = { card: json.model_card };
  assert.equal(tcnRejection(meta, 'face_on'), null);
  assert.equal(tcnRejection(meta, 'high_behind'), 'tcn_view', 'high_behind stays rules unless the card covers it');
  assert.equal(tcnRejection({ card: { ...json.model_card, views: ['face_on', 'dtl', 'high_behind'] } }, 'high_behind'), null);
  assert.equal(tcnRejection({ card: { ...json.model_card, owner_holdout: { ...json.model_card.owner_holdout, gate: { passed: false } } } }, 'face_on'), 'tcn_owner_gate');
  assert.equal(tcnRejection({ card: { ...json.model_card, golfdb: true } }, 'face_on'), 'tcn_card_third_party');
  assert.equal(tcnRejection({ card: null }, 'face_on'), 'tcn_no_card');
  assert.equal(tcnRejection({}, 'dtl', { research: true }), null);
  assert.equal(tcnRejection({}, 'high_behind', { research: true }), 'tcn_view');
});

researchTest('research model (local only): passes in research mode, rejected without (no model card)', async () => {
  const plain = await validate(JSON0, ab(BIN0), { research: true });
  assert.equal(plain.ok, true, JSON.stringify(plain.problems));
  assert.equal(plain.meta.version, 'event-tcn-v1');
  const withGolden = await validate({ ...JSON0, golden: GOLDEN }, ab(BIN0), { research: true });
  assert.equal(withGolden.golden, 'pass');
  assert.ok(withGolden.worst <= 1e-4);
  const shipped = await validate(JSON0, ab(BIN0));
  assert.equal(shipped.ok, false);
  assert.deepEqual(codes(shipped), ['model.error.card_missing']);
});
