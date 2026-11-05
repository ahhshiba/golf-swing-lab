// session/models.js — CAFCR P9 event-model replacement and rollback (PRODUCT-SPEC §7.1, §7.4).
//
// The shipped app detects events with the rules. The owner may import an event model they trained on their own
// labelled swings (training/train_owner.py; docs/training.md). An import is accepted only if:
//   * json.format is gsl-event-tcn/1 and json.feature_version is the app's FEATURE_VERSION;
//   * sha256(bin) equals json.sha256 and bin.byteLength equals json.bin_bytes;
//   * every tensor exists with the shape the architecture needs (events/tcn.js loadTcn throws otherwise);
//   * the model card (json.model_card) has golfdb: false (no third-party research data), lists its training_data and carries the owner-set holdout
//     metrics (owner_holdout) — a research build ({ research: true }) skips the card check;
//   * when the json carries a golden (`json.golden.cases`), the JS inference reproduces it: max |dprob| <= 1e-4 and
//     identical per-frame argmax.
// Accepted models live in the `models` store in two slots:
//   'active'   { slot, source: 'imported', version, sha256, feature_version, n_params, imported_at, file_names, golden, card, json, bin }
//   'previous' the model that was active before the last import, or { slot, source: 'builtin' } (= the rules).
// rollbackEventModel() swaps the two slots (a second tap rolls forward again); rolling back to 'builtin' deletes both.
// A research build (precache-manifest.dev_research = true, a dev-only build option) may also bundle a
// research model; the shipped build never does (bundledModelAvailable() -> false).
//
// Messages are { code, params } (catalog namespace `model`, app/i18n/<locale>/model.json); *Text() helpers render
// them with the active locale.
//
//   GOLDEN_TOL, CARD_SCHEMA, MODEL_CODES
//   sha256Hex(bytes, subtle?) -> Promise<hex>
//   goldenProblems(tcn, golden, tol?) -> { problems: {code, params}[], worst }      (pure)
//   cardProblems(json, { research }) -> {code, params}[]                              (pure)
//   ownerGatePassed(card) -> boolean                                                  (pure)
//   validateEventModel(json, bin, { sha256, research }) -> Promise<{ ok, problems, meta, golden, worst, card }>
//   importEventModel(repo, { json, bin, check, imported_at, file_names }) -> Promise<record>
//   rollbackEventModel(repo) -> Promise<{ ok, active, code, params, message }>
//   activeEventModel(repo) / previousEventModel(repo) -> Promise<record|null>
//   researchModelUrls(manifest) -> { json, bin } | null                               (pure)
//   bundledModelAvailable(fetchFn) -> Promise<boolean>
//   modelStatus({ active, previous, bundled }) -> {code, params}[]                     (pure)
//   modelStatusText(...) -> string        problemText(p) -> string

import { loadTcn, TCN_FORMAT } from '../events/tcn.js';
import { FEATURE_VERSION } from '../events/features.js';
import { t } from '../i18n/index.js';
import { ownerGatePassed } from '../events/card.js';

export { ownerGatePassed };

export const GOLDEN_TOL = 1e-4;
export const CARD_SCHEMA = 'gsl-model-card/1';
/** Catalog key of the import hint (kept for callers of the former Chinese constant). */
export const NO_MODEL_HINT = 'model.hint.import';
export const MODEL_CODES = Object.freeze([
  'model.error.no_crypto', 'model.error.json', 'model.error.format', 'model.error.feature_version', 'model.error.bin',
  'model.error.bin_size', 'model.error.hash', 'model.error.digest', 'model.error.shape', 'model.error.not_checked',
  'model.error.golden_empty', 'model.error.golden_infer', 'model.error.golden_len', 'model.error.golden_diff',
  'model.error.golden_argmax', 'model.error.card_missing', 'model.error.card_third_party', 'model.error.card_training',
  'model.error.card_holdout', 'model.status.imported', 'model.status.research', 'model.status.rules',
  'model.status.back_builtin', 'model.status.back_version', 'model.status.no_back', 'model.rollback.none',
  'model.rollback.builtin', 'model.rollback.version', 'model.gate.passed', 'model.gate.not_passed',
]);

const p = (code, params = {}) => ({ code, params });
const toBuffer = (b) => (ArrayBuffer.isView(b) ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b);

