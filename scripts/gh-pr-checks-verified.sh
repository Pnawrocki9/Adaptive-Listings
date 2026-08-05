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
#      The one current entry, `Rule I — wired-or-dead check`, is verified DYNAMICALLY by
#      SYMBOL SET, not by count (FOLLOW-827). This script fetches `main`'s own latest
#      completed CI run, reads every `WARN: '<symbol>' in <file>` line out of that run's
#      Rule I job log, and compares that SET against the PR run's own set. The PR is
#      classified pre-existing-red only when its set is a SUBSET of main's — i.e. only
#      when it introduces no violating symbol that main does not already have.
#
#      This replaces a `pr_count <= main_count` comparison that shipped in PR #675 and was
#      wrong: a PR that deletes one dead export and introduces another holds the count at
#      192 and was accepted, exit 0. FOLLOW-821 AC(1) rules that out by name — "one entry
#      per symbol … NOT a count threshold, since a count comparison passes when one
#      violation is fixed and another introduced" — while this script's own header
#      simultaneously claimed to be aligned with FOLLOW-821. It was not. That claim is
#      deleted; the behaviour now matches the rule the claim appealed to. The counts are
#      still read and printed, but only as a diagnostic and as a self-consistency check on
#      the parser (a count > 0 that yields zero parsed symbols fails loudly rather than
#      comparing against an empty set).
#
#      There is no hardcoded violation number and no hardcoded symbol list anywhere in
#      this script, so the classification cannot rot the way a static allowlist would.
#      When FOLLOW-821 ships its per-symbol allowlist file, re-point this comparison at
#      that file instead of at main's latest run — see FOLLOW-827's `blocks:` field.
#
#      The baseline is main's LATEST COMPLETED run, which means it RATCHETS: a violation
#      that has already merged into main becomes part of the accepted baseline. That is
#      deliberate (it is what makes "pre-existing" mean anything) but it is no longer
#      silent — the run id, head sha and creation time of the baseline are printed on
#      every Rule I evaluation (FOLLOW-827 AC(3)).
#   4. Exits non-zero on ANY unclassified failure, and non-zero on TIMEOUT. It never
#      silently treats "still pending" or "no checks registered yet" as success — those are
#      the "dependency not configured" case only when genuinely zero checks are configured
#      on the repo, which this script does not assume; it always waits and then fails loud
#      if nothing ever appears.
#
#   5. PREFLIGHTS ITS OWN DEPENDENCIES and refuses to run degraded (FOLLOW-830). The
#      failure-list extraction below uses `grep -oP`; `-P` is a GNU extension absent on
#      macOS/BSD and busybox grep. Because this script runs `set -uo pipefail` WITHOUT
#      `-e`, a failing `grep -P` inside `mapfile` used to leave the failure array empty,
#      which printed `failing: 0` and `RESULT: all checks green` and exited 0 while checks
#      were failing — a fail-OPEN in the one gate whose entire purpose is not to do that.
#      There is now a hard preflight (bash >= 4 for `mapfile`, PCRE grep, `gh` on PATH,
#      `gh auth status`) that exits 3 with a named message. Degraded matcher, no verdict.
#
# USAGE
#   scripts/gh-pr-checks-verified.sh <pr-number> [--max-wait-seconds N] [--interval-seconds N]
#   scripts/gh-pr-checks-verified.sh --self-test
#
# SELF-TEST
#   `--self-test` runs 11 SYNTHESIZED fixtures (Rule AM — never driven off a live PR's
#   check state, and fully offline) through the real code path via a fixture seam:
#   all-green -> 0; an undocumented failing check -> 1; Rule I with main's exact symbol
#   set -> 0; Rule I with a new symbol on top of main -> 1; Rule I with EQUAL COUNTS but a
#   swapped symbol -> 1 (the FOLLOW-827 case); zero registered checks -> 2, never 0; a
#   grep without PCRE -> 3, never a green verdict (the FOLLOW-830 case); an unfetchable
#   Rule I log -> 1, named as a fetch failure; an accepted Rule I beside a genuine failure
#   -> 1; and this file's own mode == 755 on disk and in the git index.
#
#   Every fixture was written RED-FIRST against the pre-FOLLOW-827/830 script and observed
#   failing there — the compensating-swap and no-PCRE fixtures both got
#   "Safe to mark READY_FOR_REVIEW" and exit 0. Both transcripts are in the PR body, and
#   the red state is its own commit on the branch.
#
#   PROOF OF EXECUTION (Rule Q): `--self-test` is a step of the `pr-checks-gate-self-test`
#   job in .github/workflows/ci.yml, run on every push and PR. It is a hard gate.
#
# EXIT CODES
#   0  settled; every FAILURE (if any) is a documented, dynamically-verified pre-existing-red gate
#   1  at least one genuine (unclassified, or Rule I introducing a symbol main does not have) failure
#   2  timed out waiting for checks to settle
#   3  usage error, failed dependency preflight, or gh CLI error
#   (in --self-test mode: 0 = every fixture passed, 1 = at least one fixture failed)
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

