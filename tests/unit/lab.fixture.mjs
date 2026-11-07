// tests/unit/lab.fixture.mjs — expands tests/fixtures/v4/lab-sessions.json (recipes) into swings with poses (V04-SPEC
// §F.8; V4-F). Not a test file: imported by tests/unit/lab.synthetic.test.mjs and tests/e2e/gates/v4-f-*.mjs.
//
//   loadLabSessions() -> fixture
//   expandGroup(group, { limit?, template? }) -> [{ shot, poseSeq, truth, group }]   deterministic
//   exportEnvelope(fixture, { perGroup?, extra? }) -> golf-swing-lab-export/1 object with shots + poses (typed arrays
//     encoded like store/export.js), for the History import; extra = [{ shot, poseSeq }] added as they are
//   synthPoseFor(shot, { seed }) -> PoseSeq   a synthetic pose sequence for an existing fixture shot (same view / fps /
//     events timing is NOT matched: the shot's events are replaced by the swing's true events — see withSynthPose)
//   withSynthPose(shot, { seed }) -> { shot (events / metrics recomputed from the pose), poseSeq }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { synthSwing } from '../synth/swing.js';
import { computeMetrics } from '../../app/src/metrics/compute.js';
import { encodeTyped } from '../../app/src/store/export.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LAB_SESSIONS = path.join(ROOT, 'tests/fixtures/v4/lab-sessions.json');

export const loadLabSessions = () => JSON.parse(fs.readFileSync(LAB_SESSIONS, 'utf8'));
const template = (fx) => JSON.parse(fs.readFileSync(path.join(ROOT, fx.template_shot), 'utf8'));

const pad = (n) => String(n).padStart(2, '0');

function eventsOf(s) {
  const out = {};
  for (const [k, e] of Object.entries(s.truth.events)) if (e) out[k] = { frame: e.frame, t_s: Number(e.t_s.toFixed(6)), conf: 0.9, source: 'rules' };
  return out;
}

function shotFrom(tpl, s, { id, session_id, created_at, view, fps }) {
  const events = eventsOf(s);
  const metrics = computeMetrics({ view, fps, poseSeq: s.poseSeq, events, calibration: s.calibration, handedness: s.handedness });
  const shot = JSON.parse(JSON.stringify(tpl));
  Object.assign(shot, {
    shot_id: id, session_id, created_at, starred: false, note: '', revision: 0, history: undefined,
    capture: { ...shot.capture, view, nominal_fps: fps, effective_fps: fps, width: s.poseSeq.W, height: s.poseSeq.H,
      orientation: s.poseSeq.W > s.poseSeq.H ? 'landscape-primary' : 'portrait-primary' },
    calibration: { ...shot.calibration, ...s.calibration, preset_dev: null },
    handedness: s.handedness, events, metrics,
    quality: { ...shot.quality, frames_analyzed: s.poseSeq.t_s.length, warnings: [] },
  });
  delete shot.history;
  return shot;
}

export function expandGroup(group, { limit = Infinity, fixture = loadLabSessions() } = {}) {
  const tpl = template(fixture);
  const n = Math.min(group.seeds.n, limit);
  const out = [];
  for (let i = 0; i < n; i++) {
    const seed = group.seeds.from + i;
    const s = synthSwing({ seed, view: group.view, fps: group.fps, params: JSON.parse(JSON.stringify(group.params ?? {})) });
    const created_at = `${group.day}T09:${pad(Math.floor(i / 60))}:${pad(i % 60)}.000+08:00`;
    const shot = shotFrom(tpl, s, { id: `shot-lab-${group.id}-${seed}`, session_id: group.session_id, created_at, view: group.view, fps: group.fps });
    out.push({ shot, poseSeq: s.poseSeq, truth: s.truth, group });
  }
  return out;
}

