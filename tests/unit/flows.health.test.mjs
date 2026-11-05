// P19 calibration health (calib/checks.js additive functions, session/health.js, controller hooks): every 20 shots,
// mat size re-solved > 1 % from the venue (「可能換了墊子」, P15), brightness > 30 % vs the locked frame (background
// rebuild flag), monthly drop-test reminder (K11).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  HEALTH_LIMITS, meanLuma, shotCountCheck, matSizeFromCalibration, matSizeCheck, brightnessCheck, dropTestDue, isoToMs,
  calibHealth,
} from '../../app/src/calib/checks.js';
import { matCorners, DEFAULT_VENUE } from '../../app/src/calib/mat.js';
import { nominalCamera, project, makeCamera, center } from '../../app/src/geom/camera.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { loadHealth, noteShot, noteHealthCheck, noteDropTest } from '../../app/src/session/health.js';
import { createStore, initialState } from '../../app/src/state.js';
import { createSessionController } from '../../app/src/session/controller.js';
import { openRepository } from '../../app/src/store/core.js';
import { MemBackend } from '../../app/src/store/mem.js';

const memStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const cornersPx = (cam, venue) => matCorners(venue).map((X) => { const p = project(cam, X); return [p.u, p.v]; });

test('thresholds are the CAFCR numbers (20 shots, 1 %, 30 %, 30 days)', () => {
  assert.deepEqual({ ...HEALTH_LIMITS }, { shots_per_check: 20, mat_size_rel: 0.01, brightness_rel: 0.30, drop_test_days: 30 });
});

test('shotCountCheck: due at 20, not at 19', () => {
  assert.equal(shotCountCheck(19).due, false);
  assert.equal(shotCountCheck(20).due, true);
  assert.equal(shotCountCheck(undefined).due, false);
});

test('matSizeFromCalibration recovers the real mat from the true camera and from a scale-ambiguous solve', () => {
  for (const view of ['face_on', 'dtl', 'high_behind']) {
    const cam = nominalCamera(view);
    const real = { ...DEFAULT_VENUE, mat_L: 1.53, mat_W: 1.27 };
    const px = cornersPx(cam, real);
    const h = center(cam)[2];
    const s = matSizeFromCalibration(cam, px, h);
    assert.ok(Math.abs(s.mat_L - 1.53) < 1e-6 && Math.abs(s.mat_W - 1.27) < 1e-6, `${view}: ${JSON.stringify(s)}`);
    // a PnP that assumed a mat k× too small puts the camera k× closer: same pixels, camera centre scaled by 1/k
    const k = 1.53 / 1.5;
    const C = center(cam).map((x) => x / k);
    const R = cam.R;
    const t = [0, 1, 2].map((i) => -(R[3 * i] * C[0] + R[3 * i + 1] * C[1] + R[3 * i + 2] * C[2]));
    const scaled = makeCamera({ ...cam, R, t });
    const s2 = matSizeFromCalibration(scaled, px, h); // the preset height is the independent scale
    assert.ok(Math.abs(s2.mat_L - 1.53) < 1e-6, `${view} scaled: ${s2.mat_L}`);
    assert.equal(matSizeCheck({ mat_L: 1.5, mat_W: 1.27 }, s2).changed, true);
  }
  assert.equal(matSizeFromCalibration(null, [], 1), null);
  assert.equal(matSizeFromCalibration(nominalCamera('face_on'), [[0, 0], [1, 1], [2, 2], null], 1), null);
});

test('matSizeCheck: > 1 % → CALIB_STALE; ≤ 1 % passes; missing input is skipped', () => {
  const v = { mat_L: 1.5, mat_W: 1.25 };
  const a = matSizeCheck(v, { mat_L: 1.5 * 1.011, mat_W: 1.25 });
  assert.equal(a.changed, true);
  assert.deepEqual(a.reason_codes, [RC.CALIB_STALE]);
  assert.equal(matSizeCheck(v, { mat_L: 1.5 * 1.009, mat_W: 1.25 * 0.991 }).changed, false);
  assert.equal(matSizeCheck(v, null).skipped, true);
});

test('brightnessCheck: > 30 % either way → rebuild_background; meanLuma averages a gray image', () => {
  assert.equal(brightnessCheck(100, 131).changed, true);
  assert.equal(brightnessCheck(100, 69).rebuild_background, true);
  assert.equal(brightnessCheck(100, 129).changed, false);
  assert.equal(brightnessCheck(null, 100).skipped, true);
  const g = { W: 4, H: 2, data: Uint8Array.from([0, 0, 200, 200, 0, 0, 200, 200]) };
  assert.equal(meanLuma(g, { stride: 1 }), 100);
  assert.equal(meanLuma(g, { stride: 1, roi: { x: 2, y: 0, w: 2, h: 2 } }), 200);
  assert.ok(Number.isNaN(meanLuma(null)));
});

test('dropTestDue (K11): never → due; 29 days → not; 30 days → due; isoToMs agrees with Date.parse', () => {
  for (const s of ['2026-11-04T12:00:00.000Z', '2026-02-28T23:59:59Z', '2024-02-29T00:00:00+08:00', '1999-12-31T18:30:00-05:30', '2026-11-04']) {
    assert.equal(isoToMs(s), Date.parse(s), s);
  }
  assert.ok(Number.isNaN(isoToMs('yesterday')));
  assert.equal(dropTestDue(null, '2026-11-04T00:00:00Z').due, true);
  assert.equal(dropTestDue('2026-10-06T00:00:00Z', '2026-11-04T00:00:00Z').due, false);
  assert.equal(dropTestDue('2026-10-05T00:00:00Z', '2026-11-04T00:00:00Z').due, true);
});

