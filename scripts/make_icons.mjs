#!/usr/bin/env node
// scripts/make_icons.mjs — generate the PWA icons (pure Node PNG encoder with zlib; no dependencies).
//
//   node scripts/make_icons.mjs [--out app/icons]
//
// Writes icon-192.png, icon-512.png, icon-maskable-512.png (glyph inside the 80 % safe zone) and
// apple-touch-icon-180.png (opaque). Output is deterministic (same bytes on every run).

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
  return encodePNG(size, size, px);
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
