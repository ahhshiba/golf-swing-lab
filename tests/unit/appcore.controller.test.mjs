// Session controller (P2 ordering, P16, P17, P18, persistence) with mocked navigator / DeviceMotion / AudioContext.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStore, initialState } from '../../app/src/state.js';
import { createSessionController, classifyCameraError, CAMERA_OPTS } from '../../app/src/session/controller.js';
import { openRepository } from '../../app/src/store/core.js';
import { MemBackend } from '../../app/src/store/mem.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { validateShot } from '../../app/src/contract/validate.js';
import { DEFAULT_VENUE } from '../../app/src/calib/mat.js';

const FIXTURE = new URL('../fixtures/shots/valid_face_on_240.json', import.meta.url);

function track(kind, calls) {
  const listeners = {};
  return {
    kind, readyState: 'live',
    stop() { this.readyState = 'ended'; calls.push(`stop:${kind}`); },
    getSettings: () => (kind === 'video' ? { width: 1920, height: 1080, frameRate: 60 } : {}),
    addEventListener(t, fn) { (listeners[t] ??= []).push(fn); },
    removeEventListener(t, fn) { listeners[t] = (listeners[t] ?? []).filter((f) => f !== fn); },
    fire(t) { for (const fn of listeners[t] ?? []) fn(); },
  };
}

function makeEnv({ motion = 'granted', audio = true, camera = true } = {}) {
  const calls = [];
  const vt = { v: null };
  const doc = { visibilityState: 'visible', listeners: {}, addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }, removeEventListener() {} };
  const env = {
    document: doc,
    DeviceMotionEvent: { requestPermission() { calls.push('requestPermission'); return Promise.resolve(motion); } },
    AudioContext: class { constructor() { calls.push('new AudioContext'); this.state = 'suspended'; } resume() { calls.push('resume'); this.state = 'running'; return Promise.resolve(); } close() { calls.push('audio.close'); return Promise.resolve(); } },
    navigator: {
      mediaDevices: {
        getUserMedia(c) {
          calls.push('getUserMedia');
          if (!camera) return Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
          const v = track('video', calls);
          vt.v = v;
          const tracks = audio && c.audio ? [v, track('audio', calls)] : [v];
          return Promise.resolve({ getTracks: () => tracks, getVideoTracks: () => tracks.filter((t) => t.kind === 'video'), getAudioTracks: () => tracks.filter((t) => t.kind === 'audio') });
        },
      },
      wakeLock: { request(type) { calls.push(`wakeLock:${type}`); return Promise.resolve({ released: false, release() { calls.push('wake.release'); return Promise.resolve(); } }); } },
      storage: { estimate: () => Promise.resolve({ usage: 1e8, quota: 5e9 }) },
    },
    now: (() => { let t = 100; return () => (t += 1); })(),
  };
  return { env, calls, vt, doc };
}

const venue = { venue_id: 'venue-t', name: 't', ...DEFAULT_VENUE, f_locked: null };

test('startPractice invokes motion permission, getUserMedia, AudioContext.resume and Wake Lock synchronously, in that order', async () => {
  const { env, calls } = makeEnv();
  const store = createStore(initialState());
  const rec = [];
  const ctl = createSessionController({ store, env, record: (p, v) => rec.push([p, v]) });
  const p = ctl.startPractice({ venue, view: 'face_on', mode: 'live' });
  // nothing has been awaited yet: all four user-activation calls already happened, in this order
  assert.deepEqual(calls, ['requestPermission', 'getUserMedia', 'new AudioContext', 'resume', 'wakeLock:screen']);
  assert.ok(p instanceof Promise);
  assert.equal(store.get().sessionActive, true);
  const r = await p;
  assert.equal(r.ok, true);
  assert.deepEqual(r.permissions, { motion: 'granted', camera: 'granted', microphone: 'granted', audio: 'running', wakeLock: 'granted' });
  assert.equal(r.session.gum_calls, 1);
  assert.deepEqual(r.session.warnings, []);
  assert.ok(rec.some(([k, v]) => k === 'gum.calls' && v === 1));
  assert.ok(rec.some(([k, v]) => k === 'motion.same_click' && v === true));
  assert.equal(calls.filter((c) => c === 'getUserMedia').length, 1);
});

