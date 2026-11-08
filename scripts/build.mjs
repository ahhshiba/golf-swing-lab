#!/usr/bin/env node
// scripts/build.mjs — zero-dependency build of the static PWA (CAFCR R3/R4, docs/app-architecture.md §7).
//
//   node scripts/build.mjs [--dev] [--out DIR] [--quiet] [--include-golfdb-model] [--keep-comments]
//
// 1. copies app/ → dist/ (or --out DIR; the directory is wiped only when it is empty, missing, or a previous build
//    marked by .gsl-build), skipping app/sw.template.js, *.bak and dotfiles;
// 2. precache list (scope-relative URLs): shell = every copied file outside vendor/ and models/ except LAZY_FILES; assets =
//    vendor/ and models/ files and LAZY_FILES, all precached except RUNTIME_ONLY (cached in gsl-assets on first use) and NOT_SERVED_IN_PRECACHE;
// 3. VERSION = <package.json version> + '+' + first 10 hex of sha256 over the precache list contents, where the
//    hashed text is, for every precached entry sorted by URL (byte order): `${url}\n${sha256hex(file)}\n`;
// 4. writes dist/sw.js (from app/sw.template.js), dist/precache-manifest.json (schema gsl-precache/1, same data) and
//    dist/.nojekyll;
// 5. budgets: shell ≤ 1 MB and precache (shell + precached assets) ≤ 35 MB (10^6 bytes), else exit 1.
// --dev: identical file set and VERSION; sw.js serves the shell network-first (edits show without a version bump).
// Event model (PRODUCT-SPEC §7.1, EV-6): the default build ships NO event model — the GolfDB-derived files
//    app/models/event-tcn-v1.* (CC BY-NC) are left out of dist/ and the precache, and the app detects events with the
//    rules. --include-golfdb-model is a dev-only research switch: it bundles them and records
//    "dev_research": true in precache-manifest.json (deploy_pages.sh refuses such a build). --no-bundled-model is
//    accepted for older callers and is the default. precache-manifest.json records "bundled_event_model".
// 6. i18n (PRODUCT-SPEC §3.1): the namespace catalogs app/i18n/<locale>/<ns>.json are not copied; each locale is
//    merged into dist/i18n/<locale>.json (full keys `<ns>.<key>`, `_context` notes stripped) and precached with the
//    shell. The file is a sorted prefix tree of the full keys (catalogTree: `{"$tree":1,"setup":{"step":{...}}}`, a key
//    that is also a prefix keeps its value under ""), which app/src/i18n/index.js expandCatalog turns back into the flat
//    catalog; the build checks the round trip. Shared prefixes are written once (about 34 KB less shell than flat).
//    LAZY_I18N_NAMESPACES (rare screens) are split off into i18n/<locale>.more.json (a lazy asset, see LAZY_FILES); the
//    core file names it in "$lazy". app/i18n/namespaces.json is copied (the dev loader's fallback index).
// 7. comments and line indentation are stripped from src/**/*.js and styles/**/*.css (stripJsComments /
//    stripCssComments: a lexer that understands strings, template literals and regex literals; every newline is kept,
//    so line numbers in stack traces match app/). JS is also squeezed (in-line whitespace between tokens dropped where
//    no two tokens would join; stripJsComments(src, { squeeze: true })) and CSS is minified (minifyCss: whitespace runs
//    collapsed, none next to { } ; , or after :). Everything else is copied byte for byte, except SOURCE_ONLY files
//    (never copied). --keep-comments turns the transforms off.
// 8. src/version.js is generated (APP_VERSION = the VERSION above, APP_SEMVER, APP_BUILD = first 7 hex, DEV_RESEARCH,
//    BUNDLED_EVENT_MODEL, PRESENT_MODULES = the src/ modules of this build); it is precached but left out of the VERSION hash (HASH_EXCLUDED), which would otherwise
//    depend on itself.
// 9. dist/index.html gets one <link rel="modulepreload"> per module of the boot graph (static imports reachable from
//    BOOT_ENTRIES, in breadth-first order, at most MODULEPRELOAD_MAX), inserted before the main.js <script>, so a cold
//    start fetches the graph in parallel instead of one import level per round trip (PF-1).
// Deterministic: two builds of the same tree are byte-identical.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandCatalog } from '../app/src/i18n/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BUDGETS = Object.freeze({ shell_bytes: 1_000_000, precache_bytes: 35_000_000 });
/** Large files served and cached on first use only (heavy model 30.7 MB; the classic-script wasm variant). */
export const RUNTIME_ONLY = Object.freeze([
  'models/pose_landmarker_heavy.task',
  'vendor/mediapipe/wasm/vision_wasm_internal.js',
  'vendor/mediapipe/wasm/vision_wasm_internal.wasm',
]);
/**
 * Source-only files: never copied to dist/ (nothing loads them at runtime). src/events/calib-conf.json is the fitted
 * confidence table that check_event_conf.mjs reads from app/; the app imports its generated JS mirror calib-conf.js.
 */
