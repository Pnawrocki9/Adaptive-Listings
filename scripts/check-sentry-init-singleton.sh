#!/usr/bin/env bash
# Sentry init singleton guard (FOLLOW-738 / ESC-045 item 4, holes closed by
# FOLLOW-746).
#
# WHY THIS GUARD EXISTS
# ─────────────────────
# Before FOLLOW-738, four Sentry init call sites existed across three Python
# Modal apps, reading the same bare SENTRY_DSN name and mounting the same
# modal.Secret.from_name("estalara-secrets"). Only one of the four
# (apps/intent-engine/src/nlp.py) set include_local_variables=False,
# send_default_pii=False and an explicit integration list. Provisioning
# SENTRY_DSN would have silently switched on frame-locals capture and the
# default LoggingIntegration on the other three — a new disclosure surface
# opened by the SAME operator action meant to close a missing-alerting gap.
#
# FOLLOW-738 extracted ONE shared, hardened initialiser (`init_sentry()`),
# mirrored byte-identically (Rule J) into all three apps as observability.py.
# This script is the committed CI gate that makes a re-introduced bare
# `sentry_sdk.init(` call impossible to miss at PR time. It mirrors the
# pattern of scripts/check-modal-app-singleton.sh (FOLLOW-438).
#
# WHAT IS DETECTED
# ────────────────
# Python files under apps/*/src:
#   a REAL `sentry_sdk.init(` call site — i.e. one that survives
#   `clean_python_source()` (scripts/lib/clean-python-source.sh), which blanks
#   comments, trailing comments, string literals and docstrings.
#
# EXPECTED COUNT: exactly 0 violations AND 0 unparseable files.
#   Every real `sentry_sdk.init(` call must live inside one of the Rule J
#   mirror paths REGISTERED in scripts/mirror-files.json (the canonical
#   apps/intent-engine/src/observability.py and its two mirrors). All other
#   Python modules must call `init_sentry(<DSN_ENV_NAME>)` instead.
#
# EXCLUSIONS — and the four holes FOLLOW-746 closed
# ─────────────────────────────────────────────────
#   1. REGISTERED MIRROR PATHS, not the basename (FOLLOW-746 AC2). The
#      exclusion list is READ FROM scripts/mirror-files.json and matched
#      against each file's path relative to the scan root, so
#      `apps/<new-app>/src/observability.py` — a 4th, UNREGISTERED copy —
#      is scanned and its bare init is caught. The old `--exclude=
#      "observability.py"` skipped every file with that basename, registered
#      or not, and failed SILENTLY (false GREEN).
#      NOTE (FOLLOW-746 item 7): this exclusion is load-bearing HERE and has
#      no counterpart in check-sentry-capture-has-init.sh, which REMOVED its
#      basename exclusion in PR #648 after verifying the mirrors hold zero
#      capture call sites. The registered mirrors are exactly where the
#      legitimate `sentry_sdk.init(` lives, so this gate must exclude them and
#      the two gates legitimately differ. Do not "converge" them.
#   2. TEST FILES BY ANCHORED CONVENTION, not by substring (FOLLOW-746
#      item 6): `test_*.py`, `*_test.py`, `conftest.py`. The old
#      `--exclude="*test*.py"` also skipped production basenames that merely
#      CONTAIN "test" — `latest_pricing.py`, `contest.py`,
#      `attestation_report.py` — so a bare `sentry_sdk.init(` in one of them
#      was silently unseen. Verbatim the substring-glob shape FOLLOW-757 fixed
#      in the sibling gate. Latent, not live, when fixed (all `*test*`
#      basenames under apps/*/src were genuine test files) — the same status
#      the other closed shapes had.
#   3. COMMENTS AND DOCSTRINGS ARE NOT VIOLATIONS (FOLLOW-746 AC3). The old
#      filter was `grep -vE "^[^:]+:[0-9]+:[[:space:]]*#"`, i.e. WHOLE-LINE
#      comments only, so a trailing comment (`foo = 1  # replaces
#      sentry_sdk.init(`) or a docstring mention (no `#` at all) hard-failed
#      CI. That direction is a false RED — loud, not silent — but it trains
#      readers to route around the gate. Both shapes are now handled by the
#      shared tokenizer pass rather than by a widened regex.
#   4. A FILE THAT CANNOT BE TOKENIZED IS A FINDING, NOT A PASS (FOLLOW-760
#      contract, inherited via the shared helper). It is reported under its
#      own distinct "UNPARSEABLE" heading and fails the gate; it is never
#      silently cleared and never falls back to raw-text matching.
#
# SHARED HELPER (FOLLOW-746 item 8 — the copy decision)
# ────────────────────────────────────────────────────
# The tokenizer pass lives in scripts/lib/clean-python-source.sh and is SOURCED
# by both this gate and check-sentry-capture-has-init.sh. It was deliberately
# NOT copied here and NOT registered as a Rule J mirror pair; the full
# reasoning is recorded in that file's header. A missing helper fails this gate
# with exit 2 — it never degrades to raw-text matching.
#
# SCAN DIR
# ────────
# Parameterised via SENTRY_INIT_TARGET (default: apps/*/src in repo root); the
# manifest via SENTRY_INIT_MIRROR_MANIFEST (default: scripts/mirror-files.json).
# The --self-test mode points both at a temp directory so the detector can be
# verified without touching the real source tree or the real manifest.
#
# KNOWN, DELIBERATELY UNGUARDED GAPS (Rule AE-as-amended — verified not live,
# recorded so they are not silently reintroduced as surprises):
#   A. SCAN_DIRS is only "$ROOT"/apps/*/src — a `sentry_sdk.init(` under
#      packages/, scripts/, tests/integration/ or apps/*/tests/ is unscanned.
#      Verified zero such call sites repo-wide today:
#        grep -rn "sentry_sdk\.init(" --include=*.py . | grep -v apps/./src/
#   B. The detection regex requires the literal `sentry_sdk.` prefix. A module
#      doing `from sentry_sdk import init` (or `import sentry_sdk as s`) and
#      calling the bare name is invisible here — the SAME residual CB-3 that
#      check-sentry-capture-has-init.sh records as its gap 7. Verified zero
#      such imports repo-wide today:
#        grep -rn "from sentry_sdk import\|import sentry_sdk as" --include=*.py .
#      Fixing it belongs in ONE ticket covering both gates (it is now literally
#      the same residual on both sides of the shared helper), not here.
#   C. A registered mirror path is excluded WHOLESALE — this gate does not
#      verify that the init inside it is the hardened one. That invariant is
#      held by Rule J byte-identity (check-mirror-files.sh) plus
#      apps/intent-engine/src/test_observability.py, not by this script.
#   D. `for f in $FILES` (in the real-check loop below) is unquoted word
#      splitting — a filename containing IFS whitespace would break it. No such
#      filename exists in the repo today. Same residual as gap 6 of
#      check-sentry-capture-has-init.sh; both would be fixed together.
#   None of A/B/D is fixed here (out of this ticket's AC); the class is
#   therefore NOT fully enumerated-and-guarded — it is documented-and-open.
#
# SELF-TEST
# ─────────
# bash scripts/check-sentry-init-singleton.sh --self-test
#
# One fixture per hole above, each RED-FIRST against the pre-FOLLOW-746 script:
# the item-6 (`latest_pricing.py`) and AC2 (unregistered `observability.py`)
# fixtures PASS there when they should fail (silent false GREEN); the AC3
# (trailing-comment, docstring) fixtures FAIL there when they should pass
# (false RED); and the FOLLOW-760 (unparseable) fixture exits 1 there under the
# WRONG diagnosis — the old script reports a confirmed `sentry_sdk.init(` call
# site on a file it never actually evaluated, when the only occurrence is in a
# comment. See the PR body for the pasted before/after transcript.
# Positive controls assert the exclusions still exclude what they must
# (registered mirrors, genuine test files) so a "fix" cannot be a deletion.
# All exit-code assertions check the SPECIFIC expected code, not merely
# non-zero.
#
# EXIT CODES
# ──────────
#   0 = pass (zero real sentry_sdk.init( call sites outside the registered
#       mirror paths, and every scanned file tokenized cleanly)
#   1 = finding — EITHER a real bare sentry_sdk.init( call site outside the
#       registered mirrors, OR a file whose init shape could not be verified
#       because python3 could not tokenize it, OR the mirror manifest could
#       not be read (the gate must not guess its own exclusion list)
#   2 = self-test failure, or the shared helper is missing (the guard itself
#       is broken)

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Shared helper: comment/docstring/string stripper (FOLLOW-746 item 8) ──────
CLEAN_LIB="$SCRIPT_DIR/lib/clean-python-source.sh"
if [[ ! -f "$CLEAN_LIB" ]]; then
  echo "FAIL: shared helper not found: $CLEAN_LIB"
  echo "This gate cannot evaluate Python sources without it, and must NOT fall"
  echo "back to raw-text matching (FOLLOW-746 item 8 / FOLLOW-760)."
  exit 2
