// Complete synthetic shots for the end-to-end assembly (pipeline/assemble.js) and the M4 machine gate
// (scripts/synth_e2e.mjs, CAFCR R6 M4). Owner: integration-core. Deterministic given (seed, scenario, index).
//
// One shot = what the app would have after P1 + P3 + P5:
//   * true camera: the view's nominal geometry with setup errors (face_on: D 2.65–2.75 m, shift 0.35–0.45 m,
//     h 0.82–0.86 m, pitch ±1°, roll ±0.5°, yaw from the spec (M4: ±2°)), residual lens distortion (corner
//     fraction N(0, 1 %), never modelled by the estimator), rolling shutter (true readout ms and direction from the
//     spec; the direction follows screen.orientation, landscape-primary = +v, landscape-secondary = −v);
//   * calibration solved by calib/: f locked at P1 from three f-free mat solves with 1 px "magnifier" corners
//     (preset.fLockFromSolves), then the session pose from 4 mat corners with Gaussian noise (M4: 3 px), gravity
//     ±0.4°, readout measured (true + N(0, 0.2 ms)) or assumed 3 ms (physics/shutter.readoutModel, spec.readoutMode);
//   * PoseSeq: tests/synth/swing.js synthSwing seen through the same true camera (60 Hz, the P5 first pass);
//   * clip timestamps at the capture rate; the impact window (30 before / 60 after, pipeline/frames.js) is chosen
//     from the DETECTED impact event, as pipeline/clip.js would;
//   * ball frames: tests/synth/render.js renderClip in the analysis ROI (pipeline/frames.suggestBallRoi from the
//     ESTIMATED camera), with the true 3D flight (tests/synth/ballflight.js trueFlight: drag, Magnus, spin decay)
//     projected through the true camera at the rolling-shutter row time, exposure streak (1/1000–1/4000 s),
//     sensor noise, flicker, the resting ball before impact, a soft shadow and a white tee when teed;
//   * club: lie and the tee lift MEASURED with ±5 mm uniform error (P1), category from the launch angle.
//
//   m4Specs({ seed, quick }) -> { main, fps30, implausible, dtl, high_behind }   (plain JSON specs)
//   withAssumedReadout(input) -> the same input as the app ships it today (readout not measured: 3 ms assumed)
//   buildE2EShot(spec)       -> { input (for assembleShot), truth, build_ms }

import { BALL_R, DEG, RAD2DEG } from '../../app/src/geom/constants.js';
import { gauss, mulberry32, uniform } from '../../app/src/geom/rng.js';
import { nominalCamera, project, projectMany, eulerFromR } from '../../app/src/geom/camera.js';
import { matCorners, DEFAULT_VENUE } from '../../app/src/calib/mat.js';
import { solveMatPose, nominalF } from '../../app/src/calib/pnp.js';
import { fLockFromSolves } from '../../app/src/calib/preset.js';
import { calibrate } from '../../app/src/calib/ladder.js';
import { predictedBallWidthPx } from '../../app/src/calib/ballspot.js';
import { readoutModel, READOUT_MEASURED_SIGMA_MS } from '../../app/src/physics/shutter.js';
import { k1FromCornerFrac } from '../../app/src/physics/perturb.js';
import { SPIN_PRIORS } from '../../app/src/physics/ballistics.js';
import { detect } from '../../app/src/events/detect.js';
import { impactWindow, suggestBallRoi } from '../../app/src/pipeline/frames.js';
import { trueFlight, categoryForLaunch } from './ballflight.js';
import { renderClip } from './render.js';
import { synthSwing } from './swing.js';

const TAGS = { main: 1, fps30: 2, implausible: 3, dtl: 4, high_behind: 5, unit: 6, assumed: 8 };
const mix = (seed, tag, i) => (Math.imul(seed ^ 0x9e3779b9, 2654435761) ^ Math.imul(tag + 17, 40503) ^ Math.imul(i + 1, 2246822519)) >>> 0;

/**
 * Spec of one face_on ball shot drawn from the M4 distribution. o: { rng, i, fps = 240, speedRange = [30, 80],
 * launchRange = [5, 30], psiMax = 6, yawMax = 2, readoutRange = [0, 4], teeEvery = 3, liftRange = [0, 0.05],
 * liftErr = 0.005, cornerPx = 3, readoutMode = 'measured' }.
 * readoutMode 'measured': the calibration carries the true readout + N(0, READOUT_MEASURED_SIGMA_MS) with
 * readout_source 'measured' (the M4 device step measures it); 'assumed': the app's current default, 3 ms assumed.
 */