/** A synthetic pose for an existing fixture shot: same view and fps; events and pose metrics recomputed from it. */
export function withSynthPose(shot, { seed = 7, params = {} } = {}) {
  const view = shot.capture.view;
  const fps = shot.capture.nominal_fps;
  const s = synthSwing({ seed, view, fps, params });
  const events = eventsOf(s);
  const fresh = computeMetrics({ view, fps, poseSeq: s.poseSeq, events, calibration: { ...shot.calibration, camera: s.calibration.camera }, handedness: shot.handedness ?? 'right' });
  const next = JSON.parse(JSON.stringify(shot));
  next.events = events;
  next.calibration = { ...next.calibration, ...s.calibration, preset_dev: next.calibration?.preset_dev ?? null };
  // keep the ball / club numbers of the fixture, take the pose rows from the synthetic swing
  for (const [id, m] of Object.entries(fresh)) if (!['club_speed_mps', 'club_path_deg', 'ball_speed_mps', 'launch_v_deg', 'launch_h_deg', 'carry_m', 'smash_factor'].includes(id) && id in next.metrics) next.metrics[id] = m;
  next.capture = { ...next.capture, width: s.poseSeq.W, height: s.poseSeq.H };
  return { shot: next, poseSeq: s.poseSeq };
}

const poseRecord = (shot, seq) => ({ shot_id: shot.shot_id, session_id: shot.session_id, created_at: shot.created_at,
  t_s: seq.t_s, img: seq.img, W: seq.W, H: seq.H, model: seq.model ?? 'synthetic' });

export function exportEnvelope(fixture = loadLabSessions(), { perGroup = 6, extra = [] } = {}) {
  const shots = [];
  const poses = [];
  for (const g of fixture.groups) {
    for (const { shot, poseSeq } of expandGroup(g, { limit: perGroup, fixture })) { shots.push(shot); poses.push(encodeTyped(poseRecord(shot, poseSeq))); }
  }
  for (const { shot, poseSeq } of extra) { shots.push(shot); if (poseSeq) poses.push(encodeTyped(poseRecord(shot, poseSeq))); }
  return { format: 'golf-swing-lab-export/1', exported_at: '2026-11-07T00:00:00.000Z', app_version: '0.4.0', venues: [], presets: [], sessions: [], shots, poses };
}

// ------------------------------------------------------------------ per-rule acceptance populations (fixture.rates)
import { mulberry32, uniform } from '../../app/src/geom/rng.js';
import { project } from '../../app/src/geom/camera.js';

/** Clean fault parameters of swing i (seeded), as synthSwing param overrides. */
export function cleanDraw(rates, i) {
  const rng = mulberry32((rates.seed_from + i) * 2654435761 >>> 0);
  const u = (k) => uniform(rng, rates.clean[k][0], rates.clean[k][1]);
  const v = Object.fromEntries(Object.keys(rates.clean).map((k) => [k, u(k)]));
  return v;
}
const toParams = (v) => ({
  stance: v.stance, pelvisImp: [v.pelvisImp_x, v.pelvisImp_y, 0], pelvisTop: [v.pelvisTop_x, 0, 0],
  headImp: [0, 0, v.headImp_z], fwdTiltLossImp_deg: v.fwdTiltLossImp_deg, spineSide_deg: v.spineSide_deg,
  sideTiltTop_deg: v.sideTiltTop_deg, tempo: v.tempo,
});
function applySet(v, set) {
  const out = { ...v };
  for (const [k, x] of Object.entries(set ?? {})) {
    if (typeof x === 'number') out[k] = x;
    else if (x === 'stance/2+0.10') out[k] = v.stance / 2 + 0.10;
    else if (x === '-(spineSide+12)') out[k] = -(v.spineSide_deg + 12);
    else throw new Error(`lab-sessions rates: unknown expression ${x}`);
  }
  return out;
}

