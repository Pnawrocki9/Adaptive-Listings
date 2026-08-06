#!/usr/bin/env bash
# Rule H hard gate — schema scaffolds must have runtime-wired consumers.
#
# Checks every PR diff for two concrete violation patterns:
#   1. API route files containing mock/stub markers with no FOLLOW-NNN reference
#   2. New lib/ exports (non-test) with zero non-test importers in apps/ or packages/
#
# Exit codes:
#   0 = pass
#   1 = violation found
#   3 = the gate could NOT run or could NOT render a verdict: failed dependency
#       preflight, unresolvable repo root, or a consumer count that could not be
#       produced. 3 is not a milder 1 and is emphatically not a 0.
#
# Run: scripts/check-rule-h.sh [base_branch]
#      scripts/check-rule-h.sh --self-test
# Default base_branch: origin/main
#
# ── FOLLOW-857: Pattern 2 could not fail for 84 days ──────────────────────────
# From 2026-05-14 (0a0a6880) to this fix, the consumer count was built by a
# pipeline ending `| wc -l || echo 0`. Under `pipefail`, when a symbol had ZERO
# non-test importers — the exact condition this gate exists to catch — the
# trailing `grep -v` exited 1, pipefail carried that past `wc -l`'s own "0", and
# `|| echo 0` appended a SECOND "0". consumer_count became the two-line string
# "0\n0"; `[[ "0\n0" -lt 1 ]]` is an arithmetic SYNTAX ERROR, which inside an
# `if` is simply false, so control fell through to the else and this hard gate
# printed `OK: ... — 0\n0 importer(s).` and exited 0. The value was corrupted by
# exactly and only the condition under test, so the gate's green was
# anti-correlated with the truth. The sibling scripts/check-rule-i.sh got the
# normalisation three days later and nobody diffed the pair — hence the shared
# scripts/lib/wired-or-dead-common.sh and the shared self-test fixture.

set -euo pipefail

WOD_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || WOD_LIB_DIR=""
if [[ -z "$WOD_LIB_DIR" || ! -f "$WOD_LIB_DIR/lib/wired-or-dead-common.sh" ]]; then
  echo "ERROR: PREFLIGHT FAILED — cannot locate scripts/lib/wired-or-dead-common.sh." >&2
  echo "  Rule H shares its preflight and self-test fixtures with Rule I; without" >&2
  echo "  that file this gate would run unguarded, which is what FOLLOW-857 fixed." >&2
  exit 3
fi
# shellcheck source=lib/wired-or-dead-common.sh
source "$WOD_LIB_DIR/lib/wired-or-dead-common.sh"

# Probes the EXACT construct the export extractor at Pattern 2 uses — -P, \K and
# the \w+ identifier class — not merely "does -P exist". FOLLOW-857 AC(2);
# same shape as FOLLOW-830 (gh-pr-checks-verified.sh) and FOLLOW-842
# (check-rule-i.sh). `grep -qP` at Pattern 1 is covered by the same probe.
preflight_dependencies() {
  wod_require_bash4
  wod_require_commands git grep wc node
  wod_probe_pcre "Rule H" \
    "export (?:async )?(?:function|class|const|let) \K\w+" \
    "export async function alphaProbe() {}" \
    "alphaProbe"
}

# ── Pattern 2 consumer count (FOLLOW-857 AC(1)) ───────────────────────────────
# Prints the count on stdout and returns 0, OR returns 2 meaning THE COUNT COULD
# NOT BE PRODUCED. A count that cannot be produced is not zero and is not one:
# it is the absence of a verdict, and the caller must say so rather than pick a
# number. grep exit 1 ("no lines matched") is a legitimate zero; grep exit >= 1
# from `grep -rl` on unreadable trees or a missing directory is not.
count_non_test_consumers() {
  local sym="$1" file="$2" matches filtered rc=0

  matches="$(grep -rl "\b${sym}\b" apps/ packages/ \
    --include="*.ts" --include="*.tsx" 2>/dev/null)" || rc=$?
  # 0 = matched, 1 = no match (a real zero), >= 2 = grep itself failed.
  if [[ "$rc" -gt 1 ]]; then
    return 2
  fi
  if [[ -z "$matches" ]]; then
    printf '0\n'
    return 0
  fi

  # Each exclusion below is a no-match-tolerant filter, never a pipeline abort:
  # `|| true` HERE is correct because "nothing survived the filter" is the
  # meaningful zero, unlike the `|| echo 0` this replaced, which appended a
  # second value to a count that already had one.
  filtered="$(printf '%s\n' "$matches" \
    | grep -v "__tests__" \
    | grep -v "\.test\." \
    | grep -v "\.spec\." \
    | grep -v "node_modules" \
    | grep -v "/dist/" \
    | grep -v "^${file}$" || true)"

  if [[ -z "$filtered" ]]; then
    printf '0\n'
    return 0
  fi
  printf '%s\n' "$filtered" | wc -l
}

