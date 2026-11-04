import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RC, REASON_CODES, validateShot, validateMetric, assertValid, formatErrors, ContractError, VALUE_VALIDITIES, VALIDITIES,
  METRIC_IDS, METRIC_UNITS, EVENTS, SETUP_LEVEL_CODES, BALL_CLUB_IDS, isAffectedBySetup, VALUE_ORIGINS,
} from '../../app/src/contract/index.js';

const FX = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/shots');
const load = (name) => {
  const raw = JSON.parse(readFileSync(join(FX, `${name}.json`), 'utf8'));
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('_')));
};
const fixtureNames = readdirSync(FX).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
const clone = (x) => JSON.parse(JSON.stringify(x));
const texts = (r) => r.errors.map((e) => `${e.path}: ${e.msg}`);

/** Mutate a copy of a valid fixture and require exactly one error containing `expect`. */
function expectOne(name, mutate, expect) {
  const s = clone(load(name));
  mutate(s);
  const r = validateShot(s);
  assert.equal(r.ok, false, `expected an error containing "${expect}"`);
  assert.equal(r.errors.length, 1, texts(r).join(' | '));
  assert.ok(texts(r)[0].includes(expect), `"${texts(r)[0]}" should include "${expect}"`);
}

test('fixtures: valid_* pass, bad_* fail with exactly the expected error', () => {
  const valid = fixtureNames.filter((n) => n.startsWith('valid_'));
  const bad = fixtureNames.filter((n) => n.startsWith('bad_'));
  assert.ok(valid.length >= 3 && bad.length >= 8, `${valid.length} valid, ${bad.length} bad`);
  for (const n of valid) {
    const r = validateShot(load(n));
    assert.deepEqual(texts(r), [], n);
    assert.equal(r.ok, true);
  }
  for (const n of bad) {
    const raw = JSON.parse(readFileSync(join(FX, `${n}.json`), 'utf8'));
    assert.equal(typeof raw._expect, 'string', n);
    const r = validateShot(load(n));
    assert.equal(r.ok, false, n);
    assert.ok(texts(r).some((t) => t.includes(raw._expect)), `${n}: ${texts(r).join(' | ')}`);
    assert.equal(r.errors.length, raw._expect_errors ?? 1, `${n}: ${texts(r).join(' | ')}`);
  }
});

test('valid fixtures cover the three views, 240 and 30 fps, ball data and pose-only', () => {
  const views = new Set();
  let ball = false;
  let poseOnly = false;
  for (const n of fixtureNames.filter((x) => x.startsWith('valid_'))) {
    const s = load(n);
    views.add(s.capture.view);
    if (s.metrics.ball_speed_mps.value !== null) ball = s.capture.nominal_fps === 240 && s.capture.view === 'face_on';
    if (s.capture.view === 'dtl' && s.capture.nominal_fps === 30) poseOnly = BALL_CLUB_IDS.every((id) => s.metrics[id].value === null);
  }
  assert.deepEqual([...views].sort(), ['dtl', 'face_on', 'high_behind']);
  assert.ok(ball && poseOnly);
});

test('validateShot result shape and non-object input', () => {
  const r = validateShot(load('valid_face_on_240'));
  assert.deepEqual(Object.keys(r).sort(), ['errors', 'ok']);
  for (const x of [null, undefined, 5, 'x', [], true]) {
    const bad = validateShot(x);
    assert.equal(bad.ok, false);
    assert.equal(bad.errors[0].path, '$');
  }
  const e = validateShot({}).errors[0];
  assert.deepEqual(Object.keys(e).sort(), ['msg', 'path']);
});

test('required, unknown and misspelled top-level fields', () => {
  for (const k of ['schema', 'shot_id', 'session_id', 'venue_id', 'preset_id', 'created_at', 'app_version', 'algorithms',
    'capture', 'calibration', 'club', 'handedness', 'events', 'metrics', 'quality', 'starred', 'note', 'revision']) {
    expectOne('valid_face_on_240', (s) => { delete s[k]; }, `${k}: required field is missing`);
  }
  expectOne('valid_face_on_240', (s) => { s.extra = 1; }, 'extra: unknown field');
  expectOne('valid_face_on_240', (s) => { s._expect = 'x'; }, '_expect: unknown field');
});

