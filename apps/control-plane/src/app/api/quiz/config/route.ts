/**
 * GET/POST /api/quiz/config — quiz widget configuration per tenant.
 *
 * Auth: JWT-verified tenant claims required.
 *   GET  — requires valid JWT (getAuthClaims); falls back to defaults if missing.
 *   POST — requires agency:viewer or higher (requireTenantAccess).
 *
 * Persists to tenants.quiz_config JSONB column via createAdminClient().
 *
 * AC4 (FOLLOW-264): `trigger_after_n_listings` has been deliberately removed from
 * the QuizConfig type, the Zod schema, the default, and the DB persistence path.
 * The SDK consumer was removed in FOLLOW-257 (PR #259); this removes the orphaned
 * producer limb that left false configurability surfaced to paying tenants (Rule L /
 * RETRO-050 HALF_WIRE_P). If Quiz v2.0 (FOLLOW-199) reintroduces a per-tenant timer,
 * ALL THREE LIMBS must be rebuilt together: (1) a typed column or JSONB key + migration,
 * (2) this API schema field, (3) a real SDK consumer via readConfig / data-* attribute.
 * tenants.quiz_config JSONB is still used by this route for the remaining fields
 * (sticky_widget, language, accent_color, micro_polls_enabled). It is NOT
 * being retired in favour of typed columns at this time — the schema is small and typed
 * columns would require a migration per field. This decision should be revisited during
 * Quiz v2.0 planning.
 *
 * FOLLOW-270: `QuizConfig` type, `QuizConfigSchema`, and `QUIZ_DEFAULT_CONFIG` are now
 * imported from `@estalara/shared` to eliminate the hand-duplicated copy that drifted
 * on the `language` enum (`page.tsx` had `'en' | 'pl'`; route was authoritative at
 * `'en' | 'pl' | 'es'`). Both sides now reference the same canonical definition.
 *
 * FOLLOW-271 (2026-06-11): `enabled` stripped from the persisted JSONB blob.
 *   - POST: `QuizConfigSchema` now omits `enabled` at the Zod parse step; any `enabled`
 *     key in the request body is silently dropped before DB write (Rule U).
 *   - GET: `parseStoredQuizConfig()` strips a legacy `enabled` key from the read blob
 *     (belt-and-suspenders — the backfill migration also removes it from existing rows).
 *   - The `tenants.quiz_enabled` typed boolean column remains the sole SoT for ON/OFF.
 *
 * @module apps/control-plane/src/app/api/quiz/config/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { createAdminClient, tenants } from '@estalara/db';
import { getAuthClaims, requireTenantAccess } from '@estalara/auth';
import type { QuizConfig } from '@estalara/shared';
import { QuizConfigSchema, QUIZ_DEFAULT_CONFIG, parseStoredQuizConfig } from '@estalara/shared';
import { eq } from 'drizzle-orm';

// Re-export so existing consumers that import QuizConfig from this route continue to compile.
export type { QuizConfig } from '@estalara/shared';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const claims = await getAuthClaims(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tenantId = claims.tenant_id;
  if (!tenantId) {
    return NextResponse.json({ error: 'Unauthorized: no tenant_id in claims' }, { status: 401 });
  }

  try {
    const db = createAdminClient();
    const rows = await db
      .select({ quizConfig: tenants.quizConfig, quizEnabled: tenants.quizEnabled })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    // FOLLOW-271: parseStoredQuizConfig strips any legacy `enabled` key from the stored blob.
    const stored = parseStoredQuizConfig(rows[0]?.quizConfig ?? {});
    const config = { ...QUIZ_DEFAULT_CONFIG, ...stored };
    // FOLLOW-102: also return the dedicated quiz_enabled column (boolean SoT for the ON/OFF toggle)
    // and tenant_id so the dashboard page can call PATCH /api/tenants/:id with the correct id.
    // quizEnabled defaults to true when the row is missing (DB unavailable path below).
    const quizEnabled: boolean = rows[0]?.quizEnabled ?? true;
    return NextResponse.json({ ...config, quiz_enabled: quizEnabled, tenant_id: tenantId });
  } catch {
    // Fallback to defaults if DB unavailable
    return NextResponse.json({ ...QUIZ_DEFAULT_CONFIG, quiz_enabled: true, tenant_id: tenantId });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let claims;
  try {
    claims = await requireTenantAccess(req, 'agency:viewer');
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tenantId = claims.tenant_id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // FOLLOW-271: QuizConfigSchema.omit({ enabled: true }) strips `enabled` at parse time.
  // Any `enabled` key in the request body is silently dropped — it can never re-enter
  // the JSONB blob (Rule U). The SoT for quiz ON/OFF is tenants.quiz_enabled (typed column).
  const parsed = QuizConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const db = createAdminClient();

    // Read current config from DB
    const rows = await db
      .select({ quizConfig: tenants.quizConfig })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    // FOLLOW-271: parseStoredQuizConfig strips any legacy `enabled` key from the read blob.
    const stored = parseStoredQuizConfig(rows[0]?.quizConfig ?? {});
    const current = { ...QUIZ_DEFAULT_CONFIG, ...stored };
    // current fills all required fields; parsed.data overrides only the provided ones.
    // `enabled` cannot appear in parsed.data (Zod schema omits it), so it can never
    // re-enter the persisted blob via this path.
    const updated = { ...current, ...parsed.data } as QuizConfig;

    // Persist to DB — `updated` never contains `enabled` (Rule U).
    await db
      .update(tenants)
      .set({ quizConfig: updated, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: 'Failed to update quiz configuration' }, { status: 500 });
  }
}
