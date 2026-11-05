"""Export a trained event TCN for the app: app/models/event-tcn-v1.{bin,json}, the JS parity golden
tests/fixtures/event-tcn-v1.golden.json, and an ONNX copy under training/runs/<run>/ (reference only).

    ~/.local/share/golf-swing-lab-venv/bin/python -I training/export.py --run v1 [--split 1]

Weight file layout (event-tcn-v1.bin): little-endian float32, the tensors of json.tensors concatenated in order,
each in torch layout (Conv1d weight [out][in][k], bias [out]); json.tensors[i].offset is in float32 elements.
Order: convs.0.weight, convs.0.bias, ..., convs.3.weight, convs.3.bias, head.weight, head.bias.
"""
from __future__ import annotations

import os

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402
import torch  # noqa: E402

from eval_pce import load_checkpoint  # noqa: E402
from features import FEATURE_NAMES, FEATURE_VERSION  # noqa: E402
from model import n_params, normalise, predict_probs  # noqa: E402
from pce import EVENTS  # noqa: E402

TRAINING = Path(__file__).resolve().parent
ROOT = TRAINING.parent
RUNS = TRAINING / "runs"
MODELS = ROOT / "app" / "models"
GOLDEN = ROOT / "tests" / "fixtures" / "event-tcn-v1.golden.json"
FORMAT = "gsl-event-tcn/1"
NAME = "event-tcn-v1"
LICENCE = ("Trained on GolfDB (McNally et al. 2019, CC BY-NC 4.0): personal, non-commercial use only. "
           "Not for redistribution with a public build until the owner decides (CAFCR R2 open question).")


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


def read_bin(path: Path, specs):
    raw = np.frombuffer(path.read_bytes(), dtype="<f4")
    return {s["name"]: raw[s["offset"]:s["offset"] + int(np.prod(s["shape"]))].reshape(s["shape"]) for s in specs}


def numpy_forward(weights: dict, arch: dict, xn: np.ndarray) -> np.ndarray:
    """Reference forward pass in numpy (float64) from the exported weights; xn (K, F) normalised."""
    h = xn.T.astype(np.float64)
    k = arch["k"]
    for l, d in enumerate(arch["dilations"]):
        w = weights[f"convs.{l}.weight"].astype(np.float64)
        b = weights[f"convs.{l}.bias"].astype(np.float64)
        pad = d * (k - 1) // 2
        T = h.shape[1]
        hp = np.pad(h, ((0, 0), (pad, pad)))
        y = np.tile(b[:, None], (1, T))
        for j in range(k):
            y += w[:, :, j] @ hp[:, j * d:j * d + T]
        y = np.maximum(y, 0)
        h = y if l == 0 else h + y
    z = weights["head.weight"][:, :, 0].astype(np.float64) @ h + weights["head.bias"].astype(np.float64)[:, None]
    z = z - z.max(axis=0, keepdims=True)
    e = np.exp(z)
    return (e / e.sum(axis=0, keepdims=True)).T


