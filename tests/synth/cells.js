// Synthetic scenarios for the F2 cells built by the "cells" owner (CAFCR F2 #14 face_on 30–60 fps, #15 and #18
// high_behind). Used by tests/unit/physics.cells.test.mjs and the synthetic-e2e gate (scripts/synth_e2e.mjs).
// Deterministic given (seed, i).
//
// high_behind (highBehindShot): true camera on the ball line (Db 2.75–3.0 m, side offset ±0.15 m, h 1.65–1.75 m,
// yaw ±1°, pitch ±1°, roll ±0.5° around "aimed at the ball", residual lens distortion N(0, 1 %) corner fraction,
// rolling shutter) -> calibration solved by calib/ from the four mat corners with 3 px Gaussian noise (f locked
// from three 1 px solves), exactly as tests/synth/e2e.js does for the M4 gate.
//   club head: tests/synth/ballflight.js simulateClubHead (circular arc, plane 50–65°, hub-to-head radius
//   1.3–1.8 m, attack −5…+3°, path −6…+6°, head centre at contact 4 cm behind the ball along x, 0.5–4 cm toward
//   the golfer and 0–5 cm above the ground (C1.3),
//   30–45 m/s, slows to 0.75 after contact) at 240 fps with a random sub-frame impact phase, 1.5 px centroid
//   noise (blurred head), detections before AND after impact. NOTE: track/club.js today only tracks the head
//   BEFORE impact; the post-impact samples model a tracker that follows it through (open issue for track/).
//   ball: simulateShot (drag, Magnus with the spin axis tilted ±20° = draw/fade curvature, spin decay,
//   blur-dependent centroid noise, dropouts) with ψ −8…+8°,
//   30–70 m/s, launch 10–30°, start within ±3 cm of the spot; the resting-ball pixel ±0.3 px.
// face_on pose club speed (clubSpeedSwing): tests/synth/swing.js synthSwing gives the whole body; its hands
// nearly stop at impact (built for events / pose metrics, not for hand speed), so the lead arm (shoulder ->
// elbow -> wrist, landmarks 11/13/15 and the lead hand points 17/19/21) is replaced near impact by a two-segment
// downswing model in the swing plane: arm angle with a peak angular velocity before impact that decays into
// impact, wrist cock released with a power law, so the head speed comes out of the kinematic chain (truth =
// numerical derivative of the head position at impact). Parameters are drawn so that peak lead-hand speed /
// impact head speed is 4.2–6.0, in the range reported for amateurs and pros (hand 7–10 m/s, head 32–48 m/s).

import { BALL_R, DEG } from '../../app/src/geom/constants.js';
import { gauss, mulberry32, uniform } from '../../app/src/geom/rng.js';
import { project } from '../../app/src/geom/camera.js';
import { DEFAULT_VENUE } from '../../app/src/calib/mat.js';
import { add3, sub3, scale3, normalize3, norm3 } from '../../app/src/geom/linalg.js';
import { trueCameraFor, solveCalibration } from './e2e.js';
import { simulateClubHead, simulateShot, staticBallPixel } from './ballflight.js';
import { synthSwing } from './swing.js';

const mix = (seed, tag, i) => (Math.imul(seed ^ 0x51ed270b, 2654435761) ^ Math.imul(tag + 101, 40503) ^ Math.imul(i + 1, 2246822519)) >>> 0;

