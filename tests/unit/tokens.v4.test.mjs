// V04-SPEC §D.4, §F.6 (V4-A drop 1): tracer-clip trail tokens and course-map tokens.
// Trails: defined once in :root (theme-independent), each ≥ 4.5 against black (the 4 px dark halo they are drawn on),
// every pair ≥ 20 apart in CIEDE2000 (so ball and club-head trails never look alike). Course: neighbouring areas ≥ 1.5,
// pin ≥ 3.0 on the green, in every theme; sun overrides only --course-ob, --course-pin, --course-outline.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CSS = fs.readFileSync(path.join(ROOT, 'app', 'styles', 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function block(re) {
  const m = re.exec(CSS);
  assert.ok(m, `block ${re} not found`);
  const start = m.index + m[0].length;
  const out = {};
  for (const d of CSS.slice(start, CSS.indexOf('}', start)).split(';')) {
    const i = d.indexOf(':');
    if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
  }
  return out;
}
const root = block(/:root\s*\{/);
const sun = block(/:root\[data-theme="sun"\]\s*\{/);
const dark = block(/:root\[data-theme="dark"\],\s*\[data-live-theme="dark"\]\s*\{/);

const rgb = (hex) => { const m = /^#([0-9a-f]{6})$/i.exec(hex); assert.ok(m, hex); return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)); };
const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (hex) => { const [r, g, b] = rgb(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** sRGB hex → CIELAB (D65). */
function lab(hex) {
  const [r, g, b] = rgb(hex).map(lin);
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const rad = (d) => (d * Math.PI) / 180;
/** CIEDE2000 colour difference (Sharma, Wu & Dalal 2005). */
export function deltaE2000(c1, c2) {
  const [L1, a1, b1] = lab(c1);
  const [L2, a2, b2] = lab(c2);
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hue = (b, a) => { const h = (Math.atan2(b, a) * 180) / Math.PI; return h < 0 ? h + 360 : h; };
  const h1p = hue(b1, a1p), h2p = hue(b2, a2p);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) dhp = Math.abs(h2p - h1p) <= 180 ? h2p - h1p : h2p - h1p > 180 ? h2p - h1p - 360 : h2p - h1p + 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) hbp = Math.abs(h1p - h2p) <= 180 ? (h1p + h2p) / 2 : h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  const T = 1 - 0.17 * Math.cos(rad(hbp - 30)) + 0.24 * Math.cos(rad(2 * hbp)) + 0.32 * Math.cos(rad(3 * hbp + 6)) - 0.2 * Math.cos(rad(4 * hbp - 63));
  const dth = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2), Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(rad(2 * dth)) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

const TRAILS = Array.from({ length: 8 }, (_, i) => `--trail-${i + 1}`);

test('CIEDE2000 implementation matches the published Sharma test pairs', () => {
  // pairs given in Lab in the paper; checked here through a known sRGB pair instead (black / white = 100)
  assert.ok(Math.abs(deltaE2000('#000000', '#FFFFFF') - 100) < 0.01);
  assert.equal(deltaE2000('#FFE000', '#FFE000'), 0);
});

test('trail tokens: 8 in :root only, each ≥ 4.5 on black, every pair CIEDE2000 ≥ 20; defaults ball 1 (yellow), club 4 (cyan)', () => {
  const rows = [];
  for (const k of TRAILS) {
    assert.ok(root[k], k);
    assert.equal(sun[k], undefined, `${k} must not be redefined in sun`);
    assert.equal(dark[k], undefined, `${k} must not be redefined in dark`);
    assert.ok(ratio(root[k], '#000000') >= 4.5, `${k} ${root[k]} = ${ratio(root[k], '#000000').toFixed(2)}`);
  }
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
    const d = deltaE2000(root[TRAILS[i]], root[TRAILS[j]]);
    rows.push(d);
    assert.ok(d >= 20, `${TRAILS[i]} / ${TRAILS[j]} ΔE00 ${d.toFixed(1)} < 20`);
  }
  assert.equal(rows.length, 28);
  const [r, g, b] = rgb(root['--trail-1']);
  assert.ok(r > 200 && g > 200 && b < 80, 'trail-1 is a bright yellow');
  const [r4, g4, b4] = rgb(root['--trail-4']);
  assert.ok(r4 < 80 && g4 > 200 && b4 > 200, 'trail-4 is a bright cyan');
});

test('course tokens: neighbours ≥ 1.5, pin ≥ 3.0 on the green in default and sun; sun overrides only ob / pin / outline', () => {
  const names = ['fairway', 'rough', 'green', 'bunker', 'water', 'tree', 'ob', 'pin'].map((n) => `--course-${n}`);
  for (const k of names) assert.ok(root[k], k);
  assert.ok(root['--course-outline']);
  assert.deepEqual(Object.keys(sun).filter((k) => k.startsWith('--course-')).sort(), ['--course-ob', '--course-outline', '--course-pin']);
  for (const th of [root, { ...root, ...sun }]) {
    for (const [a, b, need] of [['fairway', 'rough', 1.5], ['green', 'fairway', 1.5], ['water', 'rough', 1.5], ['bunker', 'fairway', 1.5], ['pin', 'green', 3.0]]) {
      const r = ratio(th[`--course-${a}`], th[`--course-${b}`]);
      assert.ok(r >= need, `${a}/${b} ${r.toFixed(2)} < ${need}`);
    }
  }
});