export const SOURCE_ONLY = Object.freeze(['src/events/calib-conf.json', 'vendor/manifest.json']);
// vendor/manifest.json is scripts/vendor.mjs's pin list (sha256 + provenance of every vendored file, including the
// GolfDB-derived research model's entry): nothing at runtime reads it, and the shipped site carries no GolfDB text.
/** Copied but not precached (not needed at runtime). */
export const NOT_PRECACHED = Object.freeze(['vendor/manifest.json']);
/** GolfDB-derived event model: left out unless --include-golfdb-model (scope-relative paths). */
export const EVENT_MODEL_FILES = Object.freeze(['models/event-tcn-v1.bin', 'models/event-tcn-v1.json']);
const SKIP_NAMES = new Set(['sw.template.js']);
/** Generated into dist/ (app/src/version.js is the unbuilt placeholder) and left out of the VERSION hash. */
export const VERSION_FILE = 'src/version.js';
export const HASH_EXCLUDED = Object.freeze([VERSION_FILE]);
/** Entry modules whose static import graph is modulepreloaded (main.js + the screens a first start shows). */
export const BOOT_ENTRIES = Object.freeze(['src/main.js', 'src/ui/home.js', 'src/ui/onboarding.js']);
export const MODULEPRELOAD_MAX = 30;
/**
 * Lazy app files (budget, PRODUCT-SPEC §5): app files that no start path needs (rarely opened screens and sections,
 * install-only icons). They are precached at install like every asset, but into gsl-assets (kept across versions,
 * keyed by sha256, so an update re-downloads one only when it changed) instead of gsl-shell-<VERSION>; they count in
 * the precache budget, not the shell budget. The build refuses a lazy file that is in the modulepreloaded boot graph
 * or referenced by index.html. LAZY_I18N_NAMESPACES go to i18n/<locale>.more.json (also lazy): the core catalog names
 * it in "$lazy" and app/src/i18n/index.js fetches it in the background; main.js waits for it (i18nComplete) before it
 * mounts any screen but home/onboarding, which use none of these namespaces.
 */
const LAZY_EXACT = Object.freeze([
  'icons/icon-512.png', 'icons/icon-maskable-512.png', // read by the install prompt (manifest) only
  'src/ui/developer.js', 'src/ui/diag.js', 'src/diag/report.js', 'src/ui/about.js', 'src/ui/licences.js',
  'src/ui/help.js', 'src/ui/privacy.js', 'src/ui/teach.js', 'src/ui/compare.js', 'src/store/compare.js',
  // 0.4.0 screen styles (V04-SPEC §F.6): never linked by index.html, main.js app.loadStyles(name) adds them on first use
  'styles/screens/sim.css', 'styles/screens/lab.css', 'styles/screens/share.css', 'styles/screens/quick.css',
]);
/**
 * Lazy path patterns (`*` = any file name within one directory): every launch-monitor screen and module
 * (LAUNCH-MONITOR-SPEC §0 budget, §5.0-11). physics/lm is imported dynamically by the analysis path, never the boot graph.
 */
