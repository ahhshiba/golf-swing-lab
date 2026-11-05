#!/usr/bin/env bash
# scripts/deploy_pages.sh - publish the PWA to the gh-pages branch (CAFCR R4; pattern of
# global-flow-dashboard/deploy_pages.sh lines 19-34: one fresh commit per deploy, force-pushed, so the branch never grows).
#
#   bash scripts/deploy_pages.sh --dry-run [--include-golfdb-model] [--verify]
#   bash scripts/deploy_pages.sh --i-have-approval [--include-golfdb-model]
#
# Real deploy (only with --i-have-approval, the owner's go-ahead, and a git remote named origin):
#   1. RUN_BROWSER_E2E=1 bash scripts/verify.sh must report FAIL=0 (only the opt-in training stage may be SKIP)
#   2. the work tree must be clean (git status --porcelain empty) and HEAD must exist
#   3. build dist into a temp dir: node scripts/build.mjs --out <tmp> (no event model: the default build)
#   4. temp index: GIT_INDEX_FILE=<tmp>/index git --work-tree=<tmp dist> add -A && git write-tree
#   5. git commit-tree <tree> -> git push --force origin <commit>:refs/heads/gh-pages (dist has .nojekyll)
#   6. git prune --expire=3.days.ago (old deploy commits are unreferenced after the force push)
#   7. deploy/last-deploy.json = { version, commit, deployed_at, bundled_event_model, source_head, url }
#      (scripts/check-sw.mjs then insists on a semver bump when the precache contents change)
# No GolfDB in the product (PRODUCT-SPEC §7.1, EV-6): the event model app/models/event-tcn-v1.* is trained on GolfDB
# (CC BY-NC 4.0) and never ships. The default build leaves it out; --include-golfdb-model makes a dev-research build
# (precache-manifest dev_research: true), which a real deploy REFUSES (a dry run lists it and reports the refusal).
# --dry-run: steps 3 + a listing of what would be pushed; no git writes, no push, no last-deploy.json, approval not
# needed. It reports which preconditions a real deploy would fail. --verify also runs step 1.
# Exit: 0 ok, 1 a check failed, 2 refused (no approval / no origin / dirty tree), 64 usage.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 70

APPROVED=0; DRY=0; WITH_MODEL=0; DRY_VERIFY=0
for a in "$@"; do
  case "$a" in
    --i-have-approval) APPROVED=1 ;;
    --dry-run) DRY=1 ;;
    --include-golfdb-model) WITH_MODEL=1 ;;
    --verify) DRY_VERIFY=1 ;;
    -h|--help) sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "deploy_pages.sh: unknown argument '$a' (try --help)" >&2; exit 64 ;;
  esac
done
PAGES_URL="https://ahhshiba.github.io/golf-swing-lab/"

refuse() { echo "REFUSED: $*" >&2; exit 2; }
note=()   # dry run: preconditions a real deploy would fail

# ---- preconditions (a real deploy refuses; a dry run only reports) ----
if [ "$DRY" -eq 0 ] && [ "$APPROVED" -ne 1 ]; then
  refuse "deploying needs the owner's approval: re-run with --i-have-approval (or use --dry-run)"
fi
in_git=0; git rev-parse --git-dir >/dev/null 2>&1 && in_git=1
has_origin=0; [ "$in_git" -eq 1 ] && git remote get-url origin >/dev/null 2>&1 && has_origin=1
has_head=0; [ "$in_git" -eq 1 ] && git rev-parse --verify -q HEAD >/dev/null 2>&1 && has_head=1
dirty=""; [ "$in_git" -eq 1 ] && dirty=$(git status --porcelain 2>/dev/null)
check() { # check OK-FLAG MESSAGE
  if [ "$1" -eq 1 ]; then return 0; fi
  if [ "$DRY" -eq 1 ]; then note+=("$2"); return 0; fi
  refuse "$2"
}
check "$in_git" "not a git repository"
check "$has_origin" "no git remote named origin (git remote add origin <url> first)"
check "$has_head" "the repository has no commit yet (deploy records the source HEAD)"
if [ -n "$dirty" ]; then check 0 "work tree is not clean ($(printf '%s\n' "$dirty" | wc -l) changed/untracked path(s)); commit first"; fi
if [ "$WITH_MODEL" -eq 1 ]; then check 0 "--include-golfdb-model makes a dev-research build (GolfDB event model, CC BY-NC): it is never deployed"; fi

# ---- 1. full verification ----
if [ "$DRY" -eq 0 ] || [ "$DRY_VERIFY" -eq 1 ]; then
  log=$(mktemp)
  RUN_BROWSER_E2E=1 bash scripts/verify.sh 2>&1 | tee "$log"
  vrc=${PIPESTATUS[0]}
  fails=$(sed -n 's/^PASS=[0-9]* FAIL=\([0-9]*\) SKIP=[0-9]*$/\1/p' "$log" | tail -1)
  skipped=$(sed -n 's/^skipped: *//p' "$log" | tail -1)
  rm -f "$log"
  if [ "$vrc" -ne 0 ] || [ "${fails:-x}" != 0 ] || { [ -n "$skipped" ] && [ "$skipped" != training ]; }; then
    echo "FAIL verify.sh: exit $vrc, FAIL=${fails:-?}, skipped='${skipped}' (only 'training' may be skipped)" >&2
    exit 1
  fi
  echo "verify.sh: all required stages passed"
