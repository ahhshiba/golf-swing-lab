// quick/live.js — the quick read's tap on the live loop (V04-SPEC §A.3; owner V4-B). Lazy: ui/quickcard.js attachQuick
// creates it when a session starts; pipeline/live.js only calls the hooks below (option `quick`), so the shell carries
// none of this.
//
//   createQuickTap({ estimate: quickEstimate, input() -> { view, club, handedness, calibration, gappingRow, settings,
//                    fps }, onProvisional(r) -> paint time (performance.now() ms, or a Promise of it), onDrop?(r),
//                    mediaNow?() -> media s, now?() -> ms, geom?() -> { calibration, handedness } (default: input()) })
//     -> { sample(s, row?), impact(ev), shot(ev, analysePractice) -> QuickResult | null, compare(quick, shot), stats() }
//   leadWrist(img, world, { calibration?, handedness }) -> { xl_m, yl_m } | null   (pure)
//
// sample(s, row): every wrist sample of the loop ({ t_s, x_m, y_m }: pipeline/live.js wristSample, after the detector
// has seen it) with its pose row { img, world }: the lead wrist is added from the row (xl_m, yl_m; the club-speed chords
// use the lead wrist like metrics/club.js) in the same body-plane scale as wristSample; the last 6 s are kept. impact(ev): the detector's 'impact' event; the quick read runs on the first sample at or after
// t_impact + 0.02 s (POSE_CLUB_WINDOW_S end: the club-speed chords need it), on the samples since address − 1.5 s:
// no decoding, no re-analysis. shot(ev): the quick read of this swing (same impact within 0.5 s) for its analysis job;
// a practice swing (not analysed) withdraws it (onDrop). compare(quick, shot): a refined value outside the quick ci95
// counts as a miss (is the quick read over-confident?).
// Diag: live.quick_log = [{ t_impact, t_ready_media, t_paint_perf, latency_ms, compute_ms, backswing_s, downswing_s,
// tempo_ratio ([value, ci95 lo, hi] | null) }] (last 64) and
// live.quick = { n, latency_ms_p50, latency_ms_p95, compared, miss }. latency_ms = media clock at the paint (mediaNow:
// the <video> playback position) − impact time: impact → number on screen as far as the page can see (the camera's own
// capture-to-video delay before that is invisible to the page). Errors never reach the shot path (live.quick_error).

import { diagRecord } from '../workers/diag.js';

const AFTER_S = 0.02;
const KEEP_S = 6;
const LOG_MAX = 64;
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);

/**
 * Lead wrist in the body plane, the same conversion as pipeline/live.js wristSample (camera scale at D_m, or MediaPipe
 * world metres, y up): MediaPipe's left wrist (15) for a right-handed golfer, the right one (16) for a left-handed one.
 */
export function leadWrist(img, world, { calibration, handedness } = {}) {
  const j = handedness === 'left' ? 16 : 15;
  const cam = calibration?.camera;
  if (cam && cam.f > 0 && img) {
    const s = (calibration.pose?.D_m > 0 ? calibration.pose.D_m : 2.7) / cam.f;
    const u = img[4 * j] * cam.W, v = img[4 * j + 1] * cam.H;
    return Number.isFinite(u) && Number.isFinite(v) ? { xl_m: (u - cam.cx) * s, yl_m: -(v - cam.cy) * s } : null;
  }
  if (world) {
    const x = world[3 * j], y = world[3 * j + 1];
    return Number.isFinite(x) && Number.isFinite(y) ? { xl_m: x, yl_m: -y } : null;
  }
  return null;
}

/** Linear-interpolated percentile p ∈ [0, 1] of the finite values, or null. */
export function percentile(xs, p) {
  const a = xs.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const r = p * (a.length - 1);
  const lo = Math.floor(r);
  return a[lo] + (a[Math.ceil(r)] - a[lo]) * (r - lo);
}

export function createQuickTap(o) {
  const now = o.now ?? (() => (globalThis.performance ? globalThis.performance.now() : Date.now()));
  const hist = [];
  const log = [];
  const lat = [];
  const st = { n: 0, compared: 0, miss: 0 };
  let wait = null; // impact event waiting for its +20 ms sample
  let cur = null; // the quick read of the swing in progress
  const diag = () => diagRecord('live.quick', {
    n: st.n, latency_ms_p50: r3(percentile(lat, 0.5)), latency_ms_p95: r3(percentile(lat, 0.95)), compared: st.compared, miss: st.miss,
  });

  function run(tReady) {
    const ev = wait;
    wait = null;
    let r;
    try {
      const t0 = Number.isFinite(ev.t_address) ? ev.t_address : ev.t_impact - 3;
      r = o.estimate({ gappingRow: null, settings: {}, ...(o.input?.() ?? {}), samples: hist.filter((x) => x.t_s >= t0 - 1.5), impact: ev });
    } catch (e) {
      diagRecord('live.quick_error', String(e?.code ?? e?.message ?? e));
      return;
    }
    cur = r;
    Promise.resolve(o.onProvisional?.(r)).then((tp) => {
      const paint = Number.isFinite(tp) ? tp : now();
      const m = o.mediaNow?.();
      const ti = Number.isFinite(r.t_impact) ? r.t_impact : ev.t_impact;
      // the media clock read now, taken back to the paint
      const latency_ms = Number.isFinite(m) ? Math.round(Math.max(0, (m - ti) * 1000 - (now() - paint))) : null;
      st.n += 1;
      if (latency_ms !== null) { lat.push(latency_ms); if (lat.length > LOG_MAX) lat.shift(); }
      const tm = (id) => { const x = r.metrics?.[id]; return Number.isFinite(x?.value) ? [r3(x.value), r3(x.ci95[0]), r3(x.ci95[1])] : null; };
      log.push({ t_impact: r3(ti), t_ready_media: r3(tReady), t_paint_perf: Math.round(paint), latency_ms, compute_ms: r3(r.timings_ms?.compute),
        backswing_s: tm('backswing_s'), downswing_s: tm('downswing_s'), tempo_ratio: tm('tempo_ratio') });
      if (log.length > LOG_MAX) log.shift();
      diagRecord('live.quick_log', log.slice());
      diag();
    }, (e) => diagRecord('live.quick_error', String(e?.message ?? e)));
  }

  return {
    sample(s, row) {
      if (!s || !Number.isFinite(s.t_s)) return;
      const lw = row ? leadWrist(row.img, row.world, (o.geom ?? o.input)?.() ?? {}) : null;
      hist.push(lw ? { ...s, ...lw } : s);
      while (hist.length && hist[0].t_s < s.t_s - KEEP_S) hist.shift();
      if (wait && s.t_s >= wait.t_impact + AFTER_S) run(s.t_s);
    },
    impact(ev) { wait = ev; cur = null; },
    shot(ev, analysePractice = false) {
      const q = cur && Math.abs(cur.t_impact - ev.t_impact) < 0.5 ? cur : null;
      cur = null;
      wait = null;
      if (q && ev.kind === 'practice' && !analysePractice) { o.onDrop?.(q); return null; }
      return q;
    },
    compare(quick, shot) {
      for (const [id, qm] of Object.entries(quick?.metrics ?? {})) {
        const v = shot?.metrics?.[id]?.value;
        if (!Number.isFinite(v) || !Array.isArray(qm?.ci95)) continue;
        st.compared += 1;
        if (v < qm.ci95[0] || v > qm.ci95[1]) st.miss += 1;
      }
      diag();
    },
    stats: () => ({ ...st, latency_ms: lat.slice(), log: log.slice() }),
  };
}
