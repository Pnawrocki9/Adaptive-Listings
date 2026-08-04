#!/usr/bin/env bash
# gh-pr-checks-verified.sh — false-green-proof CI check verification for a PR [FOLLOW-813]
#
# WHY THIS EXISTS
#   `gh pr checks <pr> --watch` was observed exiting 0 on PR #668 (and again per FOLLOW-813's
#   cross_ref on PR #670/#671) while `Rule I — wired-or-dead check` was still in a `fail`
#   state. CLAUDE.md ("Lessons from Paczka 1" item 1) and docs/AGENT_WORKFLOW.md mandated
#   exactly that incantation as the pre-READY_FOR_REVIEW gate. This script replaces it.
#
# ROOT CAUSE (characterised, not guessed — see PR description / RETROSPECTIVES for full
# evidence trail)
#   `gh pr checks --watch` polls the check-run list and declares the run "complete" once
#   every check-run it has seen SO FAR has settled. It does not know a check-run that gets
#   registered LATER is coming. In this repo's own ci.yml, `Rule I — wired-or-dead check`
#   has `needs: [lint]` — GitHub does not create its check-run until `lint` finishes, so it
#   reliably appears several minutes after the ~30 independent jobs that start at workflow
#   dispatch. Confirmed on PR #668's own timeline (GH API `check-runs`, head commit
#   0303eb1d): the bulk of jobs started at 17:15:20-17:16:56Z; `Rule I` started at
#   17:18:05Z — well after a watcher polling on a *default* interval could already have
#   observed a fully-settled snapshot of the checks it knew about and exited 0. This is not
#   repo-specific: upstream `gh` CLI tracks the identical class of bug as "handle 'no
#   checks' races in `pr checks --watch`" (cli/cli#7401) — a check-run set that changes
#   shape mid-poll is exactly what the watcher's exit condition does not account for. This
#   is a timing/discovery race tied to check-runs created mid-workflow (via `needs:`), not
#   a version regression in one `gh` release — reproduced-by-evidence, not by guess, per
#   FOLLOW-813 AC(1). `gh --version` at the time of writing: gh version 2.45.0 (2025-07-18).
#
# WHAT THIS SCRIPT DOES DIFFERENTLY
#   1. Never trusts a single snapshot or an exit code. Polls
#      `gh pr view --json statusCheckRollup` in a loop and only declares the run "settled"
#      once it has read the SAME set of (name, state, url) triples, with zero checks
#      PENDING, on two CONSECUTIVE polls. A check-run that appears (or changes state)
#      between polls changes that set and resets the stability counter — this directly
#      defeats the late-registration race described above, independent of how `--watch`'s
#      internal polling behaves.
#   2. Re-asserts pass/fail counts AFTER settling, from a fresh read — this is the "run it
#      again after the watcher exits" minimum bar from the FOLLOW-813 stub, done
#      automatically instead of requiring a human/agent to remember the second command.
#   3. Classifies every FAILURE against the repo's DOCUMENTED pre-existing-red gate list
#      instead of leaving "is this the known red or a new one" to be re-derived by hand
#      every session (see memory `project_ci_gate_landscape`, CONVENTIONS_PATCH.md Rule I).
#      The one current entry, `Rule I — wired-or-dead check`, is verified DYNAMICALLY: this
#      script fetches `main`'s own latest completed CI run, reads that run's own
#      "Violations found: N" line from the job log, and compares it against the PR run's
#      own count. Only PR-count <= main-count is classified pre-existing-red; a WORSE count
#      (the exact PR #668 near-miss: 193 vs a 192 baseline) is a genuine new failure and
#      fails this script loudly. There is no hardcoded violation number anywhere in this
#      script, so the classification cannot rot the way a static allowlist would — this
#      mirrors the shape FOLLOW-821 uses for Rule I's own baseline comparison. This script
#      does not implement FOLLOW-821; it only refuses to contradict its shape.
#   4. Exits non-zero on ANY unclassified failure, and non-zero on TIMEOUT. It never
#      silently treats "still pending" or "no checks registered yet" as success — those are
#      the "dependency not configured" case only when genuinely zero checks are configured
#      on the repo, which this script does not assume; it always waits and then fails loud
#      if nothing ever appears.
#
# USAGE
#   scripts/gh-pr-checks-verified.sh <pr-number> [--max-wait-seconds N] [--interval-seconds N]
#
# EXIT CODES
#   0  settled; every FAILURE (if any) is a documented, dynamically-verified pre-existing-red gate
#   1  at least one genuine (unclassified, or Rule I worse-than-main) failure
#   2  timed out waiting for checks to settle
#   3  usage error / gh CLI error
set -uo pipefail

