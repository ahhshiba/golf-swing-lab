#!/usr/bin/env node
// scripts/check_i18n.mjs — i18n lint (PRODUCT-SPEC §3.6; verify.sh stage `i18n`).
//
//   node scripts/check_i18n.mjs [--strict] [--pkg foundation|practice|results|platform|events|trust|A..F]...
//                               [--ns a,b,…] [--json] [--quiet]
//
// Checks
//   catalog structure  every app/i18n/<locale>/<ns>.json parses, is a listed namespace of a listed locale
//                      (namespaces.json), has no key that repeats its own namespace ('home.home.x'); plural objects use
//                      Intl.PluralRules categories (zh-Hant: other only)
//   coverage           per namespace: keys in en vs keys in zh-Hant (must be equal sets, 100 %)
//   placeholders       the {name} set of a key is the same in both locales
//   copy rules (§2.4)  no value matches /\b[PCK]\d{1,2}\b|\b[A-Z]{3,}_[A-Z_]+\b|\.mjs\b|sha-?256|golden|GolfDB|tcn\b/i;
//                      en values contain no CJK (except language endonyms: keys *.language.<x> / *.locale.<x>)
//   code keys          every t('…') / plural('…') / msg({code:'…'}) literal key in app/src exists in both locales;
//                      template keys t(`club.${x}`) mark their literal prefix as used
//   unused keys        catalog keys no code uses; reported (never failing) — metric.* / reason.* / error.* are built
//                      dynamically and are checked against the registry ids, RC and the error codes instead
//   CJK literals       Han characters in app/src/**/*.js outside comments, counted per file and package
// Scope: a finding FAILS when it is in a namespace of the selected packages (default: foundation, i.e. A's own
// namespaces) or anywhere with --strict; outside the scope it is a WARN. CJK literals FAIL only with --strict (the
// integration switch, §8.7: 0 CJK literals in app/src); otherwise their count is reported.
// Exit code = number of FAIL findings (capped at 255); 64 on usage errors.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from './build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app');
const I18N = path.join(APP, 'i18n');

export const COPY_RULE = /\b[PCK]\d{1,2}\b|\b[A-Z]{3,}_[A-Z_]+\b|\.mjs\b|sha-?256|golden|GolfDB|tcn\b/i;
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/g;
const PKG_ALIAS = Object.freeze({ A: 'foundation', B: 'practice', C: 'results', D: 'platform', E: 'events', F: 'trust' });
const PLURAL_CATS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
/** Namespaces whose keys are built from code lists (reason codes, error codes, metric ids). */
const DYNAMIC_NS = new Set(['metric', 'reason', 'error']);
/** A language's own name ("繁體中文") is the same in every locale: allowed in en. */
const ENDONYM_KEY = /\.(language|locale)\.[\w-]+$/;

/** app/src file → owning package (PRODUCT-SPEC §8 owned paths; first match wins). */
const FILE_OWNERS = [
  [/^src\/(main|state|version|boot-watchdog)\.js$|^src\/ui\/(dom|components|icons|format)\.js$|^src\/i18n\/|^src\/contract\/reason-codes\.js$|^src\/metrics\/registry\.js$|^src\/session\/settings\.js$/, 'foundation'],
  [/^src\/ui\/(onboarding|home|venue|setup|live|magnifier|sensors|tripod-diagram|venues)\.js$|^src\/session\/bay\.js$|^src\/calib\/checks\.js$/, 'practice'],
  [/^src\/ui\/(import|shot|replay|history|teach|compare|glossary)\.js$|^src\/store\/(compare|labels|export)\.js$/, 'results'],
  [/^src\/events\/|^src\/pipeline\/clip\.js$|^src\/session\/models\.js$|^src\/contract\/enums\.js$/, 'events'],
  [/^src\/ui\/(settings|about|privacy|help|licences|developer)\.js$/, 'trust'],
  [/^src\/session\/(controller|health|thermal|ids)\.js$|^src\/store\/|^src\/workers\/|^src\/capture\/|^src\/import\/|^src\/pipeline\/(live|frames|assemble)\.js$|^src\/pose\/|^src\/diag\/|^src\/ui\/(diag|update)\.js$|^src\/audio\/|^src\/sensors\//, 'platform'],
];
export function ownerOfFile(rel) {
  for (const [re, pkg] of FILE_OWNERS) if (re.test(rel)) return pkg;
  return 'unowned';
}

function walk(dir, pred, base = dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'vendor') out.push(...walk(full, pred, base)); } else if (pred(e.name)) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

