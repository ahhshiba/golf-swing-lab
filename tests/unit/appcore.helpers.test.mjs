// Pure app-core helpers: thermal guard, C2 narrow-bay table, formatting, check labels, event monotonicity,
// P6 recompute → bumpRevision, icon generator determinism.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createThermalGuard } from '../../app/src/session/thermal.js';
import { bayAdvice, twoMeasureCheck } from '../../app/src/session/bay.js';
import { formatMetric, metricRows, failureTexts, errorText } from '../../app/src/ui/format.js';
import { migrateShot } from '../../app/src/contract/migrate.js';
import { checkMonotonic, nearestIndex } from '../../app/src/ui/replay.js';
import { recomputeShot } from '../../app/src/ui/shot.js';
import { buildFilter } from '../../app/src/ui/history.js';
import { streamFocal } from '../../app/src/ui/setup.js';
import { evaluate, VIEW_LIMITS } from '../../app/src/calib/checks.js';
import { METRIC_IDS } from '../../app/src/contract/enums.js';
import { validateShot } from '../../app/src/contract/validate.js';
import { nominalF } from '../../app/src/calib/pnp.js';
import { renderIcon, crc32 } from '../../scripts/make_icons.mjs';

const fx = (n) => JSON.parse(fs.readFileSync(new URL(`../fixtures/shots/${n}.json`, import.meta.url), 'utf8'));

test('thermal guard: needs ≥ 5 samples; drops > 10 % also degrade; no action under the limits', () => {
  const g = createThermalGuard();
  for (let i = 0; i < 4; i++) assert.equal(g.push({ latency_s: 30 }).action, 'none');
  assert.equal(g.push({ latency_s: 30 }).action, 'degrade');
  const h = createThermalGuard();
  for (let i = 0; i < 20; i++) assert.equal(h.push({ latency_s: 5, dropped_frac: 0.05 }).action, 'none');
  const k = createThermalGuard();
  let d;
  for (let i = 0; i < 5; i++) d = k.push({ dropped_frac: 0.11 });
  assert.equal(d.action, 'degrade');
});

test('C2 narrow-bay table: B → D, height limit and verdict', () => {
  assert.equal(bayAdvice(3.1).verdict, 'ideal');
  assert.equal(bayAdvice(3.1).D_m, 2.7);
  assert.equal(bayAdvice(2.95).h_max, 0.87);
  const b = bayAdvice(2.7);
  assert.equal(b.verdict, 'usable');
  assert.equal(b.h_max, 0.74);
  assert.ok(Math.abs(b.D_m - 2.45) < 1e-9);
  assert.equal(bayAdvice(2.5).verdict, 'usable_short');
  assert.equal(bayAdvice(2.5).h_max, 0.67);
  assert.equal(bayAdvice(2.3).verdict, 'not_guaranteed');
  assert.equal(bayAdvice(NaN).ok, false);
  assert.equal(twoMeasureCheck(1.5, 1.503).ok, true);
  assert.equal(twoMeasureCheck(1.5, 1.5035).ok, false);
});

test('results card rows: every metric id, value ± ci95 in display units, nulls carry localized reasons', async () => {
  const { initI18n, setLocale } = await import('../../app/src/i18n/index.js');
  const fsFetch = async (u) => { const p = new URL(String(u)); return fs.existsSync(p) ? { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) } : { ok: false, status: 404, json: async () => ({}) }; };
  await initI18n({ locale: 'zh-Hant', fetchImpl: fsFetch, base: new URL('../../app/i18n/', import.meta.url).href });
  const shot = migrateShot(fx('valid_face_on_240')).shot; // the screens get golf-shot/2 (store reads migrate)
  const rows = metricRows(shot.metrics);
  assert.deepEqual(rows.map((r) => r.id), [...METRIC_IDS]);
  for (const r of rows) {
    if (r.isNull) {
      assert.equal(r.text, '—');
      assert.ok(r.reasons.length > 0, r.id);
      for (const t of r.reasons) assert.match(t, /[一-鿿]/);
    } else assert.match(r.text, /\d/, r.id); // ± is shown only when the CI is non-zero at display precision (§2.3)
    assert.ok(r.validityLabel && !/^validity\./.test(r.validityLabel), r.validityLabel);
    assert.ok(!/^metric\./.test(r.label), r.label);
  }
  // SI → display units (§3.3): m/s → mph by default, metric units when asked
  assert.equal(formatMetric({ value: 61.234, unit: 'm/s', ci95: [60.1, 62.3], sigma: null }, { distance: 'm', speed: 'm/s', body: 'cm', clubLength: 'in', height: 'cm' }), '61.2 ± 1.1 公尺/秒');
  assert.match(formatMetric({ value: 61.234, unit: 'm/s', ci95: [60.1, 62.3], sigma: null }), /^137\.0 ± 2\.5 英里\/時$/);
  assert.equal(formatMetric({ value: null }), '—');
  assert.ok(metricRows({}).every((r) => r.isNull && r.validity === 'not_computed'));
  await setLocale('en');
  for (const r of metricRows(shot.metrics)) for (const x of [r.label, r.validityLabel, ...r.reasons]) assert.ok(!/[一-鿿]/.test(x), x);
  await setLocale('zh-Hant');
});

