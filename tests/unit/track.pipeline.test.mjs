import test from 'node:test';
import assert from 'node:assert/strict';
import { renderClip, makeShotSpec } from '../synth/render.js';
import { analyzeClip } from '../../app/src/track/pipeline.js';
import { trackBall, detectCandidates, findDeparture } from '../../app/src/track/ball.js';
import { RunningBackground } from '../../app/src/track/bgsub.js';
import { RC } from '../../app/src/contract/reason-codes.js';

// analyzeClip on rendered clips, stress cases, live mode (running background) and the departure finder

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

test('blur stress: ball radius 7, exposure 95 % of the frame (aspect up to 4), noise 6 DN, strong texture, 5 % flicker', () => {
  const N = 10;
  let ok5 = 0, dist = 0, bad = 0;
  const all = [], rRel = [];
  let maxAspect = 0;
  for (let i = 0; i < N; i++) {
    const spec = makeShotSpec(900 + i, { r: 7, expo: 0.95, noise: 6, amp: 2, flicker: { gain: 0.05, offset: 4 } });
    maxAspect = Math.max(maxAspect, spec.meta.aspect);
    const { clip, res } = analyze(spec);
    const s = score(clip, res);
    if (res.ballTrack.n >= 5) ok5++;
    dist += s.distractor > 0 ? 1 : 0; bad += s.wrong;
    all.push(...s.errs);
    for (const o of res.ballTrack.obs) { const tb = clip.truth.ball[o.frame]; if (tb && tb.inside) rRel.push(o.r_px / tb.r - 1); }
  }
  all.sort((a, b) => a - b);
  rRel.sort((a, b) => a - b);
  const medAbsR = [...rRel].map(Math.abs).sort((a, b) => a - b)[rRel.length >> 1];
  console.log(`# blur stress: ${ok5}/${N} >=5 obs, max aspect ${maxAspect.toFixed(2)}, median centroid error ${all[all.length >> 1].toFixed(3)} px, p90 ${all[Math.floor(all.length * 0.9)].toFixed(3)}, r_px error median |.| ${(medAbsR * 100).toFixed(1)} % (p5 ${(rRel[Math.floor(rRel.length * 0.05)] * 100).toFixed(1)} %, p95 ${(rRel[Math.floor(rRel.length * 0.95)] * 100).toFixed(1)} %)`);
  assert.ok(maxAspect > 3.3, `generator reached aspect ${maxAspect}`);
  assert.ok(ok5 / N >= 0.8);
  assert.equal(dist, 0);
  assert.equal(bad, 0);
  assert.ok(all[all.length >> 1] <= 0.5);
  assert.ok(medAbsR <= 0.25, 'r_px within the +-25 % budget of CAFCR C1.1 for motion-blurred frames');
  assert.ok(rRel[Math.floor(rRel.length * 0.05)] > -0.25 && rRel[Math.floor(rRel.length * 0.95)] < 0.25);
});

test('analyzeClip: tee shots, no distractor, no club; ball stays correct; clubTrack is empty when there is no club', () => {
  let ok = 0, falseClub = 0;
  for (let i = 0; i < 8; i++) {
    const spec = makeShotSpec(1300 + i, { tee: true, distractor: false, club: false });
    const { clip, res } = analyze(spec);
    const s = score(clip, res);
    if (res.ballTrack.n >= 5 && s.wrong === 0) ok++;
    if (res.clubTrack.length) falseClub++;
    assert.equal(res.restBall.lie, 'tee');
    assert.ok(Math.abs(res.restBall.w_px - 2 * spec.restPos.r) / (2 * spec.restPos.r) < 0.03);
  }
  assert.ok(ok >= 7, `${ok}/8`);
  assert.equal(falseClub, 0);
});

test('analyzeClip: works without impactFrameGuess, with an ROI and with a cropped frame + origin offset', () => {
  const spec = makeShotSpec(1400);
  const clip = renderClip(spec);
  const t = spec.restPos;
  const base = { frames: clip.frames, times: clip.times, W: clip.W, H: clip.H, restBall: { u: t.u + 1.5, v: t.v - 1, w_px: 2 * t.r * 1.03 } };
  const a = analyzeClip(base);
  assert.ok(a.ballTrack.n >= 5, `no guess: n=${a.ballTrack.n}`);
  const b = analyzeClip({ ...base, roi: { x: 20, y: 10, w: 330, h: 190 } });
  assert.ok(b.ballTrack.n >= 4);
  // crop a 200 x 160 patch around the ball and give the crop's origin
  const x0 = 60, y0 = 40, cw = 200, ch = 160;
  const crop = clip.frames.map((f) => { const o = new Uint8Array(cw * ch); for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) o[y * cw + x] = f[(y0 + y) * clip.W + x0 + x]; return o; });
  const c = analyzeClip({ frames: crop, times: clip.times, W: cw, H: ch, restBall: { u: t.u - x0 + 1.5, v: t.v - y0 - 1, w_px: 2 * t.r * 1.03 }, opts: { origin: { u: x0, v: y0 } } });
  assert.ok(c.ballTrack.n >= 3);
  assert.ok(Math.abs(c.restBall.u - t.u) < 0.3 && Math.abs(c.restBall.v - t.v) < 0.3, 'origin added to the rest ball');
  for (const o of c.ballTrack.obs) {
    const tb = clip.truth.ball[o.frame];
    if (tb && tb.inside) assert.ok(Math.hypot(o.u - tb.u, o.v - tb.v) < 1.0, `frame ${o.frame}`);
  }
});

