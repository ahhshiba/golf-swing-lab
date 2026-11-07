#!/usr/bin/env node
// tests/e2e/screenshot_matrix.mjs — the integration screenshot matrix (PRODUCT-SPEC §8.7 step 4), machine-checked.
//
//   node tests/e2e/screenshot_matrix.mjs [--dist DIR] [--out DIR] [--port N] [--screens a,b] [--locales zh-Hant,en]
//                                        [--themes light,dark,sun] [--scales 1,2] [--json FILE]
//
// Screens (default = all): the 10 of the shell (home, venue, setup, live, import, shot, history, diag, settings, about),
// the launch-monitor screens (drills, drill, stats, gapping), the 0.4.0 screens (course, round, scorecard, lab, patterns;
// V04-SPEC §F.8 adds their named states as the packages land) and the named states `<screen>:<state>` (LAUNCH-MONITOR-SPEC
// §5.0-13; shot:tiles|side|top|3d|video, drills:setup (the drill setup sheet), drill:result|active): the screen is shown, then the state its module registered
// with app.e2e.registerState(screen, state, async (app) => …) is run; an unregistered state is a 'state' finding.
// Files of a state are named <screen>~<state>-….png. History is seeded with tests/fixtures/shots/valid_*.json (v1) and
// tests/fixtures/shots/v2/valid_*.json; the shot screen opens the v2 face_on shot (flight, tracks, the 14 new metrics).
// Widths: 390×844 and 430×932 for every screen; setup and live also 844×390 landscape. Themes light / dark / sun,
// locales zh-Hant / en (each a fresh browser context in that locale), text 100 % and 200 % (html font-size).
// Every state is screenshotted (full page) into --out as <screen>-<w>x<h>-<theme>-<locale>-<scale>x.png and checked:
//   hscroll      document scrollWidth ≤ clientWidth
//   overlap      (while an aria-modal dialog is open only the controls inside it count: the page behind is not
//                reachable) no two visible interactive controls intersect (> 2 px each way, neither contains the other): flow vs
//                flow and fixed vs fixed at scroll 0; scrolled to the end, no flow control under a fixed bar or a stuck
//                sticky element (content must be able to scroll clear of the tab bar and the pinned primary)
//   truncation   no element with its own text has scrollWidth > clientWidth + 1 (scroll containers and form fields
//                excepted), and no text-overflow: ellipsis that is actually cutting text
//   word-break   no Latin word (4+ letters) or "n %" split across two lines (overflow-wrap: anywhere)
//   spec-codes   no visible text matches /\b[PC]\d+\b|WP-/ or /eval_owner_set|golden|\bSHA(-?\d+)?\b/i (§2.4)
//   cjk          no Han characters in visible text or aria-labels in en (a language endonym inside [lang="zh-Hant"] is exempt)
//   hero         live: every .live-hero-num ≥ 56 px at 390 portrait and ≥ 15 vh in landscape (WP-B);
//                shot: every hero .mt-num ≥ 44 px (WP-C)
//   obscured     glance screens at every text size, as first shown (no scrolling): live: the state pill, every hero
//                tile, the shot count, the club button and both toolbar buttons are inside the viewport, not clipped
//                by any overflow ancestor (in landscape the board scrolls: there only the pill, hero tiles and toolbar)
//                and not covered by anything (elementFromPoint on a 3×3 grid of each element's visible part); setup:
//                the step title and the primary are uncovered and unclipped, and in landscape at least two lines of
//                the instruction (step body) show in the rail. Covering by a bottom-sticky bar over content that
//                scrolls is allowed in portrait setup (checked by 'overlap' at the end of the page)
// Exit code = number of states with a finding (capped at 255). Summary JSON with --json.
import fs from 'node:fs';
import path from 'node:path';
import { launch, startServer, ROOT, waitFor } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const DIST = path.resolve(opt('dist', process.env.GSL_E2E_DIST || path.join(ROOT, 'dist')));
const OUT = path.resolve(opt('out', process.env.GSL_SHOTS_DIR || path.join(ROOT, 'tests', 'e2e', '.shots', 'matrix')));
const PORT = Number(opt('port', process.env.GSL_E2E_PORT || 0));
const ALL_SCREENS = 'home,venue,import,shot,shot:tiles,shot:side,shot:top,shot:3d,shot:video,history,stats,gapping,drills,drills:setup,drill,drill:result,drill:active,course,round,scorecard,lab,patterns,diag,settings,about,setup,live';
const SCREENS = opt('screens', ALL_SCREENS).split(',');
const LOCALES = opt('locales', 'zh-Hant,en').split(',');
const THEMES = opt('themes', 'light,dark,sun').split(',');
const SCALES = opt('scales', '1,2').split(',').map(Number);
const JSON_OUT = opt('json', null);
const PORTRAIT = [{ width: 390, height: 844 }, { width: 430, height: 932 }];
const LANDSCAPE = { width: 844, height: 390 };
const BROWSER_LOCALE = { 'zh-Hant': 'zh-TW', en: 'en-US' };