fi
# shellcheck source=lib/clean-python-source.sh
source "$CLEAN_LIB"
if ! declare -F clean_python_source > /dev/null 2>&1; then
  echo "FAIL: $CLEAN_LIB did not define clean_python_source()."
  exit 2
fi

MANIFEST="${SENTRY_INIT_MIRROR_MANIFEST:-$ROOT/scripts/mirror-files.json}"

# Prints the .py paths registered in the Rule J manifest (canonical + mirror),
# one per line, deduped. Exits 3 if the manifest is missing or unparseable —
# the caller turns that into a hard failure rather than scanning with an empty
# (or basename-shaped) exclusion list.
_registered_mirror_py_paths() {
  python3 - "$MANIFEST" <<'PYEOF'
import json
import sys

path = sys.argv[1]
try:
    with open(path, "r", encoding="utf-8") as f:
        pairs = json.load(f)
    out = []
    for pair in pairs:
        for key in ("canonical", "mirror"):
            value = pair.get(key)
            if value and value.endswith(".py") and value not in out:
                out.append(value)
    sys.stdout.write("\n".join(out))
    if out:
        sys.stdout.write("\n")
except Exception as exc:
    print(f"mirror manifest error on {path}: {exc}", file=sys.stderr)
    sys.exit(3)
PYEOF
}

