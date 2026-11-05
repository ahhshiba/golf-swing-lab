// pipeline/live.js P4 loop with a synthetic live session (tests/synth/swing.js) and fake pose / recorder / analysis.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveLoop, wristSample, percentile95 } from '../../app/src/pipeline/live.js';
import { synthLiveSession } from '../synth/swing.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { getDiagLog } from '../../app/src/workers/diag.js';

function rowFromWrist(s) {
  const img = new Float32Array(132);
  const world = new Float32Array(99);
  for (const j of [15, 16]) { img[4 * j + 3] = s.vis; world[3 * j] = s.x_m; world[3 * j + 1] = -s.y_m; }
  return { img, world };
}

test('wristSample: camera scale from the calibration, or MediaPipe world (y down)', () => {
  const img = new Float32Array(132);
  img[60] = 0.6; img[61] = 0.25; img[63] = 0.9; img[64] = 0.6; img[65] = 0.25; img[67] = 0.8;
  const cal = { camera: { W: 1920, H: 1080, f: 1400, cx: 960, cy: 540 }, pose: { D_m: 2.8 } };
  const s = wristSample(img, null, { calibration: cal });
  assert.ok(Math.abs(s.x_m - (0.6 * 1920 - 960) * 2.8 / 1400) < 1e-4);
  assert.ok(Math.abs(s.y_m - -(0.25 * 1080 - 540) * 2.8 / 1400) < 1e-4);
  assert.equal(Math.round(s.vis * 10), 8);
  const world = new Float32Array(99);
  world[45] = 0.1; world[46] = -0.5; world[48] = 0.3; world[49] = -0.7;
  const w = wristSample(new Float32Array(132), world, {});
  assert.ok(Math.abs(w.x_m - 0.2) < 1e-7 && Math.abs(w.y_m - 0.6) < 1e-7);
  const nan = new Float32Array(132).fill(NaN);
  assert.equal(wristSample(nan, null, { calibration: cal }), null);
  assert.ok(Math.abs(percentile95([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) - 19.05) < 1e-9);
});

test('live session: swings are cut and analysed, practice and neighbour sounds are not; touches 0; P18 degrade', async () => {
  const { samples, truth } = synthLiveSession({ seed: 3, nReal: 6, nPractice: 3, nNeighbour: 4, nMissingAudio: 1 });
  let mediaNow = 0;
  let segStart = 0;
  let cuts = 0;
  const recorder = { cut: async () => { cuts++; const b = { t_media_start_s: segStart, t_media_end_s: mediaNow, size: 1 }; segStart = mediaNow; return b; } };
  const analysed = [];
  let clock = 0;
  let pushes = 0;
  const thermal = { push: (s) => { pushes++; assert.ok(s.latency_s >= 0); return { action: pushes === 2 ? 'degrade' : 'none' }; } };
  const fps = [];
  const shots = [];
  const loop = createLiveLoop({
    pose: async (bm) => rowFromWrist(bm.s),
    recorder,
    analyzeSegment: async (blob, options) => { analysed.push({ blob, options }); clock += 1500; return { shot: { n: analysed.length }, timings_ms: {} }; },
    clipOptions: { view: 'face_on', handedness: 'right', pose_model: 'full', pose_hz: 60, warnings: [RC.SETUP_UNVERIFIED], ids: { session_id: 'S' } },
    mediaClock: () => mediaNow, now: () => clock, setFps: (hz) => fps.push(hz), frameStats: () => ({ dropped_pct: 1 }), thermal,
    onShot: (r) => shots.push(r),
    livePoseModel: 'full', // this test checks the P18 full -> lite step; the PF-2 default (lite) is tested below
  });
  for (const s of samples) {
    mediaNow = s.t_s;
    clock = s.t_s * 1000;
    if (s.type === 'audio') loop.handleOnset(s.t_s);
    else await loop.handleFrame({ s }, s.t_s, { roi: { x: 0, y: 0, w: 384, h: 216 }, W: 1920, H: 1080 });
  }
  await loop.idle();
  const st = loop.stats();
  assert.equal(st.touches, 0);
  assert.equal(st.shots, truth.real.length, JSON.stringify(st));
  assert.equal(analysed.length, truth.real.length);
  assert.ok(st.detections >= st.shots && st.practice >= 0);
  for (const [k, a] of analysed.entries()) {
    const o = a.options;
    assert.equal(o.mode, 'live');
    assert.equal(o.source, 'camera');
    assert.ok(o.trim_s[0] >= 0 && o.trim_s[1] > o.trim_s[0], JSON.stringify({ trim: o.trim_s, ev: o.live_event, seg: a.blob }));
    const ev = o.live_event;
    const tr = truth.real.find((r) => Math.abs(r.t_impact - ev.t_impact) < 0.2);
    assert.ok(tr, `swing ${k} at ${ev.t_impact} matches a real one`);
    if (o.audioOnset_t !== undefined) {
      assert.ok(Math.abs(o.audioOnset_t + a.blob.t_media_start_s - ev.t_impact) < 1e-9, 'impact mapped into segment time');
      assert.ok(o.audioOnset_t >= o.trim_s[0] && o.audioOnset_t <= o.trim_s[1]);
    }
    if (k >= 2) { assert.ok(o.warnings.includes(RC.THERMAL_DEGRADED)); assert.equal(o.pose_model, 'lite'); assert.equal(o.pose_hz, 30); }
    else { assert.ok(!o.warnings.includes(RC.THERMAL_DEGRADED)); assert.equal(o.pose_model, 'full'); }
    assert.ok(o.warnings.includes(RC.SETUP_UNVERIFIED));
  }
  assert.equal(shots.length, analysed.length);
  for (const s of shots) assert.ok(s.latency_s >= 1.5 && s.latency_s < 3, String(s.latency_s));
  assert.ok(st.degraded);
  assert.ok(fps.includes(30) && fps.includes(10) && fps.includes(5), JSON.stringify([...new Set(fps)]));
  assert.ok(cuts >= analysed.length);
  const d = getDiagLog();
  const last = (p) => [...d].reverse().find((x) => x.path === p);
  assert.equal(last('live.touches_per_shot').value, 0);
  assert.ok(last('live.latency_p95_s').value >= 1.5);
  assert.equal(last('thermal.degraded').value, true);
  assert.equal(last('live.detections').value, st.detections);
});

test('touch() is counted per analysed shot; analysis failures are reported, not thrown', async () => {
  const errors = [];
  const loop = createLiveLoop({ pose: async () => { throw new Error('pose down'); }, recorder: { cut: async () => ({}) }, analyzeSegment: async () => ({}), onError: (e) => errors.push(e.message) });
  await loop.handleFrame({}, 0, {});
  assert.deepEqual(errors, ['pose down']);
  loop.touch();
  assert.equal(loop.stats().touches, 1);
  assert.equal(loop.state(), 'IDLE');
});

// ------------------------------------------------------------------------------ PF-2 / R6 (PRODUCT-SPEC §5)

function liveHarness(extra = {}) {
  const { samples, truth } = synthLiveSession({ seed: 5, nReal: 6, nPractice: 0, nNeighbour: 0, nMissingAudio: 0 });
  let mediaNow = 0;
  let segStart = 0;
  let clock = 0;
  const cuts = [];
  const holds = [];
  const recorder = {
    cut: async () => { const b = { t_media_start_s: segStart, t_media_end_s: mediaNow, size: 1 }; cuts.push([segStart, mediaNow]); segStart = mediaNow; return b; },
    hold: (on) => holds.push(on),
  };
  const analysed = [];
  const queue = [];
  let release = [];
  const loop = createLiveLoop({
    pose: async (bm) => rowFromWrist(bm.s),
    recorder,
    analyzeSegment: (blob, options) => new Promise((resolve) => { analysed.push({ blob, options }); release.push(() => resolve({ shot: { n: analysed.length }, timings_ms: {} })); }),
    clipOptions: { view: 'face_on', pose_hz: 120, warnings: [], club: { type: '7i', length_m: 0.94 } },
    mediaClock: () => mediaNow, now: () => clock, onQueue: (e) => queue.push(e), ...extra,
  });
  const feed = async (until = Infinity) => {
    for (const s of samples) {
      if (s.t_s > until) break;
      mediaNow = s.t_s;
      clock = s.t_s * 1000;
      if (s.type === 'audio') loop.handleOnset(s.t_s);
      else await loop.handleFrame({ s }, s.t_s, {});
    }
  };
  return { loop, feed, truth, analysed, queue, cuts, holds, releaseAll: () => { const r = release; release = []; r.forEach((f) => f()); }, release: () => release.shift()?.() };
}

test('PF-2: live jobs use the lite model at <= 60 Hz, the trimmed window address-0.5 s ... impact+1.2 s, and the club of the next job', async () => {
  let club = { type: 'driver', length_m: 1.15 };
  const h = liveHarness({ getClub: () => club });
  await h.feed();
  for (let i = 0; i < 10 && h.analysed.length < h.truth.real.length; i++) { h.releaseAll(); await new Promise((r) => setTimeout(r, 0)); }
  h.releaseAll();
  await h.loop.idle();
  assert.ok(h.analysed.length >= 1);
  for (const { blob, options: o } of h.analysed) {
    assert.equal(o.pose_model, 'lite');
    assert.equal(o.pose_hz, 60);
    const ev = o.live_event;
    assert.ok(Math.abs(o.trim_s[0] - Math.max(0, ev.t_address - 0.5 - blob.t_media_start_s)) < 1e-9);
    if (Number.isFinite(ev.t_impact)) assert.ok(Math.abs(o.trim_s[1] - Math.max(o.trim_s[0] + 0.1, ev.t_impact + 1.2 - blob.t_media_start_s)) < 1e-9);
    assert.deepEqual(o.club, { type: 'driver', length_m: 1.15 });
  }
  club = { type: 'pw', length_m: 0.9 };
  assert.ok(h.holds.includes(true) && h.holds.includes(false), 'recorder held during the swing');
});

test('PF-2: newest job first, at most 2 waiting (older dropped), queue events with an ETA; idle() waits for the queue', async () => {
  const h = liveHarness();
  await h.feed(); // nothing is released: every swing after the first waits
  const st = h.loop.stats();
  assert.equal(st.shots, h.truth.real.length);
  assert.ok(st.queued <= 2, JSON.stringify(st));
  assert.ok(h.queue.every((e) => e.queued <= 2), 'queue never > 2');
  assert.equal(st.dropped, Math.max(0, h.truth.real.length - 1 - 2));
  assert.equal(h.analysed.length, 1, 'one job runs at a time');
  const last = h.queue.at(-1);
  assert.ok(Number.isFinite(last.eta_s) && last.eta_s > 0);
  const firstImpact = h.analysed[0].options.live_event.t_impact;
  h.release();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(h.analysed.length, 2);
  const next = h.analysed[1].options.live_event.t_impact;
  const waitingImpacts = h.truth.real.map((x) => x.t_impact).filter((t) => t > firstImpact + 0.5);
  assert.ok(Math.abs(next - Math.max(...waitingImpacts)) < 0.3, `newest first: ${next} vs ${waitingImpacts}`);
  let done = false;
  const idle = h.loop.idle().then(() => { done = true; });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(done, false);
  for (let i = 0; i < 5; i++) { h.releaseAll(); await new Promise((r) => setTimeout(r, 0)); }
  await idle;
  assert.equal(h.loop.stats().queued, 0);
  assert.equal(h.queue.at(-1).queued, 0);
});

test('R6: while IDLE the segment is cut (discarded) every 8 s; no segment of an idle bay is longer', async () => {
  let clock = 0;
  const cuts = [];
  const loop = createLiveLoop({
    pose: async () => ({ img: new Float32Array(132).fill(NaN), world: null }),
    recorder: { cut: async () => { cuts.push(clock); return { size: 1 }; } },
    analyzeSegment: async () => ({}), now: () => clock,
  });
  for (let t = 0; t <= 60; t += 0.1) { clock = t * 1000; await loop.handleFrame({}, t, {}); }
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(cuts.length >= 6 && cuts.length <= 8, `cuts at ${cuts}`);
  const gaps = cuts.map((c, i) => c - (i ? cuts[i - 1] : 0));
  assert.ok(gaps.every((g) => g <= 8100), JSON.stringify(gaps));
  assert.equal(loop.stats().idle_cuts, cuts.length);
});
