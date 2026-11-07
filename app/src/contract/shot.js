// Builders for a whole golf-shot/2 object (CAFCR F3, P6). Pure: no clock, no randomness, no mutation of inputs.
//
//   newShot({ shot_id, session_id, created_at, app_version, algorithms, capture, calibration, club, handedness,
//             events, venue_id?, preset_id?, quality?, metrics?, starred?, note? }) -> shot
//   emptyMetrics() -> { [metric id]: not_computed placeholder }
//   attributeWarnings(shot) -> shot     apply quality.warnings to the metrics (downgrade + repeat the code)
//   addWarning(shot, code)  -> shot     add a warning and attribute it
//   bumpRevision(shot, patch, { at? }) -> shot   P6: revision + 1, replaced values kept in `history`
//
// newShot does not validate (a shot is filled in step by step); call validateShot / assertValid before storing.

import { RC, REASON_CODES } from './reason-codes.js';
import {
  SCHEMA_ID, METRIC_IDS, METRIC_UNITS, METRIC_DEFAULT_ORIGIN, SETUP_LEVEL_CODES, SHOT_REQUIRED_KEYS,
  SHOT_OPTIONAL_KEYS, isAffectedBySetup, LM_ALGORITHM_NONE,
} from './enums.js';
import { metricNull, downgrade } from './metric.js';
import { ContractError, validateShot, formatErrors } from './validate.js';

const isPlain = (x) => {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
};

/** Deep copy of JSON-like data (plain objects, arrays, primitives). `undefined` object members are dropped. */
function clone(x) {
  if (Array.isArray(x)) return x.map(clone);
  if (ArrayBuffer.isView(x)) throw new ContractError('shot data must be JSON-like, got a typed array (convert with Array.from)');
  if (isPlain(x)) {
    const out = {};
    for (const k of Object.keys(x)) if (x[k] !== undefined) out[k] = clone(x[k]);
    return out;
  }
  if (typeof x === 'function' || typeof x === 'symbol' || typeof x === 'bigint' || (x !== null && typeof x === 'object')) {
    throw new ContractError(`shot data must be JSON-like, got ${typeof x === 'object' ? 'a non-plain object' : typeof x}`);
  }
  return x;
}

/** Objects merge key by key; arrays and scalars replace. */
function mergeDeep(target, src) {
  if (isPlain(target) && isPlain(src)) {
    const out = { ...target };
    for (const k of Object.keys(src)) {
      if (src[k] === undefined) continue;
      out[k] = k in target ? mergeDeep(target[k], src[k]) : clone(src[k]);
    }
    return out;
  }
  return clone(src);
}

/** All 36 metric ids as not_computed placeholders carrying NOT_IMPLEMENTED. */
export function emptyMetrics() {
  const out = {};
  for (const id of METRIC_IDS) {
    out[id] = metricNull('not_computed', [RC.NOT_IMPLEMENTED], METRIC_UNITS[id], METRIC_DEFAULT_ORIGIN[id]);
  }
  return out;
}

function defaultQuality() {
  return { pose_mean_vis: null, frames_analyzed: 0, frames_dropped: 0, audio_onset: null, touches: 0, warnings: [] };
}

/**
 * Assemble a golf-shot/2 shot. Fills schema, revision 0, starred false, note '', venue_id/preset_id null, flight /
 * tracks / practice null, algorithms.lm = { version: 'none', sha256('none') } when `init.algorithms` has no lm, a
 * default quality block and every metric id as a not_computed placeholder; `init.metrics` replaces placeholders by
 * id (unknown ids throw). Fields that cannot be defaulted honestly (shot_id, session_id, created_at, app_version, algorithms,
 * capture, calibration, club, handedness, events) are copied from `init` when given and otherwise left out, so
 * validateShot names them.
 */
export function newShot(init = {}) {
  if (!isPlain(init)) throw new ContractError('newShot: expected an options object');
  const allowed = [...SHOT_REQUIRED_KEYS, ...SHOT_OPTIONAL_KEYS];
  for (const k of Object.keys(init)) {
    if (!allowed.includes(k)) throw new ContractError(`newShot: unknown field '${k}'`);
  }
  const metrics = emptyMetrics();
  if (init.metrics !== undefined) {
    if (!isPlain(init.metrics)) throw new ContractError('newShot: metrics must be an object keyed by metric id');
    for (const id of Object.keys(init.metrics)) {
      if (!METRIC_IDS.includes(id)) throw new ContractError(`newShot: unknown metric id '${id}'`);
      metrics[id] = clone(init.metrics[id]);
    }
  }
  const base = {
    schema: SCHEMA_ID,
    shot_id: init.shot_id,
    session_id: init.session_id,
    venue_id: init.venue_id === undefined ? null : init.venue_id,
    preset_id: init.preset_id === undefined ? null : init.preset_id,
    created_at: init.created_at,
    app_version: init.app_version,
    algorithms: isPlain(init.algorithms) && !('lm' in init.algorithms) ? { ...init.algorithms, lm: { ...LM_ALGORITHM_NONE } } : init.algorithms,
    capture: init.capture,
    calibration: init.calibration,
    club: init.club,
    handedness: init.handedness,
    events: init.events,
    metrics,
    quality: { ...defaultQuality(), ...(isPlain(init.quality) ? clone(init.quality) : {}) },
    starred: init.starred === undefined ? false : init.starred,
    note: init.note === undefined ? '' : init.note,
    revision: init.revision === undefined ? 0 : init.revision,
    flight: init.flight === undefined ? null : init.flight,
    tracks: init.tracks === undefined ? null : init.tracks,
    practice: init.practice === undefined ? null : init.practice,
  };
  if (init.history !== undefined) base.history = init.history;
  if (init.quality !== undefined && !isPlain(init.quality)) base.quality = init.quality;
  // undefined members are dropped by clone, so missing required fields simply do not appear
  return clone(base);
}

