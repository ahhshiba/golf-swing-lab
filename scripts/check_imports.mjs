#!/usr/bin/env node
// scripts/check_imports.mjs - static import/export resolution check for app/ (verify.sh stage "static").
//
//   node scripts/check_imports.mjs [--root app] [--quiet]
//
// For every app/src/**/*.js|.mjs (vendor excluded as a scan root, but followed when imported):
//   1. every static `import ... from 'x'`, `import 'x'`, `export ... from 'x'` resolves to an existing file (no bare
//      specifiers: the app is served as plain ES modules), and every imported name is exported by the target
//      (following `export * from` chains);
//   2. every literal dynamic `import('x')` and `new URL('x', import.meta.url)` resolves to an existing file, and names
//      destructured from `await import('x')` exist;
//   3. the optional-module map in app/src/main.js (`OPTIONAL = {key: './path.js'}`) resolves, and every
//      `deps.<key>.<name>` / `app.deps.<key>?.<name>` / `const m = app.deps.<key>; m.<name>` use names an export;
//   4. authoritative cross-check: the whole static graph is linked with node:vm SourceTextModule (needs
//      --experimental-vm-modules; the script re-executes itself with it), which fails exactly where a browser would.
// Exit code = number of problems (capped at 255).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!process.execArgv.includes('--experimental-vm-modules')) {
  const r = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
const vm = await import('node:vm');

let appRoot = path.join(ROOT, 'app');
let quiet = false;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--root' && process.argv[i + 1]) appRoot = path.resolve(process.argv[++i]);
  else if (process.argv[i] === '--quiet') quiet = true;
  else { console.error('usage: check_imports.mjs [--root app] [--quiet]'); process.exit(64); }
}
const SRC = path.join(appRoot, 'src');
const problems = [];
const rel = (p) => path.relative(ROOT, p);
const problem = (file, msg) => problems.push(`${rel(file)}: ${msg}`);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'vendor' && e.name !== 'node_modules') walk(p, out); } else if (/\.m?js$/.test(e.name)) out.push(p);
  }
  return out;
}

// Remove comments, keep strings (imports live in strings). Regex literals are rare in import positions; a regex
// literal containing quotes may confuse this pass, which is why step 4 (the real linker) is authoritative.
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const j = src.indexOf('*/', i + 2); const end = j < 0 ? n : j + 2; out += src.slice(i, end).replace(/[^\n]/g, ' '); i = end; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    out += c; i++;
  }
  return out;
}

