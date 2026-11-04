# ADR 0001: Vendor browser runtime dependencies, pinned and verified

Status: accepted (2026-11-04). Owner: vendor. Files: `scripts/vendor.mjs`, `app/vendor/manifest.json`,
`app/vendor/`, `app/models/`.

## Context

The PWA must work fully offline (KD5) and must not fetch anything from a CDN at runtime. Results must be
reproducible: the pose model, the MediaPipe runtime that executes it, and the MP4 demuxer all change the
numbers the user sees. Node is 18.19 (no Vite), so there is no bundler and no `node_modules` in the browser
path: every runtime dependency is a plain file served from our own origin.

## Decision

Vendor three things as files in the repo tree, each pinned by exact version and verified by sha256 + byte
count recorded in `app/vendor/manifest.json` (schema `gsl-vendor/1`):

| Name | Version | Licence | Source | Files |
|---|---|---|---|---|
| @mediapipe/tasks-vision | 1.2.2 | Apache-2.0 | npm tarball (sha512 SRI pinned) | `app/vendor/mediapipe/` |
| pose_landmarker_{lite,full,heavy}.task | float16/1 | Apache-2.0 (model card) | storage.googleapis.com, versioned path | `app/models/` |
| mp4box | 2.4.1 | BSD-3-Clause | npm tarball (sha512 SRI pinned) | `app/vendor/mp4box/` |

`scripts/vendor.mjs` (Node 18, no dependencies, https only, temp file + rename, verify before write):

- `--check` every manifest file exists with the right bytes and sha256; exit 1 and list problems otherwise. Files
  under the vendor dirs that the manifest does not list only produce a `WARN`.
- `--fetch` download/extract files that are missing, then `--check`. A file that exists but is wrong is never
  overwritten silently (`--check` reports it); `--fetch --force` re-fetches it.
- `--list` name / version / size totals.
- `--pin` maintainer mode that fills `null` sha256/bytes/integrity fields (see "How to update").
- `--root DIR` runs against another tree (used to test `--fetch` in an empty directory).

Writes are confined to `app/vendor/` and `app/models/`; manifest paths with `..`, absolute paths, other prefixes
and non-https URLs are rejected.

## What exactly is vendored

### @mediapipe/tasks-vision 1.2.2 (Apache-2.0)

| File | Bytes |
|---|---|
| `vision_bundle.mjs` (ESM entry; exports `PoseLandmarker`, `FilesetResolver`, `DrawingUtils`, ...) | 156,062 |
| `wasm/vision_wasm_internal.js` + `.wasm` (classic worker / page loader) | 334,128 + 14,603,354 |
| `wasm/vision_wasm_module_internal.js` + `.wasm` (ES-module worker loader) | 334,166 + 14,603,372 |
| `LICENSE` | 12,331 |

- Version 1.2.2 has only these two wasm variants. There are no `nosimd` or `_nogl` files any more; the older
  0.10.x layout does not apply.
- `FilesetResolver.forVisionTasks(basePath, useModule = false)` picks the file names. `useModule = true` selects
  `vision_wasm_module_internal.*`. The loader tries `importScripts()` and, when that throws `TypeError` (module
  workers), falls back to `import()`, which needs the module variant (it ends in `export default`). Rule: ES-module
  worker -> `forVisionTasks(base, true)`; classic worker or main thread -> default.
- **Only one variant needs to be precached.** Each is 14.6 MB; both together would blow the 35 MB precache budget
  (see below). The app shell owner chooses one (module variant if `vision.worker.js` is a module worker) and the
  build must leave the other out of the precache list. Both are vendored so the choice stays open and both are
  integrity-checked. That the module variant works in Safari 17 is not tested here.
- The npm package ships **no LICENSE file**. `LICENSE` is fetched from the upstream repository at the tag
  `v1.2.2` (`raw.githubusercontent.com/google-ai-edge/mediapipe/v1.2.2/LICENSE`; the Apache-2.0 text plus
  third-party notices). `package.json` declares Apache-2.0.
