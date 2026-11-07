// store/stats.js — club statistics, distance gaps and session comparison (LM-F; LAUNCH-MONITOR-SPEC §3.7, §3.8,
// §5.0-5). Pure: no DOM, clock or randomness. Lazy file (build.mjs LAZY_GLOBS), re-exported by store/index.js.
//
//   summarize(values, sigmas) -> { n, mean, median, sd_obs, sigma_noise, sd_est, indistinguishable, p10, p90, ci95_mean }
//     values: numbers (non-finite entries are dropped together with their sigma). sd_obs = sample SD (n − 1).
//     sigma_noise = root mean square of the finite per-shot sigmas (null when none is known).
//     sd_est = √max(0, sd_obs² − sigma_noise²): the spread left after removing the measurement noise (null when either
//     is unknown). indistinguishable = sd_obs ≤ 1.2 · sigma_noise: the spread is not larger than the measuring error,
//     so the player's consistency cannot be told apart from it (false when sigma_noise is unknown).
//     p10 / p90: numpy percentile(…, method='linear'). ci95_mean: Student-t interval of the mean (n ≥ 2, else null).
//   isMishit(x, all) -> boolean: |x − median(all)| > 3.5 · 1.4826 · MAD(all) (modified z-score 3.5, Iglewicz–Hoaglin);
//     false when MAD = 0 or there are fewer than 5 numbers (too few to call anything an outlier).
//   mishitMask(values) -> boolean[] (same rule, computed once for a whole list).
//   gapping(shots, { includeHB = false, gapMin = 7.3152, gapMax = 18.288, excludeMishits = false }) ->
//     [{ club, n, n_hb, carry: summarize, total: summarize, carry_hb: summarize | null, gap_next_m, flag, flags }]
//     carry from face_on shots (estimated); includeHB adds high_behind carry (low confidence). Clubs sorted by club
//     length (CLUBS order, longest first; unknown types after, by name). gap_next_m = carry median − the next shorter
//     club's carry median. flags ⊆ ['small_sample' (n < 5), 'gap_small' (< gapMin), 'gap_large' (> gapMax)];
//     flag = flags joined with ';' or null. Mishits are judged per club and angle on carry.
//   compareSessions(aShots, bShots, ids) -> compareSets(a, b) restricted to ids, plus notes small_sample (any metric
//     with n < 5 on a side) and model_mismatch (from compareSets); significant is true only when the 95 % interval
//     excludes 0 AND the comparison is like for like (same preset, angle, club and algorithms.lm version, n ≥ 5);
//     otherwise false. ci_excludes_zero keeps the raw interval result.
import { compareSets, tCritical95 } from './compare.js';
import { CLUBS } from '../session/settings.js';

const finite = (x) => typeof x === 'number' && Number.isFinite(x);
const MAD_K = 1.482602218505602;
export const MISHIT_Z = 3.5;
export const SMALL_N = 5;
export const INDISTINGUISHABLE_RATIO = 1.2;

