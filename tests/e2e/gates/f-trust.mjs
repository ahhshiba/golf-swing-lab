// Gates of WP-F (trust): Settings, About, Privacy, Licences, Help, Developer (PRODUCT-SPEC WP-F acceptance).
//  f-about     about-version = precache-manifest version as "0.1.0 · build xxxxxxx" (never "dev"); no GolfDB /
//              non-commercial / CC BY-NC text on About (zh-Hant + en); the licences page shows the Apache-2.0 and
//              BSD-3-Clause texts (and the ISC text of the icon style).
//  f-privacy   privacy-delete-all → confirm sheet → after confirm: IndexedDB has 0 shots, localStorage has no gsl-*
//              keys, the diag mirror lost its pre-delete content, and the app shows onboarding again.
//  f-settings  settings-locale = en → no CJK on home, settings, about (the native name 繁體中文 on the language
//              switch is the one allowed exception); settings-units = m → carry of a fixture shot in m (yd before);
//              settings-theme = sun → <html data-theme="sun">; developer section hidden until 7 taps on the version;
//              no spec codes with settings.dev=false; shared checks (targets, names, contrast, no h-scroll at 100 % and
//              200 % text) on every F page at 390 px light + dark.
import fs from 'node:fs';
import path from 'node:path';
import { launch, watchPage, need, ROOT, FIXTURES } from '../lib.mjs';
import { noHScroll, minTargets, contrastOfRendered, accessibleNames, noCJK, noSpecCodes, focusOnH1, setTextScale } from '../checks.mjs';

const FORBIDDEN = /GolfDB|非商業|non-commercial|CC BY-NC/i;
const NATIVE_LANGUAGE_NAMES = new Set(['繁體中文']);

/** Seed once per tab (sessionStorage flag outside our gsl* keys): onboarding done, so screens are reachable. */
async function newPage(browser, ctx, { locale = 'zh-TW', colorScheme = 'light', seed = true } = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block', locale, colorScheme, viewport: { width: 390, height: 844 } });
  if (seed) {
    await context.addInitScript(() => {
      globalThis.__GSL_E2E__ = { ...(globalThis.__GSL_E2E__ ?? {}), onboarding: true }; // home.js skips onboarding under webdriver without this seam
      try {
        if (sessionStorage.getItem('f-e2e-seeded')) return;
        sessionStorage.setItem('f-e2e-seeded', '1');
        const s = JSON.parse(localStorage.getItem('gsl-settings-v2') || '{}');
        localStorage.setItem('gsl-settings-v2', JSON.stringify({ ...s, onboarding: { done_v: 99 } }));
      } catch (_) { /* storage blocked */ }
    });
  }
  const page = await context.newPage();
  const w = watchPage(page);
  await page.goto(ctx.baseUrl);
  await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
  return { context, page, w };
}

const visible = (page, tid) => page.locator(`[data-testid="${tid}"]:visible`).first();
async function clickTid(page, tid, timeout = 10000) {
  const el = visible(page, tid);
  await el.waitFor({ state: 'visible', timeout });
  await el.click();
}
async function toSettings(page) {
  for (const tid of ['tabbar-settings', 'nav-settings']) {
    if (await page.locator(`[data-testid="${tid}"]:visible`).count()) { await clickTid(page, tid); break; }
  }
  await page.locator('[data-screen="settings"]:not([hidden])').waitFor({ timeout: 10000 });
  await page.waitForTimeout(300);
}
async function toHome(page) {
  for (const tid of ['tabbar-practice', 'nav-home']) {
    if (await page.locator(`[data-testid="${tid}"]:visible`).count()) { await clickTid(page, tid); await page.locator('[data-screen="home"]:not([hidden])').waitFor({ timeout: 10000 }); return; }
  }
  for (let i = 0; i < 6 && !(await page.locator('[data-screen="home"]:not([hidden])').count()); i++) {
    await page.locator('main [data-screen]:not([hidden]) .screen-header button.back').first().click();
    await page.waitForTimeout(300);
  }
  await page.locator('[data-screen="home"]:not([hidden])').waitFor({ timeout: 10000 });
}
async function back(page) {
  await page.locator('main [data-screen]:not([hidden]) .screen-header button.back').first().click();
  await page.waitForTimeout(300);
}
const pageText = (page) => page.evaluate(() => document.querySelector('main [data-screen]:not([hidden])')?.innerText ?? '');
const cjkHits = async (page) => (await noCJK(page)).hits.filter((s) => !NATIVE_LANGUAGE_NAMES.has(s));

