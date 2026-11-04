import test from 'node:test';
import assert from 'node:assert/strict';
import { renderClip, makeRestSpec } from '../synth/render.js';
import { detectRestBall, detectTee } from '../../app/src/track/ball.js';
import { mulberry32, uniform } from '../../app/src/geom/rng.js';

function run(spec, jitter = 0) {
  const clip = renderClip(spec);
  const t = clip.truth.rest;
  // the caller's expectation is slightly off, as a pose prediction or a tap would be
  const exp = { u: t.u + 0.8 * jitter, v: t.v - 0.7 * jitter, w_px: t.w_px * (1 + 0.03 * jitter) };
  const res = detectRestBall({ data: clip.frames[0], W: clip.W, H: clip.H }, null, exp);
  return { res, t, clip };
}

test('rest ball (clean renders, radius 7-12 px, textured mat, tee or not): centre error <= 0.3 px, width error <= 3 %', () => {
  let worstC = 0, worstW = 0, n = 0;
  for (let i = 0; i < 30; i++) {
    const spec = makeRestSpec(100 + i, { r: 7 + (5 * i) / 29, tee: i % 3 === 0 ? true : undefined, noise: 2, shadow: false, flicker: null });
    const { res, t } = run(spec, (i % 5) - 2);
    assert.ok(res, `seed ${100 + i}: ball not found`);
    const ce = Math.hypot(res.u - t.u, res.v - t.v);
    const we = Math.abs(res.w_px - t.w_px) / t.w_px;
    worstC = Math.max(worstC, ce); worstW = Math.max(worstW, we); n++;
    assert.ok(ce <= 0.3, `seed ${100 + i} r=${t.r.toFixed(1)}: centre error ${ce.toFixed(3)} px`);
    assert.ok(we <= 0.03, `seed ${100 + i} r=${t.r.toFixed(1)}: width error ${(we * 100).toFixed(2)} %`);
    assert.equal(res.method, 'lm');
    assert.ok(res.h_px > 0 && res.r_px > 0 && res.conf > 0.3 && res.conf <= 1);
  }
  console.log(`# rest ball clean: ${n} renders, worst centre error ${worstC.toFixed(3)} px, worst width error ${(worstW * 100).toFixed(2)} %`);
});

test('rest ball under realistic conditions (noise 3-4.5 DN, soft shadow, seams, shading): centre <= 0.3 px, width <= 3 %', () => {
  let worstC = 0, worstW = 0;
  for (let i = 0; i < 24; i++) {
    const spec = makeRestSpec(300 + i, { tee: i % 2 === 0 ? true : undefined, noise: 3 + (i % 4) * 0.5, shadow: i % 3 !== 0, shade: i % 2 ? 0.1 : 0, lines: 3 });
    const { res, t } = run(spec, (i % 3) - 1);
    assert.ok(res, `seed ${300 + i}`);
    const ce = Math.hypot(res.u - t.u, res.v - t.v), we = Math.abs(res.w_px - t.w_px) / t.w_px;
    worstC = Math.max(worstC, ce); worstW = Math.max(worstW, we);
  }
  console.log(`# rest ball realistic: worst centre error ${worstC.toFixed(3)} px, worst width error ${(worstW * 100).toFixed(2)} %`);
  assert.ok(worstC <= 0.3, `centre ${worstC}`);
  assert.ok(worstW <= 0.03, `width ${worstW}`);
});

test('lie detection: >= 95 % correct on 40 seeded renders (20 tee, 20 mat), noise / shadows / seams / random mat level', () => {
  const rng = mulberry32(2024);
  const U = (a, b) => uniform(rng, a, b);
  let ok = 0, total = 0;
  const wrong = [];
  for (let i = 0; i < 40; i++) {
    const hasTee = i % 2 === 0;
    const r = U(7, 12);
    const spec = makeRestSpec(500 + i, {
      r, tee: hasTee ? { len: U(12, 24) * (r / 9), width: U(2, 4), level: U(195, 245), cap: rng() < 0.5 ? 0 : 3 } : undefined,
      noise: U(3, 4.5), shadow: rng() < 0.5, lines: 3, amp: U(1, 1.6), shade: rng() < 0.5 ? 0.1 : 0,
    });
    const { res } = run(spec, (i % 3) - 1);
    total++;
    const got = res ? res.lie : 'none';
    if (got === (hasTee ? 'tee' : 'mat')) ok++; else wrong.push(`${500 + i}:${hasTee ? 'tee' : 'mat'}->${got}`);
  }
  console.log(`# lie detection: ${ok}/${total} correct ${wrong.join(' ')}`);
  assert.ok(ok / total >= 0.95, `lie accuracy ${ok}/${total}: ${wrong.join(' ')}`);
});

test('lie detection: harder stress distribution (100 renders incl. 1.5 px tees, low contrast, strong texture) stays >= 95 %', () => {
  const rng = mulberry32(99);
  const U = (a, b) => uniform(rng, a, b);
  let ok = 0, falseTee = 0;
  const N = 100;
  for (let i = 0; i < N; i++) {
    const hasTee = i % 2 === 0;
    const r = U(6.5, 12);
    const spec = makeRestSpec(2000 + i, {
      r, tee: hasTee ? { len: U(8, 26) * (r / 9), width: U(1.5, 4.5), level: U(150, 245), cap: rng() < 0.5 ? 0 : 3 } : undefined,
      noise: U(2, 5), shadow: rng() < 0.5, amp: U(1, 2.2), lines: Math.floor(U(2, 6)), shade: rng() < 0.5 ? 0.1 : 0,
    });
    const { res } = run(spec, 1);
    const got = res ? res.lie : 'none';
    if (got === (hasTee ? 'tee' : 'mat')) ok++;
    if (!hasTee && got === 'tee') falseTee++;
  }
  console.log(`# lie stress: ${ok}/${N} correct, mat called tee: ${falseTee}`);
  assert.ok(ok / N >= 0.95);
  assert.ok(falseTee <= 2);
});

