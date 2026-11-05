# Licences of shipped components

Owner: package F (trust). Shown in the app at Settings › About › Open-source licences (`app/src/ui/licences.js`,
catalog `licence`). The full texts are the LICENSE files shipped with the app and read locally; nothing is
fetched from the network. Versions and checksums are pinned in `app/vendor/manifest.json`.

| component | version | used for | licence | full text in the app |
|---|---|---|---|---|
| MediaPipe Tasks Vision (Google LLC) | 1.2.2 | pose detection (vision bundle + wasm) | Apache-2.0 | `vendor/mediapipe/LICENSE` |
| MediaPipe Pose Landmarker models lite / full / heavy | float16/1 | pose detection models | Apache-2.0 (same notice) | `vendor/mediapipe/LICENSE` |
| mp4box.js (Telecom Paris / GPAC) | 2.4.1 | reading MP4 / MOV files | BSD-3-Clause | `vendor/mp4box/LICENSE` |
| Icon sprite (`app/src/ui/icons.js`) | — | interface icons, drawn in the Lucide line style | ISC (Lucide Contributors), credited | embedded in `licences.js` |

Not shipped:

- **No GolfDB-derived file.** The research event model `models/event-tcn-v1.*` (trained on GolfDB, CC BY-NC 4.0)
  is left out of the default build (`scripts/build.mjs`; `--include-golfdb-model` is a dev-only research switch that
  `deploy_pages.sh` refuses). The product detects swing phases with rules; the About screen says so and carries no
  GolfDB or non-commercial wording (gate `f-about`).
- No OpenCV.js, no Ultralytics, no CDN, no web fonts.

When a vendored component is added or upgraded: update `app/vendor/manifest.json`, ship its LICENSE file under
`app/vendor/<name>/`, add a row to `LICENCES` in `app/src/ui/licences.js` with catalog keys
`licence.<id>.{name,what,licence}` in both locales, and add a row here. Gate `f-about` checks that the Apache-2.0 and
BSD-3-Clause texts render.
