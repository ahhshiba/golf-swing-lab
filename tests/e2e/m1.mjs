// M1 machine gate: the app loads, #app-ready appears, the service worker controls the page after a reload, and after
// going offline a reload still shows #app-ready (CAFCR R6 row M1, KD5).
import { diag, waitFor, watchPage, need, launch } from './lib.mjs';

export const meta = { id: 'm1', title: 'M1 load, service worker, offline reload', timeoutMs: 120000 };

export async function run(ctx) {
  const browser = await launch(ctx);
  try {
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    const page = await context.newPage();
    const w = watchPage(page);
    await page.goto(ctx.baseUrl);
    await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });

    const reg = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return null;
      const r = await navigator.serviceWorker.ready;
      return { scope: r.scope, active: !!r.active };
    });
    need(reg && reg.active, 'service worker did not become active (no navigator.serviceWorker.ready)');

    await page.reload();
    await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
    const controlled = await waitFor(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 10000, what: 'SW controlling the page after reload' });
    need(controlled, 'service worker does not control the page after reload');

    const rep = await waitFor(async () => {
      const r = await diag.report(page, ctx.baseUrl);
      return r.precache_complete === 1 ? r : null;
    }, { timeout: 40000, interval: 500, what: 'report.precache_complete == 1' }).catch(async (e) => {
      const r = await diag.report(page, ctx.baseUrl);
      throw new Error(`${e.message} (precache_complete=${r.precache_complete})`);
    });
    need(rep.sw_controlled === true, 'report.sw_controlled is not true');

    await context.setOffline(true);
    await page.reload();
    await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
    const rep2 = await diag.report(page, ctx.baseUrl);
    need(rep2.sw_controlled === true, 'offline: page is not controlled by the service worker');
    await context.setOffline(false);

    need(w.errors.length === 0, `uncaught page errors: ${w.errors.slice(0, 3).join(' | ')}`);
    need(w.external.length === 0, `requests leaving the local server: ${w.external.slice(0, 3).join(' ')}`);
    return `SW active, controlled, precache_complete=${rep.precache_complete}, offline reload ok`;
  } finally {
    await browser.close();
  }
}
