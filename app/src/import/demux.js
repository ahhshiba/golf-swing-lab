// import/demux.js - MP4 / MOV demux with the vendored mp4box 2.4.1 (BSD-3) (CAFCR R1 import row, P5).
//
//   openDemuxer(file, { chunkSize = 4 MiB }) -> Promise<Demuxer>
//     file: Blob/File (anything with size and slice(a, b).arrayBuffer())
//   Demuxer = { info, track, codec, width, height, matrix, timescale, duration_s, nominal_fps,
//               samples: [{ index, cts, dts, timescale, duration, offset, size, is_sync }]  (decode order),
//               description: Uint8Array | null   (avcC / hvcC payload for VideoDecoder.configure),
//               readSamples(d0, d1) -> AsyncGenerator<{ index, data: Uint8Array, sample }> }
//   codecFamily(codec) -> 'avc'|'hevc'|'vp9'|'av1'|'other'
//
// Only the moov box is parsed (mdat is skipped by file position, so a 1 GB clip is not read into memory; fragmented
// files are scanned to the end for their moof boxes, with mdat payloads discarded);
// sample payloads are read on demand with Blob.slice in contiguous batches.

import { createFile, DataStream, Endianness, MP4BoxBuffer, Log } from '../../vendor/mp4box/mp4box.all.mjs';

try { if (Log && typeof Log.setLogLevel === 'function') Log.setLogLevel(Log.error); } catch { /* ignore */ }

export class DemuxError extends Error {
  constructor(code, message) { super(message); this.name = 'DemuxError'; this.code = code; }
}

export function codecFamily(codec) {
  const c = String(codec || '');
  if (/^avc[13]/.test(c)) return 'avc';
  if (/^(hvc1|hev1)/.test(c)) return 'hevc';
  if (/^vp09/.test(c)) return 'vp9';
  if (/^av01/.test(c)) return 'av1';
  return 'other';
}

async function readBuf(file, a, b) {
  const blob = file.slice(a, b);
  return blob.arrayBuffer();
}

function descriptionOf(trak) {
  const entry = trak.mdia.minf.stbl.stsd.entries[0];
  const box = entry && (entry.avcC || entry.hvcC || entry.vpcC || entry.av1C);
  if (!box) return null;
  const s = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
  box.write(s);
  const len = s.byteLength ?? s.position;
  return new Uint8Array(s.buffer.slice(8, len)); // drop the 8-byte box header
}

export async function openDemuxer(file, opts = {}) {
  if (!file || typeof file.slice !== 'function' || !(file.size > 0)) throw new DemuxError('DEMUX_FAILED', 'empty or unreadable file');
  const chunk = opts.chunkSize ?? 4 * 1024 * 1024;
  const mp4 = createFile();
  let info = null;
  let err = null;
  mp4.onReady = (i) => { info = i; };
  mp4.onError = (m, e) => { err = e || new Error(String(m)); };
  let pos = 0;
  let guard = 0;
  // stop after the moov box, except for fragmented files (MediaRecorder output), whose samples live in moof boxes
  const more = () => !info || (info.isFragmented && pos < file.size);
  while (more() && !err && pos < file.size && guard++ < 100000) {
    const end = Math.min(file.size, pos + chunk);
    const ab = await readBuf(file, pos, end);
    const buf = MP4BoxBuffer.fromArrayBuffer(ab, pos);
    let next;
    try {
      next = mp4.appendBuffer(buf, end >= file.size);
    } catch (e) {
      err = e;
      break;
    }
    pos = Number.isFinite(next) && next > pos ? next : end;
  }
  if (!err) { try { mp4.flush(); } catch { /* ignore */ } }
  if (err) throw new DemuxError('DEMUX_FAILED', `mp4 parse error: ${err.message || err}`);
  if (!info || !info.hasMoov) throw new DemuxError('DEMUX_FAILED', 'no moov box (not an MP4/MOV file?)');
  const track = info.videoTracks && info.videoTracks[0];
  if (!track) throw new DemuxError('NO_VIDEO_TRACK', 'the file has no video track');
  const trak = mp4.getTrackById(track.id);
  const raw = mp4.getTrackSamplesInfo(track.id) || trak.samples || [];
  const samples = raw.map((s, i) => ({
    index: i, cts: s.cts, dts: s.dts, timescale: s.timescale, duration: s.duration, offset: s.offset, size: s.size,
    is_sync: !!s.is_sync,
  }));
  if (!samples.length) throw new DemuxError('DEMUX_FAILED', 'the video track has no samples');
  const entry = trak.mdia.minf.stbl.stsd.entries[0];
  const timescale = track.timescale;
  let duration_s = timescale > 0 && track.duration > 0 ? track.duration / timescale : NaN;
  if (!(duration_s > 0) && timescale > 0) {
    const sum = samples.reduce((a, s) => a + (s.duration > 0 ? s.duration : 0), 0);
    if (sum > 0) duration_s = sum / timescale;
  }
  const nominal_fps = duration_s > 0 ? samples.length / duration_s : NaN;
  const description = descriptionOf(trak);
  return {
    info, track, codec: track.codec, width: entry.width || track.track_width, height: entry.height || track.track_height,
    matrix: Array.from(track.matrix || []), timescale, duration_s, nominal_fps, samples, description,
    async *readSamples(d0 = 0, d1 = samples.length - 1, maxBatch = 4 * 1024 * 1024) {
      let d = Math.max(0, d0);
      const last = Math.min(samples.length - 1, d1);
      while (d <= last) {
        // a batch of samples whose payloads are contiguous in the file
        let e = d;
        let a = samples[d].offset;
        let b = a + samples[d].size;
        while (e + 1 <= last && samples[e + 1].offset === b && b - a + samples[e + 1].size <= maxBatch) {
          e++;
          b += samples[e].size;
        }
        const ab = await readBuf(file, a, b);
        for (let k = d; k <= e; k++) {
          const s = samples[k];
          yield { index: k, data: new Uint8Array(ab, s.offset - a, s.size), sample: s };
        }
        d = e + 1;
      }
    },
  };
}
