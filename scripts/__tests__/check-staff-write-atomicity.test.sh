#!/usr/bin/env bash
# Red-first proof for scripts/check-staff-write-atomicity.sh (FOLLOW-607, tightened
# to scope-aware by FOLLOW-608, mutation-detection extended by FOLLOW-609).
#
# Runs the guard against the committed fixtures under
# scripts/__fixtures__/staff-write-atomicity/ and asserts the exit code each
# shape must produce:
#   violation/                     mutation + audit, NOT in one tx            -> exit 1
#   passing/                       mutation + audit, in ONE tx                -> exit 0
#   agency-only/                   mutation only, no staffAuditLog insert     -> exit 0
#   bypass1-unrelated-tx/           unrelated tx() + out-of-tx mutation+audit  -> exit 1
#   bypass2-helper-factored-audit/ audit insert factored into imported helper -> exit 1
#   bypass3-raw-sql-mutation/       raw-SQL mutation, no tx                    -> exit 1
#   qualified-form-passing/        schema.staffAuditLog, in ONE tx            -> exit 0
#   exempt-disallowed-superadmin/  exemption marker + isSuperadmin gate       -> exit 1
#   exempt-ok/                     exemption marker, NOT superadmin-gated     -> exit 0
#   bypass4-helper-delegated-mutation/         mutation delegated to a local
#                                               helper call, in ONE tx with
#                                               the audit insert              -> exit 0
#   bypass4-helper-delegated-mutation-out-of-tx/ same delegated-helper
#                                               mutation, OUTSIDE the tx that
#                                               wraps the audit insert         -> exit 1
#
# Also proves (FOLLOW-608 AC 4, whitespace hardening) via a dynamically
# generated, non-committed fixture (so prettier's format-on-commit never
# normalises away the whitespace under test) that a WHITESPACED audit-insert
# call `.insert( staffAuditLog )` is still recognised and still correctly
# FAILs when un-transacted.
#
# Also runs the guard against the real repo (default scan root) and asserts
# the FOLLOW-605/596 reference routes pass and the audit-only export route is
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

run_fixture() {
  local name="$1"
  local expected_exit="$2"
  local must_contain="$3"

  echo ""
  echo "--- $name/ (must exit $expected_exit) ---"
  local out
  out=$(bash "$GUARD" "$FIXTURES/$name" 2>&1)
  local code=$?
  echo "$out"
  echo ""
  assert_exit "$name fixture" "$expected_exit" "$code" "$out"
  if [[ -n "$must_contain" ]]; then
    assert_contains "$name fixture" "$must_contain" "$out"
  fi
}

echo "=== FOLLOW-607/608/609 red-first fixture proof ==="

run_fixture "violation" 1 "FAIL:"
run_fixture "passing" 0 "OK:"

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

# ─── FOLLOW-608 bypasses (scope-aware tightening) ──────────────────────────

run_fixture "bypass1-unrelated-tx" 1 "FAIL:"
run_fixture "bypass2-helper-factored-audit" 1 "factored into"
run_fixture "bypass3-raw-sql-mutation" 1 "FAIL:"
run_fixture "qualified-form-passing" 0 "OK:"
run_fixture "exempt-disallowed-superadmin" 1 "DISALLOWS this exemption"
run_fixture "exempt-ok" 0 "EXEMPT:"

# ─── FOLLOW-609 bypass 4 (helper-delegated mutation, RETRO-194) ────────────
# Red-first proof: pre-FOLLOW-609, a data mutation delegated to a bare call of
# an imported local helper function (mirroring the real
# demo-override-store.ts::upsertDemoOverride shape) was invisible to
# collectFileFacts's .update(/.delete(/.insert(/raw-SQL detection, so a route
# whose only local mutation-shaped call was such a delegation was misclassified
# SKIP ("no other data mutation") even when co-scoped with the audit insert in
# one db.transaction() — zero enforcement. The fixed guard must OK the
# co-scoped variant and FAIL the out-of-tx variant (not SKIP it — a SKIP would
# be zero enforcement in the opposite direction).
run_fixture "bypass4-helper-delegated-mutation" 0 "OK:"
run_fixture "bypass4-helper-delegated-mutation-out-of-tx" 1 "FAIL:"

# ─── FOLLOW-608 AC 4: whitespaced audit-insert form (dynamic, non-committed) ──
# Not a committed fixture: `.insert( staffAuditLog )` would be reformatted to
# `.insert(staffAuditLog)` by prettier on any real commit, which would erase
# exactly the whitespace this proof needs. Generated in a throwaway temp dir
# instead, run once, then discarded.

echo ""
echo "--- whitespaced audit-insert form (dynamic fixture, must exit 1) ---"
WS_DIR="$(mktemp -d)"
mkdir -p "$WS_DIR/foo"
cat >"$WS_DIR/foo/route.ts" <<'EOF'
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { createAdminClient, tenants, staffAuditLog } from '@estalara/db';
import { eq } from 'drizzle-orm';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const tenantId = req.nextUrl.searchParams.get('tenant_id') ?? '';
  const db = createAdminClient();

  await db.update(tenants).set({ updatedAt: new Date() }).where(eq(tenants.id, tenantId));

  await db.insert( staffAuditLog ).values({
    adminUserId: 'staff-user-id',
    action: 'fixture.update',
    targetTenantId: tenantId,
    payload: {},
  });

  return NextResponse.json({ ok: true });
}
EOF
out_ws=$(bash "$GUARD" "$(realpath --relative-to="$ROOT" "$WS_DIR")" 2>&1)
exit_ws=$?
echo "$out_ws"
echo ""
assert_exit "whitespaced audit-insert fixture" 1 "$exit_ws" "$out_ws"
assert_contains "whitespaced audit-insert fixture" "FAIL:" "$out_ws"
rm -rf "$WS_DIR"

# ─── Real repo, default scan root ──────────────────────────────────────────

echo ""
echo "--- real repo, default scan root (must PASS) ---"
out_repo=$(bash "$GUARD" 2>&1)
exit_repo=$?
echo "$out_repo"
echo ""
assert_exit "real repo (default scan root)" 0 "$exit_repo" "$out_repo"
assert_contains "real repo" "OK:   apps/control-plane/src/app/api/quiz/config/route.ts" "$out_repo"
assert_contains "real repo" "OK:   apps/control-plane/src/app/api/demo/override/route.ts" "$out_repo"
assert_contains "real repo" "SKIP: apps/control-plane/src/app/api/admin/labels/export/route.ts" "$out_repo"
assert_contains "real repo" "No staff-write-atomicity-exempt: usages found in production routes today." "$out_repo"

echo ""
if [[ "$FAILURES" -gt 0 ]]; then
  echo "FOLLOW-607/608/609 fixture proof FAILED: $FAILURES assertion(s) failed."
  exit 1
else
  echo "FOLLOW-607/608/609 fixture proof passed: all scenarios behaved as expected."
fi