else
  echo "(dry run: verify.sh not run; add --verify to run it)"
fi

# ---- 3. build into a temp dir ----
TMPD=$(mktemp -d "${TMPDIR:-/tmp}/gsl-deploy.XXXXXX") || exit 1
trap 'rm -rf "$TMPD"' EXIT
OUT="$TMPD/dist"
BUILD_ARGS=(--out "$OUT" --quiet)
[ "$WITH_MODEL" -eq 1 ] && BUILD_ARGS+=(--include-golfdb-model)
node scripts/build.mjs "${BUILD_ARGS[@]}" || { echo "FAIL build" >&2; exit 1; }
rm -f "$OUT/.gsl-build"   # build marker, not part of the site
VERSION=$(node -e 'const m=require(process.argv[1]);process.stdout.write(m.version)' "$OUT/precache-manifest.json")
BUNDLED=$(node -e 'const m=require(process.argv[1]);process.stdout.write(String(m.bundled_event_model!==false))' "$OUT/precache-manifest.json")
[ -f "$OUT/.nojekyll" ] || { echo "FAIL build: .nojekyll missing" >&2; exit 1; }
RESEARCH=$(node -e 'const m=require(process.argv[1]);process.stdout.write(String(m.dev_research===true))' "$OUT/precache-manifest.json")
if [ "$DRY" -eq 0 ] && [ "$RESEARCH" = true ]; then refuse "the build is a dev-research build (dev_research: true); it is never deployed"; fi
if [ "$WITH_MODEL" -eq 0 ] && [ -n "$(find "$OUT" -name 'event-tcn-v1.*' -print -quit)" ]; then
  echo "FAIL: event model files present in a --no-bundled-model build" >&2; exit 1
fi
NFILES=$(find "$OUT" -type f | wc -l)
BYTES=$(find "$OUT" -type f -printf '%s\n' | awk '{s+=$1} END {print s+0}')

if [ "$DRY" -eq 1 ]; then
  echo "DRY RUN: would push $NFILES files ($BYTES bytes) to gh-pages as one commit"
  echo "  VERSION $VERSION, bundled event model: $BUNDLED$([ "$WITH_MODEL" -eq 1 ] && echo ' (DEV RESEARCH build: never deployed)')"
  (cd "$OUT" && find . -type f -printf '%P\t%s\n' | LC_ALL=C sort) | awk -F'\t' '{printf "  %10d  %s\n", $2, $1}'
  echo "  then: GIT_INDEX_FILE=<tmp>/index git --work-tree=<dist> add -A; git write-tree; git commit-tree;"
  echo "        git push --force origin <commit>:refs/heads/gh-pages; git prune --expire=3.days.ago; write deploy/last-deploy.json"
  if [ "${#note[@]}" -gt 0 ]; then
    echo "a real deploy would be REFUSED now:"; for n in "${note[@]}"; do echo "  - $n"; done
  else
    echo "preconditions for a real deploy: OK (still needs --i-have-approval)"
  fi
  echo "DRY RUN done: no git objects written, nothing pushed"
  exit 0
fi

# ---- 4-5. temp index -> tree -> commit -> force push ----
GITDIR=$(git rev-parse --absolute-git-dir) || exit 1
TREE=$(cd "$OUT" && GIT_DIR="$GITDIR" GIT_INDEX_FILE="$TMPD/index" git --work-tree=. add -A &&
  GIT_DIR="$GITDIR" GIT_INDEX_FILE="$TMPD/index" git --work-tree=. write-tree) || { echo "FAIL git add / write-tree" >&2; exit 1; }
HEAD_SHA=$(git rev-parse HEAD)
COMMIT=$(git commit-tree "$TREE" -m "deploy: $VERSION (source ${HEAD_SHA:0:7}, bundled event model: $BUNDLED)") || exit 1
git push -q --force origin "$COMMIT":refs/heads/gh-pages || { echo "FAIL git push" >&2; exit 1; }
# ---- 6. old deploy commits are unreferenced now ----
git prune --expire=3.days.ago 2>/dev/null || true
# ---- 7. record the deploy ----
mkdir -p deploy
node -e '
const [version, commit, bundled, head, url] = process.argv.slice(1);
const out = { version, commit, deployed_at: new Date().toISOString(), bundled_event_model: bundled === "true", source_head: head, url };
require("fs").writeFileSync("deploy/last-deploy.json", JSON.stringify(out, null, 2) + "\n");
' "$VERSION" "$COMMIT" "$BUNDLED" "$HEAD_SHA" "$PAGES_URL"
echo "deployed gh-pages: commit ${COMMIT:0:7}, VERSION $VERSION, $NFILES files, bundled event model: $BUNDLED"
echo "commit deploy/last-deploy.json next (check-sw.mjs compares future builds with it): $PAGES_URL"
