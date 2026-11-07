// ui/live.js — live scoreboard (PRODUCT-SPEC §2.3 Live; V11/UX-04, UX-15, ux-m1, A11Y-5, R1 live side): forced dark
// (or sun), a StatePill (`live-state`), 1–3 hero numbers readable from 2.7 m (`live-hero`), shot count + club chip
// (`live-club`: a sheet of clubs applied to the next shot without restarting the camera), a persistent aria-live
// last-shot line, voice readout, 結束練習 (`live-end`, ConfirmSheet once shots exist) and 重新架設. No touch counter
// on screen (touches still go to the loop → diag live.touches_per_shot).
// Wires media's pipeline/live.js createLiveLoop to the frame tap, segment recorder, onset detector and the vision
// worker client; P18 decisions go through the session controller (controller.reportLive).
// attachStream(stream?) (R1, §8.0.9): after controller.reopenCamera() main.js calls it (and controller.onStreamChange
// when D provides it); the preview and the whole capture chain move to the new MediaStream.
// 0.4.0 quick read (V04-SPEC §A): unless settings.quick.enabled === false, start() imports quick/estimate.js and
// ui/quickcard.js; the card takes the hero's place at impact (onProvisional) and turns into the full shot in place.
// show({ sink: 'sim' }) adds the round banner (ui/sim-banner.js), which gets every quick read. e2e states
// live:provisional / live:refined show the card with demo numbers.
import { h, clear } from './dom.js';
import { button, statePill, sheet, confirmSheet, icon } from './components.js';
import { t, fmtNum, getLocale, list } from '../i18n/index.js';
import { fmtMetric } from '../i18n/units.js';
import { CLUBS, saveSettings } from '../session/settings.js';
import { newId, nowIso } from '../session/ids.js';

/** Metrics the live (swing-only) mode can measure; ball numbers need the slow-motion import. */
export const LIVE_MEASURABLE = Object.freeze(['tempo_ratio', 'backswing_s', 'downswing_s', 'club_speed_mps', 'head_sway_x_m']);
const DEFAULT_ETA_S = 20;

/** Hero metric ids for the scoreboard: settings.live.metrics filtered to what the mode measures (1–3). */
export function heroMetrics(settingsLive, mode = 'live') {
  const want = Array.isArray(settingsLive?.metrics) && settingsLive.metrics.length ? settingsLive.metrics : ['tempo_ratio', 'club_speed_mps', 'carry_m'];
  const can = mode === 'live' ? want.filter((m) => LIVE_MEASURABLE.includes(m)) : want;
  const out = can.slice(0, 3);
  return out.length ? out : ['tempo_ratio'];
}

/** live loop state → [pill state, text key] */
function pillFor(to) {
  if (to === 'IDLE') return ['ready', 'live.state.idle'];
  if (to === 'ADDRESS') return ['ready', 'live.state.ready'];
  if (to === 'SWING' || to === 'IMPACT' || to === 'FINISH') return ['swinging', 'live.state.swinging'];
  if (to === 'ANALYZING') return ['analysing', 'live.state.analysing'];
  return ['ready', 'live.state.idle'];
}

