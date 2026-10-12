#!/usr/bin/env bash
# migrate.sh — Apply pending ClickHouse SQL migrations in lexicographic order.
#
# Usage:
#   CLICKHOUSE_URL=http://localhost:8123 ./infra/clickhouse/scripts/migrate.sh
#   LOCAL=1 CLICKHOUSE_URL=http://localhost:8123 ./infra/clickhouse/scripts/migrate.sh
#   LOCAL=1 CLICKHOUSE_URL='http://localhost:8123/?database=other' ./infra/clickhouse/scripts/migrate.sh
#
# Environment:
#   CLICKHOUSE_URL  Required. Full HTTP URL including protocol and port.
#                   For ClickHouse Cloud: https://<host>:8443 (set via Doppler).
#                   For local Docker:     http://localhost:8123
#                   A `?database=<name>` query string targets a non-default database.
#   CLICKHOUSE_USER Optional. Default: default.
#   CLICKHOUSE_PASSWORD Optional. Default: (empty).
#   LOCAL           Set to "1" to run against a local single-node ClickHouse.
#                   Substitutes ReplicatedMergeTree with MergeTree so migrations
#                   work without ClickHouse Keeper / ZooKeeper.
#
# Applied-version tracking (FOLLOW-1280): the script records every migration it applies in
# `schema_migrations` (one row per file stem, e.g. `0018_adaptation_decisions_page_context`) and
# skips any file already recorded there. Re-running is therefore a no-op ("0 applied"), including
# past 0018, whose RENAME COLUMN cannot be applied twice. The table is created here if absent; this
# script is its only writer.
#
# One-time bootstrap: a database migrated by the pre-FOLLOW-1280 script has its schema but no
# `schema_migrations` rows. When the table is empty AND `adaptation_decisions` exists, the script
# infers what is already applied from the schema itself, using the FROZEN marker list in
# `_bootstrap_marker_sql` below (0018..0023 — the files that existed when tracking was introduced):
#   - walk the markers in order; stop at the first whose check fails;
#   - every file whose 4-digit version is <= the last passing marker is recorded as applied
#     (0018 present implies 0001..0017 ran: the old script applied in order and stopped at the
#     first error);
#   - if 0018's marker fails but adaptation_decisions still has `tier`, nothing is recorded and the
#     whole chain re-runs (0001..0017 are IF NOT EXISTS / no-op files, which the old script re-ran
#     on every invocation);
#   - adaptation_decisions with neither `tier` nor `page_context` is an unknown state: abort.
# A database without adaptation_decisions is treated as fresh: nothing is recorded, all files run.
# Migrations added after 0023 need no marker: any database that has run this script has the table.
#
# A crash between applying a file and recording it leaves that file pending; the next run applies
# it again. Every file except 0018 is safe to re-apply.
#
# Running via Doppler (production): see docs/runbooks/clickhouse-migrations.md first — prod
# migration is an operator step (CONVENTIONS_PATCH Rule AA), and 0023 is gated on a deploy.
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

_ch_send() {
  # Send a single SQL statement via HTTP. Reads from stdin.
  # --fail-with-body: fail on HTTP errors but still print the response body so
  # CI logs show the ClickHouse error message rather than just the exit code.
  if [ -n "$CH_PASS" ]; then
    curl -sS --fail-with-body "${CLICKHOUSE_URL}" \
      -u "${CH_USER}:${CH_PASS}" \
      --data-binary @-
  else
    curl -sS --fail-with-body "${CLICKHOUSE_URL}" \
      --data-binary @-
  fi
}

