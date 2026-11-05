// metrics/registry.js against CAFCR F2, cell by cell. The expected table below is written independently from
// docs/CAFCR.md (not derived from the registry), and is also cross-checked against the markdown table itself so a
// later edit of the spec shows up here.
import { mergeCatalogs } from '../../scripts/build.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REGISTRY, cellFor } from '../../app/src/metrics/registry.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { METRIC_IDS } from '../../app/src/contract/enums.js';

// F2 rows: [row, ids, face_on, dtl, high_behind, minFps, codes] with the F2 tokens 可 / 估 / 低 / 不可.
// Row 14 face_on is fps dependent: 低 at 30–60 fps, 估 at 240 fps. Rows 16/17 face_on: 估 at >= 200 fps.
const F2 = [
  [1, ['backswing_s', 'downswing_s', 'tempo_ratio'], '可', '可', '可', 30, []],
  [2, ['head_sway_x_m'], '可', '不可', '低', 30, ['VIEW_DEPTH_AXIS']],
  [3, ['head_lift_z_m'], '可', '可', '不可', 30, ['VIEW_DEPTH_AXIS']],
  [4, ['head_depth_y_m'], '不可', '可', '低', 30, ['VIEW_DEPTH_AXIS']],
  [5, ['spine_forward_tilt_deg'], '不可', '可', '不可', 30, ['VIEW_PLANE_MISMATCH']],
  [6, ['spine_side_tilt_deg'], '可', '不可', '不可', 30, ['VIEW_PLANE_MISMATCH']],
  [7, ['shoulder_turn_deg', 'hip_turn_deg', 'x_factor_deg'], '低', '低', '低', 30, []],
  [10, ['hand_plane_dev_m'], '不可', '可', '不可', 30, ['VIEW_PLANE_MISMATCH']],
  [11, ['top_shaft_angle_deg'], '不可', '估', '不可', 120, ['VIEW_PLANE_MISMATCH']],
  [12, ['weight_shift_pct'], '估', '不可', '不可', 30, ['VIEW_DEPTH_AXIS']],
  [13, ['early_extension_m'], '不可', '可', '不可', 30, ['VIEW_DEPTH_AXIS']],
  [14, ['club_speed_mps'], '低', '不可', '不可', 30, ['VIEW_DEPTH_AXIS']],
  [15, ['club_path_deg'], '不可', '不可', '低', 240, ['VIEW_PLANE_MISMATCH', 'TRACK_TOO_SHORT']],
  [16, ['ball_speed_mps'], '估', '不可', '不可', 200, ['FPS_TOO_LOW', 'VIEW_DEPTH_AXIS']],
  [17, ['launch_v_deg'], '估', '不可', '不可', 200, ['FPS_TOO_LOW', 'VIEW_DEPTH_AXIS']],
  [18, ['launch_h_deg'], '不可', '不可', '低', 200, ['LAUNCH_DIR_UNOBSERVABLE']],
  [19, ['carry_m'], '估', '不可', '不可', 200, ['DEPENDS_ON_NULL']],
  [20, ['smash_factor'], '估', '不可', '不可', 240, ['DEPENDS_ON_NULL']],
];
const TOKEN = { '可': 'valid', '估': 'estimated', '低': 'low_confidence', '不可': 'not' };
const VIEWS = ['face_on', 'dtl', 'high_behind'];

test('registry covers exactly the 22 contract metric ids', () => {
  assert.deepEqual(Object.keys(REGISTRY).sort(), [...METRIC_IDS].sort());
  const ids = F2.flatMap((r) => r[1]);
  assert.deepEqual(ids.sort(), [...METRIC_IDS].sort());
});

const CATALOGS = mergeCatalogs(fileURLToPath(new URL('../../app', import.meta.url)));

test('registry equals F2 cell by cell (validity per view, min fps, row, null code, label)', () => {
  for (const [row, ids, fo, dtl, hb, minFps, codes] of F2) {
    for (const id of ids) {
      const r = REGISTRY[id];
      assert.equal(r.views.face_on, TOKEN[fo], `${id} face_on`);
      assert.equal(r.views.dtl, TOKEN[dtl], `${id} dtl`);
      assert.equal(r.views.high_behind, TOKEN[hb], `${id} high_behind`);
      assert.equal(r.minFps, minFps, `${id} minFps`);
      assert.equal(r.row, row === 7 ? { shoulder_turn_deg: 7, hip_turn_deg: 8, x_factor_deg: 9 }[id] : row, `${id} row`);
      if (codes.length === 0) assert.equal(r.nullCode, null, `${id} nullCode`);
      else assert.ok(codes.includes(r.nullCode), `${id} nullCode ${r.nullCode} not in F2 ${codes}`);
      assert.equal(r.label_zh, undefined, `${id}: labels live in the catalogs`);
      for (const [loc, c] of Object.entries(CATALOGS)) assert.ok(typeof c[`metric.${id}.label`] === 'string' && c[`metric.${id}.label`], `${loc} metric.${id}.label`);
      assert.match(CATALOGS['zh-Hant'][`metric.${id}.label`], /[一-鿿]/, `${id}: zh-Hant label is Chinese first (V21)`);
    }
  }
});

