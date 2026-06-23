/**
 * GET /api/pilot/calibration
 *
 * Score-vs-actual calibration reliability curve + conversion-label aggregates
 * for the authenticated tenant (FOLLOW-173, MASTER_DESIGN §T.3).
 *
 * This endpoint feeds the FOLLOW-174 pilot dashboard calibration panel so staff
 * can compare whether `lora-tenant-*` models are better calibrated than
 * `rulebased-bandit-v1`.
 *
 * Query params:
 *   window_days: 7 | 14 | 30  (default: 7 — same allowed set as cta-lift)
 *   format: 'json' (optional — see JSON export path below)
 *     Any non-empty format value OTHER than 'json' returns HTTP 400 (FOLLOW-237 AC3).
 *
 * Response shape (default / chart path): CalibrationResponse (see route-helpers.ts).
 *   calibration[]         — reliability curve per (model_version, confidence_decile)
 *   conversion_aggregates[] — conversion rate per (outcome_class, model_version)
 *   data_source           — 'clickhouse' | 'mock' (Rule K.2 provenance field)
 *
 * JSON export path (FOLLOW-221, FOLLOW-237):
 *   `?format=json` returns a JSON envelope with:
 *     data_source  — 'clickhouse' | 'mock' provenance (Rule K.2 — FOLLOW-237 AC1)
 *     rows         — CalibrationExportRow[] (one per outcome_class × model_version)
 *   with Content-Disposition: attachment and Content-Type: application/json.
 *   Shape is Zod-validated (CalibrationExportRowSchema).
 *   Documented in HANDOFFS.md "FOLLOW-221 -> FOLLOW-175".
 *
 *   NOTE: this is a calibration SUMMARY (aggregate counts per outcome_class ×
 *   model_version × tenant × window). FOLLOW-175 needs a SEPARATE row-level
 *   (features_snapshot, model_version, score) → outcome_class export and CANNOT
 *   use this shape (FOLLOW-237 AC5 correction).
 *
 * Auth: Bearer JWT required; tenant_id from JWT claim (never from query string).
 *
 * Data access:
 *   ClickHouse  — adaptation_decisions: adapt_decision_id, confidence, model_version
 *   Postgres    — conversion_labels: prediction_id, outcome_class
 *   Join in TypeScript on adapt_decision_id = prediction_id (see route-helpers).
 *
 * Sync approach: query-time join (MVP — fine for pilot scale <10k decisions/tenant).
 * FOLLOW-175 will migrate to ClickHouse-materialized path for scale.
 *
 * Rule K.2 — fail loud:
 *   When CLICKHOUSE_URL is set but a query fails -> HTTP 500 + Sentry; no mock fallback.
 *   When CLICKHOUSE_URL is unset (dev / CI) -> HTTP 200 mock with data_source: 'mock'.
 *
 * No string interpolation in SQL — all user-supplied values bound as typed ClickHouse
 * parameters (`{tenant_id:String}`, `{window_days:UInt16}`) per FOLLOW-206 pattern.
 * Postgres query uses Drizzle parameterised ORM — no raw string concatenation.
 *
 * @module apps/control-plane/src/app/api/pilot/calibration/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { getAuthClaims } from '@estalara/auth';
import { eq, and, inArray } from 'drizzle-orm';
import { createAdminClient, conversionLabels } from '@estalara/db';
import { clickhouseAuthHeaders } from '@/lib/clickhouse-http';
import {
  buildCalibrationFromRaw,
  buildCalibrationExportRows,
  buildMockCalibrationResponse,
  type ChDecisionRow,
  type PgLabelRow,
  type CalibrationResponse,
  type CalibrationExportRow,
} from './route-helpers';

// ─── Query param parsing ──────────────────────────────────────────────────────

const ALLOWED_WINDOWS = [7, 14, 30] as const;
type WindowDays = (typeof ALLOWED_WINDOWS)[number];

/** Valid values for the ?format= query parameter. */
const ALLOWED_FORMATS = ['json'] as const;
type AllowedFormat = (typeof ALLOWED_FORMATS)[number];

/** Parse window_days; defaults to 7 when missing or out of the allowed set. */
function parseWindowDays(raw: string | null): WindowDays {
  const n = Number(raw);
  return (ALLOWED_WINDOWS as readonly number[]).includes(n) ? (n as WindowDays) : 7;
}

/**
 * Parse the ?format= query parameter.
 *
 * Returns `{ ok: true, value: AllowedFormat | null }` when the value is valid (null = chart path).
 * Returns `{ ok: false, response: Response }` with HTTP 400 for any unknown non-empty value
 * (FOLLOW-237 AC3 — fail loud, never silently fall through to the chart path).
 */
