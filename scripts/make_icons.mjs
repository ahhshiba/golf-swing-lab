#!/usr/bin/env node
// scripts/make_icons.mjs — generate the PWA icons (pure Node PNG encoder with zlib; no dependencies).
//
//   node scripts/make_icons.mjs [--out app/icons]
//
// Writes icon-192.png, icon-512.png, icon-maskable-512.png (glyph inside the 80 % safe zone) and
// apple-touch-icon-180.png (opaque). Output is deterministic (same bytes on every run).
// The icons are opaque and use ~1,000 distinct colours (gradient + anti-aliasing), so they are written as 8-bit
// indexed PNGs (colour type 3) with a 256-colour palette from a deterministic variance-split quantiser: about a third
// of the RGBA size (the shell budget, build.mjs), visually identical at icon sizes (encodeIndexedPNG, quantize).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Encode RGBA pixels (Uint8Array W*H*4) as a PNG buffer. */
export function encodePNG(W, H, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Deterministic 256-colour palette for opaque RGBA pixels: start with one box holding every distinct colour, then
 * repeatedly split the box with the largest pixel-weighted squared error along its widest-variance channel at the
 * weighted mean. Returns { palette: [[r,g,b]...], index: Uint8Array(W*H) } (nearest palette entry per pixel).
 */
export function quantize(rgba, maxColours = 256) {
  const n = rgba.length / 4;
  const counts = new Map();
  for (let i = 0; i < n; i++) {
    const k = (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2];
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const all = [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([k, w]) => [k >> 16, (k >> 8) & 255, k & 255, w]);
  const stats = (box) => {
    let w = 0; const s = [0, 0, 0]; const q = [0, 0, 0];
    for (const p of box) { w += p[3]; for (let c = 0; c < 3; c++) { s[c] += p[c] * p[3]; q[c] += p[c] * p[c] * p[3]; } }
    const mean = s.map((v) => v / w);
    const vars = q.map((v, c) => v / w - mean[c] * mean[c]);
    return { w, mean, vars, err: (vars[0] + vars[1] + vars[2]) * w };
  };
  let boxes = [{ items: all, ...stats(all) }];
  while (boxes.length < maxColours) {
    let bi = -1;
    for (let i = 0; i < boxes.length; i++) if (boxes[i].items.length > 1 && (bi < 0 || boxes[i].err > boxes[bi].err)) bi = i;
    if (bi < 0) break;
    const b = boxes[bi];
    const c = b.vars[0] >= b.vars[1] && b.vars[0] >= b.vars[2] ? 0 : b.vars[1] >= b.vars[2] ? 1 : 2;
    const lo = b.items.filter((p) => p[c] <= b.mean[c]);
    const hi = b.items.filter((p) => p[c] > b.mean[c]);
    if (!lo.length || !hi.length) { b.err = -1; continue; }
    boxes.splice(bi, 1, { items: lo, ...stats(lo) }, { items: hi, ...stats(hi) });
  }
  const palette = boxes.map((b) => b.mean.map((v) => Math.min(255, Math.max(0, Math.round(v)))));
  const nearest = new Map();
  const index = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const k = (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2];
    let j = nearest.get(k);
    if (j === undefined) {
      let best = Infinity;
      for (let q = 0; q < palette.length; q++) {
        const d = (palette[q][0] - rgba[i * 4]) ** 2 + (palette[q][1] - rgba[i * 4 + 1]) ** 2 + (palette[q][2] - rgba[i * 4 + 2]) ** 2;
        if (d < best) { best = d; j = q; }
      }
      nearest.set(k, j);
    }
    index[i] = j;
  }
  return { palette, index };
}

/** Encode opaque RGBA pixels as an 8-bit indexed PNG (PLTE, filter none: smallest for this artwork). */
export function encodeIndexedPNG(W, H, rgba) {
  const { palette, index } = quantize(rgba);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // indexed colour
  const raw = Buffer.alloc((W + 1) * H);
  for (let y = 0; y < H; y++) Buffer.from(index.buffer, index.byteOffset + y * W, W).copy(raw, y * (W + 1) + 1);
  const plte = Buffer.from(palette.flat());
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const BG_TOP = [18, 128, 78];
const BG_BOTTOM = [10, 74, 46];
const BALL = [250, 250, 247];
const SHADE = [205, 212, 208];
const TEE = [240, 200, 90];

/** Shade at normalised coordinates (x, y in [0, 1]); r = ball radius as a fraction of the size. */
function shade(x, y, r) {
  const cx = 0.5;
  const cy = 0.46;
  const bg = BG_TOP.map((a, i) => a + (BG_BOTTOM[i] - a) * y);
  // tee: a small trapezoid under the ball
  const teeTop = cy + r * 0.92;
  const teeBottom = cy + r * 1.55;
  if (y >= teeTop && y <= teeBottom) {
    const k = (y - teeTop) / (teeBottom - teeTop);
    const half = r * (0.42 * (1 - k) + 0.09 * k);
    if (Math.abs(x - cx) <= half) return TEE;
  }
  const dx = x - cx;
  const dy = y - cy;
  const d = Math.hypot(dx, dy);
  if (d > r) return bg;
  // dimples: a hex grid of small dark dots, foreshortened toward the rim
  const s = r / 3.2;
  const row = Math.round(dy / (s * 0.866));
  const off = row % 2 ? s / 2 : 0;
  const col = Math.round((dx - off) / s);
  const ddx = dx - (col * s + off);
  const ddy = dy - row * s * 0.866;
  const rim = d / r;
  const light = 1 - 0.18 * Math.max(0, (dx + dy) / r + 0.3);
  let c = BALL.map((a, i) => a + (SHADE[i] - a) * Math.min(1, Math.max(0, 1 - light) * 2.5 + rim ** 6 * 0.6));
  if (Math.hypot(ddx, ddy) < s * 0.24 * (1 - 0.45 * rim)) c = c.map((v) => v * 0.86);
  return c;
}

export function renderIcon(size, r) {
  const ss = 4;
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let R = 0; let G = 0; let B = 0;
      for (let j = 0; j < ss; j++) {
        for (let i = 0; i < ss; i++) {
          const c = shade((x + (i + 0.5) / ss) / size, (y + (j + 0.5) / ss) / size, r);
          R += c[0]; G += c[1]; B += c[2];
        }
      }
      const n = ss * ss;
      const o = (y * size + x) * 4;
      px[o] = Math.round(R / n);
      px[o + 1] = Math.round(G / n);
      px[o + 2] = Math.round(B / n);
      px[o + 3] = 255;
    }
  }
  return encodeIndexedPNG(size, size, px);
}

export const ICONS = Object.freeze([
  ['icon-192.png', 192, 0.3],
  ['icon-512.png', 512, 0.3],
  ['icon-maskable-512.png', 512, 0.22],
  ['apple-touch-icon-180.png', 180, 0.28],
]);

function main() {
  const i = process.argv.indexOf('--out');
  const out = path.resolve(ROOT, i > 0 ? process.argv[i + 1] : 'app/icons');
  fs.mkdirSync(out, { recursive: true });
  for (const [name, size, r] of ICONS) {
    const png = renderIcon(size, r);
    fs.writeFileSync(path.join(out, name), png);
    console.log(`${name}  ${size}x${size}  ${png.length} bytes`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
