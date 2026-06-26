#!/usr/bin/env bash
# migration-contract-test.sh — Verify ClickHouse migration-ordering contract.
#
# Rule M enforcement: ClickHouse does NOT coerce unknown columns to NULL — it
# rejects the INSERT with HTTP 4xx. The logDecisionAsync .catch() in
# apps/control-plane/src/app/api/adapt/route.ts swallows this rejection silently,
# so a missing migration causes silent data loss rather than a loud error.
#
# ESC-031 incident (2026-06-26): migration 0019 (page_context_source) was not
# applied to prod before PR #357 deployed. All adaptation_decisions writes
# failed silently from 10:40Z to ~12:00Z.  This script makes CI catch that
# class of incident for future migrations.
#
# Test steps:
#   1. Apply migrations 0001–0018 (no page_context_source column yet).
#   2. INSERT into adaptation_decisions WITH page_context_source → expect HTTP 4xx.
#   3. Apply migration 0019 (adds page_context_source).
#   4. Repeat same INSERT → expect HTTP 200 (success).
#
# Usage:
#   LOCAL=1 CLICKHOUSE_URL=http://localhost:8123 \
#     ./infra/clickhouse/scripts/migration-contract-test.sh
#
# Expects a CLEAN ClickHouse instance (run BEFORE the full migrate.sh).

set -euo pipefail

: "${CLICKHOUSE_URL:?CLICKHOUSE_URL must be set (e.g. http://localhost:8123)}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="${SCRIPT_DIR}/../migrations"
LOCAL="${LOCAL:-0}"
CH_USER="${CLICKHOUSE_USER:-default}"
CH_PASS="${CLICKHOUSE_PASSWORD:-}"

echo "=== ClickHouse Migration-Ordering Contract Test ==="
echo "URL:   ${CLICKHOUSE_URL}"
echo "Local: ${LOCAL}"
echo ""

# ---------------------------------------------------------------------------
# Helpers (modelled on smoke-test.sh)
# ---------------------------------------------------------------------------

_ch_query() {
  local sql="$1"
  if [ -n "$CH_PASS" ]; then
    curl -sSf "${CLICKHOUSE_URL}" -u "${CH_USER}:${CH_PASS}" --data-binary "${sql}"
  else
    curl -sSf "${CLICKHOUSE_URL}" --data-binary "${sql}"
  fi
}

_assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "${actual}" = "${expected}" ]; then
    echo "  PASS: ${label} = ${expected}"
  else
    echo "  FAIL: ${label} — expected ${expected}, got ${actual}"
    exit 1
  fi
}

# Capture HTTP status without failing on non-200 (used for the pre-migration
# rejection assertion where a 4xx is the expected outcome).
_http_status() {
  local sql="$1"
  if [ -n "$CH_PASS" ]; then
    curl -s -o /dev/null -w "%{http_code}" "${CLICKHOUSE_URL}" \
      -u "${CH_USER}:${CH_PASS}" \
      --data-binary "${sql}"
  else
    curl -s -o /dev/null -w "%{http_code}" "${CLICKHOUSE_URL}" \
      --data-binary "${sql}"
  fi
}

_ch_send() {
  # Send a single SQL statement via HTTP.  Uses --fail-with-body so CI logs
  # show the ClickHouse error message rather than just the exit code.
  if [ -n "$CH_PASS" ]; then
    curl -sS --fail-with-body "${CLICKHOUSE_URL}" \
      -u "${CH_USER}:${CH_PASS}" \
      --data-binary @-
  else
    curl -sS --fail-with-body "${CLICKHOUSE_URL}" \
      --data-binary @-
  fi
}

_apply_file() {
  local file="$1"
  local content
  if [ "$LOCAL" = "1" ]; then
    # Replace ReplicatedMergeTree with MergeTree for local single-node Docker.
    content="$(sed 's/ReplicatedMergeTree/MergeTree/g' "${file}")"
  else
    content="$(cat "${file}")"
  fi
  # ClickHouse HTTP processes one query per request.  Split on ";" boundaries.
  local stmt=""
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*-- ]] && continue  # skip comment-only lines
    stmt+="${line}"$'\n'
    if [[ "$line" =~ \;[[:space:]]*$ ]]; then
      printf '%s' "$stmt" | _ch_send
      stmt=""
    fi
  done <<< "$content"
}

# ---------------------------------------------------------------------------
# The INSERT under test
#
# Includes page_context_source (added by migration 0019).  All other columns
# listed here exist after migrations 0001–0018.  Remaining schema columns
# carry their DEFAULT values and are omitted from the column list.
#
# NOTE: The AC INSERT spec included listing_id / directives / created_at which
# are not in the adaptation_decisions schema.  Those have been replaced with
# real column names so the post-0019 assertion can succeed.  The column being
# validated is page_context_source.
# ---------------------------------------------------------------------------
TEST_INSERT="INSERT INTO adaptation_decisions \
(adapt_decision_id, tenant_id, session_id, page_context, page_context_source, \
archetype, confidence, variant, features_snapshot, ts) \
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'contract-test-tenant', \
'contract-test-session', 0, 'caller_supplied', 'value_hunter', 0.9, 'control', \
'{}', now())"

# ---------------------------------------------------------------------------
# Step 1 — Apply migrations 0001–0018 (no page_context_source column)
# ---------------------------------------------------------------------------
echo "1. Applying migrations 0001–0018 (no page_context_source column yet)..."

# Two globs cover 0001–0009 and 0010–0018.  Both are quoted; [ -f ] skips any
# unmatched pattern so the loop is safe even if the glob expands to a literal.
for f in "${MIGRATIONS_DIR}"/000[1-9]_*.sql \
          "${MIGRATIONS_DIR}"/001[0-8]_*.sql; do
  [ -f "${f}" ] || continue
  echo "  Applying: $(basename "${f}")"
  _apply_file "${f}"
done

echo "  ✓ migrations 0001–0018 applied"

# ---------------------------------------------------------------------------
# Step 2 — Assert INSERT is REJECTED (page_context_source column absent)
# ---------------------------------------------------------------------------
echo ""
echo "2. INSERT with page_context_source (expect HTTP 4xx — column absent)..."

STATUS_BEFORE=$(_http_status "${TEST_INSERT}")

if [ "${STATUS_BEFORE}" = "200" ]; then
  echo "  FAIL: INSERT succeeded (HTTP 200) — page_context_source should not exist yet."
  echo "        Possible cause: migration 0019 was already applied to this instance,"
  echo "        or the column was added by an earlier migration we are not aware of."
  echo "        Ensure this script runs on a CLEAN ClickHouse instance before migrate.sh."
  exit 1
fi

echo "  PASS: INSERT rejected with HTTP ${STATUS_BEFORE} (page_context_source column absent)"

# ---------------------------------------------------------------------------
# Step 3 — Apply migration 0019 (adds page_context_source)
# ---------------------------------------------------------------------------
echo ""
echo "3. Applying migration 0019 (adds page_context_source)..."
_apply_file "${MIGRATIONS_DIR}/0019_adaptation_decisions_page_context_source.sql"
echo "  ✓ migration 0019 applied"

# ---------------------------------------------------------------------------
# Step 4 — Assert INSERT now SUCCEEDS
# ---------------------------------------------------------------------------
echo ""
echo "4. Repeating INSERT (expect HTTP 200 — column now present)..."

STATUS_AFTER=$(_http_status "${TEST_INSERT}")
_assert_eq "INSERT HTTP status after migration 0019" "200" "${STATUS_AFTER}"

echo ""
echo "=== Migration-Ordering Contract Test PASSED ==="
