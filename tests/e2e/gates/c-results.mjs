// Package C gates (results & data; PRODUCT-SPEC §8 WP-C acceptance). Chromium, 390×844, zh-TW unless noted.
//   c-shot-hero     hero tiles (≥ 6 li, ≥ 44 px), collapsed "not measured" disclosure, no raw codes, carry in yd then m
//   c-timeline      markers never overlap, arrow keys move a marker 1 frame, set-frame without drag, undo, leave-confirm
//   c-labels        label rows ≤ 64 px, event names ≥ 3 em and on one line at 100 % and 200 % text
//   c-import-batch  multiple input, 2 clips → 2 shots with ✓ per step, persistent error card, back-confirm, no-swing
//                   clip saves no shot (analysis stand-in __GSL_E2E__.analyzeClip; probe/queue/save are real)
//   c-history       1000-shot backup restore → open ≤ 500 ms at CPU ×4, DOM ≤ 1,500 nodes, grouping, delete + undo,
//                   star persists across reload, A/B pickers named with the shot time
//   c-teach         3 shots with clips → 8 × teach-accept completes a swing in ≤ 12 taps, progress updates, the
//                   exported golf-swing-lab-labels/1 file is read by scripts/eval_owner_set.mjs (exit 0)
// Every gate also runs the shared checks (noSpecCodes, minTargets 44, accessibleNames, noHScroll at 200 %) and, in en,
// noCJK on the screen it covers. Screenshots go to $GSL_SHOTS_DIR when set.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launch, watchPage, need, ROOT, FIXTURES, waitFor, mp4Fixture } from '../lib.mjs';
import { noHScroll, minTargets, accessibleNames, noCJK, noSpecCodes, setTextScale } from '../checks.mjs';

const SHOT_DIR = path.join(ROOT, 'tests/fixtures/shots');
const fx = (name) => JSON.parse(fs.readFileSync(path.join(SHOT_DIR, `${name}.json`), 'utf8'));
const exportOf = (shots, extra = {}) => ({ format: 'golf-swing-lab-export/1', exported_at: '2026-11-04T00:00:00.000Z', app_version: '0.1.0', venues: [], presets: [], sessions: [], shots, ...extra });

function writeFixture(name, data) {
  fs.mkdirSync(FIXTURES, { recursive: true });
  const f = path.join(FIXTURES, name);
  fs.writeFileSync(f, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
  return f;
}

async function boot(ctx, { locale = 'zh-TW', init = null, cpu = 1, viewport = { width: 390, height: 844 } } = {}) {
  const browser = await launch(ctx);
  const context = await browser.newContext({ serviceWorkers: 'block', locale, viewport, acceptDownloads: true });
  if (init) await context.addInitScript(init.fn, init.arg);
  const page = await context.newPage();
  const w = watchPage(page);
  if (cpu > 1) { const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu }); }
  await page.goto(ctx.baseUrl);
  await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
  return { browser, context, page, w };
}

/** page.waitForFunction evaluates strings, which the app's CSP forbids: poll page.evaluate instead. */
async function until(page, fn, arg, { timeout = 30000, what = 'condition' } = {}) {
  return waitFor(() => page.evaluate(fn, arg), { timeout, interval: 100, what });
}

async function goHistory(page) {
  await page.evaluate(() => (document.querySelector('[data-testid="tabbar-history"]') ?? document.querySelector('[data-testid="nav-history"]') ?? document.querySelector('[data-go="history"]'))?.click());
  await page.locator('[data-screen="history"]').waitFor({ state: 'visible', timeout: 10000 });
}

async function importFile(page, file, rows) {
  await goHistory(page);
  await page.locator('[data-testid="history-import-input"]').setInputFiles(file);
  await until(page, (n) => document.querySelectorAll('[data-screen="history"] [data-testid="shot-row"]').length >= n, rows, { timeout: 60000, what: `${rows} history rows` });
}

async function openShot(page, id) {
  await page.locator(`[data-screen="history"] [data-testid="shot-row"][data-shot="${id}"]`).click();
  await page.locator('[data-screen="shot"] [data-testid="shot-hero"]').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(300);
}

