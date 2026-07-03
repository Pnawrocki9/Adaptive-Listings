/**
 * Tests for publishListingEmbeddingSeed — ADR-0016 / FOLLOW-485 direct Modal dispatch.
 *
 * Coverage:
 *   - MODAL_EMBED_SEED_URL unset → no-op (no fetch call, no Sentry capture)
 *   - Happy path → POST to MODAL_EMBED_SEED_URL with Authorization: Bearer
 *     INTERNAL_API_SECRET, raw event JSON body (no Redpanda `records` envelope)
 *   - Non-2xx response → captureException with kind=dispatch_failed, sink=modal
 *   - Network-level rejection → captureException with kind=dispatch_failed, sink=modal
 *   - Never throws (fire-and-forget contract preserved)
 *
 * @module apps/control-plane/src/lib/__tests__/listing-embed-seed-publisher.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

import * as Sentry from '@sentry/nextjs';
import { publishListingEmbeddingSeed } from '../listing-embed-seed-publisher';
import type { ListingEmbeddingSeedRequestedEvent } from '@estalara/shared';

const EVENT: ListingEmbeddingSeedRequestedEvent = {
  tenant_id: '550e8400-e29b-41d4-a716-446655440000',
  listing_ids: ['prop-051', 'prop-052'],
};

describe('publishListingEmbeddingSeed — ADR-0016 direct Modal dispatch', () => {
  let captureException: ReturnType<typeof vi.fn>;
  let addBreadcrumb: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    captureException = vi.mocked(Sentry.captureException);
    addBreadcrumb = vi.mocked(Sentry.addBreadcrumb);
    captureException.mockReset();
    addBreadcrumb.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('MODAL_EMBED_SEED_URL unset → no-op: no fetch call, no Sentry capture, resolves', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    await expect(publishListingEmbeddingSeed(EVENT)).resolves.toBeUndefined();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
    expect(addBreadcrumb).toHaveBeenCalledOnce();
  });

  it('happy path: POSTs raw event JSON to MODAL_EMBED_SEED_URL with Bearer auth', async () => {
    vi.stubEnv('MODAL_EMBED_SEED_URL', 'https://estalara--embed-seed-consumer.modal.run');
    vi.stubEnv('INTERNAL_API_SECRET', 'test-internal-secret');
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal('fetch', mockFetch);

    await publishListingEmbeddingSeed(EVENT);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://estalara--embed-seed-consumer.modal.run');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-internal-secret');
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty('records');
    expect(body.tenant_id).toBe(EVENT.tenant_id);
    expect(body.listing_ids).toEqual(EVENT.listing_ids);

    expect(captureException).not.toHaveBeenCalled();
  });

  it('non-2xx response → captureException with kind=dispatch_failed, sink=modal; never throws', async () => {
    vi.stubEnv('MODAL_EMBED_SEED_URL', 'https://estalara--embed-seed-consumer.modal.run');
    vi.stubEnv('INTERNAL_API_SECRET', 'test-internal-secret');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized.'),
      }),
    );

    await expect(publishListingEmbeddingSeed(EVENT)).resolves.toBeUndefined();

    expect(captureException).toHaveBeenCalledOnce();
    const [capturedErr, capturedCtx] = captureException.mock.calls[0] as [
      Error,
      { tags: Record<string, string>; extra: Record<string, unknown> },
    ];
    expect(capturedErr.message).toContain('401');
    expect(capturedCtx.tags.kind).toBe('dispatch_failed');
    expect(capturedCtx.tags.sink).toBe('modal');
    expect(capturedCtx.tags.area).toBe('onboarding');
    expect(capturedCtx.extra.tenant_id).toBe(EVENT.tenant_id);
    expect(capturedCtx.extra.listing_count).toBe(EVENT.listing_ids.length);
  });

  it('network-level rejection → captureException with kind=dispatch_failed, sink=modal; never throws', async () => {
    vi.stubEnv('MODAL_EMBED_SEED_URL', 'https://estalara--embed-seed-consumer.modal.run');
    vi.stubEnv('INTERNAL_API_SECRET', 'test-internal-secret');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')));

    await expect(publishListingEmbeddingSeed(EVENT)).resolves.toBeUndefined();

    expect(captureException).toHaveBeenCalledOnce();
    const [capturedErr, capturedCtx] = captureException.mock.calls[0] as [
      Error,
      { tags: Record<string, string> },
    ];
    expect(capturedErr.message).toContain('ECONNREFUSED');
    expect(capturedCtx.tags.kind).toBe('dispatch_failed');
    expect(capturedCtx.tags.sink).toBe('modal');
  });
});
