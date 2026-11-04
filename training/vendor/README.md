# training/vendor

## golfdb/

| Field | Value |
|---|---|
| Source | https://github.com/wmcnally/golfdb (branch `master`) |
| Commit | `a63b4ce8c0900d09abbe92519223efe16810f5f4` ("add golfDB.pkl", committed 2021-07-20) |
| Cloned | 2026-11-04 |
| Licence | CC BY-NC 4.0 for the code (stated in `golfdb/README.md`, line 3). Upstream has **no LICENSE file** (verified online, see "Licence verification" below), so there is no `golfdb/LICENSE` to keep; the README statement is the only licence text, and it is kept unmodified. `golfdb/LICENSE-NOTICE.txt` is a pointer file added by this project (not upstream) that quotes README line 3 and says there is no LICENSE file. Personal, non-commercial use only. |
| Local change | The nested `.git` directory was removed after cloning. The files are **not published**: `.gitignore` keeps everything in `golfdb/` except `LICENSE-NOTICE.txt` out of the public repository, so a clone must re-clone upstream at the commit above. Added file: `golfdb/LICENSE-NOTICE.txt` (see Licence row). Every other file is byte-identical to the commit above. |

Use of the vendored code in this project: only `data/golfDB.mat` (annotations) and `data/generate_splits.py`
(converts the `.mat` to `golfDB.pkl` and the 4 train/val split pickles). The SwingNet model and training code are
not used. `training/prepare_annotations.py` runs `generate_splits.py` unchanged (`python -I`, in an empty
temporary directory that holds a copy of `golfDB.mat`) and copies the results to `training/data/annotations/`.

The repository `.gitignore` ignores `training/vendor/golfdb/data/` (it holds `golfDB.pkl`, which upstream also tracks, and the `.mat`). If that ignore rule
stays, a fresh checkout of this repository does not contain `golfDB.mat`; recreate the vendored tree with:

```
git clone https://github.com/wmcnally/golfdb training/vendor/golfdb
git -C training/vendor/golfdb checkout a63b4ce8c0900d09abbe92519223efe16810f5f4
rm -rf training/vendor/golfdb/.git
```

`golfDB.mat` sha256: `36523fcef016d93334691ea058d643bcf0d3a4a8c70b733f3b4cc0b8e5e0cf0a`

Annotation format (10 entries per `events` array): `events[0]` and `events[9]` are the start and end frame of the
source video segment; `events[1:9]` are the 8 swing events in GolfDB order (Address, Toe-up, Mid-backswing, Top,
Mid-downswing, Impact, Mid-follow-through, Finish) as frame numbers of the source video. The 160x160 clips start at
`events[0]`, so clip frame = `events[k] - events[0]`.

## Licence verification (2026-11-04, online)

Checked against the live upstream, not from memory. Upstream HEAD is the pinned commit `a63b4ce8c0900d09abbe92519223efe16810f5f4`.

| Check | Result |
|---|---|
| Fresh `git clone https://github.com/wmcnally/golfdb`, `git ls-tree --name-only HEAD` | no LICENSE, LICENCE or COPYING entry (top level is `.gitignore MobileNetV2.py README.md data dataloader.py eval.py model.py test_video.mp4 test_video.py train.py util.py`) |
| `git log --all --name-only -- 'LICENSE*' 'LICENCE*' 'COPYING*'` over all 34 commits | empty: no such file ever existed in the history |
| `GET https://api.github.com/repos/wmcnally/golfdb/license` | HTTP 404; repository JSON has `"license": null` |
| `GET https://raw.githubusercontent.com/wmcnally/golfdb/master/{LICENSE,LICENSE.md,LICENSE.txt,COPYING}` | HTTP 404 for all four |
| `diff -r` of the fresh clone against `golfdb/` (excluding `.git` and `LICENSE-NOTICE.txt`) | identical, exit 0 |

Therefore `golfdb/LICENSE` cannot be kept, and this project does not invent one. The equivalent record is
`golfdb/LICENSE-NOTICE.txt` (quotes README line 3 and states the CC BY-NC 4.0, personal non-commercial scope).
