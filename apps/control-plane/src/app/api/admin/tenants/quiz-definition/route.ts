/**
 * GET  /api/admin/tenants/quiz-definition?tenant_id=<uuid> — read a tenant's ACTIVE editable
 *      quiz definition + the non-blocking unreachable-archetype warning + lint (any staff rank).
 * PUT  /api/admin/tenants/quiz-definition?tenant_id=<uuid> — save a NEW active version of the
 *      tenant's quiz definition (staff ops+, validated, audited, atomic).
 *
 * FOLLOW-639 / ADR-0019 D5 + D7: the audited WRITE PATH for the fully editable per-brand quiz
 * tree. The active row is consumed at runtime by `GET /api/quiz/public-config` (the
 * `quiz_definition` slice) → the SDK generic tree-walker. This route and its siblings
 * `activate/` (restore a version) and `deactivate/` (revert to the built-in default) are that
 * table's only human write paths; `versions/` reads the history (FOLLOW-1362 C1).
 *
 * Auth (ADR-0018 §2, FOLLOW-592/614): `resolveTenantAccess` with `allowStaffOverride`.
 *   STAFF-ONLY — the editable quiz tree is an Estalara operator control; a non-staff caller is
 *   401 in `resolveTenantAccess` (FOLLOW-1335 removed the agency path and this route's 403). An
 *   Estalara staff caller targets a tenant via `?tenant_id=<uuid>`, validated against the
 *   `tenants` table (invariant 4); that validated id is the SINGLE tenant fence bound into every
 *   query (invariant 5). This route uses `createAdminClient()` (service-role, RLS BYPASSED), so
 *   the explicit `eq(quizDefinitions.tenantId, …)` fence is the ONLY tenant boundary.
 *
 *   Identity caveat (RETRO-187): a privileged write MUST be attributable to
 *   `staff_audit_log.adminUserId`; the headless `ADMIN_API_SECRET` Bearer path is rejected for
 *   staff by `resolveTenantAccess`. Staff need an identified SSR session or staff JWT.
 *
 * Write-rank gate (ADR-0018 §4, FOLLOW-615, decision Q-H): PUT rejects any staff caller below
 *   `estalara:ops` (rank < 2) with 403, mirroring every sibling staff write.
 *
 * Staff-write atomicity (ADR-0018 §3a, RETRO-202): the PUT deactivates the prior active row,
 *   inserts the new active version, AND inserts the `staff_audit_log` row
 *   (`action: 'quiz_definition.update'`) TOGETHER in ONE `db.transaction()`, kept INLINE so
 *   `scripts/check-staff-write-atomicity.cjs` proves the shared tx scope directly.
 *
 * Integrity (CEO ruling + ADR-0019 D3; FOLLOW-1362 C1): the submitted definition is validated with
 *   the AUTHORING schema `QuizDefinitionAuthoringSchema` (= the serve schema + every
 *   `lintQuizDefinition` error: EN + PL on every text, size limits, `confirm` completeness) —
 *   any error rejects the write (400, `issues` carry the lint codes; no write, no audit). Lint
 *   WARNINGS and the unreachable-archetype list are NON-BLOCKING and returned for the editor.
 *
 * Concurrency (FOLLOW-1362 C1): the write transaction first takes the tenant's
 *   `pg_advisory_xact_lock` (`lockTenantQuizDefinitions`), THEN reads `max(version)` and the
 *   active row — so two concurrent saves get distinct versions. An optional `base_version` (the
 *   active version the editor loaded; `null` = none) answers 409 `version_conflict` when another
 *   write landed in between. Audit payload (additive): `before: {version, sha256}`,
 *   `after: {version, root, sha256, questions, answers}`, `source` (`editor` | `import`) — never
 *   the full blob.
 *
 * GET (FOLLOW-1362 C1) additionally returns `can_write` (the staff rank verdict), `lint` (the
 *   active definition's lint result) and `invalid_active` + `raw` (the stored JSON) when the
 *   active row no longer passes the serve schema — instead of a silent `definition: null`.
 *
 * @module apps/control-plane/src/app/api/admin/tenants/quiz-definition/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import * as Sentry from '@sentry/nextjs';
import { and, eq } from 'drizzle-orm';

import { createAdminClient, quizDefinitions, staffAuditLog } from '@estalara/db';
import type { QuizDefinition, QuizLintResult } from '@estalara/shared';
import {
  QuizDefinitionAuthoringSchema,
  QuizDefinitionSchema,
  computeUnreachableArchetypes,
  lintQuizDefinition,
} from '@estalara/shared';
import {
  QuizWriteRejection,
  assertBaseVersion,
  auditAfterBlock,
  auditBeforeBlock,
  lockTenantQuizDefinitions,
  quizWriteRejectionResponse,
  readQuizDefinitionHeads,
  requestIp,
  resolveQuizDefinitionAccess,
  writeFailedResponse,
  writeForbiddenResponse,
} from '@/lib/quiz-definition-admin';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QuizDefinitionState {
  tenant_id: string;
  /** Active version number, or `null` when the tenant has no saved definition (uses default). */
  version: number | null;
  /**
   * The active definition, or `null` when none is saved (public-config serves the built-in
   * default) or when the active row fails the serve schema (`invalid_active: true`).
   */
  definition: QuizDefinition | null;
  warnings: {
    /** Non-blocking (ADR-0019 D3): archetypes unreachable under the active/submitted tree. */
    unreachable_archetypes: string[];
  };
  /** FOLLOW-1362: whether the caller's staff rank may write (ops+); the editor goes read-only. */
  can_write: boolean;
  /**
   * FOLLOW-1362: `true` when an active row EXISTS but fails the serve schema — public-config
   * then serves the built-in default. `raw` carries the stored JSON so the editor can show it.
   */
  invalid_active: boolean;
  /** The stored JSON of an invalid active row; `null` otherwise. */
  raw: unknown;
  /** FOLLOW-1362: `lintQuizDefinition` of the active/saved definition; `null` when there is none. */
  lint: QuizLintResult | null;
}

