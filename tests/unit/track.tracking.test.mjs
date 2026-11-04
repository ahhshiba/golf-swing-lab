import test from 'node:test';
import assert from 'node:assert/strict';
import { renderClip, makeShotSpec } from '../synth/render.js';
import { analyzeClip } from '../../app/src/track/pipeline.js';
import { trackBall } from '../../app/src/track/ball.js';
import { RC } from '../../app/src/contract/reason-codes.js';

const DT = 1 / 240;
const times = (n) => Array.from({ length: n }, (_, i) => i * DT);
const cand = (u, v, r = 8, extra = {}) => ({ u, v, r_px: r, w_px: 2 * r, h_px: 2 * r, area: Math.PI * r * r, peak: 100, elong: 1, ...extra });

// ------------------------------------------------------------------------------------------------ trackBall (no images)

test('trackBall: seeded at the rest ball; the static rest detections are not a track; a far distractor is ignored', () => {
  const n = 20;
  const dets = Array.from({ length: n }, () => []);
  for (let f = 0; f < 6; f++) dets[f].push(cand(100, 100)); // the ball at rest
  for (let f = 6; f < n; f++) dets[f].push(cand(100 + 28 * (f - 5), 100 - 12 * (f - 5))); // flight
  for (let f = 3; f < n; f++) dets[f].push(cand(10 + 22 * (f - 3), 30 + 1.5 * (f - 3))); // distractor crossing the top
  const tr = trackBall(dets, times(n), { start: { u: 100, v: 100, r_px: 8 } });
  assert.deepEqual(tr.obs.map((o) => o.frame), [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].slice(0, tr.n));
  assert.ok(tr.n >= 12, `n ${tr.n}`);
  assert.equal(tr.gaps, 0);
  for (const o of tr.obs) {
    assert.ok(Math.abs(o.u - (100 + 28 * (o.frame - 5))) < 1e-9 && Math.abs(o.v - (100 - 12 * (o.frame - 5))) < 1e-9);
    assert.equal(o.t_s, o.frame * DT);
  }
  assert.equal(tr.info.restEnd, 5);
});

test('trackBall: tolerates missing frames (maxGap) and reports gaps; stops at a long hole', () => {
  const n = 16;
  const dets = Array.from({ length: n }, () => []);
  dets[0].push(cand(50, 80));
  for (let f = 1; f < n; f++) if (f !== 5 && f !== 6) dets[f].push(cand(50 + 20 * f, 80 - 10 * f));
  const tr = trackBall(dets, times(n), { start: { u: 50, v: 80, r_px: 8 }, firstFrame: 1, maxGap: 3 });
  assert.equal(tr.n, 13);
  assert.equal(tr.gaps, 2);
  assert.ok(!tr.obs.some((o) => o.frame === 5 || o.frame === 6));
  const dets2 = dets.map((d) => d.slice());
  for (let f = 9; f < 14; f++) dets2[f] = [];
  const tr2 = trackBall(dets2, times(n), { start: { u: 50, v: 80, r_px: 8 }, firstFrame: 1, maxGap: 2 });
  assert.ok(tr2.obs[tr2.obs.length - 1].frame <= 8, 'a hole longer than maxGap ends the track');
});