def synth_feature_cases():
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node not on PATH")
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "sf.json"
        r = subprocess.run([node, str(TRAINING / "node" / "synth_features.mjs"), str(out)], cwd=ROOT,
                           capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(r.stderr)
        return json.loads(out.read_text())


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run", default="v1")
    ap.add_argument("--split", type=int, default=1, help="which split's checkpoint to ship (trained without it)")
    ap.add_argument("--models-dir", default=str(MODELS))
    ap.add_argument("--golden", default=str(GOLDEN))
    args = ap.parse_args(argv)
    if os.environ.get("RESEARCH") != "1":
        print("GolfDB research script (CC BY-NC, dev only, ADR 0004): set RESEARCH=1 to run it; its outputs are a "
              "benchmark report, never a ship gate or a source of constants.", file=sys.stderr)
        return 2

    run_dir = RUNS / args.run
    model, mean, std, ck = load_checkpoint(run_dir / f"split{args.split}" / "best.pt")
    cfg = ck["info"]["config"]
    arch = {"in_ch": model.in_ch, "ch": model.ch, "k": model.k, "dilations": list(model.dilations),
            "n_classes": model.n_classes, "residual": "h_l = h_{l-1} + relu(conv_l(h_{l-1})) for l >= 1",
            "padding": "zeros, d*(k-1)/2 both sides (torch Conv1d padding=d*(k-1)//2)", "activation": "relu",
            "output": "softmax over 9 classes per frame"}
    mdir = Path(args.models_dir)
    mdir.mkdir(parents=True, exist_ok=True)
    bin_path, json_path = mdir / f"{NAME}.bin", mdir / f"{NAME}.json"
    specs, data = write_bin(model, bin_path)
    sha = hashlib.sha256(data).hexdigest()

    # round trip: the bytes reproduce the torch weights exactly and the numpy forward matches torch
    back = read_bin(bin_path, specs)
    sd = model.state_dict()
    for s in specs:
        assert np.array_equal(back[s["name"]], sd[s["name"]].numpy()), s["name"]

    results = {}
    for fn in ("eval_split1.json", "eval_folds.json"):
        p = run_dir / fn
        if p.exists():
            r = json.loads(p.read_text())
            if fn == "eval_split1.json":
                results["split1"] = {"tcn": r["tcn"], "rules": r["rules"], "tcn_argmax": r["tcn_argmax"],
                                     "gates": r.get("gates")}
            else:
                results["folds"] = [{"split": x["split"], "tcn_overall": x["tcn"]["overall"],
                                     "rules_overall": x["rules"]["overall"],
                                     "tcn_excl": x["tcn"]["excl_address_finish"],
                                     "tcn_impact": x["tcn"]["per_event"]["impact"],
                                     "tcn_top": x["tcn"]["per_event"]["top"]} for x in r]
    meta = {
        "format": FORMAT, "version": NAME, "feature_version": FEATURE_VERSION, "feature_names": list(FEATURE_NAMES),
        "feature_hz": 30, "classes": list(EVENTS) + ["background"], "background_class": 8,
        "arch": arch, "n_params": n_params(model),
        "norm": {"mean": [float(x) for x in mean], "std": [float(x) for x in std],
                 "rule": "z = (float32(x) - mean) / std in float32; non-finite z -> 0"},
        "tensors": specs, "bin": f"{NAME}.bin", "bin_bytes": len(data), "dtype": "float32", "endianness": "little",
        "sha256": sha,
        "training": {"run": args.run, "trained_without_split": args.split, "checkpoint_epoch": ck["epoch"],
                     "val": ck["val"], "n_train": ck["info"]["n_train"], "n_val": ck["info"]["n_val"],
                     "config": cfg, "data": "GolfDB videos_160 (1400 clips), MediaPipe 1.2.2 pose_landmarker_full "
                     "keypoints (lite as augmentation)", "script": "training/train_tcn.py"},
        "results": results,
        "licence": LICENCE,
    }
    json_path.write_text(json.dumps(meta, indent=1) + "\n")

    # golden: torch (CPU float32) probabilities for the synthetic inputs
    sf = synth_feature_cases()
    assert sf["feature_version"] == FEATURE_VERSION
    cases = []
    for c in sf["cases"]:
        x = np.asarray(c["features"], dtype=np.float64).reshape(c["K"], c["F"])
        xn = normalise(x, mean, std)
        p = predict_probs(model, xn)
        pn = numpy_forward(back, arch, xn)
        assert np.abs(p - pn).max() < 1e-5, f"numpy forward differs from torch: {np.abs(p - pn).max()}"
        cases.append({"name": c["name"], "handedness": c["handedness"], "K": c["K"], "F": c["F"],
                      "features": c["features"], "probs": [float(v) for v in p.ravel()],
                      "argmax": [int(v) for v in p.argmax(axis=1)]})
    Path(args.golden).write_text(json.dumps({
        "model": NAME, "sha256": sha, "feature_version": FEATURE_VERSION, "tolerance_prob": 1e-4,
        "note": "probs = torch CPU float32 softmax of training/model.py EventTCN loaded from the exported weights; "
                "inputs = evfeat-1 features of 3 synthetic swings (training/node/synth_features.mjs).",
        "cases": cases}) + "\n")

    # ONNX (reference only, not used by the app)
    onnx_path = run_dir / f"{NAME}.onnx"
    try:
        dummy = torch.zeros(1, model.in_ch, 128)
        torch.onnx.export(model, (dummy,), str(onnx_path), input_names=["x"], output_names=["logits"],
                          dynamic_axes={"x": {2: "T"}, "logits": {2: "T"}}, opset_version=17, dynamo=False)
        import onnxruntime as ort

        sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
        x = np.asarray(cases[0]["features"], np.float64).reshape(cases[0]["K"], -1)
        xn = normalise(x, mean, std)
        lo = sess.run(None, {"x": xn.T[None].astype(np.float32)})[0][0].T
        lo = np.exp(lo - lo.max(axis=1, keepdims=True))
        po = lo / lo.sum(axis=1, keepdims=True)
        onnx_note = f"onnx max |dprob| vs torch {np.abs(po - np.asarray(cases[0]['probs']).reshape(po.shape)).max():.2e}"
    except Exception as e:  # reference artefact only
        onnx_note = f"onnx export skipped: {e}"
    print(f"wrote {bin_path} ({len(data)} bytes, sha256 {sha[:16]}...), {json_path}, {args.golden}; {onnx_note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
