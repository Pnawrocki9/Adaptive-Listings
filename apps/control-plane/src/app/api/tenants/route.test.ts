/**
 * Tests for POST /api/tenants — tenant creation + bandit weight seeding.
 * TICKET-AB-006
 *
 * DATABASE_URL_ADMIN is not set in CI — route returns a mock response
 * with { mock: true }. seedBanditWeightsForTenant() is tested separately
 * via the bandit-seed.test.ts unit tests.
 *
 * @module apps/control-plane/src/app/api/tenants/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock @estalara/db so tests run without a real database connection.
vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => ({
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([
      {
        id: '00000000-0000-0000-0000-000000000001',
        slug: 'test-agency',
        name: 'Test Agency',
        plan: 'free',
      },
    ]),
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
  })),
  tenants: { id: 'id', slug: 'slug', name: 'name', plan: 'plan' },
  abBanditWeights: { tenantId: 'tenant_id', archetype: 'archetype' },
}));

// Mock bandit-seed to avoid its own DB calls in these integration tests.
vi.mock('@/lib/bandit-seed', () => ({
  seedBanditWeightsForTenant: vi.fn().mockResolvedValue(undefined),
  CANONICAL_ARCHETYPES: [
    'yield_hunter',
    'vacation_rental_investor',
    'flip_investor',
    'portfolio_builder',
    'golden_visa_buyer',
    'commercial_investor',
    'family_buyer',
    'first_time_buyer',
    'upsizer',
    'downsizer',
    'luxury_buyer',
    'remote_worker',
    'lifestyle_expat',
    'retiree_relocator',
    'diaspora_buyer',
    'second_home_buyer',
    'student_parent',
    'neutral',
  ],
  CANONICAL_ARCHETYPE_COUNT: 18,
}));

import { seedBanditWeightsForTenant } from '@/lib/bandit-seed';
const mockSeedBandit = vi.mocked(seedBanditWeightsForTenant);

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makePostRequest(body: Record<string, unknown>, adminSecret?: string): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (adminSecret !== undefined) {
    headers['x-admin-secret'] = adminSecret;
  }
  return new NextRequest('http://localhost/api/tenants', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

const VALID_BODY = {
  name: 'Test Agency',
  slug: 'test-agency',
  plan: 'free',
};

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/tenants — no DB in CI (mock path)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 201 with tenant data when no DATABASE_URL_ADMIN is set', async () => {
    // CI has no admin DB — route returns { mock: true }
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    vi.stubEnv('DATABASE_URL_DIRECT', '');

    const { POST } = await import('./route.js');
    const res = await POST(makePostRequest(VALID_BODY));

    expect(res.status).toBe(201);
    const body = await parseBody<{
      id: string;
      slug: string;
      name: string;
      plan: string;
      mock: boolean;
    }>(res);
    expect(body.id).toBeTruthy();
    expect(body.slug).toBe('test-agency');
    expect(body.mock).toBe(true);
  });

  it('returns 400 for invalid slug (uppercase)', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', '');

    const { POST } = await import('./route.js');
    const res = await POST(makePostRequest({ ...VALID_BODY, slug: 'Test-Agency' }));

    expect(res.status).toBe(400);
  });

  it('returns 400 when name is too short', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', '');

    const { POST } = await import('./route.js');
    const res = await POST(makePostRequest({ ...VALID_BODY, name: 'X' }));

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid plan', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', '');

    const { POST } = await import('./route.js');
    const res = await POST(makePostRequest({ ...VALID_BODY, plan: 'gold' }));

    expect(res.status).toBe(400);
  });

  it('returns 401 when ADMIN_API_SECRET is set and header is missing', async () => {
    vi.stubEnv('ADMIN_API_SECRET', 'super-secret');

    const { POST } = await import('./route.js');
    const res = await POST(makePostRequest(VALID_BODY));

    expect(res.status).toBe(401);
  });

  it('returns 401 when wrong admin secret is provided', async () => {
    vi.stubEnv('ADMIN_API_SECRET', 'super-secret');

    const { POST } = await import('./route.js');
    const res = await POST(makePostRequest(VALID_BODY, 'wrong-secret'));

    expect(res.status).toBe(401);
  });

  it('returns 201 when correct admin secret is provided', async () => {
    vi.stubEnv('ADMIN_API_SECRET', 'super-secret');
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    vi.stubEnv('DATABASE_URL_DIRECT', '');

    const { POST } = await import('./route.js');
    const res = await POST(makePostRequest(VALID_BODY, 'super-secret'));

    expect(res.status).toBe(201);
  });
});

describe('POST /api/tenants — with DB configured', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('calls seedBanditWeightsForTenant after successful tenant insert', async () => {
    const { POST } = await import('./route.js');
    const res = await POST(makePostRequest(VALID_BODY));

    expect(res.status).toBe(201);
    expect(mockSeedBandit).toHaveBeenCalledOnce();
    expect(mockSeedBandit).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001');
  });

  it('returns 201 even if seedBanditWeightsForTenant throws (fire-and-forget)', async () => {
    mockSeedBandit.mockRejectedValueOnce(new Error('DB connection refused'));

    const { POST } = await import('./route.js');
    const res = await POST(makePostRequest(VALID_BODY));

    // Seeding failure must not surface as a 500
    expect(res.status).toBe(201);
  });

  it('response contains id, slug, name, plan', async () => {
    const { POST } = await import('./route.js');
    const res = await POST(makePostRequest(VALID_BODY));

    expect(res.status).toBe(201);
    const body = await parseBody<Record<string, unknown>>(res);
    expect(typeof body.id).toBe('string');
    expect(body.slug).toBe('test-agency');
    expect(body.name).toBe('Test Agency');
    expect(body.plan).toBe('free');
    // mock: true should NOT appear in production DB path
    expect(body.mock).toBeUndefined();
  });
});
