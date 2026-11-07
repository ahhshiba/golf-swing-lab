// LM-D gates (LAUNCH-MONITOR-SPEC §5.2 LM-D acceptance 1–4). Chromium, 390 × 844, zh-TW. The fixtures
// tests/fixtures/shots/v2/valid_*.json and the golf-shot/1 tests/fixtures/shots/valid_face_on_240.json (migrated on
// read) go in through the history import, as a user's backup would.
//   lm-d-tiles   first screen (no scrolling, above the tab bar) of the face_on fixture: ≥ 6 shot-tile, every .mt-num
//                ≥ 40 px; every estimated tile with a model value_origin shows 「估」 and ◐; null tiles show — and the
//                short reason; a tile opens the detail sheet (range + reasons); shared checks (44 px, names, 200 %)
//   lm-d-edit    shot-tiles-edit → switch carry_m off, tiles-up moves spin_rate_rpm to the top, close, reload: first
//                shot-tile is spin_rate_rpm and carry_m is gone; no drag event fired during the whole flow
//   lm-d-viz     the 4 shot-viz-tab in order each paint > 500 non-transparent canvas pixels; dtl shows the tempo card
//                (no canvas); the no-clip fixture's video tab is aria-disabled="true" with a reason line
//   lm-d-legacy  migrated golf-shot/1 shot: the 14 new tiles are — + the MIGRATED_V1 short reason; shot-rederive
//                makes revision + 1; the flight-model tiles (total, apex, landing angle, hang time) get values and every
//                face_on tile still null names a reason; only attack angle may keep MIGRATED_V1 (it needs the video:
//                no club-head track in a golf-shot/1 record), its dependants say DEPENDS_ON_NULL
import fs from 'node:fs';
import path from 'node:path';
import { launch, watchPage, need, ROOT, FIXTURES, waitFor } from '../lib.mjs';
import { noHScroll, minTargets, accessibleNames, noSpecCodes, setTextScale } from '../checks.mjs';

const V2 = ['valid_face_on_240', 'valid_face_on_240_no_clip', 'valid_high_behind_240', 'valid_dtl_30'];
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const SHOTS = [...V2.map((n) => read(`tests/fixtures/shots/v2/${n}.json`)), read('tests/fixtures/shots/valid_face_on_240.json')];
const ZH = (ns) => read(`app/i18n/zh-Hant/${ns}.json`);
const TILES = ZH('tiles');
const REASON = ZH('reason');
const short = (c) => REASON[`${c}.short`] ?? REASON[c]?.short;
const LM_IDS = ['attack_angle_deg', 'dynamic_loft_deg', 'face_angle_deg', 'face_to_path_deg', 'spin_loft_deg', 'spin_rate_rpm', 'spin_axis_deg',
  'total_m', 'carry_side_m', 'total_side_m', 'curve_m', 'apex_m', 'landing_angle_deg', 'hang_time_s'];
const FO_LM = ['attack_angle_deg', 'dynamic_loft_deg', 'spin_loft_deg', 'spin_rate_rpm', 'total_m', 'apex_m', 'landing_angle_deg', 'hang_time_s'];
const FO_FLIGHT = ['total_m', 'apex_m', 'landing_angle_deg', 'hang_time_s'];
const INFERRED = ['dplane', 'spin_model', 'flight_model', 'prior'];
const FO = 'shot-fx-v2-face-on-240';
const SETTINGS_KEY = 'gsl-settings-v2';

function fixtureFile() {
  fs.mkdirSync(FIXTURES, { recursive: true });
  const f = path.join(FIXTURES, 'lm_d_shots.json');
  fs.writeFileSync(f, JSON.stringify({ format: 'golf-swing-lab-export/1', exported_at: '2026-11-06T00:00:00.000Z', app_version: '0.2.0', venues: [], presets: [], sessions: [], shots: SHOTS }));
  return f;
}

async function until(page, fn, arg, what, timeout = 20000) {
  return waitFor(() => page.evaluate(fn, arg), { timeout, interval: 100, what });
}

