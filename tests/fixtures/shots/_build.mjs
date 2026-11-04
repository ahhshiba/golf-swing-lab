// Regenerates the golf-shot/1 fixtures in this directory:  node tests/fixtures/shots/_build.mjs
//
// The fixtures are written as raw objects on purpose (no use of contract/metric.js or shot.js), so they stay an
// independent check of the validator. Camera objects come from geom. Every bad_* fixture is a valid base shot with
// exactly one change and carries "_expect": a substring that must appear in one validator error ("path: msg").
// Files whose name starts with "_" and keys starting with "_" are not part of a shot.

import { createHash } from 'node:crypto';
import { writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nominalCamera, poseReport } from '../../../app/src/geom/camera.js';
import { DEG } from '../../../app/src/geom/constants.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const rd = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
const clone = (x) => JSON.parse(JSON.stringify(x));

const UNITS = {
  backswing_s: 's', downswing_s: 's', tempo_ratio: 'ratio', head_sway_x_m: 'm', head_lift_z_m: 'm', head_depth_y_m: 'm',
  spine_forward_tilt_deg: 'deg', spine_side_tilt_deg: 'deg', shoulder_turn_deg: 'deg', hip_turn_deg: 'deg',
  x_factor_deg: 'deg', hand_plane_dev_m: 'm', top_shaft_angle_deg: 'deg', weight_shift_pct: '%', early_extension_m: 'm',
  club_speed_mps: 'm/s', club_path_deg: 'deg', ball_speed_mps: 'm/s', launch_v_deg: 'deg', launch_h_deg: 'deg',
  carry_m: 'm', smash_factor: 'ratio',
};

// number metric: o = { v, ci?, sigma?, validity, origin, codes? }
const num = (id, o) => ({
  value: o.v, unit: UNITS[id], ci95: o.ci ?? null, sigma: o.sigma ?? null, validity: o.validity, value_origin: o.origin,
  measured: false, reason_codes: o.codes ?? [],
});
// honest null
const nul = (id, validity, codes, origin = 'pose') => ({
  value: null, unit: UNITS[id], ci95: null, sigma: null, validity, value_origin: origin, measured: false, reason_codes: codes,
});

const sha = (name) => createHash('sha256').update(`golf-swing-lab fixture algorithm ${name}`).digest('hex');
const algorithms = () => ({
  pose: { version: 'mediapipe-pose-landmarker-full@1.2.2', sha256: sha('pose') },
  events: { version: 'rules-1.0.0', sha256: sha('events') },
  calib: { version: 'calib-1.0.0', sha256: sha('calib') },
  ball: { version: 'track-ball-1.0.0', sha256: sha('ball') },
  fit3d: { version: 'fit3d-1.0.0', sha256: sha('fit3d') },
  carry: { version: 'carry-rk4-mc500-1.0.0', sha256: sha('carry') },
});

function calibration(view, { method = 'mat_pnp', locked = true, yawDeg = 0.2, pitchDeg = -0.1, rollDeg = 0.1, readoutAxis = 'v', readoutDir = 1, rmse = 0.9, slope = 0.2, dev = true } = {}) {
  const cam0 = nominalCamera(view, { yaw: yawDeg * DEG, pitch: pitchDeg * DEG, roll: rollDeg * DEG, readout: { ms: 3.0, axis: readoutAxis, dir: readoutDir } });
  const camera = {
    W: cam0.W, H: cam0.H, f: rd(cam0.f, 6), cx: cam0.cx, cy: cam0.cy, k1: 0,
    R: cam0.R.map((x) => rd(x, 9)), t: cam0.t.map((x) => rd(x, 9)), readout: { ms: 3.0, axis: readoutAxis, dir: readoutDir },
  };
  const p = poseReport(cam0, view);
  const pose = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, rd(v, 4)]));
  return {
    method, source: 'clip', f_px: camera.f, f_locked: locked, pose,
    pose_sigma: { yaw_deg: 0.12, pitch_deg: 0.1, roll_deg: 0.08, X_m: 0.006, Y_m: 0.011, h_m: 0.004, D_m: 0.011 },
    reproj_rmse_px: method === 'mat_pnp' ? rmse : null, slope_deg: slope,
    preset_dev: dev ? { yaw_deg: 0.25, pitch_deg: -0.3, roll_deg: 0.1, X_m: 0.012, Y_m: -0.008, h_m: 0.004, D_m: 0.009 } : null,
    readout_ms: 3.0, readout_source: 'assumed', camera,
  };
}

