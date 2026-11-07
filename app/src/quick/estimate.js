// quick/estimate.js — the quick read (速報) computed at IMPACT from the live wrist samples (V04-SPEC §A.2–A.4; owner V4-B).
// Lazy. Pure: no DOM, no clock except performance.now() for timings_ms. A quick value is never written into a golf-shot
// (only diag live.quick_log, the quick card and - in the simulated course - the round record).
//
//   quickEstimate({ samples, impact, view, fps, club, handedness, calibration, gappingRow | null, settings,
//                   driver_carry_m? }) -> QuickResult
//
// samples: the live loop's wrist samples [{ t_s, x_m, y_m, xl_m?, yl_m? } …] or [[t, x, y, xl?, yl?] …] (body plane,
// metres, y up; pipeline/live.js wristSample: hands midpoint and lead wrist) up to at least impact + 0.02 s; 10 Hz
// before the swing, the swing rate (30 / 60 Hz) after it.
// impact: the events/live.js 'impact' event. club: { type, length_m } or a type string.
//
// Method (each step only uses samples the phone already has at impact; no decoding, no flight integration):
//   address  takeaway onset: displacement d(t) of the hands from their still address position grows as A·(t − t0)²
//            from rest, so √d is linear in t; least-squares line through the samples with d in [D_LO, D_HI] → t0
//            (fallback: the last still sample). Same idea as the refined events/rules.js onset fit, on the hand only.
//   top      the highest hand sample before the downswing, refined with a least-squares parabola (±TOP_HALF_S); a flat
//            top widens its half-width by the time the hands stay within top_height_m of the highest point.
//   impact   the audio onset when the impact came from audio; else the lowest hand point after the top (parabola),
//            as the refined rules do without audio.
//   tempo    backswing = top − address, downswing = impact − top, ratio; ci95 = the metrics/common.js interval with
//            each event's half-width = ½ sample interval at its rate (+ QUICK.event_sys_s for the method difference).
//   club     face_on only (dtl: the depth axis; high_behind needs 240 fps): physics/clubspeed_pose.js on the lead-wrist
//   speed    chords (2D body plane scaled to the hand depth D_m + hand_depth_offset_m, arm length prior) with the
//            extra QUICK.hands_sigma_rel and depth terms; ci95 at least ±25 % (F2 "低").
//   carry    face_on with a club speed: ball = club × smash prior → quick/carry-table.js (launch / spin priors through
//            the physics/lm flight model) with the club-speed and smash σ propagated; merged by inverse variance with
//            the player's own distance-table row when there is one (n ≥ 5): GAPPING_PRIOR. Otherwise (dtl / high_behind,
//            or no club speed) the carry IS the prior: the distance-table row (median, σ from P10–P90) or, without
//            one, the reference carry of practice/drills.js REFERENCE_CARRY_M (scaled by driver_carry_m / 200 when
//            given) with 1σ = QUICK.reference_sigma_rel: REFERENCE_PRIOR. carry_source says which.
// Every number: validity 'low_confidence', ci95 and sigma, RC.PROVISIONAL first. Never
// ball speed, launch angle or spin (§A.4: live mode cannot see the ball). All constants UNVERIFIED (synthetic
// fixture only, tests/fixtures/v4/quick-swings.json); the device numbers come from the owner's 20-shot checklist.

import { RC } from '../contract/reason-codes.js';
import { valueMetric, nullMetric, TEMPO_LIMITS } from '../metrics/common.js';
import { nullCodeFor } from '../metrics/registry.js';
import { clubSpeedFromPose, POSE_CLUB_MIN_FPS, CI95_MIN_FRAC } from '../physics/clubspeed_pose.js';
import { isPlausible } from '../physics/plausibility.js';
import { clubCategory } from '../physics/ballistics.js';
import { RULES } from '../events/rules.js';
import { REFERENCE_CARRY_M } from '../practice/drills.js';
import { CARRY_TABLE } from './carry-table.js';

