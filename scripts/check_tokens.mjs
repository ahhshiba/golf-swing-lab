#!/usr/bin/env node
// scripts/check_tokens.mjs — design-token lint (PRODUCT-SPEC §1.1, §1.7, §6.1; verify.sh stage `tokens`).
//
//   node scripts/check_tokens.mjs [--strict] [--quiet]
//
// CSS (app/styles/**/*.css, comments ignored):
//   hex colour        no #rgb / #rrggbb / #rrggbbaa outside styles/tokens.css
//   px font size      no `font-size: <n>px` and no px size inside a `font:` shorthand outside tokens.css
//                     (max(16px, 1rem) style floors are allowed: they never shrink text below the user's setting)
//   motion            every transition / animation declaration sits inside @media (prefers-reduced-motion:
//                     no-preference); @keyframes may live anywhere (they do nothing until an animation uses them)
// JavaScript (app/src/**/*.js, comments ignored):
//   inline style      no `style="…"` markup strings and no setAttribute('style', …) / h(…, { style: '…' }) strings —
//                     CSP style-src 'self' blocks them; use classes or CSSOM (el.style.x = …)
//   js-hex-colour     (LAUNCH-MONITOR-SPEC §4.2) no hex colour string literal ('#rgb', '#rrggbb', '#rrggbbaa') in
//                     app/src/viz/** and app/src/ui/** — Canvas colours come from viz/palette.js vizPalette(el), which
//                     reads the --viz-* tokens; the setup / magnifier video overlays read --overlay-* (ui/magnifier.js
//                     overlayColour). FAIL since the LM-A integration commit (JS_HEX_FAILS = true, §5.3 step 3).
// Scope: findings in A's files (tokens.css, app.css, A's JS) FAIL; findings in a package's screen CSS / JS are WARN
// until the integration switch --strict, when every finding FAILS (§8.7).
// Exit code = number of FAIL findings (capped at 255); 64 on usage errors.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments, stripCssComments } from './build.mjs';
import { ownerOfFile } from './check_i18n.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app');

function walk(dir, ext, base = dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'vendor') out.push(...walk(full, ext, base)); } else if (e.name.endsWith(ext)) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

const lineAt = (src, idx) => src.slice(0, idx).split('\n').length;

