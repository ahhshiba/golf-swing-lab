// Frame helpers for the high-speed clip pipeline (CAFCR P5 "第二輪 impact 前 30／後 60 幀全幀率追球").
// Pure: no DOM, no WebCodecs, no clock. Owner: integration-core. Called by pipeline/clip.js (media owner) and by
// pipeline/assemble.js; tested in Node (tests/unit/pipeline.frames.test.mjs).
//
//   rgbaToGray(img, out?)                       {data, W|width, H|height} RGBA -> Uint8Array(W·H), BT.601 luma
//   rgbaToGrayCrop(img, roi, out?)              same, converting only the ROI -> { data, W, H, origin, roi }
//   cropGray(gray, W, H, roi)                   grayscale crop -> { data, W, H, origin: {u, v}, roi }
//   clampRoi(roi, W, H)                         integer ROI inside the image -> {x, y, w, h} | null
//   resolveTimestamps(cts, n, nominal_fps)      container CTS or nominal fallback -> { times, kind, monotonic, reason_codes }
//   effectiveFps(times)                         (n − 1) / (t_last − t_first), NaN for < 2 frames
//   nearestFrame(times, t_s)                    index of the timestamp nearest t_s (binary search)
//   impactWindow({ times | n, impact_t_s | impact_frame, before = 30, after = 60 })
//                                               -> { start, end (exclusive), impact, n, clipped }
//   sliceWindow(frames, times, win)             -> { frames, times }
//   suggestBallRoi({ W, H, rest: {u, v, w_px}, dir: [du, dv], back_px?, below_px?, tee_px? }) -> {x, y, w, h}
//
// Coordinates: pixel (i, j) has its centre at (i + 0.5, j + 0.5) (docs/interfaces.md §2). A crop keeps that
// convention with its own origin: full-image u = crop u + origin.u.

import { RC } from '../contract/reason-codes.js';

/** P5: frames analysed at full rate before and after the impact frame. */
export const PRE_IMPACT_FRAMES = 30;
export const POST_IMPACT_FRAMES = 60;

// BT.601 luma in 16.16 fixed point: Y = 0.299 R + 0.587 G + 0.114 B (weights sum to exactly 65536).
const WR = 19595;
const WG = 38470;
const WB = 7471;

function dims(img) {
  const W = img.W ?? img.width;
  const H = img.H ?? img.height;
  if (!Number.isInteger(W) || !Number.isInteger(H) || W <= 0 || H <= 0) throw new RangeError('frames: image needs integer W/H (or width/height)');
  if (!img.data || img.data.length < W * H * 4) throw new RangeError('frames: RGBA data shorter than W·H·4');
  return [W, H];
}

/** RGBA (ImageData-like) -> grayscale Uint8Array(W·H), BT.601 luma rounded to nearest. Alpha is ignored. */
export function rgbaToGray(img, out) {
  const [W, H] = dims(img);
  const d = img.data;
  const n = W * H;
  const g = out && out.length >= n ? out : new Uint8Array(n);
  for (let p = 0, q = 0; p < n; p++, q += 4) g[p] = (WR * d[q] + WG * d[q + 1] + WB * d[q + 2] + 32768) >>> 16;
  return g;
}

/** Integer ROI clamped to the image: floor of the start, ceil of the end. null when empty. */
export function clampRoi(roi, W, H) {
  if (!roi) return { x: 0, y: 0, w: W, h: H };
  const x0 = Math.max(0, Math.floor(roi.x));
  const y0 = Math.max(0, Math.floor(roi.y));
  const x1 = Math.min(W, Math.ceil(roi.x + roi.w));
  const y1 = Math.min(H, Math.ceil(roi.y + roi.h));
  if (!(x1 > x0 && y1 > y0)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** RGBA -> grayscale of the ROI only. Returns { data: Uint8Array(w·h), W: w, H: h, origin: {u, v}, roi }. */
export function rgbaToGrayCrop(img, roi, out) {
  const [W, H] = dims(img);
  const r = clampRoi(roi, W, H);
  if (!r) throw new RangeError('rgbaToGrayCrop: ROI outside the image');
  const d = img.data;
  const g = out && out.length >= r.w * r.h ? out : new Uint8Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) {
    let q = ((r.y + y) * W + r.x) * 4;
    let p = y * r.w;
    for (let x = 0; x < r.w; x++, p++, q += 4) g[p] = (WR * d[q] + WG * d[q + 1] + WB * d[q + 2] + 32768) >>> 16;
  }
  return { data: g, W: r.w, H: r.h, origin: { u: r.x, v: r.y }, roi: r };
}

/** Grayscale crop. gray: Uint8Array(W·H). Returns { data, W, H, origin: {u, v}, roi }. */
export function cropGray(gray, W, H, roi) {
  if (!gray || gray.length < W * H) throw new RangeError('cropGray: data shorter than W·H');
  const r = clampRoi(roi, W, H);
  if (!r) throw new RangeError('cropGray: ROI outside the image');
  const out = new Uint8Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) out.set(gray.subarray((r.y + y) * W + r.x, (r.y + y) * W + r.x + r.w), y * r.w);
  return { data: out, W: r.w, H: r.h, origin: { u: r.x, v: r.y }, roi: r };
}

