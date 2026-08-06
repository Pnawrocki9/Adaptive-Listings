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
#      The baseline is main's newest run that ACTUALLY PRODUCED a Rule I symbol set,
#      found by walking main's recent ci.yml runs newest-first and skipping every run
#      that cannot carry a baseline. It RATCHETS: a violation that has already merged
#      into main becomes part of the accepted baseline. That is deliberate (it is what
#      makes "pre-existing" mean anything) but it is not silent — the chosen run's id,
#      head sha and creation time are printed, as is every skipped run WITH ITS REASON
#      (FOLLOW-827 AC(3), FOLLOW-846 AC(1)).
#
#      The walk exists because `--status completed -L 1` was wrong. GitHub's `completed`
#      is a STATUS and includes the `cancelled` and `skipped` CONCLUSIONS, and ci.yml
#      sets `cancel-in-progress: true`, so 8 of main's last 12 runs were cancelled when
#      this was written — including the two newest. A cancelled run's Rule I job never
#      ran, so its log 404s, and the gate reported that as "GENUINE FAILURES … do NOT
#      mark READY_FOR_REVIEW" on every open PR simultaneously, for a reason no PR could
#      cause or fix (RETRO-250, observed live on PR #681 in both directions six minutes
#      apart on the same commit). When the whole look-back window is unusable the gate
#      exits 3 and names the runs it tried; it never falls back to something weaker.
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
#   `--self-test` runs 16 SYNTHESIZED fixtures (Rule AM — never driven off a live PR's
#   check state, and fully offline) through the real code path via a fixture seam:
#   all-green -> 0; an undocumented failing check -> 1; Rule I with main's exact symbol
#   set -> 0; Rule I with a new symbol on top of main -> 1; Rule I with EQUAL COUNTS but a
#   swapped symbol -> 1 (the FOLLOW-827 case); zero registered checks -> 2, never 0; a
#   grep without PCRE -> 3, never a green verdict (the FOLLOW-830 case); an unfetchable
#   Rule I log -> 3, named as a TOOLING failure; an accepted Rule I beside a genuine
#   failure -> 1; a CANCELLED newest baseline run -> skipped, walk continues, 0; a
#   look-back window with nothing usable in it -> 3, never 1; one check name registered
#   twice -> collapsed to one, symbol sets unioned; the fixture seam invoked outside
#   self-test -> 3, refused; a 404 on a cancelled job -> diagnosed as cancellation rather
#   than log expiry (the four FOLLOW-846 cases); and this file's own mode == 755 on disk
#   and in the git index.
#
#   Every fixture was written RED-FIRST and observed failing against the script version
#   that lacked its fix — for FOLLOW-827/830 the compensating-swap and no-PCRE fixtures
#   both got "Safe to mark READY_FOR_REVIEW" and exit 0; for FOLLOW-846 the seam fixture
#   got the same green with zero network reads, and the cancelled-baseline fixture got
#   "GENUINE FAILURES (blocking)". Each FOLLOW-846 fixture was additionally shown to fail
#   when — and only when — its own fix is reverted. Transcripts are in the PR bodies.
#
#   PROOF OF EXECUTION (Rule Q): `--self-test` is a step of the `pr-checks-gate-self-test`
#   job in .github/workflows/ci.yml, run on every push and PR. It is a hard gate.
#
# EXIT CODES
#   0  settled; every FAILURE (if any) is a documented, dynamically-verified pre-existing-red gate
#   1  at least one genuine (unclassified, or Rule I introducing a symbol main does not have) failure
#   2  timed out waiting for checks to settle
#   3  usage error, failed dependency preflight, gh CLI error, refused fixture seam, or a
#      TOOLING failure: the gate could not read something it needed (an unfetchable or
#      unparseable Rule I log, no usable baseline in the look-back window) and therefore
#      rendered NO verdict. 3 is not a milder 1. Exit 1 means "this PR is red" and routes
#      to sending the ticket back to its worker; exit 3 means "the gate did not get to
#      look", which no worker can fix and which must not consume the 3-retry escalation
#      budget (FOLLOW-846 AC(2)). 3 is equally not a green: do not mark READY_FOR_REVIEW
#      on it. When both a tooling failure and a genuine failure are present, both are
#      printed and the exit code is 3 — an incomplete verdict is not a verdict.
#   (in --self-test mode: 0 = every fixture passed, 1 = at least one fixture failed)
set -uo pipefail

