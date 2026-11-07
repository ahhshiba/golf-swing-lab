// viz/charts.js — bar chart (drill misses, §3.5) and box plot per club (stats, §3.7) (LAUNCH-MONITOR-SPEC §5.0-4;
// docs/viz.md §7). Labels are strings the caller already localised (club names, question numbers).
//
//   drawBars(canvas, { bars: [{ label, value, lo?, hi?, club?, series?, validity? }], palette, units?, kind?, unit? })
//     signed values around a zero line (e.g. +long / −short); lo..hi = an error whisker; low_confidence bars are
//     outlined with the [6, 4] dash instead of filled
//   drawBox(canvas, { groups: [{ label, club?, series?, values?, stats? }], palette, units?, kind?, unit? })
//     one horizontal row per group: whiskers 10th–90th percentile, box = middle half (25th–75th), median bar,
//     points outside the whiskers as dots; stats = { p10, q1, median, q3, p90 } instead of raw values
//   axisTitle (string | unit => string) is the axis title that carries the unit (default: the unit alone); drawBars also
//   takes xTitle (string) for a title under the bar labels. Tick labels are never left out for the unit; bar labels
//   that would run together are thinned (every 2nd, 3rd … label).
//   kind 'distance' → values are metres shown in units.distance; otherwise numbers are shown as given with `unit`.
//   quantile(sortedValues, p) — linear interpolation (numpy method 'linear')
import { t, fmtNum } from '../i18n/index.js';
import { seriesIndex } from './palette.js';
import { setup, distUnit, unitText, ticks, lerpScale, dash, text, glyph, finite, axisTitleX, axisTitleY, tickText, TITLE_B, FS } from './draw.js';

function scaleOf(opts) {
  if (opts.kind === 'distance') { const u = distUnit(opts.units); return { f: u.f, unit: unitText(u.key) }; }
  return { f: 1, unit: opts.unit ?? '' };
}

const titleOf = (o, unit) => (typeof o.axisTitle === 'function' ? o.axisTitle(unit) : o.axisTitle ?? unit);

export function quantile(sorted, p) {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo] + (i - lo) * (sorted[hi] - sorted[lo]);
}

