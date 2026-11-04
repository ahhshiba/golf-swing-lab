import test from 'node:test';
import assert from 'node:assert/strict';
import { medianBackground, sampleIndices, RunningBackground, diffFrame, asGray } from '../../app/src/track/bgsub.js';
import { mulberry32, gauss } from '../../app/src/geom/rng.js';

const u8 = (a) => Uint8Array.from(a);

test('medianBackground: exact median, odd number of frames (3x2 image)', () => {
  const frames = [u8([10, 20, 30, 40, 50, 60]), u8([30, 20, 10, 60, 50, 40]), u8([20, 90, 0, 50, 0, 255])];
  const bg = medianBackground(frames, 3, 2);
  assert.ok(bg instanceof Float32Array);
  assert.deepEqual(Array.from(bg), [20, 20, 10, 50, 50, 60]);
});

test('medianBackground: even count averages the two middle values (numpy semantics)', () => {
  const frames = [u8([0, 10]), u8([100, 11]), u8([50, 13]), u8([60, 200])];
  // pixel 0: 0,50,60,100 -> (50+60)/2 = 55 ; pixel 1: 10,11,13,200 -> 12
  assert.deepEqual(Array.from(medianBackground(frames, 2, 1)), [55, 12]);
  assert.deepEqual(Array.from(medianBackground([u8([7, 9]), u8([8, 10])], 2, 1)), [7.5, 9.5]);
  assert.deepEqual(Array.from(medianBackground([u8([7, 9])], 2, 1)), [7, 9]);
});

test('medianBackground: sample indices follow trunc(linspace(0, n-1, m)) like tracking.py', () => {
  assert.deepEqual(sampleIndices(10, 4), [0, 3, 6, 9]);
  assert.deepEqual(sampleIndices(5, 60), [0, 1, 2, 3, 4]);
  assert.deepEqual(sampleIndices(100, 3), [0, 49, 99]);
  const idx60 = sampleIndices(100, 60);
  assert.equal(idx60.length, 60);
  assert.equal(idx60[0], 0); assert.equal(idx60[59], 99);
  // constant frames with value 10*k: the median of the sampled values is exact
  const frames = Array.from({ length: 10 }, (_, k) => u8([10 * k]));
  assert.deepEqual(Array.from(medianBackground(frames, 1, 1, 4)), [45]); // frames 0,3,6,9 -> (30+60)/2
});

test('medianBackground: all 256 values and random data agree with a sort-based reference', () => {
  const rng = mulberry32(7);
  for (const n of [1, 2, 3, 4, 5, 9, 17, 60]) {
    const W = 5, H = 4;
    const frames = Array.from({ length: n }, () => Uint8Array.from({ length: W * H }, () => Math.floor(rng() * 256)));
    const bg = medianBackground(frames, W, H, 60);
    for (let p = 0; p < W * H; p++) {
      const v = frames.map((f) => f[p]).sort((a, b) => a - b);
      const ref = n % 2 ? v[(n - 1) / 2] : 0.5 * (v[n / 2 - 1] + v[n / 2]);
      assert.equal(bg[p], ref, `n=${n} p=${p}`);
    }
  }
  const sat = [u8([0, 255]), u8([255, 255]), u8([255, 0])];
  assert.deepEqual(Array.from(medianBackground(sat, 2, 1)), [255, 255]);
});

