// Ball detection and tracking in 240 fps grayscale frames (classical, CPU-only, explainable).
//
// API (frames: Gray {data,W,H} or typed array + opts.W/opts.H; ROI = {x,y,w,h} in frame pixels; all u, v are
// continuous image coordinates, pixel (i,j) centre = (i+0.5, j+0.5), interfaces.md section 2):
//
//   detectRestBall(frame, roi, expected{u,v,w_px}, opts?) -> {u,v,w_px,h_px,r_px,lie,conf,lie_conf,tee,...} | null
//       Locates the resting ball in ONE frame (no background needed; average several address frames first to cut
//       noise). Method: local Otsu threshold -> blob nearest the expected position -> chord profile for an initial
//       ellipse -> Levenberg-Marquardt fit of an anti-aliased uniform ellipse (cx, cy, rx, ry, level, background,
//       background gradient, edge width) to the pixels around it. w_px = 2 rx (horizontal diameter, what the
//       calibration check compares with the pose prediction), h_px = 2 ry, r_px = (rx + ry) / 2.
//   detectTee(frame, ball, opts?) -> {present, conf, length_px, width_px, contrast, x_px}
//       Lie heuristic, see the block comment above detectTee for the method and its limits.
//   detectCandidates(frame, bg, roi, opts?) -> Candidate[]
//       background subtraction (gain/offset compensated) + hysteresis threshold + 8-connected components.
//       Candidate = {u,v,w_px,h_px,r_px,area,peak,sum,elong,angle,major_px,minor_px,bbox}.
//   findDeparture(frames, W, H, rest, opts?) -> {ok, lastRest, departure, ...}
//       first frame in which the resting ball is gone (pixel-level, independent of detections).
//   trackBall(detsPerFrame, times, opts) -> {obs, gaps, n, info}
//       greedy constant-velocity linking seeded at the rest ball (port of tracking.py track_ball with a direction
//       prior, a rest-phase rule and a back-projection check against the rest position).

import { lm } from '../geom/lm.js';
import { solve } from '../geom/linalg.js';
import { findComponents, normRoi } from './ccl.js';
import { asGray, diffFrame } from './bgsub.js';

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

// ------------------------------------------------------------------------------------------------ candidates

let DIFF_BUF = new Float32Array(0);
function diffBuffer(n) {
  if (DIFF_BUF.length < n) DIFF_BUF = new Float32Array(n);
  return DIFF_BUF;
}

/** Convert a ccl component to the public Candidate shape (see header). */
export function toCandidate(c) {
  const wsd = Math.sqrt(c.cxx);
  const hsd = Math.sqrt(c.cyy);
  // w_px / h_px = 4 sigma of the diff-weighted second moments (= the diameter of a uniform disc); tiny blobs use
  // the bbox. r_px = minor-axis radius (tracking.py).
  return {
    u: c.u,
    v: c.v,
    w_px: c.area >= 5 ? 4 * wsd : c.bw,
    h_px: c.area >= 5 ? 4 * hsd : c.bh,
    r_px: c.r_px,
    area: c.area,
    peak: c.peak,
    sum: c.sum,
    elong: c.elong,
    angle: c.angle,
    major_px: 2 * c.major_sd,
    minor_px: 2 * c.minor_sd,
    bbox: c.bbox,
  };
}

/**
 * Background-subtraction candidates for one frame.
 * opts: { W, H (bare arrays), polarity = 'both', compensate = true, tLoK = 3.5, tLoMin = 10, tHiK = 5.5, tHiMin = 16,
 *         minArea = 5, maxArea = 2500, stats (object that receives {gain, offset, sigma, tLo, tHi}) }
 * Membership threshold tLo = max(tLoMin, tLoK*sigma); a component must also reach tHi = max(tHiMin, tHiK*sigma)
 * (hysteresis: faint blur tails are kept, isolated noise pixels are not). sigma is the robust per-frame noise.
 */
export function detectCandidates(frame, bg, roi, opts = {}) {
  const g = asGray(frame, opts);
  const { data, W, H } = g;
  const r = normRoi(roi, W, H);
  const buf = diffBuffer(W * H);
  const fit = diffFrame(data, bg, W, H, r, buf, opts);
  const tLo = Math.max(opts.tLoMin ?? 10, (opts.tLoK ?? 3.5) * fit.sigma);
  const tHi = Math.max(opts.tHiMin ?? 16, (opts.tHiK ?? 5.5) * fit.sigma);
  if (opts.stats) Object.assign(opts.stats, { gain: fit.gain, offset: fit.offset, sigma: fit.sigma, tLo, tHi });
  const comps = findComponents(buf, W, H, r, { tLo, tHi, minArea: opts.minArea ?? 5, maxArea: opts.maxArea ?? 2500 });
  return comps.map(toCandidate);
}

// ------------------------------------------------------------------------------------------------ rest ball

function histMedianAndOtsu(s, n) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[clamp(Math.round(s[i]), 0, 255)]++;
  let acc = 0;
  let med = 0;
  while (med < 255 && acc + hist[med] < n / 2) { acc += hist[med]; med++; }
  let sumAll = 0;
  for (let k = 0; k < 256; k++) sumAll += k * hist[k];
  let wB = 0, sumB = 0, bestVar = -1, bestT = 0;
  for (let t = 0; t < 255; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > bestVar) { bestVar = v; bestT = t; }
  }
  return { median: med, otsu: bestT + 0.5 };
}

function medianOfList(a) {
  if (a.length === 0) return NaN;
  const b = Float64Array.from(a).sort();
  const m = b.length >> 1;
  return b.length & 1 ? b[m] : 0.5 * (b[m - 1] + b[m]);
}