/** A rendered problem / status line in the active locale. */
export function problemText(m) { return m && m.code ? t(m.code, m.params ?? {}) : String(m); }

export async function sha256Hex(bytes, subtle = globalThis.crypto?.subtle) {
  if (!subtle) throw Object.assign(new Error('model.error.no_crypto'), { code: 'model.error.no_crypto' });
  const d = new Uint8Array(await subtle.digest('SHA-256', toBuffer(bytes)));
  return Array.from(d, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Golden reproduction check of a loaded TCN. golden = { cases: [{ name, K, F, features, probs, argmax }] }. */
export function goldenProblems(tcn, golden, tol = GOLDEN_TOL) {
  const problems = [];
  let worst = 0;
  const cases = Array.isArray(golden?.cases) ? golden.cases : [];
  if (!cases.length) problems.push(p('model.error.golden_empty'));
  for (const c of cases) {
    let pr;
    try {
      pr = tcn.predict({ K: c.K, F: c.F, data: Float64Array.from(c.features) });
    } catch (e) {
      problems.push(p('model.error.golden_infer', { name: c.name, detail: e.message }));
      continue;
    }
    if (pr.length !== c.K * 9 || !Array.isArray(c.probs) || c.probs.length !== c.K * 9) { problems.push(p('model.error.golden_len', { name: c.name })); continue; }
    let maxd = 0;
    let argBad = 0;
    for (let k = 0; k < c.K; k++) {
      let best = 0;
      for (let j = 0; j < 9; j++) {
        const d = Math.abs(pr[k * 9 + j] - c.probs[k * 9 + j]);
        if (!(d <= maxd)) maxd = Number.isFinite(d) ? d : Infinity;
        if (pr[k * 9 + j] > pr[k * 9 + best]) best = j;
      }
      if (Array.isArray(c.argmax) && best !== c.argmax[k]) argBad++;
    }
    worst = Math.max(worst, maxd);
    if (!(maxd <= tol)) problems.push(p('model.error.golden_diff', { name: c.name, diff: maxd.toExponential(2), tol }));
    if (argBad) problems.push(p('model.error.golden_argmax', { name: c.name, n: argBad }));
  }
  return { problems, worst };
}


/** Model card problems (§7.4): no third-party research data (card field below), training data listed, owner holdout metrics present. */
export function cardProblems(json, { research = false } = {}) {
  if (research) return [];
  const c = json?.model_card;
  if (!c || typeof c !== 'object' || c.schema !== CARD_SCHEMA) return [p('model.error.card_missing')];
  const out = [];
  if (c.golfdb !== false) out.push(p('model.error.card_third_party'));
  const td = Array.isArray(c.training_data) ? c.training_data : [];
  if (!td.length || td.some((s) => !['owner', 'synthetic'].includes(s))) out.push(p('model.error.card_training'));
  const h = c.owner_holdout;
  if (!h || !(h.n >= 1) || !Number.isFinite(h.impact_within_1_rate)) out.push(p('model.error.card_holdout'));
  return out;
}

export async function validateEventModel(json, bin, { sha256 = sha256Hex, research = false } = {}) {
  const problems = [];
  const out = (extra = {}) => ({ ok: problems.length === 0, problems, meta: null, golden: 'absent', worst: null, card: json?.model_card ?? null, ...extra });
  if (!json || typeof json !== 'object') { problems.push(p('model.error.json')); return out({ card: null }); }
  if (json.format !== TCN_FORMAT) problems.push(p('model.error.format', { want: TCN_FORMAT, got: String(json.format) }));
  if (json.feature_version !== FEATURE_VERSION) problems.push(p('model.error.feature_version', { got: String(json.feature_version), want: FEATURE_VERSION }));
  problems.push(...cardProblems(json, { research }));
  const buf = toBuffer(bin);
  if (!(buf instanceof ArrayBuffer)) { problems.push(p('model.error.bin')); return out(); }
  if (buf.byteLength !== json.bin_bytes) problems.push(p('model.error.bin_size', { got: buf.byteLength, want: String(json.bin_bytes) }));
  let hex = null;
  try { hex = await sha256(buf); } catch (e) { problems.push(p('model.error.digest', { detail: e.message })); }
  if (hex && hex !== json.sha256) problems.push(p('model.error.hash', { got: hex.slice(0, 12), want: String(json.sha256).slice(0, 12) }));
  if (problems.length) return out({ sha256: hex });
  let tcn;
  try {
    tcn = loadTcn(json, buf);
  } catch (e) {
    problems.push(p('model.error.shape', { detail: e.message }));
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
  if (!check?.ok) throw Object.assign(new Error('model.error.not_checked'), { code: 'model.error.not_checked' });
  const cur = await activeEventModel(repo);
  const prev = cur ? { ...cur, slot: 'previous' } : { slot: 'previous', source: 'builtin', imported_at };
  const rec = {
    slot: 'active', source: 'imported', version: String(json.version ?? ''), sha256: check.sha256 ?? json.sha256,
    feature_version: json.feature_version, n_params: json.n_params ?? null, imported_at, file_names,
    golden: check.golden, card: json.model_card ?? null, json, bin: toBuffer(bin),
  };
  await repo.batch([{ op: 'put', store: 'models', record: prev }, { op: 'put', store: 'models', record: rec }]);
  return rec;
}

const withText = (r) => Object.defineProperty(r, 'message', { get() { return t(r.code, r.params); }, enumerable: true });

export async function rollbackEventModel(repo) {
  const prev = await previousEventModel(repo);
  if (!prev) return withText({ ok: false, active: await activeEventModel(repo), code: 'model.rollback.none', params: {} });
  const cur = await activeEventModel(repo);
  if (prev.source === 'builtin') {
    await repo.batch([
      { op: 'delete', store: 'models', id: 'active' },
      cur ? { op: 'put', store: 'models', record: { ...cur, slot: 'previous' } } : { op: 'delete', store: 'models', id: 'previous' },
    ]);
    return withText({ ok: true, active: null, code: 'model.rollback.builtin', params: {} });
  }
  const ops = [{ op: 'put', store: 'models', record: { ...prev, slot: 'active' } }];
  ops.push(cur ? { op: 'put', store: 'models', record: { ...cur, slot: 'previous' } } : { op: 'put', store: 'models', record: { slot: 'previous', source: 'builtin', imported_at: prev.imported_at } });
  await repo.batch(ops);
  return withText({ ok: true, active: { ...prev, slot: 'active' }, code: 'model.rollback.version', params: { version: prev.version || '' } });
}

/** The research event model of a dev_research build manifest ({ json, bin } scope-relative URLs) or null. */
export function researchModelUrls(manifest) {
  // dev_research: the dev-only research build (PRODUCT-SPEC §7.1); bundled_event_model: the older build flag
  if (!manifest || (manifest.dev_research !== true && manifest.bundled_event_model !== true)) return null;
  const urls = [...(manifest.shell ?? []).map((e) => e.url ?? e), ...(manifest.assets ?? []).map((a) => a.url ?? a)];
  const json = urls.find((u) => /^models\/event-tcn-[\w.-]+\.json$/.test(u));
  if (!json) return null;
  const bin = json.replace(/\.json$/, '.bin');
  return urls.includes(bin) ? { json, bin } : null;
}

/** Whether this build bundles a (research-only) event model. Shipped builds: false. Never fetches a model file. */
export async function bundledModelAvailable(fetchFn = globalThis.fetch) {
  if (typeof fetchFn !== 'function') return false;
  try {
    const r = await fetchFn('precache-manifest.json', { cache: 'no-store' });
    if (!r.ok) return false;
    return researchModelUrls(await r.json()) !== null;
  } catch (_) {
    return false;
  }
}

/** Status lines as { code, params }: what detects events now, and what a rollback would return to. */
export function modelStatus({ active = null, previous = null, bundled = false } = {}) {
  const out = [];
  if (active) {
    out.push(p('model.status.imported', { version: active.version || '', date: String(active.imported_at ?? '').slice(0, 10) }));
    out.push(p(ownerGatePassed(active.card ?? active.json?.model_card) ? 'model.gate.passed' : 'model.gate.not_passed'));
  } else if (bundled) out.push(p('model.status.research'));
  else out.push(p('model.status.rules'));
  if (previous) out.push(previous.source === 'builtin' ? p('model.status.back_builtin') : p('model.status.back_version', { version: previous.version || '' }));
  else out.push(p('model.status.no_back'));
  return out;
}

export function modelStatusText(o = {}) {
  return modelStatus(o).map(problemText).join(' ');
}
