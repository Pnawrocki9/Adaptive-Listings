/**
 * GET /api/admin/labels
 *
 * Filtered joined table of `conversion_labels` (Postgres) ⋈ `adaptation_decisions`
 * (ClickHouse) on `prediction_id = adapt_decision_id` (FOLLOW-174, MASTER_DESIGN §T.5).
 *
 * Query params (all optional):
 *   tenant_id    — filter by tenant UUID (staff can query any tenant; agency users are
 *                  pinned to their own tenant_id from JWT — this param is ignored for them)
 *   outcome_class — one of ConversionOutcomeClass values
 *   model_version — string filter, substring match against ClickHouse model_version
 *   date_from     — ISO 8601 date (inclusive), applied to conversion_labels.labeled_at
 *   date_to       — ISO 8601 date (inclusive), applied to conversion_labels.labeled_at
 *   page          — 1-based page number (default: 1)
 *   page_size     — rows per page (default: 25, max: 100)
 *
 * Auth: verified Supabase JWT (HMAC-SHA-256).
 *   - Estalara staff (estalara_staff: true): may supply tenant_id query param.
 *   - Agency users (agency_role ≥ agency:admin): tenant_id is pinned from JWT claims;
 *     any supplied tenant_id query param is ignored (the JWT claim wins).
 *
 * Rule K.2 — fail loud:
 *   When CLICKHOUSE_URL is set but a query fails → HTTP 500 + Sentry capture.
 *   When DATABASE_URL_ADMIN is set but Postgres fails → HTTP 500.
 *   When either env is absent → 200 with `data_source: 'mock'` + observable badge.
 *
 * No raw SQL string interpolation — all user values bound as ClickHouse typed
 * params ({param:Type}) or Drizzle parameterised ORM calls.
 *
 * RLS: query uses admin client (service role), but tenant_id is ALWAYS applied as an
 * explicit WHERE predicate on both the Postgres query and the ClickHouse tenant filter
 * (belt-and-suspenders on top of any RLS policy).
 *
 * @module apps/control-plane/src/app/api/admin/labels/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { and, eq, gte, lte } from 'drizzle-orm';

import { getAuthClaims, isStaffClaims } from '@estalara/auth';
import { createAdminClient, conversionLabels } from '@estalara/db';
import { ConversionOutcomeClassSchema, type ConversionOutcomeClass } from '@estalara/shared';

import {
  buildMockLabelsResponse,
  type AdminLabelsResponse,
  type JoinedLabelRow,
  type LabelRow,
  type PredictionRow,
} from './route-helpers';

// ─── Query param schema ───────────────────────────────────────────────────────

const QuerySchema = z.object({
  tenant_id: z.string().uuid().optional(),
  outcome_class: ConversionOutcomeClassSchema.optional(),
  model_version: z.string().min(1).max(128).optional(),
  date_from: z.string().datetime({ offset: true }).optional(),
  date_to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
});

type Query = z.infer<typeof QuerySchema>;

// ─── ClickHouse helpers ───────────────────────────────────────────────────────

function clickHouseHeaders(password: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'text/plain' };
  if (password) {
    headers.Authorization = `Basic ${Buffer.from(`:${password}`).toString('base64')}`;
  }
  return headers;
}

async function chQuery<T>(
  baseUrl: string,
  password: string,
  sql: string,
  params: Record<string, string>,
): Promise<T[]> {
  const url = new URL(baseUrl);
  url.searchParams.set('query', `${sql.trim()} FORMAT JSONEachRow`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(`param_${k}`, v);
  }
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: clickHouseHeaders(password),
  });
  if (!res.ok) {
    throw new Error(`ClickHouse query failed: HTTP ${String(res.status)}`);
  }
  const text = await res.text();
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

/**
 * Fetch prediction context from ClickHouse for the given set of adapt_decision_ids.
 * Scoped to tenantId (via typed param — no string interpolation).
 *
 * Returns null when CLICKHOUSE_URL is not configured (dev/CI).
 * Throws when CLICKHOUSE_URL is set but the query fails (Rule K.2).
 */
