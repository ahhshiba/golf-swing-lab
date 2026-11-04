// Runs the rule-based baseline (app/src/events/rules.js detectEvents) on packed PoseSeqs written by
// training/eval_pce.py, and prints one EventSet per clip as JSON.
// Usage (repository root): node training/node/run_rules.mjs <pack.json> <pack.bin> <out.json>
// pack.json: { clips: [{ id, T, W, H, view, handedness, off_t, off_img }] } ; pack.bin: little-endian float64 t_s
// at off_t and float32 img (T*33*4) at off_img (byte offsets, 8-aligned).
import { readFileSync, writeFileSync } from 'node:fs';
import { detectEvents } from '../../app/src/events/rules.js';
import { EVENTS } from '../../app/src/contract/enums.js';

const [packJson, packBin, outPath] = process.argv.slice(2);
const meta = JSON.parse(readFileSync(packJson, 'utf8'));
const buf = readFileSync(packBin);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const out = [];
for (const c of meta.clips) {
  const t_s = new Float64Array(ab, c.off_t, c.T);
  const img = new Float32Array(ab, c.off_img, c.T * 33 * 4);
  const ps = { t_s, img, world: new Float32Array(c.T * 99), W: c.W, H: c.H, model: 'full' };
  let ev;
  try {
    ev = detectEvents(ps, { view: c.view, handedness: c.handedness });
  } catch (err) {
    out.push({ id: c.id, error: String(err) });
    continue;
  }
  const e = {};
  for (const name of EVENTS) e[name] = { t_s: ev[name].t_s, frame: ev[name].frame, conf: ev[name].conf };
  out.push({ id: c.id, events: e });
}
writeFileSync(outPath, JSON.stringify({ clips: out }));
console.log(`rules: ${out.length} clips`);
