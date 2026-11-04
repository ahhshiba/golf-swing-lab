// store/compare.js — compare two shots, or two sets of shots, metric by metric (P7, KD6). Pure.
//
// Convention: every difference is B minus A. Results:
//   compareShots(a, b) -> { kind: 'shots', a, b, like_for_like, warnings, notes, metrics }
//   compareSets(listA, listB) -> { kind: 'sets', a, b, like_for_like, warnings, notes, metrics }
//   warnings: reason codes (RC.*). RC.PRESET_MISMATCH is ALWAYS present when the presets differ, and also when a
//     preset id is missing on either side (a missing id cannot prove the same setup). For sets it is present unless
//     both sets consist of exactly one and the same preset.
//   notes: [{ kind: 'view_mismatch' | 'club_mismatch' | 'mixed_views' | 'mixed_clubs' | 'mixed_presets' | 'empty_set'
//             | 'small_sample', text }] with a Traditional Chinese text for the user.
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

const VIEW_LABEL = { face_on: '正面', dtl: '後方（DTL）', high_behind: '高斜角後方' };
const viewLabel = (v) => VIEW_LABEL[v] ?? String(v ?? '未知');
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
    notes.push({ kind: 'view_mismatch', text: `兩球的拍攝角度不同（${viewLabel(ia.view)} 對 ${viewLabel(ib.view)}），每個角度能量到的指標不一樣` });
  }
  if (ia.club_type !== ib.club_type) {
    notes.push({ kind: 'club_mismatch', text: `兩球用的球桿不同（${ia.club_type ?? '未知'} 對 ${ib.club_type ?? '未知'}），球速、距離不能直接比` });
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
  };
}

export function compareSets(listA, listB) {
  const warnings = [];
  const notes = [];
  const da = describeSet(listA);
  const db = describeSet(listB);
  if (da.n === 0 || db.n === 0) {
    notes.push({ kind: 'empty_set', text: `${da.n === 0 ? 'A' : 'B'} 組沒有任何球，沒有東西可比` });
  } else {
    const same = da.preset_ids.length === 1 && db.preset_ids.length === 1 &&
      present(da.preset_ids[0]) && da.preset_ids[0] === db.preset_ids[0];
    if (!same) warnings.push(RC.PRESET_MISMATCH);
    if (da.preset_ids.length > 1 || db.preset_ids.length > 1) {
      notes.push({ kind: 'mixed_presets', text: '同一組球來自不同的機位預設，組內的數字本身就混了不同架設' });
    }
    if (da.views.length > 1 || db.views.length > 1) {
      notes.push({ kind: 'mixed_views', text: '同一組球混了不同的拍攝角度，平均值沒有意義' });
    } else if (da.views[0] !== db.views[0]) {
      notes.push({ kind: 'view_mismatch', text: `兩組的拍攝角度不同（${viewLabel(da.views[0])} 對 ${viewLabel(db.views[0])}），每個角度能量到的指標不一樣` });
    }
    if (da.club_types.length > 1 || db.club_types.length > 1) {
      notes.push({ kind: 'mixed_clubs', text: '同一組球混了不同的球桿，平均值沒有意義' });
    } else if (da.club_types[0] !== db.club_types[0]) {
      notes.push({ kind: 'club_mismatch', text: `兩組用的球桿不同（${da.club_types[0] ?? '未知'} 對 ${db.club_types[0] ?? '未知'}），球速、距離不能直接比` });
    }
  }
  const metrics = {};
  if (da.n > 0 && db.n > 0) {
    for (const id of metricIds([...listA, ...listB])) metrics[id] = diffSets(id, summarize(listA, id), summarize(listB, id));
    if (Object.values(metrics).some((m) => m.status === 'compared' && m.delta_ci95 === null)) {
      notes.push({ kind: 'small_sample', text: '有些指標某一組少於 2 球，只能看差多少，沒辦法判斷差異是不是運氣' });
    }
  }
  return { kind: 'sets', a: da, b: db, like_for_like: warnings.length === 0 && notes.length === 0, warnings, notes, metrics };
}