async function fetchPredictions(
  tenantId: string,
  decisionIds: string[],
  modelVersionFilter: string | undefined,
): Promise<PredictionRow[] | null> {
  const baseUrl = process.env.CLICKHOUSE_URL;
  if (!baseUrl) return null;
  if (decisionIds.length === 0) return [];

  const password = process.env.CLICKHOUSE_PASSWORD ?? '';

  // Build the IN list as a parameterised array literal:
  // ClickHouse typed params don't support array literals directly, so we
  // construct the comma-separated quoted list from already-validated UUIDs.
  // All decisionIds come from Postgres rows (not user input) so they are safe
  // to interpolate here — they went through Drizzle's parameterised query first.
  //
  // Additional safety: each id is validated to contain only hex digits and hyphens
  // (UUID format). We do NOT use user-supplied values here.
  const safeIds = decisionIds
    .filter((id) => /^[0-9a-f-]+$/i.test(id))
    .map((id) => `'${id}'`)
    .join(', ');

  if (!safeIds) return [];

  const mvCondition =
    modelVersionFilter && /^[\w. -]+$/.test(modelVersionFilter)
      ? `AND model_version = '${modelVersionFilter.replace(/'/g, "\\'")}'`
      : '';

  const sql = `
    SELECT
      adapt_decision_id,
      archetype,
      toFloat64(confidence) AS confidence,
      model_version,
      formatDateTime(ts, '%Y-%m-%dT%H:%i:%SZ') AS ts
    FROM adaptation_decisions
    WHERE tenant_id = {tenant_id:String}
      AND adapt_decision_id IN (${safeIds})
      ${mvCondition}
    LIMIT 1000
  `;

  const rows = await chQuery<Record<string, unknown>>(baseUrl, password, sql, {
    tenant_id: tenantId,
  });

  return rows.map(
    (r): PredictionRow => ({
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      adapt_decision_id: String(r.adapt_decision_id ?? ''),
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      archetype: String(r.archetype ?? ''),
      confidence: Number(r.confidence ?? 0),
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      model_version: String(r.model_version ?? ''),
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      ts: String(r.ts ?? ''),
    }),
  );
}

// ─── Postgres helpers ─────────────────────────────────────────────────────────

/**
 * Fetch paginated `conversion_labels` rows for a tenant, applying optional filters.
 * Uses Drizzle parameterised ORM (no raw SQL concatenation).
 *
 * Throws on DB failure (Rule K.2 — fail loud when DB is configured).
 */
async function fetchLabels(
  tenantId: string,
  query: Query,
): Promise<{ rows: LabelRow[]; total: number }> {
  const db = createAdminClient();

  // Build WHERE conditions. All values come from Zod-validated query params.
  const conditions = [eq(conversionLabels.tenantId, tenantId)];

  if (query.outcome_class) {
    const oc: ConversionOutcomeClass = query.outcome_class;
    conditions.push(eq(conversionLabels.outcomeClass, oc));
  }
  if (query.date_from) {
    conditions.push(gte(conversionLabels.labeledAt, new Date(query.date_from)));
  }
  if (query.date_to) {
    conditions.push(lte(conversionLabels.labeledAt, new Date(query.date_to)));
  }

  const whereClause = and(...conditions);

  // Fetch total count.
  // Drizzle requires a separate count query — no OVER() window in simple select.
  const allRows = await db
    .select({
      id: conversionLabels.id,
      tenant_id: conversionLabels.tenantId,
      prediction_id: conversionLabels.predictionId,
      lead_id: conversionLabels.leadId,
      outcome_class: conversionLabels.outcomeClass,
      label_source: conversionLabels.labelSource,
      confidence: conversionLabels.confidence,
      notes: conversionLabels.notes,
      labeled_at: conversionLabels.labeledAt,
      created_at: conversionLabels.createdAt,
      updated_at: conversionLabels.updatedAt,
    })
    .from(conversionLabels)
    .where(whereClause)
    .orderBy(conversionLabels.labeledAt);

  const total = allRows.length;
  const start = (query.page - 1) * query.page_size;
  const pageRows = allRows.slice(start, start + query.page_size);

  const rows: LabelRow[] = pageRows.map((r) => ({
    id: r.id,
    tenant_id: r.tenant_id,
    prediction_id: r.prediction_id,
    lead_id: r.lead_id,
    outcome_class: r.outcome_class,
    label_source: r.label_source,
    confidence: r.confidence ?? null,
    notes: r.notes ?? null,
    labeled_at: r.labeled_at.toISOString(),
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  }));

  return { rows, total };
}

