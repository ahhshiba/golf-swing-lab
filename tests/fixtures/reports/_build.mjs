// Regenerates pass_<M>.json / fail_<M>.json:  node tests/fixtures/reports/_build.mjs
// pass_*: every R6 device threshold of that milestone met. fail_*: pass_* with a violation and a missing field.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const clone = (o) => JSON.parse(JSON.stringify(o));
const view = { n: 5, yaw_sd_deg: 0.3, roll_sd_deg: 0.2, d_sd_mm: 12, h_sd_mm: 9, ball_diam_cv_pct: 1.1, corner_sd_px: 2.5 };

const base = {
  schema: 'gsl-device-report/1', app_version: '0.1.0+0123456789', created_at: '2026-11-04T10:00:00.000Z',
  ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  standalone: true, sw_controlled: true, precache_complete: 1,
  storage: { persisted: true, usage: 52000000, quota: 1000000000 },
  webcodecs: { avc1: true, hevc: false }, media_recorder: { types: ['video/mp4', 'video/mp4;codecs=avc1'] },
  gum: { calls: 1, requested_fps: 60, actual_fps: 30, width: 1920, height: 1080 },
  motion: { permission: 'granted', available: true, same_click: true },
  pose: { delegate: 'GPU', lite_ms_p50: 18, full_ms_p50: 41 },
  live: { latency_p95_s: 6.2, frames_dropped_pct: 2.1, detections: 10, actual_swings: 10, touches_per_shot: 0 },
  import: { last: { effective_fps: 239.8, decoded: 1440, sample_count: 1440, hevc: false } },
  setup: { durations_s: { C0: 20, C3: 60 }, total_s: 240, view: 'face_on', n: 12, p90_s: 280, new_venue_s: 540 },
  calibration: { f_px: 1500 }, thermal: { degraded: false },
  repro: { face_on: view, dtl: { ...view }, high_behind: { ...view } },
  droptest: { g_mps2: 9.8 },
  ballstats: { iron: { n: 10, speed_non_null: 8 }, driver: { n: 10, speed_non_null: 7 }, monitor: { uncalibrated_declared: true } },
  highspeed: { n: 4, analysis_s_max: 38 },
  offline: { was_offline: true, import_ok: true, analyze_ok: true, result_ok: true, export_ok: true },
};

const breakers = {
  M1: (r) => { r.sw_controlled = false; delete r.webcodecs; },
  M2: (r) => { r.import.last.decoded = 1439; delete r.pose.full_ms_p50; },
  M2b: (r) => { r.repro.dtl.yaw_sd_deg = 0.9; delete r.repro.high_behind; r.droptest.g_mps2 = 10.5; },
  M4: (r) => { r.ballstats.iron.speed_non_null = 5; delete r.ballstats.driver; },
  M4b: (r) => { r.highspeed.analysis_s_max = 61; r.live.touches_per_shot = null; },
  M5: (r) => { r.live.detections = 7; r.gum.calls = 2; delete r.live.latency_p95_s; },
  M6: (r) => { r.storage.persisted = false; delete r.offline.export_ok; },
};

for (const [m, brk] of Object.entries(breakers)) {
  const pass = clone(base);
  const fail = clone(base);
  brk(fail);
  fs.writeFileSync(path.join(dir, `pass_${m}.json`), JSON.stringify(pass, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, `fail_${m}.json`), JSON.stringify(fail, null, 2) + '\n');
}
