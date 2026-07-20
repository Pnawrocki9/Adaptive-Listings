/**
 * Tests for GET/POST /api/quiz/config.
 *
 * Auth model (ADR-0018 §2, FOLLOW-595): the route delegates the entire agency +
 * staff resolution to `resolveTenantAccess`, whose own end-to-end wiring (SSR
 * cookie, staff gate, tenant existence check, RLS trap) is exercised by
 * `src/lib/__tests__/resolve-tenant-access.test.ts`. These route tests therefore
 * PARTIALLY MOCK `@/lib/session-auth` — only `resolveTenantAccess` is a spy;
 * `AccessError`, `tenantExists`, and every other export stay real (via
 * `importOriginal`), so `accessErrorToResponse(err instanceof AccessError)` maps
 * statuses for real.
 *
 * The tenant-filter tests (READ + WRITE) drive the route's REAL Drizzle query: the
 * DB mock keys a stateful per-tenant store on the value the route actually binds
 * into `.where(eq(tenants.id, access.tenantId))` (RETRO-187 — NOT a pre-filtered
 * local array). A mis-fence would key a different tenant and the assertions fail.
 *
 * @module apps/control-plane/src/app/api/quiz/config/route.test
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SessionAuthModule from '@/lib/session-auth';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  tenants: {
    id: 'tenants.id',
    quizConfig: 'quiz_config',
    quizEnabled: 'quiz_enabled',
    updatedAt: 'updated_at',
  },
  staffAuditLog: { __table: 'staff_audit_log' },
}));

// `eq(col, val)` → a plain object the DB mock reads `.val` off of. This is how the
// tenant-filter tests observe the fence the route bound (RETRO-187).
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

import { createAdminClient } from '@estalara/db';
import { resolveTenantAccess, AccessError, type TenantAccess } from '@/lib/session-auth';
import { QUIZ_LANGUAGE_VALUES, QuizConfigSchema, parseStoredQuizConfig } from '@estalara/shared';

import { GET, POST } from './route';

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
      agency_role: 'agency:viewer',
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

// ─── Stateful per-tenant DB mock (exercises the REAL query fence) ───────────────

interface FakeDb {
  _store: Record<string, { quizConfig: Record<string, unknown> }>;
  _auditRows: Record<string, unknown>[];
  _captured: {
    selectWhere: { col: unknown; val: string } | null;
    updateWhere: { col: unknown; val: string } | null;
    updateSet: { quizConfig: Record<string, unknown> } | null;
  };
  /** Test control: when true, the audit insert INSIDE the tx rejects (FOLLOW-605 rollback). */
  _control: { failAuditInsert: boolean };
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
}

/** A shallow snapshot of the store, so staged tx mutations can be discarded on rollback. */
function snapshotStore(
  store: Record<string, { quizConfig: Record<string, unknown> }>,
): Record<string, { quizConfig: Record<string, unknown> }> {
  const copy: Record<string, { quizConfig: Record<string, unknown> }> = {};
  for (const k of Object.keys(store)) copy[k] = { quizConfig: { ...store[k]!.quizConfig } };
  return copy;
}