// Longest run of (dwin > tLo) inside the component bbox for every bbox row.
function chordProfile(dwin, ww, bb, tLo) {
  const rows = bb.y1 - bb.y0;
  const wd = new Float64Array(rows);
  const mid = new Float64Array(rows);
  for (let j = 0; j < rows; j++) {
    const off = (bb.y0 + j) * ww;
    let best = 0, bestMid = 0, x = bb.x0;
    while (x < bb.x1) {
      if (!(dwin[off + x] > tLo)) { x++; continue; }
      const s = x;
      while (x < bb.x1 && dwin[off + x] > tLo) x++;
      if (x - s > best) { best = x - s; bestMid = 0.5 * (s + x); }
    }
    wd[j] = best;
    mid[j] = bestMid;
  }
  return { wd, mid };
}

// Anti-aliased uniform-ellipse model fit (see header). theta = [cx, cy, rx, ry, L, B, gx, gy, e].
export function fitEllipseDisk(xs, ys, vals, init) {
  const n = xs.length;
  const residual = (th) => {
    const res = new Float64Array(n); // lm keeps references to returned arrays: never reuse a buffer
    const cx = th[0], cy = th[1];
    const rx = Math.max(th[2], 0.8), ry = Math.max(th[3], 0.8);
    const L = th[4], B = th[5], gx = th[6], gy = th[7];
    const e = clamp(th[8], 0.5, 4);
    const irx2 = 1 / (rx * rx), iry2 = 1 / (ry * ry);
    for (let k = 0; k < n; k++) {
      const dx = xs[k] - cx, dy = ys[k] - cy;
      const rho = Math.sqrt(dx * dx * irx2 + dy * dy * iry2);
      let cov = 1;
      if (rho >= 0.2) {
        const gn = Math.sqrt(dx * dx * irx2 * irx2 + dy * dy * iry2 * iry2) / rho;
        const sd = (rho - 1) / gn;
        const t = clamp(0.5 - sd / e, 0, 1);
        cov = t * t * (3 - 2 * t);
      }
      res[k] = B + gx * dx + gy * dy + (L - B) * cov - vals[k];
    }
    return res;
  };
  return lm({
    residual,
    theta0: init,
    step: [0.02, 0.02, 0.02, 0.02, 0.2, 0.2, 0.002, 0.002, 0.02],
    maxIter: 40,
    tol: 1e-9,
    gtol: 1e-8,
  });
}

/**
 * Lie heuristic: does a thin, contrasting vertical structure (a tee) stand directly under the ball?
 *
 * Method (column profile):
 *  1. Band A = the ~0.7 r rows starting 1 px below the ball's lower edge. Average each column over the band ->
 *     profile P(x), x in [cx - 1.7 rx, cx + 1.7 rx]. Baseline = median of P over the outer columns (|x - cx| >
 *     0.5 rx); noise = 1.4826 MAD of P there. threshold = max(8 DN, 5 noise).
 *  2. Peak = the column of largest |P - baseline| within |x - cx| <= 0.4 rx (a tee stands under the ball centre).
 *     Its width (FWHM) must be <= 0.9 rx: this rejects the wide soft shadow a ball casts on a mat.
 *  3. Continuity: starting at the ball, the rows must keep >= half the peak contrast at that column for at least
 *     max(4, 0.6 r) rows (one missed row allowed); length_px is the number of such rows (a lower bound of the
 *     visible tee length; the tee-to-mat transition may be lost in the mat colour).
 *  tee <=> peak above threshold AND width ok AND continuity ok. Either polarity (bright or dark tee) counts.
 *
 * Limits (the caller must treat lie_conf < ~0.6 as unknown and fall back to the club-type / venue prior):
 *  - needs a near side-on view: from high_behind (camera ~30 deg above the ball line) the tee is hidden by the ball;
 *  - needs ball radius >= ~6 px and a tee at least ~0.6 r (~13 mm) long; a very low tee reads as 'mat';
 *  - a tee whose colour equals the mat colour has no contrast and reads as 'mat';
 *  - a mat seam / printed line / blade of grass that is vertical, thin and right under the ball reads as 'tee';
 *  - a club head or hand touching the ball from below can hide or imitate the structure;
 *  - it says nothing about the tee HEIGHT (use the venue / P1 measurement, TEE_LIFT_ASSUMED otherwise).
 * ball = {u, v, rx, ry}. Returns {present, conf, length_px, width_px, contrast, x_px, thr}.
 */