# ── Dependency preflight (FOLLOW-830 AC(1)) ───────────────────────────────────
# Every hard dependency this script has is checked up front and named on failure.
# Exit 3, never a verdict: a gate that cannot run its own matcher must not print
# a green result, and "the tool was missing" must not be indistinguishable from
# "nothing was failing".
# preflight_dependencies <need-gh: 0|1>
preflight_dependencies() {
  local need_gh="${1:-1}"

  if [[ -z "${BASH_VERSINFO[0]:-}" || "${BASH_VERSINFO[0]}" -lt 4 ]]; then
    echo "ERROR: PREFLIGHT FAILED — bash >= 4 is required (the 'mapfile' builtin)." >&2
    echo "  Found: ${BASH_VERSION:-unknown}. macOS ships bash 3.2 as /bin/bash;" >&2
    echo "  install a newer bash (brew install bash) and re-run." >&2
    exit 3
  fi

  if ! printf 'x\n' | grep -qP 'x' 2>/dev/null; then
    echo "ERROR: PREFLIGHT FAILED — this 'grep' has no PCRE (-P) support." >&2
    echo "  grep: $(command -v grep 2>/dev/null || echo 'not found')" >&2
    echo "  This script extracts the failing-check list with 'grep -oP'. Without -P that" >&2
    echo "  extraction returns NOTHING, and because this script runs without 'set -e' the" >&2
    echo "  result would be 'failing: 0' and 'all checks green' over a failing check." >&2
    echo "  Refusing to run degraded. Install GNU grep (brew install grep) and re-run." >&2
    exit 3
  fi

  [[ "$need_gh" == "1" ]] || return 0

  if ! command -v gh >/dev/null 2>&1; then
    echo "ERROR: PREFLIGHT FAILED — gh CLI not found on PATH." >&2
    exit 3
  fi

  if ! gh auth status >/dev/null 2>&1; then
    echo "ERROR: PREFLIGHT FAILED — 'gh auth status' is not OK." >&2
    echo "  Unauthenticated reads would fail per-call and be reported as unreadable logs" >&2
    echo "  one check at a time. Run 'gh auth login' and re-run." >&2
    exit 3
  fi
}

# Reads a Rule I job log on stdin; prints the trailing "Violations found: N" count.
rule_i_count_from_log() {
  grep -oP 'Violations found\s*:\s*\K[0-9]+' | tail -1
}

# Reads a Rule I job log on stdin; prints one "<symbol> @ <file>" line per
# violation, sorted and deduped, ready for comm(1). The source lines are
# check-rule-i.sh's own
#   WARN: '<symbol>' in <file> — zero non-test importers
# prefixed by the ISO timestamp GitHub adds to every raw log line, hence the
# unanchored match. This per-symbol identity is what makes the baseline
# comparison a SET comparison rather than a count threshold (FOLLOW-827 AC(1)).
rule_i_symbols_from_log() {
  grep -oP "WARN: '\K[^']+' in \S+" | sed "s/' in / @ /" | LC_ALL=C sort -u
}

