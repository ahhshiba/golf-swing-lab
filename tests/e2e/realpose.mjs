// real-pose gate: REAL MediaPipe (no stand-in) inside the app's own vision worker, and nothing leaves the origin
// (PRODUCT-SPEC §6.2: this gate keeps failing on any request that leaves the local server; §7.3: GolfDB never gates a
// ship).
//
// Default (gating): the clip_240 fixture (VP9-in-MP4 twin; H.264 where the browser decodes it) is analysed again and
// again for at least TELEMETRY_S seconds through workers/client.js -> vision.worker.js with the full and the lite pose
// models (tasks-vision posts usage telemetry every 60 s, so the run outlasts one period). Pass: every analysis returns
// a golf-shot/1 or, since the synthetic clip has no golfer, NO_SWING_FOUND after a full pose pass (diag
// worker.last_job.pose_frames > 0 with the requested model); diag pose.delegate is set, events.tcn says no model
// was loaded (the product ships none), zero requests leave 127.0.0.1, no uncaught page error. pose.blocked_requests
// (the guard's count of refused telemetry posts) is reported.
// RESEARCH=1 (dev only, never gating, §7.3): the 6 GolfDB clips (3 face-on, 3 down-the-line), upscaled to 720x720 by
// scripts/make_golfdb_fixture.py into the git-ignored tests/fixtures/generated/golfdb/ (GolfDB is CC BY-NC: local
// only, never published), are analysed with the rules and Impact / Top errors and tempo are PRINTED; only the
// no-external-request and no-page-error checks can fail that run.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { ROOT, FIXTURES, Skip, need, watchPage, launch, supportsH264, diag } from './lib.mjs';

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

const tempoOk = (m) => m && Number.isFinite(m.value) && Array.isArray(m.ci95) && m.ci95.length === 2 && m.ci95.every(Number.isFinite);
const fmtM = (m) => (m && Number.isFinite(m.value) ? `${m.value.toFixed(3)} [${m.ci95 ? m.ci95.map((x) => x.toFixed(3)).join(',') : '-'}]` : `null(${m ? m.reason_codes.join('/') : '?'})`);

/** Analyse `file` with the app's worker client (a fresh client per page; real MediaPipe). */
async function analyseInPage(page, ctx, selector, options) {
  return page.evaluate(async ([b, sel, opts]) => {
    const f = document.querySelector(sel)?.files?.[0];
    const m = await import(`${b}src/workers/client.js`);
    globalThis.__rpClient = globalThis.__rpClient ?? m.createVisionClient({ delegate: 'GPU', models: [opts.pose_model] });
    const vc = globalThis.__rpClient;
    await vc.init();
    const t = performance.now();
    try {
      const r = await vc.analyzeClip(f, { handedness: 'right', calibration: null, mode: 'highspeed', source: 'import', allowNoSwing: true, warnings: [],
        ids: { shot_id: `shot-rp-${Math.round(t)}`, session_id: 'sess-rp', venue_id: null, preset_id: null, created_at: new Date().toISOString(), app_version: 'e2e' },
        club: { type: '7i', length_m: 0.94, lie: 'mat', tee_lift_m: null, tee_lift_source: 'assumed' }, ...opts });
      return { ok: true, ms: performance.now() - t, shot: r.shot };
    } catch (e) {
      return { ok: false, ms: performance.now() - t, code: e.code, detail: e.detail };
    }
  }, [ctx.baseUrl, selector, options]);
}

async function fileInput(page, file, id) {
  await page.evaluate((i) => { if (!document.getElementById(i)) { const el = document.createElement('input'); el.type = 'file'; el.id = i; el.hidden = true; document.body.append(el); } }, id);
  await page.setInputFiles(`#${id}`, file);
}

export const TELEMETRY_S = 65;

export const meta = { id: 'real-pose', title: 'real MediaPipe in the app worker for > 60 s: results, no event model, no request leaves the origin (RESEARCH=1: GolfDB report)', timeoutMs: 1500000 };

