// WP-D platform gates (PRODUCT-SPEC §4, §5, WP-D acceptance): storage-full keeps the shot, IndexedDB hang recovery,
// worker crash + timeout recovery, recorder segment bounds, offline-ready progress, truncated-file rejection, the
// Diagnostics crash log file, live analysis latency. Chromium only (WebKit cannot launch on this host; the iPhone list
// in WP-D covers the device side). Every gate serves the build in ctx.baseUrl and fails on uncaught page errors.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, watchPage, need, fixturePath, readJson, waitFor, diag, Skip, testidOrFail } from '../lib.mjs';

const VP9 = () => {
  const truth = readJson(fixturePath('clip_240.json'));
  const f = truth?.files?.vp9 ? fixturePath(truth.files.vp9) : null;
  if (!f || !fs.existsSync(f)) throw new Skip('clip_240 vp9 fixture not generated (node scripts/make_fixtures.mjs)');
  return f;
};

async function ready(page, base, timeout = 30000) {
  await page.goto(base);
  await page.locator('#app-ready').waitFor({ state: 'attached', timeout });
}

/** In-page catalog text (the app's own i18n module instance). */
const tr = (page, base, key, params = {}) => page.evaluate(async ([b, k, p]) => (await import(`${b}src/i18n/index.js`)).t(k, p), [base, key, params]);

/** shots / clips / poses counts and the stored shots, read straight from IndexedDB. */
async function idbDump(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const r = indexedDB.open('golf-swing-lab');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const db = r.result;
      const names = ['shots', 'clips', 'poses'].filter((n) => db.objectStoreNames.contains(n));
      const tx = db.transaction(names, 'readonly');
      const out = {};
      let left = names.length;
      for (const n of names) {
        const q = tx.objectStore(n).getAll();
        q.onsuccess = () => { out[n] = n === 'clips' ? q.result.map((c) => ({ clip_id: c.clip_id, bytes: c.bytes })) : n === 'poses' ? q.result.map((p) => p.shot_id) : q.result; if (--left === 0) { db.close(); resolve(out); } };
      }
    };
  }));
}

async function startImport(page, base, file) {
  const nav = page.locator('[data-testid="nav-import"], [data-testid="tabbar-import"]').first();
  if (await nav.count()) await nav.click();
  else await page.evaluate(() => document.querySelector('[data-go="import"]')?.click());
  await page.locator('[data-screen="import"]').waitFor({ state: 'visible', timeout: 15000 });
  const input = await testidOrFail(page, 'import-file-input', 'the video file input of the import screen', 15000, ['#import-file']);
  await input.setInputFiles(file);
  const go = await testidOrFail(page, 'import-start', 'the start-analysis button of the import screen', 15000);
  await waitFor(() => go.isEnabled(), { timeout: 20000, what: 'import-start enabled after the probe' });
  await go.click();
}

const visibleScreen = (page) => page.evaluate(() => [...document.querySelectorAll('[data-screen]')].find((e) => !e.hidden)?.dataset.screen ?? null);
const alertText = (page) => page.evaluate(() => [...document.querySelectorAll('[role="alert"]')].filter((e) => !e.hidden).map((e) => e.textContent).join(' | '));

// ------------------------------------------------------------------------------------------------- d-idb-hang

export const idbHang = {
  meta: { id: 'd-idb-hang', title: 'R3: indexedDB.open that never settles -> #app-ready within 6 s, repo unavailable, no hang', timeoutMs: 60000 },
  async run(ctx) {
    const browser = await launch(ctx);
    try {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
      await context.addInitScript(() => {
        const fake = () => { const req = { result: null, error: null, readyState: 'pending', addEventListener() {}, removeEventListener() {} }; return req; };
        try { Object.defineProperty(IDBFactory.prototype, 'open', { value: fake, configurable: true }); } catch (_) { indexedDB.open = fake; }
      });
      const page = await context.newPage();
      const w = watchPage(page);
      const t0 = Date.now();
      await page.goto(ctx.baseUrl);
      await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 15000 });
      const ms = Date.now() - t0;
      const repo = await page.evaluate(() => document.getElementById('app-ready')?.dataset.repo ?? null);
      const storeErr = await diag.get(page, ctx.baseUrl, 'store.error');
      const banner = await page.evaluate(() => { const b = document.querySelector('.repo-banner, #repo-banner'); return b ? { hidden: b.hidden, text: b.textContent.trim() } : null; });
      need(ms <= 6000, `#app-ready after ${ms} ms (> 6000)`);
      need(repo === '0' || /REPO_UNAVAILABLE|did not settle/.test(String(storeErr)), `repo not reported unavailable (app-ready data-repo=${repo}, diag store.error=${storeErr})`);
      need(w.errors.length === 0, `uncaught page errors: ${w.errors.slice(0, 3).join(' | ')}`);
      need(w.external.length === 0, `external requests: ${w.external.slice(0, 3).join(', ')}`);
      return `#app-ready ${ms} ms with indexedDB.open stubbed to never fire; data-repo=${repo}; store.error="${String(storeErr).slice(0, 80)}"; banner ${banner ? (banner.hidden ? 'hidden' : `"${banner.text}"`) : 'absent'}`;
    } finally {
      await browser.close();
    }
  },
};

// ---------------------------------------------------------------------------------------------------- d-quota

