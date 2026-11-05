import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mulberry32 } from '../../app/src/geom/rng.js';
import { makeClipRecord, STORE_NAMES } from '../../app/src/store/core.js';
import {
  exportJSON, importJSON, exportCSV, CSV_COLUMNS, CSV_FIXED_COLUMNS, EXPORT_FORMAT, ImportError, csvField,
  builtinShotValidator, normalizeValidation, resolveDefaultValidator, encodeTyped, decodeTyped,
} from '../../app/src/store/export.js';
import { METRIC_IDS } from '../../app/src/store/metric-ids.js';

// every store of the current schema empty (stores added by later schema versions, e.g. trash, included)
const ALL_EMPTY = Object.freeze(Object.fromEntries(STORE_NAMES.map((n) => [n, 0])));
import { openMem, makeVenue, makePreset, makeShot, makeDataset, fillRepo, dumpRepo, accept, hasChinese } from './store.fixtures.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const NOW = '2026-11-04T12:00:00.000Z';
const asFile = (data) => JSON.parse(JSON.stringify(data)); // what a saved .json file would hold

async function counts(repo) {
  const out = {};
  for (const n of STORE_NAMES) out[n] = await repo.count(n);
  return out;
}

// The store never produces localized text (PRODUCT-SPEC I18N-1/I18N-5): an ImportError carries a reason code that
// the history screen maps to `history.restore.error.<reason>`, which must exist in both catalogs.
const HISTORY_CATALOG = Object.fromEntries(['zh-Hant', 'en'].map((loc) => [loc,
  JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), `../../app/i18n/${loc}/history.json`), 'utf8'))]));
const REASONS = ['not_json', 'not_export', 'version', 'missing_fields', 'bad_field', 'invalid'];

async function assertRejectedUntouched(repo, data, opts, reason, pattern) {
  const before = await dumpRepo(repo, STORE_NAMES);
  await assert.rejects(importJSON(repo, data, opts), (e) => {
    assert.ok(e instanceof ImportError, `ImportError expected, got ${e}`);
    assert.equal(e.code, 'IMPORT_REJECTED');
    assert.ok(REASONS.includes(e.reason), `unknown reason ${e.reason}`);
    assert.equal(e.reason, reason, e.message);
    for (const [loc, cat] of Object.entries(HISTORY_CATALOG)) assert.equal(typeof cat[`restore.error.${e.reason}`], 'string', `${loc} lacks restore.error.${e.reason}`);
    assert.ok(e.params && typeof e.params === 'object');
    assert.ok(!hasChinese(e.message) && !hasChinese(JSON.stringify(e.details)) && !hasChinese(JSON.stringify(e.params)), `no localized text: ${e.message}`);
    if (pattern) assert.match(e.message, pattern);
    assert.ok(Array.isArray(e.details));
    return true;
  });
  assert.deepStrictEqual(await dumpRepo(repo, STORE_NAMES), before, 'a rejected import must not write anything');
}

// ------------------------------------------------------------------------------------------ round trip

test('export -> clear -> import round trip deep-equals (4 shots, 2 presets, 1 venue)', async () => {
  const repo = await openMem();
  await fillRepo(repo);
  const before = await dumpRepo(repo);
  assert.equal(before.shots.length, 4);
  assert.equal(before.presets.length, 2);
  assert.equal(before.venues.length, 1);

  const file = JSON.stringify(await exportJSON(repo, { now: NOW, app_version: '0.1.0-test' }));
  await repo.clear();
  assert.deepEqual(await counts(repo), ALL_EMPTY);

  const res = await importJSON(repo, file, { validate: accept });
  assert.equal(res.ok, true);
  assert.deepEqual(res.total, { added: 9, updated: 0, kept: 0 }); // 1 venue + 2 presets + 2 sessions + 4 shots
  assert.deepStrictEqual(await dumpRepo(repo), before);

  // importing the same file again changes nothing
  const again = await importJSON(repo, file, { validate: accept });
  assert.deepEqual(again.total, { added: 0, updated: 0, kept: 9 });
  assert.deepStrictEqual(await dumpRepo(repo), before);
});

