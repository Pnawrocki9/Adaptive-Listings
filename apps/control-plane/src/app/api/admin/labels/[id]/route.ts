/**
 * PATCH /api/admin/labels/[id]
 *
 * Manual reclassification of a `conversion_labels` row by Estalara staff or a
 * tenant admin (FOLLOW-174, MASTER_DESIGN §T.5).
 *
 * Writes `label_source = 'manual_admin'`, the new `outcome_class`, optional `notes`,
 * bumps `updated_at` to now(). Uses `upsertConversionLabel` so the class-precedence
 * policy (FOLLOW-179) is respected — a manual_admin write always outranks any prior
 * system label.
 *
 * Body (Zod-validated):
 *   outcome_class — one of ConversionOutcomeClass  (required)
 *   notes         — free-text rationale             (optional, max 2000 chars)
 *
 * Auth: verified Supabase JWT (HMAC-SHA-256, `SUPABASE_JWT_SECRET`).
 *   - Estalara staff (estalara_staff: true, role ≥ estalara:ops): may reclassify
 *     any label across all tenants, supplying the label's own tenant_id from the DB row.
 *   - Agency users (agency_role ≥ agency:owner): may reclassify only labels belonging
 *     to their own tenant_id (pinned from JWT — never from body/params).
 *
 * Rule H amendment: this endpoint mutates state. Auth is production-grade in THIS PR:
 *   - HMAC-signed Supabase JWT verified via crypto.subtle (SUPABASE_JWT_SECRET).
 *   - Tenant ID sourced from JWT claims, never from request body.
 *   - `requireTenantAccess` / `getAuthClaims` provide constant-time HMAC comparison.
 *   - Replay defence: Supabase JWTs carry `exp`; verifyAndDecodeJwtPayload rejects
 *     expired tokens on every call (see packages/auth/src/middleware.ts).
 *   - Cross-tenant writes blocked: we re-read the label's tenant_id from the DB and
 *     compare it against the JWT claim before any write.
 *
 * Staff audit trail + atomicity (ADR-0018 §3/§3a, FOLLOW-597): a staff reclassification
 * is attributable to the acting staff user — every successful STAFF write appends one
 * `staff_audit_log` row (`action: 'conversion_label.reclassify'`). The
 * `upsertConversionLabel` write and the audit insert commit-or-roll-back TOGETHER in
 * ONE `db.transaction()` (mirrors `quiz/config` POST, FOLLOW-605), so a reclassification
 * can never outlive a missing audit row — any failure inside the tx rolls BOTH back and
 * returns 500 `audit_write_failed` (Rule K.2, no orphan mutation). The AGENCY path is
 * UNCHANGED: unaudited, non-transactional, and its cross-tenant 404 (not 403, to avoid
 * leaking label existence) is preserved byte-for-byte.
 *
 * Auth-shape note (deliberate, FOLLOW-597): this route does NOT route the staff branch
 * through `resolveTenantAccess`. That helper's `tenantId` option models an
 * attacker-influenced, caller-SUPPLIED tenant id (a URL/query param) that must be
 * validated against the `tenants` table before use (ADR-0018 §2 invariant 3/4). Here the
 * tenant fence is never caller-supplied at all — it is read from the label row's own
 * `tenant_id` FK column (`existing.tenantId`, already guaranteed to reference a real
 * tenant), so there is no cross-tenant-spoof surface for `resolveTenantAccess` to close.
 * The existing inline `estalara:ops`+ rank gate below already implements invariant-5
 * tenant-scoping correctly (no query ever omits the WHERE fence); this PR only adds the
 * audit trail + atomicity on top of it.
 *
 * Guard-coverage caveat (FOLLOW-613, still OPEN — the mechanical guard SKIPs this route;
 * do NOT delete this note or the covering test without re-reading FOLLOW-613 + Rule AE):
 * the staff-write atomicity guard (`scripts/check-staff-write-atomicity.cjs`) reports
 * SKIP for THIS route, not OK. Its bounded import walk resolves only relative and
 * `@/`-alias imports; the mutation here is DELEGATED to `upsertConversionLabel` imported
 * from the `@estalara/db` PACKAGE BARREL, which the guard cannot follow — so it sees the
 * inline `insert(staffAuditLog)` but no co-located mutation and classifies the write as an
 * audit-of-a-read (SKIP, exit 0 — zero enforcement, NOT a CI failure). Unlike the sibling
 * `intent-weights` route (which keeps its swap INLINE and therefore reads as OK), this
 * route deliberately reuses the shared, CRM-path-shared `upsertConversionLabel` rather than
 * re-declaring its precedence SQL (Rule H). The atomicity documented above IS real; it is
 * proven PRIMARILY by the unit test "ROLLS BACK (no silent 200) when the staff audit insert
 * fails inside the tx" (`../route.test.ts`), NOT by the guard. FOLLOW-613 — teaching the
 * guard to follow `@estalara/db` package-barrel re-exports — flips this route to OK with no
 * code change here; until it lands, that test is the load-bearing atomicity check for this
 * write. (FOLLOW-597 makes this the FIRST live instance of the FOLLOW-613 barrel-SKIP class,
 * which was filed as latent — see FOLLOW_UPS.md FOLLOW-613.)
 *
 * Rule K.2 — fail loud:
 *   When DATABASE_URL_ADMIN is set but Postgres fails → 500 + Sentry capture.
 *   When DATABASE_URL_ADMIN is absent → 503 "database not configured" (not a silent mock).
 *
 * @module apps/control-plane/src/app/api/admin/labels/[id]/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { eq } from 'drizzle-orm';

import { isStaffClaims } from '@estalara/auth';
// FOLLOW-555 (A3-F-04): accept the @supabase/ssr browser session in addition to the
// Bearer/legacy-cookie path so a logged-in labels-page PATCH fetch() no longer 401s.
import { getSessionAuthClaims } from '@/lib/session-auth';
import {
  createAdminClient,
  conversionLabels,
  upsertConversionLabel,
  staffAuditLog,
} from '@estalara/db';
import type { Database } from '@estalara/db';
import { ConversionOutcomeClassSchema } from '@estalara/shared';

/** Best-effort client IP for the staff audit trail (no throw if absent). */
function requestIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return req.headers.get('x-real-ip');
}

