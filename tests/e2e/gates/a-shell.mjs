// Gate a-shell (WP-A acceptance, PRODUCT-SPEC §8 WP-A): the app shell in Chromium at 390 × 844, light + dark.
//  * every screen (home, venue, setup, live, import, shot, history, diag, settings, about): after navigation
//    document.title = "<screen title> – <app name>" and focus is on the screen's <h1> (A11Y-1)
//  * top stack (visual-m1): in setup with a practice session running and the page scrolled 700 px, the sticky screen
//    header's top is ≥ the top stack's bottom (they never overlap)
//  * 200 % text (A11Y-3): html { font-size: 200% } → no horizontal scroll on any of the 10 screens
//  * tab bar: three tabs, every target ≥ 44 × 44 px, aria-current on the active tab, hidden on setup / live
//  * CSP (PV-1): 0 securitypolicyviolation events across all screens; a cross-origin fetch probe is blocked
//  * R4: an error thrown in a click handler shows a role=alert toast and appends to diag events[]
//  * R3: indexedDB.open stubbed to never settle → within 9 s a visible 重新載入 / Reload control (repo banner or the
//    start-up error state), and #app-ready with data-repo="0"
import fs from 'node:fs';
import path from 'node:path';
import { launch, watchPage, need, waitFor, ROOT } from '../lib.mjs';
import { noHScroll, minTargets, focusOnH1, setTextScale } from '../checks.mjs';

export const meta = { id: 'a-shell', title: 'WP-A shell: title/focus per screen, top stack, 200 % text, tab bar, CSP, error toast, IDB hang', timeoutMs: 300000 };

export const SCREEN_IDS = Object.freeze(['home', 'venue', 'setup', 'live', 'import', 'shot', 'history', 'diag', 'settings', 'about']);
const TITLES = { 'zh-Hant': JSON.parse(fs.readFileSync(path.join(ROOT, 'app/i18n/zh-Hant/screen.json'), 'utf8')), en: JSON.parse(fs.readFileSync(path.join(ROOT, 'app/i18n/en/screen.json'), 'utf8')) };
const APP_NAME = { 'zh-Hant': '揮桿實驗室', en: 'Golf Swing Lab' };

const CSP_PROBE = () => {
  window.__gslCsp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__gslCsp.push(`${e.violatedDirective} ${e.blockedURI} @ ${String(e.sourceFile).replace(/^.*\/golf-swing-lab\//, "")}:${e.lineNumber} [${document.querySelector("[data-screen]:not([hidden])")?.dataset.screen} ${e.sample || ""}]`));
  globalThis.__GSL_E2E__ = globalThis.__GSL_E2E__ ?? {};
};

async function go(page, id, params = {}) {
  await page.evaluate(([s, p]) => globalThis.__GSL_E2E__.app.nav.go(s, p), [id, params]);
  await page.locator(`[data-screen="${id}"]`).waitFor({ state: 'visible', timeout: 20000 });
  // (page.waitForFunction evaluates its predicate with eval in some states, which the CSP reports: poll instead)
  await waitFor(() => page.evaluate((s) => Boolean(document.activeElement?.closest?.(`[data-screen="${s}"]`)), id), { timeout: 8000, interval: 100, what: `focus inside ${id}` }).catch(() => {});
  await page.waitForTimeout(250);
}

