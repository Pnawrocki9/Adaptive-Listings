import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  demoSessions: {
    id: 'id',
    tenantId: 'tenant_id',
    scope: 'scope',
    visibility: 'visibility',
    duration: 'duration',
    tokenHash: 'token_hash',
    shareableLink: 'shareable_link',
    createdBy: 'created_by',
    expiresAt: 'expires_at',
    productionDomain: 'production_domain',
    revokedAt: 'revoked_at',
    createdAt: 'created_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b })),
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  gt: vi.fn((a: unknown, b: unknown) => ({ op: 'gt', a, b })),
  desc: vi.fn((a: unknown) => ({ op: 'desc', a })),
  or: vi.fn((...args: unknown[]) => ({ op: 'or', args })),
  isNull: vi.fn((a: unknown) => ({ op: 'isNull', a })),
}));

vi.mock('@estalara/auth', () => ({
  requireTenantAccess: vi.fn(),
}));

import { createAdminClient } from '@estalara/db';
import { requireTenantAccess } from '@estalara/auth';

import { GET, POST } from './route';

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440099';

const TENANT_CLAIMS = {
  sub: 'user-001',
  email: 'user@example.com',
  tenant_id: TENANT_ID,
  agency_role: 'agency:viewer' as const,
  estalara_staff: false as const,
  mfa_verified: false,
};

const VALID_BODY = {
  scope: 'mockup',
  visibility: 'self',
  duration: 'session',
} as const;

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/demo/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test_token',
    },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(): NextRequest {
  return new NextRequest('http://localhost/api/demo/sessions', {
    headers: { Authorization: 'Bearer test_token' },
  });
}

function makeInsertDbMock() {
  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    }),
  };
}

function makeSelectDbMock(rows: unknown[] = []) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue(rows),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/demo/sessions', () => {
  it('valid body → 201 with token and session_id', async () => {
    vi.mocked(requireTenantAccess).mockResolvedValue(TENANT_CLAIMS);
    vi.mocked(createAdminClient).mockReturnValue(makeInsertDbMock());
    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(201);
    const body = await parseBody<{ session_id: string; token: string; expires_at: string }>(res);
    expect(typeof body.session_id).toBe('string');
    expect(typeof body.token).toBe('string');
    expect(body.token.split('.')).toHaveLength(3);
    expect(typeof body.expires_at).toBe('string');
  });

  it('missing/invalid JWT → 401', async () => {
    vi.mocked(requireTenantAccess).mockRejectedValue(
      new Error('Unauthorized: no valid authentication token'),
    );
    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('scope=production without production_domain → 400', async () => {
    vi.mocked(requireTenantAccess).mockResolvedValue(TENANT_CLAIMS);
    const res = await POST(
      makePostRequest({ scope: 'production', visibility: 'self', duration: 'session' }),
    );
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string; message: string } }>(res);
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.message).toContain('production_domain');
  });

  it('scope=production with domain → 201', async () => {
    vi.mocked(requireTenantAccess).mockResolvedValue(TENANT_CLAIMS);
    vi.mocked(createAdminClient).mockReturnValue(makeInsertDbMock());
    const res = await POST(
      makePostRequest({
        scope: 'production',
        visibility: 'self',
        duration: '24h',
        production_domain: 'listings.example.com',
      }),
    );
    expect(res.status).toBe(201);
  });
});

describe('GET /api/demo/sessions', () => {
  it('valid JWT → 200 with sessions array', async () => {
    vi.mocked(requireTenantAccess).mockResolvedValue(TENANT_CLAIMS);
    vi.mocked(createAdminClient).mockReturnValue(makeSelectDbMock([]));
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await parseBody<{ tenant_id: string; sessions: unknown[] }>(res);
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(Array.isArray(body.sessions)).toBe(true);
  });

  it('missing/invalid JWT → 401', async () => {
    vi.mocked(requireTenantAccess).mockRejectedValue(
      new Error('Unauthorized: no valid authentication token'),
    );
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });
});
