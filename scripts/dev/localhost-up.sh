#!/usr/bin/env bash
# localhost-up.sh - one-command localhost bring-up for the FOLLOW-819 differentiator harness
# (FOLLOW-1261, WP-1.4 of docs/PLAN-AUDIT-REMEDIATION-2026-09-24.md).
#
# Usage:   scripts/dev/localhost-up.sh
#          node tests/e2e/follow-819/differentiator-e2e.mjs   (env: see the end of this script's output)
#          scripts/dev/localhost-down.sh
#
# Every step below is the corrected, executed form from tests/e2e/follow-819/README.md section 3
# (and section 6.5-6.9) and docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md sections 3.7-3.8. Nothing here is
# new behaviour: this file only sequences those commands, waits for each to answer, and fails loudly
# at the first step that does not.
#
# Idempotent: a service whose PID file names a live process is left running; containers are started,
# created only if absent; Postgres migrations and seeds are re-run (they are idempotent). ClickHouse
# migrations run on every bring-up too and apply only the files not yet recorded in migrate.sh's
# `schema_migrations` table (FOLLOW-1280); step 3 prints which ones it applied.
# Long-running servers run detached (own process group) with logs in .localhost-up/logs and PID files
# in .localhost-up/pids (the directory is gitignored). localhost-down.sh stops exactly those.
#
# Environment knobs (all optional):
#   SKIP_CHAT=1     skip the chat hop (SRH :8079 + intent-engine shim :8090 + the :8078 Redis path
#                   adapter). Since FOLLOW-1299 the harness's AC(8) needs it: a SKIP_CHAT=1 stack
#                   grades AC(8) RED, by design.
#   SKIP_BUILD=1    skip the package builds (only when dist is known fresh in THIS checkout).
#   DEMO_MODE       defaults to 1 for the control plane (FOLLOW-1288: the harness's control arm uses
#                   the ADAPT_API_KEY ops caller, which exists only under DEMO_MODE=1). `DEMO_MODE=`
#                   (empty) starts it without demo tooling; step 11's preflight then fails loudly.
#
# FOLLOW-1313: the control plane also gets DATABASE_URL (the local al_pg_local, step 9). Without it
# /api/adapt/description skips its persistent Postgres cache layer (getDb() returns null, a fail-open
# miss) and every run exercises only the Redis/template paths. Step 11's `[pg_cache_off]` probe fails
# the bring-up unless the running control plane holds DATABASE_URL = the LOCAL host and the cache
# table accepts a write and read back from that role (rolled back, no residue).
#
# Memory: this machine class has ~4.8 GB. Every Node process here is capped at 2048 MB
# (--max-old-space-size) and the build runs with --concurrency=1.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

STATE_DIR="$REPO_ROOT/.localhost-up"
LOG_DIR="$STATE_DIR/logs"
PID_DIR="$STATE_DIR/pids"
VENV_DIR="$STATE_DIR/venv" # outside apps/ and packages/ on purpose: HARNESS_TREE_PATHSPEC covers those
STARTED_CONTAINERS="$STATE_DIR/containers-started"
mkdir -p "$LOG_DIR" "$PID_DIR"
touch "$STARTED_CONTAINERS"

# ---- constants: README section 3.4 / 3.6 (the fixture's tenant, NOT the pilot tenant; section 6.4) ----
export NODE_OPTIONS="--max-old-space-size=2048"
DATABASE_URL_ADMIN='postgresql://supabase_admin:postgres@127.0.0.1:5433/postgres'
ADAPT_API_KEY='local-follow819-key'
ADMIN_API_SECRET='local-follow819-admin-secret'
OPS_TENANT_ID='00000000-0000-0000-0000-0000000000e2'
ESTALARA_BACKEND_URL='http://localhost:8081'
LISTING_ID='839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c'
SRH_TOKEN='local-dev-token'
INTERNAL_API_SECRET='local-dev-internal-secret'
# FOLLOW-1203: the fixture host backend's SERVER api key (never on the page; the page's key is
# `pilot-key`). Its HMAC secret is generated below into .localhost-up/, never committed.
FIXTURE_SERVER_API_KEY='pilot-server-key'
FIXTURE_SERVER_HMAC_SECRET_FILE="$STATE_DIR/fixture-server-hmac-secret"

