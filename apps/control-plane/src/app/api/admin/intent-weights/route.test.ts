/**
 * Tests for GET/PUT /api/admin/intent-weights (FOLLOW-597).
 *
 * Auth model (ADR-0018 §2): the route delegates the entire agency + staff resolution
 * to `resolveTenantAccess`, whose own end-to-end wiring (SSR cookie, staff gate,
 * tenant existence check, RLS trap) is exercised by
 * `src/lib/__tests__/resolve-tenant-access.test.ts`. These route tests therefore
 * PARTIALLY MOCK `@/lib/session-auth` — only `resolveTenantAccess` is a spy;
 * `AccessError` and every other export stay real (via `importOriginal`).
 *
 * The tenant-filter tests (READ + WRITE) drive the route's REAL Drizzle query: the
 * DB mock keys a stateful per-tenant store on the value the route actually binds
 * into `.where(eq(intentWeightConfigs.tenantId, access.tenantId))` (RETRO-187 — NOT a
 * pre-filtered local array). A mis-fence would key a different tenant and the
 * assertions fail.
 *
 * @module apps/control-plane/src/app/api/admin/intent-weights/route.test
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SessionAuthModule from '@/lib/session-auth';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  intentWeightConfigs: {
    id: 'id',
    tenantId: 'tenant_id',
    weights: 'weights',
    isActive: 'is_active',
    createdAt: 'created_at',
    createdBy: 'created_by',
  },
  staffAuditLog: { __table: 'staff_audit_log' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  and: vi.fn((...conds: unknown[]) => ({ and: conds })),
  desc: vi.fn((col: unknown) => ({ desc: col })),
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

function agencyAccess(tenantId = TENANT_A): TenantAccess {
  return {
    via: 'agency',
    tenantId,
    claims: {
      sub: 'agency-user',
      email: 'user@agency.com',
      tenant_id: tenantId,
      agency_role: 'agency:admin',
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

// ─── Stateful per-tenant DB mock (exercises the REAL query fence) ─────────────

interface StoredRow {
  id: string;
  weights: Record<string, unknown>;
  createdAt: Date;
}

interface FakeDb {
  _store: Record<string, StoredRow | undefined>;
  _auditRows: Record<string, unknown>[];
  _captured: {
    selectWhere: { and: { col: unknown; val: string }[] } | null;
    updateWhere: { and: { col: unknown; val: string }[] } | null;
  };
  _control: { failAuditInsert: boolean; nextId: number };
  select: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
}

function tenantFromAndClause(w: { and: { col: unknown; val: string }[] }): string {
  // Both GET/PUT bind `and(eq(tenantId, X), eq(isActive, true))` — [0].val is the tenant fence.
  return w.and[0]!.val;
}

function snapshotStore(
  store: Record<string, StoredRow | undefined>,
): Record<string, StoredRow | undefined> {
  return { ...store };
}

function makeMultiTenantDb(seed: Record<string, StoredRow> = {}): FakeDb {
  const store: Record<string, StoredRow | undefined> = { ...seed };
  const auditRows: Record<string, unknown>[] = [];
  const captured: FakeDb['_captured'] = { selectWhere: null, updateWhere: null };
  const control = { failAuditInsert: false, nextId: 1 };

  const makeSelect = (target: Record<string, StoredRow | undefined>): ReturnType<typeof vi.fn> =>
    vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((w: { and: { col: unknown; val: string }[] }) => {
          captured.selectWhere = w;
          return {
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => {
                const row = target[tenantFromAndClause(w)];
                return Promise.resolve(row ? [row] : []);
              }),
            })),
          };
        }),
      })),
    }));

  const makeUpdate = (target: Record<string, StoredRow | undefined>): ReturnType<typeof vi.fn> =>
    vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn((w: { and: { col: unknown; val: string }[] }) => {
          captured.updateWhere = w;
          const key = tenantFromAndClause(w);
          target[key] = undefined; // deactivate: the row no longer matches is_active=true.
          return Promise.resolve([]);
        }),
      })),
    }));

  const makeInsert = (
    target: Record<string, StoredRow | undefined>,
    audit: Record<string, unknown>[],
  ): ReturnType<typeof vi.fn> =>
    vi.fn(() => ({
      values: vi.fn((v: Record<string, unknown>) => {
        if ('adminUserId' in v) {
          // staffAuditLog insert — the ROUTE never calls `.returning()` on this one
          // (it just `await`s the `.values(...)` call directly), so the audit
          // push/reject must happen HERE, not behind a `.returning()` the route
          // never invokes.
          if (control.failAuditInsert) return Promise.reject(new Error('audit sink down'));
          audit.push(v);
          return Promise.resolve([]);
        }
        // intentWeightConfigs insert — the route DOES call `.returning({...})`.
        return {
          returning: vi.fn(() => {
            const row: StoredRow = {
              // AdminIntentConfigResponseSchema requires a valid UUID for `id`.
              id: `aaaaaaaa-0000-4000-8000-${String(control.nextId++).padStart(12, '0')}`,
              weights: v.weights as Record<string, unknown>,
              createdAt: new Date('2026-07-21T12:00:00.000Z'),
            };
            target[v.tenantId as string] = row;
            return Promise.resolve([row]);
          }),
        };
      }),
    }));

  return {
    _store: store,
    _auditRows: auditRows,
    _captured: captured,
    _control: control,
    select: makeSelect(store),
    // Real rollback semantics: staged mutations discarded when the tx callback throws.
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const stagedStore = snapshotStore(store);
      const stagedAudit: Record<string, unknown>[] = [];
      const tx = {
        update: makeUpdate(stagedStore),
        insert: makeInsert(stagedStore, stagedAudit),
      };
      const result = await fn(tx); // if this rejects, we do NOT commit.
      for (const k of Object.keys(stagedStore)) store[k] = stagedStore[k];
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
  const url = new URL('http://localhost/api/admin/intent-weights');
  if (tenantId) url.searchParams.set('tenant_id', tenantId);
  return new NextRequest(url.toString());
}

function makePut(body: unknown, tenantId?: string): NextRequest {
  const url = new URL('http://localhost/api/admin/intent-weights');
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
  const raw: unknown = await res.json();
  return raw as T;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
  mockResolve.mockResolvedValue(agencyAccess());
});

// ═══════════════════════════════════════════════════════════════════════════
// GET — auth + shape
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/intent-weights', () => {
  it('returns 401 when resolveTenantAccess throws AccessError(401)', async () => {
    mockResolve.mockRejectedValue(new AccessError(401, 'Unauthorized'));
    const res = await GET(makeGet());
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('returns the no-override nulled shape when the tenant has no active row', async () => {
    useDb(makeMultiTenantDb({}));
    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await parseBody<{ id: string | null; is_active: boolean; tenant_id: string }>(res);
    expect(body.id).toBeNull();
    expect(body.is_active).toBe(false);
    expect(body.tenant_id).toBe(TENANT_A);
  });

  it('returns 500 when DB is unconfigured (Rule K.2 — no mock fallback)', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    vi.stubEnv('DATABASE_URL_DIRECT', '');
    const res = await GET(makeGet());
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('db_unconfigured');
  });

  it('option-wiring (FOLLOW-603 pattern): calls resolveTenantAccess with allowStaffOverride:true + minAgencyRole:agency:viewer', async () => {
    useDb(makeMultiTenantDb({}));
    await GET(makeGet(TENANT_A));
    expect(mockResolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ allowStaffOverride: true, minAgencyRole: 'agency:viewer' }),
    );
  });

  it('returns 500 (not fabricated weights) when the DB query throws (Rule K.2)', async () => {
    vi.mocked(createAdminClient).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockRejectedValue(new Error('connection refused')),
            }),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof createAdminClient>);

    const res = await GET(makeGet());
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('db_error');
    expect(mockCaptureException).toHaveBeenCalledOnce();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT — staff write-rank gate
// ═══════════════════════════════════════════════════════════════════════════

describe('PUT /api/admin/intent-weights — staff write-rank gate', () => {
  it('estalara:readonly staff → 403 (rank < ops), no mutation, no audit', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:readonly'));
    const db = makeMultiTenantDb();
    useDb(db);

    const res = await PUT(makePut({ weights: { behavioral_damping: 0.5 } }, TENANT_A));
    expect(res.status).toBe(403);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db._auditRows).toHaveLength(0);
  });

  it('estalara:ops staff → 200 (canWrite)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:ops'));
    useDb(makeMultiTenantDb());
    const res = await PUT(makePut({ weights: {} }, TENANT_A));
    expect(res.status).toBe(200);
  });

  it('option-wiring (FOLLOW-603 pattern): calls resolveTenantAccess with allowStaffOverride:true + minAgencyRole:agency:admin', async () => {
    useDb(makeMultiTenantDb());
    await PUT(makePut({ weights: {} }, TENANT_A));
    expect(mockResolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ allowStaffOverride: true, minAgencyRole: 'agency:admin' }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT — staff audit trail + atomicity (ADR-0018 §3/§3a)
// ═══════════════════════════════════════════════════════════════════════════

describe('PUT /api/admin/intent-weights — staff audit trail + atomicity', () => {
  it('a successful staff write inserts exactly one staff_audit_log row (attributed)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:ops'));
    const db = makeMultiTenantDb();
    useDb(db);

    const res = await PUT(makePut({ weights: { behavioral_damping: 0.4 } }, TENANT_A));
    expect(res.status).toBe(200);
    expect(db._auditRows).toHaveLength(1);
    const row = db._auditRows[0]!;
    expect(row.adminUserId).toBe('staff-uuid-777');
    expect(row.action).toBe('intent_weights.update');
    expect(row.targetTenantId).toBe(TENANT_A);
    expect(row.ipAddress).toBe('203.0.113.7');
    expect(row.userAgent).toBe('vitest-agent');
  });

  it('ROLLS BACK the weight swap when the staff audit insert fails inside the tx (no orphan mutation)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:ops'));
    const existing: StoredRow = {
      id: 'existing-row',
      weights: { behavioral_damping: 0.3 },
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
    };
    const db = makeMultiTenantDb({ [TENANT_A]: existing });
    db._control.failAuditInsert = true;
    useDb(db);

    const res = await PUT(makePut({ weights: { behavioral_damping: 0.9 } }, TENANT_A));

    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('audit_write_failed');
    expect(mockCaptureException).toHaveBeenCalledOnce();

    // NO ORPHAN MUTATION — tenant A's active row is byte-unchanged; the staged
    // deactivate+insert was discarded on rollback.
    expect(db._store[TENANT_A]).toEqual(existing);
    expect(db._auditRows).toHaveLength(0);
  });

  it('agency write does NOT audit and is not rank-gated', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A));
    const db = makeMultiTenantDb();
    useDb(db);

    const res = await PUT(makePut({ weights: { behavioral_damping: 0.4 } }, TENANT_A));
    expect(res.status).toBe(200);
    expect(db._auditRows).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MANDATORY tenant-filter tests — READ + WRITE (ADR-0018 §2 invariant 5, RETRO-187)
// ═══════════════════════════════════════════════════════════════════════════

describe('MANDATORY tenant filter — staff cannot cross tenants (RETRO-187)', () => {
  it('READ: staff request for tenant A binds the real select to A and returns A’s row, never B’s', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:ops'));
    const rowA: StoredRow = {
      id: 'aaaaaaaa-0000-4000-8000-00000000000a',
      weights: { behavioral_damping: 0.11 },
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
    };
    const rowB: StoredRow = {
      id: 'bbbbbbbb-0000-4000-8000-00000000000b',
      weights: { behavioral_damping: 0.99 },
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
    };
    const db = makeMultiTenantDb({ [TENANT_A]: rowA, [TENANT_B]: rowB });
    useDb(db);

    const res = await GET(makeGet(TENANT_A));
    const body = await parseBody<{ id: string; weights: { behavioral_damping: number } }>(res);

    expect(db._captured.selectWhere ? tenantFromAndClause(db._captured.selectWhere) : null).toBe(
      TENANT_A,
    );
    expect(body.id).toBe(rowA.id);
    expect(body.weights.behavioral_damping).toBe(0.11);
    expect(body.weights.behavioral_damping).not.toBe(0.99);
  });

  it('WRITE: staff PUT for tenant A fences the real swap to A and leaves tenant B untouched', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:ops'));
    const rowA: StoredRow = {
      id: 'aaaaaaaa-0000-4000-8000-00000000000a',
      weights: { behavioral_damping: 0.11 },
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
    };
    const rowB: StoredRow = {
      id: 'bbbbbbbb-0000-4000-8000-00000000000b',
      weights: { behavioral_damping: 0.99 },
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
    };
    const db = makeMultiTenantDb({ [TENANT_A]: rowA, [TENANT_B]: rowB });
    useDb(db);

    const res = await PUT(makePut({ weights: { behavioral_damping: 0.5 } }, TENANT_A));
    expect(res.status).toBe(200);

    expect(db._captured.updateWhere ? tenantFromAndClause(db._captured.updateWhere) : null).toBe(
      TENANT_A,
    );
    // A was replaced with the new weights; B's row is byte-untouched.
    expect(db._store[TENANT_A]?.weights.behavioral_damping).toBe(0.5);
    expect(db._store[TENANT_B]).toEqual(rowB);
    expect(db._auditRows[0]?.targetTenantId).toBe(TENANT_A);
  });
});
