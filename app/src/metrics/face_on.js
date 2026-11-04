// face_on view (camera on the -y side looking along +y): image axes ≈ target line (x) and vertical (z); depth = y.
// Computes the F2 rows that are not 不可 in this column. Pure.

import { displacement, spineTilt, turn, weightShift, finalize } from './pose.js';

/** cells: { [id]: validity } of the computable ids. Returns { [id]: Metric }. */
export function computeFaceOn(ctx, cells) {
  const out = {};
  const run = (id, fn) => { if (cells[id]) out[id] = finalize(id, cells[id], fn(cells[id])); };
  run('head_sway_x_m', (lv) => displacement(ctx, lv, [7, 8], 'top', 0, +1));
  run('head_lift_z_m', (lv) => displacement(ctx, lv, [7, 8], 'impact', 2, +1));
  run('spine_side_tilt_deg', (lv) => spineTilt(ctx, lv, 'side'));
  run('shoulder_turn_deg', (lv) => turn(ctx, lv, 11, 12));
  run('hip_turn_deg', (lv) => turn(ctx, lv, 23, 24));
  run('weight_shift_pct', (lv) => weightShift(ctx, lv));
  return out;
}
