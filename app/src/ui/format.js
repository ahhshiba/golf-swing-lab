// ui/format.js — labels and number formatting shared by the screens. Pure (no DOM), no user text of its own: every
// string comes from the catalogs (PRODUCT-SPEC §3.4) — t('reason.<C>.long'), t('error.<C>'), t('metric.<id>.label'),
// t('validity.<v>'), t('calib.check.<id>') (B's namespace). Numbers with units: fmtMetric from ../i18n/units.js.

import { t, has, fmtNum as fmtLocaleNum } from '../i18n/index.js';
import { fmtMetric, DEFAULT_UNITS } from '../i18n/units.js';
import { METRIC_IDS } from '../contract/enums.js';

export { fmtMetric };

/** "12.3 ± 0.4 m/s" style text for a Metric value in the given display units (default yd · mph). */
export function formatMetric(m, units = DEFAULT_UNITS) {
  if (!m || m.value === null || m.value === undefined) return '—';
  return fmtMetric(m, units).text;
}

/** Localized reason lines for a null (or downgraded) metric: one line per code (t('reason.<C>.long')). */
export function reasonTexts(codes = []) {
  return codes.map((c) => (has(`reason.${c}.long`) ? t(`reason.${c}.long`) : t('common.unknown')));
}

/** Rows for the results card: { id, label, text, validity, validityLabel, reasons, isNull }. */
export function metricRows(metrics = {}, units = DEFAULT_UNITS) {
  return METRIC_IDS.map((id) => {
    const m = metrics[id];
    const isNull = !m || m.value === null;
    const validity = m?.validity ?? 'not_computed';
    return {
      id,
      label: t(`metric.${id}.label`),
      text: formatMetric(m, units),
      validity,
      validityLabel: t(`validity.${validity}`),
      reasons: reasonTexts(m?.reason_codes ?? []),
      isNull,
    };
  });
}

/** Localized lines for calib/checks evaluate() failures: t('calib.check.<id>', { value, limit }). */
export function failureTexts(evaluation) {
  return (evaluation?.failures ?? []).map((f) => {
    const params = typeof f.value === 'number' ? { value: fmtNum(f.value), limit: fmtNum(f.limit) } : {};
    return t(`calib.check.${f.check}`, { ...params, ...(f.params ?? {}) });
  });
}

/** Locale-formatted number: ≥ 100 → no decimals, else `d` decimals (non-numbers pass through as text). */
export function fmtNum(x, d = 2) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return String(x);
  return fmtLocaleNum(x, { digits: Math.abs(x) >= 100 ? 0 : d });
}

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return t('common.unknown');
  if (n >= 1e9) return `${fmtLocaleNum(n / 1e9, { digits: 2 })} GB`;
  if (n >= 1e6) return `${fmtLocaleNum(n / 1e6, { digits: 1 })} MB`;
  return `${fmtLocaleNum(Math.round(n / 1e3))} KB`;
}

export function fmtDuration(s) {
  if (!Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** User text for an error: t('error.<code>', e.params); unknown codes → t('error.INTERNAL'). Never e.message. */
export function errorText(e) {
  const code = e?.code ?? e?.name ?? '';
  if (code && has(`error.${code}`)) return t(`error.${code}`, e?.params ?? {});
  return t('error.INTERNAL');
}

/** The fix line for an error code, or '' (t('error.<code>.fix')). */
export function errorFix(e) {
  const code = e?.code ?? e?.name ?? 'INTERNAL';
  return has(`error.${code}.fix`) ? t(`error.${code}.fix`, e?.params ?? {}) : '';
}
