// P4 live state machine on synthetic 10 Hz sessions: 10 real swings (one with no impact sound) + 5 practice swings
// (slower, shorter, no sound) + 10 neighbour sounds, mixed with fidgeting, walking in and out of address.
// Acceptance: recall >= 0.9 for real swings, <= 1 false trigger per session.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveDetector, liveStep, initialLiveState, LIVE } from '../../app/src/events/live.js';
import { RC } from '../../app/src/contract/reason-codes.js';
import { synthLiveSession } from '../synth/swing.js';

function runSession(sess, opts) {
  const det = createLiveDetector(opts);
  const out = [];
  for (const smp of sess.samples) out.push(...det.feed(smp));
  return out;
}

function score(sess, events) {
  const swings = events.filter((e) => e.type === 'shot' && e.kind === 'swing');
  const used = new Set();
  let hit = 0;
  for (const r of sess.truth.real) {
    const i = swings.findIndex((s, k) => !used.has(k) && Math.abs(s.t_impact - r.t_impact) < 0.25);
    if (i >= 0) { used.add(i); hit++; }
  }
  return { recall: hit / sess.truth.real.length, falseTriggers: swings.length - hit, swings, used };
}

test('P4 thresholds are the CAFCR values', () => {
  assert.equal(LIVE.still_mps, 0.15);
  assert.equal(LIVE.address_hold_s, 0.5);
  assert.equal(LIVE.swing_mps, 1.0);
  assert.equal(LIVE.finish_hold_s, 0.7);
});

for (const seed of [1, 2, 3, 4, 5]) {
  test(`session ${seed}: recall >= 0.9, <= 1 false trigger, neighbours ignored`, () => {
    const sess = synthLiveSession({ seed });
    assert.equal(sess.truth.real.length, 10);
    assert.equal(sess.truth.practice.length, 5);
    assert.equal(sess.truth.neighbour.length, 10);
    const ev = runSession(sess);
    const sc = score(sess, ev);
    console.log(`session ${seed}: recall ${sc.recall}, false triggers ${sc.falseTriggers}, practice reported ${ev.filter((e) => e.type === 'shot' && e.kind === 'practice').length}`);
    assert.ok(sc.recall >= 0.9, `recall ${sc.recall}`);
    assert.ok(sc.falseTriggers <= 1, `false triggers ${sc.falseTriggers}`);
    // impact timing: audio-matched swings within 10 ms, profile-only within 0.2 s
    for (const s of sc.swings) {
      if (s.impact_source === 'audio') assert.deepEqual(s.reason_codes, []);
      else assert.ok(s.reason_codes.includes(RC.EVENTS_UNCERTAIN));
    }
    const ignored = ev.filter((e) => e.type === 'audio_ignored').map((e) => e.t_s);
    for (const t of sess.truth.neighbour) assert.ok(ignored.some((x) => Math.abs(x - t) < 1e-9), `neighbour at ${t} not ignored`);
  });
}

test('neighbour sound without motion is ignored; practice swing is reported as practice', () => {
  let s = initialLiveState();
  const evs = [];
  const feed = (x) => { const r = liveStep(s, x); s = r.state; evs.push(...r.events); };
  for (let i = 0; i < 20; i++) feed({ type: 'wrist', t_s: i * 0.1, x_m: 0.3, y_m: 0.8 });
  feed({ type: 'audio', t_s: 2.05 });
  assert.equal(evs.filter((e) => e.type === 'audio_ignored').length, 1);
  assert.equal(s.mode, 'ADDRESS');
  // a slow half swing (peak ~1.6 m/s, rise 0.5 m) with no sound
  let t = 2.0;
  const path = [];
  for (let i = 1; i <= 8; i++) path.push([0.3 - 0.04 * i, 0.8 + 0.0625 * i]);
  for (let i = 1; i <= 8; i++) path.push([-0.02 + 0.08 * i, 1.3 - 0.0625 * i]);
  for (const [x, y] of path) { t += 0.1; feed({ type: 'wrist', t_s: t, x_m: x, y_m: y }); }
  for (let i = 0; i < 12; i++) { t += 0.1; feed({ type: 'wrist', t_s: t, x_m: 0.62, y_m: 0.8 }); }
  const shots = evs.filter((e) => e.type === 'shot');
  assert.equal(shots.length, 1);
  assert.equal(shots[0].kind, 'practice');
});

test('no microphone: profile-matched swings carry AUDIO_UNAVAILABLE', () => {
  const sess = synthLiveSession({ seed: 7, nNeighbour: 0 });
  const noAudio = { ...sess, samples: sess.samples.filter((x) => x.type === 'wrist') };
  const ev = runSession(noAudio, { audioAvailable: false });
  const sc = score(sess, ev);
  assert.ok(sc.recall >= 0.9, `recall ${sc.recall}`);
  for (const s of sc.swings) assert.ok(s.reason_codes.includes(RC.AUDIO_UNAVAILABLE));
});

