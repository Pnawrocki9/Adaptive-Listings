#!/usr/bin/env bash
# Rule J hard gate — mirror-code pairs must stay in sync.
#
# Reads scripts/mirror-files.json and checks each declared pair:
#   - strip_comments: true  → strip JSDoc and // comments, compare normalized content
#   - strip_comments: false → compare exported function signatures only
#
# BASENAME DISCOVERY (FOLLOW-746 AC1)
# ───────────────────────────────────
# The pair loop can only police copies somebody REMEMBERED to register. RETRO-235
# HW-4 found the resulting hole: `apps/<new-app>/src/observability.py` — a 4th,
# unregistered copy of the hardened Sentry initialiser — was invisible to this
# gate (not in the manifest) AND excluded by basename from
# check-sentry-init-singleton.sh, so an unhardened `sentry_sdk.init(` shipped
# green. FOLLOW-738's own rationale ("mirror a small observability.py into your
# app") makes that more likely, not less.
#
# So, for every pair that opts in with `"basename_discovery": true`, this gate
# now also SEARCHES the tree for files sharing a registered basename and fails
# on any that is not itself registered, naming the path.
#
# Opt-in, not automatic, because a registered basename can be a framework
# convention: `route.ts` (the adapt/reorder pair's canonical) matches 80
# unrelated Next.js App Router files. Pairs that opt OUT must carry a
# `basename_discovery_note` explaining the forgone coverage, and BOTH lists are
# printed in the discovery inventory on every run — a coverage gap that is
# visible in CI output rather than silent (Rule Q shape).
#
# SELF-TEST (FOLLOW-746 AC1 — red-first, and PROVEN to run)
# ─────────────────────────────────────────────────────────
#   bash scripts/check-mirror-files.sh --self-test
#
# Builds a synthetic repo in a temp dir (registered canonical + mirror, its own
# manifest) and asserts: clean → 0; drifted mirror → 1 (the pair check still
# works); synthetic UNREGISTERED 4th copy → 1, naming the path; copy removed →
# 0. Run against the pre-FOLLOW-746 script the 4th-copy assertion FAILS (that
# script exits 0 — the silent hole).
#
# The SAME self-test also runs inline at the start of every normal run (one
# summary line, full output only on failure). That is deliberate: this script's
# only automated invocations are `rule-j` in .github/workflows/ci.yml:501 and
# the lefthook pre-push hook, both of which call it with no arguments. A
# --self-test nobody invokes would be a script that only compiles. Skipped in
# child processes via MIRROR_FILES_SKIP_SELF_CHECK=1 (recursion guard).
#
# TEST HOOKS
#   MIRROR_FILES_ROOT           — repo root to operate on (default: git toplevel)
#   MIRROR_FILES_SKIP_SELF_CHECK — set to 1 to skip the inline self-check
#
# Exit codes: 0 = all pairs in sync and no unregistered copies,
#             1 = drift or an unregistered copy detected,
#             2 = the gate's own self-test failed (the gate is broken).
# Run: bash scripts/check-mirror-files.sh

set -euo pipefail

SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
ROOT="${MIRROR_FILES_ROOT:-$(git rev-parse --show-toplevel)}"
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

