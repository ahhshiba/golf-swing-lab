import test from 'node:test';
import assert from 'node:assert/strict';
import { ghostCorners, ghostDistance, presetCamera } from '../../app/src/calib/ghost.js';
import { createPreset } from '../../app/src/calib/preset.js';
import { matCorners, DEFAULT_VENUE } from '../../app/src/calib/mat.js';
import { solveMatPose } from '../../app/src/calib/pnp.js';
import { nominalCamera, project, poseReport, fFromHfov } from '../../app/src/geom/camera.js';
import { DEG } from '../../app/src/geom/constants.js';

for (const view of ['face_on', 'dtl', 'high_behind']) {
  test(`${view}: ghost corners are the mat seen from the preset pose and lie in the 95 % box`, () => {
    const cam = nominalCamera(view, { yaw: 0.4 * DEG, pitch: -0.3 * DEG, roll: 0.2 * DEG });
    const preset = createPreset({ venue_id: 'v1', view, pose: poseReport(cam, view), f_locked: cam.f, W: cam.W, H: cam.H, created_at: 't0' });
    const g = ghostCorners(preset, DEFAULT_VENUE, { W: cam.W, H: cam.H });
    const truth = matCorners(DEFAULT_VENUE).map((X) => { const p = project(cam, X); return [p.u, p.v]; });
    const d = ghostDistance(truth, g);
    assert.ok(d.max_px < 1e-6, `${d.max_px}`);
    assert.deepEqual(g.in_frame, [true, true, true, true]);
  });
}

test('ghost uses the current stream: 720p from a 1080p preset scales f; an explicit template f wins', () => {
  const cam = nominalCamera('face_on');
  const preset = createPreset({ venue_id: 'v', view: 'face_on', pose: poseReport(cam, 'face_on'), f_locked: cam.f, W: 1920, H: 1080, created_at: 0 });
  const c720 = presetCamera(preset, { W: 1280, H: 720 });
  assert.ok(Math.abs(c720.f - cam.f * (1280 / 1920)) < 1e-9);
  const g1080 = ghostCorners(preset, DEFAULT_VENUE, { W: 1920, H: 1080 }).corners;
  const g720 = ghostCorners(preset, DEFAULT_VENUE, { W: 1280, H: 720 }).corners;
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(g720[i][0] - (g1080[i][0] * 2) / 3) < 1e-6 && Math.abs(g720[i][1] - (g1080[i][1] * 2) / 3) < 1e-6);
  }
  const live = presetCamera(preset, { W: 1920, H: 1080, f: fFromHfov(1920, 60) });
  assert.ok(Math.abs(live.f - fFromHfov(1920, 60)) < 1e-9);
  const nof = presetCamera({ ...preset, f_locked: null }, { W: 1920, H: 1080 });
  assert.ok(Math.abs(nof.f - cam.f) < 1e-9);
});

test('ghostDistance: per-corner, max and RMS; a missing corner gives NaN max', () => {
  const g = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const o = [[3, 4], [10, 0], [10, 10], [0, 10]];
  const d = ghostDistance(o, g);
  assert.deepEqual(d.per_corner_px, [5, 0, 0, 0]);
  assert.equal(d.max_px, 5);
  assert.equal(d.rms_px, 2.5);
  assert.ok(Number.isNaN(ghostDistance([null, ...o.slice(1)], g).max_px));
});

test('a camera moved 5 cm along the target line moves the ghost-to-mat distance past 8 px and the re-solved pose shows ΔX', () => {
  const cam = nominalCamera('face_on');
  const preset = createPreset({ venue_id: 'v', view: 'face_on', pose: poseReport(cam, 'face_on'), f_locked: cam.f, W: 1920, H: 1080, created_at: 0 });
  const moved = nominalCamera('face_on', { shift: 0.45 });
  const obs = matCorners(DEFAULT_VENUE).map((X) => { const p = project(moved, X); return [p.u, p.v]; });
  const d = ghostDistance(obs, ghostCorners(preset, DEFAULT_VENUE, { W: 1920, H: 1080 }));
  assert.ok(d.max_px > 8, `${d.max_px}`);
  const s = solveMatPose({ corners: obs, venue: DEFAULT_VENUE, view: 'face_on', W: 1920, H: 1080, f: cam.f });
  assert.ok(Math.abs(s.pose.X_m - preset.pose.X_m - 0.05) < 1e-6);
});
