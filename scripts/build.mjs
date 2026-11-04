#!/usr/bin/env node
// scripts/build.mjs — zero-dependency build of the static PWA (CAFCR R3/R4, docs/app-architecture.md §7).
//
//   node scripts/build.mjs [--dev] [--out DIR] [--quiet] [--no-bundled-model]
//
// 1. copies app/ → dist/ (or --out DIR; the directory is wiped only when it is empty, missing, or a previous build
//    marked by .gsl-build), skipping app/sw.template.js, *.bak and dotfiles;
// 2. precache list (scope-relative URLs): shell = every copied file outside vendor/ and models/; assets = vendor/ and
//    models/ files, all precached except RUNTIME_ONLY (cached in gsl-assets on first use) and NOT_SERVED_IN_PRECACHE;
// 3. VERSION = <package.json version> + '+' + first 10 hex of sha256 over the precache list contents, where the
//    hashed text is, for every precached entry sorted by URL (byte order): `${url}\n${sha256hex(file)}\n`;
// 4. writes dist/sw.js (from app/sw.template.js), dist/precache-manifest.json (schema gsl-precache/1, same data) and
//    dist/.nojekyll;
// 5. budgets: shell ≤ 1 MB and precache (shell + precached assets) ≤ 35 MB (10^6 bytes), else exit 1.
// --dev: identical file set and VERSION; sw.js serves the shell network-first (edits show without a version bump).
// --no-bundled-model: leave the GolfDB-derived event model (app/models/event-tcn-v1.*, CC BY-NC) out of dist/ and the
//    precache (licence switch, docs/ADR/0002-event-model-licence.md); the app then detects events with the rules and
//    offers 「可從檔案匯入事件模型」 (P9). precache-manifest.json records "bundled_event_model": false. Default: bundled.
// Deterministic: two builds of the same tree are byte-identical.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BUDGETS = Object.freeze({ shell_bytes: 1_000_000, precache_bytes: 35_000_000 });
/** Large files served and cached on first use only (heavy model 30.7 MB; the classic-script wasm variant). */
export const RUNTIME_ONLY = Object.freeze([
  'models/pose_landmarker_heavy.task',
  'vendor/mediapipe/wasm/vision_wasm_internal.js',
  'vendor/mediapipe/wasm/vision_wasm_internal.wasm',
]);
/** Copied but not precached (not needed at runtime). */
export const NOT_PRECACHED = Object.freeze(['vendor/manifest.json']);
/** Left out by --no-bundled-model (scope-relative paths). */
export const EVENT_MODEL_FILES = Object.freeze(['models/event-tcn-v1.bin', 'models/event-tcn-v1.json']);
const SKIP_NAMES = new Set(['sw.template.js']);
const MARKER = '.gsl-build';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function parseArgs(argv) {
  const o = { dev: false, out: path.join(ROOT, 'dist'), quiet: false, app: path.join(ROOT, 'app'), noBundledModel: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dev') o.dev = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--no-bundled-model') o.noBundledModel = true;
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
  if (rel.startsWith('vendor/') || rel.startsWith('models/')) return RUNTIME_ONLY.includes(rel) ? 'runtime' : 'asset';
  return 'shell';
}

/** The VERSION hash text and value for precached entries [{ url, sha256 }]. */
export function versionOf(semver, entries) {
  const sorted = [...entries].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  const text = sorted.map((e) => `${e.url}\n${e.sha256}\n`).join('');
  return `${semver}+${sha256(Buffer.from(text, 'utf8')).slice(0, 10)}`;
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
  const o = { dev: false, out: path.join(ROOT, 'dist'), app: path.join(ROOT, 'app'), quiet: false, noBundledModel: false, ...opts };
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const all = listFiles(o.app);
  const excluded = o.noBundledModel ? all.filter((f) => EVENT_MODEL_FILES.includes(f)) : [];
  const files = all.filter((f) => !excluded.includes(f));
  prepareOut(o.out, o.app);
  const shell = [];
  const assets = [];
  for (const rel of files) {
    const buf = fs.readFileSync(path.join(o.app, rel));
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
  const version = versionOf(pkg.version, precached);
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
    bundled_event_model: EVENT_MODEL_FILES.every((f) => files.includes(f)),
    excluded,
    hash: 'sha256 over concat(sorted by url of precached entries: `${url}\\n${sha256hex(content)}\\n`), first 10 hex',
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
  return { version, out: o.out, shellBytes, precacheBytes, runtimeBytes, files: files.length, shell, assets, problems, excluded, bundledEventModel: report.bundled_event_model };
}

const MB = (n) => `${(n / 1e6).toFixed(3)} MB`;

function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(64); }
  if (o.help) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 19).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); return; }
  let r;
  try { r = build(o); } catch (e) { console.error(e.message); process.exit(1); }
  if (!o.quiet) {
    console.log(`VERSION ${r.version}${o.dev ? ' (dev)' : ''}${o.noBundledModel ? ' (no bundled event model)' : ''}`);
    if (r.excluded.length) console.log(`excluded ${r.excluded.join(', ')} (--no-bundled-model)`);
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