test('top-level scalar rules', () => {
  expectOne('valid_face_on_240', (s) => { s.schema = 'golf-shot/2'; }, 'schema must be');
  expectOne('valid_face_on_240', (s) => { s.shot_id = ''; }, 'shot_id');
  expectOne('valid_face_on_240', (s) => { s.session_id = 7; }, 'session_id');
  expectOne('valid_face_on_240', (s) => { s.venue_id = ''; }, 'venue_id');
  expectOne('valid_face_on_240', (s) => { s.preset_id = 3; }, 'preset_id');
  expectOne('valid_face_on_240', (s) => { s.created_at = '2026-11-04 09:30:15'; }, 'created_at');
  expectOne('valid_face_on_240', (s) => { s.created_at = '2026-13-04T09:30:15Z'; }, 'created_at');
  expectOne('valid_face_on_240', (s) => { s.created_at = '2026-11-04T09:30:15'; }, 'created_at');
  expectOne('valid_face_on_240', (s) => { s.app_version = ''; }, 'app_version');
  expectOne('valid_face_on_240', (s) => { s.handedness = 'both'; }, 'handedness');
  expectOne('valid_face_on_240', (s) => { s.starred = 1; }, 'starred');
  expectOne('valid_face_on_240', (s) => { s.note = null; }, 'note');
  expectOne('valid_face_on_240', (s) => { s.note = 'x'.repeat(4001); }, 'note');
  expectOne('valid_face_on_240', (s) => { s.revision = -1; }, 'revision');
  expectOne('valid_face_on_240', (s) => { s.revision = 1.5; }, 'revision');
  const ok = load('valid_face_on_240');
  ok.venue_id = null;
  ok.preset_id = null;
  ok.created_at = '2026-11-04T01:30:15.25Z';
  assert.equal(validateShot(ok).ok, true);
});

// ---------------------------------------------------------------------------------------- metric invariants

test('invariant: value !== null <=> validity in {valid, estimated, low_confidence}', () => {
  expectOne('valid_face_on_240', (s) => { Object.assign(s.metrics.tempo_ratio, { value: null, ci95: null, reason_codes: [RC.DEPENDS_ON_NULL] }); }, "validity 'valid' requires a value");
  expectOne('valid_face_on_240', (s) => { s.metrics.head_sway_x_m.validity = 'dropped'; }, "validity 'dropped' means no value");
  expectOne('valid_face_on_240', (s) => { s.metrics.head_sway_x_m.validity = 'not_computed'; }, 'means no value');
});

test('invariant: null value => reason_codes non-empty; ci95 and sigma null', () => {
  expectOne('valid_face_on_240', (s) => { s.metrics.head_depth_y_m.reason_codes = []; }, 'requires at least one reason code');
  expectOne('valid_face_on_240', (s) => { s.metrics.head_depth_y_m.ci95 = [0, 1]; }, 'ci95 must be null when value is null');
  expectOne('valid_face_on_240', (s) => { s.metrics.head_depth_y_m.sigma = 0.1; }, 'sigma must be null when value is null');
});

test('invariant: a number needs ci95 or sigma, and the value lies inside ci95', () => {
  expectOne('valid_face_on_240', (s) => { Object.assign(s.metrics.carry_m, { ci95: null, sigma: null }); }, 'requires ci95 or sigma');
  expectOne('valid_face_on_240', (s) => { s.metrics.carry_m.ci95 = [185, 195]; }, 'value 181 is outside ci95 [185, 195]');
  expectOne('valid_face_on_240', (s) => { s.metrics.carry_m.ci95 = [160, 180]; }, 'is outside ci95');
  expectOne('valid_face_on_240', (s) => { s.metrics.carry_m.ci95 = [202, 160]; }, 'exceeds upper bound');
  expectOne('valid_face_on_240', (s) => { s.metrics.carry_m.ci95 = [160, 181, 202]; }, 'ci95 must be null or [lo, hi]');
  expectOne('valid_face_on_240', (s) => { s.metrics.carry_m.ci95 = '160-202'; }, 'ci95 must be null or [lo, hi]');
  expectOne('valid_face_on_240', (s) => { s.metrics.carry_m.sigma = -1; }, 'sigma must be null or a finite number >= 0');
  // sigma alone is enough, and the bounds of ci95 are inclusive
  const ok = clone(load('valid_face_on_240'));
  ok.metrics.carry_m.ci95 = null;
  ok.metrics.carry_m.sigma = 10;
  assert.deepEqual(texts(validateShot(ok)), []);
  ok.metrics.carry_m.sigma = null;
  ok.metrics.carry_m.ci95 = [181, 181];
  assert.deepEqual(texts(validateShot(ok)), []);
  ok.metrics.carry_m.ci95 = [150, 181];
  assert.deepEqual(texts(validateShot(ok)), []);
});