function expectedVersion(dist) {
  const m = JSON.parse(fs.readFileSync(path.join(dist, 'precache-manifest.json'), 'utf8'));
  const mm = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\+([0-9a-f]+)$/i.exec(m.version);
  need(mm, `precache-manifest version "${m.version}" is not <semver>+<hash>`);
  return { zh: `${mm[1]} · build ${mm[2].slice(0, 7)}`, en: `${mm[1]} · build ${mm[2].slice(0, 7)}`, raw: m.version };
}

async function openLicences(page) {
  await clickTid(page, 'about-licences');
  await visible(page, 'licence-text-mediapipe').waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
  await page.evaluate(() => { for (const d of document.querySelectorAll('main [data-screen]:not([hidden]) details.licence-details')) d.open = true; });
  await page.waitForFunction(() => [...document.querySelectorAll('pre.licence-text')].filter((p) => !p.closest('[hidden]')).every((p) => p.textContent.length > 200), null, { timeout: 10000 });
}

// ------------------------------------------------------------------ f-about
async function runAbout(ctx) {
  const browser = await launch(ctx);
  const notes = [];
  try {
    const want = expectedVersion(ctx.dist);
    for (const [locale, lang] of [['zh-TW', 'zh'], ['en-US', 'en']]) {
      const { context, page, w } = await newPage(browser, ctx, { locale });
      await toSettings(page);
      await clickTid(page, 'settings-about');
      const ver = visible(page, 'about-version');
      await page.waitForFunction(() => /build|\d+\.\d+\.\d+/.test(document.querySelector('[data-testid="about-version"]:not([hidden])')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
      const vt = (await ver.textContent()).trim();
      need(vt === want[lang], `${lang}: about-version "${vt}" != "${want[lang]}" (manifest ${want.raw})`);
      need(!/\bdev\b/i.test(vt), `${lang}: version shows "dev"`);
      const txt = await pageText(page);
      need(!FORBIDDEN.test(txt), `${lang}: About contains ${txt.match(FORBIDDEN)?.[0]}`);
      const sc = await noSpecCodes(page);
      need(sc.ok, `${lang}: spec codes on About: ${sc.hits.slice(0, 3).join(' | ')}`);
      await openLicences(page);
      const lic = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('pre.licence-text')].filter((p) => !p.closest('[hidden]')).map((p) => [p.dataset.testid, p.textContent])));
      need(/Apache License/.test(lic['licence-text-mediapipe'] ?? '') && /Version 2\.0/.test(lic['licence-text-mediapipe'] ?? ''), `${lang}: Apache-2.0 text missing`);
      need(/Redistribution and use in source and binary forms/.test(lic['licence-text-mp4box'] ?? ''), `${lang}: BSD-3-Clause text missing`);
      need(/ISC License/.test(lic['licence-text-icons'] ?? ''), `${lang}: ISC text missing`);
      need(!FORBIDDEN.test(await pageText(page)), `${lang}: licences page contains forbidden licence wording`);
      need(w.external.length === 0, `${lang}: external requests ${w.external.slice(0, 3).join(', ')}`);
      need(w.errors.length === 0, `${lang}: page errors ${w.errors.slice(0, 3).join(' | ')}`);
      notes.push(`${lang} "${vt}"`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return `about-version ${notes.join(', ')}; no GolfDB / non-commercial; Apache-2.0 + BSD-3-Clause + ISC texts shown`;
}

// ------------------------------------------------------------------ f-privacy
async function seedData(page, base, shot) {
  return page.evaluate(async ([b, shot]) => {
    const core = await import(`${b}src/store/core.js`);
    const { idbBackend } = await import(`${b}src/store/idb.js`);
    const repo = await core.openRepository(idbBackend());
    await repo.put('shots', shot);
    const n = (await repo.list('shots')).length;
    await repo.close();
    localStorage.setItem('gsl-e2e-marker', '1');
    const d = await import(`${b}src/diag/record.js`);
    d.record?.('f_e2e.marker', 'before-delete');
    return n;
  }, [base, shot]);
}

async function runPrivacy(ctx) {
  const browser = await launch(ctx);
  try {
    const shot = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/shots/valid_face_on_240.json'), 'utf8'));
    const { context, page, w } = await newPage(browser, ctx);
    const before = await seedData(page, ctx.baseUrl, shot);
    need(before >= 1, `could not seed a shot (shots = ${before})`);
    await page.reload();
    await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
    await toSettings(page);
    await clickTid(page, 'settings-privacy');
    const sc = await noSpecCodes(page);
    need(sc.ok, `spec codes on Privacy: ${sc.hits.slice(0, 3).join(' | ')}`);
    await clickTid(page, 'privacy-delete-all');
    const sheet = page.locator('[data-testid="delete-all"]');
    await sheet.waitFor({ state: 'visible', timeout: 5000 });
    // the safe action is the primary one: cancelling keeps everything
    await clickTid(page, 'delete-all-cancel');
    await page.waitForTimeout(300);
    need(await page.evaluate(() => localStorage.getItem('gsl-e2e-marker')) === '1', 'cancel deleted data');
    await clickTid(page, 'privacy-delete-all');
    await sheet.waitFor({ state: 'visible', timeout: 5000 });
    const nav = page.waitForEvent('load', { timeout: 20000 });
    await clickTid(page, 'delete-all-confirm');
    await nav;
    await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
    await page.waitForTimeout(500);
    const after = await page.evaluate(async (b) => {
      const core = await import(`${b}src/store/core.js`);
      const { idbBackend } = await import(`${b}src/store/idb.js`);
      const repo = await core.openRepository(idbBackend());
      const shots = (await repo.list('shots')).length;
      const trash = repo.stores.trash ? (await repo.list('trash')).length : 0;
      await repo.close();
      const keys = Object.keys(localStorage);
      return { shots, trash, gslDash: keys.filter((k) => k.startsWith('gsl-')), diag: localStorage.getItem('gsl.diag/1') ?? '' };
    }, ctx.baseUrl);
    need(after.shots === 0 && after.trash === 0, `after delete-all: ${after.shots} shots, ${after.trash} in trash`);
    need(after.gslDash.length === 0, `after delete-all: localStorage still has ${after.gslDash.join(', ')}`);
    need(!after.diag.includes('before-delete'), 'after delete-all: the diag mirror still holds pre-delete records');
    const onb = page.locator('[data-screen="onboarding"]:not([hidden]), [data-testid="onb-next"]:visible, [data-testid="onb-skip"]:visible');
    await onb.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    need(await onb.count() > 0, 'after delete-all the app does not show onboarding (B: onboarding screen / onb-next)');
    need(w.external.length === 0, `external requests ${w.external.slice(0, 3).join(', ')}`);
    await context.close();
    return `seeded ${before} shot → delete-all: 0 shots, 0 gsl-* keys, diag reset, onboarding shown`;
  } finally {
    await browser.close();
  }
}

// ------------------------------------------------------------------ f-settings
async function sharedChecks(page, tag, out) {
  for (const k of [1, 2]) {
    await setTextScale(page, k);
    await page.waitForTimeout(100);
    const hs = await noHScroll(page);
    need(hs.ok, `${tag} @${k}x: horizontal scroll ${hs.scrollWidth} > ${hs.clientWidth}`);
  }
  await setTextScale(page, 1);
  const mt = await minTargets(page, 44);
  need(mt.ok, `${tag}: targets < 44 px: ${JSON.stringify(mt.offenders.slice(0, 4))}`);
  const an = await accessibleNames(page);
  need(an.ok, `${tag}: controls without names: ${JSON.stringify(an.offenders.slice(0, 3))}`);
  const cr = await contrastOfRendered(page);
  need(cr.ok, `${tag}: contrast: ${JSON.stringify(cr.offenders.slice(0, 4))}`);
  const sc = await noSpecCodes(page);
  need(sc.ok, `${tag}: spec codes: ${sc.hits.slice(0, 3).join(' | ')}`);
  out.push(tag);
}

async function importFixtureShot(page) {
  const file = path.join(FIXTURES, 'f_settings_import.json');
  fs.mkdirSync(FIXTURES, { recursive: true });
  const shot = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/shots/valid_face_on_240.json'), 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ format: 'golf-swing-lab-export/1', exported_at: '2026-11-04T00:00:00.000Z', app_version: '0.1.0', venues: [], presets: [], sessions: [], shots: [shot] }));
  for (const tid of ['tabbar-history', 'nav-history']) if (await page.locator(`[data-testid="${tid}"]:visible`).count()) { await clickTid(page, tid); break; }
  await page.locator('[data-screen="history"]:not([hidden])').waitFor({ timeout: 10000 });
  await page.locator('[data-testid="history-import-input"]').first().setInputFiles(file);
}
async function openShotText(page) {
  for (const tid of ['tabbar-history', 'nav-history']) if (await page.locator(`[data-testid="${tid}"]:visible`).count()) { await clickTid(page, tid); break; }
  await page.locator('[data-screen="history"]:not([hidden])').waitFor({ timeout: 10000 });
  const row = page.locator('[data-testid="shot-row"]:visible').first();
  await row.waitFor({ state: 'visible', timeout: 15000 });
  await row.click();
  await page.locator('[data-screen="shot"]:not([hidden])').waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  return pageText(page);
}

async function runSettings(ctx) {
  const browser = await launch(ctx);
  const checked = [];
  const notes = [];
  try {
    // shared checks on every F page, light + dark, zh-Hant + en, with settings.dev = false (settings, storage, privacy, help, about, licences)
    for (const [locale, lang] of [['zh-TW', 'zh'], ['en-US', 'en']]) {
      for (const colorScheme of ['light', 'dark']) {
        const tag = `${lang}/${colorScheme}`;
        const { context, page, w } = await newPage(browser, ctx, { locale, colorScheme });
        await toSettings(page);
        const f = await focusOnH1(page);
        need(f.ok, `${tag}: focus after opening settings is ${f.active}`);
        need(!(await page.locator('[data-testid="settings-developer"]').count()), `${tag}: developer section visible with settings.dev=false`);
        await sharedChecks(page, `${tag} settings`, checked);
        for (const [row, name] of [['settings-storage', 'storage'], ['settings-privacy', 'privacy'], ['settings-help', 'help']]) {
          await clickTid(page, row);
          await page.waitForTimeout(500);
          await sharedChecks(page, `${tag} ${name}`, checked);
          if (lang === 'en') { const c = await cjkHits(page); need(!c.length, `${tag} ${name}: CJK ${c.slice(0, 3).join(' | ')}`); }
          await back(page);
        }
        await clickTid(page, 'settings-about');
        await page.waitForTimeout(500);
        await sharedChecks(page, `${tag} about`, checked);
        await openLicences(page);
        await sharedChecks(page, `${tag} licences`, checked);
        need(w.errors.length === 0, `${tag}: page errors ${w.errors.slice(0, 3).join(' | ')}`);
        need(w.external.length === 0, `${tag}: external requests ${w.external.slice(0, 3).join(', ')}`);
        await context.close();
      }
    }

    // behaviour: locale, units, theme, developer unlock (fresh zh-TW context)
    const { context, page, w } = await newPage(browser, ctx, { locale: 'zh-TW' });
    // units: yd by default on a fixture shot, m after the switch
    await importFixtureShot(page);
    const yd = await openShotText(page);
    need(/198\s*(yd|碼)/.test(yd), `carry not shown as 198 yd by default (C: shot card through fmtMetric); shot text: ${yd.replace(/\s+/g, ' ').slice(0, 160)}`);
    await toSettings(page);
    await page.locator('[data-testid="settings-units"] [data-value="m"]').click();
    need(await page.evaluate(() => JSON.parse(localStorage.getItem('gsl-settings-v2')).units.distance) === 'm', 'settings-units = m was not saved');
    const m = await openShotText(page);
    need(/181\s*(m|公尺)(?![/a-z])/.test(m) && !/198\s*(yd|碼)/.test(m), `carry not in m after settings-units = m; shot text: ${m.replace(/\s+/g, ' ').slice(0, 160)}`);
    notes.push('carry 198 yd → 181 m');
    // theme
    await toSettings(page);
    await page.locator('[data-testid="settings-theme"] [data-value="sun"]').click();
    need(await page.evaluate(() => document.documentElement.dataset.theme) === 'sun', 'settings-theme = sun did not set <html data-theme="sun">');
    await page.reload();
    await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
    need(await page.evaluate(() => document.documentElement.dataset.theme) === 'sun', 'sun theme not applied after reload');
    notes.push('sun theme persists');
    // developer: hidden, 6 taps not enough, 7th unlocks
    await toSettings(page);
    need(!(await page.locator('[data-testid="settings-developer"]').count()), 'developer row visible before unlocking');
    await clickTid(page, 'settings-about');
    const vrow = visible(page, 'about-version-row');
    for (let i = 0; i < 6; i++) await vrow.click();
    need(!(await page.evaluate(() => JSON.parse(localStorage.getItem('gsl-settings-v2')).dev)), 'developer options on after 6 taps');
    await vrow.click();
    need(await page.evaluate(() => JSON.parse(localStorage.getItem('gsl-settings-v2')).dev) === true, 'developer options not on after 7 taps');
    await back(page);
    await toSettings(page);
    await visible(page, 'settings-developer').waitFor({ state: 'visible', timeout: 5000 });
    await clickTid(page, 'settings-developer');
    await visible(page, 'model-status').waitFor({ state: 'visible', timeout: 5000 });
    notes.push('developer: hidden → 7 taps → visible');
    await clickTid(page, 'dev-off');
    await page.waitForTimeout(300);
    need(!(await page.locator('[data-testid="settings-developer"]:visible').count()), 'developer row still visible after turning it off');
    // locale: en → no CJK on settings, home, about
    await toSettings(page);
    await page.locator('[data-testid="settings-locale"] [data-value="en"]').click();
    await page.waitForFunction(() => document.documentElement.lang === 'en', null, { timeout: 10000 });
    await page.waitForTimeout(500);
    need(await page.evaluate(() => document.title.startsWith('Settings')), `title after switching to en: ${await page.title()}`);
    let c = await cjkHits(page);
    need(!c.length, `en settings: CJK ${c.slice(0, 4).join(' | ')}`);
    await clickTid(page, 'settings-about');
    await page.waitForTimeout(400);
    c = await cjkHits(page);
    need(!c.length, `en about: CJK ${c.slice(0, 4).join(' | ')}`);
    await toHome(page);
    await page.waitForTimeout(400);
    c = await cjkHits(page);
    need(!c.length, `en home: CJK ${c.slice(0, 4).join(' | ')} (B: home.js strings)`);
    await page.reload();
    await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
    need(await page.evaluate(() => document.documentElement.lang) === 'en', 'locale en not kept after reload');
    notes.push('en: no CJK on settings/about/home');
    need(w.errors.length === 0, `page errors ${w.errors.slice(0, 3).join(' | ')}`);
    need(w.external.length === 0, `external requests ${w.external.slice(0, 3).join(', ')}`);
    await context.close();
  } finally {
    await browser.close();
  }
  return `shared checks on ${checked.length} page views (zh/en × light/dark × 100/200 %); ${notes.join('; ')}`;
}

export const gates = [
  { meta: { id: 'f-about', title: 'WP-F About: build version, no GolfDB / non-commercial, licence texts', timeoutMs: 120000 }, run: runAbout },
  { meta: { id: 'f-privacy', title: 'WP-F Privacy: delete all data → empty store, no gsl-* keys, onboarding again', timeoutMs: 120000 }, run: runPrivacy },
  { meta: { id: 'f-settings', title: 'WP-F Settings: locale en, units m, sun theme, developer unlock, shared checks', timeoutMs: 300000 }, run: runSettings },
];
