// store/compare.js — compare two shots, or two sets of shots, metric by metric (P7, KD6). Pure.
//
// Convention: every difference is B minus A. Results:
//   compareShots(a, b) -> { kind: 'shots', a, b, like_for_like, warnings, notes, metrics }
//   compareSets(listA, listB) -> { kind: 'sets', a, b, like_for_like, warnings, notes, metrics }
//   warnings: reason codes (RC.*). RC.PRESET_MISMATCH is ALWAYS present when the presets differ, and also when a
//     preset id is missing on either side (a missing id cannot prove the same setup). For sets it is present unless
//     both sets consist of exactly one and the same preset.
//   notes: [{ kind: 'view_mismatch' | 'club_mismatch' | 'mixed_views' | 'mixed_clubs' | 'mixed_presets' | 'empty_set'
//             | 'small_sample' | 'model_mismatch', params }] — codes only (PRODUCT-SPEC §3.4); the UI renders t('compare.note.<kind>', …).
//             params: view_mismatch { a, b } (view ids), club_mismatch { a, b } (club types, null = unknown),
//             empty_set { side: 'A' | 'B' }, small_sample { min }, the others {}. model_mismatch (sets): the shots
//             were derived with more than one algorithms.lm version (a missing one counts as 'none').
//   like_for_like: true only when there are no warnings and no notes.
//   metrics: { [metric id]: entry } in the order of metric-ids.js (ids unknown to that list follow, sorted).
//     shots entry: { id, unit, a, b, delta, delta_ci95, significant, status }
//       a / b = { value, unit, ci95, sigma, validity, reason_codes } or null when the shot has no such metric.
//       status: 'compared' | 'a_null' | 'b_null' | 'both_null' | 'missing_a' | 'missing_b' | 'unit_mismatch'
//       delta_ci95 = delta +- 1.96 * sqrt(sigma_a^2 + sigma_b^2), where a missing sigma is taken from the ci95
//       half width / 1.96; it is null (and significant is null) when either side has no uncertainty at all.
//       significant: true when delta_ci95 excludes 0.
//     sets entry: { id, unit, a, b, delta, delta_ci95, significant, status } with a / b = { n, n_null, mean, sd,
//       median } over the shots that have a number; delta = mean_b - mean_a; delta_ci95 is a Welch interval with a
//       Student-t factor (needs n >= 2 on both sides, else null). status: 'compared' | 'a_empty' | 'b_empty' |
//       'both_empty' | 'unit_mismatch'.

import { RC } from '../contract/reason-codes.js';
import { mean, std, median } from '../geom/stats.js';
import { METRIC_IDS } from './metric-ids.js';

const Z95 = 1.959964;

// Two-sided 95% Student-t factors for df = 1..30; beyond that a conservative (larger) value for the df bracket.
const T975 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145,
  2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];

export function tCritical95(df) {
  const d = Math.max(1, Math.floor(df));
  if (d <= 30) return T975[d - 1];
  if (d <= 40) return 2.042;
  if (d <= 60) return 2.021;
  if (d <= 120) return 2.0;
  return 1.98;
}

const finite = (x) => typeof x === 'number' && Number.isFinite(x);
const nanToNull = (x) => (Number.isFinite(x) ? x : null);

function ident(shot) {
  return {
    shot_id: shot.shot_id ?? null,
    created_at: shot.created_at ?? null,
    venue_id: shot.venue_id ?? null,
    preset_id: shot.preset_id ?? null,
    view: shot.capture?.view ?? null,
    club_type: shot.club?.type ?? null,
  };
}

function present(v) {
  return v !== undefined && v !== null && v !== '';
}

function metricIds(shots) {
  const seen = new Set();
  for (const s of shots) for (const id of Object.keys(s.metrics ?? {})) seen.add(id);
  return [...METRIC_IDS.filter((id) => seen.has(id)), ...[...seen].filter((id) => !METRIC_IDS.includes(id)).sort()];
}

// ------------------------------------------------------------------------------------------ shot vs shot

