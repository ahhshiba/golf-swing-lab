// share/card.js — static share cards (V04-SPEC §D.3): every distance / speed carries ± or a range, never the word
// "measured" (a 'valid' validity is written with the estimated word); a round card says "simulated". Lazy; owner V4-E.
//
//   drawShotCard(canvas, { shot, units, palette, locale, appMark? })           1080 × 1350, one shot
//   drawSessionCard(canvas, { shots, filter, units, palette, appMark? })       1080 × 1350, one practice session
//   drawRoundCard(canvas, { round, playerId, palette?, units?, appMark? })     1080 × 1350, a round's scorecard
//     -> { a11y: string (every drawn text, in order — the image's text alternative), params: { kind, texts, … } }
//   cardPalette(el) -> palette            read from the computed style of el (tokens.css: --bg --surface --surface-2
//                                         --text --text-2 --accent --font); every fill / stroke on a card comes from it
//   pmText(metric, units, id) -> string | null   "181 ± 21 yd": the ± never disappears (a half width that rounds to 0
//                                         is shown as one display step, so the card never looks exact)
//   rangeText(lo, hi, kind, units) -> "150–171 yd"
// Session numbers: store/stats.js summarize (median, P10–P90, sd_est, indistinguishable). The round's numbers come from
// sim/round.js scorecard(round) (params.scorecard = 'sim').
import { t, fmtNum, fmtDate } from '../i18n/index.js';
import { fmtMetric, fmtQuantity } from '../i18n/units.js';
import { summarize } from '../store/stats.js';
import { clubName, viewName, metricName } from '../ui/glossary.js';
import { scorecard } from '../sim/round.js';

export const CARD_W = 1080;
export const CARD_H = 1350;
/** Shot card metrics in order (§D.1 data card: up to 6, those with a value). */
export const CARD_METRICS = Object.freeze(['carry_m', 'total_m', 'ball_speed_mps', 'club_speed_mps', 'launch_v_deg', 'launch_h_deg']);

const fin = (x) => typeof x === 'number' && Number.isFinite(x);

export function cardPalette(el) {
  const view = el?.ownerDocument?.defaultView ?? globalThis;
  let cs = null;
  try { cs = view.getComputedStyle ? view.getComputedStyle(el) : null; } catch (_) { cs = null; }
  const fallback = (cs && cs.color) || 'gray';
  const get = (n) => (cs ? String(cs.getPropertyValue(n) ?? '').trim() : '') || fallback;
  const fam = cs ? String(cs.getPropertyValue('--font') || cs.fontFamily || '').trim() : '';
  return Object.freeze({
    bg: get('--bg'), panel: get('--surface'), line: get('--surface-2'), ink: get('--text'), muted: get('--text-2'),
    accent: get('--accent'), font: fam || 'system-ui, sans-serif',
  });
}

/** The validity word a public card may show (never "measured"). */
export function validityWord(v) {
  if (v === 'low_confidence') return t('validity.low_confidence');
  return t('validity.estimated');
}

export function pmText(metric, units, id) {
  if (!metric || !fin(metric.value)) return null;
  const f = fmtMetric(metric, units, { id });
  if (f.ci) return f.text;
  const step = fmtNum(10 ** -f.digits, { digits: f.digits });
  return f.text.replace(f.value, `${f.value} ± ${step}`);
}

export function rangeText(lo, hi, kind, units) {
  const a = fmtQuantity(lo, kind, units);
  const b = fmtQuantity(hi, kind, units);
  return b.unit ? `${a.value}–${b.value} ${b.unit}` : `${a.value}–${b.value}`;
}

