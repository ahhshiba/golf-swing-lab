// Gate lm-e-drill (LAUNCH-MONITOR-SPEC §5.2 LM-E acceptance 3): a practice test end to end in Chromium, 390 × 844, zh-Hant.
//  home → 練習模式 (home-drills) → drills-card[data-template=distance18] → 開始 (drills-start) → drill-target shows
//  target 1 → drill-import → import 2 fixture clips (recorded one minute apart) → the two import-slot selects are 1 and 2
//  → 開始分析 → back to the drill: drill-progress 2/18 and 2 drill-score, each marked estimated (◐); the 2 saved shots
//  carry practice { drill_id, slot 1 / 2 }; reload: progress still 2/18 and IDB `drills` holds 1 record.
// Analysis stand-in: __GSL_E2E__.analyzeClip returns the face-on v2 fixture with a modelled carry (probe, queue, save,
// drills store and every screen are real), as gate c-import-batch does.
import fs from 'node:fs';
import path from 'node:path';
import { launch, watchPage, need, waitFor, ROOT, FIXTURES, mp4Fixture } from '../lib.mjs';

export const meta = { id: 'lm-e-drill', title: 'LM-E: distance-control test from home → import 2 clips → slots 1, 2 → progress 2/18 with 2 scores, kept after reload', timeoutMs: 240000 };

function standIn(shotJson) {
  const base = JSON.parse(shotJson);
  let n = 0;
  globalThis.__GSL_E2E__ = { ...(globalThis.__GSL_E2E__ ?? {}), analyzeClip: async (file, options, { onProgress } = {}) => {
    for (const st of ['pose', 'events', 'impact', 'assemble']) { onProgress?.(st, 0); await new Promise((r) => setTimeout(r, 120)); }
    const s = JSON.parse(JSON.stringify(base));
    const carry = 60 + 15 * n++;
    Object.assign(s, { shot_id: options.ids.shot_id, session_id: options.ids.session_id, created_at: options.ids.created_at, venue_id: null, preset_id: null, flight: null });
    s.metrics.carry_m = { ...s.metrics.carry_m, value: carry, ci95: [carry - 8, carry + 8], sigma: null };
    s.capture = { ...s.capture, clip_ref: options.clip_ref };
    s.club = { ...s.club, type: options.club.type };
    return { shot: s, poseSeq: null };
  } };
}

const until = (page, fn, arg, what, timeout = 30000) => waitFor(() => page.evaluate(fn, arg), { timeout, interval: 100, what });

async function idb(page, base) {
  return page.evaluate(async (b) => {
    const S = await import(`${b}src/store/index.js`);
    const repo = await S.openRepository(S.idbBackend());
    const drills = await repo.drills.list();
    const shots = (await repo.shots.list()).filter((s) => s.practice).map((s) => s.practice);
    await repo.close();
    return { drills: drills.length, shots };
  }, base);
}

async function openDrillFromHome(page) {
  await page.locator('[data-testid="tabbar-practice"]').click().catch(() => {});
  await page.locator('[data-screen="home"] [data-testid="home-drills"]').click();
  await page.locator('[data-screen="drills"]').waitFor({ state: 'visible', timeout: 15000 });
}

