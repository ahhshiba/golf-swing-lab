// pipeline/clip.js orchestration with injected probe / decoder / pose / assembleShot (Node runs it end to end).
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeClip, captureFromProbe, orientationFromProbe, ballRoiFor } from '../../app/src/pipeline/clip.js';
import { gridIndices } from '../../app/src/import/timebase.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { validateShot } from '../../app/src/contract/validate.js';
import { m4Specs, buildE2EShot } from '../synth/e2e.js';

function fakeProbe(n = 481, fps = 240, extra = {}) {
  const cts = Array.from({ length: n }, (_, i) => i / fps);
  return { codec: 'avc1.64002A', family: 'avc', width: 1920, height: 1080, display_width: 1920, display_height: 1080, rotation: 0,
    sample_count: n, effective_fps: fps, nominal_fps: fps, vfr: false, timestamps: 'container', cts_s: cts, reason_codes: [], ...extra };
}

function fakeDecoder(probe, log, extraCodes = []) {
  return async (file, d) => {
    log.push({ purpose: d.purpose, from_s: d.from_s, to_s: d.to_s, hz: d.hz, roi: d.roi });
    const idx = gridIndices(probe.cts_s, d.hz, d.from_s, d.to_s);
    let n = 0;
    for (const i of idx) {
      if (d.signal && d.signal.aborted) throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' });
      const frame = { i, closed: false, close() { this.closed = true; } };
      await d.onFrame(frame, probe.cts_s[i], i);
      frame.close();
      n++;
    }
    return { path: 'fake', decoded: n, emitted: n, reason_codes: extraCodes };
  };
}

const poseRowFake = () => ({ img: new Float32Array(132).fill(0.5), world: new Float32Array(99) });

test('probe -> 60 Hz pose pass -> events -> full-rate impact window -> gray frames -> assembleShot', async () => {
  const probe = fakeProbe();
  const log = [];
  const stages = [];
  let assembled = null;
  const res = await analyzeClip({ name: 'clip.mov' }, {
    view: 'face_on', handedness: 'right', calibration: { tag: 'cal' }, club: { type: 'driver' }, venue: { mat_L: 1.5 },
    ids: { shot_id: 's1' }, warnings: [RC.SETUP_UNVERIFIED], restBall: { u: 700, v: 900, w_px: 22 }, seed: 5, clip_ref: 'clip-1',
  }, {
    probe: async () => probe,
    decode: fakeDecoder(probe, log, [RC.TIMESTAMPS_NOMINAL]),
    pose: async (frame, t_s, { rotation }) => { assert.equal(rotation, 0); return poseRowFake(); },
    toGray: (frame, { roi }) => ({ data: new Uint8Array(roi.w * roi.h), W: roi.w, H: roi.h, origin: { u: roi.x, v: roi.y } }),
    detect: (seq, o) => {
      assert.equal(o.view, 'face_on');
      assert.equal(seq.t_s.length, 121); // 2 s at 60 Hz
      assert.equal(seq.W, 1920);
      return { impact: { frame: 60, t_s: 1.0, conf: 0.9, source: 'rules' } };
    },
    assembleShot: async (args) => { assembled = args; return { shot: { shot_id: args.ids.shot_id }, timings_ms: { total: 1 }, debug: { ok: 1 } }; },
    onProgress: (s, f) => stages.push([s, f]),
  });
  assert.deepEqual(log.map((l) => l.purpose), ['pose', 'impact']);
  assert.equal(log[0].hz, 60);
  assert.equal(log[1].hz, 0);
  assert.ok(Math.abs(log[1].from_s - (1 - 30 / 240)) < 1e-12);
  assert.ok(Math.abs(log[1].to_s - (1 + 60 / 240)) < 1e-12);
  assert.equal(res.timings_ms.pose_frames, 121);
  assert.equal(res.timings_ms.impact_frames, 91);
  assert.equal(assembled.ballFrames.frames.length, 91);
  assert.equal(assembled.ballFrames.times[30], 1.0);
  assert.equal(assembled.ballFrames.W, log[1].roi.w);
  assert.deepEqual(assembled.ballFrames.origin, { u: log[1].roi.x, v: log[1].roi.y });
  assert.equal(assembled.capture.mode, 'highspeed');
  assert.equal(assembled.capture.source, 'import');
  assert.equal(assembled.capture.orientation, 'landscape-primary');
  assert.equal(assembled.capture.effective_fps, 240);
  assert.equal(assembled.capture.clip_ref, 'clip-1');
  assert.equal(assembled.capture.timestamps.length, 481, 'container CTS passed for frame re-indexing');
  assert.deepEqual(assembled.warnings, [RC.SETUP_UNVERIFIED, RC.TIMESTAMPS_NOMINAL]);
  assert.equal(assembled.seed, 5);
  assert.equal(assembled.handedness, 'right');
  assert.equal(res.shot.shot_id, 's1');
  const order = [...new Set(stages.map((s) => s[0]))];
  assert.deepEqual(order, ['probe', 'pose', 'events', 'impact', 'assemble']);
  for (const [, f] of stages) assert.ok(f >= 0 && f <= 1);
});

