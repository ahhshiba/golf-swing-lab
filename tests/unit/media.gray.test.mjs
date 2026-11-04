// import/gray.js: luma, ROI clamping, and the rotation transform agreeing with timebase.displayPoint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { rgbaToGray, roiInDisplay, createFrameConverter } from '../../app/src/import/gray.js';
import { displayPoint } from '../../app/src/import/timebase.js';
import { rgbaToGray as framesGray } from '../../app/src/pipeline/frames.js';

test('rgbaToGray is BT.601 luma and matches pipeline/frames.js within 1 level', () => {
  const px = [[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 255, 0], [0, 0, 255], [12, 200, 77]];
  const rgba = new Uint8ClampedArray(px.flatMap((p) => [...p, 255]));
  const g = rgbaToGray(rgba);
  assert.deepEqual(Array.from(g.slice(0, 2)), [0, 255]);
  const ref = framesGray({ data: rgba, W: px.length, H: 1 });
  for (let i = 0; i < px.length; i++) assert.ok(Math.abs(g[i] - ref[i]) <= 1, `${i}: ${g[i]} vs ${ref[i]}`);
});

test('roiInDisplay clamps and scales', () => {
  assert.deepEqual(roiInDisplay({ x: -10, y: 5, w: 3000, h: 100 }, 1920, 1080, 384), { x: 0, y: 5, w: 1920, h: 100, scale: 0.2, dw: 384, dh: 20 });
  assert.deepEqual(roiInDisplay(null, 100, 50), { x: 0, y: 0, w: 100, h: 50, scale: 1, dw: 100, dh: 50 });
});

function fakeCanvasEnv(log) {
  class Ctx {
    constructor(c) { this.c = c; this.m = [1, 0, 0, 1, 0, 0]; }
    setTransform(a, b, c, d, e, f) { this.m = [a, b, c, d, e, f]; }
    mul(n) { const [a, b, c, d, e, f] = this.m; const [A, B, C, D, E, F] = n; this.m = [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f]; }
    scale(x, y) { this.mul([x, 0, 0, y, 0, 0]); }
    translate(x, y) { this.mul([1, 0, 0, 1, x, y]); }
    rotate(t) { const c = Math.cos(t), s = Math.sin(t); this.mul([c, s, -s, c, 0, 0]); }
    drawImage(img, ...a) { log.push({ m: this.m.slice(), a, w: this.c.width, h: this.c.height }); }
    getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4).fill(100) }; }
  }
  class OffscreenCanvas { constructor(w, h) { this.width = w; this.height = h; } getContext() { return (this.ctx ??= new Ctx(this)); } transferToImageBitmap() { return { width: this.width, height: this.height, close() {} }; } }
  return { OffscreenCanvas };
}

test('rotated VideoFrame: canvas transform maps coded pixels to (displayPoint - roi) * scale', async () => {
  const Wc = 1920, Hc = 1080;
  const frame = { codedWidth: Wc, codedHeight: Hc, displayWidth: Wc, displayHeight: Hc };
  for (const rot of [90, 180, 270]) {
    const log = [];
    const conv = createFrameConverter({ env: fakeCanvasEnv(log) });
    const roi = { x: 100, y: 300, w: 600, h: 900 };
    const out = await conv.toBitmap(frame, { rotation: rot, roi, maxWidth: 300 });
    const expW = rot === 180 ? Wc : Hc;
    assert.equal(out.W, expW);
    assert.equal(out.scale, 0.5);
    const { m } = log[0];
    for (const [x, y] of [[0, 0], [Wc, 0], [37, 911], [Wc, Hc]]) {
      const cx = m[0] * x + m[2] * y + m[4];
      const cy = m[1] * x + m[3] * y + m[5];
      const [X, Y] = displayPoint(x, y, rot, Wc, Hc);
      assert.ok(Math.abs(cx - (X - roi.x) * 0.5) < 1e-9 && Math.abs(cy - (Y - roi.y) * 0.5) < 1e-9, `rot ${rot} (${x},${y})`);
    }
  }
  // an ImageBitmap (already upright) ignores the rotation and uses a plain crop
  const log = [];
  const conv = createFrameConverter({ env: fakeCanvasEnv(log) });
  const g = conv.toGray({ width: 640, height: 360 }, { rotation: 90, roi: { x: 10, y: 20, w: 30, h: 40 } });
  assert.deepEqual(log[0].a, [10, 20, 30, 40, 0, 0, 30, 40]);
  assert.equal(g.data.length, 1200);
  assert.deepEqual(g.origin, { u: 10, v: 20 });
  assert.equal(g.data[0], 100);
});

test('media sources: no external URLs, no hash routing, no OpenCV / Ultralytics, local vendor imports only', () => {
  const roots = ['capture', 'sensors', 'audio', 'import', 'pose', 'workers'].map((d) => join('app/src', d));
  const files = roots.flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.js')).map((f) => join(d, f)));
  files.push('app/src/pipeline/clip.js', 'app/src/pipeline/live.js');
  assert.ok(files.length >= 18, String(files.length));
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /https?:\/\//, f);
    assert.doesNotMatch(s, /location\.hash|history\.(pushState|replaceState)/, f);
    assert.doesNotMatch(s, /opencv|ultralytics/i, f);
    for (const m of s.matchAll(/from\s+'([^']+)'/g)) assert.match(m[1], /^\.\.?\//, `${f}: bare import ${m[1]}`);
  }
});