# ── Self-test mode ────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--self-test" ]]; then
  echo "=== Self-test mode ==="
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' EXIT

  st_manifest="$tmp_dir/mirror-files.json"
  st_out="$tmp_dir/.self_test_output"

  mkdir -p "$tmp_dir/app-a/src"
  mkdir -p "$tmp_dir/app-b/src/jobs"

  # The temp manifest registers the two helper copies below, exactly as
  # scripts/mirror-files.json registers the three real ones. Paths are relative
  # to the scan root (here $tmp_dir; in a real run, the repo root).
  cat > "$st_manifest" <<'JSONEOF'
[
  {
    "canonical": "app-a/src/observability.py",
    "mirror": "app-b/src/jobs/observability.py",
    "strip_comments": true
  }
]
JSONEOF

  # Runs the gate over the fixture tree; stores output in $st_out, echoes rc.
  _st_run() {
    local rc=0
    SENTRY_INIT_TARGET="$tmp_dir" \
      SENTRY_INIT_MIRROR_MANIFEST="$st_manifest" \
      bash "$0" > "$st_out" 2>&1 || rc=$?
    echo "$rc"
  }

  # Asserts the fixture tree is reported CLEAN (exit 0).
  _st_expect_clean() {
    local label="$1"
    local rc
    rc=$(_st_run)
    if [[ "$rc" -ne 0 ]]; then
      echo "SELF-TEST FAIL: $label — expected a clean pass (0), got $rc."
      echo "--- gate output ---"
      cat "$st_out"
      exit 2
    fi
    echo "OK: self-test PASSED — $label"
  }

  # Asserts the fixture tree is FLAGGED with exit code 1, and (optionally) that
  # the output contains a required diagnostic string.
  _st_expect_flagged() {
    local label="$1"
    local needle="${2:-}"
    local rc
    rc=$(_st_run)
    if [[ "$rc" -eq 0 ]]; then
      echo "SELF-TEST FAIL: $label — the violation was NOT detected (exit 0)."
      echo "--- gate output ---"
      cat "$st_out"
      exit 2
    elif [[ "$rc" -ne 1 ]]; then
      echo "SELF-TEST FAIL: $label — expected the finding exit code (1), got $rc."
      echo "--- gate output ---"
      cat "$st_out"
      exit 2
    fi
    if [[ -n "$needle" ]] && ! grep -q "$needle" "$st_out"; then
      echo "SELF-TEST FAIL: $label — flagged, but without the expected"
      echo "  diagnostic '$needle' in the output."
      echo "--- gate output ---"
      cat "$st_out"
      exit 2
    fi
    echo "OK: self-test PASSED — $label"
  }

  # ── Positive control 1: the real init lives in the REGISTERED mirrors ─────
  cat > "$tmp_dir/app-a/src/observability.py" <<'PYEOF'