test('every failure evaluate() can report maps to a calib.check.<id> key with formatted value/limit; errors never show e.message', async () => {
  const names = new Set();
  for (const view of Object.keys(VIEW_LIMITS)) {
    const bad = { yaw_deg: 9, pitch_deg: -9, roll_deg: 9, X_m: 9, Y_m: 9, h_m: 9, D_m: 0.5 };
    const e = evaluate({ view, report: bad, rmse_px: 9, edge_residual_px: 9, f_free_px: 2000, f_locked_px: 1000, corner_source: 'manual',
      preset: { view, pose: { yaw_deg: 0, pitch_deg: 0, roll_deg: 0, X_m: 0, Y_m: 0, h_m: 0, D_m: 3 } }, ghost_px: 99,
      corners: [[0, 0], [1, 1], [2, 2], [3, 3]], W: 100, H: 100, gravity_available: false, frames_budget: 2, ball: { w_px: 5, predicted_w_px: 10 } });
    for (const f of e.failures) names.add(f.check);
    const e2 = evaluate({ view, report: bad, preset: { view: 'other', pose: bad } });
    for (const f of e2.failures) names.add(f.check);
  }
  assert.ok(names.size > 5);
  for (const n of names) assert.match(n, /^[A-Za-z][A-Za-z0-9_]*$/, `check id ${n} is usable as a catalog key`);
  // the line is the calib.check.<id> text (B's catalog); without it t() returns the key, never Chinese prose from here
  const lines = failureTexts({ failures: [{ check: 'rmse_px', value: 3.2, limit: 2 }] });
  assert.equal(lines.length, 1);
  const { t: tr } = await import('../../app/src/i18n/index.js');
  assert.equal(lines[0], tr('calib.check.rmse_px', { value: '3.20', limit: '2.00' }));
  assert.ok(!/[A-Z]{3,}_/.test(lines[0]), lines[0]);
  assert.equal(errorText({ code: 'DECODE_FAILED', message: 'secret detail' }).includes('secret'), false);
  assert.equal(errorText({ code: 'UNSUPPORTED_CODEC', message: 'x' }), '這台裝置無法解碼這個影片格式');
  assert.equal(errorText({ code: 'NOT_A_CODE_ANYONE_KNOWS', message: 'raw' }), errorText({}));
});

test('event correction: non-monotonic frames are rejected, a valid move bumps the revision and keeps history', () => {
  const shot = fx('valid_face_on_240');
  const ev = JSON.parse(JSON.stringify(shot.events));
  ev.top = { ...ev.top, frame: ev.mid_downswing.frame + 5, source: 'manual' };
  const mono = checkMonotonic(ev);
  assert.equal(mono.ok, false);
  assert.equal(mono.code, 'replay.error.order');
  assert.equal(mono.params.event, 'mid_downswing');
  assert.equal(mono.params.before, 'top');
  const r = recomputeShot(shot, ev);
  assert.equal(r.ok, false);
  const ok = JSON.parse(JSON.stringify(shot.events));
  ok.impact = { ...ok.impact, frame: ok.impact.frame + 1, t_s: (ok.impact.frame + 1) / 240, source: 'manual', conf: 1 };
  const r2 = recomputeShot(shot, ok, { at: '2026-11-04T10:00:00.000Z' });
  assert.equal(r2.ok, true, r2.message);
  assert.equal(r2.shot.revision, shot.revision + 1);
  assert.equal(r2.shot.events.impact.source, 'manual');
  assert.equal(r2.shot.history.at(-1).before.events.impact.frame, shot.events.impact.frame);
  assert.ok(validateShot(r2.shot).ok, JSON.stringify(validateShot(r2.shot).errors));
  // tempo follows the moved impact (no pose sequence stored: only F2 row 1 is recomputed)
  const D = r2.shot.events.impact.t_s - r2.shot.events.top.t_s;
  assert.ok(Math.abs(r2.shot.metrics.downswing_s.value - D) < 1e-9);
  assert.deepEqual(r2.shot.metrics.ball_speed_mps, shot.metrics.ball_speed_mps);
  assert.equal(nearestIndex([0, 1, 2, 3], 2.4), 2);
  assert.equal(nearestIndex([0, 1, 2, 3], 9), 3);
});

test('history filter drops empty values; stream focal scales the venue lock to the stream resolution', () => {
  assert.deepEqual(buildFilter({ view: '', preset_id: 'p', club_type: '' }), { preset_id: 'p' });
  const sf = streamFocal({ f_locked: 1400, f_W: 1920, f_H: 1080 }, null, 1280, 720);
  assert.ok(sf.locked && Math.abs(sf.f - (1400 * 1280) / 1920) < 1e-9);
  assert.deepEqual(streamFocal(null, null, 1920, 1080), { f: nominalF(1920, 1080), locked: false });
});

test('icons: committed PNGs match the deterministic generator', () => {
  assert.equal(crc32(Buffer.from('IEND', 'ascii')), 0xae426082);
  for (const [name, size, r] of [['apple-touch-icon-180.png', 180, 0.28], ['icon-192.png', 192, 0.3]]) {
    const png = renderIcon(size, r);
    assert.ok(png.equals(renderIcon(size, r)), 'deterministic');
    assert.ok(png.equals(fs.readFileSync(new URL(`../../app/icons/${name}`, import.meta.url))), `${name} is stale: run node scripts/make_icons.mjs`);
  }
});
