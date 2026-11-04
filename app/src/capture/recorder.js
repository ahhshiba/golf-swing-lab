// capture/recorder.js - MediaRecorder segments for live mode (CAFCR P4: stop/start slicing).
//
//   RECORDER_CANDIDATES                     preference order (mp4/avc1 first, then webm)
//   pickMimeType(isTypeSupported) -> string | ''     first supported candidate ('' = browser default)
//   supportedTypes(isTypeSupported) -> string[]
//   createSegmentRecorder(stream, { mimeType?, mediaClock?, videoBitsPerSecond?, env? })
//     -> { start(), cut() -> Promise<Blob>, stop() -> Promise<Blob | null>, mimeType, recording() }
//
// cut() stops the running segment and starts the next one straight away; the returned Blob is the finished segment
// and carries `t_media_start_s` / `t_media_end_s` (from mediaClock(), e.g. () => videoEl.currentTime, the same clock
// as the frame tap) plus `mimeType`, so the live loop can map event times into segment time. A new MediaRecorder
// is created per segment, so each segment is a complete, independently decodable file.

import { diagRecord } from '../workers/diag.js';

export const RECORDER_CANDIDATES = Object.freeze([
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]);

function safeSupported(isTypeSupported, t) {
  try { return !!isTypeSupported(t); } catch { return false; }
}

export function supportedTypes(isTypeSupported) {
  if (typeof isTypeSupported !== 'function') return [];
  return RECORDER_CANDIDATES.filter((t) => safeSupported(isTypeSupported, t));
}

export function pickMimeType(isTypeSupported) {
  return supportedTypes(isTypeSupported)[0] ?? '';
}

export function createSegmentRecorder(stream, opts = {}) {
  const env = opts.env ?? globalThis;
  const MR = env.MediaRecorder;
  if (typeof MR !== 'function') throw new Error('MediaRecorder is not available');
  const isTS = typeof MR.isTypeSupported === 'function' ? (t) => MR.isTypeSupported(t) : null;
  const types = supportedTypes(isTS);
  diagRecord('media_recorder.types', types);
  const mimeType = opts.mimeType ?? pickMimeType(isTS);
  diagRecord('media_recorder.chosen', mimeType || 'default');
  const clock = typeof opts.mediaClock === 'function' ? opts.mediaClock : () => null;
  let rec = null;
  let chunks = [];
  let tStart = null;

  function begin() {
    const o = {};
    if (mimeType) o.mimeType = mimeType;
    if (opts.videoBitsPerSecond) o.videoBitsPerSecond = opts.videoBitsPerSecond;
    const r = new MR(stream, o);
    const myChunks = [];
    r.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) myChunks.push(ev.data); };
    chunks = myChunks;
    tStart = clock();
    r.start();
    rec = r;
    return r;
  }

  function finish(r, myChunks, t0) {
    return new Promise((resolve, reject) => {
      if (!r || r.state === 'inactive') { resolve(null); return; }
      r.onstop = () => {
        const type = r.mimeType || mimeType || (myChunks[0] && myChunks[0].type) || '';
        const blob = new env.Blob(myChunks, type ? { type } : undefined);
        blob.t_media_start_s = t0;
        blob.t_media_end_s = clock();
        blob.mimeType = type;
        resolve(blob);
      };
      r.onerror = (ev) => reject(ev && ev.error ? ev.error : new Error('MediaRecorder error'));
      try { r.stop(); } catch (e) { reject(e); }
    });
  }

  return {
    mimeType,
    recording: () => !!rec && rec.state === 'recording',
    start() { if (!rec || rec.state === 'inactive') begin(); },
    cut() {
      const r = rec;
      const c = chunks;
      const t0 = tStart;
      const done = finish(r, c, t0);
      begin(); // next segment starts immediately (P4)
      return done.then((b) => b ?? new env.Blob([], mimeType ? { type: mimeType } : undefined));
    },
    stop() {
      const r = rec;
      rec = null;
      return finish(r, chunks, tStart);
    },
  };
}