test('metric field types: finite numbers, units, measured, origin, validity', () => {
  expectOne('valid_face_on_240', (s) => { s.metrics.carry_m.value = Number.NaN; }, 'value must be a finite number or null');
  expectOne('valid_face_on_240', (s) => { s.metrics.carry_m.value = '181'; }, 'value must be a finite number or null');
  expectOne('valid_face_on_240', (s) => { s.metrics.carry_m.measured = true; }, 'measured must be false');
  expectOne('valid_face_on_240', (s) => { s.metrics.carry_m.measured = 0; }, 'measured must be false');
  expectOne('valid_face_on_240', (s) => { s.metrics.carry_m.value_origin = 'guess'; }, 'value_origin');
  expectOne('valid_face_on_240', (s) => { s.metrics.carry_m.validity = 'great'; }, 'validity must be one of');
  expectOne('valid_face_on_240', (s) => { s.metrics.carry_m.unit = ''; }, 'unit must be a non-empty string');
  expectOne('valid_face_on_240', (s) => { delete s.metrics.carry_m.sigma; }, 'metrics.carry_m.sigma: required field is missing');
  expectOne('valid_face_on_240', (s) => { s.metrics.carry_m.note = 'x'; }, 'metrics.carry_m.note: unknown field');
  expectOne('valid_face_on_240', (s) => { s.metrics.carry_m = 181; }, 'metric must be an object');
});

test('every metric id has a fixed unit', () => {
  assert.equal(METRIC_IDS.length, 22);
  for (const id of METRIC_IDS) {
    expectOne('valid_face_on_240', (s) => { s.metrics[id].unit = 'furlong'; }, `metrics.${id}.unit`);
  }
  assert.equal(METRIC_UNITS.carry_m, 'm');
  assert.equal(METRIC_UNITS.weight_shift_pct, '%');
  assert.equal(METRIC_UNITS.club_speed_mps, 'm/s');
});

test('metrics must have exactly the fixed ids', () => {
  for (const id of METRIC_IDS) {
    expectOne('valid_face_on_240', (s) => { delete s.metrics[id]; }, `metrics.${id}: required field is missing`);
  }
  expectOne('valid_face_on_240', (s) => { s.metrics.carry_yd = s.metrics.carry_m; }, 'metrics.carry_yd: unknown field');
  expectOne('valid_face_on_240', (s) => { s.metrics = []; }, 'metrics must be an object');
});

test('reason codes: known, unique, strings; every defined code is accepted', () => {
  expectOne('valid_face_on_240', (s) => { s.metrics.club_path_deg.reason_codes = ['FPS_TOO_SLOW']; }, 'unknown reason code "FPS_TOO_SLOW"');
  expectOne('valid_face_on_240', (s) => { s.metrics.club_path_deg.reason_codes = [7]; }, 'unknown reason code 7');
  expectOne('valid_face_on_240', (s) => { s.metrics.club_path_deg.reason_codes = ['VIEW_PLANE_MISMATCH', 'VIEW_PLANE_MISMATCH']; }, 'duplicate reason code');
  expectOne('valid_face_on_240', (s) => { s.metrics.club_path_deg.reason_codes = 'VIEW_PLANE_MISMATCH'; }, 'must be an array of reason codes');
  expectOne('valid_face_on_240', (s) => { s.quality.warnings = ['NOPE']; }, 'quality.warnings[0]: unknown reason code');
  expectOne('valid_face_on_240', (s) => { s.quality.warnings = ['TRACK_MAY_BE_SHORT', 'TRACK_MAY_BE_SHORT']; }, 'duplicate reason code');
  // codes that are not setup-level may be used anywhere
  const s = clone(load('valid_face_on_240'));
  s.metrics.head_depth_y_m.reason_codes = Object.keys(REASON_CODES).filter((c) => !SETUP_LEVEL_CODES.includes(c));
  assert.deepEqual(texts(validateShot(s)), []);
});

