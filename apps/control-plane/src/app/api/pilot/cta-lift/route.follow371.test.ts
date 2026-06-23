/**
 * FOLLOW-371 regression tests — ESC-026 holdout contamination exclusion filter.
 *
 * Asserts that all ClickHouse queries sent by the cta-lift, calibration, and
 * dashboard lift routes include the FOLLOW-371 exclusion predicate:
 *   NOT (holdout_group = 1 AND variant != 'control')
 *
 * This is the canonical "golden-query SQL-shape regression test" required by the
 * evidence_requirements section of the data-engineer agent spec (RETRO-014 model).
 *
 * Approach: stub global fetch, capture the URL query parameter that ClickHouse
 * receives, and assert the decoded SQL contains the exclusion predicate.
 * Also assert that the stale `dqs_events`/`assigned_at` vocabulary is absent from
 * the contamination-relevant queries (canonical vocabulary guard, Rule K.1).
 *
 * @module apps/control-plane/src/app/api/pilot/cta-lift/route.follow371.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ─── Shared mocks ─────────────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440371';

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn(),
  isTenantClaims: vi.fn((claims: Record<string, unknown>) => {
    return claims.estalara_staff === false && typeof claims.tenant_id === 'string';
  }),
}));

import { getAuthClaims } from '@estalara/auth';
const mockGetAuthClaims = vi.mocked(getAuthClaims);

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

function authAsTenant(): void {
  mockGetAuthClaims.mockResolvedValue({
    sub: 'user-uuid',
    email: 'analyst@agency.com',
    tenant_id: TENANT_ID,
    agency_role: 'agency:admin',
    estalara_staff: false,
    mfa_verified: true,
  });
}

/** Decode a ClickHouse query URL captured by the fetch mock. */
function decodeCapturedSql(urlStr: string): string {
  const url = new URL(urlStr);
  // searchParams.get already decodes percent-sequences and converts '+' to space.
  return url.searchParams.get('query') ?? urlStr;
}

// ─── cta-lift route ───────────────────────────────────────────────────────────

describe('FOLLOW-371: cta-lift exclusion filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test:8123';
    authAsTenant();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CLICKHOUSE_URL;
  });

  it('all three cta-lift ClickHouse queries include the ESC-026 exclusion predicate', async () => {
    const capturedSqls: string[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((urlStr: unknown) => {
        capturedSqls.push(decodeCapturedSql(String(urlStr)));
        return Promise.resolve(new Response('', { status: 200 }));
      }),
    );

    const req = new NextRequest(`http://localhost/api/pilot/cta-lift?window_days=7`, {
      headers: { Authorization: 'Bearer mock-token' },
    });

    const { GET } = await import('./route.js');
    const res = await GET(req);
    // Empty rows → 200 (groups/archetypes empty, not an error).
    expect(res.status).toBe(200);

    // Three queries were sent (groups, archetypes, funnel).
    expect(capturedSqls.length).toBe(3);

    for (const sql of capturedSqls) {
      expect(sql, `SQL missing FOLLOW-371 exclusion predicate:\n${sql}`).toMatch(
        /NOT\s*\(.*holdout_group\s*=\s*1.*AND.*variant.*!=\s*'control'\s*\)/i,
      );
      // Canonical vocabulary guard (Rule K.1): no stale tokens.
      expect(sql).not.toContain('dqs_events');
      expect(sql).not.toContain('assigned_at');
    }
  });
});

// ─── dashboard/analytics/lift route ──────────────────────────────────────────

describe('FOLLOW-371: dashboard analytics lift exclusion filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test:8123';
    authAsTenant();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CLICKHOUSE_URL;
  });

  it('dashboard lift query includes the ESC-026 exclusion predicate', async () => {
    let capturedSql = '';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((urlStr: unknown) => {
        capturedSql = decodeCapturedSql(String(urlStr));
        return Promise.resolve(new Response('', { status: 200 }));
      }),
    );

    const req = new NextRequest(`http://localhost/api/dashboard/analytics/lift`, {
      headers: { Authorization: 'Bearer mock-token' },
    });

    const { GET } = await import('../../dashboard/analytics/lift/route.js');
    const res = await GET(req);
    expect(res.status).toBe(200);

    expect(capturedSql, `SQL missing FOLLOW-371 exclusion predicate:\n${capturedSql}`).toMatch(
      /NOT\s*\(.*holdout_group\s*=\s*1.*AND.*variant.*!=\s*'control'\s*\)/i,
    );
    // Canonical vocabulary guard (Rule K.1).
    expect(capturedSql).not.toContain('dqs_events');
    expect(capturedSql).not.toContain('cta_clicked');
    expect(capturedSql).not.toContain('assigned_at');
  });
});

// ─── calibration route ────────────────────────────────────────────────────────

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  })),
  conversionLabels: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
}));

describe('FOLLOW-371: calibration exclusion filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test:8123';
    authAsTenant();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CLICKHOUSE_URL;
  });

  it('calibration ClickHouse query includes the ESC-026 exclusion predicate', async () => {
    let capturedSql = '';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((urlStr: unknown) => {
        capturedSql = decodeCapturedSql(String(urlStr));
        return Promise.resolve(new Response('', { status: 200 }));
      }),
    );

    const req = new NextRequest(`http://localhost/api/pilot/calibration?window_days=7`, {
      headers: { Authorization: 'Bearer mock-token' },
    });

    const { GET } = await import('../calibration/route.js');
    const res = await GET(req);
    expect(res.status).toBe(200);

    expect(capturedSql, `SQL missing FOLLOW-371 exclusion predicate:\n${capturedSql}`).toMatch(
      /NOT\s*\(.*holdout_group\s*=\s*1.*AND.*variant.*!=\s*'control'\s*\)/i,
    );
    // Canonical vocabulary guard (Rule K.1).
    expect(capturedSql).not.toContain('dqs_events');
    expect(capturedSql).not.toContain('assigned_at');
  });
});
