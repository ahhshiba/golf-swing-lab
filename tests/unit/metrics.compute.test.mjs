// computeMetrics: every 不可 cell is null + its F2 code, no allowed cell is NOT_IMPLEMENTED (face_on row 14 below
// 200 fps from pose, the other rows 14–20 TRACK_TOO_SHORT without a track), every output is a
// contract-valid Metric, and the degraded inputs (no calibration, feet off the mat, missing / uncertain events,
// low frame rate) give the documented codes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMetrics } from '../../app/src/metrics/compute.js';
import { REGISTRY } from '../../app/src/metrics/registry.js';
import { detectEvents } from '../../app/src/events/rules.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { METRIC_IDS, NULL_VALIDITIES } from '../../app/src/contract/enums.js';
import { validateMetric } from '../../app/src/contract/validate.js';
import { synthSwing } from '../synth/swing.js';

const VIEWS = ['face_on', 'dtl', 'high_behind'];
const cache = new Map();
function swing(view, fps, extra = {}) {
  const key = `${view}:${fps}:${JSON.stringify(extra)}`;
  if (!cache.has(key)) {
    const s = synthSwing({ seed: 5, view, fps, ...extra });
    cache.set(key, { s, events: detectEvents(s.poseSeq, { view, handedness: s.handedness }) });
  }
  return cache.get(key);
}

function allValid(m) {
  assert.deepEqual(Object.keys(m), [...METRIC_IDS]);
  for (const id of METRIC_IDS) assert.deepEqual(validateMetric(m[id], id), [], id);
}

for (const fps of [60, 240]) {
  test(`every 不可 cell is null with its F2 code; no cell is NOT_IMPLEMENTED (${fps} fps)`, () => {
    for (const view of VIEWS) {
      const { s, events } = swing(view, fps);
      const m = computeMetrics({ view, fps, poseSeq: s.poseSeq, events, calibration: s.calibration });
      allValid(m);
      for (const id of METRIC_IDS) {
        const r = REGISTRY[id];
        const cell = r.views[view];
        if (cell === 'not') {
          assert.equal(m[id].value, null, `${view} ${id}`);
          assert.deepEqual(m[id].reason_codes, [r.nullCode], `${view} ${id}`);
          assert.ok(NULL_VALIDITIES.includes(m[id].validity));
        } else if (fps < r.minFps) {
          assert.equal(m[id].value, null);
          assert.deepEqual(m[id].reason_codes, [RC.FPS_TOO_LOW], `${view} ${id} @${fps}`);
        } else if (id === 'club_speed_mps' && view === 'face_on' && fps < 200) {
          // F2 row 14, 30–199 fps: pose estimate (metrics/club.js), 低, ci95 at least ±25 %
          const x = m[id];
          assert.ok(x.value === null ? x.reason_codes.length > 0 : x.validity === 'low_confidence', `${view} ${id}: ${JSON.stringify(x)}`);
          if (x.value !== null) assert.ok(x.ci95[1] - x.value >= 0.25 * x.value - 1e-9 && x.value - x.ci95[0] >= 0.25 * x.value - 1e-9);
        } else if (r.row >= 14) {
          // the track-based cells need a ball / club-head track, which computeMetrics does not receive
          assert.equal(m[id].value, null);
          assert.deepEqual(m[id].reason_codes, [RC.TRACK_TOO_SHORT], `${view} ${id}`);
          assert.equal(m[id].validity, 'not_computed');
        }
        assert.ok(!m[id].reason_codes.includes(RC.NOT_IMPLEMENTED), `${view} ${id} @${fps}: NOT_IMPLEMENTED`);
      }
    }
  });
}

test('computed cells carry the registry validity (or weaker) and ci95/sigma', () => {
  const order = { valid: 0, estimated: 1, low_confidence: 2 };
  for (const view of VIEWS) {
    const { s, events } = swing(view, 60);
    const m = computeMetrics({ view, fps: 60, poseSeq: s.poseSeq, events, calibration: s.calibration });
    for (const id of METRIC_IDS) {
      const x = m[id];
      if (x.value === null) continue;
      const cell = REGISTRY[id].views[view];
      assert.ok(order[x.validity] >= order[cell], `${view} ${id}: ${x.validity} stronger than F2 ${cell}`);
      assert.ok(x.ci95 !== null && x.ci95[0] <= x.value && x.value <= x.ci95[1]);
      assert.equal(x.measured, false);
    }
    // F2 7–9 are 低 in every view
    for (const id of ['shoulder_turn_deg', 'hip_turn_deg', 'x_factor_deg']) {
      if (m[id].value !== null) assert.equal(m[id].validity, 'low_confidence');
    }
  }
});

