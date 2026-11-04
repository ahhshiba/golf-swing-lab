// Synthetic ball flight and club-head tracks for physics tests and the M4 synthetic gate (owner: physics).
//
// Truth: RK4 3D flight with drag, Magnus lift and spin decay (default coefficients: app/src/physics/aero.js;
// pass `aero` to use another model), integrated on a fine grid and interpolated with cubic Hermite.
// Camera: a geom camera with rolling shutter (readout { ms, axis, dir }). For each frame the readout time of the
// row/column through the ball centroid is solved by fixed-point iteration; the row integrates light over the
// exposure [t_row − e, t_row], so the centroid is the mean position over that window (a constant e/2 time offset
// that a free t0 absorbs). Blur, apparent size (exact sphere tangents), Gaussian centroid noise (larger along the
// streak), random dropouts, optional gross outliers and the club-head occlusion of the first few centimetres are
// simulated. Everything random comes from the seeded rng passed in (geom/rng.js).

import { BALL_R, DEG, G } from '../../app/src/geom/constants.js';
import { nominalCamera, project, toCamera } from '../../app/src/geom/camera.js';
import { gauss, mulberry32, uniform } from '../../app/src/geom/rng.js';
import { AERO_MODEL, K_AERO, RPM_TO_RAD_S, aeroCoefficients, backspinAxis } from '../../app/src/physics/aero.js';
import { k1FromCornerFrac, rollAboutPoint, scaleAboutPoint, withK1 } from '../../app/src/physics/perturb.js';
import { READOUT_MEDIAN_MS } from '../../app/src/physics/shutter.js';

/** Launch velocity (+ψ toward −y, i.e. right of target for a right-hander, toward the face_on camera). */
export function launchVelocity(speed, launchVDeg, psiDeg = 0) {
  const th = launchVDeg * DEG;
  const ps = psiDeg * DEG;
  return [speed * Math.cos(th) * Math.cos(ps), -speed * Math.cos(th) * Math.sin(ps), speed * Math.sin(th)];
}

/**
 * True flight. o: { speed_mps, launch_v_deg, psi_deg = 0, spin_rpm = 0, start = [0, 0, BALL_R], aero, dt = 1e-4,
 * tMax = 0.4, decay = AERO_MODEL.SPIN_DECAY_R1, spin_axis_tilt_deg = 0 }. Returns { at(τ) -> { X, V } (τ ≤ 0: resting at start), v0, start }.
 */
export function trueFlight(o) {
  const aero = o.aero ?? aeroCoefficients;
  const start = o.start ?? [0, 0, BALL_R];
  const v0 = launchVelocity(o.speed_mps, o.launch_v_deg, o.psi_deg ?? 0);
  // spin_axis_tilt_deg (default 0): the backspin axis tilted about the horizontal flight direction, which adds a
  // sideways Magnus force (draw / fade curvature); tests/synth/cells.js uses it for the launch-direction gate
  const tilt = (o.spin_axis_tilt_deg ?? 0) * DEG;
  const w0 = backspinAxis(v0);
  const w = tilt ? [w0[0] * Math.cos(tilt), w0[1] * Math.cos(tilt), -Math.sin(tilt)] : w0;
  const dt = o.dt ?? 1e-4;
  const tMax = o.tMax ?? 0.4;
  const decay = o.decay ?? AERO_MODEL.SPIN_DECAY_R1;
  const N = Math.ceil(tMax / dt) + 1;
  const X = new Float64Array(3 * N);
  const V = new Float64Array(3 * N);
  const f = (s, out) => {
    const sp = Math.hypot(s[3], s[4], s[5]);
    const S = sp > 0 ? (s[6] * BALL_R) / sp : 0;
    const { cd, cl } = aero(S);
    const kd = K_AERO * cd * sp;
    const kl = K_AERO * cl * sp;
    const cx = w[1] * s[5] - w[2] * s[4];
    const cy = w[2] * s[3] - w[0] * s[5];
    const cz = w[0] * s[4] - w[1] * s[3];
    out[0] = s[3]; out[1] = s[4]; out[2] = s[5];
    out[3] = -kd * s[3] + kl * cx;
    out[4] = -kd * s[4] + kl * cy;
    out[5] = -G - kd * s[5] + kl * cz;
    out[6] = (-decay * s[6] * sp) / BALL_R;
  };
  let s = [start[0], start[1], start[2], v0[0], v0[1], v0[2], (o.spin_rpm ?? 0) * RPM_TO_RAD_S];
  const k1 = new Array(7), k2 = new Array(7), k3 = new Array(7), k4 = new Array(7);
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < 3; k++) { X[3 * i + k] = s[k]; V[3 * i + k] = s[3 + k]; }
    f(s, k1);
    f(s.map((q, j) => q + 0.5 * dt * k1[j]), k2);
    f(s.map((q, j) => q + 0.5 * dt * k2[j]), k3);
    f(s.map((q, j) => q + dt * k3[j]), k4);
    s = s.map((q, j) => q + (dt / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
  }
  const at = (tau) => {
    if (!(tau > 0)) return { X: [...start], V: [0, 0, 0] };
    const q = Math.min(tau / dt, N - 1.000001);
    const i = Math.floor(q);
    const h = q - i;
    const Xo = [0, 0, 0];
    const Vo = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const p0 = X[3 * i + k], p1 = X[3 * (i + 1) + k];
      const m0 = V[3 * i + k] * dt, m1 = V[3 * (i + 1) + k] * dt;
      const h2 = h * h, h3 = h2 * h;
      Xo[k] = (2 * h3 - 3 * h2 + 1) * p0 + (h3 - 2 * h2 + h) * m0 + (-2 * h3 + 3 * h2) * p1 + (h3 - h2) * m1;
      Vo[k] = V[3 * i + k] + h * (V[3 * (i + 1) + k] - V[3 * i + k]);
    }
    return { X: Xo, V: Vo };
  };
  return { at, v0, start };
}