function painter(canvas, palette) {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  const P = palette;
  const texts = [];
  const font = (size, weight = 400) => `${weight} ${size}px ${P.font}`;
  const api = {
    ctx,
    texts,
    rect(x, y, w, h, colour, r = 0) {
      ctx.fillStyle = colour;
      ctx.beginPath();
      if (r > 0) {
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
      } else ctx.rect(x, y, w, h);
      ctx.fill();
    },
    /** Text that shrinks to fit maxW; recorded for a11y. */
    text(s, x, y, { size = 36, weight = 400, colour = P.ink, align = 'left', maxW = CARD_W - 2 * 72 } = {}) {
      if (s === null || s === undefined || s === '') return 0;
      const str = String(s);
      let sz = size;
      ctx.font = font(sz, weight);
      while (sz > 14 && ctx.measureText(str).width > maxW) { sz -= 2; ctx.font = font(sz, weight); }
      ctx.fillStyle = colour;
      ctx.textAlign = align;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(str, x, y);
      texts.push(str);
      return sz;
    },
    line(x0, y0, x1, y1, colour, w = 2) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    },
  };
  api.rect(0, 0, CARD_W, CARD_H, P.bg);
  return api;
}

function footer(p, P, { appMark = false, note = t('share.card.note') } = {}) {
  p.line(72, CARD_H - 150, CARD_W - 72, CARD_H - 150, P.line, 2);
  p.text(note, 72, CARD_H - 96, { size: 28, colour: P.muted });
  if (appMark) p.text(t('app.name'), CARD_W - 72, CARD_H - 48, { size: 26, colour: P.muted, align: 'right', maxW: 480 });
}

const finish = (p, kind, extra = {}) => ({ a11y: p.texts.join(' · '), params: { kind, texts: p.texts.slice(), ...extra } });

// ------------------------------------------------------------------ one shot

export function drawShotCard(canvas, { shot, units, palette, locale, appMark = false } = {}) {
  const P = palette;
  const p = painter(canvas, P);
  const m = shot?.metrics ?? {};
  p.text(t('share.card.shot_title'), 72, 140, { size: 64, weight: 700 });
  const sub = [clubName(shot?.club?.type), viewName(shot?.capture?.view), shot?.created_at ? fmtDate(shot.created_at) : null].filter(Boolean).join(' · ');
  p.text(sub, 72, 205, { size: 34, colour: P.muted });
  const ids = CARD_METRICS.filter((id) => fin(m[id]?.value)).slice(0, 6);
  const colW = (CARD_W - 72 * 2 - 32) / 2;
  ids.forEach((id, i) => {
    const x = 72 + (i % 2) * (colW + 32);
    const y = 270 + Math.floor(i / 2) * 290;
    p.rect(x, y, colW, 258, P.panel, 28);
    p.text(metricName(id), x + 36, y + 70, { size: 34, colour: P.muted, maxW: colW - 72 });
    p.text(pmText(m[id], units, id), x + 36, y + 160, { size: 64, weight: 700, maxW: colW - 72 });
    p.text(validityWord(m[id].validity), x + 36, y + 220, { size: 30, colour: P.accent, maxW: colW - 72 });
  });
  if (!ids.length) p.text(t('share.card.no_numbers'), 72, 360, { size: 40, colour: P.muted });
  footer(p, P, { appMark });
  return finish(p, 'shot', { metrics: ids, locale: locale ?? null });
}

// ------------------------------------------------------------------ one session

function filterText(filter = {}) {
  const parts = [];
  if (filter?.view) parts.push(viewName(filter.view));
  if (filter?.club_type) parts.push(clubName(filter.club_type));
  return parts.join(' · ');
}

const val = (s, id) => s?.metrics?.[id]?.value;
const sig = (s, id) => { const x = s?.metrics?.[id]; if (!x) return NaN; if (fin(x.sigma)) return x.sigma; return Array.isArray(x.ci95) ? (x.ci95[1] - x.ci95[0]) / 3.92 : NaN; };

