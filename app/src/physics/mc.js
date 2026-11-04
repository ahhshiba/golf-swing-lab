// Monte-Carlo propagation of the fit covariance plus the systematic terms to ci95 (CAFCR K5, K6, C1.1 球速合計).
//
// K6: systematic errors are NOT root-sum-squared as if they were independent random noise. Each draw samples ONE
// value of every systematic term and applies it coherently to everything it affects in that draw:
//   * calibration scale (f/D from the mat pose), mat-size scale and residual distortion multiply ball speed AND
//     club speed of the same draw, so they cancel in the smash factor;
//   * the readout-time residual Δms shifts ball speed, launch angle and club speed through their own per-shot
//     sensitivities (fit3d refit, club pixel velocity) with the same Δms;
//   * the tee-lift error Δlift moves the start point along the static-ball ray (fit3d refit sensitivity);
//   * residual lens distortion and camera roll are drawn in their physical units (corner distortion fraction,
//     degrees) and mapped through fit3d's per-shot refit sensitivities (physics/perturb.js modes) to speed AND
//     launch angle; the relative distortion effect is applied to the club speed of the same draw too.
//     Without those sensitivities (fit.sens missing) the fallbacks are: distortion = gaussian speed scale
//     distortion_sigma, roll = 1:1 on the launch angle (C1.1 滾轉 "6、17（1:1）").
// tests/synth/ballflight.js faceOnBatch({ inject }) injects errors drawn from these same distributions; the
// production coverage test (tests/unit/physics.accuracy.test.mjs) checks the ci95 against that data.
// The fit covariance (v0 block of the fit3d covariance) is drawn as a multivariate normal on top, widened by
// fit.t_factor (Student-t correction for the pixel-noise scale estimated from few residuals) and by
// depth_drift_inflate when the fit is flagged DEPTH_DRIFT_SUSPECT.
// Centre values are the point estimates; ci95 = [2.5, 97.5] percentiles of the draws (widened to contain the
// value); sigma = SD of the draws.

import { RAD2DEG, TEE_LIFT_PRIOR_SIGMA_M } from '../geom/constants.js';
import { cholesky } from '../geom/linalg.js';
import { gauss, uniform } from '../geom/rng.js';
import { percentile, std } from '../geom/stats.js';
import { RC } from '../contract/reason-codes.js';
import { READOUT_ASSUMED_HALFWIDTH_MS, READOUT_MEASURED_SIGMA_MS } from './shutter.js';

export const SYSTEMATICS_DEFAULTS = Object.freeze({
  /** 1σ relative f/D scale from the calibration pose (C1.1 "墊子 0.2–0.6 %", "f 鎖定 0.16–0.48 %"). */
  calib_scale_sigma: 0.003,
  /** Mat measured with a tape: ±3 mm / 1.5 m = ±0.2 %, uniform (C1.1 墊子尺寸). */
  mat_scale_halfwidth: 0.002,
  /** Residual radial lens distortion, 1σ, as the radial displacement fraction at the image corner (C1.1 畸變
   *  "殘差 0.5–1 %", upper end because UNVERIFIED). Through the fit3d sensitivity this is ≈ 0.2–0.5 % ball speed
   *  and ≈ 0.1–0.2° launch on the nominal face_on geometry (C1.1 states 0.3–0.5 % speed). */
  distortion_corner_sigma: 0.01,
  /** Fallback only (fit without sensitivities): residual distortion → ball speed, 1σ (C1.1 畸變 0.3–0.5 %). */
  distortion_sigma: 0.004,
  /** Camera roll error, 1σ in degrees (C1.1 滾轉: mat PnP σ 0.08–0.25°, midpoint); calibration pose_sigma.roll_deg
   *  replaces it when present. Moves the launch angle ≈ 1:1. */
  roll_sigma_deg: 0.15,
  /** 'assumed': true readout uniform in median ± readout_halfwidth_ms; 'measured': gaussian readout_sigma_ms. */
  readout_source: 'assumed',
  readout_halfwidth_ms: READOUT_ASSUMED_HALFWIDTH_MS,
  readout_sigma_ms: READOUT_MEASURED_SIGMA_MS,
  /** Ball lie and tee-lift provenance (C1.4): measured ±5 mm uniform, assumed 30 ± 15 mm gaussian. */
  lie: 'mat',
  tee_lift_source: 'measured',
  tee_measured_halfwidth_m: 0.005,
  tee_assumed_sigma_m: TEE_LIFT_PRIOR_SIGMA_M,
  /** DEPTH_DRIFT_SUSPECT: fit σ multiplied by this (C1.1 "並放大 σ"). */
  depth_drift_inflate: 2,
});