export function drawBallSpec(o) {
  const { rng } = o;
  const [s0, s1] = o.speedRange ?? [30, 80];
  const [l0, l1] = o.launchRange ?? [5, 30];
  const [r0, r1] = o.readoutRange ?? [0, 4];
  const speed = uniform(rng, s0, s1);
  const launch = uniform(rng, l0, l1);
  const psi = uniform(rng, -(o.psiMax ?? 6), o.psiMax ?? 6);
  const teed = o.i % (o.teeEvery ?? 3) === 0;
  const [h0, h1] = o.liftRange ?? [0, 0.05];
  const lift = teed ? uniform(rng, h0, h1) : 0;
  const le = o.liftErr ?? 0.005;
  const liftMeasured = teed ? Math.max(0, lift + uniform(rng, -le, le)) : 0;
  const category = categoryForLaunch(launch, teed);
  const pr = SPIN_PRIORS[category];
  return {
    view: 'face_on', fps: o.fps ?? 240, speed, launch, psi, teed, lift, liftMeasured, category,
    spin: Math.max(500, gauss(rng, pr.mean_rpm, pr.sigma_rpm)),
    yaw_deg: uniform(rng, -(o.yawMax ?? 2), o.yawMax ?? 2),
    readout_ms: uniform(rng, r0, r1), readout_dir: rng() < 0.5 ? 1 : -1,
    exposure_s: 1 / uniform(rng, 1000, 4000), cornerPx: o.cornerPx ?? 3, timeScale: 1,
    readoutMode: o.readoutMode ?? 'measured', readout_meas_err_ms: gauss(rng, 0, READOUT_MEASURED_SIGMA_MS),
  };
}

/** The M4 scenario sets. quick = a 12-shot main set (+ small side sets) for verify.sh smoke runs. */
export function m4Specs({ seed = 1, quick = false } = {}) {
  const set = (tag, n, fn) => {
    const rng = mulberry32(mix(seed, TAGS[tag], 0));
    return Array.from({ length: n }, (_, i) => ({ ...fn(rng, i), seed, scenario: tag, i }));
  };
  const nMain = quick ? 12 : 60;
  return {
    main: set('main', nMain, (rng, i) => drawBallSpec({ rng, i })),
    // 30 fps: the low-fps branch never reads frames (rows 16–20 are null by the registry); two shots carry rendered
    // frames anyway so the "frames present" path is exercised, the others skip the rendering to save time
    fps30: set('fps30', quick ? 3 : 6, (rng, i) => ({ ...drawBallSpec({ rng, i, fps: 30 }), render: i < 2 })),
    // implausible fits: a transcoded clip whose time base claims 4× the real rate (speeds ×4 → outside the
    // 10–90 m/s gate) and real flights launched steeper than the 45° gate
    implausible: set('implausible', quick ? 3 : 6, (rng, i) => (i % 2 === 0
      ? { ...drawBallSpec({ rng, i: 1 }), timeScale: 4 }
      : drawBallSpec({ rng, i: 1, launchRange: [50, 60], speedRange: [25, 40] }))),
    dtl: set('dtl', quick ? 2 : 6, (rng) => ({ view: 'dtl', fps: 60, cornerPx: 3, yaw_deg: uniform(rng, -1, 1), timeScale: 1 })),
    high_behind: set('high_behind', quick ? 2 : 6, (rng) => ({ view: 'high_behind', fps: 240, cornerPx: 3, yaw_deg: uniform(rng, -1, 1), timeScale: 1 })),
  };
}

/**
 * The same shot as calibrated without a readout measurement (the app's current default): camera readout 3 ms
 * for the orientation, readout_source 'assumed'. Everything else (mat solve, frames, pose) is unchanged.
 */
export function withAssumedReadout(input) {
  const c = input.calibration;
  const ro = readoutModel({ orientationType: input.capture.orientation, view: input.capture.view });
  const camera = { ...c.camera, readout: ro.readout };
  return { ...input, calibration: { ...c, camera, readout_ms: ro.readout.ms, readout_source: ro.source } };
}