/** Exact horizontal / vertical image extent (px) of the ball at camera-frame point Xc. */
function extent(f, Xc) {
  const [x, y, z] = Xc;
  const R = BALL_R;
  const den = z * z - R * R;
  return {
    w: (2 * f * R * Math.sqrt(x * x + z * z - R * R)) / den,
    h: (2 * f * R * Math.sqrt(y * y + z * z - R * R)) / den,
  };
}

/** Readout time of the row/column through the image point of posAt(t) (fixed-point iteration). */
function rowTime(cam, tFrame, imageAt) {
  const ro = cam.readout ?? { ms: 0, axis: 'v', dir: 1 };
  let t = tFrame;
  for (let it = 0; it < 8; it++) {
    const p = imageAt(t);
    if (!Number.isFinite(p.u)) return t;
    const frac = ro.axis === 'u' ? p.u / cam.W : p.v / cam.H;
    t = tFrame + (ro.ms / 1000) * ro.dir * (frac - 0.5);
  }
  return t;
}

/**
 * Simulated ball track. o: {
 *   cam (true camera, with readout), speed_mps, launch_v_deg, psi_deg = 0, spin_rpm, start = [0, 0, BALL_R],
 *   fps = 240, t_impact = 0.05, exposure_s = 1/2000, noise_px = 0.5, noise_along_per_px = 0.02,
 *   width_noise = 0.04, dropout = 0.03, outlier_p = 0, outlier_px = [8, 15], occlude_m = 0.05, margin = 0.025,
 *   tMax = 0.4, rng, aero? }
 * Returns { obs: [{ frame, t_s, u, v, w_px, h_px, r_px, area, peak }] (interfaces §4 Observation),
 *   frames: [{ frame, t_row, X, blur_px, u_true, v_true }] (truth per detection), truth: { v0, speed, launch_v_deg,
 *   psi_deg, t_impact, start }, flight, n_visible }.
 */
