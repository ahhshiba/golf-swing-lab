// course/draw2d.js — top-down hole map on a Canvas 2D (V04-SPEC §C.4). Lazy. Owner V4-D.
// Filled polygons with a texture per area so colour is never the only carrier: fairway mowing stripes, rough plain,
// bunker dots, water ripples, tree discs with a tree glyph, OB hatching; sun theme adds a 2 px outline. Strokes are drawn
// as flight (solid) + roll (dashed) with the 95 % landing ellipse of every stroke that has an uncertainty, the rest as a
// filled dot; the next shot's aim line, its P10–P90 carry band and its 95 % ellipse; every player's ball.
// Colours only from course/palette.js. Distances in the a11y text use the user's units.
//
//   drawHole2d(canvas, { hole, strokes, ellipse, aim, palette, units, …extras }) -> { a11y, params, view }   (FROZEN + extras)
//     extras: focus 'hole'|'green'|[[x,y]…] (points to fit), from {x,y} (ball of the shot being aimed), band {p10,p90},
//             balls [{ x, y, player: index, current }] (marker colour AND shape by index: PLAYER_SHAPES circle / square /
//             triangle / diamond, as the .player-swatch legend), players (round.players, colour by index), progress (0–1: the last
//             stroke drawn up to this fraction: landing animation), labels { simulated }
//     params: { ellipse: boolean (a 95 % ellipse is on the map), ellipses: n, source: carry source of the last stroke
//             (sourceKind) | null, side: side source | null, strokes: n, aim: boolean, hole: n }
//     view:   { k, toPx(x, y) -> [px, py], toWorld(px, py) -> [x, y] } in CSS pixels
//   sourceKind(stroke) -> 'manual'|'auto'|'penalty'|'gapping'|'reference'|'estimated'   (carry)
//   sideKind(stroke)   -> 'manual'|'auto'|'penalty'|'sampled'|'straight'|'estimated'   (left / right)
//   strokeSigmas(stroke) -> { carry: σ|null, side: σ|null } (m)     fitView(points, w, h, pad) -> view

import { t } from '../i18n/index.js';
import { fmtQuantity } from '../i18n/units.js';
import { clubName } from '../ui/glossary.js';
import { RC } from '../contract/reason-codes.js';
import { ELLIPSE_K95 } from '../sim/params.js';

const has = (v, code) => (v?.reason_codes ?? []).includes(code);
const sig = (v) => {
  if (!v) return null;
  if (typeof v.sigma === 'number' && v.sigma > 0) return v.sigma;
  if (Array.isArray(v.ci95) && v.ci95.every(Number.isFinite) && v.ci95[1] > v.ci95[0]) return (v.ci95[1] - v.ci95[0]) / 3.92;
  return null;
};

export function sourceKind(s) {
  if (!s) return null;
  if (s.source === 'manual' || s.carry?.origin === 'manual') return 'manual';
  if (s.source === 'auto_putt' || s.source === 'auto_chip') return 'auto';
  if (s.source === 'penalty' || s.source === 'pickup') return 'penalty';
  if (s.carry?.origin === 'prior') return has(s.carry, RC.GAPPING_PRIOR) ? 'gapping' : 'reference';
  return 'estimated';
}

export function sideKind(s) {
  if (!s) return null;
  if (s.source === 'manual' || s.side?.origin === 'manual') return 'manual';
  if (s.source === 'auto_putt' || s.source === 'auto_chip') return 'auto';
  if (s.source === 'penalty' || s.source === 'pickup') return 'penalty';
  if (has(s.side, RC.SIDE_SAMPLED)) return 'sampled';
  if (s.side?.origin === 'prior') return 'straight';
  return 'estimated';
}

export function strokeSigmas(s) {
  return { carry: sig(s?.carry), side: sig(s?.side) };
}

/** A view that fits the points (world metres) into w × h CSS px with `pad` px margins; y up in the world. */
export function fitView(points, w, h, pad = 12) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (!(x1 >= x0)) { x0 = -50; x1 = 50; y0 = 0; y1 = 100; }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const k = Math.min((w - 2 * pad) / Math.max(1, x1 - x0), (h - 2 * pad) / Math.max(1, y1 - y0));
  return {
    k, cx, cy, w, h,
    toPx: (x, y) => [w / 2 + (x - cx) * k, h / 2 - (y - cy) * k],
    toWorld: (px, py) => [cx + (px - w / 2) / k, cy - (py - h / 2) / k],
  };
}