export const quota = {
  meta: { id: 'd-quota', title: 'R2/R7: 4 MB quota -> import stores the shot without its clip; card shows CLIP_NOT_SAVED', timeoutMs: 300000 },
  async run(ctx) {
    const file = VP9();
    const fx = readJson(path.join(path.dirname(fixturePath('x')), '..', 'shots', 'valid_face_on_240.json'));
    const browser = await launch(ctx);
    try {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
      // the analysis is WP-C/E's (c-import seam): a valid golf-shot/1 result comes back at once, so this gate tests only
      // the save path under a full disk; probe, queue, save and the card stay real
      await context.addInitScript((shot) => {
        globalThis.__GSL_E2E__ = {
          async analyzeClip(f, o) {
            const s = JSON.parse(JSON.stringify(shot));
            Object.assign(s, { shot_id: o.ids.shot_id, session_id: o.ids.session_id, venue_id: null, preset_id: null, created_at: o.ids.created_at });
            return { shot: s, timings_ms: {} };
          },
        };
      }, fx);
      const page = await context.newPage();
      const w = watchPage(page);
      await ready(page, ctx.baseUrl);
      const cdp = await context.newCDPSession(page);
      const origin = new URL(ctx.baseUrl).origin;
      await cdp.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: 4_000_000 });
      const est = await page.evaluate(() => navigator.storage.estimate());
      need(est.quota <= 4_000_000, `quota override not applied (${est.quota})`);
      const t0 = Date.now();
      await startImport(page, ctx.baseUrl, file);
      await waitFor(async () => (await visibleScreen(page)) === 'shot' || (await alertText(page)), { timeout: 240000, interval: 1000, what: 'the shot screen (or an error) after the import' });
      const scr = await visibleScreen(page);
      need(scr === 'shot', `import did not reach the shot screen under a 4 MB quota: ${await alertText(page)}`);
      const dump = await idbDump(page);
      need(dump.shots.length === 1, `stored shots ${dump.shots.length} != 1`);
      need(dump.clips.length === 0, `stored clips ${dump.clips.length} != 0 (the 5 MB clip cannot fit)`);
      const warn = dump.shots[0]?.quality?.warnings ?? [];
      need(warn.includes('CLIP_NOT_SAVED'), `stored shot warnings ${JSON.stringify(warn)} lack CLIP_NOT_SAVED`);
      const lastSave = await diag.get(page, ctx.baseUrl, 'store.last_save');
      const short = await tr(page, ctx.baseUrl, 'reason.CLIP_NOT_SAVED.short');
      const long = await tr(page, ctx.baseUrl, 'reason.CLIP_NOT_SAVED.long');
      // the reason may sit behind the shot card's Notice disclosure (WP-C, ui/shot.js); the notice itself must be
      // visible, and one tap on its summary (what a user does) must reveal the reason as rendered text
      // the shot screen loads the stored shot asynchronously after it becomes visible: wait for the card to render
      await waitFor(async () => (await page.locator('[data-screen="shot"] [data-testid="shot-hero"], [data-screen="shot"] .empty-state').count()) > 0,
        { timeout: 15000, what: 'the shot card (shot-hero) to render' });
      const notes = page.locator('[data-screen="shot"] [data-testid="shot-notices"]');
      let text = await page.locator('[data-screen="shot"]').innerText();
      let tapped = false;
      if (!(text.includes(short) || text.includes(long)) && await notes.count()) {
        need(await notes.first().isVisible(), 'the shot-notices Notice is not visible');
        if (await notes.first().evaluate((el) => el.tagName === 'DETAILS' && !el.open)) {
          await notes.first().locator('summary').first().click();
          tapped = true;
        }
        text = await page.locator('[data-screen="shot"]').innerText();
      }
      const nInfo = await notes.count() ? await notes.first().evaluate((el) => `${el.tagName.toLowerCase()} open=${el.open} text="${el.textContent.slice(0, 200)}"`) : `no shot-notices element; screen text "${text.slice(0, 300).replace(/\s+/g, " ")}"`;
      need(text.includes(short) || text.includes(long), `the shot card does not show the CLIP_NOT_SAVED reason ("${short}"; ${nInfo}) (rendering is WP-C's; the stored shot carries the code)`);
      need(w.errors.length === 0, `uncaught page errors: ${w.errors.slice(0, 3).join(' | ')}`);
      return `quota ${est.quota} B, 5.1 MB clip: 1 shot, 0 clips; warnings ${warn.join(',')}; last_save ${JSON.stringify(lastSave)}; card shows "${short}"${tapped ? ' (after one tap on the Notice summary)' : ''}; ${((Date.now() - t0) / 1000).toFixed(1)} s [analysis = c-import seam with a fixture shot]`;
    } finally {
      await browser.close();
    }
  },
};

// ---------------------------------------------------------------------------------------------- d-worker-crash