test('with the media modules loaded the order is the same: requestMotionPermission before openCamera', async () => {
  const calls = [];
  const { env } = makeEnv();
  const deps = {
    gravity: { requestMotionPermission() { calls.push('requestMotionPermission'); return Promise.resolve('not_required'); } },
    camera: {
      openCamera(o) { calls.push(`openCamera:${o.audio}:${o.frameRate}`); return Promise.resolve({ stream: { getTracks: () => [] }, videoTrack: { readyState: 'live' }, audioTrack: null, settings: { frameRate: 30 }, audio_unavailable: true }); },
      getGumCalls: () => 1,
      onTrackEnded: () => () => {},
    },
  };
  env.AudioContext = class { constructor() { calls.push('AudioContext'); } resume() { calls.push('resume'); return Promise.resolve(); } };
  env.navigator.wakeLock.request = () => { calls.push('wakeLock'); return Promise.reject(new Error('no')); };
  const store = createStore(initialState());
  const ctl = createSessionController({ store, env, deps });
  const p = ctl.startPractice({ venue });
  assert.deepEqual(calls, ['requestMotionPermission', 'openCamera:true:60', 'AudioContext', 'resume', 'wakeLock']);
  const r = await p;
  assert.equal(r.permissions.motion, 'granted'); // not_required counts as available
  assert.equal(r.permissions.wakeLock, 'unavailable');
  assert.deepEqual(r.session.warnings, [RC.AUDIO_UNAVAILABLE]);
});

test('denied permissions degrade honestly (P17): NO_GRAVITY_REF, AUDIO_UNAVAILABLE, camera-less session', async () => {
  const { env } = makeEnv({ motion: 'denied', audio: false });
  const store = createStore(initialState());
  const ctl = createSessionController({ store, env });
  const r = await ctl.startPractice({ venue });
  assert.equal(r.permissions.motion, 'denied');
  assert.ok(ctl.warnings().includes(RC.NO_GRAVITY_REF));
  assert.ok(ctl.warnings().includes(RC.AUDIO_UNAVAILABLE));
  const { env: env2 } = makeEnv({ camera: false });
  const store2 = createStore(initialState());
  const r2 = await createSessionController({ store: store2, env: env2 }).startPractice({ venue });
  assert.equal(r2.ok, false);
  assert.equal(store2.get().permissions.camera, 'denied');
  assert.deepEqual(store2.get().status, { code: 'session.status.camera_unavailable', params: { reason: 'denied' } });
  assert.deepEqual(r2.error, { code: 'CAMERA_DENIED' });
  assert.deepEqual(store2.get().cameraError, { code: 'CAMERA_DENIED' });
});

test('a startPractice whose APIs throw synchronously still invokes the remaining ones', async () => {
  const { env, calls } = makeEnv();
  env.DeviceMotionEvent = { requestPermission() { calls.push('requestPermission'); throw new Error('boom'); } };
  const ctl = createSessionController({ store: createStore(initialState()), env });
  const p = ctl.startPractice({ venue });
  assert.deepEqual(calls.slice(0, 2), ['requestPermission', 'getUserMedia']);
  const r = await p;
  assert.equal(r.permissions.motion, 'denied');
  assert.equal(r.ok, true);
});

test('track ended → interruption prompt; reopenCamera counts a second getUserMedia (P17)', async () => {
  const { env, calls, vt } = makeEnv();
  const store = createStore(initialState());
  const rec = {};
  const ctl = createSessionController({ store, env, record: (p, v) => { rec[p] = v; } });
  await ctl.startPractice({ venue });
  vt.v.fire('ended');
  assert.equal(store.get().cameraInterrupted, true);
  const ok = await ctl.reopenCamera();
  assert.equal(ok, true);
  assert.equal(store.get().cameraInterrupted, false);
  assert.equal(calls.filter((c) => c === 'getUserMedia').length, 2);
  assert.equal(rec['gum.calls'], 2);
});

test('angle change keeps the stream and restarts the setup timer (P16)', async () => {
  const { env, calls } = makeEnv();
  const store = createStore(initialState());
  const ctl = createSessionController({ store, env });
  await ctl.startPractice({ venue, view: 'face_on' });
  ctl.changeAngle('dtl', null);
  assert.equal(store.get().view, 'dtl');
  assert.equal(store.get().session.view, 'dtl');
  assert.equal(ctl.setupTimer.events().length, 1);
  assert.equal(calls.filter((c) => c === 'getUserMedia').length, 1);
});

