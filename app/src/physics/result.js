// Physics results → Metric values (interfaces §4) for the ball/club ids of CAFCR F2 rows 14, 16–20.
// face_on only; the other views get the honest nulls of F2 (the per-view table itself is owned by
// metrics/registry.js, this mirrors it for the ids physics produces; high_behind #15/#18: pipeline.analyzeHighBehind).

import { RC } from '../contract/reason-codes.js';
import { metricNull, metricValue } from '../contract/metric.js';
import { ballPlausibility, isPlausible } from './plausibility.js';
import { CLUB_MIN_FPS } from './club.js';
import { fpsAtLeast } from '../geom/constants.js';

export const BALL_MIN_FPS = 200; // F2 #16, 17, 19 ("<200 不可"); #20 uses the same floor (task spec)
export const PHYSICS_METRIC_IDS = Object.freeze([
  'club_speed_mps', 'ball_speed_mps', 'launch_v_deg', 'launch_h_deg', 'carry_m', 'smash_factor',
]);
const UNITS = Object.freeze({
  club_speed_mps: 'm/s', ball_speed_mps: 'm/s', launch_v_deg: 'deg', launch_h_deg: 'deg', carry_m: 'm', smash_factor: 'ratio',
});

const uniq = (a) => [...new Set(a.filter(Boolean))];

function num(id, value, ci95, sigma, validity, origin, codes) {
  let ci = ci95 ? [Math.min(ci95[0], value), Math.max(ci95[1], value)] : null;
  let sg = Number.isFinite(sigma) ? sigma : null;
  if (!ci && sg === null) sg = 0;
  return metricValue({ value, unit: UNITS[id], ci95: ci, sigma: sg, validity, value_origin: origin, reason_codes: uniq(codes) });
}

const nul = (id, validity, codes, origin) => metricNull(validity, uniq(codes), UNITS[id], origin);

function gaussSummary(value, sigma) {
  return Number.isFinite(sigma) ? { value, sigma, ci95: [value - 1.959964 * sigma, value + 1.959964 * sigma] } : { value, sigma: null, ci95: null };
}

/**
 * o: { fit (fit3d result), mc (mc.propagate result | null), carry (ballistics.carryEstimate | null),
 *      club (club.clubSpeed | null), fps, view = 'face_on', readout_source = 'assumed', lie = 'mat',
 *      tee_lift_source = 'measured', t_impact_guess?, extra_codes? (e.g. RC.TIMESTAMPS_NOMINAL) }
 * Returns { club_speed_mps, ball_speed_mps, launch_v_deg, launch_h_deg, carry_m, smash_factor } (Metric values).
 */