step() { printf '\n=== [%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
log() { printf '    %s\n' "$*"; }
die() {
  printf '\nFAILED: %s\n' "$*" >&2
  exit 1
}

need() { command -v "$1" >/dev/null 2>&1 || die "required tool not found on PATH: $1"; }

# ---- helpers ------------------------------------------------------------------------------------

# Lines of `ss -ltnp` for a listening TCP port (empty when free).
port_owner() { ss -ltnpH "sport = :$1" 2>/dev/null || true; }

pid_alive() {
  local f="$PID_DIR/$1.pid"
  [ -s "$f" ] && kill -0 "$(cat "$f")" 2>/dev/null
}

# wait_for <label> <timeout-seconds> <command...>: poll until the command succeeds.
wait_for() {
  local label="$1" timeout="$2" i
  shift 2
  for ((i = 0; i < timeout; i++)); do
    if "$@" >/dev/null 2>&1; then
      log "$label: answering (${i}s)"
      return 0
    fi
    sleep 1
  done
  die "$label did not answer within ${timeout}s (last command: $*)"
}

# start_bg <name> <port|-> <workdir> <command...>: detached, own process group, PID + log file.
# Refuses to start when the port is held by something this script did not start (README 6.8: an
# orphaned workerd on :8787 answers 404 and would attribute events by a stale KV record).
start_bg() {
  local name="$1" port="$2" workdir="$3"
  shift 3
  if pid_alive "$name"; then
    log "$name: already running (pid $(cat "$PID_DIR/$name.pid")) - leaving it"
    return 0
  fi
  if [ "$port" != "-" ]; then
    local owner
    owner="$(port_owner "$port")"
    [ -z "$owner" ] || die "port :$port is held by a process this script did not start (README 6.8):
$owner
Stop it (or run scripts/dev/localhost-down.sh if it is a stale start of ours) and re-run."
  fi
  (cd "$workdir" && setsid nohup "$@" >"$LOG_DIR/$name.log" 2>&1 &
    echo $! >"$PID_DIR/$name.pid")
  sleep 1
  pid_alive "$name" || die "$name exited immediately - see $LOG_DIR/$name.log:
$(tail -n 20 "$LOG_DIR/$name.log")"
  log "$name: started (pid $(cat "$PID_DIR/$name.pid"), log .localhost-up/logs/$name.log)"
}

# ensure_container <name> <docker run args...>: start it when it exists, create it when it does not.
ensure_container() {
  local name="$1"
  shift
  if docker ps --format '{{.Names}}' | grep -qx "$name"; then
    log "container $name: already running"
  elif docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
    docker start "$name" >/dev/null || die "docker start $name failed"
    echo "$name" >>"$STARTED_CONTAINERS"
    log "container $name: started"
  else
    docker run -d --name "$name" "$@" >/dev/null || die "docker run $name failed"
    echo "$name" >>"$STARTED_CONTAINERS"
    log "container $name: created (README section 3 form)"
  fi
}

# ---- 0. preconditions --------------------------------------------------------------------------
step "0/11 preconditions"
for t in node pnpm docker doppler curl ss python3 setsid; do need "$t"; done
docker info >/dev/null 2>&1 || die "docker daemon is not reachable"
doppler me >/dev/null 2>&1 || die "doppler is not logged in (needed for DEMO_MODE_JWT_SECRET and the mock server)"
log "free memory: $(free -m | awk '/^Mem:/ {print $7 " MB available of " $2 " MB"}')"

# ---- 1. dependencies + the worktree trap (README section 6.9) -----------------------------------
step "1/11 workspace install + worktree dist check (README 6.9)"
if [ ! -d node_modules ]; then
  log "node_modules missing - installing from the lockfile"
  pnpm install --frozen-lockfile --offline || pnpm install --frozen-lockfile ||
    die "pnpm install failed"
fi
DB_LINK="$(readlink -f apps/control-plane/node_modules/@estalara/db 2>/dev/null || true)"
case "$DB_LINK" in
  "$REPO_ROOT"/*) log "apps/control-plane resolves @estalara/db inside THIS checkout: $DB_LINK" ;;
  *) die "apps/control-plane/node_modules/@estalara/db resolves to '$DB_LINK', outside $REPO_ROOT.
The control plane would run ANOTHER checkout's packages/*/dist (README 6.9).
Fix: pnpm install --frozen-lockfile --offline   (in this checkout), then re-run." ;;
esac

# ---- 2. build ----------------------------------------------------------------------------------
step "2/11 build @estalara/shared @estalara/db @estalara/auth @estalara/sdk (turbo, --concurrency=1)"
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  log "SKIP_BUILD=1 - not building"
else
  pnpm exec turbo run build --concurrency=1 \
    --filter=@estalara/shared --filter=@estalara/db --filter=@estalara/auth --filter=@estalara/sdk ||
    die "package build failed"
fi
for f in packages/db/dist packages/auth/dist packages/shared/dist packages/sdk/dist/estalara-sdk.iife.js; do
  [ -e "$f" ] || die "expected build output missing in THIS checkout: $f"
done
log "dist present in this checkout for db, auth, shared, sdk"

# Local-only dev container credentials (README 3.1), not a secret. Kept in variables so a
# literal `user:pass` never appears on a curl line (gitleaks curl-auth-user).
CH_LOCAL_USER="default"
CH_LOCAL_PASSWORD="clickhouse"

# ---- 3. ClickHouse (README 3.1) ----------------------------------------------------------------
step "3/11 ClickHouse :8123 + migrations (README 3.1)"
ensure_container estalara_ch_local -p 8123:8123 \
  -e CLICKHOUSE_USER="$CH_LOCAL_USER" -e CLICKHOUSE_PASSWORD="$CH_LOCAL_PASSWORD" \
  clickhouse/clickhouse-server:25.8
wait_for "ClickHouse" 90 curl -sf http://localhost:8123/ping
# Runs on every bring-up (FOLLOW-1280): migrate.sh records applied versions in `schema_migrations`
# and skips them, so an already-migrated database gets exactly the files main added since, and an
# up-to-date one gets none. A database migrated before FOLLOW-1280 is bootstrapped once from its
# schema (see the migrate.sh header).
LOCAL=1 CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_PASSWORD="$CH_LOCAL_PASSWORD" \
  ./infra/clickhouse/scripts/migrate.sh >"$LOG_DIR/clickhouse-migrate.log" 2>&1 ||
  die "ClickHouse migrations failed - see $LOG_DIR/clickhouse-migrate.log:
$(tail -n 20 "$LOG_DIR/clickhouse-migrate.log")"
grep -E '^Bootstrap: recorded|^  applied: |^=== Migrations: ' "$LOG_DIR/clickhouse-migrate.log" |
  while IFS= read -r line; do log "ClickHouse ${line#  }"; done

# ---- 4. Postgres (README 3.2) ------------------------------------------------------------------
step "4/11 control-plane Postgres :5433 + migrate + seed (README 3.2)"
ensure_container al_pg_local -p 5433:5432 -e POSTGRES_PASSWORD=postgres \
  public.ecr.aws/supabase/postgres:17.6.1.134
wait_for "Postgres" 120 docker exec al_pg_local pg_isready -h 127.0.0.1 -U supabase_admin
# pg_isready can answer before the supabase init scripts have created supabase_admin's login.
wait_for "Postgres login" 120 docker exec -e PGPASSWORD=postgres al_pg_local \
  psql -h 127.0.0.1 -U supabase_admin -d postgres -c 'select 1'
# Migrate/seed run WITHOUT doppler, so DATABASE_URL_ADMIN is the local one (README 6.1).
(
  export DATABASE_URL_ADMIN
  timeout 300 pnpm db:bootstrap:local && timeout 300 pnpm db:migrate && timeout 300 pnpm seed:local-tenant
) >"$LOG_DIR/postgres-migrate.log" 2>&1 ||
  die "Postgres bootstrap/migrate/seed failed - see $LOG_DIR/postgres-migrate.log:
$(tail -n 20 "$LOG_DIR/postgres-migrate.log")"
log "Postgres bootstrapped, migrated, local-e2e tenant seeded (idempotent)"

# ---- 5. grounding source :8081 (README 3.3b) ---------------------------------------------------
step "5/11 fixture listing-details server :8081 (README 3.3b) + its signed conversion emitter (FOLLOW-1203)"
# The fixture host backend signs the conversion it emits to ingest (README 3.3c). The secret is a
# LOCAL dev value: generated once, kept in the gitignored state dir so a server left running by an
# earlier bring-up and the KV record seeded in step 8 always agree. Never a production secret.
if [ ! -s "$FIXTURE_SERVER_HMAC_SECRET_FILE" ]; then
  (umask 077 && node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))' \
    >"$FIXTURE_SERVER_HMAC_SECRET_FILE") || die "could not generate the fixture server HMAC secret"
  log "generated a local HMAC secret for the fixture host backend (.localhost-up/, not committed)"
