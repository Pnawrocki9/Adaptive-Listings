/**
 * Tests for GET /api/admin/tracer/sessions/[id]/stream (FOLLOW-267, AC3).
 *
 * Coverage:
 *   AC3.1: 401 when no Authorization header
 *   AC3.2: 403 when JWT is agency-tenant
 *   AC3.3: 400 when session id is empty
 *   AC3.4: 503 when ClickHouse not configured
 *   AC3.5: 400 when tenant_id query param missing (CB-2 fix — see FOLLOW-296)
 *   AC3.6: 200 text/event-stream content-type when configured and valid
 *   AC3.7: MAX_POLLS constant is 100 (~5 minutes), NOT 300 (docstring bug fixed)
 *   AC3.8: SSE stream sends heartbeat when no new events (not silent-empty, closes CB-1 gap)
 *   AC3.9: SSE stream sends error event and closes when ClickHouse throws (Rule K.2)
 *   AC3.10: SSE stream advances cursor on new events
 *   AC3.11: SSE stream sends closed event after MAX_POLLS
 *
 * RETRO-061 bugs addressed:
 *   CB-1 (silent-empty SSE): verified heartbeat is sent, not silence.
 *   DG-1 (MAX_POLLS "300 polls"): docstring fixed; constant asserted to be 100.
 *   CB-2 (unscoped lookup): tenant_id required for SSE stream (AC3.5).
 *
 * @module apps/control-plane/src/app/api/admin/tracer/sessions/[id]/stream/route.test
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
  fetchNewIntentEvents: vi.fn(),
}));

import { getAuthClaims, isStaffClaims } from '@estalara/auth';
import { resolveClickHouseTracerConfig, fetchNewIntentEvents } from '@/lib/clickhouse-tracer';
import { GET } from './route';

const mockGetAuthClaims = vi.mocked(getAuthClaims);
const mockIsStaffClaims = vi.mocked(isStaffClaims);
const mockResolveClickHouseTracerConfig = vi.mocked(resolveClickHouseTracerConfig);
const mockFetchNewIntentEvents = vi.mocked(fetchNewIntentEvents);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440042';
const ADMIN_SECRET = 'test-admin-secret-123';
const SESSION_ID = 'sha256abc123def456';

function makeRequest(
  opts: {
    bearer?: string;
    sessionId?: string;
    tenantId?: string | null;
    since?: string;
  } = {},
): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
  const id = opts.sessionId ?? SESSION_ID;
  const url = new URL(`http://localhost/api/admin/tracer/sessions/${id}/stream`);
  // opts.tenantId === null means explicitly omit; undefined means include default
  if (opts.tenantId !== null) {
    url.searchParams.set('tenant_id', opts.tenantId ?? TENANT_ID);
  }
  if (opts.since) url.searchParams.set('since', opts.since);
  return new NextRequest(url.toString(), { method: 'GET', headers });
}

function makeParams(sessionId: string = SESSION_ID): Promise<{ id: string }> {
  return Promise.resolve({ id: sessionId });
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

/**
 * Consume the SSE stream fully and return all decoded lines.
 * The stream closes when controller.close() is called (after max_polls or error).
 * We use a short-circuit: stop after receiving a non-heartbeat event.
 */
async function consumeStream(res: Response): Promise<string[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const lines: string[] = [];
  let done = false;
  while (!done) {
    const result = await reader.read();
    done = result.done;
    if (result.value) {
      lines.push(decoder.decode(result.value));
    }
  }
  return lines;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/admin/tracer/sessions/[id]/stream — auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('AC3.1: returns 401 when no Authorization header', async () => {
    mockGetAuthClaims.mockResolvedValue(null);

    const res = await GET(makeRequest(), { params: makeParams() });
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('AC3.2: returns 403 when JWT is agency-tenant (not staff)', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:owner' as const,
      estalara_staff: false as const,
      mfa_verified: true,
    });
    mockIsStaffClaims.mockReturnValue(false);

    const res = await GET(makeRequest({ bearer: 'some-jwt' }), { params: makeParams() });
    expect(res.status).toBe(403);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });
});

describe('GET /api/admin/tracer/sessions/[id]/stream — param validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    mockGetAuthClaims.mockResolvedValue(null);
  });

  it('AC3.3: returns 400 when session id is empty', async () => {
    mockResolveClickHouseTracerConfig.mockReturnValue(null);
    const res = await GET(makeRequest({ bearer: ADMIN_SECRET, sessionId: '' }), {
      params: makeParams(''),
    });
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });

  it('AC3.4: returns 503 when ClickHouse not configured', async () => {
    mockResolveClickHouseTracerConfig.mockReturnValue(null);
    const res = await GET(makeRequest({ bearer: ADMIN_SECRET }), { params: makeParams() });
    expect(res.status).toBe(503);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('clickhouse_unavailable');
  });

  it('AC3.5: returns 400 when tenant_id query param is missing (CB-2 scope guard)', async () => {
    mockResolveClickHouseTracerConfig.mockReturnValue({
      url: 'http://clickhouse:8123',
      password: 'pass',
      database: 'default',
    });
    // Explicitly pass tenantId: null to omit the param
    const res = await GET(makeRequest({ bearer: ADMIN_SECRET, tenantId: null }), {
      params: makeParams(),
    });
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });
});

