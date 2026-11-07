// Gate v4-b-latency (V04-SPEC §G.3 V4-B acceptance 4): the quick read reaches the screen fast, in Chromium at CPU × 4.
// The m5 fixtures drive the real live chain: fake camera (bright disc + frame-index code) and fake microphone (impact
// clicks), the e2e pose stand-in seams of tests/e2e/m5.mjs (live loop) and d-platform.mjs (clip analysis) instead of
// MediaPipe; frame tap, onsets, the live detector, quick/live.js, quick/estimate.js, the card and the refined
// analysis are the app's own. For the first N_SWINGS (10, at least MIN_SWINGS = 8, see below) real swings:
//   * latency = media clock (the live <video>'s currentTime) when the provisional card was painted − the fixture's
//     impact time on the same media timeline (truth from m5_truth.json through the frame-code clock, NOT the app's own
//     impact time): median <= 1.5 s, max <= 2.5 s. Measured in the page by a MutationObserver on quick-card
//     (data-stage / data-t-impact), so it includes everything the page does after the frame reaches it. It does NOT
//     include the camera's capture-to-<video> delay (a fake device has none worth the name); the phone number comes
//     from the owner's device checklist (diag live.quick.latency_ms_p50 / _p95).
//     A second, independent figure is printed for the record: performance.now() at the paint − the time the impact
//     frame reached the pose stand-in.
//   * the same card turns data-stage="refined" for that swing, median <= 12 s after the quick card (the PF-2 d-latency
//     standard is a median; a swing queued behind another takes longer), unless a newer swing's quick read replaced it
//     first (newest-first analysis queue); at least half of the swings are refined in place
//   * every provisional tile with a number has .mt-ci and the 速報 tag text (quick.provisional, zh-Hant)
//   * a quick card for >= 90 % of the detected swings; <= 1 quick card on no real swing (a practice swing's, withdrawn)
//   * the quick backswing ci95 covers the fixture truth (0.9 s) in >= 90 % of the swings; downswing / tempo vs truth
//     and the refined shots' tempo are reported (both use the fake microphone's late onset as impact, see run())
//   * live segment timing (0.4.0 integration fix of a 0.3.0 bug: the segment start was the LAST tapped frame, a frame
//     or more before the recording really started, so every audio impact landed late in the clip: refined downswing
//     long, tempo low, 2.34 vs 3.0 here). Truth from the frame-index code the clip pose stand-in decodes in every
//     analysed clip frame (__GSL_E2E__.clip.codes, tagged with the live job, __GSL_E2E__.liveJobs):
//       - the recorded segment start vs where the clip really starts on the media timeline: median |error| <= 10 ms,
//         >= 90 % of jobs within one frame (+2 ms)
//       - the refined impact, put on the true media timeline, vs the live audio impact it was given: median |dt| <= 12 ms
//       - refined vs fixture truth (0.9 / 0.3 / 3.0) over the swings whose live audio onset itself is within 15 ms of the
//         fixture impact (Chromium's fake microphone drifts against the fake camera, see MIN_SWINGS; >= 3 swings):
//         median backswing within 0.05 s, downswing within 0.045 s, tempo within 0.45. Known residual biases: the top
//         is found ~1 frame (33 ms at the fixture's 30 fps) early on this sharp, asymmetric peak, which alone puts
//         downswing at ~0.33 and tempo at ~2.7; the 0.3.0 bug added another ~0.035 s (tempo ~2.4).
//   * diag has live.quick.latency_ms_p50; no uncaught page error
import fs from 'node:fs';
import path from 'node:path';
import { launch, watchPage, need, fixturePath, readJson, waitFor, diag, Skip, testidOrFail, ROOT } from '../lib.mjs';

export const meta = { id: 'v4-b-latency', title: 'V4-B quick read: impact -> provisional card median <= 1.5 s, max <= 2.5 s at CPU x4 (fake camera + mic, pose stand-in), refined in place <= 12 s, tiles with ± and the quick tag, diag live.quick', timeoutMs: 600000 };

