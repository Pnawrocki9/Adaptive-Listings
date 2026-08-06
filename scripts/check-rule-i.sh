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
# ── OUTPUT FORMAT CONTRACT (do not change casually) ───────────────────────────
# Two of the lines below are a MACHINE-PARSED INTERFACE, not human output:
#
#   WARN: '<symbol>' in <file> — zero non-test importers
#   Violations found    : <N>
#
# Their consumer is scripts/gh-pr-checks-verified.sh — the mandated
# pre-READY_FOR_REVIEW merge gate for every ticket in this repo. Its
# `rule_i_symbols_from_log()` extracts `WARN: '\K[^']+' in \S+` and its
# `rule_i_count_from_log()` extracts `Violations found\s*:\s*\K[0-9]+`, from the
# raw Actions log of this job on BOTH the PR and main, and classifies the PR's
# Rule I red as pre-existing only when the PR's symbol SET is a subset of main's.
# Change either line's shape and the merge gate stops being able to classify any
# PR in the repo. If you must change it, change the consumer in the same PR.
# (A cross-script parity fixture that runs this script and feeds the consumer is
# FOLLOW-848's scope, not this file's.)
#
# The three "nothing to report" states below deliberately print NO
# `Violations found` line at all, so a degraded run cannot be read by the
# consumer as a clean 0 — it renders no verdict instead.
#
# Exit codes:
#   0 = clean (symbols were parsed and every one has a non-test importer)
#   1 = violations found
#   3 = the gate could NOT run: failed dependency preflight, unresolvable repo
#       root, or a scan that produced nothing to check. 3 is not a milder 1 and
#       is emphatically not a 0 — it means no verdict was rendered.
#
# Run: bash scripts/check-rule-i.sh
#      bash scripts/check-rule-i.sh --self-test

# -u: error on unset vars; pipefail: pipe exit = last non-zero command.
# No -e: grep legitimately exits 1 when no matches found; we handle that explicitly.
# `-e` is NOT the fix for the fail-open this file used to have — the guards below
# are. Adding it would abort on those deliberate no-match greps instead.
set -uo pipefail

# ── Dependency preflight (FOLLOW-842 AC(1)) ───────────────────────────────────
# WHY. This script extracts every exported symbol with `grep -oP` (a GNU
# extension, absent on macOS/BSD and busybox) inside `mapfile` (bash >= 4).
# Under `set -uo pipefail` WITHOUT `-e`, a grep that errors out leaves the loop
# with zero iterations: TOTAL_SYMBOLS stays 0, VIOLATIONS stays 0, and this hard
# gate printed "Rule I passed" and exited 0 because its matcher was unavailable.
# That is the identical shape FOLLOW-830 fixed in scripts/gh-pr-checks-verified.sh
# — which now reads ITS baseline out of this script's output, so a degraded
# matcher here also silently empties the set every PR is compared against.
# Refuse to run degraded. A named exit 3, never a verdict.
preflight_dependencies() {
  local cmd missing probe

  if [[ -z "${BASH_VERSINFO[0]:-}" || "${BASH_VERSINFO[0]}" -lt 4 ]]; then
    echo "ERROR: PREFLIGHT FAILED — bash >= 4 is required (the 'mapfile' builtin)." >&2
    echo "  Found: ${BASH_VERSION:-unknown}. macOS ships bash 3.2 as /bin/bash;" >&2
    echo "  install a newer bash (brew install bash) and re-run." >&2
    exit 3
  fi

  missing=""
  for cmd in git find xargs sort wc basename; do
    command -v "$cmd" >/dev/null 2>&1 || missing="$missing $cmd"
  done
  if [[ -n "$missing" ]]; then
    echo "ERROR: PREFLIGHT FAILED — required command(s) not on PATH:$missing" >&2
    exit 3
  fi

  # Probes the EXACT construct the symbol extractor uses — -P, \K, and the
  # identifier class — rather than merely "does -P exist". A grep whose PCRE
  # build lacks \K would pass a weaker probe and still extract nothing.
  probe="$(printf 'export const alphaProbe = 1\n' \
    | grep -oP 'export\s+const\s+\K[A-Za-z_$][A-Za-z0-9_$]*' 2>/dev/null || true)"
  if [[ "$probe" != "alphaProbe" ]]; then
    echo "ERROR: PREFLIGHT FAILED — this 'grep' cannot run the symbol extractor." >&2
    echo "  grep: $(command -v grep 2>/dev/null || echo 'not found')" >&2
    echo "  Probe 'export const alphaProbe = 1' | grep -oP ...\\K... returned" >&2
    echo "  '${probe}', expected 'alphaProbe'. PCRE (-P) with \\K is a GNU grep" >&2
    echo "  extension; BSD/macOS/busybox grep does not have it." >&2
    echo "  Without it EVERY symbol extraction returns nothing, and because this" >&2
    echo "  script runs without 'set -e' the result would be 'Violations found: 0'" >&2
    echo "  and 'Rule I passed' over a repo full of dead exports." >&2
    echo "  Refusing to run degraded. Install GNU grep (brew install grep) and re-run." >&2
    exit 3
  fi
}