export const LAZY_GLOBS = Object.freeze([
  'src/viz/*.js', 'src/ui/drills.js', 'src/ui/drill.js', 'src/ui/stats.js', 'src/ui/gapping.js', 'src/ui/tiles.js',
  'src/practice/*.js', 'src/store/stats.js', 'src/physics/lm/*.js',
  // 0.4.0 (V04-SPEC §F.7): every new module and screen
  'src/quick/*.js', 'src/course/*.js', 'src/sim/*.js', 'src/share/*.js', 'src/lab/*.js', 'src/contract/round.js',
  'src/ui/course.js', 'src/ui/round.js', 'src/ui/scorecard.js', 'src/ui/sim-banner.js', 'src/ui/quickcard.js',
  'src/ui/share.js', 'src/ui/lab.js', 'src/ui/patterns.js',
]);
const globRe = (g) => new RegExp(`^${g.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);
const LAZY_GLOB_RES = LAZY_GLOBS.map(globRe);
/** Is an app-relative path lazy (LAZY_FILES list or a LAZY_GLOBS pattern)? */
export function isLazyPath(rel) {
  return LAZY_EXACT.includes(rel) || LAZY_GLOB_RES.some((re) => re.test(rel));
}
/** Every lazy file of this tree: the exact list plus the files of app/ that match LAZY_GLOBS (sorted). */
export const LAZY_FILES = Object.freeze([...LAZY_EXACT, ...(() => {
  try { return listFiles(path.join(ROOT, 'app')).filter((f) => !LAZY_EXACT.includes(f) && LAZY_GLOB_RES.some((re) => re.test(f))); } catch (_) { return []; }
})()]);
/**
 * Rare screens' namespaces, plus the launch-monitor screens' (LAUNCH-MONITOR-SPEC §5.0-10; mounted after i18nComplete),
 * plus `metric` and `reason` (LM-A drop 1, shell budget §0): only screens mounted after i18nComplete show metric labels
 * or reason texts — home and onboarding (the boot graph) use neither (they format numbers with the `unit` namespace).
 */
export const LAZY_I18N_NAMESPACES = Object.freeze(['about', 'diag', 'help', 'legal', 'licence', 'privacy', 'teach',
  'tiles', 'viz', 'drill', 'stats', 'gapping', 'metric', 'reason',
  'quick', 'sim', 'course', 'score', 'share', 'lab', 'fault', 'patterns']); // 0.4.0 (V04-SPEC §F.5)
export const lazyCatalogUrl = (loc) => `i18n/${loc}.more.json`;
/** Namespace catalog sources (merged by mergeCatalogs, not copied). */
export const CATALOG_SOURCE_RE = /^i18n\/([A-Za-z-]+)\/([a-z0-9_-]+)\.json$/;
const MARKER = '.gsl-build';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function parseArgs(argv) {
  const o = { dev: false, out: path.join(ROOT, 'dist'), quiet: false, app: path.join(ROOT, 'app'), includeGolfdbModel: false, keepComments: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dev') o.dev = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--no-bundled-model') o.includeGolfdbModel = false; // the default; kept for older callers
    else if (a === '--include-golfdb-model') o.includeGolfdbModel = true;
    else if (a === '--keep-comments') o.keepComments = true;
    else if (a === '--out') o.out = path.resolve(argv[++i] ?? '');
    else if (a.startsWith('--out=')) o.out = path.resolve(a.slice(6));
    else if (a === '--app') o.app = path.resolve(argv[++i] ?? '');
    else if (a === '-h' || a === '--help') { o.help = true; }
    else throw new Error(`build.mjs: unknown argument '${a}'`);
  }
  return o;
}

/** Sorted list of relative POSIX paths of files under dir (skipping dotfiles, *.bak, the SW template). */
export function listFiles(dir) {
  const out = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, r);
      else if (e.isFile()) {
        if (e.name.endsWith('.bak') || (!rel && SKIP_NAMES.has(e.name))) continue;
        out.push(r);
      }
    }
  };
  walk(dir, '');
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function classify(rel) {
  if (NOT_PRECACHED.includes(rel)) return 'none';
  if (isLazyPath(rel) || /^i18n\/[A-Za-z-]+\.more\.json$/.test(rel)) return 'asset';
  if (rel.startsWith('vendor/') || rel.startsWith('models/')) return RUNTIME_ONLY.includes(rel) ? 'runtime' : 'asset';
  return 'shell';
}

/**
 * Flat { fullKey: value } → prefix tree (keys sorted at every level; "" holds the value of a key that is also a prefix
 * of other keys; plural objects are leaves). Throws when expandCatalog would not give the flat catalog back (e.g. a
 * node whose children look like a plural object).
 */
export function catalogTree(flat) {
  const nodes = new Set();
  const tree = {};
  nodes.add(tree);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  for (const key of Object.keys(flat).sort()) {
    const parts = key.split('.');
    let node = tree;
    for (const p of parts.slice(0, -1)) {
      if (!has(node, p)) { node[p] = {}; nodes.add(node[p]); }
      else if (!nodes.has(node[p])) { node[p] = { '': node[p] }; nodes.add(node[p]); } // a key that is also a prefix
      node = node[p];
    }
    const last = parts.at(-1);
    if (has(node, last) && nodes.has(node[last])) node[last][''] = flat[key];
    else node[last] = flat[key];
  }
  const sortDeep = (o) => (nodes.has(o) ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortDeep(o[k])])) : o);
  const out = { $tree: 1, ...sortDeep(tree) };
  const back = expandCatalog(out);
  const same = Object.keys(back).length === Object.keys(flat).length && Object.keys(flat).every((k) => JSON.stringify(back[k]) === JSON.stringify(flat[k]));
  if (!same) throw new Error('build.mjs: catalog prefix tree does not round-trip (a key collides with a plural object?)');
  return out;
}

/**
 * Merge app/i18n/<locale>/<ns>.json → { locale: { '<ns>.<key>': value } } (sorted keys, `_context` stripped).
 * Values are strings or plural objects; nested plain objects in a file are flattened with dots.
 */
export function mergeCatalogs(appDir) {
  const dir = path.join(appDir, 'i18n');
  const out = {};
  if (!fs.existsSync(dir)) return out;
  const isPlural = (v) => v && typeof v === 'object' && typeof v.other === 'string';
  for (const loc of fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort()) {
    const flat = {};
    for (const f of fs.readdirSync(path.join(dir, loc)).filter((x) => x.endsWith('.json')).sort()) {
      const ns = f.slice(0, -5);
      let obj;
      try { obj = JSON.parse(fs.readFileSync(path.join(dir, loc, f), 'utf8')); } catch (e) { throw new Error(`build.mjs: i18n/${loc}/${f} is not valid JSON: ${e.message}`); }
      const walk = (prefix, o) => {
        for (const [k, v] of Object.entries(o)) {
          const key = `${prefix}.${k}`;
          if (k === '_context' || key.endsWith('._context')) continue;
          if (v && typeof v === 'object' && !Array.isArray(v) && !isPlural(v)) walk(key, v);
          else if (isPlural(v)) flat[key] = Object.fromEntries(Object.entries(v).filter(([c]) => c !== '_context'));
          else flat[key] = v;
        }
      };
      walk(ns, obj ?? {});
    }
    out[loc] = Object.fromEntries(Object.keys(flat).sort().map((k) => [k, flat[k]]));
  }
  return out;
}

const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof']);

/**
 * Remove // and /* *\/ comments from JavaScript source, keeping every newline (line numbers do not move) and every
 * string, template literal (with nested ${} code) and regex literal byte for byte. A line left blank loses its
 * indentation. Throws on an unterminated string/comment/regex (the caller then copies the file unchanged).
 */
export function stripJsComments(src, { squeeze = false } = {}) {
  let out = '';
  let i = 0;
  const n = src.length;
  const tpl = []; // brace depth at each open ${ of nested template literals
  let depth = 0;
  let prev = ''; // last significant token kind: 'id' word, 'num', ')' ']' '}' or punctuation
  let prevWord = '';
  const trimLine = () => { const k = out.lastIndexOf('\n') + 1; if (/^[ \t]*$/.test(out.slice(k))) out = out.slice(0, k); };
  let lineStart = true; // indentation (outside strings, templates and regexes) carries no meaning: dropped
  const regexAllowed = () => prev === '' || (prev === 'id' ? REGEX_AFTER_WORD.has(prevWord) : !(prev === 'num' || prev === ')' || prev === ']' || prev === '}' || prev === 'str'));
  function readString(q) {
    let j = i + 1;
    while (j < n && src[j] !== q) { if (src[j] === '\\') j++; else if (src[j] === '\n') throw new Error('unterminated string'); j++; }
    if (j >= n) throw new Error('unterminated string');
    out += src.slice(i, j + 1); i = j + 1; prev = 'str';
  }
  function readTemplateChunk() { // at a backtick or after the } closing a ${: copy until ` (end) or ${ (push)
    let j = i;
    while (j < n) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === '`') { out += src.slice(i, j + 1); i = j + 1; prev = 'str'; return; }
      if (src[j] === '$' && src[j + 1] === '{') { out += src.slice(i, j + 2); i = j + 2; tpl.push(depth); depth++; prev = '{'; return; }
      j++;
    }
    throw new Error('unterminated template');
  }
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { const j = src.indexOf('\n', i); trimLine(); i = j < 0 ? n : j; continue; }
    if (c === '/' && d === '*') {
      const j = src.indexOf('*/', i + 2);
      if (j < 0) throw new Error('unterminated comment');
      const nl = (src.slice(i, j).match(/\n/g) || []).length;
      if (nl) { trimLine(); out += '\n'.repeat(nl); lineStart = true; } else if (!lineStart) out += ' ';
      i = j + 2; continue;
    }
    if (c === '\n') { out += c; i++; lineStart = true; continue; }
    if (lineStart && (c === ' ' || c === '\t')) { i++; continue; }
    lineStart = false;
    if (c === '"' || c === "'") { readString(c); continue; }
    if (c === '`') { i++; out += '`'; readTemplateChunk(); continue; }
    if (c === '/' && regexAllowed()) {
      let j = i + 1; let cls = false;
      while (j < n) {
        const e = src[j];
        if (e === '\\') { j += 2; continue; }
        if (e === '\n') throw new Error('unterminated regex');
        if (cls) { if (e === ']') cls = false; } else if (e === '[') cls = true; else if (e === '/') break;
        j++;
      }
      if (j >= n) throw new Error('unterminated regex');
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      out += src.slice(i, j); i = j; prev = 'str'; continue;
    }
    if (c === '{') { depth++; out += c; i++; prev = '{'; continue; }
    if (c === '}') {
      if (tpl.length && tpl[tpl.length - 1] === depth - 1) { depth--; tpl.pop(); out += '}'; i++; readTemplateChunk(); continue; }
      depth--; out += c; i++; prev = '}'; continue;
    }
    if (/[A-Za-z_$\u0080-\uffff]/.test(c)) {
      let j = i + 1; while (j < n && /[\w$\u0080-\uffff]/.test(src[j])) j++;
      prevWord = src.slice(i, j); prev = 'id'; out += prevWord; i = j; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(d ?? ''))) {
      let j = i + 1; while (j < n && /[\w.]/.test(src[j])) j++;
      out += src.slice(i, j); i = j; prev = 'num'; continue;
    }
    if (/\s/.test(c)) {
      if (!squeeze) { out += c; i++; continue; }
      // squeeze: a run of in-line whitespace between tokens is dropped unless removing it would join two tokens
      // (word·word, + +, - -, / / or / *, digit .) or it ends the line
      let j = i; while (j < n && src[j] !== '\n' && /\s/.test(src[j])) j++;
      const a = out[out.length - 1] ?? '';
      const b = src[j] ?? '';
      i = j;
      if (b === '\n' || b === '') continue;
      const word = (x) => /[\w$#\u0080-\uffff]/.test(x);
      if ((word(a) && word(b)) || (a === '+' && b === '+') || (a === '-' && b === '-') || (a === '/' && (b === '/' || b === '*'))
        || (/[0-9]/.test(a) && b === '.')) out += ' ';
      continue;
    }
    out += c; i++; prev = c === ')' || c === ']' ? c : 'p';
  }
  return squeeze ? out.replace(/[ \t]+\n/g, '\n') : out;
}

