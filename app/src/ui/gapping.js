// ui/gapping.js — distance gaps per club (LM-F; LAUNCH-MONITOR-SPEC §3.8). Lazy screen 'gapping' under the History tab.
// One shared distance axis (tick labels, unit) above the rows; one row per club (testid gapping-row, data-club,
// data-flag): carry median (estimated, ◐) ± its 95 % uncertainty (≈ 1.96 · 1.2533 · SD / √n, n ≥ 3) as a dot on that
// axis with the P10–P90 span shaded (only from 3 shots; no full-length track), total median, n, the gap to the next
// shorter club. Flags: too few shots (n < 5), gap
// smaller than settings.lm.gapMin or larger than gapMax (rule of thumb, adjustable). Source: face-on shots; the switch
// adds high-behind carry (low confidence), marked with a different point shape (▲) on the bar. Mishits are left out
// when settings.lm.excludeMishits is on. CSV export (testid gapping-csv): ASCII only, metres, header GAPPING_CSV_COLUMNS.
import { h, clear } from './dom.js';
import * as C from './components.js';
import { t, plural, fmtNum } from '../i18n/index.js';
import { fmtMetric } from '../i18n/units.js';
import { clubName } from './glossary.js';
// ◐ in span.glyph-est (half disc in app.css; the font's ◐ read like "‹" at caption size), as ui/tiles.js halfGlyph
const halfGlyph = (s) => String(s).split(/(◐)/).filter(Boolean).map((x) => (x === '◐' ? h('span.glyph-est', {}, x) : x));
import { historySeg, loadedShots, shotOps, shareOrDownload, fileStamp } from './history.js';
import { gapping, gappingCSV } from '../store/stats.js';
import { distUnit, unitText, ticks } from '../viz/draw.js';

const MIN_BAND_N = 3;
const spanOk = (c) => c.n >= MIN_BAND_N && Number.isFinite(c.p10) && Number.isFinite(c.p90);
/** 95 % half-width of the median (normal approximation: SE(median) ≈ 1.2533 · SD / √n), metres; null below 3 shots. */
export const medianPm = (c) => (c.n >= MIN_BAND_N && c.sd_obs > 0 ? (1.96 * 1.2533 * c.sd_obs) / Math.sqrt(c.n) : null);

