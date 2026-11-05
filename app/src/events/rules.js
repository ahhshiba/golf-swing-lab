// Rule-based swing event detection: the baseline a trained TCN must beat before it ships (CAFCR K9).
// Works on the canonical (right-handed) image landmarks resampled to a uniform grid (events/features.js),
// so it is the same for every view and both handednesses. Definitions and thresholds: docs/metrics-by-view.md,
// "Rule-based events". Pure: no DOM, no clock, no randomness.

import { EVENTS } from '../contract/enums.js';
import { CONF_CALIB } from './calib-conf.js';
import { computeFeatures, featureColumn, gradient } from './features.js';
import {
  movingAverage, oddWindow, parabolicOffset, firstCrossing, nearestIndex, wrapPi, estimateFps,
} from './signal.js';

export { EVENTS };

/** Consumers treat an event with conf below this as uncertain (RC.EVENTS_UNCERTAIN). */
export const EVENT_CONF_MIN = 0.5;

export const RULES = Object.freeze({
  smooth_s: 0.1, // centred moving average applied to positions before differentiating
  swing_min_speed: 3.0, // torso lengths / s; slower clips have no swing (~1.5 m/s for a 0.5 m torso)
  descend_speed: 1.0, // torso lengths / s of wrist descent that marks the downswing
  still_speed: 0.3, // torso lengths / s (~0.15 m/s, P4 ADDRESS threshold)
  still_min_s: 0.3, // shortest still run accepted as the address hold
  onset_hi: 0.1, // onset / stop fit window ends where the RMS landmark displacement reaches this (torso lengths)
  onset_max_s: 0.3, // ... or this long after the still run, whichever comes first
  impact_window_s: 0.8, // impact searched in (top, top + this]
  audio_min_after_top_s: 0.08,
  finish_still_s: 0.25, // still for at least this long after impact (PRODUCT-SPEC §7.2 EV-2; P4 live keeps its own 0.7 s)
  finish_min_after_impact_s: 0.15,
  forearm_turn_deg: 45, // toe_up proxy (face_on): lead forearm turned this far from its address direction
  toe_up_frac: 0.62, // fallback position of toe_up between address and mid_backswing
  mid_ft_frac: 0.1, // fallback position of mid_follow_through between impact and finish
  max_backswing_s: 2.5,
  apex_half_s: 0.2, // half-width of the top (apex) fit window
  // takeaway onset model c + A·τ^p per view: down the line and from behind the first hand motion points along the
  // camera axis, so its image displacement starts later than quadratic (fitted on synthetic-v2; §7.2 EV-1 / EV-5)
  onset_power: Object.freeze({ face_on: 2, dtl: 2.2, high_behind: 2.4 }),
  // pre-motion (forward press, slow drift): the still-run onset lies more than this before the takeaway crossing
  // (the run of wrist speed >= 0.6 × the still -> swing midpoint; a takeaway from rest reaches it within ~0.35 s)
  premotion_gap_s: 0.36,
  premotion_ref_s: Object.freeze([0.55, 0.2]), // reference window of the refit, seconds before the crossing
  premotion_hi: 0.15, // refit window ends at this RMS displacement (torso lengths)
});

/** A landmark sample counts as seen at this visibility; a dim clip lowers it (visThreshold). */
const VIS_DEFAULT = 0.5;
const MOTION_SET_BODY = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26];
// the finish also sees the head turning and the trail heel coming up (canonical right-handed labels: trail = 28/30/32)
const FINISH_SET = [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 28, 30, 32];

function emptyEventSet(source) {
  const out = {};
  for (const e of EVENTS) out[e] = { frame: null, t_s: null, conf: 0, source };
  return out;
}

/** Grid rate used by the rules: the native frame rate clamped to [30, 60] Hz. */
export function ruleHz(poseSeq) {
  const f = estimateFps(poseSeq.t_s);
  if (!Number.isFinite(f)) return 30;
  return Math.min(60, Math.max(30, Math.round(f)));
}

/**
 * detectEvents(poseSeq, { view, audioOnset_t?, handedness = 'right', hz? }) -> EventSet
 * EventSet = { [event]: { frame, t_s, conf, source: 'rules' } } for all 8 swing events: t_s = the sub-frame
 * event time (media seconds), frame = the nearest index of poseSeq.t_s; both non-decreasing in EVENTS order.
 * When no swing is found every event has frame = t_s = null and conf = 0 (not a valid shot EventSet: callers
 * must not build a shot from it). Attaches a non-enumerable `diag` object with the intermediate times.
 */
