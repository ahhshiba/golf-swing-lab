// ui/diag.js — Diagnostics screen (P11, PRODUCT-SPEC §4.3, V19, R12): a human summary first (camera, decoder, storage,
// offline readiness, protection from deletion, home-screen app, recent errors with local times), then 複製報告 /
// 儲存為檔案 (diag-save: a JSON file through the share sheet or a download) and the raw JSON in a collapsed disclosure.
// The report itself comes from diag/report.js buildReport(); every visible string is a catalog key (namespace `diag`).

import { h, clear } from './dom.js';
import { button, listRow, screenHeader, toast, icon } from './components.js';
import { t, has, fmtDateTime, fmtNum } from '../i18n/index.js';

/** Back-button label naming the screen Back returns to (the previous nav stack entry), else the generic "Back". */
function prevTitle(app) {
  const last = app.nav?.stack?.()?.at?.(-1);
  const prev = typeof last === 'string' ? last : last?.screen; // nav.stack() lists screen ids
  return prev && has(`screen.${prev}.title`) ? t(`screen.${prev}.title`) : undefined;
}

const ROW_ICONS = Object.freeze({
  version: 'info', camera_fps: 'camera', camera_size: 'camera', decoder: 'film', pose: 'target', storage: 'download',
  persisted: 'lock', offline: 'check', standalone: 'phone-portrait', errors: 'alert',
});
const MAX_ERRORS = 10;
const MB = 1048576;

/** Local-date file name: golf-swing-lab-diag-YYYYMMDD-HHMM.json (no ids, no time zone names). */
export function diagFileName(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `golf-swing-lab-diag-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

function rowValue(row) {
  const v = row.value;
  if (v === null || v === undefined) return t('diag.value.unknown');
  switch (row.id) {
    case 'camera_fps': return t('diag.value.fps', { n: fmtNum(v) });
    case 'decoder': return t(`diag.value.decoder_${v}`);
    case 'storage': return t('diag.value.storage', { used: fmtNum(v.usage / MB), quota: fmtNum(v.quota / MB) });
    case 'offline': return v >= 1 ? t('diag.value.offline_ready') : t('diag.value.percent', { n: fmtNum(100 * v) });
    case 'persisted': case 'standalone': return v ? t('diag.value.yes') : t('diag.value.no');
    case 'errors': return fmtNum(v);
    default: return String(v);
  }
}

function stateText(ok) {
  return ok === true ? t('diag.state.ok') : ok === false ? t('diag.state.check') : t('diag.state.unknown');
}

function stateIcon(ok) {
  const s = h('span.lr-chevron', { 'aria-hidden': 'true' });
  s.append(icon(ok === true ? 'check' : ok === false ? 'alert' : 'info'));
  return s;
}

export function mountDiag(root, app) {
  let json = '';
  let rep = null;

  async function build() {
    const mod = app.deps?.diagReport ?? (await import('../diag/report.js').catch(() => null));
    if (mod?.buildReport) return { rep: await mod.buildReport(), summarize: mod.summarize };
    return { rep: { schema: 'gsl-device-report/1', app_version: app.version?.() ?? null, recorded: app.localDiag ?? {}, events: [] }, summarize: null };
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(json);
      toast.info(t('diag.copied'));
    } catch (_) {
      const pre = root.querySelector('#diag-json');
      const det = root.querySelector('details.diag-raw');
      if (det) det.open = true;
      if (pre) {
        const r = document.createRange();
        r.selectNodeContents(pre);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      }
      toast.info(t('diag.copy_failed'));
    }
  }

  async function save() {
    const name = diagFileName();
    const blob = new Blob([json], { type: 'application/json' });
    try {
      const file = typeof File === 'function' ? new File([blob], name, { type: 'application/json' }) : null;
      if (file && navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title: name });
        app.record?.('diag.saved', 'share');
        return;
      }
    } catch (e) {
      if (e?.name === 'AbortError') return; // the user closed the share sheet
    }
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name, hidden: true });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    app.record?.('diag.saved', 'download');
    toast.info(t('diag.saved', { name }));
  }

  function errorRows(events) {
    const errs = (Array.isArray(events) ? events : []).filter((e) => e && e.kind !== 'info').slice(-MAX_ERRORS).reverse();
    if (!errs.length) return [h('p.hint', { 'data-testid': 'diag-no-errors' }, t('diag.errors.none'))];
    return [h('div.list-group', { 'data-testid': 'diag-errors' }, errs.map((e) => listRow({
      icon: 'alert',
      title: has(`error.${e.code}`) ? t(`error.${e.code}`) : t('error.INTERNAL'),
      subtitle: e.at ? fmtDateTime(e.at) : t('diag.value.unknown'),
    })))];
  }

  function render(summarize) {
    const rows = typeof summarize === 'function' ? summarize(rep) : [];
    const summary = h('div.list-group', { 'data-testid': 'diag-summary' }, rows.map((r) => {
      // a row that needs attention says why and what to do (diag.fix.<id>), not only "Needs attention"
      const fix = r.ok === false && has(`diag.fix.${r.id}`) ? t(`diag.fix.${r.id}`) : null;
      const sub = fix ? `${stateText(r.ok)} · ${fix}` : r.id === 'decoder' && r.value === 'video' ? `${stateText(r.ok)} · ${t('diag.value.decoder_video_hint')}` : stateText(r.ok);
      const row = listRow({ icon: ROW_ICONS[r.id] ?? 'info', title: t(`diag.row.${r.id}`), subtitle: sub, value: rowValue(r) });
      row.dataset.row = r.id;
      row.dataset.ok = r.ok === null ? 'unknown' : String(r.ok);
      (row.querySelector('.lr-end') ?? row).append(stateIcon(r.ok)); // beside the value, so they wrap together
      return row;
    }));
    const raw = h('details.notice.diag-raw', {},
      h('summary.notice-head', {}, icon('info'), h('span.notice-title', t('diag.raw')), h('span.notice-chev', {}, icon('chevron-down'))),
      h('pre.report', { id: 'diag-json' }, json));
    clear(root,
      screenHeader({ title: t('diag.title'), back: true, onBack: () => app.nav.back(), backLabel: prevTitle(app) }),
      h('p.hint', t('diag.intro')),
      summary,
      h('h2', t('diag.errors.title')),
      ...errorRows(rep?.events),
      h('div.row', {},
        button({ label: t('diag.copy'), variant: 'primary', size: 'lg', icon: 'share', testid: 'diag-copy', onClick: copy }),
        button({ label: t('diag.save'), variant: 'secondary', size: 'lg', icon: 'download', testid: 'diag-save', onClick: save })),
      raw,
      button({ label: t('diag.refresh'), variant: 'plain', size: 'md', testid: 'diag-refresh', onClick: () => show() }));
  }

  async function show() {
    clear(root, screenHeader({ title: t('diag.title'), back: true, onBack: () => app.nav.back(), backLabel: prevTitle(app) }), h('p.hint', { role: 'status' }, t('diag.building')));
    let summarize = null;
    try {
      const r = await build();
      rep = r.rep;
      summarize = r.summarize;
      json = JSON.stringify(rep, null, 2);
    } catch (e) {
      rep = { error: String(e?.message ?? e), events: [] };
      json = JSON.stringify(rep, null, 2);
    }
    render(summarize);
  }

  return { show, hide() {} };
}
