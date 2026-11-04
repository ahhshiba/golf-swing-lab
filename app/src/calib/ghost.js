// Ghost frame (CAFCR K2, C3 step C4): where the mat corners should appear if the camera were exactly at the
// preset pose. Presets store the pose, not pixels, so the ghost is re-projected for the current stream.

import { DEG } from '../geom/constants.js';
import { makeCamera, projectMany, rFromEuler } from '../geom/camera.js';
import { matCorners } from './mat.js';
import { nominalF } from './pnp.js';

/**
 * Camera at a preset pose for the current stream. camTemplate: { W, H, f?, k1?, readout? }.
 * f precedence: camTemplate.f → preset.f_locked scaled by camTemplate.W / preset.W (same FOV, other resolution)
 * → nominalF(W, H).
 */
export function presetCamera(preset, camTemplate) {
  const { W, H } = camTemplate;
  let f = camTemplate.f;
  if (!Number.isFinite(f) && Number.isFinite(preset.f_locked)) {
    const ref = Number.isFinite(preset.W) && Number.isFinite(preset.H) ? Math.max(preset.W, preset.H) : Math.max(W, H);
    f = preset.f_locked * (Math.max(W, H) / ref);
  }
  if (!Number.isFinite(f)) f = nominalF(W, H);
  const p = preset.pose;
  const C = [p.X_m, p.Y_m, p.h_m];
  const { R, t } = rFromEuler({ yaw: p.yaw_deg * DEG, pitch: p.pitch_deg * DEG, roll: p.roll_deg * DEG }, preset.view, C);
  return makeCamera({ W, H, f, k1: camTemplate.k1 ?? 0, R, t, readout: camTemplate.readout });
}

/**
 * Ghost corners: pixel positions [[u, v] × 4] ([tn, ln, lf, tf]) of the venue mat seen from the preset pose.
 * Returns { corners, cam, in_frame: bool[4] (inside the centred 95 % box, CAFCR C2 入鏡) }.
 */
export function ghostCorners(preset, venue, camTemplate, margin = 0.025) {
  const cam = presetCamera(preset, camTemplate);
  const { uv } = projectMany(cam, matCorners(venue));
  const corners = [];
  const in_frame = [];
  for (let i = 0; i < 4; i++) {
    const u = uv[2 * i];
    const v = uv[2 * i + 1];
    corners.push([u, v]);
    in_frame.push(u >= margin * cam.W && u <= (1 - margin) * cam.W && v >= margin * cam.H && v <= (1 - margin) * cam.H);
  }
  return { corners, cam, in_frame };
}

/** Distance between observed and ghost corners: { max_px, rms_px, per_corner_px: [4] } (NaN if any is missing). */
export function ghostDistance(observed, ghost) {
  const g = ghost.corners ?? ghost;
  const per = [];
  for (let i = 0; i < 4; i++) {
    const o = observed[i];
    per.push(o && g[i] ? Math.hypot(o[0] - g[i][0], o[1] - g[i][1]) : NaN);
  }
  const max_px = per.some((x) => !Number.isFinite(x)) ? NaN : Math.max(...per);
  const rms_px = Math.sqrt(per.reduce((s, x) => s + x * x, 0) / 4);
  return { max_px, rms_px, per_corner_px: per };
}
