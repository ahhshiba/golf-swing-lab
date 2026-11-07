// Dependency-free validator for golf-shot/2 and the legacy golf-shot/1 (CAFCR F3, docs/interfaces.md §4,
// docs/LAUNCH-MONITOR-SPEC.md §2). Pure: no DOM, no clock, no randomness.
//
// It implements the parts of schema/shot-v2.schema.json (and, for a shot whose schema is 'golf-shot/1', of the frozen
// schema/shot-v1.schema.json) the app relies on (required fields, unknown fields, enums, types, ranges, metric ids and
// units) plus every F3 invariant that JSON Schema cannot express (ci95 bounds, the warnings attribution rule, event
// order, camera consistency) and the golf-shot/2 cross-field rules. docs/contract.md lists every rule with its message;
// a golf-shot/2 rule's message ends with its rule name in parentheses, e.g. "(flight_t_increasing)".
//
//   validateShot(shot)   -> { ok, errors: [{ path, msg }] }   (golf-shot/1 shots are checked by the v1 rules)
//   validateMetric(m, id?, path?) -> errors[]        (one Metric value, v2 rules; `id` enables the per-metric unit check)
//   assertValid(shot)    -> shot, or throws ContractError (message = first errors, .errors = all)
//   ContractError

import { REASON_CODES, REASON_CODE_LIST_V1, MODEL_CODES } from './reason-codes.js';
import {
  SCHEMA_ID, SCHEMA_V1, VIEWS, EVENTS, EVENT_SOURCES, VALUE_VALIDITIES, VALIDITIES, VALUE_ORIGINS, VALUE_ORIGINS_V1,
  MODEL_ORIGINS, METRIC_IDS, METRIC_IDS_V1, METRIC_UNITS, SETUP_LEVEL_CODES, isAffectedBySetup, CAPTURE_MODES,
  CAPTURE_SOURCES, ORIENTATIONS, TIMESTAMP_KINDS, CALIB_METHODS, CALIB_SOURCES, READOUT_SOURCES, POSE_KEYS, LIES,
  TEE_LIFT_SOURCES, HANDEDNESS, ALGORITHM_KEYS, ALGORITHM_KEYS_V1, SHOT_REQUIRED_KEYS, SHOT_REQUIRED_KEYS_V1,
  SHOT_OPTIONAL_KEYS, GROUNDS, FLIGHT_MAX_SAMPLES, TRACK_MAX_POINTS,
} from './enums.js';
import { isRotation } from '../geom/linalg.js';

/** Per-schema lists (a v1 shot may use only what golf-shot/1 had). */
const V2 = Object.freeze({
  v2: true, schema: SCHEMA_ID, ids: METRIC_IDS, origins: VALUE_ORIGINS, codes: Object.keys(REASON_CODES),
  algKeys: ALGORITHM_KEYS, required: SHOT_REQUIRED_KEYS,
});
const V1 = Object.freeze({
  v2: false, schema: SCHEMA_V1, ids: METRIC_IDS_V1, origins: VALUE_ORIGINS_V1, codes: REASON_CODE_LIST_V1,
  algKeys: ALGORITHM_KEYS_V1, required: SHOT_REQUIRED_KEYS_V1,
});

export class ContractError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = 'ContractError';
    this.errors = errors;
  }
}

const METRIC_KEYS = ['value', 'unit', 'ci95', 'sigma', 'validity', 'value_origin', 'measured', 'reason_codes'];
const ISO_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:([0-5]\d|60)(\.\d+)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const NOTE_MAX = 4000;

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isInt = (x) => typeof x === 'number' && Number.isInteger(x);
const isStr = (x) => typeof x === 'string' && x.length > 0;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const join = (p, k) => (p === '' ? String(k) : typeof k === 'number' ? `${p}[${k}]` : `${p}.${k}`);