# ── Fixture seam (self-test only — Rule AM) ───────────────────────────────────
# When GH_PR_CHECKS_FIXTURE_DIR is set, every network read below is served from
# a file in that directory instead of from `gh`. The seam exists so the gate can
# be exercised hermetically and offline against SYNTHESIZED check states.
# Driving the self-test off a live PR would be neither reproducible nor capable
# of containing the failure shapes that have to be pinned (a compensating-symbol
# swap, a rate-limited log fetch, a grep with no PCRE).
#
# THE SEAM IS ENFORCED, NOT MERELY DOCUMENTED (FOLLOW-846). Until this block, the
# code above this line only ASSERTED that the variable "is never set by a caller"
# and then honoured it unconditionally. With it exported, a real PR number
# produced "RESULT: all checks green. Safe to mark READY_FOR_REVIEW." and exit 0
# after ZERO network reads — a fail-OPEN backdoor in the one gate whose entire
# purpose is that it cannot report a false green. Two conditions now have to hold
# together, and neither is satisfiable by an inherited/exported environment
# alone:
#   1. GH_PR_CHECKS_SELF_TEST=1 — an explicit second opt-in, and
#   2. a `self-test.marker` file INSIDE the fixture dir, which only this script's
#      own fixture builder writes.
# Anything else is refused loudly with exit 3. This is not a security boundary
# (whoever can set env vars can also write files); it is a guard against the
# realistic failure — a stale exported variable, or an agent copying an
# invocation out of a transcript — silently turning the gate into a no-op. The
# third layer is that fixture mode is never quiet: every RESULT line is prefixed
# with FIXTURE_TAG, so a fixture-mode run cannot be pasted as evidence of a green
# PR without that prefix being visible in the paste.
FIXTURE_DIR=""
FIXTURE_TAG=""
if [[ -n "${GH_PR_CHECKS_FIXTURE_DIR:-}" ]]; then
  if [[ "${GH_PR_CHECKS_SELF_TEST:-}" == "1" && -f "${GH_PR_CHECKS_FIXTURE_DIR}/self-test.marker" ]]; then
    FIXTURE_DIR="$GH_PR_CHECKS_FIXTURE_DIR"
    FIXTURE_TAG="[FIXTURE MODE — synthetic data, not a real PR] "
  else
    echo "ERROR: REFUSING TO RUN — GH_PR_CHECKS_FIXTURE_DIR is set outside --self-test." >&2
    echo "  dir: ${GH_PR_CHECKS_FIXTURE_DIR}" >&2
    echo "  GH_PR_CHECKS_SELF_TEST='${GH_PR_CHECKS_SELF_TEST:-<unset>}' (must be '1')" >&2
    echo "  self-test.marker present: $([[ -f "${GH_PR_CHECKS_FIXTURE_DIR}/self-test.marker" ]] && echo yes || echo no) (must be yes)" >&2
    echo "  With that variable honoured, every network read is served from files and this" >&2
    echo "  gate reports a verdict about a PR it never looked at. Unset it and re-run." >&2
    exit 3
  fi
fi

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

# ── INPUT FORMAT CONTRACT: producer is scripts/check-rule-i.sh ────────────────
# The two parsers below are the CONSUMER half of a machine-readable interface.
# Their producer is scripts/check-rule-i.sh, which prints
#   WARN: '<symbol>' in <file> — zero non-test importers
#   Violations found    : <N>
# and carries the matching "OUTPUT FORMAT CONTRACT" note in its own header. Edit
# either side without the other and this gate stops being able to classify any
# PR's Rule I red, repo-wide. check-rule-i.sh deliberately prints NO
# "Violations found" line when it could not run (exit 3), so a degraded Rule I
# run reaches the code below as an unparseable log — a named tooling failure —
# rather than as a clean 0. A cross-script parity fixture (running the real
# check-rule-i.sh and feeding its output to these two functions) is FOLLOW-848.
#
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

# iso_age_seconds <iso-8601-timestamp> — seconds since that instant, or "" when
# the host's `date` cannot parse it (BSD date has no -d). Never fails the caller:
# every consumer degrades to omitting an age, never to a wrong diagnosis.
iso_age_seconds() {
  local at now then_s
  at="$1"
  [[ -n "$at" && "$at" != "null" ]] || return 0
  now="$(date -u +%s 2>/dev/null)" || return 0
  then_s="$(date -u -d "$at" +%s 2>/dev/null)" || return 0
  [[ -n "$then_s" ]] || return 0
  echo $((now - then_s))
}

# classify_missing_log <job-id> — turns "the log is a 404" into WHICH of the
# three unrelated causes it is (FOLLOW-846 AC(3) / FOLLOW-827 AC(4), reopened).
#
# The shipped version rendered EVERY 404 as "Actions logs expire after ~90 days".
# RETRO-250 caught that printed against a job four minutes old: a CANCELLED or
# SKIPPED job never produces a log at all, which is the overwhelmingly common
# 404 in this repo because ci.yml sets `cancel-in-progress: true`. Diagnosing a
# routine cancellation as a 90-day retention problem sends the reader looking for
# a nonexistent stale run. The job's own `conclusion` distinguishes them and is
# one API read away — the same jobs API this script already talks to.
classify_missing_log() {
  local job_id meta concl started age
  job_id="$1"
  if [[ -z "$job_id" ]]; then
    echo "HTTP 404 — job or log not found (no job id available to diagnose further)"
    return 0
  fi
  meta="$(fetch_job_meta "$job_id" 2>/dev/null)"
  if [[ -z "$meta" ]]; then
    echo "HTTP 404 — no job $job_id is visible at all (deleted run, wrong repo, or a token without actions:read)"
    return 0
  fi
  concl="$(printf '%s' "$meta" | cut -f1)"
  started="$(printf '%s' "$meta" | cut -f2)"
  case "$concl" in
    cancelled | skipped)
      echo "HTTP 404 — job $job_id was $concl, so it never produced a log; this is NOT log expiry"
      return 0
      ;;
    "" | null)
      echo "HTTP 404 — job $job_id has not concluded yet, so it has no complete log; this is NOT log expiry"
      return 0
      ;;
  esac
  local age_s
  age=""
  age_s="$(iso_age_seconds "$started")"
  [[ -z "$age_s" ]] || age=$((age_s / 86400))
  if [[ -n "$age" && "$age" -ge 90 ]]; then
    echo "HTTP 404 — job $job_id concluded '$concl' $age days ago; Actions logs are retained ~90 days, so this IS log expiry"
  else
    echo "HTTP 404 — job $job_id concluded '$concl'${age:+ $age day(s) ago} and its log is missing anyway; too recent for expiry — retry, then check the token's actions:read scope"
  fi
}