export function detectEvents(poseSeq, opts = {}) {
  const view = opts.view ?? 'face_on';
  const hz = opts.hz ?? ruleHz(poseSeq);
  const feat = computeFeatures(poseSeq, { handedness: opts.handedness ?? 'right', hz });
  const { K, t_s: t, px } = feat;
  const L = feat.torso_px;
  const dt = 1 / hz;
  const out = emptyEventSet('rules');
  if (K < 5) return out;
  const C = 33 * 4;

  const wx = featureColumn(feat, 'wrist_x');
  const wy = featureColumn(feat, 'wrist_y');
  const win = oddWindow(RULES.smooth_s, hz);
  const wxs = movingAverage(wx, win);
  const wys = movingAverage(wy, win);
  const vx = gradient(wxs, hz);
  const vy = gradient(wys, hz);
  const speed = new Float64Array(K);
  for (let k = 0; k < K; k++) speed[k] = Math.hypot(vx[k], vy[k]);
  const visW = featureColumn(feat, 'vis_mean');
  const vt = visThreshold(px, C, MOTION_SET_BODY, K);

  // 1. the downswing: fastest wrist sample
  let kPk = 0;
  for (let k = 1; k < K; k++) if (speed[k] > speed[kPk]) kPk = k;
  if (!(speed[kPk] >= RULES.swing_min_speed)) return out;

  // 2. top: last rising -> falling zero crossing of the smoothed wrist height velocity before the downswing
  let k = kPk;
  const kLimit = Math.max(0, kPk - Math.round(RULES.max_backswing_s * hz));
  while (k > kLimit && vy[k] > -RULES.descend_speed) k--;
  while (k > kLimit && vy[k] < 0) k--;
  let tTop;
  let confTop = 0.85;
  if (k > kLimit && vy[k] >= 0 && k + 1 < K) {
    tTop = t[k] + (dt * vy[k]) / (vy[k] - vy[k + 1]);
  } else {
    let km = kLimit;
    for (let i = kLimit; i <= kPk; i++) if (wys[i] > wys[km]) km = i;
    tTop = t[km];
    confTop = 0.4;
  }
  if (confTop > 0.5) {
    const ap = fitApex(t, [wx, wy], tTop, RULES.apex_half_s, dt);
    if (ap !== null) tTop = ap;
  }
  const kTop = Math.min(K - 1, Math.max(0, Math.round((tTop - t[0]) * hz)));

  // 3. impact: audio onset inside the swing window, else the lowest wrist point after the top
  let tImp = null;
  let confImp = 0;
  let impactSource = 'wrist_low';
  const winEnd = tTop + RULES.impact_window_s;
  const a = opts.audioOnset_t;
  if (typeof a === 'number' && Number.isFinite(a) && a >= tTop + RULES.audio_min_after_top_s && a <= winEnd) {
    tImp = a;
    confImp = 0.95;
    impactSource = 'audio';
  } else {
    const k1 = Math.min(K - 1, Math.floor((winEnd - t[0]) * hz));
    let km = kTop;
    for (let i = kTop; i <= k1; i++) if (wy[i] < wy[km]) km = i;
    const off = km > 0 && km < K - 1 ? parabolicOffset(wy[km - 1], wy[km], wy[km + 1]) : 0;
    tImp = t[km] + off * dt;
    confImp = km > kTop && km < k1 ? 0.75 : 0.35;
  }
  const kImp = Math.min(K - 1, Math.max(0, Math.round((tImp - t[0]) * hz)));

  // 4. address: end of the still run before the takeaway (whole-body stillness), then the motion onset from a
  //    start-from-rest fit of the visible landmark paths (onsetTime)
  const body = bodySpeed(px, C, MOTION_SET_BODY, K, hz, vt);
  let kB = kTop;
  const kB0 = Math.max(0, kTop - Math.round(RULES.max_backswing_s * hz));
  for (let i = kB0; i <= kTop; i++) if (speed[i] > speed[kB]) kB = i;
  let kS = kB;
  while (kS > 0 && body[kS] >= RULES.still_speed) kS--;
  let kS0 = kS;
  const kMin0 = Math.max(0, kS - Math.round(1.5 * hz));
  while (kS0 > kMin0 && body[kS0 - 1] < RULES.still_speed) kS0--;
  const stillLen = (kS - kS0) * dt;
  const vis = visibleSet(px, C, MOTION_SET_BODY, kS0, kS + Math.round(0.3 * hz), K, vt);
  const kRefA = Math.max(kS0, kS - Math.round(0.15 * hz));
  const onAr = onsetFit(t, px, C, vis, kS0, kRefA, kTop, +1, L, dt, { power: RULES.onset_power[view] ?? 2, vt });
  const onA = onAr ? onAr.t0 : null;
  let addrRms = onAr ? onAr.rms : 1;
  let tAddr;
  let confAddr = stillLen >= RULES.still_min_s ? 0.85 : 0.45;
  if (onA !== null) tAddr = Math.max(t[kS0], onA);
  else { tAddr = t[kS]; confAddr = 0.35; }
  // takeaway onset: start of the sustained run of wrist speed above 0.6 × the still -> swing midpoint that holds
  // the backswing peak. A still-run onset far before it means slow pre-motion (forward press, drift): refit there
  // with a pre-onset drift term.
  const vStill = medianOf(speed, kS0, kS);
  const thrX = 0.6 * 0.5 * (vStill + speed[kB]);
  let kX = kB;
  while (kX > 0 && speed[kX - 1] >= thrX) kX--;
  const tX = t[kX];
  const diagA = { tX, premotion: false, gap: tX - tAddr };
  if (tX - tAddr > RULES.premotion_gap_s) {
    const kSt = Math.max(0, kX - Math.round(RULES.premotion_ref_s[0] * hz));
    const kR = Math.max(kSt, kX - Math.round(RULES.premotion_ref_s[1] * hz));
    const visP = visibleSet(px, C, MOTION_SET_BODY, kSt, kX, K, vt);
    const r = onsetFit(t, px, C, visP, kSt, kR, kTop, +1, L, dt, { power: RULES.onset_power[view] ?? 2, vt, drift: true, back: 0.1, hi: RULES.premotion_hi });
    if (r) { tAddr = r.t0; diagA.premotion = true; confAddr = Math.min(confAddr, 0.6); addrRms = r.rms; }
  }

  // 5. finish: the first hold of at least finish_still_s starting finish_min_after_impact_s after impact (the first
  //    qualifying run, so relaxing the pose afterwards cannot move it later); the stop time is extrapolated the same
  //    way as the takeaway. A clip that ends inside the hold uses the hold start (conf 0.4).
  const need = Math.round(RULES.finish_still_s * hz);
  const kF0 = Math.min(K - 1, kImp + Math.round(RULES.finish_min_after_impact_s * hz));
  let kH0 = -1;
  let run = 0;
  for (let i = kF0; i < K; i++) {
    if (body[i] < RULES.still_speed) {
      run++;
      if (run > need) { kH0 = i - run + 1; break; }
    } else run = 0;
  }
  let tFin;
  let confFin = 0.8;
  let finKind = 0; // 1 = a hold was found, 0.5 = the clip ends inside the hold, 0 = no hold
  let finHold = 0;
  if (kH0 > 0) {
    let kH1 = kH0;
    while (kH1 < K - 1 && body[kH1 + 1] < RULES.still_speed) kH1++;
    const visF = visibleSet(px, C, FINISH_SET, kH0 - Math.round(0.3 * hz), kH1, K, vt);
    const kRefF = Math.min(kH1, kH0 + Math.round(0.15 * hz));
    const on = onsetTime(t, px, C, visF, kH1, kRefF, kImp, -1, L, dt, { vt });
    tFin = on !== null ? Math.min(t[kH1], on) : t[kH0];
    if (on === null) confFin = 0.5;
    finKind = 1;
    finHold = (kH1 - kH0) * dt;
  } else if (run > 0) {
    tFin = t[K - run];
    confFin = 0.4;
    finKind = 0.5;
    finHold = run * dt;
  } else {
    // the clip ends before any hold: the slowest body frame of the last 0.5 s (EV-2)
    let km = Math.max(kF0, K - 1 - Math.round(0.5 * hz));
    for (let i = km; i < K; i++) if (body[i] < body[km]) km = i;
    tFin = t[km];
    confFin = 0.3;
  }

  // 6. mid-backswing / mid-downswing: lead arm horizontal (lead wrist at lead shoulder height)
  const armRel = new Float64Array(K);
  for (let i = 0; i < K; i++) armRel[i] = -(px[i * C + 15 * 4 + 1] - px[i * C + 11 * 4 + 1]) / L;
  const armS = movingAverage(armRel, win);
  const kA = Math.max(0, Math.round((tAddr - t[0]) * hz));
  let tMidB = firstCrossing(t, armS, 0, +1, kA, kTop);
  let confMidB = 0.6;
  if (tMidB === null) { tMidB = tAddr + 0.55 * (tTop - tAddr); confMidB = 0.3; }
  let tMidD = firstCrossing(t, armS, 0, -1, kTop, kImp);
  let confMidD = 0.6;
  if (tMidD === null) { tMidD = tTop + 0.6 * (tImp - tTop); confMidD = 0.3; }

  // 7. toe-up: the shaft parallel to the ground. Proxy: the lead hand vector (wrist 15 -> mean of fingers 17, 19, which
  //    point along the grip) turns from pointing down to horizontal in the image (its vertical component crosses 0);
  //    used face-on and down the line when the lead hand is seen (mean visibility >= vt over address ->
  //    mid-backswing; from behind and above the image vertical is not the ground normal). Otherwise the lead
  //    forearm turn (face_on), else a fraction of address -> mid-backswing (§7.2 item 6). mid-follow-through: a
  //    fraction of impact -> finish (the forearm proxy was late on synth).
  let tToe = null;
  let tMft = null;
  let toeSource = 'fraction';
  const kMB = Math.min(K - 1, Math.round((tMidB - t[0]) * hz));
  {
    let vs = 0;
    let vn = 0;
    for (let i = kA; i <= kMB; i++) for (const j of [15, 17, 19]) { vs += px[i * C + j * 4 + 3]; vn++; }
    if (view !== 'high_behind' && vn > 0 && vs / vn >= vt) {
      const hv = new Float64Array(K);
      for (let i = 0; i < K; i++) {
        const du = (px[i * C + 17 * 4] + px[i * C + 19 * 4]) / 2 - px[i * C + 15 * 4];
        const dv = (px[i * C + 17 * 4 + 1] + px[i * C + 19 * 4 + 1]) / 2 - px[i * C + 15 * 4 + 1];
        hv[i] = dv / Math.max(1e-9, Math.hypot(du, dv));
      }
      const hvs = movingAverage(hv, win);
      if (hvs[kA] > 0.3) {
        tToe = firstCrossing(t, hvs, 0, -1, kA, kMB);
        if (tToe !== null) toeSource = 'hand';
      }
    }
  }
  if (tToe === null && view === 'face_on') {
    const ang = new Float64Array(K);
    for (let i = 0; i < K; i++) {
      const du = px[i * C + 15 * 4] - px[i * C + 13 * 4];
      const dv = px[i * C + 15 * 4 + 1] - px[i * C + 13 * 4 + 1];
      ang[i] = Math.atan2(du, dv);
    }
    const thr = (RULES.forearm_turn_deg * Math.PI) / 180;
    const d = new Float64Array(K);
    for (let i = 0; i < K; i++) d[i] = Math.abs(wrapPi(ang[i] - ang[kA]));
    tToe = firstCrossing(t, movingAverage(d, win), thr, +1, kA, kMB);
    if (tToe !== null) toeSource = 'forearm';
  }
  let confToe = 0.4;
  let confMft = 0.4;
  if (tToe === null) { tToe = tAddr + RULES.toe_up_frac * (tMidB - tAddr); confToe = 0.3; }
  if (tMft === null) { tMft = tImp + RULES.mid_ft_frac * (tFin - tImp); confMft = 0.3; }

  // 8. assemble: nearest native frame, calibrated confidence (events/calib-conf.js, §7.2 EV-4), monotone order
  const times = {
    address: [tAddr, confAddr], toe_up: [tToe, confToe], mid_backswing: [tMidB, confMidB], top: [tTop, confTop],
    mid_downswing: [tMidD, confMidD], impact: [tImp, confImp], mid_follow_through: [tMft, confMft],
    finish: [tFin, confFin],
  };
  const extra = {
    address: [Math.min(1, stillLen / 0.6), diagA.premotion ? 1 : 0, Math.min(1, 20 * addrRms)],
    toe_up: [toeSource === 'hand' ? 1 : toeSource === 'forearm' ? 0.5 : 0, 0, 0],
    top: [confTop > 0.5 ? 1 : 0, 0, 0],
    impact: [impactSource === 'audio' ? 1 : 0, 0, 0],
    mid_follow_through: [finKind, Math.min(1, finHold / 0.6), 0],
    finish: [finKind, Math.min(1, finHold / 0.6), 0],
  };
  // pose jitter: median |second difference| of the raw wrist x (torso lengths), scaled to [0, 1]
  const d2 = [];
  for (let i = 1; i < K - 1; i++) d2.push(Math.abs(wx[i + 1] - 2 * wx[i] + wx[i - 1]));
  d2.sort((a2, b2) => a2 - b2);
  const jitter = Math.min(1, (d2.length ? d2[d2.length >> 1] : 0) * 10);
  // t_s keeps the sub-frame estimate (media seconds); frame is the nearest frame of poseSeq.t_s
  const ts = poseSeq.t_s;
  const confX = {};
  let prevT = -Infinity;
  for (const e of EVENTS) {
    let [te, raw] = times[e];
    te = Math.min(ts[ts.length - 1], Math.max(ts[0], te));
    const kv = Math.min(K - 1, Math.max(0, Math.round((te - t[0]) * hz)));
    const visF = Math.min(1, Math.max(0, visW[kv] / 0.8));
    let clamped = 0;
    if (te < prevT) { te = prevT; clamped = 1; }
    prevT = te;
    const x = confFeatures(raw, visF, view, clamped, vt < VIS_DEFAULT ? 1 : 0, extra[e] ?? [0, 0, 0], jitter);
    confX[e] = x;
    out[e] = { frame: nearestIndex(ts, te), t_s: te, conf: round3(calibratedConf(e, x, impactSource === 'audio')), source: 'rules' };
  }
  Object.defineProperty(out, 'diag', {
    value: { hz, times: Object.fromEntries(Object.entries(times).map(([n, v]) => [n, v[0]])), impactSource, stillLen, L, address: diagA, vt, conf_features: confX },
    enumerable: false,
  });
  return out;
}

