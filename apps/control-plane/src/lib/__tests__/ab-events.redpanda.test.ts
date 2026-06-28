/**
 * FOLLOW-426: fail-loud tests for publishAbAssignmentEvent.
 *
 * Verifies that an HTTP-level rejection from the Redpanda REST proxy (non-ok
 * response: 4xx/5xx, auth failure, missing topic, quota) is captured to Sentry —
 * NOT silently swallowed. Before FOLLOW-426, publishAbAssignmentEvent used a bare
 * `await fetch()` with no `res.ok` check; `fetch` resolves on 4xx/5xx so a bare
 * `.catch()` at the call site is completely blind to these failures.
 *
 * Three tests per AC-3:
 *   (a) non-ok HTTP response → Sentry captured with kind='insert_rejected'
 *   (b) network / thrown error → Sentry captured with kind='network'
 *   (c) happy path (ok response) → Sentry NOT called, caller unaffected
 *
 * @module apps/control-plane/src/lib/__tests__/ab-events.redpanda.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ─── Sentry mock (must be hoisted before the module import) ──────────────────
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import * as Sentry from '@sentry/nextjs';
import { publishAbAssignmentEvent } from '../ab-events';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_ARGS = {
  session_id: 'sess-follow426-test-001',
  tenant_id: '550e8400-e29b-41d4-a716-446655440001',
  holdout_group: false,
  holdout_pct: 0.1,
  assigned_at: '2026-06-28T00:00:00.000Z',
};

const REDPANDA_URL = 'https://redpanda.test';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('publishAbAssignmentEvent — FOLLOW-426 fail loud on Redpanda HTTP rejection', () => {
  let captureException: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    captureException = vi.mocked(Sentry.captureException);
    captureException.mockReset();
    vi.stubEnv('REDPANDA_REST_URL', REDPANDA_URL);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('FOLLOW-426 (a): non-ok HTTP response → captureException called with kind=insert_rejected, function does not throw', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Authentication failed. Invalid credentials.'),
      }),
    );

    // Must not throw — fire-and-forget guarantee preserved (synchronous return)
    expect(() => { publishAbAssignmentEvent(VALID_ARGS); }).not.toThrow();

    // Allow the fire-and-forget .then() microtask chain to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(captureException).toHaveBeenCalledOnce();
    const [capturedErr, capturedCtx] = captureException.mock.calls[0] as [
      Error,
      { tags: Record<string, string>; extra: Record<string, unknown> },
    ];
    expect(capturedErr).toBeInstanceOf(Error);
    expect(capturedErr.message).toContain('401');
    expect(capturedErr.message).toContain('Authentication failed');
    expect(capturedCtx.tags.kind).toBe('insert_rejected');
    expect(capturedCtx.tags.sink).toBe('redpanda');
    expect(capturedCtx.tags.area).toBe('adapt');
    expect(capturedCtx.extra.status).toBe(401);
  });

  it('FOLLOW-426 (b): network-level rejection → captureException called with kind=network', async () => {
    const networkErr = new Error('connect ECONNREFUSED redpanda.test:443');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkErr));

    expect(() => { publishAbAssignmentEvent(VALID_ARGS); }).not.toThrow();

    await new Promise((r) => setTimeout(r, 10));

    expect(captureException).toHaveBeenCalledOnce();
    const [capturedErr, capturedCtx] = captureException.mock.calls[0] as [
      Error,
      { tags: Record<string, string> },
    ];
    expect(capturedErr).toBeInstanceOf(Error);
    expect(capturedErr.message).toContain('ECONNREFUSED');
    expect(capturedCtx.tags.kind).toBe('network');
    expect(capturedCtx.tags.sink).toBe('redpanda');
    expect(capturedCtx.tags.area).toBe('adapt');
  });

  it('FOLLOW-426 (c): successful HTTP 200 → captureException NOT called, caller unaffected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    publishAbAssignmentEvent(VALID_ARGS);
    await new Promise((r) => setTimeout(r, 10));

    expect(captureException).not.toHaveBeenCalled();
  });

  it('FOLLOW-426: no-op when REDPANDA_REST_URL is unset — no fetch, no Sentry', async () => {
    vi.stubEnv('REDPANDA_REST_URL', '');
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    publishAbAssignmentEvent(VALID_ARGS);
    await new Promise((r) => setTimeout(r, 10));

    expect(mockFetch).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });
});
