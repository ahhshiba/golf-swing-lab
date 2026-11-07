// Gate v4-e-video (V04-SPEC §G.3 V4-E 4): the tracer clip in Chromium, offline (context.setOffline(true)).
//  * clip fixtures: (a) a WebM recorded in the page with MediaRecorder — what live mode stores on Chromium / Android
//    (no duration in its header; <video> seek decoding); (b) when present, tests/fixtures/generated/clip_240_vp9.mp4
//    (mp4box + WebCodecs decoding; Playwright's Chromium cannot DECODE H.264, so the h264 fixture is not usable here).
//    The OUTPUT mime is whatever capture/recorder.js pickMimeType chooses: this Chromium build records mp4 (first
//    candidate); a build without mp4 recording gives webm — both are accepted (§G.3 V4-E 4).
//  * the shot: tests/fixtures/shots/v2/valid_face_on_240.json (tracks, flight); clip stored in app.repo.clips so the
//    sheet reads it the way the shot screen will
//  * ui/share.js openShareSheet → share-make → preview: blob 50 KB–15 MB, mime video/webm or video/mp4, a <video>
//    plays it and its duration is within 10 % of the time line; app mark defaults to off
//  * the share is a SECOND tap: nothing is shared by "make"; with navigator.share stubbed, share-send calls it once
//    with exactly 1 File; with navigator.share removed, share-send leaves a share-download link
//  * no page error, no request leaves the origin
// What only an iPhone can prove (docs/device-checklist.md): Safari records video/mp4 from captureStream, and that file
// plays in Photos and shares — the mime choice per engine is unit-tested in tests/unit/share.compose.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { launch, watchPage, need, waitFor, ROOT, fixturePath } from '../lib.mjs';

export const meta = { id: 'v4-e-video', title: 'V4-E: tracer clip offline (webm from MediaRecorder, vp9 mp4 when present): size, mime, duration vs time line, second-tap share, download fallback', timeoutMs: 300000 };

const SHOT = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/shots/v2/valid_face_on_240.json'), 'utf8'));

async function makeWebmClip(page) {
  // 3.0 s, 640 × 360, 60 fps drawing of a "swing" (moving bar) and a ball leaving at 1.83 s (the shot's impact)
  return page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 360;
    document.body.append(c);
    const g = c.getContext('2d');
    const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const stream = c.captureStream(60);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise((r) => { rec.onstop = r; });
    rec.start(200);
    const t0 = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        const t = (performance.now() - t0) / 1000;
        g.fillStyle = css('--surface-2'); g.fillRect(0, 0, 640, 360);
        g.fillStyle = css('--text'); g.fillRect(300 + 120 * Math.sin(t * 2), 80, 14, 200);
        const bx = t < 1.83 ? 330 : 330 + (t - 1.83) * 900;
        g.beginPath(); g.arc(bx, 300 - Math.max(0, t - 1.83) * 200, 6, 0, 7); g.fillStyle = css('--trail-6'); g.fill();
        if (t < 3) setTimeout(tick, 1000 / 60); else resolve();
      };
      tick();
    });
    rec.stop();
    await done;
    c.remove();
    const blob = new Blob(chunks, { type: 'video/webm' });
    globalThis.__v4eClip = blob;
    return blob.size;
  });
}

async function vp9Clip(page) {
  const truthFile = fixturePath('clip_240.json');
  if (!fs.existsSync(truthFile)) return null;
  const truth = JSON.parse(fs.readFileSync(truthFile, 'utf8'));
  const file = truth.files?.vp9 ? fixturePath(truth.files.vp9) : null;
  if (!file || !fs.existsSync(file)) return null;
  const b64 = fs.readFileSync(file).toString('base64');
  return page.evaluate((s) => {
    const bin = atob(s);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    globalThis.__v4eClip = new Blob([u8], { type: 'video/mp4' });
    return u8.length;
  }, b64);
}