import sentry_sdk

def init_sentry(dsn_env_name):
    sentry_sdk.init(dsn="placeholder", traces_sample_rate=0.0)
PYEOF
  cp "$tmp_dir/app-a/src/observability.py" "$tmp_dir/app-b/src/jobs/observability.py"

  cat > "$tmp_dir/app-a/src/main.py" <<'PYEOF'
from observability import init_sentry
# A whole-line comment mentioning sentry_sdk.init( must NOT count.
init_sentry("SENTRY_DSN")
PYEOF

  _st_expect_clean "registered mirrors hold the only real init; whole-line comment ignored."

  # ── Positive control 2: genuine test-convention files stay excluded ───────
  # Guards against "fixing" the substring glob by deleting the exclusion.
  for tf in test_main.py main_test.py conftest.py; do
    cat > "$tmp_dir/app-a/src/$tf" <<'PYEOF'
import sentry_sdk

def _fixture():
    sentry_sdk.init(dsn="test-only", traces_sample_rate=0.0)
PYEOF
  done
  _st_expect_clean "genuine test-convention files (test_*.py, *_test.py, conftest.py) still excluded."
  rm -f "$tmp_dir/app-a/src/test_main.py" "$tmp_dir/app-a/src/main_test.py" \
    "$tmp_dir/app-a/src/conftest.py"

  # ── FOLLOW-746 AC3 (a): a TRAILING comment must not be a violation ────────
  # Against the pre-FOLLOW-746 script this fixture FAILS (false RED): the old
  # filter only dropped WHOLE-LINE comments.
  cat > "$tmp_dir/app-a/src/trailing_comment.py" <<'PYEOF'
from observability import init_sentry

_migrated = 1  # init_sentry() replaces the old sentry_sdk.init( call here

init_sentry("SENTRY_DSN")
PYEOF
  _st_expect_clean "FOLLOW-746 AC3(a) — a TRAILING comment mentioning sentry_sdk.init( is not a violation."
  rm -f "$tmp_dir/app-a/src/trailing_comment.py"

  # ── FOLLOW-746 AC3 (b): a DOCSTRING mention must not be a violation ───────
  # Against the pre-FOLLOW-746 script this fixture FAILS (false RED): there is
  # no `#` on the line at all, so the whole-line-comment filter never saw it.
  cat > "$tmp_dir/app-a/src/docstring_mention.py" <<'PYEOF'
