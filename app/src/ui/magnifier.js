// ui/magnifier.js — mat-corner picker on a frozen frame (CAFCR C3 C5 / P1): tap a corner, a 4x magnifier loupe
// appears in the opposite top corner, drag to refine, lift to set. Corners in source-image pixels, ordered
// [tn, ln, lf, tf] (interfaces.md §2). Optional sub-pixel refinement with calib/mat.js refineCorners.

import { h } from './dom.js';
import { refineCorners } from '../calib/mat.js';

export const CORNER_LABELS = Object.freeze(['後側・近端角（tn）', '目標側・近端角（ln）', '目標側・遠端角（lf）', '後側・遠端角（tf）']);
const ZOOM = 4;
const LOUPE_CSS = 132;

/** Draw any CanvasImageSource into a new W×H canvas. */
export function snapshot(source, W, H) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  c.getContext('2d').drawImage(source, 0, 0, W, H);
  return c;
}

/** Grayscale { data: Uint8Array, W, H } of a canvas (Rec. 601 luma). */
export function grayOf(canvas) {
  const { width: W, height: H } = canvas;
  const px = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const data = new Uint8Array(W * H);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) data[i] = (px[j] * 77 + px[j + 1] * 150 + px[j + 2] * 29) >> 8;
  return { data, W, H };
}

/**
 * createCornerPicker({ onChange(corners, info), ghost?: [[u,v]×4] }) ->
 *   { el, setFrame(canvas), setGhost(corners|null), reset(), corners(), refine() -> result|null, frame() }
 */
export function createCornerPicker({ onChange = () => {}, ghost = null } = {}) {
  let frame = null; // source canvas (W×H)
  let corners = [null, null, null, null];
  let active = -1;
  let ghostPts = ghost;
  let edge = null;
  const view = h('canvas.picker-canvas', { 'aria-label': '點選墊子四角' });
  const loupe = h('canvas.loupe', { width: LOUPE_CSS * 2, height: LOUPE_CSS * 2, hidden: true });
  const prompt = h('p.picker-prompt', '');
  const el = h('div.picker', {}, h('div.picker-stage', {}, view, loupe), prompt);

  function next() { return corners.findIndex((c) => c === null); }

  function updatePrompt() {
    const i = active >= 0 ? active : next();
    prompt.textContent = i >= 0 ? `請點：${CORNER_LABELS[i]}（按住拖曳可微調）` : '四角都點好了；可拖曳任何一角重新調整。';
  }

  function draw() {
    if (!frame) return;
    const ctx = view.getContext('2d');
    ctx.drawImage(frame, 0, 0);
    const s = Math.max(2, frame.width / 480);
    if (ghostPts) polygon(ctx, ghostPts, 'rgba(255,255,255,0.9)', s, true);
    const done = corners.filter(Boolean);
    if (done.length === 4) polygon(ctx, corners, 'rgba(0,200,120,0.95)', s, false);
    corners.forEach((c, i) => {
      if (!c) return;
      ctx.fillStyle = i === active ? '#ffcc00' : '#00c878';
      ctx.beginPath();
      ctx.arc(c[0], c[1], 5 * s, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.font = `${10 * s}px sans-serif`;
      ctx.fillText(String(i + 1), c[0] + 6 * s, c[1] - 6 * s);
    });
  }

  function polygon(ctx, pts, color, s, dashed) {
    if (pts.some((p) => !p)) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 * s;
    if (dashed) ctx.setLineDash([6 * s, 4 * s]);
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  function toImage(ev) {
    const r = view.getBoundingClientRect();
    return [((ev.clientX - r.left) / r.width) * frame.width, ((ev.clientY - r.top) / r.height) * frame.height, ev.clientX - r.left, r.width];
  }

  function drawLoupe(u, v, xCss, wCss) {
    loupe.hidden = false;
    loupe.style.left = xCss < wCss / 2 ? '' : '4px';
    loupe.style.right = xCss < wCss / 2 ? '4px' : '';
    const ctx = loupe.getContext('2d');
    const half = loupe.width / (2 * ZOOM);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, loupe.width, loupe.height);
    ctx.drawImage(frame, u - half, v - half, 2 * half, 2 * half, 0, 0, loupe.width, loupe.height);
    ctx.strokeStyle = '#ff3b30';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(loupe.width / 2, 0); ctx.lineTo(loupe.width / 2, loupe.height);
    ctx.moveTo(0, loupe.height / 2); ctx.lineTo(loupe.width, loupe.height / 2);
    ctx.stroke();
  }

  function nearest(u, v) {
    let best = -1;
    let bd = Infinity;
    corners.forEach((c, i) => {
      if (!c) return;
      const d = Math.hypot(c[0] - u, c[1] - v);
      if (d < bd) { bd = d; best = i; }
    });
    return bd < frame.width * 0.06 ? best : -1;
  }

  view.addEventListener('pointerdown', (ev) => {
    if (!frame) return;
    ev.preventDefault();
    view.setPointerCapture?.(ev.pointerId);
    const [u, v, x, w] = toImage(ev);
    const near = nearest(u, v);
    active = near >= 0 ? near : next();
    if (active < 0) return;
    corners[active] = [u, v];
    edge = null;
    drawLoupe(u, v, x, w);
    draw();
    updatePrompt();
  });
  view.addEventListener('pointermove', (ev) => {
    if (active < 0 || !frame) return;
    ev.preventDefault();
    const [u, v, x, w] = toImage(ev);
    corners[active] = [u, v];
    drawLoupe(u, v, x, w);
    draw();
  });
  const end = () => {
    if (active < 0) return;
    loupe.hidden = true;
    active = -1;
    draw();
    updatePrompt();
    onChange(api.corners(), { edge });
  };
  view.addEventListener('pointerup', end);
  view.addEventListener('pointercancel', end);

  const api = {
    el,
    setFrame(canvas) {
      frame = canvas;
      view.width = canvas.width;
      view.height = canvas.height;
      view.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
      draw();
      updatePrompt();
    },
    frame: () => frame,
    setGhost(g) { ghostPts = g; draw(); },
    reset() { corners = [null, null, null, null]; edge = null; draw(); updatePrompt(); onChange(null, { edge }); },
    corners: () => (corners.every(Boolean) ? corners.map((c) => [c[0], c[1]]) : null),
    setCorners(cs) { corners = cs.map((c) => (c ? [c[0], c[1]] : null)); draw(); updatePrompt(); },
    /** Sub-pixel refinement around the tapped corners; keeps the taps when it fails. */
    refine() {
      const cs = api.corners();
      if (!cs || !frame) return null;
      try {
        const r = refineCorners(grayOf(frame), cs);
        if (r?.ok) {
          corners = r.corners.map((c) => [c[0], c[1]]);
          edge = r.max_edge_residual_px;
          draw();
          onChange(api.corners(), { edge, refine: r });
        }
        return r;
      } catch (_) {
        return null;
      }
    },
    edgeResidual: () => edge,
  };
  updatePrompt();
  return api;
}
