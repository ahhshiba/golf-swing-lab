// Clip analysis: rest ball -> background -> per-frame candidates -> ball track + club-head track (pure, worker-safe).
//
// analyzeClip({ frames, times, W, H, roi, restBall, impactFrameGuess, opts })
//   frames  Uint8Array[]  grayscale, W*H each (a ROI crop is fine: pass its own W, H and the offset in opts.origin)
//   times   number[]      seconds per frame (container CTS; interfaces.md section 2)
//   roi     {x,y,w,h}     analysis region inside the frame (default: the whole frame)
//   restBall {u,v,w_px,r_px?}  the ball spot from calibration / a tap; refined here from the averaged address frames
//   impactFrameGuess      optional frame index near impact (+-few frames); only a fallback and a hint for the background region
//   opts    { maxSamples = 60, address = 8, origin = {u:0,v:0}, expectedDir, maxGap, now (clock), tracker options... }
// -> { restBall, ballTrack, clubTrack, reason_codes, timings_ms, info }
//   restBall   detectRestBall result (+ refined: boolean) or the input when detection failed; null if none given
//   ballTrack  {obs, gaps, n, info}  obs = {frame, t_s, u, v, w_px, h_px, r_px, area, peak, elong, resid_px}
//   clubTrack  [{frame, t_s, u, v, conf}]  club head before impact; [] when unsure
//   reason_codes  [RC.TRACK_TOO_SHORT] when fewer than 5 ball observations (the caller turns this into null metrics)
//   timings_ms {rest, departure, background, detect, track, club, total, detect_per_frame}
// All output coordinates are in frame pixels plus opts.origin.

import { RC } from '../contract/reason-codes.js';
import { normRoi } from './ccl.js';
import { medianBackground } from './bgsub.js';
import { detectCandidates, detectRestBall, findDeparture, trackBall } from './ball.js';
import { trackClubHead } from './club.js';

const defaultNow = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : 0);

