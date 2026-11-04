// ui/live.js — P4 live mode: status, last-shot card, touches counter (KD7: 0 touches per shot).
// Wires media's pipeline/live.js createLiveLoop to the frame tap, segment recorder, onset detector and the
// vision worker client; P18 decisions go through the session controller (controller.reportLive).

import { h, clear, card, toast, screenHeader } from './dom.js';
import { VIEW_LABELS, metricRows, errorText } from './format.js';
import { newId, nowIso } from '../session/ids.js';

const STATE_LABELS = Object.freeze({ IDLE: '等待準備姿勢', ADDRESS: '準備姿勢', SWING: '揮桿中', IMPACT: '擊球', FINISH: '收桿', ANALYZING: '分析中…' });
const CARD_IDS = ['tempo_ratio', 'backswing_s', 'downswing_s', 'head_sway_x_m', 'shoulder_turn_deg', 'hip_turn_deg', 'club_speed_mps', 'ball_speed_mps'];

export function mountLive(root, app) {
  let pipeline = null;
  let touches = 0;
  let shots = 0;
  let touchesPerShot = [];
  let els = {};
  const onTouch = () => { touches += 1; pipeline?.loop?.touch(); renderCounter(); };

  function renderCounter() {
    if (els.counter) els.counter.textContent = `這一球碰了螢幕 ${touches} 次（目標 0）· 已打 ${shots} 球`;
  }

  function renderShot(shot) {
    if (!els.last) return;
    if (!shot) { clear(els.last, h('p', '還沒有球。站好準備姿勢 0.5 秒就會開始。')); return; }
    const rows = metricRows(shot.metrics).filter((r) => CARD_IDS.includes(r.id));
    clear(els.last,
      h('ul.metric-list.compact', {}, rows.map((r) => h('li', { class: r.isNull ? 'null' : '' }, h('span.m-label', r.label), h('span.m-value', r.isNull ? '—' : r.text), h('span', { class: `badge v-${r.validity}` }, r.validityLabel)))),
      h('button', { type: 'button', onclick: () => app.nav.go('shot', { shot_id: shot.shot_id }) }, '看完整結果'));
  }

  async function onShot({ shot, clipBlob = null, poseSeq = null }) {
    try {
      const q = { ...shot, quality: { ...(shot.quality ?? {}), touches } };
      const saved = await app.controller.saveShot(q, { clipBlob, poseSeq });
      touchesPerShot.push(touches);
      touches = 0;
      shots += 1;
      renderShot(saved);
      renderCounter();
    } catch (e) {
      toast(`這一球無法保存：${e.message}`);
    }
  }

  async function start() {
    const mod = app.deps.livePipeline;
    const m = app.controller.media();
    if (!mod?.createLiveLoop || !app.deps.frametap?.createFrameTap || !app.deps.recorder?.createSegmentRecorder || !app.vision) {
      clear(els.state, h('p.warn', '即時分析模組尚未安裝：請改用高速模式「匯入影片」。'));
      return;
    }
    if (!m.stream) { clear(els.state, h('p.warn', '相機沒有開啟：請回到首頁重新「開始練習」，或改用匯入影片。')); return; }
    const cur = app.current ?? {};
    const st = app.settings();
    const sess = app.store.get().session ?? {};
    const video = els.video;
    try {
      const vc = await app.vision();
      let tap = null;
      let loop = null;
      const recorder = app.deps.recorder.createSegmentRecorder(m.stream, { mediaClock: () => tap?.lastMediaTime() ?? video.currentTime });
      let onset = { available: false, stop() {} };
      if (m.audioCtx && m.audioTrack && app.deps.onset?.startOnsetDetector) {
        onset = await app.deps.onset.startOnsetDetector(m.audioCtx, m.stream, { onOnset: (t, level_db) => loop?.handleOnset(t, level_db), toMediaTime: (ms) => tap?.mediaTimeAt(ms) ?? null });
      }
      const club = { type: st.club_type, length_m: st.club_length_m, lie: cur.lie ?? st.lie, tee_lift_m: cur.venue?.tee_lift_m ?? null, tee_lift_source: Number.isFinite(cur.venue?.tee_lift_m) ? 'measured' : 'assumed' };
      loop = mod.createLiveLoop({
        // e2e only (docs/e2e-hooks.md, gate m5): a harness-provided pose stand-in replaces MediaPipe when
        // globalThis.__GSL_E2E__.pose was set before boot; everything else (frame tap, onsets, detector) stays real
        pose: typeof globalThis.__GSL_E2E__?.pose === 'function'
          ? (bitmap, t_s, model, o) => globalThis.__GSL_E2E__.pose(bitmap, t_s, model, o)
          : (bitmap, t_s, model, o) => vc.pose(bitmap, t_s, model, o),
        recorder,
        analyzeSegment: (blob, options) => vc.analyzeClip(blob, options),
        clipOptions: { view: cur.view ?? app.store.get().view, calibration: cur.calibration ?? null, club, handedness: st.handedness, venue: cur.venue ?? null, pose_model: 'full', warnings: app.controller.warnings() },
        newIds: () => ({ shot_id: newId('shot'), session_id: sess.session_id ?? null, venue_id: sess.venue_id ?? null, preset_id: app.store.get().session?.preset_id ?? null, created_at: nowIso(), app_version: app.version() }),
        calibration: cur.calibration ?? null, handedness: st.handedness, audioAvailable: Boolean(onset.available),
        mediaClock: () => tap?.lastMediaTime() ?? video.currentTime,
        setFps: (hz) => tap?.setFps(hz),
        frameStats: () => tap?.stats(),
        thermal: { push: (x) => app.controller.reportLive(x) },
        onShot: (r) => onShot({ shot: r.shot, clipBlob: r.segment ?? null }),
        onEvent: (ev) => { if (ev.type === 'state' && els.state) els.state.textContent = STATE_LABELS[ev.to] ?? String(ev.to); if (ev.type === 'shot' && els.state) els.state.textContent = ev.kind === 'swing' ? STATE_LABELS.ANALYZING : '空揮（不分析）'; },
        onError: (e) => toast(errorText(e)),
        onStopLive: () => { stop(); toast('即時模式仍然太慢：請改用高速模式（錄影後匯入）'); },
      });
      tap = app.deps.frametap.createFrameTap(video, { fps: 10, onFrame: (bm, t, meta) => loop.handleFrame(bm, t, meta) });
      recorder.start();
      tap.start();
      pipeline = { loop, stop() { try { tap.stop(); } catch (_) { /* ignore */ } try { recorder.stop(); } catch (_) { /* ignore */ } try { onset.stop(); } catch (_) { /* ignore */ } } };
      if (els.state) els.state.textContent = STATE_LABELS.IDLE;
    } catch (e) {
      clear(els.state, h('p.warn', `即時分析無法啟動：${errorText(e)}`));
    }
  }

  function render() {
    const view = app.current?.view ?? app.store.get().view;
    const video = h('video.preview.small', { playsinline: true, muted: true, autoplay: true });
    const m = app.controller.media();
    if (m.stream) { video.srcObject = m.stream; video.play?.().catch(() => {}); }
    els = { video, state: h('p.live-state', { role: 'status' }, '準備中…'), last: h('div', {}), counter: h('p.counter', '') };
    clear(root,
      screenHeader(`即時模式：${VIEW_LABELS[view] ?? view}`, () => app.nav.go('home')),
      els.state, video,
      card('上一球', els.last),
      els.counter,
      h('div.row', {},
        h('button', { type: 'button', onclick: () => { stop(); app.nav.go('setup'); } }, '換角度／重新架設'),
        h('button', { type: 'button', onclick: () => { stop(); app.nav.go('import'); } }, '改用匯入影片'),
        h('button.danger', { type: 'button', onclick: async () => { stop(); await app.controller.endSession(); app.updater?.sessionEnded(); app.nav.go('home'); } }, '結束練習')));
    renderShot(null);
    renderCounter();
  }

  function stop() {
    try { pipeline?.stop?.(); } catch (_) { /* ignore */ }
    pipeline = null;
  }

  return {
    show() {
      touches = 0;
      render();
      document.addEventListener('pointerdown', onTouch, { capture: true });
      start();
    },
    hide() {
      document.removeEventListener('pointerdown', onTouch, { capture: true });
      stop();
    },
  };
}
