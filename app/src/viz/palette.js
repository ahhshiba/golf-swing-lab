// viz/palette.js — colours for every canvas in viz/** (LAUNCH-MONITOR-SPEC §4.2, §5.0-4; docs/viz.md).
//
//   vizPalette(el) -> { series: [8], seriesGlyph: [8], axis, grid, text, target, ciAlpha, tracer, halo, bg,
//                       ink, font, dark }
//   seriesIndex(club, series?) -> 0..7     GLYPHS (the 8 point shapes, same order as the series colours)
//
// Canvas code never names a colour: every strokeStyle / fillStyle is one of the strings returned here, read from the
// --viz-* tokens (tokens.css) with getComputedStyle, so light / dark / sun and the data-screen dark theme all work.
// `ink` (= --text) is for numbers drawn on a chart; `dark` says the background is dark (decides the soft glow).
import { CLUBS } from '../session/settings.js';

/** Point shape per series (● ■ ▲ ◆ ▼ ✚ ✕ ○), so colour is never the only cue (§4.2). */
export const GLYPHS = Object.freeze(['circle', 'square', 'triangle', 'diamond', 'down', 'plus', 'cross', 'ring']);

const CLUB_ORDER = CLUBS.map((c) => c[0]);

/**
 * Series slot of a club: the CLUBS order (driver → series 1 … sw → series 8). A club type outside CLUBS gets the slot
 * of its nearest neighbour (6i → 7i, 4i → 5i, a wedge → pw / sw, any wood → 3w, any hybrid → hybrid); an explicit
 * `series` number (0-based) wins.
 */
export function seriesIndex(club, series) {
  if (Number.isInteger(series)) return ((series % 8) + 8) % 8;
  const type = typeof club === 'string' ? club : club?.type;
  const i = CLUB_ORDER.indexOf(type);
  if (i >= 0) return i;
  const s = String(type ?? '').toLowerCase();
  const iron = /^(\d)i$/.exec(s);
  if (iron) return +iron[1] <= 5 ? 3 : +iron[1] <= 7 ? 4 : 5;
  if (/w$/.test(s) && /^\d/.test(s)) return 1;
  if (/^\d?h|hybrid|ut/.test(s)) return 2;
  if (/^(gw|aw|\d\d)/.test(s)) return 6;
  if (/^lw/.test(s)) return 7;
  return 7;
}

function luminance(c) {
  const s = String(c).trim();
  let rgb = null;
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (h) {
    const x = h[1].length === 3 ? h[1].split('').map((d) => d + d).join('') : h[1];
    rgb = [0, 2, 4].map((k) => parseInt(x.slice(k, k + 2), 16));
  } else {
    const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(s);
    if (m) rgb = [m[1], m[2], m[3]].map(Number);
  }
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Read the palette from the element's computed style (the element the canvas sits in, or the canvas itself). */
export function vizPalette(el) {
  const view = el?.ownerDocument?.defaultView ?? globalThis;
  let cs = null;
  try { cs = view.getComputedStyle ? view.getComputedStyle(el) : null; } catch (_) { cs = null; }
  const fallback = (cs && cs.color) || 'gray';
  const get = (name) => {
    const v = cs ? String(cs.getPropertyValue(name) ?? '').trim() : '';
    return v || fallback;
  };
  const series = [];
  for (let i = 1; i <= 8; i++) series.push(get(`--viz-series-${i}`));
  const alphaRaw = cs ? parseFloat(cs.getPropertyValue('--viz-ci-alpha')) : NaN;
  const bg = get('--viz-bg');
  const lum = luminance(bg);
  const fam = cs ? String(cs.getPropertyValue('--font') || cs.fontFamily || '').trim() : '';
  return Object.freeze({
    series: Object.freeze(series),
    seriesGlyph: GLYPHS,
    axis: get('--viz-axis'),
    grid: get('--viz-grid'),
    text: get('--viz-text'),
    target: get('--viz-target'),
    ciAlpha: Number.isFinite(alphaRaw) ? Math.min(1, Math.max(0, alphaRaw)) : 0.16,
    tracer: get('--viz-tracer'),
    halo: get('--viz-tracer-halo'),
    bg,
    ink: get('--text'),
    font: fam || 'system-ui, sans-serif',
    dark: lum !== null && lum < 0.2,
  });
}