/**
 * Make `shot` satisfy the attribution rule for the setup-level codes currently in quality.warnings: every
 * affected metric (isAffectedBySetup) that carries a number is downgraded to low_confidence and repeats each code.
 * Idempotent; returns a new shot.
 */
export function attributeWarnings(shot) {
  const warnings = shot?.quality?.warnings;
  if (!Array.isArray(warnings) || !isPlain(shot.metrics)) throw new ContractError('attributeWarnings: shot has no quality.warnings or metrics');
  const out = clone(shot);
  for (const code of SETUP_LEVEL_CODES) {
    if (!warnings.includes(code)) continue;
    for (const id of METRIC_IDS) {
      const m = out.metrics[id];
      if (!isPlain(m) || !Array.isArray(m.reason_codes) || m.value === null) continue;
      if (isAffectedBySetup(id, m)) out.metrics[id] = downgrade(m, code);
    }
  }
  return out;
}

/** Add a reason code to quality.warnings (once) and, for setup-level codes, attribute it to the affected metrics. */
export function addWarning(shot, code) {
  if (typeof code !== 'string' || !Object.prototype.hasOwnProperty.call(REASON_CODES, code)) {
    throw new ContractError(`addWarning: unknown reason code ${String(code)}`);
  }
  const out = clone(shot);
  if (!isPlain(out.quality) || !Array.isArray(out.quality.warnings)) throw new ContractError('addWarning: shot has no quality.warnings');
  if (!out.quality.warnings.includes(code)) out.quality.warnings.push(code);
  return SETUP_LEVEL_CODES.includes(code) ? attributeWarnings(out) : out;
}

const FROZEN_KEYS = ['schema', 'shot_id', 'session_id', 'created_at', 'revision', 'history'];

/**
 * P6 (human correction): return a new shot with `patch` deep-merged (objects merge key by key, arrays and scalars
 * replace; `undefined` members are ignored), revision + 1, and the replaced values kept as a history entry
 * { revision: <old revision>, at, before: { <top-level key>: <its value before this patch> } }. The input is never
 * modified. The identity fields (schema, shot_id, session_id, created_at) and revision/history cannot be patched.
 * Throws if the patch introduces a validation error (for example non-monotonic event frames); problems the shot
 * already had before the patch do not block it.
 */
export function bumpRevision(shot, patch, opts = {}) {
  if (!isPlain(shot) || !Number.isInteger(shot.revision) || shot.revision < 0) {
    throw new ContractError('bumpRevision: shot must be an object with an integer revision');
  }
  if (!isPlain(patch)) throw new ContractError('bumpRevision: patch must be an object');
  const allowed = [...SHOT_REQUIRED_KEYS, ...SHOT_OPTIONAL_KEYS];
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
  for (const k of keys) {
    if (!allowed.includes(k)) throw new ContractError(`bumpRevision: unknown field '${k}'`);
    if (FROZEN_KEYS.includes(k)) throw new ContractError(`bumpRevision: '${k}' cannot be patched`);
  }
  const next = clone(shot);
  const before = {};
  for (const k of keys) {
    before[k] = k in shot ? clone(shot[k]) : null;
    next[k] = k in next ? mergeDeep(next[k], patch[k]) : clone(patch[k]);
  }
  next.revision = shot.revision + 1;
  next.history = [...(Array.isArray(shot.history) ? clone(shot.history) : []), { revision: shot.revision, at: opts.at ?? null, before }];

  const known = new Set(validateShot(shot).errors.map((e) => `${e.path}\u0000${e.msg}`));
  const introduced = validateShot(next).errors.filter((e) => !known.has(`${e.path}\u0000${e.msg}`));
  if (introduced.length) throw new ContractError(`bumpRevision: patch makes the shot invalid. ${formatErrors(introduced)}`, introduced);
  return next;
}
