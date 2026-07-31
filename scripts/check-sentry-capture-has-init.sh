#!/usr/bin/env bash
# Sentry capture-has-init guard — the INVERSE invariant (FOLLOW-743).
#
# WHY THIS GUARD EXISTS
# ─────────────────────
# scripts/check-sentry-init-singleton.sh asserts "zero bare sentry_sdk.init(
# call sites outside observability.py" — it protects the SHAPE of an init that
# already exists. It is structurally blind to a module that never had an init
# at all: a file with zero `sentry_sdk.init(` occurrences trivially satisfies
# "zero bare init sites" while its own `capture_message`/`capture_exception`
# call is a permanent no-op (no bound Sentry client in that process).
#
# FOLLOW-743 found exactly this: `apps/llm-gateway/src/jobs/generate_description.py`
# called `sentry_sdk.capture_message(...)` on the daily LLM spend-cap alarm
# with no `init_sentry(` (and no `sentry_sdk.init(` either) anywhere in the
# module — invisible to check-sentry-init-singleton.sh by construction. This
# script is the sibling gate that closes that blind spot: it asserts the
# INVERSE — every module that CAPTURES must also INITIALISE.
#
# WHAT IS DETECTED
# ────────────────
# Python files under apps/*/src (excluding *test*.py, conftest.py, and the
# observability.py helper files themselves — they define capture_exception/
# capture_message-shaped call sites in comments only, never call them):
#   A file containing a real `sentry_sdk.capture_exception(` or
#   `sentry_sdk.capture_message(` call must also contain a real
#   `init_sentry(` call somewhere in the SAME file.
#
# EXPECTED COUNT: exactly 0 violations.
#   Every file with a capture call must also carry an init_sentry(...) call
#   in that same file (the init may be a no-op at runtime if SENTRY_DSN is
#   unset — that is fine; this guard only checks the CALL SHAPE is present,
#   the DSN-gating behaviour itself is covered by init_sentry()'s own tests).
#
# ALLOWLIST
# ─────────
# If a capture call is deliberately served by an init in a DIFFERENT process
# entry point (rare — document why), suppress it with an inline comment on
# the same line as the capture call:
#
#   sentry_sdk.capture_message(...)  # sentry-init-guard: allowlisted — <reason>
#
# The comment MUST contain the literal string "sentry-init-guard: allowlisted".
#
# SCAN DIR
# ────────
# Parameterised via SENTRY_CAPTURE_INIT_TARGET (default: apps/*/src in repo
# root). The --self-test mode points this env var at a temp directory so the
# detector can be verified without touching the real source tree.
#
# SELF-TEST
# ─────────
# bash scripts/check-sentry-capture-has-init.sh --self-test
#
# Includes a NEGATIVE CONTROL fixture (a capture-without-init module) that
# reproduces the exact shape FOLLOW-743 found. Run against the real tree
# BEFORE the FOLLOW-743 AC-1 fix landed, this script itself (not just the
# self-test) failed on generate_description.py — see the PR body for the
# pasted before/after transcript.
#
# EXIT CODES
# ──────────
#   0 = pass (every capture-containing file also has an init_sentry( call, or
#       is explicitly allow-listed)
#   1 = violation (a capture call with no init_sentry( in the same file, and
#       not allow-listed)
#   2 = self-test failure (the guard itself is broken)

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Scans a single file and echoes it (as a violation) if it contains a real
# capture_exception(/capture_message( call with no init_sentry( call anywhere
# in the file, and the capture line(s) are not all allow-listed.
_check_file() {
  local file="$1"

  # Real (non-comment) capture lines.
  local capture_lines
  capture_lines=$(
    grep -nE "sentry_sdk\.(capture_exception|capture_message)\(" "$file" 2>/dev/null \
      | grep -vE "^[0-9]+:[[:space:]]*#" \
      || true
  )
  [[ -z "$capture_lines" ]] && return 0

  # Drop any capture line explicitly allow-listed inline.
  local unallowlisted
  unallowlisted=$(echo "$capture_lines" | grep -v "sentry-init-guard: allowlisted" || true)
  [[ -z "$unallowlisted" ]] && return 0

  # A real (non-comment) init_sentry( call anywhere in the same file clears it.
  if grep -nE "init_sentry\(" "$file" 2>/dev/null | grep -vE "^[0-9]+:[[:space:]]*#" | grep -q .; then
    return 0
  fi

  echo "$file"
  echo "$unallowlisted" | sed 's/^/  /'
}