async function boot(ctx) {
  const browser = await launch(ctx);
  const context = await browser.newContext({ serviceWorkers: 'block', locale: 'zh-TW', viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => { globalThis.__GSL_E2E__ = globalThis.__GSL_E2E__ ?? {}; });
  const page = await context.newPage();
  const w = watchPage(page);
  await page.goto(ctx.baseUrl);
  await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
  await page.evaluate(() => globalThis.__GSL_E2E__.app.ready());
  return { browser, page, w };
}

async function goHistory(page) {
  await page.locator('[data-testid="tabbar-history"]').click();
  await page.locator('[data-screen="history"]').waitFor({ state: 'visible', timeout: 10000 });
}

async function importAll(page) {
  await goHistory(page);
  await page.locator('[data-testid="history-import-input"]').setInputFiles(fixtureFile());
  await until(page, (n) => document.querySelectorAll('[data-screen="history"] [data-testid="shot-row"]').length >= n, SHOTS.length, `${SHOTS.length} history rows`, 60000);
}

async function openShot(page, id) {
  await page.locator(`[data-screen="history"] [data-testid="shot-row"][data-shot="${id}"]`).click();
  await page.locator('[data-screen="shot"] [data-testid="shot-hero"] [data-testid="shot-tile"]').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(400);
}

async function reopen(page, id) {
  await goHistory(page);
  await openShot(page, id);
}

async function setLm(page, lm) {
  await page.evaluate(([k, patch]) => {
    const s = JSON.parse(localStorage.getItem(k) || '{}');
    s.lm = { ...(s.lm ?? {}), ...patch };
    localStorage.setItem(k, JSON.stringify(s));
  }, [SETTINGS_KEY, lm]);
  await page.reload();
  await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
  await page.evaluate(() => globalThis.__GSL_E2E__.app.ready());
}

const tilesOf = (page) => page.evaluate(() => {
  const bar = document.querySelector('#tabbar, .tabbar');
  const r0 = bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().top : innerHeight;
  const fold = Math.min(innerHeight, r0);
  return [...document.querySelectorAll('[data-screen="shot"] [data-testid="shot-tile"]')].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      id: el.dataset.metric, top: r.top, bottom: r.bottom, fold, text: el.innerText,
      num: parseFloat(getComputedStyle(el.querySelector('.mt-num')).fontSize),
      value: el.querySelector('.mt-num')?.textContent ?? '', reason: el.querySelector('.dt-reason')?.textContent ?? '',
    };
  });
});

async function shared(page, tag) {
  const bad = [];
  const sc = await noSpecCodes(page);
  if (!sc.ok) bad.push(`${tag}: spec codes ${JSON.stringify(sc.hits.slice(0, 3))}`);
  const mt = await minTargets(page, 44);
  if (!mt.ok) bad.push(`${tag}: targets < 44 px ${JSON.stringify(mt.offenders.slice(0, 4))}`);
  const an = await accessibleNames(page);
  if (!an.ok) bad.push(`${tag}: unnamed controls ${JSON.stringify(an.offenders.slice(0, 3))}`);
  await setTextScale(page, 2);
  await page.waitForTimeout(200);
  const hs = await noHScroll(page);
  if (!hs.ok) bad.push(`${tag}: horizontal scroll at 200 % (${hs.scrollWidth} > ${hs.clientWidth})`);
  await setTextScale(page, 1);
  await page.waitForTimeout(100);
  return bad;
}