export function detectTee(frame, ball, opts = {}) {
  const g = asGray(frame, opts);
  const { data, W, H } = g;
  const cx = ball.u, cy = ball.v;
  const rx = ball.rx ?? ball.w_px / 2, ry = ball.ry ?? ball.h_px / 2;
  const R = normRoi(opts.roi ?? null, W, H); // accepts {x,y,w,h} or an already normalised ROI
  const out = { present: false, conf: 0.5, length_px: 0, width_px: 0, contrast: 0, x_px: cx, thr: 0 };
  const jTop = Math.ceil(cy + ry + 1.0);
  const nA = Math.max(3, Math.round(0.7 * ry));
  if (jTop + nA >= R.y1) return out; // ball too close to the lower border: unknown
  const xa = Math.max(R.x0, Math.floor(cx - 1.7 * rx));
  const xb = Math.min(R.x1, Math.ceil(cx + 1.7 * rx));
  const nx = xb - xa;
  if (nx < 8) return out;
  const P = new Float64Array(nx);
  for (let j = jTop; j < jTop + nA; j++) {
    const off = j * W;
    for (let i = 0; i < nx; i++) P[i] += data[off + xa + i];
  }
  for (let i = 0; i < nx; i++) P[i] /= nA;
  const outer = [];
  for (let i = 0; i < nx; i++) if (Math.abs(xa + i + 0.5 - cx) > 0.5 * rx) outer.push(P[i]);
  const base = outer.length >= 4 ? medianOfList(outer) : medianOfList(Array.from(P));
  const dev = outer.map((v) => Math.abs(v - base));
  const noise = 1.4826 * (dev.length ? medianOfList(dev) : 1);
  const thr = Math.max(opts.minContrast ?? 8, 5 * noise);
  out.thr = thr;
  let bi = -1, bc = 0;
  for (let i = 0; i < nx; i++) {
    if (Math.abs(xa + i + 0.5 - cx) > 0.4 * rx) continue;
    const c = P[i] - base;
    if (Math.abs(c) > Math.abs(bc)) { bc = c; bi = i; }
  }
  out.contrast = bc;
  if (bi < 0) return out;
  const sgn = bc >= 0 ? 1 : -1;
  const half = 0.5 * Math.abs(bc);
  let l = bi, r = bi;
  while (l > 0 && sgn * (P[l - 1] - base) >= half) l--;
  while (r < nx - 1 && sgn * (P[r + 1] - base) >= half) r++;
  // linear interpolation of the half-contrast crossings
  const cross = (i0, i1) => {
    const a = sgn * (P[i0] - base), b = sgn * (P[i1] - base);
    return b === a ? 0 : clamp((half - a) / (b - a), 0, 1);
  };
  let wl = 0, wr = 0;
  if (l > 0) wl = 1 - cross(l - 1, l);
  if (r < nx - 1) wr = 1 - cross(r + 1, r);
  const width = r - l + 1 + wl + wr - 1;
  out.width_px = width;
  const xt = xa + 0.5 * (l + r) + 0.5;
  out.x_px = xt;
  // continuity down the structure
  const hw = Math.max(1, Math.round(0.4 * width));
  const xs0 = Math.round(xt - 0.5) - hw + 1, xs1 = Math.round(xt - 0.5) + hw; // stripe pixels [xs0, xs1)
  const gapL = Math.round(0.5 * width) + 2;
  const sideN = Math.max(2, Math.round(0.6 * rx));
  const maxRows = Math.round(2.8 * ry);
  let len = 0, miss = 0;
  for (let j = jTop; j < Math.min(R.y1, jTop + maxRows); j++) {
    const off = j * W;
    let s = 0, sn = 0;
    for (let x = xs0; x < xs1; x++) if (x >= R.x0 && x < R.x1) { s += data[off + x]; sn++; }
    const sideVals = [];
    for (let k = 0; k < sideN; k++) {
      const xl = xs0 - gapL + 1 - k, xr = xs1 + gapL - 1 + k;
      if (xl >= R.x0) sideVals.push(data[off + xl]);
      if (xr < R.x1) sideVals.push(data[off + xr]);
    }
    if (sn === 0 || sideVals.length < 2) break;
    const z = sgn * (s / sn - medianOfList(sideVals));
    if (z >= half) { len++; miss = 0; } else { miss++; if (miss > 1) break; }
  }
  out.length_px = len;
  const lenMin = Math.max(4, Math.round(0.6 * ry));
  const widthMax = 0.9 * rx;
  const passC = Math.abs(bc) >= thr;
  // margin of each criterion (>= 1 passes): contrast, continuity length, thinness
  const m = Math.min(Math.abs(bc) / thr, len / lenMin, widthMax / Math.max(width, 0.5));
  out.present = passC && width <= widthMax && len >= lenMin;
  // present: confidence grows with the smallest margin (1 -> 0.5, 2 or more -> 1);
  // absent: the further the best candidate is from passing, the surer the "mat" call (a wide shadow, no peak at all)
  const rw = widthMax / Math.max(width, 0.5);
  const mAbs = Math.min(Math.abs(bc) / thr, len / lenMin, rw);
  out.conf = out.present ? 0.5 + 0.5 * clamp(m - 1, 0, 1) : 0.5 + 0.5 * (1 - clamp(mAbs * mAbs, 0, 1));
  return out;
}

function restBallOnePolarity(sgnData, ww, wh, ox, oy, expected, wExp, opts) {
  const n = ww * wh;
  const { median: B0win, otsu } = histMedianAndOtsu(sgnData, n);
  const tLo = otsu - B0win;
  if (tLo < (opts.minContrast ?? 8) * 0.5) return null;
  const dwin = new Float32Array(n);
  for (let i = 0; i < n; i++) { const dv = sgnData[i] - B0win; dwin[i] = dv > 0 ? dv : 0; }
  const rExp = wExp / 2;
  const aExp = Math.PI * rExp * rExp;
  const comps = findComponents(dwin, ww, wh, null, { tLo, minArea: Math.max(6, 0.2 * aExp), maxArea: 6 * aExp });
  let best = null, bestCost = Infinity;
  for (const c of comps) {
    const du = c.u + ox - expected.u, dv = c.v + oy - expected.v;
    // the blob may include a tee: judge by distance of its top part, so use bbox top-centre distance as well
    const dTop = Math.hypot((c.bbox.x0 + c.bbox.x1) / 2 + ox - expected.u, c.bbox.y0 + oy + rExp - expected.v);
    const cost = Math.min(Math.hypot(du, dv), dTop) / wExp + 0.5 * Math.abs(Math.log(c.area / aExp));
    if (cost < bestCost) { bestCost = cost; best = c; }
  }
  if (!best) return null;
  const bb = best.bbox;
  const { wd, mid } = chordProfile(dwin, ww, bb, tLo);
  let wmax = 0;
  for (let j = 0; j < wd.length; j++) if (wd[j] > wmax) wmax = wd[j];
  if (wmax < 4) return null;
  let sMid = 0, nMid = 0;
  for (let j = 0; j < wd.length; j++) if (wd[j] >= 0.9 * wmax) { sMid += mid[j]; nMid++; }
  const r0 = wmax / 2;
  const cx0 = sMid / nMid;
  const cy0 = bb.y0 + r0; // top-edge based: unaffected by a tee below the ball
  // initial levels
  const ballPix = [], ringPix = [];
  for (let y = 0; y < wh; y++) {
    for (let x = 0; x < ww; x++) {
      const d = Math.hypot(x + 0.5 - cx0, y + 0.5 - cy0);
      if (d <= 0.55 * r0) ballPix.push(sgnData[y * ww + x]);
      else if (d >= r0 + 3 && d <= r0 + 0.9 * wExp) ringPix.push(sgnData[y * ww + x]);
    }
  }
  const L0 = medianOfList(ballPix);
  const Bg0 = ringPix.length >= 8 ? medianOfList(ringPix) : B0win;
  if (!(L0 - Bg0 > (opts.minContrast ?? 8))) return null;
  return { cx0, cy0, rx0: r0, ry0: r0, L0, B0: Bg0, tLo, comp: best, wmax, area: best.area };
}

