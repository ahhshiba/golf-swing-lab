// M6 machine gates.
//  m6     store round trip in a real IndexedDB: create 3 shots -> exportJSON -> clear -> importJSON -> the same 3 shots.
//         Uses the app's own modules (src/store) served by the dev server, in a scratch database, so it needs no UI.
//  m6-ui  the same through the screens: after importing the export file in the app, the history list shows 3 shots and
//         the export button produces a JSON download that parses (needs data-testids from docs/e2e-hooks.md).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { watchPage, need, ROOT, testidOrFail } from './lib.mjs';

const SHOT_FILES = ['valid_face_on_240.json', 'valid_dtl_30.json', 'valid_high_behind_240.json'];
const loadShots = () => SHOT_FILES.map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/shots', f), 'utf8')));

export const meta = { id: 'm6', title: 'M6 store: 3 shots -> export -> clear -> import -> 3 shots', timeoutMs: 60000 };

export async function run(ctx) {
  const shots = loadShots();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    const w = watchPage(page);
    await page.goto(ctx.baseUrl);
    await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
    const out = await page.evaluate(async ([base, input]) => {
      const S = await import(`${base}src/store/index.js`);
      const dbName = `gsl-e2e-m6-${Date.now()}`;
      const repo = await S.openRepository(S.idbBackend({ name: dbName }));
      for (const s of input) await repo.shots.put(s);
      const before = (await repo.shots.list()).length;
      const text = JSON.stringify(await S.exportJSON(repo));
      await repo.clear();
      const cleared = (await repo.shots.list()).length;
      const res = await S.importJSON(repo, text);
      const after = await repo.shots.list();
      const byId = (a) => [...a].sort((x, y) => (x.shot_id < y.shot_id ? -1 : 1));
      const same = JSON.stringify(byId(after)) === JSON.stringify(byId(input));
      await repo.close();
      indexedDB.deleteDatabase(dbName);
      return { before, cleared, after: after.length, same, ok: res.ok, exportBytes: text.length };
    }, [ctx.baseUrl, shots]);
    need(out.before === 3, `expected 3 shots stored, got ${out.before}`);
    need(out.cleared === 0, `clear left ${out.cleared} shots`);
    need(out.ok === true, 'importJSON did not report ok');
    need(out.after === 3, `expected 3 shots after import, got ${out.after}`);
    need(out.same, 'imported shots differ from the originals');
    need(w.errors.length === 0, `uncaught page errors: ${w.errors.slice(0, 3).join(' | ')}`);
    return `3 shots round-trip identical (export ${out.exportBytes} bytes)`;
  } finally {
    await browser.close();
  }
}

export const ui = {
  meta: { id: 'm6-ui', title: 'M6 UI: import file -> history shows 3 shots -> export button downloads JSON', timeoutMs: 90000 },
  async run(ctx) {
    const shots = loadShots();
    const tmp = path.join(ROOT, 'tests/fixtures/generated');
    fs.mkdirSync(tmp, { recursive: true });
    const file = path.join(tmp, 'm6_ui_import.json');
    fs.writeFileSync(file, JSON.stringify({ format: 'golf-swing-lab-export/1', exported_at: '2026-11-04T00:00:00.000Z', app_version: '0.1.0', venues: [], presets: [], sessions: [], shots }));
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true });
      const page = await context.newPage();
      const w = watchPage(page);
      await page.goto(ctx.baseUrl);
      await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
      await (await testidOrFail(page, 'nav-history', 'navigation to the history screen', 15000, ['[data-go="history"]', 'button:has-text("歷史")'])).click();
      await page.locator('[data-screen="history"]').waitFor({ state: 'visible', timeout: 10000 });
      const input = await testidOrFail(page, 'history-import-input', '<input type=file> that imports an export JSON', 15000, ['#hist-import']);
      await input.setInputFiles(file);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="shot-row"], [data-screen="history"] button.linklike').length === 3, null, { timeout: 20000 })
        .catch(() => { throw new Error('history did not show exactly 3 [data-testid="shot-row"] after the import'); });
      const btn = await testidOrFail(page, 'history-export-json', 'button exporting all shots as JSON', 15000, ['button:has-text("匯出 JSON")']);
      await btn.click();
      // the export button may only prepare a download link (a[download]); click it when it appears
      const link = page.locator('a[download]').first();
      const dlPromise = page.waitForEvent('download', { timeout: 20000 });
      if (await link.waitFor({ state: 'attached', timeout: 5000 }).then(() => true, () => false)) await link.click();
      const dl = await dlPromise;
      const p = await dl.path();
      const exported = JSON.parse(fs.readFileSync(p, 'utf8'));
      need(Array.isArray(exported.shots) && exported.shots.length === 3, `exported file has ${exported.shots && exported.shots.length} shots`);
      need(w.errors.length === 0, `uncaught page errors: ${w.errors.slice(0, 3).join(' | ')}`);
      return 'history shows 3 shots, export downloads 3 shots';
    } finally {
      await browser.close();
    }
  },
};
