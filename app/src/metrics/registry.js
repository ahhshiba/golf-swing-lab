// CAFCR F2 "角度×指標表" as data: per metric id the per-view validity, minimum fps and the reason code used when the
// cell is 不可. Owner of the per-view validity table (docs/interfaces.md §9). Table and notes: docs/metrics-by-view.md.
// Cell values: 'valid' (可), 'estimated' (估), 'low_confidence' (低), 'not' (不可 -> null + nullCode).

import { RC } from '../contract/reason-codes.js';
import { METRIC_IDS, METRIC_UNITS, METRIC_DEFAULT_ORIGIN } from '../contract/enums.js';
import { fpsAtLeast } from '../geom/constants.js';

const V = 'valid';
const E = 'estimated';
const LO = 'low_confidence';
const N = 'not';
const views = (face_on, dtl, high_behind) => Object.freeze({ face_on, dtl, high_behind });

// [id, F2 row, label_zh, views, minFps, nullCode, extra]
const ROWS = [
  ['backswing_s', 1, '上桿時間', views(V, V, V), 30, null],
  ['downswing_s', 1, '下桿時間', views(V, V, V), 30, null],
  ['tempo_ratio', 1, '節奏比（tempo，上桿／下桿）', views(V, V, V), 30, null],
  ['head_sway_x_m', 2, '頭部位移：沿目標線', views(V, N, LO), 30, RC.VIEW_DEPTH_AXIS],
  ['head_lift_z_m', 3, '頭部位移：垂直', views(V, V, N), 30, RC.VIEW_DEPTH_AXIS],
  ['head_depth_y_m', 4, '頭部位移：朝球／離球', views(N, V, LO), 30, RC.VIEW_DEPTH_AXIS],
  ['spine_forward_tilt_deg', 5, '脊椎前傾角', views(N, V, N), 30, RC.VIEW_PLANE_MISMATCH],
  ['spine_side_tilt_deg', 6, '脊椎側傾角', views(V, N, N), 30, RC.VIEW_PLANE_MISMATCH],
  ['shoulder_turn_deg', 7, '肩轉', views(LO, LO, LO), 30, null],
  ['hip_turn_deg', 8, '髖轉', views(LO, LO, LO), 30, null],
  ['x_factor_deg', 9, 'X-factor（肩轉減髖轉）', views(LO, LO, LO), 30, null],
  ['hand_plane_dev_m', 10, '手部路徑 vs 桿身平面', views(N, V, N), 30, RC.VIEW_PLANE_MISMATCH],
  ['top_shaft_angle_deg', 11, '上桿頂點桿身角', views(N, E, N), 120, RC.VIEW_PLANE_MISMATCH],
  ['weight_shift_pct', 12, '重心轉移（骨盆側移％站寬，代理量）', views(E, N, N), 30, RC.VIEW_DEPTH_AXIS],
  ['early_extension_m', 13, '早伸展（骨盆朝球位移）', views(N, V, N), 30, RC.VIEW_DEPTH_AXIS],
  // F2 row 14: face_on 30–60 fps 低（±25%）, 240 fps 估
  ['club_speed_mps', 14, '桿頭速度', views(LO, N, N), 30, RC.VIEW_DEPTH_AXIS,
    { fpsTiers: { face_on: [{ minFps: 240, validity: E }] } }],
  ['club_path_deg', 15, '擊球桿頭路徑 in-to-out', views(N, N, LO), 240, RC.VIEW_PLANE_MISMATCH,
    { runtimeCodes: [RC.TRACK_TOO_SHORT] }],
  ['ball_speed_mps', 16, '球初速', views(E, N, N), 200, RC.VIEW_DEPTH_AXIS],
  ['launch_v_deg', 17, '垂直發射角', views(E, N, N), 200, RC.VIEW_DEPTH_AXIS],
  ['launch_h_deg', 18, '水平出球方向', views(N, N, LO), 200, RC.LAUNCH_DIR_UNOBSERVABLE],
  ['carry_m', 19, 'carry（飛行距離）', views(E, N, N), 200, RC.DEPENDS_ON_NULL,
    { depends: ['ball_speed_mps', 'launch_v_deg'] }],
  ['smash_factor', 20, 'smash factor（球速／桿頭速）', views(E, N, N), 240, RC.DEPENDS_ON_NULL,
    { depends: ['club_speed_mps', 'ball_speed_mps'] }],
];

/** Registry entry: { id, row, label_zh, unit, value_origin, views, minFps, nullCode, fpsTiers?, depends?, runtimeCodes? }. */
export const REGISTRY = Object.freeze(Object.fromEntries(ROWS.map(([id, row, label_zh, vs, minFps, nullCode, extra]) => [
  id,
  Object.freeze({
    id, row, label_zh, unit: METRIC_UNITS[id], value_origin: METRIC_DEFAULT_ORIGIN[id], views: vs, minFps, nullCode,
    ...(extra ?? {}),
  }),
])));

if (ROWS.length !== METRIC_IDS.length || !METRIC_IDS.every((id) => REGISTRY[id])) {
  throw new Error('metrics/registry: ids out of sync with contract METRIC_IDS');
}

/** Ids of F2 rows 1–13 (pose metrics computed by this module). */
export const POSE_METRIC_IDS = Object.freeze(METRIC_IDS.filter((id) => REGISTRY[id].row <= 13));

/**
 * Resolve one F2 cell for a capture: { validity: 'valid'|'estimated'|'low_confidence' | null, code: RC | null }.
 * null validity = not computable here: the cell is 不可 (code = the row's nullCode) or fps < minFps
 * (code = FPS_TOO_LOW). fpsTiers raise the validity at higher frame rates (row 14).
 */
export function cellFor(id, view, fps) {
  const r = REGISTRY[id];
  if (!r) throw new RangeError(`unknown metric id '${id}'`);
  const base = r.views[view];
  if (base === undefined) throw new RangeError(`unknown view '${view}'`);
  if (base === N) return { validity: null, code: r.nullCode };
  if (!fpsAtLeast(fps, r.minFps)) return { validity: null, code: RC.FPS_TOO_LOW };
  let validity = base;
  for (const tier of r.fpsTiers?.[view] ?? []) if (fpsAtLeast(fps, tier.minFps)) validity = tier.validity;
  return { validity, code: null };
}

/** Views in which a metric is not 不可. */
export function viewsFor(id) {
  const r = REGISTRY[id];
  return Object.keys(r.views).filter((v) => r.views[v] !== N);
}
