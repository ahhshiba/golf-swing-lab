"""Label construction on the 30 Hz grid, id 677 handling, handedness, splits (needs the keypoint cache)."""
import numpy as np
import pytest

import dataset as D
from pce import golfdb_correct, golfdb_labels

pytestmark = pytest.mark.skipif(not (D.CACHE / "full" / "0.npz").exists() or not D.ANNOT.exists(),
                                reason="keypoint cache / annotations not present")


@pytest.mark.parametrize("cid", [0, 1, 428, 661, 1293, 677])
def test_event_frames_land_on_their_classes(cid):
    ex = D.build_example(cid)
    a = D.annotation(cid)
    clip = D.load_clip(cid)
    lab = ex["labels"]
    assert len(lab) == len(ex["x"]) == len(ex["t_grid"])
    for e, k in enumerate(ex["ev_idx"]):
        assert lab[k] == e, (cid, e, k)
    assert (lab < 8).sum() == 8 and (lab == 8).sum() == len(lab) - 8
    # grid index -> original frame is the annotated frame (29.97 fps source vs 30 Hz grid: within 1 frame)
    back = D.grid_to_frames(ex["t_grid"], ex["ev_idx"], clip["t_s"])
    ef = D.event_frames(a)
    assert np.max(np.abs(back - ef)) <= 1
    # the GolfDB eval (sorted labelled positions) scores the decoded label positions as all correct
    labels = golfdb_labels(a["events"], len(clip["t_s"]))
    assert golfdb_correct(back, labels)[3].all()


def test_id_677_uses_golfdb_sorted_definition():
    a = D.annotation(677)
    rel = a["events"] - a["events"][0]
    assert rel[6] == 168 and rel[7] == 167  # the raw annotation is impact > mid_follow_through
    ef = D.event_frames(a)
    assert list(ef) == [92, 114, 131, 146, 158, 167, 168, 242]
    labels = golfdb_labels(a["events"], D.clip_frames(a))
    assert list(np.where(labels < 8)[0]) == list(ef)
    assert D.NONMONOTONIC_IDS == (677,)
    bad = [r["id"] for r in D.annotations() if np.any(np.diff((r["events"] - r["events"][0])[1:-1]) < 0)]
    assert bad == [677]


def test_handedness_players_and_pose_check():
    rows = D.annotations()
    left = [r["id"] for r in rows if D.handedness(r) == "left"]
    assert len(left) == 37
    assert all(D.pose_hand_score(i) > 0 for i in left)
    assert D.handedness(D.annotation(0)) == "right"


def test_splits_and_val():
    for s in (1, 2, 3, 4):
        tr, te = D.split_ids(s)
        assert len(te) == 350 and len(tr) == 1050 and not set(tr) & set(te)
        a, v = D.carve_val(tr)
        assert sorted(a + v) == sorted(tr) and not set(a) & set(v)
        va = {D.annotation(i)["youtube_id"] for i in v}
        assert not va & {D.annotation(i)["youtube_id"] for i in a}
        assert 90 <= len(v) <= 200


def test_time_stretch_scales_event_positions():
    ex1 = D.build_example(5)
    ex2 = D.build_example(5, stretch=1.25)
    span1 = ex1["ev_idx"][7] - ex1["ev_idx"][0]
    span2 = ex2["ev_idx"][7] - ex2["ev_idx"][0]
    assert abs(span2 - 1.25 * span1) <= 2
    assert D.grid_to_frames(ex2["t_grid"], ex2["ev_idx"][[5]], D.load_clip(5)["t_s"], 1.25)[0] == \
        pytest.approx(D.event_frames(D.annotation(5))[5], abs=1)
