// real-pose gate: REAL MediaPipe (full model, no stand-in) on real golf swings, end to end through the import UI.
//
// Fixture: 6 GolfDB clips (3 face-on, 3 down-the-line; split 1 = held out from event-tcn-v1, real-time only), upscaled
// to 720x720 by scripts/make_golfdb_fixture.py into the git-ignored tests/fixtures/generated/golfdb/ (GolfDB is
// CC BY-NC: local only, never published). Each clip goes through 匯入影片 -> 角度 = the clip's view -> 校正 =
// 不使用校正 (placeholder calibration) -> 開始分析; the saved golf-shot/1 is read back from IndexedDB.
// Pass: on every clip backswing_s, downswing_s and tempo_ratio are non-null with a finite ci95; detected Impact within
// +-2 frames (clip fps, ~29.97) of the GolfDB truth on >= 5/6 clips, Top within +-3 frames on >= 4/6; and the
// trained TCN was the event detector on every clip (shot.algorithms.events = 'tcn+evfeat-1', events.*.source = 'tcn').
// Skipped with the reason only when GolfDB data (training/data) is absent. Chromium decodes the VP9-in-MP4 twin
// (no H.264 in Playwright's Chromium); WebKit, when it launches, must decode the H.264 MP4.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { ROOT, FIXTURES, Skip, need, watchPage, testidOrFail, launch, supportsH264, diag } from './lib.mjs';

const GOLFDB_DIR = path.join(FIXTURES, 'golfdb');
const DATA = path.join(ROOT, 'training', 'data');
export const LIMITS = Object.freeze({ impact_frames: 2, impact_min: 5, top_frames: 3, top_min: 4, n: 6 });

function ensureFixture() {
  const pkl = path.join(DATA, 'annotations', 'golfDB.pkl');
  const vids = path.join(DATA, 'videos_160');
  if (!fs.existsSync(pkl) || !fs.existsSync(vids)) throw new Skip(`GolfDB data absent (${path.relative(ROOT, pkl)} / ${path.relative(ROOT, vids)}): real pose on real swings is NOT verified here`);
  const idx = path.join(GOLFDB_DIR, 'index.json');
  const complete = () => {
    if (!fs.existsSync(idx)) return false;
    const j = JSON.parse(fs.readFileSync(idx, 'utf8'));
    return j.clips.length === LIMITS.n && j.clips.every((c) => {
      const tf = path.join(GOLFDB_DIR, c.truth);
      if (!fs.existsSync(tf)) return false;
      const t = JSON.parse(fs.readFileSync(tf, 'utf8'));
      return Object.values(t.files).every((f) => fs.existsSync(path.join(GOLFDB_DIR, f)));
    });
  };
  if (!complete()) {
    const py = process.env.GSL_PY || path.join(os.homedir(), '.local/share/golf-swing-lab-venv/bin/python');
    console.log('building the GolfDB fixture (about 2 minutes) ...');
    const r = spawnSync(py, ['-I', path.join(ROOT, 'scripts', 'make_golfdb_fixture.py')], { stdio: 'inherit', cwd: ROOT });
    if (r.status === 2) throw new Skip('GolfDB data absent (make_golfdb_fixture.py exit 2)');
    need(r.status === 0 && complete(), `scripts/make_golfdb_fixture.py failed (exit ${r.status})`);
  }
  const j = JSON.parse(fs.readFileSync(idx, 'utf8'));
  return j.clips.map((c) => JSON.parse(fs.readFileSync(path.join(GOLFDB_DIR, c.truth), 'utf8')));
}

async function readShots(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const rq = indexedDB.open('golf-swing-lab');
    rq.onerror = () => reject(rq.error);
    rq.onsuccess = () => {
      const db = rq.result;
      const g = db.transaction('shots', 'readonly').objectStore('shots').getAll();
      g.onsuccess = () => { resolve(g.result); db.close(); };
      g.onerror = () => reject(g.error);
    };
  }));
}

const tempoOk = (m) => m && Number.isFinite(m.value) && Array.isArray(m.ci95) && m.ci95.length === 2 && m.ci95.every(Number.isFinite);
const fmtM = (m) => (m && Number.isFinite(m.value) ? `${m.value.toFixed(3)} [${m.ci95 ? m.ci95.map((x) => x.toFixed(3)).join(',') : '-'}]` : `null(${m ? m.reason_codes.join('/') : '?'})`);

async function analyseOne(page, ctx, truth, file) {
  await page.goto(ctx.baseUrl);
  await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
  const before = new Set((await readShots(page)).map((s) => s.shot_id));
  await (await testidOrFail(page, 'nav-import', 'import nav')).click();
  await page.locator('[data-screen="import"]').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('#import-view') && document.querySelector('#import-calib'), null, { timeout: 15000 });
  await page.selectOption('#import-view', truth.app_view);
  await page.selectOption('#import-calib', '');
  await (await testidOrFail(page, 'import-file-input', 'import file input')).setInputFiles(file);
  await page.waitForFunction(() => { const b = document.querySelector('[data-testid="import-start"]'); return b && !b.disabled; }, null, { timeout: 30000 });
  const t0 = Date.now();
  await page.locator('[data-testid="import-start"]').click();
  let failure = '';
  await page.waitForFunction(() => {
    const s = document.querySelector('[data-screen="shot"]');
    if (s && !s.hidden && s.querySelector('.metric-list')) return true;
    const t = document.getElementById('toast');
    return t && !t.hidden && /分析失敗/.test(t.textContent);
  }, null, { timeout: 240000, polling: 500 }).catch(() => { failure = 'timeout after 240 s'; });
  const toast = (await page.locator('#toast').isVisible()) ? await page.locator('#toast').textContent() : '';
  need(!/分析失敗/.test(toast), `clip ${truth.id}: analysis failed in the app: ${toast}`);
  need(!failure, `clip ${truth.id}: results card did not appear (${failure})`);
  const secs = (Date.now() - t0) / 1000;
  const shot = (await readShots(page)).find((s) => !before.has(s.shot_id));
  need(shot, `clip ${truth.id}: no new shot in IndexedDB after the results card appeared`);
  const d = await diag.get(page, ctx.baseUrl, undefined);
  return { shot, secs, events_source: d?.import?.last?.events_source ?? null, tcn: d?.events?.tcn ?? null, pose: d?.pose ?? null };
}