async function oneTheme(browser, ctx, colorScheme, notes) {
  const tag = `zh-Hant/${colorScheme}`;
  const context = await browser.newContext({ serviceWorkers: 'block', colorScheme, viewport: { width: 390, height: 844 }, permissions: ['camera', 'microphone'] });
  await context.addInitScript(CSP_PROBE);
  const page = await context.newPage();
  const w = watchPage(page);
  await page.goto(ctx.baseUrl);
  await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
  await page.evaluate(() => globalThis.__GSL_E2E__.app.ready());
  const shot = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/shots/valid_face_on_240.json'), 'utf8'));
  const bad = { title: [], focus: [], hscroll: [] };
  for (const id of SCREEN_IDS) {
    if (id === 'setup' || id === 'live') continue; // need a practice session: below
    await go(page, id, id === 'shot' ? { shot } : {});
    const title = await page.title();
    if (title !== `${TITLES['zh-Hant'][`${id}.title`]} – ${APP_NAME['zh-Hant']}`) bad.title.push(`${id}: "${title}"`);
    const f = await focusOnH1(page);
    if (!f.ok) bad.focus.push(`${id}: ${f.active}`);
  }
  // tab bar
  const tabs = page.locator('#tabbar .tab');
  need(await tabs.count() === 3, `${tag}: tab bar has ${await tabs.count()} tabs`);
  await page.locator('[data-testid="tabbar-history"]').click();
  await page.locator('[data-screen="history"]').waitFor({ state: 'visible' });
  need(await page.locator('[data-testid="tabbar-history"][aria-current="page"]').count() === 1, `${tag}: History tab not marked current`);
  const tabTargets = await page.evaluate(() => [...document.querySelectorAll('#tabbar .tab')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  need(tabTargets.every(([x, y]) => x >= 44 && y >= 44), `${tag}: tab targets ${JSON.stringify(tabTargets)} < 44 px`);
  // practice session: setup → (scroll) → live
  await page.locator('[data-testid="tabbar-practice"]').click();
  await page.locator('[data-screen="home"]').waitFor({ state: 'visible' });
  await page.locator('[data-testid="btn-start-practice"], #start-practice').first().click();
  await page.locator('[data-screen="setup"]').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1200);
  need(await page.locator('#tabbar').isHidden(), `${tag}: tab bar visible on setup`);
  const setupTitle = await page.title();
  if (setupTitle !== `${TITLES['zh-Hant']['setup.title']} – ${APP_NAME['zh-Hant']}`) bad.title.push(`setup: "${setupTitle}"`);
  const fs1 = await focusOnH1(page);
  if (!fs1.ok) bad.focus.push(`setup: ${fs1.active}`);
  // make the page tall enough to scroll 700 px even when the setup screen is short, then compare rects
  await page.evaluate(() => { const pad = document.createElement('div'); pad.id = 'a-shell-pad'; pad.style.height = '2000px'; document.querySelector('[data-screen="setup"]').append(pad); });
  await page.evaluate(() => window.scrollTo(0, 700));
  await page.waitForTimeout(200);
  const overlap = await page.evaluate(() => {
    const top = document.getElementById('top-stack').getBoundingClientRect();
    const hdr = document.querySelector('[data-screen="setup"] .screen-header, [data-screen="setup"] header');
    const bar = document.getElementById('session-bar');
    return { stackBottom: Math.round(top.bottom), headerTop: hdr ? Math.round(hdr.getBoundingClientRect().top) : null, barVisible: bar && !bar.hidden, scrollY: Math.round(scrollY) };
  });
  await page.evaluate(() => document.getElementById('a-shell-pad')?.remove());
  need(overlap.barVisible, `${tag}: session bar not shown during practice`);
  need(overlap.headerTop !== null, `${tag}: setup screen has no sticky header`);
  need(overlap.headerTop >= overlap.stackBottom - 0.5, `${tag}: header top ${overlap.headerTop} < top-stack bottom ${overlap.stackBottom} after scrolling ${overlap.scrollY} px`);
  const seen200 = [];
  await setTextScale(page, 2);
  for (const id of ['setup']) { const r = await noHScroll(page); if (!r.ok) bad.hscroll.push(`${id}: ${r.scrollWidth} > ${r.clientWidth}`); seen200.push(id); }
  await setTextScale(page, 1);
  await page.evaluate(() => window.scrollTo(0, 0));
  const skip = page.locator('[data-testid="btn-skip-setup"]');
  await skip.click();
  await page.locator('[data-screen="live"]').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1500);
  need(await page.locator('#tabbar').isHidden(), `${tag}: tab bar visible on live`);
  const liveTitle = await page.title();
  if (liveTitle !== `${TITLES['zh-Hant']['live.title']} – ${APP_NAME['zh-Hant']}`) bad.title.push(`live: "${liveTitle}"`);
  const fl = await focusOnH1(page);
  if (!fl.ok) bad.focus.push(`live: ${fl.active}`);
  await setTextScale(page, 2);
  { const r = await noHScroll(page); if (!r.ok) bad.hscroll.push(`live: ${r.scrollWidth} > ${r.clientWidth}`); seen200.push('live'); }
  await setTextScale(page, 1);
  // 200 % text on the other screens (session still running: the top stack is visible too)
  for (const id of SCREEN_IDS.filter((x) => x !== 'setup' && x !== 'live')) {
    await go(page, id, id === 'shot' ? { shot } : {});
    await setTextScale(page, 2);
    await page.waitForTimeout(150);
    const r = await noHScroll(page);
    if (!r.ok) bad.hscroll.push(`${id}: ${r.scrollWidth} > ${r.clientWidth}`);
    seen200.push(id);
    await setTextScale(page, 1);
  }
  const tt = await minTargets(page, 44);
  void tt;
  // CSP: probe + violation count
  const probe = await page.evaluate(async () => { try { await fetch('https://example.com/x', { mode: 'no-cors' }); return 'fetched'; } catch (e) { return `blocked: ${e.name}`; } });
  await page.waitForTimeout(300);
  const csp = await page.evaluate(() => window.__gslCsp ?? []);
  const cspNonProbe = csp.filter((v) => !/example\.com/.test(v));
  // error in a click handler → role=alert toast + diag events[]
  await page.evaluate(() => { const b = document.createElement('button'); b.id = 'a-boom'; b.textContent = 'boom'; b.addEventListener('click', () => { throw Object.assign(new Error('boom'), { code: 'FILE_TRUNCATED' }); }); document.querySelector('[data-screen]:not([hidden])').prepend(b); window.scrollTo(0, 0); });
  await page.locator('#a-boom').click();
  await page.locator('#toast-alert[role="alert"]').waitFor({ state: 'visible', timeout: 5000 });
  const events = await page.evaluate(async (b) => { const r = await import(`${b}src/diag/record.js`); return typeof r.events === 'function' ? r.events() : r.get('events') ?? null; }, ctx.baseUrl);
  const lastEv = Array.isArray(events) ? events.at(-1) : null;
  await context.close();
  need(probe.startsWith('blocked'), `${tag}: cross-origin fetch probe was not blocked (${probe})`);
  need(csp.some((v) => /example\.com/.test(v)), `${tag}: the probe raised no securitypolicyviolation (CSP missing?)`);
  need(cspNonProbe.length === 0, `${tag}: ${cspNonProbe.length} CSP violation(s): ${cspNonProbe.slice(0, 4).join(' | ')}`);
  need(lastEv && lastEv.code === 'FILE_TRUNCATED' && lastEv.kind === 'error', `${tag}: diag events[] last = ${JSON.stringify(lastEv)}`);
  need(bad.title.length === 0, `${tag}: document.title wrong on ${bad.title.join('; ')}`);
  need(bad.focus.length === 0, `${tag}: focus not on the screen h1 after navigating to ${bad.focus.join('; ')}`);
  need(bad.hscroll.length === 0, `${tag}: horizontal scroll at 200 % text on ${bad.hscroll.join('; ')}`);
  need(seen200.length === 10, `${tag}: 200 % checked on ${seen200.length} screens`);
  need(w.external.length === 0, `${tag}: requests left the origin: ${w.external.slice(0, 3).join(', ')}`);
  notes.push(`${colorScheme}: 10 screens title/focus/200 % OK, header ${overlap.headerTop} ≥ stack ${overlap.stackBottom} at scrollY ${overlap.scrollY}, tabs ${tabTargets.map((x) => x.join('×')).join(' ')}, CSP probe ${probe}, 0 other violations`);
}

