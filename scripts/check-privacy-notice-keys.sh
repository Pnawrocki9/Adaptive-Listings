#!/usr/bin/env bash
# check-privacy-notice-keys.sh
#
# Asserts that every storage-key constant defined in the non-test Estalara SDK source
# (packages/sdk/src/**/*.ts) is disclosed in the Privacy Notice template
# (docs/compliance/PRIVACY_NOTICE_TEMPLATE.md §4).
#
# A storage-key constant is any symbol whose name ends in _STORAGE_KEY or _KEY_PREFIX,
# or _DISMISS_KEY, assigned to a string literal.
#
# The script extracts the string literal value of each matching constant and then
# checks that the value (or its prefix form for prefix-keyed entries) appears somewhere
# in PRIVACY_NOTICE_TEMPLATE.md.
#
# Exit codes:
#   0 — all keys are disclosed
#   1 — one or more keys are absent from the privacy notice
#
# Guardrail (Rule N, RETRO-036 CB-1): a key that appears in shipped SDK code but is absent
# from the privacy notice is a false disclosure-by-omission. This gate catches the gap before
# it reaches main.
#
# Run: bash scripts/check-privacy-notice-keys.sh
# Wired into: .github/workflows/ci.yml (privacy-notice-keys-sync job)
#
# FOLLOW-230

set -euo pipefail

SDK_SRC="packages/sdk/src"
PRIVACY_NOTICE="docs/compliance/PRIVACY_NOTICE_TEMPLATE.md"
ERRORS=0

if [ ! -d "$SDK_SRC" ]; then
  echo "FAIL [file-exists] SDK source directory '$SDK_SRC' not found"
  exit 1
fi

if [ ! -f "$PRIVACY_NOTICE" ]; then
  echo "FAIL [file-exists] Privacy notice '$PRIVACY_NOTICE' not found"
  exit 1
fi

echo "=== Estalara SDK Storage-Key / Privacy-Notice Sync Check ==="
echo "SDK source: $SDK_SRC"
echo "Privacy notice: $PRIVACY_NOTICE"
echo ""

# ---------------------------------------------------------------------------
# Step 1 — Collect *_STORAGE_KEY, *_KEY_PREFIX, and *_DISMISS_KEY constants
#          from non-test SDK TypeScript source files.
#
# We use two passes:
#   Pass A: extract lines containing the constant declaration
#   Pass B: extract the string literal from those lines using sed
# ---------------------------------------------------------------------------

# Collect all matching lines from non-test SDK source files
mapfile -t MATCHING_LINES < <(
  find "$SDK_SRC" -name "*.ts" \
    ! -path "*/node_modules/*" \
    ! -name "*.test.ts" \
    ! -name "*.spec.ts" \
    ! -path "*/__tests__/*" \
    -exec grep -hE "(export[[:space:]]+)?const[[:space:]]+[A-Z_]+((_STORAGE_KEY|_KEY_PREFIX|_DISMISS_KEY))[[:space:]]*=" {} \;
)

declare -a KEY_NAMES=()
declare -a KEY_VALUES=()

for line in "${MATCHING_LINES[@]}"; do
  # Extract constant name: word immediately before the '='
  # Remove 'export', 'const', whitespace; take the identifier part
  name=$(echo "$line" | sed -E "s/.*const[[:space:]]+([A-Z_]+(STORAGE_KEY|KEY_PREFIX|DISMISS_KEY)).*/\1/")
  if ! echo "$name" | grep -qE "^[A-Z_]+(STORAGE_KEY|KEY_PREFIX|DISMISS_KEY)$"; then
    continue
  fi

  # Extract the string literal value: content between first pair of ' or "
  value=$(echo "$line" | sed -E "s/.*=[[:space:]]*['\"]([^'\"]+)['\"].*/\1/")
  if [ -z "$value" ] || [ "$value" = "$line" ]; then
    # No string literal on this line — skip (may be a multi-line or non-string assignment)
    continue
  fi

  KEY_NAMES+=("$name")
  KEY_VALUES+=("$value")
done

if [ "${#KEY_NAMES[@]}" -eq 0 ]; then
  echo "WARNING: No *_STORAGE_KEY / *_KEY_PREFIX / *_DISMISS_KEY constants found in $SDK_SRC."
  echo "         This may indicate the grep pattern needs updating."
  exit 1
fi

echo "Found ${#KEY_NAMES[@]} storage-key constant(s):"
echo ""

# ---------------------------------------------------------------------------
# Step 2 — For each constant, assert its value (or a prefix-wildcard form)
#          appears in the privacy notice.
#
# For KEY_PREFIX constants the stored key is value + dynamic suffix.
# The privacy notice uses a wildcard form like 'estalara_variant:{sessionId}'.
# We strip everything after the first ':' to get the base for matching.
# ---------------------------------------------------------------------------

for i in "${!KEY_NAMES[@]}"; do
  name="${KEY_NAMES[$i]}"
  value="${KEY_VALUES[$i]}"

  # Base: everything before the first ':' (handles prefix keys like 'estalara_variant:')
  base="${value%%:*}"

  # Accept match if either the full literal OR the base prefix appears in the notice
  if grep -qF "$value" "$PRIVACY_NOTICE" 2>/dev/null; then
    echo "PASS  [$name]  '$value'  (exact match)"
  elif [ "$base" != "$value" ] && grep -qF "$base" "$PRIVACY_NOTICE" 2>/dev/null; then
    echo "PASS  [$name]  '$value'  (prefix '$base' found)"
  else
    echo "FAIL  [$name]  '$value'  NOT found in $PRIVACY_NOTICE"
    echo "      Add a row for '$value' to the §4 client-storage table."
    ERRORS=$((ERRORS + 1))
  fi
done

# ---------------------------------------------------------------------------
# Step 3 — Additional check: template-literal keys not captured by Step 1.
#
# The intentStateStorageKey() function in session.ts constructs the key as
# `estalara_intent_${sessionId}` — a template literal, not a named constant.
# We check the base string 'estalara_intent_' appears in the privacy notice.
# ---------------------------------------------------------------------------

INTENT_BASE="estalara_intent_"
if grep -qF "$INTENT_BASE" "$PRIVACY_NOTICE" 2>/dev/null; then
  echo "PASS  [intentStateStorageKey]  '$INTENT_BASE*'  (prefix found)"
else
  echo "FAIL  [intentStateStorageKey]  '$INTENT_BASE{sessionId}'  NOT found in $PRIVACY_NOTICE"
  echo "      Add a row for 'estalara_intent_{sessionId}' to the §4 client-storage table."
  ERRORS=$((ERRORS + 1))
fi

echo ""
if [ "$ERRORS" -eq 0 ]; then
  echo "=== ALL $((${#KEY_NAMES[@]} + 1)) KEY(S) DISCLOSED — PASS ==="
  exit 0
else
  echo "=== $ERRORS KEY(S) MISSING FROM PRIVACY NOTICE — FAIL ==="
  echo ""
  echo "To fix: add each missing key as a row in"
  echo "  $PRIVACY_NOTICE §4 (Client-Storage Table)"
  echo "with its storage type, data stored, lifetime, consent classification, and purpose."
  echo "Rule N guardrail: a key present in shipped SDK code but absent from the privacy"
  echo "notice is a compliance gap (RETRO-036 CB-1 / FOLLOW-230)."
  exit 1
fi
