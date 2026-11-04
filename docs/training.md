# Event TCN training (CAFCR K9 / R2 / P13 / P9)

A small temporal convolutional network that labels GolfDB's 8 swing events from MediaPipe pose keypoints, trained
offline on GolfDB and run in plain JS in the app (`app/src/events/tcn.js`). The rule-based detector
(`app/src/events/rules.js`) stays the default; K9 says the TCN may only replace it where it wins, and on GolfDB
split 1 it wins by 0.37 PCE.

## Results (GolfDB, PCE with the GolfDB tolerance, ordered decode)

Split 1 (350 test clips; the model was trained on splits 2–4 and early-stopped on a validation subset carved from them):

| event | TCN | rules |
|---|---|---|
| address | 0.380 | 0.094 |
| toe_up | 0.786 | 0.320 |
| mid_backswing | 0.891 | 0.489 |
| top | **0.946** | 0.651 |
| mid_downswing | 0.980 | 0.726 |
| impact | **0.983** | 0.649 |
| mid_follow_through | 0.971 | 0.371 |
| finish | 0.426 | 0.106 |
| **overall** | **0.795** | 0.426 |
| **excl. Address/Finish** | **0.926** | 0.534 |

For reference, the SwingNet paper (images, not pose) reports 0.761 overall, 0.918 excl. Address/Finish, 0.984
impact, 0.839 top (the numbers quoted in CAFCR R2).

