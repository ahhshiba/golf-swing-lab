// ui/tripod-diagram.js — top-down diagram of where the tripod goes (setup step 1, UX-02). Inline SVG, styled only by
// the td-* classes in styles/screens/practice.css (tokens), so it follows light / dark / sun.
//
//   tripodDiagram(placement, venue, { doc, labels: { distance, target, you, title } }) -> <svg role="img">
//     placement = session/bay.js tripodPlacement(venue, view); labels are already localized strings.
//   diagramGeometry(placement, venue) -> { pts, map(x, y), box }   pure: world (m) → diagram coordinates (testable)
//
// World: ball at the origin, +x toward the target, +y from the camera-side mat edge toward the golfer (calib/mat.js).
// The camera is always drawn on the left: face-on rotates the world 90° clockwise (target points down), DTL / high
// behind keep it (target to the right, golfer up). Never mirrored, so left/right in the picture stay true.

const NS = 'http://www.w3.org/2000/svg';
const PAD = 0.4;

/** Root font size relative to the 16 px default (1 when unknown), clamped to [1, 2]. */
function textScale() {
  try {
    const px = parseFloat(globalThis.getComputedStyle?.(globalThis.document.documentElement).fontSize);
    return Number.isFinite(px) && px > 0 ? Math.min(2, Math.max(1, px / 16)) : 1;
  } catch (_) { return 1; }
}

export function diagramGeometry(p, venue = {}) {
  const L = Number.isFinite(venue?.mat_L) ? venue.mat_L : 1.5;
  const W = Number.isFinite(venue?.mat_W) ? venue.mat_W : 1.25;
  const be = Number.isFinite(venue?.ball_edge_m) ? venue.ball_edge_m : 0.3;
  const bx = Number.isFinite(venue?.ball_x_m) ? venue.ball_x_m : 0;
  const mat = [[-L / 2 - bx, -be], [L / 2 - bx, -be], [L / 2 - bx, W - be], [-L / 2 - bx, W - be]];
  const faceOn = p.view === 'face_on';
  const cam = faceOn ? [p.side_m, -p.D_m] : [-p.D_m, p.side_m];
  const edgePt = faceOn ? [p.side_m, -be] : [-L / 2 - bx, p.side_m];
  const golfer = [0, Math.min(W - be - 0.15, 0.7)];
  // svg coordinates (y down): face-on (x, y) → (y, x) is a 90° clockwise turn of the math plane; others (x, −y)
  const raw = faceOn ? (x, y) => [y, x] : (x, y) => [x, -y];
  const all = [...mat, cam, golfer, edgePt, faceOn ? [L / 2 + 0.5, 0] : [L / 2 + 0.5, 0]].map(([x, y]) => raw(x, y));
  const minX = Math.min(...all.map((q) => q[0])) - PAD;
  const minY = Math.min(...all.map((q) => q[1])) - PAD;
  const maxX = Math.max(...all.map((q) => q[0])) + PAD;
  const maxY = Math.max(...all.map((q) => q[1])) + PAD;
  const map = (x, y) => { const [u, v] = raw(x, y); return [+(u - minX).toFixed(4), +(v - minY).toFixed(4)]; };
  return { pts: { mat, cam, edgePt, golfer, ball: [0, 0] }, map, box: { w: +(maxX - minX).toFixed(4), h: +(maxY - minY).toFixed(4) }, faceOn, L, bx };
}

