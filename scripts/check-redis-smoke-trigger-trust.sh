#!/usr/bin/env bash
# Redis shadow smoke — trigger-trust decision (FOLLOW-774 AC2).
#
# WHY THIS SCRIPT EXISTS
# ──────────────────────
# `.github/workflows/redis-shadow-smoke.yml`'s "Check trigger trust + secret
# availability" step decides `hard_fail_required` from ONE predicate: is this
# run a fork-originated `pull_request`? Every other trigger (push, schedule,
# workflow_dispatch, same-repo pull_request) is trusted and MUST hard-fail on
# a missing secret rather than soft-skip (FOLLOW-762 — RETRO-238 §4a LG-2).
#
# That predicate had never executed against a real fork PR in this repo
# (RETRO-241 §4c TG-1, "the fork-PR soft-skip branch has NEVER executed") and
# its failure direction is toward SKIP: if the fork check ever silently
# inverted, every trusted trigger would wrongly soft-skip instead of
# hard-failing — the exact condition FOLLOW-762 exists to make impossible. A
# fixture that merely asserts "the branch exists" proves nothing about
# whether a broken predicate would be caught. This script extracts the
# decision into one pure function plus a case-table `--self-test` that also
# runs the SAME table against a deliberately inverted-fork mutant and asserts
# the mismatch is caught — "an inverted fork predicate turns something RED",
# not "the code path is reachable" (mirrors the shape of
# `.github/workflows/ci.yml`'s `shellcheck-sentry-gates` job, PR #657, which
# re-lints WITHOUT `-P SCRIPTDIR` and asserts the specific SC1091 finding
# reappears — proving the flag is load-bearing, not decorative; that job
# covers one of four linted files, a limitation this script does not repeat
# since its case table already covers every trigger type this workflow
# fires on).
#
# WHAT THIS SCRIPT IS NOT
# ────────────────────────
# It is not a scanning/detection gate over a code region and does not claim
# coverage of unscanned files or directories — it is a pure decision function
# over five known GitHub Actions event types, all enumerated in the case
# table below. There is no residual/unguarded-region axis to register (Rule
# AP §6 scope: gates that document deliberately-unguarded gaps over a scanned
# region — this script scans nothing).
#
# AUTOMATED INVOCATION PATH (proof-of-execution, Rule Q)
# ────────────────────────────────────────────────────────
# `redis-shadow-smoke.yml`'s "Check trigger trust + secret availability" step
# sources this file and calls `compute_hard_fail_required` directly — so the
# function under self-test is the SAME code path production CI runs on every
# trigger, not a copy. A dedicated step ALSO runs `--self-test` on every
# workflow run (push/PR/schedule/workflow_dispatch alike), so the case table
# is exercised automatically, not just locally. Local invocation:
#   bash scripts/check-redis-smoke-trigger-trust.sh --self-test
#
# Exit codes: 0 = self-test passed. 1 = a case (or the mutation check) failed.

set -euo pipefail

# compute_hard_fail_required EVENT_NAME IS_FORKED_PR
#   EVENT_NAME    — github.event_name (push|pull_request|schedule|workflow_dispatch)
#   IS_FORKED_PR  — "true" | "false" (only meaningful when EVENT_NAME=pull_request)
# Prints "true" or "false" to stdout.
compute_hard_fail_required() {
  local event_name="$1"
  local is_forked_pr="$2"

  if [ "${event_name}" = "pull_request" ] && [ "${is_forked_pr}" = "true" ]; then
    echo "false"
  else
    echo "true"
  fi
}

# compute_hard_fail_required_mutant_inverted_fork EVENT_NAME IS_FORKED_PR
#   Simulates RETRO-241 TG-1's named failure mode: the fork-detection flag
#   silently inverts (e.g. `== false` typo'd for `== true`, or the upstream
#   `github.event.pull_request.head.repo.fork` context expression regresses).
#   Used ONLY by --self-test, to prove the case table would catch it — never
#   called by the production step.
compute_hard_fail_required_mutant_inverted_fork() {
  local event_name="$1"
  local is_forked_pr="$2"
  local inverted
  if [ "${is_forked_pr}" = "true" ]; then inverted="false"; else inverted="true"; fi
  compute_hard_fail_required "${event_name}" "${inverted}"
}

self_test() {
  local failures=0
  local total=0

  # ── Case table: every trigger type redis-shadow-smoke.yml's `on:` fires on.
  # format: event_name|is_forked_pr|expected_hard_fail_required
  local -a cases=(
    "push|false|true"
    "pull_request|false|true"
    "pull_request|true|false"
    "schedule|false|true"
    "workflow_dispatch|false|true"
  )

  echo "── Case table: correct implementation ──"
  local case_row event fork expected actual
  for case_row in "${cases[@]}"; do
    IFS='|' read -r event fork expected <<<"${case_row}"
    total=$((total + 1))
    actual="$(compute_hard_fail_required "${event}" "${fork}")"
    if [ "${actual}" = "${expected}" ]; then
      echo "PASS: compute_hard_fail_required(${event}, is_forked_pr=${fork}) = ${actual}"
    else
      echo "FAIL: compute_hard_fail_required(${event}, is_forked_pr=${fork}) = ${actual}, expected ${expected}"
      failures=$((failures + 1))
    fi
  done

  # ── Mutation check: prove an inverted fork predicate is CAUGHT, not just
  # that this code path is reachable (RETRO-241 §4c TG-1's actual bar).
  # Run the SAME correct case table's expectations against the MUTANT
  # function; the mutant must diverge from the correct table on at least the
  # two pull_request rows (where the fork flag is load-bearing), or this
  # self-test is vacuous.
  echo "── Mutation check: inverted-fork-predicate variant must diverge from the correct table ──"
  local mutant_divergences=0
  for case_row in "${cases[@]}"; do
    IFS='|' read -r event fork expected <<<"${case_row}"
    actual="$(compute_hard_fail_required_mutant_inverted_fork "${event}" "${fork}")"
    if [ "${actual}" != "${expected}" ]; then
      echo "OK (expected divergence): mutant(${event}, is_forked_pr=${fork}) = ${actual} != correct ${expected}"
      mutant_divergences=$((mutant_divergences + 1))
    fi
  done
  total=$((total + 1))
  if [ "${mutant_divergences}" -eq 0 ]; then
    echo "FAIL: the inverted-fork-predicate mutant produced IDENTICAL output to the correct"
    echo "implementation on every case — the case table cannot distinguish a broken fork check"
    echo "from a working one. This self-test would not catch RETRO-241 TG-1's failure mode."
    failures=$((failures + 1))
  else
    echo "PASS: the inverted-fork-predicate mutant diverged from the correct table on" \
      "${mutant_divergences} case(s) — an inverted fork predicate DOES turn something RED."
  fi

  echo ""
  if [ "${failures}" -gt 0 ]; then
    echo "SELF-TEST FAILED: ${failures}/${total} assertion(s) failed."
    return 1
  fi
  echo "SELF-TEST PASSED: ${total} assertions (5 case-table rows + 1 mutation-divergence check)."
  return 0
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
  exit $?
fi

# When sourced with no args (the production workflow step's usage), only the
# functions above are defined — the caller invokes compute_hard_fail_required
# directly. Falling through here (no exit/return) is deliberate: `exit` would
# kill the sourcing shell.