export async function run(ctx) {
  const research = process.env.RESEARCH === '1';
  const clips = research ? ensureFixture() : null;
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
    await diag.reset(page, ctx.baseUrl);
    let summary;
    if (!research) {
      const truthFile = path.join(FIXTURES, 'clip_240.json');
      if (!fs.existsSync(truthFile)) throw new Skip('clip_240 fixture not generated (node scripts/make_fixtures.mjs)');
      const t = JSON.parse(fs.readFileSync(truthFile, 'utf8'));
      const file = path.join(FIXTURES, h264 ? t.files.h264 : t.files.vp9);
      if (!fs.existsSync(file)) throw new Skip(`${file} not generated`);
      await fileInput(page, file, 'rp-file');
      const runs = [];
      const t0 = Date.now();
      for (let i = 0; (Date.now() - t0) / 1000 < TELEMETRY_S || i < 2; i++) {
        const model = i % 2 === 0 ? 'full' : 'lite';
        const r = await analyseInPage(page, ctx, '#rp-file', { view: 'face_on', pose_model: model });
        // the synthetic clip has no golfer: the honest outcome is NO_SWING_FOUND after a full pose pass (pipeline/clip.js
        // never turns a clip without a swing into a shot); anything else (crash, timeout, model load) fails
        need((r.ok && r.shot?.schema === 'golf-shot/1') || r.code === 'NO_SWING_FOUND', `analysis ${i} (${model}) failed: ${JSON.stringify(r).slice(0, 300)}`);
        const job = await diag.get(page, ctx.baseUrl, 'worker.last_job');
        need(job && job.pose_frames > 0 && job.model === model, `analysis ${i}: the worker ran no ${model} pose frames: ${JSON.stringify(job)}`);
        runs.push({ model, ms: Math.round(r.ms), frames: job.pose_frames, outcome: r.ok ? 'shot' : r.code });
        if (runs.length > 60) break;
      }
      const d = await diag.get(page, ctx.baseUrl, undefined);
      need(typeof d?.pose?.delegate === 'string', `diag pose.delegate missing: ${JSON.stringify(d?.pose)}`);
      need(d?.events?.tcn?.loaded === false, `an event model was loaded in the product build: ${JSON.stringify(d?.events?.tcn)}`);
      const secs = (Date.now() - t0) / 1000;
      summary = `${browserName} (${h264 ? 'H.264 mp4' : 'VP9-in-MP4 twin'}): ${runs.length} real-MediaPipe analyses in ${secs.toFixed(0)} s, ${runs[0].frames} pose frames each, outcome ${[...new Set(runs.map((r) => r.outcome))].join('/')} (full ${runs.filter((r) => r.model === 'full').map((r) => r.ms).join('/')} ms, lite ${runs.filter((r) => r.model === 'lite').map((r) => r.ms).join('/')} ms), delegate ${d.pose.delegate}${d.pose.gpu_software ? ` (software GL ${d.pose.gpu_software.slice(0, 40)} -> CPU)` : ''}, events.tcn ${JSON.stringify(d.events.tcn)}, telemetry posts refused by the guard: ${d.pose.blocked_requests ?? 0}`;
    } else {
      const rows = [];
      for (const truth of clips) {
        const file = path.join(GOLFDB_DIR, h264 ? truth.files.h264 : truth.files.vp9_mp4);
        await fileInput(page, file, 'rp-file');
        const r = await analyseInPage(page, ctx, '#rp-file', { view: truth.app_view, pose_model: 'full' });
        if (!r.ok) { rows.push({ id: truth.id, view: truth.app_view, fail: `${r.code} ${r.detail ?? ''}` }); continue; }
        const ev = r.shot.events;
        rows.push({
          id: truth.id, view: truth.app_view, secs: r.ms / 1000, dImp: ev.impact.frame - truth.events.impact.frame, dTop: ev.top.frame - truth.events.top.frame,
          algo: r.shot.algorithms.events.version, B: r.shot.metrics.backswing_s, D: r.shot.metrics.downswing_s, R: r.shot.metrics.tempo_ratio,
          truthTempo: (truth.events.top.t_s - truth.events.address.t_s) / (truth.events.impact.t_s - truth.events.top.t_s),
        });
      }
      const lines = rows.map((x) => (x.fail ? `id ${x.id} ${x.view}: ${x.fail}` : `id ${x.id} ${x.view.padEnd(7)} impact ${x.dImp >= 0 ? '+' : ''}${x.dImp} f, top ${x.dTop >= 0 ? '+' : ''}${x.dTop} f, backswing ${fmtM(x.B)} s, downswing ${fmtM(x.D)} s, tempo ${fmtM(x.R)} (truth ${x.truthTempo.toFixed(2)}), events ${x.algo}, ${x.secs.toFixed(1)} s`));
      const ok = rows.filter((x) => !x.fail);
      summary = `RESEARCH report (GolfDB, dev only, not a ship gate, §7.3): Impact within +-${LIMITS.impact_frames} f ${ok.filter((x) => Math.abs(x.dImp) <= LIMITS.impact_frames).length}/${rows.length}, Top within +-${LIMITS.top_frames} f ${ok.filter((x) => Math.abs(x.dTop) <= LIMITS.top_frames).length}/${rows.length}, tempo non-null ${ok.filter((x) => tempoOk(x.B) && tempoOk(x.D) && tempoOk(x.R)).length}/${rows.length}\n${lines.join('\n')}`;
    }
    need(w.errors.length === 0, `uncaught page errors: ${w.errors.slice(0, 3).join(' | ')}\n${summary}`);
    need(w.external.length === 0, `requests leaving the local server: ${w.external.slice(0, 3).join(' ')}\n${summary}`);
    return summary;
  } finally {
    await browser.close();
  }
}
