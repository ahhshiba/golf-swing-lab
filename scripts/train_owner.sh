#!/usr/bin/env bash
# scripts/train_owner.sh — train an event model on the owner's own labelled swings (PRODUCT-SPEC §7.4).
#
#   bash scripts/train_owner.sh [--dry-run] [--init scratch|synth] [--run NAME] [--out-dir DIR] LABELS.json [MORE.json ...]
#
# Steps (all local; GolfDB data and weights are never read):
#   1. --init synth: training/synth_pretrain.py -> <out>/synth.pt (synthetic swings only)
#   2. training/train_owner.py -> <out>/event-tcn-owner-<date>.{json,bin} (+ embedded golden, model card skeleton)
#   3. training/node/owner_card.mjs -> the card's owner holdout metrics and gate (the app's own JS inference)
#   4. scripts/check_model_card.mjs --card <json> -> golfdb:false, holdout metrics, golden reproduced <= 1e-4
# --dry-run: a few epochs on CPU, synthetic pre-training on 12 swings (pipeline check; RUN_TRAINING=1 verify stage).
# Output: training/runs/<run>/ (git-ignored) unless --out-dir. Import the .json + .bin in Settings › Developer.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 70
GSL_PY=${GSL_PY:-$HOME/.local/share/golf-swing-lab-venv/bin/python}
DRY=0; INIT=synth; RUN=""; OUT=""; LABELS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1; shift ;;
    --init) INIT=$2; shift 2 ;;
    --run) RUN=$2; shift 2 ;;
    --out-dir) OUT=$2; shift 2 ;;
    -h|--help) sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "train_owner.sh: unknown option $1" >&2; exit 64 ;;
    *) LABELS+=("$1"); shift ;;
  esac
done
[ "${#LABELS[@]}" -gt 0 ] || { echo "train_owner.sh: give at least one golf-swing-lab-labels/1 file" >&2; exit 64; }
[ -x "$GSL_PY" ] || { echo "train_owner.sh: training venv python not found: $GSL_PY (see training/requirements.in)" >&2; exit 69; }
case "$INIT" in scratch|synth) ;; *) echo "train_owner.sh: --init must be scratch or synth" >&2; exit 64 ;; esac
DATE=$(date -u +%Y%m%d)
[ -n "$RUN" ] || RUN="owner-$DATE$([ "$DRY" -eq 1 ] && echo -dryrun)"
[ -n "$OUT" ] || OUT="training/runs/$RUN"
mkdir -p "$OUT"
DRYARG=(); [ "$DRY" -eq 1 ] && DRYARG=(--dry-run)
INITARG=(--init scratch)
if [ "$INIT" = synth ]; then
  "$GSL_PY" -I training/synth_pretrain.py --out "$OUT/synth.pt" "${DRYARG[@]}"
  INITARG=(--init "$OUT/synth.pt")
fi
"$GSL_PY" -I training/train_owner.py --labels "${LABELS[@]}" --run "$RUN" --out-dir "$OUT" --date "$DATE" "${INITARG[@]}" "${DRYARG[@]}"
MODEL="$OUT/event-tcn-owner-$DATE.json"
node training/node/owner_card.mjs --model "$MODEL" --labels "${LABELS[@]}"
node scripts/check_model_card.mjs --card "$MODEL"
echo "train_owner.sh: done -> $MODEL (+ .bin)"