# Guard R1: the repo root must resolve, and the cd into it must succeed.
# Previously `ROOT="$(git rev-parse --show-toplevel)"` was unguarded: with git
# missing or outside a working tree, ROOT became "" and `cd ""` is a SUCCESSFUL
# no-op in bash, so the scan ran against whatever the caller's cwd happened to
# be — typically finding no packages/ at all and reporting a clean pass.
resolve_repo_root() {
  local root
  root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if [[ -z "$root" ]]; then
    echo "ERROR: PREFLIGHT FAILED — not inside a git working tree." >&2
    echo "  'git rev-parse --show-toplevel' produced nothing, so there is no repo" >&2
    echo "  root to scan. Running from the current directory instead would report" >&2
    echo "  a clean pass over a tree that contains none of the code this gates." >&2
    exit 3
  fi
  cd "$root" || {
    echo "ERROR: PREFLIGHT FAILED — cannot cd into repo root '$root'." >&2
    exit 3
  }
}

# ── Self-test mode (FOLLOW-842 AC(3)) ─────────────────────────────────────────
# Hermetic and offline: every fixture below builds a THROWAWAY git repo in a
# temp dir and runs this very file against it, so nothing here depends on the
# real repo's current violation count (which changes on every merge) and nothing
# here can pass because the real repo happens to be in a convenient state.
# Each fixture was written red-first and observed failing against the version of
# this script that lacked its own fix, and only that fixture's own fix — see the
# revert matrix in the FOLLOW-842 PR body.
if [[ "${1:-}" == "--self-test" ]]; then
  echo "=== check-rule-i.sh --self-test ==="
  echo "Synthesized throwaway repos only; nothing below reads this repo's own state."
  echo ""

  preflight_dependencies

  st_self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  st_tmp="$(mktemp -d)"
  # shellcheck disable=SC2064  # expand $st_tmp now, not at trap time
  trap "rm -rf '$st_tmp'" EXIT
  st_out="$st_tmp/out.txt"
  st_failures=0
  st_passes=0

  # _st_repo <name> — a throwaway git repo with empty packages/ and apps/ trees.
  _st_repo() {
    local d="$st_tmp/$1"
    mkdir -p "$d/packages" "$d/apps"
    git init -q "$d" >/dev/null 2>&1
    echo "$d"
  }

  # _st_expect <label> <expected-rc> <repo-dir> [must-contain] [must-NOT-contain]
  # Asserts the SPECIFIC exit code, never merely non-zero, plus the reason. The
  # must-NOT-contain needles are the literal SUMMARY lines (padding included), so
  # that prose which merely quotes them inside a diagnostic does not match.
  _st_expect() {
    local label="$1" want_rc="$2" dir="$3" needle="${4:-}" forbidden="${5:-}"
    local rc=0
    (cd "$dir" && PATH="${ST_PATH_OVERRIDE:-$PATH}" bash "$st_self") > "$st_out" 2>&1 || rc=$?
    if [[ "$rc" -ne "$want_rc" ]]; then
      echo "SELF-TEST FAIL: $label"
      echo "  expected exit $want_rc, got $rc"
      st_failures=$((st_failures + 1))
      echo "--- gate output ---"
      cat "$st_out"
      echo "-------------------"
      return 0
    fi
    if [[ -n "$needle" ]] && ! grep -qF -- "$needle" "$st_out"; then
      echo "SELF-TEST FAIL: $label"
      echo "  exited $rc as expected, but never said '$needle' — the right verdict"
      echo "  for the wrong reason is not a pass."
      st_failures=$((st_failures + 1))
      echo "--- gate output ---"
      cat "$st_out"
      echo "-------------------"
      return 0
    fi
    if [[ -n "$forbidden" ]] && grep -qF -- "$forbidden" "$st_out"; then
      echo "SELF-TEST FAIL: $label"
      echo "  exited $rc as expected, but ALSO printed the forbidden line '$forbidden'."
      st_failures=$((st_failures + 1))
      echo "--- gate output ---"
      cat "$st_out"
      echo "-------------------"
      return 0
    fi
    st_passes=$((st_passes + 1))
    echo "OK: self-test PASSED — $label"
  }

  # ── S1: a wired export → 0, and the symbol really was counted ──────────────
  st_d="$(_st_repo wired)"
  mkdir -p "$st_d/packages/a/src"
  echo 'export const wiredHelper = 1;' > "$st_d/packages/a/src/util.ts"
  {
    echo "import { wiredHelper } from './util';"
    echo 'console.log(wiredHelper);'
  } > "$st_d/packages/a/src/main.ts"
  _st_expect "a wired export exits 0 with a non-zero symbol count" 0 "$st_d" \
    "Symbols scanned     : 1"

  # ── S2: an orphan export → 1, in the EXACT line shape the merge gate parses ─
  # This pins the output-format contract documented at the top of this file. The
  # cross-script parity fixture (feeding this line to gh-pr-checks-verified.sh's
  # own parser) is FOLLOW-848's; this one pins the producer side only.
  st_d="$(_st_repo orphan)"
  mkdir -p "$st_d/packages/a/src"
  echo 'export const orphanSymbol = 1;' > "$st_d/packages/a/src/orphan.ts"
  _st_expect "an orphan export exits 1 with the exact parsed WARN line" 1 "$st_d" \
    "WARN: 'orphanSymbol' in packages/a/src/orphan.ts — zero non-test importers"

  # ── S3: THE FOLLOW-842 CASE — a grep with no PCRE → 3, never "Rule I passed" ─
  # `grep -oP` is a GNU extension. On macOS/BSD/busybox it errors out, and under
  # `set -uo pipefail` (no -e) that used to leave the symbol loop empty and print
  # "Violations found: 0" / "Rule I passed" / exit 0 — over the orphan repo of S2,
  # which is genuinely red. Same shim technique as gh-pr-checks-verified.sh F7.
  st_nopcre="$st_tmp/nopcre"
  mkdir -p "$st_nopcre"
  st_real_grep="$(command -v grep)"
  # shellcheck disable=SC2016  # the shim body is literal text, not this shell's expansions
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
  ST_PATH_OVERRIDE="$st_nopcre:$PATH"
  _st_expect "a grep without -P exits 3 and never claims Rule I passed" 3 "$st_d" \
    "PREFLIGHT FAILED" "Rule I passed — all exported"
  unset ST_PATH_OVERRIDE

  # ── S4: source files scanned but ZERO symbols parsed → 3, not a clean 0 ────
  # AC(2). An empty parse is an error, not a pass: this is the fingerprint a
  # degraded matcher leaves behind even when the preflight above is passed by a
  # grep that is broken in some way the probe did not model.
  st_d="$(_st_repo no-exports)"
  mkdir -p "$st_d/packages/a/src"
  echo 'const notExported = 1;' > "$st_d/packages/a/src/plain.ts"
  _st_expect "scanning files but parsing zero symbols exits 3, not a clean pass" 3 "$st_d" \
    "PARSED ZERO EXPORTED SYMBOLS" "Violations found    :"

  # ── S5: zero source files discovered → 3, named as discovery, not as clean ─
  # The other half of AC(2)'s "distinguish parsed-nothing from found-nothing":
  # this is found-nothing, and it is a different diagnosis with a different fix.
  st_d="$(_st_repo empty)"
  _st_expect "discovering zero source files exits 3, named as discovery" 3 "$st_d" \
    "DISCOVERED ZERO SOURCE FILES" "Violations found    :"

  # ── S6: every discovered file barrel-skipped → 3, named as such ────────────
  # The third distinct "nothing": files existed and the matcher was fine, but the
  # barrel-skip heuristic consumed all of them, so the gate checked nothing. A
  # clean 0 here would be a pass earned by skipping the entire repo.
  st_d="$(_st_repo all-barrel)"
  mkdir -p "$st_d/packages/a/src"
  echo "export * from './src/thing';" > "$st_d/packages/a/index.ts"
  echo 'export const thing = 1;' > "$st_d/packages/a/src/thing.ts"
  _st_expect "an all-barrel-skipped scan exits 3 rather than passing clean" 3 "$st_d" \
    "SCANNED ZERO FILES" "Violations found    :"

  # ── S7: outside a git working tree → 3, never a pass over the wrong tree ───
  st_d="$st_tmp/not-a-repo"
  mkdir -p "$st_d"
  _st_expect "running outside a git working tree exits 3" 3 "$st_d" \
    "not inside a git working tree" "Rule I passed — all exported"

  # ── S8: this file's own mode (FOLLOW-842 AC(4), closing FOLLOW-831) ────────
  # backlog/HANDOFFS.md mandates a BARE `scripts/check-rule-i.sh` at four
  # delegation briefs. A 100644 gate fails "command not found" the moment someone
  # follows those instructions literally, and a chmod that is not recorded in the
  # git index does not survive a fresh clone.
  st_mode="$(stat -c '%a' "$st_self" 2>/dev/null || stat -f '%Lp' "$st_self" 2>/dev/null || echo '')"
  if [[ "$st_mode" == "755" ]]; then
    st_passes=$((st_passes + 1))
    echo "OK: self-test PASSED — this script's filesystem mode is 755"
  else
    st_failures=$((st_failures + 1))
    echo "SELF-TEST FAIL: filesystem mode is '${st_mode:-unreadable}', expected 755."
    echo "  Fix with: chmod 755 $st_self && git update-index --chmod=+x $st_self"
  fi

  st_git_mode="$(git ls-files -s -- "$st_self" 2>/dev/null | awk '{print $1}')"
  if [[ -z "$st_git_mode" ]]; then
    echo "NOTE: git index mode unavailable here (not a git checkout, or the script"
    echo "  is not a tracked path) — the filesystem assertion above is the binding one."
  elif [[ "$st_git_mode" == "100755" ]]; then
    st_passes=$((st_passes + 1))
    echo "OK: self-test PASSED — this script's git index mode is 100755"
  else
    st_failures=$((st_failures + 1))
    echo "SELF-TEST FAIL: git index mode is $st_git_mode, expected 100755."
    echo "  A chmod alone does not stick: git update-index --chmod=+x $st_self"
  fi

  echo ""
  if [[ "$st_failures" -gt 0 ]]; then
    echo "RESULT: --self-test FAILED — $st_failures fixture(s) failed, $st_passes passed."
    exit 1
  fi
  echo "RESULT: --self-test passed — $st_passes fixtures."
  exit 0
