// course/draw2d.js — top-down hole map on a Canvas 2D (V04-SPEC §C.4): filled polygons + textures (bunker dots, water
// ripples, tree circle + symbol, OB hatch), strokes, the 95 % landing ellipse, the aim line. Colours only from
// course/palette.js (--course-* tokens). Lazy. STUB created by V4-A drop 1 with the FROZEN signature; owner V4-D.

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ hole: object, strokes: object[], ellipse: { x: number, y: number, sx: number, sy: number, angle: number }|null,
 *   aim: { x: number, y: number }|null, palette: object, units: object }} opts
 * @returns {{ a11y: string, params: object }}  params carries at least { ellipse: boolean, source: string|null } (v4-d-honesty)
 */
export function drawHole2d(canvas, opts) {
  throw Object.assign(new Error('drawHole2d: V4-D pending'), { code: 'PACKAGE_PENDING' });
}
