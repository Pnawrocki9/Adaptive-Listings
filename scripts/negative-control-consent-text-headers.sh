#!/usr/bin/env bash
# negative-control-consent-text-headers.sh — Rule Q / Rule AM for the FOLLOW-935 effect probe.
#
# WHY THIS EXISTS
#   FOLLOW-935 was filed because a GREEN check over the consent-text headers asserted a config
#   object, not a response. A second green check that has never been observed going red would be
#   the same mistake with a different file name. This script makes the alarm fail on demand, in
#   every absence shape, and asserts that it does.
#
# WHAT IT RUNS
#   The REAL scripts/check-consent-text-headers.sh, UNMODIFIED, with its TARGET replaced by a
#   local one-response HTTP server (127.0.0.1). Per Rule AM the absent-header responses are
#   SYNTHESIZED here — the live source is never mutated, and nothing touches production.
#
#   One case is different by necessity: the "resolver broke" shape cannot be produced by a server,
#   so the real script is COPIED into a throwaway tree whose `packages/shared/src/domains.ts` no
#   longer carries the constants. The script itself is still unmodified.
#
# EXIT CODES
#   0  every case produced the expected verdict — the alarm fires when the effect is absent,
#      stays silent when it is present, and reports UNDETERMINED when it cannot look
#   1  a case produced the wrong verdict: the detector is broken
#
# USAGE
#   bash scripts/negative-control-consent-text-headers.sh
#   (no secrets, no network beyond 127.0.0.1, safe to run anywhere)

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROBE="${REPO_ROOT}/scripts/check-consent-text-headers.sh"
PORT="${NEGATIVE_CONTROL_PORT:-8941}"
DEAD_PORT="${NEGATIVE_CONTROL_DEAD_PORT:-8942}"
FAILURES=0
CASES=0
SERVER_PID=""

GOOD_ACAO='*'
GOOD_CACHE='public, max-age=300, stale-while-revalidate=60'

cleanup() { [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null; }
trap cleanup EXIT

# ── A one-response server: status + headers come from argv, so each case synthesizes one shape ──
start_server() { # start_server <status> <acao|-> <cache|->
  local status="$1" acao="$2" cache="$3"
  python3 - "$PORT" "$status" "$acao" "$cache" <<'PY' &
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

port, status, acao, cache = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3], sys.argv[4]

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(status)
        if acao != '-':
            self.send_header('Access-Control-Allow-Origin', acao)
        if cache != '-':
            self.send_header('Cache-Control', cache)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(b'{}')
    def log_message(self, *a):  # keep the case output readable
        pass

HTTPServer(('127.0.0.1', port), H).serve_forever()
PY
  SERVER_PID=$!
  for _ in $(seq 1 50); do
    curl -sS -m 1 -o /dev/null "http://127.0.0.1:${PORT}/consent-text.json" 2>/dev/null && return 0
    sleep 0.1
  done
  echo "could not start the synthetic server on ${PORT}" >&2
  return 1
}

stop_server() { [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null; SERVER_PID=""; sleep 0.2; }

run_case() { # run_case <id> <expected-exit> <expect-text> <probe args...>
  local id="$1" want="$2" expect_text="$3"
  shift 3
  CASES=$((CASES + 1))
  local out code
  out="$(bash "$@" 2>&1)"
  code=$?
  if [ "$code" -ne "$want" ]; then
    echo "NEGATIVE CONTROL FAIL [${id}]: expected exit ${want}, got ${code}"
    printf '%s\n' "$out" | sed 's/^/    /'
    FAILURES=$((FAILURES + 1))
    return
  fi
  if [ -n "$expect_text" ] && ! grep -qF "$expect_text" <<<"$out"; then
    echo "NEGATIVE CONTROL FAIL [${id}]: exit ${code} was right but the output never said"
    echo "    '${expect_text}'"
    printf '%s\n' "$out" | sed 's/^/    /'
    FAILURES=$((FAILURES + 1))
    return
  fi
  echo "OK [${id}] exit ${code}"
}

URL="http://127.0.0.1:${PORT}/consent-text.json"

# ── The absence shapes ────────────────────────────────────────────────────────────────────────
start_server 200 '-' "$GOOD_CACHE" || exit 1
run_case "acao-absent" 1 "access-control-allow-origin" "$PROBE" --url "$URL"
stop_server

# The FOLLOW-929 P0 shape one step subtler: a header IS present, but scoped to one origin. §D3
# forbids the document varying by origin, so this must fail as loudly as an absent header.
start_server 200 'https://app.estalara.com' "$GOOD_CACHE" || exit 1
run_case "acao-not-wildcard" 1 "access-control-allow-origin" "$PROBE" --url "$URL"
stop_server

start_server 200 "$GOOD_ACAO" '-' || exit 1
run_case "cache-control-absent" 1 "cache-control" "$PROBE" --url "$URL"
stop_server

start_server 200 "$GOOD_ACAO" 'no-store' || exit 1
run_case "cache-control-wrong" 1 "cache-control" "$PROBE" --url "$URL"
stop_server

start_server 404 "$GOOD_ACAO" "$GOOD_CACHE" || exit 1
run_case "asset-missing-404" 1 "expected HTTP 200" "$PROBE" --url "$URL"
stop_server

# ── The alarm must also be able to stay SILENT, or it proves nothing ──────────────────────────
start_server 200 "$GOOD_ACAO" "$GOOD_CACHE" || exit 1
run_case "all-present" 0 "is LIVE" "$PROBE" --url "$URL"
stop_server

# ── "Cannot look" must be UNDETERMINED (2), never green and never a false alarm ────────────────
run_case "host-unreachable" 2 "UNDETERMINED" "$PROBE" --url "http://127.0.0.1:${DEAD_PORT}/consent-text.json"

# The resolver shape: the REAL script, copied unmodified into a tree whose domains.ts lost the
# constants. This is the case that stops a future refactor from silently probing a guessed host.
FAKE_TREE="$(mktemp -d)"
mkdir -p "$FAKE_TREE/scripts" "$FAKE_TREE/packages/shared/src"
cp "$PROBE" "$FAKE_TREE/scripts/"
echo "export const SOMETHING_ELSE = 'refactored' as const;" > "$FAKE_TREE/packages/shared/src/domains.ts"
run_case "resolver-broken" 2 "do NOT hardcode a host" "$FAKE_TREE/scripts/$(basename "$PROBE")"
rm -rf "$FAKE_TREE"

echo
echo "cases: ${CASES}   failures: ${FAILURES}"
[ "$FAILURES" -eq 0 ]