test('trim_s limits the pose pass; nominal timestamps are not passed as container CTS', async () => {
  const probe = fakeProbe(481, 240, { timestamps: 'nominal', reason_codes: [RC.TIMESTAMPS_NOMINAL] });
  const log = [];
  let assembled;
  await analyzeClip({}, { view: 'dtl', trim_s: [0.5, 1.5] }, {
    probe: async () => probe, decode: fakeDecoder(probe, log), pose: async () => poseRowFake(),
    toGray: (f, { roi }) => ({ data: new Uint8Array(4), W: 2, H: 2, origin: { u: roi.x, v: roi.y } }),
    detect: () => ({ impact: { t_s: 1.45, frame: 0, conf: 1, source: 'rules' } }),
    assembleShot: (a) => { assembled = a; return { shot: {} }; },
  });
  assert.equal(log[0].from_s, 0.5);
  assert.equal(log[0].to_s, 1.5);
  assert.equal(log[1].to_s, 1.5, 'impact window clipped to the trim');
  assert.equal(assembled.capture.timestamps, 'nominal');
  assert.deepEqual(assembled.capture.trim_s, [0.5, 1.5]);
  assert.ok(assembled.warnings.includes(RC.TIMESTAMPS_NOMINAL));
});

test('no swing, no impact, cancel and assemble failures map to protocol codes', async () => {
  const probe = fakeProbe(20, 240);
  const base = { probe: async () => probe, decode: fakeDecoder(probe, []), pose: async () => poseRowFake(), toGray: () => ({ data: new Uint8Array(1), W: 1, H: 1, origin: { u: 0, v: 0 } }) };
  await assert.rejects(analyzeClip({}, { view: 'face_on' }, base), (e) => e.code === 'NO_SWING_FOUND'); // 5 pose frames
  const p2 = fakeProbe();
  const b2 = { ...base, probe: async () => p2, decode: fakeDecoder(p2, []) };
  await assert.rejects(analyzeClip({}, { view: 'face_on' }, { ...b2, detect: () => ({}) }), (e) => e.code === 'NO_SWING_FOUND');
  await assert.rejects(analyzeClip({}, { view: 'face_on' }, { ...b2, detect: () => { throw new Error('bad pose'); } }), (e) => e.code === 'NO_SWING_FOUND');
  await assert.rejects(analyzeClip({}, { view: 'face_on' }, { ...b2, detect: () => ({ impact: { t_s: 1 } }), assembleShot: () => { throw new Error('contract'); } }),
    (e) => e.code === 'ASSEMBLE_FAILED' && /contract/.test(e.message));
  const ctl = new AbortController();
  let n = 0;
  await assert.rejects(analyzeClip({}, { view: 'face_on' }, { ...b2, signal: ctl.signal, pose: async () => { if (++n === 10) ctl.abort(); return poseRowFake(); } }),
    (e) => e.code === 'CANCELLED');
});

