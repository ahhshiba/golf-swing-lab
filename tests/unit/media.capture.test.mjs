// capture/{camera,recorder,frametap}.js and sensors/gravity.js against fake browser objects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openCamera, closeCamera, getGumCalls, onTrackEnded, cameraConstraints, _resetCameraForTests } from '../../app/src/capture/camera.js';
import { createSegmentRecorder, pickMimeType, supportedTypes, RECORDER_CANDIDATES } from '../../app/src/capture/recorder.js';
import { cropRect, createThrottle, createFrameTap } from '../../app/src/capture/frametap.js';
import { requestMotionPermission, startGravity, getMotionState, motionReasonCodes, _resetMotionForTests } from '../../app/src/sensors/gravity.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { accelFromPose } from '../../app/src/calib/gravity.js';

class FakeTrack extends EventTarget {
  constructor(kind, settings = {}) { super(); this.kind = kind; this.settings = settings; this.stopped = false; }
  getSettings() { return this.settings; }
  stop() { this.stopped = true; }
}
function fakeStream({ audio = true } = {}) {
  const v = new FakeTrack('video', { width: 1920, height: 1080, frameRate: 30 });
  const a = audio ? new FakeTrack('audio') : null;
  const tracks = a ? [v, a] : [v];
  return { tracks, getTracks: () => tracks, getVideoTracks: () => [v], getAudioTracks: () => (a ? [a] : []) };
}

test('openCamera calls getUserMedia synchronously, once, with video+audio and ideal 60 fps', async () => {
  _resetCameraForTests();
  const calls = [];
  const env = { navigator: { mediaDevices: { getUserMedia: (c) => { calls.push(c); return Promise.resolve(fakeStream()); } } } };
  const p = openCamera({ env });
  assert.equal(calls.length, 1, 'invoked before openCamera returned (same user activation)');
  assert.equal(getGumCalls(), 1);
  const cam = await p;
  assert.equal(calls[0].video.frameRate.ideal, 60);
  assert.equal(calls[0].video.facingMode.ideal, 'environment');
  assert.ok(calls[0].audio);
  assert.equal(cam.settings.frameRate, 30);
  assert.equal(cam.audio_unavailable, false);
  const ended = [];
  const off = onTrackEnded((e) => ended.push(e));
  cam.videoTrack.dispatchEvent(new Event('ended'));
  assert.deepEqual(ended, [{ kind: 'video', reason: 'ended' }]);
  off();
  closeCamera();
  assert.ok(cam.stream.getTracks().every((t) => t.stopped));
  assert.equal(getGumCalls(), 1);
});

test('microphone missing -> one counted video-only retry; permission denied -> rejects', async () => {
  _resetCameraForTests();
  let n = 0;
  const env = { navigator: { mediaDevices: { getUserMedia: (c) => { n++; if (c.audio) return Promise.reject(Object.assign(new Error('no mic'), { name: 'NotFoundError' })); return Promise.resolve(fakeStream({ audio: false })); } } } };
  const cam = await openCamera({ env });
  assert.equal(cam.audio_unavailable, true);
  assert.equal(cam.audioTrack, null);
  assert.equal(getGumCalls(), 2);
  _resetCameraForTests();
  const deny = { navigator: { mediaDevices: { getUserMedia: () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) } } };
  await assert.rejects(openCamera({ env: deny }), (e) => e.name === 'NotAllowedError');
  assert.equal(getGumCalls(), 1, 'a denial is not retried');
  await assert.rejects(openCamera({ env: { navigator: {} } }), (e) => e.name === 'NotSupportedError');
  assert.equal(cameraConstraints({ audio: false }).audio, false);
});

