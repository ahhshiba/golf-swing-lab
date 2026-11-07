// pipeline/assemble.js: one golf-shot/2 per view / frame rate, honest nulls from the registry, shot-level time
// checks, warning attribution, contract validity of every output. The face_on 240 case runs the real chain on
// rendered frames (tests/synth/e2e.js), the others skip the frame rendering.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleShot, registryFps, sha256Hex, DOWNSWING_RANGE_S } from '../../app/src/pipeline/assemble.js';
import { m4Specs, buildE2EShot } from '../synth/e2e.js';
import { highBehindShot, highBehindInput, clubSpeedSwing, clubSpeedInput } from '../synth/cells.js';
import { ContractError } from '../../app/src/contract/validate.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { METRIC_IDS, EVENTS } from '../../app/src/contract/enums.js';
import { REGISTRY, cellFor, nullCodeFor } from '../../app/src/metrics/registry.js';
import { assertContract } from './pipeline.helpers.mjs';
import { LM_PARAMS } from '../../app/src/physics/lm/index.js';

const SETS = m4Specs({ seed: 1, quick: true });

test('sha256Hex matches the FIPS 180-4 test vectors', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  assert.equal(sha256Hex('a'.repeat(1000)), '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
});

test('registryFps: a 239.94 fps slow-motion file is in the 240 fps class; 200 stays 200', () => {
  assert.equal(registryFps({ nominal_fps: 240, effective_fps: 239.94 }), 240);
  assert.equal(registryFps({ nominal_fps: 240, effective_fps: 200 }), 200);
  assert.equal(registryFps({ nominal_fps: 30, effective_fps: 30 }), 30);
});

test('P6: a shot\'s own events can be passed back in (re-indexed from t_s, same metrics)', () => {
  const b = buildE2EShot({ ...SETS.main[1], render: false });
  const a = assembleShot(b.input).shot;
  const r = assembleShot({ ...b.input, events: a.events }).shot;
  assertContract(r);
  for (const e of EVENTS) {
    assert.equal(r.events[e].t_s, a.events[e].t_s);
    assert.equal(r.events[e].frame, a.events[e].frame);
  }
  assert.deepEqual(r.metrics, a.metrics);
});

test('face_on 30 fps: rows 16, 17, 19, 20 null + FPS_TOO_LOW (registry); pose rows still computed', () => {
  const b = buildE2EShot({ ...SETS.fps30[0], render: false });
  const { shot } = assembleShot(b.input);
  assertContract(shot);
  for (const id of ['ball_speed_mps', 'launch_v_deg', 'carry_m', 'smash_factor']) {
    assert.equal(shot.metrics[id].value, null);
    assert.ok(shot.metrics[id].reason_codes.includes(RC.FPS_TOO_LOW), `${id}: ${shot.metrics[id].reason_codes}`);
  }
  // row 14 is 低 at 30 fps (F2): estimated from pose (lead-wrist peak speed × lever, metrics/club.js), never NOT_IMPLEMENTED
  const cs = shot.metrics.club_speed_mps;
  assert.ok(!cs.reason_codes.includes(RC.NOT_IMPLEMENTED));
  assert.ok(cs.value === null ? cs.reason_codes.length > 0 : cs.validity === 'low_confidence' && cs.value_origin === 'pose', JSON.stringify(cs));
  assert.ok(shot.metrics.head_sway_x_m.value !== null && shot.metrics.backswing_s.value !== null);
});

test('dtl 60 fps: all ball rows null with VIEW_DEPTH_AXIS; dtl pose rows computed', () => {
  const b = buildE2EShot(SETS.dtl[0]);
  const { shot } = assembleShot(b.input);
  assertContract(shot);
  assert.equal(shot.capture.orientation, 'portrait-primary');
  for (const id of ['club_speed_mps', 'ball_speed_mps', 'launch_v_deg', 'carry_m']) {
    assert.equal(shot.metrics[id].value, null);
    assert.ok(shot.metrics[id].reason_codes.includes(REGISTRY[id].nullCode));
  }
  assert.ok(shot.metrics.launch_h_deg.reason_codes.includes(RC.LAUNCH_DIR_UNOBSERVABLE));
  assert.ok(shot.metrics.spine_forward_tilt_deg.value !== null);
  assert.equal(shot.metrics.spine_side_tilt_deg.value, null);
});

