"""Pre-train the event TCN on synthetic swings only (PRODUCT-SPEC §7.4; never GolfDB data or weights).

    ~/.local/share/golf-swing-lab-venv/bin/python -I training/synth_pretrain.py --out training/runs/<run>/synth.pt
        [--n 240] [--epochs 60] [--dry-run]

Swings: training/node/synth_train_set.mjs (tests/synth/swing.js stressSwing, evfeat-1 from the app's own JS).
The checkpoint holds the state dict, the normalisation and a provenance block (training_data: ["synthetic"]).
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402
import torch  # noqa: E402

from features import FEATURE_VERSION  # noqa: E402
from model import EventTCN, n_params  # noqa: E402
from train_owner import fit, set_seed, stats  # noqa: E402

TRAINING = Path(__file__).resolve().parent
ROOT = TRAINING.parent


def synth_examples(n: int, seed0: int = 1000):
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node not on PATH")
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "synth.json"
        r = subprocess.run([node, str(TRAINING / "node" / "synth_train_set.mjs"), str(out), "--n", str(n), "--seed0", str(seed0)],
                           cwd=ROOT, capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(r.stderr)
        d = json.loads(out.read_text())
    assert d["feature_version"] == FEATURE_VERSION and d["golfdb"] is False
    exs = []
    for s in d["swings"]:
        x = np.array([np.nan if v is None else v for v in s["features"]], dtype=np.float32).reshape(s["K"], s["F"])
        t_grid = s["t0"] + np.arange(s["K"]) / 30.0
        ev = np.clip(np.round((np.array(s["t_events"]) - t_grid[0]) * 30.0).astype(np.int64), 0, s["K"] - 1)
        exs.append({"id": f"synth-{s['seed']}", "x": x, "ev_idx": ev, "t_grid": t_grid, "view": s["view"]})
    return exs


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--n", type=int, default=240)
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--seed", type=int, default=20261105)
    ap.add_argument("--dry-run", action="store_true", help="12 swings, 2 epochs, CPU (pipeline check only)")
    args = ap.parse_args(argv)
    if args.dry_run:
        args.n, args.epochs = 12, 2
    set_seed(args.seed)
    exs = synth_examples(args.n)
    mean, std = stats(exs)
    model = EventTCN(ch=64, k=5, dilations=[1, 3, 9, 27], dropout=0.1)
    hist = fit(model, exs, mean, std, epochs=args.epochs, seed=args.seed, device="cpu" if args.dry_run else None)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": model.state_dict(), "mean": mean, "std": std,
                "provenance": {"training_data": ["synthetic"], "golfdb": False, "n_swings": len(exs),
                               "generator": "tests/synth/swing.js stressSwing (synthetic-v2)", "epochs": args.epochs},
                "history": hist}, out)
    print(f"synthetic pre-train: {len(exs)} swings, {args.epochs} epochs, {n_params(model)} params -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