// event frame table at a given fps: address..finish
function events(fps, frames, source, conf = 0.9) {
  const names = ['address', 'toe_up', 'mid_backswing', 'top', 'mid_downswing', 'impact', 'mid_follow_through', 'finish'];
  return Object.fromEntries(names.map((n, i) => [n, { frame: frames[i], t_s: rd(frames[i] / fps, 6), conf: i === 5 ? Math.min(0.98, conf + 0.05) : conf, source }]));
}

const faceOnMetrics = () => ({
  backswing_s: num('backswing_s', { v: 1.25, ci: [1.2458, 1.2542], validity: 'valid', origin: 'pose' }),
  downswing_s: num('downswing_s', { v: 0.416667, ci: [0.412467, 0.420867], validity: 'valid', origin: 'pose' }),
  tempo_ratio: num('tempo_ratio', { v: 3.0, ci: [2.94, 3.06], validity: 'valid', origin: 'derived' }),
  head_sway_x_m: num('head_sway_x_m', { v: 0.032, ci: [0.018, 0.046], validity: 'valid', origin: 'pose' }),
  head_lift_z_m: num('head_lift_z_m', { v: -0.015, ci: [-0.03, 0.0], validity: 'valid', origin: 'pose' }),
  head_depth_y_m: nul('head_depth_y_m', 'not_observable', ['VIEW_DEPTH_AXIS']),
  spine_forward_tilt_deg: nul('spine_forward_tilt_deg', 'not_observable', ['VIEW_PLANE_MISMATCH']),
  spine_side_tilt_deg: num('spine_side_tilt_deg', { v: 7.8, sigma: 2.0, ci: [3.9, 11.7], validity: 'valid', origin: 'pose' }),
  shoulder_turn_deg: num('shoulder_turn_deg', { v: 88, ci: [72, 104], validity: 'low_confidence', origin: 'pose' }),
  hip_turn_deg: num('hip_turn_deg', { v: 47, ci: [37, 57], validity: 'low_confidence', origin: 'pose' }),
  x_factor_deg: num('x_factor_deg', { v: 41, ci: [24, 58], validity: 'low_confidence', origin: 'derived' }),
  hand_plane_dev_m: nul('hand_plane_dev_m', 'not_observable', ['VIEW_PLANE_MISMATCH']),
  top_shaft_angle_deg: nul('top_shaft_angle_deg', 'not_observable', ['VIEW_PLANE_MISMATCH']),
  weight_shift_pct: num('weight_shift_pct', { v: 12.5, ci: [5.0, 20.0], validity: 'estimated', origin: 'pose' }),
  early_extension_m: nul('early_extension_m', 'not_observable', ['VIEW_DEPTH_AXIS']),
  club_speed_mps: num('club_speed_mps', { v: 40.2, sigma: 1.0, ci: [38.2, 42.2], validity: 'estimated', origin: 'club_track', codes: ['ROLLING_SHUTTER_ASSUMED'] }),
  club_path_deg: nul('club_path_deg', 'not_observable', ['VIEW_PLANE_MISMATCH'], 'club_track'),
  ball_speed_mps: num('ball_speed_mps', { v: 58.3, sigma: 0.9, ci: [56.5, 60.1], validity: 'estimated', origin: 'ball_fit3d', codes: ['ROLLING_SHUTTER_ASSUMED', 'TEE_LIFT_ASSUMED'] }),
  launch_v_deg: num('launch_v_deg', { v: 13.1, sigma: 0.6, ci: [11.9, 14.3], validity: 'estimated', origin: 'ball_fit3d', codes: ['TEE_LIFT_ASSUMED'] }),
  launch_h_deg: nul('launch_h_deg', 'not_observable', ['LAUNCH_DIR_UNOBSERVABLE'], 'ball_fit3d'),
  carry_m: num('carry_m', { v: 181.0, ci: [160.0, 202.0], validity: 'estimated', origin: 'ballistics', codes: ['SPIN_ASSUMED', 'WIND_IGNORED'] }),
  smash_factor: num('smash_factor', { v: 1.45, ci: [1.38, 1.52], validity: 'estimated', origin: 'derived' }),
});

