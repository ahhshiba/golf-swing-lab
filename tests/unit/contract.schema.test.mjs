import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C0 from '../../app/src/contract/index.js';

// This file checks the FROZEN golf-shot/1 schema (still used for imported legacy shots) against the golf-shot/1 lists.
// golf-shot/2 (schema/shot-v2.schema.json): tests/unit/lm.contract.v2.test.mjs.
const C = {
  ...C0, SCHEMA_ID: C0.SCHEMA_V1, METRIC_IDS: C0.METRIC_IDS_V1, VALUE_ORIGINS: C0.VALUE_ORIGINS_V1,
  REASON_CODES: Object.fromEntries(C0.REASON_CODE_LIST_V1.map((k) => [k, k])), ALGORITHM_KEYS: C0.ALGORITHM_KEYS_V1,
  SHOT_REQUIRED_KEYS: C0.SHOT_REQUIRED_KEYS_V1,
  METRIC_UNITS: Object.fromEntries(C0.METRIC_IDS_V1.map((id) => [id, C0.METRIC_UNITS[id]])),
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const schemaText = readFileSync(join(ROOT, 'schema/shot-v1.schema.json'), 'utf8');
const schema = JSON.parse(schemaText);
const FX = join(ROOT, 'tests/fixtures/shots');
const fixtures = readdirSync(FX).filter((f) => f.endsWith('.json')).sort().map((f) => {
  const raw = JSON.parse(readFileSync(join(FX, f), 'utf8'));
  return { name: f.replace(/\.json$/, ''), expect: raw._expect, shot: Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('_'))) };
});

// ---- a small JSON Schema 2020-12 checker for the keywords this schema uses (unknown keywords throw) ----

const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description', '$defs']);

function check(s, v, path, errs) {
  for (const key of Object.keys(s)) {
    if (!ANNOTATIONS.has(key) && !KEYWORDS[key]) throw new Error(`schema keyword '${key}' not supported by the test checker`);
  }
  if (s.$ref !== undefined) {
    const m = /^#\/\$defs\/(.+)$/.exec(s.$ref);
    assert.ok(m && schema.$defs[m[1]], `bad $ref ${s.$ref}`);
    check(schema.$defs[m[1]], v, path, errs);
  }
  for (const key of Object.keys(s)) if (KEYWORDS[key] && key !== '$ref') KEYWORDS[key](s[key], s, v, path, errs);
}

const valid = (s, v) => { const e = []; check(s, v, '', e); return e.length === 0; };
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const isType = (t, v) => (t === 'integer' ? Number.isInteger(v) : t === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeOf(v) === t);

