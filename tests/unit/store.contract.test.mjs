// Integration of store with the contract module: the real golf-shot/1 validator and the contract fixtures.
// Skipped (not passed) when app/src/contract/validate.js does not exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RC } from '../../app/src/contract/reason-codes.js';
import { STORE_NAMES } from '../../app/src/store/core.js';
import { exportJSON, importJSON, exportCSV, CSV_COLUMNS, ImportError, resolveDefaultValidator } from '../../app/src/store/export.js';
import { compareShots } from '../../app/src/store/compare.js';
import { METRIC_IDS } from '../../app/src/store/metric-ids.js';
import { openMem, dumpRepo, hasChinese } from './store.fixtures.mjs';

let contract = null;
let enums = null;
try {
  contract = await import('../../app/src/contract/validate.js');
  enums = await import('../../app/src/contract/enums.js');
} catch { /* contract module not present */ }
const skip = contract ? false : 'app/src/contract/validate.js not found';

const FX = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/shots');
const names = readdirSync(FX).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
const load = (n) => Object.fromEntries(Object.entries(JSON.parse(readFileSync(join(FX, `${n}.json`), 'utf8'))).filter(([k]) => !k.startsWith('_')));
const asFile = (x) => JSON.parse(JSON.stringify(x));
const NOW = '2026-11-04T12:00:00.000Z';

const validShots = () => names.filter((n) => n.startsWith('valid_')).map(load);

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
    else field += c;
  }
  return rows;
}

test('the default validator is the contract validator', { skip }, async () => {
  const def = await resolveDefaultValidator();
  assert.equal(def.source, 'contract');
  assert.equal(def.note, null);
  assert.equal(def.fn, contract.validateShot);
});

test('metric ids of store and contract are the same list in the same order', { skip }, () => {
  assert.deepEqual([...METRIC_IDS], [...enums.METRIC_IDS]);
});

test('contract fixtures: export -> clear -> import with the real validator is exact', { skip }, async () => {
  const shots = validShots();
  assert.ok(shots.length >= 4);
  const repo = await openMem();
  await repo.putMany('shots', shots);
  const before = await dumpRepo(repo);
  const file = JSON.stringify(await exportJSON(repo, { now: NOW }));
  await repo.clear();
  const res = await importJSON(repo, file); // default validator
  assert.equal(res.validator, 'contract');
  assert.deepEqual(res.warnings, []);
  assert.equal(res.total.added, shots.length);
  assert.deepStrictEqual(await dumpRepo(repo), before);
  assert.ok((await repo.shots.list()).some((s) => s.history), 'the revised fixture keeps its history');
});

test('every bad contract fixture makes the whole import fail, nothing is written, the reason is readable', { skip }, async () => {
  const bad = names.filter((n) => n.startsWith('bad_'));
  assert.ok(bad.length >= 15);
  for (const n of bad) {
    const repo = await openMem();
    const src = await openMem();
    await src.putMany('shots', validShots());
    const file = asFile(await exportJSON(src, { now: NOW }));
    const shot = load(n);
    file.shots.push(shot);
    let err;
    try { await importJSON(repo, file); } catch (e) { err = e; }
    assert.ok(err instanceof ImportError, `${n}: import must be rejected`);
    assert.ok(hasChinese(err.message), n);
    assert.ok(err.details.length >= 1 && err.details.some((d) => d.includes(String(shot.shot_id))), `${n}: ${err.details.join(' | ')}`);
    for (const store of STORE_NAMES) assert.equal(await repo.count(store), 0, `${n}: ${store} must stay empty`);
  }
});

test('CSV of contract fixtures: fixed width, expected cells', { skip }, () => {
  const shots = validShots();
  const rows = parseCSV(exportCSV(shots));
  assert.equal(rows.length, shots.length + 1);
  for (const r of rows) assert.equal(r.length, CSV_COLUMNS.length);
  const face = rows.find((r) => r[0] === 'shot-fx-face-on-240');
  const cell = (r, n) => r[CSV_COLUMNS.indexOf(n)];
  assert.equal(cell(face, 'view'), 'face_on');
  assert.equal(cell(face, 'club_type'), 'driver');
  assert.equal(cell(face, 'lie'), 'tee');
  assert.equal(cell(face, 'tempo_ratio'), '3');
  assert.equal(cell(face, 'tempo_ratio_lo'), '2.94');
  assert.equal(cell(face, 'tempo_ratio_hi'), '3.06');
  assert.equal(cell(face, 'tempo_ratio_validity'), 'valid');
  // notes are not CSV columns; the fixture's note stays on the shot (and so in the JSON export)
  assert.equal(CSV_COLUMNS.indexOf('note'), -1);
  assert.equal(shots.find((s) => s.shot_id === 'shot-fx-face-on-240').note, 'driver off a tee, tee height not measured');
  const dtl = rows.find((r) => r[0] === 'shot-fx-dtl-30');
  assert.equal(cell(dtl, 'head_sway_x_m'), '');
  assert.equal(cell(dtl, 'head_sway_x_m_lo'), '');
  assert.equal(cell(dtl, 'head_sway_x_m_validity'), 'not_observable');
  // every metric the shot has appears with its validity
  for (const shot of shots) {
    const r = rows.find((x) => x[0] === shot.shot_id);
    for (const [id, m] of Object.entries(shot.metrics)) {
      assert.equal(cell(r, `${id}_validity`), m.validity, `${shot.shot_id} ${id}`);
      assert.equal(cell(r, id), m.value === null ? '' : String(m.value), `${shot.shot_id} ${id}`);
    }
  }
});

test('comparing contract fixtures from different presets', { skip }, () => {
  const a = load('valid_face_on_240');
  const b = load('valid_dtl_30');
  const r = compareShots(a, b);
  assert.ok(r.warnings.includes(RC.PRESET_MISMATCH));
  assert.deepEqual(r.notes.map((n) => n.kind).sort(), ['club_mismatch', 'view_mismatch']);
  assert.equal(r.metrics.tempo_ratio.status, 'compared');
  assert.equal(r.metrics.tempo_ratio.delta, 0);
  assert.equal(r.metrics.head_sway_x_m.status, 'b_null');
  // same shot against itself is like for like
  assert.equal(compareShots(a, a).like_for_like, true);
});
