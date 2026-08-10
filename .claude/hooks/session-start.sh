#!/usr/bin/env bash
# .claude/hooks/session-start.sh
#
# SessionStart hook — the entry-side half of FOLLOW-955.
#
# The Stop hook (session-stop.sh) shrinks the window in which work can be lost. This one
# shortens the RECOVERY when it was lost anyway: it runs, on entry, the exact checklist that
# sessions 112 and 113 both had to run by hand, and injects the findings into context so the
# session opens already knowing it is a recovery.
#
# The checklist is the standing lessons, made executable:
#   - "an empty `git diff main..<branch>` proves nothing" — a ZERO-COMMIT branch with a dirty
#     tree is finished work that no git object references;
#   - "check worktrees before concluding the agent never ran" — hung sessions strand complete
#     work uncommitted in `.claude/worktrees/agent-*`;
#   - "PM dispatch looks dead but isn't" — a live `claude --agent` process means work is in
#     flight, and starting a duplicate is the documented failure.
#
# DESIGN RULE, and it is the lesson from the warning this ticket replaced: **say nothing when
# there is nothing to say.** A hook that speaks on every clean start trains the reader to skip
# it, which is precisely how the old "uncommitted changes" warning failed twice. Silence here
# means "none of the recovery conditions hold".

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT" || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

DEFAULT_BRANCH="main"
FINDINGS=""
note() { FINDINGS="${FINDINGS}$1"$'\n'; }

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
DIRTY="$(git status --porcelain 2>/dev/null || true)"
DIRTY_COUNT="$(printf '%s\n' "$DIRTY" | grep -c . || true)"
[[ -z "$DIRTY" ]] && DIRTY_COUNT=0

# ── 1. Unreferenced work: dirty tree on a branch with no commits of its own ───────────────────
if [[ "$DIRTY_COUNT" -gt 0 && "$BRANCH" != "$DEFAULT_BRANCH" && "$BRANCH" != "HEAD" ]] \
   && git rev-parse --verify --quiet "$DEFAULT_BRANCH" >/dev/null 2>&1; then
  AHEAD="$(git rev-list --count "${DEFAULT_BRANCH}..HEAD" 2>/dev/null || echo 0)"
  if [[ "$AHEAD" == "0" ]]; then
    note "🛑 RECOVERY: branch '$BRANCH' has ZERO commits vs '$DEFAULT_BRANCH' and $DIRTY_COUNT modified file(s)."
    note "   The work is referenced by no git object. Do NOT read \`git diff ${DEFAULT_BRANCH}..HEAD\` as evidence of what exists — it is empty by construction here. The WORKING TREE is the evidence."
    note "   Files: $(printf '%s\n' "$DIRTY" | awk '{print $NF}' | tr '\n' ' ')"
  else
    note "⚠️  $DIRTY_COUNT uncommitted file(s) on '$BRANCH', left by a previous session. The branch has $AHEAD commit(s) of its own, so this is partially saved."
  fi
elif [[ "$DIRTY_COUNT" -gt 0 ]]; then
  note "⚠️  $DIRTY_COUNT uncommitted file(s) on '$BRANCH', left by a previous session."
fi

# ── 2. Local-only commits ────────────────────────────────────────────────────────────────────
if UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null)"; then
  UNPUSHED="$(git rev-list --count "${UPSTREAM}..HEAD" 2>/dev/null || echo 0)"
  [[ "$UNPUSHED" -gt 0 ]] && note "⚠️  $UNPUSHED commit(s) on '$BRANCH' exist locally only (not on $UPSTREAM)."
elif [[ "$BRANCH" != "$DEFAULT_BRANCH" && "$BRANCH" != "HEAD" ]]; then
  note "⚠️  Branch '$BRANCH' has no upstream — nothing on it is pushed."
fi

# ── 3. Work stranded in agent worktrees ──────────────────────────────────────────────────────
while IFS= read -r WT; do
  [[ -z "$WT" ]] && continue
  WT_DIRTY="$(git -C "$WT" status --porcelain 2>/dev/null | grep -c . || true)"
  [[ -z "$WT_DIRTY" ]] && WT_DIRTY=0
  if [[ "$WT_DIRTY" -gt 0 ]]; then
    note "🛑 RECOVERY: agent worktree '$WT' holds $WT_DIRTY uncommitted file(s) — a hung session strands FINISHED work there. Inspect before concluding an agent never ran."
  fi
done < <(git worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2}' | grep '/\.claude/worktrees/' || true)

# ── 4. Agents still in flight ────────────────────────────────────────────────────────────────
LIVE_AGENTS="$(ps -eo pid,cmd 2>/dev/null | grep 'claude --agent' | grep -v grep || true)"
if [[ -n "$LIVE_AGENTS" ]]; then
  note "⚠️  $(printf '%s\n' "$LIVE_AGENTS" | grep -c .) live \`claude --agent\` process(es). Output buffers until exit, so a quiet log is NOT failure — never dispatch a duplicate on that basis."
  note "$(printf '%s\n' "$LIVE_AGENTS" | head -5)"
fi

# ── Emit — silence when nothing holds ────────────────────────────────────────────────────────
[[ -z "$FINDINGS" ]] && exit 0

HEADER="Session opened with unfinished state on disk (SessionStart check, FOLLOW-955):"

FINDINGS="$FINDINGS" HEADER="$HEADER" python3 -c '
import json, os
body = os.environ["HEADER"] + "\n" + os.environ["FINDINGS"].strip()
print(json.dumps({
    "systemMessage": body,
    "hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": body},
}))
'
