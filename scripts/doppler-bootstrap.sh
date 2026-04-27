#!/usr/bin/env bash
# =============================================================================
# doppler-bootstrap.sh
# Idempotent first-time setup for Doppler secrets access.
# Run once after cloning the repo:  bash scripts/doppler-bootstrap.sh
# =============================================================================
set -euo pipefail

DOPPLER_PROJECT="estalara-adaptive-listings"
DOPPLER_CONFIG="dev"

# ── Colour helpers ─────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Colour

info()    { echo -e "${GREEN}[doppler-bootstrap]${NC} $*"; }
warn()    { echo -e "${YELLOW}[doppler-bootstrap] WARN:${NC} $*"; }
error()   { echo -e "${RED}[doppler-bootstrap] ERROR:${NC} $*" >&2; }
die()     { error "$*"; exit 1; }

# ── 1. Check Doppler CLI is installed ──────────────────────────────────────
if ! command -v doppler &>/dev/null; then
  warn "Doppler CLI not found."
  echo ""
  echo "Install Doppler CLI:"
  echo "  macOS (Homebrew):  brew install dopplerhq/cli/doppler"
  echo "  Linux/WSL:         curl -Ls https://cli.doppler.com/install.sh | sh"
  echo "  Windows (Scoop):   scoop bucket add doppler https://github.com/DopplerHQ/scoop-doppler.git && scoop install doppler"
  echo ""
  echo "After installing, re-run this script."
  exit 1
fi

DOPPLER_VERSION=$(doppler --version 2>&1 | head -1)
info "Doppler CLI found: ${DOPPLER_VERSION}"

# ── 2. Check authentication ────────────────────────────────────────────────
if ! doppler me &>/dev/null; then
  info "Not authenticated with Doppler. Running 'doppler login'..."
  doppler login
fi

info "Authenticated as: $(doppler me --json 2>/dev/null | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4 || echo 'unknown')"

# ── 3. Set up project config ───────────────────────────────────────────────
# Check if already set up for this project
CURRENT_PROJECT=$(doppler configure get project --plain 2>/dev/null || echo "")
CURRENT_CONFIG=$(doppler configure get config --plain 2>/dev/null || echo "")

if [[ "${CURRENT_PROJECT}" == "${DOPPLER_PROJECT}" && "${CURRENT_CONFIG}" == "${DOPPLER_CONFIG}" ]]; then
  info "Doppler already configured for project=${DOPPLER_PROJECT} config=${DOPPLER_CONFIG}"
else
  info "Configuring Doppler for project=${DOPPLER_PROJECT} config=${DOPPLER_CONFIG}..."
  doppler setup --project "${DOPPLER_PROJECT}" --config "${DOPPLER_CONFIG}" --no-interactive || {
    warn "Non-interactive setup failed (project may not exist yet in Doppler dashboard)."
    warn "Running interactive setup..."
    doppler setup
  }
fi

# ── 4. Smoke-test secret access ────────────────────────────────────────────
info "Verifying secret access..."
if doppler secrets --plain &>/dev/null; then
  SECRET_COUNT=$(doppler secrets --plain 2>/dev/null | wc -l | tr -d ' ')
  info "Access OK — ${SECRET_COUNT} secrets available in ${DOPPLER_PROJECT}/${DOPPLER_CONFIG}"
else
  warn "Could not list secrets — you may not have been added to the Doppler project yet."
  warn "Ask a team member to invite you to the '${DOPPLER_PROJECT}' Doppler project."
fi

# ── 5. Done ───────────────────────────────────────────────────────────────
echo ""
info "Bootstrap complete. You can now run:"
echo "  pnpm run dev:secrets    — start all services with secrets injected"
echo "  doppler run -- <cmd>    — run any command with secrets in environment"
echo ""
info "See docs/runbooks/secrets.md for full documentation."