// ─── Body schema ──────────────────────────────────────────────────────────────

const PatchBodySchema = z
  .object({
    outcome_class: ConversionOutcomeClassSchema,
    notes: z.string().max(2000).optional(),
  })
  .strict();

// ─── PATCH handler ────────────────────────────────────────────────────────────

/**
 * PATCH /api/admin/labels/[id]
 *
 * @returns 200 { ok: true, id, outcome_class, label_source, updated_at } on success.
 * @returns 400 on Zod validation failure.
 * @returns 401 when JWT is missing, invalid, or has insufficient role.
 * @returns 403 when an agency user attempts to reclassify a label from another tenant.
 * @returns 404 when the label row does not exist (or belongs to another tenant).
 * @returns 503 when DATABASE_URL_ADMIN is not configured.
 * @returns 500 on Postgres failure (Rule K.2 — fail loud).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // ── Auth gate ─────────────────────────────────────────────────────────────
  const claims = await getSessionAuthClaims(req);
  if (!claims) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Valid Bearer JWT is required' } },
      { status: 401 },
    );
  }

  // Role gate: staff ≥ estalara:ops OR agency ≥ agency:owner.
  // We do not use requireStaffAccess / requireTenantAccess here because this
  // endpoint accepts BOTH staff and agency users — we handle each branch below.
  const isStaff = isStaffClaims(claims);
  if (!isStaff) {
    // Agency user: require at least agency:owner.
    const roleRank: Record<string, number> = {
      'agency:owner': 3,
      'agency:admin': 2,
      'agency:viewer': 1,
    };
    const actualRank = roleRank[claims.agency_role] ?? 0;
    const ownerRank = roleRank['agency:owner'] ?? 3;
    if (actualRank < ownerRank) {
      return NextResponse.json(
        {
          error: {
            code: 'forbidden',
            message: 'agency:owner role is required to reclassify labels',
          },
        },
        { status: 401 },
      );
    }
  } else {
    // Staff: require at least estalara:ops.
    const staffRank: Record<string, number> = {
      'estalara:superadmin': 3,
      'estalara:ops': 2,
      'estalara:readonly': 1,
    };
    const actualRank = staffRank[claims.estalara_role] ?? 0;
    const opsRank = staffRank['estalara:ops'] ?? 2;
    if (actualRank < opsRank) {
      return NextResponse.json(
        {
          error: {
            code: 'forbidden',
            message: 'estalara:ops role or higher is required to reclassify labels',
          },
        },
        { status: 401 },
      );
    }
  }

  // ── DB availability check (fail loud, not fail-silent) ────────────────────
  const dbConfigured = Boolean(process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT);
  if (!dbConfigured) {
    return NextResponse.json(
      {
        error: {
          code: 'service_unavailable',
          message: 'Database not configured — reclassification unavailable',
        },
      },
      { status: 503 },
    );
  }

  // ── Parse + validate body ─────────────────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'Request body must be valid JSON' } },
      { status: 400 },
    );
  }

  const parsed = PatchBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_error',
          message: 'Validation failed',
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  const { outcome_class, notes } = parsed.data;

  // ── Resolve label ID from path ────────────────────────────────────────────
  const { id: labelId } = await params;
  if (!labelId) {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'Missing label id in path' } },
      { status: 400 },
    );
  }

  // ── Fetch existing row to verify existence + tenant ownership ─────────────
  const db = createAdminClient();

  let existing: {
    id: string;
    tenantId: string;
    predictionId: string;
    leadId: string;
  } | null = null;

  try {
    const rows = await db
      .select({
        id: conversionLabels.id,
        tenantId: conversionLabels.tenantId,
        predictionId: conversionLabels.predictionId,
        leadId: conversionLabels.leadId,
      })
      .from(conversionLabels)
      .where(eq(conversionLabels.id, labelId))
      .limit(1);

    existing = rows[0] ?? null;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, {
      tags: { admin_labels_patch_select_error: 'true' },
      extra: { label_id: labelId },
    });
    return NextResponse.json(
      { error: { code: 'postgres_query_failed', message: `DB read failed: ${message}` } },
      { status: 500 },
    );
  }

  if (!existing) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Label not found' } },
      { status: 404 },
    );
  }

  // ── Cross-tenant ownership check (belt-and-suspenders) ───────────────────
  // Staff may reclassify across all tenants.
  // Agency users are pinned to their JWT tenant_id.
  if (!isStaff) {
    if (existing.tenantId !== claims.tenant_id) {
      // Treat as 404 to avoid leaking which tenants have labels for a given id.
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Label not found' } },
        { status: 404 },
      );
    }
  }

  const tenantId = existing.tenantId;

  // ── Write reclassification via upsertConversionLabel ─────────────────────
  // label_source is always 'manual_admin' on this path (§T.5).
  // upsertConversionLabel enforces the one-row-per-(tenant_id, prediction_id)
  // invariant and the precedence policy (FOLLOW-179) — a manual_admin write
  // always outranks any prior system label.
  const now = new Date();

  try {
    if (isStaff) {
      // ── Atomic staff write (ADR-0018 §3a, FOLLOW-597) ───────────────────────
      // The reclassification and its staff_audit_log row commit-or-roll-back
      // TOGETHER in ONE db.transaction(), so a mutation can never outlive a
      // missing/failed audit row (mirrors quiz/config POST, FOLLOW-605).
      await db.transaction(async (tx) => {
        await upsertConversionLabel(tx as unknown as Database, {
          tenantId,
          predictionId: existing.predictionId,
          leadId: existing.leadId,
          outcomeClass: outcome_class,
          labelSource: 'manual_admin',
          confidence: 1.0,
          ...(notes !== undefined ? { notes } : {}),
          labeledAt: now,
        });
        // Staff audit trail (§3) — attributed to the acting staff user. AWAITED
        // inside the tx (never fire-and-forget) so it commits atomically.
        await tx.insert(staffAuditLog).values({
          adminUserId: claims.sub,
          action: 'conversion_label.reclassify',
          targetTenantId: tenantId,
          payload: { label_id: labelId, outcome_class, notes: notes ?? null },
          ipAddress: requestIp(req),
          userAgent: req.headers.get('user-agent'),
        });
      });
    } else {
      // Agency self-service write — UNCHANGED and NOT audited (§3 audits STAFF only).
      await upsertConversionLabel(db, {
        tenantId,
        predictionId: existing.predictionId,
        leadId: existing.leadId,
        outcomeClass: outcome_class,
        labelSource: 'manual_admin',
        confidence: 1.0,
        ...(notes !== undefined ? { notes } : {}),
        labeledAt: now,
      });
    }
  } catch (err: unknown) {
    if (isStaff) {
      // Any failure INSIDE the tx (the upsert OR the audit insert) rolls BOTH
      // back — there is no orphan reclassification left behind. Fail loud:
      // capture to Sentry and return 500, never a silent unattributed 200
      // (Rule K.2). A retry is safe (idempotent upsert + a fresh audit row).
      Sentry.captureException(err, {
        tags: { admin_labels_patch_staff_audit_error: 'true' },
        extra: { label_id: labelId, tenant_id: tenantId },
      });
      return NextResponse.json(
        {
          error: {
            code: 'audit_write_failed',
            message:
              'The reclassification could not be recorded atomically with its staff ' +
              'audit row; the change was rolled back and NOT applied. Retry the action.',
          },
        },
        { status: 500 },
      );
    }

    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, {
      tags: { admin_labels_patch_write_error: 'true' },
      extra: { label_id: labelId, tenant_id: tenantId },
    });
    return NextResponse.json(
      {
        error: {
          code: 'postgres_write_failed',
          message: `Reclassification write failed: ${message}`,
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      id: labelId,
      outcome_class,
      label_source: 'manual_admin',
      updated_at: now.toISOString(),
    },
    { status: 200 },
  );
}
