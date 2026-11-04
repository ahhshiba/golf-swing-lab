// Shared metric helpers: the pose-model error assumptions (CAFCR C1.1), validity combination, the tempo metrics of
// F2 row 1 with the ±0.5-frame quantisation interval, and event lookups. Pure.

import { RC } from '../contract/reason-codes.js';
import { metricValue, metricNull } from '../contract/metric.js';
import { REGISTRY } from './registry.js';

import { EVENT_CONF_MIN } from '../events/rules.js';

/** Consumers treat an event with conf below this as uncertain (events/rules.js). */
export { EVENT_CONF_MIN };

/**
 * Pose-model error assumptions (CAFCR C1.1 "姿勢模型": angles ±3–6°, displacements ±2–5%, assumed). Mapped onto
 * the registry validity: valid -> lower end, estimated -> middle, low_confidence -> upper end. disp_abs_m is the
 * landmark-placement floor of a window-averaged position difference (UNVERIFIED, M3 owner footage).
 */
export const POSE_SIGMA = Object.freeze({
  angle_deg: Object.freeze({ valid: 3, estimated: 4.5, low_confidence: 6 }),
  disp_rel: Object.freeze({ valid: 0.02, estimated: 0.035, low_confidence: 0.05 }),
  disp_abs_m: Object.freeze({ valid: 0.01, estimated: 0.015, low_confidence: 0.025 }),
});

const RANK = { valid: 0, estimated: 1, low_confidence: 2 };
const BY_RANK = ['valid', 'estimated', 'low_confidence'];

/** The weaker of two value validities. */
export function worseValidity(a, b) {
  return BY_RANK[Math.max(RANK[a] ?? 0, RANK[b] ?? 0)];
}

/** Root-sum-square of finite terms. */
export function rss(...xs) {
  let s = 0;
  for (const x of xs) if (Number.isFinite(x)) s += x * x;
  return Math.sqrt(s);
}

/**
 * Build a Metric with a number. r = { value, sigma, ci95?, validity, codes?, origin? }; ci95 defaults to
 * value ± 1.96 sigma.
 */
export function valueMetric(id, r) {
  const reg = REGISTRY[id];
  const sigma = r.sigma ?? null;
  const ci95 = r.ci95 ?? (sigma !== null ? [r.value - 1.96 * sigma, r.value + 1.96 * sigma] : null);
  return metricValue({
    value: r.value, unit: reg.unit, ci95, sigma, validity: r.validity, value_origin: r.origin ?? reg.value_origin,
    reason_codes: r.codes ?? [],
  });
}

/** Build an honest null for a registry id. */
export function nullMetric(id, validity, codes, origin) {
  const reg = REGISTRY[id];
  return metricNull(validity, codes, reg.unit, origin ?? reg.value_origin);
}

/** Event { frame, t_s, conf } or null when missing. */
export function eventOf(events, name) {
  const e = events?.[name];
  if (!e || e.t_s === null || e.t_s === undefined || !Number.isFinite(e.t_s)) return null;
  return { frame: e.frame, t_s: e.t_s, conf: Number.isFinite(e.conf) ? e.conf : 1, source: e.source };
}

/** Quantisation half-width (s) of one event time: ±0.5 frame, widened by 1/conf for detected events (conf >= 0.25). */
export function eventHalfWidth(fps, conf = 1) {
  return 0.5 / fps / Math.max(Math.min(conf, 1), 0.25);
}

/**
 * Tempo interval from ±half-width per event (address, top, impact), the top error shared by both phases:
 * backswing [B − ha − ht, B + ha + ht], downswing [D − ht − hi, D + ht + hi],
 * ratio [(B − ha − ht)/(D + ht + hi), (B + ha + ht)/(D − ht − hi)].
 * With conf = 1 this is the F2 note (tempo 3.0: 30 fps 2.56–3.57, 60 fps 2.77–3.27, 240 fps 2.94–3.06).
 */
export function tempoInterval(B, D, fps, conf = {}) {
  const ha = eventHalfWidth(fps, conf.address ?? 1);
  const ht = eventHalfWidth(fps, conf.top ?? 1);
  const hi = eventHalfWidth(fps, conf.impact ?? 1);
  const dLo = D - ht - hi;
  return {
    backswing: [B - ha - ht, B + ha + ht],
    downswing: [D - ht - hi, D + ht + hi],
    ratio: [(B - ha - ht) / (D + ht + hi), dLo > 0 ? (B + ha + ht) / dLo : Infinity],
  };
}

/** Plausible ranges (s) used by tempo: outside HARD -> implausible null; outside SOFT -> TIMEBASE_SUSPECT. */
export const TEMPO_LIMITS = Object.freeze({
  backswing_hard: [0.3, 3.0], downswing_hard: [0.08, 1.2], downswing_soft: [0.15, 0.6],
});

/** F2 row 1: backswing_s, downswing_s, tempo_ratio from address / top / impact. */
export function tempoMetrics(events, fps, cells) {
  const a = eventOf(events, 'address');
  const t = eventOf(events, 'top');
  const i = eventOf(events, 'impact');
  const ids = ['backswing_s', 'downswing_s', 'tempo_ratio'];
  if (!a || !t || !i) {
    return Object.fromEntries(ids.map((id) => [id, nullMetric(id, 'not_computed', [RC.EVENTS_UNCERTAIN])]));
  }
  const B = t.t_s - a.t_s;
  const D = i.t_s - t.t_s;
  const out = {};
  const hard = !(B >= TEMPO_LIMITS.backswing_hard[0] && B <= TEMPO_LIMITS.backswing_hard[1] &&
    D >= TEMPO_LIMITS.downswing_hard[0] && D <= TEMPO_LIMITS.downswing_hard[1]);
  const iv = tempoInterval(B, D, fps, { address: a.conf, top: t.conf, impact: i.conf });
  if (hard || !Number.isFinite(iv.ratio[1])) {
    for (const id of ids) out[id] = nullMetric(id, 'implausible', [RC.IMPLAUSIBLE_VALUE, RC.TIMEBASE_SUSPECT]);
    return out;
  }
  const codes = [];
  let cap = 'valid';
  if (Math.min(a.conf, t.conf, i.conf) < EVENT_CONF_MIN) { codes.push(RC.EVENTS_UNCERTAIN); cap = 'low_confidence'; }
  if (D < TEMPO_LIMITS.downswing_soft[0] || D > TEMPO_LIMITS.downswing_soft[1]) {
    codes.push(RC.TIMEBASE_SUSPECT);
    cap = 'low_confidence';
  }
  const vals = { backswing_s: [B, iv.backswing], downswing_s: [D, iv.downswing], tempo_ratio: [B / D, iv.ratio] };
  for (const id of ids) {
    const [value, ci95] = vals[id];
    out[id] = valueMetric(id, {
      value, ci95, sigma: null, validity: worseValidity(cells[id], cap), codes,
      origin: id === 'tempo_ratio' ? 'derived' : 'pose',
    });
  }
  return out;
}