/** Remove /* *\/ comments from CSS (strings kept), keeping newlines. */
export function stripCssComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'") { let j = i + 1; while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; } out += src.slice(i, j + 1); i = j + 1; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2);
      if (j < 0) throw new Error('unterminated comment');
      const nl = (src.slice(i, j).match(/\n/g) || []).length;
      out += nl ? '\n'.repeat(nl) : ' ';
      i = j + 2; continue;
    }
    out += c; i++;
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/^[ \t]+/gm, '');
}

/**
 * Shipped CSS: comments stripped, then every whitespace run outside strings collapsed to one space, and the space
 * next to `{` `}` `;` `,` and after `:` dropped, as is the `;` before `}`. Whitespace that separates selector parts
 * (descendant combinator, `a :hover`) or calc() operands (`a + b`) is kept.
 */
export function minifyCss(src) {
  const s = stripCssComments(src);
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '"' || c === "'") { let j = i + 1; while (j < n && s[j] !== c) { if (s[j] === '\\') j++; j++; } out += s.slice(i, j + 1); i = j + 1; continue; }
    if (/\s/.test(c)) {
      let j = i; while (j < n && /\s/.test(s[j])) j++;
      const a = out[out.length - 1] ?? '';
      const b = s[j] ?? '';
      i = j;
      if (a === '' || b === '' || '{};,:'.includes(a) || '{};,'.includes(b)) continue;
      out += ' ';
      continue;
    }
    if (c === '}' && out.endsWith(';')) out = out.slice(0, -1);
    out += c; i++;
  }
  return out;
}