export const N_SWINGS = Number(process.env.V4B_N) || 10;
// Chromium's fake microphone drifts against the fake camera under CPU × 4 (onset media times ~0.2 s late after ~2 min,
// so the 0.3.0 detector itself turns the later real swings into practice swings): the gate measures the first N_SWINGS
// real swings it gets and accepts no fewer than MIN_SWINGS.
export const MIN_SWINGS = 8;
export const LIMITS = Object.freeze({ median_s: 1.5, max_s: 2.5, refined_s: 12 });
const QUICK_ZH = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/i18n/zh-Hant/quick.json'), 'utf8'));

/** In-page recorder of quick-card stage changes (init script). */
export function installQuickRecorder() {
  const rec = (globalThis.__V4B__ = { log: [], last: '' });
  const video = () => document.querySelector('[data-screen="live"] video');
  const look = () => {
    const c = document.querySelector('[data-testid="quick-card"]');
    const key = c ? `${c.dataset.stage}|${c.dataset.tImpact}` : '';
    if (key === rec.last) return;
    rec.last = key;
    if (!c) { rec.log.push({ stage: null, perf: performance.now() }); return; }
    const tiles = [...c.querySelectorAll('.qc-tile')].map((t) => ({
      metric: t.dataset.metric, stage: t.dataset.stage, num: t.querySelector('.live-hero-num')?.textContent ?? '',
      ci: Boolean(t.querySelector('.mt-ci')), tag: t.querySelector('.qc-tag')?.textContent ?? '',
    }));
    rec.log.push({ stage: c.dataset.stage, t_impact: Number(c.dataset.tImpact), perf: performance.now(), media: video()?.currentTime ?? null, tiles });
  };
  const start = () => new MutationObserver(look).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-stage', 'data-t-impact'] });
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
}

export async function enterLive(page) {
  await (await testidOrFail(page, 'btn-start-practice', 'the start-practice button on home', 15000, ['#start-practice'])).click();
  await page.locator('[data-screen="setup"]').waitFor({ state: 'visible', timeout: 30000 });
  await (await testidOrFail(page, 'btn-skip-setup', 'e2e-only skip-setup button (rendered when __GSL_E2E__ is set)', 30000)).click();
  await page.locator('[data-screen="live"]').waitFor({ state: 'visible', timeout: 60000 });
}

