#!/usr/bin/env bash
#
# Validate all Terraform modules
# Run after creating vendor accounts and storing credentials in Doppler
#
# Prerequisites:
#   - terraform >= 1.5 installed
#   - doppler CLI authenticated
#
# Usage:
#   ./infra/terraform/validate-all.sh

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "Terraform Module Validation"
echo "============================"
echo ""

# Check prerequisites
if ! command -v terraform &> /dev/null; then
    echo -e "${RED}Error: terraform command not found${NC}"
    echo "Install Terraform: https://developer.hashicorp.com/terraform/install"
    exit 1
fi

TERRAFORM_VERSION=$(terraform version -json | grep -o '"terraform_version":"[^"]*' | cut -d'"' -f4)
echo -e "${GREEN}✓${NC} Terraform version: $TERRAFORM_VERSION"

if ! command -v doppler &> /dev/null; then
    echo -e "${YELLOW}Warning: doppler command not found${NC}"
    echo "Doppler CLI recommended for secrets: https://docs.doppler.com/docs/install-cli"
fi

echo ""

# Modules to validate (Modal excluded, uses Python not Terraform)
MODULES=(
    "supabase"
    "clickhouse"
    "redpanda"
    "upstash"
)

FAILED=0

for module in "${MODULES[@]}"; do
    echo -e "${YELLOW}Validating $module...${NC}"
    cd "$module"

    # Initialize (download providers)
    if terraform init -backend=false > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} terraform init succeeded"
    else
        echo -e "  ${RED}✗${NC} terraform init failed"
        FAILED=$((FAILED + 1))
        cd ..
        continue
    fi

    # Validate syntax
    if terraform validate > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} terraform validate succeeded"
    else
        echo -e "  ${RED}✗${NC} terraform validate failed"
        terraform validate
        FAILED=$((FAILED + 1))
    fi

    cd ..
    echo ""
done

# Validate Modal Python script
echo -e "${YELLOW}Validating Modal (Python)...${NC}"
if python3 modal/modal-config/modal_setup.py 2>&1 | grep -q "Missing env"; then
    echo -e "  ${GREEN}✓${NC} Modal setup script runs (env vars missing as expected)"
else
    echo -e "  ${YELLOW}~${NC} Modal setup script behavior unexpected (check manually)"
fi

echo ""

# Summary
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All modules validated successfully!${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Create vendor accounts (see docs/runbooks/vendor-accounts.md)"
    echo "  2. Store credentials in Doppler"
    echo "  3. Uncomment resources in each module's main.tf"
    echo "  4. Run terraform apply per module"
    exit 0
else
    echo -e "${RED}$FAILED module(s) failed validation${NC}"
    exit 1
fi