/**
 * Visibility threshold of a clip: 0.5, lowered for a dim / low-contrast clip to 0.75 × the median visibility of the
 * in-frame samples of `set` (never below 0.25), so a uniformly low-confidence pose model still counts its landmarks.
 */
function visThreshold(px, C, set, K) {
  const v = [];
  for (let k = 0; k < K; k += 2) for (const j of set) { const x = px[k * C + j * 4 + 3]; if (x > 0.2) v.push(x); }
  if (!v.length) return VIS_DEFAULT;
  v.sort((a, b) => a - b);
  return Math.min(VIS_DEFAULT, Math.max(0.25, 0.75 * v[v.length >> 1]));
}

function medianOf(x, a, b) {
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.min(x.length - 1, Math.max(a, b));
  const v = Array.from(x.subarray(lo, hi + 1)).sort((p, q) => p - q);
  return v.length ? v[v.length >> 1] : 0;
}

/**
 * Confidence features of one event (CONF_FEATURES order): 1, the rule's own score, visibility at the event
 * (vis_mean / 0.8, capped), view = dtl, view = high_behind, order clamp, dim clip, three event-specific values
 * (address: still-run length / 0.6 s, pre-motion refit, onset fit RMS × 20; toe_up: hand / forearm proxy; top: apex
 * crossing found; impact: audio; finish and mid_follow_through: hold found (1) / clip ends in the hold (0.5), hold
 * length / 0.6 s), pose jitter (median |second difference| of the wrist x × 10, capped at 1).
 */
