// ui/dom.js — tiny DOM helpers (browser only).

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
  for (const [v, label] of options) s.append(h('option', { value: v, selected: v === value }, label));
  return s;
}

let toastTimer = null;
/** Short status message at the bottom of the screen. */
export function toast(text, ms = 3500) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/** A download link for a Blob (also clicked once); the object URL is revoked later. */
export function downloadLink(blob, filename, label) {
  const url = URL.createObjectURL(blob);
  const a = h('a.button', { href: url, download: filename }, label ?? `下載 ${filename}`);
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

export function screenHeader(title, onBack) {
  return h('header.screen-header', {},
    onBack ? h('button.back', { type: 'button', 'aria-label': '返回', onclick: onBack }, '‹ 返回') : null,
    h('h1', title));
}
