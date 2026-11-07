#!/usr/bin/env node
// scripts/make_lm_fixtures.mjs — golf-shot/2 fixtures for the launch-monitor packages (LAUNCH-MONITOR-SPEC §5.0-14).
//
//   node scripts/make_lm_fixtures.mjs [--check]
//
// Writes (deterministic: fixed seed, no clock, no physics model — the numbers are plausible typed-in values):
//   tests/fixtures/shots/v2/valid_face_on_240.json         face_on 240 fps, every face_on cell of §1.2 filled, flight + tracks
//   tests/fixtures/shots/v2/valid_face_on_240_no_clip.json the same shot without a stored clip (clip_ref null, CLIP_NOT_SAVED)
//   tests/fixtures/shots/v2/valid_high_behind_240.json     high_behind 240 fps, hb cells filled (低), flight with side + band, tracks
//                                                          (right-hander: flight y = −carry_side_m, mat frame)
//   tests/fixtures/shots/v2/valid_dtl_30.json              dtl 30 fps: every ball / club / launch-monitor id null (registry codes)
//   tests/fixtures/shots/v2/migrated_v1_face_on.json       contract/migrate.js of tests/fixtures/shots/valid_face_on_240.json
//   tests/fixtures/shots/v2/bad_<rule>.json                one per golf-shot/2 validator rule, "_expect" = <rule>
//   tests/fixtures/lm/sessions-1000.json                   export file (golf-swing-lab-export/1): 1000 shots, 8 clubs,
//                                                          3 views, 12 sessions (history import / LM-F stats + gapping)
// face_on and high_behind fixtures: flight.samples[0] projected with calibration.camera is the impact-frame point of
// tracks.ball_px (to 0.01 px), which LM-C acceptance 1 relies on. Every file is checked with the contract validator
// before it is written; --check only verifies that the files on disk equal what would be written (exit 1 if not).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RC } from '../app/src/contract/reason-codes.js';
import { METRIC_UNITS, METRIC_DEFAULT_ORIGIN, LM_METRIC_IDS, SCHEMA_ID } from '../app/src/contract/enums.js';
import { validateShot } from '../app/src/contract/validate.js';
import { migrateShot } from '../app/src/contract/migrate.js';
import { cellFor } from '../app/src/metrics/registry.js';
import { project } from '../app/src/geom/camera.js';
import { BALL_R } from '../app/src/geom/constants.js';
import { mulberry32, gauss } from '../app/src/geom/rng.js';
import { CLUBS } from '../app/src/session/settings.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const V1 = path.join(ROOT, 'tests/fixtures/shots');
const V2 = path.join(V1, 'v2');
const LM = path.join(ROOT, 'tests/fixtures/lm');
const rd = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const clone = (x) => JSON.parse(JSON.stringify(x));
const sha = (s) => createHash('sha256').update(s).digest('hex');
export const LM_FIXTURE_ALGORITHM = Object.freeze({ version: 'lm-fixture-1', sha256: sha('golf-swing-lab fixture algorithm lm') });

// ------------------------------------------------------------------------------------------- metric helpers
const nul = (id, code) => ({
  value: null, unit: METRIC_UNITS[id], ci95: null, sigma: null,
  validity: code === RC.DEPENDS_ON_NULL ? 'not_computed' : 'not_observable', value_origin: METRIC_DEFAULT_ORIGIN[id], measured: false, reason_codes: [code],
});
function num(id, value, sigma, validity, codes, origin = METRIC_DEFAULT_ORIGIN[id], digits = 2) {
  const v = rd(value, digits);
  const s = rd(sigma, digits + 1);
  return { value: v, unit: METRIC_UNITS[id], ci95: [rd(v - 1.96 * s, digits), rd(v + 1.96 * s, digits)], sigma: s, validity, value_origin: origin, measured: false, reason_codes: [...new Set(codes)] };
}
/** The registry decides: a 不可 / too-slow cell is null with its code; an allowed cell gets the number at the cell's validity. */
function cell(id, view, fps, value, sigma, codes, origin, digits) {
  const c = cellFor(id, view, fps);
  if (c.validity === null) return nul(id, c.code);
  return num(id, value, sigma, c.validity, codes, origin, digits);
}