test('high_behind 240 without ball frames: ball speed null; club path / launch_h TRACK_TOO_SHORT', () => {
  const b = buildE2EShot(SETS.high_behind[0]);
  const { shot } = assembleShot(b.input);
  assertContract(shot);
  assert.equal(shot.metrics.ball_speed_mps.value, null);
  // the high_behind ball-speed cell is 低 (LAUNCH-MONITOR-SPEC §1.3-2, physics/lm): no club-head track -> honest null
  assert.ok(shot.metrics.ball_speed_mps.reason_codes.length > 0);
  assert.equal(shot.flight, null);
  assert.deepEqual(shot.metrics.club_path_deg.reason_codes, [RC.TRACK_TOO_SHORT]);
  assert.deepEqual(shot.metrics.launch_h_deg.reason_codes, [RC.TRACK_TOO_SHORT]);
  assert.ok(shot.metrics.head_lift_z_m.reason_codes.includes(RC.VIEW_DEPTH_AXIS));
});

test('high_behind 240 with club-head and ball tracks: club path and launch_h low_confidence, close to the truth', () => {
  for (const i of [0, 1, 2]) {
    const s = highBehindShot({ seed: 4, i });
    const { shot, debug } = assembleShot(highBehindInput(s, { seed: 4, i }));
    assertContract(shot);
    const p = shot.metrics.club_path_deg;
    const l = shot.metrics.launch_h_deg;
    assert.equal(p.validity, 'low_confidence', JSON.stringify(p));
    assert.equal(l.validity, 'low_confidence', JSON.stringify(l));
    assert.equal(p.value_origin, 'club_track');
    assert.equal(l.value_origin, 'ball_fit3d');
    assert.ok(Math.abs(p.value - s.truth.club_path_deg) < 4 * p.sigma + 0.5, `${i} path ${p.value} vs ${s.truth.club_path_deg} σ ${p.sigma}`);
    assert.ok(Math.abs(l.value - s.truth.launch_h_deg) < 4 * l.sigma + 0.2, `${i} psi ${l.value} vs ${s.truth.launch_h_deg} σ ${l.sigma}`);
    assert.ok(p.sigma > 0.5 && p.sigma < 5 && l.sigma > 0.1 && l.sigma < 3);
    assert.ok(debug.high_behind && debug.high_behind.path.n_used >= 2);
    // the 不可 ball rows stay null with their code; the cells LAUNCH-MONITOR-SPEC §1.3-2 turned into 低 (club speed,
    // ball speed, carry) come from physics/lm: low_confidence with the prior codes, never better than the cell
    for (const id of ['launch_v_deg', 'smash_factor']) {
      assert.equal(shot.metrics[id].value, null, id);
      assert.deepEqual(shot.metrics[id].reason_codes, [nullCodeFor(id, 'high_behind')], id);
    }
    for (const id of ['club_speed_mps', 'ball_speed_mps', 'carry_m', 'face_angle_deg', 'spin_axis_deg', 'carry_side_m']) {
      const m = shot.metrics[id];
      assert.equal(m.validity, 'low_confidence', `${id} ${JSON.stringify(m)}`);
      assert.ok(m.ci95[0] <= m.value && m.value <= m.ci95[1] && m.sigma > 0, id);
    }
    assert.ok(shot.metrics.ball_speed_mps.reason_codes.includes(RC.SMASH_ASSUMED));
    assert.ok(shot.metrics.carry_m.reason_codes.includes(RC.LAUNCH_V_ASSUMED) && shot.metrics.carry_m.reason_codes.includes(RC.FLIGHT_MODELLED));
    for (const id of ['apex_m', 'spin_rate_rpm']) assert.equal(shot.metrics[id].value, null, id);
    assert.ok(shot.flight && Math.abs(shot.flight.landing.x_m - shot.metrics.carry_m.value) <= 0.5 && shot.flight.band);
    assert.equal(shot.algorithms.lm.version, LM_PARAMS.version);
  }
});

test('high_behind: camera > 0.15 m off the ball line -> SETUP_UNVERIFIED (C1.3 red light)', () => {
  const s = highBehindShot({ seed: 4, i: 0 });
  const input = highBehindInput(s, { seed: 4, i: 0 });
  const pose = { ...input.calibration.pose, Y_m: 0.2 };
  const { shot } = assembleShot({ ...input, calibration: { ...input.calibration, pose } });
  assertContract(shot);
  assert.ok(shot.quality.warnings.includes(RC.SETUP_UNVERIFIED));
  assert.ok(shot.metrics.club_path_deg.reason_codes.includes(RC.SETUP_UNVERIFIED));
  const ok = assembleShot(input).shot;
  assert.ok(Math.abs(input.calibration.pose.Y_m) > 0.15 || !ok.quality.warnings.includes(RC.SETUP_UNVERIFIED));
});

