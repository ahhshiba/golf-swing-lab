// ui/lab.js — swing lab for one shot (params.shot_id): alignment lines over the replay, 8 phase cards, fault chips,
// frame / fault stepping, practice cards (V04-SPEC §E). Without a shot_id (home entry) it asks to pick a swing and
// links to the patterns screen. Lazy screen 'lab' (styles/screens/lab.css). Owner V4-F.
//
// View discipline (F2): lines and faults come from lab/lines.js and lab/faults.js, which only draw / judge what the
// shot's camera position can see; `unknown` results are listed apart ("cannot tell from this view") and never as a
// problem. Confidence is words (likely / possible), plus the validity tag; no percentages.
// The lab record (golf-lab/1) is recomputed on every open and stored in repo.lab (derived data, never exported);
// records of an older LAB_PARAMS.version are dropped once per session (repo.lab.deleteStale).
// testids: lab-empty, lab-pick (rows), lab-to-patterns, lab-replay, lab-mark (▲ on the timeline), lab-frame-prev/next,
// lab-fault-prev/next, lab-step-status, lab-lines, lab-line (one per line this view draws; data-line, data-drawn),
// lab-dynamic, lab-fault (chips; data-fault, data-status), lab-fault-sheet, lab-unknown, lab-phase (8; data-event),
// lab-drill (data-drill), lab-drill-start, lab-sensitivity, lab-no-pose, lab-hb-note.
// e2e states (tests/e2e/screenshot_matrix.mjs): lab:lines, lab:phase, lab:fault.
import { h, clear } from './dom.js';
import * as C from './components.js';
import { t, has, fmtDateTime } from '../i18n/index.js';
import { fmtMetric } from '../i18n/units.js';
import { saveSettings } from '../session/settings.js';
import { clubName, viewName } from './glossary.js';
import { createReplay, nearestIndex, POSE_EDGES } from './replay.js';
import { normalizeLab } from '../lab/settings.js';
import { computeLines, LINES_BY_VIEW } from '../lab/lines.js';
import { drawLines, overlayPalette } from '../lab/overlay.js';
import { evaluateFaults, faultValidity, confidenceKey, shownFaults } from '../lab/faults.js';
import { LAB_PARAMS, ruleFor } from '../lab/params.js';
import { phaseCards, faultMarks, stepFault } from '../lab/phases.js';
import { drillsFor, drillsForView } from '../lab/drills.js';

/** Display id for a lab value of a unit (fmtMetric picks body vs distance from the id). */
const UNIT_ID = { m: 'early_extension_m', deg: 'spine_forward_tilt_deg', '%': 'weight_shift_pct', '': 'tempo_ratio' };
const ruleUnit = (id) => (/_m$/.test(id) ? 'm' : /_deg$/.test(id) ? 'deg' : /_pct$/.test(id) ? '%' : /_s$/.test(id) ? 's' : null);
const reasonShort = (c) => (has(`reason.${c}.short`) ? t(`reason.${c}.short`) : c);
const faultName = (id) => t(`fault.${id}`);
let staleChecked = false;

/** A golf-lab/1 record for a shot (lab/faults.js), stored in repo.lab when there is one. */
export async function labRecordFor(app, shot, poseSeq) {
  const settings = normalizeLab(app.settings?.()?.lab);
  const rec = evaluateFaults({ shot, poseSeq, view: shot.capture?.view, fps: shot.capture?.nominal_fps ?? 30, settings });
  try {
    if (!staleChecked) { staleChecked = true; await app.repo?.lab?.deleteStale?.(LAB_PARAMS.version); }
    await app.repo?.lab?.put?.(rec);
  } catch (e) { app.errors?.report?.(e, { where: 'lab.store', silent: true }); }
  return rec;
}

/** The validity tag + confidence words of a judged fault: the shared vtag pill, then "likely" / "possible". */
function judgement(f, shot) {
  const v = faultValidity(f, shot);
  const k = confidenceKey(f);
  return h('span.lab-judge', {}, k ? h('span.lab-conf', t(`lab.confidence.${k}`)) : null, v ? C.validityTag(v) : null);
}

function valueText(f, view, units) {
  const rule = ruleFor(f.id, view);
  const id = rule.kind === 'metric' ? rule.key : UNIT_ID[rule.unit] ?? 'tempo_ratio';
  const val = fmtMetric({ value: f.value, unit: rule.unit || null, sigma: f.sigma }, units, { id });
  const thr = fmtMetric({ value: f.threshold, unit: rule.unit || null }, units, { id });
  return { value: val.text, threshold: thr.text, op: rule.op === '<' || (rule.op === 'outside' && f.value < f.threshold) ? '<' : '>' };
}

