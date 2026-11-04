// Event TCN pure-JS inference (app/src/events/tcn.js): parity with the torch golden, loader checks, and the
// detect() TCN path on synthetic swings.
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadTcn, TCN_FORMAT } from '../../app/src/events/tcn.js';
import { detect } from '../../app/src/events/detect.js';
import { computeFeatures, FEATURE_VERSION } from '../../app/src/events/features.js';
import { EVENTS } from '../../app/src/contract/enums.js';
import { goldenPoseSeqs } from '../../training/node/synth_features.mjs';
import { checkParity } from '../../scripts/check_model_parity.mjs';
import { HAVE_EVENT_MODEL, NO_MODEL_SKIP } from './_event_model.mjs';

const test = (name, fn) => nodeTest(name, { skip: NO_MODEL_SKIP }, fn);

const path = (p) => fileURLToPath(new URL(p, import.meta.url));
const json = HAVE_EVENT_MODEL ? JSON.parse(readFileSync(path('../../app/models/event-tcn-v1.json'), 'utf8')) : null;
const binBuf = HAVE_EVENT_MODEL ? readFileSync(path('../../app/models/event-tcn-v1.bin')) : Buffer.alloc(0);
const bin = binBuf.buffer.slice(binBuf.byteOffset, binBuf.byteOffset + binBuf.byteLength);
const golden = HAVE_EVENT_MODEL ? JSON.parse(readFileSync(path('../fixtures/event-tcn-v1.golden.json'), 'utf8')) : null;

test('model json describes an evfeat-1 TCN with ~60k parameters', () => {
  assert.equal(json.format, TCN_FORMAT);
  assert.equal(json.feature_version, FEATURE_VERSION);
  assert.equal(json.classes.length, 9);
  assert.equal(json.classes[8], 'background');
  assert.ok(json.n_params >= 30000 && json.n_params <= 90000, `n_params ${json.n_params}`);
  assert.equal(json.bin_bytes, json.n_params * 4);
  assert.match(json.licence, /CC BY-NC/);
});

test('JS inference matches the torch golden (max |dprob| <= 1e-4, same argmax, sha256)', () => {
  const { problems, notes } = checkParity(json, binBuf, golden);
  assert.deepEqual(problems, [], notes.join('\n'));
});

test('golden features are reproduced by computeFeatures from the same synthetic swings', () => {
  const cases = goldenPoseSeqs();
  assert.equal(cases.length, golden.cases.length);
  cases.forEach((c, i) => {
    const f = computeFeatures(c.poseSeq, { handedness: c.handedness });
    assert.equal(f.K, golden.cases[i].K);
    let maxd = 0;
    for (let j = 0; j < f.data.length; j++) maxd = Math.max(maxd, Math.abs(f.data[j] - golden.cases[i].features[j]));
    assert.ok(maxd <= 1e-12, `${c.name}: ${maxd}`);
  });
});

test('predict returns K*9 probabilities that sum to 1; predictRows gives rows', () => {
  const tcn = loadTcn(json, bin);
  const c = golden.cases[0];
  const feat = { K: c.K, F: c.F, data: Float64Array.from(c.features) };
  const p = tcn.predict(feat);
  assert.ok(p instanceof Float32Array);
  assert.equal(p.length, c.K * 9);
  for (let t = 0; t < c.K; t++) {
    let s = 0;
    for (let k = 0; k < 9; k++) s += p[t * 9 + k];
    assert.ok(Math.abs(s - 1) < 1e-5);
  }
  const rows = tcn.predictRows(feat);
  assert.equal(rows.length, c.K);
  assert.equal(rows[0].length, 9);
  // non-finite features are treated as the training mean (z = 0), never NaN out
  const bad = Float64Array.from(c.features);
  bad.fill(NaN, 0, 24);
  assert.ok(tcn.predict({ K: c.K, F: c.F, data: bad }).every(Number.isFinite));
});

test('loadTcn rejects a wrong feature version, format or weight size', () => {
  assert.throws(() => loadTcn({ ...json, feature_version: 'evfeat-0' }, bin), /evfeat-0/);
  assert.throws(() => loadTcn({ ...json, format: 'x' }, bin), /format/);
  assert.throws(() => loadTcn(json, bin.slice(0, bin.byteLength - 4)), /size/);
  assert.throws(() => loadTcn(json, bin).predict({ K: 5, F: 11, data: new Float64Array(55) }), /features/);
});

test('detect(poseSeq, { useTcn: true, tcn }) returns a complete monotonic TCN EventSet', () => {
  const tcn = loadTcn(json, bin);
  for (const c of goldenPoseSeqs()) {
    const ev = detect(c.poseSeq, { view: c.view, handedness: c.handedness, useTcn: true, tcn });
    assert.equal(ev.fallback, undefined, `${c.name}: fell back to rules`);
    let prevF = -1;
    let prevT = -Infinity;
    for (const e of EVENTS) {
      assert.equal(ev[e].source, 'tcn');
      assert.ok(Number.isInteger(ev[e].frame) && ev[e].frame >= 0 && ev[e].frame < c.poseSeq.t_s.length);
      assert.ok(ev[e].frame >= prevF && ev[e].t_s >= prevT, `${c.name}: ${e} out of order`);
      assert.ok(ev[e].conf >= 0 && ev[e].conf <= 1);
      prevF = ev[e].frame;
      prevT = ev[e].t_s;
    }
  }
});
