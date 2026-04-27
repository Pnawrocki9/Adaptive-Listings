# Handoffs

When one agent's ticket produces output another agent needs, the producing agent appends a handoff
note here. The PM reads this file before delegating downstream tickets.

## Format

```markdown
## TICKET-XXX → TICKET-YYY

**From:** <producing agent> **To:** <consuming agent> **Date:** <ISO timestamp> **Summary:** One
paragraph: what was produced, where it lives, key details. **Action required:** What the consuming
agent needs to do with it. **Files:** <list of relevant files / artifacts>
```

---

## TICKET-009 → TICKET-014 (ClickHouse)

**From:** devops-engineer  
**To:** data-engineer  
**Date:** 2026-04-27T14:00:00Z

**Summary:**

ClickHouse Cloud Terraform module skeleton created at `infra/terraform/clickhouse/`. The module
includes provider configuration, variables for organization ID and API credentials, and
commented-out resource definitions for ClickHouse service and password. The README documents cost
estimation (~$750-$1,000/month for EU region at MVP scale), architecture decisions (columnar storage
for append-only events), and performance budgets (<50ms write latency, <500ms query latency).

**Action required:**

1. Wait for human to create ClickHouse Cloud account and store credentials in Doppler (see
   ESCALATIONS.md)
2. Uncomment `resource "clickhouse_service"` and `resource "clickhouse_service_password"` in
   `main.tf`
3. Run `terraform apply` to provision EU region service
4. Use service endpoint and password to create first ClickHouse table (events table, partitioned by
   `tenant_id` + `date`)
5. Document table DDL and migration strategy in TICKET-014

**Files:**

- `infra/terraform/clickhouse/main.tf`
- `infra/terraform/clickhouse/variables.tf`
- `infra/terraform/clickhouse/README.md`
- `docs/runbooks/vendor-accounts.md` (section 2: ClickHouse Cloud)

---

## TICKET-009 → TICKET-015 (Modal)

**From:** devops-engineer  
**To:** data-engineer  
**Date:** 2026-04-27T14:00:00Z

**Summary:**

Modal does NOT have a Terraform provider (code-as-config via Python decorators instead). Created
`infra/terraform/modal/modal-config/` with `modal.toml` skeleton, `modal_setup.py` verification
script, and comprehensive README documenting Modal architecture, cost estimation (~$765/month for
MVP), and deployment strategy (`modal deploy` per-app in CI). Modal is used for stream consumer
(Redpanda → ClickHouse ETL), intent engine, adaptation engine, and auto-detection service.

**Action required:**

1. Wait for human to create Modal account, generate token (ID + secret), and store in Doppler
2. Authenticate Modal CLI locally:
   `modal token set --token-id $MODAL_TOKEN_ID --token-secret $MODAL_TOKEN_SECRET`
3. Create Modal secrets for third-party credentials (Anthropic API, Supabase, ClickHouse) via
   `modal secret create` (documented in runbook)
4. Implement stream consumer app in `apps/<stream-consumer>/src/main.py` (subscribe to Redpanda
   `events` topic, batch insert to ClickHouse)
5. Deploy via `modal deploy apps/<app>/src/main.py`

**Files:**

- `infra/terraform/modal/modal-config/modal.toml`
- `infra/terraform/modal/modal-config/modal_setup.py`
- `infra/terraform/modal/README.md`
- `docs/runbooks/vendor-accounts.md` (section 3: Modal)

---

## TICKET-009 → TICKET-020 (Supabase + Drizzle)

**From:** devops-engineer  
**To:** backend-engineer  
**Date:** 2026-04-27T14:00:00Z

**Summary:**

Supabase Terraform module skeleton created at `infra/terraform/supabase/`. The module includes
provider configuration, variables for Personal Access Token (PAT), organization ID, and database
password, and commented-out resource definitions for Supabase project. The README documents
multi-region architecture (EU/US/UK/UAE), cost estimation (~$100/month base for 4 regions), and
security notes (RLS policies required per-tenant, pgBouncer for connection pooling with 25
connections per region per service).

**Action required:**

1. Wait for human to create Supabase account, generate PAT, find org ID, and store all in Doppler
2. Uncomment `resource "supabase_project"` in `main.tf`
3. Run `terraform apply` to provision EU region project (Pro tier, $25/month)
4. Set up Drizzle ORM (`packages/db` or `apps/control-plane/db/`) with connection to Supabase
   Postgres
5. Create first migration: `tenants` table with RLS policies (see TICKET-021)
6. Document migration workflow (Drizzle vs. Supabase migrations UI vs. raw SQL)

**Files:**

- `infra/terraform/supabase/main.tf`
- `infra/terraform/supabase/variables.tf`
- `infra/terraform/supabase/README.md`
- `docs/runbooks/vendor-accounts.md` (section 1: Supabase)

---

## TICKET-003 → TICKET-018

**From:** devops-engineer  
**To:** devops-engineer  
**Date:** 2026-04-27  
**Summary:** Sentry + OTel baseline in packages/shared/src/observability/. Ingest wrapper at
apps/ingest/src/observability.ts. DSN env vars: SENTRY_DSN_INGEST (ingest), SENTRY_DSN_CONTROL_PLANE
(control-plane). OTel collector skeleton at infra/observability/otel-collector.yaml.  
**Action required:** TICKET-018 should add real span instrumentation to the ingest handler using
createTracer() and createLogger() from packages/shared/src/observability.  
**Files:**

- `packages/shared/src/observability/logger.ts`
- `packages/shared/src/observability/tracer.ts`
- `packages/shared/src/observability/error.ts`
- `packages/shared/src/observability/index.ts`
- `apps/ingest/src/observability.ts`
- `apps/control-plane/sentry.client.config.ts`
- `apps/control-plane/sentry.server.config.ts`
- `apps/control-plane/sentry.edge.config.ts`
- `infra/observability/otel-collector.yaml`
- `docs/runbooks/observability.md`

---
