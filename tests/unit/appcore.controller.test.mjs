// Session controller (P2 ordering, P16, P17, P18, persistence) with mocked navigator / DeviceMotion / AudioContext.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStore, initialState } from '../../app/src/state.js';
import { createSessionController } from '../../app/src/session/controller.js';
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
  assert.match(store2.get().status, /高速模式/);
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