test('recorder: first supported of mp4/avc1 then webm; cut() = stop + immediate restart', async () => {
  assert.equal(pickMimeType((t) => t.startsWith('video/webm')), 'video/webm;codecs=vp9,opus');
  assert.equal(pickMimeType((t) => t === 'video/mp4'), 'video/mp4');
  assert.equal(pickMimeType((t) => t.includes('avc1')), RECORDER_CANDIDATES[0]);
  assert.equal(pickMimeType(() => false), '');
  assert.deepEqual(supportedTypes(null), []);
  const made = [];
  class MR {
    static isTypeSupported(t) { return t === 'video/mp4'; }
    constructor(stream, o) { this.o = o; this.state = 'inactive'; this.mimeType = o.mimeType; made.push(this); }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; setTimeout(() => { this.ondataavailable({ data: new Blob(['x'.repeat(made.indexOf(this) + 1)], { type: 'video/mp4' }) }); this.onstop(); }, 1); }
  }
  let mt = 1.0;
  const rec = createSegmentRecorder({}, { env: { MediaRecorder: MR, Blob }, mediaClock: () => mt });
  assert.equal(rec.mimeType, 'video/mp4');
  rec.start();
  assert.equal(made.length, 1);
  mt = 4.5;
  const b1 = await rec.cut();
  assert.equal(made.length, 2);
  assert.equal(made[1].state, 'recording', 'next segment started immediately');
  assert.equal(b1.size, 1);
  assert.equal(b1.t_media_start_s, 1.0);
  assert.equal(b1.t_media_end_s, 4.5);
  assert.equal(b1.mimeType, 'video/mp4');
  const b2 = await rec.stop();
  assert.equal(b2.size, 2);
  assert.equal(b2.t_media_start_s, 4.5);
  assert.equal(await rec.stop(), null);
  assert.throws(() => createSegmentRecorder({}, { env: {} }), /MediaRecorder/);
});

test('frame tap: ROI crop to <= 384 px, throttle on media time, rVFC mediaTime and drop counting', async () => {
  assert.deepEqual(cropRect({ x: 100, y: 50, w: 768, h: 432 }, 1920, 1080, 384), { sx: 100, sy: 50, sw: 768, sh: 432, dw: 384, dh: 216, scale: 0.5 });
  assert.deepEqual(cropRect(null, 640, 360, 384), { sx: 0, sy: 0, sw: 640, sh: 360, dw: 384, dh: 216, scale: 0.6 });
  assert.equal(cropRect({ x: 1800, y: 0, w: 400, h: 100 }, 1920, 1080).sw, 120);
  assert.equal(cropRect({ x: 0, y: 0, w: 200, h: 100 }, 1920, 1080).scale, 1);
  const th = createThrottle(10);
  const due = [];
  for (let i = 0; i < 60; i++) if (th.due(i / 60)) due.push(i);
  assert.deepEqual(due, [0, 6, 12, 18, 24, 30, 36, 42, 48, 54]);

  let cb = null;
  const draws = [];
  const video = { videoWidth: 1920, videoHeight: 1080, currentTime: 0, requestVideoFrameCallback(f) { cb = f; return 1; }, cancelVideoFrameCallback() {} };
  class OC { constructor(w, h) { this.width = w; this.height = h; } getContext() { return { drawImage: (...a) => draws.push(a) }; } transferToImageBitmap() { return { w: this.width, h: this.height, close() {} }; } }
  const got = [];
  const tap = createFrameTap(video, { fps: 30, maxWidth: 384, roi: () => ({ x: 960, y: 0, w: 960, h: 1080 }), env: { OffscreenCanvas: OC },
    onFrame: async (bm, t, meta) => { got.push([t, bm.w, bm.h, meta.roi.x, meta.scale]); } });
  tap.start();
  const frames = [0, 1, 2, 3, 5, 6, 7, 8]; // presentedFrames 4 missing -> 1 dropped
  for (const k of frames) { const f = cb; cb = null; f(1000 + k * 16.7, { mediaTime: k / 60, presentedFrames: k, presentationTime: 1000 + k * 16.7 }); await new Promise((r) => setTimeout(r, 0)); }
  tap.stop();
  assert.deepEqual(got.map((g) => g[0]), [0, 2 / 60, 5 / 60, 6 / 60, 8 / 60]); // frame 4 was never presented
  assert.deepEqual(got[0].slice(1), [384, 432, 960, 0.4]);
  assert.deepEqual(draws[0].slice(1), [960, 0, 960, 1080, 0, 0, 384, 432]);
  const st = tap.stats();
  assert.equal(st.dropped, 1);
  assert.ok(Math.abs(tap.mediaTimeAt(1000 + 8 * 16.7 + 100) - (8 / 60 + 0.1)) < 1e-9);
});

