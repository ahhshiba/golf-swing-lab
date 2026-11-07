// ui/quickcard.js — the quick-read card on the live screen (V04-SPEC §A.2, §A.4; owner V4-B). Lazy: ui/live.js imports it
// when a session starts (never in the boot graph).
//
//   mountQuickCard(el, app, { focus?() -> metric id }?) -> { provisional(r), refined(shot, { quick?, hold? }?) -> boolean, clear(), drop(r),
//                                gappingRow(club) -> row | null, demo(stage) }
//
// The card takes the place of the live hero tiles (el = the .live-hero container): the same big numbers, so a quick read
// is on screen where the shot's numbers will be. provisional(r): tiles for the hero metrics the quick read has (settings
// live.metrics, default tempo, club speed, carry; up to 3), each with the 速報 tag, its ± range (.mt-ci, from the ci95)
// and, for carry, where the number comes from (from your swing / your gapping / typical player: §A.4 a prior is never
// called measured). refined(shot): the same card turns into the full analysis in place (data-stage="refined"; full
// numbers without ±, like the 0.3.0 hero: the shot screen has them); a number that changed shows "quick 41 → full 43"
// once and fades after 2 s (reduced motion: removed without a fade; at 200 % text it is not shown, see practice.css); a
// metric the full analysis cannot give in live mode (carry needs the slow-motion import) keeps the quick value and its
// 速報 tag. A refined shot of an older swing (a newer quick read is on screen) leaves the card alone (returns false).
// data-testid="quick-card", data-stage="provisional"|"refined", data-t-impact = the quick read's impact time (media s).
// gappingRow(club): the player's distance-table row of that club (store/stats.js gapping(), face-on shots, n ≥ 5) or
// null, loaded once in the background when the card mounts.
//
//   attachQuick(el, app, live() -> { focus, clip, banner, video, empty(null) }) -> Promise<card & { tap }>
// What ui/live.js needs in one lazy import: the card plus the live loop's quick tap (quick/live.js) wired to
// quick/estimate.js (view, club, handedness, calibration from the session's clip options; the distance-table row of
// the current club), painting each quick read here and on the round banner (banner().quick(r), V4-D) and returning
// the time after that frame was painted (rAF + task) for the latency log; mediaNow = the live <video> position.
import { h, clear } from './dom.js';
import { t, list } from '../i18n/index.js';
import { fmtMetric } from '../i18n/units.js';
import { RC } from '../contract/reason-codes.js';

const QUICK_IDS = Object.freeze(['tempo_ratio', 'backswing_s', 'downswing_s', 'club_speed_mps', 'carry_m']);
const CHANGE_MS = 2000;
const HERO_N = 2;

/** Hero ids of the card: settings.live.metrics (default tempo, club speed, carry) that the quick read can have, 1–3. */
export function quickIds(settingsLive) {
  const want = Array.isArray(settingsLive?.metrics) && settingsLive.metrics.length ? settingsLive.metrics : ['tempo_ratio', 'club_speed_mps', 'carry_m'];
  const ids = want.filter((id) => QUICK_IDS.includes(id)).slice(0, 3);
  return ids.length ? ids : ['tempo_ratio'];
}

const reduced = () => { try { return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true; } catch (_) { return false; } };

export async function attachQuick(el, app, live = () => ({})) {
  const [{ quickEstimate }, { createQuickTap }] = await Promise.all([import('../quick/estimate.js'), import('../quick/live.js')]);
  // the live screen's current state: { focus, clip (its clip options), banner, video, empty(null) (repaint the hero) }
  const clip = () => live().clip ?? {};
  const banner = () => live().banner;
  const card = mountQuickCard(el, app, { focus: () => live().focus });
  const paint = (r) => {
    card.provisional(r);
    try { banner?.()?.quick(r); } catch (_) { /* the banner is V4-D's */ }
    return new Promise((res) => requestAnimationFrame(() => setTimeout(() => res(performance.now()), 0)));
  };
  card.tap = createQuickTap({
    estimate: quickEstimate,
    input: () => {
      const c = clip?.() ?? {};
      return { view: c.view ?? 'face_on', club: c.club ?? null, handedness: c.handedness ?? 'right', calibration: c.calibration ?? null, gappingRow: card.gappingRow(c.club), settings: app.settings?.() ?? {}, fps: 30 };
    },
    geom: () => { const c = clip?.() ?? {}; return { calibration: c.calibration ?? null, handedness: c.handedness ?? 'right' }; },
    onProvisional: paint,
    onDrop: (r) => { if (card.drop(r)) live().empty?.(null); },
    mediaNow: () => live().video?.currentTime,
  });
  return card;
}