function focusPoints(hole, focus, extra) {
  if (Array.isArray(focus)) return focus;
  if (focus === 'green') {
    const pts = [...hole.green.poly];
    const [px, py] = hole.pin;
    const r = 22;
    pts.push([px - r, py - r], [px + r, py + r]);
    for (const p of extra) if (Math.hypot(p[0] - px, p[1] - py) < 60) pts.push(p);
    return pts;
  }
  return hole.bounds;
}

function sizeCanvas(canvas) {
  const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(canvas.clientWidth || canvas.width || 300));
  const h = Math.max(1, Math.round(canvas.clientHeight || canvas.height || 400));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  return { w, h, dpr };
}

function path(ctx, v, poly) {
  ctx.beginPath();
  poly.forEach(([x, y], i) => {
    const [px, py] = v.toPx(x, y);
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  });
  ctx.closePath();
}

function texture(ctx, v, poly, draw) {
  ctx.save();
  path(ctx, v, poly);
  ctx.clip();
  draw();
  ctx.restore();
}

function areas(ctx, v, hole, pal) {
  const { w, h } = v;
  // OB: everything outside the bounds, grey with a diagonal hatch
  ctx.fillStyle = pal.ob;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = pal.halo;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let d = -h; d < w; d += 10) { ctx.moveTo(d, h); ctx.lineTo(d + h, 0); }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = pal.rough;
  path(ctx, v, hole.bounds);
  ctx.fill();
  // fairway with mowing stripes across the hole
  for (const f of hole.fairway) {
    ctx.fillStyle = pal.fairway;
    path(ctx, v, f);
    ctx.fill();
    texture(ctx, v, f, () => {
      ctx.fillStyle = pal.green;
      ctx.globalAlpha = 0.14;
      const step = Math.max(6, 12 * v.k);
      for (let y = 0; y < h; y += 2 * step) ctx.fillRect(0, y, w, step);
      ctx.globalAlpha = 1;
    });
  }
  ctx.fillStyle = pal.green;
  path(ctx, v, hole.green.poly);
  ctx.fill();
  for (const b of hole.bunkers) {
    ctx.fillStyle = pal.bunker;
    path(ctx, v, b);
    ctx.fill();
    texture(ctx, v, b, () => {
      ctx.fillStyle = pal.halo;
      ctx.globalAlpha = 0.35;
      for (let y = 2; y < h; y += 5) for (let x = (y % 10 ? 4 : 1.5); x < w; x += 5) ctx.fillRect(x, y, 1.4, 1.4);
      ctx.globalAlpha = 1;
    });
  }
  for (const wtr of hole.water) {
    ctx.fillStyle = pal.water;
    path(ctx, v, wtr);
    ctx.fill();
    texture(ctx, v, wtr, () => {
      ctx.strokeStyle = pal.text;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = 4; y < h; y += 9) for (let x = (y % 18 ? 0 : 6); x < w; x += 12) { ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 3, y - 3, x + 6, y); }
      ctx.stroke();
      ctx.globalAlpha = 1;
    });
  }
  if (pal.outlined) {
    ctx.strokeStyle = pal.outline;
    ctx.lineWidth = 2;
    for (const p of [hole.bounds, ...hole.fairway, hole.green.poly, ...hole.bunkers, ...hole.water]) { path(ctx, v, p); ctx.stroke(); }
  }
  // trees: a dark disc + a light tree glyph (never colour alone)
  for (const [x, y, r] of hole.trees) {
    const [px, py] = v.toPx(x, y);
    const rr = Math.max(2.5, r * v.k);
    ctx.fillStyle = pal.tree;
    ctx.beginPath();
    ctx.arc(px, py, rr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = pal.fairway;
    ctx.lineWidth = 1;
    ctx.stroke();
    if (rr >= 4) {
      ctx.strokeStyle = pal.green;
      ctx.beginPath();
      ctx.moveTo(px - rr * 0.45, py + rr * 0.3);
      ctx.lineTo(px, py - rr * 0.5);
      ctx.lineTo(px + rr * 0.45, py + rr * 0.3);
      ctx.moveTo(px, py + rr * 0.3);
      ctx.lineTo(px, py + rr * 0.55);
      ctx.stroke();
    }
  }
}

