/**
 * Tests for GET /api/quiz/public-config — public SDK runtime config endpoint.
 *
 * AC5 (FOLLOW-275 / Rule L): these tests drive the route handler directly with a mocked
 * tenant, asserting that the response body reflects DB values — NOT snippet-attribute
 * injection. This is the Rule L producer test: it proves the route (the production path
 * that the SDK calls) supplies correct values from the DB store.
 *
 * Coverage:
 *   AC1: Route exists, reachable with valid API key → 200
 *   AC2: 200 response shape correct — all 4 fields present, non-nullable, sourced from DB
 *   AC3: 401 on bad/missing API key; 404 on tenant not found (key exists but tenant row gone)
 *   AC4 (FOLLOW-277): auth-path DB throw → 503 (not 500); data_source present in all 200 paths
 *   AC5: Response body reflects the tenant's DB values (quiz_enabled=false, pl language, etc.)
 *
 * DB and @estalara/db are mocked below — the test proves route wiring, not DB internals.
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock @estalara/db ────────────────────────────────────────────────────────
// We mock createAdminClient so we can control what the DB returns per test.

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();

// Chain: db.select().from().where().limit()
mockLimit.mockResolvedValue([]);
mockWhere.mockReturnValue({ limit: mockLimit });
mockFrom.mockReturnValue({ where: mockWhere });
mockSelect.mockReturnValue({ from: mockFrom });

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => ({ select: mockSelect })),
  apiKeys: {
    tenantId: 'tenant_id',
    hashedKey: 'hashed_key',
    revokedAt: 'revoked_at',
    expiresAt: 'expires_at',
  },
  tenants: {
    id: 'id',
    quizConfig: 'quiz_config',
    quizEnabled: 'quiz_enabled',
    // ADR-0019 (FOLLOW-623): brand slice source column.
    brandConfig: 'brand_config',
    deletedAt: 'deleted_at',
  },
}));

// ─── Mock env (DATABASE_URL_ADMIN must be set so auth path runs) ──────────────
vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');

// ─── Import route AFTER mocks are in place ────────────────────────────────────
import { GET, OPTIONS } from './route';
import type { QuizPublicConfigResponse } from '@estalara/shared';

// ─── Helper constants ─────────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';

/**
 * A pre-computed SHA-256('valid-api-key-test') hex string so the mock DB lookup can
 * return a matching row. The route computes SHA-256(bearer) and checks api_keys.hashed_key.
 * We mock the DB to return rows[0].hashedKey === this value so constantTimeEqual passes.
 */
const VALID_KEY_RAW = 'valid-api-key-test';
// We don't pre-compute the actual hash in the test; instead we make the mock return
// the same hash the route will compute — done by capturing the sha256Hex result.
// Simpler approach: make mockLimit return a row where hashedKey equals whatever
// sha256Hex produces for VALID_KEY_RAW. We achieve this via the crypto API directly.

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Helper to build requests ─────────────────────────────────────────────────

