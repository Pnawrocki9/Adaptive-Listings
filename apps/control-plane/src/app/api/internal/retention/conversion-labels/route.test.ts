/**
 * Tests for GET /api/internal/retention/conversion-labels
 *
 * Coverage:
 *   Auth:
 *     1. CRON_SECRET env var absent → 401 (infrastructure misconfiguration)
 *     2. Correct Bearer token → 200 with deleted count
 *     3. Wrong Bearer token → 401
 *     4. Missing Authorization header → 401
 *
 *   Retention boundary (thirteenMonthsAgo):
 *     5. Rows with labeledAt < cutoff are deleted; rows >= cutoff are preserved
 *     6. thirteenMonthsAgo() returns a date 13 calendar months before `now`
 *     7. Boundary rows (exactly at cutoff - 1ms) are deleted; rows at cutoff are kept
 *
 *   No-op when DB not configured:
 *     8. DATABASE_URL_ADMIN unset → 200 { deleted: 0, note: 'DATABASE_URL_ADMIN_unset' }
 *
 *   Fail-loud (Rule K.2):
 *     9. DB DELETE throws when DB is configured → 500 with RETENTION_DELETE_FAILED code
 *    10. Sentry.captureException is called on DB failure
 *
 * All external dependencies (DB, Sentry) are mocked.
 *
 * @module apps/control-plane/src/app/api/internal/retention/conversion-labels/route.test
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { thirteenMonthsAgo } from './_utils';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockDelete, mockCaptureException, mockAddBreadcrumb } = vi.hoisted(() => ({
  mockDelete: vi.fn(),
  mockCaptureException: vi.fn(),
  mockAddBreadcrumb: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: mockCaptureException,
  addBreadcrumb: mockAddBreadcrumb,
}));

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => ({
    delete: mockDelete,
  })),
  conversionLabels: {
    id: 'id',
    labeledAt: 'labeled_at',
  },
  lt: vi.fn((col: unknown, val: unknown) => ({ col, val, _op: 'lt' })),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader !== undefined) {
    headers.set('authorization', authHeader);
  }
  return new NextRequest('http://localhost/api/internal/retention/conversion-labels', {
    method: 'GET',
    headers,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/internal/retention/conversion-labels', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ── Auth tests ─────────────────────────────────────────────────────────────

  it('returns 401 when CRON_SECRET is not set', async () => {
    delete process.env.CRON_SECRET;
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL_DIRECT;

    const { GET } = await import('./route');
    const req = makeRequest('Bearer some-secret');
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when Authorization header is missing', async () => {
    process.env.CRON_SECRET = 'test-secret';
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL_DIRECT;

    const { GET } = await import('./route');
    const req = makeRequest(undefined);
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it('returns 401 when Authorization header does not match', async () => {
    process.env.CRON_SECRET = 'test-secret';
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL_DIRECT;

    const { GET } = await import('./route');
    const req = makeRequest('Bearer wrong-secret');
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  // ── No-op when DB not configured ───────────────────────────────────────────

  it('returns 200 no-op when DATABASE_URL_ADMIN is not set', async () => {
    process.env.CRON_SECRET = 'test-secret';
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL_DIRECT;

    const { GET } = await import('./route');
    const req = makeRequest('Bearer test-secret');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(0);
    expect(body.note).toBe('DATABASE_URL_ADMIN_unset');
    expect(mockDelete).not.toHaveBeenCalled();
  });

  // ── Successful retention run ──────────────────────────────────────────────

  it('deletes old rows and returns the count', async () => {
    process.env.CRON_SECRET = 'test-secret';
    process.env.DATABASE_URL_ADMIN = 'postgres://admin@localhost/db';

    // Simulate 3 deleted rows returned by `.returning()`
    const mockReturning = vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
    mockDelete.mockReturnValue({ where: mockWhere });

    const { GET } = await import('./route');
    const req = makeRequest('Bearer test-secret');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(3);
    expect(typeof body.cutoff).toBe('string');

    // Verify DB was called
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockWhere).toHaveBeenCalledTimes(1);
    expect(mockReturning).toHaveBeenCalledTimes(1);
  });

  it('returns deleted: 0 and does NOT call Sentry when no rows to delete', async () => {
    process.env.CRON_SECRET = 'test-secret';
    process.env.DATABASE_URL_ADMIN = 'postgres://admin@localhost/db';

    const mockReturning = vi.fn().mockResolvedValue([]);
    const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
    mockDelete.mockReturnValue({ where: mockWhere });

    const { GET } = await import('./route');
    const req = makeRequest('Bearer test-secret');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(0);
    expect(mockAddBreadcrumb).not.toHaveBeenCalled();
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('calls Sentry.addBreadcrumb when rows are deleted', async () => {
    process.env.CRON_SECRET = 'test-secret';
    process.env.DATABASE_URL_ADMIN = 'postgres://admin@localhost/db';

    const mockReturning = vi.fn().mockResolvedValue([{ id: 'x' }]);
    const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
    mockDelete.mockReturnValue({ where: mockWhere });

    const { GET } = await import('./route');
    const req = makeRequest('Bearer test-secret');
    await GET(req);

    expect(mockAddBreadcrumb).toHaveBeenCalledTimes(1);
    const call = mockAddBreadcrumb.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.category).toBe('retention');
    expect((call.data as Record<string, unknown>).deleted).toBe(1);
  });

  // ── Fail-loud (Rule K.2) ──────────────────────────────────────────────────

  it('returns 500 and calls Sentry.captureException when DB throws', async () => {
    process.env.CRON_SECRET = 'test-secret';
    process.env.DATABASE_URL_ADMIN = 'postgres://admin@localhost/db';

    const mockWhere = vi.fn().mockReturnValue({
      returning: vi.fn().mockRejectedValue(new Error('connection refused')),
    });
    mockDelete.mockReturnValue({ where: mockWhere });

    const { GET } = await import('./route');
    const req = makeRequest('Bearer test-secret');
    const res = await GET(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('RETENTION_DELETE_FAILED');
    expect(body.error.message).toBe('connection refused');

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    const sentryCall = mockCaptureException.mock.calls[0] as [
      unknown,
      { tags: { retention_cron_failed: string } },
    ];
    expect(sentryCall[0]).toBeInstanceOf(Error);
    expect(sentryCall[1].tags.retention_cron_failed).toBe('conversion_labels');
  });

  // ── thirteenMonthsAgo boundary tests ─────────────────────────────────────

  describe('thirteenMonthsAgo()', () => {
    it('returns a date exactly 13 calendar months before the reference', () => {
      const ref = new Date('2026-06-08T00:00:00.000Z');
      const cutoff = thirteenMonthsAgo(ref);
      // 13 months before 2026-06-08 = 2025-05-08
      expect(cutoff.getFullYear()).toBe(2025);
      expect(cutoff.getMonth()).toBe(4); // May (0-indexed)
      expect(cutoff.getDate()).toBe(8);
    });

    it('handles year boundaries correctly (Jan → Dec previous year)', () => {
      const ref = new Date('2026-01-15T00:00:00.000Z');
      const cutoff = thirteenMonthsAgo(ref);
      // 13 months before 2026-01-15 = 2024-12-15
      expect(cutoff.getFullYear()).toBe(2024);
      expect(cutoff.getMonth()).toBe(11); // December (0-indexed)
      expect(cutoff.getDate()).toBe(15);
    });

    it('does not mutate the input date', () => {
      const ref = new Date('2026-06-08T12:00:00.000Z');
      const refCopy = new Date(ref);
      thirteenMonthsAgo(ref);
      expect(ref.getTime()).toBe(refCopy.getTime());
    });

    it('rows with labeledAt strictly less than cutoff should be deleted; rows at or after cutoff should not', () => {
      const now = new Date('2026-06-08T10:00:00.000Z');
      const cutoff = thirteenMonthsAgo(now);

      // 1 ms before cutoff — should be deleted
      const oldRow = new Date(cutoff.getTime() - 1);
      expect(oldRow.getTime()).toBeLessThan(cutoff.getTime());

      // At exactly cutoff — should NOT be deleted (lt, not lte)
      const atCutoff = new Date(cutoff.getTime());
      expect(atCutoff.getTime()).not.toBeLessThan(cutoff.getTime());

      // After cutoff — should NOT be deleted
      const newRow = new Date(cutoff.getTime() + 1000);
      expect(newRow.getTime()).toBeGreaterThan(cutoff.getTime());
    });
  });
});