/**
 * Locate the resting ball in a single frame. `expected` = {u, v, w_px} (from calibration / the pose prediction, or
 * a user tap); the search is limited to 1.6 w_px around it, inside roi. Returns null when no ball-like blob exists.
 * opts: { polarity = 'bright' | 'dark' | 'auto', edgePx (initial edge width, default 1.5), minContrast = 8,
 *         searchHalf, W, H, teeCheck = true }.
 * Result: { u, v, w_px, h_px, r_px, lie: 'mat'|'tee', conf, lie_conf, tee, contrast, rms, method: 'lm'|'moments',
 *           polarity, size_ratio }
 * conf = ball-detection confidence (contrast, fit residual, shape); lie_conf = confidence of the lie decision;
 * size_ratio = w_px / expected.w_px (the caller applies the +-6 % check of CAFCR C7).
 */
export function detectRestBall(frame, roi, expected, opts = {}) {
  const g = asGray(frame, opts);
  const { data, W, H } = g;
  const R = normRoi(roi, W, H);
  const wExp = expected.w_px > 0 ? expected.w_px : 20;
  const half = Math.ceil(opts.searchHalf ?? 1.6 * wExp);
  const wx0 = Math.max(R.x0, Math.floor(expected.u - half));
  const wx1 = Math.min(R.x1, Math.ceil(expected.u + half));
  const wy0 = Math.max(R.y0, Math.floor(expected.v - half));
  const wy1 = Math.min(R.y1, Math.ceil(expected.v + half));
  const ww = wx1 - wx0, wh = wy1 - wy0;
  if (ww < 8 || wh < 8) return null;
  const pols = opts.polarity === 'auto' ? ['bright', 'dark'] : [opts.polarity ?? 'bright'];
  for (const pol of pols) {
    const s = new Float32Array(ww * wh);
    for (let y = 0; y < wh; y++) {
      const off = (wy0 + y) * W + wx0;
      for (let x = 0; x < ww; x++) s[y * ww + x] = pol === 'dark' ? 255 - data[off + x] : data[off + x];
    }
    const res = detectInPolarity(s, ww, wh, wx0, wy0, expected, wExp, pol, opts, g, R);
    if (res) return res;
  }
  return null;
}

function detectInPolarity(s, ww, wh, ox, oy, expected, wExp, pol, opts, g, R) {
  const init = restBallOnePolarity(s, ww, wh, ox, oy, expected, wExp, opts);
  if (!init) return null;
  const wantTee = opts.teeCheck !== false;
  // pass 1 tee check with the coarse ellipse, to mask the tee while fitting
  const polImg = g; // the tee check uses |contrast|: either polarity counts
  let tee1 = null;
  if (wantTee) {
    tee1 = detectTee(polImg, { u: init.cx0 + ox, v: init.cy0 + oy, rx: init.rx0, ry: init.ry0 }, { roi: R });
  }
  const xs = [], ys = [], vals = [];
  const rx0 = init.rx0, ry0 = init.ry0;
  for (let y = 0; y < wh; y++) {
    for (let x = 0; x < ww; x++) {
      const px = x + 0.5, py = y + 0.5;
      const rho = Math.hypot((px - init.cx0) / rx0, (py - init.cy0) / ry0);
      if (rho > 1.9) continue;
      if (tee1 && tee1.present && py > init.cy0 + 0.5 * ry0 && Math.abs(px - (tee1.x_px - ox)) <= 0.5 * tee1.width_px + 2.5) continue;
      xs.push(px); ys.push(py); vals.push(s[y * ww + x]);
    }
  }
  let u = init.cx0 + ox, v = init.cy0 + oy, rx = rx0, ry = ry0, method = 'moments', rms = NaN, L = init.L0, Bk = init.B0;
  if (xs.length >= 30) {
    const fit = fitEllipseDisk(Float64Array.from(xs), Float64Array.from(ys), Float64Array.from(vals),
      [init.cx0, init.cy0, rx0, ry0, init.L0, init.B0, 0, 0, opts.edgePx ?? 1.5]);
    const th = fit.theta;
    const ok = Number.isFinite(fit.cost) && th[2] > 0.5 * rx0 && th[2] < 1.6 * rx0 && th[3] > 0.5 * ry0 && th[3] < 1.6 * ry0 &&
      Math.hypot(th[0] - init.cx0, th[1] - init.cy0) < 0.8 * rx0 && th[4] - th[5] > 0.5 * (init.L0 - init.B0);
    if (ok) {
      u = th[0] + ox; v = th[1] + oy; rx = th[2]; ry = th[3]; L = th[4]; Bk = th[5];
      method = 'lm';
      rms = Math.sqrt(fit.cost / xs.length);
    }
  }
  const contrast = L - Bk;
  let tee = tee1;
  if (wantTee) tee = detectTee(polImg, { u, v, rx, ry }, { roi: R });
  const wRatio = (2 * rx) / wExp;
  const confFit = Number.isFinite(rms) ? clamp(1 - rms / (0.3 * contrast), 0, 1) : 0.3;
  const confContrast = clamp(contrast / 40, 0, 1);
  const confShape = clamp(1 - Math.abs(Math.log(rx / ry)) / 0.35, 0, 1);
  const conf = Math.min(confFit, confContrast, 0.3 + 0.7 * confShape);
  return {
    u, v, w_px: 2 * rx, h_px: 2 * ry, r_px: 0.5 * (rx + ry),
    lie: tee && tee.present ? 'tee' : 'mat',
    conf,
    lie_conf: tee ? tee.conf : 0,
    tee,
    contrast,
    rms,
    method,
    polarity: pol,
    size_ratio: wRatio,
  };
}

