// V04-SPEC §G.3 V4-F 4: the lines each view draws = the §E.1 table (face_on 6, dtl 6, high_behind 2); ✗ cells are null
// with their VIEW_* code; without a calibrated camera the ball planes and the target line are null + NO_CALIBRATION;
// the overlay draws only enabled, non-null lines in the overlay tokens (recording fake canvas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLines, LINES_BY_VIEW, lineVerdict, deviates, eventFrame } from '../../app/src/lab/lines.js';
import { drawLines } from '../../app/src/lab/overlay.js';
import { LAB_LINE_IDS } from '../../app/src/lab/settings.js';
import { synthSwing } from '../synth/swing.js';

const SPEC = {
  face_on: ['head_box', 'spine', 'shoulders', 'hip_walls', 'stance', 'target_line'],
  dtl: ['head_box', 'spine', 'butt_line', 'ball_hand_plane', 'ball_shoulder_plane', 'target_line'],
  high_behind: ['head_box', 'target_line'],
};
const NOT = {
  face_on: { butt_line: 'VIEW_DEPTH_AXIS', ball_hand_plane: 'VIEW_PLANE_MISMATCH', ball_shoulder_plane: 'VIEW_PLANE_MISMATCH' },
  dtl: { shoulders: 'VIEW_DEPTH_AXIS', hip_walls: 'VIEW_DEPTH_AXIS', stance: 'VIEW_DEPTH_AXIS' },
  high_behind: { spine: 'VIEW_PLANE_MISMATCH', shoulders: 'VIEW_DEPTH_AXIS', hip_walls: 'VIEW_DEPTH_AXIS', butt_line: 'VIEW_PLANE_MISMATCH', stance: 'VIEW_DEPTH_AXIS', ball_hand_plane: 'VIEW_PLANE_MISMATCH', ball_shoulder_plane: 'VIEW_PLANE_MISMATCH' },
};
const swing = (view, o = {}) => {
  const s = synthSwing({ seed: 5, view, fps: 60, ...o });
  const events = Object.fromEntries(Object.entries(s.truth.events).map(([n, e]) => [n, { ...e, conf: 0.9 }]));
  return { s, events };
};

test('LINES_BY_VIEW = §E.1 table (6 / 6 / 2)', () => {
  for (const v of Object.keys(SPEC)) assert.deepEqual([...LINES_BY_VIEW[v]], SPEC[v], v);
  assert.equal(lineVerdict('ball_hand_plane', 'dtl').calib, true);
  assert.equal(lineVerdict('target_line', 'high_behind').calib, true);
  assert.equal(lineVerdict('spine', 'face_on').calib, false);
});

for (const view of ['face_on', 'dtl', 'high_behind']) {
  test(`${view}: drawable set, ✗ cells null + VIEW_* code, all 9 keys`, () => {
    const { s, events } = swing(view, view === 'high_behind' ? { params: { stature: 1.66 }, cameraOpts: { h: 2.4 } } : {});
    const L = computeLines({ view, poseSeq: s.poseSeq, events, calibration: { camera: s.camera }, handedness: 'right' });
    assert.deepEqual(Object.keys(L), [...LAB_LINE_IDS]);
    for (const [id, code] of Object.entries(NOT[view])) { assert.equal(L[id], null, id); assert.deepEqual(L.reasons[id], [code], id); }
    for (const id of SPEC[view]) {
      if (view === 'high_behind' && id === 'head_box' && !L[id]) { assert.ok(L.reasons[id].length === 1); continue; } // head may leave a high-behind frame
      assert.ok(L[id], `${id}: ${L.reasons[id]}`);
      assert.equal(L[id].kind, 'ref');
      assert.ok(['estimated', 'low_confidence'].includes(L[id].validity), id);
      assert.ok(L[id].pts.length >= 2 && L[id].pts.every((p) => p.length === 2 && p.every(Number.isFinite)), id);
    }
    // only the lines of the table are ever non-null
    for (const id of LAB_LINE_IDS) if (!SPEC[view].includes(id)) assert.equal(L[id], null, id);
  });
}

