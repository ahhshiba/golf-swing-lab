#!/usr/bin/env node
// tests/e2e/run.mjs - browser e2e runner (verify.sh stage browser-e2e, RUN_BROWSER_E2E=1).
//
//   node tests/e2e/run.mjs [--only m1,screens,m2,m2-ui,m2-shot,m5,m6,m6-ui,real-pose,m1@webkit,a-*,...] [--dist dist]
//                          [--port N] [--no-fixtures] [--list]
//
// Package gates are auto-discovered: every tests/e2e/gates/<pkg>-<name>.mjs exporting `meta` ({ id, title, timeoutMs })
// + `run(ctx)`, and/or `gates` (an array of { meta, run }), is added after the built-in gates (sorted by file name).
// --only takes ids or prefixes ending in '*' (e.g. --only 'b-*'). Env: GSL_E2E_DIST (dist dir, default dist/),
// GSL_E2E_PORT (fixed server port, default free), GSL_E2E_LOCALE (default browser locale, default zh-TW),
// GSL_SHOTS_DIR (screenshots written by checks.screenshotSet). ctx = { baseUrl, dist, browser? }.
//
// Serves dist/ with scripts/devserve.py (127.0.0.1, free port, prefix /golf-swing-lab/) and runs each gate in Chromium.
// Gates m1, screens, m2 and real-pose also run in Playwright's WebKit (the Safari proxy, ids <gate>@webkit); where
// WebKit cannot launch (missing host libraries) those are SKIP with the exact missing packages / .so names.
// Prints PASS / FAIL / SKIP per gate with the reason; exit code = number of FAIL gates (capped at 255), 64 on usage error.
// A missing dist/ (and no scripts/build.mjs to make one) or a missing UI hook is a FAIL, never a silent pass.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, FIXTURES, Skip, startServer } from './lib.mjs';
import * as m1 from './m1.mjs';
import * as m2 from './m2.mjs';
import * as m5 from './m5.mjs';
import * as m6 from './m6.mjs';
import * as screens from './screens.mjs';
import * as realpose from './realpose.mjs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const onWebkit = (m) => ({ meta: { ...m.meta, id: `${m.meta.id}@webkit`, title: `${m.meta.title} [WebKit]` }, run: (ctx) => m.run({ ...ctx, browser: 'webkit' }) });
const BUILTIN = [
  ...[m1, screens, m2, m2.ui, screens.shot, m5, m6, m6.ui, realpose].map((m) => ({ meta: m.meta, run: m.run })),
  ...[m1, screens, m2, realpose].map(onWebkit),
];
const GATES_DIR = path.join(ROOT, 'tests', 'e2e', 'gates');

/** tests/e2e/gates/<pkg>-<name>.mjs → [{ meta, run, file }]; a malformed module is itself a failing gate. */
export async function discoverGates(dir = GATES_DIR) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => /^[a-f]-[\w-]+\.mjs$/.test(x)).sort()) {
    try {
      const m = await import(pathToFileURL(path.join(dir, f)).href);
      const list = [...(m.meta && m.run ? [{ meta: m.meta, run: m.run }] : []), ...(Array.isArray(m.gates) ? m.gates : [])];
      if (!list.length) throw new Error('exports neither meta+run nor gates[]');
      for (const g of list) {
        if (!g?.meta?.id || typeof g.run !== 'function') throw new Error('a gate needs meta.id and run()');
        out.push({ meta: { timeoutMs: 120000, title: g.meta.id, ...g.meta }, run: g.run, file: f });
      }
    } catch (e) {
      const id = f.replace(/\.mjs$/, '');
      out.push({ meta: { id, title: `gate module ${f}`, timeoutMs: 1000 }, run: async () => { throw new Error(`${f}: ${e.message}`); }, file: f });
    }
  }
  return out;
}

function timeout(p, ms, id) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`gate ${id} timed out after ${ms} ms`)), ms); })]).finally(() => clearTimeout(t));
}

const selects = (pattern, id) => (pattern.endsWith('*') ? id.startsWith(pattern.slice(0, -1)) : id === pattern);

