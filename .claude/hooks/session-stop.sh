#!/usr/bin/env bash
# .claude/hooks/session-stop.sh
#
# Stop hook. Runs when Claude finishes a turn.
#
# Two jobs:
#   1. Snapshot backlog / PR / working-tree state (unchanged behaviour).
#   2. Refuse to go QUIET when the working tree is dirty on a ZERO-COMMIT branch —
#      the state in which the work exists in exactly one place that no git object
#      references, so closing the terminal loses it outright.
#
# Why that specific state and not "dirty tree" in general: a dirty tree on a branch that
# already has commits is PARTIALLY saved; a dirty tree on a zero-commit branch is saved
# NOWHERE. Sessions 111 and 112 both ended in exactly the second state, and the plain-text
# warning this script already printed did not stop either — text in the scrollback is not a
# control. So the dangerous case now goes out as a `systemMessage` (rendered to the user, not
# buried in output) and, ONCE per session, as a `decision: block` that hands the reason back to
# the model so it acts instead of merely reporting.
#
# HONEST LIMIT — read before trusting this: a Stop hook fires when a TURN ends, not when the
# terminal is killed. It cannot fire on the actual event that lost the work both times. What it
# does is shrink the exposure window from "a whole session" to "a single turn": after every turn
# the state is named out loud, so the work gets committed long before any crash matters.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT" || exit 0

