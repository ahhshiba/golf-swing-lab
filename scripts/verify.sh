#!/usr/bin/env bash
# scripts/verify.sh - the single verification entry point for golf-swing-lab.
#
# Every milestone is accepted by running this script. Rules:
#   * a stage prints exactly one of   PASS <name> | FAIL <name> | SKIP <name> (<reason>)
#   * a stage whose script does not exist yet is SKIP, never PASS, and is listed in the summary
#   * exit code = number of FAIL stages (capped at 255); usage errors exit 64
#   * a run with SKIPs or --only is a partial run and says so; it never looks like a full pass
#
# Usage:
#   bash scripts/verify.sh                      run every stage
#   bash scripts/verify.sh --only unit,static   run only the named stages
#   bash scripts/verify.sh --list               print the stage names
# Opt-in stages: RUN_BROWSER_E2E=1 (browser-e2e), RUN_TRAINING=1 (training). The tokens and i18n lints always run --strict.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 70

ALL_STAGES=(env static unit contract tokens i18n event-conf model-parity synthetic-calib synthetic-e2e build sw-version browser-e2e training)
GSL_PY=${GSL_PY:-$HOME/.local/share/golf-swing-lab-venv/bin/python}

usage() {
  sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# ---------------------------------------------------------------- arguments
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --only)
      if [ $# -lt 2 ] || [ -z "$2" ]; then echo "verify.sh: --only needs a comma-separated stage list" >&2; exit 64; fi
      ONLY=$2; shift 2 ;;
    --only=*) ONLY=${1#--only=}; shift ;;
    --list) printf '%s\n' "${ALL_STAGES[@]}"; exit 0 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "verify.sh: unknown argument '$1' (try --help)" >&2; exit 64 ;;
  esac
done
if [ -n "$ONLY" ]; then
  IFS=',' read -r -a requested <<<"$ONLY"
  for r in "${requested[@]}"; do
    known=0
    for s in "${ALL_STAGES[@]}"; do [ "$s" = "$r" ] && known=1; done
    if [ "$known" -eq 0 ]; then
      echo "verify.sh: unknown stage '$r' (known: ${ALL_STAGES[*]})" >&2
      exit 64
    fi
  done
fi

# ------------------------------------------------------------------ helpers
pass_n=0; fail_n=0; skip_n=0
FAILED=(); SKIPPED=(); NOTRUN=()

# want NAME: is this stage selected? "env:vendor" belongs to stage "env".
want() {
  local base=${1%%:*}
  [ -z "$ONLY" ] && return 0
  case ",$ONLY," in *",$base,"*) return 0 ;; esac
  return 1
}

# stage NAME CMD...: run CMD, print PASS/FAIL, count it.
stage() {
  local name=$1; shift
  want "$name" || return 0
  printf '\n=== %s ===\n' "$name"
  if "$@"; then
    printf 'PASS %s\n' "$name"; pass_n=$((pass_n + 1))
  else
    printf 'FAIL %s\n' "$name"; fail_n=$((fail_n + 1)); FAILED+=("$name")
  fi
}

# skip NAME REASON: a missing or opt-out piece. Always listed in the summary.
skip() {
  want "$1" || return 0
  printf '\n=== %s ===\nSKIP %s (%s)\n' "$1" "$1" "$2"
  skip_n=$((skip_n + 1)); SKIPPED+=("$1")
}

# script_stage NAME SCRIPT [ARGS...]: node SCRIPT if it exists, else SKIP.
script_stage() {
  local name=$1 script=$2; shift 2
  if [ -f "$script" ]; then
    stage "$name" node "$script" "$@"
  else
    skip "$name" "$script not found yet"
  fi
}

# ------------------------------------------------------------- stage bodies
env_check() {
  if ! command -v node >/dev/null 2>&1; then echo "node not found on PATH"; return 1; fi
  local v major minor
  v=$(node -p 'process.versions.node')
  IFS=. read -r major minor _ <<<"$v"
  echo "node $v (need >= 18.19)"
  if [ "$major" -lt 18 ] || { [ "$major" -eq 18 ] && [ "$minor" -lt 19 ]; }; then
    echo "node is too old"; return 1
  fi
  if [ -f scripts/vendor.mjs ]; then
    node scripts/vendor.mjs --check || return 1
  fi
  return 0
}

# Forbidden in app/src (interfaces.md section 1; HTML-string sinks: PRODUCT-SPEC 6.3). Vendored code lives in app/vendor,
# outside this scan.
FORBIDDEN_RE=(
  -e 'location\.hash'
  -e 'history\.pushState'
  -e 'history\.replaceState'
  -e 'https?://'
  -e '(^|[^[:alnum:]_$])eval[[:space:]]*\('
  -e 'new[[:space:]]+Function([^[:alnum:]_$]|$)'
  -e 'innerHTML'
  -e 'insertAdjacentHTML'
  -e 'outerHTML[[:space:]]*='
  -e 'document\.write'
)

static_files() {
  { [ -d app/src ] && find app/src -type f \( -name '*.js' -o -name '*.mjs' \) -not -path '*/vendor/*' -print0
    find scripts -maxdepth 1 -type f -name '*.mjs' -print0
  } 2>/dev/null | sort -z
}

