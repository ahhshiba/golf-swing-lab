// WP-B practice-flow gates (PRODUCT-SPEC §8 WP-B acceptance): onboarding, camera denied, live re-attach after a camera
// interruption (R1), setup stepper portrait + landscape with the tripod numbers (UX-02, V05), live glanceability and
// club change (V11, ux-m1), home layout (V07, V08), and the shared checks on every practice screen.
//
// Seams (docs/e2e-hooks.md, docs/setup-guide.md "e2e"): globalThis.__GSL_E2E__ set before boot shows the setup skip
// hook and exposes the ghost corners on the picker canvas (data-ghost); `onboarding: true` keeps the first-launch
// onboarding in an automated browser; `pose` replaces MediaPipe in the live screen. The pose stand-in here is
// synthetic: it ignores the picture and plays one scripted swing every 6 s of media time (hands rise 0.94 m, peak
// ≈ 3 m/s), which events/live.js accepts as a real swing from motion alone, so the gates need no fixture video.
import { launch, watchPage, need, diag, waitFor } from '../lib.mjs';
import { noHScroll, minTargets, accessibleNames, noCJK, noSpecCodes, contrastOfRendered, screenshotSet, setTextScale, setTheme, setLocale } from '../checks.mjs';

const FAKE = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];

/** getUserMedia refused the way iOS / Chromium refuse it (headless Chromium has no permission prompt to deny). */
function installCameraRefusal({ name = 'NotAllowedError', onboarding = false } = {}) {
  globalThis.__GSL_E2E__ = onboarding ? { onboarding: true } : {};
  const md = navigator.mediaDevices;
  if (md) md.getUserMedia = () => Promise.reject(new DOMException('refused by the e2e gate', name));
}

/** Scripted swing (runs in the page): wrist position (metres, x along the target line, y up) at media time t. */
function installSyntheticPose(extra = {}) {
  const P = 6;
  const ease = (u) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, u)));
  const wrist = (t) => {
    const p = ((t % P) + P) % P;
    if (p < 2.0) return [0, 0];
    if (p < 2.7) { const e = ease((p - 2.0) / 0.7); return [-0.5 * e, 0.8 * e]; }
    if (p < 2.95) { const e = ease((p - 2.7) / 0.25); return [-0.5 + 0.9 * e, 0.8 - 0.8 * e]; }
    if (p < 3.15) { const e = ease((p - 2.95) / 0.2); return [0.4, 0.5 * e]; }
    if (p < 4.6) return [0.4, 0.5];
    if (p < 5.6) { const e = ease((p - 4.6) / 1.0); return [0.4 - 0.4 * e, 0.5 - 0.5 * e]; }
    return [0, 0];
  };
  globalThis.__GSL_E2E__ = {
    ...extra,
    frames: 0,
    async pose(bitmap, t_s) {
      const self = globalThis.__GSL_E2E__;
      self.frames += 1;
      bitmap?.close?.();
      const img = new Float32Array(132).fill(Number.NaN);
      const world = new Float32Array(99).fill(Number.NaN);
      const [x, y] = wrist(t_s);
      for (const k of [15, 16]) {
        img[4 * k] = 0.5 + x / 3; img[4 * k + 1] = 0.6 - y / 3; img[4 * k + 2] = 0; img[4 * k + 3] = 1;
        world[3 * k] = x; world[3 * k + 1] = -y; world[3 * k + 2] = 0;
      }
      return { t_s, img, world, ms: 0 };
    },
  };
}

async function openApp(ctx, { args = FAKE, permissions = ['camera', 'microphone'], viewport = { width: 390, height: 844 }, locale, colorScheme = 'light', init = () => { globalThis.__GSL_E2E__ = {}; }, initArg } = {}) {
  const browser = await launch(ctx, { args });
  const context = await browser.newContext({ serviceWorkers: 'block', permissions, viewport, colorScheme, ...(locale ? { locale } : {}) });
  if (init) await context.addInitScript(init, initArg);
  const page = await context.newPage();
  const w = watchPage(page);
  await page.goto(ctx.baseUrl);
  await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
  need(!(await page.locator('#app-ready[data-error]').count()), 'boot failed');
  return { browser, context, page, w };
}

