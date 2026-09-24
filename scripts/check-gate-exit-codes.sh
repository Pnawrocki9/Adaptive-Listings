#!/usr/bin/env bash
# check-gate-exit-codes.sh — the merge gate's exit-code contract and the corpus that
# routes on it must not drift apart [FOLLOW-854]
#
# WHY THIS EXISTS
#   PR #683 widened `scripts/gh-pr-checks-verified.sh`'s exit 3 from "usage-or-gh-error"
#   to "the gate could not run or could not complete its comparison", and added the
#   instruction that gives the change its value: do NOT increment fix_iteration_counter
#   against the worker for it. That reached docs/AGENT_WORKFLOW.md and CONVENTIONS_PATCH.md
#   Rule A. It did NOT reach `.claude/agents/pm-orchestrator.md`, which is the file the
#   decision-maker loads and executes, and which went on saying "3 = usage/gh error" in the
#   same paragraph as the retry cap it must not increment. CONVENTIONS_PATCH.md Rule AI
#   already ORDERS the tier-0 corpus to be updated first and even ships the greps; the rule
#   text was adequate and nothing ran it. This script runs it.
#
# WHAT IT ASSERTS
#   1. Every declared ROUTING consumer carries the contract marker line VERBATIM, with the
#      same codes and the same canonical tokens the gate itself declares. Add, remove or
#      re-mean an exit code in the gate and every routing consumer goes red until it is
#      edited in the same PR.
#   2. No file references the gate without being classified. A new consumer that routes on
#      exit codes cannot be silently omitted from list (1) — it has to be added to one of
#      the two lists here, which is a code review the omission would otherwise never get.
#
# WHAT IT DOES NOT ASSERT, stated plainly (Rule AQ)
#   A marker line cannot verify that the PROSE around it is accurate; prose is not
#   machine-checkable. What it guarantees is that no contract change can land without a
#   human editing every routing consumer, at which point the stale prose is on screen.
#   That is a forcing function, not a proof.
#
# PROOF OF EXECUTION (Rule Q): run as a step of the `pr-checks-gate-self-test` job in
# .github/workflows/ci.yml, on every push and PR. Hard gate.
#
# EXIT CODES
#   0  contract and corpus agree
#   1  at least one routing consumer is stale, or an unclassified consumer appeared
#   3  usage error, or the contract block could not be read out of the gate

set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root" || exit 3

GATE="scripts/gh-pr-checks-verified.sh"

# Files that ROUTE on the gate's exit code. Each must carry the marker line.
ROUTING_CONSUMERS=(
  "docs/AGENT_WORKFLOW.md"
  "CONVENTIONS_PATCH.md"
  ".claude/agents/pm-orchestrator.md"
  ".claude/agents/backend-engineer.md"
  ".claude/agents/data-engineer.md"
  ".claude/agents/ml-engineer.md"
  # Added by PR #797 (session 125), caught by this cross-check unprompted a FOURTH time: the
  # session-125 delegation brief tells its worker that `exit 0` is the pass criterion AND that
  # `exit 2` is a TIMEOUT it must not treat as a red check. That is routing on two codes, so the
  # file carries the marker rather than being exempted. Briefs are append-only, so the marker
  # governs what NEW briefs may claim; older ones are history, not live instructions.
  "backlog/HANDOFFS.md"
)