# ── Self-test mode ────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--self-test" ]]; then
  echo "=== Self-test mode ==="
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' EXIT

  mkdir -p "$tmp_dir/app-a/src/jobs"

  # ── Negative control: capture-without-init (the exact FOLLOW-743 shape) ──
  cat > "$tmp_dir/app-a/src/jobs/rogue_capture.py" <<'PYEOF'
import sentry_sdk

def _spend_cap_exceeded():
    try:
        sentry_sdk.capture_message("daily spend cap reached", level="warning")
    except Exception:
        pass
PYEOF

  if SENTRY_CAPTURE_INIT_TARGET="$tmp_dir" bash "$0" > /dev/null 2>&1; then
    echo "SELF-TEST FAIL: a capture-without-init module was NOT detected."
    echo "  The guard is broken — check the grep patterns in this script."
    exit 2
  fi
  echo "OK: self-test PASSED — capture-without-init was correctly detected (red-first fixture)."
  rm -f "$tmp_dir/app-a/src/jobs/rogue_capture.py"

  # ── Positive control: capture served by init_sentry( in the same file ────
  cat > "$tmp_dir/app-a/src/jobs/clean_capture.py" <<'PYEOF'
import sentry_sdk
from jobs.observability import init_sentry

def _spend_cap_exceeded():
    try:
        init_sentry("SENTRY_DSN")
        sentry_sdk.capture_message("daily spend cap reached", level="warning")
    except Exception:
        pass
PYEOF

  if ! SENTRY_CAPTURE_INIT_TARGET="$tmp_dir" bash "$0" > /dev/null 2>&1; then
    echo "SELF-TEST FAIL: a capture correctly served by init_sentry( in-file was incorrectly flagged."
    exit 2
  fi
  echo "OK: self-test PASSED — capture served by an in-file init_sentry( was correctly allowed."
  rm -f "$tmp_dir/app-a/src/jobs/clean_capture.py"

  # ── Allowlist control: capture with no init, but inline-allowlisted ──────
  cat > "$tmp_dir/app-a/src/jobs/allowlisted_capture.py" <<'PYEOF'
import sentry_sdk

def _rare_case():
    try:
        sentry_sdk.capture_message("served by a different process")  # sentry-init-guard: allowlisted — served by main.py's entry init
    except Exception:
        pass
PYEOF

  if ! SENTRY_CAPTURE_INIT_TARGET="$tmp_dir" bash "$0" > /dev/null 2>&1; then
    echo "SELF-TEST FAIL: an explicitly allow-listed capture was incorrectly flagged."
    exit 2
  fi
  echo "OK: self-test PASSED — explicitly allow-listed capture was correctly ignored."

  echo ""
  echo "Self-test PASSED."
  exit 0
fi

# ── Real check ────────────────────────────────────────────────────────────────
TARGET="${SENTRY_CAPTURE_INIT_TARGET:-}"

echo "=== Sentry capture-has-init guard (FOLLOW-743) ==="

if [[ -n "$TARGET" ]]; then
  SCAN_DIRS=("$TARGET")
else
  SCAN_DIRS=()
  for d in "$ROOT"/apps/*/src; do
    [[ -d "$d" ]] && SCAN_DIRS+=("$d")
  done
fi

echo "Scanning: ${SCAN_DIRS[*]}"
echo ""

FILES=$(
  find "${SCAN_DIRS[@]}" -type f -name "*.py" \
    ! -name "*test*.py" \
    ! -name "conftest.py" \
    ! -name "observability.py" \
    2>/dev/null || true
)

VIOLATIONS=""
for f in $FILES; do
  result=$(_check_file "$f")
  [[ -n "$result" ]] && VIOLATIONS="${VIOLATIONS}${result}"$'\n'
done

if [[ -z "$VIOLATIONS" ]]; then
  echo "PASS: every capture_exception(/capture_message( call site has an"
  echo "init_sentry( call in the same file (or is explicitly allow-listed)."
  exit 0
fi

echo "FAIL: capture call site(s) found with no init_sentry( in the same file:"
echo ""
echo "$VIOLATIONS"
echo "FIX: add, before the capture call (see apps/intent-engine/src/nlp.py:314"
echo "or apps/llm-gateway/src/jobs/consume_embed_seed_requests.py:198 for the"
echo "pattern):"
echo "  from jobs.observability import init_sentry   # or the app-local import path"
echo "  init_sentry(\"SENTRY_DSN\")"
echo ""
echo "ALLOWLIST: if the capture is genuinely served by an init in a different"
echo "process entry point, add this comment on the capture line:"
echo "  # sentry-init-guard: allowlisted — <reason>"
echo ""
echo "See FOLLOW-743 / scripts/check-sentry-capture-has-init.sh header for full context."
exit 1
