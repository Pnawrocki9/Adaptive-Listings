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

# ── Fixture seam (self-test only — Rule AM) ───────────────────────────────────
# When GH_PR_CHECKS_FIXTURE_DIR is set, every network read below is served from
# a file in that directory instead of from `gh`. It is set ONLY by this script's
# own --self-test mode and never by a caller: it exists so the gate can be
# exercised hermetically and offline against SYNTHESIZED check states. Driving
# the self-test off a live PR would be neither reproducible nor capable of
# containing the failure shapes that have to be pinned (a compensating-symbol
# swap, a rate-limited log fetch, a grep with no PCRE).
FIXTURE_DIR="${GH_PR_CHECKS_FIXTURE_DIR:-}"

# Prints the check-state snapshot for the PR under test.
fetch_snapshot() {
  if [[ -n "$FIXTURE_DIR" ]]; then
    cat "$FIXTURE_DIR/snapshot.json"
    return 0
  fi
  gh pr view "$PR" --repo "$REPO" --json statusCheckRollup -q "$SNAPSHOT_FILTER" 2>/dev/null
}

# fetch_job_log <job-id> <fixture-basename>
# Prints a raw job log on stdout. Returns NON-ZERO, with the underlying
# diagnosis on stderr, when the FETCH ITSELF failed. Keeping that distinct from
# "the log came back fine but has no Rule I output in it" is what lets the
# caller name which of the two happened (FOLLOW-827 AC(4)) instead of rendering
# an auth failure, a 403 rate-limit and a format change as one unactionable WARN.
fetch_job_log() {
  if [[ -n "$FIXTURE_DIR" ]]; then
    if [[ ! -f "$FIXTURE_DIR/$2" ]]; then
      echo "HTTP 403: API rate limit exceeded for installation (fixture: no $2)" >&2
      return 1
    fi
    cat "$FIXTURE_DIR/$2"
    return 0
  fi
  gh api "repos/$REPO/actions/jobs/$1/logs"
}

# Prints "<run-id>\t<head-sha>\t<created-at>" for main's LATEST COMPLETED ci.yml
# run — the Rule I baseline. The head sha and timestamp are fetched in the same
# call as the id purely so the baseline's identity can be PRINTED (AC(3)): a
# baseline that silently ratchets forward is only invisible if nobody names it.
fetch_main_run_meta() {
  if [[ -n "$FIXTURE_DIR" ]]; then
    cat "$FIXTURE_DIR/main-run-meta.tsv"
    return 0
  fi
  gh run list --repo "$REPO" --workflow ci.yml --branch main --status completed \
    --json databaseId,headSha,createdAt -L 1 \
    -q '.[0] | "\(.databaseId)\t\(.headSha)\t\(.createdAt)"'
}

# fetch_main_job_id <run-id>
fetch_main_job_id() {
  if [[ -n "$FIXTURE_DIR" ]]; then
    cat "$FIXTURE_DIR/main-job-id"
    return 0
  fi
  gh api "repos/$REPO/actions/runs/$1/jobs" --paginate \
    -q '.jobs[] | select(.name=="'"$RULE_I_NAME"'") | .id' | head -1
}