# Files that mention the gate but do NOT route on its exit codes. Each needs a reason,
# because "it does not route" is a claim that can rot.
declare -A NON_ROUTING=(
  ["$GATE"]="the gate itself — the source of the contract"
  ["scripts/check-gate-exit-codes.sh"]="this checker"
  # Added when PR #684 (FOLLOW-842) merged and this cross-check caught it unprompted:
  # check-rule-i.sh names the gate in its OUTPUT FORMAT CONTRACT header, but it is the
  # gate's PRODUCER, not a consumer — it never reads the gate's exit code. Its half of
  # that contract is pinned by the fixtures in gh-pr-checks-verified.sh --self-test, not
  # by the exit-code marker.
  ["scripts/check-rule-i.sh"]="the Rule I producer; names the gate for the log-format contract, routes on no exit code of it"
  # Added when PR #686 (FOLLOW-857) rebased onto #685 and this cross-check caught it
  # unprompted a second time: check-rule-h.sh names the gate once, in a comment citing
  # FOLLOW-830 as the first instance of the PCRE fail-open class it also closes. Weaker
  # than check-rule-i.sh's link — Rule H is not even a producer, nothing it prints is
  # parsed by the gate — so there is no exit code of the gate for it to route on.
  ["scripts/check-rule-h.sh"]="cites the gate once as a prior fail-open instance; neither produces a line it parses nor reads any exit code of it"
  # Added by PR #716 (FOLLOW-938), caught by this cross-check unprompted a THIRD time. Both files
  # cite the gate as EVIDENCE — "these two tickets closed on merge-sha plus gate exit 0 and were
  # deployed differently" — which is the observation the ticket exists for. Citing an exit code as
  # a historical fact is not routing on it: neither file branches on any outcome of the gate, and
  # the criterion they DO define routes on `/health`'s `version_id`, not on this script.
  ["docs/TICKET_FORMAT.md"]="cites gate exit 0 as evidence that merge-time closure lacked a deployment axis; routes on /health version_id, not on any exit code of the gate"
  ["docs/runbooks/DEPLOYMENT_SURFACES.md"]="same citation, as the motivating observation for the surface register; defines no branch on the gate's outcome"
  [".github/workflows/ci.yml"]="invokes --self-test only; never reads a PR verdict"
  ["CLAUDE.md"]="names the exit-0 precondition in prose; enumerates no other code and issues no routing instruction"
  [".claude/agents/devops-engineer/lessons.md"]="append-only lessons log"
  ["backlog/ESCALATIONS.md"]="append-only backlog record"
  ["backlog/FOLLOW_UPS.md"]="append-only backlog record"
  ["backlog/QUEUE.md"]="append-only backlog record"
  ["backlog/RETROSPECTIVES.md"]="append-only backlog record"
  ["backlog/STATUS.md"]="append-only backlog record"
  # Added by FOLLOW-900: the ROOT STATUS.md (distinct file from backlog/STATUS.md, which was
  # already classified) began naming the gate in a session note — "I expected the newly-red
  # Cron Heartbeat prod job to make gh-pr-checks-verified.sh return exit 1 on every PR" — i.e.
  # a narrative record of a withdrawn escalation. It reads no exit code and instructs no
  # routing. This checker caught it unprompted, which is the point of clause 2.
  ["STATUS.md"]="append-only session record; narrates the gate's behaviour, routes on no exit code of it"
  # Added by the 2026-09-24 over-engineering audit (PR #934), caught by this cross-check
  # unprompted: both documents cite the gate's SIZE (2300 lines) as a measurement of process
  # overhead and name it once as a candidate for replacement by native required checks. Neither
  # reads a verdict, enumerates an exit code or instructs any routing on one.
  ["docs/AUDIT-2026-09-24.md"]="audit synthesis; cites the gate's line count as a measurement, routes on no exit code of it"
  ["docs/audits/2026-09-24/report-D.md"]="audit supporting report; same citation plus a replacement proposal, routes on no exit code of it"
  # Added by FOLLOW-1257 (the remediation program plan). Same class as CLAUDE.md: it names the
  # exit-0 precondition in prose as a global constraint and enumerates no other code.
  ["docs/PLAN-AUDIT-REMEDIATION-2026-09-24.md"]="program plan; names the exit-0 precondition in prose, enumerates no other code and issues no routing instruction"
)

# Classified by CLASS, not by filename. `.claude/agents/<agent>/lessons.d/<TICKET>.md` is the
# per-ticket lesson fragment introduced by FOLLOW-888 to stop workers colliding on one shared
# lessons.md. Every such fragment is a narrative record by construction — it says what the
# author decided and what they would guard next time — and none of them routes on an exit
# code; the already-classified `.claude/agents/devops-engineer/lessons.md` is the same class,
# one file per agent instead of one per ticket. Listing them individually would mean this
# checker goes red on any ticket whose lesson happens to name the gate, i.e. exactly the
# tickets that improved it (FOLLOW-918 was the first, and caught this).
#
# FOLLOW-975: the per-agent `lessons.md` is that same class and was NOT covered, only
# `lessons.d/` was. The comment above already called `devops-engineer/lessons.md` "the same
# class" while classifying it by FILENAME — so the class held for one agent and no other.
# `main` went red on its own head commit `5a1a9bb5` the first time a DIFFERENT agent's
# lessons.md happened to name the gate, blocking every open PR. That is precisely the failure
# the paragraph above predicted ("goes red on any ticket whose lesson happens to name the
# gate, i.e. exactly the tickets that improved it"), so the fix is to finish the class rather
# than add a second filename. The individual devops-engineer entry above is now redundant and
# left in place: deleting it would be an unrelated edit, and it costs nothing.
NON_ROUTING_PREFIXES=(
  ".claude/agents/:/lessons.d/=per-ticket lesson fragment (FOLLOW-888); narrative record, routes on no exit code"
  ".claude/agents/:/lessons.md=per-agent append-only lessons log (FOLLOW-975); narrative record, routes on no exit code"
)

