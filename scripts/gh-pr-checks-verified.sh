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
#   5. REQUIRES THE SNAPSHOT TO BE COMPLETE, not merely stable (FOLLOW-865). Point 1
#      defends against the check-run set CHANGING between polls. It does not defend
#      against the set being TRUNCATED, and a truncated set is stable, non-pending and
#      identical to itself, so it satisfied "two consecutive identical, fully-settled
#      snapshots" on the first two polls. That printed "all checks green. Safe to mark
#      READY_FOR_REVIEW", exit 0, over five check-runs in a repo whose PRs register ~77 —
#      live, twice, on PR #686 during the 2026-08-06 Actions outage (ESC-050). The gate now
#      also requires the rollup to carry at least a DERIVED floor of check-runs (40% of the
#      second-highest of the repo's own twelve most recent PR rollups) and never to be
#      smaller than the largest rollup this same run already saw. Below that it waits, and
#      if it never recovers it exits 3 — UNDETERMINED, no verdict — naming observed vs
#      expected. See "the cardinality floor" below for why the floor is derived and why the
#      percentage is what it is.
#
#   6. PREFLIGHTS ITS OWN DEPENDENCIES and refuses to run degraded (FOLLOW-830). The
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
#                                               [--accept-cardinality N]
#   scripts/gh-pr-checks-verified.sh --self-test
#
# SELF-TEST
#   `--self-test` runs 27 SYNTHESIZED fixtures (Rule AM — never driven off a live PR's
#   check state, and fully offline) through the real code path via a fixture seam:
#   all-green -> 0; an undocumented failing check -> 1; Rule I with main's exact symbol
#   set -> 0; Rule I with a new symbol on top of main -> 1; Rule I with EQUAL COUNTS but a
#   swapped symbol -> 1 (the FOLLOW-827 case); zero registered checks -> 2, never 0; a
#   grep without PCRE -> 3, never a green verdict (the FOLLOW-830 case); an unfetchable
#   Rule I log -> 3, named as a TOOLING failure; an accepted Rule I beside a genuine
#   failure -> 1; a CANCELLED newest baseline run -> skipped, walk continues, 0; a
#   look-back window with nothing usable in it -> 3, never 1; the fixture seam invoked
#   outside self-test -> 3, refused; a 404 on a cancelled job -> diagnosed as cancellation
#   rather than log expiry (the four FOLLOW-846 cases); a snapshot whose serialization the
#   failing-check regex does not match -> 3, never "all checks green" (the FOLLOW-856
#   case); one check name registered twice with a symbol on only the merge-ref run -> 4,
#   never 1, and the SAME fixture with that symbol on BOTH runs -> 1 (the FOLLOW-855
#   discrimination pair); a PR that edits scripts/check-rule-i.sh -> 4; a GREEN branch-head
#   Rule I run used as evidence -> 4; the same PR flipping 4 -> 0 when main's baseline
#   catches up (the P-35 clause-(b) demonstration); a Rule I job that FAILED CLOSED, whose
#   own diagnostic prose quotes "Violations found: 0", -> 3 rather than an empty symbol set
#   accepted as clean; a five-check all-green rollup in a 77-check repo -> 3, never 0, and
#   the same rollup COLLAPSING 77 -> 5 between polls -> 3, and a PARTIAL collapse 77 -> 40
#   that stays ABOVE the derived floor -> 3 (the three FOLLOW-865 cases; the last two need
#   the sequenced seam, and each pins a different half of the guard — see the discrimination
#   matrix in the PR body); a FAILURE that registers only on the third
#   read -> 1 rather than being outrun by the settle loop; a FAILURE on the third read
#   behind a merely-CHANGED second read -> 1 (the first fixture this file has ever had for
#   the two-consecutive-snapshot mechanism itself); a stated --accept-cardinality -> 0 with the
#   waiver on the RESULT line; an unreadable peer sample -> 3; plus the fixture COUNT
#   itself, and this file's own mode == 755 on disk and in the git index.
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
#      unparseable Rule I log, no usable baseline in the look-back window, a snapshot whose
#      serialization its own parser no longer matches, a check-run rollup that never became
#      COMPLETE, or no readable sample to derive completeness from) and therefore rendered
#      NO verdict.
#      A truncated rollup is a 3 and specifically not a 2 (FOLLOW-865 AC(2)): 2 means the
#      run was still moving and waiting is the remedy, whereas a stable-but-short rollup
#      returns the identical answer however long you wait — nothing about the PR was ever
#      observed. It is equally not a 1: an Actions incident is not a worker's bug and must
#      not consume the 3-retry escalation budget.
#      3 is not a milder 1. Exit 1 means "this PR is red" and routes to sending the ticket
#      back to its worker; exit 3 means "the gate did not get to look", which no worker can
#      fix and which must not consume the 3-retry escalation budget (FOLLOW-846 AC(2)).
#      3 is equally not a green: do not mark READY_FOR_REVIEW on it. When both a tooling
#      failure and a genuine failure are present, both are printed and the exit code is 3 —
#      an incomplete verdict is not a verdict.
#   4  NOT ATTRIBUTABLE TO THIS PR (FOLLOW-855). The gate completed its comparison and the
#      only thing standing between this PR and a green is a Rule I violation symbol it
#      cannot attribute to this PR's own content. Two causes, both named in the output:
#        (a) main moved underneath the PR — the symbol is present on only SOME of the PR's
#            own Rule I check-runs. The `push` run is the branch head and the
#            `pull_request` run is the merge ref; they are different commits, and the only
#            thing that differs between them is main's newer content. A symbol that is not
#            on every one of the PR's runs is therefore not stably the PR's.
#        (b) this PR modifies the Rule I PRODUCER itself (scripts/check-rule-i.sh), so the
#            PR side and main's baseline were extracted by different programs and the two
#            symbol sets are not comparable at all.
#      4 is not a green: do not mark READY_FOR_REVIEW on it. It is equally not a 1: the
#      worker cannot delete a dead export somebody else merged into main, so an exit 4 must
#      NOT increment fix_iteration_counter and must NOT send the ticket back. The documented
#      response is to re-run once a newer main run has completed (the baseline walk then
#      picks up the symbol and the same PR exits 0), or — for cause (b) — to adjudicate the
#      named symbols by hand against the PR's own diff. Precedence when several categories
#      are present: 3 > 1 > 4 > 0.
#   (in --self-test mode: 0 = every fixture passed, 1 = at least one fixture failed)
#
# EXIT-CODE-CONTRACT (machine-readable — scripts/check-gate-exit-codes.sh parses the lines
# below and asserts that every consumer that ROUTES on this script's exit code carries the
# identical marker. Change a code here and CI goes red until each routing consumer is
# updated in the same PR. FOLLOW-854 exists because a widened exit 3 reached the prose in
# docs/ and CONVENTIONS_PATCH.md but not .claude/agents/pm-orchestrator.md, which is the
# file the decision-maker actually executes.)
#   0=GREEN
#   1=GENUINE_FAILURE
#   2=TIMEOUT
#   3=TOOLING_FAILURE
#   4=NOT_ATTRIBUTABLE
# END-EXIT-CODE-CONTRACT
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
# Strips the ISO timestamp GitHub prefixes onto every raw job-log line, so the two
# parsers below can ANCHOR at the start of the producer's own line. Anchoring is not
# cosmetic — see the hazard note in each.
_strip_log_timestamp() {
  sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z[[:space:]]*//'
}

# Reads a Rule I job log on stdin; prints the trailing "Violations found: N" count.
#
# ANCHORED AT LINE START AND LINE END, and that is load-bearing. check-rule-i.sh emits
# the real verdict as `echo "Violations found    : $VIOLATIONS"` at column 0, but its
# exit-3 DIAGNOSTICS quote the same phrase inside prose. There were two; FOLLOW-857
# reworded the preflight one away at the producer, and the D3 one necessarily remains:
#   "  script runs without 'set -e' the result would be 'Violations found: 0'"  [removed]
#   "  The symbol extractor returned nothing at all. Reporting 'Violations found: 0'"  [live]
# Both go to stderr, and a GitHub job log interleaves stderr into the same bytes this
# gate downloads. Unanchored, this function read '0' out of that prose — so a Rule I
# job that FAILED CLOSED with exit 3 reached the gate as "count 0, zero symbols", which
# trips neither the empty-count guard nor the count-without-symbols guard, compares an
# empty set against main's baseline, and is accepted as pre-existing-red: exit 0 over a
# Rule I job that never ran. Verified against the real post-FOLLOW-842 producer with a
# non-PCRE grep on PATH. The producer's mitigation (print no count line when it cannot
# render a verdict) is correct and necessary but not sufficient on its own, because the
# producer must still be able to TALK about the line it is declining to print.
rule_i_count_from_log() {
  _strip_log_timestamp | grep -oP '^Violations found\s*:\s*\K[0-9]+(?=\s*$)' | tail -1
}

