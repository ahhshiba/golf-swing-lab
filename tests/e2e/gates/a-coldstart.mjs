// Gate a-coldstart (WP-A, PF-1): cold start (no service worker, empty cache) on a throttled Fast-3G link
// (CDP: 562.5 ms RTT, 180 kB/s down, 84 kB/s up — the perf audit's profile) with CPU ×4 reaches #app-ready in ≤ 6 s.
// Also asserts the build's <link rel=modulepreload> list exists, covers ≤ 30 modules, and that the boot does not
// load the heavy layers (capture/, import/, pipeline/, physics/, track/, vendor/) before #app-ready.
import { launch, need } from '../lib.mjs';

export const FAST3G = Object.freeze({ offline: false, latency: 562.5, downloadThroughput: 180000, uploadThroughput: 84375 });
export const BUDGET_MS = 6000;
const LAZY_RE = /\/src\/(capture|import|pipeline|physics|track)\/|\/vendor\//;

export const meta = { id: 'a-coldstart', title: 'cold start Fast-3G + CPU ×4 → #app-ready ≤ 6 s; modulepreload; lazy heavy layers', timeoutMs: 180000 };

export async function run(ctx) {
  const browser = await launch(ctx);
  const runs = [];
  try {
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Network.emulateNetworkConditions', FAST3G);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      // the moment #app-ready is inserted, in page time: requests that STARTED before it count as boot requests
      await context.addInitScript(() => {
        new MutationObserver((_, mo) => { if (document.getElementById('app-ready')) { window.__gslReadyAt = performance.now(); mo.disconnect(); } }).observe(document, { childList: true, subtree: true });
      });
      const t0 = Date.now();
      await page.goto(ctx.baseUrl, { waitUntil: 'commit' });
      await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 60000 });
      const ms = Date.now() - t0;
      const info = await page.evaluate(() => ({
        before: performance.getEntriesByType('resource').filter((e) => e.startTime < window.__gslReadyAt).map((e) => e.name),
        readyAt: Math.round(window.__gslReadyAt),
        preload: [...document.querySelectorAll('link[rel="modulepreload"]')].map((l) => l.getAttribute('href')),
        error: document.getElementById('app-ready')?.dataset.error ?? null,
        bytes: performance.getEntriesByType('resource').filter((e) => e.startTime < window.__gslReadyAt).reduce((s, e) => s + (e.transferSize || e.encodedBodySize || 0), 0),
      }));
      const before = [ctx.baseUrl, ...info.before];
      runs.push({ ms, page_ms: info.readyAt, reqs: before.length, kB: Math.round(info.bytes / 1000), heavy: before.filter((u) => LAZY_RE.test(u)) });
      need(!info.error, `boot failed (#app-ready[data-error]) on run ${i + 1}`);
      need(info.preload.length > 0, 'index.html has no <link rel="modulepreload"> entries');
      need(info.preload.length <= 30, `modulepreload covers ${info.preload.length} modules (> 30)`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
  const best = runs.reduce((a, b) => (a.ms <= b.ms ? a : b));
  const summary = runs.map((r) => `${r.ms} ms (page clock ${r.page_ms} ms) / ${r.reqs} req / ${r.kB} kB`).join('; ');
  need(runs.every((r) => r.heavy.length === 0), `heavy layers fetched before #app-ready: ${[...new Set(runs.flatMap((r) => r.heavy))].slice(0, 6).join(', ')}`);
  need(runs.every((r) => r.ms <= BUDGET_MS), `cold start over ${BUDGET_MS} ms: ${summary}`);
  return `Fast-3G + CPU ×4, no SW: ${summary} (best ${best.ms} ms, budget ${BUDGET_MS} ms)`;
}
