// Slow-motion exports with the speed baked in (PRODUCT-SPEC §7.2 EV-3). An iPhone slow-motion clip shared as a file
// is often re-timed: 240 fps captured, written at 30 fps, so the swing plays (and is timestamped) 8× slower. The
// rules then find no swing, or one with a multi-second downswing. detectTimeScaled() retries on a compressed time
// base and keeps the scale whose swing has a plausible downswing. Pure: no DOM, no clock, no randomness.
//
//   SLOWMO                       thresholds below
//   scalePoseTime(poseSeq, k)    -> PoseSeq with t_s / k (same frames)
//   swingDurations(ev)           -> { backswing_s, downswing_s } | null
//   detectTimeScaled(poseSeq, opts, { container_fps, duration_s, captureFpsHint?, detect? }) -> EventSet
//     EventSet times stay in media seconds (the clip's own time line, so replay seeks the right frame); the
//     non-enumerable `meta` = { time_scale: 1 | 4 | 8, effective_fps, tried: [{ k, downswing_s }] }.

import { detectEvents } from './rules.js';
import { estimateFps } from './signal.js';

export const SLOWMO = Object.freeze({
  scales: Object.freeze([4, 8]), // 120 fps and 240 fps captures written at 30 fps
  max_container_fps: 60, // only a clip written at <= 60 fps can carry a baked slow motion
  min_duration_s: 4, // a baked swing lasts several seconds
  downswing_s: Object.freeze([0.15, 0.6]), // plausible real downswing (assemble.js DOWNSWING_RANGE_S)
  typical_downswing_s: 0.3,
  typical_backswing_s: 0.85,
});

export function scalePoseTime(poseSeq, k) {
  if (k === 1) return poseSeq;
  const t_s = new Float64Array(poseSeq.t_s.length);
  for (let i = 0; i < t_s.length; i++) t_s[i] = poseSeq.t_s[i] / k;
  return { ...poseSeq, t_s };
}

export function swingDurations(ev) {
  if (!ev || !ev.impact || !Number.isFinite(ev.impact.t_s) || !Number.isFinite(ev.top?.t_s) || !Number.isFinite(ev.address?.t_s)) return null;
  return { backswing_s: ev.top.t_s - ev.address.t_s, downswing_s: ev.impact.t_s - ev.top.t_s };
}

const plausible = (d) => d !== null && d.downswing_s >= SLOWMO.downswing_s[0] && d.downswing_s <= SLOWMO.downswing_s[1];
const score = (d) => Math.abs(Math.log(d.downswing_s / SLOWMO.typical_downswing_s))
  + Math.abs(Math.log(Math.max(1e-3, d.backswing_s) / SLOWMO.typical_backswing_s));

function withMeta(ev, meta) {
  Object.defineProperty(ev, 'meta', { value: meta, enumerable: false, configurable: true });
  return ev;
}

/** Events of a scaled run mapped back to media time (frame indices are unchanged). */
function toMedia(ev, k) {
  if (k === 1) return ev;
  const out = {};
  for (const [name, e] of Object.entries(ev)) out[name] = e && Number.isFinite(e.t_s) ? { ...e, t_s: e.t_s * k } : e;
  if (ev.diag) Object.defineProperty(out, 'diag', { value: ev.diag, enumerable: false });
  if (ev.fallback) Object.defineProperty(out, 'fallback', { value: ev.fallback, enumerable: false });
  return out;
}

export function detectTimeScaled(poseSeq, opts = {}, ctx = {}) {
  const detect = ctx.detect ?? detectEvents;
  const fps = Number.isFinite(ctx.container_fps) && ctx.container_fps > 0 ? ctx.container_fps : estimateFps(poseSeq.t_s);
  const n = poseSeq.t_s.length;
  const duration = Number.isFinite(ctx.duration_s) ? ctx.duration_s : (n > 1 ? poseSeq.t_s[n - 1] - poseSeq.t_s[0] : 0);
  const native = detect(poseSeq, opts);
  const dNative = swingDurations(native);
  const tried = [{ k: 1, downswing_s: dNative ? dNative.downswing_s : null }];
  const meta = (k) => ({ time_scale: k, effective_fps: Number.isFinite(fps) ? fps * k : null, tried });
  if (plausible(dNative) || !(fps <= SLOWMO.max_container_fps) || !(duration >= SLOWMO.min_duration_s)) {
    return withMeta(native, meta(1));
  }
  // a capture-rate hint (QuickTime metadata) puts its own scale first
  let scales = [...SLOWMO.scales];
  const hint = ctx.captureFpsHint;
  if (Number.isFinite(hint) && hint > 1.5 * fps) {
    const kh = Math.round(hint / fps);
    if (kh >= 2 && kh <= 16) scales = [kh, ...scales.filter((k) => k !== kh)];
  }
  let best = null;
  for (const k of scales) {
    const ev = detect(scalePoseTime(poseSeq, k), opts);
    const d = swingDurations(ev);
    tried.push({ k, downswing_s: d ? d.downswing_s : null });
    if (!plausible(d)) continue;
    const c = { k, ev, s: score(d) };
    if (k === scales[0] && scales[0] !== SLOWMO.scales[0] && Number.isFinite(hint)) { best = c; break; } // trust the hint
    if (!best || c.s < best.s) best = c;
  }
  if (!best) return withMeta(native, meta(1));
  return withMeta(toMedia(best.ev, best.k), meta(best.k));
}
