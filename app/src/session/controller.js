// session/controller.js — the practice-session controller (CAFCR P2, P3, P4/P5 hand-off, P16, P17, P18;
// docs/app-architecture.md §3).
//
//   createSessionController({ store, repo, env, deps, record, appVersion }) -> controller
//     env   = { navigator, document, DeviceMotionEvent, AudioContext, now() /* s, monotonic */ }  (defaults: globals)
//     deps  = media modules already loaded at boot (any may be null):
//             { camera, gravity, onset, recorder, frametap, livePipeline, clipPipeline }
//     record(path, value)  diag recorder (diag/record.js), optional
//
//   controller.startPractice({ venue, preset, view, mode, preEvents? }) -> Promise<{ ok, permissions, session }>
//     MUST be called synchronously from the click handler of 「開始練習」. Everything that needs the user
//     activation is *invoked* before the first await, in this order (P2):
//       1. DeviceMotionEvent.requestPermission?.()   (first call of all)
//       2. capture.openCamera()                       (one getUserMedia, video + audio)
//       3. new AudioContext().resume()
//       4. navigator.wakeLock.request('screen')
//   controller.retryMotion()       second chance for the motion permission (own button, P17)
//   controller.reopenCamera()      after an interruption (track ended), sync from a click; counts gum_calls
//   controller.changeAngle(view)   P16: keep the stream, new preset, back to setup (timer restarts)
//   controller.lock({ calibration, evaluation, forced, corners?, luma? }) -> Promise<preset>   C9
//     (P19: also re-solves the mat size from `corners` + the preset height and resets the 20-shot health counter,
//      keeping `luma` = mean brightness of the locked frame as the reference of checkScene)
//   controller.checkScene({ luma }) -> calibHealth result   P19 brightness vs the locked frame (> 30 % → warning +
//     state.backgroundRebuild = true)
//   controller.health() -> { state, prompts }   current P19 bookkeeping and prompts (state.healthPrompts)
//   controller.releaseCamera()     high-speed mode: give the camera to the built-in camera app (C10 / P5)
//   controller.reportLive({ latency_s, dropped_frac }) -> thermal decision (P18)
//   controller.saveShot(shot, { clipBlob?, poseSeq? }) -> Promise<shot>   attributes session warnings, stores it
//   controller.endSession() -> Promise<void>
//   controller.setupTimer          calib/timer.js timer of the current angle
//   controller.media()             { stream, videoTrack, audioTrack, settings, audioCtx }
//   controller.warnings()          session-level reason codes (RC.*) attributed to every saved shot

import { RC } from '../contract/reason-codes.js';
import { addWarning, attributeWarnings } from '../contract/shot.js';
import { validateShot, formatErrors } from '../contract/validate.js';
import { makeClipRecord } from '../store/core.js';
import { createSetupTimer } from '../calib/timer.js';
import { createPreset, updatePreset } from '../calib/preset.js';
import { createThermalGuard } from './thermal.js';
import { newId, nowIso } from './ids.js';
import { estimateStorage, planCleanup } from '../store/quota.js';
import { matSizeFromCalibration } from '../calib/checks.js';
import { loadHealth, noteShot, noteHealthCheck, healthPrompts } from './health.js';

const CAMERA_OPTS = Object.freeze({ width: 1920, height: 1080, frameRate: 60, facingMode: 'environment', audio: true });

function settle(p) {
  return Promise.resolve(p).then((value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason }));
}

function errName(e) {
  return (e && (e.name || e.code)) ? String(e.name || e.code) : String(e);
}