/** Shared checks on the visible screen; returns a list of problems (strings). */
async function shared(page, tag, { en = false } = {}) {
  const bad = [];
  const sc = await noSpecCodes(page);
  if (!sc.ok) bad.push(`${tag}: spec codes ${JSON.stringify(sc.hits.slice(0, 3))}`);
  const mt = await minTargets(page, 44);
  if (!mt.ok) bad.push(`${tag}: targets < 44 px ${JSON.stringify(mt.offenders.slice(0, 4))}`);
  const an = await accessibleNames(page);
  if (!an.ok) bad.push(`${tag}: unnamed controls ${JSON.stringify(an.offenders.slice(0, 3))}`);
  if (en) { const cj = await noCJK(page); if (!cj.ok) bad.push(`${tag}: CJK in en ${JSON.stringify(cj.hits.slice(0, 3))}`); }
  await setTextScale(page, 2);
  await page.waitForTimeout(150);
  const hs = await noHScroll(page);
  if (!hs.ok) bad.push(`${tag}: horizontal scroll at 200 % (${hs.scrollWidth} > ${hs.clientWidth})`);
  await setTextScale(page, 1);
  await page.waitForTimeout(100);
  return bad;
}

async function shot(page, name) {
  const dir = process.env.GSL_SHOTS_DIR;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `c-${name}.png`), fullPage: true });
}

const screenText = (page, id) => page.evaluate((s) => document.querySelector(`[data-screen="${s}"]`)?.innerText ?? '', id);

// ------------------------------------------------------------------ c-shot-hero
async function shotHero(ctx) {
  const file = writeFixture('c_shot_hero.json', exportOf([fx('valid_face_on_240'), fx('valid_high_behind_240')]));
  const notes = [];
  for (const locale of ['zh-TW', 'en-US']) {
    const en = locale === 'en-US';
    const { browser, page, w } = await boot(ctx, { locale });
    try {
      await importFile(page, file, 2);
      await openShot(page, 'shot-fx-face-on-240');
      const r = await page.evaluate(() => {
        const s = document.querySelector('[data-screen="shot"]');
        const hero = s.querySelector('ul[data-testid="shot-hero"]');
        const tiles = [...hero.querySelectorAll(':scope > li[data-metric]')]; // not the trailing '+ Tiles' ghost tile
        const um = s.querySelector('[data-testid="shot-unmeasured"]');
        const nums = tiles.map((li) => parseFloat(getComputedStyle(li.querySelector('.mt-num')).fontSize));
        return {
          n: tiles.length, bottoms: tiles.map((li) => Math.round(li.getBoundingClientRect().bottom)), nums,
          umOpen: um ? um.open : null, umSummary: um?.querySelector('summary')?.textContent ?? '', umRows: um ? um.querySelectorAll('li.um-row').length : 0,
          text: s.innerText, carry: tiles.find((li) => li.dataset.metric === 'carry_m')?.innerText ?? '',
        };
      });
      // launch-monitor hero (LAUNCH-MONITOR-SPEC §3.2): li tiles in ul[data-testid=shot-hero], ≥ 6, ≥ 6 above the fold
      need(r.n >= 6, `${locale}: shot-hero has ${r.n} tiles, want ≥ 6`);
      need(r.bottoms.filter((b) => b <= 844).length >= 6, `${locale}: hero tile bottoms ${r.bottoms}: fewer than 6 above the fold (844)`);
      need(r.nums.length === r.n && r.nums.every((x) => x >= 44), `${locale}: hero value font-size ${r.nums} < 44 px`);
      need(r.umOpen === false, `${locale}: shot-unmeasured is ${r.umOpen === null ? 'missing' : 'open'}; want a collapsed disclosure`);
      need(r.umRows > 0 && r.umSummary.includes(String(r.umRows)), `${locale}: disclosure summary "${r.umSummary}" does not state the count ${r.umRows}`);
      need(!/±\s*0[.,]0+\b/.test(r.text), `${locale}: "± 0.00" shown`);
      need(!/第\s*0\s*版|version 0\b/i.test(r.text), `${locale}: revision 0 shown`);
      need(!/\b(7i|6i|driver|3w|pw|sw)\b/.test(r.text.replace(/Driver/g, '')) && !/shot-[a-z0-9]/.test(r.text), `${locale}: raw club code or shot id visible`);
      need(en ? /\byd\b/.test(r.carry) : /碼/.test(r.carry), `${locale}: carry "${r.carry.replace(/\n/g, ' ')}" is not in yd`);
      notes.push(...await shared(page, `${locale} shot`, { en }));
      await shot(page, `shot-${locale}`);
      // switch units to metres (settings.units.distance = 'm'), reload, reopen
      await page.evaluate(() => { const k = 'gsl-settings-v2'; const s = JSON.parse(localStorage.getItem(k) || '{}'); s.units = { ...(s.units ?? {}), distance: 'm' }; localStorage.setItem(k, JSON.stringify(s)); });
      await page.reload();
      await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
      await goHistory(page);
      await page.locator('[data-testid="shot-row"]').first().waitFor({ state: 'visible', timeout: 15000 });
      await openShot(page, 'shot-fx-face-on-240');
      const carryM = await page.locator('[data-screen="shot"] [data-testid="shot-hero"] li[data-metric="carry_m"]').innerText();
      need(en ? /\bm\b/.test(carryM) && !/\byd\b/.test(carryM) : /公尺/.test(carryM), `${locale}: carry after switching to m is "${carryM.replace(/\n/g, ' ')}"`);
      need(w.errors.length === 0, `${locale}: page errors ${w.errors.slice(0, 3).join(' | ')}`);
    } finally { await browser.close(); }
  }
  need(notes.length === 0, notes.join('\n'));
  return '≥ 6 hero tiles above the fold (≥ 44 px), collapsed not-measured disclosure with count, no raw codes, carry yd → m, shared checks zh + en';
}