/** Bytes to write for a copied file (comments stripped from app JS/CSS unless keepComments). */
export function transformFile(rel, buf, { keepComments = false } = {}) {
  if (keepComments) return buf;
  try {
    if (/^src\/.*\.js$/.test(rel)) return Buffer.from(stripJsComments(buf.toString('utf8'), { squeeze: true }), 'utf8');
    if (/^styles\/.*\.css$/.test(rel)) return Buffer.from(minifyCss(buf.toString('utf8')), 'utf8');
  } catch (_) {
    return buf; // a file the lexer cannot follow is shipped as it is
  }
  return buf;
}

/** The VERSION hash text and value for precached entries [{ url, sha256 }]. */
export function versionOf(semver, entries) {
  const sorted = entries.filter((e) => !HASH_EXCLUDED.includes(e.url)).sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  const text = sorted.map((e) => `${e.url}\n${e.sha256}\n`).join('');
  return `${semver}+${sha256(Buffer.from(text, 'utf8')).slice(0, 10)}`;
}

/** The generated src/version.js (ES module; app/src/version.js is the unbuilt placeholder with nulls). */
export function versionModule({ version, semver, devResearch = false, bundled = false, modules = null }) {
  const build = String(version).split('+')[1]?.slice(0, 7) ?? null;
  return [
    '// generated by scripts/build.mjs — do not edit (app/src/version.js is the unbuilt placeholder)',
    `export const APP_VERSION = ${JSON.stringify(version)};`,
    `export const APP_SEMVER = ${JSON.stringify(semver)};`,
    `export const APP_BUILD = ${JSON.stringify(build)};`,
    `export const DEV_RESEARCH = ${devResearch ? 'true' : 'false'};`,
    `export const BUNDLED_EVENT_MODEL = ${bundled ? 'true' : 'false'};`,
    '/** app modules in this build (paths relative to src/): main.js imports an optional screen only when it is here */',
    `export const PRESENT_MODULES = ${modules ? JSON.stringify(modules) : 'null'};`,
    '',
  ].join('\n');
}

