/**
 * GET/POST /api/quiz/config — quiz widget configuration per tenant.
 *
 * Auth (ADR-0018 §2, FOLLOW-595): `resolveTenantAccess` with `allowStaffOverride`.
 *   The agency path is byte-unchanged (tenant sourced from the session claim; an
 *   agency:viewer or higher may write, exactly as before). An Estalara staff caller
 *   may read/write any tenant by supplying an explicit `?tenant_id=<uuid>` — which is
 *   validated against the `tenants` table — and that validated id becomes the SINGLE
 *   tenant fence bound into every query (invariant 5). This route uses
 *   `createAdminClient()` (service-role, RLS BYPASSED), so the explicit
 *   `eq(tenants.id, access.tenantId)` fence in each query is the ONLY tenant boundary.
 *
 *   GET  — requires a valid session (agency:viewer+ on the agency path). Defaults
 *     apply only when the tenant row exists but has no stored config (legitimate
 *     no-exception case); a thrown DB error returns HTTP 500 instead of enabled
 *     defaults (Rule K.2, FOLLOW-453).
 *   POST — write. Agency: agency:viewer or higher (UNCHANGED). Staff: additionally
 *     gated on `access.canWrite` (rank ≥ `estalara:ops`, CEO Q3) — a staff caller
 *     below ops rank (`estalara:readonly`) is 403. Every successful STAFF write
 *     appends one `staff_audit_log` row (ADR-0018 §3); agency writes are NOT audited.
 *     ATOMICITY (FOLLOW-605, ADR-0018 §3): on the staff path the config `update` and
 *     the `staff_audit_log` insert commit-or-roll-back TOGETHER in ONE
 *     `db.transaction()`, so a config mutation can never outlive a missing audit row
 *     (RETRO-190 §4a). Any failure inside the tx rolls BOTH back → 500
 *     `audit_write_failed` (no orphan mutation). The agency path is unchanged.
 *
 *   Identity caveat (RETRO-187): `resolveTenantAccess` REJECTS the headless
 *   `ADMIN_API_SECRET` Bearer path for staff (403 — a shared secret is not
 *   attributable to a staff user; a privileged staff write MUST be attributable to
 *   `staff_audit_log.adminUserId`). Staff need an identified SSR session or staff JWT.
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
 * tenants.quiz_config JSONB is still used by this route for the remaining wired fields
 * (language, accent_color, micro_polls_enabled). It is NOT being retired in favour of
 * typed columns at this time — the schema is small and typed columns would require a
 * migration per field. This decision should be revisited during Quiz v2.0 planning.
 *
 * FOLLOW-274 (2026-06-11): `sticky_widget` RETIRED — zero SDK consumer (Rule U).
 *   - POST: `QuizConfigSchema` now omits `sticky_widget`; any `sticky_widget` key in
 *     the request body is silently dropped before DB write.
 *   - GET: `parseStoredQuizConfig()` strips a legacy `sticky_widget` key from the blob.
 *   - `micro_polls_enabled` transport (post-ADR-0011 / FOLLOW-275): the SDK reads this
 *     value at runtime via `GET /api/quiz/public-config` → `fetchQuizConfig()` →
 *     `mergeQuizConfig()` → `config.microPollsEnabled`. The snippet data-attribute
 *     `data-micro-polls-enabled` is RETIRED; `readConfig()` treats it as
 *     `DEPRECATED_FALLBACK` only. Tenants need no snippet re-install for config changes.
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
import * as Sentry from '@sentry/nextjs';

import { createAdminClient, tenants, staffAuditLog } from '@estalara/db';
import { resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';
import { accessErrorToResponse } from '@/lib/access-error-response';
import type { QuizConfig } from '@estalara/shared';
import { QuizConfigSchema, QUIZ_DEFAULT_CONFIG, parseStoredQuizConfig } from '@estalara/shared';
import { eq } from 'drizzle-orm';

// Re-export so existing consumers that import QuizConfig from this route continue to compile.
export type { QuizConfig } from '@estalara/shared';

/** Best-effort client IP for the audit trail (no throw if absent). */
function requestIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return req.headers.get('x-real-ip');
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // One auth path for agency + staff (ADR-0018 invariant 5): `access.tenantId` is
  // the ONLY tenant fence — bound into the select's WHERE for BOTH paths. The agency
  // branch sources it from the session claim; the staff branch from the validated
  // `?tenant_id` (never the session, whose staff tenant_id is null).
  const tenantIdParam = req.nextUrl.searchParams.get('tenant_id');
  let access: TenantAccess;
  try {
    access = await resolveTenantAccess(req, {
      allowStaffOverride: true,
      // exactOptionalPropertyTypes (RETRO-189): omit the key when absent rather than
      // passing `undefined`, so a staff caller without ?tenant_id reaches resolve's 400.
      ...(tenantIdParam ? { tenantId: tenantIdParam } : {}),
    });
  } catch (err) {
    return accessErrorToResponse(err);
  }

  const tenantId = access.tenantId;

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
  } catch (err: unknown) {
    // Rule K.2 — fail loud: the DB is configured (createAdminClient() succeeded in
    // reaching the query) but the query threw. Returning "enabled" defaults here
    // would silently tell the dashboard/SDK the quiz is on when we don't actually
    // know the tenant's real config (FOLLOW-453). Surface a 500 instead.
    console.error('[quiz/config GET] DB error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to load quiz configuration' }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const tenantIdParam = req.nextUrl.searchParams.get('tenant_id');
  let access: TenantAccess;
  try {
    access = await resolveTenantAccess(req, {
      allowStaffOverride: true,
      minAgencyRole: 'agency:viewer', // agency write semantics UNCHANGED (viewer+ may write).
      ...(tenantIdParam ? { tenantId: tenantIdParam } : {}),
    });
  } catch (err) {
    return accessErrorToResponse(err);
  }

  // Write-rank gate (CEO Q3, ADR-0018 §4): staff below `estalara:ops` (rank < 2) is
  // view-only. `canWrite` is set on the staff branch iff rank ≥ ops. Agency writes are
  // NOT rank-gated here — agency:viewer may write today and that is preserved.
  if (access.via === 'staff' && !access.canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'Staff write requires estalara:ops or higher' } },
      { status: 403 },
    );
  }

  const tenantId = access.tenantId;

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

  let current: QuizConfig;
  let updated: QuizConfig;
  try {
    const db = createAdminClient();

    // Read current config from DB (fenced on access.tenantId — invariant 5).
    const rows = await db
      .select({ quizConfig: tenants.quizConfig })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    // FOLLOW-271: parseStoredQuizConfig strips any legacy `enabled` key from the read blob.
    const stored = parseStoredQuizConfig(rows[0]?.quizConfig ?? {});
    current = { ...QUIZ_DEFAULT_CONFIG, ...stored };
    // current fills all required fields; parsed.data overrides only the provided ones.
    // `enabled` cannot appear in parsed.data (Zod schema omits it), so it can never
    // re-enter the persisted blob via this path.
    updated = { ...current, ...parsed.data } as QuizConfig;

    if (access.via === 'staff') {
      // ── Atomic staff write (ADR-0018 §3 atomicity / FOLLOW-605) ─────────────────
      // The config mutation and its staff_audit_log row commit-or-roll-back TOGETHER
      // in ONE transaction, so a config change can never outlive a missing audit row
      // (RETRO-190 §4a / FOLLOW-595 was mutate-then-audit and non-transactional). This
      // is the reference impl every staff WRITE port (595 retrofit + 596/597/598) MUST
      // copy — 598 (bandit weight, high blast radius) especially. Precedent for
      // `db.transaction()` on this admin/session-pool client: quiz/completion,
      // admin/intent/config, dsr/erase, crm/outcome. `createAdminClient()` returns a
      // transaction-capable raw drizzle instance (poolMode:'session', prepare:false),
      // so a single-transaction (NOT a transactional-outbox) is the right shape here.
      try {
        await db.transaction(async (tx) => {
          // Persist to DB (fenced on access.tenantId — invariant 5). `updated` never
          // contains `enabled` (Rule U).
          await tx
            .update(tenants)
            .set({ quizConfig: updated, updatedAt: new Date() })
            .where(eq(tenants.id, tenantId));
          // Staff audit trail (§3) — attributed to the acting staff user. AWAITED inside
          // the tx (never fire-and-forget) so it commits atomically with the update.
          await tx.insert(staffAuditLog).values({
            adminUserId: access.staff.sub,
            action: 'quiz_config.update',
            targetTenantId: tenantId,
            payload: { before: current, after: updated },
            ipAddress: requestIp(req),
            userAgent: req.headers.get('user-agent'),
          });
        });
      } catch (err: unknown) {
        // Any failure INSIDE the tx (the update OR the audit insert) rolls BOTH back —
        // there is no orphan config mutation to leave behind. Fail loud: capture to
        // Sentry and return 500, never a silent unattributed 200 (Rule K.2). A retry is
        // safe: it re-reads, re-applies the same config (idempotent) and appends a fresh
        // audit row inside a new tx.
        Sentry.captureException(err, {
          tags: { route: 'quiz/config', staff_audit_error: 'true' },
          extra: { tenant_id: tenantId, admin_user_id: access.staff.sub },
        });
        return NextResponse.json(
          {
            error: {
              code: 'audit_write_failed',
              message:
                'The quiz config change could not be recorded atomically with its staff ' +
                'audit row; the change was rolled back and NOT applied. Retry the action.',
            },
          },
          { status: 500 },
        );
      }
    } else {
      // Agency self-service write — UNCHANGED and NOT audited (§3 audits STAFF only).
      // Persist to DB (fenced on access.tenantId — invariant 5). `updated` never
      // contains `enabled` (Rule U).
      await db
        .update(tenants)
        .set({ quizConfig: updated, updatedAt: new Date() })
        .where(eq(tenants.id, tenantId));
    }
  } catch {
    return NextResponse.json({ error: 'Failed to update quiz configuration' }, { status: 500 });
  }

  return NextResponse.json(updated);
}
