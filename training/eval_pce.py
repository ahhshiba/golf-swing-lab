"""GolfDB PCE of the event TCN and of the rule-based baseline on one split (default: split 1), and the M3 gates.

    ~/.local/share/golf-swing-lab-venv/bin/python -I training/eval_pce.py --split 1 [--run v1]
    ~/.local/share/golf-swing-lab-venv/bin/python -I training/eval_pce.py --folds [--run v1]   # 4-fold table

Both methods see the same input: the PoseSeq of each test clip (full-model keypoints, undetected frames dropped).
TCN: evfeat-1 -> normalise -> TCN -> ordered decode (detect.js decodeOrdered) -> grid times -> nearest original frame.
Rules: app/src/events/rules.js detectEvents through Node (training/node/run_rules.mjs) -> event t_s -> nearest
original frame. PCE: GolfDB util.correct_preds tolerance on the original frame grid (training/pce.py).
Every TCN evaluation on split 1 is appended to training/runs/split1_evaluations.jsonl (honesty log: the number of
candidates that were ever scored on split 1).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402

import dataset as D  # noqa: E402
from pce import EVENTS, check_gates, golfdb_correct, golfdb_labels, pce_table  # noqa: E402

TRAINING = Path(__file__).resolve().parent
ROOT = TRAINING.parent
RUNS = TRAINING / "runs"
EVAL_LOG = RUNS / "split1_evaluations.jsonl"


def rules_events(ids, model_kind: str = "full", workdir: Path | None = None):
    """Run rules.js on the PoseSeqs of `ids`. Returns {id: EventSet dict or None}."""
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node not on PATH")
    tmp = Path(tempfile.mkdtemp(prefix="gsl_rules_", dir=workdir))
    try:
        meta, chunks, off = [], [], 0
        for cid in ids:
            a = D.annotation(cid)
            t_s, img, W, H = D.pose_seq(D.load_clip(cid, model_kind))
            tb = np.ascontiguousarray(t_s, dtype="<f8").tobytes()
            ib = np.ascontiguousarray(img, dtype="<f4").tobytes()
            pad_t = (-len(tb)) % 8
            pad_i = (-len(ib)) % 8
            meta.append({"id": cid, "T": int(len(t_s)), "W": W, "H": H, "view": D.VIEW_MAP[a["view"]],
                         "handedness": D.handedness(a), "off_t": off, "off_img": off + len(tb) + pad_t})
            chunks += [tb, b"\0" * pad_t, ib, b"\0" * pad_i]
            off += len(tb) + pad_t + len(ib) + pad_i
        (tmp / "pack.json").write_text(json.dumps({"clips": meta}))
        (tmp / "pack.bin").write_bytes(b"".join(chunks))
        r = subprocess.run([node, str(TRAINING / "node" / "run_rules.mjs"), str(tmp / "pack.json"),
                            str(tmp / "pack.bin"), str(tmp / "out.json")], cwd=ROOT, capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"run_rules.mjs failed: {r.stderr[-2000:]}")
        res = json.loads((tmp / "out.json").read_text())["clips"]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return {c["id"]: c.get("events") for c in res}


def rules_rows(ids, model_kind="full"):
    evs = rules_events(ids, model_kind)
    rows = []
    for cid in ids:
        a = D.annotation(cid)
        clip = D.load_clip(cid, model_kind)
        labels = golfdb_labels(a["events"], len(clip["t_s"]))
        es = evs.get(cid)
        frames = np.full(8, -10 ** 6, dtype=np.int64)  # a missing event never counts as correct
        if es:
            for i, name in enumerate(EVENTS):
                t = es[name]["t_s"]
                if t is not None and math.isfinite(t):
                    frames[i] = D.js_nearest_index(clip["t_s"], t)
        _, deltas, tol, correct = golfdb_correct(frames, labels)
        rows.append({"id": cid, "frames": frames, "correct": correct, "tol": tol, "no_swing": not es or
                     es["impact"]["t_s"] is None})
    return rows


def load_checkpoint(path: Path, device="cpu"):
    import torch

    from model import EventTCN

    ck = torch.load(path, map_location=device, weights_only=False)
    cfg = ck["info"]["config"]
    m = EventTCN(ch=cfg["ch"], k=cfg["k"], dilations=cfg["dilations"], dropout=cfg["dropout"])
    m.load_state_dict(ck["state_dict"])
    m.eval()
    return m, np.asarray(ck["mean"]), np.asarray(ck["std"]), ck


def tcn_rows(run: str, split: int, device="cpu"):
    from model import evaluate_ids

    m, mean, std, ck = load_checkpoint(RUNS / run / f"split{split}" / "best.pt", device)
    _, test = D.split_ids(split)
    rows = evaluate_ids(m, test, mean, std, device, with_argmax=True)
    return rows, ck


def fmt_table(tcn: dict, rules: dict, tcn_argmax: dict | None = None) -> str:
    lines = [f"{'event':<20}{'TCN':>8}{'rules':>8}" + (f"{'TCN-argmax':>12}" if tcn_argmax else "")]
    for e in EVENTS:
        s = f"{e:<20}{tcn['per_event'][e]:>8.3f}{rules['per_event'][e]:>8.3f}"
        if tcn_argmax:
            s += f"{tcn_argmax['per_event'][e]:>12.3f}"
        lines.append(s)
    for k, lab in (("overall", "overall"), ("excl_address_finish", "excl Address/Finish")):
        s = f"{lab:<20}{tcn[k]:>8.3f}{rules[k]:>8.3f}"
        if tcn_argmax:
            s += f"{tcn_argmax[k]:>12.3f}"
        lines.append(s)
    return "\n".join(lines)


def evaluate_split(run: str, split: int, device="cpu", log: bool = True):
    rows, ck = tcn_rows(run, split, device)
    _, test = D.split_ids(split)
    rr = rules_rows(test)
    tcn = pce_table([r["correct"] for r in rows])
    tcn_am = pce_table([r["correct_argmax"] for r in rows])
    rules = pce_table([r["correct"] for r in rr])
    rules["no_swing_clips"] = int(sum(r["no_swing"] for r in rr))
    res = {"split": split, "run": run, "n": len(test), "tcn": tcn, "tcn_argmax": tcn_am, "rules": rules,
           "checkpoint_epoch": ck["epoch"], "val": ck["val"], "n_params": ck["info"]["n_params"],
           "config": ck["info"]["config"]}
    if log and split == 1:
        RUNS.mkdir(exist_ok=True)
        with EVAL_LOG.open("a") as f:
            f.write(json.dumps({"utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "run": run,
                                "overall": tcn["overall"]}) + "\n")
    return res


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--split", type=int, default=1, choices=[1, 2, 3, 4])
    ap.add_argument("--run", default="v1")
    ap.add_argument("--folds", action="store_true", help="evaluate split1..4 checkpoints and print the mean")
    ap.add_argument("--rules-only", action="store_true")
    ap.add_argument("--device", default="cpu")
    args = ap.parse_args(argv)

    if args.rules_only:
        _, test = D.split_ids(args.split)
        rules = pce_table([r["correct"] for r in rules_rows(test)])
        print(json.dumps(rules, indent=1))
        return 0

    if args.folds:
        res = [evaluate_split(args.run, s, args.device) for s in (1, 2, 3, 4)]
        keys = ["overall", "excl_address_finish"] + [f"per_event.{e}" for e in EVENTS]

        def get(t, k):
            return t[k] if "." not in k else t["per_event"][k.split(".")[1]]

        print(f"{'metric':<30}" + "".join(f"{'s' + str(s):>14}" for s in (1, 2, 3, 4)) + f"{'mean':>14}")
        for k in keys:
            vals = [(get(r["tcn"], k), get(r["rules"], k)) for r in res]
            print(f"{k:<30}" + "".join(f"{a:>7.3f}/{b:<6.3f}" for a, b in vals) +
                  f"{np.mean([a for a, _ in vals]):>7.3f}/{np.mean([b for _, b in vals]):<6.3f}")
        print("(TCN/rules)")
        out = RUNS / args.run / "eval_folds.json"
        out.write_text(json.dumps(res, indent=1))
        print(f"wrote {out}")
        return 0

    res = evaluate_split(args.run, args.split, args.device)
    print(f"GolfDB split {args.split}: {res['n']} clips, run '{args.run}' ({res['n_params']} params, "
          f"checkpoint epoch {res['checkpoint_epoch']}, val PCE {res['val']['overall']:.3f})")
    print(fmt_table(res["tcn"], res["rules"], res["tcn_argmax"]))
    print(f"(TCN = ordered decode, the app's path; TCN-argmax = GolfDB eval.py per-class argmax; rules found no "
          f"swing in {res['rules']['no_swing_clips']} clips)")
    gates = check_gates(res["tcn"], res["rules"])
    res["gates"] = [{"gate": g, "value": v, "threshold": t, "pass": bool(p)} for g, v, t, p in gates]
    print("M3 gates (CAFCR R2 / R6 M3):")
    for g, v, t, p in gates:
        print(f"  {g:<22} {v:.3f} >= {t:.2f}  {'PASS' if p else 'FAIL'}")
    ok = all(p for *_, p in gates)
    print("ALL M3 GATES PASS" if ok else "M3 GATES: FAIL")
    if args.split == 1 and EVAL_LOG.exists():
        n = sum(1 for _ in EVAL_LOG.open())
        print(f"split-1 TCN evaluations logged so far: {n} ({EVAL_LOG.relative_to(ROOT)})")
    out = RUNS / args.run / f"eval_split{args.split}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(res, indent=1))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
