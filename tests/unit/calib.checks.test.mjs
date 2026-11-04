import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, VIEW_LIMITS, COMMON_LIMITS, staleCheck, cornerDrift, ballWidthCheck } from '../../app/src/calib/checks.js';
import { RC } from '../../app/src/contract/reason-codes.js';

const good = {
  face_on: { yaw_deg: 0.3, pitch_deg: -0.4, roll_deg: 0.1, X_m: 0.4, Y_m: -2.7, h_m: 0.84, D_m: 2.729 },
  dtl: { yaw_deg: 0.3, pitch_deg: 0.2, roll_deg: -0.2, X_m: -3.25, Y_m: 0.35, h_m: 1.0, D_m: 3.269 },
  high_behind: { yaw_deg: 0.2, pitch_deg: -30.6, roll_deg: 0.1, X_m: -2.875, Y_m: 0.05, h_m: 1.7, D_m: 2.875 },
};
const W = 1920;
const H = 1080;
const corners = [[500, 1000], [1400, 1000], [1250, 870], [650, 870]];

function base(view) {
  return {
    view, report: good[view], rmse_px: 0.7, edge_residual_px: [0.3, 0.4, 0.2, 0.5], f_free_px: 1430, f_locked_px: 1418,
    corner_source: 'manual', preset: { view, pose: { ...good[view] } }, ghost_px: 3, corners, W, H,
    gravity_available: true, frames_budget: 7.4, ball: { w_px: 22.5, predicted_w_px: 22.4 },
  };
}

test('thresholds are the CAFCR C3 / C1 values', () => {
  assert.deepEqual({ ...VIEW_LIMITS.face_on.abs }, { yaw_deg: 1.5, pitch_deg: 1.0, roll_deg: 0.5 });
  assert.deepEqual({ ...VIEW_LIMITS.face_on.rel }, { yaw_deg: 1.0, pitch_deg: 1.0, roll_deg: 0.5, D_m: 0.05, X_m: 0.05, h_m: 0.03 });
  assert.equal(VIEW_LIMITS.dtl.abs.yaw_deg, 1.0);
  assert.equal(VIEW_LIMITS.dtl.rel.Y_m, 0.03);
  assert.equal(VIEW_LIMITS.high_behind.abs.Y_abs_m, 0.15);
  assert.equal(VIEW_LIMITS.high_behind.abs.D_min_m, 2.75);
  assert.equal(VIEW_LIMITS.high_behind.abs.pitch_deg, undefined);
  assert.equal(COMMON_LIMITS.rmse_px, 2.0);
  assert.equal(COMMON_LIMITS.edge_residual_px, 1.5);
  assert.equal(COMMON_LIMITS.ghost_px, 8);
  assert.equal(COMMON_LIMITS.f_format_manual_pct, 4);
  assert.equal(COMMON_LIMITS.f_format_auto_pct, 6);
});

for (const view of ['face_on', 'dtl', 'high_behind']) {
  test(`${view}: all checks pass → green, nothing skipped`, () => {
    const r = evaluate(base(view));
    assert.equal(r.light, 'green', JSON.stringify(r.failures));
    assert.deepEqual(r.failures, []);
    assert.deepEqual(r.skipped, []);
    assert.deepEqual(r.reason_codes, []);
  });
}

test('absolute and relative pose failures are red with value and limit, and add SETUP_UNVERIFIED', () => {
  const i = base('face_on');
  i.report = { ...i.report, yaw_deg: 1.8 };
  let r = evaluate(i);
  assert.equal(r.light, 'red');
  assert.ok(r.failures.some((f) => f.check === 'abs_yaw_deg' && f.value === 1.8 && f.limit === 1.5));
  assert.ok(r.failures.some((f) => f.check === 'rel_yaw_deg' && Math.abs(f.value - 1.5) < 1e-12 && f.limit === 1.0));
  assert.ok(r.reason_codes.includes(RC.SETUP_UNVERIFIED));
  const j = base('face_on');
  j.report = { ...j.report, D_m: j.report.D_m + 0.06, h_m: j.report.h_m - 0.031 };
  r = evaluate(j);
  assert.deepEqual(r.failures.map((f) => f.check).sort(), ['rel_D_m', 'rel_h_m']);
  // limits are inclusive
  const k = base('face_on');
  k.report = { ...k.report, X_m: k.report.X_m + 0.05, roll_deg: 0.5 };
  k.preset.pose.roll_deg = 0.0;
  r = evaluate(k);
  assert.equal(r.light, 'green', JSON.stringify(r.failures));
});

