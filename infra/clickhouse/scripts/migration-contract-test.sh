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
# Boundary detection (FOLLOW-415 / RETRO-129 LG-1 fix):
#   The boundary migration is NOT blindly the lexically-last *.sql file. Instead,
#   migrations are walked in REVERSE lexicographic order and the first file that
#   contains ADD COLUMN for any column in the extracted INSERT list becomes the
#   boundary migration. This prevents false failures when a non-column migration
#   (e.g. an intent_events index) is the lexically newest file. If no migration
#   adds any INSERT column (unusual but possible), the ordering assertion is
#   skipped cleanly with exit 0 — no false failures.
#
# Column extraction (FOLLOW-415 / RETRO-129 LG-2 note):
#   The INSERT column list is extracted from the single-line backtick segment
#   immediately following 'INSERT INTO adaptation_decisions' in logDecisionAsync.
#   A column-count floor assertion (>= 17) fires if the extraction is truncated or
#   if the INSERT format changes to span multiple lines — the test fails loud
#   instead of passing silently with a partial column list.
#
# Test steps:
#   1. Extract INSERT column list from logDecisionAsync in route.ts at runtime.
#   2. Assert extracted column count >= 17 (floor sanity check).
#   3. Walk all infra/clickhouse/migrations/*.sql in reverse lexicographic order;
#      select the first file containing ADD COLUMN for any INSERT column as the
#      boundary migration.
#   4. If no boundary found: log a warning and exit 0 (test is not meaningful).
#   5. Apply all migrations except the boundary.
#   6. INSERT using extracted column list -> expect HTTP 4xx (boundary column absent).
#   7. Apply the boundary migration.
#   8. Repeat same INSERT -> expect HTTP 200 (all columns now present).
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
# Path from infra/clickhouse/scripts -> repo root -> route.ts
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
# Step 1 — Dynamic column extraction
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
#
# FOLLOW-415 / RETRO-129 LG-2: this extraction assumes the column list is on a
# SINGLE line immediately after the INSERT line.  The column-count floor
# assertion below fires loudly if that assumption breaks (truncated extraction).
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

# ---------------------------------------------------------------------------
# Step 2 — Column-count floor assertion (FOLLOW-415 AC-2)
#
# If the grep/sed extractor above is broken or the INSERT spans multiple lines,
# the extracted COLS string will be truncated or empty.  A floor of 17 catches
# this loudly instead of silently passing with a partial column list.
# ---------------------------------------------------------------------------
COLS_COUNT=$(echo "$COLS" | tr ',' '\n' | grep -c '[a-zA-Z]')
if [ "$COLS_COUNT" -lt 17 ]; then
  echo "  FAIL: Extracted only ${COLS_COUNT} columns from logDecisionAsync (expected >= 17). Check the grep/sed extractor."
  exit 1
fi
echo "Column count: ${COLS_COUNT} (>= 17 floor OK)"
echo ""

# Normalised list of INSERT columns (one per line, whitespace trimmed) used
# for exact matching in the boundary-detection walk below.
INSERT_COLS=$(echo "${COLS}" | tr ',' '\n' | sed 's/^ *//;s/ *$//')

# TEST_INSERT uses INSERT ... SELECT ... FROM the same table LIMIT 0 so no
# type-specific placeholder values are required: ClickHouse rejects the query
# with HTTP non-200 if any named column is absent from the table, regardless of
# value types.  When all columns exist, SELECT returns 0 rows and INSERT
# succeeds (HTTP 200).
TEST_INSERT="INSERT INTO adaptation_decisions (${COLS}) SELECT ${COLS} FROM adaptation_decisions LIMIT 0"

# ---------------------------------------------------------------------------
# Step 3 — Smart boundary detection (FOLLOW-415 AC-1 / RETRO-129 LG-1 fix)
#
# Walk all *.sql migration files in REVERSE lexicographic order and select the
# FIRST file that adds (via ADD COLUMN) at least one column present in the
# extracted INSERT list.  This is the boundary migration.
#
# Why not blindly use the lexically-last file?  Because the next migration
# added after today may not touch adaptation_decisions at all (e.g. an
# intent_events index).  If that file were used as the boundary, the INSERT
# would already succeed before applying it — a false "FAIL: INSERT succeeded
# before boundary migration."  The smart walk finds the newest migration that
# actually introduces a column from the INSERT list, regardless of how many
# non-column migrations come after it.
#
# If NO migration adds any INSERT column (unusual but theoretically possible),
# the test is not meaningful and we exit 0 cleanly.
# ---------------------------------------------------------------------------
ALL_MIGRATIONS=()
for f in "${MIGRATIONS_DIR}"/[0-9]*.sql; do
  [ -f "$f" ] || continue
  ALL_MIGRATIONS+=("$f")