async function idbHang(browser, ctx, notes) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    const req = () => { const r = { readyState: 'pending', result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, addEventListener() {}, removeEventListener() {} }; return r; };
    try { Object.defineProperty(window.indexedDB, 'open', { value: () => req(), configurable: true }); } catch (_) { window.indexedDB.open = () => req(); }
  });
  const page = await context.newPage();
  const t0 = Date.now();
  await page.goto(ctx.baseUrl);
  const reload = page.locator('#repo-banner:not([hidden]) .repo-reload, #boot-error:not([hidden]) [data-boot="reload"]').first();
  await reload.waitFor({ state: 'visible', timeout: 9000 });
  const ms = Date.now() - t0;
  const label = (await reload.textContent()).trim();
  need(label === '重新載入', `IDB hang: reload control says "${label}"`);
  await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 9000 });
  const repo = await page.locator('#app-ready').getAttribute('data-repo');
  need(repo === '0', `IDB hang: #app-ready data-repo=${repo}`);
  await context.close();
  notes.push(`IDB open never settles: "${label}" visible after ${ms} ms, #app-ready data-repo=0`);
}

export async function run(ctx) {
  const browser = await launch(ctx, { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const notes = [];
  try {
    for (const scheme of ['light', 'dark']) await oneTheme(browser, ctx, scheme, notes);
    await idbHang(browser, ctx, notes);
  } finally {
    await browser.close();
  }
  return notes.join('\n');
}