fi

preflight_dependencies
resolve_repo_root

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

# Guard D1: discovery must find something. Zero source files in a repo whose
# whole purpose this gate is means `find` failed, the layout moved, or we are
# scanning the wrong tree — none of which is "every export is wired".
if [[ "${#source_files[@]}" -eq 0 ]]; then
  echo "ERROR: DISCOVERED ZERO SOURCE FILES under packages/*/src or apps/*/src." >&2
  echo "  Repo root: $(pwd)" >&2
  echo "  Rule I therefore checked nothing. That is not a pass, so no" >&2
  echo "  'Violations found' line is printed and this exits 3." >&2
  echo "  Likely causes: the find(1) above failed, the monorepo layout changed," >&2
  echo "  or this ran against a tree that is not the Adaptive Listings repo." >&2
  exit 3
fi

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
      # OUTPUT FORMAT CONTRACT — parsed by gh-pr-checks-verified.sh. See header.
      echo "WARN: '${sym}' in ${file} — zero non-test importers"
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  done < <(
    grep -oP \
      'export\s+(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*|class\s+|const\s+|let\s+|var\s+|enum\s+|type\s+|interface\s+)\K[A-Za-z_$][A-Za-z0-9_$]*' \
      "$file" 2>/dev/null || true
  )
done

