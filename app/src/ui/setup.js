// ui/setup.js — P3 setup and calibration (CAFCR C3 steps C0–C10): live preview with the ghost frame, gravity
// level bubble, 4-corner magnifier taps, traffic light with every failing check in Chinese (calib/checks
// evaluate), setup timer, 鎖定 (C9), force start (SETUP_UNVERIFIED), high-speed calibration clip (C10), P16, P17.

import { h, clear, card, toast, screenHeader, select, badge } from './dom.js';
import { VIEW_LABELS, LIGHT_LABELS, failureTexts, fmtDuration, fmtNum } from './format.js';
import { createCornerPicker, snapshot, grayOf } from './magnifier.js';
import { startMotion } from './sensors.js';
import { calibrate } from '../calib/ladder.js';
import { evaluate, cornerDrift, COMMON_LIMITS, meanLuma } from '../calib/checks.js';
import { ghostCorners, ghostDistance } from '../calib/ghost.js';
import { poseReport } from '../calib/report.js';
import { refineCorners } from '../calib/mat.js';
import { createGravityTracker, gravityPrior, orientationName } from '../calib/gravity.js';
import { framesBudget, predictedBallWidthPx, ballHeight } from '../calib/ballspot.js';
import { nominalF } from '../calib/pnp.js';
import { fLockFromSolves } from '../calib/preset.js';
import { SETUP_STEPS, STEP_ESTIMATE_S, SETUP_LIMITS } from '../calib/timer.js';
import { nominalCamera, project } from '../geom/camera.js';
import { detectRestBall } from '../track/ball.js';
import { RC } from '../contract/reason-codes.js';
import { bayAdvice } from '../session/bay.js';

const STEP_LABELS = Object.freeze({
  C0: '裝機', C1: '物理定位', C2: '開 App、取得權限', C3: '水平', C4: '幽靈框對齊', C5: '墊角精修',
  C6: '位姿檢查', C7: '放球', C8: '框景（address 2 秒）', C9: '鎖定', C10: '高速校正短片',
});

function screenAngle() {
  try { return orientationName(globalThis.screen?.orientation?.angle ?? globalThis.orientation ?? 0); } catch (_) { return 'portrait'; }
}

/** Focal length for the current stream: venue lock scaled to this resolution, else preset, else nominal. */
export function streamFocal(venue, preset, W, H) {
  const scale = (f, fw, fh) => (Number.isFinite(f) ? f * (Math.max(W, H) / (Number.isFinite(fw) ? Math.max(fw, fh) : Math.max(W, H))) : null);
  const fv = scale(venue?.f_locked, venue?.f_W, venue?.f_H);
  if (fv) return { f: fv, locked: true };
  const fp = scale(preset?.f_locked, preset?.W, preset?.H);
  if (fp) return { f: fp, locked: true };
  return { f: nominalF(W, H), locked: false };
}

