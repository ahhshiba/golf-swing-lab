// ui/patterns.js — fault trends (V04-SPEC §E.4): period × view filter, one row per fault × view with per-session shares
// and Wilson intervals (viz drawBars whiskers), the 3 most common faults. Lazy screen 'patterns' (History tab, segment
// `patterns` of history-seg; styles/screens/lab.css). Owner V4-F.
//
// Data: the golf-lab/1 records of repo.lab; shots without a current record (new, or an older LAB_PARAMS.version) are
// analysed here first (lab/faults.js, poses when stored), at most ANALYSE_MAX per visit, newest first. Views are never
// merged: each fault is counted only on the swings of a view that can see it (unknown never counts). "Fewer / more" only
// when the latest session's interval does not overlap the earlier sessions' (lab/trends.js).
// testids: history-seg (data-seg=patterns), patterns-period, patterns-view, patterns-top, patterns-row (data-fault,
// data-view), patterns-n, patterns-ci, patterns-change, patterns-chart, patterns-empty, patterns-progress.
import { h, clear } from './dom.js';
import * as C from './components.js';
import { t, fmtNum } from '../i18n/index.js';
import { viewName } from './glossary.js';
import { historySeg, loadedShots } from './history.js';
import { faultTrends, MIN_CHANGE_N } from '../lab/trends.js';
import { evaluateFaults } from '../lab/faults.js';
import { LAB_PARAMS } from '../lab/params.js';
import { normalizeLab } from '../lab/settings.js';

export const ANALYSE_MAX = 300;
const PERIODS = { d7: 7, d30: 30, all: null };
const pct = (x) => fmtNum(100 * x, { digits: 0 });

