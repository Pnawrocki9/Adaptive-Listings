/**
 * GET /api/admin/tracer/history
 *
 * K.3.6 Archetype Identification Tracer — paginated event history (AC4).
 *
 * Paginated ClickHouse query of intent_events with tenant/session/time/archetype filters.
 *
 * Query params:
 *   tenant_id  (required)
 *   session_id (optional)
 *   from       (optional, ISO 8601)
 *   to         (optional, ISO 8601)
 *   archetype  (optional)
 *   limit      (default 50, max 200)
 *   offset     (default 0)
 *
 * Auth: Bearer <ADMIN_API_SECRET> OR Supabase JWT with estalara_staff: true.
 *
 * Rule K.2: configured ClickHouse failure → HTTP 500, never mock.
 * ClickHouse unconfigured → 200 with data_source: 'mock' (observable).
 *
 * @module apps/control-plane/src/app/api/admin/tracer/history/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';

import type { TracerHistoryResponse, IntentEventRow } from '@estalara/shared';

import { verifyTracerAdminAuth } from '@/lib/tracer-auth';
import { resolveClickHouseTracerConfig, fetchIntentEventsHistory } from '@/lib/clickhouse-tracer';

// ─── Query param schema ───────────────────────────────────────────────────────

const QuerySchema = z.object({
  tenant_id: z.string().uuid('tenant_id must be a valid UUID'),
  session_id: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  archetype: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ─── Mock data (dev/CI) ───────────────────────────────────────────────────────

function buildMockEvents(tenantId: string): IntentEventRow[] {
  return [
    {
      session_id: 'mock-session-a1b2c3',
      tenant_id: tenantId,
      event_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      event_type: 'intent.snapshot',
      archetype_deltas: JSON.stringify({ yield_hunter: 0.12, family_nester: -0.03 }),
      confidence_before: 0.55,
      confidence_after: 0.67,
      top_archetype: 'yield_hunter',
      event_payload: JSON.stringify({ signal_count: 3, quiz_completed: false, chat_turns: 0 }),
    },
  ];
}

// ─── GET handler ──────────────────────────────────────────────────────────────

/**
 * GET /api/admin/tracer/history
 *
 * @returns 200 TracerHistoryResponse on success.
 * @returns 400 on validation failure.
 * @returns 401/403 if auth fails.
 * @returns 500 if ClickHouse is configured but fails.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
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

  const { tenant_id, session_id, from, to, archetype, limit, offset } = parsed.data;

  // ── ClickHouse unconfigured: return mock ──────────────────────────────────
  const chCfg = resolveClickHouseTracerConfig();
  if (!chCfg) {
    const mockEvents = buildMockEvents(tenant_id);
    const body: TracerHistoryResponse = {
      events: mockEvents,
      total: mockEvents.length,
      limit,
      offset,
      data_source: 'mock',
    };
    return NextResponse.json(body, { status: 200 });
  }

  // ── Live path ─────────────────────────────────────────────────────────────
  try {
    const { events, total } = await fetchIntentEventsHistory(chCfg, {
      tenantId: tenant_id,
      // exactOptionalPropertyTypes: only pass defined values for optional fields.
      ...(session_id !== undefined ? { sessionId: session_id } : {}),
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
      ...(archetype !== undefined ? { archetype } : {}),
      limit,
      offset,
    });

    const body: TracerHistoryResponse = { events, total, limit, offset, data_source: 'live' };
    return NextResponse.json(body, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, {
      extra: {
        route: 'GET /api/admin/tracer/history',
        tenantId: tenant_id,
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