export const QUICK = Object.freeze({
  d_lo_m: 0.008, // onset fit window (hand displacement from the address position)
  d_hi_m: 0.12,
  still_window_s: 0.3, // address position = mean of the samples in this window ending 0.1 s before the detector's address
  top_half_s: 0.08, // top: parabola fitted to the hand height samples within this of the highest one
  top_height_m: 0.002, // top ambiguity: hands within this of their highest point count as 'at the top' (≈ pose noise)
  top_amb_max_s: 0.12,
  // the hand-only takeaway onset can come late where the first hand motion is along the camera axis (synthetic
  // fixture: quick − refined address up to +0.15 s high_behind, +0.1 s dtl); widens the backswing interval upwards
  addr_late_s: Object.freeze({ face_on: 0, dtl: 0.1, high_behind: 0.15 }),
  event_sys_s: 0.02, // added to every event half-width: quick (hands only, sparse) vs refined (whole body) definitions
  hands_sigma_rel: 0.1, // 2D body-plane hand chords vs the 3D lead wrist of the refined row 14
  // face_on: the live samples are scaled at the ball distance D_m (pipeline/live.js wristSample); at impact the hands
  // are about this much farther from the camera than the ball (stance ≈ 0.6 m behind the ball line, hands ≈ 0.4 m);
  // the refined row 14 puts them at the body depth from the feet. 1σ below (relative scale error = σ / (D + offset)).
  hand_depth_offset_m: 0.4,
  hand_depth_sigma_m: 0.12,
  landmark_px: 3, // metrics/body.js LANDMARK_SIGMA_PX
  reference_sigma_rel: 0.12, // V04-SPEC §B.1 reference prior 1σ (UNVERIFIED)
  gapping_min_n: 5,
});
const IQR_P10_P90 = 2.5631; // P90 − P10 of a normal distribution in σ

const fin = Number.isFinite;
const now = () => (globalThis.performance ? globalThis.performance.now() : Date.now());