/** One high_behind shot with known club path and launch direction. spec: { seed, i, cornerPx = 3, fps = 240 }. */
export function highBehindShot(spec) {
  const rng = mulberry32(mix(spec.seed ?? 1, 1, spec.i ?? 0));
  const fps = spec.fps ?? 240;
  const camSpec = { view: 'high_behind', yaw_deg: uniform(rng, -1, 1), readout_ms: uniform(rng, 2, 4), readout_dir: rng() < 0.5 ? 1 : -1 };
  const tc = trueCameraFor(camSpec, rng);
  const camTrue = tc.cam;
  const { calibration } = solveCalibration(camTrue, 'high_behind', tc.orientation, DEFAULT_VENUE, rng, spec.cornerPx ?? 3, undefined);
  const cam = calibration.camera;
  const tImp = 0.1 + uniform(rng, 0, 1 / fps);
  const pathDeg = uniform(rng, -6, 6);
  const start = [uniform(rng, -0.03, 0.03), uniform(rng, -0.03, 0.03), BALL_R];
  // head centre at contact 4 cm behind the ball centre along the path (ball radius + face-to-centre), 0–5 cm high
  const headZ = uniform(rng, 0, 0.05);
  const club = simulateClubHead({
    cam: camTrue, rng, fps, t_impact: tImp, speed_mps: uniform(rng, 30, 45), start: [start[0] - 0.04, start[1], headZ],
    radius_m: uniform(rng, 1.3, 1.8), plane_deg: uniform(rng, 50, 65), path_deg: pathDeg, attack_deg: uniform(rng, -5, 3),
    depth_m: uniform(rng, 0.005, 0.04), post_factor: 0.75, frames_before: 6, frames_after: 4, noise_px: 1.5,
  });
  const psi = uniform(rng, -8, 8);
  const shot = simulateShot({
    cam: camTrue, rng, fps, t_impact: tImp, speed_mps: uniform(rng, 30, 70), launch_v_deg: uniform(rng, 10, 30), psi_deg: psi,
    spin_rpm: uniform(rng, 2500, 8000), spin_axis_tilt_deg: uniform(rng, -20, 20), start, exposure_s: 1 / uniform(rng, 1000, 4000), dropout: 0.03, tMax: 0.25,
  });
  const px = staticBallPixel(camTrue, start, rng, 0.3);
  return {
    cam, camTrue, calibration, fps, clubObs: club.obs, ballObs: shot.obs, staticPx: px, orientation: tc.orientation,
    truth: { club_path_deg: pathDeg, launch_h_deg: psi, t_impact: tImp, start, side_offset_m: tc.geo.y, ball_n: shot.obs.length },
  };
}

/**
 * One face_on swing for the pose-based club speed. spec: { seed, i, fps (30 | 60), handedness = 'right' }.
 * Returns { poseSeq, calibration, events (truth), club: { length_m }, truth: { club_speed_mps, hand_peak_mps } }.
 */
