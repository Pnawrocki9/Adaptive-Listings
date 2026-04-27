---
id: TICKET-020
title: Drizzle ORM setup + migrations folder structure + tooling
sprint: 2
priority: P0
agent: backend-engineer
status: BLOCKED
estimated_hours: 4
depends_on: [TICKET-009]
produces: [TICKET-021, TICKET-022, TICKET-023, TICKET-029]
affects_files:
  - 'packages/db/package.json'
  - 'packages/db/src/index.ts'
  - 'packages/db/src/client.ts'
  - 'packages/db/src/schema/index.ts'
  - 'packages/db/drizzle.config.ts'
  - 'packages/db/migrations/.gitkeep'
  - 'packages/db/scripts/migrate.ts'
  - 'packages/db/scripts/seed.ts'
  - 'packages/db/README.md'
context_files:
  - infra/terraform/supabase/* (TICKET-009)
  - .claude/agents/backend-engineer.md
labels: [sprint-2, p0, backend, database]
---

# TICKET-020: Drizzle ORM setup + migrations folder structure

## Summary

Set up Drizzle ORM in `packages/db/` as the canonical Postgres access layer for the entire monorepo.
Configure connection pooling (pgBouncer mode for serverless), migration generation
(`drizzle-kit generate`), migration runner (`migrate.ts`), seed script for dev. No actual schema yet
— that's TICKET-021. This ticket is just the plumbing.

## Context

Drizzle chosen over Prisma because: smaller bundle, type-safe SQL composition (not magic), works in
Cloudflare Workers (Prisma's Edge support is gimped), easier migration story.

We use Supabase for Postgres. Connection options:

- Direct connection (port 5432) — best for migrations
- Pooled connection (port 6543) — for app queries (pgBouncer)

We expose both via env vars: `DATABASE_URL` (pooled, for apps) and `DATABASE_URL_DIRECT` (direct,
for migrations).

## Scope

### In scope

- `packages/db/package.json` updated: name `@estalara/db`, deps `drizzle-orm`, `postgres` (the
  driver), devDeps `drizzle-kit`, `@types/pg`
- `packages/db/drizzle.config.ts` — drizzle-kit config: schema dir, migrations dir, dialect:
  postgresql, credentials from env
- `packages/db/src/client.ts` — `db` factory: `createClient(databaseUrl)` returns Drizzle client
  (uses `postgres` driver in transaction mode for direct, or session mode for pooled)
- `packages/db/src/schema/index.ts` — empty stub re-exporting from sub-files (filled in TICKET-021)
- `packages/db/scripts/migrate.ts` — runs pending migrations using
  `drizzle-orm/postgres-js/migrator`
- `packages/db/scripts/seed.ts` — empty stub for now (filled per-ticket as needed)
- `packages/db/migrations/.gitkeep` — preserves dir
- README documenting: how to add a new migration, how to apply, common gotchas (RLS quirks,
  RETURNING, JSONB)
- Add scripts to root `package.json`: `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:studio`,
  `pnpm db:push:dev`

### Out of scope

- Actual schemas (TICKET-021 +)
- RLS policies (TICKET-021)
- Production migration deploys (Sprint 10)

## Acceptance criteria

- [ ] AC1: `packages/db/package.json` has correct name, deps, devDeps; build script outputs `dist/`
- [ ] AC2: `packages/db/drizzle.config.ts` valid, points at `./src/schema/`, output `./migrations/`,
      dialect `postgresql`, env-driven credentials
- [ ] AC3: `packages/db/src/client.ts` exports `createClient(url, options?)` returning typed Drizzle
      client; handles both direct and pooled connection modes (config flag)
- [ ] AC4: `packages/db/scripts/migrate.ts` runs `drizzle-orm/postgres-js/migrator` against
      `DATABASE_URL_DIRECT`
- [ ] AC5: `pnpm db:generate` (root script) generates SQL from schemas (no schemas yet → no-op
      succeeds)
- [ ] AC6: `pnpm db:migrate` runs migrations against `DATABASE_URL_DIRECT` (env var) — succeeds
      against local docker Postgres
- [ ] AC7: `pnpm db:studio` opens Drizzle Studio (browser GUI)
- [ ] AC8: README covers all topics; minimum 300 words; includes example "how to add a new table"
- [ ] AC9: All CI checks pass (no Postgres needed for build; migration script test runs against
      ephemeral Docker)
- [ ] AC10: PR title `feat(db): drizzle orm setup [TICKET-020]`

## Implementation guidance

```typescript
// packages/db/drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema/*',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
});
```

```typescript
// packages/db/src/client.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type ClientOptions = {
  /** Use 'session' for pooled, 'transaction' for direct. Default: transaction (for migrations). */
  poolMode?: 'session' | 'transaction';
  max?: number;
};

export function createClient(databaseUrl: string, options: ClientOptions = {}) {
  const pool = postgres(databaseUrl, {
    max: options.max ?? 10,
    prepare: options.poolMode !== 'transaction' ? false : true, // pgbouncer transaction mode incompatible with prepared statements
  });
  return drizzle(pool, { schema });
}

export type Database = ReturnType<typeof createClient>;
export * from './schema/index.js';
```

```typescript
// packages/db/scripts/migrate.ts
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT;
if (!url) throw new Error('DATABASE_URL_DIRECT must be set');

const sql = postgres(url, { max: 1 });
const db = drizzle(sql);

await migrate(db, { migrationsFolder: './migrations' });
await sql.end();
console.log('Migrations applied.');
```

## Test plan

- Build: `pnpm --filter @estalara/db build` succeeds
- Type check: importing `Database` from another package compiles
- Migration: spin up docker Postgres, set DATABASE_URL_DIRECT, run `pnpm db:migrate` (succeeds with
  0 migrations)
- Studio: `pnpm db:studio` opens (manual verify)

## Definition of Done

- [ ] Branch `backend-engineer/TICKET-020-drizzle-setup`
- [ ] PR title above
- [ ] All ACs verified
- [ ] CI green via `gh pr checks <pr> --watch`
- [ ] Prettier clean
- [ ] HANDOFF: TICKET-020 → TICKET-021, 022, 023, 029 (all need Drizzle)

## Notes

- pgBouncer transaction mode + prepared statements = warnings/issues. Set `prepare: false` for
  pooled connections. This is non-obvious; document in README.
- Drizzle migrations are file-based, deterministic, version-controlled. Don't use `db:push` against
  shared environments — only for local dev.
