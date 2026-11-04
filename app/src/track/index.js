// track — classical ball / club-head tracking (pure; CPU only; runs in a worker). Public API:
//
// bgsub.js
//   medianBackground(frames: Uint8Array[], W, H, maxSamples = 60, { roi?, region?, regionFrames? }) -> Float32Array(W*H)
//   RunningBackground(W, H, { alpha, alphaFg, fgThresh, warmup }).update(frame) -> Float32Array   (live mode)
//   diffFrame(frame, bg, W, H, roi, out, { polarity, compensate }) -> { gain, offset, sigma }
//   asGray(frame, { W, H }) -> { data, W, H }      sampleIndices(n, m)
// ccl.js
//   findComponents(diff, W, H, roi, { tLo, tHi, minArea, maxArea }) -> Component[]
//       Component = { label, area, sum, u, v, cxx, cxy, cyy, major_sd, minor_sd, angle, elong, r_px, bbox, bw, bh, peak }
//   normRoi(roi, W, H) -> { x0, y0, x1, y1 }
// ball.js
//   detectRestBall(frame, roi, expected{u,v,w_px}, opts?) -> { u, v, w_px, h_px, r_px, lie: 'mat'|'tee', conf, lie_conf, tee, ... } | null
//   detectTee(frame, { u, v, rx, ry }, opts?) -> { present, conf, length_px, width_px, contrast, x_px }
//   detectCandidates(frame, bg, roi, opts?) -> Candidate[] { u, v, w_px, h_px, r_px, area, peak, elong, angle, bbox, ... }
//   findDeparture(frames, W, H, rest, opts?) -> { ok, lastRest, departure, levels, frac }
//   trackBall(detsPerFrame, times, { start, expectedDir, maxGap, gate, firstGate, firstFrame, firstDelay, ... }) -> { obs, gaps, n, info }
//   linkChains(dets, times, params) -> { best, seeds }      toCandidate(component)
// club.js
//   trackClubHead({ frames, times, W, H, bg, roi, restBall, lastRest, lookback }) -> [{ frame, t_s, u, v, conf }]
// pipeline.js
//   analyzeClip({ frames, times, W, H, roi, restBall, impactFrameGuess, opts }) -> { restBall, ballTrack, clubTrack, reason_codes, timings_ms, info }

export * from './bgsub.js';
export * from './ccl.js';
export * from './ball.js';
export * from './club.js';
export * from './pipeline.js';
