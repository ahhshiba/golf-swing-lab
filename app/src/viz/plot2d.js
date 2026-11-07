// viz/plot2d.js — side view (x × z) and top-down dispersion (x × y) of ball flights (LAUNCH-MONITOR-SPEC §3.2, §3.7,
// §4.2; docs/viz.md §3–4). Inputs are numbers in metres (mat frame: x down the target line, y toward a right-handed
// golfer, z up); output is a canvas and { a11y: 'viz.<key>', params } for the role=img aria-label.
//
//   drawSide(canvas, { flights: [{ samples, club, validity, band, sigma?, rest?, series? }], units, palette, target_m? })
//     sigma = { carry, apex } (1σ, m): the light ±1σ band (fill at --viz-ci-alpha; outline in sun where alpha = 0)
//   drawTop(canvas, { points: [{ x, y | null, sx, sy, club, validity, band?, series? }], units, palette, target?,
//                     paths?: [{ samples, club, validity }] })
//     points with y = null (face_on: left/right not observable) never share the plane with the others: they go to a
//     separate distance-only strip marked "?" (§3.7); when no point has a side, the strip is the whole chart (§3.2).
import { t, fmtNum } from '../i18n/index.js';
import { seriesIndex } from './palette.js';
import { setup, distUnit, unitText, ticks, lerpScale, dash, text, glyph, thin, finite, axisTitleX, axisTitleY, tickText, TITLE_B, FS } from './draw.js';

const MAX = 200;
const okSamples = (s) => Array.isArray(s) && s.length >= 2 && s.every((p) => Array.isArray(p) && p.length >= 4 && p.every(finite));

function axisFrame(ctx, P, box, xs, ys, xT, yT, unitKey, o = {}) {
  const font = P.font;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeStyle = P.grid;
  ctx.beginPath();
  for (const v of xT.list) { const x = Math.round(xs(v)) + 0.5; ctx.moveTo(x, box.t); ctx.lineTo(x, box.b); }
  for (const v of yT.list) { const y = Math.round(ys(v)) + 0.5; ctx.moveTo(box.l, y); ctx.lineTo(box.r, y); }
  ctx.stroke();
  ctx.strokeStyle = P.axis;
  ctx.beginPath();
  const y0 = Math.round(ys(o.baseline ?? 0)) + 0.5;
  ctx.moveTo(box.l, y0); ctx.lineTo(box.r, y0);
  ctx.stroke();
  if (!o.noX) xLabels(ctx, P, box, xs, xT, box.b, unitKey);
  for (const v of yT.list) {
    if (o.skipY0 && v === 0) continue;
    text(ctx, fmtNum(Math.abs(v)), box.l - 6, ys(v) + 4 * FS, { colour: P.text, align: 'right', font, size: 11 });
  }
  // the units live in the axis titles (distance under the ticks, height / side above the label column): no tick is left out
  if (o.yTitle) axisTitleY(ctx, P, box, o.yTitle);
}

/** Tick labels under the x axis (every one is drawn; one near an edge slides in) and the x axis title with the unit. */
function xLabels(ctx, P, box, xs, xT, y, unitKey) {
  for (const v of xT.list) tickText(ctx, P, fmtNum(v), xs(v), y + 14 * FS, box.r + 12);
  axisTitleX(ctx, P, { ...box, b: y }, t('viz.axis.distance', { unit: unitText(unitKey) }));
}