async function runOne(page, label, notes) {
  // store the clip for the shot (as live / import would), then open the sheet the way ui/shot.js calls it
  await page.evaluate(async ([shot]) => {
    const app = globalThis.__GSL_E2E__.app;
    await app.repo.shots.put(shot);
    for (const c of await app.repo.clips.list({ index: 'shot_id', query: shot.shot_id })) await app.repo.clips.delete(c.clip_id);
    const blob = globalThis.__v4eClip;
    await app.repo.clips.put({ clip_id: `clip-v4e-${Date.now()}`, shot_id: shot.shot_id, session_id: shot.session_id, created_at: shot.created_at, kind: 'raw', mime: blob.type, bytes: blob.size, starred: false, blob });
    globalThis.__v4eShared = [];
    const m = await import(new URL('src/ui/share.js', location.href).href);
    globalThis.__v4eClosed = m.openShareSheet(app, { kind: 'shot', shot });
  }, [SHOT]);
  await page.locator('[data-testid="share-sheet"]').waitFor({ state: 'visible', timeout: 20000 });
  const probe = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="share-sheet"]')).getPropertyValue('--lazy-css').trim());
  need(probe === 'share', `${label}: lazy share.css not applied to the sheet (--lazy-css = ${JSON.stringify(probe)})`);
  const mark = await page.locator('[data-testid="share-opt-mark"]').getAttribute('aria-checked');
  need(mark === 'false', `${label}: app mark must default to off (aria-checked=${mark})`);
  // stub navigator.share BEFORE making: "make" must not share by itself
  await page.evaluate(() => {
    globalThis.__v4eShared = [];
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: (d) => Array.isArray(d?.files) && d.files.length > 0 });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (d) => { globalThis.__v4eShared.push({ n: d.files.length, name: d.files[0]?.name, type: d.files[0]?.type, size: d.files[0]?.size }); } });
  });
  const t0 = Date.now();
  await page.locator('[data-testid="share-make"]').click();
  await page.locator('[data-testid="share-progress"]').waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  // done = the preview shows, or the make button is usable again with the progress bar gone (an error is in the status)
  await waitFor(() => page.evaluate(() => {
    const r = document.querySelector('[data-testid="share-preview"]')?.closest('.share-result');
    const make = document.querySelector('[data-testid="share-make"]');
    const prog = document.querySelector('[data-testid="share-progress"]');
    return Boolean((r && !r.hidden) || (make && !make.disabled && prog?.hidden));
  }), { timeout: 120000, interval: 250, what: `${label}: video made` });
  const res = await page.evaluate(async () => {
    const r = document.querySelector('[data-testid="share-preview"]').closest('.share-result');
    const status = document.querySelector('[data-testid="share-status"]')?.textContent ?? '';
    if (r.hidden) return { ok: false, status };
    const v = document.createElement('video');
    v.muted = true;
    v.src = document.querySelector('[data-testid="share-preview"]').src;
    await new Promise((ok, bad) => { v.onloadedmetadata = ok; v.onerror = () => bad(new Error('video error')); setTimeout(() => bad(new Error('metadata timeout')), 10000); });
    if (!Number.isFinite(v.duration)) {
      const p = new Promise((ok) => { v.ondurationchange = ok; setTimeout(ok, 5000); });
      v.currentTime = 1e7;
      await p;
    }
    return { ok: true, status, mime: r.dataset.mime, bytes: Number(r.dataset.bytes), timeline: Number(r.dataset.duration), played: v.duration, w: v.videoWidth, h: v.videoHeight, shared: globalThis.__v4eShared.length };
  });
  need(res.ok, `${label}: no video (${res.status})`);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  need(/^video\/(webm|mp4)/.test(res.mime), `${label}: mime ${res.mime}`);
  need(res.bytes >= 50000 && res.bytes <= 15000000, `${label}: ${res.bytes} bytes outside 50 KB–15 MB`);
  need(res.timeline <= 12, `${label}: time line ${res.timeline} s > 12 s`);
  need(Number.isFinite(res.played) && Math.abs(res.played - res.timeline) <= 0.1 * res.timeline, `${label}: played duration ${res.played} s vs time line ${res.timeline} s (> 10 %)`);
  need(res.w === 720 && res.h === 1280, `${label}: video ${res.w}×${res.h}, expected portrait 720×1280`);
  need(res.shared === 0, `${label}: "make" shared by itself (${res.shared} calls)`);
  // second tap: share
  await page.locator('[data-testid="share-send"]').click();
  await waitFor(() => page.evaluate(() => globalThis.__v4eShared.length > 0), { timeout: 5000, interval: 100, what: `${label}: navigator.share called` });
  const sh = await page.evaluate(() => globalThis.__v4eShared);
  need(sh.length === 1 && sh[0].n === 1 && /^golf-swing-lab-tracer-\d{4}-\d{2}-\d{2}-\d{4}\.(webm|mp4)$/.test(sh[0].name) && sh[0].size === res.bytes, `${label}: share call ${JSON.stringify(sh)}`);
  // no Web Share: the download link
  await page.evaluate(() => { delete navigator.share; delete navigator.canShare; Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }); });
  await page.locator('[data-testid="share-send"]').click();
  await page.locator('[data-testid="share-download"]').waitFor({ state: 'attached', timeout: 5000 });
  const dl = await page.locator('[data-testid="share-download"]').getAttribute('download');
  need(/^golf-swing-lab-tracer-.*\.(webm|mp4)$/.test(dl ?? ''), `${label}: download name ${dl}`);
  notes.push(`${label}: ${res.mime}, ${(res.bytes / 1e6).toFixed(2)} MB, ${res.played.toFixed(2)} s played vs ${res.timeline.toFixed(2)} s time line, made in ${secs} s; share = 1 File on the 2nd tap; download link without Web Share`);
  await page.keyboard.press('Escape');
  await page.evaluate(() => globalThis.__v4eClosed);
}

