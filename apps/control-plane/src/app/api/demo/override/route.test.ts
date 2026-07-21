/**
 * Tests for GET/PUT /api/demo/override — DEMO-001 + ADR-0018 §6 staff port (FOLLOW-596).
 *
 * Auth model (ADR-0018 §2, FOLLOW-596): the route delegates agency + staff resolution
 * to `resolveTenantAccess`, whose own end-to-end wiring (SSR cookie, staff gate, tenant
 * existence check, RLS trap) is exercised by `src/lib/__tests__/resolve-tenant-access.test.ts`.
 * These route tests therefore PARTIALLY MOCK `@/lib/session-auth` — only
 * `resolveTenantAccess` is a spy; `AccessError`, `tenantExists` and every other export
 * stay real (via `importOriginal`), so `accessErrorToResponse(err instanceof AccessError)`
 * maps statuses for real.
 *
 * The `@/lib/demo-override-store` module stays REAL — `getDemoOverride` (GET + staff
 * read-before) and `upsertDemoOverride` (agency PUT) drive REAL Drizzle queries against a
 * mocked `createAdminClient()`. The tenant-filter tests (READ + WRITE) observe the value
 * the query actually binds/inserts (RETRO-187 — NOT a pre-filtered local array). A
 * mis-fence would key a different tenant and the assertions fail.
 *
 * @module apps/control-plane/src/app/api/demo/override/route.test
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SessionAuthModule from '@/lib/session-auth';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  demoOverrides: {
    id: 'demo_overrides.id',
    tenantId: 'demo_overrides.tenant_id',
    enabled: 'demo_overrides.enabled',
    overrideArchetype: 'demo_overrides.override_archetype',
    overrideModel: 'demo_overrides.override_model',
    updatedBy: 'demo_overrides.updated_by',
    updatedAt: 'demo_overrides.updated_at',
  },
  staffAuditLog: { __table: 'staff_audit_log' },
}));

// `eq(col, val)` → a plain object the DB mock reads `.val` off of. This is how the
// tenant-filter READ test observes the fence the store's select bound (RETRO-187).
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  and: vi.fn((...conds: unknown[]) => ({ and: conds })),
  isNull: vi.fn((col: unknown) => ({ isNull: col })),
}));

// Partial mock: ONLY resolveTenantAccess is a spy; AccessError/tenantExists stay real.
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

import { GET, PUT } from './route';

const mockResolve = vi.mocked(resolveTenantAccess);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_A = '550e8400-e29b-41d4-a716-446655440001';
const TENANT_B = '550e8400-e29b-41d4-a716-4466554400b2';

const STAFF_RANK: Record<string, number> = {
  'estalara:superadmin': 3,
  'estalara:ops': 2,
  'estalara:readonly': 1,
};

function agencyAccess(
  tenantId = TENANT_A,
  agencyRole: 'agency:owner' | 'agency:admin' | 'agency:viewer' = 'agency:admin',
): TenantAccess {
  return {
    via: 'agency',
    tenantId,
    claims: {
      sub: 'agency-user-123',
      email: 'user@agency.com',
      tenant_id: tenantId,
      agency_role: agencyRole,
      estalara_staff: false,
      mfa_verified: false,
    },
    rawToken: 'agency-jwt',
  };
}

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

// ─── Stateful per-tenant DB mock (exercises the REAL store queries) ─────────────

interface OverrideRow {
  id: string;
  tenantId: string;
  enabled: boolean;
  overrideArchetype: string | null;
  overrideModel: string;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeDb {
  _overrides: Record<string, OverrideRow>;
  _auditRows: Record<string, unknown>[];
  _captured: {
    selectWhereVal: string | null;
    insertTenantId: string | null;
  };
  /** Test control: when true, the audit insert INSIDE the tx rejects (FOLLOW-605 rollback). */
  _control: { failAuditInsert: boolean; failUpsert: boolean };
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
}

function rowFromValues(
  existing: OverrideRow | undefined,
  v: {
    tenantId: string;
    enabled: boolean;
    overrideArchetype: string | null;
    overrideModel: string;
    updatedBy?: string | null;
    updatedAt?: Date;
  },
): OverrideRow {
  return {
    id: existing?.id ?? 'demo-uuid-1',
    tenantId: v.tenantId,
    enabled: v.enabled,
    overrideArchetype: v.overrideArchetype ?? null,
    overrideModel: v.overrideModel,
    updatedBy: v.updatedBy ?? null,
    createdAt: existing?.createdAt ?? new Date('2026-07-21T00:00:00Z'),
    updatedAt: v.updatedAt ?? new Date('2026-07-21T00:00:00Z'),
  };
}