test('export header: format, exported_at, app_version; poses and clips only on request', async () => {
  const repo = await openMem();
  await fillRepo(repo);
  const out = await exportJSON(repo, { now: () => NOW, app_version: '9.9.9' });
  assert.equal(out.format, 'golf-swing-lab-export/1');
  assert.equal(EXPORT_FORMAT, 'golf-swing-lab-export/1');
  assert.equal(out.exported_at, NOW);
  assert.equal(out.app_version, '9.9.9');
  assert.deepEqual(Object.keys(out), ['format', 'exported_at', 'app_version', 'venues', 'presets', 'sessions', 'shots']);
  assert.deepEqual(out.shots.map((s) => s.shot_id), ['shot-1', 'shot-2', 'shot-3', 'shot-4']);
  assert.equal(out.shots.length, 4);
  assert.match((await exportJSON(repo)).exported_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
});

test('filtered export carries the parents of the exported shots and nothing else', async () => {
  const repo = await openMem();
  const ds = await fillRepo(repo);
  await repo.venues.put(makeVenue('venue-unused'));
  await repo.presets.put(makePreset('preset-unused', 'venue-unused'));
  const out = await exportJSON(repo, { preset_id: 'preset-B', now: NOW });
  assert.deepEqual(out.shots.map((s) => s.shot_id), ['shot-3', 'shot-4']);
  assert.deepEqual(out.presets.map((p) => p.preset_id), ['preset-B']);
  assert.deepEqual(out.sessions.map((s) => s.session_id), ['session-2']);
  assert.deepEqual(out.venues.map((v) => v.venue_id), ['venue-1']);
  // an unfiltered export keeps records no shot uses yet
  const all = await exportJSON(repo, { now: NOW });
  assert.deepEqual(all.venues.map((v) => v.venue_id), ['venue-1', 'venue-unused']);
  assert.equal(all.presets.length, 3);
  // the filtered file imports into an empty database on its own
  const fresh = await openMem();
  const res = await importJSON(fresh, asFile(out), { validate: accept });
  assert.equal(res.total.added, 2 + 1 + 1 + 1);
  assert.deepEqual(await fresh.shots.list(), ds.shots.filter((s) => s.preset_id === 'preset-B'));
  await assert.rejects(exportJSON(repo, { presetId: 'typo' }), (e) => e.code === 'BAD_QUERY' && /presetId/.test(e.message));
  // club and date filters
  assert.deepEqual((await exportJSON(repo, { club_type: 'driver' })).shots.map((s) => s.shot_id), ['shot-2']);
  assert.deepEqual((await exportJSON(repo, { from: '2026-11-03T00:00:00.000Z' })).shots.map((s) => s.shot_id), ['shot-3', 'shot-4']);
});

test('poses (typed arrays) and clips (Blob) survive export -> import when requested', async () => {
  const repo = await openMem();
  await fillRepo(repo);
  const rng = mulberry32(7);
  const T = 5;
  const pose = {
    shot_id: 'shot-1', session_id: 'session-1', created_at: '2026-11-02T10:01:00.000Z', W: 1920, H: 1080, model: 'synthetic',
    t_s: Float64Array.from({ length: T }, (_, i) => i / 60),
    img: Float32Array.from({ length: T * 33 * 4 }, () => rng()),
    world: Float32Array.from({ length: T * 33 * 3 }, () => rng() - 0.5),
  };
  await repo.poses.put(pose);
  const clipBytes = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) % 256);
  await repo.clips.put(makeClipRecord({ clip_id: 'c1', shot_id: 'shot-1', session_id: 'session-1', created_at: 'x', blob: new Blob([clipBytes], { type: 'video/mp4' }), starred: true }));

  const light = await exportJSON(repo, { now: NOW });
  assert.equal('poses' in light, false);
  assert.equal('clips' in light, false);

  const full = asFile(await exportJSON(repo, { now: NOW, includePoses: true, includeClips: true }));
  assert.equal(full.poses.length, 1);
  assert.equal(full.clips.length, 1);
  assert.equal(full.clips[0].blob, undefined);
  const fresh = await openMem();
  const res = await importJSON(fresh, full, { validate: accept });
  assert.deepEqual(res.counts.poses, { added: 1, updated: 0, kept: 0 });
  const back = await fresh.poses.get('shot-1');
  assert.deepStrictEqual(back, pose);
  assert.ok(back.img instanceof Float32Array && back.t_s instanceof Float64Array);
  const clip = await fresh.clips.get('c1');
  assert.equal(clip.starred, true);
  assert.equal(clip.blob.type, 'video/mp4');
  assert.deepEqual(new Uint8Array(await clip.blob.arrayBuffer()), clipBytes);

  // a poses-only filter export for one shot
  const one = await exportJSON(repo, { session_id: 'session-1', includePoses: true, now: NOW });
  assert.equal(one.poses.length, 1);
  assert.equal((await exportJSON(repo, { session_id: 'session-2', includePoses: true, now: NOW })).poses.length, 0);

  // corrupted binary payload -> whole import refused
  const corrupt = asFile(await exportJSON(repo, { now: NOW, includePoses: true }));
  corrupt.poses[0].img.b64 = 'AAAA!!!';
  const target = await openMem();
  await assertRejectedUntouched(target, corrupt, { validate: accept }, 'invalid', /poses: corrupt data/);
  const odd = asFile(await exportJSON(repo, { now: NOW, includePoses: true }));
  odd.poses[0].img.b64 = 'AAAA'; // 3 bytes: not a whole number of float32 values
  await assertRejectedUntouched(target, odd, { validate: accept }, 'invalid', /bad length/);
});

