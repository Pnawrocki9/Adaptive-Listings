#!/usr/bin/env bash
# .claude/hooks/session-stop.sh
#
# Runs when the entire Claude Code session ends.
# Snapshots final status and reminds about pending work.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "  Estalara — Session ending  ($(date -u +%Y-%m-%dT%H:%M:%SZ))"
echo "════════════════════════════════════════════════════════════════════"

# Show what's still in flight
if [[ -f "backlog/QUEUE.md" ]]; then
  IN_PROGRESS_COUNT=$(grep -c "status: IN_PROGRESS" "backlog/QUEUE.md" 2>/dev/null || echo "0")
  READY_COUNT=$(grep -c "status: READY$" "backlog/QUEUE.md" 2>/dev/null || echo "0")
  REVIEW_COUNT=$(grep -c "status: READY_FOR_REVIEW" "backlog/QUEUE.md" 2>/dev/null || echo "0")
  
  echo ""
  echo "Backlog snapshot:"
  echo "  IN_PROGRESS:        $IN_PROGRESS_COUNT"
  echo "  READY:              $READY_COUNT"
  echo "  READY_FOR_REVIEW:   $REVIEW_COUNT"
fi

# Remind about open PRs
if command -v gh >/dev/null 2>&1; then
  OPEN_PRS=$(gh pr list --state open --json number 2>/dev/null | grep -c '"number"' || echo "0")
  if [[ "$OPEN_PRS" -gt 0 ]]; then
    echo ""
    echo "🔀 $OPEN_PRS open PR(s) awaiting attention"
  fi
fi

# Remind about uncommitted work
if git status --porcelain | grep -q .; then
  echo ""
  echo "⚠️  Uncommitted changes in working tree"
  git status --short | head -10
fi

echo ""
echo "════════════════════════════════════════════════════════════════════"
