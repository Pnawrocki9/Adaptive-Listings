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
# failed silently from 10:40Z to ~12:00Z.
#
# This script derives the INSERT column list from logDecisionAsync in route.ts;
# any new column without a corresponding migration causes CI to fail.
#
# Test steps:
#   1. Extract INSERT column list from logDecisionAsync in route.ts at runtime.
#   2. Sort all infra/clickhouse/migrations/*.sql lexicographically; identify
#      the last migration as the boundary.
#   3. Apply all migrations except the last.
#   4. INSERT using extracted column list → expect HTTP 4xx (boundary column absent).
#   5. Apply the last migration.
#   6. Repeat same INSERT → expect HTTP 200 (all columns now present).
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
# Path from infra/clickhouse/scripts → repo root → route.ts
ROUTE_TS="${SCRIPT_DIR}/../../../apps/control-plane/src/app/api/adapt/route.ts"
LOCAL="${LOCAL:-0}"
CH_USER="${CLICKHOUSE_USER:-default}"
CH_PASS="${CLICKHOUSE_PASSWORD:-}"
CH_CONTRACT_DB="contract_test_ordering"
CH_CONTRACT_URL="${CLICKHOUSE_URL}/?database=${CH_CONTRACT_DB}"

echo "=== ClickHouse Migration-Ordering Contract Test ==="
echo "URL:   ${CLICKHOUSE_URL}"
echo "Local: ${LOCAL}"
echo ""

# ---------------------------------------------------------------------------
# Cleanup on EXIT (AC-2) — always drop the isolated database so a failure run
# cannot poison the next run (prevents leftover 'contract_test_ordering' DB).
# ---------------------------------------------------------------------------
_cleanup() {
  curl -sSf "${CLICKHOUSE_URL}" -u "${CH_USER}:${CH_PASS}" \
    --data-binary "DROP DATABASE IF EXISTS ${CH_CONTRACT_DB}" >/dev/null 2>&1 || true
}
trap _cleanup EXIT

# Create an isolated database so migrations applied here do not collide with
# the subsequent migrate.sh run against the default database (which would
# otherwise fail re-applying RENAME COLUMN on an already-renamed column).
curl -sSf "${CLICKHOUSE_URL}" -u "${CH_USER}:${CH_PASS}" \
  --data-binary "CREATE DATABASE IF NOT EXISTS ${CH_CONTRACT_DB}"
echo "Contract-test database: ${CH_CONTRACT_DB}"
echo ""

# ---------------------------------------------------------------------------
# Helpers (modelled on smoke-test.sh)
# ---------------------------------------------------------------------------

_ch_query() {
  local sql="$1"
  if [ -n "$CH_PASS" ]; then
    curl -sSf "${CH_CONTRACT_URL}" -u "${CH_USER}:${CH_PASS}" --data-binary "${sql}"
  else
    curl -sSf "${CH_CONTRACT_URL}" --data-binary "${sql}"
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
    curl -s -o /dev/null -w "%{http_code}" "${CH_CONTRACT_URL}" \
      -u "${CH_USER}:${CH_PASS}" \
      --data-binary "${sql}"
  else
    curl -s -o /dev/null -w "%{http_code}" "${CH_CONTRACT_URL}" \
      --data-binary "${sql}"
  fi
}