export async function run(ctx) {
  const { file: clip } = await mp4Fixture('vp9');
  fs.mkdirSync(FIXTURES, { recursive: true });
  const a = path.join(FIXTURES, 'lm_e_clip_1.mp4');
  const b = path.join(FIXTURES, 'lm_e_clip_2.mp4');
  fs.copyFileSync(clip, a);
  fs.copyFileSync(clip, b);
  const t0 = Date.parse('2026-11-06T10:00:00Z') / 1000;
  fs.utimesSync(a, t0, t0);
  fs.utimesSync(b, t0 + 60, t0 + 60);
  const shotJson = fs.readFileSync(path.join(ROOT, 'tests/fixtures/shots/v2/valid_face_on_240.json'), 'utf8');
  const browser = await launch(ctx);
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', locale: 'zh-TW', viewport: { width: 390, height: 844 } });
    await context.addInitScript(standIn, shotJson);
    const page = await context.newPage();
    const w = watchPage(page);
    await page.goto(ctx.baseUrl);
    await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
    await page.evaluate(() => globalThis.__GSL_E2E__.app.ready());

    // home → drills → distance18 → start
    await openDrillFromHome(page);
    await page.locator('[data-testid="drills-card"][data-template="distance18"]').click();
    await page.locator('[data-testid="drills-start"]').click();
    await page.locator('[data-screen="drill"] [data-testid="drill-target"]').waitFor({ state: 'visible', timeout: 15000 });
    const target1 = await page.locator('[data-screen="drill"] [data-testid="drill-target"]').innerText();
    need(/第 1 題/.test(target1) && /碼/.test(target1), `drill-target "${target1}" is not target 1 in yards`);
    const p0 = await page.locator('[data-testid="drill-progress"]').innerText();
    need(/0\/18/.test(p0), `drill-progress "${p0}", expected 0/18`);

    // drill-import → the import screen, 2 clips → slots 1 and 2
    await page.locator('[data-testid="drill-import"]').click();
    await page.locator('[data-screen="import"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-screen="import"] [data-testid="import-drill"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-screen="import"] [data-testid="import-file-input"]').setInputFiles([b, a]);
    await until(page, () => { const x = document.querySelector('[data-testid="import-start"]'); return Boolean(x && !x.disabled); }, null, 'import-start enabled', 60000);
    const slots = await page.evaluate(() => [...document.querySelectorAll('[data-screen="import"] [data-testid="import-slot"]')].map((s) => s.value));
    need(slots.length === 2, `${slots.length} import-slot selects, expected 2`);
    need([...slots].sort().join(',') === '1,2', `import-slot values ${slots}, expected 1 and 2`);
    const order = await page.evaluate(() => [...document.querySelectorAll('[data-screen="import"] .drill-map-row')].map((r) => `${r.querySelector('label').textContent}=${r.querySelector('select').value}`));
    need(order.includes('lm_e_clip_1.mp4=1') && order.includes('lm_e_clip_2.mp4=2'), `clips not mapped by recording time: ${order}`);
    const what = await page.locator('[data-testid="import-drill"] .dm-what').innerText();
    need(/1–2/.test(what), `mapping summary "${what}" does not say targets 1–2`);
    await page.locator('[data-testid="import-start"]').click();
    await waitFor(() => page.evaluate(() => { const li = [...document.querySelectorAll('[data-testid="import-queue"] > li')]; return li.length === 2 && li.every((x) => x.dataset.status === 'done'); }), { timeout: 60000, what: 'both clips analysed' });

    // back to the drill
    await page.locator('[data-testid="import-drill-back"]').click();
    await page.locator('[data-screen="drill"] [data-testid="drill-progress"]').waitFor({ state: 'visible', timeout: 15000 });
    await until(page, () => /2\/18/.test(document.querySelector('[data-screen="drill"] [data-testid="drill-progress"]')?.textContent ?? ''), null, 'drill-progress 2/18', 10000);
    const scores = await page.evaluate(() => [...document.querySelectorAll('[data-screen="drill"] [data-testid="drill-score"]')].map((x) => x.textContent));
    need(scores.length === 2, `${scores.length} drill-score, expected 2 (${scores})`);
    need(scores.every((s) => /^\d+ ± \d+/.test(s)), `drill-score texts ${scores} are not "n ± e"`);
    const est = await page.locator('[data-screen="drill"] .ds-score .vtag-est').count();
    need(est === 2, `${est} scores marked estimated, expected 2`);
    const next = await page.locator('[data-screen="drill"] [data-testid="drill-target"]').innerText();
    need(/第 3 題/.test(next), `after 2 balls drill-target "${next}" is not target 3`);
    let db = await idb(page, ctx.baseUrl);
    need(db.drills === 1, `IDB drills has ${db.drills} records, expected 1`);
    need(db.shots.map((x) => x.slot).sort().join(',') === '1,2' && db.shots.every((x) => x.target_m > 0 && x.attempt === 1), `saved shots practice ${JSON.stringify(db.shots)}`);

    // reload: the drill and its progress come back
    await page.reload();
    await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
    await page.evaluate(() => globalThis.__GSL_E2E__.app.ready());
    await page.locator('[data-screen="home"] [data-testid="home-drills"]').waitFor({ state: 'visible', timeout: 15000 });
    await openDrillFromHome(page);
    await page.locator('[data-testid="drills-resume"]').first().click();
    await page.locator('[data-screen="drill"] [data-testid="drill-progress"]').waitFor({ state: 'visible', timeout: 15000 });
    const p2 = await page.locator('[data-screen="drill"] [data-testid="drill-progress"]').innerText();
    need(/2\/18/.test(p2), `after reload drill-progress "${p2}", expected 2/18`);
    db = await idb(page, ctx.baseUrl);
    need(db.drills === 1, `after reload IDB drills has ${db.drills} records`);
    need(w.errors.length === 0, `page errors ${w.errors.slice(0, 3).join(' | ')}`);
    return `distance18: "${target1}"; slots ${slots}; progress 2/18 with scores ${scores.join(' / ')} (estimated); kept after reload (1 drill in IDB)`;
  } finally {
    await browser.close();
  }
}