fi
FIXTURE_SERVER_HMAC_SECRET="$(cat "$FIXTURE_SERVER_HMAC_SECRET_FILE")"
[[ "$FIXTURE_SERVER_HMAC_SECRET" =~ ^[0-9a-f]{64}$ ]] ||
  die "$FIXTURE_SERVER_HMAC_SECRET_FILE does not hold 32 hex bytes - delete it and re-run"
start_bg fixture-8081 8081 "$REPO_ROOT" env \
  INGEST_URL=http://localhost:8787 \
  "FIXTURE_SERVER_API_KEY=$FIXTURE_SERVER_API_KEY" \
  "FIXTURE_SERVER_HMAC_SECRET=$FIXTURE_SERVER_HMAC_SECRET" \
  node scripts/dev/fixture-listing-details-server.mjs
wait_for "listing-details :8081" 30 \
  curl -sf "http://localhost:8081/api/v1/listing/details?listing-uuid=$LISTING_ID&locale=EN"
# -f: a server started before FOLLOW-1203 (or without the env) answers 503 here.
curl -sf -o /dev/null http://localhost:8081/fixture/confirmed-conversion ||
  die "the :8081 fixture server has no configured conversion emitter (README 3.3c). A server left
running from an older bring-up has no signing env: run scripts/dev/localhost-down.sh, then re-run."
log "conversion emitter on :8081: configured (signed, server key $FIXTURE_SERVER_API_KEY)"