/**
 * Systematics config from a calibration object (interfaces §4) and a shot club ({ lie, tee_lift_source }).
 * calib_scale_sigma = pose_sigma.D_m / pose.D_m and roll_sigma_deg = pose_sigma.roll_deg when present.
 * overrides win.
 */
export function systematicsFrom({ calibration = null, club = null, overrides = null } = {}) {
  const s = { ...SYSTEMATICS_DEFAULTS };
  if (calibration) {
    if (calibration.readout_source) s.readout_source = calibration.readout_source;
    const D = calibration.pose?.D_m;
    const sD = calibration.pose_sigma?.D_m;
    if (Number.isFinite(D) && D > 0 && Number.isFinite(sD) && sD >= 0) s.calib_scale_sigma = sD / D;
    const sRoll = calibration.pose_sigma?.roll_deg;
    if (Number.isFinite(sRoll) && sRoll >= 0) s.roll_sigma_deg = sRoll;
  }
  if (club) {
    if (club.lie) s.lie = club.lie;
    if (club.tee_lift_source) s.tee_lift_source = club.tee_lift_source;
  }
  return overrides ? { ...s, ...overrides } : s;
}

function summary(value, draws) {
  if (value == null || !Number.isFinite(value)) return null;
  const lo = Math.min(percentile(draws, 2.5), value);
  const hi = Math.max(percentile(draws, 97.5), value);
  return { value, ci95: [lo, hi], sigma: std(draws) };
}

function cholOrDiag(C) {
  const L = cholesky(C);
  if (L) return L.map((r) => Array.from(r));
  return C.map((r, i) => r.map((_, j) => (i === j ? Math.sqrt(Math.max(C[i][i], 0)) : 0)));
}

/**
 * Propagate. o: { fit (fit3d result, ok), club (club.js result or null), systematics (see SYSTEMATICS_DEFAULTS),
 *   rng (geom/rng.js mulberry32), n = 2000 }.
 * Returns { n, ball_speed: {value, ci95, sigma}, launch_v: {…}, club_speed: {…}|null, smash: {…}|null,
 *   draws: { ball_speed, launch_v_deg, club_speed, smash } (Float64Array), systematics, codes } or null when the
 *   fit is not ok.
 */
