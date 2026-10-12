/**
 * FOLLOW-1297 (G-06) — `POST /api/internal/listings/embed-seed`: fail-closed auth, body
 * validation (incl. the additive `requeue_depth` / `retry_listing_ids`), 202 + the hop in after().
 */
vi.mock('next/server', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('next/server');
  return {
    ...actual,
    after: vi.fn((fn: () => unknown) => {
      void fn();
    }),
  };
});

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockHop } = vi.hoisted(() => ({ mockHop: vi.fn() }));
vi.mock('@/lib/seed-listing-embeddings', () => ({ runEmbedSeedHop: mockHop }));

import { POST } from './route';

const SECRET = 'test-internal-secret';
const TENANT = '00000000-0000-4000-8000-000000001297';

function post(body: unknown, token: string | null = SECRET): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return new NextRequest('http://localhost/api/internal/listings/embed-seed', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/internal/listings/embed-seed', () => {
  beforeEach(() => {
    vi.stubEnv('INTERNAL_API_SECRET', SECRET);
    mockHop
      .mockReset()
      .mockResolvedValue({ succeeded: 1, failed: [], remaining: 0, requeued: false });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('401 without a token, with the wrong token, and when the secret is unset (fail-closed)', async () => {
    expect((await POST(post({ tenant_id: TENANT, listing_ids: ['a'] }, null))).status).toBe(401);
    expect((await POST(post({ tenant_id: TENANT, listing_ids: ['a'] }, 'wrong'))).status).toBe(401);
    vi.stubEnv('INTERNAL_API_SECRET', '');
    expect((await POST(post({ tenant_id: TENANT, listing_ids: ['a'] }))).status).toBe(401);
    expect(mockHop).not.toHaveBeenCalled();
  });

  it('400 on invalid JSON, an empty listing list and a requeue_depth over 20', async () => {
    expect((await POST(post('{not json'))).status).toBe(400);
    expect((await POST(post({ tenant_id: TENANT, listing_ids: [] }))).status).toBe(400);
    expect(
      (await POST(post({ tenant_id: TENANT, listing_ids: ['a'], requeue_depth: 21 }))).status,
    ).toBe(400);
    expect(mockHop).not.toHaveBeenCalled();
  });

  it('202 and runs the hop in after() with the depth and the retry set', async () => {
    const res = await POST(
      post({
        tenant_id: TENANT,
        listing_ids: ['a', 'b', 'c'],
        requeue_depth: 3,
        retry_listing_ids: ['b'],
      }),
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true, requeue_depth: 3, listing_count: 3 });
    await new Promise((r) => setTimeout(r, 0));
    expect(mockHop).toHaveBeenCalledOnce();
    const input = mockHop.mock.calls[0]![0] as {
      tenantId: string;
      listings: { listing_id: string }[];
      retryIds: Set<string>;
      requeueDepth: number;
    };
    expect(input.tenantId).toBe(TENANT);
    expect(input.listings.map((l) => l.listing_id)).toEqual(['a', 'b', 'c']);
    expect([...input.retryIds]).toEqual(['b']);
    expect(input.requeueDepth).toBe(3);
  });

  it('requeue_depth absent ⇒ 0', async () => {
    const res = await POST(post({ tenant_id: TENANT, listing_ids: ['a'] }));
    expect(await res.json()).toMatchObject({ requeue_depth: 0 });
  });
});
