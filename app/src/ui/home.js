// ui/home.js — Practice (home) screen (PRODUCT-SPEC §2.3; V07/UX-14, V08, visual-m2): onboarding on first launch,
// then a context card (venue · view · club · mode, each a sheet), one pinned 開始練習 (P2: startPractice() is called
// synchronously from the click), 匯入影片, the last session, and while a session runs a read-only summary with
// 回到即時模式 / 回到架設 / 結束練習. show({ onboarding: true }) re-runs onboarding (Settings › Help).
import { h, clear } from './dom.js';
import { button, listRow, sheet, confirmSheet, screenHeader, notice, icon } from './components.js';
import { t, fmtNum, fmtDateTime, fmtDate } from '../i18n/index.js';
import { fmtMetric } from '../i18n/units.js';
import { CLUBS, saveSettings } from '../session/settings.js';
import { DEFAULT_VENUE } from '../calib/mat.js';
import { nowIso } from '../session/ids.js';
import { createOnboarding, needsOnboarding } from './onboarding.js';

export const DEFAULT_VENUE_ID = 'venue-default';
const VIEWS = ['face_on', 'dtl', 'high_behind'];
const MODES = ['live', 'highspeed'];

/** Display name of a venue: the default mat is always named by the catalog (stored names stay as typed). */
export function venueName(v) {
  if (!v || v.venue_id === DEFAULT_VENUE_ID) return t('home.venue.default');
  return v.name || t('home.venue.unnamed');
}

export function defaultVenue() {
  return { venue_id: DEFAULT_VENUE_ID, name: '', ...DEFAULT_VENUE, created_at: nowIso(), f_locked: null, tee_lift_m: null, bay_B_m: null, slope_deg: null };
}