function makeSelect(
  target: Record<string, OverrideRow>,
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

function makeInsert(
  overridesTarget: Record<string, OverrideRow>,
  auditTarget: Record<string, unknown>[],
  captured: FakeDb['_captured'],
  control: { failAuditInsert: boolean; failUpsert: boolean },
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
    // demo_overrides upsert: .values().onConflictDoUpdate().returning()
    return {
      values: vi.fn(
        (v: {
          tenantId: string;
          enabled: boolean;
          overrideArchetype: string | null;
          overrideModel: string;
          updatedBy?: string | null;
          updatedAt?: Date;
        }) => {
          captured.insertTenantId = v.tenantId;
          return {
            onConflictDoUpdate: vi.fn(() => ({
              returning: vi.fn(() => {
                if (control.failUpsert) return Promise.reject(new Error('upsert failed'));
                const row = rowFromValues(overridesTarget[v.tenantId], v);
                overridesTarget[v.tenantId] = row;
                return Promise.resolve([row]);
              }),
            })),
          };
        },
      ),
    };
  });
}

function snapshotOverrides(store: Record<string, OverrideRow>): Record<string, OverrideRow> {
  const copy: Record<string, OverrideRow> = {};
  for (const k of Object.keys(store)) copy[k] = { ...store[k]! };
  return copy;
}

function makeDb(seed: Record<string, Partial<OverrideRow>> = {}): FakeDb {
  const overrides: Record<string, OverrideRow> = {};
  for (const k of Object.keys(seed)) {
    overrides[k] = {
      id: 'demo-uuid-seed',
      tenantId: k,
      enabled: false,
      overrideArchetype: null,
      overrideModel: 'claude-sonnet-4-6',
      updatedBy: null,
      createdAt: new Date('2026-07-20T00:00:00Z'),
      updatedAt: new Date('2026-07-20T00:00:00Z'),
      ...seed[k],
    };
  }
  const auditRows: Record<string, unknown>[] = [];
  const captured: FakeDb['_captured'] = { selectWhereVal: null, insertTenantId: null };
  const control = { failAuditInsert: false, failUpsert: false };

  return {
    _overrides: overrides,
    _auditRows: auditRows,
    _captured: captured,
    _control: control,
    select: makeSelect(overrides, captured),
    insert: makeInsert(overrides, auditRows, captured, control),
    // Real rollback semantics: the tx callback mutates STAGED copies. On resolve the
    // staged state is promoted atomically; on throw it is DISCARDED (no orphan mutation).
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const stagedOverrides = snapshotOverrides(overrides);
      const stagedAudit: Record<string, unknown>[] = [];
      const tx = {
        select: makeSelect(stagedOverrides, captured),
        insert: makeInsert(stagedOverrides, stagedAudit, captured, control),
      };
      // If this rejects, we do NOT commit — staged mutations vanish. The resolved value
      // is returned to the caller (the route reads the committed row off it).
      const result = await fn(tx);
      for (const k of Object.keys(stagedOverrides)) overrides[k] = stagedOverrides[k]!;
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

function makeGet(tenantId?: string): NextRequest {
  const url = new URL('http://localhost/api/demo/override');
  if (tenantId) url.searchParams.set('tenant_id', tenantId);
  return new NextRequest(url.toString());
}

function makePut(body: Record<string, unknown>, tenantId?: string): NextRequest {
  const url = new URL('http://localhost/api/demo/override');
  if (tenantId) url.searchParams.set('tenant_id', tenantId);
  return new NextRequest(url.toString(), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'user-agent': 'vitest-agent',
      'x-forwarded-for': '203.0.113.7',
    },
    body: JSON.stringify(body),
  });
}

async function parseBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolve.mockResolvedValue(agencyAccess());
});

