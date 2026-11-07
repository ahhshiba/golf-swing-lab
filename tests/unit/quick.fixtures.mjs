#!/usr/bin/env node
// tests/unit/quick.fixtures.mjs — generator of tests/fixtures/v4/quick-swings.json (V04-SPEC §F.8; V4-B, deferred from
// V4-A per docs/V04-INTERFACES.md §6) and its loader for the quick.* tests.
//
//   node tests/unit/quick.fixtures.mjs           write the fixture (deterministic: fixed seeds, no clock)
//   node tests/unit/quick.fixtures.mjs --check   exit 1 when the file on disk differs from a fresh generation
//
// 200 synthetic swings (tests/synth): 140 face_on (tests/synth/cells.js clubSpeedSwing: the lead arm and club-head
// kinematics with a known head speed), 30 dtl and 30 high_behind (tests/synth/swing.js synthSwing); the swing sample
// rate alternates 30 / 60 fps (half each); every 5th swing is left-handed, every 5th (another phase) has no impact
// sound. Each swing is replayed the way pipeline/live.js sees it: pose frames -> wristSample() + leadWrist() (the live
// loop's own body-plane conversion through the synthetic calibration) at 10 Hz until the live detector enters SWING, then at the
// swing rate (setFps), audio onsets interleaved in media order. Stored per swing:
//   samples [[t_s, x_m, y_m, xl_m, yl_m] …] (the wrist samples the live loop would have: hands midpoint and lead wrist,
//           up to impact + 0.6 s), audio [t_s …],
//   refined = the current full analysis (pipeline/assemble.js assembleShot on the same pose sequence at the swing rate,
//             with the audio onset when there is one): backswing_s, downswing_s, tempo_ratio, club_speed_mps as
//             { value, ci95, validity } and the event times; this is what the quick read is compared with;
//   truth   = the synthetic ground truth (event times, head speed for face_on).
// The refined analysis in the app runs on the recorded segment at <= 60 Hz with the full pose model; here it runs on
// the same synthetic pose at the swing rate (no second, independent pose noise draw): the quick-vs-refined
// differences measured with this fixture are the method differences, not pose-model differences.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clubSpeedSwing, clubSpeedInput } from '../synth/cells.js';
import { synthSwing } from '../synth/swing.js';
import { mulberry32, gauss } from '../../app/src/geom/rng.js';
import { createLiveDetector } from '../../app/src/events/live.js';
import { wristSample } from '../../app/src/pipeline/live.js';
import { leadWrist } from '../../app/src/quick/live.js';
import { assembleShot } from '../../app/src/pipeline/assemble.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const QUICK_SWINGS = path.join(ROOT, 'tests/fixtures/v4/quick-swings.json');
const N = 200;
const SEED = 11;
const r5 = (x) => Math.round(x * 1e5) / 1e5;
const r4 = (x) => (Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : null);
const OTHER_CLUBS = [['7i', 0.94], ['driver', 1.15], ['pw', 0.9], ['5i', 0.965], ['hybrid', 1.0], ['9i', 0.915]];

function specOf(i) {
  const fps = i % 2 === 0 ? 30 : 60;
  const view = i < 140 ? 'face_on' : i < 170 ? 'dtl' : 'high_behind';
  return { i, fps, view, handedness: i % 5 === 4 ? 'left' : 'right', audio: i % 5 !== 2 };
}

/** The live loop's view of one pose sequence: 10 Hz until SWING, then the swing rate. */
function liveSamples(poseSeq, calibration, handedness, fps, audio) {
  const det = createLiveDetector({ audioAvailable: true });
  const out = [];
  const aud = audio.slice();
  let rate = 10;
  let nextT = -Infinity;
  const T = poseSeq.t_s;
  for (let k = 0; k < T.length; k++) {
    const t = T[k];
    if (t + 1e-6 < nextT) continue;
    nextT = t + 1 / rate - 0.25 / fps;
    while (aud.length && aud[0] <= t) det.feed({ type: 'audio', t_s: aud.shift() });
    const img = poseSeq.img.subarray(k * 132, k * 132 + 132);
    const world = poseSeq.world.subarray(k * 99, k * 99 + 99);
    const s = wristSample(img, world, { calibration, handedness });
    if (!s) continue;
    const l = leadWrist(img, world, { calibration, handedness }); // what quick/live.js adds to each sample
    out.push([r5(t), r4(s.x_m), r4(s.y_m), r4(l?.xl_m), r4(l?.yl_m)]);
    for (const ev of det.feed({ ...s, t_s: t })) {
      if (ev.type === 'state' && ev.to === 'SWING') rate = fps;
      if (ev.type === 'state' && (ev.to === 'IDLE' || ev.to === 'ADDRESS')) rate = 10;
    }
  }
  return out;
}

