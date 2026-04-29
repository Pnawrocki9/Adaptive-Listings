# Worker scripts are managed via wrangler CLI in CI/CD
# This file defines the Workers infrastructure configuration

# Ingest Worker placeholder
# Actual deployment happens via wrangler deploy in .github/workflows/deploy-staging.yml
# Routes are defined in apps/ingest/wrangler.toml

# Decision API Worker placeholder
# Actual deployment happens via wrangler deploy
# Routes are defined in apps/decision-api/wrangler.toml

# Workers are deployed with:
# - wrangler deploy --env staging (auto on merge to main)
# - wrangler deploy --env production (manual, gated)