export function confFeatures(raw, vis, view, clamped, dim, extra, jitter = 0) {
  return [1, raw, vis, view === 'dtl' ? 1 : 0, view === 'high_behind' ? 1 : 0, clamped, dim, extra[0], extra[1], extra[2], jitter];
}
export const CONF_FEATURES = Object.freeze(['bias', 'raw', 'vis', 'view_dtl', 'view_high_behind', 'clamped', 'dim', 'x1', 'x2', 'x3', 'jitter']);

/**
 * Isotonic step: knots [p_min, p_max, rate] are the fitted blocks of logistic outputs; p inside a block gets its rate,
 * p between two blocks the rate of the nearer block edge (below the first / above the last: that block's rate).
 */
function isoMap(knots, p) {
  let best = knots[0][2];
  let bestD = Infinity;
  for (const [lo, hi, q] of knots) {
    const d = p < lo ? lo - p : p > hi ? p - hi : 0;
    if (d < bestD) { bestD = d; best = q; }
    if (d === 0) break;
  }
  return best;
}

/** Logistic map of the features with the fitted weights of the event; the legacy score when none are fitted. */
export function calibratedConf(event, x, audio = false) {
  const w = CONF_CALIB.events?.[event]?.w;
  if (!Array.isArray(w) || w.length !== x.length) {
    let c = x[1];
    if (!(event === 'impact' && audio)) c *= Math.max(0.3, x[2]);
    return x[5] ? Math.min(c, 0.2) : c;
  }
  let z = 0;
  for (let i = 0; i < x.length; i++) z += w[i] * x[i];
  let p = 1 / (1 + Math.exp(-z));
  const iso = CONF_CALIB.events[event].iso;
  if (Array.isArray(iso) && iso.length) p = isoMap(iso, p);
  const lo = CONF_CALIB.clip?.[0] ?? 0.02;
  const hi = CONF_CALIB.clip?.[1] ?? 0.98;
  return Math.min(hi, Math.max(lo, p));
}