# Reads a Rule I job log on stdin; prints one "<symbol> @ <file>" line per
# violation, sorted and deduped, ready for comm(1). The source lines are
# check-rule-i.sh's own
#   WARN: '<symbol>' in <file> — zero non-test importers
# prefixed by the ISO timestamp GitHub adds to every raw log line, hence the
# unanchored match. This per-symbol identity is what makes the baseline
# comparison a SET comparison rather than a count threshold (FOLLOW-827 AC(1)).
# Anchored for the same reason as the count above: the producer emits real WARN lines at
# column 0, while its own self-test fixtures and diagnostics quote WARN-shaped text inside
# other sentences. A symbol harvested out of prose is a phantom violation.
rule_i_symbols_from_log() {
  _strip_log_timestamp | grep -oP "^WARN: '\K[^']+' in \S+" | sed "s/' in / @ /" | LC_ALL=C sort -u
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
#
# IN FIXTURE MODE THIS SERVES A SEQUENCE (FOLLOW-848 AC(1)). A fixture dir may
# ship snapshot.1.json, snapshot.2.json, … ; the Nth poll of a run is served the
# Nth file, and the last file repeats for every poll after it. A dir that ships
# a plain snapshot.json keeps the old static behaviour, so the fixtures written
# before this seam existed are unchanged.
#
# WHY THE SEQUENCE HAD TO EXIST. Until it did, every fixture served one static
# file, so no fixture could express a check-run set that CHANGES BETWEEN POLLS —
# and "the shape of the check-run set changed between polls" is the only shape
# the late-registration race has. RETRO-252 proved the consequence by
# perturbation: deleting the two-consecutive-snapshot condition, the entire
# mechanism this file exists to provide, left every fixture passing. The settle
# loop had zero fixtures. It has some now (see F24/F25 below), and they are the
# reason a cardinality floor could be shipped red-first at all.
#
# The poll index is an ARGUMENT rather than a counter this function keeps,
# because every call site is `snapshot="$(fetch_snapshot …)"` — a command
# substitution, i.e. a subshell, in which an incremented counter dies with the
# subshell and every poll would be served snapshot.1.json forever. That is not a
# hypothetical: it is what the first cut of this seam did, and three fixtures
# caught it.
fetch_snapshot() {
  if [[ -n "$FIXTURE_DIR" ]]; then
    if [[ -f "$FIXTURE_DIR/snapshot.1.json" ]]; then
      local i="${1:-1}"
      [[ "$i" -ge 1 ]] || i=1
      while [[ "$i" -gt 1 && ! -f "$FIXTURE_DIR/snapshot.$i.json" ]]; do
        i=$((i - 1))
      done
      cat "$FIXTURE_DIR/snapshot.$i.json"
      return 0
    fi
    cat "$FIXTURE_DIR/snapshot.json"
    return 0
  fi
  gh pr view "$PR" --repo "$REPO" --json statusCheckRollup -q "$SNAPSHOT_FILTER" 2>/dev/null
}

# Prints ONE INTEGER PER LINE: how many check-runs are registered on each of the
# repo's own recent pull requests, excluding the PR under test. This is the
# observable state the cardinality floor is derived from (FOLLOW-865 AC(1)) —
# the same quantity, measured on the same class of object, by the same API, so
# it tracks ci.yml automatically instead of rotting like a hardcoded number.
# Returns NON-ZERO when the read itself failed; the caller turns that into a
# TOOLING failure rather than guessing a floor.
fetch_peer_cardinalities() {
  if [[ -n "$FIXTURE_DIR" ]]; then
    [[ -f "$FIXTURE_DIR/peer-cardinality.txt" ]] || return 1
    cat "$FIXTURE_DIR/peer-cardinality.txt"
    return 0
  fi
  gh pr list --repo "$REPO" --state all -L "$PEER_SAMPLE_SIZE" \
    --json number,statusCheckRollup \
    -q ".[] | select(.number != $PR) | (.statusCheckRollup | length)" 2>/dev/null
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

# Prints one changed-file path per line for the PR under test. Read lazily and
# only when the Rule I comparison has already found NEW symbols, so a clean PR
# never pays for it. Returns non-zero when the read itself failed — the caller
# turns that into a TOOLING failure rather than guessing (FOLLOW-855 AC(4)).
fetch_pr_files() {
  if [[ -n "$FIXTURE_DIR" ]]; then
    [[ -f "$FIXTURE_DIR/pr-files.txt" ]] || return 0
    cat "$FIXTURE_DIR/pr-files.txt"
    return 0
  fi
  gh pr view "$PR" --repo "$REPO" --json files -q '.files[].path'
}

# ── Constants + the snapshot serialization contract ──────────────────────────
# Declared ABOVE --self-test because the self-test asserts against them: the
# fixture seam supplies snapshot.json directly, so the projection/parser
# consistency assertion is the only place that pair can be checked at all.

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

# Path (relative to the repo root) of the program that PRODUCES the Rule I symbol
# lines this gate parses. A PR that edits it makes the PR side and main's baseline
# the output of two different programs (FOLLOW-855 AC(4) / FOLLOW-842).
RULE_I_PRODUCER="scripts/check-rule-i.sh"

# ── the cardinality floor (FOLLOW-865) ───────────────────────────────────────
# The settle condition below asks whether the check-run set STOPPED CHANGING. It
# never asked whether the set was COMPLETE. A rollup that has not yet registered
# the rest of the repo's checks is stable, non-pending and identical to itself,
# so it satisfies "two consecutive identical, fully-settled snapshots" on the
# first two polls. Driven with a five-check all-SUCCESS rollup against a repo
# whose PRs register ~77, the gate printed "all checks green. Safe to mark
# READY_FOR_REVIEW" and exited 0 — and did so LIVE, twice, on PR #686 during the
# 2026-08-06 Actions outage (ESC-050), where recovery reruns collapsed the
# rollup. Both verdicts were refused by hand, on a ">= 60 registered checks"
# condition the gate itself did not contain. This is FOLLOW-813's ORIGINAL input
# class: `gh pr checks --watch` died on "the check-run set was incomplete when I
# looked", and two-consecutive-identical-snapshots defends against STATE changing
# between polls, not against CARDINALITY collapsing. FOLLOW-856's arithmetic
# guard structurally cannot see it either: 5 = 5 + 0 + 0 + 0 is self-consistent,
# because a truncated snapshot is internally consistent by construction.
#
# THE FLOOR IS DERIVED, NEVER HARDCODED. A constant "minimum 60" would be wrong
# on the first day ci.yml gains or loses a job — the same rot FOLLOW-821/827
# removed from the Rule I classification, and the shape FOLLOW-779 caught
# drifting 42-vs-43. Instead the gate measures the SAME quantity on the SAME
# class of object: how many check-runs this repo's own recent PRs registered.
# One `gh pr list` read, once per invocation.
#
#   reference = the SECOND-HIGHEST usable peer sample (the highest when fewer
#               than three are usable), and
#   floor     = ceil(reference * CARDINALITY_FLOOR_PERCENT / 100).
#
# Second-highest rather than the median, and rather than the max: the max is one
# inflated peer away from over-blocking, while the median COLLAPSES as soon as
# more than half the sample is truncated — which is precisely what a repo-wide
# Actions outage does to it, and an outage is the condition this guard exists
# for. Second-highest tolerates one outlier in either direction and does not
# start falling until all but two peers are affected.
#
# WHY 40 PERCENT, measured rather than chosen. On 2026-08-07 the repo's twelve
# most recent PRs registered 79/77/77/74/76/75/75/75/73/73/38/73 check-runs. Two
# workflow runs contribute to a PR's rollup — the `push` run on the branch head
# and the `pull_request` run on the merge ref — which is why names appear twice
# (75 checks / 36 duplicated names on PR #681, RETRO-250). So the smallest
# STRUCTURALLY EXPLICABLE shape is one run instead of two, about half the
# rollup: the 38 in that sample is exactly that shape. A floor must sit strictly
# below the smallest legitimate shape, so it sits below half, at 40%: 31 against
# this repo's current peers. It refuses the 5 that was observed live, and admits
# a single-run 38. It moves on its own as ci.yml does.
CARDINALITY_FLOOR_PERCENT=40

# How many recent PRs the peer sample reads. Large enough that a handful of
# collapsed rollups during an incident cannot take out the second-highest.
PEER_SAMPLE_SIZE=12

# ── SNAPSHOT SERIALIZATION CONTRACT (FOLLOW-856) ──────────────────────────────
# ONE declaration drives BOTH the jq projection that PRODUCES the check snapshot
# and every PCRE that PARSES it back further down. Before this they were
# independent literals ~50 lines apart: the projection emitted
# {"name":…,"state":…,"url":…} and the parser matched exactly that byte shape, so
# adding a key, renaming one, or reordering them made the parser match NOTHING.
# Because this script runs under `set -uo pipefail` WITHOUT `-e`, `mapfile` then
# succeeded with zero lines and the gate printed "failing: 0" beside a `total`
# that visibly contradicted it and exited 0 over FAILURE check-runs — driven
# against the merged script on main, RETRO-252 §4a LG-1:
#   Total checks: 2 | success: 0 | skipped: 0 | neutral: 0 | failing: 0
#   RESULT: all checks green. Safe to mark READY_FOR_REVIEW.        exit=0
# Rule AQ: a "copied verbatim, keep in sync" comment is not a control. The two
# sides are now GENERATED from one array, and the arithmetic self-consistency
# guard at the parse site is the second layer, covering the shapes an array
# cannot (whitespace, an escaped quote in a check name, a gh/jq serialization
# change). The guard is the binding control; this derivation only removes the
# most likely way to trip it.
SNAPSHOT_FIELDS=(
  'name:(.name // .context)'
  'state:(if .__typename=="StatusContext" then .state elif .status!="COMPLETED" then "PENDING" else .conclusion end)'
  'url:(.detailsUrl // .targetUrl // "")'
)

# _object_regex <name-pattern> <state-pattern> — a PCRE for ONE serialized
# snapshot object, built from SNAPSHOT_FIELDS so that key names, key order and
# key count are read from the same place jq wrote them.
_object_regex() {
  local name_pat="$1" state_pat="$2" re='\{' sep='' f k
  for f in "${SNAPSHOT_FIELDS[@]}"; do
    k="${f%%:*}"
    case "$k" in
      name) re+="$sep\"name\":\"$name_pat\"" ;;
      state) re+="$sep\"state\":\"$state_pat\"" ;;
      *) re+="$sep\"$k\":\"[^\"]*\"" ;;
    esac
    sep=','
  done
  re+='\}'
  printf '%s' "$re"
}