// Codes per id when it carries a number (§1.2 / §2.3); view-specific extras added by the callers.
const FO = {
  attack_angle_deg: [], dynamic_loft_deg: [RC.DPLANE_MODEL], spin_loft_deg: [RC.DPLANE_MODEL], spin_rate_rpm: [RC.SPIN_MODELLED],
  total_m: [RC.ROLL_MODELLED, RC.FLIGHT_MODELLED, RC.SPIN_MODELLED, RC.WIND_IGNORED],
  apex_m: [RC.FLIGHT_MODELLED], landing_angle_deg: [RC.FLIGHT_MODELLED], hang_time_s: [RC.FLIGHT_MODELLED],
};
const HB_ASSUMED = [RC.SMASH_ASSUMED, RC.LAUNCH_V_ASSUMED];
const HB = {
  face_angle_deg: [RC.DPLANE_MODEL, RC.SPIN_LOFT_ASSUMED], face_to_path_deg: [RC.DPLANE_MODEL, RC.SPIN_LOFT_ASSUMED],
  spin_axis_deg: [RC.DPLANE_MODEL, RC.SPIN_LOFT_ASSUMED],
  total_m: [RC.ROLL_MODELLED, RC.FLIGHT_MODELLED, RC.WIND_IGNORED, ...HB_ASSUMED],
  carry_side_m: [RC.DPLANE_MODEL, RC.FLIGHT_MODELLED, ...HB_ASSUMED], total_side_m: [RC.DPLANE_MODEL, RC.FLIGHT_MODELLED, RC.ROLL_MODELLED, ...HB_ASSUMED],
  curve_m: [RC.DPLANE_MODEL, RC.FLIGHT_MODELLED, ...HB_ASSUMED],
};

/** Every launch-monitor metric of one shot from a plain value table v (missing → registry null / not used). */
function lmMetrics(view, fps, v) {
  const out = {};
  for (const id of LM_METRIC_IDS) {
    const codes = (view === 'high_behind' ? HB[id] : FO[id]) ?? [];
    const digits = id === 'spin_rate_rpm' ? 0 : id === 'hang_time_s' ? 2 : 1;
    out[id] = v[id] ? cell(id, view, fps, v[id][0], v[id][1], codes, undefined, digits) : (() => {
      const c = cellFor(id, view, fps);
      if (c.validity !== null) throw new Error(`${view} ${id}: allowed cell without a value`);
      return nul(id, c.code);
    })();
  }
  return out;
}

// ------------------------------------------------------------------------------------------- flight + tracks
/** A smooth, plausible trajectory (not a physics model): equal time steps, last sample on the ground at `carry`.
 *  Mat frame (x down the target line, y + = left of the line / toward a right-handed golfer, z up): `side` is the
 *  landing y in that frame, NOT the carry_side_m metric (which is + away from the golfer). */
function flightOf({ start, carry, side = 0, curveFrac = 0.6, apex, hang, total, ground = 'normal', band = null, n = 32 }) {
  const samples = [];
  const uA = 0.56;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const t = u * hang;
    const ex = (1 - Math.exp(-2.2 * u)) / (1 - Math.exp(-2.2));
    const x = start[0] + (carry - start[0]) * ex;
    const shape = u <= uA ? 1 - ((u - uA) / uA) ** 2 : 1 - ((u - uA) / (1 - uA)) ** 2;
    const z = start[2] * (1 - u) + apex * shape;
    const y = start[1] + side * ((1 - curveFrac) * ex + curveFrac * ex * ex);
    samples.push([rd(t, 3), rd(x, 3), rd(y, 3), rd(Math.max(0, z), 3)]);
  }
  samples[n - 1][3] = 0;
  const last = samples[n - 1];
  return {
    samples,
    landing: { x_m: last[1], y_m: last[2], t_s: last[0] },
    rest: total === null ? null : { x_m: rd(total, 2), y_m: rd(last[2] * total / carry, 2) },
    band,
    ground,
    model: 'lm-1',
  };
}

/** 16-point outline of a ±(sx, sy) ellipse around (cx, cy), split in two halves for flight.band. */
function bandOf(cx, cy, sx, sy) {
  const pts = Array.from({ length: 16 }, (_, k) => [rd(cx + sx * Math.cos((2 * Math.PI * k) / 16), 2), rd(cy + sy * Math.sin((2 * Math.PI * k) / 16), 2)]);
  return { side_lo: pts.slice(0, 8), side_hi: pts.slice(8) };
}