// ------------------------------------------------------------------ c-timeline
async function timeline(ctx) {
  const file = writeFixture('c_timeline.json', exportOf([fx('valid_face_on_240')]));
  const { browser, page, w } = await boot(ctx);
  try {
    await importFile(page, file, 1);
    await openShot(page, 'shot-fx-face-on-240');
    await page.locator('[data-screen="shot"] [data-testid="event-marker"]').first().scrollIntoViewIfNeeded();
    const geo = await page.evaluate(() => {
      const s = document.querySelector('[data-screen="shot"]');
      const ms = [...s.querySelectorAll('[data-testid="event-marker"]')].filter((m) => !m.hidden);
      const R = ms.map((m) => m.getBoundingClientRect());
      const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
      const pairs = [];
      for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) if (hit(R[i], R[j])) pairs.push([ms[i].dataset.event, ms[j].dataset.event]);
      const texts = [];
      const walker = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        if (!t.data.trim() || t.parentElement.closest('[data-testid="event-marker"], details:not([open]) > :not(summary)') || t.parentElement.checkVisibility?.() === false) continue;
        const rg = document.createRange(); rg.selectNodeContents(t);
        for (const rr of rg.getClientRects()) for (let i = 0; i < R.length; i++) if (hit(rr, R[i])) texts.push(`${ms[i].dataset.event}~${t.data.trim().slice(0, 20)}`);
      }
      return { n: ms.length, pairs, texts };
    });
    need(geo.n === 8, `timeline shows ${geo.n} markers, want 8`);
    need(geo.pairs.length === 0, `overlapping markers: ${JSON.stringify(geo.pairs)}`);
    need(geo.texts.length === 0, `markers overlap text: ${JSON.stringify(geo.texts.slice(0, 4))}`);
    // keyboard: focused marker, ArrowRight → +1 frame (aria-valuenow)
    const m = page.locator('[data-screen="shot"] [data-testid="event-marker"][data-event="top"]');
    const v0 = Number(await m.getAttribute('aria-valuenow'));
    await m.focus();
    await page.keyboard.press('ArrowRight');
    const v1 = Number(await m.getAttribute('aria-valuenow'));
    need(v1 === v0 + 1, `ArrowRight moved top from ${v0} to ${v1}`);
    await page.keyboard.press('Shift+ArrowLeft');
    const v2 = Number(await m.getAttribute('aria-valuenow'));
    need(v2 === v1 - 10, `Shift+ArrowLeft moved top from ${v1} to ${v2}`);
    // set a frame without dragging: select impact chip, step forward 2 frames, set
    await page.locator('[data-screen="shot"] [data-testid="event-chip"][data-event="impact"]').click();
    const imp = page.locator('[data-screen="shot"] [data-testid="event-marker"][data-event="impact"]');
    const i0 = Number(await imp.getAttribute('aria-valuenow'));
    await page.locator('[data-screen="shot"] [data-testid="replay-next"]').click();
    await page.locator('[data-screen="shot"] [data-testid="replay-next"]').click();
    await page.locator('[data-screen="shot"] [data-testid="event-set-frame"]').click();
    const i1 = Number(await imp.getAttribute('aria-valuenow'));
    need(i1 === i0 + 2, `event-set-frame put impact at ${i1}, want ${i0 + 2}`);
    await page.locator('[data-screen="shot"] [data-testid="event-undo"]').click();
    need(Number(await imp.getAttribute('aria-valuenow')) === i0, 'event-undo did not restore impact');
    const notes = await shared(page, 'timeline');
    await shot(page, 'timeline');
    // leaving with unsaved edits asks first
    await page.locator('[data-screen="shot"] header.screen-header button.back').click();
    await page.locator('[data-testid="shot-leave"]').waitFor({ state: 'visible', timeout: 5000 }).catch(() => { throw new Error('leaving with unsaved edits did not open a confirm sheet'); });
    await page.locator('[data-testid="shot-leave-cancel"]').click();
    need(await page.locator('[data-screen="shot"]').isVisible(), 'cancel on the leave sheet left the screen');
    need(w.errors.length === 0, `page errors ${w.errors.slice(0, 3).join(' | ')}`);
    need(notes.length === 0, notes.join('\n'));
    return `8 markers, 0 overlaps (markers/text); arrow ${v0}→${v1}, shift ${v1}→${v2}; set-frame ${i0}→${i1}, undo restores; leave asks`;
  } finally { await browser.close(); }
}