function faceOn240() {
  return {
    schema: 'golf-shot/1', shot_id: 'shot-fx-face-on-240', session_id: 'sess-fx-0001', venue_id: 'venue-fx-bay-7',
    preset_id: 'preset-fx-face-on-a', created_at: '2026-11-04T09:30:15.250+08:00', app_version: '0.1.0+fixture0000',
    algorithms: algorithms(),
    capture: {
      mode: 'highspeed', view: 'face_on', source: 'import', orientation: 'landscape-primary', width: 1920, height: 1080,
      nominal_fps: 240, effective_fps: 239.94, vfr: false, timestamps: 'container', clip_ref: 'clip-fx-0001', trim_s: [0, 3],
    },
    calibration: calibration('face_on', { readoutAxis: 'v', readoutDir: 1 }),
    club: { type: 'driver', length_m: 1.17, lie: 'tee', tee_lift_m: 0.03, tee_lift_source: 'assumed' },
    handedness: 'right',
    events: events(240, [40, 160, 250, 340, 400, 440, 480, 620], 'rules'),
    metrics: faceOnMetrics(),
    quality: { pose_mean_vis: 0.93, frames_analyzed: 330, frames_dropped: 0, audio_onset: 1.836, touches: 1, warnings: ['TRACK_MAY_BE_SHORT'] },
    starred: true, note: 'driver off a tee, tee height not measured', revision: 0,
  };
}