export function mountLive(root, app) {
  let pipeline = null;
  let gen = 0; // bumped by stop(): a start() that was overtaken tears its pieces down
  let startingGen = -1;
  let shots = 0;
  let els = {};
  let clipOptions = null;
  let doneTimer = 0;
  let etaS = [];
  let pending = 0; // swings waiting for their analysis
  let unsub = null;
  let offStream = null;
  let qc = null; // quick card + its loop tap (lazy ui/quickcard.js), the round banner
  let qcP = null;
  let banner = null;
  let focus = null;
  const onTouch = () => { pipeline?.loop?.touch(); };

  const clubOf = (type) => CLUBS.find((c) => c[0] === type) ?? CLUBS[4];
  const eta = () => Math.max(1, Math.round(etaS.length ? etaS.reduce((a, b) => a + b, 0) / etaS.length : DEFAULT_ETA_S));

  function setPill(state, key, params) {
    els.pill?.update(state, t(key, params));
  }

  function liveTheme() {
    if (app.settings().theme === 'sun') delete root.dataset.liveTheme;
    else root.dataset.liveTheme = 'dark';
  }

  // nav.go('live', { focus }) (V4-F practice card): that metric is the first hero tile, measurable live or not
  const heroIds = () => { const l = heroMetrics(app.settings().live, 'live'); return focus ? [focus, ...l.filter((x) => x !== focus)].slice(0, 3) : l; };
  function renderHero(shot) {
    if (!els.hero) return;
    const ids = heroIds();
    const units = app.units();
    clear(els.hero, ids.map((id) => {
      const m = shot?.metrics?.[id] ?? null;
      const f = fmtMetric(m, units, { id });
      const rc = f.value === '—' && m?.reason_codes?.[0]; // an honest null says why (a focus metric live mode cannot see)
      const later = !shot && id === focus && !LIVE_MEASURABLE.includes(id); // before the first shot: comes with the full analysis
      return h('div.hero-tile', { 'data-metric': id, class: `hero-tile${shot ? ' is-new' : ''}` },
        h('span.hero-label', t(`metric.${id}.label`)),
        h('span.hero-value', {}, h('span.live-hero-num', f.value), f.unit && f.value !== '—' ? h('span.hero-unit', f.unit) : null),
        rc || later ? h('span.qc-note', later ? t('quick.not_quick') : t(`reason.${rc}.short`)) : null);
    }));
  }

  function lastLine(shot) {
    if (!els.last) return;
    els.last.classList.toggle('has-shot', Boolean(shot)); // large text: the summary repeats the hero, shown to readers only
    if (!shot) { els.last.textContent = t('live.last.none'); els.open.hidden = true; return; }
    const units = app.units();
    const parts = heroMetrics(app.settings().live, 'live').map((id) => { const m = shot.metrics?.[id]; return Number.isFinite(m?.value) ? `${t(`metric.${id}.label`)} ${fmtMetric(m, units, { id }).text}` : null; }).filter(Boolean);
    els.last.textContent = t('live.last.line', { n: shots, items: parts.length ? list(parts) : t('live.last.no_numbers') });
    els.open.hidden = false;
    els.open.onclick = () => { stop(); app.nav.go('shot', { shot_id: shot.shot_id }); };
  }

  function speak(shot) {
    if (app.settings().live?.voice === false) return;
    const synth = globalThis.speechSynthesis;
    const U = globalThis.SpeechSynthesisUtterance;
    if (!synth || !U) return;
    const units = app.units();
    const parts = heroMetrics(app.settings().live, 'live').map((id) => { const m = shot.metrics?.[id]; return Number.isFinite(m?.value) ? t('live.speak.item', { label: t(`metric.${id}.label`), value: fmtMetric(m, units, { id }).value, unit: fmtMetric(m, units, { id }).unit }) : null; }).filter(Boolean);
    try {
      const u = new U(t('live.speak.shot', { n: shots, items: parts.length ? list(parts) : t('live.last.no_numbers') }));
      u.lang = getLocale() === 'en' ? 'en-US' : 'zh-TW';
      synth.cancel?.();
      synth.speak(u);
    } catch (_) { /* no voice */ }
  }

  // once per shown screen (qcP is reset by show / hide); a card for an old render is never kept
  const loadQuick = () => (qcP ??= app.settings().quick?.enabled === false ? Promise.resolve() : (async (el) => {
    try {
      const c = await (await import('./quickcard.js')).attachQuick(el, app, () => ({ focus, clip: clipOptions, banner, video: els.video, empty: renderHero }));
      if (els.hero === el) qc = c;
    } catch (_) { /* no quick read: the 0.3.0 hero stays */ }
  })(els.hero));
  // e2e states (screenshot matrix): the card with demo numbers on a ready screen (opened without a camera session)
  for (const st of ['provisional', 'refined']) {
    app.e2e?.registerState?.('live', st, async () => { await loadQuick(); els.problem.hidden = true; setPill('ready', 'live.state.idle'); qc?.demo(st); });
  }

  async function onShot({ shot, clipBlob = null, poseSeq = null, quick = null }) {
    pending = Math.max(0, pending - 1);
    try {
      const saved = await app.controller.saveShot(shot, { clipBlob, poseSeq });
      shots += 1;
      paintCount();
      if (qc) qc.refined(saved, { quick }); else renderHero(saved);
      lastLine(saved);
      speak(saved);
      setPill('done', 'live.state.done', { n: shots });
      clearTimeout(doneTimer);
      doneTimer = setTimeout(() => setPill('ready', 'live.state.idle'), 3000);
    } catch (e) {
      app.errors.report(e, { where: 'live.save', slot: els.errSlot });
    }
  }

  function paintCount() {
    if (els.count) els.count.textContent = t('live.count', { n: shots });
  }

  function paintClub() {
    if (els.club) els.club.querySelector('.btn-label').textContent = t('live.club', { club: t(`club.${clubOf(app.settings().club_type)[0]}`) });
  }

  function setClub(type) {
    const c = clubOf(type);
    const st = saveSettings({ club_type: c[0], club_length_m: c[1] });
    app.updateSettings?.(st);
    if (clipOptions) clipOptions.club = { ...clipOptions.club, type: c[0], length_m: c[1] }; // read by the next job
    try { app.controller.setClub?.({ type: c[0], length_m: c[1] }); } catch (_) { /* optional */ }
    app.record?.('live.next_club', clipOptions?.club?.type ?? c[0]);
    paintClub();
  }

  function clubSheet() {
    const cur = app.settings().club_type;
    let sh = null;
    const rows = h('div.list-group.club-list', { role: 'listbox', 'aria-label': t('live.club_sheet') }, CLUBS.map(([type]) => h('button.list-row.club-row', {
      type: 'button', role: 'option', 'aria-selected': type === cur ? 'true' : 'false', 'data-club': type,
      onclick: () => { setClub(type); sh.close(); },
    }, h('span.lr-text', {}, h('span.lr-title', t(`club.${type}`))), type === cur ? h('span.pick-check.on', {}, icon('check')) : null)));
    sh = sheet({ title: t('live.club_sheet'), content: h('div', {}, h('p.hint', t('live.club_hint')), rows), testid: 'live-club-sheet' });
    sh.open();
  }

  async function start() {
    if (pipeline || startingGen === gen) return;
    const mod = app.deps.livePipeline;
    const m = app.controller.media();
    if (!mod?.createLiveLoop || !app.deps.frametap?.createFrameTap || !app.deps.recorder?.createSegmentRecorder || !app.vision) {
      setPill('error', 'live.state.no_module');
      els.problem.hidden = false;
      clear(els.problem, h('p', t('live.problem.no_module')), button({ label: t('live.import'), variant: 'tinted', size: 'lg', block: true, icon: 'film', onClick: () => { stop(); app.nav.go('import'); } }));
      return;
    }
    if (!m.stream || m.videoTrack?.readyState === 'ended') { showCameraLost(); return; }
    const my = gen;
    startingGen = my;
    els.problem.hidden = true;
    const cur = app.current ?? {};
    const st = app.settings();
    const sess = app.store.get().session ?? {};
    const video = els.video;
    try {
      const vc = await app.vision();
      let tap = null;
      let loop = null;
      // segment time 0 = the first frame recorded = the tap's next frame at or after "now" on the same perf -> media mapping
      // the audio onsets use (capture/recorder.js startClock; 0.3.0 used the last tapped frame, a frame or more early)
      const recorder = app.deps.recorder.createSegmentRecorder(m.stream, {
        mediaClock: () => tap?.lastMediaTime() ?? video.currentTime,
        startClock: () => {
          const nowM = tap?.mediaTimeAt(performance.now());
          return Number.isFinite(nowM) && tap?.nextMediaTime ? tap.nextMediaTime(nowM) : (tap?.lastMediaTime() ?? video.currentTime);
        },
      });
      let onset = { available: false, stop() {} };
      if (m.audioCtx && m.audioTrack && app.deps.onset?.startOnsetDetector) {
        onset = await app.deps.onset.startOnsetDetector(m.audioCtx, m.stream, { onOnset: (tt, level_db) => loop?.handleOnset(tt, level_db), toMediaTime: (ms) => tap?.mediaTimeAt(ms) ?? null });
      }
      const club = { type: st.club_type, length_m: st.club_length_m, lie: cur.lie ?? st.lie, tee_lift_m: cur.venue?.tee_lift_m ?? null, tee_lift_source: Number.isFinite(cur.venue?.tee_lift_m) ? 'measured' : 'assumed' };
      clipOptions = { view: cur.view ?? app.store.get().view, calibration: cur.calibration ?? null, club, handedness: st.handedness, venue: cur.venue ?? null, pose_model: 'full', warnings: app.controller.warnings(), lm: { ground: st.lm?.ground } };
      app.record?.('live.next_club', club.type);
      loadQuick();
      let jobAt = 0;
      loop = mod.createLiveLoop({
        // e2e only (docs/e2e-hooks.md, gate m5): a harness-provided pose stand-in replaces MediaPipe when
        // globalThis.__GSL_E2E__.pose was set before boot; everything else (frame tap, onsets, detector) stays real
        pose: typeof globalThis.__GSL_E2E__?.pose === 'function'
          ? (bitmap, t_s, model, o) => globalThis.__GSL_E2E__.pose(bitmap, t_s, model, o)
          : (bitmap, t_s, model, o) => vc.pose(bitmap, t_s, model, o),
        recorder,
        analyzeSegment: (blob, options) => {
          jobAt = performance.now();
          // e2e only (docs/e2e-hooks.md, gate v4-b-latency): per live job, the segment's start on the media timeline, the
          // live impact (media time, source) and the refined shot; the clip pose stand-in tags its frames with the job
          const e2e = globalThis.__GSL_E2E__;
          let job = null;
          if (e2e) {
            const ev = options?.live_event ?? {};
            job = { t0: ev.t_offset_s ?? null, t_impact: ev.t_impact ?? null, impact_source: ev.impact_source ?? null, shot_id: null };
            (e2e.liveJobs ??= []).push(job);
            if (e2e.clip) e2e.clip.job = e2e.liveJobs.length;
          }
          app.record?.('live.job_club', options?.club?.type ?? null);
          let p = vc.analyzeClip(blob, options);
          if (job) p = p.then((res) => { job.shot_id = res?.shot?.shot_id ?? null; return res; });
          return p.finally(() => { etaS.push((performance.now() - jobAt) / 1000); if (etaS.length > 5) etaS.shift(); });
        },
        clipOptions,
        newIds: () => ({ shot_id: newId('shot'), session_id: sess.session_id ?? null, venue_id: sess.venue_id ?? null, preset_id: app.store.get().session?.preset_id ?? null, created_at: nowIso(), app_version: app.version() }),
        calibration: cur.calibration ?? null, handedness: st.handedness, audioAvailable: Boolean(onset.available),
        mediaClock: () => tap?.lastMediaTime() ?? video.currentTime,
        setFps: (hz) => tap?.setFps(hz),
        frameStats: () => tap?.stats(),
        thermal: { push: (x) => app.controller.reportLive(x) },
        onShot: (r) => onShot({ shot: r.shot, clipBlob: r.segment ?? null, quick: r.quick }),
        quick: () => qc?.tap,
        onEvent: (ev) => {
          if (ev.type === 'state') { if (!pending) { const [s, k] = pillFor(ev.to); setPill(s, k); } }
          if (ev.type === 'shot') {
            if (ev.kind === 'swing') { pending += 1; clearTimeout(doneTimer); setPill('analysing', 'live.state.analysing', { s: eta() }); } else { setPill('ready', 'live.state.practice'); }
          }
        },
        onError: (e) => { pending = Math.max(0, pending - 1); app.errors.report(e, { where: 'live.loop', slot: els.errSlot }); setPill('ready', 'live.state.idle'); },
        onStopLive: () => { stop(); setPill('error', 'live.state.too_slow'); els.problem.hidden = false; clear(els.problem, h('p', t('live.problem.too_slow')), button({ label: t('live.import'), variant: 'tinted', size: 'lg', block: true, icon: 'film', onClick: () => app.nav.go('import') })); },
      });
      tap = app.deps.frametap.createFrameTap(video, { fps: 10, onFrame: (bm, tt, meta) => loop.handleFrame(bm, tt, meta) });
      recorder.start();
      tap.start();
      const pl = { loop, stream: m.stream, stop() { try { tap.stop(); } catch (_) { /* ignore */ } try { recorder.stop(); } catch (_) { /* ignore */ } try { onset.stop(); } catch (_) { /* ignore */ } } };
      if (my !== gen) { pl.stop(); return; } // stopped or re-attached while starting
      pipeline = pl;
      setPill('ready', 'live.state.idle');
    } catch (e) {
      setPill('error', 'live.state.failed');
      app.errors.report(e, { where: 'live.start', slot: els.errSlot });
    } finally {
      if (startingGen === my) startingGen = -1;
    }
  }

  function showCameraLost() {
    setPill('error', 'live.state.camera_lost');
    els.problem.hidden = false;
    clear(els.problem,
      h('p', t('live.problem.camera_lost')),
      button({
        label: t('live.reopen'), variant: 'primary', size: 'xl', block: true, icon: 'camera', testid: 'live-reopen',
        onClick: () => {
          // same click: reopenCamera() invokes getUserMedia before its first await
          const p = app.controller.reopenCamera();
          Promise.resolve(p).then((ok) => { if (ok) attachStream(); else setPill('error', 'live.state.camera_still_off'); }, () => setPill('error', 'live.state.camera_still_off'));
        },
      }));
  }

  /** R1: bind the preview and restart the capture chain on the current (or given) MediaStream. */
  function attachStream(stream) {
    if (!els.video) return;
    const s = stream ?? app.controller.media().stream;
    if (!s) return;
    const changed = els.video.srcObject !== s || pipeline?.stream !== s;
    if (!changed && pipeline) return;
    stop();
    els.video.srcObject = s;
    els.video.play?.().catch(() => {});
    app.record?.('live.reattached', (app.localDiag?.live?.reattached ?? 0) + 1);
    start();
  }

  function render() {
    liveTheme();
    const video = h('video.live-preview', { playsinline: true, muted: true, autoplay: true, 'aria-label': t('live.preview') });
    const m = app.controller.media();
    if (m.stream) { video.srcObject = m.stream; video.play?.().catch(() => {}); }
    const pill = statePill({ state: 'analysing', text: t('live.state.starting'), testid: 'live-state' });
    const hero = h('div.live-hero', { 'data-testid': 'live-hero', role: 'group', 'aria-label': t('live.hero') });
    const count = h('span.chip.live-count', { 'data-testid': 'live-count' });
    const club = button({ label: '', variant: 'secondary', size: 'lg', icon: 'club', testid: 'live-club', onClick: clubSheet });
    club.classList.add('live-club');
    club.querySelector('.btn-main').append(h('span.chev', {}, icon('chevron-down')));
    const last = h('p.live-last', { role: 'status', 'aria-live': 'polite', 'data-testid': 'live-last' });
    const open = button({ label: t('live.open_last'), variant: 'plain', size: 'md' });
    const problem = h('div.live-problem', { hidden: true });
    const errSlot = h('div.error-slot');
    const end = button({ label: t('live.end'), variant: 'destructive', size: 'lg', testid: 'live-end', onClick: () => endSession() });
    const resetup = button({ label: t('live.resetup'), variant: 'secondary', size: 'lg', icon: 'tripod', onClick: () => { stop(); app.nav.go('setup'); } });
    const board = h('div.live-board');
    els = { video, pill, hero, count, club, last, open, problem, errSlot, board };
    clear(root,
      h('h1.visually-hidden', { tabindex: '-1' }, t('screen.live.title')),
      h('div.live', {},
        h('div.live-top', {}, pill),
        h('div.live-media', {}, video),
        clear(board,
          hero,
          h('div.live-chips', {}, count, club),
          h('div.live-last-row', {}, last, open),
          problem, errSlot)),
      h('div.live-toolbar', {}, resetup, end));
    renderHero(null);
    lastLine(null);
    paintCount();
    paintClub();
  }

  async function endSession() {
    if (shots > 0) {
      const ok = await confirmSheet({ title: t('live.end_title'), consequence: t('live.end_body', { n: shots }), confirmLabel: t('live.end'), destructive: true, testid: 'live-end-confirm' });
      if (!ok) return;
    }
    stop();
    await app.controller.endSession();
    app.updater?.sessionEnded();
    app.nav.go('home');
  }

  function stop() {
    gen += 1;
    try { pipeline?.stop?.(); } catch (_) { /* ignore */ }
    pipeline = null;
  }

  return {
    attachStream,
    show(params) {
      shots = 0;
      pending = 0;
      qc = qcP = null;
      focus = params?.focus ?? null;
      render();
      if (params?.sink === 'sim') {
        const slot = h('div');
        els.board.prepend(slot);
        import('./sim-banner.js').then((m) => { banner = m.mountSimBanner(slot, app, app.sim.active()); }).catch(() => {});
      }
      document.addEventListener('pointerdown', onTouch, { capture: true });
      unsub?.();
      unsub = app.store.subscribe((s, prev) => {
        if (s.cameraInterrupted && !prev.cameraInterrupted) { stop(); showCameraLost(); }
        if (!s.cameraInterrupted && prev.cameraInterrupted) attachStream();
      });
      offStream?.();
      offStream = typeof app.controller.onStreamChange === 'function' ? app.controller.onStreamChange((stream) => attachStream(stream)) : null;
      if (app.store.get().cameraInterrupted) showCameraLost(); else start();
    },
    hide() {
      document.removeEventListener('pointerdown', onTouch, { capture: true });
      clearTimeout(doneTimer);
      unsub?.();
      unsub = null;
      offStream?.();
      offStream = null;
      stop();
      try { banner?.destroy(); } catch (_) { /* V4-D */ }
      banner = null;
      delete root.dataset.liveTheme;
    },
  };
}