const KEYWORDS = {
  $ref: () => {},
  type: (t, s, v, p, e) => { if (!(Array.isArray(t) ? t : [t]).some((x) => isType(x, v))) e.push(`${p}: type ${JSON.stringify(t)}`); },
  const: (c, s, v, p, e) => { if (JSON.stringify(c) !== JSON.stringify(v)) e.push(`${p}: const`); },
  enum: (en, s, v, p, e) => { if (!en.some((x) => JSON.stringify(x) === JSON.stringify(v))) e.push(`${p}: enum`); },
  pattern: (re, s, v, p, e) => { if (typeof v === 'string' && !new RegExp(re).test(v)) e.push(`${p}: pattern`); },
  minLength: (n, s, v, p, e) => { if (typeof v === 'string' && v.length < n) e.push(`${p}: minLength`); },
  maxLength: (n, s, v, p, e) => { if (typeof v === 'string' && v.length > n) e.push(`${p}: maxLength`); },
  minimum: (n, s, v, p, e) => { if (typeof v === 'number' && v < n) e.push(`${p}: minimum`); },
  maximum: (n, s, v, p, e) => { if (typeof v === 'number' && v > n) e.push(`${p}: maximum`); },
  exclusiveMinimum: (n, s, v, p, e) => { if (typeof v === 'number' && v <= n) e.push(`${p}: exclusiveMinimum`); },
  required: (r, s, v, p, e) => { if (typeOf(v) === 'object') for (const k of r) if (!(k in v)) e.push(`${p}.${k}: required`); },
  minProperties: (n, s, v, p, e) => { if (typeOf(v) === 'object' && Object.keys(v).length < n) e.push(`${p}: minProperties`); },
  properties: (props, s, v, p, e) => { if (typeOf(v) === 'object') for (const k of Object.keys(props)) if (k in v) check(props[k], v[k], `${p}.${k}`, e); },
  additionalProperties: (ap, s, v, p, e) => {
    if (typeOf(v) !== 'object') return;
    for (const k of Object.keys(v)) if (!(s.properties && k in s.properties)) { if (ap === false) e.push(`${p}.${k}: additionalProperties`); else check(ap, v[k], `${p}.${k}`, e); }
  },
  items: (it, s, v, p, e) => { if (Array.isArray(v)) v.forEach((x, i) => check(it, x, `${p}[${i}]`, e)); },
  minItems: (n, s, v, p, e) => { if (Array.isArray(v) && v.length < n) e.push(`${p}: minItems`); },
  maxItems: (n, s, v, p, e) => { if (Array.isArray(v) && v.length > n) e.push(`${p}: maxItems`); },
  uniqueItems: (u, s, v, p, e) => { if (u && Array.isArray(v) && new Set(v.map((x) => JSON.stringify(x))).size !== v.length) e.push(`${p}: uniqueItems`); },
  allOf: (list, s, v, p, e) => { for (const x of list) check(x, v, p, e); },
  anyOf: (list, s, v, p, e) => { if (!list.some((x) => valid(x, v))) e.push(`${p}: anyOf`); },
  oneOf: (list, s, v, p, e) => { if (list.filter((x) => valid(x, v)).length !== 1) e.push(`${p}: oneOf`); },
  if: () => {},
  then: (t, s, v, p, e) => { if (s.if && valid(s.if, v)) check(t, v, p, e); },
  else: (el, s, v, p, e) => { if (s.if && !valid(s.if, v)) check(el, v, p, e); },
};

const schemaErrors = (shot) => { const e = []; check(schema, shot, '$', e); return e; };

// ---- tests ----

test('schema is valid JSON, draft 2020-12, with the golf-shot/1 constant', () => {
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.title, 'golf-shot/1');
  assert.equal(schema.properties.schema.const, C.SCHEMA_ID);
  assert.equal(schema.additionalProperties, false);
});

test('every metric id of interfaces §9 appears in the schema exactly once', () => {
  assert.equal(C.METRIC_IDS.length, 22);
  for (const id of C.METRIC_IDS) {
    assert.equal(schemaText.split(id).length - 1, 1, `${id}: substring count`);
    assert.equal(schemaText.split(`"${id}"`).length - 1, 1, `${id}: quoted count`);
  }
  assert.deepEqual(Object.keys(schema.properties.metrics.properties), [...C.METRIC_IDS]);
  assert.equal(schema.properties.metrics.minProperties, C.METRIC_IDS.length);
  assert.equal(schema.properties.metrics.additionalProperties, false);
});

test('metric units in the schema match enums.js and interfaces §9', () => {
  const expected = {
    backswing_s: 's', downswing_s: 's', tempo_ratio: 'ratio', head_sway_x_m: 'm', head_lift_z_m: 'm', head_depth_y_m: 'm',
    spine_forward_tilt_deg: 'deg', spine_side_tilt_deg: 'deg', shoulder_turn_deg: 'deg', hip_turn_deg: 'deg', x_factor_deg: 'deg',
    hand_plane_dev_m: 'm', top_shaft_angle_deg: 'deg', weight_shift_pct: '%', early_extension_m: 'm', club_speed_mps: 'm/s',
    club_path_deg: 'deg', ball_speed_mps: 'm/s', launch_v_deg: 'deg', launch_h_deg: 'deg', carry_m: 'm', smash_factor: 'ratio',
  };
  assert.deepEqual({ ...C.METRIC_UNITS }, expected);
  for (const id of C.METRIC_IDS) assert.equal(schema.properties.metrics.properties[id].allOf[1].properties.unit.const, expected[id]);
});