test('calibHealth: prompts are { id, level, code, params } (no prose, PRODUCT-SPEC §3.4); drop-test reminder only in high-speed mode', () => {
  const r = calibHealth({ shots_since_check: 20, venue: { mat_L: 1.5, mat_W: 1.25 }, solved_mat: { mat_L: 1.6, mat_W: 1.25 }, locked_luma: 100, current_luma: 150, last_drop_test_at: null, now: '2026-11-04T00:00:00Z', mode: 'highspeed' });
  assert.deepEqual(r.prompts.map((p) => p.id), ['health_due', 'mat_changed', 'brightness', 'drop_test']);
  assert.ok(r.prompts.every((p) => typeof p.code === 'string' && p.code.startsWith('health.prompt.') && p.params && typeof p.params === 'object'));
  assert.ok(r.prompts.every((p) => !/[一-鿿]/.test(JSON.stringify(p))));
  assert.equal(r.prompts[1].code, 'health.prompt.mat_changed');
  assert.equal(r.rebuild_background, true);
  assert.deepEqual(r.reason_codes, [RC.CALIB_STALE]);
  const live = calibHealth({ shots_since_check: 3, last_drop_test_at: null, now: '2026-11-04T00:00:00Z', mode: 'live' });
  assert.deepEqual(live.prompts, []);
});

test('session/health.js counters persist in the given storage', () => {
  const st = memStorage();
  assert.equal(loadHealth(st).shots_since_check, 0);
  for (let i = 0; i < 3; i++) noteShot(st);
  assert.equal(loadHealth(st).shots_since_check, 3);
  noteHealthCheck('2026-11-04T00:00:00Z', { locked_luma: 120 }, st);
  assert.deepEqual([loadHealth(st).shots_since_check, loadHealth(st).locked_luma], [0, 120]);
  noteDropTest('2026-11-04T01:00:00Z', st);
  assert.equal(loadHealth(st).last_drop_test_at, '2026-11-04T01:00:00Z');
  assert.equal(loadHealth({ getItem: () => '{bad json' }).shots_since_check, 0);
});

function ctlEnv(storage) {
  return {
    storage,
    document: null,
    DeviceMotionEvent: { requestPermission: () => Promise.resolve('granted') },
    AudioContext: class { constructor() { this.state = 'running'; } resume() { return Promise.resolve(); } close() { return Promise.resolve(); } },
    navigator: {
      mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => [], getVideoTracks: () => [{ kind: 'video', getSettings: () => ({}), addEventListener() {}, removeEventListener() {}, stop() {} }], getAudioTracks: () => [] }) },
      wakeLock: { request: () => Promise.resolve({ released: false, release: () => Promise.resolve() }) },
      storage: { estimate: () => Promise.resolve({ usage: 1e8, quota: 5e9 }) },
    },
    now: (() => { let t = 100; return () => (t += 1); })(),
  };
}

test('controller: lock re-solves the mat against the preset height (P15 prompt) and resets the 20-shot counter; 20 saved shots prompt a health check', async () => {
  const storage = memStorage();
  const store = createStore(initialState());
  const repo = await openRepository(new MemBackend());
  const ctl = createSessionController({ store, env: ctlEnv(storage), repo });
  const venue = { venue_id: 'venue-h', name: 'h', ...DEFAULT_VENUE, f_locked: null };
  await ctl.startPractice({ venue, view: 'face_on', mode: 'live' });
  const fx = JSON.parse(fs.readFileSync(new URL('../fixtures/shots/valid_face_on_240.json', import.meta.url), 'utf8'));
  const cam = fx.calibration.camera;
  const preset = { preset_id: 'preset-h', venue_id: venue.venue_id, view: 'face_on', pose: { ...fx.calibration.pose, h_m: center(cam)[2] } };
  // the real mat is 2 % longer than the venue record
  const corners = cornersPx(cam, { ...venue, mat_L: venue.mat_L * 1.02 });
  for (let i = 0; i < 5; i++) noteShot(storage);
  await ctl.lock({ calibration: fx.calibration, evaluation: { light: 'green', reason_codes: [] }, forced: true, venue, view: 'face_on', W: cam.W, H: cam.H, preset, corners, luma: 110 });
  assert.deepEqual(store.get().healthPrompts.map((p) => p.id), ['mat_changed']);
  assert.equal(store.get().healthPrompts[0].code, 'health.prompt.mat_changed');
  assert.equal(loadHealth(storage).shots_since_check, 0);
  assert.equal(loadHealth(storage).locked_luma, 110);
  // brightness: 40 % darker than the locked frame → warning + background rebuild flag
  const r = ctl.checkScene({ luma: 66 });
  assert.ok(r.prompts.some((p) => p.id === 'brightness'));
  assert.equal(store.get().backgroundRebuild, true);
  store.set({ healthPrompts: [] });
  for (let i = 0; i < 20; i++) {
    const shot = { ...fx, shot_id: `shot-h-${i}`, preset_id: null, venue_id: null };
    delete shot.session_id;
    await ctl.saveShot(shot);
    assert.equal(store.get().healthPrompts.some((p) => p.id === 'health_due'), i === 19, `after ${i + 1} shots`);
  }
  assert.equal(loadHealth(storage).shots_since_check, 20);
  // the same mat (no size change) gives no mat prompt
  await ctl.lock({ calibration: fx.calibration, evaluation: { light: 'green', reason_codes: [] }, forced: true, venue, view: 'face_on', W: cam.W, H: cam.H, preset, corners: cornersPx(cam, venue), luma: 110 });
  assert.deepEqual(store.get().healthPrompts.map((p) => p.id), []);
});
