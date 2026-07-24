/**
 * FOLLOW-639 — tests for GET + PUT /api/admin/tenants/quiz-definition (the audited,
 * staff-only write path for the fully editable per-brand quiz tree).
 *
 * Auth is delegated to `resolveTenantAccess` (its own wiring is covered elsewhere); these
 * tests PARTIALLY MOCK `@/lib/session-auth` — only `resolveTenantAccess` is a spy. A stateful
 * fake `@estalara/db` + `drizzle-orm` drives the route's REAL query shape.
 *
 * Coverage:
 *   - GET returns the active definition + the NON-BLOCKING unreachable-archetype warning.
 *   - Staff ops SAVE: new active version inserted, prior active deactivated, staff_audit_log
 *     row written with action 'quiz_definition.update' — all in ONE transaction (atomicity).
 *   - HARD validation (unknown archetype id) → 400, no mutation, no audit row.
 *   - Below-ops staff → 403 and NO mutation / audit row.
 *   - Agency session → 403 staff_only.
 *   - Audit insert fails → whole tx rolls back → 500, nothing persisted (Rule K.2).
 *   - Tenant fence (invariant 5): the write is attributed to ONLY the resolved tenant.
 *
 * @module apps/control-plane/src/app/api/admin/tenants/quiz-definition/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type * as SessionAuthModule from '@/lib/session-auth';
import type { QuizDefinitionState } from './route';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  quizDefinitions: {
    __table: 'quiz_definitions',
    tenantId: 'qd.tenant_id',
    isActive: 'qd.is_active',
    version: 'qd.version',
    definition: 'qd.definition',
  },
  staffAuditLog: { __table: 'staff_audit_log' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ kind: 'eq', col, val })),
  and: vi.fn((...conds: unknown[]) => ({ kind: 'and', conds })),
  desc: vi.fn((col: unknown) => ({ kind: 'desc', col })),
}));

vi.mock('@/lib/session-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionAuthModule>();
  return { ...actual, resolveTenantAccess: vi.fn() };
});

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import { createAdminClient, quizDefinitions, staffAuditLog } from '@estalara/db';
import { resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';
import { GET, PUT } from './route';

const mockResolve = vi.mocked(resolveTenantAccess);

const TENANT_A = '550e8400-e29b-41d4-a716-446655440042';
const TENANT_B = '660e8400-e29b-41d4-a716-446655440099';

// A valid definition reaching yield_hunter + flip_investor (everything else unreachable).
const VALID_DEF = {
  schema_version: 1 as const,
  root: 'q_gate',
  languages: ['en'] as const,
  questions: [
    {
      id: 'q_gate',
      prompt_i18n: { en: 'What are you after?' },
      answers: [
        { id: 'a_yield', label_i18n: { en: 'Yield' }, weights: { yield_hunter: 1 }, next: null },
        { id: 'a_flip', label_i18n: { en: 'Flip' }, weights: { flip_investor: 1 }, next: null },
      ],
    },
  ],
};

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

// ─── Stateful fake DB ───────────────────────────────────────────────────────

interface DefRow {
  tenantId: string;
  version: number;
  definition: unknown;
  isActive: boolean;
  createdBy: string | null;
}

interface Cond {
  kind: string;
  col?: unknown;
  val?: unknown;
  conds?: Cond[];
}

/** Extract the tenantId equality value from a where condition tree. */
function tenantOf(w: Cond): string | null {
  if (w.kind === 'eq' && w.col === quizDefinitions.tenantId) return w.val as string;
  if (w.kind === 'and' && w.conds) {
    for (const c of w.conds) {
      const t = tenantOf(c);
      if (t) return t;
    }
  }
  return null;
}

/** Whether a where condition tree filters on isActive = true. */
function filtersActive(w: Cond): boolean {
  if (w.kind === 'eq' && w.col === quizDefinitions.isActive && w.val === true) return true;
  if (w.kind === 'and' && w.conds) return w.conds.some(filtersActive);
  return false;
}