_snapshot_filter() {
  local IFS=,
  printf '[.statusCheckRollup[] | {%s}] | sort_by(.name, .url)' "${SNAPSHOT_FIELDS[*]}"
}

SNAPSHOT_FILTER="$(_snapshot_filter)"
# Everything that is not SUCCESS/SKIPPED/NEUTRAL is a failure-class state
# (FAILURE, CANCELLED, TIMED_OUT, ACTION_REQUIRED, STALE, ERROR).
FAILURE_REGEX="$(_object_regex '[^"]*' '(?!SUCCESS|SKIPPED|NEUTRAL)[^"]*')"
# Every check-run carrying the Rule I name, WHATEVER its state — the provenance
# comparison in FOLLOW-855 needs the green ones too (a branch-head run that is
# green has an empty symbol set, and that emptiness is exactly what proves a
# merge-ref-only symbol is not the PR's). \Q…\E quotes the em-dash-bearing name.
RULE_I_REGEX="$(_object_regex "\\Q${RULE_I_NAME}\\E" '[^"]*')"

# Resolved once per invocation, just before the poll loop (FOLLOW-865).
CARDINALITY_FLOOR=0
CARDINALITY_REFERENCE=0
CARDINALITY_SAMPLES=0

# Sets CARDINALITY_FLOOR / CARDINALITY_REFERENCE / CARDINALITY_SAMPLES from the
# peer sample, or exits 3. It never falls back to a guess: a gate that cannot
# establish what a COMPLETE rollup looks like for this repo has no basis for
# saying a given rollup is complete, and "I could not tell" is exit 3 —
# UNDETERMINED, no verdict — not a green.
derive_cardinality_floor() {
  local raw rc=0 n
  raw="$(fetch_peer_cardinalities)" || rc=$?

  if [[ "$rc" -ne 0 ]]; then
    echo "ERROR: could not read the peer check-run cardinality sample." >&2
    echo "  The gate derives its completeness floor from how many check-runs this repo's" >&2
    echo "  own recent PRs registered ('gh pr list --json statusCheckRollup'). That read" >&2
    echo "  failed (rc=$rc), so there is no floor, so a truncated rollup would be" >&2
    echo "  indistinguishable from a complete one — which is a FALSE GREEN (FOLLOW-865)." >&2
    echo "  Refusing to render a verdict. Re-run when the API read succeeds, or state the" >&2
    echo "  observed count explicitly with --accept-cardinality <n>." >&2
    echo ""
    echo "${FIXTURE_TAG}RESULT: UNDETERMINED (exit 3). NOT a green light and NOT a verdict on"
    echo "  this PR. Do not mark READY_FOR_REVIEW, and do not increment"
    echo "  fix_iteration_counter — no worker can fix this."
    exit 3
  fi

  local -a samples=()
  while read -r n; do
    [[ "$n" =~ ^[0-9]+$ ]] || continue
    [[ "$n" -gt 0 ]] || continue
    samples+=("$n")
  done < <(printf '%s\n' "$raw" | sort -rn)

  CARDINALITY_SAMPLES="${#samples[@]}"
  if [[ "$CARDINALITY_SAMPLES" -eq 0 ]]; then
    echo "ERROR: the peer check-run cardinality sample came back empty." >&2
    echo "  ${PEER_SAMPLE_SIZE} recent PRs were read and not one of them carries a" >&2
    echo "  check-run rollup, so this gate cannot say what a complete rollup looks like" >&2
    echo "  here. Two causes, and neither is a verdict about this PR: the repo genuinely" >&2
    echo "  has no prior PR with checks, or an incident has truncated the sample too" >&2
    echo "  (FOLLOW-865 AC(5)). Use --accept-cardinality <n> to proceed against a stated," >&2
    echo "  visible count." >&2
    echo ""
    echo "${FIXTURE_TAG}RESULT: UNDETERMINED (exit 3). NOT a green light and NOT a verdict on"
    echo "  this PR. Do not mark READY_FOR_REVIEW, and do not increment"
    echo "  fix_iteration_counter — no worker can fix this."
    exit 3
  fi

  if [[ "$CARDINALITY_SAMPLES" -ge 3 ]]; then
    CARDINALITY_REFERENCE="${samples[1]}"
  else
    CARDINALITY_REFERENCE="${samples[0]}"
  fi
  CARDINALITY_FLOOR=$(((CARDINALITY_REFERENCE * CARDINALITY_FLOOR_PERCENT + 99) / 100))
  [[ "$CARDINALITY_FLOOR" -ge 1 ]] || CARDINALITY_FLOOR=1
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
  # How many _st_expect assertions this mode must EXECUTE. A fixture that stops
  # being reached — an early `exit`, a mis-nested `if`, a bad merge — otherwise
  # just makes the pass total smaller, which nothing was watching: RETRO-252
  # observed the reported figure degrade 16 -> 15 with no red. The mode checks
  # below are deliberately NOT in this number, because the git-index one is
  # legitimately unavailable outside a checkout and that is exactly the
  # legitimate degradation that made the old total untrustworthy as an assertion.
  ST_EXPECTED_FIXTURES=27
  st_expect_ran=0

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
  #
  # The default peer-cardinality sample is twelve 2-check PRs, because the
  # synthetic repo these fixtures describe is one whose PRs register two checks:
  # a floor derived from it is 1, which every fixture below satisfies. The
  # cardinality fixtures overwrite it with a sample that matches the repo shape
  # they are describing (FOLLOW-865).
  _st_fixture() {
    local d="$st_tmp/$1"
    mkdir -p "$d"
    : > "$d/self-test.marker"
    printf '4242\tdeadbeefcafe1234\t%s\tcompleted\tfailure\n' "$st_now" > "$d/main-runs.tsv"
    printf '777\tfailure\n' > "$d/main-job-4242.tsv"
    _st_peers "$d" 12 2
    echo "$d"
  }

  # _st_peers <dir> <count> <cardinality> — writes the peer sample the floor is
  # derived from: <count> lines, each the check-run count of one recent PR.
  _st_peers() {
    local d="$1" n="$2" c="$3" i
    : > "$d/peer-cardinality.txt"
    for ((i = 0; i < n; i++)); do
      echo "$c" >> "$d/peer-cardinality.txt"
    done
  }

  # _st_checks <n> <state> [name-prefix] — a serialized rollup of <n> check-runs
  # in the snapshot's own key order, so a 77-check rollup can be written without
  # 77 literals.
  _st_checks() {
    local n="$1" state="$2" prefix="${3:-Job}" i out="" sep=""
    for ((i = 1; i <= n; i++)); do
      out+="$sep{\"name\":\"$prefix $i\",\"state\":\"$state\",\"url\":\"$st_job_url/$i\"}"
      sep=","
    done
    printf '[%s]' "$out"
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
  # ST_MAX_WAIT widens the poll budget for the sequenced-snapshot fixtures (a
  # fixture that asserts something about the THIRD read needs at least three
  # polls), and ST_EXTRA_ARGS passes flags such as --accept-cardinality.
  _st_run() {
    local dir="$1"
    local rc=0
    local self_test="1"
    [[ -z "${ST_OMIT_SELF_TEST_ENV:-}" ]] || self_test=""
    PATH="${ST_PATH_OVERRIDE:-$PATH}" \
      GH_PR_CHECKS_SELF_TEST="$self_test" GH_PR_CHECKS_FIXTURE_DIR="$dir" \
      bash "$0" 1 --max-wait-seconds "${ST_MAX_WAIT:-2}" --interval-seconds 1 \
      ${ST_EXTRA_ARGS[@]+"${ST_EXTRA_ARGS[@]}"} > "$st_out" 2>&1 || rc=$?
    return "$rc"
  }
  ST_EXTRA_ARGS=()

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
    st_expect_ran=$((st_expect_ran + 1))
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
  # A "keep the first" collapse exits 0 (wrong) and no collapse at all reports
  # one problem as two failures. Since FOLLOW-855 the union is also SPLIT by
  # provenance: `gamma` is on one run and not the other, so it is main's, not the
  # PR's, and the verdict is 4 rather than 1 — still never a green. This is
  # FOLLOW-855 AC(3)'s fixture: the merge-ref log carries a symbol the branch-head
  # log and the baseline do not.
  st_rule_i_dup='{"name":"Rule I — wired-or-dead check","state":"FAILURE","url":"'"$st_job_url"'/10"}'
  st_d="$(_st_fixture rule-i-duplicate)"
  echo "[$st_lint_ok,$st_rule_i_entry,$st_rule_i_dup]" > "$st_d/snapshot.json"
  _st_rule_i_log "$st_d/pr-rule-i-9.log" 1 'alpha@packages/a/src/one.ts'
  _st_rule_i_log "$st_d/pr-rule-i-10.log" 2 'alpha@packages/a/src/one.ts' 'gamma@packages/a/src/three.ts'
  _st_rule_i_log "$st_d/main-rule-i-4242.log" 1 'alpha@packages/a/src/one.ts'
  _st_expect "a merge-ref-only symbol is NOT attributed to this PR (exit 4, never 1)" 4 "$st_d" \
    "across 1 distinct check name" "REASON: main moved under this PR."

  # ── F16: a snapshot the failing-check regex does not match → 3, never 0 ────
  # THE FOLLOW-856 CASE, driven against the merged script on main: four count
  # passes said 2 checks / 0 success, the single structural PCRE matched nothing,
  # and the gate printed "failing: 0" and "all checks green" over two FAILURE
  # check-runs. The object below carries one extra key — the cheapest realistic
  # serialization drift — which the pre-guard parser silently ignored.
  st_d="$(_st_fixture snapshot-shape)"
  echo '[{"name":"Typecheck","state":"FAILURE","url":"'"$st_job_url"'/2","startedAt":"'"$st_now"'"}]' \
    > "$st_d/snapshot.json"
  _st_expect "a snapshot shape the failure regex misses exits 3, never 'all checks green'" 3 "$st_d" \
    "SNAPSHOT SERIALIZATION MISMATCH" "RESULT: UNDETERMINED"

  # ── F17: DISCRIMINATION — a symbol on EVERY PR run is still the PR's → 1 ──
  # Exit 4 must not become a blanket softening. Same two-check-run shape as F13,
  # but `gamma` is on both runs, so it is on the branch content whatever main is
  # doing and the verdict stays a blocking genuine failure.
  st_d="$(_st_fixture rule-i-both-runs)"
  echo "[$st_lint_ok,$st_rule_i_entry,$st_rule_i_dup]" > "$st_d/snapshot.json"
  _st_rule_i_log "$st_d/pr-rule-i-9.log" 2 'alpha@packages/a/src/one.ts' 'gamma@packages/a/src/three.ts'
  _st_rule_i_log "$st_d/pr-rule-i-10.log" 2 'alpha@packages/a/src/one.ts' 'gamma@packages/a/src/three.ts'
  _st_rule_i_log "$st_d/main-rule-i-4242.log" 1 'alpha@packages/a/src/one.ts'
  _st_expect "a NEW symbol present on every PR check-run is still a genuine failure" 1 "$st_d" \
    "NEW Rule I violation" "RESULT: FAIL. 1 genuine failure(s)."

  # ── F18: the PR edits the Rule I PRODUCER → 4 (FOLLOW-855 AC(4)) ───────────
  # The FOLLOW-842 shape. ci.yml checks out the PR ref, so the PR's Rule I job
  # runs the PR's scripts/check-rule-i.sh while main's baseline ran main's. The
  # two sides are different programs; every symbol the new extractor finds and
  # the old one missed would otherwise block the PR that is fixing the extractor.
  st_d="$(_st_fixture rule-i-producer-changed)"
  echo "[$st_lint_ok,$st_rule_i_entry]" > "$st_d/snapshot.json"
  printf 'scripts/check-rule-i.sh\nscripts/gh-pr-checks-verified.sh\n' > "$st_d/pr-files.txt"
  _st_rule_i_log "$st_d/pr-rule-i-9.log" 2 'alpha@packages/a/src/one.ts' 'gamma@packages/a/src/three.ts'
  _st_rule_i_log "$st_d/main-rule-i-4242.log" 1 'alpha@packages/a/src/one.ts'
  _st_expect "a PR that edits the Rule I extractor is not blocked by its own new symbols" 4 "$st_d" \
    "modifies scripts/check-rule-i.sh" "RESULT: NOT ATTRIBUTABLE"

  # ── F19: THE BASELINE FLIP (RETRO-250 §6 P-35 clause (b)) ──────────────────
  # Byte-identical PR side to F13. The ONLY difference is that main's baseline
  # run now carries `gamma` — i.e. the other PR that introduced it has since been
  # merged and a main run has completed on it. Same PR, same head, opposite
  # verdict: 4 -> 0. That is the non-determinism the pattern's promotion bar was
  # missing, driven through the real code path rather than argued. (Synthesized
  # per Rule AM: the live equivalent needs a merge, which a worker must not do.)
  st_d="$(_st_fixture baseline-flip)"
  echo "[$st_lint_ok,$st_rule_i_entry,$st_rule_i_dup]" > "$st_d/snapshot.json"
  _st_rule_i_log "$st_d/pr-rule-i-9.log" 1 'alpha@packages/a/src/one.ts'
  _st_rule_i_log "$st_d/pr-rule-i-10.log" 2 'alpha@packages/a/src/one.ts' 'gamma@packages/a/src/three.ts'
  _st_rule_i_log "$st_d/main-rule-i-4242.log" 2 'alpha@packages/a/src/one.ts' 'gamma@packages/a/src/three.ts'
  _st_expect "the same PR flips 4 -> 0 when main's baseline catches up" 0 "$st_d" \
    "pre-existing-red"

  # ── F20: a GREEN branch-head run is read too ──────────────────────────────
  # The failing list contains only the merge-ref check-run, so a gate that reads
  # only failing check-runs sees ONE run, has no intersection to compute, and
  # attributes `gamma` to the PR. Reading Rule I check-runs at every state is
  # what makes the branch head's EMPTY symbol set available as evidence.
  st_rule_i_green='{"name":"Rule I — wired-or-dead check","state":"SUCCESS","url":"'"$st_job_url"'/8"}'
  st_d="$(_st_fixture rule-i-green-branch-head)"
  echo "[$st_lint_ok,$st_rule_i_green,$st_rule_i_entry]" > "$st_d/snapshot.json"
  _st_rule_i_log "$st_d/pr-rule-i-8.log" 0
  _st_rule_i_log "$st_d/pr-rule-i-9.log" 1 'gamma@packages/a/src/three.ts'
  _st_rule_i_log "$st_d/main-rule-i-4242.log" 0
  _st_expect "a green branch-head Rule I run counts as evidence, so the merge-ref symbol is main's" 4 "$st_d" \
    "REASON: main moved under this PR." "RESULT: NOT ATTRIBUTABLE"

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

  # ── F21: a Rule I job that FAILED CLOSED must not read as a clean zero ────
  # The cross-script contract, driven from the consumer side. Post-FOLLOW-842 the
  # producer exits 3 and prints NO "Violations found" line when it cannot render a
  # verdict — but its diagnostic PROSE quotes that phrase, verbatim, to explain what
  # it is refusing to print. The log body below is byte-for-byte what the real
  # scripts/check-rule-i.sh emits with a non-PCRE grep on PATH (captured, not
  # invented). Unanchored, the count parser read '0' out of line 7, which trips
  # neither the empty-count guard nor the count-without-symbols guard, compares an
  # EMPTY symbol set against main's baseline, and accepts it: exit 0 over a Rule I
  # job that never ran. The gate must call this an unparseable log instead.
  st_d="$(_st_fixture rule-i-failed-closed)"
  echo "[$st_lint_ok,$st_rule_i_entry]" > "$st_d/snapshot.json"
  {
    echo "2026-08-06T09:00:00.1234567Z ERROR: PREFLIGHT FAILED — this 'grep' cannot run the symbol extractor."
    echo "2026-08-06T09:00:00.1234568Z   Probe 'export const alphaProbe = 1' | grep -oP ...\\K... returned"
    echo "2026-08-06T09:00:00.1234569Z   '', expected 'alphaProbe'. PCRE (-P) with \\K is a GNU grep"
    echo "2026-08-06T09:00:00.1234570Z   Without it EVERY symbol extraction returns nothing, and because this"
    echo "2026-08-06T09:00:00.1234571Z   script runs without 'set -e' the result would be 'Violations found: 0'"
    echo "2026-08-06T09:00:00.1234572Z   and 'Rule I passed' over a repo full of dead exports."
  } > "$st_d/pr-rule-i-9.log"
  _st_rule_i_log "$st_d/main-rule-i-4242.log" 1 'alpha@packages/a/src/one.ts'
  _st_expect "a failed-closed Rule I log is unparseable, not a clean zero" 3 "$st_d" \
    "no 'Violations found' line" "RESULT: UNDETERMINED"

  # ── F22: a rollup BORN SMALL is not a settled rollup → 3 ──────────────────
  # The literal shape observed live on PR #686 during ESC-050, twice: five
  # all-SUCCESS check-runs, stable from the first poll, in a repo whose PRs
  # register ~77. Nothing in the pre-FOLLOW-865 gate could see it — the set never
  # changed, nothing was pending, and 5 = 5+0+0+0 satisfies the arithmetic guard —
  # so it printed "all checks green. Safe to mark READY_FOR_REVIEW" and exited 0.
  # Only the DERIVED floor catches this one: the count never shrinks, so a
  # shrink-detector sees nothing either.
  st_d="$(_st_fixture cardinality-born-small)"
  _st_peers "$st_d" 12 77
  _st_checks 5 SUCCESS > "$st_d/snapshot.json"
  _st_expect "a five-check rollup in a 77-check repo is UNDETERMINED, not green" 3 "$st_d" \
    "TRUNCATED CHECK-RUN ROLLUP" "RESULT: UNDETERMINED"

  # ── F23: a rollup that COLLAPSES between polls → 3 ────────────────────────
  # The outage signature itself (74 -> 5). Needs the sequenced seam: with one
  # static file no fixture can express a check-run set that changes shape between
  # polls, which is why the settle loop had no fixtures at all (RETRO-252).
  st_d="$(_st_fixture cardinality-collapse)"
  _st_peers "$st_d" 12 77
  _st_checks 77 SUCCESS > "$st_d/snapshot.1.json"
  _st_checks 5 SUCCESS > "$st_d/snapshot.2.json"
  _st_expect "a rollup that collapses 77 -> 5 mid-poll is UNDETERMINED, not green" 3 "$st_d" \
    "TRUNCATED CHECK-RUN ROLLUP" "largest seen this run: 77"

  # ── F28: a PARTIAL collapse, above the derived floor → 3 ─────────────────
  # 77 -> 40 in a repo whose floor is 31. The derived floor accepts 40, so this
  # fixture pins the OTHER half of the guard and only that half: a rollup is
  # never allowed to settle smaller than the largest this same run already saw.
  # Without it, an incident that takes out one of a PR's two workflow runs
  # mid-poll settles green over half a check set.
  st_d="$(_st_fixture cardinality-partial-collapse)"
  _st_peers "$st_d" 12 77
  _st_checks 77 SUCCESS > "$st_d/snapshot.1.json"
  _st_checks 40 SUCCESS > "$st_d/snapshot.2.json"
  _st_expect "a partial collapse ABOVE the derived floor still refuses to settle" 3 "$st_d" \
    "observed: 40 check-run(s)" "RESULT: UNDETERMINED"

  # ── F24: the floor keeps the gate polling until the rest registers → 1 ────
  # FOLLOW-848 AC(1)'s shape: a FAILURE that appears only on the THIRD read. The
  # first two reads are stable, non-pending and two checks wide — which is exactly
  # what the pre-FOLLOW-865 gate settled on, exit 0, "all checks green", while the
  # failing check had not been created yet. The floor (4, from an 8-check peer
  # sample) is what makes the gate keep looking.
  st_d="$(_st_fixture cardinality-growth)"
  _st_peers "$st_d" 12 8
  st_extra_ok='{"name":"Build","state":"SUCCESS","url":"'"$st_job_url"'/3"},'
  st_extra_ok+='{"name":"Test","state":"SUCCESS","url":"'"$st_job_url"'/4"}'
  echo "[$st_lint_ok,$st_tc_ok]" > "$st_d/snapshot.1.json"
  cp "$st_d/snapshot.1.json" "$st_d/snapshot.2.json"
  echo "[$st_lint_ok,$st_tc_bad,$st_extra_ok]" > "$st_d/snapshot.3.json"
  cp "$st_d/snapshot.3.json" "$st_d/snapshot.4.json"
  ST_MAX_WAIT=5
  _st_expect "a failure that registers on the third read is not outrun by the settle loop" 1 "$st_d" \
    "not on the documented pre-existing-red list"
  unset ST_MAX_WAIT

  # ── F25: a FAILURE on the THIRD read, behind a CHANGING snapshot → 1 ──────
  # The first fixture this file has ever had for the two-consecutive-snapshot
  # mechanism itself (FOLLOW-848 AC(1)). RETRO-252 deleted the
  # `"$snapshot" == "$prev_snapshot"` condition — the whole reason this script
  # exists, reducing the loop to `--watch`'s own semantics — and every one of the
  # then-20 fixtures still passed.
  #
  # The shape matters. A fixture whose reads merely DIFFER does not discriminate:
  # the surviving `-n "$prev_snapshot"` guard already forces a second poll, so a
  # failure appearing on read 2 is caught either way (measured — the first cut of
  # this fixture did exactly that and the perturbed build passed it). What the
  # equality condition and only the equality condition buys is the read AFTER a
  # change: here read 2 is green but DIFFERENT from read 1, so a build with the
  # comparison settles on read 2, prints "all checks green" and exits 0, while
  # the real one keeps polling and finds the FAILURE that registers on read 3.
  st_d="$(_st_fixture settle-third-read-failure)"
  st_build_ok='{"name":"Build","state":"SUCCESS","url":"'"$st_job_url"'/3"}'
  echo "[$st_lint_ok,$st_tc_ok]" > "$st_d/snapshot.1.json"
  echo "[$st_lint_ok,$st_tc_ok,$st_build_ok]" > "$st_d/snapshot.2.json"
  echo "[$st_lint_ok,$st_tc_bad,$st_build_ok]" > "$st_d/snapshot.3.json"
  cp "$st_d/snapshot.3.json" "$st_d/snapshot.4.json"
  ST_MAX_WAIT=5
  _st_expect "a failure on the third read is not settled away by a merely-changed second read" 1 "$st_d" \
    "not on the documented pre-existing-red list"
  unset ST_MAX_WAIT

  # ── F26: the floor is refusable by name, never silently → 0 ──────────────
  # AC(5): the failure direction must not be a permanent block. A genuinely small
  # run is passable, but only by stating the observed count, and the waiver then
  # rides every RESULT line so a transcript cannot be pasted without it.
  st_d="$(_st_fixture cardinality-override)"
  _st_peers "$st_d" 12 77
  _st_checks 5 SUCCESS > "$st_d/snapshot.json"
  ST_EXTRA_ARGS=(--accept-cardinality 5)
  _st_expect "a stated --accept-cardinality waives the floor and says so on the RESULT line" 0 "$st_d" \
    "CARDINALITY OVERRIDE" "RESULT: all checks green."
  ST_EXTRA_ARGS=()

  # ── F27: an unreadable peer sample renders NO verdict → 3 ────────────────
  # No floor means no way to tell a truncated rollup from a complete one, and a
  # gate that cannot tell must not guess in the green direction.
  st_d="$(_st_fixture cardinality-no-sample)"
  rm -f "$st_d/peer-cardinality.txt"
  echo "[$st_lint_ok,$st_tc_ok]" > "$st_d/snapshot.json"
  _st_expect "an unreadable peer cardinality sample is UNDETERMINED, not green" 3 "$st_d" \
    "peer check-run cardinality sample" "RESULT: UNDETERMINED"

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

  # ── the PARSER still matches what the PROJECTION emits (FOLLOW-856) ────────
  # The fixture seam supplies snapshot.json directly, so no fixture above ever
  # runs the jq projection — which means no fixture can observe the two sides
  # drifting apart. This assertion can: it builds one object from SNAPSHOT_FIELDS
  # in jq's own key order and requires FAILURE_REGEX to match a failure-class
  # state and to REFUSE a success one. Pin the regex to a literal, or add a
  # field to the projection alone, and this goes red.
  st_obj_fail='{'
  st_obj_ok='{'
  st_sep=''
  for st_f in "${SNAPSHOT_FIELDS[@]}"; do
    st_k="${st_f%%:*}"
    case "$st_k" in
      state)
        st_obj_fail+="$st_sep\"state\":\"FAILURE\""
        st_obj_ok+="$st_sep\"state\":\"SUCCESS\""
        ;;
      *)
        st_obj_fail+="$st_sep\"$st_k\":\"x\""
        st_obj_ok+="$st_sep\"$st_k\":\"x\""
        ;;
    esac
    st_sep=','
  done
  st_obj_fail+='}'
  st_obj_ok+='}'
  if printf '%s' "$st_obj_fail" | grep -qP "$FAILURE_REGEX" \
    && ! printf '%s' "$st_obj_ok" | grep -qP "$FAILURE_REGEX"; then
    st_passes=$((st_passes + 1))
    echo "OK: self-test PASSED — the failing-check regex matches what SNAPSHOT_FIELDS emits"
  else
    st_failures=$((st_failures + 1))
    echo "SELF-TEST FAIL: the failing-check regex and the jq projection have drifted apart."
    echo "  projection would emit: $st_obj_fail"
    echo "  regex in use:          $FAILURE_REGEX"
    echo "  A regex that does not match the projection returns an EMPTY failing list, and"
    echo "  this script runs without 'set -e' — that is a false green (FOLLOW-856)."
  fi

  # ── the fixture COUNT is itself an assertion (RETRO-250 CB-3) ──────────────
  if [[ "$st_expect_ran" -eq "$ST_EXPECTED_FIXTURES" ]]; then
    st_passes=$((st_passes + 1))
    echo "OK: self-test PASSED — all $ST_EXPECTED_FIXTURES declared fixtures were executed"
  else
    st_failures=$((st_failures + 1))
    echo "SELF-TEST FAIL: $st_expect_ran fixture(s) executed, expected $ST_EXPECTED_FIXTURES."
    echo "  A fixture stopped being reached, or one was added without bumping"
    echo "  ST_EXPECTED_FIXTURES. Either way the harness is no longer testing what it claims."
  fi

  echo ""
  if [[ "$st_failures" -gt 0 ]]; then
    echo "RESULT: --self-test FAILED — $st_failures fixture(s) failed, $st_passes passed."
    exit 1
  fi
  echo "RESULT: --self-test passed — $st_passes fixtures ($st_expect_ran gate fixtures + meta-assertions)."
  exit 0
