// lab/overlay.js — draws lab/lines.js lines on a replay / composed frame: --overlay-select (reference),
// --overlay-caution (a live line off its reference), outlined in --media-bg (V04-SPEC §E.1). Lazy. Owner V4-F.
// share/compose.js (V4-E) calls it when opts.lines is on.
//
//   drawLines(ctx, lines, { frame, palette, enabled, live? }) -> { drawn: [ids] }
//     lines   = computeLines(...) (reference; points normalised 0…1, scaled to ctx.canvas here)
//     enabled = ids to draw (settings.lab.lines); null / undefined = every non-null line
//     palette = { select, caution, outline } CSS colours; missing ones are read from the canvas element's computed
//               --overlay-select / --overlay-caution / --media-bg (no colour literals in code)
//     live    = optional computeLines(..., frame) result: drawn dashed, in caution when it is off its reference
//     frame   = the frame being shown (informational; the caller passes the live lines of that frame)
//   overlayPalette(el) -> { select, caution, outline } from an element's computed tokens

import { deviates } from './lines.js';

const cssVar = (el, name) => {
  try { return getComputedStyle(el).getPropertyValue(name).trim() || null; } catch (_) { return null; }
};

export function overlayPalette(el) {
  return { select: cssVar(el, '--overlay-select'), caution: cssVar(el, '--overlay-caution'), outline: cssVar(el, '--media-bg') };
}

function path(ctx, line, W, H) {
  const p = line.pts;
  ctx.beginPath();
  if (line.pairs) {
    for (let i = 0; i + 1 < p.length; i += 2) { ctx.moveTo(p[i][0] * W, p[i][1] * H); ctx.lineTo(p[i + 1][0] * W, p[i + 1][1] * H); }
    return;
  }
  ctx.moveTo(p[0][0] * W, p[0][1] * H);
  for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0] * W, p[i][1] * H);
  if (line.closed) ctx.closePath();
}

function stroke(ctx, line, W, H, colour, outline, lw, dashed) {
  ctx.setLineDash?.(dashed ? [lw * 3, lw * 2] : []);
  if (outline) { ctx.strokeStyle = outline; ctx.lineWidth = lw + 3; path(ctx, line, W, H); ctx.stroke(); }
  if (colour) { ctx.strokeStyle = colour; ctx.lineWidth = lw; path(ctx, line, W, H); ctx.stroke(); }
}

export function drawLines(ctx, lines, opts = {}) {
  const { palette = {}, enabled = null, live = null } = opts;
  const el = ctx?.canvas;
  const W = el?.width ?? 0;
  const H = el?.height ?? 0;
  if (!ctx || !(W > 0) || !(H > 0) || !lines) return { drawn: [] };
  const P = { ...(el && typeof getComputedStyle === 'function' ? overlayPalette(el) : {}), ...Object.fromEntries(Object.entries(palette).filter(([, v]) => v)) };
  const on = (id) => !Array.isArray(enabled) || enabled.includes(id);
  const lw = Math.max(2, Math.round(Math.min(W, H) / 220));
  const drawn = [];
  ctx.save?.();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [id, line] of Object.entries(lines)) {
    if (!line?.pts?.length || !on(id)) continue;
    stroke(ctx, line, W, H, P.select, P.outline, lw, false);
    drawn.push(id);
  }
  if (live) {
    for (const [id, line] of Object.entries(live)) {
      if (!line?.pts?.length || !on(id) || id === 'target_line') continue;
      const off = deviates(lines[id], line);
      stroke(ctx, line, W, H, off ? P.caution : P.select, P.outline, Math.max(1.5, lw * 0.75), true);
    }
  }
  ctx.setLineDash?.([]);
  ctx.restore?.();
  return { drawn };
}
