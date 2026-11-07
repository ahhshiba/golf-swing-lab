// viz/traj3d.js — 3-D trajectories with a hand-written orbit camera, Canvas 2D only, no library
// (LAUNCH-MONITOR-SPEC §3.6, §5.0-4; docs/viz.md §6). Size gate: ≤ 12,288 B.
//
//   createTraj3d(canvas, { flights: [{ samples, club, validity, series? }], palette | () => palette, units, target_m?, onChange? })
//     a palette function is read on every redraw, so a theme change only needs redraw()
//     -> { rotate(dYawDeg), setPitch('top'|'oblique'), redraw(), destroy(), a11y, params }
//   orbitCamera({ yaw, pitch, dist, center, fov, w, h }) -> cam      project3(cam, [x, y, z]) -> [sx, sy, depth] | null
//
// Camera: orbits halfway between the tee and the landing centre; starts at yaw −25°; yaw 0 = behind the tee looking down +x, pitch = elevation (deg).
// Drag with one finger / mouse rotates (yaw ↔ horizontal, pitch ↔ vertical); arrow keys and the caller's buttons
// (rotate ±15°, top / oblique) do the same without a gesture. Never rotates by itself. onChange({ a11y, params }) runs
// after each redraw so the caller can refresh the canvas aria-label.
import { t, fmtNum } from '../i18n/index.js';
import { seriesIndex } from './palette.js';
import { setup, distUnit, dash, glyph, text, thin, finite, FS } from './draw.js';

const D = Math.PI / 180;
const PITCH = { oblique: 18, top: 89.5 };
const YAW0 = -25; // default: behind and to the right of the tee, so the curve has depth

