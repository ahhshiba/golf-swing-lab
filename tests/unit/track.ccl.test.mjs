import test from 'node:test';
import assert from 'node:assert/strict';
import { findComponents, normRoi } from '../../app/src/track/ccl.js';

// helper: build a W x H diff image from [x, y, w] triples
function img(W, H, pts) {
  const d = new Float32Array(W * H);
  for (const [x, y, w] of pts) d[y * W + x] = w;
  return d;
}
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('ccl: weighted centroid / covariance / minor axis match a hand computation (2x2 weights 10,20 / 30,40)', () => {
  // pixels (2,1)=10 (3,1)=20 (2,2)=30 (3,2)=40 ; centres at +0.5
  const d = img(8, 6, [[2, 1, 10], [3, 1, 20], [2, 2, 30], [3, 2, 40]]);
  const [c] = findComponents(d, 8, 6, null, { tLo: 5 });
  assert.equal(c.area, 4);
  near(c.sum, 100);
  near(c.u, 3.1);          // (2.5*40 + 3.5*60) / 100
  near(c.v, 2.2);          // (1.5*30 + 2.5*70) / 100
  near(c.cxx, 0.24);       // 9.85 - 3.1^2
  near(c.cyy, 0.21);       // 5.05 - 2.2^2
  near(c.cxy, -0.02);      // 6.80 - 3.1*2.2
  near(c.major_sd, Math.sqrt(0.25), 1e-12); // lambda = 0.225 +- sqrt(0.015^2 + 0.02^2) = 0.225 +- 0.025
  near(c.minor_sd, Math.sqrt(0.2), 1e-12);
  near(c.peak, 40);
  assert.deepEqual(c.bbox, { x0: 2, y0: 1, x1: 4, y1: 3 });
  // area < 5 -> r_px falls back to sqrt(area / pi)
  near(c.r_px, Math.sqrt(4 / Math.PI), 1e-12);
});

test('ccl: uniform 5x5 block gives r_px = 2*sqrt(2) (minor axis, tracking.py rule); a 7x3 block gives sd 2 and sqrt(2/3)', () => {
  const sq = [];
  for (let y = 3; y < 8; y++) for (let x = 4; x < 9; x++) sq.push([x, y, 7]);
  const [a] = findComponents(img(16, 12, sq), 16, 12, null, { tLo: 1 });
  assert.equal(a.area, 25);
  near(a.u, 6.5); near(a.v, 5.5);
  near(a.cxx, 2); near(a.cyy, 2); near(a.cxy, 0, 1e-12);
  near(a.r_px, 2 * Math.SQRT2, 1e-12);
  near(a.elong, 1, 1e-9);

  const rect = [];
  for (let y = 2; y < 5; y++) for (let x = 3; x < 10; x++) rect.push([x, y, 5]);
  const [b] = findComponents(img(16, 12, rect), 16, 12, null, { tLo: 1 });
  assert.equal(b.area, 21);
  near(b.cxx, 4);                 // (7^2 - 1) / 12
  near(b.cyy, 2 / 3);             // (3^2 - 1) / 12
  near(b.major_sd, 2); near(b.minor_sd, Math.sqrt(2 / 3));
  near(b.r_px, 2 * Math.sqrt(2 / 3), 1e-12);
  near(b.elong, 2 / Math.sqrt(2 / 3), 1e-12);
  near(Math.abs(b.angle), 0, 1e-12); // major axis along image x
  assert.equal(b.bw, 7); assert.equal(b.bh, 3);
});

test('ccl: tilted 45 degree line has angle +-pi/4 and image axes are not mixed up', () => {
  const pts = [];
  for (let k = 0; k < 8; k++) pts.push([2 + k, 2 + k, 10]); // down-right diagonal (v grows with u)
  const [c] = findComponents(img(16, 16, pts), 16, 16, null, { tLo: 1 });
  near(c.angle, Math.PI / 4, 1e-9);
  const pts2 = [];
  for (let k = 0; k < 8; k++) pts2.push([2 + k, 9 - k, 10]); // up-right diagonal
  const [e] = findComponents(img(16, 16, pts2), 16, 16, null, { tLo: 1 });
  near(e.angle, -Math.PI / 4, 1e-9);
});

test('ccl: 8-connectivity links diagonal neighbours, a gap of one pixel separates; U shape merges through union-find', () => {
  const diag = img(8, 8, [[1, 1, 9], [2, 2, 9], [3, 3, 9]]);
  assert.equal(findComponents(diag, 8, 8, null, { tLo: 1 }).length, 1);
  const gap = img(8, 8, [[1, 1, 9], [3, 1, 9]]);
  assert.equal(findComponents(gap, 8, 8, null, { tLo: 1 }).length, 2);
  const gap2 = img(8, 8, [[1, 1, 9], [3, 3, 9]]);
  assert.equal(findComponents(gap2, 8, 8, null, { tLo: 1 }).length, 2);
  // U: two separate arms in row 0 joined only by row 2
  const U = img(8, 4, [[1, 0, 5], [1, 1, 5], [5, 0, 5], [5, 1, 5], [1, 2, 5], [2, 2, 5], [3, 2, 5], [4, 2, 5], [5, 2, 5]]);
  const r = findComponents(U, 8, 4, null, { tLo: 1 });
  assert.equal(r.length, 1);
  assert.equal(r[0].area, 9);
});