# Run one scalar query and print the answer with whitespace stripped. Returns non-zero (and the
# caller's `var="$(_ch_scalar ...)"` assignment aborts the script under `set -e`) on an HTTP error
# or a non-numeric answer, so a failed probe can never read as a schema fact.
_ch_scalar() {
  local out
  out="$(printf '%s' "$1" | _ch_send | tr -d '[:space:]')"
  if [[ ! "$out" =~ ^[0-9]+$ ]]; then
    echo "ERROR: expected a count from ClickHouse, got '${out}' for: $1" >&2
    return 1
  fi
  printf '%s' "$out"
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
  # ClickHouse HTTP processes one query per request. Split the file on statement
  # boundaries (lines ending with ";") and execute each statement individually.
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

_col_sql() {
  printf "SELECT count() FROM system.columns WHERE database = currentDatabase() AND table = '%s' AND name = '%s'" "$1" "$2"
}

# FROZEN marker list for the one-time bootstrap (see header). For each version, a query whose
# answer is non-zero when that migration's effect is present in the schema.
# Do NOT add markers for migrations after 0023.
_bootstrap_marker_sql() {
  case "$1" in
    0018) _col_sql adaptation_decisions page_context ;;
    0019) _col_sql adaptation_decisions page_context_source ;;
    0020)
      printf '%s' "SELECT count() FROM system.tables WHERE database = currentDatabase() AND name = 'description_generations' AND engine_full LIKE '% TTL %'"
      ;;
    0021) _col_sql adaptation_decisions holdout_pct ;;
    0022) _col_sql adaptation_decisions scoring_path ;;
    0023)
      printf '%s' "SELECT count() = 0 FROM system.tables WHERE database = currentDatabase() AND name IN ('session_summary_mv', 'session_summary', 'session_quality')"
      ;;
  esac
}
BOOTSTRAP_MARKERS="0018 0019 0020 0021 0022 0023"

# ---- applied-version table ------------------------------------------------------------------------
printf '%s' "CREATE TABLE IF NOT EXISTS schema_migrations (
  version    String,
  applied_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(applied_at)
ORDER BY version" | _ch_send

RECORDED_COUNT="$(_ch_scalar "SELECT count() FROM schema_migrations")"

HAS_ADAPTATION_DECISIONS="$(_ch_scalar "SELECT count() FROM system.tables WHERE database = currentDatabase() AND name = 'adaptation_decisions'")"

if [ "$RECORDED_COUNT" = "0" ] && [ "$HAS_ADAPTATION_DECISIONS" != "0" ]; then
  echo "Bootstrap: schema_migrations is empty but adaptation_decisions exists (migrated by the"
  echo "           pre-FOLLOW-1280 script). Inferring applied versions from the schema."
  BASELINE=""
  for marker in $BOOTSTRAP_MARKERS; do
    present="$(_ch_scalar "$(_bootstrap_marker_sql "$marker")")"
    if [ "$present" = "0" ]; then
      echo "  marker ${marker}: absent"
      break
    fi
    echo "  marker ${marker}: present"
    BASELINE="$marker"
  done
  if [ -z "$BASELINE" ]; then
    has_tier="$(_ch_scalar "$(_col_sql adaptation_decisions tier)")"
    if [ "$has_tier" = "0" ]; then
      echo "ERROR: adaptation_decisions has neither 'page_context' (0018) nor 'tier' (pre-0018)." >&2
      echo "       Unknown schema state; record applied versions by hand before re-running." >&2
      exit 1
    fi
    echo "Bootstrap: 0018 not applied (adaptation_decisions.tier present); recording nothing."
  else
    VALUES=""
    MARKED=0
    for f in "${MIGRATIONS_DIR}"/*.sql; do
      [ -f "${f}" ] || continue
      v="$(basename "${f}" .sql)"
      if [ "$((10#${v:0:4}))" -le "$((10#${BASELINE}))" ]; then
        VALUES+="${VALUES:+, }('${v}')"
        MARKED=$((MARKED + 1))
      fi
    done
    printf '%s' "INSERT INTO schema_migrations (version) VALUES ${VALUES}" | _ch_send
    echo "Bootstrap: recorded ${MARKED} migration(s) up to ${BASELINE} as already applied."
  fi
fi

APPLIED_LIST="$(printf '%s' "SELECT DISTINCT version FROM schema_migrations ORDER BY version FORMAT TSV" | _ch_send)"

APPLIED=0
SKIPPED=0
for f in "${MIGRATIONS_DIR}"/*.sql; do
  [ -f "${f}" ] || continue
  v="$(basename "${f}" .sql)"
  if [[ ! "$v" =~ ^[0-9]{4}_[a-z0-9_]+$ ]]; then
    echo "ERROR: migration file name '${v}.sql' does not match NNNN_lower_snake.sql" >&2
    exit 1
  fi
  if grep -qxF "$v" <<< "$APPLIED_LIST"; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi
  echo "Applying: ${v}.sql"
  _apply_file "${f}"
  printf '%s' "INSERT INTO schema_migrations (version) VALUES ('${v}')" | _ch_send
  echo "  applied: ${v}"
  APPLIED=$((APPLIED + 1))
done

echo ""
echo "=== Migrations: ${APPLIED} applied, ${SKIPPED} already recorded ==="

# Verify tables exist
echo ""
echo "Tables:"
_ch_exec "SHOW TABLES FORMAT TSV" | sed 's/^/  /'
