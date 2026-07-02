import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  tenants: {
    id: 'id',
    quizConfig: 'quiz_config',
    quizEnabled: 'quiz_enabled',
    updatedAt: 'updated_at',
  },
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
import { QUIZ_LANGUAGE_VALUES, QuizConfigSchema, parseStoredQuizConfig } from '@estalara/shared';

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
function makeDbMock(initial: Record<string, unknown> = {}, quizEnabled = false) {
  let stored = { ...initial };
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi
            .fn()
            .mockImplementation(() =>
              Promise.resolve(
                Object.keys(stored).length > 0 || quizEnabled
                  ? [{ quizConfig: stored, quizEnabled }]
                  : [],
              ),
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

// ── FOLLOW-274: sticky_widget is stripped from the persisted blob ────────────
describe('QuizConfigSchema strips sticky_widget key (FOLLOW-274, Rule U)', () => {
  it('strips sticky_widget from schema parse output', () => {
    const result = QuizConfigSchema.safeParse({ sticky_widget: true, language: 'pl' });
    expect(result.success).toBe(true);
    if (result.success) {
      // `sticky_widget` must NOT be present in the parsed output
      expect(result.data).not.toHaveProperty('sticky_widget');
      expect(result.data.language).toBe('pl');
    }
  });

  it('strips sticky_widget: false as well', () => {
    const result = QuizConfigSchema.safeParse({ sticky_widget: false });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('sticky_widget');
    }
  });
});

// ── FOLLOW-274: sticky_widget backfill — a legacy blob containing sticky_widget ────
describe('parseStoredQuizConfig strips sticky_widget from legacy blob (FOLLOW-274, Rule U)', () => {
  it('strips legacy sticky_widget key while preserving sibling keys', () => {
    const legacyBlob = { sticky_widget: true, language: 'es', accent_color: '#FF0000' };
    const result: Record<string, unknown> = parseStoredQuizConfig(legacyBlob);
    // sticky_widget must be gone; siblings must survive
    expect(result).not.toHaveProperty('sticky_widget');
    expect(result.language).toBe('es');
    expect(result.accent_color).toBe('#FF0000');
  });

  it('strips both enabled and sticky_widget from a fully legacy blob', () => {
    const legacyBlob = {
      enabled: true,
      sticky_widget: false,
      language: 'pl',
      micro_polls_enabled: true,
    };
    const result: Record<string, unknown> = parseStoredQuizConfig(legacyBlob);
    expect(result).not.toHaveProperty('enabled');
    expect(result).not.toHaveProperty('sticky_widget');
    expect(result.language).toBe('pl');
    expect(result.micro_polls_enabled).toBe(true);
  });
});

// ── FOLLOW-271: enabled is stripped from the persisted blob ──────────────────
describe('QuizConfigSchema strips enabled key (FOLLOW-271, Rule U)', () => {
  it('strips enabled from schema parse output', () => {
    const result = QuizConfigSchema.safeParse({ enabled: true, language: 'pl' });
    expect(result.success).toBe(true);
    if (result.success) {
      // `enabled` must NOT be present in the parsed output
      expect(result.data).not.toHaveProperty('enabled');
      expect(result.data.language).toBe('pl');
    }
  });

  it('strips enabled: false as well', () => {
    const result = QuizConfigSchema.safeParse({ enabled: false });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('enabled');
    }
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

  it('default config has expected shape and enabled is absent from blob', async () => {
    vi.mocked(getAuthClaims).mockResolvedValue(TENANT_CLAIMS);
    vi.mocked(createAdminClient).mockReturnValue(
      makeDbMock({}) as unknown as ReturnType<typeof createAdminClient>,
    );
    const res = await GET(makeGetRequest(TENANT_ID));
    const body = await parseBody<Record<string, unknown>>(res);
    // FOLLOW-271: `enabled` must NOT be present in the GET response blob fields.
    expect(body).not.toHaveProperty('enabled');
    expect(body.language).toBe('en');
    // quiz_enabled is returned from the dedicated typed column
    expect(typeof body.quiz_enabled).toBe('boolean');
  });

  it('strips legacy enabled key from stored blob during GET (FOLLOW-271 belt-and-suspenders)', async () => {
    vi.mocked(getAuthClaims).mockResolvedValue(TENANT_CLAIMS);
    // Simulate a legacy row that still has `enabled` in the JSONB (pre-backfill)
    vi.mocked(createAdminClient).mockReturnValue(
      makeDbMock({ enabled: true, language: 'pl' }, true) as unknown as ReturnType<
        typeof createAdminClient
      >,
    );
    const res = await GET(makeGetRequest(TENANT_ID));
    expect(res.status).toBe(200);
    const body = await parseBody<Record<string, unknown>>(res);
    // `enabled` from the JSONB blob must be stripped; only quiz_enabled (typed column) survives
    expect(body).not.toHaveProperty('enabled');
    expect(body.language).toBe('pl');
    expect(body.quiz_enabled).toBe(true);
  });

  // FOLLOW-453 / Rule K.2 — a configured DB that throws must fail loud (500), never
  // silently return "enabled" defaults that lie about the tenant's real quiz state.
  it('returns 500 (not enabled defaults) when the DB query throws', async () => {
    vi.mocked(getAuthClaims).mockResolvedValue(TENANT_CLAIMS);
    vi.mocked(createAdminClient).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('connection refused')),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof createAdminClient>);

    const res = await GET(makeGetRequest(TENANT_ID));
    expect(res.status).toBe(500);
    const body = await parseBody<Record<string, unknown>>(res);
    // Must NOT be the enabled-defaults shape — no quiz_enabled: true fabrication.
    expect(body).not.toHaveProperty('quiz_enabled');
    expect(body).toHaveProperty('error');
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

  it('strips enabled from POST body — enabled absent in persisted blob response (AC4 FOLLOW-271)', async () => {
    vi.mocked(requireTenantAccess).mockResolvedValue(TENANT_CLAIMS);
    vi.mocked(createAdminClient).mockReturnValue(
      makeDbMock({}) as unknown as ReturnType<typeof createAdminClient>,
    );
    // AC4: request body contains enabled: true — it must be absent from the persisted response
    const res = await POST(makePostRequest({ enabled: true, language: 'pl' }));
    expect(res.status).toBe(200);
    const body = await parseBody<Record<string, unknown>>(res);
    // FOLLOW-271 AC4: `enabled` must NOT appear in the persisted blob response
    expect(body).not.toHaveProperty('enabled');
    expect(body.language).toBe('pl');
  });

  it('updates config fields and returns updated config without enabled', async () => {
    vi.mocked(requireTenantAccess).mockResolvedValue(TENANT_CLAIMS);
    vi.mocked(createAdminClient).mockReturnValue(
      makeDbMock({}) as unknown as ReturnType<typeof createAdminClient>,
    );
    const res = await POST(makePostRequest({ language: 'pl' }));
    expect(res.status).toBe(200);
    const body = await parseBody<{ language: string }>(res);
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

  it('returns 400 when language is invalid (not a supported enum value)', async () => {
    vi.mocked(requireTenantAccess).mockResolvedValue(TENANT_CLAIMS);
    const res = await POST(makePostRequest({ language: 'de' }));
    expect(res.status).toBe(400);
  });

  it('partial update preserves unset fields', async () => {
    vi.mocked(requireTenantAccess).mockResolvedValue(TENANT_CLAIMS);
    // Shared DB mock — state persists between the two POST calls
    const dbMock = makeDbMock({});
    vi.mocked(createAdminClient).mockReturnValue(
      dbMock as unknown as ReturnType<typeof createAdminClient>,
    );

    // First POST: set language + micro_polls_enabled
    await POST(makePostRequest({ language: 'pl', micro_polls_enabled: true }));

    // Second POST: update only micro_polls_enabled — language should be preserved
    const res = await POST(makePostRequest({ micro_polls_enabled: false }));
    const body = await parseBody<{ micro_polls_enabled: boolean; language: string }>(res);
    expect(body.micro_polls_enabled).toBe(false);
    expect(body.language).toBe('pl');
  });

  it('strips sticky_widget from POST body — sticky_widget absent in persisted response (FOLLOW-274, Rule U)', async () => {
    vi.mocked(requireTenantAccess).mockResolvedValue(TENANT_CLAIMS);
    vi.mocked(createAdminClient).mockReturnValue(
      makeDbMock({}) as unknown as ReturnType<typeof createAdminClient>,
    );
    const res = await POST(makePostRequest({ sticky_widget: true, language: 'pl' }));
    expect(res.status).toBe(200);
    const body = await parseBody<Record<string, unknown>>(res);
    // FOLLOW-274 AC4: `sticky_widget` must NOT appear in the persisted blob response
    expect(body).not.toHaveProperty('sticky_widget');
    expect(body.language).toBe('pl');
  });
});
