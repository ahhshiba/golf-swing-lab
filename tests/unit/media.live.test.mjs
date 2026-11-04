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
