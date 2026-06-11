import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  tenants: { id: 'id', quizConfig: 'quiz_config', updatedAt: 'updated_at' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
}));

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn(),
  requireTenantAccess: vi.fn(),
}));

import { createAdminClient } from '@estalara/db';
import { getAuthClaims, requireTenantAccess } from '@estalara/auth';
import { QUIZ_LANGUAGE_VALUES, QuizConfigSchema } from '@estalara/shared';

import { GET, POST } from './route';

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

const TENANT_ID = 'tenant-abc-001';

const TENANT_CLAIMS = {
  sub: 'user-001',
  email: 'user@example.com',
  tenant_id: TENANT_ID,
  agency_role: 'agency:viewer' as const,
  estalara_staff: false as const,
  mfa_verified: false,
};

function makeGetRequest(tenantId?: string): NextRequest {
  return new NextRequest('http://localhost/api/quiz/config', {
    headers: tenantId ? { 'x-tenant-id': tenantId } : {},
  });
}

function makePostRequest(body: unknown, withAuth = true): NextRequest {
  return new NextRequest('http://localhost/api/quiz/config', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(withAuth ? { Authorization: 'Bearer test_token' } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** Minimal stateful DB mock that simulates quiz_config reads/writes per tenant. */
function makeDbMock(initial: Record<string, unknown> = {}) {
  let stored = { ...initial };
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi
            .fn()
            .mockImplementation(() =>
              Promise.resolve(Object.keys(stored).length > 0 ? [{ quizConfig: stored }] : []),
            ),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockImplementation((values: { quizConfig: Record<string, unknown> }) => {
        stored = { ...values.quizConfig };
        return {
          where: vi.fn().mockResolvedValue([]),
        };
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── FOLLOW-270 parity: canonical language enum ────────────────────────────────
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
    const result = QuizConfigSchema.safeParse({ language: 'de' });
    expect(result.success).toBe(false);
  });
});

describe('GET /api/quiz/config', () => {
  it('returns 401 when no valid JWT', async () => {
    vi.mocked(getAuthClaims).mockResolvedValue(null);
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  it('returns default config when tenant has no stored config', async () => {
    vi.mocked(getAuthClaims).mockResolvedValue(TENANT_CLAIMS);
    vi.mocked(createAdminClient).mockReturnValue(
      makeDbMock({}) as unknown as ReturnType<typeof createAdminClient>,
    );
    const res = await GET(makeGetRequest(TENANT_ID));
    expect(res.status).toBe(200);
  });

  it('default config has expected shape', async () => {
    vi.mocked(getAuthClaims).mockResolvedValue(TENANT_CLAIMS);
    vi.mocked(createAdminClient).mockReturnValue(
      makeDbMock({}) as unknown as ReturnType<typeof createAdminClient>,
    );
    const res = await GET(makeGetRequest(TENANT_ID));
    const body = await parseBody<{
      enabled: boolean;
      language: string;
    }>(res);
    expect(body.enabled).toBe(false);
    expect(body.language).toBe('en');
  });
});

describe('POST /api/quiz/config', () => {
  it('returns 401 when JWT is missing/invalid', async () => {
    vi.mocked(requireTenantAccess).mockRejectedValue(
      new Error('Unauthorized: no valid authentication token'),
    );
    const res = await POST(makePostRequest({ enabled: true }, false));
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: string }>(res);
    expect(body.error).toContain('Unauthorized');
  });

  it('updates config fields and returns updated config', async () => {
    vi.mocked(requireTenantAccess).mockResolvedValue(TENANT_CLAIMS);
    vi.mocked(createAdminClient).mockReturnValue(
      makeDbMock({}) as unknown as ReturnType<typeof createAdminClient>,
    );
    const res = await POST(makePostRequest({ enabled: true, language: 'pl' }));
    expect(res.status).toBe(200);
    const body = await parseBody<{
      enabled: boolean;
      language: string;
    }>(res);
    expect(body.enabled).toBe(true);
    expect(body.language).toBe('pl');
  });

  // FOLLOW-270: verify 'es' is accepted end-to-end by the route handler
  it("accepts language 'es' and returns it in the response", async () => {
    vi.mocked(requireTenantAccess).mockResolvedValue(TENANT_CLAIMS);
    vi.mocked(createAdminClient).mockReturnValue(
      makeDbMock({}) as unknown as ReturnType<typeof createAdminClient>,
    );
    const res = await POST(makePostRequest({ language: 'es' }));
    expect(res.status).toBe(200);
    const body = await parseBody<{ language: string }>(res);
    expect(body.language).toBe('es');
  });

  it('returns 400 when enabled is not a boolean', async () => {
    vi.mocked(requireTenantAccess).mockResolvedValue(TENANT_CLAIMS);
    const res = await POST(makePostRequest({ enabled: 'yes' }));
    expect(res.status).toBe(400);
  });

  it('partial update preserves unset fields', async () => {
    vi.mocked(requireTenantAccess).mockResolvedValue(TENANT_CLAIMS);
    // Shared DB mock — state persists between the two POST calls
    const dbMock = makeDbMock({});
    vi.mocked(createAdminClient).mockReturnValue(
      dbMock as unknown as ReturnType<typeof createAdminClient>,
    );

    // First POST: set full config
    await POST(makePostRequest({ enabled: true, language: 'pl', sticky_widget: true }));

    // Second POST: update only enabled — the mock SELECT now returns the stored config
    const res = await POST(makePostRequest({ enabled: false }));
    const body = await parseBody<{
      enabled: boolean;
      language: string;
    }>(res);
    expect(body.enabled).toBe(false);
    expect(body.language).toBe('pl');
  });
});