/** Detected ball centres: the flight's first samples projected at the impact frame and after (frames of the clip). */
function tracksOf(camera, flight, impactFrame, fps, view, frames = 12) {
  const at = (t) => {
    const s = flight.samples;
    let i = 0;
    while (i < s.length - 2 && s[i + 1][0] < t) i++;
    const a = s[i];
    const b = s[i + 1];
    const w = (t - a[0]) / (b[0] - a[0]);
    return [a[1] + w * (b[1] - a[1]), a[2] + w * (b[2] - a[2]), a[3] + w * (b[3] - a[3])];
  };
  const ball = [];
  for (let k = 0; k < frames; k++) {
    const X = k === 0 ? flight.samples[0].slice(1) : at(k / fps);
    const p = project(camera, X);
    if (!(p.z > 0) || p.u < 0 || p.v < 0 || p.u > camera.W || p.v > camera.H) break;
    ball.push([impactFrame + k, rd(p.u, 2), rd(p.v, 2), rd((camera.f * BALL_R) / p.z, 2)]);
  }
  return { ball_px: ball, impact_frame: impactFrame, view };
}

// ------------------------------------------------------------------------------------------- the v2 shots
function readV1(name) {
  const raw = JSON.parse(fs.readFileSync(path.join(V1, `${name}.json`), 'utf8'));
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('_')));
}
const swapCode = (m, from, to) => ({ ...m, reason_codes: [...new Set(m.reason_codes.map((c) => (c === from ? to : c)))] });

function faceOn240() {
  const s = migrateShot(readV1('valid_face_on_240')).shot; // driver, tee, ball 58.3 m/s, launch 13.1°, carry 181 m
  s.shot_id = 'shot-fx-v2-face-on-240';
  s.algorithms.lm = { ...LM_FIXTURE_ALGORITHM };
  const fps = s.capture.nominal_fps;
  Object.assign(s.metrics, lmMetrics('face_on', fps, {
    attack_angle_deg: [2.4, 1.8], dynamic_loft_deg: [14.6, 1.6], spin_loft_deg: [12.2, 2.4], spin_rate_rpm: [2650, 380],
    total_m: [201, 12], apex_m: [29.5, 3.2], landing_angle_deg: [37.5, 3.5], hang_time_s: [6.4, 0.3],
  }));
  // §1.3-3: face_on carry uses the modelled spin now
  s.metrics.carry_m = { ...swapCode(s.metrics.carry_m, RC.SPIN_ASSUMED, RC.SPIN_MODELLED) };
  s.metrics.carry_m.reason_codes = [...new Set([...s.metrics.carry_m.reason_codes, RC.FLIGHT_MODELLED])];
  const start = [0, 0, BALL_R + s.club.tee_lift_m];
  s.flight = flightOf({ start, carry: s.metrics.carry_m.value, apex: s.metrics.apex_m.value, hang: s.metrics.hang_time_s.value, total: s.metrics.total_m.value });
  s.tracks = tracksOf(s.calibration.camera, s.flight, s.events.impact.frame, fps, 'face_on');
  return s;
}

function faceOnNoClip(base) {
  const s = clone(base);
  s.shot_id = 'shot-fx-v2-face-on-240-no-clip';
  s.capture.clip_ref = null;
  if (!s.quality.warnings.includes(RC.CLIP_NOT_SAVED)) s.quality.warnings.push(RC.CLIP_NOT_SAVED);
  return s;
}