test('ccl: thresholds (tLo membership, tHi hysteresis peak), area limits, ROI clipping, empty image', () => {
  const d = new Float32Array(20 * 10);
  // blob A: peak 30 (kept at tHi=25); blob B: peak 18 (dropped at tHi=25, kept at tHi=15); tail pixels above tLo=10 extend A
  for (let x = 2; x < 6; x++) for (let y = 2; y < 5; y++) d[y * 20 + x] = 12;
  d[3 * 20 + 3] = 30;
  for (let x = 12; x < 15; x++) for (let y = 6; y < 9; y++) d[y * 20 + x] = 18;
  const all = findComponents(d, 20, 10, null, { tLo: 10, tHi: 25 });
  assert.equal(all.length, 1);
  assert.equal(all[0].area, 12);           // the 12-valued shoulder is part of A thanks to tLo = 10
  const both = findComponents(d, 20, 10, null, { tLo: 10, tHi: 15 });
  assert.equal(both.length, 2);
  assert.equal(findComponents(d, 20, 10, null, { tLo: 10, minArea: 10 }).length, 1);
  assert.equal(findComponents(d, 20, 10, null, { tLo: 10, maxArea: 10 }).length, 1);
  // ROI: x in [10, 20) sees only blob B, and coordinates stay in image frame
  const roi = findComponents(d, 20, 10, { x: 10, y: 0, w: 10, h: 10 }, { tLo: 10 });
  assert.equal(roi.length, 1);
  near(roi[0].u, 13.5); near(roi[0].v, 7.5);
  // a blob cut by the ROI border only counts the pixels inside
  const cut = findComponents(d, 20, 10, { x: 4, y: 0, w: 4, h: 10 }, { tLo: 10 });
  assert.equal(cut[0].area, 2 * 3);
  assert.deepEqual(findComponents(new Float32Array(100), 10, 10, null, { tLo: 1 }), []);
  assert.deepEqual(normRoi({ x: -5, y: 2, w: 100, h: 4 }, 20, 10), { x0: 0, y0: 2, x1: 20, y1: 6 });
  const n1 = normRoi({ x: 1, y: 1, w: 3, h: 3 }, 20, 10);
  assert.equal(normRoi(n1, 20, 10), n1, 'normRoi is idempotent');
});

test('ccl: components come out in scan order and labels are 1..n; Uint8 and Float64 diffs work', () => {
  const d8 = new Uint8Array(10 * 10);
  d8[1 * 10 + 8] = 50; d8[5 * 10 + 1] = 60; d8[5 * 10 + 2] = 60;
  const r = findComponents(d8, 10, 10, null, { tLo: 10 });
  assert.deepEqual(r.map((c) => c.label), [1, 2]);
  assert.ok(r[0].v < r[1].v);
  const d64 = Float64Array.from(d8);
  assert.equal(findComponents(d64, 10, 10, null, { tLo: 10 }).length, 2);
});

test('ccl: stress - many random blobs, union-find results equal a brute-force flood fill', async () => {
  const { mulberry32 } = await import('../../app/src/geom/rng.js');
  const rng = mulberry32(12345);
  const W = 64, H = 48;
  const d = new Float32Array(W * H);
  for (let i = 0; i < d.length; i++) d[i] = rng() < 0.28 ? 10 + Math.floor(rng() * 90) : 0;
  const got = findComponents(d, W, H, null, { tLo: 5 });
  // brute force
  const seen = new Uint8Array(W * H);
  const ref = [];
  for (let s = 0; s < d.length; s++) {
    if (seen[s] || !(d[s] > 5)) continue;
    const stack = [s]; seen[s] = 1;
    let area = 0, sw = 0, sx = 0, sy = 0;
    while (stack.length) {
      const p = stack.pop(); const x = p % W, y = (p / W) | 0;
      area++; sw += d[p]; sx += d[p] * (x + 0.5); sy += d[p] * (y + 0.5);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (!seen[q] && d[q] > 5) { seen[q] = 1; stack.push(q); }
      }
    }
    ref.push({ area, u: sx / sw, v: sy / sw });
  }
  assert.equal(got.length, ref.length);
  const key = (c) => `${c.area}:${c.u.toFixed(6)}:${c.v.toFixed(6)}`;
  assert.deepEqual(got.map(key).sort(), ref.map(key).sort());
});