export function createSessionController({ store, repo = null, env = {}, deps = {}, record = () => {}, appVersion = 'dev' } = {}) {
  const g = globalThis;
  const nav = env.navigator ?? g.navigator;
  const doc = env.document ?? g.document;
  const DME = 'DeviceMotionEvent' in env ? env.DeviceMotionEvent : g.DeviceMotionEvent;
  const AC = 'AudioContext' in env ? env.AudioContext : (g.AudioContext ?? g.webkitAudioContext);
  const now = env.now ?? (() => (g.performance ? g.performance.now() / 1000 : Date.now() / 1000));
  const storage = 'storage' in env ? env.storage : g.localStorage;

  let media = { stream: null, videoTrack: null, audioTrack: null, settings: null, audioCtx: null };
  let wakeLock = null;
  let gumCallsLocal = 0;
  let sessionWarnings = new Set();
  let thermal = createThermalGuard();
  let listeners = [];
  const ctl = { setupTimer: createSetupTimer() };
  const ver = () => (typeof appVersion === 'function' ? appVersion() : appVersion);

  const rec = (path, value) => { try { record(path, value); } catch (_) { /* diag is best effort */ } };
  const perms = (patch) => store.set((s) => ({ permissions: { ...s.permissions, ...patch } }));
  const gumCalls = () => (deps.camera?.getGumCalls ? deps.camera.getGumCalls() : gumCallsLocal);

  // ---- the user-activation part: everything here runs synchronously, nothing is awaited ----

  function invokeMotion() {
    try {
      if (deps.gravity?.requestMotionPermission) return deps.gravity.requestMotionPermission();
      if (DME && typeof DME.requestPermission === 'function') return DME.requestPermission();
      return DME ? 'granted' : 'unavailable'; // no permission API (Android / desktop): events just flow
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function invokeCamera() {
    try {
      if (deps.camera?.openCamera) return deps.camera.openCamera({ ...CAMERA_OPTS });
      const md = nav?.mediaDevices;
      if (!md || typeof md.getUserMedia !== 'function') return Promise.reject(new Error('NO_MEDIA_DEVICES'));
      gumCallsLocal += 1;
      return md.getUserMedia({
        video: { facingMode: CAMERA_OPTS.facingMode, width: { ideal: CAMERA_OPTS.width }, height: { ideal: CAMERA_OPTS.height }, frameRate: { ideal: CAMERA_OPTS.frameRate } },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      }).then((stream) => {
        const videoTrack = stream.getVideoTracks?.()[0] ?? null;
        const audioTrack = stream.getAudioTracks?.()[0] ?? null;
        return { stream, videoTrack, audioTrack, settings: videoTrack?.getSettings?.() ?? {} };
      });
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function invokeAudio() {
    try {
      if (!AC) return { ctx: null, p: Promise.reject(new Error('NO_AUDIO_CONTEXT')) };
      const ctx = media.audioCtx ?? new AC();
      return { ctx, p: ctx.resume ? ctx.resume() : Promise.resolve() };
    } catch (e) {
      return { ctx: null, p: Promise.reject(e) };
    }
  }

  function invokeWakeLock() {
    try {
      if (nav?.wakeLock?.request) return nav.wakeLock.request('screen');
      return Promise.reject(new Error('NO_WAKE_LOCK'));
    } catch (e) {
      return Promise.reject(e);
    }
  }

  // ---- results (after the awaits) ----

  function applyMotion(r) {
    const v = r.status === 'fulfilled' ? r.value : null;
    // sensors/gravity.js answers 'granted' | 'denied' | 'not_required' | 'unsupported'; the raw API 'granted' | 'denied'
    let state;
    if (r.status === 'rejected') state = 'denied';
    else if (v === 'granted' || v === 'not_required' || v === true || v === undefined) state = 'granted';
    else if (v === 'unsupported' || v === 'unavailable') state = 'unavailable';
    else state = 'denied';
    perms({ motion: state });
    rec('motion.permission', state);
    rec('motion.available', state !== 'unavailable');
    if (state !== 'granted') sessionWarnings.add(RC.NO_GRAVITY_REF);
    else sessionWarnings.delete(RC.NO_GRAVITY_REF);
    return state;
  }

  function applyCamera(r) {
    if (r.status === 'rejected') {
      perms({ camera: 'denied', microphone: 'unknown' });
      rec('gum.calls', gumCalls());
      rec('gum.error', errName(r.reason));
      return false;
    }
    const m = r.value ?? {};
    media = { ...media, stream: m.stream ?? null, videoTrack: m.videoTrack ?? null, audioTrack: m.audioTrack ?? null, settings: m.settings ?? {} };
    const s = media.settings ?? {};
    perms({ camera: media.videoTrack ? 'granted' : 'denied', microphone: media.audioTrack ? 'granted' : 'denied' });
    if (!media.audioTrack || m.audio_unavailable) sessionWarnings.add(RC.AUDIO_UNAVAILABLE);
    rec('gum.calls', gumCalls());
    rec('gum.requested_fps', CAMERA_OPTS.frameRate);
    rec('gum.actual_fps', Number.isFinite(s.frameRate) ? s.frameRate : null);
    rec('gum.width', Number.isFinite(s.width) ? s.width : null);
    rec('gum.height', Number.isFinite(s.height) ? s.height : null);
    watchTracks();
    return Boolean(media.videoTrack);
  }

  function applyAudio(r) {
    const state = r.status === 'fulfilled' ? (media.audioCtx?.state ?? 'running') : 'failed';
    rec('audio.context', state);
    if (state !== 'running') sessionWarnings.add(RC.AUDIO_UNAVAILABLE);
    return state;
  }

  function applyWake(r) {
    wakeLock = r.status === 'fulfilled' ? r.value : null;
    const state = wakeLock ? 'granted' : 'unavailable';
    perms({ wakeLock: state });
    rec('wake_lock', state);
    return state;
  }

  // ---- P17 interruptions ----

  function onTrackEnded() {
    if (!store.get().sessionActive) return;
    store.set({ cameraInterrupted: true, status: '相機已中斷（切到其他 App、來電或鎖屏）。點「重新開啟相機」繼續。' });
    rec('interruptions.track_ended', true);
  }

  function onVisibility() {
    if (!doc) return;
    if (doc.visibilityState === 'visible') {
      if (store.get().sessionActive && media.videoTrack && media.videoTrack.readyState === 'ended') onTrackEnded();
      // the wake lock is released when the page is hidden; take it again
      if (store.get().sessionActive && wakeLock && wakeLock.released) {
        settle(invokeWakeLock()).then(applyWake);
      }
    }
  }

  function watchTracks() {
    if (deps.camera?.onTrackEnded) {
      const off = deps.camera.onTrackEnded((info) => { if (!info || info.kind !== 'audio') onTrackEnded(); });
      if (typeof off === 'function') listeners.push(off);
      return;
    }
    const t = media.videoTrack;
    if (t && typeof t.addEventListener === 'function') {
      t.addEventListener('ended', onTrackEnded);
      listeners.push(() => t.removeEventListener('ended', onTrackEnded));
    }
  }

  function watchDocument() {
    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('visibilitychange', onVisibility);
      listeners.push(() => doc.removeEventListener('visibilitychange', onVisibility));
    }
  }

  // ---- P18 storage guard: below 500 MB free, stop keeping raw clips ----
  async function checkSpace() {
    try {
      const est = await estimateStorage(nav);
      const plan = planCleanup({ usage: est.usage, quota: est.quota, clips: [], practiceActive: true });
      if (plan.lowSpace) {
        store.set({ lowSpace: true, status: '儲存空間不足 500MB：這次練習不保存原始影片（數據照常保存）。' });
        rec('storage.low_space', true);
      } else store.set({ lowSpace: false });
    } catch (_) { /* unknown: keep recording */ }
  }

  // ---- public API ----

  ctl.startPractice = function startPractice({ venue = null, preset = null, view = 'face_on', mode = 'live', preEvents = [] } = {}) {
    // P2: synchronous invocation in this exact order (no await before all four have been called)
    const motionP = invokeMotion();
    const cameraP = invokeCamera();
    const audio = invokeAudio();
    media.audioCtx = audio.ctx;
    const wakeP = invokeWakeLock();
    rec('motion.same_click', true);
    const t0 = now();
    ctl.setupTimer = createSetupTimer();
    // C0/C1 happen before the app is opened; the home screen can time them (preEvents: start, C0, C1)
    const pre = preEvents.filter((e) => Number.isFinite(e?.t_s) && e.t_s <= t0);
    if (pre.length && pre[0].step === 'start') for (const e of pre) ctl.setupTimer.record(e.step, e.t_s);
    else ctl.setupTimer.record('start', t0);
    sessionWarnings = new Set();
    thermal = createThermalGuard();
    const session = {
      session_id: newId('sess'), venue_id: venue?.venue_id ?? null, preset_id: preset?.preset_id ?? null,
      view, mode, created_at: nowIso(), app_version: ver(),
    };
    store.set({ sessionActive: true, session, view, status: '正在取得權限…', cameraInterrupted: false, touches: 0 });
    watchDocument();
    return (async () => {
      const [m, c, a, w] = await Promise.all([settle(motionP), settle(cameraP), settle(audio.p), settle(wakeP)]);
      const motion = applyMotion(m);
      const cameraOk = applyCamera(c);
      const audioState = applyAudio(a);
      const wake = applyWake(w);
      ctl.setupTimer.record('C2', Math.max(t0, now()));
      const permissions = { motion, camera: cameraOk ? 'granted' : 'denied', microphone: media.audioTrack ? 'granted' : 'denied', audio: audioState, wakeLock: wake };
      const fullSession = { ...session, permissions, gum_calls: gumCalls(), warnings: [...sessionWarnings] };
      store.set({ session: fullSession, status: cameraOk ? '權限已取得，開始架設。' : '無法使用相機：只能用高速模式（匯入影片）。' });
      await checkSpace();
      if (repo) { try { await repo.sessions.put(fullSession); } catch (e) { rec('store.error', errName(e)); } }
      return { ok: cameraOk, permissions, session: fullSession };
    })();
  };

  ctl.retryMotion = function retryMotion() {
    const p = deps.gravity?.requestMotionPermission ? deps.gravity.requestMotionPermission({ retry: true }) : invokeMotion();
    return settle(p).then(applyMotion);
  };

  ctl.reopenCamera = function reopenCamera() {
    const p = invokeCamera(); // sync from the click (user activation)
    return settle(p).then((r) => {
      const ok = applyCamera(r);
      rec('interruptions.reopened', gumCalls());
      store.set({ cameraInterrupted: !ok, status: ok ? '相機已重新開啟。' : '相機仍無法使用。' });
      return ok;
    });
  };

  ctl.changeAngle = function changeAngle(view, preset = null) {
    const s = store.get();
    if (!s.sessionActive) throw new Error('changeAngle: no session');
    ctl.setupTimer = createSetupTimer();
    ctl.setupTimer.record('start', now());
    store.set({ view, session: { ...s.session, view, preset_id: preset?.preset_id ?? null }, presetId: preset?.preset_id ?? null });
    rec('setup.view', view);
  };

  // ---- P19 calibration health: prompts are kept in state.healthPrompts (main.js shows them) ----
  let lastHealth = { prompts: [] };
  function publishHealth(r) {
    lastHealth = r;
    const patch = { healthPrompts: r.prompts };
    if (r.rebuild_background) patch.backgroundRebuild = true;
    store.set(patch);
    rec('calib_health.prompts', r.prompts.map((p) => p.id));
    if (r.rebuild_background) rec('calib_health.background_rebuild', true);
    return r;
  }
  const healthCtx = () => {
    const s = store.get();
    return { venue: ctl.venue ?? null, mode: s.session?.mode ?? 'live', now: nowIso() };
  };
  ctl.health = () => ({ state: loadHealth(storage), prompts: lastHealth.prompts });
  ctl.checkScene = function checkScene({ luma } = {}) {
    const c = healthCtx();
    const r = healthPrompts({ state: loadHealth(storage), venue: c.venue, current_luma: luma, now: c.now, mode: c.mode });
    return publishHealth(r);
  };

  ctl.lock = async function lock({ calibration, evaluation = null, forced = false, venue, view, W, H, preset = null, corners = null, luma = undefined }) {
    const s = store.get();
    ctl.setupTimer.record('C9', Math.max(now(), ctl.setupTimer.events().at(-1)?.t_s ?? 0));
    const summary = ctl.setupTimer.summary();
    rec('setup.durations_s', summary.steps);
    rec('setup.total_s', summary.total_s);
    rec('setup.view', view);
    rec('calibration', calibration);
    if (forced || evaluation?.light === 'red') sessionWarnings.add(RC.SETUP_UNVERIFIED);
    else sessionWarnings.delete(RC.SETUP_UNVERIFIED);
    for (const code of evaluation?.reason_codes ?? []) {
      if (code === RC.NO_GRAVITY_REF || code === RC.TRACK_MAY_BE_SHORT) sessionWarnings.add(code);
    }
    const at = nowIso();
    let p;
    if (preset && preset.view === view && preset.venue_id === venue?.venue_id) {
      p = forced ? preset : updatePreset(preset, { pose: calibration.pose, f_locked: preset.f_locked ?? venue?.f_locked ?? null, W, H }, at);
    } else {
      p = createPreset({ venue_id: venue?.venue_id ?? 'unknown', view, calibration, f_locked: venue?.f_locked ?? null, W, H, created_at: at });
    }
    if (repo && !(forced && preset)) await repo.presets.put(p);
    const session = { ...s.session, preset_id: p.preset_id, view, calibration, warnings: [...sessionWarnings], locked_at: at };
    if (repo) { try { await repo.sessions.put(session); } catch (e) { rec('store.error', errName(e)); } }
    store.set({ session, presetId: p.preset_id, view });
    // P19 / P15: re-solve the mat size against the preset height (same view only); reset the 20-shot counter
    ctl.venue = venue ?? null;
    let solved = null;
    try {
      if (preset?.pose && preset.view === view && Number.isFinite(preset.pose.h_m)) solved = matSizeFromCalibration(calibration?.camera, corners, preset.pose.h_m);
    } catch (_) { solved = null; }
    const prev = loadHealth(storage);
    const hs = noteHealthCheck(at, { locked_luma: Number.isFinite(luma) ? luma : prev.locked_luma }, storage);
    const r = healthPrompts({ state: hs, venue, solved_mat: solved, current_luma: luma, now: at, mode: session.mode });
    // the locked frame is the new brightness reference: a lock never warns about brightness against itself
    r.prompts = r.prompts.filter((x) => x.id !== 'brightness');
    r.rebuild_background = false;
    if (solved) rec('calib_health.solved_mat', solved);
    publishHealth(r);
    return p;
  };

  ctl.releaseCamera = function releaseCamera() {
    if (deps.camera?.closeCamera) { try { deps.camera.closeCamera(); } catch (_) { /* ignore */ } }
    for (const t of media.stream?.getTracks?.() ?? []) { try { t.stop(); } catch (_) { /* ignore */ } }
    media = { ...media, stream: null, videoTrack: null, audioTrack: null };
    store.set({ status: '已釋放相機：請用內建相機錄慢動作，再回來「匯入影片」。' });
  };

  ctl.reportLive = function reportLive(sample) {
    const d = thermal.push(sample);
    if (d.action === 'degrade') {
      sessionWarnings.add(RC.THERMAL_DEGRADED);
      store.set({ thermal: { degraded: true, model: d.model, sampling: d.sampling }, status: '手機發熱或太慢：已改用 lite 模型、抽幀加倍。' });
      rec('thermal.degraded', true);
    } else if (d.action === 'stop_live') {
      store.set({ status: '即時模式仍然太慢：建議停止即時模式，改用高速模式（錄影後匯入）。' });
      rec('thermal.stop_live', true);
    }
    if (Number.isFinite(d.p95_s)) rec('live.latency_p95_s', d.p95_s);
    if (Number.isFinite(d.dropped_frac)) rec('live.frames_dropped_pct', 100 * d.dropped_frac);
    return d;
  };

  ctl.warnings = () => [...sessionWarnings];

  ctl.saveShot = async function saveShot(shotIn, { clipBlob = null, poseSeq = null, mime = null } = {}) {
    const s = store.get();
    let shot = { ...shotIn };
    if (s.session) {
      shot.session_id = shot.session_id ?? s.session.session_id;
      shot.venue_id = shot.venue_id ?? s.session.venue_id ?? null;
      shot.preset_id = shot.preset_id ?? s.session.preset_id ?? null;
    }
    if (shot.quality && Array.isArray(shot.quality.warnings)) {
      for (const code of sessionWarnings) shot = addWarning(shot, code);
      shot = attributeWarnings(shot);
    }
    const v = validateShot(shot);
    if (!v.ok) {
      rec('store.invalid_shot', formatErrors(v.errors));
      throw new Error(`結果不符合 golf-shot/1：${formatErrors(v.errors)}`);
    }
    if (!repo) return shot;
    const ops = [{ op: 'put', store: 'shots', record: shot }];
    if (poseSeq) ops.push({ op: 'put', store: 'poses', record: { shot_id: shot.shot_id, session_id: shot.session_id, created_at: shot.created_at, ...poseSeq } });
    if (clipBlob && !s.lowSpace) {
      const clip = makeClipRecord({ clip_id: shot.capture?.clip_ref ?? newId('clip'), shot_id: shot.shot_id, session_id: shot.session_id, created_at: shot.created_at, blob: clipBlob, mime: mime ?? clipBlob.type ?? 'video/mp4' });
      ops.push({ op: 'put', store: 'clips', record: clip });
    }
    await repo.batch(ops);
    store.set({ lastShotId: shot.shot_id });
    // P19: every 20 shots → health-check prompt
    const hs = noteShot(storage);
    if (hs.shots_since_check >= 20) {
      const c = healthCtx();
      publishHealth(healthPrompts({ state: hs, venue: c.venue, now: c.now, mode: c.mode }));
    }
    return shot;
  };

  ctl.media = () => ({ ...media });

  ctl.endSession = async function endSession() {
    for (const off of listeners) { try { off(); } catch (_) { /* ignore */ } }
    listeners = [];
    ctl.releaseCamera();
    try { await wakeLock?.release?.(); } catch (_) { /* ignore */ }
    wakeLock = null;
    try { await media.audioCtx?.close?.(); } catch (_) { /* ignore */ }
    media = { stream: null, videoTrack: null, audioTrack: null, settings: null, audioCtx: null };
    const s = store.get();
    if (repo && s.session) { try { await repo.sessions.put({ ...s.session, ended_at: nowIso() }); } catch (_) { /* ignore */ } }
    store.set({ sessionActive: false, session: null, status: '練習結束。', cameraInterrupted: false });
  };

  return ctl;
}
