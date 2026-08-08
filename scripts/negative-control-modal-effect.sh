#!/usr/bin/env bash
# negative-control-modal-effect.sh — Rule Q for the FOLLOW-904 effect probe.
#
# WHY THIS EXISTS
#   FOLLOW-904 was filed because FOUR green checks over the Modal apps were simultaneously
#   meaningless. A fifth green check that has never been observed going red would be the
#   same mistake with a different file name. This script makes the alarm fail on demand,
#   in every absence shape, and asserts it.
#
# WHAT IT RUNS
#   The REAL scripts/check-modal-container-effect.py, unmodified, with its BACKEND
#   replaced — a fake `modal` module on PYTHONPATH (scripts/negative-control-fakes/modal.py)
#   for the intent-engine half, and a local one-status HTTP server for the llm-gateway
#   half. Exactly the shape cron-heartbeat.yml uses with its throwaway Postgres.
#
# EXIT CODES
#   0  every case produced the expected verdict — the alarm fires when the effect is absent
#      and stays silent when it is present
#   1  a case produced the wrong verdict: the detector is broken
#
# USAGE
#   bash scripts/negative-control-modal-effect.sh
#   (no secrets, no network beyond 127.0.0.1, safe to run anywhere)

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROBE="${REPO_ROOT}/scripts/check-modal-container-effect.py"
FAKES="${REPO_ROOT}/scripts/negative-control-fakes"
PORT="${NEGATIVE_CONTROL_PORT:-8931}"
DEAD_PORT="${NEGATIVE_CONTROL_DEAD_PORT:-8932}"
FAILURES=0
CASES=0

# Dummy values so the probe's "are we configured?" check passes into the fake backend.
# These are not credentials and unlock nothing — the fake modal never contacts Modal.
export MODAL_TOKEN_ID="fake-token-id"
export MODAL_TOKEN_SECRET="fake-token-secret"

run_case() {
  local id="$1" want="$2" expect_text="$3"
  shift 3
  CASES=$((CASES + 1))
  local out code
  out="$("$@" 2>&1)"
  code=$?
  if [ "$code" -ne "$want" ]; then
    echo "NEGATIVE CONTROL FAIL [${id}]: expected exit ${want}, got ${code}"
    echo "$out" | sed 's/^/    /'
    FAILURES=$((FAILURES + 1))
    return
  fi
  if [ -n "$expect_text" ] && ! grep -qF "$expect_text" <<<"$out"; then
    echo "NEGATIVE CONTROL FAIL [${id}]: exit ${code} was right but the output never said"
    echo "    '${expect_text}'"
    echo "$out" | sed 's/^/    /'
    FAILURES=$((FAILURES + 1))
    return
  fi
  echo "OK [${id}] exit ${code}"
}

echo "=== FOLLOW-904 effect-probe negative control ==="

# ── CASE N0 — unconfigured must be exit 2, NEVER 0 ──────────────────────────────────────
# RETRO-262's own finding: the property that caught FOLLOW-900 was that "nothing was
# checked" is distinguishable from "all good". HOME is redirected so a developer's
# ~/.modal.toml cannot make this case pass for the wrong reason.
TMP_HOME="$(mktemp -d)"
trap 'rm -rf "$TMP_HOME"' EXIT
run_case "N0 unconfigured (no token, no ~/.modal.toml)" 2 "This is NOT a pass" \
  env -u MODAL_TOKEN_ID -u MODAL_TOKEN_SECRET "HOME=$TMP_HOME" \
  python3 "$PROBE" --app intent-engine

# ── intent-engine shapes, against the fake modal backend ────────────────────────────────
# CASE N1 is THE case: the literal FOLLOW-900 traceback, produced inside a deployed
# container that a green `modal deploy` and `modal app list` both call healthy.
run_case "N1 container raises ModuleNotFoundError('nlp')" 1 "ModuleNotFoundError" \
  env "PYTHONPATH=$FAKES" FAKE_MODAL_MODE=module_not_found \
  python3 "$PROBE" --app intent-engine

run_case "N2 app not deployed / renamed (lookup fails)" 1 "could not resolve" \
  env "PYTHONPATH=$FAKES" FAKE_MODAL_MODE=app_not_found \
  python3 "$PROBE" --app intent-engine

run_case "N3 payload does not echo the probe's ids" 1 "main.py:100 did not run" \
  env "PYTHONPATH=$FAKES" FAKE_MODAL_MODE=wrong_payload \
  python3 "$PROBE" --app intent-engine

run_case "N4 empty payload" 1 "missing required keys" \
  env "PYTHONPATH=$FAKES" FAKE_MODAL_MODE=empty_payload \
  python3 "$PROBE" --app intent-engine

run_case "N5 non-dict return" 1 "expected a dict payload" \
  env "PYTHONPATH=$FAKES" FAKE_MODAL_MODE=not_a_dict \
  python3 "$PROBE" --app intent-engine

# CASE N6 — the healthy shape. Without it the probe could be trivially "correct" by always
# alarming, which is how alarms get muted.
run_case "N6 healthy container → silence" 0 "effect observed" \
  env "PYTHONPATH=$FAKES" FAKE_MODAL_MODE=healthy \
  python3 "$PROBE" --app intent-engine

# CASE N7 — --attempts is used post-deploy for cold images. Prove it cannot convert a
# persistent failure into a pass.
run_case "N7 --attempts 2 does not mask a persistent failure" 1 "ModuleNotFoundError" \
  env "PYTHONPATH=$FAKES" FAKE_MODAL_MODE=module_not_found \
  python3 "$PROBE" --app intent-engine --attempts 2

# ── llm-gateway shapes, against a real socket serving one status ────────────────────────
serve() {
  python3 "$FAKES/status_server.py" "$1" "$PORT" >/dev/null 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 40); do
    if python3 - "$PORT" <<'PY' 2>/dev/null; then break; fi
import socket, sys
s = socket.create_connection(("127.0.0.1", int(sys.argv[1])), timeout=0.2)
s.close()
PY
    sleep 0.25
  done
}
stop() {
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null
  wait "$SERVER_PID" 2>/dev/null
  SERVER_PID=""
}

serve 401
run_case "N8 endpoint answers 401 → effect observed" 0 "effect observed" \
  python3 "$PROBE" --app llm-gateway --endpoint-url "http://127.0.0.1:${PORT}/" --timeout 10
stop

serve 500
run_case "N9 endpoint 500 (module import failure shape)" 1 "expected 401" \
  python3 "$PROBE" --app llm-gateway --endpoint-url "http://127.0.0.1:${PORT}/" --timeout 10
stop

serve 200
run_case "N10 endpoint 200 for an INVALID bearer (auth not enforced)" 1 "did not enforce auth" \
  python3 "$PROBE" --app llm-gateway --endpoint-url "http://127.0.0.1:${PORT}/" --timeout 10
stop

run_case "N11 nothing listening → alarm, not silence" 1 "did not answer" \
  python3 "$PROBE" --app llm-gateway --endpoint-url "http://127.0.0.1:${DEAD_PORT}/" --timeout 5

echo
if [ "$FAILURES" -ne 0 ]; then
  echo "NEGATIVE CONTROL FAILED: ${FAILURES}/${CASES} case(s) wrong — the effect probe"
  echo "cannot be trusted to go red, so it must not be trusted when it is green."
  exit 1
fi
echo "Negative control PASSED: ${CASES}/${CASES} cases — the alarm fires on every absence"
echo "shape and stays silent on the one healthy shape."
