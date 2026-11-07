// i18n/units.js — display units (PRODUCT-SPEC §3.3, §8.0.2 FROZEN; docs/i18n.md "Units"). Storage stays SI.
//
//   DEFAULT_UNITS                     { distance:'yd', speed:'mph', body:'cm', clubLength:'in', height:'cm' } (§10)
//   defaultUnits(languages)           en-US (or bare 'en') → body 'in', height 'ftin'; everything else DEFAULT_UNITS
//   normalizeUnits(u)                 fills/validates a settings.units object
//   fmtMetric(metric, units, { id })  -> { value, unit, ci, text, digits }   value/ci are locale strings, ci null when
//                                        there is none or it rounds to 0; null metric → value '—'
//   fmtQuantity(si, kind, units, { digits }) -> { value, unit, text }   kind: distance|speed|body|clubLength|height|s|deg|pct|ratio|rpm
//   convert(x, from, to)              between m, yd, cm, in, ft, m/s, mph, km/h (aliases mps, kmh)
//   toSI(x, unit) = convert(x, unit, SI of that dimension)
//   parseInput(text, unit) -> SI number | null   ('1,5', '5\'10"', '5 ft 10 in' for 'ftin'); parseLength = parseInput
//   unitLabel(unit) -> localized short label (t('unit.<id>'))
//   metricKind(id, unit)              which settings.units field a metric id displays in
import { t, has, fmtNum } from './index.js';

export const DEFAULT_UNITS = Object.freeze({ distance: 'yd', speed: 'mph', body: 'cm', clubLength: 'in', height: 'cm' });
export const UNIT_CHOICES = Object.freeze({
  distance: Object.freeze(['yd', 'm']),
  speed: Object.freeze(['mph', 'm/s', 'km/h']),
  body: Object.freeze(['cm', 'in']),
  clubLength: Object.freeze(['in', 'm']),
  height: Object.freeze(['cm', 'ftin']),
});

/** SI value of one unit (multiply a value in that unit by this to get SI). Factors from §3.3. */
const TO_SI = Object.freeze({
  m: 1, yd: 1 / 1.09361, cm: 0.01, in: 1 / 39.3701, ft: 12 / 39.3701,
  'm/s': 1, mph: 1 / 2.23694, 'km/h': 1 / 3.6,
  s: 1, deg: 1, '%': 1, ratio: 1, rpm: 1,
});
const ALIAS = Object.freeze({ mps: 'm/s', kmh: 'km/h', pct: '%', ftin: 'in' });
const DIM = Object.freeze({ m: 'L', yd: 'L', cm: 'L', in: 'L', ft: 'L', 'm/s': 'V', mph: 'V', 'km/h': 'V', s: 'T', deg: 'A', '%': 'P', ratio: 'R', rpm: 'W' });
const SI_OF = Object.freeze({ L: 'm', V: 'm/s', T: 's', A: 'deg', P: '%', R: 'ratio', W: 'rpm' });
/** Catalog id of each unit (`unit.<id>`), safe as a key. */
const UNIT_ID = Object.freeze({ m: 'm', yd: 'yd', cm: 'cm', in: 'in', ft: 'ft', 'm/s': 'mps', mph: 'mph', 'km/h': 'kmh', s: 's', deg: 'deg', '%': 'pct', ratio: 'ratio', ftin: 'ftin', rpm: 'rpm' });
const SYMBOL = Object.freeze({ m: 'm', yd: 'yd', cm: 'cm', in: 'in', ft: 'ft', 'm/s': 'm/s', mph: 'mph', 'km/h': 'km/h', s: 's', deg: '°', '%': '%', ratio: '', ftin: 'ft/in', rpm: 'rpm' });

/** Body-scale metrics (m in storage) shown in settings.units.body. Every other 'm' metric is a distance. */
export const BODY_METRIC_IDS = Object.freeze(['head_sway_x_m', 'head_lift_z_m', 'head_depth_y_m', 'hand_plane_dev_m', 'early_extension_m']);

const canon = (u) => ALIAS[u] ?? u;

export function convert(x, from, to) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return NaN;
  const f = canon(from);
  const g = canon(to);
  if (!(f in TO_SI) || !(g in TO_SI)) throw new RangeError(`convert: unknown unit ${from} or ${to}`);
  if (DIM[f] !== DIM[g]) throw new RangeError(`convert: ${from} and ${to} measure different things`);
  if (f === g) return x;
  return (x * TO_SI[f]) / TO_SI[g];
}

export function toSI(x, unit) {
  const u = canon(unit);
  return convert(x, u, SI_OF[DIM[u]] ?? u);
}

export function defaultUnits(languages = globalThis.navigator?.languages ?? []) {
  const first = String((Array.isArray(languages) ? languages[0] : languages) ?? '').toLowerCase();
  if (first === 'en' || first === 'en-us') return { ...DEFAULT_UNITS, body: 'in', height: 'ftin' };
  return { ...DEFAULT_UNITS };
}

export function normalizeUnits(u = {}, base = DEFAULT_UNITS) {
  const out = {};
  for (const [k, choices] of Object.entries(UNIT_CHOICES)) {
    const v = u && typeof u === 'object' ? u[k] : undefined;
    out[k] = choices.includes(v) ? v : base[k];
  }
  return out;
}

