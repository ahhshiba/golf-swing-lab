// lab/params.js — every swing-lab tunable (V04-SPEC §E.3), frozen, with `version` (written to golf-lab/1
// algo.version; algo.sha256 = SHA-256 of the canonical JSON of this object, lab/faults.js labAlgorithm). Change a number
// here -> bump `version`: repo.lab.deleteStale(version) then drops every stored record and the lab recomputes them.
// Lazy, pure. Owner V4-F.
//
// ALL THRESHOLDS ARE UNVERIFIED teaching rules of thumb (§E.3), not fitted to any data and not personalised.
//
// Per fault: views = { <view>: minimum nominal fps } — the only views (and frame rates) that can observe it; any other
// view gives `unknown` + viewCode[view], a lower frame rate `unknown` + FPS_TOO_LOW. source = the shot metric it reads
// ('metric:<id>') or the lab measurement computed from the pose ('lab:<name>'), per view when they differ.
// op '>' / '<' : one threshold; 'outside' : a band [lo, hi] (a fault outside it).
// neutral = the point the threshold is measured from: `relaxed` widens |threshold − neutral| by relaxedFactor, so the
// relaxed setting is always more lenient (0 for most rules; tempo 3.0; weight shift 100 %).
// event = the phase whose frame the fault is marked at (null = the whole swing).
// sysSigma = { view: m } an extra 1σ for a systematic error of the metric the rule reads, combined (root-sum-square)
//   into the judgement interval (not removed: the offset is only known on synthetic swings). On the synthetic golfer
//   (tests/unit/lab.rates.test.mjs, 100 unconstrained swings per view) early_extension_m reads +0.9 cm high and the
//   dtl head_lift_z_m −1.2 cm low with the metric's own sigma ≈ 1.0 cm, so its 95 % interval covered the truth on only
//   86 % of dtl swings; with sysSigma the test requires ≥ 93 % coverage for every rule.
// disabled = a reason code: the rule is not judged at all (unknown + that code) because no available signal measures it.
//
// Synthetic acceptance (tests/unit/lab.rates.test.mjs, 50 clean + 50 injected swings per rule, standard sensitivity;
// targets: found ≥ 90 %, clean false 'fault' ≤ 5 %, clean false 'possible' ≤ 15 %) — the measured rates are printed
// by that test and listed in docs/research/lab-rates.md.

import { RC } from '../contract/reason-codes.js';

const f = (o) => Object.freeze(o);
const DEPTH = RC.VIEW_DEPTH_AXIS;
const PLANE = RC.VIEW_PLANE_MISMATCH;