# classify_fetch_error <stderr-file> [job-id]
# Names WHY a gh read failed, so that an auth failure, a 403 rate-limit, an
# expired log and a genuine API error are distinguishable lines at 2am instead of
# one unactionable WARN (FOLLOW-827 AC(4)). The optional job id is what lets the
# 404 branch tell a cancelled job from an expired log (FOLLOW-846 AC(3)).
classify_fetch_error() {
  local err
  err="$(tr '\n' ' ' < "$1")"
  case "$err" in
    *"rate limit"*) echo "HTTP 403 — GitHub API rate limit exceeded" ;;
    *403* | *Forbidden*) echo "HTTP 403 — forbidden; the token likely lacks the actions:read scope" ;;
    *401* | *"Bad credentials"* | *authentication*) echo "HTTP 401 — gh is not authenticated for this repo" ;;
    *404* | *"Not Found"*) classify_missing_log "${2:-}" ;;
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
      # A fixture may pin the EXACT stderr shape it wants classified by shipping
      # "<basename>.err"; the default is the rate-limit shape.
      if [[ -f "$FIXTURE_DIR/$2.err" ]]; then
        cat "$FIXTURE_DIR/$2.err" >&2
      else
        echo "HTTP 403: API rate limit exceeded for installation (fixture: no $2)" >&2
      fi
      return 1
    fi
    cat "$FIXTURE_DIR/$2"
    return 0
  fi
  gh api "repos/$REPO/actions/jobs/$1/logs"
}

# fetch_job_meta <job-id> — prints "<conclusion>\t<started-at>" for one job.
# Read only on the 404 path, to tell a cancelled job from an expired log.
fetch_job_meta() {
  if [[ -n "$FIXTURE_DIR" ]]; then
    [[ -f "$FIXTURE_DIR/job-meta-$1.tsv" ]] || return 0
    cat "$FIXTURE_DIR/job-meta-$1.tsv"
    return 0
  fi
  gh api "repos/$REPO/actions/jobs/$1" \
    -q '"\(.conclusion)\t\(.started_at)"' 2>/dev/null
}

# Prints one CANDIDATE baseline run per line as
# "<run-id>\t<head-sha>\t<created-at>\t<status>\t<conclusion>", newest first, for
# the walk in resolve_rule_i_baseline.
#
# WHY THIS IS A LIST AND NOT `-L 1` (FOLLOW-846 AC(1)). The shipped version took
# `--status completed -L 1` and used `.[0]` unconditionally. GitHub's `completed`
# is a STATUS and contains the `cancelled` and `skipped` CONCLUSIONS, and ci.yml
# sets `cancel-in-progress: true`, so on a busy day most of main's completed runs
# are cancelled — 8 of the last 12 when this was written, and both of the two
# newest. A cancelled run's Rule I job never ran, so its log is a 404, which the
# gate then reported as "GENUINE FAILURES … do NOT mark READY_FOR_REVIEW" on
# every open PR at once. The `--status` filter is dropped entirely and the
# filtering happens in the walk, so that an in-progress newer run can be NAMED
# (main's baseline lags it) rather than silently omitted.
fetch_main_run_candidates() {
  if [[ -n "$FIXTURE_DIR" ]]; then
    cat "$FIXTURE_DIR/main-runs.tsv"
    return 0
  fi
  gh run list --repo "$REPO" --workflow ci.yml --branch main \
    --json databaseId,headSha,createdAt,status,conclusion -L "$BASELINE_LOOKBACK" \
    -q '.[] | "\(.databaseId)\t\(.headSha)\t\(.createdAt)\t\(.status)\t\(.conclusion)"'
}

