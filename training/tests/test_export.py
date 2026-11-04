"""Export round trip: the .bin read back in numpy equals the torch weights; numpy forward == torch; the shipped model
matches its json (sha256, sizes) and the golden probabilities."""
import hashlib
import json
from pathlib import Path

import numpy as np
import pytest
import torch

from export import numpy_forward, read_bin, write_bin
from features import FEATURE_VERSION, N_FEATURES
from model import EventTCN, n_params, predict_probs

ROOT = Path(__file__).resolve().parents[2]
MODEL_JSON = ROOT / "app" / "models" / "event-tcn-v1.json"
MODEL_BIN = ROOT / "app" / "models" / "event-tcn-v1.bin"
GOLDEN = ROOT / "tests" / "fixtures" / "event-tcn-v1.golden.json"


def test_param_count_in_r2_range():
    n = n_params(EventTCN())
    assert 30_000 <= n <= 90_000, n  # CAFCR R2: ~60k (+-50 %)


def test_roundtrip_random_model(tmp_path):
    torch.manual_seed(3)
    m = EventTCN().eval()
    with torch.no_grad():
        for p in m.parameters():
            p.add_(torch.randn_like(p) * 0.05)
    specs, data = write_bin(m, tmp_path / "w.bin")
    assert len(data) == 4 * n_params(m)
    back = read_bin(tmp_path / "w.bin", specs)
    for name, t in m.state_dict().items():
        assert np.array_equal(back[name], t.numpy()), name
    arch = {"k": m.k, "dilations": list(m.dilations)}
    x = np.random.default_rng(0).normal(size=(97, N_FEATURES)).astype(np.float32)
    assert np.abs(numpy_forward(back, arch, x) - predict_probs(m, x)).max() < 1e-5


def test_masked_batch_equals_single_sequence():
    torch.manual_seed(4)
    m = EventTCN().eval()
    rng = np.random.default_rng(1)
    a = rng.normal(size=(N_FEATURES, 40)).astype(np.float32)
    b = rng.normal(size=(N_FEATURES, 70)).astype(np.float32)
    X = np.zeros((2, N_FEATURES, 70), np.float32)
    X[0, :, :40], X[1] = a, b
    M = np.zeros((2, 70), np.float32)
    M[0, :40], M[1] = 1, 1
    with torch.no_grad():
        yb = m(torch.from_numpy(X), torch.from_numpy(M)).numpy()
        ya = m(torch.from_numpy(a[None])).numpy()
    assert np.abs(yb[0, :, :40] - ya[0]).max() < 1e-5


@pytest.mark.skipif(not MODEL_JSON.exists(), reason="model not exported yet")
def test_shipped_model_matches_json_and_golden():
    meta = json.loads(MODEL_JSON.read_text())
    data = MODEL_BIN.read_bytes()
    assert meta["feature_version"] == FEATURE_VERSION and meta["bin_bytes"] == len(data)
    assert hashlib.sha256(data).hexdigest() == meta["sha256"]
    assert sum(int(np.prod(s["shape"])) for s in meta["tensors"]) * 4 == len(data)
    w = read_bin(MODEL_BIN, meta["tensors"])
    g = json.loads(GOLDEN.read_text())
    assert g["sha256"] == meta["sha256"]
    mean = np.asarray(meta["norm"]["mean"], np.float32)
    std = np.asarray(meta["norm"]["std"], np.float32)
    for c in g["cases"]:
        x = np.asarray(c["features"]).reshape(c["K"], c["F"]).astype(np.float32)
        xn = np.where(np.isfinite((x - mean) / std), (x - mean) / std, 0).astype(np.float32)
        p = numpy_forward(w, meta["arch"], xn)
        assert np.abs(p - np.asarray(c["probs"]).reshape(p.shape)).max() < 1e-5
    # and the torch checkpoint it came from, when present
    ck = ROOT / "training" / "runs" / meta["training"]["run"] / f"split{meta['training']['trained_without_split']}" / "best.pt"
    if ck.exists():
        sd = torch.load(ck, map_location="cpu", weights_only=False)["state_dict"]
        for s in meta["tensors"]:
            assert np.array_equal(w[s["name"]], sd[s["name"]].numpy()), s["name"]