const isPlural = (v) => v && typeof v === 'object' && !Array.isArray(v) && typeof v.other === 'string' && Object.keys(v).every((k) => PLURAL_CATS.has(k) || k === '_context');
const placeholders = (v) => [...new Set([...JSON.stringify(v).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

/** { locale: Map(fullKey → { value, ns, file }) }, plus structural findings. */
export function loadCatalogs(index, push) {
  const out = {};
  for (const loc of fs.existsSync(I18N) ? fs.readdirSync(I18N, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []) {
    if (!index.locales.includes(loc)) push('structure', null, `app/i18n/${loc}/ is not a locale listed in namespaces.json`);
    const map = new Map();
    for (const f of fs.readdirSync(path.join(I18N, loc)).filter((x) => x.endsWith('.json')).sort()) {
      const ns = f.slice(0, -5);
      const rel = `app/i18n/${loc}/${f}`;
      if (!index.namespaces.includes(ns)) { push('structure', ns, `${rel}: '${ns}' is not a namespace in namespaces.json`); continue; }
      let obj;
      try { obj = JSON.parse(fs.readFileSync(path.join(I18N, loc, f), 'utf8')); } catch (e) { push('structure', ns, `${rel}: invalid JSON (${e.message})`); continue; }
      const visit = (prefix, o) => {
        for (const [k, v] of Object.entries(o ?? {})) {
          const key = prefix ? `${prefix}.${k}` : k;
          if (k === '_context' || key.endsWith('._context')) continue;
          if (v && typeof v === 'object' && !Array.isArray(v) && !isPlural(v)) { visit(key, v); continue; }
          if (typeof v !== 'string' && !isPlural(v)) push('structure', ns, `${rel}: ${key} is neither a string nor a plural object`);
          if (key.split('.')[0] === ns) push('structure', ns, `${rel}: key '${key}' repeats its namespace (keys are written without the '${ns}.' prefix)`);
          map.set(`${ns}.${key}`, { value: v, ns, file: rel });
        }
      };
      visit('', obj);
    }
    out[loc] = map;
  }
  return out;
}

/** Literal keys, dynamic prefixes and CJK literal counts from app/src. */
export function scanSources(files) {
  const keys = new Map(); // key -> [rel:line]
  const prefixes = new Set();
  const cjk = new Map(); // rel -> count of lines with CJK
  const add = (k, where) => { if (!keys.has(k)) keys.set(k, []); keys.get(k).push(where); };
  for (const rel of files) {
    const src = fs.readFileSync(path.join(APP, rel), 'utf8');
    let code;
    try { code = stripJsComments(src); } catch (_) { code = src; }
    const lines = code.split('\n');
    let n = 0;
    lines.forEach((ln, i) => { if (CJK_RE.test(ln)) n++; CJK_RE.lastIndex = 0; void i; });
    if (n) cjk.set(rel, n);
    const lineOf = (idx) => code.slice(0, idx).split('\n').length;
    for (const m of code.matchAll(/\b(?:t|plural|tt|T)\(\s*(['"])([a-z][\w-]*(?:\.[\w-]+)+)\1/g)) add(m[2], `${rel}:${lineOf(m.index)}`);
    for (const m of code.matchAll(/\bcode\s*:\s*(['"])([a-z][\w-]*(?:\.[\w-]+)+)\1/g)) add(m[2], `${rel}:${lineOf(m.index)}`);
    for (const m of code.matchAll(/\b(?:t|plural|has|tt|T)\(\s*`([^`$]*)(\$\{)?/g)) {
      if (m[2]) { if (m[1]) prefixes.add(m[1]); } else if (/^[a-z][\w-]*(\.[\w-]+)+$/.test(m[1])) add(m[1], `${rel}:${lineOf(m.index)}`);
    }
    for (const m of code.matchAll(/\bhas\(\s*(['"])([a-z][\w-]*(?:\.[\w-]+)+)\1/g)) prefixes.add(m[2]); // guarded: may be absent
  }
  return { keys, prefixes, cjk };
}

export function checkI18n({ strict = false, pkgs = ['foundation'], ns = null } = {}) {
  const findings = []; // { kind, ns, msg, level }
  const index = JSON.parse(fs.readFileSync(path.join(I18N, 'namespaces.json'), 'utf8'));
  const owners = index.owners ?? {};
  const nsOwner = new Map(Object.entries(owners).flatMap(([p, list]) => list.map((n) => [n, p])));
  const scopeNs = new Set(ns ?? pkgs.flatMap((p) => owners[p] ?? []));
  const inScope = (n) => strict || (n !== null && scopeNs.has(n));
  const push = (kind, n, msg) => findings.push({ kind, ns: n, msg, level: inScope(n) || n === null ? 'FAIL' : 'WARN' });

  // namespaces.json itself
  const all = Object.values(owners).flat();
  if (new Set(all).size !== all.length) push('structure', null, 'namespaces.json: a namespace has more than one owner');
  for (const n of index.namespaces) if (!nsOwner.has(n)) push('structure', null, `namespaces.json: '${n}' has no owner`);

  const cat = loadCatalogs(index, push);
  const zh = cat['zh-Hant'] ?? new Map();
  const en = cat.en ?? new Map();
  const zhP = new Intl.PluralRules('zh-Hant').resolvedOptions().pluralCategories;
  const enP = new Intl.PluralRules('en').resolvedOptions().pluralCategories;

  // coverage, placeholders, copy rules, plural shapes
  const coverage = new Map(); // ns -> { en, zh, missingEn, missingZh }
  for (const n of index.namespaces) coverage.set(n, { en: 0, zh: 0, missingEn: [], missingZh: [] });
  for (const [k, e] of zh) { const c = coverage.get(e.ns); if (c) { c.zh++; if (!en.has(k)) c.missingEn.push(k); } }
  for (const [k, e] of en) { const c = coverage.get(e.ns); if (c) { c.en++; if (!zh.has(k)) c.missingZh.push(k); } }
  for (const [n, c] of coverage) {
    for (const k of c.missingEn) push('coverage', n, `${k}: missing in en`);
    for (const k of c.missingZh) push('coverage', n, `${k}: missing in zh-Hant`);
  }
  for (const [k, e] of zh) {
    const o = en.get(k);
    if (o && JSON.stringify(placeholders(e.value)) !== JSON.stringify(placeholders(o.value))) push('placeholders', e.ns, `${k}: {${placeholders(e.value).join(',')}} in zh-Hant vs {${placeholders(o.value).join(',')}} in en`);
    if (isPlural(e.value)) for (const cat2 of Object.keys(e.value)) if (cat2 !== '_context' && !zhP.includes(cat2)) push('structure', e.ns, `${k}: zh-Hant plural category '${cat2}' (zh-Hant uses other only)`);
  }
  for (const [k, e] of en) if (isPlural(e.value)) for (const cat2 of Object.keys(e.value)) if (cat2 !== '_context' && !enP.includes(cat2)) push('structure', e.ns, `${k}: en plural category '${cat2}'`);
  for (const [loc, map] of [['zh-Hant', zh], ['en', en]]) {
    for (const [k, e] of map) {
      const v = JSON.stringify(e.value);
      if (COPY_RULE.test(v)) push('copy', e.ns, `${loc} ${k}: ${v.slice(0, 80)} (spec id / code / file / model word in user text, §2.4)`);
      if (loc === 'en' && /[\u3400-\u9fff]/.test(v) && !ENDONYM_KEY.test(k)) push('copy', e.ns, `en ${k}: contains CJK: ${v.slice(0, 60)}`);
    }
  }

  // code keys
  const srcFiles = walk(path.join(APP, 'src'), (f) => f.endsWith('.js')).map((f) => `src/${f}`);
  const { keys, prefixes, cjk } = scanSources(srcFiles);
  const html = fs.existsSync(path.join(APP, 'index.html')) ? fs.readFileSync(path.join(APP, 'index.html'), 'utf8') : '';
  for (const m of html.matchAll(/data-i18n(?:-aria-label)?="([^"]+)"/g)) { if (!keys.has(m[1])) keys.set(m[1], []); keys.get(m[1]).push('index.html'); }
  for (const [k, where] of keys) {
    const n = k.split('.')[0];
    if (!nsOwner.has(n)) continue; // not a catalog key (an id that looks like one)
    const miss = [!zh.has(k) && 'zh-Hant', !en.has(k) && 'en'].filter(Boolean);
    if (miss.length) push('missing', n, `${k}: used at ${where.slice(0, 2).join(', ')} but missing in ${miss.join(' + ')}`);
  }
  // unused keys (report only)
  const unused = new Map();
  for (const [k, e] of zh) {
    if (DYNAMIC_NS.has(e.ns)) continue;
    const base = k.replace(/\.(short|long|fix|hint|term|meaning|range|label|title|body)$/, '');
    if (keys.has(k) || keys.has(base) || [...prefixes].some((p) => k.startsWith(p))) continue;
    unused.set(e.ns, (unused.get(e.ns) ?? 0) + 1);
  }

  // CJK literals
  const cjkByPkg = new Map();
  let cjkTotal = 0;
  for (const [rel, n] of cjk) { const p = ownerOfFile(rel); cjkByPkg.set(p, (cjkByPkg.get(p) ?? 0) + n); cjkTotal += n; }
  if (strict) for (const [rel, n] of cjk) findings.push({ kind: 'cjk', ns: null, msg: `app/${rel}: ${n} line(s) with CJK literals outside comments`, level: 'FAIL' });

  return { findings, coverage, unused, cjk, cjkByPkg, cjkTotal, scope: strict ? 'all (strict)' : [...scopeNs].join(','), nsOwner };
}

function main(argv) {
  const o = { strict: false, pkgs: [], ns: null, json: false, quiet: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--strict') o.strict = true;
    else if (a === '--json') o.json = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--pkg' && argv[i + 1]) o.pkgs.push(PKG_ALIAS[argv[++i]] ?? argv[i]);
    else if (a === '--ns' && argv[i + 1]) o.ns = argv[++i].split(',').filter(Boolean);
    else { console.error('usage: check_i18n.mjs [--strict] [--pkg A|foundation …] [--ns a,b] [--json] [--quiet]'); return 64; }
  }
  if (!o.pkgs.length) o.pkgs = ['foundation'];
  const r = checkI18n(o);
  const fails = r.findings.filter((f) => f.level === 'FAIL');
  const warns = r.findings.filter((f) => f.level === 'WARN');
  if (o.json) {
    console.log(JSON.stringify({ scope: r.scope, fails, warns: warns.length, cjk_total: r.cjkTotal, cjk_by_package: Object.fromEntries(r.cjkByPkg), coverage: Object.fromEntries([...r.coverage].map(([n, c]) => [n, { en: c.en, zh: c.zh }])) }, null, 2));
    return Math.min(fails.length, 255);
  }
  console.log(`check_i18n: scope ${r.scope}${o.strict ? '' : ' (other namespaces: WARN only; --strict at integration)'}`);
  console.log('namespace coverage (en keys / zh-Hant keys):');
  const rows = [...r.coverage].map(([n, c]) => {
    const pct = c.zh || c.en ? Math.round((100 * Math.min(c.en, c.zh)) / Math.max(c.en, c.zh)) : 0;
    const full = c.en === c.zh && !c.missingEn.length && !c.missingZh.length && c.en > 0;
    return `  ${n.padEnd(11)} ${String(c.en).padStart(4)} / ${String(c.zh).padEnd(4)} ${full ? '100 %' : c.en + c.zh === 0 ? '  — (no catalog yet)' : `${pct} %`}  [${r.nsOwner.get(n) ?? '?'}]${r.unused.get(n) ? `  ${r.unused.get(n)} unused` : ''}`;
  });
  console.log(rows.join('\n'));
  const byPkg = [...r.cjkByPkg].sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p} ${n}`).join(', ');
  console.log(`CJK literal lines in app/src (outside comments): ${r.cjkTotal}${byPkg ? ` (${byPkg})` : ''} — must reach 0 at integration (--strict)`);
  if (!o.quiet) for (const [rel, n] of [...r.cjk].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(n).padStart(4)}  app/${rel}`);
  for (const f of fails) console.log(`FAIL ${f.kind}: ${f.msg}`);
  if (warns.length) {
    const kinds = {};
    for (const w of warns) kinds[w.kind] = (kinds[w.kind] ?? 0) + 1;
    console.log(`WARN ${warns.length} finding(s) outside the scope: ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ')}`);
    if (!o.quiet) for (const w of warns.slice(0, 15)) console.log(`  warn ${w.kind}: ${w.msg}`);
  }
  console.log(`check_i18n: ${fails.length} FAIL, ${warns.length} WARN`);
  return Math.min(fails.length, 255);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv);