test('capture helpers: orientation from rotation, ball ROI from the calibration camera', () => {
  assert.equal(orientationFromProbe({ width: 1920, height: 1080, rotation: 90, display_width: 1080, display_height: 1920 }), 'portrait-primary');
  assert.equal(orientationFromProbe({ width: 1920, height: 1080, rotation: 180 }), 'landscape-secondary');
  assert.equal(orientationFromProbe({ width: 1080, height: 1920, rotation: 0 }), 'portrait-primary');
  assert.equal(orientationFromProbe({ width: 0 }), 'unknown');
  const cap = captureFromProbe(fakeProbe(), { view: 'face_on', mode: 'live' });
  assert.equal(cap.source, 'camera');
  assert.deepEqual(cap.trim_s, [0, 2]);
  const roi = ballRoiFor(1920, 1080, { restBall: { u: 700, v: 900, w_px: 22 } });
  assert.ok(roi.x <= 700 - 22 && roi.x + roi.w >= 1900 && roi.y === 0 && roi.y + roi.h > 900);
  assert.deepEqual(ballRoiFor(10, 10, { ball_roi: { x: 1, y: 2, w: 3, h: 4 } }), { x: 1, y: 2, w: 3, h: 4 });
});

test('integration: synthetic M4 shot through clip.js with the real events + assembleShot', { timeout: 55000 }, async () => {
  const spec = m4Specs({ seed: 1, quick: true }).main[0];
  const { input, truth } = buildE2EShot(spec);
  const cts = Array.from(input.capture.timestamps);
  const probe = fakeProbe(cts.length, 240, { cts_s: cts, width: input.capture.width, height: input.capture.height,
    display_width: input.capture.width, display_height: input.capture.height });
  const ps = input.poseSeq;
  const bf = input.ballFrames;
  const byTime = new Map(Array.from(bf.times, (t, k) => [Math.round(t * 1e6), k]));
  const log = [];
  const res = await analyzeClip({}, {
    view: input.capture.view, calibration: input.calibration, club: input.club, handedness: input.handedness, venue: input.venue,
    ids: input.ids, warnings: input.warnings, restBall: input.restBall, seed: input.seed, orientation: input.capture.orientation,
    ball_roi: { x: bf.origin.u, y: bf.origin.v, w: bf.W, h: bf.H }, audioOnset_t: input.audioOnset_t,
  }, {
    probe: async () => probe,
    decode: async (file, d) => {
      log.push(d.purpose);
      if (d.purpose === 'pose') {
        for (let i = 0; i < ps.t_s.length; i++) await d.onFrame({ i }, ps.t_s[i], i);
      } else {
        for (const [i, t] of cts.entries()) {
          if (t < d.from_s - 1e-9 || t > d.to_s + 1e-9) continue;
          const k = byTime.get(Math.round(t * 1e6));
          if (k !== undefined) await d.onFrame({ k }, t, i);
        }
      }
      return { reason_codes: [] };
    },
    pose: async (frame) => ({ img: ps.img.slice(frame.i * 132, frame.i * 132 + 132), world: ps.world.slice(frame.i * 99, frame.i * 99 + 99) }),
    toGray: (frame) => ({ data: bf.frames[frame.k], W: bf.W, H: bf.H, origin: bf.origin }),
  });
  assert.deepEqual(log, ['pose', 'impact']);
  assert.ok(res.timings_ms.impact_frames >= 80, String(res.timings_ms.impact_frames));
  const v = validateShot(res.shot);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const bs = res.shot.metrics.ball_speed_mps;
  assert.notEqual(bs.value, null, JSON.stringify(bs));
  assert.ok(Math.abs(bs.value - truth.speed) / truth.speed < 0.05, `ball speed ${bs.value} vs ${truth.speed}`);
});
