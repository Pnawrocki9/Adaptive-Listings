/**
 * FOLLOW-636 — unit tests for resolveDemoSessionRevocation (the single runtime
 * enforcement point for demo-session revocation on the adapt demo-JWT path).
 *
 * Exercises both directions against a REAL (mocked) stored `demo_sessions` row
 * shape `{ revoked_at }`, plus the fail-open axes:
 *   - revoked_at = <timestamp>   → revoked (session cut off)
 *   - revoked_at = null          → NOT revoked (active session serves)
 *   - no row                     → NOT revoked (fail-open)
 *   - DB throw                   → NOT revoked (fail-open) AND Sentry (Rule K.2)
 *   - db unconfigured (dev/CI)   → NOT revoked, NO query, NO Sentry
 *
 * @module apps/control-plane/src/lib/demo-session-revocation.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Controllable rows returned by the mocked service-role query builder.
const { rowsRef, createAdminClientMock } = vi.hoisted(() => {
  const ref: { rows: unknown[]; throwOnQuery: boolean } = { rows: [], throwOnQuery: false };
  const builder = {
    select: () => builder,
    from: () => builder,
    where: () => builder,
    limit: () => {
      if (ref.throwOnQuery) return Promise.reject(new Error('simulated DB failure'));
      return Promise.resolve(ref.rows);
    },
  };
  return {
    rowsRef: ref,
    createAdminClientMock: vi.fn(() => builder),
  };
});

vi.mock('@estalara/db', () => ({
  createAdminClient: createAdminClientMock,
  // `demoSessions` only needs to be a defined object — the mocked builder ignores columns.
  demoSessions: { id: 'id', revokedAt: 'revoked_at' },
}));

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import { resolveDemoSessionRevocation } from './demo-session-revocation';
import { captureException } from '@sentry/nextjs';

const SESSION = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  rowsRef.rows = [];
  rowsRef.throwOnQuery = false;
  // "configured" so the query path (not the dev/CI short-circuit) is exercised.
  vi.stubEnv('DATABASE_URL_ADMIN', 'postgres://test');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveDemoSessionRevocation', () => {
  it('revoked_at set → revoked (session cut off at runtime)', async () => {
    rowsRef.rows = [{ revokedAt: new Date('2026-07-24T00:00:00Z') }];
    const r = await resolveDemoSessionRevocation(SESSION);
    expect(r).toEqual({ revoked: true });
  });

  it('revoked_at null → NOT revoked (active session serves)', async () => {
    rowsRef.rows = [{ revokedAt: null }];
    const r = await resolveDemoSessionRevocation(SESSION);
    expect(r).toEqual({ revoked: false });
  });

  it('no row → NOT revoked (fail-open)', async () => {
    rowsRef.rows = [];
    const r = await resolveDemoSessionRevocation(SESSION);
    expect(r).toEqual({ revoked: false });
  });

  it('garbled row (revokedAt absent) → NOT revoked (fail-open — only explicit revoked_at cuts off)', async () => {
    rowsRef.rows = [{ someOtherColumn: 'x' }];
    const r = await resolveDemoSessionRevocation(SESSION);
    expect(r).toEqual({ revoked: false });
  });

  it('configured-but-threw → NOT revoked (fail-open) AND captured to Sentry (Rule K.2 observable)', async () => {
    rowsRef.throwOnQuery = true;
    const r = await resolveDemoSessionRevocation(SESSION);
    expect(r).toEqual({ revoked: false });
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('db NOT configured (dev/CI) → NOT revoked with NO query and NO Sentry', async () => {
    vi.unstubAllEnvs(); // remove DATABASE_URL_ADMIN
    const r = await resolveDemoSessionRevocation(SESSION);
    expect(r).toEqual({ revoked: false });
    expect(createAdminClientMock).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it('empty session id → NOT revoked without touching the DB', async () => {
    expect(await resolveDemoSessionRevocation('')).toEqual({ revoked: false });
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });
});