export function simulateShot(o) {
  const rng = o.rng;
  const cam = o.cam;
  const fps = o.fps ?? 240;
  const tImp = o.t_impact ?? 0.05;
  const e = o.exposure_s ?? 1 / 2000;
  const margin = o.margin ?? 0.025;
  const start = o.start ?? [0, 0, BALL_R];
  const tMax = o.tMax ?? 0.4;
  const fl = trueFlight({ ...o, start, tMax: tMax + 0.01 });
  const posAt = (t) => fl.at(t - tImp).X;
  const meanPos = (t) => {
    // centroid of the streak = mean position over the exposure window [t − e, t]
    const a = posAt(t - e);
    const b = posAt(t - e / 2);
    const c = posAt(t);
    return [0, 1, 2].map((k) => (a[k] + 4 * b[k] + c[k]) / 6);
  };
  const obs = [];
  const frames = []; // per-detection truth: readout time, true mean position, blur length (px)
  let nVisible = 0;
  const k0 = Math.max(0, Math.floor(tImp * fps) - 1);
  for (let k = k0; k / fps <= tImp + tMax; k++) {
    const tF = k / fps;
    const tRow = rowTime(cam, tF, (t) => project(cam, meanPos(t)));
    if (!(tRow - e / 2 > tImp)) continue; // ball still at rest (static frames are not part of the flight track)
    const Xm = meanPos(tRow);
    const p = project(cam, Xm);
    if (!(p.z > 0.1)) break;
    const inside = p.u >= margin * cam.W && p.u <= (1 - margin) * cam.W && p.v >= margin * cam.H && p.v <= (1 - margin) * cam.H;
    if (!inside) {
      if (obs.length > 0 || nVisible > 0 || tRow - tImp > 0.05) break;
      continue;
    }
    nVisible++;
    const d0 = Math.hypot(Xm[0] - start[0], Xm[1] - start[1], Xm[2] - start[2]);
    if (d0 < (o.occlude_m ?? 0.05)) continue;
    if (rng() < (o.dropout ?? 0.03)) continue;
    const pa = project(cam, posAt(tRow - e));
    const pb = project(cam, posAt(tRow));
    const du = pb.u - pa.u;
    const dv = pb.v - pa.v;
    const L = Math.hypot(du, dv);
    const ext = extent(cam.f, toCamera(cam, Xm));
    const mx = L > 1e-9 ? du / L : 1;
    const my = L > 1e-9 ? dv / L : 0;
    const sPerp = o.noise_px ?? 0.5;
    const sAlong = sPerp + (o.noise_along_per_px ?? 0.02) * L;
    const na = gauss(rng, 0, sAlong);
    const np = gauss(rng, 0, sPerp);
    let u = p.u + na * mx - np * my;
    let v = p.v + na * my + np * mx;
    if (rng() < (o.outlier_p ?? 0)) {
      const [lo, hi] = o.outlier_px ?? [8, 15];
      const mag = uniform(rng, lo, hi);
      const ang = uniform(rng, 0, 2 * Math.PI);
      u += mag * Math.cos(ang);
      v += mag * Math.sin(ang);
    }
    const wn = o.width_noise ?? 0.04;
    const minor = L > 0.5 ? Math.abs(mx) * ext.h + Math.abs(my) * ext.w : Math.min(ext.w, ext.h);
    frames.push({ frame: k, t_row: tRow, X: Xm, blur_px: L, u_true: p.u, v_true: p.v });
    obs.push({
      frame: k,
      t_s: tF,
      u,
      v,
      w_px: (ext.w + Math.abs(du)) * (1 + gauss(rng, 0, wn)),
      h_px: (ext.h + Math.abs(dv)) * (1 + gauss(rng, 0, wn)),
      r_px: 0.5 * minor * (1 + gauss(rng, 0, wn)),
      area: (Math.PI * ext.w * ext.h) / 4 + L * minor,
      peak: 60 + 10 * rng(),
    });
  }
  return {
    obs,
    truth: {
      v0: fl.v0,
      speed: Math.hypot(...fl.v0),
      launch_v_deg: o.launch_v_deg,
      psi_deg: o.psi_deg ?? 0,
      t_impact: tImp,
      start,
    },
    frames,
    flight: fl,
    n_visible: nVisible,
  };
}

/** Image centre of the resting ball (averaged over many static frames: small noise). */
export function staticBallPixel(cam, start, rng, noisePx = 0.2) {
  const p = project(cam, start);
  return { u: p.u + gauss(rng, 0, noisePx), v: p.v + gauss(rng, 0, noisePx) };
}

/**
 * Club-head centre track near impact: a circular arc of radius radius_m in the swing plane (inclined plane_deg
 * from horizontal toward the golfer at +y), constant head speed before impact, × post_factor after impact.
 * The head centre at impact sits depth_m behind the ball (+y) and at the ball-centre height.
 * o: { cam, speed_mps, t_impact, fps = 240, start = [0,0,BALL_R], radius_m = 1.2, plane_deg = 60, path_deg = 0,
 *      attack_deg = -3, depth_m = 0.025, post_factor = 0.75, frames_before = 10, frames_after = 4,
 *      noise_px = 1.0, dropout = 0, margin = 0.0, rng }
 * Returns { obs: [{ frame, t_s, u, v, conf }], truth: { speed, v_dir, H0 } }.
 */