export const workerCrash = {
  meta: { id: 'd-worker-crash', title: 'R5: worker crash mid-import -> WORKER_CRASHED, recreated, second import OK; stalled pose -> ANALYSIS_TIMEOUT', timeoutMs: 420000 },
  async run(ctx) {
    const file = VP9();
    const browser = await launch(ctx);
    try {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
      await context.addInitScript(() => { globalThis.__GSL_E2E__ = globalThis.__GSL_E2E__ ?? {}; });
      const page = await context.newPage();
      const w = watchPage(page);
      const requests = [];
      page.on('request', (r) => requests.push(r.url()));
      await ready(page, ctx.baseUrl);
      await startImport(page, ctx.baseUrl, file);
      // wait until the worker is busy with the clip, then make it throw an uncaught error
      await waitFor(() => page.evaluate(() => (globalThis.__GSL_E2E__?.vision?.pending?.() ?? 0) > 0), { timeout: 60000, what: 'the vision client to have a pending clip job' });
      await page.waitForTimeout(200);
      need(await page.evaluate(() => globalThis.__GSL_E2E__.vision.pending() > 0), 'the clip finished before the crash could be injected');
      const crashedAt = Date.now();
      await page.evaluate(() => globalThis.__GSL_E2E__.vision.crashForTest());
      const crashedText = await tr(page, ctx.baseUrl, 'error.WORKER_CRASHED');
      const screenText = async () => `${await alertText(page)} | ${await page.locator('[data-screen="import"]').innerText().catch(() => '')}`;
      await waitFor(async () => (await screenText()).includes(crashedText), { timeout: 20000, what: `the error "${crashedText}" on screen after the crash (client stats ${JSON.stringify(await page.evaluate(() => globalThis.__GSL_E2E__?.vision?.stats?.()))})` });
      const crashMs = Date.now() - crashedAt;
      const st1 = await page.evaluate(() => globalThis.__GSL_E2E__.vision.stats());
      need(st1.crashes === 1, `client crash count ${st1.crashes}`);
      need((await visibleScreen(page)) === 'import', 'left the import screen after the crash');
      // second import on the recreated worker
      await waitFor(() => page.evaluate(() => globalThis.__GSL_E2E__.vision.state() === 'ok'), { timeout: 10000, what: 'the worker to be recreated' });
      // the recreated worker analyses the same clip end to end
      await page.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'd-crash-file'; i.hidden = true; document.body.append(i); });
      await page.setInputFiles('#d-crash-file', file);
      const t2 = Date.now();
      const direct = await page.evaluate(async (b) => {
        const f = document.getElementById('d-crash-file')?.files?.[0];
        if (!f) return { ok: false, why: 'no file in the import input' };
        try {
          const r = await globalThis.__GSL_E2E__.vision.analyzeClip(f, { view: 'face_on', calibration: null, handedness: 'right', ids: { shot_id: 'shot-d-crash', session_id: 'sess-d', venue_id: null, preset_id: null, created_at: new Date().toISOString(), app_version: 'e2e' }, club: { type: '7i', length_m: 0.94, lie: 'mat', tee_lift_m: null, tee_lift_source: 'assumed' }, mode: 'highspeed', source: 'import', allowNoSwing: true, pose_model: 'lite', warnings: [] });
          return { ok: Boolean(r && r.shot && r.shot.shot_id === 'shot-d-crash'), outcome: 'golf-shot/1' };
        } catch (e) { return { ok: e.code === 'NO_SWING_FOUND', outcome: e.code, code: e.code, detail: e.detail }; }
      }, ctx.baseUrl);
      // an analysis outcome (a shot, or NO_SWING_FOUND after a full pose pass when the rules find no swing in the
      // synthetic fixture: WP-E's call) proves the recreated worker works; a crash / timeout / unavailable does not
      const lastJob = await diag.get(page, ctx.baseUrl, 'worker.last_job');
      need(direct.ok && lastJob?.pose_frames > 0, `second analysis on the recreated worker failed: ${JSON.stringify(direct)} (last job ${JSON.stringify(lastJob)})`);
      const second = (Date.now() - t2) / 1000;
      // and through the import screen: the job runs to an analysis outcome (shot or an analysis error), never a crash
      const go = page.locator('[data-testid="import-start"]').first();
      let uiOutcome = 'not retried (no enabled import-start)';
      await page.locator('[data-testid="import-file-input"]').first().setInputFiles(file);
      await waitFor(() => go.isEnabled(), { timeout: 20000, what: 'import-start enabled for the second import' }).catch(() => null);
      if (await go.count() && await go.isEnabled()) {
        await go.click();
        await page.waitForTimeout(1000);
        await waitFor(async () => (await visibleScreen(page)) === 'shot' || (await page.evaluate(() => globalThis.__GSL_E2E__.vision.pending())) === 0, { timeout: 240000, interval: 1000, what: 'the second UI import to finish' });
        const a = await screenText();
        need((await page.evaluate(() => globalThis.__GSL_E2E__.vision.stats().crashes)) === 1, `second UI import crashed again: ${a}`);
        uiOutcome = (await visibleScreen(page)) === 'shot' ? 'shot screen' : `analysis outcome on the import screen "${a.replace(/\s+/g, ' ').slice(0, 80)}"`;
      }
      const st2 = await page.evaluate(() => globalThis.__GSL_E2E__.vision.stats());
      need(st2.restarts === 1 && st2.state === 'ok' && st2.crashes === 1, `restarts ${st2.restarts}, crashes ${st2.crashes}, state ${st2.state}`);
      // stalled pose: every message to the worker is delayed 7 s -> the 5 s pose timeout fires
      const pose = await page.evaluate(async () => {
        const hooks = globalThis.__GSL_E2E__;
        hooks.workerDelayMs = 7000;
        const bm = await createImageBitmap(new ImageData(64, 48));
        const t = performance.now();
        try { await hooks.vision.pose(bm, 0.1, 'lite'); return { ok: true, ms: performance.now() - t }; } catch (e) { return { ok: false, code: e.code, ms: performance.now() - t }; } finally { hooks.workerDelayMs = 0; }
      });
      need(!pose.ok && pose.code === 'ANALYSIS_TIMEOUT', `stalled pose: ${JSON.stringify(pose)}`);
      need(pose.ms >= 4500 && pose.ms <= 7000, `pose timeout after ${Math.round(pose.ms)} ms (expected ~5000)`);
      const tcnReq = requests.filter((u) => /models\/event-tcn-v1\./.test(u));
      need(tcnReq.length === 0, `requests to the event model in a no-model build: ${tcnReq.join(', ')}`);
      const unexpected = w.errors.filter((e) => !/e2e: simulated worker crash/.test(e));
      need(unexpected.length === 0, `uncaught page errors: ${unexpected.slice(0, 3).join(' | ')}`);
      need(w.external.length === 0, `external requests: ${w.external.slice(0, 3).join(', ')}`);
      return `crash -> "${crashedText}" after ${crashMs} ms, worker recreated (restarts ${st2.restarts}); second analysis of the clip on it -> ${direct.outcome} after ${lastJob.pose_frames} pose frames in ${second.toFixed(1)} s; UI re-import -> ${uiOutcome}; stalled pose -> ANALYSIS_TIMEOUT after ${Math.round(pose.ms)} ms; 0 event-model requests`;
    } finally {
      await browser.close();
    }
  },
};

