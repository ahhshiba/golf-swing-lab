// capture/camera.js - the single getUserMedia of a practice session (CAFCR P2, P17; app-architecture.md section 4).
//
//   openCamera({ width = 1920, height = 1080, frameRate = 60, facingMode = 'environment', audio = true, env? })
//     -> Promise<{ stream, videoTrack, audioTrack | null, settings, audio_unavailable }>
//   closeCamera()                       stops every track of the current stream (high-speed mode gives the camera back)
//   getGumCalls() -> number             getUserMedia invocations in this page life (P2 gate: == 1)
//   onTrackEnded(cb) -> unsubscribe     cb({ kind, reason }) when a track ends (built-in camera app, call, lock screen)
//   currentStream() -> MediaStream | null
//
// getUserMedia is called synchronously inside openCamera (before any await), so openCamera keeps the user activation
// when the click handler calls it right after DeviceMotionEvent.requestPermission(). One call asks for video and
// audio together; only when that call fails with audio and the error points at the microphone (NotFound /
// NotReadable / Overconstrained on audio) a second, video-only call is made, which is counted (P17).

import { diagRecord } from '../workers/diag.js';

let gumCalls = 0;
let current = null;
const endedListeners = new Set();

export function getGumCalls() {
  return gumCalls;
}

export function currentStream() {
  return current;
}

export function onTrackEnded(cb) {
  endedListeners.add(cb);
  return () => endedListeners.delete(cb);
}

function emitEnded(kind, reason) {
  diagRecord('gum.track_ended', { kind, reason });
  for (const cb of [...endedListeners]) {
    try { cb({ kind, reason }); } catch { /* listener errors are not ours */ }
  }
}

/** Constraints object for getUserMedia (exported for tests). */
export function cameraConstraints({ width = 1920, height = 1080, frameRate = 60, facingMode = 'environment', audio = true } = {}) {
  return {
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: width },
      height: { ideal: height },
      frameRate: { ideal: frameRate },
    },
    audio: audio
      ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      : false,
  };
}

function gum(env, constraints) {
  gumCalls += 1;
  diagRecord('gum.calls', gumCalls);
  const md = env.navigator && env.navigator.mediaDevices;
  if (!md || typeof md.getUserMedia !== 'function') {
    const e = new Error('getUserMedia is not available');
    e.name = 'NotSupportedError';
    return Promise.reject(e);
  }
  return md.getUserMedia(constraints);
}

function micError(e) {
  return e && (e.name === 'NotFoundError' || e.name === 'NotReadableError' ||
    (e.name === 'OverconstrainedError' && /audio|echo|noise|gain/i.test(String(e.constraint || ''))));
}

function attach(stream) {
  current = stream;
  for (const tr of stream.getTracks()) {
    tr.addEventListener?.('ended', () => { if (current === stream) emitEnded(tr.kind, 'ended'); });
  }
}

export function openCamera(opts = {}) {
  const env = opts.env ?? globalThis;
  const constraints = cameraConstraints(opts);
  diagRecord('gum.requested_fps', constraints.video.frameRate.ideal);
  // Synchronous: getUserMedia is invoked here, before this function awaits anything.
  const first = gum(env, constraints);
  return first
    .then((stream) => ({ stream, audio_unavailable: !constraints.audio || stream.getAudioTracks().length === 0 }))
    .catch((e) => {
      if (!constraints.audio || !micError(e)) throw e;
      return gum(env, { ...constraints, audio: false }).then((stream) => ({ stream, audio_unavailable: true }));
    })
    .then(({ stream, audio_unavailable }) => {
      if (current && current !== stream) stopAll(current);
      attach(stream);
      const videoTrack = stream.getVideoTracks()[0] ?? null;
      const audioTrack = stream.getAudioTracks()[0] ?? null;
      const settings = videoTrack && typeof videoTrack.getSettings === 'function' ? videoTrack.getSettings() : {};
      diagRecord('gum.actual_fps', settings.frameRate ?? null);
      diagRecord('gum.width', settings.width ?? null);
      diagRecord('gum.height', settings.height ?? null);
      diagRecord('gum.audio', !audio_unavailable);
      return { stream, videoTrack, audioTrack, settings, audio_unavailable };
    })
    .catch((e) => {
      diagRecord('gum.error', e && e.name ? e.name : String(e));
      throw e;
    });
}

function stopAll(stream) {
  for (const tr of stream.getTracks()) {
    try { tr.stop(); } catch { /* already stopped */ }
  }
}

export function closeCamera() {
  if (!current) return;
  const s = current;
  current = null; // a deliberate stop is not an interruption: no 'ended' callback
  stopAll(s);
}

/** Test hook: forget the counter and the stream (never used by the app). */
export function _resetCameraForTests() {
  gumCalls = 0;
  current = null;
  endedListeners.clear();
}
