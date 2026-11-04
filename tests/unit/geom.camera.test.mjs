import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeCamera, project, projectMany, ray, center, lookAt, fFromHfov, hfovFromF, rFromEuler, eulerFromR,
  poseReport, nominalCamera, distortNormalized, undistortNormalized, intersectRayZ, toCamera, NOMINAL_GEOMETRY,
} from '../../app/src/geom/camera.js';
import { isRotation, mat3MulVec } from '../../app/src/geom/linalg.js';
import { DEG, IPHONE_HFOV_1080P240_DEG, DEFAULT_READOUT_MS } from '../../app/src/geom/constants.js';
import { mulberry32, gauss } from '../../app/src/geom/rng.js';

const VIEWS = ['face_on', 'dtl', 'high_behind'];
const F1080 = fFromHfov(1920, IPHONE_HFOV_1080P240_DEG);
const maxAbsDiff = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));

function pixelGrid(cam, n = 7) {
  const out = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) out.push([(cam.W * i) / (n - 1), (cam.H * j) / (n - 1)]);
  }
  out.push([0.5, 0.5], [cam.W - 0.5, cam.H - 0.5], [cam.cx, cam.cy]);
  return out;
}

function testCameras(k1 = 0) {
  const r = mulberry32(17);
  const cams = VIEWS.map((v) => nominalCamera(v, { k1 }));
  for (let i = 0; i < 4; i++) {
    const C = [gauss(r), gauss(r) - 3, 1 + 0.3 * gauss(r)];
    const e = { yaw: 0.2 * gauss(r), pitch: 0.2 * gauss(r), roll: 0.1 * gauss(r) };
    cams.push(makeCamera({ W: 1280, H: 720, f: 950, k1, ...rFromEuler(e, 'face_on', C) }));
  }
  return cams;
}

test('principal point and pixel origin: u/v measured from the top-left corner, cx = W/2, cy = H/2', () => {
  const cam = makeCamera({ W: 1920, H: 1080, f: 1000 });
  assert.equal(cam.cx, 960);
  assert.equal(cam.cy, 540);
  const p = project(cam, [0, 0, 2]);
  assert.equal(p.u, 960);
  assert.equal(p.v, 540);
  const edge = project(cam, [0.96, -0.54, 1]); // +x right, −y up in the camera frame
  assert.ok(Math.abs(edge.u - 1920) < 1e-12 && Math.abs(edge.v - 0) < 1e-12);
  assert.deepEqual(cam.readout, { ms: DEFAULT_READOUT_MS, axis: 'v', dir: 1 });
  const behind = project(cam, [0, 0, -1]);
  assert.ok(Number.isNaN(behind.u) && Number.isNaN(behind.v) && behind.z === -1);
});

test('fFromHfov / hfovFromF', () => {
  assert.ok(Math.abs(fFromHfov(1920, 90) - 960) < 1e-12);
  assert.ok(Math.abs(hfovFromF(1920, fFromHfov(1920, 68.161)) - 68.161) < 1e-12);
  assert.ok(Math.abs(F1080 - 1418.954) < 1e-3);
});

test('makeCamera: C ↔ t, plain JSON round trip, validation', () => {
  const C = [0.4, -2.7, 0.84];
  const { R } = lookAt(C, [0, 0, 0]);
  const cam = makeCamera({ W: 1920, H: 1080, f: F1080, R, C });
  assert.ok(maxAbsDiff(center(cam), C) < 1e-15);
  const copy = makeCamera(JSON.parse(JSON.stringify(cam)));
  assert.equal(JSON.stringify(copy), JSON.stringify(cam)); // JSON drops the sign of −0, so compare as JSON
  assert.ok(maxAbsDiff(toCamera(cam, C), [0, 0, 0]) < 1e-15);
  assert.throws(() => makeCamera({ W: 1920, H: 1080 }), TypeError);
  assert.throws(() => makeCamera({ W: 1920, H: 1080, f: 1000, readout: { axis: 'x' } }), RangeError);
  assert.equal(makeCamera({ W: 1920, H: 1080, hfovDeg: 90 }).f, fFromHfov(1920, 90));
});

test('project ∘ ray round trip < 1e-9 px (k1 = 0)', () => {
  let worst = 0;
  for (const cam of testCameras(0)) {
    for (const [u, v] of pixelGrid(cam)) {
      const { C, d } = ray(cam, u, v);
      assert.ok(Math.abs(Math.hypot(...d) - 1) < 1e-15);
      for (const s of [0.3, 2.7, 25]) {
        const p = project(cam, [C[0] + s * d[0], C[1] + s * d[1], C[2] + s * d[2]]);
        worst = Math.max(worst, Math.abs(p.u - u), Math.abs(p.v - v));
      }
    }
  }
  assert.ok(worst < 1e-9, `worst ${worst}`);
});

