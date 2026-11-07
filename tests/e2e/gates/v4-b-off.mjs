// Gate v4-b-off (V04-SPEC §A.2 "關掉時行為與 0.3.0 完全相同", §G.3 V4-B acceptance 5): with the Settings switch
// settings-quick turned off, a live session on the m5 fake camera + microphone (pose stand-in) detects and analyses
// swings exactly as before, and no quick-card ever appears in the DOM (MutationObserver over the whole session), the
// quick modules are not loaded and diag has no live.quick. The hero tiles show the analysed shot as in 0.3.0.
import { need, waitFor, diag } from '../lib.mjs';
import { liveContext, enterLive } from './v4-b-latency.mjs';

export const meta = { id: 'v4-b-off', title: 'V4-B quick read off: Settings switch off -> live shots as in 0.3.0, no quick-card in the DOM, no quick module loaded, no live.quick diag', timeoutMs: 300000 };

export async function run(ctx) {
  const { browser, page, w } = await liveContext(ctx, { cpu: 1 });
  try {
    // the Settings switch (V4-A), as a user turns it off
    await page.evaluate(() => globalThis.__GSL_E2E__.app.nav.go('settings'));
    await page.locator('[data-screen="settings"]').waitFor({ state: 'visible', timeout: 20000 });
    const sw = page.locator('[data-testid="settings-quick"]').first();
    need(await sw.count() === 1, 'settings-quick switch not found');
    if ((await sw.getAttribute('aria-checked')) !== 'false') await sw.click();
    await waitFor(() => page.evaluate(() => globalThis.__GSL_E2E__.app.settings().quick?.enabled === false), { timeout: 5000, what: 'settings.quick.enabled === false' });
    await page.evaluate(() => globalThis.__GSL_E2E__.app.nav.go('home'));
    await page.locator('[data-screen="home"]').waitFor({ state: 'visible', timeout: 20000 });
    await enterLive(page);
    // two analysed shots
    await waitFor(async () => { const j = await diag.get(page, ctx.baseUrl, 'live.jobs'); return Array.isArray(j) && j.filter((x) => x.ok).length >= 2; }, { timeout: 240000, interval: 2000, what: '2 analysed live swings' });
    await page.waitForTimeout(1000);
    const seen = await page.evaluate(() => globalThis.__V4B__.log.filter((x) => x.stage !== null).length);
    const now = await page.locator('[data-testid="quick-card"]').count();
    const loaded = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /\/src\/(quick\/|ui\/quickcard\.js)/.test(n)));
    const q = await diag.get(page, ctx.baseUrl, 'live.quick');
    const hero = await page.locator('[data-testid="live-hero"] .hero-tile').count();
    const det = await diag.get(page, ctx.baseUrl, 'live.detections');
    need(seen === 0 && now === 0, `quick-card appeared with the quick read off (${seen} stage changes, ${now} in the DOM now)`);
    need(loaded.length === 0, `quick modules loaded with the quick read off: ${loaded.join(', ')}`);
    need(q === undefined || q === null, `diag live.quick recorded with the quick read off: ${JSON.stringify(q)}`);
    need(hero >= 1, 'no hero tiles on the live screen');
    need(w.errors.length === 0, `uncaught page errors: ${w.errors.slice(0, 3).join(' | ')}`);
    return `quick read off: ${det} swings detected, 2+ analysed, hero tiles ${hero}, no quick-card, no quick module requested, no live.quick diag`;
  } finally {
    await browser.close();
  }
}
