# ADR 0002: The GolfDB-derived event model is a build option, and the owner can replace it

Status: accepted (2026-11-04) for the mechanism; **the publication decision is still open** (CAFCR R2).
Owner: flows (app-core). Files: `scripts/build.mjs` (`--no-bundled-model`), `scripts/deploy_pages.sh`,
`app/src/session/models.js`, `app/src/ui/settings.js`, `app/src/workers/vision.worker.js` (`set_model`),
`scripts/check_model_card.mjs`, `app/vendor/manifest.json` (entry `event-tcn-v1`, source `generated`).

## Context

`app/models/event-tcn-v1.{json,bin}` is trained on GolfDB (McNally et al. 2019, CC BY-NC 4.0). It beats the rules
by 0.37 PCE on GolfDB split 1 (M3, recorded in the json's `results.split1`), but whether its weights may ship on a
public GitHub Pages site is not decided. CAFCR P9 also needs a way to replace the model after fine-tuning on the
owner's own swings (P14) and to roll back if the new one is worse.

## Decision

1. **Build switch.** `node scripts/build.mjs --no-bundled-model` leaves `models/event-tcn-v1.*` out of `dist/`, the
   service-worker precache and `VERSION`; `precache-manifest.json` records `"bundled_event_model": false`.
   The default build is unchanged (model bundled). `scripts/deploy_pages.sh` builds with `--no-bundled-model` unless
   `--include-golfdb-model` is passed, so nothing GolfDB-derived is published by accident.
2. **No model = rules.** The worker fetches the bundled model on the first clip; when it is missing the fetch fails,
   `events.tcn = { loaded: false }` is recorded and the clip uses the rule-based detector. The settings screen says
   「沒有內建事件模型：事件偵測用規則式；可從檔案匯入事件模型」.
3. **Import (P9).** 設定 → 事件模型: pick `.json` + `.bin`; the app checks format, `feature_version`, byte size,
   `sha256(bin) == json.sha256`, every tensor shape (`events/tcn.js loadTcn`) and, if the json carries
   `golden: { cases }` (same format as `tests/fixtures/event-tcn-v1.golden.json`), reproduces it within 1e-4 with an
   identical argmax. Accepted models go to the `models` store (schema v2) slot `active`; the former one (or a
   `builtin` marker) moves to `previous`. 「回復上一個模型」 swaps the slots (a second tap rolls forward).
   The main thread sends `{ type: 'set_model', json, bin }` to the worker (`json: null` = back to the default).
   Not checked in the app: PCE on a test set (the "PCE 不退步" half of P9) — run `scripts/eval_owner_set.mjs` on the
   owner's labels and the training evaluation before importing.
4. **Recorded M3 result is a gate.** `scripts/check_model_card.mjs` (verify.sh stage model-parity) re-derives
   overall / excl. A-F / Impact / Top / beats-rules from the card's per-event numbers, compares them with fixed
   thresholds (0.70 / 0.88 / 0.95 / 0.80 / +0.05) and checks the bin's sha256, on every run.

## Consequences

- A public deploy without the model detects events with the rules (PCE ≈ 0.43 on split 1) until the owner imports a
  model on the phone; imported models stay on that device (IndexedDB) and are never exported.
- `deploy/last-deploy.json` records `bundled_event_model`; `scripts/check-sw.mjs` compares a later default build
  without the model files so it does not demand a bogus semver bump.
- Open: the owner's decision on publishing GolfDB-derived weights (and the attribution text on the 關於 screen if so).