test('k1 ≠ 0: undistort fixed point and project ∘ ray round trip < 1e-6 px', () => {
  for (const k1 of [-0.2, -0.08, 0.05, 0.15]) {
    for (let x = -0.7; x <= 0.7; x += 0.1) {
      for (let y = -0.4; y <= 0.4; y += 0.1) {
        const [xd, yd] = distortNormalized(k1, x, y);
        const [xu, yu] = undistortNormalized(k1, xd, yd);
        assert.ok(Math.abs(xu - x) < 1e-13 && Math.abs(yu - y) < 1e-13, `k1=${k1} (${x},${y})`);
      }
    }
    let worst = 0;
    for (const cam of testCameras(k1)) {
      for (const [u, v] of pixelGrid(cam)) {
        const { C, d } = ray(cam, u, v);
        assert.ok(Number.isFinite(d[0]), `k1=${k1} undistort failed at (${u},${v})`);
        const p = project(cam, [C[0] + 3 * d[0], C[1] + 3 * d[1], C[2] + 3 * d[2]]);
        worst = Math.max(worst, Math.abs(p.u - u), Math.abs(p.v - v));
      }
    }
    assert.ok(worst < 1e-6, `k1=${k1} worst ${worst}`);
  }
  // Distortion actually moves pixels (barrel: k1 < 0 pulls corners inward).
  const c0 = nominalCamera('face_on');
  const c1 = nominalCamera('face_on', { k1: -0.1 });
  const X = [1.2, 0, 1.5];
  assert.ok(project(c1, X).u - c1.cx < project(c0, X).u - c0.cx);
  // Outside the invertible region the inverse reports failure instead of a wrong point.
  const bad = undistortNormalized(-0.5, 2, 0);
  assert.ok(Number.isNaN(bad[0]));
});

test('lookAt puts the target on the principal point (any roll) and agrees with rFromEuler', () => {
  const r = mulberry32(4);
  for (let i = 0; i < 50; i++) {
    const C = [3 * gauss(r), 3 * gauss(r), 1 + Math.abs(gauss(r))];
    const target = [gauss(r), gauss(r), 0.5 * gauss(r)];
    const roll = 0.3 * gauss(r);
    const cam = makeCamera({ W: 1920, H: 1080, f: F1080, ...lookAt(C, target, [0, 0, 1], roll) });
    assert.ok(isRotation(cam.R, 1e-14));
    const p = project(cam, target);
    assert.ok(Math.abs(p.u - cam.cx) < 1e-9 && Math.abs(p.v - cam.cy) < 1e-9);
    for (const view of VIEWS) {
      const e = eulerFromR(cam.R, view);
      assert.ok(Math.abs(e.roll - roll) < 1e-12);
      assert.ok(maxAbsDiff(rFromEuler(e, view), cam.R) < 1e-14);
    }
  }
  assert.throws(() => lookAt([0, 0, 2], [0, 0, 0]), RangeError);
});

test('rFromEuler → eulerFromR round trip < 1e-9 rad for every view', () => {
  const grid = [-10, -7.5, -5, -2.5, -1, 0, 0.5, 2.5, 5, 7.5, 10].map((d) => d * DEG);
  for (const view of VIEWS) {
    const pitches = view === 'high_behind' ? grid.map((p) => p - 30 * DEG) : grid;
    let worst = 0;
    for (const yaw of grid) {
      for (const pitch of pitches) {
        for (const roll of grid) {
          const R = rFromEuler({ yaw, pitch, roll }, view);
          if (!isRotation(R, 1e-14)) assert.fail(`${view}: not a rotation`);
          const e = eulerFromR(R, view);
          worst = Math.max(worst, Math.abs(e.yaw - yaw), Math.abs(e.pitch - pitch), Math.abs(e.roll - roll));
        }
      }
    }
    assert.ok(worst < 1e-9, `${view} worst ${worst}`);
  }
  // Large yaw wraps into [−π, π).
  const e = eulerFromR(rFromEuler({ yaw: 3, pitch: 0.1, roll: -0.2 }, 'dtl'), 'dtl');
  assert.ok(Math.abs(e.yaw - 3) < 1e-12);
  // Gimbal (optical axis vertical) does not throw.
  const g = eulerFromR(rFromEuler({ yaw: 0.3, pitch: -Math.PI / 2, roll: 0 }, 'dtl'), 'dtl');
  assert.ok(Math.abs(g.pitch + Math.PI / 2) < 1e-9 && Number.isFinite(g.yaw) && Math.abs(g.roll) < 1e-9);
  assert.throws(() => rFromEuler({ yaw: 0, pitch: 0, roll: 0 }, 'top'), RangeError);
});

