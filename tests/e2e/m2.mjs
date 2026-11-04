// M2 machine gates (CAFCR R6 row M2): import a 240 fps MP4; decoded frames == sample_count, timestamps strictly
// increasing, effective_fps within 1 % of 240.
//  m2     module level: a file input injected by the test hands a real File to src/import/probe.js + decode.js running in
//         Chromium (WebCodecs + mp4box). Independent of the import screen.
//  m2-ui  screen level: the same file through the app's own file input; the app must record import.last
//         (sample_count, effective_fps) in the diagnostic record by itself.
import { diag, waitFor, watchPage, need, testidOrFail, clickIfPresent, mp4Fixture, launch, supportsH264 } from './lib.mjs';

async function pickFixture(h264) {
  const which = h264 ? 'h264' : 'vp9';
  const { truth, file } = await mp4Fixture(which);
  const note = h264 ? '' : ' [DEGRADED: this Chromium has no H.264 decoder, used the VP9-in-MP4 twin; H.264 itself is UNVERIFIED here]';
  return { which, file, note, truth };
}

// The Safari proxy (WebKit) exists to exercise H.264: there a missing H.264 decoder is a failure, not a fallback.
async function h264For(ctx, page) {
  const ok = await supportsH264(page);
  if (!ok && ctx.browser && ctx.browser !== 'chromium') throw new Error(`${ctx.browser}: VideoDecoder.isConfigSupported(avc1.64002A) is false`);
  return ok;
}

export const meta = { id: 'm2', title: 'M2 decode 240 fps clip: frame count, monotonic timestamps, fps', timeoutMs: 180000 };

export async function run(ctx) {
  const browser = await launch(ctx);
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    const w = watchPage(page);
    await page.goto(ctx.baseUrl);
    await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
    const fx = await pickFixture(await h264For(ctx, page));
    const truth = fx.truth;
    await page.evaluate(() => {
      const i = document.createElement('input');
      i.type = 'file';
      i.id = 'e2e-file';
      document.body.append(i);
    });
    await page.setInputFiles('#e2e-file', fx.file);
    const r = await page.evaluate(async (base) => {
      const file = document.getElementById('e2e-file').files[0];
      const { probeFile } = await import(`${base}src/import/probe.js`);
      const { decodeFile } = await import(`${base}src/import/decode.js`);
      const p = await probeFile(file);
      const ts = [];
      const res = await decodeFile(file, { onFrame: (_frame, t_s) => { ts.push(t_s); } });
      let mono = true;
      for (let i = 1; i < ts.length; i++) if (!(ts[i] > ts[i - 1])) { mono = false; break; }
      return { sample_count: p.sample_count, effective_fps: p.effective_fps, codec: p.codec, vfr: p.vfr, emitted: ts.length, decoded: res.decoded, path: res.path, mono };
    }, ctx.baseUrl);
    need(r.sample_count === truth.sample_count, `probe sample_count ${r.sample_count} != fixture ${truth.sample_count}`);
    need(r.emitted === r.sample_count, `frames delivered ${r.emitted} != sample_count ${r.sample_count}`);
    need(r.decoded === r.sample_count, `decoder reports decoded ${r.decoded} != sample_count ${r.sample_count}`);
    need(r.mono, 'frame timestamps are not strictly increasing');
    const err = Math.abs(r.effective_fps - truth.fps) / truth.fps;
    need(err < 0.01, `effective_fps ${r.effective_fps} off by ${(err * 100).toFixed(2)} % (limit 1 %)`);
    need(w.errors.length === 0, `uncaught page errors: ${w.errors.slice(0, 3).join(' | ')}`);
    return `${fx.which} (${r.codec}) via ${r.path}: decoded ${r.decoded}/${r.sample_count}, monotonic, effective_fps ${r.effective_fps.toFixed(2)} (err ${(err * 100).toFixed(3)} %)${fx.note}`;
  } finally {
    await browser.close();
  }
}

export const ui = {
  meta: { id: 'm2-ui', title: 'M2 UI: import screen probes the clip and records import.last', timeoutMs: 90000 },
  async run(ctx) {
    const browser = await launch(ctx);
    try {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const page = await context.newPage();
      const w = watchPage(page);
      await page.goto(ctx.baseUrl);
      await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
      const fx = await pickFixture(await h264For(ctx, page));
    const truth = fx.truth;
      await diag.reset(page, ctx.baseUrl);
      await clickIfPresent(page, 'nav-import', ['button:has-text("匯入影片")']);
      const input = await testidOrFail(page, 'import-file-input', 'the <input type=file> of the import screen', 15000, ['#import-file']);
      await input.setInputFiles(fx.file);
      const last = await waitFor(async () => {
        const l = await diag.get(page, ctx.baseUrl, 'import.last');
        return l && typeof l.sample_count === 'number' && typeof l.effective_fps === 'number' ? l : null;
      }, { timeout: 60000, interval: 300, what: 'diag import.last.{sample_count, effective_fps} after choosing the file in the UI' });
      need(last.sample_count === truth.sample_count, `UI probe sample_count ${last.sample_count} != fixture ${truth.sample_count}`);
      const err = Math.abs(last.effective_fps - truth.fps) / truth.fps;
      need(err < 0.01, `UI probe effective_fps ${last.effective_fps} off by ${(err * 100).toFixed(2)} %`);
      need(w.errors.length === 0, `uncaught page errors: ${w.errors.slice(0, 3).join(' | ')}`);
      return `${fx.which}: import.last sample_count ${last.sample_count}, effective_fps ${last.effective_fps.toFixed(2)}${fx.note}`;
    } finally {
      await browser.close();
    }
  },
};