/** Browser + context with the m5 fake devices and both pose stand-ins (and the quick recorder). */
export async function liveContext(ctx, { cpu = 4 } = {}) {
  const cam = fixturePath('m5_fake_cam.y4m');
  const mic = fixturePath('m5_fake_mic.wav');
  const truthFile = fixturePath('m5_truth.json');
  for (const f of [cam, mic, truthFile]) if (!fs.existsSync(f)) throw new Skip(`fixture ${f} not generated (node scripts/make_fixtures.mjs)`);
  const truth = readJson(truthFile);
  const { installPoseStandIn, FRAME_H_M } = await import('../m5.mjs');
  const { installClipPoseStandIn, CLIP_FRAME_H_M } = await import('./d-platform.mjs');
  const browser = await launch(ctx, { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${cam}`, `--use-file-for-fake-audio-capture=${mic}`, '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ serviceWorkers: 'block', permissions: ['camera', 'microphone'], viewport: { width: 390, height: 844 }, locale: 'zh-TW' });
  await context.addInitScript(installPoseStandIn, { frameH: FRAME_H_M, code: truth.video.frame_code ? { ...truth.video.frame_code, w: truth.video.w, h: truth.video.h } : null });
  await context.addInitScript(installClipPoseStandIn, { frameH: CLIP_FRAME_H_M, code: truth.video.frame_code ? { ...truth.video.frame_code, w: truth.video.w, h: truth.video.h } : null });
  await context.addInitScript(installQuickRecorder);
  const page = await context.newPage();
  const w = watchPage(page);
  await page.goto(ctx.baseUrl);
  await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
  if (cpu > 1) await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: cpu });
  await diag.reset(page, ctx.baseUrl);
  return { browser, context, page, w, truth };
}

const median = (a) => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
const wrap = (x, P) => ((x % P) + P) % P;

export const TIMING = Object.freeze({ t0_median_s: 0.010, frame_slack_s: 0.002, t0_in_frame_frac: 0.9, impact_median_s: 0.012, audio_good_s: 0.015,
  min_good: 3, backswing_s: 0.05, downswing_s: 0.045, tempo: 0.45 });

/**
 * Live segment timing against the frame-index code (pure; see the header). jobs = __GSL_E2E__.liveJobs, codes =
 * __GSL_E2E__.clip.codes [[job, t_clip, frame | -1]], shots [{ id, imp (refined impact, clip time), m: [bs, ds, tempo] }],
 * clk = m5 fixtureClock of the live frames. -> { rows: [{ job, t0_err, imp_dt, audio_err, m }], good, summary }
 */
export function segmentTiming({ jobs, codes, shots }, clk, truth) {
  const P = truth.duration_s, fps = truth.video.fps;
  const circ = (x) => wrap(x + P / 2, P) - P / 2;
  const realImp = truth.events.filter((e) => e.kind === 'real').map((e) => e.t_impact_s);
  const byJob = new Map();
  for (const [j, t, f] of codes) if (f >= 0 && f < truth.video.frames) { if (!byJob.has(j)) byJob.set(j, []); byJob.get(j).push(clk.off + f / fps - t); }
  const rows = [];
  jobs.forEach((jb, i) => {
    const raw = byJob.get(i + 1);
    if (!raw || !raw.length || !Number.isFinite(jb.t0)) return;
    const t0True = jb.t0 + median(raw.map((x) => circ(x - jb.t0)));
    const sh = shots.find((x) => x.id === jb.shot_id) ?? null;
    const audio = jb.impact_source === 'audio' && Number.isFinite(jb.t_impact);
    const imp_dt = audio && sh && Number.isFinite(sh.imp) ? t0True + sh.imp - jb.t_impact : null;
    const audio_err = audio ? realImp.map((r) => circ(clk.phase(jb.t_impact) - r)).sort((a, b) => Math.abs(a) - Math.abs(b))[0] : null;
    rows.push({ job: i + 1, t0_err: t0True - jb.t0, imp_dt, audio_err, m: sh ? sh.m : null });
  });
  const frame = 1 / fps;
  const e0 = rows.map((r) => Math.abs(r.t0_err));
  const di = rows.filter((r) => r.imp_dt !== null).map((r) => Math.abs(r.imp_dt));
  const good = rows.filter((r) => r.audio_err !== null && Math.abs(r.audio_err) <= TIMING.audio_good_s && r.m && r.m.every(Number.isFinite));
  const med = (k) => median(good.map((r) => r.m[k]));
  const out = { rows, good, n: rows.length, t0_med: median(e0), t0_in_frame: e0.filter((x) => x <= frame + TIMING.frame_slack_s).length,
    imp_med: median(di), n_imp: di.length, bs: med(0), ds: med(1), tempo: med(2) };
  out.summary = `segment timing over ${rows.length} jobs: |start error| median ${(out.t0_med * 1000).toFixed(1)} ms, within one frame ${out.t0_in_frame}/${rows.length} ` +
    `[${rows.map((r) => (r.t0_err * 1000).toFixed(0)).join(', ')} ms]; refined impact vs the live audio impact |dt| median ${(out.imp_med * 1000).toFixed(1)} ms over ${di.length}; ` +
    `audio-good swings ${good.length} (live onset within ${TIMING.audio_good_s * 1000} ms of the fixture; all: [${rows.map((r) => (r.audio_err === null ? '-' : (r.audio_err * 1000).toFixed(0))).join(', ')}] ms): ` +
    `refined median backswing ${out.bs.toFixed(3)} (0.9), downswing ${out.ds.toFixed(3)} (0.3), tempo ${out.tempo.toFixed(2)} (3.0)`;
  return out;
}

export async function run(ctx) {
  const { fixtureClock } = await import('../m5.mjs');
  const { browser, page, w, truth } = await liveContext(ctx, { cpu: Number(process.env.V4B_CPU) || 4 });
  try {
    await enterLive(page);
    const real = truth.events.filter((e) => e.kind === 'real');
    const P = truth.duration_s;
    // wait for N provisional quick reads (distinct impacts) and then for the refined analysis of the last of them
    const getLog = () => page.evaluate(() => globalThis.__V4B__.log.slice());
    const getClock = async () => fixtureClock(await page.evaluate(() => globalThis.__GSL_E2E__.codes.slice()), truth);
    /** provisional cards split into those of a real fixture swing (first per impact) and the others (practice etc.) */
    const classify = (log, clk) => {
      const out = { real: [], other: [] };
      if (!clk) return out;
      for (const p of log.filter((x) => x.stage === 'provisional')) {
        const ph = clk.phase(p.t_impact);
        const e = real.map((r) => ({ r, d: wrap(ph - r.t_impact_s + P / 2, P) - P / 2 })).sort((a, b) => Math.abs(a.d) - Math.abs(b.d))[0];
        if (e && Math.abs(e.d) <= 0.5) out.real.push({ p, e }); else out.other.push({ p, ph });
      }
      return out;
    };
    let got = null;
    await waitFor(async () => { got = classify(await getLog(), await getClock()); return got.real.length >= N_SWINGS; }, { timeout: (Number(process.env.V4B_WAIT_S) || 420) * 1000, interval: 2000, what: `${N_SWINGS} provisional quick cards of real swings` })
      .catch(() => { /* judged below: fewer swings when the fake devices drift (see MIN_SWINGS) */ });
    await page.waitForTimeout((LIMITS.refined_s + 2) * 1000);
    const log = await getLog();
    const clk = await getClock();
    const standIn = await page.evaluate(() => globalThis.__GSL_E2E__.log.slice());
    need(clk && clk.n >= 10, `frame-code clock not established (${clk?.n ?? 0} coded frames)`);
    const q = await diag.get(page, ctx.baseUrl, 'live.quick');
    const qlog = await diag.get(page, ctx.baseUrl, 'live.quick_log');
    const shotLog = (await diag.get(page, ctx.baseUrl, 'live.shot_log')) ?? [];
    got = classify(log, clk);
    const swingsDetected = shotLog.filter((x) => x.kind === 'swing').length;
    need(got.real.length >= MIN_SWINGS, `only ${got.real.length} quick cards of real swings (need ${N_SWINGS}, at least ${MIN_SWINGS}); detected swings ${swingsDetected}; other quick cards ${got.other.length}; diag live.quick ${JSON.stringify(q)}; shot_log ${JSON.stringify(shotLog)}`);

    const rows = [];
    for (const { p, e } of got.real.slice(0, N_SWINGS)) {
      const tTruth = p.t_impact - e.d; // fixture impact on the media timeline
      const latency = p.media - tTruth;
      // independent figure: performance.now() at the paint − when the first frame at/after the impact reached the stand-in
      const arr = standIn.find((x) => x[0] >= tTruth && Number.isFinite(x[3]));
      const lat2 = arr ? (p.perf - arr[3]) / 1000 : null;
      const i = log.indexOf(p);
      const after = log.slice(i + 1);
      const ref = after.find((x) => x.stage === 'refined' && Math.abs(x.t_impact - p.t_impact) < 1e-3);
      const refined_s = ref ? (ref.perf - p.perf) / 1000 : null;
      rows.push({ fixture_t: e.r.t_impact_s, latency, lat2, refined_s, superseded: !ref, tiles: p.tiles, impact_err: e.d });
    }
    const lat = rows.map((r) => r.latency);
    const med = median(lat);
    const max = Math.max(...lat);
    const refined = rows.filter((r) => r.refined_s !== null);
    // tempo against the fixture truth (every real m5 swing: address 0, top 0.9 s, impact 1.2 s -> 0.9 / 0.3 / 3.0).
    // The app's live.quick.miss compares the quick read with the refined shot; on this fixture the refined impact comes
    // from the fake microphone's onset, which runs late of the video by a varying 0.04–0.14 s (m5: audio-video offset),
    // so the refined downswing / tempo are off the truth too (backswing, video only, is not). Quick vs truth is the
    // meaningful check; its downswing / tempo share the same audio-offset impact and are reported, backswing is asserted.
    const TRUTH = { backswing_s: 0.9, downswing_s: 0.3, tempo_ratio: 3.0 };
    const qRows = (qlog ?? []).filter((x) => got.real.some(({ p }) => Math.abs(p.t_impact - x.t_impact) < 1e-3));
    const cover = Object.fromEntries(Object.entries(TRUTH).map(([id, v]) => {
      const xs = qRows.filter((x) => x[id]);
      return [id, { n: xs.length, in: xs.filter((x) => v >= x[id][1] && v <= x[id][2]).length, med: median(xs.map((x) => x[id][0])) }];
    }));
    const shotsAll = await page.evaluate(async () => (await globalThis.__GSL_E2E__.app.repo.queryShots({})).map((sh) => ({ id: sh.shot_id, imp: sh.events?.impact?.t_s ?? null,
      m: ['backswing_s', 'downswing_s', 'tempo_ratio'].map((id) => sh.metrics?.[id]?.value ?? null) })));
    const shotsT = shotsAll.map((x) => x.m);
    const timing = segmentTiming({ ...(await page.evaluate(() => ({ jobs: globalThis.__GSL_E2E__.liveJobs ?? [], codes: globalThis.__GSL_E2E__.clip?.codes ?? [] }))), shots: shotsAll }, clk, truth);
    const refT = ['backswing_s', 'downswing_s', 'tempo_ratio'].map((id, k) => `${id} ${median(shotsT.map((x) => x[k]).filter(Number.isFinite)).toFixed(3)}`).join(', ');
    const truthTxt = Object.entries(cover).map(([id, c]) => `${id} ci95 covers truth ${c.in}/${c.n} (median ${c.med.toFixed(3)} vs ${TRUTH[id]})`).join('; ');
    const summary = `CPU x4, ${rows.length} swings: impact -> provisional card (media clock) median ${med.toFixed(2)} s, max ${max.toFixed(2)} s ` +
      `[${lat.map((x) => x.toFixed(2)).join(', ')}]; impact frame at the page -> paint (perf) median ${median(rows.filter((r) => r.lat2 !== null).map((r) => r.lat2)).toFixed(2)} s; ` +
      `quick impact vs fixture |dt| median ${median(rows.map((r) => Math.abs(r.impact_err))).toFixed(3)} s; refined in place ${refined.length}/${rows.length} ` +
      `(${refined.map((r) => r.refined_s.toFixed(1)).join(', ')} s), not refined in place (a newer swing's quick read on screen) ${rows.filter((r) => r.superseded).length}; ` +
      `quick cards / detected swings ${got.real.length}/${swingsDetected}, quick cards of no real swing ${got.other.length} (practice swings, withdrawn); ` +
      `quick vs fixture truth: ${truthTxt}; refined shots (median of ${shotsT.length}): ${refT}; ` +
      `app diag live.quick ${JSON.stringify(q)} (miss = quick vs refined; the refined impact shares the fake microphone's drift, see above); ${timing.summary}`;
    need(med <= LIMITS.median_s, `median latency ${med.toFixed(2)} s > ${LIMITS.median_s} s: ${summary}`);
    need(max <= LIMITS.max_s, `max latency ${max.toFixed(2)} s > ${LIMITS.max_s} s: ${summary}`);
    need(got.other.length <= 1, `${got.other.length} quick cards on no real swing (> 1): ${summary}`);
    need(got.real.length >= 0.9 * swingsDetected, `quick cards for only ${got.real.length} of ${swingsDetected} detected swings: ${summary}`);
    need(refined.length >= Math.ceil(rows.length / 2), `only ${refined.length}/${rows.length} quick cards turned refined: ${summary}`);
    const refMed = median(refined.map((r) => r.refined_s));
    need(refMed <= LIMITS.refined_s, `refined median ${refMed.toFixed(1)} s after the quick card (> ${LIMITS.refined_s} s, the d-latency median): ${summary}`);
    for (const r of rows) {
      need(r.tiles.length >= 1, 'a provisional card without tiles');
      for (const t of r.tiles) {
        need(t.stage === 'provisional' && t.tag === QUICK_ZH.provisional, `tile ${t.metric}: stage ${t.stage}, tag "${t.tag}" (want "${QUICK_ZH.provisional}")`);
        if (t.num !== '—') need(t.ci, `tile ${t.metric} (${t.num}) has no ± range (.mt-ci)`);
      }
    }
    need(cover.backswing_s.n >= MIN_SWINGS && cover.backswing_s.in >= 0.9 * cover.backswing_s.n, `quick backswing ci95 covers the fixture truth in only ${cover.backswing_s.in}/${cover.backswing_s.n}: ${summary}`);
    need(timing.n >= MIN_SWINGS - 2, `segment timing measured on only ${timing.n} live jobs (clip frame codes): ${summary}`);
    need(timing.t0_med <= TIMING.t0_median_s, `recorded segment start off the real one by a median ${(timing.t0_med * 1000).toFixed(1)} ms (> ${TIMING.t0_median_s * 1000}): ${summary}`);
    need(timing.t0_in_frame >= TIMING.t0_in_frame_frac * timing.n, `segment start within one frame for only ${timing.t0_in_frame}/${timing.n} jobs: ${summary}`);
    need(timing.n_imp >= 3 && timing.imp_med <= TIMING.impact_median_s, `refined impact vs the live audio impact |dt| median ${(timing.imp_med * 1000).toFixed(1)} ms over ${timing.n_imp} (> ${TIMING.impact_median_s * 1000} ms, or < 3): ${summary}`);
    need(timing.good.length >= TIMING.min_good, `only ${timing.good.length} audio-good swings to judge refined tempo (need ${TIMING.min_good}): ${summary}`);
    need(Math.abs(timing.bs - 0.9) <= TIMING.backswing_s, `refined backswing median ${timing.bs.toFixed(3)} vs 0.9: ${summary}`);
    need(Math.abs(timing.ds - 0.3) <= TIMING.downswing_s, `refined downswing median ${timing.ds.toFixed(3)} vs 0.3 (> ${TIMING.downswing_s} s): ${summary}`);
    need(Math.abs(timing.tempo - 3.0) <= TIMING.tempo, `refined tempo median ${timing.tempo.toFixed(2)} vs 3.0 (> ${TIMING.tempo}): ${summary}`);
    need(q && Number.isFinite(q.latency_ms_p50), `diag live.quick.latency_ms_p50 missing: ${JSON.stringify(q)}`);
    need(Array.isArray(qlog) && qlog.length >= N_SWINGS, `diag live.quick_log has ${qlog?.length} entries`);
    need(w.errors.length === 0, `uncaught page errors: ${w.errors.slice(0, 3).join(' | ')}`);
    return `${summary} [pose = e2e disc stand-in, not MediaPipe; camera capture delay not included]`;
  } finally {
    await browser.close();
  }
}
