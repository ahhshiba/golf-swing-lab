// Gates v4-d-round / v4-d-honesty / v4-d-perf / v4-d-motion (V04-SPEC §G.3 V4-D acceptance 1–4), Chromium 390 × 844,
// zh-Hant; no request may leave the origin (service workers are blocked here, so lazy modules still come from the server).
//  v4-d-round    new round from the UI (links, 9 holes, course number 42, 2 players) → skip the fly-over → hole 1: both
//                players type in strokes (round-manual) to the green → simulated putting → the scorecard's hole 1 and
//                total equal the scores derived from the stored strokes; a reload part-way returns to the same hole,
//                stroke, player and ball (IDB `rounds` holds 1 record)
//  v4-d-honesty  a stored stroke whose carry came from the player's gapping (live dtl, tests/fixtures/rounds/v4c) →
//                the map canvas params { ellipse: true, source: 'gapping' }; the stroke card's chips carry the validity
//                word and 'sampled'; Swing → live { sink: 'sim' } shows the round banner, and a face-on quick read handed
//                back through app.sim.submit becomes the stroke (source quick, PROVISIONAL, never 'valid'); the
//                scorecard footer has key score.disclaimer
//  v4-d-perf     CPU × 4: fly-over draw time per frame median ≤ 12 ms, P95 ≤ 25 ms (app.e2e state round:perf); hole
//                change to the next fly-over's first frame ≤ 1,000 ms and skip → playable map ≤ 1,000 ms; in the browser
//                sha256(courseCanonical(generateCourse(links, 42, 18, middle))) = the node golden (cross-engine)
//  v4-d-motion   reducedMotion 'reduce': the fly-over draws exactly one frame (static overview) and a landing is drawn
//                in one frame (no animation; data-landing-frames counts real draws: > 1 without reduced motion)
//  v4-d-import   (integration) round-import → the import screen with the round banner → an analysed slow-motion clip
//                (c-results analysis stand-in: valid_face_on_240) becomes the stroke (source 'shot', its shot_id, its
//                carry, never 'valid') and the app is back on the round with the new stroke on the map
//  v4-d-share    (integration) scorecard › Share (score-share) → the share sheet's round card: a 1080 × 1350 PNG whose
//                text alternative says "simulated"; no page error
import fs from 'node:fs';
import path from 'node:path';
import { launch, watchPage, need, waitFor, ROOT, mp4Fixture } from '../lib.mjs';
import { noHScroll, minTargets, setTextScale } from '../checks.mjs';

const VW = { width: 390, height: 844 };

async function open(ctx, browser, extra = {}, init = null) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: VW, ...extra });
  await context.addInitScript(() => { globalThis.__GSL_E2E__ = globalThis.__GSL_E2E__ ?? {}; });
  if (init) await context.addInitScript(init.fn, init.arg);
  const page = await context.newPage();
  const w = watchPage(page);
  await page.goto(ctx.baseUrl);
  await boot(page);
  return { context, page, w };
}

async function boot(page) {
  await page.locator('#app-ready').waitFor({ state: 'attached', timeout: 30000 });
  await page.evaluate(() => globalThis.__GSL_E2E__.app.ready());
  // metres, so typed numbers are SI
  await page.evaluate(() => { const app = globalThis.__GSL_E2E__.app; app.updateSettings({ ...app.settings(), units: { ...app.settings().units, distance: 'm' } }); });
}

const nav = (page, id, params = {}) => page.evaluate(([s, p]) => globalThis.__GSL_E2E__.app.nav.go(s, p), [id, params]);
const R = '[data-screen="round"]';
const mode = (page) => page.evaluate((sel) => document.querySelector(sel)?.dataset.mode ?? null, R);
const ds = (page) => page.evaluate((sel) => ({ ...document.querySelector(sel).dataset }), R);
async function untilMode(page, want, timeout = 15000) {
  const list = Array.isArray(want) ? want : [want];
  await waitFor(async () => list.includes(await mode(page)), { timeout, interval: 100, what: `round mode ${list.join('|')}` });
  return mode(page);
}
const click = (page, tid) => page.locator(`[data-testid="${tid}"]:visible`).first().click();
const roundsInIdb = (page) => page.evaluate(async () => (await globalThis.__GSL_E2E__.app.repo.rounds.list()));

