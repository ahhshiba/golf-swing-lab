"""Keypoint extraction checks (training/extract_keypoints.py): shapes, ranges, timestamps, determinism, resume.

Run from the repository root:
    ~/.local/share/golf-swing-lab-venv/bin/python -I -m pytest -q training/tests
Runs the real extractor on the first 3 GolfDB clips, for both the lite and the full model.
"""
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

TRAINING = Path(__file__).resolve().parents[1]
SCRIPT = TRAINING / "extract_keypoints.py"
N_CLIPS = 3


def run_extract(model: str, out: Path, cwd: Path):
    # cwd is a scratch directory: never run from training/data or training/vendor (interfaces.md section 8).
    return subprocess.run(
        [sys.executable, "-I", str(SCRIPT), "--model", model, "--workers", "2", "--limit", str(N_CLIPS),
         "--out", str(out)],
        cwd=cwd, capture_output=True, text=True, timeout=600,
    )


def load(path: Path) -> dict:
    with np.load(path, allow_pickle=False) as z:
        return {k: z[k] for k in z.files}


@pytest.fixture(scope="module", params=["lite", "full"])
def runs(request, tmp_path_factory):
    model = request.param
    base = tmp_path_factory.mktemp(f"kp_{model}")
    outs = [base / "run1", base / "run2"]
    results = [run_extract(model, o, base) for o in outs]
    return model, outs, results


def test_extract_succeeds_and_writes_index(runs):
    model, outs, results = runs
    for r, out in zip(results, outs):
        assert r.returncode == 0, r.stdout + r.stderr
        files = sorted(p.name for p in out.glob("*.npz"))
        assert files == [f"{i}.npz" for i in range(N_CLIPS)]
        assert not list(out.glob("*.tmp*")), "temporary files left behind"
    import json

    idx = json.loads((outs[0] / "INDEX.json").read_text())
    assert idx["count"] == N_CLIPS and idx["model"] == model
    assert idx["total_frames"] == sum(c["T"] for c in idx["clips"]) > 0
    assert 0 < idx["detection_rate"] <= 1


def test_shapes_ranges_and_timestamps(runs):
    model, outs, _ = runs
    for i in range(N_CLIPS):
        d = load(outs[0] / f"{i}.npz")
        T = d["t_s"].shape[0]
        assert T > 0
        assert d["img"].shape == (T, 33, 4) and d["img"].dtype == np.float32
        assert d["world"].shape == (T, 33, 3) and d["world"].dtype == np.float32
        assert d["detected"].shape == (T,) and d["detected"].dtype == np.bool_
        assert d["t_s"].dtype == np.float64
        assert d["detected"].mean() > 0, "no person detected in the whole clip"
        det = d["detected"]
        vis = d["img"][det][..., 3]
        assert np.isfinite(vis).all() and vis.min() >= 0.0 and vis.max() <= 1.0
        assert np.isfinite(d["img"][det]).all() and np.isfinite(d["world"][det]).all()
        assert np.isnan(d["img"][~det]).all() and np.isnan(d["world"][~det]).all()
        assert np.all(np.diff(d["t_s"]) > 0), "t_s must be strictly increasing"
        assert d["t_s"][0] == 0.0
        fps = float(d["fps"])
        assert 5 <= fps <= 240
        assert np.allclose(d["t_s"], np.arange(T) / fps)
        assert int(d["W"]) == int(d["H"]) == 160
        assert str(d["model"]) == model and len(str(d["model_sha256"])) == 64
        assert str(d["mediapipe_version"]) == "1.2.2"


def test_deterministic_across_runs(runs):
    _, outs, _ = runs
    for i in range(N_CLIPS):
        a, b = load(outs[0] / f"{i}.npz"), load(outs[1] / f"{i}.npz")
        assert a.keys() == b.keys()
        for k in a:
            if a[k].dtype.kind == "f":
                assert np.array_equal(a[k], b[k], equal_nan=True), f"clip {i}: {k} differs between runs"
            else:
                assert np.array_equal(a[k], b[k]), f"clip {i}: {k} differs between runs"


def test_resume_skips_complete_files_and_redoes_broken_ones(runs):
    model, outs, _ = runs
    out = outs[0]
    before = {p.name: (p.stat().st_mtime_ns, p.stat().st_size) for p in out.glob("*.npz")}
    r = run_extract(model, out, out.parent)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "extracted=0 skipped=3" in r.stdout, r.stdout
    assert before == {p.name: (p.stat().st_mtime_ns, p.stat().st_size) for p in out.glob("*.npz")}
    # a truncated file is not "complete": it must be rewritten, and must equal the original result
    victim = out / "1.npz"
    original = load(victim)
    victim.write_bytes(victim.read_bytes()[:1000])
    r = run_extract(model, out, out.parent)
    assert r.returncode == 0, r.stdout + r.stderr
    again = load(victim)
    for k in original:
        if original[k].dtype.kind == "f":
            assert np.array_equal(original[k], again[k], equal_nan=True)
        else:
            assert np.array_equal(original[k], again[k])

