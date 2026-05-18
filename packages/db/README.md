# @estalara/db

Drizzle ORM client and schema library for the Estalara Adaptive Listings monorepo. Targets Supabase
Postgres with pgBouncer connection pooling.

## Schema overview

15 tables across migrations 0000–0012:

| Table                       | Migration | RLS?                   | Description                                                                        |
| --------------------------- | --------- | ---------------------- | ---------------------------------------------------------------------------------- |
| `tenants`                   | 0000      | Yes (0012)             | Agency accounts — plan, status, brand/quiz config                                  |
| `tenant_registrations`      | 0000      | No (service role only) | Inbound sign-up requests pending admin approval                                    |
| `users`                     | 0000      | Yes (0012)             | RBAC for agency staff and Estalara employees                                       |
| `api_keys`                  | 0000      | Yes (0012)             | Public/secret API keys with scopes, rotation, and revocation                       |
| `staff_audit_log`           | 0000      | No (service role only) | Append-only audit log of all Estalara admin actions — 7-year retention             |
| `consent_records`           | 0000      | Yes (0012)             | Generic consent tracking (anonymous, no PII)                                       |
| `demo_sessions`             | 0001      | Yes (0012)             | Tenant-scoped demo sessions for the onboarding wizard                              |
| `archetype_embeddings`      | 0002      | No (CAT-B global)      | Global cross-tenant archetype space (seeded by 0005)                               |
| `session_embeddings`        | 0002      | Yes (0012)             | Anonymous visitor session embeddings; CAT-D — ML reads via service_role            |
| `tenant_site_schemas`       | 0003      | Yes (0012)             | Auto-detected CSS selectors per tenant domain                                      |
| `ab_bandit_weights`         | 0004      | Yes (0004)             | Thompson sampling Beta parameters per (tenant, archetype, variant); seeded by 0007 |
| `answers`                   | 0006      | Yes (0006)             | Agency FAQ content per listing; 1536-dim embedding for RAG retrieval               |
| `schema_validation_history` | 0008      | Yes (0008, SELECT)     | Daily cron validation results per tenant                                           |
| `tenant_compliance_records` | 0009      | Yes (0009, SELECT)     | GDPR LIA records — service role INSERT only                                        |
| `dsr_verifications`         | 0011      | Yes (0011)             | OTP-based DSR (access/erase/portability) request tokens                            |

RLS policies are applied via migration 0012 (`migrations/0012_rls_policies.sql`). All policies use
the `current_setting('request.jwt.claims', true)` pattern. `staff_audit_log`,
`tenant_registrations`, and `archetype_embeddings` are intentionally exempt from RLS (accessed via
service role only).

---

## Client usage

### Tenant queries (RLS enforced)

```typescript
import { createTenantClient } from '@estalara/db';
const db = createTenantClient(jwtToken); // pass tenant JWT for RLS
```

Uses `DATABASE_URL` (pooled pgBouncer, port 6543). Row Level Security is **enforced** — each query
sees only the calling tenant's data. Always pass the tenant's JWT so Supabase RLS policies can read
`auth.jwt()` claims.

### Admin / migration operations (RLS bypassed)

```typescript
import { createAdminClient } from '@estalara/db';
const db = createAdminClient(); // service role — never use in tenant API routes
```

Uses `DATABASE_URL_ADMIN` (direct connection, port 5432, service role). Row Level Security is
**bypassed**. Use only for migrations, seeding, and master admin operations. Never expose this
client to the control plane tenant dashboard or any tenant-facing route.

---

## Overview

This package provides:

- `createTenantClient(jwtToken?)` — RLS-enforced client for tenant API routes
- `createAdminClient()` — service-role client for migrations and admin ops
- `createClient(url, options?)` — low-level factory (prefer the named clients above)
- `drizzle.config.ts` — drizzle-kit configuration for code generation and Studio
- `scripts/migrate.ts` — migration runner for CI and local dev
- `src/schema/` — schema barrel; downstream tickets add table definitions here
- `migrations/` — generated SQL migration files, version-controlled

## Connection architecture

Supabase exposes two Postgres endpoints. We use both:

| Variable              | Port | Via       | Use                      |
| --------------------- | ---- | --------- | ------------------------ |
| `DATABASE_URL_DIRECT` | 5432 | Direct    | Migrations, scripts      |
| `DATABASE_URL`        | 6543 | pgBouncer | App queries (serverless) |

**Always run migrations against the direct URL.** pgBouncer is a connection pooler in transaction
mode — it multiplexes many application connections onto a small number of real Postgres connections.
This is great for serverless workloads but incompatible with session-level features like prepared
statements.

## pgBouncer + prepared statements gotcha

pgBouncer in transaction mode does **not** support prepared statements. If you issue a query with
`prepare: true` (the postgres.js default) against the pooled port (6543), you will get errors like:

