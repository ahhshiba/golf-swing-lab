// import/probe.js - what is in this clip? (CAFCR P5 探測; app-architecture.md section 4)
//
//   probeFile(file, { demuxer? }) -> Promise<Probe>
//   summarize(demuxer) -> Probe      (pure; exported for tests)
//   Probe = { codec, family, width, height, display_width, display_height, rotation, mirrored, sample_count,
//             effective_fps, nominal_fps, vfr, cv, timestamps: 'container'|'nominal', cts_s: number[],
//             duration_s, reason_codes, timebase }
//
// cts_s are presentation-ordered seconds (container CTS / timescale; nominal frame / fps when CTS are unusable).
// width / height are the coded size; display_* apply the tkhd rotation.

import { openDemuxer, codecFamily } from './demux.js';
import { buildTimebase, rotationFromMatrix, displaySize } from './timebase.js';
import { diagRecord } from '../workers/diag.js';

export function summarize(dm) {
  const tb = buildTimebase(dm.samples, { nominal_fps: dm.nominal_fps });
  const rot = rotationFromMatrix(dm.matrix);
  const disp = displaySize(dm.width, dm.height, rot.rotation);
  return {
    codec: dm.codec,
    family: codecFamily(dm.codec),
    width: dm.width,
    height: dm.height,
    display_width: disp.width,
    display_height: disp.height,
    rotation: rot.rotation,
    mirrored: rot.mirrored,
    sample_count: dm.samples.length,
    effective_fps: tb.effective_fps,
    nominal_fps: tb.nominal_fps,
    vfr: tb.vfr,
    cv: tb.cv,
    timestamps: tb.timestamps,
    cts_s: Array.from(tb.t_s),
    duration_s: dm.duration_s,
    reason_codes: tb.reason_codes.slice(),
    timebase: tb,
  };
}

export async function probeFile(file, opts = {}) {
  const dm = opts.demuxer ?? (await openDemuxer(file));
  const p = summarize(dm);
  diagRecord('import.last.effective_fps', p.effective_fps);
  diagRecord('import.last.sample_count', p.sample_count);
  diagRecord('import.last.hevc', p.family === 'hevc');
  diagRecord('import.last.vfr', p.vfr);
  diagRecord('import.last.codec', p.codec);
  return p;
}
