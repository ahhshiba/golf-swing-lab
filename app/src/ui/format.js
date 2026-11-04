// ui/format.js — Traditional Chinese labels and number formatting for the UI. Pure (no DOM).

import { describe } from '../contract/reason-codes.js';
import { REGISTRY } from '../metrics/registry.js';
import { METRIC_IDS } from '../contract/enums.js';

export const VIEW_LABELS = Object.freeze({ face_on: '正面', dtl: '後方（DTL）', high_behind: '高斜角後方' });
export const MODE_LABELS = Object.freeze({ live: '即時模式', highspeed: '高速模式（錄影後匯入）' });
export const EVENT_LABELS = Object.freeze({
  address: '準備', toe_up: '桿頭朝上', mid_backswing: '上桿中段', top: '上桿頂點',
  mid_downswing: '下桿中段', impact: '擊球', mid_follow_through: '送桿中段', finish: '收桿',
});
export const VALIDITY_LABELS = Object.freeze({
  valid: '可信', estimated: '估計', low_confidence: '低可信',
  occluded: '被遮住', ambiguous: '不明確', dropped: '已捨棄', stale: '過期', not_observable: '量不到',
  implausible: '不合理', not_computed: '未計算',
});
export const LIGHT_LABELS = Object.freeze({ green: '綠燈：可以鎖定', amber: '黃燈：可以鎖定（有提醒）', red: '紅燈：還沒對好' });

/** Chinese text for each calib/checks evaluate() failure name (CAFCR C3). */
export const CHECK_LABELS = Object.freeze({
  abs_yaw_deg: '偏航（左右轉向）超出範圍',
  abs_pitch_deg: '俯仰（上下傾斜）超出範圍',
  abs_roll_deg: '滾轉（歪斜）超出範圍',
  abs_Y_m: '側偏太多：腳架要在球線上（≤0.15m）',
  min_D_m: '離球太近：高斜角後方至少 2.75m（driver 安全距離）',
  preset_view: '預設是另一個角度的',
  rel_yaw_deg: '偏航與預設差太多',
  rel_pitch_deg: '俯仰與預設差太多',
  rel_roll_deg: '滾轉與預設差太多',
  rel_D_m: '距離與預設差太多（>50mm）',
  rel_X_m: '沿目標線位置與預設差太多（>50mm）',
  rel_Y_m: '側向位置與預設差太多',
  rel_h_m: '高度與預設差太多（>30mm）',
  rmse_px: '墊子四角重投影誤差太大（>2px）：重新點四角',
  edge_residual_px: '墊子邊線殘差太大（>1.5px）：放大鏡再點準一點',
  f_format: '焦距與鎖定值不符：檢查是否 1x 鏡頭、240fps（不要 120fps 或 2x）',
  ghost_px: '墊子四角離幽靈點太遠（>8px）：微調腳架',
  corners_in_frame: '墊子角太靠近畫面邊緣（要在置中 95% 框內）',
  ball_width: '球的寬度與預測差超過 ±6%：球放錯位置？',
  ball_min_px: '球在畫面上太小（<12px）',
  frames_budget: '預估飛行幀數偏少（提醒）',
});

const UNIT_LABELS = { s: '秒', m: 'm', deg: '°', '%': '%', 'm/s': 'm/s', ratio: '' };

function digitsFor(unit, value) {
  if (unit === 'm') return Math.abs(value) < 1 ? 3 : 1;
  if (unit === 's') return 2;
  if (unit === 'ratio') return 2;
  if (unit === 'm/s') return 1;
  return 1;
}

/** "12.3 ± 0.4 m/s" style text for a Metric value (ci95 half width, else 1.96 sigma). */
export function formatMetric(m) {
  if (!m || m.value === null || m.value === undefined) return '—';
  const d = digitsFor(m.unit, m.value);
  const u = UNIT_LABELS[m.unit] ?? m.unit ?? '';
  let half = null;
  if (Array.isArray(m.ci95)) half = (m.ci95[1] - m.ci95[0]) / 2;
  else if (Number.isFinite(m.sigma)) half = 1.96 * m.sigma;
  const v = m.value.toFixed(d);
  const pm = Number.isFinite(half) ? ` ± ${half.toFixed(d)}` : '';
  return `${v}${pm}${u ? ' ' + u : ''}`;
}

/** Chinese reasons for a null (or downgraded) metric: one line per code. */
export function reasonTexts(codes = []) {
  return codes.map((c) => describe(c) ?? c);
}

/** Rows for the results card in F2 order: { id, label, text, validity, validityLabel, reasons, isNull }. */
export function metricRows(metrics = {}) {
  return METRIC_IDS.map((id) => {
    const m = metrics[id];
    const isNull = !m || m.value === null;
    return {
      id,
      label: REGISTRY[id]?.label_zh ?? id,
      text: formatMetric(m),
      validity: m?.validity ?? 'not_computed',
      validityLabel: VALIDITY_LABELS[m?.validity] ?? '未計算',
      reasons: reasonTexts(m?.reason_codes ?? []),
      isNull,
    };
  });
}

/** Chinese lines for evaluate() failures. */
export function failureTexts(evaluation) {
  return (evaluation?.failures ?? []).map((f) => {
    const label = CHECK_LABELS[f.check] ?? f.check;
    const val = typeof f.value === 'number' ? ` （目前 ${fmtNum(f.value)}，門檻 ${fmtNum(f.limit)}）` : '';
    return label + val;
  });
}

export function fmtNum(x, d = 2) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return String(x);
  return Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(d);
}

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '未知';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.round(n / 1e3)} KB`;
}

export function fmtDuration(s) {
  if (!Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** Worker / pipeline error codes (upper-snake) → Chinese (docs/app-architecture.md §5). */
export const ERROR_TEXTS = Object.freeze({
  GPU_UNAVAILABLE: 'GPU 無法使用，已改用 CPU（會比較慢）',
  MODEL_LOAD_FAILED: '姿勢模型載入失敗（離線檔案不完整？請到診斷頁檢查）',
  WASM_LOAD_FAILED: '分析引擎載入失敗（離線檔案不完整？）',
  DECODE_FAILED: '影片無法解碼：請改用「儲存到檔案」後再從「瀏覽」匯入',
  UNSUPPORTED_CODEC: '不支援這個影片格式（HEVC 可能無法解碼）',
  NO_VIDEO_TRACK: '檔案裡沒有影片',
  CANCELLED: '已取消',
  OUT_OF_MEMORY: '記憶體不足：請關閉其他 App 後再試',
  MODULE_MISSING: '這個功能的模組還沒有安裝到這個版本',
});

export function errorText(e) {
  const msg = e?.message ? String(e.message) : '';
  if (/[\u4e00-\u9fff]/.test(msg)) return msg; // already Traditional Chinese (WorkerError, StoreError, ImportError)
  const code = e?.code ?? e?.name ?? '';
  return ERROR_TEXTS[code] ?? (msg || '發生未預期的錯誤');
}