// ═══════════════════════════════════════════════════════════════════════════
// GET — agency path (byte-unchanged behaviour)
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/demo/override — agency', () => {
  it('returns 401 when resolveTenantAccess throws AccessError(401)', async () => {
    mockResolve.mockRejectedValue(new AccessError(401, 'Unauthorized'));
    const res = await GET(makeGet());
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('returns current override state for an agency caller', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A, 'agency:viewer'));
    useDb(makeDb({ [TENANT_A]: { enabled: true, overrideArchetype: 'family_buyer' } }));

    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.enabled).toBe(true);
    expect(body.override_archetype).toBe('family_buyer');
    expect(body.tenant_id).toBe(TENANT_A);
    expect(Array.isArray(body.archetypes)).toBe(true);
    expect(Array.isArray(body.models)).toBe(true);
  });

  it('returns default state (enabled=false) when no row exists', async () => {
    useDb(makeDb({}));
    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.enabled).toBe(false);
    expect(body.override_archetype).toBeNull();
  });

  it('returns 500 (not enabled defaults) when the DB query throws (Rule K.2)', async () => {
    vi.mocked(createAdminClient).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('connection refused')),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof createAdminClient>);

    const res = await GET(makeGet());
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('internal_error');
  });

  // FOLLOW-603 — option-wiring assertion: dropping allowStaffOverride fails here.
  it('invokes resolveTenantAccess with allowStaffOverride:true and minAgencyRole:agency:viewer', async () => {
    useDb(makeDb({}));
    await GET(makeGet());
    expect(mockResolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ allowStaffOverride: true, minAgencyRole: 'agency:viewer' }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT — agency path (write semantics unchanged: admin+; NOT audited)
// ═══════════════════════════════════════════════════════════════════════════

describe('PUT /api/demo/override — agency', () => {
  it('returns 401 when resolveTenantAccess throws AccessError(401)', async () => {
    mockResolve.mockRejectedValue(new AccessError(401, 'Unauthorized'));
    const res = await PUT(makePut({ enabled: false, override_model: 'claude-sonnet-4-6' }));
    expect(res.status).toBe(401);
  });

  it('returns 403 when an agency:viewer tries to write (admin+ required, UNCHANGED)', async () => {
    mockResolve.mockRejectedValue(new AccessError(403, 'Access denied: insufficient agency role'));
    const res = await PUT(makePut({ enabled: false, override_model: 'claude-sonnet-4-6' }));
    expect(res.status).toBe(403);
  });

  it('returns 400 on invalid archetype', async () => {
    const res = await PUT(
      makePut({
        enabled: true,
        override_archetype: 'not_a_real_archetype',
        override_model: 'claude-sonnet-4-6',
      }),
    );
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_failed');
  });

  it('returns 400 on invalid model', async () => {
    const res = await PUT(
      makePut({ enabled: true, override_archetype: 'family_buyer', override_model: 'gpt-4o' }),
    );
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_failed');
  });

  it('returns 400 when enabled=true but archetype is missing', async () => {
    const res = await PUT(makePut({ enabled: true, override_model: 'claude-sonnet-4-6' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { message: string } }>(res);
    expect(body.error.message).toMatch(/override_archetype is required/);
  });

  it('agency admin succeeds with enabled=false and null archetype', async () => {
    useDb(makeDb({}));
    const res = await PUT(makePut({ enabled: false, override_model: 'claude-sonnet-4-6' }));
    expect(res.status).toBe(200);
    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.enabled).toBe(false);
    expect(body.tenant_id).toBe(TENANT_A);
    expect(typeof body.updated_at).toBe('string');
  });

  it('agency admin succeeds enabling DEMO MODE with valid archetype + model', async () => {
    const db = makeDb({});
    useDb(db);
    const res = await PUT(
      makePut({
        enabled: true,
        override_archetype: 'yield_hunter',
        override_model: 'claude-opus-4-8',
      }),
    );
    expect(res.status).toBe(200);
    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.enabled).toBe(true);
    expect(body.override_archetype).toBe('yield_hunter');
    expect(body.override_model).toBe('claude-opus-4-8');
    // Tenant id comes from the session claim, never the body.
    expect(db._overrides[TENANT_A]?.tenantId).toBe(TENANT_A);
    // Agency writes are NOT audited (§3 audits STAFF only).
    expect(db._auditRows).toHaveLength(0);
  });

  it('returns 500 when the DB throws on write (fail-loud Rule K.2)', async () => {
    const db = makeDb({});
    db._control.failUpsert = true;
    useDb(db);
    const res = await PUT(
      makePut({
        enabled: true,
        override_archetype: 'neutral',
        override_model: 'claude-sonnet-4-6',
      }),
    );
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('internal_error');
  });

  // FOLLOW-603 — option-wiring: allowStaffOverride:true AND minAgencyRole:'agency:admin'.
  it('invokes resolveTenantAccess with allowStaffOverride:true and minAgencyRole:agency:admin', async () => {
    useDb(makeDb({}));
    await PUT(makePut({ enabled: false, override_model: 'claude-sonnet-4-6' }));
    expect(mockResolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ allowStaffOverride: true, minAgencyRole: 'agency:admin' }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT — staff write-rank gate (CEO Q3, ADR-0018 §4)
// ═══════════════════════════════════════════════════════════════════════════

describe('PUT /api/demo/override — staff write-rank gate', () => {
  it('estalara:readonly staff → 403 (rank < ops), no upsert, no audit', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:readonly'));
    const db = makeDb({ [TENANT_A]: { enabled: true, overrideArchetype: 'family_buyer' } });
    useDb(db);

    const res = await PUT(makePut({ enabled: true, override_archetype: 'yield_hunter' }, TENANT_A));
    expect(res.status).toBe(403);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('forbidden');
    // Nothing was written or audited; tenant A's override is untouched.
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db._auditRows).toHaveLength(0);
    expect(db._overrides[TENANT_A]!.overrideArchetype).toBe('family_buyer');
  });

  it('estalara:ops staff → 200 (canWrite)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:ops'));
    useDb(makeDb({}));
    const res = await PUT(makePut({ enabled: true, override_archetype: 'yield_hunter' }, TENANT_A));
    expect(res.status).toBe(200);
  });

  it('estalara:superadmin staff → 200 (canWrite)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:superadmin'));
    useDb(makeDb({}));
    const res = await PUT(makePut({ enabled: true, override_archetype: 'yield_hunter' }, TENANT_A));
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT — staff audit trail (ADR-0018 §3)
// ═══════════════════════════════════════════════════════════════════════════

describe('PUT /api/demo/override — staff audit trail', () => {
  it('a successful staff write inserts exactly one staff_audit_log row (attributed)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:ops'));
    const db = makeDb({ [TENANT_A]: { enabled: false, overrideArchetype: null } });
    useDb(db);

    const res = await PUT(
      makePut(
        { enabled: true, override_archetype: 'luxury_buyer', override_model: 'claude-opus-4-8' },
        TENANT_A,
      ),
    );
    expect(res.status).toBe(200);
    expect(db._auditRows).toHaveLength(1);
    const row = db._auditRows[0]!;
    expect(row.adminUserId).toBe('staff-uuid-777');
    expect(row.action).toBe('demo_override.update');
    expect(row.targetTenantId).toBe(TENANT_A);
    expect(row.payload).toMatchObject({
      before: { enabled: false },
      after: { enabled: true, overrideArchetype: 'luxury_buyer', overrideModel: 'claude-opus-4-8' },
    });
    expect(row.ipAddress).toBe('203.0.113.7');
    expect(row.userAgent).toBe('vitest-agent');
  });

  it('staff write whose audit insert FAILS → 500 audit_write_failed (never a silent 200)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:ops'));
    const db = makeDb({ [TENANT_A]: { enabled: false } });
    db._control.failAuditInsert = true;
    useDb(db);

    const res = await PUT(makePut({ enabled: true, override_archetype: 'yield_hunter' }, TENANT_A));
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('audit_write_failed');
    expect(mockCaptureException).toHaveBeenCalledOnce();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT — audit-write atomicity: override upsert + audit row are ONE tx (FOLLOW-605/607)