# ── Self-test mode (FOLLOW-857 AC(3)) ─────────────────────────────────────────
# Wired to the green-required `rule-h-gate-self-test` CI job. The FIRST two
# fixtures are the SHARED ones scripts/check-rule-i.sh also runs, over the same
# throwaway repo built by the same function — that is the whole point: the pair
# diverged because nothing compared them, so a per-file harness would let them
# diverge again. Each fixture was written red-first against the pre-fix script;
# see the revert matrix in the FOLLOW-857 PR body.
if [[ "${1:-}" == "--self-test" ]]; then
  echo "=== check-rule-h.sh --self-test ==="
  echo "Synthesized throwaway repos only; nothing below reads this repo's own state."
  echo ""

  preflight_dependencies

  h_self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  h_failures=0
  h_passes=0

  # ── Shared with check-rule-i.sh: orphan must FAIL, wired must PASS ─────────
  wod_run_shared_fixtures "$h_self" "Rule H" \
    "has no non-test consumer" "importer(s)." main
  h_failures=$((h_failures + WOD_SHARED_FAILURES))
  h_passes=$((h_passes + WOD_SHARED_PASSES))

  # ── H1: THE FOLLOW-857 CASE, pinned on the VALUE and not only the verdict ──
  # The pre-fix bug printed the corrupted count into its own OK line. Assert the
  # count is rendered as a bare "0" nowhere and that the arithmetic never errors:
  # a run whose stderr carries "syntax error in expression" is the exact
  # fingerprint of `[[ "0\n0" -lt 1 ]]`, even if some later fixture masks the rc.
  h_tmp="$(mktemp -d)"
  # shellcheck disable=SC2064  # expand $h_tmp now, not at trap time
  trap "rm -rf '$h_tmp'" EXIT
  h_dir="$(wod_fixture_repo "$h_tmp" orphan-value orphan)"
  h_out="$h_tmp/out.txt"
  h_rc=0
  (cd "$h_dir" && bash "$h_self" main) > "$h_out" 2>&1 || h_rc=$?
  if grep -qF "syntax error in expression" "$h_out"; then
    echo "SELF-TEST FAIL: the consumer count reached [[ ]] as a non-integer."
    echo "  This is the FOLLOW-857 fingerprint: a multi-line count makes the -lt"
    echo "  comparison a syntax error, which inside an 'if' silently reads false."
    h_failures=$((h_failures + 1))
    cat "$h_out"
  elif grep -qE "^OK: +orphanFixtureSymbol" "$h_out"; then
    echo "SELF-TEST FAIL: the gate printed an OK line for an orphan export (rc=$h_rc)."
    h_failures=$((h_failures + 1))
    cat "$h_out"
  else
    h_passes=$((h_passes + 1))
    echo "OK: self-test PASSED — a zero consumer count reaches [[ ]] as one integer"
  fi

  # ── H2: a grep without -P exits 3 and never claims Rule H passed ───────────
  # Pattern 2's extractor is `grep -oP ... \K\w+` with an explicit `|| true`, so
  # on a non-PCRE host the symbol loop used to run zero times and the gate
  # printed "Rule H passed" / exit 0. Third live instance of the FOLLOW-830 /
  # FOLLOW-842 class. Same PATH-shim technique as check-rule-i.sh's S3.
  h_nopcre="$h_tmp/nopcre"
  mkdir -p "$h_nopcre"
  h_real_grep="$(command -v grep)"
  # shellcheck disable=SC2016  # the shim body is literal text, not this shell's expansions
  {
    echo '#!/usr/bin/env bash'
    echo 'for a in "$@"; do'
    echo '  case "$a" in'
    echo "    -*P*) echo \"grep: invalid option -- 'P'\" >&2; exit 2 ;;"
    echo '  esac'
    echo 'done'
    echo "exec $h_real_grep \"\$@\""
  } > "$h_nopcre/grep"
  chmod +x "$h_nopcre/grep"
  h_rc=0
  (cd "$h_dir" && PATH="$h_nopcre:$PATH" bash "$h_self" main) > "$h_out" 2>&1 || h_rc=$?
  if [[ "$h_rc" -ne 3 ]]; then
    echo "SELF-TEST FAIL: a grep without -P should exit 3, got $h_rc."
    h_failures=$((h_failures + 1))
    cat "$h_out"
  elif ! grep -qF "PREFLIGHT FAILED" "$h_out"; then
    echo "SELF-TEST FAIL: exited 3 without naming the preflight as the reason."
    h_failures=$((h_failures + 1))
    cat "$h_out"
  elif grep -qF "Rule H passed" "$h_out"; then
    echo "SELF-TEST FAIL: claimed 'Rule H passed' on a degraded matcher."
    h_failures=$((h_failures + 1))
    cat "$h_out"
  else
    h_passes=$((h_passes + 1))
    echo "OK: self-test PASSED — a grep without -P exits 3, never 'Rule H passed'"
  fi

  # ── H3: outside a git working tree → 3, never a pass over the caller's cwd ─
  h_notrepo="$h_tmp/not-a-repo"
  mkdir -p "$h_notrepo"
  h_rc=0
  (cd "$h_notrepo" && bash "$h_self" main) > "$h_out" 2>&1 || h_rc=$?
  if [[ "$h_rc" -ne 3 ]] || ! grep -qF "not inside a git working tree" "$h_out"; then
    echo "SELF-TEST FAIL: outside a git tree should exit 3 and say so, got $h_rc."
    h_failures=$((h_failures + 1))
    cat "$h_out"
  else
    h_passes=$((h_passes + 1))
    echo "OK: self-test PASSED — outside a git working tree exits 3"
  fi

  # ── H4: this file's own mode — HANDOFFS mandates a bare invocation ─────────
  h_mode="$(stat -c '%a' "$h_self" 2>/dev/null || stat -f '%Lp' "$h_self" 2>/dev/null || echo '')"
  if [[ "$h_mode" == "755" ]]; then
    h_passes=$((h_passes + 1))
    echo "OK: self-test PASSED — this script's filesystem mode is 755"
  else
    h_failures=$((h_failures + 1))
    echo "SELF-TEST FAIL: filesystem mode is '${h_mode:-unreadable}', expected 755."
  fi

  echo ""
  if [[ "$h_failures" -gt 0 ]]; then
    echo "RESULT: --self-test FAILED — $h_failures fixture(s) failed, $h_passes passed."
    exit 1
  fi
  echo "RESULT: --self-test passed — $h_passes fixtures."
  exit 0
