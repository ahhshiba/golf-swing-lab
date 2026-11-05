// ui/venues.js — venue list with edit / rename / set default / delete (UX-12). Used by the venue screen
// (nav.go('venue', { list: true })) and by Settings › Venues (F): mountVenues(root, app, { header }) -> { show(), hide() }.
// Delete asks with a ConfirmSheet and also removes that venue's camera presets; shots keep their venue id.
import { h, clear } from './dom.js';
import { button, listRow, sheet, confirmSheet, screenHeader, emptyState, icon } from './components.js';
import { t, has, fmtNum, fmtDate } from '../i18n/index.js';

/** Back-button label naming the screen Back returns to (the previous nav stack entry), else the generic "Back". */
function prevTitle(app) {
  const last = app.nav?.stack?.()?.at?.(-1);
  const prev = typeof last === 'string' ? last : last?.screen; // nav.stack() lists screen ids
  return prev && has(`screen.${prev}.title`) ? t(`screen.${prev}.title`) : undefined;
}
import { saveSettings } from '../session/settings.js';

const DEFAULT_ID = 'venue-default';

export function mountVenues(root, app, { header = false } = {}) {
  let venues = [];
  let presets = [];
  const save = (patch) => { const s = saveSettings(patch); app.updateSettings?.(s); return s; };

  async function load() {
    if (!app.repo) { venues = []; presets = []; return; }
    try {
      venues = (await app.repo.venues.list()).filter((v) => v.venue_id !== DEFAULT_ID).sort((a, b) => String(b.updated_at ?? b.created_at).localeCompare(String(a.updated_at ?? a.created_at)));
      presets = await app.repo.presets.list();
    } catch (e) { app.errors?.report?.(e, { where: 'venues.load' }); }
  }

  function rename(v) {
    const input = h('input', { type: 'text', id: 'venue-rename', value: v.name ?? '', maxlength: 60, autocomplete: 'off' });
    let sh = null;
    const ok = button({
      label: t('common.save'), variant: 'primary', size: 'lg', block: true, testid: 'venue-rename-save',
      onClick: async () => {
        const name = input.value.trim();
        if (!name) return;
        try { await app.repo.venues.put({ ...v, name, updated_at: new Date().toISOString() }); } catch (e) { app.errors.report(e, { where: 'venues.rename' }); }
        sh.close();
        await refresh();
      },
    });
    sh = sheet({ title: t('venue.list.rename'), content: h('div', {}, h('label.field', {}, h('span.field-label', t('venue.name.label')), input), ok) });
    sh.open();
    input.focus?.();
  }

  async function remove(v) {
    const n = presets.filter((p) => p.venue_id === v.venue_id).length;
    const yes = await confirmSheet({ title: t('venue.list.delete_title', { name: v.name || t('home.venue.unnamed') }), consequence: t('venue.list.delete_body', { n }), confirmLabel: t('common.delete'), destructive: true, testid: 'venue-delete' });
    if (!yes) return;
    try {
      for (const p of presets.filter((x) => x.venue_id === v.venue_id)) await app.repo.presets.delete(p.preset_id);
      await app.repo.venues.delete(v.venue_id);
    } catch (e) { app.errors.report(e, { where: 'venues.delete' }); }
    if (app.settings().lastVenueId === v.venue_id) save({ lastVenueId: null });
    if (app.store.get().venueId === v.venue_id) app.store.set({ venueId: null, presetId: null });
    app.toast.info(t('venue.list.deleted'));
    await refresh();
  }

  function actions(v) {
    let sh = null;
    const isDefault = app.settings().lastVenueId === v.venue_id;
    const row = (ic, label, fn, variant) => h('button.list-row', { type: 'button', class: `list-row${variant === 'danger' ? ' is-danger' : ''}`, onclick: () => { sh.close(); fn(); } }, h('span.lr-icon', {}, icon(ic)), h('span.lr-text', {}, h('span.lr-title', label)));
    sh = sheet({
      title: v.name || t('home.venue.unnamed'),
      content: h('div.list-group', {},
        row('ruler', t('venue.list.edit'), () => app.nav.go('venue', { venue_id: v.venue_id })),
        row('undo', t('venue.list.rename'), () => rename(v)),
        isDefault ? null : row('star', t('venue.list.make_default'), async () => { save({ lastVenueId: v.venue_id }); app.store.set({ venueId: v.venue_id, presetId: null }); await refresh(); }),
        row('trash', t('venue.list.delete'), () => remove(v), 'danger')),
    });
    sh.open();
  }

  function render() {
    const def = app.settings().lastVenueId;
    const kids = [];
    if (header) kids.push(screenHeader({ title: t('venue.list.title'), back: true, onBack: () => app.nav.back(), backLabel: prevTitle(app) }));
    if (!venues.length) {
      kids.push(emptyState({ icon: 'ruler', title: t('venue.list.empty_title'), body: t('venue.list.empty_body'), action: { label: t('home.venue.add'), onClick: () => app.nav.go('venue'), testid: 'venues-add' } }));
    } else {
      kids.push(h('div.list-group', { 'data-testid': 'venue-list' }, venues.map((v) => {
        const np = presets.filter((p) => p.venue_id === v.venue_id).length;
        const sub = [t('home.venue.dims', { L: fmtNum(v.mat_L, { digits: 2 }), W: fmtNum(v.mat_W, { digits: 2 }) }), np ? t('venue.list.presets', { n: np }) : null, v.f_locked ? t('venue.list.flocked') : null].filter(Boolean).join(' · ');
        return listRow({ icon: v.venue_id === def ? 'star-filled' : 'ruler', title: v.name || t('home.venue.unnamed'), subtitle: sub, value: v.venue_id === def ? t('venue.list.default') : fmtDate(v.updated_at ?? v.created_at), testid: 'venue-row', onClick: () => actions(v) });
      })));
      kids.push(button({ label: t('home.venue.add'), variant: 'tinted', size: 'lg', block: true, icon: 'ruler', testid: 'venues-add', onClick: () => app.nav.go('venue') }));
    }
    clear(root, ...kids);
  }

  async function refresh() { await load(); render(); }

  return {
    async show() { render(); await refresh(); },
    hide() {},
  };
}
