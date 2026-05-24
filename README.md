# Estalara Adaptive Listings

Embeddable AI layer + standalone SaaS that lets any real estate website serve listings adapted in
real time to each anonymous buyer based on chat, behavior, questions, and cross-listing journey.

This repository is run by an **agent-orchestrated workflow**: most code is written by specialized
Claude Code subagents under the supervision of a PM agent, with humans reviewing PRs and resolving
escalations.

## Status

**Pre-MVP / Sprint 0 / Repository scaffolding phase.**

| Sprint | Theme                 | State       |
| ------ | --------------------- | ----------- |
| 0      | Foundation            | In Progress |
| 1-11   | Per AGENT_WORKFLOW.md | Pending     |

---

## Prerequisites

| Tool   | Version  | Notes                                      |
| ------ | -------- | ------------------------------------------ |
| Node   | 22.x LTS | Use nvm: `nvm use` or mise: `mise install` |
| pnpm   | 9.x      | `corepack enable && corepack prepare`      |
| Python | 3.12+    | Required for Modal apps only               |
| Git    | 2.40+    |                                            |

Recommended: [mise](https://mise.jdx.dev/) (formerly `asdf`) — `.tool-versions` is present.

```bash
# Install mise (if not installed)
curl https://mise.run | sh

# Install all pinned tool versions
mise install
```

---

## Install

```bash
# Clone and enter
git clone git@github.com:pnawrocki9/adaptive-listings.git
cd adaptive-listings

# Install all Node dependencies (workspaces resolved automatically)
pnpm install
```

Secrets are managed via **Doppler** — never stored in `.env` files.

### Local development setup (one-time)

```bash
# 1. Install Doppler CLI: https://docs.doppler.com/docs/install-cli
doppler login

# 2. Link this repo to the Doppler project
doppler setup
# Select: project = estalara, config = dev

# 3. Verify auth
doppler me

# 4. Run any command with secrets injected
doppler run -- pnpm dev

# 5. Seed archetype embeddings (required for cosine-affinity path, §F.3)
#    Skip if you only need static contract tests.
doppler run -- pnpm seed:archetypes

# 6. (Optional) Seed demo listing embeddings for the investor demo path
doppler run -- pnpm seed:listings
```

Required Doppler secrets for a functional dev environment:

| Key                         | Purpose                                                             |
| --------------------------- | ------------------------------------------------------------------- |
| `DATABASE_URL`              | Supabase Postgres connection (PostgREST)                            |
| `DATABASE_URL_ADMIN`        | Direct Supabase connection (bypasses RLS; seed scripts)             |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role auth (seed scripts)                           |
| `OPENAI_API_KEY`            | Embedding generation (`pnpm seed:archetypes`, `pnpm seed:listings`) |
| `ANTHROPIC_API_KEY`         | AI Vision auto-detect + LLM gateway                                 |
| `UPSTASH_REDIS_REST_URL`    | Upstash Redis cache                                                 |
| `UPSTASH_REDIS_REST_TOKEN`  | Upstash Redis auth                                                  |

If any of these are missing from Doppler `dev` config, request access from Piotr or add them via the
[Doppler dashboard](https://dashboard.doppler.com).

---

## Development

```bash
# Start all services in dev mode (hot reload)
pnpm dev

# Start a specific app
pnpm --filter @estalara/ingest dev
pnpm --filter @estalara/control-plane dev
pnpm --filter @estalara/decision-api dev

# Python Modal apps (run locally without Modal)
cd apps/intent-engine
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
python src/main.py
```

---

## Lint

```bash
# Lint all packages and apps
pnpm lint

# Lint a specific package
pnpm --filter @estalara/shared lint

# Auto-fix
pnpm exec eslint --fix packages/shared/src
```

---

## Typecheck

```bash
# Typecheck all packages and apps
pnpm typecheck

# Typecheck a specific package
pnpm --filter @estalara/sdk typecheck
```

---

## Test

```bash
# Run all tests (TypeScript + skips Python)
pnpm test

# Run tests for a specific package
pnpm --filter @estalara/shared test

# Run Python tests for a specific Modal app
cd apps/intent-engine
pytest src/ -v

# Run all Python app tests (from repo root)
for app in intent-engine llm-gateway stream-consumer data-quality; do
  echo "=== $app ==="
  (cd apps/$app && pip install -e ".[dev]" -q && python -m pytest src/ -v)
done
```

---

## Build

```bash
# Build all TypeScript packages and apps
pnpm build

# Build a specific package
pnpm --filter @estalara/shared build
pnpm --filter @estalara/control-plane build

# Check bundle size against budgets (full impl in TICKET-018)
npx tsx scripts/check-bundle-size.ts
```

---

## Format

```bash
# Check formatting
pnpm format:check

# Fix formatting
pnpm format
```

---

## Deploy

Deployments are managed via **GitHub Actions** on tagged releases. No developer has direct
production deploy access.

```bash
# Deploy to staging (automatic on merge to main)
# Just merge a PR — CI handles the rest.

# Deploy to production (tagged release, requires human approval)
git tag v1.2.3
git push origin v1.2.3
# Then approve the deploy workflow in GitHub Actions UI
```

See `docs/runbooks/` for incident response, rollback procedures, and SLO definitions.

Terraform infrastructure is in `infra/terraform/`. Modules are organised per vendor. Apply via:

```bash
# Select environment workspace first (eu / us / uk / uae)
cd infra/terraform/supabase
terraform workspace select eu

# Apply a specific vendor module (e.g. Supabase)
terraform apply \
  -var="supabase_access_token=$(doppler secrets get SUPABASE_ACCESS_TOKEN --plain)" \
  -var="organization_id=$(doppler secrets get SUPABASE_ORG_ID --plain)" \
  -var="db_password=$(doppler secrets get SUPABASE_DB_PASSWORD --plain)"

# Validate all modules at once
cd infra/terraform && ./validate-all.sh
```

See `infra/README.md` for the full provisioning runbook and cost breakdown per vendor.

---

## Repository structure

See `docs/CONVENTIONS.md` for the canonical layout.

```
.
├── apps/                    # Deployable services (7 total)
│   ├── ingest/              # Cloudflare Worker — event ingest
│   ├── decision-api/        # Cloudflare Worker — adaptation decisions
│   ├── control-plane/       # Next.js 15 App Router — dashboard + management API
│   ├── intent-engine/       # Modal Python — buyer intent extraction
│   ├── llm-gateway/         # Modal Python — LiteLLM router
│   ├── stream-consumer/     # Modal Python — Redpanda → ClickHouse
│   └── data-quality/        # Modal Python — event validation
├── packages/                # Shared TypeScript libraries (10 total)
│   ├── sdk/                 # Core embeddable SDK
│   ├── sdk-loader/          # Tiny async loader (<2KB gzip)
│   ├── sdk-react/           # React wrapper
│   ├── sdk-vue/             # Vue wrapper
│   ├── shared/              # Zod schemas + shared types
│   ├── db/                  # Drizzle ORM schemas + migrations
│   ├── auth/                # JWT + API key utilities
│   ├── intent-ontology/     # 12-dimension buyer intent schema
│   ├── compliance/          # Consent + fair-housing linter
│   └── platform-templates/  # Pre-built platform fingerprints (Master Design B.7)
├── infra/                 # Terraform, ClickHouse DDL, observability
├── tests/                 # E2E, integration, load tests
├── docs/                  # Design docs, ADRs, runbooks, compliance
├── backlog/               # Ticket queue, sprint specs, escalations
├── scripts/               # Repo maintenance scripts
└── .claude/               # Agent definitions and hooks
```

---

## The agent team

Nine specialized Claude Code subagents, each with its own scope and quality bars:

| Agent                 | Role                                     |
| --------------------- | ---------------------------------------- |
| `pm-orchestrator`     | Drives the backlog                       |
| `architect`           | Interfaces and ADRs                      |
| `sdk-engineer`        | `@estalara/sdk` (Preact + Shadow DOM)    |
| `backend-engineer`    | Cloudflare Workers + Next.js + Postgres  |
| `data-engineer`       | ClickHouse + Redpanda + ETL              |
| `ml-engineer`         | Intent engine + adaptation + LLM gateway |
| `devops-engineer`     | Terraform + CI/CD + observability        |
| `qa-engineer`         | E2E + integration + load tests           |
| `compliance-engineer` | DPIA, GDPR/CCPA/PDPL, fair-housing       |

---

## Tech stack (decided — do not re-litigate)

| Concern       | Technology                                |
| ------------- | ----------------------------------------- |
| Monorepo      | Turborepo + pnpm                          |
| SDK           | TypeScript 5, Preact 10, tsup, Shadow DOM |
| Edge ingest   | Cloudflare Workers + Durable Objects      |
| Control plane | Next.js 15 App Router on Vercel           |
| ML services   | Modal (Python 3.12)                       |
| Event bus     | Redpanda Cloud                            |
| Postgres      | Supabase (multi-region, 4 projects)       |
| Event store   | ClickHouse Cloud                          |
| Vector store  | pgvector (MVP) → Qdrant (Y2)              |
| Cache         | Upstash Redis (multi-region)              |
| LLM           | Claude Haiku 4.5 + Sonnet 4.6 via LiteLLM |
| Embeddings    | OpenAI text-embedding-3-small (MVP)       |
| Observability | Sentry + OpenTelemetry + Grafana Cloud    |
| Secrets       | Doppler                                   |
| IaC           | Terraform + Terragrunt                    |

---

## Multi-region scope

| Region | Location  | Compliance      |
| ------ | --------- | --------------- |
| fra1   | Frankfurt | GDPR (EU/EEA)   |
| iad1   | Virginia  | CCPA/CPRA (US)  |
| lhr1   | London    | UK GDPR         |
| dxb1   | Dubai     | UAE PDPL + DIFC |

---

## License

Private and proprietary. Estalara Inc. All rights reserved.

## Contact

- Piotr Nawrocki — CEO — `piotr@estalara.io`
- Rafał Palak PhD — CTO — `rafal@estalara.io`
- Krystian Wojtkiewicz PhD — CPO — `krystian@estalara.io`

For agents: communicate only via `backlog/ESCALATIONS.md`.