test('analyzeClip: a ball that never moves gives an empty track and TRACK_TOO_SHORT; missing rest ball likewise', () => {
  const spec = makeShotSpec(1500, { distractor: false, club: false });
  spec.ball.frames = spec.ball.frames.map(() => ({ u0: spec.restPos.u, v0: spec.restPos.v, u1: spec.restPos.u, v1: spec.restPos.v, r: spec.restPos.r }));
  const { res } = analyze(spec);
  assert.equal(res.ballTrack.n, 0);
  assert.deepEqual(res.reason_codes, [RC.TRACK_TOO_SHORT]);
  assert.deepEqual(res.clubTrack, []);
  const clip = renderClip(makeShotSpec(1501));
  const noRest = analyzeClip({ frames: clip.frames, times: clip.times, W: clip.W, H: clip.H });
  assert.equal(noRest.restBall, null);
  assert.deepEqual(noRest.reason_codes, [RC.TRACK_TOO_SHORT]);
});

test('analyzeClip: timings are reported and the stages add up', () => {
  const spec = makeShotSpec(1600);
  const { res } = analyze(spec);
  const t = res.timings_ms;
  for (const k of ['rest', 'departure', 'background', 'detect', 'track', 'club', 'total', 'detect_per_frame']) assert.ok(Number.isFinite(t[k]) && t[k] >= 0, k);
  assert.ok(t.total >= t.rest + t.background + t.detect - 1e-6);
  const fake = analyzeClip({ ...{ frames: renderClip(spec).frames, times: Array.from({ length: spec.nFrames }, (_, i) => i / 240), W: 384, H: 216, restBall: { u: spec.restPos.u, v: spec.restPos.v, w_px: 2 * spec.restPos.r } }, opts: { now: (() => { let k = 0; return () => (k += 10); })() } });
  assert.ok(fake.timings_ms.total > 0 && fake.timings_ms.total % 10 === 0, 'the clock is injectable');
});

// ------------------------------------------------------------------------------------------------ live mode

test('live mode: running-average background + detectCandidates + trackBall (seeded with findDeparture) finds the ball', () => {
  let ok = 0;
  const errs = [];
  const N = 8;
  for (let i = 0; i < N; i++) {
    const spec = makeShotSpec(700 + i, { club: false });
    const clip = renderClip(spec);
    const { W, H } = clip;
    const rb = new RunningBackground(W, H, { alpha: 0.05, alphaFg: 0.002, fgThresh: 25, warmup: 6 });
    const dets = [];
    for (let f = 0; f < clip.frames.length; f++) {
      dets.push(f >= 6 ? detectCandidates({ data: clip.frames[f], W, H }, rb.bg, null, { maxArea: 5000 }) : []);
      rb.update(clip.frames[f]);
    }
    const rest = clip.truth.rest;
    const dep = findDeparture(clip.frames, W, H, { u: rest.u, v: rest.v, r_px: rest.r });
    assert.ok(dep.ok);
    const tr = trackBall(dets, clip.times, { start: { u: rest.u, v: rest.v, r_px: rest.r }, firstFrame: dep.departure });
    if (tr.n >= 5) ok++;
    for (const o of tr.obs) { const tb = clip.truth.ball[o.frame]; if (tb && tb.inside) errs.push(Math.hypot(o.u - tb.u, o.v - tb.v)); }
  }
  errs.sort((a, b) => a - b);
  console.log(`# live mode: ${ok}/${N} tracks with >=5 obs, median error ${errs[errs.length >> 1].toFixed(3)} px`);
  assert.ok(ok / N >= 0.8);
  assert.ok(errs[errs.length >> 1] <= 0.5);
});

test('findDeparture: finds the last frame at which the ball is still on its spot (even when a club sweeps over the spot afterwards)', () => {
  let exact = 0;
  const N = 8;
  for (let i = 0; i < N; i++) {
    const spec = makeShotSpec(1700 + i);
    const clip = renderClip(spec);
    const t = clip.truth.rest;
    const dep = findDeparture(clip.frames, clip.W, clip.H, { u: t.u, v: t.v, r_px: t.r });
    assert.ok(dep.ok);
    // first frame whose ball centroid is more than one radius away from the spot
    let first = -1;
    for (let f = 0; f < clip.truth.ball.length; f++) { const b = clip.truth.ball[f]; if (b && Math.hypot(b.u - t.u, b.v - t.v) > 1.0 * t.r) { first = f; break; } }
    assert.ok(dep.departure >= first - 1 && dep.departure <= first + 3, `seed ${1700 + i}: departure ${dep.departure}, ball left in frame ${first}`);
    if (dep.departure === first) exact++;
  }
  console.log(`# findDeparture: exact in ${exact}/${N} clips, always within -1..+3 frames`);
  assert.ok(exact >= 4);
});