/** Side view: x (distance) × z (height). Hero chart of the results page. */
export function drawSide(canvas, opts = {}) {
  const P = opts.palette;
  const { ctx, w, h } = setup(canvas, P);
  const { f, key } = distUnit(opts.units);
  const { list, sampled } = thin((opts.flights ?? []).filter((fl) => fl && okSamples(fl.samples)), MAX);
  const n = list.length;
  if (!n) {
    text(ctx, t('viz.side.empty'), w / 2, h / 2, { colour: P.text, align: 'center', font: P.font, size: 13 });
    return { a11y: 'viz.side.empty', params: { n: 0 } };
  }
  let maxX = 0;
  let maxZ = 0;
  for (const fl of list) {
    const sc = fl.sigma?.carry ?? 0;
    const sa = fl.sigma?.apex ?? 0;
    const last = fl.samples[fl.samples.length - 1][1];
    const apex = Math.max(...fl.samples.map((p) => p[3]));
    maxX = Math.max(maxX, last + Math.max(0, sc), fl.rest?.x_m ?? 0);
    maxZ = Math.max(maxZ, apex + Math.max(0, sa));
  }
  if (finite(opts.target_m)) maxX = Math.max(maxX, opts.target_m);
  const dX = Math.max(10, maxX * f * 1.06);
  const dZ = Math.max(5, maxZ * f * 1.3);
  const box = { l: 36 * FS, r: w - 12, t: 8 + 15 * FS, b: h - TITLE_B * FS };
  const xs = lerpScale(0, dX, box.l, box.r);
  const zs = lerpScale(0, dZ, box.b, box.t);
  const X = (m) => xs(m * f);
  const Z = (m) => zs(m * f);
  axisFrame(ctx, P, box, xs, zs, ticks(0, dX, Math.max(3, Math.floor((box.r - box.l) / 70))), ticks(0, dZ, 3), key, { skipY0: true, yTitle: t('viz.axis.height', { unit: unitText(key) }) });

  if (finite(opts.target_m)) {
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = P.target;
    ctx.beginPath(); ctx.moveTo(X(opts.target_m), box.b); ctx.lineTo(X(opts.target_m), box.t + 12 * FS); ctx.stroke();
    text(ctx, t('viz.target'), X(opts.target_m), box.t + 9 * FS, { colour: P.target, align: 'center', font: P.font, size: 11, weight: 700 });
  }

  const one = n === 1;
  const lw = one ? 3 : n > 40 ? 1.25 : 2;
  let low = 0;
  const carries = [];
  for (const fl of list) {
    const si = seriesIndex(fl.club, fl.series);
    const col = P.series[si];
    const S = fl.samples;
    const last = S[S.length - 1];
    carries.push(last[1]);
    const C = last[1] || 1;
    const A = Math.max(...S.map((p) => p[3])) || 1;
    const sc = fl.sigma?.carry;
    const sa = fl.sigma?.apex;
    if (finite(sc) && finite(sa) && n <= 12) {
      const hi = S.map((p) => [X(p[1] * (1 + sc / C)), Z(p[3] * (1 + sa / A))]);
      const lo = S.map((p) => [X(p[1] * Math.max(0, 1 - sc / C)), Z(p[3] * Math.max(0, 1 - sa / A))]);
      ctx.beginPath();
      hi.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      for (let i = lo.length - 1; i >= 0; i--) ctx.lineTo(lo[i][0], lo[i][1]);
      ctx.closePath();
      if (P.ciAlpha > 0) {
        ctx.globalAlpha = P.ciAlpha;
        ctx.fillStyle = col;
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        ctx.strokeStyle = col;
        ctx.stroke();
      }
    }
    if (one && P.ciAlpha > 0) {
      ctx.beginPath();
      S.forEach((p, i) => (i ? ctx.lineTo(X(p[1]), Z(p[3])) : ctx.moveTo(X(p[1]), Z(p[3]))));
      ctx.lineTo(X(last[1]), Z(0));
      ctx.closePath();
      ctx.globalAlpha = P.ciAlpha * 0.4;
      ctx.fillStyle = col;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (fl.validity === 'low_confidence') low++;
    ctx.lineWidth = lw;
    dash(ctx, fl.validity);
    ctx.strokeStyle = col;
    if (one && P.dark) { ctx.shadowColor = col; ctx.shadowBlur = 10; }
    ctx.beginPath();
    S.forEach((p, i) => (i ? ctx.lineTo(X(p[1]), Z(p[3])) : ctx.moveTo(X(p[1]), Z(p[3]))));
    ctx.stroke();
    ctx.shadowBlur = 0;
    if (fl.rest && finite(fl.rest.x_m) && fl.rest.x_m > last[1]) {
      ctx.lineWidth = Math.max(1.5, lw - 0.5);
      dash(ctx, 'simulated');
      ctx.beginPath(); ctx.moveTo(X(last[1]), Z(0) - 1); ctx.lineTo(X(fl.rest.x_m), Z(0) - 1); ctx.stroke();
    }
    glyph(ctx, P.seriesGlyph[si], X(last[1]), Z(0), one ? 5 : n > 40 ? 2.5 : 3.5, col, P.bg);
  }
  ctx.setLineDash([]);

  const u = unitText(key);
  if (one) {
    const S = list[0].samples;
    const ia = S.reduce((b, p, i) => (p[3] > S[b][3] ? i : b), 0);
    const ax = X(S[ia][1]);
    const az = Z(S[ia][3]);
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = P.axis;
    ctx.beginPath(); ctx.moveTo(ax, az + 6); ctx.lineTo(ax, Z(0)); ctx.stroke();
    ctx.setLineDash([]);
    const apex = fmtNum(S[ia][3] * f);
    text(ctx, `${t('viz.side.apex')} ${apex} ${u}`, ax, az - 8, { colour: P.ink, align: 'center', font: P.font, size: 12, weight: 600, halo: P.bg });
    const carry = fmtNum(S[S.length - 1][1] * f);
    const cx = Math.min(X(S[S.length - 1][1]), box.r - 4);
    // up and to the left of the landing dot: clear of the roll line (right) and of the tick labels (below the axis)
    text(ctx, carry, cx - 12, Z(0) - 16, { colour: P.ink, align: 'right', font: P.font, size: 18, weight: 700, halo: P.bg });
    const lowFl = list[0].validity === 'low_confidence';
    return { a11y: lowFl ? 'viz.side.one_low' : 'viz.side.one', params: { n: 1, carry, apex, unit: u } };
  }
  const params = { n: (opts.flights ?? []).length, shown: n, min: fmtNum(Math.min(...carries) * f), max: fmtNum(Math.max(...carries) * f), unit: u, low };
  return { a11y: sampled ? 'viz.side.many_sampled' : 'viz.side.many', params };
}

function ellipse(ctx, cx, cy, rx, ry, rot, col, P, validity) {
  if (!(rx > 0.5 && ry > 0.5)) return;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
  if (P.ciAlpha > 0) {
    ctx.globalAlpha = P.ciAlpha;
    ctx.fillStyle = col;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.lineWidth = 1.5;
  dash(ctx, validity);
  ctx.strokeStyle = col;
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Per-club 1σ ellipse from the point cloud (covariance eigen-decomposition), in metres. */
export function cloudEllipse(pts) {
  const n = pts.length;
  if (n < 3) return null;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let a = 0; let b = 0; let c = 0;
  for (const p of pts) { a += (p.x - mx) ** 2; b += (p.x - mx) * (p.y - my); c += (p.y - my) ** 2; }
  a /= n - 1; b /= n - 1; c /= n - 1;
  const tr = (a + c) / 2;
  const d = Math.sqrt(Math.max(0, ((a - c) / 2) ** 2 + b * b));
  return { x: mx, y: my, r1: Math.sqrt(Math.max(0, tr + d)), r2: Math.sqrt(Math.max(0, tr - d)), rot: 0.5 * Math.atan2(2 * b, a - c) };
}

/** flight.band ({ side_lo, side_hi }: the two halves of the ±1σ landing outline) or a plain [[x, y]…] polygon. */
const bandPoly = (b) => (Array.isArray(b) ? b : b ? [...(b.side_lo ?? []), ...(b.side_hi ?? [])] : []).filter((q) => Array.isArray(q) && finite(q[0]) && finite(q[1]));

/** Top-down dispersion: x (distance, left → right) × y (side; +y, toward the golfer's side, is up). */
export function drawTop(canvas, opts = {}) {
  const P = opts.palette;
  const { ctx, w, h } = setup(canvas, P);
  const { f, key } = distUnit(opts.units);
  const all = (opts.points ?? []).filter((p) => p && finite(p.x));
  const { list, sampled } = thin(all, MAX);
  const plane = list.filter((p) => finite(p.y));
  const strip = list.filter((p) => !finite(p.y));
  const u = unitText(key);
  const paths = (opts.paths ?? []).filter((p) => p && okSamples(p.samples));
  if (!list.length && !paths.length) {
    text(ctx, t('viz.top.empty'), w / 2, h / 2, { colour: P.text, align: 'center', font: P.font, size: 13 });
    return { a11y: 'viz.top.empty', params: { n: 0, n_plane: 0, n_strip: 0 } };
  }
  const tgt = finite(opts.target) ? { x: opts.target } : opts.target && finite(opts.target.x) ? opts.target : null;
  let maxX = Math.max(10, ...list.map((p) => p.x + (finite(p.sx) ? p.sx : 0)), ...paths.map((p) => p.samples[p.samples.length - 1][1]));
  if (tgt) maxX = Math.max(maxX, tgt.x);
  let maxY = 8;
  for (const p of plane) maxY = Math.max(maxY, Math.abs(p.y) + (finite(p.sy) ? 1.2 * p.sy : 0));
  for (const p of plane) for (const q of bandPoly(p.band)) if (finite(q?.[1])) maxY = Math.max(maxY, Math.abs(q[1]));
  for (const p of paths) for (const s of p.samples) maxY = Math.max(maxY, Math.abs(s[2]));
  const dX = maxX * f * 1.06;
  const dY = maxY * f * 1.15;
  const onlyStrip = !plane.length && !paths.length;
  const stripH = strip.length ? (onlyStrip ? Math.min(120, h - (TITLE_B + 18) * FS) : Math.max(44 * FS, h * 0.24)) : 0;
  const box = { l: 36 * FS, r: w - 12, t: onlyStrip ? 12 : 8 + 15 * FS, b: h - TITLE_B * FS };
  const xs = lerpScale(0, dX, box.l, box.r);
  const X = (m) => xs(m * f);
  const xT = ticks(0, dX, Math.max(3, Math.floor((box.r - box.l) / 70)));
  const planeB = box.b - (stripH ? stripH + (onlyStrip ? 0 : 10) : 0);
  let Y = null;

  if (!onlyStrip) {
    const ys = lerpScale(-dY, dY, planeB, box.t);
    Y = (m) => ys(m * f);
    const pbox = { ...box, b: planeB };
    axisFrame(ctx, P, pbox, xs, ys, xT, ticks(-dY, dY, 4), key, { baseline: 0, noX: strip.length > 0, yTitle: t('viz.axis.side', { unit: u }) });
    // +y is the golfer's side = left of the target line seen from behind the ball
    text(ctx, t('viz.top.left'), box.l + 4, box.t + 11 * FS, { colour: P.text, font: P.font, size: 11, weight: 700 });
    text(ctx, t('viz.top.right'), box.l + 4, planeB - 5, { colour: P.text, font: P.font, size: 11, weight: 700 });
    for (const p of paths) {
      const si = seriesIndex(p.club, p.series);
      ctx.lineWidth = paths.length === 1 ? 2.5 : 1.5;
      dash(ctx, p.validity);
      ctx.strokeStyle = P.series[si];
      ctx.beginPath();
      p.samples.forEach((s, i) => (i ? ctx.lineTo(X(s[1]), Y(s[2])) : ctx.moveTo(X(s[1]), Y(s[2]))));
      ctx.stroke();
    }
    const big = plane.length <= 3;
    const byClub = new Map();
    for (const p of plane) {
      const si = seriesIndex(p.club, p.series);
      if (!byClub.has(si)) byClub.set(si, []);
      byClub.get(si).push(p);
      if (!big) continue;
      const col = P.series[si];
      const poly = bandPoly(p.band);
      if (poly.length >= 3) {
        ctx.beginPath();
        poly.forEach((q, i) => (i ? ctx.lineTo(X(q[0]), Y(q[1])) : ctx.moveTo(X(q[0]), Y(q[1]))));
        ctx.closePath();
        if (P.ciAlpha > 0) { ctx.globalAlpha = P.ciAlpha; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1; }
        ctx.lineWidth = 1.5; dash(ctx, p.validity); ctx.strokeStyle = col; ctx.stroke(); ctx.setLineDash([]);
      } else if (finite(p.sx) && finite(p.sy)) {
        ellipse(ctx, X(p.x), Y(p.y), Math.abs(xs(p.sx * f) - xs(0)), Math.abs(Y(p.sy) - Y(0)), 0, col, P, p.validity);
      }
    }
    if (!big) {
      for (const [si, pts] of byClub) {
        const e = cloudEllipse(pts);
        if (!e) continue;
        const kx = Math.abs(xs(f) - xs(0));
        const ky = Math.abs(Y(1) - Y(0));
        // the ellipse lives in metres; scale its axes into the (non-uniform) pixel frame
        const ang = Math.atan2(Math.sin(e.rot) * ky, Math.cos(e.rot) * kx);
        const r1 = Math.hypot(Math.cos(e.rot) * e.r1 * kx, Math.sin(e.rot) * e.r1 * ky);
        const r2 = Math.hypot(Math.sin(e.rot) * e.r2 * kx, Math.cos(e.rot) * e.r2 * ky);
        ellipse(ctx, X(e.x), Y(e.y), r1, r2, -ang, P.series[si], P, 'estimated');
      }
    }
    for (const p of plane) {
      const si = seriesIndex(p.club, p.series);
      glyph(ctx, P.seriesGlyph[si], X(p.x), Y(p.y), big ? 5 : 3.5, P.series[si], P.bg);
    }
  }

  if (strip.length) {
    const sT = onlyStrip ? box.t + Math.max(0, (box.b - box.t - stripH) / 2) : planeB + 10; // strip only: centred in the chart
    const sB = sT + stripH;
    const mid = (sT + sB) / 2;
    if (onlyStrip) axisFrame(ctx, P, { ...box, t: sT, b: sB }, xs, () => mid, xT, { list: [] }, key, { baseline: 0 });
    // the "left/right unknown" band: hatched, never a filled plane (§3.2)
    ctx.save();
    ctx.beginPath(); ctx.rect(box.l, sT, box.r - box.l, sB - sT); ctx.clip();
    ctx.lineWidth = 1;
    ctx.strokeStyle = P.grid;
    ctx.beginPath();
    for (let x = box.l - (sB - sT); x < box.r; x += 9) { ctx.moveTo(x, sB); ctx.lineTo(x + (sB - sT), sT); }
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = P.axis;
    ctx.strokeRect(box.l + 0.5, sT + 0.5, box.r - box.l - 1, sB - sT - 1);
    ctx.setLineDash([]);
    if (!onlyStrip) {
      ctx.beginPath(); ctx.moveTo(box.l, mid); ctx.lineTo(box.r, mid); ctx.strokeStyle = P.axis; ctx.stroke();
      xLabels(ctx, P, box, xs, xT, sB, key);
    }
    text(ctx, '?', box.l - 8, mid + 6 * FS, { colour: P.text, align: 'right', font: P.font, size: 18, weight: 800 });
    text(ctx, t('viz.top.strip_label'), box.l + 6, sT + 14 * FS, { colour: P.text, font: P.font, size: 11, weight: 600, halo: P.bg });
    const big = strip.length <= 3;
    for (const p of strip) {
      const si = seriesIndex(p.club, p.series);
      const col = P.series[si];
      if (finite(p.sx) && p.sx > 0) {
        ctx.lineWidth = big ? 2 : 1;
        dash(ctx, p.validity);
        ctx.strokeStyle = col;
        const a = X(p.x - p.sx); const b = X(p.x + p.sx); const e = big ? 6 : 3;
        ctx.beginPath();
        ctx.moveTo(a, mid); ctx.lineTo(b, mid);
        ctx.moveTo(a, mid - e); ctx.lineTo(a, mid + e); ctx.moveTo(b, mid - e); ctx.lineTo(b, mid + e);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      glyph(ctx, P.seriesGlyph[si], X(p.x), mid, big ? 5 : 3, col, P.bg);
    }
  }

  if (tgt) {
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = P.target;
    ctx.beginPath(); ctx.moveTo(X(tgt.x), box.t); ctx.lineTo(X(tgt.x), box.b); ctx.stroke();
    ctx.setLineDash([]);
    if (Y && finite(tgt.y)) glyph(ctx, 'plus', X(tgt.x), Y(tgt.y), 7, P.target, P.bg);
  }

  const params = { n: all.length, shown: list.length, n_plane: plane.length, n_strip: strip.length, unit: u, sampled };
  if (list.length === 1) {
    const p = list[0];
    params.x = fmtNum(p.x * f);
    if (!plane.length) return { a11y: 'viz.top.one_unknown', params };
    params.side = Math.abs(p.y * f) < 0.5 ? t('viz.dir.center') : t(p.y > 0 ? 'viz.dir.left' : 'viz.dir.right', { v: fmtNum(Math.abs(p.y * f)), unit: u });
    return { a11y: 'viz.top.one', params };
  }
  if (!list.length) return { a11y: 'viz.top.path', params };
  return { a11y: sampled ? 'viz.top.many_sampled' : 'viz.top.many', params };
}