# ---- 6. SDK bundle host :9100 + fixture page :5173 (README 3.3) --------------------------------
step "6/11 SDK bundle host :9100 and fixture page :5173 (README 3.3)"
# PREWARM=off: the :9100 process is used ONLY as the static host of estalara-sdk.iife.js (README 3.3);
# its Anthropic prewarm would spend tokens on a mock the harness refuses to grade against.
start_bg mock-9100 9100 "$REPO_ROOT" \
  doppler run -p estalara-adaptive-listings -c dev -- env PREWARM=off node scripts/dev/mock-decision-server.mjs
wait_for ":9100 SDK bundle" 60 curl -sf -o /dev/null http://localhost:9100/estalara-sdk.iife.js
start_bg serve-5173 5173 "$REPO_ROOT" npx --yes serve -l 5173 tests/e2e/follow-819
wait_for ":5173 fixture page" 90 curl -sf -o /dev/null http://localhost:5173/fixture-listing.html

# ---- 7. chat hop: SRH :8079 + intent-engine shim :8090 (LOCAL_PILOT_ENVIRONMENT.md 3.7) --------
if [ "${SKIP_CHAT:-0}" = "1" ]; then
  step "7/11 chat hop - SKIPPED (SKIP_CHAT=1)"
else
  step "7/11 chat hop: SRH :8079 + intent-engine shim :8090 (LOCAL_PILOT_ENVIRONMENT.md 3.7)"
  docker network inspect f817 >/dev/null 2>&1 || docker network create f817 >/dev/null
  ensure_container f817-redis --network f817 redis:7-alpine
  ensure_container f817-srh --network f817 -p 8079:80 \
    -e SRH_MODE=env -e "SRH_TOKEN=$SRH_TOKEN" \
    -e SRH_CONNECTION_STRING="redis://f817-redis:6379" \
    hiett/serverless-redis-http:latest
  wait_for "SRH :8079" 60 curl -sf -X POST http://localhost:8079 \
    -H "Authorization: Bearer $SRH_TOKEN" -H 'Content-Type: application/json' -d '["SET","probe","ok"]'

  if [ ! -x "$VENV_DIR/bin/uvicorn" ]; then
    log "creating the shim virtualenv in .localhost-up/venv (outside HARNESS_TREE_PATHSPEC)"
    python3 -m venv "$VENV_DIR" || die "python3 -m venv failed"
    # Install the declared runtime deps + uvicorn without an editable install of the app: an
    # egg-info directory under apps/ would make the harness tree dirty.
    mapfile -t DEPS < <(python3 - <<'PY'
import tomllib
p = tomllib.load(open("apps/intent-engine/pyproject.toml", "rb"))["project"]
print("\n".join(p.get("dependencies", []) + ["uvicorn>=0.29"]))
PY
)
    [ "${#DEPS[@]}" -gt 0 ] || die "could not read apps/intent-engine/pyproject.toml dependencies (python >= 3.11 needed)"
    "$VENV_DIR/bin/pip" install -q "${DEPS[@]}" >"$LOG_DIR/shim-pip.log" 2>&1 ||
      die "pip install for the shim failed - see $LOG_DIR/shim-pip.log:
