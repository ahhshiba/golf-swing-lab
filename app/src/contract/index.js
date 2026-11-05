// contract - the honest-null per-shot result contract golf-shot/1 (CAFCR F3; docs/interfaces.md §4, §9).
// Every number the app shows goes through here: a value always has ci95 or sigma, a null always has a reason code.
//
// API summary (signatures only; rules in docs/contract.md, schema in schema/shot-v1.schema.json):
//
// reason-codes.js
//   REASON_CODE_LIST  REASON_CODES = RC  { NAME: 'NAME' }   APP_ERROR_CODES   (codes only; text: t('reason.<CODE>.short|long|fix'))
// enums.js
//   SCHEMA_ID  VIEWS  EVENTS  EVENT_SOURCES  VALUE_VALIDITIES  NULL_VALIDITIES  VALIDITIES  VALUE_ORIGINS
//   METRIC_IDS  METRIC_UNITS  METRIC_DEFAULT_ORIGIN  SETUP_LEVEL_CODES  BALL_CLUB_IDS  CALIBRATION_ORIGINS
//   isAffectedBySetup(id, metricOrOrigin) -> boolean
//   CAPTURE_MODES CAPTURE_SOURCES ORIENTATIONS TIMESTAMP_KINDS CALIB_METHODS CALIB_SOURCES READOUT_SOURCES POSE_KEYS
//   LIES TEE_LIFT_SOURCES HANDEDNESS ALGORITHM_KEYS SHOT_REQUIRED_KEYS SHOT_OPTIONAL_KEYS
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
