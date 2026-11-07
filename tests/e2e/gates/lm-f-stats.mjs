// LM-F gates (LAUNCH-MONITOR-SPEC §3.7, §3.8, §5.2 LM-F acceptance 3 and 4). Chromium, 390 × 844, zh-TW.
//  lm-f-stats    import tests/fixtures/lm/sessions-1000.json through History; at CPU ×4, history-seg[data-seg=stats]
//                → first stats-club-card visible ≤ 800 ms; DOM ≤ 2,000 nodes; the dispersion canvas (viz drawTop)
//                reports face-on points on the distance-only strip and high-behind points on the side plane
//                (a11y params n_strip / n_plane, exact for one club where nothing is thinned); consistency block and
//                previous-session line on every card; mishit switch; no h-scroll at 200 %; no page errors / network.
//  lm-f-gapping  history-seg[data-seg=gapping]: gapping-row count = clubs with ≥ 1 face-on carry in the fixture,
//                rows in club-length order, CSV download: header exactly
//                club,n,carry_median_m,carry_p10_m,carry_p90_m,total_median_m,gap_next_m,flag and no CJK; the
//                high-behind switch adds ▲ markers.
import fs from 'node:fs';
import path from 'node:path';
import { launch, watchPage, need, ROOT, waitFor } from '../lib.mjs';
import { noHScroll, setTextScale } from '../checks.mjs';

const FIXTURE = path.join(ROOT, 'tests/fixtures/lm/sessions-1000.json');
const CLUB_ORDER = ['driver', '3w', 'hybrid', '5i', '7i', '9i', 'pw', 'sw'];

async function until(page, fn, arg, { timeout = 30000, what = 'condition' } = {}) {
  return waitFor(() => page.evaluate(fn, arg), { timeout, interval: 100, what });
}

async function boot(ctx) {
  const browser = await launch(ctx);
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await context.addInitScript(() => { globalThis.__GSL_E2E__ = globalThis.__GSL_E2E__ ?? {}; });
  const page = await context.newPage();
  const w = watchPage(page);
  await page.goto(ctx.baseUrl);
  await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
  await page.locator('[data-testid="tabbar-history"]').click();
  await page.locator('[data-screen="history"]').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('[data-testid="history-import-input"]').setInputFiles(FIXTURE);
  await page.locator('[data-testid="history-restore-status"]').waitFor({ state: 'visible', timeout: 120000 });
  await until(page, () => document.querySelectorAll('[data-screen="history"] [data-testid="shot-row"]').length > 0, null, { timeout: 60000, what: 'history rows' });
  return { browser, page, w };
}

const segSel = (seg) => `[data-screen="history"]:not([hidden]) [data-testid="history-seg"][data-seg="${seg}"]`;

