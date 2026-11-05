// Gate a-contracts (WP-A drop 1): the frozen contracts work in the built app, in Chromium at 390 px,
// light + dark, zh-Hant + en: i18n loads (merged catalogs), <html lang> + document.title follow the locale and the
// screen, focus lands on the screen h1, every component renders with ≥ 44 px targets, accessible names and
// WCAG contrast, an uncaught error in a click handler becomes a role=alert toast + a diag record, no external requests.
import { launch, watchPage, need } from '../lib.mjs';
import { noHScroll, minTargets, contrastOfRendered, accessibleNames, noCJK, noSpecCodes, focusOnH1 } from '../checks.mjs';

export const meta = { id: 'a-contracts', title: 'WP-A drop 1: i18n, title/focus, components (targets, names, contrast), error toast', timeoutMs: 180000 };

async function gallery(page, base) {
  await page.evaluate(async (b) => {
    const C = await import(`${b}src/ui/components.js`);
    const { t } = await import(`${b}src/i18n/index.js`);
    const root = document.querySelector('[data-screen="home"]');
    const box = document.createElement('div');
    box.id = 'a-gallery';
    root.replaceChildren(C.screenHeader({ title: t('screen.history.title'), back: true, onBack() {} }), box);
    const lg = document.createElement('div');
    lg.className = 'list-group';
    lg.append(C.listRow({ icon: 'target', title: t('view.face_on'), value: t('club.7i'), onClick() {} }), C.listRow({ icon: 'club', title: t('mode.highspeed'), subtitle: t('mode.highspeed.hint'), onClick() {} }));
    const ps = C.progressSteps({ steps: [{ id: 'a', label: t('event.address') }, { id: 'b', label: t('event.top') }], onCancel() {} });
    ps.set('a', 'done'); ps.set('b', 'active'); ps.eta(9);
    box.append(
      C.button({ label: t('common.retry'), variant: 'primary', size: 'lg', block: true, icon: 'camera' }),
      C.button({ label: t('common.save'), variant: 'primary', size: 'lg', block: true, reason: t('error.CAMERA_DENIED') }),
      C.button({ label: t('common.choose_files'), variant: 'tinted', size: 'lg', icon: 'film' }),
      C.button({ label: t('common.cancel') }), C.button({ label: t('common.delete'), variant: 'destructive' }), C.button({ label: t('common.undo'), variant: 'plain' }),
      lg,
      C.segmented({ options: ['face_on', 'dtl', 'high_behind'].map((v) => [v, t(`view.${v}`)]), value: 'dtl', label: t('screen.setup.title') }),
      C.switchRow({ label: t('mode.live'), hint: t('mode.live.hint'), checked: true }),
      C.chipRow({ items: ['driver', '7i', 'pw'].map((c) => [c, t(`club.${c}`)]), value: '7i', label: t('screen.history.title') }),
      C.metricTile({ id: 'carry_m', size: 'hero', metric: { value: 127.3, unit: 'm', ci95: [125.1, 129.5], validity: 'estimated' } }),
      C.metricTile({ id: 'launch_h_deg', metric: { value: null, unit: 'deg', validity: 'not_observable' } }),
      C.statePill({ state: 'ready', text: t('validity.valid') }), C.statePill({ state: 'analysing', text: t('common.eta', { s: 6 }) }), C.statePill({ state: 'swinging', text: t('mode.live') }),
      C.notice({ variant: 'caution', title: t('reason.NO_CALIBRATION.short'), items: [t('reason.SPIN_ASSUMED.long')] }),
      C.notice({ variant: 'error', title: t('error.FILE_TRUNCATED'), body: t('error.FILE_TRUNCATED.fix') }),
      C.emptyState({ icon: 'film-off', title: t('reason.CLIP_NOT_SAVED.short'), body: t('reason.CLIP_NOT_SAVED.long'), action: { label: t('common.retry'), onClick() {} } }),
      ps.el,
      C.filePicker({ accept: 'video/*', multiple: true, variant: 'zone' }),
      C.filePicker({ accept: 'video/*' }),
    );
  }, base);
}

