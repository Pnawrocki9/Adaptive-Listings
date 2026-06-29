/**
 * GET /api/admin/labels/export
 *
 * §D.5.7 Y2 fine-tune corpus input — per-tenant, PII-free export of labeled decisions
 * for LoRA fine-tuning (FOLLOW-175, MASTER_DESIGN §D.5.7 + §T.5).
 *
 * Each output row is the tuple:
 *   (prediction_id, features_snapshot, model_version, confidence, archetype,
 *    outcome_class, label_source, labeled_at)
 *
 * PII intentionally EXCLUDED: lead_id, outcome_raw, notes, id (internal Postgres UUID),
 * tenant_id (implied by the auth scope and must not travel in a corpus file).
 *
 * Query params:
 *   format — 'csv' (default) | 'jsonl'
 *             400 on any other value.
 *
 * Auth: verified Supabase JWT (HMAC-SHA-256).
 *   - Estalara staff (estalara_staff: true): must supply tenant_id query param.
 *   - Agency users: tenant_id pinned from JWT claims; query param is ignored.
 *
 * Rule K.2 — fail loud:
 *   DATABASE_URL_ADMIN unset  → 200 with data_source:'mock', 3 sample rows.
 *   CLICKHOUSE_URL unset      → Postgres-only rows with features_snapshot:null.
 *   Either configured store fails → HTTP 500 + Sentry capture.
 *
 * Audit: every successful export is written as 'corpus_export' to staff_audit_log
 * (fire-and-forget after response; never blocks the download).
 *
 * @module apps/control-plane/src/app/api/admin/labels/export/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { eq } from 'drizzle-orm';

import { getAuthClaims, isStaffClaims } from '@estalara/auth';
import { createAdminClient, conversionLabels, staffAuditLog } from '@estalara/db';
import { clickhouseAuthHeaders } from '@/lib/clickhouse-http';
import { afterResponse } from '@/lib/after-response';

// ─── ExportRow ────────────────────────────────────────────────────────────────

/**
 * One row in the LoRA fine-tune corpus export (§D.5.7).
 *
 * Rule I: this type is consumed by the route handler in this file and is the
 * canonical ExportRow shape for §D.5.7 corpus consumers. PII guarantee:
 * lead_id, outcome_raw, notes, id, tenant_id are never present.
 */
export interface ExportRow {
  /** Join key, non-PII. Cross-store stable UUID. */
  prediction_id: string;
  /** Feature snapshot from ClickHouse `adaptation_decisions.features_snapshot` (JSON). */
  features_snapshot: Record<string, unknown> | null;
  /** Model version string (e.g. "rulebased-bandit-v1"). */
  model_version: string;
  /** Model confidence in [0, 1] at decision time (from ClickHouse). */
  confidence: number;
  /** Archetype selected at decision time (from ClickHouse). */
  archetype: string;
  /** Outcome class from conversion_labels. */
  outcome_class: string;
  /** Label source: 'system' | 'manual_admin'. */
  label_source: string;
  /** ISO 8601 timestamp when the label was recorded. */
  labeled_at: string;
}

// ─── Format param ─────────────────────────────────────────────────────────────

type ExportFormat = 'csv' | 'jsonl';

function parseFormat(raw: string | null): ExportFormat | null {
  if (raw === null || raw === 'csv') return 'csv';
  if (raw === 'jsonl') return 'jsonl';
  return null;
}

// ─── ClickHouse helpers ───────────────────────────────────────────────────────

interface ChDecisionRow {
  adapt_decision_id: string;
  archetype: string;
  confidence: number;
  model_version: string;
  features_snapshot: string | null;
}

