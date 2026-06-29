#!/usr/bin/env bash
# Fire-and-forget sink guard (FOLLOW-433 / ESC-033).
#
# WHY THIS GUARD EXISTS
# ─────────────────────
# On Vercel, any Promise-based work that starts after `return NextResponse.json(…)`
# is silently dropped when the function instance suspends.  The correct pattern is
# to register async work through afterResponse() (→ next/server after()), which
# keeps the instance alive until the work completes.
#
# FOLLOW-431 + FOLLOW-432 wrapped 11 sinks but shipped a "verify by grep" AC that
# was false both times — 3 further sinks survived (RETRO-138 / RETRO-139).  This
# script is the committed CI gate that makes the AC verifiable automatically.
#
# WHAT IS DETECTED
# ────────────────
# Patterns in apps/control-plane/src (excluding *.test.ts):
#   1. void <identifier>(   — fire-and-forget function call (most common form)
#   2. void (async          — fire-and-forget async IIFE
#
# A match is a violation when the async work runs outside an
# afterResponse()/after()/ctx.waitUntil() wrapper.  Because wrapping removes the
# `void` keyword entirely (the task is passed as a callback, not called inline),
# any remaining bare `void <ident>(` in the source tree IS an unwrapped sink.
#
# ALLOWLIST
# ─────────
# If a `void <ident>(` pattern is intentional and safe (e.g. the `void` targets a
# non-async function or is inside a non-request-path initialiser), suppress it with
# an inline comment on the same line:
#
#   void someSync();  // ff-guard: allowlisted — not async, no Vercel flush risk
#
# The comment MUST contain the literal string "ff-guard: allowlisted".
# Include a reason so reviewers understand the exception.
#
# SELF-TEST
# ─────────
# bash scripts/check-fire-and-forget-sinks.sh --self-test
#
# Writes a synthetic unwrapped void sink to a temp directory and asserts the
# detector exits non-zero (mirrors check-migration-journal.sh --self-test).
# The CI job runs self-test before the real check so a broken script cannot
# silently pass the gate.
#
# EXIT CODES
# ──────────
#   0 = pass (no unwrapped sinks found)
#   1 = violation (one or more unwrapped sinks found)
#   2 = self-test failure (the guard itself is broken)

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# ── Self-test mode ────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--self-test" ]]; then
  echo "=== Self-test mode ==="
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' EXIT

  # Write a synthetic file containing an unwrapped void sink.
  mkdir -p "$tmp_dir/app/api/synth"
  cat > "$tmp_dir/app/api/synth/route.ts" <<'EOF'
// Synthetic test fixture — should be flagged by the guard.
export function handler() {
  void someAsyncSink({ tenantId: 'tenant-abc' });
}
EOF

  # Run the guard against the temp dir — must exit non-zero.
  if FF_SINK_TARGET="$tmp_dir" bash "$0" > /dev/null 2>&1; then
    echo "SELF-TEST FAIL: synthetic unwrapped void sink was NOT detected."
    echo "  The guard is broken — check the grep patterns in this script."
    exit 2
  fi
  echo "OK: self-test PASSED — synthetic unwrapped void sink was correctly detected."

  # Also verify a correctly-wrapped pattern is NOT flagged.
  cat > "$tmp_dir/app/api/synth/route.ts" <<'EOF'
// Synthetic test fixture — should NOT be flagged (allowlisted).
export function handler() {
  void someSync();  // ff-guard: allowlisted — someSync is not async
}
EOF
  if ! FF_SINK_TARGET="$tmp_dir" bash "$0" > /dev/null 2>&1; then
    echo "SELF-TEST FAIL: allowlisted pattern was incorrectly flagged."
    exit 2
  fi
  echo "OK: self-test PASSED — allowlisted pattern was correctly ignored."

  echo ""
  echo "Self-test PASSED."
  exit 0
fi

# ── Real check ────────────────────────────────────────────────────────────────
TARGET="${FF_SINK_TARGET:-${ROOT}/apps/control-plane/src}"

echo "=== Fire-and-forget sink guard (FOLLOW-433) ==="
echo "Scanning: $TARGET"
echo ""

# Build the grep command.  Two patterns are detected:
#   ^\s*void \w+(   — bare void function-call statement
#   ^\s*void \(async — bare void async-IIFE statement
#
# Lines containing "ff-guard: allowlisted" are excluded (allowlist mechanism).
# *.test.ts files are excluded — test helpers may use void deliberately.

VIOLATIONS=$(
  grep -rn \
    --include="*.ts" \
    --exclude="*.test.ts" \
    -E "^\s*void [a-zA-Z_][a-zA-Z0-9_]*\(|^\s*void \(async" \
    "$TARGET" 2>/dev/null \
  | grep -v "ff-guard: allowlisted" \
  || true
)

if [[ -z "$VIOLATIONS" ]]; then
  echo "PASS: No unwrapped fire-and-forget sinks found."
  echo ""
  echo "All request-path async sinks are registered via afterResponse() / after() / ctx.waitUntil()."
  exit 0
fi

echo "FAIL: Unwrapped fire-and-forget sink(s) detected:"
echo ""
echo "$VIOLATIONS"
echo ""
echo "Each line above is a bare 'void fn(…)' or 'void (async …)' that runs outside"
echo "an afterResponse() / after() / ctx.waitUntil() wrapper.  On Vercel, this work"
echo "is silently dropped when the function instance suspends (ESC-033 mechanism)."
echo ""
echo "FIX: Wrap the sink:"
echo "  afterResponse(() => yourSinkFn(…));"
echo ""
echo "ALLOWLIST: If the void expression is intentional (e.g. non-async target or"
echo "non-request-path caller), add this comment on the same line:"
echo "  // ff-guard: allowlisted — <reason>"
echo ""
echo "See CONVENTIONS_PATCH.md Rule K.2 and scripts/check-fire-and-forget-sinks.sh header."
exit 1