// ------------------------------------------------------------------------------------------------ departure

/**
 * Find the first frame in which the resting ball is no longer on its spot, from raw pixels (independent of the
 * detector). Statistic per frame = mean(core disc, 0.6 r) - mean(ring, r+2.5 .. r+6): the ball is a bright disc on a
 * darker surround, so a club head that sweeps over the spot (covering core AND ring alike) reads as "gone", not as
 * "ball". The statistic is compared with its level in the first frames (ball present) and in the last frames (mat
 * only). Returns {ok, lastRest, departure, levels:{ball, mat}, frac:Float64Array}; ok=false when the two levels cannot
 * be told apart (ball never leaves / no contrast). opts: { head = 6, tail = 6, minContrast = 12 }.
 */
export function findDeparture(frames, W, H, rest, opts = {}) {
  const n = frames.length;
  const rr = rest.r_px ?? (rest.w_px ? rest.w_px / 2 : 8);
  const rc = Math.max(2, 0.6 * rr);
  const r0 = rr + 2.5, r1 = rr + 6;
  const x0 = Math.max(0, Math.floor(rest.u - r1)), x1 = Math.min(W, Math.ceil(rest.u + r1));
  const y0 = Math.max(0, Math.floor(rest.v - r1)), y1 = Math.min(H, Math.ceil(rest.v + r1));
  const stat = new Float64Array(n);
  for (let f = 0; f < n; f++) {
    const fr = frames[f];
    let sc = 0, nc = 0, sr = 0, nr = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const d2 = (x + 0.5 - rest.u) ** 2 + (y + 0.5 - rest.v) ** 2;
        if (d2 <= rc * rc) { sc += fr[y * W + x]; nc++; } else if (d2 >= r0 * r0 && d2 <= r1 * r1) { sr += fr[y * W + x]; nr++; }
      }
    }
    stat[f] = nc && nr ? sc / nc - sr / nr : 0;
  }
  const head = Math.min(opts.head ?? 6, Math.max(1, n >> 1));
  const tail = Math.min(opts.tail ?? 6, Math.max(1, n >> 1));
  const Lb = medianOfList(Array.from(stat.subarray(0, head)));
  const Mt = medianOfList(Array.from(stat.subarray(n - tail)));
  const out = { ok: false, lastRest: -1, departure: -1, levels: { ball: Lb, mat: Mt }, frac: new Float64Array(n) };
  if (!(Math.abs(Lb - Mt) >= (opts.minContrast ?? 12))) return out;
  const present = new Array(n);
  for (let f = 0; f < n; f++) {
    out.frac[f] = (stat[f] - Mt) / (Lb - Mt);
    present[f] = out.frac[f] > 0.5;
  }
  let last = -1;
  for (let f = n - 1; f >= 1; f--) {
    if (present[f] && present[f - 1]) { last = f; break; }
  }
  if (last < 0) return out;
  out.ok = true;
  out.lastRest = last;
  out.departure = last + 1;
  return out;
}

// ------------------------------------------------------------------------------------------------ linking

const dist2 = (a, b) => Math.hypot(a.u - b.u, a.v - b.v);

function lsLine(pts) {
  // pts: [{t,u,v}] -> {t0, u0, v0, vu, vv, rms}
  const n = pts.length;
  let st = 0;
  for (const p of pts) st += p.t;
  const t0 = st / n;
  let sdd = 0, su = 0, sv = 0, sdu = 0, sdv = 0;
  for (const p of pts) {
    const d = p.t - t0;
    sdd += d * d; su += p.u; sv += p.v; sdu += d * p.u; sdv += d * p.v;
  }
  const u0 = su / n, v0 = sv / n;
  const vu = sdd > 0 ? sdu / sdd : 0; // sum(d*u)/sum(d*d); sum(d) = 0 so no centring term is needed
  const vv = sdd > 0 ? sdv / sdd : 0;
  let e = 0;
  for (const p of pts) {
    const d = p.t - t0;
    e += (p.u - (u0 + vu * d)) ** 2 + (p.v - (v0 + vv * d)) ** 2;
  }
  return { t0, u0, v0, vu, vv, rms: Math.sqrt(e / n) };
}