test('nominal headings: face_on +y, dtl +x, high_behind +x pitched down', () => {
  const f = (R) => [R[6], R[7], R[8]];
  assert.ok(maxAbsDiff(f(rFromEuler({ yaw: 0, pitch: 0, roll: 0 }, 'face_on')), [0, 1, 0]) < 1e-15);
  assert.ok(maxAbsDiff(f(rFromEuler({ yaw: 0, pitch: 0, roll: 0 }, 'dtl')), [1, 0, 0]) < 1e-15);
  const hb = f(rFromEuler({ yaw: 0, pitch: -30 * DEG, roll: 0 }, 'high_behind'));
  assert.ok(maxAbsDiff(hb, [Math.cos(30 * DEG), 0, -0.5]) < 1e-15);
  // Image down axis is world −z at zero pitch/roll; image right is +x for face_on, −y for dtl.
  const Rf = rFromEuler({ yaw: 0, pitch: 0, roll: 0 }, 'face_on');
  assert.ok(maxAbsDiff([Rf[0], Rf[1], Rf[2]], [1, 0, 0]) < 1e-15 && maxAbsDiff([Rf[3], Rf[4], Rf[5]], [0, 0, -1]) < 1e-15);
  const Rd = rFromEuler({ yaw: 0, pitch: 0, roll: 0 }, 'dtl');
  assert.ok(maxAbsDiff([Rd[0], Rd[1], Rd[2]], [0, -1, 0]) < 1e-15);
});

test('sign conventions by concrete points: yaw CCW from above, pitch up, roll clockwise as seen by camera', () => {
  const a = 5 * DEG;
  for (const view of VIEWS) {
    const p0 = view === 'high_behind' ? -30 * DEG : 0;
    const C = [0.1, -0.2, 1.2];
    const nom = rFromEuler({ yaw: 0, pitch: p0, roll: 0 }, view);
    const f0 = [nom[6], nom[7], nom[8]];
    const r0 = [nom[0], nom[1], nom[2]];
    const up0 = [-nom[3], -nom[4], -nom[5]];
    const ahead = [C[0] + 4 * f0[0], C[1] + 4 * f0[1], C[2] + 4 * f0[2]];
    const camFor = (e) => makeCamera({ W: 1920, H: 1080, f: F1080, ...rFromEuler({ pitch: p0, ...e }, view, C) });

    // Yaw +: the optical axis turns counter-clockwise seen from above (azimuth increases), so a point that
    // was straight ahead now sits to the right of the image centre.
    const cy = camFor({ yaw: a, roll: 0 });
    const fy = [cy.R[6], cy.R[7], cy.R[8]];
    const crossZ = f0[0] * fy[1] - f0[1] * fy[0]; // z of f0 × f_yawed
    assert.ok(crossZ > 0, `${view}: yaw+ must be CCW from above`);
    const py = project(cy, ahead);
    assert.ok(py.u > cy.cx + 10 && Math.abs(py.v - cy.cy) < 10, `${view}: yaw+ → u ${py.u}`);
    if (view === 'face_on') assert.ok(fy[0] < 0); // +y heading turns toward −x
    else assert.ok(fy[1] > 0); // +x heading turns toward +y

    // Pitch +: the optical axis rises, so a point that was straight ahead appears below the centre.
    const cp = makeCamera({ W: 1920, H: 1080, f: F1080, ...rFromEuler({ yaw: 0, pitch: p0 + a, roll: 0 }, view, C) });
    assert.ok(cp.R[8] > f0[2]);
    const pp = project(cp, ahead);
    assert.ok(pp.v > cp.cy + 10 && Math.abs(pp.u - cp.cx) < 1e-6, `${view}: pitch+ → v ${pp.v}`);

    // Roll +: camera turns clockwise (seen from the camera), image content turns counter-clockwise:
    // a point to the right of centre moves up, a point above centre moves left.
    const cr = camFor({ yaw: 0, roll: a });
    const right = [ahead[0] + 0.5 * r0[0], ahead[1] + 0.5 * r0[1], ahead[2] + 0.5 * r0[2]];
    const above = [ahead[0] + 0.5 * up0[0], ahead[1] + 0.5 * up0[1], ahead[2] + 0.5 * up0[2]];
    const prr = project(cr, right);
    const pra = project(cr, above);
    assert.ok(prr.u > cr.cx && prr.v < cr.cy - 5, `${view}: roll+ right point → v ${prr.v}`);
    assert.ok(pra.v < cr.cy && pra.u < cr.cx - 5, `${view}: roll+ upper point → u ${pra.u}`);
    // And eulerFromR reads the same signs back.
    const e = eulerFromR(cr.R, view);
    assert.ok(e.roll > 0 && Math.abs(e.yaw) < 1e-12);
  }
});