test('metric truth table: validateMetric agrees with an independent oracle on 720 combinations', () => {
  const known = (c) => Object.prototype.hasOwnProperty.call(REASON_CODES, c);
  const oracle = (m) => {
    const hasValue = m.value !== null;
    if (VALUE_VALIDITIES.includes(m.validity) !== hasValue) return false;
    if (!m.reason_codes.every(known)) return false;
    if (!hasValue) return m.reason_codes.length > 0 && m.ci95 === null && m.sigma === null;
    if (m.sigma !== null && m.sigma < 0) return false;
    if (m.ci95 !== null) {
      if (m.ci95[0] > m.ci95[1]) return false;
      if (m.value < m.ci95[0] || m.value > m.ci95[1]) return false;
    }
    return m.ci95 !== null || m.sigma !== null;
  };
  let n = 0;
  let accepted = 0;
  for (const validity of VALIDITIES) {
    for (const value of [null, 1.5]) {
      for (const ci95 of [null, [1, 2], [2, 3], [3, 2]]) {
        for (const sigma of [null, 0.3, -1]) {
          for (const reason_codes of [[], ['FPS_TOO_LOW'], ['BOGUS']]) {
            const m = { value, unit: 'm', ci95, sigma, validity, value_origin: 'pose', measured: false, reason_codes };
            const got = validateMetric(m).length === 0;
            assert.equal(got, oracle(m), JSON.stringify(m));
            n++;
            if (got) accepted++;
          }
        }
      }
    }
  }
  assert.equal(n, 720);
  assert.ok(accepted > 10 && accepted < 100, `accepted ${accepted}`);
});

test('validateMetric: path and unit check only with an id', () => {
  const m = { value: 1, unit: 'furlong', ci95: [0, 2], sigma: null, validity: 'valid', value_origin: 'pose', measured: false, reason_codes: [] };
  assert.deepEqual(validateMetric(m), []);
  const errs = validateMetric(m, 'carry_m');
  assert.equal(errs.length, 1);
  assert.equal(errs[0].path, 'metrics.carry_m.unit');
  assert.equal(validateMetric({ ...m, value: null }, null, 'x.y')[0].path.startsWith('x.y'), true);
  assert.equal(validateMetric(5)[0].path, 'metric');
});

// ---------------------------------------------------------------------------------------- attribution rule

test('attribution: a setup-level warning must reach every affected metric that has a number', () => {
  const s = clone(load('valid_face_on_240'));
  s.quality.warnings = [RC.SETUP_UNVERIFIED];
  const r = validateShot(s);
  const paths = new Set(r.errors.map((e) => e.path));
  const affectedWithNumber = BALL_CLUB_IDS.filter((id) => s.metrics[id].value !== null);
  assert.deepEqual(affectedWithNumber.sort(), ['carry_m', 'club_speed_mps', 'ball_speed_mps', 'launch_v_deg', 'smash_factor'].sort());
  for (const id of affectedWithNumber) {
    assert.ok(paths.has(`metrics.${id}.validity`), `${id} not downgraded`);
    assert.ok(paths.has(`metrics.${id}.reason_codes`), `${id} lacks the code`);
  }
  // nulls (club_path_deg, launch_h_deg) and unaffected pose metrics are not flagged
  assert.equal(r.errors.length, affectedWithNumber.length * 2);
  assert.ok(!paths.has('metrics.club_path_deg.validity') && !paths.has('metrics.head_sway_x_m.validity'));
});

test('attribution: each of the four setup-level codes is enforced', () => {
  assert.deepEqual([...SETUP_LEVEL_CODES].sort(), [RC.CALIB_STALE, RC.NO_GRAVITY_REF, RC.PRESET_MISMATCH, RC.SETUP_UNVERIFIED].sort());
  for (const code of SETUP_LEVEL_CODES) {
    const s = clone(load('valid_face_on_240'));
    s.quality.warnings.push(code);
    const r = validateShot(s);
    assert.equal(r.ok, false, code);
    assert.ok(texts(r).some((t) => t.includes(`does not repeat it`) && t.startsWith('metrics.carry_m.reason_codes')), code);
    // repair by hand: downgrade and repeat the code on the five affected metrics
    for (const id of ['club_speed_mps', 'ball_speed_mps', 'launch_v_deg', 'carry_m', 'smash_factor']) {
      s.metrics[id].validity = 'low_confidence';
      s.metrics[id].reason_codes.push(code);
    }
    assert.deepEqual(texts(validateShot(s)), [], code);
  }
});

