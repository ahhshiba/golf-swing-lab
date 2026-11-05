// tests/unit/_fakedom.mjs — a minimal DOM for unit tests of ui/components.js (createComponents(doc)) and screens
// built on it. Not a browser: no layout, no CSS, no HTML parsing (innerHTML is stored as text). Supports
// createElement/createElementNS/createTextNode, attributes, classList, dataset, append/prepend/replaceChildren/remove,
// textContent, querySelector(All) for `tag`, `.class`, `#id`, `[attr]`, `[attr="v"]` and comma lists, events with
// bubbling (dispatchEvent / click()), focus() → document.activeElement, getElementById.
class Node {
  constructor(doc) { this.ownerDocument = doc; this.parentNode = null; this.childNodes = []; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === this.ownerDocument; }
  get firstChild() { return this.childNodes[0] ?? null; }
  get firstElementChild() { return this.childNodes.find((c) => c instanceof Element) ?? null; }
  get children() { return this.childNodes.filter((c) => c instanceof Element); }
  append(...nodes) { for (const n of nodes) this._insert(typeof n === 'string' ? this.ownerDocument.createTextNode(n) : n, this.childNodes.length); }
  prepend(...nodes) { nodes.reverse().forEach((n) => this._insert(typeof n === 'string' ? this.ownerDocument.createTextNode(n) : n, 0)); }
  appendChild(n) { this.append(n); return n; }
  _insert(n, at) {
    if (n === null || typeof n !== 'object') throw new TypeError(`fakedom: cannot append ${n}`);
    n.remove?.();
    n.parentNode = this;
    this.childNodes.splice(at, 0, n);
  }
  replaceChildren(...nodes) { for (const c of [...this.childNodes]) c.remove(); this.append(...nodes); }
  remove() { if (this.parentNode) { const p = this.parentNode; p.childNodes.splice(p.childNodes.indexOf(this), 1); this.parentNode = null; } }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { this.replaceChildren(); if (v !== '' && v !== null && v !== undefined) this.append(this.ownerDocument.createTextNode(String(v))); }
}
class Text extends Node {
  constructor(doc, data) { super(doc); this.data = data; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}
function matches(el, sel) {
  return sel.split(',').map((s) => s.trim()).some((one) => {
    const parts = one.match(/^([a-z0-9-]*)((?:[.#][\w-]+|\[[^\]]+\]|:not\(\[[^\]]+\]\))*)$/i);
    if (!parts) return false;
    if (parts[1] && el.tagName !== parts[1].toUpperCase()) return false;
    for (const m of parts[2].matchAll(/\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]|:not\(\[([\w-]+)(?:="([^"]*)")?\]\)/g)) {
      if (m[1] && !el.classList.contains(m[1])) return false;
      if (m[2] && el.getAttribute('id') !== m[2]) return false;
      if (m[3] && (!el.hasAttribute(m[3]) || (m[4] !== undefined && el.getAttribute(m[3]) !== m[4]))) return false;
      if (m[5] && el.hasAttribute(m[5]) && (m[6] === undefined || el.getAttribute(m[5]) === m[6])) return false;
    }
    return true;
  });
}
class Element extends Node {
  constructor(doc, tag) {
    super(doc);
    this.tagName = tag.toUpperCase();
    this.attributes = new Map();
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this.innerHTML = '';
    const self = this;
    this.classList = {
      add: (...c) => { const s = new Set(self.className.split(/\s+/).filter(Boolean)); c.forEach((x) => s.add(x)); self.className = [...s].join(' '); },
      remove: (...c) => { self.className = self.className.split(/\s+/).filter((x) => x && !c.includes(x)).join(' '); },
      contains: (c) => self.className.split(/\s+/).includes(c),
      toggle: (c, on) => { const has = self.classList.contains(c); if (on ?? !has) self.classList.add(c); else self.classList.remove(c); },
    };
    this.dataset = new Proxy({}, {
      get: (_, k) => self.getAttribute(`data-${String(k).replace(/[A-Z]/g, (x) => '-' + x.toLowerCase())}`) ?? undefined,
      set: (_, k, v) => { self.setAttribute(`data-${String(k).replace(/[A-Z]/g, (x) => '-' + x.toLowerCase())}`, v); return true; },
      deleteProperty: (_, k) => { self.removeAttribute(`data-${String(k)}`); return true; },
    });
    if (this.tagName === 'TEMPLATE') this.content = new Element(doc, 'fragment');
  }
  get className() { return this.attributes.get('class') ?? ''; }
  set className(v) { this.attributes.set('class', String(v)); }
  get id() { return this.attributes.get('id') ?? ''; }
  set id(v) { this.attributes.set('id', String(v)); }
  get tabIndex() { return Number(this.attributes.get('tabindex') ?? -1); }
  set tabIndex(v) { this.attributes.set('tabindex', String(v)); }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
  hasAttribute(k) { return this.attributes.has(k); }
  removeAttribute(k) { this.attributes.delete(k); }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  removeEventListener(type, fn) { const l = this.listeners.get(type); if (l) l.splice(l.indexOf(fn), 1); }
  dispatchEvent(ev) {
    ev.target ??= this;
    ev.preventDefault ??= () => { ev.defaultPrevented = true; };
    for (let n = this; n; n = n.parentNode) {
      for (const fn of [...(n.listeners?.get(ev.type) ?? [])]) fn.call(n, ev);
      if (ev.stopped) break;
    }
    return !ev.defaultPrevented;
  }
  click() { if (!this.disabled) this.dispatchEvent({ type: 'click' }); }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  querySelectorAll(sel) { const out = []; const walk = (n) => { for (const c of n.childNodes) if (c instanceof Element) { if (matches(c, sel)) out.push(c); walk(c); } }; walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  closest(sel) { for (let n = this; n instanceof Element; n = n.parentNode) if (matches(n, sel)) return n; return null; }
}
export class FakeDocument extends Node {
  constructor() {
    super(null);
    this.ownerDocument = this;
    this.documentElement = new Element(this, 'html');
    this.body = new Element(this, 'body');
    this.documentElement.append(this.body);
    this.append(this.documentElement);
    this.activeElement = this.body;
  }
  createElement(tag) { return new Element(this, tag); }
  createElementNS(_ns, tag) { return new Element(this, tag); }
  createTextNode(t) { return new Text(this, String(t)); }
  getElementById(id) { return this.documentElement.querySelector(`#${id}`); }
  querySelector(sel) { return this.documentElement.querySelector(sel); }
  querySelectorAll(sel) { return this.documentElement.querySelectorAll(sel); }
}
export function fakeDocument() { return new FakeDocument(); }
/** Manual timers for toast tests: { setTimeout, clearTimeout, run(ms) }. */
export function fakeTimers() {
  let now = 0; let id = 0; const q = new Map();
  return {
    setTimeout: (fn, ms) => { q.set(++id, { fn, at: now + ms }); return id; },
    clearTimeout: (i) => { q.delete(i); },
    run(ms) { now += ms; for (const [i, j] of [...q]) if (j.at <= now) { q.delete(i); j.fn(); } },
    pending: () => q.size,
  };
}