/** True camera of a spec (view geometry + setup errors + residual distortion); exported for tests/synth/cells.js. */
export function trueCameraFor(spec, rng) {
  const view = spec.view;
  const orientation = view === 'dtl' ? 'portrait-primary' : spec.readout_dir === -1 ? 'landscape-secondary' : 'landscape-primary';
  const ro = readoutModel({ orientationType: orientation, view }).readout; // true axis/dir = the mapping's
  const readout = { ms: spec.readout_ms ?? 3, axis: ro.axis, dir: ro.dir };
  const geo = view === 'face_on'
    ? { D: uniform(rng, 2.65, 2.75), shift: uniform(rng, 0.35, 0.45), h: uniform(rng, 0.82, 0.86) }
    : view === 'dtl'
      ? { Db: uniform(rng, 3.0, 3.5), y: uniform(rng, 0.32, 0.38), h: uniform(rng, 0.97, 1.03) }
      : { Db: uniform(rng, 2.75, 3.0), y: uniform(rng, -0.15, 0.15), h: uniform(rng, 1.65, 1.75) };
  const ang = { yaw: (spec.yaw_deg ?? 0) * DEG, pitch: uniform(rng, -1, 1) * DEG, roll: uniform(rng, -0.5, 0.5) * DEG };
  let cam = nominalCamera(view, { ...geo, ...ang, readout });
  const cornerFrac = gauss(rng, 0, 0.01);
  cam = nominalCamera(view, { ...geo, ...ang, readout, k1: k1FromCornerFrac(cam, cornerFrac) });
  return { cam, orientation, geo, ang, cornerFrac };
}

function inBox(cam, u, v, m = 0.025) {
  return u >= m * cam.W && u <= (1 - m) * cam.W && v >= m * cam.H && v <= (1 - m) * cam.H;
}

/** P1 f lock + P3 mat solve through calib/. Returns { calibration, f_locked, f_lock }. */
/** exported for tests/synth/cells.js */
export function solveCalibration(camTrue, view, orientation, venue, rng, cornerPx, measuredMs) {
  const world = matCorners(venue);
  const { uv } = projectMany(camTrue, world);
  const truthC = [0, 1, 2, 3].map((k) => [uv[2 * k], uv[2 * k + 1]]);
  const noisy = (s) => truthC.map(([u, v]) => [u + gauss(rng, 0, s), v + gauss(rng, 0, s)]);
  const e = eulerFromR(camTrue.R, view);
  const gravity = () => ({ pitch_deg: e.pitch * RAD2DEG + gauss(rng, 0, 0.4), roll_deg: e.roll * RAD2DEG + gauss(rng, 0, 0.4), sigma_deg: 0.4 });
  const fs = [];
  for (let k = 0; k < 3; k++) {
    const s = solveMatPose({ corners: noisy(1), venue, view, W: camTrue.W, H: camTrue.H, f: nominalF(camTrue.W, camTrue.H), fLocked: false, cornerSource: 'manual', gravity: gravity(), formatCheck: false });
    if (s.ok) fs.push(s.f);
  }
  const lock = fLockFromSolves(fs);
  const fLocked = lock.ok ? lock.f_locked : lock.mean;
  const ro = readoutModel({ orientationType: orientation, view, ms: measuredMs, source: Number.isFinite(measuredMs) ? 'measured' : 'assumed' });
  const res = calibrate({ corners: noisy(cornerPx), gravity: gravity() }, {
    venue, view, W: camTrue.W, H: camTrue.H, f: fLocked, fLocked: true, cornerSource: cornerPx >= 2 ? 'auto' : 'manual',
    readout: ro.readout, source: 'clip', slope_deg: 0, readout_source: ro.source,
  });
  if (!res.ok) throw new Error(`e2e: calibration failed (${res.reason_codes.join(',')})`);
  return { calibration: res.calibration, f_locked: fLocked, f_lock: lock };
}

/** Readout row time of the ball image at frame time tF (fixed point; interfaces.md §2). */
function rowTime(cam, tF, imageAt) {
  const ro = cam.readout;
  let t = tF;
  for (let it = 0; it < 6; it++) {
    const p = imageAt(t);
    if (!Number.isFinite(p.u)) return t;
    const frac = ro.axis === 'u' ? p.u / cam.W : p.v / cam.H;
    t = tF + (ro.ms / 1000) * ro.dir * (frac - 0.5);
  }
  return t;
}

