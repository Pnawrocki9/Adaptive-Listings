/**
 * Tests for POST /api/quiz/completion — FOLLOW-385 AC-2.
 *
 * AC-2: /api/quiz/completion route checks for profiling_opt_out=1 query param and
 *       returns 200 { skipped: true } without persisting. A test asserts the skip.
 *
 * §H.9 opt-out defense-in-depth gate (mirrors GET /api/adapt gate at route.ts:667).
 * The SDK-side guard in showQuizTrigger is the primary gate; this route gate is
 * defense-in-depth — it fires when (a) a future code path bypasses the SDK guard,
 * or (b) the param is sent by a non-SDK caller.
 *
 * Auth note: the profiling_opt_out gate is placed AFTER the auth gate so that opted-out
 * requests still require a valid API key (no auth bypass).
 *
 * @module apps/control-plane/src/app/api/quiz/completion/route.test
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock @estalara/db ────────────────────────────────────────────────────────

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  quizCompletions: {
    id: 'id',
    tenantId: 'tenant_id',
    sessionId: 'session_id',
    resolvedArchetype: 'resolved_archetype',
    language: 'language',
    branch: 'branch',
    q1Answer: 'q1_answer',
    q2Answer: 'q2_answer',
    q3Answer: 'q3_answer',
    createdAt: 'created_at',
  },
  apiKeys: {
    tenantId: 'tenant_id',
    hashedKey: 'hashed_key',
    revokedAt: 'revoked_at',
    expiresAt: 'expires_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  isNull: vi.fn((col: unknown) => ({ col, isNull: true })),
  or: vi.fn((...args: unknown[]) => args),
  gt: vi.fn((col: unknown, val: unknown) => ({ col, val, gt: true })),
}));

vi.mock('@estalara/shared', () => ({
  // errorBody is used by the route to build error responses. Return a serializable
  // object so NextResponse.json can serialize it without throwing.
  errorBody: (args: { code: string; message: string; requestId?: string }) => ({
    error: { code: args.code, message: args.message, request_id: args.requestId ?? '' },
  }),
  ErrorCode: {
    AUTH_REQUIRED: 'AUTH_REQUIRED',
    FORBIDDEN: 'FORBIDDEN',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
  },
}));

import { createAdminClient } from '@estalara/db';
import { POST } from './route';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_API_KEY = 'test-api-key-385';
const TEST_TENANT_ID = '550e8400-e29b-41d4-a716-446655440385';

/** Builds a minimal valid quiz completion body. */
function makeBody() {
  return {
    session_id: 'sess-follow385-001',
    resolved_archetype: 'yield_hunter',
    language: 'en',
  };
}

/**
 * Build a NextRequest for POST /api/quiz/completion.
 * @param url - Full URL including any query params.
 * @param body - JSON body.
 * @param apiKey - Bearer token (defaults to TEST_API_KEY).
 */
function makeRequest(url: string, body: unknown, apiKey: string = TEST_API_KEY): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      // No X-Estalara-Signature header — we use the ops fallback (ADAPT_API_KEY env var)
    },
    body: JSON.stringify(body),
  });
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks(); // clear call counts/instances but preserve mock implementations
  // Set ops/test fallback so HMAC verification is bypassed (same as other route tests).
  process.env.ADAPT_API_KEY = TEST_API_KEY;
  process.env.ADAPT_TENANT_ID = TEST_TENANT_ID;
});

// ─── AC-2: profiling_opt_out=1 → 200 { skipped: true } ───────────────────────

describe('FOLLOW-385 AC-2: POST /api/quiz/completion profiling_opt_out gate', () => {
  it('returns 200 { skipped: true } when profiling_opt_out=1 is present, without persisting', async () => {
    const insertMock = vi.fn();
    // DB should NOT be called — the gate fires before any DB access
    vi.mocked(createAdminClient).mockReturnValue({
      insert: insertMock,
      select: vi.fn(),
    } as unknown as ReturnType<typeof createAdminClient>);

    const req = makeRequest(`http://localhost/api/quiz/completion?profiling_opt_out=1`, makeBody());

    const res = await POST(req);
    const body = (await res.json()) as unknown;

    expect(res.status).toBe(200);
    expect(body).toEqual({ skipped: true });

    // Defense-in-depth: DB insert must NOT be called for opted-out sessions
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('returns 200 { skipped: true } and NOT 201 when opted out', async () => {
    const req = makeRequest(`http://localhost/api/quiz/completion?profiling_opt_out=1`, makeBody());

    const res = await POST(req);
    expect(res.status).not.toBe(201);
    expect(res.status).toBe(200);
  });

  it('does NOT skip when profiling_opt_out is absent (normal path)', async () => {
    // Set up a mock DB that returns a successful insert
    const mockReturning = vi
      .fn()
      .mockResolvedValue([{ id: 'test-uuid-001', createdAt: new Date('2026-06-24T00:00:00Z') }]);
    const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
    const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
    const mockExecute = vi.fn().mockResolvedValue(undefined);

    vi.mocked(createAdminClient).mockReturnValue({
      insert: mockInsert,
      transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
        await cb({
          execute: mockExecute,
          insert: mockInsert,
        });
      }),
    } as unknown as ReturnType<typeof createAdminClient>);

    const req = makeRequest(`http://localhost/api/quiz/completion`, makeBody());

    const res = await POST(req);
    // Normal path should attempt to persist (will hit the DB mock)
    // Either 201 (success) or 500 (mock incomplete) is acceptable — the key is NOT 200 skipped
    const body = (await res.json()) as unknown;
    expect(body).not.toEqual({ skipped: true });
  });

  it('does NOT skip when profiling_opt_out=0', async () => {
    const req = makeRequest(`http://localhost/api/quiz/completion?profiling_opt_out=0`, makeBody());

    const res = await POST(req);
    const body = (await res.json()) as unknown;
    // profiling_opt_out=0 means opted IN — must NOT skip
    expect(body).not.toEqual({ skipped: true });
  });

  it('gate fires AFTER auth (opted-out requests still require valid API key)', async () => {
    // Auth must still be checked even for opted-out requests (no auth bypass via opt-out flag).
    const req = makeRequest(
      `http://localhost/api/quiz/completion?profiling_opt_out=1`,
      makeBody(),
      '', // empty/missing Bearer token
    );

    const res = await POST(req);
    // Must be 401 AUTH_REQUIRED, not 200 { skipped: true }
    expect(res.status).toBe(401);
    expect(res.status).not.toBe(200);
  });
});
