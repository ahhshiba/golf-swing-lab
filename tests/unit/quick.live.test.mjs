// quick/live.js (the live loop's quick tap) and its hooks in pipeline/live.js (V04-SPEC §A.3): the quick read runs on
// the first wrist sample at or after impact + 0.02 s, never touches the analysed shot, rides with its swing's job to
// onShot, is withdrawn after a practice swing, and logs live.quick_log / live.quick (latency from the media clock at
// the paint, miss = refined value outside the quick ci95).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuickTap, percentile } from '../../app/src/quick/live.js';
import { quickEstimate } from '../../app/src/quick/estimate.js';
import { createLiveLoop } from '../../app/src/pipeline/live.js';
import { synthLiveSession } from '../synth/swing.js';
import { getDiagLog } from '../../app/src/workers/diag.js';
import { RC } from '../../app/src/contract/reason-codes.js';

const lastDiag = (p) => [...getDiagLog()].reverse().find((x) => x.path === p)?.value;
const tick = () => new Promise((r) => setTimeout(r, 0));

test('percentile', () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([3, 1, 2], 0.5), 2);
  assert.ok(Math.abs(percentile([1, 2, 3, 4], 0.95) - 3.85) < 1e-12);
});

test('tap: runs at the first sample >= impact + 0.02 s; latency = media clock at the paint − impact', async () => {
  const calls = [];
  let media = 0;
  let clock = 1000;
  const tap = createQuickTap({
    estimate: (inp) => { calls.push(inp); return { stage: 'provisional', t_impact: inp.impact.t_impact, metrics: {}, timings_ms: { compute: 0.2 } }; },
    input: () => ({ view: 'face_on', club: { type: '7i' } }),
    onProvisional: () => { clock += 30; return clock; },
    mediaNow: () => media,
    now: () => clock,
  });
  for (let t = 0; t <= 1.0; t += 0.1) tap.sample({ t_s: t, x_m: 0, y_m: 0 });
  tap.impact({ t_impact: 1.005, t_address: 0.2 });
  tap.sample({ t_s: 1.02, x_m: 0, y_m: 0 }); // < 1.025: not yet
  assert.equal(calls.length, 0);
  media = 1.3;
  tap.sample({ t_s: 1.03, x_m: 0, y_m: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].view, 'face_on');
  assert.ok(calls[0].samples.every((s) => s.t_s <= 1.03 && s.t_s >= 0.2 - 1.5));
  await tick();
  const log = lastDiag('live.quick_log');
  assert.equal(log.length, 1);
  assert.equal(log[0].latency_ms, 295); // (1.3 − 1.005) s, read at the paint
  assert.equal(log[0].t_ready_media, 1.03);
  const q = lastDiag('live.quick');
  assert.equal(q.n, 1);
  assert.equal(q.latency_ms_p50, 295);
  tap.sample({ t_s: 1.1, x_m: 0, y_m: 0 });
  assert.equal(calls.length, 1, 'once per impact');
});

test('tap: shot() hands the quick read to its job; a practice swing withdraws it; compare counts misses', () => {
  const dropped = [];
  const tap = createQuickTap({ estimate: (i) => ({ t_impact: i.impact.t_impact, metrics: { club_speed_mps: { value: 40, ci95: [30, 50] }, carry_m: { value: null, ci95: null } } }), onDrop: (r) => dropped.push(r) });
  tap.impact({ t_impact: 2, t_address: 1 });
  tap.sample({ t_s: 2.05 });
  const q = tap.shot({ kind: 'swing', t_impact: 2.01 });
  assert.equal(q.t_impact, 2);
  assert.equal(tap.shot({ kind: 'swing', t_impact: 2.01 }), null, 'only once');
  tap.impact({ t_impact: 5, t_address: 4 });
  tap.sample({ t_s: 5.05 });
  assert.equal(tap.shot({ kind: 'practice', t_impact: 5 }), null);
  assert.equal(dropped.length, 1);
  tap.compare(q, { metrics: { club_speed_mps: { value: 55 }, carry_m: { value: 150 } } });
  assert.deepEqual([tap.stats().compared, tap.stats().miss], [1, 1]);
  tap.compare(q, { metrics: { club_speed_mps: { value: 45 } } });
  assert.deepEqual([tap.stats().compared, tap.stats().miss], [2, 1]);
});

test('tap: an estimator error never reaches the shot path', () => {
  const tap = createQuickTap({ estimate: () => { throw Object.assign(new Error('x'), { code: 'BOOM' }); } });
  tap.impact({ t_impact: 1, t_address: 0 });
  tap.sample({ t_s: 1.1 });
  assert.equal(lastDiag('live.quick_error'), 'BOOM');
  assert.equal(tap.shot({ kind: 'swing', t_impact: 1 }), null);
});

function rowFromWrist(s) {
  const img = new Float32Array(132);
  const world = new Float32Array(99);
  for (const j of [15, 16]) { img[4 * j + 3] = s.vis; world[3 * j] = s.x_m; world[3 * j + 1] = -s.y_m; }
  return { img, world };
}

test('live loop + tap + quickEstimate on a synthetic session: a provisional per real swing before its shot, quick with the job, shot untouched', async () => {
  const { samples, truth } = synthLiveSession({ seed: 2, nReal: 5, nPractice: 2, nNeighbour: 3, nMissingAudio: 1 });
  let media = 0;
  const order = [];
  const tap = createQuickTap({
    estimate: quickEstimate,
    input: () => ({ view: 'face_on', club: { type: '7i', length_m: 0.94 }, handedness: 'right', calibration: null }),
    onProvisional: (r) => { order.push(['provisional', r.t_impact]); return 0; },
    mediaNow: () => media,
  });
  const shots = [];
  const loop = createLiveLoop({
    pose: async (bm) => rowFromWrist(bm.s),
    recorder: { cut: async () => ({ t_media_start_s: 0 }) },
    analyzeSegment: async () => ({ shot: { metrics: { tempo_ratio: { value: 3 } } }, timings_ms: {} }),
    clipOptions: { view: 'face_on', handedness: 'right' },
    mediaClock: () => media,
    quick: () => tap,
    onShot: (r) => { shots.push(r); order.push(['shot', r.event.t_impact]); },
  });
  for (const s of samples) {
    media = s.t_s;
    if (s.type === 'audio') loop.handleOnset(s.t_s);
    else await loop.handleFrame({ s }, s.t_s, {});
  }
  await loop.idle();
  await tick();
  assert.equal(shots.length, truth.real.length);
  const prov = order.filter((x) => x[0] === 'provisional');
  assert.ok(prov.length >= truth.real.length, `provisionals ${prov.length}`);
  for (const r of shots) {
    assert.ok(r.quick, 'every analysed swing carries its quick read');
    assert.equal(r.quick.stage, 'provisional');
    assert.ok(Math.abs(r.quick.t_impact - r.event.t_impact) < 0.5);
    for (const m of Object.values(r.quick.metrics)) assert.ok(m.reason_codes.includes(RC.PROVISIONAL));
    assert.deepEqual(Object.keys(r.shot), ['metrics'], 'the shot is not touched');
    const ip = order.findIndex((x) => x[0] === 'provisional' && x[1] === r.quick.t_impact);
    const is = order.findIndex((x) => x[0] === 'shot' && x[1] === r.event.t_impact);
    assert.ok(ip >= 0 && ip < is, 'provisional before the shot');
  }
  const q = lastDiag('live.quick');
  assert.ok(q.n >= truth.real.length && Number.isFinite(q.latency_ms_p50));
  assert.ok(q.compared >= truth.real.length);
});
