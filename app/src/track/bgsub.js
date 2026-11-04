// Background models and background subtraction for the track module (pure; no DOM, no randomness).
//
// Frames are grayscale Uint8Array, row-major W x H. A "Gray" image is { data, W, H }; per-frame functions
// accept either a Gray or a bare typed array together with opts.W / opts.H.
//
//   medianBackground(frames, W, H, maxSamples = 60, opts?) -> Float32Array(W*H)
//       per-pixel temporal median over up to maxSamples evenly spaced frames (numpy median semantics: even sample
//       counts average the two middle values; sample indices = trunc(linspace(0, n-1, m)), as tracking.py).
//       opts.roi {x,y,w,h}: only compute inside (the rest stays 0).
//       opts.region {x,y,w,h} + opts.regionFrames number[]: inside the region only those frame indices are used
//       (the resting ball is present in the early frames and must not leak into the background).
//   RunningBackground: exponential running average for live mode (selective: foreground pixels adapt slowly).
//   diffFrame(frame, bg, W, H, roi, out, opts) -> { gain, offset, sigma }
//       out[p] = |frame[p] - (gain * bg[p] + offset)| inside roi. gain / offset are a robust per-frame fit
//       (global brightness flicker); sigma = robust noise estimate (1.4826 * MAD of the fit residual).

import { normRoi } from './ccl.js';

/** Wrap a bare typed array as a Gray image. */
export function asGray(frame, opts = {}) {
  if (frame && frame.data && frame.W > 0) return frame;
  if (opts.W > 0 && opts.H > 0 && frame && frame.length >= opts.W * opts.H) return { data: frame, W: opts.W, H: opts.H };
  throw new TypeError('track: frame must be {data,W,H} or a typed array with opts.W/opts.H');
}

/** trunc(linspace(0, n-1, m)) as used by tracking.py median_background. */
export function sampleIndices(n, m) {
  const k = Math.min(n, m);
  const out = new Array(k);
  if (k === 1) { out[0] = 0; return out; }
  for (let i = 0; i < k; i++) out[i] = Math.floor((i * (n - 1)) / (k - 1) + 1e-9);
  return out;
}

// Quickselect on a small Uint8Array scratch: afterwards a[k] is the k-th smallest and a[0..k) <= a[k].
function selectK(a, n, k) {
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return a[k];
}

function medianOf(a, n) {
  const k = n >> 1;
  const hiV = selectK(a, n, k);
  if (n & 1) return hiV;
  let loV = 0;
  for (let i = 0; i < k; i++) if (a[i] > loV) loV = a[i];
  return 0.5 * (hiV + loV);
}

function fillMedian(out, arrs, W, rect, scratch) {
  const m = arrs.length;
  for (let y = rect.y0; y < rect.y1; y++) {
    const off = y * W;
    for (let x = rect.x0; x < rect.x1; x++) {
      const p = off + x;
      for (let i = 0; i < m; i++) scratch[i] = arrs[i][p];
      out[p] = medianOf(scratch, m);
    }
  }
}

export function medianBackground(frames, W, H, maxSamples = 60, opts = {}) {
  const n = frames.length;
  if (n === 0) throw new RangeError('medianBackground: no frames');
  const out = new Float32Array(W * H);
  const rect = normRoi(opts.roi ?? null, W, H);
  const idx = sampleIndices(n, maxSamples);
  const scratch = new Uint8Array(Math.max(idx.length, 1));
  fillMedian(out, idx.map((i) => frames[i]), W, rect, scratch);
  if (opts.region && opts.regionFrames && opts.regionFrames.length > 0) {
    const rr = normRoi(opts.region, W, H);
    const sub = {
      x0: Math.max(rr.x0, rect.x0), y0: Math.max(rr.y0, rect.y0),
      x1: Math.min(rr.x1, rect.x1), y1: Math.min(rr.y1, rect.y1),
    };
    if (sub.x1 > sub.x0 && sub.y1 > sub.y0) {
      const sel = sampleIndices(opts.regionFrames.length, maxSamples).map((i) => opts.regionFrames[i]);
      fillMedian(out, sel.map((i) => frames[i]), W, sub, new Uint8Array(sel.length));
    }
  }
  return out;
}

/**
 * Exponential running-average background for live mode. The first `warmup` frames use a 1/(k+1) average; later
 * frames use alpha, except for pixels that differ from the model by more than fgThresh, which adapt with alphaFg
 * (so a passing ball or club does not smear into the model). A ball that sits still is absorbed after about
 * 1/alpha frames, and when it then leaves, its old position shows up as a static ghost: live-mode callers must
 * treat detections that stay put as ghosts (trackBall's rest-phase rule does).
 */
export class RunningBackground {
  constructor(W, H, { alpha = 0.04, alphaFg = 0.002, fgThresh = 25, warmup = 6 } = {}) {
    this.W = W;
    this.H = H;
    this.alpha = alpha;
    this.alphaFg = alphaFg;
    this.fgThresh = fgThresh;
    this.warmup = warmup;
    this.n = 0;
    this.bg = new Float32Array(W * H);
  }

