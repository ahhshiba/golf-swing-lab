// viz/tracer.js — ball tracer over the replay video (LAUNCH-MONITOR-SPEC §3.3; docs/viz.md §5).
//
//   projectFlight(camera, samples) -> [[u, v] | null]   flight.samples ([t, x, y, z] in the mat frame) into the
//       original-resolution image with calibration.camera (geom/camera.js pinhole + k1); null = behind the camera or
//       not finite. Points outside the frame are kept (the canvas clips the line at the edge, §3.3 "cut off").
//   drawTracer(canvas, { track, projected, frame, palette, reducedMotion, size?, times?, fps? }) -> { a11y, params }
//       track = shot.tracks ({ ball_px: [[frame, u, v, r]], impact_frame }); canvas = an overlay the size of the shown
//       video (size = [W, H] of the source frame, default camera-less = canvas size). Detected points: solid line +
//       dots; projected flight: dotted ("simulated" legend). Two strokes everywhere (dark 4 px halo + bright 2 px).
//       Grows frame by frame after impact; reducedMotion or frame = null → the complete line at once. With times
//       (flight sample t, s) and fps the simulated part grows in step with the video; without them it appears whole
//       once the video is past the last detected frame.
import { project } from '../geom/camera.js';
import { t } from '../i18n/index.js';
import { setup, text, finite, FS } from './draw.js';

export function projectFlight(camera, samples) {
  if (!camera || !Array.isArray(samples)) return [];
  return samples.map((s) => {
    if (!Array.isArray(s) || s.length < 4) return null;
    const p = project(camera, [s[1], s[2], s[3]]);
    return finite(p.u) && finite(p.v) && p.z > 0 ? [p.u, p.v] : null;
  });
}

function stroke2(ctx, P, pts, simulated) {
  if (pts.length < 2) return;
  const path = () => {
    ctx.beginPath();
    let pen = false;
    for (const p of pts) {
      if (!p) { pen = false; continue; }
      if (pen) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
      pen = true;
    }
  };
  ctx.setLineDash(simulated ? [2, 6] : []);
  path();
  ctx.lineWidth = 4;
  ctx.strokeStyle = P.halo;
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = P.tracer;
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawTracer(canvas, opts = {}) {
  const P = opts.palette;
  const { ctx, w, h } = setup(canvas, null);
  const [W, H] = Array.isArray(opts.size) && opts.size[0] > 0 ? opts.size : [w, h];
  const kx = w / W;
  const ky = h / H;
  const ball = (opts.track?.ball_px ?? []).filter((p) => Array.isArray(p) && p.slice(0, 3).every(finite));
  const impact = finite(opts.track?.impact_frame) ? opts.track.impact_frame : (ball[0]?.[0] ?? 0);
  const all = opts.reducedMotion || !finite(opts.frame);
  const frame = all ? Infinity : opts.frame;
  const det = ball.filter((p) => p[0] <= frame).map((p) => [p[1] * kx, p[2] * ky]);
  const lastDet = ball.length ? ball[ball.length - 1][0] : impact;
  const proj = Array.isArray(opts.projected) ? opts.projected : [];
  let simN = 0;
  if (all) simN = proj.length;
  else if (Array.isArray(opts.times) && finite(opts.fps) && opts.fps > 0) {
    const tt = (frame - impact) / opts.fps;
    simN = opts.times.filter((x) => x <= tt).length;
  } else if (frame > lastDet) simN = proj.length;
  const sim = proj.slice(0, simN).map((p) => (p ? [p[0] * kx, p[1] * ky] : null));
  // projected[0] is the impact point: the dotted path runs under the solid detected part and continues past it
  stroke2(ctx, P, sim, true);
  stroke2(ctx, P, det, false);
  for (const p of det) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], 3, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = P.halo;
    ctx.stroke();
    ctx.fillStyle = P.tracer;
    ctx.fill();
  }
  const nSim = sim.filter(Boolean).length;
  if (det.length || nSim) {
    // legend: solid = detected, dotted = simulated
    const x = 12;
    let y = 18 * FS;
    for (const [sim2, key] of [[false, 'viz.tracer.detected'], [true, 'viz.tracer.simulated']]) {
      if (sim2 ? !nSim : !ball.length) continue; // no entry for a line that is not there
      stroke2(ctx, P, [[x, y - 4], [x + 22, y - 4]], sim2);
      text(ctx, t(key), x + 28, y, { colour: P.tracer, halo: P.halo, font: P.font, size: 12, weight: 700 });
      y += 18 * FS;
    }
  }
  const params = { detected: det.length, simulated: nSim, complete: all || (det.length === ball.length && nSim === proj.filter(Boolean).length) };
  return { a11y: det.length || nSim ? 'viz.tracer.alt' : 'viz.tracer.none', params };
}