export async function run(ctx) {
  const browser = await launch(ctx);
  const notes = [];
  try {
    for (const [locale, lang, appName] of [['zh-TW', 'zh-Hant', '揮桿實驗室'], ['en-US', 'en', 'Golf Swing Lab']]) {
      for (const colorScheme of ['light', 'dark']) {
        const tag = `${lang}/${colorScheme}`;
        const context = await browser.newContext({ serviceWorkers: 'block', locale, colorScheme, viewport: { width: 390, height: 844 } });
        const page = await context.newPage();
        const w = watchPage(page);
        await page.goto(ctx.baseUrl);
        await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
        need(await page.evaluate(() => document.documentElement.lang) === lang, `${tag}: <html lang> is not ${lang}`);
        need((await page.title()).endsWith(`– ${appName}`), `${tag}: title "${await page.title()}" does not end with the app name`);
        need(await page.evaluate(() => typeof document.getElementById('i-camera')?.getBBox), `${tag}: icon sprite missing`);
        // navigation: title + focus on h1
        await page.locator('[data-testid="tabbar-settings"]').click();
        await page.locator('[data-screen="settings"]').waitFor({ state: 'visible' });
        await page.waitForTimeout(300);
        const settingsTitle = lang === 'en' ? 'Settings' : '設定';
        need((await page.title()).startsWith(settingsTitle), `${tag}: title after navigation is "${await page.title()}"`);
        const f = await focusOnH1(page);
        need(f.ok, `${tag}: focus after navigation is ${f.active}, not the screen h1`);
        await page.locator('[data-testid="tabbar-practice"]').click();
        await page.locator('[data-screen="home"]').waitFor({ state: 'visible' });
        // components
        await gallery(page, ctx.baseUrl);
        await page.waitForTimeout(300);
        const hs = await noHScroll(page);
        need(hs.ok, `${tag}: horizontal scroll ${hs.scrollWidth} > ${hs.clientWidth}`);
        const mt = await minTargets(page, 44);
        need(mt.ok, `${tag}: targets < 44 px: ${JSON.stringify(mt.offenders.slice(0, 5))}`);
        const an = await accessibleNames(page);
        need(an.ok, `${tag}: controls without accessible names: ${JSON.stringify(an.offenders.slice(0, 3))}`);
        const cr = await contrastOfRendered(page);
        need(cr.ok, `${tag}: contrast: ${JSON.stringify(cr.offenders.slice(0, 5))}`);
        const sc = await noSpecCodes(page);
        need(sc.ok, `${tag}: spec codes visible: ${sc.hits.slice(0, 3).join(' | ')}`);
        if (lang === 'en') {
          const cjk = await page.evaluate(() => [...document.querySelectorAll('#a-gallery *')].filter((e) => !e.children.length && /[㐀-鿿]/.test(e.textContent)).map((e) => e.textContent).slice(0, 3));
          need(cjk.length === 0, `${tag}: CJK in the en component gallery: ${cjk.join(' | ')}`);
        }
        // an uncaught error in a click handler → role=alert toast + diag record
        await page.evaluate(() => { const b = document.createElement('button'); b.id = 'a-boom'; b.textContent = 'boom'; b.addEventListener('click', () => { throw Object.assign(new Error('boom'), { code: 'FILE_TRUNCATED' }); }); document.querySelector('[data-screen]:not([hidden])').prepend(b); window.scrollTo(0, 0); });
        await page.locator('#a-boom').click();
        await page.locator('#toast-alert[role="alert"]').waitFor({ state: 'visible', timeout: 5000 });
        const alertText = await page.locator('#toast-alert .toast-text').textContent();
        need(alertText === (lang === 'en' ? 'The video file is incomplete' : '影片檔不完整'), `${tag}: error toast text "${alertText}"`);
        const rec = await page.evaluate(async (b) => (await import(`${b}src/diag/record.js`)).get?.('errors.last') ?? null, ctx.baseUrl).catch(() => null);
        need(rec && rec.code === 'FILE_TRUNCATED', `${tag}: diag errors.last = ${JSON.stringify(rec)}`);
        need(w.external.length === 0, `${tag}: external requests ${w.external.slice(0, 3).join(', ')}`);
        need(w.errors.filter((e) => !/boom/.test(e)).length === 0, `${tag}: page errors ${w.errors.join(' | ')}`);
        if (lang === 'en') notes.push(`en screens still showing CJK (other packages' files): ${(await noCJK(page)).hits.length}`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return `zh-Hant + en × light + dark at 390 px: lang/title/focus/components/error-toast OK; ${notes.join('; ')}`;
}