export function mountLab(root, app) {
  let replay = null;
  let data = null; // { shot, poseSeq, clip, rec, lines, marks }
  let settings = normalizeLab(app.settings?.()?.lab);
  let ready = Promise.resolve();
  let sheet = null;
  const live = new Map(); // pose frame -> live lines
  const units = () => app.units?.() ?? undefined;

  const header = () => C.screenHeader({ title: app.screenTitle('lab'), back: true, onBack: () => app.nav.back() });

  function save(patch) {
    settings = normalizeLab({ ...settings, ...patch });
    try { app.updateSettings?.(saveSettings({ lab: settings })); } catch (_) { /* private mode: this session only */ }
  }

  // ------------------------------------------------------------------ picker (no shot)
  async function picker() {
    let shots = [];
    try { shots = (await app.repo?.queryShots?.({ reverse: true, limit: 30 })) ?? []; } catch (_) { shots = []; }
    shots = shots.filter((s) => !s.deleted_at && !s.deleted).slice(0, 12);
    const toPatterns = C.button({ label: t('lab.pick.patterns'), icon: 'history', variant: 'tinted', size: 'lg', block: true, testid: 'lab-to-patterns', onClick: () => app.nav.go('patterns') });
    if (!shots.length) {
      clear(root, header(), C.emptyState({ icon: 'level', title: t('lab.pick.title'), body: t('lab.pick.body'), action: { label: t('lab.pick.patterns'), onClick: () => app.nav.go('patterns'), testid: 'lab-to-patterns' }, testid: 'lab-empty' }));
      return;
    }
    clear(root, header(),
      h('p.lab-lead', t('lab.pick.lead')),
      h('section.card.lab-pick', {}, h('h2', t('lab.pick.recent')),
        h('div.list-group', {}, shots.map((s) => C.listRow({ icon: 'level', title: `${clubName(s.club?.type)} · ${viewName(s.capture?.view)}`, subtitle: fmtDateTime(s.created_at), testid: 'lab-pick',
          onClick: () => app.nav.go('lab', { shot_id: s.shot_id }) })))),
      toPatterns);
  }

  // ------------------------------------------------------------------ load
  async function load(id) {
    const shot = await app.repo?.shots?.get(id);
    if (!shot) return null;
    let poseSeq = null;
    let clip = null;
    try { poseSeq = await app.repo.poses.get(id); } catch (_) { /* no poses */ }
    try { clip = (await app.repo.clips.list({ index: 'shot_id', query: id }))[0] ?? null; } catch (_) { /* no clip */ }
    const rec = await labRecordFor(app, shot, poseSeq);
    const view = shot.capture?.view;
    const lines = computeLines({ view, poseSeq, events: shot.events, calibration: shot.calibration, handedness: shot.handedness ?? 'right' });
    return { shot, poseSeq, clip, rec, lines, marks: faultMarks(shot, rec) };
  }

  // ------------------------------------------------------------------ replay + overlay
  const fpsOf = (shot) => shot.capture?.effective_fps ?? shot.capture?.nominal_fps ?? 60;
  function liveLines(tt) {
    const { shot, poseSeq } = data;
    if (!poseSeq?.t_s?.length) return null;
    const i = nearestIndex(poseSeq.t_s, tt);
    if (!live.has(i)) {
      if (live.size > 400) live.clear();
      live.set(i, computeLines({ view: shot.capture.view, poseSeq, events: shot.events, calibration: shot.calibration, handedness: shot.handedness ?? 'right', frame: i }));
    }
    return live.get(i);
  }

  function replayCard() {
    const { shot, poseSeq, clip, lines, marks } = data;
    const fps = fpsOf(shot);
    const status = h('p.lab-step-status', { role: 'status', 'data-testid': 'lab-step-status' });
    replay = createReplay({
      clipBlob: clip?.blob ?? null, poseSeq, fps, events: shot.events, editable: false, showControls: false,
      onDraw: (g, { t: tt }) => drawLines(g, lines, { palette: overlayPalette(root), enabled: settings.lines, live: settings.dynamic ? liveLines(tt) : null }),
    });
    const track = replay.el.querySelector('.tl-track');
    const markEls = marks.map((m) => {
      const el = h('span.lab-mark', { 'aria-hidden': 'true', 'data-testid': 'lab-mark', 'data-fault': m.id, 'data-status': m.status }, '▲');
      track?.append(el);
      return [el, m];
    });
    const placeMarks = () => {
      const dur = replay?.duration?.() || 0;
      for (const [el, m] of markEls) { el.style.left = dur > 0 ? `${Math.min(100, (m.frame / fps / dur) * 100)}%` : '0%'; el.hidden = !(dur > 0); }
    };
    replay.el.querySelector('video')?.addEventListener('loadedmetadata', placeMarks);
    queueMicrotask(placeMarks);
    const fPrev = C.button({ label: t('lab.frame.prev'), icon: 'step-back', size: 'lg', variant: 'secondary', testid: 'lab-frame-prev', onClick: () => { replay.seekFrame(replay.frame() - 1); paint(); } });
    const fNext = C.button({ label: t('lab.frame.next'), icon: 'step-forward', size: 'lg', variant: 'secondary', testid: 'lab-frame-next', onClick: () => { replay.seekFrame(replay.frame() + 1); paint(); } });
    const step = (dir) => {
      const m = stepFault(marks, replay.frame(), dir);
      if (!m) return;
      replay.seekFrame(m.frame);
      status.textContent = t('lab.step.at', { fault: faultName(m.id), event: t(`event.${m.event}`) });
      paint(m.frame);
    };
    const qPrev = C.button({ label: t('lab.fault.prev'), size: 'lg', variant: 'secondary', testid: 'lab-fault-prev', onClick: () => step(-1) });
    const qNext = C.button({ label: t('lab.fault.next'), size: 'lg', variant: 'secondary', testid: 'lab-fault-next', onClick: () => step(1) });
    function paint(f = replay.frame()) {
      qPrev.setDisabled(!stepFault(marks, f, -1));
      qNext.setDisabled(!stepFault(marks, f, 1));
    }
    replay.el.querySelector('video')?.addEventListener('seeked', () => paint());
    queueMicrotask(() => paint());
    return h('section.card.lab-replay', { 'data-testid': 'lab-replay' }, h('h2', t('lab.replay.title')), replay.el,
      h('div.lab-step', {}, fPrev, fNext), h('div.lab-step', {}, qPrev, qNext), status,
      marks.length ? null : h('p.hint', t('lab.step.none')));
  }

  // ------------------------------------------------------------------ lines
  function linesCard() {
    const { shot, lines } = data;
    const view = shot.capture?.view;
    const rows = LINES_BY_VIEW[view].map((id) => {
      const line = lines[id];
      if (!line) {
        const why = (lines.reasons?.[id] ?? []).map(reasonShort).join(' · ');
        return h('div.lab-line.is-off', { 'data-testid': 'lab-line', 'data-line': id, 'data-drawn': 'false' },
          h('span.lab-line-name', t(`lab.line.${id}`)), h('span.lab-line-why', why));
      }
      const row = C.switchRow({ label: t(`lab.line.${id}`), checked: settings.lines.includes(id), hint: line.validity === 'low_confidence' ? t('validity.low_confidence') : null,
        onChange: (on) => { save({ lines: on ? [...settings.lines, id] : settings.lines.filter((x) => x !== id) }); replay?.redraw?.(); } });
      row.classList.add('lab-line');
      Object.assign(row.dataset, { testid: 'lab-line', line: id, drawn: 'true' });
      return row;
    });
    const dyn = C.switchRow({ label: t('lab.dynamic'), checked: settings.dynamic, testid: 'lab-dynamic', onChange: (on) => { save({ dynamic: on }); replay?.redraw?.(); } });
    const hidden = Object.keys(lines).filter((id) => !LINES_BY_VIEW[view].includes(id));
    return h('section.card.lab-lines', { 'data-testid': 'lab-lines' }, h('h2', t('lab.lines.title')),
      view === 'high_behind' ? h('p.lab-note', { 'data-testid': 'lab-hb-note' }, t('lab.hb_note')) : null,
      h('div.lab-line-list', {}, rows), dyn, h('p.hint', t('lab.lines.hint')),
      hidden.length ? h('details.lab-more', {}, h('summary', t('lab.lines.not_here', { n: hidden.length })),
        h('ul.lab-why', {}, hidden.map((id) => h('li', `${t(`lab.line.${id}`)} — ${(lines.reasons?.[id] ?? []).map(reasonShort).join(' · ')}`)))) : null);
  }

  // ------------------------------------------------------------------ faults
  function faultChip(f, onTap) {
    const b = h('button.lab-fault-chip', { type: 'button', 'data-testid': 'lab-fault', 'data-fault': f.id, 'data-status': f.status },
      h('span.lab-fault-name', faultName(f.id)), judgement(f, data.shot));
    b.addEventListener('click', () => onTap(f));
    return b;
  }

  function openFault(f) {
    const { shot } = data;
    const ev = f.event ? shot.events?.[f.event] : null;
    if (ev && Number.isFinite(ev.frame)) replay?.seekFrame(ev.frame);
    const vt = valueText(f, shot.capture?.view, units());
    const drills = drillsFor(f.id);
    sheet?.close();
    sheet = C.sheet({ title: faultName(f.id), testid: 'lab-fault-sheet', content: h('div.lab-sheet', {},
      h('p.lab-sheet-judge', {}, judgement(f, shot)),
      h('p', t(`lab.what.${f.id}`)),
      h('dl.lab-kv', {},
        h('dt', t('lab.detail.value')), h('dd', vt.value),
        h('dt', t('lab.detail.threshold')), h('dd', `${vt.op} ${vt.threshold}`),
        h('dt', t('lab.detail.phase')), h('dd', f.event ? t(`event.${f.event}`) : t('lab.detail.whole'))),
      f.reason_codes.length ? h('ul.reasons', {}, f.reason_codes.map((c) => h('li', reasonShort(c)))) : null,
      h('p.hint', t('lab.detail.note')),
      drills.length ? h('div.lab-drills', {}, drills.map(drillCard)) : null) });
    sheet.open();
  }

  function faultsCard() {
    const { rec } = data;
    const shown = shownFaults(rec);
    const ok = rec.faults.filter((f) => f.status === 'ok');
    const unknown = rec.faults.filter((f) => f.status === 'unknown');
    return h('section.card.lab-faults', {}, h('h2', t('lab.faults.title')),
      shown.length ? h('div.lab-chips', {}, shown.map((f) => faultChip(f, openFault))) : h('p.lab-none', t('lab.faults.none')),
      ok.length ? h('p.hint.lab-ok', t('lab.faults.ok', { list: ok.map((f) => faultName(f.id)).join(t('lab.list_sep')) })) : null,
      unknown.length ? h('details.lab-more', { 'data-testid': 'lab-unknown' }, h('summary', t('lab.faults.unknown', { n: unknown.length })),
        h('ul.lab-why', {}, unknown.map((f) => h('li', `${faultName(f.id)} — ${f.reason_codes.map(reasonShort).join(' · ')}`)))) : null,
      h('p.hint', t('lab.faults.note')),
      sensitivityRow());
  }

  function sensitivityRow() {
    const g = C.segmented({ options: [['standard', t('lab.sensitivity.standard')], ['relaxed', t('lab.sensitivity.relaxed')]], value: settings.sensitivity, label: t('lab.sensitivity.label'), testid: 'lab-sensitivity',
      onChange: async (v) => { save({ sensitivity: v }); await reload(); } });
    return h('div.lab-sens', {}, h('p.lab-sens-label', t('lab.sensitivity.label')), g, h('p.hint', t('lab.sensitivity.hint')));
  }

  // ------------------------------------------------------------------ phases
  function phasesCard() {
    const { shot, rec } = data;
    const cards = phaseCards(shot, rec);
    const els = cards.map((c) => {
      // a thumbnail needs a saved clip or the pose: without either there is nothing honest to draw
      const cv = data.clip?.blob || data.poseSeq?.t_s?.length ? h('canvas.lab-thumb', { width: 96, height: 128, 'aria-hidden': 'true' }) : null;
      const tiles = c.metrics.map((id) => C.dataTile({ metric: shot.metrics[id], id, units: units() }));
      const b = h('button.lab-phase', { type: 'button', 'data-testid': 'lab-phase', 'data-event': c.event, disabled: c.frame === null,
        'aria-label': t('lab.phase.aria', { event: t(`event.${c.event}`), n: c.faults.length }) },
      cv, h('span.lab-phase-body', {}, h('span.lab-phase-name', t(`event.${c.event}`)),
        c.faults.length ? h('span.lab-phase-faults', {}, c.faults.map((f) => h('span.lab-mini', { 'data-fault': f.id }, `▲ ${faultName(f.id)}`))) : null));
      b.addEventListener('click', () => { if (c.frame !== null) { replay?.seekFrame(c.frame); root.querySelector('.lab-replay')?.scrollIntoView?.({ block: 'start' }); } });
      return { el: h('div.lab-phase-wrap', {}, b, tiles.length ? h('div.lab-phase-tiles', {}, tiles) : null), cv, c };
    });
    queueMicrotask(() => thumbs(els));
    return h('section.card.lab-phases', {}, h('h2', t('lab.phases.title')), h('div.lab-phase-list', {}, els.map((x) => x.el)));
  }

  /** Phase thumbnails: the clip frame when a clip is saved, else the pose skeleton on the media background. */
  async function thumbs(els) {
    const { clip, poseSeq } = data;
    const ink = getComputedStyle(root).getPropertyValue('--overlay-select').trim();
    const bg = getComputedStyle(root).getPropertyValue('--media-bg').trim();
    let video = null;
    if (clip?.blob) {
      video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.preload = 'auto';
      video.src = URL.createObjectURL(clip.blob);
    }
    try {
      for (const { cv, c } of els) {
        if (!cv || c.t_s === null || !cv.isConnected) continue;
        const g = cv.getContext('2d');
        if (!g) continue;
        g.fillStyle = bg; g.fillRect(0, 0, cv.width, cv.height);
        if (video) {
          const ok = await new Promise((res) => {
            const done = (v) => { clearTimeout(to); video.removeEventListener('seeked', on); res(v); };
            const on = () => done(true);
            const to = setTimeout(() => done(false), 1500);
            video.addEventListener('seeked', on);
            try { video.currentTime = c.t_s; } catch (_) { done(false); }
          });
          if (ok && video.videoWidth) {
            const k = Math.max(cv.width / video.videoWidth, cv.height / video.videoHeight);
            const w = video.videoWidth * k; const hh = video.videoHeight * k;
            g.drawImage(video, (cv.width - w) / 2, (cv.height - hh) / 2, w, hh);
            continue;
          }
        }
        if (poseSeq?.t_s?.length) skeleton(g, cv, poseSeq, nearestIndex(poseSeq.t_s, c.t_s), ink);
      }
    } finally {
      if (video) { URL.revokeObjectURL(video.src); video.removeAttribute('src'); }
    }
  }

  function skeleton(g, cv, seq, i, ink) {
    const W = seq.W || 1; const H = seq.H || 1;
    const k = Math.min(cv.width / W, cv.height / H);
    const ox = (cv.width - W * k) / 2; const oy = (cv.height - H * k) / 2;
    const o = i * 33 * 4;
    const P = (j) => [ox + seq.img[o + 4 * j] * W * k, oy + seq.img[o + 4 * j + 1] * H * k, seq.img[o + 4 * j + 3]];
    g.strokeStyle = ink; g.lineWidth = 2; g.lineCap = 'round';
    for (const [a, b] of POSE_EDGES) {
      const pa = P(a); const pb = P(b);
      if (pa[2] < 0.3 || pb[2] < 0.3) continue;
      g.beginPath(); g.moveTo(pa[0], pa[1]); g.lineTo(pb[0], pb[1]); g.stroke();
    }
  }

  // ------------------------------------------------------------------ drills
  function drillCard(d) {
    const s = d.success;
    const metric = t(`metric.${d.metric}.label`);
    const fmt = (v) => fmtMetric({ value: v, unit: ruleUnit(d.metric) }, units(), { id: d.metric }).text;
    const check = s.clear ? t('lab.drill.check.clear', { n: s.n, of: s.of, fault: faultName(s.clear) })
      : Number.isFinite(s.above) && Number.isFinite(s.below)
      ? t('lab.drill.check.between', { n: s.n, of: s.of, metric, lo: fmt(s.above), hi: fmt(s.below) })
      : Number.isFinite(s.below) ? t('lab.drill.check.below', { n: s.n, of: s.of, metric, v: fmt(s.below) })
        : t('lab.drill.check.above', { n: s.n, of: s.of, metric, v: fmt(s.above) });
    const steps = t(`lab.drill.${d.id}.steps`).split('\n').filter(Boolean);
    return h('article.lab-drill', { 'data-testid': 'lab-drill', 'data-drill': d.id, 'data-metric': d.metric },
      h('h3', t(`lab.drill.${d.id}.title`)),
      h('p.lab-drill-meta', `${faultName(d.fault)} · ${viewName(d.view)}`),
      h('p', t(`lab.drill.${d.id}.goal`)),
      h('ol.lab-steps', {}, steps.map((x) => h('li', x))),
      h('p.lab-check', check),
      C.button({ label: t('lab.drill.start'), icon: 'play', variant: 'primary', size: 'lg', block: true, testid: 'lab-drill-start',
        onClick: () => { sheet?.close(); app.nav.go('live', { focus: d.metric, view: d.view, drill: d.id }); } }));
  }

  function drillsCard() {
    const { shot, rec } = data;
    const found = [...new Set(shownFaults(rec).map((f) => f.id))];
    const mine = found.flatMap(drillsFor);
    const others = drillsForView(shot.capture?.view).filter((d) => !mine.includes(d));
    return h('section.card.lab-drills-card', {}, h('h2', t('lab.drills.title')),
      mine.length ? h('div.lab-drills', {}, mine.map(drillCard)) : h('p.hint', t('lab.drills.none')),
      others.length ? h('details.lab-more', { 'data-testid': 'lab-drills-more' }, h('summary', t('lab.drills.more', { n: others.length })), h('div.lab-drills', {}, others.map(drillCard))) : null);
  }

  // ------------------------------------------------------------------ render
  function render() {
    replay?.destroy(); replay = null; live.clear();
    const { shot, poseSeq } = data;
    const meta = h('p.shot-meta', {}, [fmtDateTime(shot.created_at), clubName(shot.club?.type), viewName(shot.capture?.view)].join(' · '));
    clear(root, header(), meta,
      poseSeq?.t_s?.length ? null : C.notice({ variant: 'info', title: t('lab.no_pose.title'), body: t('lab.no_pose.body'), testid: 'lab-no-pose' }),
      replayCard(), faultsCard(), linesCard(), phasesCard(), drillsCard(),
      C.button({ label: t('lab.pick.patterns'), icon: 'history', variant: 'tinted', size: 'lg', block: true, testid: 'lab-to-patterns', onClick: () => app.nav.go('patterns') }));
  }

  let current = null;
  async function reload() {
    if (!current) return;
    data = await load(current);
    if (data) render();
  }

  async function show(params = {}) {
    sheet?.close(); sheet = null;
    settings = normalizeLab(app.settings?.()?.lab);
    current = params.shot_id ?? params.shot?.shot_id ?? null;
    if (!current) { replay?.destroy(); replay = null; data = null; await picker(); return; }
    clear(root, header(), h('p.hint', t('common.loading')));
    try {
      data = await load(current);
      if (!data) { clear(root, header(), C.emptyState({ icon: 'alert', title: t('shot.missing.title'), body: t('shot.missing.body'), testid: 'lab-missing' })); return; }
      render();
    } catch (e) {
      app.errors?.report?.(e, { where: 'lab.load', silent: true });
      clear(root, header(), C.emptyState({ icon: 'alert', title: t('shot.load_failed.title'), body: t('shot.load_failed.body'), action: { label: t('common.retry'), onClick: () => show(params) } }));
    }
  }

  // e2e states: open the lab on a stored swing (a dtl one when there is one), then the named part
  const openSome = async () => {
    if (!data) {
      const shots = (await app.repo?.queryShots?.({ reverse: true }).catch(() => [])) ?? [];
      const s = shots.find((x) => x.capture?.view === 'dtl') ?? shots[0];
      if (s) { ready = show({ shot_id: s.shot_id }); await ready; }
    }
    return Boolean(data);
  };
  app.e2e?.registerState?.('lab', 'lines', async () => { if (await openSome()) root.querySelector('.lab-lines')?.scrollIntoView?.({ block: 'start' }); });
  app.e2e?.registerState?.('lab', 'phase', async () => {
    if (!(await openSome())) return;
    const p = root.querySelector('[data-testid="lab-phase"][data-event="impact"]') ?? root.querySelector('[data-testid="lab-phase"]');
    p?.click(); p?.scrollIntoView?.({ block: 'start' });
  });
  app.e2e?.registerState?.('lab', 'fault', async () => {
    if (!(await openSome())) return;
    const chip = root.querySelector('[data-testid="lab-fault"]');
    if (chip) chip.click();
    else { const u = root.querySelector('[data-testid="lab-unknown"]'); if (u) { u.open = true; u.scrollIntoView?.({ block: 'start' }); } }
  });

  return {
    show(params) { ready = show(params); return ready; },
    hide() { sheet?.close(); sheet = null; replay?.destroy(); replay = null; },
  };
}