/** Move the hand landmarks (13–22; elbows half) by offset (mat frame) × a sine bump over top → impact, in the image. */
export function handsOutside(s, offset) {
  const { poseSeq, model, camera } = s;
  const { tT, tI } = model.times;
  const W = poseSeq.W; const H = poseSeq.H;
  for (let i = 0; i < poseSeq.t_s.length; i++) {
    const t = poseSeq.t_s[i];
    if (t <= tT || t >= tI) continue;
    const w = Math.sin((Math.PI * (t - tT)) / (tI - tT));
    const h0 = model.hands(t);
    const p0 = project(camera, h0);
    const p1 = project(camera, [h0[0] + w * offset[0], h0[1] + w * offset[1], h0[2] + w * offset[2]]);
    if (!Number.isFinite(p0.u) || !Number.isFinite(p1.u)) continue;
    const du = (p1.u - p0.u) / W; const dv = (p1.v - p0.v) / H;
    for (let j = 13; j <= 22; j++) {
      const k = j <= 14 ? 0.5 : 1;
      const o = (i * 33 + j) * 4;
      poseSeq.img[o] += k * du; poseSeq.img[o + 1] += k * dv;
    }
  }
}

/** One swing of a rates population: { shot, poseSeq } (view / fps from the fixture; fault = null for clean). */
export function rateSwing(fixture, view, i, fault = null) {
  const R = fixture.rates;
  const tpl = template(fixture);
  let v = cleanDraw(R, i);
  const inj = fault ? R.inject[fault] : null;
  if (inj?.set) v = applySet(v, inj.set);
  const seed = R.seed_from + i;
  const s = synthSwing({ seed, view, fps: R.fps, params: toParams(v) });
  if (inj?.hands_offset_m) handsOutside(s, inj.hands_offset_m);
  const shot = shotFrom(tpl, s, { id: `shot-rate-${fault ?? 'clean'}-${view}-${seed}`, session_id: 'sess-rate', created_at: '2026-11-06T09:00:00.000+08:00', view, fps: R.fps });
  return { shot, poseSeq: s.poseSeq, params: v };
}

/** The true value of each rule's quantity for a synthetic swing (docs/metrics-by-view.md §2 definitions on the model). */
export function labTruth(s) {
  const m = s.model; const { tA, tT, tI } = m.times;
  const RAD = 180 / Math.PI;
  const L = (t, j) => { const a = m.landmarks(t); return [a[3 * j], a[3 * j + 1], a[3 * j + 2]]; };
  const mid = (t, a, b) => { const A = L(t, a); const B = L(t, b); return [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2]; };
  const tilt = (t, w) => { const sh = mid(t, 11, 12); const hp = mid(t, 23, 24); const v = [sh[0] - hp[0], sh[1] - hp[1], sh[2] - hp[2]]; return Math.atan2(w === 'f' ? -v[1] : -v[0], v[2]) * RAD; };
  const ev = s.truth.events;
  const ha = mid(tA, 15, 16); const n = Math.hypot(ha[1], ha[2]);
  const dev = (h) => (h[2] * ha[1] - h[1] * ha[2]) / n;
  const tm = s.truth.metrics;
  return {
    early_extension: tm.early_extension_m, head_dip: tm.head_lift_z_m, early_rise: tm.head_lift_z_m, weight_back: tm.weight_shift_pct, tempo_off: tm.tempo_ratio,
    loss_of_posture: tilt(tI, 'f') - tilt(tA, 'f'), reverse_spine: tilt(tT, 's'), sway: -(mid(tT, 23, 24)[0] - mid(tA, 23, 24)[0]),
    slide: mid(tI, 23, 24)[0] - L(tA, 27)[0],
    over_the_top: dev(mid(ev.mid_downswing.t_s, 15, 16)) - dev(mid(ev.mid_backswing.t_s, 15, 16)),
  };
}

/** Unconstrained generator swing (random defaults) as { s, shot, poseSeq }. */
export function defaultSwing(fixture, view, seed, fps = 30) {
  const s = synthSwing({ seed, view, fps });
  const shot = shotFrom(template(fixture), s, { id: `shot-def-${view}-${seed}`, session_id: 'sess-def', created_at: '2026-11-06T09:00:00.000+08:00', view, fps });
  return { s, shot, poseSeq: s.poseSeq };
}
