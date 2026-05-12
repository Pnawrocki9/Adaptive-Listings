/**
 * Tests for POST /api/detect
 *
 * Coverage:
 *   - Missing body                         → 400 VALIDATION_ERROR
 *   - Invalid URL                          → 400 VALIDATION_ERROR
 *   - detectSiteSchema throws "Not implemented" → 501 DETECTION_NOT_IMPLEMENTED
 *   - fetch fails (network error)          → 400 FETCH_FAILED
 *   - fetch returns non-2xx               → 400 FETCH_FAILED
 *   - Valid result with non-null schema    → 200, upsert called
 *   - Valid result with null schema        → 200, no DB write
 *
 * @module apps/control-plane/src/app/api/detect/route.test
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks (must be at top level, before any imports that use them) ──────

vi.mock('@estalara/sdk/auto-detect', () => ({
  detectSiteSchema: vi.fn(),
}));

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  tenantSiteSchemas: {
    tenantId: 'tenant_id',
    domain: 'domain',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  and: vi.fn((...args: unknown[]) => args),
}));

// ── Actual module imports ──────────────────────────────────────────────────────

import { detectSiteSchema } from '@estalara/sdk/auto-detect';
import { createAdminClient } from '@estalara/db';
import { POST } from './route';
import type { DetectionResult } from '@estalara/sdk/auto-detect';
import type { TenantSiteSchema } from '@estalara/shared';

const mockDetectSiteSchema = vi.mocked(detectSiteSchema);
const mockCreateAdminClient = vi.mocked(createAdminClient);

// ── Helpers ────────────────────────────────────────────────────────────────────

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/detect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeRequestRaw(body: string): NextRequest {
  return new NextRequest('http://localhost/api/detect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

const VALID_SCHEMA: TenantSiteSchema = {
  tenant_id: 'anonymous',
  domain: 'example.com',
  detected_at: new Date().toISOString(),
  detection_source: 'article_tag',
  detection_confidence: 0.85,
  index_schema: {
    url_patterns: ['https://example.com/**'],
    listing_card_selector: 'article.listing',
    card_field_mappings: {},
    data_extractors_per_card: {},
    reorder_capable: false,
  },
  detail_schema: {
    url_patterns: ['https://example.com/listing/*'],
    slot_selectors: {},
    data_extractors: {},
  },
  archetype_hints: [],
};

const VALID_RESULT: DetectionResult = {
  schema: VALID_SCHEMA,
  confidence: 0.85,
  technique: 'article_tag',
  warnings: [],
};

/** Builds a Drizzle mock that records calls for the upsert chain. */
function makeDbMock() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue([]);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  return { insert, values, onConflictDoUpdate };
}

/** Mock global fetch to return a successful HTML response. */
function mockFetchSuccess(html = '<html><body>Test</body></html>') {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(html),
    }),
  );
}

/** Mock global fetch to throw an error. */
function mockFetchError(message = 'network error') {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(message)));
}

