// ui/components.js — the "Range" component set (PRODUCT-SPEC §1.5, §8.0.3 FROZEN in drop 1; docs/design-system.md).
// Every component returns real DOM built from `doc`, styled only through classes in app/styles/app.css + tokens.css.
// Importing is DOM-free: createComponents(doc) binds a document (tests pass a fake one, see tests/unit/_fakedom.mjs);
// the named exports below bind globalThis.document on first call.
//
//   button({ label, variant:'primary'|'secondary'|'tinted'|'plain'|'destructive', size:'md'|'lg'|'xl', icon, reason,
//            testid, onClick, disabled, type, id, block }) -> <button>; reason (string) disables it and shows the
//            reason line inside it; btn.setReason(text|null), btn.setDisabled(bool), btn.setLabel(text)
//   listRow({ icon, title, value, subtitle, onClick, testid, chevron }) -> <button.list-row> (or <div> without onClick)
//   segmented({ options:[[v,label]], value, onChange, label, testid }) -> <div role=radiogroup>; .value get/set
//   switchRow({ label, checked, onChange, testid, hint }) -> <div.switch-row>; .checked get/set
//   metricTile({ metric, size:'hero'|'compact', units, id, label }) -> <div.metric-tile>
//   dataTile({ metric, id, units, estimatedBadge, label, onClick, testid }) -> <div|button.data-tile data-metric>
//            LAUNCH-MONITOR-SPEC §3.2: caption label, big number (.mt-num, --t-metric, tabular), unit, ± range, a
//            vtag pill (◐ / ▲ + word) when estimated / low confidence (measured, null: words for screen readers),
//            a model-inferred number says estimatedBadge (default t('tiles.estimated_badge')), '—' + the first
//            reason's short text when null.
//            A <button> when onClick is given (the detail sheet); isInferred(metric) says whether the badge shows
//   validityTag(validity) -> <span.vtag>   (● valid, ◐ estimated, ▲ low confidence, — not measurable)
//   statePill({ state:'ready'|'swinging'|'analysing'|'done'|'error', text, testid }) -> element with .update(state, text)
//   notice({ variant:'info'|'caution'|'error', title, items, body, collapsible, testid }) -> <div.notice>
//   emptyState({ icon, title, body, action:{label,onClick,testid}|Element, testid }) -> <div.empty-state>
//   sheet({ title, content, onClose, testid }) -> { el, open(), close(), isOpen() }   focus-trapped, Esc closes
//   confirmSheet({ title, consequence, confirmLabel, cancelLabel, destructive, testid }) -> Promise<boolean>
//   filePicker({ accept, multiple, label, testid, onFiles, variant:'button'|'zone', id }) -> <label.file-picker>; .input
//   progressSteps({ steps:[{id,label}], testid, onCancel, cancelLabel }) -> { el, set(id, state), eta(s), reset() }
//   chipRow({ items:[[v,label]], value, onChange, label, testid }) -> <div.chip-row>; .value get/set
//   screenHeader({ title, back, onBack, backLabel, actions }) -> <header.screen-header> (h1 tabindex=-1)
//   icon(name, { label })
//   toast.info(text, { action:{label,onClick}, testid, ms }) -> element    toast.error(text, { slot, testid }) -> element
//   toast.hide()
import { t as defaultT, fmtNum, has as hasKey } from '../i18n/index.js';
import { fmtMetric } from '../i18n/units.js';
import { icon as makeIcon } from './icons.js';
import { RC } from '../contract/reason-codes.js';

const NULL_VALIDITIES = new Set(['occluded', 'ambiguous', 'dropped', 'stale', 'not_observable', 'implausible', 'not_computed']);
const VALIDITY_GLYPH = Object.freeze({ valid: '●', estimated: '◐', low_confidence: '▲', null: '—' });
/** contract MODEL_ORIGINS + the codes that mark a number as inferred rather than tracked (LAUNCH-MONITOR-SPEC §2.3). */
export const INFERRED_ORIGINS = Object.freeze(['dplane', 'spin_model', 'flight_model', 'prior']);
export const INFERRED_CODES = Object.freeze([RC.DPLANE_MODEL, RC.SPIN_MODELLED, RC.FLIGHT_MODELLED, RC.ROLL_MODELLED,
  RC.SMASH_ASSUMED, RC.LAUNCH_V_ASSUMED, RC.SPIN_LOFT_ASSUMED, RC.CROSS_VIEW_PRIOR]);