test('schema enums agree with enums.js and reason-codes.js', () => {
  const d = schema.$defs;
  const same = (a, b, what) => assert.deepEqual([...a].sort(), [...b].sort(), what);
  same(d.reasonCode.enum, Object.keys(C.REASON_CODES), 'reason codes');
  same(d.metric.properties.validity.enum, C.VALIDITIES, 'validity');
  same(d.metric.properties.value_origin.enum, C.VALUE_ORIGINS, 'value_origin');
  same(d.metric.if.properties.validity.enum, C.VALUE_VALIDITIES, 'value validities');
  same(d.capture.properties.view.enum, C.VIEWS, 'view');
  same(d.capture.properties.mode.enum, C.CAPTURE_MODES, 'mode');
  same(d.capture.properties.source.enum, C.CAPTURE_SOURCES, 'source');
  same(d.capture.properties.orientation.enum, C.ORIENTATIONS, 'orientation');
  same(d.capture.properties.timestamps.enum, C.TIMESTAMP_KINDS, 'timestamps');
  same(d.calibration.properties.method.enum, C.CALIB_METHODS, 'method');
  same(d.calibration.properties.source.enum, C.CALIB_SOURCES, 'calibration source');
  same(d.calibration.properties.readout_source.enum, C.READOUT_SOURCES, 'readout_source');
  same(d.club.properties.lie.enum, C.LIES, 'lie');
  same(d.club.properties.tee_lift_source.enum, C.TEE_LIFT_SOURCES, 'tee_lift_source');
  same(schema.properties.handedness.enum, C.HANDEDNESS, 'handedness');
  same(d.event.properties.source.enum, C.EVENT_SOURCES, 'event source');
  same(Object.keys(d.events.properties), C.EVENTS, 'events');
  same(d.events.required, C.EVENTS, 'events required');
  same(Object.keys(d.algorithms.properties), C.ALGORITHM_KEYS, 'algorithms');
  same(Object.keys(d.poseReport.properties), C.POSE_KEYS, 'pose keys');
  same(Object.keys(d.poseSigma.properties), C.POSE_KEYS, 'pose sigma keys');
  same(schema.required, C.SHOT_REQUIRED_KEYS, 'top-level required');
  same(Object.keys(schema.properties), [...C.SHOT_REQUIRED_KEYS, ...C.SHOT_OPTIONAL_KEYS], 'top-level properties');
});

test('the reason-code description list in CAFCR F3 is covered by REASON_CODES', () => {
  let doc;
  try { doc = readFileSync(join(ROOT, 'docs/CAFCR.md'), 'utf8'); } catch { return; }
  const line = doc.split('\n').find((l) => l.startsWith('- 原因碼（v1'));
  assert.ok(line, 'CAFCR F3 reason-code line not found');
  const listed = line.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g);
  assert.ok(listed.length >= 20, `only ${listed.length} codes parsed`);
  for (const code of listed) assert.ok(code in C.REASON_CODES, `${code} is named in CAFCR F3 but not defined`);
});

test('every valid fixture passes the JSON Schema', () => {
  const v = fixtures.filter((f) => f.name.startsWith('valid_'));
  assert.ok(v.length >= 3);
  for (const f of v) assert.deepEqual(schemaErrors(f.shot), [], f.name);
});