/**
 * Frame times (interfaces.md §2 "Time"): container CTS when present, finite and strictly increasing; otherwise
 * frame / nominal_fps with RC.TIMESTAMPS_NOMINAL. Returns { times: Float64Array(n), kind: 'container'|'nominal',
 * monotonic, reason_codes }.
 */
export function resolveTimestamps(cts, n, nominal_fps) {
  const N = Number.isInteger(n) ? n : cts?.length ?? 0;
  let ok = Array.isArray(cts) || ArrayBuffer.isView(cts);
  if (ok && cts.length < N) ok = false;
  let monotonic = ok;
  if (ok) {
    for (let i = 0; i < N; i++) {
      if (!Number.isFinite(cts[i]) || (i > 0 && !(cts[i] > cts[i - 1]))) { monotonic = false; break; }
    }
  }
  if (ok && monotonic) return { times: Float64Array.from({ length: N }, (_, i) => cts[i]), kind: 'container', monotonic: true, reason_codes: [] };
  if (!(nominal_fps > 0)) throw new RangeError('resolveTimestamps: no usable CTS and no nominal_fps');
  return {
    times: Float64Array.from({ length: N }, (_, i) => i / nominal_fps),
    kind: 'nominal',
    monotonic,
    reason_codes: [RC.TIMESTAMPS_NOMINAL],
  };
}

/** Mean frame rate over the span of the timestamps. */
export function effectiveFps(times) {
  if (!times || times.length < 2) return NaN;
  const span = times[times.length - 1] - times[0];
  return span > 0 ? (times.length - 1) / span : NaN;
}

/** Index of the timestamp nearest t_s (times sorted ascending). -1 for an empty list. */
export function nearestFrame(times, t_s) {
  const n = times?.length ?? 0;
  if (!n) return -1;
  if (!(t_s > times[0])) return 0;
  if (t_s >= times[n - 1]) return n - 1;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t_s) lo = mid; else hi = mid;
  }
  return t_s - times[lo] <= times[hi] - t_s ? lo : hi;
}

/**
 * P5 impact window: `before` frames before the impact frame, the impact frame and `after` frames after it,
 * clamped to the clip. o: { times | n, impact_t_s | impact_frame, before = 30, after = 60 }.
 * Returns { start, end (exclusive), impact (index inside the clip), n (= end − start), clipped }.
 */
export function impactWindow(o) {
  const n = o.times ? o.times.length : o.n;
  if (!Number.isInteger(n) || n <= 0) throw new RangeError('impactWindow: empty clip');
  let impact;
  if (Number.isInteger(o.impact_frame)) impact = o.impact_frame;
  else if (Number.isFinite(o.impact_t_s) && o.times) impact = nearestFrame(o.times, o.impact_t_s);
  else throw new RangeError('impactWindow: needs impact_frame, or impact_t_s with times');
  impact = Math.min(n - 1, Math.max(0, impact));
  const before = o.before ?? PRE_IMPACT_FRAMES;
  const after = o.after ?? POST_IMPACT_FRAMES;
  const start = Math.max(0, impact - before);
  const end = Math.min(n, impact + after + 1);
  return { start, end, impact, n: end - start, clipped: start !== impact - before || end !== impact + after + 1 };
}

/** Slice frames and times to a window from impactWindow. */
export function sliceWindow(frames, times, win) {
  return { frames: frames.slice(win.start, win.end), times: Float64Array.from(times.slice(win.start, win.end)) };
}

/**
 * Analysis ROI for the ball flight: from `back_px` behind the resting ball (club head before impact) to the image
 * edge in the flight direction, and from `below_px` (+ tee) under the ball to the top edge when the flight goes up.
 * o: { W, H, rest: {u, v, w_px}, dir: [du, dv] (image direction toward the target), back_px?, below_px?, tee_px? }.
 */
export function suggestBallRoi(o) {
  const { W, H, rest } = o;
  const r = (rest.w_px > 0 ? rest.w_px : 20) / 2;
  const back = o.back_px ?? 10 * r;
  const below = o.below_px ?? 4 * r;
  const tee = o.tee_px ?? 0;
  const du = o.dir?.[0] ?? 1;
  const x0 = du >= 0 ? rest.u - back : 0;
  const x1 = du >= 0 ? W : rest.u + back;
  const y1 = rest.v + r + below + tee;
  return clampRoi({ x: x0, y: 0, w: x1 - x0, h: y1 }, W, H);
}
