// ui/teach.js — "Teach the swing detector" (package C; PRODUCT-SPEC §7.4, UX-10 / EV-7 UI). The owner confirms the 8
// swing events of shots that still have their video, one tap per event when the detection is right ("正確 ✓",
// teach-accept), or scrubs and taps 設為這一幀 when it is not; after the 8th event the label is saved and the next
// shot opens. A correct swing costs 8 taps. 匯出訓練集 writes one golf-swing-lab-labels/1 file (pose sequences +
// labels, no video) for scripts/train_owner.sh / scripts/eval_owner_set.mjs. Everything stays on the phone.
//
//   createLabelEditor({ app, shot, poseSeq, clip, label, onSaved(record), onDone() }) -> { el, destroy() }
//   mountTeach(root, app, { onBack }) -> { show(), hide() }   (screen 'teach'; history mounts it inline otherwise)
//   teachQueue(repo) -> Promise<shot[]>   unlabelled shots that have a clip, newest first
import { h, clear } from './dom.js';
import * as C from './components.js';
import { t, plural, fmtDateTime } from '../i18n/index.js';
import { EVENTS } from '../contract/enums.js';
import { createReplay } from './replay.js';
import { labelStartEvents, buildLabel } from './shot.js';
import { nowIso } from '../session/ids.js';
import { exportLabelSet } from '../store/export.js';
import { clubName, viewName } from './glossary.js';
import { shareOrDownload, fileStamp, shotOps } from './history.js';

export const TEACH_TARGET = 20; // labelled swings before the owner-set gate starts (PRODUCT-SPEC §7.3)