async function chQuery<T>(
  baseUrl: string,
  user: string,
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
    headers: {
      'Content-Type': 'text/plain',
      ...clickhouseAuthHeaders({ user, password }),
    },
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
 * Fetch decision context from ClickHouse for the given set of adapt_decision_ids.
 * Returns null when CLICKHOUSE_URL is not configured (dev/CI — Postgres-only path).
 * Throws when configured but the query fails (Rule K.2 — fail loud).
 */
async function fetchDecisionContext(
  tenantId: string,
  decisionIds: string[],
): Promise<Map<string, ChDecisionRow> | null> {
  const baseUrl = process.env.CLICKHOUSE_URL;
  if (!baseUrl) return null;
  if (decisionIds.length === 0) return new Map();

  const user = process.env.CLICKHOUSE_USER ?? 'default';
  const password = process.env.CLICKHOUSE_PASSWORD ?? '';

  // All decisionIds come from Postgres rows (not direct user input) and have
  // already been validated by Drizzle's parameterised query. We additionally
  // strip non-UUID characters before inline interpolation.
  const safeIds = decisionIds
    .filter((id) => /^[0-9a-f-]+$/i.test(id))
    .map((id) => `'${id}'`)
    .join(', ');

  if (!safeIds) return new Map();

  const sql = `
    SELECT
      adapt_decision_id,
      archetype,
      toFloat64(confidence) AS confidence,
      model_version,
      features_snapshot
    FROM adaptation_decisions
    WHERE tenant_id = {tenant_id:String}
      AND adapt_decision_id IN (${safeIds})
    LIMIT 10000
  `;

  const rows = await chQuery<Record<string, unknown>>(baseUrl, user, password, sql, {
    tenant_id: tenantId,
  });

  const map = new Map<string, ChDecisionRow>();
  for (const r of rows) {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const id = String(r.adapt_decision_id ?? '');
    map.set(id, {
      adapt_decision_id: id,
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      archetype: String(r.archetype ?? ''),
      confidence: Number(r.confidence ?? 0),
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      model_version: String(r.model_version ?? ''),
      features_snapshot:
        r.features_snapshot != null
          ? // eslint-disable-next-line @typescript-eslint/no-base-to-string
            String(r.features_snapshot)
          : null,
    });
  }
  return map;
}

// ─── Postgres helper ──────────────────────────────────────────────────────────

interface PgLabelRow {
  prediction_id: string;
  outcome_class: string;
  label_source: string;
  labeled_at: Date;
}

/**
 * Fetch all conversion_labels rows for the tenant (unbounded — corpus export).
 * Uses Drizzle parameterised ORM — no raw SQL concatenation.
 * Throws on DB failure (Rule K.2).
 */
async function fetchAllLabels(tenantId: string): Promise<PgLabelRow[]> {
  const db = createAdminClient();

  const rows = await db
    .select({
      prediction_id: conversionLabels.predictionId,
      outcome_class: conversionLabels.outcomeClass,
      label_source: conversionLabels.labelSource,
      labeled_at: conversionLabels.labeledAt,
    })
    .from(conversionLabels)
    .where(eq(conversionLabels.tenantId, tenantId))
    .orderBy(conversionLabels.labeledAt);

  return rows;
}

// ─── Output formatters ────────────────────────────────────────────────────────

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function rowsToCsv(rows: ExportRow[], dataSource: 'mock' | 'real'): string {
  const header =
    'data_source,prediction_id,features_snapshot,model_version,confidence,archetype,outcome_class,label_source,labeled_at';
  const lines = rows.map((r) => {
    const fs = r.features_snapshot !== null ? JSON.stringify(r.features_snapshot) : '';
    return [
      csvEscape(dataSource),
      csvEscape(r.prediction_id),
      csvEscape(fs),
      csvEscape(r.model_version),
      String(r.confidence),
      csvEscape(r.archetype),
      csvEscape(r.outcome_class),
      csvEscape(r.label_source),
      csvEscape(r.labeled_at),
    ].join(',');
  });
  return [header, ...lines].join('\n');
}

function rowsToJsonl(rows: ExportRow[], dataSource: 'mock' | 'real'): string {
  return rows.map((r) => JSON.stringify({ data_source: dataSource, ...r })).join('\n');
}

// ─── Audit helper ─────────────────────────────────────────────────────────────

/**
 * Fire-and-forget audit write to staff_audit_log.
 * Errors are captured to Sentry but never propagate to the caller.
 */
function auditCorpusExport(args: {
  actorUserId: string;
  tenantId: string;
  rowCount: number;
  format: ExportFormat;
}): void {
  if (!process.env.DATABASE_URL_ADMIN && !process.env.DATABASE_URL_DIRECT) {
    return; // Dev/CI: no DB to write to.
  }
  // FOLLOW-432 / Rule K.2: wrapped in afterResponse() so the audit DB write completes
  // after the response is sent rather than being dropped on Vercel instance suspension.
  afterResponse(async () => {
    try {
      const db = createAdminClient();
      await db.insert(staffAuditLog).values({
        adminUserId: args.actorUserId,
        action: 'corpus_export',
        targetTenantId: args.tenantId,
        payload: {
          row_count: args.rowCount,
          format: args.format,
        },
      });
    } catch (err: unknown) {
      Sentry.captureException(err, {
        tags: { corpus_export_audit_error: 'true' },
        extra: { tenant_id: args.tenantId },
      });
    }
  });
}

// ─── Mock data (dev / CI — DATABASE_URL_ADMIN unset) ─────────────────────────

/**
 * Returns 3 deterministic sample rows for dev/CI when DATABASE_URL_ADMIN is unset.
 * data_source header is set to 'mock' — consumers MUST surface a visible badge.
 */
function buildMockExportRows(): ExportRow[] {
  return [
    {
      prediction_id: 'mock-pred-001',
      features_snapshot: { archetype_score: 0.82, session_depth: 3 },
      model_version: 'rulebased-bandit-v1',
      confidence: 0.82,
      archetype: 'yield_hunter',
      outcome_class: 'viewing_booked',
      label_source: 'system',
      labeled_at: '2026-06-01T10:00:00.000Z',
    },
    {
      prediction_id: 'mock-pred-002',
      features_snapshot: { archetype_score: 0.61, session_depth: 5 },
      model_version: 'rulebased-bandit-v1',
      confidence: 0.61,
      archetype: 'family_upsizer',
      outcome_class: 'offer_made',
      label_source: 'manual_admin',
      labeled_at: '2026-06-02T14:30:00.000Z',
    },
    {
      prediction_id: 'mock-pred-003',
      features_snapshot: null,
      model_version: 'rulebased-bandit-v1',
      confidence: 0.45,
      archetype: 'downsizer',
      outcome_class: 'no_response',
      label_source: 'system',
      labeled_at: '2026-06-03T08:15:00.000Z',
    },
  ];
}

// ─── GET handler ──────────────────────────────────────────────────────────────

/**
 * GET /api/admin/labels/export
 *
 * LoRA fine-tune corpus export (§D.5.7). Produces a PII-free flat file of
 * (features_snapshot, model_version, confidence, archetype) → outcome_class
 * tuples for every labeled decision scoped to the authenticated tenant.
 *
 * @returns 200 text/csv or text/plain (jsonl) on success.
 * @returns 400 on unknown `format` query param value.
 * @returns 401 when JWT is missing or invalid.
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

  // ── Resolve tenant_id ─────────────────────────────────────────────────────
  let tenantId: string;
  if (isStaffClaims(claims)) {
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
    tenantId = claims.tenant_id;
  }

  // ── Parse format param ────────────────────────────────────────────────────
  const formatParam = req.nextUrl.searchParams.get('format');
  const format = parseFormat(formatParam);
  if (format === null) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_error',
          message: `Unknown format '${String(formatParam)}'. Accepted values: csv, jsonl`,
        },
      },
      { status: 400 },
    );
  }

  // ── Dev / CI mock path (DATABASE_URL_ADMIN unset) ─────────────────────────
  const dbConfigured = Boolean(process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT);
  if (!dbConfigured) {
    const mockRows = buildMockExportRows();
    const body = format === 'jsonl' ? rowsToJsonl(mockRows, 'mock') : rowsToCsv(mockRows, 'mock');
    const contentType =
      format === 'jsonl' ? 'text/plain; charset=utf-8' : 'text/csv; charset=utf-8';
    const ext = format === 'jsonl' ? 'jsonl' : 'csv';
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="corpus-mock.${ext}"`,
        'X-Data-Source': 'mock',
        'X-Row-Count': String(mockRows.length),
      },
    });
  }

  // ── Fetch labels from Postgres ─────────────────────────────────────────────
  let labelRows: PgLabelRow[];
  try {
    labelRows = await fetchAllLabels(tenantId);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, {
      tags: { corpus_export_postgres_error: 'true' },
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

  // ── Fetch decision context from ClickHouse ────────────────────────────────
  const decisionIds = labelRows.map((r) => r.prediction_id).filter(Boolean);
  let chMap: Map<string, ChDecisionRow> | null = null;

  if (process.env.CLICKHOUSE_URL) {
    try {
      chMap = await fetchDecisionContext(tenantId, decisionIds);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Sentry.captureException(err, {
        tags: { corpus_export_clickhouse_error: 'true' },
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

  // ── Build ExportRow tuples ─────────────────────────────────────────────────
  const exportRows: ExportRow[] = labelRows.map((label): ExportRow => {
    const ch = chMap?.get(label.prediction_id) ?? null;

    let featuresSnapshot: Record<string, unknown> | null = null;
    if (ch?.features_snapshot) {
      try {
        featuresSnapshot = JSON.parse(ch.features_snapshot) as Record<string, unknown>;
      } catch {
        featuresSnapshot = null;
      }
    }

    return {
      prediction_id: label.prediction_id,
      features_snapshot: featuresSnapshot,
      model_version: ch?.model_version ?? '',
      confidence: ch?.confidence ?? 0,
      archetype: ch?.archetype ?? '',
      outcome_class: label.outcome_class,
      label_source: label.label_source,
      labeled_at: label.labeled_at.toISOString(),
    };
  });

  // ── Format output ─────────────────────────────────────────────────────────
  const body = format === 'jsonl' ? rowsToJsonl(exportRows, 'real') : rowsToCsv(exportRows, 'real');
  const contentType = format === 'jsonl' ? 'text/plain; charset=utf-8' : 'text/csv; charset=utf-8';
  const ext = format === 'jsonl' ? 'jsonl' : 'csv';

  // ── Audit (fire-and-forget) ───────────────────────────────────────────────
  auditCorpusExport({
    actorUserId: claims.sub,
    tenantId,
    rowCount: exportRows.length,
    format,
  });

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="corpus-${tenantId}.${ext}"`,
      'X-Data-Source': 'real',
      'X-Row-Count': String(exportRows.length),
    },
  });
}
