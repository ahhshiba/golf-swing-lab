// ui/history.js — P7 history: filters (view / preset / club), compare with the PRESET_MISMATCH badge,
// export JSON / CSV through store/export.js (download link), import JSON with the Chinese ImportError message.

import { h, clear, card, toast, screenHeader, select, field, downloadLink, badge } from './dom.js';
import { VIEW_LABELS, formatMetric, fmtNum } from './format.js';
import { CLUBS } from '../session/settings.js';
import { exportJSON, exportCSV, importJSON } from '../store/export.js';
import { compareShots, compareSets } from '../store/compare.js';
import { validateShot } from '../contract/validate.js';
import { REGISTRY } from '../metrics/registry.js';
import { RC, describe } from '../contract/reason-codes.js';

/** Compact filter object for queryShots / exportJSON (empty values dropped). */
export function buildFilter({ view, preset_id, club_type }) {
  const f = {};
  if (view) f.view = view;
  if (preset_id) f.preset_id = preset_id;
  if (club_type) f.club_type = club_type;
  return f;
}

export function mountHistory(root, app) {
  let shots = [];
  let presets = [];
  let groups = new Map(); // shot_id -> 'A' | 'B'
  let filt = {};

  async function load() {
    if (!app.repo) return;
    presets = await app.repo.presets.list();
    shots = await app.repo.queryShots({ ...buildFilter(filt), reverse: true });
  }

  function compareView() {
    const A = shots.filter((s) => groups.get(s.shot_id) === 'A');
    const B = shots.filter((s) => groups.get(s.shot_id) === 'B');
    if (!A.length || !B.length) return h('p.hint', '在清單裡把球標成 A 或 B 就能比較（各一球＝單球比較，多球＝組比較）。');
    const r = A.length === 1 && B.length === 1 ? compareShots(A[0], B[0]) : compareSets(A, B);
    const mismatch = r.warnings.includes(RC.PRESET_MISMATCH);
    const rows = Object.values(r.metrics).filter((m) => m.status === 'compared');
    return h('div.compare', {},
      mismatch ? h('p', {}, badge('不同機位預設', 'warn'), ' ', describe(RC.PRESET_MISMATCH)) : h('p', {}, badge('同一機位預設', 'ok')),
      r.notes.length ? h('ul', {}, r.notes.map((n) => h('li.hint', n.text))) : null,
      h('table.cmp', {},
        h('thead', {}, h('tr', {}, h('th', '指標'), h('th', 'A'), h('th', 'B'), h('th', 'B − A'))),
        h('tbody', {}, rows.map((m) => {
          const a = r.kind === 'shots' ? formatMetric({ ...m.a, unit: m.unit }) : `${fmtNum(m.a.mean)}（n=${m.a.n}）`;
          const b = r.kind === 'shots' ? formatMetric({ ...m.b, unit: m.unit }) : `${fmtNum(m.b.mean)}（n=${m.b.n}）`;
          const d = Number.isFinite(m.delta) ? `${fmtNum(m.delta)}${m.delta_ci95 ? `（${fmtNum(m.delta_ci95[0])}～${fmtNum(m.delta_ci95[1])}）` : ''}${m.significant ? ' *' : ''}` : '—';
          return h('tr', {}, h('td', REGISTRY[m.id]?.label_zh ?? m.id), h('td', a), h('td', b), h('td', d));
        }))),
      h('p.hint', '* = 95% 信賴區間不含 0。'));
  }

  function render() {
    const viewSel = select([['', '全部角度'], ...Object.entries(VIEW_LABELS)], filt.view ?? '', { id: 'hist-view' });
    const presetSel = select([['', '全部預設'], ...presets.map((p) => [p.preset_id, `${VIEW_LABELS[p.view] ?? p.view} ${String(p.created_at).slice(0, 10)}`])], filt.preset_id ?? '', { id: 'hist-preset' });
    const clubSel = select([['', '全部球桿'], ...CLUBS.map(([t, l]) => [t, l])], filt.club_type ?? '', { id: 'hist-club' });
    const apply = async () => { filt = { view: viewSel.value, preset_id: presetSel.value, club_type: clubSel.value }; groups = new Map(); await load(); render(); };
    for (const s of [viewSel, presetSel, clubSel]) s.addEventListener('change', apply);

    const exportOut = h('div.export-out', {});
    const withPoses = h('input', { type: 'checkbox', id: 'hist-poses' });
    const withClips = h('input', { type: 'checkbox', id: 'hist-clips' });
    const withLabels = h('input', { type: 'checkbox', id: 'hist-labels', checked: true, 'data-testid': 'history-include-labels' });
    const exportJsonBtn = h('button', { type: 'button', 'data-testid': 'history-export-json' }, '匯出 JSON（完整備份）');
    exportJsonBtn.addEventListener('click', async () => {
      try {
        const data = await exportJSON(app.repo, { ...buildFilter(filt), includePoses: withPoses.checked, includeClips: withClips.checked, includeLabels: withLabels.checked, app_version: app.version() });
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const name = `golf-swing-lab-${new Date().toISOString().slice(0, 10)}.json`;
        clear(exportOut, downloadLink(blob, name, `下載 ${name}（${data.shots.length} 球${data.labels ? `、${data.labels.length} 個標註` : ''}）`));
      } catch (e) { toast(`匯出失敗：${e.message}`); }
    });
    const exportCsvBtn = h('button', { type: 'button' }, '匯出 CSV（試算表）');
    exportCsvBtn.addEventListener('click', () => {
      const blob = new Blob([exportCSV(shots, { bom: true })], { type: 'text/csv;charset=utf-8' });
      const name = `golf-swing-lab-${new Date().toISOString().slice(0, 10)}.csv`;
      clear(exportOut, downloadLink(blob, name, `下載 ${name}（${shots.length} 球）`));
    });
    const importOut = h('p.status', '');
    const importInput = h('input', { type: 'file', accept: '.json,application/json', id: 'hist-import', 'data-testid': 'history-import-input' });
    importInput.addEventListener('change', async () => {
      const f = importInput.files?.[0];
      if (!f) return;
      try {
        const text = await f.text();
        const r = await importJSON(app.repo, text, { validate: validateShot });
        importOut.className = 'status ok';
        importOut.textContent = r.message || `已匯入 ${r.total} 筆`;
        await load();
        render();
      } catch (e) {
        importOut.className = 'status bad';
        importOut.textContent = `匯入失敗：${e.message}`; // ImportError messages are Traditional Chinese
      }
    });

    const list = h('ul.shot-list', {}, shots.map((s) => {
      const g = groups.get(s.shot_id);
      const tog = (k) => () => { if (groups.get(s.shot_id) === k) groups.delete(s.shot_id); else groups.set(s.shot_id, k); render(); };
      const m = s.metrics ?? {};
      return h('li', {},
        h('button.linklike', { type: 'button', 'data-testid': 'shot-row', onclick: () => app.nav.go('shot', { shot_id: s.shot_id }) },
          `${String(s.created_at).slice(5, 16).replace('T', ' ')} · ${VIEW_LABELS[s.capture?.view] ?? ''} · ${s.club?.type ?? ''} · tempo ${formatMetric(m.tempo_ratio)}`),
        h('span.ab', {},
          h('button', { type: 'button', class: g === 'A' ? 'on' : '', 'aria-pressed': String(g === 'A'), onclick: tog('A') }, 'A'),
          h('button', { type: 'button', class: g === 'B' ? 'on' : '', 'aria-pressed': String(g === 'B'), onclick: tog('B') }, 'B')));
    }));

    clear(root,
      screenHeader('歷史', () => app.nav.back()),
      app.repo ? null : h('p.warn', '資料庫無法使用'),
      card('篩選', h('div.grid3', {}, field('角度', viewSel), field('預設', presetSel), field('球桿', clubSel))),
      card(`球（${shots.length}）`, shots.length ? list : h('p', '還沒有資料。')),
      card('比較', compareView()),
      card('匯出／匯入',
        h('label.check-row', {}, withPoses, ' 包含姿勢資料'), h('label.check-row', {}, withClips, ' 包含原始影片（檔案很大）'),
        h('label.check-row', {}, withLabels, ' 包含標註（P14，給 eval_owner_set.mjs）'),
        h('div.row', {}, exportJsonBtn, exportCsvBtn), exportOut,
        field('匯入 JSON 備份', importInput), importOut));
  }

  return {
    async show() { render(); try { await load(); } catch (e) { toast(`讀取失敗：${e.message}`); } render(); },
    hide() {},
  };
}
