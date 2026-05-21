/**
 * POST /api/adapt/feedback — Thompson sampling bandit feedback loop.
 *
 * FOLLOW-007. Fire-and-forget conversion signal endpoint. The SDK calls this
 * route when an outcome event (inquiry / click-through / configurable goal)
 * is observed for a previously-served `(tenant_id, archetype, variant)`
 * triple. The server:
 *
 *   1. Reads the matching row from `ab_bandit_weights` via the composite
 *      index `ab_bandit_weights_tenant_archetype_idx`.
 *   2. Computes new Beta parameters with `updateBanditArm(alpha, beta, converted)`:
 *        converted=true  → alpha += 1
 *        converted=false → beta  += 1
 *   3. Upserts the updated row (insert with `onConflictDoUpdate`).
 *   4. Returns `202 Accepted` immediately — the DB write is fire-and-forget
 *      so the SDK's outcome ping never blocks the user-visible adapt flow.
 *
 * Auth: presence-only Bearer token, same pattern as the canonical adapt
 * route (`apps/control-plane/src/app/api/adapt/route.ts` POST). When
 * `ADAPT_API_KEY` is set the token must match it. When unset, a non-empty
 * token is accepted (dev/demo mode).
 *
 * @module apps/control-plane/src/app/api/adapt/feedback/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';

import { errorBody, ErrorCode, updateBanditArm } from '@estalara/shared';
import { createAdminClient, abBanditWeights } from '@estalara/db';

// ─── Body schema ──────────────────────────────────────────────────────────────

const FeedbackBodySchema = z.object({
  session_id: z.string().min(1).max(256),
  tenant_id: z.string().min(1).max(256),
  archetype: z.string().min(1).max(128),
  variant: z.string().min(1).max(128),
  converted: z.boolean(),
});

// ─── Fire-and-forget bandit arm update ───────────────────────────────────────

/**
 * Updates the matching `(tenant_id, archetype, variant)` row in
 * `ab_bandit_weights` based on the conversion signal. Never throws —
 * errors are logged and swallowed so the feedback ping cannot impact
 * downstream callers.
 *
 * @internal
 */
async function updateArmAsync(args: {
  tenantId: string;
  archetype: string;
  variant: string;
  converted: boolean;
}): Promise<void> {
  const adminUrl = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT;
  if (!adminUrl) {
    // No admin DB configured — no-op (dev/test environment).
    return;
  }

  try {
    const db = createAdminClient();

    const rows = await db
      .select({ alpha: abBanditWeights.alpha, beta: abBanditWeights.beta })
      .from(abBanditWeights)
      .where(
        and(
          eq(abBanditWeights.tenantId, args.tenantId),
          eq(abBanditWeights.archetype, args.archetype),
          eq(abBanditWeights.variant, args.variant),
        ),
      )
      .limit(1);

    // Treat missing row as Beta(1, 1) so first-observed feedback still records.
    const current = rows[0] ?? { alpha: 1.0, beta: 1.0 };
    const next = updateBanditArm(current.alpha, current.beta, args.converted);

    await db
      .insert(abBanditWeights)
      .values({
        tenantId: args.tenantId,
        archetype: args.archetype,
        variant: args.variant,
        alpha: next.alpha,
        beta: next.beta,
        paused: false,
      })
      .onConflictDoUpdate({
        target: [abBanditWeights.tenantId, abBanditWeights.archetype, abBanditWeights.variant],
        set: {
          alpha: next.alpha,
          beta: next.beta,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    console.error('[adapt/feedback] DB upsert failed:', err instanceof Error ? err.message : err);
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

/**
 * POST /api/adapt/feedback
 *
 * Body:
 *   session_id  — string (required)
 *   tenant_id   — string (required)
 *   archetype   — string (required)
 *   variant     — string (required)
 *   converted   — boolean (required)
 *
 * Auth: presence-only Bearer token. When `ADAPT_API_KEY` is set, the token
 * must match it.
 *
 * Responses:
 *   202 Accepted  — feedback acknowledged; DB update happens asynchronously.
 *   400 VALIDATION_ERROR — invalid body.
 *   401 AUTH_REQUIRED / FORBIDDEN — missing or wrong token.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = crypto.randomUUID();

  // ── Auth gate — same shape as GET /api/adapt ─────────────────────────────
  const auth = req.headers.get('Authorization') ?? req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.AUTH_REQUIRED,
        message: 'Authorization: Bearer <token> header is required',
        requestId,
      }),
      { status: 401 },
    );
  }
  const adaptApiKey = process.env.ADAPT_API_KEY;
  if (adaptApiKey && token !== adaptApiKey) {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.FORBIDDEN,
        message: 'Invalid API key',
        requestId,
      }),
      { status: 401 },
    );
  }

  // ── Parse + validate body ─────────────────────────────────────────────────
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Invalid JSON body',
        requestId,
      }),
      { status: 400 },
    );
  }

  const parsed = FeedbackBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        requestId,
        details: { issues: parsed.error.flatten() },
      }),
      { status: 400 },
    );
  }

  // ── Fire-and-forget bandit update ─────────────────────────────────────────
  // We intentionally do NOT await the DB write here — the SDK's outcome ping
  // must never block. The microtask returns a resolved promise immediately,
  // and the DB upsert progresses in the background.
  void updateArmAsync({
    tenantId: parsed.data.tenant_id,
    archetype: parsed.data.archetype,
    variant: parsed.data.variant,
    converted: parsed.data.converted,
  });

  return NextResponse.json({ ok: true }, { status: 202 });
}
