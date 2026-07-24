/**
 * GET  /api/admin/tenants/quiz-definition?tenant_id=<uuid> — read a tenant's ACTIVE editable
 *      quiz definition + the non-blocking unreachable-archetype warning (staff/superadmin only).
 * PUT  /api/admin/tenants/quiz-definition?tenant_id=<uuid> — save a NEW active version of the
 *      tenant's quiz definition (staff/superadmin only, validated, audited, atomic).
 *
 * FOLLOW-639 / ADR-0019 D5 + D7: the audited WRITE PATH for the fully editable per-brand quiz
 * tree. The active row is consumed at runtime by `GET /api/quiz/public-config` (the
 * `quiz_definition` slice) → the SDK generic tree-walker. This route is that table's only human
 * write path.
 *
 * Auth (ADR-0018 §2, FOLLOW-592/614): `resolveTenantAccess` with `allowStaffOverride`.
 *   STAFF-ONLY — the editable quiz tree is an Estalara operator control (no agency write path
 *   yet), so a resolved agency session is rejected 403 (`staff_only`), mirroring `al-state`. An
 *   Estalara staff caller targets a tenant via `?tenant_id=<uuid>`, validated against the
 *   `tenants` table (invariant 4); that validated id is the SINGLE tenant fence bound into every
 *   query (invariant 5). This route uses `createAdminClient()` (service-role, RLS BYPASSED), so
 *   the explicit `eq(quizDefinitions.tenantId, …)` fence is the ONLY tenant boundary.
 *
 *   Identity caveat (RETRO-187): a privileged write MUST be attributable to
 *   `staff_audit_log.adminUserId`; the headless `ADMIN_API_SECRET` Bearer path is rejected for
 *   staff by `resolveTenantAccess`. Staff need an identified SSR session or staff JWT.
 *
 * Write-rank gate (ADR-0018 §4, FOLLOW-615): PUT rejects any staff caller below `estalara:ops`
 *   (rank < 2) with 403, mirroring every sibling staff write.
 *
 * Staff-write atomicity (ADR-0018 §3a, RETRO-202): the PUT deactivates the prior active row,
 *   inserts the new active version, AND inserts the `staff_audit_log` row
 *   (`action: 'quiz_definition.update'`) TOGETHER in ONE `db.transaction()`, kept INLINE so
 *   `scripts/check-staff-write-atomicity.cjs` proves the shared tx scope directly.
 *
 * Integrity (CEO ruling + ADR-0019 D3): the submitted definition is validated with
 *   `QuizDefinitionSchema` — HARD errors (unknown archetype id, dangling `next`, cycle, duplicate
 *   id) reject the write (400). The unreachable-archetype list is NON-BLOCKING and returned as a
 *   `warnings.unreachable_archetypes` field for the editor to surface (never blocks the save).
 *
 * @module apps/control-plane/src/app/api/admin/tenants/quiz-definition/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import * as Sentry from '@sentry/nextjs';
import { and, desc, eq } from 'drizzle-orm';

import { createAdminClient, quizDefinitions, staffAuditLog } from '@estalara/db';
import type { QuizDefinition } from '@estalara/shared';
import { QuizDefinitionSchema, computeUnreachableArchetypes } from '@estalara/shared';
import { resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';
import { accessErrorToResponse } from '@/lib/access-error-response';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QuizDefinitionState {
  tenant_id: string;
  /** Active version number, or `null` when the tenant has no saved definition (uses default). */
  version: number | null;
  /** The active definition, or `null` when none is saved (SDK uses its built-in default tree). */
  definition: QuizDefinition | null;
  warnings: {
    /** Non-blocking (ADR-0019 D3): archetypes unreachable under the active/submitted tree. */
    unreachable_archetypes: string[];
  };
}

const PutBodySchema = z.object({
  definition: QuizDefinitionSchema,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Best-effort client IP for the staff audit trail (no throw if absent). */
function requestIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return req.headers.get('x-real-ip');
}

/** Resolve access shared by GET + PUT, then enforce STAFF-ONLY (no agency path). */
async function resolveStaffAccess(
  req: NextRequest,
): Promise<{ access: Extract<TenantAccess, { via: 'staff' }> } | { error: NextResponse }> {
  const tenantIdParam = req.nextUrl.searchParams.get('tenant_id');
  let access: TenantAccess;
  try {
    access = await resolveTenantAccess(req, {
      allowStaffOverride: true,
      // Lowest agency floor: a resolved agency session is allowed THROUGH the role check only
      // to be rejected below with a clear staff-only 403. Editable quiz content is an Estalara
      // operator control.
      minAgencyRole: 'agency:viewer',
      ...(tenantIdParam ? { tenantId: tenantIdParam } : {}),
    });
  } catch (err) {
    return { error: accessErrorToResponse(err) };
  }

  if (access.via !== 'staff') {
    return {
      error: NextResponse.json(
        {
          error: {
            code: 'staff_only',
            message: 'The editable quiz definition is an Estalara staff/superadmin control',
          },
        },
        { status: 403 },
      ),
    };
  }

  return { access };
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const resolved = await resolveStaffAccess(req);
  if ('error' in resolved) return resolved.error;
  const tenantId = resolved.access.tenantId;

  try {
    const db = createAdminClient();
    const rows = await db
      .select({ version: quizDefinitions.version, definition: quizDefinitions.definition })
      .from(quizDefinitions)
      // invariant 5: the ONLY tenant fence on this service-role client.
      .where(and(eq(quizDefinitions.tenantId, tenantId), eq(quizDefinitions.isActive, true)))
      .limit(1);

    const row = rows[0];
    if (!row) {
      // No saved definition → the SDK uses its built-in default tree (D4/D5). Not an error.
      const body: QuizDefinitionState = {
        tenant_id: tenantId,
        version: null,
        definition: null,
        warnings: { unreachable_archetypes: [] },
      };
      return NextResponse.json(body, { status: 200 });
    }

    // Re-validate the stored blob (belt-and-suspenders). A stored definition that no longer
    // validates (e.g. an archetype renamed out of canon) is surfaced as null so the editor
    // shows "no valid active definition" rather than crashing on a bad blob.
    const parsed = QuizDefinitionSchema.safeParse(row.definition);
    const definition = parsed.success ? parsed.data : null;
    const body: QuizDefinitionState = {
      tenant_id: tenantId,
      version: row.version,
      definition,
      warnings: {
        unreachable_archetypes: definition ? computeUnreachableArchetypes(definition) : [],
      },
    };
    return NextResponse.json(body, { status: 200 });
  } catch (err: unknown) {
    // Rule K.2 — fail loud: the DB is configured but the query threw.
    console.error('[quiz-definition GET] DB error:', err instanceof Error ? err.message : err);
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { route: 'admin/tenants/quiz-definition', op: 'get' },
      extra: { tenant_id: tenantId },
    });
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to load quiz definition' } },
      { status: 500 },
    );
  }
}