async function main(argv) {
  let only = null;
  let dist = process.env.GSL_E2E_DIST ? path.resolve(process.env.GSL_E2E_DIST) : path.join(ROOT, 'dist');
  let fixtures = true;
  let port = null;
  let listOnly = false;
  const GATES = [...BUILTIN, ...(await discoverGates())];
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--only' && argv[i + 1]) only = argv[++i].split(',').filter(Boolean);
    else if (argv[i] === '--dist' && argv[i + 1]) dist = path.resolve(argv[++i]);
    else if (argv[i] === '--port' && argv[i + 1]) port = Number(argv[++i]);
    else if (argv[i] === '--no-fixtures') fixtures = false;
    else if (argv[i] === '--list') listOnly = true;
    else { console.error(`usage: run.mjs [--only ${GATES.map((g) => g.meta.id).join(',')}] [--dist dir] [--port N] [--no-fixtures] [--list]`); return 64; }
  }
  const ids = GATES.map((g) => g.meta.id);
  if (new Set(ids).size !== ids.length) { console.error(`duplicate gate ids: ${ids.filter((x, i) => ids.indexOf(x) !== i).join(', ')}`); return 64; }
  if (only && only.some((o) => !ids.some((id) => selects(o, id)))) { console.error(`unknown gate in --only (known: ${ids.join(', ')})`); return 64; }
  const gates = GATES.filter((g) => !only || only.some((o) => selects(o, g.meta.id)));
  if (listOnly) { for (const g of gates) console.log(`${g.meta.id}\t${g.meta.title}${g.file ? `\t(${g.file})` : ''}`); return 0; }

  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    const build = path.join(ROOT, 'scripts', 'build.mjs');
    if (dist === path.join(ROOT, 'dist') && fs.existsSync(build)) {
      console.log('dist/ missing: running scripts/build.mjs');
      const r = spawnSync(process.execPath, [build], { stdio: 'inherit', cwd: ROOT });
      if (r.status !== 0) { console.log('FAIL e2e (scripts/build.mjs failed)'); return 1; }
    }
    if (!fs.existsSync(path.join(dist, 'index.html'))) {
      console.log(`FAIL e2e: ${dist}/index.html not found and cannot be built (scripts/build.mjs missing). Every gate would fail; not running them.`);
      return 1;
    }
  }
  if (fixtures && gates.some((g) => ['m2', 'm2-ui', 'm2-shot', 'm5'].includes(g.meta.id))) {
    const need = ['clip_240.json', 'm5_fake_cam.y4m', 'm5_fake_mic.wav', 'm5_truth.json'];
    if (need.some((f) => !fs.existsSync(path.join(FIXTURES, f)))) {
      console.log('generating fixtures (about 1 minute) ...');
      spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'make_fixtures.mjs')], { stdio: 'inherit', cwd: ROOT });
    }
    // m5 fixtures older than the frame-index code (gate m5 matches detections to truth by time with it)
    const m5t = path.join(FIXTURES, 'm5_truth.json');
    let stale = false;
    try { stale = !JSON.parse(fs.readFileSync(m5t, 'utf8')).video?.frame_code; } catch { stale = true; }
    if (stale) {
      console.log('regenerating the m5 fixtures (frame-index code) ...');
      spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'make_fixtures.mjs'), '--only', 'm5'], { stdio: 'inherit', cwd: ROOT });
    }
  }

  let server;
  try {
    server = await startServer(dist, { port: port ?? undefined });
  } catch (e) {
    console.log(`FAIL e2e: dev server did not start: ${e.message}`);
    return 1;
  }
  console.log(`serving ${dist} at ${server.baseUrl}`);
  const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
  const lines = [];
  for (const g of gates) {
    const t0 = Date.now();
    let status = 'PASS';
    let msg = '';
    try {
      msg = await timeout(g.run({ baseUrl: server.baseUrl, dist }), g.meta.timeoutMs, g.meta.id);
    } catch (e) {
      if (e instanceof Skip) { status = 'SKIP'; msg = e.message; } else { status = 'FAIL'; msg = e && e.message ? e.message : String(e); }
    }
    counts[status]++;
    const line = `${status} ${g.meta.id}: ${g.meta.title} (${((Date.now() - t0) / 1000).toFixed(1)} s)${msg ? `\n     ${String(msg).split('\n').join('\n     ')}` : ''}`;
    lines.push(line);
    console.log(line);
  }
  await server.stop();
  console.log(`\ne2e: PASS=${counts.PASS} FAIL=${counts.FAIL} SKIP=${counts.SKIP}`);
  if (counts.SKIP) console.log('e2e: skipped gates are NOT verified');
  return Math.min(counts.FAIL, 255);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv).then((c) => { process.exitCode = c; }, (e) => { console.error(e); process.exitCode = 1; });
}