function highBehind240() {
  const s = migrateShot(readV1('valid_high_behind_240')).shot; // 6-iron, mat; club path +2.1°, launch_h +1.8° (低)
  s.shot_id = 'shot-fx-v2-high-behind-240';
  s.algorithms.lm = { ...LM_FIXTURE_ALGORITHM };
  const fps = s.capture.nominal_fps;
  const shared = [RC.ROLLING_SHUTTER_ASSUMED];
  s.metrics.club_speed_mps = cell('club_speed_mps', 'high_behind', fps, 37.6, 2.6, shared, 'club_track', 1);
  s.metrics.ball_speed_mps = cell('ball_speed_mps', 'high_behind', fps, 50.0, 3.8, [...shared, RC.SMASH_ASSUMED], 'derived', 1);
  s.metrics.carry_m = cell('carry_m', 'high_behind', fps, 158, 17, [RC.FLIGHT_MODELLED, RC.WIND_IGNORED, RC.SPIN_ASSUMED, ...HB_ASSUMED], 'ballistics', 0);
  Object.assign(s.metrics, lmMetrics('high_behind', fps, {
    face_angle_deg: [1.4, 1.9], face_to_path_deg: [-0.7, 3.0], spin_axis_deg: [-3.5, 8.0], total_m: [166, 19],
    carry_side_m: [3.1, 11], total_side_m: [3.3, 11.5], curve_m: [-1.9, 10],
  }));
  const carry = s.metrics.carry_m.value;
  // carry_side_m is + away from the golfer (right of the line for this right-hander); flight is in the mat frame
  // (y + = left of the target line, toward a right-handed golfer), so y = −side (+side for a left-hander)
  const yLand = s.handedness === 'left' ? s.metrics.carry_side_m.value : -s.metrics.carry_side_m.value;
  s.flight = flightOf({
    start: [0, 0, BALL_R + s.club.tee_lift_m], carry, side: yLand, apex: 24, hang: 5.6, total: s.metrics.total_m.value,
    band: bandOf(carry, yLand, s.metrics.carry_m.sigma, s.metrics.carry_side_m.sigma),
  });
  s.tracks = tracksOf(s.calibration.camera, s.flight, s.events.impact.frame, fps, 'high_behind');
  return s;
}

function dtl30() {
  const s = migrateShot(readV1('valid_dtl_30')).shot;
  s.shot_id = 'shot-fx-v2-dtl-30';
  s.algorithms.lm = { ...LM_FIXTURE_ALGORITHM };
  Object.assign(s.metrics, lmMetrics('dtl', s.capture.nominal_fps, {}));
  return s;
}

// one change each; "_expect" = the rule name the validator prints (contract/validate.js, docs/contract.md)
function badFixtures(fo) {
  const out = {};
  const mk = (rule, change) => { const s = clone(fo); s.shot_id = `shot-fx-v2-bad-${rule.replace(/_/g, '-')}`; change(s); out[`bad_${rule}`] = { _expect: rule, ...s }; };
  mk('flight_t_increasing', (s) => { s.flight.samples[5][0] = s.flight.samples[4][0]; });
  mk('flight_z_above_ground', (s) => { s.flight.samples[30][3] = -0.5; });
  mk('flight_needs_carry', (s) => { s.metrics.carry_m = nul('carry_m', RC.DEPENDS_ON_NULL); });
  mk('flight_landing_matches_carry', (s) => { s.flight.landing.x_m = rd(s.metrics.carry_m.value + 2, 3); });
  mk('tracks_frame_increasing', (s) => { s.tracks.ball_px[2][0] = s.tracks.ball_px[1][0]; });
  mk('practice_target_positive', (s) => { s.practice = { drill_id: 'drill-fx-1', slot: 0, target_m: 0, attempt: 0 }; });
  mk('model_code_required', (s) => { s.metrics.dynamic_loft_deg.reason_codes = []; });
  return out;
}

// ------------------------------------------------------------------------------------------- sessions-1000
// typical carry (m), ball speed (m/s), launch (deg), spin (rpm), apex (m), landing (deg), hang (s), roll (m) per club
const CLUB_NUMBERS = {
  driver: [205, 66, 12, 2800, 30, 38, 6.6, 20], '3w': [190, 62, 12.5, 3600, 29, 41, 6.3, 15], hybrid: [172, 58, 14, 4400, 28, 44, 6.0, 11],
  '5i': [160, 55, 14.5, 5200, 28, 47, 5.8, 9], '7i': [142, 51, 17, 6600, 28, 50, 5.6, 6], '9i': [125, 46, 20.5, 7800, 27, 51, 5.4, 4],
  pw: [110, 43, 24, 8800, 26, 52, 5.2, 3], sw: [82, 36, 29, 9800, 23, 52, 4.8, 2],
};