test('no calibration: ball planes and target line null + NO_CALIBRATION; pose lines still drawn', () => {
  const { s, events } = swing('dtl');
  const L = computeLines({ view: 'dtl', poseSeq: s.poseSeq, events, calibration: null });
  for (const id of ['ball_hand_plane', 'ball_shoulder_plane', 'target_line']) { assert.equal(L[id], null, id); assert.deepEqual(L.reasons[id], ['NO_CALIBRATION'], id); }
  for (const id of ['head_box', 'spine', 'butt_line']) assert.ok(L[id], id);
  const F = computeLines({ view: 'face_on', poseSeq: swing('face_on').s.poseSeq, events: swing('face_on').events, calibration: {} });
  assert.deepEqual(F.reasons.target_line, ['NO_CALIBRATION']);
});

test('no pose: pose lines null + POSE_LOW_VISIBILITY; target line from the calibration alone; no address event', () => {
  const { s, events } = swing('dtl');
  const L = computeLines({ view: 'dtl', poseSeq: null, events, calibration: { camera: s.camera } });
  assert.deepEqual(L.reasons.spine, ['POSE_LOW_VISIBILITY']);
  assert.ok(L.target_line);
  const M = computeLines({ view: 'dtl', poseSeq: s.poseSeq, events: {}, calibration: { camera: s.camera } });
  assert.deepEqual(M.reasons.spine, ['EVENTS_UNCERTAIN']);
});

test('the spine reference follows the address pose; the live line at the top is off it (deviates)', () => {
  const { s, events } = swing('face_on');
  const ref = computeLines({ view: 'face_on', poseSeq: s.poseSeq, events, calibration: { camera: s.camera } });
  const top = eventFrame(s.poseSeq, events, 'top');
  const live = computeLines({ view: 'face_on', poseSeq: s.poseSeq, events, calibration: { camera: s.camera }, frame: top });
  assert.equal(live.spine.kind, 'live');
  const a = eventFrame(s.poseSeq, events, 'address');
  const same = computeLines({ view: 'face_on', poseSeq: s.poseSeq, events, calibration: { camera: s.camera }, frame: a });
  assert.equal(deviates(ref.spine, same.spine, 0.03), false);
  assert.equal(deviates(ref.shoulders, live.shoulders), true);
  // spine runs from the hips up: the second point is higher in the image (smaller v)
  assert.ok(ref.spine.pts[1][1] < ref.spine.pts[0][1]);
});

test('left-handed swing: lines are computed in the physical image (the trail shoulder is the left one)', () => {
  const { s, events } = swing('dtl', { handedness: 'left' });
  const L = computeLines({ view: 'dtl', poseSeq: s.poseSeq, events, calibration: { camera: s.camera }, handedness: 'left' });
  assert.ok(L.ball_shoulder_plane && L.butt_line && L.spine);
});

function fakeCtx(W = 400, H = 300) {
  const log = [];
  const ctx = { canvas: { width: W, height: H }, log, lineWidth: 1, strokeStyle: null,
    save() {}, restore() {}, setLineDash(d) { log.push(['dash', d.length]); }, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    stroke() { log.push(['stroke', ctx.strokeStyle, ctx.lineWidth]); } };
  return ctx;
}

test('drawLines: only enabled non-null lines, select colour over an outline; live dashed, caution when off', () => {
  const { s, events } = swing('face_on');
  const ref = computeLines({ view: 'face_on', poseSeq: s.poseSeq, events, calibration: { camera: s.camera } });
  const ctx = fakeCtx();
  const palette = { select: 'SEL', caution: 'CAU', outline: 'BG' };
  const r = drawLines(ctx, ref, { frame: 0, palette, enabled: ['spine', 'shoulders', 'butt_line'] });
  assert.deepEqual(r.drawn, ['spine', 'shoulders']);
  const strokes = ctx.log.filter((x) => x[0] === 'stroke');
  assert.deepEqual(strokes.map((x) => x[1]), ['BG', 'SEL', 'BG', 'SEL']);
  assert.ok(strokes[0][2] > strokes[1][2], 'outline wider than the line');
  const live = computeLines({ view: 'face_on', poseSeq: s.poseSeq, events, calibration: { camera: s.camera }, frame: eventFrame(s.poseSeq, events, 'top') });
  const c2 = fakeCtx();
  drawLines(c2, ref, { palette, enabled: ['shoulders'], live });
  assert.deepEqual(c2.log.filter((x) => x[0] === 'stroke').map((x) => x[1]), ['BG', 'SEL', 'BG', 'CAU']);
  assert.deepEqual(drawLines(fakeCtx(0, 0), ref, { palette }).drawn, []);
});
