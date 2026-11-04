// Setup timer for steps C0–C10 (CAFCR C3, KD3: ≤ 5:00 per angle at P90 with n ≥ 10; new venue ≤ 10:00).
// Pure: times are passed in (seconds on any monotonic clock); no clock is read here.

import { percentile } from '../geom/stats.js';

export const SETUP_STEPS = Object.freeze(['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10']);
/** CAFCR C3 estimated seconds per step (C3 is inside C4, C6 automatic; C5 30–45 s → 37.5). */
export const STEP_ESTIMATE_S = Object.freeze({ C0: 45, C1: 30, C2: 20, C3: 0, C4: 75, C5: 37.5, C6: 0, C7: 15, C8: 10, C9: 5, C10: 70 });
/** KD3 / M2b limits (seconds). */
export const SETUP_LIMITS = Object.freeze({ per_angle_p90_s: 300, new_venue_s: 600, min_n: 10 });

/**
 * Timer with closure state. record('start', t) once, then record(step, t) when `step` is finished; a step's
 * duration is the time since the previous record (repeated steps accumulate). Returns
 * { record(step, t_s), summary(), events() }.
 */
export function createSetupTimer() {
  const ev = [];
  return {
    record(step, t_s) {
      if (step !== 'start' && !SETUP_STEPS.includes(step)) throw new RangeError(`timer: unknown step '${step}'`);
      if (!Number.isFinite(t_s)) throw new TypeError('timer: t_s must be finite');
      if (ev.length && t_s < ev[ev.length - 1].t_s) throw new RangeError('timer: time went backwards');
      ev.push({ step, t_s });
    },
    events() { return ev.map((e) => ({ ...e })); },
    summary() { return summarizeSetup(ev); },
  };
}

/**
 * Summary of recorded events: { steps: { C0: s, … } (only recorded ones), total_s, mode: 'live'|'highspeed'
 * (C10 recorded → highspeed), within_budget (total ≤ 300 s), estimate_s (CAFCR sum for the mode) }.
 */
export function summarizeSetup(events) {
  const steps = {};
  let total = 0;
  for (let i = 1; i < events.length; i++) {
    const d = events[i].t_s - events[i - 1].t_s;
    steps[events[i].step] = (steps[events[i].step] ?? 0) + d;
    total += d;
  }
  const highspeed = events.some((e) => e.step === 'C10');
  const est = SETUP_STEPS.filter((s) => (highspeed ? s !== 'C5' : s !== 'C10')).reduce((a, s) => a + STEP_ESTIMATE_S[s], 0);
  return { steps, total_s: total, mode: highspeed ? 'highspeed' : 'live', within_budget: total <= SETUP_LIMITS.per_angle_p90_s, estimate_s: est };
}

/** 90th percentile (linear interpolation) of setup totals. */
export function p90(values) {
  return percentile(values, 90);
}

/** M2b timing gate: { n, p90_s, pass, reason } — pass when n ≥ min_n and P90 ≤ limit_s. */
export function setupTimeGate(totals, { limit_s = SETUP_LIMITS.per_angle_p90_s, min_n = SETUP_LIMITS.min_n } = {}) {
  const xs = totals.filter(Number.isFinite);
  const p = xs.length ? p90(xs) : NaN;
  if (xs.length < min_n) return { n: xs.length, p90_s: p, pass: false, reason: `need n ≥ ${min_n}` };
  return { n: xs.length, p90_s: p, pass: p <= limit_s, reason: p <= limit_s ? 'ok' : `P90 ${p.toFixed(0)} s > ${limit_s} s` };
}