function round3(x) { return Math.round(x * 1000) / 1000; }

/** Landmarks of `set` whose mean visibility over [k0, k1] is >= vt (all of `set` if fewer than 3 qualify). */
function visibleSet(px, C, set, k0, k1, K, vt = VIS_DEFAULT) {
  const a = Math.max(0, k0);
  const b = Math.min(K - 1, k1);
  const out = set.filter((j) => {
    let s = 0;
    for (let k = a; k <= b; k++) s += px[k * C + j * 4 + 3];
    return s / Math.max(1, b - a + 1) >= vt;
  });
  return out.length >= 3 ? out : set;
}

/**
 * RMS over landmarks of the speed of 0.2 s-smoothed positions, in torso lengths / s. Per frame, only landmarks
 * with visibility >= 0.5 count (all of them when none does), so out-of-frame extrapolations do not look like motion.
 */
function bodySpeed(px, C, set, K, hz, vt = VIS_DEFAULT) {
  const w = oddWindow(0.2, hz);
  const acc = new Float64Array(K);
  const accAll = new Float64Array(K);
  const cnt = new Float64Array(K);
  const u = new Float64Array(K);
  const v = new Float64Array(K);
  for (const j of set) {
    for (let k = 0; k < K; k++) { u[k] = px[k * C + j * 4]; v[k] = px[k * C + j * 4 + 1]; }
    const us = gradient(movingAverage(u, w), hz);
    const vs = gradient(movingAverage(v, w), hz);
    for (let k = 0; k < K; k++) {
      const q = us[k] * us[k] + vs[k] * vs[k];
      accAll[k] += q;
      if (px[k * C + j * 4 + 3] >= vt) { acc[k] += q; cnt[k]++; }
    }
  }
  for (let k = 0; k < K; k++) {
    if (cnt[k] > 0) acc[k] = acc[k] / cnt[k] * set.length;
    else acc[k] = accAll[k];
  }
  // normalised to torso lengths by the median torso length of the clip
  let L = 0;
  const tl = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    const du = (px[k * C + 44] + px[k * C + 48]) / 2 - (px[k * C + 92] + px[k * C + 96]) / 2;
    const dv = (px[k * C + 45] + px[k * C + 49]) / 2 - (px[k * C + 93] + px[k * C + 97]) / 2;
    tl[k] = Math.hypot(du, dv);
  }
  tl.sort();
  L = tl[K >> 1] || 1;
  for (let k = 0; k < K; k++) acc[k] = Math.sqrt(acc[k] / set.length) / L;
  return acc;
}