test('recorder startClock (0.4.0 live timing fix): segment start = startClock() (number or Promise), not mediaClock; the blob waits for it', async () => {
  class MR {
    constructor() { this.state = 'inactive'; this.mimeType = 'video/webm'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; setTimeout(() => { this.ondataavailable({ data: new Blob(['x'], { type: 'video/webm' }) }); this.onstop(); }, 1); }
  }
  let mt = 2.0;
  let release;
  const starts = [new Promise((r) => { release = r; }), 7.25];
  const rec = createSegmentRecorder({}, { env: { MediaRecorder: MR, Blob }, mediaClock: () => mt, startClock: () => starts.shift() });
  rec.start();
  mt = 6.0;
  const p1 = rec.cut();
  let done = false;
  p1.then(() => { done = true; });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(done, false, 'the blob waits for the first-frame time');
  release(2.033);
  const b1 = await p1;
  assert.equal(b1.t_media_start_s, 2.033, 'start = the first recorded frame, not mediaClock() (2.0)');
  assert.equal(b1.t_media_end_s, 6.0);
  const b2 = await rec.stop();
  assert.equal(b2.t_media_start_s, 7.25);
  // a rejected / non-finite start → null (pipeline/live.js then treats the segment as starting at 0)
  const rec2 = createSegmentRecorder({}, { env: { MediaRecorder: MR, Blob }, mediaClock: () => 1, startClock: () => Promise.reject(new Error('x')) });
  rec2.start();
  assert.equal((await rec2.stop()).t_media_start_s, null);
});

test('frame tap nextMediaTime: first presented frame at/after a media time; timeout resolves the asked time', async () => {
  let cb = null;
  const video = { videoWidth: 640, videoHeight: 360, currentTime: 0, requestVideoFrameCallback(f) { cb = f; return 1; }, cancelVideoFrameCallback() {} };
  class OC { constructor(w, h) { this.width = w; this.height = h; } getContext() { return { drawImage() {} }; } transferToImageBitmap() { return { close() {} }; } }
  const tap = createFrameTap(video, { fps: 10, env: { OffscreenCanvas: OC, setTimeout, clearTimeout }, onFrame: async () => {} });
  tap.start();
  const frame = (k) => { const f = cb; cb = null; f(1000 + k * 33.3, { mediaTime: k / 30, presentedFrames: k, captureTime: 1000 + k * 33.3 }); };
  frame(0); frame(1);
  const nowM = tap.mediaTimeAt(1000 + 1 * 33.3 + 20); // 20 ms after frame 1
  assert.ok(Math.abs(nowM - (1 / 30 + 0.02)) < 1e-9);
  const p = tap.nextMediaTime(nowM);
  frame(2); // 2/30 = 0.0667 >= 0.0533
  assert.ok(Math.abs((await p) - 2 / 30) < 1e-12, 'the next frame, not the last one');
  assert.equal(await tap.nextMediaTime(99, 5), 99, 'no frame in time → the asked time');
  tap.stop();
});