export function drawBars(canvas, opts = {}) {
  const P = opts.palette;
  const { ctx, w, h } = setup(canvas, P);
  const { f, unit } = scaleOf(opts);
  const bars = (opts.bars ?? []).filter((b) => b && finite(b.value));
  if (!bars.length) {
    text(ctx, t('viz.bars.empty'), w / 2, h / 2, { colour: P.text, align: 'center', font: P.font, size: 13 });
    return { a11y: 'viz.bars.empty', params: { n: 0 } };
  }
  const vals = bars.flatMap((b) => [b.value, b.lo, b.hi].filter(finite)).map((v) => v * f);
  let v0 = Math.min(0, ...vals);
  let v1 = Math.max(0, ...vals);
  if (v1 - v0 < 1e-9) v1 = v0 + 1;
  // value labels sit outside the bar and its whisker: leave room for them at both ends
  const labels = bars.length <= 12;
  const pad = (v1 - v0) * (labels ? 0.16 : 0.08);
  v0 = v0 < 0 ? v0 - pad : 0;
  v1 = v1 > 0 ? v1 + pad : 0;
  const box = { l: 40 * FS, r: w - 10, t: 6 + 15 * FS, b: h - (opts.xTitle ? TITLE_B : 22) * FS };
  const ys = lerpScale(v0, v1, box.b, box.t);
  const yT = ticks(v0, v1, 4);
  ctx.lineWidth = 1;
  ctx.strokeStyle = P.grid;
  ctx.beginPath();
  for (const v of yT.list) { const y = Math.round(ys(v)) + 0.5; ctx.moveTo(box.l, y); ctx.lineTo(box.r, y); }
  ctx.stroke();
  // the unit is in the y axis title above the label column: every tick label stays
  for (const v of yT.list) text(ctx, fmtNum(v, { sign: v0 < 0 }), box.l - 6, ys(v) + 4 * FS, { colour: P.text, align: 'right', font: P.font, size: 11 });
  axisTitleY(ctx, P, box, titleOf(opts, unit));
  axisTitleX(ctx, P, box, opts.xTitle);
  const slot = (box.r - box.l) / bars.length;
  // bar labels: every k-th when a slot is narrower than its label plus a gap (200 % text, 18 bars)
  ctx.font = `500 ${11 * FS}px ${P.font}`;
  const every = Math.max(1, Math.ceil((Math.max(...bars.map((b, i) => ctx.measureText(String(b.label ?? i + 1)).width)) + 6 * FS) / slot));
  const bw = Math.max(3, Math.min(36, slot * 0.66));
  const y0 = ys(0);
  bars.forEach((b, i) => {
    const si = seriesIndex(b.club, b.series ?? (b.club ? undefined : 0));
    const col = P.series[si];
    const cx = box.l + slot * (i + 0.5);
    const y = ys(b.value * f);
    const top = Math.min(y, y0);
    const hgt = Math.max(1, Math.abs(y - y0));
    if (b.validity === 'low_confidence') {
      if (P.ciAlpha > 0) { ctx.globalAlpha = P.ciAlpha; ctx.fillStyle = col; ctx.fillRect(cx - bw / 2, top, bw, hgt); ctx.globalAlpha = 1; }
      ctx.lineWidth = 1.5;
      dash(ctx, 'low_confidence');
      ctx.strokeStyle = col;
      ctx.strokeRect(cx - bw / 2 + 0.75, top + 0.75, bw - 1.5, Math.max(0.5, hgt - 1.5));
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = col;
      ctx.fillRect(cx - bw / 2, top, bw, hgt);
    }
    let wTop = top; let wBot = top + hgt;
    if (finite(b.lo) && finite(b.hi)) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = P.ink;
      ctx.beginPath();
      const a = ys(b.lo * f); const c = ys(b.hi * f);
      ctx.moveTo(cx, a); ctx.lineTo(cx, c); ctx.moveTo(cx - 4, a); ctx.lineTo(cx + 4, a); ctx.moveTo(cx - 4, c); ctx.lineTo(cx + 4, c);
      ctx.stroke();
      wTop = Math.min(wTop, a, c); wBot = Math.max(wBot, a, c);
    }
    if (labels && slot > 26) {
      // beyond the end of the bar and of its whisker cap (3 px clear of the cap, 11 px text)
      const above = b.value >= 0;
      text(ctx, fmtNum(b.value * f, { sign: v0 < 0 }), cx, above ? wTop - 4 : wBot + 13 * FS, { colour: P.ink, align: 'center', font: P.font, size: 11, weight: 600 });
    }
    if (i % every === 0) text(ctx, String(b.label ?? i + 1), cx, box.b + 15 * FS, { colour: P.text, align: 'center', font: P.font, size: 11 });
  });
  ctx.lineWidth = 1;
  ctx.strokeStyle = P.axis;
  ctx.beginPath(); ctx.moveTo(box.l, Math.round(y0) + 0.5); ctx.lineTo(box.r, Math.round(y0) + 0.5); ctx.stroke();
  const shown = bars.map((b) => b.value * f);
  return { a11y: 'viz.bars.alt', params: { n: bars.length, min: fmtNum(Math.min(...shown), { sign: v0 < 0 }), max: fmtNum(Math.max(...shown), { sign: v0 < 0 }), unit } };
}

function statsOf(g) {
  if (g.stats && ['p10', 'q1', 'median', 'q3', 'p90'].every((k) => finite(g.stats[k]))) return { ...g.stats, out: [], n: g.stats.n ?? null };
  const v = (g.values ?? []).filter(finite).sort((a, b) => a - b);
  if (!v.length) return null;
  const s = { p10: quantile(v, 0.1), q1: quantile(v, 0.25), median: quantile(v, 0.5), q3: quantile(v, 0.75), p90: quantile(v, 0.9), n: v.length };
  s.out = v.filter((x) => x < s.p10 || x > s.p90);
  return s;
}

