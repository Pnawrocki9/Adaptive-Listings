#!/usr/bin/env bash
# follow371_relabel_contaminated_rows.sh — FOLLOW-371 optional remediation
#
# This script issues an ALTER TABLE UPDATE (async ClickHouse mutation) to relabel
# contaminated holdout rows that were written during the ESC-026 window:
#   PR #327 merge (2026-06-19 21:17 UTC) → PR #333 merge (2026-06-20 09:53 UTC)
#
# WHEN TO RUN:
#   Optional.  The primary remediation (FOLLOW-371) is a query-level exclusion
#   filter already applied in the application code.  Run this script only if you
#   want to physically correct the data so the exclusion filter becomes a no-op.
#
# IMPORTANT — OPERATOR PREREQUISITES:
#   1. Set CLICKHOUSE_URL, CLICKHOUSE_USER (default: "default"), CLICKHOUSE_PASSWORD.
#      Recommended: doppler run --config prd -- ./infra/clickhouse/scripts/follow371_relabel_contaminated_rows.sh
#   2. The mutation is ASYNCHRONOUS in ClickHouse.  It will not complete instantly.
#      Monitor progress with:
#        SELECT * FROM system.mutations
#        WHERE table = 'adaptation_decisions' AND is_done = 0;
#   3. Do NOT skip the pre-flight count — confirm the count is plausible before
#      issuing the mutation.
#   4. This script does NOT auto-apply.  All statements are printed first and the
#      operator is prompted before execution.
#
# Usage:
#   CLICKHOUSE_URL=https://host:8443 CLICKHOUSE_PASSWORD=xxx \
#     ./infra/clickhouse/scripts/follow371_relabel_contaminated_rows.sh
#
# Reference: FOLLOW-371, ESC-026, RETRO-095, RETRO-100, migration 0017.

set -euo pipefail

: "${CLICKHOUSE_URL:?CLICKHOUSE_URL must be set}"
CH_USER="${CLICKHOUSE_USER:-default}"
CH_PASS="${CLICKHOUSE_PASSWORD:-}"

# Contamination window (UTC ISO8601)
WINDOW_START='2026-06-19 21:17:00'
WINDOW_END='2026-06-20 09:53:00'

_ch() {
  local sql="$1"
  if [ -n "$CH_PASS" ]; then
    curl -sSf "${CLICKHOUSE_URL}" -u "${CH_USER}:${CH_PASS}" --data-binary "${sql}"
  else
    curl -sSf "${CLICKHOUSE_URL}" --data-binary "${sql}"
  fi
}

echo "=== FOLLOW-371 ESC-026 Holdout Contamination Remediation ==="
echo ""
echo "Contamination window: ${WINDOW_START} UTC → ${WINDOW_END} UTC"
echo ""

# ── Step 1: Identification query (read-only) ─────────────────────────────────
IDENTIFY_SQL="SELECT count() AS contaminated_rows
FROM adaptation_decisions
WHERE holdout_group = 1
  AND variant != 'control'
  AND ts >= toDateTime('${WINDOW_START}', 'UTC')
  AND ts <  toDateTime('${WINDOW_END}',   'UTC')
FORMAT TabSeparated"

echo "--- Step 1: Count contaminated rows (read-only) ---"
echo "SQL:"
echo "${IDENTIFY_SQL}"
echo ""

CONTAMINATED_COUNT=$(_ch "${IDENTIFY_SQL}" | tr -d '[:space:]')
echo "Contaminated rows found: ${CONTAMINATED_COUNT}"
echo ""

if [ "${CONTAMINATED_COUNT}" = "0" ]; then
  echo "No contaminated rows found.  Either the window had no holdout GET traffic"
  echo "or the relabel mutation was already applied.  Nothing to do."
  exit 0
fi

# ── Step 2: Prompt before mutation ─────────────────────────────────────────────
RELABEL_SQL="ALTER TABLE adaptation_decisions
  UPDATE variant = 'control'
WHERE holdout_group = 1
  AND variant != 'control'
  AND ts >= toDateTime('${WINDOW_START}', 'UTC')
  AND ts <  toDateTime('${WINDOW_END}',   'UTC')"

echo "--- Step 2: Relabel mutation (ALTER TABLE UPDATE) ---"
echo "This will queue an async ClickHouse mutation to set variant='control'"
echo "on the ${CONTAMINATED_COUNT} contaminated row(s)."
echo ""
echo "SQL:"
echo "${RELABEL_SQL}"
echo ""
echo "IMPORTANT: Mutations are asynchronous.  Monitor with:"
echo "  SELECT * FROM system.mutations WHERE table = 'adaptation_decisions' AND is_done = 0;"
echo ""

read -r -p "Apply mutation? [y/N] " CONFIRM
if [[ "${CONFIRM}" != "y" && "${CONFIRM}" != "Y" ]]; then
  echo "Aborted.  No mutation applied."
  exit 0
fi

_ch "${RELABEL_SQL}"
echo ""
echo "Mutation queued successfully."

# ── Step 3: Post-apply verification query ────────────────────────────────────
echo ""
echo "--- Step 3: Verification (run after mutation is_done=1) ---"
echo "Once the mutation completes, run the following to confirm zero contaminated rows:"
echo ""
echo "SELECT count() AS remaining_contaminated"
echo "FROM adaptation_decisions"
echo "WHERE holdout_group = 1"
echo "  AND variant != 'control'"
echo "  AND ts >= toDateTime('${WINDOW_START}', 'UTC')"
echo "  AND ts <  toDateTime('${WINDOW_END}',   'UTC');"
echo ""
echo "Expected: 0"
echo ""
echo "=== Done ==="
