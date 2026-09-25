# Estalara Adaptive Listings

Embeddable AI layer + standalone SaaS that lets any real estate website serve listings adapted in
real time to each anonymous buyer based on chat, behavior, questions, and cross-listing journey.

This repository is run by an **agent-orchestrated workflow**: most code is written by specialized
Claude Code subagents under the supervision of a PM agent, with humans reviewing PRs and resolving
escalations.

## Status

**Active development — Sprint 22b (Full-Stack Audit Remediation) in progress.**

The 12-week MVP scaffold is built and a shadow-mode pilot is live on `app.estalara.com`; current
work closes the 2026-07-01 full-stack audit findings (F-01…F-21) before a _measured_ pilot. The
canonical, per-feature implementation status is **`docs/MASTER_DESIGN.md` §Snapshot.1** (single
source of truth per OPERATING_PRINCIPLES Rule 1) and live ticket state is **`backlog/QUEUE.md`** —
the table below is a pointer, not a status of record.

| Sprint | Theme                                    | State                             |
| ------ | ---------------------------------------- | --------------------------------- |
| 0–22a  | Foundation → shadow-mode pilot           | Shipped (with tracked follow-ups) |
| 22b    | Full-Stack Audit Remediation (F-01…F-21) | In Progress                       |

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
#    → writes to the HOSTED Supabase dev project (shared). Skip if you only
#      need static contract tests. For the LOCAL :5433 container, see §2 below.
doppler run -- pnpm seed:archetypes

# 6. (Optional) Seed demo listing embeddings for the investor demo path
#    → writes to whichever database the control plane at NEXT_PUBLIC_APP_URL
#      is pointed at (it POSTs /api/listings/embed; see §3 below).
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

## Local development setup

After cloning and running `pnpm install`, complete these one-time steps before starting the dev
server. Skipping them leaves the cosine-affinity adaptation path silently broken (it falls back to
djb2 hash scoring with no error output).

### 1. Authenticate Doppler

```bash
# Install Doppler CLI: https://docs.doppler.com/docs/install-cli
doppler login
doppler setup   # select project: estalara / config: dev
```

Required secrets the dev config provides:

| Key                         | Used by                                       |
| --------------------------- | --------------------------------------------- |
| `SUPABASE_URL`              | Drizzle DB client + seed scripts              |
| `SUPABASE_SERVICE_ROLE_KEY` | Seed scripts (bypasses RLS)                   |
| `OPENAI_API_KEY`            | `pnpm seed:archetypes` + `pnpm seed:listings` |
| `DATABASE_URL`              | Drizzle migrations (direct Postgres)          |

### 2. Seed archetype embeddings (one-shot, idempotent)

> **Cosine needs BOTH halves in the SAME database.** `affinityScore()` scores a listing by comparing
> an `archetype_embeddings` row with a `listing_embeddings` row, and the adapt route reads both
> through one `createAdminClient()`. §2 seeds the archetype half and §3 the listing half, and they
> pick their database by **different** mechanisms — so two green seeders can leave you with two
> populated databases and still no cosine row. After running both, prove co-location with the one
> command in §3: `pnpm db:assert:cosine` (FOLLOW-1193).

**Precondition — build `@estalara/db` first.** The seeder reaches the database through
`await import('@estalara/db')`, and that package resolves only via its `dist/` (`exports` →
`./dist/index.js`). On a fresh clone, or after any change under `packages/db/src/`, run:

```bash
pnpm --filter @estalara/db build
```

Without it `pnpm seed:archetypes` and `pnpm db:assert:cosine` fail on module resolution, not on
anything about your database.

**Which database each command writes to** — read this before running either (FOLLOW-1191):

| Command                                                     | Transport                  | Writes to                                                                  |
| ----------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------- |
| `doppler run -- pnpm seed:archetypes`                       | Supabase PostgREST         | the **hosted, shared** Supabase `dev` project                              |
| `pnpm seed:archetypes` with a loopback `DATABASE_URL_ADMIN` | direct Postgres            | the **local** container (`:5433`)                                          |
| `pnpm seed:listings`                                        | `POST /api/listings/embed` | whatever database the control plane at `NEXT_PUBLIC_APP_URL` is pointed at |

Hosted (shared — this mutates the database other people are using):

```bash
doppler run -- pnpm seed:archetypes
```

Localhost substrate (`docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md`). The loopback override must come
**after** `doppler run`, because `doppler run` overrides shell values set ahead of it — Doppler
`dev` defines `DATABASE_URL_ADMIN` for hosted Supabase:

```bash
doppler run -c dev -- env \
  DATABASE_URL_ADMIN='postgresql://supabase_admin:postgres@127.0.0.1:5433/postgres' \
  pnpm seed:archetypes
```

The seeder prints its target (`[archetype-seeder] target: …`) as its first line. A **loopback**
`DATABASE_URL_ADMIN` selects the direct-Postgres transport; a hosted one is left on the PostgREST
path. `ARCHETYPE_SEED_TRANSPORT=postgres` forces the direct transport and then **refuses** any
non-loopback host, so a stray `DATABASE_URL_ADMIN` cannot silently redirect a direct write at the
shared project.