function sessions1000(templates) {
  const rng = mulberry32(20261106);
  const venue = { venue_id: 'venue-fx-lm', name: 'LM fixture range', created_at: '2026-09-01T08:00:00.000Z' };
  const sessions = [];
  const presets = [];
  const shots = [];
  const t0 = Date.parse('2026-09-20T09:00:00.000Z');
  for (let k = 0; k < 12; k++) {
    const start = t0 + k * 4 * 86400000;
    const view = ['face_on', 'face_on', 'high_behind', 'face_on', 'dtl', 'high_behind'][k % 6];
    const preset = { preset_id: `preset-fx-lm-${view}`, venue_id: venue.venue_id, view, created_at: '2026-09-01T08:00:00.000Z' };
    if (!presets.some((p) => p.preset_id === preset.preset_id)) presets.push(preset);
    sessions.push({ session_id: `sess-fx-lm-${String(k + 1).padStart(2, '0')}`, venue_id: venue.venue_id, preset_id: preset.preset_id, view, created_at: new Date(start).toISOString() });
  }
  for (let i = 0; i < 1000; i++) {
    const k = Math.floor((i * 12) / 1000);
    const sess = sessions[k];
    const view = sess.view;
    const [type, len] = CLUBS[(i + k) % CLUBS.length];
    const N = CLUB_NUMBERS[type];
    const s = clone(templates[view]);
    s.shot_id = `shot-fx-lm-${String(i + 1).padStart(4, '0')}`;
    s.session_id = sess.session_id;
    s.preset_id = sess.preset_id;
    s.venue_id = venue.venue_id;
    s.created_at = new Date(Date.parse(sess.created_at) + (i - Math.ceil((k * 1000) / 12)) * 45000).toISOString();
    s.club = { ...s.club, type, length_m: len };
    s.flight = null;
    s.tracks = null;
    s.capture.clip_ref = null;
    delete s.history;
    s.revision = 0;
    s.quality.warnings = [];
    const mishit = rng() < 0.04 ? 0.7 : 1; // a few thin / heavy shots for the mishit filter
    const g = (sd) => gauss(rng, 0, sd);
    const fps = s.capture.nominal_fps;
    if (view === 'face_on') {
      const ball = N[1] * mishit + g(1.2);
      const smash = type === 'driver' ? 1.47 : type === 'sw' ? 1.18 : 1.33;
      const carry = N[0] * mishit * (ball / (N[1] * mishit)) ** 1.6 + g(2.5);
      const m = s.metrics;
      m.club_speed_mps = cell('club_speed_mps', view, fps, ball / smash + g(0.4), 0.9, [RC.ROLLING_SHUTTER_ASSUMED], 'club_track', 1);
      m.ball_speed_mps = cell('ball_speed_mps', view, fps, ball, 0.9, [RC.ROLLING_SHUTTER_ASSUMED], 'ball_fit3d', 1);
      m.launch_v_deg = cell('launch_v_deg', view, fps, N[2] + g(1.1), 0.5, [], 'ball_fit3d', 1);
      m.carry_m = cell('carry_m', view, fps, carry, carry * 0.05, [RC.SPIN_MODELLED, RC.FLIGHT_MODELLED, RC.WIND_IGNORED], 'ballistics', 1);
      m.smash_factor = cell('smash_factor', view, fps, m.ball_speed_mps.value / m.club_speed_mps.value, 0.03, [], 'derived', 3);
      Object.assign(m, lmMetrics(view, fps, {
        attack_angle_deg: [(type === 'driver' ? 2 : -4) + g(1.5), 2], dynamic_loft_deg: [N[2] * 1.25 + g(1.2), 1.6], spin_loft_deg: [N[2] * 1.25 + 4 + g(1.5), 2.6],
        spin_rate_rpm: [N[3] + g(N[3] * 0.08), N[3] * 0.14], total_m: [carry + N[7] + g(2), 0.06 * carry + N[7] * 0.5],
        apex_m: [N[4] + g(1.5), 3], landing_angle_deg: [N[5] + g(2), 3.5], hang_time_s: [N[6] + g(0.2), 0.3],
      }));
    } else if (view === 'high_behind') {
      const club = (N[1] / 1.36) * mishit + g(1);
      const carry = N[0] * mishit + g(4);
      const side = g(0.06 * carry);
      const m = s.metrics;
      m.club_speed_mps = cell('club_speed_mps', view, fps, club, club * 0.07, [RC.ROLLING_SHUTTER_ASSUMED], 'club_track', 1);
      m.ball_speed_mps = cell('ball_speed_mps', view, fps, club * 1.33, club * 0.1, [RC.ROLLING_SHUTTER_ASSUMED, RC.SMASH_ASSUMED], 'derived', 1);
      m.carry_m = cell('carry_m', view, fps, carry, carry * 0.11, [RC.FLIGHT_MODELLED, RC.WIND_IGNORED, RC.SPIN_ASSUMED, ...HB_ASSUMED], 'ballistics', 1);
      m.club_path_deg = cell('club_path_deg', view, fps, g(2.5), 3, [RC.ROLLING_SHUTTER_ASSUMED], 'club_track', 1);
      m.launch_h_deg = cell('launch_h_deg', view, fps, (side / carry) * 57.3 * 0.6 + g(0.5), 0.5, [RC.ROLLING_SHUTTER_ASSUMED], 'ball_fit3d', 1);
      Object.assign(m, lmMetrics(view, fps, {
        face_angle_deg: [m.launch_h_deg.value * 1.2 + g(0.5), 2], face_to_path_deg: [g(2.5), 3.5], spin_axis_deg: [g(6), 9],
        total_m: [carry + N[7] + g(2), 0.11 * carry + N[7] * 0.5], carry_side_m: [side, 0.08 * carry], total_side_m: [side * 1.05, 0.085 * carry],
        curve_m: [side * 0.5 + g(2), 0.07 * carry],
      }));
    }
    shots.push(s);
  }
  return { format: 'golf-swing-lab-export/1', exported_at: '2026-11-06T00:00:00.000Z', app_version: '0.2.0+fixture', venues: [venue], presets, sessions, shots };
}

