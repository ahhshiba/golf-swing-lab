// ui/shot.js — P6 results card (every metric: value ± ci95, validity badge, Chinese reasons for nulls), replay
// with skeleton overlay and frame stepping, event correction → recompute → bumpRevision (non-monotonic rejected).
// P14 「標註」 mode: the owner sets all 8 events frame by frame on the same replay and saves an annotation record
// (store `labels`, store/labels.js) — the shot itself is not changed, so the detector can be scored against it
// (scripts/eval_owner_set.mjs).

import { h, clear, card, toast, screenHeader, badge } from './dom.js';
import { VIEW_LABELS, metricRows, reasonTexts, EVENT_LABELS } from './format.js';
import { createReplay, checkMonotonic } from './replay.js';
import { EVENTS, BALL_CLUB_IDS } from '../contract/enums.js';
import { bumpRevision, attributeWarnings } from '../contract/shot.js';
import { computeMetrics } from '../metrics/compute.js';
import { tempoMetrics } from '../metrics/common.js';
import { cellFor } from '../metrics/registry.js';

const TEMPO_IDS = Object.freeze(['backswing_s', 'downswing_s', 'tempo_ratio']);
import { nowIso } from '../session/ids.js';
import { makeLabelRecord } from '../store/labels.js';

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

/** P14: label record from the editor's events, or { error } (Chinese) — all 8 events, non-decreasing. */
export function buildLabel(shot, events, { previous = null, at, fps } = {}) {
  const missing = EVENTS.filter((n) => !Number.isFinite(events?.[n]?.frame));
  if (missing.length) return { error: `還有 ${missing.length} 個事件沒有標：${missing.map((n) => EVENT_LABELS[n]).join('、')}` };
  const mono = checkMonotonic(events);
  if (!mono.ok) return { error: mono.message };
  try {
    return { record: makeLabelRecord({ shot_id: shot.shot_id, events, labelled_at: at, fps, previous }) };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Recompute a shot after a manual event correction (pure apart from computeMetrics): pose metrics (F2 rows 1–13)
 * are recomputed from poseSeq when available (else only the event-based tempo row 1), ball/club metrics are kept. Returns { ok, shot | message }.
 */
export function recomputeShot(shot, events, { poseSeq = null, venue = null, at = null } = {}) {
  const mono = checkMonotonic(events);
  if (!mono.ok) return { ok: false, message: mono.message };
  let metrics = shot.metrics;
  if (poseSeq) {
    const fresh = computeMetrics({
      view: shot.capture.view, fps: shot.capture.nominal_fps, poseSeq, events, calibration: shot.calibration,
      handedness: shot.handedness, venue: venue ?? undefined, club: shot.club,
    });
    metrics = { ...shot.metrics };
    for (const id of Object.keys(fresh)) if (!BALL_CLUB_IDS.includes(id)) metrics[id] = fresh[id];
  } else {
    // no stored pose sequence: tempo (F2 row 1) depends on the events only, the other pose rows are kept
    const fps = shot.capture.nominal_fps;
    const cells = {};
    for (const id of TEMPO_IDS) { const c = cellFor(id, shot.capture.view, fps); if (c.validity) cells[id] = c.validity; }
    if (Object.keys(cells).length) {
      const t = tempoMetrics(events, fps, cells);
      metrics = { ...shot.metrics };
      for (const id of Object.keys(cells)) metrics[id] = t[id];
    }
  }
  const candidate = attributeWarnings({ ...shot, events, metrics });
  try {
    const next = bumpRevision(shot, { events: candidate.events, metrics: candidate.metrics }, { at });
    return { ok: true, shot: next };
  } catch (e) {
    return { ok: false, message: `無法儲存修正：${e.message}` };
  }
}

export function mountShot(root, app) {
  let replay = null;

  async function load(params) {
    const id = params.shot?.shot_id ?? params.shot_id;
    if (!app.repo || !id) return { shot: params.shot ?? null };
    const shot = (await app.repo.shots.get(id)) ?? params.shot ?? null;
    let poseSeq = null;
    let clip = null;
    try { poseSeq = await app.repo.poses.get(id); } catch (_) { /* ignore */ }
    try { clip = (await app.repo.clips.list({ index: 'shot_id', query: id }))[0] ?? null; } catch (_) { /* ignore */ }
    let label = null;
    try { label = await app.repo.labels.get(id); } catch (_) { /* store missing (old schema) */ }
    return { shot, poseSeq, clip, label };
  }

  let mode = 'result'; // 'result' | 'label' (P14)

  function renderLabel(data) {
    const { shot, poseSeq = null, clip = null, label = null } = data;
    const fps = shot.capture?.effective_fps ?? shot.capture?.nominal_fps ?? 60;
    let current = labelStartEvents(shot, label);
    const msg = h('p.status', { 'data-testid': 'label-status' }, label ? `已有標註（第 ${label.revision} 版，${String(label.labelled_at).slice(0, 16).replace('T', ' ')}）` : '逐幀移到每個事件，按「設為這一幀」；8 個都設好再儲存。');
    const items = new Map();
    const list = h('ul.label-list', {}, EVENTS.map((n) => {
      const fr = h('span.lbl-frame', '');
      const set = h('button', { type: 'button', 'data-testid': `label-set-${n}`, onclick: () => { touched.add(n); replay.setEventAt(n); } }, '設為這一幀');
      const go = h('button', { type: 'button', onclick: () => { const e = current[n]; if (e) replay.seek(e.t_s); } }, '跳到');
      const li = h('li', {}, h('span', EVENT_LABELS[n]), fr, h('span.row', {}, go, set));
      items.set(n, { li, fr });
      return li;
    }));
    const touched = new Set(label ? EVENTS : []);
    const paint = () => {
      for (const n of EVENTS) {
        const it = items.get(n);
        const e = current[n];
        it.fr.textContent = e ? `第 ${e.frame} 幀${touched.has(n) ? '' : '（偵測值）'}` : '—';
        it.li.className = touched.has(n) ? 'set' : '';
      }
    };
    replay = createReplay({ clipBlob: clip?.blob ?? null, poseSeq, fps, events: current, onEventsChange: (ev) => {
      for (const n of EVENTS) if (ev[n] && (!current[n] || ev[n].frame !== current[n].frame)) touched.add(n); // dragged
      current = ev;
      const m = checkMonotonic(ev);
      msg.textContent = m.ok ? `已設 ${touched.size}／8 個事件` : m.message;
      msg.className = m.ok ? 'status' : 'status bad';
      paint();
    } });
    paint();
    const save = h('button.primary', { type: 'button', 'data-testid': 'label-save' }, '儲存標註');
    save.addEventListener('click', async () => {
      const left = EVENTS.filter((n) => !touched.has(n));
      if (left.length) { msg.textContent = `還有 ${left.length} 個事件沒有確認（按「設為這一幀」）：${left.map((n) => EVENT_LABELS[n]).join('、')}`; msg.className = 'status bad'; return; }
      const r = buildLabel(shot, current, { previous: label, at: nowIso(), fps });
      if (r.error) { msg.textContent = r.error; msg.className = 'status bad'; return; }
      if (!app.repo) { toast('資料庫無法使用，標註沒有保存'); return; }
      try {
        await app.repo.labels.put(r.record);
        toast(`已儲存標註（第 ${r.record.revision} 版）`);
        render({ ...data, label: r.record });
      } catch (e) { toast(`儲存失敗：${e.message}`); }
    });
    return card('標註 8 個事件（P14）', replay.el, list, msg, save,
      h('p.hint', '標註只存成標註集，不會改這一球的數據；在「歷史」匯出 JSON 時勾選「包含標註」，再用 scripts/eval_owner_set.mjs 評估事件偵測。'));
  }

  function render(data) {
    const { shot, poseSeq = null, clip = null, label = null } = data;
    replay?.destroy();
    replay = null;
    if (!shot) { clear(root, screenHeader('結果', () => app.nav.back()), h('p', '找不到這一球。')); return; }
    const modeBar = h('div.shot-mode', {},
      h('button', { type: 'button', 'aria-pressed': String(mode === 'result'), 'data-testid': 'shot-mode-result', onclick: () => { mode = 'result'; render(data); } }, '結果'),
      h('button', { type: 'button', 'aria-pressed': String(mode === 'label'), 'data-testid': 'shot-mode-label', onclick: () => { mode = 'label'; render(data); } }, label ? '標註（已標）' : '標註'));
    if (mode === 'label') {
      clear(root, screenHeader(`標註：${VIEW_LABELS[shot.capture?.view] ?? ''}`, () => app.nav.back()), modeBar, renderLabel(data), h('div.row', {}, badge(`shot ${shot.shot_id}`)));
      return;
    }
    const rows = metricRows(shot.metrics);
    const warnings = shot.quality?.warnings ?? [];
    const fps = shot.capture?.effective_fps ?? shot.capture?.nominal_fps ?? 60;
    const msg = h('p.status', '');
    let pending = null;
    replay = createReplay({ clipBlob: clip?.blob ?? null, poseSeq, fps, events: shot.events, onEventsChange: (ev) => { pending = ev; const m = checkMonotonic(ev); msg.textContent = m.ok ? '事件已移動：按「重算」儲存新版本。' : m.message; msg.className = m.ok ? 'status' : 'status bad'; } });
    const recompute = h('button.primary', { type: 'button' }, '重算並儲存（新版本）');
    recompute.addEventListener('click', async () => {
      if (!pending) { toast('先拖曳時間軸上的事件標記'); return; }
      const r = recomputeShot(shot, pending, { poseSeq, at: nowIso() });
      if (!r.ok) { msg.textContent = r.message; msg.className = 'status bad'; return; }
      try {
        if (app.repo) await app.repo.shots.put(r.shot);
        toast(`已儲存第 ${r.shot.revision} 版${poseSeq ? '' : '（沒有姿勢資料：只重算節奏）'}`);
        render({ ...data, shot: r.shot });
      } catch (e) {
        toast(`儲存失敗：${e.message}`);
      }
    });

    clear(root,
      screenHeader(`結果：${VIEW_LABELS[shot.capture?.view] ?? ''}`, () => app.nav.back()),
      modeBar,
      h('p.hint', `${String(shot.created_at).slice(0, 19).replace('T', ' ')} · ${shot.club?.type ?? ''} · 第 ${shot.revision} 版${shot.preset_id ? '' : ' · 沒有機位預設'}`),
      warnings.length ? card('整球提醒', h('ul', {}, reasonTexts(warnings).map((t) => h('li.warn', t)))) : null,
      card('數據',
        h('ul.metric-list', {}, rows.map((r) => h('li', { class: r.isNull ? 'null' : '' },
          h('div.m-head', {}, h('span.m-label', r.label), h('span', { class: `badge v-${r.validity}` }, r.validityLabel)),
          h('div.m-value', r.isNull ? '—' : r.text),
          r.reasons.length ? h('ul.reasons', {}, r.reasons.map((t) => h('li', t))) : null))),
        h('p.hint', '「±」是 95% 信賴區間；carry 一律是估計值（旋轉量沒有量測）。')),
      card('回放與事件修正', replay.el, msg, recompute,
        h('details', {}, h('summary', '事件時間'), h('ul', {}, EVENTS.map((n) => h('li', `${EVENT_LABELS[n]}：${shot.events?.[n] ? `第 ${shot.events[n].frame} 幀（${shot.events[n].source}）` : '—'}`))))),
      h('div.row', {}, badge(`shot ${shot.shot_id}`)));
  }

  return {
    async show(params = {}) {
      mode = params.mode === 'label' ? 'label' : 'result';
      clear(root, screenHeader('結果', () => app.nav.back()), h('p', '讀取中…'));
      try { render(await load(params)); } catch (e) { clear(root, screenHeader('結果', () => app.nav.back()), h('p.warn', `讀取失敗：${e.message}`)); }
    },
    hide() { replay?.destroy(); replay = null; },
  };
}
