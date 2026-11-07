// pipeline/assemble.js face_on 240 fps on rendered frames: the real chain (events -> metrics -> track.analyzeClip
// -> physics.analyzeFaceOn -> contract) on one synthetic shot from tests/synth/e2e.js. Kept in its own file so
// node --test runs it in parallel with the cheaper assemble tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleShot } from '../../app/src/pipeline/assemble.js';
import { m4Specs, buildE2EShot } from '../synth/e2e.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { EVENTS } from '../../app/src/contract/enums.js';
import { assertContract } from './pipeline.helpers.mjs';

const SETS = m4Specs({ seed: 1, quick: true });

test('face_on 240: rendered frames -> track -> fit3d -> a valid shot with ball speed, launch and carry', () => {
  const spec = SETS.main[2];
  const b = buildE2EShot(spec);
  const r = assembleShot(b.input);
  const { shot } = r;
  assertContract(shot);
  const m = shot.metrics;
  const t = b.truth;
  assert.equal(shot.schema, 'golf-shot/2');
  assert.equal(shot.capture.timestamps, 'container');
  assert.ok(Array.isArray(shot.capture.trim_s) && shot.capture.trim_s[0] < shot.capture.trim_s[1]);
  assert.ok(m.ball_speed_mps.value !== null, JSON.stringify(m.ball_speed_mps));
  assert.ok(Math.abs(m.ball_speed_mps.value - t.speed) / t.speed < 0.05, `speed ${m.ball_speed_mps.value} vs ${t.speed}`);
  assert.ok(Math.abs(m.launch_v_deg.value - t.launch_v_deg) < 2.5);
  assert.equal(m.ball_speed_mps.value_origin, 'ball_fit3d');
  // carry and the flight rows come from physics/lm; no club head rendered -> no attack angle -> spin prior (SPIN_ASSUMED)
  assert.equal(m.carry_m.validity, 'estimated');
  assert.ok(m.carry_m.reason_codes.includes(RC.SPIN_ASSUMED) && m.carry_m.reason_codes.includes(RC.WIND_IGNORED));
  assert.ok(m.carry_m.reason_codes.includes(RC.FLIGHT_MODELLED));
  for (const id of ['total_m', 'apex_m', 'landing_angle_deg', 'hang_time_s']) assert.equal(m[id].validity, 'estimated', id);
  assert.deepEqual(m.attack_angle_deg.reason_codes, [RC.TRACK_TOO_SHORT]);
  assert.deepEqual(m.spin_rate_rpm.reason_codes, [RC.DEPENDS_ON_NULL]);
  for (const id of ['face_angle_deg', 'carry_side_m', 'spin_axis_deg']) assert.ok(m[id].reason_codes.includes(RC.LAUNCH_DIR_UNOBSERVABLE), id);
  assert.ok(shot.flight && Math.abs(shot.flight.landing.x_m - m.carry_m.value) <= 0.5 && shot.flight.samples.length <= 64);
  assert.ok(shot.tracks && shot.tracks.view === 'face_on' && shot.tracks.ball_px.length >= 5);
  assert.notEqual(shot.algorithms.lm.version, 'none');
  assert.equal(m.launch_h_deg.value, null);
  assert.ok(m.launch_h_deg.reason_codes.includes(RC.LAUNCH_DIR_UNOBSERVABLE));
  assert.equal(m.club_path_deg.value, null);
  assert.ok(m.club_path_deg.reason_codes.includes(RC.VIEW_PLANE_MISMATCH));
  // no club head rendered -> club speed and smash factor are honest nulls, never numbers without a source
  if (m.club_speed_mps.value === null) assert.equal(m.smash_factor.value, null);
  assert.ok(m.backswing_s.value !== null && m.tempo_ratio.value !== null);
  for (const e of EVENTS) assert.ok(Number.isInteger(shot.events[e].frame) && shot.events[e].source === 'rules');
  assert.ok(r.debug.fit.ok && r.debug.fit2d.ok && r.debug.track.n >= 5);
  for (const k of ['events', 'metrics', 'track', 'physics', 'total']) assert.ok(Number.isFinite(r.timings_ms[k]));

  // same input + a setup-level warning: attribution rule (CAFCR F3)
  // (reusing the 2D track of the first call, as a P6 recompute would; the tracking does not depend on warnings)
  assert.ok(r.track && r.track.ballTrack.n === r.debug.track.n);
  const r2 = assembleShot({ ...b.input, warnings: [RC.SETUP_UNVERIFIED], track: r.track });
  assert.equal(r2.timings_ms.track < r.timings_ms.track, true);
  assertContract(r2.shot);
  assert.ok(r2.shot.quality.warnings.includes(RC.SETUP_UNVERIFIED));
  assert.equal(r2.shot.metrics.ball_speed_mps.validity, 'low_confidence');
  assert.ok(r2.shot.metrics.ball_speed_mps.reason_codes.includes(RC.SETUP_UNVERIFIED));
  assert.equal(r2.shot.metrics.ball_speed_mps.value, m.ball_speed_mps.value, 'deterministic for the same seed');
  assert.equal(r2.shot.metrics.carry_m.validity, 'low_confidence');
  assert.ok(r2.shot.metrics.total_m.reason_codes.includes(RC.SETUP_UNVERIFIED));
});