/** Ball frames of the impact window, rendered in the ROI. */
function renderBall({ camTrue, flight, start, tImp, times, win, roi, spec, rng, rest, rRest }) {
  const e = spec.exposure_s;
  const posAt = (t) => (t <= tImp ? start : flight.at(t - tImp).X);
  const frames = [];
  let impactLocal = 0;
  for (let k = win.start; k < win.end; k++) {
    const tF = times[k];
    const tRow = rowTime(camTrue, tF, (t) => project(camTrue, posAt(t - e / 2)));
    const ta = tRow - e;
    const tb = tRow;
    if (tb <= tImp) {
      frames.push({ u0: rest.u - roi.x, v0: rest.v - roi.y, u1: rest.u - roi.x, v1: rest.v - roi.y, r: rRest });
      impactLocal = k - win.start;
      continue;
    }
    const hold = Math.max(0, Math.min(1, (tImp - ta) / e));
    const pa = project(camTrue, posAt(Math.max(ta, tImp)));
    const Xb = posAt(tb);
    const pb = project(camTrue, Xb);
    if (!(pa.z > 0.2 && pb.z > 0.2)) { frames.push(null); continue; }
    const r = 0.5 * predictedBallWidthPx(camTrue, Xb);
    const out = (p) => p.u < roi.x - 3 * r - 20 || p.u > roi.x + roi.w + 3 * r + 20 || p.v < roi.y - 3 * r - 20 || p.v > roi.y + roi.h + 3 * r + 20;
    if (out(pa) && out(pb)) { frames.push(null); continue; }
    frames.push({ u0: pa.u - roi.x, v0: pa.v - roi.y, u1: pb.u - roi.x, v1: pb.v - roi.y, r, hold });
  }
  const liftPx = spec.teed && spec.lift > 0.002 ? (spec.lift * camTrue.f) / Math.max(0.5, project(camTrue, start).z) : 0;
  const clip = renderClip({
    W: roi.w, H: roi.h, nFrames: frames.length, fps: spec.fps, seed: (rng() * 0xffffffff) >>> 0,
    bg: { base: uniform(rng, 85, 120), amp: 1, lines: 2, grain: 2.5 },
    noise: 3, flicker: { gain: 0.01, offset: 1 }, psf: 0, // optics PSF off for speed: edges are area-antialiased, the streak is exposure-integrated
    ball: { level: uniform(rng, 215, 235), shade: 0.08, frames },
    tee: liftPx > 1 ? { len: liftPx, width: Math.max(2, 0.3 * rRest), level: 240, cap: 0 } : null,
    restPos: { u: rest.u - roi.x, v: rest.v - roi.y, r: rRest },
    shadow: { depth: 14, untilFrame: impactLocal },
    distractor: null, club: null,
  });
  return { frames: clip.frames, impactLocal };
}

/**
 * Build one shot. spec: from m4Specs / drawBallSpec ({ view, fps, seed, scenario, i, ... }); spec.render = false
 * skips the ball frames. Returns { input, truth, build_ms }.
 */
