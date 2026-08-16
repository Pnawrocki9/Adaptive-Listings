/**
 * FOLLOW-1000 — tests for GET /api/quiz/analytics (real quiz analytics from
 * quiz_completions, replacing the /dashboard/quiz/analytics mock).
 *
 * Auth is delegated to `resolveTenantAccess` (covered by its own suite); only
 * it is mocked from `@/lib/session-auth`. `@estalara/db` + `drizzle-orm` use
 * the same chainable results-queue fake as the quiz-completions sibling suite,
 * capturing every `where()` argument so the tenant fence (invariant 5) is
 * asserted on EVERY query.
 *
 * Coverage:
 *   - Agency session → 200 with real metrics fenced to the SESSION tenant.
 *   - Staff with ?tenant_id → 200 fenced to the validated override tenant.
 *   - Empty tenant → real zeroes/empty arrays (a successful empty read, not a
 *     fabricated fallback).
 *   - Rule K.2: a thrown DB query → 500.
 *
 * @module apps/control-plane/src/app/api/quiz/analytics/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type * as SessionAuthModule from '@/lib/session-auth';
import type { QuizAnalyticsResponse } from './route';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  quizCompletions: {
    tenantId: 'qc.tenant_id',
    resolvedArchetype: 'qc.resolved_archetype',
    branch: 'qc.branch',
    createdAt: 'qc.created_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  gte: vi.fn((col: unknown, val: unknown) => ({ gte: col, val })),
  // and() passes the eq fence through as the first member so the fake's where()
  // capture can read `w.val` for a bare eq AND `w.members[0].val` for and(...).
  and: vi.fn((...members: { val?: unknown }[]) => ({ and: true, members, val: members[0]?.val })),
  sql: Object.assign((strings: TemplateStringsArray) => ({ sql: strings.join('') }), {
    raw: (s: string) => ({ sql: s }),
  }),
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

function staffAccess(tenantId: string): TenantAccess {
  return {
    via: 'staff',
    tenantId,
    staff: {
      sub: 'staff-uuid-777',
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

// ─── Chainable fake DB with a programmed results queue ────────────────────────

function makeDb(queue: unknown[]) {
  const state = {
    queue: [...queue],
    whereVals: [] as unknown[],
    select: vi.fn(),
  };

  state.select.mockImplementation(() => {
    const result = state.queue.shift();
    const chain = {
      from: () => chain,
      where: (w: { val?: unknown }) => {
        state.whereVals.push(w.val);
        return chain;
      },
      orderBy: () => chain,
      groupBy: () => chain,
      limit: () => chain,
      offset: () => chain,
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

function makeRequest(query: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost/api/quiz/analytics');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new NextRequest(url.toString(), {
    method: 'GET',
    headers: { Authorization: 'Bearer mock-token' },
  });
}

// Queue order matches the route: total, rolling 30d, daily, by_archetype, by_branch.
const HAPPY_QUEUE: unknown[] = [
  [{ cnt: 89 }],
  [{ cnt: 34 }],
  [
    { day: '2026-08-14', cnt: 5 },
    { day: '2026-08-15', cnt: 7 },
  ],
  [
    { archetype: 'family_buyer', cnt: 30 },
    { archetype: 'yield_hunter', cnt: 59 },
  ],
  [
    { branch: null, cnt: 9 },
    { branch: 'INWESTOR', cnt: 80 },
  ],
];

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/quiz/analytics', () => {
  it('agency session → 200 with real metrics, aggregates sorted desc', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A));
    makeDb(HAPPY_QUEUE);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as QuizAnalyticsResponse;

    expect(body.tenant_id).toBe(TENANT_A);
    expect(body.total_completions).toBe(89);
    expect(body.completions_30d).toBe(34);
    expect(body.daily).toEqual([
      { day: '2026-08-14', count: 5 },
      { day: '2026-08-15', count: 7 },
    ]);
    expect(body.by_archetype[0]).toEqual({ archetype: 'yield_hunter', count: 59 });
    expect(body.by_branch[0]).toEqual({ branch: 'INWESTOR', count: 80 });
  });

  it('tenant fence (invariant 5): EVERY query carries the resolved tenant id', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A));
    const db = makeDb(HAPPY_QUEUE);
    await GET(makeRequest());
    // Five queries — five fenced where()s (and() passes the eq fence through).
    expect(db.whereVals).toEqual([TENANT_A, TENANT_A, TENANT_A, TENANT_A, TENANT_A]);
  });

  it('staff with ?tenant_id → 200 fenced to the override tenant', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb(HAPPY_QUEUE);
    const res = await GET(makeRequest({ tenant_id: TENANT_A }));
    expect(res.status).toBe(200);
    expect(db.whereVals.every((v) => v === TENANT_A)).toBe(true);
  });

  it('empty tenant → genuine zeroes and empty arrays (successful read, not a fallback)', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A));
    makeDb([[{ cnt: 0 }], [{ cnt: 0 }], [], [], []]);
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as QuizAnalyticsResponse;
    expect(body.total_completions).toBe(0);
    expect(body.daily).toEqual([]);
    expect(body.by_archetype).toEqual([]);
  });

  it('Rule K.2: a thrown DB query → 500, never fabricated zeroes', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A));
    makeDb([new Error('db down')]);
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('internal_error');
  });
});
