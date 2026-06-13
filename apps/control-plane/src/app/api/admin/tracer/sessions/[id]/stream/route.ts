/**
 * GET /api/admin/tracer/sessions/[id]/stream
 *
 * K.3.6 Archetype Identification Tracer — live SSE stream (AC3).
 *
 * Server-Sent Events: polls ClickHouse every 3 seconds for new intent_events
 * where session_id = :id AND event_at > :lastEventAt. Sends `data: <JSON>\n\n`
 * per new event batch. Closes after 5 minutes (100 polls at 3 s each) to prevent
 * resource exhaustion. Fix: docstring previously said "300 polls" but MAX_POLLS was
 * always 100 — corrected by FOLLOW-297 (DG-1 from RETRO-061).
 *
 * Auth: Bearer <ADMIN_API_SECRET> OR Supabase JWT with estalara_staff: true.
 *
 * Rule K.2: when ClickHouse is configured but fails, sends an error SSE event
 * and closes the stream (never silently swallows failures).
 *
 * @module apps/control-plane/src/app/api/admin/tracer/sessions/[id]/stream/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';

import { verifyTracerAdminAuth } from '@/lib/tracer-auth';
import { resolveClickHouseTracerConfig, fetchNewIntentEvents } from '@/lib/clickhouse-tracer';

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 3_000;
const MAX_POLLS = 100; // ~5 minutes

// ─── GET handler ──────────────────────────────────────────────────────────────

/**
 * GET /api/admin/tracer/sessions/[id]/stream
 *
 * Streams new intent_events as SSE. Each event batch is sent as:
 *   data: {"events": [...IntentEventRow], "data_source": "live"}\n\n
 *
 * Sends a heartbeat every poll cycle when there are no new events:
 *   data: {"heartbeat": true}\n\n
 *
 * Sends an error event and closes on ClickHouse failure:
 *   data: {"error": "clickhouse_failed", "message": "..."}\n\n
 *
 * @returns 200 text/event-stream on success.
 * @returns 401/403 if auth fails.
 * @returns 503 if ClickHouse is not configured.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse | Response> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authResult = await verifyTracerAdminAuth(req);
  if (!authResult.ok) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: authResult.message } },
      { status: authResult.status },
    );
  }

  const { id: sessionId } = await params;
  if (!sessionId || sessionId.trim() === '') {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'session id is required' } },
      { status: 400 },
    );
  }

  // ── ClickHouse config ─────────────────────────────────────────────────────
  const chCfg = resolveClickHouseTracerConfig();
  if (!chCfg) {
    return NextResponse.json(
      {
        error: {
          code: 'clickhouse_unavailable',
          message: 'ClickHouse not configured — SSE stream unavailable in this environment',
        },
      },
      { status: 503 },
    );
  }

  // Resolve tenant_id from query param (required for ClickHouse WHERE clause).
  // The session_id alone is insufficient — tenant_id scopes the query.
  const tenantId = req.nextUrl.searchParams.get('tenant_id');
  if (!tenantId) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_error',
          message: 'tenant_id query param is required for the SSE stream',
        },
      },
      { status: 400 },
    );
  }

  // ── SSE stream ────────────────────────────────────────────────────────────
  const encoder = new TextEncoder();
  let pollCount = 0;
  let lastEventAt = new Date(0).toISOString(); // start from epoch → returns all events first

  const stream = new ReadableStream({
    async start(controller) {
      // Initial timestamp: optionally accept ?since= param for resume.
      const sinceParam = req.nextUrl.searchParams.get('since');
      if (sinceParam) {
        lastEventAt = sinceParam;
      }

      const send = (payload: unknown): void => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      const poll = async (): Promise<void> => {
        if (pollCount >= MAX_POLLS) {
          send({ closed: true, reason: 'max_polls_reached' });
          controller.close();
          return;
        }
        pollCount++;

        try {
          const events = await fetchNewIntentEvents(chCfg, tenantId, sessionId, lastEventAt);
          if (events.length > 0) {
            send({ events, data_source: 'live' as const });
            // Advance the cursor to the most recent event_at.
            const lastRow = events[events.length - 1];
            if (lastRow?.event_at) lastEventAt = lastRow.event_at;
          } else {
            send({ heartbeat: true });
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          Sentry.captureException(err, {
            extra: {
              route: 'GET /api/admin/tracer/sessions/[id]/stream',
              sessionId,
              tenantId,
              message,
            },
          });
          // Rule K.2: configured-store failure — surface error, close stream.
          send({ error: 'clickhouse_failed', message: message.slice(0, 200) });
          controller.close();
          return;
        }

        // Schedule next poll.
        await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        await poll();
      };

      await poll();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
