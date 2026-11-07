// Gate lm-a-shell (LAUNCH-MONITOR-SPEC §5.2 LM-A acceptance 6): the launch-monitor shell additions in Chromium at
// 390 × 844, zh-Hant.
//  * the 4 new screens (drills, drill, stats, gapping) navigate: visible, document.title = "<title> – <app name>",
//    focus on the screen's <h1> (A11Y-1), the right tab is current, no horizontal scroll at 200 % text
//  * theme = auto: the data screens' roots (shot, stats, gapping, drill) carry data-live-theme="dark"; light removes it
//  * a fresh profile starts with theme 'dark' (D1); app.drill and app.e2e.registerState exist and work (§5.0-8, -13)
//  * no page error, no request leaves the origin
import fs from 'node:fs';
import path from 'node:path';
import { launch, watchPage, need, waitFor, ROOT } from '../lib.mjs';
import { noHScroll, focusOnH1, setTextScale } from '../checks.mjs';

export const meta = { id: 'lm-a-shell', title: 'LM-A drop 1: 4 new screens (title, h1 focus, tab, 200 % text), data screens dark on auto, app.drill, app.e2e', timeoutMs: 180000 };

const NEW = Object.freeze({ drills: 'practice', drill: 'practice', stats: 'history', gapping: 'history' });
const TITLES = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/i18n/zh-Hant/screen.json'), 'utf8'));
const APP_NAME = '揮桿實驗室';

async function go(page, id, params = {}) {
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

    // D1: a new install starts dark
    const theme0 = await page.evaluate(() => globalThis.__GSL_E2E__.app.settings().theme);
    need(theme0 === 'dark', `fresh profile theme is ${theme0}, expected dark (D1)`);

    const bad = [];
    for (const [id, tab] of Object.entries(NEW)) {
      await go(page, id);
      const title = await page.title();
      if (title !== `${TITLES[`${id}.title`]} – ${APP_NAME}`) bad.push(`${id}: title "${title}"`);
      const f = await focusOnH1(page);
      if (!f.ok) bad.push(`${id}: focus on ${f.active}`);
      const cur = await page.evaluate(() => document.querySelector('#tabbar .tab[aria-current="page"]')?.dataset.tab ?? null);
      if (cur !== tab) bad.push(`${id}: current tab ${cur}, expected ${tab}`);
      if (await page.locator('#tabbar').isHidden()) bad.push(`${id}: tab bar hidden`);
      await setTextScale(page, 2);
      await page.waitForTimeout(150);
      const h = await noHScroll(page);
      if (!h.ok) bad.push(`${id}: h-scroll at 200 % (${h.scrollWidth} > ${h.clientWidth})`);
      await setTextScale(page, 1);
    }
    need(bad.length === 0, bad.join('; '));
    notes.push(`4 new screens: title, h1 focus, tab, 200 % text OK`);

    // data screens dark while the theme is auto (§4.1); explicit light / sun win
    const shot = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/shots/v2/valid_face_on_240.json'), 'utf8'));
    await setTheme(page, 'auto');
    await go(page, 'shot', { shot });
    need(await liveTheme(page, 'shot') === 'dark', `theme auto: shot root data-live-theme=${await liveTheme(page, 'shot')}`);
    for (const id of ['stats', 'gapping', 'drill']) need(await liveTheme(page, id) === 'dark', `theme auto: ${id} root data-live-theme=${await liveTheme(page, id)}`);
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('[data-screen="shot"]')).getPropertyValue('--bg').trim());
    need(/^#07100b$/i.test(bg), `theme auto: shot --bg ${bg}, expected the dark #07100B`);
    for (const th of ['light', 'sun']) {
      await setTheme(page, th);
      need(await liveTheme(page, 'shot') === null, `theme ${th}: shot root still has data-live-theme`);
    }
    await setTheme(page, 'auto');
    need(await liveTheme(page, 'home') === null, 'home must not be forced dark');
    notes.push('theme auto: shot / stats / gapping / drill roots data-live-theme="dark"; light and sun remove it');

    // app.drill and app.e2e (FROZEN shapes)
    const api = await page.evaluate(async () => {
      const app = globalThis.__GSL_E2E__.app;
      const seen = [];
      const off = app.drill.onChange((d) => seen.push(d?.drill_id ?? null));
      const before = app.drill.current();
      app.drill.set({ drill_id: 'd-e2e', template: 'distance18' });
      const mid = app.drill.current()?.drill_id;
      app.drill.set(null);
      off();
      app.drill.set({ drill_id: 'after-off' });
      app.drill.set(null);
      app.e2e.registerState('drills', 'lm-a-probe', async (a) => { a.__lmProbe = (a.__lmProbe ?? 0) + 1; return 'ran'; });
      const r = await app.e2e.runState('drills', 'lm-a-probe', app);
      let missing = null;
      try { await app.e2e.runState('drills', 'nope'); } catch (e) { missing = e.code; }
      return { before, mid, seen, r, missing, has: app.e2e.has('drills', 'lm-a-probe'), listed: app.e2e.states().includes('drills:lm-a-probe') };
    });
    need(api.before === null && api.mid === 'd-e2e', `app.drill current: ${JSON.stringify(api)}`);
    need(JSON.stringify(api.seen) === JSON.stringify(['d-e2e', null]), `app.drill onChange: ${JSON.stringify(api.seen)}`);
    need(api.r === 'ran' && api.has && api.listed && api.missing === 'E2E_STATE_MISSING', `app.e2e: ${JSON.stringify(api)}`);
    notes.push('app.drill current/set/onChange and app.e2e registerState/runState OK');

    need(w.errors.length === 0, `page errors: ${w.errors.slice(0, 3).join(' | ')}`);
    need(w.external.length === 0, `requests left the origin: ${w.external.slice(0, 3).join(', ')}`);
    await context.close();
  } finally {
    await browser.close();
  }
  return notes.join('\n');
}