test('encodeTyped / decodeTyped round trip nested structures', () => {
  const v = { a: new Float32Array([1.5, -2, 3]), b: [new Uint8Array([1, 2, 3]), { c: new Int32Array([-1, 2]) }], d: 'x', e: 5 };
  assert.deepStrictEqual(decodeTyped(JSON.parse(JSON.stringify(encodeTyped(v)))), v);
});

// -------------------------------------------------------------------------------------------- import

test('import rejects a wrong format with a reason code and writes nothing', async () => {
  const repo = await openMem();
  await fillRepo(repo);
  const ok = asFile(await exportJSON(repo, { now: NOW }));
  const cases = [
    [{ ...ok, format: 'something-else/1' }, 'not_export', /not a golf-swing-lab export/],
    [{ ...ok, format: undefined }, 'not_export', /not a golf-swing-lab export/],
    [{ ...ok, format: 'golf-swing-lab-export/2' }, 'version', /format version/],
    [{ ...ok, format: 'golf-swing-lab-export/0' }, 'version', /format version/],
    [[1, 2, 3], 'not_export', /not a golf-swing-lab export/],
    [42, 'not_export', /not a golf-swing-lab export/],
    [null, 'not_export', /not a golf-swing-lab export/],
    [{ ...ok, shots: undefined }, 'missing_fields', /shots/],
    [{ ...ok, venues: {} }, 'missing_fields', /venues/],
    [{ ...ok, poses: 'nope' }, 'bad_field', /poses/],
    ['{ not json', 'not_json', /not valid JSON/],
    ['', 'not_json', /not valid JSON/],
  ];
  const target = await openMem();
  await target.venues.put(makeVenue('pre-existing'));
  for (const [data, reason, pattern] of cases) await assertRejectedUntouched(target, data, { validate: accept }, reason, pattern);
  // text with a BOM (as written by exportCSV({bom}) style tools) still parses
  const res = await importJSON(target, `\uFEFF${JSON.stringify(ok)}`, { validate: accept });
  assert.equal(res.ok, true);
});

