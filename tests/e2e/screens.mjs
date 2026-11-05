// Integration gates for the real app in Chromium.
//  screens   boot with zero uncaught errors and zero console errors, #app-ready appears, and every screen opens from
//            the UI: home rows (venue, import), the tab bar (history, settings), Settings -> diag / about, home -> 開始練習 (fake
//            camera) -> setup -> live -> 結束練習, history import -> shot row -> results card.
//  m2-shot   import the fixture clip through the import screen and press 開始分析: the whole pipeline runs. The fixture
//            has a ball flight and no golfer, so the app must show the persistent NO_SWING_FOUND error card (still there
//            after 10 s) and save no shot (UX-08); a clip with a swing opens the results card, where every metric item
//            shows a value or "—" with a Traditional Chinese reason (per item or in the shared notices).
import fs from 'node:fs';
import path from 'node:path';
import { watchPage, need, ROOT, FIXTURES, testidOrFail, mp4Fixture, launch } from './lib.mjs';

const CJK = /[一-鿿]/;

function watchConsole(page) {
  const errs = [];
  // MediaPipe's wasm prints this one informational line through console.error when it picks the CPU (XNNPACK) delegate
  // (pose/landmarker.js uses CPU on a software GPU); it is not an app error. Everything else still counts.
  page.on('console', (m) => { if (m.type() === 'error' && !/^INFO: Created TensorFlow Lite XNNPACK delegate for CPU\.$/.test(m.text())) errs.push(m.text()); });
  return errs;
}

async function backHome(page, from) {
  await page.locator(`[data-screen="${from}"] button.back`).first().click();
  await page.locator('[data-screen="home"]').waitFor({ state: 'visible', timeout: 10000 });
}

export const meta = { id: 'screens', title: 'boot without errors, every screen opens from the UI', timeoutMs: 120000 };

