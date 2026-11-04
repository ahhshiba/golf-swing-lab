// ui/venue.js — P1 venue wizard: mat L/W measured twice (≤ 3 mm), slope (phone flat on the mat 3 s, ±0.1°),
// tee height, bay depth B with the CAFCR C2 narrow-bay verdict. The f-lock (3 magnifier solves, SD ≤ 1 %) runs in
// the first setup (ui/setup.js) so a session keeps its single getUserMedia.

import { h, clear, field, numberInput, card, toast, screenHeader, select } from './dom.js';
import { VIEW_LABELS } from './format.js';
import { bayAdvice, twoMeasureCheck } from '../session/bay.js';
import { DEFAULT_VENUE } from '../calib/mat.js';
import { flatSlope, lowPassStep } from '../calib/gravity.js';
import { newId, nowIso } from '../session/ids.js';
import { startMotion } from './sensors.js';

export function mountVenue(root, app) {
  let slope = null; // { slope_deg, dir_deg }
  let stopMotion = null;

  function render() {
    slope = null;
    const name = h('input', { type: 'text', placeholder: '例如：XX 練習場 7 號打位', id: 'venue-name' });
    const L1 = numberInput({ value: DEFAULT_VENUE.mat_L, id: 'venue-L1' });
    const L2 = numberInput({ placeholder: '第二次', id: 'venue-L2' });
    const W1 = numberInput({ value: DEFAULT_VENUE.mat_W, id: 'venue-W1' });
    const W2 = numberInput({ placeholder: '第二次', id: 'venue-W2' });
    const edge = numberInput({ value: DEFAULT_VENUE.ball_edge_m, id: 'venue-edge' });
    const matOut = h('p.check', '');
    const checkMat = () => {
      const l = twoMeasureCheck(+L1.value, +L2.value);
      const w = twoMeasureCheck(+W1.value, +W2.value);
      matOut.className = `check ${l.ok && w.ok ? 'ok' : 'bad'}`;
      matOut.textContent = `長：${l.diff_mm === null ? '請量兩次' : `兩次差 ${l.diff_mm.toFixed(1)} mm ${l.ok ? '✓' : '✗ 超過 3mm，請重量'}`}；寬：${w.diff_mm === null ? '請量兩次' : `兩次差 ${w.diff_mm.toFixed(1)} mm ${w.ok ? '✓' : '✗ 超過 3mm，請重量'}`}`;
      return { l, w };
    };
    for (const i of [L1, L2, W1, W2]) i.addEventListener('input', checkMat);

    const slopeOut = h('p.check', '尚未量測');
    const slopeManual = numberInput({ placeholder: '或手動輸入（度）', id: 'venue-slope' });
    const slopeBtn = h('button', { type: 'button' }, '手機平放墊上量坡度（3 秒）');
    slopeBtn.addEventListener('click', () => {
      // sync from the click: the motion permission needs user activation
      let lp = null;
      const hist = [];
      slopeOut.textContent = '量測中，請不要碰手機…';
      stopMotion?.();
      stopMotion = startMotion(app, (acc, t_s) => {
        lp = lowPassStep(lp, acc, t_s, 0.3);
        const fs = flatSlope(lp.value);
        if (!fs) return;
        hist.push({ t_s, ...fs });
        while (hist.length && hist[0].t_s < t_s - 3) hist.shift();
        const span = hist.length ? t_s - hist[0].t_s : 0;
        const vals = hist.map((x) => x.slope_deg);
        const spread = Math.max(...vals) - Math.min(...vals);
        if (span >= 2.9 && spread <= 0.2) {
          slope = { slope_deg: fs.slope_deg, dir_deg: fs.dir_deg };
          slopeOut.className = 'check ok';
          slopeOut.textContent = `坡度 ${fs.slope_deg.toFixed(2)}°（穩定 ±${(spread / 2).toFixed(2)}°）✓`;
          stopMotion?.();
          stopMotion = null;
        } else {
          slopeOut.textContent = `量測中… ${fs.slope_deg.toFixed(2)}°（晃動 ±${(spread / 2).toFixed(2)}°）`;
        }
      }, (err) => { slopeOut.className = 'check bad'; slopeOut.textContent = `無法使用水平儀（${err}）：請手動輸入坡度`; });
    });

    const tee = numberInput({ placeholder: '球底離墊高度，例如 30', id: 'venue-tee' });
    const B = numberInput({ placeholder: '例如 3.1', id: 'venue-B' });
    const bayOut = h('div.bay', '');
    B.addEventListener('input', () => {
      const a = bayAdvice(+B.value);
      clear(bayOut, a.ok
        ? h('div', {}, h('p', `正面距離 D ≈ ${a.D_m.toFixed(2)} m、手機高度上限 ${a.h_max.toFixed(2)} m、平移 ${a.shift} m`), h('p', { class: `verdict ${a.verdict}` }, a.text))
        : h('p', a.text));
    });

    // f-lock: done inside the first P3 of a session (one getUserMedia per session, CAFCR P1/P2): the setup screen
    // collects 3 magnifier solves and locks f when their SD ≤ 1 %.
    const fView = select(Object.entries(VIEW_LABELS), 'face_on', { id: 'venue-fview' });

    const save = h('button.primary.big', { type: 'button' }, '儲存場地');
    save.addEventListener('click', async () => {
      const { l, w } = checkMat();
      if (!l.ok || !w.ok) { toast('墊子長寬要各量兩次，差 ≤3mm'); return; }
      const slopeDeg = slope?.slope_deg ?? (slopeManual.value === '' ? null : +slopeManual.value);
      const adv = bayAdvice(+B.value);
      const venue = {
        venue_id: newId('venue'), name: name.value.trim() || '我的練習場', created_at: nowIso(),
        mat_L: +l.mean.toFixed(4), mat_W: +w.mean.toFixed(4), ball_edge_m: +edge.value || 0.3, ball_x_m: 0,
        slope_deg: Number.isFinite(slopeDeg) ? slopeDeg : null, slope_dir_deg: slope?.dir_deg ?? null,
        tee_lift_m: tee.value === '' ? null : +tee.value / 1000, bay_B_m: adv.ok ? adv.B_m : null,
        bay_verdict: adv.ok ? adv.verdict : null,
        f_locked: null, f_W: null, f_H: null, f_sd_pct: null, f_view: fView.value, f_solves: [],
      };
      if (!app.repo) { toast('資料庫無法使用，場地沒有保存'); return; }
      await app.repo.venues.put(venue);
      app.store.set({ venueId: venue.venue_id });
      toast('場地已儲存：第一次架設時點四角 3 次鎖定焦距');
      app.nav.go('home');
    });

    clear(root,
      screenHeader('新增場地', () => app.nav.back()),
      card('1. 名稱', field('場地名稱', name)),
      card('2. 墊子尺寸（捲尺量兩次）',
        h('div.grid2', {}, field('長 L（沿目標線，m）', L1), field('再量一次', L2), field('寬 W（m）', W1), field('再量一次', W2)),
        field('球距相機側長邊（m）', edge, '預設 0.30m'), matOut),
      card('3. 坡度', slopeBtn, slopeOut, field('手動坡度（度）', slopeManual)),
      card('4. 球座高度', field('球座高度（mm）', tee, '練習場固定橡膠球座：球底離墊子的高度')),
      card('5. 球到面前隔板距離 B', field('B（m）', B, '腳架佔 0.25m，正面距離 D = B − 0.25'), bayOut),
      card('6. 鎖定焦距', field('第一次架設的角度', fView), h('p.hint', '開始練習後，在架設畫面用放大鏡點墊子四角 3 次：三次焦距的標準差 ≤1% 就會自動鎖定並存回這個場地（一段練習只開一次相機）。')),
      save);
  }

  return {
    show() { render(); },
    hide() { stopMotion?.(); stopMotion = null; },
  };
}