// -------------------------------------------------------------------------------------------------- d-trunc

export const trunc = {
  meta: { id: 'd-trunc', title: 'R9: a truncated MP4 is refused with FILE_TRUNCATED (probe + analysis), not a silent pass', timeoutMs: 180000 },
  async run(ctx) {
    const src = VP9();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsl-trunc-'));
    const file = path.join(dir, 'trunc.mp4');
    const buf = fs.readFileSync(src);
    fs.writeFileSync(file, buf.subarray(0, Math.floor(buf.length * 0.58)));
    const browser = await launch(ctx);
    try {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      const w = watchPage(page);
      await ready(page, ctx.baseUrl);
      const probe = await page.evaluate(async ([b, bytes]) => {
        const { probeFile } = await import(`${b}src/import/probe.js`);
        const blob = new Blob([new Uint8Array(bytes)], { type: 'video/mp4' });
        const p = await probeFile(blob);
        return { truncated: p.truncated, file: p.file_bytes, table: p.table_end_bytes, samples: p.sample_count };
      }, [ctx.baseUrl, [...fs.readFileSync(file)]]);
      need(probe.truncated === true, `probe did not flag the file: ${JSON.stringify(probe)}`);
      await startImport(page, ctx.baseUrl, file).catch(async (e) => {
        // a probe-aware import screen may refuse the file before analysis (import-start disabled): that is fine too
        if (!/import-start enabled/.test(e.message)) throw e;
      });
      const want = await tr(page, ctx.baseUrl, 'error.FILE_TRUNCATED');
      await waitFor(async () => (await page.locator('[data-screen="import"]').innerText()).includes(want) || (await alertText(page)).includes(want), { timeout: 60000, what: `"${want}" on the import screen` });
      need((await visibleScreen(page)) === 'import', 'a truncated file must not open a result');
      const shots = (await idbDump(page)).shots.length;
      need(shots === 0, `${shots} shot(s) stored from a truncated file`);
      need(w.errors.length === 0, `uncaught page errors: ${w.errors.slice(0, 3).join(' | ')}`);
      return `trunc copy ${probe.file} B of ${buf.length} (sample table ends at ${probe.table} B, ${probe.samples} samples): probe truncated=true, import shows "${want}", 0 shots stored`;
    } finally {
      await browser.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
};

// ------------------------------------------------------------------------------------------------ d-offline

export const offline = {
  meta: { id: 'd-offline', title: 'R11/PF-1: the service worker posts PRECACHE_PROGRESS (done increasing) and the app reports offline-ready; no event-model request', timeoutMs: 240000 },
  async run(ctx) {
    const browser = await launch(ctx);
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await context.addInitScript(() => {
        // e2e seam (docs/e2e-hooks.md): main.js exposes the app as __GSL_E2E__.app when this exists before boot
        globalThis.__GSL_E2E__ ??= {};
        globalThis.__pc = [];
        navigator.serviceWorker?.addEventListener('message', (ev) => { if (/^PRECACHE_/.test(ev.data?.type ?? '')) globalThis.__pc.push({ ...ev.data, t: performance.now() }); });
      });
      const page = await context.newPage();
      const w = watchPage(page);
      const requests = [];
      page.on('request', (r) => requests.push(r.url()));
      const t0 = Date.now();
      await ready(page, ctx.baseUrl);
      await waitFor(() => page.evaluate(() => globalThis.__pc.some((m) => m.type === 'PRECACHE_DONE')), { timeout: 180000, interval: 500, what: 'PRECACHE_DONE from the service worker' });
      const secs = (Date.now() - t0) / 1000;
      const msgs = await page.evaluate(() => globalThis.__pc);
      const prog = msgs.filter((m) => m.type === 'PRECACHE_PROGRESS');
      need(prog.length >= 3, `only ${prog.length} PRECACHE_PROGRESS messages`);
      for (let i = 1; i < prog.length; i++) need(prog[i].done >= prog[i - 1].done, `done went down: ${prog[i - 1].done} -> ${prog[i].done}`);
      need(prog.at(-1).done > prog[0].done, 'done never increased');
      const done = msgs.find((m) => m.type === 'PRECACHE_DONE');
      need(done.done === done.total && done.total > 0, `PRECACHE_DONE ${done.done}/${done.total}`);
      const tracker = await waitFor(() => page.evaluate(async (b) => {
        const m = await import(`${b}src/ui/update.js`);
        const tk = m.offlineTracker();
        return tk && tk.ready() ? { ready: true, progress: tk.progress() } : null;
      }, ctx.baseUrl), { timeout: 15000, what: 'offline tracker ready()' });
      // PRODUCT-SPEC §8.0.4 / WP-D acceptance: app.offline IS the tracker and reports ready() === true after completion
      const appOffline = await waitFor(() => page.evaluate(async (b) => {
        const a = globalThis.__GSL_E2E__?.app;
        const tk = (await import(`${b}src/ui/update.js`)).offlineTracker();
        return a && a.offline && a.offline.ready() === true ? { ready: true, same: a.offline === tk } : null;
      }, ctx.baseUrl), { timeout: 15000, what: 'app.offline.ready() === true (main.js must set app.offline to the updater\'s offline tracker, ui/update.js)' })
        .catch(async (e) => {
          const st = await page.evaluate(() => { const a = globalThis.__GSL_E2E__?.app; return a ? { hasOffline: Boolean(a.offline), ready: a.offline?.ready?.() ?? null, updaterOffline: Boolean(a.updater?.offline), sameAsUpdater: a.offline === a.updater?.offline } : 'no __GSL_E2E__.app'; });
          throw new Error(`${e.message}: ${JSON.stringify(st)}`);
        });
      need(appOffline.same, 'app.offline is not the offline tracker of ui/update.js');
      // after a reload the tracker must know from the caches (GET_PRECACHE -> PRECACHE_STATUS)
      await page.reload();
      await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
      const again = await waitFor(() => page.evaluate(async (b) => {
        const tk = (await import(`${b}src/ui/update.js`)).offlineTracker();
        const a = globalThis.__GSL_E2E__?.app;
        return tk && tk.ready() && a?.offline?.ready() === true ? tk.progress() : null;
      }, ctx.baseUrl), { timeout: 15000, what: 'offline-ready (tracker and app.offline) after a reload (PRECACHE_STATUS)' });
      const tcnReq = requests.filter((u) => /models\/event-tcn-v1\./.test(u));
      need(tcnReq.length === 0, `event-model requests: ${tcnReq.join(', ')}`);
      need(w.errors.length === 0, `uncaught page errors: ${w.errors.slice(0, 3).join(' | ')}`);
      need(w.external.length === 0, `external requests: ${w.external.slice(0, 3).join(', ')}`);
      return `${prog.length} PRECACHE_PROGRESS (done ${prog[0].done} -> ${prog.at(-1).done} of ${done.total}, ${(done.bytes / 1e6).toFixed(1)} MB) + PRECACHE_DONE in ${secs.toFixed(1)} s; tracker ready (${tracker.progress.done}/${tracker.progress.total}); after reload ready ${again.done}/${again.total}; app.offline.ready()=true (same object as the tracker) before and after the reload; 0 event-model requests`;
    } finally {
      await browser.close();
    }
  },
};

// ------------------------------------------------------------------------------------------------ d-diag

/** Home's nav-diag (WP-B), else Settings -> settings-diag (WP-F). */
async function openDiag(page) {
  const direct = page.locator('[data-testid="nav-diag"]').first();
  if (await direct.count() && await direct.isVisible()) { await direct.click(); return; }
  const settings = page.locator('[data-testid="tabbar-settings"], [data-testid="nav-settings"]').first();
  if (await settings.count()) await settings.click();
  await (await testidOrFail(page, 'settings-diag', 'the Diagnostics row (home nav-diag or settings-diag)', 15000)).click();
}

export const diagSave = {
  meta: { id: 'd-diag', title: 'R12/V19: Diagnostics summary rows (icon + text), last error listed, diag-save writes JSON with events[]', timeoutMs: 120000 },
  async run(ctx) {
    const browser = await launch(ctx);
    const shotsDir = process.env.GSL_SHOTS_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), '..', '.shots');
    fs.mkdirSync(shotsDir, { recursive: true });
    const notes = [];
    try {
      for (const [locale, scheme] of [['zh-TW', 'light'], ['zh-TW', 'dark'], ['en-US', 'light'], ['en-US', 'dark']]) {
        const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, locale, colorScheme: scheme, acceptDownloads: true });
        const page = await context.newPage();
        const w = watchPage(page);
        await ready(page, ctx.baseUrl);
        // an error reaches the crash log the way a real one does (global handler -> app.errors.report -> logEvent)
        await page.evaluate(() => { setTimeout(() => { throw Object.assign(new Error('d-diag probe'), { code: 'ANALYSIS_TIMEOUT' }); }, 0); });
        await page.waitForTimeout(300);
        await page.evaluate(() => document.querySelector('[data-alert-close], #toast-alert button')?.click());
        await openDiag(page);
        await page.locator('[data-screen="diag"] [data-testid="diag-summary"]').waitFor({ state: 'visible', timeout: 30000 });
        const rows = await page.evaluate(() => [...document.querySelectorAll('[data-screen="diag"] [data-testid="diag-summary"] .list-row')].map((r) => ({
          id: r.dataset.row, icon: Boolean(r.querySelector('.lr-icon svg, .lr-icon .icon')), title: r.querySelector('.lr-title')?.textContent.trim(), value: r.querySelector('.lr-value')?.textContent.trim(), sub: r.querySelector('.lr-sub')?.textContent.trim(),
        })));
        need(rows.length >= 8, `${locale}/${scheme}: only ${rows.length} summary rows`);
        for (const r of rows) need(r.icon && r.title && r.value && r.sub, `${locale}/${scheme}: summary row ${r.id} lacks icon/title/value/state text: ${JSON.stringify(r)}`);
        const errText = await tr(page, ctx.baseUrl, 'error.ANALYSIS_TIMEOUT');
        const errs = await page.locator('[data-screen="diag"] [data-testid="diag-errors"]').innerText().catch(() => '');
        need(errs.includes(errText), `${locale}/${scheme}: recent errors do not list "${errText}" (${errs.slice(0, 120)})`);
        await page.evaluate(() => { document.querySelector('#toast-alert')?.setAttribute('hidden', ''); window.scrollTo(0, 0); });
        await page.screenshot({ path: path.join(shotsDir, `d-diag-${locale}-${scheme}.png`), fullPage: true });
        const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.locator('[data-testid="diag-save"]').click()]);
        const p = path.join(os.tmpdir(), `gsl-diag-${Date.now()}.json`);
        await dl.saveAs(p);
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        fs.rmSync(p, { force: true });
        need(Array.isArray(j.events) && j.events.some((e) => e.code === 'ANALYSIS_TIMEOUT' && e.kind === 'error'), `${locale}/${scheme}: saved file events[] lacks the error: ${JSON.stringify(j.events).slice(0, 200)}`);
        need(/^golf-swing-lab-diag-\d{8}-\d{4}\.json$/.test(dl.suggestedFilename()), `file name ${dl.suggestedFilename()}`);
        const { noHScroll, noSpecCodes, minTargets, noCJK } = await import('../checks.mjs');
        for (const [name, fn] of [['noHScroll', noHScroll], ['noSpecCodes', noSpecCodes], ['minTargets', (pg) => minTargets(pg, 44)], ...(locale === 'en-US' ? [['noCJK', noCJK]] : [])]) {
          const r = await fn(page);
          const bad = Array.isArray(r) ? r : (r && r.ok === false ? [r] : []);
          need(!bad.length, `${locale}/${scheme}: ${name}: ${JSON.stringify(bad).slice(0, 300)}`);
        }
        const unexpected = w.errors.filter((e) => !/d-diag probe/.test(e));
        need(unexpected.length === 0, `${locale}/${scheme}: uncaught page errors: ${unexpected.slice(0, 3).join(' | ')}`);
        notes.push(`${locale}/${scheme}: ${rows.length} rows, file ${dl.suggestedFilename()} with ${j.events.length} event(s)`);
        await context.close();
      }
      return notes.join('; ');
    } finally {
      await browser.close();
    }
  },
};

