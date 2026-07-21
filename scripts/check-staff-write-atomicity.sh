#!/usr/bin/env bash
# Staff-write audit atomicity guard — ADR-0018 §3a / FOLLOW-607, tightened to be
# SCOPE-AWARE by FOLLOW-608.
#
# Every staff-audited WRITE — a route that both performs a data mutation and
# records it in staff_audit_log — MUST commit the mutation and the audit row in
# ONE db.transaction(), so a mutation can never outlive a missing/failed audit
# row (RETRO-190 §4a). Reference implementation (FOLLOW-605):
#   apps/control-plane/src/app/api/quiz/config/route.ts
#
# The actual detection logic lives in scripts/check-staff-write-atomicity.cjs
# (FOLLOW-608): a TypeScript-AST walk that proves the mutation and the
# insert(staffAuditLog) call are lexically INSIDE THE SAME db.transaction()
# callback, not just present somewhere in the file (the FOLLOW-607 bash/regex
# heuristic this replaces was a file-level PRESENCE check only — see
# RETRO-192/193 and the .cjs file's doc comment for the three bypasses this
# closes). This wrapper exists so CI wiring (.github/workflows/ci.yml) and the
# existing test harness invocation (`bash scripts/check-staff-write-atomicity.sh
# [scan_root]`) do not need to change.
#
# Exit codes: 0 = pass, 1 = violation found.
# Run: scripts/check-staff-write-atomicity.sh [scan_root]
# Default scan_root: apps/control-plane/src/app/api

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if ! command -v node &>/dev/null; then
  echo "ERROR: node is required but not found in PATH."
  exit 1
fi

node scripts/check-staff-write-atomicity.cjs "${1:-apps/control-plane/src/app/api}"
