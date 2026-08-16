/**
 * FOLLOW-999 — tests for GET /api/admin/tenants/quiz-completions (the staff-only
 * read feed for the quiz answers viewer).
 *
 * Auth is delegated to `resolveTenantAccess` (covered by its own suite); these
 * tests PARTIALLY MOCK `@/lib/session-auth` — only `resolveTenantAccess` is a
 * spy. `@estalara/db` + `drizzle-orm` use a chainable fake whose every query
 * resolves from a programmed results queue, while capturing each `where()`
 * argument so the tenant fence (invariant 5) is asserted on EVERY query the
 * route issues, not just the first.
 *
 * Coverage:
 *   - Staff (any rank, incl. readonly — read-only surface) → 200 with rows +
 *     aggregates, mapped to snake_case with ISO timestamps.
 *   - Every query carries the resolved tenant fence.
 *   - limit is clamped to MAX (200); bad/negative params fall back to defaults.
 *   - Agency session → 403 staff_only.
 *   - Rule K.2: a thrown DB query → 500, never an empty list.
 *
 * @module apps/control-plane/src/app/api/admin/tenants/quiz-completions/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type * as SessionAuthModule from '@/lib/session-auth';
import type { QuizCompletionsResponse } from './route';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  quizCompletions: {
    id: 'qc.id',
    tenantId: 'qc.tenant_id',
    sessionId: 'qc.session_id',
    resolvedArchetype: 'qc.resolved_archetype',
    branch: 'qc.branch',
    q1Answer: 'qc.q1_answer',
    q2Answer: 'qc.q2_answer',
    q3Answer: 'qc.q3_answer',
    language: 'qc.language',
    createdAt: 'qc.created_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  desc: vi.fn((col: unknown) => ({ desc: col })),
  sql: Object.assign(
    // Tagged-template call: sql`count(*)::int` → opaque marker.
    (strings: TemplateStringsArray) => ({ sql: strings.join('') }),
    { raw: (s: string) => ({ sql: s }) },
  ),
}));

vi.mock('@/lib/session-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionAuthModule>();
  return { ...actual, resolveTenantAccess: vi.fn() };
});

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import { createAdminClient } from '@estalara/db';
import { resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';
import { GET } from './route';

const mockResolve = vi.mocked(resolveTenantAccess);

const TENANT_A = '550e8400-e29b-41d4-a716-446655440042';

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

// ─── Chainable fake DB with a programmed results queue ────────────────────────
//
// Each db.select() opens a chain where from/where/orderBy/limit/offset/groupBy
// all return the chain, and awaiting it resolves the NEXT entry from `queue`
// (or rejects when the entry is an Error). Every where() argument is captured
// so the tenant fence can be asserted per query. Also records limit/offset
// values passed on the page query.

interface FakeDb {
  queue: unknown[];
  whereVals: unknown[];
  limits: number[];
  offsets: number[];
  select: ReturnType<typeof vi.fn>;
}

function makeDb(queue: unknown[]): FakeDb {
  const state: FakeDb = {
    queue: [...queue],
    whereVals: [],
    limits: [],
    offsets: [],
    select: vi.fn(),
  };

  state.select.mockImplementation(() => {
    const result = state.queue.shift();
    const chain = {
      from: () => chain,
      where: (w: { val: unknown }) => {
        state.whereVals.push(w.val);
        return chain;
      },
      orderBy: () => chain,
      groupBy: () => chain,
      limit: (n: number) => {
        state.limits.push(n);
        return chain;
      },
      offset: (n: number) => {
        state.offsets.push(n);
        return chain;
      },
      then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
        if (result instanceof Error) return Promise.reject(result).then(onOk, onErr);
        return Promise.resolve(result).then(onOk, onErr);
      },
    };
    return chain;
  });

  vi.mocked(createAdminClient).mockReturnValue(
    state as unknown as ReturnType<typeof createAdminClient>,
  );
  return state;
}

const PAGE_ROW = {
  id: 'row-uuid-1',
  sessionId: 'a'.repeat(64),
  resolvedArchetype: 'yield_hunter',
  branch: 'INWESTOR',
  q1Answer: 0,
  q2Answer: 2,
  q3Answer: 1,
  language: 'en',
  createdAt: new Date('2026-08-15T10:00:00Z'),
};

function makeRequest(query: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost/api/admin/tenants/quiz-completions');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new NextRequest(url.toString(), {
    method: 'GET',
    headers: { Authorization: 'Bearer mock-token' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/tenants/quiz-completions', () => {
  it('staff → 200 with mapped rows, total, and both aggregates (sorted desc by count)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    makeDb([
      [PAGE_ROW], // page
      [{ cnt: 42 }], // total
      [
        { archetype: 'family_buyer', cnt: 10 },
        { archetype: 'yield_hunter', cnt: 30 },
      ], // by_archetype (unsorted on purpose)
      [
        { branch: null, cnt: 2 },
        { branch: 'INWESTOR', cnt: 40 },
      ], // by_branch
    ]);

    const res = await GET(makeRequest({ tenant_id: TENANT_A }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as QuizCompletionsResponse;

    expect(body.tenant_id).toBe(TENANT_A);
    expect(body.total).toBe(42);
    expect(body.completions).toHaveLength(1);
    expect(body.completions[0]).toEqual({
      id: 'row-uuid-1',
      session_id: 'a'.repeat(64),
      resolved_archetype: 'yield_hunter',
      branch: 'INWESTOR',
      q1_answer: 0,
      q2_answer: 2,
      q3_answer: 1,
      language: 'en',
      created_at: '2026-08-15T10:00:00.000Z',
    });
    // Aggregates sorted by count desc.
    expect(body.aggregates.by_archetype[0]).toEqual({ archetype: 'yield_hunter', count: 30 });
    expect(body.aggregates.by_branch[0]).toEqual({ branch: 'INWESTOR', count: 40 });
  });

  it('readonly staff → 200 (read-only surface has no write-rank gate)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:readonly'));
    makeDb([[], [{ cnt: 0 }], [], []]);
    const res = await GET(makeRequest({ tenant_id: TENANT_A }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as QuizCompletionsResponse;
    expect(body.total).toBe(0);
    expect(body.completions).toEqual([]);
  });

  it('tenant fence (invariant 5): EVERY query carries the resolved tenant id', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([[], [{ cnt: 0 }], [], []]);
    await GET(makeRequest({ tenant_id: TENANT_A }));
    // Four queries (page, total, by_archetype, by_branch) — four fenced where()s.
    expect(db.whereVals).toEqual([TENANT_A, TENANT_A, TENANT_A, TENANT_A]);
  });

  it('clamps limit to 200 and applies offset; bad params fall back to defaults', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([[], [{ cnt: 0 }], [], []]);
    const res = await GET(
      makeRequest({ tenant_id: TENANT_A, limit: '9999', offset: 'not-a-number' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as QuizCompletionsResponse;
    expect(body.limit).toBe(200); // clamped
    expect(body.offset).toBe(0); // fallback
    expect(db.limits).toEqual([200]);
    expect(db.offsets).toEqual([0]);
  });

  it('agency → 403 staff_only', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A));
    makeDb([[], [{ cnt: 0 }], [], []]);
    const res = await GET(makeRequest({ tenant_id: TENANT_A }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('staff_only');
  });

  it('Rule K.2: a thrown DB query → 500, never an empty list', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    makeDb([new Error('db down')]);
    const res = await GET(makeRequest({ tenant_id: TENANT_A }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('internal_error');
  });
});
