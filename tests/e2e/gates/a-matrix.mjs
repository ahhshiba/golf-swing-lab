// Gate a-matrix (PRODUCT-SPEC §8.7 step 4, A11Y-3; V04-SPEC §G.4-5): the full screenshot matrix
// (tests/e2e/screenshot_matrix.mjs) as a verify gate — its default screen set (the 0.3.0 shell and launch-monitor screens
// and states, stats:session, gapping:hb, and the 0.4.0 screens and states of V04-SPEC §F.8: 39 entries besides setup and
// live, plus live, live:provisional, live:refined and setup) with its default seed (--seed lab: pose-bearing swings, so
// lab shows fault chips and patterns populated rows) × 390/430 portrait (setup and live also 844×390 landscape) ×
// light/dark/sun × zh-Hant/en × text 100 % and 200 % = 39 × 24 + 4 × 36 = 1,080 states. 0 findings of every kind is
// required: hscroll, overlap, obscured (live pill / hero tiles / count / club / toolbar and setup title / primary /
// instruction uncovered and unclipped as first shown, at 200 % too), truncation, word-break, spec-codes, cjk, hero, state;
// no external request and no page error. Runs in its own server and browser (tens of minutes); screenshots go to
// $GSL_SHOTS_DIR/matrix or the OS temp dir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from '../lib.mjs';

const MIN_STATES = 1080;
export const meta = { id: 'a-matrix', title: `screenshot matrix: ${MIN_STATES} states, 0 overlap / obscured / truncation / word-break findings (200 % text)`, timeoutMs: 3600000 };

export async function run(ctx) {
  const out = path.join(process.env.GSL_SHOTS_DIR || path.join(os.tmpdir(), 'gsl-e2e-shots'), 'matrix');
  fs.mkdirSync(out, { recursive: true });
  const json = path.join(out, 'summary.json');
  const args = [path.join(ROOT, 'tests', 'e2e', 'screenshot_matrix.mjs'), '--dist', ctx.dist, '--out', out, '--json', json];
  const { code, text } = await new Promise((resolve) => {
    let buf = '';
    const p = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d) => { buf += d; });
    p.stderr.on('data', (d) => { buf += d; });
    p.on('close', (c) => resolve({ code: c, text: buf }));
  });
  let summary = null;
  try { summary = JSON.parse(fs.readFileSync(json, 'utf8')).summary; } catch { /* below */ }
  if (code !== 0 || !summary || summary.with_findings !== 0) {
    throw new Error(`screenshot matrix exit ${code}${summary ? `, ${summary.with_findings} of ${summary.states} states with findings` : ''}\n${text.trim().split('\n').slice(-24).join('\n')}`);
  }
  if (summary.states < MIN_STATES) throw new Error(`screenshot matrix ran ${summary.states} states, expected ${MIN_STATES}`);
  return `${summary.states} states, 0 findings (${Object.entries(summary.checks).map(([k, n]) => `${k} ${n}`).join(', ')}) → ${out}`;
}