// Polynomial motion model y(t) = c0 + c1 (t - t0) [+ c2 (t - t0)^2] fitted by least squares.
function polyFit(pts, deg) {
  // pts: [{t, y}] -> coefficients c (y = c0 + c1 t + c2 t^2) around the mean time, with t0
  const n = pts.length;
  let t0 = 0;
  for (const q of pts) t0 += q.t;
  t0 /= n;
  const m = deg + 1;
  const A = Array.from({ length: m }, () => new Float64Array(m));
  const b = new Float64Array(m);
  for (const q of pts) {
    const x = q.t - t0;
    const pw = [1, x, x * x];
    for (let i = 0; i < m; i++) { b[i] += pw[i] * q.y; for (let j = 0; j < m; j++) A[i][j] += pw[i] * pw[j]; }
  }
  const c = solve(A, b);
  return c ? { c, t0 } : null;
}

function polyEval(fit, t) {
  const x = t - fit.t0;
  return fit.c[0] + fit.c[1] * x + (fit.c.length > 2 ? fit.c[2] * x * x : 0);
}

// Leave-one-out residual (px) of every chain member against the motion model fitted to the others; null entries when
// the chain is too short (< 4) to say anything.
function looResiduals(chain, times) {
  const n = chain.length;
  const out = new Array(n).fill(null);
  if (n < 4) return out;
  const deg = n >= 8 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const rest = chain.filter((_, k) => k !== i);
    const fu = polyFit(rest.map((q) => ({ t: times[q.f], y: q.c.u })), deg);
    const fv = polyFit(rest.map((q) => ({ t: times[q.f], y: q.c.v })), deg);
    if (!fu || !fv) continue;
    out[i] = Math.hypot(polyEval(fu, times[chain[i].f]) - chain[i].c.u, polyEval(fv, times[chain[i].f]) - chain[i].c.v);
  }
  return out;
}

// Leave-one-out outlier trimming of a chain: remove the observation that disagrees most with a polynomial motion
// model fitted to all the others (linear for short chains, quadratic from 8 obs on) while it is off by more than
// `tol` px. Removes the contaminated first observation (impact frame merged with the club head, ball struck in the
// middle of the exposure) and mislinks. Returns a new chain; never shortens it below 3.
function trimChain(chain, times, tol) {
  let cur = chain.slice();
  for (let iter = 0; iter < 4 && cur.length >= 4; iter++) {
    const res = looResiduals(cur, times);
    let worst = -1, worstE = 0;
    for (let i = 0; i < cur.length; i++) if (res[i] != null && res[i] > worstE) { worstE = res[i]; worst = i; }
    if (worst < 0 || worstE <= tol) break;
    cur = cur.filter((_, k) => k !== worst);
  }
  return cur;
}

function medianStepSpeed(chain, times) {
  const v = [];
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1], b = chain[i];
    const dt = times[b.f] - times[a.f];
    if (dt > 0) v.push(Math.hypot(b.c.u - a.c.u, b.c.v - a.c.v) / dt);
  }
  return v.length ? medianOfList(v) : 0;
}

// Several chains can be valid (e.g. the ball and the club head that follows it through the impact zone). Among the
// chains that are long enough to count, prefer the FASTEST: the ball always leaves faster than the club head
// (smash factor > 1), while the head trails behind it. p.preferFast = false picks the longest chain instead.
function pickChain(chains, p) {
  if (chains.length === 0) return null;
  let nmax = 0;
  for (const c of chains) nmax = Math.max(nmax, c.chain.length);
  const need = Math.min(p.eligibleLen ?? 4, nmax);
  let best = null, bestKey = -Infinity;
  for (const c of chains) {
    if (c.chain.length < need) continue;
    const key = p.preferFast === false
      ? c.chain.length - 0.02 * c.line.rms - 0.002 * c.dperp
      : c.speed * (1 + 0.02 * c.chain.length) - 0.5 * c.line.rms;
    if (key > bestKey) { bestKey = key; best = c; }
  }
  return best;
}

/**
 * Generic greedy constant-velocity linker (shared by trackBall and the club-head tracker, which runs it on reversed
 * time). Seeds are candidates in frames [seedFrom, seedTo]; each seed is extended frame by frame with a constant
 * velocity prediction and a gate; every chain is trimmed (leave-one-out) and checked; the best chain is returned.
 * p: {
 *   start {u,v}            anchor (the rest spot); seeds must be within firstGate of it and farther than tolRest
 *   seedFrom, seedTo       frame range for seeds;  sizeOk(c) -> bool  candidate filter
 *   expectedDir [du,dv], dirTolDeg = 60   direction prior (first displacement and overall direction)
 *   maxGap = 3, gatePx = 6, gateFrac = 0.3 (gate = gatePx + gateFrac * step; doubled for the first links)
 *   minStep = 3, maxStep = 400, stepGeFirst = true (second link must not be shorter than the displacement from start
 *   divided by the frames since seedFrom), secondAngleDeg = 35 (cone around the start->seed direction)
 *   backTol, backFramesMax = 6   back-projection: the straight line through the first observations must pass within
 *                                backTol px of the anchor, behind the first observation, at most backFramesMax frames before it
 *   trimTol                leave-one-out outlier trimming tolerance in px (omit = no trimming)
 *   minLen = 3, eligibleLen = 4, preferFast = true, maxSeeds = 24 }
 * Returns { best: {chain: [{f, c}], line, dperp, seedFrame, speed} | null, seeds }.
 */