SCANNED=$(( ${#source_files[@]} - BARREL_SKIPPED ))

# Guard D2: the barrel-skip heuristic must not have consumed the whole scan.
# A "clean" result earned by skipping every file is a pass over nothing.
if [[ "$SCANNED" -le 0 ]]; then
  echo ""
  echo "ERROR: SCANNED ZERO FILES — all ${#source_files[@]} discovered source file(s) were" >&2
  echo "  barrel-skipped by is_barrel_exported(). Rule I inspected no exports at all," >&2
  echo "  which is not the same thing as every export being wired, so no" >&2
  echo "  'Violations found' line is printed and this exits 3." >&2
  echo "  Likely cause: the barrel heuristic over-matched (check the index.ts" >&2
  echo "  'export * from' patterns in the packages listed by the scan)." >&2
  exit 3
fi

# Guard D3 (FOLLOW-842 AC(2)): an empty parse is an error, not a pass.
# THIS is the assertion the PCRE fail-open needed. Files were scanned and the
# matcher returned nothing — in a TypeScript monorepo that is a broken extractor,
# never a genuinely export-free tree. Distinguished from D1 (found nothing to
# scan) and D2 (skipped everything) on purpose: three different diagnoses.
if [[ "$TOTAL_SYMBOLS" -eq 0 ]]; then
  echo ""
  echo "ERROR: PARSED ZERO EXPORTED SYMBOLS from $SCANNED scanned source file(s)." >&2
  echo "  The symbol extractor returned nothing at all. Reporting 'Violations found: 0'" >&2
  echo "  here would be a green earned by a matcher that did not run, which is the" >&2
  echo "  exact failure FOLLOW-842 exists to close, so no 'Violations found' line is" >&2
  echo "  printed and this exits 3." >&2
  echo "  Likely causes: 'grep -oP' is not extracting (a non-GNU grep that slipped" >&2
  echo "  past the preflight probe), or the export-matching regex was edited." >&2
  exit 3
fi

echo ""
echo "--- Summary ---"
echo "Files barrel-skipped: $BARREL_SKIPPED"
echo "Symbols scanned     : $TOTAL_SYMBOLS"
# OUTPUT FORMAT CONTRACT — parsed by gh-pr-checks-verified.sh. See header.
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
