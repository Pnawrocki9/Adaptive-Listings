#!/usr/bin/env bash
# ttl-golden-test.sh — TTL golden-DDL regression test (FOLLOW-535).
#
# Model: RETRO-014's golden-query-comparison test (captures the SQL sent to
# ClickHouse and asserts canonical tokens present / stale tokens absent). This
# ticket ships no application query code (DDL-only), so the equivalent guard
# here operates on the migration file's SQL shape and, when a live ClickHouse
# instance is available, on the actual applied schema (`SHOW CREATE TABLE`) —
# so a future edit that silently changes the TTL column or duration fails CI
# loudly instead of drifting unnoticed.
#
# Static checks (always run):
#   - Migration 0020 exists and targets `description_generations`.
#   - Canonical tokens present: `MODIFY TTL`, `toDateTime(created_at)`,
#     `INTERVAL 13 MONTH`.
#   - Stale/wrong tokens ABSENT from the migration: TTL keyed off `ts` or
#     `generated_at` instead of `created_at`, or a wrong duration (90 DAY /
#     12 MONTH) that would silently diverge from the documented 13-month
#     retention (DATA_DICTIONARY.md "Retention / TTL promises").
#
# Live check (only when CLICKHOUSE_URL is set — mirrors migrate.sh / smoke-test.sh):
#   - Applies migrations 0007 and 0020 against an isolated database and
#     asserts `SHOW CREATE TABLE description_generations` contains the TTL
#     clause with the canonical column + duration.
#
# Usage:
#   ./infra/clickhouse/scripts/ttl-golden-test.sh
#   LOCAL=1 CLICKHOUSE_URL=http://localhost:8123 \
#     ./infra/clickhouse/scripts/ttl-golden-test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="${SCRIPT_DIR}/../migrations"
TTL_MIGRATION="${MIGRATIONS_DIR}/0020_description_generations_ttl.sql"

echo "=== TTL Golden-DDL Regression Test (FOLLOW-535) ==="
echo ""

# ---------------------------------------------------------------------------
# Step 1 — Static SQL-shape assertions on the migration file.
# ---------------------------------------------------------------------------
if [ ! -f "${TTL_MIGRATION}" ]; then
  echo "  FAIL: expected migration not found: $(basename "${TTL_MIGRATION}")"
  exit 1
fi
echo "1. Found migration: $(basename "${TTL_MIGRATION}")"

_assert_contains() {
  local label="$1" pattern="$2"
  if grep -qE "${pattern}" "${TTL_MIGRATION}"; then
    echo "  PASS: contains ${label}"
  else
    echo "  FAIL: missing expected token ${label} (pattern: ${pattern})"
    exit 1
  fi
}

_assert_absent() {
  local label="$1" pattern="$2"
  # Only inspect the executable ALTER TABLE statement, not comments, so the
  # explanatory prose above (which legitimately names the sibling tables /
  # durations for context) does not trip a false failure.
  local sql_only
  sql_only="$(grep -vE '^\s*--' "${TTL_MIGRATION}")"
  if echo "${sql_only}" | grep -qE "${pattern}"; then
    echo "  FAIL: stale/wrong token present in executable SQL: ${label} (pattern: ${pattern})"
    exit 1
  else
    echo "  PASS: absent (stale token) ${label}"
  fi
}

echo ""
echo "2. Canonical tokens present..."
_assert_contains "ALTER TABLE description_generations" "ALTER TABLE description_generations"
_assert_contains "MODIFY TTL" "MODIFY TTL"
_assert_contains "toDateTime(created_at)" "toDateTime\(created_at\)"
_assert_contains "INTERVAL 13 MONTH" "INTERVAL 13 MONTH"

echo ""
echo "3. Stale/wrong tokens absent from executable SQL..."
_assert_absent "TTL keyed off ts" "toDateTime\(ts\)"
_assert_absent "TTL keyed off generated_at" "toDateTime\(generated_at\)"
_assert_absent "90-day duration (intent_events retention, wrong table)" "INTERVAL 90 DAY"
_assert_absent "12-month duration (off-by-one)" "INTERVAL 12 MONTH"

echo ""
echo "=== Static SQL-shape assertions PASSED ==="

# ---------------------------------------------------------------------------
# Step 4 — Live schema check (only if CLICKHOUSE_URL is set).
# ---------------------------------------------------------------------------
if [ -z "${CLICKHOUSE_URL:-}" ]; then
  echo ""
  echo "CLICKHOUSE_URL not set — skipping live SHOW CREATE TABLE check."
  exit 0
fi

LOCAL="${LOCAL:-0}"
CH_USER="${CLICKHOUSE_USER:-default}"
CH_PASS="${CLICKHOUSE_PASSWORD:-}"
CH_DB="ttl_golden_test"
CH_URL="${CLICKHOUSE_URL}/?database=${CH_DB}"

_cleanup() {
  curl -sSf "${CLICKHOUSE_URL}" -u "${CH_USER}:${CH_PASS}" \
    --data-binary "DROP DATABASE IF EXISTS ${CH_DB}" >/dev/null 2>&1 || true
}
trap _cleanup EXIT

curl -sSf "${CLICKHOUSE_URL}" -u "${CH_USER}:${CH_PASS}" \
  --data-binary "CREATE DATABASE IF NOT EXISTS ${CH_DB}"

_apply_file() {
  local file="$1"
  local content
  if [ "$LOCAL" = "1" ]; then
    content="$(sed 's/ReplicatedMergeTree/MergeTree/g' "${file}")"
  else
    content="$(cat "${file}")"
  fi
  local stmt=""
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*-- ]] && continue
    stmt+="${line}"$'\n'
    if [[ "$line" =~ \;[[:space:]]*$ ]]; then
      printf '%s' "$stmt" | curl -sS --fail-with-body "${CH_URL}" -u "${CH_USER}:${CH_PASS}" --data-binary @-
      stmt=""
    fi
  done <<< "$content"
}

echo ""
echo "4. Applying description_generations table (0007) + TTL (0020) to isolated DB..."
_apply_file "${MIGRATIONS_DIR}/0007_description_generations_verified_facts.sql" # gitleaks:allow migration filename (40-char stem), not a secret
_apply_file "${TTL_MIGRATION}"

DDL=$(curl -sSf "${CH_URL}" -u "${CH_USER}:${CH_PASS}" \
  --data-binary "SHOW CREATE TABLE description_generations FORMAT TSVRaw")

echo ""
echo "5. Asserting live SHOW CREATE TABLE contains the canonical TTL clause..."
if echo "${DDL}" | grep -qE "TTL toDateTime\(created_at\) \+ toIntervalMonth\(13\)"; then
  echo "  PASS: live schema TTL = toDateTime(created_at) + toIntervalMonth(13)"
else
  echo "  FAIL: live schema TTL clause does not match expected shape."
  echo "  --- SHOW CREATE TABLE output ---"
  echo "${DDL}"
  exit 1
fi

echo ""
echo "=== TTL Golden-DDL Regression Test PASSED ==="