async function manualStroke(page) {
  const d = await ds(page);
  const aim = Number(d.aimM);
  const toPin = Number(d.toPinM);
  const carry = Math.max(1, Math.abs(aim - toPin) < 0.5 ? toPin - 2 : aim);
  await click(page, 'round-manual');
  const sheet = page.locator('[data-testid="round-manual-sheet"]');
  await sheet.waitFor({ state: 'visible', timeout: 5000 });
  await sheet.locator('[data-testid="round-manual-carry"]').fill(String(Math.round(carry * 10) / 10));
  await sheet.locator('[data-testid="round-manual-side"]').fill('0');
  await sheet.locator('[data-testid="round-manual-save"]').click();
  await waitFor(async () => (await ds(page)).strokeN !== d.strokeN || (await ds(page)).player !== d.player || (await mode(page)) !== 'play', { timeout: 8000, interval: 100, what: 'stroke applied' });
}

// ------------------------------------------------------------------ v4-d-round
async function runRound(ctx) {
  const browser = await launch(ctx);
  const notes = [];
  try {
    const { context, page, w } = await open(ctx, browser);
    await nav(page, 'course');
    await page.locator('[data-screen="course"] [data-testid="course-new"]').click();
    const sh = page.locator('[data-testid="course-new-sheet"]');
    await sh.waitFor({ state: 'visible' });
    await sh.locator('[data-testid="course-style"] [data-value="links"]').click();
    await sh.locator('[data-testid="course-holes"] [data-value="9"]').click();
    await sh.locator('[data-testid="course-seed"]').fill('42');
    await sh.locator('[data-testid="course-player-name-0"]').fill('Ann');
    await sh.locator('[data-testid="course-player-add"]').click();
    await sh.locator('[data-testid="course-player-name-1"]').fill('Bob');
    await sh.locator('[data-testid="course-start"]').click();
    await page.locator(R).waitFor({ state: 'visible', timeout: 20000 });
    need(await untilMode(page, 'intro') === 'intro', 'a new round starts with the fly-over');
    const tt = await minTargets(page, 44);
    need(tt.ok, `fly-over targets < 44 px: ${JSON.stringify(tt.offenders.slice(0, 3))}`);
    await click(page, 'round-flyover-skip');
    await untilMode(page, 'handoff');
    const first = await page.locator('[data-testid="round-handoff"]').getAttribute('data-player');
    need(first === 'p1', `hole 1 starts with player 1, got ${first}`);
    await click(page, 'round-handoff-go');
    await untilMode(page, 'play');
    const aimTargets = await page.evaluate(() => ['round-aim-left', 'round-aim-right'].map((id) => { const r = document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect(); return [r.width, r.height]; }));
    need(aimTargets.every(([wd, ht]) => wd >= 44 && ht >= 44), `aim buttons < 44 px: ${JSON.stringify(aimTargets)}`);
    const rounds0 = await roundsInIdb(page);
    need(rounds0.length === 1 && rounds0[0].course.seed === 42 && rounds0[0].course.style === 'links' && rounds0[0].course.holes_n === 9 && rounds0[0].players.length === 2,
      `new round in IDB: ${JSON.stringify(rounds0.map((r) => [r.course.style, r.course.seed, r.course.holes_n, r.players.length]))}`);

    let reloaded = false;
    for (let k = 0; k < 30; k++) {
      const m = await mode(page);
      if (m === 'holedone') break;
      if (m === 'handoff') { await click(page, 'round-handoff-go'); await untilMode(page, ['play', 'holedone']); continue; }
      need(m === 'play', `unexpected round mode ${m}`);
      await manualStroke(page);
      if (!reloaded) {
        reloaded = true;
        await untilMode(page, ['play', 'handoff']);
        const before = await ds(page);
        await page.reload();
        await boot(page);
        await nav(page, 'round');
        await page.locator(R).waitFor({ state: 'visible', timeout: 20000 });
        await untilMode(page, ['play', 'handoff']);
        const after = await ds(page);
        for (const key of ['roundId', 'hole', 'player', 'strokeN', 'ballX', 'ballY', 'lie']) need(before[key] === after[key], `reload: ${key} ${before[key]} → ${after[key]}`);
        const n = await page.evaluate(() => globalThis.__GSL_E2E__.app.repo.rounds.count());
        need(n === 1, `IDB rounds after reload: ${n}`);
        notes.push(`reload after the first stroke: same hole ${after.hole}, stroke ${after.strokeN}, player ${after.player}, ball (${after.ballX}, ${after.ballY}); 1 round in IDB`);
      }
    }
    need(await mode(page) === 'holedone', 'hole 1 not finished after 30 actions');
    const [round] = await roundsInIdb(page);
    const h1 = round.strokes.filter((s) => s.hole === 1);
    need(h1.some((s) => s.source === 'auto_putt'), 'no simulated putts on hole 1');
    need(h1.filter((s) => s.source === 'manual').every((s) => s.shot_id === null && s.carry.reason_codes.includes('MANUAL_ENTRY')), 'manual strokes must stay in the round (no shot_id, MANUAL_ENTRY)');
    const shots = await page.evaluate(async () => (await globalThis.__GSL_E2E__.app.repo.shots.list()).length);
    need(shots === 0, `typed-in strokes must never become shots (found ${shots})`);
    const expect = {};
    for (const p of round.players) {
      const mine = h1.filter((s) => s.player_id === p.player_id);
      const picked = mine.some((s) => s.source === 'pickup');
      expect[p.player_id] = picked ? 2 * round.course.holes[0].par : mine.filter((s) => s.source !== 'pickup').length + mine.reduce((a, s) => a + s.penalty, 0);
    }
    await click(page, 'round-scorecard');
    await page.locator('[data-screen="scorecard"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-screen="scorecard"] [data-testid="score-table"]').waitFor();
    const card = await page.evaluate(() => {
      const root = document.querySelector('[data-screen="scorecard"]');
      const cells = Object.fromEntries([...root.querySelectorAll('[data-testid="score-cell"][data-hole="1"]')].map((c) => [c.dataset.player, c.dataset.strokes]));
      const total = Object.fromEntries([...root.querySelectorAll('[data-testid="score-total"] td')].map((td) => [td.dataset.player, td.textContent.trim()]));
      return { cells, total, disclaimer: Boolean(root.querySelector('[data-testid="score-disclaimer"]')) };
    });
    for (const [pid, n] of Object.entries(expect)) {
      need(card.cells[pid] === String(n), `scorecard hole 1 ${pid}: ${card.cells[pid]} ≠ derived ${n}`);
      need(card.total[pid] === String(n), `scorecard total ${pid}: ${card.total[pid]} ≠ derived ${n}`);
    }
    need(card.disclaimer, 'scorecard disclaimer missing');
    notes.push(`hole 1 played by typing in + simulated putting; scorecard = derived ${JSON.stringify(expect)}`);
    await setTextScale(page, 2);
    await page.waitForTimeout(150);
    const hs = await noHScroll(page);
    need(hs.ok, `scorecard h-scroll at 200 %: ${hs.scrollWidth} > ${hs.clientWidth}`);
    await setTextScale(page, 1);
    need(w.errors.length === 0, `page errors: ${w.errors.slice(0, 3).join(' | ')}`);
    need(w.external.length === 0, `requests left the origin: ${w.external.slice(0, 3).join(', ')}`);
    await context.close();
  } finally {
    await browser.close();
  }
  return notes.join('\n');
}

