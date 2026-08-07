# Worker scripts are managed via wrangler CLI in CI/CD
# This file defines the Workers infrastructure configuration

# Ingest Worker placeholder
# Actual deployment happens via wrangler deploy in .github/workflows/deploy-staging.yml
# Routes are defined in apps/ingest/wrangler.toml

# Decision API Worker placeholder
# Actual deployment happens via wrangler deploy
# Routes are defined in apps/decision-api/wrangler.toml

# Workers are deployed with:
# - wrangler deploy --env staging — a BUNDLE/UPLOAD SMOKE, workflow_dispatch-only.
#   CORRECTED 2026-08-07 (FOLLOW-878 / ESC-052): this line said "auto on merge to
#   main". Nothing auto-deploys, and `ingest-staging`/`decision-staging` have no DNS
#   record. There is no staging plane.
# - wrangler deploy --env production (manual, gated)
