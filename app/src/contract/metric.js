// Builders for the Metric value (docs/interfaces.md §4): the only way modules should create a number or an honest
// null. Every builder throws ContractError when an F3 invariant would be violated, so a bad metric cannot exist.
//
//   metricValue({ value, unit, ci95?, sigma?, validity, value_origin, reason_codes? }) -> Metric
//   metricNull(validity, codes, unit, value_origin = 'derived')                         -> Metric
//   downgrade(metric, code)                                                              -> Metric (new object)

import { REASON_CODES } from './reason-codes.js';
import { VALUE_VALIDITIES, NULL_VALIDITIES } from './enums.js';
import { ContractError, validateMetric } from './validate.js';

const VALUE_INPUT_KEYS = ['value', 'unit', 'ci95', 'sigma', 'validity', 'value_origin', 'measured', 'reason_codes'];

function fail(who, errors) {
  const text = errors.map((e) => `${e.path}: ${e.msg}`).join('; ');
  throw new ContractError(`${who}: ${text}`, errors);
}

/** Accept one code or an array; drop duplicates but keep first-seen order. */
function normalizeCodes(codes, who) {
  if (codes === undefined || codes === null) return [];
  const list = typeof codes === 'string' ? [codes] : codes;
  if (!Array.isArray(list)) throw new ContractError(`${who}: reason codes must be a string or an array of strings`);
  return [...new Set(list)];
}

function finish(who, metric) {
  const errors = validateMetric(metric);
  if (errors.length) fail(who, errors);
  return metric;
}

/**
 * A metric that carries a number. Needs value (finite), a unit, validity in {valid, estimated, low_confidence},
 * a value_origin, and ci95 = [lo, hi] (lo <= value <= hi) and/or sigma (>= 0).
 * `measured` is always false and may only be passed as false.
 */
export function metricValue(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ContractError('metricValue: expected an options object');
  }
  for (const k of Object.keys(input)) {
    if (!VALUE_INPUT_KEYS.includes(k)) throw new ContractError(`metricValue: unknown option '${k}'`);
  }
  if (input.value === null || input.value === undefined) {
    throw new ContractError('metricValue: value must be a finite number (use metricNull for an honest null)');
  }
  if (!VALUE_VALIDITIES.includes(input.validity)) {
    throw new ContractError(`metricValue: validity must be one of ${VALUE_VALIDITIES.join('|')} for a number, got ${String(input.validity)}`);
  }
  const metric = {
    value: input.value,
    unit: input.unit,
    ci95: input.ci95 === undefined || input.ci95 === null ? null : Array.from(input.ci95),
    sigma: input.sigma === undefined ? null : input.sigma,
    validity: input.validity,
    value_origin: input.value_origin,
    measured: input.measured === undefined ? false : input.measured,
    reason_codes: normalizeCodes(input.reason_codes, 'metricValue'),
  };
  return finish('metricValue', metric);
}

/**
 * An honest null: no value, a null-type validity (occluded, ambiguous, dropped, stale, not_observable,
 * implausible, not_computed), at least one reason code, and the unit the number would have had.
 * value_origin says which pipeline would have produced it; it defaults to 'derived'.
 */
export function metricNull(validity, codes, unit, value_origin = 'derived') {
  if (!NULL_VALIDITIES.includes(validity)) {
    throw new ContractError(`metricNull: validity must be one of ${NULL_VALIDITIES.join('|')} for a null, got ${String(validity)}`);
  }
  const list = normalizeCodes(codes, 'metricNull');
  if (list.length === 0) throw new ContractError('metricNull: at least one reason code is required');
  const metric = {
    value: null,
    unit,
    ci95: null,
    sigma: null,
    validity,
    value_origin,
    measured: false,
    reason_codes: list,
  };
  return finish('metricNull', metric);
}

/**
 * Attribution helper (CAFCR F3): return a copy of `metric` with `code` appended to reason_codes. A metric that
 * carries a number becomes low_confidence; a null metric keeps its null-type validity (it has no number to
 * downgrade, and low_confidence would break the value <=> validity invariant). The input is not modified.
 */
export function downgrade(metric, code) {
  if (typeof code !== 'string' || !Object.prototype.hasOwnProperty.call(REASON_CODES, code)) {
    throw new ContractError(`downgrade: unknown reason code ${String(code)}`);
  }
  if (metric === null || typeof metric !== 'object' || !Array.isArray(metric.reason_codes)) {
    throw new ContractError('downgrade: expected a Metric value');
  }
  const next = {
    ...metric,
    ci95: metric.ci95 === null ? null : Array.from(metric.ci95),
    reason_codes: metric.reason_codes.includes(code) ? [...metric.reason_codes] : [...metric.reason_codes, code],
  };
  if (next.value !== null) next.validity = 'low_confidence';
  return finish('downgrade', next);
}