export async function teachQueue(repo, { isDeleted = () => false } = {}) {
  if (!repo) return [];
  if (typeof repo.labels?.unlabelledWithClips === 'function') {
    try { return (await repo.labels.unlabelledWithClips()).filter((s) => !isDeleted(s)); } catch (_) { /* fall back */ }
  }
  const snap = await repo.snapshot(['shots', 'clips', 'labels']);
  const labelled = new Set(snap.labels.map((l) => l.shot_id));
  const withClip = new Set(snap.clips.filter((c) => c.blob || c.bytes > 0).map((c) => c.shot_id));
  return snap.shots
    .filter((s) => withClip.has(s.shot_id) && !labelled.has(s.shot_id) && !isDeleted(s) && s.events)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

export function createLabelEditor({ app, shot, poseSeq = null, clip = null, label = null, onSaved = () => {}, onDone = () => {}, showMeta = true }) {
  const fps = shot.capture?.effective_fps ?? shot.capture?.nominal_fps ?? 60;
  const confirmed = new Set(label ? EVENTS : []);
  let cur = EVENTS.find((n) => !confirmed.has(n)) ?? EVENTS[0];
  let saving = false;
  let saved = Boolean(label);
  let record = label;

  const status = h('p.label-status', { 'data-testid': 'label-status', role: 'status' });
  const prompt = h('p.teach-prompt', {});
  const replay = createReplay({
    clipBlob: clip?.blob ?? null, poseSeq, fps, events: labelStartEvents(shot, label), detected: shot.events,
    onEventsChange: (_ev, { ok, check }) => {
      // a frame was set (設為這一幀 / drag / arrows): that event is confirmed by the owner
      confirmed.add(replay.selected());
      saved = false;
      if (!ok) { status.textContent = check.message; status.classList.add('bad'); paint(); return; }
      status.classList.remove('bad');
      advance();
    },
  });

  const rows = new Map();
  const list = h('ul.label-list', { 'aria-label': t('label.list') }, EVENTS.map((n, i) => {
    const mark = h('span.lbl-mark', { 'aria-hidden': 'true' }, String(i + 1));
    const name = h('span.lbl-name', t(`event.${n}`));
    const fr = h('span.lbl-frame', '');
    const b = h('button.label-row', { type: 'button', 'data-testid': `label-row-${n}`, 'data-event': n }, mark, name, fr);
    b.addEventListener('click', () => go(n));
    const li = h('li', {}, b);
    rows.set(n, { li, b, mark, fr });
    return li;
  }));

  const accept = C.button({ label: t('teach.accept'), icon: 'check', variant: 'primary', size: 'xl', block: true, testid: 'teach-accept', onClick: () => { confirmed.add(cur); saved = false; advance(); } });
  const save = C.button({ label: t('label.save'), variant: 'secondary', size: 'lg', block: true, testid: 'label-save', onClick: () => persist() });

  function go(n) {
    cur = n;
    replay.select(n);
    const e = replay.events()[n];
    if (e) replay.seekFrame(e.frame);
    paint();
  }

  function advance() {
    const next = EVENTS.find((n) => !confirmed.has(n));
    if (next) { go(next); return; }
    paint();
    if (!saved) persist();
  }

  async function persist() {
    if (saving) return;
    const left = EVENTS.filter((n) => !confirmed.has(n));
    if (left.length) { status.textContent = plural('label.left', left.length); status.classList.add('bad'); return; }
    const r = buildLabel(shot, replay.events(), { previous: record, at: nowIso(), fps });
    if (r.error) { status.textContent = r.error; status.classList.add('bad'); return; }
    if (!app.repo) { C.toast.error(t('error.REPO_UNAVAILABLE')); return; }
    saving = true;
    try {
      await app.repo.labels.put(r.record);
      record = r.record;
      saved = true;
      status.classList.remove('bad');
      status.textContent = t('label.saved', { n: r.record.revision + 1 });
      onSaved(r.record);
      paint();
      onDone(r.record);
    } catch (e) {
      app.errors?.report?.(e, { where: 'teach.save' });
    } finally { saving = false; }
  }

  function paint() {
    const ev = replay.events();
    for (const n of EVENTS) {
      const r = rows.get(n);
      const e = ev[n];
      const done = confirmed.has(n);
      r.fr.textContent = e ? t('label.frame', { f: e.frame }) : '—';
      r.mark.textContent = done ? '✓' : String(EVENTS.indexOf(n) + 1);
      r.b.classList.toggle('is-done', done);
      r.b.classList.toggle('is-current', n === cur);
      r.b.setAttribute('aria-current', n === cur ? 'step' : 'false');
      r.b.setAttribute('aria-label', t(done ? 'label.row_done' : 'label.row_todo', { event: t(`event.${n}`), f: e?.frame ?? '—' }));
    }
    const k = EVENTS.indexOf(cur) + 1;
    prompt.textContent = confirmed.size === EVENTS.length ? t('teach.all_done') : t('teach.prompt', { k, event: t(`event.${cur}`) });
    accept.setReason(confirmed.size === EVENTS.length ? t('teach.all_done_short') : null);
    if (!status.classList.contains('bad') && !saved) status.textContent = t('label.count', { n: confirmed.size });
    save.hidden = !(confirmed.size === EVENTS.length && !saved);
  }

  const el = h('div.label-editor', {},
    showMeta ? h('p.teach-shot', [fmtDateTime(shot.created_at), clubName(shot.club?.type), viewName(shot.capture?.view)].join(' · ')) : null,
    replay.el, list, status, save);
  // the decision sits right under the picture: prompt + 正確, then the timeline / frame controls to adjust
  const tl = replay.el.querySelector('.tl-wrap');
  replay.el.insertBefore(h('div.teach-decide', {}, prompt, accept, h('p.hint', t('teach.adjust_hint'))), tl);
  go(cur);
  return { el, destroy: () => replay.destroy() };
}

export function mountTeach(root, app, { onBack } = {}) {
  let queue = [];
  let labelled = 0;
  let editor = null;
  let idx = 0;
  const ops = shotOps(app);

  async function load() {
    queue = await teachQueue(app.repo, { isDeleted: ops.isDeleted });
    try { labelled = app.repo ? await app.repo.labels.count() : 0; } catch (_) { labelled = 0; }
    idx = 0;
  }

  const back = () => (onBack ? onBack() : app.nav.back('history'));

  async function exportSet(outEl, btn) {
    try {
      btn.setDisabled(true);
      const data = await exportLabelSet(app.repo, { app_version: app.version?.() });
      if (!data.swings.length) { C.toast.info(t('teach.export.empty')); return; }
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      await shareOrDownload(blob, `golf-swing-lab-labels-${fileStamp()}.json`, outEl, { title: t('teach.export.button') });
    } catch (e) { app.errors?.report?.(e, { where: 'teach.export' }); } finally { btn.setDisabled(false); }
  }

  async function openShot(shot) {
    let poseSeq = null;
    let clip = null;
    try { poseSeq = await app.repo.poses.get(shot.shot_id); } catch (_) { /* none */ }
    try { clip = (await app.repo.clips.list({ index: 'shot_id', query: shot.shot_id }))[0] ?? null; } catch (_) { /* none */ }
    return createLabelEditor({
      app, shot, poseSeq, clip, label: null,
      onSaved: () => { labelled += 1; },
      onDone: () => { C.toast.info(t('teach.saved_next')); idx += 1; render(); },
    });
  }

  async function render() {
    editor?.destroy(); editor = null;
    const out = h('div.export-out', { 'aria-live': 'polite' });
    const exportBtn = C.button({ label: t('teach.export.button'), icon: 'share', variant: 'secondary', size: 'lg', block: true, testid: 'teach-export', reason: labelled ? null : t('teach.export.none') });
    exportBtn.addEventListener('click', () => exportSet(out, exportBtn));
    const progress = h('p.teach-progress', { 'data-testid': 'teach-progress', role: 'status' }, t('teach.progress', { done: labelled, target: TEACH_TARGET }));
    const bar = h('div.teach-bar', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(TEACH_TARGET), 'aria-valuenow': String(Math.min(labelled, TEACH_TARGET)), 'aria-label': t('teach.progress_label') },
      h('span.teach-bar-fill', { style: { transform: `scaleX(${Math.min(1, labelled / TEACH_TARGET)})` } }));
    const intro = h('details.card.teach-intro', {}, h('summary', t('teach.intro.title')),
      h('p', t('teach.intro.body')), h('p.hint', t('teach.intro.privacy')));
    const shot = queue[idx] ?? null;
    let main;
    if (!shot) {
      main = C.emptyState({ icon: 'check', title: t(labelled ? 'teach.empty.done' : 'teach.empty.none'), body: t('teach.empty.body'), testid: 'teach-empty' });
    } else {
      editor = await openShot(shot);
      const skip = C.button({ label: t('teach.skip'), variant: 'plain', size: 'md', testid: 'teach-skip', onClick: () => { idx += 1; render(); } });
      main = h('section.card.teach-card', {}, h('h2', t('teach.shot_n', { k: idx + 1, n: queue.length })), editor.el, skip);
    }
    clear(root,
      C.screenHeader({ title: t('screen.teach.title'), back: true, onBack: back, backLabel: t('screen.history.title') }),
      progress, bar, intro, main,
      h('section.card', {}, h('h2', t('teach.export.title')), h('p.hint', t('teach.export.hint')), exportBtn, out));
  }

  return {
    async show() {
      clear(root, C.screenHeader({ title: t('screen.teach.title'), back: true, onBack: back }), h('p.hint', t('common.loading')));
      try { await load(); } catch (e) { app.errors?.report?.(e, { where: 'teach.load' }); }
      await render();
    },
    hide() { editor?.destroy(); editor = null; },
  };
}