fi

preflight_dependencies
wod_resolve_repo_root

BASE="${1:-origin/main}"
ROOT="$(pwd)"
FAILURES=0
UNDETERMINED=0

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
  # Extract exported function/class/const names.
  # The `|| true` below is load-bearing for "this file exports nothing" and was
  # ALSO, until FOLLOW-857, a silent fail-open on any host without PCRE grep:
  # the loop then ran zero times and the gate printed "Rule H passed" / exit 0.
  # preflight_dependencies() above now probes this exact construct, so reaching
  # here means -P and \K work and an empty result really means no exports.
  exports=$(grep -oP "export (?:async )?(?:function|class|const|let) \K\w+" "$file" \
    2>/dev/null || true)
  for sym in $exports; do
    # Count non-test importers (files that import this symbol, excluding the
    # defining file itself and any test files). rc 2 = the count could not be
    # produced, which is NOT zero and NOT a pass — see UNDETERMINED below.
    consumer_count=0
    count_rc=0
    consumer_count="$(count_non_test_consumers "$sym" "$file")" || count_rc=$?
    if [[ "$count_rc" -ne 0 ]]; then
      echo "UNDETERMINED: could not compute the consumer count for '$sym' ($file)."
      echo "      'grep -rl' over apps/ packages/ exited with an error (not a"
      echo "      no-match). Rule H renders NO verdict for this symbol rather than"
      echo "      assuming zero (which would be a false FAIL) or assuming one"
      echo "      (which would be the false GREEN FOLLOW-857 closed)."
      UNDETERMINED=$((UNDETERMINED + 1))
      continue
    fi
    # Normalise: strip any leading whitespace some wc implementations emit and
    # guarantee a single integer reaches [[ -lt ]]. Mirrors check-rule-i.sh:413.
    consumer_count=$((consumer_count + 0))
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

