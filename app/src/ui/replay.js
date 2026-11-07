// ui/replay.js — clip replay with the pose skeleton overlay, frame stepping and the event timeline (package C;
// PRODUCT-SPEC §2.3 Results › 5, V03 / A11Y-2 / UX-09 / A11Y-6). Pure helpers are exported for tests.
//
//   POSE_EDGES                      BlazePose-33 skeleton edges
//   checkMonotonic(events) -> { ok, code, params, message }   code 'replay.error.order' { event, before, f, fb };
//                                   message = t(code, …) for display (rendered at call time)
//   nearestIndex(ts, t)             index of the sample closest to t in an ascending array
//   assignLanes(xs, { width, size, gap }) -> [{ x, left, lane }]   markers of `size` px centred on xs (px) never overlap:
//                                   each goes to the lowest lane whose previous marker ends ≥ gap before it
//   clampFrame(f, maxFrame)         integer frame in [0, maxFrame]
//
//   createReplay({ clipBlob, poseSeq, fps, events, detected, onEventsChange(events, { dirty }), editable = true,
//                  showControls = true, onDraw(g, { W, H, t }) }) ->   (onDraw: an overlay after each frame, V04 §E.1)
//     { el, events(), setEvents(ev), destroy(), time(), frame(), seek(t_s), seekFrame(f), setEventAt(name, t_s?),
//       duration(), redraw(),
//       select(name), selected(), undo(), canUndo(), resetEvent(name?), dirty(), markSaved(), hasMedia() }
//   Timeline: 12 px dots (lane-assigned, no text on the track) with a 44 px hit box, role=slider (arrow ±1 frame,
//   Shift+arrow ±10, Home/End), the selected event's name in one chip above, an event ChipRow below, big ◀ ▶ frame
//   buttons, 設為這一幀 (event-set-frame), 重設為偵測值, 復原 (event-undo). Dragging a dot still works.
import { h, clear } from './dom.js';
import * as C from './components.js';
import { EVENTS } from '../contract/enums.js';
import { t, fmtNum } from '../i18n/index.js';

/** BlazePose-33 skeleton edges. */
export const POSE_EDGES = Object.freeze([
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 29], [29, 31], [28, 30], [30, 32], [27, 31], [28, 32], [0, 11], [0, 12], [15, 17], [16, 18],
]);

const MARKER = 44; // hit box (px); the visible dot is 12 px
const LANE_GAP = 4;

/** Events in swing order must have non-decreasing frames. */
export function checkMonotonic(events) {
  let prev = null;
  for (const name of EVENTS) {
    const e = events?.[name];
    if (!e || !Number.isFinite(e.frame)) continue;
    if (prev && e.frame < prev.e.frame) {
      const params = { event: name, before: prev.name, f: e.frame, fb: prev.e.frame };
      const code = 'replay.error.order';
      return { ok: false, code, params, get message() { return t(code, { ...params, event: t(`event.${name}`), before: t(`event.${prev.name}`) }); } };
    }
    prev = { name, e };
  }
  return { ok: true, code: null, params: {}, message: '' };
}

/** Index of the sample closest to t in an ascending time array. */
export function nearestIndex(ts, t0) {
  if (!ts || !ts.length) return -1;
  let lo = 0;
  let hi = ts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= t0) lo = mid; else hi = mid;
  }
  return Math.abs(ts[lo] - t0) <= Math.abs(ts[hi] - t0) ? lo : hi;
}

/** Lane assignment for markers of `size` px centred at xs (px) on a track `width` px wide. Input order is kept. */
export function assignLanes(xs, { width, size = MARKER, gap = LANE_GAP } = {}) {
  const W = Math.max(size, Number(width) || size);
  const items = xs.map((x, i) => ({ i, x, left: Math.max(0, Math.min(W - size, x - size / 2)) }));
  const order = [...items].sort((a, b) => a.left - b.left || a.i - b.i);
  const laneEnd = []; // right edge of the last marker in each lane
  for (const it of order) {
    let lane = laneEnd.findIndex((end) => it.left >= end + gap);
    if (lane < 0) { lane = laneEnd.length; laneEnd.push(0); }
    laneEnd[lane] = it.left + size;
    it.lane = lane;
  }
  return items.map(({ x, left, lane }) => ({ x, left, lane }));
}