// Bad fixtures the schema itself rejects (structure and per-metric invariants). The others break rules only the
// validator can express: ci95 bounds, warnings attribution, event order, camera/f consistency, history order.
const SCHEMA_REJECTS = new Set([
  'bad_algorithm_hash', 'bad_capture_view_enum', 'bad_event_conf_out_of_range', 'bad_measured_true', 'bad_metric_unit_mismatch',
  'bad_missing_metric_id', 'bad_null_with_leftover_ci95', 'bad_null_without_reason', 'bad_unknown_metric_id',
  'bad_unknown_reason_code', 'bad_value_null_but_valid', 'bad_value_set_but_not_observable', 'bad_value_without_uncertainty',
  'bad_wrong_schema_version',
]);
const VALIDATOR_ONLY = new Set([
  'bad_camera_not_rotation', 'bad_ci95_excludes_value', 'bad_ci95_inverted', 'bad_events_not_monotonic',
  'bad_f_px_differs_from_camera', 'bad_history_revision_not_below_shot', 'bad_setup_code_missing_from_warnings',
  'bad_warning_metric_not_downgraded', 'bad_warning_not_repeated_on_metric',
]);

test('bad fixtures: the schema rejects the structural ones, the validator catches every one', () => {
  const bad = fixtures.filter((f) => f.name.startsWith('bad_'));
  assert.ok(bad.length >= 8);
  for (const f of bad) {
    assert.equal(C.validateShot(f.shot).ok, false, `${f.name}: validator`);
    if (SCHEMA_REJECTS.has(f.name)) assert.notDeepEqual(schemaErrors(f.shot), [], `${f.name}: schema should reject`);
    else assert.ok(VALIDATOR_ONLY.has(f.name), `${f.name}: classify it in SCHEMA_REJECTS or VALIDATOR_ONLY`);
    if (VALIDATOR_ONLY.has(f.name)) assert.deepEqual(schemaErrors(f.shot), [], `${f.name}: only the validator can see this`);
  }
  for (const n of [...SCHEMA_REJECTS, ...VALIDATOR_ONLY]) assert.ok(bad.some((f) => f.name === n), `${n} is classified but missing`);
});

test('schema and validator agree on single-field mutations of a valid shot', () => {
  const base = fixtures.find((f) => f.name === 'valid_face_on_240').shot;
  const cases = [
    (s) => { s.capture.width = 0; },
    (s) => { s.club.length_m = 3; },
    (s) => { s.club.lie = 'rough'; },
    (s) => { s.quality.touches = -1; },
    (s) => { s.quality.warnings = ['X']; },
    (s) => { s.events.top.conf = 2; },
    (s) => { s.calibration.camera.R.pop(); },
    (s) => { s.calibration.pose_sigma.X_m = -1; },
    (s) => { s.metrics.carry_m.sigma = -2; },
    (s) => { s.metrics.carry_m.reason_codes = ['SPIN_ASSUMED', 'SPIN_ASSUMED']; },
    (s) => { s.created_at = 'now'; },
    (s) => { s.note = 5; },
    (s) => { s.extra = 1; },
    (s) => { s.history = [{ revision: 0, at: null }]; },
  ];
  for (const [i, mutate] of cases.entries()) {
    const s = JSON.parse(JSON.stringify(base));
    mutate(s);
    assert.notDeepEqual(schemaErrors(s), [], `case ${i}: schema`);
    assert.equal(C.validateShot(s).ok, false, `case ${i}: validator`);
  }
});

test('schema and validator agree on 360 metric combinations', () => {
  const metricSchema = schema.$defs.metric;
  let n = 0;
  for (const validity of C.VALIDITIES) {
    for (const value of [null, 1.5]) {
      for (const ci95 of [null, [1, 2]]) {
        for (const sigma of [null, 0.3, -1]) {
          for (const reason_codes of [[], ['FPS_TOO_LOW'], ['BOGUS']]) {
            const m = { value, unit: 'm', ci95, sigma, validity, value_origin: 'pose', measured: false, reason_codes };
            const bySchema = valid(metricSchema, m);
            const byValidator = C.validateMetric(m).length === 0;
            assert.equal(bySchema, byValidator, JSON.stringify(m));
            n++;
          }
        }
      }
    }
  }
  assert.equal(n, 360);
});