// ---- 0.4.0 'impact' event (V04-SPEC §A.3, §G.3 V4-B acceptance 3) ----
import { createHash } from 'node:crypto';

/** sha256 of the non-'impact' event stream: [shots, events, hash] per session, recorded with the 0.3.0 module (9f429da). */
const SNAPSHOT_030 = {
  1: [13, 114, '6f3c10ce426ff882a9297ecc1ccd8b6f7d41f492103b6e76d4f3db0a32e8e45a'],
  2: [12, 107, '171bddfa64b313756735ebdb664a391a1897980e38fc0c1a4d9fa8bfebd81495'],
  3: [12, 102, '15b317c79c5ef0f64f170e9249dfc3410584cffa65980bb4098223120cf243eb'],
  4: [11, 88, '33c05b9a34909ac705b0bf14a4666fd2abf4c17713e79f93b5f46a9bd79bed5d'],
  5: [12, 109, 'fa8f23f6ddeb89e8c2447c33eb3ba5766dc62ccdfd80a5d3e08d74a3e232859f'],
  7: [10, 87, 'a5131a659c09ead5a1c3c11af9a92a5a2a2750e35849e401cb6f065e6ee26406'],
};

test("0.3.0 event stream unchanged: everything but 'impact' is byte-identical to the 0.3.0 snapshot", () => {
  for (const [seedS, [nShots, nEv, hash]] of Object.entries(SNAPSHOT_030)) {
    const seed = Number(seedS);
    const noAudio = seed === 7;
    const sess = synthLiveSession({ seed, ...(noAudio ? { nNeighbour: 0 } : {}) });
    const det = createLiveDetector(noAudio ? { audioAvailable: false } : {});
    const ev = [];
    for (const s of sess.samples) { if (noAudio && s.type === 'audio') continue; ev.push(...det.feed(s).filter((e) => e.type !== 'impact')); }
    assert.equal(ev.filter((e) => e.type === 'shot').length, nShots, `seed ${seed} shots`);
    assert.equal(ev.length, nEv, `seed ${seed} events`);
    assert.equal(createHash('sha256').update(JSON.stringify(ev)).digest('hex'), hash, `seed ${seed} stream`);
  }
});

test("'impact' within <= 1 wrist sample after the audio onset; one per real swing; none for neighbours or practice", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const sess = synthLiveSession({ seed });
    const det = createLiveDetector();
    const imps = [];
    let sinceAudio = null; // wrist samples since the last onset
    for (const s of sess.samples) {
      if (s.type === 'audio') { sinceAudio = 0; det.feed(s); continue; }
      if (sinceAudio !== null) sinceAudio += 1;
      for (const e of det.feed(s)) if (e.type === 'impact') imps.push({ ...e, at: s.t_s, after: sinceAudio });
    }
    for (const r of sess.truth.real) {
      const m = imps.filter((e) => Math.abs(e.t_impact - r.t_impact) < 0.25);
      assert.equal(m.length, 1, `seed ${seed}: impact events near ${r.t_impact.toFixed(2)}: ${m.length}`);
      const e = m[0];
      for (const k of ['t_address', 't_swing', 't_top', 'peak_mps', 'conf']) assert.ok(Number.isFinite(e[k]), `${k}`);
      assert.ok(e.t_top < e.t_impact && e.t_swing < e.t_top);
      if (r.audio) {
        assert.equal(e.impact_source, 'audio');
        assert.deepEqual(e.reason_codes, []);
        assert.ok(e.after <= 1, `seed ${seed}: impact ${e.after} samples after the onset`);
        assert.ok(e.at >= e.t_impact && e.at - e.t_impact <= 0.1 + 1e-9);
      } else {
        assert.equal(e.impact_source, 'wrist_peak');
        assert.ok(e.reason_codes.includes(RC.EVENTS_UNCERTAIN));
      }
    }
    const stray = imps.filter((e) => !sess.truth.real.some((r) => Math.abs(e.t_impact - r.t_impact) < 0.25));
    assert.ok(stray.length <= 1, `seed ${seed}: impact events on no real swing: ${stray.map((e) => e.t_impact.toFixed(2))}`);
  }
});

test("'impact' without a microphone carries AUDIO_UNAVAILABLE", () => {
  const sess = synthLiveSession({ seed: 7, nNeighbour: 0 });
  const det = createLiveDetector({ audioAvailable: false });
  const imps = [];
  for (const s of sess.samples) if (s.type === 'wrist') imps.push(...det.feed(s).filter((e) => e.type === 'impact'));
  assert.ok(imps.length >= 9);
  for (const e of imps) { assert.equal(e.impact_source, 'wrist_peak'); assert.deepEqual(e.reason_codes, [RC.AUDIO_UNAVAILABLE]); }
});