export function clampFrame(f, maxFrame) {
  const m = Number.isFinite(maxFrame) && maxFrame >= 0 ? Math.floor(maxFrame) : Infinity;
  return Math.max(0, Math.min(m, Math.round(Number(f) || 0)));
}

const copy = (o) => JSON.parse(JSON.stringify(o ?? {}));
const css = (el, name, fallback) => {
  try { const v = getComputedStyle(el).getPropertyValue(name).trim(); return v || fallback; } catch (_) { return fallback; }
};

export function createReplay({ clipBlob = null, poseSeq = null, fps = 60, events = {}, detected = null, onEventsChange = () => {}, editable = true, showControls = true, onDraw = null } = {}) {
  const FPS = fps > 0 ? fps : 60;
  let ev = copy(events);
  const original = copy(detected ?? events);
  let saved = JSON.stringify(ev);
  const undoStack = [];
  let sel = EVENTS.find((n) => ev[n]) ?? EVENTS[0];
  const url = clipBlob ? URL.createObjectURL(clipBlob) : null;
  const hasPose = Boolean(poseSeq?.img && poseSeq?.t_s && poseSeq.t_s.length);
  const media = Boolean(url || hasPose);
  let duration = 0;
  let tLocal = 0;

  const frameOf = (s) => Math.round(s * FPS);
  const maxFrame = () => (duration > 0 ? Math.round(duration * FPS) : Infinity);

  // ------------------------------------------------------------------ stage
  const canvas = h('canvas.replay-canvas', { role: 'img' });
  const video = h('video', { playsinline: true, muted: true, preload: 'auto', hidden: true });
  if (url) video.src = url;
  const stage = media
    ? h('div.replay-stage', {}, canvas, video)
    : C.emptyState({ icon: 'film-off', title: t('replay.no_clip.title'), body: t('replay.no_clip.body'), testid: 'replay-empty' });
  if (!media) stage.classList.add('replay-empty');

  const timeEl = h('p.replay-time', { 'aria-live': 'off' });

  function draw() {
    if (!media) return;
    const W = video.videoWidth || poseSeq?.W || 640;
    const H = video.videoHeight || poseSeq?.H || 360;
    if (canvas.width !== W) { canvas.width = W; canvas.height = H; canvas.style.aspectRatio = `${W} / ${H}`; }
    const g = canvas.getContext('2d');
    if (!g) return;
    if (url && video.readyState >= 2) g.drawImage(video, 0, 0, W, H);
    else {
      g.fillStyle = css(canvas, 'background-color', 'black');
      g.fillRect(0, 0, W, H);
      if (!url) { // pose-only: ground line
        g.strokeStyle = css(canvas, '--replay-ground', 'gray');
        g.lineWidth = Math.max(2, W / 300);
        g.beginPath(); g.moveTo(0, H * 0.9); g.lineTo(W, H * 0.9); g.stroke();
      }
    }
    const tt = now();
    if (hasPose) {
      const i = nearestIndex(poseSeq.t_s, tt);
      if (i >= 0) {
        const o = i * 33 * 4;
        const P = (k) => [poseSeq.img[o + 4 * k] * W, poseSeq.img[o + 4 * k + 1] * H, poseSeq.img[o + 4 * k + 3]];
        g.lineWidth = Math.max(2, W / 400);
        g.strokeStyle = css(canvas, 'color', 'lime');
        for (const [a, b] of POSE_EDGES) {
          const pa = P(a); const pb = P(b);
          if (pa[2] < 0.3 || pb[2] < 0.3) continue;
          g.beginPath(); g.moveTo(pa[0], pa[1]); g.lineTo(pb[0], pb[1]); g.stroke();
        }
      }
    }
    onDraw?.(g, { W, H, t: tt });
  }

  // ------------------------------------------------------------------ timeline
  const selChip = h('p.tl-selected', { 'aria-live': 'polite' });
  const rail = h('div.tl-rail', {});
  const cursor = h('div.tl-cursor', { 'aria-hidden': 'true' });
  const track = h('div.tl-track', {}, rail, cursor);
  const markers = new Map();
  const chips = C.chipRow({
    items: EVENTS.map((n) => [n, t(`event.${n}`)]), value: sel, label: t('replay.events.label'), testid: 'event-chips',
    onChange: (n) => { select(n); const e = ev[n]; if (e) seekFrame(e.frame); },
  });
  for (const b of chips.querySelectorAll('.chip-row-opt')) { b.setAttribute('data-testid', 'event-chip'); b.setAttribute('data-event', b.dataset.value); }

  function trackWidth() { return track.clientWidth || track.getBoundingClientRect?.().width || 320; }

  function layout() {
    const W = trackWidth();
    const names = EVENTS.filter((n) => ev[n] && Number.isFinite(ev[n].frame));
    const dur = duration > 0 ? duration : 1;
    const xs = names.map((n) => (Math.min(dur, ev[n].frame / FPS) / dur) * W);
    const lanes = assignLanes(xs, { width: W });
    let maxLane = 0;
    names.forEach((n, i) => {
      const m = markers.get(n) ?? makeMarker(n);
      const { left, lane, x } = lanes[i];
      maxLane = Math.max(maxLane, lane);
      m.el.style.left = `${left}px`;
      m.el.style.top = `${lane * (MARKER + LANE_GAP)}px`;
      m.dot.style.left = `${x - left}px`;
      m.el.style.setProperty('--stem-x', `${x - left}px`);
      m.el.hidden = false;
      const f = ev[n].frame;
      m.el.setAttribute('aria-valuenow', String(f));
      m.el.setAttribute('aria-valuemax', String(Number.isFinite(maxFrame()) ? maxFrame() : f));
      m.el.setAttribute('aria-valuetext', t('replay.marker.valuetext', { event: t(`event.${n}`), f, s: fmtNum(f / FPS, { digits: 2 }) }));
      m.el.classList.toggle('is-selected', n === sel);
      m.el.classList.toggle('is-manual', ev[n].source === 'manual');
      m.el.dataset.lane = String(lane);
      m.el.style.setProperty('--lane', String(lane));
    });
    for (const [n, m] of markers) if (!names.includes(n)) m.el.hidden = true;
    track.style.height = `${(maxLane + 1) * (MARKER + LANE_GAP)}px`;
    paintCursor();
  }

  function paintCursor() {
    const W = trackWidth();
    const dur = duration > 0 ? duration : 1;
    cursor.style.left = `${(Math.min(dur, Math.max(0, now())) / dur) * W}px`;
  }

  function makeMarker(n) {
    const dot = h('span.tl-dot', { 'aria-hidden': 'true' });
    const el = h('button.tl-marker', {
      type: 'button', role: 'slider', 'aria-label': t(`event.${n}`), 'aria-valuemin': '0', 'data-event': n, 'data-testid': 'event-marker',
      'aria-orientation': 'horizontal',
    }, dot);
    if (!editable) el.setAttribute('aria-readonly', 'true');
    el.addEventListener('click', () => { select(n); if (ev[n]) seekFrame(ev[n].frame); });
    el.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 10 : 1;
      let d = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') d = step;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') d = -step;
      else if (e.key === 'PageUp') d = 10;
      else if (e.key === 'PageDown') d = -10;
      if (d === null && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault();
      select(n);
      const cur = ev[n]?.frame ?? frameOf(now());
      let f = d === null ? (e.key === 'Home' ? 0 : maxFrame()) : cur + d;
      f = clampFrame(f, maxFrame());
      if (editable) moveEvent(n, f); else seekFrame(f);
    });
    el.addEventListener('pointerdown', (pe) => {
      if (!editable) return;
      pe.preventDefault();
      el.setPointerCapture?.(pe.pointerId);
      select(n);
      let moved = false;
      const startState = copy(ev);
      const move = (me) => {
        const r = track.getBoundingClientRect();
        const dur = duration > 0 ? duration : 1;
        const s = Math.max(0, Math.min(dur, ((me.clientX - r.left) / r.width) * dur));
        const f = clampFrame(frameOf(s), maxFrame());
        if (f === ev[n]?.frame) return;
        if (!moved) { undoStack.push(startState); moved = true; }
        ev[n] = { ...(ev[n] ?? {}), frame: f, t_s: f / FPS, source: 'manual', conf: 1 };
        layout();
        seekFrame(f);
      };
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); if (moved) changed(); };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    track.append(el);
    const m = { el, dot };
    markers.set(n, m);
    return m;
  }

  track.addEventListener('pointerdown', (pe) => {
    if (pe.target !== track && pe.target !== rail) return;
    const r = track.getBoundingClientRect();
    const dur = duration > 0 ? duration : 0;
    if (dur > 0) seek(((pe.clientX - r.left) / r.width) * dur);
  });

  // ------------------------------------------------------------------ controls
  const prev = C.button({ label: t('replay.prev_frame'), icon: 'step-back', size: 'lg', variant: 'secondary', testid: 'replay-prev', onClick: () => seekFrame(frameOf(now()) - 1) });
  const next = C.button({ label: t('replay.next_frame'), icon: 'step-forward', size: 'lg', variant: 'secondary', testid: 'replay-next', onClick: () => seekFrame(frameOf(now()) + 1) });
  const setBtn = C.button({ label: t('replay.set_frame'), variant: 'primary', size: 'lg', block: true, testid: 'event-set-frame', onClick: () => setEventAt(sel) });
  const resetBtn = C.button({ label: t('replay.reset_event'), variant: 'plain', size: 'md', testid: 'event-reset', onClick: () => resetEvent(sel) });
  const undoBtn = C.button({ label: t('common.undo'), icon: 'undo', variant: 'plain', size: 'md', testid: 'event-undo', onClick: () => undo() });
  const msgEl = h('p.replay-msg', { role: 'status' });

  const controls = h('div.replay-controls', {},
    timeEl,
    h('div.replay-step', {}, prev, next),
    editable ? setBtn : null,
    editable ? h('div.replay-edit-row', {}, undoBtn, resetBtn) : null,
    msgEl);

  const el = h('div.replay', {}, stage,
    h('div.tl-wrap', { 'data-testid': 'timeline' }, selChip, track, chips),
    showControls ? controls : null);

  // ------------------------------------------------------------------ state
  function select(n) {
    if (!EVENTS.includes(n)) return;
    sel = n;
    chips.value = n;
    const e = ev[n];
    const src = e ? t(e.source === 'manual' ? 'event.source.manual' : 'event.source.auto') : '';
    selChip.textContent = e ? t('replay.selected', { event: t(`event.${n}`), f: e.frame, source: src }) : t('replay.selected_none', { event: t(`event.${n}`) });
    for (const [k, m] of markers) m.el.classList.toggle('is-selected', k === n);
    paintButtons();
  }

  function paintButtons() {
    undoBtn.setDisabled(undoStack.length === 0);
    const o = original[sel];
    const c = ev[sel];
    resetBtn.setDisabled(!o || (c && c.frame === o.frame && c.source === o.source));
  }

  function changed() {
    const m = checkMonotonic(ev);
    msgEl.textContent = m.ok ? '' : m.message;
    msgEl.className = m.ok ? 'replay-msg' : 'replay-msg bad';
    layout();
    select(sel);
    onEventsChange(api.events(), { dirty: api.dirty(), ok: m.ok, check: m });
  }

  function moveEvent(n, f) {
    if (ev[n] && ev[n].frame === f && ev[n].source === 'manual') { seekFrame(f); return; }
    undoStack.push(copy(ev));
    ev[n] = { ...(ev[n] ?? {}), frame: f, t_s: f / FPS, source: 'manual', conf: 1 };
    if (!(duration >= ev[n].t_s)) duration = Math.max(duration || 0, ev[n].t_s);
    seekFrame(f);
    changed();
  }

  function setEventAt(n, s = now()) {
    if (!EVENTS.includes(n)) throw new RangeError(`unknown event '${n}'`);
    const f = clampFrame(frameOf(s), Infinity);
    undoStack.push(copy(ev));
    ev[n] = { ...(ev[n] ?? {}), frame: f, t_s: f / FPS, source: 'manual', conf: 1 };
    if (!(duration >= ev[n].t_s)) duration = Math.max(duration || 0, ev[n].t_s);
    changed();
    return ev[n];
  }

  function resetEvent(n = sel) {
    const o = original[n];
    if (!o) return;
    undoStack.push(copy(ev));
    ev[n] = copy(o);
    seekFrame(o.frame);
    changed();
  }

  function undo() {
    if (!undoStack.length) return false;
    ev = undoStack.pop();
    const e = ev[sel];
    if (e) seekFrame(e.frame);
    changed();
    return true;
  }

  function seek(s) {
    const c = Math.max(0, duration > 0 ? Math.min(duration, s) : s);
    if (!url) tLocal = c;
    else video.currentTime = c;
    paintTime();
    if (!url) draw();
  }
  function seekFrame(f) { seek(clampFrame(f, maxFrame()) / FPS); }
  const now = () => (url ? (video.currentTime || 0) : tLocal);

  function paintTime() {
    const f = frameOf(now());
    timeEl.textContent = t('replay.frame', { f, s: fmtNum(now(), { digits: 2 }) });
    canvas.setAttribute('aria-label', t('replay.canvas', { f, s: fmtNum(now(), { digits: 2 }), at: atEvent(f) }));
    paintCursor();
  }
  function atEvent(f) {
    const hit = EVENTS.filter((n) => ev[n]?.frame === f).map((n) => t(`event.${n}`));
    return hit.length ? t('replay.canvas_at', { events: hit.join(' · ') }) : '';
  }

  video.addEventListener('loadedmetadata', () => { if (Number.isFinite(video.duration)) duration = Math.max(duration, video.duration); layout(); draw(); paintTime(); });
  video.addEventListener('seeked', () => { draw(); paintTime(); });
  video.addEventListener('loadeddata', draw);

  {
    const ts = poseSeq?.t_s;
    const lastEv = Math.max(0, ...EVENTS.map((n) => ev[n]?.t_s ?? (Number.isFinite(ev[n]?.frame) ? ev[n].frame / FPS : NaN)).filter(Number.isFinite));
    duration = ts && ts.length ? Math.max(ts[ts.length - 1], lastEv) : lastEv;
  }
  let ro = null;
  try { ro = new ResizeObserver(() => layout()); ro.observe(track); } catch (_) { /* old browsers: layout once */ }
  queueMicrotask(() => { layout(); select(sel); if (ev[sel]) seekFrame(ev[sel].frame); else paintTime(); draw(); });
  select(sel);
  paintTime();

  const api = {
    el,
    events: () => copy(ev),
    setEvents(e) { ev = copy(e); saved = JSON.stringify(ev); undoStack.length = 0; layout(); select(sel); },
    time: () => now(),
    frame: () => frameOf(now()),
    seek: (s) => seek(s),
    seekFrame,
    setEventAt,
    select,
    selected: () => sel,
    undo,
    canUndo: () => undoStack.length > 0,
    resetEvent,
    dirty: () => JSON.stringify(ev) !== saved,
    markSaved() { saved = JSON.stringify(ev); undoStack.length = 0; paintButtons(); },
    hasMedia: () => media,
    layout,
    duration: () => duration,
    redraw: draw,
    destroy() { try { ro?.disconnect(); } catch (_) { /* ignore */ } if (url) URL.revokeObjectURL(url); video.removeAttribute('src'); clear(el); },
  };
  return api;
}