async function stats(ctx) {
  const notes = [];
  const { browser, page, w } = await boot(ctx);
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const ms = await page.evaluate((sel) => new Promise((resolve, reject) => {
      const btn = document.querySelector(sel);
      if (!btn) { reject(new Error(`no ${sel}`)); return; }
      const t0 = performance.now();
      btn.click();
      const tick = () => {
        const c = document.querySelector('[data-screen="stats"]:not([hidden]) [data-testid="stats-club-card"]');
        if (c && c.getClientRects().length) requestAnimationFrame(() => resolve(performance.now() - t0));
        else if (performance.now() - t0 > 20000) reject(new Error('no stats-club-card within 20 s'));
        else setTimeout(tick, 5);
      };
      tick();
    }), segSel('stats'));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    // the charts draw after the cards: wait for them, then count the whole document
    await until(page, () => Boolean(document.querySelector('[data-screen="stats"] [data-testid="stats-viz-top"][data-viz-params]')), null, { timeout: 20000, what: 'charts drawn' }).catch(() => {});
    await page.waitForTimeout(300);
    const dom = await page.evaluate(() => ({ all: document.querySelectorAll('*').length, stats: document.querySelectorAll('[data-screen="stats"] *').length, cards: [...document.querySelectorAll('[data-screen="stats"] [data-testid="stats-club-card"]')].map((c) => c.dataset.club) }));
    need(ms <= 800, `stats: first card after ${ms.toFixed(0)} ms at CPU ×4 (budget 800)`);
    need(dom.all <= 2000, `DOM has ${dom.all} nodes (budget 2,000; stats screen ${dom.stats})`);
    need(JSON.stringify(dom.cards) === JSON.stringify(CLUB_ORDER), `club cards ${dom.cards.join(',')}, expected ${CLUB_ORDER.join(',')}`);
    notes.push(`first stats card ${ms.toFixed(0)} ms at CPU ×4 (≤ 800); DOM ${dom.all} nodes (≤ 2,000), stats screen ${dom.stats}`);

    const cards = await page.evaluate(() => [...document.querySelectorAll('[data-screen="stats"] [data-testid="stats-club-card"]')].map((c) => ({
      club: c.dataset.club, cons: Boolean(c.querySelector('[data-testid="stats-consistency"]')), last: Boolean(c.querySelector('.stats-last')),
      est: Boolean(c.querySelector('.dt-est')), text: c.textContent })));
    need(cards.every((c) => c.cons && c.last && c.est), `every card needs consistency, previous session and the estimated mark: ${JSON.stringify(cards.map((c) => [c.club, c.cons, c.last, c.est]))}`);

    // dispersion: face_on (no side) on the strip, high_behind on the side plane — from drawTop's a11y params
    const top = async () => page.evaluate(() => {
      const cv = document.querySelector('[data-screen="stats"] [data-testid="stats-viz-top"]');
      if (!cv?.dataset.vizParams) return null;
      return { p: JSON.parse(cv.dataset.vizParams), fo: Number(cv.dataset.inputFaceOn), hb: Number(cv.dataset.inputHighBehind), label: cv.getAttribute('aria-label'), role: cv.getAttribute('role') };
    });
    const all = await top();
    need(all, 'the dispersion canvas was not drawn (viz drawTop unavailable or failed)');
    need(all.role === 'img' && all.label && !/^viz\./.test(all.label), `canvas a11y: role ${all.role}, label "${all.label}"`);
    need(all.p.n_plane > 0 && all.p.n_strip > 0 && all.p.n_plane + all.p.n_strip === all.p.shown, `all clubs: ${JSON.stringify(all)}`);
    need(all.p.n === all.fo + all.hb, `all clubs: drawTop got ${all.p.n} points, input ${all.fo} face-on + ${all.hb} high-behind`);
    // mishit switch (settings.lm.excludeMishits, default on): some card says how many it left out; off → none, saved
    const excludedCards = () => page.evaluate(() => [...document.querySelectorAll('[data-screen="stats"] [data-testid="stats-club-card"] .stats-n')].filter((e) => e.textContent.includes('·')).length);
    const exOn = await excludedCards();
    await page.locator('[data-screen="stats"] [data-testid="stats-mishits"]').click();
    await page.waitForTimeout(300);
    const exOff = await excludedCards();
    const saved = await page.evaluate(() => globalThis.__GSL_E2E__.app.settings().lm.excludeMishits);
    need(exOn > 0 && exOff === 0 && saved === false, `mishit switch: cards with exclusions on ${exOn}, off ${exOff}; setting ${saved}`);
    await page.locator('[data-screen="stats"] [data-testid="stats-mishits"]').click();
    await page.waitForTimeout(300);
    notes.push(`mishits: ${exOn} cards leave shots out with the setting on, none with it off`);

    await page.locator('[data-screen="stats"] [data-testid="stats-filter"][data-filter="club"] [data-value="driver"]').click();
    await until(page, () => document.querySelectorAll('[data-screen="stats"] [data-testid="stats-club-card"]').length === 1, null, { what: 'one card' });
    await until(page, () => Boolean(document.querySelector('[data-screen="stats"] [data-testid="stats-viz-top"][data-viz-params]')), null, { what: 'driver chart' });
    const one = await top();
    need(!one.p.sampled, `driver: chart thinned (${JSON.stringify(one.p)})`);
    need(one.p.n_strip === one.fo && one.p.n_plane === one.hb && one.fo > 0 && one.hb > 0,
      `driver: strip ${one.p.n_strip} vs face-on ${one.fo}, plane ${one.p.n_plane} vs high-behind ${one.hb}`);
    notes.push(`dispersion: all clubs plane ${all.p.n_plane} + strip ${all.p.n_strip}; driver strip = ${one.fo} face-on, plane = ${one.hb} high-behind`);

    await setTextScale(page, 2);
    await page.waitForTimeout(200);
    const hs = await noHScroll(page);
    await setTextScale(page, 1);
    need(hs.ok, `stats h-scroll at 200 % (${hs.scrollWidth} > ${hs.clientWidth})`);
    // back to the list through the segmented control
    await page.locator('[data-screen="stats"] [data-testid="history-seg"][data-seg="list"]').click();
    await page.locator('[data-screen="history"]').waitFor({ state: 'visible', timeout: 10000 });
    need(w.errors.length === 0, `page errors: ${w.errors.slice(0, 3).join(' | ')}`);
    need(w.external.length === 0, `requests left the origin: ${w.external.slice(0, 3).join(', ')}`);
  } finally {
    await browser.close();
  }
  return notes.join('\n');
}

