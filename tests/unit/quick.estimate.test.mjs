// V04-SPEC §G.3 V4-B acceptance 1: the quick read (quick/estimate.js) on tests/fixtures/v4/quick-swings.json — 200
// synthetic live swings (30 / 60 fps half each; face_on, dtl, high_behind) with the refined (full-analysis) values of
// the same swings. Each swing runs the whole live chain: the wrist samples (and the impact sound) go through the
// events/live.js detector, its 'impact' event triggers the quick read on the samples up to the first one at or after
// impact + 0.02 s (what pipeline/live.js + quick/live.js do on the phone).
//   * club_speed_mps (face_on): the quick ci95 covers the refined value in >= 85 % of the swings
//   * tempo: median |quick − refined| <= 0.05 s for backswing_s and downswing_s; tempo_ratio (no unit, ≈ 3) median
//     relative |Δ| <= 10 % (DEVIATION: the spec's "0.05 s" cannot apply to a ratio; 10 % is the same order as the
//     refined analysis' own distance from the synthetic truth, ≈ 4 %, plus the 10 Hz address sampling)
//   * dtl / high_behind carry comes from a prior (origin 'prior', GAPPING_PRIOR with a distance-table row, else
//     REFERENCE_PRIOR); no club speed there
//   * each timing metric's quick ci95 covers the refined value in >= 95 % of the swings
//   * every quick metric: validity low_confidence (or a null validity); a number always has ci95, sigma and PROVISIONAL
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadQuickSwings, makeSwing } from './quick.fixtures.mjs';
import { quickEstimate, gappingPrior, referencePrior, tableCarry } from '../../app/src/quick/estimate.js';
import { createLiveDetector } from '../../app/src/events/live.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { NULL_VALIDITIES, VALUE_ORIGINS } from '../../app/src/contract/enums.js';

const F = loadQuickSwings();
const median = (a) => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const GAP = { club: 'driver', n: 9, carry: { n: 9, median: 205, p10: 186, p90: 222, sd_obs: 13 } };

/** The live chain for one fixture swing: detector -> impact event -> quick read at impact + 0.02 s. */
export function quickFor(s, extra = {}) {
  const det = createLiveDetector({ audioAvailable: true });
  const stream = [...s.samples.map((x) => ({ type: 'wrist', t_s: x[0], x_m: x[1], y_m: x[2], vis: 0.9 })), ...s.audio.map((t) => ({ type: 'audio', t_s: t }))]
    .sort((a, b) => a.t_s - b.t_s || (a.type === 'audio' ? -1 : 1));
  let impact = null;
  for (const x of stream) {
    const ev = det.feed(x).find((e) => e.type === 'impact');
    if (ev && !impact) impact = ev;
    if (impact && x.type === 'wrist' && x.t_s >= impact.t_impact + 0.02) {
      const samples = s.samples.filter((y) => y[0] <= x.t_s);
      return { impact, r: quickEstimate({ samples, impact, view: s.view, fps: s.fps, club: s.club, handedness: s.handedness, calibration: s.calibration, gappingRow: null, settings: {}, ...extra }) };
    }
  }
  return { impact, r: null };
}

const results = F.swings.map((s) => ({ s, ...quickFor(s) }));

test('fixture: 200 swings, 30 / 60 fps half each, all three views, refined values present', () => {
  assert.equal(F.swings.length, 200);
  assert.equal(F.swings.filter((s) => s.fps === 30).length, 100);
  assert.equal(F.swings.filter((s) => s.fps === 60).length, 100);
  for (const v of ['face_on', 'dtl', 'high_behind']) assert.ok(F.swings.some((s) => s.view === v), v);
  for (const s of F.swings) for (const id of ['backswing_s', 'downswing_s', 'tempo_ratio']) assert.ok(Number.isFinite(s.refined[id].value), `${s.id} ${id}`);
});

test('fixture is reproducible (3 swings regenerated)', () => {
  for (const i of [0, 151, 199]) assert.deepEqual(JSON.parse(JSON.stringify(makeSwing(i))), F.swings[i], `swing ${i}`);
});

test('every swing gets an impact event and a quick read', () => {
  const missing = results.filter((x) => !x.r).map((x) => x.s.id);
  assert.deepEqual(missing, []);
});

