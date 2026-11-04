// Horizontal launch direction from the high_behind view (CAFCR F2 #18: high_behind 低 at ≥ 200 fps; face_on stays
// not_observable, its fit3d ψ is internal only).
//
// Model. The camera sits on the ball line behind the ball, so the ball flies away from it and rises: a
// ground-plane projection of the ball track would mix height into distance. Instead the full 3D flight is fitted
// with the fit3d machinery (physics/fit3d.js: known start from the resting-ball ray ∩ ball-centre height, free
// launch velocity v0 and impact time t0, gravity + drag/lift priors, rolling-shutter times, apparent ball size).
// From behind, the lateral image drift pins the azimuth of the ball relative to the camera while speed and
// vertical launch are coupled through depth (both weakly determined, not reported from this view: F2 #16/#17 are
// 不可 here). ψ = atan2(−v_y, v_x) in the canonical frame (left-handed: y mirrored), + = away from the golfer
// (right of target for a right-hander, toward −y); this matches the sign of club_path_deg (+ in-to-out).
// The plane initialisation of fit3d is degenerate for this camera (the plane y = start.y contains the camera),
// so the fit is started from a small grid of launch velocities (INIT_SPEEDS × INIT_LAUNCH_V, ψ = 0) and the start
// with the lowest χ² is kept.
// Uncertainty (1σ, root-sum-square of independent terms): fit covariance (v0 block, linearised, × Student-t
// factor) ⊕ calibration: the ground-direction σ of the mat solve (physics/ground.js groundCalibSigmas, 1:1 on ψ as
// a yaw about the ball spot; it already contains the roll/heading coupling of the solve: in the synthetic gate the
// calibration-induced ψ error has SD 0.27° against a ground σ of 0.27°, while adding a separate roll term from
// pose_sigma.roll_deg doubled it) ⊕ LAUNCH_H_MODEL_SIGMA_DEG (side-spin curvature over the first ~0.05 s — the
// gate flies spin axes tilted ±20° and the true-camera fit error stays at SD 0.09° —, start-point placement;
// UNVERIFIED on real clips). ci95 = value ± 1.96σ. Validity low_confidence always (F2).

import { DEG, RAD2DEG } from '../geom/constants.js';
import { RC } from '../contract/reason-codes.js';
import { fit3d, FIT3D_DEFAULTS } from './fit3d.js';
import { MIN_TRACK_OBS } from './fit2d.js';
import { observationTimes } from './shutter.js';
import { ballPlausibility } from './plausibility.js';
import { BALL_MIN_FPS } from './result.js';
import { groundCalibSigmas } from './ground.js';
import { fpsAtLeast } from '../geom/constants.js';

export const INIT_SPEEDS_MPS = Object.freeze([35, 55, 75]);
export const INIT_LAUNCH_V_DEG = Object.freeze([10, 20, 30]);
export const LAUNCH_H_MODEL_SIGMA_DEG = 0.15;
export const LAUNCH_H_MAX_ABS_DEG = 30;

function nullLaunch(validity, codes, extra = {}) {
  return { ok: false, launch_h_deg: null, sigma: null, ci95: null, validity, reason_codes: codes, value_origin: 'ball_fit3d', ...extra };
}

function psiOf(v, mirror) {
  const vy = mirror ? -v[1] : v[1];
  return Math.atan2(-vy, v[0]) * RAD2DEG;
}

function cost(fit) {
  const r = fit?.lm?.reducedChi2;
  return Number.isFinite(r) ? r : Infinity;
}

/**
 * o: { cam (calibrated), obs (ball observations, interfaces §4), start (fit3d.startFromStaticBall result), fps,
 *   club?, t_impact_guess?, calibration? (pose_sigma, readout_source), venue? (mat size), handedness = 'right' }.
 * Returns { ok, launch_h_deg, sigma, ci95, validity: 'low_confidence', reason_codes, value_origin: 'ball_fit3d',
 *   fit, terms: { fit, calib, model } (deg) } or a null result (FPS_TOO_LOW / TRACK_TOO_SHORT / IMPLAUSIBLE_VALUE).
 */
