/**
 * Tests for GET /api/admin/tracer/history (FOLLOW-267, AC4).
 *
 * Coverage:
 *   AC4.1: 401 when no Authorization header
 *   AC4.2: 403 when JWT is agency-tenant
 *   AC4.3: 400 when tenant_id is missing
 *   AC4.4: 400 when tenant_id is not a UUID
 *   AC4.5: 200 data_source: 'mock' when ClickHouse unconfigured
 *   AC4.6: 200 data_source: 'live' when ClickHouse configured and returns events
 *   AC4.7: 500 data_source: 'error' when ClickHouse configured but throws (Rule K.2)
 *   AC4.8: Pagination params (limit/offset) are forwarded correctly
 *   AC4.9: Optional filters (session_id, from, to, archetype) are forwarded
 *
 * Rule K.2: configured ClickHouse failure MUST return HTTP 500, never mock.
 *
 * @module apps/control-plane/src/app/api/admin/tracer/history/route.test
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
  fetchIntentEventsHistory: vi.fn(),
}));

import { getAuthClaims, isStaffClaims } from '@estalara/auth';
import { resolveClickHouseTracerConfig, fetchIntentEventsHistory } from '@/lib/clickhouse-tracer';
import { GET } from './route';
import type { TracerHistoryResponse } from '@estalara/shared';

const mockGetAuthClaims = vi.mocked(getAuthClaims);
const mockIsStaffClaims = vi.mocked(isStaffClaims);
const mockResolveClickHouseTracerConfig = vi.mocked(resolveClickHouseTracerConfig);
const mockFetchIntentEventsHistory = vi.mocked(fetchIntentEventsHistory);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440042';
const ADMIN_SECRET = 'test-admin-secret-123';

function makeRequest(
  opts: {
    bearer?: string;
    params?: Record<string, string>;
  } = {},
): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
  const url = new URL('http://localhost/api/admin/tracer/history');
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
  event_at: '2026-01-01T00:00:00.000Z',
  event_type: 'intent.snapshot',
  archetype_deltas: '{"yield_hunter":0.1}',
  confidence_before: 0.5,
  confidence_after: 0.65,
  top_archetype: 'yield_hunter',
  event_payload: '{}',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/admin/tracer/history — auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('AC4.1: returns 401 when no Authorization header', async () => {
    mockGetAuthClaims.mockResolvedValue(null);

    const res = await GET(makeRequest({ params: { tenant_id: TENANT_ID } }));
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('AC4.2: returns 403 when JWT is agency-tenant (not staff)', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:owner' as const,
      estalara_staff: false as const,
      mfa_verified: true,
    });
    mockIsStaffClaims.mockReturnValue(false);

    const res = await GET(makeRequest({ bearer: 'some-jwt', params: { tenant_id: TENANT_ID } }));
    expect(res.status).toBe(403);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });
});

describe('GET /api/admin/tracer/history — param validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    mockGetAuthClaims.mockResolvedValue(null);
  });

  it('AC4.3: returns 400 when tenant_id is missing', async () => {
    const res = await GET(makeRequest({ bearer: ADMIN_SECRET }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });

  it('AC4.4: returns 400 when tenant_id is not a UUID', async () => {
    const res = await GET(
      makeRequest({ bearer: ADMIN_SECRET, params: { tenant_id: 'not-a-uuid' } }),
    );
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });

  it('rejects limit > 200', async () => {
    mockResolveClickHouseTracerConfig.mockReturnValue(null);
    const res = await GET(
      makeRequest({
        bearer: ADMIN_SECRET,
        params: { tenant_id: TENANT_ID, limit: '999' },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('accepts limit within range 1..200', async () => {
    mockResolveClickHouseTracerConfig.mockReturnValue(null);
    const res = await GET(
      makeRequest({
        bearer: ADMIN_SECRET,
        params: { tenant_id: TENANT_ID, limit: '100' },
      }),
    );
    expect(res.status).toBe(200);
    const body = await parseBody<TracerHistoryResponse>(res);
    expect(body.limit).toBe(100);
  });
});

describe('GET /api/admin/tracer/history — mock path (ClickHouse unconfigured)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    mockGetAuthClaims.mockResolvedValue(null);
    mockResolveClickHouseTracerConfig.mockReturnValue(null);
  });

  it('AC4.5: returns 200 with data_source: mock when ClickHouse unconfigured', async () => {
    const res = await GET(makeRequest({ bearer: ADMIN_SECRET, params: { tenant_id: TENANT_ID } }));
    expect(res.status).toBe(200);
    const body = await parseBody<TracerHistoryResponse>(res);
    expect(body.data_source).toBe('mock');
    expect(Array.isArray(body.events)).toBe(true);
    expect(typeof body.total).toBe('number');
    expect(typeof body.limit).toBe('number');
    expect(typeof body.offset).toBe('number');
  });
});

describe('GET /api/admin/tracer/history — live path (ClickHouse configured)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    mockGetAuthClaims.mockResolvedValue(null);
    mockResolveClickHouseTracerConfig.mockReturnValue({
      url: 'http://clickhouse:8123',
      user: 'default',
      password: 'pass',
      database: 'default',
    });
  });

  it('AC4.6: returns 200 data_source: live when ClickHouse returns events', async () => {
    mockFetchIntentEventsHistory.mockResolvedValue({ events: [MOCK_EVENT], total: 1 });

    const res = await GET(makeRequest({ bearer: ADMIN_SECRET, params: { tenant_id: TENANT_ID } }));
    expect(res.status).toBe(200);
    const body = await parseBody<TracerHistoryResponse>(res);
    expect(body.data_source).toBe('live');
    expect(body.events).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.events[0]!.event_type).toBe('intent.snapshot');
  });

  it('AC4.7: returns 500 data_source: error when ClickHouse configured but throws (Rule K.2)', async () => {
    mockFetchIntentEventsHistory.mockRejectedValue(new Error('ClickHouse connection refused'));

    const res = await GET(makeRequest({ bearer: ADMIN_SECRET, params: { tenant_id: TENANT_ID } }));
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string }; data_source: string }>(res);
    expect(body.error.code).toBe('clickhouse_error');
    expect(body.data_source).toBe('error');
  });

  // ─── FOLLOW-1023a — ClickHouse Cloud idle-wake ────────────────────────────

  it('FOLLOW-1023a: a cold-start-shaped first failure is retried once and then succeeds', async () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    mockFetchIntentEventsHistory
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce({ events: [], total: 0 });

    const res = await GET(makeRequest({ bearer: ADMIN_SECRET, params: { tenant_id: TENANT_ID } }));

    // Before this, the first visit to Session History after CH Cloud went idle showed a red
    // banner and the identical request succeeded ~20 minutes later (2026-08-17 audit).
    expect(res.status).toBe(200);
    const body = await parseBody<{ data_source: string }>(res);
    expect(body.data_source).toBe('live');
    expect(mockFetchIntentEventsHistory).toHaveBeenCalledTimes(2);
  });

  it('FOLLOW-1023a: an HTTP 503 is cold-start-shaped; a 400 is not', async () => {
    mockFetchIntentEventsHistory
      .mockRejectedValueOnce(new Error('ClickHouse tracer query failed: HTTP 503: unavailable'))
      .mockResolvedValueOnce({ events: [], total: 0 });
    const ok = await GET(makeRequest({ bearer: ADMIN_SECRET, params: { tenant_id: TENANT_ID } }));
    expect(ok.status).toBe(200);
    expect(mockFetchIntentEventsHistory).toHaveBeenCalledTimes(2);

    mockFetchIntentEventsHistory.mockClear();
    mockFetchIntentEventsHistory.mockRejectedValue(
      new Error('ClickHouse tracer query failed: HTTP 400: Code: 47, Unknown identifier'),
    );
    const bad = await GET(makeRequest({ bearer: ADMIN_SECRET, params: { tenant_id: TENANT_ID } }));
    // A deterministic query error must NOT be retried — the operator would wait twice as long
    // for the same red banner.
    expect(bad.status).toBe(500);
    expect(mockFetchIntentEventsHistory).toHaveBeenCalledTimes(1);
  });

  it('FOLLOW-1023a: a cold-start shape that fails TWICE still surfaces the error', async () => {
    mockFetchIntentEventsHistory.mockRejectedValue(new Error('fetch failed'));
    const res = await GET(makeRequest({ bearer: ADMIN_SECRET, params: { tenant_id: TENANT_ID } }));
    expect(res.status).toBe(500);
    const body = await parseBody<{ data_source: string }>(res);
    expect(body.data_source).toBe('error');
    expect(mockFetchIntentEventsHistory).toHaveBeenCalledTimes(2);
  });

  it('AC4.8: forwards limit and offset to ClickHouse helper', async () => {
    mockFetchIntentEventsHistory.mockResolvedValue({ events: [], total: 0 });

    await GET(
      makeRequest({
        bearer: ADMIN_SECRET,
        params: { tenant_id: TENANT_ID, limit: '75', offset: '50' },
      }),
    );

    expect(mockFetchIntentEventsHistory).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ limit: 75, offset: 50 }),
    );
  });

  it('AC4.9: forwards optional filters to ClickHouse helper', async () => {
    mockFetchIntentEventsHistory.mockResolvedValue({ events: [], total: 0 });
    const SESSION_ID = 'sha256filter';

    await GET(
      makeRequest({
        bearer: ADMIN_SECRET,
        params: {
          tenant_id: TENANT_ID,
          session_id: SESSION_ID,
          from: '2026-01-01T00:00:00Z',
          to: '2026-01-31T23:59:59Z',
          archetype: 'yield_hunter',
        },
      }),
    );

    expect(mockFetchIntentEventsHistory).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        sessionId: SESSION_ID,
        from: '2026-01-01T00:00:00Z',
        to: '2026-01-31T23:59:59Z',
        archetype: 'yield_hunter',
      }),
    );
  });

  it('uses default limit=50 and offset=0 when not provided', async () => {
    mockFetchIntentEventsHistory.mockResolvedValue({ events: [], total: 0 });

    await GET(makeRequest({ bearer: ADMIN_SECRET, params: { tenant_id: TENANT_ID } }));

    expect(mockFetchIntentEventsHistory).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ limit: 50, offset: 0 }),
    );
  });
});
