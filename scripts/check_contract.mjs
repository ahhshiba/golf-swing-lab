#!/usr/bin/env node
// scripts/check_contract.mjs - the `contract` stage of scripts/verify.sh. Exit code = number of problems (max 255).
//
//   1. fixtures: every tests/fixtures/shots/valid_*.json (golf-shot/1) and tests/fixtures/shots/v2/valid_*.json
//      (golf-shot/2) passes validateShot, and every golf-shot/1 one still passes after contract/migrate.js; every
//      bad_*.json fails with its "_expect" substring (and, unless "_expect_errors" says otherwise, with exactly one
//      error); a v2 bad_<rule>.json must fail with an error that names <rule> (LAUNCH-MONITOR-SPEC §5.2 LM-A 1);
//   2. every RC.<NAME> in app/src/**/*.js exists in REASON_CODES;
//   3. no file in app/src other than reason-codes.js contains a quoted string equal to a reason code name;
//   4. every reason code has a non-empty Traditional Chinese description: the zh-Hant catalog value
//      reason.<CODE>.long in app/i18n/zh-Hant/reason.json (PRODUCT-SPEC §3.4: reason-codes.js holds codes only), and
//      reason.<CODE>.short / .long / .fix in both zh-Hant and en (LAUNCH-MONITOR-SPEC §2.3);
//   5. schema/shot-v2.schema.json (golf-shot/2) and the frozen schema/shot-v1.schema.json (golf-shot/1, imports of
//      old backups) are valid JSON, mention every metric id of their version exactly once and agree with the JS enums.
//
// Run:  node scripts/check_contract.mjs [--quiet]

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------------------------------------------------------------------ source scanning

/** Line number (1-based) of character index `idx` in `src`. */
export function lineOf(src, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

/** All `RC.<identifier>` references: [{ name, index }]. Comments are scanned too (a stale example is still a typo). */
export function rcReferences(src) {
  const out = [];
  const re = /(?<![A-Za-z0-9_$])RC\.([A-Za-z_][A-Za-z0-9_]*)/g;
  for (let m = re.exec(src); m; m = re.exec(src)) out.push({ name: m[1], index: m.index });
  return out;
}

const REGEX_PRECEDING_WORDS = new Set([
  'return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'instanceof', 'yield', 'await',
]);

/**
 * Every quoted string literal of a JavaScript source, comments and regular-expression literals skipped:
 * [{ value, index }] with the raw text between the quotes. A template literal counts when it has no ${}.
 * A small lexer, enough for this code base (it does not parse JSX or HTML-like comments).
 */
export function stringLiterals(src) {
  const n = src.length;
  const out = [];
  let i = 0;

  function skipRegex() {
    i++; // opening /
    let inClass = false;
    while (i < n) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '\n') { i++; return; }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) { i++; break; }
      i++;
    }
    while (i < n && /[a-z]/i.test(src[i])) i++; // flags
  }

  function readString(q) {
    const start = i;
    i++;
    let buf = '';
    while (i < n) {
      const c = src[i];
      if (c === '\\') { buf += c + (src[i + 1] ?? ''); i += 2; continue; }
      if (c === q) { i++; break; }
      if (c === '\n') break; // unterminated: stop at the line end
      buf += c;
      i++;
    }
    out.push({ value: buf, index: start });
  }

  function readTemplate() {
    const start = i;
    i++;
    let buf = '';
    let hasSub = false;
    while (i < n) {
      const c = src[i];
      if (c === '\\') { buf += c + (src[i + 1] ?? ''); i += 2; continue; }
      if (c === '`') { i++; break; }
      if (c === '$' && src[i + 1] === '{') { hasSub = true; i += 2; code(true); continue; }
      buf += c;
      i++;
    }
    if (!hasSub) out.push({ value: buf, index: start });
  }

  // Scan code; with untilBrace, stop after the "}" that closes a template substitution.
  function code(untilBrace) {
    let depth = 0;
    let prev = ''; // class of the last significant token: '' start, 'a' word/number, 'v' string/regex value, else the char
    let word = '';
    while (i < n) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') {
        const end = src.indexOf('*/', i + 2);
        i = end < 0 ? n : end + 2;
        continue;
      }
      if (c === '"' || c === "'") { readString(c); prev = 'v'; word = ''; continue; }
      if (c === '`') { readTemplate(); prev = 'v'; word = ''; continue; }
      if (c === '/') {
        const regex = prev === '' || (prev === 'a' && REGEX_PRECEDING_WORDS.has(word)) || /[(,=:[!&|?{;+\-*%<>~^]/.test(prev);
        if (regex) { skipRegex(); prev = 'v'; word = ''; } else { i++; prev = '/'; word = ''; }
        continue;
      }
      if (c === '{') depth++;
      if (c === '}') {
        if (depth === 0 && untilBrace) { i++; return; }
        depth--;
      }
      if (/\s/.test(c)) { i++; continue; }
      if (/[A-Za-z0-9_$]/.test(c)) {
        let j = i;
        while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
        word = src.slice(i, j);
        prev = 'a';
        i = j;
        continue;
      }
      prev = c;
      word = '';
      i++;
    }
  }

  code(false);
  return out;
}

