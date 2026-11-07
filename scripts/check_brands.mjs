#!/usr/bin/env node
// scripts/check_brands.mjs — brand / claim lint (V04-SPEC §I; verify.sh stage `brands`, after `static`).
//
//   node scripts/check_brands.mjs [--root DIR] [--json] [--quiet]
//
// Every pattern is written with a character class (golf[r], ma[n], si[m] …) so neither this script nor the spec that
// lists it matches itself. All rules are case-insensitive. Paths below are relative to the root:
//   competitor      \bgolf[r]\b                     every tracked file of the repo (git ls-files, plus untracked files
//                                                   that are not ignored) and every file under dist/; no exceptions
//   lm-brand        \btrack[ ]?ma[n]\b              app/**, dist/** (docs/ and the physics test comments may use it)
//   feature-names   \bpocket[ ]?si[m]\b, \brange[ ]?finde[r]\b, \bhighlight[s]\b
//                                                   app/i18n/** (every value) and the string literals of app/src/**/*.js
//                                                   (comments ignored; share file names are string literals there);
//                                                   the CSS property -webkit-tap-highlight-color is allowed
//   accuracy-claim  (準確|精準|準度|accura)[^"]{0,24}\d{1,3}\s?%  and  \d{1,3}\s?%[^"]{0,24}(準確|精準|準度|accura)
//                                                   app/i18n/**, dist/i18n/**
//   vendor-ban      ultralytics, opencv             app/src/**, app/i18n/**, app/styles/**, dist/** except dist/vendor/
//                                                   and dist/models/ (vendored MediaPipe binaries embed OpenCV, pinned by
//                                                   scripts/vendor.mjs); the camera-axis convention "(OpenCV:" / "(OpenCV)"
//                                                   in a comment is allowed (LAUNCH-MONITOR-SPEC §5.2)
// --root DIR: a repo-like tree (rules by the paths above; a git work tree uses git ls-files, any other tree is walked)
// or a build output (a DIR holding precache-manifest.json: every file counts as dist/<path>). Binary files (a NUL byte
// in the first 8 KB) are skipped. Exit code 1 when any finding, else 0; 64 on usage errors.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripJsComments } from './build.mjs';
import { stringLiterals } from './check_contract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const RULES = Object.freeze([
  { id: 'competitor', res: [/\bgolf[r]\b/gi], scope: () => true },
  { id: 'lm-brand', res: [/\btrack[ ]?ma[n]\b/gi], scope: (p) => p.startsWith('app/') || p.startsWith('dist/') },
  {
    id: 'feature-names', res: [/\bpocket[ ]?si[m]\b/gi, /\brange[ ]?finde[r]\b/gi, /\bhighlight[s]\b/gi],
    scope: (p) => p.startsWith('app/i18n/') || (p.startsWith('app/src/') && /\.m?js$/.test(p)),
    segments: (p, src) => (p.startsWith('app/src/') ? jsSegments(src) : [{ value: src, index: 0 }])
      .map((g) => ({ ...g, value: g.value.replace(/-webkit-tap-highlight-colou?r/gi, (m) => ' '.repeat(m.length)) })),
  },
  {
    id: 'accuracy-claim',
    res: [/(準確|精準|準度|accura)[^"]{0,24}\d{1,3}\s?%/gi, /\d{1,3}\s?%[^"]{0,24}(準確|精準|準度|accura)/gi],
    scope: (p) => p.startsWith('app/i18n/') || p.startsWith('dist/i18n/'),
  },
  {
    id: 'vendor-ban', res: [/ultralytics/gi, /opencv/gi],
    scope: (p) => /^app\/(src|i18n|styles)\//.test(p) || (p.startsWith('dist/') && !/^dist\/(vendor|models)\//.test(p)),
    allowLine: (line) => /\(opencv[:)]/i.test(line),
  },
]);

/**
 * The string literals of a JS source as [{ value, index }] (index into the source; stripJsComments keeps every newline,
 * so line numbers match): quoted strings, and template literals with each ${…} blanked out. Comments are dropped.
 */