test('thermal guard (P18): p95 latency > 12 s degrades full→lite once, then suggests stopping live mode', async () => {
  const { env } = makeEnv();
  const store = createStore(initialState());
  const ctl = createSessionController({ store, env });
  await ctl.startPractice({ venue });
  let d;
  for (let i = 0; i < 5; i++) d = ctl.reportLive({ latency_s: 13, dropped_frac: 0 });
  assert.equal(d.action, 'degrade');
  assert.equal(d.model, 'lite');
  assert.equal(d.sampling, 2);
  assert.ok(ctl.warnings().includes(RC.THERMAL_DEGRADED));
  assert.equal(store.get().thermal.degraded, true);
  for (let i = 0; i < 5; i++) d = ctl.reportLive({ latency_s: 1, dropped_frac: 0.2 });
  assert.equal(d.action, 'stop_live');
});

test('lock (C9) stores a preset; a forced red light marks every saved shot SETUP_UNVERIFIED; endSession releases', async () => {
  const { env, calls } = makeEnv();
  const store = createStore(initialState());
  const repo = await openRepository(new MemBackend());
  const ctl = createSessionController({ store, env, repo });
  await ctl.startPractice({ venue, view: 'face_on', mode: 'live' });
  const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const preset = await ctl.lock({ calibration: fx.calibration, evaluation: { light: 'red', reason_codes: [RC.SETUP_UNVERIFIED] }, forced: true, venue, view: 'face_on', W: 1920, H: 1080 });
  assert.equal((await repo.presets.get(preset.preset_id)).view, 'face_on');
  assert.ok(ctl.warnings().includes(RC.SETUP_UNVERIFIED));
  const durations = ctl.setupTimer.summary();
  assert.ok(durations.steps.C2 >= 0 && durations.steps.C9 >= 0);
  const shot = { ...fx, preset_id: null, session_id: undefined, venue_id: null };
  delete shot.session_id;
  const saved = await ctl.saveShot(shot, { clipBlob: new Blob([new Uint8Array(10)], { type: 'video/mp4' }) });
  assert.ok(validateShot(saved).ok, JSON.stringify(validateShot(saved).errors));
  assert.ok(saved.quality.warnings.includes(RC.SETUP_UNVERIFIED));
  assert.ok(saved.metrics.ball_speed_mps.reason_codes.includes(RC.SETUP_UNVERIFIED));
  assert.equal(saved.metrics.ball_speed_mps.validity, 'low_confidence');
  assert.equal(saved.preset_id, preset.preset_id);
  assert.equal(saved.session_id, store.get().session.session_id);
  assert.equal((await repo.shots.get(saved.shot_id)).shot_id, saved.shot_id);
  assert.equal((await repo.clips.list({ index: 'shot_id', query: saved.shot_id })).length, 1);
  assert.equal(store.get().lastShotId, saved.shot_id);
  await ctl.endSession();
  assert.equal(store.get().sessionActive, false);
  assert.ok(calls.includes('stop:video') && calls.includes('wake.release') && calls.includes('audio.close'));
  const sess = await repo.sessions.list();
  assert.equal(sess.length, 1);
  assert.ok(sess[0].ended_at);
});

test('saveShot rejects a shot that breaks golf-shot/1 and writes nothing', async () => {
  const { env } = makeEnv();
  const store = createStore(initialState());
  const repo = await openRepository(new MemBackend());
  const ctl = createSessionController({ store, env, repo });
  const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  fx.metrics.ball_speed_mps = { ...fx.metrics.ball_speed_mps, ci95: null, sigma: null };
  await assert.rejects(ctl.saveShot(fx), /golf-shot\/1/);
  assert.equal(await repo.shots.count(), 0);
});

// ---------------------------------------------------------------- PRODUCT-SPEC §8.0.9 / R1 / R2 / R7 / R8 / PF-5

