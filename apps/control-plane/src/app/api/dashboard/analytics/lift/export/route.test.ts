/**
 * GET /api/dashboard/analytics/lift/export (FOLLOW-1338, ruling D-K).
 *
 * Pinned: staff 200 with the attachment headers and the panel's columns; readonly staff allowed
 * (a read); no session 401 (a non-staff caller is no caller since FOLLOW-1335); a foreign / unknown tenant is
 * whatever `resolveTenantAccess` throws (404); an unknown window 400; a failing ClickHouse is a JSON
 * 500 + Sentry, never a CSV of zeros; the unconfigured mock is tagged in every row; a cell that
 * starts with a formula character is neutralised while a negative number stays a number.
 */

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SessionAuthModule from '@/lib/session-auth';
import { buildLiftCsv } from '@/lib/lift-csv';
import { buildMockRaw, buildResponseFromRaw } from '../route-helpers';

vi.mock('@/lib/session-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionAuthModule>();
  return { ...actual, resolveTenantAccess: vi.fn() };
});
import { resolveTenantAccess, AccessError, type TenantAccess } from '@/lib/session-auth';
const mockResolve = vi.mocked(resolveTenantAccess);

const { mockCaptureException } = vi.hoisted(() => ({ mockCaptureException: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({
  captureException: mockCaptureException,
  captureMessage: vi.fn(),
}));

import { GET } from './route';

const TENANT = '550e8400-e29b-41d4-a716-446655440002';

/** The header row, spelled out: the test must fail if a column is renamed or reordered. */
const HEADER = [
  'section',
  'date',
  'arm',
  'sessions',
  'conversions',
  'conversion_rate_pct',
  'live_signups',
  'live_signup_rate_pct',
  'agent_contacts',
  'agent_contact_rate_pct',
  'relative_lift_pct',
  'p_value',
  'confidence',
  'data_source',
  'conversion_source',
] as const;

function staffAccess(role: 'estalara:ops' | 'estalara:readonly', canWrite: boolean): TenantAccess {
  return {
    via: 'staff',
    tenantId: TENANT,
    staff: {
      sub: 'staff-uuid',
      email: 'staff@estalara.com',
      tenant_id: null,
      estalara_staff: true,
      estalara_role: role,
      mfa_verified: true,
    },
    role,
    canWrite,
    isSuperadmin: false,
  };
}

function req(qs = `window=30&tenant_id=${TENANT}`): NextRequest {
  return new NextRequest(`http://localhost/api/dashboard/analytics/lift/export?${qs}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolve.mockResolvedValue(staffAccess('estalara:ops', true));
  vi.stubEnv('CALLER_SIGNED_COLUMN_ENABLED', 'true');
  vi.stubEnv('CLICKHOUSE_URL', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('auth', () => {
  it('no session -> 401', async () => {
    mockResolve.mockRejectedValue(new AccessError(401, 'Unauthorized: no tenant access'));
    expect((await GET(req())).status).toBe(401);
  });

  it('a foreign / unknown tenant is whatever resolveTenantAccess throws (404 here)', async () => {
    mockResolve.mockRejectedValue(new AccessError(404, 'Unknown tenant'));
    expect((await GET(req())).status).toBe(404);
    expect(mockResolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ allowStaffOverride: true, tenantId: TENANT }),
    );
  });

  it('an unattributable staff caller is refused 403 (resolveTenantAccess decides)', async () => {
    mockResolve.mockRejectedValue(
      new AccessError(403, 'Unauthorized: no tenant access for this request'),
    );
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('forbidden');
  });

  it('read-only staff may export (it is a read)', async () => {
    mockResolve.mockResolvedValue(staffAccess('estalara:readonly', false));
    expect((await GET(req())).status).toBe(200);
  });
});

describe('response', () => {
  it('staff 200: text/csv attachment named lift-<tenant>-<window>d-<date>.csv, header = the columns', async () => {
    const res = await GET(req('window=90&tenant_id=' + TENANT));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    const today = new Date().toISOString().slice(0, 10);
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="lift-${TENANT}-90d-${today}.csv"`,
    );
    expect(res.headers.get('cache-control')).toBe('no-store');
    const lines = (await res.text()).trimEnd().split('\r\n');
    expect(lines[0]).toBe(HEADER.join(','));
    expect(lines).toHaveLength(3); // header + adapted + holdout (the mock has no daily block)
    expect(lines[1]!.split(',').slice(0, 3)).toEqual(['summary', '', 'adapted']);
    // provenance on every row: the unconfigured state is the mock, and says so
    expect(lines[1]).toContain(',mock,mock');
  });

  it('defaults to a 7 day window and rejects an unknown one with 400', async () => {
    const ok = await GET(req(`tenant_id=${TENANT}`));
    expect(ok.headers.get('content-disposition')).toContain(`-7d-`);
    const bad = await GET(req(`window=45&tenant_id=${TENANT}`));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('invalid_window');
  });

  it('ClickHouse path: summary rows + one daily pair per UTC day, rates in percent', async () => {
    vi.stubEnv('CLICKHOUSE_URL', 'http://ch.test:8123');
    const today = new Date().toISOString().slice(0, 10);
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown) => {
        const sql = new URL(String(url)).searchParams.get('query') ?? '';
        const base = { cta_sessions: 0, unsigned_conversion_sessions: 0 };
        const line = (extra: Record<string, unknown>) => JSON.stringify({ ...base, ...extra });
        if (sql.includes('day_utc')) {
          return Promise.resolve(
            new Response(
              [
                line({
                  day_utc: today,
                  holdout: 0,
                  sessions: 50,
                  conversions: 5,
                  signed_conversion_sessions: 5,
                  live_signup_sessions: 3,
                  agent_contact_sessions: 2,
                }),
                line({
                  day_utc: today,
                  holdout: 1,
                  sessions: 50,
                  conversions: 2,
                  signed_conversion_sessions: 2,
                  live_signup_sessions: 1,
                  agent_contact_sessions: 1,
                }),
              ].join('\n'),
            ),
          );
        }
        if (sql.includes('GROUP BY ad.holdout_group')) {
          return Promise.resolve(
            new Response(
              [
                line({
                  holdout: 0,
                  sessions: 400,
                  conversions: 40,
                  signed_conversion_sessions: 40,
                  live_signup_sessions: 25,
                  agent_contact_sessions: 20,
                }),
                line({
                  holdout: 1,
                  sessions: 400,
                  conversions: 20,
                  signed_conversion_sessions: 20,
                  live_signup_sessions: 10,
                  agent_contact_sessions: 12,
                }),
              ].join('\n'),
            ),
          );
        }
        return Promise.resolve(new Response(''));
      }),
    );
    const res = await GET(req('window=7&tenant_id=' + TENANT));
    expect(res.status).toBe(200);
    const lines = (await res.text()).trimEnd().split('\r\n');
    // header + 2 summary + 7 days x 2 arms
    expect(lines).toHaveLength(1 + 2 + 14);
    const header = lines[0]!.split(',');
    const cell = (line: string, col: (typeof HEADER)[number]) =>
      line.split(',')[header.indexOf(col)];
    const summaryAdapted = lines[1]!;
    expect(cell(summaryAdapted, 'conversion_rate_pct')).toBe('10');
    expect(cell(summaryAdapted, 'live_signup_rate_pct')).toBe('6.25');
    expect(cell(summaryAdapted, 'agent_contact_rate_pct')).toBe('5');
    expect(cell(summaryAdapted, 'relative_lift_pct')).toBe('100');
    expect(cell(summaryAdapted, 'data_source')).toBe('clickhouse');
    const todayAdapted = lines.find((l) => l.startsWith(`daily,${today},adapted`))!;
    expect(cell(todayAdapted, 'sessions')).toBe('50');
    expect(cell(todayAdapted, 'conversion_rate_pct')).toBe('10');
    // an empty day is a truthful zero row, not a missing one
    expect(lines.filter((l) => l.startsWith('daily,')).length).toBe(14);
  });

  it('ClickHouse configured and failing -> JSON 500 + one Sentry capture, not a CSV', async () => {
    vi.stubEnv('CLICKHOUSE_URL', 'http://ch.test:8123');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('x', { status: 500 }))),
    );
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'clickhouse_query_failed',
    );
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
  });
});