export function mountHome(root, app) {
  let venues = [];
  let storedDefault = null; // the default mat keeps its focal lock between sessions
  let presets = [];
  let last = null; // { session, shots }
  let current = 0; // shots in the running session
  let forceOnb = false;
  let preTimer = []; // optional C0/C1 timing before 開始練習 (setup timer, Developer only)
  const save = (patch) => { const s = saveSettings(patch); app.updateSettings?.(s); return s; };
  const onb = createOnboarding(app, {
    onDone: (mode, dest) => {
      forceOnb = false;
      if (dest === 'import') app.nav.go('import');
      else { render(); root.querySelector('h1')?.focus?.({ preventScroll: true }); }
    },
  });

  async function load() {
    if (!app.repo) { venues = []; presets = []; last = null; return; }
    try {
      const vs = await app.repo.venues.list();
      storedDefault = vs.find((v) => v.venue_id === DEFAULT_VENUE_ID) ?? null;
      venues = vs.filter((v) => v.venue_id !== DEFAULT_VENUE_ID);
      presets = await app.repo.presets.list();
      const sess = app.store.get().session;
      const all = (await app.repo.sessions.list()).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const prev = all.find((s) => s.session_id !== sess?.session_id) ?? null;
      last = null;
      if (prev) {
        const shots = (await app.repo.shots.list({ index: 'session_id', query: prev.session_id })).filter((s) => !s.deleted);
        if (shots.length) last = { session: prev, shots: shots.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) };
      }
      // a drill left in progress (repo.drills) becomes app.drill again after a reload (LAUNCH-MONITOR-SPEC §3.5)
      if (!app.drill?.current() && app.repo.drills) app.drill?.set((await app.repo.drills.list()).filter((d) => d.status === 'active').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]);
      current = sess ? (await app.repo.shots.list({ index: 'session_id', query: sess.session_id })).length : 0;
    } catch (e) {
      app.errors?.report?.(e, { where: 'home.load', silent: true });
    }
  }

  const venueById = (id) => venues.find((v) => v.venue_id === id) ?? null;

  function state() {
    const s = app.store.get();
    const st = app.settings();
    const venueId = s.venueId ?? st.lastVenueId ?? venues[0]?.venue_id ?? null;
    const venue = venueById(venueId);
    const view = s.view ?? st.lastView ?? 'face_on';
    const mode = MODES.includes(st.mode) ? st.mode : 'live';
    const presetList = presets.filter((p) => venue && p.venue_id === venue.venue_id && p.view === view).sort((a, b) => String(b.updated_at ?? b.created_at).localeCompare(String(a.updated_at ?? a.created_at)));
    const preset = presetList.find((p) => p.preset_id === s.presetId) ?? presetList[0] ?? null;
    return { s, st, venue, view, mode, presetList, preset };
  }

  function pick(title, options, value, onPick, { footer, testid } = {}) {
    const list = h('div.list-group.sheet-list', { role: 'listbox', 'aria-label': title });
    let sh = null;
    for (const o of options) {
      const sel = o.value === value;
      const row = h('button.list-row.pick-row', { type: 'button', role: 'option', 'aria-selected': sel ? 'true' : 'false', 'data-value': String(o.value), onclick: () => { sh.close(); onPick(o.value); } },
        o.icon ? h('span.lr-icon', {}, icon(o.icon)) : null,
        h('span.lr-text', {}, h('span.lr-title', o.label), o.hint ? h('span.lr-sub', o.hint) : null),
        h('span', { class: `pick-check${sel ? ' on' : ''}` }, sel ? icon('check') : null));
      list.append(row);
    }
    sh = sheet({ title, content: h('div', {}, list, footer ? footer(() => sh.close()) : null), testid });
    sh.open();
  }

  function venueSheet(cur) {
    const opts = [...venues.map((v) => ({ value: v.venue_id, label: venueName(v), hint: dims(v), icon: 'ruler' })),
      { value: '', label: t('home.venue.default'), hint: t('home.venue.default_hint', { dims: dims(DEFAULT_VENUE) }), icon: 'ruler' }];
    pick(t('home.row.venue'), opts, cur?.venue_id ?? '', (v) => { app.store.set({ venueId: v || null, presetId: null }); save({ lastVenueId: v || null }); render(); }, {
      testid: 'home-venue-sheet',
      footer: (close) => h('div.sheet-actions', {},
        button({ label: t('home.venue.add'), variant: 'tinted', size: 'lg', block: true, icon: 'ruler', testid: 'home-venue-add', onClick: () => { close(); app.nav.go('venue'); } }),
        venues.length ? button({ label: t('home.venue.manage'), variant: 'plain', size: 'md', block: true, onClick: () => { close(); app.nav.go('venue', { list: true }); } }) : null),
    });
  }

  function dims(v) {
    return t('home.venue.dims', { L: fmtNum(v.mat_L, { digits: 2 }), W: fmtNum(v.mat_W, { digits: 2 }) });
  }

  function render() {
    const st0 = app.settings();
    const webdriver = Boolean(globalThis.navigator?.webdriver);
    if (needsOnboarding(st0, { webdriver, seam: Boolean(globalThis.__GSL_E2E__?.onboarding), force: forceOnb }) && !app.store.get().sessionActive) {
      root.classList.add('is-onboarding');
      onb.render(root);
      return;
    }
    root.classList.remove('is-onboarding');
    const { s, st, venue, view, mode, presetList, preset } = state();
    const kids = [screenHeader({ title: t('screen.home.title') })];

    if (s.sessionActive) {
      const sv = s.session?.view ?? s.view;
      const sm = s.session?.mode ?? mode;
      kids.push(h('section.card.session-card', { 'data-testid': 'home-session' },
        h('div.sc-head', {}, h('span.sc-dot', { 'aria-hidden': 'true' }), h('h2', t('home.session.title'))),
        h('p.sc-meta', t('home.session.meta', { view: t(`view.${sv}`), mode: t(`mode.${sm}`), n: current })),
        button({ label: t(sm === 'highspeed' ? 'home.session.back_import' : 'home.session.back_live'), variant: 'primary', size: 'lg', block: true, icon: sm === 'highspeed' ? 'film' : 'play', testid: 'home-back-live', onClick: () => app.nav.go(sm === 'highspeed' ? 'import' : 'live') }),
        button({ label: t('home.session.back_setup'), variant: 'secondary', size: 'lg', block: true, icon: 'tripod', onClick: () => app.nav.go('setup') }),
        h('div.sc-end', {}, button({ label: t('home.session.end'), variant: 'destructive', size: 'md', testid: 'home-end', onClick: () => endSession() }))));
    } else {
      const club = CLUBS.find((c) => c[0] === st.club_type) ?? CLUBS[4];
      const rows = h('div.list-group.home-context', { 'data-testid': 'home-context' },
        listRow({ icon: 'ruler', title: t('home.row.venue'), value: venue ? venueName(venue) : t('home.venue.default'), testid: 'home-venue', onClick: () => venueSheet(venue) }),
        listRow({ icon: view === 'dtl' ? 'phone-portrait' : 'phone-landscape', title: t('home.row.view'), value: t(`view.${view}`), testid: 'home-view', onClick: () => pick(t('home.row.view'), VIEWS.map((v) => ({ value: v, label: t(`view.${v}`), hint: t(`view.${v}.hint`), icon: v === 'dtl' ? 'phone-portrait' : 'phone-landscape' })), view, (v) => { app.store.set({ view: v, presetId: null }); save({ lastView: v }); render(); }) }),
        listRow({ icon: 'club', title: t('home.row.club'), value: t(`club.${club[0]}`), testid: 'home-club', onClick: () => pick(t('home.row.club'), CLUBS.map(([c]) => ({ value: c, label: t(`club.${c}`) })), club[0], (v) => { const c = CLUBS.find((x) => x[0] === v); save({ club_type: v, club_length_m: c[1] }); render(); }) }),
        listRow({ icon: mode === 'live' ? 'play' : 'film', title: t('home.row.mode'), value: t(`mode.${mode}`), subtitle: t(`mode.${mode}.hint`), testid: 'home-mode', onClick: () => pick(t('home.row.mode'), MODES.map((m) => ({ value: m, label: t(`mode.${m}`), hint: t(`mode.${m}.hint`), icon: m === 'live' ? 'play' : 'film' })), mode, (v) => { save({ mode: v }); render(); }) }),
        presetList.length > 1 ? listRow({ icon: 'target', title: t('home.row.preset'), value: t('home.preset.label', { date: fmtDate(preset.updated_at ?? preset.created_at) }), testid: 'home-preset', onClick: () => pick(t('home.row.preset'), presetList.map((p) => ({ value: p.preset_id, label: t('home.preset.label', { date: fmtDateTime(p.updated_at ?? p.created_at) }), hint: t('home.preset.revision', { n: p.revision ?? 1 }) })), preset.preset_id, (v) => { app.store.set({ presetId: v }); render(); }) }) : null);
      kids.push(rows);
      kids.push(h('p.hint.home-context-hint', venue ? (preset ? t('home.hint.preset', { date: fmtDate(preset.updated_at ?? preset.created_at) }) : t('home.hint.new_preset')) : t('home.hint.default_venue', { dims: dims(DEFAULT_VENUE) })));
      const noCam = !globalThis.navigator?.mediaDevices?.getUserMedia;
      const start = button({ label: t('home.start'), variant: 'primary', size: 'lg', block: true, icon: 'play', id: 'start-practice', testid: 'btn-start-practice', reason: noCam ? t('home.start_no_camera') : null, onClick: () => startPractice() });
      kids.push(button({ label: t('home.import'), variant: 'tinted', size: 'lg', block: true, icon: 'film', testid: 'nav-import', onClick: () => app.nav.go('import') }));
      if (st.dev) kids.push(timerCard());
      kids.push(h('div.home-cta', {}, start));
    }

    // 0.4.0 entries (V04-SPEC §F.5): virtual course and swing lab (lazy screens)
    kids.push(h('div.list-group', {}, drillsRow(),
      listRow({ icon: 'flag', title: t('home.course'), subtitle: t('home.course_hint'), testid: 'home-course', onClick: () => app.nav.go('course') }),
      listRow({ icon: 'level', title: t('home.lab'), subtitle: t('home.lab_hint'), testid: 'home-lab', onClick: () => app.nav.go('lab') })));
    if (last) kids.push(lastCard());
    kids.push(h('h2.section-title', t('home.more')));
    kids.push(h('div.list-group.home-more', {},
      // History and Settings are tabs (tabbar-history / tabbar-settings); Diagnostics and About live under Settings (§2.1)
      listRow({ icon: 'ruler', title: t('home.more.venue'), testid: 'nav-venue', onClick: () => app.nav.go('venue') })));
    if (!app.repo) kids.push(notice({ variant: 'caution', title: t('home.no_repo.title'), body: t('home.no_repo.body'), testid: 'home-no-repo' }));
    clear(root, ...kids);
  }

  function drillsRow() {
    // 練習模式 (LAUNCH-MONITOR-SPEC §3.1, §3.5): the drills screen; a drill in progress shows its count
    const d = app.drill?.current();
    const done = d?.slots?.filter((x) => x.shot_id).length;
    return listRow({ icon: 'target', title: t('home.drills'), subtitle: d ? t('home.drills_resume', { done, total: d.slots.length }) : t('home.drills_hint'), testid: 'home-drills', onClick: () => app.nav.go('drills') });
  }

  function lastCard() {
    const { session, shots } = last;
    const tempos = shots.map((x) => x.metrics?.tempo_ratio?.value).filter(Number.isFinite);
    const carries = shots.map((x) => x.metrics?.carry_m).filter((m) => Number.isFinite(m?.value));
    const best = carries.sort((a, b) => b.value - a.value)[0] ?? null;
    const units = app.units();
    const stat = (label, value) => h('div.stat', {}, h('span.stat-value', value), h('span.stat-label', label));
    const v = venueById(session.venue_id);
    return h('section.card.last-card', { 'data-testid': 'home-last' },
      h('div.card-head', {}, h('h2', t('home.last.title')), h('span.card-meta', [fmtDateTime(session.created_at), v ? venueName(v) : null, session.view ? t(`view.${session.view}`) : null].filter(Boolean).join(' · '))),
      h('div.stats', {},
        stat(t('home.last.shots'), fmtNum(shots.length)),
        stat(t('home.last.tempo'), tempos.length ? fmtNum(tempos.reduce((a, b) => a + b, 0) / tempos.length, { digits: 1 }) : '—'),
        stat(t('home.last.carry'), best ? fmtMetric(best, units, { id: 'carry_m' }).text : '—')),
      h('div.list-group.last-shots', {}, shots.slice(0, 3).map((x) => {
        const tm = x.metrics?.tempo_ratio;
        const cs = x.metrics?.club_speed_mps;
        const parts = [Number.isFinite(cs?.value) ? fmtMetric(cs, units, { id: 'club_speed_mps' }).text : null, Number.isFinite(tm?.value) ? t('home.last.tempo_value', { v: fmtNum(tm.value, { digits: 1 }) }) : null].filter(Boolean);
        return listRow({ icon: 'club', title: parts.join(' · ') || t('home.last.no_numbers'), subtitle: [fmtDateTime(x.created_at, { date: false }), x.club?.type ? t(`club.${x.club.type}`) : null].filter(Boolean).join(' · '), onClick: () => app.nav.go('shot', { shot_id: x.shot_id }) });
      })),
      button({ label: t('home.last.all'), variant: 'plain', size: 'md', icon: 'history', onClick: () => app.nav.go('history') }));
  }

  function timerCard() {
    const now = () => performance.now() / 1000;
    const nextStep = preTimer.length === 0 ? 'start' : preTimer.length === 1 ? 'C0' : preTimer.length === 2 ? 'C1' : null;
    return h('section.card.dev-card', {},
      h('h2', t('home.dev.timer')),
      button({ label: nextStep ? t(`home.dev.timer_${nextStep}`) : t('home.dev.timer_done'), size: 'md', disabled: !nextStep, onClick: () => { if (nextStep) { preTimer.push({ step: nextStep, t_s: now() }); render(); } } }),
      h('p.hint', preTimer.length ? preTimer.map((e) => e.step).join(' → ') : t('home.dev.timer_hint')));
  }

  function startPractice() {
    // P2: synchronous call from the click handler — nothing is awaited before startPractice()
    const { venue: chosen, view, mode, preset } = state();
    const venue = chosen ?? storedDefault ?? defaultVenue();
    const p = app.controller.startPractice({ venue, preset, view, mode, preEvents: preTimer.slice() });
    preTimer = [];
    app.store.set({ venueId: chosen?.venue_id ?? null, presetId: preset?.preset_id ?? null, view });
    app.current = { venue, preset, view, mode };
    app.nav.go('setup');
    if (venue.venue_id === DEFAULT_VENUE_ID && app.repo) app.repo.venues.put(venue).catch(() => {});
    Promise.resolve(p).catch((e) => app.errors?.report?.(e, { where: 'home.start' }));
  }

  async function endSession() {
    if (current > 0) {
      const ok = await confirmSheet({ title: t('home.end.title'), consequence: t('home.end.body', { n: current }), confirmLabel: t('home.session.end'), destructive: true, testid: 'home-end-confirm' });
      if (!ok) return;
    }
    await app.controller.endSession();
    app.updater?.sessionEnded();
    await load();
    render();
  }

  return {
    async show(params = {}) {
      if (params?.onboarding) { forceOnb = true; onb.reset(); }
      render();
      await load();
      if (!root.classList.contains('is-onboarding')) render();
    },
    hide() {},
  };
}
