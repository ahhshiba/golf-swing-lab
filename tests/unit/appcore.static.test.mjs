// app-core static checks: every relative import in app/src resolves to an existing file and every named import
// exists in the target module; no URL routing / external URLs in the app shell; index.html / manifest / CSS
// follow docs/app-architecture.md §2 (phone-first PWA).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SCREENS } from '../../app/src/state.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APP = path.join(ROOT, 'app');
const SRC = path.join(APP, 'src');

function walk(dir, pred) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, pred));
    else if (pred(p)) out.push(p);
  }
  return out.sort();
}

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** Static import / export-from specifiers with their named bindings, plus dynamic import('...') literals. */
export function importsOf(src) {
  const s = stripComments(src);
  const out = [];
  const re = /(?:^|[;\n])\s*(?:import|export)\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const clause = m[1];
    const names = [];
    const braces = /\{([\s\S]*?)\}/.exec(clause);
    if (braces) {
      for (const part of braces[1].split(',')) {
        const n = part.trim().split(/\s+as\s+/)[0].trim();
        if (n && n !== 'default') names.push(n);
      }
    }
    out.push({ spec: m[2], names, dynamic: false });
  }
  const sideEffect = /(?:^|[;\n])\s*import\s+['"]([^'"]+)['"]/g;
  for (let m = sideEffect.exec(s); m; m = sideEffect.exec(s)) out.push({ spec: m[1], names: [], dynamic: false });
  const dyn = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (let m = dyn.exec(s); m; m = dyn.exec(s)) out.push({ spec: m[1], names: [], dynamic: true });
  return out;
}

const OWN = [path.join(SRC, 'main.js'), path.join(SRC, 'state.js'), path.join(SRC, 'boot-watchdog.js'), path.join(SRC, 'version.js'), ...walk(path.join(SRC, 'ui'), (p) => p.endsWith('.js')), ...walk(path.join(SRC, 'session'), (p) => p.endsWith('.js'))];

test('every static import in app/src resolves to an existing file with the named exports', async () => {
  const files = walk(SRC, (p) => p.endsWith('.js') || p.endsWith('.mjs'));
  assert.ok(files.length > 50, `found ${files.length} files`);
  const problems = [];
  const exportCache = new Map();
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const imp of importsOf(src)) {
      if (!imp.spec.startsWith('.')) { problems.push(`${path.relative(ROOT, f)}: bare import '${imp.spec}'`); continue; }
      const target = path.resolve(path.dirname(f), imp.spec);
      if (!fs.existsSync(target)) { problems.push(`${path.relative(ROOT, f)}: missing ${imp.spec}`); continue; }
      if (!imp.names.length || !OWN.includes(f)) continue;
      if (!exportCache.has(target)) {
        try { exportCache.set(target, Object.keys(await import(pathToFileURL(target).href))); } catch (e) { exportCache.set(target, e); }
      }
      const ex = exportCache.get(target);
      if (ex instanceof Error) { problems.push(`${path.relative(ROOT, target)} failed to load in Node: ${ex.message}`); continue; }
      for (const n of imp.names) if (!ex.includes(n)) problems.push(`${path.relative(ROOT, f)}: '${n}' is not exported by ${imp.spec}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('app-core modules load in Node (no DOM access at import time), except main.js which boots', async () => {
  for (const f of OWN) {
    if (f.endsWith('main.js') || f.endsWith('boot-watchdog.js')) continue; // the boot entry and the classic watchdog script
    await import(pathToFileURL(f).href);
  }
});

test('no URL routing, no external URLs, no eval in the app shell', () => {
  const files = [...OWN, path.join(APP, 'index.html'), path.join(APP, 'manifest.webmanifest'), path.join(APP, 'sw.template.js'), ...walk(path.join(APP, 'styles'), () => true)];
  const bad = [/location\.hash/, /history\.(pushState|replaceState)/, /https?:\/\//, /(^|[^A-Za-z0-9_$])eval\s*\(/, /new\s+Function([^A-Za-z0-9_$]|$)/, /hashchange|popstate/];
  for (const f of files) {
    // XML namespace names (createElementNS) are identifiers, never fetched
    const src = fs.readFileSync(f, 'utf8').replace(/http:\/\/www\.w3\.org\/(2000\/svg|1999\/xlink|1998\/Math\/MathML)/g, '');
    for (const re of bad) assert.ok(!re.test(src), `${path.relative(ROOT, f)} matches ${re}`);
  }
});

test('reason codes are referenced only as RC.<NAME> in app-core code', async () => {
  const { REASON_CODES } = await import('../../app/src/contract/reason-codes.js');
  for (const f of OWN) {
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    for (const code of Object.keys(REASON_CODES)) {
      assert.ok(!new RegExp(`['"\`]${code}['"\`]`).test(src), `${path.relative(ROOT, f)} quotes the reason code ${code}`);
    }
  }
});