// whitespace around `from` is optional: the squeezed dist/ JS reads `import{a}from'./a.js'` (the graph is built from it)
const IMPORT_RE = /(?:^|[;\n}])\s*(?:import|export)\s*(?:[\w*${}\s,]*?from\s*)?['"](\.{1,2}\/[^'"]+)['"]/g;
/** Static (not dynamic) relative imports of an ES module source. */
export function staticImports(src) {
  return [...String(src).matchAll(IMPORT_RE)].map((m) => m[1]);
}

/** Breadth-first static import graph from the entries that exist (`files`: Map rel → bytes); entries first. */
export function bootGraph(files, entries) {
  const out = [];
  const seen = new Set();
  const queue = entries.filter((e) => files.has(e));
  for (const e of queue) seen.add(e);
  while (queue.length) {
    const rel = queue.shift();
    out.push(rel);
    for (const spec of staticImports(files.get(rel).toString('utf8'))) {
      const dep = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
      if (!seen.has(dep) && files.has(dep) && dep.endsWith('.js')) { seen.add(dep); queue.push(dep); }
    }
  }
  return out;
}

/** index.html with <link rel="modulepreload"> for each module, before the main.js module script. */
export function injectModulepreload(html, modules) {
  const marker = /([ \t]*)<script type="module" src="src\/main\.js"><\/script>/;
  if (!modules.length || !marker.test(html)) return Buffer.from(html, 'utf8'); // no main.js module script: nothing to preload
  html = html.replace(/<html(\s[^>]*)?>/, (m, a = '') => `<html${a} data-built>`); // boot-watchdog.js: merged catalogs exist
  return Buffer.from(html.replace(marker, (m, ind) => modules.map((u) => `${ind}<link rel="modulepreload" href="${u}">\n`).join('') + m), 'utf8');
}

function prepareOut(out, app) {
  if (path.resolve(out) === path.resolve(app) || path.resolve(out) === ROOT) throw new Error('build.mjs: --out must not be app/ or the repo root');
  if (fs.existsSync(out)) {
    const entries = fs.readdirSync(out);
    if (entries.length && !entries.includes(MARKER)) throw new Error(`build.mjs: ${out} is not empty and not a previous build (no ${MARKER}); refusing to wipe it`);
    fs.rmSync(out, { recursive: true, force: true });
  }
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, MARKER), 'golf-swing-lab build output; safe to delete\n');
}