export function simulateClubHead(o) {
  const rng = o.rng;
  const cam = o.cam;
  const fps = o.fps ?? 240;
  const tImp = o.t_impact;
  const start = o.start ?? [0, 0, BALL_R];
  const R = o.radius_m ?? 1.2;
  const a = (o.attack_deg ?? -3) * DEG;
  const pth = (o.path_deg ?? 0) * DEG;
  const vdir = [Math.cos(a) * Math.cos(pth), -Math.cos(a) * Math.sin(pth), Math.sin(a)];
  // hub direction: toward the golfer and up, orthogonalised against the velocity
  const pl = (o.plane_deg ?? 60) * DEG;
  let nh = [0, Math.cos(pl), Math.sin(pl)];
  const dp = nh[0] * vdir[0] + nh[1] * vdir[1] + nh[2] * vdir[2];
  nh = nh.map((x, k) => x - dp * vdir[k]);
  const nn = Math.hypot(...nh);
  nh = nh.map((x) => x / nn);
  const H0 = [start[0], start[1] + (o.depth_m ?? 0.025), start[2]];
  const V = o.speed_mps;
  const post = o.post_factor ?? 0.75;
  const headAt = (t) => {
    const dt = t - tImp;
    const phi = ((dt <= 0 ? V : V * post) * dt) / R;
    return [0, 1, 2].map((k) => H0[k] + R * (Math.sin(phi) * vdir[k] + (1 - Math.cos(phi)) * nh[k]));
  };
  const obs = [];
  const k0 = Math.floor(tImp * fps) - (o.frames_before ?? 10);
  const k1 = Math.floor(tImp * fps) + (o.frames_after ?? 4);
  for (let k = k0; k <= k1; k++) {
    const tF = k / fps;
    const tRow = rowTime(cam, tF, (t) => project(cam, headAt(t)));
    const p = project(cam, headAt(tRow));
    if (!Number.isFinite(p.u) || p.u < 0 || p.u > cam.W || p.v < 0 || p.v > cam.H) continue;
    if (rng() < (o.dropout ?? 0)) continue;
    const s = o.noise_px ?? 1.0;
    obs.push({ frame: k, t_s: tF, u: p.u + gauss(rng, 0, s), v: p.v + gauss(rng, 0, s), conf: 0.8 });
  }
  return { obs, truth: { speed: V, v_dir: vdir, H0 } };
}

/** Club category used for a synthetic shot: teed → driver, otherwise by launch angle. */
export function categoryForLaunch(launchDeg, teed) {
  if (teed) return 'driver';
  if (launchDeg >= 24) return 'wedge';
  if (launchDeg >= 19) return 'iron_short';
  if (launchDeg >= 15) return 'iron_mid';
  if (launchDeg >= 12) return 'iron_long';
  if (launchDeg >= 9) return 'hybrid';
  return 'wood';
}

/**
 * The M4 synthetic face_on scenario (CAFCR R6 M4, task acceptance): n shots spanning speed 30–80 m/s, launch
 * 5–30°, ψ ±6°, camera yaw ±2°, true readout 0–4 ms in both directions, every third shot teed (lift 0–50 mm,
 * measured with ±5 mm uniform error), exposure 1/1000–1/4000 s, 3 % dropouts, outlier_p gross outliers, ball
 * placed within ±5 cm of the spot, spin drawn from the category prior.
 * Calibration: exact unless `inject` is given. inject = a systematics object (physics/mc.js SYSTEMATICS_DEFAULTS
 * or systematicsFrom(...)) whose distributions are drawn per shot into the ESTIMATOR camera, i.e. the errors the
 * production ci95 assumes are really present in the data (physics/perturb.js modes, all keep the ball-spot pixel):
 *   scale k = (1 + N(0, calib_scale_sigma)) · (1 + U(±mat_scale_halfwidth))   camera centre about the ball spot;
 *   roll    N(0, roll_sigma_deg)                                              about the camera → ball-spot line;
 *   lens    true camera k1 from N(0, distortion_corner_sigma) corner fraction, estimator k1 = 0;
 *   readout readout_source 'assumed': true U(3 ms ± readout_halfwidth_ms), estimator 3 ms (o.readout ignored);
 *           'measured': true U(readoutRange), estimator true + N(0, readout_sigma_ms);
 *   tee     lift measured with U(±tee_measured_halfwidth_m) (inject.tee_lift_source must be 'measured').
 * The injected values come from a separate rng stream, so the flights, noise and dropouts of shot i are drawn
 * from the same stream with or without inject.
 * o: { seed, n = 60, fps = 240, outlier_p = 0.02, readout: 'known' | 'assumed' (estimator assumes 3 ms;
 *      true readout then drawn from 2–4 ms), readoutRange = [0, 4], speedRange, launchRange, psiMax = 6,
 *      spinPriors (physics/ballistics SPIN_PRIORS), makeCamera?({ yaw, readout }) -> camera (default
 *      nominalCamera('face_on')), inject? }
 * Returns [{ i, cam (estimator camera), camTrue, obs, start (startFromStaticBall input pixel: staticPx), lift_true,
 *   lift_measured, lie, category, injected: null | { scale, roll_deg, corner_frac, k1, readout_err_ms },
 *   truth: { speed, launch_v_deg, psi_deg, spin_rpm, t_impact, start } }].
 */