test('trackBall: direction prior and the rest-position anchor reject look-alike tracks', () => {
  const n = 14;
  const dets = Array.from({ length: n }, () => []);
  dets[0].push(cand(200, 120));
  // true ball goes up-right; a look-alike goes left with the SAME speed and one more frame
  for (let f = 1; f < n; f++) { dets[f].push(cand(200 + 25 * f, 120 - 8 * f)); dets[f].push(cand(200 - 25 * f, 120 - 8 * f + 3)); }
  const prior = trackBall(dets, times(n), { start: { u: 200, v: 120, r_px: 8 }, expectedDir: [1, -0.3], firstFrame: 1 });
  assert.ok(prior.obs.every((o) => o.u > 200));
  const noPrior = trackBall(dets, times(n), { start: { u: 200, v: 120, r_px: 8 }, firstFrame: 1 });
  assert.ok(noPrior.n >= 10);
  // a parallel flight 60 px away from the rest ball is not the ball: the back-projection misses the rest spot
  const dets2 = Array.from({ length: n }, () => []);
  dets2[0].push(cand(100, 100));
  for (let f = 1; f < n; f++) dets2[f].push(cand(160 + 25 * f, 40 - 3 * f)); // starts nowhere near the rest spot
  const none = trackBall(dets2, times(n), { start: { u: 100, v: 100, r_px: 8 }, firstFrame: 1 });
  assert.equal(none.n, 0);
  // ... but without a start position the longest chain is returned (tracking.py behaviour)
  const any = trackBall(dets2, times(n), {});
  assert.ok(any.n >= 10);
});

test('trackBall: size gate ignores big blobs; two valid chains -> the faster one (the ball outruns the club head)', () => {
  const n = 16;
  const dets = Array.from({ length: n }, () => []);
  dets[0].push(cand(100, 100));
  for (let f = 1; f < n; f++) {
    dets[f].push(cand(100 + 40 * f, 100 - 14 * f));                 // ball: 42 px / frame
    dets[f].push(cand(100 + 27 * f, 100 + 2 * f, 7, { area: 300 })); // club head following, slower, similar size
    dets[f].push(cand(50 + 10 * f, 150, 40, { area: 5000 }));       // body-sized blob: r_px too large
  }
  const tr = trackBall(dets, times(n), { start: { u: 100, v: 100, r_px: 8 }, firstFrame: 1 });
  assert.ok(tr.n >= 6);
  for (const o of tr.obs) assert.ok(Math.abs(o.u - (100 + 40 * o.frame)) < 1e-9, 'follows the fast chain');
});

test('trackBall: the first observation is dropped when it is a merged blob that does not fit the motion', () => {
  const n = 14;
  const dets = Array.from({ length: n }, () => []);
  dets[0].push(cand(100, 100));
  dets[1].push(cand(112, 103, 9, { area: 520 }));   // ball + club head merged: centroid 25 px off the flight line
  for (let f = 2; f < n; f++) dets[f].push(cand(100 + 30 * f, 100 - 10 * f));
  const tr = trackBall(dets, times(n), { start: { u: 100, v: 100, r_px: 8 }, firstFrame: 1 });
  assert.ok(tr.n >= 10);
  assert.ok(!tr.obs.some((o) => o.frame === 1), 'merged first blob trimmed');
});

test('trackBall: empty / degenerate input returns an empty Track', () => {
  const empty = trackBall([[], [], []], times(3), { start: { u: 1, v: 1, r_px: 5 } });
  assert.deepEqual({ obs: empty.obs, gaps: empty.gaps, n: empty.n }, { obs: [], gaps: 0, n: 0 });
  const none = trackBall([], [], {});
  assert.equal(none.n, 0);
});

// ------------------------------------------------------------------------------------------------ analyzeClip on renders

function analyze(spec, extra = {}) {
  const clip = renderClip(spec);
  const t = spec.restPos;
  const res = analyzeClip({
    frames: clip.frames, times: clip.times, W: clip.W, H: clip.H,
    restBall: { u: t.u + 2, v: t.v - 1.5, w_px: 2 * t.r * 1.04 },
    impactFrameGuess: Math.floor(spec.meta.tImp) + 1,
    ...extra,
  });
  return { clip, res };
}

function score(clip, res) {
  const errs = [];
  let wrong = 0, distractor = 0;
  for (const o of res.ballTrack.obs) {
    const tb = clip.truth.ball[o.frame], td = clip.truth.distractor[o.frame];
    const e = tb ? Math.hypot(o.u - tb.u, o.v - tb.v) : Infinity;
    if (tb && tb.inside) errs.push(e);
    if (e > 5) wrong++;
    if (td && Math.hypot(o.u - td.u, o.v - td.v) < 5 && !(e < 5)) distractor++;
  }
  return { errs, wrong, distractor };
}

