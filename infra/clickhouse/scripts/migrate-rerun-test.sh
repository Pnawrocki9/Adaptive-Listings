#!/usr/bin/env bash
# migrate-rerun-test.sh — prove migrate.sh is re-runnable and its one-time bootstrap rule holds
# (FOLLOW-1280).
#
# Usage:
#   LOCAL=1 CLICKHOUSE_URL=http://localhost:8123 ./infra/clickhouse/scripts/migrate-rerun-test.sh
#
# Works in an isolated database (dropped on exit), so it can run before or after the main
# migrate.sh run against `default`. Scenarios:
#   1. fresh database: first run applies every file, second run applies 0 and exits 0;
#   2. prod-like database migrated by the pre-FOLLOW-1280 script up to 0022 (0023's tables still
#      present, no schema_migrations): bootstrap records 0001..0022, applies 0023 and every file
#      added after the frozen marker list (0024..);
#   3. database migrated by the pre-FOLLOW-1280 script up to 0023: bootstrap records 0001..0023,
#      applies only the files added after it (0024..);
#   4. database from before 0018 (`tier` still present): bootstrap records nothing, the whole chain
#      re-runs and 0018's RENAME succeeds;
#   5. (FOLLOW-1203) an up-to-date tracked database that has not seen 0024 yet — the state of every
#      localhost ClickHouse at the moment this file lands: exactly 0024 is applied,
#      `events.caller_signed` appears with DEFAULT 0, and a second run applies 0.

set -euo pipefail

: "${CLICKHOUSE_URL:?CLICKHOUSE_URL must be set (e.g. http://localhost:8123)}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="${SCRIPT_DIR}/../migrations"
CH_USER="${CLICKHOUSE_USER:-default}"
CH_PASS="${CLICKHOUSE_PASSWORD:-}"
TEST_DB="migrate_rerun_test"
TEST_URL="${CLICKHOUSE_URL%/}/?database=${TEST_DB}"
TOTAL="$(find "${MIGRATIONS_DIR}" -maxdepth 1 -name '*.sql' | wc -l | tr -d '[:space:]')"
# Files newer than the bootstrap's frozen marker list (0018..0023): they carry no marker, so a
# bootstrapped database always applies them.
AFTER_MARKERS=$((TOTAL - 23))
OUT="$(mktemp)"

_ch() {
  # $1 = URL, $2 = SQL
  if [ -n "$CH_PASS" ]; then
    curl -sS --fail-with-body "$1" -u "${CH_USER}:${CH_PASS}" --data-binary "$2"
  else
    curl -sS --fail-with-body "$1" --data-binary "$2"
  fi
}

_cleanup() {
  _ch "${CLICKHOUSE_URL}" "DROP DATABASE IF EXISTS ${TEST_DB}" >/dev/null 2>&1 || true
  rm -f "$OUT"
}
trap _cleanup EXIT

_fresh_db() {
  _ch "${CLICKHOUSE_URL}" "DROP DATABASE IF EXISTS ${TEST_DB}" >/dev/null
  _ch "${CLICKHOUSE_URL}" "CREATE DATABASE ${TEST_DB}" >/dev/null
}

_migrate() {
  CLICKHOUSE_URL="${TEST_URL}" "${SCRIPT_DIR}/migrate.sh" >"$OUT" 2>&1 || {
    echo "  FAIL: migrate.sh exited non-zero ($1):"
    sed 's/^/    /' "$OUT"
    exit 1
  }
}

_expect_applied() {
  local label="$1" want="$2" got
  got="$(sed -n 's/^=== Migrations: \([0-9]*\) applied.*/\1/p' "$OUT")"
  if [ "$got" != "$want" ]; then
    echo "  FAIL: ${label} — expected ${want} applied, got '${got}'"
    sed 's/^/    /' "$OUT"
    exit 1
  fi
  echo "  PASS: ${label} — ${got} applied"
}

