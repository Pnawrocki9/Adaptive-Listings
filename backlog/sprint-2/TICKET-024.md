---
id: TICKET-024
title: JWT signing + tenant scoping middleware (Hono + Next.js)
sprint: 2
priority: P0
agent: backend-engineer
status: BLOCKED
estimated_hours: 5
depends_on: [TICKET-022, TICKET-023]
produces: [TICKET-026, TICKET-027]
affects_files:
  - 'packages/auth/src/jwt.ts'
  - 'packages/auth/src/middleware-hono.ts'
  - 'packages/auth/src/middleware-next.ts'
  - 'packages/auth/tests/jwt.test.ts'
  - 'packages/auth/tests/middleware.test.ts'
  - 'apps/control-plane/src/middleware.ts'
context_files:
  - packages/db/src/schema/users.ts (TICKET-022)
  - packages/db/src/schema/tenant_members.ts (TICKET-022)
  - packages/auth/src/api-keys.ts (TICKET-023)
  - .claude/agents/backend-engineer.md
labels: [sprint-2, p0, backend, security, auth]
---

# TICKET-024: JWT signing + tenant scoping middleware

## Summary

Wire authentication end-to-end: Supabase Auth issues access tokens (JWTs), our middleware validates
them, attaches `userId` + active `tenantId` + permissions to request context, and (importantly for
Postgres) sets `request.jwt.claims` so RLS policies enforce tenant isolation. Two middleware
variants: Hono (for Workers) and Next.js (for control-plane App Router). Active tenant chosen by
client via `X-Tenant-ID` header (validated against tenant_members membership).

## Context

After this ticket, every authenticated request to apps/control-plane API endpoints automatically:

1. Verifies Supabase JWT
2. Loads `userId` from JWT
3. Reads `X-Tenant-ID` from header
4. Validates user is a member of that tenant
5. Sets RLS context (`SET LOCAL request.jwt.claims = ...`) on Postgres connection
6. Attaches `{ userId, tenantId, role, scopes }` to request

If any step fails → 401/403 with standard error shape from TICKET-019.

## Scope

### In scope

- `packages/auth/src/jwt.ts`:
  - `verifySupabaseJwt(token, jwtSecret): { userId, email, exp }` — verifies JWT signature,
    expiration
  - `signTenantContext(payload, secret): string` — for cases where we issue our own JWT (rare in
    MVP, but useful for service-to-service)
- `packages/auth/src/middleware-hono.ts`:
  - `requireAuth()` middleware: checks `Authorization: Bearer <jwt>`, verifies, sets context
  - `requireTenant()` middleware: reads `X-Tenant-ID`, validates membership, sets RLS context
  - Combined `requireAuthAndTenant()` for convenience
- `packages/auth/src/middleware-next.ts`:
  - `withAuth(handler)` — Next.js Route Handler wrapper
  - `withTenant(handler)` — wraps + sets RLS
- `packages/auth/src/index.ts` — re-exports
- `apps/control-plane/src/middleware.ts` — top-level Next.js middleware that delegates to
  packages/auth
- Tests: signed JWT verifies; invalid JWT rejected; expired JWT rejected; X-Tenant-ID requires
  membership; non-member rejected with 403; RLS context properly set

### Out of scope

- Login UI (Sprint 7+ — Supabase has hosted UI for MVP)
- Token refresh handling (Supabase JS SDK handles it client-side)
- API key auth path (already in TICKET-023; this ticket is for user-session JWT auth)
- Service account tokens (Sprint 9+)

## Acceptance criteria

- [ ] AC1: `verifySupabaseJwt` verifies HS256 / RS256 signature, throws on invalid
- [ ] AC2: Hono `requireAuth` middleware: 401 if no Bearer token; 401 if invalid; sets
      `c.var.userId` on success
- [ ] AC3: Hono `requireTenant` middleware: 400 if no X-Tenant-ID; 403 if user not a member; sets
      `c.var.tenantId` and `c.var.role` and `c.var.scopes` on success
- [ ] AC4: Next.js `withAuth` and `withTenant` wrappers behave equivalently (return Response on
      failure with consistent error shape)
- [ ] AC5: When middleware sets RLS context, it does so via `SET LOCAL request.jwt.claims = ...` on
      the connection used for the request — uses Drizzle transaction wrapper
- [ ] AC6: A test verifies that querying `tenants` table without RLS context returns no rows (RLS
      denies); with context set returns only the user's accessible tenant rows
- [ ] AC7: Standard error response shape (from TICKET-019):
      `{ error: { code, message, request_id } }`
- [ ] AC8: 12+ tests: valid JWT, expired JWT, malformed JWT, no header, valid X-Tenant-ID with
      membership, X-Tenant-ID without membership, multiple memberships (returns user's role for
      selected tenant), RLS context check