test('30 seeded shots (ROI 384x216, r 7-11 px, 5.5-15 flight frames, blur aspect <= 4, noise 4 DN, distractor + club head): >= 90 % tracks with >= 5 obs, median centroid error <= 0.5 px, no distractor tracks', () => {
  const N = 30;
  let ok5 = 0, distractorTracks = 0, wrongObs = 0, nObs = 0;
  const all = [];
  const trackMedians = [];
  let msTotal = 0, msDetect = 0;
  const shortOnes = [];
  for (let i = 0; i < N; i++) {
    const spec = makeShotSpec(100 + i);
    const { clip, res } = analyze(spec);
    const s = score(clip, res);
    // Track contract (interfaces.md section 4)
    const tr = res.ballTrack;
    assert.equal(tr.n, tr.obs.length);
    for (let k = 0; k < tr.obs.length; k++) {
      const o = tr.obs[k];
      for (const key of ['frame', 't_s', 'u', 'v', 'w_px', 'h_px', 'r_px', 'area', 'peak']) assert.ok(Number.isFinite(o[key]), `${key} of seed ${100 + i} obs ${k}`);
      if (k > 0) assert.ok(o.t_s > tr.obs[k - 1].t_s);
      assert.equal(o.t_s, clip.times[o.frame]);
    }
    // resid_px (leave-one-out residual) is a usable quality flag: the few observations that are > 1 px off carry it
    for (const o of tr.obs) {
      const tb = clip.truth.ball[o.frame];
      assert.ok(tr.n < 4 ? o.resid_px === null : Number.isFinite(o.resid_px), `resid_px of seed ${100 + i}`);
      if (tb && tb.inside && Math.hypot(o.u - tb.u, o.v - tb.v) > 1) assert.ok(o.resid_px > 0.5, `seed ${100 + i} frame ${o.frame}: error > 1 px but resid_px ${o.resid_px}`);
    }
    if (tr.n >= 5) ok5++; else shortOnes.push(`${100 + i}(n=${tr.n},nVis=${spec.meta.nVis.toFixed(1)})`);
    if (tr.n < 5) assert.deepEqual(res.reason_codes, [RC.TRACK_TOO_SHORT]); else assert.deepEqual(res.reason_codes, []);
    if (s.distractor > 0) distractorTracks++;
    wrongObs += s.wrong; nObs += tr.n;
    all.push(...s.errs);
    if (s.errs.length) trackMedians.push([...s.errs].sort((a, b) => a - b)[s.errs.length >> 1]);
    msTotal += res.timings_ms.total; msDetect += res.timings_ms.detect_per_frame;
  }
  all.sort((a, b) => a - b);
  const med = all[all.length >> 1], p90 = all[Math.floor(all.length * 0.9)];
  console.log(`# 30 shots: ${ok5}/${N} tracks with >=5 obs (short: ${shortOnes.join(' ') || 'none'}); distractor tracks ${distractorTracks}; centroid error median ${med.toFixed(3)} px p90 ${p90.toFixed(3)} max ${all[all.length - 1].toFixed(2)} (${all.length} obs); obs > 5 px off: ${wrongObs}/${nObs}; mean pipeline ${(msTotal / N).toFixed(0)} ms/clip, detect ${(msDetect / N).toFixed(2)} ms/frame`);
  assert.ok(ok5 / N >= 0.9, `${ok5}/${N} tracks with >= 5 obs`);
  assert.ok(med <= 0.5, `median centroid error ${med}`);
  assert.equal(distractorTracks, 0);
  assert.ok(wrongObs <= 0.02 * nObs, `${wrongObs} wrong observations`);
});