// ------------------------------------------------------------------ c-labels
async function labels(ctx) {
  const file = writeFixture('c_labels.json', exportOf([fx('valid_face_on_240')]));
  const out = [];
  for (const locale of ['zh-TW', 'en-US']) {
    const { browser, page, w } = await boot(ctx, { locale });
    try {
      await importFile(page, file, 1);
      await openShot(page, 'shot-fx-face-on-240');
      await page.locator('[data-screen="shot"] [data-testid="shot-mode"] [data-value="label"]').click();
      await page.locator('[data-screen="shot"] .label-row').first().waitFor({ state: 'visible', timeout: 10000 });
      for (const k of [1, 2]) {
        await setTextScale(page, k);
        await page.waitForTimeout(150);
        const r = await page.evaluate(() => [...document.querySelectorAll('[data-screen="shot"] .label-row')].map((b) => {
          const n = b.querySelector('.lbl-name');
          const em = parseFloat(getComputedStyle(n).fontSize);
          return { h: b.getBoundingClientRect().height, w: n.getBoundingClientRect().width, em, lines: n.getClientRects().length, lh: parseFloat(getComputedStyle(n).lineHeight) || em * 1.5, nh: n.getBoundingClientRect().height, text: n.textContent };
        }));
        need(r.length === 8, `${locale} ${k}x: ${r.length} label rows`);
        if (k === 1) need(r.every((x) => x.h <= 64), `${locale}: label row heights ${r.map((x) => Math.round(x.h))} > 64`);
        need(r.every((x) => x.w >= 3 * x.em - 0.5), `${locale} ${k}x: event name narrower than 3 em: ${r.filter((x) => x.w < 3 * x.em).map((x) => x.text)}`);
        need(r.every((x) => x.lines === 1 && x.nh <= x.lh * 1.3), `${locale} ${k}x: event name wraps: ${r.filter((x) => x.nh > x.lh * 1.3).map((x) => x.text)}`);
      }
      await setTextScale(page, 1);
      const notes = await shared(page, `${locale} labels`, { en: locale === 'en-US' });
      need(notes.length === 0, notes.join('\n'));
      await shot(page, `labels-${locale}`);
      need(w.errors.length === 0, `page errors ${w.errors.slice(0, 3).join(' | ')}`);
      out.push(locale);
    } finally { await browser.close(); }
  }
  return `label rows ≤ 64 px, names ≥ 3 em on one line at 100 % and 200 % (${out.join(', ')})`;
}