export function clubSpeedSwing(spec) {
  const rng = mulberry32(mix(spec.seed ?? 1, 2, spec.i ?? 0));
  const fps = spec.fps ?? 60;
  const sw = synthSwing({ seed: 1000 + (spec.i ?? 0) + 97 * (spec.seed ?? 1), view: 'face_on', fps, handedness: spec.handedness ?? 'right' });
  const M = sw.model;
  const tI = M.times.tI;
  const lm = (t, j) => { const L = M.landmarks(t); return [L[3 * j], L[3 * j + 1], L[3 * j + 2]]; };
  // arm length = the golfer's own shoulder–wrist distance at address
  const shA = lm(M.times.tA, 11);
  const r = norm3(sub3(lm(M.times.tA, 15), shA));
  const clubLen = uniform(rng, 0.89, 1.15);
  const Lwh = clubLen; // lead wrist to head centre (≈ club length, see physics/clubspeed_pose.js)
  // swing plane through the impact shoulder and the ball; e2 = hub -> ball (down the plane), e1 = target direction
  const hubI = lm(tI, 11);
  const ballP = [0, 0.02, 0.02];
  const e2 = normalize3(sub3(ballP, hubI));
  let e1 = sub3([1, 0, 0], scale3(e2, e2[0]));
  e1 = normalize3(e1);
  // kinematics (τ = t − tI): arm angle φ(τ) (rad, 0 = pointing at the ball, negative before impact = behind),
  // angular velocity ω(τ) = ωp·[ρ + (1 − ρ)·exp(−((τ − τp)/w)²)] for τ ≤ τp side shaping; wrist cock β(τ)
  const wPeak = uniform(rng, 14, 19); // rad/s peak lead-arm angular velocity
  const rho = uniform(rng, 0.55, 0.8); // ω(impact)/ω(peak)
  const tauP = -uniform(rng, 0.03, 0.06);
  const wid = uniform(rng, 0.05, 0.08);
  const omega = (tau) => wPeak * (tau >= tauP ? rho + (1 - rho) * Math.exp(-(((tau - tauP) / (-tauP)) ** 2) * 2.5) : Math.exp(-(((tau - tauP) / wid) ** 2)) * 0.8 + 0.2);
  // φ(τ) = ∫_0^τ ω  (numerical, coarse table)
  // integrate backwards and forwards from τ = 0
  const dtab = 0.0005;
  const N = 400;
  const phiAt = new Float64Array(2 * N + 1);
  for (let k = 1; k <= N; k++) phiAt[N - k] = phiAt[N - k + 1] - dtab * omega(-(k - 0.5) * dtab);
  for (let k = 1; k <= N; k++) phiAt[N + k] = phiAt[N + k - 1] + dtab * omega((k - 0.5) * dtab);
  const phiOf = (tau) => {
    const x = tau / dtab + N;
    const k = Math.max(0, Math.min(2 * N - 1, Math.floor(x)));
    const f = x - k;
    return phiAt[k] * (1 - f) + phiAt[k + 1] * f;
  };
  // wrist release: β(τ) = −β0·(1 − s^m), s = (τ − τR)/(−τR), so β'(0) = β0·m/(−τR); the release rate at impact
  // relative to the peak arm rate, β'(0)/ωp ∈ [1.2, 1.9], sets the head / peak-hand ratio (4.2–6.0)
  const mexp = uniform(rng, 1.6, 2.4);
  const beta0 = uniform(rng, 80, 95) * DEG;
  const tauR = -(beta0 * mexp) / (uniform(rng, 1.2, 1.9) * wPeak); // release start
  const betaOf = (tau) => {
    if (tau <= tauR) return -beta0;
    const s = (tau - tauR) / -tauR;
    if (tau <= 0) return -beta0 * (1 - s ** mexp);
    return beta0 * mexp * s - beta0 * mexp; // τ > 0: constant release rate (head passes the hands)
  };
  const dirAt = (ang) => add3(scale3(e2, Math.cos(ang)), scale3(e1, Math.sin(ang)));
  const winA = -0.2;
  const winB = 0.08;
  const blend = (tau) => (tau < winA ? 0 : tau < winA + 0.05 ? (tau - winA) / 0.05 : tau < winB - 0.03 ? 1 : tau < winB ? (winB - tau) / 0.03 : 0);
  const model = (t) => {
    const tau = t - tI;
    const hub = lm(t, 11);
    const ph = phiOf(tau);
    const wrist = add3(hub, scale3(dirAt(ph), r));
    const head = add3(wrist, scale3(dirAt(ph + betaOf(tau)), Lwh));
    return { wrist, head, hub };
  };
  const headAt = (t) => model(t).head;
  const h = 1e-4;
  const a = headAt(tI - h), b = headAt(tI + h);
  const headSpeed = norm3(sub3(b, a)) / (2 * h);
  let handPeak = 0;
  for (let tau = -0.12; tau <= 0.02; tau += 0.001) {
    const p = model(tI + tau - h).wrist, q = model(tI + tau + h).wrist;
    handPeak = Math.max(handPeak, norm3(sub3(q, p)) / (2 * h));
  }
  // overwrite the lead-arm image landmarks around impact (same camera, same pixel-noise model as synthSwing)
  const cam = sw.camera;
  const ps = sw.poseSeq;
  const nrng = mulberry32(mix(spec.seed ?? 1, 3, spec.i ?? 0));
  const mirror = (spec.handedness ?? 'right') === 'left';
  const W = ps.W, H = ps.H;
  let prevU = null;
  for (let i = 0; i < ps.t_s.length; i++) {
    const t = ps.t_s[i];
    const wgt = blend(t - tI);
    if (wgt <= 0) { prevU = null; continue; }
    const m = model(t);
    const orig = lm(t, 15);
    const wrist = add3(scale3(m.wrist, wgt), scale3(orig, 1 - wgt));
    const elbow = add3(m.hub, scale3(sub3(wrist, m.hub), 0.52));
    const shaft = normalize3(sub3(m.head, m.wrist));
    const pts = { 13: elbow, 15: wrist, 17: add3(wrist, scale3(shaft, 0.06)), 19: add3(wrist, scale3(shaft, 0.07)), 21: add3(wrist, scale3(shaft, 0.04)) };
    for (const [jStr, X] of Object.entries(pts)) {
      const j = Number(jStr);
      const jp = mirror ? j + 1 : j; // lead side of a left-hander is the right side (even index)
      const pr = project(cam, mirror ? [X[0], -X[1], X[2]] : X);
      let s = 2.0;
      if (j === 15 && prevU) s = Math.hypot(s, Math.min(10, 0.1 * Math.hypot(pr.u - prevU[0], pr.v - prevU[1])));
      const q = (i * 33 + jp) * 4;
      ps.img[q] = (pr.u + gauss(nrng, 0, s)) / W;
      ps.img[q + 1] = (pr.v + gauss(nrng, 0, s)) / H;
      if (j === 15) prevU = [pr.u, pr.v];
    }
  }
  const events = {};
  for (const [name, e] of Object.entries(sw.truth.events)) events[name] = e ? { frame: e.frame, t_s: e.t_s, conf: 1, source: 'manual' } : null;
  return {
    poseSeq: ps, calibration: sw.calibration, events, fps, handedness: spec.handedness ?? 'right', club: { length_m: clubLen },
    truth: { club_speed_mps: headSpeed, hand_peak_mps: handPeak, ratio: headSpeed / handPeak, arm_m: r, club_length_m: clubLen },
  };
}