/** Mock global fetch to return a non-2xx status. */
function mockFetchNon2xx(status = 404) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      text: () => Promise.resolve('Not Found'),
    }),
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('POST /api/detect — request validation', () => {
  it('non-JSON body → 400 VALIDATION_ERROR', async () => {
    const res = await POST(makeRequestRaw('not json!!!'));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('missing body fields → 400 VALIDATION_ERROR', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string; request_id: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(typeof body.error.request_id).toBe('string');
    expect(body.error.request_id.length).toBeGreaterThan(0);
  });

  it('invalid URL (not http/https) → 400 VALIDATION_ERROR', async () => {
    const res = await POST(makeRequest({ url: 'ftp://example.com' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('plain string instead of URL → 400 VALIDATION_ERROR', async () => {
    const res = await POST(makeRequest({ url: 'not-a-url' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/detect — fetch failures', () => {
  it('fetch throws network error → 400 FETCH_FAILED', async () => {
    mockFetchError('connection refused');

    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string; message: string } }>(res);
    expect(body.error.code).toBe('FETCH_FAILED');
    expect(body.error.message).toBe('Could not fetch the provided URL');
  });

  it('fetch returns 404 → 400 FETCH_FAILED', async () => {
    mockFetchNon2xx(404);

    const res = await POST(makeRequest({ url: 'https://example.com/missing' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('FETCH_FAILED');
  });

  it('fetch returns 500 → 400 FETCH_FAILED', async () => {
    mockFetchNon2xx(500);

    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('FETCH_FAILED');
  });
});

describe('POST /api/detect — detection engine not implemented', () => {
  it('detectSiteSchema throws "Not implemented" → 501 DETECTION_NOT_IMPLEMENTED', async () => {
    mockFetchSuccess();
    mockDetectSiteSchema.mockRejectedValue(
      new Error('Not implemented — detection techniques ship in AUTO-003 and AUTO-004'),
    );

    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(501);
    const body = await parseBody<{ error: { code: string; message: string; request_id: string } }>(
      res,
    );
    expect(body.error.code).toBe('DETECTION_NOT_IMPLEMENTED');
    expect(body.error.message).toContain('Detection engine is being deployed');
    expect(typeof body.error.request_id).toBe('string');
  });

  it('detectSiteSchema throws "Not Implemented" (capitalised) → 501', async () => {
    mockFetchSuccess();
    mockDetectSiteSchema.mockRejectedValue(new Error('Not Implemented'));

    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(501);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('DETECTION_NOT_IMPLEMENTED');
  });
});

describe('POST /api/detect — successful detection', () => {
  it('valid result with non-null schema → 200 + DB upsert called', async () => {
    mockFetchSuccess();
    mockDetectSiteSchema.mockResolvedValue(VALID_RESULT);

    const db = makeDbMock();
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({ url: 'https://example.com', tenant_id: 'tenant-abc' }));
    expect(res.status).toBe(200);

    const body = await parseBody<DetectionResult>(res);
    expect(body.confidence).toBe(0.85);
    expect(body.technique).toBe('article_tag');
    expect(body.schema).not.toBeNull();

    // DB insert should have been called
    expect(db.insert).toHaveBeenCalled();
  });

  it('valid result with null schema → 200, DB upsert NOT called', async () => {
    mockFetchSuccess();
    const nullResult: DetectionResult = {
      schema: null,
      confidence: 0,
      technique: 'ai_vision',
      warnings: ['No deterministic technique matched'],
    };
    mockDetectSiteSchema.mockResolvedValue(nullResult);

    const db = makeDbMock();
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(200);

    const body = await parseBody<DetectionResult>(res);
    expect(body.schema).toBeNull();

    // No DB write when schema is null
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('DB failure does not block the 200 response', async () => {
    mockFetchSuccess();
    mockDetectSiteSchema.mockResolvedValue(VALID_RESULT);

    const db = makeDbMock();
    db.onConflictDoUpdate.mockRejectedValue(new Error('DB connection failed'));
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);

    // Should still return 200 even if DB fails
    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(200);
  });

  it('response includes warnings array', async () => {
    mockFetchSuccess();
    const resultWithWarnings: DetectionResult = {
      ...VALID_RESULT,
      warnings: ['ambiguous selector found', 'h1 contains price'],
    };
    mockDetectSiteSchema.mockResolvedValue(resultWithWarnings);

    const db = makeDbMock();
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(200);
    const body = await parseBody<DetectionResult>(res);
    expect(body.warnings).toHaveLength(2);
  });

  it('tenant_id defaults to "anonymous" when omitted', async () => {
    mockFetchSuccess();
    mockDetectSiteSchema.mockResolvedValue(VALID_RESULT);

    const db = makeDbMock();
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(200);
    // detectSiteSchema should be called with 'anonymous' tenant_id
    expect(mockDetectSiteSchema).toHaveBeenCalledWith(
      expect.any(String),
      'https://example.com',
      'anonymous',
    );
  });

  it('tenant_id is forwarded to detectSiteSchema when provided', async () => {
    mockFetchSuccess();
    mockDetectSiteSchema.mockResolvedValue(VALID_RESULT);

    const db = makeDbMock();
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);

    await POST(makeRequest({ url: 'https://example.com', tenant_id: 'my-tenant-id' }));
    expect(mockDetectSiteSchema).toHaveBeenCalledWith(
      expect.any(String),
      'https://example.com',
      'my-tenant-id',
    );
  });
});

describe('POST /api/detect — unexpected errors', () => {
  it('detectSiteSchema throws unexpected error → 500 INTERNAL_ERROR', async () => {
    mockFetchSuccess();
    mockDetectSiteSchema.mockRejectedValue(new Error('Segfault in WASM'));

    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
