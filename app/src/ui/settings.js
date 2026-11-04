// ui/settings.js — handedness, height, club defaults, pose model, storage usage and P10 clean-up,
// P9 event-model import / one-tap rollback (session/models.js), P19 calibration-health counters (session/health.js).

import { h, clear, card, toast, screenHeader, select, field, numberInput } from './dom.js';
import { fmtBytes } from './format.js';
import { CLUBS, loadSettings, saveSettings } from '../session/settings.js';
import { estimateStorage, planCleanup, policyClips, requestPersist } from '../store/quota.js';
import { validateEventModel, importEventModel, rollbackEventModel, activeEventModel, previousEventModel, bundledModelAvailable, modelStatusText, NO_MODEL_HINT } from '../session/models.js';
import { loadHealth, noteHealthCheck, noteDropTest } from '../session/health.js';
import { HEALTH_LIMITS, dropTestDue } from '../calib/checks.js';
import { nowIso } from '../session/ids.js';

export function mountSettings(root, app) {
  async function storageCard() {
    const box = h('div', {}, h('p', '計算中…'));
    (async () => {
      const est = await estimateStorage(navigator);
      let clips = [];
      let starred = [];
      if (app.repo) {
        try {
          clips = await app.repo.clips.list();
          starred = (await app.repo.shots.list()).filter((s) => s.starred).map((s) => s.shot_id);
        } catch (_) { /* ignore */ }
      }
      const plan = planCleanup({ usage: est.usage, quota: est.quota, clips: policyClips(clips), practiceActive: app.store.get().sessionActive, protectShotIds: starred });
      const clean = h('button.danger', { type: 'button', disabled: !plan.deleteIds.length || plan.warnOnly }, `刪除 ${plan.deleteIds.length} 支原始影片（保留數據與姿勢）`);
      clean.addEventListener('click', async () => {
        if (!confirm('會刪除最舊的原始影片（有星號的不刪），數據與姿勢都保留。建議先到「歷史」匯出備份。確定？')) return;
        await app.repo.batch(plan.deleteIds.map((id) => ({ op: 'delete', store: 'clips', id })));
        toast(`已刪除 ${plan.deleteIds.length} 支影片`);
        show();
      });
      const persist = h('button', { type: 'button' }, '要求保留資料（persist）');
      persist.addEventListener('click', async () => { const r = await requestPersist(navigator); toast(r.persisted ? '瀏覽器同意保留資料' : '瀏覽器沒有同意（加到主畫面後再試）'); });
      clear(box,
        h('p', `已用 ${fmtBytes(est.usage)}／可用 ${fmtBytes(est.quota)} · 原始影片 ${clips.length} 支`),
        plan.message ? h('p', { class: plan.status === 'over' ? 'warn' : 'hint' }, plan.message) : null,
        plan.warnOnly ? h('p.warn', '練習中只提醒、不刪除。') : null,
        h('div.row', {}, clean, persist));
    })();
    return card('儲存空間（P10）', box);
  }

  // ---- P9: event model import + rollback ----
  function modelCard() {
    const status = h('p', { 'data-testid': 'model-status' }, '讀取中…');
    const out = h('p.status', { 'data-testid': 'model-import-status' }, '');
    const jsonIn = h('input', { type: 'file', accept: '.json,application/json', id: 'model-json', 'data-testid': 'model-json-input' });
    const binIn = h('input', { type: 'file', accept: '.bin,application/octet-stream', id: 'model-bin', 'data-testid': 'model-bin-input' });
    const importBtn = h('button.primary', { type: 'button', 'data-testid': 'model-import' }, '檢查並匯入');
    const rollbackBtn = h('button', { type: 'button', 'data-testid': 'model-rollback', disabled: true }, '回復上一個模型');
    const refresh = async () => {
      let active = null;
      let previous = null;
      try { active = await activeEventModel(app.repo); previous = await previousEventModel(app.repo); } catch (_) { /* no repo */ }
      const bundled = await bundledModelAvailable();
      app.store.set({ eventModel: { source: active ? 'imported' : bundled ? 'bundled' : 'rules', version: active?.version ?? (bundled ? 'event-tcn-v1' : null) } });
      status.textContent = modelStatusText({ active, previous, bundled });
      rollbackBtn.disabled = !previous;
    };
    importBtn.addEventListener('click', async () => {
      const jf = jsonIn.files?.[0];
      const bf = binIn.files?.[0];
      if (!jf || !bf) { toast('請選 .json 和 .bin 兩個檔案'); return; }
      if (!app.repo) { toast('資料庫無法使用，不能保存模型'); return; }
      out.className = 'status';
      out.textContent = '檢查中（SHA-256、特徵版本、張量形狀、golden）…';
      let json;
      try { json = JSON.parse(await jf.text()); } catch (e) { out.className = 'status bad'; out.textContent = `說明檔不是有效的 JSON：${e.message}`; return; }
      const bin = await bf.arrayBuffer();
      const check = await validateEventModel(json, bin);
      if (!check.ok) { out.className = 'status bad'; out.textContent = `沒有匯入：${check.problems.join('；')}`; return; }
      try {
        const rec = await importEventModel(app.repo, { json, bin, check, imported_at: nowIso(), file_names: [jf.name, bf.name] });
        await app.applyEventModel?.();
        out.className = 'status ok';
        out.textContent = `已匯入 ${rec.version}（${check.golden === 'pass' ? 'golden 重現通過' : '說明檔沒有附 golden：只做了 SHA-256／版本／形狀檢查'}）。上一個模型保留可回復。`;
      } catch (e) { out.className = 'status bad'; out.textContent = `匯入失敗：${e.message}`; }
      refresh();
    });
    rollbackBtn.addEventListener('click', async () => {
      try {
        const r = await rollbackEventModel(app.repo);
        if (r.ok) await app.applyEventModel?.();
        toast(r.message);
      } catch (e) { toast(`回復失敗：${e.message}`); }
      refresh();
    });
    refresh();
    return card('事件模型（P9）', status,
      field('模型說明檔（.json）', jsonIn), field('權重檔（.bin）', binIn),
      h('div.row', {}, importBtn, rollbackBtn), out,
      h('p.hint', `匯入前會檢查 SHA-256、特徵版本與張量形狀；說明檔附 golden 時再比對推論結果（誤差 ≤ 1e-4）。${NO_MODEL_HINT}，例如重新訓練或微調後的 event-tcn。`));
  }

  // ---- P19: calibration health ----
  function healthCard() {
    const box = h('div', {});
    const draw = () => {
      const st = loadHealth();
      const d = dropTestDue(st.last_drop_test_at, nowIso());
      clear(box,
        h('p', `距離上次校正健檢：${st.shots_since_check} 球（每 ${HEALTH_LIMITS.shots_per_check} 球提醒一次）`),
        h('p', st.last_drop_test_at ? `上次落球測試：${String(st.last_drop_test_at).slice(0, 10)}（${Math.floor(d.days_since)} 天前）` : '還沒有落球測試紀錄（K11，建議每月一次）'),
        h('div.row', {},
          h('button', { type: 'button', 'data-testid': 'health-done', onclick: () => { noteHealthCheck(nowIso()); app.store.set({ healthPrompts: [] }); draw(); toast('已記錄健檢'); } }, '已做完健檢'),
          h('button', { type: 'button', 'data-testid': 'droptest-done', onclick: () => { noteDropTest(nowIso()); app.store.set({ healthPrompts: (app.store.get().healthPrompts ?? []).filter((p) => p.id !== 'drop_test') }); draw(); toast('已記錄落球測試'); } }, '已做完落球測試')));
    };
    draw();
    return card('校正健檢（P19）', box, h('p.hint', '墊子尺寸重解差 >1% 會提示「可能換了墊子」；畫面亮度和校正時差 >30% 會提醒並重建背景模型。'));
  }

  async function show() {
    const st = loadSettings();
    const hand = select([['right', '右打'], ['left', '左打（全部鏡像）']], st.handedness, { id: 'set-hand' });
    const height = numberInput({ value: st.height_m, id: 'set-height', min: 1.2, max: 2.2 });
    const club = select(CLUBS.map(([t, l]) => [t, l]), st.club_type, { id: 'set-club' });
    const len = numberInput({ value: st.club_length_m, id: 'set-len' });
    const lie = select([['mat', '墊子上'], ['tee', '球座上']], st.lie, { id: 'set-lie' });
    const model = select([['lite', 'lite（最快，5.8MB）'], ['full', 'full（建議，9.4MB）'], ['heavy', 'heavy（最準，30.7MB，需先下載）']], st.model, { id: 'set-model' });
    club.addEventListener('change', () => { const c = CLUBS.find((x) => x[0] === club.value); len.value = c[2]; });
    const save = h('button.primary.big', { type: 'button' }, '儲存設定');
    save.addEventListener('click', () => {
      const h_m = +height.value;
      const L = +len.value;
      if (!(h_m >= 1.2 && h_m <= 2.2)) { toast('身高請輸入 1.2–2.2 m'); return; }
      if (!(L >= 0.7 && L <= 1.3)) { toast('球桿長度請輸入 0.7–1.3 m'); return; }
      app.updateSettings(saveSettings({ handedness: hand.value, height_m: h_m, club_type: club.value, club_length_m: L, lie: lie.value, model: model.value }));
      toast('已儲存');
    });
    clear(root,
      screenHeader('設定', () => app.nav.back()),
      card('球手', field('慣用手', hand), field('身高（m）', height, '身體平面距離的備援估計用')),
      card('球桿預設', field('球桿', club), field('長度（m）', len), field('球位', lie)),
      card('姿勢模型（匯入分析用）', field('模型', model, '即時模式固定用 lite')),
      save,
      modelCard(),
      healthCard(),
      await storageCard());
  }

  return { show, hide() {} };
}
