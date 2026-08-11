#!/usr/bin/env bash
# .claude/hooks/test-hooks.sh
#
# Drives `session-stop.sh` and `session-start.sh` against a throwaway repo across every state
# they claim to distinguish, and asserts the OUTPUT rather than eyeballing it. [FOLLOW-959 AC(5)]
#
# This harness exists because of a specific miss: both hooks were hand-verified when they shipped,
# and both hand-verifications drove only the paths with a `session_id` present. The fallback path
# — reached whenever the payload omits it — interpolated a branch name containing `/` into the
# sentinel path, so `touch` failed, `|| true` swallowed it, and the hook blocked on EVERY turn.
# Executing the script is what found it; a harness is what keeps it found.
#
# Usage: bash .claude/hooks/test-hooks.sh     (exit 0 = all pass)

set -uo pipefail
HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STOP="$HOOKS_DIR/session-stop.sh"
START="$HOOKS_DIR/session-start.sh"

SANDBOX="$(mktemp -d)"
export TMPDIR="$SANDBOX/tmp"
mkdir -p "$TMPDIR"
PASS=0
FAIL=0

cleanup() { rm -rf "$SANDBOX"; }
trap cleanup EXIT

check() { # check <label> <expected> <actual>
  if [[ "$2" == "$3" ]]; then
    echo "  ✔ $1"
    PASS=$((PASS + 1))
  else
    echo "  ✘ $1 — expected '$2', got '$3'"
    FAIL=$((FAIL + 1))
  fi
}

# `decision` field, or the literal `none`. Also fails the case if the output is not valid JSON,
# which is the failure mode a python3-only emitter had.
decision() {
  local out
  out="$(printf '%s' "$1" | bash "$STOP" 2>/dev/null)"
  [[ -z "$out" ]] && { echo "EMPTY-OUTPUT"; return; }
  printf '%s' "$out" | grep -q '^{.*}$' || { echo "NOT-JSON"; return; }
  if printf '%s' "$out" | grep -q '"decision":"block"'; then echo "block"; else echo "none"; fi
}

start_speaks() {
  local out
  out="$(printf '%s' "${1:-{\}}" | bash "$START" 2>/dev/null)"
  [[ -z "$out" ]] && { echo "silent"; return; }
  printf '%s' "$out" | grep -q '^{.*}$' || { echo "NOT-JSON"; return; }
  echo "speaks"
}

REPO="$SANDBOX/repo"
mkdir -p "$REPO"
cd "$REPO" || exit 1
git init -q -b main .
git config user.email t@t
git config user.name t
echo base > f.txt
git add .
git commit -qm base

echo "session-stop.sh"
# A slash-bearing branch name — the shape CLAUDE.md mandates and the shape that broke the sentinel.
git checkout -qb worker/TICKET-1-example
echo dirty > new.txt

check "zero-commit + dirty, first stop → block" "block" "$(decision '{"session_id":"S1"}')"
check "same session, second stop → no block" "none" "$(decision '{"session_id":"S1"}')"
# The regression this harness was written for.
check "NO session_id, first stop → block" "block" "$(decision '{}')"
check "NO session_id, second stop → no block (sentinel key must be sanitised)" "none" "$(decision '{}')"

git add -A && git commit -qm own
echo again > another.txt
check "branch has own commits + dirty → no block" "none" "$(decision '{"session_id":"S2"}')"

git add -A && git commit -qm saved
check "clean tree → no block" "none" "$(decision '{"session_id":"S3"}')"

echo "session-start.sh"
git checkout -q main
check "clean tree on main → SILENT" "silent" "$(start_speaks)"

git checkout -qb worker/TICKET-2-example
echo dirty > leftover.txt
check "zero-commit + dirty → speaks" "speaks" "$(start_speaks)"

git worktree add -q -b agent-x .claude/worktrees/agent-x main 2>/dev/null
echo stranded > .claude/worktrees/agent-x/stranded.txt
check "stranded agent worktree → speaks" "speaks" "$(start_speaks)"

echo
echo "passed: $PASS   failed: $FAIL"
[[ "$FAIL" -eq 0 ]]
