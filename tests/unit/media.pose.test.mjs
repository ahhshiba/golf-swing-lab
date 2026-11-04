// pose/convert.js (ROI un-cropping into PoseSeq), pose/landmarker.js (clock, local assets, GPU->CPU fallback).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { poseRow, imgToPixels, createPoseSeqBuilder, IMG_STRIDE, WORLD_STRIDE } from '../../app/src/pose/convert.js';
import { createMonotonicClock, assetUrls, createPoseLandmarker, MODELS } from '../../app/src/pose/landmarker.js';
import { computeFeatures } from '../../app/src/events/features.js';

function lmsFromPixels(px, roi, scale) {
  // what MediaPipe would report for a crop (roi) of the full frame, scaled by `scale` (normalised -> scale-free)
  return px.map(([u, v], j) => ({ x: (u - roi.x) / roi.w, y: (v - roi.y) / roi.h, z: -0.1 * (j % 3), visibility: 0.5 + j / 100 }));
}

test('poseRow undoes the ROI crop: full-frame normalised x, y; z rescaled; visibility kept', () => {
  const W = 1920, H = 1080;
  const roi = { x: 600, y: 200, w: 640, h: 800 };
  const px = Array.from({ length: 33 }, (_, j) => [roi.x + 10 + 18 * j, roi.y + 20 + 22 * j]);
  const row = poseRow(lmsFromPixels(px, roi), null, { roi, W, H });
  assert.equal(row.found, true);
  assert.equal(row.img.length, IMG_STRIDE);
  const back = imgToPixels(row.img, W, H);
  for (let j = 0; j < 33; j++) {
    assert.ok(Math.abs(back[2 * j] - px[j][0]) < 1e-3, `u ${j}`);
    assert.ok(Math.abs(back[2 * j + 1] - px[j][1]) < 1e-3, `v ${j}`);
    assert.ok(Math.abs(row.img[4 * j + 2] - (-0.1 * (j % 3)) * (roi.w / W)) < 1e-6);
    assert.ok(Math.abs(row.img[4 * j + 3] - (0.5 + j / 100)) < 1e-6);
  }
  assert.ok(row.world.every(Number.isNaN));
});

test('poseRow without a crop is the identity; no pose -> NaN and visibility 0', () => {
  const lms = Array.from({ length: 33 }, (_, j) => ({ x: j / 40, y: 0.5, z: 0, visibility: 0.9 }));
  const wl = Array.from({ length: 33 }, (_, j) => ({ x: j, y: -j, z: 2 * j }));
  const r = poseRow(lms, wl);
  assert.ok(Math.abs(r.img[4 * 10] - 0.25) < 1e-7);
  assert.equal(r.world.length, WORLD_STRIDE);
  assert.deepEqual(Array.from(r.world.slice(30, 33)), [10, -10, 20]);
  const none = poseRow(undefined, undefined, { roi: { x: 0, y: 0, w: 10, h: 10 }, W: 10, H: 10 });
  assert.equal(none.found, false);
  for (let j = 0; j < 33; j++) { assert.ok(Number.isNaN(none.img[4 * j])); assert.equal(none.img[4 * j + 3], 0); }
});

test('PoseSeq builder gives the interfaces.md layout and is usable by events/features.js', () => {
  const W = 1280, H = 720;
  const b = createPoseSeqBuilder({ W, H, model: 'full' });
  for (let i = 0; i < 40; i++) {
    const lms = Array.from({ length: 33 }, (_, j) => ({ x: 0.4 + 0.004 * j + 0.001 * i, y: 0.2 + 0.02 * j, z: 0, visibility: 0.95 }));
    const wl = Array.from({ length: 33 }, (_, j) => ({ x: 0.01 * j, y: -0.03 * j, z: 0 }));
    assert.equal(b.push(i / 60, poseRow(lms, wl)), true);
  }
  assert.equal(b.push(0.1, poseRow(null, null)), false, 'time must increase');
  const seq = b.build();
  assert.equal(seq.t_s.length, 40);
  assert.equal(seq.img.length, 40 * 132);
  assert.equal(seq.world.length, 40 * 99);
  assert.ok(seq.img instanceof Float32Array && seq.world instanceof Float32Array && seq.t_s instanceof Float64Array);
  assert.equal(seq.W, W);
  const feat = computeFeatures(seq, { handedness: 'right' });
  assert.ok(feat.K > 0);
});

test('monotonic clock: strictly increasing ms across clips, with a gap per new sequence', () => {
  const c = createMonotonicClock();
  const a = [0, 1 / 60, 2 / 60, 2 / 60, 3 / 60].map((t) => c.next(t));
  assert.deepEqual(a, [0, 17, 33, 34, 50]);
  c.newSequence();
  const b = [0, 1 / 60].map((t) => c.next(t));
  assert.equal(b[0], 1050);
  assert.equal(b[1], 1067);
  c.newSequence();
  assert.ok(c.next(5) > 1067);
});

test('asset URLs are local files next to the app (no CDN)', () => {
  for (const m of MODELS) {
    const u = assetUrls({ model: m });
    for (const k of ['bundle', 'model']) {
      assert.ok(u[k].startsWith('file:'), u[k]);
      assert.ok(existsSync(fileURLToPath(u[k])), `${k} missing: ${u[k]}`);
    }
    assert.ok(existsSync(fileURLToPath(`${u.wasm}/vision_wasm_module_internal.js`)));
    assert.ok(existsSync(fileURLToPath(`${u.wasm}/vision_wasm_internal.wasm`)));
  }
  assert.throws(() => assetUrls({ model: 'huge' }), RangeError);
});

test('createPoseLandmarker: GPU failure falls back to CPU; VIDEO mode, local paths, full-frame output', async () => {
  const calls = [];
  const fileset = { tag: 'fs' };
  const vision = {
    FilesetResolver: { forVisionTasks: async (base, mod) => { calls.push(['fileset', base, mod]); return fileset; } },
    PoseLandmarker: {
      createFromOptions: async (fs, opts) => {
        calls.push(['create', opts.baseOptions.delegate, opts.runningMode, opts.baseOptions.modelAssetPath]);
        if (opts.baseOptions.delegate === 'GPU') throw new Error('WebGL unavailable');
        let last = -1;
        return {
          detectForVideo(img, ts) {
            assert.ok(ts > last, 'timestamps must increase'); last = ts;
            return { landmarks: [Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }))], worldLandmarks: [Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }))] };
          },
          close() { calls.push(['close']); },
        };
      },
    },
  };
  const lm = await createPoseLandmarker({ model: 'lite', delegate: 'GPU', vision, moduleWorker: true });
  assert.equal(lm.delegate, 'CPU');
  assert.equal(calls[0][2], true);
  assert.match(calls[0][1], /vendor\/mediapipe\/wasm$/);
  assert.deepEqual(calls.slice(1).map((c) => c[1]), ['GPU', 'CPU']);
  assert.equal(calls[1][2], 'VIDEO');
  assert.match(calls[1][3], /models\/pose_landmarker_lite\.task$/);
  const r = lm.detect({}, 0.1, { roi: { x: 100, y: 0, w: 200, h: 100 }, W: 400, H: 100 });
  assert.ok(Math.abs(r.img[0] - 0.5) < 1e-7); // (100 + 0.5*200)/400
  lm.detect({}, 0.1, null);
  lm.close();
});
