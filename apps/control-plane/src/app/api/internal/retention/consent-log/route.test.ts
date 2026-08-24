/**
 * Tests for GET /api/internal/retention/consent-log (FOLLOW-1118 / ESC-071).
 *
 * These cover the contract the handler owes its caller. What a row in ClickHouse actually does is
 * NOT asserted here — a mocked `fetch` can only prove we sent something plausible, and "we sent
 * something plausible" is the evidence class that let ESC-071's false sentence ship for three
 * months. That half lives in `src/__tests__/integration/consent-log-retention.integration.test.ts`
 * and runs against a real engine.
 *
 * Coverage:
 *   Auth (a mutating endpoint — cryptographic, constant-time, in this PR):
 *     1. CRON_SECRET unset → 401, and NOTHING is queried
 *     2. correct Bearer → 200
 *     3. wrong Bearer → 401
 *     4. missing Authorization header → 401
 *     5. the compare actually goes through `secretEquals` (constant-time), not `===`
 *
 *   Dependency not configured vs configured-but-failed (Rule K.2):
 *     6. CLICKHOUSE_URL unset → 200 with `data_source: 'not_configured'` — observable on the wire
 *     7. the count query throws → 500 RETENTION_DELETE_FAILED + Sentry.captureException
 *     8. the DELETE throws → 500 + Sentry.captureException
 *     9. an unparseable count response is treated as a failure, not as "zero rows"
 *
 *   Behaviour:
 *    10. matched = 0 → no mutation is issued at all
 *    11. matched > 0 → the mutation is issued, and the window reported is the declared constant
 *
 * @module apps/control-plane/src/app/api/internal/retention/consent-log/route.test
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CONSENT_LOG_RETENTION_DAYS } from '@estalara/shared';

const { mockExecute, mockReadConfig, mockCaptureException, mockAddBreadcrumb } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockReadConfig: vi.fn(),
  mockCaptureException: vi.fn(),
  mockAddBreadcrumb: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: mockCaptureException,
  addBreadcrumb: mockAddBreadcrumb,
}));

vi.mock('@/lib/clickhouse-dsr', () => ({
  executeClickHouseSql: mockExecute,
  readClickHouseConfig: mockReadConfig,
}));

// Spy on the REAL secretEquals so the test asserts the constant-time compare is exercised, not
// merely imported (the FOLLOW-466 / audit F-21 shape).
vi.mock('@/lib/secret-compare', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- importOriginal generic needs an inline import() type
  const real = await importOriginal<typeof import('@/lib/secret-compare')>();
  return { ...real, secretEquals: vi.fn(real.secretEquals) };
});

import { secretEquals } from '@/lib/secret-compare';
import { GET } from './route';

const SECRET = 'cron-secret-under-test';
const CH_CONFIG = { url: 'https://ch.example', user: 'ingest_worker', password: 'pw' };

const request = (auth?: string): NextRequest =>
  new NextRequest('https://control-plane.test/api/internal/retention/consent-log', {
    headers: auth === undefined ? {} : { authorization: auth },
  });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  mockReadConfig.mockReturnValue(CH_CONFIG);
  mockExecute.mockResolvedValue('0\n');
});

describe('auth', () => {
  it('401s and touches nothing when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(request(`Bearer ${SECRET}`));
    expect(res.status).toBe(401);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('200s on the correct bearer token', async () => {
    expect((await GET(request(`Bearer ${SECRET}`))).status).toBe(200);
  });

  it('401s on a wrong bearer token', async () => {
    const res = await GET(request('Bearer wrong-secret'));
    expect(res.status).toBe(401);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('401s when the Authorization header is absent', async () => {
    expect((await GET(request())).status).toBe(401);
  });

  it('compares with secretEquals (constant-time), not ===', async () => {
    await GET(request(`Bearer ${SECRET}`));
    expect(vi.mocked(secretEquals)).toHaveBeenCalledWith(SECRET, SECRET);
  });
});

describe('dependency not configured vs configured-but-failed (Rule K.2)', () => {
  it('says so on the wire when ClickHouse is not configured', async () => {
    mockReadConfig.mockReturnValue(null);
    const res = await GET(request(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.data_source).toBe('not_configured');
    expect(body.mutation_issued).toBe(false);
    expect(body.note).toBe('CLICKHOUSE_URL_unset');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('fails loud when the count query throws', async () => {
    mockExecute.mockRejectedValueOnce(new Error('ClickHouse SQL failed: HTTP 500'));
    const res = await GET(request(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { data_source: string; error: { code: string } };
    expect(body.error.code).toBe('RETENTION_DELETE_FAILED');
    expect(body.data_source).toBe('clickhouse');
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
  });

  it('fails loud when the DELETE mutation throws', async () => {
    mockExecute
      .mockResolvedValueOnce('4\n')
      .mockRejectedValueOnce(new Error('Code 497: not enough privileges'));
    const res = await GET(request(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
  });

  it('treats an unparseable count as a failure, never as "zero rows"', async () => {
    mockExecute.mockResolvedValueOnce('<html>gateway timeout</html>');
    const res = await GET(request(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
  });
});

describe('behaviour', () => {
  it('issues no mutation when nothing has aged out', async () => {
    mockExecute.mockResolvedValueOnce('0\n');
    const res = await GET(request(`Bearer ${SECRET}`));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      data_source: 'clickhouse',
      retention_days: CONSENT_LOG_RETENTION_DAYS,
      matched: 0,
      mutation_issued: false,
    });
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('issues the mutation and reports the declared window when rows have aged out', async () => {
    mockExecute.mockResolvedValueOnce('4\n').mockResolvedValueOnce('');
    const res = await GET(request(`Bearer ${SECRET}`));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      data_source: 'clickhouse',
      retention_days: CONSENT_LOG_RETENTION_DAYS,
      matched: 4,
      mutation_issued: true,
    });
    expect(mockExecute).toHaveBeenCalledTimes(2);
    const [, deleteSql, deleteParams] = mockExecute.mock.calls[1] as [
      unknown,
      string,
      Record<string, string>,
    ];
    expect(deleteSql).toContain('ALTER TABLE events DELETE WHERE');
    expect(deleteParams.retention_days).toBe(String(CONSENT_LOG_RETENTION_DAYS));
    expect(Object.values(deleteParams)).toEqual(
      expect.arrayContaining(['consent.granted', 'consent.denied']),
    );
    expect(mockAddBreadcrumb).toHaveBeenCalledTimes(1);
  });
});
