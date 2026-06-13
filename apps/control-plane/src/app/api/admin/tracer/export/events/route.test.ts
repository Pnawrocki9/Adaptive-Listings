/**
 * Tests for GET /api/admin/tracer/export/events (FOLLOW-267, AC7).
 *
 * Coverage:
 *   AC7.1: 401 when no Authorization header
 *   AC7.2: 403 when JWT is agency-tenant
 *   AC7.3: 400 when required params (tenant_id, from, to) are missing
 *   AC7.4: 400 when tenant_id is not a UUID
 *   AC7.5: 503 when ClickHouse not configured (no mock fallback for export)
 *   AC7.6: 500 data_source: error when ClickHouse configured but throws (Rule K.2)
 *   AC7.7: 200 with JSONL output including full event_payload column
 *   AC7.8: JSONL rows are one per line (newline-delimited)
 *
 * Rule K.2: configured ClickHouse failure → HTTP 500; unconfigured → 503.
 * This route always returns JSONL (no CSV variant); full event_payload included.
 *
 * @module apps/control-plane/src/app/api/admin/tracer/export/events/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ─── Mock modules ─────────────────────────────────────────────────────────────

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn(),
  isStaffClaims: vi.fn(),
}));

vi.mock('@/lib/clickhouse-tracer', () => ({
  resolveClickHouseTracerConfig: vi.fn(),
  fetchIntentEventsForExport: vi.fn(),
}));

import { getAuthClaims, isStaffClaims } from '@estalara/auth';
import { resolveClickHouseTracerConfig, fetchIntentEventsForExport } from '@/lib/clickhouse-tracer';
import { GET } from './route';

const mockGetAuthClaims = vi.mocked(getAuthClaims);
const mockIsStaffClaims = vi.mocked(isStaffClaims);
const mockResolveClickHouseTracerConfig = vi.mocked(resolveClickHouseTracerConfig);
const mockFetchIntentEventsForExport = vi.mocked(fetchIntentEventsForExport);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440042';
const ADMIN_SECRET = 'test-admin-secret-123';
const FROM = '2026-01-01T00:00:00Z';
const TO = '2026-01-31T23:59:59Z';

function makeRequest(
  opts: {
    bearer?: string;
    params?: Record<string, string>;
  } = {},
): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
  const url = new URL('http://localhost/api/admin/tracer/export/events');
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url.toString(), { method: 'GET', headers });
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

const MOCK_EVENT = {
  session_id: 'sha256abc123',
  tenant_id: TENANT_ID,
  event_at: '2026-01-15T12:00:00.000Z',
  event_type: 'intent.snapshot',
  archetype_deltas: '{"yield_hunter":0.1}',
  confidence_before: 0.5,
  confidence_after: 0.65,
  top_archetype: 'yield_hunter',
  event_payload: '{"signal_count":3,"quiz_completed":false,"chat_turns":0}',
};

const VALID_PARAMS = { tenant_id: TENANT_ID, from: FROM, to: TO };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/admin/tracer/export/events — auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('AC7.1: returns 401 when no Authorization header', async () => {
    mockGetAuthClaims.mockResolvedValue(null);

    const res = await GET(makeRequest({ params: VALID_PARAMS }));
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('AC7.2: returns 403 when JWT is agency-tenant (not staff)', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:owner' as const,
      estalara_staff: false as const,
      mfa_verified: true,
    });
    mockIsStaffClaims.mockReturnValue(false);

    const res = await GET(makeRequest({ bearer: 'some-jwt', params: VALID_PARAMS }));
    expect(res.status).toBe(403);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });
});

describe('GET /api/admin/tracer/export/events — param validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    mockGetAuthClaims.mockResolvedValue(null);
  });

  it('AC7.3a: returns 400 when tenant_id is missing', async () => {
    const res = await GET(makeRequest({ bearer: ADMIN_SECRET, params: { from: FROM, to: TO } }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });

  it('AC7.3b: returns 400 when from is missing', async () => {
    const res = await GET(
      makeRequest({ bearer: ADMIN_SECRET, params: { tenant_id: TENANT_ID, to: TO } }),
    );
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });

  it('AC7.3c: returns 400 when to is missing', async () => {
    const res = await GET(
      makeRequest({ bearer: ADMIN_SECRET, params: { tenant_id: TENANT_ID, from: FROM } }),
    );
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });

  it('AC7.4: returns 400 when tenant_id is not a UUID', async () => {
    const res = await GET(
      makeRequest({
        bearer: ADMIN_SECRET,
        params: { tenant_id: 'not-a-uuid', from: FROM, to: TO },
      }),
    );
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });
});

describe('GET /api/admin/tracer/export/events — ClickHouse config gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    mockGetAuthClaims.mockResolvedValue(null);
  });

  it('AC7.5: returns 503 when ClickHouse not configured (no mock fallback for export)', async () => {
    mockResolveClickHouseTracerConfig.mockReturnValue(null);

    const res = await GET(makeRequest({ bearer: ADMIN_SECRET, params: VALID_PARAMS }));
    expect(res.status).toBe(503);
    const body = await parseBody<{ error: { code: string }; data_source: string }>(res);
    expect(body.error.code).toBe('clickhouse_unavailable');
    expect(body.data_source).toBe('unconfigured');
  });

  it('AC7.6: returns 500 data_source: error when ClickHouse configured but throws (Rule K.2)', async () => {
    mockResolveClickHouseTracerConfig.mockReturnValue({
      url: 'http://clickhouse:8123',
      password: 'pass',
      database: 'default',
    });
    mockFetchIntentEventsForExport.mockRejectedValue(new Error('ClickHouse connection refused'));

    const res = await GET(makeRequest({ bearer: ADMIN_SECRET, params: VALID_PARAMS }));
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string }; data_source: string }>(res);
    expect(body.error.code).toBe('clickhouse_error');
    expect(body.data_source).toBe('error');
  });
});

describe('GET /api/admin/tracer/export/events — JSONL output', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    mockGetAuthClaims.mockResolvedValue(null);
    mockResolveClickHouseTracerConfig.mockReturnValue({
      url: 'http://clickhouse:8123',
      password: 'pass',
      database: 'default',
    });
  });

  it('AC7.7: returns JSONL including full event_payload column', async () => {
    mockFetchIntentEventsForExport.mockResolvedValue([MOCK_EVENT]);

    const res = await GET(makeRequest({ bearer: ADMIN_SECRET, params: VALID_PARAMS }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/x-ndjson');

    const text = await res.text();
    const rows = text
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.session_id).toBe('sha256abc123');
    expect(rows[0]!.event_type).toBe('intent.snapshot');
    // event_payload must be present (full payload, not stripped like CSV).
    expect(rows[0]!.event_payload).toBe('{"signal_count":3,"quiz_completed":false,"chat_turns":0}');
  });

  it('AC7.8: JSONL rows are newline-delimited (one JSON object per line)', async () => {
    const EVENT_2 = { ...MOCK_EVENT, session_id: 'sha256def456' };
    mockFetchIntentEventsForExport.mockResolvedValue([MOCK_EVENT, EVENT_2]);

    const res = await GET(makeRequest({ bearer: ADMIN_SECRET, params: VALID_PARAMS }));
    const text = await res.text();
    const lines = text.trim().split('\n').filter(Boolean);

    expect(lines).toHaveLength(2);
    // Each line must be valid JSON independently.
    for (const line of lines) {
       
      expect(() => JSON.parse(line) as unknown).not.toThrow();
    }
  });

  it('Content-Disposition includes tenant_id and date range', async () => {
    mockFetchIntentEventsForExport.mockResolvedValue([]);

    const res = await GET(makeRequest({ bearer: ADMIN_SECRET, params: VALID_PARAMS }));
    const disposition = res.headers.get('Content-Disposition') ?? '';
    expect(disposition).toContain(TENANT_ID);
    expect(disposition).toContain(FROM);
    expect(disposition).toContain(TO);
  });

  it('returns empty body (not an error) when no events match the range', async () => {
    mockFetchIntentEventsForExport.mockResolvedValue([]);

    const res = await GET(makeRequest({ bearer: ADMIN_SECRET, params: VALID_PARAMS }));
    expect(res.status).toBe(200);
    const text = await res.text();
    // Empty result = empty body (not a 404/error).
    expect(text.trim()).toBe('');
  });
});