/** Seed a store of tenantId → quizConfig; queries filter on the fence the route binds. */
function makeMultiTenantDb(seed: Record<string, Record<string, unknown>> = {}): FakeDb {
  const store: Record<string, { quizConfig: Record<string, unknown> }> = {};
  for (const k of Object.keys(seed)) store[k] = { quizConfig: { ...seed[k] } };
  const auditRows: Record<string, unknown>[] = [];
  const captured: FakeDb['_captured'] = { selectWhere: null, updateWhere: null, updateSet: null };
  const control = { failAuditInsert: false };

  // Non-transactional writers, used by the AGENCY path (byte-unchanged).
  const makeSelect = (
    target: Record<string, { quizConfig: Record<string, unknown> }>,
  ): ReturnType<typeof vi.fn> =>
    vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((w: { col: unknown; val: string }) => {
          captured.selectWhere = w;
          return {
            limit: vi.fn(() => {
              const row = target[w.val];
              return Promise.resolve(
                row ? [{ quizConfig: row.quizConfig, quizEnabled: true }] : [],
              );
            }),
          };
        }),
      })),
    }));

  const makeUpdate = (
    target: Record<string, { quizConfig: Record<string, unknown> }>,
  ): ReturnType<typeof vi.fn> =>
    vi.fn(() => ({
      set: vi.fn((vals: { quizConfig: Record<string, unknown> }) => {
        captured.updateSet = vals;
        return {
          where: vi.fn((w: { col: unknown; val: string }) => {
            captured.updateWhere = w;
            const existing = target[w.val];
            if (existing) existing.quizConfig = vals.quizConfig;
            else target[w.val] = { quizConfig: vals.quizConfig };
            return Promise.resolve([]);
          }),
        };
      }),
    }));

  const makeInsert = (target: Record<string, unknown>[]): ReturnType<typeof vi.fn> =>
    vi.fn(() => ({
      values: vi.fn((v: Record<string, unknown>) => {
        if (control.failAuditInsert) return Promise.reject(new Error('audit sink down'));
        target.push(v);
        return Promise.resolve([]);
      }),
    }));

  return {
    _store: store,
    _auditRows: auditRows,
    _captured: captured,
    _control: control,
    select: makeSelect(store),
    update: makeUpdate(store),
    insert: makeInsert(auditRows),
    // Real rollback semantics: the tx callback mutates STAGED copies of the store and
    // audit rows. If it resolves, the staged mutations are committed atomically; if it
    // throws (e.g. the audit insert rejects), the staged mutations are DISCARDED — the
    // real store is byte-unchanged (no orphan mutation). This models Postgres
    // commit-or-rollback for the FOLLOW-605 atomicity test.
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const stagedStore = snapshotStore(store);
      const stagedAudit: Record<string, unknown>[] = [];
      const tx = {
        select: makeSelect(stagedStore),
        update: makeUpdate(stagedStore),
        insert: makeInsert(stagedAudit),
      };
      await fn(tx); // if this rejects, we do NOT commit — staged mutations vanish.
      // Commit: promote staged state into the real store / audit log.
      for (const k of Object.keys(stagedStore)) store[k] = stagedStore[k]!;
      for (const v of stagedAudit) auditRows.push(v);
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
  const url = new URL('http://localhost/api/quiz/config');
  if (tenantId) url.searchParams.set('tenant_id', tenantId);
  return new NextRequest(url.toString());
}

