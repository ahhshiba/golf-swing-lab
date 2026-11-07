// Gate v4-e-card (V04-SPEC §G.3 V4-E 5): picture cards from the share sheet in Chromium (zh-Hant), offline.
//  * session card (kind 'session', the v2 fixture shots): a PNG of exactly 1080 × 1350 (decoded size of the blob)
//  * round card (kind 'round', tests/fixtures/rounds/valid_9_links_2p.json): the image's text alternative contains the
//    "simulated" word of the share catalog (模擬); a shot card is 1080 × 1350 too and the sheet's video part is
//    disabled with a reason when the shot has no clip
//  * share-card-send: Web Share stubbed → 1 PNG File; without Web Share → share-card-download link
//  * no page error, no request leaves the origin
import fs from 'node:fs';
import path from 'node:path';
import { launch, watchPage, need, waitFor, ROOT } from '../lib.mjs';

export const meta = { id: 'v4-e-card', title: 'V4-E: session card PNG 1080×1350, round card says simulated, shot card, card share / download', timeoutMs: 180000 };

const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const SHOTS = ['valid_face_on_240', 'valid_high_behind_240', 'valid_dtl_30'].map((n) => read(`tests/fixtures/shots/v2/${n}.json`));
const ROUND = read('tests/fixtures/rounds/valid_9_links_2p.json');
const SIMULATED = read('app/i18n/zh-Hant/share.json')['card.simulated'];

async function cardOf(page, opts) {
  await page.evaluate(async (o) => {
    const m = await import(new URL('src/ui/share.js', location.href).href);
    globalThis.__v4eClosed = m.openShareSheet(globalThis.__GSL_E2E__.app, o);
  }, opts);
  await page.locator('[data-testid="share-sheet"]').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('[data-testid="share-make-card"]').click();
  await waitFor(() => page.evaluate(() => !document.querySelector('[data-testid="share-card-preview"]')?.closest('.share-result')?.hidden), { timeout: 15000, interval: 100, what: `${opts.kind} card` });
  return page.evaluate(async () => {
    const img = document.querySelector('[data-testid="share-card-preview"]');
    await img.decode().catch(() => {});
    const blob = await (await fetch(img.src)).blob();
    const bmp = await createImageBitmap(blob);
    return { w: bmp.width, h: bmp.height, type: blob.type, alt: img.alt, kind: img.dataset.kind };
  });
}

async function closeSheet(page) {
  await page.keyboard.press('Escape');
  await page.evaluate(() => globalThis.__v4eClosed);
}

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
    await page.evaluate(async () => {
      for (const p of ['src/ui/share.js', 'src/share/card.js', 'src/share/compose.js', 'src/sim/round.js']) await import(new URL(p, location.href).href);
      await globalThis.__GSL_E2E__.app.loadStyles('share');
    });
    await context.setOffline(true);

    const s = await cardOf(page, { kind: 'session', shots: SHOTS, filter: {} });
    need(s.w === 1080 && s.h === 1350 && s.type === 'image/png' && s.kind === 'session', `session card ${JSON.stringify(s)}`);
    // share / download of the card
    await page.evaluate(() => {
      globalThis.__v4eShared = [];
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
      Object.defineProperty(navigator, 'share', { configurable: true, value: async (d) => { globalThis.__v4eShared.push({ n: d.files.length, name: d.files[0].name, type: d.files[0].type }); } });
    });
    await page.locator('[data-testid="share-card-send"]').click();
    await waitFor(() => page.evaluate(() => globalThis.__v4eShared.length === 1), { timeout: 5000, interval: 100, what: 'card shared' });
    const sh = await page.evaluate(() => globalThis.__v4eShared[0]);
    need(sh.n === 1 && sh.type === 'image/png' && /^golf-swing-lab-card-\d{4}-\d{2}-\d{2}-\d{4}\.png$/.test(sh.name), `card share ${JSON.stringify(sh)}`);
    await page.evaluate(() => { Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }); });
    await page.locator('[data-testid="share-card-send"]').click();
    await page.locator('[data-testid="share-card-download"]').waitFor({ state: 'attached', timeout: 5000 });
    await closeSheet(page);
    notes.push(`session card: PNG ${s.w}×${s.h}; share = 1 PNG File, download link without Web Share`);

    const r = await cardOf(page, { kind: 'round', round: ROUND, playerId: ROUND.players[0].player_id });
    need(r.w === 1080 && r.h === 1350, `round card ${r.w}×${r.h}`);
    need(r.alt.includes(SIMULATED), `round card text has no "${SIMULATED}": ${r.alt.slice(0, 200)}`);
    await closeSheet(page);
    notes.push(`round card: ${r.w}×${r.h}, says "${SIMULATED}"`);

    const shot = SHOTS[0];
    const c = await cardOf(page, { kind: 'shot', shot, clipBlob: null });
    need(c.w === 1080 && c.h === 1350 && /±/.test(c.alt), `shot card ${JSON.stringify({ ...c, alt: c.alt.slice(0, 120) })}`);
    const make = await page.locator('[data-testid="share-make"]').evaluate((b) => ({ disabled: b.disabled || b.getAttribute('aria-disabled') === 'true', text: b.textContent }));
    need(make.disabled, `video button enabled for a shot with no clip: ${JSON.stringify(make)}`);
    await closeSheet(page);
    notes.push('shot card 1080×1350 with ±; video button disabled with its reason when the shot has no clip');

    need(w.errors.length === 0, `page errors: ${w.errors.slice(0, 3).join(' | ')}`);
    need(w.external.length === 0, `requests left the origin: ${w.external.slice(0, 3).join(', ')}`);
    await context.close();
  } finally {
    await browser.close();
  }
  return notes.join('\n');
}