const settingsOf = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('gsl-settings-v2') || 'null'); } catch { return null; } });

async function startToSetup(page) {
  await page.locator('[data-testid="btn-start-practice"]').click();
  await page.locator('[data-screen="setup"]').waitFor({ state: 'visible', timeout: 15000 });
}

async function toLive(page) {
  await startToSetup(page);
  await page.locator('[data-testid="btn-skip-setup"]').click({ timeout: 15000 });
  await page.locator('[data-screen="live"]').waitFor({ state: 'visible', timeout: 15000 });
}

const inViewport = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e) return { ok: false, why: 'missing' };
  const r = e.getBoundingClientRect();
  return { ok: r.width > 0 && r.top >= -0.5 && r.left >= -0.5 && r.bottom <= innerHeight + 0.5 && r.right <= innerWidth + 0.5, top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), vh: innerHeight, scrollY };
}, sel);

/** Click the picker canvas at the ghost corners (e2e seam data-ghost) to complete step 3. */
async function tapGhostCorners(page) {
  const g = await page.evaluate(() => { const c = document.querySelector('.picker-canvas'); return c ? { g: JSON.parse(c.dataset.ghost || 'null'), W: c.width, H: c.height } : null; });
  need(g?.g?.length === 4, `picker canvas has no ghost corners (data-ghost): ${JSON.stringify(g)}`);
  const box = await page.locator('.picker-canvas').boundingBox();
  for (const [u, v] of g.g) await page.mouse.click(box.x + (u / g.W) * box.width, box.y + (v / g.H) * box.height);
}

// ------------------------------------------------------------------------------------------------ b-onboarding
const onboarding = {
  meta: { id: 'b-onboarding', title: 'onboarding: shown on first launch, skip reaches home, completing it sets done_v, permission rows granted/denied', timeoutMs: 150000 },
  async run(ctx) {
    const notes = [];
    // 1. skip
    let a = await openApp(ctx, { init: () => { globalThis.__GSL_E2E__ = { onboarding: true }; } });
    try {
      await a.page.locator('.onboarding').waitFor({ state: 'visible', timeout: 10000 });
      need(await a.page.locator('#tabbar').isHidden().catch(() => true), 'tab bar visible during onboarding');
      need(await a.page.locator('.onboarding h1').count() === 1, 'onboarding card has no h1');
      await a.page.locator('[data-testid="onb-skip"]').click();
      await a.page.locator('[data-testid="btn-start-practice"]').waitFor({ state: 'visible', timeout: 10000 });
      const s = await settingsOf(a.page);
      need(s?.onboarding?.done_v >= 1, `skip did not mark onboarding done: ${JSON.stringify(s?.onboarding)}`);
      await a.page.reload();
      await a.page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
      await a.page.waitForTimeout(300);
      need(!(await a.page.locator('.onboarding').count()), 'onboarding shown again after it was skipped');
      notes.push('skip → home, not shown again');
    } finally { await a.browser.close(); }
    // 2. complete with fake media (granted)
    a = await openApp(ctx, { init: () => { globalThis.__GSL_E2E__ = { onboarding: true }; } });
    try {
      const seen = [];
      for (let i = 0; i < 8; i++) {
        const step = await a.page.locator('.onboarding').getAttribute('data-step');
        seen.push(step);
        if (step === 'permissions') {
          await a.page.locator('[data-testid="onb-allow"]').click();
          await a.page.locator('.perm-row[data-perm="camera"][data-state="granted"]').waitFor({ timeout: 15000 });
          const states = await a.page.$$eval('.perm-row', (rs) => rs.map((r) => `${r.dataset.perm}=${r.dataset.state}`));
          notes.push(`granted context: ${states.join(' ')}`);
        }
        if (step === 'first') { await a.page.locator('[data-testid="onb-mode-live"]').click(); break; }
        await a.page.locator('[data-testid="onb-next"]').click();
        await a.page.waitForTimeout(150);
      }
      await a.page.locator('[data-testid="btn-start-practice"]').waitFor({ state: 'visible', timeout: 10000 });
      const s = await settingsOf(a.page);
      need(s?.onboarding?.done_v >= 1 && s.mode === 'live', `completed onboarding: settings ${JSON.stringify({ onboarding: s?.onboarding, mode: s?.mode })}`);
      need(seen.includes('you') && seen.includes('permissions') && seen.includes('first'), `steps seen: ${seen.join(',')}`);
      notes.push(`completed ${seen.join('→')}; done_v=${s.onboarding.done_v}`);
      need(a.w.errors.length === 0, `page errors: ${a.w.errors.join(' | ')}`);
    } finally { await a.browser.close(); }
    // 3. denied camera: no fake-ui auto-accept, no permission grant
    a = await openApp(ctx, { permissions: [], init: installCameraRefusal, initArg: { onboarding: true } });
    try {
      for (let i = 0; i < 6; i++) {
        const step = await a.page.locator('.onboarding').getAttribute('data-step');
        if (step === 'permissions') break;
        await a.page.locator('[data-testid="onb-next"]').click();
        await a.page.waitForTimeout(150);
      }
      await a.page.locator('[data-testid="onb-allow"]').click();
      await a.page.locator('.perm-row[data-perm="camera"]:not([data-state="unknown"])').waitFor({ timeout: 15000 });
      const cam = await a.page.locator('.perm-row[data-perm="camera"]').getAttribute('data-state');
      need(cam === 'denied', `denied context: camera row state ${cam}`);
      need(await a.page.locator('.perm-row[data-perm="camera"] .perm-fix').isVisible(), 'denied camera row has no recovery text');
      notes.push(`denied context: camera=${cam} with recovery text`);
    } finally { await a.browser.close(); }
    return notes.join('; ');
  },
};

