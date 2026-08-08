#!/usr/bin/env bash
# .claude/hooks/pre-edit-branch-guard.sh
#
# FOLLOW-448 (RETRO-146 §4e): mechanical HEAD==main guard.
#
# Runs before every Edit/Write (file-write) tool use. Warns when a file edit
# is about to happen while git HEAD is on `main`/`master`, so a worker that
# forgot to run `git checkout -b <agent>/<ticket-id>-<slug>` as its FIRST
# action (docs/AGENT_WORKFLOW.md) gets a mechanical, visible signal instead
# of silently stranding uncommitted work on the main working tree — the
# exact failure mode that stranded the FOLLOW-442 implementation when the
# backend-engineer subagent stalled 600s before branching.
#
# Deliberately NON-BLOCKING (warns, always allows the edit): the human
# operator and the pm-orchestrator legitimately edit a fixed set of backlog
# bookkeeping files directly on `main` (QUEUE.md, ESCALATIONS.md, STATUS.md,
# HANDOFFS.md, RETROSPECTIVES.md, FOLLOW_UPS.md, CONVENTIONS_PATCH.md — see
# docs/AGENT_WORKFLOW.md "The state files" table) and neither `git pull`
# nor other routine main-branch bash work should ever be interrupted. A hard
# block that breaks that sanctioned workflow would be worse than the
# near-miss it's meant to prevent. See FOLLOW-448 PR description for the
# full rationale.
#
# The warning is delivered via PreToolUse `additionalContext` so Claude
# itself (not just a human reading a debug log) sees it and can branch
# before continuing — plain stdout is NOT surfaced to the model on
# PreToolUse (only to the debug log), so a bare `echo` here would satisfy
# nobody. This keeps the guard's positive-proof signal real (Rule Q).
#
# Override: set ESTALARA_ALLOW_MAIN_EDITS=1 to silence intentionally
# (e.g. a deliberate one-off doc fix directly on main).
#
# Worktree resolution (FOLLOW-849): HEAD is read from the worktree containing
# the EDITED FILE, never from the session's cwd — see the block above BRANCH.
# The fixture proving the guard still fires after that change lives in
# scripts/__tests__/pre-edit-branch-guard.test.sh and runs in CI.

set -euo pipefail

INPUT="$(cat)"
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null || echo "")
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || echo "")

allow() {
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
  exit 0
}

# Only meaningful for actual file-write tools.
case "$TOOL_NAME" in
  Edit | Write | MultiEdit) ;;
  *) allow ;;
esac

if [[ "${ESTALARA_ALLOW_MAIN_EDITS:-}" == "1" ]]; then
  allow
fi

# FOLLOW-849 (sightings 1-6 counted in FOLLOW-909): resolve HEAD against the
# worktree that OWNS THE EDITED FILE, not the session's cwd.
#
# The original line here was a bare `git rev-parse --show-toplevel`, which runs
# in the SESSION's cwd — the main checkout — and the HEAD read below was then
# that checkout's. Every agent editing inside `.claude/worktrees/<name>/`, this
# repo's standard parallel-work mechanism, was told `HEAD == 'main'` while
# sitting on its correct ticket branch. Six workers hit it independently and
# each paid a verification cost before dismissing it. Because the guard is
# non-blocking and the pm-orchestrator's backlog files are exempt below, the
# only actors it ever tripped were the ones with no authority to repair it —
# which is how a guard becomes noise, and noise is what it will be on the day
# it is right.
#
# The inverse error mattered just as much and was never reported: with the cwd
# inside a worktree and the edit landing on the main checkout, the old code was
# SILENT — a false negative on precisely the stranded-work-on-main failure this
# guard exists to catch.
#
# If the edit cannot be attributed to any worktree (no path, or a path in no
# repository), FAIL SILENT — FOLLOW-849 AC(3). A guard that cannot be correct
# should be quiet, not noisy.
if [[ -z "$FILE_PATH" ]]; then
  allow
fi

# A Write can create a file whose parent directories do not exist yet, and
# `git -C` on a missing directory just errors — which would silently unguard
# every new-file Write. Walk up to the nearest ancestor that does exist; that
# directory is in the same worktree the new file will be created in.
resolve_existing_dir() {
  local dir
  dir="$(dirname -- "$1")"
  while [[ "$dir" != "/" && "$dir" != "." && ! -d "$dir" ]]; do
    dir="$(dirname -- "$dir")"
  done
  if [[ -d "$dir" ]]; then printf '%s' "$dir"; fi
}

# A relative file_path has no worktree of its own to resolve against; `dirname`
# bottoms out at "." and git then answers for the session cwd, which is the same
# frame the tool itself resolves the path in.
EDIT_DIR="$(resolve_existing_dir "$FILE_PATH")"
if [[ -z "$EDIT_DIR" ]]; then
  allow
fi

REPO_ROOT="$(git -C "$EDIT_DIR" rev-parse --show-toplevel 2>/dev/null || echo "")"
if [[ -z "$REPO_ROOT" ]]; then
  # The edited path is in no git repo (or git is unavailable) — nothing to guard.
  allow
fi

BRANCH="$(git -C "$EDIT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
if [[ "$BRANCH" != "main" && "$BRANCH" != "master" ]]; then
  allow
fi

# Backlog bookkeeping files are legitimately edited directly on main by the
# pm-orchestrator per docs/AGENT_WORKFLOW.md's "state files" table — exempt
# them so the guard doesn't false-positive on an established, sanctioned
# pattern (Rule Q: a guard must be scoped to a real condition, not noise).
EXEMPT_FILES_RE='backlog/(QUEUE|ESCALATIONS|STATUS|HANDOFFS|RETROSPECTIVES|FOLLOW_UPS)\.md$|(^|/)CONVENTIONS_PATCH\.md$'
REL_PATH="${FILE_PATH#"$REPO_ROOT"/}"
if [[ -n "$REL_PATH" && "$REL_PATH" =~ $EXEMPT_FILES_RE ]]; then
  allow
fi

REASON="FOLLOW-448 branch guard: about to edit '${REL_PATH:-$FILE_PATH}' while HEAD == '$BRANCH'. Worker discipline (docs/AGENT_WORKFLOW.md) requires 'git checkout -b <agent>/<ticket-id>-<slug>' as the FIRST action, before any file edit. If this edit belongs to a ticket, stop now and branch: git checkout -b <agent>/<ticket-id>-<slug> — uncommitted edits left on main are silently absorbed by the next 'git checkout -b' from main, or discarded by 'git checkout main' / 'git stash drop' (RETRO-146 §4e). This is a WARNING, not a block; the edit will proceed. Set ESTALARA_ALLOW_MAIN_EDITS=1 to silence intentionally."

jq -n --arg reason "$REASON" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "allow", additionalContext: $reason}}'
exit 0
