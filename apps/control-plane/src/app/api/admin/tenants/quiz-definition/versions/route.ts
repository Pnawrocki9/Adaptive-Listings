/**
 * GET /api/admin/tenants/quiz-definition/versions?tenant_id=<uuid>[&version=<n>] — the version
 * history of a tenant's quiz definition (FOLLOW-1362 C1, ESC-086 item 5). Any staff rank.
 *
 * Without `version`: the newest 50 rows, `{version, is_active, created_at, created_by,
 * question_count, answer_count, sha256, valid}` — no definition blobs. With `version=<n>`: that
 * one row with its full definition (404 when the tenant has no such version).
 *
 * `sha256` is `computeQuizDefinitionHash` over the SERVE-schema parse (the identity public-config
 * stamps and the accuracy analysis freezes); a stored row that no longer parses has
 * `valid: false`, `sha256`/counts `null`, and — on the single fetch — its `raw` JSON.
 *
 * Auth: `resolveTenantAccess` (staff-only, `?tenant_id=` override validated against `tenants`).
 * The service-role client bypasses RLS, so `eq(quizDefinitions.tenantId, access.tenantId)` is the
 * ONLY tenant fence (invariant 5) — a version that exists only for another tenant is a 404.
 *
 * @module apps/control-plane/src/app/api/admin/tenants/quiz-definition/versions/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import * as Sentry from '@sentry/nextjs';
import { and, desc, eq } from 'drizzle-orm';

import { createAdminClient, quizDefinitions } from '@estalara/db';
import type { QuizDefinition, QuizLintResult } from '@estalara/shared';
import { lintQuizDefinition } from '@estalara/shared';
import {
  resolveQuizDefinitionAccess,
  summarizeStoredDefinition,
} from '@/lib/quiz-definition-admin';

/** The history list length (newest first). */
const VERSIONS_LIMIT = 50;

// ─── Types ────────────────────────────────────────────────────────────────────

/** One row of the version history (no blob). */
export interface QuizDefinitionVersionSummary {
  version: number;
  is_active: boolean;
  /** ISO-8601. */
  created_at: string;
  /** Staff user id that saved / restored this version; `null` for seeded rows. */
  created_by: string | null;
  question_count: number | null;
  answer_count: number | null;
  sha256: string | null;
  /** Whether the stored blob passes the serve schema. */
  valid: boolean;
}

/** `GET …/versions` (list). */
export interface QuizDefinitionVersionsResponse {
  tenant_id: string;
  versions: QuizDefinitionVersionSummary[];
}

/** `GET …/versions&version=<n>` (one row with its definition). */
export interface QuizDefinitionVersionDetail extends QuizDefinitionVersionSummary {
  tenant_id: string;
  /** The serve-schema parse; `null` when `valid` is false. */
  definition: QuizDefinition | null;
  /** The stored JSON when `valid` is false; `null` otherwise. */
  raw: unknown;
  /** Lint of the definition; `null` when `valid` is false. */
  lint: QuizLintResult | null;
}

const VersionParamSchema = z.coerce.number().int().positive();

interface StoredRow {
  version: number;
  isActive: boolean;
  createdAt: Date | string;
  createdBy: string | null;
  definition: unknown;
}

async function toSummary(row: StoredRow): Promise<{
  summary: QuizDefinitionVersionSummary;
  definition: QuizDefinition | null;
}> {
  const s = await summarizeStoredDefinition(row.definition);
  return {
    summary: {
      version: row.version,
      is_active: row.isActive,
      created_at: new Date(row.createdAt).toISOString(),
      created_by: row.createdBy,
      question_count: s.question_count,
      answer_count: s.answer_count,
      sha256: s.sha256,
      valid: s.definition !== null,
    },
    definition: s.definition,
  };
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const resolved = await resolveQuizDefinitionAccess(req);
  if ('error' in resolved) return resolved.error;
  const tenantId = resolved.access.tenantId;

  const versionParam = req.nextUrl.searchParams.get('version');
  let version: number | null = null;
  if (versionParam !== null) {
    const parsed = VersionParamSchema.safeParse(versionParam);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'validation_failed', message: 'version must be a positive integer' } },
        { status: 400 },
      );
    }
    version = parsed.data;
  }

  const columns = {
    version: quizDefinitions.version,
    isActive: quizDefinitions.isActive,
    createdAt: quizDefinitions.createdAt,
    createdBy: quizDefinitions.createdBy,
    definition: quizDefinitions.definition,
  };

  try {
    const db = createAdminClient();

    if (version === null) {
      const rows = await db
        .select(columns)
        .from(quizDefinitions)
        // invariant 5: the ONLY tenant fence on this service-role client.
        .where(eq(quizDefinitions.tenantId, tenantId))
        .orderBy(desc(quizDefinitions.version))
        .limit(VERSIONS_LIMIT);
      const summaries = await Promise.all(rows.map(async (r) => (await toSummary(r)).summary));
      const body: QuizDefinitionVersionsResponse = { tenant_id: tenantId, versions: summaries };
      return NextResponse.json(body, { status: 200 });
    }

    const rows = await db
      .select(columns)
      .from(quizDefinitions)
      // invariant 5: tenant fence — another tenant's version is a 404 here.
      .where(and(eq(quizDefinitions.tenantId, tenantId), eq(quizDefinitions.version, version)))
      .orderBy(desc(quizDefinitions.createdAt))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return NextResponse.json(
        { error: { code: 'not_found', message: `No quiz definition version ${String(version)}` } },
        { status: 404 },
      );
    }
    const { summary, definition } = await toSummary(row);
    const body: QuizDefinitionVersionDetail = {
      ...summary,
      tenant_id: tenantId,
      definition,
      raw: definition === null ? row.definition : null,
      lint: definition ? lintQuizDefinition(definition) : null,
    };
    return NextResponse.json(body, { status: 200 });
  } catch (err: unknown) {
    // Rule K.2 — fail loud: the DB is configured but the query threw.
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { route: 'admin/tenants/quiz-definition/versions', op: 'get' },
      extra: { tenant_id: tenantId, version },
    });
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to load quiz definition versions' } },
      { status: 500 },
    );
  }
}