# ── Self-test (FOLLOW-746 AC1) ───────────────────────────────────────────────
# Prints one OK line per assertion; returns non-zero on the first failure.
run_self_test() {
  local tmp
  tmp=$(mktemp -d)
  # shellcheck disable=SC2064  # expand $tmp now, not at trap time
  trap "rm -rf '$tmp'" RETURN

  mkdir -p "$tmp/scripts" "$tmp/app-a/src" "$tmp/app-b/src/jobs"

  cat > "$tmp/scripts/mirror-files.json" <<'JSONEOF'
[
  {
    "canonical": "app-a/src/observability.py",
    "mirror": "app-b/src/jobs/observability.py",
    "strip_comments": true,
    "basename_discovery": true
  }
]
JSONEOF

  cat > "$tmp/app-a/src/observability.py" <<'PYEOF'
def init_sentry(dsn_env_name):
    return None
PYEOF
  cp "$tmp/app-a/src/observability.py" "$tmp/app-b/src/jobs/observability.py"

  local out rc
  _st_run() {
    rc=0
    out=$(MIRROR_FILES_ROOT="$tmp" MIRROR_FILES_SKIP_SELF_CHECK=1 bash "$SELF" 2>&1) || rc=$?
  }

  # 1. Registered pair, in sync, no stray copies → clean.
  _st_run
  if [[ "$rc" -ne 0 ]]; then
    echo "SELF-TEST FAIL: a synced pair with no stray copies was not clean (exit $rc)."
    echo "$out"
    return 1
  fi
  echo "OK: self-test — synced pair with no stray copies passes."

  # 2. Drifted mirror → 1 (the pre-existing pair check must still work).
  echo "    # drift" >> "$tmp/app-b/src/jobs/observability.py"
  _st_run
  if [[ "$rc" -ne 1 ]]; then
    echo "SELF-TEST FAIL: a drifted mirror was not reported (expected exit 1, got $rc)."
    echo "$out"
    return 1
  fi
  echo "OK: self-test — drifted mirror is still detected (pair check intact)."
  cp "$tmp/app-a/src/observability.py" "$tmp/app-b/src/jobs/observability.py"

  # 3. Synthetic UNREGISTERED 4th copy → 1, and the path must be named.
  #    RED-FIRST: the pre-FOLLOW-746 script exits 0 here (the silent hole).
  mkdir -p "$tmp/app-c/src"
  cat > "$tmp/app-c/src/observability.py" <<'PYEOF'
import sentry_sdk

def init_sentry(dsn_env_name):
    sentry_sdk.init(dsn="unregistered", traces_sample_rate=1.0)
PYEOF
  _st_run
  if [[ "$rc" -ne 1 ]]; then
    echo "SELF-TEST FAIL: an UNREGISTERED copy sharing a registered mirror basename was"
    echo "  not reported (expected exit 1, got $rc) — this is the FOLLOW-746 AC1 hole."
    echo "$out"
    return 1
  fi
  if ! echo "$out" | grep -q "app-c/src/observability.py"; then
    echo "SELF-TEST FAIL: the unregistered copy was reported without naming its path."
    echo "$out"
    return 1
  fi
  echo "OK: self-test — an unregistered 4th copy is detected and named (red-first)."

  # 4. Copy removed → clean again (the check is not stuck red).
  rm -rf "$tmp/app-c"
  _st_run
  if [[ "$rc" -ne 0 ]]; then
    echo "SELF-TEST FAIL: removing the unregistered copy did not restore a clean run (exit $rc)."
    echo "$out"
    return 1
  fi
  echo "OK: self-test — removing the unregistered copy restores a clean run."

  return 0
}

if [[ "${1:-}" == "--self-test" ]]; then
  echo "=== Rule J gate self-test (FOLLOW-746 AC1) ==="
  if run_self_test; then
    echo ""
    echo "Self-test PASSED."
    exit 0
  fi
  exit 2
fi

# Inline self-check on every normal run (see header: this is how the self-test
# is PROVEN to run — CI and lefthook both invoke this script with no args).
if [[ "${MIRROR_FILES_SKIP_SELF_CHECK:-}" != "1" ]]; then
  if self_check_out=$(run_self_test 2>&1); then
    echo "Rule J gate self-test: PASSED ($(echo "$self_check_out" | grep -c '^OK:') assertions)"
    echo ""
  else
    echo "FAIL: the Rule J gate's own self-test did not pass — the gate is broken,"
    echo "so its verdict on the real tree cannot be trusted."
    echo ""
    echo "$self_check_out"
    exit 2
  fi
fi

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