function makeDb(seed: DefRow[]) {
  const rows: DefRow[] = seed.map((r) => ({ ...r }));
  const auditRows: Record<string, unknown>[] = [];
  const control = { failAudit: false };

  const makeSelect = (target: DefRow[]) =>
    vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((w: Cond) => {
          const tenant = tenantOf(w);
          const activeOnly = filtersActive(w);
          const rowsFor = (): DefRow[] =>
            target
              .filter((r) => r.tenantId === tenant && (!activeOnly || r.isActive))
              .sort((a, b) => b.version - a.version);
          return {
            // GET: where().limit() → the active row.
            limit: vi.fn(() => Promise.resolve(rowsFor().slice(0, 1))),
            // PUT read: where().orderBy(desc(version)).limit() → the max-version row.
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve(rowsFor().slice(0, 1))),
            })),
          };
        }),
      })),
    }));

  const makeUpdate = (target: DefRow[]) =>
    vi.fn(() => ({
      set: vi.fn((values: Partial<DefRow>) => ({
        where: vi.fn((w: Cond) => {
          const tenant = tenantOf(w);
          for (const r of target) {
            if (r.tenantId === tenant && r.isActive) Object.assign(r, values);
          }
          return Promise.resolve();
        }),
      })),
    }));

  const makeInsert = (defTarget: DefRow[], auditTarget: Record<string, unknown>[]) =>
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
      if (table === quizDefinitions) {
        return {
          values: vi.fn((v: Partial<DefRow>) => {
            defTarget.push({
              tenantId: v.tenantId ?? '',
              version: v.version ?? 1,
              definition: v.definition,
              isActive: v.isActive ?? true,
              createdBy: v.createdBy ?? null,
            });
            return Promise.resolve([]);
          }),
        };
      }
      throw new Error('unexpected insert() target in test fake');
    });

  const db = {
    _rows: rows,
    _auditRows: auditRows,
    _control: control,
    select: makeSelect(rows),
    update: makeUpdate(rows),
    insert: makeInsert(rows, auditRows),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      // Staged copies → atomic promote on resolve, discard on throw.
      const stagedRows = rows.map((r) => ({ ...r }));
      const stagedAudit: Record<string, unknown>[] = [];
      const tx = {
        update: makeUpdate(stagedRows),
        insert: makeInsert(stagedRows, stagedAudit),
      };
      const result = await fn(tx);
      rows.length = 0;
      rows.push(...stagedRows);
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
  const url = new URL('http://localhost/api/admin/tenants/quiz-definition');
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

describe('GET /api/admin/tenants/quiz-definition', () => {
  it('staff → 200 with the active definition + unreachable-archetype warning', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    makeDb([
      { tenantId: TENANT_A, version: 3, definition: VALID_DEF, isActive: true, createdBy: null },
    ]);

    const res = await GET(makeRequest({ query: { tenant_id: TENANT_A } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as QuizDefinitionState;
    expect(body.version).toBe(3);
    expect(body.definition?.root).toBe('q_gate');
    // Non-blocking warning present: only yield_hunter + flip_investor are reachable.
    expect(body.warnings.unreachable_archetypes).toContain('student_parent');
    expect(body.warnings.unreachable_archetypes).not.toContain('yield_hunter');
  });

  it('staff, no saved definition → 200 with version null + empty warning', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    makeDb([]);
    const res = await GET(makeRequest({ query: { tenant_id: TENANT_A } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as QuizDefinitionState;
    expect(body.version).toBeNull();
    expect(body.definition).toBeNull();
    expect(body.warnings.unreachable_archetypes).toEqual([]);
  });

  it('agency → 403 staff_only', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A));
    makeDb([]);
    const res = await GET(makeRequest({ query: { tenant_id: TENANT_A } }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('staff_only');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT
// ═══════════════════════════════════════════════════════════════════════════

describe('PUT /api/admin/tenants/quiz-definition', () => {
  it('staff ops → saves a new active version + atomic staff_audit_log row', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([
      { tenantId: TENANT_A, version: 1, definition: VALID_DEF, isActive: true, createdBy: null },
    ]);

    const res = await PUT(
      makeRequest({
        method: 'PUT',
        query: { tenant_id: TENANT_A },
        body: { definition: VALID_DEF },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as QuizDefinitionState;
    expect(body.version).toBe(2);

    // Exactly one active row now, at version 2; the prior version deactivated.
    const active = db._rows.filter((r) => r.tenantId === TENANT_A && r.isActive);
    expect(active).toHaveLength(1);
    expect(active[0]!.version).toBe(2);
    expect(db._rows.some((r) => r.version === 1 && !r.isActive)).toBe(true);

    // Audit row: correct action + attribution + version delta.
    expect(db._auditRows).toHaveLength(1);
    const audit = db._auditRows[0] as {
      action: string;
      adminUserId: string;
      targetTenantId: string;
      payload: { before: { version: number | null }; after: { version: number } };
    };
    expect(audit.action).toBe('quiz_definition.update');
    expect(audit.adminUserId).toBe('staff-uuid-777');
    expect(audit.targetTenantId).toBe(TENANT_A);
    expect(audit.payload.before.version).toBe(1);
    expect(audit.payload.after.version).toBe(2);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('first save (no prior) → version 1', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([]);
    const res = await PUT(
      makeRequest({
        method: 'PUT',
        query: { tenant_id: TENANT_A },
        body: { definition: VALID_DEF },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as QuizDefinitionState;
    expect(body.version).toBe(1);
    expect(db._rows).toHaveLength(1);
  });

  it('HARD validation (unknown archetype id) → 400, no mutation / no audit', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const badDef = {
      schema_version: 1,
      root: 'q_gate',
      languages: ['en'],
      questions: [
        {
          id: 'q_gate',
          prompt_i18n: { en: 'x' },
          answers: [
            { id: 'a', label_i18n: { en: 'a' }, weights: { not_real: 1 }, next: null },
            { id: 'b', label_i18n: { en: 'b' }, weights: {}, next: null },
          ],
        },
      ],
    };
    const db = makeDb([]);
    const res = await PUT(
      makeRequest({ method: 'PUT', query: { tenant_id: TENANT_A }, body: { definition: badDef } }),
    );
    expect(res.status).toBe(400);
    expect(db._rows).toHaveLength(0);
    expect(db._auditRows).toHaveLength(0);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('below-ops staff (readonly) → 403 and NO mutation / audit row', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:readonly'));
    const db = makeDb([]);
    const res = await PUT(
      makeRequest({
        method: 'PUT',
        query: { tenant_id: TENANT_A },
        body: { definition: VALID_DEF },
      }),
    );
    expect(res.status).toBe(403);
    expect(db._rows).toHaveLength(0);
    expect(db._auditRows).toHaveLength(0);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('agency → 403 staff_only', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A));
    const db = makeDb([]);
    const res = await PUT(
      makeRequest({
        method: 'PUT',
        query: { tenant_id: TENANT_A },
        body: { definition: VALID_DEF },
      }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('staff_only');
    expect(db._rows).toHaveLength(0);
  });

  it('audit insert fails → whole tx rolls back → 500, nothing persisted (Rule K.2)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([
      { tenantId: TENANT_A, version: 1, definition: VALID_DEF, isActive: true, createdBy: null },
    ]);
    db._control.failAudit = true;

    const res = await PUT(
      makeRequest({
        method: 'PUT',
        query: { tenant_id: TENANT_A },
        body: { definition: VALID_DEF },
      }),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('audit_write_failed');
    // Rollback: prior version still the only active row, no new version, no audit.
    const active = db._rows.filter((r) => r.tenantId === TENANT_A && r.isActive);
    expect(active).toHaveLength(1);
    expect(active[0]!.version).toBe(1);
    expect(db._auditRows).toHaveLength(0);
  });

  it('tenant fence (invariant 5): the save is attributed to ONLY the resolved tenant', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([
      { tenantId: TENANT_B, version: 9, definition: VALID_DEF, isActive: true, createdBy: null },
    ]);

    await PUT(
      makeRequest({
        method: 'PUT',
        query: { tenant_id: TENANT_A },
        body: { definition: VALID_DEF },
      }),
    );
    // The new active row belongs to TENANT_A; TENANT_B's row is untouched.
    const newRow = db._rows.find((r) => r.tenantId === TENANT_A);
    expect(newRow?.isActive).toBe(true);
    const tenantBRow = db._rows.find((r) => r.tenantId === TENANT_B);
    expect(tenantBRow?.isActive).toBe(true);
    expect(tenantBRow?.version).toBe(9);
    const audit = db._auditRows[0] as { targetTenantId: string };
    expect(audit.targetTenantId).toBe(TENANT_A);
  });
});
