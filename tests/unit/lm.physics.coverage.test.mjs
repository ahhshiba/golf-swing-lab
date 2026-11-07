// LAUNCH-MONITOR-SPEC §5.2 LM-B acceptance 2: ci95 coverage of the derived launch-monitor metrics on 400 synthetic
// shots (face_on 200, high_behind 200; tests/synth/ballflight.js lmShot: known club delivery, RN §5 noise injection,
// the model terms of LM_PARAMS drawn into the truth). Each id must cover the truth in 85–99 % of its shots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveLaunchMonitor } from '../../app/src/physics/lm/index.js';
import { mulberry32 } from '../../app/src/geom/rng.js';
import { lmShot, LM_CLUB_TYPES } from '../synth/ballflight.js';

const IDS = {
  face_on: ['dynamic_loft_deg', 'spin_loft_deg', 'spin_rate_rpm', 'carry_m', 'total_m', 'apex_m', 'landing_angle_deg', 'hang_time_s'],
  high_behind: ['face_angle_deg', 'face_to_path_deg', 'spin_axis_deg', 'carry_m', 'total_m', 'carry_side_m'],
};
const N_PER_VIEW = 200;

function run(view, seed) {
  const rng = mulberry32(seed);
  const stats = Object.fromEntries(IDS[view].map((id) => [id, { n: 0, hit: 0, half: [] }]));
  for (let i = 0; i < N_PER_VIEW; i++) {
    const s = lmShot({ rng, view, clubType: LM_CLUB_TYPES[i % LM_CLUB_TYPES.length] });
    const r = deriveLaunchMonitor({
      view, fps: 240, club: s.club, metrics: s.metrics, fit: null, clubTrack: null, calibration: null,
      settings: { ground: 'normal', crossView: false }, clubProfile: null, rng: mulberry32(seed * 1000 + i), start: s.start,
    });
    for (const id of IDS[view]) {
      const m = r.metrics[id];
      if (m.value === null) continue;
      const st = stats[id];
      st.n++;
      if (m.ci95[0] <= s.truth[id] && s.truth[id] <= m.ci95[1]) st.hit++;
      st.half.push((m.ci95[1] - m.ci95[0]) / 2);
    }
  }
  return stats;
}

test('ci95 coverage 85–99 % per id: face_on 200 + high_behind 200 synthetic shots (RN §5 noise)', () => {
  const rows = [];
  let ok = true;
  for (const [view, seed] of [['face_on', 11], ['high_behind', 12]]) {
    const st = run(view, seed);
    for (const id of IDS[view]) {
      const s = st[id];
      const cov = s.n ? (100 * s.hit) / s.n : NaN;
      const half = [...s.half].sort((a, b) => a - b)[s.half.length >> 1];
      const pass = s.n >= 0.9 * N_PER_VIEW && cov >= 85 && cov <= 99;
      ok &&= pass;
      rows.push(`${view.padEnd(12)} ${id.padEnd(18)} n=${String(s.n).padStart(3)} coverage ${cov.toFixed(1).padStart(5)} %  median half-width ${half?.toFixed(2)}  ${pass ? 'PASS' : 'FAIL'}`);
    }
  }
  console.log(`# lm coverage\n${rows.map((r) => `# ${r}`).join('\n')}`);
  assert.ok(ok, rows.join('\n'));
});
