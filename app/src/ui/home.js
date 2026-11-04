// ui/home.js — home screen: venue / preset picker (P15), 開始練習 (P2), 匯入影片, 歷史, 診斷, 設定.

import { h, clear, select, field, card, toast } from './dom.js';
import { VIEW_LABELS, MODE_LABELS } from './format.js';
import { CLUBS, saveSettings } from '../session/settings.js';
import { DEFAULT_VENUE } from '../calib/mat.js';
import { nowIso } from '../session/ids.js';

export function mountHome(root, app) {
  let venues = [];
  let presets = [];
  let preTimer = []; // optional C0/C1 timing before 開始練習 (KD3 setup timer)

  async function load() {
    if (!app.repo) { venues = []; presets = []; return; }
    try {
      venues = await app.repo.venues.list();
      presets = await app.repo.presets.list();
    } catch (e) {
      toast(`讀取資料失敗：${e.message}`);
    }
  }

  function chosenVenue(id) {
    return venues.find((v) => v.venue_id === id) ?? null;
  }

  function render() {
    const s = app.store.get();
    const st = app.settings();
    const venueId = s.venueId ?? st.lastVenueId ?? venues[0]?.venue_id ?? null; // P15: preselect the last venue
    const view = s.view ?? st.lastView ?? 'face_on';
    const vSel = select([...venues.map((v) => [v.venue_id, v.name || v.venue_id]), ['', venues.length ? '（不指定）' : '（尚未建立場地，暫用預設墊子 1.50×1.25m）']], venueId ?? '', { id: 'home-venue' });
    const viewSel = select(Object.entries(VIEW_LABELS), view, { id: 'home-view' });
    const presetFor = (vid, vw) => presets.filter((p) => p.venue_id === vid && p.view === vw).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    const pSel = h('select', { id: 'home-preset' });
    const fillPresets = () => {
      const list = presetFor(vSel.value, viewSel.value);
      clear(pSel, ...list.map((p, i) => h('option', { value: p.preset_id, selected: i === 0 }, `預設 ${String(p.created_at).slice(0, 10)}（第 ${p.revision} 版）`)), h('option', { value: '' }, '新的預設（第一次在這個打位）'));
    };
    fillPresets();
    vSel.onchange = () => { app.store.set({ venueId: vSel.value || null }); saveSettings({ lastVenueId: vSel.value || null }); fillPresets(); };
    viewSel.onchange = () => { app.store.set({ view: viewSel.value }); saveSettings({ lastView: viewSel.value }); fillPresets(); };
    const modeSel = select(Object.entries(MODE_LABELS), st.mode, { id: 'home-mode', onchange: (e) => saveSettings({ mode: e.target.value }) });
    const clubSel = select(CLUBS.map(([t, label]) => [t, label]), st.club_type, {
      id: 'home-club',
      onchange: (e) => { const c = CLUBS.find((x) => x[0] === e.target.value); saveSettings({ club_type: c[0], club_length_m: c[2] }); },
    });

    const start = h('button.primary.big', { type: 'button', id: 'start-practice', 'data-testid': 'btn-start-practice' }, '開始練習');
    start.addEventListener('click', () => {
      // P2: synchronous call from the click handler — nothing is awaited before startPractice()
      let venue = chosenVenue(vSel.value);
      if (!venue) venue = { venue_id: 'venue-default', name: '預設墊子', ...DEFAULT_VENUE, created_at: nowIso(), f_locked: null, tee_lift_m: null, bay_B_m: null, slope_deg: null };
      const preset = presets.find((p) => p.preset_id === pSel.value) ?? null;
      const p = app.controller.startPractice({ venue, preset, view: viewSel.value, mode: modeSel.value, preEvents: preTimer.slice() });
      preTimer = [];
      app.store.set({ venueId: venue.venue_id, presetId: preset?.preset_id ?? null, view: viewSel.value });
      app.current = { venue, preset, view: viewSel.value, mode: modeSel.value };
      app.nav.go('setup');
      if (venue.venue_id === 'venue-default' && app.repo && !venues.length) app.repo.venues.put(venue).catch(() => {});
      p.then((r) => app.store.set({ status: r.ok ? '權限已取得，開始架設。' : '相機無法使用：請改用高速模式匯入影片。' }));
    });

    const t = () => performance.now() / 1000;
    const timerText = h('span.hint', preTimer.length ? `已計時：${preTimer.map((e) => e.step).join(' → ')}` : '（選用）裝機前先按，架設時間才包含 C0 裝機與 C1 定位');
    const preNext = preTimer.length === 0 ? 'start' : preTimer.length === 1 ? 'C0' : preTimer.length === 2 ? 'C1' : null;
    const preBtn = h('button', { type: 'button', disabled: !preNext }, preNext === 'start' ? '開始架設計時' : preNext === 'C0' ? 'C0 裝機完成' : preNext === 'C1' ? 'C1 物理定位完成' : '已完成 C0、C1');
    preBtn.addEventListener('click', () => { if (preNext) { preTimer.push({ step: preNext, t_s: t() }); render(); } });
    const timerCard = s.sessionActive ? null : card('架設計時', h('div.row', {}, preBtn), timerText);
    const sessionCard = s.sessionActive
      ? card('練習進行中',
        h('p', `角度：${VIEW_LABELS[s.view] ?? s.view}`),
        h('div.row', {},
          h('button', { type: 'button', onclick: () => app.nav.go('setup') }, '回到架設'),
          h('button', { type: 'button', onclick: () => app.nav.go('live') }, '回到即時模式'),
          h('button.danger', { type: 'button', onclick: async () => { await app.controller.endSession(); app.updater?.sessionEnded(); render(); } }, '結束練習')))
      : null;

    clear(root,
      h('header.screen-header', {}, h('h1', '揮桿實驗室')),
      sessionCard,
      card('這次練習',
        field('場地', vSel, venues.length ? '同一練習場不同打位＝同場地、不同預設' : '第一次到場地請先「新增場地」量墊子'),
        field('角度', viewSel),
        field('機位預設', pSel),
        field('模式', modeSel),
        field('球桿', clubSel),
        s.sessionActive ? null : start),
      timerCard,
      h('nav.menu', {},
        h('button', { type: 'button', 'data-testid': 'nav-venue', onclick: () => app.nav.go('venue') }, '新增場地（P1）'),
        h('button', { type: 'button', 'data-testid': 'nav-import', onclick: () => app.nav.go('import') }, '匯入影片'),
        h('button', { type: 'button', 'data-testid': 'nav-history', onclick: () => app.nav.go('history') }, '歷史'),
        h('button', { type: 'button', 'data-testid': 'nav-diag', onclick: () => app.nav.go('diag') }, '診斷'),
        h('button', { type: 'button', 'data-testid': 'nav-settings', onclick: () => app.nav.go('settings') }, '設定'),
        h('button', { type: 'button', 'data-testid': 'nav-about', onclick: () => app.nav.go('about') }, '關於')),
      app.repo ? null : h('p.warn', '無法開啟本機資料庫：結果不會被保存（私密瀏覽模式？）'));
  }

  return {
    async show() { render(); await load(); render(); },
    hide() {},
  };
}
