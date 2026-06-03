#!/usr/bin/env bash
# smoke-test.sh — Insert 5 sample events, verify events + session_summary, clean up.
#
# Usage:
#   LOCAL=1 CLICKHOUSE_URL=http://localhost:8123 ./infra/clickhouse/scripts/smoke-test.sh
#
# Expects migrations to have been applied already (run migrate.sh first).
# Uses a unique smoke-tenant ID per run so parallel executions don't conflict.

set -euo pipefail

: "${CLICKHOUSE_URL:?CLICKHOUSE_URL must be set}"

CH_USER="${CLICKHOUSE_USER:-default}"
CH_PASS="${CLICKHOUSE_PASSWORD:-}"
# Nanosecond clock + PID + RANDOM → genuinely unique per run (the old `date +%s` had
# 1-second granularity, so two runs in the same second collided on tenant_id and their
# session_summary rows aggregated together — the cleanup only deletes from `events`, not
# the MV). This honours the "unique per run so parallel executions don't conflict" intent.
TENANT_ID="smoke-$(date +%s%N)-$$-${RANDOM}-tenant"
SESSION_ID="smoke000000000000000000000000000000000000000000000000000000001"
# Anchor the sample events to "now" (1h ago) so they are always well inside the
# events table's 13-month TTL. A hardcoded BASE_TS is a time bomb: the rows age out
# exactly 13 months after that date and the insert→count check then reads 0. That is
# what broke this smoke test on 2026-06-03 — the old constant (1746259200000) is
# 2025-05-03, so ts + 13 months crossed into the past that day. Relative timestamps
# keep the test deterministic regardless of when it runs.
BASE_TS=$(( ($(date -u +%s) - 3600) * 1000 ))  # 1 hour ago, epoch ms

echo "=== ClickHouse Smoke Test ==="
echo "Tenant: ${TENANT_ID}"
echo ""

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

# --- 1. Insert 5 sample events --------------------------------------------------
echo "1. Inserting 5 sample events..."

# 3 page.view + 2 chat events — creates a session with has_chat=1
EVENTS=""
for i in 1 2 3; do
  EVENT_ID="a000000$(printf '%01d' "${i}")-0000-0000-0000-000000000001"
  TS=$(( BASE_TS + i * 1000 ))
  EVENTS="${EVENTS}{\"event_id\":\"${EVENT_ID}\",\"tenant_id\":\"${TENANT_ID}\",\"session_id\":\"${SESSION_ID}\",\"ts\":${TS},\"region\":\"eu\",\"type\":\"page.view\",\"schema_version\":1,\"consent_state\":\"consented\",\"listing_id\":\"listing-smoke-${i}\",\"archetype_hint\":\"\",\"payload\":\"{}\",\"ingest_received_at\":${TS}}
"
done

for i in 4 5; do
  EVENT_ID="a000000$(printf '%01d' "${i}")-0000-0000-0000-000000000001"
  TS=$(( BASE_TS + i * 1000 ))
  EVENTS="${EVENTS}{\"event_id\":\"${EVENT_ID}\",\"tenant_id\":\"${TENANT_ID}\",\"session_id\":\"${SESSION_ID}\",\"ts\":${TS},\"region\":\"eu\",\"type\":\"chat.message.sent\",\"schema_version\":1,\"consent_state\":\"consented\",\"listing_id\":\"listing-smoke-${i}\",\"archetype_hint\":\"\",\"payload\":\"{\\\"message\\\":\\\"test query\\\"}\",\"ingest_received_at\":${TS}}
"
done

_ch_query "INSERT INTO events FORMAT JSONEachRow
${EVENTS}"
echo "  ✓ inserted"

# --- 2. Verify events count ----------------------------------------------------
echo ""
echo "2. Verifying events table..."
COUNT=$(_ch_query "SELECT count() FROM events WHERE tenant_id = '${TENANT_ID}' FORMAT TSV" | tr -d '[:space:]')
_assert_eq "events count" "5" "${COUNT}"

# --- 3. Verify session_summary -------------------------------------------------
echo ""
echo "3. Verifying session_summary materialized view..."

# FINAL triggers instant merge; safe for smoke tests (not for production hot paths)
SESSION_ROWS=$(_ch_query "SELECT count() FROM session_summary FINAL WHERE tenant_id = '${TENANT_ID}' FORMAT TSV" | tr -d '[:space:]')
if [ "${SESSION_ROWS}" = "0" ]; then
  echo "  FAIL: no rows in session_summary for tenant ${TENANT_ID}"
  exit 1
fi
echo "  PASS: ${SESSION_ROWS} row(s) in session_summary"

HAS_CHAT=$(_ch_query "SELECT maxSimpleState(has_chat) FROM session_summary FINAL WHERE tenant_id = '${TENANT_ID}' FORMAT TSV" | tr -d '[:space:]')
_assert_eq "has_chat" "1" "${HAS_CHAT}"

PAGE_COUNT=$(_ch_query "SELECT sumSimpleState(page_count) FROM session_summary FINAL WHERE tenant_id = '${TENANT_ID}' FORMAT TSV" | tr -d '[:space:]')
_assert_eq "page_count" "3" "${PAGE_COUNT}"

# --- 4. Clean up ---------------------------------------------------------------
echo ""
echo "4. Cleaning up test data..."
_ch_query "ALTER TABLE events DELETE WHERE tenant_id = '${TENANT_ID}'"
echo "  ✓ DELETE mutation queued (async — table will be clean within seconds)"

echo ""
echo "=== Smoke test PASSED ==="