usage() {
  echo "Usage: $0 <pr-number> [--max-wait-seconds N] [--interval-seconds N]" >&2
  exit 3
}

[[ $# -ge 1 ]] || usage
PR="$1"
shift

MAX_WAIT=900
INTERVAL=15
while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-wait-seconds)
      MAX_WAIT="$2"
      shift 2
      ;;
    --interval-seconds)
      INTERVAL="$2"
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

command -v gh >/dev/null 2>&1 || {
  echo "ERROR: gh CLI not found on PATH" >&2
  exit 3
}

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)"
if [[ -z "$REPO" ]]; then
  echo "ERROR: could not resolve repo via 'gh repo view'" >&2
  exit 3
fi

# Name of the one currently-documented pre-existing-red check in this repo
# (memory `project_ci_gate_landscape`, repeated confirmation across QUEUE.md sessions).
# If a second gate is ever documented as pre-existing-red, add its dynamic-comparison
# logic alongside RULE_I_NAME below rather than adding a bare name to a static allowlist —
# a static allowlist with no baseline comparison is exactly the "could itself rot" shape
# FOLLOW-813 AC(3) forbids.
RULE_I_NAME="Rule I — wired-or-dead check"

SNAPSHOT_FILTER='[.statusCheckRollup[] | {name: (.name // .context), state: (if .__typename=="StatusContext" then .state elif .status!="COMPLETED" then "PENDING" else .conclusion end), url: (.detailsUrl // .targetUrl // "")}] | sort_by(.name, .url)'

echo "=== gh-pr-checks-verified.sh — PR #$PR ($REPO) ==="
echo "Polling until two consecutive identical, fully-settled snapshots are observed."
echo "(This is what defeats the late-registered-check-run race that made '--watch' exit 0"
echo " on PR #668 while Rule I was still failing.)"
echo ""

prev_snapshot=""
elapsed=0
settled_snapshot=""

while :; do
  snapshot="$(gh pr view "$PR" --repo "$REPO" --json statusCheckRollup -q "$SNAPSHOT_FILTER" 2>/dev/null)"
  if [[ -z "$snapshot" ]]; then
    echo "ERROR: 'gh pr view' failed for PR #$PR" >&2
    exit 3
  fi

  if [[ "$snapshot" == "[]" ]]; then
    pending_count=1 # no checks registered yet — never treat as settled
  else
    pending_count=$(printf '%s' "$snapshot" | grep -o '"state":"PENDING"' | wc -l | tr -d ' ')
  fi

  echo "[t=${elapsed}s] checks known: $(printf '%s' "$snapshot" | grep -o '"name":' | wc -l | tr -d ' '), pending: $pending_count"

  if [[ "$pending_count" -eq 0 && -n "$prev_snapshot" && "$snapshot" == "$prev_snapshot" ]]; then
    settled_snapshot="$snapshot"
    break
  fi

  prev_snapshot="$snapshot"

  if [[ "$elapsed" -ge "$MAX_WAIT" ]]; then
    echo "" >&2
    echo "TIMEOUT after ${elapsed}s waiting for checks to settle. Last snapshot:" >&2
    echo "$snapshot" >&2
    exit 2
  fi

  sleep "$INTERVAL"
  elapsed=$((elapsed + INTERVAL))
done

echo ""
echo "Settled after ${elapsed}s (two consecutive identical, fully-completed snapshots)."
echo ""

# Re-assert counts from the settled snapshot (never from an exit code).
total=$(printf '%s' "$settled_snapshot" | grep -o '"name":' | wc -l | tr -d ' ')
success=$(printf '%s' "$settled_snapshot" | grep -o '"state":"SUCCESS"' | wc -l | tr -d ' ')
skipped=$(printf '%s' "$settled_snapshot" | grep -o '"state":"SKIPPED"' | wc -l | tr -d ' ')
neutral=$(printf '%s' "$settled_snapshot" | grep -o '"state":"NEUTRAL"' | wc -l | tr -d ' ')