$(tail -n 20 "$LOG_DIR/shim-pip.log")"
  fi
  start_bg shim-8090 8090 "$REPO_ROOT/apps/intent-engine" \
    doppler run --project estalara-adaptive-listings --config dev --only-secrets ANTHROPIC_API_KEY -- \
    env UPSTASH_REDIS_REST_URL=http://localhost:8079 "UPSTASH_REDIS_REST_TOKEN=$SRH_TOKEN" \
    "INTERNAL_API_SECRET=$INTERNAL_API_SECRET" \
    "$VENV_DIR/bin/uvicorn" local_dev:app --port 8090 --app-dir src
  # An unauthenticated POST must be 401: the bearer gate is real (3.7). It needs a JSON body -
  # FastAPI answers a bodyless POST with 422 before the bearer check runs.
  wait_for "shim :8090 (401 without bearer)" 60 \
    bash -c '[ "$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "content-type: application/json" -d "{}" http://localhost:8090/chat_nlp_endpoint)" = 401 ]'

  # FOLLOW-1299 (README 6.11): the control plane reads Redis with Upstash's URL-path REST form, which
  # SRH answers 404. Without this adapter (and UPSTASH_REDIS_URL in step 9) the shadow key the shim
  # writes is never read and chat cannot reach /api/adapt on localhost.
  start_bg redis-adapter-8078 8078 "$REPO_ROOT" node scripts/dev/upstash-rest-path-adapter.mjs
  wait_for "Redis path adapter :8078" 30 curl -sf http://localhost:8078/health
  [ "$(curl -s -H "Authorization: Bearer $SRH_TOKEN" http://localhost:8078/get/probe)" = '{"result":"ok"}' ] ||
    die "the :8078 adapter did not read back the SRH probe key through the path form (README 6.11)"
fi

# ---- 8. ingest Worker :8787 (README 3.5, 6.4, 6.8) ---------------------------------------------
step "8/11 ingest Worker :8787 (README 3.5)"
if ! pid_alive ingest-8787; then
  # start_bg refuses if :8787 is held by a foreign process, which is the orphaned-workerd check (6.8).
  # Do the check first so the message points at the README.
  OWNER="$(port_owner 8787)"
  [ -z "$OWNER" ] || die "port :8787 is already bound (README 6.8 - an orphaned workerd answers 404 and