// ------------------------------------------------------------------------------------- live gates (fake camera)

const POSE_NAN = () => {
  globalThis.__GSL_E2E__ = {
    frames: 0,
    async pose(bitmap, t_s) { this.frames += 1; try { bitmap.close?.(); } catch (_) { /* closed */ } return { t_s, img: new Float32Array(132).fill(NaN), world: new Float32Array(99).fill(NaN), ms: 0 }; },
  };
};

async function enterLive(page) {
  await (await testidOrFail(page, 'btn-start-practice', 'the start-practice button on home', 15000, ['#start-practice'])).click();
  await page.locator('[data-screen="setup"]').waitFor({ state: 'visible', timeout: 30000 });
  const skip = await testidOrFail(page, 'btn-skip-setup', 'e2e-only skip-setup button (rendered when __GSL_E2E__ is set)', 30000);
  await skip.click();
  await page.locator('[data-screen="live"]').waitFor({ state: 'visible', timeout: 60000 });
}

export const recorder = {
  meta: { id: 'd-recorder', title: 'R6/PF-3/PF-5: 120 s idle live -> no segment > 12 s, <= 2 retained blobs, heap stable, capture width <= 1280', timeoutMs: 300000 },
  async run(ctx) {
    const browser = await launch(ctx, { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--js-flags=--expose-gc'] });
    try {
      const context = await browser.newContext({ serviceWorkers: 'block', permissions: ['camera', 'microphone'], viewport: { width: 390, height: 844 } });
      await context.addInitScript(POSE_NAN);
      const page = await context.newPage();
      const w = watchPage(page);
      await ready(page, ctx.baseUrl);
      await diag.reset(page, ctx.baseUrl);
      await enterLive(page);
      const cdp = await context.newCDPSession(page);
      const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); const m = await cdp.send('Runtime.getHeapUsage'); return m.usedSize / 1048576; };
      await waitFor(() => page.evaluate(() => (globalThis.__GSL_E2E__?.frames ?? 0) > 20), { timeout: 60000, what: 'live frames reaching the pose stand-in' });
      await page.waitForTimeout(20000);
      const h0 = await heap();
      const samples = [];
      for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(10000);
        samples.push({ seg: await diag.get(page, ctx.baseUrl, 'recorder.segments'), retained: await diag.get(page, ctx.baseUrl, 'live.retained_blobs') });
      }
      const h1 = await heap();
      const seg = await diag.get(page, ctx.baseUrl, 'recorder.segments');
      const gum = await diag.get(page, ctx.baseUrl, 'gum');
      const settings = await page.evaluate(() => { const v = document.querySelector('[data-screen="live"] video'); const tr = v?.srcObject?.getVideoTracks?.()[0]; return tr ? tr.getSettings() : null; });
      const frames = await page.evaluate(() => globalThis.__GSL_E2E__.frames);
      need(seg && seg.segments >= 10, `recorder.segments ${JSON.stringify(seg)}: expected >= 10 cut segments in 120 s idle`);
      need(seg.max_s <= 12, `a segment of ${seg.max_s} s (> 12 s)`);
      const maxRetained = Math.max(0, ...samples.map((s) => s.retained ?? 0));
      need(maxRetained <= 2, `retained blobs ${maxRetained} (> 2)`);
      need(h1 - h0 <= 2, `JS heap grew ${(h1 - h0).toFixed(2)} MB over 100 s (> 2 MB)`);
      const width = settings?.width ?? gum?.width;
      need(Number.isFinite(width) && width <= 1280, `live capture width ${width} (> 1280 or unknown)`);
      need(w.errors.length === 0, `uncaught page errors: ${w.errors.slice(0, 3).join(' | ')}`);
      return `120 s idle: ${seg.segments} segments, max ${seg.max_s} s, auto-rolls ${seg.auto_rolls}; retained blobs max ${maxRetained}; heap ${h0.toFixed(2)} -> ${h1.toFixed(2)} MB; capture ${settings?.width}x${settings?.height} @ ${settings?.frameRate?.toFixed?.(0) ?? '?'} fps; ${frames} stand-in frames`;
    } finally {
      await browser.close();
    }
  },
};

