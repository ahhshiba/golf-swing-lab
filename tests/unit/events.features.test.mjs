// Event features v1: names/version, resampling, numpy-equivalent gradient/unwrap, handedness mirroring, and the
// golden vector in tests/fixtures/evfeat-1.golden.json (regenerate with UPDATE_GOLDEN=1 only on a deliberate
// FEATURE_VERSION change; the training module's Python reproduction is checked against the same file).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  FEATURE_NAMES, FEATURE_VERSION, FEATURE_HZ, computeFeatures, resamplePose, gradient, unwrap, LR_SWAP,
} from '../../app/src/events/features.js';
import { synthSwing } from '../synth/swing.js';

const GOLDEN = fileURLToPath(new URL('../fixtures/evfeat-1.golden.json', import.meta.url));

function goldenInput() {
  // 45 frames of a 60 fps face-on swing with ±2 ms timestamp jitter (VFR), takeaway to past the top
  const s = synthSwing({ seed: 11, view: 'face_on', fps: 60, tsJitter_s: 0.002 });
  const a = 55;
  const n = 45;
  const t_s = Array.from(s.poseSeq.t_s.slice(a, a + n));
  const img = Array.from(s.poseSeq.img.slice(a * 132, (a + n) * 132));
  return { t_s, img, W: s.poseSeq.W, H: s.poseSeq.H };
}

function toPoseSeq(inp) {
  return { t_s: Float64Array.from(inp.t_s), img: Float32Array.from(inp.img), W: inp.W, H: inp.H, model: 'synthetic' };
}

test('FEATURE_NAMES / FEATURE_VERSION / FEATURE_HZ', () => {
  assert.equal(FEATURE_VERSION, 'evfeat-1');
  assert.equal(FEATURE_HZ, 30);
  assert.equal(FEATURE_NAMES.length, 12);
  assert.deepEqual([...FEATURE_NAMES], ['wrist_x', 'wrist_y', 'wrist_vx', 'wrist_vy', 'wrist_speed', 'lead_wrist_h',
    'trail_wrist_h', 'shoulder_angle', 'hip_angle', 'lead_elbow', 'trail_elbow', 'vis_mean']);
  assert.ok(Object.isFrozen(FEATURE_NAMES));
});

test('golden vector (evfeat-1) for a fixed synthetic input, right- and left-handed', () => {
  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(GOLDEN)) {
    const input = goldenInput();
    const ps = toPoseSeq(input);
    const fr = computeFeatures(ps, { handedness: 'right' });
    const fl = computeFeatures(ps, { handedness: 'left' });
    const rows = (f) => Array.from({ length: f.K }, (_, k) => Array.from(f.data.slice(k * f.F, (k + 1) * f.F)));
    writeFileSync(GOLDEN, JSON.stringify({
      version: FEATURE_VERSION, hz: FEATURE_HZ, names: FEATURE_NAMES,
      note: 'input.img is float32 data (x_norm, y_norm, z, visibility per landmark, 33 landmarks per frame). '
        + 'features_right / features_left = computeFeatures(input, { handedness }). Tolerance for ports: 1e-5.',
      input, t_grid: Array.from(fr.t_s), torso_px: fr.torso_px, features_right: rows(fr), features_left: rows(fl),
    }));
  }
  const g = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  assert.equal(g.version, FEATURE_VERSION);
  assert.deepEqual(g.names, [...FEATURE_NAMES]);
  const ps = toPoseSeq(g.input);
  for (const [hand, key] of [['right', 'features_right'], ['left', 'features_left']]) {
    const f = computeFeatures(ps, { handedness: hand });
    assert.equal(f.K, g[key].length);
    assert.equal(f.F, 12);
    let maxd = 0;
    for (let k = 0; k < f.K; k++) for (let j = 0; j < 12; j++) maxd = Math.max(maxd, Math.abs(f.data[k * 12 + j] - g[key][k][j]));
    assert.ok(maxd <= 1e-9, `${hand}: max |diff| ${maxd}`);
    for (let k = 0; k < f.K; k++) assert.ok(Math.abs(f.t_s[k] - g.t_grid[k]) < 1e-12);
  }
  assert.ok(g.features_right.length >= 20, 'golden covers at least 20 grid frames');
});

test('resamplePose: uniform 30 Hz grid and exact linear interpolation', () => {
  const T = 7;
  const t_s = Float64Array.from([0.1, 0.12, 0.17, 0.2, 0.26, 0.3, 0.35]);
  const img = new Float32Array(T * 132);
  for (let i = 0; i < T; i++) for (let c = 0; c < 132; c++) img[i * 132 + c] = 0.25 + 0.5 * t_s[i] + 0.001 * (c % 7);
  const r = resamplePose({ t_s, img, W: 100, H: 50 }, 30);
  assert.equal(r.K, Math.floor((0.35 - 0.1) * 30 + 1e-9) + 1);
  for (let k = 0; k < r.K; k++) {
    assert.ok(Math.abs(r.t[k] - (0.1 + k / 30)) < 1e-15);
    for (const c of [0, 5, 131]) {
      // input is linear in t up to float32 rounding
      assert.ok(Math.abs(r.img[k * 132 + c] - (0.25 + 0.5 * r.t[k] + 0.001 * (c % 7))) < 1e-6);
    }
  }
});

test('gradient matches numpy.gradient(edge_order=1); unwrap matches numpy.unwrap', () => {
  const y = Float64Array.from([0, 1, 4, 9, 16]);
  // numpy.gradient([0, 1, 4, 9, 16], 0.5) == [2, 4, 8, 12, 14]
  assert.deepEqual(Array.from(gradient(y, 2)), [2, 4, 8, 12, 14]);
  const p = Float64Array.from([3.0, -3.0, 3.1, -2.9, 0.5, 4.0]);
  // numpy 2.x: numpy.unwrap([3.0, -3.0, 3.1, -2.9, 0.5, 4.0])
  const exp = [3.0, 3.2831853071795862, 3.1, 3.3831853071795863, 0.5, -2.2831853071795862];
  const u = unwrap(p);
  exp.forEach((e, i) => assert.ok(Math.abs(u[i] - e) < 1e-12, `${i}: ${u[i]} vs ${e}`));
});

test('left-handed mirror image gives the same features as the right-handed swing', () => {
  const R = synthSwing({ seed: 4, view: 'dtl', fps: 30, handedness: 'right' });
  const L = synthSwing({ seed: 4, view: 'dtl', fps: 30, handedness: 'left' });
  const fr = computeFeatures(R.poseSeq, { handedness: 'right' });
  const fl = computeFeatures(L.poseSeq, { handedness: 'left' });
  let maxd = 0;
  for (let i = 0; i < fr.data.length; i++) maxd = Math.max(maxd, Math.abs(fr.data[i] - fl.data[i]));
  assert.ok(maxd < 1e-4, `max diff ${maxd}`);
  for (let j = 0; j < 33; j++) assert.equal(LR_SWAP[LR_SWAP[j]], j);
});

test('features are finite on a full synthetic swing', () => {
  const s = synthSwing({ seed: 2, view: 'high_behind', fps: 60 });
  const f = computeFeatures(s.poseSeq, {});
  assert.equal(f.data.length, f.K * 12);
  for (const x of f.data) assert.ok(Number.isFinite(x));
});