test('club_speed_mps: quick ci95 covers the refined value in >= 85 % of the face_on swings', () => {
  const fo = results.filter((x) => x.s.view === 'face_on' && Number.isFinite(x.s.refined.club_speed_mps.value));
  assert.ok(fo.length >= 100, `face_on swings with a refined club speed: ${fo.length}`);
  const hit = fo.filter(({ s, r }) => { const q = r.metrics.club_speed_mps; return Number.isFinite(q.value) && s.refined.club_speed_mps.value >= q.ci95[0] && s.refined.club_speed_mps.value <= q.ci95[1]; });
  const ratio = median(fo.filter(({ r }) => Number.isFinite(r.metrics.club_speed_mps.value)).map(({ s, r }) => r.metrics.club_speed_mps.value / s.refined.club_speed_mps.value));
  console.log(`club speed: ci95 covers refined ${hit.length}/${fo.length} = ${(hit.length / fo.length).toFixed(3)}; median quick/refined ${ratio.toFixed(3)}`);
  assert.ok(hit.length / fo.length >= 0.85);
  for (const { r } of fo) {
    const q = r.metrics.club_speed_mps;
    if (!Number.isFinite(q.value)) continue;
    assert.ok((q.ci95[1] - q.ci95[0]) / 2 >= 0.25 * q.value - 1e-9, 'ci95 at least ±25 % (F2 低)');
  }
});

test('tempo: median |quick − refined| <= 0.05 s (backswing, downswing); ratio median relative |Δ| <= 10 %', () => {
  const d = { backswing_s: [], downswing_s: [], tempo_ratio: [] };
  for (const { s, r } of results) {
    for (const id of Object.keys(d)) {
      const q = r.metrics[id].value;
      const f = s.refined[id].value;
      if (Number.isFinite(q)) d[id].push(id === 'tempo_ratio' ? Math.abs(q - f) / f : Math.abs(q - f));
    }
  }
  const m = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, median(v)]));
  console.log(`tempo median |Δ|: backswing ${m.backswing_s.toFixed(3)} s, downswing ${m.downswing_s.toFixed(3)} s, ratio ${(100 * m.tempo_ratio).toFixed(1)} % (n ${d.backswing_s.length})`);
  assert.ok(d.backswing_s.length >= 195);
  assert.ok(m.backswing_s <= 0.05);
  assert.ok(m.downswing_s <= 0.05);
  assert.ok(m.tempo_ratio <= 0.10);
});

test('tempo ci95 (quick) covers the refined value in >= 95 % of the swings, for each timing metric', () => {
  for (const id of ['backswing_s', 'downswing_s', 'tempo_ratio']) {
    const ok = results.filter(({ s, r }) => { const m = r.metrics[id]; return Number.isFinite(m.value) && s.refined[id].value >= m.ci95[0] && s.refined[id].value <= m.ci95[1]; }).length;
    const half = median(results.map(({ r }) => (r.metrics[id].ci95[1] - r.metrics[id].ci95[0]) / 2));
    console.log(`${id}: ci95 covers refined ${ok}/${results.length}; median half-width ${half.toFixed(3)}`);
    assert.ok(ok / results.length >= 0.95, `${id}: ${ok}/${results.length}`);
  }
});

test('dtl / high_behind: no club speed; carry is a prior (GAPPING_PRIOR with a distance-table row, else REFERENCE_PRIOR)', () => {
  const other = results.filter((x) => x.s.view !== 'face_on');
  assert.equal(other.length, 60);
  for (const { s, r } of other) {
    assert.equal(r.metrics.club_speed_mps.value, null);
    assert.ok(NULL_VALIDITIES.includes(r.metrics.club_speed_mps.validity));
    const c = r.metrics.carry_m;
    assert.equal(c.value_origin, 'prior');
    assert.ok(c.reason_codes.includes(RC.REFERENCE_PRIOR), `${s.id}: ${c.reason_codes}`);
    assert.equal(r.carry_source, 'reference');
    const g = quickFor(s, { gappingRow: { ...GAP, club: s.club.type } }).r;
    assert.equal(g.metrics.carry_m.value_origin, 'prior');
    assert.ok(g.metrics.carry_m.reason_codes.includes(RC.GAPPING_PRIOR));
    assert.equal(g.carry_source, 'gapping');
    assert.equal(g.metrics.carry_m.value, 205);
  }
});