# ── Adapt sub-case (FOLLOW-105 / ADR-0006 §Decision 4) ───────────────────────
# Gate 1: SDK adapt-schema must not drift from the canonical AdaptationDirectives
#         contract. Gate 2: the Worker /api/adapt route must be retired (410 Gone,
#         no archetype-selection logic) — ADR-0004 §2 / ADR-0006 §Decision 3.
echo ""
echo "=== Rule H check: canonical /api/adapt enforcement ==="

# Gate 1 — adapt-response schema drift (delegates to the Node comparator).
if bash "$ROOT/scripts/check-adapt-schema-drift.sh"; then
  echo "OK:   adapt-response schema in sync with AdaptationDirectives."
else
  echo "FAIL: SDK adapt-schema drifted from the canonical AdaptationDirectives contract."
  FAILURES=$((FAILURES + 1))
fi

# Gate 2 — Worker /api/adapt must be retired (or absent). If the route file still
# exists it MUST return 410 and MUST NOT carry archetype-selection logic. Comments
# are stripped first so a JSDoc note describing the *removed* logic does not trip
# the gate (the retirement doc legitimately names detectArchetype).
worker_adapt="apps/decision-api/src/app/api/adapt/route.ts"
if [[ -f "$worker_adapt" ]]; then
  worker_code=$(node -e "const fs=require('fs');process.stdout.write(fs.readFileSync(process.argv[1],'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,''))" "$worker_adapt")
  if echo "$worker_code" | grep -qE "detectArchetype|_DIRECTIVES\b"; then
    echo "FAIL: $worker_adapt still contains archetype-selection logic"
    echo "      (detectArchetype / *_DIRECTIVES). ADR-0004 §2 forbids it in production;"
    echo "      ADR-0006 §Decision 3 retires this route to 410 Gone."
    FAILURES=$((FAILURES + 1))
  elif ! echo "$worker_code" | grep -qE "410"; then
    echo "FAIL: $worker_adapt exists but does not return 410 Gone (ADR-0006 §Decision 3)."
    FAILURES=$((FAILURES + 1))
  else
    echo "OK:   $worker_adapt is retired (410 Gone, no archetype-selection logic)."
  fi
else
  echo "OK:   $worker_adapt absent — Worker adapt route fully retired (FOLLOW-107)."
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
if [[ "$FAILURES" -gt 0 ]]; then
  echo "Rule H FAILED: $FAILURES violation(s) found."
  if [[ "$UNDETERMINED" -gt 0 ]]; then
    echo "  (plus $UNDETERMINED symbol(s) for which no verdict could be rendered.)"
  fi
  echo "See CONVENTIONS_PATCH.md Rule H for remediation options."
  exit 1
elif [[ "$UNDETERMINED" -gt 0 ]]; then
  echo "Rule H rendered NO VERDICT: $UNDETERMINED symbol(s) had an unproducible"
  echo "consumer count. Zero violations were found among the symbols that WERE"
  echo "checked, but that is not the same thing as a pass, so this exits 3."
  exit 3
else
  echo "Rule H passed — all schema scaffolds have runtime consumers or documented deferrals."
fi
