// Shared fixtures for tests/unit/store.*.test.mjs (not a test file itself). JSON-safe data only (no undefined),
// so that export -> JSON text -> import can be compared with deepStrictEqual.

import { mulberry32, gauss } from '../../app/src/geom/rng.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { MemBackend } from '../../app/src/store/mem.js';
import { openRepository } from '../../app/src/store/core.js';

export async function openMem(opts) {
  return openRepository(new MemBackend(), opts);
}

export const accept = () => ({ ok: true, errors: [] });

export function makeVenue(id = 'venue-1', over = {}) {
  return {
    venue_id: id, name: '測試練習場', created_at: '2026-11-01T08:00:00.000Z', revision: 1,
    mat_L: 1.5, mat_W: 1.5, ball_edge_m: 0.3, ball_x_m: 0, f_locked: 1510.5, ...over,
  };
}

export function makePreset(id, venueId = 'venue-1', view = 'face_on', over = {}) {
  return {
    preset_id: id, venue_id: venueId, view, created_at: '2026-11-01T09:00:00.000Z', revision: 1,
    pose: { yaw_deg: 0.4, pitch_deg: -0.1, roll_deg: 0.2, X_m: 0.4, Y_m: -2.7, h_m: 0.84, D_m: 2.73 }, ...over,
  };
}

export function makeSession(id, venueId = 'venue-1', createdAt = '2026-11-02T10:00:00.000Z', over = {}) {
  return { session_id: id, venue_id: venueId, created_at: createdAt, revision: 1, ...over };
}

function metric(value, unit, rng, validity = 'valid') {
  const sigma = Math.abs(value) * 0.02 + 0.001;
  return {
    value, unit, ci95: [value - 1.96 * sigma, value + 1.96 * sigma], sigma,
    validity, value_origin: 'pose', measured: false, reason_codes: [],
  };
}

function nullMetric(unit, validity = 'not_observable', codes = [RC.VIEW_DEPTH_AXIS]) {
  return { value: null, unit, ci95: null, sigma: null, validity, value_origin: 'pose', measured: false, reason_codes: codes };
}

// opts: { id, session_id, preset_id, venue_id, view, club_type, lie, created_at, revision, note, starred, seed }
export function makeShot(opts = {}) {
  const o = {
    id: 'shot-1', session_id: 'session-1', preset_id: 'preset-A', venue_id: 'venue-1', view: 'face_on',
    club_type: '7i', lie: 'mat', created_at: '2026-11-02T10:00:00.000Z', revision: 1, note: '', starred: false,
    seed: 1, ...opts,
  };
  const rng = mulberry32(o.seed);
  const tempo = 3 + gauss(rng, 0, 0.2);
  return {
    schema: 'golf-shot/1',
    shot_id: o.id,
    session_id: o.session_id,
    venue_id: o.venue_id,
    preset_id: o.preset_id,
    created_at: o.created_at,
    app_version: '0.1.0-test',
    capture: { mode: 'live', view: o.view, source: 'camera', orientation: 'landscape', width: 1920, height: 1080, nominal_fps: 60, effective_fps: 59.94, vfr: false, timestamps: 'container', clip_ref: null, trim_s: [0, 4] },
    club: { type: o.club_type, length_m: 0.94, lie: o.lie, tee_lift_m: 0, tee_lift_source: 'assumed' },
    handedness: 'right',
    metrics: {
      backswing_s: metric(0.75 + gauss(rng, 0, 0.03), 's', rng),
      downswing_s: metric(0.25 + gauss(rng, 0, 0.01), 's', rng),
      tempo_ratio: metric(tempo, 'ratio', rng),
      head_sway_x_m: metric(0.05 + gauss(rng, 0, 0.01), 'm', rng, 'low_confidence'),
      head_depth_y_m: nullMetric('m'),
      club_speed_mps: metric(35 + gauss(rng, 0, 1), 'm/s', rng, 'estimated'),
      ball_speed_mps: nullMetric('m/s', 'not_observable', [RC.FPS_TOO_LOW]),
    },
    quality: { pose_mean_vis: 0.9, frames_analyzed: 200, frames_dropped: 0, audio_onset: true, touches: 0, warnings: [] },
    starred: o.starred,
    note: o.note,
    revision: o.revision,
  };
}

// 1 venue, 2 presets (face_on / dtl), 2 sessions, 4 shots.
export function makeDataset() {
  return {
    venues: [makeVenue('venue-1')],
    presets: [makePreset('preset-A', 'venue-1', 'face_on'), makePreset('preset-B', 'venue-1', 'dtl')],
    sessions: [makeSession('session-1', 'venue-1', '2026-11-02T10:00:00.000Z'), makeSession('session-2', 'venue-1', '2026-11-03T10:00:00.000Z')],
    shots: [
      makeShot({ id: 'shot-1', seed: 1, created_at: '2026-11-02T10:01:00.000Z' }),
      makeShot({ id: 'shot-2', seed: 2, created_at: '2026-11-02T10:02:00.000Z', club_type: 'driver', lie: 'tee', note: 'a, "quoted"\nsecond line' }),
      makeShot({ id: 'shot-3', seed: 3, session_id: 'session-2', preset_id: 'preset-B', view: 'dtl', created_at: '2026-11-03T10:01:00.000Z', starred: true }),
      makeShot({ id: 'shot-4', seed: 4, session_id: 'session-2', preset_id: 'preset-B', view: 'dtl', club_type: '5w', created_at: '2026-11-03T10:02:00.000Z' }),
    ],
  };
}

export async function fillRepo(repo, ds = makeDataset()) {
  await repo.putMany('venues', ds.venues);
  await repo.putMany('presets', ds.presets);
  await repo.putMany('sessions', ds.sessions);
  await repo.putMany('shots', ds.shots);
  return ds;
}

export async function dumpRepo(repo, names = ['venues', 'presets', 'sessions', 'shots', 'poses']) {
  const out = {};
  for (const n of names) out[n] = await repo.list(n);
  return out;
}

export const hasChinese = (s) => /[一-鿿]/.test(s);
