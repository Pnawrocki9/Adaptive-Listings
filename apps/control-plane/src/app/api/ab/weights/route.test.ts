/**
 * Tests for GET /api/ab/weights
 *
 * Auth model (ADR-0018 §2, FOLLOW-594): the route delegates agency + staff
 * resolution to `resolveTenantAccess`. Its end-to-end wiring is covered by
 * `src/lib/__tests__/resolve-tenant-access.test.ts`; here we PARTIALLY MOCK
 * `@/lib/session-auth` — only `resolveTenantAccess` is a spy, `AccessError` and
 * the other exports stay real (via `importOriginal`).
 *
 * `@estalara/db` and `drizzle-orm` are mocked to avoid a real DB. The staff path
 * uses `createAdminClient` (RLS BYPASSED), so the explicit `WHERE tenant_id`
 * (route `buildWhere`) is the ONLY tenant fence — the mandatory tenant-filter test
 * captures that WHERE from the route's real query (ADR-0018 invariant 5).
 *
 * @module apps/control-plane/src/app/api/ab/weights/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { AbWeightsResponse } from './route.js';
import type * as SessionAuthModule from '@/lib/session-auth';

// ─── Shared mock data ────────────────────────────────────────────────────────

const TENANT_A = '550e8400-e29b-41d4-a716-446655440000';
const TENANT_B = '550e8400-e29b-41d4-a716-4466554400d4';

interface DbRow {
  tenantId: string;
  archetype: string;
  variant: string;
  alpha: number;
  beta: number;
  paused: boolean;
  updatedAt: Date;
}

/** Simulate three db rows for TENANT_A (2 active, 1 paused). */
const MOCK_DB_ROWS: DbRow[] = [
  {
    tenantId: TENANT_A,
    archetype: 'yield_hunter',
    variant: 'control',
    alpha: 10,
    beta: 5,
    paused: false,
    updatedAt: new Date('2026-05-14T00:00:00Z'),
  },
  {
    tenantId: TENANT_A,
    archetype: 'yield_hunter',
    variant: 'headline_v1',
    alpha: 20,
    beta: 8,
    paused: false,
    updatedAt: new Date('2026-05-14T01:00:00Z'),
  },
  {
    tenantId: TENANT_A,
    archetype: 'family_buyer',
    variant: 'control',
    alpha: 3,
    beta: 30,
    paused: true,
    updatedAt: new Date('2026-05-14T02:00:00Z'),
  },
];

// ─── Partial mock of @/lib/session-auth (only resolveTenantAccess is a spy) ─────

vi.mock('@/lib/session-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionAuthModule>();
  return { ...actual, resolveTenantAccess: vi.fn() };
});

import { resolveTenantAccess, AccessError, type TenantAccess } from '@/lib/session-auth';
const mockResolve = vi.mocked(resolveTenantAccess);

// ─── Mock @estalara/db ─────────────────────────────────────────────────────────
// Agency path → createTenantClient(...).rls(tx => ...). Staff path →
// createAdminClient().select().from().where(). Both terminate in a `.where(cond)`
// that resolves the seeded rows, filtered by the captured drizzle `eq` value so a
// wrong/missing fence is observable.

const agencyState: { rows: DbRow[] } = { rows: [] };
const adminState: { capturedWhere: unknown; rows: DbRow[] } = {
  capturedWhere: undefined,
  rows: [],
};

/** Extract the tenant id a captured `eq`/`and` condition fences on. */
function whereTenantVal(where: unknown): string | undefined {
  if (where && typeof where === 'object' && 'val' in where) {
    return (where as { val?: string }).val;
  }
  // and(...) → array of conditions; the tenant_id eq is the first.
  if (Array.isArray(where)) {
    const first = where[0] as { col?: string; val?: string } | undefined;
    return first?.val;
  }
  return undefined;
}