function listFiles(dir, exts) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, exts));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

// Characters that exist only in Simplified Chinese; a cheap guard that descriptions are Traditional.
const SIMPLIFIED_ONLY = '这们说话没时间数据关点帧测过错误终显势态应该对为从还进与专业东门长问见头机车书买电视马鸟鱼动线级总离无压';
const CJK_RE = /[一-鿿]/;

// ------------------------------------------------------------------------------------------ the checks

/**
 * Run every check. Returns { problems: string[], info: string[] }. `root` is the project root.
 */
export async function runChecks({ root = ROOT } = {}) {
  const problems = [];
  const info = [];
  const fail = (area, msg) => problems.push(`${area}: ${msg}`);
  const url = (p) => pathToFileURL(join(root, p)).href;

  const rcMod = await import(url('app/src/contract/reason-codes.js'));
  const { REASON_CODES, RC } = rcMod;
  const codeNames = Object.keys(REASON_CODES);
  const contract = await import(url('app/src/contract/index.js'));
  if ('describe' in rcMod) fail('reason-codes', 'describe() must not exist: descriptions come from t(\'reason.<CODE>.long\') (PRODUCT-SPEC §3.4)');
  let zhReason = {};
  let enReason = {};
  try {
    zhReason = JSON.parse(readFileSync(join(root, 'app/i18n/zh-Hant/reason.json'), 'utf8'));
  } catch (e) {
    fail('reason-codes', `app/i18n/zh-Hant/reason.json is missing or not valid JSON (${e.message})`);
  }
  try {
    enReason = JSON.parse(readFileSync(join(root, 'app/i18n/en/reason.json'), 'utf8'));
  } catch (e) {
    fail('reason-codes', `app/i18n/en/reason.json is missing or not valid JSON (${e.message})`);
  }

  // (4) descriptions and RC shape
  for (const name of codeNames) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) fail('reason-codes', `code name ${name} must be UPPER_SNAKE_CASE`);
    if (RC[name] !== name) fail('reason-codes', `RC.${name} must equal '${name}'`);
    if (REASON_CODES[name] !== name) fail('reason-codes', `REASON_CODES.${name} must equal '${name}' (codes only, no prose in reason-codes.js)`);
    const d = zhReason[`${name}.long`];
    if (typeof d !== 'string' || d.trim() === '') { fail('reason-codes', `${name} has no description (zh-Hant reason.json key ${name}.long)`); continue; }
    if (!CJK_RE.test(d)) fail('reason-codes', `${name} description is not Chinese: ${d}`);
    const bad = [...d].filter((ch) => SIMPLIFIED_ONLY.includes(ch));
    if (bad.length) fail('reason-codes', `${name} description has Simplified-only characters (${bad.join('')}); use Traditional Chinese`);
    for (const [loc, cat] of [['zh-Hant', zhReason], ['en', enReason]]) {
      for (const f of ['short', 'long', 'fix']) {
        const v = cat[`${name}.${f}`];
        if (typeof v !== 'string' || v.trim() === '') fail('reason-codes', `${name} has no ${loc} reason.json key ${name}.${f}`);
      }
    }
  }
  for (const k of Object.keys(RC)) if (!(k in REASON_CODES)) fail('reason-codes', `RC.${k} has no entry in REASON_CODES`);
  info.push(`${codeNames.length} reason codes`);

  // (2) RC.<NAME> references and (3) quoted literals equal to a code name
  const srcFiles = listFiles(join(root, 'app/src'), ['.js', '.mjs']);
  let refs = 0;
  for (const file of srcFiles) {
    const rel = relative(root, file);
    const src = readFileSync(file, 'utf8');
    for (const r of rcReferences(src)) {
      refs++;
      if (!(r.name in REASON_CODES)) fail('rc-ref', `${rel}:${lineOf(src, r.index)} RC.${r.name} is not defined in REASON_CODES`);
    }
    if (rel.endsWith('contract/reason-codes.js')) continue;
    for (const lit of stringLiterals(src)) {
      if (codeNames.includes(lit.value)) {
        fail('rc-literal', `${rel}:${lineOf(src, lit.index)} string literal '${lit.value}' is a reason code name; use RC.${lit.value}`);
      }
    }
  }
  info.push(`${srcFiles.length} app/src files scanned, ${refs} RC.* references`);

  // (5) schemas: v2 against the current lists, the frozen v1 against the golf-shot/1 lists
  const SCHEMAS = [
    { file: 'schema/shot-v2.schema.json', schemaId: contract.SCHEMA_ID, ids: contract.METRIC_IDS, codes: codeNames,
      origins: contract.VALUE_ORIGINS, algs: contract.ALGORITHM_KEYS, required: contract.SHOT_REQUIRED_KEYS },
    { file: 'schema/shot-v1.schema.json', schemaId: contract.SCHEMA_V1, ids: contract.METRIC_IDS_V1, codes: contract.REASON_CODE_LIST_V1,
      origins: contract.VALUE_ORIGINS_V1, algs: contract.ALGORITHM_KEYS_V1, required: contract.SHOT_REQUIRED_KEYS_V1 },
  ];
  for (const S of SCHEMAS) {
    const schemaPath = join(root, S.file);
    let schema = null;
    let schemaText = '';
    try {
      schemaText = readFileSync(schemaPath, 'utf8');
      schema = JSON.parse(schemaText);
    } catch (e) {
      fail('schema', `${S.file} is missing or not valid JSON: ${e.message}`);
    }
    if (!schema) continue;
    const count = (needle) => schemaText.split(needle).length - 1;
    if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') fail('schema', `${S.file}: $schema must be JSON Schema 2020-12`);
    for (const id of S.ids) {
      const n = count(id);
      if (n !== 1) fail('schema', `${S.file}: metric id ${id} appears ${n} times in the schema text (expected exactly 1)`);
    }
    const props = schema.properties?.metrics?.properties ?? {};
    const keys = Object.keys(props);
    if (keys.join() !== S.ids.join()) fail('schema', `${S.file}: properties.metrics keys differ from the metric ids: ${keys.join(',')}`);
    if (schema.properties?.metrics?.minProperties !== S.ids.length) fail('schema', `${S.file}: metrics.minProperties must be ${S.ids.length}`);
    for (const id of S.ids) {
      const unit = props[id]?.allOf?.[1]?.properties?.unit?.const;
      if (unit !== contract.METRIC_UNITS[id]) fail('schema', `${S.file}: unit of ${id} is ${JSON.stringify(unit)} in the schema but ${contract.METRIC_UNITS[id]} in enums.js`);
    }
    const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
    const def = schema.$defs ?? {};
    const pairs = [
      ['reasonCode', def.reasonCode?.enum, S.codes],
      ['metric.validity', def.metric?.properties?.validity?.enum, contract.VALIDITIES],
      ['metric.value_origin', def.metric?.properties?.value_origin?.enum, S.origins],
      ['capture.view', def.capture?.properties?.view?.enum, contract.VIEWS],
      ['capture.mode', def.capture?.properties?.mode?.enum, contract.CAPTURE_MODES],
      ['capture.source', def.capture?.properties?.source?.enum, contract.CAPTURE_SOURCES],
      ['capture.orientation', def.capture?.properties?.orientation?.enum, contract.ORIENTATIONS],
      ['capture.timestamps', def.capture?.properties?.timestamps?.enum, contract.TIMESTAMP_KINDS],
      ['calibration.method', def.calibration?.properties?.method?.enum, contract.CALIB_METHODS],
      ['calibration.source', def.calibration?.properties?.source?.enum, contract.CALIB_SOURCES],
      ['calibration.readout_source', def.calibration?.properties?.readout_source?.enum, contract.READOUT_SOURCES],
      ['club.lie', def.club?.properties?.lie?.enum, contract.LIES],
      ['club.tee_lift_source', def.club?.properties?.tee_lift_source?.enum, contract.TEE_LIFT_SOURCES],
      ['handedness', schema.properties?.handedness?.enum, contract.HANDEDNESS],
      ['event.source', def.event?.properties?.source?.enum, contract.EVENT_SOURCES],
      ['events keys', Object.keys(def.events?.properties ?? {}), contract.EVENTS],
      ['algorithms keys', Object.keys(def.algorithms?.properties ?? {}), S.algs],
      ['poseReport keys', Object.keys(def.poseReport?.properties ?? {}), contract.POSE_KEYS],
      ['top-level required', schema.required, S.required],
    ];
    if (S.schemaId === contract.SCHEMA_ID) pairs.push(['flight.ground', def.flight?.properties?.ground?.enum, contract.GROUNDS], ['tracks.view', def.tracks?.properties?.view?.enum, contract.VIEWS]);
    for (const [what, fromSchema, fromJs] of pairs) {
      if (!Array.isArray(fromSchema) || !sameSet(fromSchema, fromJs)) fail('schema', `${S.file}: ${what} differs between the schema and enums.js`);
    }
    if (schema.properties?.schema?.const !== S.schemaId) fail('schema', `${S.file}: schema const must be ${S.schemaId}`);
  }

  // (1) fixtures: golf-shot/1 in tests/fixtures/shots/, golf-shot/2 in tests/fixtures/shots/v2/
  const views = { v1: new Set(), v2: new Set() };
  const n = { v1: { valid: 0, bad: 0 }, v2: { valid: 0, bad: 0 } };
  for (const [ver, dirRel] of [['v1', 'tests/fixtures/shots'], ['v2', 'tests/fixtures/shots/v2']]) {
    const fxDir = join(root, dirRel);
    const files = existsSync(fxDir) ? readdirSync(fxDir).filter((f) => f.endsWith('.json')).sort() : [];
    for (const f of files) {
      const rel = `${dirRel}/${f}`;
      let raw;
      try {
        raw = JSON.parse(readFileSync(join(fxDir, f), 'utf8'));
      } catch (e) {
        fail('fixture', `${rel} is not valid JSON: ${e.message}`);
        continue;
      }
      const shot = Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('_')));
      const want = ver === 'v1' ? contract.SCHEMA_V1 : contract.SCHEMA_ID;
      const { ok, errors } = contract.validateShot(shot);
      const lines = errors.map((e) => `${e.path}: ${e.msg}`);
      if (f.startsWith('valid_') || (ver === 'v2' && f.startsWith('migrated_'))) {
        n[ver].valid++;
        if (shot.capture?.view) views[ver].add(shot.capture.view);
        if (shot.schema !== want) fail('fixture', `${rel}: schema must be ${want}`);
        if (!ok) fail('fixture', `${rel} should be valid but has ${errors.length} error(s): ${lines.slice(0, 3).join(' | ')}`);
        if (ver === 'v1') {
          const m = contract.validateShot(contract.migrateShot(shot).shot);
          if (!m.ok) fail('fixture', `${rel} migrated to ${contract.SCHEMA_ID} is invalid: ${m.errors.slice(0, 3).map((e) => `${e.path}: ${e.msg}`).join(' | ')}`);
        }
      } else if (f.startsWith('bad_')) {
        n[ver].bad++;
        if (typeof raw._expect !== 'string' || raw._expect === '') { fail('fixture', `${rel} needs an "_expect" substring`); continue; }
        if (ok) { fail('fixture', `${rel} should be invalid (expected "${raw._expect}") but passed`); continue; }
        const rule = ver === 'v2' ? f.slice(4, -5) : null;
        if (!lines.some((l) => l.includes(raw._expect))) {
          fail('fixture', `${rel} failed, but no error contains "${raw._expect}". Errors: ${lines.slice(0, 3).join(' | ')}`);
        } else if (rule && !lines.some((l) => l.includes(rule))) {
          fail('fixture', `${rel} failed, but no error names its rule "${rule}". Errors: ${lines.slice(0, 3).join(' | ')}`);
        } else if (errors.length !== (raw._expect_errors ?? 1)) {
          fail('fixture', `${rel} should violate exactly ${raw._expect_errors ?? 1} invariant(s) but has ${errors.length}: ${lines.slice(0, 4).join(' | ')}`);
        }
      } else {
        fail('fixture', `${rel}: file names must start with valid_ or bad_${ver === 'v2' ? ' (or migrated_)' : ''}`);
      }
    }
  }
  if (n.v1.valid < 3) fail('fixture', `need at least 3 valid golf-shot/1 fixtures, found ${n.v1.valid}`);
  if (n.v1.bad < 8) fail('fixture', `need at least 8 bad golf-shot/1 fixtures, found ${n.v1.bad}`);
  if (n.v2.valid < 5) fail('fixture', `need at least 5 valid golf-shot/2 fixtures, found ${n.v2.valid}`);
  if (n.v2.bad < 7) fail('fixture', `need at least 7 bad golf-shot/2 fixtures (one per new rule), found ${n.v2.bad}`);
  for (const ver of ['v1', 'v2']) for (const v of contract.VIEWS) if (!views[ver].has(v)) fail('fixture', `no valid ${ver} fixture for view ${v}`);
  info.push(`${n.v1.valid} valid + ${n.v1.bad} bad golf-shot/1 fixtures`, `${n.v2.valid} valid + ${n.v2.bad} bad golf-shot/2 fixtures`);

  return { problems, info };
}

// ------------------------------------------------------------------------------------------ main

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const quiet = process.argv.includes('--quiet');
  const { problems, info } = await runChecks();
  for (const p of problems) console.log(`FAIL ${p}`);
  if (problems.length === 0) {
    if (!quiet) console.log(`check_contract: OK (${info.join('; ')})`);
  } else {
    console.log(`check_contract: ${problems.length} problem(s) (${info.join('; ')})`);
  }
  process.exitCode = Math.min(problems.length, 255);
}