export function faceOnBatch(o) {
  const rng = mulberry32(o.seed);
  const n = o.n ?? 60;
  const fps = o.fps ?? 240;
  const [s0, s1] = o.speedRange ?? [30, 80];
  const [l0, l1] = o.launchRange ?? [5, 30];
  const psiMax = o.psiMax ?? 6;
  const inj = o.inject ?? null;
  if (inj && inj.tee_lift_source && inj.tee_lift_source !== 'measured') throw new RangeError('faceOnBatch: inject supports tee_lift_source measured only');
  const assumed = inj ? inj.readout_source !== 'measured' : o.readout === 'assumed';
  const hw = inj ? inj.readout_halfwidth_ms : 1;
  const [r0, r1] = assumed ? [READOUT_MEDIAN_MS - hw, READOUT_MEDIAN_MS + hw] : o.readoutRange ?? [0, 4];
  const teeHw = inj ? inj.tee_measured_halfwidth_m : 0.005;
  const irng = inj ? mulberry32((o.seed ^ 0x5eed1e55) >>> 0) : null;
  const out = [];
  for (let i = 0; i < n; i++) {
    const speed = uniform(rng, s0, s1);
    const launch = uniform(rng, l0, l1);
    const psi = uniform(rng, -psiMax, psiMax);
    const teed = i % 3 === 0;
    const lift = teed ? uniform(rng, 0, 0.05) : 0;
    const liftMeasured = teed ? Math.max(0, lift + uniform(rng, -teeHw, teeHw)) : 0;
    const category = categoryForLaunch(launch, teed);
    const pr = o.spinPriors[category];
    const spin = Math.max(500, gauss(rng, pr.mean_rpm, pr.sigma_rpm));
    const ms = uniform(rng, r0, r1);
    const dir = rng() < 0.5 ? 1 : -1;
    const yaw = uniform(rng, -2, 2) * DEG;
    let camTrue = (o.makeCamera ?? ((p) => nominalCamera('face_on', p)))({ yaw, readout: { ms, axis: 'v', dir } });
    let cam = assumed ? { ...camTrue, readout: { ...camTrue.readout, ms: READOUT_MEDIAN_MS } } : camTrue;
    let injected = null;
    if (inj) {
      const scale = (1 + gauss(irng, 0, inj.calib_scale_sigma)) * (1 + uniform(irng, -inj.mat_scale_halfwidth, inj.mat_scale_halfwidth));
      const rollDeg = gauss(irng, 0, inj.roll_sigma_deg);
      const cornerFrac = gauss(irng, 0, inj.distortion_corner_sigma);
      const roErr = assumed ? 0 : gauss(irng, 0, inj.readout_sigma_ms);
      const k1 = (camTrue.k1 ?? 0) + k1FromCornerFrac(camTrue, cornerFrac);
      cam = scaleAboutPoint(rollAboutPoint(cam, rollDeg * DEG), scale);
      if (!assumed) cam = { ...cam, readout: { ...cam.readout, ms: Math.max(0, ms + roErr) } };
      camTrue = withK1(camTrue, k1); // the estimator keeps its own k1 (0): the residual is unmodelled
      injected = { scale, roll_deg: rollDeg, corner_frac: cornerFrac, k1, readout_err_ms: cam.readout.ms - ms };
    }
    const start = [uniform(rng, -0.05, 0.05), uniform(rng, -0.05, 0.05), BALL_R + lift];
    const sim = simulateShot({
      cam: camTrue, speed_mps: speed, launch_v_deg: launch, psi_deg: psi, spin_rpm: spin, start, rng, fps,
      t_impact: uniform(rng, 0.05, 0.06), exposure_s: 1 / uniform(rng, 1000, 4000), outlier_p: o.outlier_p ?? 0.02,
      dropout: o.dropout ?? 0.03,
    });
    const staticPx = staticBallPixel(camTrue, start, rng, 0.3);
    out.push({
      i, cam, camTrue, obs: sim.obs, staticPx, lift_true: lift, lift_measured: liftMeasured, lie: teed ? 'tee' : 'mat',
      category, fps, injected, truth: { ...sim.truth, speed, launch_v_deg: launch, psi_deg: psi, spin_rpm: spin },
    });
  }
  return out;
}