vi.mock('@estalara/db', () => ({
  createTenantClient: vi.fn(() => ({
    rls: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const txStub = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn((cond: unknown) => {
          const val = whereTenantVal(cond);
          return Promise.resolve(agencyState.rows.filter((r) => r.tenantId === val));
        }),
      };
      return fn(txStub);
    }),
  })),
  createAdminClient: vi.fn(() => ({
    select: () => ({
      from: () => ({
        where: (cond: unknown) => {
          adminState.capturedWhere = cond;
          const val = whereTenantVal(cond);
          // Service-role: no RLS. The route's WHERE is the only fence.
          return Promise.resolve(adminState.rows.filter((r) => r.tenantId === val));
        },
      }),
    }),
  })),
  abBanditWeights: {
    tenantId: 'tenant_id',
    archetype: 'archetype',
    variant: 'variant',
    alpha: 'alpha',
    beta: 'beta',
    paused: 'paused',
    updatedAt: 'updated_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: string, val: string) => ({ col, val })),
  and: vi.fn((...args: unknown[]) => args),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function agencyAccess(tenantId = TENANT_A): TenantAccess {
  return {
    via: 'agency',
    tenantId,
    claims: {
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: tenantId,
      agency_role: 'agency:admin',
      estalara_staff: false,
      mfa_verified: true,
    },
    rawToken: 'agency-jwt',
  };
}

function staffAccess(tenantId: string): TenantAccess {
  return {
    via: 'staff',
    tenantId,
    staff: {
      sub: 'staff-uuid',
      email: 'staff@estalara.com',
      tenant_id: null,
      estalara_staff: true,
      estalara_role: 'estalara:ops',
      mfa_verified: true,
    },
    role: 'estalara:ops',
    canWrite: true,
    isSuperadmin: false,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost/api/ab/weights');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url.toString(), {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

function setFakeDatabaseUrl() {
  process.env.DATABASE_URL = 'postgresql://fake:fake@localhost:5432/fake';
}

function clearDatabaseUrl(saved: string | undefined) {
  if (saved === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = saved;
  }
}

// ─── Agency-path tests ──────────────────────────────────────────────────────────

describe('GET /api/ab/weights', () => {
  let savedDatabaseUrl: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: agency caller on their own tenant. Seed A's rows on the RLS path.
    mockResolve.mockResolvedValue(agencyAccess());
    agencyState.rows = [...MOCK_DB_ROWS];
    adminState.rows = [];
    adminState.capturedWhere = undefined;
    savedDatabaseUrl = process.env.DATABASE_URL;
    setFakeDatabaseUrl();
  });

  afterEach(() => {
    clearDatabaseUrl(savedDatabaseUrl);
  });

  it('returns 401 when resolveTenantAccess throws AccessError(401)', async () => {
    mockResolve.mockRejectedValue(new AccessError(401, 'Unauthorized: no tenant access'));

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('returns 403 when resolveTenantAccess throws AccessError(403)', async () => {
    mockResolve.mockRejectedValue(new AccessError(403, 'Access denied: insufficient agency role'));

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('forbidden');
  });

  it('returns 200 with 3 rows (2 active, 1 paused) — all rows returned', async () => {
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await parseBody<AbWeightsResponse>(res);
    expect(body.rows).toHaveLength(3);
    expect(body.total).toBe(3);
    expect(body.tenant_id).toBe(TENANT_A);
    expect(typeof body.generated_at).toBe('string');
  });

  it('?archetype=yield_hunter filter — returns rows for the queried archetype', async () => {
    agencyState.rows = MOCK_DB_ROWS.filter((r) => r.archetype === 'yield_hunter').slice(0, 1);

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ archetype: 'yield_hunter' }));
    expect(res.status).toBe(200);
    const body = await parseBody<AbWeightsResponse>(res);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]?.archetype).toBe('yield_hunter');
  });

  it('empty table → [] with total 0 (graceful)', async () => {
    agencyState.rows = [];

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await parseBody<AbWeightsResponse>(res);
    expect(body.rows).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('rows include paused=true for the paused row', async () => {
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    const body = await parseBody<AbWeightsResponse>(res);
    const pausedRow = body.rows.find((r) => r.paused);
    expect(pausedRow).toBeDefined();
    expect(pausedRow?.archetype).toBe('family_buyer');
  });

  it('estimated_rate is computed as alpha / (alpha + beta)', async () => {
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    const body = await parseBody<AbWeightsResponse>(res);
    for (const row of body.rows) {
      const expected = row.alpha / (row.alpha + row.beta);
      expect(Math.abs(row.estimated_rate - expected)).toBeLessThan(0.001);
    }
  });

  it('total matches rows.length', async () => {
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    const body = await parseBody<AbWeightsResponse>(res);
    expect(body.total).toBe(body.rows.length);
  });

  it('DATABASE_URL absent (agency path) — returns empty rows gracefully', async () => {
    delete process.env.DATABASE_URL;

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await parseBody<AbWeightsResponse>(res);
    expect(body.rows).toHaveLength(0);
    expect(body.total).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Staff override path (ADR-0018 §2, FOLLOW-594)
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/ab/weights — staff override (ADR-0018)', () => {
  let savedDatabaseUrl: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    agencyState.rows = [];
    adminState.rows = [];
    adminState.capturedWhere = undefined;
    savedDatabaseUrl = process.env.DATABASE_URL;
    setFakeDatabaseUrl();
  });

  afterEach(() => {
    clearDatabaseUrl(savedDatabaseUrl);
  });

  it('staff caller with a validated ?tenant_id → 200 with that tenant’s weights', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    adminState.rows = [...MOCK_DB_ROWS];

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ tenant_id: TENANT_A }));
    expect(res.status).toBe(200);
    const body = await parseBody<AbWeightsResponse>(res);
    expect(body.tenant_id).toBe(TENANT_A);
    expect(body.rows.length).toBe(3);
  });

  it('staff caller who omits ?tenant_id → 400 (resolve throws AccessError(400))', async () => {
    mockResolve.mockRejectedValue(
      new AccessError(400, 'tenantId is required when allowStaffOverride is true'),
    );

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('bad_request');
  });

  it('staff caller with an unknown ?tenant_id → 404 (resolve throws AccessError(404))', async () => {
    mockResolve.mockRejectedValue(new AccessError(404, 'Unknown tenant'));

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ tenant_id: '99999999-9999-4999-8999-999999999999' }));
    expect(res.status).toBe(404);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('not_found');
  });

  // ─── MANDATORY tenant-filter test (ADR-0018 §2 invariant 5, RETRO-187) ───────
  // The staff path runs under createAdminClient (RLS BYPASSED), so the route's
  // explicit `WHERE tenant_id = access.tenantId` (buildWhere) is the ONLY fence.
  // This test seeds a service-role "table" holding BOTH tenants' rows and asserts
  // the WHERE the route actually passed to the admin query fences on A — never B —
  // so B's rows can never surface. Red-first: a missing/wrong fence would flip
  // `capturedWhere` and leak TENANT_B.

  it('MANDATORY (RETRO-187): staff request for tenant A passes eq(tenantId, A) as the ONLY WHERE fence and never returns tenant B rows', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    // Service-role table holds BOTH tenants (no RLS fence at the DB layer).
    adminState.rows = [
      ...MOCK_DB_ROWS,
      {
        tenantId: TENANT_B,
        archetype: 'downsizer',
        variant: 'control',
        alpha: 50,
        beta: 2,
        paused: false,
        updatedAt: new Date('2026-05-14T03:00:00Z'),
      },
    ];

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ tenant_id: TENANT_A }));
    const body = await parseBody<AbWeightsResponse>(res);

    // The WHERE the route passed to the service-role query fences on A, not B.
    expect(adminState.capturedWhere).toEqual({ col: 'tenant_id', val: TENANT_A });
    expect(adminState.capturedWhere).not.toEqual({ col: 'tenant_id', val: TENANT_B });
    // B's rows can never surface — every returned row is tenant A.
    expect(body.rows.length).toBe(3);
    expect(body.rows.every((r) => r.tenant_id === TENANT_A)).toBe(true);
    expect(body.rows.map((r) => r.tenant_id)).not.toContain(TENANT_B);
    expect(body.rows.map((r) => r.archetype)).not.toContain('downsizer');
  });
});
