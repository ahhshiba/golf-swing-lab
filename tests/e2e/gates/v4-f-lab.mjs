// V4-F gates (V04-SPEC §G.3 V4-F 5 and 6). Chromium, 390 × 844, zh-TW, service workers blocked.
//  v4-f-lab       import tests/fixtures/shots/v2/valid_dtl_30.json with a synthetic dtl pose (tests/unit/lab.fixture.mjs
//                 withSynthPose: the shot's pose rows recomputed from it) → its results screen → shot-lab → the lab:
//                 8 lab-phase cards; lab-line count = 6 (dtl, calibrated: all drawn); next / previous-fault buttons
//                 step the replay to a ▲ mark; every fault chip carries a validity word; practice cards' "start"
//                 opens live with params.focus = the metric; for every live-measurable metric (ui/live.js
//                 LIVE_MEASURABLE) the hero must show it (strict), other metrics get a NOTE; no a[href^="http"]
//                 anywhere; no page error, nothing leaves the origin.
//  v4-f-patterns  import a golf-swing-lab-export/1 file built from tests/fixtures/v4/lab-sessions.json (6 swings per
//                 group, poses included) → History → history-seg[data-seg=patterns]: every row has n and an interval;
//                 no row mixes face_on and dtl (each row's data-view is one view and the fault is allowed there);
//                 the injected faults (early extension / dtl, sway and slide / face_on) are among the rows with hits;
//                 the 3 most common are listed; no h-scroll at 200 %; no page error / external request.
import fs from 'node:fs';
import path from 'node:path';
import { launch, watchPage, need, waitFor, ROOT } from '../lib.mjs';
import { noHScroll, setTextScale, contrastOfRendered } from '../checks.mjs';
import { withSynthPose, exportEnvelope, loadLabSessions } from '../../unit/lab.fixture.mjs';
import { LAB_PARAMS } from '../../../app/src/lab/params.js';

/** ui/live.js LIVE_MEASURABLE, read from the source (importing the screen module would need a DOM). */
const LIVE_MEASURABLE = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'app/src/ui/live.js'), 'utf8');
  const m = /LIVE_MEASURABLE\s*=\s*Object\.freeze\(\[([^\]]*)\]/.exec(src);
  if (!m) throw new Error('ui/live.js: LIVE_MEASURABLE not found');
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
})();

const VALIDITY_WORDS = (() => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/i18n/zh-Hant/validity.json'), 'utf8'));
  return [v.estimated, v.low_confidence].filter(Boolean);
})();

async function boot(ctx) {
  const browser = await launch(ctx);
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, permissions: ['camera', 'microphone'] });
  await context.addInitScript(() => { globalThis.__GSL_E2E__ = globalThis.__GSL_E2E__ ?? {}; });
  const page = await context.newPage();
  const w = watchPage(page);
  await page.goto(ctx.baseUrl);
  await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
  await page.evaluate(() => globalThis.__GSL_E2E__.app.ready());
  return { browser, page, w };
}

