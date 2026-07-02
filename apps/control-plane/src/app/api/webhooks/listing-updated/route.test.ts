/**
 * Tests for POST /api/webhooks/listing-updated — FOLLOW-456 / audit F-13.
 *
 * Coverage:
 *   - 401 when LISTING_UPDATED_WEBHOOK_SECRET is unset (fail-closed — previously
 *     an unset secret skipped auth entirely).
 *   - 401 when the secret is set but the header is missing/wrong.
 *   - 200 when the secret is set and the header matches (constant-time compare).
 *   - 400 on invalid body.
 *   - 500 when Postgres cache invalidation throws (fail-loud).
 *
 * @module apps/control-plane/src/app/api/webhooks/listing-updated/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { mockInvalidateDescriptionCache, mockInvalidatePgDescriptionCache } = vi.hoisted(() => ({
  mockInvalidateDescriptionCache: vi.fn(),
  mockInvalidatePgDescriptionCache: vi.fn(),
}));

vi.mock('@/lib/description-cache', () => ({
  invalidateDescriptionCache: mockInvalidateDescriptionCache,
}));

vi.mock('@/lib/description-pg-cache', () => ({
  invalidatePgDescriptionCache: mockInvalidatePgDescriptionCache,
}));

import { POST } from './route';

const WEBHOOK_SECRET = 'test-webhook-secret-xyz';
const TENANT_ID = '550e8400-e29b-41d4-a716-446655440042';

function makeRequest(opts: { secretHeader?: string; body?: unknown } = {}): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.secretHeader !== undefined) {
    headers['X-Webhook-Secret'] = opts.secretHeader;
  }
  return new NextRequest('http://localhost/api/webhooks/listing-updated', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body ?? { tenant_id: TENANT_ID, listing_id: 'listing-1' }),
  });
}

async function parseBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mockInvalidateDescriptionCache.mockResolvedValue(undefined);
  mockInvalidatePgDescriptionCache.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/webhooks/listing-updated — auth (fail-closed)', () => {
  it('returns 401 when LISTING_UPDATED_WEBHOOK_SECRET is unset, even with no header', async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(mockInvalidatePgDescriptionCache).not.toHaveBeenCalled();
  });

  it('returns 401 when LISTING_UPDATED_WEBHOOK_SECRET is unset, even if a header is sent', async () => {
    const res = await POST(makeRequest({ secretHeader: 'anything' }));
    expect(res.status).toBe(401);
  });

  it('returns 401 when secret is set and header is missing', async () => {
    vi.stubEnv('LISTING_UPDATED_WEBHOOK_SECRET', WEBHOOK_SECRET);
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 401 when secret is set and header is wrong', async () => {
    vi.stubEnv('LISTING_UPDATED_WEBHOOK_SECRET', WEBHOOK_SECRET);
    const res = await POST(makeRequest({ secretHeader: 'wrong-secret' }));
    expect(res.status).toBe(401);
  });

  it('returns 200 when secret matches', async () => {
    vi.stubEnv('LISTING_UPDATED_WEBHOOK_SECRET', WEBHOOK_SECRET);
    const res = await POST(makeRequest({ secretHeader: WEBHOOK_SECRET }));
    expect(res.status).toBe(200);
    const body = await parseBody<{ invalidated: boolean }>(res);
    expect(body.invalidated).toBe(true);
  });
});

describe('POST /api/webhooks/listing-updated — validation + fail-loud', () => {
  beforeEach(() => {
    vi.stubEnv('LISTING_UPDATED_WEBHOOK_SECRET', WEBHOOK_SECRET);
  });

  it('returns 400 on invalid body (missing listing_id)', async () => {
    const res = await POST(
      makeRequest({ secretHeader: WEBHOOK_SECRET, body: { tenant_id: TENANT_ID } }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 500 when Postgres invalidation throws (Rule K.2 fail-loud)', async () => {
    mockInvalidatePgDescriptionCache.mockRejectedValue(new Error('DB connection refused'));
    const res = await POST(makeRequest({ secretHeader: WEBHOOK_SECRET }));
    expect(res.status).toBe(500);
  });
});
