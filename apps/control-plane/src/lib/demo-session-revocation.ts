/**
 * Demo-session runtime revocation enforcement (FOLLOW-636).
 *
 * `verifyDemoJwt` proves a demo token's HS256 signature and its self-contained
 * `exp` — but NOTHING more. Revoking a demo session writes
 * `demo_sessions.revoked_at` (POST /api/demo/sessions/:id/revoke), which the
 * already-issued JWT cannot reflect. Without a server-side lookup a revoked token
 * keeps serving adaptations until its embedded `exp` (up to 7 days). This helper
 * is the single point the adapt demo-JWT path calls to close that gap.
 *
 * ONLY the enablement axis lives here. Signature + expiry stay in `verifyDemoJwt`
 * and remain fail-CLOSED (a bad/expired token is always refused). This lookup is
 * fail-OPEN (Rule K.2 nuance, mirrored from `resolveAlEnablement` / FOLLOW-633): a
 * transient DB blip must not break a legitimate live demo. Serving the demo's REAL
 * adaptation on a lookup problem is not fabricated data; refusing a valid session
 * on a blip would be the harmful fallback.
 *   - "dependency NOT configured" (dev/CI, no DATABASE_URL_ADMIN) → NOT revoked,
 *     NO Sentry — the allowed dev/CI mock path (Rule K.2 distinction).
 *   - "configured but THREW" → NOT revoked AND captured to Sentry (observable), so
 *     the enforcement-check failure is never silent.
 *
 * Per-request cost: ONE indexed primary-key lookup on `demo_sessions`
 * (`SELECT revoked_at FROM demo_sessions WHERE id = $1 LIMIT 1`), sub-millisecond,
 * and only on the demo-JWT path (real tenant API keys revoke via
 * `api_keys.revoked_at`). No cache is added deliberately: a revoked demo token
 * must be cut off PROMPTLY (the whole point of this ticket is that revocation
 * currently has zero runtime latency-to-effect). A short Redis TTL cache would
 * re-introduce exactly that revocation lag and is not worth shaving a PK lookup;
 * revisit only if the adapt p95 budget is threatened, and then document the
 * revocation-latency tradeoff explicitly.
 *
 * @module apps/control-plane/src/lib/demo-session-revocation
 */

import { eq } from 'drizzle-orm';
import * as Sentry from '@sentry/nextjs';

import { createAdminClient, demoSessions } from '@estalara/db';

interface DemoSessionRevocation {
  /** True only when the session row EXISTS and has a non-null `revoked_at`. */
  revoked: boolean;
}

const NOT_REVOKED: DemoSessionRevocation = { revoked: false };

/**
 * Resolve whether a demo session has been revoked.
 *
 * @param sessionId - `demo_sessions.id` from the VERIFIED JWT claims (never a
 *   caller-supplied body/header value).
 * @returns `{ revoked }` — `revoked:false` on any lookup problem (fail-open).
 */
export async function resolveDemoSessionRevocation(
  sessionId: string,
): Promise<DemoSessionRevocation> {
  if (!sessionId) return NOT_REVOKED;

  // "Dependency not configured" (dev/CI) — fail OPEN with no Sentry noise. This is
  // the Rule K.2-sanctioned dev/CI path (distinct from configured-but-threw below).
  const dbConfigured =
    Boolean(process.env.DATABASE_URL_ADMIN) || Boolean(process.env.DATABASE_URL_DIRECT);
  if (!dbConfigured) return NOT_REVOKED;

  try {
    const db = createAdminClient();
    const rows = await db
      .select({ revokedAt: demoSessions.revokedAt })
      .from(demoSessions)
      .where(eq(demoSessions.id, sessionId))
      .limit(1);

    // Read DEFENSIVELY (value as `unknown`): only an EXPLICIT non-null `revoked_at`
    // cuts the session off. A missing row (fail-open) or a null/garbled value keeps
    // it serving — we never refuse a signature-valid token on anything we cannot
    // positively classify as revoked.
    const row = rows[0] as { revokedAt?: unknown } | undefined;
    if (!row) return NOT_REVOKED;

    const revokedAt = row.revokedAt;
    const isRevoked = revokedAt !== null && revokedAt !== undefined;
    return { revoked: isRevoked };
  } catch (err: unknown) {
    // Configured-but-threw (Rule K.2): fail LOUD to Sentry, then fail OPEN so a
    // transient DB blip never breaks a legitimate live demo. Signature + expiry
    // were already enforced fail-closed upstream, so this only relaxes the
    // revocation axis; the failure itself is captured for ops.
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { area: 'adapt', kind: 'demo_session_revocation_db_error' },
      extra: { session_id: sessionId },
    });
    console.error(
      '[demo-session-revocation] lookup failed — failing open (serving demo):',
      err instanceof Error ? err.message : err,
    );
    return NOT_REVOKED;
  }
}
