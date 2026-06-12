/**
 * Tests for GET /api/intent/config (FOLLOW-267, AC8).
 *
 * Coverage:
 *   AC8.1: 200 with Cache-Control: public, max-age=300 (CDN cache strategy)
 *   AC8.2: 200 with data_source: 'mock' when DATABASE_URL_ADMIN not set
 *   AC8.3: 400 when tenant_id is missing or invalid UUID
 *   AC8.4: Tenant-specific row takes priority over global (null tenant_id) row
 *   AC8.5: Falls back to global row when no tenant-specific row exists
 *   AC8.6: Returns default weights with data_source: 'mock' when no active row found
 *   AC8.7: 500 (never mock) when DB configured but throws (Rule K.2)
 *   AC8.8: No auth required (public endpoint — ADR-0011 pattern)
 *
 * @module apps/control-plane/src/app/api/intent/config/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ─── Mock modules ─────────────────────────────────────────────────────────────

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

// Mock Drizzle chain: db.select().from().where().limit()
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
  intentWeightConfigs: {
    id: 'id',
    tenantId: 'tenant_id',
    weights: 'weights',
    createdAt: 'created_at',
    isActive: 'is_active',
  },
}));

import { GET } from './route';
import type { IntentConfigResponse } from '@estalara/shared';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440042';
const GLOBAL_WEIGHTS = {
  signal_weights: { quiz_answer: 2.0, behavioral: 0.8 },
  priors: { neutral: 1.0 },
  behavioral_damping: 0.85,
};
const TENANT_WEIGHTS = {
  signal_weights: { quiz_answer: 3.0, behavioral: 1.2 },
  priors: { yield_hunter: 1.5, neutral: 0.5 },
  behavioral_damping: 0.9,
};

function makeRequest(tenantId?: string): NextRequest {
  const url = tenantId
    ? `http://localhost/api/intent/config?tenant_id=${tenantId}`
    : 'http://localhost/api/intent/config';
  return new NextRequest(url, { method: 'GET' });
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/intent/config — validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('AC8.3: returns 400 when tenant_id is missing', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });

  it('AC8.3: returns 400 when tenant_id is not a UUID', async () => {
    const res = await GET(makeRequest('not-a-uuid'));
    expect(res.status).toBe(400);
  });

  it('AC8.8: no auth required — request without Authorization header succeeds', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    vi.stubEnv('DATABASE_URL_DIRECT', '');

    const res = await GET(makeRequest(TENANT_ID));
    // No auth → still returns 200 (public endpoint)
    expect(res.status).toBe(200);
  });
});

describe('GET /api/intent/config — mock path (DB unconfigured)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    vi.stubEnv('DATABASE_URL_DIRECT', '');
  });

  it('AC8.1: returns Cache-Control: public, max-age=300', async () => {
    const res = await GET(makeRequest(TENANT_ID));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('max-age=300');
    expect(res.headers.get('Cache-Control')).toContain('public');
  });

  it('AC8.2: returns data_source: mock when DATABASE_URL_ADMIN not set', async () => {
    const res = await GET(makeRequest(TENANT_ID));
    expect(res.status).toBe(200);
    const body = await parseBody<IntentConfigResponse>(res);
    expect(body.data_source).toBe('mock');
    expect(typeof body.weights).toBe('object');
    expect(typeof body.effective_at).toBe('string');
    expect(typeof body.is_tenant_specific).toBe('boolean');
  });
});

describe('GET /api/intent/config — live path (DB configured)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');

    mockLimit.mockResolvedValue([]);
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  it('AC8.4: tenant-specific row takes priority over global null-tenant row', async () => {
    const now = new Date('2026-06-13T10:00:00.000Z');
    // Return both rows — tenant-specific first.
    mockLimit.mockResolvedValue([
      { id: 'cfg-1', tenantId: TENANT_ID, weights: TENANT_WEIGHTS, createdAt: now, isActive: true },
      { id: 'cfg-2', tenantId: null, weights: GLOBAL_WEIGHTS, createdAt: now, isActive: true },
    ]);

    const res = await GET(makeRequest(TENANT_ID));
    expect(res.status).toBe(200);
    const body = await parseBody<IntentConfigResponse>(res);
    expect(body.data_source).toBe('live');
    expect(body.is_tenant_specific).toBe(true);
    // Weights should be the tenant-specific config
    const sw = body.weights as { signal_weights: { quiz_answer: number } };
    expect(sw.signal_weights.quiz_answer).toBe(3.0);
    expect(res.headers.get('Cache-Control')).toContain('max-age=300');
  });

  it('AC8.5: falls back to global row when no tenant-specific row exists', async () => {
    const now = new Date('2026-06-13T09:00:00.000Z');
    // Only global row returned.
    mockLimit.mockResolvedValue([
      { id: 'cfg-global', tenantId: null, weights: GLOBAL_WEIGHTS, createdAt: now, isActive: true },
    ]);

    const res = await GET(makeRequest(TENANT_ID));
    expect(res.status).toBe(200);
    const body = await parseBody<IntentConfigResponse>(res);
    expect(body.data_source).toBe('live');
    expect(body.is_tenant_specific).toBe(false);
    const sw = body.weights as { signal_weights: { quiz_answer: number } };
    expect(sw.signal_weights.quiz_answer).toBe(2.0);
  });

  it('AC8.6: returns default weights with data_source: mock when no active row found', async () => {
    mockLimit.mockResolvedValue([]); // No active configs at all.

    const res = await GET(makeRequest(TENANT_ID));
    expect(res.status).toBe(200);
    const body = await parseBody<IntentConfigResponse>(res);
    // When no active row, falls back to defaults with data_source: 'mock'
    expect(body.data_source).toBe('mock');
    expect(typeof body.weights).toBe('object');
    expect(res.headers.get('Cache-Control')).toContain('max-age=300');
  });

  it('AC8.7: returns 500 (never mock) when DB configured but throws (Rule K.2)', async () => {
    mockFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockRejectedValue(new Error('DB connection timeout')),
      }),
    });
    mockSelect.mockReturnValue({ from: mockFrom });

    const res = await GET(makeRequest(TENANT_ID));
    // MUST be 500 — never silently return mock when configured DB fails (Rule K.2)
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string }; data_source: string }>(res);
    expect(body.error.code).toBe('db_error');
    expect(body.data_source).toBe('error');
    // Must NOT return weights (that would be fabricated data)
    expect('weights' in body).toBe(false);
  });
});
