// contract - the honest-null per-shot result contract golf-shot/2 (CAFCR F3; docs/interfaces.md §4, §9;
// docs/LAUNCH-MONITOR-SPEC.md §2). golf-shot/1 records are still read (validated by the v1 rules, migrated by migrate.js).
// Every number the app shows goes through here: a value always has ci95 or sigma, a null always has a reason code.
//
// API summary (signatures only; rules in docs/contract.md, schema in schema/shot-v2.schema.json):
//
// reason-codes.js
//   REASON_CODE_LIST  REASON_CODES = RC  { NAME: 'NAME' }   APP_ERROR_CODES   (codes only; text: t('reason.<CODE>.short|long|fix'))
//   REASON_CODE_LIST_V1 (the 29 of golf-shot/1)   MODEL_CODES (★ codes a model-origin number must carry)
// enums.js
//   SCHEMA_ID = SCHEMA_V2 = 'golf-shot/2'  SCHEMA_V1  VIEWS  EVENTS  EVENT_SOURCES  VALUE_VALIDITIES  NULL_VALIDITIES
//   VALIDITIES  VALUE_ORIGINS (+ VALUE_ORIGINS_V1, MODEL_ORIGINS)  METRIC_IDS (36) METRIC_IDS_V1 (22) LM_METRIC_IDS (14)
//   METRIC_UNITS  METRIC_UNIT_LIST  METRIC_DEFAULT_ORIGIN  SETUP_LEVEL_CODES  BALL_CLUB_IDS  CALIBRATION_ORIGINS
//   ALGORITHM_KEYS (+ ALGORITHM_KEYS_V1)  LM_ALGORITHM_NONE  GROUNDS  FLIGHT_MAX_SAMPLES  TRACK_MAX_POINTS
//   isAffectedBySetup(id, metricOrOrigin) -> boolean
//   CAPTURE_MODES CAPTURE_SOURCES ORIENTATIONS TIMESTAMP_KINDS CALIB_METHODS CALIB_SOURCES READOUT_SOURCES POSE_KEYS
//   LIES TEE_LIFT_SOURCES HANDEDNESS SHOT_REQUIRED_KEYS (+ _V1) SHOT_OPTIONAL_KEYS
// migrate.js
//   migrateShot(any) -> { shot: golf-shot/2 | input, migrated }      (v1 -> v2 lossless; v2 / other returned as is)
// metric.js   (throw ContractError on any invariant violation)
//   metricValue({ value, unit, ci95?, sigma?, validity, value_origin, reason_codes? }) -> Metric
//   metricNull(validity, codes, unit, value_origin = 'derived') -> Metric
//   downgrade(metric, code) -> Metric        low_confidence (if it has a number) + code appended
// validate.js
//   validateShot(shot) -> { ok, errors: [{ path, msg }] }      validate = validateShot
//   validateMetric(metric, id?, path?) -> errors[]             assertValid(shot) -> shot | throws ContractError
//   formatErrors(errors, max = 5) -> string                    ContractError { errors }
// shot.js
//   newShot(init) -> shot            emptyMetrics() -> { [id]: not_computed placeholder }
//   attributeWarnings(shot) -> shot  addWarning(shot, code) -> shot
//   bumpRevision(shot, patch, { at? }) -> shot                 revision + 1, replaced values kept in history

export * from './reason-codes.js';
export * from './enums.js';
export * from './metric.js';
export * from './validate.js';
export * from './shot.js';
export { migrateShot, migratedNull } from './migrate.js';
