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
 *   - (FOLLOW-1335: the agency-session 403 `staff_only` case is gone with the agency path;
 *     a non-staff caller is refused inside resolveTenantAccess.)
 *   - Rule K.2: a thrown DB query → 500, never an empty list.
 *
 * @module apps/control-plane/src/app/api/admin/tenants/quiz-completions/route.test
 */

import { NextRequest } from 'next/server';
import { isNotNull } from 'drizzle-orm';
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
    answerPath: 'qc.answer_path',
    language: 'qc.language',
    createdAt: 'qc.created_at',
  },
  quizDefinitions: {
    tenantId: 'qd.tenant_id',
    version: 'qd.version',
    isActive: 'qd.is_active',
    definition: 'qd.definition',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  // FOLLOW-1020: the branch split and the not-reported count fence the tenant AND filter on
  // answer_path, so `where()` now receives an and(...) node. The fake keeps the tenant value
  // reachable at `.val` so the invariant-5 assertion below still reads one value per query.
  and: vi.fn((...parts: { val?: unknown }[]) => ({
    val: parts.find((p) => 'val' in p)?.val,
    parts,
  })),
  inArray: vi.fn((col: unknown, vals: unknown) => ({ inArray: col, vals })),
  isNotNull: vi.fn((col: unknown) => ({ isNotNull: col })),
  desc: vi.fn((col: unknown) => ({ desc: col })),
  sql: Object.assign(
    // Tagged-template call: sql`count(*)::int` → opaque marker.
    (strings: TemplateStringsArray) => ({ sql: strings.join('') }),
    { raw: (s: string) => ({ sql: s }), join: (parts: unknown[]) => ({ join: parts }) },
  ),
}));

vi.mock('@/lib/session-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionAuthModule>();
  return { ...actual, resolveTenantAccess: vi.fn() };
});

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import { createAdminClient } from '@estalara/db';
import { DEFAULT_QUIZ_DEFINITION_V2 } from '@estalara/shared';
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

// ─── Chainable fake DB with a programmed results queue ────────────────────────
//
// Each db.select() opens a chain where from/where/orderBy/limit/offset/groupBy
// all return the chain, and awaiting it resolves the NEXT entry from `queue`
// (or rejects when the entry is an Error). Every where() argument is captured
// so the tenant fence can be asserted per query. Also records limit/offset
// values passed on the page query.

interface FakeDb {
  queue: unknown[];
  /** Result of the raw `quiz_runs` read (`execute`): rows, or an Error to throw. */
  executeResult: unknown;
  execute: ReturnType<typeof vi.fn>;
  whereVals: unknown[];
  limits: number[];
  offsets: number[];
  select: ReturnType<typeof vi.fn>;
}

