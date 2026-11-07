// LM-D (LAUNCH-MONITOR-SPEC §3.2–3.4): pure helpers of ui/tiles.js and the `tiles` catalogs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tileIds, shownIds, toggleTile, moveTile, allTilesFor, needsRederive, neighbours, topPoint, inputsFor, TILE_GROUPS } from '../../app/src/ui/tiles.js';
import { LM_TILE_DEFAULTS, LM_TILE_MAX } from '../../app/src/session/settings.js';
import { METRIC_IDS } from '../../app/src/contract/enums.js';
import { VALUE_ORIGINS } from '../../app/src/contract/enums.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const fo = read('../fixtures/shots/v2/valid_face_on_240.json');
const hb = read('../fixtures/shots/v2/valid_high_behind_240.json');

test('tile list: auto follows the view, custom keeps the user order', () => {
  assert.deepEqual(tileIds({ tilePreset: 'auto', tiles: ['spin_rate_rpm'] }, 'high_behind'), [...LM_TILE_DEFAULTS.high_behind]);
  assert.deepEqual(tileIds(null, 'dtl'), [...LM_TILE_DEFAULTS.dtl]);
  assert.deepEqual(tileIds({ tilePreset: 'custom', tiles: ['spin_rate_rpm', 'carry_m', 'nope'] }, 'face_on'), ['spin_rate_rpm', 'carry_m']);
  assert.deepEqual(tileIds({ tilePreset: 'custom', tiles: [] }, 'face_on'), [...LM_TILE_DEFAULTS.face_on]);
});

test('editor: toggle (max / min), move up / down at the ends', () => {
  const l = ['a', 'b', 'c'];
  assert.deepEqual(toggleTile(l, 'd', true), ['a', 'b', 'c', 'd']);
  assert.deepEqual(toggleTile(l, 'b', false), ['a', 'c']);
  assert.equal(toggleTile(['a'], 'a', false).length, 1);
  const full = Array.from({ length: LM_TILE_MAX }, (_, i) => `m${i}`);
  assert.equal(toggleTile(full, 'x', true), full);
  assert.deepEqual(moveTile(l, 'c', -1), ['a', 'c', 'b']);
  assert.deepEqual(moveTile(l, 'a', -1), l);
  assert.deepEqual(moveTile(l, 'c', 1), l);
  let m = [...LM_TILE_DEFAULTS.face_on];
  while (m[0] !== 'spin_rate_rpm') m = moveTile(m, 'spin_rate_rpm', -1);
  assert.equal(m.length, LM_TILE_DEFAULTS.face_on.length);
});

test('groups cover every metric once; "all" is what the view can produce', () => {
  const all = Object.values(TILE_GROUPS).flat();
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual([...all].sort(), [...METRIC_IDS].sort());
  const hbAll = allTilesFor('high_behind');
  assert.ok(hbAll.includes('face_angle_deg') && !hbAll.includes('launch_v_deg'));
  assert.ok(allTilesFor('face_on').length <= LM_TILE_MAX);
  assert.ok(!allTilesFor('dtl').includes('carry_m'));
});

test('recompute offer, neighbours, landing point, inputs', () => {
  assert.equal(needsRederive({ capture: { view: 'face_on' }, algorithms: { lm: { version: 'none' } } }, 'lm-1'), true);
  assert.equal(needsRederive(fo, fo.algorithms.lm.version), false);
  assert.equal(needsRederive(fo, 'lm-2'), true);
  assert.equal(needsRederive({ capture: { view: 'dtl' }, algorithms: {} }, 'lm-1'), false);
  const s = (id, at) => ({ shot_id: id, created_at: at });
  assert.deepEqual(neighbours([s('c', '3'), s('a', '1'), s('b', '2')], 'b'), { prev: 'a', next: 'c', i: 1, n: 3 });
  assert.deepEqual(neighbours([s('a', '1')], 'a'), { prev: null, next: null, i: 0, n: 1 });
  const p = topPoint(fo);
  assert.equal(p.y, null, 'face_on cannot see left / right');
  assert.equal(p.x, fo.flight.landing.x_m);
  const q = topPoint(hb);
  assert.equal(q.y, hb.flight.landing.y_m);
  assert.ok(q.sy > 0 && q.sx > 0);
  assert.deepEqual(inputsFor('spin_rate_rpm', 'face_on'), ['spin_loft_deg', 'club_speed_mps']);
});

test('tiles catalogs: same keys, every key the code uses, a sentence per value origin', () => {
  const zh = read('../../app/i18n/zh-Hant/tiles.json');
  const en = read('../../app/i18n/en/tiles.json');
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  const src = fs.readFileSync(new URL('../../app/src/ui/tiles.js', import.meta.url), 'utf8');
  const used = [...src.matchAll(/tx\('([a-z0-9_.]+)'/g)].map((m) => m[1]);
  for (const k of [...src.matchAll(/tx\([^)]*\? '([a-z0-9_.]+)' : '([a-z0-9_.]+)'/g)]) used.push(k[1], k[2]);
  for (const k of ['club.changed', 'club.changed_only', 'rederive.done', 'nav.prev', 'nav.next']) used.push(k);
  for (const g of Object.keys(TILE_GROUPS)) used.push(`group.${g}`);
  for (const k of ['side', 'top', '3d', 'video']) used.push(`viz.tab.${k}`);
  for (const k of ['dtl', 'fps', 'none', 'other']) used.push(`viz.no_flight.${k}`);
  for (const k of ['measured', 'inferred', 'null']) used.push(`kind.${k}`);
  for (const k of ['what', 'how', 'inputs', 'range', 'reasons']) used.push(`detail.${k}`);
  for (const o of VALUE_ORIGINS) used.push(`origin.${o}`);
  for (const k of new Set(used)) assert.ok(k in zh && k in en, `tiles.${k} missing`);
  for (const v of Object.values(en)) assert.ok(!/[㐀-鿿]/.test(v), `CJK in en: ${v}`);
});

test('shown tiles: the automatic list leaves out null tiles, a user list shows what the user chose', () => {
  const ids = ['a', 'n1', 'b', 'c', 'n2', 'd', 'e', 'f', 'n3'];
  const m = Object.fromEntries(ids.map((id) => [id, { value: id.startsWith('n') ? null : 1 }]));
  assert.deepEqual(shownIds(ids, m, false), ['a', 'b', 'c', 'd', 'e', 'f'], 'six values: no null tile');
  assert.deepEqual(shownIds(ids, m, true), ids, 'a user list shows every chosen tile');
  const m5 = { ...m, f: { value: null } };
  assert.deepEqual(shownIds(ids, m5, false), ['a', 'n1', 'b', 'c', 'd', 'e'], 'five values: the first null tile fills the grid to six');
  assert.deepEqual(shownIds(['n1'], m, false), ['n1'], 'never empty');
});