// ------------------------------------------------------------------------------------------------ b-camera-denied
const cameraDenied = {
  meta: { id: 'b-camera-denied', title: 'camera denied → recovery state with retry + import instead; no setup controls; import-instead lands on import', timeoutMs: 90000 },
  async run(ctx) {
    const notes = [];
    const busy = await openApp(ctx, { init: installCameraRefusal, initArg: { name: 'NotReadableError' } });
    try {
      await startToSetup(busy.page);
      await busy.page.locator('[data-testid="camera-retry"]').waitFor({ state: 'visible', timeout: 15000 });
      const k = await busy.page.locator('[data-testid="camera-off"]').getAttribute('data-kind');
      need(k === 'busy', `camera in use → camera-off kind ${k}`);
      notes.push('NotReadableError → busy');
    } finally { await busy.browser.close(); }
    const a = await openApp(ctx, { permissions: [], init: installCameraRefusal, initArg: { name: 'NotAllowedError' } });
    try {
      await startToSetup(a.page);
      await a.page.locator('[data-testid="camera-retry"]').waitFor({ state: 'visible', timeout: 15000 });
      need(await a.page.locator('[data-testid="camera-import-instead"]').isVisible(), 'camera-import-instead not visible');
      need(await a.page.locator('[data-screen="setup"] [data-testid="setup-step"], [data-screen="setup"] [data-testid="setup-primary"], [data-screen="setup"] video').count() === 0, 'setup controls rendered under the camera-off state');
      const kind = await a.page.locator('[data-testid="camera-off"]').getAttribute('data-kind');
      const r = await inViewport(a.page, '[data-testid="camera-retry"]');
      // retry (still denied) keeps the state
      await a.page.locator('[data-testid="camera-retry"]').click();
      await a.page.waitForTimeout(1500);
      need(await a.page.locator('[data-testid="camera-retry"]').isVisible(), 'retry while still denied lost the recovery state');
      await a.page.locator('[data-testid="camera-import-instead"]').click();
      await a.page.locator('[data-screen="import"]').waitFor({ state: 'visible', timeout: 10000 });
      need(kind === 'denied', `NotAllowedError → camera-off kind ${kind}`);
      need(a.w.errors.length === 0, `page errors: ${a.w.errors.join(' | ')}`);
      return `${notes.join('; ')}; NotAllowedError → camera-off[data-kind=${kind}], retry in viewport=${r.ok}, retry keeps the state, import-instead → import`;
    } finally { await a.browser.close(); }
  },
};

