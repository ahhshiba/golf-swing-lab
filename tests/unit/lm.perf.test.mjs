// LAUNCH-MONITOR-SPEC §5.2 LM-B acceptance 5 (§1.5 budget): deriveLaunchMonitor median CPU time ≤ 1500 ms per shot
// with n = 256 Monte-Carlo draws (one RK4 flight each), single thread, measured with process.cpuUsage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveLaunchMonitor, LM_PARAMS } from '../../app/src/physics/lm/index.js';
import { mulberry32 } from '../../app/src/geom/rng.js';
import { lmShot, LM_CLUB_TYPES } from '../synth/ballflight.js';

test('deriveLaunchMonitor: median CPU time ≤ 1500 ms (n = 256 draws)', () => {
  assert.equal(LM_PARAMS.flight.mc_draws, 256);
  const rng = mulberry32(77);
  const ms = [];
  for (let i = 0; i < 14; i++) {
    const view = i % 2 ? 'high_behind' : 'face_on';
    const s = lmShot({ rng, view, clubType: LM_CLUB_TYPES[i % LM_CLUB_TYPES.length] });
    const c0 = process.cpuUsage();
    const r = deriveLaunchMonitor({ view, fps: 240, club: s.club, metrics: s.metrics, settings: { ground: 'normal' }, rng: mulberry32(i), start: s.start });
    const c = process.cpuUsage(c0);
    ms.push((c.user + c.system) / 1000);
    assert.notEqual(r.metrics.carry_m.value, null);
  }
  ms.sort((a, b) => a - b);
  const median = ms[ms.length >> 1];
  console.log(`perf median_ms=${Math.round(median)} max_ms=${Math.round(ms.at(-1))} n_draws=${LM_PARAMS.flight.mc_draws}`);
  assert.ok(median <= 1500, `median ${median} ms`);
});