  update(frame) {
    const bg = this.bg;
    const N = this.W * this.H;
    if (this.n === 0) {
      for (let p = 0; p < N; p++) bg[p] = frame[p];
    } else {
      const aWarm = 1 / (this.n + 1);
      const warm = this.n < this.warmup;
      const a = this.alpha;
      const af = this.alphaFg;
      const th = this.fgThresh;
      for (let p = 0; p < N; p++) {
        const dv = frame[p] - bg[p];
        const ad = dv < 0 ? -dv : dv;
        bg[p] += (warm ? aWarm : ad > th ? af : a) * dv;
      }
    }
    this.n++;
    return bg;
  }
}

let SAMPLE_X = new Float32Array(4096);
let SAMPLE_Y = new Float32Array(4096);
const RES_BINS = new Uint32Array(512);

function robustFit(n, wantGain) {
  // least squares y = a x + b, then one trimmed refit at 3.5 sigma
  let a = 1;
  let b = 0;
  let sigma = 0;
  for (let pass = 0; pass < 2; pass++) {
    let cnt = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
      if (pass === 1) {
        const r = SAMPLE_Y[i] - (a * SAMPLE_X[i] + b);
        if ((r < 0 ? -r : r) > 3.5 * sigma) continue;
      }
      const x = SAMPLE_X[i], y = SAMPLE_Y[i];
      cnt++; sx += x; sy += y; sxx += x * x; sxy += x * y;
    }
    if (cnt < 8) break;
    const mx = sx / cnt, my = sy / cnt;
    const vx = sxx / cnt - mx * mx;
    if (wantGain && vx > 25) {
      a = (sxy / cnt - mx * my) / vx;
      if (!(a > 0.5 && a < 2)) a = 1;
      b = my - a * mx;
    } else {
      a = 1;
      b = my - mx;
    }
    // robust sigma of the residual from a 0.25-DN histogram
    RES_BINS.fill(0);
    for (let i = 0; i < n; i++) {
      const r = SAMPLE_Y[i] - (a * SAMPLE_X[i] + b);
      const bi = Math.min(511, Math.floor((r < 0 ? -r : r) * 4));
      RES_BINS[bi]++;
    }
    let acc = 0, bi = 0;
    while (bi < 511 && acc + RES_BINS[bi] < n / 2) { acc += RES_BINS[bi]; bi++; }
    const med = (bi + 0.5) / 4;
    sigma = Math.max(0.3, 1.4826 * med);
  }
  return { gain: a, offset: b, sigma };
}

/**
 * Background difference with per-frame gain / offset compensation (global brightness flicker).
 * out (Float32Array, W*H) receives |frame - (gain*bg + offset)| for pixels inside roi (polarity 'both'), or
 * max(frame - model, 0) for 'bright' / max(model - frame, 0) for 'dark'. Pixels outside the roi are not touched.
 * opts: { polarity = 'both', compensate = true, sampleStep }.
 */
export function diffFrame(frame, bg, W, H, roi, out, opts = {}) {
  const r = roi && roi.x0 !== undefined ? roi : normRoi(roi, W, H);
  const rw = r.x1 - r.x0;
  const rh = r.y1 - r.y0;
  const step = opts.sampleStep ?? Math.max(1, Math.floor(Math.sqrt((rw * rh) / 2500)));
  const need = (Math.ceil(rw / step) + 1) * (Math.ceil(rh / step) + 1);
  if (need > SAMPLE_X.length) { SAMPLE_X = new Float32Array(need); SAMPLE_Y = new Float32Array(need); }
  let n = 0;
  for (let y = r.y0; y < r.y1; y += step) {
    const off = y * W;
    for (let x = r.x0; x < r.x1; x += step) {
      SAMPLE_X[n] = bg[off + x];
      SAMPLE_Y[n] = frame[off + x];
      n++;
    }
  }
  const fit = robustFit(n, opts.compensate !== false);
  const g = fit.gain;
  const o = fit.offset;
  const pol = opts.polarity ?? 'both';
  for (let y = r.y0; y < r.y1; y++) {
    const off = y * W;
    if (pol === 'both') {
      for (let p = off + r.x0, e = off + r.x1; p < e; p++) {
        const dv = frame[p] - (g * bg[p] + o);
        out[p] = dv < 0 ? -dv : dv;
      }
    } else if (pol === 'bright') {
      for (let p = off + r.x0, e = off + r.x1; p < e; p++) {
        const dv = frame[p] - (g * bg[p] + o);
        out[p] = dv > 0 ? dv : 0;
      }
    } else {
      for (let p = off + r.x0, e = off + r.x1; p < e; p++) {
        const dv = g * bg[p] + o - frame[p];
        out[p] = dv > 0 ? dv : 0;
      }
    }
  }
  return fit;
}