static_check() {
  local f rc=0 hits grc
  for f in "${STATIC_FILES[@]}"; do
    node --check "$f" || { echo "syntax error: $f"; rc=1; }
  done
  echo "node --check: ${#STATIC_FILES[@]} file(s)"
  if [ -d app/src ]; then
    hits=$(grep -rInE --exclude-dir=vendor "${FORBIDDEN_RE[@]}" app/src 2>&1); grc=$?
    if [ "$grc" -eq 0 ]; then
      # XML namespace names (createElementNS) are identifiers, never fetched: a hit that is only one of them is fine
      hits=$(printf '%s\n' "$hits" | while IFS= read -r line; do
        rest=${line#*:*:}
        stripped=$(printf '%s' "$rest" | sed -E 's#http://www\.w3\.org/(2000/svg|1999/xlink|1998/Math/MathML)##g')
        if printf '%s\n' "$stripped" | grep -qE "${FORBIDDEN_RE[@]}"; then printf '%s\n' "$line"; fi
      done)
      [ -z "$hits" ] && grc=1
    fi
    if [ "$grc" -eq 0 ]; then
      echo "forbidden pattern(s) in app/src:"; printf '%s\n' "$hits"; rc=1
    elif [ "$grc" -ne 1 ]; then
      echo "grep failed (exit $grc): $hits"; rc=1
    else
      echo "forbidden-pattern scan of app/src: clean"
    fi
  fi
  if [ -f scripts/check_imports.mjs ]; then
    node scripts/check_imports.mjs || rc=1
  else
    echo "scripts/check_imports.mjs missing"; rc=1
  fi
  return "$rc"
}

training_check() {
  if [ ! -x "$GSL_PY" ]; then echo "training venv python not found: $GSL_PY"; return 1; fi
  "$GSL_PY" -I -m pytest -q training/tests
}

# ------------------------------------------------------------------- stages
stage env env_check
[ -f scripts/vendor.mjs ] || skip env:vendor "scripts/vendor.mjs not found yet"

mapfile -d '' -t STATIC_FILES < <(static_files)
if [ "${#STATIC_FILES[@]}" -gt 0 ]; then
  stage static static_check
else
  skip static "no app/src/**/*.js or scripts/*.mjs yet"
fi

if [ -n "$(find tests/unit -type f -name '*.test.mjs' 2>/dev/null | head -n1)" ]; then
  stage unit node --test tests/unit/
else
  skip unit "no tests/unit/*.test.mjs yet"
fi

script_stage contract        scripts/check_contract.mjs
# design tokens + i18n lints (PRODUCT-SPEC 1.1, 3.6), strict since the integration commit (8.7 step 3): 0 CJK literals
# in app/src outside the catalogs, and every token/i18n finding in any package FAILS
script_stage tokens          scripts/check_tokens.mjs --strict
script_stage i18n            scripts/check_i18n.mjs --quiet --strict
# event-confidence reliability (PRODUCT-SPEC 7.3, package E)
script_stage event-conf      scripts/check_event_conf.mjs
# model-parity = JS inference reproduces the torch golden + the recorded M3 gates of the model card (P9 / M3)
if [ ! -f app/models/event-tcn-v1.json ] && [ ! -f app/models/event-tcn-v1.bin ]; then
  # The GolfDB-derived model (CC BY-NC) is not in the public repo; a clone has none until training/ rebuilds it.
  skip model-parity "no event model in app/models (GolfDB-derived, not in the public repo; see docs/training.md)"
elif [ -f scripts/check_model_parity.mjs ] && [ -f scripts/check_model_card.mjs ]; then
  stage model-parity bash -c 'rc=0; node scripts/check_model_parity.mjs || rc=1; node scripts/check_model_card.mjs || rc=1; exit $rc'
else
  script_stage model-parity  scripts/check_model_parity.mjs
fi
script_stage synthetic-calib scripts/synth_calib.mjs
script_stage synthetic-e2e   scripts/synth_e2e.mjs
script_stage build           scripts/build.mjs
script_stage sw-version      scripts/check-sw.mjs

if [ "${RUN_BROWSER_E2E:-0}" = 1 ]; then
  script_stage browser-e2e tests/e2e/run.mjs
else
  skip browser-e2e "opt-in: set RUN_BROWSER_E2E=1"
fi

if [ "${RUN_TRAINING:-0}" = 1 ]; then
  if [ -d training/tests ]; then
    stage training training_check
  else
    skip training "training/tests not found yet"
  fi
else
  skip training "opt-in: set RUN_TRAINING=1"
fi

# ------------------------------------------------------------------ summary
if [ -n "$ONLY" ]; then
  for s in "${ALL_STAGES[@]}"; do want "$s" || NOTRUN+=("$s"); done
fi

printf '\n=== summary ===\n'
printf 'PASS=%d FAIL=%d SKIP=%d\n' "$pass_n" "$fail_n" "$skip_n"
[ "$fail_n" -gt 0 ] && printf 'failed:  %s\n' "${FAILED[*]}"
[ "$skip_n" -gt 0 ] && printf 'skipped: %s\n' "${SKIPPED[*]}"
if [ -n "$ONLY" ]; then
  printf 'PARTIAL RUN (--only %s); not run: %s\n' "$ONLY" "${NOTRUN[*]:-none}"
fi
if [ "$fail_n" -gt 0 ]; then
  echo "$fail_n stage(s) failed"
elif [ "$skip_n" -gt 0 ] || [ -n "$ONLY" ]; then
  echo "no failures, but this is NOT a full verification (skipped or partial run)"
else
  echo "all stages passed"
fi
if [ "$fail_n" -gt 255 ]; then exit 255; fi
exit "$fail_n"
