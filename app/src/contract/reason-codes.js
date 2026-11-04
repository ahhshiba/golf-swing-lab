// Reason codes for golf-shot/1 (CAFCR §F3). Every code used anywhere in app/src must be referenced as
// RC.<NAME> (imported from this file) so scripts/check_contract.mjs can verify it statically.
// Owner: contract module. Other modules may only read this file; ask for new codes in their report.

export const REASON_CODES = Object.freeze({
  VIEW_DEPTH_AXIS: '這個角度沿鏡頭方向看不到深度，無法量這個指標',
  VIEW_PLANE_MISMATCH: '這個指標的動作平面和鏡頭不垂直，這個角度量不到',
  FPS_TOO_LOW: '幀率太低（球數據需要 200fps 以上的慢動作）',
  TRACK_TOO_SHORT: '球或桿頭在畫面中被偵測到的次數不夠（少於 5 次）',
  TRACK_MAY_BE_SHORT: '依目前架設預估，快速球的飛行幀數可能偏少（只是提醒）',
  LAUNCH_DIR_UNOBSERVABLE: '這個角度看不到左右出球方向',
  DEPENDS_ON_NULL: '這個數字需要的其他數字沒有算出來',
  SPIN_ASSUMED: '旋轉量沒有量測，用球桿的典型值估計',
  WIND_IGNORED: '沒有考慮風',
  TIMESTAMPS_NOMINAL: '影片沒有可靠的時間戳，改用名目幀率',
  TIMEBASE_SUSPECT: '下桿時間不合理，影片可能被轉檔或改了幀率',
  SETUP_UNVERIFIED: '架設檢查沒有全部通過就開始了',
  CALIB_STALE: '墊子位置和校正時不同（相機或墊子被移動）',
  PRESET_MISMATCH: '比較的兩球來自不同的機位預設',
  DEPTH_DRIFT_SUSPECT: '球的起飛方向偏離太多或擬合殘差大，深度可能不準',
  ROLLING_SHUTTER_ASSUMED: '滾動快門讀出時間用假設值校正',
  BODY_PLANE_ASSUMED: '腳踝不在墊子上，身體平面的距離用假設值',
  NO_GRAVITY_REF: '沒有水平儀資料，俯仰與滾轉只靠墊子推算',
  AUDIO_UNAVAILABLE: '沒有麥克風，擊球時間改用手腕速度估計',
  THERMAL_DEGRADED: '手機發熱或太慢，自動降低了分析精度',
  TEE_LIFT_ASSUMED: '球座高度沒有量過，用典型值估計',
  POSE_LOW_VISIBILITY: '身體關鍵點看不清楚',
  EVENTS_UNCERTAIN: '揮桿事件時間不確定',
  OUT_OF_FRAME: '需要的身體部位或桿頭在畫面外',
  IMPLAUSIBLE_VALUE: '計算結果超出合理範圍，已捨棄',
  NOT_IMPLEMENTED: '這個版本還沒有提供這個指標',
});

export const RC = Object.freeze(Object.fromEntries(Object.keys(REASON_CODES).map((k) => [k, k])));

export function describe(code) {
  return REASON_CODES[code] ?? null;
}
