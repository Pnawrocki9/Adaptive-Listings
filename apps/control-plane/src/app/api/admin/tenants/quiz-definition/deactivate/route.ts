/**
 * PUT /api/admin/tenants/quiz-definition/deactivate?tenant_id=<uuid> — REVERT a tenant to the
 * built-in default quiz (FOLLOW-1362 C1, ESC-086 item 5). Staff ops+ (decision Q-H).
 *
 * Body (optional): `{ base_version?: number | null }` — when present, 409 `version_conflict` if
 * the active version moved since the caller loaded it.
 *
 * In ONE transaction, under the tenant's `pg_advisory_xact_lock`: read the heads, 409
 * `no_active_definition` when nothing is active, set the active row inactive, and insert the
 * `quiz_definition.revert_to_default` audit row — commit or roll back together (ADR-0018 §3a).
 * No row is deleted (history stays append-only). `GET /api/quiz/public-config` then serves
 * `DEFAULT_QUIZ_DEFINITION_V2` (its no-active-row branch).
 *
 * Audit payload: `before: {version, sha256}`, `after: {version: null}`.
 *
 * @module apps/control-plane/src/app/api/admin/tenants/quiz-definition/deactivate/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import * as Sentry from '@sentry/nextjs';
import { and, eq } from 'drizzle-orm';

import { createAdminClient, quizDefinitions, staffAuditLog } from '@estalara/db';
import {
  QuizWriteRejection,
  assertBaseVersion,
  auditBeforeBlock,
  lockTenantQuizDefinitions,
  quizWriteRejectionResponse,
  readQuizDefinitionHeads,
  requestIp,
  resolveQuizDefinitionAccess,
  writeFailedResponse,
  writeForbiddenResponse,
} from '@/lib/quiz-definition-admin';

/** `PUT …/deactivate` — the tenant now serves the built-in default. */
export interface QuizDefinitionRevertResponse {
  tenant_id: string;
  version: null;
  /** The version that was active before the revert. */
  reverted_from: number;
}

const DeactivateBodySchema = z.object({
  base_version: z.number().int().positive().nullable().optional(),
});

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const resolved = await resolveQuizDefinitionAccess(req);
  if ('error' in resolved) return resolved.error;
  const access = resolved.access;
  const tenantId = access.tenantId;

  if (!access.canWrite) return writeForbiddenResponse();

  // The body is optional: an empty body means "no base_version check".
  let rawBody: unknown = {};
  const text = await req.text();
  if (text.trim() !== '') {
    try {
      rawBody = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: { code: 'validation_failed', message: 'Request body must be valid JSON' } },
        { status: 400 },
      );
    }
  }
  const body = DeactivateBodySchema.safeParse(rawBody);
  if (!body.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Body must be { base_version?: number | null }',
          details: body.error.flatten(),
        },
      },
      { status: 400 },
    );
  }
  const baseVersion = body.data.base_version;

  const db = createAdminClient();
  let revertedFrom = 0;

  // ── Atomic staff write (ADR-0018 §3a) — kept INLINE for check-staff-write-atomicity.cjs ──
  try {
    await db.transaction(async (tx) => {
      await lockTenantQuizDefinitions(tx, tenantId);
      const heads = await readQuizDefinitionHeads(tx, tenantId);
      if (!heads.active) {
        throw new QuizWriteRejection(
          409,
          'no_active_definition',
          'No quiz definition is active — the tenant already serves the built-in default',
        );
      }
      assertBaseVersion(baseVersion, heads);
      revertedFrom = heads.active.version;

      await tx
        .update(quizDefinitions)
        .set({ isActive: false })
        .where(and(eq(quizDefinitions.tenantId, tenantId), eq(quizDefinitions.isActive, true)));

      await tx.insert(staffAuditLog).values({
        adminUserId: access.staff.sub,
        action: 'quiz_definition.revert_to_default',
        targetTenantId: tenantId,
        payload: {
          before: await auditBeforeBlock(heads),
          after: { version: null },
        },
        ipAddress: requestIp(req),
        userAgent: req.headers.get('user-agent'),
      });
    });
  } catch (err: unknown) {
    if (err instanceof QuizWriteRejection) return quizWriteRejectionResponse(err);
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: {
        route: 'admin/tenants/quiz-definition/deactivate',
        op: 'put',
        staff_audit_error: 'true',
      },
      extra: { tenant_id: tenantId, admin_user_id: access.staff.sub },
    });
    return writeFailedResponse();
  }

  const response: QuizDefinitionRevertResponse = {
    tenant_id: tenantId,
    version: null,
    reverted_from: revertedFrom,
  };
  return NextResponse.json(response, { status: 200 });
}