/** A number that comes from a model or a prior (the tile shows the 'estimated' word next to ◐ / ▲). */
export function isInferred(metric) {
  if (!metric || typeof metric.value !== 'number') return false;
  return INFERRED_ORIGINS.includes(metric.value_origin) || (metric.reason_codes ?? []).some((c) => INFERRED_CODES.includes(c));
}
const STATE_GLYPH = Object.freeze({ ready: '✓', swinging: '●', analysing: '◌', done: '✓', error: '✕' });
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let uid = 0;
const nextId = (p) => `${p}-${++uid}`;

/**
 * Bind the component set to a document. Options: t (translator), timers ({ setTimeout, clearTimeout }) for tests.
 */
export function createComponents(doc = globalThis.document, { t = defaultT, timers = globalThis } = {}) {
  if (!doc) throw new TypeError('createComponents: no document');

  function h(tag, attrs = {}, ...children) {
    const el = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs ?? {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = String(v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.append(typeof c === 'object' ? c : doc.createTextNode(String(c)));
    }
    return el;
  }
  const icon = (name, o = {}) => makeIcon(name, { doc, ...o });
  /** Element.append without the null/undefined/false children (native append would print them). */
  const put = (el, ...kids) => { for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) el.append(k); return el; };
  const testid = (el, id) => { if (id) el.setAttribute('data-testid', id); return el; };

  // ---------------------------------------------------------------- Button
  function button({ label, variant = 'secondary', size = 'md', icon: ic, reason, testid: tid, onClick, disabled = false, type = 'button', id, block = false } = {}) {
    const b = h('button', { type, id, class: `btn btn-${variant} btn-${size}${block ? ' btn-block' : ''}` });
    const lab = h('span', { class: 'btn-label', text: label ?? '' });
    const why = h('span', { class: 'btn-reason' });
    put(b, h('span', { class: 'btn-main' }, ic ? icon(ic) : null, lab), why);
    testid(b, tid);
    if (onClick) b.addEventListener('click', (e) => { if (!b.disabled) onClick(e); });
    let forced = Boolean(disabled);
    b.setReason = (text) => {
      const r = text === null || text === undefined || text === '' ? null : String(text);
      why.textContent = r ?? '';
      why.hidden = !r;
      b.disabled = Boolean(r) || forced;
      if (r) b.setAttribute('data-reason', r); else b.removeAttribute('data-reason');
    };
    b.setDisabled = (v) => { forced = Boolean(v); b.disabled = forced || b.hasAttribute('data-reason'); };
    b.setLabel = (text) => { lab.textContent = text ?? ''; };
    b.setReason(reason);
    return b;
  }

  // ---------------------------------------------------------------- ListRow
  function listRow({ icon: ic, title, value, subtitle, onClick, testid: tid, chevron } = {}) {
    const tap = typeof onClick === 'function';
    const row = h(tap ? 'button' : 'div', { class: 'list-row', type: tap ? 'button' : null });
    const val = value !== undefined && value !== null ? h('span', { class: 'lr-value', text: value }) : null;
    const chev = (chevron ?? tap) ? h('span', { class: 'lr-chevron' }, icon('chevron-right')) : null;
    put(row,
      ic ? h('span', { class: 'lr-icon' }, icon(ic)) : null,
      h('span', { class: 'lr-text' }, h('span', { class: 'lr-title', text: title ?? '' }), subtitle ? h('span', { class: 'lr-sub', text: subtitle }) : null),
      // value and chevron are one unit: with large text they wrap together to the right, never apart
      val ? h('span', { class: 'lr-end' }, val, chev) : chev,
    );
    if (tap) row.addEventListener('click', onClick);
    row.setValue = (v) => { const el = row.querySelector?.('.lr-value'); if (el) el.textContent = v; };
    return testid(row, tid);
  }

  // ---------------------------------------------------------------- Segmented / ChipRow (single choice)
  function choiceGroup(cls, { options = [], items, value, onChange, label, testid: tid } = {}) {
    const opts = (items ?? options).map((o) => (Array.isArray(o) ? o : [o.value, o.label]));
    const g = h('div', { class: cls, role: 'radiogroup', 'aria-label': label ?? null });
    let cur = value;
    const btns = opts.map(([v, l]) => {
      const b = h('button', { type: 'button', role: 'radio', class: `${cls}-opt`, 'data-value': String(v), text: l });
      b.addEventListener('click', () => select(v, true));
      b.addEventListener('keydown', (e) => {
        const i = opts.findIndex((o) => o[0] === v);
        let j = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % opts.length;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + opts.length) % opts.length;
        if (j !== null) { e.preventDefault?.(); select(opts[j][0], true); btns[j].focus?.(); }
      });
      return b;
    });
    function select(v, fire) {
      cur = v;
      opts.forEach(([ov], i) => {
        const on = ov === v;
        btns[i].setAttribute('aria-checked', on ? 'true' : 'false');
        btns[i].tabIndex = on || (cur === undefined && i === 0) ? 0 : -1;
      });
      if (fire && typeof onChange === 'function') onChange(v);
    }
    g.append(...btns);
    select(cur, false);
    Object.defineProperty(g, 'value', { get: () => cur, set: (v) => select(v, false), configurable: true });
    return testid(g, tid);
  }
  const segmented = (o = {}) => choiceGroup('segmented', o);
  const chipRow = (o = {}) => choiceGroup('chip-row', o);

  // ---------------------------------------------------------------- Switch
  function switchRow({ label, checked = false, onChange, testid: tid, hint } = {}) {
    const lid = nextId('sw');
    const sw = h('button', { type: 'button', role: 'switch', class: 'switch', 'aria-labelledby': lid });
    sw.append(h('span', { class: 'switch-thumb' }));
    const row = h('div', { class: 'switch-row' },
      h('span', { class: 'sr-text' }, h('span', { class: 'sr-label', id: lid, text: label ?? '' }), hint ? h('span', { class: 'sr-hint', text: hint }) : null),
      sw);
    let on = Boolean(checked);
    const paint = () => sw.setAttribute('aria-checked', on ? 'true' : 'false');
    paint();
    sw.addEventListener('click', () => { on = !on; paint(); if (onChange) onChange(on); });
    Object.defineProperty(row, 'checked', { get: () => on, set: (v) => { on = Boolean(v); paint(); }, configurable: true });
    row.control = sw;
    testid(sw, tid);
    return row;
  }

  // ---------------------------------------------------------------- ValidityTag / MetricTile
  function validityKind(v) {
    if (v === 'valid' || v === 'estimated' || v === 'low_confidence') return v;
    return 'null';
  }
  function validityTag(validity) {
    const kind = validityKind(validity);
    const key = kind === 'null' ? (NULL_VALIDITIES.has(validity) ? validity : 'not_measurable') : kind;
    const label = t(`validity.${key}`);
    return h('span', { class: `vtag vtag-${kind === 'low_confidence' ? 'low' : kind === 'estimated' ? 'est' : kind}`, 'data-validity': validity ?? 'not_computed' },
      h('span', { class: 'vtag-glyph', 'aria-hidden': 'true', text: VALIDITY_GLYPH[kind] }), h('span', { class: 'vtag-text', text: label }));
  }

  function metricTile({ metric, size = 'compact', units, id, label } = {}) {
    const mid = id ?? metric?.id ?? null;
    const f = fmtMetric(metric ?? null, units, { id: mid });
    const name = label ?? (mid ? t(`metric.${mid}.label`) : '');
    const tile = h('div', { class: `metric-tile tile-${size}${f.value === '—' ? ' is-null' : ''}`, 'data-metric': mid });
    put(tile,
      h('div', { class: 'mt-head' }, h('span', { class: 'mt-label', text: name }), validityTag(metric?.validity ?? 'not_computed')),
      h('div', { class: 'mt-value' }, h('span', { class: 'mt-num', text: f.value }), f.unit && f.value !== '—' ? h('span', { class: 'mt-unit', text: f.unit }) : null),
      f.ci ? h('div', { class: 'mt-ci', text: `± ${f.ci}` }) : null,
    );
    return tile;
  }

  // ---------------------------------------------------------------- DataTile (LAUNCH-MONITOR-SPEC §3.2)
  function dataTile({ metric, id, units, estimatedBadge, label, onClick, testid: tid } = {}) {
    const mid = id ?? metric?.id ?? null;
    const f = fmtMetric(metric ?? null, units, { id: mid });
    const isNull = f.value === '—';
    const inferred = isInferred(metric);
    const v = metric?.validity ?? 'not_computed';
    const kind = validityKind(v);
    const tile = h(onClick ? 'button' : 'div', {
      class: `data-tile${isNull ? ' is-null' : ''}${inferred ? ' is-inferred' : ''}`, 'data-metric': mid, 'data-validity': v,
      type: onClick ? 'button' : null,
    });
    const code = isNull ? (metric?.reason_codes ?? [])[0] : null;
    // estimated / low confidence: a readable pill (glyph + word, as the vtag pills elsewhere); measured and null: words
    // for screen readers only (the number or its — already says it)
    const vtext = t(`validity.${kind === 'null' ? (NULL_VALIDITIES.has(v) ? v : 'not_measurable') : kind}`);
    const badge = estimatedBadge ?? t('tiles.estimated_badge');
    const estIn = inferred && kind === 'estimated';
    put(tile,
      h('span', { class: 'dt-label', text: label ?? (mid ? t(`metric.${mid}.label`) : '') }),
      h('span', { class: 'dt-value' }, h('span', { class: 'mt-num', text: f.value }), f.unit && !isNull ? h('span', { class: 'mt-unit', text: f.unit }) : null),
      f.ci ? h('span', { class: 'mt-ci', text: `± ${f.ci}` }) : null,
      kind === 'estimated' || kind === 'low_confidence'
        ? h('span', { class: `dt-mark vtag vtag-${kind === 'estimated' ? 'est' : 'low'}` }, h('span', { class: 'vtag-glyph', 'aria-hidden': 'true', text: VALIDITY_GLYPH[kind] }),
          h('span', estIn ? { class: 'dt-est', text: badge } : { text: vtext }))
        : h('span', { class: 'dt-mark visually-hidden', text: vtext }),
      inferred && !estIn ? h('span', { class: 'dt-est', text: badge }) : null,
      code && hasKey(`reason.${code}.short`) ? h('span', { class: 'dt-reason', text: t(`reason.${code}.short`) }) : null,
    );
    if (onClick) tile.addEventListener('click', (e) => onClick(e, mid));
    return testid(tile, tid);
  }

  // ---------------------------------------------------------------- StatePill
  function statePill({ state = 'ready', text = '', testid: tid } = {}) {
    const glyph = h('span', { class: 'sp-glyph', 'aria-hidden': 'true' });
    const label = h('span', { class: 'sp-text' });
    const el = h('div', { class: 'state-pill', role: 'status', 'aria-live': 'polite' }, glyph, label);
    el.update = (s, tx) => {
      const st = STATE_GLYPH[s] ? s : 'ready';
      el.setAttribute('data-state', st);
      glyph.textContent = STATE_GLYPH[st];
      label.textContent = tx ?? '';
    };
    el.update(state, text);
    return testid(el, tid);
  }

  // ---------------------------------------------------------------- Notice / EmptyState
  function notice({ variant = 'info', title, items = [], body, collapsible = false, testid: tid } = {}) {
    const v = ['info', 'caution', 'error'].includes(variant) ? variant : 'info';
    const ic = v === 'info' ? 'info' : 'alert';
    const list = items.length ? h('ul', { class: 'notice-items' }, items.map((x) => h('li', { text: x }))) : null;
    const bodyEl = body ? (typeof body === 'object' ? body : h('p', { class: 'notice-body', text: body })) : null;
    let el;
    if (collapsible && (list || bodyEl)) {
      el = h('details', { class: `notice notice-${v}` },
        h('summary', { class: 'notice-head' }, icon(ic), h('span', { class: 'notice-title', text: title ?? '' }), h('span', { class: 'notice-chev' }, icon('chevron-down'))),
        h('div', { class: 'notice-content' }, bodyEl, list));
    } else {
      el = h('div', { class: `notice notice-${v}`, role: v === 'error' ? 'alert' : null },
        h('div', { class: 'notice-head' }, icon(ic), h('span', { class: 'notice-title', text: title ?? '' })),
        bodyEl || list ? h('div', { class: 'notice-content' }, bodyEl, list) : null);
    }
    return testid(el, tid);
  }

  function emptyState({ icon: ic = 'info', title, body, action, testid: tid } = {}) {
    let act = null;
    if (action && typeof action === 'object' && 'nodeType' in action) act = action;
    else if (action) act = button({ label: action.label, variant: 'tinted', size: 'lg', onClick: action.onClick, testid: action.testid, icon: action.icon });
    const el = h('div', { class: 'empty-state' },
      h('div', { class: 'es-icon' }, icon(ic)),
      h('p', { class: 'es-title', text: title ?? '' }),
      body ? h('p', { class: 'es-body', text: body }) : null,
      act);
    return testid(el, tid);
  }

  // ---------------------------------------------------------------- Sheet / ConfirmSheet
  function sheet({ title, content, onClose, testid: tid } = {}) {
    const tid2 = nextId('sheet-title');
    const closeBtn = h('button', { type: 'button', class: 'sheet-close', 'aria-label': t('common.close') }, icon('x'));
    const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': tid2, tabindex: '-1' },
      h('div', { class: 'sheet-grabber', 'aria-hidden': 'true' }),
      h('div', { class: 'sheet-header' }, h('h2', { class: 'sheet-title', id: tid2, text: title ?? '' }), closeBtn),
      h('div', { class: 'sheet-body' }, content ?? null));
    const backdrop = h('div', { class: 'sheet-backdrop' }, panel);
    testid(panel, tid);
    let opener = null;
    let open = false;
    const focusables = () => [...(panel.querySelectorAll?.(FOCUSABLE) ?? [])];
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault?.(); api.close(); return; }
      if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) { e.preventDefault?.(); return; }
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && doc.activeElement === first) { e.preventDefault?.(); last.focus?.(); } else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault?.(); first.focus?.(); }
      }
    }
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) api.close(); });
    closeBtn.addEventListener('click', () => api.close());
    panel.addEventListener('keydown', onKey);
    const api = {
      el: panel,
      backdrop,
      isOpen: () => open,
      open() {
        if (open) return api;
        open = true;
        opener = doc.activeElement ?? null;
        (doc.body ?? doc.documentElement).append(backdrop);
        doc.documentElement?.classList?.add('sheet-open');
        const f = focusables();
        (f.find((x) => x !== closeBtn) ?? f[0] ?? panel).focus?.();
        return api;
      },
      close(result) {
        if (!open) return api;
        open = false;
        backdrop.remove();
        doc.documentElement?.classList?.remove('sheet-open');
        try { opener?.focus?.(); } catch (_) { /* opener gone */ }
        if (typeof onClose === 'function') onClose(result);
        return api;
      },
    };
    return api;
  }

  function confirmSheet({ title, consequence, confirmLabel, cancelLabel, destructive = false, testid: tid } = {}) {
    return new Promise((resolve) => {
      let answer = false;
      const yes = button({ label: confirmLabel ?? t('common.confirm'), variant: destructive ? 'destructive' : 'primary', size: 'lg', block: true, testid: tid ? `${tid}-confirm` : 'confirm-yes', onClick: () => { answer = true; s.close(true); } });
      const no = button({ label: cancelLabel ?? t('common.cancel'), variant: destructive ? 'primary' : 'secondary', size: 'lg', block: true, testid: tid ? `${tid}-cancel` : 'confirm-no', onClick: () => s.close(false) });
      const content = h('div', { class: 'confirm' }, consequence ? h('p', { class: 'confirm-consequence', text: consequence }) : null,
        h('div', { class: 'confirm-actions' }, destructive ? [no, yes] : [yes, no]));
      const s = sheet({ title, content, testid: tid, onClose: () => resolve(answer) });
      s.open();
      (destructive ? no : yes).focus?.();
    });
  }

  // ---------------------------------------------------------------- FilePicker
  function filePicker({ accept, multiple = false, label, testid: tid, onFiles, variant = 'button', id, hint } = {}) {
    const input = h('input', { type: 'file', class: 'visually-hidden', accept: accept ?? null, multiple: multiple || null, id: id ?? null });
    testid(input, tid);
    const text = label ?? t(multiple ? 'common.choose_files' : 'common.choose_file');
    const lab = h('label', { class: `file-picker fp-variant-${variant === 'zone' ? 'zone' : 'button'}` }, input,
      variant === 'zone'
        ? h('span', { class: 'fp-zone' }, icon('upload'), h('span', { class: 'fp-label', text }), h('span', { class: 'fp-hint', text: hint ?? t('common.drop_files') }))
        : h('span', { class: 'btn btn-tinted btn-lg fp-btn' }, h('span', { class: 'btn-main' }, icon('film'), h('span', { class: 'btn-label', text }))));
    input.addEventListener('change', () => { const files = [...(input.files ?? [])]; if (files.length && onFiles) onFiles(files); });
    if (variant === 'zone') {
      lab.addEventListener('dragover', (e) => { e.preventDefault?.(); lab.classList?.add('is-over'); });
      lab.addEventListener('dragleave', () => lab.classList?.remove('is-over'));
      lab.addEventListener('drop', (e) => { e.preventDefault?.(); lab.classList?.remove('is-over'); const files = [...(e.dataTransfer?.files ?? [])]; if (files.length && onFiles) onFiles(files); });
    }
    lab.input = input;
    return lab;
  }

  // ---------------------------------------------------------------- ProgressSteps
  function progressSteps({ steps = [], testid: tid, onCancel, cancelLabel } = {}) {
    const items = new Map();
    const ol = h('ol', { class: 'progress-steps' });
    for (const s of steps) {
      const st = h('span', { class: 'ps-state visually-hidden' });
      const li = h('li', { class: 'ps-step', 'data-step': s.id, 'data-state': 'pending' }, h('span', { class: 'ps-mark', 'aria-hidden': 'true' }), h('span', { class: 'ps-label', text: s.label }), st);
      items.set(s.id, { li, st });
      ol.append(li);
    }
    const etaEl = h('p', { class: 'ps-eta', 'aria-live': 'polite' });
    etaEl.hidden = true;
    const el = h('div', { class: 'progress' }, ol, etaEl,
      onCancel ? button({ label: cancelLabel ?? t('common.cancel'), variant: 'plain', size: 'md', onClick: onCancel, testid: tid ? `${tid}-cancel` : null }) : null);
    testid(el, tid);
    const STATES = ['pending', 'active', 'done', 'error'];
    return {
      el,
      set(id, state) {
        const it = items.get(id);
        if (!it) return;
        const s = STATES.includes(state) ? state : 'pending';
        it.li.setAttribute('data-state', s);
        it.st.textContent = t(`a11y.step_${s}`);
        if (s === 'active') it.li.setAttribute('aria-current', 'step'); else it.li.removeAttribute('aria-current');
      },
      eta(sec) {
        if (sec === null || sec === undefined || !Number.isFinite(sec)) { etaEl.hidden = true; etaEl.textContent = ''; return; }
        etaEl.hidden = false;
        etaEl.textContent = t('common.eta', { s: Math.max(1, Math.round(sec)) });
      },
      reset() { for (const id of items.keys()) this.set(id, 'pending'); this.eta(null); },
    };
  }

  // ---------------------------------------------------------------- ScreenHeader
  function screenHeader({ title, back = false, onBack, backLabel, actions } = {}) {
    const hd = h('header', { class: 'screen-header' });
    if (back) {
      const lbl = backLabel ?? t('common.back');
      hd.append(h('button', { type: 'button', class: 'back', 'aria-label': lbl, onclick: onBack ?? null }, icon('chevron-left'), h('span', { class: 'back-label', text: lbl })));
    }
    hd.append(h('h1', { tabindex: '-1', text: title ?? '' }));
    if (actions) hd.append(h('div', { class: 'sh-actions' }, actions));
    return hd;
  }

  // ---------------------------------------------------------------- Toast
  let infoTimer = null;
  function region(id, role) {
    let el = doc.getElementById?.(id);
    if (!el) {
      el = h('div', { id, class: id === 'toast' ? 'toast' : 'toast toast-error', role });
      if (role === 'status') el.setAttribute('aria-live', 'polite');
      el.hidden = true;
      (doc.body ?? doc.documentElement).append(el);
    }
    return el;
  }
  const toast = {
    info(text, { action, testid: tid, ms } = {}) {
      const el = region('toast', 'status');
      el.className = 'toast';
      el.replaceChildren(h('span', { class: 'toast-text', text: text ?? '' }));
      if (action) {
        el.append(button({ label: action.label, variant: 'plain', size: 'md', testid: action.testid, onClick: () => { toast.hide(); action.onClick?.(); } }));
      }
      if (tid) el.setAttribute('data-testid', tid); else el.removeAttribute('data-testid');
      el.hidden = false;
      timers.clearTimeout?.(infoTimer);
      const dur = Number.isFinite(ms) ? ms : 4000 + 60 * String(text ?? '').length;
      infoTimer = timers.setTimeout?.(() => { el.hidden = true; }, dur);
      return el;
    },
    error(text, { slot, testid: tid } = {}) {
      const el = region('toast-alert', 'alert');
      const close = button({ label: t('common.close'), variant: 'plain', size: 'md', onClick: () => { el.hidden = true; } });
      el.replaceChildren(h('span', { class: 'toast-glyph', 'aria-hidden': 'true' }, icon('alert')), h('span', { class: 'toast-text', text: text ?? '' }), close);
      if (tid) el.setAttribute('data-testid', tid); else el.removeAttribute('data-testid');
      el.hidden = false;
      const target = typeof slot === 'string' ? doc.querySelector?.(slot) : slot;
      if (target) target.append(h('p', { class: 'error-slot-msg', role: 'alert', text: text ?? '' }));
      return el;
    },
    hide() {
      const a = doc.getElementById?.('toast');
      if (a) a.hidden = true;
      const b = doc.getElementById?.('toast-alert');
      if (b) b.hidden = true;
    },
  };

  return {
    doc, h, icon, button, listRow, segmented, chipRow, switchRow, validityTag, metricTile, dataTile, statePill, notice, emptyState,
    sheet, confirmSheet, filePicker, progressSteps, screenHeader, toast, fmtNum,
  };
}

// ------------------------------------------------------------------ default (globalThis.document) bindings
let cached = null;
function C() {
  if (!cached || cached.doc !== globalThis.document) cached = createComponents(globalThis.document);
  return cached;
}
export const button = (o) => C().button(o);
export const listRow = (o) => C().listRow(o);
export const segmented = (o) => C().segmented(o);
export const chipRow = (o) => C().chipRow(o);
export const switchRow = (o) => C().switchRow(o);
export const validityTag = (v) => C().validityTag(v);
export const metricTile = (o) => C().metricTile(o);
export const dataTile = (o) => C().dataTile(o);
export const statePill = (o) => C().statePill(o);
export const notice = (o) => C().notice(o);
export const emptyState = (o) => C().emptyState(o);
export const sheet = (o) => C().sheet(o);
export const confirmSheet = (o) => C().confirmSheet(o);
export const filePicker = (o) => C().filePicker(o);
export const progressSteps = (o) => C().progressSteps(o);
export const screenHeader = (o) => C().screenHeader(o);
export const icon = (name, o) => C().icon(name, o);
export const toast = Object.freeze({
  info: (text, o) => C().toast.info(text, o),
  error: (text, o) => C().toast.error(text, o),
  hide: () => C().toast.hide(),
});
