/**
 * GET /api/admin/tracer/export/events
 *
 * K.3.6 Archetype Identification Tracer — full event payload export (AC7).
 *
 * Always returns JSONL (application/x-ndjson); includes the full event_payload
 * JSON column for each row. For CSV-only export (without event_payload), use
 * GET /api/admin/tracer/export/decisions.
 *
 * Query params (all required):
 *   tenant_id  — UUID
 *   from       — ISO 8601 start datetime
 *   to         — ISO 8601 end datetime
 *
 * Auth: Bearer <ADMIN_API_SECRET> OR Supabase JWT with estalara_staff: true.
 *
 * Rule K.2: configured ClickHouse failure → HTTP 500. ClickHouse unconfigured →
 * 503 Service Unavailable (no mock fallback for export surface).
 *
 * @module apps/control-plane/src/app/api/admin/tracer/export/events/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';

import { verifyTracerAdminAuth } from '@/lib/tracer-auth';
import { resolveClickHouseTracerConfig, fetchIntentEventsForExport } from '@/lib/clickhouse-tracer';

// ─── Query param schema ───────────────────────────────────────────────────────

const QuerySchema = z.object({
  tenant_id: z.string().uuid('tenant_id must be a valid UUID'),
  from: z.string().min(1, 'from is required'),
  to: z.string().min(1, 'to is required'),
});

// ─── GET handler ──────────────────────────────────────────────────────────────

/**
 * GET /api/admin/tracer/export/events
 *
 * Always returns JSONL with full event_payload column.
 *
 * @returns 200 application/x-ndjson on success.
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
  try {
    const rows = await fetchIntentEventsForExport(chCfg, { tenantId: tenant_id, from, to });

    // JSONL — each row includes full event_payload JSON column.
    const jsonl = rows.map((r) => JSON.stringify(r)).join('\n');
    return new Response(jsonl, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Content-Disposition': `attachment; filename="tracer-events-${tenant_id}-${from}-${to}.ndjson"`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, {
      extra: {
        route: 'GET /api/admin/tracer/export/events',
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
}