test('lie_conf is high for clear cases and the tee report carries length and width', () => {
  const spec = makeRestSpec(42, { r: 9, tee: { len: 18, width: 3, level: 235, cap: 0 }, noise: 3, shadow: false, base: 100 });
  const { res } = run(spec, 0);
  assert.equal(res.lie, 'tee');
  assert.ok(res.lie_conf >= 0.8);
  assert.ok(res.tee.length_px >= 15 && res.tee.length_px <= 19, `${res.tee.length_px}`);
  assert.ok(res.tee.width_px >= 2 && res.tee.width_px <= 4.5, `${res.tee.width_px}`);
  assert.ok(Math.abs(res.tee.x_px - spec.restPos.u) < 0.8);
  const matSpec = makeRestSpec(43, { r: 9, noise: 3, shadow: true, base: 100 });
  const mat = run(matSpec, 0).res;
  assert.equal(mat.lie, 'mat');
  assert.ok(mat.lie_conf >= 0.7, `${mat.lie_conf}`);
});

test('documented limit: a tee with almost no contrast to the mat reads as mat', () => {
  const spec = makeRestSpec(44, { r: 9, tee: { len: 18, width: 3, level: 108, cap: 0 }, noise: 3, shadow: false, base: 100 });
  const { res } = run(spec, 0);
  assert.equal(res.lie, 'mat');
});

test('detectTee on its own: tee under a given ball ellipse; typed array + dims accepted; border cases return "not present"', () => {
  const spec = makeRestSpec(45, { r: 10, tee: { len: 20, width: 3.5, level: 230, cap: 3 }, noise: 2, shadow: false, base: 100 });
  const clip = renderClip(spec);
  const t = clip.truth.rest;
  const tee = detectTee(clip.frames[0], { u: t.u, v: t.v, rx: t.r, ry: t.r }, { W: clip.W, H: clip.H });
  assert.equal(tee.present, true);
  assert.ok(tee.conf >= 0.75);
  // a ball with no tee underneath
  const none = renderClip(makeRestSpec(45, { r: 10, noise: 2, shadow: false, base: 100 }));
  const t2 = none.truth.rest;
  assert.equal(detectTee(none.frames[0], { u: t2.u, v: t2.v, rx: t2.r, ry: t2.r }, { W: none.W, H: none.H }).present, false);
  // ball at the very bottom of the image: nothing to inspect
  const edge = detectTee(clip.frames[0], { u: 100, v: 214, rx: 10, ry: 10 }, { W: clip.W, H: clip.H });
  assert.equal(edge.present, false);
});

test('rest ball: dark ball on a light mat needs polarity auto/dark; empty mat gives null; typed array + dims accepted', () => {
  const spec = makeRestSpec(46, { r: 9, noise: 2, shadow: false, base: 170, ballLevel: 40 });
  const clip = renderClip(spec);
  const t = clip.truth.rest;
  const exp = { u: t.u + 1, v: t.v - 1, w_px: t.w_px };
  assert.equal(detectRestBall(clip.frames[0], null, exp, { W: clip.W, H: clip.H }), null, 'default polarity is bright');
  const dark = detectRestBall(clip.frames[0], null, exp, { W: clip.W, H: clip.H, polarity: 'auto' });
  assert.ok(dark);
  assert.equal(dark.polarity, 'dark');
  assert.ok(Math.hypot(dark.u - t.u, dark.v - t.v) < 0.3);
  assert.ok(Math.abs(dark.w_px - t.w_px) / t.w_px < 0.03);
  const empty = makeRestSpec(47, { r: 9, noise: 3, shadow: false });
  empty.ball.frames = [null];
  const c2 = renderClip(empty);
  assert.equal(detectRestBall({ data: c2.frames[0], W: c2.W, H: c2.H }, null, { u: 190, v: 100, w_px: 18 }), null);
  assert.throws(() => detectRestBall(clip.frames[0], null, exp), TypeError);
});

test('rest ball: honours the ROI and the search distance (a ball far from the expectation is not "found" elsewhere)', () => {
  const spec = makeRestSpec(48, { r: 9, noise: 2, shadow: false, u: 200, v: 100 });
  const clip = renderClip(spec);
  const gray = { data: clip.frames[0], W: clip.W, H: clip.H };
  const roi = { x: 150, y: 60, w: 100, h: 80 };
  const ok = detectRestBall(gray, roi, { u: 199, v: 101, w_px: 18 });
  assert.ok(ok && Math.hypot(ok.u - 200, ok.v - 100) < 0.3);
  assert.equal(detectRestBall(gray, { x: 0, y: 0, w: 100, h: 60 }, { u: 50, v: 30, w_px: 18 }), null);
  assert.equal(detectRestBall(gray, null, { u: 60, v: 170, w_px: 18 }), null, 'expectation 140 px away');
  // size ratio is reported for the +-6 % check of the caller
  const big = detectRestBall(gray, roi, { u: 200, v: 100, w_px: 15 });
  assert.ok(Math.abs(big.size_ratio - 18 / 15) < 0.05, `${big.size_ratio}`);
});
