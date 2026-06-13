/**
 * GET /api/admin/tracer/sessions/[id]
 *
 * K.3.6 Archetype Identification Tracer — session detail (AC2).
 *
 * Returns a single intent_sessions row (Postgres) + all intent_events for the
 * session from ClickHouse, joined on session_id (String, NOT intent_session_id).
 *
 * [id] is the session_id string (SHA-256 hex fingerprint, NOT the Postgres UUID row id).
 *
 * Auth: Bearer <ADMIN_API_SECRET> OR Supabase JWT with estalara_staff: true.
 *
 * Rule K.2: when a configured store fails, returns HTTP 500 with data_source: 'error'.
 * When ClickHouse is unconfigured, returns the Postgres row with events: [] and
 * data_source: 'clickhouse_unavailable'.
 *
 * @module apps/control-plane/src/app/api/admin/tracer/sessions/[id]/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { and, eq } from 'drizzle-orm';

import { createAdminClient, intentSessions } from '@estalara/db';
import type { TracerSessionDetailResponse, IntentSessionRow } from '@estalara/shared';

import { verifyTracerAdminAuth } from '@/lib/tracer-auth';
import {
  resolveClickHouseTracerConfig,
  fetchIntentEventsForSession,
} from '@/lib/clickhouse-tracer';

// ─── GET handler ──────────────────────────────────────────────────────────────

/**
 * GET /api/admin/tracer/sessions/[id]
 *
 * [id] = session_id (raw SHA-256 hex fingerprint from the SDK).
 *
 * @returns 200 TracerSessionDetailResponse on success.
 * @returns 401/403 if auth fails.
 * @returns 404 if no session row found for the given session_id.
 * @returns 500 if a configured store fails.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
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

  // ── Fetch Postgres session row ─────────────────────────────────────────────
  const dbConfigured =
    Boolean(process.env.DATABASE_URL_ADMIN) || Boolean(process.env.DATABASE_URL_DIRECT);

  if (!dbConfigured) {
    // Unconfigured: return observable mock (Rule K.2 — not a configured failure).
    const mockSession: IntentSessionRow = {
      session_id: sessionId,
      tenant_id: '00000000-0000-0000-0000-000000000001',
      signal_count: 5,
      top_archetype: 'yield_hunter',
      confidence: 0.72,
      last_event_at: new Date().toISOString(),
      quiz_completed: false,
      chat_turns: 1,
    };
    const body: TracerSessionDetailResponse = {
      session: mockSession,
      events: [],
      data_source: 'mock',
    };
    return NextResponse.json(body, { status: 200 });
  }

  let sessionRow: IntentSessionRow;
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
      .where(and(eq(intentSessions.sessionId, sessionId)))
      .limit(1);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: { code: 'not_found', message: `No session found for session_id: ${sessionId}` } },
        { status: 404 },
      );
    }

    // rows.length check above guarantees rows[0] exists.
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, {
      extra: { route: 'GET /api/admin/tracer/sessions/[id]', sessionId, message },
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
    // ClickHouse unconfigured — return session row with observable flag.
    const body: TracerSessionDetailResponse = {
      session: sessionRow,
      events: [],
      data_source: 'clickhouse_unavailable',
    };
    return NextResponse.json(body, { status: 200 });
  }

  try {
    const events = await fetchIntentEventsForSession(chCfg, sessionRow.tenant_id, sessionId);
    const body: TracerSessionDetailResponse = { session: sessionRow, events, data_source: 'live' };
    return NextResponse.json(body, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, {
      extra: {
        route: 'GET /api/admin/tracer/sessions/[id]',
        sessionId,
        tenantId: sessionRow.tenant_id,
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
