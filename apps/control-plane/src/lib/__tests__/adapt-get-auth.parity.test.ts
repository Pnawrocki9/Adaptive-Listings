/**
 * FOLLOW-532 (RETRO-164 §4a LG-1) — DB-throw→401 parity gate for the two GET
 * adapt call sites.
 *
 * `resolveAdaptGetAuth` (adapt-get-auth.ts) used to leave the `resolveApiKey`
 * configured-but-failed-DB throw (Rule K.2) as an UNENFORCED caller obligation:
 * both `GET /api/adapt` and `GET /api/adapt/description` owned their own
 * try/catch + `Sentry.captureException` + 401 construction, and nothing pinned
 * the two together. An edit that dropped or altered ONE route's catch would
 * silently regress that route to an unhandled 500 on a DB outage, with the
 * untouched sibling's still-green CI giving no signal of the drift.
 *
 * FOLLOW-532 folds the catch into the helper itself (a third `AdaptGetAuthResult`
 * disposition, `dbError: true`), so both call sites now share the EXACT SAME
 * branch instead of duplicating it — divergence is structurally impossible.
 * This suite pins that: it drives `resolveAdaptGetAuth` for BOTH callers
 * ('adapt' and 'description') through a forced `resolveApiKey` throw and
 * asserts they produce an IDENTICAL disposition (same status/message/dbError)
 * and an identical Sentry-capture shape (same `tags.kind`, area-scoped
 * `tags.area`). If a future edit special-cases one `area` branch differently
 * from the other, this test reds.
 *
 * @module apps/control-plane/src/lib/__tests__/adapt-get-auth.parity.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockCaptureException } = vi.hoisted(() => ({
  mockCaptureException: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: mockCaptureException,
}));

const { mockResolveApiKey } = vi.hoisted(() => ({
  mockResolveApiKey: vi.fn(),
}));

vi.mock('@/lib/api-key-auth', () => ({
  resolveApiKey: mockResolveApiKey,
}));

// resolveAdaptGetAuth's Step 1 (ops bypass) is exercised elsewhere
// (route.follow473.test.ts x2) — this suite forces a Step 2 DB throw only,
// so ADAPT_API_KEY must stay unset for both calls below.

import { resolveAdaptGetAuth, type AdaptGetAuthResult } from '@/lib/adapt-get-auth';

function makeReq(): NextRequest {
  return new NextRequest(new URL('http://localhost/api/adapt'), {
    headers: { Authorization: 'Bearer sk_live_some_key' },
  });
}

describe('resolveAdaptGetAuth — DB-throw parity across call sites (FOLLOW-532)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('ADAPT_API_KEY', '');
    vi.stubEnv('OPS_TENANT_ID', '');
  });

  it.each(['adapt', 'description'] as const)(
    'area=%s: a resolveApiKey DB throw normalizes to { ok: false, status: 401, dbError: true }',
    async (area) => {
      const dbErr = new Error('connection refused');
      mockResolveApiKey.mockRejectedValueOnce(dbErr);

      const result: AdaptGetAuthResult = await resolveAdaptGetAuth(
        makeReq(),
        'sk_live_some_key',
        area,
      );

      expect(result).toEqual({ ok: false, status: 401, message: 'Invalid API key', dbError: true });
      expect(mockCaptureException).toHaveBeenCalledTimes(1);
      expect(mockCaptureException).toHaveBeenCalledWith(
        dbErr,
        expect.objectContaining({ tags: { area, kind: 'api_key_auth_db_error' } }),
      );
    },
  );

  it('both callers produce the IDENTICAL disposition shape for the same DB failure (only tags.area differs)', async () => {
    mockResolveApiKey.mockRejectedValueOnce(new Error('adapt DB down'));
    const adaptResult = await resolveAdaptGetAuth(makeReq(), 'sk_live_some_key', 'adapt');

    mockResolveApiKey.mockRejectedValueOnce(new Error('description DB down'));
    const descriptionResult = await resolveAdaptGetAuth(
      makeReq(),
      'sk_live_some_key',
      'description',
    );

    // Strip the (deliberately area-scoped) Sentry tags.area before comparing —
    // everything else about the two dispositions MUST be identical.
    expect(adaptResult).toEqual(descriptionResult);

    const adaptTags = mockCaptureException.mock.calls[0]?.[1] as {
      tags: { area: string; kind: string };
    };
    const descriptionTags = mockCaptureException.mock.calls[1]?.[1] as {
      tags: { area: string; kind: string };
    };
    expect(adaptTags.tags.kind).toBe(descriptionTags.tags.kind);
    expect(adaptTags.tags.area).toBe('adapt');
    expect(descriptionTags.tags.area).toBe('description');
  });

  it('does NOT throw — the caller no longer needs a try/catch around this call', async () => {
    mockResolveApiKey.mockRejectedValueOnce(new Error('boom'));
    await expect(resolveAdaptGetAuth(makeReq(), 'sk_live_some_key', 'adapt')).resolves.toEqual(
      expect.objectContaining({ ok: false, dbError: true }),
    );
  });
});
