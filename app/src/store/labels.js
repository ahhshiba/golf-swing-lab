// store/labels.js — owner annotation records (CAFCR P14). Pure: no globals, no clock (the caller passes the time).
//
// Record in the `labels` store (schema v2), keyed by shot_id:
//   { shot_id, events: { <EVENTS name>: { frame: int >= 0, t_s: number >= 0 } } (all 8), labelled_at: ISO-8601,
//     source: 'owner', revision: int >= 0, fps: number > 0 }
// `revision` grows by one each time the owner re-labels the same shot, so an export -> import merge keeps the newest
// label (the same revision rule as shots). Frames must be non-decreasing in swing-event order.
//
//   LABEL_SOURCE                              'owner'
//   makeLabelRecord({ shot_id, events, labelled_at, fps, previous? }) -> record   (throws LabelError)
//   validateLabel(rec) -> { ok, errors: [{ code, params }] }   codes only (PRODUCT-SPEC §3.4); the UI renders
//                       t(code, params) (namespace `label`). Each error's String() is a short English developer
//                       form ("label.unknown_event event=foo") so `errors.join('; ')` stays readable in scripts.
//   LabelError(message, errors)   message: English developer text; errors: the codes above
//   LABEL_SET_FORMAT                          'golf-swing-lab-labels/1' (training-set export, store/export.js)

const EVENT_NAMES = Object.freeze(['address', 'toe_up', 'mid_backswing', 'top', 'mid_downswing', 'impact',
  'mid_follow_through', 'finish']);
export const LABEL_SOURCE = 'owner';
export const LABEL_SET_FORMAT = 'golf-swing-lab-labels/1';
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

/** One validation error: { code, params } with a non-enumerable developer toString. */
export function labelIssue(code, params = {}) {
  const e = { code, params };
  Object.defineProperty(e, 'toString', {
    value: () => [code, ...Object.entries(params).map(([k, v]) => `${k}=${v}`)].join(' '),
    enumerable: false,
  });
  return e;
}

export function validateLabel(rec) {
  const errors = [];
  const add = (code, params) => errors.push(labelIssue(`label.${code}`, params));
  if (!isPlain(rec)) { add('not_object'); return { ok: false, errors }; }
  for (const k of Object.keys(rec)) if (!KEYS.includes(k)) add('unknown_field', { field: k });
  if (typeof rec.shot_id !== 'string' || rec.shot_id === '') add('missing_shot_id');
  if (rec.source !== LABEL_SOURCE) add('bad_source', { want: LABEL_SOURCE });
  if (typeof rec.labelled_at !== 'string' || !ISO_RE.test(rec.labelled_at)) add('bad_time');
  if (!(Number.isInteger(rec.revision) && rec.revision >= 0)) add('bad_revision');
  if (!(typeof rec.fps === 'number' && rec.fps > 0 && Number.isFinite(rec.fps))) add('bad_fps');
  if (!isPlain(rec.events)) add('missing_events');
  else {
    let prev = null;
    for (const k of Object.keys(rec.events)) if (!EVENT_NAMES.includes(k)) add('unknown_event', { event: k });
    for (const name of EVENT_NAMES) {
      const e = rec.events[name];
      if (!isPlain(e) || !Number.isInteger(e.frame) || e.frame < 0 || typeof e.t_s !== 'number' || !(e.t_s >= 0)) {
        add('bad_event', { event: name });
        prev = null;
        continue;
      }
      if (prev && e.frame < prev.frame) add('order', { event: name, before: prev.name });
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
  if (!v.ok) throw new LabelError(`label rejected: ${v.errors.join('; ')}`, v.errors);
  return rec;
}
