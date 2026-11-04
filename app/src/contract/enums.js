// Shared enumerations and fixed id tables of the golf-shot/1 contract (docs/interfaces.md §4, §9; CAFCR F2/F3).
// Pure data; the JSON Schema in schema/shot-v1.schema.json repeats these lists and a unit test keeps both in sync.

import { RC } from './reason-codes.js';
import { VIEWS } from '../geom/constants.js';

export const SCHEMA_ID = 'golf-shot/1';

/** Swing views (re-exported from geom so there is one list). */
export { VIEWS };

/** The 8 GolfDB swing events, in order (frames must be non-decreasing along this order). */
export const EVENTS = Object.freeze([
  'address', 'toe_up', 'mid_backswing', 'top', 'mid_downswing', 'impact', 'mid_follow_through', 'finish',
]);
export const EVENT_SOURCES = Object.freeze(['rules', 'tcn', 'manual']);

/** Validity: the first three carry a number, the other seven are honest nulls. */
export const VALUE_VALIDITIES = Object.freeze(['valid', 'estimated', 'low_confidence']);
export const NULL_VALIDITIES = Object.freeze([
  'occluded', 'ambiguous', 'dropped', 'stale', 'not_observable', 'implausible', 'not_computed',
]);
export const VALIDITIES = Object.freeze([...VALUE_VALIDITIES, ...NULL_VALIDITIES]);

export const VALUE_ORIGINS = Object.freeze([
  'pose', 'ball_fit3d', 'ball_fit2d', 'club_track', 'ballistics', 'derived', 'manual',
]);

// [id, unit, default value_origin used by placeholders]; order = CAFCR F2 rows 1..20 (interfaces.md §9).
const METRIC_TABLE = [
  ['backswing_s', 's', 'pose'],
  ['downswing_s', 's', 'pose'],
  ['tempo_ratio', 'ratio', 'derived'],
  ['head_sway_x_m', 'm', 'pose'],
  ['head_lift_z_m', 'm', 'pose'],
  ['head_depth_y_m', 'm', 'pose'],
  ['spine_forward_tilt_deg', 'deg', 'pose'],
  ['spine_side_tilt_deg', 'deg', 'pose'],
  ['shoulder_turn_deg', 'deg', 'pose'],
  ['hip_turn_deg', 'deg', 'pose'],
  ['x_factor_deg', 'deg', 'derived'],
  ['hand_plane_dev_m', 'm', 'pose'],
  ['top_shaft_angle_deg', 'deg', 'pose'],
  ['weight_shift_pct', '%', 'pose'],
  ['early_extension_m', 'm', 'pose'],
  ['club_speed_mps', 'm/s', 'club_track'],
  ['club_path_deg', 'deg', 'club_track'],
  ['ball_speed_mps', 'm/s', 'ball_fit3d'],
  ['launch_v_deg', 'deg', 'ball_fit3d'],
  ['launch_h_deg', 'deg', 'ball_fit3d'],
  ['carry_m', 'm', 'ballistics'],
  ['smash_factor', 'ratio', 'derived'],
];

export const METRIC_IDS = Object.freeze(METRIC_TABLE.map((r) => r[0]));
export const METRIC_UNITS = Object.freeze(Object.fromEntries(METRIC_TABLE.map((r) => [r[0], r[1]])));
/** value_origin given to not_computed placeholders; the metrics module overrides it when it fills a metric. */
export const METRIC_DEFAULT_ORIGIN = Object.freeze(Object.fromEntries(METRIC_TABLE.map((r) => [r[0], r[2]])));

// ---- warnings attribution rule (CAFCR F3; docs/contract.md "Attribution rule") ----

/** Codes that describe the whole setup/shot, so they live in quality.warnings and are repeated on affected metrics. */
export const SETUP_LEVEL_CODES = Object.freeze([
  RC.SETUP_UNVERIFIED, RC.CALIB_STALE, RC.PRESET_MISMATCH, RC.NO_GRAVITY_REF,
]);
/** CAFCR F2 rows 14-20: club-head and ball metrics. Always affected by a setup-level warning. */
export const BALL_CLUB_IDS = Object.freeze([
  'club_speed_mps', 'club_path_deg', 'ball_speed_mps', 'launch_v_deg', 'launch_h_deg', 'carry_m', 'smash_factor',
]);
/** value_origin values whose number is computed through the calibrated camera/plane geometry. */
export const CALIBRATION_ORIGINS = Object.freeze(['ball_fit3d', 'ball_fit2d', 'club_track', 'ballistics']);

/**
 * Is a setup-level warning relevant to this metric? True for the ball/club ids (#14-20) and for any metric whose
 * value_origin depends on calibration. `metric` may be a Metric value or just a value_origin string.
 */
export function isAffectedBySetup(id, metric) {
  if (BALL_CLUB_IDS.includes(id)) return true;
  const origin = typeof metric === 'string' ? metric : metric?.value_origin;
  return CALIBRATION_ORIGINS.includes(origin);
}

// ---- capture / calibration / club enumerations ----

export const CAPTURE_MODES = Object.freeze(['live', 'highspeed']);
export const CAPTURE_SOURCES = Object.freeze(['camera', 'import']);
export const ORIENTATIONS = Object.freeze([
  'portrait-primary', 'portrait-secondary', 'landscape-primary', 'landscape-secondary', 'unknown',
]);
export const TIMESTAMP_KINDS = Object.freeze(['container', 'nominal']);

export const CALIB_METHODS = Object.freeze(['mat_pnp', 'club_line', 'ball_only']);
export const CALIB_SOURCES = Object.freeze(['live', 'clip']);
export const READOUT_SOURCES = Object.freeze(['assumed', 'measured']);
export const POSE_KEYS = Object.freeze(['yaw_deg', 'pitch_deg', 'roll_deg', 'X_m', 'Y_m', 'h_m', 'D_m']);

export const LIES = Object.freeze(['mat', 'tee']);
export const TEE_LIFT_SOURCES = Object.freeze(['measured', 'assumed']);
export const HANDEDNESS = Object.freeze(['right', 'left']);
export const ALGORITHM_KEYS = Object.freeze(['pose', 'events', 'calib', 'ball', 'fit3d', 'carry']);

/** Top-level keys of a shot. `history` is the only optional one. */
export const SHOT_REQUIRED_KEYS = Object.freeze([
  'schema', 'shot_id', 'session_id', 'venue_id', 'preset_id', 'created_at', 'app_version', 'algorithms', 'capture',
  'calibration', 'club', 'handedness', 'events', 'metrics', 'quality', 'starred', 'note', 'revision',
]);
export const SHOT_OPTIONAL_KEYS = Object.freeze(['history']);
