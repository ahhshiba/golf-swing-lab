# golf-swing-lab

Offline golf swing and ball-flight analysis, built as a static PWA (add to the iPhone home screen, works in
airplane mode). One phone, one camera angle at a time (face-on, down-the-line, high-behind). It reports pose,
tempo, club-head speed, ball speed, launch angle and carry; every number carries a confidence interval, and a
value that cannot be measured is shown as an honest null with a reason code. Personal practice use, no backend,
no account, data stays on the phone.

## Product

**Golf Swing Lab** (揮桿實驗室) is for an amateur practising alone at a range bay with a phone on a tripod.

- **Local only.** No account, no server, no analytics. After the first visit the app makes no network requests;
  videos and results stay in the browser storage of the phone. See [docs/PRIVACY.md](docs/PRIVACY.md).
- **Languages and units.** Traditional Chinese (default) and English; distance yd or m, speed mph, m/s or km/h,
  body cm or in, height cm or ft/in (Settings › Units, Settings › Language).
- **Honest numbers.** Estimates for practice, not a certified launch monitor: every number has a ± range and a
  confidence tag, unmeasurable numbers show — with the reason, carry is a model (spin and wind not measured).
- **Swing phases** are detected by rules. Nothing derived from GolfDB ships in the product; an owner can import a
  model trained on their own labelled swings (Settings › Developer options, revealed by tapping the version in
  About 7 times).
- **Your data.** Settings › Storage & backup (usage, protect from deletion, clean up old videos), History › Back up,
  Settings › Privacy › Delete all data.
- **Support.** [GitHub issues](https://github.com/ahhshiba/golf-swing-lab/issues) (a plain link; the app sends
  nothing). Licences of shipped components: [docs/LICENCES.md](docs/LICENCES.md).

## Development

The product spec is [docs/CAFCR.md](docs/CAFCR.md) (Traditional Chinese). The module contract that parallel
work is built against is [docs/interfaces.md](docs/interfaces.md). Read it before touching any module.

## Layout

```
app/        the PWA: index.html, manifest, sw.template.js, styles/, icons/, models/, vendor/, src/<module>/
schema/     shot-v1.schema.json (golf-shot/1 result contract)
scripts/    verify.sh (single verification entry), devserve.py, build/check/vendor scripts (*.mjs)
tests/      unit/*.test.mjs (node:test), synth/ (synthetic data generators), e2e/, fixtures/
training/   offline training of the swing-event model (Python, separate venv, not on the critical path)
docs/       CAFCR.md, interfaces.md, setup-guide.md, device-checklist.md, ADR/
deploy/     last-deploy.json (written by scripts/deploy_pages.sh on the first deploy)
dist/       build output (gitignored)
```

Plain ES modules, no bundler, no runtime npm dependencies. Node 18.19+ is the only toolchain requirement.

## From a fresh clone

Third-party binaries (MediaPipe Tasks Vision, its wasm, the pose models, mp4box.js) are not committed. Fetch
them once; versions and sha256 are pinned in `app/vendor/manifest.json`:

```
node scripts/vendor.mjs --fetch    # downloads into app/vendor/ and app/models/, then verifies sha256
npm install                        # Playwright 1.49.1, only needed for the browser-e2e stage
```

The swing-event model (`app/models/event-tcn-v1.*`) is trained on GolfDB (CC BY-NC) and is not in this
repository. Without it the app uses the rule-based event detector, and the model tests and the `model-parity`
stage report SKIP with that reason. To rebuild it, follow [docs/training.md](docs/training.md) (needs the GolfDB
code at `training/vendor/golfdb`, see `training/vendor/README.md`, and its videos).

## Verify

```
bash scripts/verify.sh                      # every stage; exit code = number of FAIL stages
bash scripts/verify.sh --only unit,static   # selected stages only (reported as a partial run)
bash scripts/verify.sh --list               # stage names
RUN_BROWSER_E2E=1 RUN_TRAINING=1 bash scripts/verify.sh   # also the opt-in stages
```

Stages, in order: `env`, `static`, `unit`, `contract`, `model-parity`, `synthetic-calib`, `synthetic-e2e`,
`build`, `sw-version`, `browser-e2e` (opt-in), `training` (opt-in). A stage whose script does not exist yet is
printed as `SKIP <name> (reason)` and listed in the summary. A run with any SKIP, or with `--only`, ends with
"NOT a full verification" so a partial run never looks green. `npm run verify` and `npm test` are shortcuts.

## Dev server

```
node scripts/build.mjs --dev
python3 scripts/devserve.py --bind 127.0.0.1 --port 8796 --root dist --prefix /golf-swing-lab/
```

Serves `dist/` under `/golf-swing-lab/` the way GitHub Pages does (404 outside the prefix, redirect from the
prefix without a trailing slash, correct MIME for `.wasm` `.task` `.webmanifest`, `no-cache` for `sw.js` and
`index.html`, no directory listing). It refuses to bind `0.0.0.0` or `::` unless `--allow-all` is given.
Phone testing over Tailscale is described in CAFCR section R4 (port 9443 only, never 443).

## Docs for the owner

- [docs/setup-guide.md](docs/setup-guide.md): tripod purchase spec, first-visit venue measurements, per-angle
  setup, the C0-C10 setup steps with timings (Traditional Chinese).
- [docs/device-checklist.md](docs/device-checklist.md): every UNVERIFIED item, the milestone that measures it,
  and a blank column for the measured value.

## Licences and data

- This repository is for personal practice use.
- GolfDB (training code, data and annotations) is CC BY-NC 4.0: personal, non-commercial use only. Neither the
  GolfDB code and videos nor anything derived from them (keypoints, trained weights) is in this repository.
  Whether trained weights ship with the public site is an open owner decision (CAFCR owner decision 1;
  `docs/ADR/0002-event-model-licence.md`); `scripts/deploy_pages.sh` leaves them out by default.
- MediaPipe Tasks Vision is Apache-2.0; mp4box.js is BSD-3-Clause. Both are served from `app/vendor/` with
  pinned versions and sha256 (no CDN at runtime). The vendored tasks-vision bundle sends usage logs to Google;
  `app/src/pose/landmarker.js` blocks every cross-origin fetch before MediaPipe loads.
- No Ultralytics (AGPL) and no OpenCV.js.
