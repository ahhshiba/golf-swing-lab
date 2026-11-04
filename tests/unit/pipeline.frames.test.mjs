import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rgbaToGray, rgbaToGrayCrop, cropGray, clampRoi, resolveTimestamps, effectiveFps, nearestFrame, impactWindow,
  sliceWindow, suggestBallRoi, PRE_IMPACT_FRAMES, POST_IMPACT_FRAMES,
} from '../../app/src/pipeline/frames.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { mulberry32 } from '../../app/src/geom/rng.js';

function rgba(W, H, fn) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, b] = fn(x, y);
    const q = (y * W + x) * 4;
    data[q] = r; data[q + 1] = g; data[q + 2] = b; data[q + 3] = 255;
  }
  return { data, width: W, height: H }; // ImageData-like (width/height keys)
}

test('rgbaToGray: BT.601 luma, rounded, alpha ignored', () => {
  const img = rgba(5, 1, (x) => [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255], [10, 20, 30]][x]);
  const g = rgbaToGray(img);
  assert.deepEqual(Array.from(g), [76, 150, 29, 255, Math.round(0.299 * 10 + 0.587 * 20 + 0.114 * 30)]);
  // random pixels: within 0.5 DN (+ fixed-point weight error) of the floating-point formula
  const rng = mulberry32(3);
  const im2 = rgba(64, 32, () => [Math.floor(rng() * 256), Math.floor(rng() * 256), Math.floor(rng() * 256)]);
  const g2 = rgbaToGray({ data: im2.data, W: 64, H: 32 });
  for (let p = 0; p < 64 * 32; p++) {
    const d = im2.data;
    const y = 0.299 * d[4 * p] + 0.587 * d[4 * p + 1] + 0.114 * d[4 * p + 2];
    assert.ok(Math.abs(g2[p] - y) <= 0.505, `pixel ${p}`); // 16.16 fixed-point weights: |Δw·255| < 0.005
  }
  assert.throws(() => rgbaToGray({ data: new Uint8Array(3), W: 2, H: 2 }), RangeError);
});

test('crop: rgbaToGrayCrop equals cropGray(rgbaToGray) and keeps the origin', () => {
  const img = rgba(40, 30, (x, y) => [x * 6, y * 8, (x + y) % 256]);
  const full = rgbaToGray(img);
  const roi = { x: 7.4, y: 3.2, w: 20.1, h: 11.5 };
  const a = rgbaToGrayCrop(img, roi);
  const b = cropGray(full, 40, 30, roi);
  assert.deepEqual(a.roi, { x: 7, y: 3, w: 21, h: 12 });
  assert.deepEqual(a.origin, { u: 7, v: 3 });
  assert.equal(a.W, 21); assert.equal(a.H, 12);
  assert.deepEqual(Array.from(a.data), Array.from(b.data));
  assert.equal(a.data[2 * 21 + 5], full[(3 + 2) * 40 + 7 + 5]);
  assert.equal(clampRoi({ x: -5, y: -5, w: 100, h: 100 }, 40, 30).w, 40);
  assert.equal(clampRoi({ x: 50, y: 0, w: 5, h: 5 }, 40, 30), null);
  assert.deepEqual(clampRoi(null, 40, 30), { x: 0, y: 0, w: 40, h: 30 });
  assert.throws(() => cropGray(full, 40, 30, { x: 60, y: 0, w: 1, h: 1 }), RangeError);
});

test('resolveTimestamps: container CTS kept, missing / non-monotonic -> nominal + TIMESTAMPS_NOMINAL', () => {
  const cts = [0, 1 / 240, 2 / 240, 3 / 240];
  const ok = resolveTimestamps(cts, 4, 240);
  assert.equal(ok.kind, 'container');
  assert.deepEqual(ok.reason_codes, []);
  const bad = resolveTimestamps([0, 0.01, 0.005, 0.02], 4, 240);
  assert.equal(bad.kind, 'nominal');
  assert.deepEqual(bad.reason_codes, [RC.TIMESTAMPS_NOMINAL]);
  assert.ok(Math.abs(bad.times[3] - 3 / 240) < 1e-12);
  const none = resolveTimestamps(null, 3, 30);
  assert.equal(none.kind, 'nominal');
  assert.equal(none.times.length, 3);
  assert.throws(() => resolveTimestamps(null, 3, 0), RangeError);
  assert.ok(Math.abs(effectiveFps(ok.times) - 240) < 1e-9);
  assert.ok(Number.isNaN(effectiveFps([1])));
});

test('impactWindow: 30 before / impact / 60 after at full rate, clamped to the clip (P5)', () => {
  assert.equal(PRE_IMPACT_FRAMES, 30);
  assert.equal(POST_IMPACT_FRAMES, 60);
  const times = Float64Array.from({ length: 720 }, (_, i) => i / 240);
  assert.equal(nearestFrame(times, 1.5 + 0.4 / 240), 360);
  assert.equal(nearestFrame(times, 1.5 + 0.6 / 240), 361);
  assert.equal(nearestFrame(times, -1), 0);
  assert.equal(nearestFrame(times, 99), 719);
  assert.equal(nearestFrame([], 1), -1);
  const w = impactWindow({ times, impact_t_s: 1.5 });
  assert.deepEqual(w, { start: 330, end: 421, impact: 360, n: 91, clipped: false });
  const early = impactWindow({ times, impact_frame: 10 });
  assert.equal(early.start, 0); assert.equal(early.end, 71); assert.equal(early.clipped, true);
  const late = impactWindow({ n: 400, impact_frame: 380 });
  assert.equal(late.end, 400); assert.equal(late.start, 350);
  const s = sliceWindow(Array.from({ length: 720 }, (_, i) => i), times, w);
  assert.equal(s.frames.length, 91);
  assert.equal(s.frames[30], 360);
  assert.ok(Math.abs(s.times[30] - 1.5) < 1e-12);
  assert.throws(() => impactWindow({ n: 10 }), RangeError);
});

test('suggestBallRoi: behind the ball to the image edge toward the target, top to below the ball', () => {
  const r = suggestBallRoi({ W: 1920, H: 1080, rest: { u: 750, v: 970, w_px: 22 }, dir: [0.9, -0.4] });
  assert.equal(r.y, 0);
  assert.equal(r.x + r.w, 1920);
  assert.ok(r.x < 750 - 22 && r.y + r.h > 970 + 11 && r.y + r.h <= 1080);
  const l = suggestBallRoi({ W: 1920, H: 1080, rest: { u: 1200, v: 900, w_px: 20 }, dir: [-1, -0.2] });
  assert.equal(l.x, 0);
  assert.ok(l.x + l.w > 1200 + 10);
});