attributes events by a STALE KV record):
$OWNER
Kill that workerd (kill <pid> from the line above), then re-run."
fi
{
  printf 'CLICKHOUSE_USER = "default"\nCLICKHOUSE_PASSWORD = "clickhouse"\n'
  [ "${SKIP_CHAT:-0}" = "1" ] || printf 'INTERNAL_API_SECRET = "%s"\n' "$INTERNAL_API_SECRET"
} >apps/ingest/.dev.vars
(
  cd apps/ingest
  pnpm exec wrangler kv key put --binding KV_API_KEYS --local --preview false \
    --persist-to .wrangler/state "api_key:pilot-key" \
    '{"tenant_id":"00000000-0000-0000-0000-0000000000e2","scopes":["write:events"],"label":"FOLLOW-819 differentiator fixture","allowed_origins":["http://localhost:5173"]}'
  # FOLLOW-1203: the fixture host backend's server key. `hmac_secret` is what makes a request
  # signable (auth.ts); no allowed_origins - a server caller sends no Origin.
  pnpm exec wrangler kv key put --binding KV_API_KEYS --local --preview false \
    --persist-to .wrangler/state "api_key:$FIXTURE_SERVER_API_KEY" \
    "{\"tenant_id\":\"00000000-0000-0000-0000-0000000000e2\",\"scopes\":[\"write:events\"],\"label\":\"FOLLOW-1203 fixture host backend (signed)\",\"hmac_secret\":\"$FIXTURE_SERVER_HMAC_SECRET\"}"
) >"$LOG_DIR/ingest-kv-seed.log" 2>&1 ||
  die "KV api-key seed failed - see $LOG_DIR/ingest-kv-seed.log:
