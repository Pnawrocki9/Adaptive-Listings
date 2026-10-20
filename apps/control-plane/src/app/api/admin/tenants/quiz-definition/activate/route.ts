/**
 * PUT /api/admin/tenants/quiz-definition/activate?tenant_id=<uuid> — RESTORE an earlier version
 * of a tenant's quiz definition (FOLLOW-1362 C1, ESC-086 item 5). Staff ops+ (decision Q-H).
 *
 * Body: `{ from_version: number, base_version: number | null }`.
 *
 * Copy-forward, history append-only: the source row is never re-activated in place. In ONE
 * transaction, under the tenant's `pg_advisory_xact_lock` (the same lock as the PUT save): read
 * the heads, 409 `version_conflict` when the active version is not `base_version`, read the source
 * row (tenant-fenced: another tenant's version is a 404), parse it with the SERVE schema only,
 * deactivate the active row, insert a COPY as version `max + 1`, and insert the
 * `quiz_definition.restore` audit row — commit or roll back together (ADR-0018 §3a).
 *
 * Restore is the panic button: newer AUTHORING rules never block it. The lint result is returned
 * for the editor to show, not enforced. Only a row that fails the serve schema (public-config
 * could not serve it either) is refused, 422 `invalid_source_definition`. Restoring the version
 * that is already active is 409 `already_active` (nothing to do).
 *
 * Audit payload: `before: {version, sha256}`, `after: {version, root, sha256, questions,
 * answers}`, `restored_from` — never the blob.
 *
 * @module apps/control-plane/src/app/api/admin/tenants/quiz-definition/activate/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import * as Sentry from '@sentry/nextjs';
import { and, desc, eq } from 'drizzle-orm';

import { createAdminClient, quizDefinitions, staffAuditLog } from '@estalara/db';
import type { QuizDefinition } from '@estalara/shared';
import {
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
import type { QuizDefinitionState } from '../route';

/** `PUT …/activate` — the new active state plus the version it was copied from. */
export interface QuizDefinitionRestoreResponse extends QuizDefinitionState {
  restored_from: number;
}

const ActivateBodySchema = z.object({
  from_version: z.number().int().positive(),
  /** The active version the caller saw (`null` = none active). Required: restore is a write. */
  base_version: z.number().int().positive().nullable(),
});

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const resolved = await resolveQuizDefinitionAccess(req);
  if ('error' in resolved) return resolved.error;
  const access = resolved.access;
  const tenantId = access.tenantId;

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
  const body = ActivateBodySchema.safeParse(rawBody);
  if (!body.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Body must be { from_version: number, base_version: number | null }',
          details: body.error.flatten(),
        },
      },
      { status: 400 },
    );
  }
  const { from_version: fromVersion, base_version: baseVersion } = body.data;

  const db = createAdminClient();
  let restored: { version: number; definition: QuizDefinition };

  // ── Atomic staff write (ADR-0018 §3a) — kept INLINE for check-staff-write-atomicity.cjs ──
  try {
    restored = await db.transaction(async (tx) => {
      await lockTenantQuizDefinitions(tx, tenantId);
      const heads = await readQuizDefinitionHeads(tx, tenantId);
      assertBaseVersion(baseVersion, heads);
      if (heads.active?.version === fromVersion) {
        throw new QuizWriteRejection(
          409,
          'already_active',
          `Version ${String(fromVersion)} is already the active quiz definition`,
        );
      }

      const sourceRows = await tx
        .select({ definition: quizDefinitions.definition })
        .from(quizDefinitions)
        // invariant 5: tenant fence — another tenant's version is a 404, never a copy.
        .where(
          and(eq(quizDefinitions.tenantId, tenantId), eq(quizDefinitions.version, fromVersion)),
        )
        .orderBy(desc(quizDefinitions.createdAt))
        .limit(1);
      const source = sourceRows[0];
      if (!source) {
        throw new QuizWriteRejection(
          404,
          'not_found',
          `No quiz definition version ${String(fromVersion)}`,
        );
      }

      // SERVE schema only — never the authoring rules (restore must work after they tighten).
      const parsed = QuizDefinitionSchema.safeParse(source.definition);
      if (!parsed.success) {
        throw new QuizWriteRejection(
          422,
          'invalid_source_definition',
          `Version ${String(fromVersion)} no longer passes the serve schema and cannot be served`,
        );
      }
      const definition = parsed.data;
      const nextVersion = heads.maxVersion + 1;

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

      await tx.insert(staffAuditLog).values({
        adminUserId: access.staff.sub,
        action: 'quiz_definition.restore',
        targetTenantId: tenantId,
        payload: {
          before: await auditBeforeBlock(heads),
          after: await auditAfterBlock(nextVersion, definition),
          restored_from: fromVersion,
        },
        ipAddress: requestIp(req),
        userAgent: req.headers.get('user-agent'),
      });
      return { version: nextVersion, definition };
    });
  } catch (err: unknown) {
    if (err instanceof QuizWriteRejection) return quizWriteRejectionResponse(err);
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: {
        route: 'admin/tenants/quiz-definition/activate',
        op: 'put',
        staff_audit_error: 'true',
      },
      extra: { tenant_id: tenantId, admin_user_id: access.staff.sub, from_version: fromVersion },
    });
    return writeFailedResponse();
  }

  const { definition } = restored;
  const response: QuizDefinitionRestoreResponse = {
    tenant_id: tenantId,
    version: restored.version,
    definition,
    warnings: { unreachable_archetypes: computeUnreachableArchetypes(definition) },
    can_write: true,
    invalid_active: false,
    raw: null,
    lint: lintQuizDefinition(definition),
    restored_from: fromVersion,
  };
  return NextResponse.json(response, { status: 200 });
}
