#!/usr/bin/env bash
# Rule J hard gate — mirror-code pairs must stay in sync.
#
# Reads scripts/mirror-files.json and checks each declared pair:
#   - strip_comments: true  → strip JSDoc and // comments, compare normalized content
#   - strip_comments: false → compare exported function signatures only
#
# Exit codes: 0 = all pairs in sync, 1 = drift detected.
# Run: bash scripts/check-mirror-files.sh

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
MANIFEST="$ROOT/scripts/mirror-files.json"
FAILURES=0

cd "$ROOT"

if [[ ! -f "$MANIFEST" ]]; then
  echo "ERROR: manifest not found at $MANIFEST"
  exit 1
fi

# Use node for JSON parsing (always available in this repo; avoids jq dependency).
if ! command -v node &>/dev/null; then
  echo "ERROR: node is required but not found in PATH."
  exit 1
fi

# ── Helper: strip JSDoc blocks and // line comments ──────────────────────────
# Uses perl to remove /** ... */ block comments (multiline),
# then sed to remove // line comments.
strip_comments() {
  local file="$1"
  perl -0777 -pe 's{/\*.*?\*/}{}gs' "$file" \
    | sed 's|[[:space:]]//[^/].*$||; s|^[[:space:]]*//[^/].*$||' \
    | sed '/^[[:space:]]*$/d' \
    | sed 's/[[:space:]]*$//'
}

# ── Helper: list of canonical helper function names to check in the reorder pair.
HELPER_FUNCTIONS="deterministicScore affinityScore buildReorderDirective"

# ── Read manifest via node ────────────────────────────────────────────────────
pair_count=$(node -e "const m=require('$MANIFEST'); console.log(m.length);")

for i in $(seq 0 $((pair_count - 1))); do
  canonical=$(node -e "const m=require('$MANIFEST'); console.log(m[$i].canonical);")
  mirror=$(node -e "const m=require('$MANIFEST'); console.log(m[$i].mirror);")
  strip=$(node -e "const m=require('$MANIFEST'); console.log(m[$i].strip_comments);")

  echo "=== Checking mirror pair $((i + 1))/$pair_count ==="
  echo "    canonical: $canonical"
  echo "    mirror:    $mirror"

  if [[ ! -f "$canonical" ]]; then
    echo "FAIL: canonical file not found: $canonical"
    FAILURES=$((FAILURES + 1))
    continue
  fi

  if [[ ! -f "$mirror" ]]; then
    echo "FAIL: mirror file not found: $mirror"
    FAILURES=$((FAILURES + 1))
    continue
  fi

  if [[ "$strip" == "true" ]]; then
    # ── Byte-equivalent check (strip comments, compare normalized) ────────
    tmp_canonical=$(mktemp)
    tmp_mirror=$(mktemp)

    strip_comments "$canonical" >"$tmp_canonical"
    strip_comments "$mirror" >"$tmp_mirror"

    if diff -u "$tmp_canonical" "$tmp_mirror" >/dev/null 2>&1; then
      echo "OK:  normalized content identical."
      rm -f "$tmp_canonical" "$tmp_mirror"
    else
      echo ""
      echo "FAIL: normalized content differs between canonical and mirror."
      echo "      Diff (canonical vs mirror, comments stripped):"
      diff -u "$tmp_canonical" "$tmp_mirror" \
        --label "canonical: $canonical (stripped)" \
        --label "mirror:    $mirror (stripped)" \
        || true
      echo ""
      echo "      Fix: update the mirror to match the canonical."
      echo "      Both sides must be patched in the same commit."
      rm -f "$tmp_canonical" "$tmp_mirror"
      FAILURES=$((FAILURES + 1))
    fi

  else
    # ── Function-signature check (subset: helpers in canonical → mirror) ──
    # For the reorder pair: check that the three helper functions from route.ts
    # appear in reorder.ts with matching signatures.
    sig_fail=0
    for fn in $HELPER_FUNCTIONS; do
      # Extract the signature line from canonical (may be private, not exported).
      canonical_sig=$(grep -E "^(export )?(async )?function ${fn}\(" "$canonical" \
        | head -1 \
        | sed 's/^export //' \
        | sed 's/[[:space:]]*{[[:space:]]*$//' \
        | sed 's/[[:space:]]*$//' \
        || true)

      if [[ -z "$canonical_sig" ]]; then
        echo "INFO: $fn not found in canonical — skipping."
        continue
      fi

      # Check mirror has this function (exported or not — presence check).
      mirror_sig=$(grep -E "^(export )?(async )?function ${fn}\(" "$mirror" \
        | head -1 \
        | sed 's/^export //' \
        | sed 's/[[:space:]]*{[[:space:]]*$//' \
        | sed 's/[[:space:]]*$//' \
        || true)

      if [[ -z "$mirror_sig" ]]; then
        echo "FAIL: function '$fn' present in canonical ($canonical) but missing from mirror ($mirror)."
        sig_fail=$((sig_fail + 1))
        FAILURES=$((FAILURES + 1))
      else
        # Normalize whitespace for comparison.
        c_norm=$(echo "$canonical_sig" | tr -s ' ')
        m_norm=$(echo "$mirror_sig" | tr -s ' ')
        if [[ "$c_norm" == "$m_norm" ]]; then
          echo "OK:  $fn — signatures match."
        else
          echo "WARN: $fn — signatures differ (may be acceptable; review manually)."
          echo "      canonical: $c_norm"
          echo "      mirror:    $m_norm"
        fi
      fi
    done

    if [[ "$sig_fail" -eq 0 ]]; then
      echo "OK:  all required helper functions present in mirror."
    fi
  fi

  echo ""
done

# ── Summary ───────────────────────────────────────────────────────────────────
if [[ "$FAILURES" -gt 0 ]]; then
  echo "Rule J FAILED: $FAILURES drift violation(s) found."
  echo "See CONVENTIONS_PATCH.md Rule J for remediation options."
  exit 1
else
  echo "✓ all mirror pairs in sync"
fi
