// Design tokens (PRODUCT-SPEC §1.4, WP-A acceptance): every declared colour pair meets its WCAG 2.x threshold in
// light, dark and sun (text 4.5, large text / UI 3.0); every colour token is in a declared pair or explicitly exempt;
// the auto-theme media blocks repeat the explicit dark / sun values exactly. Port of scratchpad/audit/lead/contrast.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CSS = fs.readFileSync(path.join(ROOT, 'app', 'styles', 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Declarations of the first rule whose selector list matches `re` (inside or outside an @media block). */
function block(re) {
  const m = re.exec(CSS);
  assert.ok(m, `block ${re} not found`);
  const start = m.index + m[0].length;
  const end = CSS.indexOf('}', start);
  const out = {};
  for (const d of CSS.slice(start, end).split(';')) {
    const i = d.indexOf(':');
    if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
  }
  return out;
}
const light = block(/:root\s*\{/);
const darkX = block(/:root\[data-theme="dark"\],\s*\[data-live-theme="dark"\]\s*\{/);
const sunX = block(/:root\[data-theme="sun"\]\s*\{/);
const darkAuto = block(/prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme\]\)\s*\{/);
const sunAuto = block(/prefers-contrast: more\)\s*\{\s*:root:not\(\[data-theme\]\)\s*\{/);
const THEMES = { light, dark: { ...light, ...darkX }, sun: { ...light, ...sunX } };

function lum(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  assert.ok(m, `not a #rrggbb colour: ${hex}`);
  const c = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const TEXT = 4.5;
const UI = 3.0;
// [foreground token, background token, need]
const PAIRS = [
  ['--text', '--surface', TEXT], ['--text', '--bg', TEXT], ['--text', '--surface-2', TEXT],
  ['--text-2', '--surface', TEXT], ['--text-2', '--bg', TEXT], ['--text-2', '--surface-2', TEXT],
  ['--text-3', '--surface', TEXT], ['--text-3', '--bg', TEXT], ['--text-3', '--surface-2', TEXT],
  ['--control-border', '--surface', UI], ['--control-border', '--bg', UI], ['--control-border-2', '--surface-2', UI],
  ['--on-accent', '--accent', TEXT], ['--accent', '--bg', TEXT], ['--accent', '--surface', TEXT], ['--accent', '--accent-tint', TEXT],
  ['--info', '--surface', TEXT], ['--info', '--bg', UI], ['--info', '--tint-info', UI],
  ['--on-go', '--signal-go', TEXT], ['--on-caution', '--signal-caution', TEXT], ['--on-stop', '--signal-stop', TEXT],
  ['--warn-text', '--bg', UI], ['--warn-text', '--surface', TEXT], ['--warn-text', '--tint-caution', UI],
  ['--danger-text', '--surface', TEXT], ['--danger-text', '--bg', TEXT], ['--danger-text', '--tint-error', UI],
  ['--text-disabled', '--fill-disabled', TEXT],
  ['--text', '--tint-info', TEXT], ['--text', '--tint-caution', TEXT], ['--text', '--tint-error', TEXT],
  ['--tag-valid-fg', '--tag-valid-bg', TEXT], ['--tag-est-fg', '--tag-est-bg', TEXT], ['--tag-low-fg', '--tag-low-bg', TEXT], ['--tag-null-fg', '--tag-null-bg', TEXT],
  ['--toast-fg', '--toast-bg', TEXT], ['--on-media', '--media-bg', TEXT],
];
/** Colour tokens with no contrast requirement (decorative or not a solid colour). */
const EXEMPT = ['--separator', '--scrim', '--scroll-shade']; // --scroll-shade: edge shadow of a scroll panel, never behind text

test('every declared pair meets its threshold in light, dark and sun', () => {
  const fails = [];
  for (const [name, th] of Object.entries(THEMES)) {
    for (const [fg, bg, need] of PAIRS) {
      const r = ratio(th[fg], th[bg]);
      if (!(r >= need)) fails.push(`${name}: ${fg} ${th[fg]} on ${bg} ${th[bg]} = ${r.toFixed(2)} < ${need}`);
    }
  }
  assert.deepEqual(fails, []);
});

test('spec values (§1.4) are the tokens: spot checks of the published ratios', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a.toFixed(2)} vs ${b}`);
  near(ratio(light['--text'], light['--surface']), 17.82);
  near(ratio(light['--text-3'], light['--surface-2']), 4.54);
  near(ratio(light['--control-border'], light['--surface']), 3.54);
  near(ratio(light['--on-accent'], light['--accent']), 6.58);
  near(ratio(THEMES.dark['--text'], THEMES.dark['--surface']), 15.33);
  near(ratio(THEMES.dark['--accent'], THEMES.dark['--on-accent']), 8.65);
  near(ratio(THEMES.sun['--text'], THEMES.sun['--surface']), 21.0);
  near(ratio(THEMES.sun['--control-border'], THEMES.sun['--surface']), 9.30);
  assert.equal(THEMES.sun['--border-control'], '2px');
});

test('no colour token without a declared requirement (or an explicit exemption)', () => {
  const inPairs = new Set(PAIRS.flatMap(([a, b]) => [a, b]));
  for (const [name, th] of Object.entries(THEMES)) {
    for (const [k, v] of Object.entries(th)) {
      if (!/^#|^rgb/.test(v)) continue;
      assert.ok(inPairs.has(k) || EXEMPT.includes(k), `${name}: colour token ${k} has no declared contrast pair`);
    }
  }
});

test('auto theme (prefers-color-scheme / prefers-contrast) repeats the explicit dark and sun blocks exactly', () => {
  assert.deepEqual(darkAuto, darkX);
  assert.deepEqual(sunAuto, sunX);
});

test('raw colours and px font sizes appear only in tokens.css', () => {
  const dir = path.join(ROOT, 'app', 'styles');
  const files = ['app.css', ...fs.readdirSync(path.join(dir, 'screens')).map((f) => `screens/${f}`)];
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/#[0-9a-f]{3,8}\b/i.test(src), `${f}: hex colour`);
    assert.ok(!/font-size:\s*[\d.]+px/i.test(src) && !/font:[^;]*\b[\d.]+px/i.test(src), `${f}: px font size`);
  }
});