test('top_shaft_angle_deg (dtl): needs >= 120 fps and club-head observations', () => {
  const { s, events } = swing('dtl', 240);
  const base = { view: 'dtl', fps: 240, poseSeq: s.poseSeq, events, calibration: s.calibration };
  const none = computeMetrics(base);
  assert.equal(none.top_shaft_angle_deg.value, null);
  assert.deepEqual(none.top_shaft_angle_deg.reason_codes, [RC.TRACK_TOO_SHORT]);
  const m = computeMetrics({ ...base, clubObs: s.clubObs, club: { length_m: s.params.clubLen + 0.1 } });
  assert.equal(m.top_shaft_angle_deg.validity, 'estimated');
  assert.ok(Math.abs(m.top_shaft_angle_deg.value - s.truth.metrics.top_shaft_angle_deg) < 3);
  const prior = computeMetrics({ ...base, clubObs: s.clubObs });
  assert.ok(prior.top_shaft_angle_deg.sigma >= m.top_shaft_angle_deg.sigma);
  const low = swing('dtl', 60);
  const m60 = computeMetrics({ view: 'dtl', fps: 60, poseSeq: low.s.poseSeq, events: low.events, calibration: low.s.calibration, clubObs: low.s.clubObs });
  assert.deepEqual(m60.top_shaft_angle_deg.reason_codes, [RC.FPS_TOO_LOW]);
});

test('no calibration: nominal camera, BODY_PLANE_ASSUMED and low_confidence on every pose value', () => {
  const { s, events } = swing('face_on', 60);
  const m = computeMetrics({ view: 'face_on', fps: 60, poseSeq: s.poseSeq, events, calibration: null });
  allValid(m);
  for (const id of ['head_sway_x_m', 'head_lift_z_m', 'spine_side_tilt_deg', 'weight_shift_pct']) {
    assert.notEqual(m[id].value, null, id);
    assert.equal(m[id].validity, 'low_confidence', id);
    assert.ok(m[id].reason_codes.includes(RC.BODY_PLANE_ASSUMED), id);
  }
  assert.equal(m.tempo_ratio.validity, 'valid');
});

test('feet off the mat: BODY_PLANE_ASSUMED with the leg-length prior, displacement validity at most estimated', () => {
  const { s, events } = swing('dtl', 60);
  // a venue whose mat is 2 m away from the golfer
  const m = computeMetrics({ view: 'dtl', fps: 60, poseSeq: s.poseSeq, events, calibration: s.calibration, venue: { ball_x_m: 2.5 } });
  allValid(m);
  for (const id of ['head_lift_z_m', 'head_depth_y_m', 'hand_plane_dev_m', 'early_extension_m']) {
    assert.ok(m[id].reason_codes.includes(RC.BODY_PLANE_ASSUMED), id);
    assert.ok(['estimated', 'low_confidence'].includes(m[id].validity), `${id} ${m[id].validity}`);
  }
  const ok = computeMetrics({ view: 'dtl', fps: 60, poseSeq: s.poseSeq, events, calibration: s.calibration });
  assert.ok(!ok.head_lift_z_m.reason_codes.includes(RC.BODY_PLANE_ASSUMED));
  assert.equal(ok.head_lift_z_m.validity, 'valid');
});

test('missing events -> EVENTS_UNCERTAIN nulls; uncertain events -> low_confidence + EVENTS_UNCERTAIN', () => {
  const { s, events } = swing('face_on', 60);
  const noTop = { ...events, top: { frame: null, t_s: null, conf: 0, source: 'rules' } };
  const m = computeMetrics({ view: 'face_on', fps: 60, poseSeq: s.poseSeq, events: noTop, calibration: s.calibration });
  allValid(m);
  for (const id of ['tempo_ratio', 'head_sway_x_m', 'shoulder_turn_deg']) {
    assert.equal(m[id].value, null, id);
    assert.deepEqual(m[id].reason_codes, [RC.EVENTS_UNCERTAIN], id);
  }
  assert.deepEqual(m.x_factor_deg.reason_codes, [RC.DEPENDS_ON_NULL]);
  assert.notEqual(m.spine_side_tilt_deg.value, null, 'address-only metric still computed');
  const shaky = { ...events, impact: { ...events.impact, conf: 0.3 } };
  const m2 = computeMetrics({ view: 'face_on', fps: 60, poseSeq: s.poseSeq, events: shaky, calibration: s.calibration });
  for (const id of ['head_lift_z_m', 'weight_shift_pct', 'tempo_ratio']) {
    assert.equal(m2[id].validity, 'low_confidence', id);
    assert.ok(m2[id].reason_codes.includes(RC.EVENTS_UNCERTAIN), id);
  }
});

test('below 30 fps every pose row is FPS_TOO_LOW; an empty PoseSeq gives nulls, never throws', () => {
  const { s, events } = swing('dtl', 60);
  const m = computeMetrics({ view: 'dtl', fps: 24, poseSeq: s.poseSeq, events, calibration: s.calibration });
  allValid(m);
  for (const id of METRIC_IDS) {
    if (REGISTRY[id].views.dtl !== 'not') assert.ok(m[id].reason_codes.includes(RC.FPS_TOO_LOW) || REGISTRY[id].row >= 14, id);
  }
  const empty = computeMetrics({ view: 'dtl', fps: 60, poseSeq: { t_s: new Float64Array(0), img: new Float32Array(0), W: 1080, H: 1920 }, events, calibration: s.calibration });
  allValid(empty);
  assert.throws(() => computeMetrics({ view: 'top_down', fps: 60, poseSeq: s.poseSeq, events }), RangeError);
});
