"""Train the event TCN on GolfDB (train on the 3 other splits, early-stop on a val subset carved from them).

    ~/.local/share/golf-swing-lab-venv/bin/python -I training/train_tcn.py --split 1 [--run NAME] [options]

Never looks at the test split: `--split N` removes every clip with split == N before anything else; the val set is
carved from the remaining clips grouped by YouTube video (dataset.carve_val). All model choices use the val PCE.
Writes training/runs/<run>/split<N>/{best.pt, history.json, config.json} (training/runs/ is git-ignored).
"""
from __future__ import annotations

import os

os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")

import argparse  # noqa: E402
import json  # noqa: E402
import math  # noqa: E402
import random  # noqa: E402
import sys  # noqa: E402
import time  # noqa: E402
from pathlib import Path  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402
import torch  # noqa: E402

import dataset as D  # noqa: E402
from features import FEATURE_NAMES, FEATURE_VERSION  # noqa: E402
from model import EventTCN, evaluate_ids, n_params, normalise  # noqa: E402
from pce import pce_table  # noqa: E402

RUNS = Path(__file__).resolve().parent / "runs"

DEFAULTS = dict(
    seed=20261104, val_seed=20261104, epochs=300, patience=50, batch=16, lr=2e-3, weight_decay=1e-4, ch=64, k=5,
    dilations=[1, 3, 9, 27], dropout=0.1, bg_weight=8 / 35, sigma=0.0, stretch_lo=0.8, stretch_hi=1.25,
    p_stretch=0.8, noise=0.0015, p_noise=0.5, drop=0.05, p_drop=0.3, p_lite=0.3, p_crop=0.7, val_frac=0.12,
    eval_every=2,
)


def set_seed(seed: int):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False
    torch.use_deterministic_algorithms(True, warn_only=True)


def norm_stats(ids):
    xs = [D.build_example(i)["x"] for i in ids]
    x = np.concatenate([e for e in xs if e is not None]).astype(np.float64)
    x = x[np.all(np.isfinite(x), axis=1)]
    mean = x.mean(axis=0)
    std = x.std(axis=0)
    std = np.where(std > 1e-6, std, 1.0)
    return mean, std


def soft_targets(K: int, ev_idx, sigma: float):
    """(K, 9) targets: one Gaussian bump (peak 1, truncated at 3 sigma) per event, background = rest."""
    y = np.zeros((K, 9), dtype=np.float32)
    ks = np.arange(K)
    for e, k in enumerate(ev_idx):
        if sigma <= 0:
            y[k, e] = 1.0
        else:
            g = np.exp(-0.5 * ((ks - k) / sigma) ** 2)
            g[np.abs(ks - k) > 3 * sigma] = 0
            y[:, e] = np.maximum(y[:, e], g)
    s = y[:, :8].sum(axis=1)
    over = s > 1
    y[over, :8] /= s[over, None]
    y[:, 8] = np.clip(1 - y[:, :8].sum(axis=1), 0, 1)
    return y


def sample_example(cid, cfg, rng):
    kind = "lite" if rng.random() < cfg["p_lite"] else "full"
    st = 1.0
    if rng.random() < cfg["p_stretch"]:
        st = float(math.exp(rng.uniform(math.log(cfg["stretch_lo"]), math.log(cfg["stretch_hi"]))))
    noise = cfg["noise"] if rng.random() < cfg["p_noise"] else 0.0
    drop = cfg["drop"] if rng.random() < cfg["p_drop"] else 0.0
    ex = D.build_example(cid, kind, stretch=st, noise=noise, rng=rng, drop=drop)
    if ex is None:
        return None
    K = len(ex["x"])
    ev = ex["ev_idx"]
    k0, k1 = 0, K
    if rng.random() < cfg["p_crop"]:
        k0 = int(rng.integers(0, ev[0] + 1))
        k1 = int(rng.integers(min(K, ev[7] + 1), K + 1))
        k1 = max(k1, ev[7] + 1)
    x = ex["x"][k0:k1]
    y = soft_targets(K, ev, cfg["sigma"])[k0:k1]
    return x, y