# Names WHY a gh read failed, so that an auth failure, a 403 rate-limit, an
# expired log and a genuine API error are four distinguishable lines at 2am
# instead of one unactionable WARN (FOLLOW-827 AC(4)).
classify_fetch_error() {
  local err
  err="$(tr '\n' ' ' < "$1")"
  case "$err" in
    *"rate limit"*) echo "HTTP 403 — GitHub API rate limit exceeded" ;;
    *403* | *Forbidden*) echo "HTTP 403 — forbidden; the token likely lacks the actions:read scope" ;;
    *401* | *"Bad credentials"* | *authentication*) echo "HTTP 401 — gh is not authenticated for this repo" ;;
    *404* | *"Not Found"*) echo "HTTP 404 — job or log not found (Actions logs expire after ~90 days)" ;;
    "") echo "gh exited non-zero without writing any diagnosis" ;;
    *) echo "gh API error" ;;
  esac
}

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

  # The harness itself needs bash >= 4 and PCRE grep; it needs neither gh nor an
  # authenticated token, which is what lets this run as an ordinary CI step.
  preflight_dependencies 0

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
  # shellcheck disable=SC2016  # the shim's body is literal text, not this shell's expansions
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
  echo "       $0 --self-test" >&2
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
  preflight_dependencies 0
  REPO="fixture/repo"
else
  preflight_dependencies 1

  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)"
  if [[ -z "$REPO" ]]; then
    echo "ERROR: could not resolve repo via 'gh repo view'" >&2
    exit 3
  fi
fi