// ------------------------------------------------------------------------------------------- main
function main() {
  const check = process.argv.includes('--check');
  const fo = faceOn240();
  const files = {
    [path.join(V2, 'valid_face_on_240.json')]: fo,
    [path.join(V2, 'valid_face_on_240_no_clip.json')]: faceOnNoClip(fo),
    [path.join(V2, 'valid_high_behind_240.json')]: highBehind240(),
    [path.join(V2, 'valid_dtl_30.json')]: dtl30(),
    [path.join(V2, 'migrated_v1_face_on.json')]: migrateShot(readV1('valid_face_on_240')).shot,
  };
  for (const [name, s] of Object.entries(badFixtures(fo))) files[path.join(V2, `${name}.json`)] = s;
  const tpl = { face_on: fo, high_behind: files[path.join(V2, 'valid_high_behind_240.json')], dtl: files[path.join(V2, 'valid_dtl_30.json')] };
  files[path.join(LM, 'sessions-1000.json')] = sessions1000(tpl);

  const problems = [];
  for (const [file, obj] of Object.entries(files)) {
    const base = path.basename(file);
    const shots = Array.isArray(obj.shots) ? obj.shots : [Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith('_')))];
    for (const s of shots) {
      const r = validateShot(s);
      if (s.schema !== SCHEMA_ID) problems.push(`${base}: schema ${s.schema}`);
      if (base.startsWith('bad_')) {
        const rule = base.slice(4, -5);
        if (r.errors.length !== 1 || !r.errors[0].msg.includes(rule)) problems.push(`${base}: expected exactly one error naming ${rule}, got ${JSON.stringify(r.errors.slice(0, 3))}`);
      } else if (!r.ok) problems.push(`${base} ${s.shot_id}: ${JSON.stringify(r.errors.slice(0, 3))}`);
    }
    for (const s of shots) {
      if (!s.flight || !s.tracks) continue;
      const p = project(s.calibration.camera, s.flight.samples[0].slice(1));
      const t = s.tracks.ball_px.find((b) => b[0] === s.tracks.impact_frame);
      if (!t || Math.hypot(p.u - t[1], p.v - t[2]) > 2) problems.push(`${base}: samples[0] projects to (${p.u}, ${p.v}), impact-frame track ${t}`);
    }
  }
  if (problems.length) { for (const p of problems) console.log(`FAIL ${p}`); process.exitCode = 1; return; }
  let stale = 0;
  for (const [file, obj] of Object.entries(files)) {
    const text = file.endsWith('sessions-1000.json') ? `${JSON.stringify(obj)}\n` : `${JSON.stringify(obj, null, 2)}\n`;
    if (check) {
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) { stale++; console.log(`STALE ${path.relative(ROOT, file)}`); }
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  if (check) { process.exitCode = stale ? 1 : 0; console.log(`make_lm_fixtures: ${stale ? `${stale} stale file(s)` : 'up to date'}`); return; }
  console.log(`make_lm_fixtures: wrote ${Object.keys(files).length} files (${files[path.join(LM, 'sessions-1000.json')].shots.length} session shots)`);
}

main();
