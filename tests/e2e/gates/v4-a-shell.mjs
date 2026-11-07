// Gate v4-a-shell (V04-SPEC §G.3 V4-A acceptance 6): the 0.4.0 shell additions in Chromium at 390 × 844, zh-Hant.
//  * the 5 new screens (course, round, scorecard, lab, patterns) navigate: visible, document.title = "<title> – <app
//    name>", focus on the screen's <h1>, the right tab is current, no horizontal scroll at 200 % text
//  * lazy CSS: styles/screens/sim.css / lab.css is applied before the screen's show() renders (the probe custom property
//    --lazy-css is already computed when the first child lands in the root) and index.html links neither
//  * theme auto: round / scorecard / lab / patterns roots carry data-live-theme="dark" (DATA_SCREENS)
//  * home has the two entries (home-course, home-lab); Settings has the quick-read switch (settings-quick, default on)
//  * app.sim (active / set / submit / onSubmit) and app.loadStyles (idempotent, rejects a bad name) work (§G.0-3)
//  * no page error, no request leaves the origin
import fs from 'node:fs';
import path from 'node:path';
import { launch, watchPage, need, waitFor, ROOT } from '../lib.mjs';
import { noHScroll, focusOnH1, setTextScale } from '../checks.mjs';

export const meta = { id: 'v4-a-shell', title: 'V4-A drop 1: 5 new screens (title, h1 focus, tab, 200 % text), lazy CSS before show, data screens, app.sim, app.loadStyles, home + settings entries', timeoutMs: 180000 };

const NEW = Object.freeze({ course: ['practice', 'sim'], round: ['practice', 'sim'], scorecard: ['practice', 'sim'], lab: ['practice', 'lab'], patterns: ['history', 'lab'] });
const TITLES = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/i18n/zh-Hant/screen.json'), 'utf8'));
const APP_NAME = '揮桿實驗室';

async function go(page, id, params = {}) {
  // record the probe property at the moment the screen's first content is inserted (that is inside show())
  await page.evaluate((s) => {
    const root = document.querySelector(`[data-screen="${s}"]`);
    globalThis.__v4aProbe = globalThis.__v4aProbe ?? {};
    if (root.childElementCount > 0 || globalThis.__v4aProbe[s] !== undefined) return;
    const mo = new MutationObserver(() => {
      if (!root.childElementCount) return;
      globalThis.__v4aProbe[s] = getComputedStyle(root).getPropertyValue('--lazy-css').trim();
      mo.disconnect();
    });
    mo.observe(root, { childList: true });
  }, id);
  await page.evaluate(([s, p]) => globalThis.__GSL_E2E__.app.nav.go(s, p), [id, params]);
  await page.locator(`[data-screen="${id}"]`).waitFor({ state: 'visible', timeout: 20000 });
  await waitFor(() => page.evaluate((s) => Boolean(document.activeElement?.closest?.(`[data-screen="${s}"]`)), id), { timeout: 8000, interval: 100, what: `focus inside ${id}` }).catch(() => {});
  await page.waitForTimeout(200);
}