# ── Self-test mode ────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--self-test" ]]; then
  echo "=== gh-pr-checks-verified.sh --self-test ==="
  echo "Synthesized fixtures only (Rule AM). Nothing below reads a live PR's check"
  echo "state; the whole mode runs offline."
  echo ""

  st_tmp="$(mktemp -d)"
  # shellcheck disable=SC2064  # expand $st_tmp now, not at trap time
  trap "rm -rf '$st_tmp'" EXIT
  st_out="$st_tmp/out.txt"
  st_failures=0
  st_passes=0
  st_job_url="https://github.com/o/r/actions/runs/30000/job"

  # _st_fixture <name> — makes a fixture dir carrying the baseline metadata every
  # Rule I fixture needs, and echoes its path.
  _st_fixture() {
    local d="$st_tmp/$1"
    mkdir -p "$d"
    printf '4242\tdeadbeefcafe1234\t2026-08-05T10:00:00Z\n' > "$d/main-run-meta.tsv"
    echo "777" > "$d/main-job-id"
    echo "$d"
  }

  # _st_rule_i_log <path> <count> <symbol@file>...
  # Writes a synthetic Rule I job log in check-rule-i.sh's real output shape,
  # including the ISO timestamp prefix GitHub puts on every raw log line (so the
  # parser is pinned against the format it actually meets, not a tidied one).
  _st_rule_i_log() {
    local path="$1" count="$2"
    shift 2
    : > "$path"
    local s
    for s in "$@"; do
      printf "2026-08-05T10:00:01.1234567Z WARN: '%s' in %s — zero non-test importers\n" \
        "${s%%@*}" "${s##*@}" >> "$path"
    done
    printf '2026-08-05T10:00:09.1234567Z Violations found    : %s\n' "$count" >> "$path"
  }

  # Runs the gate against a fixture dir, returning its exit code. A PATH override
  # (used by the degraded-grep fixture) is honoured via ST_PATH_OVERRIDE.
  _st_run() {
    local dir="$1"
    local rc=0
    if [[ -n "${ST_PATH_OVERRIDE:-}" ]]; then
      PATH="$ST_PATH_OVERRIDE" GH_PR_CHECKS_FIXTURE_DIR="$dir" \
        bash "$0" 1 --max-wait-seconds 2 --interval-seconds 1 > "$st_out" 2>&1 || rc=$?
    else
      GH_PR_CHECKS_FIXTURE_DIR="$dir" \
        bash "$0" 1 --max-wait-seconds 2 --interval-seconds 1 > "$st_out" 2>&1 || rc=$?
    fi
    return "$rc"
  }

  _st_fail() {
    st_failures=$((st_failures + 1))
    echo "--- gate output ---"
    cat "$st_out"
    echo "-------------------"
  }

  # _st_expect <label> <expected-rc> <fixture-dir> [required-substring]
  # Asserts the SPECIFIC exit code, never merely non-zero, and (when given) that
  # the verdict was reached for the stated reason.
  _st_expect() {
    local label="$1" want_rc="$2" dir="$3" needle="${4:-}"
    local rc=0
    _st_run "$dir" || rc=$?
    if [[ "$rc" -ne "$want_rc" ]]; then
      echo "SELF-TEST FAIL: $label"
      echo "  expected exit $want_rc, got $rc"
      _st_fail
      return 0
    fi
    if [[ -n "$needle" ]] && ! grep -qF -- "$needle" "$st_out"; then
      echo "SELF-TEST FAIL: $label"
      echo "  exited $rc as expected, but never said '$needle' — the right verdict"
      echo "  for the wrong reason is not a pass."
      _st_fail
      return 0
    fi
    st_passes=$((st_passes + 1))
    echo "OK: self-test PASSED — $label"
  }

  st_rule_i_entry='{"name":"Rule I — wired-or-dead check","state":"FAILURE","url":"'"$st_job_url"'/9"}'
  st_lint_ok='{"name":"Lint","state":"SUCCESS","url":"'"$st_job_url"'/1"}'
  st_tc_ok='{"name":"Typecheck","state":"SUCCESS","url":"'"$st_job_url"'/2"}'
  st_tc_bad='{"name":"Typecheck","state":"FAILURE","url":"'"$st_job_url"'/2"}'

  # ── F1: every check green → 0 ───────────────────────────────────────────────
  st_d="$(_st_fixture all-green)"
  echo "[$st_lint_ok,$st_tc_ok]" > "$st_d/snapshot.json"
  _st_expect "all checks green exits 0" 0 "$st_d" "RESULT: all checks green."

  # ── F2: one failure that is not on the pre-existing-red list → 1 ────────────
  st_d="$(_st_fixture new-failure)"
  echo "[$st_lint_ok,$st_tc_bad]" > "$st_d/snapshot.json"
  _st_expect "an undocumented failing check exits 1" 1 "$st_d" \
    "not on the documented pre-existing-red list"

  # ── F3: Rule I, PR symbol set IDENTICAL to main → 0 (accepted, not hidden) ──
  st_d="$(_st_fixture rule-i-equal)"
  echo "[$st_lint_ok,$st_rule_i_entry]" > "$st_d/snapshot.json"
  _st_rule_i_log "$st_d/pr-rule-i.log" 2 'alpha@packages/a/src/one.ts' 'beta@packages/a/src/two.ts'
  _st_rule_i_log "$st_d/main-rule-i.log" 2 'alpha@packages/a/src/one.ts' 'beta@packages/a/src/two.ts'
  _st_expect "Rule I with the same symbols as main exits 0" 0 "$st_d" \
    "pre-existing-red"

  # ── F4: Rule I, PR is a strict SUPERSET of main → 1 ────────────────────────
  st_d="$(_st_fixture rule-i-worse)"
  echo "[$st_lint_ok,$st_rule_i_entry]" > "$st_d/snapshot.json"
  _st_rule_i_log "$st_d/pr-rule-i.log" 3 'alpha@packages/a/src/one.ts' \
    'beta@packages/a/src/two.ts' 'gamma@packages/a/src/three.ts'
  _st_rule_i_log "$st_d/main-rule-i.log" 2 'alpha@packages/a/src/one.ts' 'beta@packages/a/src/two.ts'
  _st_expect "Rule I with a NEW symbol on top of main exits 1" 1 "$st_d" \
    "NEW Rule I violation"

  # ── F5: THE FOLLOW-827 CASE ────────────────────────────────────────────────
  # Equal counts, different symbol sets: the PR deleted one dead export (beta)
  # and introduced another (gamma). 2 == 2, so a COUNT comparison accepts it and
  # exits 0. FOLLOW-821 AC(1) forbids exactly that. This must exit 1.
  st_d="$(_st_fixture rule-i-swap)"
  echo "[$st_lint_ok,$st_rule_i_entry]" > "$st_d/snapshot.json"
  _st_rule_i_log "$st_d/pr-rule-i.log" 2 'alpha@packages/a/src/one.ts' 'gamma@packages/a/src/three.ts'
  _st_rule_i_log "$st_d/main-rule-i.log" 2 'alpha@packages/a/src/one.ts' 'beta@packages/a/src/two.ts'
  _st_expect "Rule I compensating swap (equal counts, different symbols) exits 1" 1 "$st_d" \
    "NEW Rule I violation"

  # ── F6: no checks registered at all → 2 (timeout), never 0 ─────────────────
  st_d="$(_st_fixture no-checks)"
  echo "[]" > "$st_d/snapshot.json"
  _st_expect "zero registered checks times out with 2, never 0" 2 "$st_d" "TIMEOUT"

  # ── F7: a grep with no PCRE support → 3, never a green verdict ─────────────
  # THE FOLLOW-830 CASE. `grep -oP` is a GNU extension; on macOS/BSD/busybox it
  # errors out, and under `set -uo pipefail` (no -e) that used to leave the
  # failure list EMPTY and print "all checks green" over a failing check.
  st_nopcre="$st_tmp/nopcre"
  mkdir -p "$st_nopcre"
  st_real_grep="$(command -v grep)"
  {
    echo '#!/usr/bin/env bash'
    echo 'for a in "$@"; do'
    echo '  case "$a" in'
    echo "    -*P*) echo \"grep: invalid option -- 'P'\" >&2; exit 2 ;;"
    echo '  esac'
    echo 'done'
    echo "exec $st_real_grep \"\$@\""
  } > "$st_nopcre/grep"
  chmod +x "$st_nopcre/grep"
  st_d="$(_st_fixture nopcre)"
  echo "[$st_lint_ok,$st_tc_bad]" > "$st_d/snapshot.json"
  ST_PATH_OVERRIDE="$st_nopcre:$PATH"
  _st_expect "a grep without -P support exits 3, never 'all checks green'" 3 "$st_d" \
    "PREFLIGHT"
  unset ST_PATH_OVERRIDE

  # ── F8: the Rule I log fetch itself fails → 1, named as a FETCH failure ─────
  st_d="$(_st_fixture rule-i-fetch-fail)"
  echo "[$st_lint_ok,$st_rule_i_entry]" > "$st_d/snapshot.json"
  # (no pr-rule-i.log in the fixture → the seam reports a 403 like gh would)
  _st_expect "an unfetchable Rule I log exits 1 and names the fetch failure" 1 "$st_d" \
    "could not FETCH"

  # ── F9: an accepted Rule I must not mask a genuine failure beside it ───────
  st_d="$(_st_fixture mixed)"
  echo "[$st_lint_ok,$st_rule_i_entry,$st_tc_bad]" > "$st_d/snapshot.json"
  _st_rule_i_log "$st_d/pr-rule-i.log" 1 'alpha@packages/a/src/one.ts'
  _st_rule_i_log "$st_d/main-rule-i.log" 1 'alpha@packages/a/src/one.ts'
  _st_expect "an accepted Rule I alongside a new failure still exits 1" 1 "$st_d" \
    "GENUINE FAILURES"

  # ── F10: this file's mode is 755 (FOLLOW-830 AC(4) / FOLLOW-831) ───────────
  # Docs and four agent definitions invoke gates bare; a 100644 gate breaks the
  # documented invocation on the day someone drops the `bash ` prefix.
  st_mode="$(stat -c '%a' "$0" 2>/dev/null || stat -f '%Lp' "$0" 2>/dev/null || echo '')"
  if [[ "$st_mode" == "755" ]]; then
    st_passes=$((st_passes + 1))
    echo "OK: self-test PASSED — this script's filesystem mode is 755"
  else
    st_failures=$((st_failures + 1))
    echo "SELF-TEST FAIL: filesystem mode is '${st_mode:-unreadable}', expected 755."
    echo "  Fix with: chmod 755 $0 && git update-index --chmod=+x $0"
  fi

  st_git_mode="$(git ls-files -s -- "$0" 2>/dev/null | awk '{print $1}')"
  if [[ -z "$st_git_mode" ]]; then
    echo "NOTE: git index mode unavailable here (not a git checkout, or \$0 is not a"
    echo "  tracked path) — the filesystem assertion above is the binding one."
  elif [[ "$st_git_mode" == "100755" ]]; then
    st_passes=$((st_passes + 1))
    echo "OK: self-test PASSED — this script's git index mode is 100755"
  else
    st_failures=$((st_failures + 1))
    echo "SELF-TEST FAIL: git index mode is $st_git_mode, expected 100755."
    echo "  A chmod alone does not stick: git update-index --chmod=+x $0"
  fi

  echo ""
  if [[ "$st_failures" -gt 0 ]]; then
    echo "RESULT: --self-test FAILED — $st_failures fixture(s) failed, $st_passes passed."
    exit 1
  fi
  echo "RESULT: --self-test passed — $st_passes fixtures."
  exit 0
fi

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

if [[ -n "$FIXTURE_DIR" ]]; then
  REPO="fixture/repo"
else
  command -v gh >/dev/null 2>&1 || {
    echo "ERROR: gh CLI not found on PATH" >&2
    exit 3
  }

  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)"
  if [[ -z "$REPO" ]]; then
    echo "ERROR: could not resolve repo via 'gh repo view'" >&2
    exit 3
  fi
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
  snapshot="$(fetch_snapshot)"
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

    pr_violations="$(fetch_job_log "$pr_job_id" pr-rule-i.log 2>/dev/null | grep -oP 'Violations found\s*:\s*\K[0-9]+' | tail -1)"

    main_run_id="$(fetch_main_run_meta 2>/dev/null | cut -f1)"
    main_violations=""
    if [[ -n "$main_run_id" ]]; then
      main_job_id="$(fetch_main_job_id "$main_run_id" 2>/dev/null)"
      if [[ -n "$main_job_id" ]]; then
        main_violations="$(fetch_job_log "$main_job_id" main-rule-i.log 2>/dev/null | grep -oP 'Violations found\s*:\s*\K[0-9]+' | tail -1)"
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
