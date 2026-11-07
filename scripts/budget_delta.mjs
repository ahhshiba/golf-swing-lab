#!/usr/bin/env node
// scripts/budget_delta.mjs — shell / precache growth against the 0.3.0 baseline (V04-SPEC §F.7, §G.2).
//
//   node scripts/budget_delta.mjs --max <bytes> [--max-precache <bytes>] [--manifest dist/precache-manifest.json]
//                                 [--baseline tests/fixtures/v4/budget-baseline.json] [--json]
//
// Prints   SHELL DELTA <n> OK|FAIL            (n = shell_bytes − baseline; FAIL when n > --max)
//          PRECACHE DELTA <n> OK|FAIL|INFO    (FAIL only when --max-precache is given and exceeded)
// plus the absolute numbers. Exit 0 when every given limit holds, 1 otherwise, 64 on usage errors. Per-package caps
// (shell delta, bytes): V4-A 11000, V4-B 3500, V4-C 0, V4-D 0, V4-E 600, V4-F 2000 (baseline file `caps`).
// The manifest is the one a default build writes (node scripts/build.mjs [--out DIR]); build first.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function budgetDelta(manifest, baseline, { max = null, maxPrecache = null } = {}) {
  const shell = manifest.totals?.shell_bytes;
  const pre = manifest.totals?.precache_bytes;
  if (!Number.isInteger(shell) || !Number.isInteger(pre)) throw new Error('manifest has no totals.shell_bytes / totals.precache_bytes');
  const shellDelta = shell - baseline.shell_bytes;
  const precacheDelta = pre - baseline.precache_bytes;
  return {
    shell, precache: pre, shellDelta, precacheDelta,
    shellOk: max === null ? null : shellDelta <= max,
    precacheOk: maxPrecache === null ? null : precacheDelta <= maxPrecache,
  };
}

function main(argv) {
  const o = { max: null, maxPrecache: null, manifest: path.join(ROOT, 'dist/precache-manifest.json'), baseline: path.join(ROOT, 'tests/fixtures/v4/budget-baseline.json'), json: false };
  const num = (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 0) throw new Error(`not a byte count: ${v}`); return n; };
  try {
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === '--max') o.max = num(argv[++i]);
      else if (a === '--max-precache') o.maxPrecache = num(argv[++i]);
      else if (a === '--manifest') o.manifest = path.resolve(argv[++i] ?? '');
      else if (a === '--baseline') o.baseline = path.resolve(argv[++i] ?? '');
      else if (a === '--json') o.json = true;
      else throw new Error(`unknown argument '${a}'`);
    }
  } catch (e) {
    console.error(`budget_delta: ${e.message}`);
    return 64;
  }
  let r;
  try {
    r = budgetDelta(JSON.parse(fs.readFileSync(o.manifest, 'utf8')), JSON.parse(fs.readFileSync(o.baseline, 'utf8')), o);
  } catch (e) {
    console.error(`budget_delta: ${e.message} (build first: node scripts/build.mjs)`);
    return 1;
  }
  if (o.json) console.log(JSON.stringify(r));
  else {
    const word = (ok) => (ok === null ? 'INFO' : ok ? 'OK' : 'FAIL');
    console.log(`SHELL DELTA ${r.shellDelta} ${o.max === null ? 'INFO' : word(r.shellOk)}${o.max === null ? '' : ` (max ${o.max})`}  shell ${r.shell} B`);
    console.log(`PRECACHE DELTA ${r.precacheDelta} ${word(r.precacheOk)}${o.maxPrecache === null ? '' : ` (max ${o.maxPrecache})`}  precache ${r.precache} B`);
  }
  return r.shellOk === false || r.precacheOk === false ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
