// V04-SPEC §G.3 V4-B acceptance 2: quickEstimate median CPU <= 20 ms (the §A.1 budget is <= 5 ms on the phone; this
// host is faster, so the console line also prints the median for the record) and the generated carry table is the one
// scripts/make_carry_table.mjs computes from the current physics/lm model (`--check` exit 0, same LM_PARAMS version).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadQuickSwings } from './quick.fixtures.mjs';
import { quickEstimate } from '../../app/src/quick/estimate.js';
import { CARRY_TABLE } from '../../app/src/quick/carry-table.js';
import { LM_PARAMS } from '../../app/src/physics/lm/params.js';
import { CLUBS } from '../../app/src/session/settings.js';
import { createLiveDetector } from '../../app/src/events/live.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('quickEstimate median CPU <= 20 ms over the 200 fixture swings', () => {
  const F = loadQuickSwings();
  const inputs = F.swings.map((s) => {
    const det = createLiveDetector();
    let impact = null;
    for (const x of [...s.samples.map((y) => ({ type: 'wrist', t_s: y[0], x_m: y[1], y_m: y[2] })), ...s.audio.map((t) => ({ type: 'audio', t_s: t }))].sort((a, b) => a.t_s - b.t_s)) {
      impact ??= det.feed(x).find((e) => e.type === 'impact') ?? null;
    }
    return { samples: s.samples.filter((y) => y[0] <= impact.t_impact + 0.06), impact, view: s.view, fps: s.fps, club: s.club, handedness: s.handedness, calibration: s.calibration, gappingRow: null, settings: {} };
  });
  for (const x of inputs.slice(0, 20)) quickEstimate(x); // warm-up
  const ms = inputs.map((x) => { const t0 = performance.now(); quickEstimate(x); return performance.now() - t0; }).sort((a, b) => a - b);
  const med = ms[ms.length >> 1];
  console.log(`quickEstimate CPU: median ${med.toFixed(3)} ms, max ${ms[ms.length - 1].toFixed(3)} ms (this host)`);
  assert.ok(med <= 20);
});

test('carry table: every club of CLUBS × 20–80 m/s, made for the current LM_PARAMS, --check passes', () => {
  assert.equal(CARRY_TABLE.version, LM_PARAMS.version);
  assert.deepEqual(Object.keys(CARRY_TABLE.clubs), CLUBS.map((c) => c[0]));
  for (const c of Object.values(CARRY_TABLE.clubs)) {
    assert.equal(c.rows.length, 31);
    for (let i = 1; i < c.rows.length; i++) assert.ok(c.rows[i][0] > c.rows[i - 1][0], 'carry grows with ball speed');
    for (const [, sd] of c.rows) assert.ok(sd > 0);
  }
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/make_carry_table.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
});
