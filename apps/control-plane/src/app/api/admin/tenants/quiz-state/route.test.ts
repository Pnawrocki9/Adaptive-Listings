/**
 * FOLLOW-998 — tests for GET + PUT /api/admin/tenants/quiz-state (the audited,
 * staff-only write path for the per-tenant quiz on/off).
 *
 * Auth is delegated to `resolveTenantAccess` (its own wiring is covered by
 * `src/lib/__tests__/resolve-tenant-access.test.ts`); these tests PARTIALLY MOCK
 * `@/lib/session-auth` — only `resolveTenantAccess` is a spy, `AccessError` stays
 * real so `accessErrorToResponse` maps statuses for real. `@estalara/db` +
 * `drizzle-orm` use a stateful fake so the tests drive the route's REAL query
 * shape and observe the tenant fence. Mirrors the `al-state` sibling suite.
 *
 * Coverage:
 *   - Staff can flip quiz_enabled; the write is atomic (column + audit row in ONE tx).
 *   - The staff_audit_log row is written with action 'tenant_quiz_state.update' + delta.
 *   - Agency session → 403 staff_only (agencies use the dashboard toggle instead).
 *   - Below-ops staff (readonly) PUT → 403, and NO mutation/audit row written.
 *   - Rule K.2: a thrown DB read/write → 500 (never a fabricated default / silent 200).
 *   - Tenant fence (invariant 5): the write targets ONLY the resolved tenant.
 *
 * @module apps/control-plane/src/app/api/admin/tenants/quiz-state/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type * as SessionAuthModule from '@/lib/session-auth';
import type { TenantQuizState } from './route';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  tenants: {
    id: 'tenants.id',
    quizEnabled: 'tenants.quiz_enabled',
    updatedAt: 'tenants.updated_at',
  },
  staffAuditLog: { __table: 'staff_audit_log' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
}));

vi.mock('@/lib/session-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionAuthModule>();
  return { ...actual, resolveTenantAccess: vi.fn() };
});

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import { createAdminClient, staffAuditLog } from '@estalara/db';
import { resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';
import { GET, PUT } from './route';

const mockResolve = vi.mocked(resolveTenantAccess);

const TENANT_A = '550e8400-e29b-41d4-a716-446655440042';
const TENANT_B = '660e8400-e29b-41d4-a716-446655440099';

// ─── Access fixtures ──────────────────────────────────────────────────────────

function staffAccess(
  tenantId: string,
  role: 'estalara:superadmin' | 'estalara:ops' | 'estalara:readonly' = 'estalara:ops',
): TenantAccess {
  const rank = { 'estalara:superadmin': 3, 'estalara:ops': 2, 'estalara:readonly': 1 }[role];
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

function agencyAccess(tenantId: string): TenantAccess {
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

// ─── Stateful fake DB (drives the route's real query shape) ────────────────────

interface TenantRow {
  quizEnabled: boolean;
  updatedAt: Date;
}

function makeDb(seed: Record<string, Partial<TenantRow>>) {
  const rows: Record<string, TenantRow> = {};
  for (const k of Object.keys(seed)) {
    rows[k] = {
      quizEnabled: true,
      updatedAt: new Date('2026-08-16T00:00:00Z'),
      ...seed[k],
    };
  }
  const auditRows: Record<string, unknown>[] = [];
  const captured = { selectWhereVal: null as string | null, updateWhereVal: null as string | null };
  const control = { failSelect: false, failUpdate: false, failAudit: false };

  const makeSelect = (target: Record<string, TenantRow>) =>
    vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((w: { val: string }) => {
          captured.selectWhereVal = w.val;
          return {
            limit: vi.fn(() => {
              if (control.failSelect) return Promise.reject(new Error('select failed'));
              const row = target[w.val];
              return Promise.resolve(row ? [row] : []);
            }),
          };
        }),
      })),
    }));

  const makeUpdate = (target: Record<string, TenantRow>) =>
    vi.fn(() => ({
      set: vi.fn((values: Partial<TenantRow>) => ({
        where: vi.fn((w: { val: string }) => {
          captured.updateWhereVal = w.val;
          if (control.failUpdate) return Promise.reject(new Error('update failed'));
          const existing = target[w.val];
          if (existing) target[w.val] = { ...existing, ...values };
          return Promise.resolve();
        }),
      })),
    }));

  const makeInsert = (auditTarget: Record<string, unknown>[]) =>
    vi.fn((table: unknown) => {
      if (table === staffAuditLog) {
        return {
          values: vi.fn((v: Record<string, unknown>) => {
            if (control.failAudit) return Promise.reject(new Error('audit sink down'));
            auditTarget.push(v);
            return Promise.resolve([]);
          }),
        };
      }
      throw new Error('unexpected insert() target in test fake');
    });

  const db = {
    _tenants: rows,
    _auditRows: auditRows,
    _captured: captured,
    _control: control,
    select: makeSelect(rows),
    update: makeUpdate(rows),
    insert: makeInsert(auditRows),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      // Staged copies → atomic promote on resolve, discard on throw.
      const staged: Record<string, TenantRow> = {};
      for (const k of Object.keys(rows)) staged[k] = { ...rows[k]! };
      const stagedAudit: Record<string, unknown>[] = [];
      const tx = { update: makeUpdate(staged), insert: makeInsert(stagedAudit) };
      const result = await fn(tx);
      for (const k of Object.keys(staged)) rows[k] = staged[k]!;
      for (const v of stagedAudit) auditRows.push(v);
      return result;
    }),
  };
  vi.mocked(createAdminClient).mockReturnValue(
    db as unknown as ReturnType<typeof createAdminClient>,
  );
  return db;
}

function makeRequest(opts?: {
  method?: string;
  body?: unknown;
  query?: Record<string, string>;
}): NextRequest {
  const url = new URL('http://localhost/api/admin/tenants/quiz-state');
  if (opts?.query) for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
  return new NextRequest(url.toString(), {
    method: opts?.method ?? 'GET',
    headers: {
      Authorization: 'Bearer mock-token',
      'user-agent': 'vitest-agent',
      'x-forwarded-for': '203.0.113.7',
      ...(opts?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(opts?.body ? { body: JSON.stringify(opts.body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// GET
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/tenants/quiz-state', () => {
  it('staff → 200 with the tenant quiz_enabled', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    makeDb({ [TENANT_A]: { quizEnabled: false } });

    const res = await GET(makeRequest({ query: { tenant_id: TENANT_A } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as TenantQuizState;
    expect(body.quiz_enabled).toBe(false);
    expect(body.tenant_id).toBe(TENANT_A);
  });

  it('agency → 403 staff_only (no agency read path)', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A));
    makeDb({ [TENANT_A]: {} });
    const res = await GET(makeRequest({ query: { tenant_id: TENANT_A } }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('staff_only');
  });

  it('Rule K.2: a thrown DB read → 500, never a fabricated default', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb({ [TENANT_A]: {} });
    db._control.failSelect = true;
    const res = await GET(makeRequest({ query: { tenant_id: TENANT_A } }));
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT
// ═══════════════════════════════════════════════════════════════════════════

describe('PUT /api/admin/tenants/quiz-state', () => {
  it('staff ops → flips quiz_enabled AND writes an atomic staff_audit_log row', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb({ [TENANT_A]: { quizEnabled: true } });

    const res = await PUT(
      makeRequest({ method: 'PUT', query: { tenant_id: TENANT_A }, body: { quiz_enabled: false } }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as TenantQuizState;
    expect(body.quiz_enabled).toBe(false);

    // Column actually flipped.
    expect(db._tenants[TENANT_A]!.quizEnabled).toBe(false);
    // Exactly one audit row, correct action + before/after delta + attribution.
    expect(db._auditRows).toHaveLength(1);
    const audit = db._auditRows[0] as {
      action: string;
      adminUserId: string;
      targetTenantId: string;
      payload: { before: { quiz_enabled: boolean }; after: { quiz_enabled: boolean } };
    };
    expect(audit.action).toBe('tenant_quiz_state.update');
    expect(audit.adminUserId).toBe('staff-uuid-777');
    expect(audit.targetTenantId).toBe(TENANT_A);
    expect(audit.payload.before.quiz_enabled).toBe(true);
    expect(audit.payload.after.quiz_enabled).toBe(false);
    // The write went through a transaction (atomicity).
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('below-ops staff (readonly) → 403 and NO mutation / NO audit row', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:readonly'));
    const db = makeDb({ [TENANT_A]: { quizEnabled: true } });

    const res = await PUT(
      makeRequest({ method: 'PUT', query: { tenant_id: TENANT_A }, body: { quiz_enabled: false } }),
    );
    expect(res.status).toBe(403);
    expect(db._tenants[TENANT_A]!.quizEnabled).toBe(true); // untouched
    expect(db._auditRows).toHaveLength(0);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('agency → 403 staff_only (agencies use the dashboard toggle)', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A));
    const db = makeDb({ [TENANT_A]: { quizEnabled: true } });
    const res = await PUT(
      makeRequest({ method: 'PUT', query: { tenant_id: TENANT_A }, body: { quiz_enabled: false } }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('staff_only');
    expect(db._tenants[TENANT_A]!.quizEnabled).toBe(true);
  });

  it('invalid body (missing quiz_enabled) → 400', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    makeDb({ [TENANT_A]: {} });
    const res = await PUT(
      makeRequest({ method: 'PUT', query: { tenant_id: TENANT_A }, body: { nope: 1 } }),
    );
    expect(res.status).toBe(400);
  });

  it('audit insert fails → whole tx rolls back → 500, column NOT changed (Rule K.2)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb({ [TENANT_A]: { quizEnabled: true } });
    db._control.failAudit = true;

    const res = await PUT(
      makeRequest({ method: 'PUT', query: { tenant_id: TENANT_A }, body: { quiz_enabled: false } }),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('audit_write_failed');
    // Rollback: the column mutation was discarded with the failed audit insert.
    expect(db._tenants[TENANT_A]!.quizEnabled).toBe(true);
    expect(db._auditRows).toHaveLength(0);
  });

  it('tenant fence (invariant 5): the write targets ONLY the resolved tenant', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb({
      [TENANT_A]: { quizEnabled: true },
      [TENANT_B]: { quizEnabled: true },
    });

    await PUT(
      makeRequest({ method: 'PUT', query: { tenant_id: TENANT_A }, body: { quiz_enabled: false } }),
    );
    expect(db._captured.updateWhereVal).toBe(TENANT_A);
    expect(db._tenants[TENANT_B]!.quizEnabled).toBe(true); // sibling tenant untouched
  });
});