test('a partly invalid file is rejected as a whole: not even its valid records are written', async () => {
  const repo = await openMem();
  await fillRepo(repo);
  const file = asFile(await exportJSON(repo, { now: NOW }));
  file.shots[2].schema = 'golf-shot/99';       // bad schema (builtin validator)
  const target = await openMem();
  await assertRejectedUntouched(target, file, { validate: builtinShotValidator }, 'invalid', /nothing written.*1 invalid shot.*shot-3/);
  assert.deepEqual(await counts(target), ALL_EMPTY);

  // several kinds of failure at once: all are listed in details
  const bad = asFile(await exportJSON(repo, { now: NOW }));
  delete bad.shots[0].shot_id;
  bad.shots[1].metrics = 'oops';
  bad.venues[0].venue_id = '';
  bad.presets[0].revision = -1;
  let err;
  try { await importJSON(target, bad, { validate: builtinShotValidator }); } catch (e) { err = e; }
  assert.ok(err instanceof ImportError);
  assert.ok(err.details.length >= 4, err.details.join(' | '));
  assert.equal(err.reason, 'invalid');
  assert.equal(err.params.n, err.details.length);
  assert.ok(!hasChinese(err.message) && !hasChinese(err.details.join(' ')));
  assert.equal(await target.shots.count(), 0);

  // a custom validator in every accepted return shape
  const bads = [
    () => false,
    () => ({ ok: false, errors: ['x is wrong'] }),
    () => ({ valid: false, errors: [{ path: 'metrics.tempo_ratio', message: 'out of range' }] }),
    () => ['x is wrong'],
    async () => ({ ok: false }),
    () => { throw new Error('validator crashed'); },
    () => undefined,
  ];
  const goodFile = asFile(await exportJSON(repo, { now: NOW }));
  for (const validate of bads) await assertRejectedUntouched(target, goodFile, { validate: (s) => (s.shot_id === 'shot-2' ? validate(s) : true) }, 'invalid', /nothing written/);
  for (const validate of [() => true, () => ({ ok: true }), () => ({ valid: true, errors: [] }), () => [], async () => true]) {
    const t = await openMem();
    assert.equal((await importJSON(t, asFile(await exportJSON(repo, { now: NOW })), { validate })).ok, true);
    assert.equal(await t.shots.count(), 4);
  }
  assert.deepEqual(normalizeValidation([{ path: 'a', message: 'b' }]), { ok: false, errors: ['a: b'] });
  assert.deepEqual(normalizeValidation(false), { ok: false, errors: ['validation failed'] });
});

test('import merges by id: higher revision wins, a tie keeps the stored record, duplicates inside the file resolve the same way', async () => {
  const repo = await openMem();
  await repo.shots.put(makeShot({ id: 'tie', revision: 3, note: 'stored' }));
  await repo.shots.put(makeShot({ id: 'lower', revision: 3, note: 'stored' }));
  await repo.shots.put(makeShot({ id: 'higher', revision: 3, note: 'stored' }));
  await repo.venues.put(makeVenue('v1', { name: 'stored name', revision: 1 }));
  const file = {
    format: EXPORT_FORMAT, exported_at: NOW, app_version: 't',
    venues: [makeVenue('v1', { name: 'incoming name', revision: 2 })],
    presets: [], sessions: [],
    shots: [
      makeShot({ id: 'tie', revision: 3, note: 'incoming' }),
      makeShot({ id: 'lower', revision: 2, note: 'incoming' }),
      makeShot({ id: 'higher', revision: 4, note: 'incoming' }),
      makeShot({ id: 'dup', revision: 1, note: 'first' }),
      makeShot({ id: 'dup', revision: 5, note: 'second wins' }),
      makeShot({ id: 'dup2', revision: 2, note: 'first kept' }),
      makeShot({ id: 'dup2', revision: 2, note: 'tie ignored' }),
    ],
  };
  const res = await importJSON(repo, asFile(file), { validate: accept });
  assert.deepEqual(res.counts.shots, { added: 2, updated: 1, kept: 2 });
  assert.deepEqual(res.counts.venues, { added: 0, updated: 1, kept: 0 });
  assert.equal(res.warnings.length, 1);
  assert.match(res.warnings[0], /shots: 2 duplicate shot_id/);
  assert.match(res.message, /2 added, 2 updated, 2 kept/);
  assert.deepEqual(res.msg, { code: 'history.restore.done', params: { added: 2, updated: 2, kept: 2 } });
  assert.ok(!hasChinese(JSON.stringify({ w: res.warnings, m: res.message, msg: res.msg })));
  const note = async (id) => (await repo.shots.get(id)).note;
  assert.equal(await note('tie'), 'stored');
  assert.equal(await note('lower'), 'stored');
  assert.equal(await note('higher'), 'incoming');
  assert.equal(await note('dup'), 'second wins');
  assert.equal(await note('dup2'), 'first kept');
  assert.equal((await repo.venues.get('v1')).name, 'incoming name');
});