function meanPose(px, C, set, k0, k1) {
  const ref = new Float64Array(set.length * 2);
  const n = Math.max(1, k1 - k0 + 1);
  for (let k = k0; k <= k1; k++) {
    set.forEach((j, m) => { ref[2 * m] += px[k * C + j * 4]; ref[2 * m + 1] += px[k * C + j * 4 + 1]; });
  }
  for (let m = 0; m < ref.length; m++) ref[m] /= n;
  return ref;
}

/**
 * Motion onset (dir = +1: start of motion after a still run) or stop (dir = -1: end of motion before a still run).
 * kStill = far end of the still run, kRef = its near end. Window: from kStill to the first frame past kRef (in scan
 * direction) where the RMS landmark displacement from the still mean reaches `hi` torso lengths (RULES.onset_hi), or
 * `maxS` past kRef (RULES.onset_max_s), whichever comes first. Model, for every landmark j and image axis:
 * y(t) = c + A·τ² [+ B·τ³] [+ b·min(0, dir·(t − t0))], τ = max(0, dir·(t − t0)): a start from rest with finite
 * acceleration (the cubic term absorbs a start whose first acceleration points along the camera axis; the drift term
 * a slow pre-motion drift such as a forward press). Samples with visibility < 0.5 get no weight. The coefficients are
 * linear least squares per channel for a candidate t0; t0 is the grid point (step dt/10, from kRef − back s to the
 * window end) with the smallest total residual. Returns { t0, rms } (rms = residual RMS in torso lengths) or null.
 */
