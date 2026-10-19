/**
 * Tests for PATCH /api/tenants/:id/bandit/weights/:archetype (FOLLOW-598,
 * ADR-0018 §6 Phase 3 — superadmin-only staff-write port).
 *
 * Auth model (ADR-0018 §2; staff-only since FOLLOW-1335): the route delegates the
 * staff resolution to `resolveTenantAccess`, whose own end-to-end wiring (SSR cookie,
 * staff gate, tenant existence check, RLS trap) is exercised by
 * `src/lib/__tests__/resolve-tenant-access.test.ts`. These route tests therefore
 * PARTIALLY MOCK `@/lib/session-auth` — only `resolveTenantAccess` is a spy;
 * `AccessError` and every other export stay real (via `importOriginal`).
 *
 * The MANDATORY WRITE tenant-fence test drives the route's REAL Drizzle query: the
 * admin-client mock captures the value the route actually binds into
 * `.where(and(eq(abBanditWeights.tenantId, access.tenantId), ...))` (RETRO-187 —
 * NOT a demonstrative trap). A mis-fence would capture the wrong tenant and the
 * assertion fails.
 *
 * @module apps/control-plane/src/app/api/tenants/[id]/bandit/weights/[archetype]/route.test
 */

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SessionAuthModule from '@/lib/session-auth';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  abBanditWeights: {
    tenantId: 'tenant_id',
    archetype: 'archetype',
    paused: 'paused',
    updatedAt: 'updated_at',
  },
  staffAuditLog: { __table: 'staff_audit_log' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  and: vi.fn((...conds: unknown[]) => ({ and: conds })),
}));

// Partial mock: ONLY resolveTenantAccess is a spy; AccessError stays real.
vi.mock('@/lib/session-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionAuthModule>();
  return { ...actual, resolveTenantAccess: vi.fn() };
});

const { mockCaptureException } = vi.hoisted(() => ({ mockCaptureException: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({
  captureException: mockCaptureException,
}));

import { createAdminClient } from '@estalara/db';
import { resolveTenantAccess, AccessError, type TenantAccess } from '@/lib/session-auth';

import { PATCH } from './route';

const mockResolve = vi.mocked(resolveTenantAccess);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_A = '550e8400-e29b-41d4-a716-446655440001';
const TENANT_B = '550e8400-e29b-41d4-a716-4466554400b2';
const ARCHETYPE = 'yield_hunter';

const STAFF_RANK: Record<string, number> = {
  'estalara:superadmin': 3,
  'estalara:ops': 2,
  'estalara:readonly': 1,
};

function staffAccess(
  tenantId: string,
  role: 'estalara:superadmin' | 'estalara:ops' | 'estalara:readonly' = 'estalara:superadmin',
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

// ─── DB mocks ─────────────────────────────────────────────────────────────────

function tenantFromAndClause(w: { and: { col: unknown; val: string }[] }): string {
  // The update binds `and(eq(tenantId, X), eq(archetype, Y))` — [0].val is the fence.
  return w.and[0]!.val;
}

interface AdminFakeDb {
  _auditRows: Record<string, unknown>[];
  _committedUpdateTenants: string[];
  _captured: { updateWhere: { and: { col: unknown; val: string }[] } | null };
  _control: { failAuditInsert: boolean };
  transaction: ReturnType<typeof vi.fn>;
}

/** Service-role admin client mock with real rollback semantics for the staff tx. */
function makeAdminDb(): AdminFakeDb {
  const auditRows: Record<string, unknown>[] = [];
  const committedUpdateTenants: string[] = [];
  const captured: AdminFakeDb['_captured'] = { updateWhere: null };
  const control = { failAuditInsert: false };

  return {
    _auditRows: auditRows,
    _committedUpdateTenants: committedUpdateTenants,
    _captured: captured,
    _control: control,
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const stagedUpdates: string[] = [];
      const stagedAudit: Record<string, unknown>[] = [];
      const tx = {
        update: vi.fn(() => ({
          set: vi.fn(() => ({
            where: vi.fn((w: { and: { col: unknown; val: string }[] }) => {
              captured.updateWhere = w;
              stagedUpdates.push(tenantFromAndClause(w));
              return Promise.resolve([]);
            }),
          })),
        })),
        insert: vi.fn(() => ({
          values: vi.fn((v: Record<string, unknown>) => {
            if ('adminUserId' in v) {
              if (control.failAuditInsert) return Promise.reject(new Error('audit sink down'));
              stagedAudit.push(v);
              return Promise.resolve([]);
            }
            return Promise.resolve([]);
          }),
        })),
      };
      const result = await fn(tx); // if this rejects, we do NOT commit.
      committedUpdateTenants.push(...stagedUpdates);
      for (const v of stagedAudit) auditRows.push(v);
      return result;
    }),
  };
}

function useAdminDb(db: AdminFakeDb): void {
  vi.mocked(createAdminClient).mockReturnValue(
    db as unknown as ReturnType<typeof createAdminClient>,
  );
}

// ─── Request helper ───────────────────────────────────────────────────────────

function makePatch(tenantId = TENANT_A): NextRequest {
  const url = `http://localhost/api/tenants/${tenantId}/bandit/weights/${ARCHETYPE}`;
  return new NextRequest(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'user-agent': 'vitest-agent',
      'x-forwarded-for': '203.0.113.7',
    },
  });
}