export function build(opts = {}) {
  const o = { dev: false, out: path.join(ROOT, 'dist'), app: path.join(ROOT, 'app'), quiet: false, includeGolfdbModel: false, keepComments: false, ...opts };
  // legacy option: noBundledModel:false used to mean "bundle"; only an explicit includeGolfdbModel bundles now
  const withModel = o.includeGolfdbModel === true;
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const all = listFiles(o.app).filter((f) => !CATALOG_SOURCE_RE.test(f) && !SOURCE_ONLY.includes(f));
  const excluded = withModel ? [] : all.filter((f) => EVENT_MODEL_FILES.includes(f));
  const catalogs = mergeCatalogs(o.app);
  const generated = new Map();
  for (const [loc, flat] of Object.entries(catalogs)) {
    const isLazy = (k) => LAZY_I18N_NAMESPACES.includes(k.split('.')[0]);
    const core = Object.fromEntries(Object.entries(flat).filter(([k]) => !isLazy(k)));
    const more = Object.fromEntries(Object.entries(flat).filter(([k]) => isLazy(k)));
    const tree = catalogTree(core);
    if (Object.keys(more).length) {
      generated.set(lazyCatalogUrl(loc), Buffer.from(JSON.stringify(catalogTree(more)) + '\n', 'utf8'));
      tree.$lazy = lazyCatalogUrl(loc).slice('i18n/'.length); // relative to i18n/
    }
    generated.set(`i18n/${loc}.json`, Buffer.from(JSON.stringify(tree) + '\n', 'utf8'));
  }
  const files = [...all.filter((f) => !excluded.includes(f)), ...generated.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  prepareOut(o.out, o.app);
  const shell = [];
  const assets = [];
  const bundled = EVENT_MODEL_FILES.every((f) => files.includes(f));
  // pass 1: transformed bytes of every file except the generated version module and index.html (needs the graph)
  const bytes = new Map();
  for (const rel of files) {
    if (rel === VERSION_FILE || rel === 'index.html') continue;
    bytes.set(rel, generated.get(rel) ?? transformFile(rel, fs.readFileSync(path.join(o.app, rel)), { keepComments: o.keepComments }));
  }
  bytes.set(VERSION_FILE, Buffer.from(versionModule({ version: '0.0.0+0000000000', semver: pkg.version }), 'utf8')); // leaf placeholder for the graph
  const boot = bootGraph(bytes, BOOT_ENTRIES);
  const preload = boot.slice(0, MODULEPRELOAD_MAX);
  const indexHtml = fs.readFileSync(path.join(o.app, 'index.html'), 'utf8');
  for (const f of files.filter(isLazyPath)) {
    if (boot.includes(f)) throw new Error(`build.mjs: lazy file ${f} is in the boot graph (static import from ${BOOT_ENTRIES.join(', ')})`);
    if (indexHtml.includes(`"${f}"`)) throw new Error(`build.mjs: lazy file ${f} is referenced by index.html`);
  }
  bytes.delete(VERSION_FILE);
  bytes.set('index.html', injectModulepreload(indexHtml, preload));
  // pass 2: VERSION over everything but src/version.js, then the version module itself
  const pre0 = [];
  for (const [rel, buf] of bytes) if (classify(rel) === 'shell' || (classify(rel) === 'asset')) pre0.push({ url: rel, sha256: sha256(buf) });
  const version = versionOf(pkg.version, pre0);
  if (!files.includes(VERSION_FILE)) files.push(VERSION_FILE);
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const modules = files.filter((f) => /^src\/.+\.js$/.test(f)).map((f) => f.slice(4));
  bytes.set(VERSION_FILE, Buffer.from(versionModule({ version, semver: pkg.version, devResearch: withModel, bundled, modules }), 'utf8'));
  for (const rel of files) {
    const buf = bytes.get(rel);
    const dst = path.join(o.out, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, buf);
    const kind = classify(rel);
    const entry = { url: rel, bytes: buf.length, sha256: sha256(buf) };
    if (kind === 'shell') shell.push(entry);
    else if (kind === 'asset') assets.push({ ...entry, precache: true });
    else if (kind === 'runtime') assets.push({ ...entry, precache: false });
  }
  if (!shell.some((e) => e.url === 'index.html')) throw new Error('build.mjs: app/index.html is missing');
  const precached = [...shell, ...assets.filter((a) => a.precache)];
  if (versionOf(pkg.version, precached) !== version) throw new Error('build.mjs: VERSION changed between passes (internal error)');
  const shellBytes = shell.reduce((s, e) => s + e.bytes, 0);
  const precacheBytes = precached.reduce((s, e) => s + e.bytes, 0);
  const runtimeBytes = assets.filter((a) => !a.precache).reduce((s, e) => s + e.bytes, 0);

  const manifest = {
    version,
    dev: Boolean(o.dev),
    shell: shell.map((e) => e.url),
    assets: assets.map((a) => ({ url: a.url, sha256: a.sha256, precache: a.precache })),
  };
  const tpl = fs.readFileSync(path.join(o.app, 'sw.template.js'), 'utf8');
  const re = /\/\*__GSL_MANIFEST__\*\/[\s\S]*?\/\*__GSL_MANIFEST_END__\*\//;
  if (!re.test(tpl)) throw new Error('build.mjs: manifest markers not found in app/sw.template.js');
  const sw = tpl.replace(re, () => JSON.stringify(manifest));
  fs.writeFileSync(path.join(o.out, 'sw.js'), sw);
  const report = {
    schema: 'gsl-precache/1',
    version,
    semver: pkg.version,
    dev: Boolean(o.dev),
    bundled_event_model: bundled,
    dev_research: withModel,
    excluded,
    hash: 'sha256 over concat(sorted by url of precached entries except src/version.js: `${url}\\n${sha256hex(content)}\\n`), first 10 hex',
    modulepreload: preload,
    caches: { shell: `gsl-shell-${version}`, assets: 'gsl-assets' },
    budgets: BUDGETS,
    totals: { shell_bytes: shellBytes, precache_bytes: precacheBytes, runtime_bytes: runtimeBytes, files: files.length },
    shell,
    assets,
  };
  fs.writeFileSync(path.join(o.out, 'precache-manifest.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(o.out, '.nojekyll'), '');
  const problems = [];
  if (shellBytes > BUDGETS.shell_bytes) problems.push(`shell ${shellBytes} B > ${BUDGETS.shell_bytes} B`);
  if (precacheBytes > BUDGETS.precache_bytes) problems.push(`precache ${precacheBytes} B > ${BUDGETS.precache_bytes} B`);
  return { version, out: o.out, shellBytes, precacheBytes, runtimeBytes, files: files.length, shell, assets, problems, excluded, bundledEventModel: report.bundled_event_model, devResearch: withModel, modulepreload: preload, locales: Object.keys(catalogs) };
}

const MB = (n) => `${(n / 1e6).toFixed(3)} MB`;

function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(64); }
  if (o.help) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 34).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); return; }
  let r;
  try { r = build(o); } catch (e) { console.error(e.message); process.exit(1); }
  if (!o.quiet) {
    console.log(`VERSION ${r.version}${o.dev ? ' (dev)' : ''}${r.devResearch ? ' (DEV RESEARCH: GolfDB event model bundled; never deploy)' : ''}`);
    if (r.excluded.length) console.log(`excluded ${r.excluded.join(', ')} (no event model by default; --include-golfdb-model is dev-only)`);
    console.log(`preload  ${r.modulepreload.length} modules (<link rel=modulepreload>, max ${MODULEPRELOAD_MAX})`);
    console.log(`out      ${path.relative(ROOT, r.out) || r.out}  (${r.files} files)`);
    console.log(`shell    ${MB(r.shellBytes)}  (${r.shell.length} files, budget ${MB(BUDGETS.shell_bytes)})`);
    const pre = r.assets.filter((a) => a.precache);
    for (const a of pre) console.log(`  asset  ${MB(a.bytes).padStart(10)}  ${a.url}`);
    console.log(`precache ${MB(r.precacheBytes)}  (shell + ${pre.length} assets, budget ${MB(BUDGETS.precache_bytes)})`);
    console.log(`runtime  ${MB(r.runtimeBytes)}  (on demand: ${r.assets.filter((a) => !a.precache).map((a) => a.url).join(', ') || 'none'})`);
  }
  if (r.problems.length) {
    console.error(`FAIL budget: ${r.problems.join('; ')}`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