export function tripodDiagram(p, venue = {}, { doc = globalThis.document, labels = {} } = {}) {
  const g = diagramGeometry(p, venue);
  const el = (tag, attrs = {}, text) => {
    const e = doc.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const pt = (q) => g.map(q[0], q[1]);
  const svg = el('svg', { viewBox: `0 0 ${g.box.w} ${g.box.h}`, class: 'tripod-diagram', role: 'img', 'aria-label': labels.title ?? '' });
  if (labels.title) svg.append(el('title', {}, labels.title));
  // label size follows the user's text size (Dynamic Type / browser zoom of the root font): 0.17 m at 100 %, up to 2×
  const fs = 0.17 * textScale();
  // mat
  svg.append(el('polygon', { class: 'td-mat', points: g.pts.mat.map((q) => pt(q).join(',')).join(' ') }));
  const bp = pt(g.pts.ball);
  const cp = pt(g.pts.cam);
  // field of view toward the ball
  const vx = bp[0] - cp[0];
  const vy = bp[1] - cp[1];
  const vn = Math.hypot(vx, vy) || 1;
  const half = 0.5; // ≈ 29° half angle (1× lens, landscape)
  const reach = 1.35; // a little past the ball
  const ray = (s) => { const c = Math.cos(s * half); const si = Math.sin(s * half); return [cp[0] + (vx * c - vy * si) * reach, cp[1] + (vx * si + vy * c) * reach]; };
  const r1 = ray(1);
  const r2 = ray(-1);
  svg.append(el('polygon', { class: 'td-fov', points: [cp, r1, r2].map((q) => q.join(',')).join(' ') }));
  // target arrow along +x from the mat's target edge
  const tx0 = g.L / 2 - g.bx + 0.08;
  const a0 = pt([tx0, 0]);
  const a1 = pt([tx0 + 0.42, 0]);
  svg.append(el('line', { class: 'td-target', x1: a0[0], y1: a0[1], x2: a1[0], y2: a1[1] }));
  const dir = [a1[0] - a0[0], a1[1] - a0[1]];
  const n = Math.hypot(dir[0], dir[1]) || 1;
  const ux = dir[0] / n;
  const uy = dir[1] / n;
  const head = [[a1[0], a1[1]], [a1[0] - 0.12 * ux + 0.07 * uy, a1[1] - 0.12 * uy - 0.07 * ux], [a1[0] - 0.12 * ux - 0.07 * uy, a1[1] - 0.12 * uy + 0.07 * ux]];
  svg.append(el('polygon', { class: 'td-target-head', points: head.map((q) => q.join(',')).join(' ') }));
  if (labels.target) {
    const lt = [a1[0] + 0.06 * ux + (g.faceOn ? 0.12 : 0), a1[1] + 0.06 * uy + (g.faceOn ? 0.06 : -0.08)];
    svg.append(el('text', { class: 'td-label', x: lt[0], y: lt[1] + (g.faceOn ? 0.12 : 0), 'font-size': fs, 'text-anchor': g.faceOn ? 'start' : 'end' }, labels.target));
  }
  // golfer (top-down head + shoulders) and ball
  const gp = pt(g.pts.golfer);
  svg.append(el('ellipse', { class: 'td-golfer', cx: gp[0], cy: gp[1], rx: g.faceOn ? 0.16 : 0.26, ry: g.faceOn ? 0.26 : 0.16 }));
  svg.append(el('circle', { class: 'td-golfer-head', cx: gp[0], cy: gp[1], r: 0.1 }));
  if (labels.you) svg.append(el('text', { class: 'td-label', x: gp[0], y: gp[1] + (g.faceOn ? 0 : -0.3), dx: g.faceOn ? 0.32 : 0, 'font-size': fs, 'text-anchor': g.faceOn ? 'start' : 'middle', 'dominant-baseline': 'middle' }, labels.you));
  svg.append(el('circle', { class: 'td-ball', cx: bp[0], cy: bp[1], r: 0.07 }));
  // dimension line: lens to the nearest mat edge
  const ep = pt(g.pts.edgePt);
  const off = g.faceOn ? [0, 0.32] : [0, 0.32];
  const d0 = [cp[0] + off[0], cp[1] + off[1]];
  const d1 = [ep[0] + off[0], ep[1] + off[1]];
  svg.append(el('line', { class: 'td-dim', x1: d0[0], y1: d0[1], x2: d1[0], y2: d1[1] }));
  for (const q of [d0, d1]) svg.append(el('line', { class: 'td-dim', x1: q[0], y1: q[1] - 0.09, x2: q[0], y2: q[1] + 0.09 }));
  svg.append(el('line', { class: 'td-dim-guide', x1: ep[0], y1: ep[1], x2: d1[0], y2: d1[1] }));
  if (labels.distance) svg.append(el('text', { class: 'td-dim-label', x: (d0[0] + d1[0]) / 2, y: d0[1] + 0.24, 'font-size': fs * 1.15, 'text-anchor': 'middle' }, labels.distance));
  // tripod + phone
  svg.append(el('circle', { class: 'td-tripod', cx: cp[0], cy: cp[1], r: 0.16 }));
  const pw = p.orientation === 'landscape' ? 0.07 : 0.07;
  const ph = 0.15;
  const ang = Math.atan2(vy, vx) * 180 / Math.PI;
  svg.append(el('rect', { class: 'td-phone', x: cp[0] - pw / 2, y: cp[1] - ph / 2, width: pw, height: ph, rx: 0.02, transform: `rotate(${ang.toFixed(1)} ${cp[0]} ${cp[1]})` }));
  return svg;
}
