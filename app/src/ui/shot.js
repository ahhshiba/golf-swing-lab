// ui/shot.js — the results screen (PRODUCT-SPEC §2.3; LAUNCH-MONITOR-SPEC §3.2, LM-D). Thin shell part: the top row,
// hero visual, data tiles, tile editor and recompute live in the lazy ui/tiles.js. Below them: one Notice for shared
// reasons · grouped compact tiles not already shown · disclosure of what was not measured (shot-unmeasured) · replay +
// event correction with undo, revision list and a confirm before leaving unsaved edits · actions (swing lab, tracer clip,
// share, delete; V04 §E/§D).
// The owner-label mode (P14) uses the teach editor on this one shot.
//
// Pure exports (tests): labelStartEvents, buildLabel, recomputeShot, splitMetrics.
import { h, clear } from './dom.js';
import * as C from './components.js';
import { t, has, fmtDateTime, plural } from '../i18n/index.js';
import { createReplay, checkMonotonic } from './replay.js';
import { EVENTS, BALL_CLUB_IDS, METRIC_IDS } from '../contract/enums.js';
import { bumpRevision, attributeWarnings } from '../contract/shot.js';
import { computeMetrics } from '../metrics/compute.js';
import { tempoMetrics } from '../metrics/common.js';
import { cellFor } from '../metrics/registry.js';
import { RC } from '../contract/reason-codes.js';
import { nowIso } from '../session/ids.js';
import { makeLabelRecord } from '../store/labels.js';
import { clubName, viewName, glossaryButton } from './glossary.js';
import { shotOps, shareOrDownload, fileStamp } from './history.js';
import { createLabelEditor } from './teach.js';

const TEMPO_IDS = Object.freeze(['backswing_s', 'downswing_s', 'tempo_ratio']);
const STATES = ['tiles', 'side', 'top', '3d', 'video'];

export const GROUPS = Object.freeze({
  tempo: Object.freeze(['backswing_s', 'downswing_s', 'tempo_ratio']),
  body: Object.freeze(['head_sway_x_m', 'head_lift_z_m', 'head_depth_y_m', 'spine_forward_tilt_deg', 'spine_side_tilt_deg',
    'shoulder_turn_deg', 'hip_turn_deg', 'x_factor_deg', 'hand_plane_dev_m', 'top_shaft_angle_deg', 'weight_shift_pct', 'early_extension_m']),
  ball: Object.freeze(['club_speed_mps', 'club_path_deg', 'ball_speed_mps', 'launch_v_deg', 'launch_h_deg', 'carry_m', 'smash_factor']),
});
const VIEW_LIMITED = new Set([RC.VIEW_DEPTH_AXIS, RC.VIEW_PLANE_MISMATCH, RC.LAUNCH_DIR_UNOBSERVABLE]);

const isNull = (m) => !m || m.value === null || m.value === undefined || !Number.isFinite(m.value);

/**
 * Split a shot's metrics for the card: { hero: [id], groups: { tempo|body|ball: [id] }, unmeasured: [id],
 * shared: [code], unique: { id: [code] } }; hero = the ids already shown as data tiles. A reason is "shared" when it is
 * a whole-shot warning or appears on ≥ 2 measured metrics; it is then shown once in the Notice and not on the tiles.
 */
export function splitMetrics(shot, hero = []) {
  const metrics = shot?.metrics ?? {};
  const ids = METRIC_IDS.filter((id) => id in metrics);
  const measured = ids.filter((id) => !isNull(metrics[id]));
  const unmeasured = ids.filter((id) => isNull(metrics[id]) && !hero.includes(id));
  const count = new Map();
  for (const id of measured) for (const c of metrics[id].reason_codes ?? []) count.set(c, (count.get(c) ?? 0) + 1);
  const warn = shot?.quality?.warnings ?? [];
  const shared = [...new Set([...warn, ...[...count].filter(([, n]) => n >= 2).map(([c]) => c)])];
  const unique = {};
  for (const id of ids) unique[id] = (metrics[id]?.reason_codes ?? []).filter((c) => !shared.includes(c));
  const groups = {};
  for (const [g, list] of Object.entries(GROUPS)) groups[g] = list.filter((id) => measured.includes(id) && !hero.includes(id));
  return { hero, groups, unmeasured, shared, unique };
}

/** Starting events of the annotation editor: the stored label when there is one, else the shot's events. */
export function labelStartEvents(shot, label = null) {
  const out = {};
  for (const n of EVENTS) {
    const l = label?.events?.[n];
    const e = shot?.events?.[n];
    if (l) out[n] = { frame: l.frame, t_s: l.t_s, conf: 1, source: 'manual' };
    else if (e) out[n] = { ...e };
  }
  return out;
}

