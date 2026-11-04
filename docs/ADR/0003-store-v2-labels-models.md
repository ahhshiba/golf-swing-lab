# ADR 0003: Store schema v2 — `labels` (P14) and `models` (P9)

Status: accepted (2026-11-04). Owner: flows (store additive change). Files: `app/src/store/core.js`,
`app/src/store/labels.js`, `app/src/store/export.js`.

## Decision

`SCHEMA_VERSION` 1 → 2 with two new, empty stores and a no-op data migration (`MIGRATIONS[0] = { version: 2 }`):

| Store | Key | Index | Record |
|---|---|---|---|
| `labels` | `shot_id` | `labelled_at` | `{ shot_id, events: { 8 × { frame, t_s } }, labelled_at, source: 'owner', revision, fps }` |
| `models` | `slot` (`active` / `previous`) | `imported_at` | imported event model json + bin bytes, or `{ slot: 'previous', source: 'builtin' }` |

Both backends create missing stores before `migrate()` runs and never delete one, so every v1 record stays readable
(unit test `v1 -> v2 upgrade`). An older app opening a v2 database is refused with VERSION_NEWER (unchanged rule).

Labels travel in the JSON export only with `includeLabels` (UI checkbox 「包含標註」, on by default); import validates
each one (`validateLabel`) and merges by `revision` like shots; one bad label rejects the whole file. A label never
changes its shot: the detector's own events stay in the shot (and its P6 history) so `scripts/eval_owner_set.mjs` can
score them. Models are never exported (they are device-local and possibly CC BY-NC).
