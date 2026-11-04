// ui/replay.js — clip replay on a canvas with the pose skeleton overlay, frame stepping and draggable event
// markers (P6). Pure helpers (checkMonotonic, nearestIndex) are exported for tests.

import { h, clear } from './dom.js';
import { EVENTS } from '../contract/enums.js';
import { EVENT_LABELS } from './format.js';

/** BlazePose-33 skeleton edges. */
export const POSE_EDGES = Object.freeze([
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 29], [29, 31], [28, 30], [30, 32], [27, 31], [28, 32], [0, 11], [0, 12], [15, 17], [16, 18],
]);

/** Events in GolfDB order must have non-decreasing frames: { ok, message } (message in Chinese). */
export function checkMonotonic(events) {
  let prev = null;
  for (const name of EVENTS) {
    const e = events?.[name];
    if (!e || !Number.isFinite(e.frame)) continue;
    if (prev && e.frame < prev.e.frame) {
      return { ok: false, message: `事件順序不對：「${EVENT_LABELS[name]}」（第 ${e.frame} 幀）不能早於「${EVENT_LABELS[prev.name]}」（第 ${prev.e.frame} 幀）` };
    }
    prev = { name, e };
  }
  return { ok: true, message: '' };
}

/** Index of the sample closest to t in an ascending time array. */
export function nearestIndex(ts, t) {
  if (!ts || !ts.length) return -1;
  let lo = 0;
  let hi = ts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= t) lo = mid; else hi = mid;
  }
  return Math.abs(ts[lo] - t) <= Math.abs(ts[hi] - t) ? lo : hi;
}

/**
 * createReplay({ clipBlob, poseSeq, fps, events, onEventsChange(events) }) ->
 *   { el, events(), setEvents(ev), destroy(), time(), frame(), seek(t_s), setEventAt(name, t_s?) }
 * setEventAt (P14 annotation): moves event `name` to the frame under the cursor (or at t_s) as a manual event.
 */
export function createReplay({ clipBlob = null, poseSeq = null, fps = 60, events = {}, onEventsChange = () => {} }) {
  let ev = JSON.parse(JSON.stringify(events ?? {}));
  const canvas = h('canvas.replay-canvas', {});
  const video = h('video', { playsinline: true, muted: true, preload: 'auto', hidden: true });
  const label = h('span.replay-time', '');
  const bar = h('div.timeline', {});
  const url = clipBlob ? URL.createObjectURL(clipBlob) : null;
  let duration = 0;
  let tLocal = 0; // time cursor when there is no video
  if (url) video.src = url;

  const dt = 1 / (fps > 0 ? fps : 60);
  const frameOf = (t) => Math.round(t * fps);

  function draw() {
    const W = video.videoWidth || poseSeq?.W || 640;
    const H = video.videoHeight || poseSeq?.H || 360;
    if (canvas.width !== W) { canvas.width = W; canvas.height = H; canvas.style.aspectRatio = `${W} / ${H}`; }
    const g = canvas.getContext('2d');
    if (video.readyState >= 2) g.drawImage(video, 0, 0, W, H);
    else { g.fillStyle = '#111'; g.fillRect(0, 0, W, H); }
    const t = url ? (video.currentTime || 0) : tLocal;
    label.textContent = `${t.toFixed(3)} s · 第 ${frameOf(t)} 幀`;
    if (poseSeq?.img && poseSeq?.t_s) {
      const i = nearestIndex(poseSeq.t_s, t);
      if (i >= 0) {
        const o = i * 33 * 4;
        const P = (k) => [poseSeq.img[o + 4 * k] * W, poseSeq.img[o + 4 * k + 1] * H, poseSeq.img[o + 4 * k + 3]];
        g.lineWidth = Math.max(2, W / 400);
        g.strokeStyle = 'rgba(0,220,140,0.9)';
        for (const [a, b] of POSE_EDGES) {
          const pa = P(a); const pb = P(b);
          if (pa[2] < 0.3 || pb[2] < 0.3) continue;
          g.beginPath(); g.moveTo(pa[0], pa[1]); g.lineTo(pb[0], pb[1]); g.stroke();
        }
      }
    }
  }

  function renderMarkers() {
    clear(bar);
    if (!(duration > 0)) return;
    for (const name of EVENTS) {
      const e = ev[name];
      if (!e || !Number.isFinite(e.t_s)) continue;
      const m = h('button.marker', { type: 'button', title: EVENT_LABELS[name], style: { left: `${(100 * e.t_s) / duration}%` }, dataset: { event: name } }, EVENT_LABELS[name]);
      m.addEventListener('pointerdown', (pe) => {
        pe.preventDefault();
        m.setPointerCapture?.(pe.pointerId);
        const move = (me) => {
          const r = bar.getBoundingClientRect();
          const t = Math.max(0, Math.min(duration, ((me.clientX - r.left) / r.width) * duration));
          const f = frameOf(t);
          ev[name] = { ...ev[name], frame: f, t_s: f / fps, source: 'manual', conf: 1 };
          m.style.left = `${(100 * ev[name].t_s) / duration}%`;
          seek(ev[name].t_s);
        };
        const up = () => { m.removeEventListener('pointermove', move); m.removeEventListener('pointerup', up); onEventsChange(api.events()); };
        m.addEventListener('pointermove', move);
        m.addEventListener('pointerup', up);
      });
      m.addEventListener('click', () => seek(e.t_s));
      bar.append(m);
    }
  }

  function seek(t) {
    const c = Math.max(0, Math.min(duration || t, t));
    if (!url) { tLocal = c; draw(); return; }
    video.currentTime = c;
  }
  const now = () => (url ? (video.currentTime || 0) : tLocal);

  video.addEventListener('loadedmetadata', () => { duration = video.duration; renderMarkers(); draw(); });
  video.addEventListener('seeked', draw);
  video.addEventListener('loadeddata', draw);

  const el = h('div.replay', {},
    canvas, video,
    h('div.row', {},
      h('button', { type: 'button', 'aria-label': '上一幀', onclick: () => seek(now() - dt) }, '◀ 上一幀'),
      label,
      h('button', { type: 'button', 'aria-label': '下一幀', onclick: () => seek(now() + dt) }, '下一幀 ▶')),
    bar,
    url ? null : h('p.hint', '這一球沒有保存影片（可能已在儲存清理時刪除），只能修改事件數值。'));
  if (!url) {
    const ts = poseSeq?.t_s;
    const lastEv = Math.max(0, ...EVENTS.map((n) => ev[n]?.t_s).filter(Number.isFinite));
    duration = ts && ts.length ? Math.max(ts[ts.length - 1], lastEv) : lastEv;
    renderMarkers();
    draw();
  }

  const api = {
    el,
    events: () => JSON.parse(JSON.stringify(ev)),
    setEvents(e) { ev = JSON.parse(JSON.stringify(e)); renderMarkers(); },
    time: () => now(),
    frame: () => frameOf(now()),
    seek: (t) => seek(t),
    setEventAt(name, t = now()) {
      if (!EVENTS.includes(name)) throw new RangeError(`unknown event '${name}'`);
      const f = Math.max(0, frameOf(t));
      ev[name] = { ...(ev[name] ?? {}), frame: f, t_s: f / fps, source: 'manual', conf: 1 };
      if (!(duration >= ev[name].t_s)) duration = Math.max(duration || 0, ev[name].t_s);
      renderMarkers();
      onEventsChange(api.events());
      return ev[name];
    },
    destroy() { if (url) URL.revokeObjectURL(url); video.removeAttribute('src'); },
  };
  return api;
}
