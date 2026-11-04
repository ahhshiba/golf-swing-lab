// Descriptive statistics on Array / Float64Array. Empty input returns NaN; any NaN in the input returns NaN.

export const MAD_TO_SIGMA = 1.482602218505602; // mad(x) * MAD_TO_SIGMA estimates sigma for normal data

function hasNaN(x) {
  for (let i = 0; i < x.length; i++) if (Number.isNaN(x[i])) return true;
  return false;
}

export function sum(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  return s;
}

export function mean(x) {
  const n = x.length;
  if (n === 0) return NaN;
  return sum(x) / n;
}

/** Variance with `ddof` delta degrees of freedom (default 1 = sample variance). n <= ddof gives NaN. */
export function variance(x, ddof = 1) {
  const n = x.length;
  if (n - ddof <= 0) return NaN;
  const m = mean(x);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = x[i] - m;
    s += d * d;
  }
  return s / (n - ddof);
}

/** Standard deviation; default ddof = 1 (sample). Pass ddof = 0 for the population value. */
export function std(x, ddof = 1) {
  return Math.sqrt(variance(x, ddof));
}

/**
 * Percentile with linear interpolation between order statistics (numpy 'linear'):
 * position = p/100 · (n − 1) in the sorted data. p in [0, 100].
 */
export function percentile(x, p) {
  if (!(p >= 0 && p <= 100)) throw new RangeError('percentile: p must be in [0, 100]');
  const n = x.length;
  if (n === 0 || hasNaN(x)) return NaN;
  const s = Float64Array.from(x).sort();
  const pos = (p / 100) * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, n - 1);
  const frac = pos - lo;
  return frac === 0 ? s[lo] : s[lo] + frac * (s[hi] - s[lo]);
}

/** Quantile q in [0, 1]; same interpolation as percentile. */
export function quantile(x, q) {
  return percentile(x, q * 100);
}

export function median(x) {
  return percentile(x, 50);
}

/** Median absolute deviation around the median, times `scale` (use MAD_TO_SIGMA for a sigma estimate). */
export function mad(x, scale = 1) {
  const m = median(x);
  if (Number.isNaN(m)) return NaN;
  const d = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) d[i] = Math.abs(x[i] - m);
  return median(d) * scale;
}

/** Root mean square: rmse(residuals) or rmse(a, b) = sqrt(mean((a − b)²)). */
export function rmse(a, b) {
  const n = a.length;
  if (b !== undefined && b.length !== n) throw new RangeError('rmse: length mismatch');
  if (n === 0) return NaN;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = b === undefined ? a[i] : a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s / n);
}
