/**
 * Unit tests for POST /api/adapt/feedback — FOLLOW-007.
 *
 * Coverage:
 *  - 202 Accepted on valid body (success path)
 *  - converted: true   → alpha increments (updateBanditArm(3, 2, true) = {alpha: 4, beta: 2})
 *  - converted: false  → beta increments  (updateBanditArm(3, 2, false) = {alpha: 3, beta: 3})
 *  - Missing Authorization → 401 AUTH_REQUIRED
 *  - Wrong ADAPT_API_KEY  → 401 FORBIDDEN
 *  - Empty Bearer token   → 401 AUTH_REQUIRED
 *  - Invalid JSON body    → 400 VALIDATION_ERROR
 *  - Zod validation fail  → 400 VALIDATION_ERROR
 *  - Fire-and-forget: response returns 202 before DB upsert resolves
 *
 * @module apps/control-plane/src/app/api/adapt/feedback/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock @estalara/db (hoisted) ─────────────────────────────────────────────

const { mockSelectLimit, mockOnConflictDoUpdate, mockInsertValues, mockCreateAdminClient } =
  vi.hoisted(() => {
    const mockSelectLimit = vi.fn().mockResolvedValue([]);
    const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockSelectLimit });
    const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

    const mockOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const mockInsertValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
    const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

    const mockCreateAdminClient = vi.fn(() => ({ select: mockSelect, insert: mockInsert }));
    return {
      mockSelectLimit,
      mockOnConflictDoUpdate,
      mockInsertValues,
      mockCreateAdminClient,
    };
  });

vi.mock('@estalara/db', () => ({
  createAdminClient: mockCreateAdminClient,
  abBanditWeights: {
    tenantId: 'tenant_id',
    archetype: 'archetype',
    variant: 'variant',
    alpha: 'alpha',
    beta: 'beta',
    paused: 'paused',
    updatedAt: 'updated_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...preds: unknown[]) => ({ kind: 'and', preds })),
  eq: vi.fn((col: unknown, val: unknown) => ({ kind: 'eq', col, val })),
}));

import { POST } from './route';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePostRequest(
  body: unknown,
  authHeader: string | null = 'Bearer test_key',
): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authHeader !== null) {
    headers.Authorization = authHeader;
  }
  return new NextRequest('http://localhost/api/adapt/feedback', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const VALID_BODY = {
  session_id: 'sess-feedback-001',
  tenant_id: 'tenant-abc',
  archetype: 'family_buyer',
  variant: 'v1',
  converted: true,
};

/** Wait for the fire-and-forget microtask to resolve. */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

// ─── Auth gate ────────────────────────────────────────────────────────────────

describe('POST /api/adapt/feedback — auth gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('missing Authorization header → 401 AUTH_REQUIRED', async () => {
    const res = await POST(makePostRequest(VALID_BODY, null));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });

  it('empty Bearer token → 401 AUTH_REQUIRED', async () => {
    const res = await POST(makePostRequest(VALID_BODY, 'Bearer '));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });

  it('wrong key when ADAPT_API_KEY is set → 401 FORBIDDEN', async () => {
    vi.stubEnv('ADAPT_API_KEY', 'expected_key');
    const res = await POST(makePostRequest(VALID_BODY, 'Bearer wrong_key'));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('correct key when ADAPT_API_KEY is set → 202', async () => {
    vi.stubEnv('ADAPT_API_KEY', 'expected_key');
    const res = await POST(makePostRequest(VALID_BODY, 'Bearer expected_key'));
    expect(res.status).toBe(202);
  });

  it('ADAPT_API_KEY unset + non-empty token → 202 (presence-only)', async () => {
    vi.stubEnv('ADAPT_API_KEY', '');
    const res = await POST(makePostRequest(VALID_BODY, 'Bearer any_token'));
    expect(res.status).toBe(202);
  });
});

// ─── Body validation ─────────────────────────────────────────────────────────