function teeAndPin(ctx, v, hole, pal, tees) {
  const tee = hole.tees[tees] ?? hole.tees.middle;
  const [tx, ty] = v.toPx(tee[0], tee[1]);
  ctx.fillStyle = pal.text;
  ctx.strokeStyle = pal.halo;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(tx - 5, ty - 3, 10, 6);
  ctx.stroke();
  ctx.fill();
  const [px, py] = v.toPx(hole.pin[0], hole.pin[1]);
  // flag: pole + pennant, outlined in the map's light ink so it reads on any area
  ctx.lineWidth = 4;
  ctx.strokeStyle = pal.text;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px, py - 18);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = pal.pin;
  ctx.stroke();
  ctx.fillStyle = pal.pin;
  ctx.beginPath();
  ctx.moveTo(px, py - 18);
  ctx.lineTo(px + 11, py - 14);
  ctx.lineTo(px, py - 10);
  ctx.closePath();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = pal.text;
  ctx.stroke();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(px, py, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function ellipseAt(ctx, v, x, y, along, across, ux, uy) {
  const [px, py] = v.toPx(x, y);
  ctx.beginPath();
  ctx.ellipse(px, py, Math.max(2, along * v.k), Math.max(2, across * v.k), Math.atan2(-uy, ux), 0, Math.PI * 2);
}

function unit(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  return L > 0 ? [dx / L, dy / L] : [0, 1];
}

function line(ctx, v, pts, colour, width, halo, dash = null) {
  const draw = (c, w) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = w;
    ctx.setLineDash(dash ?? []);
    ctx.beginPath();
    pts.forEach(([x, y], i) => { const [px, py] = v.toPx(x, y); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.stroke();
  };
  if (halo) draw(halo, width + 2.5);
  draw(colour, width);
  ctx.setLineDash([]);
}

/** Ball marker shape per player index (not colour only, WCAG 1.4.1): matches .player-swatch[data-p] in sim.css. */
export const PLAYER_SHAPES = Object.freeze(['circle', 'square', 'triangle', 'diamond']);
export const playerShape = (k) => PLAYER_SHAPES[(Number.isInteger(k) && k >= 0 ? k : 0) % PLAYER_SHAPES.length];

function dot(ctx, v, x, y, r, fill, ring, shape = 'circle') {
  const [px, py] = v.toPx(x, y);
  ctx.beginPath();
  if (shape === 'square') {
    const a = r * 0.9;
    ctx.rect(px - a, py - a, 2 * a, 2 * a);
  } else if (shape === 'triangle') {
    const a = r * 1.25;
    ctx.moveTo(px, py - a); ctx.lineTo(px + a * 0.95, py + a * 0.7); ctx.lineTo(px - a * 0.95, py + a * 0.7); ctx.closePath();
  } else if (shape === 'diamond') {
    const a = r * 1.2;
    ctx.moveTo(px, py - a); ctx.lineTo(px + a, py); ctx.lineTo(px, py + a); ctx.lineTo(px - a, py); ctx.closePath();
  } else {
    ctx.arc(px, py, r, 0, Math.PI * 2);
  }
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = ring;
  ctx.stroke();
}

function label(ctx, v, x, y, text, pal) {
  if (!text) return;
  const [px, py] = v.toPx(x, y);
  ctx.font = `600 12px ${pal.font}`;
  ctx.textBaseline = 'middle';
  const wd = ctx.measureText(text).width;
  const lx = Math.min(Math.max(2, px + 9), v.w - wd - 4);
  ctx.lineWidth = 3;
  ctx.strokeStyle = pal.halo;
  ctx.strokeText(text, lx, py - 10);
  ctx.fillStyle = pal.text;
  ctx.fillText(text, lx, py - 10);
}

const dist = (units, m) => fmtQuantity(m, 'distance', units).text;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ hole: object, strokes: object[], ellipse: { x: number, y: number, sx: number, sy: number, angle?: number }|null,
 *   aim: { x: number, y: number }|null, palette: object, units: object }} opts
 * @returns {{ a11y: string, params: object, view: object }}
 */
