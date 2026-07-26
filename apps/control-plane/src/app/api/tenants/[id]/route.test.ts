/**
 * Tests for PATCH /api/tenants/:id — tenant settings update.
 * FOLLOW-102 AC2: quiz_enabled toggle, auth, invalid payload.
 *
 * DATABASE_URL_ADMIN is not set in CI — route returns a mock response.
 * Auth is mocked via vi.mock('@estalara/auth').
 *
 * @module apps/control-plane/src/app/api/tenants/[id]/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { StaffClaims } from '@estalara/auth';

// Mock @estalara/db to avoid a real database connection.
vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => ({
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([
      {
        id: 'tenant-uuid-001',
        quizEnabled: false,
      },
    ]),
  })),
  tenants: {
    id: 'id',
    quizEnabled: 'quiz_enabled',
    updatedAt: 'updated_at',
    // FOLLOW-657: session-auth.ts's tenantExists() also filters on deletedAt.
    deletedAt: 'deleted_at',
  },
  // FOLLOW-657: the staff write path appends one staff_audit_log row per PATCH.
  staffAuditLog: { __table: 'staff_audit_log' },
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
}));

// Re-export eq from drizzle-orm for the route — mock it too.
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  and: vi.fn((...args: unknown[]) => args),
  isNull: vi.fn((col: unknown) => ({ isNull: col })),
}));

// Mock auth — default to an authenticated tenant-scoped JWT.
// FOLLOW-657: session-auth.ts's resolveTenantAccess also imports isTenantClaims,
// isStaffClaims, and requireAgencyRole from @estalara/auth — these are pure
// predicate/assert functions, safe to keep REAL via importOriginal. Only
// getAuthClaims (the actual auth I/O) is mocked, exactly as before.
// The agency-path mocks resolve a partial tenant claim (pre-existing style); the
// FOLLOW-657 staff-path mocks resolve a full StaffClaims, so the union covers both.
type MockedClaims = { tenant_id: string } | StaffClaims;
const mockGetAuthClaims = vi.fn<(req: unknown) => Promise<MockedClaims | null>>();
vi.mock('@estalara/auth', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.mock importOriginal generic requires inline import() type
  const actual = await importOriginal<typeof import('@estalara/auth')>();
  return {
    ...actual,
    getAuthClaims: (req: unknown): Promise<MockedClaims | null> => mockGetAuthClaims(req),
  };
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makePatchRequest(
  body: Record<string, unknown>,
  tenantId = 'tenant-uuid-001',
): NextRequest {
  return new NextRequest(`http://localhost/api/tenants/${tenantId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test.jwt.token' },
    body: JSON.stringify(body),
  });
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('PATCH /api/tenants/:id — no DB in CI (mock path)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: authenticated as tenant-uuid-001
    mockGetAuthClaims.mockResolvedValue({ tenant_id: 'tenant-uuid-001' });
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    vi.stubEnv('DATABASE_URL_DIRECT', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // AC2 test 1: toggle quiz OFF
  it('returns 200 with quiz_enabled=false when toggling quiz OFF (mock path)', async () => {
    const { PATCH } = await import('./route.js');
    const res = await PATCH(makePatchRequest({ quiz_enabled: false }), {
      params: Promise.resolve({ id: 'tenant-uuid-001' }),
    });

    expect(res.status).toBe(200);
    const body = await parseBody<{ id: string; quiz_enabled: boolean; mock: boolean }>(res);
    expect(body.id).toBe('tenant-uuid-001');
    expect(body.quiz_enabled).toBe(false);
    expect(body.mock).toBe(true);
  });

  // AC2 test 2: toggle quiz ON
  it('returns 200 with quiz_enabled=true when toggling quiz ON (mock path)', async () => {
    const { PATCH } = await import('./route.js');
    const res = await PATCH(makePatchRequest({ quiz_enabled: true }), {
      params: Promise.resolve({ id: 'tenant-uuid-001' }),
    });

    expect(res.status).toBe(200);
    const body = await parseBody<{ id: string; quiz_enabled: boolean; mock: boolean }>(res);
    expect(body.quiz_enabled).toBe(true);
  });

  // AC2 test 3: invalid payload — string instead of boolean
  it('returns 400 for invalid payload (string instead of boolean)', async () => {
    const { PATCH } = await import('./route.js');
    const res = await PATCH(makePatchRequest({ quiz_enabled: 'yes' }), {
      params: Promise.resolve({ id: 'tenant-uuid-001' }),
    });

    expect(res.status).toBe(400);
    const body = await parseBody<{ error: string }>(res);
    expect(body.error).toBe('Validation failed');
  });

  // AC2 test 4: no updatable fields
  it('returns 400 when no updatable fields are provided', async () => {
    const { PATCH } = await import('./route.js');
    const res = await PATCH(makePatchRequest({}), {
      params: Promise.resolve({ id: 'tenant-uuid-001' }),
    });

    expect(res.status).toBe(400);
  });

  // AC2 auth: missing token → 401
  it('returns 401 when auth token is missing', async () => {
    mockGetAuthClaims.mockResolvedValueOnce(null);

    const { PATCH } = await import('./route.js');
    const res = await PATCH(makePatchRequest({ quiz_enabled: false }), {
      params: Promise.resolve({ id: 'tenant-uuid-001' }),
    });

    expect(res.status).toBe(401);
  });

  // AC2 auth: mismatched tenant → 403
  it('returns 403 when the JWT tenant does not match the :id param', async () => {
    mockGetAuthClaims.mockResolvedValueOnce({ tenant_id: 'other-tenant-uuid' });

    const { PATCH } = await import('./route.js');
    const res = await PATCH(makePatchRequest({ quiz_enabled: false }), {
      params: Promise.resolve({ id: 'tenant-uuid-001' }),
    });

    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/tenants/:id — with DB configured', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthClaims.mockResolvedValue({ tenant_id: 'tenant-uuid-001' });
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // AC2 DB test: successful update returns id + quiz_enabled
  it('returns 200 with id and quiz_enabled from DB row on success', async () => {
    const { PATCH } = await import('./route.js');
    const res = await PATCH(makePatchRequest({ quiz_enabled: false }), {
      params: Promise.resolve({ id: 'tenant-uuid-001' }),
    });

    expect(res.status).toBe(200);
    const body = await parseBody<{ id: string; quiz_enabled: boolean }>(res);
    expect(body.id).toBe('tenant-uuid-001');
    expect(body.quiz_enabled).toBe(false);
    // DB path does not include 'mock' field
    expect((body as Record<string, unknown>).mock).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FOLLOW-657 (ADR-0018 §2): Estalara staff override
//
// `:id` doubles as the explicit staff tenant param (no separate ?tenant_id — see
// route.ts doc comment). Drives the REAL resolveTenantAccess → verifyTracerAdminAuth
// → tenantExists chain (only getAuthClaims and the DB layer are mocked). The outer
// `db.select` serves session-auth's tenantExists lookup; `db.transaction()` stages
// the update + staff_audit_log insert, committing both or rolling both back.
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/tenants/:id — Estalara staff override (ADR-0018 §2, FOLLOW-657)', () => {
  // tenantExists() (session-auth.ts) fails closed on non-UUID ids BEFORE hitting
  // the DB — must be a real-format UUID for the staff DB-mock path to be reached.
  const STAFF_TENANT_ID = '550e8400-e29b-41d4-a716-446655440001';

  function staffClaims(role: 'estalara:ops' | 'estalara:readonly' | 'estalara:superadmin') {
    return {
      sub: 'staff-uuid-777',
      email: 'staff@estalara.com',
      tenant_id: null,
      estalara_staff: true as const,
      estalara_role: role,
      mfa_verified: true,
    };
  }

  function makeStaffRequest(
    body: Record<string, unknown>,
    tenantId = STAFF_TENANT_ID,
  ): NextRequest {
    return new NextRequest(`http://localhost/api/tenants/${tenantId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer staff-jwt-token',
        'user-agent': 'vitest-staff-agent',
        'x-forwarded-for': '203.0.113.9',
      },
      body: JSON.stringify(body),
    });
  }

  function makeStaffDb(
    opts: { tenantExists?: boolean; failAudit?: boolean; rowFound?: boolean } = {},
  ) {
    const tenantExists = opts.tenantExists ?? true;
    const failAudit = opts.failAudit ?? false;
    const rowFound = opts.rowFound ?? true;
    const auditRows: Record<string, unknown>[] = [];

    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(tenantExists ? [{ id: STAFF_TENANT_ID }] : [])),
        })),
      })),
    }));

    const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const stagedAudit: Record<string, unknown>[] = [];
      const txUpdate = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() =>
              Promise.resolve(rowFound ? [{ id: STAFF_TENANT_ID, quizEnabled: true }] : []),
            ),
          })),
        })),
      }));
      const txInsert = vi.fn(() => ({
        values: vi.fn((v: Record<string, unknown>) => {
          if (failAudit) return Promise.reject(new Error('audit sink down'));
          stagedAudit.push(v);
          return Promise.resolve([]);
        }),
      }));
      const tx = { update: txUpdate, insert: txInsert };
      await fn(tx); // rejecting inside discards staged state — nothing commits.
      for (const row of stagedAudit) auditRows.push(row);
    });

    return { select, transaction, _auditRows: auditRows };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('estalara:readonly staff (rank < ops) → 403, no DB write', async () => {
    mockGetAuthClaims.mockResolvedValue(staffClaims('estalara:readonly'));
    const { createAdminClient } = await import('@estalara/db');
    const db = makeStaffDb();
    vi.mocked(createAdminClient).mockReturnValue(
      db as unknown as ReturnType<typeof createAdminClient>,
    );

    const { PATCH } = await import('./route.js');
    const res = await PATCH(makeStaffRequest({ quiz_enabled: true }), {
      params: Promise.resolve({ id: STAFF_TENANT_ID }),
    });

    expect(res.status).toBe(403);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('unknown :id (not in tenants table) → 404, no DB write', async () => {
    mockGetAuthClaims.mockResolvedValue(staffClaims('estalara:ops'));
    const { createAdminClient } = await import('@estalara/db');
    const db = makeStaffDb({ tenantExists: false });
    vi.mocked(createAdminClient).mockReturnValue(
      db as unknown as ReturnType<typeof createAdminClient>,
    );

    const unknownTenantId = '550e8400-e29b-41d4-a716-446655440002';
    const { PATCH } = await import('./route.js');
    const res = await PATCH(makeStaffRequest({ quiz_enabled: true }, unknownTenantId), {
      params: Promise.resolve({ id: unknownTenantId }),
    });

    expect(res.status).toBe(404);
  });

  it('headless ADMIN_API_SECRET Bearer is REJECTED for staff (RETRO-187 — not attributable)', async () => {
    vi.stubEnv('ADMIN_API_SECRET', 'shared-secret-value');
    mockGetAuthClaims.mockResolvedValue(null); // no identified session/JWT
    const { createAdminClient } = await import('@estalara/db');
    const db = makeStaffDb();
    vi.mocked(createAdminClient).mockReturnValue(
      db as unknown as ReturnType<typeof createAdminClient>,
    );

    const req = new NextRequest(`http://localhost/api/tenants/${STAFF_TENANT_ID}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer shared-secret-value', // === ADMIN_API_SECRET
      },
      body: JSON.stringify({ quiz_enabled: true }),
    });

    const { PATCH } = await import('./route.js');
    const res = await PATCH(req, { params: Promise.resolve({ id: STAFF_TENANT_ID }) });

    expect(res.status).toBe(403);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('estalara:ops staff → 200, one staff_audit_log row, attributed', async () => {
    mockGetAuthClaims.mockResolvedValue(staffClaims('estalara:ops'));
    const { createAdminClient } = await import('@estalara/db');
    const db = makeStaffDb();
    vi.mocked(createAdminClient).mockReturnValue(
      db as unknown as ReturnType<typeof createAdminClient>,
    );

    const { PATCH } = await import('./route.js');
    const res = await PATCH(makeStaffRequest({ quiz_enabled: true }), {
      params: Promise.resolve({ id: STAFF_TENANT_ID }),
    });

    expect(res.status).toBe(200);
    const body = await parseBody<{ id: string; quiz_enabled: boolean }>(res);
    expect(body.id).toBe(STAFF_TENANT_ID);
    expect(body.quiz_enabled).toBe(true);

    expect(db._auditRows).toHaveLength(1);
    const row = db._auditRows[0]!;
    expect(row.adminUserId).toBe('staff-uuid-777');
    expect(row.action).toBe('tenant.quiz_enabled_update');
    expect(row.targetTenantId).toBe(STAFF_TENANT_ID);
    expect(row.ipAddress).toBe('203.0.113.9');
    expect(row.userAgent).toBe('vitest-staff-agent');
  });

  it('staff write whose audit insert FAILS → 500, no orphan mutation reported', async () => {
    mockGetAuthClaims.mockResolvedValue(staffClaims('estalara:ops'));
    const { createAdminClient } = await import('@estalara/db');
    const db = makeStaffDb({ failAudit: true });
    vi.mocked(createAdminClient).mockReturnValue(
      db as unknown as ReturnType<typeof createAdminClient>,
    );

    const { PATCH } = await import('./route.js');
    const res = await PATCH(makeStaffRequest({ quiz_enabled: true }), {
      params: Promise.resolve({ id: STAFF_TENANT_ID }),
    });

    expect(res.status).toBe(500);
    expect(db._auditRows).toHaveLength(0);
  });
});
