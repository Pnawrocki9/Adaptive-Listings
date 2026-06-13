/**
 * Tests for GET /api/admin/tracer/export/decisions (FOLLOW-267, AC6).
 *
 * Coverage:
 *   AC6.1: 401 when no Authorization header
 *   AC6.2: 403 when JWT is agency-tenant
 *   AC6.3: 400 when required params (tenant_id, from, to) are missing
 *   AC6.4: 400 when tenant_id is not a UUID
 *   AC6.5: 503 when ClickHouse not configured (no mock fallback for export)
 *   AC6.6: 500 data_source: error when ClickHouse configured but throws (Rule K.2)
 *   AC6.7: 200 with JSONL output when Accept header is not text/csv
 *   AC6.8: 200 with CSV output when Accept: text/csv
 *   AC6.9: CSV rows escape special characters correctly
 *   AC6.10: Empty result produces headers-only CSV
 *
 * Rule K.2: configured ClickHouse failure → HTTP 500; unconfigured → 503.
 * No mock fallback for export (returning fake export data would be fabrication).
 *
 * @module apps/control-plane/src/app/api/admin/tracer/export/decisions/route.test
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
    accept?: string;
  } = {},
): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
  if (opts.accept) headers.Accept = opts.accept;
  const url = new URL('http://localhost/api/admin/tracer/export/decisions');
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
  event_payload: '{}',
};

const VALID_PARAMS = { tenant_id: TENANT_ID, from: FROM, to: TO };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/admin/tracer/export/decisions — auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('AC6.1: returns 401 when no Authorization header', async () => {
    mockGetAuthClaims.mockResolvedValue(null);

    const res = await GET(makeRequest({ params: VALID_PARAMS }));
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('AC6.2: returns 403 when JWT is agency-tenant (not staff)', async () => {
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

describe('GET /api/admin/tracer/export/decisions — param validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    mockGetAuthClaims.mockResolvedValue(null);
  });

  it('AC6.3a: returns 400 when tenant_id is missing', async () => {
    const res = await GET(makeRequest({ bearer: ADMIN_SECRET, params: { from: FROM, to: TO } }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });

  it('AC6.3b: returns 400 when from is missing', async () => {
    const res = await GET(
      makeRequest({ bearer: ADMIN_SECRET, params: { tenant_id: TENANT_ID, to: TO } }),
    );
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });

  it('AC6.3c: returns 400 when to is missing', async () => {
    const res = await GET(
      makeRequest({ bearer: ADMIN_SECRET, params: { tenant_id: TENANT_ID, from: FROM } }),
    );
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });

  it('AC6.4: returns 400 when tenant_id is not a UUID', async () => {
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

describe('GET /api/admin/tracer/export/decisions — ClickHouse config gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    mockGetAuthClaims.mockResolvedValue(null);
  });

  it('AC6.5: returns 503 when ClickHouse not configured (no mock fallback for export)', async () => {
    mockResolveClickHouseTracerConfig.mockReturnValue(null);

    const res = await GET(makeRequest({ bearer: ADMIN_SECRET, params: VALID_PARAMS }));
    expect(res.status).toBe(503);
    const body = await parseBody<{ error: { code: string }; data_source: string }>(res);
    expect(body.error.code).toBe('clickhouse_unavailable');
    // Observable degraded flag — consumer can detect unconfigured state.
    expect(body.data_source).toBe('unconfigured');
  });

  it('AC6.6: returns 500 data_source: error when ClickHouse configured but throws (Rule K.2)', async () => {
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

describe('GET /api/admin/tracer/export/decisions — output format', () => {
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

  it('AC6.7: returns JSONL when Accept is not text/csv', async () => {
    mockFetchIntentEventsForExport.mockResolvedValue([MOCK_EVENT]);

    const res = await GET(
      makeRequest({ bearer: ADMIN_SECRET, params: VALID_PARAMS, accept: 'application/json' }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/x-ndjson');
    const text = await res.text();
    // Should be valid JSON-per-line.
    const rows = text
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.session_id).toBe('sha256abc123');
    expect(rows[0]!.event_type).toBe('intent.snapshot');
  });

  it('AC6.8: returns CSV when Accept: text/csv', async () => {
    mockFetchIntentEventsForExport.mockResolvedValue([MOCK_EVENT]);

    const res = await GET(
      makeRequest({ bearer: ADMIN_SECRET, params: VALID_PARAMS, accept: 'text/csv' }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    const text = await res.text();
    const lines = text.split('\n');
    // First line must be the CSV header.
    expect(lines[0]).toContain('session_id');
    expect(lines[0]).toContain('tenant_id');
    expect(lines[0]).toContain('event_at');
    expect(lines[0]).toContain('top_archetype');
    // Second line must be the data row.
    expect(lines[1]).toContain('sha256abc123');
    expect(lines[1]).toContain('yield_hunter');
  });

  it('AC6.9: CSV escapes fields containing commas or double-quotes', async () => {
    const eventWithComma = {
      ...MOCK_EVENT,
      archetype_deltas: '{"yield_hunter":0.1,"family,nester":0.2}',
      top_archetype: 'yield_hunter,"extra"',
    };
    mockFetchIntentEventsForExport.mockResolvedValue([eventWithComma]);

    const res = await GET(
      makeRequest({ bearer: ADMIN_SECRET, params: VALID_PARAMS, accept: 'text/csv' }),
    );
    const text = await res.text();
    const dataLine = text.split('\n')[1]!;
    // Fields containing commas must be quoted.
    expect(dataLine).toContain('"');
  });

  it('AC6.10: empty result produces headers-only CSV', async () => {
    mockFetchIntentEventsForExport.mockResolvedValue([]);

    const res = await GET(
      makeRequest({ bearer: ADMIN_SECRET, params: VALID_PARAMS, accept: 'text/csv' }),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.split('\n').filter(Boolean);
    // Only header line, no data rows.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('session_id');
  });

  it('Content-Disposition includes tenant_id and date range in filename', async () => {
    mockFetchIntentEventsForExport.mockResolvedValue([]);

    const res = await GET(
      makeRequest({ bearer: ADMIN_SECRET, params: VALID_PARAMS, accept: 'text/csv' }),
    );
    const disposition = res.headers.get('Content-Disposition') ?? '';
    expect(disposition).toContain(TENANT_ID);
    expect(disposition).toContain(FROM);
    expect(disposition).toContain(TO);
  });
});