export function jsSegments(src) {
  let code = src;
  try { code = stripJsComments(src); } catch (_) { /* keep the raw text */ }
  const out = stringLiterals(code).map((l) => ({ value: l.value, index: l.index }));
  for (const m of code.matchAll(/`((?:\\.|[^`\\])*)`/g)) out.push({ value: m[1].replace(/\$\{[^}]*\}/g, (x) => ' '.repeat(x.length)), index: m.index, code });
  return out.map((g) => ({ ...g, code }));
}
/** The string-literal text of a JS source, one literal per line (tests). */
export const jsStrings = (src) => jsSegments(src).map((g) => g.value).join('\n');

function walk(dir, rel = '', out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), r, out);
    else if (e.isFile()) out.push(r);
  }
  return out;
}

/** [{ virtual path, absolute path }] of everything the rules look at under `root`. */
export function listTargets(root) {
  if (fs.existsSync(path.join(root, 'precache-manifest.json'))) return walk(root).map((r) => ({ p: `dist/${r}`, abs: path.join(root, r) }));
  let files = null;
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' });
  if (top.status === 0 && path.resolve(top.stdout.trim()) === fs.realpathSync(path.resolve(root))) {
    const ls = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
    if (ls.status === 0) files = ls.stdout.split('\0').filter(Boolean).filter((r) => !r.startsWith('dist/'));
  }
  if (!files) files = walk(root).filter((r) => !r.startsWith('dist/'));
  const out = files.map((r) => ({ p: r, abs: path.join(root, r) }));
  const dist = path.join(root, 'dist');
  if (fs.existsSync(dist) && fs.statSync(dist).isDirectory()) out.push(...walk(dist).map((r) => ({ p: `dist/${r}`, abs: path.join(dist, r) })));
  return out;
}

const lineAt = (s, i) => s.slice(0, i).split('\n').length;

/** Scan `root`: { findings: [{ rule, path, line, text }], files }. */
export function checkBrands(root = ROOT) {
  const findings = [];
  let files = 0;
  for (const { p, abs } of listTargets(root)) {
    const rules = RULES.filter((r) => r.scope(p));
    if (!rules.length) continue;
    let buf;
    try { buf = fs.readFileSync(abs); } catch (_) { continue; } // a deleted-but-tracked file
    if (buf.subarray(0, 8192).includes(0)) continue; // binary
    files++;
    const src = buf.toString('utf8');
    const lines = src.split('\n');
    for (const rule of rules) {
      const segs = rule.segments ? rule.segments(p, src) : [{ value: src, index: 0 }];
      for (const g of segs) {
        for (const re of rule.res) {
          for (const m of g.value.matchAll(re)) {
            const line = lineAt(g.code ?? src, g.index + (g.code ? 0 : m.index)); // a literal: the line it starts on
            if (rule.allowLine && rule.allowLine(lines[line - 1] ?? '')) continue;
            findings.push({ rule: rule.id, path: p, line, text: m[0] });
          }
        }
      }
    }
  }
  return { findings, files };
}

function main(argv) {
  let root = ROOT;
  let json = false;
  let quiet = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') root = path.resolve(argv[++i] ?? '');
    else if (a.startsWith('--root=')) root = path.resolve(a.slice(7));
    else if (a === '--json') json = true;
    else if (a === '--quiet') quiet = true;
    else { console.error(`check_brands: unknown argument '${a}'`); return 64; }
  }
  if (!fs.existsSync(root)) { console.error(`check_brands: no such directory ${root}`); return 64; }
  const { findings, files } = checkBrands(root);
  if (json) console.log(JSON.stringify({ root, files, findings }, null, 2));
  else {
    for (const f of findings) console.log(`FAIL ${f.rule} ${f.path}:${f.line} ${JSON.stringify(f.text)}`);
    if (!quiet || findings.length) console.log(`check_brands: ${findings.length} finding(s) in ${files} file(s) under ${path.relative(process.cwd(), root) || '.'}`);
  }
  return findings.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
