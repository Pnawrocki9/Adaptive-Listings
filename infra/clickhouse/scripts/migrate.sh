#!/usr/bin/env bash
# migrate.sh — Apply ClickHouse SQL migrations in lexicographic order.
#
# Usage:
#   CLICKHOUSE_URL=http://localhost:8123 ./infra/clickhouse/scripts/migrate.sh
#   LOCAL=1 CLICKHOUSE_URL=http://localhost:8123 ./infra/clickhouse/scripts/migrate.sh
#
# Environment:
#   CLICKHOUSE_URL  Required. Full HTTP URL including protocol and port.
#                   For ClickHouse Cloud: https://<host>:8443 (set via Doppler).
#                   For local Docker:     http://localhost:8123
#   CLICKHOUSE_USER Optional. Default: default.
#   CLICKHOUSE_PASSWORD Optional. Default: (empty).
#   LOCAL           Set to "1" to run against a local single-node ClickHouse.
#                   Substitutes ReplicatedMergeTree with MergeTree so migrations
#                   work without ClickHouse Keeper / ZooKeeper.
#
# Idempotency: every migration uses CREATE ... IF NOT EXISTS, so re-running is
# a no-op. The script does NOT track applied migrations in a table yet — that
# will be handled by dbt in Sprint 4.
#
# Running via Doppler (production/staging):
#   doppler run -- ./infra/clickhouse/scripts/migrate.sh

set -euo pipefail

: "${CLICKHOUSE_URL:?CLICKHOUSE_URL must be set (e.g. http://localhost:8123)}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="${SCRIPT_DIR}/../migrations"
LOCAL="${LOCAL:-0}"
CH_USER="${CLICKHOUSE_USER:-default}"
CH_PASS="${CLICKHOUSE_PASSWORD:-}"

echo "=== ClickHouse Migrations ==="
echo "URL:   ${CLICKHOUSE_URL}"
echo "Local: ${LOCAL}"
echo ""

_ch_exec() {
  local sql="$1"
  if [ -n "$CH_PASS" ]; then
    curl -sSf "${CLICKHOUSE_URL}" \
      -u "${CH_USER}:${CH_PASS}" \
      --data-binary "${sql}"
  else
    curl -sSf "${CLICKHOUSE_URL}" \
      --data-binary "${sql}"
  fi
}

_apply_file() {
  local file="$1"
  local sql
  if [ "$LOCAL" = "1" ]; then
    # Replace ReplicatedMergeTree with MergeTree for local single-node Docker.
    sql="$(sed 's/ReplicatedMergeTree/MergeTree/g' "${file}")"
  else
    sql="$(cat "${file}")"
  fi
  if [ -n "$CH_PASS" ]; then
    echo "${sql}" | curl -sSf "${CLICKHOUSE_URL}" \
      -u "${CH_USER}:${CH_PASS}" \
      --data-binary @-
  else
    echo "${sql}" | curl -sSf "${CLICKHOUSE_URL}" \
      --data-binary @-
  fi
}

for f in "${MIGRATIONS_DIR}"/*.sql; do
  [ -f "${f}" ] || continue
  echo "Applying: $(basename "${f}")"
  _apply_file "${f}"
  echo "  ✓ done"
done

echo ""
echo "=== All migrations applied ==="

# Verify tables exist
echo ""
echo "Tables created:"
_ch_exec "SHOW TABLES FORMAT TSV" | sed 's/^/  /'
