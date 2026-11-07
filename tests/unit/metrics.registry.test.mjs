// metrics/registry.js against CAFCR F2, cell by cell. The expected table below is written independently from
// docs/CAFCR.md (not derived from the registry), and is also cross-checked against the markdown table itself so a
// later edit of the spec shows up here.
import { mergeCatalogs } from '../../scripts/build.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REGISTRY, cellFor, nullCodeFor, minFpsFor, LM_ROW_IDS } from '../../app/src/metrics/registry.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { METRIC_IDS, METRIC_IDS_V1, LM_METRIC_IDS } from '../../app/src/contract/enums.js';

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

// LAUNCH-MONITOR-SPEC §1.3-2: three CAFCR F2 cells changed from 不可 to 低 (high_behind, 240 fps, new methods).
const LM_CHANGED = { club_speed_mps: { high_behind: '低' }, ball_speed_mps: { high_behind: '低' }, carry_m: { high_behind: '低' } };

test('registry covers exactly the 36 contract metric ids (22 of CAFCR F2 + 14 of LAUNCH-MONITOR-SPEC §1.2)', () => {
  assert.deepEqual(Object.keys(REGISTRY).sort(), [...METRIC_IDS].sort());
  const ids = F2.flatMap((r) => r[1]);
  assert.deepEqual(ids.sort(), [...METRIC_IDS_V1].sort());
  assert.deepEqual([...LM_ROW_IDS], [...LM_METRIC_IDS]);
  assert.deepEqual(LM_METRIC_IDS.map((id) => REGISTRY[id].row), Array.from({ length: 14 }, (_, i) => 21 + i));
});

const CATALOGS = mergeCatalogs(fileURLToPath(new URL('../../app', import.meta.url)));

test('registry equals F2 cell by cell (validity per view, min fps, row, null code, label)', () => {
  for (const [row, ids, fo, dtl, hb, minFps, codes] of F2) {
    for (const id of ids) {
      const r = REGISTRY[id];
      assert.equal(r.views.face_on, TOKEN[fo], `${id} face_on`);
      assert.equal(r.views.dtl, TOKEN[dtl], `${id} dtl`);
      assert.equal(r.views.high_behind, TOKEN[LM_CHANGED[id]?.high_behind ?? hb], `${id} high_behind`);
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

// ---------------------------------------------------------------------------- LAUNCH-MONITOR-SPEC §1.2 (LM-A drop 1)
// The expected cells are read from the spec's own table (240 fps): 實/推 (估) → estimated, (低) → low_confidence,
// — → not. Row numbers there are the spec's #1–21; the ids in backticks.
const SPEC = readFileSync(fileURLToPath(new URL('../../docs/LAUNCH-MONITOR-SPEC.md', import.meta.url)), 'utf8');
function specCells() {
  const sec = SPEC.slice(SPEC.indexOf('### 1.2'), SPEC.indexOf('### 1.3'));
  const out = {};
  const byNum = {};
  for (const line of sec.split('\n')) {
    const c = line.split('|').slice(1, -1).map((x) => x.trim());
    const id = /^`([a-z0-9_]+)`$/.exec(c[1] ?? '')?.[1];
    if (!id) continue;
    const tok = (x) => (x.startsWith('—') ? 'not' : /低/.test(x) ? 'low_confidence' : /估/.test(x) ? 'estimated' : `?${x}`);
    out[id] = { face_on: tok(c[3]), dtl: tok(c[4]), high_behind: tok(c[5]), codes: c[8] };
    byNum[c[0]] = out[id];
  }
  // "同 #5" / "#14 的碼" = the codes of that row; a cell starting with "＋" adds to the previous row's codes
  const rows = Object.values(out);
  rows.forEach((r, i) => {
    r.codes = r.codes.replace(/同 #(\d+)|#(\d+) 的碼/g, (_, a, b) => byNum[a ?? b]?.codes ?? '');
    if (r.codes.startsWith('＋') && i > 0) r.codes = `${rows[i - 1].codes} ${r.codes}`;
  });
  return out;
}

test('registry equals LAUNCH-MONITOR-SPEC §1.2 at 240 fps for all 21 ball / club ids (cells and null codes)', () => {
  const spec = specCells();
  assert.equal(Object.keys(spec).length, 21);
  for (const [id, row] of Object.entries(spec)) {
    for (const view of ['face_on', 'dtl', 'high_behind']) {
      const c = cellFor(id, view, 240);
      if (row[view] === 'not') {
        assert.equal(c.validity, null, `${id} ${view}`);
        // the null code is named in the spec row (rows #9, #14, #15 keep their CAFCR code)
        // #15 total names no dtl code: it inherits carry's (#14; CAFCR F2 row 19 DEPENDS_ON_NULL)
        const inherited = id === 'total_m' && view === 'dtl' ? nullCodeFor('carry_m', 'dtl') : null;
        if (LM_METRIC_IDS.includes(id)) assert.ok(row.codes.includes(c.code) || c.code === inherited, `${id} ${view}: ${c.code} not in "${row.codes}"`);
      } else {
        assert.equal(c.validity, row[view], `${id} ${view}`);
      }
    }
  }
  // §1.1: below 200 fps every ball / flight / D-plane id is null with FPS_TOO_LOW; face_on club speed is the exception
  for (const id of Object.keys(spec)) {
    for (const view of ['face_on', 'high_behind']) {
      for (const fps of [30, 60, 120]) {
        const c = cellFor(id, view, fps);
        if (id === 'club_speed_mps' && view === 'face_on') assert.equal(c.validity, 'low_confidence');
        else if (c.validity !== null) assert.fail(`${id} ${view} @${fps}: ${c.validity}`);
        else if (REGISTRY[id].views[view] !== 'not') assert.equal(c.code, RC.FPS_TOO_LOW, `${id} ${view} @${fps}`);
      }
    }
  }
  // high_behind club speed, attack angle and club path need 240 fps (§1.1)
  for (const id of ['club_speed_mps', 'club_path_deg']) assert.deepEqual(cellFor(id, 'high_behind', 200), { validity: null, code: RC.FPS_TOO_LOW });
  assert.deepEqual(cellFor('attack_angle_deg', 'face_on', 200), { validity: null, code: RC.FPS_TOO_LOW });
  assert.equal(minFpsFor('club_speed_mps', 'face_on'), 30);
  assert.equal(minFpsFor('club_speed_mps', 'high_behind'), 240);
  assert.equal(nullCodeFor('attack_angle_deg', 'high_behind'), RC.VIEW_PLANE_MISMATCH);
  assert.equal(nullCodeFor('attack_angle_deg', 'dtl'), RC.VIEW_DEPTH_AXIS);
  // the 14 new ids: dtl is null in every one (dtl has no ball data); labels exist in both catalogs
  for (const id of LM_METRIC_IDS) {
    assert.equal(cellFor(id, 'dtl', 240).validity, null, id);
    for (const [loc, c] of Object.entries(CATALOGS)) for (const f of ['label', 'short', 'meaning', 'range', 'term']) assert.ok(c[`metric.${id}.${f}`], `${loc} metric.${id}.${f}`);
  }
});

test('docs/metrics-by-view.md lists the 14 launch-monitor rows', () => {
  const md = readFileSync(fileURLToPath(new URL('../../docs/metrics-by-view.md', import.meta.url)), 'utf8');
  for (const id of LM_METRIC_IDS) assert.ok(md.includes(`\`${id}\``), id);
});
