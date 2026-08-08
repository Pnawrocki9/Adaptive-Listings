#!/usr/bin/env bash
# check-cron-heartbeat.sh — absence-of-signal detector for scheduled jobs (FOLLOW-893).
#
# WHY THIS EXISTS
#   `apps/data-quality/src/crons/schema_validation.py` runs on `modal.Cron("0 2 * * *")`.
#   A FAILED run is visible only to whoever opens the Modal dashboard. A run that NEVER
#   STARTS — the highest-prior failure mode for a first-ever schedule — emitted nothing,
#   anywhere. Drift EVENTS already have a channel (Sentry, schema_validation.py:510); the
#   gap was precisely the ABSENCE case. This script is the outside observer: it asserts,
#   from a process that is NOT the cron, that the cron completed successfully recently.
#
# THE ASSERTION
#   `cron_heartbeats.last_success_at` for the named job is younger than --max-age-hours.
#   The cron UPSERTs that row as its LAST action on the success path only, so a run that
#   raises, a container that dies, a schedule that was never registered and a Modal
#   workspace that is simply asleep all produce the same observable: a stale/absent row.
#
# WHY NOT `schema_validation_history`
#   `_run_validation()` returns early and writes ZERO rows when no active tenant has a
#   site schema, so an empty history table is ambiguous between "ran, nothing to do" and
#   "never ran". The heartbeat carries `run_detail.tenant_domain_pairs` for that.
#
# WINDOW ARITHMETIC (load-bearing — do not "simplify" the schedule)
#   The cron fires 02:00 UTC. This check runs 05:00 UTC. With --max-age-hours 26:
#     - today's run happened      → age ≈ 3h    → PASS
#     - today's run MISSED, yesterday's fine → age ≈ 27h → FAIL
#   Moving the check earlier than 04:00 UTC would make a 26h window silently tolerate a
#   single missed run (age would still be < 26h), i.e. the alarm would stop alarming.
#
# EXIT CODES
#   0 = heartbeat present and fresh
#   1 = ALARM: heartbeat absent, stale, or the table does not exist
#   2 = usage / unconfigured (no connection string in env) — the caller decides whether
#       that is a legitimate "dependency not configured" soft-skip. This script never
#       soft-skips a real failure into a pass.
#
# USAGE
#   DATABASE_URL_ADMIN=... bash scripts/check-cron-heartbeat.sh --job validate_schemas \
#     --max-age-hours 26
#
# SECRET HYGIENE: the connection string is never printed. Only the NAME of the env var
# that supplied it is reported (same rule as scripts/check-modal-secret-keys.py).

set -euo pipefail

JOB_NAME="validate_schemas"
MAX_AGE_HOURS="26"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --job)
      JOB_NAME="${2:?--job needs a value}"
      shift 2
      ;;
    --max-age-hours)
      MAX_AGE_HOURS="${2:?--max-age-hours needs a value}"
      shift 2
      ;;
    -h | --help)
      sed -n '2,40p' "$0"
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

# ── Resolve a connection string by NAME, never echoing the value ────────────────────────
DB_URL=""
DB_URL_SOURCE=""
for candidate in DATABASE_URL_ADMIN DATABASE_URL_DIRECT DATABASE_URL; do
  value="${!candidate:-}"
  if [[ -n "$value" ]]; then
    DB_URL="$value"
    DB_URL_SOURCE="$candidate"
    break
  fi
done

if [[ -z "$DB_URL" ]]; then
  echo "UNCONFIGURED: none of DATABASE_URL_ADMIN / DATABASE_URL_DIRECT / DATABASE_URL is set." >&2
  echo "  Nothing was checked. This is NOT a pass." >&2
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ALARM: psql is not installed — the heartbeat could not be read." >&2
  echo "  Treated as a failure: an unrunnable checker must never look like a green one." >&2
  exit 1
fi

echo "cron-heartbeat check"
echo "  job            : ${JOB_NAME}"
echo "  max age        : ${MAX_AGE_HOURS}h"
echo "  connection from: \$${DB_URL_SOURCE} (value not printed)"
echo

# ── 1. Does the sink itself exist? ──────────────────────────────────────────────────────
# The verdict is decided here but ACTED ON at the very end: the digest below must print
# even when the heartbeat is missing. The one night the history digest matters most is the
# night the heartbeat cannot exist yet (first-ever run / migration not applied), so gating
# the reader behind the liveness verdict would blind exactly the case it was built for.
ALARM=0
last_success_at="n/a"
age_hours="n/a"
run_detail="n/a"

table_exists=$(psql "$DB_URL" -Atq -c "SELECT to_regclass('public.cron_heartbeats') IS NOT NULL;")
if [[ "$table_exists" != "t" ]]; then
  echo "ALARM: table public.cron_heartbeats does not exist." >&2
  echo "  Migration 0037_cron_heartbeats has not been applied to this database." >&2
  ALARM=1
fi

