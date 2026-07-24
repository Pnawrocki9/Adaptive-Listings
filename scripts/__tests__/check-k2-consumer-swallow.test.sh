#!/usr/bin/env bash
# Red-first fixture proof for scripts/check-k2-consumer-swallow.sh (FOLLOW-625).
#
# Proves BOTH directions of the Rule K.2 consumer-side swallow guard:
#   (a) the FIXED shape (a failed GET that sets an error state) PASSES — both an
#       app-scope and a components-scope fixture, matching the six editors fixed
#       by FOLLOW-624 (PR #608) / FOLLOW-630 (PR #609);
#   (b) each covered swallow shape (Rule AE) FAILS — including a src/components
#       negative control (amended AC / RETRO-206 §4a LG-2), not only app editors.
#
# It also runs the guard against the REAL repo scan roots and asserts:
#   - the run is CLEAN (exit 0) — so the six now-fixed editors pass; AND
#   - with the allow-list DISABLED (K2_GUARD_NO_ALLOWLIST=1) the four read-only
#     analytics swallows ARE detected — proving the allow-list is load-bearing,
#     not masking a detector that sees nothing.
#
# Exit codes: 0 = all assertions passed, 1 = any assertion failed.
# Run: bash scripts/__tests__/check-k2-consumer-swallow.test.sh

set -uo pipefail # no -e: we inspect non-zero exit codes ourselves

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

GUARD="scripts/check-k2-consumer-swallow.sh"
FIXTURES="scripts/__fixtures__/k2-consumer-swallow"
FAILURES=0

assert_exit() {
  local label="$1" expected="$2" actual="$3" output="$4"
  if [[ "$actual" -eq "$expected" ]]; then
    echo "PASS: $label — exit $actual (expected $expected)."
  else
    echo "FAIL: $label — exit $actual (expected $expected)."
    echo "--- captured output ---"
    echo "$output"
    echo "-----------------------"
    FAILURES=$((FAILURES + 1))
  fi
}

assert_contains() {
  local label="$1" needle="$2" haystack="$3"
  if grep -qF "$needle" <<<"$haystack"; then
    echo "PASS: $label — output contains \"$needle\"."
  else
    echo "FAIL: $label — output does NOT contain \"$needle\"."
    FAILURES=$((FAILURES + 1))
  fi
}

run_fixture() {
  local name="$1" expected_exit="$2"
  echo ""
  echo "--- $name/ (must exit $expected_exit) ---"
  local out code
  out=$(bash "$GUARD" "$FIXTURES/$name" 2>&1)
  code=$?
  echo "$out"
  assert_exit "$name fixture" "$expected_exit" "$code" "$out"
}

echo "=== FOLLOW-625 red-first fixture proof ==="

# ── Direction (a): FIXED shape PASSES (app + components scope) ──────────────────
run_fixture "passing-app-sets-error-state" 0
run_fixture "passing-components-sets-error-state" 0

# ── Direction (b): each covered swallow shape FAILS (Rule AE) ───────────────────
run_fixture "violation-empty-catch" 1
run_fixture "violation-comment-only" 1
run_fixture "violation-returns-undefined" 1
run_fixture "violation-console-only" 1
run_fixture "violation-noop-alias" 1
# Amended AC / RETRO-206 §4a LG-2: the negative control MUST cover src/components.
run_fixture "violation-components-generation-model" 1

# ── Real repo, default scan roots: must be CLEAN (the six fixed editors pass) ────
echo ""
echo "--- real repo, default scan roots (must exit 0 — six FOLLOW-624/630 editors pass) ---"
out_repo=$(bash "$GUARD" 2>&1)
exit_repo=$?
echo "$out_repo"
assert_exit "real repo (default scan roots)" 0 "$exit_repo" "$out_repo"
assert_contains "real repo" "PASS: No consumer-side fetch-load swallows found." "$out_repo"

# The six now-fixed editors must be IN SCOPE (present on disk under the scan roots)
# so the clean run above is evidence they pass, not evidence they were skipped.
echo ""
echo "--- six FOLLOW-624/630-fixed editors are in scope ---"
for f in \
  "apps/control-plane/src/app/admin/tenants/[id]/settings/tenant-config-editor.tsx" \
  "apps/control-plane/src/app/admin/tenants/[id]/quiz/quiz-config-editor.tsx" \
  "apps/control-plane/src/app/admin/tenants/[id]/demo/demo-override-editor.tsx" \
  "apps/control-plane/src/app/dashboard/quiz/page.tsx" \
  "apps/control-plane/src/app/dashboard/demo/override/page.tsx" \
  "apps/control-plane/src/components/generation-model-settings.tsx"; do
  if [[ -f "$f" ]]; then
    echo "PASS: in scope — $f"
  else
    echo "FAIL: expected editor missing from scope — $f"
    FAILURES=$((FAILURES + 1))
  fi
done

# ── Allow-list is load-bearing: disable it and the analytics swallows surface ───
echo ""
echo "--- allow-list disabled: the four read-only analytics swallows ARE detected ---"
out_noal=$(K2_GUARD_NO_ALLOWLIST=1 node scripts/check-k2-consumer-swallow.cjs 2>&1)
exit_noal=$?
echo "$out_noal"
assert_exit "real repo, allow-list disabled" 1 "$exit_noal" "$out_noal"
assert_contains "allow-list disabled" \
  "apps/control-plane/src/components/analytics/analytics-view.tsx" "$out_noal"
assert_contains "allow-list disabled" \
  "apps/control-plane/src/app/dashboard/analytics/page.tsx" "$out_noal"

echo ""
if [[ "$FAILURES" -gt 0 ]]; then
  echo "FOLLOW-625 fixture proof FAILED: $FAILURES assertion(s) failed."
  exit 1
else
  echo "FOLLOW-625 fixture proof passed: all scenarios behaved as expected."
fi