/** Normalised samples [{ t, x, y, xl?, yl? }] sorted by time ({ t_s, x_m, y_m, xl_m?, yl_m? } or [t, x, y, xl?, yl?]). */
function prepare(samples) {
  const out = [];
  for (const s of samples ?? []) {
    const a = Array.isArray(s);
    const t = a ? s[0] : s?.t_s;
    const x = a ? s[1] : s?.x_m;
    const y = a ? s[2] : s?.y_m;
    const xl = a ? s[3] : s?.xl_m;
    const yl = a ? s[4] : s?.yl_m;
    if (fin(t) && fin(x) && fin(y)) out.push(fin(xl) && fin(yl) ? { t, x, y, xl, yl } : { t, x, y });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** Vertex time of the parabola through three samples (non-uniform times); null when degenerate. */
function vertex3(a, b, c, key) {
  const d1 = (b[key] - a[key]) / (b.t - a.t);
  const d2 = (c[key] - b[key]) / (c.t - b.t);
  const curv = (d2 - d1) / (c.t - a.t);
  if (!fin(curv) || curv === 0) return null;
  const tv = (a.t + b.t) / 2 - d1 / (2 * curv); // f'(τ) = d1 + 2·curv·(τ − mid(a, b)) = 0
  return fin(tv) ? tv : null;
}

/** Local sample interval (s) around time t. */
function intervalAt(S, t) {
  let best = Infinity;
  for (let i = 1; i < S.length; i++) {
    const dt = S[i].t - S[i - 1].t;
    if (dt > 0 && S[i].t >= t - 0.15 && S[i - 1].t <= t + 0.15) best = Math.min(best, dt);
  }
  return fin(best) ? best : 0.1;
}

/** Takeaway onset from the √displacement line. */
function addressTime(S, impact, tTop, view) {
  const pw = RULES.onset_power[view] ?? 2;
  const tA = fin(impact.t_address) ? impact.t_address : fin(impact.t_swing) ? impact.t_swing - 0.3 : null;
  if (tA === null) return null;
  // the detector's address time is the last still sample, which may already hold the first few mm of the takeaway
  const still = S.filter((s) => s.t <= tA - 0.1 + 1e-6 && s.t >= tA - 0.1 - QUICK.still_window_s);
  const ref = still.length ? still : S.filter((s) => s.t <= tA + 1e-6).slice(-1);
  if (!ref.length) return null;
  const x0 = ref.reduce((a, s) => a + s.x, 0) / ref.length;
  const y0 = ref.reduce((a, s) => a + s.y, 0) / ref.length;
  // the takeaway run: the samples rising from the last still one (d < d_lo) up to d_hi; an isolated noise sample above
  // d_lo before the hands really start is dropped because the run is taken backwards from the first one past d_hi
  const D = [];
  for (const s of S) if (s.t >= tA - QUICK.still_window_s && s.t < tTop) D.push([s.t, Math.hypot(s.x - x0, s.y - y0)]);
  let kHi = D.findIndex((p) => p[1] > QUICK.d_hi_m);
  if (kHi < 0) kHi = D.length;
  let k0 = kHi;
  while (k0 > 0 && D[k0 - 1][1] >= QUICK.d_lo_m) k0--;
  const lastStill = k0 > 0 ? D[k0 - 1][0] : ref[ref.length - 1].t;
  const run = D.slice(k0, kHi);
  // sparse 10 Hz takeaway (often one sample in the window): the first sample past d_hi joins the fit
  if (run.length < 2 && kHi < D.length) run.push(D[kHi]);
  const pts = run.map(([t, d]) => [t, d ** (1 / pw)]);
  if (pts.length >= 2) {
    const n = pts.length;
    const mt = pts.reduce((a, p) => a + p[0], 0) / n;
    const mr = pts.reduce((a, p) => a + p[1], 0) / n;
    let sxy = 0, sxx = 0;
    for (const [t, r] of pts) { sxy += (t - mt) * (r - mr); sxx += (t - mt) ** 2; }
    const slope = sxx > 0 ? sxy / sxx : 0;
    if (slope > 0) {
      const t0 = mt - mr / slope;
      if (fin(t0) && t0 >= lastStill - 0.2 && t0 <= pts[0][0]) return { t: t0, conf: n >= 3 ? 0.8 : 0.6, fit: true };
    }
  }
  return { t: lastStill, conf: 0.4, fit: false };
}

function topTime(S, impact, tImpEnd) {
  const t1 = fin(impact.t_top) ? impact.t_top + 0.3 : tImpEnd;
  let k = -1;
  for (let i = 0; i < S.length; i++) {
    if (S[i].t < (impact.t_swing ?? -Infinity) || S[i].t > Math.min(t1, tImpEnd)) continue;
    if (k < 0 || S[i].y > S[k].y) k = i;
  }
  if (k < 0) return null;
  // least-squares parabola y(t) through the samples within ±TOP_HALF_S of the highest one (≥ 3 samples)
  const pts = S.filter((s) => Math.abs(s.t - S[k].t) <= QUICK.top_half_s);
  if (pts.length >= 3) {
    const tc = S[k].t;
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, y0 = 0, y1 = 0, y2 = 0;
    for (const p of pts) {
      const u = p.t - tc;
      s0 += 1; s1 += u; s2 += u * u; s3 += u * u * u; s4 += u * u * u * u;
      y0 += p.y; y1 += u * p.y; y2 += u * u * p.y;
    }
    // normal equations [s4 s3 s2; s3 s2 s1; s2 s1 s0]·[a b c] = [y2 y1 y0] (Cramer)
    const det3 = (m) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
    const M = [s4, s3, s2, s3, s2, s1, s2, s1, s0];
    const d = det3(M);
    if (Math.abs(d) > 1e-18) {
      const a = det3([y2, s3, s2, y1, s2, s1, y0, s1, s0]) / d;
      const b = det3([s4, y2, s2, s3, y1, s1, s2, y0, s0]) / d;
      const tv = tc - b / (2 * a);
      // a flat top (slow turn-around) is ambiguous: the time span over which the hands stay within top_height_m of
      // their highest point, ±√(h/|a|), is added to the top's half-width
      const amb = a < 0 ? Math.min(QUICK.top_amb_max_s, Math.sqrt(QUICK.top_height_m / -a)) : QUICK.top_amb_max_s;
      if (a < 0 && fin(tv) && Math.abs(tv - tc) <= QUICK.top_half_s) return { t: tv, k, amb };
    }
  }
  return { t: S[k].t, k, amb: QUICK.top_amb_max_s };
}

function impactTime(S, impact, top) {
  if (impact.impact_source === 'audio' && fin(impact.t_impact)) return { t: impact.t_impact, half: 0.005, src: 'audio' };
  // lowest hand point after the top within 0.8 s, with a sample after it
  let k = -1;
  for (let i = top.k + 1; i < S.length - 1; i++) {
    if (S[i].t > top.t + 0.8) break;
    if (k < 0 || S[i].y < S[k].y) k = i;
  }
  if (k > 0 && k < S.length - 1 && S[k + 1].y > S[k].y) {
    const tv = vertex3(S[k - 1], S[k], S[k + 1], 'y');
    const t = tv !== null && tv > S[k - 1].t && tv < S[k + 1].t ? tv : S[k].t;
    return { t, half: 0.5 * intervalAt(S, t), src: 'wrist_low' };
  }
  return fin(impact.t_impact) ? { t: impact.t_impact, half: Math.max(0.05, intervalAt(S, impact.t_impact)), src: 'wrist_peak' } : null;
}

const withProvisional = (codes) => [RC.PROVISIONAL, ...codes.filter((c) => c !== RC.PROVISIONAL)];

function tempo(S, impact, view) {
  const ids = ['backswing_s', 'downswing_s', 'tempo_ratio'];
  const nul = (codes) => Object.fromEntries(ids.map((id) => [id, nullMetric(id, 'not_computed', withProvisional(codes))]));
  const last = S.length ? S[S.length - 1].t : -Infinity;
  const top = topTime(S, impact, last);
  if (!top) return { metrics: nul([RC.EVENTS_UNCERTAIN]), events: null };
  const addr = addressTime(S, impact, top.t, view);
  const imp = impactTime(S, impact, top);
  if (!addr || !imp) return { metrics: nul([RC.EVENTS_UNCERTAIN]), events: null };
  const B = top.t - addr.t;
  const D = imp.t - top.t;
  const events = { address: addr.t, top: top.t, impact: imp.t, impact_source: imp.src };
  if (!(B >= TEMPO_LIMITS.backswing_hard[0] && B <= TEMPO_LIMITS.backswing_hard[1] && D >= TEMPO_LIMITS.downswing_hard[0] && D <= TEMPO_LIMITS.downswing_hard[1])) {
    return { metrics: Object.fromEntries(ids.map((id) => [id, nullMetric(id, 'implausible', withProvisional([RC.IMPLAUSIBLE_VALUE, RC.TIMEBASE_SUSPECT]))])), events };
  }
  // per-event half-width = ½ local sample interval (doubled for an address without the onset fit) + the method term;
  // combined as metrics/common.js tempoInterval does (the top error shared by both phases)
  const hA = 0.5 * intervalAt(S, addr.t) / (addr.fit ? 1 : 0.5) + QUICK.event_sys_s;
  const hT = 0.5 * intervalAt(S, top.t) + QUICK.event_sys_s + top.amb;
  const hI = imp.half + QUICK.event_sys_s;
  // down the line / from behind the first hand motion points along the camera axis: the hand-only onset comes late
  // (the refined analysis fits the whole body), so the backswing can be longer than read, never much shorter
  const hL = QUICK.addr_late_s[view] ?? 0;
  const iv = {
    backswing: [B - hA - hT, B + hA + hT + hL],
    downswing: [D - hT - hI, D + hT + hI],
    // a downswing interval reaching below the plausible minimum is clamped there (the ratio bound stays finite)
    ratio: [(B - hA - hT) / (D + hT + hI), (B + hA + hT + hL) / Math.max(D - hT - hI, TEMPO_LIMITS.downswing_hard[0])],
  };
  const codes = withProvisional([...(impact.reason_codes ?? []), ...(addr.fit ? [] : [RC.EVENTS_UNCERTAIN])]);
  if (D < TEMPO_LIMITS.downswing_soft[0] || D > TEMPO_LIMITS.downswing_soft[1]) codes.push(RC.TIMEBASE_SUSPECT);
  const vals = { backswing_s: [B, iv.backswing], downswing_s: [D, iv.downswing], tempo_ratio: [B / D, iv.ratio] };
  const metrics = {};
  for (const id of ids) {
    const [value, ci95] = vals[id];
    metrics[id] = valueMetric(id, { value, ci95, sigma: (ci95[1] - ci95[0]) / (2 * 1.959964), validity: 'low_confidence', codes: [...new Set(codes)], origin: id === 'tempo_ratio' ? 'derived' : 'pose' });
  }
  return { metrics, events };
}

function clubSpeed(S, impact, events, o) {
  const id = 'club_speed_mps';
  if (o.view !== 'face_on') return nullMetric(id, 'not_observable', withProvisional([o.view === 'high_behind' ? RC.FPS_TOO_LOW : nullCodeFor(id, o.view) ?? RC.VIEW_DEPTH_AXIS]), 'pose');
  const tImp = events?.impact ?? impact.t_impact;
  // the effective rate around impact (the loop may have been throttled or degraded)
  const rate = 1 / intervalAt(S, tImp);
  if (!(rate >= POSE_CLUB_MIN_FPS * 0.9)) return nullMetric(id, 'not_observable', withProvisional([RC.FPS_TOO_LOW]), 'pose');
  const cal = o.calibration;
  const D = cal?.pose?.D_m > 0 ? cal.pose.D_m : 2.7;
  const f = cal?.camera?.f > 0 ? cal.camera.f : null;
  const scale = (D + QUICK.hand_depth_offset_m) / D;
  const sDepthRel = QUICK.hand_depth_sigma_m / (D + QUICK.hand_depth_offset_m);
  const pos = f ? (QUICK.landmark_px * D * scale) / f : 0.006;
  // the lead wrist when the loop has it (metrics/club.js uses the lead wrist), else the hands midpoint
  const lead = S.every((s) => fin(s.xl) || s.t < tImp - 0.2 || s.t > tImp + 0.05);
  const r = clubSpeedFromPose({
    t: S.map((s) => s.t), wrist: S.map((s) => (lead ? (fin(s.xl) ? [s.xl * scale, s.yl * scale, 0] : null) : [s.x * scale, s.y * scale, 0])), t_impact: tImp, fps: Math.round(rate),
    club_length_m: o.clubLength, pos_sigma_m: pos,
  });
  if (!r.ok) return nullMetric(id, r.validity, withProvisional(r.reason_codes), 'pose');
  if (!isPlausible(id, r.club_speed_mps)) return nullMetric(id, 'implausible', withProvisional([RC.IMPLAUSIBLE_VALUE]), 'pose');
  const v = r.club_speed_mps;
  const sRel = Math.hypot(r.sigma / v, QUICK.hands_sigma_rel, sDepthRel);
  const half = Math.max(CI95_MIN_FRAC, 1.959964 * sRel);
  const codes = withProvisional([...(impact.reason_codes ?? []), ...(cal ? [] : [RC.NO_CALIBRATION])]);
  return valueMetric(id, { value: v, sigma: v * sRel, ci95: [v * (1 - half), v * (1 + half)], validity: 'low_confidence', codes, origin: 'pose' });
}

// club types of the table for the physics/ballistics.js categories (a club the table does not list)
const BY_CATEGORY = Object.freeze({ driver: 'driver', wood: '3w', hybrid: 'hybrid', iron_long: '5i', iron_mid: '7i', iron_short: '9i', wedge: 'pw' });

/** Table carry and its 1σ at a ball speed (linear in speed), or null outside the table. */
export function tableCarry(type, ball) {
  const c = CARRY_TABLE.clubs[type] ?? null;
  if (!c) return null;
  const { min, max, step } = CARRY_TABLE.speed_mps;
  if (!(ball >= min && ball <= max)) return null;
  const x = (ball - min) / step;
  const i = Math.min(c.rows.length - 2, Math.floor(x));
  const w = x - i;
  const [c0, s0] = c.rows[i];
  const [c1, s1] = c.rows[i + 1];
  return { carry: c0 + w * (c1 - c0), sigma: s0 + w * (s1 - s0), slope: (c1 - c0) / step, smash: c.smash, smash_sd: c.smash_sd };
}

function clubTypeOf(club) {
  const type = club && typeof club === 'object' ? club.type : club;
  if (type && CARRY_TABLE.clubs[type]) return type;
  return BY_CATEGORY[clubCategory(type)] ?? null;
}

/** The distance-table prior of a gapping() row: { carry, sigma } or null (n < 5 or no median). */
export function gappingPrior(row) {
  const c = row?.carry;
  if (!row || !(row.n >= QUICK.gapping_min_n) || !c || !fin(c.median)) return null;
  let sigma = fin(c.p10) && fin(c.p90) && c.p90 > c.p10 ? (c.p90 - c.p10) / IQR_P10_P90 : fin(c.sd_obs) && c.sd_obs > 0 ? c.sd_obs : null;
  if (!(sigma > 0)) sigma = QUICK.reference_sigma_rel * c.median;
  return { carry: c.median, sigma, n: row.n };
}

/** The reference prior: REFERENCE_CARRY_M of the club, scaled by the player's driver carry when known. */
export function referencePrior(type, driverCarry) {
  const base = REFERENCE_CARRY_M[type] ?? null;
  if (!fin(base)) return null;
  const k = fin(driverCarry) && driverCarry > 0 ? driverCarry / REFERENCE_CARRY_M.driver : 1;
  const carry = base * k;
  return { carry, sigma: QUICK.reference_sigma_rel * carry };
}

function carry(clubSpeedMetric, o, type) {
  const id = 'carry_m';
  const gap = gappingPrior(o.gappingRow);
  const cs = clubSpeedMetric;
  if (o.view === 'face_on' && cs && fin(cs.value) && type) {
    const tc = tableCarry(type, cs.value * (CARRY_TABLE.clubs[type]?.smash ?? 1.35));
    if (tc) {
      const ball = cs.value * tc.smash;
      const sBallRel = Math.hypot(cs.sigma / cs.value, tc.smash_sd / tc.smash);
      const sPose = Math.hypot(tc.sigma, tc.slope * ball * sBallRel);
      const codes = [RC.PROVISIONAL, RC.SMASH_ASSUMED, RC.LAUNCH_V_ASSUMED, RC.FLIGHT_MODELLED, ...(cs.reason_codes ?? []).filter((c) => c !== RC.PROVISIONAL)];
      let value = tc.carry;
      let sigma = sPose;
      let merge = null;
      if (gap) {
        const wp = 1 / (sPose * sPose), wg = 1 / (gap.sigma * gap.sigma);
        value = (tc.carry * wp + gap.carry * wg) / (wp + wg);
        sigma = Math.sqrt(1 / (wp + wg));
        codes.push(RC.GAPPING_PRIOR);
        merge = { pose: { carry: tc.carry, sigma: sPose, w: wp / (wp + wg) }, gapping: { carry: gap.carry, sigma: gap.sigma, n: gap.n, w: wg / (wp + wg) } };
      }
      return { metric: valueMetric(id, { value, sigma, validity: 'low_confidence', codes: [...new Set(codes)], origin: 'flight_model' }), source: 'pose', merge, ball_mps: ball };
    }
  }
  if (gap) {
    return { metric: valueMetric(id, { value: gap.carry, sigma: gap.sigma, validity: 'low_confidence', codes: [RC.PROVISIONAL, RC.GAPPING_PRIOR], origin: 'prior' }), source: 'gapping', merge: null };
  }
  const ref = type ? referencePrior(type, o.driver_carry_m) : null;
  if (ref) {
    return { metric: valueMetric(id, { value: ref.carry, sigma: ref.sigma, validity: 'low_confidence', codes: [RC.PROVISIONAL, RC.REFERENCE_PRIOR], origin: 'prior' }), source: 'reference', merge: null };
  }
  return { metric: nullMetric(id, 'not_computed', [RC.PROVISIONAL, RC.DEPENDS_ON_NULL], 'prior'), source: null, merge: null };
}

/**
 * @param {{ samples: Array<object>, impact: object, view: 'face_on'|'dtl'|'high_behind', fps: number, club: object|string,
 *   handedness: 'right'|'left', calibration: object|null, gappingRow: object|null, settings: object, driver_carry_m?: number }} input
 * @returns {{ stage: 'provisional', t_impact: number, metrics: Object<string, object>, carry_source: 'pose'|'gapping'|'reference'|null,
 *   timings_ms: { compute: number }, club: string|null, view: string, events: object|null, carry_merge: object|null }}
 */
export function quickEstimate(input) {
  const t0 = now();
  const o = input ?? {};
  const impact = o.impact ?? {};
  const S = prepare(o.samples);
  const clubObj = o.club && typeof o.club === 'object' ? o.club : { type: o.club ?? null };
  const view = o.view ?? 'face_on';
  const { metrics: tm, events } = tempo(S, impact, view);
  const cs = clubSpeed(S, impact, events, { view, calibration: o.calibration ?? null, clubLength: fin(clubObj.length_m) ? clubObj.length_m : undefined });
  const type = clubTypeOf(clubObj);
  const cr = carry(cs, { ...o, view }, type);
  return {
    stage: 'provisional',
    t_impact: fin(events?.impact) ? events.impact : impact.t_impact,
    metrics: { ...tm, club_speed_mps: cs, carry_m: cr.metric },
    carry_source: cr.source,
    carry_merge: cr.merge,
    club: clubObj.type ?? null,
    view,
    events,
    timings_ms: { compute: Math.round((now() - t0) * 100) / 100 },
  };
}