def make_batch(items, mean, std, device):
    L = max(len(x) for x, _ in items)
    B = len(items)
    X = np.zeros((B, len(FEATURE_NAMES), L), np.float32)
    Y = np.zeros((B, 9, L), np.float32)
    M = np.zeros((B, L), np.float32)
    for b, (x, y) in enumerate(items):
        n = len(x)
        X[b, :, :n] = normalise(x, mean, std).T
        Y[b, :, :n] = y.T
        M[b, :n] = 1
    return (torch.from_numpy(X).to(device), torch.from_numpy(Y).to(device), torch.from_numpy(M).to(device))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--split", type=int, required=True, choices=[1, 2, 3, 4])
    ap.add_argument("--run", default="v1")
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    ap.add_argument("--quiet", action="store_true")
    for k, v in DEFAULTS.items():
        if isinstance(v, list):
            ap.add_argument(f"--{k}", type=int, nargs="+", default=v)
        else:
            ap.add_argument(f"--{k}", type=type(v), default=v)
    args = ap.parse_args(argv)
    cfg = {k: getattr(args, k) for k in DEFAULTS}
    set_seed(cfg["seed"])
    out = RUNS / args.run / f"split{args.split}"
    out.mkdir(parents=True, exist_ok=True)

    train_all, test_ids = D.split_ids(args.split)
    tr_ids, val_ids = D.carve_val(train_all, cfg["val_frac"], cfg["val_seed"])
    assert not set(tr_ids) & set(test_ids) and not set(val_ids) & set(test_ids)
    mean, std = norm_stats(tr_ids)
    dev = torch.device(args.device)
    model = EventTCN(ch=cfg["ch"], k=cfg["k"], dilations=cfg["dilations"], dropout=cfg["dropout"]).to(dev)
    opt = torch.optim.AdamW(model.parameters(), lr=cfg["lr"], weight_decay=cfg["weight_decay"])
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=cfg["epochs"], eta_min=cfg["lr"] * 0.02)
    w = torch.tensor([1.0] * 8 + [cfg["bg_weight"]], device=dev)
    rng = np.random.default_rng(cfg["seed"])
    info = {"split": args.split, "run": args.run, "feature_version": FEATURE_VERSION, "n_params": n_params(model),
            "n_train": len(tr_ids), "n_val": len(val_ids), "n_test_excluded": len(test_ids), "config": cfg}
    (out / "config.json").write_text(json.dumps(info, indent=1))
    if not args.quiet:
        print(f"split {args.split}: train {len(tr_ids)} val {len(val_ids)} (test {len(test_ids)} untouched), "
              f"params {n_params(model)}, device {dev}", flush=True)

    best = (-1.0, math.inf)
    best_ep, hist, t0 = -1, [], time.time()
    for ep in range(cfg["epochs"]):
        model.train()
        order = rng.permutation(len(tr_ids))
        tot, nb = 0.0, 0
        for b0 in range(0, len(order), cfg["batch"]):
            items = [sample_example(tr_ids[j], cfg, rng) for j in order[b0:b0 + cfg["batch"]]]
            items = [it for it in items if it is not None]
            X, Y, M = make_batch(items, mean, std, dev)
            logp = torch.log_softmax(model(X, M), dim=1)
            loss = -((Y * logp) * w[None, :, None]).sum(dim=1)
            loss = (loss * M).sum() / M.sum()
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            opt.step()
            tot += loss.item()
            nb += 1
        sched.step()
        rec = {"epoch": ep, "loss": tot / max(nb, 1)}
        if ep % cfg["eval_every"] == 0 or ep == cfg["epochs"] - 1:
            rows = evaluate_ids(model, val_ids, mean, std, dev)
            tab = pce_table([r["correct"] for r in rows])
            rec.update(val_pce=tab["overall"], val_excl=tab["excl_address_finish"],
                       val_impact=tab["per_event"]["impact"], val_top=tab["per_event"]["top"])
            key = (tab["overall"], -rec["loss"])
            if key[0] > best[0] or (key[0] == best[0] and rec["loss"] < best[1]):
                best, best_ep = (tab["overall"], rec["loss"]), ep
                torch.save({"state_dict": model.state_dict(), "mean": mean, "std": std, "info": info,
                            "epoch": ep, "val": tab}, out / "best.pt")
            if not args.quiet:
                print(f"ep {ep:3d} loss {rec['loss']:.4f} val PCE {tab['overall']:.3f} excl {rec['val_excl']:.3f} "
                      f"imp {rec['val_impact']:.3f} top {rec['val_top']:.3f} best {best[0]:.3f}@{best_ep} "
                      f"{time.time() - t0:.0f}s", flush=True)
            if ep - best_ep >= cfg["patience"]:
                break
        hist.append(rec)
    (out / "history.json").write_text(json.dumps({"best_epoch": best_ep, "best_val_pce": best[0],
                                                  "wall_s": time.time() - t0, "history": hist}, indent=1))
    print(f"split {args.split} done: best val PCE {best[0]:.4f} at epoch {best_ep}, {time.time() - t0:.0f}s, "
          f"checkpoint {out / 'best.pt'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