function side(m) {
  if (m === null || typeof m !== 'object') return null;
  const ci = Array.isArray(m.ci95) && m.ci95.length === 2 && finite(m.ci95[0]) && finite(m.ci95[1]) ? [m.ci95[0], m.ci95[1]] : null;
  return {
    value: finite(m.value) ? m.value : null,
    unit: m.unit ?? null,
    ci95: ci,
    sigma: finite(m.sigma) && m.sigma > 0 ? m.sigma : null,
    validity: m.validity ?? null,
    reason_codes: Array.isArray(m.reason_codes) ? [...m.reason_codes] : [],
  };
}

function sigmaOf(s) {
  if (s.sigma !== null) return s.sigma;
  if (s.ci95 && s.ci95[1] > s.ci95[0]) return (s.ci95[1] - s.ci95[0]) / (2 * Z95);
  return null;
}

function diffMetric(id, ma, mb) {
  const a = side(ma);
  const b = side(mb);
  const out = { id, unit: a?.unit ?? b?.unit ?? null, a, b, delta: null, delta_ci95: null, significant: null, status: 'compared' };
  if (!a || !b) out.status = !a ? 'missing_a' : 'missing_b';
  else if (a.value === null || b.value === null) {
    out.status = a.value === null && b.value === null ? 'both_null' : (a.value === null ? 'a_null' : 'b_null');
  } else if (a.unit && b.unit && a.unit !== b.unit) out.status = 'unit_mismatch';
  else {
    out.delta = b.value - a.value;
    const sa = sigmaOf(a);
    const sb = sigmaOf(b);
    if (sa !== null && sb !== null) {
      const half = Z95 * Math.hypot(sa, sb);
      out.delta_ci95 = [out.delta - half, out.delta + half];
      out.significant = out.delta_ci95[0] > 0 || out.delta_ci95[1] < 0;
    }
  }
  return out;
}

export function compareShots(a, b) {
  const warnings = [];
  const notes = [];
  const ia = ident(a);
  const ib = ident(b);
  if (!present(ia.preset_id) || !present(ib.preset_id) || ia.preset_id !== ib.preset_id) {
    warnings.push(RC.PRESET_MISMATCH);
  }
  if (ia.view !== ib.view) {
    notes.push({ kind: 'view_mismatch', params: { a: ia.view, b: ib.view } });
  }
  if (ia.club_type !== ib.club_type) {
    notes.push({ kind: 'club_mismatch', params: { a: ia.club_type, b: ib.club_type } });
  }
  const metrics = {};
  for (const id of metricIds([a, b])) metrics[id] = diffMetric(id, a.metrics?.[id], b.metrics?.[id]);
  return { kind: 'shots', a: ia, b: ib, like_for_like: warnings.length === 0 && notes.length === 0, warnings, notes, metrics };
}

// ------------------------------------------------------------------------------------- set vs set

function summarize(shots, id) {
  const values = [];
  let nNull = 0;
  let unit = null;
  for (const s of shots) {
    const m = s.metrics?.[id];
    if (m === null || typeof m !== 'object') continue;
    if (unit === null && m.unit) unit = m.unit;
    if (finite(m.value)) values.push(m.value);
    else nNull++;
  }
  const n = values.length;
  return {
    unit,
    n,
    n_null: nNull,
    mean: n ? mean(values) : null,
    sd: n >= 2 ? nanToNull(std(values)) : null,
    median: n ? median(values) : null,
  };
}

function diffSets(id, sa, sb) {
  const out = {
    id,
    unit: sa.unit ?? sb.unit,
    a: { n: sa.n, n_null: sa.n_null, mean: sa.mean, sd: sa.sd, median: sa.median },
    b: { n: sb.n, n_null: sb.n_null, mean: sb.mean, sd: sb.sd, median: sb.median },
    delta: null,
    delta_ci95: null,
    significant: null,
    status: 'compared',
  };
  if (sa.n === 0 || sb.n === 0) out.status = sa.n === 0 && sb.n === 0 ? 'both_empty' : (sa.n === 0 ? 'a_empty' : 'b_empty');
  else if (sa.unit && sb.unit && sa.unit !== sb.unit) out.status = 'unit_mismatch';
  else {
    out.delta = sb.mean - sa.mean;
    if (sa.n >= 2 && sb.n >= 2) {
      const va = sa.sd ** 2 / sa.n;
      const vb = sb.sd ** 2 / sb.n;
      const se = Math.sqrt(va + vb);
      if (se === 0) {
        out.delta_ci95 = [out.delta, out.delta];
        out.significant = out.delta !== 0;
      } else {
        const df = (va + vb) ** 2 / (va ** 2 / (sa.n - 1) + vb ** 2 / (sb.n - 1));
        const half = tCritical95(df) * se;
        out.delta_ci95 = [out.delta - half, out.delta + half];
        out.significant = out.delta_ci95[0] > 0 || out.delta_ci95[1] < 0;
      }
    }
  }
  return out;
}