// ------------------------------------------------------------------ lm-d-tiles
async function tiles(ctx) {
  const { browser, page, w } = await boot(ctx);
  try {
    await importAll(page);
    await openShot(page, FO);
    await page.evaluate(() => window.scrollTo(0, 0));
    const fx = SHOTS.find((s) => s.shot_id === FO);
    const all = await tilesOf(page);
    const first = all.filter((x) => x.top >= 0 && x.bottom <= x.fold + 0.5);
    need(first.length >= 6, `first screen shows ${first.length} whole shot-tile (fold ${all[0]?.fold}px; bottoms ${all.map((x) => Math.round(x.bottom)).join(',')}), want ≥ 6`);
    need(all.every((x) => x.num >= 40), `.mt-num font-size ${all.map((x) => x.num).join(',')} (want ≥ 40 px)`);
    const badEst = [];
    for (const x of all) {
      const m = fx.metrics[x.id];
      if (m?.validity === 'estimated' && INFERRED.includes(m.value_origin) && !(x.text.includes(TILES.estimated_badge) && x.text.includes('◐'))) badEst.push(`${x.id}: "${x.text.replace(/\n/g, ' ')}"`);
    }
    need(badEst.length === 0, `estimated model tiles without 估 + ◐: ${badEst.join(' | ')}`);
    const nEst = all.filter((x) => INFERRED.includes(fx.metrics[x.id]?.value_origin)).length;
    need(nEst >= 3, `only ${nEst} model-inferred tiles on the face_on fixture`);
    // detail sheet
    await page.locator('[data-screen="shot"] [data-testid="shot-tile"][data-metric="spin_rate_rpm"]').click();
    const sheet = page.locator('[data-testid="tile-detail"]');
    await sheet.waitFor({ state: 'visible', timeout: 5000 });
    const st = await sheet.innerText();
    need(st.includes(REASON['SPIN_MODELLED.long'] ?? '\u0000') || st.includes(short('SPIN_MODELLED')), `detail sheet lacks the SPIN_MODELLED text: "${st.slice(0, 200)}"`);
    need(/1[,.]?905|1905/.test(st) && st.includes(TILES['detail.range']), `detail sheet lacks the 95 % range: "${st.slice(0, 300)}"`);
    await sheet.locator('.sheet-close').click();
    const bad = await shared(page, 'face_on');
    // null tiles: the face_on default list on the high_behind fixture
    await setLm(page, { tilePreset: 'custom', tiles: ['carry_m', 'ball_speed_mps', 'launch_v_deg', 'spin_rate_rpm', 'apex_m', 'smash_factor'] });
    await reopen(page, 'shot-fx-v2-high-behind-240');
    const hb = SHOTS.find((s) => s.shot_id === 'shot-fx-v2-high-behind-240');
    const nulls = (await tilesOf(page)).filter((x) => hb.metrics[x.id]?.value === null);
    need(nulls.length >= 3, `only ${nulls.length} null tiles on the high_behind fixture`);
    const badNull = nulls.filter((x) => x.value.trim() !== '—' || x.reason !== short(hb.metrics[x.id].reason_codes[0]));
    need(badNull.length === 0, `null tiles without — + short reason: ${badNull.map((x) => `${x.id}="${x.value}"/"${x.reason}"`).join(' | ')}`);
    need(bad.length === 0, bad.join('; '));
    need(w.errors.length === 0, `page errors: ${w.errors.slice(0, 3).join(' | ')}`);
    need(w.external.length === 0, `external requests: ${w.external.slice(0, 3).join(', ')}`);
    return `${first.length} tiles above the fold (fonts ${[...new Set(all.map((x) => x.num))].join('/')} px), ${nEst} model tiles with 估 + ◐, ${nulls.length} null tiles with — + reason, detail sheet with range`;
  } finally { await browser.close(); }
}

// ------------------------------------------------------------------ lm-d-edit
async function edit(ctx) {
  const { browser, page, w } = await boot(ctx);
  try {
    await importAll(page);
    const arm = () => page.evaluate(() => {
      globalThis.__lmDrag = 0;
      for (const ev of ['dragstart', 'drag', 'dragenter', 'dragover', 'drop', 'dragend']) document.addEventListener(ev, () => { globalThis.__lmDrag++; }, true);
    });
    await arm();
    await openShot(page, FO);
    await page.locator('[data-screen="shot"] [data-testid="shot-tiles-edit"]').click();
    const sheet = page.locator('[data-testid="tiles-sheet"]');
    await sheet.waitFor({ state: 'visible', timeout: 5000 });
    await sheet.locator('[data-testid="tiles-row"][data-metric="carry_m"] [role="switch"]').click();
    const order = () => sheet.locator('[data-testid="tiles-row"]:has([data-testid="tiles-up"])').evaluateAll((els) => els.map((e) => e.dataset.metric));
    let o = await order();
    need(!o.includes('carry_m'), `carry_m still in the shown list after its switch: ${o.join(',')}`);
    need(o.includes('spin_rate_rpm'), `spin_rate_rpm not in the shown list: ${o.join(',')}`);
    for (let i = 0; i < 20 && o[0] !== 'spin_rate_rpm'; i++) {
      await sheet.locator('[data-testid="tiles-row"][data-metric="spin_rate_rpm"] [data-testid="tiles-up"]').click();
      o = await order();
    }
    need(o[0] === 'spin_rate_rpm', `tiles-up did not move spin_rate_rpm first: ${o.join(',')}`);
    const live = await page.locator('[data-screen="shot"] [data-testid="shot-tile"]').first().getAttribute('data-metric');
    need(live === 'spin_rate_rpm', `no live preview: first tile behind the sheet is ${live}`);
    await sheet.locator('.sheet-close').click();
    await sheet.waitFor({ state: 'detached', timeout: 5000 });
    const drags1 = await page.evaluate(() => globalThis.__lmDrag);
    await page.reload();
    await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
    await page.evaluate(() => globalThis.__GSL_E2E__.app.ready());
    await arm();
    await reopen(page, FO);
    const ids = await page.locator('[data-screen="shot"] [data-testid="shot-tile"]').evaluateAll((els) => els.map((e) => e.dataset.metric));
    need(ids[0] === 'spin_rate_rpm', `after reload the first shot-tile is ${ids[0]} (${ids.join(',')})`);
    need(!ids.includes('carry_m'), `after reload carry_m is still shown (${ids.join(',')})`);
    const drags2 = await page.evaluate(() => globalThis.__lmDrag);
    need(drags1 === 0 && drags2 === 0, `drag events fired: ${drags1} + ${drags2}`);
    need(w.errors.length === 0, `page errors: ${w.errors.slice(0, 3).join(' | ')}`);
    return `edited with buttons only (0 drag events); after reload: ${ids.slice(0, 4).join(', ')}… (${ids.length} tiles, no carry_m)`;
  } finally { await browser.close(); }
}

