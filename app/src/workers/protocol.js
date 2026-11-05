// workers/protocol.js - vision worker message protocol (app-architecture.md section 5) and error codes. Pure.
//
//   TO_WORKER, TO_MAIN                  message type -> required fields { name: kind }
//   ERROR_CODES = ERR = { CODE: 'CODE' }   code list (UI text: t('error.<CODE>'), never prose here)
//   errorMessage(code) -> 'error.<CODE>' catalog key (unknown code -> 'error.INTERNAL')
//   toErrorCode(err) -> CODE            err.code when it is a known code; AbortError -> CANCELLED; memory -> OUT_OF_MEMORY
//   errorReply(id, err) -> { type: 'error', id, code, params, detail, message }   (detail/message: developer text)
//   validateMessage(msg, direction: 'to_worker'|'to_main') -> { ok: true } | { ok: false, error }
//   transferablesOf(msg) -> Transferable[]      bitmaps / frames / typed-array buffers to transfer
//
// Additions to the section 5 table (all optional for a client that never needs them):
//   worker -> main  { type: 'diag', path, value }      measurements for diag/record.js (no localStorage in a worker)
//   worker -> main  { type: 'decode_request', id, req, from_s, to_s, hz, indices?, crop?, maxWidth? }
//   main -> worker  { type: 'decode_frame', id, req, bitmap, t_s, index } (full upright frame), the worker answers
//                   each with { type: 'decode_ack', id, req } (one frame in flight), then { type: 'decode_done', id, req, result }
//                   | { type: 'decode_error', id, req, code, message }
//     = "decode on the main thread and send frames" when WebCodecs is unavailable in the worker.
//   pose: optional crop { roi: {x,y,w,h}, W, H } so results are in full-frame coordinates, optional seq (new clip).
//   main -> worker  { type: 'set_model', json: object|null, bin: ArrayBuffer|null }   P9 imported event model (null = default)
//   worker -> main  { type: 'model_set', ok: boolean, version: string|null, message? }
//   worker -> main  { type: 'job_info', id, frames }    sample count of an analyze_clip job once probed (client timeout)
//   main -> worker  { type: 'e2e_crash' }               e2e only (init carried e2e: true): throw an uncaught error
//   worker -> main  { type: 'e2e_pose_request', id, req, bitmap, t_s, crop }   e2e only (init carried e2e: true and
//                   e2e_clip_pose: true): during analyze_clip the worker still runs its own pose on every frame (the
//                   cost stays real) and asks the page's __GSL_E2E__.clipPose stand-in for the landmarks to use;
//   main -> worker  { type: 'e2e_pose_reply', req, img?, world? }   the stand-in's rows (absent: keep the worker's own)

import { APP_ERROR_CODES } from '../contract/reason-codes.js';

// Error codes only (PRODUCT-SPEC §3.4): the UI text is t('error.<CODE>') / t('error.<CODE>.fix') from the catalogs.
// The codes added by drop 1 for the app shell, store and camera (contract/reason-codes.js APP_ERROR_CODES) are merged
// in, so a worker or the client may reply with any of them (WORKER_CRASHED, ANALYSIS_TIMEOUT, FILE_TRUNCATED, ...).
const WORKER_ERROR_CODES = Object.freeze([
  'BAD_MESSAGE', 'NOT_INITIALIZED', 'INIT_FAILED', 'WASM_LOAD_FAILED', 'MODEL_LOAD_FAILED', 'POSE_FAILED',
  'WEBCODECS_UNAVAILABLE', 'UNSUPPORTED_CODEC', 'NO_VIDEO_TRACK', 'DEMUX_FAILED', 'DECODE_FAILED', 'NO_DOCUMENT',
  'NO_SWING_FOUND', 'ASSEMBLE_FAILED', 'CANCELLED', 'OUT_OF_MEMORY', 'INTERNAL',
]);

export const ERROR_CODES = Object.freeze(Object.fromEntries([...WORKER_ERROR_CODES, ...Object.keys(APP_ERROR_CODES)].map((k) => [k, k])));

export const ERR = ERROR_CODES;

const num = 'number', str = 'string', obj = 'object', any = 'any', bmp = 'bitmap', f32 = 'f32';

export const TO_WORKER = Object.freeze({
  init: { delegate: str },
  pose: { id: any, bitmap: bmp, t_s: num, model: str },
  e2e_crash: {},
  e2e_pose_reply: { req: any },
  analyze_clip: { id: any, file: obj, options: obj },
  cancel: { id: any },
  decode_frame: { id: any, req: any, bitmap: bmp, t_s: num, index: num },
  decode_done: { id: any, req: any, result: obj },
  decode_error: { id: any, req: any, code: str },
  set_model: {},
});

export const TO_MAIN = Object.freeze({
  ready: { delegate: str, models: obj },
  pose_result: { id: any, t_s: num, img: f32, world: f32, ms: num },
  progress: { id: any, stage: str, frac: num },
  clip_result: { id: any, shot: obj, timings_ms: obj },
  cancelled: { id: any },
  error: { code: str },
  diag: { path: str },
  decode_request: { id: any, req: any, from_s: num, to_s: num, hz: num },
  decode_ack: { id: any, req: any },
  model_set: { ok: any },
  job_info: { id: any, frames: num },
  e2e_pose_request: { id: any, req: any, bitmap: bmp, t_s: num },
});

const MODELS = ['lite', 'full', 'heavy'];