describe('CSV injection', () => {
  /** Render one report whose data_source / conversion_source cells hold `hostile`, read them back. */
  function renderedCells(hostile: string): string[] {
    const report = buildResponseFromRaw(TENANT, 7, buildMockRaw(TENANT, 7), 'mock');
    const csv = buildLiftCsv(
      { ...report, data_source: hostile as never, conversion_source: 'signed_events' },
      [],
    );
    const row = csv.split('\r\n')[1]!;
    return row.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  }

  it('prefixes string cells that start with = + - @ tab CR; quotes delimiters', () => {
    expect(renderedCells('=HYPERLINK("x")')[13]).toBe(`"'=HYPERLINK(""x"")"`);
    expect(renderedCells('+1')[13]).toBe(`'+1`);
    expect(renderedCells('-2')[13]).toBe(`'-2`);
    expect(renderedCells('@SUM(A1)')[13]).toBe(`'@SUM(A1)`);
    expect(renderedCells('\tcmd')[13]).toBe(`'\tcmd`);
    expect(renderedCells('a,b')[13]).toBe('"a,b"');
  });

  it('keeps numbers numeric: a negative lift is not prefixed, an unknown value is empty', () => {
    const report = buildResponseFromRaw(
      TENANT,
      7,
      {
        groups: [
          {
            holdout: 0,
            sessions: 100,
            cta_sessions: 0,
            conversions: 5,
            pre_exposure_conversions: 0,
            unsigned_conversions: 0,
          },
          {
            holdout: 1,
            sessions: 100,
            cta_sessions: 0,
            conversions: 10,
            pre_exposure_conversions: 0,
            unsigned_conversions: 0,
          },
        ],
        archetypes: [],
        funnel: [],
        callerClass: true,
      },
      'clickhouse',
    );
    const row = buildLiftCsv(report, []).split('\r\n')[1]!.split(',');
    expect(row[10]).toBe('-50'); // relative_lift_pct: a number, no leading quote
    expect(row[6]).toBe(''); // live_signups: not read -> empty, not 0
  });
});