//
// Red-first verified during dev: with a mutate-then-audit shape (upsert commits, THEN a
// separate audit insert), the audit-insert failure leaves tenant A's override mutated →
// this test's UNCHANGED assertion FAILS. Wrapping upsert+insert in one db.transaction()
// (staged-then-committed, discarded on throw) makes it pass.
// ═══════════════════════════════════════════════════════════════════════════

describe('PUT /api/demo/override — audit-write atomicity (FOLLOW-605/607)', () => {
  it('ROLLS BACK the override upsert when the staff audit insert fails (no orphan mutation)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:ops'));
    const db = makeDb({
      [TENANT_A]: { enabled: false, overrideArchetype: null, overrideModel: 'claude-sonnet-4-6' },
    });
    db._control.failAuditInsert = true;
    useDb(db);

    const res = await PUT(
      makePut(
        { enabled: true, override_archetype: 'flip_investor', override_model: 'claude-opus-4-8' },
        TENANT_A,
      ),
    );

    // (a) fail loud — 500, attributable-write-failed, captured to Sentry.
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('audit_write_failed');
    expect(mockCaptureException).toHaveBeenCalledOnce();

    // (b) NO ORPHAN MUTATION — tenant A's stored override is byte-unchanged.
    expect(db._overrides[TENANT_A]!.enabled).toBe(false);
    expect(db._overrides[TENANT_A]!.overrideArchetype).toBeNull();
    expect(db._overrides[TENANT_A]!.overrideModel).toBe('claude-sonnet-4-6');
    // …and no audit row was committed either (both limbs rolled back together).
    expect(db._auditRows).toHaveLength(0);
  });

  it('COMMITS both the override upsert and exactly one audit row when the tx succeeds', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:ops'));
    const db = makeDb({ [TENANT_A]: { enabled: false } });
    useDb(db);

    const res = await PUT(makePut({ enabled: true, override_archetype: 'downsizer' }, TENANT_A));
    expect(res.status).toBe(200);
    // Both limbs committed atomically.
    expect(db._overrides[TENANT_A]!.enabled).toBe(true);
    expect(db._overrides[TENANT_A]!.overrideArchetype).toBe('downsizer');
    expect(db._auditRows).toHaveLength(1);
    expect(db._auditRows[0]!.targetTenantId).toBe(TENANT_A);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MANDATORY tenant-filter tests — READ + WRITE (ADR-0018 §2 invariant 5, RETRO-187)
//
// These drive the route's REAL query path: the DB mock keys its per-tenant store on the
// value the store binds into `.where(eq(demoOverrides.tenantId, access.tenantId))` (READ)
// and the tenantId the route inserts (WRITE). A mis-fence (binding the session's null
// tenant, or tenant B) keys a different slot and the assertions fail. Red-first verified
// during dev: changing the fence to TENANT_B makes both tests fail; reverting makes them
// pass. NOT the demonstrative RLS-TRAP-LEAK-DEMO — this is the real service-role query.
// ═══════════════════════════════════════════════════════════════════════════

describe('MANDATORY tenant filter — staff cannot cross tenants (RETRO-187)', () => {
  it('READ: staff GET for tenant A binds eq(demoOverrides.tenantId, A) and returns A’s override, never B’s', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:ops'));
    const db = makeDb({
      [TENANT_A]: { enabled: true, overrideArchetype: 'family_buyer' },
      [TENANT_B]: { enabled: true, overrideArchetype: 'luxury_buyer' },
    });
    useDb(db);

    const res = await GET(makeGet(TENANT_A));
    const body = await parseBody<{ tenant_id: string; override_archetype: string }>(res);

    // The fence bound into the REAL store query is A, never B.
    expect(db._captured.selectWhereVal).toBe(TENANT_A);
    expect(db._captured.selectWhereVal).not.toBe(TENANT_B);
    // The response carries A's row only — B's 'luxury_buyer' can never surface.
    expect(body.tenant_id).toBe(TENANT_A);
    expect(body.override_archetype).toBe('family_buyer');
    expect(body.override_archetype).not.toBe('luxury_buyer');
  });

  it('WRITE: staff PUT for tenant A fences the insert on A and leaves tenant B untouched', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:ops'));
    const db = makeDb({
      [TENANT_A]: { enabled: false, overrideArchetype: null },
      [TENANT_B]: { enabled: true, overrideArchetype: 'luxury_buyer' },
    });
    useDb(db);

    const res = await PUT(
      makePut({ enabled: true, override_archetype: 'remote_worker' }, TENANT_A),
    );
    expect(res.status).toBe(200);

    // The upsert fenced its tenantId on A (not B).
    expect(db._captured.insertTenantId).toBe(TENANT_A);
    expect(db._captured.insertTenantId).not.toBe(TENANT_B);
    // A was updated; B's row is byte-untouched.
    expect(db._overrides[TENANT_A]!.overrideArchetype).toBe('remote_worker');
    expect(db._overrides[TENANT_B]!.overrideArchetype).toBe('luxury_buyer');
    // The audit row targets A, proving attribution follows the same fence.
    expect(db._auditRows[0]?.targetTenantId).toBe(TENANT_A);
  });
});