test('nominal face_on camera (D 2.7, h 0.84, shift 0.4) puts the ball spot left of and below centre', () => {
  const cam = nominalCamera('face_on');
  assert.equal(cam.W, 1920);
  assert.equal(cam.H, 1080);
  assert.ok(Math.abs(cam.f - fFromHfov(1920, 68.161)) < 1e-12);
  assert.ok(maxAbsDiff(center(cam), [0.4, -2.7, 0.84]) < 1e-12);
  const p = project(cam, [0, 0, 0]);
  const uExp = cam.cx - (0.4 * cam.f) / 2.7;
  assert.ok(Math.abs(p.u - uExp) < 1e-9, `u ${p.u} vs ${uExp}`);
  assert.ok(p.u < cam.cx);
  assert.ok(p.v > cam.cy);
  assert.ok(Math.abs(p.v - (cam.cy + (0.84 * cam.f) / 2.7)) < 1e-9);
  // The target (+x) is to the right in the face_on image.
  assert.ok(project(cam, [1, 0, 0]).u > p.u);
  const rep = poseReport(cam, 'face_on');
  assert.ok(Math.abs(rep.yaw_deg) < 1e-12 && Math.abs(rep.pitch_deg) < 1e-12 && Math.abs(rep.roll_deg) < 1e-12);
  assert.ok(Math.abs(rep.D_m - Math.hypot(0.4, 2.7)) < 1e-12 && Math.abs(rep.h_m - 0.84) < 1e-12);
});

test('nominal dtl and high_behind cameras', () => {
  const dtl = nominalCamera('dtl');
  assert.equal(dtl.W, 1080);
  assert.equal(dtl.H, 1920);
  assert.ok(Math.abs(dtl.f - F1080) < 1e-12); // same lens: f follows the long side
  const pd = project(dtl, [0, 0, 0]);
  assert.ok(pd.u > dtl.cx && pd.v > dtl.cy); // ball is right of the hands line, below the camera
  assert.ok(project(dtl, [0, 0.8, 0]).u < pd.u); // the golfer (+y) is on the left of a DTL image
  const hb = nominalCamera('high_behind');
  const g = NOMINAL_GEOMETRY.high_behind;
  const ph = project(hb, [0, 0, 0]);
  assert.ok(Math.abs(ph.u - hb.cx) < 1e-9 && Math.abs(ph.v - hb.cy) < 1e-9);
  const rep = poseReport(hb, 'high_behind');
  assert.ok(Math.abs(rep.pitch_deg - -Math.atan2(g.h, g.Db) / DEG) < 1e-9);
  assert.ok(rep.pitch_deg < -29 && rep.pitch_deg > -32);
  assert.ok(Math.abs(rep.D_m - g.Db) < 1e-12 && Math.abs(rep.yaw_deg) < 1e-9 && Math.abs(rep.roll_deg) < 1e-9);
  // Offsets are applied on top of the nominal angles.
  const hb2 = nominalCamera('high_behind', { yaw: 1 * DEG, roll: -0.5 * DEG });
  const rep2 = poseReport(hb2, 'high_behind');
  assert.ok(Math.abs(rep2.yaw_deg - 1) < 1e-9 && Math.abs(rep2.roll_deg + 0.5) < 1e-9);
});

test('projectMany matches project; intersectRayZ recovers ground points', () => {
  const cam = nominalCamera('high_behind', { k1: -0.05 });
  const pts = [[0, 0, 0], [0.5, 0.2, 0.1], [-0.3, 0.1, 0.02], [1.2, -0.1, 0.4]];
  const { uv, z } = projectMany(cam, pts);
  const flat = projectMany(cam, pts.flat());
  pts.forEach((X, i) => {
    const p = project(cam, X);
    assert.equal(uv[2 * i], p.u);
    assert.equal(uv[2 * i + 1], p.v);
    assert.equal(z[i], p.z);
    assert.equal(flat.uv[2 * i], p.u);
  });
  const g = [0.25, -0.12, 0];
  const p = project(cam, g);
  const X = intersectRayZ(ray(cam, p.u, p.v), 0);
  assert.ok(maxAbsDiff(X, g) < 1e-9);
  // A ray pointing up never meets the ground in front of the camera.
  const up = ray(cam, cam.cx, 0);
  const R = cam.R;
  assert.ok(mat3MulVec(R, up.d)[2] > 0);
  assert.equal(intersectRayZ({ C: [0, 0, 1], d: [0, 0, 1] }, 0), null);
});
