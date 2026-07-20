/**
 * Server-side data access for /admin/demo-sessions (FOLLOW-593).
 *
 * The `demo_sessions` table exists and already has real writers (`POST
 * /api/demo/sessions`, `POST /api/demo/sessions/[id]/revoke`) — this wires
 * the admin cross-tenant view to it rather than deferring. Two things are
 * DERIVED (not raw columns), documented here:
 *   - `tenant_name`: left-joined from `tenants.name` (may be null if the
 *     tenant was hard-deleted — displayed as "(unknown tenant)", never
 *     fabricated).
 *   - `status`: derived from `revoked_at` / `expires_at` vs now, mirroring
 *     the same logic `demo_sessions_active_idx` encodes
 *     (`revoked_at IS NULL`) plus an expiry check.
 *
 * Rule K.2: mock (`MOCK_DEMO_SESSIONS`) renders ONLY when the admin DB is
 * unconfigured; a configured-but-failing query fails loud
 * (`data_source: 'error'`), never falls back to mock.
 *
 * @module apps/control-plane/src/app/admin/demo-sessions/data
 */

import { desc, eq } from 'drizzle-orm';
import * as Sentry from '@sentry/nextjs';

import { createAdminClient, demoSessions, tenants } from '@estalara/db';

import { MOCK_DEMO_SESSIONS } from './mock-data';

export type DemoSessionsDataSource = 'live' | 'mock' | 'error';

export type DemoSessionStatus = 'active' | 'revoked' | 'expired';

export interface DemoSessionRow {
  id: string;
  tenant_name: string;
  scope: string;
  visibility: string;
  duration: string;
  status: DemoSessionStatus;
  created_at: string;
  expires_at: string;
}

export interface DemoSessionsListResult {
  dataSource: DemoSessionsDataSource;
  sessions: DemoSessionRow[];
  errorMessage?: string;
}

function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT);
}

/** Derive display status from revocation/expiry, mirroring `demo_sessions_active_idx`. */
function deriveStatus(revokedAt: Date | null, expiresAt: Date, now: Date): DemoSessionStatus {
  if (revokedAt) return 'revoked';
  if (expiresAt < now) return 'expired';
  return 'active';
}

const LIST_LIMIT = 50;

/** Most recent demo sessions across all tenants (newest first). */
export async function getDemoSessionsList(): Promise<DemoSessionsListResult> {
  if (!isDbConfigured()) {
    return { dataSource: 'mock', sessions: MOCK_DEMO_SESSIONS.map((m) => ({ ...m })) };
  }

  try {
    const db = createAdminClient();
    const rows = await db
      .select({
        id: demoSessions.id,
        tenantName: tenants.name,
        scope: demoSessions.scope,
        visibility: demoSessions.visibility,
        duration: demoSessions.duration,
        createdAt: demoSessions.createdAt,
        expiresAt: demoSessions.expiresAt,
        revokedAt: demoSessions.revokedAt,
      })
      .from(demoSessions)
      .leftJoin(tenants, eq(demoSessions.tenantId, tenants.id))
      .orderBy(desc(demoSessions.createdAt))
      .limit(LIST_LIMIT);

    const now = new Date();
    return {
      dataSource: 'live',
      sessions: rows.map((r) => ({
        id: r.id,
        tenant_name: r.tenantName ?? '(unknown tenant)',
        scope: r.scope,
        visibility: r.visibility,
        duration: r.duration,
        status: deriveStatus(r.revokedAt, r.expiresAt, now),
        created_at: r.createdAt.toISOString(),
        expires_at: r.expiresAt.toISOString(),
      })),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, { tags: { admin_demo_sessions_list_error: 'true' } });
    return { dataSource: 'error', sessions: [], errorMessage: message };
  }
}