async function importEnvelope(page, env, minRows = 1) {
  await page.locator('[data-testid="tabbar-history"]').click();
  await page.locator('[data-screen="history"]').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('[data-testid="history-import-input"]').setInputFiles({ name: 'lab.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(env)) });
  await page.locator('[data-testid="history-restore-status"]').waitFor({ state: 'visible', timeout: 120000 });
  await waitFor(() => page.evaluate((n) => document.querySelectorAll('[data-screen="history"] [data-testid="shot-row"]').length >= n, minRows), { timeout: 60000, what: 'history rows' });
}

const visibleIn = (screen) => `[data-screen="${screen}"]:not([hidden])`;

async function lab(ctx) {
  const notes = [];
  const { browser, page, w } = await boot(ctx);
  try {
    const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/shots/v2/valid_dtl_30.json'), 'utf8'));
    const { shot, poseSeq } = withSynthPose(base, { seed: 7 });
    await importEnvelope(page, exportEnvelope({ groups: [] }, { extra: [{ shot, poseSeq }] }));
    await page.evaluate((id) => globalThis.__GSL_E2E__.app.nav.go('shot', { shot_id: id }), shot.shot_id);
    await page.locator(`${visibleIn('shot')} [data-testid="shot-lab"]`).waitFor({ state: 'visible', timeout: 20000 });
    await page.locator(`${visibleIn('shot')} [data-testid="shot-lab"]`).click();
    await page.locator(`${visibleIn('lab')} [data-testid="lab-phase"]`).first().waitFor({ state: 'attached', timeout: 20000 });
    const s = await page.evaluate(() => {
      const r = document.querySelector('[data-screen="lab"]');
      return {
        phases: [...r.querySelectorAll('[data-testid="lab-phase"]')].map((x) => x.dataset.event),
        lines: [...r.querySelectorAll('[data-testid="lab-line"]')].map((x) => [x.dataset.line, x.dataset.drawn]),
        chips: [...r.querySelectorAll('[data-testid="lab-fault"]')].map((x) => ({ id: x.dataset.fault, st: x.dataset.status, text: x.textContent })),
        marks: r.querySelectorAll('[data-testid="lab-mark"]').length,
        http: document.querySelectorAll('a[href^="http"]').length,
      };
    });
    need(s.phases.length === 8, `lab-phase count ${s.phases.length} (expected 8): ${s.phases.join(',')}`);
    need(s.lines.length === 6, `lab-line count ${s.lines.length} (expected 6): ${JSON.stringify(s.lines)}`);
    need(s.lines.every(([, d]) => d === 'true'), `calibrated dtl: every line drawn: ${JSON.stringify(s.lines)}`);
    need(s.chips.length > 0, 'no fault chip on the synthetic dtl swing (the stepping check needs one)');
    need(s.chips.every((c) => VALIDITY_WORDS.some((v) => c.text.includes(v))), `fault chip without a validity word: ${JSON.stringify(s.chips)}`);
    need(s.chips.every((c) => c.st === 'fault' || c.st === 'possible'), `a chip shows an unknown / ok status: ${JSON.stringify(s.chips)}`);
    need(s.http === 0, `${s.http} external links`);
    // the reference lines are painted over the replay in --overlay-select (a yellow: R, G high, B low)
    const painted = await waitFor(() => page.evaluate(() => {
      const cv = document.querySelector('[data-screen="lab"] .replay-canvas');
      const g = cv?.getContext('2d');
      if (!g || !cv.width) return 0;
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 170 && d[i + 2] < 90) n++;
      return n > 200 ? n : 0;
    }), { timeout: 8000, what: 'alignment lines painted on the replay' });
    await page.locator(`${visibleIn('lab')} .replay-canvas`).screenshot({ path: path.join(process.env.GSL_SHOTS_DIR || path.join(ROOT, 'tests/e2e/.shots'), 'v4-f-lab-replay.png') }).catch(() => {});
    notes.push(`8 phases, 6 lines drawn (${painted} overlay px), chips ${s.chips.map((c) => `${c.id}:${c.st}`).join(' ')}, ${s.marks} ▲ marks`);

    // stepping: next fault moves the replay to a mark frame; the frame buttons move one frame
    const time = () => page.evaluate(() => document.querySelector('[data-screen="lab"] .replay-canvas')?.getAttribute('aria-label') ?? '');
    const next = page.locator(`${visibleIn('lab')} [data-testid="lab-fault-next"]`);
    const prev = page.locator(`${visibleIn('lab')} [data-testid="lab-fault-prev"]`);
    await waitFor(async () => !(await next.isDisabled()), { timeout: 5000, what: 'lab-fault-next enabled' });
    const t0 = await time();
    await next.click();
    await waitFor(async () => (await page.locator(`${visibleIn('lab')} [data-testid="lab-step-status"]`).textContent())?.trim(), { timeout: 5000, what: 'step status' });
    const t1 = await time();
    need(t1 !== t0, `next fault did not move the replay (${t0})`);
    // marks of faults on the same phase share a frame: stepping goes frame to frame
    const nMarks = await page.evaluate(() => new Set([...document.querySelectorAll('[data-screen="lab"] [data-testid="lab-mark"]')].map((m) => m.style.left)).size);
    if (nMarks >= 2) {
      await next.click().catch(() => {});
      await waitFor(async () => !(await prev.isDisabled()), { timeout: 5000, what: 'lab-fault-prev enabled after two steps' });
      await prev.click();
    }
    await page.locator(`${visibleIn('lab')} [data-testid="lab-frame-next"]`).click();
    await waitFor(async () => (await time()) !== t1 || nMarks >= 2, { timeout: 5000, what: 'frame step' });
    notes.push(`stepping: ${t0} → ${t1}`);

    // the fault sheet: validity words and no external link inside
    await page.locator(`${visibleIn('lab')} [data-testid="lab-fault"]`).first().click();
    await page.locator('[data-testid="lab-fault-sheet"]').waitFor({ state: 'visible', timeout: 5000 });
    const sheet = await page.evaluate(() => ({ text: document.querySelector('[data-testid="lab-fault-sheet"]').textContent, http: document.querySelectorAll('a[href^="http"]').length }));
    need(VALIDITY_WORDS.some((v) => sheet.text.includes(v)) && sheet.http === 0, 'fault sheet: validity word / no external link');
    await page.keyboard.press('Escape');

    // practice cards → live. Strict for every card whose metric the live screen can measure (ui/live.js
    // LIVE_MEASURABLE): params.focus = the metric AND the hero shows it. Other metrics: params.focus only + a NOTE (the
    // hero honouring params.focus is ui/live.js, V4-B's — routed by the coordinator).
    const openMore = () => page.evaluate(() => { const d = document.querySelector('[data-screen="lab"]:not([hidden]) [data-testid="lab-drills-more"]'); if (d) d.open = true; });
    await openMore();
    const metrics = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-screen="lab"] [data-testid="lab-drill"]')].map((d) => d.dataset.metric))]);
    const strict = metrics.filter((m) => LIVE_MEASURABLE.includes(m));
    const loose = metrics.filter((m) => !LIVE_MEASURABLE.includes(m));
    need(strict.length > 0, `no live-measurable practice card on the lab screen (metrics ${metrics.join(',')})`);
    const start = async (metric) => {
      await page.locator(visibleIn('lab')).waitFor({ state: 'visible', timeout: 20000 });
      await openMore();
      const b = page.locator(`${visibleIn('lab')} [data-testid="lab-drill"][data-metric="${metric}"] [data-testid="lab-drill-start"]`).first();
      await b.scrollIntoViewIfNeeded();
      await b.click();
      await page.locator(visibleIn('live')).waitFor({ state: 'visible', timeout: 20000 });
      return page.evaluate(() => globalThis.__GSL_E2E__.app.store.get().params);
    };
    const heroOf = () => page.evaluate(() => [...document.querySelectorAll('[data-screen="live"] [data-testid="live-hero"] [data-metric]')].map((x) => x.dataset.metric));
    for (const metric of strict) {
      const params = await start(metric);
      need(params?.focus === metric && params?.view, `live params ${JSON.stringify(params)} (expected focus ${metric})`);
      await waitFor(async () => (await heroOf()).includes(metric), { timeout: 15000, what: `live hero shows ${metric}` });
      notes.push(`${metric} drill → live hero shows it`);
      await page.evaluate(() => globalThis.__GSL_E2E__.app.nav.back());
    }
    for (const metric of loose.slice(0, 2)) {
      const params = await start(metric);
      need(params?.focus === metric && params?.view, `live params ${JSON.stringify(params)} (expected focus ${metric})`);
      const hero = await heroOf();
      notes.push(hero.includes(metric) ? `${metric} drill → live hero shows it` : `NOTE ${metric} (not live-measurable) → live params.focus=${metric}, hero ${hero.join(',')}`);
      await page.evaluate(() => globalThis.__GSL_E2E__.app.nav.back());
    }

    need(w.errors.length === 0, `page errors: ${w.errors.join(' | ')}`);
    need(w.external.length === 0, `external requests: ${w.external.join(', ')}`);
    return notes.join('; ');
  } finally {
    await browser.close();
  }
}