// ------------------------------------------------------------------ c-import-batch
// The analysis stand-in returns the face-on fixture shot with the job's ids (a little slower per step so the queue and
// the back-confirm can be observed); a file whose name contains "noswing" rejects with NO_SWING_FOUND.
export function installAnalysisStandIn(shotJson) {
  const base = JSON.parse(shotJson);
  globalThis.__GSL_E2E__ = { ...(globalThis.__GSL_E2E__ ?? {}), analyzeClip: async (file, options, { onProgress, cancelled } = {}) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const st of ['pose', 'events', 'impact', 'assemble']) {
      onProgress?.(st, 0);
      await wait(globalThis.__GSL_E2E__.stepMs ?? 300);
      if (cancelled?.()) throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' });
      if (st === 'events' && /noswing/i.test(file.name)) throw Object.assign(new Error('no swing'), { code: 'NO_SWING_FOUND' });
    }
    const s = JSON.parse(JSON.stringify(base));
    Object.assign(s, { shot_id: options.ids.shot_id, session_id: options.ids.session_id, created_at: options.ids.created_at, venue_id: null, preset_id: null });
    s.capture = { ...s.capture, clip_ref: options.clip_ref };
    s.club = { ...s.club, type: options.club.type };
    return { shot: s, poseSeq: null };
  } };
}

async function importBatch(ctx) {
  const { file: clip } = await mp4Fixture('vp9');
  const a = writeFixture('c_clip_a.mp4', fs.readFileSync(clip));
  const b = writeFixture('c_clip_b.mp4', fs.readFileSync(clip));
  const ns = writeFixture('c_clip_noswing.mp4', fs.readFileSync(clip));
  const junk = writeFixture('c_garbage.mp4', Buffer.from('this is not a video file '.repeat(400)));
  const shotJson = JSON.stringify(fx('valid_face_on_240'));
  const { browser, page, w } = await boot(ctx, { init: { fn: installAnalysisStandIn, arg: shotJson } });
  const countShots = () => page.evaluate(async (base) => {
    const S = await import(`${base}src/store/index.js`);
    const repo = await S.openRepository(S.idbBackend());
    const n = (await repo.shots.list()).length;
    await repo.close();
    return n;
  }, ctx.baseUrl);
  try {
    await page.evaluate(() => (document.querySelector('[data-testid="nav-import"]') ?? [...document.querySelectorAll('button')].find((x) => /匯入/.test(x.textContent)))?.click());
    await page.locator('[data-screen="import"]').waitFor({ state: 'visible', timeout: 10000 });
    const input = page.locator('[data-screen="import"] [data-testid="import-file-input"]');
    need(await input.getAttribute('multiple') !== null, 'import-file-input has no multiple attribute');
    // 1. garbage → persistent error card
    await input.setInputFiles(junk);
    await page.locator('[data-testid="import-error-card"]').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(10500);
    need(await page.locator('[data-testid="import-error-card"]').isVisible(), 'the import error card disappeared within 10 s');
    const errText = await page.locator('[data-testid="import-error-card"]').innerText();
    await shot(page, 'import-error');
    await page.locator('[data-testid="import-error-dismiss"]').click();
    // 2. two clips → two shots, ✓ per step
    const before = await countShots();
    await page.locator('[data-screen="import"] [data-testid="import-file-input"]').setInputFiles([a, b]);
    await until(page, () => { const x = document.querySelector('[data-testid="import-start"]'); return Boolean(x && !x.disabled); }, null, { timeout: 60000, what: 'import-start enabled' });
    need(await page.locator('[data-testid="import-queue"] > li').count() === 2, 'import-queue does not list 2 clips');
    await page.locator('[data-testid="import-start"]').click();
    await waitFor(() => page.evaluate(() => [...document.querySelectorAll('[data-testid="import-queue"] > li')].every((li) => li.dataset.status === 'done')), { timeout: 60000, what: 'both queued clips done' });
    const ticks = await page.evaluate(() => [...document.querySelectorAll('[data-testid="import-queue"] > li')].map((li) => li.querySelectorAll('.ps-step[data-state="done"]').length));
    need(ticks.every((n) => n === 5), `steps with ✓ per clip: ${ticks} (want 5 each)`);
    const after = await countShots();
    need(after - before === 2, `2 clips produced ${after - before} shots`);
    await shot(page, 'import-batch');
    const notes = await shared(page, 'import');
    // 3. back during an analysis → confirm sheet
    await page.evaluate(() => { globalThis.__GSL_E2E__.stepMs = 2500; });
    await page.locator('[data-screen="import"] [data-testid="import-file-input"]').setInputFiles(a);
    await until(page, () => { const x = document.querySelector('[data-testid="import-start"]'); return Boolean(x && !x.disabled); }, null, { timeout: 60000, what: 'import-start enabled' });
    await page.locator('[data-testid="import-start"]').click();
    await page.locator('[data-testid="import-queue"] > li[data-status="running"]').waitFor({ timeout: 10000 });
    await page.locator('[data-screen="import"] header.screen-header button.back').click();
    await page.locator('[data-testid="import-leave"]').waitFor({ state: 'visible', timeout: 5000 }).catch(() => { throw new Error('back during analysis did not open a confirm sheet'); });
    await page.locator('[data-testid="import-leave-confirm"]').click();
    await page.waitForTimeout(3000);
    // 4. no swing → no shot
    await page.evaluate(() => { globalThis.__GSL_E2E__.stepMs = 200; });
    await page.evaluate(() => (document.querySelector('[data-testid="nav-import"]'))?.click());
    await page.locator('[data-screen="import"]').waitFor({ state: 'visible', timeout: 10000 });
    const b4 = await countShots();
    await page.locator('[data-screen="import"] [data-testid="import-file-input"]').setInputFiles(ns);
    await until(page, () => { const x = document.querySelector('[data-testid="import-start"]'); return Boolean(x && !x.disabled); }, null, { timeout: 60000, what: 'import-start enabled' });
    await page.locator('[data-testid="import-start"]').click();
    await page.locator('[data-testid="import-error-card"]').waitFor({ state: 'visible', timeout: 30000 });
    const nsText = await page.locator('[data-testid="import-error-card"]').innerText();
    need(await countShots() === b4, 'a no-swing clip saved a shot');
    need(w.errors.length === 0, `page errors ${w.errors.slice(0, 3).join(' | ')}`);
    need(notes.length === 0, notes.join('\n'));
    return `multiple; 2 clips → 2 shots, ✓ ${ticks}; garbage card persists > 10 s ("${errText.split('\n')[0]}"); back asks; no-swing → 0 shots ("${nsText.split('\n')[0]}")`;
  } finally { await browser.close(); }
}

