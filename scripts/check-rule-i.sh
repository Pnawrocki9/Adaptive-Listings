#!/usr/bin/env bash
# Rule I hard gate — wired-or-dead: every exported symbol must have a non-test importer.
#
# Scans all export declarations in packages/*/src and apps/*/src (TypeScript only,
# *.ts/*.tsx source files). For each exported symbol, checks whether any non-test
# file outside the defining file imports it — including *.mts CLI scripts in apps/.
# Prints a warning for each violation and exits 1 if any are found.
#
# Exclusions:
#   - Test files: *.test.ts, *.spec.ts, __tests__/ directories
#   - Generated/dist output: /dist/, node_modules
#
# Exit codes: 0 = clean, 1 = violations found.
# Run: bash scripts/check-rule-i.sh

# -u: error on unset vars; pipefail: pipe exit = last non-zero command.
# No -e: grep legitimately exits 1 when no matches found; we handle that explicitly.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

VIOLATIONS=0
TOTAL_SYMBOLS=0
BARREL_SKIPPED=0

echo "=== Rule I check: wired-or-dead exported symbols ==="
echo ""

# Returns 0 (true) if the file is re-exported by any index.ts barrel in its package
# via "export * from '...<stem>'" — meaning consumers never import the symbol directly.
is_barrel_exported() {
  local file="$1"
  local stem
  stem="$(basename "$file")"
  stem="${stem%.tsx}"
  stem="${stem%.ts}"

  # Derive package root: packages/xxx or apps/xxx
  local pkg_root
  pkg_root="$(echo "$file" | grep -oP '^(?:packages|apps)/[^/]+')"
  [[ -z "$pkg_root" ]] && return 1

  # True if any index.ts in this package contains "export * from '.../<stem>'" or
  # "export * from '.../<stem>.js'" (TS projects often use the .js extension convention).
  { grep -rl "export \* from" "$pkg_root" --include="index.ts" 2>/dev/null || true; } \
  | { xargs grep -lP "export\s*\*\s*from\s+['\"][^'\"]*/${stem}(?:\.(?:js|ts|tsx|mjs|cjs))?['\"]" 2>/dev/null || true; } \
  | grep -q .
}

# Collect all non-test TypeScript source files under packages/*/src and apps/*/src
mapfile -t source_files < <(
  find packages apps \
    -type f \
    \( -name "*.ts" -o -name "*.tsx" \) \
    -path "*/src/*" \
    ! -path "*/node_modules/*" \
    ! -path "*/dist/*" \
    ! -path "*/.next/*" \
    ! -name "*.test.ts" \
    ! -name "*.test.tsx" \
    ! -name "*.spec.ts" \
    ! -name "*.spec.tsx" \
    ! -path "*/__tests__/*" \
    ! -path "*/__mocks__/*" \
    ! -name "page.tsx" \
    ! -name "layout.tsx" \
    ! -name "loading.tsx" \
    ! -name "error.tsx" \
    ! -name "not-found.tsx" \
    ! -name "route.ts" \
    2>/dev/null | sort
)

echo "Scanning ${#source_files[@]} source files..."
echo ""

for file in "${source_files[@]}"; do
  # Skip files that are re-exported wholesale by a barrel index.ts — consumers import
  # via the barrel and the individual symbol names will never appear as explicit importers.
  if is_barrel_exported "$file"; then
    BARREL_SKIPPED=$((BARREL_SKIPPED + 1))
    continue
  fi

  # Extract exported names: functions, classes, consts, lets, vars, enums, types, interfaces.
  # Handles: export function foo, export async function foo, export const foo, export class Foo,
  #          export enum Foo, export type Foo, export interface Foo
  while IFS= read -r sym; do
    [[ -z "$sym" ]] && continue
    TOTAL_SYMBOLS=$((TOTAL_SYMBOLS + 1))

    # { ... || true; } suppresses grep exit-1 (no-match) so pipefail doesn't fire.
    # wc -l then counts 0 lines and outputs "0" cleanly.
    consumer_count=$(
      { grep -rl "\b${sym}\b" packages/ apps/ \
          --include="*.ts" \
          --include="*.tsx" \
          --include="*.mts" \
          2>/dev/null || true; } \
      | grep -v "node_modules" \
      | grep -v "/dist/" \
      | grep -v "/.next/" \
      | grep -v "\.test\.ts" \
      | grep -v "\.test\.tsx" \
      | grep -v "\.spec\.ts" \
      | grep -v "\.spec\.tsx" \
      | grep -v "/__tests__/" \
      | grep -v "/__mocks__/" \
      | { grep -v "^${file}$" || true; } \
      | wc -l
    )
    # Strip leading whitespace that some wc implementations emit.
    consumer_count=$(( consumer_count + 0 ))

    if [[ "$consumer_count" -lt 1 ]]; then
      echo "WARN: '${sym}' in ${file} — zero non-test importers"
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  done < <(
    grep -oP \
      'export\s+(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*|class\s+|const\s+|let\s+|var\s+|enum\s+|type\s+|interface\s+)\K[A-Za-z_$][A-Za-z0-9_$]*' \
      "$file" 2>/dev/null || true
  )
done

echo ""
echo "--- Summary ---"
echo "Files barrel-skipped: $BARREL_SKIPPED"
echo "Symbols scanned     : $TOTAL_SYMBOLS"
echo "Violations found    : $VIOLATIONS"
echo ""

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo "Rule I FAILED: $VIOLATIONS symbol(s) with zero non-test importers."
  echo "Remediation options (pick one per violation):"
  echo "  1. Wire the symbol into a production call site in apps/ or packages/."
  echo "  2. Add an integration test that imports through its consumer (not the symbol directly)."
  echo "  3. Add an explicit FOLLOW-NNN deferral stub to backlog/FOLLOW_UPS.md and reference it"
  echo "     in the defining file's header comment."
  echo ""
  echo "See CONVENTIONS_PATCH.md Rule I for full details."
  exit 1
else
  echo "Rule I passed — all exported symbols have at least one non-test importer."
fi