// ------------------------------------------------------------------------------------------------ b-reopen (R1)
const reopen = {
  meta: { id: 'b-reopen', title: 'R1: camera interrupted in live → reopen re-attaches the preview + capture chain to the new stream; detections resume', timeoutMs: 120000 },
  async run(ctx) {
    const a = await openApp(ctx, { init: installSyntheticPose });
    try {
      await toLive(a.page);
      await waitFor(async () => (await diag.get(a.page, ctx.baseUrl, 'live.detections')) >= 1, { timeout: 30000, what: 'a first live detection before the interruption' });
      const before = await a.page.evaluate(() => {
        const v = document.querySelector('[data-screen="live"] video');
        const s = v.srcObject;
        globalThis.__oldStream = s;
        for (const tr of s.getVideoTracks()) { tr.stop(); tr.dispatchEvent(new Event('ended')); }
        return s.id;
      });
      await a.page.locator('[data-testid="live-reopen"]').waitFor({ state: 'visible', timeout: 10000 });
      const pill = await a.page.locator('[data-testid="live-state"]').getAttribute('data-state');
      await diag.reset(a.page, ctx.baseUrl);
      const t0 = Date.now();
      await a.page.locator('[data-testid="live-reopen"]').click();
      await waitFor(async () => (await diag.get(a.page, ctx.baseUrl, 'live.detections')) >= 1, { timeout: 20000, interval: 250, what: 'live.detections after the reopen (within 20 s)' });
      const secs = (Date.now() - t0) / 1000;
      const after = await a.page.evaluate(() => {
        const v = document.querySelector('[data-screen="live"] video');
        const s = v.srcObject;
        return { id: s?.id, same: s === globalThis.__oldStream, live: (s?.getVideoTracks() ?? []).some((tr) => tr.readyState === 'live') };
      });
      need(after.id && !after.same && after.live, `video.srcObject after reopen: ${JSON.stringify(after)} (old ${before})`);
      const gum = await diag.get(a.page, ctx.baseUrl, 'gum.calls');
      need(a.w.errors.length === 0, `page errors: ${a.w.errors.join(' | ')}`);
      return `interrupted → pill ${pill} + live-reopen; after reopen <video>.srcObject is the new live stream, live.detections ≥ 1 after ${secs.toFixed(1)} s (gum.calls ${gum ?? 'n/a'})`;
    } finally { await a.browser.close(); }
  },
};