export function mountQuickCard(el, app, { focus } = {}) {
  let cur = null; // the QuickResult on screen
  let stage = null;
  let fadeTimer = 0;
  let rows = null;
  const units = () => app.units?.();
  // the settings' quick ids, with the live screen's nav focus metric (V4-F practice card) first when there is one
  const cardIds = () => { const f = focus?.(); const q = quickIds(app.settings?.().live); return f ? [f, ...q.filter((x) => x !== f)].slice(0, 3) : q; };

  // the distance table, once (lazy store/stats.js; face-on shots only, the Gapping screen's default)
  (async () => {
    try {
      if (!app.repo?.queryShots) return;
      const [{ gapping }, shots] = await Promise.all([import('../store/stats.js'), app.repo.queryShots({ reverse: true })]);
      rows = gapping((shots ?? []).filter((s) => !s.deleted_at), {});
    } catch (_) { rows = null; }
  })();

  function sourceText(r) {
    if (!r?.carry_source) return null;
    return r.carry_source === 'pose' && r.carry_merge ? `${t('quick.source.pose')} + ${t('quick.source.gapping')}` : t(`quick.source.${r.carry_source}`);
  }

  // the first HERO_N metrics as hero tiles (the 0.3.0 live hero size), the rest as one compact line each (carry by
  // default: the least certain number gets the smaller type, and the live glance targets still fit at 200 % text)
  function tile(id, metric, tileStage, extra = {}, i = 0) {
    const f = fmtMetric(metric ?? null, units(), { id });
    // a null says why (its first reason code after PROVISIONAL)
    const rc = f.value === '—' ? (metric?.reason_codes ?? []).find((c) => c !== RC.PROVISIONAL) : null;
    // a metric the quick read does not compute at all (a nav focus metric): no 速報 tag, it comes with the full analysis
    const none = !metric && tileStage === 'provisional';
    const note = extra.note ?? (none ? t('quick.not_quick') : rc ? t(`reason.${rc}.short`) : null);
    const mini = i >= HERO_N;
    return h('div', { class: `hero-tile qc-tile${mini ? ' qc-mini' : ''}`, 'data-metric': id, 'data-stage': none ? 'none' : tileStage },
      h('span.hero-label', {}, h('span', {}, t(`metric.${id}.label`)), none ? null : h(`span.qc-tag.qc-${tileStage}`, {}, t(`quick.${tileStage}`))),
      h('span.hero-value', {}, h(mini ? 'span.qc-num' : 'span.live-hero-num', {}, f.value), f.unit && f.value !== '—' ? h('span.hero-unit', {}, f.unit) : null),
      f.ci && tileStage === 'provisional' ? h('span.mt-ci', {}, `± ${f.ci}`) : null, // full numbers: as the 0.3.0 hero (± on the shot screen)
      note ? h(extra.change ? 'span.qc-note.qc-change' : 'span.qc-note', {}, note) : null);
  }

  function frame(st, r, tiles, summary) {
    stage = st;
    const card = h('div', {
      class: 'quick-card', 'data-testid': 'quick-card', 'data-stage': st, 'data-t-impact': Number.isFinite(r?.t_impact) ? r.t_impact.toFixed(3) : '',
      role: 'group', 'aria-label': t('quick.name'),
    }, ...tiles, h('span.visually-hidden', { role: 'status' }, summary));
    clear(el, card);
    return card;
  }

  function provisional(r) {
    clearTimeout(fadeTimer);
    cur = r;
    const ids = cardIds();
    const parts = [];
    const tiles = ids.map((id, i) => {
      const m = r?.metrics?.[id] ?? null;
      if (Number.isFinite(m?.value)) parts.push(`${t(`metric.${id}.label`)} ${fmtMetric(m, units(), { id }).text}`);
      return tile(id, m, 'provisional', { note: id === 'carry_m' ? sourceText(r) : null }, i);
    });
    frame('provisional', r, tiles, t('quick.summary', { items: parts.length ? list(parts) : t('quick.none') }));
  }

  function refined(shot, { quick = undefined, hold = false } = {}) {
    // a refined shot of an older swing while a newer quick read is on screen: leave the card
    if (quick !== undefined && cur && quick !== cur && stage === 'provisional') return false;
    const q = quick === undefined ? cur : quick;
    clearTimeout(fadeTimer);
    // carry with neither a quick nor a full value (a swing without a quick read: live mode has no carry) is left out
    const ids = cardIds().filter((id) => Number.isFinite(shot?.metrics?.[id]?.value) || Number.isFinite(q?.metrics?.[id]?.value) || id !== 'carry_m');
    let changed = 0;
    const tiles = ids.map((id, i) => {
      const fm = shot?.metrics?.[id] ?? null;
      const qm = q?.metrics?.[id] ?? null;
      if (!Number.isFinite(fm?.value) && Number.isFinite(qm?.value)) {
        // live mode cannot give it in full (carry): the quick value stays, still tagged 速報
        return tile(id, qm, 'provisional', { note: id === 'carry_m' ? sourceText(q) : null }, i);
      }
      const a = Number.isFinite(qm?.value) ? fmtMetric(qm, units(), { id }).value : null;
      const b = fmtMetric(fm, units(), { id }).value;
      const change = a !== null && b !== '—' && a !== b;
      if (change) changed += 1;
      return tile(id, fm, 'refined', change ? { note: t('quick.change', { from: a, to: b }), change: true } : {}, i);
    });
    const card = frame('refined', q, tiles, '');
    cur = null;
    if (changed && !hold) {
      fadeTimer = setTimeout(() => {
        for (const n of card.querySelectorAll('.qc-change')) {
          if (reduced()) n.remove();
          else { n.classList.add('is-fading'); n.addEventListener('transitionend', () => n.remove(), { once: true }); setTimeout(() => n.remove(), 1000); }
        }
      }, CHANGE_MS);
    }
    return true;
  }

  return {
    provisional,
    refined,
    clear() { clearTimeout(fadeTimer); cur = null; stage = null; clear(el); },
    /** a practice swing after a provisional: the quick read is withdrawn */
    drop(r) { if (!r || r === cur) { this.clear(); return true; } return false; },
    gappingRow(club) {
      const type = club && typeof club === 'object' ? club.type : club;
      const row = rows?.find((x) => x.club === type);
      return row && row.n >= 5 ? row : null;
    },
    /** e2e / screenshot states: a face-on quick read (and its full analysis) with made-up but plausible numbers */
    demo(st) {
      const m = (value, half, unit, codes, origin = 'pose') => ({ value, unit, ci95: [value - half, value + half], sigma: half / 1.96, validity: 'low_confidence', value_origin: origin, measured: false, reason_codes: [RC.PROVISIONAL, ...codes] });
      const r = {
        stage: 'provisional', t_impact: 12.345, carry_source: 'pose', carry_merge: null, club: 'driver', view: 'face_on', events: null, timings_ms: { compute: 0.1 },
        metrics: {
          tempo_ratio: m(3.1, 0.45, 'ratio', [], 'derived'), backswing_s: m(0.84, 0.07, 's', []), downswing_s: m(0.27, 0.05, 's', []),
          club_speed_mps: m(41.2, 12.1, 'm/s', []), carry_m: m(188, 95, 'm', [RC.SMASH_ASSUMED, RC.LAUNCH_V_ASSUMED, RC.FLIGHT_MODELLED], 'flight_model'),
        },
      };
      provisional(r);
      if (st === 'refined') {
        const v = (value, half, unit, validity = 'valid') => ({ value, unit, ci95: [value - half, value + half], sigma: null, validity, value_origin: 'pose', measured: false, reason_codes: [] });
        refined({ metrics: { tempo_ratio: v(3.0, 0.25, 'ratio'), backswing_s: v(0.83, 0.03, 's'), downswing_s: v(0.28, 0.03, 's'), club_speed_mps: v(43.4, 10.9, 'm/s', 'low_confidence'), carry_m: { value: null, unit: 'm', ci95: null, sigma: null, validity: 'not_computed', value_origin: 'ballistics', measured: false, reason_codes: [RC.DEPENDS_ON_NULL] } } }, { quick: r, hold: true });
      }
    },
  };
}