export function mountGapping(root, app) {
  let shots = [];
  let includeHB = false;
  const ops = shotOps(app);
  const units = () => app.units?.() ?? undefined;
  const lm = () => app.settings?.()?.lm ?? {};
  const fmt = (v) => fmtMetric({ value: v, unit: 'm' }, units(), { id: 'carry_m' }).text;

  async function load() {
    const all = app.repo ? await app.repo.queryShots({ reverse: true }) : [];
    shots = all.filter((s) => !ops.isDeleted(s));
  }

  const rows = () => gapping(shots, { includeHB, gapMin: lm().gapMin, gapMax: lm().gapMax, excludeMishits: lm().excludeMishits !== false });

  /** The shared axis in display units: pos(metres) → '%', tick values inside the edges, unit label. */
  function scale(list) {
    const { f, key } = distUnit(units());
    const xs = list.flatMap((r) => (spanOk(r.carry) ? [r.carry.p10, r.carry.p90] : [r.carry.median]).concat(r.carry_hb?.median)).filter(Number.isFinite).map((x) => x * f);
    const pad = Math.max(5, (Math.max(...xs) - Math.min(...xs)) * 0.08);
    const lo = Math.min(...xs) - pad;
    const hi = Math.max(...xs) + pad;
    const frac = (v) => (v - lo) / (hi - lo);
    const pos = (m) => `${(Math.max(0, Math.min(1, frac(m * f))) * 100).toFixed(1)}%`;
    return { pos, ticks: ticks(lo, hi, 6).list.filter((v) => frac(v) > 0.05 && frac(v) < 0.95).map((v) => [fmtNum(v), `${(frac(v) * 100).toFixed(1)}%`]), unit: unitText(key) };
  }

  function bar(r, S) {
    const grid = S.ticks.map(([, left]) => h('span.gap-grid', { style: { left } }));
    const band = spanOk(r.carry) ? h('span.gap-band', { style: { left: S.pos(r.carry.p10), width: `calc(${S.pos(r.carry.p90)} - ${S.pos(r.carry.p10)})` } }) : null;
    const dot = r.carry.n ? h('span.gap-dot', { style: { left: S.pos(r.carry.median) } }) : null;
    const tri = r.carry_hb?.n ? h('span.gap-tri', { style: { left: S.pos(r.carry_hb.median) } }) : null;
    return h('span.gap-bar', { 'aria-hidden': 'true' }, grid, band, dot, tri);
  }

  function row(r, S) {
    const flags = r.flags.map((x) => h(`span.gap-flag.${x === 'small_sample' ? 'is-few' : 'is-gap'}`, t(`gapping.flag.${x}`)));
    const gap = r.gap_next_m === null ? null : t('gapping.gap', { v: fmt(r.gap_next_m) });
    // no range when it would read 198 – 198 (all shots the same after rounding)
    const range = spanOk(r.carry) && fmt(r.carry.p10) !== fmt(r.carry.p90) ? t('gapping.range', { lo: fmt(r.carry.p10), hi: fmt(r.carry.p90) }) : null;
    const pm = medianPm(r.carry);
    const total = r.total.n ? t('gapping.total', { v: fmt(r.total.median) }) : null;
    return h('li.gap-row', { 'data-testid': 'gapping-row', 'data-club': r.club ?? '', 'data-flag': r.flag ?? '' },
      h('div.gap-head', {}, h('span.gap-club', clubName(r.club)),
        h('span.gap-carry', {}, h('span.mt-num', fmt(r.carry.median)), ' ', h(`span.dt-est.vtag.vtag-${r.n_hb ? 'low' : 'est'}`, {}, ...halfGlyph(t(r.n_hb ? 'gapping.est_low' : 'gapping.est'))))),
      bar(r, S),
      h('p.gap-sub', [pm === null ? null : t('gapping.median_ci', { v: fmt(pm) }), range, total, plural('gapping.n', r.n), r.n_hb ? t('gapping.n_hb', { n: r.n_hb }) : null, gap].filter(Boolean).join(' · ')),
      flags.length ? h('p.gap-flags', {}, flags) : null);
  }

  function render() {
    const list = rows();
    const head = C.screenHeader({ title: app.screenTitle('gapping'), back: true, onBack: () => app.nav.back() });
    const hb = C.switchRow({ label: t('gapping.include_hb'), hint: t('gapping.include_hb_hint'), checked: includeHB, testid: 'gapping-include-hb',
      onChange: (on) => { includeHB = on; render(); } });
    if (!list.length) {
      clear(root, head, historySeg(app, 'gapping'), hb, C.emptyState({ icon: 'history', title: t('gapping.empty.title'), body: t('gapping.empty.body'), testid: 'gapping-empty' }));
      return;
    }
    const S = scale(list);
    const out = h('div.export-out', { 'aria-live': 'polite' });
    const csv = C.button({ label: t('gapping.csv'), icon: 'download', variant: 'secondary', size: 'lg', block: true, testid: 'gapping-csv',
      onClick: () => shareOrDownload(new Blob([gappingCSV(list)], { type: 'text/csv;charset=utf-8' }), `golf-swing-lab-gapping-${fileStamp()}.csv`, out, { title: t('gapping.csv') }) });
    clear(root, head, historySeg(app, 'gapping'),
      h('p.hint', t('gapping.intro')),
      hb,
      h('p.gap-axis-unit', t('gapping.axis', { unit: S.unit })),
      h('div.gap-axis', { 'aria-hidden': 'true' }, S.ticks.map(([v, left]) => h('span.gap-tick', { style: { left } }, v))),
      h('ul.gap-rows', {}, list.map((r) => row(r, S))),
      h('p.hint', t('gapping.legend', { min: fmt(lm().gapMin), max: fmt(lm().gapMax) })),
      csv, out);
  }

  app.e2e?.registerState?.('gapping', 'hb', async () => { includeHB = true; render(); });

  return {
    async show() {
      const cached = loadedShots();
      if (cached) { shots = cached; render(); }
      else clear(root, C.screenHeader({ title: app.screenTitle('gapping'), back: true, onBack: () => app.nav.back() }), h('p.hint', t('common.loading')));
      try { await load(); } catch (e) { app.errors?.report?.(e, { where: 'gapping.load' }); }
      render();
    },
  };
}