// ------------------------------------------------------------------ v4-d-honesty
async function runHonesty(ctx) {
  const { nextTurn } = await import(path.join(ROOT, 'app/src/sim/round.js'));
  const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/rounds/v4c/links_9_2p_seed42.json'), 'utf8'));
  const i = src.strokes.findIndex((s) => s.source === 'quick' && s.carry.origin === 'prior' && s.carry.reason_codes.includes('GAPPING_PRIOR') && s.side.reason_codes.includes('SIDE_SAMPLED'));
  need(i >= 0, 'fixture has no live dtl (gapping prior) stroke');
  const s0 = src.strokes[i];
  const cut = { ...src, round_id: 'round-v4d-honesty', status: 'active', strokes: src.strokes.slice(0, i + 1), current: { hole: s0.hole, player_id: s0.player_id } };
  Object.assign(cut, nextTurn(cut));
  need(cut.current?.hole === s0.hole, 'fixture cut does not stay on the stroke\'s hole');
  const browser = await launch(ctx, { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const notes = [];
  try {
    const { context, page, w } = await open(ctx, browser, { permissions: ['camera', 'microphone'] });
    await page.evaluate(async (r) => { await globalThis.__GSL_E2E__.app.repo.rounds.put(r); }, cut);
    await nav(page, 'round', { round_id: cut.round_id });
    await page.locator(R).waitFor({ state: 'visible', timeout: 20000 });
    if (await untilMode(page, ['handoff', 'play']) === 'handoff') await click(page, 'round-handoff-go');
    await untilMode(page, 'play');
    const got = await page.evaluate((sel) => {
      const root = document.querySelector(sel);
      const params = JSON.parse(root.querySelector('[data-testid="round-map"]').dataset.params);
      const last = root.querySelector('[data-testid="round-last"]');
      const chip = (dim) => last?.querySelector(`[data-testid="round-chip"][data-dim="${dim}"]`)?.textContent ?? '';
      return { params, carry: chip('carry'), side: chip('side'), aria: root.querySelector('[data-testid="round-map"]').getAttribute('aria-label') };
    }, R);
    const zh = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/i18n/zh-Hant/validity.json'), 'utf8'));
    const sim = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/i18n/zh-Hant/sim.json'), 'utf8'));
    need(got.params.ellipse === true && got.params.source === 'gapping', `map params ${JSON.stringify(got.params)}`);
    need(got.carry.includes(zh[s0.carry.validity]) && got.carry.includes(sim['source.gapping']), `carry chip "${got.carry}"`);
    need(got.side.includes(zh[s0.side.validity]) && got.side.includes(sim['source.sampled']), `side chip "${got.side}"`);
    need(got.aria && got.aria.includes(sim['source.gapping']), `map a11y text "${got.aria}"`);
    notes.push(`dtl stroke: map ${JSON.stringify(got.params)}; chips "${got.carry}" / "${got.side}"`);

    // the live path: Swing → live { sink: 'sim' } shows the round banner (V4-B loads ui/sim-banner.js); a face-on quick
    // read handed back through app.sim.submit becomes the stroke (source quick, PROVISIONAL, ellipse, estimated chip)
    const before = await ds(page);
    await click(page, 'round-swing');
    await page.locator('[data-screen="live"]').waitFor({ state: 'visible', timeout: 20000 });
    const banner = page.locator('[data-screen="live"] [data-testid="sim-banner"]');
    await banner.waitFor({ state: 'visible', timeout: 15000 });
    const bt = await banner.textContent();
    need(bt.includes(`${before.hole}`) && bt.includes(`${before.strokeN}`), `banner "${bt}" does not name hole ${before.hole} stroke ${before.strokeN}`);
    const used = await page.evaluate(() => {
      const app = globalThis.__GSL_E2E__.app;
      const ctx = app.sim.active();
      const n = app.sim.submit({ kind: 'quick', result: { stage: 'provisional', view: 'face_on', carry_source: 'pose', metrics: { carry_m: { value: 150, ci95: [125, 175], sigma: 12.8, validity: 'low_confidence', value_origin: 'flight_model', reason_codes: ['PROVISIONAL', 'FLIGHT_MODELLED'] } } } });
      app.nav.back();
      return { ctx, n };
    });
    need(used.n === 1 && used.ctx?.round_id === cut.round_id && used.ctx?.player_id === before.player, `app.sim ctx/listeners ${JSON.stringify(used)}`);
    await page.locator(R).waitFor({ state: 'visible', timeout: 20000 });
    await waitFor(async () => (await page.evaluate(async (id) => (await globalThis.__GSL_E2E__.app.repo.rounds.get(id)).strokes.length, cut.round_id)) === cut.strokes.length + 1, { timeout: 8000, interval: 100, what: 'quick stroke saved' });
    const q = await page.evaluate(async (id) => (await globalThis.__GSL_E2E__.app.repo.rounds.get(id)).strokes.at(-1), cut.round_id);
    need(q.source === 'quick' && q.carry.reason_codes.includes('PROVISIONAL') && q.carry.validity !== 'valid' && (q.carry.sigma > 0 || q.carry.ci95), `quick stroke ${JSON.stringify(q.carry)}`);
    if (await untilMode(page, ['handoff', 'play', 'holedone']) === 'handoff') await click(page, 'round-handoff-go');
    // the live-submitted quick stroke is on the map with its own 95 % ellipse (one more than before it), drawn once its
    // landing animation has finished
    const mapParams = () => page.evaluate((sel) => JSON.parse(document.querySelector(sel).querySelector('[data-testid="round-map"]')?.dataset.params ?? 'null'), R);
    await waitFor(async () => ((await mapParams())?.ellipses ?? 0) > got.params.ellipses, { timeout: 5000, interval: 100, what: 'the quick stroke\'s ellipse on the map' }).catch(() => {});
    const after = await mapParams();
    need(after && after.ellipse === true && after.ellipses === got.params.ellipses + 1 && after.strokes === got.params.strokes + 1, `map after the quick stroke ${JSON.stringify(after)} (before ${JSON.stringify(got.params)})`);
    notes.push(`live banner "${bt.trim()}"; quick read → stroke carry ${q.carry.value} m (${q.carry.validity}, ${q.carry.reason_codes.join(' ')})`);
    await click(page, 'round-scorecard');
    await page.locator('[data-screen="scorecard"] [data-testid="score-table"]').waitFor({ timeout: 10000 });
    need(await page.locator('[data-screen="scorecard"] [data-testid="score-disclaimer"][data-i18n-key="score.disclaimer"]').count() === 1, 'scorecard footer score.disclaimer missing');
    need(w.errors.length === 0, `page errors: ${w.errors.slice(0, 3).join(' | ')}`);
    await context.close();
  } finally {
    await browser.close();
  }
  return notes.join('\n');
}

// ------------------------------------------------------------------ v4-d-perf
const quant = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))]; };