function makeGetRequest(apiKey?: string): NextRequest {
  return new NextRequest('http://localhost/api/quiz/public-config', {
    method: 'GET',
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

// ─── Test suites ──────────────────────────────────────────────────────────────

describe('OPTIONS /api/quiz/public-config', () => {
  it('returns 204 with CORS headers', () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('GET /api/quiz/public-config — auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLimit.mockResolvedValue([]);
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  it('AC3: missing Authorization header → 401', async () => {
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: string }>(res);
    expect(body.error).toBe('Invalid API key');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('AC3: bad Bearer token (key not in DB) → 404', async () => {
    // api_keys lookup returns no rows — tenant not found
    mockLimit.mockResolvedValueOnce([]);
    const res = await GET(makeGetRequest('unknown-bad-key'));
    expect(res.status).toBe(404);
    const body = await parseBody<{ error: string }>(res);
    expect(body.error).toBe('Tenant not found');
  });
});

describe('GET /api/quiz/public-config — 200 shape (AC1 + AC2 + AC5)', () => {
  let validKeyHash: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    validKeyHash = await sha256Hex(VALID_KEY_RAW);

    // Reset chain mock
    mockLimit.mockResolvedValue([]);
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  it('AC1 + AC2: valid API key → 200, all 4 fields present and non-nullable', async () => {
    // First call: api_keys lookup returns the valid key row
    mockLimit
      .mockResolvedValueOnce([{ tenantId: TENANT_ID, hashedKey: validKeyHash }])
      // Second call: tenants lookup returns default config
      .mockResolvedValueOnce([{ quizConfig: {}, quizEnabled: true }]);

    const res = await GET(makeGetRequest(VALID_KEY_RAW));
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Cache-Control')).toContain('max-age=300');

    const body = await parseBody<QuizPublicConfigResponse & { data_source?: string }>(res);
    // All four fields must be present and non-nullable
    expect(typeof body.quiz_enabled).toBe('boolean');
    expect(typeof body.micro_polls_enabled).toBe('boolean');
    expect(typeof body.language).toBe('string');
    expect(typeof body.accent_color).toBe('string');
    // Defaults when tenant has no quiz_config
    expect(body.quiz_enabled).toBe(true);
    expect(body.micro_polls_enabled).toBe(false);
    expect(body.language).toBe('en');
    expect(body.accent_color).toBe('#2563EB');
    // AC4 (FOLLOW-277): happy path must emit data_source='db' (Rule K.2 provenance)
    expect(body.data_source).toBe('db');
  });

  it('AC5 (Rule L): response reflects tenant DB values — quiz_enabled=false, language=pl', async () => {
    // This is the Rule L producer test: it asserts the route reads from the DB store and
    // reflects tenant-specific values, NOT snippet-attribute injection.
    mockLimit
      .mockResolvedValueOnce([{ tenantId: TENANT_ID, hashedKey: validKeyHash }])
      .mockResolvedValueOnce([
        {
          quizConfig: { language: 'pl', accent_color: '#FF0000', micro_polls_enabled: true },
          quizEnabled: false, // tenant has explicitly disabled the quiz
        },
      ]);

    const res = await GET(makeGetRequest(VALID_KEY_RAW));
    expect(res.status).toBe(200);

    const body = await parseBody<QuizPublicConfigResponse>(res);
    // Must reflect the tenant's DB values, not defaults
    expect(body.quiz_enabled).toBe(false); // from tenants.quiz_enabled column
    expect(body.language).toBe('pl'); // from quiz_config blob
    expect(body.accent_color).toBe('#FF0000'); // from quiz_config blob
    expect(body.micro_polls_enabled).toBe(true); // from quiz_config blob
  });

  it('AC5: quiz_enabled=true with micro_polls_enabled=false from DB', async () => {
    mockLimit
      .mockResolvedValueOnce([{ tenantId: TENANT_ID, hashedKey: validKeyHash }])
      .mockResolvedValueOnce([
        {
          quizConfig: { language: 'es', accent_color: '#123456', micro_polls_enabled: false },
          quizEnabled: true,
        },
      ]);

    const res = await GET(makeGetRequest(VALID_KEY_RAW));
    expect(res.status).toBe(200);
    const body = await parseBody<QuizPublicConfigResponse>(res);
    expect(body.quiz_enabled).toBe(true);
    expect(body.language).toBe('es');
    expect(body.accent_color).toBe('#123456');
    expect(body.micro_polls_enabled).toBe(false);
  });

  it('AC3: tenant row gone (api_key exists but tenant deleted) → 404', async () => {
    mockLimit
      // api_keys lookup: key found
      .mockResolvedValueOnce([{ tenantId: TENANT_ID, hashedKey: validKeyHash }])
      // tenants lookup: no row (soft-deleted or missing)
      .mockResolvedValueOnce([]);

    const res = await GET(makeGetRequest(VALID_KEY_RAW));
    expect(res.status).toBe(404);
    const body = await parseBody<{ error: string }>(res);
    expect(body.error).toBe('Tenant not found');
  });

  it('DB error on tenant fetch → 200 fallback with data_source=fallback (K.2)', async () => {
    mockLimit
      // api_keys lookup: success
      .mockResolvedValueOnce([{ tenantId: TENANT_ID, hashedKey: validKeyHash }])
      // tenant fetch: throws
      .mockRejectedValueOnce(new Error('DB connection lost'));

    const res = await GET(makeGetRequest(VALID_KEY_RAW));
    // Read-only endpoint: fallback 200 rather than hard 500 (keeps quiz working on DB hiccup)
    expect(res.status).toBe(200);
    const body = await parseBody<QuizPublicConfigResponse & { data_source: string }>(res);
    // K.2: degraded state is observable on the wire
    expect(body.data_source).toBe('fallback');
    // Fallback values are non-nullable
    expect(typeof body.quiz_enabled).toBe('boolean');
    expect(typeof body.micro_polls_enabled).toBe('boolean');
    expect(typeof body.language).toBe('string');
    expect(typeof body.accent_color).toBe('string');
  });
});

// ─── ADR-0019 / FOLLOW-623 — brand slice (Rule L producer test) ──────────────
// These assert the route EMITS `brand` from the DB `tenants.brand_config` column — the
// production producer for the SDK consumer, NOT a fixture-injected literal.

describe('GET /api/quiz/public-config — brand slice (ADR-0019 / FOLLOW-623)', () => {
  let validKeyHash: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
    validKeyHash = await sha256Hex(VALID_KEY_RAW);
    mockLimit.mockResolvedValue([]);
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  it('emits a full brand slice from tenants.brand_config', async () => {
    mockLimit
      .mockResolvedValueOnce([{ tenantId: TENANT_ID, hashedKey: validKeyHash }])
      .mockResolvedValueOnce([
        {
          quizConfig: {},
          quizEnabled: true,
          brandConfig: {
            primary_color: '#1a73e8',
            logo_url: 'https://cdn.example.com/logo.svg',
            white_label: true,
          },
        },
      ]);

    const res = await GET(makeGetRequest(VALID_KEY_RAW));
    expect(res.status).toBe(200);
    const body = await parseBody<{
      brand?: { primary_color: string; logo_url: string | null; white_label: boolean };
    }>(res);
    expect(body.brand).toEqual({
      primary_color: '#1a73e8',
      logo_url: 'https://cdn.example.com/logo.svg',
      white_label: true,
    });
  });

  it('emits logo_url === null (never undefined) when the stored brand has no logo', async () => {
    mockLimit
      .mockResolvedValueOnce([{ tenantId: TENANT_ID, hashedKey: validKeyHash }])
      .mockResolvedValueOnce([
        {
          quizConfig: {},
          quizEnabled: true,
          brandConfig: { primary_color: '#c026d3', white_label: false },
        },
      ]);

    const res = await GET(makeGetRequest(VALID_KEY_RAW));
    const body = await parseBody<{ brand?: { logo_url: string | null } }>(res);
    expect(body.brand).toBeDefined();
    expect(body.brand?.logo_url).toBeNull();
  });

  it('OMITS the brand slice for an unconfigured tenant (empty {} default) — D4 byte-identical', async () => {
    mockLimit
      .mockResolvedValueOnce([{ tenantId: TENANT_ID, hashedKey: validKeyHash }])
      .mockResolvedValueOnce([{ quizConfig: {}, quizEnabled: true, brandConfig: {} }]);

    const res = await GET(makeGetRequest(VALID_KEY_RAW));
    const body = await parseBody<Record<string, unknown>>(res);
    expect('brand' in body).toBe(false);
  });

  it('OMITS a malformed brand blob (bad hex color) rather than breaking the response', async () => {
    mockLimit
      .mockResolvedValueOnce([{ tenantId: TENANT_ID, hashedKey: validKeyHash }])
      .mockResolvedValueOnce([
        {
          quizConfig: {},
          quizEnabled: true,
          brandConfig: { primary_color: 'not-a-hex', logo_url: null, white_label: false },
        },
      ]);

    const res = await GET(makeGetRequest(VALID_KEY_RAW));
    // The core quiz config still returns 200; only the invalid brand slice is dropped.
    expect(res.status).toBe(200);
    const body = await parseBody<Record<string, unknown>>(res);
    expect('brand' in body).toBe(false);
    expect(body.data_source).toBe('db');
  });
});

describe('GET /api/quiz/public-config — unconfigured DB (dev/CI)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Unset the DB env var to simulate dev/CI
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    vi.stubEnv('DATABASE_URL_DIRECT', '');
  });

  it('no DB configured → 200 fallback with data_source=fallback', async () => {
    const res = await GET(makeGetRequest('any-key'));
    expect(res.status).toBe(200);
    const body = await parseBody<QuizPublicConfigResponse & { data_source: string }>(res);
    expect(body.data_source).toBe('fallback');
    expect(typeof body.quiz_enabled).toBe('boolean');
    expect(typeof body.micro_polls_enabled).toBe('boolean');
  });
});

// ─── AC4 (FOLLOW-277) — auth-path DB throw must NOT return 500 ───────────────

describe('GET /api/quiz/public-config — AC4 (FOLLOW-277): auth-path DB throw → 503', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // DB env is set (configured) so the auth path runs
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');

    // api_keys lookup throws to simulate a DB failure during auth
    mockLimit.mockRejectedValue(new Error('ECONNREFUSED'));
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  it('AC4: DB throws during auth lookup → 503, NOT 500', async () => {
    const res = await GET(makeGetRequest('any-valid-looking-key'));
    // Must NOT be 500 — auth-path DB throws are a transient dependency failure,
    // not an application bug. 503 is the correct contract (FOLLOW-277).
    expect(res.status).not.toBe(500);
    expect(res.status).toBe(503);
    const body = await parseBody<{ error: string }>(res);
    expect(body.error).toBe('Service temporarily unavailable');
    // CORS headers must be present so the SDK can read the body
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