done

MIGRATION_COUNT=${#ALL_MIGRATIONS[@]}
if [ "${MIGRATION_COUNT}" -lt 1 ]; then
  echo "ERROR: No migration files found in ${MIGRATIONS_DIR}"
  exit 1
fi

BOUNDARY_MIGRATION=""
BOUNDARY_INDEX=-1

for ((i = MIGRATION_COUNT - 1; i >= 0; i--)); do
  f="${ALL_MIGRATIONS[$i]}"
  # Extract column names introduced by ADD COLUMN in this migration file.
  # Pattern matches: ADD COLUMN [IF NOT EXISTS] <name>
  # awk '{print $NF}' isolates just the column name (last token of the match).
  while IFS= read -r colname; do
    [ -z "$colname" ] && continue
    # Exact-match against the normalised INSERT column list.
    if echo "${INSERT_COLS}" | grep -qx "${colname}"; then
      BOUNDARY_MIGRATION="$f"
      BOUNDARY_INDEX="$i"
      break 2
    fi
  done < <(grep -oE 'ADD COLUMN (IF NOT EXISTS )?[a-zA-Z_][a-zA-Z0-9_]*' "${f}" 2>/dev/null \
           | awk '{print $NF}'; true)
done

if [ -z "$BOUNDARY_MIGRATION" ]; then
  echo "WARNING: No boundary migration found for current INSERT columns."
  echo "         None of the migration files contain ADD COLUMN for any column in:"
  echo "         ${COLS}"
  echo ""
  echo "         Skipping ordering assertion (no new adaptation_decisions columns"
  echo "         in this migration set — this is expected when the newest migrations"
  echo "         only add indexes or modify non-adaptation_decisions tables)."
  echo ""
  echo "=== Migration-Ordering Contract Test SKIPPED (no boundary migration found) ==="
  exit 0
fi

echo "Boundary migration: $(basename "${BOUNDARY_MIGRATION}") (index ${BOUNDARY_INDEX})"
echo "Total migrations:   ${MIGRATION_COUNT}"
echo ""

# ---------------------------------------------------------------------------
# Step 4 — Apply all migrations EXCEPT the boundary
#
# All non-boundary migrations (including any newer than the boundary) are
# applied so the table is fully built except for the boundary column.
# ---------------------------------------------------------------------------
echo "4. Applying all migrations except boundary $(basename "${BOUNDARY_MIGRATION}")..."

for ((i = 0; i < MIGRATION_COUNT; i++)); do
  [ "$i" = "$BOUNDARY_INDEX" ] && continue
  f="${ALL_MIGRATIONS[$i]}"
  echo "  Applying: $(basename "${f}")"
  _apply_file "${f}"
done

echo "  All non-boundary migrations applied ($(basename "${BOUNDARY_MIGRATION}") not yet applied)"

# ---------------------------------------------------------------------------
# Step 5 — Assert INSERT is REJECTED (boundary column absent)
# ---------------------------------------------------------------------------
echo ""
echo "5. INSERT with full column list (expect HTTP 4xx — boundary column absent)..."

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
# Step 6 — Apply the boundary migration
# ---------------------------------------------------------------------------
echo ""
echo "6. Applying boundary migration: $(basename "${BOUNDARY_MIGRATION}")..."
_apply_file "${BOUNDARY_MIGRATION}"
echo "  $(basename "${BOUNDARY_MIGRATION}") applied"

# ---------------------------------------------------------------------------
# Step 7 — Assert INSERT now SUCCEEDS
# ---------------------------------------------------------------------------
echo ""
echo "7. Repeating INSERT (expect HTTP 200 — all columns now present)..."

STATUS_AFTER=$(_http_status "${TEST_INSERT}")
_assert_eq "INSERT HTTP status after $(basename "${BOUNDARY_MIGRATION}")" "200" "${STATUS_AFTER}"

echo ""
echo "=== Migration-Ordering Contract Test PASSED ==="
echo "    All columns in logDecisionAsync INSERT exist after applying all migrations."
echo "    Any future column added to logDecisionAsync without a migration will fail CI."