HOOK_INPUT="$(cat 2>/dev/null || true)"
# Parsed with grep/sed, NOT python3. [FOLLOW-959 AC(3)] `session_id` is a flat string field, and
# the previous inline `python3` made this hook's ENTIRE output conditional on an interpreter it
# never checked for: without it the extraction returned empty AND the emitter printed nothing, so
# a control whose stated job is "refuse to go QUIET" failed silent, in the direction that loses
# work.
SESSION_ID="$(printf '%s' "$HOOK_INPUT" \
  | grep -o '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' \
  | sed 's/.*"\([^"]*\)"$/\1/' | head -1)"

DEFAULT_BRANCH="main"

# ── Human-readable snapshot ───────────────────────────────────────────────────────────────────
SUMMARY=""
add() { SUMMARY="${SUMMARY}$1"$'\n'; }

add "Estalara — turn ending ($(date -u +%Y-%m-%dT%H:%M:%SZ))"

if [[ -f "backlog/QUEUE.md" ]]; then
  IN_PROGRESS_COUNT=$(grep -c "status: IN_PROGRESS" "backlog/QUEUE.md" 2>/dev/null || true)
  READY_COUNT=$(grep -c "status: READY$" "backlog/QUEUE.md" 2>/dev/null || true)
  REVIEW_COUNT=$(grep -c "status: READY_FOR_REVIEW" "backlog/QUEUE.md" 2>/dev/null || true)
  add "Backlog — IN_PROGRESS: $IN_PROGRESS_COUNT | READY: $READY_COUNT | READY_FOR_REVIEW: $REVIEW_COUNT"
fi

if command -v gh >/dev/null 2>&1; then
  # `wc -l` always prints exactly one integer and exits 0 — unlike `grep -c`, which prints 0
  # AND exits 1 on no match, so a `|| echo 0` fallback appends a SECOND zero and the numeric
  # test below dies on "0\n0". Same reason the QUEUE counts above use `|| true`.
  OPEN_PRS=$(gh pr list --state open --json number 2>/dev/null | grep -o '"number"' | wc -l | tr -d ' ')
  [[ "$OPEN_PRS" -gt 0 ]] && add "🔀 $OPEN_PRS open PR(s) awaiting attention"
fi

# ── The dangerous state: dirty tree on a branch that carries no commits of its own ────────────
DIRTY="$(git status --porcelain 2>/dev/null || true)"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
DANGER=0

if [[ -n "$DIRTY" ]]; then
  FILE_COUNT="$(printf '%s\n' "$DIRTY" | grep -c . || true)"
  if [[ "$BRANCH" != "$DEFAULT_BRANCH" && "$BRANCH" != "HEAD" ]] \
     && git rev-parse --verify --quiet "$DEFAULT_BRANCH" >/dev/null 2>&1; then
    AHEAD="$(git rev-list --count "${DEFAULT_BRANCH}..HEAD" 2>/dev/null || echo 0)"
    [[ "$AHEAD" == "0" ]] && DANGER=1
  fi
  if [[ "$DANGER" == "1" ]]; then
    add ""
    add "🛑 UNCOMMITTED WORK EXISTS NOWHERE BUT THIS WORKING TREE."
    add "   branch '$BRANCH' has ZERO commits of its own vs '$DEFAULT_BRANCH', and $FILE_COUNT file(s) are modified."
    add "   No git object references this work. Closing the terminal loses it (sessions 111 and 112)."
    add ""
    add "$(git status --short 2>/dev/null | head -10)"
  else
    # [FOLLOW-959 AC(4)] NOT "partially saved" — that was false about the thing at risk. The
    # uncommitted files are saved nowhere in BOTH states; what differs is whether the branch's
    # already-COMMITTED work survives. Narrowing the alarm is the design choice; overstating the
    # safety was Rule-AU-shaped, in a hook whose own ticket invoked Rule AU.
    add "⚠️  $FILE_COUNT uncommitted file(s) on '$BRANCH' — unsaved, as in the case above. What differs: this branch's already-committed work does survive."
  fi
fi

# ── Emit ──────────────────────────────────────────────────────────────────────────────────────
# Block at most ONCE per session: the nudge should make the model act, never trap the turn in a
# loop when leaving the tree dirty is a deliberate choice.
BLOCK=0
if [[ "$DANGER" == "1" ]]; then
  # [FOLLOW-959 AC(1)] Sanitised, because the key can be a BRANCH NAME and every branch in this
  # repo contains a slash (`<agent>/<ticket>-<summary>`, mandated by CLAUDE.md). Unsanitised, the
  # sentinel named a file inside a directory that does not exist, `touch` failed, `|| true`
  # swallowed it, `-f` was never true, and the hook blocked on EVERY turn — precisely the loop
  # this sentinel exists to prevent. Reproduced in RETRO-268 §Headline 4.
  SENTINEL_KEY="${SESSION_ID:-$BRANCH}"
  SENTINEL_KEY="${SENTINEL_KEY//\//_}"
  SENTINEL="${TMPDIR:-/tmp}/claude-zero-commit-guard-${SENTINEL_KEY}"
  if [[ ! -f "$SENTINEL" ]]; then
    # [FOLLOW-959 AC(2)] LOUD, not `|| true`. A sentinel that cannot be written is a control that
    # cannot self-limit; swallowing that is what turned a one-shot nudge into an every-turn block.
    if ! touch "$SENTINEL" 2>/dev/null; then
      echo "[session-stop] WARNING: cannot write sentinel '$SENTINEL' — the once-per-session" \
        "guarantee is OFF and this hook may block every turn. Fix the path or unset TMPDIR." >&2
    fi
    BLOCK=1
  fi
fi

REASON="The working tree is dirty on '$BRANCH', a branch with ZERO commits vs '$DEFAULT_BRANCH'. This work is referenced by no git object and dies with the terminal. Commit it to the branch (or say explicitly why it should stay uncommitted) before ending the turn."

# Emitted by bash, with no interpreter dependency. [FOLLOW-959 AC(3)]
# Escapes the five characters JSON forbids raw in a string; UTF-8 (the emoji above) passes through
# untouched, which is valid JSON. Other control characters cannot occur here — every input is git
# porcelain output or text literal to this file.
json_escape() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  s=${s//$'\t'/\\t}
  printf '%s' "$s"
}

TRIMMED="$(printf '%s' "$SUMMARY" | sed -e 's/[[:space:]]*$//' | sed -e :a -e '/^\n*$/{$d;N;};/\n$/ba')"
if [[ "$BLOCK" == "1" ]]; then
  printf '{"systemMessage":"%s","decision":"block","reason":"%s"}\n' \
    "$(json_escape "$TRIMMED")" "$(json_escape "$REASON")"
else
  printf '{"systemMessage":"%s"}\n' "$(json_escape "$TRIMMED")"
fi