export const meta = { id: 'real-pose', title: 'GolfDB swings through the import UI: real MediaPipe full + event TCN, tempo and Impact/Top vs truth', timeoutMs: 1500000 };

export async function run(ctx) {
  const clips = ensureFixture();
  const browser = await launch(ctx);
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    const w = watchPage(page);
    await page.goto(ctx.baseUrl);
    await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
    const h264 = await supportsH264(page);
    const browserName = ctx.browser || 'chromium';
    if (browserName !== 'chromium') need(h264, `${browserName}: no H.264 decoder (VideoDecoder.isConfigSupported(avc1.64002A) false)`);
    const rows = [];
    for (const truth of clips) {
      const file = path.join(GOLFDB_DIR, h264 ? truth.files.h264 : truth.files.vp9_mp4);
      const r = await analyseOne(page, ctx, truth, file);
      const ev = r.shot.events;
      const fps = truth.fps;
      const dImp = ev.impact.frame - truth.events.impact.frame;
      const dTop = ev.top.frame - truth.events.top.frame;
      // the shot's frame index and its t_s must agree (frame = index into the clip's container CTS)
      need(Math.abs(ev.impact.t_s * fps - ev.impact.frame) <= 1.01, `clip ${truth.id}: impact frame ${ev.impact.frame} disagrees with t_s ${ev.impact.t_s}`);
      rows.push({
        id: truth.id, view: truth.app_view, dImp, dTop, secs: r.secs, algo: r.shot.algorithms.events.version,
        sources: [...new Set(Object.values(ev).map((e) => e.source))].join('/'), events_source: r.events_source,
        tcn: r.tcn, B: r.shot.metrics.backswing_s, D: r.shot.metrics.downswing_s, R: r.shot.metrics.tempo_ratio,
        truthTempo: (truth.events.top.t_s - truth.events.address.t_s) / (truth.events.impact.t_s - truth.events.top.t_s),
        pose: r.pose,
      });
    }
    const lines = rows.map((x) => `id ${x.id} ${x.view.padEnd(7)} impact ${x.dImp >= 0 ? '+' : ''}${x.dImp} f, top ${x.dTop >= 0 ? '+' : ''}${x.dTop} f, backswing ${fmtM(x.B)} s, downswing ${fmtM(x.D)} s, tempo ${fmtM(x.R)} (truth ${x.truthTempo.toFixed(2)}), events ${x.algo} [${x.events_source}], ${x.secs.toFixed(1)} s`);
    const impOk = rows.filter((x) => Math.abs(x.dImp) <= LIMITS.impact_frames).length;
    const topOk = rows.filter((x) => Math.abs(x.dTop) <= LIMITS.top_frames).length;
    const nullTempo = rows.filter((x) => !(tempoOk(x.B) && tempoOk(x.D) && tempoOk(x.R)));
    const notTcn = rows.filter((x) => !/^tcn\+/.test(x.algo) || x.sources !== 'tcn');
    const summary = `${browserName} (${h264 ? 'H.264 mp4' : 'VP9-in-MP4 twin: no H.264 decoder in this Chromium'}), pose model full (${rows[0]?.pose?.delegate ?? '?'} delegate, full_ms_p50 ${rows[0]?.pose?.full_ms_p50 ?? '?'}), event TCN ${JSON.stringify(rows[0]?.tcn)}\n` +
      `Impact within +-${LIMITS.impact_frames} frames: ${impOk}/${rows.length} (need >= ${LIMITS.impact_min}); Top within +-${LIMITS.top_frames}: ${topOk}/${rows.length} (need >= ${LIMITS.top_min}); tempo rows non-null with ci95: ${rows.length - nullTempo.length}/${rows.length}\n${lines.join('\n')}`;
    need(rows.length === LIMITS.n, `expected ${LIMITS.n} clips, analysed ${rows.length}\n${summary}`);
    need(notTcn.length === 0, `the event TCN was not used on clip(s) ${notTcn.map((x) => `${x.id} (${x.algo}, ${x.events_source})`).join(', ')}\n${summary}`);
    need(nullTempo.length === 0, `backswing_s / downswing_s / tempo_ratio null or without ci95 on clip(s) ${nullTempo.map((x) => x.id).join(', ')}\n${summary}`);
    need(impOk >= LIMITS.impact_min, `Impact within +-${LIMITS.impact_frames} frames on only ${impOk}/${rows.length}\n${summary}`);
    need(topOk >= LIMITS.top_min, `Top within +-${LIMITS.top_frames} frames on only ${topOk}/${rows.length}\n${summary}`);
    need(w.errors.length === 0, `uncaught page errors: ${w.errors.slice(0, 3).join(' | ')}\n${summary}`);
    need(w.external.length === 0, `requests leaving the local server: ${w.external.slice(0, 3).join(' ')}`);
    return summary;
  } finally {
    await browser.close();
  }
}