export function drawHole2d(canvas, opts) {
  const { hole, strokes = [], ellipse = null, aim = null, palette: pal, units, focus = 'hole', from = null, band = null,
    balls = [], players = [], progress = 1, labels = {}, tees = 'middle' } = opts ?? {};
  if (!hole || !pal) throw new TypeError('drawHole2d: hole and palette are required');
  const ctx = canvas.getContext('2d');
  const { w, h, dpr } = sizeCanvas(canvas);
  const extra = balls.map((b) => [b.x, b.y]);
  const v = fitView(focusPoints(hole, focus, extra), w, h, 14);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  areas(ctx, v, hole, pal);
  teeAndPin(ctx, v, hole, pal, tees);

  const idx = (pid) => Math.max(0, players.findIndex((p) => p.player_id === pid));
  const colour = (pid) => pal.players[idx(pid) % pal.players.length];
  let nEll = 0;
  const shown = strokes.filter((s) => s.source !== 'pickup');
  shown.forEach((s, i) => {
    const last = i === shown.length - 1;
    const f = last ? Math.min(1, Math.max(0, progress)) : 1;
    const c = colour(s.player_id);
    const putt = s.club === 'putter';
    const fl = Math.min(1, f / 0.7); // flight first, then the roll
    const lx = s.from.x + (s.landing.x - s.from.x) * fl, ly = s.from.y + (s.landing.y - s.from.y) * fl;
    line(ctx, v, [[s.from.x, s.from.y], [lx, ly]], c, putt ? 1.5 : 2, pal.halo);
    if (f >= 1) {
      const sg = strokeSigmas(s);
      if (!putt && sg.carry && sg.side) {
        const [ux, uy] = unit(s.from, s.aim);
        ellipseAt(ctx, v, s.landing.x, s.landing.y, ELLIPSE_K95 * sg.carry, ELLIPSE_K95 * sg.side, ux, uy);
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = c;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = c;
        ctx.stroke();
        ctx.setLineDash([]);
        nEll++;
      }
      if (s.rest.x !== s.landing.x || s.rest.y !== s.landing.y) line(ctx, v, [[s.landing.x, s.landing.y], [s.rest.x, s.rest.y]], c, 1.5, null, [3, 3]);
    }
  });
  const lastS = shown[shown.length - 1] ?? null;
  if (lastS && progress >= 1 && lastS.club !== 'putter') label(ctx, v, lastS.landing.x, lastS.landing.y, labels.simulated, pal);

  // the shot being aimed: aim line, the P10–P90 carry band, the 95 % ellipse
  if (aim && from) {
    const [ux, uy] = unit(from, aim);
    line(ctx, v, [[from.x, from.y], [aim.x, aim.y]], pal.aim, 1.5, pal.halo, [6, 5]);
    if (band && band.p90 > band.p10) {
      const a0 = Math.atan2(-uy, ux);
      const [fx, fy] = v.toPx(from.x, from.y);
      ctx.strokeStyle = pal.ellipse;
      ctx.lineWidth = 2;
      for (const r of [band.p10, band.p90]) {
        ctx.beginPath();
        ctx.arc(fx, fy, r * v.k, a0 - 0.2, a0 + 0.2);
        ctx.stroke();
      }
    }
    if (ellipse && ellipse.sx > 0 && ellipse.sy > 0) {
      ellipseAt(ctx, v, ellipse.x, ellipse.y, ellipse.sy, ellipse.sx, ux, uy);
      ctx.setLineDash([7, 4]);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = pal.halo;
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = pal.ellipse;
      ctx.stroke();
      ctx.setLineDash([]);
      nEll++;
    }
    const [ax, ay] = v.toPx(aim.x, aim.y);
    ctx.strokeStyle = pal.aim;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ax - 7, ay); ctx.lineTo(ax + 7, ay); ctx.moveTo(ax, ay - 7); ctx.lineTo(ax, ay + 7);
    ctx.stroke();
  }
  for (const b of balls) {
    const c = pal.players[(b.player ?? 0) % pal.players.length];
    const shape = playerShape(b.player ?? 0);
    if (b.current) dot(ctx, v, b.x, b.y, 8, pal.halo, c, shape);
    dot(ctx, v, b.x, b.y, 4.5, c, pal.halo, shape);
  }

  const params = {
    ellipse: nEll > 0, ellipses: nEll, source: sourceKind(lastS), side: sideKind(lastS), strokes: shown.length, aim: Boolean(aim && from), hole: hole.n,
    balls: balls.map((b) => playerShape(b.player ?? 0)),
  };
  const parts = [t('sim.map.a11y', { n: hole.n, par: hole.par, length: dist(units, hole.length_m) })];
  if (lastS) {
    const sg = strokeSigmas(lastS);
    parts.push(t('sim.map.last', {
      club: clubName(lastS.club), carry: dist(units, lastS.carry.value), pm: sg.carry ? dist(units, 1.96 * sg.carry) : '—',
      source: t(`sim.source.${params.source}`), side: t(`sim.source.${params.side}`),
    }));
  }
  if (nEll) parts.push(t('sim.map.ellipses', { n: nEll }));
  const a11y = parts.join(' ');
  canvas.setAttribute?.('role', 'img');
  canvas.setAttribute?.('aria-label', a11y);
  if (canvas.dataset) canvas.dataset.params = JSON.stringify(params);
  return { a11y, params, view: v };
}