async function runPerf(ctx) {
  const golden = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/v4/course-golden.json'), 'utf8')).cases['links/42/18/middle'];
  const browser = await launch(ctx);
  const notes = [];
  try {
    const { context, page, w } = await open(ctx, browser);
    const sha = await page.evaluate(async () => {
      const m = await import(new URL('src/course/generate.js', document.baseURI).href);
      const text = m.courseCanonical(m.generateCourse({ seed: 42, style: 'links', holes: 18, tees: 'middle' }));
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    });
    need(sha === golden, `browser course sha256 ${sha} ≠ node golden ${golden}`);
    notes.push('cross-engine: browser generateCourse(links, 42, 18) = node golden');
    await nav(page, 'round');
    await page.locator(R).waitFor({ state: 'visible', timeout: 20000 });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const r = await page.evaluate(() => globalThis.__GSL_E2E__.app.e2e.runState('round', 'perf', globalThis.__GSL_E2E__.app));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const med = quant(r.ms, 0.5);
    const p95 = quant(r.ms, 0.95);
    notes.push(`fly-over ${r.frames} frames, draw median ${med.toFixed(2)} ms, P95 ${p95.toFixed(2)} ms (CPU ×4); next hole → fly-over ${r.next_to_flyover_ms.toFixed(0)} ms, skip → map ${r.skip_to_play_ms.toFixed(0)} ms`);
    need(r.frames >= 10, `fly-over drew only ${r.frames} frames`);
    need(med <= 12 && p95 <= 25, `fly-over frame time median ${med} ms / P95 ${p95} ms over 12 / 25`);
    need(r.next_to_flyover_ms <= 1000 && r.skip_to_play_ms <= 1000, `hole change ${r.next_to_flyover_ms} ms / ${r.skip_to_play_ms} ms over 1,000 ms`);
    need(r.mode === 'play', `after the skip the round is in ${r.mode}, not play`);
    need(w.errors.length === 0, `page errors: ${w.errors.slice(0, 3).join(' | ')}`);
    await context.close();
  } finally {
    await browser.close();
  }
  return notes.join('\n');
}

