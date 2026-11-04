#!/usr/bin/env node
// scripts/check-sw.mjs - service-worker version check (CAFCR R4; verify.sh stage sw-version).
//
//   node scripts/check-sw.mjs [--dist dist] [--last deploy/last-deploy.json] [--pkg package.json]
//
// Reads dist/sw.js (written by scripts/build.mjs from app/sw.template.js) and checks:
//   1. sw.js embeds  const MANIFEST = {"version","dev","shell":[url...],"assets":[{url,sha256,precache}]}
//   2. VERSION format '<semver>+<10 hex>' and the semver equals package.json "version"
//   3. every precached entry (shell + assets with precache:true) and every runtime asset exists under dist/ and, for
//      assets, matches the sha256 in the manifest
//   4. the 10-hex part equals the recomputed hash. Algorithm = scripts/build.mjs versionOf(): entries sorted by url
//      (code-unit order), text = for each `${url}\n${sha256hex(file bytes)}\n`, sha256 of the utf8 text, first 10 hex
//   5. shell <= 1,000,000 B and precache (shell + precached assets) <= 35,000,000 B (build.mjs BUDGETS)
//   6. dist/precache-manifest.json (when present) agrees with sw.js on version and with the files on disk
//   7. deploy/last-deploy.json (when present, {"version": "<semver>+<10 hex>"}): precache contents changed but the
//      semver did not -> FAIL; semver went down -> FAIL. A deploy made with build.mjs --no-bundled-model records
//      "bundled_event_model": false; a local build that does bundle the model is then compared on its precache list
//      without models/event-tcn-v1.* (which is exactly what such a deploy hashed).
// Exit code = number of FAIL checks (capped at 255).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseSwManifest } from '../app/src/diag/report.js';

export const BUDGETS = Object.freeze({ shell_bytes: 1_000_000, precache_bytes: 35_000_000 });

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** entries [{url, sha256}] -> first 10 hex of the VERSION hash (same as build.mjs versionOf). */
export function hashOf(entries) {
  const sorted = [...entries].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  const text = sorted.map((e) => `${e.url}\n${e.sha256}\n`).join('');
  return sha256(Buffer.from(text, 'utf8')).slice(0, 10);
}

/** Files that build.mjs --no-bundled-model leaves out (GolfDB-derived event model, CC BY-NC). */
export const EVENT_MODEL_RE = /^models\/event-tcn-v1\.[^/]+$/;

const VERSION_RE = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\+([0-9a-f]{10})$/;