fi

usage() {
  echo "Usage: $0 <pr-number> [--max-wait-seconds N] [--interval-seconds N]" >&2
  echo "                      [--accept-cardinality N]" >&2
  echo "       $0 --self-test" >&2
  echo "" >&2
  echo "  --accept-cardinality N   Waive the completeness floor for a rollup of EXACTLY N" >&2
  echo "                           check-runs. N must equal the count the gate actually" >&2
  echo "                           observes, so the waiver cannot be set once and left to" >&2
  echo "                           apply to a different run. Every RESULT line then carries" >&2
  echo "                           a [CARDINALITY OVERRIDE] prefix." >&2
  exit 3
}

[[ $# -ge 1 ]] || usage
PR="$1"
shift

MAX_WAIT=900
INTERVAL=15
ACCEPT_CARDINALITY=""
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
    --accept-cardinality)
      ACCEPT_CARDINALITY="${2:-}"
      if [[ ! "$ACCEPT_CARDINALITY" =~ ^[0-9]+$ ]]; then
        echo "ERROR: --accept-cardinality takes the exact number of check-runs you have" >&2
        echo "  seen registered on this PR. Got: '${ACCEPT_CARDINALITY:-<missing>}'." >&2
        exit 3
      fi
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


echo "=== gh-pr-checks-verified.sh — PR #$PR ($REPO) ==="
echo "Polling until two consecutive identical, fully-settled snapshots are observed,"
echo "carrying at least as many check-runs as this repo's own recent PRs registered."
echo "(The first condition defeats the late-registered-check-run race that made '--watch'"
echo " exit 0 on PR #668 while Rule I was still failing. The second defeats the same race's"
echo " other half: a rollup that is stable because it is TRUNCATED — FOLLOW-865.)"
echo ""

derive_cardinality_floor
echo "Completeness floor: ${CARDINALITY_FLOOR} check-run(s) — ${CARDINALITY_FLOOR_PERCENT}% of ${CARDINALITY_REFERENCE},"
echo "  the second-highest of ${CARDINALITY_SAMPLES} recent-PR rollup size(s) read from this repo."
if [[ -n "$ACCEPT_CARDINALITY" ]]; then
  echo "  --accept-cardinality ${ACCEPT_CARDINALITY} is set: a rollup of EXACTLY that size will be"
  echo "  accepted despite the floor, and every RESULT line will say so."
fi
echo ""

prev_snapshot=""
elapsed=0
settled_snapshot=""
max_seen=0
cardinality_ok=0
override_applied=0
poll_index=0

while :; do
  poll_index=$((poll_index + 1))
  snapshot="$(fetch_snapshot "$poll_index")"
  if [[ -z "$snapshot" ]]; then
    echo "ERROR: 'gh pr view' failed for PR #$PR" >&2
    exit 3
  fi

  if [[ "$snapshot" == "[]" ]]; then
    pending_count=1 # no checks registered yet — never treat as settled
  else
    pending_count=$(printf '%s' "$snapshot" | grep -o '"state":"PENDING"' | wc -l | tr -d ' ')
  fi

  known=$(printf '%s' "$snapshot" | grep -o '"name":' | wc -l | tr -d ' ')

  # The effective floor is the higher of the derived one and the largest rollup
  # THIS RUN has already seen. The second half costs nothing and catches the
  # collapse signature directly (74 -> 5 during the ESC-050 outage): a rollup
  # that shrinks is never a rollup that finished registering. It does not
  # subsume the derived floor — it cannot see a rollup that was born small,
  # which is the shape PR #686 actually presented — and the derived floor does
  # not subsume it either, so both are kept.
  [[ "$known" -le "$max_seen" ]] || max_seen="$known"
  required="$CARDINALITY_FLOOR"
  [[ "$max_seen" -le "$required" ]] || required="$max_seen"

  cardinality_ok=1
  override_applied=0
  if [[ "$known" -lt "$required" ]]; then
    cardinality_ok=0
    if [[ -n "$ACCEPT_CARDINALITY" && "$known" -eq "$ACCEPT_CARDINALITY" ]]; then
      cardinality_ok=1
      override_applied=1
    fi
  fi

  poll_note=""
  [[ "$cardinality_ok" -eq 1 ]] || poll_note=" — BELOW the completeness floor of $required, refusing to settle"
  [[ "$override_applied" -eq 0 ]] || poll_note=" — below the floor of $required, ACCEPTED by --accept-cardinality"
  echo "[t=${elapsed}s] checks known: ${known}, pending: ${pending_count}${poll_note}"

  if [[ "$pending_count" -eq 0 && "$cardinality_ok" -eq 1 && -n "$prev_snapshot" && "$snapshot" == "$prev_snapshot" ]]; then
    settled_snapshot="$snapshot"
    break
  fi

  prev_snapshot="$snapshot"

  if [[ "$elapsed" -ge "$MAX_WAIT" ]]; then
    # Two different things can exhaust the wait, and they are not the same
    # verdict. Checks still PENDING is a genuine timeout: the run had not
    # finished, waiting longer is the remedy, exit 2. A rollup that is stable,
    # complete-looking and TOO SMALL is not a timeout — waiting longer returns
    # the identical answer — it is the gate failing to obtain the object it
    # needs in order to judge anything, so it is a TOOLING failure, exit 3.
    #
    # Exit 3 and not 2 (FOLLOW-865 AC(2)): the contract at the top of this file
    # says 2 = TIMEOUT ("still moving, come back") and 3 = "the gate did not get
    # to look", renders NO verdict, must not consume a worker's retry budget.
    # A truncated rollup is precisely the second: nothing about the PR is known,
    # and nothing the worker does changes it. Exit 1 would be actively wrong —
    # it routes the ticket back to a worker for an Actions incident — and exit 0
    # is the false green this guard exists to remove.
    if [[ "$pending_count" -eq 0 && "$cardinality_ok" -ne 1 ]]; then
      echo "" >&2
      echo "ERROR: TRUNCATED CHECK-RUN ROLLUP — the check set never became complete." >&2
      echo "  observed: ${known} check-run(s), stable and non-pending" >&2
      echo "  expected: at least ${required} (derived floor ${CARDINALITY_FLOOR} = ${CARDINALITY_FLOOR_PERCENT}% of ${CARDINALITY_REFERENCE}," >&2
      echo "            the second-highest of ${CARDINALITY_SAMPLES} recent-PR rollups; largest seen this run: ${max_seen})" >&2
      echo "  A rollup this far below what this repo's own PRs register has NOT finished" >&2
      echo "  registering — it is not a PR with few checks. Two consecutive identical" >&2
      echo "  snapshots prove the set stopped CHANGING; they prove nothing about whether it" >&2
      echo "  is COMPLETE, and a truncated snapshot is internally consistent, so the" >&2
      echo "  arithmetic guard below cannot see it either (FOLLOW-865)." >&2
      echo "  This is what an Actions incident looks like from here (ESC-050: recovery" >&2
      echo "  reruns collapsed PR #686's rollup from ~74 to 5, twice)." >&2
      echo "  Re-run once the workflows have re-registered. If this PR genuinely registers" >&2
      echo "  only ${known} check-runs, say so explicitly: --accept-cardinality ${known}." >&2
      echo "  Last snapshot:" >&2
      echo "$snapshot" >&2
      echo ""
      echo "${FIXTURE_TAG}RESULT: UNDETERMINED (exit 3). NOT a green light and NOT a verdict on"
      echo "  this PR: the checks have not registered, so the gate never got to look at a"
      echo "  complete check set. Do not mark READY_FOR_REVIEW, and do not increment"
      echo "  fix_iteration_counter — no worker can fix this."
      exit 3
    fi
    echo "" >&2
    echo "TIMEOUT after ${elapsed}s waiting for checks to settle. Last snapshot:" >&2
    echo "$snapshot" >&2
    exit 2
  fi

  sleep "$INTERVAL"
  elapsed=$((elapsed + INTERVAL))
done

echo ""
echo "Settled after ${elapsed}s (two consecutive identical, fully-completed snapshots"
echo "of ${known} check-run(s), against a completeness floor of ${CARDINALITY_FLOOR})."
if [[ "$override_applied" -eq 1 ]]; then
  FIXTURE_TAG="${FIXTURE_TAG}[CARDINALITY OVERRIDE — ${known} check-runs accepted below the floor of ${CARDINALITY_FLOOR}] "
  echo ""
  echo "WARNING: the completeness floor was WAIVED by --accept-cardinality ${ACCEPT_CARDINALITY}."
  echo "  This rollup carries fewer check-runs than this repo's recent PRs registered. The"
  echo "  verdict below is only as good as that waiver: if the checks were merely late or"
  echo "  an incident truncated them, it is a verdict about a run that did not happen."
  echo "  Every RESULT line below is prefixed accordingly, so this cannot be pasted as"
  echo "  evidence without the waiver being visible."
fi
echo ""

# Re-assert counts from the settled snapshot (never from an exit code).
total=$(printf '%s' "$settled_snapshot" | grep -o '"name":' | wc -l | tr -d ' ')
success=$(printf '%s' "$settled_snapshot" | grep -o '"state":"SUCCESS"' | wc -l | tr -d ' ')
skipped=$(printf '%s' "$settled_snapshot" | grep -o '"state":"SKIPPED"' | wc -l | tr -d ' ')
neutral=$(printf '%s' "$settled_snapshot" | grep -o '"state":"NEUTRAL"' | wc -l | tr -d ' ')

# The failing list. FAILURE_REGEX is DERIVED from SNAPSHOT_FIELDS (see the
# SNAPSHOT SERIALIZATION CONTRACT above) rather than copied from it.
mapfile -t failure_names < <(
  printf '%s' "$settled_snapshot" | grep -oP "$FAILURE_REGEX"
)

echo "Total checks: $total | success: $success | skipped: $skipped | neutral: $neutral | failing: ${#failure_names[@]}"
echo ""

# ── ARITHMETIC SELF-CONSISTENCY (FOLLOW-856 AC(1)) ────────────────────────────
# The four counts above come from four independent `grep -o | wc -l` passes; the
# failing LIST comes from a fifth, structural pass. Nothing used to compare them,
# so a serialization the fifth pass does not match produced "failing: 0" beside a
# total that could not possibly be 0 — and a green verdict over FAILURE
# check-runs. This is the same discipline this file already applies to its other
# parse (the Rule I "count says N but zero symbols parsed" guard below): when two
# independent reads of the same bytes disagree, the parse is wrong, and a wrong
# parse is a TOOLING failure — exit 3 — never a green and never a verdict on the
# PR. Exit 1 would be actively harmful: it routes to sending the ticket back to a
# worker who cannot fix this script's regex.
accounted=$((success + skipped + neutral + ${#failure_names[@]}))
if [[ "$accounted" -ne "$total" ]]; then
  echo "ERROR: SNAPSHOT SERIALIZATION MISMATCH — this gate cannot parse its own input." >&2
  echo "  $success success + $skipped skipped + $neutral neutral + ${#failure_names[@]} failing" >&2
  echo "  = $accounted, but $total check-run(s) are present. Those two numbers are read from" >&2
  echo "  the same bytes by independent passes; when they disagree the failing list is" >&2
  echo "  wrong, and an under-counted failing list is a FALSE GREEN." >&2
  echo "  Failing-check regex in use (derived from SNAPSHOT_FIELDS):" >&2
  echo "    $FAILURE_REGEX" >&2
  echo "  Snapshot as read (first 2000 chars):" >&2
  printf '    %.2000s\n' "$settled_snapshot" >&2
  echo "  Likely cause: SNAPSHOT_FIELDS / gh / jq now serialize check-runs in a shape the" >&2
  echo "  regex above does not match. Fix the projection or the derivation — do not relax" >&2
  echo "  this guard." >&2
  echo ""
  echo "${FIXTURE_TAG}RESULT: UNDETERMINED (exit 3). NOT a green light and NOT a verdict on"
  echo "  this PR: the gate could not parse its own snapshot. Do not mark READY_FOR_REVIEW,"
  echo "  and do not increment fix_iteration_counter — no worker can fix this."
  exit 3
fi

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
# Things that are neither the PR's fault nor a gate malfunction: a violation
# symbol the gate cannot ATTRIBUTE to this PR's own content, because main moved
# under it or because the PR changed the extractor that produced one of the two
# sides. Exit 4 (FOLLOW-855 AC(1)).
not_attributable=()

# Memoized answer to "does this PR edit the Rule I producer?" — "" unknown,
# "yes"/"no" resolved, "err" the read itself failed.
PR_TOUCHES_PRODUCER=""
pr_touches_rule_i_producer() {
  [[ -z "$PR_TOUCHES_PRODUCER" ]] || return 0
  local files
  if ! files="$(fetch_pr_files 2>/dev/null)"; then
    PR_TOUCHES_PRODUCER="err"
    return 0
  fi
  if printf '%s\n' "$files" | grep -qxF "$RULE_I_PRODUCER"; then
    PR_TOUCHES_PRODUCER="yes"
  else
    PR_TOUCHES_PRODUCER="no"
  fi
}

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

  # ── PR side: EVERY check-run carrying this name, at ANY state ──────────────
  # Not just the failing ones. The `push` run (branch head) and the
  # `pull_request` run (merge ref) are DIFFERENT COMMITS, and their disagreement
  # is the only evidence this gate has about which side a symbol came from
  # (FOLLOW-855). A branch-head run that is GREEN has an empty symbol set, and
  # that emptiness is precisely what proves a merge-ref-only symbol is main's.
  # Reading only the failing runs would make that case invisible.
  mapfile -t rule_i_urls < <(
    printf '%s' "$settled_snapshot" | grep -oP "$RULE_I_REGEX" \
      | grep -oP '"url":"\K[^"]*' | LC_ALL=C sort -u
  )
  run_n="${#rule_i_urls[@]}"
  if [[ "$run_n" -gt 1 ]]; then
    echo "'$name' has $run_n check-runs on this PR ($dup_n of them failing) — the push event"
    echo "  (branch head) and the pull_request event (merge ref) are different commits. Reading"
    echo "  all of them: their UNION is compared against main, and any symbol missing from"
    echo "  their INTERSECTION is not stably this PR's (FOLLOW-855)."
  fi

  : > "$tmp_dir/pr.syms.all"
  pr_ok=1
  pr_counts=""
  read_jids=()
  provenance_incomplete=0
  for one_url in "${rule_i_urls[@]}"; do
    [[ -n "$one_url" ]] || continue
    # A check-run of this name that is NOT in the failing list is a run the gate
    # would previously never have read. It cannot be a blocking failure, so an
    # unreadable one degrades to "left out of the provenance set" (loudly) rather
    # than to a tooling failure that would take a whole verdict down.
    optional=1
    printf '%s\n' "$urls" | grep -qxF "$one_url" && optional=0

    jid="$(printf '%s' "$one_url" | grep -oP '/job/\K[0-9]+')"
    if [[ -z "$jid" ]]; then
      if [[ "$optional" -eq 1 ]]; then
        echo "WARN: could not extract a job id from non-failing Rule I check url '$one_url'"
        echo "      — excluded from the provenance set."
        provenance_incomplete=1
        continue
      fi
      echo "WARN: could not extract a job id from Rule I check url '$one_url'."
      tooling_failures+=("$name — job id unresolvable from check url '$one_url'")
      pr_ok=0
      continue
    fi

    if ! fetch_job_log "$jid" "pr-rule-i-$jid.log" > "$tmp_dir/pr-$jid.log" 2> "$tmp_dir/pr-$jid.err"; then
      diag="$(classify_fetch_error "$tmp_dir/pr-$jid.err" "$jid")"
      if [[ "$optional" -eq 1 ]]; then
        echo "WARN: could not FETCH a non-failing Rule I job log (job $jid) — $diag; excluded"
        echo "      from the provenance set, so attribution below is less able to tell a"
        echo "      merge-ref-only symbol from one this PR really introduced."
        provenance_incomplete=1
        continue
      fi
      echo "WARN: could not FETCH the PR's Rule I job log (job $jid) — $diag."
      tooling_failures+=("$name — could not FETCH the PR's Rule I job log (job $jid): $diag")
      pr_ok=0
      continue
    fi

    one_count="$(rule_i_count_from_log < "$tmp_dir/pr-$jid.log")"
    if [[ -z "$one_count" ]]; then
      if [[ "$optional" -eq 1 ]]; then
        echo "WARN: a non-failing Rule I log (job $jid) has no 'Violations found: N' line —"
        echo "      excluded from the provenance set."
        provenance_incomplete=1
        continue
      fi
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
    read_jids+=("$jid")
    cat "$tmp_dir/pr-$jid.syms" >> "$tmp_dir/pr.syms.all"
  done

  [[ "$pr_ok" -eq 1 ]] || continue

  if [[ "${#read_jids[@]}" -eq 0 ]]; then
    tooling_failures+=("$name — no Rule I check-run on this PR could be read at all")
    continue
  fi

  LC_ALL=C sort -u "$tmp_dir/pr.syms.all" > "$tmp_dir/pr.syms"
  pr_symbols="$(wc -l < "$tmp_dir/pr.syms" | tr -d ' ')"

  # ── PROVENANCE: the INTERSECTION of the PR's own runs ──────────────────────
  # A symbol on every one of the PR's Rule I runs is on the branch content
  # whatever main is doing. A symbol on only some of them exists on one commit
  # and not another, and the only difference between those commits is main's
  # newer content. With a single readable run the intersection collapses to the
  # union and the behaviour is exactly what shipped before this change.
  cp "$tmp_dir/pr-${read_jids[0]}.syms" "$tmp_dir/pr.common"
  for jid in "${read_jids[@]:1}"; do
    LC_ALL=C comm -12 "$tmp_dir/pr.common" "$tmp_dir/pr-$jid.syms" > "$tmp_dir/pr.common.next"
    mv "$tmp_dir/pr.common.next" "$tmp_dir/pr.common"
  done

  # ── main baseline ─────────────────────────────────────────────────────────
  if ! resolve_rule_i_baseline; then
    tooling_failures+=("$name — no usable Rule I baseline on main within the last $BASELINE_LOOKBACK ci.yml run(s); see the walk above")
    continue
  fi

  # ── the comparison (SET, not count) ───────────────────────────────────────
  LC_ALL=C comm -23 "$tmp_dir/pr.syms" "$tmp_dir/main.syms" > "$tmp_dir/new.syms"
  LC_ALL=C comm -13 "$tmp_dir/pr.syms" "$tmp_dir/main.syms" > "$tmp_dir/fixed.syms"
  new_symbols="$(wc -l < "$tmp_dir/new.syms" | tr -d ' ')"
  fixed_symbols="$(wc -l < "$tmp_dir/fixed.syms" | tr -d ' ')"

  echo "Rule I symbol-set comparison: PR has $pr_symbols violating symbol(s) (count line(s):"
  echo "  $pr_counts), main baseline has $BASELINE_SYMBOLS (count line: $BASELINE_VIOLATIONS)."
  echo "  New on this PR: $new_symbols | fixed by this PR: $fixed_symbols"

  if [[ "$new_symbols" -eq 0 ]]; then
    accepted_failures+=("$name — pre-existing-red: all $pr_symbols violating symbol(s) are also in main's baseline (run $BASELINE_RUN_ID); $fixed_symbols fixed by this PR")
    continue
  fi

  # ── ATTRIBUTION (FOLLOW-855) ──────────────────────────────────────────────
  # A NEW symbol is only this PR's if the gate can attribute it to the PR's own
  # content. Two things break attribution, and both are the SAME defect seen from
  # different sides: the two symbol sets being compared were produced from
  # different inputs, or by different programs.
  #
  #  (a) main moved under the PR. The PR side is the UNION of the branch-head run
  #      and the merge-ref run; the baseline is ONE older main run. A dead export
  #      that a DIFFERENT PR merged into main after that baseline ran is in the
  #      merge-ref log, in neither the branch-head log nor the baseline — and was
  #      attributed to this PR, exit 1, "GENUINE FAILURES (blocking)", against a
  #      worker who cannot delete it. PR #683 introduced the union deliberately
  #      and argued it correctly; what it did not do was widen the other side.
  #      The fix is not to shrink the union (that would silently pick the
  #      friendlier of two commits) but to SPLIT it: symbols on every one of the
  #      PR's runs stay this PR's, symbols on only some of them are named, shown,
  #      and routed to exit 4.
  #  (b) the PR edits the Rule I PRODUCER. ci.yml checks out the PR ref, so the
  #      PR's Rule I job runs the PR's scripts/check-rule-i.sh while the baseline
  #      ran main's. Every symbol the new extractor finds and the old one missed
  #      then looks new, and such a PR blocks itself. FOLLOW-842 is exactly this
  #      shape.
  attribution=""
  pr_touches_rule_i_producer
  case "$PR_TOUCHES_PRODUCER" in
    err)
      echo "WARN: could not read this PR's changed-file list, so the gate cannot tell whether"
      echo "      it edits $RULE_I_PRODUCER — the program that produced one side of this"
      echo "      comparison. Refusing to guess."
      tooling_failures+=("$name — could not read the PR's changed-file list to check whether it edits $RULE_I_PRODUCER")
      continue
      ;;
    yes) attribution="producer-changed" ;;
  esac

  if [[ "$attribution" == "producer-changed" ]]; then
    : > "$tmp_dir/new.attributable.syms"
    cp "$tmp_dir/new.syms" "$tmp_dir/new.unattributable.syms"
  else
    LC_ALL=C comm -12 "$tmp_dir/new.syms" "$tmp_dir/pr.common" > "$tmp_dir/new.attributable.syms"
    LC_ALL=C comm -23 "$tmp_dir/new.syms" "$tmp_dir/pr.common" > "$tmp_dir/new.unattributable.syms"
  fi
  new_attributable="$(wc -l < "$tmp_dir/new.attributable.syms" | tr -d ' ')"
  new_unattributable="$(wc -l < "$tmp_dir/new.unattributable.syms" | tr -d ' ')"

  if [[ "$new_attributable" -gt 0 ]]; then
    echo ""
    echo "  NEW violating symbols (on this PR, absent from main's baseline):"
    head -20 "$tmp_dir/new.attributable.syms" | sed 's/^/    - /'
    if [[ "$new_attributable" -gt 20 ]]; then
      echo "    … and $((new_attributable - 20)) more"
    fi
    if [[ "$pr_counts" == "$BASELINE_VIOLATIONS" ]]; then
      echo ""
      echo "  NOTE: the two COUNTS are equal ($pr_counts). Only the symbol SETS differ —"
      echo "  this PR fixed $fixed_symbols violation(s) and introduced $new_attributable. A count"
      echo "  comparison would have accepted it and exited 0; that compensating-swap case is"
      echo "  what FOLLOW-821 AC(1) forbids by name and what FOLLOW-827 fixed here."
    fi
    genuine_failures+=("$name — $new_attributable NEW Rule I violation symbol(s) not in main's baseline (run $BASELINE_RUN_ID)")
  fi

  if [[ "$new_unattributable" -gt 0 ]]; then
    echo ""
    echo "  NOT ATTRIBUTABLE TO THIS PR — $new_unattributable symbol(s):"
    head -20 "$tmp_dir/new.unattributable.syms" | sed 's/^/    - /'
    if [[ "$new_unattributable" -gt 20 ]]; then
      echo "    … and $((new_unattributable - 20)) more"
    fi
    if [[ "$attribution" == "producer-changed" ]]; then
      echo "  REASON: this PR modifies $RULE_I_PRODUCER, the program that emits the symbol"
      echo "  lines on BOTH sides of this comparison. ci.yml checks out the PR ref, so the PR's"
      echo "  Rule I job ran the PR's extractor while main's baseline (run $BASELINE_RUN_ID) ran"
      echo "  main's. Symbols found by one and not the other are an extractor difference, not a"
      echo "  regression. Adjudicate them against the diff by hand, or land the extractor change"
      echo "  first and re-baseline."
      not_attributable+=("$name — $new_unattributable symbol(s) incomparable: this PR edits $RULE_I_PRODUCER, so the PR side and main's baseline (run $BASELINE_RUN_ID) were produced by different extractors")
    else
      echo "  REASON: main moved under this PR. These symbols are on SOME of this PR's Rule I"
      echo "  check-runs and not others — the push run is the branch head, the pull_request run"
      echo "  is the merge with main, and they are different commits. main's baseline is one"
      echo "  older run (run $BASELINE_RUN_ID), so a dead export another PR merged after that"
      echo "  run is in the merge ref, in neither the branch head nor the baseline, and is NOT"
      echo "  this PR's to fix. Re-run once a newer main run has completed: the baseline walk"
      echo "  will then contain these symbols and this same PR will exit 0."
      not_attributable+=("$name — $new_unattributable symbol(s) present on only some of this PR's Rule I check-runs (branch head vs merge ref); main moved under this PR since baseline run $BASELINE_RUN_ID")
    fi
    if [[ "$provenance_incomplete" -eq 1 ]]; then
      echo "  CAVEAT: at least one of this PR's Rule I check-runs could not be read (see the"
      echo "  WARNs above), so this attribution was computed from an incomplete run set."
    fi
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
if [[ "${#not_attributable[@]}" -gt 0 ]]; then
  echo ""
  echo "NOT ATTRIBUTABLE TO THIS PR (the gate completed, but these are not this PR's to fix):"
  for f in "${not_attributable[@]}"; do
    echo "  - $f"
  done
fi

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

# Precedence 3 > 1 > 4 > 0: a gate that could not look outranks a red PR, a red
# PR outranks an unattributable symbol, and only a clean comparison is green.
if [[ "${#not_attributable[@]}" -gt 0 ]]; then
  echo ""
  echo "${FIXTURE_TAG}RESULT: NOT ATTRIBUTABLE (exit 4). This is NOT a green light — do not"
  echo "  mark READY_FOR_REVIEW — and it is NOT a red verdict on this PR either. The gate"
  echo "  completed its comparison and found ${#not_attributable[@]} finding(s) it cannot attribute to"
  echo "  this PR's own content (see the reasons above). Do NOT send the ticket back to its"
  echo "  worker and do NOT increment fix_iteration_counter: nobody on this ticket can delete"
  echo "  a dead export that another PR merged into main. Re-run once a newer main run has"
  echo "  completed, or adjudicate the named symbol(s) against this PR's diff by hand."
  exit 4
fi

echo ""
echo "${FIXTURE_TAG}RESULT: all failing checks are documented, dynamically-verified pre-existing-red. Safe to mark READY_FOR_REVIEW."
exit 0