- [ ] AC9: Performance: middleware overhead per request < 5ms p95 (includes Postgres
      `tenant_members` lookup, which can be cached in Upstash later — noted but not implemented
      here)
- [ ] AC10: PR title `feat(auth): jwt + tenant scoping middleware [TICKET-024]`

## Implementation guidance

```typescript
// packages/auth/src/jwt.ts
import { jwtVerify, createRemoteJWKSet } from 'jose';

export type SupabaseJwtPayload = {
  sub: string; // userId
  email: string;
  exp: number;
  aud: string;
  role?: string;
};

const JWKS = createRemoteJWKSet(
  new URL(`${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

export async function verifySupabaseJwt(token: string): Promise<SupabaseJwtPayload> {
  const { payload } = await jwtVerify(token, JWKS, {
    audience: 'authenticated',
  });
  return payload as SupabaseJwtPayload;
}
```

```typescript
// packages/auth/src/middleware-hono.ts
import type { MiddlewareHandler } from 'hono';
import { eq, and } from 'drizzle-orm';
import { tenantMembers, type Database } from '@estalara/db';
import { verifySupabaseJwt } from './jwt.js';
import { EstalaraError } from '@estalara/shared/observability';

export const requireAuth =
  (): MiddlewareHandler<{ Variables: { userId: string } }> => async (c, next) => {
    const auth = c.req.header('Authorization');
    if (!auth?.startsWith('Bearer ')) {
      throw new EstalaraError({ code: 'unauthorized', message: 'Missing Bearer token' });
    }
    const token = auth.substring(7);

    const payload = await verifySupabaseJwt(token).catch(() => null);
    if (!payload)
      throw new EstalaraError({ code: 'unauthorized', message: 'Invalid or expired token' });

    c.set('userId', payload.sub);
    await next();
  };

export const requireTenant =
  (
    db: Database,
  ): MiddlewareHandler<{ Variables: { userId: string; tenantId: string; role: string } }> =>
  async (c, next) => {
    const tenantId = c.req.header('X-Tenant-ID');
    if (!tenantId)
      throw new EstalaraError({ code: 'validation_failed', message: 'X-Tenant-ID required' });

    const userId = c.var.userId;
    const member = await db
      .select()
      .from(tenantMembers)
      .where(and(eq(tenantMembers.userId, userId), eq(tenantMembers.tenantId, tenantId)))
      .limit(1);

    if (member.length === 0) {
      throw new EstalaraError({ code: 'forbidden', message: 'Not a member of this tenant' });
    }

    c.set('tenantId', tenantId);
    c.set('role', member[0]!.role);

    // Set RLS context via Drizzle transaction (used by downstream queries in this request)
    c.set('rlsClaims', JSON.stringify({ sub: userId, tenant_id: tenantId, role: member[0]!.role }));

    await next();
  };
```

For Next.js Route Handler wrapper:

```typescript
// packages/auth/src/middleware-next.ts
import { NextResponse, type NextRequest } from 'next/server';
import { verifySupabaseJwt } from './jwt.js';

export type AuthContext = { userId: string; tenantId?: string };

export function withAuth<T>(handler: (req: NextRequest, ctx: AuthContext) => Promise<T>) {
  return async (req: NextRequest) => {
    const auth = req.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: { code: 'unauthorized', message: 'Missing token' } },
        { status: 401 },
      );
    }

    const token = auth.substring(7);
    const payload = await verifySupabaseJwt(token).catch(() => null);
    if (!payload) {
      return NextResponse.json(
        { error: { code: 'unauthorized', message: 'Invalid token' } },
        { status: 401 },
      );
    }

    return await handler(req, { userId: payload.sub });
  };
}
```

## Test plan

- Unit: 12+ tests covering all AC8 scenarios
- Integration: real Supabase JWT (with test secret) + real Postgres + RLS verified end-to-end

## Definition of Done

- [ ] Branch `backend-engineer/TICKET-024-jwt-tenant-scoping`
- [ ] PR title above
- [ ] All ACs verified
- [ ] CI green via `gh pr checks <pr> --watch`
- [ ] Prettier clean
- [ ] HANDOFF: TICKET-024 → TICKET-026, TICKET-027 (signup + dashboard)

## Notes

- JWKS endpoint cached with TTL — don't fetch on every request. `jose` library handles this.
- The `tenant_members` lookup happens on every request. Cache in Upstash Redis with short TTL (60s)
  in Sprint 7+ when latency matters.
- For RLS to actually enforce, the queries downstream MUST use a transaction with `SET LOCAL`.
  Document this clearly in `packages/db/README.md` — it's the most subtle correctness issue in the
  whole system.