const setTheme = (page, theme) => page.evaluate((th) => { const app = globalThis.__GSL_E2E__.app; app.updateSettings({ ...app.settings(), theme: th }); }, theme);
const liveTheme = (page, id) => page.evaluate((s) => document.querySelector(`[data-screen="${s}"]`)?.dataset.liveTheme ?? null, id);

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

    // home entries (boot graph screen)
    for (const tid of ['home-course', 'home-lab']) need(await page.locator(`[data-testid="${tid}"]`).count() === 1, `home: ${tid} missing`);
    const linked = await page.evaluate(() => [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute('href')));
    need(!linked.some((h) => /screens\/(sim|lab|share)\.css$/.test(h)), `lazy CSS linked at boot: ${linked.join(', ')}`);

    const bad = [];
    for (const [id, [tab, css]] of Object.entries(NEW)) {
      await go(page, id);
      const title = await page.title();
      if (title !== `${TITLES[`${id}.title`]} – ${APP_NAME}`) bad.push(`${id}: title "${title}"`);
      const f = await focusOnH1(page);
      if (!f.ok) bad.push(`${id}: focus on ${f.active}`);
      const cur = await page.evaluate(() => document.querySelector('#tabbar .tab[aria-current="page"]')?.dataset.tab ?? null);
      if (cur !== tab) bad.push(`${id}: current tab ${cur}, expected ${tab}`);
      if (await page.locator('#tabbar').isHidden()) bad.push(`${id}: tab bar hidden`);
      const probe = await page.evaluate((s) => globalThis.__v4aProbe?.[s] ?? null, id);
      if (probe !== css) bad.push(`${id}: --lazy-css at first render = ${JSON.stringify(probe)}, expected ${css} (stylesheet not applied before show)`);
      await setTextScale(page, 2);
      await page.waitForTimeout(150);
      const h = await noHScroll(page);
      if (!h.ok) bad.push(`${id}: h-scroll at 200 % (${h.scrollWidth} > ${h.clientWidth})`);
      await setTextScale(page, 1);
    }
    need(bad.length === 0, bad.join('; '));
    const links = await page.evaluate(() => [...document.querySelectorAll('link[data-lazy-css]')].map((l) => l.dataset.lazyCss).sort());
    need(JSON.stringify(links) === JSON.stringify(['lab', 'sim']), `lazy stylesheet links ${JSON.stringify(links)}, expected one each of lab and sim`);
    need(await page.locator('[data-screen="scorecard"] [data-testid="score-disclaimer"]').count() === 1, 'scorecard: score.disclaimer footer missing');
    notes.push('5 new screens: title, h1 focus, tab, lazy CSS applied before first render, 200 % text OK');

    // data screens dark on auto
    await setTheme(page, 'auto');
    for (const id of ['round', 'scorecard', 'lab', 'patterns']) need(await liveTheme(page, id) === 'dark', `theme auto: ${id} root data-live-theme=${await liveTheme(page, id)}`);
    need(await liveTheme(page, 'course') === null, 'course is a list screen, not forced dark');
    await setTheme(page, 'dark');
    notes.push('theme auto: round / scorecard / lab / patterns roots data-live-theme="dark"');

    // app.sim and app.loadStyles (FROZEN shapes)
    const api = await page.evaluate(async () => {
      const app = globalThis.__GSL_E2E__.app;
      const got = [];
      const before = app.sim.active();
      const ctx = { round_id: 'r1', hole: 3, player_id: 'p1', stroke_n: 2, club: '7i' };
      app.sim.set(ctx);
      const off = app.sim.onSubmit((input, c) => got.push([input.kind, c?.hole ?? null]));
      const n1 = app.sim.submit({ kind: 'manual', carry_m: 140, side_m: null });
      off();
      const n2 = app.sim.submit({ kind: 'quick', result: {} });
      let bad = null;
      try { app.sim.submit({ kind: 'nope' }); } catch (e) { bad = e.name; }
      const active = app.sim.active()?.round_id ?? null;
      app.sim.set(null);
      const p1 = app.loadStyles('share');
      const p2 = app.loadStyles('share');
      await p1;
      let badName = null;
      try { await app.loadStyles('../x'); } catch (e) { badName = e.name; }
      const shareLinks = document.querySelectorAll('link[data-lazy-css="share"]').length;
      return { before, n1, n2, got, bad, active, after: app.sim.active(), same: p1 === p2, badName, shareLinks };
    });
    need(api.before === null && api.active === 'r1' && api.after === null, `app.sim active/set: ${JSON.stringify(api)}`);
    // the mounted round screen (V4-D) keeps its own listener (it ignores a ctx that is not its round): count ours only
    need(api.n1 - api.n2 === 1 && api.n2 >= 0 && JSON.stringify(api.got) === JSON.stringify([['manual', 3]]) && api.bad === 'TypeError', `app.sim submit/onSubmit: ${JSON.stringify(api)}`);
    need(api.same && api.shareLinks === 1 && api.badName === 'TypeError', `app.loadStyles: ${JSON.stringify(api)}`);
    notes.push('app.sim active/set/submit/onSubmit and app.loadStyles (once per sheet, bad name rejected) OK');

    // settings: quick-read switch, default on, saved as settings.quick.enabled
    await page.evaluate(() => globalThis.__GSL_E2E__.app.nav.root('settings'));
    await page.locator('[data-screen="settings"]').waitFor({ state: 'visible', timeout: 20000 });
    const sw = page.locator('[data-testid="settings-quick"]');
    await sw.waitFor({ state: 'attached', timeout: 10000 });
    const input = sw; // components.js switchRow puts the testid on the role="switch" button
    const on0 = await input.evaluate((el) => el.getAttribute('aria-checked') === 'true');
    need(on0 === true, 'settings-quick must default to on');
    await input.click();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gsl-settings-v2') ?? '{}').quick ?? null);
    need(saved?.enabled === false, `settings-quick off not saved: ${JSON.stringify(saved)}`);
    notes.push('settings-quick: default on, off saved as settings.quick.enabled = false');

    need(w.errors.length === 0, `page errors: ${w.errors.slice(0, 3).join(' | ')}`);
    need(w.external.length === 0, `requests left the origin: ${w.external.slice(0, 3).join(', ')}`);
    await context.close();
  } finally {
    await browser.close();
  }
  return notes.join('\n');
}