# ── 2. Heartbeat row + age, in one round trip ───────────────────────────────────────────
row=""
if [[ "$ALARM" -eq 0 ]]; then
  row=$(psql "$DB_URL" -Atq -F '|' -c "
  SELECT
    to_char(last_success_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'),
    round(EXTRACT(EPOCH FROM (NOW() - last_success_at)) / 3600.0, 2),
    coalesce(run_detail::text, '{}')
  FROM cron_heartbeats
  WHERE job_name = '${JOB_NAME}';
")
fi

if [[ "$ALARM" -eq 0 && -z "$row" ]]; then
  echo "ALARM: no heartbeat has EVER been recorded for job '${JOB_NAME}'." >&2
  echo "  The scheduled job has not completed successfully even once against this database." >&2
  echo "  Check: Modal app deployed? schedule registered? DATABASE_URL present in the" >&2
  echo "  estalara-secrets Modal secret? See docs/runbooks/SCHEMA_VALIDATION_CRON.md." >&2
  ALARM=1
fi

if [[ "$ALARM" -eq 0 ]]; then
  IFS='|' read -r last_success_at age_hours run_detail <<<"$row"

  echo "  last success   : ${last_success_at} (${age_hours}h ago)"
  echo "  run detail     : ${run_detail}"
  echo

  # Numeric comparison via awk — bash cannot compare the fractional hours directly.
  is_stale=$(awk -v a="$age_hours" -v m="$MAX_AGE_HOURS" 'BEGIN { print (a > m) ? "1" : "0" }')
  if [[ "$is_stale" == "1" ]]; then
    echo "ALARM: job '${JOB_NAME}' has not completed successfully in ${age_hours}h" >&2
    echo "  (allowed: ${MAX_AGE_HOURS}h). The scheduled run did not happen or did not finish." >&2
    echo "  Runbook: docs/runbooks/SCHEMA_VALIDATION_CRON.md" >&2
    ALARM=1
  else
    echo "PASS: job '${JOB_NAME}' completed successfully ${age_hours}h ago (limit ${MAX_AGE_HOURS}h)."
  fi
fi

# ── 3. Reader for the output of record (FOLLOW-893 AC3) ─────────────────────────────────
# `schema_validation_history` was written, self-queried for dedup and typed in Drizzle,
# and consumed by NOTHING. This digest is its first automated reader: it turns the table
# from write-only into a daily reported number. It is reporting, not gating — drift itself
# already has a channel (Sentry), and double-alarming the same event is how alarms get
# muted. A digest that cannot be produced is reported as such, never as zeroes.
echo
echo "schema_validation_history digest (last ${MAX_AGE_HOURS}h)"
digest=$(psql "$DB_URL" -Atq -F '|' -c "
  SELECT
    count(*),
    count(DISTINCT tenant_id),
    count(*) FILTER (WHERE drift_detected),
    count(*) FILTER (WHERE error LIKE 'fetch_failed:%'),
    count(*) FILTER (WHERE error LIKE 'config_gap:%' OR error LIKE 'validator_error:%'),
    coalesce(to_char(max(run_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), 'never')
  FROM schema_validation_history
  WHERE run_at > NOW() - INTERVAL '${MAX_AGE_HOURS} hours';
" 2>/dev/null || true)

if [[ -z "$digest" ]]; then
  echo "  (digest unavailable — schema_validation_history unreadable from this connection)"
else
  IFS='|' read -r d_rows d_tenants d_drift d_err d_unmeasured d_max <<<"$digest"
  echo "  rows written    : ${d_rows}"
  echo "  tenants covered : ${d_tenants}"
  echo "  drift rows      : ${d_drift}"
  echo "  fetch-error rows: ${d_err}"
  echo "  unmeasured rows : ${d_unmeasured}"
  echo "  newest run_at   : ${d_max}"
  # FOLLOW-902: `unmeasured` counts rows where the job could not form an opinion about
  # the tenant's DOM at all — no `sample_listing_url` to fetch (`config_gap:`), or a
  # fetch that matched zero of the stored selectors (`validator_error: zero_coverage`),
  # which is far more often the wrong page than a wholesale redesign. These are NOT
  # drift and must never be read as drift: on 2026-08-08 the domain-root fallback
  # scored app.estalara.com's marketing page 0/10 and called it drift. Non-zero here
  # means the validator needs configuring, not that a tenant's site changed.
  if [[ -n "${d_unmeasured}" && "${d_unmeasured}" != "0" ]]; then
    echo "  NOTE: ${d_unmeasured} row(s) could not be measured (missing sample_listing_url,"
    echo "        or zero selectors matched the fetched page). Not drift — see"
    echo "        docs/runbooks/SCHEMA_VALIDATION_CRON.md §7."
  fi
  if [[ "${d_rows}" == "0" && "$ALARM" -eq 0 ]]; then
    echo "  NOTE: zero history rows while the heartbeat is fresh means the run executed and"
    echo "        found no active tenant with a tenant_site_schemas row — a healthy no-op,"
    echo "        NOT a missed run. This is exactly the case the heartbeat disambiguates."
  fi
fi

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    if [[ "$ALARM" -eq 0 ]]; then
      echo "### cron heartbeat — \`${JOB_NAME}\` — OK"
    else
      echo "### cron heartbeat — \`${JOB_NAME}\` — ALARM"
    fi
    echo ""
    echo "- last success: \`${last_success_at}\` (${age_hours}h ago, limit ${MAX_AGE_HOURS}h)"
    echo "- run detail: \`${run_detail}\`"
    if [[ -n "${digest:-}" ]]; then
      echo "- \`schema_validation_history\` last ${MAX_AGE_HOURS}h: ${d_rows} rows, ${d_tenants} tenants, ${d_drift} drift, ${d_err} fetch-error, ${d_unmeasured} unmeasured (newest \`${d_max}\`)"
    fi
  } >>"$GITHUB_STEP_SUMMARY"
fi

# Verdict acted on last, after the digest has been reported.
exit "$ALARM"