function makePost(body: unknown, tenantId?: string): NextRequest {
  const url = new URL('http://localhost/api/quiz/config');
  if (tenantId) url.searchParams.set('tenant_id', tenantId);
  return new NextRequest(url.toString(), {
    method: 'POST',
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
  mockResolve.mockResolvedValue(agencyAccess());
});

// ═══════════════════════════════════════════════════════════════════════════
// Schema-parse invariants (unchanged by the auth port; @estalara/shared only)
// ═══════════════════════════════════════════════════════════════════════════

describe('QUIZ_LANGUAGE_VALUES canonical enum (FOLLOW-270)', () => {
  it('includes all three supported locales', () => {
    expect(QUIZ_LANGUAGE_VALUES).toContain('en');
    expect(QUIZ_LANGUAGE_VALUES).toContain('pl');
    expect(QUIZ_LANGUAGE_VALUES).toContain('es');
    expect(QUIZ_LANGUAGE_VALUES).toHaveLength(3);
  });

  it('QuizConfigSchema accepts all three language values', () => {
    for (const lang of QUIZ_LANGUAGE_VALUES) {
      const result = QuizConfigSchema.safeParse({ language: lang });
      expect(result.success, `expected language '${lang}' to be valid`).toBe(true);
    }
  });

  it('QuizConfigSchema rejects an unknown language value', () => {
    expect(QuizConfigSchema.safeParse({ language: 'de' }).success).toBe(false);
  });
});

describe('QuizConfigSchema strips sticky_widget key (FOLLOW-274, Rule U)', () => {
  it('strips sticky_widget from schema parse output', () => {
    const result = QuizConfigSchema.safeParse({ sticky_widget: true, language: 'pl' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('sticky_widget');
      expect(result.data.language).toBe('pl');
    }
  });
});

describe('parseStoredQuizConfig strips legacy keys (FOLLOW-271/274, Rule U)', () => {
  it('strips both enabled and sticky_widget from a fully legacy blob', () => {
    const result: Record<string, unknown> = parseStoredQuizConfig({
      enabled: true,
      sticky_widget: false,
      language: 'pl',
      micro_polls_enabled: true,
    });
    expect(result).not.toHaveProperty('enabled');
    expect(result).not.toHaveProperty('sticky_widget');
    expect(result.language).toBe('pl');
    expect(result.micro_polls_enabled).toBe(true);
  });
});

describe('QuizConfigSchema strips enabled key (FOLLOW-271, Rule U)', () => {
  it('strips enabled from schema parse output', () => {
    const result = QuizConfigSchema.safeParse({ enabled: true, language: 'pl' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('enabled');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET — agency path (byte-unchanged behavior)
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/quiz/config — agency', () => {
  it('returns 401 when resolveTenantAccess throws AccessError(401)', async () => {
    mockResolve.mockRejectedValue(new AccessError(401, 'Unauthorized'));
    const res = await GET(makeGet());
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('returns default config (200) when the tenant has no stored config', async () => {
    useDb(makeMultiTenantDb({}));
    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await parseBody<Record<string, unknown>>(res);
    expect(body).not.toHaveProperty('enabled');
    expect(body.language).toBe('en');
    expect(typeof body.quiz_enabled).toBe('boolean');
    expect(body.tenant_id).toBe(TENANT_A);
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
    const body = await parseBody<Record<string, unknown>>(res);
    expect(body).not.toHaveProperty('quiz_enabled');
    expect(body).toHaveProperty('error');
  });

  // FOLLOW-603 — option-wiring assertion: a future edit dropping allowStaffOverride fails here.
  it('invokes resolveTenantAccess with allowStaffOverride: true', async () => {
    useDb(makeMultiTenantDb({}));
    await GET(makeGet());
    expect(mockResolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ allowStaffOverride: true }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST — agency path (write semantics unchanged; NOT audited)
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/quiz/config — agency', () => {
  it('returns 401 when resolveTenantAccess throws AccessError(401)', async () => {
    mockResolve.mockRejectedValue(new AccessError(401, 'Unauthorized'));
    const res = await POST(makePost({ language: 'pl' }));
    expect(res.status).toBe(401);
  });

  it('agency:viewer may write and gets the updated config (200)', async () => {
    useDb(makeMultiTenantDb({}));
    const res = await POST(makePost({ language: 'pl' }));
    expect(res.status).toBe(200);
    const body = await parseBody<{ language: string }>(res);
    expect(body.language).toBe('pl');
  });

  it("accepts language 'es' end-to-end", async () => {
    useDb(makeMultiTenantDb({}));
    const res = await POST(makePost({ language: 'es' }));
    expect(res.status).toBe(200);
    const body = await parseBody<{ language: string }>(res);
    expect(body.language).toBe('es');
  });

  it('returns 400 when language is invalid', async () => {
    useDb(makeMultiTenantDb({}));
    const res = await POST(makePost({ language: 'de' }));
    expect(res.status).toBe(400);
  });

  it('an agency write inserts ZERO staff_audit_log rows (§3 audits STAFF only)', async () => {
    const db = makeMultiTenantDb({});
    useDb(db);
    const res = await POST(makePost({ language: 'pl' }));
    expect(res.status).toBe(200);
    expect(db._auditRows).toHaveLength(0);
    expect(db.insert).not.toHaveBeenCalled();
  });

  // FOLLOW-603 — option-wiring: allowStaffOverride:true AND minAgencyRole:'agency:viewer'.
  it('invokes resolveTenantAccess with allowStaffOverride:true and minAgencyRole:agency:viewer', async () => {
    useDb(makeMultiTenantDb({}));
    await POST(makePost({ language: 'pl' }));
    expect(mockResolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ allowStaffOverride: true, minAgencyRole: 'agency:viewer' }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Staff override — write-rank gate (CEO Q3, ADR-0018 §4)
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/quiz/config — staff write-rank gate', () => {
  it('estalara:readonly staff → 403 (rank < ops), no update, no audit', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:readonly'));
    const db = makeMultiTenantDb({ [TENANT_A]: { language: 'en' } });
    useDb(db);

    const res = await POST(makePost({ language: 'pl' }, TENANT_A));
    expect(res.status).toBe(403);
    // The write never ran and nothing was audited.
    expect(db.update).not.toHaveBeenCalled();
    expect(db._auditRows).toHaveLength(0);
    // Tenant A's config is untouched.
    expect(db._store[TENANT_A]!.quizConfig.language).toBe('en');
  });

  it('estalara:ops staff → 200 (canWrite)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:ops'));
    useDb(makeMultiTenantDb({}));
    const res = await POST(makePost({ language: 'pl' }, TENANT_A));
    expect(res.status).toBe(200);
  });

  it('estalara:superadmin staff → 200 (canWrite)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:superadmin'));
    useDb(makeMultiTenantDb({}));
    const res = await POST(makePost({ language: 'pl' }, TENANT_A));
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Staff override — audit trail (ADR-0018 §3)
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/quiz/config — staff audit trail', () => {
  it('a successful staff write inserts exactly one staff_audit_log row (attributed)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:ops'));
    const db = makeMultiTenantDb({ [TENANT_A]: { language: 'en' } });
    useDb(db);

    const res = await POST(makePost({ language: 'pl' }, TENANT_A));
    expect(res.status).toBe(200);
    expect(db._auditRows).toHaveLength(1);
    const row = db._auditRows[0]!;
    expect(row.adminUserId).toBe('staff-uuid-777');
    expect(row.action).toBe('quiz_config.update');
    expect(row.targetTenantId).toBe(TENANT_A);
    // before/after captured in payload; request metadata attached.
    expect(row.payload).toMatchObject({ after: { language: 'pl' } });
    expect(row.ipAddress).toBe('203.0.113.7');
    expect(row.userAgent).toBe('vitest-agent');
  });

  it('staff write whose audit insert FAILS → 500 (never a silent unattributed 200)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:ops'));
    const db = makeMultiTenantDb({ [TENANT_A]: { language: 'en' } });
    // Make the audit insert throw INSIDE the tx (FOLLOW-605 atomic path).
    db._control.failAuditInsert = true;
    useDb(db);

    const res = await POST(makePost({ language: 'pl' }, TENANT_A));
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('audit_write_failed');
    expect(mockCaptureException).toHaveBeenCalledOnce();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FOLLOW-605 — audit-write atomicity: config update + audit row are one tx
//
// Red-first verified during dev: with the pre-FOLLOW-605 mutate-then-audit shape
// (db.update commits, THEN a separate db.insert), the audit-insert failure leaves
// tenant A's config mutated to 'pl' → this test's UNCHANGED assertion FAILS. Wrapping
// update+insert in one db.transaction() (staged-then-committed, discarded on throw)
// makes it pass. This is the anti-orphan-mutation guard 598 (bandit weight) inherits.
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/quiz/config — audit-write atomicity (FOLLOW-605)', () => {
  it('ROLLS BACK the config update when the staff audit insert fails inside the tx (no orphan mutation)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:ops'));
    const db = makeMultiTenantDb({ [TENANT_A]: { language: 'en', accent_color: '#AAAAAA' } });
    // The config update runs first inside the tx and succeeds; the audit insert then
    // rejects → the whole transaction rolls back.
    db._control.failAuditInsert = true;
    useDb(db);

    const res = await POST(makePost({ language: 'pl' }, TENANT_A));

    // (a) fail loud — 500, attributable-write-failed, captured to Sentry.
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('audit_write_failed');
    expect(mockCaptureException).toHaveBeenCalledOnce();

    // (b) NO ORPHAN MUTATION — tenant A's stored config is byte-unchanged; the 'pl'
    // update that briefly staged inside the tx was discarded on rollback.
    expect(db._store[TENANT_A]!.quizConfig.language).toBe('en');
    expect(db._store[TENANT_A]!.quizConfig.accent_color).toBe('#AAAAAA');
    // …and no audit row was committed either (both limbs rolled back together).
    expect(db._auditRows).toHaveLength(0);
  });

  it('COMMITS both the config update and exactly one audit row when the tx succeeds (atomic happy path)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:ops'));
    const db = makeMultiTenantDb({ [TENANT_A]: { language: 'en' } });
    useDb(db);

    const res = await POST(makePost({ language: 'pl' }, TENANT_A));
    expect(res.status).toBe(200);
    // Both limbs committed atomically: config updated AND one audit row appended.
    expect(db._store[TENANT_A]!.quizConfig.language).toBe('pl');
    expect(db._auditRows).toHaveLength(1);
    expect(db._auditRows[0]!.targetTenantId).toBe(TENANT_A);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MANDATORY tenant-filter tests — READ + WRITE (ADR-0018 §2 invariant 5, RETRO-187)
//
// These drive the route's REAL Drizzle query: the DB mock keys its per-tenant store
// on the value the route binds into `.where(eq(tenants.id, access.tenantId))`. A
// mis-fence (e.g. binding the session's null tenant, or tenant B) would key a
// different store slot and the assertions fail. Red-first verified during dev:
// changing the fence to TENANT_B makes both tests fail (capturedWhere.val === B and
// B's row mutated); reverting makes them pass.
// ═══════════════════════════════════════════════════════════════════════════

describe('MANDATORY tenant filter — staff cannot cross tenants (RETRO-187)', () => {
  it('READ: staff request for tenant A binds eq(tenants.id, A) into the real select and returns A’s config, never B’s', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:ops'));
    const db = makeMultiTenantDb({
      [TENANT_A]: { language: 'pl', accent_color: '#AAAAAA' },
      [TENANT_B]: { language: 'es', accent_color: '#BBBBBB' },
    });
    useDb(db);

    const res = await GET(makeGet(TENANT_A));
    const body = await parseBody<{ language: string; accent_color: string; tenant_id: string }>(
      res,
    );

    // The fence bound into the REAL query is A, never B.
    expect(db._captured.selectWhere?.val).toBe(TENANT_A);
    expect(db._captured.selectWhere?.val).not.toBe(TENANT_B);
    // The response carries A's row only — B's 'es'/#BBBBBB can never surface.
    expect(body.tenant_id).toBe(TENANT_A);
    expect(body.language).toBe('pl');
    expect(body.accent_color).toBe('#AAAAAA');
    expect(body.language).not.toBe('es');
  });

  it('WRITE: staff POST for tenant A fences eq(tenants.id, A) into the real update and leaves tenant B untouched', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:ops'));
    const db = makeMultiTenantDb({
      [TENANT_A]: { language: 'en', accent_color: '#AAAAAA' },
      [TENANT_B]: { language: 'es', accent_color: '#BBBBBB' },
    });
    useDb(db);

    const res = await POST(makePost({ language: 'pl' }, TENANT_A));
    expect(res.status).toBe(200);

    // The update fenced on A (not B).
    expect(db._captured.updateWhere?.val).toBe(TENANT_A);
    expect(db._captured.updateWhere?.val).not.toBe(TENANT_B);
    // A was updated; B's row is byte-untouched.
    expect(db._store[TENANT_A]!.quizConfig.language).toBe('pl');
    expect(db._store[TENANT_B]!.quizConfig.language).toBe('es');
    expect(db._store[TENANT_B]!.quizConfig.accent_color).toBe('#BBBBBB');
    // The audit row targets A, proving attribution follows the same fence.
    expect(db._auditRows[0]?.targetTenantId).toBe(TENANT_A);
  });
});
