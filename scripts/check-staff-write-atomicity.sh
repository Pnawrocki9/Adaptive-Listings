#!/usr/bin/env bash
# Staff-write audit atomicity guard — ADR-0018 §3a / FOLLOW-607.
#
# Every staff-audited WRITE — a route that both performs a data mutation and
# records it in staff_audit_log — MUST commit the mutation and the audit row in
# ONE db.transaction(), so a mutation can never outlive a missing/failed audit
# row (RETRO-190 §4a). Reference implementation (FOLLOW-605):
#   apps/control-plane/src/app/api/quiz/config/route.ts
# This guard mechanically enforces that shape so FOLLOW-596/597/598 (and any
# future staff-write port) cannot silently regress to the pre-605
# mutate-then-audit (non-atomic) shape.
#
# Scan set: <scan_root>/**/route.ts, default apps/control-plane/src/app/api
# (full scan, not diff-scoped — the route set is small and this is more robust
# than tracking which files changed).
#
# Detection heuristic (file-level; deliberately simple, not brace-accurate):
#   0. All checks below run against the file with comments stripped (// line
#      comments and /* block */ comments removed, mirroring the Gate-2
#      comment-stripping in check-rule-h.sh). Without this, a JSDoc note that
#      merely *describes* db.transaction() (e.g. explaining what a bug used to
#      lack) would falsely satisfy the check. Raw-file text is only used for
#      the exemption marker (below), which is itself meant to live in a
#      comment.
#   1. A route file counts as a "staff-audited write" IFF it contains the
#      literal `insert(staffAuditLog)` AND at least one OTHER data-mutation
#      call in the same file: `.update(`, `.delete(`, or an `.insert(` whose
#      target is not staffAuditLog. A file that only ever inserts
#      staffAuditLog (e.g. auditing a read/export action, with no separate
#      mutation to make atomic) is not a "mutate + audit" shape and is
#      skipped — there is nothing to wrap in a transaction.
#   2. Any file matching (1) MUST also contain `.transaction(` somewhere in
#      the file. Its absence means the mutation and the audit insert are not
#      provably atomic → FAIL.
#   3. This is a file-level presence check, not proof that the *specific*
#      mutation and the *specific* audit insert live inside the same
#      transaction block — reliable brace/line matching in bash is fragile.
#      It still catches the regression this ticket cares about: an audited
#      write with literally zero transaction wrapper anywhere in the file.
#
# Exemption: a route may opt out (a genuinely single-store single-write path
# where a transaction wrapper is meaningless) with an inline comment anywhere
# in the file:
#   // staff-write-atomicity-exempt: <reason>
# Exempted files are reported but never counted as failures.
#
# Exit codes: 0 = pass, 1 = violation found.
# Run: scripts/check-staff-write-atomicity.sh [scan_root]
# Default scan_root: apps/control-plane/src/app/api

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

SCAN_ROOT="${1:-apps/control-plane/src/app/api}"
FAILURES=0

echo "=== Staff-write audit atomicity check (ADR-0018 §3a / FOLLOW-607) ==="
echo "Scanning: $SCAN_ROOT/**/route.ts"
echo ""

routes=$(find "$SCAN_ROOT" -type f -name "route.ts" 2>/dev/null | sort || true)

if [[ -z "$routes" ]]; then
  echo "No route.ts files found under $SCAN_ROOT — nothing to check."
  exit 0
fi

for file in $routes; do
  [[ -f "$file" ]] || continue

  # Strip // and /* */ comments before matching so a comment that merely
  # *describes* a mutation/transaction (e.g. a JSDoc note or a "this used to
  # lack db.transaction()" remark) cannot masquerade as real code.
  stripped=$(node -e "
    const fs = require('fs');
    const src = fs.readFileSync(process.argv[1], 'utf8');
    process.stdout.write(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''));
  " "$file")

  if ! grep -q "insert(staffAuditLog)" <<<"$stripped" 2>/dev/null; then
    continue # not a staff-audited write at all — nothing to check
  fi

  # Does the file also perform a data mutation other than the audit insert
  # itself? (.update(, .delete(, or .insert( on something other than
  # staffAuditLog)
  other_mutation_count=$(grep -cE "\.update\(|\.delete\(" <<<"$stripped" 2>/dev/null || true)
  other_insert_count=$(
    grep -oP "\.insert\(\K\w+" <<<"$stripped" 2>/dev/null \
      | grep -v "^staffAuditLog$" \
      | wc -l || true
  )
  other_mutation_count="${other_mutation_count:-0}"
  other_insert_count="${other_insert_count:-0}"

  if [[ "$other_mutation_count" -eq 0 && "$other_insert_count" -eq 0 ]]; then
    echo "SKIP: $file — insert(staffAuditLog) present but no other data mutation"
    echo "      (audit-of-a-read/export, not a mutate+audit shape)."
    continue
  fi

  # The exemption marker is meant to live in a comment, so check the RAW file.
  if grep -q "staff-write-atomicity-exempt:" "$file" 2>/dev/null; then
    echo "EXEMPT: $file — documented opt-out present, not counted as a failure."
    continue
  fi

  if grep -q "\.transaction(" <<<"$stripped" 2>/dev/null; then
    echo "OK:   $file — mutation + insert(staffAuditLog), transaction() present."
  else
    echo "FAIL: $file contains a data mutation + insert(staffAuditLog) but NO"
    echo "      db.transaction()."
    echo "      ADR-0018 §3a requires the mutation and its staff_audit_log row to"
    echo "      commit or roll back TOGETHER in one db.transaction() (reference"
    echo "      impl: apps/control-plane/src/app/api/quiz/config/route.ts,"
    echo "      FOLLOW-605). Wrap both in db.transaction(async (tx) => { ... }),"
    echo "      or add an inline '// staff-write-atomicity-exempt: <reason>'"
    echo "      comment if this route is a genuinely single-store single-write"
    echo "      path where a transaction wrapper would be meaningless."
    FAILURES=$((FAILURES + 1))
  fi
done

echo ""
if [[ "$FAILURES" -gt 0 ]]; then
  echo "Staff-write atomicity check FAILED: $FAILURES violation(s) found."
  exit 1
else
  echo "Staff-write atomicity check passed — all staff-audited writes are transaction-wrapped."
fi