const IDS = (tag, i, seed) => ({
  shot_id: `cells-${tag}-${i}`, session_id: `cells-session-${seed}`, venue_id: 'venue-cells', preset_id: null,
  created_at: '2026-11-04T00:00:00Z', app_version: '0.0.0-cells',
});

/**
 * assembleShot input for a high_behind shot: the 2D tracking is replaced by the synthetic observations (the `track`
 * input of pipeline/assemble.js: restBall = the resting-ball pixel, ballTrack, clubTrack); no pose (pose rows null).
 */
export function highBehindInput(s, spec = {}) {
  const fps = s.fps;
  const rest = { u: s.staticPx.u, v: s.staticPx.v, w_px: 20, r_px: 10, lie: 'mat', lie_conf: 1, refined: true };
  return {
    capture: {
      mode: 'highspeed', view: 'high_behind', source: 'import', orientation: s.orientation, width: s.cam.W, height: s.cam.H,
      nominal_fps: fps, effective_fps: fps, vfr: false, timestamps: 'container',
    },
    calibration: s.calibration, venue: DEFAULT_VENUE, handedness: 'right', poseSeq: null, events: null,
    club: { type: 'iron_mid', lie: 'mat', tee_lift_m: 0, tee_lift_source: 'measured' },
    track: { restBall: rest, ballTrack: { obs: s.ballObs, gaps: 0, n: s.ballObs.length }, clubTrack: s.clubObs, reason_codes: [], info: {} },
    ids: IDS('hb', spec.i ?? 0, spec.seed ?? 1), warnings: [], seed: (spec.i ?? 0) + 1,
  };
}

/** assembleShot input for a face_on live-rate swing (events detected by the pipeline from the pose). */
export function clubSpeedInput(c, spec = {}) {
  return {
    capture: {
      mode: 'live', view: 'face_on', source: 'camera', orientation: 'landscape-primary', width: c.poseSeq.W, height: c.poseSeq.H,
      nominal_fps: c.fps, effective_fps: c.fps, vfr: false, timestamps: 'container',
    },
    calibration: c.calibration, venue: DEFAULT_VENUE, handedness: c.handedness, poseSeq: c.poseSeq, events: null,
    club: { type: 'driver', lie: 'tee', tee_lift_m: 0.03, tee_lift_source: 'measured', length_m: c.club.length_m },
    ids: IDS('cs', spec.i ?? 0, spec.seed ?? 1), warnings: [], seed: (spec.i ?? 0) + 1,
  };
}

/** The gate scenario sets (scripts/synth_e2e.mjs): 30 high_behind shots, 30 face_on swings (15 at 30, 15 at 60 fps). */
export function cellsSpecs({ seed = 1, quick = false } = {}) {
  const n = quick ? 10 : 30;
  return {
    cells_hb: Array.from({ length: n }, (_, i) => ({ kind: 'cells_hb', seed, i })),
    cells_cs: Array.from({ length: n }, (_, i) => ({ kind: 'cells_cs', seed, i, fps: i % 2 === 0 ? 30 : 60 })),
  };
}
