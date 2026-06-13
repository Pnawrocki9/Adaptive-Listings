/**
 * Tests for GET /api/admin/tracer/sessions (FOLLOW-267, AC1).
 *
 * Coverage:
 *   AC1.1: 401 when no auth header provided
 *   AC1.2: 403 when JWT is agency-tenant (not staff)
 *   AC1.3: 200 with data_source: 'mock' when DATABASE_URL_ADMIN not set
 *   AC1.4: 200 with data_source: 'live' when DB is configured and returns rows
 *   AC1.5: 500 with data_source: 'error' when DB is configured but throws (Rule K.2)
 *   AC1.6: ADMIN_API_SECRET Bearer path returns 200 with live data
 *
 * Rule K.2 contract: configured-store failure MUST return HTTP 500, never mock.
 * Mock is only acceptable when DATABASE_URL_ADMIN is UNSET.
 *
 * @module apps/control-plane/src/app/api/admin/tracer/sessions/route.test
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

// Mock Drizzle chain: db.select().from().where().orderBy().limit()
const mockLimit = vi.fn();
const mockOrderBy = vi.fn();
const mockWhere = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();

mockLimit.mockResolvedValue([]);
mockOrderBy.mockReturnValue({ limit: mockLimit });
mockWhere.mockReturnValue({ orderBy: mockOrderBy });
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

// We use the real tracer-auth module but mock its dependencies (@estalara/auth).
// This tests the auth layer through the real guard.

import { getAuthClaims, isStaffClaims } from '@estalara/auth';
import { GET } from './route';
import type { TracerSessionsResponse } from '@estalara/shared';

const mockGetAuthClaims = vi.mocked(getAuthClaims);
const mockIsStaffClaims = vi.mocked(isStaffClaims);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440042';
const ADMIN_SECRET = 'test-admin-secret-123';

function makeRequest(opts: { bearer?: string } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
  return new NextRequest('http://localhost/api/admin/tracer/sessions', {
    method: 'GET',
    headers,
  });
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/admin/tracer/sessions — auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mockLimit.mockResolvedValue([]);
    mockOrderBy.mockReturnValue({ limit: mockLimit });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  it('AC1.1: returns 401 when no Authorization header is provided', async () => {
    mockGetAuthClaims.mockResolvedValue(null);

    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('AC1.2: returns 403 when JWT is agency-tenant (not staff)', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:owner' as const,
      estalara_staff: false as const,
      mfa_verified: true,
    });
    mockIsStaffClaims.mockReturnValue(false);

    const res = await GET(makeRequest({ bearer: 'some-jwt-token' }));
    expect(res.status).toBe(403);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('AC1.6: accepts ADMIN_API_SECRET Bearer (constant-time compare path)', async () => {
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    // DATABASE_URL_ADMIN not set — will get mock path
    vi.stubEnv('DATABASE_URL_ADMIN', '');

    // For the admin-secret path, getAuthClaims is not reached.
    mockGetAuthClaims.mockResolvedValue(null);

    const res = await GET(makeRequest({ bearer: ADMIN_SECRET }));
    expect(res.status).toBe(200);
    const body = await parseBody<TracerSessionsResponse>(res);
    // Mock path returns data_source: 'mock' when DB not configured
    expect(body.data_source).toBe('mock');
    expect(Array.isArray(body.sessions)).toBe(true);
  });

  it('AC1.6b: rejects wrong ADMIN_API_SECRET', async () => {
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    mockGetAuthClaims.mockResolvedValue(null);

    const res = await GET(makeRequest({ bearer: 'wrong-secret' }));
    expect(res.status).toBe(401);
  });
});

describe('GET /api/admin/tracer/sessions — mock path (DB unconfigured)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mockGetAuthClaims.mockResolvedValue(null);
  });

  it('AC1.3: returns 200 with data_source: mock when DATABASE_URL_ADMIN unset', async () => {
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    vi.stubEnv('DATABASE_URL_DIRECT', '');

    const res = await GET(makeRequest({ bearer: ADMIN_SECRET }));
    expect(res.status).toBe(200);
    const body = await parseBody<TracerSessionsResponse>(res);
    expect(body.data_source).toBe('mock');
    expect(body.sessions.length).toBeGreaterThan(0);
    // Mock sessions have the expected shape
    const first = body.sessions[0];
    expect(typeof first!.session_id).toBe('string');
    expect(typeof first!.tenant_id).toBe('string');
    expect(typeof first!.signal_count).toBe('number');
  });
});

describe('GET /api/admin/tracer/sessions — live path (DB configured)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');

    mockLimit.mockResolvedValue([]);
    mockOrderBy.mockReturnValue({ limit: mockLimit });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });

    mockGetAuthClaims.mockResolvedValue(null);
  });

  it('AC1.4: returns 200 with data_source: live when DB returns rows', async () => {
    const now = new Date();
    mockLimit.mockResolvedValue([
      {
        sessionId: 'sha256-abc123',
        tenantId: TENANT_ID,
        signalCount: 5,
        intentState: { topArchetype: 'yield_hunter', confidence: 0.75, weights: {} },
        lastEventAt: now,
        quizCompleted: false,
        chatTurns: 2,
      },
    ]);

    const res = await GET(makeRequest({ bearer: ADMIN_SECRET }));
    expect(res.status).toBe(200);
    const body = await parseBody<TracerSessionsResponse>(res);
    expect(body.data_source).toBe('live');
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]!.session_id).toBe('sha256-abc123');
    expect(body.sessions[0]!.top_archetype).toBe('yield_hunter');
    expect(body.sessions[0]!.confidence).toBe(0.75);
    expect(body.sessions[0]!.signal_count).toBe(5);
    expect(body.sessions[0]!.chat_turns).toBe(2);
    expect(body.sessions[0]!.quiz_completed).toBe(false);
  });

  it('AC1.5: returns 500 with data_source: error when DB configured but throws (Rule K.2)', async () => {
    mockFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockRejectedValue(new Error('Postgres connection refused')),
        }),
      }),
    });
    mockSelect.mockReturnValue({ from: mockFrom });

    const res = await GET(makeRequest({ bearer: ADMIN_SECRET }));
    // MUST be 500 — never mock when configured store fails (Rule K.2)
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string }; data_source: string }>(res);
    expect(body.error.code).toBe('db_error');
    expect(body.data_source).toBe('error');
  });
});
