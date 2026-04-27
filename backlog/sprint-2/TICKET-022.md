---
id: TICKET-022
title: users table + tenant membership + Supabase Auth sync
sprint: 2
priority: P0
agent: backend-engineer
status: BLOCKED
estimated_hours: 4
depends_on: [TICKET-021]
produces: [TICKET-024]
affects_files:
  - 'packages/db/src/schema/users.ts'
  - 'packages/db/src/schema/tenant_members.ts'
  - 'packages/db/migrations/0002_create_users_and_members.sql'
  - 'packages/db/scripts/seed.ts'
  - 'packages/db/tests/schema/users.test.ts'
context_files:
  - packages/db/src/schema/tenants.ts (TICKET-021)
  - .claude/agents/backend-engineer.md
labels: [sprint-2, p0, backend, database, auth]
---

# TICKET-022: users table + tenant membership

## Summary

`users` table mirrors Supabase `auth.users` (one row per Supabase auth.users.id), and
`tenant_members` table is a many-to-many join: a user can belong to multiple tenants with a role per
tenant (admin/editor/viewer). RLS policies on both. Seed: link the 3 sample tenants (from
TICKET-021) to a single dev user.

## Context

Supabase Auth manages auth.users — we don't. Our own `public.users` mirrors it for FK relationships.
A trigger on `auth.users` insert auto-creates a `public.users` row. Tenant membership is independent
of auth: even after a user is created, they need an explicit row in `tenant_members` to access a
tenant.

Roles for MVP:

- `admin` — full access including billing, integrations, team management
- `editor` — can change brand tokens, signals, adapters; cannot change billing or remove members
- `viewer` — read-only

## Scope

### In scope

- `packages/db/src/schema/users.ts` — Drizzle schema for `users` (id, email, full_name, avatar_url,
  created_at, last_signed_in_at, deleted_at)
- `packages/db/src/schema/tenant_members.ts` — Drizzle schema for `tenant_members` (user_id FK,
  tenant_id FK, role enum, created_at, deleted_at; PK on (user_id, tenant_id))
- `packages/db/migrations/0002_create_users_and_members.sql` — generated DDL + RLS policies +
  auth.users trigger
- Seed update: insert one dev user, give them admin role on all 3 sample tenants
- Tests

### Out of scope

- Real Supabase Auth integration in apps (TICKET-024 wires JWT middleware)
- Invitation flow (Sprint 7)
- 2FA / MFA (Sprint 9)
- Audit log of role changes (Sprint 9)

## Acceptance criteria

- [ ] AC1: `users` table:
  - `id UUID PK` (matches `auth.users.id`)
  - `email TEXT NOT NULL UNIQUE`
  - `full_name TEXT`
  - `avatar_url TEXT`
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
  - `last_signed_in_at TIMESTAMPTZ`
  - `deleted_at TIMESTAMPTZ`
- [ ] AC2: `tenant_members` table:
  - `user_id UUID NOT NULL REFERENCES users(id)`
  - `tenant_id UUID NOT NULL REFERENCES tenants(tenant_id)`
  - `role TEXT NOT NULL CHECK (role IN ('admin','editor','viewer'))`
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
  - `deleted_at TIMESTAMPTZ`
  - `PRIMARY KEY (user_id, tenant_id)`
- [ ] AC3: RLS on `users`: user can SELECT/UPDATE only own row (`id = auth.uid()`)
- [ ] AC4: RLS on `tenant_members`: user can SELECT only their own memberships; admins of a tenant
      can SELECT all members of that tenant
- [ ] AC5: Trigger `on_auth_user_created` on `auth.users` INSERT auto-creates `public.users` row
- [ ] AC6: Index on `tenant_members(tenant_id, role)` for fast "who are admins of tenant X" queries
- [ ] AC7: Seed creates 1 dev user (email `dev@estalara.io`, fake auth.users id), inserts 3 admin
      memberships
- [ ] AC8: Tests: insertable, FK constraints work, RLS enforces correctly with simulated auth.uid(),
      unique email enforced
- [ ] AC9: All previous tests pass; migration runs cleanly
- [ ] AC10: PR title `feat(db): users + tenant_members tables [TICKET-022]`

## Implementation guidance

```typescript
// packages/db/src/schema/users.ts
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey(), // matches auth.users.id, NO defaultRandom
  email: text('email').notNull().unique(),
  fullName: text('full_name'),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSignedInAt: timestamp('last_signed_in_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
```

```typescript
// packages/db/src/schema/tenant_members.ts
import { pgTable, uuid, text, timestamp, primaryKey, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';
import { tenants } from './tenants.js';

export const tenantMembers = pgTable(
  'tenant_members',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.tenantId),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.tenantId] }),
    roleCheck: check('role_check', sql`${t.role} IN ('admin','editor','viewer')`),
    tenantRoleIdx: index('tenant_members_tenant_role_idx').on(t.tenantId, t.role),
  }),
);
```

After generation, append to migration:

```sql
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_self_access ON users
  FOR ALL TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY tenant_members_self ON tenant_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM tenant_members tm
    WHERE tm.user_id = auth.uid() AND tm.tenant_id = tenant_members.tenant_id AND tm.role = 'admin'
  ));

-- Trigger: when auth.users gets a row, mirror to public.users
CREATE OR REPLACE FUNCTION public.on_auth_user_created()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, avatar_url)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'avatar_url')
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.on_auth_user_created();
```

## Test plan

- Unit: types inferred correctly
- Integration: trigger fires on auth.users insert; RLS enforces correctly with simulated auth.uid()
- All previous tests pass

## Definition of Done

- [ ] Branch `backend-engineer/TICKET-022-users-tenant-members`
- [ ] PR title above
- [ ] All ACs verified
- [ ] CI green via `gh pr checks <pr> --watch`
- [ ] Prettier clean
- [ ] HANDOFF: TICKET-022 → TICKET-024 (JWT middleware uses these tables)

## Notes

- The trigger uses `SECURITY DEFINER` so it runs with elevated privileges. Audit this in security
  review (Sprint 9).
- Don't implement role changes in this ticket. Just the schema. Role mutation flows are Sprint 7
  work.
