// store/export.js — JSON / CSV export and JSON import (P7, KD5/KD6: backups must come back exactly).
//
// JSON file, format 'golf-swing-lab-export/1':
//   { format, exported_at, app_version, venues[], presets[], sessions[], shots[], poses?[], clips?[] }
//   * poses are included only with includePoses, clips only with includeClips (clips are big: base64 of the video).
//   * PoseSeq typed arrays travel as { __typed: 'Float32Array', b64 } (little-endian bytes, as on every target).
//   * a clip's Blob travels as { ...clip fields, data_b64, mime } and comes back as a Blob.
//   * labels?[] (P14 owner annotations, store/labels.js) are included only with includeLabels; on import each one
//     is checked with validateLabel and merged by revision like the shots. Event models are never exported.
//
// importJSON merges by primary id: a record with a higher `revision` replaces the stored one, a tie keeps the
// stored one (a missing revision counts as 0). Anything wrong with the file rejects the WHOLE import with an
// ImportError whose message is Traditional Chinese, and nothing is written.
//
// CSV columns (fixed; the order is a public format, never reorder or insert, only append):
//   shot_id, created_at, venue_id, preset_id, view, club_type, lie,
//   then for every metric id in docs/interfaces.md section 9 (see metric-ids.js), in that order:
//     <id>, <id>_lo, <id>_hi, <id>_validity
//   (7 + 22 x 4 = 95 columns; nothing follows the last metric column. Shot notes are NOT CSV columns; they
//   travel in the JSON export.)
//   <id> = metric value, <id>_lo/_hi = ci95 bounds, <id>_validity = validity text. Null or absent -> empty cell.
//   (sigma is not converted into a range: only a stored ci95 fills _lo/_hi.)
//   Quoting follows RFC 4180: a field containing a comma, a double quote, CR or LF is wrapped in double quotes and
//   inner quotes are doubled; records end with CRLF.

import { METRIC_IDS } from './metric-ids.js';
import { assertShotFilter, getPath, revisionOf, filterShots } from './core.js';
import { validateLabel } from './labels.js';

export const EXPORT_FORMAT = 'golf-swing-lab-export/1';
const FORMAT_RE = /^golf-swing-lab-export\/(\d+)$/;
const SUPPORTED_MAJOR = 1;

export const CSV_FIXED_COLUMNS = Object.freeze(['shot_id', 'created_at', 'venue_id', 'preset_id', 'view', 'club_type', 'lie']);
export const CSV_COLUMNS = Object.freeze([
  ...CSV_FIXED_COLUMNS,
  ...METRIC_IDS.flatMap((id) => [id, `${id}_lo`, `${id}_hi`, `${id}_validity`]),
]);

// ------------------------------------------------------------------------------------------------ errors

// Rejection of an import. `message` is Traditional Chinese for the user; `details` lists every problem found.
export class ImportError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'ImportError';
    this.code = 'IMPORT_REJECTED';
    this.details = details;
  }
}

// ------------------------------------------------------------------------------------------- binary fields

const TYPED = {
  Float32Array, Float64Array, Int8Array, Uint8Array, Int16Array, Uint16Array, Int32Array, Uint32Array,
};

function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v);

// Replaces typed arrays anywhere inside a plain structure with { __typed, b64 }.
export function encodeTyped(value) {
  if (ArrayBuffer.isView(value)) {
    const name = value.constructor.name;
    if (!TYPED[name]) throw new Error(`不支援的二進位資料型別：${name}`);
    return { __typed: name, b64: bytesToB64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
  }
  if (Array.isArray(value)) return value.map(encodeTyped);
  if (isPlain(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encodeTyped(v)]));
  return value;
}

// Inverse of encodeTyped; throws Error('...') with a readable reason on corrupt data.
export function decodeTyped(value) {
  if (Array.isArray(value)) return value.map(decodeTyped);
  if (isPlain(value)) {
    if (typeof value.__typed === 'string') {
      const Ctor = TYPED[value.__typed];
      if (!Ctor || typeof value.b64 !== 'string') throw new Error('二進位欄位格式不正確');
      const bytes = b64ToBytes(value.b64);
      if (bytes.byteLength % Ctor.BYTES_PER_ELEMENT !== 0) throw new Error('二進位欄位長度不正確');
      return new Ctor(bytes.buffer, 0, bytes.byteLength / Ctor.BYTES_PER_ELEMENT);
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decodeTyped(v)]));
  }
  return value;
}