const distinct = (list, pick) => [...new Set(list.map(pick))];

function describeSet(list) {
  return {
    n: list.length,
    preset_ids: distinct(list, (s) => s.preset_id ?? null),
    views: distinct(list, (s) => s.capture?.view ?? null),
    club_types: distinct(list, (s) => s.club?.type ?? null),
    lm: distinct(list, (s) => s.algorithms?.lm?.version ?? 'none'),
  };
}

export function compareSets(listA, listB) {
  const warnings = [];
  const notes = [];
  const da = describeSet(listA);
  const db = describeSet(listB);
  if (da.n === 0 || db.n === 0) {
    notes.push({ kind: 'empty_set', params: { side: da.n === 0 ? 'A' : 'B' } });
  } else {
    const same = da.preset_ids.length === 1 && db.preset_ids.length === 1 &&
      present(da.preset_ids[0]) && da.preset_ids[0] === db.preset_ids[0];
    if (!same) warnings.push(RC.PRESET_MISMATCH);
    if (da.preset_ids.length > 1 || db.preset_ids.length > 1) {
      notes.push({ kind: 'mixed_presets', params: {} });
    }
    if (da.views.length > 1 || db.views.length > 1) {
      notes.push({ kind: 'mixed_views', params: {} });
    } else if (da.views[0] !== db.views[0]) {
      notes.push({ kind: 'view_mismatch', params: { a: da.views[0], b: db.views[0] } });
    }
    if (da.club_types.length > 1 || db.club_types.length > 1) {
      notes.push({ kind: 'mixed_clubs', params: {} });
    } else if (da.club_types[0] !== db.club_types[0]) {
      notes.push({ kind: 'club_mismatch', params: { a: da.club_types[0], b: db.club_types[0] } });
    }
    if (new Set([...da.lm, ...db.lm]).size > 1) notes.push({ kind: 'model_mismatch', params: {} });
  }
  const metrics = {};
  if (da.n > 0 && db.n > 0) {
    for (const id of metricIds([...listA, ...listB])) metrics[id] = diffSets(id, summarize(listA, id), summarize(listB, id));
    if (Object.values(metrics).some((m) => m.status === 'compared' && m.delta_ci95 === null)) {
      notes.push({ kind: 'small_sample', params: { min: 2 } });
    }
  }
  return { kind: 'sets', a: da, b: db, like_for_like: warnings.length === 0 && notes.length === 0, warnings, notes, metrics };
}

// ------------------------------------------------------------------------------------- plain-language diff

/**
 * The compared metrics as a list for a plain-language summary (PRODUCT-SPEC §2.3 History › Compare), most notable
 * first: [{ id, unit, delta, direction: 'higher' | 'lower' | 'same', significant: true | false | null }].
 * Significant differences come first (largest |delta| / half-width), then the rest in metric-id order. Codes only;
 * the UI words it ("tempo ratio 0.3 higher, beyond the usual spread").
 */
export function diffSummary(result) {
  const rows = [];
  let order = 0;
  for (const m of Object.values(result?.metrics ?? {})) {
    order++;
    if (m.status !== 'compared' || !finite(m.delta)) continue;
    const half = m.delta_ci95 ? (m.delta_ci95[1] - m.delta_ci95[0]) / 2 : null;
    rows.push({
      id: m.id, unit: m.unit, delta: m.delta,
      direction: m.delta > 0 ? 'higher' : (m.delta < 0 ? 'lower' : 'same'),
      significant: m.significant,
      score: m.significant && half > 0 ? Math.abs(m.delta) / half : 0,
      order,
    });
  }
  rows.sort((x, y) => (Number(Boolean(y.significant)) - Number(Boolean(x.significant))) || (y.score - x.score) || (x.order - y.order));
  return rows.map(({ score, order: o, ...r }) => r);
}
