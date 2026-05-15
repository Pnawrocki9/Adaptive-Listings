#!/usr/bin/env bash
# check-compliance-docs.sh
# Validates that DPIA and ROPA contain the minimum required content for compliance gate.
# Exits non-zero if any check fails. Run by CI and PM-orchestrator before READY_FOR_REVIEW.
# TICKET-GDPR-001

set -euo pipefail

DPIA="docs/compliance/dpia.md"
ROPA="docs/compliance/ropa.md"
ERRORS=0

check() {
  local label="$1"
  local file="$2"
  local pattern="$3"
  local min_count="${4:-1}"

  local count
  count=$(grep -c -E "$pattern" "$file" 2>/dev/null || echo 0)
  if [ "$count" -lt "$min_count" ]; then
    echo "FAIL [$label] Expected >=$min_count match(es) of '$pattern' in $file, found $count"
    ERRORS=$((ERRORS + 1))
  else
    echo "PASS [$label] $count match(es) of '$pattern' in $file"
  fi
}

echo "=== Estalara Compliance Docs Check ==="
echo "DPIA: $DPIA"
echo "ROPA: $ROPA"
echo ""

# --- File existence ---
if [ ! -f "$DPIA" ]; then
  echo "FAIL [file-exists] $DPIA does not exist"
  ERRORS=$((ERRORS + 1))
else
  echo "PASS [file-exists] $DPIA exists"
fi

if [ ! -f "$ROPA" ]; then
  echo "FAIL [file-exists] $ROPA does not exist"
  ERRORS=$((ERRORS + 1))
else
  echo "PASS [file-exists] $ROPA exists"
fi

# --- Jurisdiction grep checks (AC item 6) ---
# DPIA: CCPA/CPRA >= 3
check "dpia-ccpa" "$DPIA" "CCPA|CPRA" 3

# DPIA: UAE/PDPL >= 3
check "dpia-uae" "$DPIA" "UAE|PDPL" 3

# DPIA: UK GDPR/ICO/PECR >= 3
check "dpia-uk" "$DPIA" "UK GDPR|ICO|PECR" 3

# ROPA: CCPA/CPRA >= 2
check "ropa-ccpa" "$ROPA" "CCPA|CPRA" 2

# ROPA: UAE/PDPL >= 2
check "ropa-uae" "$ROPA" "UAE|PDPL" 2

# ROPA: UK GDPR/ICO/PECR >= 2
check "ropa-uk" "$ROPA" "UK GDPR|ICO|PECR" 2

# --- Retention table completeness (AC item 4) ---
check "ropa-session-embeddings" "$ROPA" "session_embeddings" 1
check "ropa-adaptation-decisions" "$ROPA" "adaptation_decisions" 1
check "ropa-consent-records" "$ROPA" "consent_records" 1
check "ropa-ab-bandit-weights" "$ROPA" "ab_bandit_weights" 1
check "ropa-llm-calls" "$ROPA" "llm_calls" 1
check "ropa-answers" "$ROPA" "answers" 1

# --- Sub-processor completeness (AC item 5) ---
check "ropa-sub-processors" "$ROPA" "Anthropic|Supabase|Cloudflare|Modal" 4

# --- Risk count (DPIA must cover ≥5 risks) ---
check "dpia-risk-count" "$DPIA" "### Risk [A-E]" 5

# --- GDPR article references ---
check "dpia-art35" "$DPIA" "Art.*35|Article.*35" 2
check "dpia-art30" "$ROPA" "Art.*30|Article.*30" 2
check "dpia-art6" "$DPIA" "Art.*6|Article.*6" 3

# --- EDPB Guidelines 2/2023 reference ---
check "dpia-edpb" "$DPIA" "EDPB|Guidelines 2/2023" 1

# --- ePrivacy reference ---
check "dpia-eprivacy" "$DPIA" "ePrivacy|5\(3\)" 2

# --- Cross-border transfer mechanisms ---
check "dpia-scc" "$DPIA" "SCC|Standard Contractual Clause" 2
check "ropa-scc" "$ROPA" "SCC|Standard Contractual Clause|SCCs" 2
check "ropa-idta" "$ROPA" "IDTA|International Data Transfer Agreement" 1

# --- DPO reference ---
check "dpia-dpo" "$DPIA" "dpo@estalara|DPO" 2

echo ""
if [ "$ERRORS" -eq 0 ]; then
  echo "=== ALL CHECKS PASSED ==="
  exit 0
else
  echo "=== $ERRORS CHECK(S) FAILED ==="
  exit 1
fi
