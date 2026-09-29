#!/usr/bin/env bash
# localhost-down.sh - stop everything scripts/dev/localhost-up.sh started (FOLLOW-1261).
#
# Stops, by PID file, the process GROUPS the up script detached (.localhost-up/pids/*.pid), and stops
# only the docker containers the up script itself started (.localhost-up/containers-started). Nothing
# else is touched: no pkill by name, no container the operator had already running, no data removed
# (containers are stopped, not deleted, so the next up is a `docker start`).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="$REPO_ROOT/.localhost-up"
PID_DIR="$STATE_DIR/pids"
STARTED_CONTAINERS="$STATE_DIR/containers-started"

log() { printf '    %s\n' "$*"; }

# members <pid>: every process in the session the up script created for <pid> (setsid: sid == pid),
# plus its transitive children. Next.js, wrangler and uvicorn re-parent workers into their own
# process groups (next-server, workerd, the uvicorn worker), so a group kill alone left them holding
# the ports (measured 2026-09-29); the session and the child walk find them.
members() {
  local pid="$1" child
  pgrep -s "$pid" 2>/dev/null || true
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    echo "$child"
    members "$child"
  done
}

printf '=== stopping servers started by localhost-up.sh\n'
if [ -d "$PID_DIR" ]; then
  for f in "$PID_DIR"/*.pid; do
    [ -e "$f" ] || continue
    name="$(basename "$f" .pid)"
    pid="$(cat "$f")"
    mapfile -t tree < <(members "$pid" | sort -un)
    if [ "${#tree[@]}" -gt 0 ]; then
      kill -TERM "${tree[@]}" 2>/dev/null || true
      for _ in 1 2 3 4 5 6 7 8 9 10; do
        alive=0
        for p in "${tree[@]}"; do kill -0 "$p" 2>/dev/null && alive=1; done
        [ "$alive" -eq 1 ] || break
        sleep 1
      done
      if [ "$alive" -eq 1 ]; then
        kill -KILL "${tree[@]}" 2>/dev/null || true
        log "$name (pid $pid + ${#tree[@]} in tree): killed (did not exit on TERM)"
      else
        log "$name (pid $pid + ${#tree[@]} in tree): stopped"
      fi
    else
      log "$name: not running (stale pid file)"
    fi
    rm -f "$f"
  done
fi

printf '=== stopping containers started by localhost-up.sh\n'
if [ -s "$STARTED_CONTAINERS" ]; then
  sort -u "$STARTED_CONTAINERS" | while read -r c; do
    [ -n "$c" ] || continue
    if docker ps --format '{{.Names}}' | grep -qx "$c"; then
      docker stop "$c" >/dev/null && log "container $c: stopped"
    fi
  done
  : >"$STARTED_CONTAINERS"
else
  log "none (every container was already running before the up script, or none was started)"
fi

# The ingest secrets file the up script wrote (LOCAL_PILOT_ENVIRONMENT.md 3.7 teardown: do not leave
# a bearer lying in the tree). Gitignored either way.
rm -f "$REPO_ROOT/apps/ingest/.dev.vars"

# Report, never kill: a port still held now belongs to something this script did not start.
for port in 3000 5173 8079 8081 8090 8123 8787 9100; do
  owner="$(ss -ltnpH "sport = :$port" 2>/dev/null || true)"
  [ -z "$owner" ] || log "NOTE :$port is still bound (not started by us, or a container): $owner"
done
printf '=== down\n'