export function mountPatterns(root, app) {
  let shots = [];
  let records = [];
  let filt = { period: 'all', view: '' };
  let seq = 0;

  const header = () => C.screenHeader({ title: app.screenTitle('patterns'), back: true, onBack: () => app.nav.back() });

  async function load(progress) {
    if (!app.repo) { shots = []; records = []; return; }
    shots = loadedShots() ?? (await app.repo.queryShots({ reverse: true }));
    shots = shots.filter((s) => !s.deleted_at && !s.deleted);
    let recs = [];
    try { recs = await app.repo.lab.list(); } catch (_) { recs = []; }
    const have = new Map(recs.filter((r) => r?.algo?.version === LAB_PARAMS.version).map((r) => [r.shot_id, r]));
    const todo = shots.filter((s) => !have.has(s.shot_id) && s.capture?.view).slice(0, ANALYSE_MAX);
    const settings = normalizeLab(app.settings?.()?.lab);
    const fresh = [];
    for (let i = 0; i < todo.length; i++) {
      const s = todo[i];
      if (i % 10 === 0) { progress?.(i, todo.length); await new Promise((r) => setTimeout(r, 0)); }
      let poseSeq = null;
      try { poseSeq = await app.repo.poses.get(s.shot_id); } catch (_) { /* metrics only */ }
      try {
        const rec = evaluateFaults({ shot: s, poseSeq, view: s.capture.view, fps: s.capture.nominal_fps ?? 30, settings });
        fresh.push(rec);
        have.set(s.shot_id, rec);
      } catch (e) { app.errors?.report?.(e, { where: 'patterns.analyse', silent: true }); }
    }
    if (fresh.length) {
      try { await (app.repo.lab.putMany ? app.repo.lab.putMany(fresh) : Promise.all(fresh.map((r) => app.repo.lab.put(r)))); } catch (e) { app.errors?.report?.(e, { where: 'patterns.store', silent: true }); }
    }
    const ids = new Set(shots.map((s) => s.shot_id));
    records = [...have.values()].filter((r) => ids.has(r.shot_id));
  }

  function filters() {
    const period = C.segmented({ options: Object.keys(PERIODS).map((k) => [k, t(`patterns.period.${k.replace('d', '')}`)]), value: filt.period, label: t('patterns.period.label'), testid: 'patterns-period',
      onChange: (v) => { filt = { ...filt, period: v }; render(); } });
    const views = ['face_on', 'dtl', 'high_behind'].filter((v) => records.some((r) => r.view === v));
    const view = C.chipRow({ items: [['', t('patterns.view.all')], ...views.map((v) => [v, viewName(v)])], value: filt.view, label: t('patterns.view.label'), testid: 'patterns-view',
      onChange: (v) => { filt = { ...filt, view: v }; render(); } });
    return h('div.patterns-filters', {}, period, view);
  }

  function row(r, byId) {
    const cv = h('canvas.patterns-canvas', { 'data-testid': 'patterns-chart', role: 'img' });
    const change = r.change ? t(`patterns.${r.change}`) : r.few ? t('patterns.too_few', { min: MIN_CHANGE_N }) : t('patterns.no_change');
    const el = h('section.card.patterns-row', { 'data-testid': 'patterns-row', 'data-fault': r.id, 'data-view': r.view },
      h('h2', {}, h('span', t(`fault.${r.id}`)), h('span.patterns-view-name', viewName(r.view))),
      h('p.patterns-n', { 'data-testid': 'patterns-n' }, t('patterns.n', { k: r.k, n: r.n, s: r.sessions.length })),
      h('p.patterns-ci', { 'data-testid': 'patterns-ci' }, t('patterns.ci', { p: pct(r.p), lo: pct(r.lo), hi: pct(r.hi) })),
      h('p.patterns-change', { 'data-testid': 'patterns-change', 'data-change': r.change ?? 'none' }, change),
      cv);
    return { el, cv, r, byId };
  }

  async function drawCharts(items, my) {
    let V;
    try { V = await import('../viz/charts.js'); } catch (_) { return; }
    let P;
    try { P = (await import('../viz/palette.js')).vizPalette(root); } catch (_) { return; }
    let md;
    try { md = new Intl.DateTimeFormat(app.locale?.() ?? undefined, { month: 'numeric', day: 'numeric' }); } catch (_) { md = { format: (d) => d.toISOString().slice(5, 10) }; }
    for (const { cv, r } of items) {
      if (my !== seq || !cv.isConnected) return;
      // each bar says how many swings it is (a 100 % over one swing is not a 100 % over twenty)
      const bars = r.sessions.map((s) => ({ label: t('patterns.bar', { d: md.format(new Date(s.at)), n: s.n }), value: 100 * s.p, lo: 100 * s.lo, hi: 100 * s.hi, validity: 'estimated', series: 0 }));
      try {
        const res = V.drawBars(cv, { bars, palette: P, unit: '%', axisTitle: t('patterns.axis') });
        cv.setAttribute('aria-label', `${t(res.a11y, res.params)} ${t('patterns.chart_note')}`);
        cv.dataset.vizParams = JSON.stringify(res.params);
      } catch (e) { app.errors?.report?.(e, { where: 'patterns.chart', silent: true }); }
    }
  }

  function render() {
    const my = ++seq;
    const T = faultTrends(records, { days: PERIODS[filt.period], view: filt.view || null, shots });
    if (!records.length || !T.rows.length) {
      clear(root, header(), historySeg(app, 'patterns'), records.length ? filters() : null,
        C.emptyState({ icon: 'history', title: t('patterns.empty.title'), body: t('patterns.empty.body'), testid: 'patterns-empty' }));
      return;
    }
    const top = T.top.length ? h('section.card.patterns-top', { 'data-testid': 'patterns-top' }, h('h2', t('patterns.top')),
      h('ol.patterns-top-list', {}, T.top.map((id) => {
        const best = T.rows.filter((r) => r.id === id).sort((a, b) => b.p - a.p)[0];
        return h('li', { 'data-fault': id }, h('span', t(`fault.${id}`)), ' ', h('span.patterns-top-p', t('patterns.top_share', { p: pct(best.p), view: viewName(best.view) })));
      }))) : null;
    const rows = T.rows.filter((r) => r.k > 0 || filt.view).sort((a, b) => b.p - a.p);
    const quiet = T.rows.filter((r) => !rows.includes(r));
    const items = rows.map((r) => row(r));
    clear(root, header(), historySeg(app, 'patterns'), filters(),
      h('p.hint.patterns-note', t('patterns.note')),
      top, ...items.map((x) => x.el),
      quiet.length ? h('details.card.patterns-quiet', {}, h('summary', t('patterns.quiet', { n: quiet.length })),
        h('ul', {}, quiet.map((r) => h('li', { 'data-testid': 'patterns-row', 'data-fault': r.id, 'data-view': r.view },
          `${t(`fault.${r.id}`)} · ${viewName(r.view)} · `, h('span', { 'data-testid': 'patterns-n' }, t('patterns.n', { k: r.k, n: r.n, s: r.sessions.length })), ' · ',
          h('span', { 'data-testid': 'patterns-ci' }, t('patterns.ci', { p: pct(r.p), lo: pct(r.lo), hi: pct(r.hi) })))))) : null);
    requestAnimationFrame(() => drawCharts(items, my));
  }

  // redraw the bitmaps when the theme or the text size changes
  let timer = 0;
  const again = () => { clearTimeout(timer); timer = setTimeout(() => { if (!root.hidden && records.length) render(); }, 150); };
  new MutationObserver(again).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });

  return {
    async show() {
      const status = h('p.hint', { 'data-testid': 'patterns-progress', role: 'status' }, t('common.loading'));
      clear(root, header(), historySeg(app, 'patterns'), status);
      try {
        await load((i, n) => { status.textContent = t('patterns.analysing', { i, n }); });
      } catch (e) { app.errors?.report?.(e, { where: 'patterns.load' }); records = []; }
      render();
    },
  };
}