$(tail -n 20 "$LOG_DIR/ingest-kv-seed.log")"
# CALLER_SIGNED_COLUMN_ENABLED (FOLLOW-1203): step 3 applied migration 0024, so the Worker may write
# events.caller_signed. Without it every row reads unsigned and no conversion enters the lift.
INGEST_VARS=(--var ENVIRONMENT:development --var CLICKHOUSE_URL:http://localhost:8123 --var CLICKHOUSE_DATABASE:default --var CALLER_SIGNED_COLUMN_ENABLED:true)
[ "${SKIP_CHAT:-0}" = "1" ] ||
  INGEST_VARS+=(--var MODAL_CHAT_NLP_URL:http://localhost:8090/chat_nlp_endpoint)
start_bg ingest-8787 8787 "$REPO_ROOT/apps/ingest" \
  pnpm exec wrangler dev --local --port 8787 --persist-to .wrangler/state "${INGEST_VARS[@]}"
wait_for "ingest /health" 120 curl -sf -m 5 http://127.0.0.1:8787/health
# A FAILED build still binds :8787 and answers nothing (README 3.5); /health 200 above rules that out,
# this names the cause anyway.
if grep -q 'Could not resolve' "$LOG_DIR/ingest-8787.log"; then
  die "ingest log contains 'Could not resolve' - the Worker bundle is broken (README 3.5):
$(grep 'Could not resolve' "$LOG_DIR/ingest-8787.log" | head -n 5)"
fi

# ---- 9. control plane :3000 (README 3.4, 6.5) --------------------------------------------------
step "9/11 control plane :3000 - apps/control-plane 'next dev' under doppler, NOT root 'pnpm dev' (README 6.5)"
# The `env` form so the local overrides win over Doppler's hosted DATABASE_URL_ADMIN / ADAPT_API_KEY
# (README 6.1). DATABASE_URL (FOLLOW-1313) is set to the SAME local URL: Doppler dev defines none, and
# the description route reads it for the persistent cache (description_cache_persistent). The local
# container defines no non-admin login role that survives the table's tenant-isolation RLS without a
# JWT (only supabase_admin / postgres bypass it), so the admin URL is reused; it is local-only. DEMO_MODE_JWT_SECRET is not overridden: it comes from Doppler dev and must reach next.
# FOLLOW-1288: DEMO_MODE=1 turns on the ops caller (ADAPT_API_KEY) and the demo-JWT variant of
# /api/adapt; the harness's control arm needs the ops caller (README 3). Unset -> 1.
CP_DEMO_MODE="${DEMO_MODE-1}"
# FOLLOW-1299: with the chat hop on, the control plane reads the SAME Redis the shim writes (through
# the :8078 adapter). Doppler dev carries no UPSTASH_REDIS_URL, so without these two the reader is a
# configured no-op and every shadow key is invisible to /api/adapt.
CP_REDIS_ENV=()
[ "${SKIP_CHAT:-0}" = "1" ] ||
  CP_REDIS_ENV=(UPSTASH_REDIS_URL=http://localhost:8078 "UPSTASH_REDIS_TOKEN=$SRH_TOKEN")
start_bg control-plane-3000 3000 "$REPO_ROOT/apps/control-plane" \
  doppler run -c dev -- env \
  "${CP_REDIS_ENV[@]}" \
  FEEDBACK_ENDPOINT_ENABLED=true \
  "DEMO_MODE=$CP_DEMO_MODE" \
  "ADAPT_API_KEY=$ADAPT_API_KEY" \
  "ADMIN_API_SECRET=$ADMIN_API_SECRET" \
  "OPS_TENANT_ID=$OPS_TENANT_ID" \
  "DATABASE_URL_ADMIN=$DATABASE_URL_ADMIN" \
  "DATABASE_URL=$DATABASE_URL_ADMIN" \
  "ESTALARA_BACKEND_URL=$ESTALARA_BACKEND_URL" \
  SCORING_PATH_COLUMN_ENABLED=true \
  CALLER_SIGNED_COLUMN_ENABLED=true \
  CLICKHOUSE_URL=http://localhost:8123 \
  CLICKHOUSE_USER="$CH_LOCAL_USER" CLICKHOUSE_PASSWORD="$CH_LOCAL_PASSWORD" \
  "NODE_OPTIONS=$NODE_OPTIONS" \
  pnpm dev
# curl exits 0 on ANY HTTP answer (even a 404/500) and non-zero only when nothing answers.
wait_for "control plane :3000" 240 curl -s -o /dev/null -m 60 http://localhost:3000/

# ---- 10. warm the routes (README 6.6: cold compile > the preflight's 8 s timeout) --------------
step "10/11 warm /api/adapt and the admin rollup route (README 6.6)"
curl -s -o /dev/null -m 180 -X POST -H 'content-type: application/json' -d '{}' \
  http://localhost:3000/api/adapt || die "warm-up POST /api/adapt did not complete in 180 s"
log "/api/adapt warm"
curl -s -o /dev/null -m 180 -H "Authorization: Bearer $ADMIN_API_SECRET" \
  "http://localhost:3000/api/admin/analytics/rollup?tenant_id=$OPS_TENANT_ID" ||
  die "warm-up GET /api/admin/analytics/rollup did not complete in 180 s"
log "admin rollup warm"
# Second pass: the probe must answer inside its 8 s budget now.
curl -s -o /dev/null -m 8 -X POST -H 'content-type: application/json' -d '{}' \
  http://localhost:3000/api/adapt || die "/api/adapt still slower than 8 s after warm-up"

# ---- 11. preflight: the harness's OWN probes, imported from the harness (not re-implemented) ----
step "11/11 preflight: assertRealControlPlane + assertDemoModeOn + assertGroundingSource + assertIngestReachable + assertConversionEmitter"
DATABASE_URL_ADMIN="$DATABASE_URL_ADMIN" ADAPT_API_KEY="$ADAPT_API_KEY" \
  ADMIN_API_SECRET="$ADMIN_API_SECRET" OPS_TENANT_ID="$OPS_TENANT_ID" \
  ESTALARA_BACKEND_URL="$ESTALARA_BACKEND_URL" \
  LISTING_URL=http://localhost:5173/fixture-listing.html \
  node --input-type=module -e '
    globalThis.FOLLOW1186_IMPORT_ONLY = true;
    const h = await import("./tests/e2e/follow-819/differentiator-e2e.mjs");
    const cp = await h.assertRealControlPlane();
    console.log("    control plane:", cp.credentialClass ?? "ok", cp.status, cp.reason ?? "");
    const dm = await h.assertDemoModeOn();
    console.log("    DEMO_MODE:", dm.reason);
    const gs = await h.assertGroundingSource();
    console.log("    grounding:", JSON.stringify(gs).slice(0, 160));
    const ig = await h.assertIngestReachable();
    console.log("    ingest:", JSON.stringify(ig).slice(0, 160));
    const ce = await h.assertConversionEmitter();
    console.log("    conversion emitter:", JSON.stringify(ce).slice(0, 160));
  ' || die "the harness preflight rejected this substrate (see the message above and README section 3.6)"

# ---- [pg_cache_off] (FOLLOW-1313): the description route's Postgres cache layer is ON, locally -----
# /api/adapt/description turns the PG layer on iff process.env.DATABASE_URL is set in the control
# plane (description-pg-cache.ts getDb()); unset = silent fail-open miss. Least invasive proof, two parts:
#  (a) read DATABASE_URL (not _ADMIN) from the environment of the process that owns :3000 and require
#      host 127.0.0.1 port 5433 (never the hosted pooler); print host:port only, never the value;
#  (b) with that same URL's role, INSERT then SELECT a probe row into description_cache_persistent in a
#      transaction that is ROLLED BACK (also proves the table + FOLLOW-1291's listing_revisions exist).
step "11b/11 [pg_cache_off] preflight: description route PG cache layer active against the LOCAL host"
CP_PID="$(port_owner 3000 | grep -o 'pid=[0-9]*' | head -n 1 | cut -d= -f2)"
[ -n "$CP_PID" ] || die "[pg_cache_off] nothing listens on :3000"
CP_DB_URL="$(tr '\0' '\n' <"/proc/$CP_PID/environ" 2>/dev/null | grep '^DATABASE_URL=' | head -n 1 | cut -d= -f2- || true)"
[ -n "$CP_DB_URL" ] || die "[pg_cache_off] the control plane (pid $CP_PID) has no DATABASE_URL: /api/adapt/description
skips its Postgres cache layer (fail-open miss) and runs exercise only Redis/template paths (FOLLOW-1313)."
mapfile -t PGP < <(CP_DB_URL="$CP_DB_URL" python3 -c '
import os, urllib.parse as u
p = u.urlparse(os.environ["CP_DB_URL"])
print(p.hostname or ""); print(p.port or 5432); print(u.unquote(p.username or "")); print(u.unquote(p.password or "")); print((p.path or "/").lstrip("/") or "postgres")')
if [ "${PGP[0]}" != "127.0.0.1" ] || [ "${PGP[1]}" != "5433" ]; then
  die "[pg_cache_off] the control plane's DATABASE_URL points at ${PGP[0]}:${PGP[1]}, not the local 127.0.0.1:5433.
A series would write to the wrong (possibly HOSTED) database."
fi
log "[pg_cache_off] control plane DATABASE_URL host: ${PGP[0]}:${PGP[1]} (local al_pg_local)"
PROBE_OUT="$(docker exec -e "PGPASSWORD=${PGP[3]}" al_pg_local psql -h 127.0.0.1 -U "${PGP[2]}" -d "${PGP[4]}" \
  -v ON_ERROR_STOP=1 -Atc "begin; insert into description_cache_persistent (tenant_id, listing_id, archetype, locale, description, model, claims_validation, listing_revision) values ('$OPS_TENANT_ID', '__localhost_up_probe__', 'probe', 'en', 'probe', 'probe', 'claims-v1', 0); select 'probe_rows=' || count(*) from description_cache_persistent where listing_id = '__localhost_up_probe__'; select 'listing_revisions_rows=' || count(*) from listing_revisions; rollback;" 2>&1)" ||
  die "[pg_cache_off] write/read round-trip against description_cache_persistent failed:
$PROBE_OUT"
log "[pg_cache_off] round-trip (rolled back): $(printf '%s' "$PROBE_OUT" | grep -E '^(probe_rows|listing_revisions_rows)=' | tr '\n' ' ')"
case "$PROBE_OUT" in *probe_rows=1*) ;; *) die "[pg_cache_off] probe row not read back: $PROBE_OUT" ;; esac

step "UP. Peak-sensitive: $(free -m | awk '/^Mem:/ {print $7 " MB available"}')"
cat <<EOF

Run the harness (from the repo root):

  DATABASE_URL_ADMIN='$DATABASE_URL_ADMIN' \\
  ADAPT_API_KEY=$ADAPT_API_KEY ADMIN_API_SECRET=$ADMIN_API_SECRET \\
  OPS_TENANT_ID=$OPS_TENANT_ID ESTALARA_BACKEND_URL=$ESTALARA_BACKEND_URL \\
  LISTING_URL=http://localhost:5173/fixture-listing.html \\
    node tests/e2e/follow-819/differentiator-e2e.mjs

Stop everything this script started:  scripts/dev/localhost-down.sh
Logs: .localhost-up/logs/
EOF
