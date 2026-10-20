/**
 * Shared, NON-mutating helpers of the staff quiz-definition routes (FOLLOW-1362 C1):
 * `GET|PUT /api/admin/tenants/quiz-definition`, `GET …/versions`, `PUT …/activate`,
 * `PUT …/deactivate`.
 *
 * Deliberately read-only: every mutation and its `staff_audit_log` insert stay INLINE in the
 * route files, inside one `db.transaction()`, so `scripts/check-staff-write-atomicity.cjs` can
 * prove the shared tx scope (ADR-0018 §3a). This module only holds the per-tenant write lock,
 * the in-transaction version read, the definition summary (hash + counts) and the shared
 * error responses.
 *
 * @module apps/control-plane/src/lib/quiz-definition-admin
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';

import { quizDefinitions, type Database } from '@estalara/db';
import type { QuizDefinition } from '@estalara/shared';
import { QuizDefinitionSchema, computeQuizDefinitionHash } from '@estalara/shared';
import { resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';
import { accessErrorToResponse } from '@/lib/access-error-response';

/** The subset of a drizzle client / transaction the helpers below need. */
type QueryRunner = Pick<Database, 'select' | 'execute'>;

/** Best-effort client IP for the staff audit trail (no throw if absent). */
export function requestIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return req.headers.get('x-real-ip');
}

/**
 * Resolve the staff caller of a quiz-definition route (staff-only, `?tenant_id=` override
 * validated against `tenants` by `resolveTenantAccess`). The returned `access.tenantId` is the
 * ONLY tenant fence every query must bind (invariant 5): the routes use the service-role client.
 */
export async function resolveQuizDefinitionAccess(
  req: NextRequest,
): Promise<{ access: TenantAccess } | { error: NextResponse }> {
  const tenantIdParam = req.nextUrl.searchParams.get('tenant_id');
  try {
    const access = await resolveTenantAccess(req, {
      allowStaffOverride: true,
      ...(tenantIdParam ? { tenantId: tenantIdParam } : {}),
    });
    return { access };
  } catch (err) {
    return { error: accessErrorToResponse(err) };
  }
}

/** 403 for a staff caller below `estalara:ops` (ADR-0018 §4, decision Q-H). */
export function writeForbiddenResponse(): NextResponse {
  return NextResponse.json(
    { error: { code: 'forbidden', message: 'Staff write requires estalara:ops or higher' } },
    { status: 403 },
  );
}

