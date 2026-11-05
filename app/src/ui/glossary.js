// ui/glossary.js — names and the metric glossary for the results screens (package C; PRODUCT-SPEC §2.3, §2.4).
// Browser-only at call time (the sheet); the name helpers are pure apart from the i18n catalogs.
//
//   clubName(type)            t('club.<type>'), else a generic iron/wood/wedge name built from the code ("6 號鐵"),
//                             never the raw code ('7i', 'driver') in visible text
//   viewName(view)            t('view.<view>') or a neutral "unknown angle"
//   eventName(name)           t('event.<name>')
//   metricName(id)            t('metric.<id>.label')
//   openGlossary(id, { C })   bottom sheet: name, (zh) English term, meaning, typical amateur range, unit note
//   glossaryButton(id, { C }) 44 px (?) icon button that opens it
import { t, has } from '../i18n/index.js';
import * as defaultC from './components.js';

export function clubName(type) {
  if (type === null || type === undefined || type === '') return t('shot.club.unknown');
  const k = `club.${type}`;
  if (has(k)) return t(k);
  const s = String(type).toLowerCase();
  let m = /^(\d{1,2})i$/.exec(s);
  if (m) return t('shot.club.iron', { n: Number(m[1]) });
  m = /^(\d{1,2})w$/.exec(s);
  if (m) return t('shot.club.wood', { n: Number(m[1]) });
  m = /^(\d{1,2})h$/.exec(s);
  if (m) return t('shot.club.hybrid', { n: Number(m[1]) });
  if (/^(gw|aw|lw|\d{2}deg)$/.test(s)) return t('shot.club.wedge');
  if (s === 'putter') return t('shot.club.putter');
  return t('shot.club.other');
}

export function viewName(view) {
  return view && has(`view.${view}`) ? t(`view.${view}`) : t('shot.view.unknown');
}

export const eventName = (name) => t(`event.${name}`);
export const metricName = (id) => (has(`metric.${id}.label`) ? t(`metric.${id}.label`) : t('shot.metric.unknown'));

export function openGlossary(id, { C = defaultC } = {}) {
  const h = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; };
  const box = h('div', 'glossary');
  if (has(`metric.${id}.term`) && t(`metric.${id}.term`) !== t(`metric.${id}.label`)) box.append(h('p', 'glossary-term', t(`metric.${id}.term`)));
  if (has(`metric.${id}.meaning`)) box.append(h('p', 'glossary-meaning', t(`metric.${id}.meaning`)));
  if (has(`metric.${id}.range`)) {
    const r = h('p', 'glossary-range');
    r.append(h('span', 'glossary-k', t('shot.glossary.range')), document.createTextNode(` ${t(`metric.${id}.range`)}`));
    box.append(r);
  }
  box.append(h('p', 'glossary-note', t('shot.glossary.ci_note')));
  const s = C.sheet({ title: metricName(id), content: box, testid: 'glossary-sheet' });
  s.open();
  return s;
}

export function glossaryButton(id, { C = defaultC } = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon-btn glossary-btn';
  b.setAttribute('aria-label', t('shot.glossary.open', { name: metricName(id) }));
  b.append(C.icon('help'));
  b.addEventListener('click', (e) => { e.stopPropagation(); openGlossary(id, { C }); });
  return b;
}
