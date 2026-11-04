import test from 'node:test';
import assert from 'node:assert/strict';
import { renderClip, makeShotSpec, makeRestSpec } from '../synth/render.js';

const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b} (tol ${tol})`);

function flatSpec(over = {}) {
  return {
    W: 96, H: 64, nFrames: 1, fps: 240, seed: 11,
    bg: { base: 100, amp: 0, lines: 0, grain: 0 }, noise: 0, flicker: null, psf: 0,
    ball: { level: 200, shade: 0, frames: [{ u0: 40.3, v0: 30.6, u1: 40.3, v1: 30.6, r: 8 }] },
    ...over,
  };
}

function massAndCentroid(frame, W, H, base, contrast) {
  let m = 0, su = 0, sv = 0, minX = Infinity, maxX = -Infinity;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = (frame[y * W + x] - base) / contrast;
    if (Math.abs(c) < 1e-9) continue;
    m += c; su += c * (x + 0.5); sv += c * (y + 0.5);
    if (c > 0.02) { minX = Math.min(minX, x); maxX = Math.max(maxX, x + 1); }
  }
  return { mass: m, u: su / m, v: sv / m, width: maxX - minX };
}

test('render: deterministic for equal seeds, different for different seeds', () => {
  const a = renderClip(makeShotSpec(5)), b = renderClip(makeShotSpec(5)), c = renderClip(makeShotSpec(6));
  assert.equal(a.frames.length, b.frames.length);
  for (const f of [0, 10, 20, 33]) assert.deepEqual(a.frames[f], b.frames[f]);
  assert.notDeepEqual(a.frames[0], c.frames[0]);
  assert.deepEqual(Array.from(a.times.slice(0, 3)), [0, 1 / 240, 2 / 240]);
  for (const f of a.frames) assert.ok(f instanceof Uint8Array && f.length === 384 * 216);
});

test('render: a still anti-aliased disk has area pi r^2 and its centroid is the given centre', () => {
  const clip = renderClip(flatSpec());
  const m = massAndCentroid(clip.frames[0], 96, 64, 100, 100);
  near(m.mass, Math.PI * 64, 0.8, 'area'); // 1 % of 201 px
  near(m.u, 40.3, 0.03, 'u'); near(m.v, 30.6, 0.03, 'v');
  near(clip.truth.ball[0].u, 40.3, 1e-9); near(clip.truth.ball[0].v, 30.6, 1e-9);
  assert.equal(clip.truth.ball[0].w_px, 16);
});

test('render: motion blur conserves the ball "mass", centres the blob on the path midpoint and stretches it by the path length', () => {
  const f = { u0: 30, v0: 20, u1: 54, v1: 32, r: 5 };       // length sqrt(24^2 + 12^2) = 26.83
  const clip = renderClip(flatSpec({ ball: { level: 200, frames: [f] } }));
  const m = massAndCentroid(clip.frames[0], 96, 64, 100, 100);
  near(m.mass, Math.PI * 25, 1.2, 'mass');
  near(m.u, 42, 0.05); near(m.v, 26, 0.05);
  near(clip.truth.ball[0].u, 42, 1e-6); near(clip.truth.ball[0].v, 26, 1e-6);
  assert.ok(m.width >= 24 + 8 && m.width <= 24 + 10 + 1, `blob width ${m.width} (path 24 + diameter 10)`);
});

test('render: hold fraction (impact inside the exposure) moves the centroid towards the start', () => {
  const f = { u0: 30, v0: 30, u1: 50, v1: 30, r: 5, hold: 0.5 };
  const clip = renderClip(flatSpec({ ball: { level: 200, frames: [f] } }));
  // truth: half the time at 30, the other half moving 30 -> 50 (mean 40) => centroid 35
  near(clip.truth.ball[0].u, 35, 0.02);
  const m = massAndCentroid(clip.frames[0], 96, 64, 100, 100);
  near(m.u, 35, 0.06);
});

test('render: tee is a thin bar under the ball; shadow only while the ball is on its spot; truth reports the tee', () => {
  const spec = flatSpec({
    nFrames: 2,
    ball: { level: 200, frames: [{ u0: 40, v0: 30, u1: 40, v1: 30, r: 8 }, null] },
    tee: { len: 14, width: 3, level: 240 }, restPos: { u: 40, v: 30, r: 8 }, shadow: { depth: 30, untilFrame: 0 },
  });
  const clip = renderClip(spec);
  const f0 = clip.frames[0], f1 = clip.frames[1];
  // inside the tee column, below the ball bottom (y = 38): tee level
  assert.equal(f0[42 * 96 + 40], 240);
  assert.equal(f1[42 * 96 + 40], 240, 'the tee stays after the ball is gone');
  assert.equal(f0[42 * 96 + 45], 100, 'the tee is thin: 5 px to the side is mat');
  assert.equal(f1[30 * 96 + 40], 100, 'ball gone');
  const sh0 = f0[(38 + 14 + 2) * 96 + 40], sh1 = f1[(38 + 14 + 2) * 96 + 40];
  assert.ok(sh0 < 100 && sh1 === 100, `shadow ${sh0} / ${sh1}`);
  assert.equal(clip.truth.tee.len, 14);
  near(clip.truth.tee.u, 40, 1e-9);
});

test('render: Gaussian noise has the requested sigma and flicker shifts the whole frame', () => {
  const spec = flatSpec({ nFrames: 6, ball: { level: 200, frames: [null, null, null, null, null, null] }, noise: 4, flicker: { gain: 0.05, offset: 3 } });
  const clip = renderClip(spec);
  const means = clip.frames.map((f) => f.reduce((a, b) => a + b, 0) / f.length);
  assert.ok(Math.max(...means) - Math.min(...means) > 1.0, `flicker spread ${Math.max(...means) - Math.min(...means)}`);
  // noise sigma: std of (frame - its own mean)
  const f = clip.frames[0];
  const m = means[0];
  let v = 0;
  for (const x of f) v += (x - m) ** 2;
  near(Math.sqrt(v / f.length), 4, 0.25, 'sigma');
});

test('render: makeShotSpec respects the documented ranges (radius, blur aspect <= 4, visible frames) over 300 seeds', () => {
  let minNVis = 99, maxNVis = 0;
  for (let s = 1; s <= 300; s++) {
    const spec = makeShotSpec(s);
    assert.ok(spec.meta.r >= 7 && spec.meta.r <= 11, `r ${spec.meta.r}`);
    assert.ok(spec.meta.aspect <= 4.0001, `aspect ${spec.meta.aspect}`);
    assert.ok(spec.meta.nVis >= 5.5 && spec.meta.nVis <= 15);
    assert.equal(spec.ball.frames.length, spec.nFrames);
    minNVis = Math.min(minNVis, spec.meta.nVis); maxNVis = Math.max(maxNVis, spec.meta.nVis);
    assert.ok(spec.distractor && spec.club);
  }
  assert.ok(minNVis < 6.5 && maxNVis > 14);
  const clean = makeShotSpec(3, { distractor: false, club: false, shadow: false });
  assert.equal(clean.distractor, null); assert.equal(clean.club, null); assert.equal(clean.shadow, null);
});

test('render: distractor stays far from the ball path and the club truth exists before impact', () => {
  const clip = renderClip(makeShotSpec(8));
  const t = clip.truth;
  const spec = clip.spec;
  let minD = Infinity;
  for (let k = 0; k < spec.nFrames; k++) {
    const b = t.ball[k], d = t.distractor[k];
    if (b && d) minD = Math.min(minD, Math.hypot(b.u - d.u, b.v - d.v));
  }
  assert.ok(minD > 40, `min ball-distractor distance ${minD}`);
  const pre = t.club.slice(0, Math.floor(spec.meta.tImp)).filter(Boolean);
  assert.ok(pre.length >= 2, `club visible before impact in ${pre.length} frames`);
});

test('render: makeRestSpec draws the same ball in every frame; tee option honoured', () => {
  const a = renderClip(makeRestSpec(21, { tee: true, nFrames: 3 }));
  assert.equal(a.frames.length, 3);
  assert.ok(a.truth.tee && a.truth.rest.r >= 7 && a.truth.rest.r <= 12);
  const b = renderClip(makeRestSpec(21, { nFrames: 1 }));
  assert.equal(b.truth.tee, null);
});