const metricOut = (m) => (m && Number.isFinite(m.value) ? { value: r5(m.value), ci95: m.ci95 ? m.ci95.map(r5) : null, validity: m.validity } : { value: null, validity: m?.validity ?? null });

export function makeSwing(i) {
  const sp = specOf(i);
  const rng = mulberry32(SEED * 7919 + i);
  let poseSeq, calibration, events, club, input, truth;
  if (sp.view === 'face_on') {
    const c = clubSpeedSwing({ seed: SEED, i, fps: sp.fps, handedness: sp.handedness });
    poseSeq = c.poseSeq; calibration = c.calibration; events = c.events;
    club = { type: 'driver', length_m: r5(c.club.length_m) };
    input = clubSpeedInput(c, { i, seed: SEED });
    truth = { club_speed_mps: r5(c.truth.club_speed_mps) };
  } else {
    const sw = synthSwing({ seed: 5000 + i, view: sp.view, fps: sp.fps, handedness: sp.handedness });
    poseSeq = sw.poseSeq; calibration = sw.calibration;
    events = Object.fromEntries(Object.entries(sw.truth.events).map(([k, e]) => [k, e ? { t_s: e.t_s } : null]));
    const [type, length_m] = OTHER_CLUBS[i % OTHER_CLUBS.length];
    club = { type, length_m };
    input = {
      capture: { mode: 'live', view: sp.view, source: 'camera', orientation: 'landscape-primary', width: poseSeq.W, height: poseSeq.H,
        nominal_fps: sp.fps, effective_fps: sp.fps, vfr: false, timestamps: 'container' },
      calibration, venue: { mat_L: 1.5, mat_W: 1.25, ball_edge_m: 0.3, ball_x_m: 0 }, handedness: sp.handedness, poseSeq, events: null,
      club: { type, lie: 'mat', tee_lift_m: 0, tee_lift_source: 'measured', length_m },
      ids: { shot_id: `quick-${i}`, session_id: 'quick-fixture', venue_id: 'venue-quick', preset_id: null, created_at: '2026-11-07T00:00:00Z', app_version: '0.0.0-quick' },
      warnings: [], seed: i + 1,
    };
    truth = { club_speed_mps: null };
  }
  const tImp = events.impact.t_s;
  const audio = sp.audio ? [r5(tImp + gauss(rng, 0, 0.003))] : [];
  // the quick read never looks past impact + 0.6 s (it runs at impact + 0.02 s): later samples are not stored
  const samples = liveSamples(poseSeq, calibration, sp.handedness, sp.fps, audio).filter((x) => x[0] <= tImp + 0.6);
  const r = assembleShot({ ...input, audioOnset_t: audio.length ? audio[0] : undefined, nMC: 200, nCarry: 50 });
  const m = r.shot.metrics;
  return {
    id: `q${String(i).padStart(3, '0')}`, view: sp.view, fps: sp.fps, handedness: sp.handedness, club,
    calibration: { pose: { D_m: r5(calibration.pose.D_m) }, camera: { f: r5(calibration.camera.f) } },
    samples, audio,
    refined: {
      backswing_s: metricOut(m.backswing_s), downswing_s: metricOut(m.downswing_s), tempo_ratio: metricOut(m.tempo_ratio),
      club_speed_mps: metricOut(m.club_speed_mps),
      events: Object.fromEntries(['address', 'top', 'impact'].map((k) => [k, Number.isFinite(r.shot.events[k]?.t_s) ? r5(r.shot.events[k].t_s) : null])),
    },
    truth: { ...truth, t_address: r5(events.address.t_s), t_top: r5(events.top.t_s), t_impact: r5(tImp) },
  };
}

export function buildQuickSwings() {
  return {
    schema: 'gsl-quick-swings/1',
    note: 'Synthetic live-mode wrist samples + the refined (full-analysis) values of the same swings; tests/unit/quick.fixtures.mjs',
    n: N,
    swings: Array.from({ length: N }, (_, i) => makeSwing(i)),
  };
}

export function loadQuickSwings() {
  return JSON.parse(fs.readFileSync(QUICK_SWINGS, 'utf8'));
}

const render = (o) => `${JSON.stringify(o)}\n`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fresh = render(buildQuickSwings());
  if (process.argv.includes('--check')) {
    const ok = fs.existsSync(QUICK_SWINGS) && fs.readFileSync(QUICK_SWINGS, 'utf8') === fresh;
    console.log(ok ? 'quick-swings.json OK' : 'quick-swings.json differs from a fresh generation');
    process.exit(ok ? 0 : 1);
  }
  fs.mkdirSync(path.dirname(QUICK_SWINGS), { recursive: true });
  fs.writeFileSync(QUICK_SWINGS, fresh);
  console.log(`wrote ${path.relative(ROOT, QUICK_SWINGS)} (${N} swings, ${fresh.length} bytes)`);
}