export function linkChains(dets, times, p) {
  const nF = dets.length;
  const sizeOk = p.sizeOk ?? (() => true);
  const maxGap = p.maxGap ?? 3;
  const start = p.start ?? null;
  const seeds = [];
  const seedTo = Math.min(nF - 1, p.seedTo ?? nF - 1);
  for (let f = Math.max(0, p.seedFrom ?? 0); f <= seedTo; f++) {
    for (const c of dets[f]) {
      if (!sizeOk(c)) continue;
      if (start) {
        const d = dist2(c, start);
        if (d > (p.firstGate ?? Infinity)) continue;
        if (d < (p.tolRest ?? 0)) continue;
        if (p.expectedDir && d > 4) {
          const cos = ((c.u - start.u) * p.expectedDir[0] + (c.v - start.v) * p.expectedDir[1]) / d;
          if (cos < Math.cos(((p.dirTolDeg ?? 60) * Math.PI) / 180)) continue;
        }
      }
      seeds.push({ f, c });
    }
  }
  if (start) seeds.sort((a, b) => a.f - b.f || dist2(a.c, start) - dist2(b.c, start));
  const maxSeeds = p.maxSeeds ?? 24;
  let best = null;
  const chains = [];
  const tried = Math.min(seeds.length, maxSeeds);
  for (let si = 0; si < tried; si++) {
    const seed = seeds[si];
    let chain = extend(dets, times, seed, p, maxGap);
    if (p.trimTol != null) chain = trimChain(chain, times, p.trimTol);
    if (chain.length < (p.minLen ?? 3)) continue;
    const pts = chain.map((q) => ({ t: times[q.f], u: q.c.u, v: q.c.v }));
    const line = lsLine(pts);
    let dperp = 0;
    if (start && p.backTol != null) {
      const k = Math.min(5, pts.length);
      const l5 = lsLine(pts.slice(0, k));
      const sp2 = l5.vu * l5.vu + l5.vv * l5.vv;
      if (sp2 < 1e-9) continue;
      const tStar = l5.t0 + ((start.u - l5.u0) * l5.vu + (start.v - l5.v0) * l5.vv) / sp2;
      const pu = l5.u0 + l5.vu * (tStar - l5.t0), pv = l5.v0 + l5.vv * (tStar - l5.t0);
      dperp = Math.hypot(pu - start.u, pv - start.v);
      const dtF = pts.length > 1 ? (pts[1].t - pts[0].t) : 0.004;
      const tFirst = pts[0].t;
      if (dperp > p.backTol) continue;
      if (tStar > tFirst + 0.5 * dtF) continue; // the rest spot must lie BEHIND the first observation
      if (tStar < tFirst - (p.backFramesMax ?? 6) * dtF) continue;
    }
    if (p.expectedDir) {
      const sp = Math.hypot(line.vu, line.vv);
      if (sp > 1e-9 && (line.vu * p.expectedDir[0] + line.vv * p.expectedDir[1]) / sp < Math.cos(((p.dirTolDeg ?? 60) * Math.PI) / 180)) continue;
    }
    chains.push({ chain, line, dperp, seedFrame: seed.f, speed: medianStepSpeed(chain, times) });
  }
  best = pickChain(chains, p);
  return { best, seeds: seeds.length };
}

function extend(dets, times, seed, p, maxGap) {
  const nF = dets.length;
  const sizeOk = p.sizeOk ?? (() => true);
  const start = p.start ?? null;
  const gatePx = p.gatePx ?? 6;
  const gateFrac = p.gateFrac ?? 0.3;
  const chain = [seed];
  let vel = null; // [du/dt, dv/dt]
  let lastF = seed.f;
  let launch = p.launchDir ?? null;
  const d1 = start ? dist2(seed.c, start) : 0;
  if (start && d1 >= 5) launch = [(seed.c.u - start.u) / d1, (seed.c.v - start.v) / d1];
  for (let i = seed.f + 1; i < nF && i - lastF <= maxGap + 1; i++) {
    const last = chain[chain.length - 1];
    const dt = times[i] - times[last.f];
    if (!(dt > 0)) continue;
    let pick = null, pickCost = Infinity;
    if (chain.length === 1) {
      const cosMin = Math.cos(((d1 >= 5 ? (p.secondAngleDeg ?? 35) : 70) * Math.PI) / 180);
      for (const c of dets[i]) {
        if (!sizeOk(c)) continue;
        const dx = c.u - last.c.u, dy = c.v - last.c.v;
        const dd = Math.hypot(dx, dy);
        if (dd < (p.minStep ?? 3) || dd > (p.maxStep ?? 400)) continue;
        // the ball cannot slow down: the step is at least the displacement from the rest spot divided by the number of
        // frames since the earliest possible impact (kSeed + 1)
        if (start && d1 >= 5 && p.stepGeFirst !== false && dd * (1 + (seed.f - (p.seedFrom ?? 0))) < 0.6 * d1) continue;
        let cost = dd;
        if (launch) {
          const cos = (dx * launch[0] + dy * launch[1]) / dd;
          if (cos < cosMin) continue;
          cost = dd * (1 - cos) + 0.02 * dd;
        }
        if (cost < pickCost) { pickCost = cost; pick = c; }
      }
    } else {
      const pu = last.c.u + vel[0] * dt, pv = last.c.v + vel[1] * dt;
      const step = Math.hypot(vel[0], vel[1]) * dt;
      const gate = gatePx + gateFrac * step * (chain.length < 4 ? 2 : 1);
      for (const c of dets[i]) {
        if (!sizeOk(c)) continue;
        const dd = Math.hypot(c.u - pu, c.v - pv);
        if (dd > gate) continue;
        if (dd < pickCost) { pickCost = dd; pick = c; }
      }
    }
    if (pick) {
      chain.push({ f: i, c: pick });
      lastF = i;
      const K = Math.min(4, chain.length);
      if (K === 2) {
        const a = chain[chain.length - 2];
        const dtt = times[i] - times[a.f];
        vel = [(pick.u - a.c.u) / dtt, (pick.v - a.c.v) / dtt];
      } else {
        const l = lsLine(chain.slice(-K).map((q) => ({ t: times[q.f], u: q.c.u, v: q.c.v })));
        vel = [l.vu, l.vv];
      }
    }
  }
  return chain;
}