function parseFormat(
  raw: string | null,
): { ok: true; value: AllowedFormat | null } | { ok: false; response: Response } {
  if (raw === null || raw === '') return { ok: true, value: null };
  if ((ALLOWED_FORMATS as readonly string[]).includes(raw))
    return { ok: true, value: raw as AllowedFormat };
  // Unknown format value — reject with 400 (Rule K.2 fail loud).
  return {
    ok: false,
    response: new Response(
      JSON.stringify({
        error: {
          code: 'invalid_format',
          message: `Unknown format '${raw}'. Valid values: ${ALLOWED_FORMATS.join(', ')}.`,
        },
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    ),
  };
}

// ─── ClickHouse access ────────────────────────────────────────────────────────

function clickHouseHeaders(user: string, password: string): Record<string, string> {
  return {
    'Content-Type': 'text/plain',
    ...clickhouseAuthHeaders({ user, password }),
  };
}

/**
 * Execute one parameterized ClickHouse query over the HTTP interface and parse
 * JSONEachRow output. All user-supplied values are bound as typed parameters
 * (never string-interpolated) per FOLLOW-206 injection-safe pattern.
 */
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
    headers: clickHouseHeaders(user, password),
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
 * Fetch `adapt_decision_id`, `confidence`, and `model_version` from ClickHouse
 * for the tenant + window. Returns null when CLICKHOUSE_URL is not set (dev / CI).
 *
 * Throws when CLICKHOUSE_URL is set but the query fails (Rule K.2 — fail loud).
 *
 * No string interpolation: tenant_id and window_days are bound as typed params.
 */
async function fetchDecisionsFromClickHouse(
  tenantId: string,
  windowDays: number,
): Promise<ChDecisionRow[] | null> {
  const baseUrl = process.env.CLICKHOUSE_URL;
  if (!baseUrl) return null;
  const user = process.env.CLICKHOUSE_USER ?? 'default';
  const password = process.env.CLICKHOUSE_PASSWORD ?? '';

  // Sync approach: query-time join (MVP — fine for pilot scale <10k decisions/tenant).
  // FOLLOW-175 will migrate to ClickHouse-materialized path for scale.
  //
  // FOLLOW-371 / ESC-026: exclude contaminated holdout rows written during the
  // ~12.5h window (PR #327 2026-06-19 21:17 UTC → PR #333 2026-06-20 09:53 UTC)
  // when the GET path logged (holdout_group=1, variant IN ('v1','v2')).
  // Calibration only needs non-holdout (treatment) decisions anyway; including
  // them would inflate the denominator with control-arm rows. This predicate
  // ensures the calibration corpus stays clean regardless.
  const decisionSql = `
    SELECT
      adapt_decision_id,
      toFloat64(confidence)   AS confidence,
      model_version
    FROM adaptation_decisions
    WHERE tenant_id = {tenant_id:String}
      AND ts >= now() - toIntervalDay({window_days:UInt16})
      AND adapt_decision_id != ''
      AND NOT (holdout_group = 1 AND variant != 'control')
  `;

  const rows = await chQuery<Record<string, unknown>>(baseUrl, user, password, decisionSql, {
    tenant_id: tenantId,
    window_days: String(windowDays),
  });

  return rows.map(
    (r): ChDecisionRow => ({
      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- primitive JSON value coerced safely
      adapt_decision_id: String(r.adapt_decision_id ?? ''),
      confidence: Number(r.confidence ?? 0),
      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- primitive JSON value coerced safely
      model_version: String(r.model_version ?? ''),
    }),
  );
}

/**
 * Fetch conversion_labels rows from Postgres for the set of adapt_decision_ids
 * returned by ClickHouse. Uses Drizzle parameterised queries (no raw SQL string
 * concatenation). Returns [] when decisionIds is empty.
 *
 * Scoped to the tenant — belt-and-suspenders on top of RLS.
 *
 * Throws on DB failure (Rule K.2 — fail loud when DB is configured).
 */
async function fetchLabelsFromPostgres(
  tenantId: string,
  decisionIds: string[],
): Promise<PgLabelRow[]> {
  if (decisionIds.length === 0) return [];

  // Use admin client: calibration is a staff/pilot read path, not tenant-facing.
  // createAdminClient throws when DATABASE_URL_ADMIN + DATABASE_URL_DIRECT are both unset.
  const db = createAdminClient();

  const rows = await db
    .select({
      prediction_id: conversionLabels.predictionId,
      outcome_class: conversionLabels.outcomeClass,
    })
    .from(conversionLabels)
    .where(
      and(
        eq(conversionLabels.tenantId, tenantId),
        inArray(conversionLabels.predictionId, decisionIds),
      ),
    );

  return rows.map(
    (r): PgLabelRow => ({
      prediction_id: r.prediction_id,
      outcome_class: r.outcome_class,
    }),
  );
}

// ─── JSON export helper (FOLLOW-221, FOLLOW-237) ─────────────────────────────

/**
 * Build the `?format=json` response: a JSON envelope with a top-level
 * `data_source` provenance field (Rule K.2 — FOLLOW-237 AC1) and a `rows`
 * array of CalibrationExportRow objects.
 *
 * The envelope is returned with Content-Disposition attachment so browsers
 * download it directly.  The rows are Zod-validated inside
 * buildCalibrationExportRows — a parse error propagates as HTTP 500
 * (Rule K.2: fail loud, never fabricate).
 *
 * NOTE: this export is a calibration SUMMARY (aggregate counts per
 * outcome_class × model_version).  A consumer that needs row-level
 * (features_snapshot, score) → outcome_class corpus data for LoRA fine-tuning
 * CANNOT use this shape — see FOLLOW-175 for the separate row-level export.
 */
function jsonExportResponse(
  rows: CalibrationExportRow[],
  dataSource: 'clickhouse' | 'mock',
): Response {
  const envelope = { data_source: dataSource, rows };
  return new Response(JSON.stringify(envelope), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="calibration.json"',
    },
  });
}

