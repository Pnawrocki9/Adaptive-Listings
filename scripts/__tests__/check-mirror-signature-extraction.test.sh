#!/usr/bin/env bash
# Red-first proof for scripts/lib/extract-fn-signature.cjs (FOLLOW-1070).
#
# The pre-FOLLOW-1070 signature extraction in scripts/check-mirror-files.sh
# used `grep -E "^(export )?(async )?function ${fn}\(" "$file" | head -1`,
# which reads exactly ONE PHYSICAL LINE — so any function whose parameter
# list or return type spans multiple lines compared as literal text
# `function <name>(` on both sides, always "matching", regardless of the
# real params/return type. This gate exists to prove the FIX reads the whole
# declaration.
#
# Assertions:
#
#   1. REAL DIVERGENCE, CURRENT HEAD — apps/control-plane/src/app/api/adapt/
#      route.ts (canonical) vs apps/decision-api/src/lib/reorder.ts (mirror),
#      as committed right now. PR #825 changed the canonical's
#      `affinityScore` return type (AffinityResult vs number) and
#      `buildReorderDirective`'s arity (7 vs 6 params) + return type without
#      updating the mirror (RETRO-298 §4a LG-1/LG-2). Both MUST mismatch.
#      This is real, committed source — not a synthesized fixture — read
#      via `git show HEAD:<path>` into a temp file so this test does not
#      depend on (or mutate) the worktree's current checkout state (Rule AM).
#
#   2. HISTORICAL CONTROL — the ticket text for FOLLOW-1070 asked for a
#      comparison of the canonical's state at `b12a653f^` (the commit
#      immediately before PR #825 merged) against HEAD's mirror, expecting a
#      mismatch. Verified against the actual repository: this does NOT
#      reproduce a mismatch, because apps/decision-api/src/lib/reorder.ts
#      was never touched by PR #825 (`git diff 6066e868 b12a653f --
#      apps/decision-api/src/lib/reorder.ts` is empty) — at b12a653f^ the
#      canonical's affinityScore/buildReorderDirective were structurally
#      IDENTICAL to what the mirror has always had. Asserting a mismatch
#      there would be asserting something false about the repository. This
#      assertion instead proves the intended SPIRIT of that instruction —
#      that the extractor is sensitive to the exact change PR #825 made — by
#      comparing the canonical BEFORE (b12a653f^) against the canonical
#      AFTER (HEAD, unchanged since #825): same function, same file lineage,
#      only the PR's own diff between them. MUST mismatch.
#
#   3. SYNTHESIZED PAIR — two fixture functions differing ONLY in the return
#      type on line 4 of a 5-line multi-line declaration. MUST mismatch.
#
#   4. NEGATIVE CONTROL — two fixture functions with an IDENTICAL multi-line
#      declaration (different bodies, which must not affect the signature
#      comparison). MUST match, proving assertion 1/2/3 are not vacuously
#      "everything mismatches".
#
#   5. OBJECT-TYPE RETURN ANNOTATION — the canonical's real
#      `buildReorderDirective` return type is an object type literal
#      immediately followed by the body's opening brace
#      (`): { directive: X; scoringPath: Y } {`), which a naive brace
#      counter could misread as the body opening one token early. Asserts
#      the extracted signature for that function ends at `}` (the return
#      type's closing brace) and does NOT include the function body.
#
# Exit codes: 0 = all assertions passed, 1 = any assertion failed.
# Run: bash scripts/__tests__/check-mirror-signature-extraction.test.sh

set -uo pipefail # no -e: we need to inspect non-zero exit codes ourselves

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

EXTRACTOR="$ROOT/scripts/lib/extract-fn-signature.cjs"
FAILED=0
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

assert_mismatch() {
  local label="$1" file_a="$2" fn_a="$3" file_b="$4" fn_b="$5"
  local sig_a sig_b
  sig_a=$(node "$EXTRACTOR" "$file_a" "$fn_a")
  sig_b=$(node "$EXTRACTOR" "$file_b" "$fn_b")
  if [[ -z "$sig_a" || -z "$sig_b" ]]; then
    echo "FAIL: $label — extractor found nothing on one side (sig_a='$sig_a' sig_b='$sig_b')."
    FAILED=$((FAILED + 1))
    return
  fi
  if [[ "$sig_a" != "$sig_b" ]]; then
    echo "OK:   $label — correctly reports a mismatch."
  else
    echo "FAIL: $label — expected a mismatch, extractor reported identical signatures."
    echo "      both sides: $sig_a"
    FAILED=$((FAILED + 1))
  fi
}

