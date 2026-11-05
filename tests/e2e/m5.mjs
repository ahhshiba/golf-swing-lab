// M5 machine gate (CAFCR R6 M5): Chromium fake camera (y4m) + fake microphone (wav) drive the live mode through one full
// pass of the 105 s fixture timeline (10 real swings, 5 practice swings, 10 neighbour sounds). Detections are matched
// to the truth by impact time (|dt| <= MATCH_S, one-to-one). Pass: recall >= 0.9 over the 10 real swings, false
// triggers (accepted swings matching no real swing: practice swings, neighbour sounds, nothing) <= 1, accepted-swing
// count within +-1 of 10, gum.calls == 1, touches_per_shot == 0. Practice-swing and neighbour-sound rejections are
// reported separately. Pose comes from an e2e stand-in (see below). Skipped (with the reason) only when the
// fixtures could not be generated.
//
// Why matching by time (and the old 9-vs-10 flakiness): the fake devices start looping at getUserMedia, but the first
// analysed frame arrives a variable 1-6 s later (vision worker start-up, AudioWorklet module load), so a window of
// "duration + 2 s from the first frame" started at a random phase of the timeline. When it started inside a real
// swing's slot, that swing was seen half (no ADDRESS before it) and its next occurrence fell after the window: 9.
// audio.onsets (25/27/30) counts every onset since the detector started, so it varies with the same start-up delay.
// Now the fake camera carries a frame-index code (scripts/make_fixtures.mjs FRAME_CODE): the stand-in decodes it,
// the gate maps media time -> fixture time, and evaluates exactly one loop starting at a quiet slot boundary at least
// WARMUP_S after the first frame, so every event is inside the window exactly once, whatever the start-up delay.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { diag, watchPage, need, fixturePath, readJson, testidOrFail, Skip, waitFor } from './lib.mjs';

export const MATCH_S = 0.5;
export const LIMITS = Object.freeze({ recall_min: 0.9, false_max: 1, count_tol: 1 });
const WARMUP_S = 2;

// Pose stand-in (docs/e2e-hooks.md "gate m5"): the fake camera shows a bright disc, not a person, so MediaPipe finds
// no wrist. The app's live screen uses globalThis.__GSL_E2E__.pose instead of the vision worker when it is set before
// boot. This stand-in finds the disc in the real frame-tap bitmap (luma > 180 centroid) and reports it as both wrists
// in MediaPipe world coordinates (metres, y down). Frame tap, segment recorder, audio onsets, the live state machine
// and the diag records stay the app's own. Scale: the frame is FRAME_H_M metres tall, which keeps the fixture's
// motion (hands rise 0.5 frame heights) below the detector's motion-only "real swing" profile (rise >= 0.45 m), so
// the audio click is what separates a real swing from a practice swing - the gate tests audio fusion.
export const FRAME_H_M = 0.8;
export function installPoseStandIn({ frameH, code }) {
  globalThis.__GSL_E2E__ = {
    frames: 0, found: 0, log: [], codes: [],
    async pose(bitmap, t_s, _model, o) {
      const self = globalThis.__GSL_E2E__;
      self.frames += 1;
      const bw = bitmap.width, bh = bitmap.height;
      const c = new OffscreenCanvas(bw, bh);
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bitmap, 0, 0);
      bitmap.close?.();
      const d = g.getImageData(0, 0, bw, bh).data;
      // frame-index code of the fixture (fixture pixels -> bitmap pixels through the crop)
      if (code && self.codes.length < 6000) {
        const roi0 = o && o.crop && o.crop.roi ? o.crop.roi : null;
        const W0 = (o && o.crop && o.crop.W) || code.w, H0 = (o && o.crop && o.crop.H) || code.h;
        const sx = W0 / code.w, sy = H0 / code.h;
        const at = (X, Y) => {
          const fx = X * sx - (roi0 ? roi0.x : 0), fy = Y * sy - (roi0 ? roi0.y : 0);
          const bx = Math.floor((fx / (roi0 ? roi0.w : W0)) * bw), by = Math.floor((fy / (roi0 ? roi0.h : H0)) * bh);
          if (bx < 0 || by < 0 || bx >= bw || by >= bh) return NaN;
          const i = 4 * (by * bw + bx);
          return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        };
        let n = 0, par = 0, ok = true;
        for (let k = 0; k <= code.bits; k++) {
          const l = at(code.x0 + (k + 0.5) * code.cell, code.rows / 2);
          if (!Number.isFinite(l)) { ok = false; break; }
          const b = l > 125 ? 1 : 0;
          if (k < code.bits) { n |= b << k; par ^= b; } else if (b !== par) ok = false;
        }
        self.codes.push([t_s, ok ? n : -1]);
      }
      let sx = 0, sy = 0, n = 0;
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const i = 4 * (y * bw + x);
        if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] > 180) { sx += x + 0.5; sy += y + 0.5; n++; }
      }
      const img = new Float32Array(132).fill(NaN);
      const world = new Float32Array(99).fill(NaN);
      if (n < 4) return { t_s, img, world, ms: 0 };
      self.found += 1;
      if (self.log.length < 4000) self.log.push([t_s, 0, 0]);
      const roi = o && o.crop && o.crop.roi ? o.crop.roi : { x: 0, y: 0, w: bw, h: bh };
      const W = (o && o.crop && o.crop.W) || bw, H = (o && o.crop && o.crop.H) || bh;
      const u = (roi.x + (sx / n / bw) * roi.w) / W;
      const v = (roi.y + (sy / n / bh) * roi.h) / H;
      self.log[self.log.length - 1] = [t_s, u, v, performance.now()];
      for (const k of [15, 16]) {
        img[4 * k] = u; img[4 * k + 1] = v; img[4 * k + 2] = 0; img[4 * k + 3] = 1;
        world[3 * k] = (u - 0.5) * frameH * (W / H); world[3 * k + 1] = (v - 0.5) * frameH; world[3 * k + 2] = 0;
      }
      return { t_s, img, world, ms: 0 };
    },
  };
}

