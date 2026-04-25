#!/usr/bin/env bash
# .claude/hooks/subagent-stop.sh
#
# Runs after any subagent finishes its turn.
# Reads backlog/STATUS.md and surfaces the next action to the parent session.
#
# Per Anthropic guidance: hooks print to STDOUT and that output appears in the
# Claude transcript, allowing the parent (or human) to see what comes next.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

ESCALATIONS_FILE="backlog/ESCALATIONS.md"
STATUS_FILE="backlog/STATUS.md"
QUEUE_FILE="backlog/QUEUE.md"

echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "  Estalara — SubagentStop hook  ($(date -u +%Y-%m-%dT%H:%M:%SZ))"
echo "════════════════════════════════════════════════════════════════════"

# 1. Check escalations first — they always take priority
if [[ -f "$ESCALATIONS_FILE" ]]; then
  UNRESOLVED=$(grep -c "^## OPEN" "$ESCALATIONS_FILE" 2>/dev/null || echo "0")
  if [[ "$UNRESOLVED" -gt 0 ]]; then
    echo ""
    echo "🛑  $UNRESOLVED OPEN ESCALATION(S) — human attention required"
    echo ""
    grep -A 10 "^## OPEN" "$ESCALATIONS_FILE" | head -50 || true
    echo ""
    echo "NEXT: Resolve escalations in backlog/ESCALATIONS.md before continuing."
    echo "════════════════════════════════════════════════════════════════════"
    exit 0
  fi
fi

# 2. Print current status
if [[ -f "$STATUS_FILE" ]]; then
  echo ""
  echo "📋 Current status:"
  echo ""
  cat "$STATUS_FILE"
fi

# 3. Print the most recent NEXT line from any agent transcript file
if [[ -f "$STATUS_FILE" ]]; then
  NEXT_LINE=$(grep -E "^NEXT:" "$STATUS_FILE" | tail -1 || true)
  if [[ -n "$NEXT_LINE" ]]; then
    echo ""
    echo "▶ $NEXT_LINE"
  fi
fi

# 4. Check for open PRs awaiting validation
if command -v gh >/dev/null 2>&1; then
  OPEN_PRS=$(gh pr list --state open --json number,title 2>/dev/null | grep -c '"number"' || echo "0")
  if [[ "$OPEN_PRS" -gt 0 ]]; then
    echo ""
    echo "🔀 $OPEN_PRS open PR(s) — PM should validate"
    gh pr list --state open --limit 10 2>/dev/null || true
  fi
fi

echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "Suggested next: Use the pm-orchestrator subagent to drive the queue."
echo "════════════════════════════════════════════════════════════════════"
