// session/models.js — CAFCR P9 event-model replacement and rollback, and the bundled-model licence switch.
//
// The owner imports an event model (event-tcn-*.json + .bin) from the settings screen. It is accepted only if:
//   * json.format is gsl-event-tcn/1 and json.feature_version is the app's FEATURE_VERSION;
//   * sha256(bin) equals json.sha256 and bin.byteLength equals json.bin_bytes;
//   * every tensor exists with the shape the architecture needs (events/tcn.js loadTcn throws otherwise);
//   * when the json carries a golden (`json.golden.cases`, same format as tests/fixtures/event-tcn-v1.golden.json),
//     the JS inference reproduces it: max |dprob| <= 1e-4 and identical per-frame argmax (CAFCR P9 "golden ≤1e-4").
// Accepted models live in the `models` store (schema v2) in two slots:
//   'active'   { slot, source: 'imported', version, sha256, feature_version, n_params, imported_at, file_names, golden, json, bin }
//   'previous' the model that was active before the last import, or { slot, source: 'builtin' } when that was the
//              bundled model (or the rules, in a build without one).
// rollbackEventModel() swaps the two slots (so a second tap rolls forward again); rolling back to 'builtin' deletes
// both slots. No imported model → the worker uses the bundled model (workers/vision.worker.js fetches it) or, in a
// --no-bundled-model build, the rules.
//
//   GOLDEN_TOL
//   sha256Hex(bytes, subtle?) -> Promise<hex>
//   goldenProblems(tcn, golden, tol?) -> { problems: string[], worst }        (pure)
//   validateEventModel(json, bin, { sha256 }) -> Promise<{ ok, problems, meta, golden: 'pass'|'fail'|'absent', worst }>
//   importEventModel(repo, { json, bin, check, imported_at, file_names }) -> Promise<record>
//   rollbackEventModel(repo) -> Promise<{ ok, active: record|null, message }>
//   activeEventModel(repo) / previousEventModel(repo) -> Promise<record|null>
//   bundledModelAvailable(fetchFn) -> Promise<boolean>    (precache-manifest.json, else the model json itself)
//   modelStatusText({ active, previous, bundled }) -> string (Traditional Chinese)

import { loadTcn, TCN_FORMAT } from '../events/tcn.js';
import { FEATURE_VERSION } from '../events/features.js';

export const GOLDEN_TOL = 1e-4;
export const BUNDLED_MODEL = Object.freeze({ json: 'models/event-tcn-v1.json', bin: 'models/event-tcn-v1.bin' });
export const NO_MODEL_HINT = '可從檔案匯入事件模型';

const toBuffer = (b) => (ArrayBuffer.isView(b) ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b);

