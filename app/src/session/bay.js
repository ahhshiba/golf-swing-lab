// session/bay.js — CAFCR C2 窄打位 table: face-on distance and phone-height limit from the bay depth B
// (ball to the facing partition, tripod takes 0.25 m, D = B − 0.25). Pure data + lookup.

export const TRIPOD_DEPTH_M = 0.25;

/** Rows of CAFCR C2 (B lower bound, nominal D at that bound, phone-height limit, shift, verdict). */
export const BAY_TABLE = Object.freeze([
  Object.freeze({ B_min: 2.95, D: 2.7, h_max: 0.87, h_nominal: 0.84, shift: 0.4, frames: '9.7／7.4／6.1', top_m: 2.07, verdict: 'ideal', text: '理想：D=2.7m、手機高度 0.84m（上限 0.87m）、往目標側平移 0.4m' }),
  Object.freeze({ B_min: 2.65, D: 2.4, h_max: 0.74, h_nominal: 0.74, shift: 0.4, frames: '8.7／6.6／5.5', top_m: 1.86, verdict: 'usable', text: '可用：手機高度 ≤0.74m、平移 0.4m' }),
  Object.freeze({ B_min: 2.45, D: 2.2, h_max: 0.67, h_nominal: 0.67, shift: 0.4, frames: '8.1／6.1／5.1', top_m: 1.72, verdict: 'usable_short', text: '可用：手機高度 ≤0.67m；driver 球速 >70m/s 時常出現「飛行幀數不夠」' }),
  Object.freeze({ B_min: 0, D: 2.0, h_max: 0.59, h_nominal: 0.59, shift: 0.34, frames: '7.2／5.4／4.4', top_m: 1.57, verdict: 'not_guaranteed', text: '正面球數據不保證：建議改以後方（DTL）或高斜角後方為主' }),
]);

/**
 * bayAdvice(B_m) -> { ok, B_m, D_m (= B − 0.25, capped at 2.7), row, h_max, shift, verdict, text } |
 * { ok: false, text } for a missing / non-positive B. The row is the one whose lower bound B satisfies
 * (conservative between rows).
 */
export function bayAdvice(B_m) {
  if (!(Number.isFinite(B_m) && B_m > TRIPOD_DEPTH_M)) return { ok: false, B_m: null, text: '請輸入球到面前隔板的距離 B（公尺）' };
  const row = BAY_TABLE.find((r) => B_m >= r.B_min);
  const D_m = Math.min(2.7, +(B_m - TRIPOD_DEPTH_M).toFixed(3));
  return { ok: true, B_m, D_m, row, h_max: row.h_max, shift: row.shift, verdict: row.verdict, text: row.text };
}

/** P1: two measurements agree within 3 mm → { ok, mean, diff_mm }. */
export function twoMeasureCheck(a, b, tol_mm = 3) {
  if (!(Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0)) return { ok: false, mean: null, diff_mm: null };
  const diff_mm = Math.abs(a - b) * 1000;
  return { ok: diff_mm <= tol_mm + 1e-9, mean: (a + b) / 2, diff_mm };
}