function onsetFit(t, px, C, set, kStill, kRef, kFar, dir, L, dt, o = {}) {
  const K = t.length;
  const hi = o.hi ?? RULES.onset_hi;
  const maxS = o.maxS ?? RULES.onset_max_s;
  const back = o.back ?? 0.3;
  const vt = o.vt ?? VIS_DEFAULT;
  const ref = meanPose(px, C, set, Math.min(kStill, kRef), Math.max(kStill, kRef));
  let kHi = -1;
  const kMax = kRef + dir * Math.round(maxS / dt);
  for (let k = kRef; dir > 0 ? k <= kFar : k >= kFar; k += dir) {
    if (k < 0 || k >= K) break;
    if (k === kMax) { kHi = k; break; }
    let s = 0;
    let m = 0;
    set.forEach((j, q) => {
      if (px[k * C + j * 4 + 3] < vt) return;
      const du = px[k * C + j * 4] - ref[2 * q];
      const dv = px[k * C + j * 4 + 1] - ref[2 * q + 1];
      s += du * du + dv * dv;
      m++;
    });
    if (m > 0 && Math.sqrt(s / m) / L >= hi) { kHi = k; break; }
  }
  if (kHi < 0 || Math.abs(kHi - kRef) < 2) return null;
  const k0 = Math.min(kStill, kHi);
  const k1 = Math.max(kStill, kHi);
  const n = k1 - k0 + 1;
  const tA = t[Math.max(0, Math.min(K - 1, kRef - dir * Math.round(back / dt)))];
  const tB = t[kHi];
  const nGrid = Math.max(2, Math.round((Math.abs(tB - tA) / dt) * 10));
  const nb = 2 + (o.cubic ? 1 : 0) + (o.drift ? 1 : 0);
  const basis = Array.from({ length: nb }, () => new Float64Array(n));
  basis[0].fill(1);
  const wts = new Float64Array(n);
  const ys = new Float64Array(n);
  let best = null;
  let bestSse = Infinity;
  let bestCnt = 0;
  for (let g = 0; g <= nGrid; g++) {
    const t0 = tA + ((tB - tA) * g) / nGrid;
    for (let i = 0; i < n; i++) {
      const d = dir * (t[k0 + i] - t0);
      const tau = Math.max(0, d);
      let b = 1;
      basis[b++][i] = o.power ? tau ** o.power : tau * tau;
      if (o.cubic) basis[b++][i] = tau * tau * tau;
      if (o.drift) basis[b++][i] = Math.min(0, d);
    }
    let sse = 0;
    let cnt = 0;
    for (const j of set) {
      let nw = 0;
      for (let i = 0; i < n; i++) { wts[i] = px[(k0 + i) * C + j * 4 + 3] >= vt ? 1 : 0; nw += wts[i]; }
      if (nw < nb + 1) continue;
      for (let c = 0; c < 2; c++) {
        for (let i = 0; i < n; i++) ys[i] = px[(k0 + i) * C + j * 4 + c];
        sse += lsqResidual(basis, ys, wts, n);
        cnt += nw;
      }
    }
    if (sse < bestSse) { bestSse = sse; best = t0; bestCnt = cnt; }
  }
  if (best === null) return null;
  return { t0: best, rms: Math.sqrt(bestSse / Math.max(1, bestCnt)) / L };
}

function onsetTime(t, px, C, set, kStill, kRef, kFar, dir, L, dt, o) {
  const r = onsetFit(t, px, C, set, kStill, kRef, kFar, dir, L, dt, o);
  return r ? r.t0 : null;
}