/** numpy.percentile(sorted, p * 100, method='linear') on an ascending array. */
export function percentileSorted(sorted, p) {
  const n = sorted.length;
  if (!n) return null;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export function summarize(values = [], sigmas = []) {
  const xs = [];
  const sg = [];
  for (let i = 0; i < values.length; i++) {
    if (!finite(values[i])) continue;
    xs.push(values[i]);
    const s = sigmas?.[i];
    if (finite(s) && s >= 0) sg.push(s);
  }
  const n = xs.length;
  const sorted = [...xs].sort((a, b) => a - b);
  const mean = n ? xs.reduce((a, b) => a + b, 0) / n : null;
  let sdObs = null;
  if (n >= 2) {
    let ss = 0;
    for (const x of xs) ss += (x - mean) ** 2;
    sdObs = Math.sqrt(ss / (n - 1));
  }
  const sigmaNoise = sg.length ? Math.sqrt(sg.reduce((a, s) => a + s * s, 0) / sg.length) : null;
  const sdEst = sdObs !== null && sigmaNoise !== null ? Math.sqrt(Math.max(0, sdObs ** 2 - sigmaNoise ** 2)) : null;
  let ci = null;
  if (n >= 2) {
    const half = tCritical95(n - 1) * sdObs / Math.sqrt(n);
    ci = [mean - half, mean + half];
  }
  return {
    n,
    mean,
    median: percentileSorted(sorted, 0.5),
    sd_obs: sdObs,
    sigma_noise: sigmaNoise,
    sd_est: sdEst,
    indistinguishable: sdObs !== null && sigmaNoise !== null && sdObs <= INDISTINGUISHABLE_RATIO * sigmaNoise,
    p10: percentileSorted(sorted, 0.1),
    p90: percentileSorted(sorted, 0.9),
    ci95_mean: ci,
  };
}

function robust(all) {
  const xs = all.filter(finite).sort((a, b) => a - b);
  if (xs.length < SMALL_N) return null;
  const med = percentileSorted(xs, 0.5);
  const dev = xs.map((x) => Math.abs(x - med)).sort((a, b) => a - b);
  const mad = percentileSorted(dev, 0.5);
  return mad > 0 ? { med, scale: MAD_K * mad } : null;
}

const robustCache = new WeakMap();
export function isMishit(x, all = []) {
  if (!finite(x)) return false;
  let r = robustCache.get(all);
  if (r === undefined) { r = robust(all); robustCache.set(all, r); }
  return r !== null && Math.abs(x - r.med) > MISHIT_Z * r.scale;
}

export function mishitMask(values) {
  const r = robust(values);
  return values.map((x) => r !== null && finite(x) && Math.abs(x - r.med) > MISHIT_Z * r.scale);
}

const val = (m) => (m && finite(m.value) ? m.value : null);
const sig = (m) => (m && finite(m.sigma) ? m.sigma : null);

/** Club order: CLUBS (longest first), then unknown types by name. */
export function clubRank(type) {
  const i = CLUBS.findIndex((c) => c[0] === type);
  return i < 0 ? CLUBS.length : i;
}
export const byClub = (a, b) => clubRank(a) - clubRank(b) || String(a).localeCompare(String(b));

/** Shots of one angle with a carry number, mishits (on carry, per club) dropped when asked. */
function carryShots(shots, view, excludeMishits) {
  const by = new Map();
  for (const s of shots) {
    if (s?.capture?.view !== view || val(s.metrics?.carry_m) === null) continue;
    const c = s.club?.type ?? null;
    if (!by.has(c)) by.set(c, []);
    by.get(c).push(s);
  }
  if (excludeMishits) {
    for (const [c, list] of by) {
      const mask = mishitMask(list.map((s) => s.metrics.carry_m.value));
      by.set(c, list.filter((_, i) => !mask[i]));
    }
  }
  return by;
}

const pick = (list, id) => [list.map((s) => val(s.metrics?.[id])), list.map((s) => sig(s.metrics?.[id]))];

export function gapping(shots = [], { includeHB = false, gapMin = 7.3152, gapMax = 18.288, excludeMishits = false } = {}) {
  const fo = carryShots(shots, 'face_on', excludeMishits);
  const hb = includeHB ? carryShots(shots, 'high_behind', excludeMishits) : new Map();
  const clubs = [...new Set([...fo.keys(), ...hb.keys()])].sort(byClub);
  const rows = clubs.map((club) => {
    const a = fo.get(club) ?? [];
    const b = hb.get(club) ?? [];
    const all = [...a, ...b];
    return {
      club,
      n: all.length,
      n_hb: b.length,
      carry: summarize(...pick(all, 'carry_m')),
      total: summarize(...pick(all, 'total_m')),
      carry_hb: b.length ? summarize(...pick(b, 'carry_m')) : null,
      gap_next_m: null,
      flag: null,
      flags: [],
    };
  });
  rows.forEach((r, i) => {
    const next = rows[i + 1];
    if (next && r.carry.median !== null && next.carry.median !== null) r.gap_next_m = r.carry.median - next.carry.median;
    if (r.n < SMALL_N) r.flags.push('small_sample');
    if (r.gap_next_m !== null && r.gap_next_m < gapMin) r.flags.push('gap_small');
    if (r.gap_next_m !== null && r.gap_next_m > gapMax) r.flags.push('gap_large');
    r.flag = r.flags.length ? r.flags.join(';') : null;
  });
  return rows;
}

export const GAPPING_CSV_COLUMNS = Object.freeze(['club', 'n', 'carry_median_m', 'carry_p10_m', 'carry_p90_m', 'total_median_m', 'gap_next_m', 'flag']);

/** The gapping table as CSV: ASCII only (club type ids, metres with 2 decimals, flag codes), CRLF lines. */
export function gappingCSV(rows) {
  const num = (x) => (finite(x) ? String(Math.round(x * 100) / 100) : '');
  const lines = [GAPPING_CSV_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push([String(r.club ?? '').replace(/[^\w-]/g, '_'), r.n, num(r.carry.median), num(r.carry.p10), num(r.carry.p90),
      num(r.total.median), num(r.gap_next_m), r.flag ?? ''].join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

export function compareSessions(aShots = [], bShots = [], ids = null) {
  const want = ids ? new Set(ids) : null;
  // only the asked metrics are summarised (a shot has 36)
  const slim = (list) => (want ? list.map((s) => ({ ...s, metrics: Object.fromEntries([...want].filter((id) => s.metrics?.[id]).map((id) => [id, s.metrics[id]])) })) : list);
  const r = compareSets(slim(aShots), slim(bShots));
  const metrics = {};
  for (const [id, m] of Object.entries(r.metrics)) if (!want || want.has(id)) metrics[id] = m;
  const notes = [...r.notes];
  const small = Object.values(metrics).some((m) => m.a.n < SMALL_N || m.b.n < SMALL_N);
  if (small && !notes.some((n) => n.kind === 'small_sample')) notes.push({ kind: 'small_sample', params: { min: SMALL_N } });
  const like = r.warnings.length === 0 && notes.length === 0;
  for (const id of Object.keys(metrics)) {
    const m = metrics[id];
    metrics[id] = { ...m, ci_excludes_zero: m.significant, significant: like && m.significant === true };
  }
  return { ...r, notes, like_for_like: like, metrics };
}