// ------------------------------------------------------------------ v4-d-motion
async function runMotion(ctx) {
  const browser = await launch(ctx);
  const notes = [];
  try {
    const { context, page, w } = await open(ctx, browser, { reducedMotion: 'reduce' });
    const id = await page.evaluate(async () => {
      const app = globalThis.__GSL_E2E__.app;
      const base = document.baseURI;
      const { generateCourse } = await import(new URL('src/course/generate.js', base).href);
      const { newRound } = await import(new URL('src/sim/round.js', base).href);
      const r = newRound({ round_id: 'round-v4d-motion', created_at: new Date().toISOString(), app_version: 'e2e', course: generateCourse({ seed: 5, style: 'parkland', holes: 9, tees: 'middle' }), settings: {}, players: [{ name: 'Solo', kind: 'guest', driver_carry_m: 200 }] });
      await app.repo.rounds.put(r);
      return r.round_id;
    });
    await nav(page, 'round', { round_id: id });
    await page.locator(R).waitFor({ state: 'visible', timeout: 20000 });
    await untilMode(page, 'intro');
    await page.waitForTimeout(1200);
    const fly = await page.evaluate((sel) => { const r = document.querySelector(sel); return { frames: r.dataset.flyFrames, stat: r.querySelector('[data-testid="round-flyover"]')?.dataset.static }; }, R);
    need(fly.frames === '1' && fly.stat === '1', `reduced motion fly-over: ${JSON.stringify(fly)} (want 1 static frame)`);
    await click(page, 'round-flyover-skip');
    await untilMode(page, 'play');
    await manualStroke(page);
    await untilMode(page, ['play', 'holedone']);
    await page.waitForTimeout(600);
    const lf = await page.evaluate((sel) => document.querySelector(sel).dataset.landingFrames ?? null, R);
    need(lf === '1', `reduced motion landing drawn in ${lf} frames (want 1)`);
    need(w.errors.length === 0, `page errors: ${w.errors.slice(0, 3).join(' | ')}`);
    await context.close();
    // the counter counts real draws: without reduced motion the same landing takes several frames
    const m2 = await open(ctx, browser, { reducedMotion: 'no-preference' });
    const id2 = await m2.page.evaluate(async () => {
      const app = globalThis.__GSL_E2E__.app;
      const base = document.baseURI;
      const { generateCourse } = await import(new URL('src/course/generate.js', base).href);
      const { newRound } = await import(new URL('src/sim/round.js', base).href);
      const r = newRound({ round_id: 'round-v4d-motion2', created_at: new Date().toISOString(), app_version: 'e2e', course: generateCourse({ seed: 5, style: 'parkland', holes: 9, tees: 'middle' }), settings: { flyover: false }, players: [{ name: 'Solo', kind: 'guest', driver_carry_m: 200 }] });
      await app.repo.rounds.put(r);
      return r.round_id;
    });
    await nav(m2.page, 'round', { round_id: id2 });
    await m2.page.locator(R).waitFor({ state: 'visible', timeout: 20000 });
    if (await untilMode(m2.page, ['intro', 'play']) === 'intro') { await click(m2.page, 'round-flyover-skip'); await untilMode(m2.page, 'play'); }
    await manualStroke(m2.page);
    await untilMode(m2.page, ['play', 'holedone']);
    await m2.page.waitForTimeout(1500);
    const lf2 = Number(await m2.page.evaluate((sel) => document.querySelector(sel).dataset.landingFrames ?? 0, R));
    need(lf2 > 1, `with motion the landing drew ${lf2} frame(s) (want > 1: the counter must count draws)`);
    notes.push(`reduced motion: fly-over 1 static frame; landing 1 frame (with motion: ${lf2} frames)`);
    await m2.context.close();
  } finally {
    await browser.close();
  }
  return notes.join('\n');
}