test('motion permission: requestPermission is the first call (sync), states recorded; gravity samples via the tracker', async () => {
  _resetMotionForTests();
  const order = [];
  const env = { DeviceMotionEvent: { requestPermission: () => { order.push('rp'); return Promise.resolve('granted'); } } };
  const p = requestMotionPermission({ env });
  order.push('returned');
  assert.deepEqual(order, ['rp', 'returned']);
  assert.equal(await p, 'granted');
  assert.equal(getMotionState().permission, 'granted');
  assert.equal(getMotionState().same_click, true);
  _resetMotionForTests();
  assert.equal(await requestMotionPermission({ env: { DeviceMotionEvent: { requestPermission: () => Promise.reject(new Error('NotAllowed')) } } }), 'denied');
  assert.equal(await requestMotionPermission({ env: { DeviceMotionEvent: { requestPermission: () => { throw new Error('no activation'); } } }, retry: true }), 'denied');
  assert.equal(getMotionState().same_click, false);
  assert.equal(await requestMotionPermission({ env: { DeviceMotionEvent: function DME() {} } }), 'not_required');
  assert.equal(await requestMotionPermission({ env: {} }), 'unsupported');
  assert.deepEqual(motionReasonCodes(), [RC.NO_GRAVITY_REF]);

  const target = new EventTarget();
  const env2 = { addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target), screen: { orientation: { angle: 90 } } };
  const out = [];
  const stop = startGravity((s) => out.push(s), { env: env2, span_s: 0.5, tol_deg: 0.1 });
  const pitch = 3 * Math.PI / 180, roll = -1 * Math.PI / 180;
  const a = accelFromPose(pitch, roll, 'landscape_ccw');
  for (let i = 0; i < 120; i++) {
    const ev = new Event('devicemotion');
    ev.accelerationIncludingGravity = { x: a[0], y: a[1], z: a[2] };
    Object.defineProperty(ev, 'timeStamp', { value: i * 16.7 });
    target.dispatchEvent(ev);
  }
  stop();
  const ev = new Event('devicemotion');
  ev.accelerationIncludingGravity = { x: 0, y: 0, z: 9.8 };
  target.dispatchEvent(ev);
  assert.equal(out.length, 120, 'no samples after stop');
  const last = out.at(-1);
  assert.equal(last.orientation, 'landscape_ccw');
  assert.ok(Math.abs(last.pitch_deg - 3) < 0.01 && Math.abs(last.roll_deg + 1) < 0.01, JSON.stringify(last));
  assert.equal(last.stable, true);
  assert.deepEqual(motionReasonCodes(), []);
  assert.equal(getMotionState().available, true);
});

test('R6: a segment never exceeds maxSegmentMs: the recorder rolls it over itself unless held during a swing', async () => {
  const made = [];
  class MR {
    constructor() { this.state = 'inactive'; made.push(this); }
    static isTypeSupported(t) { return t === 'video/mp4'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; setTimeout(() => { this.ondataavailable?.({ data: new Blob([new Uint8Array(3)]) }); this.onstop?.(); }, 0); }
  }
  let wall = 0;
  const timers = [];
  const env = { MediaRecorder: MR, Blob, setTimeout: (fn, ms) => { timers.push({ fn, at: wall + ms }); return timers.length; }, clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; } };
  const advance = (ms) => { wall += ms; for (const t of timers) if (t.fn && t.at <= wall) { const f = t.fn; t.fn = null; f(); } };
  const rec = createSegmentRecorder({}, { env, now: () => wall, maxSegmentMs: 12000 });
  rec.start();
  advance(11000);
  assert.equal(made.length, 1);
  advance(1500);
  assert.equal(made.length, 2, 'rolled over at 12 s');
  assert.equal(rec.stats().auto_rolls, 1);
  rec.hold(true);
  advance(13000);
  assert.equal(made.length, 2, 'held: no roll during a swing');
  rec.hold(false);
  advance(300);
  assert.equal(made.length, 3, 'rolled right after the hold');
  const b = await rec.cut();
  assert.ok(b.size >= 0);
  const s = rec.stats();
  assert.equal(s.segments, 3);
  assert.ok(s.max_s >= 12 && s.max_s <= 13.4, JSON.stringify(s));
  await rec.stop();
});
