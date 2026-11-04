// Integration gates for the real app in Chromium.
//  screens   boot with zero uncaught errors and zero console errors, #app-ready appears, and every screen opens from
//            the UI: home -> venue / import / history / diag / settings / about (and back), home -> 開始練習 (fake
//            camera) -> setup -> live -> 結束練習, history import -> shot row -> results card.
//  m2-shot   import the fixture clip through the import screen, press 開始分析, and the app opens a results card in
//            which every metric row shows either "value ± ci" or "—" with at least one Traditional Chinese reason.
import fs from 'node:fs';
import path from 'node:path';
import { watchPage, need, ROOT, FIXTURES, testidOrFail, mp4Fixture, launch } from './lib.mjs';

const CJK = /[一-鿿]/;

function watchConsole(page) {
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
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

    for (const id of ['venue', 'import', 'history', 'diag', 'settings', 'about']) {
      await (await testidOrFail(page, `nav-${id}`, `home menu button for ${id}`)).click();
      await page.locator(`[data-screen="${id}"]`).waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForTimeout(id === 'diag' ? 1500 : 300);
      need(w.errors.length === 0 && cerr.length === 0, `errors on screen ${id}: ${[...w.errors, ...cerr].slice(0, 3).join(' | ')}`);
      opened.push(id);
      await backHome(page, id);
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
    await (await testidOrFail(page, 'nav-history', 'history nav')).click();
    await page.locator('[data-screen="history"]').waitFor({ state: 'visible', timeout: 10000 });
    await (await testidOrFail(page, 'history-import-input', 'history import input')).setInputFiles(file);
    const row = page.locator('[data-testid="shot-row"]').first();
    await row.waitFor({ state: 'visible', timeout: 15000 });
    await row.click();
    await page.locator('[data-screen="shot"] .metric-list').waitFor({ state: 'visible', timeout: 15000 });
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
  return page.$$eval('[data-screen="shot"] .metric-list > li', (lis) => lis.map((li) => ({
    label: li.querySelector('.m-label')?.textContent ?? '',
    value: li.querySelector('.m-value')?.textContent ?? '',
    reasons: [...li.querySelectorAll('.reasons li')].map((x) => x.textContent),
    validity: li.querySelector('.badge')?.textContent ?? '',
  })));
}

export const shot = {
  meta: { id: 'm2-shot', title: 'import fixture clip -> results card (value ± ci or Chinese null reason per metric)', timeoutMs: 300000 },
  async run(ctx) {
    const browser = await launch(ctx);
    try {
      const context = await browser.newContext({ serviceWorkers: 'block' });
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
      await (await testidOrFail(page, 'nav-import', 'import nav')).click();
      await page.locator('[data-screen="import"]').waitFor({ state: 'visible', timeout: 10000 });
      await (await testidOrFail(page, 'import-file-input', 'import file input')).setInputFiles(clip);
      const go = await testidOrFail(page, 'import-start', 'the 開始分析 button');
      await page.waitForFunction(() => { const b = document.querySelector('[data-testid="import-start"]'); return b && !b.disabled; }, null, { timeout: 30000 });
      const t0 = Date.now();
      await go.click();
      const toastText = async () => (await page.locator('#toast').isVisible()) ? await page.locator('#toast').textContent() : '';
      let failure = '';
      await page.waitForFunction(() => {
        const s = document.querySelector('[data-screen="shot"]');
        if (s && !s.hidden && s.querySelector('.metric-list')) return true;
        const t = document.getElementById('toast');
        return t && !t.hidden && /分析失敗/.test(t.textContent);
      }, null, { timeout: 240000, polling: 500 }).catch(() => { failure = 'timeout'; });
      const tt = await toastText();
      need(!/分析失敗/.test(tt), `analysis failed in the app: ${tt}`);
      need(!failure, 'results card did not appear within 240 s');
      const secs = (Date.now() - t0) / 1000;
      const rows = await checkCard(page);
      need(rows.length > 0, 'results card has no metric rows');
      const bad = rows.filter((r) => {
        if (r.value.trim() === '—') return !(r.reasons.length && r.reasons.every((x) => CJK.test(x)));
        return !/±/.test(r.value);
      });
      need(bad.length === 0, `${bad.length} metric row(s) show neither "value ± ci" nor "—" with a Chinese reason: ${bad.slice(0, 4).map((r) => `${r.label}=${r.value} [${r.reasons.join('; ')}]`).join(' | ')}`);
      need(w.errors.length === 0 && cerr.length === 0, `errors: ${[...w.errors, ...cerr].slice(0, 3).join(' | ')}`);
      const withValue = rows.filter((r) => r.value.trim() !== '—');
      const ball = rows.find((r) => /^球速/.test(r.label));
      return `${which}: card in ${secs.toFixed(1)} s, ${rows.length} rows: ${withValue.length} value ± ci, ${rows.length - withValue.length} null with Chinese reason${ball ? `; ${ball.label} = ${ball.value}${ball.reasons.length ? ` (${ball.reasons[0]})` : ''}` : ''}${h264 ? '' : ' [DEGRADED: VP9 twin, no H.264 decoder in this Chromium]'}`;
    } finally {
      await browser.close();
    }
  },
};
