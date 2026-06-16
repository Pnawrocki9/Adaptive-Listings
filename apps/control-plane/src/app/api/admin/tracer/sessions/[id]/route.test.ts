/**
 * Tests for GET /api/admin/tracer/sessions/[id] (FOLLOW-267, AC2).
 *
 * Coverage:
 *   AC2.1: 401 when no Authorization header
 *   AC2.2: 403 when JWT is agency-tenant (not staff)
 *   AC2.3: 400 when session id is empty string
 *   AC2.4: 200 with data_source: 'mock' when DATABASE_URL_ADMIN unset
 *   AC2.5: 404 when DB configured and session not found
 *   AC2.6: 200 data_source: 'live' — Postgres hit + ClickHouse configured + events returned
 *   AC2.7: 200 data_source: 'clickhouse_unavailable' — Postgres ok, ClickHouse unconfigured
 *   AC2.8: 500 data_source: 'error' when Postgres configured but throws (Rule K.2)
 *   AC2.9: 500 data_source: 'error' when ClickHouse configured but throws (Rule K.2)
 *
 * Rule K.2: configured-store failure MUST return HTTP 500, never mock.
 *
 * @module apps/control-plane/src/app/api/admin/tracer/sessions/[id]/route.test
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

// Drizzle chain: db.select().from().where().limit()
const mockLimit = vi.fn();
const mockWhere = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();

mockLimit.mockResolvedValue([]);
mockWhere.mockReturnValue({ limit: mockLimit });
mockFrom.mockReturnValue({ where: mockWhere });
mockSelect.mockReturnValue({ from: mockFrom });

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => ({ select: mockSelect })),
  intentSessions: {
    sessionId: 'session_id',
    tenantId: 'tenant_id',
    signalCount: 'signal_count',
    intentState: 'intent_state',
    lastEventAt: 'last_event_at',
    quizCompleted: 'quiz_completed',
    chatTurns: 'chat_turns',
  },
}));

vi.mock('@/lib/clickhouse-tracer', () => ({
  resolveClickHouseTracerConfig: vi.fn(),
  fetchIntentEventsForSession: vi.fn(),
}));

import { getAuthClaims, isStaffClaims } from '@estalara/auth';
import {
  resolveClickHouseTracerConfig,
  fetchIntentEventsForSession,
} from '@/lib/clickhouse-tracer';
import { GET } from './route';
import type { TracerSessionDetailResponse } from '@estalara/shared';

const mockGetAuthClaims = vi.mocked(getAuthClaims);
const mockIsStaffClaims = vi.mocked(isStaffClaims);
const mockResolveClickHouseTracerConfig = vi.mocked(resolveClickHouseTracerConfig);
const mockFetchIntentEventsForSession = vi.mocked(fetchIntentEventsForSession);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440042';
const ADMIN_SECRET = 'test-admin-secret-123';
const SESSION_ID = 'sha256abc123def456';

function makeRequest(opts: { bearer?: string; sessionId?: string } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
  const id = opts.sessionId ?? SESSION_ID;
  return new NextRequest(`http://localhost/api/admin/tracer/sessions/${id}`, {
    method: 'GET',
    headers,
  });
}

function makeParams(sessionId: string = SESSION_ID): Promise<{ id: string }> {
  return Promise.resolve({ id: sessionId });
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

const MOCK_SESSION_ROW = {
  sessionId: SESSION_ID,
  tenantId: TENANT_ID,
  signalCount: 5,
  intentState: { topArchetype: 'yield_hunter', confidence: 0.72, weights: {} },
  lastEventAt: new Date('2026-01-01T00:00:00Z'),
  quizCompleted: false,
  chatTurns: 1,
};

const MOCK_EVENT_ROW = {
  session_id: SESSION_ID,
  tenant_id: TENANT_ID,
  event_at: '2026-01-01T00:00:00.000Z',
  event_type: 'intent.snapshot',
  archetype_deltas: '{"yield_hunter":0.1}',
  confidence_before: 0.6,
  confidence_after: 0.72,
  top_archetype: 'yield_hunter',
  event_payload: '{}',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/admin/tracer/sessions/[id] — auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mockLimit.mockResolvedValue([]);
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });
    mockResolveClickHouseTracerConfig.mockReturnValue(null);
  });

  it('AC2.1: returns 401 when no Authorization header', async () => {
    mockGetAuthClaims.mockResolvedValue(null);

    const res = await GET(makeRequest(), { params: makeParams() });
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('AC2.2: returns 403 when JWT is agency-tenant (not staff)', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:owner' as const,
      estalara_staff: false as const,
      mfa_verified: true,
    });
    mockIsStaffClaims.mockReturnValue(false);

    const res = await GET(makeRequest({ bearer: 'some-jwt-token' }), { params: makeParams() });
    expect(res.status).toBe(403);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });
});

describe('GET /api/admin/tracer/sessions/[id] — param validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    mockGetAuthClaims.mockResolvedValue(null);
    mockResolveClickHouseTracerConfig.mockReturnValue(null);
  });

  it('AC2.3: returns 400 when session id is empty string', async () => {
    const res = await GET(makeRequest({ bearer: ADMIN_SECRET, sessionId: '' }), {
      params: makeParams(''),
    });
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });
});

describe('GET /api/admin/tracer/sessions/[id] — mock path (DB unconfigured)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    vi.stubEnv('DATABASE_URL_DIRECT', '');
    mockGetAuthClaims.mockResolvedValue(null);
    mockResolveClickHouseTracerConfig.mockReturnValue(null);
  });

  it('AC2.4: returns 200 with data_source: mock when DATABASE_URL_ADMIN unset', async () => {
    const res = await GET(makeRequest({ bearer: ADMIN_SECRET }), { params: makeParams() });
    expect(res.status).toBe(200);
    const body = await parseBody<TracerSessionDetailResponse>(res);
    expect(body.data_source).toBe('mock');
    expect(body.session.session_id).toBe(SESSION_ID);
    expect(Array.isArray(body.events)).toBe(true);
  });
});

describe('GET /api/admin/tracer/sessions/[id] — live path (DB configured)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
    mockGetAuthClaims.mockResolvedValue(null);
    mockLimit.mockResolvedValue([]);
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  it('AC2.5: returns 404 when DB returns no rows for session_id', async () => {
    mockLimit.mockResolvedValue([]);
    mockResolveClickHouseTracerConfig.mockReturnValue(null);

    const res = await GET(makeRequest({ bearer: ADMIN_SECRET }), { params: makeParams() });
    expect(res.status).toBe(404);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('not_found');
  });

  it('AC2.7: returns 200 data_source: clickhouse_unavailable when Postgres ok but CH unconfigured', async () => {
    mockLimit.mockResolvedValue([MOCK_SESSION_ROW]);
    mockResolveClickHouseTracerConfig.mockReturnValue(null);

    const res = await GET(makeRequest({ bearer: ADMIN_SECRET }), { params: makeParams() });
    expect(res.status).toBe(200);
    const body = await parseBody<TracerSessionDetailResponse>(res);
    expect(body.data_source).toBe('clickhouse_unavailable');
    expect(body.session.session_id).toBe(SESSION_ID);
    expect(body.session.top_archetype).toBe('yield_hunter');
    expect(body.session.confidence).toBe(0.72);
    expect(body.events).toHaveLength(0);
  });

  it('AC2.6: returns 200 data_source: live when Postgres and ClickHouse both succeed', async () => {
    mockLimit.mockResolvedValue([MOCK_SESSION_ROW]);
    mockResolveClickHouseTracerConfig.mockReturnValue({
      url: 'http://clickhouse:8123',
      user: 'default',
      password: 'pass',
      database: 'default',
    });
    mockFetchIntentEventsForSession.mockResolvedValue([MOCK_EVENT_ROW]);

    const res = await GET(makeRequest({ bearer: ADMIN_SECRET }), { params: makeParams() });
    expect(res.status).toBe(200);
    const body = await parseBody<TracerSessionDetailResponse>(res);
    expect(body.data_source).toBe('live');
    expect(body.session.session_id).toBe(SESSION_ID);
    expect(body.events).toHaveLength(1);
    expect(body.events[0]!.event_type).toBe('intent.snapshot');
  });

  it('AC2.8: returns 500 data_source: error when Postgres configured but throws (Rule K.2)', async () => {
    mockFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockRejectedValue(new Error('Postgres connection refused')),
      }),
    });
    mockSelect.mockReturnValue({ from: mockFrom });
    mockResolveClickHouseTracerConfig.mockReturnValue(null);

    const res = await GET(makeRequest({ bearer: ADMIN_SECRET }), { params: makeParams() });
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string }; data_source: string }>(res);
    expect(body.error.code).toBe('db_error');
    expect(body.data_source).toBe('error');
  });

  it('AC2.9: returns 500 data_source: error when ClickHouse configured but throws (Rule K.2)', async () => {
    mockLimit.mockResolvedValue([MOCK_SESSION_ROW]);
    mockResolveClickHouseTracerConfig.mockReturnValue({
      url: 'http://clickhouse:8123',
      user: 'default',
      password: 'pass',
      database: 'default',
    });
    mockFetchIntentEventsForSession.mockRejectedValue(new Error('ClickHouse timeout'));

    const res = await GET(makeRequest({ bearer: ADMIN_SECRET }), { params: makeParams() });
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string }; data_source: string }>(res);
    expect(body.error.code).toBe('clickhouse_error');
    expect(body.data_source).toBe('error');
  });

  it('extracts top_archetype and confidence from intentState JSONB blob', async () => {
    mockLimit.mockResolvedValue([
      {
        sessionId: SESSION_ID,
        tenantId: TENANT_ID,
        signalCount: 3,
        intentState: { topArchetype: 'family_nester', confidence: 0.88, weights: {} },
        lastEventAt: new Date('2026-01-01T00:00:00Z'),
        quizCompleted: true,
        chatTurns: 0,
      },
    ]);
    mockResolveClickHouseTracerConfig.mockReturnValue(null);

    const res = await GET(makeRequest({ bearer: ADMIN_SECRET }), { params: makeParams() });
    expect(res.status).toBe(200);
    const body = await parseBody<TracerSessionDetailResponse>(res);
    expect(body.session.top_archetype).toBe('family_nester');
    expect(body.session.confidence).toBe(0.88);
    expect(body.session.quiz_completed).toBe(true);
  });

  it('returns null for top_archetype and confidence when intentState is null', async () => {
    mockLimit.mockResolvedValue([
      {
        sessionId: SESSION_ID,
        tenantId: TENANT_ID,
        signalCount: 0,
        intentState: null,
        lastEventAt: new Date('2026-01-01T00:00:00Z'),
        quizCompleted: false,
        chatTurns: 0,
      },
    ]);
    mockResolveClickHouseTracerConfig.mockReturnValue(null);

    const res = await GET(makeRequest({ bearer: ADMIN_SECRET }), { params: makeParams() });
    expect(res.status).toBe(200);
    const body = await parseBody<TracerSessionDetailResponse>(res);
    expect(body.session.top_archetype).toBeNull();
    expect(body.session.confidence).toBeNull();
  });
});