// ------------------------------------------------------------------ lm-d-viz
const inked = (page) => page.evaluate(() => {
  const cv = [...document.querySelectorAll('[data-screen="shot"] [data-testid="shot-viz"] canvas')].find((c) => c.getBoundingClientRect().width > 0);
  if (!cv || !cv.width || !cv.height) return -1;
  const d = new Uint32Array(cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data.buffer);
  // non-transparent pixels, and (stricter: a chart that only fills its background would pass the first) pixels that
  // differ from the most common colour
  const hist = new Map();
  let n = 0;
  for (const p of d) { if (p >>> 24) n++; hist.set(p, (hist.get(p) ?? 0) + 1); }
  let mode = 0;
  let best = -1;
  for (const [p, c] of hist) if (c > best) { best = c; mode = p; }
  return Math.min(n, d.length - (mode >>> 24 ? best : 0));
});

async function viz(ctx) {
  const { browser, page, w } = await boot(ctx);
  try {
    await importAll(page);
    await openShot(page, FO);
    const tabs = await page.locator('[data-screen="shot"] [data-testid="shot-viz-tab"]').evaluateAll((els) => els.map((e) => e.dataset.tab));
    need(JSON.stringify(tabs) === JSON.stringify(['side', 'top', '3d', 'video']), `shot-viz-tab order ${tabs.join(',')}`);
    const counts = {};
    for (const tab of tabs) {
      await page.locator(`[data-screen="shot"] [data-testid="shot-viz-tab"][data-tab="${tab}"]`).click();
      await waitFor(async () => (await inked(page)) > 500, { timeout: 8000, interval: 150, what: `${tab}: > 500 inked pixels` }).catch(() => {});
      counts[tab] = await inked(page);
      const sel = await page.locator(`[data-screen="shot"] [data-testid="shot-viz-tab"][data-tab="${tab}"]`).getAttribute('aria-selected');
      need(sel === 'true', `${tab}: tab not selected after the click`);
    }
    need(Object.values(counts).every((n) => n > 500), `non-transparent canvas pixels per tab ${JSON.stringify(counts)} (want > 500 each)`);
    const label = await page.locator('[data-screen="shot"] [data-testid="shot-viz"] canvas[role="img"]').first().getAttribute('aria-label');
    need(Boolean(label && label.trim()), 'the chart canvas has no aria-label');
    // dtl: tempo card instead of a canvas
    await reopen(page, 'shot-fx-v2-dtl-30');
    const dtl = await page.evaluate(() => {
      const v = document.querySelector('[data-screen="shot"] [data-testid="shot-viz"]');
      return { canvas: v?.querySelectorAll('canvas').length ?? -1, tempo: Boolean(v?.querySelector('.lm-tempo .mt-num')), text: v?.innerText ?? '' };
    });
    need(dtl.canvas === 0 && dtl.tempo, `dtl hero: ${JSON.stringify(dtl).slice(0, 200)} (want the tempo card, no canvas)`);
    // no clip: the video tab is disabled with a reason line
    await reopen(page, 'shot-fx-v2-face-on-240-no-clip');
    const vid = page.locator('[data-screen="shot"] [data-testid="shot-viz-tab"][data-tab="video"]');
    need(await vid.getAttribute('aria-disabled') === 'true', `no-clip video tab aria-disabled=${await vid.getAttribute('aria-disabled')}`);
    const note = await page.locator('[data-screen="shot"] [data-testid="shot-viz"] .lm-viz-note').last().innerText().catch(() => '');
    need(note.includes(short('CLIP_NOT_SAVED')), `no-clip reason line "${note}" lacks "${short('CLIP_NOT_SAVED')}"`);
    await vid.click({ force: true });
    need(await vid.getAttribute('aria-selected') === 'false', 'the disabled video tab could be selected');
    need(w.errors.length === 0, `page errors: ${w.errors.slice(0, 3).join(' | ')}`);
    return `inked pixels ${JSON.stringify(counts)}; dtl → tempo card; no clip → video tab disabled ("${note}")`;
  } finally { await browser.close(); }
}