// §E.3 views (from the rules): a row's fault must be observable from its view
const ALLOWED = Object.fromEntries(Object.entries(LAB_PARAMS.faults).map(([id, r]) => [id, Object.keys(r.views)]));

async function patterns(ctx) {
  const notes = [];
  const { browser, page, w } = await boot(ctx);
  try {
    const fx = loadLabSessions();
    const env = exportEnvelope(fx, { perGroup: 6 });
    await importEnvelope(page, env, 10);
    await page.locator('[data-screen="history"]:not([hidden]) [data-testid="history-seg"][data-seg="patterns"]').click();
    await page.locator(visibleIn('patterns')).waitFor({ state: 'visible', timeout: 20000 });
    await waitFor(() => page.evaluate(() => document.querySelectorAll('[data-screen="patterns"] [data-testid="patterns-row"]').length > 0), { timeout: 60000, what: 'patterns rows' });
    const r = await page.evaluate(() => {
      const root = document.querySelector('[data-screen="patterns"]');
      return {
        rows: [...root.querySelectorAll('[data-testid="patterns-row"]')].map((x) => ({ id: x.dataset.fault, view: x.dataset.view,
          n: x.querySelector('[data-testid="patterns-n"]')?.textContent ?? '', ci: x.querySelector('[data-testid="patterns-ci"]')?.textContent ?? '', card: x.tagName === 'SECTION' })),
        top: [...root.querySelectorAll('[data-testid="patterns-top"] li')].map((x) => x.dataset.fault),
        seg: Boolean(root.querySelector('[data-testid="history-seg"][data-seg="patterns"][aria-checked="true"]')),
        charts: root.querySelectorAll('[data-testid="patterns-chart"]').length,
      };
    });
    need(r.seg, 'patterns segment not selected');
    need(r.rows.length > 0, 'no rows');
    for (const x of r.rows) {
      need(/\d/.test(x.n), `row ${x.id}/${x.view}: no n (${x.n})`);
      need(/\d+.*[–-].*\d+/.test(x.ci), `row ${x.id}/${x.view}: no interval (${x.ci})`);
      need(['face_on', 'dtl', 'high_behind'].includes(x.view), `row ${x.id}: view ${x.view}`);
      need(ALLOWED[x.id]?.includes(x.view), `row ${x.id} counted on ${x.view}, a view that cannot see it`);
    }
    const keys = r.rows.map((x) => `${x.id}/${x.view}`);
    need(new Set(keys).size === keys.length, `a fault × view appears twice: ${keys.join(' ')}`);
    const hit = r.rows.filter((x) => x.card).map((x) => `${x.id}/${x.view}`);
    for (const k of ['early_extension/dtl', 'sway/face_on', 'slide/face_on']) need(hit.includes(k), `injected fault ${k} not among the rows with hits: ${hit.join(' ')}`);
    need(r.top.length >= 1 && r.top.length <= 3, `top list ${r.top.join(',')}`);
    notes.push(`${r.rows.length} rows (${hit.length} with hits), top ${r.top.join(',')}, ${r.charts} charts`);
    // the view filter keeps one view
    await page.locator('[data-screen="patterns"] [data-testid="patterns-view"] [data-value="face_on"]').click();
    await waitFor(() => page.evaluate(() => [...document.querySelectorAll('[data-screen="patterns"] [data-testid="patterns-row"]')].every((x) => x.dataset.view === 'face_on')), { timeout: 5000, what: 'face_on filter' });
    await setTextScale(page, 2);
    await noHScroll(page);
    await setTextScale(page, 1);
    need(w.errors.length === 0, `page errors: ${w.errors.join(' | ')}`);
    need(w.external.length === 0, `external requests: ${w.external.join(', ')}`);
    return notes.join('; ');
  } finally {
    await browser.close();
  }
}