// Clip-analysis pose stand-in (workers/client.js e2e seam __GSL_E2E__.clipPose): the fake camera shows a bright disc on
// a dark background, not a golfer, so MediaPipe in the worker finds nobody and every live job would end in
// NO_SWING_FOUND - the gate would then time a failed analysis. The worker still runs its own pose on every frame of the
// trimmed window (that cost is what this gate measures); the landmarks it then uses come from here: a fixed face-on
// body (head, shoulders, hips, knees, feet) with both wrists and hands on the disc and the elbows half-way. Scale: the
// frame is CLIP_FRAME_H_M = 2.0 m tall, torso 0.25 frame heights (0.5 m), so the fixture's hand path (rise 0.5 frame
// heights in 0.9 s, back down in 0.3 s) is a 1 m backswing and a ~3.3 m/s downswing: a swing for events/rules.js.
export const CLIP_FRAME_H_M = 2.0;
export function installClipPoseStandIn({ frameH }) {
  const self = (globalThis.__GSL_E2E__ ??= {});
  self.clip = { frames: 0, found: 0 };
  const BODY = {
    0: [0.5, 0.2], 1: [0.505, 0.19], 2: [0.51, 0.19], 3: [0.515, 0.19], 4: [0.495, 0.19], 5: [0.49, 0.19], 6: [0.485, 0.19],
    7: [0.525, 0.2], 8: [0.475, 0.2], 9: [0.505, 0.215], 10: [0.495, 0.215],
    11: [0.56, 0.33], 12: [0.44, 0.33], 23: [0.54, 0.58], 24: [0.46, 0.58], 25: [0.55, 0.74], 26: [0.45, 0.74],
    27: [0.56, 0.9], 28: [0.44, 0.9], 29: [0.565, 0.915], 30: [0.435, 0.915], 31: [0.6, 0.92], 32: [0.4, 0.92],
  };
  self.clipPose = async (bitmap, t_s, o) => {
    self.clip.frames += 1;
    const bw = bitmap.width, bh = bitmap.height;
    const c = new OffscreenCanvas(bw, bh);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const d = g.getImageData(0, 0, bw, bh).data;
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = 4 * (y * bw + x);
      if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] > 180) { sx += x + 0.5; sy += y + 0.5; n++; }
    }
    const img = new Float32Array(132).fill(NaN);
    const world = new Float32Array(99).fill(NaN);
    if (n < 4) return { img, world };
    self.clip.found += 1;
    const crop = o && o.crop ? o.crop : null;
    const roi = crop && crop.roi ? crop.roi : { x: 0, y: 0, w: bw, h: bh };
    const W = (crop && crop.W) || bw, H = (crop && crop.H) || bh;
    const hu = (roi.x + (sx / n / bw) * roi.w) / W;
    const hv = (roi.y + (sy / n / bh) * roi.h) / H;
    const pts = { ...BODY, 15: [hu + 0.005, hv], 16: [hu - 0.005, hv], 17: [hu + 0.01, hv + 0.01], 18: [hu - 0.01, hv + 0.01],
      19: [hu + 0.01, hv + 0.015], 20: [hu - 0.01, hv + 0.015], 21: [hu + 0.008, hv - 0.005], 22: [hu - 0.008, hv - 0.005] };
    pts[13] = [(BODY[11][0] + hu) / 2, (BODY[11][1] + hv) / 2];
    pts[14] = [(BODY[12][0] + hu) / 2, (BODY[12][1] + hv) / 2];
    const ar = W / H;
    for (let k = 0; k < 33; k++) {
      const [u, v] = pts[k];
      img[4 * k] = u; img[4 * k + 1] = v; img[4 * k + 2] = 0; img[4 * k + 3] = 0.99;
      // MediaPipe world: metres, origin at the hip centre, y down
      world[3 * k] = (u - 0.5) * frameH * ar; world[3 * k + 1] = (v - 0.58) * frameH; world[3 * k + 2] = 0;
    }
    return { img, world };
  };
}