async function gappingGate(ctx) {
  const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const expected = CLUB_ORDER.filter((c) => fx.shots.some((s) => s.club.type === c && s.capture.view === 'face_on' && Number.isFinite(s.metrics.carry_m?.value)));
  const { browser, page, w } = await boot(ctx);
  try {
    await page.locator(segSel('gapping')).click();
    await page.locator('[data-screen="gapping"]').waitFor({ state: 'visible', timeout: 10000 });
    await until(page, () => document.querySelectorAll('[data-screen="gapping"] [data-testid="gapping-row"]').length > 0, null, { what: 'gapping rows' });
    const rows = await page.evaluate(() => [...document.querySelectorAll('[data-screen="gapping"] [data-testid="gapping-row"]')].map((r) => r.dataset.club));
    need(JSON.stringify(rows) === JSON.stringify(expected), `gapping rows ${rows.join(',')}, expected ${expected.join(',')} (${expected.length} clubs with n ≥ 1)`);
    need(await page.locator('[data-screen="gapping"] .gap-tri').count() === 0, 'high-behind markers shown with the switch off');
    await page.locator('[data-screen="gapping"] [data-testid="gapping-include-hb"]').click();
    await until(page, () => document.querySelectorAll('[data-screen="gapping"] .gap-tri').length > 0, null, { what: 'high-behind markers' });

    await page.locator('[data-screen="gapping"] [data-testid="gapping-csv"]').click();
    const link = page.locator('[data-screen="gapping"] a[download]').first();
    const dlP = page.waitForEvent('download', { timeout: 20000 });
    if (await link.waitFor({ state: 'attached', timeout: 5000 }).then(() => true, () => false)) await link.click();
    const dl = await dlP;
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    const lines = csv.trim().split(/\r?\n/);
    need(lines[0] === 'club,n,carry_median_m,carry_p10_m,carry_p90_m,total_median_m,gap_next_m,flag', `CSV header "${lines[0]}"`);
    need(!/[　-鿿＀-￯]/.test(csv), 'CSV contains CJK characters');
    need(lines.length - 1 === expected.length, `CSV has ${lines.length - 1} rows, expected ${expected.length}`);
    need(dl.suggestedFilename().endsWith('.csv'), `download name ${dl.suggestedFilename()}`);

    await setTextScale(page, 2);
    await page.waitForTimeout(200);
    const hs = await noHScroll(page);
    await setTextScale(page, 1);
    need(hs.ok, `gapping h-scroll at 200 % (${hs.scrollWidth} > ${hs.clientWidth})`);
    need(w.errors.length === 0, `page errors: ${w.errors.slice(0, 3).join(' | ')}`);
    need(w.external.length === 0, `requests left the origin: ${w.external.slice(0, 3).join(', ')}`);
    return `${rows.length} gapping rows in club order; CSV header exact, ${lines.length - 1} rows, no CJK; ▲ markers with high-behind on`;
  } finally {
    await browser.close();
  }
}

export const gates = [
  { meta: { id: 'lm-f-stats', title: 'LM-F stats: 1000 shots, first card ≤ 800 ms at CPU ×4, DOM ≤ 2,000, face-on on the strip', timeoutMs: 240000 }, run: stats },
  { meta: { id: 'lm-f-gapping', title: 'LM-F gapping: one row per club, CSV header and no CJK', timeoutMs: 240000 }, run: gappingGate },
];