// ------------------------------------------------------------------------------------------------ b-setup-steps
const setupSteps = {
  meta: { id: 'b-setup-steps', title: 'setup stepper 1→6 with the e2e seam, setup-primary in the viewport at 390×844 and 844×390, tripod numbers = tripodPlacement()', timeoutMs: 180000 },
  async run(ctx) {
    const notes = [];
    for (const vp of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
      const tag = `${vp.width}×${vp.height}`;
      const a = await openApp(ctx, { viewport: vp });
      try {
        // fixture venue with a measured bay: the tripod step must show its numbers
        await a.page.evaluate(async (b) => {
          const { openRepository } = await import(`${b}src/store/core.js`);
          const { idbBackend } = await import(`${b}src/store/idb.js`);
          const repo = await openRepository(idbBackend());
          await repo.venues.put({ venue_id: 'venue-fixture', name: 'Fixture bay', created_at: '2026-11-05T00:00:00Z', mat_L: 1.5, mat_W: 1.25, ball_edge_m: 0.3, ball_x_m: 0, bay_B_m: 2.7, bay_verdict: 'usable', tee_lift_m: null, slope_deg: null, f_locked: null });
          const { saveSettings } = await import(`${b}src/session/settings.js`);
          saveSettings({ lastVenueId: 'venue-fixture', units: { body: 'cm' } });
        }, ctx.baseUrl);
        await a.page.reload();
        await a.page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
        await startToSetup(a.page);
        const steps = [];
        const prim = [];
        const check = async () => {
          const n = await a.page.locator('[data-testid="setup-step"]').getAttribute('data-step');
          steps.push(n);
          const r = await inViewport(a.page, '[data-testid="setup-primary"]');
          prim.push(r.ok);
          need(r.ok, `${tag} step ${n}: setup-primary not fully inside the viewport without scrolling ${JSON.stringify(r)}`);
          return n;
        };
        await a.page.locator('[data-testid="setup-step"][data-step="1"]').waitFor({ timeout: 15000 });
        await check();
        // tripod numbers vs session/bay.js tripodPlacement for the fixture venue
        const want = await a.page.evaluate(async (b) => {
          const { tripodPlacement } = await import(`${b}src/session/bay.js`);
          const { fmtQuantity } = await import(`${b}src/i18n/units.js`);
          const p = tripodPlacement({ mat_L: 1.5, mat_W: 1.25, ball_edge_m: 0.3, bay_B_m: 2.7 }, 'face_on');
          return { p, D: fmtQuantity(p.from_edge_m, 'body', { body: 'cm' }, { digits: 0 }).text, h: fmtQuantity(p.h_m, 'body', { body: 'cm' }, { digits: 0 }).text };
        }, ctx.baseUrl);
        const txt = await a.page.locator('[data-testid="setup-tripod"]').innerText();
        need(txt.includes(want.D) && txt.includes(want.h), `${tag}: tripod step text lacks ${want.D} / ${want.h}: ${txt.slice(0, 200)}`);
        need(Math.abs(want.p.D_m - 2.45) < 1e-9 && want.p.h_m === 0.74, `tripodPlacement for B = 2.7 m: ${JSON.stringify(want.p)}`);
        await a.page.locator('[data-testid="setup-primary"]').click();
        await a.page.locator('[data-testid="setup-step"][data-step="2"]').waitFor({ timeout: 5000 });
        await check();
        const skip = a.page.locator('[data-testid="setup-skip-level"]');
        await a.page.waitForTimeout(3300); // no sensor in Chromium: the step offers "continue without the level"
        if (await skip.count()) await skip.click(); else await a.page.locator('[data-testid="setup-primary"]').click();
        await a.page.locator('[data-testid="setup-step"][data-step="3"]').waitFor({ timeout: 5000 });
        await check();
        await a.page.locator('[data-testid="setup-primary"]').click(); // open the picker
        await a.page.locator('.picker-canvas').waitFor({ state: 'visible', timeout: 5000 });
        await check();
        await tapGhostCorners(a.page);
        // keyboard fine adjust on the focused canvas moves the selected corner by 1 px
        await a.page.locator('.picker-canvas').focus();
        await a.page.keyboard.press('ArrowLeft');
        await a.page.keyboard.press('ArrowRight');
        await a.page.locator('[data-testid="setup-primary"]:not([disabled])').click();
        await a.page.locator('.light-summary').waitFor({ timeout: 10000 });
        const light = await a.page.locator('.light-summary .light').getAttribute('class');
        await check();
        await a.page.locator('[data-testid="setup-primary"]').click();
        await a.page.locator('[data-testid="setup-step"][data-step="4"]').waitFor({ timeout: 5000 });
        await check();
        await a.page.locator('[data-testid="setup-skip-ball"]').click();
        await a.page.locator('[data-testid="setup-step"][data-step="5"]').waitFor({ timeout: 5000 });
        await check();
        await a.page.locator('[data-testid="setup-primary"]').click();
        await a.page.locator('[data-testid="setup-step"][data-step="6"]').waitFor({ timeout: 6000 });
        await check();
        need(steps.filter((s, i) => i === 0 || s !== steps[i - 1]).join('') === '123456', `${tag}: steps ${steps.join(',')}`);
        need(a.w.errors.length === 0, `${tag}: page errors ${a.w.errors.join(' | ')}`);
        notes.push(`${tag}: steps ${[...new Set(steps)].join('→')}, setup-primary in view ${prim.filter(Boolean).length}/${prim.length}, light ${light.replace('light ', '')}, tripod ${want.D} / ${want.h}`);
      } finally { await a.browser.close(); }
    }
    return notes.join('; ');
  },
};