export function propagate(o) {
  const fit = o.fit;
  if (!fit || !fit.ok || !fit.v_vec) return null;
  const rng = o.rng;
  if (typeof rng !== 'function') throw new TypeError('propagate: rng (seeded, geom/rng.js) is required');
  const S = { ...SYSTEMATICS_DEFAULTS, ...(o.systematics ?? {}) };
  const n = o.n ?? 2000;
  const v0 = fit.v_vec;
  const infl = (fit.flags?.includes(RC.DEPTH_DRIFT_SUSPECT) ? S.depth_drift_inflate : 1) * (fit.t_factor ?? 1);
  let Cv = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  if (fit.cov) Cv = [4, 5, 6].map((a) => [4, 5, 6].map((b) => fit.cov[a][b] * infl * infl));
  const L = cholOrDiag(Cv);
  const sens = fit.sens ?? { lift: { speed: 0, launch_deg: 0 }, readout: { speed: 0, launch_deg: 0 } };
  const sDist = sens.distortion && Number.isFinite(sens.distortion.speed) ? sens.distortion : null;
  const sRoll = sens.roll && Number.isFinite(sens.roll.launch_deg) ? sens.roll : null;
  const distRel = sDist ? sDist.speed / fit.ball_speed_mps : 0; // relative speed change per unit corner fraction
  const club = o.club && o.club.ok ? o.club : null;
  const bs = new Float64Array(n);
  const la = new Float64Array(n);
  const cs = club ? new Float64Array(n) : null;
  const sm = club ? new Float64Array(n) : null;
  const teed = S.lie === 'tee';
  const liftMeasured = S.tee_lift_source === 'measured';
  const roAssumed = S.readout_source !== 'measured';
  const lowSigma = club ? club.lowfps_ci95_frac / 1.959964 : 0;
  for (let i = 0; i < n; i++) {
    const z0 = gauss(rng), z1 = gauss(rng), z2 = gauss(rng);
    const vx = v0[0] + L[0][0] * z0;
    const vy = v0[1] + L[1][0] * z0 + L[1][1] * z1;
    const vz = v0[2] + L[2][0] * z0 + L[2][1] * z1 + L[2][2] * z2;
    const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
    const ang = Math.atan2(vz, Math.hypot(vx, vy)) * RAD2DEG;
    // one value of every systematic term per draw, shared by everything it affects
    const zd = gauss(rng); // distortion, standard normal (physical units below)
    const scale = (1 + gauss(rng, 0, S.calib_scale_sigma)) * (1 + uniform(rng, -S.mat_scale_halfwidth, S.mat_scale_halfwidth))
      * (sDist ? 1 : 1 + zd * S.distortion_sigma);
    const dd = zd * S.distortion_corner_sigma; // corner distortion fraction of this draw
    const droll = gauss(rng, 0, S.roll_sigma_deg);
    const dms = roAssumed ? uniform(rng, -S.readout_halfwidth_ms, S.readout_halfwidth_ms) : gauss(rng, 0, S.readout_sigma_ms);
    let dlift = 0;
    if (teed) dlift = liftMeasured ? uniform(rng, -S.tee_measured_halfwidth_m, S.tee_measured_halfwidth_m) : gauss(rng, 0, S.tee_assumed_sigma_m);
    let b = sp + sens.readout.speed * dms + sens.lift.speed * dlift;
    let a = ang + sens.readout.launch_deg * dms + sens.lift.launch_deg * dlift;
    if (sDist) { b += sDist.speed * dd; a += sDist.launch_deg * dd; }
    if (sRoll) { b += (sRoll.speed ?? 0) * droll; a += sRoll.launch_deg * droll; } else a += droll;
    bs[i] = b * scale;
    la[i] = a;
    if (club) {
      let c = club.club_speed_mps + gauss(rng, 0, club.sigma ?? 0);
      c *= 1 + (club.readout_frac_per_ms ?? 0) * dms;
      c *= 1 + distRel * dd; // same image region as the ball just before impact: same relative distortion effect
      c *= 1 + uniform(rng, -(club.depth_sys_frac ?? 0), club.depth_sys_frac ?? 0);
      if (lowSigma > 0) c *= 1 + gauss(rng, 0, lowSigma);
      c *= scale;
      cs[i] = c;
      sm[i] = c > 0 ? bs[i] / c : NaN;
    }
  }
  const smashValue = club && club.club_speed_mps > 0 ? fit.ball_speed_mps / club.club_speed_mps : null;
  return {
    n,
    ball_speed: summary(fit.ball_speed_mps, bs),
    launch_v: summary(fit.launch_v_deg, la),
    club_speed: club ? summary(club.club_speed_mps, cs) : null,
    smash: club && smashValue != null ? summary(smashValue, sm.filter(Number.isFinite)) : null,
    draws: { ball_speed: bs, launch_v_deg: la, club_speed: cs, smash: sm },
    systematics: S,
    inflated: fit.flags?.includes(RC.DEPTH_DRIFT_SUSPECT) ?? false,
    fit_inflation: infl,
  };
}