test('face_on carry: flight table from the club speed (SMASH / LAUNCH_V assumed, FLIGHT_MODELLED), merged with the distance table', () => {
  const { s, r } = results.find((x) => x.s.view === 'face_on' && Number.isFinite(x.r.metrics.club_speed_mps.value));
  assert.equal(r.carry_source, 'pose');
  const c = r.metrics.carry_m;
  for (const code of [RC.PROVISIONAL, RC.SMASH_ASSUMED, RC.LAUNCH_V_ASSUMED, RC.FLIGHT_MODELLED]) assert.ok(c.reason_codes.includes(code), code);
  assert.ok(!c.reason_codes.includes(RC.GAPPING_PRIOR));
  assert.ok(c.sigma / c.value > 0.15, `face_on quick carry 1σ ${(100 * c.sigma / c.value).toFixed(0)} % (spec: about 30–35 %)`);
  const g = quickFor(s, { gappingRow: GAP }).r;
  const gc = g.metrics.carry_m;
  assert.ok(gc.reason_codes.includes(RC.GAPPING_PRIOR));
  assert.ok(gc.sigma < c.sigma, 'merging with the distance table narrows the range');
  const { pose, gapping } = g.carry_merge;
  assert.ok(Math.abs(pose.w + gapping.w - 1) < 1e-9);
  assert.ok(Math.abs(gc.value - (pose.carry * pose.w + gapping.carry * gapping.w)) < 1e-6, 'inverse-variance mean');
  assert.ok(Math.abs(gc.sigma - Math.sqrt(1 / (1 / pose.sigma ** 2 + 1 / gapping.sigma ** 2))) < 1e-9);
});

test('honesty: low_confidence or null; a number has ci95 + sigma + PROVISIONAL; never ball speed / launch / spin', () => {
  for (const { s, r } of results) {
    assert.equal(r.stage, 'provisional');
    assert.equal(r.view, s.view, 'the view rides with the result (sim banner, V4-D)');
    assert.ok(Number.isFinite(r.t_impact));
    assert.ok(Number.isFinite(r.timings_ms.compute));
    assert.deepEqual(Object.keys(r.metrics).sort(), ['backswing_s', 'carry_m', 'club_speed_mps', 'downswing_s', 'tempo_ratio']);
    for (const [id, m] of Object.entries(r.metrics)) {
      assert.ok(VALUE_ORIGINS.includes(m.value_origin), `${s.id} ${id} origin`);
      assert.equal(m.measured, false);
      assert.ok(m.reason_codes.includes(RC.PROVISIONAL), `${s.id} ${id}: PROVISIONAL`);
      if (m.value === null) { assert.ok(NULL_VALIDITIES.includes(m.validity), `${s.id} ${id} ${m.validity}`); continue; }
      assert.equal(m.validity, 'low_confidence', `${s.id} ${id}`);
      assert.ok(Array.isArray(m.ci95) && m.ci95[0] <= m.value && m.value <= m.ci95[1], `${s.id} ${id} ci95`);
      assert.ok(Number.isFinite(m.sigma) && m.sigma > 0, `${s.id} ${id} sigma`);
    }
  }
});

test('priors: distance-table row needs n >= 5; reference scales with the driver carry; table interpolates', () => {
  assert.equal(gappingPrior({ ...GAP, n: 4 }), null);
  const g = gappingPrior(GAP);
  assert.equal(g.carry, 205);
  assert.ok(Math.abs(g.sigma - (222 - 186) / 2.5631) < 1e-9);
  assert.deepEqual(referencePrior('7i', null), { carry: 135, sigma: 0.12 * 135 });
  assert.ok(Math.abs(referencePrior('7i', 180).carry - 135 * 0.9) < 1e-9);
  const a = tableCarry('7i', 50), b = tableCarry('7i', 52), m = tableCarry('7i', 51);
  assert.ok(Math.abs(m.carry - (a.carry + b.carry) / 2) < 1e-9);
  assert.equal(tableCarry('7i', 90), null);
  assert.equal(tableCarry('putter', 50), null);
});