function dtl30() {
  const m = {
    backswing_s: num('backswing_s', { v: 1.5, ci: [1.467, 1.533], validity: 'valid', origin: 'pose' }),
    downswing_s: num('downswing_s', { v: 0.5, ci: [0.467, 0.533], validity: 'valid', origin: 'pose' }),
    tempo_ratio: num('tempo_ratio', { v: 3.0, ci: [2.56, 3.57], validity: 'valid', origin: 'derived' }),
    head_sway_x_m: nul('head_sway_x_m', 'not_observable', ['VIEW_DEPTH_AXIS']),
    head_lift_z_m: num('head_lift_z_m', { v: 0.012, ci: [-0.012, 0.036], validity: 'valid', origin: 'pose' }),
    head_depth_y_m: num('head_depth_y_m', { v: 0.041, ci: [0.01, 0.072], validity: 'valid', origin: 'pose' }),
    spine_forward_tilt_deg: num('spine_forward_tilt_deg', { v: 34.5, ci: [29, 40], validity: 'valid', origin: 'pose' }),
    spine_side_tilt_deg: nul('spine_side_tilt_deg', 'not_observable', ['VIEW_PLANE_MISMATCH']),
    shoulder_turn_deg: num('shoulder_turn_deg', { v: 85, ci: [65, 105], validity: 'low_confidence', origin: 'pose' }),
    hip_turn_deg: num('hip_turn_deg', { v: 44, ci: [34, 54], validity: 'low_confidence', origin: 'pose' }),
    x_factor_deg: num('x_factor_deg', { v: 41, ci: [22, 60], validity: 'low_confidence', origin: 'derived' }),
    hand_plane_dev_m: num('hand_plane_dev_m', { v: 0.021, ci: [-0.01, 0.052], validity: 'valid', origin: 'pose' }),
    top_shaft_angle_deg: nul('top_shaft_angle_deg', 'not_observable', ['FPS_TOO_LOW']),
    weight_shift_pct: nul('weight_shift_pct', 'not_observable', ['VIEW_DEPTH_AXIS']),
    early_extension_m: num('early_extension_m', { v: 0.034, ci: [0.01, 0.058], validity: 'valid', origin: 'pose' }),
    club_speed_mps: nul('club_speed_mps', 'not_observable', ['VIEW_DEPTH_AXIS'], 'club_track'),
    club_path_deg: nul('club_path_deg', 'not_observable', ['VIEW_PLANE_MISMATCH'], 'club_track'),
    ball_speed_mps: nul('ball_speed_mps', 'not_observable', ['FPS_TOO_LOW', 'VIEW_DEPTH_AXIS'], 'ball_fit3d'),
    launch_v_deg: nul('launch_v_deg', 'not_observable', ['FPS_TOO_LOW', 'VIEW_DEPTH_AXIS'], 'ball_fit3d'),
    launch_h_deg: nul('launch_h_deg', 'not_observable', ['LAUNCH_DIR_UNOBSERVABLE'], 'ball_fit3d'),
    carry_m: nul('carry_m', 'not_computed', ['DEPENDS_ON_NULL'], 'ballistics'),
    smash_factor: nul('smash_factor', 'not_computed', ['DEPENDS_ON_NULL'], 'derived'),
  };
  return {
    schema: 'golf-shot/1', shot_id: 'shot-fx-dtl-30', session_id: 'sess-fx-0002', venue_id: 'venue-fx-bay-7',
    preset_id: 'preset-fx-dtl-a', created_at: '2026-11-04T10:02:41.000+08:00', app_version: '0.1.0+fixture0000',
    algorithms: algorithms(),
    capture: {
      mode: 'live', view: 'dtl', source: 'camera', orientation: 'portrait-primary', width: 1080, height: 1920,
      nominal_fps: 30, effective_fps: 29.97, vfr: true, timestamps: 'container', clip_ref: null, trim_s: null,
    },
    calibration: calibration('dtl', { yawDeg: -0.3, pitchDeg: 0.2, rollDeg: -0.1, rmse: 1.2 }),
    club: { type: '7i', length_m: 0.94, lie: 'mat', tee_lift_m: 0, tee_lift_source: 'measured' },
    handedness: 'right',
    events: events(30, [15, 35, 48, 60, 68, 75, 82, 120], 'tcn', 0.85),
    metrics: m,
    quality: { pose_mean_vis: 0.88, frames_analyzed: 150, frames_dropped: 2, audio_onset: 2.53, touches: 0, warnings: [] },
    starred: false, note: '', revision: 0,
  };
}