// ------------------------------------------------------------------ lm-d-legacy
async function legacy(ctx) {
  const { browser, page, w } = await boot(ctx);
  try {
    await importAll(page);
    await setLm(page, { tilePreset: 'custom', tiles: LM_IDS });
    await reopen(page, 'shot-fx-face-on-240');
    const before = await tilesOf(page);
    need(before.length === 14 && LM_IDS.every((id) => before.some((x) => x.id === id)), `legacy shot shows ${before.map((x) => x.id).join(',')}`);
    const mig = short('MIGRATED_V1');
    const bad = before.filter((x) => x.value.trim() !== '—' || x.reason !== mig);
    need(bad.length === 0, `new tiles not — + "${mig}": ${bad.map((x) => `${x.id}="${x.value}"/"${x.reason}"`).join(' | ')}`);
    const rev0 = await page.evaluate(async () => (await globalThis.__GSL_E2E__.app.repo.shots.get('shot-fx-face-on-240')).revision);
    const btn = page.locator('[data-screen="shot"] [data-testid="shot-rederive"]');
    await btn.waitFor({ state: 'visible', timeout: 10000 });
    need(await btn.isEnabled(), 'shot-rederive is disabled');
    await btn.click();
    await until(page, (r) => globalThis.__GSL_E2E__.app.repo.shots.get('shot-fx-face-on-240').then((s) => s.revision === r + 1), rev0, 'revision + 1', 20000);
    await page.locator('[data-screen="shot"] [data-testid="shot-tile"]').first().waitFor({ state: 'visible' });
    await page.waitForTimeout(300);
    const after = await tilesOf(page);
    // rederive works from the stored numbers only (§2.1): attack angle is tracked from the video (§1.2 #2), so on a
    // golf-shot/1 record it stays null with MIGRATED_V1 (physics/lm/index.js), and dynamic loft / spin loft / spin
    // that depend on it say DEPENDS_ON_NULL. The flight-model tiles must get values; anything still null must say why
    const empty = after.filter((x) => FO_FLIGHT.includes(x.id) && x.value.trim() === '—');
    need(empty.length === 0, `after recompute still empty: ${empty.map((x) => `${x.id} (${x.reason})`).join(', ')}`);
    const silent = after.filter((x) => FO_LM.includes(x.id) && x.value.trim() === '—' && !x.reason);
    need(silent.length === 0, `null tiles without a reason after recompute: ${silent.map((x) => x.id).join(', ')}`);
    const valued = after.filter((x) => FO_LM.includes(x.id) && x.value.trim() !== '—').map((x) => x.id);
    need(!after.some((x) => x.reason === mig && x.id !== 'attack_angle_deg'), `a tile other than attack angle still says MIGRATED_V1 after the recompute: ${after.filter((x) => x.reason === mig).map((x) => x.id).join(', ')}`);
    need(w.errors.length === 0, `page errors: ${w.errors.slice(0, 3).join(' | ')}`);
    return `14 new tiles — + "${mig}"; shot-rederive → revision ${rev0} → ${rev0 + 1}; values now: ${valued.join(', ')}; still null with a reason: ${FO_LM.filter((id) => !valued.includes(id)).join(', ') || 'none'}`;
  } finally { await browser.close(); }
}

export const gates = [
  { meta: { id: 'lm-d-tiles', title: 'LM-D 1: ≥ 6 data tiles above the fold, ≥ 40 px numbers, 估 + ◐ on model values, — + reason on nulls', timeoutMs: 180000 }, run: tiles },
  { meta: { id: 'lm-d-edit', title: 'LM-D 2: tile editor with buttons (no drag): carry off, spin first, survives reload', timeoutMs: 180000 }, run: edit },
  { meta: { id: 'lm-d-viz', title: 'LM-D 3: side / top / 3D / video each paint, dtl tempo card, no-clip video tab disabled with reason', timeoutMs: 180000 }, run: viz },
  { meta: { id: 'lm-d-legacy', title: 'LM-D 4: migrated golf-shot/1 shows — + MIGRATED_V1, recompute → revision + 1 with values', timeoutMs: 180000 }, run: legacy },
];
