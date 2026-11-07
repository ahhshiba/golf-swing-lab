// Club profile (LAUNCH-MONITOR-SPEC §1.4, §5.0-3): mean and SD of attack angle, dynamic loft, launch angle and spin
// of one club's recent face_on shots. It would feed the cross-view prior of §1.4, which the owner decided not to use
// (D2, settings.lm.crossView is always false), so nothing in the app consumes it yet; kept pure and tested. Lazy.

const DAY_MS = 86400000;

function meanSd(xs) {
  const n = xs.length;
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const v = n > 1 ? xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1) : 0;
  return { mean: m, sd: Math.sqrt(v) };
}

/**
 * shots: golf-shot/2 records; clubType: the club.type to match; o: { days = 30, minN = 20, now = the newest
 * created_at of the shots (ms or ISO) }. Only face_on shots with a number for all four ids count.
 * Returns { n, aoa: { mean, sd }, dl, lv, spin } or null when fewer than minN shots qualify.
 */
export function clubProfile(shots, clubType, { days = 30, minN = 20, now = null } = {}) {
  const list = (Array.isArray(shots) ? shots : []).filter((s) => s && s.club?.type === clubType && s.capture?.view === 'face_on');
  const time = (s) => Date.parse(s.created_at);
  const t1 = now === null ? Math.max(-Infinity, ...list.map(time).filter(Number.isFinite)) : (typeof now === 'number' ? now : Date.parse(now));
  if (!Number.isFinite(t1)) return null;
  const ids = { aoa: 'attack_angle_deg', dl: 'dynamic_loft_deg', lv: 'launch_v_deg', spin: 'spin_rate_rpm' };
  const rows = list.filter((s) => {
    const t = time(s);
    return Number.isFinite(t) && t <= t1 && t1 - t <= days * DAY_MS
      && Object.values(ids).every((id) => Number.isFinite(s.metrics?.[id]?.value));
  });
  if (rows.length < minN) return null;
  const out = { n: rows.length };
  for (const [k, id] of Object.entries(ids)) out[k] = meanSd(rows.map((s) => s.metrics[id].value));
  return out;
}
