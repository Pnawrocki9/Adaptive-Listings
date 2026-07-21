#!/usr/bin/env bash
# Red-first proof for scripts/check-staff-write-atomicity.sh (FOLLOW-607).
#
# Runs the guard against three committed fixtures under
# scripts/__fixtures__/staff-write-atomicity/ and asserts the exit code each
# shape must produce:
#   violation/    mutation + insert(staffAuditLog), NO transaction()  -> exit 1
#   passing/      mutation + insert(staffAuditLog), transaction()    -> exit 0
#   agency-only/  mutation only, no staffAuditLog insert             -> exit 0
#
# Also runs the guard against the real repo (default scan root) and asserts
# the FOLLOW-605 reference route passes and the audit-only export route is
# SKIPped, not flagged as a FAIL.
#
# Exit codes: 0 = all assertions passed, 1 = any assertion failed.
# Run: bash scripts/__tests__/check-staff-write-atomicity.test.sh

set -uo pipefail # no -e: we need to inspect non-zero exit codes ourselves

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

GUARD="scripts/check-staff-write-atomicity.sh"
FIXTURES="scripts/__fixtures__/staff-write-atomicity"
FAILURES=0

assert_exit() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  local output="$4"

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
  local label="$1"
  local needle="$2"
  local haystack="$3"

  if grep -qF "$needle" <<<"$haystack"; then
    echo "PASS: $label — output contains \"$needle\"."
  else
    echo "FAIL: $label — output does NOT contain \"$needle\"."
    FAILURES=$((FAILURES + 1))
  fi
}

echo "=== FOLLOW-607 red-first fixture proof ==="
echo ""

echo "--- violation/ (must FAIL, exit 1) ---"
out_violation=$(bash "$GUARD" "$FIXTURES/violation" 2>&1)
exit_violation=$?
echo "$out_violation"
echo ""
assert_exit "violation fixture" 1 "$exit_violation" "$out_violation"
assert_contains "violation fixture" "FAIL:" "$out_violation"

echo ""
echo "--- passing/ (must PASS, exit 0) ---"
out_passing=$(bash "$GUARD" "$FIXTURES/passing" 2>&1)
exit_passing=$?
echo "$out_passing"
echo ""
assert_exit "passing fixture" 0 "$exit_passing" "$out_passing"
assert_contains "passing fixture" "OK:" "$out_passing"

echo ""
echo "--- agency-only/ (must PASS, not flagged) ---"
out_agency=$(bash "$GUARD" "$FIXTURES/agency-only" 2>&1)
exit_agency=$?
echo "$out_agency"
echo ""
assert_exit "agency-only fixture" 0 "$exit_agency" "$out_agency"
if grep -q "FAIL:" <<<"$out_agency"; then
  echo "FAIL: agency-only fixture — unexpectedly flagged (should not be scanned as an audited write)."
  FAILURES=$((FAILURES + 1))
else
  echo "PASS: agency-only fixture — not flagged."
fi

echo ""
echo "--- real repo, default scan root (must PASS) ---"
out_repo=$(bash "$GUARD" 2>&1)
exit_repo=$?
echo "$out_repo"
echo ""
assert_exit "real repo (default scan root)" 0 "$exit_repo" "$out_repo"
assert_contains "real repo" "OK:   apps/control-plane/src/app/api/quiz/config/route.ts" "$out_repo"
assert_contains "real repo" "SKIP: apps/control-plane/src/app/api/admin/labels/export/route.ts" "$out_repo"

echo ""
if [[ "$FAILURES" -gt 0 ]]; then
  echo "FOLLOW-607 fixture proof FAILED: $FAILURES assertion(s) failed."
  exit 1
else
  echo "FOLLOW-607 fixture proof passed: all 4 scenarios behaved as expected."
fi