test('high_behind club path: fewer than 2 head samples within ±0.15 m of impact -> TRACK_TOO_SHORT', () => {
  const s = highBehindShot({ seed: 4, i: 1 });
  const input = highBehindInput(s, { seed: 4, i: 1 });
  const { shot } = assembleShot({ ...input, track: { ...input.track, clubTrack: s.clubObs.slice(0, 2) } });
  assertContract(shot);
  assert.equal(shot.metrics.club_path_deg.value, null);
  assert.deepEqual(shot.metrics.club_path_deg.reason_codes, [RC.TRACK_TOO_SHORT]);
  assert.notEqual(shot.metrics.launch_h_deg.value, null);
});

test('face_on 30 / 60 fps with realistic hand kinematics: pose club speed within its ±25 % band', () => {
  for (const [i, fps] of [[0, 30], [1, 60], [2, 30], [3, 60]]) {
    const c = clubSpeedSwing({ seed: 4, i, fps });
    const { shot } = assembleShot(clubSpeedInput(c, { seed: 4, i }));
    assertContract(shot);
    const m = shot.metrics.club_speed_mps;
    assert.equal(m.validity, 'low_confidence', JSON.stringify(m));
    assert.equal(m.value_origin, 'pose');
    assert.ok(m.ci95[0] <= c.truth.club_speed_mps && c.truth.club_speed_mps <= m.ci95[1], `${i}@${fps}: ${m.value} [${m.ci95}] vs ${c.truth.club_speed_mps}`);
    assert.ok(m.ci95[1] - m.value >= 0.25 * m.value - 1e-9 && m.value - m.ci95[0] >= 0.25 * m.value - 1e-9);
    // smash factor needs the 240 fps club-head track (F2 row 20), carry the ball rows
    assert.ok(shot.metrics.smash_factor.reason_codes.includes(RC.FPS_TOO_LOW));
  }
});

test('no allowed F2 cell returns NOT_IMPLEMENTED, in any view / frame rate, with or without track data', () => {
  const cases = [];
  for (const b of [{ ...SETS.main[1], render: false }, { ...SETS.fps30[0], render: false }, SETS.dtl[0], SETS.high_behind[0]]) {
    cases.push(assembleShot(buildE2EShot(b).input).shot);
  }
  cases.push(assembleShot(buildE2EShot(SETS.main[0]).input).shot); // face_on 240 with rendered ball frames
  const s = highBehindShot({ seed: 4, i: 2 });
  cases.push(assembleShot(highBehindInput(s, { seed: 4, i: 2 })).shot);
  const c = clubSpeedSwing({ seed: 4, i: 4, fps: 60 });
  cases.push(assembleShot(clubSpeedInput(c, { seed: 4, i: 4 })).shot);
  for (const shot of cases) {
    assertContract(shot);
    const fps = registryFps(shot.capture);
    for (const id of METRIC_IDS) {
      const m = shot.metrics[id];
      const cell = cellFor(id, shot.capture.view, fps);
      assert.ok(!m.reason_codes.includes(RC.NOT_IMPLEMENTED), `${shot.capture.view}@${fps} ${id}: NOT_IMPLEMENTED`);
      if (cell.validity === null) assert.equal(m.value, null, `${shot.capture.view} ${id} must be null`);
      else if (m.value !== null) {
        const rank = { valid: 0, estimated: 1, low_confidence: 2 };
        assert.ok(rank[m.validity] >= rank[cell.validity], `${shot.capture.view} ${id}: ${m.validity} better than F2 ${cell.validity}`);
      }
    }
  }
  // the registry itself: every allowed cell of rows 14–20 is one of the cells produced somewhere
  // rows 14–20 by physics/ (analyzeFaceOn, analyzeHighBehind) and the launch-monitor cells by physics/lm
  const produced = {
    face_on: ['club_speed_mps', 'ball_speed_mps', 'launch_v_deg', 'carry_m', 'smash_factor', 'attack_angle_deg', 'dynamic_loft_deg',
      'spin_loft_deg', 'spin_rate_rpm', 'total_m', 'apex_m', 'landing_angle_deg', 'hang_time_s'],
    dtl: [],
    high_behind: ['club_path_deg', 'launch_h_deg', 'club_speed_mps', 'ball_speed_mps', 'carry_m', 'face_angle_deg', 'face_to_path_deg',
      'spin_axis_deg', 'total_m', 'carry_side_m', 'total_side_m', 'curve_m'],
  };
  for (const id of METRIC_IDS.filter((x) => REGISTRY[x].row >= 14)) {
    for (const view of ['face_on', 'dtl', 'high_behind']) {
      if (REGISTRY[id].views[view] !== 'not') assert.ok(produced[view].includes(id), `${view} ${id} allowed but not produced`);
      else assert.ok(!produced[view].includes(id), `${view} ${id} produced but 不可`);
    }
  }
});

