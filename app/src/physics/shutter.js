// Rolling-shutter timing for ball and club-head detections (interfaces.md §2; CAFCR C1.1 "滾動快門", K6).
//
// A detection at (u, v) in a frame whose timestamp t_frame is the instant the readout passes the image centre
// happened at   t = t_frame + (ms / 1000) · dir · (s / S − 0.5),   s = u, S = W (axis 'u') or s = v, S = H (axis 'v').
// Correction strategy (K6, not root-sum-squared): the readout time is corrected with its median (3 ms) and only
// the residual (true readout 2–4 ms, uniform) goes into the ci95, as a per-draw offset in physics/mc.js.

import { DEFAULT_READOUT_MS } from '../geom/constants.js';
import { RC } from '../contract/reason-codes.js';

/** Median readout time used when it has not been measured (CAFCR C1.1: iPhone 1080p240 readout 2–4 ms). */
export const READOUT_MEDIAN_MS = DEFAULT_READOUT_MS;
/** Range the true readout is assumed to lie in when not measured (uniform). */
export const READOUT_ASSUMED_RANGE_MS = Object.freeze([2.0, 4.0]);
/** Half-width of that range around the median: per-draw readout offset ~ U(−1, +1) ms in mc.js. */
export const READOUT_ASSUMED_HALFWIDTH_MS = (READOUT_ASSUMED_RANGE_MS[1] - READOUT_ASSUMED_RANGE_MS[0]) / 2;
/** Typical speed residual after the median correction (C1.1): uniform ±0.7 % ... */
export const READOUT_RESIDUAL_FRAC = 0.007;
/** ... i.e. σ = 0.7 % / √3 ≈ 0.40 %. Used by mc.js only when no per-shot sensitivity is available. */
export const READOUT_RESIDUAL_SIGMA_FRAC = READOUT_RESIDUAL_FRAC / Math.sqrt(3);
/** 1σ of a measured readout time (stripe self-calibration, not built yet). UNVERIFIED placeholder. */
export const READOUT_MEASURED_SIGMA_MS = 0.2;

/** Orientation each view is filmed in (CAFCR C2): face_on and high_behind landscape, dtl portrait. */
export const VIEW_DEFAULT_ORIENTATION = Object.freeze({
  face_on: 'landscape-primary',
  high_behind: 'landscape-primary',
  dtl: 'portrait-primary',
});

// UNVERIFIED mapping from screen.orientation.type (image as displayed, back camera) to the readout direction.
// Assumptions, to be measured at M4 (docs/device-checklist.md):
//   * the iPhone sensor's native buffer is landscape with the Lightning/USB-C port on the right ("landscape right"
//     in UIKit terms); Safari reports that hold as screen.orientation.type 'landscape-primary' (angle 90);
//   * the sensor reads rows from the top of that native image to its bottom, i.e. along +v;
//   * 'landscape-secondary' is the same sensor turned 180°, so the readout runs bottom → top (dir −1);
//   * portrait: the native top row becomes the right image edge ('portrait-primary': readout right → left,
//     axis 'u', dir −1) or the left edge ('portrait-secondary': left → right, dir +1).
// A wrong sign doubles the rolling-shutter error instead of removing it (≈ ±2 % on ball speed, C1.1).
const ORIENTATION_READOUT = Object.freeze({
  'landscape-primary': Object.freeze({ axis: 'v', dir: 1 }),
  'landscape-secondary': Object.freeze({ axis: 'v', dir: -1 }),
  'portrait-primary': Object.freeze({ axis: 'u', dir: -1 }),
  'portrait-secondary': Object.freeze({ axis: 'u', dir: 1 }),
});

/**
 * Readout axis and direction in displayed-image coordinates for a screen.orientation.type and a view.
 * Unknown / missing orientation falls back to the view's default orientation.
 * Returns { axis: 'u'|'v', dir: 1|-1, orientation, verified: false }.
 */
export function readoutFor(orientationType, view) {
  let o = orientationType;
  if (!ORIENTATION_READOUT[o]) o = VIEW_DEFAULT_ORIENTATION[view] ?? 'landscape-primary';
  const m = ORIENTATION_READOUT[o];
  return { axis: m.axis, dir: m.dir, orientation: o, verified: false };
}

/**
 * Readout object for a camera plus its provenance. o: { orientationType, view, ms?, source? }.
 * Without a measured `ms` the median is used, source 'assumed' and RC.ROLLING_SHUTTER_ASSUMED is returned.
 * Returns { readout: { ms, axis, dir }, source: 'assumed'|'measured', reason_codes }.
 */
export function readoutModel(o = {}) {
  const { axis, dir } = readoutFor(o.orientationType, o.view);
  const measured = o.source === 'measured' && Number.isFinite(o.ms);
  return {
    readout: { ms: measured ? o.ms : READOUT_MEDIAN_MS, axis, dir },
    source: measured ? 'measured' : 'assumed',
    reason_codes: measured ? [] : [RC.ROLLING_SHUTTER_ASSUMED],
  };
}

/**
 * Time (s) at which the detection obs = { u, v, … } was exposed, from its frame timestamp t_frame
 * (default obs.t_s) and cam.readout (interfaces.md §2). A camera without readout or with ms = 0 returns t_frame.
 */
export function observationTime(obs, t_frame, cam) {
  const tf = t_frame ?? obs.t_s;
  const ro = cam.readout;
  if (!ro || !ro.ms) return tf;
  const frac = ro.axis === 'u' ? obs.u / cam.W : obs.v / cam.H;
  return tf + (ro.ms / 1000) * ro.dir * (frac - 0.5);
}

/** observationTime for every element of obs (each uses its own t_s). Returns Float64Array. */
export function observationTimes(obs, cam) {
  const out = new Float64Array(obs.length);
  for (let i = 0; i < obs.length; i++) out[i] = observationTime(obs[i], obs[i].t_s, cam);
  return out;
}

/** Copy of cam with readout.ms replaced (used for sensitivity refits). */
export function withReadoutMs(cam, ms) {
  return { ...cam, readout: { ...cam.readout, ms } };
}