export function mountSetup(root, app) {
  let raf = 0;
  let tick = 0;
  let stopMotion = null;
  let tracker = null;
  let grav = null; // latest { pitch_deg, roll_deg, stable }
  let ghost = null;
  let result = null; // { calibration, solve, evaluation, corners, W, H }
  let ball = null;
  let recorded = new Set();
  let els = {};

  const ctx = () => app.current ?? { venue: null, preset: null, view: app.store.get().view, mode: 'live' };

  function rec(step) {
    if (recorded.has(step)) return;
    const t = app.controller.setupTimer;
    const last = t.events().at(-1)?.t_s ?? 0;
    try { t.record(step, Math.max(last, performance.now() / 1000)); recorded.add(step); } catch (_) { /* ignore */ }
    renderTimer();
  }

  function dims() {
    const v = els.video;
    return v && v.videoWidth ? { W: v.videoWidth, H: v.videoHeight } : null;
  }

  function computeGhost() {
    const d = dims();
    const { venue, preset, view } = ctx();
    if (!d || !venue) return null;
    const { f } = streamFocal(venue, preset, d.W, d.H);
    try {
      if (preset?.pose && preset.view === view) return ghostCorners(preset, venue, { W: d.W, H: d.H, f }).corners;
      const opts = { W: d.W, H: d.H, f };
      if (view === 'face_on' && Number.isFinite(venue.bay_B_m)) {
        const a = bayAdvice(venue.bay_B_m);
        if (a.ok) Object.assign(opts, { D: a.D_m, h: Math.min(0.84, a.h_max) });
      }
      const pose = poseReport(nominalCamera(view, opts), view);
      return ghostCorners({ pose, view, f_locked: f, W: d.W, H: d.H }, venue, { W: d.W, H: d.H, f }).corners;
    } catch (_) {
      return null;
    }
  }

  function drawOverlay() {
    raf = requestAnimationFrame(drawOverlay);
    attachStream(); // the stream arrives after the click handler navigated here (getUserMedia is async)
    const c = els.overlay;
    const d = dims();
    if (!c || !d) return;
    if (c.width !== d.W) { c.width = d.W; c.height = d.H; els.stage.style.aspectRatio = `${d.W} / ${d.H}`; ghost = computeGhost(); }
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    const s = Math.max(2, d.W / 480);
    if (ghost) {
      g.save();
      g.setLineDash([8 * s, 6 * s]);
      g.lineWidth = 2 * s;
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.beginPath();
      ghost.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.closePath();
      g.stroke();
      for (const p of ghost) { g.beginPath(); g.arc(p[0], p[1], 8 * s, 0, 2 * Math.PI); g.stroke(); }
      g.restore();
    }
    if (result?.corners) {
      g.fillStyle = result.evaluation.light === 'green' ? '#00c878' : result.evaluation.light === 'amber' ? '#ffb000' : '#ff3b30';
      for (const p of result.corners) { g.beginPath(); g.arc(p[0], p[1], 5 * s, 0, 2 * Math.PI); g.fill(); }
    }
    // 95 % frame box (C2 入鏡)
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = s;
    g.setLineDash([]);
    g.strokeRect(0.025 * d.W, 0.025 * d.H, 0.95 * d.W, 0.95 * d.H);
  }

  function levelLimits() {
    return ctx().view === 'high_behind' ? { pitch: 1.0, roll: 0.5, rel: true } : { pitch: 1.0, roll: 0.5, rel: false };
  }

  function renderLevel() {
    if (!els.level) return;
    if (!grav) {
      const perm = app.store.get().permissions?.motion;
      clear(els.level, h('span', perm === 'denied' ? '水平儀被拒絕：' : '水平儀：等待資料…'),
        perm === 'denied' ? h('button', { type: 'button', onclick: retryMotion }, '啟用水平儀') : null);
      return;
    }
    const lim = levelLimits();
    const preset = ctx().preset;
    const pitch = lim.rel && preset?.pose ? grav.pitch_deg - preset.pose.pitch_deg : grav.pitch_deg;
    const ok = Math.abs(pitch) <= lim.pitch && Math.abs(grav.roll_deg) <= lim.roll;
    if (ok) rec('C3');
    const x = Math.max(-1, Math.min(1, grav.roll_deg / 3));
    const y = Math.max(-1, Math.min(1, pitch / 3));
    clear(els.level,
      h('div.bubble-box', {}, h('div.bubble', { class: `bubble ${ok ? 'ok' : ''}`, style: { transform: `translate(${x * 40}px, ${-y * 40}px)` } })),
      h('div', {}, h('div', `${lim.rel ? '俯仰（相對預設）' : '俯仰'} ${pitch.toFixed(1)}°（±${lim.pitch}）`), h('div', `滾轉 ${grav.roll_deg.toFixed(1)}°（±${lim.roll}）`), ok ? badge('水平 OK', 'ok') : badge('調整雲台', 'warn')));
  }

  function startLevel() {
    stopMotion?.();
    tracker = createGravityTracker({ orientation: screenAngle() });
    stopMotion = startMotion(app, (acc, t) => { const r = tracker.push(acc, t); if (r) { grav = r; renderLevel(); } }, () => { grav = null; renderLevel(); });
  }

  function retryMotion() {
    const p = app.controller.retryMotion(); // sync from the click
    p.then((state) => { if (state === 'granted') startLevel(); else toast('水平儀仍無法使用：俯仰與滾轉只靠墊子推算（NO_GRAVITY_REF）'); renderLevel(); });
  }

  function renderTimer() {
    if (!els.timer) return;
    const t = app.controller.setupTimer;
    const ev = t.events();
    const total = ev.length ? performance.now() / 1000 - ev[0].t_s : 0;
    const sum = t.summary();
    const highspeed = ctx().mode === 'highspeed';
    const steps = SETUP_STEPS.filter((st) => (highspeed ? st !== 'C5' : st !== 'C10'));
    clear(els.timer,
      h('div.timer-total', { class: `timer-total ${total > SETUP_LIMITS.per_angle_p90_s ? 'bad' : ''}` }, `架設計時 ${fmtDuration(total)} ／ 5:00`),
      h('ol.steps', {}, steps.map((st) => h('li', { class: sum.steps[st] !== undefined ? 'done' : '' },
        `${st} ${STEP_LABELS[st]}`, sum.steps[st] !== undefined ? ` ✓ ${Math.round(sum.steps[st])}s` : ` （約 ${STEP_ESTIMATE_S[st]}s）`))));
  }

  function solveWith(corners, { W, H, edge = null, source = 'live' }) {
    const { venue, preset, view, mode } = ctx();
    const foc = streamFocal(venue, preset, W, H);
    const g = grav ? gravityPrior(grav) : null;
    const visible = { corners, club: null, ball: null, gravity: g };
    const r = calibrate(visible, {
      venue, view, W, H, f: foc.f, fLocked: foc.locked, preset: preset?.view === view ? preset : null,
      cornerSource: 'manual', source, slope_deg: venue?.slope_deg ?? null,
    });
    if (!r.ok) { toast('解不出位姿：檢查四角順序（後側近端開始，逆時針）'); return null; }
    const cam = r.calibration.camera;
    const ghostPx = preset?.pose && preset.view === view && ghost ? ghostDistance(corners, ghost).max_px : undefined;
    let budget;
    if (mode === 'highspeed' && view === 'face_on') {
      try { budget = framesBudget(cam, view, 70, 12, undefined, { fps: 240 }).frames; } catch (_) { budget = undefined; }
    }
    const evaluation = evaluate({
      view, report: r.calibration.pose, rmse_px: r.calibration.reproj_rmse_px, edge_residual_px: edge ?? undefined,
      f_free_px: r.solve?.fFormat?.f_free, f_locked_px: foc.locked ? r.solve?.f : undefined, corner_source: 'manual',
      preset: preset?.view === view ? preset : null, ghost_px: ghostPx, corners, W, H,
      gravity_available: Boolean(grav), frames_budget: budget,
      ball: ball ? { w_px: ball.w_px, predicted_w_px: ball.predicted_w_px } : undefined,
    });
    result = { calibration: r.calibration, solve: r.solve, evaluation, corners, W, H, source };
    if (!foc.locked) collectF(r.calibration.f_px, W, H, corners, edge, source);
    rec('C4');
    rec('C5');
    rec('C6');
    renderLight();
    return result;
  }

  // P1 f-lock inside the first setup: 3 magnifier solves with f free, lock when SD ≤ 1 % (CAFCR P1, K3)
  function collectF(f, W, H, corners, edge, source) {
    const cur = ctx();
    const fs = [...(cur.fSolves ?? []), f];
    app.current = { ...cur, fSolves: fs };
    const lock = fLockFromSolves(fs);
    if (lock.ok && cur.venue) {
      const venue = { ...cur.venue, f_locked: lock.f_locked, f_W: W, f_H: H, f_sd_pct: lock.sd_pct, f_solves: fs, f_view: cur.view };
      app.current = { ...app.current, venue, fSolves: [] };
      app.repo?.venues.put(venue).catch(() => {});
      app.record('calibration.f_lock', { f_locked: lock.f_locked, sd_pct: lock.sd_pct, n: lock.n });
      toast(`焦距已鎖定：f = ${lock.f_locked.toFixed(1)} px（SD ${lock.sd_pct.toFixed(2)}%）`);
      solveWith(corners, { W, H, edge, source });
    }
  }

  function fLockText() {
    const cur = ctx();
    if (Number.isFinite(cur.venue?.f_locked)) return null;
    const fs = cur.fSolves ?? [];
    const lock = fs.length ? fLockFromSolves(fs) : null;
    return h('p', { class: `check ${fs.length >= 3 && !lock?.ok ? 'bad' : ''}` },
      `焦距尚未鎖定（P1）：已點 ${fs.length} 次${fs.length ? `，f = ${fs.map((x) => x.toFixed(0)).join('、')} px` : ''}。` +
      (fs.length < 3 ? `再「點四角」${3 - fs.length} 次（每次重新點）。` : `SD ${lock.sd_pct.toFixed(2)}% > 1%：檢查是否 1x 鏡頭、240fps，再點一次。`));
  }

  function renderLight() {
    if (!els.light) return;
    if (!result) { clear(els.light, h('p', '點完墊子四角後顯示燈號。'), fLockText()); return; }
    const e = result.evaluation;
    const p = result.calibration.pose;
    const lines = failureTexts(e);
    clear(els.light,
      h('div', { class: `light ${e.light}`, role: 'status' }, LIGHT_LABELS[e.light]),
      lines.length ? h('ul.failures', {}, lines.map((t) => h('li', t))) : h('p', '所有檢查都通過。'),
      e.reason_codes.includes(RC.NO_GRAVITY_REF) ? h('p.hint', '沒有水平儀資料，俯仰與滾轉只靠墊子推算。') : null,
      fLockText(),
      h('p.hint', `位姿：偏航 ${fmtNum(p.yaw_deg)}°、俯仰 ${fmtNum(p.pitch_deg)}°、滾轉 ${fmtNum(p.roll_deg)}°、D ${fmtNum(p.D_m)}m、h ${fmtNum(p.h_m)}m、RMSE ${fmtNum(result.calibration.reproj_rmse_px)}px`));
    els.lockBtn.disabled = e.light === 'red';
    els.forceBtn.hidden = e.light !== 'red';
  }

  function openPicker() {
    const v = els.video;
    if (!v.videoWidth) { toast('相機畫面還沒準備好'); return; }
    const frame = snapshot(v, v.videoWidth, v.videoHeight);
    els.picker.setFrame(frame);
    els.picker.setGhost(ghost);
    els.picker.reset();
    els.pickerBox.hidden = false;
    els.stage.hidden = true;
  }

  function finishPicker() {
    const corners = els.picker.corners();
    if (!corners) { toast('請點完四個角'); return; }
    const ref = els.picker.refine();
    const edge = ref?.ok ? ref.max_edge_residual_px : null;
    const f = els.picker.frame();
    els.pickerBox.hidden = true;
    els.stage.hidden = false;
    solveWith(els.picker.corners(), { W: f.width, H: f.height, edge });
  }

  function checkBall() {
    if (!result) { toast('先完成墊子四角'); return; }
    const v = els.video;
    const cam = result.calibration.camera;
    const { venue } = ctx();
    const st = app.settings();
    const lie = st.lie ?? 'mat';
    const z = ballHeight(lie, venue?.tee_lift_m ?? null, Number.isFinite(venue?.tee_lift_m) ? 'measured' : 'assumed').z_m;
    const X = [0, 0, z];
    const pr = project(cam, X);
    if (!(pr && pr.z > 0)) { toast('無法預測球的位置'); return; }
    const u = pr.u;
    const vv = pr.v;
    const predicted = predictedBallWidthPx(cam, X);
    const gray = grayOf(snapshot(v, v.videoWidth, v.videoHeight));
    let det = null;
    try { det = detectRestBall(gray, { x: 0, y: 0, w: gray.W, h: gray.H }, { u, v: vv, w_px: predicted }, { polarity: 'auto' }); } catch (_) { det = null; }
    if (!det) { toast('在預期位置找不到球：把球放在墊子上的球位'); return; }
    ball = { w_px: det.w_px, predicted_w_px: predicted, lie: det.lie };
    rec('C7');
    solveWith(result.corners, { W: result.W, H: result.H, edge: null, source: result.source });
    toast(`球寬 ${det.w_px.toFixed(1)}px（預測 ${predicted.toFixed(1)}px）${det.lie === 'tee' ? '，偵測到球座' : ''}`);
  }

  /** P19: mean brightness of the live preview (downscaled), NaN when there is no frame. */
  function sceneLuma() {
    const v = els.video;
    try {
      if (!v || !(v.videoWidth > 0)) return NaN;
      const w = 160;
      const hh = Math.max(1, Math.round((w * v.videoHeight) / v.videoWidth));
      return meanLuma(grayOf(snapshot(v, w, hh)), { stride: 2 });
    } catch (_) { return NaN; }
  }

  function checkLight() {
    const l = sceneLuma();
    if (!Number.isFinite(l)) { toast('還沒有畫面'); return; }
    const r = app.controller.checkScene?.({ luma: l });
    const b = r?.checks?.brightness;
    if (!b || b.skipped) toast('還沒有鎖定過的校正畫面可以比較');
    else toast(b.changed ? `光線改變 ${(100 * b.rel).toFixed(0)}%：背景模型會重建` : `光線正常（差 ${(100 * b.rel).toFixed(0)}%）`);
  }

  async function doLock(forced) {
    if (!result) return;
    const { venue, preset, view, mode } = ctx();
    if (forced && !confirm('檢查沒有全部通過。強制開始後，每一球都會標記「架設檢查沒有全部通過」並降低可信度。確定？')) return;
    try {
      const p = await app.controller.lock({ calibration: result.calibration, evaluation: result.evaluation, forced, venue, view, W: result.W, H: result.H, preset, corners: result.corners, luma: sceneLuma() });
      app.current = { ...ctx(), preset: p, calibration: result.calibration, lie: ball?.lie ?? app.settings().lie, setupCorners: result.corners };
      toast(forced ? '已強制開始（SETUP_UNVERIFIED）' : '已鎖定預設');
      app.nav.go(mode === 'highspeed' ? 'import' : 'live');
    } catch (e) {
      toast(`鎖定失敗：${e.message}`);
    }
  }

  // ---- C10: high-speed calibration clip (replaces C5) ----
  async function calibClip(file) {
    const dec = app.deps.decode;
    if (!dec?.decodeFile) { toast('影片解碼模組尚未安裝（import/decode.js）'); return; }
    const frames = [];
    try {
      await dec.decodeFile(file, {
        to_s: 2.0,
        onFrame: (frame, t_s) => {
          const W = frame.displayWidth ?? frame.width;
          const H = frame.displayHeight ?? frame.height;
          if (frames.length === 0 || t_s > 1.5) {
            const c = snapshot(frame, W, H);
            if (frames.length < 2) frames.push(c); else frames[1] = c;
          }
          frame.close?.();
        },
      });
    } catch (e) {
      toast(`校正短片解碼失敗：${e.message ?? e}`);
      return;
    }
    if (frames.length < 2) { toast('校正短片太短（要 2 秒）'); return; }
    els.picker.setFrame(frames[0]);
    els.picker.setGhost(null);
    els.picker.reset();
    els.pickerBox.hidden = false;
    els.stage.hidden = true;
    els.pickerDone.onclick = () => {
      const taps = els.picker.corners();
      if (!taps) { toast('請點完四個角'); return; }
      try {
        const a = refineCorners(grayOf(frames[0]), taps);
        const b = refineCorners(grayOf(frames[1]), taps);
        if (!a.ok || !b.ok) { toast('角點精修失敗：放大鏡再點準一點'); return; }
        const drift = cornerDrift(a.corners, b.corners);
        els.pickerBox.hidden = true;
        els.stage.hidden = false;
        els.pickerDone.onclick = finishPicker;
        if (!(drift.max_px <= COMMON_LIMITS.clip_drift_px)) { toast(`兩幀四角漂移 ${drift.max_px.toFixed(2)}px > 1px：腳架晃動，請重錄`); return; }
        solveWith(a.corners, { W: frames[0].width, H: frames[0].height, edge: Math.max(a.max_edge_residual_px, b.max_edge_residual_px), source: 'clip' });
        rec('C10');
        toast(`校正短片 OK：漂移 ${drift.max_px.toFixed(2)}px`);
      } catch (e) {
        toast(`校正失敗：${e.message}`);
      }
    };
  }

  function attachStream() {
    const m = app.controller.media();
    if (els.video && m.stream && els.video.srcObject !== m.stream) {
      els.video.srcObject = m.stream;
      els.video.play?.().catch(() => {});
    }
  }

  function render() {
    const { view, mode, preset } = ctx();
    result = null;
    ball = null;
    recorded = new Set(Object.keys(app.controller.setupTimer.summary().steps));
    const video = h('video.preview', { playsinline: true, muted: true, autoplay: true });
    const overlay = h('canvas.overlay', {});
    const stage = h('div.stage', {}, video, overlay);
    const picker = createCornerPicker({});
    const pickerDone = h('button.primary', { type: 'button', onclick: finishPicker }, '四角完成');
    const pickerBox = h('div.picker-box', { hidden: true }, picker.el, h('div.row', {}, h('button', { type: 'button', onclick: () => picker.reset() }, '重點'), pickerDone,
      h('button', { type: 'button', onclick: () => { pickerBox.hidden = true; stage.hidden = false; } }, '取消')));
    const lockBtn = h('button.primary.big', { type: 'button', disabled: true, onclick: () => doLock(false) }, '鎖定（C9）');
    const forceBtn = h('button.danger', { type: 'button', hidden: true, onclick: () => doLock(true) }, '紅燈仍強制開始');
    const level = h('div.level', {});
    const light = h('div.light-box', {});
    const timer = h('div.timer', {});
    els = { video, overlay, stage, picker, pickerBox, pickerDone, lockBtn, forceBtn, level, light, timer };

    const viewSel = select(Object.entries(VIEW_LABELS), view, { id: 'setup-view' });
    const angleBtn = h('button', { type: 'button' }, '換角度（P16）');
    angleBtn.addEventListener('click', async () => {
      const v = viewSel.value;
      let p = null;
      if (app.repo && ctx().venue) {
        const list = (await app.repo.presets.list({ index: 'venue_id', query: ctx().venue.venue_id })).filter((x) => x.view === v);
        p = list.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0] ?? null;
      }
      app.controller.changeAngle(v, p);
      app.current = { ...ctx(), view: v, preset: p };
      render();
      toast(`改為${VIEW_LABELS[v]}：${v === 'dtl' ? '直拍' : '橫拍'}，重新架設`);
    });

    const clipInput = h('input', { type: 'file', accept: 'video/*', hidden: true, onchange: (e) => e.target.files[0] && calibClip(e.target.files[0]) });
    const c10 = mode === 'highspeed' ? card('C10 高速模式校正短片',
      h('p', '1. 對好幽靈框與水平後，點「釋放相機」。2. 用內建相機錄 2 秒空墊慢動作（240fps、1x）。3. 從「檔案」匯入這段短片。'),
      h('div.row', {}, h('button', { type: 'button', onclick: () => app.controller.releaseCamera() }, '釋放相機'),
        h('button', { type: 'button', onclick: () => clipInput.click() }, '匯入校正短片')), clipInput) : null;

    clear(root,
      screenHeader(`架設：${VIEW_LABELS[view]}`, () => app.nav.go('home')),
      stage, pickerBox,
      h('div.row', {}, h('button.primary', { type: 'button', onclick: openPicker }, mode === 'highspeed' ? '對齊檢查：點四角' : '點四角（放大鏡）'),
        h('button', { type: 'button', onclick: checkBall }, '偵測球（C7）'),
        h('button', { type: 'button', onclick: () => rec('C8') }, '框景 OK（C8）'),
        h('button', { type: 'button', onclick: checkLight }, '光線健檢（P19）')),
      card('水平', level),
      card('燈號', light, h('div.row', {}, lockBtn, forceBtn)),
      c10,
      card('計時', timer),
      card('換角度', viewSel, angleBtn),
      preset ? h('p.hint', `使用預設 ${preset.preset_id}`) : h('p.hint', '新預設：鎖定後會存成這個打位、這個角度的預設。'),
      // e2e only (docs/e2e-hooks.md): rendered only when the test harness set globalThis.__GSL_E2E__ before boot
      globalThis.__GSL_E2E__ ? h('button', { type: 'button', 'data-testid': 'btn-skip-setup', onclick: () => app.nav.go(mode === 'highspeed' ? 'import' : 'live') }, '（測試）略過架設') : null);
    attachStream();
    renderLevel();
    renderLight();
    renderTimer();
  }

  return {
    attachStream,
    show() {
      render();
      if (app.store.get().permissions?.motion !== 'denied') startLevel();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(drawOverlay);
      clearInterval(tick);
      tick = setInterval(renderTimer, 1000);
    },
    hide() {
      cancelAnimationFrame(raf);
      clearInterval(tick);
      stopMotion?.();
      stopMotion = null;
    },
  };
}
