#!/usr/bin/env bash
# Modal App singleton guard (FOLLOW-438 / RETRO-143 §4a LG-1).
#
# WHY THIS GUARD EXISTS
# ─────────────────────
# BUG 2 from ESC-034: both generate_description.py and
# consume_embed_seed_requests.py each declared their own
# modal.App("estalara-description-generator").  In Modal, deploying either file
# alone wiped the other's functions from the live app — a silent, destructive
# collision.  FOLLOW-437 (PR #393) fixed the root cause by extracting a single
# shared instance into apps/llm-gateway/src/jobs/_app.py; both consumers now
# import `app` from there.
#
# That structural fix leaves no mechanical guard preventing a future developer
# from re-introducing a standalone modal.App() in a new consumer file.  This
# script is the committed CI gate that makes recurrence impossible to miss at
# PR time.  It mirrors the pattern of scripts/check-fire-and-forget-sinks.sh
# (FOLLOW-433), which used the same approach to close the fire-and-forget sweep
# gap that two consecutive "verify by grep" ACs both missed.
#
# WHAT IS DETECTED
# ────────────────
# Python files in apps/llm-gateway/src (excluding *test*.py and conftest.py):
#   ^\s*<identifier>\s*=\s*modal\.App\(
#
# This matches actual assignment statements — the only form that creates a real
# modal.App object.  It deliberately does NOT match:
#   - Comment lines (lines whose first non-whitespace char is #).
#   - String literals / docstrings that mention modal.App().
#   - MagicMock(name="modal.App()") in conftest.py.
#   - Test files (*test*.py, conftest.py) which may reference the string in
#     descriptions or mocks without creating a real app object.
#
# EXPECTED COUNT: exactly 1
#   The only real instantiation is:
#     apps/llm-gateway/src/jobs/_app.py:  app = modal.App("estalara-description-generator")
#   All other consumer modules must import `app` from jobs._app, never
#   re-instantiate it.  See ESC-034 / FOLLOW-437 / RETRO-143.
#
# SCAN DIR
# ────────
# Parameterised via MODAL_APP_TARGET (default: apps/llm-gateway/src in repo
# root).  The --self-test mode points this env var at a temp directory so the
# detector can be verified without touching the real source tree.
#
# SELF-TEST
# ─────────
# bash scripts/check-modal-app-singleton.sh --self-test
#
# Writes synthetic Python files to a temp directory:
#   - A negative control: a second modal.App assignment that MUST be detected
#     (guard must exit non-zero).
#   - A positive control: only one modal.App assignment (guard must exit zero).
# The CI job runs self-test before the real check so a broken script cannot
# silently pass the gate.
#
# EXIT CODES
# ──────────
#   0 = pass (exactly 1 real modal.App instantiation found)
#   1 = violation (0 or ≥2 instantiations found)
#   2 = self-test failure (the guard itself is broken)

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# ── Self-test mode ────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--self-test" ]]; then
  echo "=== Self-test mode ==="
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' EXIT

  mkdir -p "$tmp_dir/jobs"

  # ── Negative control: two real modal.App assignments → must be detected ────
  cat > "$tmp_dir/jobs/_app.py" <<'PYEOF'
import modal
app = modal.App("estalara-description-generator")
PYEOF

  cat > "$tmp_dir/jobs/other_consumer.py" <<'PYEOF'
import modal
# This is the problematic BUG-2 pattern: a second standalone modal.App().
app = modal.App("estalara-description-generator")
PYEOF

  if MODAL_APP_TARGET="$tmp_dir" bash "$0" > /dev/null 2>&1; then
    echo "SELF-TEST FAIL: two modal.App() assignments were NOT detected."
    echo "  The guard is broken — check the grep pattern in this script."
    exit 2
  fi
  echo "OK: self-test PASSED — duplicate modal.App() was correctly detected."

  # ── Positive control: exactly one assignment in a comment-heavy file ────────
  rm -f "$tmp_dir/jobs/other_consumer.py"

  # Add a comment-only mention and a docstring mention — must NOT count.
  cat > "$tmp_dir/jobs/generate_description.py" <<'PYEOF'
"""
Previously this module declared its own modal.App("estalara-description-generator").
Now it imports from _app.py.
"""
# modal.App("estalara-description-generator") — removed by FOLLOW-437
from jobs._app import app  # shared instance
PYEOF

  if ! MODAL_APP_TARGET="$tmp_dir" bash "$0" > /dev/null 2>&1; then
    echo "SELF-TEST FAIL: single-assignment (with comment noise) was incorrectly flagged."
    exit 2
  fi
  echo "OK: self-test PASSED — comment/docstring mentions were correctly ignored."

  echo ""
  echo "Self-test PASSED."
  exit 0
fi

# ── Real check ────────────────────────────────────────────────────────────────
TARGET="${MODAL_APP_TARGET:-${ROOT}/apps/llm-gateway/src}"

echo "=== Modal App singleton guard (FOLLOW-438) ==="
echo "Scanning: $TARGET"
echo ""

# Grep for real assignment statements only:
#   ^\s*<identifier>\s*=\s*modal\.App\(
#
# Excludes:
#   - *test*.py files (may mock modal.App in test strings/mocks)
#   - conftest.py     (contains MagicMock(name="modal.App()"))
#   - Lines whose first non-whitespace character is # (comments)

MATCHES=$(
  grep -rn \
    --include="*.py" \
    --exclude="*test*.py" \
    --exclude="conftest.py" \
    -E "^\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*modal\.App\(" \
    "$TARGET" 2>/dev/null \
  | grep -v "^\s*#" \
  || true
)

COUNT=$(echo "$MATCHES" | grep -c "modal\.App(" 2>/dev/null || echo "0")

if [[ "$COUNT" -eq 1 ]]; then
  echo "PASS: Exactly 1 modal.App() instantiation found (expected)."
  echo ""
  echo "$MATCHES"
  echo ""
  echo "The shared instance lives in apps/llm-gateway/src/jobs/_app.py."
  echo "All consumer modules must import \`app\` from there — never re-instantiate."
  exit 0
fi

if [[ "$COUNT" -eq 0 ]]; then
  echo "FAIL: No modal.App() instantiation found in $TARGET"
  echo ""
  echo "Expected exactly 1 real instantiation in apps/llm-gateway/src/jobs/_app.py."
  echo "If the shared module was renamed or deleted, update this guard accordingly."
  echo ""
  echo "See ESC-034 / FOLLOW-437 / RETRO-143 for context."
  exit 1
fi

echo "FAIL: $COUNT modal.App() instantiations found — expected exactly 1."
echo ""
echo "$MATCHES"
echo ""
echo "BUG 2 (ESC-034) recurrence detected: multiple modal.App() calls create a"
echo "silent name collision — deploying any one consumer file wipes the others'"
echo "functions from the live Modal app."
echo ""
echo "FIX: Remove the standalone modal.App() call(s) above."
echo "     Import the shared \`app\` object from apps/llm-gateway/src/jobs/_app.py instead:"
echo "       from jobs._app import app"
echo ""
echo "See ESC-034 / FOLLOW-437 / RETRO-143 for full context."
exit 1