test('medianBackground: ROI leaves the outside at 0; region uses only the listed frames', () => {
  const W = 6, H = 2;
  const mk = (v) => new Uint8Array(W * H).fill(v);
  const frames = [mk(100), mk(100), mk(100), mk(100), mk(100)];
  // a resting "ball" (value 200) at pixel (2,0) in the first 3 frames, gone afterwards
  for (let f = 0; f < 3; f++) frames[f][2] = 200;
  const plain = medianBackground(frames, W, H);
  assert.equal(plain[2], 200, 'majority vote keeps the resting ball in the plain median');
  const fixed = medianBackground(frames, W, H, 60, { region: { x: 1, y: 0, w: 3, h: 1 }, regionFrames: [3, 4] });
  assert.equal(fixed[2], 100);
  assert.equal(fixed[1], 100);
  const roi = medianBackground(frames, W, H, 60, { roi: { x: 2, y: 0, w: 2, h: 1 } });
  assert.deepEqual(Array.from(roi), [0, 0, 200, 100, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test('RunningBackground: converges to the static scene, ignores a bright passer-by, absorbs a parked object slowly', () => {
  const W = 8, H = 8, N = W * H;
  const scene = (extra) => { const f = new Uint8Array(N).fill(80); if (extra) extra(f); return f; };
  const bg = new RunningBackground(W, H, { alpha: 0.1, alphaFg: 0.002, fgThresh: 25, warmup: 4 });
  for (let k = 0; k < 10; k++) bg.update(scene());
  assert.ok(bg.bg.every((v) => Math.abs(v - 80) < 1e-4));
  // a passer-by for 3 frames at pixel 27: the model hardly moves
  for (let k = 0; k < 3; k++) bg.update(scene((f) => { f[27] = 230; }));
  assert.ok(bg.bg[27] < 80 + 3 * 0.002 * 150 + 1e-3, `${bg.bg[27]}`);
  // a parked object (30 DN brighter: below fgThresh? no, above) - with fgThresh 25 it adapts at alphaFg, 20 DN adapts at alpha
  const slow = new RunningBackground(W, H, { alpha: 0.1, alphaFg: 0.002, fgThresh: 25, warmup: 2 });
  const fast = new RunningBackground(W, H, { alpha: 0.1, alphaFg: 0.002, fgThresh: 25, warmup: 2 });
  for (let k = 0; k < 4; k++) { slow.update(scene()); fast.update(scene()); }
  for (let k = 0; k < 20; k++) { slow.update(scene((f) => { f[5] = 140; })); fast.update(scene((f) => { f[5] = 100; })); }
  assert.ok(slow.bg[5] < 84, `a high-contrast object is absorbed only at alphaFg (${slow.bg[5]})`);
  assert.ok(fast.bg[5] > 97, 'a low-contrast change is absorbed');
});

test('diffFrame: gain/offset compensation removes global flicker; sigma estimates the noise; polarity options', () => {
  const W = 96, H = 64;
  const rng = mulberry32(3);
  const bg = new Float32Array(W * H);
  for (let i = 0; i < bg.length; i++) bg[i] = 90 + 25 * Math.sin(i * 0.013) + 15 * Math.sin(i * 0.31) + 10 * (rng() - 0.5);
  const frame = new Uint8Array(W * H);
  const g = 1.12, o = -9;
  for (let i = 0; i < frame.length; i++) frame[i] = Math.round(g * bg[i] + o + gauss(rng, 0, 3));
  const out = new Float32Array(W * H);
  const fit = diffFrame(frame, bg, W, H, null, out);
  assert.ok(Math.abs(fit.gain - g) < 0.02, `gain ${fit.gain}`);
  assert.ok(Math.abs(fit.sigma - 3) < 0.6, `sigma ${fit.sigma}`);
  let mean = 0;
  for (let i = 0; i < out.length; i++) mean += out[i];
  mean /= out.length;
  assert.ok(mean < 2.7, `mean |diff| with compensation (noise sigma 3 -> 2.39) ${mean}`);
  const out2 = new Float32Array(W * H);
  diffFrame(frame, bg, W, H, null, out2, { compensate: false });
  let mean2 = 0;
  for (let i = 0; i < out2.length; i++) mean2 += out2[i];
  assert.ok(mean2 / out2.length > mean + 0.6, `without compensation the flicker shows up (${mean2 / out2.length} vs ${mean})`);
  // a bright square is NOT absorbed into the fit (robust) and polarity picks the sign
  for (let y = 20; y < 30; y++) for (let x = 30; x < 40; x++) frame[y * W + x] = 255;
  const bright = new Float32Array(W * H), dark = new Float32Array(W * H);
  diffFrame(frame, bg, W, H, null, bright, { polarity: 'bright' });
  diffFrame(frame, bg, W, H, null, dark, { polarity: 'dark' });
  assert.ok(bright[25 * W + 35] > 100);
  assert.equal(dark[25 * W + 35], 0);
});

test('diffFrame: roi restricts the work; asGray validates its input', () => {
  const W = 20, H = 10;
  const bg = new Float32Array(W * H).fill(50);
  const frame = new Uint8Array(W * H).fill(50);
  frame[2 * W + 3] = 200; frame[2 * W + 15] = 200;
  const out = new Float32Array(W * H);
  diffFrame(frame, bg, W, H, { x: 10, y: 0, w: 10, h: 10 }, out);
  assert.equal(out[2 * W + 3], 0);
  assert.equal(out[2 * W + 15], 150);
  assert.deepEqual(asGray(frame, { W, H }), { data: frame, W, H });
  const gray = { data: frame, W, H };
  assert.equal(asGray(gray), gray);
  assert.throws(() => asGray(frame), TypeError);
});