export function toMetrics(o) {
  const view = o.view ?? 'face_on';
  const fps = o.fps;
  const out = {};
  if (view !== 'face_on') {
    out.club_speed_mps = nul('club_speed_mps', 'not_observable', [RC.VIEW_DEPTH_AXIS], 'club_track');
    out.ball_speed_mps = nul('ball_speed_mps', 'not_observable', [RC.VIEW_DEPTH_AXIS], 'ball_fit3d');
    out.launch_v_deg = nul('launch_v_deg', 'not_observable', [RC.VIEW_DEPTH_AXIS], 'ball_fit3d');
    // high_behind #18 is produced by physics/launch_h.js (pipeline.analyzeHighBehind), not from a face_on fit
    out.launch_h_deg = view === 'dtl'
      ? nul('launch_h_deg', 'not_observable', [RC.LAUNCH_DIR_UNOBSERVABLE], 'ball_fit3d')
      : nul('launch_h_deg', 'not_computed', [RC.TRACK_TOO_SHORT], 'ball_fit3d');
    out.carry_m = nul('carry_m', 'not_observable', [RC.VIEW_DEPTH_AXIS, RC.DEPENDS_ON_NULL], 'ballistics');
    out.smash_factor = nul('smash_factor', 'not_observable', [RC.VIEW_DEPTH_AXIS, RC.DEPENDS_ON_NULL], 'derived');
    return out;
  }
  const shared = [...(o.extra_codes ?? [])];
  if ((o.readout_source ?? 'assumed') !== 'measured') shared.push(RC.ROLLING_SHUTTER_ASSUMED);
  const ballCodes = [...shared];
  if (o.lie === 'tee' && o.tee_lift_source === 'assumed') ballCodes.push(RC.TEE_LIFT_ASSUMED);
  const fit = o.fit;
  const lowFps = !fpsAtLeast(fps, BALL_MIN_FPS);

  // ---- 16, 17: ball speed and vertical launch
  let ballOk = false;
  let ballLow = false;
  if (lowFps) {
    out.ball_speed_mps = nul('ball_speed_mps', 'not_observable', [RC.FPS_TOO_LOW], 'ball_fit3d');
    out.launch_v_deg = nul('launch_v_deg', 'not_observable', [RC.FPS_TOO_LOW], 'ball_fit3d');
  } else if (!fit || !fit.ok) {
    const codes = fit?.flags?.length ? fit.flags : [RC.TRACK_TOO_SHORT];
    out.ball_speed_mps = nul('ball_speed_mps', 'not_computed', codes, 'ball_fit3d');
    out.launch_v_deg = nul('launch_v_deg', 'not_computed', codes, 'ball_fit3d');
  } else if (!ballPlausibility(fit, o.t_impact_guess ?? null).ok) {
    out.ball_speed_mps = nul('ball_speed_mps', 'implausible', [RC.IMPLAUSIBLE_VALUE], 'ball_fit3d');
    out.launch_v_deg = nul('launch_v_deg', 'implausible', [RC.IMPLAUSIBLE_VALUE], 'ball_fit3d');
  } else {
    const origin = fit.method === 'fit2d' ? 'ball_fit2d' : 'ball_fit3d';
    ballLow = fit.flags?.includes(RC.DEPTH_DRIFT_SUSPECT) ?? false;
    const codes = [...ballCodes, ...(fit.flags ?? [])];
    const validity = ballLow ? 'low_confidence' : 'estimated';
    const tf = fit.t_factor ?? 1;
    const bs = o.mc?.ball_speed ?? gaussSummary(fit.ball_speed_mps, fit.speed_sigma * tf);
    const lv = o.mc?.launch_v ?? gaussSummary(fit.launch_v_deg, fit.launch_sigma_deg * tf);
    out.ball_speed_mps = num('ball_speed_mps', fit.ball_speed_mps, bs.ci95, bs.sigma, validity, origin, codes);
    out.launch_v_deg = num('launch_v_deg', fit.launch_v_deg, lv.ci95, lv.sigma, validity, origin, codes);
    ballOk = true;
  }

  // ---- 18: horizontal launch direction — fit3d's ψ is internal only in this version (F2 #18)
  out.launch_h_deg = nul('launch_h_deg', 'not_observable', [RC.LAUNCH_DIR_UNOBSERVABLE], 'ball_fit3d');

  // ---- 19: carry (always estimated + SPIN_ASSUMED + WIND_IGNORED, KD9)
  if (lowFps) out.carry_m = nul('carry_m', 'not_observable', [RC.FPS_TOO_LOW], 'ballistics');
  else if (!ballOk || !o.carry || !o.carry.ok) out.carry_m = nul('carry_m', 'not_computed', [RC.DEPENDS_ON_NULL], 'ballistics');
  else {
    const c = o.carry;
    const codes = [RC.SPIN_ASSUMED, RC.WIND_IGNORED, ...ballCodes, ...(fit.flags ?? [])];
    out.carry_m = num('carry_m', c.value, c.ci95, c.sigma, 'estimated', 'ballistics', codes);
  }

  // ---- 14: club-head speed
  const club = o.club;
  let clubOk = false;
  let clubLow = false;
  if (!fpsAtLeast(fps, CLUB_MIN_FPS)) out.club_speed_mps = nul('club_speed_mps', 'not_observable', [RC.FPS_TOO_LOW], 'club_track');
  else if (!club || !club.ok) {
    const codes = club?.reason_codes?.length ? club.reason_codes : [RC.TRACK_TOO_SHORT];
    out.club_speed_mps = nul('club_speed_mps', club?.validity && club.validity !== 'estimated' ? club.validity : 'not_computed', codes, 'club_track');
  } else if (!isPlausible('club_speed_mps', club.club_speed_mps)) {
    out.club_speed_mps = nul('club_speed_mps', 'implausible', [RC.IMPLAUSIBLE_VALUE], 'club_track');
  } else {
    const cs = o.mc?.club_speed ?? gaussSummary(club.club_speed_mps, Math.hypot(club.sigma ?? 0,
      club.club_speed_mps * (club.depth_sys_frac ?? 0) / Math.sqrt(3), club.club_speed_mps * (club.lowfps_ci95_frac ?? 0) / 1.959964));
    clubLow = club.validity === 'low_confidence';
    out.club_speed_mps = num('club_speed_mps', club.club_speed_mps, cs.ci95, cs.sigma, club.validity, 'club_track', shared);
    clubOk = true;
  }

  // ---- 20: smash factor = ball / club
  if (lowFps) out.smash_factor = nul('smash_factor', 'not_observable', [RC.FPS_TOO_LOW], 'derived');
  else if (!ballOk || !clubOk) out.smash_factor = nul('smash_factor', 'not_computed', [RC.DEPENDS_ON_NULL], 'derived');
  else {
    const value = fit.ball_speed_mps / club.club_speed_mps;
    if (!isPlausible('smash_factor', value)) out.smash_factor = nul('smash_factor', 'implausible', [RC.IMPLAUSIBLE_VALUE], 'derived');
    else {
      let sm = o.mc?.smash;
      if (!sm) {
        const rb = (out.ball_speed_mps.sigma ?? 0) / fit.ball_speed_mps;
        const rc = (out.club_speed_mps.sigma ?? 0) / club.club_speed_mps;
        sm = gaussSummary(value, value * Math.hypot(rb, rc));
      }
      const codes = [...ballCodes, ...(fit.flags ?? [])];
      out.smash_factor = num('smash_factor', value, sm.ci95, sm.sigma, ballLow || clubLow ? 'low_confidence' : 'estimated', 'derived', codes);
    }
  }
  return out;
}

