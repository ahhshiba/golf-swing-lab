// practice/assign.js — map imported clips to drill slots (LAUNCH-MONITOR-SPEC §3.5, §5.0-6 FROZEN). Pure, lazy.
//
//   assignClips(drill, clips: [{ started_at }]) -> [{ slot, clipIndex }]
//
// The player records one slow-motion clip per shot, in the drill's order, then imports the batch. Clips are sorted by
// started_at (ISO string or ms; unknown times go last, ties keep the input order) and given the drill's open slots
// (no shot yet) in slot order. One entry per clip, in that time order; a clip beyond the last open slot gets
// slot: null (not assigned — the caller reports it).

const timeOf = (x) => {
  if (typeof x === 'number') return Number.isFinite(x) ? x : NaN;
  return Date.parse(String(x ?? ''));
};

export function openSlots(drill) {
  return (drill?.slots ?? []).filter((s) => !s.shot_id).map((s) => s.slot);
}

export function assignClips(drill, clips) {
  const order = (clips ?? []).map((c, i) => ({ i, t: timeOf(c?.started_at) }));
  order.sort((a, b) => {
    const fa = Number.isFinite(a.t);
    const fb = Number.isFinite(b.t);
    if (fa && fb && a.t !== b.t) return a.t - b.t;
    if (fa !== fb) return fa ? -1 : 1;
    return a.i - b.i;
  });
  const open = openSlots(drill);
  return order.map((o, j) => ({ slot: open[j] ?? null, clipIndex: o.i }));
}