function makeContext(tenantId = TENANT_A): { params: Promise<{ id: string; archetype: string }> } {
  return { params: Promise.resolve({ id: tenantId, archetype: ARCHETYPE }) };
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/test');
  mockResolve.mockResolvedValue(staffAccess(TENANT_A));
});

// ═══════════════════════════════════════════════════════════════════════════
// Auth resolution + option wiring
// ═══════════════════════════════════════════════════════════════════════════

// FOLLOW-1286 (D3): this file pins the pre-freeze bandit behaviour, which now runs only with
// BANDIT_ENABLED=true. The frozen default (flag off) is pinned by `lib/__tests__/bandit-flag.test.ts`,
// `api/adapt/route.bandit-freeze.test.ts` and each frozen route's own `BANDIT_ENABLED off` block.
beforeEach(() => {
  vi.stubEnv('BANDIT_ENABLED', 'true');
});

describe('PATCH bandit resume — auth resolution', () => {
  it('maps AccessError(401) → 401 (unauthenticated)', async () => {
    mockResolve.mockRejectedValue(new AccessError(401, 'Unauthorized'));
    const res = await PATCH(makePatch(), makeContext());
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('maps AccessError(403) → 403', async () => {
    mockResolve.mockRejectedValue(
      new AccessError(403, 'Unauthorized: no tenant access for this request'),
    );
    const res = await PATCH(makePatch(), makeContext());
    expect(res.status).toBe(403);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('forbidden');
  });

  it('maps AccessError(404) → 404 (unknown tenant for staff)', async () => {
    mockResolve.mockRejectedValue(new AccessError(404, 'Unknown tenant'));
    const res = await PATCH(makePatch(), makeContext());
    expect(res.status).toBe(404);
  });

  it('calls resolveTenantAccess with allowStaffOverride:true and the URL tenant (no agency role floor since FOLLOW-1335)', async () => {
    useAdminDb(makeAdminDb());
    await PATCH(makePatch(TENANT_A), makeContext(TENANT_A));
    expect(mockResolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        allowStaffOverride: true,
        tenantId: TENANT_A,
      }),
    );
    expect(mockResolve.mock.calls[0]?.[1]).not.toHaveProperty('minAgencyRole');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Superadmin gate (CEO Q3)
// ═══════════════════════════════════════════════════════════════════════════

describe('PATCH bandit resume — superadmin gate', () => {
  it('ops-rank staff → 403, no transaction, no audit (before the mock path)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:ops'));
    const db = makeAdminDb();
    useAdminDb(db);
    // Even with the DB unconfigured, the superadmin gate must reject BEFORE the mock 200.
    vi.stubEnv('DATABASE_URL', '');

    const res = await PATCH(makePatch(TENANT_A), makeContext(TENANT_A));
    expect(res.status).toBe(403);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('forbidden');
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db._auditRows).toHaveLength(0);
  });

  it('readonly-rank staff → 403', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:readonly'));
    useAdminDb(makeAdminDb());
    const res = await PATCH(makePatch(TENANT_A), makeContext(TENANT_A));
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Staff write — audited + atomic (ADR-0018 §3/§3a)
// ═══════════════════════════════════════════════════════════════════════════

describe('PATCH bandit resume — staff audit trail + atomicity', () => {
  it('superadmin staff → 200 + exactly one attributed staff_audit_log row inside ONE transaction', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:superadmin'));
    const db = makeAdminDb();
    useAdminDb(db);

    const res = await PATCH(makePatch(TENANT_A), makeContext(TENANT_A));
    expect(res.status).toBe(200);
    const body = await parseBody<{ resumed: boolean; archetype: string }>(res);
    expect(body.resumed).toBe(true);
    expect(body.archetype).toBe(ARCHETYPE);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db._auditRows).toHaveLength(1);
    const row = db._auditRows[0]!;
    expect(row.adminUserId).toBe('staff-uuid-777');
    expect(row.action).toBe('bandit_weights.resume');
    expect(row.targetTenantId).toBe(TENANT_A);
    expect(row.payload).toEqual({ archetype: ARCHETYPE, paused: false });
    expect(row.ipAddress).toBe('203.0.113.7');
    expect(row.userAgent).toBe('vitest-agent');
  });

  it('ROLLS BACK the resume when the staff audit insert fails inside the tx (500, no orphan)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:superadmin'));
    const db = makeAdminDb();
    db._control.failAuditInsert = true;
    useAdminDb(db);

    const res = await PATCH(makePatch(TENANT_A), makeContext(TENANT_A));
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('audit_write_failed');
    expect(mockCaptureException).toHaveBeenCalledOnce();

    // NO orphan mutation: the staged update was discarded on rollback.
    expect(db._committedUpdateTenants).toHaveLength(0);
    expect(db._auditRows).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Dependency not configured (dev/CI) — observable mock (the agency path that used to sit
// here, RLS client + no audit, was removed by FOLLOW-1335)
// ═══════════════════════════════════════════════════════════════════════════

describe('PATCH bandit resume — DB unconfigured', () => {
  it('superadmin with DB unconfigured → 200 dev/CI mock { resumed, archetype, mock: true }, no client', async () => {
    vi.stubEnv('DATABASE_URL', '');

    const res = await PATCH(makePatch(TENANT_A), makeContext(TENANT_A));
    expect(res.status).toBe(200);
    const body = await parseBody<{ resumed: boolean; archetype: string; mock: boolean }>(res);
    expect(body.resumed).toBe(true);
    expect(body.archetype).toBe(ARCHETYPE);
    expect(body.mock).toBe(true);
    expect(vi.mocked(createAdminClient)).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MANDATORY WRITE tenant-fence (ADR-0018 §2 invariant 5, RETRO-187)
// ═══════════════════════════════════════════════════════════════════════════

describe('MANDATORY tenant filter — a superadmin for A cannot PATCH B through the real admin query', () => {
  it('WRITE: superadmin PATCH for tenant A binds the real service-role update to A, never B', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:superadmin'));
    const db = makeAdminDb();
    useAdminDb(db);

    const res = await PATCH(makePatch(TENANT_A), makeContext(TENANT_A));
    expect(res.status).toBe(200);

    // The tenant threaded into the actual `.where(eq(tenantId, ...))` is A.
    expect(db._captured.updateWhere ? tenantFromAndClause(db._captured.updateWhere) : null).toBe(
      TENANT_A,
    );
    expect(
      db._captured.updateWhere ? tenantFromAndClause(db._captured.updateWhere) : null,
    ).not.toBe(TENANT_B);
    expect(db._committedUpdateTenants).toEqual([TENANT_A]);
    expect(db._auditRows[0]?.targetTenantId).toBe(TENANT_A);
  });
});

describe('PATCH bandit resume — BANDIT_ENABLED off (FOLLOW-1286, D3)', () => {
  beforeEach(() => {
    vi.stubEnv('BANDIT_ENABLED', 'false');
    mockResolve.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('answers 404 bandit_disabled before auth and never opens a DB client', async () => {
    const res = await PATCH(makePatch(), makeContext());

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { details: { reason: string } } };
    expect(body.error.details.reason).toBe('bandit_disabled');
    expect(mockResolve).not.toHaveBeenCalled();
    expect(vi.mocked(createAdminClient)).not.toHaveBeenCalled();
  });
});