- Not vendored: `vision_bundle.cjs`, `vision_bundle.js`, `*.map` (391 KB each), `vision.d.ts`, `README.md`,
  `package.json`. Nothing at runtime needs them.
- Observed in the bundle (static reading only, not run in a browser): a usage logger is created with every task.
  It collects latency statistics, an OS class from the user agent and the version string, and sends them with
  `fetch()` POST to `https://odml.pa.googleapis.com/v1/log` every 60 s and on `close()`. Offline the fetch fails
  and the logger stops. This is the only absolute URL in the bundle. For a privacy-minded offline app, the app
  shell should set a CSP with `connect-src 'self' blob: data:` and the e2e test should assert that no request
  leaves the origin. The vendored file is not patched (it would no longer match the upstream hash).

### Pose models, `float16/1` (Apache-2.0)

URL pattern: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_<size>/float16/1/pose_landmarker_<size>.task`

| Model | Bytes | Decimal MB | CAFCR said |
|---|---|---|---|
| lite | 5,777,746 | 5.78 | 5.8 |
| full | 9,398,198 | 9.40 | 9.4 |
| heavy | 30,664,242 | 30.66 | 30.7 |

Model card: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf
("LICENSED UNDER Apache License, Version 2.0"). The manifest also records the GCS generation, last-modified date
and md5 that the server reported; the downloaded files were checked against those md5 values independently of
sha256.

Versioned path, never `latest`: for `full`, `float16/latest` returns a different file than `float16/1` (same length,
9,398,198 bytes, first difference at byte 13, sha256 `4eaa5eb7...` vs `5134a3aa...`), so "latest" is not stable
and would silently change measurements. The training environment (`mediapipe` 1.2.2 in the venv, CAFCR R2) should
load these same `.task` files (same sha256) so features used to train the event TCN match the web runtime.

### mp4box 2.4.1 (BSD-3-Clause)

| File | Bytes |
|---|---|
| `mp4box.all.mjs` (entry) | 91,813 |
| `styp-9TIZZDLN.mjs` (shared chunk, imported by relative path) | 236,007 |
| `rolldown-runtime-w6R9maHv.mjs` (tiny helper, imported by relative path) | 377 |
| `LICENSE` | 1,534 |

- The 2.x line ships a native ES module build, so no UMD wrapper or `importScripts` shim is needed:
  `import { createFile, MP4BoxBuffer } from '../../vendor/mp4box/mp4box.all.mjs'` works in a module worker, and
  was import-tested in Node 18. The three `.mjs` files must stay in one directory. The chunk file names contain a
  content hash; they change when the version changes, and the manifest is the source of truth.
- The 2.x API is not the 0.5.x API of most tutorials (`createFile()` and `MP4BoxBuffer.fromArrayBuffer(buf,
  fileStart)` instead of setting `buffer.fileStart`). The import/ owner should read the vendored source or
  `dist/*.d.mts` of the npm package rather than old examples.
- Version choice: the rule is "newest release published at least 14 days before 2026-11-04". `npm view mp4box
  time` gives 2.5.0 on 2026-10-25 (10 days, too new) and 2.4.1 on 2026-06-19, so 2.4.1.
- The code uses class static blocks and `#private` fields (Safari 16.4 / 15), fine for iOS 17+. No `Object.groupBy`,
  `Promise.withResolvers` or other 17.4-only features were found by grep.
- Not vendored: `.cjs`, `*.map`, `mp4box.simple.*`, type declarations.

## Why pinned

1. Reproducibility: pose output depends on model bytes and runtime version together; both are fixed.
2. Parity with training: CAFCR R2 trains the event TCN on keypoints from `mediapipe` 1.2.2; the web runtime must
   be the same generation.
3. Integrity: sha256 + size per file, sha512 SRI per npm tarball. `scripts/verify.sh` is meant to run `--check` (env stage), so a truncated
   download, a bad merge or a replaced file fails the build.
4. Offline: nothing is resolved at runtime; `--fetch` is a development-time step only.
5. Supply-chain caution for npm: wait 14 days before adopting a release. **Exception to flag:** tasks-vision
   1.2.2 was published to npm on 2026-11-03 (one day before this ADR) because the plan fixes that exact version for
   training parity. Its tarball is pinned by SRI, but it has not had the cooling-off period.

## Sizes (decimal MB, from `--list`)

| Group | Bytes | MB |
|---|---|---|
| @mediapipe/tasks-vision (both wasm variants) | 30,043,413 | 30.04 |
| lite + full + heavy models | 45,840,186 | 45.84 |
| mp4box | 329,731 | 0.33 |
| **Total vendored** | **76,213,330** | **76.21** |

Precache estimate (excluding the app shell, which build limits to 1 MB):

| Scenario | Bytes | MB |
|---|---|---|
| lite + full + one wasm variant + bundle + mp4box + licences | 30,611,606 | 30.61 |
| the same with both wasm variants | 45,549,088 | 45.55 (over the 35 MB budget) |
| the first row plus heavy | 61,275,848 | 61.28 (heavy must be fetched on demand into `gsl-assets`) |

The first row plus a shell under 1 MB matches CAFCR's "about 31 MB, at most 35 MB". Differences from the CAFCR
numbers: none for lite/full/heavy/wasm sizes (the plan used decimal MB); the only surprise is that there are two
wasm variants, not one.

## Repository weight (decision for the owner)

The vendored files total 76 MB. `.gitignore` currently does not exclude them, and this ADR does not change it
(not vendor's file). Options: (a) commit them (simple; every version bump adds another copy to history; the
largest file, 30.7 MB, is under GitHub's 50 MB warning); (b) git-ignore the binaries (`app/models/`, `*.wasm`) and
have `deploy_pages.sh` and fresh clones run `node scripts/vendor.mjs --fetch` first. Either way the manifest
stays in git.

## How to update a dependency

1. Pick the new version (npm: newest with a publish time at least 14 days old; models: a new versioned path).
2. In `app/vendor/manifest.json` change `version`, `source`, `npm.tarball` / `url` and, for npm entries, the
   `tar_path` values (chunk names can change); set `sha256`, `bytes` and `npm.integrity` of everything that
   changes to `null`; delete the old files.
3. `node scripts/vendor.mjs --pin` downloads, checks the tarball against the registry's own `dist.integrity`,
   writes the files and fills in the hashes. `--pin` is trust-on-first-use, so cross-check once by hand:
   `npm pack <pkg>@<ver>` in an empty temp directory and compare `sha512-` of the tarball with `npm.integrity`;
   for models compare `openssl dgst -md5 -binary | base64` with the `x-goog-hash: md5` header.
4. `node scripts/vendor.mjs --check` -> 0, `node scripts/vendor.mjs --list`, then update the tables in this ADR.
5. Run `scripts/verify.sh`. For a MediaPipe or model change also re-run model parity, re-extract keypoints, retrain
   and re-evaluate the event TCN, and bump the app version so `sw.js` re-caches.
6. Check licences: keep the `LICENSE` files next to the code and mention both in the app's About page.

## Verification (2026-11-04)

- `node scripts/vendor.mjs --check` -> exit 0, 13 files, 76,213,330 bytes.
- Appending one byte to a vendored file -> exit 1 naming it; restoring -> exit 0.
- `--fetch --root <empty dir>` reproduced all 13 files byte for byte; a second run downloads nothing.
- A wrong manifest sha256 or a wrong npm integrity makes `--fetch` refuse to write the file(s).
- Cross-check: files extracted from `npm pack` (tar) are byte-identical to the ones `--pin` wrote, and both
  tarball sha512 values equal the registry's.
- `import('./app/vendor/mediapipe/vision_bundle.mjs')` in Node 18 gives `PoseLandmarker` and `FilesetResolver` as
  functions; `mp4box.all.mjs` gives `createFile` and `MP4BoxBuffer` as functions.