```
ERROR: prepared statement "s1" already exists
```

`createClient` handles this automatically: pass `{ poolMode: 'session' }` for pooled connections and
it sets `prepare: false`. For direct connections (migrations, scripts) the default
`poolMode: 'transaction'` keeps prepared statements enabled.

```typescript
// App code — pooled, session mode, prepare disabled
const db = createClient(process.env.DATABASE_URL!, { poolMode: 'session' });

// Migration scripts — direct, transaction mode, prepare enabled
const db = createClient(process.env.DATABASE_URL_DIRECT!);
```

## Row-Level Security (RLS) reminder

All tenant-scoped tables **must** have RLS policies. Without RLS, a bug that leaks a `tenant_id`
into the wrong query could expose another tenant's data. The pattern is:

```sql
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant isolation" ON tenants
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

Drizzle does not manage RLS policies — put them in the migration SQL file alongside the
`CREATE TABLE` statement. See TICKET-021 for the canonical example.

## How to add a new table

1. **Create a schema file** in `packages/db/src/schema/`:

   ```typescript
   // packages/db/src/schema/listings.ts
   import { pgTable, uuid, text, timestamptz } from 'drizzle-orm/pg-core';

   export const listings = pgTable('listings', {
     id: uuid('id').primaryKey().defaultRandom(),
     tenantId: uuid('tenant_id').notNull(),
     title: text('title').notNull(),
     createdAt: timestamptz('created_at').notNull().defaultNow(),
     updatedAt: timestamptz('updated_at').notNull().defaultNow(),
     deletedAt: timestamptz('deleted_at'),
   });
   ```

2. **Re-export it** from the schema barrel:

   ```typescript
   // packages/db/src/schema/index.ts
   export * from './listings.js';
   ```

3. **Generate the migration SQL**:

   ```bash
   pnpm db:generate
   ```

   This runs `drizzle-kit generate` and writes a new SQL file to `packages/db/migrations/`.

4. **Review the SQL** — open the generated file, verify it matches intent, and add RLS policies
   below the `CREATE TABLE` statement.

5. **Apply locally**:

   ```bash
   DATABASE_URL_DIRECT=postgresql://postgres:password@localhost:5432/estalara \
     pnpm db:migrate
   ```

6. **Commit both files** — the schema TypeScript file and the generated SQL migration. Migration
   files are append-only; never modify an already-applied migration.

## How to apply migrations in CI

The CI pipeline (or Terraform apply hook) sets `DATABASE_URL_DIRECT` via Doppler. Running:

```bash
pnpm db:migrate
```

from the repo root executes `scripts/migrate.ts` against the direct Postgres URL. The script uses
`drizzle-orm/postgres-js/migrator` which tracks applied migrations in the `__drizzle_migrations`
table — it is idempotent and safe to run on every deploy.

## Common gotchas

### `RETURNING` in pgBouncer mode

`RETURNING` clauses work fine in pgBouncer transaction mode because they complete within a single
statement. However, any query that relies on server-side cursors or `DECLARE CURSOR` will fail.
Avoid those patterns in app queries.

### JSONB columns

Drizzle supports JSONB via `jsonb()`:

```typescript
import { jsonb } from 'drizzle-orm/pg-core';

autoDetectedSchema: jsonb('auto_detected_schema').$type<{
  selectors: Record<string, string>;
  confidence: number;
  detectedAt: string;
}>(),
```

The `$type<T>()` call is TypeScript-only — it does not add a DB-level constraint. Add a `CHECK`
constraint in the migration SQL if you need runtime validation.

### `db:push:dev` vs `db:generate` + `db:migrate`

| Command       | What it does                        | When to use            |
| ------------- | ----------------------------------- | ---------------------- |
| `db:push:dev` | Pushes schema directly, no SQL file | Local experiment only  |
| `db:generate` | Generates SQL migration file        | All other environments |

Never run `db:push:dev` against a shared or production database. It bypasses the migration history
and cannot be rolled back cleanly.

## Local development

```bash
# Install (from repo root)
pnpm install

# Build
pnpm --filter @estalara/db build

# Type check
pnpm --filter @estalara/db typecheck

# Tests
pnpm --filter @estalara/db test

# Open Drizzle Studio (browser GUI for the DB)
DATABASE_URL=postgresql://postgres:password@localhost:5432/estalara pnpm db:studio
```

## Environment variables

| Variable              | Required for         | Example                                           |
| --------------------- | -------------------- | ------------------------------------------------- |
| `DATABASE_URL_DIRECT` | Migrations, scripts  | `postgresql://postgres:pw@db.supabase.co:5432/db` |
| `DATABASE_URL`        | App queries (pooled) | `postgresql://postgres:pw@db.supabase.co:6543/db` |

Store these in Doppler — never commit real values. Copy `.env.example` to `.env.local` for local
development.
