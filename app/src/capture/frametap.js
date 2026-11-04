// capture/frametap.js - ROI frames from the live <video> for the worker (CAFCR R1 capture row, P3, P4).
//
//   createFrameTap(videoEl, { fps = 10, roi?: () => {x,y,w,h} | null, maxWidth = 384,
//                             onFrame(bitmap, t_media_s, meta) -> void | Promise, env? })
//     -> { start(), stop(), setFps(fps), stats() -> { delivered, dropped, busy_skips, dropped_pct },
//          mediaTimeAt(perf_ms) -> t_media_s | null, lastMediaTime() }
//   meta = { roi: {x,y,w,h} (video pixels), W, H (video size), scale, width, height (bitmap size), presentedFrames }
//   cropRect(roi, W, H, maxWidth) -> { sx, sy, sw, sh, dw, dh, scale }      (pure, exported for tests)
//   createThrottle(fps) -> { due(t_s) -> boolean, setFps(fps) }              (pure)
//
// Uses requestVideoFrameCallback (t_media_s = metadata.mediaTime) when available, else requestAnimationFrame
// (t_media_s = video.currentTime). The ROI is cropped and scaled to <= maxWidth px via OffscreenCanvas (or a
// detached <canvas>), then turned into an ImageBitmap that onFrame owns (transfer it to the worker; the receiver
// closes it). A frame is skipped while the previous onFrame promise is pending (counted as busy_skips), and gaps
// in metadata.presentedFrames are counted as dropped.

import { diagRecord } from '../workers/diag.js';

export function cropRect(roi, W, H, maxWidth = 384) {
  let x = 0, y = 0, w = W, h = H;
  if (roi && Number.isFinite(roi.w) && Number.isFinite(roi.h) && roi.w > 0 && roi.h > 0) {
    x = Math.max(0, Math.floor(roi.x));
    y = Math.max(0, Math.floor(roi.y));
    w = Math.min(W - x, Math.ceil(roi.w));
    h = Math.min(H - y, Math.ceil(roi.h));
  }
  if (!(w > 0 && h > 0)) { x = 0; y = 0; w = W; h = H; }
  const scale = Math.min(1, maxWidth / w);
  return { sx: x, sy: y, sw: w, sh: h, dw: Math.max(1, Math.round(w * scale)), dh: Math.max(1, Math.round(h * scale)), scale };
}

export function createThrottle(fps) {
  let period = 1 / fps;
  let next = -Infinity;
  return {
    due(t) {
      if (t + 1e-6 < next) return false;
      // stay on the grid without bursting after a stall
      next = next === -Infinity ? t + period : Math.max(next + period, t + period * 0.5);
      return true;
    },
    setFps(f) { period = 1 / f; next = -Infinity; },
  };
}

export function createFrameTap(videoEl, opts = {}) {
  const env = opts.env ?? globalThis;
  const maxWidth = opts.maxWidth ?? 384;
  const onFrame = opts.onFrame;
  const roiFn = typeof opts.roi === 'function' ? opts.roi : () => null;
  const throttle = createThrottle(opts.fps ?? 10);
  const hasRVFC = typeof videoEl.requestVideoFrameCallback === 'function';
  let running = false;
  let handle = null;
  let busy = false;
  let canvas = null;
  let ctx = null;
  let lastPresented = null;
  let pair = null; // { perf_ms, media_s }
  const st = { delivered: 0, dropped: 0, busy_skips: 0 };

  function surface(w, h) {
    if (!canvas) {
      canvas = typeof env.OffscreenCanvas === 'function'
        ? new env.OffscreenCanvas(w, h)
        : env.document.createElement('canvas');
      ctx = canvas.getContext('2d', { willReadFrequently: false });
    }
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    return ctx;
  }

  async function grab(t_media_s, md) {
    const W = videoEl.videoWidth;
    const H = videoEl.videoHeight;
    if (!(W > 0 && H > 0)) return;
    const r = cropRect(roiFn(), W, H, maxWidth);
    const c = surface(r.dw, r.dh);
    c.drawImage(videoEl, r.sx, r.sy, r.sw, r.sh, 0, 0, r.dw, r.dh);
    const bitmap = typeof canvas.transferToImageBitmap === 'function'
      ? canvas.transferToImageBitmap()
      : await env.createImageBitmap(canvas);
    const meta = { roi: { x: r.sx, y: r.sy, w: r.sw, h: r.sh }, W, H, scale: r.scale, width: r.dw, height: r.dh,
      presentedFrames: md ? md.presentedFrames ?? null : null };
    st.delivered += 1;
    await onFrame(bitmap, t_media_s, meta);
  }

  function tick(now, md) {
    if (!running) return;
    const t = md && Number.isFinite(md.mediaTime) ? md.mediaTime : videoEl.currentTime;
    const perf = md && Number.isFinite(md.captureTime) ? md.captureTime
      : md && Number.isFinite(md.presentationTime) ? md.presentationTime : now;
    if (Number.isFinite(t) && Number.isFinite(perf)) pair = { perf_ms: perf, media_s: t };
    if (md && Number.isFinite(md.presentedFrames)) {
      if (lastPresented !== null && md.presentedFrames > lastPresented + 1) st.dropped += md.presentedFrames - lastPresented - 1;
      lastPresented = md.presentedFrames;
    }
    if (Number.isFinite(t) && throttle.due(t)) {
      if (busy) st.busy_skips += 1;
      else {
        busy = true;
        Promise.resolve()
          .then(() => grab(t, md))
          .catch((e) => diagRecord('live.frametap_error', String(e && e.message ? e.message : e)))
          .finally(() => { busy = false; });
      }
    }
    schedule();
  }

  function schedule() {
    if (!running) return;
    handle = hasRVFC ? videoEl.requestVideoFrameCallback(tick) : env.requestAnimationFrame((now) => tick(now, null));
  }

  return {
    start() { if (running) return; running = true; diagRecord('live.frame_callback', hasRVFC ? 'rvfc' : 'raf'); schedule(); },
    stop() {
      running = false;
      if (handle !== null) {
        try { hasRVFC ? videoEl.cancelVideoFrameCallback?.(handle) : env.cancelAnimationFrame?.(handle); } catch { /* ignore */ }
      }
      handle = null;
    },
    setFps(f) { throttle.setFps(f); },
    stats() {
      // dropped_pct counts frames the camera presented that we never saw, out of everything presented
      const seen = lastPresented === null ? st.delivered + st.busy_skips : lastPresented;
      return { ...st, dropped_pct: seen > 0 ? (100 * st.dropped) / seen : 0 };
    },
    mediaTimeAt(perf_ms) { return pair ? pair.media_s + (perf_ms - pair.perf_ms) / 1000 : null; },
    lastMediaTime() { return pair ? pair.media_s : null; },
  };
}
