// ui/import.js — P5 high-speed import: file picker (accept="video/*"), probe, progress, analysis through
// media's pipeline/clip.js, save, open the result. Teaches 「儲存到檔案→瀏覽」 when effective_fps < 200.

import { h, clear, card, toast, screenHeader, select, field } from './dom.js';
import { VIEW_LABELS, errorText, fmtNum } from './format.js';
import { CLUBS } from '../session/settings.js';
import { newId, nowIso } from '../session/ids.js';
import { fpsAtLeast } from '../geom/constants.js';

const ERR_CANCELLED = 'CANCELLED';
const STAGES = Object.freeze({ probe: '探測', pose: '姿勢', events: '事件', impact: '擊球段', assemble: '彙整' });

const FILES_HINT = '從「照片」挑影片會被壓縮、掉幀率。請在「照片」App 按分享 →「儲存到檔案」，再回這裡按「選擇影片」→「瀏覽」從「檔案」挑。';

export function mountImport(root, app) {
  let abort = null;
  let calibs = [];

  async function loadCalibs() {
    calibs = [];
    const cur = app.current?.calibration;
    if (cur) calibs.push({ id: 'current', label: '這次練習鎖定的校正', calibration: cur, view: app.current.view, preset_id: app.current.preset?.preset_id ?? null, venue: app.current.venue });
    if (app.repo) {
      try {
        const ss = await app.repo.sessions.list({ index: 'created_at', reverse: true, limit: 20 });
        for (const s of ss) if (s.calibration) calibs.push({ id: s.session_id, label: `${String(s.created_at).slice(0, 16).replace('T', ' ')} ${VIEW_LABELS[s.view] ?? ''}`, calibration: s.calibration, view: s.view, preset_id: s.preset_id, venue_id: s.venue_id });
      } catch (_) { /* ignore */ }
    }
  }

  function render() {
    const st = app.settings();
    const hint = h('p.hint', FILES_HINT);
    const info = h('div.probe', {});
    const progress = h('progress', { max: 1, value: 0, hidden: true });
    const stage = h('p.status', '');
    const viewSel = select(Object.entries(VIEW_LABELS), app.current?.view ?? app.store.get().view ?? 'face_on', { id: 'import-view' });
    const calSel = select([...calibs.map((c) => [c.id, c.label]), ['', '不使用校正（球數據會是空值）']], calibs[0]?.id ?? '', { id: 'import-calib' });
    const clubSel = select(CLUBS.map(([t, l]) => [t, l]), st.club_type, { id: 'import-club' });
    let file = null;
    const input = h('input', { type: 'file', accept: 'video/*', id: 'import-file', 'data-testid': 'import-file-input' });
    const go = h('button.primary.big', { type: 'button', disabled: true, 'data-testid': 'import-start' }, '開始分析');
    const cancel = h('button', { type: 'button', hidden: true, onclick: () => abort?.abort() }, '取消');

    input.addEventListener('change', async () => {
      file = input.files?.[0] ?? null;
      clear(info);
      go.disabled = !file;
      if (!file) return;
      const probe = app.deps.probe?.probeFile;
      if (!probe) { clear(info, h('p', `${file.name}（${fmtNum(file.size / 1e6, 1)} MB）`), h('p.hint', '探測模組尚未安裝（import/probe.js）。')); return; }
      try {
        const p = await probe(file);
        app.record('import.last', { effective_fps: p.effective_fps, sample_count: p.sample_count, hevc: /hvc1|hev1/i.test(p.codec ?? ''), decoded: null });
        const low = !fpsAtLeast(p.effective_fps, 200);
        clear(info,
          h('p', `${p.codec ?? '?'} · ${p.width}×${p.height} · ${fmtNum(p.effective_fps, 1)} fps · ${p.sample_count} 幀${p.vfr ? ' · 變動幀率' : ''}`),
          low ? h('p.warn', `有效幀率 ${fmtNum(p.effective_fps, 1)} fps < 200：球數據會是空值。${FILES_HINT}`) : h('p.ok', '幀率足夠，可以算球數據。'));
      } catch (e) {
        clear(info, h('p.warn', `無法讀取影片：${errorText(e)}`), h('p.hint', FILES_HINT));
      }
    });

    go.addEventListener('click', async () => {
      if (!file) return;
      if (!app.vision) { toast('分析模組尚未安裝（workers/client.js）'); return; }
      const cal = calibs.find((c) => c.id === calSel.value) ?? null;
      const club = CLUBS.find((c) => c[0] === clubSel.value);
      const venue = cal?.venue ?? app.current?.venue ?? null;
      progress.hidden = false;
      cancel.hidden = false;
      go.disabled = true;
      const t0 = performance.now();
      try {
        const vc = await app.vision();
        const sess = app.store.get().session;
        const ids = { shot_id: newId('shot'), session_id: sess?.session_id ?? newId('sess-import'), venue_id: venue?.venue_id ?? cal?.venue_id ?? null, preset_id: cal?.preset_id ?? null, created_at: nowIso(), app_version: app.version() };
        const job = vc.analyzeClip(file, {
          view: viewSel.value, calibration: cal?.calibration ?? null, handedness: st.handedness, venue, ids,
          club: { type: club[0], length_m: club[2], lie: app.current?.lie ?? st.lie, tee_lift_m: venue?.tee_lift_m ?? null, tee_lift_source: Number.isFinite(venue?.tee_lift_m) ? 'measured' : 'assumed' },
          mode: 'highspeed', source: 'import', clip_ref: newId('clip'), allowNoSwing: true, pose_model: st.model, warnings: app.controller.warnings(),
        }, { onProgress: (stg, frac) => { progress.value = frac ?? 0; stage.textContent = `${STAGES[stg] ?? stg ?? ''} ${Math.round(100 * (frac ?? 0))}%`; } });
        abort = { abort: () => job.cancel?.() };
        const res = await job;
        const shot = res?.shot ?? res;
        if (cal?.preset_id && !shot.preset_id) shot.preset_id = cal.preset_id;
        app.record('import.analysis_s', (performance.now() - t0) / 1000);
        const saved = await app.controller.saveShot(shot, { clipBlob: file, poseSeq: res?.poseSeq ?? null, mime: file.type });
        app.nav.go('shot', { shot_id: saved.shot_id, shot: saved });
      } catch (e) {
        if (e?.name === 'AbortError' || e?.code === ERR_CANCELLED) toast('已取消');
        else toast(`分析失敗：${errorText(e)}`);
      } finally {
        progress.hidden = true;
        cancel.hidden = true;
        go.disabled = false;
        abort = null;
      }
    });

    clear(root,
      screenHeader('匯入影片', () => app.nav.back()),
      card('選擇影片', input, hint, info),
      card('分析設定', field('角度', viewSel), field('校正', calSel), field('球桿', clubSel)),
      go, cancel, progress, stage);
  }

  return {
    async show() { render(); await loadCalibs(); render(); },
    hide() { abort?.abort(); },
  };
}