test('missing pose: pose metrics null with codes, events placeholder, still a valid shot', () => {
  const b = buildE2EShot({ ...SETS.main[1], render: false });
  const { shot } = assembleShot({ ...b.input, poseSeq: null, events: null });
  assertContract(shot);
  assert.ok(shot.quality.warnings.includes(RC.EVENTS_UNCERTAIN));
  assert.equal(shot.quality.pose_mean_vis, null);
  for (const e of EVENTS) assert.equal(shot.events[e].conf, 0);
  for (const id of ['backswing_s', 'downswing_s', 'tempo_ratio']) assert.deepEqual(shot.metrics[id].reason_codes, [RC.EVENTS_UNCERTAIN]);
  for (const id of METRIC_IDS.filter((x) => REGISTRY[x].row >= 2 && REGISTRY[x].row <= 13)) {
    const m = shot.metrics[id];
    assert.equal(m.value, null, id);
    assert.ok(m.reason_codes.length > 0);
    if (cellFor(id, 'face_on', 240).validity !== null) assert.ok(m.reason_codes.includes(RC.POSE_LOW_VISIBILITY), `${id}: ${m.reason_codes}`);
  }
  // face_on 240 without ball frames: the ball cells are allowed but there was nothing to track
  assert.deepEqual(shot.metrics.ball_speed_mps.reason_codes, [RC.TRACK_TOO_SHORT]);

  // pose missing but events known (e.g. corrected by hand): tempo comes back, pose rows stay null
  const withEv = assembleShot(b.input);
  const r = assembleShot({ ...b.input, poseSeq: null, events: withEv.shot.events });
  assertContract(r.shot);
  assert.ok(r.shot.metrics.backswing_s.value !== null);
  assert.ok(r.shot.metrics.head_sway_x_m.reason_codes.includes(RC.POSE_LOW_VISIBILITY));
});

test('time base: TIMEBASE_SUSPECT outside the downswing range, TIMESTAMPS_NOMINAL for broken CTS', () => {
  const b = buildE2EShot({ ...SETS.main[1], render: false });
  const base = assembleShot(b.input).shot;
  const ev = structuredClone(base.events);
  const slow = DOWNSWING_RANGE_S[1] + 0.3;
  for (const e of ['impact', 'mid_follow_through', 'finish']) ev[e].t_s += slow;
  const { shot } = assembleShot({ ...b.input, events: ev, poseSeq: null });
  assertContract(shot);
  assert.ok(shot.quality.warnings.includes(RC.TIMEBASE_SUSPECT));
  const ds = shot.metrics.downswing_s;
  assert.ok(ds.value === null ? ds.reason_codes.includes(RC.TIMEBASE_SUSPECT) : ds.validity === 'low_confidence' && ds.reason_codes.includes(RC.TIMEBASE_SUSPECT));

  const cts = [...b.input.capture.timestamps];
  [cts[10], cts[11]] = [cts[11], cts[10]];
  const r = assembleShot({ ...b.input, capture: { ...b.input.capture, timestamps: cts } });
  assertContract(r.shot);
  assert.equal(r.shot.capture.timestamps, 'nominal');
  assert.ok(r.shot.quality.warnings.includes(RC.TIMESTAMPS_NOMINAL));
  assert.ok(r.shot.metrics.backswing_s.reason_codes.includes(RC.TIMESTAMPS_NOMINAL));
});

test('bad input: unknown warning -> RangeError; contract violation -> ContractError; no calibration -> TypeError', () => {
  const b = buildE2EShot({ ...SETS.main[1], render: false });
  assert.throws(() => assembleShot({ ...b.input, warnings: ['NOT_A_CODE'] }), RangeError);
  assert.throws(() => assembleShot({ ...b.input, ids: { ...b.input.ids, created_at: 'yesterday' } }), ContractError);
  assert.throws(() => assembleShot({ ...b.input, calibration: null }), TypeError);
  assert.throws(() => assembleShot({ ...b.input, capture: { ...b.input.capture, view: 'side' } }), RangeError);
});

// ---- V04-SPEC §F.1 / §G.3 V4-E 3: tracks.club_px (golf-shot/2 rev 2) from the track/club.js observations
import { clubPx, withClubPx } from '../../app/src/pipeline/assemble.js';
import { validateShot } from '../../app/src/contract/validate.js';