export const meta = { id: 'm5', title: 'M5 live mode auto-slicing on fake camera + audio', timeoutMs: 300000 };

export async function run(ctx) {
  const cam = fixturePath('m5_fake_cam.y4m');
  const mic = fixturePath('m5_fake_mic.wav');
  const truthFile = fixturePath('m5_truth.json');
  for (const f of [cam, mic, truthFile]) if (!fs.existsSync(f)) throw new Skip(`fixture ${f} not generated (run node scripts/make_fixtures.mjs)`);
  const truth = readJson(truthFile);
  if (!truth.video || !truth.video.frame_code) throw new Error('m5_truth.json has no video.frame_code: regenerate with node scripts/make_fixtures.mjs --only m5');
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${cam}`,
      `--use-file-for-fake-audio-capture=${mic}`, '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', permissions: ['camera', 'microphone'] });
    await context.addInitScript(installPoseStandIn, { frameH: FRAME_H_M, code: truth.video.frame_code ? { ...truth.video.frame_code, w: truth.video.w, h: truth.video.h } : null });
    if (process.env.M5_DUMP) {
      await context.addInitScript(() => {
        const AWN = globalThis.AudioWorkletNode;
        if (!AWN) return;
        globalThis.__onsetLog = [];
        globalThis.AudioWorkletNode = class extends AWN {
          constructor(...a) { super(...a); this.port.addEventListener('message', (ev) => { if (ev.data?.type === 'onset') globalThis.__onsetLog.push([performance.now(), ev.data.level_db, ev.data.t_ctx]); }); }
        };
      });
    }
    const page = await context.newPage();
    const w = watchPage(page);
    await page.goto(ctx.baseUrl);
    await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
    await diag.reset(page, ctx.baseUrl);

    await (await testidOrFail(page, 'btn-start-practice', 'the 開始練習 button on the home screen', 15000, ['#start-practice'])).click();
    // Leave setup without a calibration (a synthetic picture has no mat): e2e hook if the app has one, else the app's own
    // route home -> 「回到即時模式」 which is offered while a session is running.
    const hook = page.locator('[data-testid="btn-skip-setup"]').first();
    await page.locator('[data-screen="setup"]').waitFor({ state: 'visible', timeout: 30000 });
    if (await hook.count()) await hook.click();
    else {
      await page.locator('[data-screen="setup"] button:has-text("返回")').first().click();
      await page.locator('button:has-text("回到即時模式")').first().click({ timeout: 15000 })
        .catch(() => { throw new Error('no way to reach live mode: no [data-testid="btn-skip-setup"] and no 「回到即時模式」 button on home (see docs/e2e-hooks.md)'); });
    }
    await page.locator('[data-screen="live"]').waitFor({ state: 'visible', timeout: 60000 })
      .catch(() => { throw new Error('app never reached [data-screen="live"] after btn-start-practice (setup with the fake camera needs the btn-skip-setup hook, see docs/e2e-hooks.md)'); });

    // Observe one full loop from a quiet slot boundary (see the header): wait for the first frame with a decoded code,
    // fix the media->fixture offset, then wait until the frame tap has passed the end of the evaluation window.
    const liveAt = Date.now();
    await waitFor(() => page.evaluate(() => (globalThis.__GSL_E2E__?.codes ?? []).some((c) => c[1] >= 0)), { timeout: 60000, what: 'first frame with a decoded frame-index code through the live pose stand-in' });
    const firstAt = Date.now();
    const plan = await waitFor(async () => {
      const codes = await page.evaluate(() => globalThis.__GSL_E2E__.codes.slice());
      const clk = fixtureClock(codes, truth);
      return clk && clk.n >= 10 ? { clk, codes } : null;
    }, { timeout: 30000, interval: 500, what: '10 decoded frame codes' });
    const win = evalWindow(plan.clk, plan.codes[0][0], truth);
    await waitFor(() => page.evaluate((tEnd) => { const c = globalThis.__GSL_E2E__.codes; return c.length && c[c.length - 1][0] >= tEnd; }, win.end + 1.5),
      { timeout: (truth.duration_s + 30) * 1000, interval: 1000, what: `frame tap past the end of the evaluation window (media ${win.end.toFixed(1)} s)` });
    await page.waitForTimeout(500);
    const g = await diag.get(page, ctx.baseUrl, undefined);
    const st = await page.evaluate(() => ({ frames: globalThis.__GSL_E2E__?.frames, found: globalThis.__GSL_E2E__?.found, codes: globalThis.__GSL_E2E__?.codes }));
    if (process.env.M5_DUMP) fs.writeFileSync(process.env.M5_DUMP, JSON.stringify({ diag: g, win, clk: plan.clk, log: await page.evaluate(() => globalThis.__GSL_E2E__?.log), codes: st.codes, onsets: await page.evaluate(() => globalThis.__onsetLog) }));
    const live = (g && g.live) || {};
    need(st.frames > 0, `the live screen never called the e2e pose stand-in (globalThis.__GSL_E2E__.pose); frames=${st.frames} (docs/e2e-hooks.md)`);
    need(typeof live.detections === 'number', `diag live.detections not recorded (stand-in frames ${st.frames}, disc found ${st.found}, audio.onsets=${g.audio && g.audio.onsets}, live=${JSON.stringify(live)})`);
    need(Array.isArray(live.shot_log), 'diag live.shot_log missing (pipeline/live.js records every detected shot with its impact time)');
    const clk = fixtureClock(st.codes, truth);
    const m = scoreM5(live.shot_log, truth, clk, win);
    const audio = audioOffset(live.onset_log ?? [], truth, clk);
    const startup = `first coded frame ${((firstAt - liveAt) / 1000).toFixed(1)} s after the live screen at fixture phase ${clk.phase(st.codes[0][0]).toFixed(1)} s; window = fixture [${win.b.toFixed(0)} s, +${truth.duration_s} s) (media ${win.start.toFixed(1)}-${win.end.toFixed(1)}), clock residual p95 ${clk.res95.toFixed(3)} s over ${clk.n} frames`;
    const summary = `recall ${m.tp}/${m.nReal} = ${m.recall.toFixed(2)} (need >= ${LIMITS.recall_min}), false triggers ${m.falseTrig.length} (need <= ${LIMITS.false_max}${m.falseTrig.length ? `: ${m.falseTrig.map((f) => `${f.what}@${f.t.toFixed(1)}`).join(', ')}` : ''}), ` +
      `practice swings rejected ${m.practiceRejected}/${m.nPractice} (as practice ${m.practiceAsPractice}), neighbour sounds rejected ${m.neighborRejected}/${m.nNeighbor}; ` +
      `accepted swings in window ${m.swings} (vs ${m.nReal}, +-${LIMITS.count_tol}), practice detections ${m.practices}; impact |dt| median ${m.dtMed.toFixed(3)} s max ${m.dtMax.toFixed(3)} s; ` +
      `audio-video offset ${audio.median === null ? 'n/a' : `${audio.median.toFixed(3)} s (${audio.n} onsets, spread ${audio.spread.toFixed(3)} s)`} (output-timestamp mapping would add ${g.audio?.output_skew_ms ?? '?'} ms, input latency ${g.audio?.input_latency_ms ?? '?'} ms); ` +
      `session totals: live.detections ${live.detections}, practice ${live.practice}, audio.onsets ${g.audio && g.audio.onsets}; ${startup}${m.missed.length ? `; missed real at fixture ${m.missed.map((x) => x.toFixed(1)).join(', ')}` : ''}`;
    need(m.recall >= LIMITS.recall_min, `recall below ${LIMITS.recall_min}: ${summary}`);
    need(m.falseTrig.length <= LIMITS.false_max, `too many false triggers: ${summary}`);
    need(Math.abs(m.swings - m.nReal) <= LIMITS.count_tol, `accepted swings ${m.swings} vs ${m.nReal} real (limit +-${LIMITS.count_tol}): ${summary}`);
    need(g.gum && g.gum.calls === 1, `gum.calls ${g.gum && g.gum.calls} != 1`);
    need(live.touches_per_shot === 0, `touches_per_shot ${live.touches_per_shot} != 0`);
    need(w.errors.length === 0, `uncaught page errors: ${w.errors.slice(0, 3).join(' | ')}`);
    return `${summary}; gum.calls 1, touches 0, stand-in frames ${st.frames} (disc in ${st.found}) [pose = e2e disc stand-in, not MediaPipe]`;
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------------------------- scoring (pure)

const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const wrap = (x, P) => ((x % P) + P) % P;

/**
 * Media time <-> fixture time from decoded frame codes [[t_media, frame_index | -1]]. The fixture loops with period
 * duration_s; offset = circular median of (t_media - frame / fps) mod period. -> { off, P, n, res95, phase(t), loopStart(t) }
 */
export function fixtureClock(codes, truth) {
  const P = truth.duration_s;
  const fps = truth.video.fps;
  const ok = codes.filter((c) => c[1] >= 0 && c[1] < truth.video.frames);
  if (!ok.length) return null;
  const raw = ok.map((c) => wrap(c[0] - c[1] / fps, P));
  const ref = raw[0];
  const rel = raw.map((x) => wrap(x - ref + P / 2, P) - P / 2); // unwrap around the first sample
  const off = ref + median(rel);
  const res = rel.map((x) => Math.abs(x - (off - ref))).sort((a, b) => a - b);
  const res95 = res[Math.min(res.length - 1, Math.floor(0.95 * (res.length - 1)))];
  return { off, P, n: ok.length, res95, phase: (t) => wrap(t - off, P), loopStart: (t) => t - wrap(t - off, P) };
}

/** One loop [start, end) in media time beginning at the first quiet slot boundary >= t_first + WARMUP_S. */
export function evalWindow(clk, tFirst, truth) {
  const P = truth.duration_s;
  const starts = truth.events.map((e) => e.t_start_s);
  const bounds = [...new Set([0, ...starts, Math.max(...starts) + 4])].filter((b) => b < P).sort((a, b) => a - b); // slot boundaries = rest
  const t0 = tFirst + WARMUP_S;
  const ph = clk.phase(t0);
  let b = bounds.find((x) => x >= ph);
  let start;
  if (b === undefined) { b = bounds[0]; start = clk.loopStart(t0) + P + b; } else start = clk.loopStart(t0) + b;
  return { start, end: start + P, b };
}

/** Match accepted swings to real swings by impact time (|dt| <= MATCH_S, one-to-one, closest first). */
export function scoreM5(shotLog, truth, clk, win) {
  const occ = truth.events.map((e) => {
    let t = clk.loopStart(win.start) + e.t_impact_s;
    if (t < win.start) t += truth.duration_s;
    return { ...e, t };
  });
  // slot boundaries are rest periods and impacts sit 1.2 s into a slot, so [start, end) holds each impact exactly once
  const inWin = (shotLog || []).filter((d) => Number.isFinite(d.t_impact) && d.t_impact >= win.start && d.t_impact < win.end);
  const swings = inWin.filter((d) => d.kind === 'swing');
  const practices = inWin.filter((d) => d.kind === 'practice');
  const pairs = [];
  for (const [i, d] of swings.entries()) for (const [j, e] of occ.entries()) if (e.kind === 'real' && Math.abs(d.t_impact - e.t) <= MATCH_S) pairs.push([Math.abs(d.t_impact - e.t), i, j]);
  pairs.sort((a, b) => a[0] - b[0]);
  const usedD = new Set(), usedE = new Set(), dts = [];
  for (const [dt, i, j] of pairs) if (!usedD.has(i) && !usedE.has(j)) { usedD.add(i); usedE.add(j); dts.push(dt); }
  const near = (d, kind) => occ.find((e) => e.kind === kind && Math.abs(d.t_impact - e.t) <= MATCH_S);
  const falseTrig = swings.filter((_, i) => !usedD.has(i)).map((d) => ({ t: d.t_impact, what: near(d, 'practice') ? 'practice' : near(d, 'neighbor') ? 'neighbour' : near(d, 'real') ? 'duplicate' : 'nothing' }));
  const swingNear = (e) => swings.some((d) => Math.abs(d.t_impact - e.t) <= MATCH_S);
  const real = occ.filter((e) => e.kind === 'real');
  const prac = occ.filter((e) => e.kind === 'practice');
  const nb = occ.filter((e) => e.kind === 'neighbor');
  return {
    nReal: real.length, nPractice: prac.length, nNeighbor: nb.length, tp: usedE.size, recall: usedE.size / real.length,
    falseTrig, swings: swings.length, practices: practices.length,
    practiceRejected: prac.filter((e) => !swingNear(e)).length,
    practiceAsPractice: prac.filter((e) => practices.some((d) => Math.abs(d.t_impact - e.t) <= MATCH_S + 0.3)).length,
    neighborRejected: nb.filter((e) => !swingNear(e)).length,
    missed: occ.filter((e, j) => e.kind === 'real' && !usedE.has(j)).map((e) => e.t_impact_s),
    dtMed: dts.length ? median(dts) : NaN, dtMax: dts.length ? Math.max(...dts) : NaN,
  };
}

/** Loud onsets (media time) vs the fixture's clicks (real + neighbour impacts): median and spread of the offset. */
export function audioOffset(onsetLog, truth, clk) {
  const clicks = truth.events.filter((e) => e.kind !== 'practice').map((e) => e.t_impact_s);
  const d = [];
  for (const [t, lvl] of onsetLog) {
    if (!Number.isFinite(t) || !(lvl >= 20)) continue;
    const ph = clk.phase(t);
    let best = null;
    for (const c of clicks) { const x = wrap(ph - c + truth.duration_s / 2, truth.duration_s) - truth.duration_s / 2; if (best === null || Math.abs(x) < Math.abs(best)) best = x; }
    if (best !== null && Math.abs(best) < 1) d.push(best);
  }
  if (!d.length) return { median: null, n: 0, spread: 0 };
  const m = median(d);
  return { median: m, n: d.length, spread: Math.max(...d) - Math.min(...d) };
}