test('C5 checks: RMSE, edge residual, f-format (manual 4 % / auto 6 %), ghost, framing', () => {
  const i = base('dtl');
  Object.assign(i, { rmse_px: 2.1, edge_residual_px: [0.2, 1.6, 0.2, 0.2], f_free_px: 1418 * 1.05, ghost_px: 8.5 });
  let r = evaluate(i);
  assert.deepEqual(r.failures.map((f) => f.check).sort(), ['edge_residual_px', 'f_format', 'ghost_px', 'rmse_px']);
  r = evaluate({ ...i, rmse_px: 1, edge_residual_px: 1, ghost_px: 2, corner_source: 'auto' });
  assert.equal(r.light, 'green', JSON.stringify(r.failures));
  r = evaluate({ ...base('face_on'), corners: [[30, 1060], ...corners.slice(1)] });
  assert.ok(r.failures.some((f) => f.check === 'corners_in_frame'));
  r = evaluate({ ...base('face_on'), corners: [null, ...corners.slice(1)] });
  assert.ok(r.failures.some((f) => f.check === 'corners_in_frame'));
});

test('high_behind lateral offset and safety distance; preset of another view → PRESET_MISMATCH', () => {
  let r = evaluate({ ...base('high_behind'), report: { ...good.high_behind, Y_m: 0.2 }, preset: null });
  assert.equal(r.light, 'red');
  assert.ok(r.failures.some((f) => f.check === 'abs_Y_m' && f.limit === 0.15));
  assert.ok(r.skipped.includes('rel_D_m'));
  r = evaluate({ ...base('high_behind'), report: { ...good.high_behind, D_m: 2.6 }, preset: null });
  assert.ok(r.failures.some((f) => f.check === 'min_D_m'));
  r = evaluate({ ...base('face_on'), preset: { view: 'dtl', pose: good.dtl } });
  assert.equal(r.light, 'red');
  assert.ok(r.reason_codes.includes(RC.PRESET_MISMATCH));
});

test('warnings are amber: short flight budget (TRACK_MAY_BE_SHORT), no gravity (NO_GRAVITY_REF)', () => {
  let r = evaluate({ ...base('face_on'), frames_budget: 5.6 });
  assert.equal(r.light, 'amber');
  assert.deepEqual(r.failures.map((f) => [f.check, f.severity]), [['frames_budget', 'amber']]);
  assert.deepEqual(r.reason_codes, [RC.TRACK_MAY_BE_SHORT]);
  r = evaluate({ ...base('face_on'), gravity_available: false });
  assert.equal(r.light, 'amber');
  assert.deepEqual(r.reason_codes, [RC.NO_GRAVITY_REF]);
  r = evaluate({ ...base('face_on'), ball: { w_px: 20.5, predicted_w_px: 22.4 } });
  assert.equal(r.light, 'red');
  assert.ok(r.failures.some((f) => f.check === 'ball_width'));
});

test('missing inputs are skipped, not passed', () => {
  const r = evaluate({ view: 'face_on', report: good.face_on });
  assert.equal(r.light, 'green');
  for (const c of ['rmse_px', 'edge_residual_px', 'f_format', 'ghost_px', 'corners_in_frame', 'frames_budget', 'ball_width', 'rel_D_m']) {
    assert.ok(r.skipped.includes(c), c);
  }
  assert.deepEqual(r.passed.sort(), ['abs_pitch_deg', 'abs_roll_deg', 'abs_yaw_deg']);
  assert.throws(() => evaluate({ view: 'top' }), RangeError);
});

test('staleCheck (>2 px → CALIB_STALE), cornerDrift, ballWidthCheck', () => {
  const a = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.deepEqual(cornerDrift(a, [[1, 0], null, [10, 12], [0, 10]]), { max_px: 2, n: 3 });
  assert.deepEqual(staleCheck(a, [[1, 0], null, [10, 12], [0, 10]]).reason_codes, []);
  const s = staleCheck(a, [[0, 0], [10, 0], [12.5, 10], [0, 10]]);
  assert.equal(s.stale, true);
  assert.deepEqual(s.reason_codes, [RC.CALIB_STALE]);
  assert.equal(ballWidthCheck(23.7, 22.4).ok, true);
  assert.equal(ballWidthCheck(23.8, 22.4).ok, false);
  assert.deepEqual(ballWidthCheck(11.5, 11.5).failures.map((f) => f.check), ['ball_min_px']);
});