assert_match() {
  local label="$1" file_a="$2" fn_a="$3" file_b="$4" fn_b="$5"
  local sig_a sig_b
  sig_a=$(node "$EXTRACTOR" "$file_a" "$fn_a")
  sig_b=$(node "$EXTRACTOR" "$file_b" "$fn_b")
  if [[ "$sig_a" == "$sig_b" && -n "$sig_a" ]]; then
    echo "OK:   $label — correctly reports a match."
  else
    echo "FAIL: $label — expected a match."
    echo "      a: $sig_a"
    echo "      b: $sig_b"
    FAILED=$((FAILED + 1))
  fi
}

# ── 1. Real divergence, current HEAD ─────────────────────────────────────────
head_canonical="$tmp/route.ts"
head_mirror="$tmp/reorder.ts"
git show HEAD:apps/control-plane/src/app/api/adapt/route.ts >"$head_canonical"
git show HEAD:apps/decision-api/src/lib/reorder.ts >"$head_mirror"

assert_mismatch "1a. affinityScore, HEAD canonical vs HEAD mirror (real PR #825 divergence)" \
  "$head_canonical" affinityScore "$head_mirror" affinityScore
assert_mismatch "1b. buildReorderDirective, HEAD canonical vs HEAD mirror (real PR #825 divergence)" \
  "$head_canonical" buildReorderDirective "$head_mirror" buildReorderDirective

# ── 2. Historical control — canonical before vs after PR #825's own diff ────
pre825_canonical="$tmp/route.pre825.ts"
if ! git show 'b12a653f^:apps/control-plane/src/app/api/adapt/route.ts' >"$pre825_canonical" 2>/dev/null; then
  echo "FAIL: 2. could not read b12a653f^ — has the commit been rewritten/GC'd?"
  FAILED=$((FAILED + 1))
else
  assert_mismatch "2a. affinityScore, pre-#825 canonical vs HEAD canonical (PR #825's own change)" \
    "$pre825_canonical" affinityScore "$head_canonical" affinityScore
  assert_mismatch "2b. buildReorderDirective, pre-#825 canonical vs HEAD canonical (PR #825's own change)" \
    "$pre825_canonical" buildReorderDirective "$head_canonical" buildReorderDirective

  # Documents the literal ticket instruction (pre-#825 canonical vs HEAD
  # mirror) against real data: reorder.ts was never touched by #825, so this
  # is a MATCH, not a mismatch — see header comment.
  assert_match "2c. (documentation) affinityScore, pre-#825 canonical vs HEAD mirror — reorder.ts untouched by #825" \
    "$pre825_canonical" affinityScore "$head_mirror" affinityScore
fi

# ── 3. Synthesized pair — return type differs only on line 4 ────────────────
cat >"$tmp/synth_a.ts" <<'EOF'
function computeThing(
  a: string,
  b: number,
): ResultA {
  return doSomething(a, b);
}
EOF
cat >"$tmp/synth_b.ts" <<'EOF'
function computeThing(
  a: string,
  b: number,
): ResultB {
  return doSomething(a, b);
}
EOF
assert_mismatch "3. synthesized pair, return type differs on line 4 of a multi-line declaration" \
  "$tmp/synth_a.ts" computeThing "$tmp/synth_b.ts" computeThing

# ── 4. Negative control — identical multi-line signature, different bodies ──
cat >"$tmp/synth_c.ts" <<'EOF'
function computeThing(
  a: string,
  b: number,
): ResultA {
  return somethingElseEntirely(b, a) + 1;
}
EOF
assert_match "4. negative control — identical multi-line signature, different bodies" \
  "$tmp/synth_a.ts" computeThing "$tmp/synth_c.ts" computeThing

# ── 5. Object-type return annotation immediately followed by the body ───────
sig=$(node "$EXTRACTOR" "$head_canonical" buildReorderDirective)
case "$sig" in
  *"scoringPath: ScoringPath }")
    echo "OK:   5. canonical buildReorderDirective signature ends at the return type's closing"
    echo "      brace, not the body — object-type return annotation handled correctly."
    ;;
  *)
    echo "FAIL: 5. expected signature to end with 'scoringPath: ScoringPath }', got:"
    echo "      $sig"
    FAILED=$((FAILED + 1))
    ;;
esac
if [[ "$sig" == *"reorder_capable"* || "$sig" == *"if ("* ]]; then
  echo "FAIL: 5b. signature leaked body content — the extractor over-consumed past the opening brace."
  FAILED=$((FAILED + 1))
fi

echo ""
if [[ "$FAILED" -eq 0 ]]; then
  echo "ALL ASSERTIONS PASSED."
  exit 0
else
  echo "$FAILED assertion(s) FAILED."
  exit 1
fi
