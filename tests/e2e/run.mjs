#!/usr/bin/env node
// tests/e2e/run.mjs - browser e2e runner (verify.sh stage browser-e2e, RUN_BROWSER_E2E=1).
//
//   node tests/e2e/run.mjs [--only m1,screens,m2,m2-ui,m2-shot,m5,m6,m6-ui,real-pose,m1@webkit,...] [--dist dist] [--no-fixtures]
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

const onWebkit = (m) => ({ meta: { ...m.meta, id: `${m.meta.id}@webkit`, title: `${m.meta.title} [WebKit]` }, run: (ctx) => m.run({ ...ctx, browser: 'webkit' }) });
const GATES = [
  ...[m1, screens, m2, m2.ui, screens.shot, m5, m6, m6.ui, realpose].map((m) => ({ meta: m.meta, run: m.run })),
  ...[m1, screens, m2, realpose].map(onWebkit),
];

function timeout(p, ms, id) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`gate ${id} timed out after ${ms} ms`)), ms); })]).finally(() => clearTimeout(t));
}

async function main(argv) {
  let only = null;
  let dist = path.join(ROOT, 'dist');
  let fixtures = true;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--only' && argv[i + 1]) only = argv[++i].split(',');
    else if (argv[i] === '--dist' && argv[i + 1]) dist = path.resolve(argv[++i]);
    else if (argv[i] === '--no-fixtures') fixtures = false;
    else { console.error(`usage: run.mjs [--only ${GATES.map((g) => g.meta.id).join(',')}] [--dist dir] [--no-fixtures]`); return 64; }
  }
  const ids = GATES.map((g) => g.meta.id);
  if (only && only.some((o) => !ids.includes(o))) { console.error(`unknown gate in --only (known: ${ids.join(', ')})`); return 64; }
  const gates = GATES.filter((g) => !only || only.includes(g.meta.id));

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
    server = await startServer(dist);
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

main(process.argv).then((c) => { process.exitCode = c; }, (e) => { console.error(e); process.exitCode = 1; });