function highBehind240() {
  const m = {
    backswing_s: num('backswing_s', { v: 1.2, ci: [1.1958, 1.2042], validity: 'valid', origin: 'pose' }),
    downswing_s: num('downswing_s', { v: 0.4, ci: [0.3958, 0.4042], validity: 'valid', origin: 'pose' }),
    tempo_ratio: num('tempo_ratio', { v: 3.0, ci: [2.94, 3.06], validity: 'valid', origin: 'derived' }),
    head_sway_x_m: num('head_sway_x_m', { v: 0.028, ci: [-0.012, 0.068], validity: 'low_confidence', origin: 'pose' }),
    head_lift_z_m: nul('head_lift_z_m', 'not_observable', ['VIEW_DEPTH_AXIS']),
    head_depth_y_m: num('head_depth_y_m', { v: 0.036, ci: [-0.004, 0.076], validity: 'low_confidence', origin: 'pose' }),
    spine_forward_tilt_deg: nul('spine_forward_tilt_deg', 'not_observable', ['VIEW_PLANE_MISMATCH']),
    spine_side_tilt_deg: nul('spine_side_tilt_deg', 'not_observable', ['VIEW_PLANE_MISMATCH']),
    shoulder_turn_deg: num('shoulder_turn_deg', { v: 91, ci: [71, 111], validity: 'low_confidence', origin: 'pose' }),
    hip_turn_deg: num('hip_turn_deg', { v: 45, ci: [33, 57], validity: 'low_confidence', origin: 'pose' }),
    x_factor_deg: num('x_factor_deg', { v: 46, ci: [22, 70], validity: 'low_confidence', origin: 'derived' }),
    hand_plane_dev_m: nul('hand_plane_dev_m', 'not_observable', ['VIEW_PLANE_MISMATCH']),
    top_shaft_angle_deg: nul('top_shaft_angle_deg', 'not_observable', ['VIEW_PLANE_MISMATCH']),
    weight_shift_pct: nul('weight_shift_pct', 'not_observable', ['VIEW_DEPTH_AXIS']),
    early_extension_m: nul('early_extension_m', 'not_observable', ['VIEW_DEPTH_AXIS']),
    club_speed_mps: nul('club_speed_mps', 'not_observable', ['VIEW_DEPTH_AXIS'], 'club_track'),
    club_path_deg: num('club_path_deg', { v: 2.1, sigma: 2.0, ci: [-1.9, 6.1], validity: 'low_confidence', origin: 'club_track', codes: ['ROLLING_SHUTTER_ASSUMED'] }),
    ball_speed_mps: nul('ball_speed_mps', 'not_observable', ['VIEW_DEPTH_AXIS'], 'ball_fit3d'),
    launch_v_deg: nul('launch_v_deg', 'not_observable', ['VIEW_DEPTH_AXIS'], 'ball_fit3d'),
    launch_h_deg: num('launch_h_deg', { v: 1.8, sigma: 1.75, ci: [-1.7, 5.3], validity: 'low_confidence', origin: 'ball_fit2d', codes: ['ROLLING_SHUTTER_ASSUMED'] }),
    carry_m: nul('carry_m', 'not_computed', ['DEPENDS_ON_NULL'], 'ballistics'),
    smash_factor: nul('smash_factor', 'not_computed', ['DEPENDS_ON_NULL'], 'derived'),
  };
  return {
    schema: 'golf-shot/1', shot_id: 'shot-fx-high-behind-240', session_id: 'sess-fx-0003', venue_id: 'venue-fx-bay-7',
    preset_id: 'preset-fx-high-behind-a', created_at: '2026-11-04T10:31:09.500+08:00', app_version: '0.1.0+fixture0000',
    algorithms: algorithms(),
    capture: {
      mode: 'highspeed', view: 'high_behind', source: 'import', orientation: 'landscape-secondary', width: 1920, height: 1080,
      nominal_fps: 240, effective_fps: 240.01, vfr: false, timestamps: 'container', clip_ref: 'clip-fx-0003', trim_s: [0.2, 3.0],
    },
    calibration: calibration('high_behind', { yawDeg: 0.35, pitchDeg: 0.4, rollDeg: -0.2, readoutAxis: 'v', readoutDir: -1, rmse: 1.4 }),
    club: { type: '6i', length_m: 0.97, lie: 'mat', tee_lift_m: 0, tee_lift_source: 'measured' },
    handedness: 'right',
    events: events(240, [48, 150, 230, 336, 384, 432, 470, 600], 'rules', 0.8),
    metrics: m,
    quality: { pose_mean_vis: 0.9, frames_analyzed: 310, frames_dropped: 1, audio_onset: 1.803, touches: 1, warnings: [] },
    starred: false, note: '', revision: 0,
  };
}

