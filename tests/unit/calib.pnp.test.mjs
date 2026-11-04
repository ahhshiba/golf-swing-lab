import test from 'node:test';
import assert from 'node:assert/strict';
import {
  homographyDLT, focalFromHomography, poseFromHomography, solveMatPose, solvePlanarPnP, nominalF, POSE_KEYS, CORNER_SIGMA_PX,
} from '../../app/src/calib/pnp.js';
import { matCorners, DEFAULT_VENUE } from '../../app/src/calib/mat.js';
import { nominalCamera, project, makeCamera, fFromHfov } from '../../app/src/geom/camera.js';
import { mulberry32 } from '../../app/src/geom/rng.js';
import { std, median, percentile } from '../../app/src/geom/stats.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { synthMatScene } from '../synth/mat.js';

const VIEWS = ['face_on', 'dtl', 'high_behind'];

function poseClose(a, b, tolDeg, tolM) {
  for (const k of POSE_KEYS) {
    const tol = k.endsWith('_deg') ? tolDeg : tolM;
    assert.ok(Math.abs(a[k] - b[k]) <= tol, `${k}: ${a[k]} vs ${b[k]}`);
  }
}

test('homographyDLT maps the 4 mat corners exactly and is scale-normalised', () => {
  const cam = nominalCamera('face_on');
  const world = matCorners(DEFAULT_VENUE);
  const img = world.map((X) => { const p = project(cam, X); return [p.u, p.v]; });
  const H = homographyDLT(world, img);
  assert.ok(Math.abs(H[8] - 1) < 1e-12);
  for (let i = 0; i < 4; i++) {
    const [x, y] = world[i];
    const w = H[6] * x + H[7] * y + H[8];
    assert.ok(Math.abs((H[0] * x + H[1] * y + H[2]) / w - img[i][0]) < 1e-7);
    assert.ok(Math.abs((H[3] * x + H[4] * y + H[5]) / w - img[i][1]) < 1e-7);
  }
  // an interior point (the ball spot) also maps correctly
  const p = project(cam, [0, 0, 0]);
  const w = H[8];
  assert.ok(Math.abs(H[2] / w - p.u) < 1e-6 && Math.abs(H[5] / w - p.v) < 1e-6);
});

for (const view of VIEWS) {
  test(`${view}: focal length from the homography and pose decomposition are exact without noise`, () => {
    const rng = mulberry32(3 + view.length);
    for (let k = 0; k < 5; k++) {
      const f = fFromHfov(1920, 60 + 15 * rng());
      const sc = synthMatScene({ view, rng, sigmaPx: 0, f });
      const world = matCorners(sc.venue);
      const H = homographyDLT(world, sc.cornersTrue);
      const fh = focalFromHomography(H, sc.cam.cx, sc.cam.cy, nominalF(sc.cam.W, sc.cam.H));
      assert.ok(Math.abs(fh.f / f - 1) < 1e-6, `${view} f ${fh.f} vs ${f} (${fh.source})`);
      const { R, t } = poseFromHomography(H, f, sc.cam.cx, sc.cam.cy);
      for (let i = 0; i < 9; i++) assert.ok(Math.abs(R[i] - sc.cam.R[i]) < 1e-6);
      for (let i = 0; i < 3; i++) assert.ok(Math.abs(t[i] - sc.cam.t[i]) < 1e-5);
    }
  });

  test(`${view}: solveMatPose recovers the exact pose without noise (f locked and f free)`, () => {
    const rng = mulberry32(17 + view.length);
    const sc = synthMatScene({ view, rng, sigmaPx: 0 });
    const locked = solveMatPose({ corners: sc.cornersTrue, venue: sc.venue, view, W: sc.cam.W, H: sc.cam.H, f: sc.cam.f });
    assert.ok(locked.ok);
    poseClose(locked.pose, sc.truth, 1e-7, 1e-8);
    assert.ok(locked.rmse < 1e-6);
    assert.ok(Math.abs(locked.fFormat.rel_diff) < 1e-7);
    const free = solveMatPose({ corners: sc.cornersTrue, venue: sc.venue, view, W: sc.cam.W, H: sc.cam.H, f: 1.08 * sc.cam.f, fLocked: false });
    assert.ok(free.ok);
    assert.ok(Math.abs(free.f / sc.cam.f - 1) < 1e-8);
    poseClose(free.pose, sc.truth, 1e-6, 1e-7);
    // camera object is a full geom camera that reprojects the corners
    const cam = makeCamera(free.cam);
    for (let i = 0; i < 4; i++) {
      const p = project(cam, matCorners(sc.venue)[i]);
      assert.ok(Math.hypot(p.u - sc.cornersTrue[i][0], p.v - sc.cornersTrue[i][1]) < 1e-6);
    }
    assert.deepEqual(locked.reason_codes, [RC.NO_GRAVITY_REF]);
  });
}