test('camera errors are classified (R8): denied / busy / missing / unsupported with error codes', async () => {
  assert.equal(classifyCameraError({ name: 'NotAllowedError' }), 'denied');
  assert.equal(classifyCameraError({ name: 'SecurityError' }), 'denied');
  assert.equal(classifyCameraError({ name: 'NotReadableError' }), 'busy');
  assert.equal(classifyCameraError({ name: 'AbortError' }), 'busy');
  assert.equal(classifyCameraError({ name: 'NotFoundError' }), 'missing');
  assert.equal(classifyCameraError({ name: 'OverconstrainedError' }), 'missing');
  assert.equal(classifyCameraError({ name: 'NotSupportedError' }), 'unsupported');
  for (const [name, kind, code] of [['NotReadableError', 'busy', 'CAMERA_BUSY'], ['NotFoundError', 'missing', 'CAMERA_MISSING']]) {
    const { env } = makeEnv();
    env.navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('x'), { name }));
    const store = createStore(initialState());
    const r = await createSessionController({ store, env }).startPractice({ venue });
    assert.equal(r.ok, false);
    assert.equal(r.permissions.camera, kind);
    assert.deepEqual(r.error, { code });
  }
  const { env } = makeEnv();
  delete env.navigator.mediaDevices;
  const r = await createSessionController({ store: createStore(initialState()), env }).startPractice({ venue });
  assert.equal(r.permissions.camera, 'unsupported');
});

test('live capture asks for 1280x720 (PF-5), never 1080p', async () => {
  assert.equal(CAMERA_OPTS.width, 1280);
  assert.equal(CAMERA_OPTS.height, 720);
  const { env } = makeEnv();
  let asked = null;
  const gum = env.navigator.mediaDevices.getUserMedia;
  env.navigator.mediaDevices.getUserMedia = (c) => { asked = c; return gum(c); };
  await createSessionController({ store: createStore(initialState()), env }).startPractice({ venue });
  assert.equal(asked.video.width.ideal, 1280);
  assert.equal(asked.video.height.ideal, 720);
});

test('requestPermissions (onboarding): motion then one getUserMedia, synchronously; tracks stopped; states reported', async () => {
  const { env, calls } = makeEnv();
  const store = createStore(initialState());
  const ctl = createSessionController({ store, env });
  const p = ctl.requestPermissions();
  assert.deepEqual(calls, ['requestPermission', 'getUserMedia']);
  assert.deepEqual(await p, { camera: 'granted', microphone: 'granted', motion: 'granted' });
  assert.ok(calls.includes('stop:video') && calls.includes('stop:audio'), 'the probe stream is released');
  const { env: denied } = makeEnv({ camera: false, motion: 'denied' });
  assert.deepEqual(await createSessionController({ store: createStore(initialState()), env: denied }).requestPermissions(), { camera: 'denied', microphone: 'denied', motion: 'denied' });
  const { env: none } = makeEnv();
  delete none.navigator.mediaDevices;
  none.DeviceMotionEvent = undefined;
  assert.deepEqual(await createSessionController({ store: createStore(initialState()), env: none }).requestPermissions(), { camera: 'unsupported', microphone: 'unsupported', motion: 'unsupported' });
});

test('R1: reopenCamera hands the new stream to every onStreamChange listener; status codes, not prose', async () => {
  const { env, vt } = makeEnv();
  const store = createStore(initialState());
  const ctl = createSessionController({ store, env });
  await ctl.startPractice({ venue });
  const got = [];
  const off = ctl.onStreamChange((s) => got.push(s));
  vt.v.fire('ended');
  assert.deepEqual(store.get().status, { code: 'session.status.camera_lost', params: {} });
  const first = vt.v;
  await ctl.reopenCamera();
  assert.equal(got.length, 1);
  assert.equal(got[0], ctl.media().stream);
  assert.notEqual(vt.v, first, 'a new track');
  assert.deepEqual(store.get().status, { code: 'session.status.camera_reopened', params: {} });
  off();
  vt.v.fire('ended');
  await ctl.reopenCamera();
  assert.equal(got.length, 1, 'unsubscribed');
});

test('R1: with camera.js deps, repeated reopens keep exactly one track-ended subscription', async () => {
  const { env } = makeEnv();
  let subs = 0;
  let cb = null;
  const deps = {
    camera: {
      openCamera() { return Promise.resolve({ stream: { getTracks: () => [] }, videoTrack: { readyState: 'live' }, audioTrack: null, settings: {} }); },
      getGumCalls: () => 1,
      onTrackEnded(fn) { subs++; cb = fn; return () => { subs--; }; },
    },
  };
  const store = createStore(initialState());
  const ctl = createSessionController({ store, env, deps });
  await ctl.startPractice({ venue });
  for (let i = 0; i < 3; i++) { cb({ kind: 'video' }); await ctl.reopenCamera(); }
  assert.equal(subs, 1);
  await ctl.endSession();
  assert.equal(subs, 0);
});

