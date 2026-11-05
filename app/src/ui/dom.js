// ui/dom.js — tiny DOM helpers (browser only at call time; importing is DOM-free).
// Components of the design system live in ./components.js; the helpers here are kept for the existing screens.
//   Toasts: components.js toast.info / toast.error (the old dom.js toast() alias was removed at integration, §8.7).
import { t, has } from '../i18n/index.js';
import { screenHeader as cScreenHeader } from './components.js';

/** h('button.primary', { onclick }, 'text', child…) — tag with optional .classes / #id, attrs and children. */
export function h(spec, attrs = {}, ...children) {
  const m = /^([a-z0-9-]+)?(#[\w-]+)?((?:\.[\w-]+)*)$/i.exec(spec);
  const el = document.createElement(m?.[1] || 'div');
  if (m?.[2]) el.id = m[2].slice(1);
  if (m?.[3]) el.className = m[3].split('.').filter(Boolean).join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = {};
  }
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

/** Labeled form field. */
export function field(label, input, hint) {
  return h('label.field', {}, h('span.field-label', label), input, hint ? h('span.hint', hint) : null);
}

export function numberInput(attrs = {}) {
  return h('input', { type: 'number', inputmode: 'decimal', step: 'any', ...attrs });
}

export function select(options, value, attrs = {}) {
  const s = h('select', attrs);
  for (const [v, label] of options) s.append(h('option', { value: v, selected: v === value }, optionLabel(v, label)));
  return s;
}

/** Transitional: a numeric label for a club type (CLUBS changed to [type, length_m]) shows the club name. */
function optionLabel(v, label) {
  if (typeof label === 'number' && has(`club.${v}`)) return t(`club.${v}`);
  return label;
}

/** A download link for a Blob (also clicked once); the object URL is revoked later. */
export function downloadLink(blob, filename, label) {
  const url = URL.createObjectURL(blob);
  const a = h('a.button', { href: url, download: filename }, label ?? t('common.download_file', { name: filename }));
  setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
  return a;
}

export function badge(text, kind = '') {
  return h(`span.badge${kind ? '.' + kind : ''}`, text);
}

/** Section card. */
export function card(title, ...children) {
  return h('section.card', {}, title ? h('h2', title) : null, ...children);
}

/** Legacy signature of components.screenHeader({ title, back, onBack }). */
export function screenHeader(title, onBack) {
  return cScreenHeader({ title, back: Boolean(onBack), onBack });
}