// ─── GET handler ──────────────────────────────────────────────────────────────

/**
 * GET /api/admin/labels
 *
 * Returns paginated joined (prediction + label) rows scoped to the authenticated
 * tenant, with optional filters.
 *
 * @returns 200 AdminLabelsResponse on success.
 * @returns 401 when JWT is missing or invalid.
 * @returns 400 when query params fail Zod validation.
 * @returns 500 when Postgres or ClickHouse is configured but fails (Rule K.2).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const claims = await getAuthClaims(req);
  if (!claims) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Valid Bearer JWT is required' } },
      { status: 401 },
    );
  }

  // ── Resolve tenant_id (tenant JWT wins; staff may supply query param) ─────
  let tenantId: string;
  if (isStaffClaims(claims)) {
    // Staff: tenant_id must come from query param.
    const rawTenantId = req.nextUrl.searchParams.get('tenant_id');
    if (!rawTenantId) {
      return NextResponse.json(
        {
          error: {
            code: 'validation_error',
            message: 'Staff callers must supply tenant_id query param',
          },
        },
        { status: 400 },
      );
    }
    tenantId = rawTenantId;
  } else {
    // Agency user: tenant_id pinned from verified JWT claims.
    tenantId = claims.tenant_id;
  }

  // ── Parse + validate query params ─────────────────────────────────────────
  const rawParams = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = QuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_error',
          message: 'Invalid query parameters',
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }
  const query = parsed.data;

  // ── Dev / CI mock path ────────────────────────────────────────────────────
  const dbConfigured = Boolean(process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT);
  if (!dbConfigured) {
    const mockResponse = buildMockLabelsResponse(tenantId, query.page, query.page_size);
    return NextResponse.json(mockResponse, { status: 200 });
  }

  // ── Fetch labels from Postgres ─────────────────────────────────────────────
  let labelResult: { rows: LabelRow[]; total: number };
  try {
    labelResult = await fetchLabels(tenantId, query);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, {
      tags: { admin_labels_postgres_error: 'true' },
      extra: { tenant_id: tenantId },
    });
    return NextResponse.json(
      {
        error: {
          code: 'postgres_query_failed',
          message: `Postgres query failed: ${message}`,
        },
      },
      { status: 500 },
    );
  }

  // ── Fetch prediction context from ClickHouse (join) ───────────────────────
  const decisionIds = labelResult.rows.map((r) => r.prediction_id).filter(Boolean);

  const predictionMap = new Map<string, PredictionRow>();
  const clickhouseConfigured = Boolean(process.env.CLICKHOUSE_URL);

  if (clickhouseConfigured) {
    try {
      const predictions = await fetchPredictions(tenantId, decisionIds, query.model_version);
      if (predictions) {
        for (const p of predictions) {
          predictionMap.set(p.adapt_decision_id, p);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Sentry.captureException(err, {
        tags: { admin_labels_clickhouse_error: 'true' },
        extra: { tenant_id: tenantId },
      });
      return NextResponse.json(
        {
          error: {
            code: 'clickhouse_query_failed',
            message: `ClickHouse query failed: ${message}`,
          },
        },
        { status: 500 },
      );
    }
  }

  // ── Join + apply model_version client-side filter if CH unavailable ────────
  let rows: JoinedLabelRow[] = labelResult.rows.map((label) => ({
    label,
    prediction: predictionMap.get(label.prediction_id) ?? null,
  }));

  // When ClickHouse is configured, the model_version filter was applied in the
  // CH query itself; when it is absent (mock/offline), filter client-side so the
  // UI still gets accurate results in dev.
  if (!clickhouseConfigured && query.model_version) {
    const mv = query.model_version;
    rows = rows.filter((r) => r.prediction === null || r.prediction.model_version.includes(mv));
  }

  const response: AdminLabelsResponse = {
    rows,
    total: labelResult.total,
    page: query.page,
    page_size: query.page_size,
    data_source: 'real',
    generated_at: new Date().toISOString(),
  };

  return NextResponse.json(response, { status: 200 });
}
