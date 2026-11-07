// Shared enumerations and fixed id tables of the golf-shot/2 contract (docs/interfaces.md §4, §9; CAFCR F2/F3;
// docs/LAUNCH-MONITOR-SPEC.md §2). Pure data; schema/shot-v2.schema.json (and, for the *_V1 lists, the frozen
// schema/shot-v1.schema.json that still validates imported legacy shots) repeat these lists; tests keep them in sync.

import { RC } from './reason-codes.js';
import { VIEWS } from '../geom/constants.js';

/** The schema every new shot is written with. */
export const SCHEMA_ID = 'golf-shot/2';
export const SCHEMA_V1 = 'golf-shot/1';
export const SCHEMA_V2 = SCHEMA_ID;

/** Swing views (re-exported from geom so there is one list). */
export { VIEWS };

/** The 8 swing events, in order (frames must be non-decreasing along this order). */
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

export const VALUE_ORIGINS_V1 = Object.freeze([
  'pose', 'ball_fit3d', 'ball_fit2d', 'club_track', 'ballistics', 'derived', 'manual',
]);
/** v2 adds the model origins (LAUNCH-MONITOR-SPEC §2.2); a number from one of them must carry a MODEL_CODES code. */
export const MODEL_ORIGINS = Object.freeze(['dplane', 'spin_model', 'flight_model', 'prior']);
export const VALUE_ORIGINS = Object.freeze([...VALUE_ORIGINS_V1, ...MODEL_ORIGINS]);

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
  // golf-shot/2 (LAUNCH-MONITOR-SPEC §1.2 #2, #4–7, #12, #13, #15–21 = F2 rows 21–34), appended in this order
  ['attack_angle_deg', 'deg', 'club_track'],
  ['dynamic_loft_deg', 'deg', 'dplane'],
  ['face_angle_deg', 'deg', 'dplane'],
  ['face_to_path_deg', 'deg', 'dplane'],
  ['spin_loft_deg', 'deg', 'dplane'],
  ['spin_rate_rpm', 'rpm', 'spin_model'],
  ['spin_axis_deg', 'deg', 'dplane'],
  ['total_m', 'm', 'flight_model'],
  ['carry_side_m', 'm', 'flight_model'],
  ['total_side_m', 'm', 'flight_model'],
  ['curve_m', 'm', 'flight_model'],
  ['apex_m', 'm', 'flight_model'],
  ['landing_angle_deg', 'deg', 'flight_model'],
  ['hang_time_s', 's', 'flight_model'],
];

/** All 36 ids of golf-shot/2, in contract order (= CSV / registry order). */
export const METRIC_IDS = Object.freeze(METRIC_TABLE.map((r) => r[0]));
/** The 22 ids of golf-shot/1 (exactly these in a v1 shot). */
export const METRIC_IDS_V1 = Object.freeze(METRIC_IDS.slice(0, 22));
/** The 14 ids golf-shot/2 added (launch-monitor metrics). */
export const LM_METRIC_IDS = Object.freeze(METRIC_IDS.slice(22));
/** Units a metric may have (v2 added 'rpm'). */
export const METRIC_UNIT_LIST = Object.freeze(['s', 'ratio', 'm', 'deg', '%', 'm/s', 'rpm']);
export const METRIC_UNITS = Object.freeze(Object.fromEntries(METRIC_TABLE.map((r) => [r[0], r[1]])));
/** value_origin given to not_computed placeholders; the metrics module overrides it when it fills a metric. */
export const METRIC_DEFAULT_ORIGIN = Object.freeze(Object.fromEntries(METRIC_TABLE.map((r) => [r[0], r[2]])));

// ---- warnings attribution rule (CAFCR F3; docs/contract.md "Attribution rule") ----

/** Codes that describe the whole setup/shot, so they live in quality.warnings and are repeated on affected metrics. */
export const SETUP_LEVEL_CODES = Object.freeze([
  RC.SETUP_UNVERIFIED, RC.CALIB_STALE, RC.PRESET_MISMATCH, RC.NO_GRAVITY_REF,
]);
/**
 * Club-head and ball metrics (CAFCR F2 rows 14-20 plus every golf-shot/2 id, LAUNCH-MONITOR-SPEC §2.3: all of them
 * depend on the calibration). Always affected by a setup-level warning.
 */
export const BALL_CLUB_IDS = Object.freeze([
  'club_speed_mps', 'club_path_deg', 'ball_speed_mps', 'launch_v_deg', 'launch_h_deg', 'carry_m', 'smash_factor',
  ...LM_METRIC_IDS,
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
export const ALGORITHM_KEYS_V1 = Object.freeze(['pose', 'events', 'calib', 'ball', 'fit3d', 'carry']);
/** v2 adds `lm` = the launch-monitor model (physics/lm/params.js version; 'none' for migrated / not derived). */
export const ALGORITHM_KEYS = Object.freeze([...ALGORITHM_KEYS_V1, 'lm']);
/** algorithms.lm of a shot that has no launch-monitor derivation: version 'none', sha256 = sha256('none'). */
export const LM_ALGORITHM_NONE = Object.freeze({ version: 'none', sha256: '140bedbf9c3f6d56a9846d2ba7088798683f4da0c248231336e6a05679e4fdfe' });

/** golf-shot/2 flight block (LAUNCH-MONITOR-SPEC §2.2). */
export const GROUNDS = Object.freeze(['firm', 'normal', 'soft']);
export const FLIGHT_MAX_SAMPLES = 64;
export const TRACK_MAX_POINTS = 40;

/** Top-level keys of a golf-shot/1 shot. `history` is the only optional one. */
export const SHOT_REQUIRED_KEYS_V1 = Object.freeze([
  'schema', 'shot_id', 'session_id', 'venue_id', 'preset_id', 'created_at', 'app_version', 'algorithms', 'capture',
  'calibration', 'club', 'handedness', 'events', 'metrics', 'quality', 'starred', 'note', 'revision',
]);
/** golf-shot/2 adds flight, tracks, practice (each null or an object). */
export const SHOT_REQUIRED_KEYS = Object.freeze([...SHOT_REQUIRED_KEYS_V1, 'flight', 'tracks', 'practice']);
export const SHOT_OPTIONAL_KEYS = Object.freeze(['history']);