export function analyzeClip(args) {
  const { frames, times, W, H } = args;
  const opts = args.opts ?? {};
  const now = opts.now ?? defaultNow;
  const T0 = now();
  const timings = { rest: 0, departure: 0, background: 0, detect: 0, track: 0, club: 0, total: 0, detect_per_frame: 0 };
  const n = frames.length;
  const roi = normRoi(args.roi ?? null, W, H);
  const roiXYWH = { x: roi.x0, y: roi.y0, w: roi.x1 - roi.x0, h: roi.y1 - roi.y0 };
  const origin = opts.origin ?? { u: 0, v: 0 };
  const result = { restBall: null, ballTrack: { obs: [], gaps: 0, n: 0, info: null }, clubTrack: [], reason_codes: [], timings_ms: timings, info: {} };
  if (n < 3 || !args.restBall) {
    result.reason_codes.push(RC.TRACK_TOO_SHORT);
    timings.total = now() - T0;
    return finish(result, origin);
  }
  const given = args.restBall;
  const wGiven = given.w_px > 0 ? given.w_px : 2 * (given.r_px ?? 8);
  const guess = args.impactFrameGuess;

  // 1. rest ball from the average of the first address frames
  let t = now();
  const nAddr = Math.max(1, Math.min(opts.address ?? 8, guess != null ? Math.max(1, guess - 12) : n >> 1, n));
  const avg = new Float32Array(W * H); // only the ROI is filled (frames may be full 1080p images)
  for (let f = 0; f < nAddr; f++) {
    const fr = frames[f];
    for (let y = roi.y0; y < roi.y1; y++) for (let p = y * W + roi.x0, e = y * W + roi.x1; p < e; p++) avg[p] += fr[p];
  }
  for (let y = roi.y0; y < roi.y1; y++) for (let p = y * W + roi.x0, e = y * W + roi.x1; p < e; p++) avg[p] /= nAddr;
  let rest = detectRestBall({ data: avg, W, H }, roiXYWH, { u: given.u, v: given.v, w_px: wGiven }, { polarity: opts.polarity ?? 'bright' });
  let refined = true;
  if (!rest) {
    refined = false;
    rest = { u: given.u, v: given.v, w_px: wGiven, h_px: wGiven, r_px: given.r_px ?? wGiven / 2, lie: given.lie ?? 'mat', conf: 0, lie_conf: 0, tee: null };
  }
  rest.refined = refined;
  const r = rest.r_px;
  timings.rest = now() - t;

  // 2. when does the ball leave its spot?
  t = now();
  const dep = findDeparture(frames, W, H, rest, opts.departure ?? {});
  timings.departure = now() - t;
  let regionFrames = null;
  if (dep.ok) {
    regionFrames = [];
    for (let f = dep.departure + 1; f < n; f++) regionFrames.push(f);
  } else if (guess != null) {
    regionFrames = [];
    for (let f = guess + 2; f < n; f++) regionFrames.push(f);
  }
  if (!regionFrames) {
    // neither the pixel test nor a guess: assume the ball is gone in the last 30 % of the clip
    regionFrames = [];
    for (let f = Math.floor(0.7 * n); f < n; f++) regionFrames.push(f);
  }
  if (regionFrames.length < 3) regionFrames = null;

  // 3. background (the resting ball and its tee/shadow zone use only frames after the ball is gone)
  t = now();
  const region = { x: rest.u - 1.9 * r, y: rest.v - 1.9 * r, w: 3.8 * r, h: 5.2 * r + (rest.lie === 'tee' ? 4 * r : 0) };
  const bg = medianBackground(frames, W, H, opts.maxSamples ?? 60, { roi: roiXYWH, region, regionFrames });
  timings.background = now() - t;

  // 4. per-frame candidates
  t = now();
  const maxArea = opts.maxArea ?? Math.max(400, 14 * Math.PI * r * r);
  const dets = new Array(n);
  for (let f = 0; f < n; f++) dets[f] = detectCandidates({ data: frames[f], W, H }, bg, roiXYWH, { maxArea, minArea: opts.minArea ?? 5 });
  timings.detect = now() - t;
  timings.detect_per_frame = timings.detect / n;

  // 5. ball track
  t = now();
  const firstFrame = dep.ok ? dep.departure : undefined;
  const track = trackBall(dets, times, {
    start: { u: rest.u, v: rest.v, r_px: r },
    firstFrame,
    expectedDir: opts.expectedDir ?? null,
    dirTolDeg: opts.dirTolDeg,
    maxGap: opts.maxGap,
    gate: opts.gate,
    firstGate: opts.firstGate,
    firstDelay: opts.firstDelay,
    minLen: opts.minLen ?? 3,
  });
  timings.track = now() - t;

  // 6. club head before impact
  t = now();
  // last frame in which the ball is surely still on its spot: the earliest of the pixel test, the detector's rest-phase
  // end and the frame before the first ball observation (a club that sweeps over the spot fools any single one)
  const cands = [];
  if (dep.ok) cands.push(dep.lastRest);
  if (track.info && track.info.restEnd >= 0) cands.push(track.info.restEnd);
  if (track.obs.length) cands.push(track.obs[0].frame - 1);
  if (!cands.length && guess != null) cands.push(guess - 1);
  const lastRest = cands.length ? Math.min(...cands) : null;
  const club = lastRest != null && opts.club !== false
    ? trackClubHead({ frames, times, W, H, bg, roi: roiXYWH, restBall: rest, lastRest, lookback: opts.clubLookback ?? 8 })
    : [];
  timings.club = now() - t;

  result.restBall = rest;
  result.ballTrack = track;
  result.clubTrack = club;
  if (track.n < 5) result.reason_codes.push(RC.TRACK_TOO_SHORT);
  result.info = { departure: dep.ok ? dep.departure : null, lastRest, regionFramesUsed: regionFrames ? regionFrames.length : 0, noiseSigma: null };
  timings.total = now() - T0;
  return finish(result, origin);
}

function finish(res, origin) {
  if (!origin || (!origin.u && !origin.v)) return res;
  const du = origin.u, dv = origin.v;
  if (res.restBall) { res.restBall.u += du; res.restBall.v += dv; }
  for (const o of res.ballTrack.obs) { o.u += du; o.v += dv; }
  for (const o of res.clubTrack) { o.u += du; o.v += dv; }
  return res;
}
