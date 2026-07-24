/**
 * FOLLOW-633 — unit tests for resolveAlEnablement (the single shared runtime
 * enforcement point for the per-tenant Adaptive Listings on/off).
 *
 * Exercises every direction against a REAL (mocked) stored `tenants` row shape
 * `{ al_enabled, status }`:
 *   - al_enabled=false                    → OFF (reason al_disabled)
 *   - status='suspended' / 'canceled'     → OFF (billing/lifecycle cut-off)
 *   - al_enabled=true + status='active'   → ON
 *   - status='pending' (al_enabled=true)  → ON (must NOT cut off the live tenant)
 *   - no row / DB throw / db unconfigured → ON (fail-open, never break the site)
 *
 * @module apps/control-plane/src/lib/al-enablement.test
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
  // `tenants` only needs to be a defined object — the mocked builder ignores columns.
  tenants: { id: 'id', alEnabled: 'al_enabled', status: 'status' },
}));

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import { resolveAlEnablement, AL_OFF_STATUSES } from './al-enablement';
import { captureException } from '@sentry/nextjs';

const TENANT = '11111111-1111-1111-1111-111111111111';

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

describe('resolveAlEnablement', () => {
  it('al_enabled=false → OFF (al_disabled), even when status is active', async () => {
    rowsRef.rows = [{ alEnabled: false, status: 'active' }];
    const r = await resolveAlEnablement(TENANT);
    expect(r).toEqual({ off: true, reason: 'al_disabled' });
  });

  it("status='suspended' → OFF (status_suspended) even when al_enabled=true", async () => {
    rowsRef.rows = [{ alEnabled: true, status: 'suspended' }];
    const r = await resolveAlEnablement(TENANT);
    expect(r).toEqual({ off: true, reason: 'status_suspended' });
  });

  it("status='canceled' → OFF (status_canceled)", async () => {
    rowsRef.rows = [{ alEnabled: true, status: 'canceled' }];
    const r = await resolveAlEnablement(TENANT);
    expect(r).toEqual({ off: true, reason: 'status_canceled' });
  });

  it("al_enabled=true + status='active' → ON", async () => {
    rowsRef.rows = [{ alEnabled: true, status: 'active' }];
    const r = await resolveAlEnablement(TENANT);
    expect(r).toEqual({ off: false, reason: null });
  });

  it("status='pending' (al_enabled=true) → ON — must NOT cut off the live tenant", async () => {
    rowsRef.rows = [{ alEnabled: true, status: 'pending' }];
    const r = await resolveAlEnablement(TENANT);
    expect(r).toEqual({ off: false, reason: null });
  });

  it('unknown tenant (no row) → ON (fail-open)', async () => {
    rowsRef.rows = [];
    const r = await resolveAlEnablement(TENANT);
    expect(r).toEqual({ off: false, reason: null });
  });

  it('configured-but-threw → ON (fail-open) AND captured to Sentry (Rule K.2 observable)', async () => {
    rowsRef.throwOnQuery = true;
    const r = await resolveAlEnablement(TENANT);
    expect(r).toEqual({ off: false, reason: null });
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('db NOT configured (dev/CI) → ON with NO query and NO Sentry', async () => {
    vi.unstubAllEnvs(); // remove DATABASE_URL_ADMIN
    const r = await resolveAlEnablement(TENANT);
    expect(r).toEqual({ off: false, reason: null });
    expect(createAdminClientMock).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("empty / 'unknown' tenant id → ON without touching the DB", async () => {
    expect(await resolveAlEnablement('')).toEqual({ off: false, reason: null });
    expect(await resolveAlEnablement('unknown')).toEqual({ off: false, reason: null });
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it('AL_OFF_STATUSES contains exactly suspended + canceled', () => {
    expect([...AL_OFF_STATUSES].sort()).toEqual(['canceled', 'suspended']);
  });
});