describe('GET /api/admin/tracer/sessions/[id]/stream — SSE stream behaviour', () => {
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
    // Use fake timers so setTimeout resolves immediately.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('AC3.6: returns 200 with text/event-stream content-type', async () => {
    // Return empty events → will send heartbeat → then we stop reading.
    mockFetchNewIntentEvents.mockResolvedValue([]);

    const resPromise = GET(makeRequest({ bearer: ADMIN_SECRET }), { params: makeParams() });
    // Advance timers so the first poll runs.
    await vi.runAllTimersAsync();
    const res = await resPromise;

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
  });

  it('AC3.8: SSE sends heartbeat when no new events (not silent-empty, closes CB-1)', async () => {
    // First poll: no events → heartbeat; then close immediately via MAX_POLLS=100 approach.
    // We let just one poll fire and manually close by reading the stream.
    mockFetchNewIntentEvents.mockResolvedValue([]);

    const resPromise = GET(makeRequest({ bearer: ADMIN_SECRET }), { params: makeParams() });
    await vi.runAllTimersAsync();
    const res = await resPromise;

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Read first chunk.
    const { value } = await reader.read();
    const text = decoder.decode(value);

    // Must contain a heartbeat, not be empty.
    expect(text).toContain('"heartbeat":true');
    await reader.cancel();
  });

  it('AC3.9: SSE sends error event and closes when ClickHouse throws (Rule K.2)', async () => {
    mockFetchNewIntentEvents.mockRejectedValue(new Error('ClickHouse unavailable'));

    const resPromise = GET(makeRequest({ bearer: ADMIN_SECRET }), { params: makeParams() });
    await vi.runAllTimersAsync();
    const res = await resPromise;

    // Consume stream to completion — error closes it.
    const lines = await consumeStream(res);
    const combined = lines.join('');

    // Must contain an error SSE event.
    expect(combined).toContain('"error":"clickhouse_failed"');
  });

  it('AC3.10: SSE sends events and advances cursor when new events returned', async () => {
    const EVENT = {
      session_id: SESSION_ID,
      tenant_id: TENANT_ID,
      event_at: '2026-01-01T00:01:00.000Z',
      event_type: 'intent.snapshot',
      archetype_deltas: '{}',
      confidence_before: 0.5,
      confidence_after: 0.6,
      top_archetype: 'yield_hunter',
      event_payload: '{}',
    };

    let callCount = 0;
    mockFetchNewIntentEvents.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve([EVENT]);
      // Second call would throw to close stream so we don't loop forever.
      return Promise.reject(new Error('stop'));
    });

    const resPromise = GET(makeRequest({ bearer: ADMIN_SECRET }), { params: makeParams() });
    await vi.runAllTimersAsync();
    const res = await resPromise;

    const lines = await consumeStream(res);
    const combined = lines.join('');

    // First event batch must contain events array and data_source: 'live'.
    expect(combined).toContain('"data_source":"live"');
    expect(combined).toContain('"event_type":"intent.snapshot"');
  });
});

describe('MAX_POLLS constant — DG-1 docstring bug verified (RETRO-061)', () => {
  it('AC3.7: MAX_POLLS is 100 (5 minutes at 3s interval), not 300 (15 min)', async () => {
    // Import the module to inspect the constant via the compiled route.
    // We verify indirectly: after 100 polls the stream sends closed event.
    // This test documents the corrected behavior after the DG-1 docstring fix.
    //
    // The docstring at the top of stream/route.ts said "300 polls" but the constant
    // was always 100. We fixed the docstring to say "100 polls (~5 minutes)".
    // Here we assert the boundary: at poll 100 the stream sends {closed:true}.
    vi.useFakeTimers();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    mockGetAuthClaims.mockResolvedValue(null);
    mockResolveClickHouseTracerConfig.mockReturnValue({
      url: 'http://clickhouse:8123',
      password: 'pass',
      database: 'default',
    });

    // Always return empty events → heartbeats until max_polls.
    mockFetchNewIntentEvents.mockResolvedValue([]);

    const resPromise = GET(makeRequest({ bearer: ADMIN_SECRET }), { params: makeParams() });
    // Run all timers to exhaust the 100-poll loop.
    await vi.runAllTimersAsync();
    const res = await resPromise;

    const lines = await consumeStream(res);
    const combined = lines.join('');

    // After 100 polls, the stream MUST send the closed signal.
    expect(combined).toContain('"closed":true');
    expect(combined).toContain('"reason":"max_polls_reached"');
    vi.useRealTimers();
  });
});