// ------------------------------------------------------------------------------------------------ b-live-glance
const liveGlance = {
  meta: { id: 'b-live-glance', title: 'live hero ≥ 56 px portrait / ≥ 15 vh landscape, state pill icon+text+contrast, no touch counter, club change reaches the next job without getUserMedia', timeoutMs: 150000 },
  async run(ctx) {
    const notes = [];
    for (const vp of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
      const tag = `${vp.width}×${vp.height}`;
      const a = await openApp(ctx, { viewport: vp, init: installSyntheticPose });
      try {
        await toLive(a.page);
        await a.page.locator('[data-testid="live-state"][data-state="ready"]').waitFor({ timeout: 30000 });
        const m = await a.page.evaluate(() => {
          const nums = [...document.querySelectorAll('[data-testid="live-hero"] .live-hero-num')];
          const pill = document.querySelector('[data-testid="live-state"]');
          const parse = (c) => c.match(/[\d.]+/g).map(Number);
          const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
          const L = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
          const cs = getComputedStyle(pill);
          const [x, y] = [L(parse(cs.color)), L(parse(cs.backgroundColor))].sort((p, q) => q - p);
          return {
            sizes: nums.map((n) => parseFloat(getComputedStyle(n).fontSize)),
            glyph: pill.querySelector('.sp-glyph')?.textContent ?? '',
            text: pill.querySelector('.sp-text')?.textContent ?? '',
            ratio: (x + 0.05) / (y + 0.05),
            touch: [...document.querySelectorAll('body *')].some((e) => !e.children.length && /碰了螢幕|touch/i.test(e.textContent)),
            vh: innerHeight,
          };
        });
        const minPx = vp.width < vp.height ? 56 : 0.15 * m.vh;
        need(m.sizes.length >= 1 && m.sizes.every((s) => s + 0.01 >= minPx), `${tag}: hero font sizes ${m.sizes.join(',')} < ${minPx}`);
        need(m.glyph.trim() && m.text.trim(), `${tag}: state pill lacks icon or text: "${m.glyph}" "${m.text}"`);
        need(m.ratio >= 4.5, `${tag}: state pill contrast ${m.ratio.toFixed(2)} < 4.5`);
        need(!m.touch, `${tag}: a touch counter is on screen`);
        let club = '';
        if (vp.width < vp.height) {
          const gum0 = await diag.get(a.page, ctx.baseUrl, 'gum.calls');
          await a.page.locator('[data-testid="live-club"]').click();
          await a.page.locator('[data-testid="live-club-sheet"] [data-club="driver"]').click();
          const next = await diag.get(a.page, ctx.baseUrl, 'live.next_club');
          need(next === 'driver', `live.next_club after the change = ${next}`);
          await waitFor(async () => (await diag.get(a.page, ctx.baseUrl, 'live.job_club')) === 'driver', { timeout: 25000, interval: 250, what: 'the next analysis job using club.type driver (diag live.job_club)' });
          const gum1 = await diag.get(a.page, ctx.baseUrl, 'gum.calls');
          need(gum0 === gum1, `getUserMedia called again on club change: ${gum0} → ${gum1}`);
          club = `; club change → next job club.type driver, gum.calls ${gum1} unchanged`;
        }
        notes.push(`${tag}: hero ${m.sizes.map((s) => s.toFixed(1)).join('/')} px (need ≥ ${minPx.toFixed(1)}), pill "${m.glyph} ${m.text}" contrast ${m.ratio.toFixed(2)}${club}`);
      } finally { await a.browser.close(); }
    }
    return notes.join('; ');
  },
};

