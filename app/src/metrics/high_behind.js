// high_behind view (camera on the ball line behind the ball, ~1.7 m high, pitched down ~30°, aimed at the ball):
// the target line is close to the depth axis, so head motion along x and y is read on the horizontal plane at the
// address head height (head height assumed constant -> low_confidence, F2). In the nominal framing the head and
// shoulders are above the image (CAFCR C2: the view frames the mat, ball and club), which gives OUT_OF_FRAME nulls.
// Pure.

import { displacement, turn, finalize } from './pose.js';

export function computeHighBehind(ctx, cells) {
  const out = {};
  const run = (id, fn) => { if (cells[id]) out[id] = finalize(id, cells[id], fn(cells[id])); };
  run('head_sway_x_m', (lv) => displacement(ctx, lv, [7, 8], 'top', 0, +1, 'zplane'));
  run('head_depth_y_m', (lv) => displacement(ctx, lv, [7, 8], 'impact', 1, -1, 'zplane'));
  run('shoulder_turn_deg', (lv) => turn(ctx, lv, 11, 12));
  run('hip_turn_deg', (lv) => turn(ctx, lv, 23, 24));
  return out;
}
