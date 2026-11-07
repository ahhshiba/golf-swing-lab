// LM-C acceptance 1 (LAUNCH-MONITOR-SPEC §5.2): projectFlight against the fixture camera, and the 3-D orbit
// projection on known points (error < 1e-9).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { projectFlight, orbitCamera, project3 } from '../../app/src/viz/index.js';

const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`../fixtures/shots/v2/${name}.json`, import.meta.url), 'utf8'));

for (const name of ['valid_face_on_240', 'valid_high_behind_240']) {
  test(`projectFlight: ${name} samples[0] lands on the impact-frame ball centre (≤ 2 px)`, () => {
    const shot = fixture(name);
    const proj = projectFlight(shot.calibration.camera, shot.flight.samples);
    assert.equal(proj.length, shot.flight.samples.length);
    const hit = shot.tracks.ball_px.find((p) => p[0] === shot.tracks.impact_frame);
    assert.ok(hit, 'impact frame present in tracks.ball_px');
    const d = Math.hypot(proj[0][0] - hit[1], proj[0][1] - hit[2]);
    console.log(`# ${name}: |projected − ball_px| = ${d.toFixed(4)} px`);
    assert.ok(d <= 2, `distance ${d} px`);
  });
}

test('projectFlight: behind the camera / malformed → null, never throws', () => {
  const cam = fixture('valid_face_on_240').calibration.camera;
  const out = projectFlight(cam, [[0, 0, -50, 0], [0, 'x', 0, 0], null]);
  assert.deepEqual(out, [null, null, null]);
  assert.deepEqual(projectFlight(null, []), []);
});

// Independent reference: build the camera basis from a yaw/pitch rotation (Rz(yaw)·Ry(-pitch) applied to the
// "looking down +x" basis), not from the closed form used in traj3d.js.
function reference(o, p) {
  const D = Math.PI / 180;
  const rotY = (v, a) => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)];
  const rotZ = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]];
  const tf = (v) => rotZ(rotY(v, o.pitch * D), o.yaw * D);
  const fwd = tf([1, 0, 0]);
  const right = tf([0, -1, 0]);
  const up = tf([0, 0, 1]);
  const eye = o.center.map((c, i) => c - o.dist * fwd[i]);
  const q = p.map((x, i) => x - eye[i]);
  const d = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const F = o.h / 2 / Math.tan((o.fov * D) / 2);
  const z = d(q, fwd);
  return [o.w / 2 + (F * d(q, right)) / z, o.h / 2 - (F * d(q, up)) / z, z];
}

test('orbit camera: known points project exactly (< 1e-9)', () => {
  // closed form: yaw 0, pitch 0, centre (100,0,0), dist 200 → eye (−100,0,0); F = h/2 / tan(fov/2)
  const o = { yaw: 0, pitch: 0, dist: 200, center: [100, 0, 0], fov: 60, w: 400, h: 300 };
  const cam = orbitCamera(o);
  const F = 150 / Math.tan(Math.PI / 6);
  const cases = [
    [[0, 0, 0], [200, 150, 100]],
    [[100, 0, 0], [200, 150, 200]],
    [[0, 0, 30], [200, 150 - (F * 30) / 100, 100]],
  ];
  for (const [p, want] of cases) {
    const got = project3(cam, p);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(got[i] - want[i]) < 1e-9, `${p}: ${got} vs ${want}`);
  }
  // the same three points under turned / tilted cameras against the rotation-matrix reference
  for (const yaw of [0, 37, 90, -135]) {
    for (const pitch of [0, 18, 45, 89.5]) {
      const oo = { yaw, pitch, dist: 260, center: [150, 4, 0], fov: 50, w: 390, h: 330 };
      const c2 = orbitCamera(oo);
      for (const p of [[0, 0, 0], [100, 0, 0], [0, 0, 30]]) {
        const got = project3(c2, p);
        const want = reference(oo, p);
        for (let i = 0; i < 3; i++) assert.ok(Math.abs(got[i] - want[i]) < 1e-9, `yaw ${yaw} pitch ${pitch} ${p}: ${got} vs ${want}`);
      }
    }
  }
  // +y is toward the golfer (left seen from behind the tee): it must land left of centre at yaw 0
  assert.ok(project3(cam, [100, 10, 0])[0] < 200);
  // behind the camera → null
  assert.equal(project3(cam, [-150, 0, 0]), null);
});