// face-on shot with the whole-setup warnings: affected metrics are low_confidence and repeat the codes
function faceOnSetupUnverified() {
  const s = faceOn240();
  s.shot_id = 'shot-fx-face-on-setup-unverified';
  s.session_id = 'sess-fx-0004';
  s.preset_id = null;
  s.created_at = '2026-11-04T11:05:00Z';
  s.capture.clip_ref = null;
  s.calibration = calibration('face_on', { method: 'club_line', locked: false, dev: false, slope: null });
  s.club = { type: '7i', length_m: 0.94, lie: 'mat', tee_lift_m: 0, tee_lift_source: 'measured' };
  s.quality.warnings = ['SETUP_UNVERIFIED', 'NO_GRAVITY_REF'];
  s.note = 'started with a red setup check';
  for (const id of ['club_speed_mps', 'ball_speed_mps', 'launch_v_deg', 'carry_m', 'smash_factor']) {
    const metric = s.metrics[id];
    metric.validity = 'low_confidence';
    metric.reason_codes = [...metric.reason_codes.filter((c) => c !== 'TEE_LIFT_ASSUMED'), 'SETUP_UNVERIFIED', 'NO_GRAVITY_REF'];
  }
  s.metrics.ball_speed_mps.value = 52.4;
  s.metrics.ball_speed_mps.ci95 = [50.0, 54.8];
  s.metrics.ball_speed_mps.sigma = 1.2;
  s.metrics.club_speed_mps.value = 38.9;
  s.metrics.club_speed_mps.ci95 = [36.9, 40.9];
  s.metrics.launch_v_deg.value = 17.2;
  s.metrics.launch_v_deg.ci95 = [15.8, 18.6];
  s.metrics.launch_v_deg.sigma = 0.7;
  s.metrics.carry_m.value = 139.0;
  s.metrics.carry_m.ci95 = [122.0, 156.0];
  s.metrics.smash_factor.value = 1.35;
  s.metrics.smash_factor.ci95 = [1.28, 1.42];
  return s;
}

// face-on shot after one human correction of the top event (P6): revision 1, replaced values kept in history
function faceOnRevised() {
  const base = faceOn240();
  const s = clone(base);
  s.shot_id = 'shot-fx-face-on-revised';
  s.session_id = 'sess-fx-0005';
  s.events.top = { frame: 345, t_s: rd(345 / 240, 6), conf: 1, source: 'manual' };
  s.metrics.backswing_s = num('backswing_s', { v: 1.270833, ci: [1.266633, 1.275033], validity: 'valid', origin: 'pose' });
  s.metrics.downswing_s = num('downswing_s', { v: 0.395833, ci: [0.391633, 0.400033], validity: 'valid', origin: 'pose' });
  s.metrics.tempo_ratio = num('tempo_ratio', { v: 3.2105, ci: [3.14, 3.28], validity: 'valid', origin: 'derived' });
  s.revision = 1;
  s.history = [{ revision: 0, at: '2026-11-04T09:41:00+08:00', before: { events: base.events, metrics: base.metrics } }];
  return s;
}

const valid = {
  valid_face_on_240: faceOn240(),
  valid_dtl_30: dtl30(),
  valid_high_behind_240: highBehind240(),
  valid_face_on_setup_unverified: faceOnSetupUnverified(),
  valid_face_on_revised: faceOnRevised(),
};

// ---- bad fixtures: [name, base, expect, mutate] ----
const bad = [];
const addBad = (name, baseName, expect, mutate) => {
  const s = clone(valid[baseName]);
  s.shot_id = `shot-fx-${name.replace(/_/g, '-')}`;
  mutate(s);
  bad.push([name, { _expect: expect, ...s }]);
};