/** Weighted linear least squares residual sum of squares of y on the given basis columns (normal equations). */
function lsqResidual(basis, y, w, n) {
  const m = basis.length;
  const A = new Float64Array(m * m);
  const r = new Float64Array(m);
  let yy = 0;
  for (let i = 0; i < n; i++) {
    if (!w[i]) continue;
    const yi = y[i];
    yy += yi * yi;
    for (let a = 0; a < m; a++) {
      const ba = basis[a][i];
      r[a] += ba * yi;
      for (let b = a; b < m; b++) A[a * m + b] += ba * basis[b][i];
    }
  }
  for (let a = 0; a < m; a++) for (let b = 0; b < a; b++) A[a * m + b] = A[b * m + a];
  // solve A x = r by Gaussian elimination with partial pivoting; singular columns are dropped (x = 0)
  const M = Float64Array.from(A);
  const x = Float64Array.from(r);
  const scale = Math.max(1e-300, ...Array.from({ length: m }, (_, a) => Math.abs(A[a * m + a])));
  const piv = Array.from({ length: m }, (_, a) => a);
  const used = new Uint8Array(m);
  for (let col = 0; col < m; col++) {
    let pr = -1;
    let pv = 0;
    for (let row = col; row < m; row++) if (Math.abs(M[row * m + col]) > pv) { pv = Math.abs(M[row * m + col]); pr = row; }
    if (pr < 0 || pv <= 1e-12 * scale) continue;
    if (pr !== col) {
      for (let c = 0; c < m; c++) { const tmp = M[col * m + c]; M[col * m + c] = M[pr * m + c]; M[pr * m + c] = tmp; }
      const tx = x[col]; x[col] = x[pr]; x[pr] = tx;
      const tp = piv[col]; piv[col] = piv[pr]; piv[pr] = tp;
    }
    used[col] = 1;
    for (let row = 0; row < m; row++) {
      if (row === col) continue;
      const f = M[row * m + col] / M[col * m + col];
      if (f === 0) continue;
      for (let c = col; c < m; c++) M[row * m + c] -= f * M[col * m + c];
      x[row] -= f * x[col];
    }
  }
  // residual = yy - x'r for the normal-equation solution (x in the original column order = solution of A x = r)
  let xr = 0;
  for (let col = 0; col < m; col++) if (used[col]) xr += (x[col] / M[col * m + col]) * r[col];
  return Math.max(0, yy - xr);
}

/**
 * Apex (direction reversal) of one or more position channels around tc: for each candidate apex time on a grid of
 * dt/10 within +-2 dt of tc, every channel is least-squares fitted with c + a·min(0, t - ta)² + b·max(0, t - ta)²
 * (separate deceleration into and acceleration out of the apex) over |t - tc| <= half; the candidate with the
 * smallest total residual wins. Returns the apex time or null.
 */
function fitApex(t, chans, tc, half, dt) {
  const idx = [];
  for (let k = 0; k < t.length; k++) if (Math.abs(t[k] - tc) <= half + 1e-9) idx.push(k);
  if (idx.length < 6) return null;
  let best = null;
  let bestSse = Infinity;
  for (let q = -20; q <= 20; q++) {
    const ta = tc + (q * dt) / 10;
    let sse = 0;
    for (const y of chans) {
      // normal equations for [c, a, b]
      let s11 = 0; let s12 = 0; let s13 = 0; let s22 = 0; let s33 = 0; let r1 = 0; let r2 = 0; let r3 = 0; let yy = 0;
      for (const k of idx) {
        const d = t[k] - ta;
        const f2 = d < 0 ? d * d : 0;
        const f3 = d > 0 ? d * d : 0;
        const v = y[k];
        s11 += 1; s12 += f2; s13 += f3; s22 += f2 * f2; s33 += f3 * f3;
        r1 += v; r2 += f2 * v; r3 += f3 * v; yy += v * v;
      }
      const A = [[s11, s12, s13], [s12, s22, 0], [s13, 0, s33]];
      const x = solve3(A, [r1, r2, r3]);
      if (x === null) { sse = Infinity; break; }
      sse += yy - (x[0] * r1 + x[1] * r2 + x[2] * r3);
    }
    if (sse < bestSse) { bestSse = sse; best = ta; }
  }
  return best;
}

function solve3(A, b) {
  const [a, bb, c] = A[0];
  const [d, e, f] = A[1];
  const [g, h, i] = A[2];
  const det = a * (e * i - f * h) - bb * (d * i - f * g) + c * (d * h - e * g);
  if (!(Math.abs(det) > 1e-18)) return null;
  const x0 = (b[0] * (e * i - f * h) - bb * (b[1] * i - f * b[2]) + c * (b[1] * h - e * b[2])) / det;
  const x1 = (a * (b[1] * i - f * b[2]) - b[0] * (d * i - f * g) + c * (d * b[2] - b[1] * g)) / det;
  const x2 = (a * (e * b[2] - b[1] * h) - bb * (d * b[2] - b[1] * g) + b[0] * (d * h - e * g)) / det;
  return [x0, x1, x2];
}