export async function run(ctx) {
  const browser = await launch(ctx);
  const notes = [];
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
    await context.addInitScript(() => { globalThis.__GSL_E2E__ = globalThis.__GSL_E2E__ ?? {}; });
    const page = await context.newPage();
    const w = watchPage(page);
    await page.goto(ctx.baseUrl);
    await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
    await page.evaluate(() => globalThis.__GSL_E2E__.app.ready());
    // every module the sheet needs, loaded while online (the service worker is blocked in gates); then offline
    await page.evaluate(async () => {
      for (const p of ['src/ui/share.js', 'src/share/compose.js', 'src/share/card.js', 'src/share/timeline.js', 'src/share/trails.js', 'src/share/settings.js', 'src/lab/lines.js', 'src/lab/overlay.js', 'src/lab/settings.js']) await import(new URL(p, location.href).href).catch(() => {});
      await globalThis.__GSL_E2E__.app.loadStyles('share');
    });
    await context.setOffline(true);
    need(await page.evaluate(() => typeof MediaRecorder === 'function'), 'Chromium without MediaRecorder');

    const n = await makeWebmClip(page);
    need(n > 10000, `WebM fixture only ${n} bytes`);
    await runOne(page, 'webm clip (live-mode recording)', notes);

    const m = await vp9Clip(page);
    if (m) await runOne(page, 'vp9 mp4 clip (import, WebCodecs)', notes);
    else notes.push('vp9 mp4 fixture absent (node scripts/make_fixtures.mjs needs ffmpeg): only the WebM path ran');

    need(w.errors.length === 0, `page errors: ${w.errors.slice(0, 3).join(' | ')}`);
    need(w.external.length === 0, `requests left the origin: ${w.external.slice(0, 3).join(', ')}`);
    await context.close();
  } finally {
    await browser.close();
  }
  notes.push('NOT proven here (iPhone only): Safari mp4 recording from captureStream and that the file plays / shares from Photos');
  return notes.join('\n');
}
