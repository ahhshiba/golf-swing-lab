"""Owner retraining pipeline (PRODUCT-SPEC §7.4): FNV-1a session order parity with the JS split, the labels/1 loader
on the synthetic fixture, and scripts/train_owner.sh --dry-run end to end (json/bin + golfdb:false card accepted by
check_model_card.mjs and imported by session/models.js with the golden reproduced <= 1e-4)."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from owner_data import example, fnv1a, load_labels, split_sessions  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "tests" / "fixtures" / "owner" / "labels-fixture.json"
NODE = shutil.which("node")


@pytest.mark.skipif(NODE is None, reason="node not on PATH")
def test_fnv1a_matches_js():
    ids = ["fixture-session-1", "sess-2026-11-05T10:00", "會話-一", ""]
    js = subprocess.run([NODE, "--input-type=module", "-e",
                         "import { fnv1a } from './scripts/eval_owner_set.mjs';"
                         f"console.log(JSON.stringify({json.dumps(ids)}.map(fnv1a)))"],
                        cwd=ROOT, capture_output=True, text=True, check=True)
    assert json.loads(js.stdout) == [fnv1a(s) for s in ids]


def test_fixture_loads_and_splits_by_session():
    swings = load_labels([FIXTURE])
    assert len(swings) == 24
    train, hold = split_sessions(swings, 0.5)
    sess = {s["shot_id"]: s["session_id"] for s in swings}
    assert not {sess[i] for i in train} & {sess[i] for i in hold}
    assert len(train) + len(hold) == 24 and len(train) <= 12
    ex = example(swings[0])
    assert ex["x"].shape[1] == 12 and len(ex["ev_idx"]) == 8
    assert all(ex["ev_idx"][k] <= ex["ev_idx"][k + 1] for k in range(7))


@pytest.mark.skipif(NODE is None, reason="node not on PATH")
def test_train_owner_dry_run(tmp_path):
    out = tmp_path / "run"
    r = subprocess.run(["bash", "scripts/train_owner.sh", "--dry-run", "--out-dir", str(out), str(FIXTURE)],
                       cwd=ROOT, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    models = sorted(out.glob("event-tcn-owner-*.json"))
    assert len(models) == 1 and models[0].with_suffix(".bin").exists()
    card = json.loads(models[0].read_text())["model_card"]
    assert card["golfdb"] is False and card["training_data"] == ["owner", "synthetic"]
    assert card["owner_holdout"]["n"] >= 1 and "passed" in card["owner_holdout"]["gate"]
    imp = subprocess.run([NODE, "training/node/import_check.mjs", str(models[0])], cwd=ROOT, capture_output=True, text=True)
    assert imp.returncode == 0, imp.stdout + imp.stderr
    assert "imported" in imp.stdout