export const latency = {
  meta: { id: 'd-latency', title: 'PF-2: live shot -> card <= 12 s median over 5 analysed swings at CPU x4 (stand-in pose seam), every job a shot, queue never > 2', timeoutMs: 480000 },
  async run(ctx) {
    const cam = fixturePath('m5_fake_cam.y4m');
    const mic = fixturePath('m5_fake_mic.wav');
    for (const f of [cam, mic]) if (!fs.existsSync(f)) throw new Skip(`fixture ${f} not generated (node scripts/make_fixtures.mjs)`);
    const { installPoseStandIn, FRAME_H_M } = await import('../m5.mjs');
    if (typeof installPoseStandIn !== 'function') throw new Error('tests/e2e/m5.mjs does not export installPoseStandIn');
    const truth = readJson(fixturePath('m5_truth.json'));
    const browser = await launch(ctx, { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${cam}`, `--use-file-for-fake-audio-capture=${mic}`, '--autoplay-policy=no-user-gesture-required'] });
    try {
      const context = await browser.newContext({ serviceWorkers: 'block', permissions: ['camera', 'microphone'] });
      await context.addInitScript(installPoseStandIn, { frameH: FRAME_H_M, code: truth.video.frame_code ? { ...truth.video.frame_code, w: truth.video.w, h: truth.video.h } : null });
      await context.addInitScript(installClipPoseStandIn, { frameH: CLIP_FRAME_H_M });
      const page = await context.newPage();
      const w = watchPage(page);
      await ready(page, ctx.baseUrl);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await diag.reset(page, ctx.baseUrl);
      const shots0 = await shotCount(page);
      await enterLive(page);
      const N = 5;
      // the first N analysis jobs must all end in a shot: a NO_SWING_FOUND (or any failure) would time a failed analysis
      const jobs = await waitFor(async () => {
        const j = await diag.get(page, ctx.baseUrl, 'live.jobs');
        if (!Array.isArray(j)) return null;
        const bad = j.slice(0, N).find((x) => !x.ok);
        if (bad) return { failed: j };
        return j.length >= N ? j : null;
      }, { timeout: 400000, interval: 2000, what: `${N} analysed live swings (diag live.jobs)` });
      const q = await diag.get(page, ctx.baseUrl, 'live.queue');
      const clipSt = await page.evaluate(() => globalThis.__GSL_E2E__?.clip ?? null);
      const lastJob = await diag.get(page, ctx.baseUrl, 'worker.last_job');
      if (jobs.failed) {
        const nosw = await diag.get(page, ctx.baseUrl, 'import.last.no_swing');
        need(false, `a live job failed: ${JSON.stringify(jobs.failed.slice(0, N))}; no_swing ${JSON.stringify(nosw)}; clip stand-in ${JSON.stringify(clipSt)}; worker.last_job ${JSON.stringify(lastJob)}; queue ${JSON.stringify(q)}`);
      }
      const first = jobs.slice(0, N);
      const okN = first.filter((j) => j.ok).length;
      need(okN === N, `only ${okN}/${N} jobs ended in a shot: ${JSON.stringify(first)}`);
      // every ok job is a card: the shot reached the store (and so the shot card)
      const shots = await waitFor(async () => { const n = await shotCount(page); return n !== null && n - shots0 >= N ? n : null; }, { timeout: 30000, interval: 1000, what: `${N} new shots in the store` })
        .catch(async () => { throw new Error(`store holds ${await shotCount(page)} shots (was ${shots0}) after ${N} ok jobs`); });
      const lat = first.map((j) => j.latency_s).sort((a, b) => a - b);
      const med = lat[Math.floor(N / 2)];
      const maxQueued = Math.max(...jobs.map((j) => j.queued ?? 0), q?.queued ?? 0);
      need(clipSt && clipSt.found > 0, `the worker never used the clip pose stand-in: ${JSON.stringify(clipSt)}`);
      need(med <= 12, `median shot -> card ${med.toFixed(1)} s (> 12 s): ${lat.map((x) => x.toFixed(1)).join(', ')}; jobs ${JSON.stringify(first)}; queue ${JSON.stringify(q)}; worker.last_job ${JSON.stringify(lastJob)}`);
      need(maxQueued <= 2, `analysis queue reached ${maxQueued} (> 2)`);
      need(w.errors.length === 0, `uncaught page errors: ${w.errors.slice(0, 3).join(' | ')}`);
      return `CPU x4: shot -> card median ${med.toFixed(1)} s over ${N} swings (${lat.map((x) => x.toFixed(1)).join(', ')} s; job ms ${first.map((j) => j.ms).join(', ')}); ok ${okN}/${N} (all jobs so far: ${jobs.filter((j) => j.ok).length} ok / ${jobs.filter((j) => !j.ok).length} failed), ${shots - shots0} new shots stored; worker pose per job: ${lastJob?.pose_frames ?? '?'} frames, ${lastJob?.pose_ms ?? '?'} ms (MediaPipe still runs; landmarks from the clip stand-in, ${clipSt.found}/${clipSt.frames} frames with the disc); queue max ${maxQueued}, dropped ${q?.dropped ?? 0}`;
    } finally {
      await browser.close();
    }
  },
};

/** Shots in the app's repository (null when it cannot be read). */
async function shotCount(page) {
  return page.evaluate(async () => {
    const a = globalThis.__GSL_E2E__?.app;
    const repo = a?.repo ?? a?.store?.repo ?? null;
    try {
      if (repo && typeof repo.countShots === 'function') return await repo.countShots();
      if (repo && typeof repo.listShots === 'function') { const l = await repo.listShots({}); return Array.isArray(l) ? l.length : (l?.items?.length ?? null); }
    } catch (_) { /* below */ }
    return null;
  });
}

export const gates = [idbHang, quota, workerCrash, trunc, offline, diagSave, recorder, latency];