/** P14: label record from the editor's events, or { error, code, params } — all 8 events, non-decreasing. */
export function buildLabel(shot, events, { previous = null, at, fps } = {}) {
  const missing = EVENTS.filter((n) => !Number.isFinite(events?.[n]?.frame));
  if (missing.length) {
    const params = { n: missing.length, events: missing };
    return { code: 'label.missing_events_n', params, error: t('label.missing_events_n', { n: missing.length, names: missing.map((n) => t(`event.${n}`)).join(t('label.list_sep')) }) };
  }
  const mono = checkMonotonic(events);
  if (!mono.ok) return { code: mono.code, params: mono.params, error: mono.message };
  try {
    return { record: makeLabelRecord({ shot_id: shot.shot_id, events, labelled_at: at, fps, previous }) };
  } catch (e) {
    const first = e.errors?.[0];
    return { code: first?.code ?? 'label.invalid', params: first?.params ?? {}, error: first ? t(first.code, first.params) : t('label.invalid') };
  }
}

/**
 * Recompute a shot after a manual event correction (pure apart from computeMetrics): pose metrics (F2 rows 1–13)
 * are recomputed from poseSeq when available (else only the event-based tempo row 1), ball/club metrics are kept.
 * Returns { ok, shot } or { ok: false, code, params, message }.
 */
export function recomputeShot(shot, events, { poseSeq = null, venue = null, at = null } = {}) {
  const mono = checkMonotonic(events);
  if (!mono.ok) return { ok: false, code: mono.code, params: mono.params, get message() { return mono.message; } };
  let metrics = shot.metrics;
  if (poseSeq) {
    const fresh = computeMetrics({
      view: shot.capture.view, fps: shot.capture.nominal_fps, poseSeq, events, calibration: shot.calibration,
      handedness: shot.handedness, venue: venue ?? undefined, club: shot.club,
    });
    metrics = { ...shot.metrics };
    for (const id of Object.keys(fresh)) if (!BALL_CLUB_IDS.includes(id)) metrics[id] = fresh[id];
  } else {
    const fps = shot.capture.nominal_fps;
    const cells = {};
    for (const id of TEMPO_IDS) { const c = cellFor(id, shot.capture.view, fps); if (c.validity) cells[id] = c.validity; }
    if (Object.keys(cells).length) {
      const tm = tempoMetrics(events, fps, cells);
      metrics = { ...shot.metrics };
      for (const id of Object.keys(cells)) metrics[id] = tm[id];
    }
  }
  const candidate = attributeWarnings({ ...shot, events, metrics });
  try {
    const next = bumpRevision(shot, { events: candidate.events, metrics: candidate.metrics }, { at });
    return { ok: true, shot: next };
  } catch (e) {
    return { ok: false, code: 'replay.error.save', params: {}, detail: String(e?.message ?? e), get message() { return t('replay.error.save'); } };
  }
}

const reasonShort = (c) => (has(`reason.${c}.short`) ? t(`reason.${c}.short`) : t('shot.reason.unknown'));
const reasonLong = (c) => (has(`reason.${c}.long`) ? t(`reason.${c}.long`) : reasonShort(c));

/** One metric tile inside a list item; keeps the .m-label / .m-value hooks of the older card. */
function tileItem(id, metric, size, units, reasons = []) {
  const tile = C.metricTile({ id, metric: metric ?? null, size, units });
  tile.querySelector('.mt-label')?.classList.add('m-label');
  const val = tile.querySelector('.mt-value');
  val?.classList.add('m-value');
  const ci = tile.querySelector('.mt-ci');
  if (ci && val) { ci.classList.add('mt-ci-inline'); val.append(ci); }
  tile.querySelector('.mt-head')?.append(glossaryButton(id));
  if (reasons.length) tile.append(h('ul.reasons.mt-reasons', {}, reasons.map((c) => h('li', reasonShort(c)))));
  return h('li', { class: `tile-item${isNull(metric) ? ' null' : ''}`, 'data-metric': id }, tile);
}

let tilesMod = null;