test('attribution: warnings that are not setup-level need no repetition', () => {
  const s = clone(load('valid_face_on_240'));
  s.quality.warnings = [RC.THERMAL_DEGRADED, RC.AUDIO_UNAVAILABLE, RC.TIMESTAMPS_NOMINAL, RC.TRACK_MAY_BE_SHORT, RC.ROLLING_SHUTTER_ASSUMED];
  assert.deepEqual(texts(validateShot(s)), []);
});

test('attribution: affected means ids 14-20 or a calibration-dependent value_origin', () => {
  assert.deepEqual([...BALL_CLUB_IDS], ['club_speed_mps', 'club_path_deg', 'ball_speed_mps', 'launch_v_deg', 'launch_h_deg', 'carry_m', 'smash_factor']);
  for (const id of METRIC_IDS) {
    for (const origin of VALUE_ORIGINS) {
      const expected = BALL_CLUB_IDS.includes(id) || ['ball_fit3d', 'ball_fit2d', 'club_track', 'ballistics'].includes(origin);
      assert.equal(isAffectedBySetup(id, origin), expected, `${id}/${origin}`);
      assert.equal(isAffectedBySetup(id, { value_origin: origin }), expected);
    }
  }
  // a pose metric computed through the ball/club geometry counts as affected
  const s = clone(load('valid_face_on_240'));
  s.quality.warnings = [RC.CALIB_STALE];
  for (const id of ['club_speed_mps', 'ball_speed_mps', 'launch_v_deg', 'carry_m', 'smash_factor']) {
    s.metrics[id].validity = 'low_confidence';
    s.metrics[id].reason_codes.push(RC.CALIB_STALE);
  }
  assert.deepEqual(texts(validateShot(s)), []);
  s.metrics.spine_side_tilt_deg.value_origin = 'ballistics';
  assert.equal(validateShot(s).errors.length, 2);
});

test('attribution: a setup-level code on a metric must also be in quality.warnings, null metrics included', () => {
  const s = clone(load('valid_face_on_setup_unverified'));
  s.quality.warnings = [RC.SETUP_UNVERIFIED];
  const r = validateShot(s);
  assert.equal(r.errors.length, 5); // NO_GRAVITY_REF is on five metrics
  assert.ok(texts(r).every((t) => t.includes('NO_GRAVITY_REF is on this metric but missing from quality.warnings') || t.includes('NO_GRAVITY_REF is on this metric')));
  expectOne('valid_face_on_240', (x) => { x.metrics.head_depth_y_m.reason_codes.push(RC.CALIB_STALE); }, 'missing from quality.warnings');
});

test('attribution: a null affected metric is exempt (nothing to downgrade)', () => {
  const s = clone(load('valid_dtl_30')); // every ball/club metric is null here
  s.quality.warnings = [RC.SETUP_UNVERIFIED, RC.PRESET_MISMATCH];
  assert.deepEqual(texts(validateShot(s)), []);
});

// ---------------------------------------------------------------------------------------- events

test('events: eight GolfDB events, frames and times non-decreasing', () => {
  expectOne('valid_face_on_240', (s) => { s.events.top.frame = 240; }, 'events.top.frame: frame 240 is before mid_backswing frame 250; event frames must be non-decreasing');
  expectOne('valid_face_on_240', (s) => { s.events.top.t_s = 0.5; }, 'event times must be non-decreasing');
  expectOne('valid_face_on_240', (s) => { delete s.events.finish; }, 'events.finish: required field is missing');
  expectOne('valid_face_on_240', (s) => { s.events.follow_through = s.events.finish; }, 'events.follow_through: unknown field');
  expectOne('valid_face_on_240', (s) => { s.events.impact.frame = 440.5; }, 'events.impact.frame');
  expectOne('valid_face_on_240', (s) => { s.events.address.frame = -1; }, 'events.address.frame');
  expectOne('valid_face_on_240', (s) => { s.events.impact.conf = -0.1; }, 'events.impact.conf');
  expectOne('valid_face_on_240', (s) => { s.events.impact.source = 'human'; }, 'events.impact.source');
  expectOne('valid_face_on_240', (s) => { s.events.impact = null; }, 'events.impact: event must be an object');
  expectOne('valid_face_on_240', (s) => { delete s.events.impact.conf; }, 'events.impact.conf: required field is missing');
  assert.equal(EVENTS.length, 8);
  const ok = clone(load('valid_face_on_240'));
  ok.events.toe_up.frame = ok.events.address.frame; // equal frames are allowed
  ok.events.toe_up.t_s = ok.events.address.t_s;
  assert.deepEqual(texts(validateShot(ok)), []);
});

