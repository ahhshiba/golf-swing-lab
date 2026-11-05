# ADR 0004: Nothing GolfDB-derived ships; rules by default, owner-trained models only

Status: accepted (2026-11-05, owner decision 2026-11-04). Supersedes the "default build bundles the model" part of
ADR 0002 (its import / rollback mechanism stays). Owner: events (PRODUCT-SPEC §7, WP-E).

## Context

The event TCN `event-tcn-v1` was trained on GolfDB (McNally et al. 2019, CC BY-NC 4.0). It beat the rules on GolfDB
split 1 (0.795 vs 0.426 PCE), but the product must be sellable later, so non-commercial data, weights trained on it
and thresholds tuned on it cannot be in the product. Before this decision the product path used GolfDB in three
places: `pipeline/clip.js` gated the TCN per view on GolfDB split-1 results, the worker fetched
`models/event-tcn-v1.*` by default, and About credited GolfDB with a non-commercial note.

## Decision

1. **Rules by default.** Shipped builds detect events with `events/rules.js` (+ the slow-motion time-scale search,
   `events/timescale.js`). No event model is bundled, fetched or named in shipped code; a unit test
   (`tests/unit/events.no_golfdb.test.mjs`) fails on any GolfDB / split-1 / `event-tcn-v1` reference under `app/`.
2. **Tuning data.** Rule thresholds and the confidence calibration are fitted on the synthetic generator
   (`tests/synth/swing.js`, "synthetic-v2") and the owner's tune split. GolfDB numbers may be printed by research
   scripts (`RESEARCH=1`, outputs in the git-ignored `training/runs/`) but no test that gates a ship reads them and
   no constant is chosen from them.
3. **Owner models only.** A TCN may be imported (Settings › Developer) only with a model card
   (`gsl-model-card/1`): `golfdb: false`, `training_data` ⊆ `["owner", "synthetic"]`, owner-set holdout metrics.
   It is initialised from scratch or from a synthetic-only pre-training (`training/synth_pretrain.py`), never from
   GolfDB weights. `pipeline/clip.js` uses it only when its card's holdout gate (§7.3) passed and the card covers the
   view (high_behind only when listed); otherwise the rules. Checked by `session/models.js`, `events/card.js` and
   `scripts/check_model_card.mjs`.
4. **Research only.** The GolfDB pipeline (`training/train_tcn.py`, `eval_pce.py`, `export.py`) and the local
   `app/models/event-tcn-v1.*` (git-ignored) stay as a dev benchmark. A dev build that includes them is marked
   `dev_research` and cannot be deployed (build / deploy scripts, foundation package).

## Consequences

- The shipped event accuracy is the rules' accuracy until the owner has labelled enough swings: on the dev-only
  GolfDB benchmark the rules are clearly worse than the TCN (address and finish especially). The synthetic stress
  suite and the owner holdout are the ship gates instead.
- Confidence badges are calibrated on synthetic data plus the owner tune split; until real owner labels exist they
  describe synthetic behaviour (documented in `docs/training.md`).
- About / Licences no longer mention GolfDB (trust package).