// ------------------------------------------------------------------ v4-d-import (integration)
async function runImport(ctx) {
  const { file: clip } = await mp4Fixture('vp9');
  const { installAnalysisStandIn } = await import('./c-results.mjs');
  const shot0 = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/shots/v2/valid_face_on_240.json'), 'utf8'));
  const browser = await launch(ctx);
  const notes = [];
  try {
    const { context, page, w } = await open(ctx, browser, {}, { fn: installAnalysisStandIn, arg: JSON.stringify(shot0) });
    const id = await page.evaluate(async () => {
      const app = globalThis.__GSL_E2E__.app;
      const base = document.baseURI;
      const { generateCourse } = await import(new URL('src/course/generate.js', base).href);
      const { newRound } = await import(new URL('src/sim/round.js', base).href);
      const r = newRound({ round_id: 'round-v4d-import', created_at: new Date().toISOString(), app_version: 'e2e', course: generateCourse({ seed: 11, style: 'parkland', holes: 9, tees: 'middle' }), settings: {}, players: [{ name: 'Me', kind: 'owner', driver_carry_m: 200 }] });
      await app.repo.rounds.put(r);
      return r.round_id;
    });
    await nav(page, 'round', { round_id: id });
    await page.locator(R).waitFor({ state: 'visible', timeout: 20000 });
    const m0 = await untilMode(page, ['intro', 'handoff', 'play']);
    if (m0 === 'intro') await click(page, 'round-flyover-skip');
    if (await untilMode(page, ['handoff', 'play']) === 'handoff') await click(page, 'round-handoff-go');
    await untilMode(page, 'play');
    await click(page, 'round-import');
    await page.locator('[data-screen="import"]').waitFor({ state: 'visible', timeout: 20000 });
    await page.locator('[data-screen="import"] [data-testid="sim-banner"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('[data-screen="import"] [data-testid="import-file-input"]').setInputFiles(clip);
    await waitFor(() => page.evaluate(() => { const x = document.querySelector('[data-testid="import-start"]'); return Boolean(x && !x.disabled); }), { timeout: 60000, interval: 200, what: 'import-start enabled' });
    await page.locator('[data-testid="import-start"]').click();
    await page.locator(R).waitFor({ state: 'visible', timeout: 60000 });
    await waitFor(async () => (await page.evaluate(async (rid) => (await globalThis.__GSL_E2E__.app.repo.rounds.get(rid)).strokes.length, id)) === 1, { timeout: 15000, interval: 200, what: 'imported stroke saved' });
    const got = await page.evaluate(async (rid) => {
      const app = globalThis.__GSL_E2E__.app;
      const st = (await app.repo.rounds.get(rid)).strokes[0];
      const shots = await app.repo.queryShots({ reverse: true });
      return { st, shot: shots.find((x) => x.shot_id === st.shot_id) ?? null };
    }, id);
    need(got.st.source === 'shot' && got.shot, `stroke ${JSON.stringify({ source: got.st.source, shot_id: got.st.shot_id })} is not the imported shot`);
    need(got.st.carry.validity !== 'valid' && Math.abs(got.st.carry.value - got.shot.metrics.carry_m.value) <= 0.5, `stroke carry ${JSON.stringify(got.st.carry)} vs the shot's ${got.shot.metrics.carry_m.value}`);
    const mode1 = await untilMode(page, ['handoff', 'play', 'holedone']);
    if (mode1 === 'handoff') await click(page, 'round-handoff-go');
    if (mode1 !== 'holedone') {
      await untilMode(page, 'play');
      const params = await page.evaluate((sel) => JSON.parse(document.querySelector(sel).querySelector('[data-testid="round-map"]').dataset.params), R);
      need(params.strokes === 1, `map params after the import ${JSON.stringify(params)}`);
    }
    need(w.errors.length === 0, `page errors: ${w.errors.slice(0, 3).join(' | ')}`);
    need(w.external.length === 0, `external requests: ${w.external.join(', ')}`);
    notes.push(`import → stroke: source ${got.st.source}, carry ${got.st.carry.value} m (${got.st.carry.validity}, ${got.st.carry.origin}), shot ${got.st.shot_id}`);
    await context.close();
  } finally {
    await browser.close();
  }
  return notes.join('\n');
}

// ------------------------------------------------------------------ v4-d-share (integration)
async function runShare(ctx) {
  const round = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/rounds/v4c/links_9_2p_seed42.json'), 'utf8'));
  const SIMULATED = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/i18n/zh-Hant/share.json'), 'utf8'))['card.simulated'];
  const browser = await launch(ctx);
  try {
    const { context, page, w } = await open(ctx, browser, { locale: 'zh-TW' });
    await page.evaluate(async (r) => { await globalThis.__GSL_E2E__.app.repo.rounds.put(r); }, round);
    await nav(page, 'scorecard', { round_id: round.round_id });
    await page.locator('[data-screen="scorecard"] [data-testid="score-share"]').click();
    await page.locator('[data-testid="share-sheet"]').waitFor({ state: 'visible', timeout: 20000 });
    await page.locator('[data-testid="share-make-card"]').click();
    await waitFor(() => page.evaluate(() => !document.querySelector('[data-testid="share-card-preview"]')?.closest('.share-result')?.hidden), { timeout: 15000, interval: 100, what: 'round card' });
    const c = await page.evaluate(async () => {
      const img = document.querySelector('[data-testid="share-card-preview"]');
      await img.decode().catch(() => {});
      const blob = await (await fetch(img.src)).blob();
      const bmp = await createImageBitmap(blob);
      return { w: bmp.width, h: bmp.height, type: blob.type, alt: img.alt, kind: img.dataset.kind ?? null };
    });
    need(c.w === 1080 && c.h === 1350 && c.type === 'image/png', `round card ${JSON.stringify(c)}`);
    need(c.alt.includes(SIMULATED), `round card text alternative "${c.alt}" does not say "${SIMULATED}"`);
    need(w.errors.length === 0, `page errors: ${w.errors.slice(0, 3).join(' | ')}`);
    await context.close();
    return `scorecard share → round card ${c.w}×${c.h} ${c.type}; alt "${c.alt.slice(0, 80)}"`;
  } finally {
    await browser.close();
  }
}

export const gates = [
  { meta: { id: 'v4-d-round', title: 'V4-D: new round (links 42, 9 holes, 2 players) → typed-in strokes to the green → simulated putts → scorecard = derived; reload keeps hole, stroke, ball', timeoutMs: 240000 }, run: runRound },
  { meta: { id: 'v4-d-honesty', title: 'V4-D: a live dtl stroke shows its 95 % ellipse, source gapping, validity word and sampled chip; scorecard disclaimer', timeoutMs: 120000 }, run: runHonesty },
  { meta: { id: 'v4-d-perf', title: 'V4-D: fly-over frame time (CPU ×4), hole change ≤ 1 s, browser course sha256 = node golden', timeoutMs: 180000 }, run: runPerf },
  { meta: { id: 'v4-d-motion', title: 'V4-D: reduced motion → one fly-over frame, no landing animation (landing draws counted)', timeoutMs: 120000 }, run: runMotion },
  { meta: { id: 'v4-d-import', title: 'V4-D (integration): round → import a slow-motion clip with the round banner → the analysed shot is the stroke (source shot, never valid)', timeoutMs: 180000 }, run: runImport },
  { meta: { id: 'v4-d-share', title: 'V4-D (integration): scorecard share → round card 1080×1350 PNG that says simulated', timeoutMs: 120000 }, run: runShare },
];