/**
 * Track the ball after impact.
 * @param {Array<Candidate[]>} dets   per-frame candidates (detectCandidates output)
 * @param {number[]|Float64Array} times  frame times in seconds (same length)
 * @param {object} opts {
 *   start: {u, v, r_px?}   resting ball (seed region); strongly recommended
 *   expectedDir: [du, dv]  optional unit direction prior in image axes, with dirTolDeg (default 60)
 *   maxGap = 3             missed frames tolerated inside a track
 *   gate = 6               base gate in px; the gate grows by gateSpeedFrac (0.3) of the step
 *   firstGate              max distance of the first detection from the rest position (default 260 px)
 *   firstFrame             first frame allowed to seed (default: the frame after the rest phase, derived from dets)
 *   firstDelay = 4         the seed must be within this many frames of firstFrame (the ball is moving right away)
 *   rRange                 [lo, hi] allowed r_px (default [0.4, 1.9] * start.r_px)
 *   minLen = 3, maxStep = 400, backTol (default max(2.5 r, 12) px), requireBackProjection = true }
 * @returns {{obs, gaps, n, info}}  obs per interfaces.md section 4 {frame, t_s, u, v, w_px, h_px, r_px, area, peak}
 *   plus elong (blob elongation, 1 = round) and resid_px (leave-one-out distance to the constant-velocity /
 *   constant-acceleration model of the other observations; null for chains shorter than 4). A large resid_px on the first
 *   observation means the impact happened inside that frame's exposure (blended blob): weight it down.
 *   info = {restEnd, seedFrame, rms_px, dperp_px, seeds}.
 */
export function trackBall(dets, times, opts = {}) {
  const nF = dets.length;
  const start = opts.start ?? null;
  const rRest = start && start.r_px > 0 ? start.r_px : 0;
  const tolRest = start ? Math.max(2.5, 0.45 * (rRest || 8)) : 0;
  const restArea = rRest ? Math.PI * rRest * rRest : 0;
  // rest phase: frames that still show a rest-like blob on the spot
  // (a) from the detections: the last frame that still shows a rest-like blob on the spot (two missing frames end it);
  // (b) from the caller (pixel-level findDeparture). When both exist the earlier one wins: a club head that sweeps over
  // the spot after impact can make the pixel test think the ball is still there, and a club that merges with the ball
  // can hide it from the detector; seeding too early only costs a few extra candidate chains.
  let firstFrame = opts.firstFrame;
  let restEnd = -1;
  if (start) {
    let lastRest = -1, gap = 0;
    for (let f = 0; f < nF; f++) {
      const has = dets[f].some((c) => dist2(c, start) <= tolRest && (!restArea || (c.area >= 0.5 * restArea && c.area <= 2.2 * restArea)));
      if (has) { lastRest = f; gap = 0; } else if (lastRest >= 0) { gap++; if (gap >= 2) break; }
    }
    if (lastRest >= 0) firstFrame = firstFrame == null ? lastRest + 1 : Math.min(firstFrame, lastRest + 1);
    else if (firstFrame == null) firstFrame = 0;
  }
  if (firstFrame != null) restEnd = firstFrame - 1;
  const lo = rRest ? 0.4 * rRest : 0;
  const hi = rRest ? 1.9 * rRest : Infinity;
  const [rLo, rHi] = opts.rRange ?? [lo, hi];
  const sizeOk = (c) => c.r_px >= rLo && c.r_px <= rHi;
  const res = linkChains(dets, times, {
    start,
    seedFrom: Math.max(0, firstFrame ?? 0),
    seedTo: start ? Math.max(0, firstFrame ?? 0) + (opts.firstDelay ?? 4) : nF - 1,
    firstGate: opts.firstGate ?? 260,
    sizeOk,
    tolRest: start ? Math.max(1.5, 0.25 * (rRest || 8)) : 0,
    expectedDir: opts.expectedDir ?? null,
    dirTolDeg: opts.dirTolDeg ?? 60,
    maxGap: opts.maxGap ?? 3,
    gatePx: opts.gate ?? 6,
    gateFrac: opts.gateSpeedFrac ?? 0.3,
    minLen: opts.minLen ?? 3,
    trimTol: opts.trimTol ?? Math.max(3, 0.3 * (rRest || 8)),
    maxStep: opts.maxStep ?? 400,
    backTol: start && opts.requireBackProjection !== false ? (opts.backTol ?? Math.max(2.5 * (rRest || 8), 12)) : null,
    backFramesMax: (opts.firstDelay ?? 4) + 2,
  });
  const info = { restEnd, seedFrame: -1, rms_px: NaN, dperp_px: NaN, seeds: res.seeds };
  if (!res.best) return { obs: [], gaps: 0, n: 0, info };
  const { chain, line, dperp, seedFrame } = res.best;
  const resid = looResiduals(chain, times);
  const obs = chain.map(({ f, c }, i) => ({
    frame: f, t_s: times[f], u: c.u, v: c.v, w_px: c.w_px, h_px: c.h_px, r_px: c.r_px, area: c.area, peak: c.peak,
    elong: c.elong, resid_px: resid[i],
  }));
  const span = obs[obs.length - 1].frame - obs[0].frame + 1;
  info.seedFrame = seedFrame;
  info.rms_px = line.rms;
  info.dperp_px = dperp;
  return { obs, gaps: span - obs.length, n: obs.length, info };
}
