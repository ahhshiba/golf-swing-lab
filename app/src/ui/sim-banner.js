// ui/sim-banner.js — the round banner on the live screen and the import screen (V04-SPEC §C.4): "hole 3 · stroke 2 ·
// 7-iron · name" while a simulated round waits for this swing. On the live screen (ui/live.js imports it when
// params.sink === 'sim' and calls quick(r) with every quick read) it then offers "use this shot" (sim-banner-use →
// app.sim.submit({ kind: 'quick', result }) and back to the round) and "retake (no stroke)" (sim-banner-retake: the
// read is dropped, the next swing counts). On the import screen it only says which stroke the clip will be.
// Lazy. Owner V4-D.

import { h, clear } from './dom.js';
import * as C from './components.js';
import { t } from '../i18n/index.js';
import { fmtMetric } from '../i18n/units.js';
import { clubName } from './glossary.js';

/**
 * @param {HTMLElement} el
 * @param {object} app            app.sim.active() gives ctx; the banner calls app.sim.submit({ kind: 'quick', result })
 * @param {{ round_id: string, hole: number, player_id: string, stroke_n: number, club: string, name?: string }|null} ctx
 * @param {{ mode?: 'live'|'import' }} [opts]
 * @returns {{ quick(r: object): void, destroy(): void }}
 */
export function mountSimBanner(el, app, ctx, opts = {}) {
  const mode = opts.mode ?? 'live';
  let last = null;
  let dead = false;
  const box = h('section.sim-banner', { 'data-testid': 'sim-banner', 'data-mode': mode, role: 'region', 'aria-label': t('sim.banner.label') });
  el.append(box);

  const line = () => (ctx ? t('sim.banner.line', { n: ctx.hole, stroke: ctx.stroke_n, club: clubName(ctx.club), name: ctx.name ?? '' }) : t('sim.none.title'));

  function paint() {
    if (dead) return;
    const parts = [h('p.sb-line', {}, C.icon('flag'), h('span', line()))];
    if (!ctx) {
      clear(box, ...parts);
      return;
    }
    if (mode === 'import') {
      parts.push(h('p.hint.sb-hint', t('sim.banner.import')));
    } else if (!last) {
      parts.push(h('p.hint.sb-hint', t('sim.banner.wait')));
    } else {
      const m = last.metrics?.carry_m;
      const f = m && typeof m.value === 'number' ? fmtMetric(m, app.units(), { id: 'carry_m' }) : null;
      parts.push(h('p.sb-read', { 'data-testid': 'sim-banner-read' },
        f ? t('sim.banner.read', { d: `${f.value} ${f.unit}`, pm: f.ci ? `± ${f.ci}` : '' }) : t('sim.banner.read_none')),
      h('div.sb-actions', {},
        C.button({ label: t('sim.use_shot'), variant: 'primary', size: 'lg', testid: 'sim-banner-use', onClick: use }),
        C.button({ label: t('sim.retake'), size: 'lg', testid: 'sim-banner-retake', onClick: () => { last = null; paint(); } })));
    }
    clear(box, ...parts);
  }

  function use() {
    if (!last || !ctx) return;
    const result = { ...last, view: last.view ?? ctx.view ?? app.current?.view ?? null };
    last = null;
    paint();
    app.sim.submit({ kind: 'quick', result });
    app.nav.back();
  }

  paint();
  return {
    quick(r) {
      if (dead || !r) return;
      last = r;
      paint();
    },
    destroy() {
      dead = true;
      box.remove();
    },
  };
}

/** The import screen's hook (ui/import.js, opened with { sink: 'sim' }): the banner, and el.use(shot) hands the first
 *  analysed shot to the round (app.sim.submit({ kind: 'shot', shot })) and goes back to it. */
export function simImport(el, app) {
  const b = mountSimBanner(el, app, app.sim.active(), { mode: 'import' });
  el.use = (shot) => {
    app.sim.submit({ kind: 'shot', shot });
    app.nav.back();
  };
  return b;
}