// ------------------------------------------------------------------ v4-f-matrix
// The screenshot matrix seeds History with pose-less shots, so its lab states show no fault chip and patterns no
// populated row. This gate runs the matrix's own in-page checks (pageChecks, read from tests/e2e/screenshot_matrix.mjs
// and evaluated as is) plus text contrast on a pose-bearing seed: lab-sessions.json (4 swings per group) and a dtl swing
// with an early-extension FAULT and a head-dip POSSIBLE. States lab:fault (chips + sheet), lab:phase, lab:lines and
// patterns (populated rows + charts); 3 themes × zh-Hant / en × text 100 / 200 % × 390 / 430 wide.
const MATRIX_SRC = path.join(ROOT, 'tests/e2e/screenshot_matrix.mjs');
function pageChecksSource() {
  const src = fs.readFileSync(MATRIX_SRC, 'utf8');
  const a = src.indexOf('function pageChecks(');
  const b = src.indexOf('\n}\n', a);
  if (a < 0 || b < 0) throw new Error('screenshot_matrix.mjs: pageChecks not found');
  return src.slice(a, b + 2);
}
const BROWSER_LOCALE = { 'zh-Hant': 'zh-TW', en: 'en-US' };

async function matrix(ctx) {
  const checks = pageChecksSource();
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/shots/v2/valid_dtl_30.json'), 'utf8'));
  const flagged = withSynthPose({ ...base, shot_id: 'shot-lab-matrix-dtl' }, { seed: 7, params: { pelvisImp: [0.06, -0.10, 0], headImp: [0, 0, -0.04] } });
  const env = exportEnvelope(loadLabSessions(), { perGroup: 4, extra: [flagged] });
  const outDir = process.env.GSL_SHOTS_DIR || path.join(ROOT, 'tests/e2e/.shots');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await launch(ctx);
  const bad = [];
  let shots = 0;
  const seen = { fault: 0, possible: 0, rows: 0 };
  try {
    for (const locale of ['zh-Hant', 'en']) {
      const context = await browser.newContext({ serviceWorkers: 'block', locale: BROWSER_LOCALE[locale], viewport: { width: 390, height: 844 } });
      await context.addInitScript(() => { globalThis.__GSL_E2E__ = globalThis.__GSL_E2E__ ?? {}; });
      const page = await context.newPage();
      const w = watchPage(page);
      await page.goto(ctx.baseUrl);
      await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
      await page.evaluate(() => globalThis.__GSL_E2E__.app.ready());
      await importEnvelope(page, env, 10);
      const states = {
        'lab~fault': async () => {
          await page.evaluate(() => document.querySelector('[aria-modal="true"]') && document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
          await page.evaluate(() => globalThis.__GSL_E2E__.app.nav.go('lab', { shot_id: 'shot-lab-matrix-dtl' }));
          await page.locator(`${visibleIn('lab')} [data-testid="lab-fault"]`).first().waitFor({ state: 'visible', timeout: 20000 });
          const st = await page.evaluate(() => [...document.querySelectorAll('[data-screen="lab"] [data-testid="lab-fault"]')].map((c) => c.dataset.status));
          seen.fault += st.filter((x) => x === 'fault').length; seen.possible += st.filter((x) => x === 'possible').length;
          return false;
        },
        'lab~sheet': async () => {
          await page.locator(`${visibleIn('lab')} [data-testid="lab-fault"][data-status="fault"]`).first().click();
          await page.locator('[data-testid="lab-fault-sheet"]').waitFor({ state: 'visible', timeout: 5000 });
          return true;
        },
        'lab~phase': async () => {
          await page.keyboard.press('Escape');
          await page.evaluate(() => document.querySelector('[data-screen="lab"] [data-testid="lab-phase"][data-event="impact"]')?.scrollIntoView({ block: 'start' }));
          return false;
        },
        'lab~lines': async () => { await page.evaluate(() => document.querySelector('[data-screen="lab"] .lab-lines')?.scrollIntoView({ block: 'start' })); return false; },
        patterns: async () => {
          await page.evaluate(() => globalThis.__GSL_E2E__.app.nav.go('patterns'));
          await waitFor(() => page.evaluate(() => document.querySelectorAll('[data-screen="patterns"] section[data-testid="patterns-row"]').length > 0), { timeout: 60000, what: 'patterns rows' });
          seen.rows = Math.max(seen.rows, await page.evaluate(() => document.querySelectorAll('[data-screen="patterns"] section[data-testid="patterns-row"]').length));
          await page.waitForTimeout(400);
          return false;
        },
      };
      for (const [name, open] of Object.entries(states)) {
        await open();
        const screen = name.split('~')[0];
        for (const theme of ['light', 'dark', 'sun']) for (const scale of [1, 2]) for (const vp of [{ width: 390, height: 844 }, { width: 430, height: 932 }]) {
          await page.setViewportSize(vp);
          // as the matrix does: every check runs at scroll 0 (its overlap rule covers the end of the page itself)
          await page.evaluate(([th, k]) => {
            const app = globalThis.__GSL_E2E__?.app;
            if (app?.updateSettings) app.updateSettings({ ...app.settings(), theme: th });
            document.documentElement.dataset.theme = th;
            document.documentElement.style.fontSize = k === 1 ? '' : `${k * 100}%`;
            window.scrollTo(0, 0);
          }, [theme, scale]);
          await page.waitForTimeout(250);
          const r = await page.evaluate(`(${checks})(${JSON.stringify([screen, locale, vp])})`);
          const c = await contrastOfRendered(page);
          const file = `v4f-${name}-${vp.width}x${vp.height}-${theme}-${locale}-${scale}x.png`;
          await page.screenshot({ path: path.join(outDir, file), fullPage: true, animations: 'disabled' });
          shots++;
          for (const f of r.findings) bad.push(`${file}: ${f.kind} ${f.detail}`);
          for (const o of c.offenders.slice(0, 3)) bad.push(`${file}: contrast ${o.ratio} < ${o.need} "${o.text}" (${o.sel})`);
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
      }
      need(w.errors.length === 0, `${locale}: page errors: ${w.errors.join(' | ')}`);
      need(w.external.length === 0, `${locale}: external requests: ${w.external.join(', ')}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
  need(seen.fault > 0 && seen.possible > 0, `seed did not show a fault and a possible chip: ${JSON.stringify(seen)}`);
  need(seen.rows > 0, 'patterns showed no populated row');
  need(bad.length === 0, `${bad.length} finding(s):\n${bad.slice(0, 30).join('\n')}`);
  return `${shots} screenshots (lab fault + sheet, phase, lines, patterns × 3 themes × 2 locales × 2 text sizes × 2 widths) → ${outDir}; chips fault ${seen.fault} / possible ${seen.possible}, patterns rows ${seen.rows}; 0 findings (matrix checks + text contrast)`;
}

export const gates = [
  { meta: { id: 'v4-f-lab', title: 'V4-F: results → swing lab (8 phases, 6 dtl lines, fault stepping, validity on chips, drill → live, no external links)', timeoutMs: 240000 }, run: lab },
  { meta: { id: 'v4-f-matrix', title: 'V4-F: screenshot-matrix checks + contrast on a pose-bearing seed (fault + possible chips, fault sheet, phases, lines, populated patterns), 3 themes × 2 locales × 2 text sizes × 2 widths', timeoutMs: 900000 }, run: matrix },
  { meta: { id: 'v4-f-patterns', title: 'V4-F: lab-sessions import → History › Patterns (n + interval per row, views never merged, injected faults found)', timeoutMs: 300000 }, run: patterns },
];
