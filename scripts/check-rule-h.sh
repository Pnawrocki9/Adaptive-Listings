#!/usr/bin/env bash
# Rule H hard gate — schema scaffolds must have runtime-wired consumers.
#
# Checks every PR diff for two concrete violation patterns:
#   1. API route files containing mock/stub markers with no FOLLOW-NNN reference
#   2. New lib/ exports (non-test) with zero non-test importers in apps/ or packages/
#
# Exit codes: 0 = pass, 1 = violation found.
# Run: scripts/check-rule-h.sh [base_branch]
# Default base_branch: origin/main

set -euo pipefail

BASE="${1:-origin/main}"
ROOT="$(git rev-parse --show-toplevel)"
FAILURES=0

cd "$ROOT"

# ── Pattern 1: mock/stub API routes without a FOLLOW-NNN reference ───────────
echo "=== Rule H check: mock route markers ==="

# Collect changed route files
changed_routes=$(git diff --name-only "$BASE"...HEAD 2>/dev/null \
  | grep -E "src/app/api/.*route\.(ts|tsx)$" || true)

for file in $changed_routes; do
  [[ -f "$file" ]] || continue
  # Check for mock/stub markers in the file
  if grep -qE \
    "MVP stub|mock data|mock route|placeholder.*real|real impl in TICKET-|// stub:" \
    "$file" 2>/dev/null; then
    # Require at least one FOLLOW-NNN reference in the same file
    if ! grep -qP "FOLLOW-\d+" "$file" 2>/dev/null; then
      echo "FAIL: $file contains a mock/stub marker but no FOLLOW-NNN reference."
      echo "      Add a FOLLOW-NNN stub to backlog/FOLLOW_UPS.md and reference it"
      echo "      in the file comment (e.g. '// MVP stub — replaced by FOLLOW-014')."
      FAILURES=$((FAILURES + 1))
    else
      follow=$(grep -oP "FOLLOW-\d+" "$file" | head -1)
      # Verify the FOLLOW-NNN exists in FOLLOW_UPS.md
      if ! grep -q "^## ${follow}" backlog/FOLLOW_UPS.md 2>/dev/null; then
        echo "FAIL: $file references $follow but that stub is missing from backlog/FOLLOW_UPS.md."
        FAILURES=$((FAILURES + 1))
      else
        echo "OK:   $file — mock marker + $follow stub present."
      fi
    fi
  fi
done

# ── Pattern 2: new lib/ exports with no non-test consumer ────────────────────
echo ""
echo "=== Rule H check: unwired lib/ exports ==="

# Collect newly added (not just modified) lib files
new_lib_files=$(git diff --name-only --diff-filter=A "$BASE"...HEAD 2>/dev/null \
  | grep -E "src/lib/[^/]+\.ts$" \
  | grep -v "__tests__" \
  | grep -v "\.test\." \
  | grep -v "\.spec\." || true)

for file in $new_lib_files; do
  [[ -f "$file" ]] || continue
  # Extract exported function/class/const names
  exports=$(grep -oP "export (?:async )?(?:function|class|const|let) \K\w+" "$file" \
    2>/dev/null || true)
  for sym in $exports; do
    # Count non-test importers (files that import this symbol, excluding the
    # defining file itself and any test files)
    consumer_count=$(grep -rl "\b${sym}\b" apps/ packages/ \
      --include="*.ts" --include="*.tsx" 2>/dev/null \
      | grep -v "__tests__" \
      | grep -v "\.test\." \
      | grep -v "\.spec\." \
      | grep -v "node_modules" \
      | grep -v "/dist/" \
      | grep -v "^${file}$" \
      | wc -l || echo 0)
    if [[ "$consumer_count" -lt 1 ]]; then
      echo "FAIL: '$sym' exported from $file has no non-test consumer."
      echo "      Either wire it into a production path in the same PR, add an"
      echo "      integration test that exercises it through its consumer, OR add"
      echo "      an explicit FOLLOW-NNN deferral stub to backlog/FOLLOW_UPS.md"
      echo "      and add 'promoted_to_queue: false' to the stub."
      FAILURES=$((FAILURES + 1))
    else
      echo "OK:   $sym ($file) — $consumer_count importer(s)."
    fi
  done
done

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
if [[ "$FAILURES" -gt 0 ]]; then
  echo "Rule H FAILED: $FAILURES violation(s) found."
  echo "See CONVENTIONS_PATCH.md Rule H for remediation options."
  exit 1
else
  echo "Rule H passed — all schema scaffolds have runtime consumers or documented deferrals."
fi
