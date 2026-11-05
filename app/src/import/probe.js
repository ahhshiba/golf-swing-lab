// import/probe.js - what is in this clip? (CAFCR P5 探測; app-architecture.md section 4)
//
//   probeFile(file, { demuxer? }) -> Promise<Probe>
//   summarize(demuxer) -> Probe      (pure; exported for tests)
//   Probe = { codec, family, width, height, display_width, display_height, rotation, mirrored, sample_count,
//             effective_fps, nominal_fps, vfr, cv, timestamps: 'container'|'nominal', cts_s: number[],
//             duration_s, reason_codes, timebase, truncated, file_bytes, table_end_bytes, captureFpsHint }
//   truncated (R9): the sample table points past the end of the file (an interrupted copy / download), or the first or
//     last sample cannot be read in full. The worker refuses such a clip with FILE_TRUNCATED; the import screen shows it.
//   captureFpsHint: capture rate implied by a slow-motion edit list (a segment played k x slower than recorded:
//     effective_fps x ... ) or null when the file says nothing (PRODUCT-SPEC §8.0.10).
//
// cts_s are presentation-ordered seconds (container CTS / timescale; nominal frame / fps when CTS are unusable).
// width / height are the coded size; display_* apply the tkhd rotation.

import { openDemuxer, codecFamily } from './demux.js';
import { buildTimebase, rotationFromMatrix, displaySize } from './timebase.js';
import { diagRecord } from '../workers/diag.js';

/** Capture-rate hint from an edit list: the largest slow-down k >= 1.5 of any segment -> k x effective fps, else null. */
export function captureFpsHintOf(edits, effective_fps) {
  if (!Array.isArray(edits) || !(effective_fps > 0)) return null;
  let k = 1;
  for (const e of edits) {
    if (Number.isFinite(e.rate) && e.rate > 0 && e.rate < 1) k = Math.max(k, 1 / e.rate);
    if (e.segment_s > 0 && e.media_s > 0) k = Math.max(k, e.segment_s / e.media_s);
  }
  return k >= 1.5 ? Math.round(effective_fps * k) : null;
}

/** true when the file is shorter than its own sample table says. */
export function isTruncated(dm) {
  const size = dm && dm.file_bytes;
  const end = dm && dm.table_end_bytes;
  return Number.isFinite(size) && Number.isFinite(end) && end > size;
}

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
    truncated: isTruncated(dm),
    file_bytes: Number.isFinite(dm.file_bytes) ? dm.file_bytes : null,
    table_end_bytes: Number.isFinite(dm.table_end_bytes) ? dm.table_end_bytes : null,
    captureFpsHint: captureFpsHintOf(dm.edits, tb.effective_fps),
  };
}

async function readable(dm, d) {
  try {
    for await (const s of dm.readSamples(d, d)) return s.data.byteLength === s.sample.size;
  } catch { return false; }
  return false;
}

export async function probeFile(file, opts = {}) {
  const dm = opts.demuxer ?? (await openDemuxer(file));
  const p = summarize(dm);
  // first + last sample must be readable in full (a cut-off copy fails here even when the table looks sane)
  if (!p.truncated && typeof dm.readSamples === 'function' && dm.samples.length) {
    const ends = [0, dm.samples.length - 1];
    for (const d of ends) if (!(await readable(dm, d))) { p.truncated = true; break; }
  }
  diagRecord('import.last.truncated', p.truncated);
  diagRecord('import.last.effective_fps', p.effective_fps);
  diagRecord('import.last.sample_count', p.sample_count);
  diagRecord('import.last.hevc', p.family === 'hevc');
  diagRecord('import.last.vfr', p.vfr);
  diagRecord('import.last.codec', p.codec);
  return p;
}
