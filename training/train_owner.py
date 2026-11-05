"""Train the event TCN on the owner's own labelled swings (PRODUCT-SPEC §7.4) and export it for the app.

    ~/.local/share/golf-swing-lab-venv/bin/python -I training/train_owner.py --labels L.json [L2.json ...]
        --run NAME [--init scratch|PATH.pt] [--holdout-frac 0.5] [--epochs 200] [--date YYYYMMDD] [--dry-run]

Data: golf-swing-lab-labels/1 files (teach mode 匯出訓練集; format in docs/training.md). Features: training/features.py
(evfeat-1, bit-identical to the app). Split: session-wise (owner_data.split_sessions, the FNV-1a order of
scripts/eval_owner_set.mjs); the holdout sessions are never used for training or model choice. Initialisation:
from scratch, or from a checkpoint of training/synth_pretrain.py (synthetic swings only). GolfDB data and weights
are never read: --init refuses a checkpoint without provenance golfdb: false.
Writes training/runs/<run>/event-tcn-owner-<date>.{json,bin}: the gsl-event-tcn/1 model, an embedded golden (torch
probabilities of 3 synthetic feature sequences, for the app's import check) and a model card skeleton
(training_data, golfdb: false, split). training/node/owner_card.mjs then adds the owner holdout metrics (computed
with the app's own JS inference) and the gate; scripts/train_owner.sh runs all steps.
"""
from __future__ import annotations

import os

os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")

import argparse  # noqa: E402
import datetime as dt  # noqa: E402
import hashlib  # noqa: E402
import json  # noqa: E402
import math  # noqa: E402
import random  # noqa: E402
import shutil  # noqa: E402
import subprocess  # noqa: E402
import sys  # noqa: E402
import tempfile  # noqa: E402
from pathlib import Path  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402
import torch  # noqa: E402

from features import FEATURE_NAMES, FEATURE_VERSION  # noqa: E402
from model import EventTCN, n_params, normalise, predict_probs  # noqa: E402
from owner_data import EVENTS, example, load_labels, split_sessions  # noqa: E402

TRAINING = Path(__file__).resolve().parent
ROOT = TRAINING.parent
RUNS = TRAINING / "runs"
FORMAT = "gsl-event-tcn/1"
CARD_SCHEMA = "gsl-model-card/1"
LICENCE = "Trained only on the owner's own labelled swings and synthetic swings (no third-party data)."


def set_seed(seed: int):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False
    torch.use_deterministic_algorithms(True, warn_only=True)


def stats(exs):
    x = np.concatenate([e["x"] for e in exs]).astype(np.float64)
    x = x[np.all(np.isfinite(x), axis=1)]
    mean = x.mean(axis=0)
    std = x.std(axis=0)
    return mean, np.where(std > 1e-6, std, 1.0)


def targets(K: int, ev_idx):
    y = np.zeros((K, 9), dtype=np.float32)
    y[:, 8] = 1
    for e, k in enumerate(ev_idx):
        y[k, :] = 0
        y[k, e] = 1
    return y


def fit(model, exs, mean, std, epochs: int, seed: int, lr: float = 2e-3, batch: int = 8, device=None, noise: float = 0.01):
    dev = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
    model.to(dev)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    w = torch.tensor([1.0] * 8 + [8 / 35], device=dev)
    rng = np.random.default_rng(seed)
    hist = []
    for ep in range(epochs):
        model.train()
        order = rng.permutation(len(exs))
        tot, nb = 0.0, 0
        for b0 in range(0, len(order), batch):
            items = [exs[j] for j in order[b0:b0 + batch]]
            L = max(len(e["x"]) for e in items)
            X = np.zeros((len(items), len(FEATURE_NAMES), L), np.float32)
            Y = np.zeros((len(items), 9, L), np.float32)
            M = np.zeros((len(items), L), np.float32)
            for b, e in enumerate(items):
                n = len(e["x"])
                xn = normalise(e["x"], mean, std)
                if noise > 0:
                    xn = xn + rng.normal(0, noise, size=xn.shape).astype(np.float32)
                X[b, :, :n] = xn.T
                Y[b, :, :n] = targets(n, e["ev_idx"]).T
                M[b, :n] = 1
            Xt, Yt, Mt = (torch.from_numpy(a).to(dev) for a in (X, Y, M))
            logp = torch.log_softmax(model(Xt, Mt), dim=1)
            loss = -((Yt * logp) * w[None, :, None]).sum(dim=1)
            loss = (loss * Mt).sum() / Mt.sum()
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            opt.step()
            tot += loss.item()
            nb += 1
        hist.append({"epoch": ep, "loss": tot / max(nb, 1)})
    model.to("cpu")
    model.eval()
    return hist


def tensor_order(model):
    names = [f"convs.{i}.{p}" for i in range(len(model.convs)) for p in ("weight", "bias")]
    return names + ["head.weight", "head.bias"]


def write_bin(model, path: Path):
    sd = model.state_dict()
    specs, chunks, off = [], [], 0
    for name in tensor_order(model):
        a = sd[name].detach().cpu().numpy().astype("<f4")
        specs.append({"name": name, "shape": list(a.shape), "offset": off})
        chunks.append(np.ascontiguousarray(a).tobytes())
        off += a.size
    data = b"".join(chunks)
    path.write_bytes(data)
    return specs, data