"""Module docs.

Historically this module called sentry_sdk.init( directly; it now defers to
the shared hardened initialiser instead.
"""
from observability import init_sentry

init_sentry("SENTRY_DSN")
PYEOF
  _st_expect_clean "FOLLOW-746 AC3(b) — a DOCSTRING mention of sentry_sdk.init( is not a violation."
  rm -f "$tmp_dir/app-a/src/docstring_mention.py"

  # ── Negative control (FOLLOW-738 original): a re-introduced bare init ─────
  cat > "$tmp_dir/app-b/src/jobs/rogue_consumer.py" <<'PYEOF'
import sentry_sdk
import os

dsn = os.environ.get("SENTRY_DSN")
if dsn:
    sentry_sdk.init(dsn=dsn, traces_sample_rate=0.0)
PYEOF
  _st_expect_flagged "a bare sentry_sdk.init( outside the registered mirrors is detected." \
    "rogue_consumer.py"
  rm -f "$tmp_dir/app-b/src/jobs/rogue_consumer.py"

  # ── FOLLOW-746 AC2: an UNREGISTERED observability.py must be scanned ──────
  # Against the pre-FOLLOW-746 script this fixture PASSES (silent false GREEN
  # — the 4th-copy hole this ticket closes): `--exclude="observability.py"`
  # skipped every file with that basename, registered or not.
  mkdir -p "$tmp_dir/app-c/src"
  cat > "$tmp_dir/app-c/src/observability.py" <<'PYEOF'
import sentry_sdk

def init_sentry(dsn_env_name):
    # A 4th copy nobody registered in scripts/mirror-files.json, and NOT the
    # hardened initialiser: no include_local_variables/send_default_pii.
    sentry_sdk.init(dsn="unregistered", traces_sample_rate=1.0)
PYEOF
  _st_expect_flagged "FOLLOW-746 AC2 — an UNREGISTERED observability.py is scanned, not basename-excluded." \
    "app-c/src/observability.py"
  rm -rf "$tmp_dir/app-c"

  # ── FOLLOW-746 item 6: a production basename CONTAINING "test" ────────────
  # Against the pre-FOLLOW-746 script this fixture PASSES (silent false GREEN):
  # `--exclude="*test*.py"` matches `latest_pricing.py`, whose basename contains
  # "test" as a substring ("la-test-_pricing").
  cat > "$tmp_dir/app-a/src/latest_pricing.py" <<'PYEOF'
import sentry_sdk

def _boot():
    sentry_sdk.init(dsn="substring-name-masked", traces_sample_rate=1.0)
PYEOF
  _st_expect_flagged "FOLLOW-746 item 6 — a production basename containing 'test' (latest_pricing.py) is scanned." \
    "latest_pricing.py"
  rm -f "$tmp_dir/app-a/src/latest_pricing.py"

  # ── FOLLOW-760 contract: an UNPARSEABLE file is a loud finding ────────────
  # The shared helper writes nothing and exits 3 when python3 cannot tokenize a
  # file. This asserts the gate reports that as its own distinctly-tagged
  # finding instead of silently clearing the file or crashing.
  # The file's ONLY `sentry_sdk.init(` is inside a trailing comment, so the
  # honest answer is "not verifiable", not "violation": against the
  # pre-FOLLOW-746 script this fixture exits 1 claiming a confirmed call site
  # that does not exist (raw-text match on a file it never evaluated).
  cat > "$tmp_dir/app-a/src/unparseable.py" <<'PYEOF'
import sentry_sdk

_x = 1  # the only sentry_sdk.init( on this file is in THIS comment

