// store/labels.js — owner annotation records (CAFCR P14). Pure: no globals, no clock (the caller passes the time).
//
// Record in the `labels` store (schema v2), keyed by shot_id:
//   { shot_id, events: { <EVENTS name>: { frame: int >= 0, t_s: number >= 0 } } (all 8), labelled_at: ISO-8601,
//     source: 'owner', revision: int >= 0, fps: number > 0 }
// `revision` grows by one each time the owner re-labels the same shot, so an export -> import merge keeps the newest
// label (the same revision rule as shots). Frames must be non-decreasing in GolfDB order.
//
//   LABEL_SOURCE                              'owner'
//   makeLabelRecord({ shot_id, events, labelled_at, fps, previous? }) -> record   (throws LabelError)
//   validateLabel(rec) -> { ok, errors: string[] }   (Traditional Chinese messages)
//   LabelError(message, errors)

const EVENT_NAMES = Object.freeze(['address', 'toe_up', 'mid_backswing', 'top', 'mid_downswing', 'impact',
  'mid_follow_through', 'finish']);
export const LABEL_SOURCE = 'owner';
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const KEYS = ['shot_id', 'events', 'labelled_at', 'source', 'revision', 'fps'];

export class LabelError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = 'LabelError';
    this.errors = errors;
  }
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function validateLabel(rec) {
  const errors = [];
  if (!isPlain(rec)) return { ok: false, errors: ['標註不是物件'] };
  for (const k of Object.keys(rec)) if (!KEYS.includes(k)) errors.push(`標註有不認得的欄位：${k}`);
  if (typeof rec.shot_id !== 'string' || rec.shot_id === '') errors.push('標註缺少 shot_id');
  if (rec.source !== LABEL_SOURCE) errors.push(`標註來源必須是 ${LABEL_SOURCE}`);
  if (typeof rec.labelled_at !== 'string' || !ISO_RE.test(rec.labelled_at)) errors.push('標註時間（labelled_at）格式不正確');
  if (!(Number.isInteger(rec.revision) && rec.revision >= 0)) errors.push('標註 revision 必須是非負整數');
  if (!(typeof rec.fps === 'number' && rec.fps > 0 && Number.isFinite(rec.fps))) errors.push('標註 fps 必須是正數');
  if (!isPlain(rec.events)) errors.push('標註缺少 events');
  else {
    let prev = null;
    for (const k of Object.keys(rec.events)) if (!EVENT_NAMES.includes(k)) errors.push(`標註有不認得的事件：${k}`);
    for (const name of EVENT_NAMES) {
      const e = rec.events[name];
      if (!isPlain(e) || !Number.isInteger(e.frame) || e.frame < 0 || typeof e.t_s !== 'number' || !(e.t_s >= 0)) {
        errors.push(`標註事件 ${name} 缺少或格式不正確（需要 frame 與 t_s）`);
        prev = null;
        continue;
      }
      if (prev && e.frame < prev.frame) errors.push(`標註事件順序不對：${name} 早於 ${prev.name}`);
      prev = { name, frame: e.frame };
    }
  }
  return { ok: errors.length === 0, errors };
}

/** A label record from an EventSet-like object (only frame and t_s are kept). `previous` = the stored label, if any. */
export function makeLabelRecord({ shot_id, events, labelled_at, fps, previous = null }) {
  const ev = {};
  for (const name of EVENT_NAMES) {
    const e = events?.[name];
    if (e && Number.isFinite(e.frame) && Number.isFinite(e.t_s)) ev[name] = { frame: Math.round(e.frame), t_s: e.t_s };
  }
  const rec = {
    shot_id, events: ev, labelled_at, source: LABEL_SOURCE,
    revision: previous && Number.isInteger(previous.revision) ? previous.revision + 1 : 0,
    fps,
  };
  const v = validateLabel(rec);
  if (!v.ok) throw new LabelError(`標註無法儲存：${v.errors.join('；')}`, v.errors);
  return rec;
}
