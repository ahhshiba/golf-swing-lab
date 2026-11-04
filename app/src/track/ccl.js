// 8-connected component labelling with per-component statistics (pure, allocation-light).
//
// Works on a "diff" image: Float32Array / Float64Array / Uint8Array of non-negative values (for example
// |frame - background|), row-major W x H. A pixel is foreground when diff > tLo. Components are found with a
// run-length two-pointer scan plus union-find, so the cost is proportional to the number of foreground
// pixels (a typical 384x216 frame is under 1 ms).
//
// Statistics follow baseball-digital-twin-demo tools/monocular/mono/tracking.py detect_ball: weights are the
// diff values, the centroid is the weighted mean of pixel centres (pixel (i, j) has its centre at
// (i + 0.5, j + 0.5), interfaces.md section 2), the covariance is the weighted *population* covariance, and
// r_px = 2 * sqrt(lambda_min) (minor axis; motion blur stretches only the major axis). Components with
// area < 5 use r_px = sqrt(area / pi).

const FALLBACK_AREA = 5;

/** Normalise a ROI {x, y, w, h} (may be partly outside) to {x0, y0, x1, y1} with exclusive ends; idempotent. */
export function normRoi(roi, W, H) {
  if (!roi) return { x0: 0, y0: 0, x1: W, y1: H };
  if (roi.x0 !== undefined) return roi; // already normalised
  const x0 = Math.max(0, Math.floor(roi.x));
  const y0 = Math.max(0, Math.floor(roi.y));
  const x1 = Math.min(W, Math.ceil(roi.x + roi.w));
  const y1 = Math.min(H, Math.ceil(roi.y + roi.h));
  return { x0, y0, x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
}

// Module-level scratch (grown on demand; the module is single-threaded and non-reentrant by design).
let CAP = 2048;
let runY = new Int32Array(CAP);
let runX0 = new Int32Array(CAP);
let runX1 = new Int32Array(CAP);
let parent = new Int32Array(CAP);

function grow() {
  CAP *= 2;
  const cp = (a) => { const b = new Int32Array(CAP); b.set(a); return b; };
  runY = cp(runY); runX0 = cp(runX0); runX1 = cp(runX1); parent = cp(parent);
}

function find(i) {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
}

function union(a, b) {
  a = find(a); b = find(b);
  if (a === b) return;
  if (a < b) parent[b] = a; else parent[a] = b; // smaller index = earlier in scan order stays the root
}

/**
 * Label 8-connected components of {diff > tLo} inside `roi` and compute their statistics.
 * @param {Float32Array|Float64Array|Uint8Array} d  non-negative diff image, row-major W x H
 * @param {number} W @param {number} H
 * @param {{x:number,y:number,w:number,h:number}|null} roi  null = whole image
 * @param {{tLo?:number, tHi?:number, minArea?:number, maxArea?:number}} opts
 *   tLo = membership threshold (default 20), tHi = a component is kept only if its peak >= tHi (default tLo,
 *   i.e. hysteresis when larger), minArea / maxArea in pixels (defaults 1 / Infinity).
 * @returns {Array<object>} components in scan order of their first run:
 *   { label, area, sum, u, v, cxx, cxy, cyy, major_sd, minor_sd, angle, elong, r_px,
 *     bbox:{x0,y0,x1,y1} (x1, y1 exclusive), bw, bh, peak }
 *   u, v = diff-weighted centroid; cxx.. = weighted population covariance; major_sd / minor_sd = sqrt of the
 *   covariance eigenvalues; angle = direction of the major axis in radians (image axes, v down);
 *   elong = major_sd / minor_sd; bw, bh = bbox size in pixels.
 */
export function findComponents(d, W, H, roi, opts = {}) {
  const tLo = opts.tLo ?? 20;
  const tHi = opts.tHi ?? tLo;
  const minArea = opts.minArea ?? 1;
  const maxArea = opts.maxArea ?? Infinity;
  const { x0, y0, x1, y1 } = normRoi(roi, W, H);

  let nRuns = 0;
  let prevFirst = 0;
  let prevLast = 0; // runs of the previous row are [prevFirst, prevLast)
  for (let y = y0; y < y1; y++) {
    const off = y * W;
    const curFirst = nRuns;
    let jStart = prevFirst;
    let x = x0;
    while (x < x1) {
      if (!(d[off + x] > tLo)) { x++; continue; }
      const s = x;
      x++;
      while (x < x1 && d[off + x] > tLo) x++;
      if (nRuns >= CAP) grow();
      const id = nRuns++;
      runY[id] = y; runX0[id] = s; runX1[id] = x; parent[id] = id;
      // previous-row runs [a, b) touch [s, x) in 8-connectivity iff b >= s and a <= x
      while (jStart < prevLast && runX1[jStart] < s) jStart++;
      for (let j = jStart; j < prevLast && runX0[j] <= x; j++) union(id, j);
    }
    prevFirst = curFirst;
    prevLast = nRuns;
  }
  if (nRuns === 0) return [];

  // accumulate statistics per root
  const area = new Int32Array(nRuns);
  const sw = new Float64Array(nRuns);
  const sx = new Float64Array(nRuns);
  const sy = new Float64Array(nRuns);
  const sxx = new Float64Array(nRuns);
  const sxy = new Float64Array(nRuns);
  const syy = new Float64Array(nRuns);
  const peak = new Float64Array(nRuns);
  const bx0 = new Int32Array(nRuns).fill(1 << 30);
  const by0 = new Int32Array(nRuns).fill(1 << 30);
  const bx1 = new Int32Array(nRuns).fill(-1);
  const by1 = new Int32Array(nRuns).fill(-1);
  for (let id = 0; id < nRuns; id++) {
    const r = find(id);
    const y = runY[id];
    const off = y * W;
    const yc = y + 0.5;
    const s = runX0[id];
    const e = runX1[id];
    let a = 0, w0 = 0, w1x = 0, w2x = 0, pk = 0;
    for (let x = s; x < e; x++) {
      const w = d[off + x];
      const xc = x + 0.5;
      a++; w0 += w; w1x += w * xc; w2x += w * xc * xc;
      if (w > pk) pk = w;
    }
    area[r] += a;
    sw[r] += w0;
    sx[r] += w1x;
    sy[r] += w0 * yc;
    sxx[r] += w2x;
    sxy[r] += w1x * yc;
    syy[r] += w0 * yc * yc;
    if (pk > peak[r]) peak[r] = pk;
    if (s < bx0[r]) bx0[r] = s;
    if (e > bx1[r]) bx1[r] = e;
    if (y < by0[r]) by0[r] = y;
    if (y + 1 > by1[r]) by1[r] = y + 1;
  }

  const out = [];
  for (let id = 0; id < nRuns; id++) {
    if (parent[id] !== id) continue; // not a root
    const a = area[id];
    if (a < minArea || a > maxArea || peak[id] < tHi) continue;
    const W0 = sw[id];
    const u = sx[id] / W0;
    const v = sy[id] / W0;
    const cxx = Math.max(0, sxx[id] / W0 - u * u);
    const cxy = sxy[id] / W0 - u * v;
    const cyy = Math.max(0, syy[id] / W0 - v * v);
    const half = 0.5 * (cxx + cyy);
    const disc = Math.sqrt(Math.max(0, 0.25 * (cxx - cyy) * (cxx - cyy) + cxy * cxy));
    const lmax = half + disc;
    const lmin = Math.max(0, half - disc);
    const major_sd = Math.sqrt(lmax);
    const minor_sd = Math.sqrt(lmin);
    const r_px = a >= FALLBACK_AREA && lmin > 0 ? 2 * minor_sd : Math.sqrt(a / Math.PI);
    out.push({
      label: out.length + 1,
      area: a,
      sum: W0,
      u,
      v,
      cxx,
      cxy,
      cyy,
      major_sd,
      minor_sd,
      angle: 0.5 * Math.atan2(2 * cxy, cxx - cyy),
      elong: minor_sd > 1e-9 ? major_sd / minor_sd : Infinity,
      r_px,
      bbox: { x0: bx0[id], y0: by0[id], x1: bx1[id], y1: by1[id] },
      bw: bx1[id] - bx0[id],
      bh: by1[id] - by0[id],
      peak: peak[id],
    });
  }
  return out;
}