/** 500 for a staff write whose transaction failed — nothing was applied (Rule K.2). */
export function writeFailedResponse(): NextResponse {
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

/**
 * Thrown INSIDE a write transaction to roll it back and answer with a 4xx instead of the
 * generic 500. The route maps it with `quizWriteRejectionResponse`.
 */
export class QuizWriteRejection extends Error {
  constructor(
    readonly status: 404 | 409 | 422,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'QuizWriteRejection';
  }
}

/** The response for a `QuizWriteRejection`. */
export function quizWriteRejectionResponse(rejection: QuizWriteRejection): NextResponse {
  return NextResponse.json(
    { error: { code: rejection.code, message: rejection.message, ...rejection.extra } },
    { status: rejection.status },
  );
}

/**
 * Serialise every quiz-definition write of one tenant: `pg_advisory_xact_lock`, released at
 * COMMIT/ROLLBACK. The two-key form keeps this lock out of any other advisory-lock user's
 * keyspace (`hashtext('quiz_definitions')` namespace, `hashtext(tenant_id::text)` object). MUST
 * be the transaction's FIRST statement, so every read after it sees the previous writer's commit
 * (READ COMMITTED) — that is what makes `max(version) + 1` race-free.
 */
export async function lockTenantQuizDefinitions(tx: QueryRunner, tenantId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('quiz_definitions'), hashtext(${tenantId}::text))`,
  );
}

/** The version heads of one tenant, read under the lock. */
interface QuizDefinitionHeads {
  /** Highest version ever stored (active or not), `0` when the tenant has none. */
  maxVersion: number;
  /** The active row, or `null` when the tenant serves the built-in default. */
  active: { version: number; definition: unknown } | null;
}

/** Read `max(version)` and the active row of a tenant (call after `lockTenantQuizDefinitions`). */
export async function readQuizDefinitionHeads(
  tx: QueryRunner,
  tenantId: string,
): Promise<QuizDefinitionHeads> {
  const maxRows = await tx
    .select({ version: quizDefinitions.version })
    .from(quizDefinitions)
    .where(eq(quizDefinitions.tenantId, tenantId))
    .orderBy(desc(quizDefinitions.version))
    .limit(1);
  const activeRows = await tx
    .select({ version: quizDefinitions.version, definition: quizDefinitions.definition })
    .from(quizDefinitions)
    .where(and(eq(quizDefinitions.tenantId, tenantId), eq(quizDefinitions.isActive, true)))
    .limit(1);
  return { maxVersion: maxRows[0]?.version ?? 0, active: activeRows[0] ?? null };
}

/**
 * Optimistic-concurrency check: `baseVersion` is the active version the editor loaded (`null` =
 * it loaded "no active definition"); `undefined` skips the check (callers that do not send it).
 * Throws a 409 `version_conflict` rejection when the active version has moved since.
 */
export function assertBaseVersion(
  baseVersion: number | null | undefined,
  heads: QuizDefinitionHeads,
): void {
  if (baseVersion === undefined) return;
  const activeVersion = heads.active?.version ?? null;
  if (baseVersion !== activeVersion) {
    throw new QuizWriteRejection(
      409,
      'version_conflict',
      `The active quiz definition is now version ${String(activeVersion)}, not ` +
        `${String(baseVersion)}. Reload, review the change, and retry.`,
      { active_version: activeVersion },
    );
  }
}

/** Hash + counts of a stored definition, as the versions list and the audit rows carry them. */
interface QuizDefinitionSummary {
  /** The serve-schema parse, or `null` when the stored blob no longer passes it. */
  definition: QuizDefinition | null;
  /** `computeQuizDefinitionHash` of the parsed definition; `null` when it does not parse. */
  sha256: string | null;
  question_count: number | null;
  answer_count: number | null;
}

/** Count questions and answers of a parsed definition. */
function countQuizDefinition(def: QuizDefinition): { questions: number; answers: number } {
  return {
    questions: def.questions.length,
    answers: def.questions.reduce((n, q) => n + q.answers.length, 0),
  };
}

/** Parse a stored blob with the SERVE schema and summarise it (never throws on a bad blob). */
export async function summarizeStoredDefinition(raw: unknown): Promise<QuizDefinitionSummary> {
  const parsed = QuizDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    return { definition: null, sha256: null, question_count: null, answer_count: null };
  }
  const counts = countQuizDefinition(parsed.data);
  return {
    definition: parsed.data,
    sha256: await computeQuizDefinitionHash(parsed.data),
    question_count: counts.questions,
    answer_count: counts.answers,
  };
}

/** The `after` block of a `quiz_definition.update|restore` audit row — never the full blob. */
export async function auditAfterBlock(
  version: number,
  def: QuizDefinition,
): Promise<{ version: number; root: string; sha256: string; questions: number; answers: number }> {
  const counts = countQuizDefinition(def);
  return {
    version,
    root: def.root,
    sha256: await computeQuizDefinitionHash(def),
    questions: counts.questions,
    answers: counts.answers,
  };
}

/** The `before` block of every quiz-definition audit row: the active version and its hash. */
export async function auditBeforeBlock(
  heads: QuizDefinitionHeads,
): Promise<{ version: number | null; sha256: string | null }> {
  if (!heads.active) return { version: null, sha256: null };
  const summary = await summarizeStoredDefinition(heads.active.definition);
  return { version: heads.active.version, sha256: summary.sha256 };
}
