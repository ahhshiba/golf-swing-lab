import test from 'node:test';
import assert from 'node:assert/strict';
import { matCorners, DEFAULT_VENUE, refineCorners, fitLineTLS, intersectLines, sampleBilinear } from '../../app/src/calib/mat.js';
import { mulberry32, gauss } from '../../app/src/geom/rng.js';
import { synthMatScene, renderMatImage } from '../synth/mat.js';

test('matCorners: [tn, ln, lf, tf] in M with the ball spot at the origin (interfaces.md §2)', () => {
  const c = matCorners({ mat_L: 1.5, mat_W: 1.25, ball_edge_m: 0.3, ball_x_m: 0 });
  assert.deepEqual(c, [[-0.75, -0.3, 0], [0.75, -0.3, 0], [0.75, 0.95, 0], [-0.75, 0.95, 0]]);
  const d = matCorners({ mat_L: 1.6, mat_W: 1.2, ball_edge_m: 0.25, ball_x_m: 0.1 });
  assert.deepEqual(d.map((p) => p.map((x) => +x.toFixed(12))), [[-0.9, -0.25, 0], [0.7, -0.25, 0], [0.7, 0.95, 0], [-0.9, 0.95, 0]]);
  assert.deepEqual(matCorners(), matCorners(DEFAULT_VENUE));
  assert.throws(() => matCorners({ mat_L: 0, mat_W: 1 }), RangeError);
});

test('sampleBilinear uses pixel centres at +0.5', () => {
  const img = { data: Float64Array.from([0, 10, 20, 30]), W: 2, H: 2 };
  assert.equal(sampleBilinear(img, 0.5, 0.5), 0);
  assert.equal(sampleBilinear(img, 1.5, 0.5), 10);
  assert.equal(sampleBilinear(img, 1.0, 1.0), 15);
  assert.equal(sampleBilinear(img, 1.5, 1.5), 30);
});

test('fitLineTLS and intersectLines', () => {
  const pts = [[0, 1], [1, 3], [2, 5], [3, 7]]; // v = 2u + 1
  const L = fitLineTLS(pts);
  for (const p of pts) assert.ok(Math.abs(L.n[0] * p[0] + L.n[1] * p[1] + L.c) < 1e-12);
  const M = fitLineTLS([[0, 4], [4, 0]]);
  const X = intersectLines(L, M);
  assert.ok(Math.abs(X[0] - 1) < 1e-12 && Math.abs(X[1] - 3) < 1e-12);
  assert.equal(intersectLines(L, fitLineTLS([[0, 0], [1, 2]])), null);
});

for (const view of ['face_on', 'dtl', 'high_behind']) {
  test(`refineCorners recovers rendered ${view} corners within 0.5 px RMS from 4 px-off guesses`, () => {
    const rng = mulberry32(view.length * 101 + 7);
    const sc = synthMatScene({ view, rng, sigmaPx: 0 });
    const img = renderMatImage(sc.cam, sc.venue, rng);
    const approx = sc.cornersTrue.map(([u, v]) => [u + gauss(rng, 0, 4), v + gauss(rng, 0, 4)]);
    const r = refineCorners(img, approx);
    assert.ok(r.ok, JSON.stringify(r.sides));
    const e2 = r.corners.map((c, i) => (c[0] - sc.cornersTrue[i][0]) ** 2 + (c[1] - sc.cornersTrue[i][1]) ** 2);
    const rms = Math.sqrt(e2.reduce((a, b) => a + b, 0) / 4);
    assert.ok(rms <= 0.5, `rms ${rms}`);
    assert.ok(r.max_edge_residual_px <= 1.5, `edge residual ${r.max_edge_residual_px}`);
    assert.equal(r.edge_residual_px.length, 4);
    for (const s of r.sides) assert.equal(s.polarity, 'bright_inside');
  });
}

test('refineCorners: dark mat on bright floor (auto polarity) and a featureless image', () => {
  const rng = mulberry32(99);
  const sc = synthMatScene({ view: 'face_on', rng, sigmaPx: 0 });
  const img = renderMatImage(sc.cam, sc.venue, rng, { mat_level: 60, floor_level: 160 });
  const approx = sc.cornersTrue.map(([u, v]) => [u + 3, v - 2]);
  const r = refineCorners(img, approx);
  assert.ok(r.ok);
  for (const s of r.sides) assert.equal(s.polarity, 'dark_inside');
  const err = Math.max(...r.corners.map((c, i) => Math.hypot(c[0] - sc.cornersTrue[i][0], c[1] - sc.cornersTrue[i][1])));
  assert.ok(err < 0.5, `max err ${err}`);
  const flat = { data: new Uint8ClampedArray(sc.cam.W * sc.cam.H).fill(100), W: sc.cam.W, H: sc.cam.H };
  const f = refineCorners(flat, approx);
  assert.equal(f.ok, false);
  assert.equal(f.corners, null);
});

test('refineCorners: a mat side that is not straight shows up in the edge residual', () => {
  const rng = mulberry32(5);
  const sc = synthMatScene({ view: 'face_on', rng, sigmaPx: 0 });
  const img = renderMatImage(sc.cam, sc.venue, rng);
  // Bend the near (tn→ln) edge: shift a block of rows below its middle third downward by 3 px.
  const [a, b] = [sc.cornersTrue[0], sc.cornersTrue[1]];
  const u0 = Math.round(a[0] + (b[0] - a[0]) / 3);
  const u1 = Math.round(a[0] + (2 * (b[0] - a[0])) / 3);
  const vEdge = Math.round((a[1] + b[1]) / 2);
  const bent = Uint8ClampedArray.from(img.data);
  for (let i = u0; i < u1; i++) {
    for (let j = vEdge + 20; j >= vEdge - 20; j--) bent[j * img.W + i] = img.data[(j - 3) * img.W + i];
  }
  const r = refineCorners({ data: bent, W: img.W, H: img.H }, sc.cornersTrue);
  const ok = refineCorners(img, sc.cornersTrue);
  assert.ok(r.edge_residual_px[0] > 3 * ok.edge_residual_px[0], `${r.edge_residual_px[0]} vs ${ok.edge_residual_px[0]}`);
  assert.ok(r.edge_residual_px[0] > 0.5);
});