Either way this calls OpenAI `text-embedding-3-small` for each of the 18 canonical archetype
descriptions and writes the 1024-dim vectors into `archetype_embeddings`. The script is idempotent —
re-running with all rows already populated is a no-op ("nothing to seed" log, exit 0).

**Why this matters:** `apps/control-plane/src/lib/embedding-lookup.ts` returns `null` for any
archetype whose `embedding` column is NULL, which silently degrades the entire adaptation chain to
the djb2 deterministic hash path. The cosine-affinity differentiator (Master Design §F.3) is
unreachable until this step runs. Until FOLLOW-1191 the seeder could ONLY reach the hosted project,
so every local database ran the djb2 path no matter what this section said.

Verify (the same assertion CI runs — row count, non-NULL, `vector_dims() = 1024`, every seeded name
present):

```bash
DATABASE_URL_ADMIN='postgresql://supabase_admin:postgres@127.0.0.1:5433/postgres' \
  pnpm --filter @estalara/db exec tsx scripts/assert-archetype-embeddings.ts
```

This checks the archetype half **only**. It passes on a database whose `listing_embeddings` is
empty, which is exactly the half-seeded state that still serves djb2. Once §3 has run, re-verify
both halves over one connection with `pnpm db:assert:cosine` (§3).

### 3. Seed listing embeddings (optional for local dev, required for demo)

`pnpm seed:listings` does not talk to a database directly — it POSTs every entry of
`DEMO_LISTING_MANIFEST` to `POST /api/listings/embed` on a **running control plane**, so the rows
land in whatever database **that server** was started with. It has no database of its own, and that
is the whole hazard: a plane started with a bare `doppler run -c dev` resolves the **hosted**
Supabase `dev` project even when §2 seeded your local `:5433` container.

Run these four steps **in order**, in three shells. Set the shared values once and reuse them as
variables — do not paste literals into a second command, where they drift:

```bash
# Shell A — values every step below reads. Pick any local secret; it only has to
# MATCH between the plane (step 2) and the seeder (step 3).
export LOCAL_DB_URL='postgresql://supabase_admin:postgres@127.0.0.1:5433/postgres'
export LOCAL_INTERNAL_SECRET="$(openssl rand -hex 24)"
export DEMO_TENANT_ID='00000000-0000-0000-0000-0000000000e2'   # the FOLLOW-819 fixture tenant
export FIXTURE_LISTING_ID='839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c'
export NEXT_PUBLIC_APP_URL='http://localhost:3000'
```

**Step 1 — archetype half, against the loopback database** (§2; the `env` form keeps the loopback
URL because `doppler run` overrides values set ahead of it, and Doppler supplies `OPENAI_API_KEY`):

```bash
doppler run -c dev -- env DATABASE_URL_ADMIN="$LOCAL_DB_URL" pnpm seed:archetypes
```

Note the `[archetype-seeder] target: …` line it prints. Every later step must name the same
database.

**Step 2 — start the control plane with the SAME database and that secret** (shell B). Doppler `dev`
defines neither `INTERNAL_API_SECRET` nor `DEMO_TENANT_ID`, and `POST /api/listings/embed` answers
401 to the internal header when the plane has no `INTERNAL_API_SECRET` at all:

```bash
doppler run -c dev -- env \
  DATABASE_URL_ADMIN="$LOCAL_DB_URL" \
  INTERNAL_API_SECRET="$LOCAL_INTERNAL_SECRET" \
  pnpm --filter @estalara/control-plane dev
```

**Step 3 — listing half** (shell C, once the plane answers):

```bash
INTERNAL_API_SECRET="$LOCAL_INTERNAL_SECRET" \
  DEMO_TENANT_ID="$DEMO_TENANT_ID" \
  NEXT_PUBLIC_APP_URL="$NEXT_PUBLIC_APP_URL" \
  pnpm seed:listings
```

The seeder prints `database  : host:port/name` — the database the **server** reported writing to —
before its first `[ok]`. It must be the one step 1 named. If a loopback plane reports a non-loopback
database, the seeder **stops** on the first write rather than scattering the rest (FOLLOW-1193).

**Step 4 — prove co-location.** One connection, both evaluators, and it prints the database it
checked:

```bash
DATABASE_URL_ADMIN="$LOCAL_DB_URL" pnpm db:assert:cosine \
  --tenant "$DEMO_TENANT_ID" --min-rows 13 --require-listing "$FIXTURE_LISTING_ID"
```

`--tenant` and `--min-rows` have no defaults on purpose: a default tenant is a guess, and a floor of
0 passes an empty table. A pass reports 18 archetype rows and at least 13 listing rows for
`$DEMO_TENANT_ID` — including `$FIXTURE_LISTING_ID`, the listing the FOLLOW-819 fixture page
declares — all non-NULL and 1024-dim, in one database.

Both halves must be non-NULL for cosine ranking: with archetype vectors seeded but
`listing_embeddings` empty, no `reorder` is served at all (FOLLOW-1202 made that fail closed; text
directives are unaffected). Skip §3 only if you are not running the full demo flow locally.

---

## Development

```bash
# Start all services in dev mode (hot reload)
pnpm dev

# Start a specific app
pnpm --filter @estalara/ingest dev
pnpm --filter @estalara/control-plane dev

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
├── apps/                    # Deployable services (6 total)
│   ├── ingest/              # Cloudflare Worker — event ingest
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