addBad('bad_value_null_but_valid', 'valid_face_on_240', 'requires a value', (s) => {
  Object.assign(s.metrics.tempo_ratio, { value: null, ci95: null, reason_codes: ['DEPENDS_ON_NULL'] });
});
addBad('bad_value_set_but_not_observable', 'valid_face_on_240', 'means no value', (s) => {
  Object.assign(s.metrics.head_sway_x_m, { validity: 'not_observable', reason_codes: ['VIEW_DEPTH_AXIS'] });
});
addBad('bad_null_without_reason', 'valid_face_on_240', 'requires at least one reason code', (s) => {
  s.metrics.head_depth_y_m.reason_codes = [];
});
addBad('bad_value_without_uncertainty', 'valid_face_on_240', 'requires ci95 or sigma', (s) => {
  Object.assign(s.metrics.ball_speed_mps, { ci95: null, sigma: null });
});
addBad('bad_ci95_excludes_value', 'valid_face_on_240', 'is outside ci95', (s) => {
  s.metrics.carry_m.ci95 = [185, 195];
});
addBad('bad_ci95_inverted', 'valid_face_on_240', 'exceeds upper bound', (s) => {
  s.metrics.carry_m.ci95 = [202, 160];
});
addBad('bad_unknown_reason_code', 'valid_face_on_240', 'unknown reason code', (s) => {
  s.metrics.club_path_deg.reason_codes = ['FPS_TOO_SLOW'];
});
addBad('bad_warning_not_repeated_on_metric', 'valid_face_on_setup_unverified', 'does not repeat it in reason_codes', (s) => {
  s.metrics.launch_v_deg.reason_codes = s.metrics.launch_v_deg.reason_codes.filter((c) => c !== 'NO_GRAVITY_REF');
});
addBad('bad_warning_metric_not_downgraded', 'valid_face_on_setup_unverified', 'must be downgraded to low_confidence', (s) => {
  s.metrics.carry_m.validity = 'estimated';
});
addBad('bad_setup_code_missing_from_warnings', 'valid_face_on_240', 'missing from quality.warnings', (s) => {
  s.metrics.head_depth_y_m.reason_codes = ['VIEW_DEPTH_AXIS', 'CALIB_STALE'];
});
addBad('bad_events_not_monotonic', 'valid_face_on_240', 'must be non-decreasing', (s) => {
  s.events.top.frame = 240;
});
addBad('bad_missing_metric_id', 'valid_face_on_240', 'metrics.smash_factor: required field is missing', (s) => {
  delete s.metrics.smash_factor;
});
addBad('bad_unknown_metric_id', 'valid_face_on_240', 'metrics.carry_yd: unknown field', (s) => {
  s.metrics.carry_yd = clone(s.metrics.carry_m);
});
addBad('bad_wrong_schema_version', 'valid_face_on_240', 'schema must be', (s) => {
  s.schema = 'golf-shot/2';
});
addBad('bad_metric_unit_mismatch', 'valid_face_on_240', 'for this metric', (s) => {
  s.metrics.carry_m.unit = 'yd';
});
addBad('bad_measured_true', 'valid_face_on_240', 'measured must be false', (s) => {
  s.metrics.ball_speed_mps.measured = true;
});
addBad('bad_null_with_leftover_ci95', 'valid_face_on_240', 'ci95 must be null when value is null', (s) => {
  s.metrics.head_depth_y_m.ci95 = [0, 0.02];
});
addBad('bad_capture_view_enum', 'valid_face_on_240', 'capture.view', (s) => {
  s.capture.view = 'side';
});
addBad('bad_camera_not_rotation', 'valid_face_on_240', 'not a rotation matrix', (s) => {
  s.calibration.camera.R[0] = 2;
});
addBad('bad_event_conf_out_of_range', 'valid_face_on_240', 'events.impact.conf', (s) => {
  s.events.impact.conf = 1.4;
});
addBad('bad_f_px_differs_from_camera', 'valid_face_on_240', 'differs from camera.f', (s) => {
  s.calibration.f_px = s.calibration.camera.f * 1.02;
});
addBad('bad_algorithm_hash', 'valid_face_on_240', 'algorithms.pose.sha256', (s) => {
  s.algorithms.pose.sha256 = 'not-a-hash';
});
addBad('bad_history_revision_not_below_shot', 'valid_face_on_revised', 'must be lower than the shot revision', (s) => {
  s.revision = 0;
});

// ---- write ----
for (const f of readdirSync(HERE)) {
  if (/^(valid|bad)_.*\.json$/.test(f)) unlinkSync(join(HERE, f));
}
const write = (name, obj) => writeFileSync(join(HERE, `${name}.json`), `${JSON.stringify(obj, null, 2)}\n`);
for (const [name, shot] of Object.entries(valid)) write(name, shot);
for (const [name, shot] of bad) write(name, shot);
console.log(`wrote ${Object.keys(valid).length} valid and ${bad.length} bad fixtures`);
