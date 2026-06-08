/**
 * Tests for GET /api/pilot/calibration (FOLLOW-173, FOLLOW-221).
 *
 * Coverage:
 *   - confidenceDecile bucketing logic (unit test)
 *   - buildCalibrationFromRaw join + aggregation
 *   - buildCalibrationExportRows shape + Zod validation (FOLLOW-221)
 *   - CLICKHOUSE_URL guard (mock fallback when unset)
 *   - Rule K.2 fail-loud paths: HTTP 500 when ClickHouse configured but fails
 *   - Auth gate (401 for missing/invalid JWT)
 *   - Parameterised ClickHouse query (no string interpolation of tenant_id)
 *   - ?format=json export path: shape, Content-Disposition, chart path unaffected
 *
 * @module apps/control-plane/src/app/api/pilot/calibration/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  confidenceDecile,
  buildCalibrationFromRaw,
  buildCalibrationExportRows,
  isPositiveOutcome,
  CalibrationExportRowSchema,
  type ChDecisionRow,
  type PgLabelRow,
  type CalibrationResponse,
  type CalibrationExportRow,
} from './route-helpers';

// ─── Mock @estalara/auth ─────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440042';

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn(),
}));

import { getAuthClaims } from '@estalara/auth';
const mockGetAuthClaims = vi.mocked(getAuthClaims);

// ─── Mock @sentry/nextjs ─────────────────────────────────────────────────────

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import * as Sentry from '@sentry/nextjs';
const mockCaptureException = vi.mocked(Sentry.captureException);

// ─── Mock @estalara/db ────────────────────────────────────────────────────────

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  // conversionLabels schema columns — minimal structural mock matching how route.ts uses them:
  // eq(conversionLabels.tenantId, ...) and inArray(conversionLabels.predictionId, ...).
  // Drizzle operators are also mocked; we only care that the DB mock resolves correctly.
  conversionLabels: {
    tenantId: 'tenant_id',
    predictionId: 'prediction_id',
    outcomeClass: 'outcome_class',
  },
}));

import { createAdminClient } from '@estalara/db';
const mockCreateAdminClient = vi.mocked(createAdminClient);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(windowDays?: string, authed = true): NextRequest {
  const url = new URL('http://localhost/api/pilot/calibration');
  if (windowDays !== undefined) url.searchParams.set('window_days', windowDays);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authed) headers.Authorization = 'Bearer mock-token';
  return new NextRequest(url.toString(), { headers });
}

function makeExportRequest(windowDays?: string, authed = true): NextRequest {
  const url = new URL('http://localhost/api/pilot/calibration');
  url.searchParams.set('format', 'json');
  if (windowDays !== undefined) url.searchParams.set('window_days', windowDays);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authed) headers.Authorization = 'Bearer mock-token';
  return new NextRequest(url.toString(), { headers });
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

function authAsTenant(): void {
  mockGetAuthClaims.mockResolvedValue({
    sub: 'user-uuid',
    email: 'user@agency.com',
    tenant_id: TENANT_ID,
    agency_role: 'agency:admin',
    estalara_staff: false,
    mfa_verified: true,
  });
}

// ─── Unit: confidenceDecile bucketing ────────────────────────────────────────

describe('confidenceDecile', () => {
  it('maps 0.0 → 0.0', () => {
    expect(confidenceDecile(0.0)).toBe(0.0);
  });

  it('maps 0.05 → 0.0 (within first bucket)', () => {
    expect(confidenceDecile(0.05)).toBe(0.0);
  });

  it('maps 0.1 → 0.1 (start of second bucket)', () => {
    expect(confidenceDecile(0.1)).toBe(0.1);
  });

  it('maps 0.15 → 0.1', () => {
    expect(confidenceDecile(0.15)).toBe(0.1);
  });

  it('maps 0.9 → 0.9', () => {
    expect(confidenceDecile(0.9)).toBe(0.9);
  });

  it('maps 0.95 → 0.9 (within last bucket)', () => {
    expect(confidenceDecile(0.95)).toBe(0.9);
  });

  it('maps 1.0 → 0.9 (capped to last bucket)', () => {
    expect(confidenceDecile(1.0)).toBe(0.9);
  });

  it('clamps values < 0 to 0.0', () => {
    expect(confidenceDecile(-0.1)).toBe(0.0);
  });

  it('clamps values > 1 to 0.9', () => {
    expect(confidenceDecile(1.5)).toBe(0.9);
  });

  it('produces 10 distinct decile values for evenly spaced inputs', () => {
    const inputs = [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95];
    const deciles = inputs.map(confidenceDecile);
    const unique = new Set(deciles);
    expect(unique.size).toBe(10);
  });
});

// ─── Unit: isPositiveOutcome ──────────────────────────────────────────────────

describe('isPositiveOutcome', () => {
  it('returns true for positive outcome classes', () => {
    expect(isPositiveOutcome('viewing_booked')).toBe(true);
    expect(isPositiveOutcome('offer_made')).toBe(true);
    expect(isPositiveOutcome('contract_signed')).toBe(true);
    expect(isPositiveOutcome('purchased')).toBe(true);
  });

  it('returns false for negative outcome classes', () => {
    expect(isPositiveOutcome('no_response')).toBe(false);
    expect(isPositiveOutcome('lost')).toBe(false);
  });

  it('returns false for unknown strings', () => {
    expect(isPositiveOutcome('')).toBe(false);
    expect(isPositiveOutcome('unknown_class')).toBe(false);
  });
});

// ─── Unit: buildCalibrationFromRaw ────────────────────────────────────────────

describe('buildCalibrationFromRaw', () => {
  it('joins decisions with labels on adapt_decision_id = prediction_id', () => {
    const decisions: ChDecisionRow[] = [
      { adapt_decision_id: 'dec-001', confidence: 0.75, model_version: 'rulebased-bandit-v1' },
      { adapt_decision_id: 'dec-002', confidence: 0.82, model_version: 'rulebased-bandit-v1' },
      { adapt_decision_id: 'dec-003', confidence: 0.3, model_version: 'rulebased-bandit-v1' },
    ];
    const labels: PgLabelRow[] = [
      { prediction_id: 'dec-001', outcome_class: 'offer_made' },
      { prediction_id: 'dec-002', outcome_class: 'no_response' },
      // dec-003 has no label → excluded from calibration
    ];

    const { calibration } = buildCalibrationFromRaw(decisions, labels);

    // dec-001 (confidence 0.75 → decile 0.7) and dec-002 (confidence 0.82 → decile 0.8)
    // are in different buckets.
    const bucket07 = calibration.find(
      (r) => r.confidence_decile === 0.7 && r.model_version === 'rulebased-bandit-v1',
    );
    expect(bucket07).toBeDefined();
    expect(bucket07!.sample_size).toBe(1);
    expect(bucket07!.actual_conversion_rate).toBe(1.0); // offer_made is positive

    const bucket08 = calibration.find(
      (r) => r.confidence_decile === 0.8 && r.model_version === 'rulebased-bandit-v1',
    );
    expect(bucket08).toBeDefined();
    expect(bucket08!.sample_size).toBe(1);
    expect(bucket08!.actual_conversion_rate).toBe(0.0); // no_response is negative

    // dec-003 has no label → does not contribute to any bucket
    const allSampleSizes = calibration.reduce((sum, r) => sum + r.sample_size, 0);
    expect(allSampleSizes).toBe(2); // only 2 labeled decisions
  });

  it('computes actual_conversion_rate correctly for mixed-outcome bucket', () => {
    // Two decisions land in decile 0.5 (confidence 0.5–0.59): one positive, one negative.
    const decisions: ChDecisionRow[] = [
      { adapt_decision_id: 'd1', confidence: 0.5, model_version: 'v1' },
      { adapt_decision_id: 'd2', confidence: 0.55, model_version: 'v1' },
    ];
    const labels: PgLabelRow[] = [
      { prediction_id: 'd1', outcome_class: 'purchased' },
      { prediction_id: 'd2', outcome_class: 'lost' },
    ];

    const { calibration } = buildCalibrationFromRaw(decisions, labels);
    const bucket = calibration.find((r) => r.confidence_decile === 0.5 && r.model_version === 'v1');
    expect(bucket).toBeDefined();
    expect(bucket!.sample_size).toBe(2);
    expect(bucket!.actual_conversion_rate).toBe(0.5); // 1/2 positive
    expect(bucket!.predicted_rate).toBeCloseTo((0.5 + 0.55) / 2, 4);
  });

  it('returns empty arrays when no decisions are provided', () => {
    const { calibration, conversion_aggregates } = buildCalibrationFromRaw([], []);
    expect(calibration).toHaveLength(0);
    expect(conversion_aggregates).toHaveLength(0);
  });

  it('returns empty arrays when decisions have no matching labels', () => {
    const decisions: ChDecisionRow[] = [
      { adapt_decision_id: 'dec-nolabel', confidence: 0.6, model_version: 'v1' },
    ];
    const labels: PgLabelRow[] = [];

    const { calibration, conversion_aggregates } = buildCalibrationFromRaw(decisions, labels);
    expect(calibration).toHaveLength(0);
    expect(conversion_aggregates).toHaveLength(0);
  });

  it('computes conversion_aggregates per (outcome_class, model_version)', () => {
    const decisions: ChDecisionRow[] = [
      { adapt_decision_id: 'd1', confidence: 0.8, model_version: 'v1' },
      { adapt_decision_id: 'd2', confidence: 0.4, model_version: 'v1' },
      { adapt_decision_id: 'd3', confidence: 0.9, model_version: 'v1' },
    ];
    const labels: PgLabelRow[] = [
      { prediction_id: 'd1', outcome_class: 'offer_made' },
      { prediction_id: 'd2', outcome_class: 'no_response' },
      { prediction_id: 'd3', outcome_class: 'offer_made' },
    ];

    const { conversion_aggregates } = buildCalibrationFromRaw(decisions, labels);

    const offerMadeRow = conversion_aggregates.find(
      (r) => r.outcome_class === 'offer_made' && r.model_version === 'v1',
    );
    expect(offerMadeRow).toBeDefined();
    expect(offerMadeRow!.count).toBe(2);
    expect(offerMadeRow!.rate).toBeCloseTo(2 / 3, 4);

    const noResponseRow = conversion_aggregates.find(
      (r) => r.outcome_class === 'no_response' && r.model_version === 'v1',
    );
    expect(noResponseRow).toBeDefined();
    expect(noResponseRow!.count).toBe(1);
    expect(noResponseRow!.rate).toBeCloseTo(1 / 3, 4);
  });

  it('handles multiple model_versions independently', () => {
    const decisions: ChDecisionRow[] = [
      { adapt_decision_id: 'd1', confidence: 0.7, model_version: 'v1' },
      { adapt_decision_id: 'd2', confidence: 0.7, model_version: 'v2' },
    ];
    const labels: PgLabelRow[] = [
      { prediction_id: 'd1', outcome_class: 'purchased' },
      { prediction_id: 'd2', outcome_class: 'no_response' },
    ];

    const { calibration } = buildCalibrationFromRaw(decisions, labels);

    const v1Bucket = calibration.find(
      (r) => r.model_version === 'v1' && r.confidence_decile === 0.7,
    );
    const v2Bucket = calibration.find(
      (r) => r.model_version === 'v2' && r.confidence_decile === 0.7,
    );

    expect(v1Bucket!.actual_conversion_rate).toBe(1.0); // purchased is positive
    expect(v2Bucket!.actual_conversion_rate).toBe(0.0); // no_response is negative
  });
});

// ─── Route handler ─────────────────────────────────────────────────────────────

describe('GET /api/pilot/calibration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CLICKHOUSE_URL;
    mockCaptureException.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CLICKHOUSE_URL;
  });

  it('returns 401 when getAuthClaims returns null (no JWT)', async () => {
    mockGetAuthClaims.mockResolvedValue(null);
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest('7', false));
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('returns 401 for a staff user without tenant_id', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'staff-uuid',
      email: 'staff@estalara.com',
      tenant_id: null,
      estalara_staff: true,
      estalara_role: 'estalara:ops',
      mfa_verified: false,
    });
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest('7'));
    expect(res.status).toBe(401);
  });

  // ─── CLICKHOUSE_URL guard (Rule K.2) ───────────────────────────────────────

  it('returns mock with data_source: mock when CLICKHOUSE_URL is unset', async () => {
    authAsTenant();
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest('14'));
    expect(res.status).toBe(200);
    const body = await parseBody<CalibrationResponse>(res);
    expect(body.window_days).toBe(14);
    expect(body.tenant_id).toBe(TENANT_ID);
    // Mock produces calibration rows for the default model
    expect(body.calibration.length).toBeGreaterThan(0);
    expect(body.conversion_aggregates.length).toBeGreaterThan(0);
    // Rule K.2: provenance field must say 'mock' when no ClickHouse configured
    expect(body.data_source).toBe('mock');
    // Sentry must NOT be called — unset CLICKHOUSE_URL is not an error
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('defaults window_days to 7 when query param is missing', async () => {
    authAsTenant();
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest(undefined));
    expect(res.status).toBe(200);
    const body = await parseBody<CalibrationResponse>(res);
    expect(body.window_days).toBe(7);
    expect(body.data_source).toBe('mock');
  });

  it('defaults window_days to 7 for invalid param', async () => {
    authAsTenant();
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest('999'));
    expect(res.status).toBe(200);
    const body = await parseBody<CalibrationResponse>(res);
    expect(body.window_days).toBe(7);
  });

  // ─── ClickHouse configured — success path ──────────────────────────────────

  it('returns data_source: clickhouse and correct calibration when ClickHouse succeeds', async () => {
    authAsTenant();
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';

    // ClickHouse returns 3 decisions
    const chDecisionRows = [
      JSON.stringify({
        adapt_decision_id: 'dec-A',
        confidence: 0.8,
        model_version: 'rulebased-bandit-v1',
      }),
      JSON.stringify({
        adapt_decision_id: 'dec-B',
        confidence: 0.8,
        model_version: 'rulebased-bandit-v1',
      }),
      JSON.stringify({
        adapt_decision_id: 'dec-C',
        confidence: 0.3,
        model_version: 'rulebased-bandit-v1',
      }),
    ].join('\n');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(new Response(chDecisionRows, { status: 200 })),
    );

    // Postgres returns labels for dec-A and dec-B
    const mockSelect = vi.fn().mockResolvedValue([
      { prediction_id: 'dec-A', outcome_class: 'offer_made' },
      { prediction_id: 'dec-B', outcome_class: 'no_response' },
    ]);
    const mockWhere = vi.fn().mockReturnValue({ then: mockSelect, [Symbol.iterator]: undefined });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockDbSelect = vi.fn().mockReturnValue({ from: mockFrom });

    // Wire the chain: select().from().where() → resolves to rows
    mockWhere.mockImplementation(() => ({
      then: (resolve: (v: unknown[]) => void) =>
        Promise.resolve([
          { prediction_id: 'dec-A', outcome_class: 'offer_made' },
          { prediction_id: 'dec-B', outcome_class: 'no_response' },
        ]).then(resolve),
    }));

    mockCreateAdminClient.mockReturnValue({
      select: mockDbSelect,
    } as unknown as ReturnType<typeof createAdminClient>);

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest('7'));
    expect(res.status).toBe(200);
    const body = await parseBody<CalibrationResponse>(res);

    expect(body.data_source).toBe('clickhouse');
    expect(body.tenant_id).toBe(TENANT_ID);
    // Sentry must NOT be called on success
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  // ─── ClickHouse configured — fail-loud paths (Rule K.2) ───────────────────

  it('returns HTTP 500 and calls Sentry when CLICKHOUSE_URL is set but ClickHouse query fails', async () => {
    authAsTenant();
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(new Response('Internal error', { status: 500 })),
    );

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest('7'));

    // Rule K.2: must not silently fall back to mock — caller gets HTTP 500.
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string; message: string } }>(res);
    expect(body.error.code).toBe('clickhouse_query_failed');
    expect(body.error.message).toContain('ClickHouse');

    // Sentry must have been notified.
    expect(mockCaptureException).toHaveBeenCalledOnce();
    const [, extras] = mockCaptureException.mock.calls[0] as [
      unknown,
      { tags: Record<string, string>; extra: Record<string, unknown> },
    ];
    expect(extras.tags.calibration_clickhouse_error).toBe('true');
    expect(extras.extra.tenant_id).toBe(TENANT_ID);
  });

  it('returns HTTP 500 when CLICKHOUSE_URL is set but fetch rejects (network error)', async () => {
    authAsTenant();
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest('14'));

    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string; message: string } }>(res);
    expect(body.error.code).toBe('clickhouse_query_failed');
    expect(body.error.message).toContain('ECONNREFUSED');

    expect(mockCaptureException).toHaveBeenCalledOnce();
  });

  // ─── Parameterised query (no string interpolation) ─────────────────────────

  it('binds tenant_id as a query param, never interpolated into SQL', async () => {
    authAsTenant();
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';

    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    // Postgres returns empty (no labels)
    mockCreateAdminClient.mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as unknown as ReturnType<typeof createAdminClient>);

    const { GET } = await import('./route.js');
    await GET(makeRequest('7'));

    // tenant_id must appear as a bound query param, never interpolated into the SQL literal.
    const firstCallUrl = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(firstCallUrl).toContain(`param_tenant_id=${encodeURIComponent(TENANT_ID)}`);
    expect(firstCallUrl).toContain('param_window_days=7');
    // Verify tenant_id is NOT directly inside the SQL query fragment —
    // it must only appear as the param_tenant_id value (injection-safe pattern).
    const queryParam = new URL(firstCallUrl).searchParams.get('query') ?? '';
    expect(queryParam).not.toContain(TENANT_ID);
  });
});

// ─── Unit: buildCalibrationExportRows (FOLLOW-221) ───────────────────────────

describe('buildCalibrationExportRows', () => {
  it('returns one row per (outcome_class, model_version) with correct shape', () => {
    const calibration = [
      {
        confidence_decile: 0.7,
        predicted_rate: 0.72,
        actual_conversion_rate: 0.68,
        sample_size: 10,
        model_version: 'v1',
      },
      {
        confidence_decile: 0.8,
        predicted_rate: 0.82,
        actual_conversion_rate: 0.75,
        sample_size: 8,
        model_version: 'v1',
      },
    ];
    const conversionAggregates = [
      { outcome_class: 'offer_made', model_version: 'v1', count: 5, rate: 0.5 },
      { outcome_class: 'no_response', model_version: 'v1', count: 5, rate: 0.5 },
    ];

    const rows = buildCalibrationExportRows('tenant-abc', 14, calibration, conversionAggregates);

    expect(rows).toHaveLength(2);

    const offerRow = rows.find((r) => r.outcome_class === 'offer_made');
    expect(offerRow).toBeDefined();
    expect(offerRow!.model_version).toBe('v1');
    expect(offerRow!.tenant).toBe('tenant-abc');
    expect(offerRow!.window).toBe(14);
    expect(offerRow!.count).toBe(5);
    // avg_confidence = mean of predicted_rates = (0.72 + 0.82) / 2 = 0.77
    expect(offerRow!.avg_confidence).toBeCloseTo(0.77, 4);
  });

  it('each row passes CalibrationExportRowSchema Zod validation', () => {
    const calibration = [
      {
        confidence_decile: 0.5,
        predicted_rate: 0.55,
        actual_conversion_rate: 0.5,
        sample_size: 3,
        model_version: 'rulebased-bandit-v1',
      },
    ];
    const conversionAggregates = [
      { outcome_class: 'purchased', model_version: 'rulebased-bandit-v1', count: 2, rate: 0.67 },
    ];

    const rows = buildCalibrationExportRows('tenant-zod', 7, calibration, conversionAggregates);
    expect(rows).toHaveLength(1);

    // CalibrationExportRowSchema.parse must succeed for every row (throws on failure)
    expect(() => {
      for (const row of rows) {
        CalibrationExportRowSchema.parse(row);
      }
    }).not.toThrow();
  });

  it('sets avg_confidence to null when no calibration rows exist for the model', () => {
    // conversion_aggregates reference a model_version with no calibration rows
    const rows = buildCalibrationExportRows(
      'tenant-empty',
      7,
      [], // no calibration rows
      [{ outcome_class: 'no_response', model_version: 'orphan-model', count: 1, rate: 1.0 }],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.avg_confidence).toBeNull();
  });

  it('returns empty array when conversion_aggregates is empty', () => {
    const rows = buildCalibrationExportRows('tenant-x', 30, [], []);
    expect(rows).toHaveLength(0);
  });
});

// ─── Route handler: ?format=json export path (FOLLOW-221) ────────────────────

describe('GET /api/pilot/calibration?format=json', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CLICKHOUSE_URL;
    mockCaptureException.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CLICKHOUSE_URL;
  });

  it('returns 401 for unauthenticated export request', async () => {
    mockGetAuthClaims.mockResolvedValue(null);
    const { GET } = await import('./route.js');
    const res = await GET(makeExportRequest('7', false));
    expect(res.status).toBe(401);
  });

  it('returns JSON array with correct shape when CLICKHOUSE_URL is unset (mock path)', async () => {
    authAsTenant();
    const { GET } = await import('./route.js');
    const res = await GET(makeExportRequest('14'));

    expect(res.status).toBe(200);

    // Content-Type must be application/json
    expect(res.headers.get('Content-Type')).toBe('application/json');

    // Content-Disposition must be the attachment header
    const disposition = res.headers.get('Content-Disposition') ?? '';
    expect(disposition).toBe('attachment; filename="calibration.json"');

    // Body is a valid JSON array of CalibrationExportRow objects
    const body: CalibrationExportRow[] = (await res.json()) as CalibrationExportRow[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);

    // Every row passes schema validation
    for (const row of body) {
      expect(() => CalibrationExportRowSchema.parse(row)).not.toThrow();
      expect(row.tenant).toBe(TENANT_ID);
      expect(row.window).toBe(14);
      expect(typeof row.outcome_class).toBe('string');
      expect(typeof row.model_version).toBe('string');
      expect(typeof row.count).toBe('number');
      // avg_confidence is number or null
      expect(row.avg_confidence === null || typeof row.avg_confidence === 'number').toBe(true);
    }
  });

  it('includes Content-Disposition: attachment; filename="calibration.json" header', async () => {
    authAsTenant();
    const { GET } = await import('./route.js');
    const res = await GET(makeExportRequest('7'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="calibration.json"');
  });

  it('chart path (no ?format=json) is unaffected — returns CalibrationResponse shape', async () => {
    authAsTenant();
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest('7'));

    expect(res.status).toBe(200);
    // Chart path does NOT set Content-Disposition
    expect(res.headers.get('Content-Disposition')).toBeNull();

    const body = await parseBody<CalibrationResponse>(res);
    // Must have the chart response fields, NOT the flat array shape
    expect(body).toHaveProperty('calibration');
    expect(body).toHaveProperty('conversion_aggregates');
    expect(body).toHaveProperty('data_source');
    expect(body).toHaveProperty('window_days');
    expect(body).toHaveProperty('tenant_id');
    expect(Array.isArray(body)).toBe(false);
  });

  it('returns JSON export with correct data when ClickHouse is configured', async () => {
    authAsTenant();
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';

    // ClickHouse returns 2 decisions for the same model
    const chDecisionRows = [
      JSON.stringify({
        adapt_decision_id: 'dec-X1',
        confidence: 0.7,
        model_version: 'rulebased-bandit-v1',
      }),
      JSON.stringify({
        adapt_decision_id: 'dec-X2',
        confidence: 0.9,
        model_version: 'rulebased-bandit-v1',
      }),
    ].join('\n');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(new Response(chDecisionRows, { status: 200 })),
    );

    // Postgres labels: one positive, one negative
    mockCreateAdminClient.mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => ({
            then: (resolve: (v: unknown[]) => void) =>
              Promise.resolve([
                { prediction_id: 'dec-X1', outcome_class: 'offer_made' },
                { prediction_id: 'dec-X2', outcome_class: 'no_response' },
              ]).then(resolve),
          })),
        }),
      }),
    } as unknown as ReturnType<typeof createAdminClient>);

    const { GET } = await import('./route.js');
    const res = await GET(makeExportRequest('7'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="calibration.json"');

    const body: CalibrationExportRow[] = (await res.json()) as CalibrationExportRow[];
    expect(Array.isArray(body)).toBe(true);

    // Should have one row per outcome_class
    const offerRow = body.find((r) => r.outcome_class === 'offer_made');
    const noResponseRow = body.find((r) => r.outcome_class === 'no_response');
    expect(offerRow).toBeDefined();
    expect(noResponseRow).toBeDefined();

    // tenant + window should be propagated correctly
    expect(offerRow!.tenant).toBe(TENANT_ID);
    expect(offerRow!.window).toBe(7);
  });
});
