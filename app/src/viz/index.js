// viz/index.js — entry of the visualization components (LAUNCH-MONITOR-SPEC §3.3, §3.6, §5.0-4; docs/viz.md).
// Lazy (build.mjs LAZY_GLOBS src/viz/*.js): import it dynamically from a screen. Inputs are numbers and a canvas only;
// colours only from vizPalette(el). Every draw returns { a11y: 'viz.<key>', params } — the caller sets
// canvas role="img" and aria-label = t(a11y, params).
//
//   vizPalette(el) -> { series: [8], seriesGlyph: [8], axis, grid, text, target, ciAlpha, tracer, halo, bg, ink, font, dark }
//   drawSide(canvas, { flights: [{ samples, club, validity, band, sigma? }], units, palette, target_m? })
//   drawTop(canvas, { points: [{ x, y | null, sx, sy, club, validity }], units, palette, target?, paths? })
//   createTraj3d(canvas, { flights, palette, units }) -> { rotate(dYawDeg), setPitch('top'|'oblique'), redraw(), destroy() }
//   drawTracer(canvas, { track, projected, frame, palette, reducedMotion })
//   projectFlight(camera, samples) -> [[u, v] | null]
//   drawBars(canvas, { bars, ... })   drawBox(canvas, { groups, ... })
export { vizPalette, seriesIndex, GLYPHS } from './palette.js';
export { drawSide, drawTop } from './plot2d.js';
export { createTraj3d, orbitCamera, project3 } from './traj3d.js';
export { drawTracer, projectFlight } from './tracer.js';
export { drawBars, drawBox, quantile } from './charts.js';

/** True when the user asked for reduced motion (the tracer then draws the whole line at once). */
export function prefersReducedMotion() {
  try { return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; }
}