/** CSS findings for one stylesheet: [{ rule, line, text }]. */
export function lintCss(src, { isTokens = false } = {}) {
  const css = (() => { try { return stripCssComments(src); } catch (_) { return src; } })();
  const out = [];
  if (!isTokens) {
    for (const m of css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      // skip id selectors that happen to look hex-like: only flag inside a declaration value (after ':' on that line)
      const lineStart = css.lastIndexOf('\n', m.index) + 1;
      const before = css.slice(lineStart, m.index);
      const inValue = /:[^;{}]*$/.test(before) && !/^[^{]*[a-z\])*-]\s*:[a-z-]+\([^)]*$/i.test(before);
      if (inValue && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(m[0])) out.push({ rule: 'hex-colour', line: lineAt(css, m.index), text: m[0] });
    }
    for (const m of css.matchAll(/font-size\s*:\s*([^;}]*)/g)) {
      const v = m[1].replace(/max\([^)]*\)/g, '');
      if (/\d(\.\d+)?px\b/.test(v)) out.push({ rule: 'px-font-size', line: lineAt(css, m.index), text: m[0].trim() });
    }
    for (const m of css.matchAll(/(^|[;{\s])font\s*:\s*([^;}]*)/g)) {
      const v = m[2].replace(/max\([^)]*\)/g, '');
      if (/(^|\s)\d+(\.\d+)?px(\s*\/|\s|$)/.test(v)) out.push({ rule: 'px-font-size', line: lineAt(css, m.index), text: `font: ${m[2].trim()}` });
    }
  }
  // motion outside prefers-reduced-motion: no-preference (block-aware scan)
  const stack = []; // each open block: { reduced: bool, keyframes: bool }
  const re = /@media[^{]*\{|@keyframes[^{]*\{|@supports[^{]*\{|@[a-z-]+[^{;]*\{|[^{}]*\{|\}|[^{}]+/gy;
  let m;
  re.lastIndex = 0;
  let pos = 0;
  while (pos < css.length) {
    re.lastIndex = pos;
    m = re.exec(css);
    if (!m) break;
    const tok = m[0];
    pos = re.lastIndex;
    if (tok === '}') { stack.pop(); continue; }
    if (tok.endsWith('{')) {
      const head = tok.trim();
      stack.push({ reduced: /^@media[^{]*prefers-reduced-motion\s*:\s*no-preference/.test(head), keyframes: /^@keyframes/.test(head) });
      continue;
    }
    const allowed = stack.some((b) => b.reduced || b.keyframes);
    if (allowed) continue;
    for (const d of tok.matchAll(/(^|[;\s])((?:transition|animation)(?:-[a-z-]+)?)\s*:\s*([^;]*)/g)) {
      if (/^(none|0s?|initial|unset)$/i.test(d[3].trim())) continue; // switching motion off is always fine
      out.push({ rule: 'motion-outside-reduced-motion', line: lineAt(css, m.index + d.index), text: `${d[2]}: ${d[3].trim()}`.slice(0, 80) });
    }
  }
  return out;
}

/** LAUNCH-MONITOR-SPEC §5.3 step 3 (integration): js-hex-colour findings FAIL like the others. */
export const JS_HEX_FAILS = true;
const JS_HEX_SCOPE = /^src\/(viz|ui)\//;

/** JS findings: hex colour string literals (scope: viz/**, ui/**; the caller decides). */
export function lintJsHex(src) {
  let code;
  try { code = stripJsComments(src); } catch (_) { code = src; }
  const out = [];
  for (const m of code.matchAll(/(['"`])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\1/g)) out.push({ rule: 'js-hex-colour', line: lineAt(code, m.index), text: m[0] });
  return out;
}

/** JS findings: inline style strings (CSP style-src 'self'). */
export function lintJs(src) {
  let code;
  try { code = stripJsComments(src); } catch (_) { code = src; }
  const out = [];
  for (const m of code.matchAll(/style\s*=\s*\\?["']/g)) out.push({ rule: 'inline-style', line: lineAt(code, m.index), text: m[0] });
  for (const m of code.matchAll(/setAttribute\(\s*['"]style['"]/g)) out.push({ rule: 'inline-style', line: lineAt(code, m.index), text: m[0] });
  // h('div', { style: 'color: red' }) → setAttribute('style'); a CSS-looking string value only (Intl options use style: 'long')
  for (const m of code.matchAll(/[{,]\s*style\s*:\s*(['"`])[^'"`]*[a-z-]\s*:[^'"`]*\1/g)) out.push({ rule: 'inline-style', line: lineAt(code, m.index), text: m[0].trim().slice(0, 60) });
  return out;
}

export function checkTokens({ strict = false } = {}) {
  const findings = [];
  const cssFiles = walk(path.join(APP, 'styles'), '.css').map((f) => `styles/${f}`);
  for (const rel of cssFiles) {
    const own = rel === 'styles/tokens.css' || rel === 'styles/app.css';
    for (const f of lintCss(fs.readFileSync(path.join(APP, rel), 'utf8'), { isTokens: rel === 'styles/tokens.css' })) findings.push({ ...f, file: `app/${rel}`, level: strict || own ? 'FAIL' : 'WARN' });
  }
  const jsFiles = walk(path.join(APP, 'src'), '.js').map((f) => `src/${f}`);
  for (const rel of jsFiles) {
    const own = ownerOfFile(rel) === 'foundation';
    const src = fs.readFileSync(path.join(APP, rel), 'utf8');
    for (const f of lintJs(src)) findings.push({ ...f, file: `app/${rel}`, level: strict || own ? 'FAIL' : 'WARN' });
    if (JS_HEX_SCOPE.test(rel)) for (const f of lintJsHex(src)) findings.push({ ...f, file: `app/${rel}`, level: JS_HEX_FAILS ? 'FAIL' : 'WARN' });
  }
  return { findings, files: cssFiles.length + jsFiles.length };
}

function main(argv) {
  const o = { strict: false, quiet: false };
  for (const a of argv.slice(2)) {
    if (a === '--strict') o.strict = true;
    else if (a === '--quiet') o.quiet = true;
    else { console.error('usage: check_tokens.mjs [--strict] [--quiet]'); return 64; }
  }
  const r = checkTokens(o);
  const fails = r.findings.filter((f) => f.level === 'FAIL');
  const warns = r.findings.filter((f) => f.level === 'WARN');
  for (const f of fails) console.log(`FAIL ${f.rule}: ${f.file}:${f.line} ${f.text}`);
  if (warns.length) {
    console.log(`WARN ${warns.length} finding(s) in package files (FAIL with --strict at integration):`);
    if (!o.quiet) for (const w of warns.slice(0, 20)) console.log(`  warn ${w.rule}: ${w.file}:${w.line} ${w.text}`);
  }
  console.log(`check_tokens: ${r.files} files, ${fails.length} FAIL, ${warns.length} WARN${o.strict ? ' (strict)' : ''}`);
  return Math.min(fails.length, 255);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv);