export function orbitCamera({ yaw = 0, pitch = PITCH.oblique, dist = 200, center = [0, 0, 0], fov = 50, w = 300, h = 200 }) {
  const ps = Math.sin(pitch * D);
  const pc = Math.cos(pitch * D);
  const ys = Math.sin(yaw * D);
  const yc = Math.cos(yaw * D);
  const fwd = [pc * yc, pc * ys, -ps];
  const right = [ys, -yc, 0];
  const up = [ps * yc, ps * ys, pc]; // = right × fwd
  const eye = [center[0] - dist * fwd[0], center[1] - dist * fwd[1], center[2] - dist * fwd[2]];
  return { eye, fwd, right, up, F: h / 2 / Math.tan((fov * D) / 2), w, h };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function toCam(cam, p) {
  const q = [p[0] - cam.eye[0], p[1] - cam.eye[1], p[2] - cam.eye[2]];
  return [dot(q, cam.right), dot(q, cam.up), dot(q, cam.fwd)];
}
const screen = (cam, c) => [cam.w / 2 + (cam.F * c[0]) / c[2], cam.h / 2 - (cam.F * c[1]) / c[2], c[2]];

export function project3(cam, p) {
  const c = toCam(cam, p);
  return c[2] > 1e-6 ? screen(cam, c) : null;
}

const NEAR = 0.5;
/** Segment a→b clipped at the near plane, in screen space, or null. */
function seg(cam, a, b) {
  let A = toCam(cam, a);
  let B = toCam(cam, b);
  if (A[2] < NEAR && B[2] < NEAR) return null;
  const cut = (P, Q) => { const s = (NEAR - P[2]) / (Q[2] - P[2]); return [P[0] + s * (Q[0] - P[0]), P[1] + s * (Q[1] - P[1]), NEAR]; };
  if (A[2] < NEAR) A = cut(A, B);
  else if (B[2] < NEAR) B = cut(B, A);
  return [screen(cam, A), screen(cam, B)];
}

function polyline(ctx, cam, pts) {
  ctx.beginPath();
  let last = null;
  for (let i = 1; i < pts.length; i++) {
    const s = seg(cam, pts[i - 1], pts[i]);
    if (!s) { last = null; continue; }
    if (!last || Math.hypot(last[0] - s[0][0], last[1] - s[0][1]) > 0.01) ctx.moveTo(s[0][0], s[0][1]);
    ctx.lineTo(s[1][0], s[1][1]);
    last = s[1];
  }
}

const okFlight = (f) => f && Array.isArray(f.samples) && f.samples.length >= 2 && f.samples.every((p) => Array.isArray(p) && p.slice(0, 4).every(finite));

export function createTraj3d(canvas, opts = {}) {
  let P = opts.palette;
  const { f, key } = distUnit(opts.units);
  const total = (opts.flights ?? []).length;
  const { list, sampled } = thin((opts.flights ?? []).filter(okFlight), 200);
  const lands = list.map((fl) => fl.samples[fl.samples.length - 1]);
  // orbit centre: halfway from the tee to the centre of the landing points (keeps tee and landings in frame)
  const center = lands.length
    ? [lands.reduce((s, p) => s + p[1], 0) / lands.length / 2, lands.reduce((s, p) => s + p[2], 0) / lands.length / 2, 0]
    : [50, 0, 0];
  const maxX = Math.max(50, ...lands.map((p) => p[1]), finite(opts.target_m) ? opts.target_m : 0);
  let maxY = 0;
  let maxZ = 5;
  for (const fl of list) for (const p of fl.samples) { maxY = Math.max(maxY, Math.abs(p[2])); maxZ = Math.max(maxZ, p[3]); }
  const g = 25 / f; // grid every 25 display units (m or yd)
  const gx1 = Math.ceil((maxX + g * 0.6) / g) * g;
  const gy = Math.max(2, Math.ceil((maxY + g * 0.5) / g)) * g;
  const fitPts = [[0, 0, 0], [maxX, 0, 0], [center[0], 0, maxZ], ...lands.map((p) => [p[1], p[2], 0])];
  const state = { yaw: YAW0, pitch: PITCH.oblique, mode: 'oblique' };
  const handle = { a11y: 'viz.traj3d.empty', params: { n: 0 } };
  let dist = 0;
  let size = '';

  function fit(w, h) {
    // auto-frame: smallest distance (×1.12 steps) that keeps every fit point inside 92 % of the frame at every yaw
    // of the current pitch, so turning never zooms (a pitch change refits)
    let d = Math.max(40, maxX * 0.4);
    for (let k = 0; k < 40; k++) {
      let ok = true;
      for (let yaw = 0; yaw < 360 && ok; yaw += 30) {
        const cam = orbitCamera({ yaw, pitch: state.pitch, dist: d, center, w, h });
        for (const p of fitPts) {
          const s = project3(cam, p);
          if (!s || Math.abs(s[0] - w / 2) > w * 0.46 || Math.abs(s[1] - h / 2) > h * 0.46) { ok = false; break; }
        }
      }
      if (ok) return d;
      d *= 1.12;
    }
    return d;
  }

  function redraw() {
    if (typeof opts.palette === 'function') P = opts.palette();
    const { ctx, w, h } = setup(canvas, P);
    const sz = `${w}x${h}:${Math.round(state.pitch)}`;
    if (sz !== size) { dist = fit(w, h); size = sz; }
    const cam = orbitCamera({ yaw: state.yaw, pitch: state.pitch, dist, center, w, h });
    // ground grid
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeStyle = P.grid;
    ctx.beginPath();
    for (let x = 0; x <= gx1 + 1e-6; x += g) { const s = seg(cam, [x, -gy, 0], [x, gy, 0]); if (s) { ctx.moveTo(s[0][0], s[0][1]); ctx.lineTo(s[1][0], s[1][1]); } }
    for (let y = -gy; y <= gy + 1e-6; y += g) { const s = seg(cam, [0, y, 0], [gx1, y, 0]); if (s) { ctx.moveTo(s[0][0], s[0][1]); ctx.lineTo(s[1][0], s[1][1]); } }
    ctx.stroke();
    // distance labels along the right-hand grid edge; a label that would touch one already drawn (far rows converge
    // in perspective) is skipped (box: ~6 px per character at 10 px, 11 px high, 3 px gap)
    const drawn = [];
    for (let x = 2 * g; x <= gx1 + 1e-6; x += 2 * g) {
      const s = project3(cam, [x, -gy, 0]);
      if (!(s && s[0] > 8 && s[0] < w - 8 && s[1] > 8 && s[1] < h - 4)) continue;
      const label = fmtNum(x * f);
      const r = { l: s[0] - label.length * 3 * FS - 3, r: s[0] + label.length * 3 * FS + 3, t: s[1] - 14 * FS, b: s[1] };
      if (drawn.some((q) => r.l < q.r && q.l < r.r && r.t < q.b && q.t < r.b)) continue;
      drawn.push(r);
      text(ctx, label, s[0], s[1] - 3, { colour: P.text, align: 'center', font: P.font, size: 10 });
    }
    // target line (y = 0) and the target distance
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = P.target;
    polyline(ctx, cam, [[0, 0, 0], [gx1, 0, 0]]);
    ctx.stroke();
    if (finite(opts.target_m)) {
      ctx.setLineDash([3, 3]);
      polyline(ctx, cam, [[opts.target_m, -g, 0], [opts.target_m, g, 0]]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const one = list.length === 1;
    for (const fl of list) {
      const si = seriesIndex(fl.club, fl.series);
      const col = P.series[si];
      const pts = fl.samples.map((p) => [p[1], p[2], p[3]]);
      // ground shadow
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.strokeStyle = P.axis;
      polyline(ctx, cam, pts.map((p) => [p[0], p[1], 0]));
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = one ? 3 : list.length > 40 ? 1.25 : 2;
      dash(ctx, fl.validity);
      ctx.strokeStyle = col;
      if (one && P.dark) { ctx.shadowColor = col; ctx.shadowBlur = 10; }
      polyline(ctx, cam, pts);
      ctx.stroke();
      ctx.shadowBlur = 0;
      const l = project3(cam, [pts[pts.length - 1][0], pts[pts.length - 1][1], 0]);
      if (l) glyph(ctx, P.seriesGlyph[si], l[0], l[1], one ? 5 : 3.5, col, P.bg);
    }
    ctx.setLineDash([]);
    const tee = project3(cam, [0, 0, 0]);
    if (tee) glyph(ctx, 'ring', tee[0], tee[1], 4, P.ink, P.bg);
    if (!list.length) text(ctx, t('viz.traj3d.empty'), w / 2, h / 2, { colour: P.text, align: 'center', font: P.font, size: 13 });
    const yaw = Math.round((((state.yaw % 360) + 540) % 360) - 180);
    handle.a11y = !list.length ? 'viz.traj3d.empty' : sampled ? 'viz.traj3d.alt_sampled' : 'viz.traj3d.alt';
    handle.params = { n: total, shown: list.length, view: t(state.mode === 'top' ? 'viz.traj3d.view_top' : 'viz.traj3d.view_oblique'), yaw, pitch: Math.round(state.pitch), unit: t(`unit.${key}`) };
    opts.onChange?.({ a11y: handle.a11y, params: handle.params });
    return { a11y: handle.a11y, params: handle.params };
  }

  let raf = 0;
  const schedule = () => {
    if (raf) return;
    const run = () => { raf = 0; redraw(); };
    raf = globalThis.requestAnimationFrame ? globalThis.requestAnimationFrame(run) : (run(), 0);
  };

  // pointer drag: one finger / mouse; the canvas owns the gesture (touch-action none), buttons are the alternative
  let drag = null;
  const down = (e) => {
    if (e.isPrimary === false) return;
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    try { canvas.setPointerCapture?.(e.pointerId); } catch (_) { /* capture is optional */ }
  };
  const move = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    state.yaw -= (e.clientX - drag.x) * 0.4;
    state.pitch = Math.min(PITCH.top, Math.max(4, state.pitch + (e.clientY - drag.y) * 0.3));
    state.mode = state.pitch > 80 ? 'top' : 'oblique';
    drag.x = e.clientX;
    drag.y = e.clientY;
    schedule();
  };
  const up = () => { drag = null; };
  const key2 = (e) => {
    const k = { ArrowLeft: -15, ArrowRight: 15 }[e.key];
    if (k) { e.preventDefault(); api.rotate(k); } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); api.setPitch(e.key === 'ArrowUp' ? 'top' : 'oblique'); }
  };
  const on = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up], ['keydown', key2]];
  for (const [ev, fn] of on) canvas.addEventListener?.(ev, fn);
  if (canvas.style) canvas.style.touchAction = 'none';
  let ro = null;
  if (globalThis.ResizeObserver && canvas.isConnected !== false) { ro = new globalThis.ResizeObserver(() => schedule()); ro.observe(canvas); }

  const api = {
    rotate(dYawDeg) { if (finite(dYawDeg)) state.yaw += dYawDeg; return redraw(); },
    setPitch(mode) { state.mode = mode === 'top' ? 'top' : 'oblique'; state.pitch = PITCH[state.mode]; return redraw(); },
    redraw,
    destroy() {
      for (const [ev, fn] of on) canvas.removeEventListener?.(ev, fn);
      ro?.disconnect();
      if (raf && globalThis.cancelAnimationFrame) globalThis.cancelAnimationFrame(raf);
      raf = 0;
    },
    get a11y() { return handle.a11y; },
    get params() { return handle.params; },
    get view() { return { yaw: state.yaw, pitch: state.pitch, mode: state.mode }; },
  };
  redraw();
  return api;
}