describe('POST /api/adapt/feedback — body validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('invalid JSON body → 400 VALIDATION_ERROR', async () => {
    const req = new NextRequest('http://localhost/api/adapt/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test_key' },
      body: 'not-json-{',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('missing session_id → 400 VALIDATION_ERROR', async () => {
    const rest: Record<string, unknown> = { ...VALID_BODY };
    delete rest.session_id;
    const res = await POST(makePostRequest(rest));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('missing tenant_id → 400', async () => {
    const rest: Record<string, unknown> = { ...VALID_BODY };
    delete rest.tenant_id;
    const res = await POST(makePostRequest(rest));
    expect(res.status).toBe(400);
  });

  it('missing archetype → 400', async () => {
    const rest: Record<string, unknown> = { ...VALID_BODY };
    delete rest.archetype;
    const res = await POST(makePostRequest(rest));
    expect(res.status).toBe(400);
  });

  it('missing variant → 400', async () => {
    const rest: Record<string, unknown> = { ...VALID_BODY };
    delete rest.variant;
    const res = await POST(makePostRequest(rest));
    expect(res.status).toBe(400);
  });

  it('missing converted → 400', async () => {
    const rest: Record<string, unknown> = { ...VALID_BODY };
    delete rest.converted;
    const res = await POST(makePostRequest(rest));
    expect(res.status).toBe(400);
  });

  it('converted: "yes" (string) → 400 (must be boolean)', async () => {
    const res = await POST(makePostRequest({ ...VALID_BODY, converted: 'yes' }));
    expect(res.status).toBe(400);
  });
});

// ─── Bandit update math ──────────────────────────────────────────────────────

describe('POST /api/adapt/feedback — bandit update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    mockSelectLimit.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 202 Accepted', async () => {
    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(202);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('converted: true with existing row (alpha=3, beta=2) → upserts alpha=4, beta=2', async () => {
    mockSelectLimit.mockResolvedValueOnce([{ alpha: 3.0, beta: 2.0 }]);

    await POST(makePostRequest({ ...VALID_BODY, converted: true }));
    await flushMicrotasks();

    expect(mockInsertValues).toHaveBeenCalledOnce();
    const insertedRow = mockInsertValues.mock.calls[0]?.[0] as { alpha: number; beta: number };
    expect(insertedRow.alpha).toBe(4);
    expect(insertedRow.beta).toBe(2);
  });

  it('converted: false with existing row (alpha=3, beta=2) → upserts alpha=3, beta=3', async () => {
    mockSelectLimit.mockResolvedValueOnce([{ alpha: 3.0, beta: 2.0 }]);

    await POST(makePostRequest({ ...VALID_BODY, converted: false }));
    await flushMicrotasks();

    const insertedRow = mockInsertValues.mock.calls[0]?.[0] as { alpha: number; beta: number };
    expect(insertedRow.alpha).toBe(3);
    expect(insertedRow.beta).toBe(3);
  });

  it('missing arm row → treats as Beta(1, 1), then increments', async () => {
    mockSelectLimit.mockResolvedValueOnce([]); // no existing row

    await POST(makePostRequest({ ...VALID_BODY, converted: true }));
    await flushMicrotasks();

    const insertedRow = mockInsertValues.mock.calls[0]?.[0] as { alpha: number; beta: number };
    // updateBanditArm(1, 1, true) = { alpha: 2, beta: 1 }
    expect(insertedRow.alpha).toBe(2);
    expect(insertedRow.beta).toBe(1);
  });

  it('upserts the same (tenant, archetype, variant) tuple from the request', async () => {
    mockSelectLimit.mockResolvedValueOnce([{ alpha: 1.0, beta: 1.0 }]);

    await POST(
      makePostRequest({
        session_id: 'sess-x',
        tenant_id: 'tenant-zzz',
        archetype: 'yield_hunter',
        variant: 'v2',
        converted: true,
      }),
    );
    await flushMicrotasks();

    const insertedRow = mockInsertValues.mock.calls[0]?.[0] as {
      tenantId: string;
      archetype: string;
      variant: string;
    };
    expect(insertedRow.tenantId).toBe('tenant-zzz');
    expect(insertedRow.archetype).toBe('yield_hunter');
    expect(insertedRow.variant).toBe('v2');
  });

  it('uses onConflictDoUpdate to update existing rows', async () => {
    mockSelectLimit.mockResolvedValueOnce([{ alpha: 1.0, beta: 1.0 }]);

    await POST(makePostRequest(VALID_BODY));
    await flushMicrotasks();

    expect(mockOnConflictDoUpdate).toHaveBeenCalledOnce();
  });
});

// ─── Fire-and-forget semantics ───────────────────────────────────────────────

describe('POST /api/adapt/feedback — fire-and-forget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 202 even before the DB upsert resolves', async () => {
    // Make the DB select hang — the response must still come back quickly.
    let resolveSelect!: (v: unknown[]) => void;
    mockSelectLimit.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSelect = resolve;
      }),
    );

    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(202);
    // DB write has not been issued yet at the point we got the response.
    expect(mockInsertValues).not.toHaveBeenCalled();

    // Let the background work complete so we don't leak a pending promise.
    resolveSelect([]);
    await flushMicrotasks();
  });

  it('DB error during upsert does NOT crash the response', async () => {
    mockSelectLimit.mockRejectedValueOnce(new Error('connection refused'));

    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(202);

    await flushMicrotasks();
    // No exception should escape to the test runner.
  });

  it('no DB call when DATABASE_URL_ADMIN is unset', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    vi.stubEnv('DATABASE_URL_DIRECT', '');

    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(202);
    await flushMicrotasks();

    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });
});