_trailing = '''this triple-quoted string is never closed, so tokenize fails
PYEOF
  _st_expect_flagged "FOLLOW-760 — a file python3 cannot tokenize is a LOUD, distinctly-tagged finding." \
    "UNPARSEABLE"
  rm -f "$tmp_dir/app-a/src/unparseable.py"

  # ── Manifest failure must be loud, not an empty exclusion list ────────────
  rc=0
  SENTRY_INIT_TARGET="$tmp_dir" \
    SENTRY_INIT_MIRROR_MANIFEST="$tmp_dir/does-not-exist.json" \
    bash "$0" > "$st_out" 2>&1 || rc=$?
  if [[ "$rc" -ne 1 ]] || ! grep -q "mirror manifest" "$st_out"; then
    echo "SELF-TEST FAIL: an unreadable mirror manifest must fail the gate (exit 1) with a"
    echo "  'mirror manifest' diagnosis — the gate must not guess its own exclusion list."
    echo "  Got exit $rc."
    echo "--- gate output ---"
    cat "$st_out"
    exit 2
  fi
  echo "OK: self-test PASSED — an unreadable mirror manifest fails the gate loudly."

  echo ""
  echo "Self-test PASSED."
  exit 0
fi

# ── Real check ────────────────────────────────────────────────────────────────
TARGET="${SENTRY_INIT_TARGET:-}"

echo "=== Sentry init singleton guard (FOLLOW-738 / FOLLOW-746) ==="

if [[ -n "$TARGET" ]]; then
  SCAN_DIRS=("$TARGET")
  SCAN_ROOT="$TARGET"
else
  SCAN_DIRS=()
  for d in "$ROOT"/apps/*/src; do
    [[ -d "$d" ]] && SCAN_DIRS+=("$d")
  done
  SCAN_ROOT="$ROOT"
fi

echo "Scanning: ${SCAN_DIRS[*]}"
echo ""

# ── Registered Rule J mirror paths = the ONLY legitimate init sites ──────────
REGISTERED=""
manifest_rc=0
REGISTERED=$(_registered_mirror_py_paths) || manifest_rc=$?
if [[ "$manifest_rc" -ne 0 ]]; then
  echo "FAIL: could not read the Rule J mirror manifest: $MANIFEST"
  echo ""
  echo "This gate derives its exclusion list from the registered mirror paths"
  echo "(FOLLOW-746 AC2). Without the manifest it would have to guess — either"
  echo "excluding by basename (the 4th-copy hole this ticket closed) or"
  echo "excluding nothing (a false RED on the legitimate mirrors). Neither is"
  echo "acceptable, so an unreadable manifest is a hard failure."
  exit 1
fi

echo "Registered Rule J mirror paths (the only legitimate sentry_sdk.init( sites):"
if [[ -n "$REGISTERED" ]]; then
  echo "$REGISTERED" | sed 's/^/  /'
else
  echo "  (none registered — every sentry_sdk.init( call site will be flagged)"
fi
echo ""

FILES=$(
  find "${SCAN_DIRS[@]}" -type f -name "*.py" \
    ! -name "test_*.py" \
    ! -name "*_test.py" \
    ! -name "conftest.py" \
    2>/dev/null || true
)

VIOLATIONS=""
VIOLATION_COUNT=0
UNPARSEABLE=""
UNPARSEABLE_COUNT=0
EXCLUDED_COUNT=0
EXCLUDED_LIST=""

for f in $FILES; do
  rel="${f#"$SCAN_ROOT"/}"

  # Registered mirror path → the init inside it is the legitimate one.
  if [[ -n "$REGISTERED" ]] && printf '%s\n' "$REGISTERED" | grep -Fxq -- "$rel"; then
    EXCLUDED_COUNT=$((EXCLUDED_COUNT + 1))
    EXCLUDED_LIST="${EXCLUDED_LIST}  ${rel}"$'\n'
    continue
  fi

  cleaned=""
  clean_rc=0
  # `clean_python_source` exits 3 (no stdout) when python3 cannot tokenize the
  # file. Capture that via `||` so it does not trip `set -e` — this is "cannot
  # evaluate", which must be reported, not swallowed (FOLLOW-760).
  cleaned=$(clean_python_source "$f") || clean_rc=$?
  if [[ "$clean_rc" -ne 0 ]]; then
    UNPARSEABLE="${UNPARSEABLE}  ${rel} (python3 tokenize exit $clean_rc — init shape NOT verified)"$'\n'
    UNPARSEABLE_COUNT=$((UNPARSEABLE_COUNT + 1))
    continue
  fi

  hits=$(printf '%s\n' "$cleaned" | grep -nE "sentry_sdk\.init\(" | cut -d: -f1 || true)
  [[ -z "$hits" ]] && continue

  while IFS= read -r ln; do
    [[ -z "$ln" ]] && continue
    orig_line=$(sed -n "${ln}p" "$f")
    VIOLATIONS="${VIOLATIONS}  ${rel}:${ln}:${orig_line}"$'\n'
    VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
  done <<< "$hits"
done

echo "Registered mirror files excluded from the scan: $EXCLUDED_COUNT"
if [[ "$EXCLUDED_COUNT" -gt 0 ]]; then
  printf '%s' "$EXCLUDED_LIST"
fi
echo ""

echo "UNPARSEABLE FILES (python3 could not tokenize; treated as findings, not"
echo "silently cleared — FOLLOW-760): $UNPARSEABLE_COUNT"
if [[ "$UNPARSEABLE_COUNT" -gt 0 ]]; then
  printf '%s' "$UNPARSEABLE"
fi
echo ""

if [[ "$VIOLATION_COUNT" -eq 0 && "$UNPARSEABLE_COUNT" -eq 0 ]]; then
  echo "PASS: no real sentry_sdk.init( call sites found outside the registered"
  echo "Rule J mirror paths, and every scanned file tokenized cleanly."
  echo ""
  echo "Every Python Modal app must call the shared init_sentry(<DSN_ENV_NAME>)"
  echo "helper (apps/intent-engine/src/observability.py and its Rule J mirrors)"
  echo "instead of calling sentry_sdk.init() directly."
  exit 0
fi

if [[ "$VIOLATION_COUNT" -gt 0 ]]; then
  echo "FAIL: $VIOLATION_COUNT real sentry_sdk.init( call site(s) found OUTSIDE the"
  echo "registered Rule J mirror paths:"
  echo ""
  printf '%s\n' "$VIOLATIONS"
  echo "ESC-045 item 4 hazard (FOLLOW-738): every Python Modal app shares one"
  echo "SENTRY_DSN and one Modal secret. A bare sentry_sdk.init() call here"
  echo "silently ships frame locals (send_default_pii/include_local_variables"
  echo "default to unsafe) and installs the default LoggingIntegration the"
  echo "moment SENTRY_DSN is provisioned."
  echo ""
  echo "FIX: replace the call above with:"
  echo "  from observability import init_sentry   # or the app-local import path"
  echo "  init_sentry(\"SENTRY_DSN\")"
  echo ""
  echo "If the file IS a legitimate new Rule J copy of the hardened helper,"
  echo "register it in scripts/mirror-files.json (canonical + mirror) — the"
  echo "mirror gate then enforces byte-identity on it, and this gate excludes"
  echo "it. A 4th, unregistered copy is exactly what FOLLOW-746 closed."
  echo ""
fi

if [[ "$UNPARSEABLE_COUNT" -gt 0 ]]; then
  echo "FAIL: the file(s) above could not be tokenized by python3 — their"
  echo "sentry_sdk.init( shape could NOT be verified, so each is treated as a"
  echo "finding rather than silently cleared (FOLLOW-760: a gate that cannot"
  echo "evaluate a file must not report it clean). See stderr above for the"
  echo "tokenizer error on each path."
  echo ""
  echo "FIX: make the file tokenizable (fix the syntax/encoding error)."
  echo ""
fi

echo "See ESC-045 item 4 / FOLLOW-738 / FOLLOW-746 and this script's header for"
echo "full context."
exit 1