// ------------------------------------------------------------------------------------------------ b-home
const home = {
  meta: { id: 'b-home', title: 'home: 開始練習 ≥ 56 px inside 390×844, no option text starting with （, no truncated row values at 320 px', timeoutMs: 90000 },
  async run(ctx) {
    const a = await openApp(ctx, { init: null });
    try {
      await a.page.locator('[data-testid="btn-start-practice"]').waitFor({ state: 'visible' });
      const r = await inViewport(a.page, '[data-testid="btn-start-practice"]');
      need(r.ok && r.h >= 56, `start button: ${JSON.stringify(r)}`);
      const opts = await a.page.evaluate(() => [...document.querySelectorAll('[data-screen="home"] option, [data-screen="home"] .lr-value, [data-screen="home"] .lr-title, .sheet .lr-title')].map((e) => e.textContent.trim()));
      // the sheets' option rows too
      for (const id of ['home-venue', 'home-view', 'home-club', 'home-mode']) {
        await a.page.locator(`[data-testid="${id}"]`).click();
        await a.page.locator('.sheet').waitFor({ state: 'visible' });
        opts.push(...(await a.page.$$eval('.sheet .lr-title, .sheet .lr-sub', (es) => es.map((e) => e.textContent.trim()))));
        await a.page.keyboard.press('Escape');
        await a.page.waitForTimeout(100);
      }
      const bad = opts.filter((s) => s.startsWith('（') || s.startsWith('('));
      need(bad.length === 0, `option text starting with a bracket: ${bad.join(' | ')}`);
      await a.page.setViewportSize({ width: 320, height: 700 });
      await a.page.waitForTimeout(200);
      const trunc = await a.page.evaluate(() => [...document.querySelectorAll('[data-screen="home"] .lr-value, [data-screen="home"] .lr-title, [data-screen="home"] .lr-sub, [data-screen="home"] .btn-label')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
      need(trunc.length === 0, `truncated text at 320 px: ${trunc.join(' | ')}`);
      const hs = await noHScroll(a.page);
      need(hs.ok, `horizontal scroll at 320 px ${hs.scrollWidth}`);
      return `start button ${r.h}px at y ${r.top}–${r.bottom} of ${r.vh}; ${opts.length} option/row texts, none bracketed; 0 truncated at 320 px`;
    } finally { await a.browser.close(); }
  },
};

// ------------------------------------------------------------------------------------------------ b-checks
/** Screens of the practice flow reachable in one session, each prepared by a function. */
async function visitAll(page, ctx, fn) {
  const out = [];
  const run = async (name) => { out.push(await fn(name)); };
  await run('home');
  await page.locator('[data-testid="home-venue"]').click();
  await page.locator('.sheet').waitFor({ state: 'visible' });
  await run('home-venue-sheet');
  await page.keyboard.press('Escape');
  await page.locator('[data-testid="nav-venue"]').click();
  await page.locator('[data-testid="venue-step"]').waitFor();
  await run('venue');
  await page.locator('[data-screen="venue"] button.back').click();
  await page.locator('[data-screen="home"]').waitFor({ state: 'visible' });
  await startToSetup(page);
  await page.locator('[data-testid="setup-step"]').waitFor({ timeout: 15000 });
  await run('setup-tripod');
  await page.locator('[data-testid="setup-primary"]').click();
  await page.waitForTimeout(3300);
  await run('setup-level');
  const skip = page.locator('[data-testid="setup-skip-level"]');
  if (await skip.count()) await skip.click(); else await page.locator('[data-testid="setup-primary"]').click();
  await page.locator('[data-testid="setup-primary"]').click();
  await page.locator('.picker-canvas').waitFor({ state: 'visible' });
  await tapGhostCorners(page);
  await run('setup-picker');
  await page.locator('[data-testid="setup-primary"]:not([disabled])').click();
  await page.locator('.light-summary').waitFor();
  await page.locator('[data-testid="setup-primary"]').click();
  await page.locator('[data-testid="setup-skip-ball"]').click();
  await page.locator('[data-testid="setup-primary"]').click();
  await page.locator('[data-testid="setup-step"][data-step="6"]').waitFor({ timeout: 6000 });
  await run('setup-done');
  await page.locator('[data-testid="setup-primary"]').click();
  await page.locator('[data-screen="live"]').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1500);
  await run('live');
  return out;
}

const checks = {
  meta: { id: 'b-checks', title: 'practice screens: no spec codes, targets ≥ 44 (primaries 56), accessible names, contrast, no CJK in en, no h-scroll at 200 %; screenshot set', timeoutMs: 400000 },
  async run(ctx) {
    const notes = [];
    const shots = [];
    for (const [locale, scheme] of [['zh-TW', 'light'], ['en-US', 'dark']]) {
      const a = await openApp(ctx, { locale, colorScheme: scheme, init: installSyntheticPose });
      try {
        const res = await visitAll(a.page, ctx, async (name) => {
          await a.page.waitForTimeout(150);
          const sc = await noSpecCodes(a.page);
          const mt = await minTargets(a.page, 44);
          const prim = await a.page.evaluate(() => [...document.querySelectorAll('[data-testid="setup-primary"], [data-testid="btn-start-practice"], [data-testid="venue-primary"], [data-testid="onb-next"], [data-testid="camera-retry"]')].filter((e) => e.getClientRects().length && !e.closest('[hidden]')).map((e) => e.getBoundingClientRect().height).filter((hh) => hh + 0.5 < 56));
          const an = await accessibleNames(a.page);
          const cr = await contrastOfRendered(a.page);
          const cj = locale === 'en-US' ? await noCJK(a.page) : { ok: true, hits: [] };
          await setTextScale(a.page, 2);
          await a.page.waitForTimeout(100);
          const hs = await noHScroll(a.page);
          await setTextScale(a.page, 1);
          const cjOwn = cj.hits.filter((x) => !/^session|^App /.test(x));
          // review screenshots of the in-flow screens (venue, setup steps, live): 390 px, light + dark, zh-Hant + en.
          // Taken in the first pass only, after the checks above; locale and theme are put back so the flow continues unchanged.
          if (locale === 'zh-TW' && ['venue', 'setup-tripod', 'setup-done', 'live'].includes(name)) {
            shots.push(...(await screenshotSet(a.page, `b-${name}`, { widths: [390], themes: ['light', 'dark'], textScale: [1] })));
            const b = await a.page.evaluate(() => document.baseURI.replace(/[^/]*$/, ''));
            await setLocale(a.page, b, 'zh-Hant');
            await setTheme(a.page, scheme);
            await a.page.setViewportSize({ width: 390, height: 844 });
            await a.page.waitForTimeout(100);
          }
          const fail = [];
          if (!sc.ok) fail.push(`spec codes: ${sc.hits.slice(0, 3).join(' | ')}`);
          if (!mt.ok) fail.push(`targets < 44: ${JSON.stringify(mt.offenders.slice(0, 3))}`);
          if (prim.length) fail.push(`primary < 56: ${prim.join(',')}`);
          if (!an.ok) fail.push(`no accessible name: ${JSON.stringify(an.offenders.slice(0, 2))}`);
          if (!cr.ok) fail.push(`contrast: ${JSON.stringify(cr.offenders.slice(0, 3))}`);
          if (cjOwn.length) fail.push(`CJK in en: ${cjOwn.slice(0, 3).join(' | ')}`);
          if (!hs.ok) fail.push(`h-scroll at 200 %: ${hs.scrollWidth} > ${hs.clientWidth}`);
          return { name, fail };
        });
        const bad = res.filter((r) => r.fail.length);
        need(bad.length === 0, `${locale}/${scheme}: ${bad.map((r) => `${r.name}: ${r.fail.join('; ')}`).join(' || ')}`);
        need(a.w.external.length === 0, `external requests: ${a.w.external.slice(0, 3).join(' ')}`);
        notes.push(`${locale}/${scheme}: ${res.length} screens clean`);
      } finally { await a.browser.close(); }
    }
    // screenshot set for review (home + onboarding), 3 widths × 3 themes × 2 locales × text 1/2
    const a = await openApp(ctx, { init: () => { globalThis.__GSL_E2E__ = { onboarding: true }; } });
    try {
      const files = await screenshotSet(a.page, 'b-onboarding-welcome', { widths: [320, 390, 430], themes: ['light', 'dark', 'sun'], textScale: [1, 2] });
      await a.page.locator('[data-testid="onb-skip"]').click();
      await a.page.locator('[data-testid="btn-start-practice"]').waitFor();
      files.push(...(await screenshotSet(a.page, 'b-home', { widths: [320, 390, 430], themes: ['light', 'dark', 'sun'], textScale: [1, 2] })));
      notes.push(`${files.length + shots.length} screenshots in $GSL_SHOTS_DIR (${shots.length} of venue/setup/live)`);
    } finally { await a.browser.close(); }
    return notes.join('; ');
  },
};

export const gates = [onboarding, cameraDenied, reopen, setupSteps, liveGlance, home, checks];