const cache = new Map();
function parse(file) {
  if (cache.has(file)) return cache.get(file);
  const src = stripComments(fs.readFileSync(file, 'utf8'));
  const info = { file, imports: [], stars: [], exports: new Set(), dynamic: [], urls: [], src };
  cache.set(file, info);
  // static imports
  for (const m of src.matchAll(/(?:^|[;\n}])\s*import\s+([^'"`;]*?)\s*from\s*(['"])([^'"]+)\2/g)) {
    info.imports.push({ spec: m[3], names: importNames(m[1]) });
  }
  for (const m of src.matchAll(/(?:^|[;\n}])\s*import\s*(['"])([^'"]+)\1/g)) info.imports.push({ spec: m[2], names: [] });
  // re-exports
  for (const m of src.matchAll(/(?:^|[;\n}])\s*export\s*\*\s*(?:as\s+([\w$]+)\s*)?from\s*(['"])([^'"]+)\2/g)) {
    if (m[1]) { info.exports.add(m[1]); info.imports.push({ spec: m[3], names: [] }); } else info.stars.push(m[3]);
  }
  for (const m of src.matchAll(/(?:^|[;\n}])\s*export\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/g)) {
    const names = [];
    for (const part of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      const [orig, alias] = part.split(/\s+as\s+/).map((s) => s.trim());
      names.push(orig);
      info.exports.add(alias ?? orig);
    }
    info.imports.push({ spec: m[3], names: names.filter((x) => x !== 'default' || true) });
  }
  // local exports
  for (const m of src.matchAll(/(?:^|[;\n}])\s*export\s+(?:async\s+)?function\s*\*?\s*([\w$]+)/g)) info.exports.add(m[1]);
  for (const m of src.matchAll(/(?:^|[;\n}])\s*export\s+class\s+([\w$]+)/g)) info.exports.add(m[1]);
  for (const m of src.matchAll(/(?:^|[;\n}])\s*export\s+(?:const|let|var)\s+([^=;]+?)\s*=/g)) {
    const lhs = m[1].trim();
    if (/^[\w$]+$/.test(lhs)) info.exports.add(lhs);
    else for (const id of lhs.replace(/[{}[\]]/g, ' ').split(',')) { const t = id.split(':').pop().trim(); if (/^[\w$]+$/.test(t)) info.exports.add(t); }
  }
  for (const m of src.matchAll(/(?:^|[;\n}])\s*export\s+default\b/g)) { void m; info.exports.add('default'); }
  for (const m of src.matchAll(/(?:^|[;\n}])\s*export\s*\{([^}]*)\}\s*(?!\s*from)/g)) {
    for (const part of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      const bits = part.split(/\s+as\s+/).map((s) => s.trim());
      info.exports.add(bits[1] ?? bits[0]);
    }
  }
  // dynamic import literals (+ destructured names)
  for (const m of src.matchAll(/(?:\{([^{}]*)\}\s*=\s*)?(?:\(\s*)?await\s+import\(\s*(['"])([^'"]+)\2\s*\)\s*\)?(?:\.([\w$]+))?/g)) {
    const names = m[1] ? importNames(`{${m[1]}}`) : [];
    if (m[4] && m[4] !== 'then') names.push(m[4]);
    info.dynamic.push({ spec: m[3], names });
  }
  for (const m of src.matchAll(/(?<!await\s+)\bimport\(\s*(['"])([^'"]+)\1\s*\)/g)) {
    if (!info.dynamic.some((d) => d.spec === m[2])) info.dynamic.push({ spec: m[2], names: [] });
  }
  for (const m of src.matchAll(/new\s+URL\(\s*(['"])([^'"`$]+)\1\s*,\s*import\.meta\.url\s*\)/g)) info.urls.push(m[2]);
  return info;
}

function importNames(clause) {
  const names = [];
  let c = clause.trim();
  if (!c) return names;
  if (/^\*\s*as\s+/.test(c)) return names;
  const brace = c.match(/\{([^}]*)\}/);
  const head = c.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
  if (head && !/^\*\s*as/.test(head)) {
    const def = head.split(/\s+/)[0];
    if (def && def !== '*') names.push('default');
  }
  if (brace) {
    for (const part of brace[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      const orig = part.split(/\s+as\s+|\s*:\s*/)[0].trim();
      if (orig) names.push(orig);
    }
  }
  return names;
}

function resolveSpec(from, spec) {
  if (!/^\.{1,2}\//.test(spec) && !spec.startsWith('/')) return { bare: true };
  const p = path.resolve(path.dirname(from), spec);
  return { path: p, exists: fs.existsSync(p) && fs.statSync(p).isFile() };
}

function exportsOf(file, seen = new Set()) {
  if (seen.has(file)) return new Set();
  seen.add(file);
  const info = parse(file);
  const all = new Set(info.exports);
  for (const s of info.stars) {
    const r = resolveSpec(file, s);
    if (r.exists) for (const n of exportsOf(r.path, seen)) if (n !== 'default') all.add(n);
  }
  return all;
}

const files = walk(SRC).sort();
const visited = new Set();
const queue = [...files];
let staticEdges = 0;
while (queue.length) {
  const f = queue.shift();
  if (visited.has(f)) continue;
  visited.add(f);
  const info = parse(f);
  const specs = [...info.imports, ...info.stars.map((s) => ({ spec: s, names: [] }))];
  for (const imp of specs) {
    staticEdges++;
    const r = resolveSpec(f, imp.spec);
    if (r.bare) { problem(f, `bare specifier '${imp.spec}' (browsers cannot resolve it without an import map)`); continue; }
    if (!r.exists) { problem(f, `import '${imp.spec}' -> ${rel(r.path)} does not exist`); continue; }
    queue.push(r.path);
    const ex = exportsOf(r.path);
    for (const n of imp.names) if (!ex.has(n)) problem(f, `imports '${n}' from '${imp.spec}', which does not export it`);
  }
  for (const d of info.dynamic) {
    const r = resolveSpec(f, d.spec);
    if (r.bare) { problem(f, `dynamic import of bare specifier '${d.spec}'`); continue; }
    if (!r.exists) { problem(f, `dynamic import('${d.spec}') -> ${rel(r.path)} does not exist`); continue; }
    if (/\.m?js$/.test(r.path)) {
      queue.push(r.path);
      const ex = exportsOf(r.path);
      for (const n of d.names) if (!ex.has(n)) problem(f, `uses '${n}' from import('${d.spec}'), which does not export it`);
    }
  }
  for (const u of info.urls) {
    const r = resolveSpec(f, u);
    if (!r.exists && !(fs.existsSync(r.path) && fs.statSync(r.path).isDirectory())) problem(f, `new URL('${u}', import.meta.url) -> ${rel(r.path)} does not exist`);
    else if (r.exists && /\.m?js$/.test(r.path) && !r.path.includes(`${path.sep}vendor${path.sep}`)) queue.push(r.path);
  }
}

// 3. main.js optional-module map and deps.<key>.<name> uses
const mainFile = path.join(SRC, 'main.js');
let depUses = 0;
if (fs.existsSync(mainFile)) {
  const msrc = parse(mainFile).src;
  const block = msrc.match(/OPTIONAL\s*=\s*Object\.freeze\(\s*\{([\s\S]*?)\}\s*\)/) || msrc.match(/OPTIONAL\s*=\s*\{([\s\S]*?)\}/);
  const map = {};
  if (block) for (const m of block[1].matchAll(/([\w$]+)\s*:\s*(['"])([^'"]+)\2/g)) map[m[1]] = m[3];
  for (const [k, spec] of Object.entries(map)) {
    const r = resolveSpec(mainFile, spec);
    if (!r.exists) problem(mainFile, `OPTIONAL.${k} = '${spec}' does not exist`);
  }
  const keys = Object.keys(map);
  if (keys.length) {
    const keyRe = keys.join('|');
    for (const f of files) {
      const src = parse(f).src;
      const check = (key, name, where) => {
        const r = resolveSpec(mainFile, map[key]);
        if (!r.exists) return;
        depUses++;
        if (!exportsOf(r.path).has(name)) problem(f, `${where} uses deps.${key}.${name}, but ${map[key]} does not export '${name}'`);
      };
      for (const m of src.matchAll(new RegExp(`\\bdeps\\??\\.(${keyRe})\\??\\.([\\w$]+)`, 'g'))) check(m[1], m[2], 'direct');
      for (const m of src.matchAll(new RegExp(`(?:const|let)\\s+([\\w$]+)\\s*=\\s*(?:[\\w$]+\\.)?deps\\??\\.(${keyRe})\\s*;`, 'g'))) {
        const alias = m[1];
        for (const u of src.matchAll(new RegExp(`(?<![\\w$.])${alias}\\??\\.([\\w$]+)`, 'g'))) check(m[2], u[1], `alias ${alias}`);
      }
    }
  }
}

// 4. authoritative link of the static graph
const modules = new Map();
function compile(file) {
  if (modules.has(file)) return modules.get(file);
  const m = new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { identifier: file, importModuleDynamically: () => { throw new Error('not evaluated'); }, initializeImportMeta: (meta) => { meta.url = `file://${file}`; } });
  modules.set(file, m);
  return m;
}
let linked = 0;
let linkErrors = 0;
for (const f of files) {
  let mod;
  try { mod = compile(f); } catch (e) { problem(f, `does not parse as a module: ${e.message}`); linkErrors++; continue; }
  if (mod.status !== 'unlinked') { linked++; continue; }
  try {
    await mod.link((spec, ref) => {
      const r = resolveSpec(ref.identifier, spec);
      if (r.bare || !r.exists) throw new Error(`cannot resolve '${spec}' from ${rel(ref.identifier)}`);
      return compile(r.path);
    });
    linked++;
  } catch (e) {
    linkErrors++;
    const msg = `link failed: ${e.message}`;
    if (!problems.some((p) => p.includes(e.message))) problem(f, msg);
  }
}

if (!quiet) {
  console.log(`check_imports: ${files.length} files under ${rel(SRC)}, ${visited.size} modules reached, ${staticEdges} static edges, ${depUses} deps.* uses, vm-linked ${linked}/${files.length}`);
}
for (const p of problems) console.log(`  ${p}`);
console.log(problems.length ? `check_imports: ${problems.length} problem(s)` : 'check_imports: all imports resolve');
process.exit(Math.min(problems.length, 255));
