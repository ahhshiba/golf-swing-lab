import test from 'node:test';
import assert from 'node:assert/strict';
import { renderClip, makeShotSpec } from '../synth/render.js';
import { analyzeClip } from '../../app/src/track/pipeline.js';
import { trackClubHead } from '../../app/src/track/club.js';
import { medianBackground } from '../../app/src/track/bgsub.js';

function analyze(spec) {
  const clip = renderClip(spec);
  const t = spec.restPos;
  const res = analyzeClip({
    frames: clip.frames, times: clip.times, W: clip.W, H: clip.H,
    restBall: { u: t.u + 2, v: t.v - 1.5, w_px: 2 * t.r * 1.04 }, impactFrameGuess: Math.floor(spec.meta.tImp) + 1,
  });
  return { clip, res };
}

test('club head: observations before impact follow the rendered head (median error <= 3 px) and carry a confidence', () => {
  const N = 24;
  let empty = 0, nObs = 0;
  const errs = [];
  for (let i = 0; i < N; i++) {
    const spec = makeShotSpec(100 + i);
    const { clip, res } = analyze(spec);
    const club = res.clubTrack;
    if (club.length === 0) { empty++; continue; }
    assert.ok(club.length >= 3, 'fewer than 3 observations must be reported as []');
    const firstBall = res.ballTrack.obs.length ? res.ballTrack.obs[0].frame : Infinity;
    for (let k = 0; k < club.length; k++) {
      const o = club[k];
      for (const key of ['frame', 't_s', 'u', 'v', 'conf']) assert.ok(Number.isFinite(o[key]), key);
      assert.ok(o.conf > 0 && o.conf <= 1);
      assert.equal(o.t_s, clip.times[o.frame]);
      assert.ok(o.frame < firstBall, `club observation at frame ${o.frame} is not before the first ball observation ${firstBall}`);
      if (k > 0) assert.ok(o.frame > club[k - 1].frame);
      const tc = clip.truth.club[o.frame];
      assert.ok(tc, `frame ${o.frame}: club not in the picture`);
      errs.push(Math.hypot(o.u - tc.u, o.v - tc.v));
      nObs++;
    }
  }
  errs.sort((a, b) => a - b);
  const med = errs[errs.length >> 1], p90 = errs[Math.floor(errs.length * 0.9)];
  console.log(`# club head: ${N - empty}/${N} clips with a club track, ${nObs} obs, error median ${med.toFixed(2)} px, p90 ${p90.toFixed(2)}, max ${errs[errs.length - 1].toFixed(1)}`);
  assert.ok(empty <= 0.2 * N, `${empty} empty club tracks`);
  assert.ok(med <= 3, `median error ${med}`);
  assert.ok(p90 <= 8, `p90 error ${p90}`);
});

test('club head: no club in the clip -> [] (also with a distractor ball crossing)', () => {
  let nonEmpty = 0;
  for (let i = 0; i < 10; i++) {
    const spec = makeShotSpec(300 + i, { club: false });
    const { res } = analyze(spec);
    if (res.clubTrack.length) nonEmpty++;
  }
  assert.equal(nonEmpty, 0);
});

test('club head: unsure inputs give [] (no rest ball, no lastRest, no background)', () => {
  const spec = makeShotSpec(120);
  const clip = renderClip(spec);
  const bg = medianBackground(clip.frames, clip.W, clip.H);
  const base = { frames: clip.frames, times: clip.times, W: clip.W, H: clip.H, bg, roi: null };
  const rest = { u: spec.restPos.u, v: spec.restPos.v, r_px: spec.restPos.r };
  assert.deepEqual(trackClubHead({ ...base, restBall: null, lastRest: 14 }), []);
  assert.deepEqual(trackClubHead({ ...base, restBall: rest, lastRest: null }), []);
  assert.deepEqual(trackClubHead({ ...base, restBall: rest, lastRest: 14, bg: null }), []);
  assert.deepEqual(trackClubHead({ ...base, restBall: rest, lastRest: 0 }), []);
  // far from the swing: a club "track" for a ball spot that the club never visits is rejected
  const elsewhere = { u: 330, v: 40, r_px: spec.restPos.r };
  assert.deepEqual(trackClubHead({ ...base, restBall: elsewhere, lastRest: Math.floor(spec.meta.tImp) }), []);
});

test('club head: direct call with a median background reproduces the pipeline result on a clean clip', () => {
  const spec = makeShotSpec(121, { distractor: false, shadow: false, noise: 2 });
  const { clip, res } = analyze(spec);
  assert.ok(res.clubTrack.length >= 3);
  const rest = res.restBall;
  const lastRest = res.info.lastRest;
  const bg = medianBackground(clip.frames, clip.W, clip.H, 60, {
    region: { x: rest.u - 1.9 * rest.r_px, y: rest.v - 1.9 * rest.r_px, w: 3.8 * rest.r_px, h: 5.2 * rest.r_px },
    regionFrames: Array.from({ length: clip.frames.length - lastRest - 2 }, (_, i) => lastRest + 2 + i),
  });
  const direct = trackClubHead({ frames: clip.frames, times: clip.times, W: clip.W, H: clip.H, bg, roi: null, restBall: rest, lastRest });
  assert.ok(direct.length >= 3);
  for (const o of direct) {
    const tc = clip.truth.club[o.frame];
    assert.ok(Math.hypot(o.u - tc.u, o.v - tc.v) < 6, `frame ${o.frame}`);
  }
});
