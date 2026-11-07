// share/trails.js — the tracer-clip colour choices (V04-SPEC §D.4): token names of --trail-1 … --trail-8 (tokens.css,
// :root only, ≥ 4.5 on the dark halo, pairwise CIEDE2000 ≥ 20). Lazy. Created by V4-A drop 1 (FROZEN value); owner V4-E.
//
//   TRAIL_TOKENS                       [{ id: 'trail-1', token: '--trail-1' } … 8]; settings.share.*Colour hold an id
//   parseColour(css) -> [r, g, b] | null      '#rgb', '#rrggbb', 'rgb(r g b / a)', 'rgb(r, g, b)'
//   contrastRatio(a, b) -> number             WCAG 2 relative-luminance ratio of two [r, g, b]
//   ciede2000(a, b) -> number                 CIE ΔE 2000 of two sRGB [r, g, b] (D65); ciede2000Lab on CIELAB
//   trailColours(el) -> { 'trail-1': css … }  the resolved token values (computed style of el; '' when unknown)
// The trails are drawn over a 4 px stroke of --media-bg (opaque black, the same halo as camera overlays), so the
// contrast that counts is colour vs that halo, not vs the video underneath.

/** [{ id: 'trail-1', token: '--trail-1' }, …]; settings.share.ballColour / clubColour hold an id. */
export const TRAIL_TOKENS = Object.freeze(Array.from({ length: 8 }, (_, i) => Object.freeze({ id: `trail-${i + 1}`, token: `--trail-${i + 1}` })));

export function parseColour(css) {
  const s = String(css ?? '').trim();
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (h) {
    const x = h[1].length === 3 ? h[1].split('').map((d) => d + d).join('') : h[1];
    return [0, 2, 4].map((k) => parseInt(x.slice(k, k + 2), 16));
  }
  const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  return m ? [m[1], m[2], m[3]].map(Number) : null;
}

const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

export function contrastRatio(a, b) {
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function lab([r, g, b]) {
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000 (Sharma, Wu, Dalal 2005) between two sRGB colours. */
export function ciede2000(c1, c2) { return ciede2000Lab(lab(c1), lab(c2)); }

/** CIEDE2000 of two CIELAB [L, a, b] (checked against the Sharma et al. test pairs). */
export function ciede2000Lab([L1, a1, b1], [L2, a2, b2]) {
  const D = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1, ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2);
  const hp = (b, ap) => (b === 0 && ap === 0 ? 0 : (Math.atan2(b, ap) / D + 360) % 360);
  const h1 = hp(b1, ap1), h2 = hp(b2, ap2);
  const dL = L2 - L1;
  const dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) { dh = h2 - h1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh / 2) * D);
  const Lb = (L1 + L2) / 2;
  const Cpb = (Cp1 + Cp2) / 2;
  let hb = h1 + h2;
  if (Cp1 * Cp2 !== 0) { if (Math.abs(h1 - h2) > 180) hb += h1 + h2 < 360 ? 360 : -360; hb /= 2; }
  const T = 1 - 0.17 * Math.cos((hb - 30) * D) + 0.24 * Math.cos(2 * hb * D) + 0.32 * Math.cos((3 * hb + 6) * D) - 0.2 * Math.cos((4 * hb - 63) * D);
  const dTh = 30 * Math.exp(-(((hb - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpb ** 7 / (Cpb ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const Sc = 1 + 0.045 * Cpb;
  const Sh = 1 + 0.015 * Cpb * T;
  const Rt = -Math.sin(2 * dTh * D) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

/** The resolved --trail-n values on `el` (computed style); '' for a token the page does not define. */
export function trailColours(el) {
  const view = el?.ownerDocument?.defaultView ?? globalThis;
  let cs = null;
  try { cs = view.getComputedStyle ? view.getComputedStyle(el) : null; } catch (_) { cs = null; }
  const out = {};
  for (const { id, token } of TRAIL_TOKENS) out[id] = cs ? String(cs.getPropertyValue(token) ?? '').trim() : '';
  return out;
}