// ---------------------------------------------------------------------------------------- calibration / camera

test('calibration and camera objects', () => {
  const f = 'valid_face_on_240';
  expectOne(f, (s) => { s.calibration.method = 'laser'; }, 'calibration.method');
  expectOne(f, (s) => { s.calibration.source = 'file'; }, 'calibration.source');
  expectOne(f, (s) => { s.calibration.f_locked = 'yes'; }, 'calibration.f_locked');
  expectOne(f, (s) => { s.calibration.f_px = -1; }, 'calibration.f_px: must be > 0');
  expectOne(f, (s) => { s.calibration.f_px *= 1.01; }, 'differs from camera.f');
  expectOne(f, (s) => { s.calibration.readout_ms = 4; }, 'differs from camera.readout.ms');
  expectOne(f, (s) => { s.calibration.readout_source = 'guessed'; }, 'calibration.readout_source');
  expectOne(f, (s) => { delete s.calibration.pose.D_m; }, 'calibration.pose.D_m: required field is missing');
  expectOne(f, (s) => { s.calibration.pose.zoom = 1; }, 'calibration.pose.zoom: unknown field');
  expectOne(f, (s) => { s.calibration.pose_sigma.yaw_deg = -0.1; }, 'calibration.pose_sigma.yaw_deg');
  expectOne(f, (s) => { s.calibration.reproj_rmse_px = -1; }, 'calibration.reproj_rmse_px');
  expectOne(f, (s) => { delete s.calibration.preset_dev.pitch_deg; }, 'calibration.preset_dev.pitch_deg: required field is missing');
  expectOne(f, (s) => { s.calibration.camera.cx = 100; }, 'principal point must be at the image centre');
  expectOne(f, (s) => { s.calibration.camera.cy = 100; }, 'principal point must be at the image centre');
  expectOne(f, (s) => { s.calibration.camera.R[0] = 2; }, 'not a rotation matrix');
  expectOne(f, (s) => { s.calibration.camera.R = s.calibration.camera.R.slice(0, 8); }, 'R must be 9 finite numbers');
  expectOne(f, (s) => { s.calibration.camera.t = [0, 0]; }, 't must be 3 finite numbers');
  expectOne(f, (s) => { s.calibration.camera.W = 1920.5; }, 'calibration.camera.W');
  expectOne(f, (s) => { s.calibration.camera.readout.axis = 'x'; }, 'calibration.camera.readout.axis');
  expectOne(f, (s) => { s.calibration.camera.readout.dir = 2; }, 'calibration.camera.readout.dir');
  expectOne(f, (s) => { s.calibration.camera = null; }, 'camera must be an object');
  // optional-looking fields may be null
  const ok = clone(load(f));
  Object.assign(ok.calibration, { preset_dev: null, reproj_rmse_px: null, slope_deg: null });
  assert.deepEqual(texts(validateShot(ok)), []);
});

test('every valid fixture camera is a proper rotation and the principal point is the image centre', () => {
  for (const n of fixtureNames.filter((x) => x.startsWith('valid_'))) {
    const c = load(n).calibration.camera;
    assert.equal(c.cx, c.W / 2);
    assert.equal(c.cy, c.H / 2);
  }
});

// ---------------------------------------------------------------------------------------- other sections

