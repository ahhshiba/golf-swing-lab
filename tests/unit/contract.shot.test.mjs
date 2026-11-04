import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RC, newShot, emptyMetrics, bumpRevision, addWarning, attributeWarnings, validateShot, validateMetric, metricValue,
  metricNull, ContractError, METRIC_IDS, METRIC_UNITS, SETUP_LEVEL_CODES, BALL_CLUB_IDS, SCHEMA_ID,
} from '../../app/src/contract/index.js';

const FX = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/shots');
const load = (name) => JSON.parse(readFileSync(join(FX, `${name}.json`), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const texts = (r) => r.errors.map((e) => `${e.path}: ${e.msg}`);

/** The fixture fields newShot needs (everything except the defaults it fills itself). */
function initFrom(shot) {
  const { schema, revision, ...rest } = shot; // eslint-disable-line no-unused-vars
  return rest;
}

test('emptyMetrics: all 22 ids as not_computed placeholders with NOT_IMPLEMENTED', () => {
  const m = emptyMetrics();
  assert.deepEqual(Object.keys(m), [...METRIC_IDS]);
  for (const id of METRIC_IDS) {
    assert.equal(m[id].value, null);
    assert.equal(m[id].validity, 'not_computed');
    assert.deepEqual(m[id].reason_codes, [RC.NOT_IMPLEMENTED]);
    assert.equal(m[id].unit, METRIC_UNITS[id]);
    assert.deepEqual(validateMetric(m[id], id), []);
  }
  m.carry_m.reason_codes.push('x');
  assert.deepEqual(emptyMetrics().carry_m.reason_codes, [RC.NOT_IMPLEMENTED]); // fresh objects each call
});

test('newShot fills defaults and leaves un-defaultable fields to the validator', () => {
  const s = newShot();
  assert.equal(s.schema, SCHEMA_ID);
  assert.equal(s.revision, 0);
  assert.equal(s.starred, false);
  assert.equal(s.note, '');
  assert.equal(s.venue_id, null);
  assert.equal(s.preset_id, null);
  assert.deepEqual(s.quality, { pose_mean_vis: null, frames_analyzed: 0, frames_dropped: 0, audio_onset: null, touches: 0, warnings: [] });
  assert.deepEqual(Object.keys(s.metrics), [...METRIC_IDS]);
  assert.ok(!('history' in s));
  const missing = validateShot(s).errors.filter((e) => e.msg === 'required field is missing').map((e) => e.path).sort();
  assert.deepEqual(missing, ['algorithms', 'app_version', 'calibration', 'capture', 'club', 'created_at', 'events', 'handedness', 'session_id', 'shot_id']);
  assert.equal(validateShot(s).errors.length, missing.length);
});

test('newShot reproduces every valid fixture exactly (round trip)', () => {
  for (const name of ['valid_face_on_240', 'valid_dtl_30', 'valid_high_behind_240', 'valid_face_on_setup_unverified']) {
    const fx = load(name);
    const s = newShot(initFrom(fx));
    assert.deepEqual(s, fx, name);
    assert.deepEqual(texts(validateShot(s)), [], name);
  }
  const rev = load('valid_face_on_revised');
  assert.deepEqual(newShot({ ...initFrom(rev), revision: rev.revision }), rev);
});

test('newShot: partial metrics replace placeholders, unknown ids and fields throw', () => {
  const fx = load('valid_face_on_240');
  const carry = metricValue({ value: 150, unit: 'm', ci95: [130, 170], validity: 'estimated', value_origin: 'ballistics', reason_codes: [RC.SPIN_ASSUMED] });
  const s = newShot({ ...initFrom(fx), metrics: { carry_m: carry } });
  assert.deepEqual(s.metrics.carry_m, carry);
  assert.equal(s.metrics.tempo_ratio.validity, 'not_computed');
  assert.deepEqual(texts(validateShot(s)), []);
  assert.throws(() => newShot({ metrics: { carry_yards: carry } }), /unknown metric id 'carry_yards'/);
  assert.throws(() => newShot({ colour: 'red' }), /unknown field 'colour'/);
  assert.throws(() => newShot({ metrics: [] }), ContractError);
  assert.throws(() => newShot('x'), ContractError);
});

test('newShot copies its inputs (no aliasing)', () => {
  const fx = load('valid_dtl_30');
  const init = initFrom(fx);
  const s = newShot(init);
  s.capture.width = 1;
  s.events.top.frame = 0;
  s.metrics.tempo_ratio.ci95[0] = 0;
  assert.equal(init.capture.width, 1080);
  assert.equal(init.events.top.frame, 60);
  assert.deepEqual(init.metrics.tempo_ratio.ci95, [2.56, 3.57]);
  assert.throws(() => newShot({ capture: { buf: new Float64Array(2) } }), /typed array/);
});

// ---------------------------------------------------------------------------------------- warnings

test('addWarning: setup-level code is attributed to every affected metric that has a number', () => {
  const s0 = load('valid_face_on_240');
  const snapshot = JSON.stringify(s0);
  const s = addWarning(s0, RC.SETUP_UNVERIFIED);
  assert.equal(JSON.stringify(s0), snapshot, 'input untouched');
  assert.deepEqual(s.quality.warnings, [RC.TRACK_MAY_BE_SHORT, RC.SETUP_UNVERIFIED]);
  assert.deepEqual(texts(validateShot(s)), []);
  for (const id of METRIC_IDS) {
    const before = s0.metrics[id];
    const after = s.metrics[id];
    const affected = BALL_CLUB_IDS.includes(id) && before.value !== null;
    if (affected) {
      assert.equal(after.validity, 'low_confidence', id);
      assert.ok(after.reason_codes.includes(RC.SETUP_UNVERIFIED), id);
      assert.equal(after.value, before.value);
    } else {
      assert.deepEqual(after, before, `${id} must be unchanged`);
    }
  }
});

test('addWarning: every setup-level code gives a valid shot; calling it twice changes nothing', () => {
  for (const code of SETUP_LEVEL_CODES) {
    const once = addWarning(load('valid_face_on_240'), code);
    assert.deepEqual(texts(validateShot(once)), [], code);
    const twice = addWarning(once, code);
    assert.deepEqual(twice, once);
  }
  let s = load('valid_face_on_240');
  for (const code of SETUP_LEVEL_CODES) s = addWarning(s, code);
  assert.deepEqual(texts(validateShot(s)), []);
  assert.deepEqual(s.metrics.carry_m.reason_codes.filter((c) => SETUP_LEVEL_CODES.includes(c)), [...SETUP_LEVEL_CODES]);
});

test('addWarning: other codes only go to quality.warnings; unknown codes throw', () => {
  const s0 = load('valid_face_on_240');
  const s = addWarning(s0, RC.THERMAL_DEGRADED);
  assert.deepEqual(s.quality.warnings, [RC.TRACK_MAY_BE_SHORT, RC.THERMAL_DEGRADED]);
  assert.deepEqual(s.metrics, s0.metrics);
  assert.throws(() => addWarning(s0, 'NOT_A_CODE'), /unknown reason code/);
  assert.throws(() => addWarning({ quality: {} }, RC.CALIB_STALE), ContractError);
});

test('attributeWarnings repairs a shot whose warnings were set first', () => {
  const s0 = clone(load('valid_face_on_240'));
  s0.quality.warnings.push(RC.CALIB_STALE, RC.PRESET_MISMATCH);
  assert.equal(validateShot(s0).ok, false);
  const s = attributeWarnings(s0);
  assert.deepEqual(texts(validateShot(s)), []);
  assert.deepEqual(attributeWarnings(s), s);
  assert.throws(() => attributeWarnings({}), ContractError);
});

test('attributeWarnings leaves null metrics and unaffected pose metrics alone', () => {
  const s = attributeWarnings({ ...load('valid_dtl_30'), quality: { ...load('valid_dtl_30').quality, warnings: [RC.SETUP_UNVERIFIED] } });
  assert.deepEqual(s.metrics, load('valid_dtl_30').metrics);
});

// ---------------------------------------------------------------------------------------- bumpRevision (P6)

const correctedTop = { top: { frame: 345, t_s: 1.4375, conf: 1, source: 'manual' } };

test('bumpRevision: revision + 1, patch applied, original kept in history, input untouched', () => {
  const s0 = load('valid_face_on_240');
  const snapshot = JSON.stringify(s0);
  const s1 = bumpRevision(s0, { events: correctedTop }, { at: '2026-11-04T12:00:00Z' });
  assert.equal(JSON.stringify(s0), snapshot);
  assert.equal(s1.revision, 1);
  assert.deepEqual(s1.events.top, correctedTop.top);
  assert.equal(s1.events.impact.frame, 440);
  assert.deepEqual(s1.history, [{ revision: 0, at: '2026-11-04T12:00:00Z', before: { events: s0.events } }]);
  assert.equal(s1.history[0].before.events.top.frame, 340, 'original value kept');
  assert.equal(s1.history[0].before.events.top.source, 'rules');
  assert.deepEqual(texts(validateShot(s1)), []);
  // untouched parts are equal but not shared
  assert.deepEqual(s1.metrics, s0.metrics);
  s1.metrics.carry_m.ci95[0] = 0;
  assert.equal(s0.metrics.carry_m.ci95[0], 160);
});

test('bumpRevision accumulates history and can recompute metrics in the same patch', () => {
  const s0 = load('valid_face_on_240');
  const recomputed = {
    backswing_s: metricValue({ value: 1.270833, unit: 's', ci95: [1.266633, 1.275033], validity: 'valid', value_origin: 'pose' }),
    tempo_ratio: metricValue({ value: 3.2105, unit: 'ratio', ci95: [3.14, 3.28], validity: 'valid', value_origin: 'derived' }),
  };
  const s1 = bumpRevision(s0, { events: correctedTop, metrics: recomputed });
  assert.equal(s1.metrics.tempo_ratio.value, 3.2105);
  assert.equal(s1.metrics.carry_m.value, 181);
  assert.equal(s1.history[0].at, null);
  assert.deepEqual(Object.keys(s1.history[0].before).sort(), ['events', 'metrics']);
  assert.equal(s1.history[0].before.metrics.tempo_ratio.value, 3.0);
  const s2 = bumpRevision(s1, { note: 'second look', starred: false });
  assert.equal(s2.revision, 2);
  assert.deepEqual(s2.history.map((h) => h.revision), [0, 1]);
  assert.deepEqual(s2.history[1].before, { note: s1.note, starred: true });
  assert.equal(s2.history[0].before.events.top.frame, 340, 'the very first value survives later revisions');
  assert.deepEqual(texts(validateShot(s2)), []);
});

test('bumpRevision: objects merge key by key, arrays and scalars replace, undefined is ignored', () => {
  const s0 = load('valid_face_on_240');
  const s1 = bumpRevision(s0, { quality: { warnings: [RC.THERMAL_DEGRADED], touches: undefined }, events: { top: { conf: 0.5 } } });
  assert.deepEqual(s1.quality.warnings, [RC.THERMAL_DEGRADED]);
  assert.equal(s1.quality.touches, s0.quality.touches);
  assert.equal(s1.events.top.conf, 0.5);
  assert.equal(s1.events.top.frame, 340);
  const s2 = bumpRevision(s0, { starred: undefined, note: 'x' });
  assert.deepEqual(Object.keys(s2.history[0].before), ['note']);
});

test('bumpRevision rejects non-monotonic events and anything else the patch makes invalid', () => {
  const s0 = load('valid_face_on_240');
  assert.throws(() => bumpRevision(s0, { events: { top: { frame: 200, t_s: 0.83 } } }), (e) => e instanceof ContractError && /non-decreasing/.test(e.message));
  assert.throws(() => bumpRevision(s0, { metrics: { carry_m: { ci95: [1, 2] } } }), /outside ci95/);
  assert.throws(() => bumpRevision(s0, { events: { impact: { source: 'human' } } }), /events\.impact\.source/);
  assert.equal(s0.revision, 0);
  assert.equal(s0.history, undefined);
});

test('bumpRevision: identity fields cannot be patched, unknown fields throw, bad input throws', () => {
  const s0 = load('valid_face_on_240');
  for (const k of ['schema', 'shot_id', 'session_id', 'created_at', 'revision', 'history']) {
    assert.throws(() => bumpRevision(s0, { [k]: s0[k] ?? [] }), new RegExp(`'${k}' cannot be patched`));
  }
  assert.throws(() => bumpRevision(s0, { colour: 1 }), /unknown field 'colour'/);
  assert.throws(() => bumpRevision(s0, null), ContractError);
  assert.throws(() => bumpRevision(s0, []), ContractError);
  assert.throws(() => bumpRevision(null, {}), ContractError);
  assert.throws(() => bumpRevision({ revision: 'one' }, {}), ContractError);
});

test('bumpRevision is not blocked by problems the shot already had', () => {
  const broken = newShot({ shot_id: 'x' }); // many missing fields
  const s1 = bumpRevision(broken, { note: 'work in progress' });
  assert.equal(s1.revision, 1);
  assert.equal(validateShot(s1).errors.length, validateShot(broken).errors.length);
});

test('bumpRevision on a stored revision-1 shot extends its history', () => {
  const rev = load('valid_face_on_revised');
  const next = bumpRevision(rev, { events: { finish: { frame: 640, t_s: 2.666667 } } });
  assert.equal(next.revision, 2);
  assert.deepEqual(next.history.map((h) => h.revision), [0, 1]);
  assert.deepEqual(texts(validateShot(next)), []);
});

test('metric helpers and newShot together build the dtl pose-only fixture values', () => {
  const nul = metricNull('not_observable', [RC.VIEW_DEPTH_AXIS], 'm', 'pose');
  assert.deepEqual(nul, load('valid_dtl_30').metrics.head_sway_x_m);
});