test('the expected table above matches the F2 markdown table in docs/CAFCR.md', () => {
  const md = readFileSync(fileURLToPath(new URL('../../docs/CAFCR.md', import.meta.url)), 'utf8');
  const sec = md.slice(md.indexOf('## F2'), md.indexOf('## F3'));
  const lines = sec.split('\n').filter((l) => /^\|\s*\d/.test(l));
  assert.equal(lines.length, 18, 'F2 has 18 table rows (#1, #2–#6, #7–9, #10–#20)');
  const tok = (cell) => {
    const c = cell.trim();
    if (c.startsWith('不可')) return '不可';
    for (const t of ['可', '估', '低']) if (c === t || c.startsWith(`${t}（`) || c.startsWith(`${t}(`)) return t;
    if (/^\d+\s*估/.test(c)) return '估'; // "240 估；<200 不可"
    if (/低/.test(c) && /^30/.test(c)) return '低'; // "30–60fps 低（±25%）；240 估"
    if (/^估/.test(c)) return '估';
    if (/^低/.test(c)) return '低';
    return c;
  };
  lines.forEach((l, k) => {
    const cells = l.split('|').slice(1, -1);
    const [row, , fo, dtl, hb, fps, codes] = cells.map((c) => c.trim());
    const exp = F2[k];
    assert.equal(parseInt(row, 10), exp[0], `row ${row}`);
    assert.deepEqual([tok(fo), tok(dtl), tok(hb)], [exp[2], exp[3], exp[4]], `row ${row} cells ${fo} | ${dtl} | ${hb}`);
    assert.equal(parseInt(fps, 10), exp[5] === 240 && exp[0] === 14 ? 30 : exp[5], `row ${row} min fps ${fps}`);
    for (const c of exp[6]) assert.ok(codes.includes(c) || codes === '同上', `row ${row} codes ${codes} missing ${c}`);
  });
});

test('cellFor resolves fps tiers and minimum fps', () => {
  assert.deepEqual(cellFor('club_speed_mps', 'face_on', 30), { validity: 'low_confidence', code: null });
  assert.deepEqual(cellFor('club_speed_mps', 'face_on', 60), { validity: 'low_confidence', code: null });
  assert.deepEqual(cellFor('club_speed_mps', 'face_on', 240), { validity: 'estimated', code: null });
  assert.deepEqual(cellFor('ball_speed_mps', 'face_on', 120), { validity: null, code: RC.FPS_TOO_LOW });
  assert.deepEqual(cellFor('ball_speed_mps', 'face_on', 240), { validity: 'estimated', code: null });
  assert.deepEqual(cellFor('ball_speed_mps', 'dtl', 240), { validity: null, code: RC.VIEW_DEPTH_AXIS });
  assert.deepEqual(cellFor('top_shaft_angle_deg', 'dtl', 60), { validity: null, code: RC.FPS_TOO_LOW });
  assert.deepEqual(cellFor('top_shaft_angle_deg', 'dtl', 120), { validity: 'estimated', code: null });
  assert.deepEqual(cellFor('club_path_deg', 'high_behind', 120), { validity: null, code: RC.FPS_TOO_LOW });
  assert.deepEqual(cellFor('club_path_deg', 'high_behind', 240), { validity: 'low_confidence', code: null });
  assert.deepEqual(cellFor('launch_h_deg', 'face_on', 240), { validity: null, code: RC.LAUNCH_DIR_UNOBSERVABLE });
  assert.deepEqual(cellFor('carry_m', 'dtl', 240), { validity: null, code: RC.DEPENDS_ON_NULL });
  assert.deepEqual(cellFor('tempo_ratio', 'high_behind', 25), { validity: null, code: RC.FPS_TOO_LOW });
  for (const id of METRIC_IDS) for (const v of VIEWS) assert.ok('validity' in cellFor(id, v, 240));
  assert.throws(() => cellFor('nope', 'dtl', 30), RangeError);
  assert.throws(() => cellFor('tempo_ratio', 'top_down', 30), RangeError);
});