export async function run(ctx) {
  const browser = await launch(ctx, { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', permissions: ['camera', 'microphone'] });
    await context.addInitScript(() => { globalThis.__GSL_E2E__ = {}; });
    const page = await context.newPage();
    const w = watchPage(page);
    const cerr = watchConsole(page);
    await page.goto(ctx.baseUrl);
    await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
    need(!(await page.locator('#app-ready[data-error]').count()), `boot failed: ${await page.locator('#boot-error').textContent()}`);
    await page.waitForTimeout(500);
    need(w.errors.length === 0 && cerr.length === 0, `errors on boot: ${[...w.errors, ...cerr].slice(0, 3).join(' | ')}`);
    const opened = ['home'];

    // every screen through the UI a user taps (§2.1): home rows, the tab bar, and Settings for Diagnostics / About;
    // each path ends with the screen's back button, or the Practice tab for a tab root
    const PATHS = {
      venue: ['nav-venue'], import: ['nav-import'], history: ['tabbar-history'], settings: ['tabbar-settings'],
      diag: ['tabbar-settings', 'settings-diag'], about: ['tabbar-settings', 'settings-about'],
    };
    for (const [id, taps] of Object.entries(PATHS)) {
      for (const tid of taps) await (await testidOrFail(page, tid, `the UI path to ${id} (${taps.join(' → ')})`)).click();
      await page.locator(`[data-screen="${id}"]`).waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForTimeout(id === 'diag' ? 1500 : 300);
      need(w.errors.length === 0 && cerr.length === 0, `errors on screen ${id}: ${[...w.errors, ...cerr].slice(0, 3).join(' | ')}`);
      opened.push(id);
      if (await page.locator(`[data-screen="${id}"] button.back`).first().isVisible().catch(() => false)) await backHome(page, id).catch(() => {});
      if (!(await page.locator('[data-screen="home"]').isVisible())) await page.locator('[data-testid="tabbar-practice"]').click();
      await page.locator('[data-screen="home"]').waitFor({ state: 'visible', timeout: 10000 });
    }

    // practice session on the fake camera: setup -> live -> end
    await (await testidOrFail(page, 'btn-start-practice', 'the 開始練習 button')).click();
    await page.locator('[data-screen="setup"]').waitFor({ state: 'visible', timeout: 30000 });
    opened.push('setup');
    await page.waitForTimeout(1000);
    await (await testidOrFail(page, 'btn-skip-setup', 'e2e skip-setup hook')).click();
    await page.locator('[data-screen="live"]').waitFor({ state: 'visible', timeout: 30000 });
    opened.push('live');
    await page.waitForTimeout(3000);
    need(w.errors.length === 0 && cerr.length === 0, `errors in setup/live: ${[...w.errors, ...cerr].slice(0, 3).join(' | ')}`);
    await page.locator('[data-screen="live"] button:has-text("結束練習")').click();
    await page.locator('[data-screen="home"]').waitFor({ state: 'visible', timeout: 10000 });

    // shot screen via history
    const file = path.join(FIXTURES, 'screens_import.json');
    fs.mkdirSync(FIXTURES, { recursive: true });
    const shots = ['valid_face_on_240.json'].map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/shots', f), 'utf8')));
    fs.writeFileSync(file, JSON.stringify({ format: 'golf-swing-lab-export/1', exported_at: '2026-11-04T00:00:00.000Z', app_version: '0.1.0', venues: [], presets: [], sessions: [], shots }));
    await (await testidOrFail(page, 'tabbar-history', 'history tab')).click();
    await page.locator('[data-screen="history"]').waitFor({ state: 'visible', timeout: 10000 });
    await (await testidOrFail(page, 'history-import-input', 'history import input')).setInputFiles(file);
    const row = page.locator('[data-testid="shot-row"]').first();
    await row.waitFor({ state: 'visible', timeout: 15000 });
    await row.click();
    await page.locator('[data-screen="shot"] .metric-list').first().waitFor({ state: 'visible', timeout: 15000 });
    opened.push('shot');
    await page.waitForTimeout(500);
    need(w.errors.length === 0 && cerr.length === 0, `errors on the shot screen: ${[...w.errors, ...cerr].slice(0, 3).join(' | ')}`);
    need(w.external.length === 0, `requests leaving the local server: ${w.external.slice(0, 3).join(' ')}`);
    return `opened ${opened.length} screens (${opened.join(', ')}), 0 page errors, 0 console errors`;
  } finally {
    await browser.close();
  }
}

/** Every metric row: "value ± ci" or "—" plus at least one Chinese reason. -> { rows, bad[] } */
async function checkCard(page) {
  // results card (ui/shot.js): every metric is a [data-metric] list item inside .metric-list; a null shows "—" and its
  // reasons per item, or (reasons shared by several metrics) once in the shot-notices block
  return page.$$eval('[data-screen="shot"] .metric-list li[data-metric]', (lis) => {
    const notice = Boolean(document.querySelector('[data-screen="shot"] [data-testid="shot-notices"]')?.textContent?.trim());
    return lis.map((li) => ({
      id: li.dataset.metric,
      label: li.querySelector('.m-label')?.textContent ?? '',
      value: li.querySelector('.m-value')?.textContent ?? '',
      isNull: li.classList.contains('null') || (li.querySelector('.m-value')?.textContent ?? '').trim().startsWith('—'),
      reasons: [...li.querySelectorAll('.reasons li')].map((x) => x.textContent),
      notice,
    }));
  });
}

export const shot = {
  meta: { id: 'm2-shot', title: 'import fixture clip -> full pipeline -> honest outcome (no swing: persistent NO_SWING_FOUND card, no shot); results card: value or Chinese null reason per metric', timeoutMs: 300000 },
  async run(ctx) {
    const browser = await launch(ctx);
    try {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      await context.addInitScript(() => { globalThis.__GSL_E2E__ = globalThis.__GSL_E2E__ ?? {}; });
      const page = await context.newPage();
      const w = watchPage(page);
      const cerr = watchConsole(page);
      await page.goto(ctx.baseUrl);
      await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
      const h264 = await page.evaluate(async () => {
        try { return (await VideoDecoder.isConfigSupported({ codec: 'avc1.64002A', codedWidth: 1280, codedHeight: 720 })).supported; } catch { return false; }
      });
      const which = h264 ? 'h264' : 'vp9';
      const { file: clip } = await mp4Fixture(which);
      const shotCount = () => page.evaluate(async () => { const a = globalThis.__GSL_E2E__?.app; await a?.ready?.(); return a?.repo ? (await a.repo.shots.list()).length : -1; });
      const before = await shotCount();
      need(before >= 0, 'no repository (app.repo) in the e2e app object');
      await (await testidOrFail(page, 'nav-import', 'import nav')).click();
      await page.locator('[data-screen="import"]').waitFor({ state: 'visible', timeout: 10000 });
      await (await testidOrFail(page, 'import-file-input', 'import file input')).setInputFiles(clip);
      const go = await testidOrFail(page, 'import-start', 'the 開始分析 button');
      await page.waitForFunction(() => { const b = document.querySelector('[data-testid="import-start"]'); return b && !b.disabled; }, null, { timeout: 30000 });
      const t0 = Date.now();
      await go.click();
      // the whole pipeline runs (probe, decode, pose, events); this fixture has a ball flight and no golfer, so the
      // honest outcome is the persistent import error card with NO_SWING_FOUND and no saved shot (UX-08); a fixture with
      // a swing opens the results card instead, and then every metric must be a value or "—" with a Chinese reason
      let outcome = '';
      await page.waitForFunction(() => {
        const s = document.querySelector('[data-screen="shot"]');
        if (s && !s.hidden && s.querySelector('.metric-list')) return true;
        return Boolean(document.querySelector('[data-testid="import-error-card"]'));
      }, null, { timeout: 240000, polling: 500 }).catch(() => { outcome = 'timeout'; });
      need(!outcome, 'neither a results card nor an import error card appeared within 240 s');
      const secs = (Date.now() - t0) / 1000;
      const errCard = page.locator('[data-testid="import-error-card"]').first();
      let summary;
      if (await errCard.count()) {
        const text = (await errCard.textContent()) ?? '';
        need(text.includes('影片中找不到完整的揮桿'), `import error card is not NO_SWING_FOUND: "${text.slice(0, 120)}"`);
        need(!/[A-Z]{3,}_[A-Z_]+|Error:|undefined/.test(text), `error card leaks a code or raw error: "${text.slice(0, 120)}"`);
        await page.waitForTimeout(10000);
        need(await errCard.isVisible(), 'the import error card vanished within 10 s (must persist, ux-m2)');
        need(await page.locator('[data-testid="import-error-another"]').count() > 0, 'error card has no "try another video" action');
        const after = await shotCount();
        need(after === before, `a no-swing clip saved a shot (${before} -> ${after})`);
        summary = `${which}: pipeline finished in ${secs.toFixed(1)} s with the persistent NO_SWING_FOUND card (fixture has no golfer), 0 shots saved`;
      } else {
        const rows = await checkCard(page);
        need(rows.length > 0, 'results card has no metric items');
        const bad = rows.filter((r) => (r.isNull ? !(r.reasons.length ? r.reasons.every((x) => CJK.test(x)) : r.notice) : !/\d/.test(r.value)));
        need(bad.length === 0, `${bad.length} metric item(s) show neither a value nor "—" with a Chinese reason: ${bad.slice(0, 4).map((r) => `${r.id}=${r.value} [${r.reasons.join('; ')}]`).join(' | ')}`);
        summary = `${which}: card in ${secs.toFixed(1)} s, ${rows.length} metric items (${rows.filter((r) => !r.isNull).length} values)`;
      }
      need(w.errors.length === 0 && cerr.length === 0, `errors: ${[...w.errors, ...cerr].slice(0, 3).join(' | ')}`);
      need(w.external.length === 0, `requests leaving the local server: ${w.external.slice(0, 3).join(' ')}`);
      return summary + (h264 ? '' : ' [DEGRADED: VP9 twin, no H.264 decoder in this Chromium]');
    } finally {
      await browser.close();
    }
  },
};
