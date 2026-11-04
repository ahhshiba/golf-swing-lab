// Camera pitch / roll from the accelerometer (DeviceMotionEvent.accelerationIncludingGravity), exponential
// low-pass and a stability detector (CAFCR C3 step C3, P1 slope; interfaces.md §6 angle conventions).
//
// ASSUMED DEVICE-AXIS CONVENTION (W3C DeviceOrientation spec; UNVERIFIED on iOS, measured at M1/M2b):
//   device frame: +x to the right of the screen and +y toward the top of the screen in natural portrait,
//   +z out of the screen toward the user. accelerationIncludingGravity of a device at rest is the specific
//   force, i.e. it points UP: lying flat screen-up reads ≈ (0, 0, +9.81). If iOS reports the opposite sign,
//   pass sign = −1 (one switch; everything else is unchanged).
//   The rear camera looks along device −z. Camera axes (OpenCV: +x image right, +y image down) for the
//   orientation of the device as seen by the user facing the screen:
//     'portrait'        (screen.orientation.angle 0):   cam_x = +dev_x, cam_y = −dev_y
//     'landscape_ccw'   (angle 90, top of phone to the LEFT):  cam_x = −dev_y, cam_y = −dev_x
//     'landscape_cw'    (angle 270 / −90, top to the RIGHT):   cam_x = +dev_y, cam_y = +dev_x
//     'portrait_upside' (angle 180):                    cam_x = −dev_x, cam_y = +dev_y
//   The angle ↔ name mapping is also UNVERIFIED on iOS (physics/shutter.js owns the readout side of it).

import { RAD2DEG } from '../geom/constants.js';