function makeDb(queue: unknown[]): FakeDb {
  const state: FakeDb = {
    queue: [...queue],
    executeResult: [],
    execute: vi.fn(),
    whereVals: [],
    limits: [],
    offsets: [],
    select: vi.fn(),
  };

  state.execute.mockImplementation(() =>
    state.executeResult instanceof Error
      ? Promise.reject(state.executeResult)
      : Promise.resolve(state.executeResult),
  );
  state.select.mockImplementation(() => {
    // The C4 text lookups come after the five page reads; an unprogrammed one reads as no rows.
    const result = state.queue.length > 0 ? state.queue.shift() : [];
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
  answerPath: [
    { question_id: 'q1_gate', answer_index: 0 },
    { question_id: 'inwestor_q2', answer_index: 0 },
    { question_id: 'inwestor_q3', answer_index: 0 },
  ],
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
      ], // by_branch (reported rows only)
      [{ cnt: 7 }], // not-reported count
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
      path_reported: true,
      answer_path: PAGE_ROW.answerPath,
      // no definition row, no quiz_runs row: resolved against the built-in default, approximate
      path_text: expect.any(Array),
      archetype_label: {
        en: 'Long-term rental investment',
        pl: 'Inwestycja pod najem długoterminowy',
      },
      definition_version: null,
      definition_source: 'approximate',
      language: 'en',
      created_at: '2026-08-15T10:00:00.000Z',
    });
    // Aggregates sorted by count desc.
    expect(body.aggregates.by_archetype[0]).toEqual({ archetype: 'yield_hunter', count: 30 });
    expect(body.aggregates.by_branch[0]).toEqual({ branch: 'INWESTOR', count: 40 });
  });

  it('readonly staff → 200 (read-only surface has no write-rank gate)', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A, 'estalara:readonly'));
    makeDb([[], [{ cnt: 0 }], [], [], [{ cnt: 0 }]]);
    const res = await GET(makeRequest({ tenant_id: TENANT_A }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as QuizCompletionsResponse;
    expect(body.total).toBe(0);
    expect(body.completions).toEqual([]);
  });

  it('tenant fence (invariant 5): EVERY query carries the resolved tenant id', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([[], [{ cnt: 0 }], [], [], [{ cnt: 0 }]]);
    await GET(makeRequest({ tenant_id: TENANT_A }));
    // Five page queries (page, total, by_archetype, by_branch, not-reported) plus the active
    // definition lookup (FOLLOW-1362 C4) — six fenced where()s.
    expect(db.whereVals).toEqual(Array(6).fill(TENANT_A));
  });

  it('clamps limit to 200 and applies offset; bad params fall back to defaults', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([[], [{ cnt: 0 }], [], [], [{ cnt: 0 }]]);
    const res = await GET(
      makeRequest({ tenant_id: TENANT_A, limit: '9999', offset: 'not-a-number' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as QuizCompletionsResponse;
    expect(body.limit).toBe(200); // clamped
    expect(body.offset).toBe(0); // fallback
    // the page query, then the active-definition lookup (limit 1, FOLLOW-1362 C4)
    expect(db.limits).toEqual([200, 1]);
    expect(db.offsets).toEqual([0]);
  });

  // ─── FOLLOW-1020 ──────────────────────────────────────────────────────────

  it('FOLLOW-1020: a row with no answer_path is flagged not-reported, not rendered as a skip', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    makeDb([
      [
        {
          ...PAGE_ROW,
          branch: null,
          q1Answer: null,
          q2Answer: null,
          q3Answer: null,
          answerPath: null,
        },
      ],
      [{ cnt: 1 }],
      [],
      [],
      [{ cnt: 1 }],
    ]);
    const res = await GET(makeRequest({ tenant_id: TENANT_A }));
    const body = (await res.json()) as QuizCompletionsResponse;
    expect(body.completions[0]?.path_reported).toBe(false);
  });

  it('FOLLOW-1020: the branch split states how many rows it excluded', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    makeDb([[PAGE_ROW], [{ cnt: 50 }], [], [{ branch: 'inwestor_q2', cnt: 43 }], [{ cnt: 7 }]]);
    const res = await GET(makeRequest({ tenant_id: TENANT_A }));
    const body = (await res.json()) as QuizCompletionsResponse;
    // The split covers 43 rows out of 50 — the remaining 7 are surfaced, not silently dropped.
    expect(body.aggregates.by_branch[0]).toEqual({ branch: 'inwestor_q2', count: 43 });
    expect(body.aggregates.branch_not_reported).toBe(7);
  });

  it('FOLLOW-1020: the branch-split query filters on answer_path, not only on the tenant', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    makeDb([[], [{ cnt: 0 }], [], [], [{ cnt: 0 }]]);
    await GET(makeRequest({ tenant_id: TENANT_A }));
    // Without this the aggregate counts legacy rows as branch-null, which is the whole defect.
    expect(vi.mocked(isNotNull)).toHaveBeenCalledWith('qc.answer_path');
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

// ═══════════════════════════════════════════════════════════════════════════
// FOLLOW-1362 C4 — the walk as text

/** The default definition with a recognisable root prompt, as a tenant's edited version. */
const EDITED_DEFINITION = {
  ...DEFAULT_QUIZ_DEFINITION_V2,
  questions: DEFAULT_QUIZ_DEFINITION_V2.questions.map((q) =>
    q.id === 'q_purpose'
      ? { ...q, prompt_i18n: { en: 'EDITED PROMPT', pl: 'EDYTOWANE PYTANIE' } }
      : q,
  ),
};

const TEXT_ROW = {
  ...PAGE_ROW,
  answerPath: [
    { question_id: 'q_purpose', answer_index: 2 },
    { question_id: 't_second', answer_indexes: [0, 2] },
  ],
};

const PAGE_QUEUE = (row: unknown): unknown[] => [[row], [{ cnt: 1 }], [], [], [{ cnt: 0 }]];

describe('GET /api/admin/tenants/quiz-completions - answer text (FOLLOW-1362 C4)', () => {
  it('resolves question prompts and answer labels, a multi step lists every trait', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    makeDb(PAGE_QUEUE(TEXT_ROW));
    const res = await GET(makeRequest({ tenant_id: TENANT_A }));
    const body = (await res.json()) as QuizCompletionsResponse;
    const row = body.completions[0];
    expect(row?.answer_path).toEqual(TEXT_ROW.answerPath);
    expect(row?.path_text?.[0]?.prompt?.en).toBe('What will this property be for?');
    expect(row?.path_text?.[0]?.prompt?.pl).toBe('Do czego ma służyć ta nieruchomość?');
    expect(row?.path_text?.[0]?.answers[0]?.label?.en).toBe(
      "A holiday or second home — I'll mainly live elsewhere",
    );
    expect(row?.path_text?.[1]?.answers.map((a) => a.index)).toEqual([0, 2]);
    expect(row?.path_text?.[1]?.answers.every((a) => a.label !== null)).toBe(true);
    // The leaf's display name comes from the confirmation block.
    expect(row?.archetype_label?.en).toBe(
      DEFAULT_QUIZ_DEFINITION_V2.confirm?.names_i18n.yield_hunter?.en,
    );
  });

  it('a session whose quiz_runs row pins a version resolves against THAT version', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([
      ...PAGE_QUEUE(TEXT_ROW),
      [], // active definition: none
      [{ version: 3, definition: EDITED_DEFINITION }], // the pinned version
    ]);
    db.executeResult = [{ session_id: TEXT_ROW.sessionId, definition_version: 3 }];
    const res = await GET(makeRequest({ tenant_id: TENANT_A }));
    const row = ((await res.json()) as QuizCompletionsResponse).completions[0];
    expect(row?.definition_source).toBe('pinned');
    expect(row?.definition_version).toBe(3);
    expect(row?.path_text?.[0]?.prompt?.en).toBe('EDITED PROMPT');
    // the version lookup is tenant-fenced like every other query
    expect(db.whereVals.every((v) => v === TENANT_A)).toBe(true);
  });

  it('a legacy session (no quiz_runs row) is resolved against the ACTIVE definition, approximate', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    makeDb([...PAGE_QUEUE(TEXT_ROW), [{ version: 5, definition: EDITED_DEFINITION }]]);
    const res = await GET(makeRequest({ tenant_id: TENANT_A }));
    const row = ((await res.json()) as QuizCompletionsResponse).completions[0];
    expect(row?.definition_source).toBe('approximate');
    expect(row?.definition_version).toBe(5);
    expect(row?.path_text?.[0]?.prompt?.en).toBe('EDITED PROMPT');
  });

  it('a pinned version that no longer exists falls back to approximate', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb([...PAGE_QUEUE(TEXT_ROW), [], []]);
    db.executeResult = [{ session_id: TEXT_ROW.sessionId, definition_version: 9 }];
    const res = await GET(makeRequest({ tenant_id: TENANT_A }));
    const row = ((await res.json()) as QuizCompletionsResponse).completions[0];
    expect(row?.definition_source).toBe('approximate');
  });

  it('quiz_runs missing (42P01) never crashes: 200, rows approximate', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    const db = makeDb(PAGE_QUEUE(TEXT_ROW));
    db.executeResult = Object.assign(new Error('relation "quiz_runs" does not exist'), {
      code: '42P01',
    });
    const res = await GET(makeRequest({ tenant_id: TENANT_A }));
    expect(res.status).toBe(200);
    const row = ((await res.json()) as QuizCompletionsResponse).completions[0];
    expect(row?.definition_source).toBe('approximate');
    expect(row?.path_text).not.toBeNull();
  });

  it('a row without a reported path has no text', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));
    makeDb(PAGE_QUEUE({ ...PAGE_ROW, answerPath: null }));
    const res = await GET(makeRequest({ tenant_id: TENANT_A }));
    const row = ((await res.json()) as QuizCompletionsResponse).completions[0];
    expect(row?.path_text).toBeNull();
  });
});