// ------------------------------------------------------------------ c-history
function manyShots(n = 1000, perSession = 25) {
  const base = fx('valid_face_on_240');
  const dtl = fx('valid_dtl_30');
  const out = [];
  for (let i = 0; i < n; i++) {
    const src = i % 5 === 4 ? dtl : base;
    const s = JSON.parse(JSON.stringify(src));
    const sess = Math.floor(i / perSession);
    const t0 = Date.UTC(2026, 8, 1) + sess * 86400000 + (i % perSession) * 60000;
    s.shot_id = `shot-c${String(i).padStart(4, '0')}`;
    s.session_id = `sess-c${String(sess).padStart(3, '0')}`;
    s.created_at = new Date(t0).toISOString();
    s.starred = false;
    out.push(s);
  }
  return out;
}

async function history(ctx) {
  const file = writeFixture('c_history_1000.json', exportOf(manyShots()));
  const { browser, page, w } = await boot(ctx);
  try {
    await goHistory(page);
    await page.locator('[data-testid="history-import-input"]').setInputFiles(file);
    await page.locator('[data-testid="history-restore-status"]').waitFor({ state: 'visible', timeout: 120000 });
    // open history fresh at CPU ×4
    await page.evaluate(() => (document.querySelector('[data-testid="tabbar-practice"]') ?? document.querySelector('[data-screen="history"] button.back'))?.click());
    await page.locator('[data-screen="home"]').waitFor({ state: 'visible', timeout: 10000 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const ms = await page.evaluate(() => new Promise((resolve) => {
      document.querySelector('[data-screen="history"]').replaceChildren(); // no stale rows can satisfy the wait
      const t0 = performance.now();
      (document.querySelector('[data-testid="tabbar-history"]') ?? document.querySelector('[data-testid="nav-history"]')).click();
      const tick = () => {
        if (document.querySelector('[data-screen="history"]:not([hidden]) [data-testid="history-session"]')) requestAnimationFrame(() => resolve(performance.now() - t0));
        else setTimeout(tick, 5);
      };
      tick();
    }));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const dom = await page.evaluate(() => ({ all: document.querySelectorAll('*').length, history: document.querySelectorAll('[data-screen="history"] *').length, groups: document.querySelectorAll('[data-testid="history-session"]').length, rows: document.querySelectorAll('[data-testid="shot-row"]').length }));
    need(ms <= 500, `history open took ${ms.toFixed(0)} ms at CPU ×4 (budget 500)`);
    need(dom.all <= 1500, `DOM has ${dom.all} nodes (budget 1500; history screen ${dom.history})`);
    need(dom.groups >= 1, 'no history-session groups');
    await shot(page, 'history');
    const notes = await shared(page, 'history');
    // delete → undo toast → undo restores
    const first = page.locator('[data-screen="history"] li.history-row').first();
    const id = await first.getAttribute('data-shot');
    await first.locator('[data-testid="shot-delete"]').click();
    await page.locator('[data-testid="undo-toast"]').waitFor({ state: 'visible', timeout: 5000 });
    need(await page.locator(`[data-screen="history"] [data-testid="shot-row"][data-shot="${id}"]`).count() === 0, 'deleted row still listed');
    await page.locator('[data-testid="undo-toast-undo"]').click();
    await page.locator(`[data-screen="history"] [data-testid="shot-row"][data-shot="${id}"]`).waitFor({ state: 'visible', timeout: 5000 }).catch(() => { throw new Error('undo did not restore the deleted shot'); });
    // star persists across reload
    const row2 = page.locator('[data-screen="history"] li.history-row').nth(1);
    const id2 = await row2.getAttribute('data-shot');
    await row2.locator('[data-testid="shot-star"]').click();
    await page.locator(`[data-screen="history"] li.history-row[data-shot="${id2}"] [data-testid="shot-star"][aria-pressed="true"]`).waitFor({ timeout: 5000 });
    await page.waitForTimeout(500);
    await page.reload();
    await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
    await goHistory(page);
    await page.locator(`[data-screen="history"] li.history-row[data-shot="${id2}"]`).waitFor({ timeout: 15000 });
    need(await page.locator(`[data-screen="history"] li.history-row[data-shot="${id2}"] [data-testid="shot-star"]`).getAttribute('aria-pressed') === 'true', 'star did not persist across reload');
    need(await page.locator(`[data-screen="history"] li.history-row[data-shot="${id}"]`).count() === 1, 'the undone delete did not survive a reload');
    // A/B pickers named with the shot time
    await page.locator('[data-testid="history-compare-toggle"]').click();
    const names = await page.locator('[data-testid="history-pick-a"], [data-testid="history-pick-b"]').evaluateAll((bs) => bs.slice(0, 6).map((b) => b.getAttribute('aria-label')));
    need(names.length > 0 && names.every((n) => /\d{1,2}:\d{2}/.test(n ?? '')), `A/B names without a time: ${JSON.stringify(names.slice(0, 2))}`);
    await page.locator('[data-testid="history-pick-a"]').nth(0).click();
    await page.locator('[data-testid="history-pick-b"]').nth(1).click();
    await page.locator('[data-testid="history-compare-open"]').click();
    await page.locator('[data-testid="compare-sheet"]').waitFor({ state: 'visible', timeout: 5000 });
    await shot(page, 'compare');
    const sc = await noSpecCodes(page);
    need(sc.ok, `compare sheet spec codes ${JSON.stringify(sc.hits.slice(0, 3))}`);
    need(w.errors.length === 0, `page errors ${w.errors.slice(0, 3).join(' | ')}`);
    need(notes.length === 0, notes.join('\n'));
    return `1000 shots: open ${ms.toFixed(0)} ms at CPU ×4, DOM ${dom.all} nodes (${dom.groups} groups, ${dom.rows} rows); delete → undo; star persists; A/B named "${names[0]}"`;
  } finally { await browser.close(); }
}

// ------------------------------------------------------------------ c-teach
async function teach(ctx) {
  const shots = [fx('valid_face_on_240'), fx('valid_dtl_30'), fx('valid_high_behind_240')];
  const { browser, page, w } = await boot(ctx);
  try {
    await page.evaluate(async ([base, list]) => {
      const S = await import(`${base}src/store/index.js`);
      const repo = await S.openRepository(S.idbBackend());
      for (const s of list) {
        await repo.shots.put(s);
        await repo.clips.put({ clip_id: `clip-${s.shot_id}`, shot_id: s.shot_id, session_id: s.session_id, created_at: s.created_at, kind: 'raw', mime: 'video/mp4', bytes: 1024, starred: false, blob: new Blob([new Uint8Array(1024)], { type: 'video/mp4' }) });
      }
      await repo.close();
    }, [ctx.baseUrl, shots]);
    await goHistory(page);
    let taps = 0;
    await page.locator('[data-testid="history-teach"]').click(); taps++;
    const prog = page.locator('[data-testid="teach-progress"]');
    await prog.waitFor({ state: 'visible', timeout: 15000 });
    const p0 = await prog.textContent();
    for (let i = 0; i < 8; i++) { await page.locator('[data-testid="teach-accept"]').click(); taps++; await page.waitForTimeout(60); }
    await waitFor(async () => (await prog.textContent()) !== p0, { timeout: 10000, what: 'teach-progress to change after 8 accepts' });
    const p1 = await prog.textContent();
    need(taps <= 12, `a correct swing took ${taps} taps`);
    const notes = await shared(page, 'teach');
    await shot(page, 'teach');
    // export the training set
    const dl = page.waitForEvent('download', { timeout: 20000 });
    await page.locator('[data-testid="teach-export"]').click();
    await page.locator('[data-screen] a[download].download-link').first().click();
    const d = await dl;
    const out = writeFixture('c_teach_labels.json', fs.readFileSync(await d.path()));
    const data = JSON.parse(fs.readFileSync(out, 'utf8'));
    need(data.format === 'golf-swing-lab-labels/1', `export format ${data.format}`);
    need(data.swings?.length === 1 && data.swings[0].label?.source === 'owner' && !Object.keys(data.swings[0]).some((k) => /clip|blob|video/.test(k)), `export has ${data.swings?.length} swings`);
    need(!/[㐀-鿿]/.test(JSON.stringify(data)), 'the training set contains localized text');
    // the fixture shots have no stored pose, so the detections stored with the shot are scored (--detector stored)
    const ev = spawnSync(process.execPath, [path.join(ROOT, 'scripts/eval_owner_set.mjs'), out, '--detector', 'stored', '--baseline', path.join(FIXTURES, 'c_teach_baseline.json')], { encoding: 'utf8' });
    need(ev.status === 0, `scripts/eval_owner_set.mjs exit ${ev.status}: ${(ev.stdout + ev.stderr).trim().split('\n').slice(0, 3).join(' | ')}`);
    need(/\b1 labelled swing/.test(ev.stdout), `eval_owner_set did not score the swing: ${ev.stdout.split('\n')[0]}`);
    try { fs.rmSync(path.join(FIXTURES, 'c_teach_baseline.json')); } catch { /* first run writes it */ }
    need(w.errors.length === 0, `page errors ${w.errors.slice(0, 3).join(' | ')}`);
    need(notes.length === 0, notes.join('\n'));
    return `${taps} taps for a correct swing; progress "${p0}" → "${p1}"; labels/1 export scored by eval_owner_set (1 swing, exit 0)`;
  } finally { await browser.close(); }
}

export const gates = [
  { meta: { id: 'c-shot-hero', title: 'C: shot card hero strip, disclosure, units', timeoutMs: 180000 }, run: shotHero },
  { meta: { id: 'c-timeline', title: 'C: timeline markers, keyboard, set-frame, undo, leave-confirm', timeoutMs: 120000 }, run: timeline },
  { meta: { id: 'c-labels', title: 'C: label rows and event names', timeoutMs: 120000 }, run: labels },
  { meta: { id: 'c-import-batch', title: 'C: batch import, error card, back-confirm, no-swing', timeoutMs: 240000 }, run: importBatch },
  { meta: { id: 'c-history', title: 'C: 1000-shot history, delete/undo, star, A/B names', timeoutMs: 300000 }, run: history },
  { meta: { id: 'c-teach', title: 'C: teach flow taps, progress, labels export', timeoutMs: 180000 }, run: teach },
];