export function launchHighBehind(o) {
  if (!fpsAtLeast(o.fps, BALL_MIN_FPS)) return nullLaunch('not_observable', [RC.FPS_TOO_LOW]);
  const cam = o.cam;
  const obs = (o.obs ?? []).filter((q) => Number.isFinite(q.u) && Number.isFinite(q.v) && Number.isFinite(q.t_s));
  if (obs.length < MIN_TRACK_OBS || !o.start) return nullLaunch('not_computed', [RC.TRACK_TOO_SHORT], { n_obs: obs.length });
  const mirror = o.handedness === 'left';
  const times = observationTimes(obs, cam);
  const tFirst = Math.min(...times);
  const t0g = Number.isFinite(o.t_impact_guess) && o.t_impact_guess < tFirst ? o.t_impact_guess : tFirst - 0.5 / o.fps;
  const base = { cam, obs, start: o.start, t_impact_guess: o.t_impact_guess, fps: o.fps, club: o.club ?? null, sensitivities: false };
  let best = null;
  for (const s of INIT_SPEEDS_MPS) {
    for (const lv of INIT_LAUNCH_V_DEG) {
      const v0 = [s * Math.cos(lv * DEG), 0, s * Math.sin(lv * DEG)];
      const f = fit3d({ ...base, init: { v0, t0: t0g } });
      if (f.ok && (best === null || cost(f) < cost(best))) best = f;
    }
  }
  if (!best) return nullLaunch('not_computed', [RC.TRACK_TOO_SHORT], { n_obs: obs.length });
  const fit = best;
  if (!ballPlausibility(fit, o.t_impact_guess ?? null).ok) return nullLaunch('implausible', [RC.IMPLAUSIBLE_VALUE], { fit });
  const value = psiOf(fit.v_vec, mirror);
  if (!(Math.abs(value) <= LAUNCH_H_MAX_ABS_DEG)) return nullLaunch('implausible', [RC.IMPLAUSIBLE_VALUE], { fit });

  // fit term: linearised ψ variance from the v0 covariance block
  const [vx, vy] = fit.v_vec;
  const h2 = vx * vx + vy * vy;
  const g = [vy / h2, -vx / h2]; // ∂ψ/∂(vx, vy) for ψ = atan2(−vy, vx) (mirroring flips the sign only)
  let sFit = NaN;
  if (fit.cov) {
    const C = fit.cov;
    const q = g[0] * g[0] * C[4][4] + 2 * g[0] * g[1] * C[4][5] + g[1] * g[1] * C[5][5];
    sFit = Math.sqrt(Math.max(q, 0)) * RAD2DEG * (fit.t_factor ?? 1);
  }
  if (!Number.isFinite(sFit)) sFit = 2;
  const cs = groundCalibSigmas(cam, o.calibration, o.venue);
  const terms = { fit: sFit, calib: cs.yaw_deg, model: LAUNCH_H_MODEL_SIGMA_DEG };
  const sigma = Math.hypot(terms.fit, terms.calib, terms.model);
  const codes = [];
  if ((o.calibration?.readout_source ?? 'assumed') !== 'measured') codes.push(RC.ROLLING_SHUTTER_ASSUMED);
  if (fit.residual_rmse_px > FIT3D_DEFAULTS.depthDriftRmsePx) codes.push(RC.DEPTH_DRIFT_SUSPECT);
  return {
    ok: true,
    launch_h_deg: value,
    sigma,
    ci95: [value - 1.959964 * sigma, value + 1.959964 * sigma],
    validity: 'low_confidence',
    reason_codes: codes,
    value_origin: 'ball_fit3d',
    fit,
    terms,
  };
}