tmp_dir="$(mktemp -d)"
# shellcheck disable=SC2064  # expand $tmp_dir now, not at trap time
trap "rm -rf '$tmp_dir'" EXIT

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

    # ── PR side ──────────────────────────────────────────────────────────────
    if ! fetch_job_log "$pr_job_id" pr-rule-i.log > "$tmp_dir/pr.log" 2> "$tmp_dir/pr.err"; then
      diag="$(classify_fetch_error "$tmp_dir/pr.err")"
      echo "WARN: could not FETCH the PR's Rule I job log (job $pr_job_id) — $diag."
      echo "      This is a tooling failure, NOT a verdict; treating as a genuine failure."
      genuine_failures+=("$name — could not FETCH the PR's Rule I job log: $diag")
      continue
    fi

    pr_violations="$(rule_i_count_from_log < "$tmp_dir/pr.log")"
    if [[ -z "$pr_violations" ]]; then
      echo "WARN: the PR's Rule I log was fetched successfully but contains no"
      echo "      'Violations found: N' line — check-rule-i.sh's output format may have"
      echo "      changed, or the job died before its summary. Treating as genuine failure."
      genuine_failures+=("$name — Rule I log fetched but unparseable (no 'Violations found' line)")
      continue
    fi

    rule_i_symbols_from_log < "$tmp_dir/pr.log" > "$tmp_dir/pr.syms"
    pr_symbols="$(wc -l < "$tmp_dir/pr.syms" | tr -d ' ')"
    if [[ "$pr_violations" -gt 0 && "$pr_symbols" -eq 0 ]]; then
      echo "WARN: the PR's Rule I log reports $pr_violations violation(s) but not one"
      echo "      \"WARN: '<symbol>' in <file>\" line could be parsed out of it. Comparing an"
      echo "      empty set against the baseline would accept everything, so this fails loud."
      genuine_failures+=("$name — count says $pr_violations but zero violation symbols parsed (log format or matcher mismatch)")
      continue
    fi

    # ── main baseline ────────────────────────────────────────────────────────
    main_meta="$(fetch_main_run_meta 2>/dev/null)"
    main_run_id="$(printf '%s' "$main_meta" | cut -f1)"
    main_head="$(printf '%s' "$main_meta" | cut -f2)"
    main_created="$(printf '%s' "$main_meta" | cut -f3)"
    if [[ -z "$main_run_id" ]]; then
      echo "WARN: could not resolve main's latest completed ci.yml run — treating as genuine failure."
      genuine_failures+=("$name — main baseline run unresolvable")
      continue
    fi

    # AC(3): name the baseline, every time. A ratchet nobody prints is a ratchet
    # nobody notices.
    echo "Rule I baseline source: main's LATEST COMPLETED ci.yml run $main_run_id"
    echo "  (head ${main_head:0:12}, created ${main_created:-unknown})."
    echo "  This is read fresh from main's most recent completed run, so the baseline"
    echo "  RATCHETS: any Rule I violation already merged into main counts as pre-existing"
    echo "  here and will not block this PR. Check the head sha above is what you expect."

    main_job_id="$(fetch_main_job_id "$main_run_id" 2>/dev/null)"
    if [[ -z "$main_job_id" ]]; then
      echo "WARN: main's run $main_run_id has no job named '$RULE_I_NAME' — treating as genuine failure."
      genuine_failures+=("$name — no Rule I job in main baseline run $main_run_id")
      continue
    fi

    if ! fetch_job_log "$main_job_id" main-rule-i.log > "$tmp_dir/main.log" 2> "$tmp_dir/main.err"; then
      diag="$(classify_fetch_error "$tmp_dir/main.err")"
      echo "WARN: could not FETCH main's Rule I job log (job $main_job_id) — $diag."
      echo "      This is a tooling failure, NOT a verdict; treating as a genuine failure."
      genuine_failures+=("$name — could not FETCH main's baseline Rule I job log: $diag")
      continue
    fi

    main_violations="$(rule_i_count_from_log < "$tmp_dir/main.log")"
    if [[ -z "$main_violations" ]]; then
      echo "WARN: main's Rule I log was fetched but contains no 'Violations found: N' line —"
      echo "      treating as genuine failure rather than comparing against an unknown baseline."
      genuine_failures+=("$name — main baseline log fetched but unparseable (run $main_run_id)")
      continue
    fi

    rule_i_symbols_from_log < "$tmp_dir/main.log" > "$tmp_dir/main.syms"
    main_symbols="$(wc -l < "$tmp_dir/main.syms" | tr -d ' ')"
    if [[ "$main_violations" -gt 0 && "$main_symbols" -eq 0 ]]; then
      echo "WARN: main's Rule I log reports $main_violations violation(s) but zero symbols"
      echo "      parsed — the baseline set cannot be trusted. Failing loud."
      genuine_failures+=("$name — main baseline count says $main_violations but zero symbols parsed")
      continue
    fi

    # ── the comparison (SET, not count) ──────────────────────────────────────
    comm -23 "$tmp_dir/pr.syms" "$tmp_dir/main.syms" > "$tmp_dir/new.syms"
    comm -13 "$tmp_dir/pr.syms" "$tmp_dir/main.syms" > "$tmp_dir/fixed.syms"
    new_symbols="$(wc -l < "$tmp_dir/new.syms" | tr -d ' ')"
    fixed_symbols="$(wc -l < "$tmp_dir/fixed.syms" | tr -d ' ')"

    echo "Rule I symbol-set comparison: PR has $pr_symbols violating symbol(s) (count line:"
    echo "  $pr_violations), main baseline has $main_symbols (count line: $main_violations)."
    echo "  New on this PR: $new_symbols | fixed by this PR: $fixed_symbols"

    if [[ "$new_symbols" -eq 0 ]]; then
      accepted_failures+=("$name — pre-existing-red: all $pr_symbols violating symbol(s) are also in main's baseline (run $main_run_id); $fixed_symbols fixed by this PR")
    else
      echo ""
      echo "  NEW violating symbols (on this PR, absent from main's baseline):"
      head -20 "$tmp_dir/new.syms" | sed 's/^/    - /'
      if [[ "$new_symbols" -gt 20 ]]; then
        echo "    … and $((new_symbols - 20)) more"
      fi
      if [[ "$pr_violations" -eq "$main_violations" ]]; then
        echo ""
        echo "  NOTE: the two COUNTS are equal ($pr_violations). Only the symbol SETS differ —"
        echo "  this PR fixed $fixed_symbols violation(s) and introduced $new_symbols. A count"
        echo "  comparison would have accepted it and exited 0; that compensating-swap case is"
        echo "  what FOLLOW-821 AC(1) forbids by name and what FOLLOW-827 fixed here."
      fi
      genuine_failures+=("$name — $new_symbols NEW Rule I violation symbol(s) not in main's baseline (run $main_run_id)")
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