/** The numbers of the session card (exported for tests): pure, no drawing. */
export function sessionSummary(shots = []) {
  const list = shots.filter(Boolean);
  const carried = list.filter((s) => fin(val(s, 'carry_m')));
  const longest = carried.reduce((a, s) => (!a || val(s, 'carry_m') > val(a, 'carry_m') ? s : a), null);
  const byClub = new Map();
  for (const s of carried) {
    const k = s.club?.type ?? 'unknown';
    if (!byClub.has(k)) byClub.set(k, []);
    byClub.get(k).push(s);
  }
  const clubs = [...byClub.entries()].map(([club, ss]) => ({ club, ...summarize(ss.map((s) => val(s, 'carry_m')), ss.map((s) => sig(s, 'carry_m'))) }));
  clubs.sort((a, b) => b.median - a.median);
  const fo = list.filter((s) => s.capture?.view === 'face_on' && fin(val(s, 'ball_speed_mps')));
  const ballSpeed = fo.length ? summarize(fo.map((s) => val(s, 'ball_speed_mps')), fo.map((s) => sig(s, 'ball_speed_mps'))) : null;
  const hb = list.filter((s) => s.capture?.view === 'high_behind' && fin(val(s, 'carry_side_m')));
  const side = hb.length >= 2 ? summarize(hb.map((s) => val(s, 'carry_side_m')), hb.map((s) => sig(s, 'carry_side_m'))) : null;
  const dates = list.map((s) => s.created_at).filter(Boolean).sort();
  return { n: list.length, longest, clubs, ballSpeed, side, date: dates[0] ?? null, views: [...new Set(list.map((s) => s.capture?.view).filter(Boolean))] };
}

export function drawSessionCard(canvas, { shots, filter, units, palette, appMark = false } = {}) {
  const P = palette;
  const p = painter(canvas, P);
  const S = sessionSummary(shots);
  p.text(t('share.card.session_title'), 72, 140, { size: 64, weight: 700 });
  const sub = [S.date ? fmtDate(S.date) : null, filterText(filter) || S.views.map(viewName).join(' · ')].filter(Boolean).join(' · ');
  p.text(sub, 72, 205, { size: 34, colour: P.muted });
  p.text(t('share.card.shots', { n: S.n }), 72, 290, { size: 44, weight: 700 });
  let y = 330;
  if (S.longest) {
    const c = S.longest.metrics.carry_m;
    p.rect(72, y, CARD_W - 144, 190, P.panel, 28);
    p.text(t('share.card.longest_carry'), 108, y + 62, { size: 32, colour: P.muted });
    p.text(pmText(c, units, 'carry_m'), 108, y + 140, { size: 60, weight: 700, maxW: 600 });
    p.text(`${validityWord(c.validity)} · ${clubName(S.longest.club?.type)}`, CARD_W - 108, y + 140, { size: 30, colour: P.accent, align: 'right', maxW: 300 });
    y += 220;
  }
  if (S.clubs.length) {
    p.text(t('share.card.carry_by_club'), 72, y + 40, { size: 32, colour: P.muted });
    y += 60;
    for (const c of S.clubs.slice(0, 5)) {
      p.line(72, y, CARD_W - 72, y, P.line, 2);
      p.text(`${clubName(c.club)} · ${t('share.card.n', { n: c.n })}`, 72, y + 56, { size: 34, maxW: 360 });
      // median and its P10–P90 range in ONE string: a distance never stands without its range
      p.text(t('share.card.median_range', { v: fmtQuantity(c.median, 'distance', units).value, range: rangeText(c.p10, c.p90, 'distance', units) }), CARD_W - 72, y + 56, { size: 34, weight: 700, align: 'right', maxW: 560 });
      y += 80;
    }
    p.text(t('share.card.range_note'), 72, y + 40, { size: 26, colour: P.muted });
    y += 70;
  }
  if (S.ballSpeed && fin(S.ballSpeed.median)) {
    const bs = S.ballSpeed;
    const half = bs.ci95_mean ? (bs.ci95_mean[1] - bs.ci95_mean[0]) / 2 : 1.96 * (bs.sigma_noise ?? NaN);
    const m = { value: bs.median, unit: 'm/s', ci95: fin(half) ? [bs.median - half, bs.median + half] : null, sigma: null };
    p.text(`${t('share.card.ball_speed_median')}: ${pmText(m, units, 'ball_speed_mps')}`, 72, y + 40, { size: 34 });
    y += 70;
  }
  if (S.side) {
    const txt = S.side.indistinguishable ? t('share.card.spread_within_error')
      : fin(S.side.sd_est) ? t('share.card.side_spread', { v: `± ${fmtQuantity(S.side.sd_est, 'distance', units).text}` }) : null;
    if (txt) { p.text(txt, 72, y + 40, { size: 34 }); y += 70; }
  }
  footer(p, P, { appMark });
  return finish(p, 'session', { n: S.n, clubs: S.clubs.length, side: S.side ? (S.side.indistinguishable ? 'indistinguishable' : 'sd') : null });
}