_ch_send() {
  # Send a single SQL statement via HTTP.  Uses --fail-with-body so CI logs
  # show the ClickHouse error message rather than just the exit code.
  if [ -n "$CH_PASS" ]; then
    curl -sS --fail-with-body "${CH_CONTRACT_URL}" \
      -u "${CH_USER}:${CH_PASS}" \
      --data-binary @-
  else
    curl -sS --fail-with-body "${CH_CONTRACT_URL}" \
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
# Dynamic column extraction (AC-1)
#
# Extract the INSERT column list from logDecisionAsync in route.ts at runtime.
# The INSERT statement in logDecisionAsync spans two template-literal lines:
#
#   `INSERT INTO adaptation_decisions ` +
#   `(col1, col2, ..., colN) ` +
#
# grep -A1 captures the column-list line immediately following the INSERT line.
# grep -v removes the INSERT line itself, leaving only the column-list line.
# sed extracts the content between the outermost `(` and `)` on that line.
#
# This is self-maintaining: when logDecisionAsync gains a new column, the
# extracted list updates automatically and the contract test enforces that a
# matching migration must exist before CI can pass.
# ---------------------------------------------------------------------------
if [ ! -f "${ROUTE_TS}" ]; then
  echo "ERROR: route.ts not found at ${ROUTE_TS}"
  exit 1
fi

COLS=$(grep -A1 'INSERT INTO adaptation_decisions' "${ROUTE_TS}" \
  | grep -v 'INSERT INTO adaptation_decisions' \
  | sed 's/.*`(\([^)]*\)).*/\1/')

if [ -z "${COLS}" ]; then
  echo "ERROR: Could not extract INSERT column list from logDecisionAsync in:"
  echo "       ${ROUTE_TS}"
  echo "       Expected a backtick-delimited column list on the line following"
  echo "       'INSERT INTO adaptation_decisions' inside logDecisionAsync."
  exit 1
fi

echo "Extracted column list from logDecisionAsync INSERT:"
echo "  ${COLS}"
echo ""

# TEST_INSERT uses INSERT … SELECT … FROM the same table LIMIT 0 so no
# type-specific placeholder values are required: ClickHouse rejects the query
# with HTTP non-200 if any named column is absent from the table, regardless of
# value types.  When all columns exist, SELECT returns 0 rows and INSERT
# succeeds (HTTP 200).
TEST_INSERT="INSERT INTO adaptation_decisions (${COLS}) SELECT ${COLS} FROM adaptation_decisions LIMIT 0"

# ---------------------------------------------------------------------------
# Determine migration boundary automatically (AC-1 item 3)
#
# Sort all *.sql migration files lexicographically.  Apply all except the last;
# assert INSERT fails.  Apply the last; assert INSERT succeeds.  Future
# migrations slot in automatically — no manual update to this script needed.
# ---------------------------------------------------------------------------
ALL_MIGRATIONS=()
for f in "${MIGRATIONS_DIR}"/[0-9]*.sql; do
  [ -f "$f" ] || continue
  ALL_MIGRATIONS+=("$f")
done

MIGRATION_COUNT=${#ALL_MIGRATIONS[@]}
if [ "${MIGRATION_COUNT}" -lt 2 ]; then
  echo "ERROR: Fewer than 2 migration files found in ${MIGRATIONS_DIR}"
  echo "       Cannot run ordering test with only ${MIGRATION_COUNT} migration(s)."
  exit 1
fi

LAST_MIGRATION="${ALL_MIGRATIONS[$((MIGRATION_COUNT - 1))]}"
echo "Boundary migration (last):  $(basename "${LAST_MIGRATION}")"
echo "Total migrations to apply:  ${MIGRATION_COUNT}"
echo ""

# ---------------------------------------------------------------------------
# Step 1 — Apply all migrations except the last
# ---------------------------------------------------------------------------
echo "1. Applying migrations 1–$((MIGRATION_COUNT - 1)) (without boundary migration)..."

for ((i = 0; i < MIGRATION_COUNT - 1; i++)); do
  f="${ALL_MIGRATIONS[$i]}"
  echo "  Applying: $(basename "${f}")"
  _apply_file "${f}"
done

echo "  ✓ applied $((MIGRATION_COUNT - 1)) migrations ($(basename "${LAST_MIGRATION}") not yet applied)"

# ---------------------------------------------------------------------------
# Step 2 — Assert INSERT is REJECTED (boundary column absent)
# ---------------------------------------------------------------------------
echo ""
echo "2. INSERT with full column list (expect HTTP 4xx — boundary column absent)..."

STATUS_BEFORE=$(_http_status "${TEST_INSERT}")

if [ "${STATUS_BEFORE}" = "200" ]; then
  echo "  FAIL: INSERT succeeded (HTTP 200) before the boundary migration was applied."
  echo "        Possible cause: the boundary migration was already applied to this"
  echo "        ClickHouse instance, or the column was added by an earlier migration."
  echo "        Ensure this script runs on a CLEAN ClickHouse instance before migrate.sh."
  exit 1
fi

echo "  PASS: INSERT rejected with HTTP ${STATUS_BEFORE} (boundary column absent)"

# ---------------------------------------------------------------------------
# Step 3 — Apply the boundary (last) migration
# ---------------------------------------------------------------------------
echo ""
echo "3. Applying boundary migration: $(basename "${LAST_MIGRATION}")..."
_apply_file "${LAST_MIGRATION}"
echo "  ✓ $(basename "${LAST_MIGRATION}") applied"

# ---------------------------------------------------------------------------
# Step 4 — Assert INSERT now SUCCEEDS
# ---------------------------------------------------------------------------
echo ""
echo "4. Repeating INSERT (expect HTTP 200 — all columns now present)..."

STATUS_AFTER=$(_http_status "${TEST_INSERT}")
_assert_eq "INSERT HTTP status after $(basename "${LAST_MIGRATION}")" "200" "${STATUS_AFTER}"

echo ""
echo "=== Migration-Ordering Contract Test PASSED ==="
echo "    All columns in logDecisionAsync INSERT exist after applying all migrations."
echo "    Any future column added to logDecisionAsync without a migration will fail CI."