# fetch_main_job_meta <run-id> — prints "<job-id>\t<job-conclusion>" for the
# Rule I job of that run. The conclusion comes from the SAME call as the id, so
# the walk can reject a cancelled/skipped Rule I job without first attempting a
# download it knows will 404.
fetch_main_job_meta() {
  if [[ -n "$FIXTURE_DIR" ]]; then
    [[ -f "$FIXTURE_DIR/main-job-$1.tsv" ]] || return 0
    cat "$FIXTURE_DIR/main-job-$1.tsv"
    return 0
  fi
  gh api "repos/$REPO/actions/runs/$1/jobs" --paginate \
    -q '.jobs[] | select(.name=="'"$RULE_I_NAME"'") | "\(.id)\t\(.conclusion)"' | head -1
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

  # Every fixture dir is stamped "now", so no assertion below can start drifting
  # into the stale-baseline warning as the calendar moves past a hardcoded date.
  st_now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  # _st_fixture <name> — makes a fixture dir carrying the baseline metadata every
  # Rule I fixture needs, and echoes its path. The default baseline is a single
  # healthy run; fixtures that care about the WALK overwrite main-runs.tsv.
  #
  # `self-test.marker` is half of the fixture-seam gate (FOLLOW-846): the seam
  # refuses to serve a run that does not carry both this file and
  # GH_PR_CHECKS_SELF_TEST=1, so a stray exported variable cannot turn a real
  # invocation into an offline no-op that prints "all checks green".
  _st_fixture() {
    local d="$st_tmp/$1"
    mkdir -p "$d"
    : > "$d/self-test.marker"
    printf '4242\tdeadbeefcafe1234\t%s\tcompleted\tfailure\n' "$st_now" > "$d/main-runs.tsv"
    printf '777\tfailure\n' > "$d/main-job-4242.tsv"
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
  # (used by the degraded-grep fixture) is honoured via ST_PATH_OVERRIDE, and
  # ST_OMIT_SELF_TEST_ENV=1 drops the GH_PR_CHECKS_SELF_TEST opt-in so the seam
  # fixture can assert the refusal.
  _st_run() {
    local dir="$1"
    local rc=0
    local self_test="1"
    [[ -z "${ST_OMIT_SELF_TEST_ENV:-}" ]] || self_test=""
    PATH="${ST_PATH_OVERRIDE:-$PATH}" \
      GH_PR_CHECKS_SELF_TEST="$self_test" GH_PR_CHECKS_FIXTURE_DIR="$dir" \
      bash "$0" 1 --max-wait-seconds 2 --interval-seconds 1 > "$st_out" 2>&1 || rc=$?
    return "$rc"
  }

  _st_fail() {
    st_failures=$((st_failures + 1))
    echo "--- gate output ---"
    cat "$st_out"
    echo "-------------------"
  }

  # _st_expect <label> <expected-rc> <fixture-dir> [substring] [substring]
  # Asserts the SPECIFIC exit code, never merely non-zero, and (when given) that
  # the verdict was reached for the stated reason.
  _st_expect() {
    local label="$1" want_rc="$2" dir="$3" needle="${4:-}" needle2="${5:-}"
    local rc=0 n
    _st_run "$dir" || rc=$?
    if [[ "$rc" -ne "$want_rc" ]]; then
      echo "SELF-TEST FAIL: $label"
      echo "  expected exit $want_rc, got $rc"
      _st_fail
      return 0
    fi
    for n in "$needle" "$needle2"; do
      [[ -n "$n" ]] || continue
      if ! grep -qF -- "$n" "$st_out"; then
        echo "SELF-TEST FAIL: $label"
        echo "  exited $rc as expected, but never said '$n' — the right verdict"
        echo "  for the wrong reason is not a pass."
        _st_fail
        return 0
      fi
    done
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
  _st_rule_i_log "$st_d/pr-rule-i-9.log" 2 'alpha@packages/a/src/one.ts' 'beta@packages/a/src/two.ts'
  _st_rule_i_log "$st_d/main-rule-i-4242.log" 2 'alpha@packages/a/src/one.ts' 'beta@packages/a/src/two.ts'
  _st_expect "Rule I with the same symbols as main exits 0" 0 "$st_d" \
    "pre-existing-red"

  # ── F4: Rule I, PR is a strict SUPERSET of main → 1 ────────────────────────
  st_d="$(_st_fixture rule-i-worse)"
  echo "[$st_lint_ok,$st_rule_i_entry]" > "$st_d/snapshot.json"
  _st_rule_i_log "$st_d/pr-rule-i-9.log" 3 'alpha@packages/a/src/one.ts' \
    'beta@packages/a/src/two.ts' 'gamma@packages/a/src/three.ts'
  _st_rule_i_log "$st_d/main-rule-i-4242.log" 2 'alpha@packages/a/src/one.ts' 'beta@packages/a/src/two.ts'
  _st_expect "Rule I with a NEW symbol on top of main exits 1" 1 "$st_d" \
    "NEW Rule I violation"

  # ── F5: THE FOLLOW-827 CASE ────────────────────────────────────────────────
  # Equal counts, different symbol sets: the PR deleted one dead export (beta)
  # and introduced another (gamma). 2 == 2, so a COUNT comparison accepts it and
  # exits 0. FOLLOW-821 AC(1) forbids exactly that. This must exit 1.
  st_d="$(_st_fixture rule-i-swap)"
  echo "[$st_lint_ok,$st_rule_i_entry]" > "$st_d/snapshot.json"
  _st_rule_i_log "$st_d/pr-rule-i-9.log" 2 'alpha@packages/a/src/one.ts' 'gamma@packages/a/src/three.ts'
  _st_rule_i_log "$st_d/main-rule-i-4242.log" 2 'alpha@packages/a/src/one.ts' 'beta@packages/a/src/two.ts'
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

  # ── F8: the Rule I log fetch itself fails → 3, named as a FETCH failure ─────
  # Was exit 1 until FOLLOW-846. A rate-limited log fetch is something the GATE
  # could not do, not something the PR did: exit 1 routes to "send the ticket
  # back to its worker and increment fix_iteration_counter", which is the wrong
  # instruction for every reader. It is now a TOOLING failure (exit 3), and the
  # verdict vocabulary changes with it.
  st_d="$(_st_fixture rule-i-fetch-fail)"
  echo "[$st_lint_ok,$st_rule_i_entry]" > "$st_d/snapshot.json"
  # (no pr-rule-i-9.log in the fixture → the seam reports a 403 like gh would)
  _st_expect "an unfetchable Rule I log exits 3 and names the fetch failure" 3 "$st_d" \
    "could not FETCH" "TOOLING FAILURES"

  # ── F9: an accepted Rule I must not mask a genuine failure beside it ───────
  st_d="$(_st_fixture mixed)"
  echo "[$st_lint_ok,$st_rule_i_entry,$st_tc_bad]" > "$st_d/snapshot.json"
  _st_rule_i_log "$st_d/pr-rule-i-9.log" 1 'alpha@packages/a/src/one.ts'
  _st_rule_i_log "$st_d/main-rule-i-4242.log" 1 'alpha@packages/a/src/one.ts'
  _st_expect "an accepted Rule I alongside a new failure still exits 1" 1 "$st_d" \
    "GENUINE FAILURES"

  # ── F11: main's newest completed run is CANCELLED → walk past it → 0 ───────
  # THE FOLLOW-846 / RETRO-250 CASE, observed live on PR #681 in both directions
  # six minutes apart. `gh run list --status completed` returns `cancelled` and
  # `skipped` CONCLUSIONS too, and ci.yml's `cancel-in-progress: true` made 8 of
  # main's last 12 runs cancelled. A cancelled run's Rule I job never ran, its
  # log is a 404, and the shipped gate turned that into "GENUINE FAILURES … do
  # NOT mark READY_FOR_REVIEW" on every open PR at once. The walk must skip it
  # BY CONCLUSION — before attempting a download it knows will 404 — and take
  # the next run that really produced a symbol set.
  st_d="$(_st_fixture baseline-cancelled)"
  echo "[$st_lint_ok,$st_rule_i_entry]" > "$st_d/snapshot.json"
  {
    printf '5001\taaaa111122223333\t%s\tin_progress\t\n' "$st_now"
    printf '5002\tbbbb111122223333\t%s\tcompleted\tcancelled\n' "$st_now"
    printf '5003\tcccc111122223333\t%s\tcompleted\tcancelled\n' "$st_now"
    printf '5004\tdddd111122223333\t%s\tcompleted\tfailure\n' "$st_now"
  } > "$st_d/main-runs.tsv"
  printf '811\tfailure\n' > "$st_d/main-job-5004.tsv"
  _st_rule_i_log "$st_d/pr-rule-i-9.log" 1 'alpha@packages/a/src/one.ts'
  _st_rule_i_log "$st_d/main-rule-i-5004.log" 1 'alpha@packages/a/src/one.ts'
  _st_expect "a cancelled newest run is skipped and the walk finds a real baseline" 0 "$st_d" \
    "run conclusion=cancelled" "CHOSEN  run 5004"

  # ── F12: nothing usable in the whole window → 3 (tooling), never 1 ─────────
  # The other half of AC(2): when the walk exhausts its look-back, the gate must
  # say the BASELINE is unusable, in tooling vocabulary, and must not render a
  # verdict on the PR in either direction.
  st_d="$(_st_fixture baseline-none)"
  echo "[$st_lint_ok,$st_rule_i_entry]" > "$st_d/snapshot.json"
  {
    printf '6001\taaaa111122223333\t%s\tcompleted\tcancelled\n' "$st_now"
    printf '6002\tbbbb111122223333\t%s\tcompleted\tskipped\n' "$st_now"
    printf '6003\tcccc111122223333\t%s\tcompleted\tfailure\n' "$st_now"
  } > "$st_d/main-runs.tsv"
  # 6003 is a plausible-looking run whose Rule I job was itself cancelled (its
  # `needs:` dependency failed) — the shape a conclusion-only filter still misses.
  printf '901\tcancelled\n' > "$st_d/main-job-6003.tsv"
  _st_rule_i_log "$st_d/pr-rule-i-9.log" 1 'alpha@packages/a/src/one.ts'
  _st_expect "no usable baseline in the window exits 3, not 1" 3 "$st_d" \
    "no usable Rule I baseline" "RESULT: UNDETERMINED"

  # ── F13: the same check name registered twice (push + pull_request) ────────
  # PR #681 carried 75 check-runs over 39 names. The two Rule I check-runs are
  # different commits (branch head vs merge ref) and can differ, so the gate
  # unions their symbol sets: job 9 alone matches main, job 10 adds `gamma`.
  # Three properties in one fixture — a "keep the first" collapse exits 0 (wrong),
  # no collapse at all reports one problem as two failures, and the union exits 1.
  st_rule_i_dup='{"name":"Rule I — wired-or-dead check","state":"FAILURE","url":"'"$st_job_url"'/10"}'
  st_d="$(_st_fixture rule-i-duplicate)"
  echo "[$st_lint_ok,$st_rule_i_entry,$st_rule_i_dup]" > "$st_d/snapshot.json"
  _st_rule_i_log "$st_d/pr-rule-i-9.log" 1 'alpha@packages/a/src/one.ts'
  _st_rule_i_log "$st_d/pr-rule-i-10.log" 2 'alpha@packages/a/src/one.ts' 'gamma@packages/a/src/three.ts'
  _st_rule_i_log "$st_d/main-rule-i-4242.log" 1 'alpha@packages/a/src/one.ts'
  _st_expect "duplicate check-runs collapse to one name and union their symbols" 1 "$st_d" \
    "across 1 distinct check name" "RESULT: FAIL. 1 genuine failure(s)."

  # ── F14: the fixture seam is refused outside --self-test → 3 ──────────────
  # Red-first evidence for this one is in the PR body: with the pre-FOLLOW-846
  # script, `GH_PR_CHECKS_FIXTURE_DIR=<dir> … 681` printed "RESULT: all checks
  # green. Safe to mark READY_FOR_REVIEW." and exited 0 having read nothing.
  st_d="$(_st_fixture seam-refusal)"
  echo "[$st_lint_ok,$st_tc_ok]" > "$st_d/snapshot.json"
  ST_OMIT_SELF_TEST_ENV=1
  _st_expect "the fixture seam is refused when not in self-test mode" 3 "$st_d" \
    "REFUSING TO RUN"
  unset ST_OMIT_SELF_TEST_ENV

  # ── F15: a 404 on a CANCELLED job is not log expiry ───────────────────────
  # AC(3). The shipped classifier rendered every 404 as "Actions logs expire
  # after ~90 days" — RETRO-250 caught it printed against a four-minute-old run.
  st_d="$(_st_fixture log-404-cancelled)"
  echo "[$st_lint_ok,$st_rule_i_entry]" > "$st_d/snapshot.json"
  echo "gh: HTTP 404: Not Found (https://api.github.com/repos/o/r/actions/jobs/9/logs)" \
    > "$st_d/pr-rule-i-9.log.err"
  printf 'cancelled\t%s\n' "$st_now" > "$st_d/job-meta-9.tsv"
  _st_expect "a 404 on a cancelled job is diagnosed as cancellation, not log expiry" 3 "$st_d" \
    "was cancelled, so it never produced a log" "NOT log expiry"

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

# How many of main's recent ci.yml runs the baseline walk may inspect before
# giving up (FOLLOW-846 AC(1)/AC(2)). Sized off the observed cancellation rate:
# 8 of main's last 12 runs were `cancelled` during a five-merge session, and
# ci.yml carries jobs at 83-99 min, so a short window can plausibly be all
# cancellations. 20 is ~an hour of the busiest merge cadence this repo has had.
# It is a BOUND, not a fallback: when nothing in the window is usable the gate
# exits 3 and says so, rather than quietly comparing against something weaker.
BASELINE_LOOKBACK=20

# How old the chosen baseline may be before the comparison is worth doubting.
BASELINE_STALE_HOURS=72

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
  echo "${FIXTURE_TAG}RESULT: all checks green. Safe to mark READY_FOR_REVIEW."
  exit 0
fi

# ── the Rule I baseline walk (FOLLOW-846 AC(1)/AC(2)) ─────────────────────────
# Resolves ONCE per invocation and memoizes, so that a check name registered
# twice does not resolve the baseline twice.
BASELINE_STATE=""
BASELINE_RUN_ID=""
BASELINE_VIOLATIONS=""
BASELINE_SYMBOLS=""

resolve_rule_i_baseline() {
  case "$BASELINE_STATE" in
    ok) return 0 ;;
    unusable) return 1 ;;
  esac

  local runs id head created status concl reason skipped considered
  local jobmeta jid jconcl count syms diag age_s age_h

  runs="$(fetch_main_run_candidates 2> "$tmp_dir/runs.err")"
  if [[ -z "$runs" ]]; then
    echo "WARN: could not list main's recent ci.yml runs — $(classify_fetch_error "$tmp_dir/runs.err")."
    BASELINE_STATE="unusable"
    return 1
  fi

  echo "Rule I baseline: walking main's ci.yml runs newest-first (look-back $BASELINE_LOOKBACK),"
  echo "  taking the FIRST run that actually produced a parseable Rule I symbol set. A"
  echo "  cancelled or skipped run is not a baseline — its Rule I job never ran."
  count=""
  syms=""
  skipped=0
  considered=0
  while IFS=$'\t' read -r id head created status concl; do
    [[ -n "$id" ]] || continue
    considered=$((considered + 1))
    reason=""
    if [[ "$status" != "completed" ]]; then
      reason="run is $status — not finished, so main is AHEAD of whatever baseline is chosen below"
    elif [[ "$concl" != "success" && "$concl" != "failure" ]]; then
      reason="run conclusion=$concl — a $concl run's Rule I job produced no log to compare against"
    fi

    if [[ -z "$reason" ]]; then
      jobmeta="$(fetch_main_job_meta "$id" 2>/dev/null)"
      jid="$(printf '%s' "$jobmeta" | cut -f1)"
      jconcl="$(printf '%s' "$jobmeta" | cut -f2)"
      if [[ -z "$jid" ]]; then
        reason="no job named '$RULE_I_NAME' in this run"
      elif [[ "$jconcl" != "success" && "$jconcl" != "failure" ]]; then
        reason="its Rule I job (id $jid) concluded '$jconcl' — no log to read"
      elif ! fetch_job_log "$jid" "main-rule-i-$id.log" > "$tmp_dir/main.log" 2> "$tmp_dir/main.err"; then
        diag="$(classify_fetch_error "$tmp_dir/main.err" "$jid")"
        reason="its Rule I job log (id $jid) could not be fetched — $diag"
      else
        count="$(rule_i_count_from_log < "$tmp_dir/main.log")"
        rule_i_symbols_from_log < "$tmp_dir/main.log" > "$tmp_dir/main.syms"
        syms="$(wc -l < "$tmp_dir/main.syms" | tr -d ' ')"
        if [[ -z "$count" ]]; then
          reason="its Rule I log has no 'Violations found: N' line (job died early, or the format changed)"
        elif [[ "$count" -gt 0 && "$syms" -eq 0 ]]; then
          reason="its Rule I log reports $count violation(s) but zero symbols could be parsed out of it"
        fi
      fi
    fi

    if [[ -n "$reason" ]]; then
      echo "  - SKIPPED run $id (head ${head:0:12}, ${created:-unknown}): $reason"
      skipped=$((skipped + 1))
      continue
    fi

    BASELINE_RUN_ID="$id"
    BASELINE_VIOLATIONS="$count"
    BASELINE_SYMBOLS="$syms"
    BASELINE_STATE="ok"
    echo "  - CHOSEN  run $id (head ${head:0:12}, ${created:-unknown}, conclusion=$concl):"
    echo "    $syms violating symbol(s), count line $count; $skipped newer run(s) skipped above."
    echo "  The baseline RATCHETS: any Rule I violation already merged into main counts as"
    echo "  pre-existing here and will not block this PR. Check the head sha is what you expect."
    age_h=""
    age_s="$(iso_age_seconds "$created")"
    [[ -z "$age_s" ]] || age_h=$((age_s / 3600))
    if [[ -n "$age_h" && "$age_h" -gt "$BASELINE_STALE_HOURS" ]]; then
      echo "  WARN: this baseline is ${age_h}h old (> ${BASELINE_STALE_HOURS}h). main has very"
      echo "        likely moved since, and a stale baseline errs in BOTH directions — it can"
      echo "        report symbols as NEW that main already has, and accept ones main has since"
      echo "        fixed. Treat the verdict as provisional and re-run against a fresh main run."
    fi
    return 0
  done <<< "$runs"

  echo ""
  echo "ERROR: no usable Rule I baseline in main's last $considered ci.yml run(s); all $skipped"
  echo "  were skipped for the reasons listed above. Without a baseline the gate cannot say"
  echo "  whether this PR's Rule I violations are new or pre-existing, and it will not guess in"
  echo "  either direction."
  BASELINE_STATE="unusable"
  return 1
}

# ── de-duplicate the failing list BY NAME (FOLLOW-846 AC(4)) ──────────────────
# This repo registers TWO check-runs per job on a PR branch — one from the `push`
# event on the branch, one from the `pull_request` event on the merge ref. PR
# #681 carried 75 check-runs over 39 distinct names. Un-collapsed, the gate
# resolved main's baseline twice and downloaded four logs to answer one question,
# and reported ONE failing job as "2 genuine failure(s)".
#
# The collapse operates on the FAILING list only, so it cannot drop the last
# failing entry for a name and cannot turn a red into a green. Where one name has
# several failing check-runs they are ALL still read: for Rule I the symbol sets
# are UNIONED across them. That is strictly more conservative than picking one,
# because the push run (branch head) and the pull_request run (merge with main)
# are different commits and can legitimately differ — a "keep the first" collapse
# could silently pick the friendlier of the two.
declare -a uniq_names=()
declare -A urls_by_name=()
for entry in "${failure_names[@]}"; do
  name="$(printf '%s' "$entry" | grep -oP '"name":"\K[^"]*')"
  url="$(printf '%s' "$entry" | grep -oP '"url":"\K[^"]*')"
  if [[ -z "${urls_by_name["$name"]+set}" ]]; then
    uniq_names+=("$name")
    urls_by_name["$name"]="$url"
  else
    urls_by_name["$name"]+=$'\n'"$url"
  fi
done

echo "${#failure_names[@]} failing check-run(s) across ${#uniq_names[@]} distinct check name(s)."
echo ""

genuine_failures=()
accepted_failures=()
# Things the GATE could not do, as opposed to things the PR did wrong. These
# exit 3, never 1: the PM's documented response to exit 1 is to send the ticket
# back to its worker and increment fix_iteration_counter, and no worker can fix
# a cancelled baseline run or a rate-limited log fetch (FOLLOW-846 AC(2)).
tooling_failures=()

for name in "${uniq_names[@]}"; do
  urls="${urls_by_name["$name"]}"
  dup_n="$(printf '%s\n' "$urls" | grep -c .)"
  first_url="$(printf '%s\n' "$urls" | head -1)"

  if [[ "$name" != "$RULE_I_NAME" ]]; then
    if [[ "$dup_n" -gt 1 ]]; then
      genuine_failures+=("$name ($first_url) — not on the documented pre-existing-red list ($dup_n failing check-runs of this name)")
    else
      genuine_failures+=("$name ($first_url) — not on the documented pre-existing-red list")
    fi
    continue
  fi

  # ── PR side: every check-run carrying this name, unioned ───────────────────
  if [[ "$dup_n" -gt 1 ]]; then
    echo "'$name' has $dup_n failing check-runs (push + pull_request events for the same job);"
    echo "  reading all of them and comparing the UNION of their violating symbols against main."
  fi

  : > "$tmp_dir/pr.syms.all"
  pr_ok=1
  pr_counts=""
  while IFS= read -r one_url; do
    [[ -n "$one_url" ]] || continue
    jid="$(printf '%s' "$one_url" | grep -oP '/job/\K[0-9]+')"
    if [[ -z "$jid" ]]; then
      echo "WARN: could not extract a job id from Rule I check url '$one_url'."
      tooling_failures+=("$name — job id unresolvable from check url '$one_url'")
      pr_ok=0
      continue
    fi

    if ! fetch_job_log "$jid" "pr-rule-i-$jid.log" > "$tmp_dir/pr-$jid.log" 2> "$tmp_dir/pr-$jid.err"; then
      diag="$(classify_fetch_error "$tmp_dir/pr-$jid.err" "$jid")"
      echo "WARN: could not FETCH the PR's Rule I job log (job $jid) — $diag."
      tooling_failures+=("$name — could not FETCH the PR's Rule I job log (job $jid): $diag")
      pr_ok=0
      continue
    fi

    one_count="$(rule_i_count_from_log < "$tmp_dir/pr-$jid.log")"
    if [[ -z "$one_count" ]]; then
      echo "WARN: the PR's Rule I log (job $jid) was fetched successfully but contains no"
      echo "      'Violations found: N' line — check-rule-i.sh's output format may have"
      echo "      changed, or the job died before its summary."
      tooling_failures+=("$name — Rule I log (job $jid) fetched but unparseable (no 'Violations found' line)")
      pr_ok=0
      continue
    fi

    rule_i_symbols_from_log < "$tmp_dir/pr-$jid.log" > "$tmp_dir/pr-$jid.syms"
    one_syms="$(wc -l < "$tmp_dir/pr-$jid.syms" | tr -d ' ')"
    if [[ "$one_count" -gt 0 && "$one_syms" -eq 0 ]]; then
      echo "WARN: the PR's Rule I log (job $jid) reports $one_count violation(s) but not one"
      echo "      \"WARN: '<symbol>' in <file>\" line could be parsed out of it. Comparing an"
      echo "      empty set against the baseline would accept everything, so this fails loud."
      tooling_failures+=("$name — count says $one_count but zero violation symbols parsed (job $jid; log format or matcher mismatch)")
      pr_ok=0
      continue
    fi

    pr_counts="${pr_counts:+$pr_counts/}$one_count"
    cat "$tmp_dir/pr-$jid.syms" >> "$tmp_dir/pr.syms.all"
  done <<< "$urls"

  [[ "$pr_ok" -eq 1 ]] || continue

  LC_ALL=C sort -u "$tmp_dir/pr.syms.all" > "$tmp_dir/pr.syms"
  pr_symbols="$(wc -l < "$tmp_dir/pr.syms" | tr -d ' ')"

  # ── main baseline ─────────────────────────────────────────────────────────
  if ! resolve_rule_i_baseline; then
    tooling_failures+=("$name — no usable Rule I baseline on main within the last $BASELINE_LOOKBACK ci.yml run(s); see the walk above")
    continue
  fi

  # ── the comparison (SET, not count) ───────────────────────────────────────
  comm -23 "$tmp_dir/pr.syms" "$tmp_dir/main.syms" > "$tmp_dir/new.syms"
  comm -13 "$tmp_dir/pr.syms" "$tmp_dir/main.syms" > "$tmp_dir/fixed.syms"
  new_symbols="$(wc -l < "$tmp_dir/new.syms" | tr -d ' ')"
  fixed_symbols="$(wc -l < "$tmp_dir/fixed.syms" | tr -d ' ')"

  echo "Rule I symbol-set comparison: PR has $pr_symbols violating symbol(s) (count line(s):"
  echo "  $pr_counts), main baseline has $BASELINE_SYMBOLS (count line: $BASELINE_VIOLATIONS)."
  echo "  New on this PR: $new_symbols | fixed by this PR: $fixed_symbols"

  if [[ "$new_symbols" -eq 0 ]]; then
    accepted_failures+=("$name — pre-existing-red: all $pr_symbols violating symbol(s) are also in main's baseline (run $BASELINE_RUN_ID); $fixed_symbols fixed by this PR")
  else
    echo ""
    echo "  NEW violating symbols (on this PR, absent from main's baseline):"
    head -20 "$tmp_dir/new.syms" | sed 's/^/    - /'
    if [[ "$new_symbols" -gt 20 ]]; then
      echo "    … and $((new_symbols - 20)) more"
    fi
    if [[ "$pr_counts" == "$BASELINE_VIOLATIONS" ]]; then
      echo ""
      echo "  NOTE: the two COUNTS are equal ($pr_counts). Only the symbol SETS differ —"
      echo "  this PR fixed $fixed_symbols violation(s) and introduced $new_symbols. A count"
      echo "  comparison would have accepted it and exited 0; that compensating-swap case is"
      echo "  what FOLLOW-821 AC(1) forbids by name and what FOLLOW-827 fixed here."
    fi
    genuine_failures+=("$name — $new_symbols NEW Rule I violation symbol(s) not in main's baseline (run $BASELINE_RUN_ID)")
  fi
done

echo ""
if [[ "${#accepted_failures[@]}" -gt 0 ]]; then
  echo "Documented pre-existing-red (non-blocking, verified, not silently hidden):"
  for f in "${accepted_failures[@]}"; do
    echo "  - $f"
  done
fi

# TOOLING outcomes take precedence over the PR verdict: a gate that could not
# complete its own comparison must not render EITHER verdict, and must not be
# reported in the vocabulary of the PR. RETRO-250 watched the shipped version
# print "GENUINE FAILURES … do NOT mark READY_FOR_REVIEW" and exit 1 on PR #681
# because main's newest completed run happened to be cancelled, then exit 0 six
# minutes later on the same commit.
if [[ "${#tooling_failures[@]}" -gt 0 ]]; then
  echo ""
  echo "TOOLING FAILURES (the gate could not read what it needed — NOT a verdict on this PR):"
  for f in "${tooling_failures[@]}"; do
    echo "  - $f"
  done
  if [[ "${#genuine_failures[@]}" -gt 0 ]]; then
    echo ""
    echo "Also observed, and these ARE genuine failures of this PR:"
    for f in "${genuine_failures[@]}"; do
      echo "  - $f"
    done
  fi
  echo ""
  echo "${FIXTURE_TAG}RESULT: UNDETERMINED (exit 3). This is NOT a green light, and NOT a red"
  echo "  verdict on the PR either: the gate itself could not complete. Do not send the ticket"
  echo "  back to its worker on the strength of this run and do not increment"
  echo "  fix_iteration_counter — fix the tooling problem named above and re-run."
  exit 3
fi

if [[ "${#genuine_failures[@]}" -gt 0 ]]; then
  echo ""
  echo "GENUINE FAILURES (blocking — do NOT mark READY_FOR_REVIEW):"
  for f in "${genuine_failures[@]}"; do
    echo "  - $f"
  done
  echo ""
  echo "${FIXTURE_TAG}RESULT: FAIL. ${#genuine_failures[@]} genuine failure(s)."
  exit 1
fi

echo ""
echo "${FIXTURE_TAG}RESULT: all failing checks are documented, dynamically-verified pre-existing-red. Safe to mark READY_FOR_REVIEW."
exit 0