// ─── PUT ──────────────────────────────────────────────────────────────────────

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const resolved = await resolveStaffAccess(req);
  if ('error' in resolved) return resolved.error;
  const access = resolved.access;
  const tenantId = access.tenantId;

  // Write-rank gate (CEO Q3, ADR-0018 §4; FOLLOW-615): staff below `estalara:ops` is view-only.
  if (!access.canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'Staff write requires estalara:ops or higher' } },
      { status: 403 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Request body must be valid JSON' } },
      { status: 400 },
    );
  }

  // HARD integrity (ADR-0019 D3): unknown archetype id / dangling next / cycle / duplicate id
  // all reject here (400). The unreachable-archetype warning is NON-BLOCKING (computed below).
  const parsed = PutBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Invalid quiz definition',
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  const definition = parsed.data.definition;
  const db = createAdminClient();

  // Read the current active version (fenced on tenantId — invariant 5) so the new version is
  // monotonic and the audit row carries a real before/after. A read failure fails loud (500).
  let priorVersion: number | null;
  try {
    const rows = await db
      .select({ version: quizDefinitions.version })
      .from(quizDefinitions)
      .where(eq(quizDefinitions.tenantId, tenantId))
      .orderBy(desc(quizDefinitions.version))
      .limit(1);
    priorVersion = rows[0]?.version ?? null;
  } catch (err: unknown) {
    console.error(
      '[quiz-definition PUT] failed to read prior version:',
      err instanceof Error ? err.message : err,
    );
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { route: 'admin/tenants/quiz-definition', op: 'put_read' },
      extra: { tenant_id: tenantId },
    });
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to load quiz definition' } },
      { status: 500 },
    );
  }

  const nextVersion = (priorVersion ?? 0) + 1;

  // ── Atomic staff write (ADR-0018 §3a) ──────────────────────────────────────
  // Deactivate the prior active row, insert the new active version, AND insert the
  // `staff_audit_log` row commit-or-roll-back TOGETHER in ONE transaction (RETRO-202), kept
  // INLINE so scripts/check-staff-write-atomicity.cjs proves the shared tx scope directly.
  // Order matters: deactivate FIRST so the partial unique index (one active per tenant) never
  // sees two active rows mid-transaction.
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(quizDefinitions)
        .set({ isActive: false })
        .where(and(eq(quizDefinitions.tenantId, tenantId), eq(quizDefinitions.isActive, true)));

      await tx.insert(quizDefinitions).values({
        tenantId,
        version: nextVersion,
        definition,
        isActive: true,
        createdBy: access.staff.sub,
      });

      // Staff audit trail (§3) — attributed to the acting staff user. AWAITED inside the tx so
      // it commits atomically with the mutation.
      await tx.insert(staffAuditLog).values({
        adminUserId: access.staff.sub,
        action: 'quiz_definition.update',
        targetTenantId: tenantId,
        payload: {
          before: { version: priorVersion },
          after: { version: nextVersion, root: definition.root },
        },
        ipAddress: requestIp(req),
        userAgent: req.headers.get('user-agent'),
      });
    });
  } catch (err: unknown) {
    // Any failure INSIDE the tx rolls ALL of it back — no orphan version, no un-audited write.
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { route: 'admin/tenants/quiz-definition', op: 'put', staff_audit_error: 'true' },
      extra: { tenant_id: tenantId, admin_user_id: access.staff.sub },
    });
    return NextResponse.json(
      {
        error: {
          code: 'audit_write_failed',
          message:
            'The quiz definition change could not be recorded atomically with its staff audit ' +
            'row; the change was rolled back and NOT applied. Retry the action.',
        },
      },
      { status: 500 },
    );
  }

  const body: QuizDefinitionState = {
    tenant_id: tenantId,
    version: nextVersion,
    definition,
    warnings: { unreachable_archetypes: computeUnreachableArchetypes(definition) },
  };
  return NextResponse.json(body, { status: 200 });
}