/** In-page checks for one state; returns { findings: [{ kind, detail }], hero }. */
function pageChecks([screen, locale, vp]) {
  const findings = [];
  const add = (kind, detail) => findings.push({ kind, detail });
  const d = (el) => el.tagName.toLowerCase() + (el.dataset?.testid ? `[${el.dataset.testid}]` : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  const visible = (el) => {
    if (el.closest('[hidden], [aria-hidden="true"]:not(svg)')) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const se = document.scrollingElement || document.documentElement;
  if (se.scrollWidth > se.clientWidth + 1) add('hscroll', `${se.scrollWidth} > ${se.clientWidth}`);
  // interactive controls
  const CONTROLS = 'button, a[href], input:not([type="hidden"]):not([type="file"]), select, textarea, summary, [role="button"], [role="switch"], [role="radio"], [role="slider"], [role="tab"], [role="checkbox"]';
  // layers: 'fixed' bars (tab bar, toasts) float over content that scrolls under them; 'sticky' elements (a pinned
  // primary, group headers) sit over content only while stuck. At scroll 0, flow controls are compared with each other
  // and fixed with fixed; at the end of the page (bottom padding check) flow controls are compared with fixed and sticky
  // ones too, since by then nothing should still be covered.
  // a top-sticky header covers what scrolls under it by design ('header', never compared after scrolling); a
  // bottom-sticky element (pinned primary) must leave the content clear at the end of the page ('sticky')
  const layer = (el) => {
    let kind = 'flow';
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.position === 'fixed') return 'fixed';
      if (cs.position === 'sticky' && kind === 'flow') kind = cs.bottom !== 'auto' && cs.top === 'auto' ? 'sticky' : 'header';
    }
    return kind;
  };
  /** the visible part of el's rect after clipping by overflow ancestors (chip rows, sheets) */
  const clipRect = (el) => {
    const r = el.getBoundingClientRect();
    let { left, top, right, bottom } = r;
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (/(auto|scroll|hidden|clip)/.test(cs.overflowX + cs.overflowY)) {
        const c = n.getBoundingClientRect();
        left = Math.max(left, c.left); top = Math.max(top, c.top); right = Math.min(right, c.right); bottom = Math.min(bottom, c.bottom);
      }
    }
    return { left, top, right, bottom };
  };
  const label = (el) => `${d(el)} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}"`;
  // an open modal dialog (components.js sheet: role=dialog aria-modal=true) makes the page behind it unreachable, so
  // only its own controls are compared; overlaps inside the dialog are still findings
  const modal = [...document.querySelectorAll('[aria-modal="true"]')].filter(visible).at(-1) ?? null;
  const collect = () => [...(modal ?? document).querySelectorAll(CONTROLS)].filter((el) => visible(el) && !el.matches('.visually-hidden') && !el.closest('.visually-hidden'))
    .map((el) => ({ el, r: clipRect(el), layer: layer(el) })).filter((c) => c.r.right - c.r.left > 0.5 && c.r.bottom - c.r.top > 0.5);
  const overlaps = (list, pairOk, where) => {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]; const b = list[j];
        if (!pairOk(a.layer, b.layer)) continue;
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        // a control and the label that wraps it (input inside label, switch in its row) are one target
        const la = a.el.closest('label'); const lb = b.el.closest('label');
        if (la && la === lb) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 2 && h > 2) add('overlap', `${label(a.el)} × ${label(b.el)} (${Math.round(w)}×${Math.round(h)})${where}`);
      }
    }
  };
  overlaps(collect(), (x, y) => (x === y && x !== 'sticky' && x !== 'header') || (x === 'flow' && y === 'header') || (x === 'header' && y === 'flow'), '');
  if (se.scrollHeight > innerHeight + 1) {
    const y0 = scrollY;
    window.scrollTo(0, se.scrollHeight);
    overlaps(collect().filter((c) => c.r.bottom > 0 && c.r.top < innerHeight), (x, y) => x !== y && (x === 'flow' || y === 'flow') && x !== 'header' && y !== 'header', ' at the end of the page');
    window.scrollTo(0, y0);
  }
  // obscured: nothing covers or clips the glance targets of live / setup as first shown
  if (screen === 'live' || screen === 'setup') {
    const landscape = vp.width > vp.height;
    const T = screen === 'live'
      ? ['[data-testid="live-state"]', '[data-screen="live"] .hero-tile', ...(landscape ? [] : ['[data-testid="live-count"]', '[data-testid="live-club"]']), '[data-screen="live"] .live-toolbar .btn']
      : ['[data-screen="setup"] .setup-step .step-title', '[data-testid="setup-primary"]'];
    const covered = (el, r) => {
      for (const fx of [0.1, 0.5, 0.9]) for (const fy of [0.15, 0.5, 0.85]) {
        const x = r.left + (r.right - r.left) * fx; const y = r.top + (r.bottom - r.top) * fy;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        const top = document.elementFromPoint(x, y);
        if (!top || el.contains(top) || top.contains(el)) continue;
        if (screen === 'setup' && !landscape && layer(top) === 'sticky') continue; // scrolls clear (overlap check)
        return top;
      }
      return null;
    };
    for (const sel of T) {
      const els = [...document.querySelectorAll(sel)].filter(visible);
      if (!els.length && !sel.includes('step-title')) add('obscured', `${sel} not shown`);
      for (const el of els) {
        const r = el.getBoundingClientRect();
        const c = clipRect(el);
        const cut = Math.max(r.top < -1 ? 1 : 0, r.bottom > innerHeight + 1 ? 1 : 0, c.top - r.top > 1 ? 1 : 0, r.bottom - c.bottom > 1 ? 1 : 0, c.left - r.left > 1 ? 1 : 0, r.right - c.right > 1 ? 1 : 0);
        if (cut) { add('obscured', `${label(el)} clipped (${Math.round(r.top)}..${Math.round(r.bottom)} shows ${Math.round(c.top)}..${Math.round(c.bottom)} of ${innerHeight})`); continue; }
        const by = covered(el, { left: Math.max(c.left, 0), top: Math.max(c.top, 0), right: Math.min(c.right, innerWidth), bottom: Math.min(c.bottom, innerHeight) });
        if (by) add('obscured', `${label(el)} covered by ${label(by)}`);
      }
    }
    if (screen === 'setup' && landscape) {
      const body = [...document.querySelectorAll('[data-screen="setup"] .setup-step .step-body')].find(visible);
      if (body) {
        const c = clipRect(body);
        const lh = parseFloat(getComputedStyle(body).lineHeight) || parseFloat(getComputedStyle(body).fontSize) * 1.5;
        const shown = Math.min(c.bottom, innerHeight) - Math.max(c.top, 0);
        if (shown + 1 < Math.min(2 * lh, body.getBoundingClientRect().height)) add('obscured', `setup instruction shows ${Math.max(0, Math.round(shown))} px < 2 lines (${Math.round(2 * lh)} px)`);
        else if (covered(body, c)) add('obscured', `setup instruction covered by ${label(covered(body, c))}`);
      }
    }
  }
  // truncation: elements that own a non-empty text node
  const owners = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) if (t.data.trim() && t.parentElement) owners.add(t.parentElement);
  const texts = [];
  for (const el of owners) {
    if (!visible(el) || el.closest('script, style, noscript, svg, pre, textarea, select, option, [data-spec-overlay], .visually-hidden')) continue;
    const cs = getComputedStyle(el);
    // a language's own name marked with its lang (the language picker's 繁體中文) is the same in every locale (§3.6)
    texts.push(el.closest('[lang]:not([lang^="en"])') && el.closest('[lang]') !== document.documentElement ? '' : el.textContent.trim());
    if (cs.display.startsWith('inline') && cs.display !== 'inline-block' && cs.display !== 'inline-flex' && cs.display !== 'inline-grid') continue;
    if (/(auto|scroll)/.test(cs.overflowX)) continue;
    const cut = el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0;
    if (cut) add('truncation', `${d(el)} "${el.textContent.trim().slice(0, 40)}" ${el.scrollWidth} > ${el.clientWidth}`);
    else if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth) add('truncation', `${d(el)} ellipsis "${el.textContent.trim().slice(0, 40)}"`);
  }
  // words broken across lines (overflow-wrap: anywhere hides the overflow but splits "versio|n"): every Latin word of
  // 4+ letters or number with its unit must sit on one line
  {
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let t = tw.nextNode(); t; t = tw.nextNode()) {
      const el = t.parentElement;
      if (!el || !t.data.trim() || !visible(el) || el.closest('script, style, svg, pre, textarea, option, .visually-hidden, [data-spec-overlay]')) continue;
      for (const m of t.data.matchAll(/[A-Za-z]{4,}|\d[\d.,]*\s?%/g)) {
        range.setStart(t, m.index); range.setEnd(t, m.index + m[0].length);
        const rows = new Set([...range.getClientRects()].filter((r) => r.width > 0.5).map((r) => Math.round(r.top)));
        if (rows.size > 1) { add('word-break', `${d(el)} "${m[0]}" split over ${rows.size} lines`); break; }
      }
    }
  }
  for (const el of document.querySelectorAll('[aria-label]')) if (!el.closest('[hidden]')) texts.push(el.getAttribute('aria-label'));
  const SPEC_CS = /\b[PC]\d+\b|WP-/;
  const SPEC_CI = /eval_owner_set|golden|\bSHA(-?\d+)?\b/i;
  for (const s of texts) {
    if (SPEC_CS.test(s) || SPEC_CI.test(s)) add('spec-codes', s.slice(0, 80));
    if (locale === 'en' && /[㐀-鿿豈-﫿]/.test(s)) add('cjk', s.slice(0, 80));
  }
  // hero sizes
  const hero = {};
  if (screen === 'live') {
    const nums = [...document.querySelectorAll('[data-testid="live-hero"] .live-hero-num')].filter(visible);
    hero.live = nums.map((n) => parseFloat(getComputedStyle(n).fontSize));
    const landscape = vp.width > vp.height;
    const need = landscape ? 0.15 * innerHeight : 56;
    if (!nums.length) add('hero', 'no live-hero numbers');
    for (const px of hero.live) if (px + 0.01 < need) add('hero', `live hero ${px}px < ${need.toFixed(1)}px`);
  }
  if (screen === 'shot') {
    const nums = [...document.querySelectorAll('[data-screen="shot"] [data-testid="shot-hero"] .mt-num')].filter(visible);
    hero.shot = nums.map((n) => parseFloat(getComputedStyle(n).fontSize));
    if (!nums.length) add('hero', 'no shot-hero numbers');
    for (const px of hero.shot) if (px + 0.01 < 44) add('hero', `shot hero ${px}px < 44px`);
  }
  return { findings, hero };
}

