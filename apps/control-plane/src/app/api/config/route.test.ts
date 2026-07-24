/**
 * Tests for GET + PATCH /api/config — real `tenants` table wiring (FOLLOW-600,
 * ADR-0018 §5/§6), superseding the FOLLOW-614-era in-memory `configStore` stub.
 *
 * Auth model (ADR-0018 §2, unchanged from FOLLOW-614/615): the route delegates
 * agency + staff resolution to `resolveTenantAccess`, whose own end-to-end wiring
 * (SSR cookie, staff gate, tenant existence check, RLS trap) is exercised by
 * `src/lib/__tests__/resolve-tenant-access.test.ts`. These route tests PARTIALLY
 * MOCK `@/lib/session-auth` — only `resolveTenantAccess` is a spy; `AccessError`
 * and everything else stay real (via `importOriginal`), so
 * `accessErrorToResponse(err instanceof AccessError)` maps statuses for real.
 *
 * `@estalara/db` and `drizzle-orm` are mocked with a stateful per-tenant fake so
 * the tests drive the route's REAL query shape (`.select().from(tenants).where(eq(...))`,
 * `.update(tenants).set(...).where(eq(...))`, `db.transaction(...)`), mirroring
 * `demo/override/route.test.ts`'s fake-DB harness.
 *
 * Coverage:
 *   - GET/PATCH agency + staff paths, spoof-header closure, option-wiring.
 *   - Rule K.2: a thrown DB query returns 500, never fabricated defaults.
 *   - Zod validation (brand.primary_color hex, brand.logo_url URL, sdk.allowed_origins URLs).
 *   - Staff write-rank gate (FOLLOW-615): readonly staff PATCH → 403, untouched.
 *   - Staff audit trail + audit-write atomicity (ADR-0018 §3a, RETRO-202): mutation
 *     and staff_audit_log insert commit/roll back together in ONE db.transaction().
 *   - MANDATORY tenant-filter tests (ADR-0018 §2 invariant 5, RETRO-187): a staff
 *     request for tenant A can never read or write tenant B's config rows. NOT the
 *     demonstrative-only shape — drives the route's real query path.
 *
 * @module apps/control-plane/src/app/api/config/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type * as SessionAuthModule from '@/lib/session-auth';
import type { TenantConfig } from './route';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  tenants: {
    id: 'tenants.id',
    plan: 'tenants.plan',
    allowedOrigins: 'tenants.allowed_origins',
    brandConfig: 'tenants.brand_config',
    updatedAt: 'tenants.updated_at',
  },
  staffAuditLog: { __table: 'staff_audit_log' },
}));

// `eq(col, val)` → a plain object the DB mock reads `.val` off of. This is how the
// tenant-filter tests observe the fence the route binds/inserts (RETRO-187).
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
}));

vi.mock('@/lib/session-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionAuthModule>();
  return { ...actual, resolveTenantAccess: vi.fn() };
});

const { mockCaptureException } = vi.hoisted(() => ({ mockCaptureException: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({
  captureException: mockCaptureException,
  captureMessage: vi.fn(),
}));

import { createAdminClient, staffAuditLog } from '@estalara/db';
import { resolveTenantAccess, AccessError, type TenantAccess } from '@/lib/session-auth';
import { GET, PATCH } from './route';

const mockResolve = vi.mocked(resolveTenantAccess);

// ─── Constants ────────────────────────────────────────────────────────────────

const TENANT_A = '550e8400-e29b-41d4-a716-446655440042';
const TENANT_B = '660e8400-e29b-41d4-a716-446655440099';
const GATE_TENANT = '770e8400-e29b-41d4-a716-446655440077';

// ─── Access fixtures ──────────────────────────────────────────────────────────

function agencyAccess(
  tenantId: string,
  role: 'agency:viewer' | 'agency:admin' = 'agency:admin',
): TenantAccess {
  return {
    via: 'agency',
    tenantId,
    claims: {
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: tenantId,
      agency_role: role,
      estalara_staff: false,
      mfa_verified: true,
    },
    rawToken: 'agency-jwt',
  };
}

const STAFF_RANK: Record<string, number> = {
  'estalara:superadmin': 3,
  'estalara:ops': 2,
  'estalara:readonly': 1,
};

function staffAccess(
  tenantId: string,
  role: 'estalara:superadmin' | 'estalara:ops' | 'estalara:readonly' = 'estalara:ops',
): TenantAccess {
  const rank = STAFF_RANK[role] ?? 0;
  return {
    via: 'staff',
    tenantId,
    staff: {
      sub: 'staff-uuid-777',
      email: 'staff@estalara.com',
      tenant_id: null,
      estalara_staff: true,
      estalara_role: role,
      mfa_verified: true,
    },
    role,
    canWrite: rank >= 2,
    isSuperadmin: rank >= 3,
  };
}

// ─── Stateful per-tenant DB mock (exercises the REAL route query shape) ────────

interface TenantRow {
  plan: string;
  allowedOrigins: string[];
  brandConfig: unknown;
  updatedAt: Date;
}

interface FakeDb {
  _tenants: Record<string, TenantRow>;
  _auditRows: Record<string, unknown>[];
  _captured: { selectWhereVal: string | null; updateWhereVal: string | null };
  _control: { failAuditInsert: boolean; failUpdate: boolean };
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
}

function makeSelect(
  target: Record<string, TenantRow>,
  captured: FakeDb['_captured'],
): ReturnType<typeof vi.fn> {
  return vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn((w: { col: unknown; val: string }) => {
        captured.selectWhereVal = w.val;
        return {
          limit: vi.fn(() => {
            const row = target[w.val];
            return Promise.resolve(row ? [row] : []);
          }),
        };
      }),
    })),
  }));
}

function makeUpdate(
  target: Record<string, TenantRow>,
  captured: FakeDb['_captured'],
  control: { failUpdate: boolean },
): ReturnType<typeof vi.fn> {
  return vi.fn(() => ({
    set: vi.fn((values: Partial<TenantRow>) => ({
      where: vi.fn((w: { col: unknown; val: string }) => {
        captured.updateWhereVal = w.val;
        return {
          // FOLLOW-627: the route now calls `.returning({ id: tenants.id })` to
          // detect a 0-row update. Mirrors real Postgres semantics — a missing
          // key affects ZERO rows and returns `[]`, never a fabricated row.
          returning: vi.fn(() => {
            if (control.failUpdate) return Promise.reject(new Error('update failed'));
            const existing = target[w.val];
            if (!existing) return Promise.resolve([]);
            target[w.val] = { ...existing, ...values };
            return Promise.resolve([{ id: w.val }]);
          }),
        };
      }),
    })),
  }));
}

function makeAuditInsert(
  auditTarget: Record<string, unknown>[],
  control: { failAuditInsert: boolean },
): ReturnType<typeof vi.fn> {
  return vi.fn((table: unknown) => {
    if (table === staffAuditLog) {
      return {
        values: vi.fn((v: Record<string, unknown>) => {
          if (control.failAuditInsert) return Promise.reject(new Error('audit sink down'));
          auditTarget.push(v);
          return Promise.resolve([]);
        }),
      };
    }
    throw new Error('unexpected insert() target in test fake');
  });
}

function snapshotTenants(store: Record<string, TenantRow>): Record<string, TenantRow> {
  const copy: Record<string, TenantRow> = {};
  for (const k of Object.keys(store)) copy[k] = { ...store[k]! };
  return copy;
}

function makeDb(seed: Record<string, Partial<TenantRow>> = {}): FakeDb {
  const tenantRows: Record<string, TenantRow> = {};
  for (const k of Object.keys(seed)) {
    tenantRows[k] = {
      plan: 'observer',
      allowedOrigins: ['https://listings.example.com'],
      brandConfig: { primary_color: '#1a73e8', logo_url: null, white_label: false },
      updatedAt: new Date('2026-07-20T00:00:00Z'),
      ...seed[k],
    };
  }
  const auditRows: Record<string, unknown>[] = [];
  const captured: FakeDb['_captured'] = { selectWhereVal: null, updateWhereVal: null };
  const control = { failAuditInsert: false, failUpdate: false };

  return {
    _tenants: tenantRows,
    _auditRows: auditRows,
    _captured: captured,
    _control: control,
    select: makeSelect(tenantRows, captured),
    update: makeUpdate(tenantRows, captured, control),
    insert: makeAuditInsert(auditRows, control),
    // Real rollback semantics: the tx callback mutates STAGED copies. On resolve the
    // staged state is promoted atomically; on throw it is DISCARDED (no orphan write).
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const stagedTenants = snapshotTenants(tenantRows);
      const stagedAudit: Record<string, unknown>[] = [];
      const tx = {
        update: makeUpdate(stagedTenants, captured, control),
        insert: makeAuditInsert(stagedAudit, control),
      };
      const result = await fn(tx);
      for (const k of Object.keys(stagedTenants)) tenantRows[k] = stagedTenants[k]!;
      for (const v of stagedAudit) auditRows.push(v);
      return result;
    }),
  };
}

function useDb(db: FakeDb): void {
  vi.mocked(createAdminClient).mockReturnValue(
    db as unknown as ReturnType<typeof createAdminClient>,
  );
}

// ─── Request helpers ──────────────────────────────────────────────────────────

function makeRequest(opts?: {
  method?: string;
  body?: unknown;
  query?: Record<string, string>;
  spoofHeaders?: Record<string, string>;
}): NextRequest {
  const url = new URL('http://localhost/api/config');
  if (opts?.query) {
    for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = {
    Authorization: 'Bearer mock-token',
    'user-agent': 'vitest-agent',
    'x-forwarded-for': '203.0.113.7',
    ...(opts?.body ? { 'Content-Type': 'application/json' } : {}),
    ...(opts?.spoofHeaders ?? {}),
  };
  return new NextRequest(url.toString(), {
    method: opts?.method ?? 'GET',
    headers,
    ...(opts?.body ? { body: JSON.stringify(opts.body) } : {}),
  });
}

async function parseBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// GET
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/config', () => {
  it('agency viewer → 200 with own tenant config', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A, 'agency:viewer'));
    useDb(makeDb({ [TENANT_A]: {} }));
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await parseBody<TenantConfig>(res);
    expect(body.tenant_id).toBe(TENANT_A);
    expect(typeof body.plan).toBe('string');
    expect(typeof body.brand.primary_color).toBe('string');
    expect(Array.isArray(body.sdk.allowed_origins)).toBe(true);
    // FOLLOW-627: a real stored row carries provenance 'stored'.
    expect(body.data_source).toBe('stored');
  });

  it('SPOOF CLOSED: verified tenant A + spoofed victim headers → tenant A config, never the victim', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A, 'agency:viewer'));
    useDb(makeDb({ [TENANT_A]: {}, [TENANT_B]: {} }));
    const res = await GET(
      makeRequest({
        spoofHeaders: { 'x-tenant-id': TENANT_B, 'x-agency-role': 'agency:owner' },
      }),
    );
    expect(res.status).toBe(200);
    const body = await parseBody<TenantConfig>(res);
    expect(body.tenant_id).toBe(TENANT_A);
    expect(body.tenant_id).not.toBe(TENANT_B);
  });

  it('no auth → 401 (via accessErrorToResponse)', async () => {
    mockResolve.mockRejectedValue(new AccessError(401, 'Unauthorized'));
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('staff with ?tenant_id → 200; tenant resolved from the validated param', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_B));
    useDb(makeDb({ [TENANT_B]: { plan: 'native' } }));
    const res = await GET(makeRequest({ query: { tenant_id: TENANT_B } }));
    expect(res.status).toBe(200);
    const body = await parseBody<TenantConfig>(res);
    expect(body.tenant_id).toBe(TENANT_B);
    expect(body.plan).toBe('native');
  });

  it('option-wiring: calls resolveTenantAccess with allowStaffOverride + minAgencyRole viewer', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A, 'agency:viewer'));
    useDb(makeDb({ [TENANT_A]: {} }));
    await GET(makeRequest({ query: { tenant_id: TENANT_A } }));
    expect(mockResolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        allowStaffOverride: true,
        minAgencyRole: 'agency:viewer',
        tenantId: TENANT_A,
      }),
    );
  });

  it('returns 500 (not fabricated defaults) when the DB query throws (Rule K.2)', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A, 'agency:viewer'));
    vi.mocked(createAdminClient).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('connection refused')),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof createAdminClient>);

    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('internal_error');
  });

  it('returns 200 defaults with data_source: "default" (never silently) when the tenant row is not found (FOLLOW-627)', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A, 'agency:viewer'));
    useDb(makeDb({}));
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await parseBody<TenantConfig>(res);
    expect(body.plan).toBe('free');
    expect(body.brand.white_label).toBe(false);
    expect(body.sdk.allowed_origins).toEqual([]);
    // The fabrication MUST be observable on the wire (Rule K.2 amendment) — a
    // caller can distinguish this from a real stored row.
    expect(body.data_source).toBe('default');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH — agency path
// ═══════════════════════════════════════════════════════════════════════════

describe('PATCH /api/config — agency', () => {
  it('agency admin → 200 with updated brand.white_label, other brand fields preserved', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A, 'agency:admin'));
    useDb(
      makeDb({
        [TENANT_A]: {
          brandConfig: { primary_color: '#ff0000', logo_url: null, white_label: false },
        },
      }),
    );
    const res = await PATCH(
      makeRequest({ method: 'PATCH', body: { brand: { white_label: true } } }),
    );
    expect(res.status).toBe(200);
    const body = await parseBody<TenantConfig>(res);
    expect(body.brand.white_label).toBe(true);
    expect(body.brand.primary_color).toBe('#ff0000'); // preserved, not clobbered
    expect(body.tenant_id).toBe(TENANT_A);
  });

  it('agency viewer → 403 (below the admin floor, enforced from the verified claim)', async () => {
    mockResolve.mockRejectedValue(new AccessError(403, 'Access denied: insufficient agency role'));
    const res = await PATCH(
      makeRequest({ method: 'PATCH', body: { brand: { white_label: true } } }),
    );
    expect(res.status).toBe(403);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('forbidden');
  });

  it('SPOOF CLOSED: verified tenant A admin + spoofed victim headers → mutates tenant A, never the victim', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A, 'agency:admin'));
    useDb(makeDb({ [TENANT_A]: {}, [TENANT_B]: {} }));
    const res = await PATCH(
      makeRequest({
        method: 'PATCH',
        body: { brand: { white_label: true } },
        spoofHeaders: { 'x-tenant-id': TENANT_B, 'x-agency-role': 'agency:owner' },
      }),
    );
    expect(res.status).toBe(200);
    const body = await parseBody<TenantConfig>(res);
    expect(body.tenant_id).toBe(TENANT_A);
    expect(body.tenant_id).not.toBe(TENANT_B);
  });

  it('no auth → 401', async () => {
    mockResolve.mockRejectedValue(new AccessError(401, 'Unauthorized'));
    const res = await PATCH(
      makeRequest({ method: 'PATCH', body: { brand: { white_label: true } } }),
    );
    expect(res.status).toBe(401);
  });

  it('option-wiring: calls resolveTenantAccess with allowStaffOverride + minAgencyRole admin', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A, 'agency:admin'));
    useDb(makeDb({ [TENANT_A]: {} }));
    await PATCH(makeRequest({ method: 'PATCH', body: { brand: { white_label: true } } }));
    expect(mockResolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ allowStaffOverride: true, minAgencyRole: 'agency:admin' }),
    );
  });

  it('rejects invalid primary_color (400 validation_failed)', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A, 'agency:admin'));
    useDb(makeDb({ [TENANT_A]: {} }));
    const res = await PATCH(
      makeRequest({ method: 'PATCH', body: { brand: { primary_color: 'not-a-color' } } }),
    );
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_failed');
  });

  it('rejects a non-URL sdk.allowed_origins entry (400 validation_failed)', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A, 'agency:admin'));
    useDb(makeDb({ [TENANT_A]: {} }));
    const res = await PATCH(
      makeRequest({ method: 'PATCH', body: { sdk: { allowed_origins: ['not-a-url'] } } }),
    );
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_failed');
  });

  it('returns 500 (fail-loud, Rule K.2) when the DB update throws', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A, 'agency:admin'));
    const db = makeDb({ [TENANT_A]: {} });
    db._control.failUpdate = true;
    useDb(db);
    const res = await PATCH(
      makeRequest({ method: 'PATCH', body: { brand: { white_label: true } } }),
    );
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('internal_error');
  });

  it('returns 404 unknown_tenant (never a "saved" 200) on a 0-row update — tenant_id has no tenants row (FOLLOW-627)', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A, 'agency:admin'));
    useDb(makeDb({})); // TENANT_A seeded nowhere — the update below matches 0 rows
    const res = await PATCH(
      makeRequest({ method: 'PATCH', body: { brand: { white_label: true } } }),
    );
    expect(res.status).toBe(404);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unknown_tenant');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH — staff write-rank gate (CEO Q3, ADR-0018 §4; FOLLOW-615)
// ═══════════════════════════════════════════════════════════════════════════

describe('PATCH /api/config — staff write-rank gate', () => {
  it('estalara:readonly staff → 403 (rank < ops), tenant row left untouched', async () => {
    mockResolve.mockResolvedValue(staffAccess(GATE_TENANT, 'estalara:readonly'));
    const db = makeDb({
      [GATE_TENANT]: {
        brandConfig: { primary_color: '#1a73e8', logo_url: null, white_label: false },
      },
    });
    useDb(db);

    const res = await PATCH(
      makeRequest({
        method: 'PATCH',
        body: { brand: { white_label: true } },
        query: { tenant_id: GATE_TENANT },
      }),
    );
    expect(res.status).toBe(403);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('forbidden');

    expect(db.transaction).not.toHaveBeenCalled();
    expect(db._auditRows).toHaveLength(0);
    expect(db._tenants[GATE_TENANT]!.brandConfig).toMatchObject({ white_label: false });
  });

  it('estalara:ops staff → 200 (canWrite)', async () => {
    mockResolve.mockResolvedValue(staffAccess(GATE_TENANT, 'estalara:ops'));
    useDb(makeDb({ [GATE_TENANT]: {} }));
    const res = await PATCH(
      makeRequest({
        method: 'PATCH',
        body: { brand: { white_label: true } },
        query: { tenant_id: GATE_TENANT },
      }),
    );
    expect(res.status).toBe(200);
  });

  it('estalara:superadmin staff → 200 (canWrite)', async () => {
    mockResolve.mockResolvedValue(staffAccess(GATE_TENANT, 'estalara:superadmin'));
    useDb(makeDb({ [GATE_TENANT]: {} }));
    const res = await PATCH(
      makeRequest({
        method: 'PATCH',
        body: { brand: { white_label: true } },
        query: { tenant_id: GATE_TENANT },
      }),
    );
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH — staff audit trail (ADR-0018 §3)
// ═══════════════════════════════════════════════════════════════════════════

describe('PATCH /api/config — staff audit trail', () => {
  it('a successful staff write inserts exactly one staff_audit_log row (attributed)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:ops'));
    const db = makeDb({
      [TENANT_A]: { brandConfig: { primary_color: '#1a73e8', logo_url: null, white_label: false } },
    });
    useDb(db);

    const res = await PATCH(
      makeRequest({
        method: 'PATCH',
        body: { brand: { white_label: true } },
        query: { tenant_id: TENANT_A },
      }),
    );
    expect(res.status).toBe(200);
    expect(db._auditRows).toHaveLength(1);
    const row = db._auditRows[0]!;
    expect(row.adminUserId).toBe('staff-uuid-777');
    expect(row.action).toBe('tenant_config.update');
    expect(row.targetTenantId).toBe(TENANT_A);
    expect(row.payload).toMatchObject({
      before: { brand: { white_label: false } },
      after: { brand: { white_label: true } },
    });
    expect(row.ipAddress).toBe('203.0.113.7');
    expect(row.userAgent).toBe('vitest-agent');
  });

  it('staff write whose audit insert FAILS → 500 audit_write_failed (never a silent 200)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:ops'));
    const db = makeDb({ [TENANT_A]: {} });
    db._control.failAuditInsert = true;
    useDb(db);

    const res = await PATCH(
      makeRequest({
        method: 'PATCH',
        body: { brand: { white_label: true } },
        query: { tenant_id: TENANT_A },
      }),
    );
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('audit_write_failed');
    expect(mockCaptureException).toHaveBeenCalledOnce();
  });

  it('staff write on a 0-row update → 404 unknown_tenant, no audit row, no Sentry capture (FOLLOW-627)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:ops'));
    useDb(makeDb({})); // TENANT_A seeded nowhere — the update matches 0 rows

    const res = await PATCH(
      makeRequest({
        method: 'PATCH',
        body: { brand: { white_label: true } },
        query: { tenant_id: TENANT_A },
      }),
    );
    expect(res.status).toBe(404);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unknown_tenant');
    // Expected caller error, not a dependency failure — no audit row committed,
    // and this is not a Sentry-worthy event.
    expect(mockCaptureException).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH — audit-write atomicity (ADR-0018 §3a, RETRO-202)
//
// Red-first verified during dev: with a mutate-then-audit shape (update commits,
// THEN a separate audit insert), the audit-insert failure leaves tenant A's row
// mutated → the "byte-unchanged" assertion below FAILS. Wrapping update+insert in
// one db.transaction() (staged-then-committed, discarded on throw) makes it pass.
// ═══════════════════════════════════════════════════════════════════════════

describe('PATCH /api/config — audit-write atomicity', () => {
  it('ROLLS BACK the tenant mutation when the staff audit insert fails (no orphan mutation)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:ops'));
    const db = makeDb({
      [TENANT_A]: {
        brandConfig: { primary_color: '#1a73e8', logo_url: null, white_label: false },
        allowedOrigins: ['https://original.example.com'],
      },
    });
    db._control.failAuditInsert = true;
    useDb(db);

    const res = await PATCH(
      makeRequest({
        method: 'PATCH',
        body: {
          brand: { white_label: true },
          sdk: { allowed_origins: ['https://new.example.com'] },
        },
        query: { tenant_id: TENANT_A },
      }),
    );

    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('audit_write_failed');
    expect(mockCaptureException).toHaveBeenCalledOnce();

    // NO ORPHAN MUTATION — tenant A's stored row is byte-unchanged.
    expect(db._tenants[TENANT_A]!.brandConfig).toMatchObject({ white_label: false });
    expect(db._tenants[TENANT_A]!.allowedOrigins).toEqual(['https://original.example.com']);
    expect(db._auditRows).toHaveLength(0);
  });

  it('COMMITS both the tenant mutation and exactly one audit row when the tx succeeds', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:ops'));
    const db = makeDb({ [TENANT_A]: {} });
    useDb(db);

    const res = await PATCH(
      makeRequest({
        method: 'PATCH',
        body: { brand: { white_label: true } },
        query: { tenant_id: TENANT_A },
      }),
    );
    expect(res.status).toBe(200);
    expect(db._tenants[TENANT_A]!.brandConfig).toMatchObject({ white_label: true });
    expect(db._auditRows).toHaveLength(1);
    expect(db._auditRows[0]!.targetTenantId).toBe(TENANT_A);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MANDATORY tenant filter — staff cannot cross tenants (ADR-0018 §2 invariant 5,
// RETRO-187). NOT the demonstrative-only RLS-TRAP-LEAK-DEMO shape — this drives
// the route's REAL query path against the fake service-role DB.
// ═══════════════════════════════════════════════════════════════════════════

describe('MANDATORY tenant filter — staff cannot cross tenants (RETRO-187)', () => {
  it('READ: staff GET for tenant A binds eq(tenants.id, A) and returns A’s config, never B’s', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:ops'));
    const db = makeDb({
      [TENANT_A]: {
        brandConfig: { primary_color: '#111111', logo_url: null, white_label: false },
        allowedOrigins: ['https://a.example.com'],
      },
      [TENANT_B]: {
        brandConfig: { primary_color: '#222222', logo_url: null, white_label: true },
        allowedOrigins: ['https://b.example.com'],
      },
    });
    useDb(db);

    const res = await GET(makeRequest({ query: { tenant_id: TENANT_A } }));
    const body = await parseBody<TenantConfig>(res);

    // The fence bound into the REAL query is A, never B.
    expect(db._captured.selectWhereVal).toBe(TENANT_A);
    expect(db._captured.selectWhereVal).not.toBe(TENANT_B);
    // The response carries A's row only — B's config can never surface.
    expect(body.tenant_id).toBe(TENANT_A);
    expect(body.brand.primary_color).toBe('#111111');
    expect(body.brand.primary_color).not.toBe('#222222');
    expect(body.sdk.allowed_origins).toEqual(['https://a.example.com']);
  });

  it('WRITE: staff PATCH for tenant A fences the update on A and leaves tenant B untouched', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:ops'));
    const db = makeDb({
      [TENANT_A]: {
        brandConfig: { primary_color: '#111111', logo_url: null, white_label: false },
      },
      [TENANT_B]: {
        brandConfig: { primary_color: '#222222', logo_url: null, white_label: true },
      },
    });
    useDb(db);

    const res = await PATCH(
      makeRequest({
        method: 'PATCH',
        body: { brand: { white_label: true } },
        query: { tenant_id: TENANT_A },
      }),
    );
    expect(res.status).toBe(200);

    // The transaction's update fenced its where() on A (not B).
    expect(db._captured.updateWhereVal).toBe(TENANT_A);
    expect(db._captured.updateWhereVal).not.toBe(TENANT_B);
    // A was updated; B's row is byte-untouched.
    expect(db._tenants[TENANT_A]!.brandConfig).toMatchObject({ white_label: true });
    expect(db._tenants[TENANT_B]!.brandConfig).toMatchObject({
      primary_color: '#222222',
      white_label: true,
    });
    // The audit row targets A, proving attribution follows the same fence.
    expect(db._auditRows[0]?.targetTenantId).toBe(TENANT_A);
  });
});