test('face_on: reported sigmas match the empirical scatter (honest uncertainty, 1 px and 3 px)', () => {
  const rng = mulberry32(2024);
  for (const s of [1, 3]) {
    const err = { yaw_deg: [], roll_deg: [], D_m: [], X_m: [], h_m: [] };
    const sig = { yaw_deg: [], roll_deg: [], D_m: [], X_m: [], h_m: [] };
    const fe = [];
    const fs = [];
    for (let k = 0; k < 150; k++) {
      const sc = synthMatScene({ view: 'face_on', rng, sigmaPx: s });
      const r = solveMatPose({ corners: sc.corners, venue: sc.venue, view: 'face_on', W: sc.cam.W, H: sc.cam.H, f: sc.cam.f, sigmaPx: s, covScale: 'none' });
      for (const key of Object.keys(err)) { err[key].push(r.pose[key] - sc.truth[key]); sig[key].push(r.sigma[key]); }
      fe.push(r.fFormat.f_free / sc.cam.f - 1);
      fs.push(r.fFormat.sigma_rel);
    }
    for (const key of Object.keys(err)) {
      const ratio = std(err[key]) / median(sig[key]);
      assert.ok(ratio > 0.75 && ratio < 1.3, `${s}px ${key}: empirical/reported = ${ratio}`);
    }
    const rf = std(fe) / median(fs);
    assert.ok(rf > 0.7 && rf < 1.4, `${s}px f: empirical/reported = ${rf}`);
  }
});

test('gravity prior tightens pitch and roll and drops NO_GRAVITY_REF', () => {
  const rng = mulberry32(77);
  const e0 = [];
  const e1 = [];
  for (let k = 0; k < 120; k++) {
    const sc = synthMatScene({ view: 'high_behind', rng, sigmaPx: 3 });
    const base = { corners: sc.corners, venue: sc.venue, view: 'high_behind', W: sc.cam.W, H: sc.cam.H, f: sc.cam.f, sigmaPx: 3, formatCheck: false };
    const a = solveMatPose(base);
    const b = solveMatPose({ ...base, gravity: sc.gravity });
    e0.push(a.pose.roll_deg - sc.truth.roll_deg);
    e1.push(b.pose.roll_deg - sc.truth.roll_deg);
    assert.deepEqual(b.reason_codes, []);
    assert.ok(b.sigma.roll_deg < a.sigma.roll_deg);
  }
  assert.ok(std(e1) < 0.85 * std(e0), `${std(e1)} vs ${std(e0)}`);
});

test('f-format check flags a wrong capture format (120 fps crop / 2x lens) and accepts the right one', () => {
  const rng = mulberry32(8);
  const sc = synthMatScene({ view: 'face_on', rng, sigmaPx: 1 });
  const ok = solveMatPose({ corners: sc.corners, venue: sc.venue, view: 'face_on', W: sc.cam.W, H: sc.cam.H, f: sc.cam.f });
  assert.ok(Math.abs(ok.fFormat.rel_diff) < 0.04);
  // the venue lock says 68° HFOV but this clip is a 1080p120 crop (≈37.6° → f ≈ 1.9×)
  const crop = makeCamera({ ...sc.cam, f: fFromHfov(1920, 37.6) });
  const corners = matCorners(sc.venue).map((X) => { const p = project(crop, X); return [p.u, p.v]; });
  const bad = solveMatPose({ corners, venue: sc.venue, view: 'face_on', W: crop.W, H: crop.H, f: sc.cam.f });
  assert.ok(Math.abs(bad.fFormat.rel_diff) > 0.5, `${bad.fFormat.rel_diff}`);
  assert.ok(bad.rmse > 2, `locked-f RMSE should expose the mismatch: ${bad.rmse}`);
});

test('focalFromHomography falls back to f0 when both constraints degenerate (camera looking straight down)', () => {
  const C = [0.1, 0.2, 2.5];
  const down = makeCamera({ W: 1920, H: 1080, f: 1500, C, R: [1, 0, 0, 0, -1, 0, 0, 0, -1] });
  const world = matCorners(DEFAULT_VENUE);
  const H = homographyDLT(world, world.map((X) => { const p = project(down, X); return [p.u, p.v]; }));
  const fh = focalFromHomography(H, 960, 540, 1400);
  assert.equal(fh.source, 'fallback');
  assert.equal(fh.f, 1400);
});

test('solvePlanarPnP validates inputs; CORNER_SIGMA_PX defaults', () => {
  assert.throws(() => solvePlanarPnP({ world: [[0, 0, 0]], img: [[0, 0]], W: 10, H: 10, view: 'face_on' }), RangeError);
  assert.throws(() => solvePlanarPnP({ world: [[0, 0, 1], [1, 0, 0], [1, 1, 0], [0, 1, 0]], img: [[0, 0], [1, 0], [1, 1], [0, 1]], W: 10, H: 10, view: 'face_on' }), RangeError);
  assert.deepEqual(CORNER_SIGMA_PX, { manual: 1, auto: 3 });
  const rng = mulberry32(1);
  const sc = synthMatScene({ view: 'dtl', rng, sigmaPx: 3 });
  const r = solveMatPose({ corners: sc.corners, venue: sc.venue, view: 'dtl', W: sc.cam.W, H: sc.cam.H, f: sc.cam.f, cornerSource: 'auto' });
  assert.equal(r.sigmaPx, 3);
  assert.ok(percentile([r.sigma.yaw_deg], 50) > 0.1);
});