function show(v) {
  let s;
  try { s = JSON.stringify(v); } catch { s = String(v); }
  if (s === undefined) s = String(v);
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

/** Report missing required keys and keys that are neither required nor optional. */
function checkKeys(obj, required, optional, path, err) {
  for (const k of required) if (!has(obj, k)) err(join(path, k), 'required field is missing');
  for (const k of Object.keys(obj)) {
    if (!required.includes(k) && !optional.includes(k)) err(join(path, k), 'unknown field');
  }
}

function checkEnum(v, list, path, err) {
  if (!list.includes(v)) err(path, `must be one of ${list.join('|')}, got ${show(v)}`);
}

function checkBool(v, path, err) {
  if (typeof v !== 'boolean') err(path, `must be a boolean, got ${show(v)}`);
}

/** number in [lo, hi]; lo/hi may be omitted. */
function checkNum(v, path, err, lo = -Infinity, hi = Infinity) {
  if (!isNum(v)) { err(path, `must be a finite number, got ${show(v)}`); return false; }
  if (v < lo || v > hi) {
    let want;
    if (lo === Number.MIN_VALUE) want = 'must be > 0';
    else if (hi === Infinity) want = `must be >= ${lo}`;
    else if (lo === -Infinity) want = `must be <= ${hi}`;
    else want = `must be within [${lo}, ${hi}]`;
    err(path, `${want}, got ${v}`);
    return false;
  }
  return true;
}

function checkInt(v, path, err, lo = 0) {
  if (!isInt(v)) { err(path, `must be an integer, got ${show(v)}`); return false; }
  if (v < lo) { err(path, `must be >= ${lo}, got ${v}`); return false; }
  return true;
}

function checkCodeList(list, path, err, P = V2) {
  if (!Array.isArray(list)) { err(path, `must be an array of reason codes, got ${show(list)}`); return false; }
  const seen = new Set();
  list.forEach((c, i) => {
    const p = join(path, i);
    if (typeof c !== 'string' || !has(REASON_CODES, c)) err(p, `unknown reason code ${show(c)}`);
    else if (!P.codes.includes(c)) err(p, `reason code ${c} does not exist in ${P.schema}`);
    else if (seen.has(c)) err(p, `duplicate reason code ${c}`);
    seen.add(c);
  });
  return true;
}

// ------------------------------------------------------------------------------------------------- metric

function checkMetric(m, id, path, err, P = V2) {
  if (!isObj(m)) { err(path, 'metric must be an object'); return; }
  checkKeys(m, METRIC_KEYS, [], path, err);
  const { value, unit, ci95, sigma, validity, value_origin: origin, measured, reason_codes: codes } = m;
  const at = (k) => join(path, k);

  // types and ranges
  const valueOk = value === null || isNum(value);
  if (has(m, 'value') && !valueOk) err(at('value'), `value must be a finite number or null, got ${show(value)}`);
  if (has(m, 'unit')) {
    if (!isStr(unit)) err(at('unit'), 'unit must be a non-empty string');
    else if (id && has(METRIC_UNITS, id) && unit !== METRIC_UNITS[id]) {
      err(at('unit'), `unit ${show(unit)} must be ${show(METRIC_UNITS[id])} for this metric`);
    }
  }
  let ciOk = false; // ci95 is a well-formed [lo, hi] pair
  if (has(m, 'ci95') && ci95 !== null) {
    if (!Array.isArray(ci95) || ci95.length !== 2 || !ci95.every(isNum)) {
      err(at('ci95'), `ci95 must be null or [lo, hi] of finite numbers, got ${show(ci95)}`);
    } else if (ci95[0] > ci95[1]) {
      err(at('ci95'), `ci95 lower bound ${ci95[0]} exceeds upper bound ${ci95[1]}`);
    } else ciOk = true;
  }
  const sigmaOk = sigma === null || (isNum(sigma) && sigma >= 0);
  if (has(m, 'sigma') && !sigmaOk) err(at('sigma'), `sigma must be null or a finite number >= 0, got ${show(sigma)}`);
  const validityOk = VALIDITIES.includes(validity);
  if (has(m, 'validity') && !validityOk) err(at('validity'), `validity must be one of ${VALIDITIES.join('|')}, got ${show(validity)}`);
  if (has(m, 'value_origin')) checkEnum(origin, P.origins, at('value_origin'), err);
  if (has(m, 'measured') && measured !== false) err(at('measured'), 'measured must be false (this app never claims a launch-monitor measurement)');
  const codesOk = has(m, 'reason_codes') ? checkCodeList(codes, at('reason_codes'), err, P) : false;

  // F3 invariants
  const hasValue = valueOk && value !== null;
  const isNull = valueOk && value === null;
  if (validityOk && valueOk) {
    const needsValue = VALUE_VALIDITIES.includes(validity);
    if (isNull && needsValue) err(at('validity'), `value is null but validity '${validity}' requires a value`);
    if (hasValue && !needsValue) err(at('validity'), `value is set but validity '${validity}' means no value`);
  }
  if (isNull && codesOk && codes.length === 0) err(at('reason_codes'), 'null value requires at least one reason code');
  if (hasValue && ci95 === null && sigma === null) err(at('ci95'), 'value requires ci95 or sigma (both are null)');
  if (hasValue && ciOk && (value < ci95[0] || value > ci95[1])) {
    err(at('ci95'), `value ${value} is outside ci95 [${ci95[0]}, ${ci95[1]}]`);
  }
  if (isNull && ci95 !== null && has(m, 'ci95')) err(at('ci95'), 'ci95 must be null when value is null');
  if (isNull && sigma !== null && has(m, 'sigma')) err(at('sigma'), 'sigma must be null when value is null');
  // golf-shot/2: a number from a model must say which model (LAUNCH-MONITOR-SPEC §2.2, §2.3 ★)
  if (P.v2 && hasValue && MODEL_ORIGINS.includes(origin) && codesOk && !codes.some((c) => MODEL_CODES.includes(c))) {
    err(at('reason_codes'), `value_origin '${origin}' is a model, so reason_codes must contain one of ${MODEL_CODES.join('|')} (model_code_required)`);
  }
}

/** Validate one Metric value. Pass the metric id to also check its fixed unit. Returns the error list. */
export function validateMetric(metric, id = null, path = id ? `metrics.${id}` : 'metric') {
  const errors = [];
  checkMetric(metric, id, path, (p, msg) => errors.push({ path: p, msg }));
  return errors;
}

// ------------------------------------------------------------------------------------------------- sections

function checkCamera(cam, path, err) {
  if (!isObj(cam)) { err(path, 'camera must be an object'); return; }
  checkKeys(cam, ['W', 'H', 'f', 'cx', 'cy', 'k1', 'R', 't', 'readout'], [], path, err);
  const wOk = checkInt(cam.W, join(path, 'W'), err, 1);
  const hOk = checkInt(cam.H, join(path, 'H'), err, 1);
  if (has(cam, 'f')) checkNum(cam.f, join(path, 'f'), err, Number.MIN_VALUE);
  if (has(cam, 'cx') && checkNum(cam.cx, join(path, 'cx'), err) && wOk && Math.abs(cam.cx - cam.W / 2) > 1e-6) {
    err(join(path, 'cx'), `principal point must be at the image centre W/2 = ${cam.W / 2}, got ${cam.cx}`);
  }
  if (has(cam, 'cy') && checkNum(cam.cy, join(path, 'cy'), err) && hOk && Math.abs(cam.cy - cam.H / 2) > 1e-6) {
    err(join(path, 'cy'), `principal point must be at the image centre H/2 = ${cam.H / 2}, got ${cam.cy}`);
  }
  if (has(cam, 'k1')) checkNum(cam.k1, join(path, 'k1'), err);
  if (has(cam, 'R')) {
    if (!Array.isArray(cam.R) || cam.R.length !== 9 || !cam.R.every(isNum)) {
      err(join(path, 'R'), 'R must be 9 finite numbers (row-major)');
    } else if (!isRotation(cam.R, 1e-6)) err(join(path, 'R'), 'R is not a rotation matrix (orthonormal, det +1)');
  }
  if (has(cam, 't') && (!Array.isArray(cam.t) || cam.t.length !== 3 || !cam.t.every(isNum))) {
    err(join(path, 't'), 't must be 3 finite numbers');
  }
  if (has(cam, 'readout')) {
    const p = join(path, 'readout');
    if (!isObj(cam.readout)) err(p, 'readout must be an object');
    else {
      checkKeys(cam.readout, ['ms', 'axis', 'dir'], [], p, err);
      if (has(cam.readout, 'ms')) checkNum(cam.readout.ms, join(p, 'ms'), err, 0);
      if (has(cam.readout, 'axis')) checkEnum(cam.readout.axis, ['u', 'v'], join(p, 'axis'), err);
      if (has(cam.readout, 'dir')) checkEnum(cam.readout.dir, [1, -1], join(p, 'dir'), err);
    }
  }
}

function checkPoseObject(o, path, err, minValue) {
  if (!isObj(o)) { err(path, 'must be an object'); return; }
  checkKeys(o, POSE_KEYS, [], path, err);
  for (const k of POSE_KEYS) if (has(o, k)) checkNum(o[k], join(path, k), err, minValue);
}

function checkCalibration(c, path, err) {
  if (!isObj(c)) { err(path, 'calibration must be an object'); return; }
  checkKeys(c, ['method', 'source', 'f_px', 'f_locked', 'pose', 'pose_sigma', 'reproj_rmse_px', 'slope_deg',
    'preset_dev', 'readout_ms', 'readout_source', 'camera'], [], path, err);
  if (has(c, 'method')) checkEnum(c.method, CALIB_METHODS, join(path, 'method'), err);
  if (has(c, 'source')) checkEnum(c.source, CALIB_SOURCES, join(path, 'source'), err);
  const fOk = has(c, 'f_px') && checkNum(c.f_px, join(path, 'f_px'), err, Number.MIN_VALUE);
  if (has(c, 'f_locked')) checkBool(c.f_locked, join(path, 'f_locked'), err);
  if (has(c, 'pose')) checkPoseObject(c.pose, join(path, 'pose'), err, -Infinity);
  if (has(c, 'pose_sigma')) checkPoseObject(c.pose_sigma, join(path, 'pose_sigma'), err, 0);
  if (has(c, 'reproj_rmse_px') && c.reproj_rmse_px !== null) checkNum(c.reproj_rmse_px, join(path, 'reproj_rmse_px'), err, 0);
  if (has(c, 'slope_deg') && c.slope_deg !== null) checkNum(c.slope_deg, join(path, 'slope_deg'), err);
  if (has(c, 'preset_dev') && c.preset_dev !== null) checkPoseObject(c.preset_dev, join(path, 'preset_dev'), err, -Infinity);
  const roOk = has(c, 'readout_ms') && checkNum(c.readout_ms, join(path, 'readout_ms'), err, 0);
  if (has(c, 'readout_source')) checkEnum(c.readout_source, READOUT_SOURCES, join(path, 'readout_source'), err);
  if (has(c, 'camera')) {
    checkCamera(c.camera, join(path, 'camera'), err);
    const cam = c.camera;
    if (isObj(cam)) {
      if (fOk && isNum(cam.f) && Math.abs(c.f_px - cam.f) > 1e-6 * Math.max(1, cam.f)) {
        err(join(path, 'f_px'), `f_px ${c.f_px} differs from camera.f ${cam.f}`);
      }
      if (roOk && isObj(cam.readout) && isNum(cam.readout.ms) && Math.abs(c.readout_ms - cam.readout.ms) > 1e-9) {
        err(join(path, 'readout_ms'), `readout_ms ${c.readout_ms} differs from camera.readout.ms ${cam.readout.ms}`);
      }
    }
  }
}

function checkCapture(c, path, err) {
  if (!isObj(c)) { err(path, 'capture must be an object'); return; }
  checkKeys(c, ['mode', 'view', 'source', 'orientation', 'width', 'height', 'nominal_fps', 'effective_fps', 'vfr',
    'timestamps', 'clip_ref', 'trim_s'], [], path, err);
  if (has(c, 'mode')) checkEnum(c.mode, CAPTURE_MODES, join(path, 'mode'), err);
  if (has(c, 'view')) checkEnum(c.view, VIEWS, join(path, 'view'), err);
  if (has(c, 'source')) checkEnum(c.source, CAPTURE_SOURCES, join(path, 'source'), err);
  if (has(c, 'orientation')) checkEnum(c.orientation, ORIENTATIONS, join(path, 'orientation'), err);
  if (has(c, 'width')) checkInt(c.width, join(path, 'width'), err, 1);
  if (has(c, 'height')) checkInt(c.height, join(path, 'height'), err, 1);
  if (has(c, 'nominal_fps')) checkNum(c.nominal_fps, join(path, 'nominal_fps'), err, Number.MIN_VALUE);
  if (has(c, 'effective_fps')) checkNum(c.effective_fps, join(path, 'effective_fps'), err, Number.MIN_VALUE);
  if (has(c, 'vfr')) checkBool(c.vfr, join(path, 'vfr'), err);
  if (has(c, 'timestamps')) checkEnum(c.timestamps, TIMESTAMP_KINDS, join(path, 'timestamps'), err);
  if (has(c, 'clip_ref') && c.clip_ref !== null && !isStr(c.clip_ref)) err(join(path, 'clip_ref'), 'clip_ref must be null or a non-empty string');
  if (has(c, 'trim_s') && c.trim_s !== null) {
    const t = c.trim_s;
    if (!Array.isArray(t) || t.length !== 2 || !t.every(isNum) || t[0] < 0 || t[1] <= t[0]) {
      err(join(path, 'trim_s'), `trim_s must be null or [start_s, end_s] with 0 <= start < end, got ${show(t)}`);
    }
  }
}

function checkClub(c, path, err) {
  if (!isObj(c)) { err(path, 'club must be an object'); return; }
  checkKeys(c, ['type', 'length_m', 'lie', 'tee_lift_m', 'tee_lift_source'], [], path, err);
  if (has(c, 'type') && !isStr(c.type)) err(join(path, 'type'), 'type must be a non-empty string');
  if (has(c, 'length_m')) checkNum(c.length_m, join(path, 'length_m'), err, 0.5, 1.5);
  if (has(c, 'lie')) checkEnum(c.lie, LIES, join(path, 'lie'), err);
  if (has(c, 'tee_lift_m')) checkNum(c.tee_lift_m, join(path, 'tee_lift_m'), err, 0, 0.15);
  if (has(c, 'tee_lift_source')) checkEnum(c.tee_lift_source, TEE_LIFT_SOURCES, join(path, 'tee_lift_source'), err);
}

function checkEvents(ev, path, err) {
  if (!isObj(ev)) { err(path, 'events must be an object'); return; }
  checkKeys(ev, EVENTS, [], path, err);
  let prev = null;
  for (const name of EVENTS) {
    if (!has(ev, name)) continue;
    const e = ev[name];
    const p = join(path, name);
    if (!isObj(e)) { err(p, 'event must be an object'); continue; }
    checkKeys(e, ['frame', 't_s', 'conf', 'source'], [], p, err);
    const fOk = has(e, 'frame') && checkInt(e.frame, join(p, 'frame'), err, 0);
    const tOk = has(e, 't_s') && checkNum(e.t_s, join(p, 't_s'), err, 0);
    if (has(e, 'conf')) checkNum(e.conf, join(p, 'conf'), err, 0, 1);
    if (has(e, 'source')) checkEnum(e.source, EVENT_SOURCES, join(p, 'source'), err);
    if (prev && fOk && e.frame < prev.frame) {
      err(join(p, 'frame'), `frame ${e.frame} is before ${prev.name} frame ${prev.frame}; event frames must be non-decreasing`);
    }
    if (prev && tOk && e.t_s < prev.t_s) {
      err(join(p, 't_s'), `t_s ${e.t_s} is before ${prev.name} t_s ${prev.t_s}; event times must be non-decreasing`);
    }
    if (fOk && tOk) prev = { name, frame: e.frame, t_s: e.t_s };
  }
}

function checkQuality(q, path, err, P) {
  if (!isObj(q)) { err(path, 'quality must be an object'); return; }
  checkKeys(q, ['pose_mean_vis', 'frames_analyzed', 'frames_dropped', 'audio_onset', 'touches', 'warnings'], [], path, err);
  if (has(q, 'pose_mean_vis') && q.pose_mean_vis !== null) checkNum(q.pose_mean_vis, join(path, 'pose_mean_vis'), err, 0, 1);
  if (has(q, 'frames_analyzed')) checkInt(q.frames_analyzed, join(path, 'frames_analyzed'), err, 0);
  if (has(q, 'frames_dropped')) checkInt(q.frames_dropped, join(path, 'frames_dropped'), err, 0);
  if (has(q, 'audio_onset') && q.audio_onset !== null) checkNum(q.audio_onset, join(path, 'audio_onset'), err, 0);
  if (has(q, 'touches')) checkInt(q.touches, join(path, 'touches'), err, 0);
  if (has(q, 'warnings')) checkCodeList(q.warnings, join(path, 'warnings'), err, P);
}

function checkAlgorithms(a, path, err, P) {
  if (!isObj(a)) { err(path, 'algorithms must be an object'); return; }
  checkKeys(a, P.algKeys, [], path, err);
  for (const k of P.algKeys) {
    if (!has(a, k)) continue;
    const p = join(path, k);
    const v = a[k];
    if (!isObj(v)) { err(p, 'must be an object {version, sha256}'); continue; }
    checkKeys(v, ['version', 'sha256'], [], p, err);
    if (has(v, 'version') && !isStr(v.version)) err(join(p, 'version'), 'version must be a non-empty string');
    if (has(v, 'sha256') && !(typeof v.sha256 === 'string' && SHA256_RE.test(v.sha256))) {
      err(join(p, 'sha256'), 'sha256 must be 64 lowercase hex characters');
    }
  }
}

function checkMetrics(ms, path, err, P) {
  if (!isObj(ms)) { err(path, 'metrics must be an object'); return; }
  checkKeys(ms, P.ids, [], path, err);
  for (const id of P.ids) if (has(ms, id)) checkMetric(ms[id], id, join(path, id), err, P);
}

// ------------------------------------------------------------------------------------------------- golf-shot/2 blocks

const isPoint = (p, n) => Array.isArray(p) && p.length === n && p.every(isNum);

function checkFlight(f, carry, path, err) {
  if (f === null) return;
  if (!isObj(f)) { err(path, 'flight must be null or an object'); return; }
  checkKeys(f, ['samples', 'landing', 'rest', 'band', 'ground', 'model'], [], path, err);
  const at = (k) => join(path, k);
  if (has(f, 'samples')) {
    const s = f.samples;
    if (!Array.isArray(s) || s.length < 2 || s.length > FLIGHT_MAX_SAMPLES) {
      err(at('samples'), `samples must be an array of 2..${FLIGHT_MAX_SAMPLES} [t_s, x_m, y_m, z_m] points`);
    } else {
      s.forEach((p, i) => {
        const pp = join(at('samples'), i);
        if (!isPoint(p, 4)) { err(pp, 'sample must be [t_s, x_m, y_m, z_m] of finite numbers'); return; }
        if (i > 0 && isPoint(s[i - 1], 4) && !(p[0] > s[i - 1][0])) err(pp, `t ${p[0]} must be greater than the previous sample's ${s[i - 1][0]} (flight_t_increasing)`);
        if (p[3] < -0.01) err(pp, `z ${p[3]} m is below the ground (z >= -0.01) (flight_z_above_ground)`);
      });
    }
  }
  if (has(f, 'landing')) {
    const l = f.landing;
    if (!isObj(l)) err(at('landing'), 'landing must be { x_m, y_m, t_s }');
    else {
      checkKeys(l, ['x_m', 'y_m', 't_s'], [], at('landing'), err);
      for (const k of ['x_m', 'y_m']) if (has(l, k)) checkNum(l[k], join(at('landing'), k), err);
      if (has(l, 't_s')) checkNum(l.t_s, join(at('landing'), 't_s'), err, 0);
    }
  }
  if (has(f, 'rest') && f.rest !== null) {
    if (!isObj(f.rest)) err(at('rest'), 'rest must be null or { x_m, y_m }');
    else {
      checkKeys(f.rest, ['x_m', 'y_m'], [], at('rest'), err);
      for (const k of ['x_m', 'y_m']) if (has(f.rest, k)) checkNum(f.rest[k], join(at('rest'), k), err);
    }
  }
  if (has(f, 'band') && f.band !== null) {
    if (!isObj(f.band)) err(at('band'), 'band must be null or { side_lo, side_hi }');
    else {
      checkKeys(f.band, ['side_lo', 'side_hi'], [], at('band'), err);
      for (const k of ['side_lo', 'side_hi']) {
        if (has(f.band, k) && !(Array.isArray(f.band[k]) && f.band[k].every((p) => isPoint(p, 2)))) err(join(at('band'), k), `${k} must be an array of [x, y] points`);
      }
    }
  }
  if (has(f, 'ground')) checkEnum(f.ground, GROUNDS, at('ground'), err);
  if (has(f, 'model') && !isStr(f.model)) err(at('model'), 'model must be a non-empty string');
  // flight non-null => carry_m has a number that agrees with the landing point
  if (!isObj(carry) || !isNum(carry.value)) {
    err(path, 'flight is set but metrics.carry_m has no value (flight_needs_carry)');
  } else if (isObj(f.landing) && isNum(f.landing.x_m) && Math.abs(f.landing.x_m - carry.value) > 0.5) {
    err(at('landing.x_m'), `landing x ${f.landing.x_m} m differs from carry_m ${carry.value} m by more than 0.5 m (flight_landing_matches_carry)`);
  }
}

function checkTracks(tr, path, err) {
  if (tr === null) return;
  if (!isObj(tr)) { err(path, 'tracks must be null or an object'); return; }
  checkKeys(tr, ['ball_px', 'impact_frame', 'view'], [], path, err);
  const at = (k) => join(path, k);
  if (has(tr, 'ball_px')) {
    const b = tr.ball_px;
    if (!Array.isArray(b) || b.length > TRACK_MAX_POINTS) err(at('ball_px'), `ball_px must be an array of at most ${TRACK_MAX_POINTS} [frame, u, v, r_px] points`);
    else {
      b.forEach((p, i) => {
        const pp = join(at('ball_px'), i);
        if (!isPoint(p, 4) || !isInt(p[0]) || p[0] < 0 || p[3] < 0) { err(pp, 'point must be [frame (integer >= 0), u, v, r_px (>= 0)]'); return; }
        if (i > 0 && isPoint(b[i - 1], 4) && !(p[0] > b[i - 1][0])) err(pp, `frame ${p[0]} must be greater than the previous point's ${b[i - 1][0]} (tracks_frame_increasing)`);
      });
    }
  }
  if (has(tr, 'impact_frame')) checkInt(tr.impact_frame, at('impact_frame'), err, 0);
  if (has(tr, 'view')) checkEnum(tr.view, VIEWS, at('view'), err);
}

function checkPractice(pr, path, err) {
  if (pr === null) return;
  if (!isObj(pr)) { err(path, 'practice must be null or an object'); return; }
  checkKeys(pr, ['drill_id', 'slot', 'target_m', 'attempt'], [], path, err);
  if (has(pr, 'drill_id') && !isStr(pr.drill_id)) err(join(path, 'drill_id'), 'drill_id must be a non-empty string');
  if (has(pr, 'slot')) checkInt(pr.slot, join(path, 'slot'), err, 0);
  if (has(pr, 'attempt')) checkInt(pr.attempt, join(path, 'attempt'), err, 0);
  if (has(pr, 'target_m') && !(isNum(pr.target_m) && pr.target_m > 0)) {
    err(join(path, 'target_m'), `target_m must be a number > 0, got ${show(pr.target_m)} (practice_target_positive)`);
  }
}

/** quality.warnings <-> metric reason_codes rule (docs/contract.md "Attribution rule"). */
function checkAttribution(shot, err, P) {
  const warnings = shot.quality?.warnings;
  const metrics = shot.metrics;
  if (!Array.isArray(warnings) || !isObj(metrics)) return;
  const active = SETUP_LEVEL_CODES.filter((c) => warnings.includes(c));
  for (const id of P.ids) {
    const m = metrics[id];
    if (!isObj(m) || !Array.isArray(m.reason_codes)) continue;
    for (const c of SETUP_LEVEL_CODES) {
      if (m.reason_codes.includes(c) && !warnings.includes(c)) {
        err(join(join('metrics', id), 'reason_codes'), `setup-level code ${c} is on this metric but missing from quality.warnings`);
      }
    }
    if (active.length === 0 || !isNum(m.value) || !isAffectedBySetup(id, m)) continue;
    const base = join('metrics', id);
    if (m.validity !== 'low_confidence') {
      err(join(base, 'validity'), `quality.warnings has setup-level code(s) ${active.join(', ')}; this affected metric must be downgraded to low_confidence, got '${m.validity}'`);
    }
    for (const c of active) {
      if (!m.reason_codes.includes(c)) {
        err(join(base, 'reason_codes'), `quality.warnings has ${c} but this affected metric does not repeat it in reason_codes`);
      }
    }
  }
}

function checkHistory(h, shot, path, err) {
  if (!Array.isArray(h)) { err(path, 'history must be an array'); return; }
  let prev = -1;
  h.forEach((entry, i) => {
    const p = join(path, i);
    if (!isObj(entry)) { err(p, 'history entry must be an object'); return; }
    checkKeys(entry, ['revision', 'at', 'before'], [], p, err);
    if (has(entry, 'revision') && checkInt(entry.revision, join(p, 'revision'), err, 0)) {
      if (entry.revision <= prev) err(join(p, 'revision'), `history revisions must be strictly increasing, got ${entry.revision} after ${prev}`);
      if (isInt(shot.revision) && entry.revision >= shot.revision) {
        err(join(p, 'revision'), `history revision ${entry.revision} must be lower than the shot revision ${shot.revision}`);
      }
      prev = entry.revision;
    }
    if (has(entry, 'at') && entry.at !== null && !(typeof entry.at === 'string' && ISO_RE.test(entry.at))) {
      err(join(p, 'at'), 'at must be null or an ISO-8601 date-time');
    }
    if (has(entry, 'before') && !isObj(entry.before)) err(join(p, 'before'), 'before must be an object of replaced top-level values');
  });
}

// ------------------------------------------------------------------------------------------------- shot

/**
 * Validate a whole shot: golf-shot/2, or a legacy golf-shot/1 (imported backups, records stored before the update)
 * by the v1 rules. Any other schema value is an error ("schema must be 'golf-shot/2' ...").
 */
export function validateShot(shot) {
  const errors = [];
  const err = (path, msg) => errors.push({ path, msg });
  if (!isObj(shot)) {
    err('$', 'shot must be an object');
    return { ok: false, errors };
  }
  // an unknown schema value is reported once and the rest is checked by the rules of the shape it has
  const P = shot.schema === SCHEMA_V1 || (shot.schema !== SCHEMA_ID && !has(shot, 'flight')) ? V1 : V2;
  checkKeys(shot, P.required, SHOT_OPTIONAL_KEYS, '', err);
  if (has(shot, 'schema') && shot.schema !== SCHEMA_ID && shot.schema !== SCHEMA_V1) err('schema', `schema must be '${SCHEMA_ID}' (or '${SCHEMA_V1}' for a legacy record), got ${show(shot.schema)}`);
  for (const k of ['shot_id', 'session_id', 'app_version']) {
    if (has(shot, k) && !isStr(shot[k])) err(k, `${k} must be a non-empty string`);
  }
  for (const k of ['venue_id', 'preset_id']) {
    if (has(shot, k) && shot[k] !== null && !isStr(shot[k])) err(k, `${k} must be null or a non-empty string`);
  }
  if (has(shot, 'created_at') && !(typeof shot.created_at === 'string' && ISO_RE.test(shot.created_at))) {
    err('created_at', 'created_at must be an ISO-8601 date-time with a timezone');
  }
  if (has(shot, 'algorithms')) checkAlgorithms(shot.algorithms, 'algorithms', err, P);
  if (has(shot, 'capture')) checkCapture(shot.capture, 'capture', err);
  if (has(shot, 'calibration')) checkCalibration(shot.calibration, 'calibration', err);
  if (has(shot, 'club')) checkClub(shot.club, 'club', err);
  if (has(shot, 'handedness')) checkEnum(shot.handedness, HANDEDNESS, 'handedness', err);
  if (has(shot, 'events')) checkEvents(shot.events, 'events', err);
  if (has(shot, 'metrics')) checkMetrics(shot.metrics, 'metrics', err, P);
  if (has(shot, 'quality')) checkQuality(shot.quality, 'quality', err, P);
  if (P.v2) {
    if (has(shot, 'flight')) checkFlight(shot.flight, isObj(shot.metrics) ? shot.metrics.carry_m : null, 'flight', err);
    if (has(shot, 'tracks')) checkTracks(shot.tracks, 'tracks', err);
    if (has(shot, 'practice')) checkPractice(shot.practice, 'practice', err);
  }
  if (has(shot, 'starred')) checkBool(shot.starred, 'starred', err);
  if (has(shot, 'note') && !(typeof shot.note === 'string' && shot.note.length <= NOTE_MAX)) {
    err('note', `note must be a string of at most ${NOTE_MAX} characters`);
  }
  if (has(shot, 'revision')) checkInt(shot.revision, 'revision', err, 0);
  if (has(shot, 'history')) checkHistory(shot.history, shot, 'history', err);
  checkAttribution(shot, err, P);
  return { ok: errors.length === 0, errors };
}

export const validate = validateShot;
export default validateShot;

/** Return `shot` if valid, else throw ContractError listing the first errors. */
export function assertValid(shot) {
  const { ok, errors } = validateShot(shot);
  if (!ok) throw new ContractError(formatErrors(errors), errors);
  return shot;
}

/** "path: msg" lines, at most `max` of them. */
export function formatErrors(errors, max = 5) {
  const lines = errors.slice(0, max).map((e) => `${e.path}: ${e.msg}`);
  if (errors.length > max) lines.push(`... and ${errors.length - max} more`);
  return `golf-shot invalid (${errors.length} error${errors.length === 1 ? '' : 's'}): ${lines.join('; ')}`;
}