async function blobBytes(blob) {
  if (blob && typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  if (ArrayBuffer.isView(blob)) return new Uint8Array(blob.buffer, blob.byteOffset, blob.byteLength);
  if (blob instanceof ArrayBuffer) return new Uint8Array(blob);
  throw new Error('影片資料格式不正確');
}

async function encodeClip(clip) {
  const { blob, ...rest } = clip;
  if (blob === undefined || blob === null) return encodeTyped(rest);
  return { ...encodeTyped(rest), mime: rest.mime ?? blob.type ?? '', data_b64: bytesToB64(await blobBytes(blob)) };
}

function decodeClip(rec) {
  const { data_b64: data, ...rest } = rec;
  const out = decodeTyped(rest);
  if (data !== undefined) {
    if (typeof data !== 'string') throw new Error('影片資料格式不正確');
    out.blob = new Blob([b64ToBytes(data)], { type: typeof rest.mime === 'string' ? rest.mime : '' });
  }
  return out;
}

// ----------------------------------------------------------------------------------------------- exportJSON

function isoNow(now) {
  if (typeof now === 'function') return isoNow(now());
  if (now instanceof Date) return now.toISOString();
  if (typeof now === 'string') return now;
  return new Date().toISOString();
}

// filter: the shot filter keys of core.js (session_id, preset_id, venue_id, view, club_type, lie, from, to, starred)
// plus { includePoses, includeClips, app_version, now }.
// No shot filter -> everything (also venues/presets/sessions that no shot uses yet).
// With a shot filter -> the matching shots plus the venues/presets/sessions they reference, so the file stands alone.
export async function exportJSON(repo, filter = {}) {
  const { includePoses = false, includeClips = false, includeLabels = false, app_version: appVersion, now, ...shotFilter } = filter ?? {};
  assertShotFilter(shotFilter);
  const filtered = Object.values(shotFilter).some((v) => v !== undefined && v !== null);

  const names = ['venues', 'presets', 'sessions', 'shots'];
  if (includePoses) names.push('poses');
  if (includeClips) names.push('clips');
  if (includeLabels) names.push('labels');
  const snap = await repo.snapshot(names);

  const shots = filterShots(snap.shots, shotFilter);
  let { venues, presets, sessions } = snap;
  let poses = snap.poses;
  let clips = snap.clips;
  let labels = snap.labels;
  if (filtered) {
    const ids = new Set(shots.map((s) => s.shot_id));
    const sessionIds = new Set(shots.map((s) => s.session_id));
    const presetIds = new Set(shots.map((s) => s.preset_id));
    sessions = sessions.filter((s) => sessionIds.has(s.session_id));
    presets = presets.filter((p) => presetIds.has(p.preset_id));
    const venueIds = new Set([...shots, ...sessions, ...presets].map((r) => r.venue_id));
    venues = venues.filter((v) => venueIds.has(v.venue_id));
    if (poses) poses = poses.filter((p) => ids.has(p.shot_id));
    if (clips) clips = clips.filter((c) => ids.has(c.shot_id));
    if (labels) labels = labels.filter((l) => ids.has(l.shot_id));
  }

  const out = {
    format: EXPORT_FORMAT,
    exported_at: isoNow(now),
    app_version: appVersion ?? 'unknown',
    venues,
    presets,
    sessions,
    shots,
  };
  if (includePoses) out.poses = poses.map(encodeTyped);
  if (includeClips) out.clips = await Promise.all(clips.map(encodeClip));
  if (includeLabels) out.labels = labels;
  return out;
}

// ---------------------------------------------------------------------------------------------- exportCSV

export function csvField(v) {
  let s;
  if (v === null || v === undefined) s = '';
  else if (typeof v === 'number') s = Number.isFinite(v) ? String(v) : '';
  else s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(shot) {
  const cells = [
    shot.shot_id, shot.created_at, shot.venue_id, shot.preset_id,
    getPath(shot, 'capture.view'), getPath(shot, 'club.type'), getPath(shot, 'club.lie'),
  ];
  const metrics = shot.metrics ?? {};
  for (const id of METRIC_IDS) {
    const m = metrics[id];
    const ci = m && Array.isArray(m.ci95) ? m.ci95 : null;
    cells.push(m ? m.value : null, ci ? ci[0] : null, ci ? ci[1] : null, m ? m.validity : null);
  }
  return cells.map(csvField).join(',');
}

// opts: { bom = false } — prepend a UTF-8 BOM so spreadsheet apps read Chinese text correctly.
export function exportCSV(shots, { bom = false } = {}) {
  const lines = [CSV_COLUMNS.map(csvField).join(','), ...shots.map(csvRow)];
  return `${bom ? '﻿' : ''}${lines.join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------------------------------- validation

// Used when contract/validate.js is not available: structure only, not the metric invariants.
export function builtinShotValidator(shot) {
  const errors = [];
  if (!isPlain(shot)) return { ok: false, errors: ['不是物件'] };
  if (shot.schema !== 'golf-shot/1') errors.push(`schema 應為 golf-shot/1，實際是 ${String(shot.schema)}`);
  if (typeof shot.shot_id !== 'string' || shot.shot_id === '') errors.push('缺少 shot_id');
  if (shot.metrics !== undefined && !isPlain(shot.metrics)) errors.push('metrics 必須是物件');
  return { ok: errors.length === 0, errors };
}

function describeError(e) {
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const where = e.path ?? e.instancePath ?? e.field;
    const what = e.message ?? e.msg ?? e.code;
    if (what) return where ? `${where}：${what}` : String(what);
  }
  return JSON.stringify(e);
}

// Accepts the usual validator return shapes: true | false | { ok|valid, errors } | array of errors (empty = valid).
export function normalizeValidation(result) {
  if (result === true) return { ok: true, errors: [] };
  if (result === false) return { ok: false, errors: ['驗證失敗'] };
  if (Array.isArray(result)) return { ok: result.length === 0, errors: result.map(describeError) };
  if (result && typeof result === 'object') {
    const flag = 'ok' in result ? result.ok : result.valid;
    if (typeof flag === 'boolean') {
      const errs = Array.isArray(result.errors) ? result.errors.map(describeError) : [];
      return { ok: flag, errors: flag ? [] : (errs.length ? errs : ['驗證失敗']) };
    }
  }
  return { ok: false, errors: ['驗證器沒有回傳可辨識的結果'] };
}

let contractValidatorPromise = null;

// The default validator: contract/validate.js (export validateShot | validate | default) when it can be loaded,
// otherwise builtinShotValidator. Returns { fn, source: 'contract'|'builtin', note }; `note` explains a fallback.
export function resolveDefaultValidator() {
  if (!contractValidatorPromise) {
    contractValidatorPromise = import('../contract/validate.js').then(
      (mod) => {
        const fn = mod.validateShot ?? mod.validate ?? mod.default;
        if (typeof fn === 'function') return { fn, source: 'contract', note: null };
        return { fn: builtinShotValidator, source: 'builtin', note: 'contract/validate.js 沒有提供 validateShot，只做基本格式檢查' };
      },
      () => ({ fn: builtinShotValidator, source: 'builtin', note: '找不到 contract/validate.js，只做基本格式檢查' }),
    );
  }
  return contractValidatorPromise;
}

// ---------------------------------------------------------------------------------------------- importJSON

const REQUIRED_ARRAYS = ['venues', 'presets', 'sessions', 'shots'];
const ID_FIELD = { venues: 'venue_id', presets: 'preset_id', sessions: 'session_id', shots: 'shot_id', poses: 'shot_id', clips: 'clip_id', labels: 'shot_id' };
const LABEL = { venues: '場地', presets: '機位預設', sessions: '練習', shots: '球', poses: '姿勢序列', clips: '影片', labels: '標註' };
const MAX_LISTED = 5;

function parseInput(data) {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data.charCodeAt(0) === 0xfeff ? data.slice(1) : data);
  } catch (e) {
    throw new ImportError('這個檔案不是有效的 JSON，沒有匯入任何資料。', [String(e.message)]);
  }
}

function checkEnvelope(data) {
  if (!isPlain(data)) {
    throw new ImportError('這不是 golf-swing-lab 的匯出檔（內容不是 JSON 物件），沒有匯入任何資料。');
  }
  const m = typeof data.format === 'string' ? FORMAT_RE.exec(data.format) : null;
  if (!m) {
    throw new ImportError(
      `這不是 golf-swing-lab 的匯出檔（format 欄位是 ${JSON.stringify(data.format ?? null)}，應為 ${EXPORT_FORMAT}），沒有匯入任何資料。`);
  }
  if (Number(m[1]) !== SUPPORTED_MAJOR) {
    throw new ImportError(
      `這個匯出檔的格式版本（${data.format}）和這個 App 支援的（${EXPORT_FORMAT}）不同，請用相符版本的 App 匯入，沒有匯入任何資料。`);
  }
  const missing = REQUIRED_ARRAYS.filter((k) => !Array.isArray(data[k]));
  if (missing.length) {
    throw new ImportError(`匯出檔缺少或格式不正確的欄位：${missing.join('、')}，沒有匯入任何資料。`, missing);
  }
  for (const k of ['poses', 'clips', 'labels']) {
    if (data[k] !== undefined && !Array.isArray(data[k])) {
      throw new ImportError(`匯出檔的 ${k} 欄位格式不正確，沒有匯入任何資料。`, [k]);
    }
  }
}

// One entry per id; the higher revision wins, a tie keeps the first occurrence.
function dedupe(store, list, problems, warnings) {
  const idField = ID_FIELD[store];
  const byId = new Map();
  let dropped = 0;
  list.forEach((rec, i) => {
    const id = isPlain(rec) ? rec[idField] : undefined;
    if (typeof id !== 'string' || id === '') {
      problems.push(`${LABEL[store]}第 ${i + 1} 筆缺少 ${idField}`);
      return;
    }
    if (rec.revision !== undefined && !(Number.isInteger(rec.revision) && rec.revision >= 0)) {
      problems.push(`${LABEL[store]} ${id}：revision 必須是非負整數`);
      return;
    }
    const prev = byId.get(id);
    if (!prev) byId.set(id, rec);
    else {
      dropped++;
      if (revisionOf(rec) > revisionOf(prev)) byId.set(id, rec);
    }
  });
  if (dropped) warnings.push(`${LABEL[store]}有 ${dropped} 筆重複的 ${idField}，已保留 revision 較高者`);
  return [...byId.values()];
}

// data: parsed export object or its JSON text. opts: { validate }.
// validate(shot) -> true | false | { ok, errors } | errors[]; may be async; a throw counts as invalid.
// Resolves to { ok: true, counts: { venues: { added, updated, kept }, ... }, total, validator, warnings, message }.
// Rejects with ImportError (nothing written) on any problem.
export async function importJSON(repo, data, { validate } = {}) {
  const env = parseInput(data);
  checkEnvelope(env);

  const warnings = [];
  let validator = 'custom';
  let validateFn = validate;
  if (typeof validateFn !== 'function') {
    const def = await resolveDefaultValidator();
    validateFn = def.fn;
    validator = def.source;
    if (def.note) warnings.push(def.note);
  }

  const problems = [];
  const byStore = {};
  for (const store of REQUIRED_ARRAYS) byStore[store] = dedupe(store, env[store], problems, warnings);

  const bad = [];
  for (const shot of byStore.shots) {
    let verdict;
    try {
      verdict = normalizeValidation(await validateFn(shot));
    } catch (e) {
      verdict = { ok: false, errors: [`驗證時發生錯誤：${(e && e.message) || String(e)}`] };
    }
    if (!verdict.ok) bad.push(`球 ${shot.shot_id}：${verdict.errors.join('；')}`);
  }

  for (const store of ['poses', 'clips']) {
    if (env[store] === undefined) continue;
    try {
      byStore[store] = dedupe(store, env[store], problems, warnings).map(store === 'poses' ? decodeTyped : decodeClip);
    } catch (e) {
      problems.push(`${LABEL[store]}資料損毀：${e.message}`);
    }
  }

  if (env.labels !== undefined) {
    byStore.labels = dedupe('labels', env.labels, problems, warnings);
    for (const l of byStore.labels) {
      const v = validateLabel(l);
      if (!v.ok) problems.push(`標註 ${l.shot_id}：${v.errors.join('；')}`);
    }
  }

  if (problems.length || bad.length) {
    const details = [...problems, ...bad];
    const shown = details.slice(0, MAX_LISTED).join('；');
    const more = details.length > MAX_LISTED ? `（共 ${details.length} 個問題）` : '';
    throw new ImportError(`匯入已取消，沒有寫入任何資料。${bad.length ? `有 ${bad.length} 筆球的資料不符合格式。` : ''}${shown}${more}`, details);
  }

  const counts = await repo.merge(byStore);
  const total = { added: 0, updated: 0, kept: 0 };
  for (const c of Object.values(counts)) for (const k of Object.keys(total)) total[k] += c[k];
  return {
    ok: true,
    counts,
    total,
    validator,
    warnings,
    message: `匯入完成：新增 ${total.added} 筆、更新 ${total.updated} 筆、略過 ${total.kept} 筆（本機已有相同或較新的版本）。`,
  };
}