M3 gates (R2 / R6 M3): overall 0.795 ≥ 0.70 PASS · excl. Address/Finish 0.926 ≥ 0.88 PASS · Impact 0.983 ≥ 0.95
PASS · Top 0.946 ≥ 0.80 PASS · beats rules by 0.370 ≥ 0.05 PASS. With per-class argmax instead of the ordered decode
(this is how GolfDB's eval.py picks frames) the numbers are the same to 3 decimals.

4-fold (same recipe, trained without each split and tested on it; TCN / rules):

| metric | split 1 | split 2 | split 3 | split 4 | mean |
|---|---|---|---|---|---|
| overall | 0.795 / 0.426 | 0.786 / 0.409 | 0.752 / 0.418 | 0.783 / 0.444 | **0.779 / 0.424** |
| excl. Address/Finish | 0.926 / 0.534 | 0.914 / 0.506 | 0.886 / 0.524 | 0.921 / 0.560 | **0.912 / 0.531** |
| impact | 0.983 / 0.649 | 0.986 / 0.603 | 0.960 / 0.629 | 0.983 / 0.683 | **0.978 / 0.641** |
| top | 0.946 / 0.651 | 0.926 / 0.634 | 0.863 / 0.583 | 0.926 / 0.631 | **0.915 / 0.625** |
| address | 0.380 / 0.094 | 0.377 / 0.086 | 0.329 / 0.089 | 0.351 / 0.083 | 0.359 / 0.088 |
| finish | 0.426 / 0.106 | 0.426 / 0.154 | 0.374 / 0.114 | 0.386 / 0.109 | 0.403 / 0.121 |

Split 3 is the weakest fold (excl. Address/Finish 0.886, just above 0.88; top 0.863); the gates are defined on
split 1 only.

Split 1 breakdown (TCN overall / rules overall; impact in brackets): slow-motion clips (n = 159) 0.782 / 0.318
(0.981 / 0.352); real-time clips (n = 191) 0.806 / 0.516 (0.984 / 0.895); face-on 0.797 / 0.409; down-the-line
0.817 / 0.463; other 0.756 / 0.384. The rules use real-time constants (speeds in torso lengths per second, still
time ≥ 0.7 s), so GolfDB's slow-motion broadcast replays break them; on real-time clips the rules' impact is 0.895.
The TCN still leads by 0.29 there.

Honesty log: seven candidates were trained (v1, c1–c6); the final one was picked by **validation PCE only**. Exactly
one candidate (c5) was ever scored on split 1 (`training/runs/split1_evaluations.jsonl` lists every split-1
evaluation; the repeated rows are the same checkpoint run again by `--folds` and by the acceptance run).

| run | change from v1 | val PCE |
|---|---|---|
| v1 | dilations 1/2/4/8, Gaussian labels σ = 1 frame (two left-handed clips mislabelled right, fixed afterwards) | 0.784 |
| c1 | v1 + handedness fix | 0.774 |
| c2 | c1 + hard labels (σ = 0) | 0.780 |
| c3 | c1 + dilations 1/3/9/27 | 0.807 |
| c4 | c1 + dilations 1/4/16/32 | 0.809 |
| **c5** | c3 + hard labels | **0.810** |
| c6 | c3, other seed | 0.792 |

c3 vs c6 (same recipe, different seed) shows ±0.015 seed noise; the larger receptive field (5.4 s instead of 2 s) is
the only change that stood out.

## Model

`training/model.py` `EventTCN`: input = evfeat-1 (12 features, 30 Hz grid, `docs/metrics-by-view.md` §7) normalised
with the training-set mean / std (non-finite → 0). Conv1d 12→64, then 3 residual Conv1d 64→64
(`h = h + relu(conv(h))`), kernel 5, dilations 1, 3, 9, 27, centred zero padding (`d·(k−1)/2`, the clip is analysed
after the swing), ReLU, dropout 0.1, 1×1 head → 9 logits (0–7 = GolfDB events, 8 = background), softmax.
66,121 parameters, receptive field 161 frames (5.4 s). Decoding: `decodeOrdered` (detect.js; Python port in
`training/pce.py`, tested equal on `training/tests/fixtures/decode-ordered.json`).

Recipe (`training/train_tcn.py` defaults): AdamW lr 2e-3, weight decay 1e-4, cosine to 2 % over 300 epochs,
batch 16, grad clip 5; weighted cross-entropy with event weight 1 and background weight 8/35 (SwingNet's
1/8 : 1/35); hard labels (one grid frame per event); augmentation: time stretch ×0.8–1.25 log-uniform (p 0.8),
landmark noise σ = 0.0015 of the frame (p 0.5), 5 % frame drop (p 0.3), lite-model keypoints instead of full
(p 0.3), random crop that keeps address..finish (p 0.7); val = 12 % of the training clips grouped by YouTube video
(seed 20261104), checkpoint = best val PCE (evaluated every 2 epochs), patience 50. Seeds fixed and
`torch.use_deterministic_algorithms`: two runs give bit-identical weights.

Mirror augmentation is not used: mirroring the frame (x → 1 − x, left/right landmarks swapped, as MediaPipe would
label a mirrored video) and flipping the handedness gives exactly the same canonical features (test
`test_mirror_with_handedness_swap_is_identity`), so it adds nothing.

## Data decisions

- **Input = PoseSeq-equivalent.** The keypoint cache (`training/cache/keypoints/{full,lite}/<id>.npz`,
  MediaPipe 1.2.2) already stores `img` as `x_norm, y_norm, z, visibility`; W = H = 160 and `t_s` = frame / 29.97.
  Undetected frames (all-NaN rows, 0.14 % of frames) are **dropped**, as the app's pose worker emits no row
  without a detection; the 30 Hz resampling interpolates over the gap. The full model is the default; lite is an
  augmentation.
- **Labels.** Event e of clip id = annotation `events[e+1] − events[0]` (clip frame); its time `t_s[frame]` is put
  on the nearest 30 Hz grid index. Predictions go back the other way: grid time → nearest original frame
  (`nearestIndex`), and PCE is computed on the original frame grid with GolfDB's `correct_preds` tolerance
  `max(round((impact − address) / 30), 1)` frames (`np.round`, so 2.5 → 2).
- **Id 677** (split 3) is the only clip with impact (168) after mid_follow_through (167). GolfDB's `correct_preds`
  compares event i with the i-th *sorted* labelled frame, so its evaluation already treats this clip as
  impact = 167, MFT = 168. We use that same sorted definition for the training labels (kept, not excluded), so the
  training target equals what is scored. It only matters in fold 3.
- **Handedness.** GolfDB has no handedness column. Left-handed clips are found by player: Bubba Watson, Phil
  Mickelson, Mike Weir, Greg Chalmers, Ted Potter Jr, Tim Wilkinson (37 clips; one name in the pickle has a trailing
  space). A pose check (wrist x displacement address → top, image coordinates) is positive for all 37 and negative
  for 1290 of the other 1363; of the remaining 73, 47 are the "other" view (camera behind or at an angle, where the
  check does not apply), 23 face-on / down-the-line clips of right-handed players and 3 undetected. They are
  canonicalised like the app (`handedness: 'left'`).
- **Splits.** GolfDB's own `split` column (350 clips each); `--split N` trains on the other three.
- **Rules baseline.** `training/node/run_rules.mjs` runs `rules.js detectEvents` in Node on exactly the same
  PoseSeqs (view: face-on → `face_on`, down-the-line and other → `dtl`; handedness as above, no audio). A missing
  event counts as wrong.

## Reproduce

All commands from the repository root with `PY=~/.local/share/golf-swing-lab-venv/bin/python` (always `-I`).
Prerequisites: `training/data` and the keypoint cache (see `training/data/README.md`, `training/extract_keypoints.py`;
about 33 min for the full model and 25 min for lite with 6 workers).

```
$PY -I training/train_tcn.py --split 1 --run c5          # ~17 min on an RTX 5060 Ti (3 runs in parallel), 300 epochs
$PY -I training/eval_pce.py --split 1 --run c5           # table + M3 gates; exit 0 = all gates pass (~30 s)
for s in 2 3 4; do $PY -I training/train_tcn.py --split $s --run c5; done   # ~6 min each
$PY -I training/eval_pce.py --folds --run c5             # 4-fold table
$PY -I training/export.py --run c5 --split 1             # app/models/event-tcn-v1.{bin,json}, golden, ONNX
node scripts/check_model_parity.mjs                      # JS vs torch golden
$PY -I -m pytest -q training/tests
```

(`--run c5` was trained with explicit `--dilations 1 3 9 27 --sigma 0`; those are now the defaults.)
Checkpoints, logs and the ONNX copy live in `training/runs/` (git-ignored).

## Exported files

- `app/models/event-tcn-v1.bin`: 264,484 bytes, little-endian float32, the tensors of `json.tensors` concatenated in
  order (`convs.0.weight [64,12,5]`, `convs.0.bias [64]`, …, `convs.3.*`, `head.weight [9,64,1]`, `head.bias [9]`),
  torch layout, `offset` in float32 elements.
- `app/models/event-tcn-v1.json`: format `gsl-event-tcn/1`, `feature_version: 'evfeat-1'`, feature names, classes,
  architecture, normalisation mean / std, tensor table, `bin_bytes`, `sha256`, training recipe and val score,
  split-1 and 4-fold results, licence note.
- `tests/fixtures/event-tcn-v1.golden.json`: 3 synthetic swings (face-on 60 fps right-handed with timestamp jitter,
  dtl 30 fps left-handed, face-on 60 fps with 15 % dropped frames; `training/node/synth_features.mjs`), their
  evfeat-1 features and the torch CPU probabilities. No GolfDB data is in the golden.
- `training/runs/c5/event-tcn-v1.onnx`: reference only (max |Δprob| vs torch 7e-7).

JS use: `loadTcn(json, arrayBuffer)` → `{ predict(features) -> Float32Array(K·9) }`, passed as
`detect(poseSeq, { useTcn: true, tcn })`. Parity (`scripts/check_model_parity.mjs`, verify.sh `model-parity`): worst
max |Δprob| 6.9e-7 (limit 1e-4), identical argmax on every frame, sha256 and feature version checked.

## Licence

GolfDB (McNally et al., CVPR-W 2019) is CC BY-NC 4.0: personal, non-commercial use only
(`training/vendor/golfdb/LICENSE-NOTICE.txt`). The weights are derived from it and carry the same restriction; the
json says so. Whether they may be served by the public site is the open CAFCR R2 question (alternative: import from
the phone's Files app).

## Known gaps

- **Domain gap.** GolfDB = broadcast clips of tour players, 160×160, ~29.97 fps, 45 % slow-motion replays, camera
  angles face-on / down-the-line / other. The app sees a selfie setup at 1080p, 30–240 fps, an amateur swing, and a
  high_behind view that GolfDB does not have (rules only there, R1). All split numbers above are in-domain.
- **Event definitions differ from the synthetic generator.** On `tests/synth/swing.js` swings the TCN finds impact
  (95–100 % within one 30 Hz frame), top (90 %) and the mid events well, but address (0–25 %), finish (10–15 %) and
  mid_follow_through (0 %) are off, while the rules (built on those swings) get 80–100 %. The synthetic generator
  defines address as motion start, finish as motion end and mid_follow_through as shaft horizontal; GolfDB's human
  annotations evidently place them differently, and the TCN learned GolfDB's placement. Which definition the owner
  wants is open until P14.
- Address and finish are the hard events for every method here (TCN 0.38 / 0.43, rules 0.09 / 0.11); the gate excludes them for this
  reason.
- The rules collapse on slow-motion clips; the rules-vs-TCN margin on real-time clips (0.29) is the fairer
  comparison.

## What the P14 owner labels add

20+ owner swings labelled frame by frame (CAFCR P14) give: (1) the first in-domain measurement (Impact ±1 frame at
60 Hz ≥ 90 %, M3 owner column), which decides per event whether the TCN or the rules are used; (2) fine-tuning data
(P9: fine-tune → golden ≤ 1e-4 → PCE must not regress → replace, the old model kept for rollback); (3) a fixed
event definition for address / finish that matches what the owner wants tempo measured from.
