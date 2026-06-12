/**
 * GET /api/admin/tracer/export/decisions
 *
 * K.3.6 Archetype Identification Tracer — decision export (AC6).
 *
 * Streams intent_events for a tenant+time range. Supports two output formats:
 *   - Accept: text/csv        → CSV (rows without full event_payload JSON)
 *   - Default                 → JSONL (application/x-ndjson)
 *
 * Query params (all required):
 *   tenant_id  — UUID
 *   from       — ISO 8601 start datetime
 *   to         — ISO 8601 end datetime
 *
 * Auth: Bearer <ADMIN_API_SECRET> OR Supabase JWT with estalara_staff: true.
 *
 * Rule K.2: configured ClickHouse failure → HTTP 500. ClickHouse unconfigured →
 * 503 Service Unavailable (export has no sensible mock fallback at the export
 * surface — returning fake CSV/JSONL would constitute fabricating export data).
 *
 * @module apps/control-plane/src/app/api/admin/tracer/export/decisions/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';

import { verifyTracerAdminAuth } from '@/lib/tracer-auth';
import { resolveClickHouseTracerConfig, fetchIntentEventsForExport } from '@/lib/clickhouse-tracer';
import type { IntentEventRow } from '@estalara/shared';

// ─── Query param schema ───────────────────────────────────────────────────────

const QuerySchema = z.object({
  tenant_id: z.string().uuid('tenant_id must be a valid UUID'),
  from: z.string().min(1, 'from is required'),
  to: z.string().min(1, 'to is required'),
});

// ─── CSV helpers ──────────────────────────────────────────────────────────────

const CSV_HEADERS = [
  'session_id',
  'tenant_id',
  'event_at',
  'event_type',
  'confidence_before',
  'confidence_after',
  'top_archetype',
  'archetype_deltas',
] as const;

function escapeCSVField(val: string | number): string {
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowToCSV(row: IntentEventRow): string {
  return CSV_HEADERS.map((col) => escapeCSVField(row[col as keyof IntentEventRow])).join(',');
}

// ─── GET handler ──────────────────────────────────────────────────────────────

/**
 * GET /api/admin/tracer/export/decisions
 *
 * @returns 200 text/csv or application/x-ndjson (JSONL) on success.
 * @returns 400 on missing/invalid params.
 * @returns 401/403 if auth fails.
 * @returns 503 if ClickHouse is not configured.
 * @returns 500 if ClickHouse is configured but fails.
 */
export async function GET(req: NextRequest): Promise<NextResponse | Response> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authResult = await verifyTracerAdminAuth(req);
  if (!authResult.ok) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: authResult.message } },
      { status: authResult.status },
    );
  }

  // ── Validate query params ─────────────────────────────────────────────────
  const rawParams = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = QuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation_error', details: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const { tenant_id, from, to } = parsed.data;

  // ── ClickHouse required for export ────────────────────────────────────────
  const chCfg = resolveClickHouseTracerConfig();
  if (!chCfg) {
    return NextResponse.json(
      {
        error: {
          code: 'clickhouse_unavailable',
          message:
            'ClickHouse not configured — export unavailable in this environment. ' +
            'data_source: unconfigured',
        },
        data_source: 'unconfigured',
      },
      { status: 503 },
    );
  }

  // ── Fetch events from ClickHouse ──────────────────────────────────────────
  let rows: IntentEventRow[];
  try {
    rows = await fetchIntentEventsForExport(chCfg, { tenantId: tenant_id, from, to });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, {
      extra: {
        route: 'GET /api/admin/tracer/export/decisions',
        tenantId: tenant_id,
        from,
        to,
        message,
      },
    });
    return NextResponse.json(
      {
        error: {
          code: 'clickhouse_error',
          message: 'ClickHouse query failed — see Sentry for details',
        },
        data_source: 'error',
      },
      { status: 500 },
    );
  }

  // ── Determine output format ────────────────────────────────────────────────
  const acceptHeader = req.headers.get('Accept') ?? '';
  const wantCsv = acceptHeader.includes('text/csv');

  if (wantCsv) {
    const lines = [CSV_HEADERS.join(','), ...rows.map(rowToCSV)];
    return new Response(lines.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="tracer-decisions-${tenant_id}-${from}-${to}.csv"`,
      },
    });
  }

  // Default: JSONL (application/x-ndjson)
  const jsonl = rows.map((r) => JSON.stringify(r)).join('\n');
  return new Response(jsonl, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Content-Disposition': `attachment; filename="tracer-decisions-${tenant_id}-${from}-${to}.ndjson"`,
    },
  });
}