test('capture, club, quality and algorithms sections', () => {
  const f = 'valid_face_on_240';
  expectOne(f, (s) => { s.capture.mode = 'slowmo'; }, 'capture.mode');
  expectOne(f, (s) => { s.capture.view = 'side'; }, 'capture.view');
  expectOne(f, (s) => { s.capture.source = 'cloud'; }, 'capture.source');
  expectOne(f, (s) => { s.capture.orientation = 'sideways'; }, 'capture.orientation');
  expectOne(f, (s) => { s.capture.width = 0; }, 'capture.width');
  expectOne(f, (s) => { s.capture.nominal_fps = 0; }, 'capture.nominal_fps');
  expectOne(f, (s) => { s.capture.effective_fps = -240; }, 'capture.effective_fps');
  expectOne(f, (s) => { s.capture.vfr = 'no'; }, 'capture.vfr');
  expectOne(f, (s) => { s.capture.timestamps = 'guess'; }, 'capture.timestamps');
  expectOne(f, (s) => { s.capture.clip_ref = ''; }, 'capture.clip_ref');
  expectOne(f, (s) => { s.capture.trim_s = [2, 1]; }, 'capture.trim_s');
  expectOne(f, (s) => { s.capture.trim_s = [0]; }, 'capture.trim_s');
  expectOne(f, (s) => { s.club.type = ''; }, 'club.type');
  expectOne(f, (s) => { s.club.length_m = 0.2; }, 'club.length_m');
  expectOne(f, (s) => { s.club.lie = 'grass'; }, 'club.lie');
  expectOne(f, (s) => { s.club.tee_lift_m = 0.5; }, 'club.tee_lift_m');
  expectOne(f, (s) => { s.club.tee_lift_source = 'guessed'; }, 'club.tee_lift_source');
  expectOne(f, (s) => { s.quality.pose_mean_vis = 1.2; }, 'quality.pose_mean_vis');
  expectOne(f, (s) => { s.quality.frames_analyzed = -1; }, 'quality.frames_analyzed');
  expectOne(f, (s) => { s.quality.frames_dropped = 0.5; }, 'quality.frames_dropped');
  expectOne(f, (s) => { s.quality.audio_onset = -1; }, 'quality.audio_onset');
  expectOne(f, (s) => { s.quality.touches = 'two'; }, 'quality.touches');
  expectOne(f, (s) => { delete s.quality.warnings; }, 'quality.warnings: required field is missing');
  expectOne(f, (s) => { delete s.algorithms.carry; }, 'algorithms.carry: required field is missing');
  expectOne(f, (s) => { s.algorithms.pose.sha256 = s.algorithms.pose.sha256.toUpperCase(); }, 'algorithms.pose.sha256');
  expectOne(f, (s) => { s.algorithms.pose.version = ''; }, 'algorithms.pose.version');
  expectOne(f, (s) => { s.algorithms.pose = 'x'; }, 'algorithms.pose');
  const ok = clone(load(f));
  Object.assign(ok.quality, { pose_mean_vis: null, audio_onset: null });
  Object.assign(ok.capture, { clip_ref: null, trim_s: null, orientation: 'unknown' });
  assert.deepEqual(texts(validateShot(ok)), []);
});

test('history entries', () => {
  const f = 'valid_face_on_revised';
  expectOne(f, (s) => { s.history = {}; }, 'history must be an array');
  expectOne(f, (s) => { s.history[0].revision = 1; }, 'must be lower than the shot revision');
  expectOne(f, (s) => { s.history[0].at = 'yesterday'; }, 'history[0].at');
  expectOne(f, (s) => { s.history[0].before = []; }, 'history[0].before');
  expectOne(f, (s) => { delete s.history[0].at; }, 'history[0].at: required field is missing');
  expectOne(f, (s) => { s.revision = 3; s.history.push({ revision: 1, at: null, before: {} }, { revision: 1, at: null, before: {} }); }, 'strictly increasing');
  const ok = clone(load(f));
  ok.history[0].at = null;
  assert.deepEqual(texts(validateShot(ok)), []);
});

test('assertValid and formatErrors', () => {
  const good = load('valid_dtl_30');
  assert.equal(assertValid(good), good);
  const bad = clone(good);
  bad.metrics.tempo_ratio.ci95 = null;
  bad.metrics.tempo_ratio.sigma = null;
  bad.schema = 'x';
  try {
    assertValid(bad);
    assert.fail('should throw');
  } catch (e) {
    assert.ok(e instanceof ContractError);
    assert.equal(e.name, 'ContractError');
    assert.equal(e.errors.length, 2);
    assert.match(e.message, /2 errors/);
    assert.match(e.message, /metrics\.tempo_ratio\.ci95/);
  }
  const many = Array.from({ length: 8 }, (_, i) => ({ path: `p${i}`, msg: 'm' }));
  assert.match(formatErrors(many), /and 3 more/);
  assert.match(formatErrors([{ path: 'a', msg: 'b' }]), /\(1 error\): a: b/);
});

test('validation does not modify the shot', () => {
  const s = load('valid_face_on_setup_unverified');
  const snapshot = JSON.stringify(s);
  validateShot(s);
  assert.equal(JSON.stringify(s), snapshot);
});