function kindOk(v, kind) {
  switch (kind) {
    case any: return v !== undefined && v !== null;
    case num: return typeof v === 'number' && !Number.isNaN(v);
    case str: return typeof v === 'string' && v.length > 0;
    case obj: return v !== null && typeof v === 'object';
    case bmp: return v !== null && typeof v === 'object' && (typeof v.close === 'function' || ('width' in v && 'height' in v));
    case f32: return v instanceof Float32Array;
    default: return false;
  }
}

export function validateMessage(msg, direction) {
  const table = direction === 'to_worker' ? TO_WORKER : direction === 'to_main' ? TO_MAIN : null;
  if (!table) return { ok: false, error: `unknown direction '${direction}'` };
  if (!msg || typeof msg !== 'object') return { ok: false, error: 'message is not an object' };
  const spec = Object.prototype.hasOwnProperty.call(table, msg.type) ? table[msg.type] : null;
  if (!spec) return { ok: false, error: `unknown message type '${msg.type}'` };
  for (const [k, kind] of Object.entries(spec)) {
    if (!kindOk(msg[k], kind)) return { ok: false, error: `${msg.type}.${k} must be ${kind}` };
  }
  if (msg.type === 'init' && !['GPU', 'CPU'].includes(msg.delegate)) return { ok: false, error: 'init.delegate must be GPU or CPU' };
  if (msg.type === 'pose' && !MODELS.includes(msg.model)) return { ok: false, error: 'pose.model must be lite, full or heavy' };
  if (msg.type === 'pose_result' && (msg.img.length !== 132 || msg.world.length !== 99)) return { ok: false, error: 'pose_result arrays must be 132 / 99 long' };
  if (msg.type === 'e2e_pose_reply' && (msg.img !== undefined || msg.world !== undefined) &&
    !(msg.img instanceof Float32Array && msg.img.length === 132 && msg.world instanceof Float32Array && msg.world.length === 99)) {
    return { ok: false, error: 'e2e_pose_reply img / world must be Float32Array 132 / 99 (or both absent)' };
  }
  if (msg.type === 'progress' && !(msg.frac >= 0 && msg.frac <= 1)) return { ok: false, error: 'progress.frac must be in [0, 1]' };
  if (msg.type === 'error' && !Object.prototype.hasOwnProperty.call(ERROR_CODES, msg.code)) return { ok: false, error: `unknown error code '${msg.code}'` };
  if (msg.type === 'decode_error' && !Object.prototype.hasOwnProperty.call(ERROR_CODES, msg.code)) return { ok: false, error: `unknown error code '${msg.code}'` };
  if (msg.type === 'set_model' && !((msg.json === null && (msg.bin === null || msg.bin === undefined)) ||
    (msg.json !== null && typeof msg.json === 'object' && (msg.bin instanceof ArrayBuffer || ArrayBuffer.isView(msg.bin))))) {
    return { ok: false, error: 'set_model needs json (object) + bin (ArrayBuffer), or json: null' };
  }
  if (msg.type === 'model_set' && typeof msg.ok !== 'boolean') return { ok: false, error: 'model_set.ok must be boolean' };
  if (msg.type === 'ready' && !Array.isArray(msg.models)) return { ok: false, error: 'ready.models must be an array' };
  return { ok: true };
}

/** The catalog key of an error code ('error.<CODE>'); unknown codes map to error.INTERNAL. */
export function errorMessage(code) {
  return `error.${Object.prototype.hasOwnProperty.call(ERROR_CODES, code) ? code : 'INTERNAL'}`;
}

export function toErrorCode(err) {
  if (err && typeof err.code === 'string' && Object.prototype.hasOwnProperty.call(ERROR_CODES, err.code)) return err.code;
  const name = err && err.name;
  if (name === 'AbortError') return ERR.CANCELLED;
  if (name === 'QuotaExceededError' || (err instanceof RangeError && /memory|allocation/i.test(String(err.message)))) return ERR.OUT_OF_MEMORY;
  if (/out of memory/i.test(String(err && err.message))) return ERR.OUT_OF_MEMORY;
  return ERR.INTERNAL;
}

const detailOf = (err) => {
  try { return err && err.message ? String(err.message).slice(0, 500) : ''; } catch { return ''; }
};

/** -> { type: 'error', id, code, params, detail, message }: message repeats the code (+ detail) for logs only. */
export function errorReply(id, err) {
  const code = toErrorCode(err);
  const detail = (err && typeof err.detail === 'string' && err.detail) || detailOf(err);
  const params = err && err.params && typeof err.params === 'object' ? err.params : {};
  return { type: 'error', id: id ?? null, code, params, detail, message: detail ? `${code}: ${detail}` : code };
}

export function transferablesOf(msg) {
  const out = [];
  if (!msg || typeof msg !== 'object') return out;
  if (msg.bitmap && typeof msg.bitmap === 'object' && typeof msg.bitmap.close === 'function') out.push(msg.bitmap);
  for (const k of ['img', 'world']) if (ArrayBuffer.isView(msg[k])) out.push(msg[k].buffer);
  return out;
}

/**
 * Error class for worker-side failures carrying a protocol code. `detail` is developer text (diag only, never shown);
 * the UI renders t('error.' + code, params).
 */
export class WorkerError extends Error {
  constructor(code, detail, params) {
    super(detail ? String(detail) : String(code));
    this.name = 'WorkerError';
    this.code = code;
    this.detail = detail ? String(detail) : '';
    this.params = params && typeof params === 'object' ? params : {};
  }
}
