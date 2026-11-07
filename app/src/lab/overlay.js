// lab/overlay.js — draws lab/lines.js lines on a replay / composed frame: --overlay-select (reference),
// --overlay-caution (off the reference), outlined in --media-bg (V04-SPEC §E.1). Lazy. STUB created by V4-A drop 1
// with the FROZEN signature; owner V4-F. share/compose.js (V4-E) calls it when opts.lines is on.

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object<string, import('./lines.js').Line|null>} lines
 * @param {{ frame: number, palette: object, enabled: string[] }} opts
 * @returns {void}
 */
export function drawLines(ctx, lines, opts) {
  throw Object.assign(new Error('drawLines: V4-F pending'), { code: 'PACKAGE_PENDING' });
}