test('default validator: contract/validate.js when it can be loaded, else the builtin one (with a warning)', async () => {
  const def = await resolveDefaultValidator();
  assert.equal(typeof def.fn, 'function');
  assert.ok(def.source === 'contract' || def.source === 'builtin');
  if (def.source === 'builtin') {
    assert.ok(typeof def.note === 'string' && !hasChinese(def.note));
    const repo = await openMem();
    await fillRepo(repo);
    const file = asFile(await exportJSON(repo, { now: NOW }));
    const fresh = await openMem();
    const res = await importJSON(fresh, file); // no validate option
    assert.equal(res.validator, 'builtin');
    assert.ok(res.warnings.some((w) => /contract\/validate\.js/.test(w)));
    assert.equal(await fresh.shots.count(), 4);
    file.shots[0].schema = 'wrong';
    await assertRejectedUntouched(await openMem(), file, undefined, 'invalid', /invalid shot/);
  }
  assert.deepEqual(builtinShotValidator(makeShot()), { ok: true, errors: [] });
  assert.equal(builtinShotValidator(null).ok, false);
  assert.equal(builtinShotValidator({ ...makeShot(), metrics: [] }).ok, false);
});

test('1000 shots: export (JSON + CSV) and import finish well inside the 10 s budget', async () => {
  const repo = await openMem();
  const shots = [];
  for (let i = 0; i < 1000; i++) {
    shots.push(makeShot({ id: `s${String(i).padStart(4, '0')}`, seed: i, created_at: new Date(Date.UTC(2026, 10, 1, 0, 0, i)).toISOString(), preset_id: i % 2 ? 'preset-A' : 'preset-B' }));
  }
  await repo.putMany('shots', shots);
  const t0 = performance.now();
  const file = JSON.stringify(await exportJSON(repo, { now: NOW }));
  const csv = exportCSV(await repo.queryShots({}));
  const fresh = await openMem();
  await importJSON(fresh, file, { validate: accept });
  const ms = performance.now() - t0;
  assert.equal(await fresh.shots.count(), 1000);
  assert.equal(csv.split('\r\n').length, 1002); // header + 1000 + trailing empty
  assert.ok(ms < 10000, `took ${ms} ms`);
});

// ------------------------------------------------------------------------------------------------ CSV