def golden_cases(model, mean, std):
    """torch probabilities of the 3 synthetic golden feature sequences (training/node/synth_features.mjs)."""
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node not on PATH")
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "sf.json"
        r = subprocess.run([node, str(TRAINING / "node" / "synth_features.mjs"), str(out)], cwd=ROOT, capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(r.stderr)
        sf = json.loads(out.read_text())
    assert sf["feature_version"] == FEATURE_VERSION
    cases = []
    for c in sf["cases"]:
        x = np.asarray(c["features"], dtype=np.float64).reshape(c["K"], c["F"])
        p = predict_probs(model, normalise(x, mean, std))
        cases.append({"name": c["name"], "K": c["K"], "F": c["F"], "features": c["features"],
                      "probs": [float(v) for v in p.ravel()], "argmax": [int(v) for v in p.argmax(axis=1)]})
    return cases


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--labels", nargs="+", required=True)
    ap.add_argument("--run", required=True)
    ap.add_argument("--init", default="scratch", help="scratch, or a training/synth_pretrain.py checkpoint")
    ap.add_argument("--holdout-frac", type=float, default=0.5)
    ap.add_argument("--epochs", type=int, default=200)
    ap.add_argument("--seed", type=int, default=20261105)
    ap.add_argument("--date", default=dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d"))
    ap.add_argument("--out-dir", default=None, help="default training/runs/<run>")
    ap.add_argument("--dry-run", action="store_true", help="3 epochs on CPU (pipeline check only)")
    args = ap.parse_args(argv)
    if not (0 < args.holdout_frac < 1):
        ap.error("--holdout-frac must be in (0, 1)")
    if args.dry_run:
        args.epochs = 3
    set_seed(args.seed)
    swings = load_labels(args.labels)
    train_ids, hold_ids = split_sessions(swings, args.holdout_frac)
    by_id = {sw["shot_id"]: sw for sw in swings}
    train = [example(by_id[i]) for i in train_ids]
    if not train:
        print("train_owner: no training swings (need more than one session)", file=sys.stderr)
        return 2
    init = "scratch"
    training_data = ["owner"]
    model = EventTCN(ch=64, k=5, dilations=[1, 3, 9, 27], dropout=0.1)
    if args.init != "scratch":
        ck = torch.load(args.init, map_location="cpu", weights_only=False)
        prov = ck.get("provenance", {})
        if prov.get("golfdb") is not False or prov.get("training_data") != ["synthetic"]:
            print(f"train_owner: {args.init} is not a synthetic-only checkpoint (provenance {prov}); refusing", file=sys.stderr)
            return 2
        model.load_state_dict(ck["state_dict"])
        init = "synthetic-pretrain"
        training_data = ["owner", "synthetic"]
    mean, std = stats(train)
    hist = fit(model, train, mean, std, epochs=args.epochs, seed=args.seed, device="cpu" if args.dry_run else None)

    out_dir = Path(args.out_dir) if args.out_dir else RUNS / args.run
    out_dir.mkdir(parents=True, exist_ok=True)
    name = f"event-tcn-owner-{args.date}"
    bin_path, json_path = out_dir / f"{name}.bin", out_dir / f"{name}.json"
    specs, data = write_bin(model, bin_path)
    sha = hashlib.sha256(data).hexdigest()
    arch = {"in_ch": model.in_ch, "ch": model.ch, "k": model.k, "dilations": list(model.dilations),
            "n_classes": model.n_classes, "residual": "h_l = h_{l-1} + relu(conv_l(h_{l-1})) for l >= 1",
            "padding": "zeros, d*(k-1)/2 both sides", "activation": "relu", "output": "softmax over 9 classes per frame"}
    views = sorted({by_id[i].get("view") for i in hold_ids if by_id[i].get("view")})
    meta = {
        "format": FORMAT, "version": name, "feature_version": FEATURE_VERSION, "feature_names": list(FEATURE_NAMES),
        "feature_hz": 30, "classes": list(EVENTS) + ["background"], "background_class": 8, "arch": arch,
        "n_params": n_params(model),
        "norm": {"mean": [float(x) for x in mean], "std": [float(x) for x in std],
                 "rule": "z = (float32(x) - mean) / std in float32; non-finite z -> 0"},
        "tensors": specs, "bin": f"{name}.bin", "bin_bytes": len(data), "dtype": "float32", "endianness": "little",
        "sha256": sha,
        "training": {"run": args.run, "epochs": args.epochs, "seed": args.seed, "n_train": len(train),
                     "final_loss": hist[-1]["loss"] if hist else None, "script": "training/train_owner.py",
                     "dry_run": args.dry_run},
        "golden": {"tolerance_prob": 1e-4, "note": "torch CPU float32 softmax of the exported weights on 3 synthetic "
                   "feature sequences (training/node/synth_features.mjs)", "cases": golden_cases(model, mean, std)},
        "model_card": {
            "schema": CARD_SCHEMA, "training_data": training_data, "golfdb": False, "init": init,
            "labels_files": [{"name": Path(p).name, "sha256": sha256_file(Path(p))} for p in args.labels],
            "split": {"by": "session", "holdout_frac": args.holdout_frac, "train": train_ids, "holdout": hold_ids},
            "views": views, "owner_holdout": None, "dry_run": args.dry_run,
            "created_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        },
        "licence": LICENCE,
    }
    json_path.write_text(json.dumps(meta, indent=1) + "\n")
    print(f"train_owner: {len(train)} training / {len(hold_ids)} holdout swings, init {init}, {args.epochs} epochs "
          f"-> {json_path} + {bin_path.name} ({len(data)} B, sha256 {sha[:12]}…)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