test('index.html: one root per screen, module entry, manifest, icons, viewport-fit', () => {
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  for (const id of SCREENS) assert.match(html, new RegExp(`data-screen="${id}"`), id);
  assert.equal(SCREENS.length, 10);
  assert.match(html, /<html lang="zh-Hant">/);
  assert.match(html, /<script type="module" src="src\/main\.js"><\/script>/);
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="icons\/apple-touch-icon-180\.png"/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /有新版本，點此更新/);
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(APP, m[1])), `index.html references missing ${m[1]}`);
});

function pngSize(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${file} is not a PNG`);
  assert.equal(b.subarray(12, 16).toString('ascii'), 'IHDR');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test('manifest.webmanifest is a valid installable standalone zh-Hant manifest with relative scope', () => {
  const m = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.equal(m.lang, 'zh-Hant');
  assert.ok(m.name && m.short_name && m.short_name.length <= 12);
  assert.match(m.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(m.background_color, /^#[0-9a-f]{6}$/i);
  const sizes = new Set();
  let maskable = false;
  for (const icon of m.icons) {
    assert.ok(!icon.src.startsWith('/') && !/^[a-z]+:/i.test(icon.src), `icon src must be relative: ${icon.src}`);
    const [w, h] = pngSize(path.join(APP, icon.src));
    assert.equal(`${w}x${h}`, icon.sizes, icon.src);
    assert.equal(icon.type, 'image/png');
    sizes.add(icon.sizes);
    if (icon.purpose.split(' ').includes('maskable')) maskable = true;
  }
  for (const s of ['192x192', '512x512', '180x180']) assert.ok(sizes.has(s), s);
  assert.ok(maskable, 'a maskable icon');
});

test('styles: tokens, light + dark, safe areas, 100dvh, 44 px targets, 16 px inputs, no hover-only rules', () => {
  // design system "Range" (PRODUCT-SPEC §1): raw values live in tokens.css, app.css uses them
  const tokens = fs.readFileSync(path.join(APP, 'styles', 'tokens.css'), 'utf8');
  const app = fs.readFileSync(path.join(APP, 'styles', 'app.css'), 'utf8');
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  assert.ok(html.indexOf('styles/tokens.css') > -1 && html.indexOf('styles/tokens.css') < html.indexOf('styles/app.css'), 'tokens.css is loaded before app.css');
  assert.match(tokens, /:root\s*\{[^}]*--bg:/);
  assert.match(tokens, /@media \(prefers-color-scheme: dark\)/);
  assert.match(tokens, /:root\[data-theme="dark"\]/);
  assert.match(tokens, /:root\[data-theme="sun"\]/);
  assert.match(tokens, /env\(safe-area-inset-top/);
  assert.match(tokens + app, /env\(safe-area-inset-bottom/);
  assert.match(app, /100dvh/);
  assert.match(tokens, /--hit-min:\s*44px/);
  assert.match(app, /button, \.button \{[^}]*min-height:\s*var\(--hit-min\)/);
  assert.match(tokens, /--fs-input:\s*max\(16px, 1rem\)/);
  assert.match(app, /button, \.button, select, input, textarea \{[^}]*font-size:\s*var\(--fs-input\)/);
  assert.match(app, /touch-action:\s*manipulation/);
  for (const [name, css] of [['tokens.css', tokens], ['app.css', app]]) assert.ok(!/:hover/.test(css), `${name}: no :hover rules (phone first, no hover-only affordances)`);
});
