// golf-shot/2 (LAUNCH-MONITOR-SPEC §2, §5.0-1/2/14; LM-A acceptance 1): migration, the v2 validator rules, the v2
// JSON Schema, the v2 fixtures and the old-backup import path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from '../../app/src/contract/index.js';
import { migrateShot, SCHEMA_V2 } from '../../app/src/contract/migrate.js';
import { project } from '../../app/src/geom/camera.js';
import { openRepository } from '../../app/src/store/core.js';
import { MemBackend } from '../../app/src/store/mem.js';
import { importJSON, exportJSON } from '../../app/src/store/export.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const V1 = join(ROOT, 'tests/fixtures/shots');
const V2 = join(V1, 'v2');
const strip = (raw) => Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('_')));
const read = (dir, f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const v1Files = readdirSync(V1).filter((f) => f.endsWith('.json')).sort();
const v2Files = readdirSync(V2).filter((f) => f.endsWith('.json')).sort();
const texts = (r) => r.errors.map((e) => `${e.path}: ${e.msg}`);

test('every golf-shot/1 fixture: valid ones pass the v2 validator after migrateShot, bad ones stay invalid', () => {
  const valid = v1Files.filter((f) => f.startsWith('valid_'));
  assert.ok(valid.length >= 5 && v1Files.length >= 25);
  for (const f of v1Files) {
    const raw = strip(read(V1, f));
    const { shot, migrated } = migrateShot(raw);
    if (f.startsWith('valid_')) {
      assert.equal(raw.schema, 'golf-shot/1', f);
      assert.equal(migrated, true, f);
      assert.equal(shot.schema, SCHEMA_V2);
      assert.deepEqual(texts(C.validateShot(shot)), [], f);
      // lossless: every v1 field is unchanged, the additions are exactly the spec's
      for (const k of Object.keys(raw)) if (!['schema', 'metrics', 'algorithms'].includes(k)) assert.deepEqual(shot[k], raw[k], `${f} ${k}`);
      for (const id of C.METRIC_IDS_V1) assert.deepEqual(shot.metrics[id], raw.metrics[id], `${f} ${id}`);
      for (const id of C.LM_METRIC_IDS) {
        assert.deepEqual(shot.metrics[id], { value: null, unit: C.METRIC_UNITS[id], ci95: null, sigma: null, validity: 'not_computed', value_origin: C.METRIC_DEFAULT_ORIGIN[id], measured: false, reason_codes: [C.RC.MIGRATED_V1] });
      }
      assert.deepEqual(Object.keys(shot.metrics), [...C.METRIC_IDS], `${f}: contract order`);
      assert.deepEqual(shot.algorithms, { ...raw.algorithms, lm: { version: 'none', sha256: '140bedbf9c3f6d56a9846d2ba7088798683f4da0c248231336e6a05679e4fdfe' } });
      assert.equal(shot.flight, null);
      assert.equal(shot.tracks, null);
      assert.equal(shot.practice, null);
    } else {
      assert.equal(C.validateShot(shot).ok, false, `${f} must stay invalid after migration`);
    }
  }
  // sha256('none') is what the spec says
  assert.equal(C.LM_ALGORITHM_NONE.sha256, '140bedbf9c3f6d56a9846d2ba7088798683f4da0c248231336e6a05679e4fdfe');
});

test('migrateShot is idempotent, pure, and leaves golf-shot/2 and non-shots alone', () => {
  for (const [dir, files] of [[V1, v1Files], [V2, v2Files]]) {
    for (const f of files) {
      const raw = strip(read(dir, f));
      const snap = JSON.stringify(raw);
      const once = migrateShot(raw).shot;
      assert.deepStrictEqual(migrateShot(once).shot, once, f);
      assert.deepStrictEqual(migrateShot(migrateShot(raw).shot).shot, migrateShot(raw).shot, f);
      assert.equal(JSON.stringify(raw), snap, `${f}: input untouched`);
    }
  }
  const v2 = strip(read(V2, 'valid_face_on_240.json'));
  const r = migrateShot(v2);
  assert.equal(r.migrated, false);
  assert.equal(r.shot, v2, 'a v2 input is returned as it is');
  for (const x of [null, 5, 'x', [], { schema: 'golf-shot/9' }]) assert.deepEqual(migrateShot(x), { shot: x, migrated: false });
});

test('v2 fixtures: valid ones pass; every bad_<rule>.json fails with exactly one error that names <rule>', () => {
  const rules = ['flight_t_increasing', 'flight_z_above_ground', 'flight_needs_carry', 'flight_landing_matches_carry',
    'tracks_frame_increasing', 'practice_target_positive', 'model_code_required'];
  for (const rule of rules) assert.ok(v2Files.includes(`bad_${rule}.json`), `bad_${rule}.json missing`);
  for (const f of v2Files) {
    const raw = read(V2, f);
    const r = C.validateShot(strip(raw));
    if (f.startsWith('bad_')) {
      const rule = f.slice(4, -5);
      assert.equal(r.ok, false, f);
      assert.equal(r.errors.length, 1, `${f}: ${texts(r).join(' | ')}`);
      assert.ok(texts(r)[0].includes(rule), `${f}: "${texts(r)[0]}" does not name ${rule}`);
      assert.equal(raw._expect, rule, f);
    } else {
      assert.deepEqual(texts(r), [], f);
      assert.equal(raw.schema, SCHEMA_V2, f);
    }
  }
  for (const n of ['valid_face_on_240', 'valid_high_behind_240', 'valid_dtl_30', 'valid_face_on_240_no_clip', 'migrated_v1_face_on']) assert.ok(v2Files.includes(`${n}.json`), n);
  assert.deepEqual(strip(read(V2, 'migrated_v1_face_on.json')), migrateShot(strip(read(V1, 'valid_face_on_240.json'))).shot);
  const noClip = read(V2, 'valid_face_on_240_no_clip.json');
  assert.equal(noClip.capture.clip_ref, null);
  assert.ok(noClip.quality.warnings.includes(C.RC.CLIP_NOT_SAVED));
});

test('v2 fixture content: registry cells, model codes, flight / tracks, and the tracer anchor (≤ 2 px)', async () => {
  const { cellFor } = await import('../../app/src/metrics/registry.js');
  for (const f of ['valid_face_on_240.json', 'valid_high_behind_240.json', 'valid_dtl_30.json']) {
    const s = read(V2, f);
    const view = s.capture.view;
    for (const id of C.METRIC_IDS.filter((x) => C.BALL_CLUB_IDS.includes(x))) {
      const c = cellFor(id, view, s.capture.nominal_fps);
      const m = s.metrics[id];
      if (c.validity === null) assert.equal(m.value, null, `${f} ${id}`);
      else if (C.LM_METRIC_IDS.includes(id) || ['carry_m', 'ball_speed_mps', 'club_speed_mps'].includes(id)) assert.equal(m.validity, c.validity, `${f} ${id}: every allowed cell is filled at its validity`);
    }
    if (view === 'dtl') { assert.equal(s.flight, null); continue; }
    assert.ok(s.flight.samples.length >= 2 && s.flight.samples.length <= 64);
    assert.ok(Math.abs(s.flight.landing.x_m - s.metrics.carry_m.value) <= 0.5);
    assert.equal(s.tracks.view, view);
    const p = project(s.calibration.camera, s.flight.samples[0].slice(1));
    const at = s.tracks.ball_px.find((b) => b[0] === s.tracks.impact_frame);
    assert.ok(at && Math.hypot(p.u - at[1], p.v - at[2]) <= 2, `${f}: ${p.u},${p.v} vs ${at}`);
    if (view === 'high_behind') assert.equal(s.flight.band.side_lo.length + s.flight.band.side_hi.length, 16);
  }
});

test('validator v2 rules one by one (rule names in the messages)', () => {
  const base = strip(read(V2, 'valid_face_on_240.json'));
  const one = (mutate, rule) => {
    const s = JSON.parse(JSON.stringify(base));
    mutate(s);
    const r = C.validateShot(s);
    assert.equal(r.errors.length, 1, texts(r).join(' | '));
    if (rule) assert.ok(texts(r)[0].includes(rule), texts(r)[0]);
    return texts(r)[0];
  };
  one((s) => { delete s.flight; }, null);
  one((s) => { delete s.algorithms.lm; }, null);
  assert.equal(C.validateShot({ ...base, flight: null }).ok, true, 'flight may be null');
  assert.equal(C.validateShot({ ...base, tracks: null, practice: { drill_id: 'd', slot: 2, target_m: 91.4, attempt: 1 } }).ok, true);
  one((s) => { s.flight.ground = 'ice'; }, null);
  one((s) => { const n = s.flight.samples.length; s.flight.samples = [...s.flight.samples, ...Array.from({ length: 65 - n }, (_, i) => [100 + i, 1, 0, 0])]; }, null);
  one((s) => { s.tracks.ball_px[0][0] = 1.5; }, null);
  one((s) => { s.practice = { drill_id: 'd', slot: 0, target_m: -5, attempt: 0 }; }, 'practice_target_positive');
  one((s) => { s.metrics.spin_rate_rpm.reason_codes = [C.RC.WIND_IGNORED]; }, 'model_code_required');
  one((s) => { s.metrics.spin_rate_rpm.unit = 'rps'; }, null);
  one((s) => { s.metrics.spin_rate_rpm.value_origin = 'guess'; }, null);
  // a model-origin null needs no model code; a model code on a tracked number is fine
  assert.equal(C.validateShot({ ...base, metrics: { ...base.metrics, curve_m: base.metrics.curve_m } }).ok, true);
  // golf-shot/1 rules are unchanged: the same flight block on a v1 shot is an unknown field
  const v1 = strip(read(V1, 'valid_face_on_240.json'));
  assert.ok(texts(C.validateShot({ ...v1, flight: null })).some((t) => t.startsWith('flight: unknown field')));
});

// ---- a small JSON Schema 2020-12 checker (the keywords schema/shot-v2.schema.json uses; unknown keywords throw) ----
const schema = JSON.parse(readFileSync(join(ROOT, 'schema/shot-v2.schema.json'), 'utf8'));
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const isType = (t, v) => (t === 'integer' ? Number.isInteger(v) : t === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeOf(v) === t);
const ANN = new Set(['$schema', '$id', '$comment', 'title', 'description', '$defs']);
function check(s, v, p, e) {
  for (const k of Object.keys(s)) if (!ANN.has(k) && !KW[k]) throw new Error(`keyword ${k}`);
  for (const k of Object.keys(s)) if (KW[k]) KW[k](s[k], s, v, p, e);
}
const ok = (s, v) => { const e = []; check(s, v, '', e); return e.length === 0; };
const KW = {
  $ref: (r, s, v, p, e) => check(schema.$defs[r.replace('#/$defs/', '')], v, p, e),
  type: (t, s, v, p, e) => { if (!(Array.isArray(t) ? t : [t]).some((x) => isType(x, v))) e.push(`${p}: type`); },
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
  properties: (pr, s, v, p, e) => { if (typeOf(v) === 'object') for (const k of Object.keys(pr)) if (k in v) check(pr[k], v[k], `${p}.${k}`, e); },
  additionalProperties: (ap, s, v, p, e) => { if (typeOf(v) === 'object' && ap === false) for (const k of Object.keys(v)) if (!(s.properties && k in s.properties)) e.push(`${p}.${k}: additional`); },
  items: (it, s, v, p, e) => { if (Array.isArray(v)) v.forEach((x, i) => check(it, x, `${p}[${i}]`, e)); },
  prefixItems: (list, s, v, p, e) => { if (Array.isArray(v)) list.forEach((it, i) => { if (i < v.length) check(it, v[i], `${p}[${i}]`, e); }); },
  minItems: (n, s, v, p, e) => { if (Array.isArray(v) && v.length < n) e.push(`${p}: minItems`); },
  maxItems: (n, s, v, p, e) => { if (Array.isArray(v) && v.length > n) e.push(`${p}: maxItems`); },
  uniqueItems: (u, s, v, p, e) => { if (u && Array.isArray(v) && new Set(v.map((x) => JSON.stringify(x))).size !== v.length) e.push(`${p}: unique`); },
  allOf: (l, s, v, p, e) => { for (const x of l) check(x, v, p, e); },
  anyOf: (l, s, v, p, e) => { if (!l.some((x) => ok(x, v))) e.push(`${p}: anyOf`); },
  oneOf: (l, s, v, p, e) => { if (l.filter((x) => ok(x, v)).length !== 1) e.push(`${p}: oneOf`); },
  if: () => {},
  then: (t, s, v, p, e) => { if (s.if && ok(s.if, v)) check(t, v, p, e); },
  else: (el, s, v, p, e) => { if (s.if && !ok(s.if, v)) check(el, v, p, e); },
};

test('schema/shot-v2.schema.json: lists agree with enums.js; every valid v2 fixture passes it', () => {
  assert.equal(schema.title, 'golf-shot/2');
  assert.equal(schema.properties.schema.const, C.SCHEMA_ID);
  assert.deepEqual(Object.keys(schema.properties.metrics.properties), [...C.METRIC_IDS]);
  assert.equal(schema.properties.metrics.minProperties, 36);
  for (const id of C.METRIC_IDS) assert.equal(schema.properties.metrics.properties[id].allOf[1].properties.unit.const, C.METRIC_UNITS[id]);
  assert.equal(C.METRIC_UNITS.spin_rate_rpm, 'rpm');
  assert.deepEqual([...schema.$defs.reasonCode.enum].sort(), [...C.REASON_CODE_LIST].sort());
  assert.equal(C.REASON_CODE_LIST.length, 47);
  assert.deepEqual(schema.$defs.metric.properties.value_origin.enum, [...C.VALUE_ORIGINS]);
  for (const o of ['dplane', 'spin_model', 'flight_model', 'prior']) assert.ok(C.VALUE_ORIGINS.includes(o));
  assert.deepEqual(schema.required, [...C.SHOT_REQUIRED_KEYS]);
  assert.deepEqual(schema.$defs.algorithms.required, [...C.ALGORITHM_KEYS]);
  // the v1 schema file is untouched (still golf-shot/1 for imports)
  assert.equal(JSON.parse(readFileSync(join(ROOT, 'schema/shot-v1.schema.json'), 'utf8')).title, 'golf-shot/1');
  for (const f of v2Files.filter((x) => !x.startsWith('bad_'))) {
    const e = [];
    check(schema, strip(read(V2, f)), '$', e);
    assert.deepEqual(e, [], f);
  }
  // the purely structural bad fixture is also rejected by the schema
  const e = [];
  check(schema, strip(read(V2, 'bad_practice_target_positive.json')), '$', e);
  assert.ok(e.length > 0);
});

test('an old (golf-shot/1) backup imports, reads back as golf-shot/2 and exports as golf-shot/2', async () => {
  const shots = v1Files.filter((f) => f.startsWith('valid_')).map((f) => strip(read(V1, f)));
  const file = { format: 'golf-swing-lab-export/1', exported_at: '2026-11-04T00:00:00.000Z', app_version: '0.2.0', venues: [], presets: [], sessions: [], shots };
  const repo = await openRepository(new MemBackend());
  const res = await importJSON(repo, JSON.stringify(file));
  assert.equal(res.ok, true);
  assert.equal(res.validator, 'contract');
  assert.equal(res.total.added, shots.length);
  const back = await repo.shots.list();
  assert.equal(back.length, shots.length);
  for (const s of back) {
    assert.equal(s.schema, SCHEMA_V2);
    assert.deepEqual(texts(C.validateShot(s)), [], s.shot_id);
  }
  const out = await exportJSON(repo, { now: '2026-11-06T00:00:00.000Z' });
  assert.ok(out.shots.every((s) => s.schema === SCHEMA_V2));
  // and the v2 export imports again (into a fresh database) unchanged
  const fresh = await openRepository(new MemBackend());
  await importJSON(fresh, JSON.stringify(out));
  const byId = (a, b) => (a.shot_id < b.shot_id ? -1 : 1);
  assert.deepEqual((await fresh.list('shots')).sort(byId), [...out.shots].sort(byId));
});

test('scripts/make_lm_fixtures.mjs --check: the committed fixtures are what the script writes', () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/make_lm_fixtures.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const s = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/lm/sessions-1000.json'), 'utf8'));
  assert.equal(s.format, 'golf-swing-lab-export/1');
  assert.equal(s.shots.length, 1000);
  assert.equal(new Set(s.shots.map((x) => x.club.type)).size, 8);
  assert.equal(new Set(s.shots.map((x) => x.capture.view)).size, 3);
  assert.equal(new Set(s.shots.map((x) => x.session_id)).size, 12);
  assert.equal(s.sessions.length, 12);
});