test('face_on 240 synthetic clip: tracks.club_px non-empty, frames increasing, valid golf-shot/2', () => {
  const b = buildE2EShot({ ...SETS.main[0], render: true });
  const first = assembleShot(b.input);
  assert.ok(first.shot.tracks && first.shot.tracks.ball_px.length > 0, 'the synthetic face_on 240 shot has a ball track');
  // the synthetic renderer draws no club (club: null), so the club-head observations of track/club.js are injected:
  // a head sweeping into the resting ball over the last 8 frames before the departure (full-image px, as analyzeClip)
  const rest = first.track.restBall;
  const times = b.input.ballFrames.times;
  const dep = first.track.info?.departure ?? 30;
  const clubTrack = Array.from({ length: 8 }, (_, k) => ({ frame: dep - 8 + k, t_s: times[dep - 8 + k], u: rest.u - (8 - k) * 9, v: rest.v - (8 - k) * 2, conf: 0.4 }));
  const { shot } = assembleShot({ ...b.input, track: { ...first.track, clubTrack } });
  assertContract(shot);
  const c = shot.tracks.club_px;
  assert.ok(Array.isArray(c) && c.length === 8, JSON.stringify(c));
  for (let i = 1; i < c.length; i++) assert.ok(c[i][0] > c[i - 1][0], `frame ${c[i][0]} after ${c[i - 1][0]}`);
  assert.ok(c.every((p) => p.length === 3 && Number.isInteger(p[0]) && p[0] >= 0));
  // club frames are capture-frame numbers on the same scale as ball_px: the head reaches the ball before it leaves
  assert.ok(c[c.length - 1][0] <= shot.tracks.ball_px[0][0] + 1, `${c[c.length - 1][0]} vs ball ${shot.tracks.ball_px[0][0]}`);
  assert.equal(validateShot(shot).ok, true);
  // without club observations nothing is added (no empty club_px)
  assert.equal('club_px' in first.shot.tracks, false);
});

test('high_behind 240 with a club-head track: tracks.club_px written and valid', () => {
  const s = highBehindShot({ seed: 4, i: 0 });
  const { shot } = assembleShot(highBehindInput(s, { seed: 4, i: 0 }));
  assertContract(shot);
  assert.ok(shot.tracks && shot.tracks.ball_px.length > 0, "the fixture has a ball track (club_px needs ball_px next to it)");
  assert.ok(shot.tracks.club_px.length >= 2);
  assert.equal(validateShot(shot).ok, true);
});

test('clubPx: nearest capture frame, duplicates dropped, unsorted input sorted, thinned to 40 evenly', () => {
  const times = Array.from({ length: 500 }, (_, i) => i / 240);
  const obs = [{ t_s: 10 / 240, u: 1.234, v: 2 }, { t_s: 9 / 240, u: 0, v: 0 }, { t_s: 10.2 / 240, u: 5, v: 5 }, { t_s: NaN, u: 1, v: 1 }];
  assert.deepEqual(clubPx(obs, times, 240), [[9, 0, 0], [10, 1.23, 2]]);
  assert.deepEqual(clubPx([{ t_s: 0.5, u: 1, v: 1 }], null, 240), [[120, 1, 1]]);
  const many = Array.from({ length: 100 }, (_, i) => ({ t_s: i / 240, u: i, v: i }));
  const out = clubPx(many, times, 240);
  assert.equal(out.length, 40);
  assert.deepEqual(out[0], [0, 0, 0]);
  assert.deepEqual(out[39], [99, 99, 99]);
  for (let i = 1; i < out.length; i++) assert.ok(out[i][0] > out[i - 1][0]);
});

test('withClubPx: all-non-finite club observations → no club_px key (never club_px: [])', () => {
  const tracks = { ball_px: [[1, 2, 3]] };
  assert.deepEqual(withClubPx(tracks, [{ t_s: NaN, u: 1, v: 1 }, { t_s: 0.1, u: Infinity, v: 2 }], null, 240), tracks);
  assert.ok(!('club_px' in withClubPx(tracks, [{ t_s: NaN, u: 1, v: 1 }], null, 240)));
  assert.deepEqual(withClubPx(tracks, [{ t_s: 0.5, u: 1, v: 1 }], null, 240).club_px, [[120, 1, 1]]);
  assert.equal(withClubPx(null, [{ t_s: 0.5, u: 1, v: 1 }], null, 240), null);
  assert.equal(withClubPx(tracks, [], null, 240), tracks);
});