function parseCSV(text) {
  // minimal RFC 4180 reader used to check our writer independently
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// The public CSV format. If this list has to change, it is a breaking change of the export format.
const EXPECTED_METRIC_IDS = [
  'backswing_s', 'downswing_s', 'tempo_ratio', 'head_sway_x_m', 'head_lift_z_m', 'head_depth_y_m',
  'spine_forward_tilt_deg', 'spine_side_tilt_deg', 'shoulder_turn_deg', 'hip_turn_deg', 'x_factor_deg',
  'hand_plane_dev_m', 'top_shaft_angle_deg', 'weight_shift_pct', 'early_extension_m', 'club_speed_mps',
  'club_path_deg', 'ball_speed_mps', 'launch_v_deg', 'launch_h_deg', 'carry_m', 'smash_factor',
];

test('metric ids are exactly the ids of docs/interfaces.md section 9', () => {
  assert.deepEqual([...METRIC_IDS], EXPECTED_METRIC_IDS);
  const md = readFileSync(join(ROOT, 'docs/interfaces.md'), 'utf8');
  const section = md.slice(md.indexOf('## 9.'));
  const ids = [];
  for (const line of section.split('\n')) {
    if (!/^\|\s*\d+\s*\|/.test(line)) continue;
    for (const m of line.split('|')[2].matchAll(/`([a-z0-9_]+)`/g)) ids.push(m[1]);
  }
  assert.deepEqual(ids, EXPECTED_METRIC_IDS, 'store/metric-ids.js drifted from docs/interfaces.md section 9');
});

test('CSV columns are exact and stable', () => {
  const expected = ['shot_id', 'created_at', 'venue_id', 'preset_id', 'view', 'club_type', 'lie'];
  for (const id of EXPECTED_METRIC_IDS) expected.push(id, `${id}_lo`, `${id}_hi`, `${id}_validity`);
  assert.deepEqual([...CSV_FIXED_COLUMNS], expected.slice(0, 7));
  assert.deepEqual([...CSV_COLUMNS], expected);
  assert.equal(CSV_COLUMNS.length, 7 + 22 * 4);
  assert.equal(CSV_COLUMNS.length, 95);
  assert.equal(CSV_COLUMNS[CSV_COLUMNS.length - 1], 'smash_factor_validity'); // nothing after the last metric column
  assert.ok(!CSV_COLUMNS.includes('note'), 'notes are not CSV columns (they travel in the JSON export)');
  assert.equal(new Set(CSV_COLUMNS).size, CSV_COLUMNS.length);
  assert.ok(Object.isFrozen(CSV_COLUMNS));
  const csv = exportCSV([]);
  assert.equal(csv, `${expected.join(',')}\r\n`);
  assert.equal(parseCSV(exportCSV([makeShot()]))[0].length, CSV_COLUMNS.length);
});

test('CSV cells: values, ci95 bounds, validity; null and absent metrics are empty', () => {
  const shot = makeShot({ id: 'csv-1', club_type: 'driver', lie: 'tee' });
  const rows = parseCSV(exportCSV([shot]));
  assert.equal(rows.length, 2);
  const cell = (name) => rows[1][CSV_COLUMNS.indexOf(name)];
  assert.equal(cell('shot_id'), 'csv-1');
  assert.equal(cell('created_at'), shot.created_at);
  assert.equal(cell('venue_id'), 'venue-1');
  assert.equal(cell('preset_id'), 'preset-A');
  assert.equal(cell('view'), 'face_on');
  assert.equal(cell('club_type'), 'driver');
  assert.equal(cell('lie'), 'tee');
  const m = shot.metrics.tempo_ratio;
  assert.equal(Number(cell('tempo_ratio')), m.value);
  assert.equal(Number(cell('tempo_ratio_lo')), m.ci95[0]);
  assert.equal(Number(cell('tempo_ratio_hi')), m.ci95[1]);
  assert.equal(cell('tempo_ratio_validity'), 'valid');
  assert.equal(cell('club_speed_mps_validity'), 'estimated');
  // null value: empty value and bounds, validity still reported
  assert.equal(shot.metrics.ball_speed_mps.value, null);
  assert.equal(cell('ball_speed_mps'), '');
  assert.equal(cell('ball_speed_mps_lo'), '');
  assert.equal(cell('ball_speed_mps_hi'), '');
  assert.equal(cell('ball_speed_mps_validity'), 'not_observable');
  // metric absent from the shot: all four cells empty
  for (const suffix of ['', '_lo', '_hi', '_validity']) assert.equal(cell(`carry_m${suffix}`), '');
  // sigma without ci95 does not invent bounds
  const sigmaOnly = makeShot({ id: 'csv-2' });
  sigmaOnly.metrics.tempo_ratio = { ...sigmaOnly.metrics.tempo_ratio, ci95: null };
  const r2 = parseCSV(exportCSV([sigmaOnly]))[1];
  assert.equal(r2[CSV_COLUMNS.indexOf('tempo_ratio_lo')], '');
  assert.notEqual(r2[CSV_COLUMNS.indexOf('tempo_ratio')], '');
  // a shot with no metrics at all
  const bare = { schema: 'golf-shot/1', shot_id: 'bare' };
  const r3 = parseCSV(exportCSV([bare]))[1];
  assert.equal(r3.length, CSV_COLUMNS.length);
  assert.equal(r3[0], 'bare');
  assert.ok(r3.slice(1).every((c) => c === ''));
});

test('CSV quoting follows RFC 4180: commas, quotes and newlines in free-text cells', () => {
  // The CSV has no note column; the free-text cells are the user-named ids (shot_id, venue_id, preset_id), so the
  // same awkward texts that a note may contain are pushed through them.
  const texts = [
    'plain',
    'with, comma',
    'with "quotes" inside',
    'line one\nline two',
    'windows\r\nnewline',
    'all, of "them"\nat once',
    '"starts and ends with quotes"',
    ' leading and trailing spaces ',
    '中文，逗號與「引號」',
    '',
  ];
  const shots = texts.map((t, i) => makeShot({ id: `n${i}`, seed: i, venue_id: t, preset_id: t, note: t }));
  const text = exportCSV(shots);
  assert.ok(text.includes('"with, comma"'));
  assert.ok(text.includes('"with ""quotes"" inside"'));
  assert.ok(text.includes('"line one\nline two"'));
  assert.ok(text.includes('"windows\r\nnewline"'));
  assert.ok(text.includes('"all, of ""them""\nat once"'));
  assert.ok(text.includes('"""starts and ends with quotes"""'));
  assert.ok(text.endsWith('\r\n'));
  const rows = parseCSV(text);
  assert.equal(rows.length, texts.length + 1);
  const venueCol = CSV_COLUMNS.indexOf('venue_id');
  const presetCol = CSV_COLUMNS.indexOf('preset_id');
  texts.forEach((t, i) => {
    assert.equal(rows[i + 1].length, CSV_COLUMNS.length, `row ${i} has the fixed width`);
    assert.equal(rows[i + 1][0], `n${i}`);
    assert.equal(rows[i + 1][venueCol], t);
    assert.equal(rows[i + 1][presetCol], t);
  });
  // a shot note (any text) never adds or shifts a column
  assert.ok(!rows[0].includes('note'));
  // ids and other string cells are quoted the same way
  const odd = makeShot({ id: 'a,b', preset_id: 'p"1' });
  const r = parseCSV(exportCSV([odd]))[1];
  assert.equal(r[0], 'a,b');
  assert.equal(r[3], 'p"1');
  // helper
  assert.equal(csvField(null), '');
  assert.equal(csvField(undefined), '');
  assert.equal(csvField(NaN), '');
  assert.equal(csvField(Infinity), '');
  assert.equal(csvField(0.1 + 0.2), '0.30000000000000004');
  assert.equal(csvField(-1.5e-7), '-1.5e-7');
  assert.equal(csvField('x'), 'x');
});

test('CSV: optional BOM and CSV of repo query results', async () => {
  const repo = await openMem();
  await fillRepo(repo);
  const shots = await repo.queryShots({ view: 'dtl' });
  const text = exportCSV(shots, { bom: true });
  assert.equal(text.charCodeAt(0), 0xfeff);
  const rows = parseCSV(text.slice(1));
  assert.deepEqual(rows.slice(1).map((r) => r[0]), ['shot-3', 'shot-4']);
  assert.equal(exportCSV(shots).charCodeAt(0), CSV_COLUMNS[0].charCodeAt(0));
});
