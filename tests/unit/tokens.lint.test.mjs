// scripts/check_tokens.mjs (PRODUCT-SPEC §1.1, §1.7, §6.1): hex colours / px font sizes only in tokens.css, motion only
// inside prefers-reduced-motion: no-preference, no inline style strings in app/src; the real tree passes for A's files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lintCss, lintJs, checkTokens } from '../../scripts/check_tokens.mjs';

const SCRIPT = fileURLToPath(new URL('../../scripts/check_tokens.mjs', import.meta.url));
const rules = (list) => list.map((f) => f.rule).sort();

test('css: hex colour and px font sizes outside tokens.css are findings; floors like max(16px, 1rem) are not', () => {
  assert.deepEqual(rules(lintCss('a { color: #fff; background: #12345678; }')), ['hex-colour', 'hex-colour']);
  assert.deepEqual(rules(lintCss('a { font-size: 12px; } b { font: 700 14px/1.2 sans-serif; }')), ['px-font-size', 'px-font-size']);
  assert.deepEqual(lintCss('a { font-size: max(16px, 1rem); font: var(--t-body); padding: 10px; }'), []);
  assert.deepEqual(lintCss('a { color: #fff; font-size: 12px; }', { isTokens: true }), [], 'tokens.css is the one place for raw values');
  assert.deepEqual(lintCss('/* #fff 12px */ a { color: var(--text); }'), [], 'comments are ignored');
  assert.deepEqual(lintCss('#app-ready { display: none; } a[href="#x"] { color: var(--accent); }'), [], 'id selectors are not colours');
});

test('css: transition / animation only inside @media (prefers-reduced-motion: no-preference); none / keyframes are fine', () => {
  assert.deepEqual(rules(lintCss('a { transition: opacity 1s; } b { animation: spin 1s; }')), ['motion-outside-reduced-motion', 'motion-outside-reduced-motion']);
  assert.deepEqual(lintCss('@media (prefers-reduced-motion: no-preference) { a { transition: transform 1s; } @keyframes k { to { opacity: 1; } } }'), []);
  assert.deepEqual(lintCss('@keyframes k { from { opacity: 0; } } a { transition: none; animation: none; }'), []);
  assert.deepEqual(rules(lintCss('@media (max-width: 500px) { a { transition: opacity 1s; } }')), ['motion-outside-reduced-motion']);
});

test('js: inline style strings (blocked by CSP style-src) are findings; CSSOM and Intl options are not', () => {
  assert.deepEqual(rules(lintJs("h('div', { style: 'color: red' }); el.setAttribute('style', 'x'); const s = '<b style=\"x\">';")), ['inline-style', 'inline-style', 'inline-style']);
  assert.deepEqual(lintJs("el.style.color = 'red'; h('div', { style: { color: 'red' } }); new Intl.ListFormat('en', { style: 'long' });"), []);
  assert.deepEqual(lintJs("// el.setAttribute('style', 'x')\nconst a = 1;"), [], 'comments are ignored');
});

test('the real tree: no FAIL in A files (tokens.css, app.css, A JS); --strict exits with the total count', () => {
  const r = checkTokens();
  assert.deepEqual(r.findings.filter((f) => f.level === 'FAIL'), []);
  const cli = spawnSync(process.execPath, [SCRIPT, '--quiet'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  assert.match(cli.stdout, /check_tokens: \d+ files, 0 FAIL/);
  const strict = spawnSync(process.execPath, [SCRIPT, '--strict', '--quiet'], { encoding: 'utf8' });
  assert.equal(strict.status, Math.min(checkTokens({ strict: true }).findings.length, 255));
  assert.equal(spawnSync(process.execPath, [SCRIPT, '--bogus'], { encoding: 'utf8' }).status, 64);
});