_expect_line() {
  local label="$1" pattern="$2"
  if ! grep -q -- "$pattern" "$OUT"; then
    echo "  FAIL: ${label} — output lacks '${pattern}'"
    sed 's/^/    /' "$OUT"
    exit 1
  fi
  echo "  PASS: ${label}"
}

_recorded() {
  _ch "${TEST_URL}" "SELECT count(DISTINCT version) FROM schema_migrations" | tr -d '[:space:]'
}

echo "=== migrate.sh re-run + bootstrap test (${TOTAL} migration files) ==="

echo "Scenario 1: fresh database, applied twice"
_fresh_db
_migrate "fresh, run 1"
_expect_applied "fresh run 1" "$TOTAL"
_migrate "fresh, run 2"
_expect_applied "fresh run 2 (re-run is a no-op)" 0
[ "$(_recorded)" = "$TOTAL" ] || { echo "  FAIL: schema_migrations rows != ${TOTAL}"; exit 1; }
echo "  PASS: schema_migrations holds ${TOTAL} versions"

echo "Scenario 2: pre-FOLLOW-1280 database at 0022 (0023 not applied), no schema_migrations"
_ch "${TEST_URL}" "DROP TABLE schema_migrations" >/dev/null
_ch "${TEST_URL}" "CREATE TABLE session_quality (session_id String) ENGINE = MergeTree ORDER BY session_id" >/dev/null
_migrate "bootstrap at 0022"
_expect_line "bootstrap stops at 0023's marker" "marker 0023: absent"
_expect_line "bootstrap records up to 0022" "up to 0022 as already applied"
_expect_applied "0023 and the post-marker files are applied" "$((1 + AFTER_MARKERS))"
_expect_line "0023 is among the applied files" "applied: 0023_drop_session_quality_and_summary"

echo "Scenario 3: pre-FOLLOW-1280 database at 0023, no schema_migrations"
_ch "${TEST_URL}" "DROP TABLE schema_migrations" >/dev/null
_migrate "bootstrap at 0023"
_expect_line "bootstrap records everything" "up to 0023 as already applied"
_expect_applied "only the post-marker files are applied" "$AFTER_MARKERS"
_migrate "bootstrap at 0023, run 2"
_expect_applied "then a re-run is a no-op" 0

echo "Scenario 4: pre-0018 database (tier present), no schema_migrations"
_ch "${TEST_URL}" "DROP TABLE schema_migrations" >/dev/null
_ch "${TEST_URL}" "ALTER TABLE adaptation_decisions RENAME COLUMN page_context TO tier" >/dev/null
_migrate "pre-0018 re-run"
_expect_line "bootstrap records nothing" "0018 not applied"
_expect_applied "whole chain re-runs (0018 RENAME succeeds)" "$TOTAL"
_migrate "pre-0018, run 2"
_expect_applied "then a re-run is a no-op" 0

echo "Scenario 5: tracked database that has not applied 0024 yet (FOLLOW-1203)"
_ch "${TEST_URL}" "ALTER TABLE events DROP COLUMN caller_signed" >/dev/null
_ch "${TEST_URL}" "ALTER TABLE schema_migrations DELETE WHERE version = '0024_events_caller_signed' SETTINGS mutations_sync = 2" >/dev/null
_migrate "tracked, 0024 pending"
_expect_applied "exactly one file is applied" 1
_expect_line "the applied file is 0024" "applied: 0024_events_caller_signed"
COL="$(_ch "${TEST_URL}" "SELECT concat(type, '|', default_kind, '|', default_expression) FROM system.columns WHERE database = currentDatabase() AND table = 'events' AND name = 'caller_signed'" | tr -d '[:space:]')"
[ "$COL" = "UInt8|DEFAULT|0" ] || { echo "  FAIL: events.caller_signed is '${COL}', expected 'UInt8|DEFAULT|0'"; exit 1; }
echo "  PASS: events.caller_signed is UInt8 DEFAULT 0"
_migrate "tracked, run 2"
_expect_applied "then a re-run is a no-op" 0

echo ""
echo "=== migrate.sh re-run + bootstrap test PASSED ==="
