/**
 * FOLLOW-428: fail-loud tests for writeDsrAuditLog.
 *
 * Verifies that a non-2xx HTTP response from ClickHouse on the dsr_audit_log
 * INSERT is captured to Sentry — NOT silently swallowed. Before FOLLOW-428,
 * writeDsrAuditLog used a bare `await fetch(...)` with NO `res.ok` check AND
 * NO try/catch: HTTP-level rejections were invisible, and a network error would
 * propagate as an unhandled promise rejection out of the async function —
 * violating the fire-and-forget contract (all callers use `void writeDsrAuditLog(...)`).
 *
 * Three tests per AC-3:
 *   (a) non-ok HTTP response → Sentry captured with kind='insert_rejected', table='dsr_audit_log'
 *   (b) network / thrown error → Sentry captured with kind='network', function does not throw
 *   (c) happy path (ok response) → Sentry NOT called, caller unaffected
 *
 * @module apps/control-plane/src/app/api/dsr/_clickhouse.fail-loud.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ─── Sentry mock (must be hoisted before module import) ───────────────────────
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import * as Sentry from '@sentry/nextjs';
import { writeDsrAuditLog } from './_clickhouse';
import type { DsrAuditEntry } from './_clickhouse';

// ─── Constants ────────────────────────────────────────────────────────────────

const CLICKHOUSE_URL = 'http://ch.test:8123';

const VALID_ENTRY: DsrAuditEntry = {
  tenant_id: '550e8400-e29b-41d4-a716-446655440001',
  session_id: 'sess-dsr-428-test',
  dsr_type: 'erasure',
  action: 'completed',
  email: 'test@example.com',
  requested_at: new Date('2026-06-28T00:00:00.000Z'),
  completed_at: new Date('2026-06-28T00:01:00.000Z'),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('writeDsrAuditLog — FOLLOW-428 fail loud on ClickHouse INSERT rejection', () => {
  let captureException: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    captureException = vi.mocked(Sentry.captureException);
    captureException.mockReset();
    vi.stubEnv('CLICKHOUSE_URL', CLICKHOUSE_URL);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('FOLLOW-428 (a): non-ok HTTP response → captureException with kind=insert_rejected, does not throw', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 516,
        text: () =>
          Promise.resolve('Authentication failed. Password is incorrect or there is no user.'),
      }),
    );

    // Must not throw — callers use `void writeDsrAuditLog(...)` (fire-and-forget)
    await expect(writeDsrAuditLog(VALID_ENTRY)).resolves.not.toThrow();

    expect(captureException).toHaveBeenCalledOnce();
    const [capturedErr, capturedCtx] = captureException.mock.calls[0] as [
      Error,
      { tags: Record<string, string>; extra: Record<string, unknown> },
    ];
    expect(capturedErr).toBeInstanceOf(Error);
    expect(capturedErr.message).toContain('516');
    expect(capturedErr.message).toContain('Authentication failed');
    expect(capturedCtx.tags.kind).toBe('insert_rejected');
    expect(capturedCtx.tags.sink).toBe('clickhouse');
    expect(capturedCtx.tags.area).toBe('dsr');
    expect(capturedCtx.extra.status).toBe(516);
  });

  it('FOLLOW-428 (b): network-level rejection → captureException with kind=network, does not throw', async () => {
    const networkErr = new Error('connect ECONNREFUSED 127.0.0.1:8123');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkErr));

    await expect(writeDsrAuditLog(VALID_ENTRY)).resolves.not.toThrow();

    expect(captureException).toHaveBeenCalledOnce();
    const [capturedErr, capturedCtx] = captureException.mock.calls[0] as [
      Error,
      { tags: Record<string, string> },
    ];
    expect(capturedErr).toBeInstanceOf(Error);
    expect(capturedErr.message).toContain('ECONNREFUSED');
    expect(capturedCtx.tags.kind).toBe('network');
    expect(capturedCtx.tags.sink).toBe('clickhouse');
    expect(capturedCtx.tags.area).toBe('dsr');
  });

  it('FOLLOW-428 (c): successful HTTP 200 → captureException NOT called', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    await writeDsrAuditLog(VALID_ENTRY);

    expect(captureException).not.toHaveBeenCalled();
  });

  it('FOLLOW-428: no-op when CLICKHOUSE_URL is unset — no fetch, no Sentry', async () => {
    vi.stubEnv('CLICKHOUSE_URL', '');
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    await writeDsrAuditLog(VALID_ENTRY);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });
});
