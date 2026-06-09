/**
 * Tests for GET /api/admin/labels/export (FOLLOW-175).
 *
 * Coverage:
 *   (a) CSV format output shape
 *   (b) JSONL format output shape
 *   (c) PII exclusion — lead_id, outcome_raw, notes absent from output
 *   (d) data_source: 'mock' in-body + X-Data-Source: mock header when DATABASE_URL_ADMIN unset
 *   (e) 400 on unknown format value
 *   (f) 401 on missing JWT
 *   + 400 for staff with no tenant_id param
 *   + 500 when Postgres configured-but-fails (Rule K.2)
 *   + 500 when ClickHouse configured-but-fails (Rule K.2)
 *   + Postgres-only rows (features_snapshot: null) when CLICKHOUSE_URL unset
 *   + ClickHouse join populates features_snapshot when configured
 *
 * @module apps/control-plane/src/app/api/admin/labels/export/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { ExportRow } from './route.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440042';
const PRED_UUID = 'aaaabbbb-cccc-dddd-eeee-ffffffffffff';

// ─── Mock modules ─────────────────────────────────────────────────────────────

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn(),
  isStaffClaims: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  conversionLabels: {
    tenantId: 'tenant_id',
    predictionId: 'prediction_id',
    outcomeClass: 'outcome_class',
    labelSource: 'label_source',
    labeledAt: 'labeled_at',
  },
  staffAuditLog: {
    adminUserId: 'admin_user_id',
    action: 'action',
    targetTenantId: 'target_tenant_id',
    payload: 'payload',
  },
}));

import { getAuthClaims, isStaffClaims } from '@estalara/auth';
import * as Sentry from '@sentry/nextjs';
import { createAdminClient } from '@estalara/db';

const mockGetAuthClaims = vi.mocked(getAuthClaims);
const mockIsStaffClaims = vi.mocked(isStaffClaims);
const mockCreateAdminClient = vi.mocked(createAdminClient);
const mockCaptureException = vi.mocked(Sentry.captureException);

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function agencyAuth(tenantId = TENANT_ID): void {
  mockGetAuthClaims.mockResolvedValue({
    sub: 'user-uuid',
    email: 'user@agency.com',
    tenant_id: tenantId,
    agency_role: 'agency:owner',
    estalara_staff: false,
    mfa_verified: true,
  });
  mockIsStaffClaims.mockReturnValue(false);
}

function staffAuth(): void {
  mockGetAuthClaims.mockResolvedValue({
    sub: 'staff-uuid',
    email: 'staff@estalara.com',
    tenant_id: null,
    estalara_staff: true,
    estalara_role: 'estalara:ops',
    mfa_verified: true,
  });
  mockIsStaffClaims.mockReturnValue(true);
}

// ─── Request factory ──────────────────────────────────────────────────────────

function makeExportRequest(params?: Record<string, string>, authed = true): NextRequest {
  const url = new URL('http://localhost/api/admin/labels/export');
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const headers: Record<string, string> = {};
  if (authed) headers.Authorization = 'Bearer mock-token';
  return new NextRequest(url.toString(), { headers });
}

// ─── DB mock factory ──────────────────────────────────────────────────────────

function mockDbWithLabels(
  labels: {
    prediction_id: string;
    outcome_class: string;
    label_source: string;
    labeled_at: Date;
  }[],
) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue(labels),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('GET /api/admin/labels/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL_DIRECT;
    delete process.env.CLICKHOUSE_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL_DIRECT;
    delete process.env.CLICKHOUSE_URL;
  });

  // ── (f) 401 on missing JWT ─────────────────────────────────────────────────

  it('(f) returns 401 when JWT is absent', async () => {
    mockGetAuthClaims.mockResolvedValue(null);
    const { GET } = await import('./route.js');
    const res = await GET(makeExportRequest(undefined, false));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unauthorized');
  });

  // ── (e) 400 on unknown format ──────────────────────────────────────────────

  it('(e) returns 400 for unknown format value', async () => {
    agencyAuth();
    const { GET } = await import('./route.js');
    const res = await GET(makeExportRequest({ format: 'parquet' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('validation_error');
  });

  // ── 400 for staff missing tenant_id param ──────────────────────────────────

  it('returns 400 when staff caller omits tenant_id param', async () => {
    staffAuth();
    const { GET } = await import('./route.js');
    const res = await GET(makeExportRequest());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('validation_error');
  });

  // ── (d) Mock path when DATABASE_URL_ADMIN unset ────────────────────────────

  it('(d) returns X-Data-Source: mock with 3 sample rows when DATABASE_URL_ADMIN is unset', async () => {
    agencyAuth();
    const { GET } = await import('./route.js');
    const res = await GET(makeExportRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Data-Source')).toBe('mock');
    expect(Number(res.headers.get('X-Row-Count'))).toBe(3);
    // Rule K.2 amendment: data_source must be in-body (header-only is lost on download)
    const text = await res.text();
    expect(text.split('\n')[0]).toContain('data_source');
    expect(text).toContain('"mock"');
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
  });

  it('(d) mock path with jsonl format returns 3 JSONL lines with in-body data_source', async () => {
    agencyAuth();
    const { GET } = await import('./route.js');
    const res = await GET(makeExportRequest({ format: 'jsonl' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Data-Source')).toBe('mock');
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
    const text = await res.text();
    const lines = text.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);
    const parsed = JSON.parse(lines[0]!) as ExportRow & { data_source: string };
    expect(parsed.prediction_id).toBe('mock-pred-001');
    // Rule K.2 amendment: data_source must be in the JSONL body, not just the header
    expect(parsed.data_source).toBe('mock');
    // PII fields must be absent
    expect(parsed).not.toHaveProperty('lead_id');
    expect(parsed).not.toHaveProperty('outcome_raw');
    expect(parsed).not.toHaveProperty('notes');
    expect(parsed).not.toHaveProperty('tenant_id');
    expect(parsed).not.toHaveProperty('id');
  });

  // ── (b) JSONL format output shape ─────────────────────────────────────────

  it('(b) returns JSONL format with correct shape when DB configured', async () => {
    agencyAuth();
    process.env.DATABASE_URL_ADMIN = 'postgres://test';

    const mockDb = mockDbWithLabels([
      {
        prediction_id: PRED_UUID,
        outcome_class: 'viewing_booked',
        label_source: 'system',
        labeled_at: new Date('2026-06-01T10:00:00Z'),
      },
    ]);
    mockCreateAdminClient.mockReturnValue(mockDb);

    const { GET } = await import('./route.js');
    const res = await GET(makeExportRequest({ format: 'jsonl' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    expect(res.headers.get('X-Data-Source')).toBe('real');

    const text = await res.text();
    const lines = text.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);

    const row = JSON.parse(lines[0]!) as ExportRow & { data_source: string };
    expect(row.prediction_id).toBe(PRED_UUID);
    expect(row.outcome_class).toBe('viewing_booked');
    expect(row.label_source).toBe('system');
    expect(row.labeled_at).toBe('2026-06-01T10:00:00.000Z');
    expect(row.features_snapshot).toBeNull(); // CLICKHOUSE_URL not set
    expect(row.model_version).toBe('');
    expect(row.confidence).toBe(0);
    expect(row.archetype).toBe('');
    // Rule K.2 amendment: data_source must be in-body
    expect(row.data_source).toBe('real');
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
  });

  // ── (a) CSV format output shape ────────────────────────────────────────────

  it('(a) returns CSV format with header row and data rows', async () => {
    agencyAuth();
    process.env.DATABASE_URL_ADMIN = 'postgres://test';

    const mockDb = mockDbWithLabels([
      {
        prediction_id: PRED_UUID,
        outcome_class: 'offer_made',
        label_source: 'manual_admin',
        labeled_at: new Date('2026-06-02T14:30:00Z'),
      },
    ]);
    mockCreateAdminClient.mockReturnValue(mockDb);

    const { GET } = await import('./route.js');
    const res = await GET(makeExportRequest({ format: 'csv' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('X-Data-Source')).toBe('real');

    const text = await res.text();
    const lines = text.split('\n');
    // First line is the CSV header — data_source is the first column (Rule K.2 amendment)
    expect(lines[0]).toBe(
      'data_source,prediction_id,features_snapshot,model_version,confidence,archetype,outcome_class,label_source,labeled_at',
    );
    // Second line is the data row
    expect(lines[1]).toContain(PRED_UUID);
    expect(lines[1]).toContain('offer_made');
    expect(lines[1]).toContain('manual_admin');
    // In-body data_source
    expect(lines[1]).toContain('"real"');
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
  });

  it('(a) CSV default format when format param is omitted', async () => {
    agencyAuth();
    process.env.DATABASE_URL_ADMIN = 'postgres://test';

    const mockDb = mockDbWithLabels([]);
    mockCreateAdminClient.mockReturnValue(mockDb);

    const { GET } = await import('./route.js');
    const res = await GET(makeExportRequest()); // no format param → csv
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    const text = await res.text();
    expect(text.startsWith('data_source,')).toBe(true);
  });

  // ── (c) PII exclusion ─────────────────────────────────────────────────────

  it('(c) JSONL rows never contain lead_id, outcome_raw, notes, id, or tenant_id', async () => {
    agencyAuth();
    process.env.DATABASE_URL_ADMIN = 'postgres://test';

    const mockDb = mockDbWithLabels([
      {
        prediction_id: PRED_UUID,
        outcome_class: 'purchased',
        label_source: 'manual_admin',
        labeled_at: new Date('2026-06-05T12:00:00Z'),
      },
    ]);
    mockCreateAdminClient.mockReturnValue(mockDb);

    const { GET } = await import('./route.js');
    const res = await GET(makeExportRequest({ format: 'jsonl' }));
    expect(res.status).toBe(200);

    const text = await res.text();
    const row = JSON.parse(text.trim()) as Record<string, unknown>;

    // PII fields that must be absent
    expect(row).not.toHaveProperty('lead_id');
    expect(row).not.toHaveProperty('outcome_raw');
    expect(row).not.toHaveProperty('notes');
    expect(row).not.toHaveProperty('id');
    expect(row).not.toHaveProperty('tenant_id');
  });

  // ── 500 when Postgres configured-but-fails (Rule K.2) ─────────────────────

  it('returns 500 and calls Sentry when Postgres is configured but throws', async () => {
    agencyAuth();
    process.env.DATABASE_URL_ADMIN = 'postgres://test';

    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockRejectedValue(new Error('connection refused')),
          }),
        }),
      }),
    };
    mockCreateAdminClient.mockReturnValue(mockDb);

    const { GET } = await import('./route.js');
    const res = await GET(makeExportRequest());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('postgres_query_failed');
    expect(mockCaptureException).toHaveBeenCalledOnce();
  });

  // ── 500 when ClickHouse configured-but-fails (Rule K.2) ───────────────────

  it('returns 500 and calls Sentry when ClickHouse is configured but fetch fails', async () => {
    agencyAuth();
    process.env.DATABASE_URL_ADMIN = 'postgres://test';
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';

    const mockDb = mockDbWithLabels([
      {
        prediction_id: PRED_UUID,
        outcome_class: 'viewing_booked',
        label_source: 'system',
        labeled_at: new Date('2026-06-01T10:00:00Z'),
      },
    ]);
    mockCreateAdminClient.mockReturnValue(mockDb);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('CH error', { status: 500 })));

    const { GET } = await import('./route.js');
    const res = await GET(makeExportRequest());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('clickhouse_query_failed');
    expect(mockCaptureException).toHaveBeenCalledOnce();
  });

  // ── Postgres-only path (CLICKHOUSE_URL absent) ─────────────────────────────

  it('returns features_snapshot:null when CLICKHOUSE_URL is not configured', async () => {
    agencyAuth();
    process.env.DATABASE_URL_ADMIN = 'postgres://test';
    // CLICKHOUSE_URL is intentionally absent

    const mockDb = mockDbWithLabels([
      {
        prediction_id: PRED_UUID,
        outcome_class: 'lost',
        label_source: 'system',
        labeled_at: new Date('2026-06-04T09:00:00Z'),
      },
    ]);
    mockCreateAdminClient.mockReturnValue(mockDb);

    const { GET } = await import('./route.js');
    const res = await GET(makeExportRequest({ format: 'jsonl' }));
    expect(res.status).toBe(200);

    const text = await res.text();
    const row = JSON.parse(text.trim()) as ExportRow;
    expect(row.features_snapshot).toBeNull();
    expect(row.outcome_class).toBe('lost');
  });

  // ── ClickHouse join populates features_snapshot ────────────────────────────

  it('populates features_snapshot from ClickHouse when CLICKHOUSE_URL is configured', async () => {
    agencyAuth();
    process.env.DATABASE_URL_ADMIN = 'postgres://test';
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';

    const mockDb = mockDbWithLabels([
      {
        prediction_id: PRED_UUID,
        outcome_class: 'contract_signed',
        label_source: 'manual_admin',
        labeled_at: new Date('2026-06-03T11:00:00Z'),
      },
    ]);
    mockCreateAdminClient.mockReturnValue(mockDb);

    // Mock ClickHouse returning a row with features_snapshot
    const chRow = {
      adapt_decision_id: PRED_UUID,
      archetype: 'luxury_buyer',
      confidence: 0.91,
      model_version: 'rulebased-bandit-v1',
      features_snapshot: JSON.stringify({ price_band: 'premium', bedrooms: 4 }),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(chRow), { status: 200 })),
    );

    const { GET } = await import('./route.js');
    const res = await GET(makeExportRequest({ format: 'jsonl' }));
    expect(res.status).toBe(200);

    const text = await res.text();
    const row = JSON.parse(text.trim()) as ExportRow;
    expect(row.archetype).toBe('luxury_buyer');
    expect(row.model_version).toBe('rulebased-bandit-v1');
    expect(row.confidence).toBe(0.91);
    expect(row.features_snapshot).toEqual({ price_band: 'premium', bedrooms: 4 });
    // PII still absent
    expect(row).not.toHaveProperty('lead_id');
    expect(row).not.toHaveProperty('tenant_id');
  });

  // ── Staff can supply tenant_id param ──────────────────────────────────────

  it('staff caller with tenant_id param gets scoped export', async () => {
    staffAuth();
    process.env.DATABASE_URL_ADMIN = 'postgres://test';

    const mockDb = mockDbWithLabels([]);
    mockCreateAdminClient.mockReturnValue(mockDb);

    const { GET } = await import('./route.js');
    const res = await GET(makeExportRequest({ tenant_id: TENANT_ID }));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Data-Source')).toBe('real');
  });
});
