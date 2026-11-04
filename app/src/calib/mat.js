// Mat as calibration object (CAFCR K1; interfaces.md §2): corner model in M and sub-pixel corner refinement.
//
// Corner order is always [tn, ln, lf, tf] (t = trail −x, l = lead +x, n = near −y, f = far +y), z = 0.
// Image coordinates: u right, v down, origin at the top-left image corner, pixel (i, j) centred at (i+½, j+½).

/** Default venue (CAFCR A: mat 1.50 m along the target line × 1.25 m, ball 0.30 m from the camera-side edge). */
export const DEFAULT_VENUE = Object.freeze({ mat_L: 1.5, mat_W: 1.25, ball_edge_m: 0.3, ball_x_m: 0 });
export const CORNER_NAMES = Object.freeze(['tn', 'ln', 'lf', 'tf']);

/** Mat corners in M, ordered [tn, ln, lf, tf], each [x, y, 0] (metres). */
export function matCorners(venue = DEFAULT_VENUE) {
  const L = venue.mat_L;
  const Wm = venue.mat_W;
  if (!(L > 0 && Wm > 0)) throw new RangeError('matCorners: venue.mat_L and venue.mat_W must be > 0');
  const be = venue.ball_edge_m ?? 0.3;
  const bx = venue.ball_x_m ?? 0;
  const xt = -L / 2 - bx;
  const xl = L / 2 - bx;
  const yn = -be;
  const yf = Wm - be;
  return [[xt, yn, 0], [xl, yn, 0], [xl, yf, 0], [xt, yf, 0]];
}

/** Bilinear sample of a grayscale image at continuous (u, v) (pixel centres at +½); clamps at the border. */
export function sampleBilinear(img, u, v) {
  const { data, W, H } = img;
  let x = u - 0.5;
  let y = v - 0.5;
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x > W - 1) x = W - 1;
  if (y > H - 1) y = H - 1;
  let i = Math.floor(x);
  let j = Math.floor(y);
  if (i > W - 2) i = W - 2;
  if (j > H - 2) j = H - 2;
  const a = x - i;
  const b = y - j;
  const k = j * W + i;
  const p00 = data[k];
  const p10 = data[k + 1];
  const p01 = data[k + W];
  const p11 = data[k + W + 1];
  return (1 - b) * ((1 - a) * p00 + a * p10) + b * ((1 - a) * p01 + a * p11);
}

/** Total-least-squares line through weighted points: returns { n: [nx, ny], c } with n·p + c = 0, |n| = 1. */
export function fitLineTLS(pts, w) {
  let sw = 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < pts.length; i++) {
    const wi = w ? w[i] : 1;
    sw += wi;
    mx += wi * pts[i][0];
    my += wi * pts[i][1];
  }
  if (!(sw > 0)) return null;
  mx /= sw;
  my /= sw;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < pts.length; i++) {
    const wi = w ? w[i] : 1;
    const dx = pts[i][0] - mx;
    const dy = pts[i][1] - my;
    sxx += wi * dx * dx;
    sxy += wi * dx * dy;
    syy += wi * dy * dy;
  }
  // Direction = principal eigenvector of the 2×2 scatter; normal is perpendicular to it.
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const dx = Math.cos(theta);
  const dy = Math.sin(theta);
  const n = [-dy, dx];
  return { n, c: -(n[0] * mx + n[1] * my), centroid: [mx, my], dir: [dx, dy] };
}

/** Intersection of two lines { n, c } (n·p + c = 0); null when (nearly) parallel. */
export function intersectLines(a, b) {
  const det = a.n[0] * b.n[1] - a.n[1] * b.n[0];
  if (!(Math.abs(det) > 1e-12)) return null;
  return [(a.n[1] * b.c - b.n[1] * a.c) / det, (b.n[0] * a.c - a.n[0] * b.c) / det];
}

function medianOf(arr) {
  const s = Float64Array.from(arr).sort();
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 ? s[(n - 1) / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2]);
}

/**
 * Sub-pixel refinement of the 4 mat corners.
 * For each side of the approximate quadrilateral, intensity profiles are sampled along the side normal
 * (±band_px); on each profile the strongest edge of the side's dominant polarity is located by the centroid of
 * the signed derivative around its peak (unbiased for a box-filtered step). A robust total-least-squares line is
 * fitted to the edge points of each side, and adjacent lines are intersected.
 *
 * img: { data (grayscale, row-major, length W·H), W, H }; approx: [[u, v] × 4] in [tn, ln, lf, tf] order.
 * opts: { band_px = 12, spacing_px = 2, step_px = 0.25, trim = 0.12 (fraction of each side skipped at the corners),
 *         centroid_px = 3, min_contrast = 6 (grey levels per px), min_points = 12 }.
 * Returns { ok, corners: [[u, v] × 4] | null, sides: [{ line, n_points, n_inliers, rms_px, polarity }],
 *           edge_residual_px: [rms per side], max_edge_residual_px }.
 * `edge_residual_px` is the RMS perpendicular distance of a side's inlier edge points to its fitted line; the C5
 * check (≤1.5 px) uses max_edge_residual_px.
 */