function cmpSemver(a, b) {
  const pa = a.split('-')[0].split('.').map(Number);
  const pb = b.split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

/** -> [{ ok, name, detail }] */
export function checkSw({ dist, last, pkg }) {
  const out = [];
  const add = (ok, name, detail = '') => out.push({ ok, name, detail });
  const swPath = path.join(dist, 'sw.js');
  if (!fs.existsSync(swPath)) {
    add(false, 'sw.js present', `${swPath} not found (run scripts/build.mjs first)`);
    return out;
  }
  const man = parseSwManifest(fs.readFileSync(swPath, 'utf8'));
  add(man !== null, 'sw.js embeds a MANIFEST', man ? `${man.shell.length} shell + ${man.assets.length} assets` : 'not found or not valid JSON');
  if (man === null) return out;
  const version = man.version;
  const vm = VERSION_RE.exec(String(version));
  add(vm !== null, 'VERSION format <semver>+<10 hex>', String(version));
  let pkgVersion = null;
  try {
    pkgVersion = JSON.parse(fs.readFileSync(pkg, 'utf8')).version;
  } catch (e) {
    add(false, 'package.json readable', e.message);
  }
  if (vm && pkgVersion) add(vm[1] === pkgVersion, 'VERSION semver == package.json version', `${vm[1]} vs ${pkgVersion}`);

  const distRoot = path.resolve(dist);
  const problems = [];
  const read = (url) => {
    const full = path.resolve(distRoot, url);
    if (!full.startsWith(distRoot + path.sep)) { problems.push(`${url} (escapes dist/)`); return null; }
    try {
      return fs.readFileSync(full);
    } catch {
      problems.push(`${url} (missing)`);
      return null;
    }
  };
  const precached = [];
  let shellBytes = 0;
  let precacheBytes = 0;
  for (const url of man.shell) {
    const buf = read(url);
    if (!buf) continue;
    precached.push({ url, sha256: sha256(buf) });
    shellBytes += buf.length;
    precacheBytes += buf.length;
  }
  for (const a of man.assets) {
    const buf = read(a.url);
    if (!buf) continue;
    const h = sha256(buf);
    if (h !== a.sha256) problems.push(`${a.url} (sha256 differs from manifest)`);
    if (a.precache) {
      precached.push({ url: a.url, sha256: h });
      precacheBytes += buf.length;
    }
  }
  const dup = new Set();
  for (const e of precached) {
    if (dup.has(e.url)) problems.push(`${e.url} (listed twice)`);
    dup.add(e.url);
  }
  add(precached.some((e) => e.url === 'index.html'), 'index.html is precached');
  add(problems.length === 0, 'every manifest file exists and matches', problems.length ? problems.slice(0, 6).join(', ') + (problems.length > 6 ? ' ...' : '') : `${precached.length} precached + ${man.assets.length - man.assets.filter((a) => a.precache).length} runtime-only`);
  add(shellBytes <= BUDGETS.shell_bytes, 'shell <= 1 MB', `${shellBytes} B`);
  add(precacheBytes <= BUDGETS.precache_bytes, 'precache <= 35 MB', `${precacheBytes} B`);

  let hash = null;
  if (problems.length === 0) {
    hash = hashOf(precached);
    add(vm !== null && vm[2] === hash, 'VERSION hash == recomputed hash', `${vm ? vm[2] : '?'} vs ${hash}`);
  } else {
    add(false, 'VERSION hash == recomputed hash', 'cannot recompute, files missing or changed');
  }

  const pm = path.join(distRoot, 'precache-manifest.json');
  if (fs.existsSync(pm)) {
    try {
      const j = JSON.parse(fs.readFileSync(pm, 'utf8'));
      add(j.version === version, 'precache-manifest.json version == sw.js version', `${j.version} vs ${version}`);
    } catch (e) {
      add(false, 'precache-manifest.json readable', e.message);
    }
  }

  if (fs.existsSync(last)) {
    let lv = null;
    let lastBundled = true;
    try {
      const lj = JSON.parse(fs.readFileSync(last, 'utf8'));
      lv = VERSION_RE.exec(lj.version);
      lastBundled = lj.bundled_event_model !== false;
    } catch { /* below */ }
    const distHasModel = precached.some((e) => EVENT_MODEL_RE.test(e.url));
    if (lv && vm && !lastBundled && distHasModel && hash !== null) {
      // compare like with like: the deployed build had no event model
      vm[2] = hashOf(precached.filter((e) => !EVENT_MODEL_RE.test(e.url)));
      add(true, 'last deploy was --no-bundled-model', `comparing the precache list without models/event-tcn-v1.* (hash ${vm[2]})`);
    } else if (lv && vm && lastBundled && !distHasModel) {
      add(true, 'last deploy bundled the event model, this build does not', 'build variants differ; the semver check below uses this build');
    }
    if (!lv) {
      add(false, 'deploy/last-deploy.json readable', 'needs {"version": "<semver>+<10 hex>"}');
    } else if (vm) {
      const c = cmpSemver(vm[1], lv[1]);
      if (c < 0) add(false, 'semver not lower than last deploy', `${vm[1]} < ${lv[1]}`);
      else if (c === 0) add(vm[2] === lv[2], 'contents unchanged since last deploy (same semver)', `now ${vm[2]}, deployed ${lv[2]}: bump package.json version`);
      else add(true, 'semver bumped since last deploy', `${lv[1]} -> ${vm[1]}`);
    }
  } else {
    add(true, 'last-deploy comparison', `${last} not present (first deploy)`);
  }
  return out;
}

function main(argv) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const opt = { dist: path.join(root, 'dist'), last: path.join(root, 'deploy', 'last-deploy.json'), pkg: path.join(root, 'package.json') };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (!['dist', 'last', 'pkg'].includes(k) || i + 1 >= argv.length) {
      console.error('usage: check-sw.mjs [--dist dir] [--last file] [--pkg file]');
      return 64;
    }
    opt[k] = path.resolve(argv[++i]);
  }
  const res = checkSw(opt);
  for (const r of res) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ` [${r.detail}]` : ''}`);
  const fails = res.filter((r) => !r.ok).length;
  console.log(`check-sw: ${res.length - fails}/${res.length} passed, ${fails} FAIL`);
  return Math.min(fails, 255);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exitCode = main(process.argv);