export function mountShot(root, app) {
  let replay = null;
  let lm = null;
  let ready = null;
  let data = null;
  let mode = 'result';
  let editor = null;
  let fromImport = false;
  const ops = shotOps(app);

  for (const st of STATES) app.e2e?.registerState('shot', st, async () => { await ready; return lm?.state(st) ?? false; });
  // V4-E's sheet states (shot:share, shot:share_ready) live in the lazy ui/share.js: registered there on first use
  for (const st of ['share', 'share_ready']) app.e2e?.registerState('shot', st, async (a) => { const m = await import('./share.js'); if (!m.registerShareStates) return false; m.registerShareStates(a); return a.e2e.runState('shot', st, a); });

  async function load(params) {
    tilesMod ??= await import('./tiles.js');
    const id = params.shot?.shot_id ?? params.shot_id;
    if (!app.repo || !id) return { shot: params.shot ?? null };
    const shot = (await app.repo.shots.get(id)) ?? params.shot ?? null;
    let poseSeq = null;
    let clip = null;
    let label = null;
    try { poseSeq = await app.repo.poses.get(id); } catch (_) { /* no poses */ }
    try { clip = (await app.repo.clips.list({ index: 'shot_id', query: id }))[0] ?? null; } catch (_) { /* no clip */ }
    try { label = await app.repo.labels.get(id); } catch (_) { /* store missing (old schema) */ }
    return { shot, poseSeq, clip, label };
  }

  async function leave() {
    if (replay?.dirty()) {
      const ok = await C.confirmSheet({ title: t('shot.leave.title'), consequence: t('shot.leave.body'), confirmLabel: t('shot.leave.discard'), cancelLabel: t('shot.leave.keep'), destructive: true, testid: 'shot-leave' });
      if (!ok) return;
    }
    app.nav.back('history');
  }

  function header(title, actions) {
    return C.screenHeader({ title, back: true, onBack: leave, backLabel: t(fromImport ? 'screen.import.title' : 'screen.history.title'), actions });
  }

  function metaLine(shot) {
    const bits = [fmtDateTime(shot.created_at), clubName(shot.club?.type), viewName(shot.capture?.view)];
    const meta = h('p.shot-meta', {}, bits.join(' · '));
    if (shot.revision > 0) meta.append(' ', h('span.tag-corrected', t('shot.corrected')));
    return meta;
  }

  function starButton(shot) {
    const b = h('button.icon-btn.star-btn', { type: 'button', 'data-testid': 'shot-star', 'aria-pressed': String(Boolean(shot.starred)), 'aria-label': t(shot.starred ? 'shot.unstar' : 'shot.star') }, C.icon(shot.starred ? 'star-filled' : 'star'));
    b.addEventListener('click', async () => {
      const on = !shot.starred;
      try {
        const next = await ops.setStar(shot, on);
        data = { ...data, shot: next ?? { ...shot, starred: on } };
        render();
        C.toast.info(t(on ? 'shot.starred' : 'shot.unstarred'));
      } catch (e) { app.errors?.report?.(e, { where: 'shot.star' }); }
    });
    return b;
  }

  async function del(shot) {
    try {
      await ops.softDelete(shot.shot_id);
      C.toast.info(t('shot.deleted'), { testid: 'undo-toast', ms: 10000, action: { label: t('common.undo'), testid: 'undo-toast-undo', onClick: () => { ops.restore(shot.shot_id).then(() => C.toast.info(t('shot.restored'))).catch((e) => app.errors?.report?.(e, { where: 'shot.restore' })); } } });
      if (replay) replay.markSaved();
      app.nav.back('history');
    } catch (e) { app.errors?.report?.(e, { where: 'shot.delete' }); }
  }

  async function share(shot) {
    const body = JSON.stringify({ format: 'golf-swing-lab-export/1', exported_at: nowIso(), app_version: app.version?.() ?? 'unknown', venues: [], presets: [], sessions: [], shots: [shot] }, null, 1);
    const name = `golf-swing-lab-shot-${fileStamp(shot.created_at)}.json`;
    await shareOrDownload(new Blob([body], { type: 'application/json' }), name, actionsOut, { title: t('shot.share.title') });
  }
  let actionsOut = null;
  // V04 §D.2: the tracer-clip / card sheet (V4-E, lazy)
  const clip = (shot) => import('./share.js').then((m) => m.openShareSheet(app, { kind: 'shot', shot, clipBlob: data.clip?.blob ?? null, poseSeq: data.poseSeq }))
    .catch((e) => app.errors?.report?.(e, { where: 'shot.clip' }));

  async function saveCorrection(events, why = 'edit') {
    const { shot, poseSeq } = data;
    const r = recomputeShot(shot, events, { poseSeq, at: nowIso() });
    if (!r.ok) { C.toast.error(r.message); return false; }
    try {
      if (app.repo) await app.repo.shots.put(r.shot);
      replay?.markSaved();
      C.toast.info(t(why === 'restore' ? 'shot.restored_original' : (poseSeq ? 'shot.correction_saved' : 'shot.correction_saved_tempo')));
      data = { ...data, shot: r.shot };
      render();
      return true;
    } catch (e) {
      app.errors?.report?.(e, { where: 'shot.correction' });
      return false;
    }
  }

  function revisionList(shot) {
    const hist = Array.isArray(shot.history) ? shot.history : [];
    if (!hist.length) return null;
    const first = hist.find((x) => x?.before?.events);
    const items = hist.map((x) => h('li', t('shot.revision.item', { at: x.at ? fmtDateTime(x.at) : t('common.unknown') })));
    const restore = first ? C.button({ label: t('shot.revision.restore'), variant: 'plain', size: 'md', testid: 'shot-restore-original', onClick: async () => {
      const ok = await C.confirmSheet({ title: t('shot.revision.restore_title'), consequence: t('shot.revision.restore_body'), confirmLabel: t('shot.revision.restore') });
      if (ok) saveCorrection(first.before.events, 'restore');
    } }) : null;
    return h('details.revisions', {}, h('summary', plural('shot.revision.summary', hist.length)), h('ul.rev-list', {}, items), restore);
  }

  function renderLabelMode() {
    const { shot } = data;
    editor?.destroy();
    editor = createLabelEditor({
      app, shot, poseSeq: data.poseSeq, clip: data.clip, label: data.label, showMeta: false,
      onSaved: (rec) => { data = { ...data, label: rec }; C.toast.info(t('label.saved', { n: rec.revision + 1 })); },
    });
    const modeBar = modeSwitch();
    clear(root, header(t('label.title')), metaLine(shot), modeBar, editor.el,
      h('p.hint', t('label.hint_export')));
  }

  function modeSwitch() {
    return C.segmented({
      options: [['result', t('shot.mode.result')], ['label', t(data.label ? 'shot.mode.label_done' : 'shot.mode.label')]],
      value: mode, label: t('shot.mode.label_group'), testid: 'shot-mode',
      onChange: async (v) => {
        if (v === mode) return;
        if (replay?.dirty()) {
          const ok = await C.confirmSheet({ title: t('shot.leave.title'), consequence: t('shot.leave.body'), confirmLabel: t('shot.leave.discard'), cancelLabel: t('shot.leave.keep'), destructive: true });
          if (!ok) { render(); return; }
        }
        mode = v; render();
      },
    });
  }

  function render() {
    replay?.destroy(); replay = null;
    editor?.destroy(); editor = null;
    lm?.destroy(); lm = null;
    const shot = data?.shot;
    if (!shot) {
      clear(root, header(t('screen.shot.title')), C.emptyState({ icon: 'alert', title: t('shot.missing.title'), body: t('shot.missing.body'), action: { label: t('screen.history.title'), onClick: () => app.nav.go('history') } }));
      return;
    }
    if (mode === 'label') { renderLabelMode(); return; }
    const units = app.units?.() ?? undefined;
    const metrics = shot.metrics ?? {};
    // 1. top row, hero visual, data tiles, recompute (ui/tiles.js)
    lm = tilesMod.createResults({
      app, shot, clip: data.clip, units,
      go: (id) => { if (!replay?.dirty()) app.nav.go('shot', { shot_id: id, from: fromImport ? 'import' : undefined }); else leave(); },
      onSaved: (next, key, p) => { data = { ...data, shot: next }; render(); C.toast.info(t(`tiles.${key}`, p)); },
      onPreview: async (other, tab) => { data = { ...data, shot: other, clip: null, poseSeq: null }; render(); await lm?.selectTab(tab); return true; },
    });
    // no flight: the hero already shows the swing tempo card, so the result list below does not repeat it
    const sp = splitMetrics(shot, [...lm.ids(), ...(lm.tempoShown ? TEMPO_IDS : [])]);
    // 2. notices
    const shared = sp.shared.map(reasonLong);
    const notes = shared.length ? C.notice({ variant: 'caution', title: plural('shot.notices.title', shared.length), items: shared, collapsible: true, testid: 'shot-notices' }) : null;
    // 3. grouped sections
    const sections = Object.entries(sp.groups).filter(([, ids]) => ids.length).map(([g, ids]) =>
      h('section.card.metric-group', { 'data-group': g }, h('h2', t(`shot.group.${g}`)),
        h('ul.tile-grid', {}, ids.map((id) => tileItem(id, metrics[id], 'compact', units, sp.unique[id] ?? [])))));
    // 4. not measured
    const viewLimited = sp.unmeasured.some((id) => (metrics[id]?.reason_codes ?? []).some((c) => VIEW_LIMITED.has(c)));
    const unmeasured = sp.unmeasured.length ? h('details.card.unmeasured', { 'data-testid': 'shot-unmeasured' },
      h('summary', {}, h('span', plural('shot.unmeasured.summary', sp.unmeasured.length)), h('span.um-chev', {}, C.icon('chevron-down'))),
      h('ul.um-list', {}, sp.unmeasured.map((id) => {
        const m = metrics[id];
        const codes = m?.reason_codes ?? [];
        return h('li.null.um-row', { 'data-metric': id },
          h('div.m-head', {}, h('span.m-label', has(`metric.${id}.label`) ? t(`metric.${id}.label`) : id), h('span.m-value', '—')),
          h('ul.reasons', {}, codes.length ? codes.map((c) => h('li', reasonLong(c))) : h('li', t('shot.unmeasured.not_computed'))));
      })),
      viewLimited ? h('p.hint', t(shot.capture?.view === 'face_on' ? 'shot.unmeasured.tip_dtl' : 'shot.unmeasured.tip_face_on')) : null) : null;
    // 5. replay + correction
    const fps = shot.capture?.effective_fps ?? shot.capture?.nominal_fps ?? 60;
    const first = (shot.history ?? []).find((x) => x?.before?.events);
    const saveBtn = C.button({ label: t('shot.correction.save'), variant: 'primary', size: 'lg', block: true, testid: 'event-save', reason: t('shot.correction.nothing') });
    const status = h('p.replay-status', { role: 'status' });
    replay = createReplay({
      clipBlob: data.clip?.blob ?? null, poseSeq: data.poseSeq, fps, events: shot.events, detected: first?.before?.events ?? shot.events,
      onEventsChange: (_ev, { dirty, ok, check }) => {
        saveBtn.setReason(!dirty ? t('shot.correction.nothing') : (!ok ? check.message : null));
        status.textContent = dirty && ok ? t('shot.correction.pending') : '';
      },
    });
    saveBtn.addEventListener('click', () => { if (replay?.dirty()) saveCorrection(replay.events()); });
    const replayCard = h('section.card.replay-card', {}, h('h2', t('shot.replay.title')), replay.el, status, saveBtn, revisionList(shot));
    // 6. actions
    actionsOut = h('div.export-out', {});
    const actions = h('section.card.shot-actions', {},
      h('div.action-row', {},
        C.button({ label: t('screen.lab.title'), icon: 'level', variant: 'secondary', size: 'lg', testid: 'shot-lab', onClick: () => app.nav.go('lab', { shot_id: shot.shot_id }) }),
        C.button({ label: t('shot.share.clip'), icon: 'film', variant: 'secondary', size: 'lg', testid: 'shot-share-clip', onClick: () => clip(shot) }),
        C.button({ label: t('shot.share.button'), icon: 'share', variant: 'secondary', size: 'lg', testid: 'shot-share', onClick: () => share(shot) }),
        C.button({ label: t('common.delete'), icon: 'trash', variant: 'destructive', size: 'lg', testid: 'shot-delete', onClick: () => del(shot) })),
      actionsOut);
    const next = fromImport ? C.button({ label: t('shot.import_next'), icon: 'film', variant: 'primary', size: 'lg', block: true, testid: 'shot-import-next', onClick: () => app.nav.go('import', { next: true }) }) : null;

    // one .metric-list container: the e2e hook of the results card (every metric is a [data-metric] item inside)
    clear(root,
      header(t('screen.shot.title'), [lm.nav, starButton(shot)]),
      next, lm.top, lm.viz, lm.tiles, lm.rederive,
      h('div.metric-list.shot-metrics', {}, notes, modeSwitch(), ...sections, unmeasured),
      replayCard, actions);
  }

  return {
    async show(params = {}) {
      mode = params.mode === 'label' ? 'label' : 'result';
      fromImport = params.from === 'import';
      clear(root, header(t('screen.shot.title')), h('p.hint', t('common.loading')));
      lm?.destroy(); lm = null;
      let done;
      ready = new Promise((r) => { done = r; });
      try { data = await load(params); render(); done(); } catch (e) {
        done();
        app.errors?.report?.(e, { where: 'shot.load', silent: true });
        clear(root, header(t('screen.shot.title')), C.emptyState({ icon: 'alert', title: t('shot.load_failed.title'), body: t('shot.load_failed.body'), action: { label: t('common.retry'), onClick: () => this.show(params) } }));
      }
    },
    hide() { replay?.destroy(); replay = null; editor?.destroy(); editor = null; lm?.destroy(); lm = null; },
    dirty: () => Boolean(replay?.dirty()),
  };
}
