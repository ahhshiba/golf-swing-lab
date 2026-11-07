// Reason codes for golf-shot/1 (CAFCR §F3). Every code used anywhere in app/src must be referenced as
// RC.<NAME> (imported from this file) so scripts/check_contract.mjs can verify it statically.
// Owner: foundation (PRODUCT-SPEC §8 WP-A). Other modules may only read this file; ask for new codes in their report.
// This file holds codes only (PRODUCT-SPEC §3.4): no prose. Every description lives in the catalogs,
// t('reason.<CODE>.short' | '.long' | '.fix') (app/i18n/<locale>/reason.json); the zh-Hant `.long` value is the
// contract's own description (scripts/check_contract.mjs and tests/unit/i18n.catalogs.test.mjs check it exists).

/** Every reason code, in contract order. Adding codes is allowed, removing or renaming is not. */
export const REASON_CODE_LIST = Object.freeze([
  'VIEW_DEPTH_AXIS', 'VIEW_PLANE_MISMATCH', 'FPS_TOO_LOW', 'TRACK_TOO_SHORT', 'TRACK_MAY_BE_SHORT',
  'LAUNCH_DIR_UNOBSERVABLE', 'DEPENDS_ON_NULL', 'SPIN_ASSUMED', 'WIND_IGNORED', 'TIMESTAMPS_NOMINAL',
  'TIMEBASE_SUSPECT', 'SETUP_UNVERIFIED', 'CALIB_STALE', 'PRESET_MISMATCH', 'DEPTH_DRIFT_SUSPECT',
  'ROLLING_SHUTTER_ASSUMED', 'BODY_PLANE_ASSUMED', 'NO_GRAVITY_REF', 'AUDIO_UNAVAILABLE', 'THERMAL_DEGRADED',
  'TEE_LIFT_ASSUMED', 'POSE_LOW_VISIBILITY', 'EVENTS_UNCERTAIN', 'OUT_OF_FRAME', 'IMPLAUSIBLE_VALUE',
  'NOT_IMPLEMENTED', 'NO_CALIBRATION', 'CLIP_NOT_SAVED', 'SLOWMO_CORRECTED',
  // PRODUCT-SPEC §8.0.7 (drop 1) added NO_CALIBRATION, CLIP_NOT_SAVED, SLOWMO_CORRECTED
  'DPLANE_MODEL', 'SPIN_MODELLED', 'SPIN_LOFT_ASSUMED', 'FLIGHT_MODELLED', 'ROLL_MODELLED', 'SMASH_ASSUMED',
  'LAUNCH_V_ASSUMED', 'CROSS_VIEW_PRIOR', 'MIGRATED_V1',
  // LAUNCH-MONITOR-SPEC §2.3 (golf-shot/2, LM-A drop 1) added the nine above
  'PROVISIONAL', 'GAPPING_PRIOR', 'REFERENCE_PRIOR', 'SIDE_SAMPLED', 'MANUAL_ENTRY', 'LIE_ADJUSTED', 'AUTO_PUTT',
  'AUTO_CHIP', 'FAULT_INCONCLUSIVE',
  // V04-SPEC §F.3 (0.4.0, V4-A drop 1) added the nine above
]);

/** The 29 codes of golf-shot/1 (schema/shot-v1.schema.json); a v1 shot may only carry these. */
export const REASON_CODE_LIST_V1 = Object.freeze(REASON_CODE_LIST.slice(0, 29));

/** Model codes (LAUNCH-MONITOR-SPEC §2.3 ★, V04-SPEC §F.3 ★): a non-null metric whose value_origin is a model must carry one. */
export const MODEL_CODES = Object.freeze(['DPLANE_MODEL', 'SPIN_MODELLED', 'FLIGHT_MODELLED', 'ROLL_MODELLED', 'GAPPING_PRIOR',
  'REFERENCE_PRIOR', 'AUTO_PUTT', 'AUTO_CHIP']);

/** { NAME: 'NAME' } for every code: membership tests (`code in REASON_CODES`) and Object.keys() order. */
export const REASON_CODES = Object.freeze(Object.fromEntries(REASON_CODE_LIST.map((k) => [k, k])));

export const RC = REASON_CODES;

/**
 * Error codes added by PRODUCT-SPEC §8.0.7 (drop 1) for the app shell, the worker client, the store and the camera.
 * The worker protocol's ERR list (workers/protocol.js, owner platform) merges these; UI text is t('error.<CODE>')
 * and t('error.<CODE>.fix'). NO_SWING_FOUND already exists in workers/protocol.js.
 */
export const APP_ERROR_CODES = Object.freeze({
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  ANALYSIS_TIMEOUT: 'ANALYSIS_TIMEOUT',
  WORKER_CRASHED: 'WORKER_CRASHED',
  WORKER_UNAVAILABLE: 'WORKER_UNAVAILABLE',
  FILE_TRUNCATED: 'FILE_TRUNCATED',
  REPO_UNAVAILABLE: 'REPO_UNAVAILABLE',
  CAMERA_DENIED: 'CAMERA_DENIED',
  CAMERA_BUSY: 'CAMERA_BUSY',
  CAMERA_MISSING: 'CAMERA_MISSING',
});
