// store/quota.js — storage clean-up policy (P10, P18) and a defensive wrapper for persistent storage.
//
// planCleanup() is pure: numbers in, a plan out. It can only ever name RAW CLIPS to delete: oldest first, never a
// starred clip, never a clip of a protected (starred) shot, and nothing that is not a clip (shot data and pose
// sequences are not even inputs). It never deletes anything itself.
//
// Thresholds: clean up when usage > high, until usage <= low. Defaults high = 80% of quota, low = 60% of quota;
// give highBytes (and optionally lowBytes) to use absolute numbers instead (open question 9 in CAFCR). A device
// with less than minFreeBytes (default 500 MiB) free is flagged lowSpace: stop recording raw video (P18).

const MIB = 1024 * 1024;

export const DEFAULT_POLICY = Object.freeze({ highWater: 0.8, lowWater: 0.6, minFreeBytes: 500 * MIB });

const finiteNum = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const mb = (bytes) => `${Math.round(bytes / MIB)} MB`;

// A clip entry for the policy: { clip_id, bytes, created_at, starred?, shot_id?, kind? } (kind defaults to 'raw').
// Deletable = a raw clip with an id and a positive size that is not starred and not of a protected shot.
export function isDeletableClip(c, protectedShots) {
  if (c === null || typeof c !== 'object') return false;
  if (typeof c.clip_id !== 'string' || c.clip_id === '') return false;
  if (c.kind !== undefined && c.kind !== 'raw') return false;
  if (c.starred || c.protected) return false;
  if (protectedShots.has(c.shot_id)) return false;
  return finiteNum(c.bytes) && c.bytes > 0;
}

// Maps stored clip records (core.makeClipRecord) to policy entries without carrying the Blob around.
export function policyClips(records) {
  return records.map((r) => ({
    clip_id: r.clip_id,
    shot_id: r.shot_id,
    kind: r.kind ?? 'raw',
    created_at: r.created_at,
    starred: Boolean(r.starred),
    bytes: finiteNum(r.bytes) ? r.bytes : (r.blob && finiteNum(r.blob.size) ? r.blob.size : 0),
  }));
}

// input: { usage, quota, clips, practiceActive = false, protectShotIds = [], highWater, lowWater, highBytes, lowBytes,
//          minFreeBytes }
// -> { status: 'ok'|'over'|'unknown', usage, quota, highBytes, lowBytes, bytesToFree, deleteIds, freedBytes,
//      satisfied, warnOnly, lowSpace, message }
//   deleteIds are in deletion order. warnOnly = over the limit but a practice is running: warn, delete nothing.
//   satisfied = the listed deletions bring usage down to lowBytes (false: even all deletable clips are not enough;
//   the user must export and free space by hand, shot data is never touched).
export function planCleanup(input) {
  const {
    usage, quota, clips = [], practiceActive = false, protectShotIds = [],
    highWater = DEFAULT_POLICY.highWater, lowWater = DEFAULT_POLICY.lowWater,
    highBytes = null, lowBytes = null, minFreeBytes = DEFAULT_POLICY.minFreeBytes,
  } = input ?? {};
  const plan = {
    status: 'unknown', usage: finiteNum(usage) ? usage : null, quota: finiteNum(quota) ? quota : null,
    highBytes: null, lowBytes: null, bytesToFree: 0, deleteIds: [], freedBytes: 0, satisfied: true,
    warnOnly: false, lowSpace: false, message: '',
  };

  if (plan.usage === null || (plan.quota === null && !finiteNum(highBytes))) {
    plan.message = '讀不到儲存空間用量，沒有清理任何東西。';
    return plan;
  }
  plan.lowSpace = plan.quota !== null && plan.quota - plan.usage < minFreeBytes;
  const high = finiteNum(highBytes) ? highBytes : Math.round(plan.quota * highWater);
  const low = finiteNum(lowBytes) ? lowBytes : Math.round((high * lowWater) / highWater);
  plan.highBytes = high;
  plan.lowBytes = Math.min(low, high);

  if (plan.usage <= high) {
    plan.status = 'ok';
    plan.message = plan.lowSpace
      ? `剩餘空間不到 ${mb(minFreeBytes)}，建議停止錄製原始影片。`
      : '儲存空間充足。';
    return plan;
  }

  plan.status = 'over';
  plan.bytesToFree = plan.usage - plan.lowBytes;
  const advice = '建議先匯出備份。清理只會刪原始影片（從最舊、沒加星號的開始），不會刪任何一球的數據或姿勢。';
  if (practiceActive) {
    plan.warnOnly = true;
    plan.satisfied = false;
    plan.message = `儲存空間已超過上限（用了 ${mb(plan.usage)}），練習中只提醒、不刪除。${advice}`;
    return plan;
  }

  const protectedShots = new Set(protectShotIds);
  const candidates = clips.filter((c) => isDeletableClip(c, protectedShots)).sort((a, b) => {
    const ta = a.created_at ?? '￿'; // unknown age: delete last
    const tb = b.created_at ?? '￿';
    return ta < tb ? -1 : ta > tb ? 1 : (a.clip_id < b.clip_id ? -1 : a.clip_id > b.clip_id ? 1 : 0);
  });
  for (const c of candidates) {
    if (plan.freedBytes >= plan.bytesToFree) break;
    plan.deleteIds.push(c.clip_id);
    plan.freedBytes += c.bytes;
  }
  plan.satisfied = plan.freedBytes >= plan.bytesToFree;
  plan.message = plan.satisfied
    ? `儲存空間已超過上限（用了 ${mb(plan.usage)}）。${advice}可刪 ${plan.deleteIds.length} 支影片，約釋出 ${mb(plan.freedBytes)}。`
    : `儲存空間已超過上限（用了 ${mb(plan.usage)}），刪光所有能刪的原始影片（${plan.deleteIds.length} 支，約 ${mb(plan.freedBytes)}）仍不夠，請匯出後手動清理。`;
  return plan;
}

// navigator.storage.estimate() -> { supported, usage, quota }; never throws.
export async function estimateStorage(nav) {
  const out = { supported: false, usage: null, quota: null };
  try {
    const n = nav ?? globalThis.navigator;
    if (n && n.storage && typeof n.storage.estimate === 'function') {
      out.supported = true;
      const e = await n.storage.estimate();
      if (e && finiteNum(e.usage)) out.usage = e.usage;
      if (e && finiteNum(e.quota)) out.quota = e.quota;
    }
  } catch (_) {
    // leave the nulls: the caller shows "unknown"
  }
  return out;
}

// Asks the browser to keep our data (navigator.storage.persist) and reports the outcome; never throws.
// -> { supported, persisted: true|false|null, requested, usage, quota, error }
//   persisted null = could not be determined. iOS may answer false without ever asking the user.
export async function requestPersist(nav) {
  const out = { supported: false, persisted: null, requested: false, usage: null, quota: null, error: null };
  try {
    const n = nav ?? globalThis.navigator;
    const s = n && n.storage;
    if (s && typeof s.persist === 'function') {
      out.supported = true;
      if (typeof s.persisted === 'function') out.persisted = Boolean(await s.persisted());
      if (out.persisted !== true) {
        out.requested = true;
        out.persisted = Boolean(await s.persist());
      }
    }
  } catch (e) {
    out.error = String((e && e.message) || e);
  }
  const est = await estimateStorage(nav);
  out.usage = est.usage;
  out.quota = est.quota;
  return out;
}