# ── 1. read the contract out of the gate ──────────────────────────────────────
if [[ ! -f "$GATE" ]]; then
  echo "ERROR: $GATE not found from repo root $repo_root" >&2
  exit 3
fi

mapfile -t contract_pairs < <(
  sed -n '/^# EXIT-CODE-CONTRACT/,/^# END-EXIT-CODE-CONTRACT/p' "$GATE" \
    | grep -oE '^#   [0-9]+=[A-Z_]+' \
    | sed 's/^#   //'
)

if [[ "${#contract_pairs[@]}" -eq 0 ]]; then
  echo "ERROR: no EXIT-CODE-CONTRACT block found in $GATE." >&2
  echo "  Expected '# EXIT-CODE-CONTRACT' … '# END-EXIT-CODE-CONTRACT' with '#   <n>=<TOKEN>'" >&2
  echo "  lines between them. Without it this checker cannot know what the contract is, and" >&2
  echo "  it will not fall back to a hardcoded copy — that is the very drift it exists to stop." >&2
  exit 3
fi

MARKER="gate-exit-contract: ${contract_pairs[*]}"

# Cross-check the contract against the codes the gate actually exits with, so a token can
# never be declared for a code the script no longer produces (or the reverse).
declared_codes="$(printf '%s\n' "${contract_pairs[@]}" | cut -d= -f1 | LC_ALL=C sort -u)"
used_codes="$(grep -oE '^\s*exit [0-9]+' "$GATE" | grep -oE '[0-9]+' | LC_ALL=C sort -u)"
missing_decl="$(LC_ALL=C comm -13 <(echo "$declared_codes") <(echo "$used_codes"))"
if [[ -n "$missing_decl" ]]; then
  echo "FAIL: $GATE exits with code(s) the EXIT-CODE-CONTRACT block does not declare:" >&2
  printf '%s\n' "$missing_decl" | sed 's/^/  - exit /' >&2
  exit 1
fi

echo "Contract read from $GATE: ${contract_pairs[*]}"
echo "Required marker line: <!-- $MARKER -->"
echo ""

failures=0

# ── 2. every routing consumer carries the marker ──────────────────────────────
for f in "${ROUTING_CONSUMERS[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "FAIL: declared routing consumer '$f' does not exist."
    failures=$((failures + 1))
    continue
  fi
  if grep -qF -- "$MARKER" "$f"; then
    echo "OK: $f carries the current contract marker"
  else
    echo "FAIL: $f does not carry the current contract marker."
    echo "  It routes on this gate's exit code, so it must contain, verbatim:"
    echo "    <!-- $MARKER -->"
    if grep -qF -- "gate-exit-contract:" "$f"; then
      echo "  It carries a STALE marker:"
      grep -oF -m1 -- "gate-exit-contract:.*" "$f" | sed 's/^/    /'
      echo "  Update the surrounding prose too — the marker is a forcing function, not a fix."
    fi
    failures=$((failures + 1))
  fi
done

# ── 3. no unclassified consumer ───────────────────────────────────────────────
echo ""
while IFS= read -r f; do
  f="${f#./}"
  for known in "${ROUTING_CONSUMERS[@]}"; do
    [[ "$f" == "$known" ]] && continue 2
  done
  if [[ -n "${NON_ROUTING[$f]+set}" ]]; then
    continue
  fi
  for rule in "${NON_ROUTING_PREFIXES[@]}"; do
    prefix="${rule%%:*}"
    rest="${rule#*:}"
    infix="${rest%%=*}"
    [[ "$f" == "$prefix"*"$infix"* ]] && continue 2
  done
  echo "FAIL: '$f' references $GATE but is in neither list in this script."
  echo "  If it routes on the exit code, add it to ROUTING_CONSUMERS and give it the marker."
  echo "  If it does not, add it to NON_ROUTING with the reason it does not."
  failures=$((failures + 1))
done < <(
  grep -rl "gh-pr-checks-verified" \
    --include=*.md --include=*.sh --include=*.yml --include=*.yaml --include=*.json . \
    | grep -v '/node_modules/' | LC_ALL=C sort
)

echo ""
if [[ "$failures" -gt 0 ]]; then
  echo "RESULT: FAIL — $failures exit-code corpus problem(s)."
  exit 1
fi
echo "RESULT: the gate's exit-code contract and all ${#ROUTING_CONSUMERS[@]} routing consumers agree."
exit 0