/** One authoring-validation issue of a rejected PUT (`code` = the lint code when there is one). */
interface QuizDefinitionAuthoringIssue {
  code: string;
  path: (string | number)[];
  message: string;
}

const PutBodySchema = z.object({
  /** Validated separately with the authoring schema so the 400 can carry the lint codes. */
  definition: z.unknown(),
  /** The active version the editor loaded (`null` = none). Omit to skip the 409 check. */
  base_version: z.number().int().positive().nullable().optional(),
  /** Where the definition came from — recorded in the audit row. */
  source: z.enum(['editor', 'import']).default('editor'),
});

function toAuthoringIssues(error: z.ZodError): QuizDefinitionAuthoringIssue[] {
  return error.issues.map((issue) => {
    const lintCode: unknown =
      issue.code === z.ZodIssueCode.custom ? issue.params?.lint_code : undefined;
    return {
      code: typeof lintCode === 'string' ? lintCode : issue.code,
      path: issue.path,
      message: issue.message,
    };
  });
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const resolved = await resolveQuizDefinitionAccess(req);
  if ('error' in resolved) return resolved.error;
  const tenantId = resolved.access.tenantId;
  const canWrite = resolved.access.canWrite;

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
      // No saved definition → public-config serves the built-in default tree. Not an error.
      const body: QuizDefinitionState = {
        tenant_id: tenantId,
        version: null,
        definition: null,
        warnings: { unreachable_archetypes: [] },
        can_write: canWrite,
        invalid_active: false,
        raw: null,
        lint: null,
      };
      return NextResponse.json(body, { status: 200 });
    }

    // Re-validate the stored blob with the SERVE schema (the one public-config applies). A row
    // that no longer passes it is surfaced as `invalid_active` with its raw JSON — buyers are
    // being served the built-in default, and the editor must say so rather than load a starter
    // tree as if nothing were saved (FOLLOW-1362).
    const parsed = QuizDefinitionSchema.safeParse(row.definition);
    const definition = parsed.success ? parsed.data : null;
    const body: QuizDefinitionState = {
      tenant_id: tenantId,
      version: row.version,
      definition,
      warnings: {
        unreachable_archetypes: definition ? computeUnreachableArchetypes(definition) : [],
      },
      can_write: canWrite,
      invalid_active: definition === null,
      raw: definition === null ? row.definition : null,
      lint: definition ? lintQuizDefinition(definition) : null,
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
  const resolved = await resolveQuizDefinitionAccess(req);
  if ('error' in resolved) return resolved.error;
  const access = resolved.access;
  const tenantId = access.tenantId;

  // Write-rank gate (CEO Q3, ADR-0018 §4; FOLLOW-615; decision Q-H): below ops is view-only.
  if (!access.canWrite) return writeForbiddenResponse();

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Request body must be valid JSON' } },
      { status: 400 },
    );
  }

  const envelope = PutBodySchema.safeParse(rawBody);
  if (!envelope.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Invalid request body',
          details: envelope.error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  // AUTHORING validation (FOLLOW-1362): the serve schema's HARD integrity (unknown archetype id,
  // dangling next, cycle, duplicate id) plus every lint error (EN + PL, limits, confirm). 400
  // with the issues; nothing is written and nothing is audited.
  const parsed = QuizDefinitionAuthoringSchema.safeParse(envelope.data.definition);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Invalid quiz definition',
          issues: toAuthoringIssues(parsed.error),
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  const definition = parsed.data;
  const { base_version: baseVersion, source } = envelope.data;
  const db = createAdminClient();
  let nextVersion = 0;

  // ── Atomic staff write (ADR-0018 §3a) ──────────────────────────────────────
  // Lock → read heads → 409 check → deactivate → insert → audit, commit-or-roll-back TOGETHER in
  // ONE transaction (RETRO-202), kept INLINE so scripts/check-staff-write-atomicity.cjs proves
  // the shared tx scope directly. The lock comes FIRST so `max(version)` is read after any
  // concurrent writer committed. Deactivate before insert so the partial unique index (one
  // active per tenant) never sees two active rows mid-transaction.
  try {
    await db.transaction(async (tx) => {
      await lockTenantQuizDefinitions(tx, tenantId);
      const heads = await readQuizDefinitionHeads(tx, tenantId);
      assertBaseVersion(baseVersion, heads);
      nextVersion = heads.maxVersion + 1;

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
      // it commits atomically with the mutation. Version pair + sha256, never the blob.
      await tx.insert(staffAuditLog).values({
        adminUserId: access.staff.sub,
        action: 'quiz_definition.update',
        targetTenantId: tenantId,
        payload: {
          before: await auditBeforeBlock(heads),
          after: await auditAfterBlock(nextVersion, definition),
          source,
        },
        ipAddress: requestIp(req),
        userAgent: req.headers.get('user-agent'),
      });
    });
  } catch (err: unknown) {
    if (err instanceof QuizWriteRejection) return quizWriteRejectionResponse(err);
    // Any failure INSIDE the tx rolls ALL of it back — no orphan version, no un-audited write.
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { route: 'admin/tenants/quiz-definition', op: 'put', staff_audit_error: 'true' },
      extra: { tenant_id: tenantId, admin_user_id: access.staff.sub },
    });
    return writeFailedResponse();
  }

  const body: QuizDefinitionState = {
    tenant_id: tenantId,
    version: nextVersion,
    definition,
    warnings: { unreachable_archetypes: computeUnreachableArchetypes(definition) },
    can_write: true,
    invalid_active: false,
    raw: null,
    lint: lintQuizDefinition(definition),
  };
  return NextResponse.json(body, { status: 200 });
}
