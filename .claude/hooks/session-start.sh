#!/usr/bin/env bash
# .claude/hooks/session-start.sh
#
# SessionStart hook — the entry-side half of FOLLOW-955, extended by FOLLOW-1081.
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
#     flight, and starting a duplicate is the documented failure;
#   - (FOLLOW-1081) "a dispatch that dies before creating a branch leaves the empty set" — an
#     OPEN dispatch-intent line (backlog/HANDOFFS.md) with NO matching branch/worktree anywhere.
#     This is the OPPOSITE failure mode from the "looks dead but isn't" lesson above: that one
#     was ALIVE and quiet, this one is genuinely DEAD and left nothing. Check §5 below before
#     assuming either — a live-process hit at §4 rules this one out for the same branch.
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

# ── 5. Dispatch intents with NO matching artefact at all (FOLLOW-1081) ──────────────────────────
# Detector 1 (above) catches a branch that EXISTS and is empty. FOLLOW-1046 (not yet built) is for
# a branch that exists and carries a partial commit. Neither catches a dispatch whose worker died
# before creating anything — no branch, no worktree, no commit, no PR (QUEUE.md:26200, session
# 136-A). The only durable record of "a dispatch was attempted" is the intent line the PM writes
# into backlog/HANDOFFS.md BEFORE spawning (format documented at the top of that file). An OPEN
# intent whose `branch=` matches nothing anywhere in the repo is the empty set this ticket exists
# to surface — this is the complement of detector 1, not a duplicate of it.
HANDOFFS_FILE="backlog/HANDOFFS.md"
if [[ -f "$HANDOFFS_FILE" ]]; then
  KNOWN_BRANCHES="$( { git branch --list --format='%(refname:short)' 2>/dev/null; \
                        git branch -r --format='%(refname:short)' 2>/dev/null | sed 's#^[^/]*/##'; \
                        git worktree list --porcelain 2>/dev/null \
                          | awk '/^branch /{sub("refs/heads/","",$2); print $2}'; } \
                      | sort -u )"
  while IFS= read -r LINE; do
    [[ -z "$LINE" ]] && continue
    # Only OPEN intents are live — a RECONCILED one is explicitly closed and out of scope here.
    printf '%s' "$LINE" | grep -q 'status=OPEN\b' || continue
    TICKET="$(printf '%s' "$LINE" | grep -o 'ticket=[^[:space:]]*' | head -1 | cut -d= -f2)"
    BRANCH="$(printf '%s' "$LINE" | grep -o 'branch=[^[:space:]]*' | head -1 | cut -d= -f2)"
    # The format TEMPLATE documented at the top of HANDOFFS.md is itself a syntactically valid
    # intent line carrying `status=OPEN`, and its `branch=` will never exist. Left unguarded this
    # detector fires on the documentation on EVERY session start — the precise failure this
    # script's own DESIGN RULE (above) exists to prevent, and worse than silence, because a hook
    # that always speaks is a hook nobody reads. Placeholder syntax is the discriminator: a real
    # git branch name cannot contain '<' or '>' (git check-ref-format rejects both).
    case "$BRANCH$TICKET" in *'<'* | *'>'*) continue ;; esac
    DISPATCHED_AT="$(printf '%s' "$LINE" | grep -o 'dispatched_at=[^[:space:]]*' | head -1 | cut -d= -f2)"
    [[ -z "$BRANCH" ]] && continue
    if ! printf '%s\n' "$KNOWN_BRANCHES" | grep -qxF "$BRANCH"; then
      note "🛑 RECOVERY: dispatch intent for $TICKET (branch '$BRANCH', dispatched $DISPATCHED_AT) has NO matching artefact anywhere — no local branch, no remote branch, no worktree."
      note "   Either the worker is still mid-flight in a process this session cannot see (check \`ps -eo pid,lstart,cmd\` before assuming failure), or it died leaving nothing. Reconcile in backlog/HANDOFFS.md (mark completed/abandoned/re-dispatched) once resolved — do not let this line sit OPEN."
    fi
  done < <(grep -o '<!-- dispatch-intent:.*-->' "$HANDOFFS_FILE" 2>/dev/null || true)
fi

# ── Emit — silence when nothing holds ────────────────────────────────────────────────────────
[[ -z "$FINDINGS" ]] && exit 0

HEADER="Session opened with unfinished state on disk (SessionStart check, FOLLOW-955/1081):"

# Emitted by bash, no interpreter dependency — same reason as `session-stop.sh` [FOLLOW-959
# AC(3)]: a `python3`-only emitter makes a control that is supposed to SPEAK fail silent when the
# interpreter is missing, and silence is this hook's "all clear".
json_escape() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  s=${s//$'\t'/\\t}
  printf '%s' "$s"
}

BODY="$HEADER"$'\n'"$(printf '%s' "$FINDINGS" | sed -e 's/[[:space:]]*$//')"
ESCAPED="$(json_escape "$BODY")"
printf '{"systemMessage":"%s","hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' \
  "$ESCAPED" "$ESCAPED"