export function refineCorners(img, approx, opts = {}) {
  const band = opts.band_px ?? 12;
  const spacing = opts.spacing_px ?? 2;
  const step = opts.step_px ?? 0.25;
  const trim = opts.trim ?? 0.12;
  const R = opts.centroid_px ?? 3;
  const minContrast = opts.min_contrast ?? 6;
  const minPoints = opts.min_points ?? 12;
  if (!img || !img.data || !(img.W > 2 && img.H > 2)) throw new TypeError('refineCorners: img must be { data, W, H }');
  if (!Array.isArray(approx) || approx.length !== 4) throw new RangeError('refineCorners: need 4 approximate corners');
  const cxq = (approx[0][0] + approx[1][0] + approx[2][0] + approx[3][0]) / 4;
  const cyq = (approx[0][1] + approx[1][1] + approx[2][1] + approx[3][1]) / 4;
  const nS = Math.round((2 * band) / step) + 1;
  const prof = new Float64Array(nS);
  const sides = [];
  for (let k = 0; k < 4; k++) {
    const P = approx[k];
    const Q = approx[(k + 1) % 4];
    const len = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
    const d = [(Q[0] - P[0]) / len, (Q[1] - P[1]) / len];
    let n = [-d[1], d[0]];
    const mid = [(P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2];
    if (n[0] * (mid[0] - cxq) + n[1] * (mid[1] - cyq) < 0) n = [-n[0], -n[1]]; // outward normal
    const m = Math.max(2, Math.floor((len * (1 - 2 * trim)) / spacing));
    const cand = [];
    for (let s = 0; s <= m; s++) {
      const tt = trim + ((1 - 2 * trim) * s) / m;
      const bu = P[0] + tt * (Q[0] - P[0]);
      const bv = P[1] + tt * (Q[1] - P[1]);
      for (let i = 0; i < nS; i++) {
        const o = -band + i * step;
        prof[i] = sampleBilinear(img, bu + o * n[0], bv + o * n[1]);
      }
      // derivative along the outward normal (central difference over ±1 px)
      const h = Math.max(1, Math.round(1 / step));
      let gMax = 0;
      let iMax = -1;
      let gMin = 0;
      let iMin = -1;
      for (let i = h; i < nS - h; i++) {
        const g = (prof[i + h] - prof[i - h]) / (2 * h * step);
        if (g > gMax) { gMax = g; iMax = i; }
        if (g < gMin) { gMin = g; iMin = i; }
      }
      cand.push({ bu, bv, gMax, iMax, gMin, iMin, prof: Float64Array.from(prof) });
    }
    // dominant polarity: bright inside (intensity falls outward, g < 0) or dark inside (g > 0)
    let votes = 0;
    for (const c of cand) votes += -c.gMin > c.gMax ? 1 : -1;
    const pol = opts.polarity === 'bright_inside' ? -1 : opts.polarity === 'dark_inside' ? 1 : votes >= 0 ? -1 : 1;
    const pts = [];
    const wts = [];
    const h = Math.max(1, Math.round(1 / step));
    const rS = Math.round(R / step);
    for (const c of cand) {
      const peak = pol < 0 ? -c.gMin : c.gMax;
      const ip = pol < 0 ? c.iMin : c.iMax;
      if (!(peak >= minContrast) || ip < 0) continue;
      let sw = 0;
      let so = 0;
      for (let i = Math.max(h, ip - rS); i <= Math.min(nS - 1 - h, ip + rS); i++) {
        const g = (pol * (c.prof[i + h] - c.prof[i - h])) / (2 * h * step);
        if (g <= 0) continue;
        const o = -band + i * step;
        sw += g;
        so += g * o;
      }
      if (!(sw > 0)) continue;
      const off = so / sw;
      pts.push([c.bu + off * n[0], c.bv + off * n[1]]);
      wts.push(peak);
    }
    let line = pts.length >= 2 ? fitLineTLS(pts, wts) : null;
    let inl = pts.map(() => true);
    for (let it = 0; it < 4 && line; it++) {
      const res = pts.map((p) => Math.abs(line.n[0] * p[0] + line.n[1] * p[1] + line.c));
      const sig = 1.482602218505602 * medianOf(res);
      const lim = Math.max(3 * sig, 0.3);
      const next = res.map((r) => r <= lim);
      const ip = pts.filter((_, i) => next[i]);
      if (ip.length < 2) break;
      line = fitLineTLS(ip, wts.filter((_, i) => next[i]));
      inl = next;
    }
    let ss = 0;
    let ni = 0;
    if (line) {
      for (let i = 0; i < pts.length; i++) {
        if (!inl[i]) continue;
        const r = line.n[0] * pts[i][0] + line.n[1] * pts[i][1] + line.c;
        ss += r * r;
        ni++;
      }
    }
    sides.push({
      line: line ? { n: line.n, c: line.c } : null,
      n_points: pts.length,
      n_inliers: ni,
      rms_px: ni > 0 ? Math.sqrt(ss / ni) : NaN,
      polarity: pol < 0 ? 'bright_inside' : 'dark_inside',
    });
  }
  const okSides = sides.every((s) => s.line && s.n_inliers >= minPoints);
  let corners = null;
  if (okSides) {
    corners = [];
    for (let k = 0; k < 4; k++) {
      const p = intersectLines(sides[(k + 3) % 4].line, sides[k].line);
      if (!p) { corners = null; break; }
      corners.push(p);
    }
  }
  const res = sides.map((s) => s.rms_px);
  return {
    ok: okSides && corners !== null,
    corners,
    sides,
    edge_residual_px: res,
    max_edge_residual_px: res.some((x) => !Number.isFinite(x)) ? NaN : Math.max(...res),
  };
}
