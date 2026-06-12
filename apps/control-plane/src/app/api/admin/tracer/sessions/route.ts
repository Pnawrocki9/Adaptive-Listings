/**
 * GET /api/admin/tracer/sessions
 *
 * K.3.6 Archetype Identification Tracer — live session list (AC1).
 *
 * Returns intent_sessions rows where last_event_at > now() - interval '15 minutes'.
 * Ordered by last_event_at DESC (most recent first).
 *
 * Auth: Bearer <ADMIN_API_SECRET> OR Supabase JWT with estalara_staff: true.
 * Returns 401/403 if neither is satisfied.
 *
 * Rule K.2: when CLICKHOUSE_URL is set but fails, or DATABASE_URL_ADMIN is set
 * but Postgres fails, returns HTTP 500 with a structured error (never silent mock).
 * When DATABASE_URL_ADMIN is unset (dev/CI), returns 200 with data_source: 'mock'.
 *
 * @module apps/control-plane/src/app/api/admin/tracer/sessions/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { and, gt, desc } from 'drizzle-orm';

import { createAdminClient, intentSessions } from '@estalara/db';
import type { TracerSessionsResponse, IntentSessionRow } from '@estalara/shared';

import { verifyTracerAdminAuth } from '@/lib/tracer-auth';

// ─── Mock data (dev/CI only — DATABASE_URL_ADMIN not configured) ──────────────

function buildMockSessions(): IntentSessionRow[] {
  return [
    {
      session_id: 'mock-session-a1b2c3',
      tenant_id: '00000000-0000-0000-0000-000000000001',
      signal_count: 7,
      top_archetype: 'yield_hunter',
      confidence: 0.78,
      last_event_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      quiz_completed: true,
      chat_turns: 2,
    },
    {
      session_id: 'mock-session-d4e5f6',
      tenant_id: '00000000-0000-0000-0000-000000000001',
      signal_count: 3,
      top_archetype: 'family_nester',
      confidence: 0.61,
      last_event_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
      quiz_completed: false,
      chat_turns: 0,
    },
  ];
}

// ─── GET handler ──────────────────────────────────────────────────────────────

/**
 * GET /api/admin/tracer/sessions
 *
 * @returns 200 TracerSessionsResponse — sessions active in the last 15 minutes.
 * @returns 401/403 if auth fails.
 * @returns 500 if the database is configured but throws.
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

  // ── Unconfigured (dev/CI): return mock with observable flag ───────────────
  const dbConfigured =
    Boolean(process.env.DATABASE_URL_ADMIN) || Boolean(process.env.DATABASE_URL_DIRECT);

  if (!dbConfigured) {
    const body: TracerSessionsResponse = {
      sessions: buildMockSessions(),
      data_source: 'mock',
    };
    return NextResponse.json(body, { status: 200 });
  }

  // ── Live path: query Postgres ─────────────────────────────────────────────
  try {
    const db = createAdminClient();
    const cutoff = new Date(Date.now() - 15 * 60 * 1000);

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
      .where(and(gt(intentSessions.lastEventAt, cutoff)))
      .orderBy(desc(intentSessions.lastEventAt))
      .limit(200);

    const sessions: IntentSessionRow[] = rows.map((r) => {
      // Extract top_archetype and confidence from the JSONB intent_state blob.
      // Shape: { weights: Record<archetype, number>, topArchetype: string, confidence: number }
      const state = r.intentState as {
        topArchetype?: string;
        confidence?: number;
      } | null;

      return {
        session_id: r.sessionId,
        tenant_id: r.tenantId,
        signal_count: r.signalCount,
        top_archetype: state?.topArchetype ?? null,
        confidence: state?.confidence ?? null,
        last_event_at: r.lastEventAt.toISOString(),
        quiz_completed: r.quizCompleted,
        chat_turns: r.chatTurns,
      };
    });

    const body: TracerSessionsResponse = { sessions, data_source: 'live' };
    return NextResponse.json(body, { status: 200 });
  } catch (err: unknown) {
    // Configured-but-failed: fail loud (Rule K.2). Never return mock data.
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, {
      extra: { route: 'GET /api/admin/tracer/sessions', message },
    });
    return NextResponse.json(
      {
        error: {
          code: 'db_error',
          message: 'Postgres query failed — see Sentry for details',
        },
        data_source: 'error',
      },
      { status: 500 },
    );
  }
}