export function buildE2EShot(spec) {
  const T0 = performance.now();
  const rng = mulberry32(mix(spec.seed ?? 1, TAGS[spec.scenario] ?? 7, (spec.i ?? 0) + 1000));
  const view = spec.view;
  const venue = DEFAULT_VENUE;
  let tc;
  for (let tries = 0; tries < 50; tries++) {
    tc = trueCameraFor(spec, rng);
    const { uv } = projectMany(tc.cam, matCorners(venue));
    if ([0, 1, 2, 3].every((k) => inBox(tc.cam, uv[2 * k], uv[2 * k + 1]))) break;
  }
  const camTrue = tc.cam;
  const measuredMs = spec.readoutMode === 'measured' ? Math.max(0, camTrue.readout.ms + (spec.readout_meas_err_ms ?? 0)) : undefined;
  const { calibration, f_locked } = solveCalibration(camTrue, view, tc.orientation, venue, rng, spec.cornerPx ?? 3, measuredMs);

  // swing seen through the same true camera
  const cameraOpts = { ...tc.geo, ...tc.ang };
  const sw = synthSwing({ seed: (mix(spec.seed ?? 1, 11, spec.i ?? 0) % 100000) + 1, view, fps: 60, camJitter: false, cameraOpts });
  const fps = spec.fps;
  const tEnd = sw.model.times.tEnd;
  const nFrames = Math.floor(tEnd * fps) + 1;
  const trueTimes = Float64Array.from({ length: nFrames }, (_, k) => k / fps);
  const ts = spec.timeScale ?? 1;
  const claimed = Array.from(trueTimes, (t) => t / ts);
  const capture = {
    mode: fps >= 120 ? 'highspeed' : 'live', view, source: fps >= 120 ? 'import' : 'camera', orientation: tc.orientation,
    width: camTrue.W, height: camTrue.H, nominal_fps: fps * ts, effective_fps: fps * ts, vfr: false, timestamps: claimed,
  };
  const truth = {
    view, fps, yaw_deg: spec.yaw_deg, readout_ms: camTrue.readout.ms, readout_dir: camTrue.readout.dir,
    corner_frac: tc.cornerFrac, f_true: camTrue.f, f_locked, t_impact: sw.model.times.tI, events: sw.truth.events,
  };
  const ids = {
    shot_id: `e2e-${spec.scenario ?? 'x'}-${spec.i ?? 0}`, session_id: `e2e-session-${spec.seed ?? 1}`, venue_id: 'venue-e2e',
    preset_id: null, created_at: '2026-11-04T00:00:00Z', app_version: '0.0.0-e2e',
  };
  const input = {
    capture, calibration, venue, handedness: 'right', poseSeq: sw.poseSeq, events: null, audioOnset_t: sw.audioOnset_t,
    ids, warnings: [], seed: (spec.i ?? 0) + 1,
    club: { type: spec.category ?? 'iron_mid', lie: spec.teed ? 'tee' : 'mat', tee_lift_m: spec.liftMeasured ?? 0, tee_lift_source: 'measured' },
  };

  if (view === 'face_on' && spec.render !== false && Number.isFinite(spec.speed)) {
    const tImp = sw.model.times.tI;
    const start = [uniform(rng, -0.05, 0.05), uniform(rng, -0.05, 0.05), BALL_R + spec.lift];
    const flight = trueFlight({ speed_mps: spec.speed, launch_v_deg: spec.launch, psi_deg: spec.psi, spin_rpm: spec.spin, start, tMax: 0.6 });
    // the app's view of the setup: the ESTIMATED camera, the ball spot at the measured lift
    const camEst = calibration.camera;
    const Xe = [0, 0, BALL_R + (spec.liftMeasured ?? 0)];
    const pe = project(camEst, Xe);
    const pe1 = project(camEst, [0.3, 0, Xe[2] + 0.1]);
    const dl = Math.hypot(pe1.u - pe.u, pe1.v - pe.v);
    const wEst = predictedBallWidthPx(camEst, Xe);
    const teePx = spec.teed ? (Math.max(spec.liftMeasured, 0.01) * camEst.f) / Math.max(0.5, pe.z) : 0;
    // ROI margins wide enough for the ±5 cm placement around the spot
    const roi = suggestBallRoi({ W: camTrue.W, H: camTrue.H, rest: { u: pe.u, v: pe.v, w_px: wEst }, dir: [(pe1.u - pe.u) / dl, (pe1.v - pe.v) / dl], back_px: 6 * wEst, below_px: 3 * wEst, tee_px: teePx + 10 });
    // window from the detected impact (what clip.js does after the first pose pass)
    const ev = detect(sw.poseSeq, { view, handedness: 'right', audioOnset_t: sw.audioOnset_t });
    const tDet = Number.isFinite(ev.impact?.t_s) ? ev.impact.t_s : tImp;
    const win = impactWindow({ times: trueTimes, impact_t_s: tDet });
    const pRest = project(camTrue, start);
    const rest = { u: pRest.u, v: pRest.v };
    const rRest = 0.5 * predictedBallWidthPx(camTrue, start);
    const rb = renderBall({ camTrue, flight, start, tImp, times: trueTimes, win, roi, spec, rng, rest, rRest });
    input.ballFrames = {
      frames: rb.frames, times: Float64Array.from(claimed.slice(win.start, win.end)), W: roi.w, H: roi.h,
      origin: { u: roi.x, v: roi.y },
    };
    // setup (C7) detection of the resting ball: ±1.5 px, width from the estimated camera
    input.restBall = { u: rest.u + gauss(rng, 0, 1.5), v: rest.v + gauss(rng, 0, 1.5), w_px: wEst };
    const v0 = flight.v0;
    Object.assign(truth, {
      speed: Math.hypot(...v0), launch_v_deg: Math.atan2(v0[2], Math.hypot(v0[0], v0[1])) * RAD2DEG, psi_deg: spec.psi,
      lift: spec.lift, lift_measured: spec.liftMeasured, teed: spec.teed, spin_rpm: spec.spin, start, roi, window: win,
      impact_detected_t: tDet, exposure_s: spec.exposure_s, time_scale: ts,
    });
  }
  return { input, truth, build_ms: performance.now() - T0 };
}