# ── Basename discovery (FOLLOW-746 AC1) ──────────────────────────────────────
echo "=== Basename discovery — unregistered copies of mirrored files ==="

REGISTERED_PATHS=$(node -e "
const m=require('$MANIFEST');
const s=new Set();
for (const p of m) for (const k of ['canonical','mirror']) if (p[k]) s.add(p[k]);
console.log([...s].join('\n'));
")

DISCOVER_BASENAMES=$(node -e "
const m=require('$MANIFEST');
const s=new Set();
for (const p of m) if (p.basename_discovery === true)
  for (const k of ['canonical','mirror']) if (p[k]) s.add(p[k].split('/').pop());
console.log([...s].join('\n'));
")

SKIPPED_BASENAMES=$(node -e "
const m=require('$MANIFEST');
const on=new Set(), off=new Set();
for (const p of m) for (const k of ['canonical','mirror']) if (p[k]) {
  (p.basename_discovery === true ? on : off).add(p[k].split('/').pop());
}
console.log([...off].filter(b => !on.has(b)).join('\n'));
")

if [[ -n "$DISCOVER_BASENAMES" ]]; then
  echo "Discovery ON for basenames:  $(echo "$DISCOVER_BASENAMES" | tr '\n' ' ')"
else
  echo "Discovery ON for basenames:  (none — every pair opted out)"
fi
if [[ -n "$SKIPPED_BASENAMES" ]]; then
  echo "Discovery OFF for basenames: $(echo "$SKIPPED_BASENAMES" | tr '\n' ' ')"
  echo "  (opted out in the manifest; see each pair's basename_discovery_note"
  echo "   for the forgone coverage — printed so the gap is visible, not silent)"
fi
echo ""

DISCOVERY_FAILURES=0
if [[ -n "$DISCOVER_BASENAMES" ]]; then
  while IFS= read -r basename_to_find; do
    [[ -z "$basename_to_find" ]] && continue
    found_count=0
    while IFS= read -r found_path; do
      [[ -z "$found_path" ]] && continue
      rel="${found_path#./}"
      found_count=$((found_count + 1))
      if printf '%s\n' "$REGISTERED_PATHS" | grep -Fxq -- "$rel"; then
        continue
      fi
      echo "FAIL: unregistered copy of a mirrored file: $rel"
      echo "      Its basename ($basename_to_find) IS registered in"
      echo "      scripts/mirror-files.json, but this path is not — so no gate"
      echo "      enforces that it matches the canonical, and"
      echo "      check-sentry-init-singleton.sh does not treat it as a"
      echo "      legitimate init site either (FOLLOW-746 AC1/AC2)."
      echo "      Fix: register it as a pair in scripts/mirror-files.json (and"
      echo "      make it byte-identical to the canonical), or delete it."
      DISCOVERY_FAILURES=$((DISCOVERY_FAILURES + 1))
      FAILURES=$((FAILURES + 1))
    done < <(
      find . \
        \( -name node_modules -o -name .git -o -name dist -o -name .next \
        -o -name .turbo -o -name coverage -o -name .venv -o -name __pycache__ \
        -o -name .worktrees \) -prune -o \
        -type f -name "$basename_to_find" -print 2>/dev/null
    )
    echo "    $basename_to_find: $found_count file(s) found under $ROOT"
  done <<< "$DISCOVER_BASENAMES"
fi

if [[ "$DISCOVERY_FAILURES" -eq 0 ]]; then
  echo "OK:  every file sharing a registered mirror basename is itself registered."
fi
echo ""

# ── Summary ───────────────────────────────────────────────────────────────────
if [[ "$FAILURES" -gt 0 ]]; then
  echo "Rule J FAILED: $FAILURES drift/unregistered-copy violation(s) found."
  echo "See CONVENTIONS_PATCH.md Rule J for remediation options."
  exit 1
else
  echo "✓ all mirror pairs in sync, no unregistered copies"
fi
