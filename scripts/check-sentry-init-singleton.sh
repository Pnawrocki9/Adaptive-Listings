#!/usr/bin/env bash
# Sentry init singleton guard (FOLLOW-738 / ESC-045 item 4).
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
# Python files under apps/*/src (excluding *test*.py, conftest.py, and the
# observability.py helper files themselves):
#   sentry_sdk\.init\(
#
# EXPECTED COUNT: exactly 0
#   Every real `sentry_sdk.init(` call must live inside an observability.py
#   file (the canonical copy or one of its Rule J mirrors). All other Python
#   modules must call `init_sentry(<DSN_ENV_NAME>)` instead.
#
# SCAN DIR
# ────────
# Parameterised via SENTRY_INIT_TARGET (default: apps/*/src in repo root).
# The --self-test mode points this env var at a temp directory so the
# detector can be verified without touching the real source tree.
#
# SELF-TEST
# ─────────
# bash scripts/check-sentry-init-singleton.sh --self-test
#
# EXIT CODES
# ──────────
#   0 = pass (zero sentry_sdk.init( call sites outside observability.py)
#   1 = violation (a bare sentry_sdk.init( call site found outside the helper)
#   2 = self-test failure (the guard itself is broken)

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# ── Self-test mode ────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--self-test" ]]; then
  echo "=== Self-test mode ==="
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' EXIT

  mkdir -p "$tmp_dir/app-a/src"
  mkdir -p "$tmp_dir/app-b/src/jobs"

  # ── Positive control: the ONLY init call lives in observability.py ────────
  cat > "$tmp_dir/app-a/src/observability.py" <<'PYEOF'
import sentry_sdk

def init_sentry(dsn_env_name):
    sentry_sdk.init(dsn="placeholder", traces_sample_rate=0.0)
PYEOF

  cat > "$tmp_dir/app-a/src/main.py" <<'PYEOF'
from observability import init_sentry
# A comment mentioning sentry_sdk.init( must NOT count.
init_sentry("SENTRY_DSN")
PYEOF

  if ! SENTRY_INIT_TARGET="$tmp_dir" bash "$0" > /dev/null 2>&1; then
    echo "SELF-TEST FAIL: clean tree (init only inside observability.py) was incorrectly flagged."
    exit 2
  fi
  echo "OK: self-test PASSED — clean tree with init only inside the helper passed."

  # ── Negative control: a re-introduced bare init OUTSIDE the helper ────────
  cat > "$tmp_dir/app-b/src/jobs/rogue_consumer.py" <<'PYEOF'
import sentry_sdk
import os

dsn = os.environ.get("SENTRY_DSN")
if dsn:
    sentry_sdk.init(dsn=dsn, traces_sample_rate=0.0)
PYEOF

  if SENTRY_INIT_TARGET="$tmp_dir" bash "$0" > /dev/null 2>&1; then
    echo "SELF-TEST FAIL: a bare sentry_sdk.init( outside observability.py was NOT detected."
    echo "  The guard is broken — check the grep pattern in this script."
    exit 2
  fi
  echo "OK: self-test PASSED — re-introduced bare init outside the helper was correctly detected."

  echo ""
  echo "Self-test PASSED."
  exit 0
fi

# ── Real check ────────────────────────────────────────────────────────────────
TARGET="${SENTRY_INIT_TARGET:-}"

echo "=== Sentry init singleton guard (FOLLOW-738) ==="

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

MATCHES=$(
  grep -rn \
    --include="*.py" \
    --exclude="*test*.py" \
    --exclude="conftest.py" \
    --exclude="observability.py" \
    -E "sentry_sdk\.init\(" \
    "${SCAN_DIRS[@]}" 2>/dev/null \
  | grep -vE "^[^:]+:[0-9]+:[[:space:]]*#" \
  || true
)

if [[ -z "$MATCHES" ]]; then
  COUNT=0
else
  COUNT=$(echo "$MATCHES" | grep -c "sentry_sdk\.init(")
fi

if [[ "$COUNT" -eq 0 ]]; then
  echo "PASS: no sentry_sdk.init( call sites found outside observability.py."
  echo ""
  echo "Every Python Modal app must call the shared init_sentry(<DSN_ENV_NAME>)"
  echo "helper (apps/intent-engine/src/observability.py and its Rule J mirrors)"
  echo "instead of calling sentry_sdk.init() directly."
  exit 0
fi

echo "FAIL: $COUNT sentry_sdk.init( call site(s) found OUTSIDE observability.py."
echo ""
echo "$MATCHES"
echo ""
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
echo "See ESC-045 item 4 / FOLLOW-738 for full context."
exit 1
