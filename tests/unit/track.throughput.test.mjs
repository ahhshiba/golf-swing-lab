import test from 'node:test';
import assert from 'node:assert/strict';
import { renderClip, makeShotSpec } from '../synth/render.js';
import { medianBackground } from '../../app/src/track/bgsub.js';
import { detectCandidates } from '../../app/src/track/ball.js';
import { analyzeClip } from '../../app/src/track/pipeline.js';

// Wall-clock numbers depend on the machine and its load: the bounds below are deliberately loose (they catch an
// accidental O(n^2) or an allocation per pixel), the real numbers are printed for the report (target <= 4 ms/frame).
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];

test('throughput: ms per frame for a 384x216 ROI in Node (background subtraction + CCL; whole pipeline)', () => {
  const spec = makeShotSpec(42, { nPre: 30, nPost: 60 }); // the P5 clip shape: 30 frames before impact, 60 after
  const clip = renderClip(spec);
  const { W, H, frames } = clip;
  const t0 = performance.now();
  const bg = medianBackground(frames, W, H, 60);
  const tBg = performance.now() - t0;
  // warm up, then time detectCandidates frame by frame
  for (let f = 0; f < 10; f++) detectCandidates({ data: frames[f], W, H }, bg, null, { maxArea: 5000 });
  const per = [];
  let nCand = 0;
  for (let rep = 0; rep < 3; rep++) {
    const t = performance.now();
    for (let f = 0; f < frames.length; f++) nCand += detectCandidates({ data: frames[f], W, H }, bg, null, { maxArea: 5000 }).length;
    per.push((performance.now() - t) / frames.length);
  }
  const msDetect = median(per);
  // whole pipeline (rest ball LM fit, departure, background, detection, tracking, club) per frame, after one warm-up run
  const args = {
    frames, times: clip.times, W, H,
    restBall: { u: spec.restPos.u + 2, v: spec.restPos.v - 1.5, w_px: 2 * spec.restPos.r * 1.04 },
    impactFrameGuess: Math.floor(spec.meta.tImp) + 1,
  };
  analyzeClip(args);
  const totals = [];
  let last;
  for (let rep = 0; rep < 3; rep++) { last = analyzeClip(args); totals.push(last.timings_ms.total / frames.length); }
  const msPipe = median(totals);
  console.log(`# throughput 384x216: detect (diff + CCL + stats) ${msDetect.toFixed(2)} ms/frame; whole pipeline ${msPipe.toFixed(2)} ms/frame over ${frames.length} frames; median background (60 samples) ${tBg.toFixed(0)} ms once; stages ms: ${Object.entries(last.timings_ms).map(([k, v]) => `${k}=${v.toFixed(1)}`).join(' ')}`);
  assert.ok(nCand > 0);
  assert.ok(msDetect < 12, `detect ${msDetect} ms/frame`);
  assert.ok(msPipe < 20, `pipeline ${msPipe} ms/frame`);
  assert.ok(last.ballTrack.n >= 3);
});