/** settings.units field (or fixed kind) for a metric id / stored unit. */
export function metricKind(id, unit) {
  if (BODY_METRIC_IDS.includes(id)) return 'body';
  const u = unit ?? null;
  if (u === 'm') return id === undefined || id === null ? 'body' : 'distance';
  if (u === 'm/s') return 'speed';
  if (u === 's') return 's';
  if (u === 'deg') return 'deg';
  if (u === '%') return 'pct';
  if (u === 'rpm') return 'rpm';
  return 'ratio';
}

/** Display unit and digits for a kind under the given units (digits table §3.3). */
function displayOf(kind, units) {
  const U = normalizeUnits(units);
  switch (kind) {
    case 'distance': return { unit: U.distance, digits: 0 };
    case 'speed': return { unit: U.speed, digits: U.speed === 'km/h' ? 0 : 1 };
    case 'body': return { unit: U.body, digits: 1 };
    case 'clubLength': return { unit: U.clubLength, digits: U.clubLength === 'in' ? 1 : 2 };
    case 'height': return { unit: U.height === 'ftin' ? 'ftin' : 'cm', digits: 0 };
    case 's': return { unit: 's', digits: 2 };
    case 'deg': return { unit: 'deg', digits: 0 };
    case 'pct': return { unit: '%', digits: 0 };
    case 'rpm': return { unit: 'rpm', digits: 0 };
    default: return { unit: 'ratio', digits: 2 };
  }
}

/** Localized short unit label; '' for ratios. */
export function unitLabel(unit) {
  const u = unit === 'ftin' ? 'ftin' : canon(unit);
  const id = UNIT_ID[u];
  if (!id) return String(unit ?? '');
  const key = `unit.${id}`;
  return has(key) ? t(key) : (SYMBOL[u] ?? String(unit));
}

const joinUnit = (v, unit, label) => (!label ? v : unit === 'deg' || unit === '%' ? `${v}${label}` : `${v} ${label}`);

function fmtFtIn(si) {
  const totalIn = Math.round(convert(si, 'm', 'in'));
  const ft = Math.floor(totalIn / 12);
  const inch = totalIn - ft * 12;
  return `${ft}′${inch}″`;
}

/** Any SI quantity in the user's units: { value, unit, text }. */
export function fmtQuantity(si, kind, units = DEFAULT_UNITS, { digits } = {}) {
  const d = displayOf(kind, units);
  if (typeof si !== 'number' || !Number.isFinite(si)) return { value: '—', unit: '', text: '—' };
  if (d.unit === 'ftin') { const s = fmtFtIn(si); return { value: s, unit: '', text: s }; }
  const dig = digits ?? d.digits;
  const v = fmtNum(convert(si, SI_OF[DIM[d.unit]] ?? d.unit, d.unit), { digits: dig });
  const label = unitLabel(d.unit);
  return { value: v, unit: label, text: joinUnit(v, d.unit, label) };
}

/**
 * A contract Metric in the user's units. `id` (or metric.id) selects body vs distance for 'm' metrics.
 * CI = ci95 half width, else 1.96 sigma, scaled by the same factor; null when absent or it rounds to 0.
 */
export function fmtMetric(metric, units = DEFAULT_UNITS, { id } = {}) {
  const mid = id ?? metric?.id;
  const kind = metricKind(mid, metric?.unit ?? null);
  const d = displayOf(kind, units);
  if (!metric || typeof metric.value !== 'number' || !Number.isFinite(metric.value)) {
    return { value: '—', unit: '', ci: null, text: '—', digits: d.digits };
  }
  const from = canon(metric.unit ?? SI_OF[DIM[d.unit]]);
  const val = convert(metric.value, from, d.unit);
  let half = null;
  if (Array.isArray(metric.ci95) && metric.ci95.length === 2 && metric.ci95.every(Number.isFinite)) half = (metric.ci95[1] - metric.ci95[0]) / 2;
  else if (Number.isFinite(metric.sigma)) half = 1.96 * metric.sigma;
  const value = fmtNum(val, { digits: d.digits });
  let ci = null;
  if (half !== null) {
    const h = Math.abs(convert(half, from, d.unit));
    if (Number(h.toFixed(d.digits)) !== 0) ci = fmtNum(h, { digits: d.digits });
  }
  const label = unitLabel(d.unit);
  const core = ci ? `${value} ± ${ci}` : value;
  return { value, unit: label, ci, text: joinUnit(core, d.unit, label), digits: d.digits };
}

/** Parse user input in `unit` → SI number, or null when it is not a number. */
export function parseInput(text, unit) {
  if (typeof text === 'number') return Number.isFinite(text) ? (unit === 'ftin' ? convert(text, 'in', 'm') : toSI(text, unit)) : null;
  const s = String(text ?? '').trim().replace(/[，,]/g, '.').replace(/[＇’′]/g, "'").replace(/[＂”″]/g, '"');
  if (!s) return null;
  if (unit === 'ftin') {
    const m = /^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch(?:es)?)?)?$/i.exec(s);
    if (m) return convert(Number(m[1]) * 12 + Number(m[2] ?? 0), 'in', 'm');
    const n = /^(\d+(?:\.\d+)?)\s*(?:"|in)?$/i.exec(s);
    if (!n) return null;
    const x = Number(n[1]);
    return x <= 8 ? convert(x * 12, 'in', 'm') : convert(x, 'in', 'm'); // a bare 5.8 means feet, 70 means inches
  }
  if (!/^[+\-−]?\d+(?:\.\d+)?$|^[+\-−]?\.\d+$/.test(s)) return null;
  const x = Number(s.replace('−', '-'));
  return Number.isFinite(x) ? toSI(x, unit) : null;
}
export const parseLength = parseInput;