// ------------------------------------------------------------------ a round

/** sim/round.js scorecard (the one source of a round's numbers). */
export function roundScore(round) {
  return { card: scorecard(round), source: 'sim' };
}

export function drawRoundCard(canvas, { round, playerId, palette, units, appMark = false } = {}) {
  const P = palette ?? cardPalette(canvas);
  const p = painter(canvas, P);
  const { card, source } = roundScore(round);
  const pl = card.players.find((x) => x.player_id === playerId) ?? card.players[0];
  const meta = (round?.players ?? []).find((x) => x.player_id === pl?.player_id);
  p.text(t('share.card.round_title'), 72, 140, { size: 64, weight: 700, maxW: 700 });
  // the "simulated" mark: a pill top right, always
  p.rect(CARD_W - 72 - 230, 88, 230, 70, P.accent, 35);
  p.text(t('share.card.simulated'), CARD_W - 72 - 115, 136, { size: 34, weight: 700, colour: P.bg, align: 'center', maxW: 200 });
  const sub = [meta?.name, t('share.card.holes', { n: round?.course?.holes_n ?? card.players[0]?.holes.length ?? 0 }), round?.created_at ? fmtDate(round.created_at) : null].filter(Boolean).join(' · ');
  p.text(sub, 72, 205, { size: 34, colour: P.muted });
  if (pl) {
    p.text(t('share.card.total', { n: pl.total }), 72, 320, { size: 72, weight: 700, maxW: 520 });
    const tp = pl.to_par === 0 ? t('share.card.even') : `${pl.to_par > 0 ? '+' : '−'}${Math.abs(pl.to_par)}`;
    p.text(tp, CARD_W - 72, 320, { size: 72, weight: 700, colour: P.accent, align: 'right', maxW: 300 });
    const rows = [pl.holes.slice(0, 9), pl.holes.slice(9, 18)].filter((r) => r.length);
    const cw = (CARD_W - 144) / 9;
    let y = 380;
    for (const row of rows) {
      row.forEach((h, i) => {
        const x = 72 + i * cw;
        p.rect(x + 4, y, cw - 8, 220, P.panel, 18);
        p.text(String(h.hole), x + cw / 2, y + 50, { size: 28, colour: P.muted, align: 'center', maxW: cw - 16 });
        p.text(t('share.card.par', { n: h.par }), x + cw / 2, y + 96, { size: 24, colour: P.muted, align: 'center', maxW: cw - 16 });
        p.text(h.strokes ? String(h.strokes) : '–', x + cw / 2, y + 180, { size: 52, weight: 700, align: 'center', maxW: cw - 16 });
      });
      y += 250;
    }
  }
  p.text(t('share.card.round_note'), 72, CARD_H - 210, { size: 28, colour: P.muted });
  footer(p, P, { appMark });
  return finish(p, 'round', { scorecard: source, player_id: pl?.player_id ?? null, total: pl?.total ?? null, units: units ?? null });
}