export async function sha256Hex(bytes, subtle = globalThis.crypto?.subtle) {
  if (!subtle) throw new Error('這個瀏覽器不支援 SHA-256（crypto.subtle）');
  const d = new Uint8Array(await subtle.digest('SHA-256', toBuffer(bytes)));
  return Array.from(d, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Golden reproduction check of a loaded TCN. golden = { cases: [{ name, K, F, features, probs, argmax }] }. */
export function goldenProblems(tcn, golden, tol = GOLDEN_TOL) {
  const problems = [];
  let worst = 0;
  const cases = Array.isArray(golden?.cases) ? golden.cases : [];
  if (!cases.length) problems.push('golden 沒有測試案例');
  for (const c of cases) {
    let p;
    try {
      p = tcn.predict({ K: c.K, F: c.F, data: Float64Array.from(c.features) });
    } catch (e) {
      problems.push(`golden ${c.name}：推論失敗（${e.message}）`);
      continue;
    }
    if (p.length !== c.K * 9 || !Array.isArray(c.probs) || c.probs.length !== c.K * 9) { problems.push(`golden ${c.name}：輸出長度不符`); continue; }
    let maxd = 0;
    let argBad = 0;
    for (let t = 0; t < c.K; t++) {
      let best = 0;
      for (let k = 0; k < 9; k++) {
        const d = Math.abs(p[t * 9 + k] - c.probs[t * 9 + k]);
        if (!(d <= maxd)) maxd = Number.isFinite(d) ? d : Infinity;
        if (p[t * 9 + k] > p[t * 9 + best]) best = k;
      }
      if (Array.isArray(c.argmax) && best !== c.argmax[t]) argBad++;
    }
    worst = Math.max(worst, maxd);
    if (!(maxd <= tol)) problems.push(`golden ${c.name}：最大機率差 ${maxd.toExponential(2)} 超過 ${tol}`);
    if (argBad) problems.push(`golden ${c.name}：${argBad} 幀的最高類別不同`);
  }
  return { problems, worst };
}

export async function validateEventModel(json, bin, { sha256 = sha256Hex } = {}) {
  const problems = [];
  const out = (extra = {}) => ({ ok: problems.length === 0, problems, meta: null, golden: 'absent', worst: null, ...extra });
  if (!json || typeof json !== 'object') { problems.push('模型說明檔（.json）不是有效的 JSON 物件'); return out(); }
  if (json.format !== TCN_FORMAT) problems.push(`模型格式應為 ${TCN_FORMAT}，實際是 ${String(json.format)}`);
  if (json.feature_version !== FEATURE_VERSION) problems.push(`模型的特徵版本 ${String(json.feature_version)} 和 App 的 ${FEATURE_VERSION} 不同`);
  const buf = toBuffer(bin);
  if (!(buf instanceof ArrayBuffer)) { problems.push('權重檔（.bin）讀取失敗'); return out(); }
  if (buf.byteLength !== json.bin_bytes) problems.push(`權重檔大小 ${buf.byteLength} B 和說明檔記錄的 ${String(json.bin_bytes)} B 不同`);
  let hex = null;
  try { hex = await sha256(buf); } catch (e) { problems.push(`無法計算 SHA-256：${e.message}`); }
  if (hex && hex !== json.sha256) problems.push(`權重檔 SHA-256 不符（${hex.slice(0, 12)}… ≠ 說明檔 ${String(json.sha256).slice(0, 12)}…）`);
  if (problems.length) return out({ sha256: hex });
  let tcn;
  try {
    tcn = loadTcn(json, buf);
  } catch (e) {
    problems.push(`模型結構檢查失敗（張量形狀或大小）：${e.message}`);
    return out({ sha256: hex });
  }
  let golden = 'absent';
  let worst = null;
  if (json.golden) {
    const g = goldenProblems(tcn, json.golden);
    worst = g.worst;
    golden = g.problems.length ? 'fail' : 'pass';
    problems.push(...g.problems);
  }
  return out({ meta: tcn.meta, golden, worst, sha256: hex });
}

export async function activeEventModel(repo) {
  return repo ? (await repo.models.get('active')) ?? null : null;
}

export async function previousEventModel(repo) {
  return repo ? (await repo.models.get('previous')) ?? null : null;
}

/** Store an accepted model as 'active'; the former active one (or the builtin marker) becomes 'previous'. */
export async function importEventModel(repo, { json, bin, check, imported_at, file_names = [] }) {
  if (!check?.ok) throw new Error('模型沒有通過檢查，不能匯入');
  const cur = await activeEventModel(repo);
  const prev = cur ? { ...cur, slot: 'previous' } : { slot: 'previous', source: 'builtin', imported_at };
  const rec = {
    slot: 'active', source: 'imported', version: String(json.version ?? ''), sha256: check.sha256 ?? json.sha256,
    feature_version: json.feature_version, n_params: json.n_params ?? null, imported_at, file_names,
    golden: check.golden, json, bin: toBuffer(bin),
  };
  await repo.batch([{ op: 'put', store: 'models', record: prev }, { op: 'put', store: 'models', record: rec }]);
  return rec;
}

export async function rollbackEventModel(repo) {
  const prev = await previousEventModel(repo);
  if (!prev) return { ok: false, active: await activeEventModel(repo), message: '沒有可以回復的上一個模型' };
  const cur = await activeEventModel(repo);
  if (prev.source === 'builtin') {
    await repo.batch([
      { op: 'delete', store: 'models', id: 'active' },
      cur ? { op: 'put', store: 'models', record: { ...cur, slot: 'previous' } } : { op: 'delete', store: 'models', id: 'previous' },
    ]);
    return { ok: true, active: null, message: '已回復為內建設定（內建模型；沒有內建模型時用規則式）' };
  }
  const ops = [{ op: 'put', store: 'models', record: { ...prev, slot: 'active' } }];
  ops.push(cur ? { op: 'put', store: 'models', record: { ...cur, slot: 'previous' } } : { op: 'put', store: 'models', record: { slot: 'previous', source: 'builtin', imported_at: prev.imported_at } });
  await repo.batch(ops);
  return { ok: true, active: { ...prev, slot: 'active' }, message: `已回復為 ${prev.version || '上一個模型'}` };
}

/** Whether this build ships the bundled event model (build.mjs --no-bundled-model leaves it out). */
export async function bundledModelAvailable(fetchFn = globalThis.fetch) {
  if (typeof fetchFn !== 'function') return false;
  try {
    const r = await fetchFn('precache-manifest.json', { cache: 'no-store' });
    if (r.ok) {
      const m = await r.json();
      const urls = [...(m.shell ?? []).map((e) => e.url ?? e), ...(m.assets ?? []).map((a) => a.url)];
      return urls.includes(BUNDLED_MODEL.json) && urls.includes(BUNDLED_MODEL.bin);
    }
  } catch (_) { /* no manifest (dev server on app/): ask for the file itself */ }
  try {
    const r = await fetchFn(BUNDLED_MODEL.json);
    return Boolean(r.ok);
  } catch (_) {
    return false;
  }
}

export function modelStatusText({ active = null, previous = null, bundled = false } = {}) {
  const now = active
    ? `使用匯入的事件模型 ${active.version || ''}（${String(active.imported_at ?? '').slice(0, 10)} 匯入，SHA-256 ${String(active.sha256 ?? '').slice(0, 12)}…）`
    : bundled ? '使用內建事件模型 event-tcn-v1' : `沒有內建事件模型：事件偵測用規則式；${NO_MODEL_HINT}（.json＋.bin）`;
  const back = previous ? (previous.source === 'builtin' ? `可回復為內建設定${bundled ? '（內建模型）' : '（規則式）'}` : `可回復為 ${previous.version || '上一個模型'}`) : '沒有可回復的上一個模型';
  return `${now}。${back}。`;
}
