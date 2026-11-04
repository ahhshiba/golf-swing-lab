// workers/protocol.js - vision worker message protocol (app-architecture.md section 5) and error codes. Pure.
//
//   TO_WORKER, TO_MAIN                  message type -> required fields { name: kind }
//   ERROR_CODES { CODE: 'Traditional Chinese message' }      ERR { CODE: 'CODE' }
//   errorMessage(code) -> string        (unknown code -> the INTERNAL message)
//   toErrorCode(err) -> CODE            err.code when it is a known code; AbortError -> CANCELLED; memory -> OUT_OF_MEMORY
//   errorReply(id, err) -> { type: 'error', id, code, message }
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

export const ERROR_CODES = Object.freeze({
  BAD_MESSAGE: '內部訊息格式錯誤，請重新整理 App。',
  NOT_INITIALIZED: '分析引擎尚未啟動完成，請稍候再試。',
  INIT_FAILED: '分析引擎啟動失敗，請重新開啟 App。',
  WASM_LOAD_FAILED: '無法載入姿勢辨識引擎，請確認 App 已完整下載（連上網路開啟一次）。',
  MODEL_LOAD_FAILED: '無法載入姿勢模型檔，請確認 App 已完整下載。',
  POSE_FAILED: '姿勢辨識失敗。',
  WEBCODECS_UNAVAILABLE: '此裝置無法在背景解碼影片，改用相容模式（較慢）。',
  UNSUPPORTED_CODEC: '此影片的編碼無法在這台裝置解碼，請改錄 H.264（相容性最佳）。',
  NO_VIDEO_TRACK: '檔案裡沒有影片軌。',
  DEMUX_FAILED: '無法讀取影片檔：不是 MP4／MOV 或檔案已損壞。',
  DECODE_FAILED: '影片解碼失敗。',
  NO_DOCUMENT: '相容模式只能在主畫面執行。',
  NO_SWING_FOUND: '影片中找不到完整的揮桿動作。',
  ASSEMBLE_FAILED: '整理分析結果時發生錯誤。',
  CANCELLED: '已取消。',
  OUT_OF_MEMORY: '記憶體不足，請剪短影片後再試。',
  INTERNAL: '發生未預期的錯誤。',
});

export const ERR = Object.freeze(Object.fromEntries(Object.keys(ERROR_CODES).map((k) => [k, k])));

const num = 'number', str = 'string', obj = 'object', any = 'any', bmp = 'bitmap', f32 = 'f32';

export const TO_WORKER = Object.freeze({
  init: { delegate: str },
  pose: { id: any, bitmap: bmp, t_s: num, model: str },
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
  error: { code: str, message: str },
  diag: { path: str },
  decode_request: { id: any, req: any, from_s: num, to_s: num, hz: num },
  decode_ack: { id: any, req: any },
  model_set: { ok: any },
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

export function errorMessage(code) {
  return Object.prototype.hasOwnProperty.call(ERROR_CODES, code) ? ERROR_CODES[code] : ERROR_CODES.INTERNAL;
}

export function toErrorCode(err) {
  if (err && typeof err.code === 'string' && Object.prototype.hasOwnProperty.call(ERROR_CODES, err.code)) return err.code;
  const name = err && err.name;
  if (name === 'AbortError') return ERR.CANCELLED;
  if (name === 'QuotaExceededError' || (err instanceof RangeError && /memory|allocation/i.test(String(err.message)))) return ERR.OUT_OF_MEMORY;
  if (/out of memory/i.test(String(err && err.message))) return ERR.OUT_OF_MEMORY;
  return ERR.INTERNAL;
}

export function errorReply(id, err) {
  const code = toErrorCode(err);
  const detail = err && err.message ? String(err.message) : '';
  return { type: 'error', id: id ?? null, code, message: errorMessage(code) + (detail && code === ERR.INTERNAL ? `（${detail}）` : '') , detail };
}

export function transferablesOf(msg) {
  const out = [];
  if (!msg || typeof msg !== 'object') return out;
  if (msg.bitmap && typeof msg.bitmap === 'object' && typeof msg.bitmap.close === 'function') out.push(msg.bitmap);
  for (const k of ['img', 'world']) if (ArrayBuffer.isView(msg[k])) out.push(msg[k].buffer);
  return out;
}

/** Error class for worker-side failures carrying a protocol code. */
export class WorkerError extends Error {
  constructor(code, message) { super(message || errorMessage(code)); this.name = 'WorkerError'; this.code = code; }
}