export function drawBox(canvas, opts = {}) {
  const P = opts.palette;
  const { ctx, w, h } = setup(canvas, P);
  const { f, unit } = scaleOf(opts);
  const rows = (opts.groups ?? []).map((g) => ({ g, s: g ? statsOf(g) : null })).filter((r) => r.s);
  if (!rows.length) {
    text(ctx, t('viz.box.empty'), w / 2, h / 2, { colour: P.text, align: 'center', font: P.font, size: 13 });
    return { a11y: 'viz.box.empty', params: { groups: 0, n: 0 } };
  }
  const all = rows.flatMap(({ s }) => [s.p10, s.p90, ...s.out]).map((v) => v * f);
  let v0 = Math.min(...all);
  let v1 = Math.max(...all);
  const pad = Math.max(1, (v1 - v0) * 0.06);
  v0 -= pad; v1 += pad;
  const box = { l: 64 * FS, r: w - 12, t: 8, b: h - TITLE_B * FS };
  const xs = lerpScale(v0, v1, box.l, box.r);
  const xT = ticks(v0, v1, Math.max(3, Math.floor((box.r - box.l) / 70)));
  ctx.lineWidth = 1;
  ctx.strokeStyle = P.grid;
  ctx.beginPath();
  for (const v of xT.list) { const x = Math.round(xs(v)) + 0.5; ctx.moveTo(x, box.t); ctx.lineTo(x, box.b); }
  ctx.stroke();
  // the unit is in the x axis title under the tick row: every tick label stays (one near an edge slides in)
  for (const v of xT.list) tickText(ctx, P, fmtNum(v), xs(v), box.b + 15 * FS, w);
  axisTitleX(ctx, P, box, titleOf(opts, unit));
  const rh = (box.b - box.t) / rows.length;
  const bh = Math.max(6, Math.min(22, rh * 0.55));
  let n = 0;
  rows.forEach(({ g, s }, i) => {
    const si = seriesIndex(g.club, g.series ?? (g.club ? undefined : i));
    const col = P.series[si];
    const cy = box.t + rh * (i + 0.5);
    n += s.n ?? 0;
    text(ctx, String(g.label ?? ''), box.l - 8, cy + 4 * FS, { colour: P.text, align: 'right', font: P.font, size: 12, weight: 600 });
    ctx.setLineDash([]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.moveTo(xs(s.p10 * f), cy); ctx.lineTo(xs(s.q1 * f), cy);
    ctx.moveTo(xs(s.q3 * f), cy); ctx.lineTo(xs(s.p90 * f), cy);
    for (const v of [s.p10, s.p90]) { ctx.moveTo(xs(v * f), cy - bh / 3); ctx.lineTo(xs(v * f), cy + bh / 3); }
    ctx.stroke();
    const x1 = xs(s.q1 * f);
    const bw = Math.max(2, xs(s.q3 * f) - x1);
    if (P.ciAlpha > 0) { ctx.globalAlpha = Math.min(1, P.ciAlpha * 2.2); ctx.fillStyle = col; ctx.fillRect(x1, cy - bh / 2, bw, bh); ctx.globalAlpha = 1; }
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = col;
    ctx.strokeRect(x1, cy - bh / 2, bw, bh);
    ctx.lineWidth = 3;
    ctx.strokeStyle = P.ink;
    ctx.beginPath(); ctx.moveTo(xs(s.median * f), cy - bh / 2 - 2); ctx.lineTo(xs(s.median * f), cy + bh / 2 + 2); ctx.stroke();
    for (const v of s.out) glyph(ctx, P.seriesGlyph[si], xs(v * f), cy, 2.5, col, null);
  });
  return { a11y: 'viz.box.alt', params: { groups: rows.length, n, unit } };
}