// ─── Route handler ─────────────────────────────────────────────────────────────

/**
 * GET /api/pilot/calibration
 *
 * @returns 200 CalibrationResponse on success (with data_source provenance field).
 * @returns 400 when an unknown ?format= value is supplied (FOLLOW-237 AC3).
 * @returns 401 when no valid tenant JWT is present.
 * @returns 500 when CLICKHOUSE_URL is set but ClickHouse query fails,
 *   OR when Postgres label fetch fails (Rule K.2 — fail loud; never fall back to
 *   mock when a real data store is configured).
 */
export async function GET(req: NextRequest): Promise<NextResponse | Response> {
  const claims = await getAuthClaims(req);
  if (!claims || !('tenant_id' in claims) || !claims.tenant_id) {
    return NextResponse.json(
      {
        error: { code: 'unauthorized', message: 'Valid Bearer JWT with tenant_id claim required' },
      },
      { status: 401 },
    );
  }

  const tenantId: string = claims.tenant_id;
  const windowDays = parseWindowDays(req.nextUrl.searchParams.get('window_days'));

  // AC3 (FOLLOW-237): unknown ?format= values return HTTP 400 instead of silently falling
  // through to the chart path.  parseFormat() returns { ok: false } on unknown non-empty values.
  const formatResult = parseFormat(req.nextUrl.searchParams.get('format'));
  if (!formatResult.ok) {
    return formatResult.response;
  }
  const formatJson = formatResult.value === 'json';

  // Rule K.2 — fail loud.
  // When CLICKHOUSE_URL is unset (dev / CI), return deterministic mock with provenance field.
  // When CLICKHOUSE_URL is set, any query failure -> HTTP 500 + Sentry; no mock fallback.
  const clickhouseConfigured = Boolean(process.env.CLICKHOUSE_URL);

  if (!clickhouseConfigured) {
    const response = buildMockCalibrationResponse(tenantId, windowDays);
    if (formatJson) {
      // AC1/AC2 (FOLLOW-237): pass dataSource='mock' so every export row + envelope is flagged.
      const exportRows = buildCalibrationExportRows(
        tenantId,
        windowDays,
        response.calibration,
        response.conversion_aggregates,
        'mock',
      );
      return jsonExportResponse(exportRows, 'mock');
    }
    return NextResponse.json(response, { status: 200 });
  }

  // ─── Fetch from ClickHouse ───────────────────────────────────────────────────
  let decisions: ChDecisionRow[];
  try {
    const raw = await fetchDecisionsFromClickHouse(tenantId, windowDays);
    // raw is null only when CLICKHOUSE_URL is unset — already handled above.
    decisions = raw ?? [];
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, {
      tags: { calibration_clickhouse_error: 'true' },
      extra: { tenant_id: tenantId, window_days: windowDays },
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

  // ─── Fetch labels from Postgres ─────────────────────────────────────────────
  // Only request labels for decision IDs returned by ClickHouse. This keeps the
  // IN-clause bounded and avoids a full-table scan on conversion_labels.
  const decisionIds = decisions.map((d) => d.adapt_decision_id).filter(Boolean);

  let labels: PgLabelRow[];
  try {
    labels = await fetchLabelsFromPostgres(tenantId, decisionIds);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, {
      tags: { calibration_postgres_error: 'true' },
      extra: { tenant_id: tenantId, window_days: windowDays },
    });
    return NextResponse.json(
      {
        error: {
          code: 'postgres_query_failed',
          message: `Postgres label fetch failed: ${message}`,
        },
      },
      { status: 500 },
    );
  }

  // ─── Build response ─────────────────────────────────────────────────────────
  const { calibration, conversion_aggregates } = buildCalibrationFromRaw(decisions, labels);

  // JSON export path (FOLLOW-221, FOLLOW-237) — return envelope with data_source + rows.
  if (formatJson) {
    // AC1/AC2 (FOLLOW-237): pass dataSource='clickhouse' so provenance is explicit.
    const exportRows = buildCalibrationExportRows(
      tenantId,
      windowDays,
      calibration,
      conversion_aggregates,
      'clickhouse',
    );
    return jsonExportResponse(exportRows, 'clickhouse');
  }

  const response: CalibrationResponse = {
    window_days: windowDays,
    tenant_id: tenantId,
    calibration,
    conversion_aggregates,
    generated_at: new Date().toISOString(),
    data_source: 'clickhouse',
  };

  return NextResponse.json(response, { status: 200 });
}
