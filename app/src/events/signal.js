// Small 1-D signal helpers shared by events/ and metrics/ (pure).

/** Centred moving average with an odd window; the window shrinks symmetrically at the edges. */
export function movingAverage(x, w) {
  const n = x.length;
  const out = new Float64Array(n);
  const h = Math.max(0, (w | 0) >> 1);
  for (let k = 0; k < n; k++) {
    const r = Math.min(h, k, n - 1 - k);
    let s = 0;
    for (let i = k - r; i <= k + r; i++) s += x[i];
    out[k] = s / (2 * r + 1);
  }
  return out;
}

/** Odd window length covering about `seconds` at rate hz (minimum 1). */
export function oddWindow(seconds, hz) {
  const n = Math.max(1, Math.round(seconds * hz));
  return n % 2 ? n : n + 1;
}

/** Sub-sample offset in [-0.5, 0.5] of the vertex of the parabola through (−1, a), (0, b), (1, c). */
export function parabolicOffset(a, b, c) {
  const den = a - 2 * b + c;
  if (!(Math.abs(den) > 1e-12)) return 0;
  const d = (0.5 * (a - c)) / den;
  return d < -0.5 ? -0.5 : d > 0.5 ? 0.5 : d;
}

/**
 * First time in grid index range [k0, k1] where y crosses `level` going up (dir = +1) or down (dir = -1),
 * linearly interpolated between samples; null if it never does.
 */
export function firstCrossing(t, y, level, dir, k0, k1) {
  const a = Math.max(1, k0 + 1);
  const b = Math.min(y.length - 1, k1);
  for (let k = a; k <= b; k++) {
    const p = (y[k - 1] - level) * dir;
    const q = (y[k] - level) * dir;
    if (p < 0 && q >= 0) {
      const w = p === q ? 0 : -p / (q - p);
      return t[k - 1] + w * (t[k] - t[k - 1]);
    }
  }
  return null;
}

/** Index of the sample of t nearest to time x (t sorted ascending). */
export function nearestIndex(t, x) {
  const n = t.length;
  if (n === 0) return -1;
  let lo = 0;
  let hi = n - 1;
  if (x <= t[0]) return 0;
  if (x >= t[hi]) return hi;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (t[m] <= x) lo = m; else hi = m;
  }
  return x - t[lo] <= t[hi] - x ? lo : hi;
}

/** Grid index for time x on a uniform grid t0 + k/hz (clamped). */
export function gridIndex(t0, hz, K, x) {
  const k = Math.round((x - t0) * hz);
  return k < 0 ? 0 : k > K - 1 ? K - 1 : k;
}

export function wrapPi(a) {
  let y = a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
  if (y <= -Math.PI) y += 2 * Math.PI;
  return y;
}

/** Median frame interval -> nominal fps (NaN for fewer than 2 samples). */
export function estimateFps(t_s) {
  const n = t_s.length;
  if (n < 2) return NaN;
  const d = new Float64Array(n - 1);
  for (let i = 1; i < n; i++) d[i - 1] = t_s[i] - t_s[i - 1];
  d.sort();
  const m = d.length % 2 ? d[(d.length - 1) >> 1] : (d[d.length / 2 - 1] + d[d.length / 2]) / 2;
  return m > 0 ? 1 / m : NaN;
}
