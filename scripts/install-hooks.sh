#!/usr/bin/env bash
#
# install-hooks.sh — Setup git hooks via Lefthook for Estalara Adaptive Listings
#
# This script:
# 1. Installs Lefthook git hooks (pre-commit, commit-msg)
# 2. Verifies gitleaks is available (optional, but recommended)
# 3. Runs a smoke test to ensure hooks work
#
# Usage:
#   ./scripts/install-hooks.sh
#
# Called automatically by: (future) postinstall script or onboarding docs

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Repo root detection
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Estalara Adaptive Listings — Git Hooks Installation${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

cd "$REPO_ROOT"

# ── Step 1: Check pnpm dependencies ──────────────────────────────────────

echo -e "${BLUE}[1/5]${NC} Checking pnpm dependencies..."

if ! command -v pnpm >/dev/null 2>&1; then
  echo -e "${RED}✗ pnpm not found. Install via: npm install -g pnpm${NC}"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo -e "${YELLOW}⚠  node_modules not found. Running pnpm install...${NC}"
  pnpm install --frozen-lockfile
else
  echo -e "${GREEN}✓ Dependencies OK${NC}"
fi

# ── Step 2: Install Lefthook hooks ───────────────────────────────────────

echo ""
echo -e "${BLUE}[2/5]${NC} Installing Lefthook git hooks..."

if ! pnpm exec lefthook install; then
  echo -e "${RED}✗ Lefthook install failed${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Lefthook hooks installed to .git/hooks/${NC}"

# ── Step 3: Check gitleaks availability (optional) ───────────────────────

echo ""
echo -e "${BLUE}[3/5]${NC} Checking gitleaks availability..."

if command -v gitleaks >/dev/null 2>&1; then
  GITLEAKS_VERSION=$(gitleaks version)
  echo -e "${GREEN}✓ gitleaks found: $GITLEAKS_VERSION${NC}"
else
  echo -e "${YELLOW}⚠  gitleaks not found (optional for local dev)${NC}"
  echo -e "${YELLOW}   Install recommended for full pre-commit protection:${NC}"
  echo -e "${YELLOW}     • macOS:   brew install gitleaks${NC}"
  echo -e "${YELLOW}     • Linux:   curl -sSfL https://github.com/gitleaks/gitleaks/releases/download/v8.18.0/gitleaks_8.18.0_linux_x64.tar.gz | tar -xz && mv gitleaks /usr/local/bin/${NC}"
  echo -e "${YELLOW}     • Windows: scoop install gitleaks${NC}"
  echo -e "${YELLOW}   Secrets will still be checked in CI if you skip local install.${NC}"
fi

# ── Step 4: Check commitlint ─────────────────────────────────────────────

echo ""
echo -e "${BLUE}[4/5]${NC} Verifying commitlint configuration..."

if [ ! -f "commitlint.config.cjs" ]; then
  echo -e "${RED}✗ commitlint.config.cjs not found${NC}"
  exit 1
fi

# Test commitlint on a sample message
TEST_MSG="feat(infra): test commit message [TICKET-004]"
if echo "$TEST_MSG" | pnpm exec commitlint >/dev/null 2>&1; then
  echo -e "${GREEN}✓ commitlint configured correctly${NC}"
else
  echo -e "${RED}✗ commitlint validation failed on test message${NC}"
  exit 1
fi

# ── Step 5: Smoke test ───────────────────────────────────────────────────

echo ""
echo -e "${BLUE}[5/5]${NC} Running smoke test..."

# Create a temporary test file
TEST_FILE=".git/hooks-test-$$"
echo "test" > "$TEST_FILE"

# Try to stage it
git add "$TEST_FILE" 2>/dev/null || true

# Test bad commit message (should fail)
echo ""
echo -e "${YELLOW}→ Testing commit-msg hook with invalid message...${NC}"

BAD_MSG="bad message without proper format"
if echo "$BAD_MSG" | GIT_EDITOR=true git commit -F - 2>&1 | grep -q "type-enum"; then
  echo -e "${GREEN}✓ commit-msg hook correctly rejects invalid format${NC}"
  # Reset the failed commit attempt
  git reset HEAD "$TEST_FILE" 2>/dev/null || true
else
  # If the commit succeeded, that's wrong
  if git log -1 --oneline 2>/dev/null | grep -q "bad message"; then
    echo -e "${RED}✗ commit-msg hook did not reject invalid message${NC}"
    git reset --soft HEAD~1
    git reset HEAD "$TEST_FILE" 2>/dev/null || true
    rm -f "$TEST_FILE"
    exit 1
  fi
fi

# Clean up test file
rm -f "$TEST_FILE"
git reset HEAD 2>/dev/null || true

# ── Done ─────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✓ Git hooks installed successfully!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "Pre-commit hooks active:"
echo -e "  • ${GREEN}prettier${NC} (format staged files)"
echo -e "  • ${GREEN}eslint${NC} (lint staged files)"
echo -e "  • ${GREEN}gitleaks${NC} (scan for secrets)"
echo ""
echo -e "Commit-msg hook active:"
echo -e "  • ${GREEN}commitlint${NC} (enforce Conventional Commits + [TICKET-XXX])"
echo ""
echo -e "To bypass hooks (not recommended): ${YELLOW}git commit --no-verify${NC}"
echo -e "See docs/runbooks/git-hooks.md for more information."
echo ""