async function until(page, fn, arg, what, timeout = 30000) {
  return waitFor(() => page.evaluate(fn, arg), { timeout, interval: 100, what });
}

async function go(page, id, params = {}) {
  await page.evaluate(([s, p]) => globalThis.__GSL_E2E__.app.nav.go(s, p), [id, params]);
  await page.locator(`[data-screen="${id}"]`).waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(400);
}

async function setState(page, theme, scale, vp) {
  await page.setViewportSize(vp);
  await page.evaluate(([th, k]) => {
    // the theme goes through the app (settings.theme → applyTheme), as Settings › Display does; live forces dark unless
    // the theme is sun (live.js on show; the top stack follows it in main.js): mirrored here for the screen on view
    const app = globalThis.__GSL_E2E__?.app;
    if (app?.updateSettings) app.updateSettings({ ...app.settings(), theme: th });
    document.documentElement.dataset.theme = th;
    for (const el of [document.querySelector('[data-screen="live"]:not([hidden])'), document.querySelector('[data-screen="live"]:not([hidden])') && document.getElementById('top-stack')]) {
      if (!el) continue;
      if (th === 'sun') delete el.dataset.liveTheme; else el.dataset.liveTheme = 'dark';
    }
    document.documentElement.style.fontSize = k === 1 ? '' : `${k * 100}%`;
    window.scrollTo(0, 0);
  }, [theme, scale]);
  await page.waitForTimeout(220);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer(DIST, { port: PORT || undefined });
  const browser = await launch({}, { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const states = [];
  const missingStates = [];
  const external = [];
  const pageErrors = [];
  const fixture = path.join(OUT, '_matrix_import.json');
  const shotsDir = path.join(ROOT, 'tests', 'fixtures', 'shots');
  const readValid = (dir) => fs.readdirSync(dir).filter((f) => /^valid_.*\.json$/.test(f)).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const shots = [...readValid(shotsDir), ...readValid(path.join(shotsDir, 'v2'))];
  // Gapping and Stats need a real spread: every fixture driver (and the 7-iron) carries the same 181 m / 139 m, so the
  // P10–P90 band and the box plot whiskers would never render. These extra face-on shots (an older session, so the
  // history order and the shot opened below do not change) only vary the carry; the code under test is untouched.
  const fo = shots.find((x) => x.schema === 'golf-shot/2' && x.capture?.view === 'face_on' && x.flight && x.tracks && x.club?.type === 'driver');
  const spread = (club, length, carries) => (fo ? carries.map((c, i) => {
    const k = c / fo.metrics.carry_m.value;
    const x = JSON.parse(JSON.stringify(fo));
    Object.assign(x, { shot_id: `shot-mx-${club}-${i + 1}`, session_id: 'sess-mx-0001', created_at: `2026-11-03T10:0${i}:00.000+08:00`, starred: false });
    x.club = { ...x.club, type: club, length_m: length };
    x.metrics.carry_m = { ...x.metrics.carry_m, value: c, ci95: [c - 21, c + 21] };
    x.metrics.total_m = { ...x.metrics.total_m, value: c + 20, ci95: [c - 2.5, c + 44.5] };
    x.flight.samples = x.flight.samples.map((p) => [p[0], p[1] * k, p[2], p[3]]);
    x.flight.landing = { ...x.flight.landing, x_m: c };
    x.flight.rest = { ...x.flight.rest, x_m: c + 20 };
    return x;
  }) : []);
  shots.push(...spread('driver', 1.17, [166, 172, 190, 197]), ...spread('7i', 0.94, [128, 134, 143, 150]));
  fs.writeFileSync(fixture, JSON.stringify({ format: 'golf-swing-lab-export/1', exported_at: '2026-11-04T00:00:00.000Z', app_version: '0.2.0', venues: [], presets: [], sessions: [], shots }));
  try {
    for (const locale of LOCALES) {
      const context = await browser.newContext({ serviceWorkers: 'block', locale: BROWSER_LOCALE[locale] ?? locale, viewport: PORTRAIT[0], permissions: ['camera', 'microphone'] });
      await context.addInitScript(() => { globalThis.__GSL_E2E__ = globalThis.__GSL_E2E__ ?? {}; });
      const page = await context.newPage();
      const origin = new URL(server.baseUrl).origin;
      page.on('request', (r) => { const u = r.url(); if (!u.startsWith(origin) && !/^(data|blob):/.test(u)) external.push(u); });
      page.on('pageerror', (e) => pageErrors.push(`${locale}: ${e.message}`));
      await page.goto(server.baseUrl);
      await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
      await page.evaluate(() => globalThis.__GSL_E2E__.app.ready());
      const lang = await page.evaluate(() => document.documentElement.lang);
      if (lang !== locale) throw new Error(`${locale}: app booted in ${lang}`);
      // seed history (and the home "last session" card) through the history import
      await page.locator('[data-testid="tabbar-history"]').click();
      await page.locator('[data-screen="history"]').waitFor({ state: 'visible' });
      await page.locator('[data-testid="history-import-input"]').setInputFiles(fixture);
      await until(page, (n) => document.querySelectorAll('[data-screen="history"] [data-testid="shot-row"]').length >= n, Math.min(shots.length, 1), 'history rows', 60000);
      const shot = shots.find((s) => s.schema === 'golf-shot/2' && s.capture?.view === 'face_on' && s.flight && s.tracks) ?? shots[0];
      const capture = async (screen, vps, state = null) => {
        const tag = state ? `${screen}~${state}` : screen;
        for (const theme of THEMES) for (const scale of SCALES) for (const vp of vps) {
          await setState(page, theme, scale, vp);
          const r = await page.evaluate(pageChecks, [screen, locale, vp]);
          const file = path.join(OUT, `${tag}-${vp.width}x${vp.height}-${theme}-${locale}-${scale}x.png`);
          await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
          states.push({ screen, state, locale, theme, scale, vp: `${vp.width}x${vp.height}`, file: path.basename(file), ...r });
        }
        await setState(page, 'light', 1, PORTRAIT[0]);
      };
      for (const entry of SCREENS.filter((s) => s !== 'setup' && s !== 'live')) {
        const [screen, state = null] = entry.split(':');
        await go(page, screen, screen === 'shot' ? { shot } : {});
        if (state) {
          const ran = await page.evaluate(async ([sc, st]) => {
            const app = globalThis.__GSL_E2E__.app;
            if (!app.e2e?.has?.(sc, st)) return false;
            await app.e2e.runState(sc, st, app);
            return true;
          }, [screen, state]);
          if (!ran) { missingStates.push(`${locale}: no e2e state ${screen}:${state} registered (app.e2e.registerState)`); continue; }
          await page.waitForTimeout(300);
        }
        await capture(screen, PORTRAIT, state);
        // a state that opened a sheet (drills:setup) must not stay open over the next screen
        if (await page.evaluate(() => Boolean(document.querySelector('[aria-modal="true"]')))) {
          await page.keyboard.press('Escape');
          await until(page, () => !document.querySelector('[aria-modal="true"]'), null, `${entry}: sheet closed`, 5000);
        }
      }
      if (SCREENS.includes('setup') || SCREENS.includes('live')) {
        await go(page, 'home');
        await page.locator('[data-testid="btn-start-practice"]').click();
        await page.locator('[data-screen="setup"]').waitFor({ state: 'visible', timeout: 30000 });
        await page.waitForTimeout(1500);
        if (SCREENS.includes('setup')) await capture('setup', [...PORTRAIT, LANDSCAPE]);
        await page.locator('[data-testid="btn-skip-setup"]').click();
        await page.locator('[data-screen="live"]').waitFor({ state: 'visible', timeout: 30000 });
        await page.waitForTimeout(2500);
        if (SCREENS.includes('live')) await capture('live', [...PORTRAIT, LANDSCAPE]);
      }
      await context.close();
    }
  } finally {
    await browser.close();
    await server.stop();
    fs.rmSync(fixture, { force: true });
  }
  const byKind = {};
  for (const s of states) for (const f of s.findings) (byKind[f.kind] ??= []).push(`${s.file}: ${f.detail}`);
  for (const m of missingStates) (byKind.state ??= []).push(m);
  const bad = states.filter((s) => s.findings.length);
  const summary = {
    states: states.length, screenshots: states.length, with_findings: bad.length,
    checks: Object.fromEntries(['hscroll', 'overlap', 'obscured', 'truncation', 'word-break', 'spec-codes', 'cjk', 'hero', 'state'].map((k) => [k, (byKind[k] ?? []).length])),
    hero: { live: [...new Set(states.filter((s) => s.hero.live).flatMap((s) => s.hero.live))].sort((a, b) => a - b), shot: [...new Set(states.filter((s) => s.hero.shot).flatMap((s) => s.hero.shot))].sort((a, b) => a - b) },
    external_requests: [...new Set(external)], page_errors: pageErrors, out: OUT,
  };
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ summary, findings: byKind, states }, null, 1));
  console.log(`screenshot matrix: ${states.length} states → ${OUT}`);
  for (const [k, n] of Object.entries(summary.checks)) console.log(`  ${n ? 'FAIL' : 'PASS'} ${k.padEnd(11)} ${n} finding(s)`);
  console.log(`  hero sizes px: live ${summary.hero.live.join(', ') || '—'} · shot ${summary.hero.shot.join(', ') || '—'}`);
  console.log(`  external requests: ${summary.external_requests.length}; page errors: ${pageErrors.length}`);
  for (const [k, list] of Object.entries(byKind)) for (const line of list.slice(0, 12)) console.log(`    ${k}: ${line}`);
  const n = bad.length + missingStates.length + (summary.external_requests.length ? 1 : 0) + (pageErrors.length ? 1 : 0);
  process.exit(Math.min(255, n));
}

main().catch((e) => { console.error(e?.stack ?? e); process.exit(70); });