const AXES = Object.freeze({
  portrait: [[1, 0, 0], [0, -1, 0], [0, 0, -1]],
  landscape_ccw: [[0, -1, 0], [-1, 0, 0], [0, 0, -1]],
  landscape_cw: [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
  portrait_upside: [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
});

/** Orientation name from screen.orientation.angle (degrees) or a name; throws on anything else. */
export function orientationName(o) {
  if (typeof o === 'string') {
    if (!AXES[o]) throw new RangeError(`gravity: unknown orientation '${o}'`);
    return o;
  }
  const a = ((Math.round(o) % 360) + 360) % 360;
  if (a === 0) return 'portrait';
  if (a === 90) return 'landscape_ccw';
  if (a === 180) return 'portrait_upside';
  if (a === 270) return 'landscape_cw';
  throw new RangeError(`gravity: orientation angle ${o} is not a multiple of 90`);
}

/** Camera axes [cam_x, cam_y, cam_z] expressed in device coordinates for an orientation. */
export function cameraAxesInDevice(orientation) {
  return AXES[orientationName(orientation)].map((r) => r.slice());
}

/**
 * Pitch / roll of the rear camera from one accelerationIncludingGravity sample a = { x, y, z } (or [x, y, z]).
 * pitch = elevation of the optical axis above horizontal (+ up), roll = rotation about the optical axis
 * (+ clockwise as seen by the camera), exactly as geom eulerFromR. Returns
 * { pitch, roll (rad), pitch_deg, roll_deg, up_cam: [3] (unit up vector in camera axes), norm (m/s²) } or null.
 */
export function gravityPose(a, orientation = 'landscape_ccw', sign = 1) {
  const v = Array.isArray(a) ? a : [a?.x, a?.y, a?.z];
  if (!v.every(Number.isFinite)) return null;
  const n = Math.hypot(v[0], v[1], v[2]);
  if (!(n > 1e-6)) return null;
  const up = [(sign * v[0]) / n, (sign * v[1]) / n, (sign * v[2]) / n];
  const ax = AXES[orientationName(orientation)];
  const uc = ax.map((r) => r[0] * up[0] + r[1] * up[1] + r[2] * up[2]);
  const pitch = Math.atan2(uc[2], Math.hypot(uc[0], uc[1]));
  const roll = Math.atan2(-uc[0], -uc[1]);
  return { pitch, roll, pitch_deg: pitch * RAD2DEG, roll_deg: roll * RAD2DEG, up_cam: uc, norm: n };
}

/**
 * Inverse of gravityPose (for tests and simulation): accelerationIncludingGravity [x, y, z] that a device in
 * `orientation` reports when its camera has pitch / roll (rad). g_mag defaults to 9.80665.
 */
export function accelFromPose(pitch, roll, orientation = 'landscape_ccw', sign = 1, g_mag = 9.80665) {
  const uc = [-Math.sin(roll) * Math.cos(pitch), -Math.cos(roll) * Math.cos(pitch), Math.sin(pitch)];
  const ax = AXES[orientationName(orientation)];
  const dev = [0, 1, 2].map((k) => ax[0][k] * uc[0] + ax[1][k] * uc[1] + ax[2][k] * uc[2]);
  return dev.map((x) => sign * g_mag * x);
}

/**
 * Tilt of a device lying flat on the mat (P1 slope): angle between the device z axis and vertical, and the
 * down-slope direction in device x/y. Returns { slope_deg, dir_deg (atan2 of the horizontal up-component in
 * device x/y) } or null.
 */
export function flatSlope(a, sign = 1) {
  const v = Array.isArray(a) ? a : [a?.x, a?.y, a?.z];
  if (!v.every(Number.isFinite)) return null;
  const n = Math.hypot(v[0], v[1], v[2]);
  if (!(n > 1e-6)) return null;
  const z = Math.abs((sign * v[2]) / n);
  return { slope_deg: Math.acos(Math.min(1, z)) * RAD2DEG, dir_deg: Math.atan2(sign * v[1], sign * v[0]) * RAD2DEG };
}

/**
 * One step of a first-order exponential low-pass on a vector: α = 1 − exp(−dt/τ). state = null starts the
 * filter at the sample. Returns the new state { t_s, value: [..] } (the input state is not modified).
 */
export function lowPassStep(state, sample, t_s, tau_s = 0.5) {
  if (!state) return { t_s, value: sample.slice() };
  const dt = Math.max(0, t_s - state.t_s);
  const alpha = tau_s > 0 ? 1 - Math.exp(-dt / tau_s) : 1;
  return { t_s, value: state.value.map((y, i) => y + alpha * (sample[i] - y)) };
}

/**
 * Stability over the trailing span: samples [{ t_s, pitch_deg, roll_deg }] (time-ordered). Stable when the
 * span is covered (first sample ≤ t_last − span_s) and both angles stay within ±tol_deg of their mean.
 * Returns { stable, spread_deg (max |x − mean|), n, covered }.
 */
export function stabilityCheck(samples, { span_s = 1.0, tol_deg = 0.1 } = {}) {
  if (!samples.length) return { stable: false, spread_deg: NaN, n: 0, covered: false };
  const tEnd = samples[samples.length - 1].t_s;
  const sel = samples.filter((s) => s.t_s >= tEnd - span_s - 1e-12);
  const covered = samples[0].t_s <= tEnd - span_s + 1e-12;
  let spread = 0;
  for (const key of ['pitch_deg', 'roll_deg']) {
    const m = sel.reduce((acc, s) => acc + s[key], 0) / sel.length;
    for (const s of sel) spread = Math.max(spread, Math.abs(s[key] - m));
  }
  return { stable: covered && spread <= tol_deg, spread_deg: spread, n: sel.length, covered };
}

/**
 * Convenience tracker (closure state only, no globals or timers): push(accelerationIncludingGravity, t_s) →
 * { pitch_deg, roll_deg, stable, spread_deg }. Low-passes the raw vector (tau_s), then checks stability of the
 * filtered angles over span_s. opts: { orientation, sign = 1, tau_s = 0.5, span_s = 1.0, tol_deg = 0.1 }.
 */
export function createGravityTracker(opts = {}) {
  const orientation = opts.orientation ?? 'landscape_ccw';
  const sign = opts.sign ?? 1;
  const tau = opts.tau_s ?? 0.5;
  const span = opts.span_s ?? 1.0;
  const tol = opts.tol_deg ?? 0.1;
  let lp = null;
  let hist = [];
  return {
    push(a, t_s) {
      const v = Array.isArray(a) ? a : [a?.x, a?.y, a?.z];
      if (!v.every(Number.isFinite)) return null;
      lp = lowPassStep(lp, v, t_s, tau);
      const g = gravityPose(lp.value, orientation, sign);
      if (!g) return null;
      hist.push({ t_s, pitch_deg: g.pitch_deg, roll_deg: g.roll_deg });
      hist = hist.filter((s) => s.t_s >= t_s - 2 * span);
      const st = stabilityCheck(hist, { span_s: span, tol_deg: tol });
      return { pitch_deg: g.pitch_deg, roll_deg: g.roll_deg, stable: st.stable, spread_deg: st.spread_deg };
    },
    reset() { lp = null; hist = []; },
  };
}

/** Gravity prior object for pnp/ladder ({ pitch_deg, roll_deg, sigma_deg }), venue slope removed (small-angle). */
export function gravityPrior(g, { sigma_deg = 0.4, slope_pitch_deg = 0, slope_roll_deg = 0 } = {}) {
  if (!g) return null;
  return { pitch_deg: g.pitch_deg - slope_pitch_deg, roll_deg: g.roll_deg - slope_roll_deg, sigma_deg };
}