# Everything that is not SUCCESS/SKIPPED/NEUTRAL is a failure-class state
# (FAILURE, CANCELLED, TIMED_OUT, ACTION_REQUIRED, STALE, ERROR).
mapfile -t failure_names < <(
  printf '%s' "$settled_snapshot" \
    | grep -oP '\{"name":"[^"]*","state":"(?!SUCCESS|SKIPPED|NEUTRAL)[^"]*","url":"[^"]*"\}'
)

echo "Total checks: $total | success: $success | skipped: $skipped | neutral: $neutral | failing: ${#failure_names[@]}"
echo ""

if [[ "${#failure_names[@]}" -eq 0 ]]; then
  echo "RESULT: all checks green. Safe to mark READY_FOR_REVIEW."
  exit 0
fi

genuine_failures=()
accepted_failures=()

for entry in "${failure_names[@]}"; do
  name="$(printf '%s' "$entry" | grep -oP '"name":"\K[^"]*')"
  url="$(printf '%s' "$entry" | grep -oP '"url":"\K[^"]*')"

  if [[ "$name" == "$RULE_I_NAME" ]]; then
    pr_job_id="$(printf '%s' "$url" | grep -oP '/job/\K[0-9]+' || true)"
    if [[ -z "$pr_job_id" ]]; then
      echo "WARN: could not extract job id from Rule I check url '$url' — treating as genuine failure (fail loud, never guess)."
      genuine_failures+=("$name ($url) — job id unresolvable")
      continue
    fi

    pr_violations="$(gh api "repos/$REPO/actions/jobs/${pr_job_id}/logs" 2>/dev/null | grep -oP 'Violations found\s*:\s*\K[0-9]+' | tail -1)"

    main_run_id="$(gh run list --repo "$REPO" --workflow ci.yml --branch main --status completed --json databaseId -L 1 -q '.[0].databaseId' 2>/dev/null)"
    main_violations=""
    if [[ -n "$main_run_id" ]]; then
      main_job_id="$(gh api "repos/$REPO/actions/runs/${main_run_id}/jobs" --paginate -q '.jobs[] | select(.name=="'"$RULE_I_NAME"'") | .id' 2>/dev/null | head -1)"
      if [[ -n "$main_job_id" ]]; then
        main_violations="$(gh api "repos/$REPO/actions/jobs/${main_job_id}/logs" 2>/dev/null | grep -oP 'Violations found\s*:\s*\K[0-9]+' | tail -1)"
      fi
    fi

    if [[ -z "$pr_violations" || -z "$main_violations" ]]; then
      echo "WARN: could not read violation counts (PR job $pr_job_id / main run $main_run_id) — treating as genuine failure (fail loud, never guess)."
      genuine_failures+=("$name — violation counts unreadable (PR job $url, main run $main_run_id)")
      continue
    fi

    echo "Rule I dynamic baseline check: PR violations=$pr_violations, main($main_run_id) violations=$main_violations"
    if [[ "$pr_violations" -le "$main_violations" ]]; then
      accepted_failures+=("$name — pre-existing-red, verified against main baseline ($pr_violations <= $main_violations)")
    else
      genuine_failures+=("$name — NEW violations: $pr_violations > main baseline $main_violations")
    fi
  else
    genuine_failures+=("$name ($url) — not on the documented pre-existing-red list")
  fi
done

echo ""
if [[ "${#accepted_failures[@]}" -gt 0 ]]; then
  echo "Documented pre-existing-red (non-blocking, verified, not silently hidden):"
  for f in "${accepted_failures[@]}"; do
    echo "  - $f"
  done
fi

if [[ "${#genuine_failures[@]}" -gt 0 ]]; then
  echo ""
  echo "GENUINE FAILURES (blocking — do NOT mark READY_FOR_REVIEW):"
  for f in "${genuine_failures[@]}"; do
    echo "  - $f"
  done
  echo ""
  echo "RESULT: FAIL. ${#genuine_failures[@]} genuine failure(s)."
  exit 1
fi

echo ""
echo "RESULT: all failing checks are documented, dynamically-verified pre-existing-red. Safe to mark READY_FOR_REVIEW."
exit 0