export const LAB_PARAMS = f({
  version: 'lab-1.2.0',
  relaxedFactor: 1.5,
  /** Lab measurements read the pose at this registry level of the pose-sigma model (metrics/common.js POSE_SIGMA). */
  sigmaLevel: 'valid',
  /** Window-averaged hands at mid-back / mid-downswing are moving fast: the frame spread is motion, not noise; this
   * 1σ (m) replaces it for hand_path_transition (lab-1.1.0 used the spread and judged every injection "possible"). */
  handMotionSigma: 0.015,
  faults: f({
    early_extension: f({ views: f({ dtl: 30 }), viewCode: f({ face_on: DEPTH, high_behind: DEPTH }),
      source: 'metric:early_extension_m', op: '>', threshold: 0.05, neutral: 0, unit: 'm', event: 'impact', sysSigma: f({ dtl: 0.010 }) }),
    loss_of_posture: f({ views: f({ dtl: 30 }), viewCode: f({ face_on: PLANE, high_behind: PLANE }),
      source: 'lab:forward_tilt_change', op: '<', threshold: -8, neutral: 0, unit: 'deg', event: 'impact' }),
    // dtl: the hands at mid-downswing (lead arm parallel, ~P6) vs the hands at mid-backswing (~P3), both as distances
    // from the address hand plane: + = the downswing comes in above / outside the backswing path. Rising above the
    // address plane itself is normal (lab-1.0.0 measured that and flagged almost every swing).
    over_the_top: f({ views: f({ dtl: 30, high_behind: 240 }), viewCode: f({ face_on: PLANE }),
      source: f({ dtl: 'lab:hand_path_transition', high_behind: 'metric:club_path_deg' }),
      op: f({ dtl: '>', high_behind: '<' }), threshold: f({ dtl: 0.05, high_behind: -4 }), neutral: 0,
      unit: f({ dtl: 'm', high_behind: 'deg' }), event: f({ dtl: 'mid_downswing', high_behind: 'impact' }) }),
    sway: f({ views: f({ face_on: 30 }), viewCode: f({ dtl: DEPTH, high_behind: DEPTH }),
      source: 'lab:pelvis_sway_top', op: '>', threshold: 0.06, neutral: 0, unit: 'm', event: 'top' }),
    slide: f({ views: f({ face_on: 30 }), viewCode: f({ dtl: DEPTH, high_behind: DEPTH }),
      source: 'lab:pelvis_past_lead_ankle', op: '>', threshold: 0.03, neutral: 0, unit: 'm', event: 'impact' }),
    reverse_spine: f({ views: f({ face_on: 30 }), viewCode: f({ dtl: PLANE, high_behind: PLANE }),
      source: 'lab:side_tilt_top', op: '<', threshold: -5, neutral: 0, unit: 'deg', event: 'top' }),
    head_dip: f({ views: f({ face_on: 30, dtl: 30 }), viewCode: f({ high_behind: DEPTH }),
      source: 'metric:head_lift_z_m', op: '<', threshold: -0.05, neutral: 0, unit: 'm', event: 'impact', sysSigma: f({ face_on: 0.007, dtl: 0.013 }) }),
    early_rise: f({ views: f({ face_on: 30, dtl: 30 }), viewCode: f({ high_behind: DEPTH }),
      source: 'metric:head_lift_z_m', op: '>', threshold: 0.06, neutral: 0, unit: 'm', event: 'impact', sysSigma: f({ face_on: 0.007, dtl: 0.013 }) }),
    // weight_shift_pct is the PELVIS position (not foot pressure): 100 · pelvis Δx (impact − address) / stance width.
    // A normal swing moves the pelvis ~5–35 % of the stance toward the target by impact; `slide` starts past the lead
    // ankle (≈ 50 % + 3 cm). "Weight stays back" = the pelvis has not moved toward the target at all (< 0 %).
    // lab-1.0.0 used < 50 %, which flagged every normal swing.
    weight_back: f({ views: f({ face_on: 30 }), viewCode: f({ dtl: DEPTH, high_behind: DEPTH }),
      source: 'metric:weight_shift_pct', op: '<', threshold: 0, neutral: 25, unit: '%', event: 'impact' }),
    // DISABLED (unknown + NOT_IMPLEMENTED): "past parallel at the top" needs the shaft's vertical angle at the top;
    // no stored signal has it (top_shaft_angle_deg is the across-the-line angle in the horizontal plane, and the app
    // keeps no club-head track near the top). Judging overswing from it would be a guess.
    overswing: f({ views: f({ dtl: 120 }), viewCode: f({ face_on: PLANE, high_behind: PLANE }), disabled: RC.NOT_IMPLEMENTED,
      source: 'metric:top_shaft_angle_deg', op: '>', threshold: 10, neutral: 0, unit: 'deg', event: 'top' }),
    tempo_off: f({ views: f({ face_on: 30, dtl: 30, high_behind: 30 }), viewCode: f({}),
      source: 'metric:tempo_ratio', op: 'outside', threshold: f([2.4, 3.6]), neutral: 3, unit: '', event: null }),
  }),
});

/** Fault ids in table order (§E.3). */
export const FAULT_IDS = Object.freeze(Object.keys(LAB_PARAMS.faults));

/** A per-view field of a rule (rules write either one value or { [view]: value }). */
export function perView(v, view) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v[view] ?? null) : v;
}

/**
 * The rule of `id` resolved for one view and sensitivity:
 * { id, view, allowed, minFps, viewCode, source, kind: 'metric'|'lab', key, op, threshold (number | [lo, hi]), unit, event }.
 */
export function ruleFor(id, view, sensitivity = 'standard') {
  const r = LAB_PARAMS.faults[id];
  if (!r) throw new RangeError(`unknown fault '${id}'`);
  const minFps = r.views[view] ?? null;
  const source = perView(r.source, view) ?? perView(r.source, Object.keys(r.views)[0]);
  const [kind, key] = source.split(':');
  const k = sensitivity === 'relaxed' ? LAB_PARAMS.relaxedFactor : 1;
  const scale = (x) => r.neutral + (x - r.neutral) * k;
  const raw = perView(r.threshold, view) ?? perView(r.threshold, Object.keys(r.views)[0]);
  const threshold = Array.isArray(raw) ? [scale(raw[0]), scale(raw[1])] : scale(raw);
  return {
    id, view, allowed: minFps !== null, minFps, disabled: r.disabled ?? null, viewCode: r.viewCode[view] ?? null, source, kind, key,
    op: perView(r.op, view) ?? perView(r.op, Object.keys(r.views)[0]), threshold,
    unit: perView(r.unit, view) ?? perView(r.unit, Object.keys(r.views)[0]) ?? '',
    event: minFps === null ? null : perView(r.event, view),
    sysSigma: perView(r.sysSigma ?? null, view) ?? 0,
  };
}
