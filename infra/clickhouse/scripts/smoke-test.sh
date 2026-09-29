#!/usr/bin/env bash
# smoke-test.sh — Insert 5 sample events, verify events + per-session aggregates, clean up.
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
# rows aggregated together). This honours the "unique per run so parallel executions don't conflict" intent.
TENANT_ID="smoke-$(date +%s%N)-$$-${RANDOM}-tenant"
SESSION_ID="smoke000000000000000000000000000000000000000000000000000000001"
# Anchor the sample events to "now" (1h ago) so they are always well inside the
# events table's 13-month TTL. A hardcoded BASE_TS is a time bomb: the rows age out
# exactly 13 months after that date and the insert→count check then reads 0. That is
# what broke this smoke test on 2026-06-03 — the old constant (1746259200000) is
# 2025-05-03, so ts + 13 months crossed into the past that day. Relative timestamps
# keep the test deterministic regardless of when it runs.
BASE_TS=$(( ($(date -u +%s) - 3600) * 1000 + 123 ))  # 1 hour ago, epoch ms (non-zero ms on purpose)

# FOLLOW-853: epoch ms → the EXACT DateTime64(3) literal the ingest Worker emits.
#
# Until FOLLOW-853 this script inserted an UNQUOTED NUMERIC EPOCH (`"ts":1750000000000`),
# a byte shape NO production writer has ever produced. That is the structural reason CI
# stayed green for months over a producer whose real bytes (`.toISOString()`, trailing `Z`)
# were rejected outright by this very container's default `date_time_input_format=basic`
# with Code 27. A fixture that does not send the writer's bytes tests the TABLE, not the
# WRITE PATH. This function is the shell mirror of `toClickHouseDateTime64` in
# `apps/ingest/src/clickhouse-producer.ts` — change both or neither.
#
# The `+123` on BASE_TS above is deliberate: a fixture with `.000` milliseconds cannot
# distinguish a DateTime64(3) parse from a second-precision one that silently truncates.
#
# Requires GNU date (`-d @epoch`); CI runs ubuntu-latest and the localhost runbook targets
# Linux. On BSD/macOS use `date -u -r "${secs}"`.
_ch_datetime64() {
  local epoch_ms="$1"
  local secs=$(( epoch_ms / 1000 ))
  local millis=$(( epoch_ms % 1000 ))
  printf '%s.%03d' "$(date -u -d "@${secs}" +'%Y-%m-%d %H:%M:%S')" "${millis}"
}

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
  TS=$(_ch_datetime64 "$(( BASE_TS + i * 1000 ))")
  EVENTS="${EVENTS}{\"event_id\":\"${EVENT_ID}\",\"tenant_id\":\"${TENANT_ID}\",\"session_id\":\"${SESSION_ID}\",\"ts\":\"${TS}\",\"region\":\"eu\",\"type\":\"page.view\",\"schema_version\":1,\"consent_state\":\"consented\",\"listing_id\":\"listing-smoke-${i}\",\"archetype_hint\":\"\",\"payload\":\"{}\",\"ingest_received_at\":\"${TS}\"}
"
done

for i in 4 5; do
  EVENT_ID="a000000$(printf '%01d' "${i}")-0000-0000-0000-000000000001"
  TS=$(_ch_datetime64 "$(( BASE_TS + i * 1000 ))")
  EVENTS="${EVENTS}{\"event_id\":\"${EVENT_ID}\",\"tenant_id\":\"${TENANT_ID}\",\"session_id\":\"${SESSION_ID}\",\"ts\":\"${TS}\",\"region\":\"eu\",\"type\":\"chat.message.sent\",\"schema_version\":1,\"consent_state\":\"consented\",\"listing_id\":\"listing-smoke-${i}\",\"archetype_hint\":\"\",\"payload\":\"{\\\"message\\\":\\\"test query\\\"}\",\"ingest_received_at\":\"${TS}\"}
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

# FOLLOW-853: the timestamp must ROUND-TRIP, not merely be accepted. A DateTime64(3)
# column silently coerces a second-precision parse to `.000`, so asserting the exact
# millisecond is what proves the writer's literal was understood at full scale.
EXPECTED_TS=$(_ch_datetime64 "$(( BASE_TS + 1000 ))")
STORED_TS=$(_ch_query "SELECT toString(ts) FROM events WHERE tenant_id = '${TENANT_ID}' ORDER BY ts ASC LIMIT 1 FORMAT TSV" | tr -d '\n')
_assert_eq "ts round-trip (ms precision)" "${EXPECTED_TS}" "${STORED_TS}"

# --- 3. Verify per-session aggregates over events ------------------------------
# FOLLOW-1268: this step used to read the `session_summary` MV target, which nothing in
# the product ever queried and which CH migration 0023 drops. The same two facts are now
# asserted straight from `events` using the canonical event types
# (packages/shared/src/schemas/events/index.ts). That still proves the `type` column
# round-trips the writer's vocabulary. Then we assert that the dropped objects are really gone
# after migrate.sh, so a re-added CREATE cannot silently resurrect them.
echo ""
echo "3. Verifying per-session aggregates over events..."

HAS_CHAT=$(_ch_query "SELECT toUInt8(countIf(type IN ('chat.opened', 'chat.message.sent')) > 0) FROM events WHERE tenant_id = '${TENANT_ID}' AND session_id = '${SESSION_ID}' FORMAT TSV" | tr -d '[:space:]')
_assert_eq "has_chat" "1" "${HAS_CHAT}"

PAGE_COUNT=$(_ch_query "SELECT countIf(type = 'page.view') FROM events WHERE tenant_id = '${TENANT_ID}' AND session_id = '${SESSION_ID}' FORMAT TSV" | tr -d '[:space:]')
_assert_eq "page_count" "3" "${PAGE_COUNT}"

DROPPED=$(_ch_query "SELECT count() FROM system.tables WHERE database = currentDatabase() AND name IN ('session_summary', 'session_summary_mv', 'session_quality') FORMAT TSV" | tr -d '[:space:]')
_assert_eq "dropped objects present (FOLLOW-1268, migration 0023)" "0" "${DROPPED}"

# --- 4. Clean up ---------------------------------------------------------------
echo ""
echo "4. Cleaning up test data..."
_ch_query "ALTER TABLE events DELETE WHERE tenant_id = '${TENANT_ID}'"
echo "  ✓ DELETE mutation queued (async — table will be clean within seconds)"

echo ""
echo "=== Smoke test PASSED ==="