test('setClub feeds the next live job; analysisQueue relays queue events', async () => {
  const rec = {};
  const ctl = createSessionController({ store: createStore(initialState()), env: makeEnv().env, record: (p, v) => { rec[p] = v; } });
  assert.equal(ctl.club(), null);
  ctl.setClub({ type: 'driver', length_m: 1.15 });
  assert.deepEqual(ctl.club(), { type: 'driver', length_m: 1.15 });
  assert.deepEqual(rec['live.club'], { type: 'driver', length_m: 1.15 });
  const seen = [];
  const off = ctl.analysisQueue.on((e) => seen.push(e));
  ctl.analysisQueue.emit({ queued: 1, eta_s: 6 });
  ctl.analysisQueue.emit({ started: 1 });
  off();
  ctl.analysisQueue.emit({ done: 1 });
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[1], { queued: 1, started: 1, done: 0, eta_s: 6 });
  assert.deepEqual(ctl.analysisQueue.last(), { queued: 1, started: 1, done: 1, eta_s: 6 });
});

test('R7: less than the free-space limit before a clip save -> shot + pose saved, clip skipped, CLIP_NOT_SAVED, lowSpace', async () => {
  const { env } = makeEnv();
  env.navigator.storage.estimate = () => Promise.resolve({ usage: 0, quota: 4e6 });
  const store = createStore(initialState());
  const repo = await openRepository(new MemBackend());
  const ctl = createSessionController({ store, env, repo });
  const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const saved = await ctl.saveShot(fx, { clipBlob: new Blob([new Uint8Array(10)], { type: 'video/mp4' }), poseSeq: { fps: 60 } });
  assert.ok(saved.quality.warnings.includes(RC.CLIP_NOT_SAVED));
  assert.ok(validateShot(saved).ok);
  assert.equal(await repo.clips.count(), 0);
  assert.ok(await repo.poses.get(saved.shot_id));
  assert.equal(store.get().lowSpace, true);
  assert.deepEqual(store.get().lastSave, { shot_id: saved.shot_id, ok: true, clipSaved: false, poseSaved: true, reason: RC.CLIP_NOT_SAVED });
  assert.deepEqual(store.get().status, { code: 'session.status.clip_not_saved', params: {} });
  assert.equal(saved.clipSaved, false, 'outcome on the returned shot');
  assert.equal(saved.reason, RC.CLIP_NOT_SAVED);
  assert.equal('clipSaved' in saved, true);
  assert.equal(Object.keys(saved).includes('clipSaved'), false, 'non-enumerable: not part of the record');
  assert.equal(JSON.stringify(saved).includes('clipSaved'), false);
  assert.ok(validateShot(saved).ok);
});

test('R2: a QuotaExceededError while saving retries without the clip; no room at all -> QUOTA_EXCEEDED', async () => {
  const { env } = makeEnv();
  const store = createStore(initialState());
  const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const repo = await openRepository(new MemBackend({ quotaBytes: 400 * 1024 }));
  const ctl = createSessionController({ store, env, repo });
  const saved = await ctl.saveShot(fx, { clipBlob: new Blob([new Uint8Array(2 * 1024 * 1024)], { type: 'video/mp4' }) });
  assert.ok(saved.quality.warnings.includes(RC.CLIP_NOT_SAVED));
  assert.equal((await repo.shots.get(saved.shot_id)).quality.warnings.includes(RC.CLIP_NOT_SAVED), true);
  assert.equal(await repo.clips.count(), 0);
  assert.equal(store.get().lowSpace, true);
  const tiny = await openRepository(new MemBackend({ quotaBytes: 100 }));
  const ctl2 = createSessionController({ store: createStore(initialState()), env, repo: tiny });
  await assert.rejects(ctl2.saveShot(fx), (e) => e.code === 'QUOTA_EXCEEDED');
});

test('controller source has no CJK prose outside comments (status/messages are codes)', () => {
  const src = fs.readFileSync(new URL('../../app/src/session/controller.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  assert.ok(!/[一-鿿]/.test(src));
});
