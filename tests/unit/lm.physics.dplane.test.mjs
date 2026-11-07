// LAUNCH-MONITOR-SPEC §5.2 LM-B acceptance 1: D-plane forward / inverse round trip (< 1e-9°), the vector spin axis
// against the small-angle form atan(tan F2P / tan SL), and the sign table (open face -> + axis, curves away from a
// right-handed golfer; a left-hander mirrored).
import test from 'node:test';
import assert from 'node:assert/strict';
import { forwardDplane, inverseDplane, inverseVertical, inverseHorizontal, spinAxisDeg, spinLoft3D, hRatio, vRatio } from '../../app/src/physics/lm/dplane.js';
import { fly } from '../../app/src/physics/lm/flight.js';
import { deriveLaunchMonitor } from '../../app/src/physics/lm/index.js';
import { mulberry32 } from '../../app/src/geom/rng.js';

const D = Math.PI / 180;

test('forward D-plane then inverse recovers face, dynamic loft (< 1e-9°) for a grid of deliveries', () => {
  let worst = 0;
  for (const face of [-6, -2, 0, 3, 6]) for (const path of [-4, 0, 5]) for (const dl of [10, 20, 35, 50]) for (const aoa of [-6, -2, 0, 3]) {
    const fw = forwardDplane({ face, path, dl, aoa });
    const j = inverseDplane({ launch_h: fw.launch_h, launch_v: fw.launch_v, path, aoa });
    const v = inverseVertical(fw.launch_v, aoa, { face, path });
    const h = inverseHorizontal(fw.launch_h, path, fw.spin_loft);
    for (const e of [j.face - face, j.dl - dl, v.dl - dl, h.face - face, h.face_to_path - (face - path)]) worst = Math.max(worst, Math.abs(e));
  }
  assert.ok(worst < 1e-9, `worst round-trip error ${worst}°`);
});

test('ratios: h, v interpolate the Wood 2018 means at 13 / 30 / 50° spin loft and hold the ends', () => {
  assert.equal(hRatio(13), 0.76); assert.equal(hRatio(30), 0.69); assert.equal(hRatio(50), 0.61); assert.equal(hRatio(5), 0.76); assert.equal(hRatio(70), 0.61);
  assert.equal(vRatio(13), 0.83); assert.equal(vRatio(30), 0.81); assert.equal(vRatio(50), 0.72);
  assert.ok(Math.abs(vRatio(40) - 0.765) < 1e-12);
  assert.ok(Math.abs(spinLoft3D(-4, 0, 21, 0) - 25) < 1e-9, 'square face, zero path: SL = DL − A');
});

test('vector spin axis vs small-angle atan(tan F2P / tan SL): < 0.5° for |F2P| ≤ 6°, SL 10–40°, attack ±3°', () => {
  let worst = 0;
  for (let f2p = -6; f2p <= 6; f2p += 1) for (let sl = 10; sl <= 40; sl += 5) for (const aoa of [-3, 0, 3]) for (const path of [-4, 0, 4]) {
    const dl = sl + aoa;
    const ax = spinAxisDeg(aoa, path, dl, path + f2p);
    // SL here = the vertical spin loft DL − A (the small-angle formula's SL; the 3D angle also contains F − P)
    const small = Math.atan(Math.tan(f2p * D) / Math.tan(sl * D)) / D;
    worst = Math.max(worst, Math.abs(ax - small));
  }
  assert.ok(worst < 0.5, `worst ${worst.toFixed(3)}°`);
});

test('sign table: open face -> + axis -> flight bends away from a right-handed golfer; closed -> −; left-hander mirrored', () => {
  assert.ok(spinAxisDeg(-3, 0, 20, 4) > 0, 'open face (F > P): + axis');
  assert.ok(spinAxisDeg(-3, 0, 20, -4) < 0, 'closed face: − axis');
  assert.ok(Math.abs(spinAxisDeg(-3, 2, 20, 2)) < 1e-9, 'face = path: no tilt');
  assert.ok(spinAxisDeg(-3, -5, 20, -1) > 0, 'face open to an in-to-out path is + even when both are negative');
  // + axis curves toward −y (right of target for a right-hander, the + side of every reported angle)
  const base = { speed_mps: 50, launch_v_deg: 15, spin_rpm: 6000 };
  assert.ok(fly({ ...base, axis_deg: 10 }).y < -1 && fly({ ...base, axis_deg: -10 }).y > 1);
  assert.ok(Math.abs(fly({ ...base, axis_deg: 0 }).y) < 1e-9);
  // derived high_behind shot: same numbers for both hands (angles are + away from the golfer), mat-frame flight mirrored
  const m = (value, sigma) => ({ value, unit: 'deg', ci95: [value - 2 * sigma, value + 2 * sigma], sigma, validity: 'low_confidence', value_origin: 'club_track', measured: false, reason_codes: [] });
  const metrics = { club_speed_mps: m(40, 2), launch_h_deg: m(2, 0.35), club_path_deg: m(-1, 3) };
  const run = (handedness) => deriveLaunchMonitor({ view: 'high_behind', fps: 240, club: { type: '7i' }, metrics, settings: {}, rng: mulberry32(3), handedness });
  const R = run('right');
  const L = run('left');
  assert.ok(R.metrics.face_to_path_deg.value > 0 && R.metrics.spin_axis_deg.value > 0, 'launch right of an in-to-out path: open to the path, + axis');
  assert.ok(R.metrics.curve_m.value > 0 && R.metrics.carry_side_m.value > 0);
  for (const id of ['face_angle_deg', 'face_to_path_deg', 'spin_axis_deg', 'carry_side_m', 'curve_m', 'carry_m']) {
    assert.equal(L.metrics[id].value, R.metrics[id].value, id);
  }
  const yr = R.flight.samples.at(-1)[2], yl = L.flight.samples.at(-1)[2];
  assert.ok(yr < 0 && Math.abs(yr + yl) < 1e-9, `mat-frame landing y right ${yr} left ${yl}`);
  assert.ok(Math.abs(-yr - R.metrics.carry_side_m.value) < 1e-9, 'right-hander: + side = −y in the mat frame');
});
