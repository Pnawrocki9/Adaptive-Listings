/**
 * GET /api/admin/tracer/history/[session_id]
 *
 * K.3.6 Archetype Identification Tracer — full session replay (AC5).
 *
 * Returns all intent_events for a session ordered by event_at ASC (replay order)
 * plus the matching intent_sessions row from Postgres.
 *
 * [session_id] = raw session fingerprint (SHA-256 hex) — the join key used in
 * both intent_sessions.session_id (Postgres) and intent_events.session_id (ClickHouse).
 *
 * Query params:
 *   tenant_id (required) — scopes both the Postgres and ClickHouse queries.
 *
 * Auth: Bearer <ADMIN_API_SECRET> OR Supabase JWT with estalara_staff: true.
 *
 * Rule K.2: configured store failure → HTTP 500, never silent mock.
 *
 * @module apps/control-plane/src/app/api/admin/tracer/history/[session_id]/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { createAdminClient, intentSessions } from '@estalara/db';
import type { TracerSessionReplayResponse, IntentSessionRow } from '@estalara/shared';

import { verifyTracerAdminAuth } from '@/lib/tracer-auth';
import {
  resolveClickHouseTracerConfig,
  fetchIntentEventsForSession,
} from '@/lib/clickhouse-tracer';

// ─── Query param schema ───────────────────────────────────────────────────────

const QuerySchema = z.object({
  tenant_id: z.string().uuid('tenant_id must be a valid UUID'),
});

// ─── GET handler ──────────────────────────────────────────────────────────────

/**
 * GET /api/admin/tracer/history/[session_id]
 *
 * @returns 200 TracerSessionReplayResponse on success.
 * @returns 400 on missing/invalid tenant_id param.
 * @returns 401/403 if auth fails.
 * @returns 500 if a configured store fails.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ session_id: string }> },
): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authResult = await verifyTracerAdminAuth(req);
  if (!authResult.ok) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: authResult.message } },
      { status: authResult.status },
    );
  }

  const { session_id: sessionId } = await params;
  if (!sessionId || sessionId.trim() === '') {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'session_id is required' } },
      { status: 400 },
    );
  }

  const rawParams = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = QuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation_error', details: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const { tenant_id: tenantId } = parsed.data;

  // ── Unconfigured dev/CI: return observable mock ───────────────────────────
  const dbConfigured =
    Boolean(process.env.DATABASE_URL_ADMIN) || Boolean(process.env.DATABASE_URL_DIRECT);

  if (!dbConfigured) {
    const body: TracerSessionReplayResponse = {
      session: {
        session_id: sessionId,
        tenant_id: tenantId,
        signal_count: 5,
        top_archetype: 'yield_hunter',
        confidence: 0.72,
        last_event_at: new Date().toISOString(),
        quiz_completed: false,
        chat_turns: 0,
      },
      events: [],
      data_source: 'mock',
    };
    return NextResponse.json(body, { status: 200 });
  }

  // ── Fetch Postgres session row ─────────────────────────────────────────────
  let sessionRow: IntentSessionRow | null = null;
  try {
    const db = createAdminClient();
    const rows = await db
      .select({
        sessionId: intentSessions.sessionId,
        tenantId: intentSessions.tenantId,
        signalCount: intentSessions.signalCount,
        intentState: intentSessions.intentState,
        lastEventAt: intentSessions.lastEventAt,
        quizCompleted: intentSessions.quizCompleted,
        chatTurns: intentSessions.chatTurns,
      })
      .from(intentSessions)
      .where(and(eq(intentSessions.sessionId, sessionId), eq(intentSessions.tenantId, tenantId)))
      .limit(1);

    if (rows.length > 0) {
      // rows.length guard above guarantees rows[0] exists.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const r = rows[0]!;
      const state = r.intentState as {
        topArchetype?: string;
        confidence?: number;
      } | null;
      sessionRow = {
        session_id: r.sessionId,
        tenant_id: r.tenantId,
        signal_count: r.signalCount,
        top_archetype: state?.topArchetype ?? null,
        confidence: state?.confidence ?? null,
        last_event_at: r.lastEventAt.toISOString(),
        quiz_completed: r.quizCompleted,
        chat_turns: r.chatTurns,
      };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, {
      extra: {
        route: 'GET /api/admin/tracer/history/[session_id]',
        sessionId,
        tenantId,
        message,
      },
    });
    return NextResponse.json(
      {
        error: { code: 'db_error', message: 'Postgres query failed — see Sentry for details' },
        data_source: 'error',
      },
      { status: 500 },
    );
  }

  // ── Fetch ClickHouse events ────────────────────────────────────────────────
  const chCfg = resolveClickHouseTracerConfig();
  if (!chCfg) {
    const body: TracerSessionReplayResponse = {
      session: sessionRow,
      events: [],
      data_source: 'clickhouse_unavailable',
    };
    return NextResponse.json(body, { status: 200 });
  }

  try {
    const events = await fetchIntentEventsForSession(chCfg, tenantId, sessionId);
    const body: TracerSessionReplayResponse = { session: sessionRow, events, data_source: 'live' };
    return NextResponse.json(body, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, {
      extra: {
        route: 'GET /api/admin/tracer/history/[session_id]',
        sessionId,
        tenantId,
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
