/**
 * Analytics rollup for the Estalara tenant — data access layer.
 *
 * FOLLOW-638 built this as an unfenced cross-brand rollup (one row per tenant, staff-only). ESC-085
 * (2026-10-17) made Adaptive Listings single-tenant, so FOLLOW-1330 collapsed it to ONE tenant: the
 * caller names the tenant (`route.ts` defaults to `ESTALARA_TENANT_ID` and refuses any other), and
 * every query below is fenced on it. There is no per-brand breakdown and no tenant roster any more.
 * The FOLLOW-819 harness reads this response for AC(5) — the keys it reads are pinned by
 * `route.contract.test.ts`.
 *
 * The conversion counts are built from the SAME three builders the lift route uses
 * (`conversionEventsSubquery`, `conversionCountColumns`, `readConversionCounts` in
 * `dashboard/analytics/lift/route-helpers.ts`), with the same tenant fence. Since FOLLOW-1203 a
 * conversion is a server-confirmed `inquiry.completed` / `live.signup` after the session's first
 * decision; `cta.clicked` is a reported funnel stage and never the numerator.
 * `rollup-lift-parity.test.ts` holds the two readers to the same numbers.
 *
 * ─── Rule K.2 (fail loud) ─────────────────────────────────────────────────────
 * ClickHouse carries the primary metric group; Postgres carries `quiz_completions`. Both stores are
 * provisioned together in every environment that has either, so they are ONE configuration gate for
 * the top-level `data_source` ('clickhouse' | 'mock'): when either `CLICKHOUSE_URL` or
 * `DATABASE_URL_ADMIN`/`DATABASE_URL_DIRECT` is unset (dev/CI), the whole response is deterministic
 * mock data, clearly tagged. When both are configured, a failing primary ClickHouse query is a hard
 * failure (`ok: false`, mapped to HTTP 500 by the route handler) — never fabricated.
 *
 * The secondary metrics (`quizCompletions`, `scoringPathSplit`, `reorderWithheld`) each degrade
 * independently: a configured-but-failed query returns 200 with that field null and its own
 * `*_source: 'error'` (never a fabricated 0).
 *
 * @module apps/control-plane/src/app/api/admin/analytics/rollup/data
 */

import { eq, sql } from 'drizzle-orm';
import * as Sentry from '@sentry/nextjs';

import { createAdminClient, quizCompletions } from '@estalara/db';
import { clickhouseAuthHeaders } from '@/lib/clickhouse-http';
import { computeArmLift } from '@/lib/pilot-stats';
import {
  CLEAN_HOLDOUT_PREDICATE,
  callerSignedColumnEnabled,
  conversionCountColumns,
  conversionEventsSubquery,
  readConversionCounts,
  type ConversionCounts,
  type ConversionSource,
} from '@/app/api/dashboard/analytics/lift/route-helpers';
// `type` keyword is load-bearing (FOLLOW-1073): tsconfig.base.json sets
// `verbatimModuleSyntax: true`, so TS emits import statements exactly as
// written and will NOT auto-elide a value-style import even if the only
// binding used is a type. Dropping `type` here would make this module
// actually `require()` the adapt route at runtime, pulling its full
// dependency graph (ClickHouse client, LLM gateway, etc.) into the analytics
// rollup's bundle.
import type { ReorderWithheldReason, ScoringPath } from '@/app/api/adapt/route';

// ─── Response types (canonical — import these, never redeclare) ───────────────

/**
 * FOLLOW-1203: the lift's inputs and the conversions it deliberately leaves out, next to the lift.
 * Every count is DISTINCT SESSIONS. The four class-dependent fields are null (never 0) when
 * `conversion_source` is 'disabled'.
 */
interface RollupConversionCounts {
  /** Denominators: sessions per arm. */
  adaptedN: number;
  holdoutN: number;
  /** NUMERATORS: sessions with a signed conversion at/after their first decision. */
  adaptedConversions: number | null;
  holdoutConversions: number | null;
  /** Both arms: sessions whose signed conversions all preceded their first decision. Not counted. */
  preExposureConversions: number | null;
  /** Both arms: sessions with an unsigned (browser-emitted) conversion. Reported, not counted. */
  unsignedConversions: number | null;
  /** Both arms: sessions with a `cta.clicked`. A funnel stage, never the numerator. */
  ctaClickedSessions: number;
}

export interface RollupTotals {
  sessions: number;
  adapted: number;
  holdout: number;
  /**
   * (adaptedRate - holdoutRate) / holdoutRate * 100, over SERVER-CONFIRMED conversions
   * (FOLLOW-1203; the field name predates the ruling and is kept — the FOLLOW-819 harness reads
   * it). null when holdoutN is 0, when no holdout session converted, or when `conversion_source` is
   * 'disabled'.
   */
  ctaLift: number | null;
  conversions: RollupConversionCounts;
  /** null only when quiz_data_source is 'error'. */
  quizCompletions: number | null;
}

export interface TenantAnalyticsRollup {
  /** The tenant every count below is fenced to (FOLLOW-1330: the Estalara tenant on the route). */
  tenant_id: string;
  window_days: number;
  generated_at: string;
  rollup: RollupTotals;
  /**
   * Provenance for the primary metric group (sessions/adapted/holdout/ctaLift).
   * 'clickhouse' — live data from ClickHouse.
   * 'mock'       — CLICKHOUSE_URL or the admin Postgres connection is unset
   *                (dev/CI); deterministic stub data.
   */
  data_source: 'clickhouse' | 'mock';
  /**
   * FOLLOW-1203 — provenance for `ctaLift` and every class-dependent `conversions` field.
   * 'signed_events' — read from `events.caller_signed` (migration 0024).
   * 'disabled'      — CALLER_SIGNED_COLUMN_ENABLED is not 'true' here, so the column is not
   *                   queried: `ctaLift` is null and the class-dependent counts are null. The
   *                   expected state in production until an operator applies 0024 and flips the
   *                   flag; it is a configuration fact, not an error.
   * 'mock'          — the unconfigured dev/CI state.
   */
  conversion_source: ConversionSource;
  /**
   * Provenance for the secondary `quizCompletions` fields specifically.
   * 'live'  — real `quiz_completions` COUNT(*) query succeeded.
   * 'mock'  — same unconfigured dev/CI state as `data_source: 'mock'`.
   * 'error' — Postgres is configured but the quiz_completions query threw;
   *           every quizCompletions field above is null, never a fabricated 0.
   */
  quiz_data_source: 'live' | 'mock' | 'error';
  /**
   * FOLLOW-560: how many decisions in the window were ranked by real cosine
   * similarity vs. the djb2 stable-hash fallback. `null` whenever
   * `scoring_path_source` is 'disabled' or 'error' — never a fabricated zero
   * split, which would read as "all four paths saw no traffic" rather than
   * "this instance cannot answer the question".
   */
  scoringPathSplit: Record<ScoringPath, number> | null;
  /**
   * Provenance for `scoringPathSplit` specifically.
   * 'live'     — real GROUP BY scoring_path query succeeded.
   * 'mock'     — same unconfigured dev/CI state as `data_source: 'mock'`.
   * 'disabled' — SCORING_PATH_COLUMN_ENABLED is not 'true' on this deployment,
   *              so `adaptation_decisions.scoring_path` may not exist here and
   *              is deliberately NOT queried. This is the expected state in
   *              production until migration 0022 is applied (FOLLOW-820) — it
   *              is a configuration fact, not an error.
   * 'error'    — the flag is on but the query threw; the split is null.
   */
  scoring_path_source: 'live' | 'mock' | 'disabled' | 'error';
  /**
   * FOLLOW-1220: decisions in the window whose reorder was withheld, by reason, read from
   * `features_snapshot.reorder_withheld` — an existing JSON key, so this needs no migration and,
   * unlike `scoringPathSplit`, is NOT gated on `SCORING_PATH_COLUMN_ENABLED`. Era boundary: the key
   * exists only on rows written by a plane running `e78146fe` (FOLLOW-1202) or later (production:
   * after 2026-09-14 19:06:22 UTC), and `embeddings_lookup_failed` only from FOLLOW-1220; an older
   * row reads as "not withheld", never as a count. `null` whenever `reorder_withheld_source` is
   * 'error' — never a fabricated zero.
   */
  reorderWithheld: Record<ReorderWithheldReason, number> | null;
  /**
   * Provenance for `reorderWithheld` specifically.
   * 'live'  — the GROUP BY query succeeded (a reason with no rows reads 0).
   * 'mock'  — the unconfigured dev/CI state.
   * 'error' — the query threw; `reorderWithheld` is null.
   */
  reorder_withheld_source: 'live' | 'mock' | 'error';
}

export type RollupResult =
  | { ok: true; data: TenantAnalyticsRollup }
  | { ok: false; status: 500; error: string };

const WINDOW_DAYS = 7;

// ─── Config gates ───────────────────────────────────────────────────────────

function clickhouseConfigured(): boolean {
  return Boolean(process.env.CLICKHOUSE_URL);
}

function postgresConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT);
}

// ─── ClickHouse HTTP (tenant bound as a query parameter, never interpolated) ──

/**
 * GET one ClickHouse query with `{tenant_id:String}` bound via `param_tenant_id`.
 * THROWS on a non-2xx answer; `what` names the leg in the error.
 */
async function chSelect(query: string, tenantId: string, what: string): Promise<string> {
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  if (!clickhouseUrl) {
    throw new Error(`${what} query called without CLICKHOUSE_URL configured`);
  }
  const url = new URL(clickhouseUrl);
  url.searchParams.set('query', query);
  url.searchParams.set('param_tenant_id', tenantId);

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'text/plain',
      ...clickhouseAuthHeaders({
        user: process.env.CLICKHOUSE_USER ?? 'default',
        password: process.env.CLICKHOUSE_PASSWORD ?? '',
      }),
    },
  });
  if (!res.ok) {
    throw new Error(
      `ClickHouse ${what} query failed: HTTP ${String(res.status)} ${res.statusText}`,
    );
  }
  return res.text();
}

/** JSONEachRow text → rows. */
function jsonRows(text: string): Record<string, unknown>[] {
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

// ─── ClickHouse: sessions/adapted/holdout/conversion counts for one tenant ──

interface ChRollupRow {
  sessions: number;
  adapted: number;
  holdout: number;
  adapted_n: number;
  holdout_n: number;
  /** All sessions (both arms) — the reported, uncounted classes. */
  all: ConversionCounts;
  adaptedArm: ConversionCounts;
  holdoutArm: ConversionCounts;
}

/**
 * Fenced on `ad.tenant_id` and on the events subquery's `tenant_id`, exactly as the lift route
 * (`fetchLiftRaw`) fences its per-arm totals. An aggregate without GROUP BY: ClickHouse answers one
 * row, all zeros when the tenant has no decisions in the window.
 *
 * THROWS on a configured-but-failed query (Rule K.2 — caller maps to 500).
 */
async function fetchChRollup(tenantId: string, callerClass: boolean): Promise<ChRollupRow> {
  // The same join as dashboard/analytics/lift/route-helpers.ts, built from the same three
  // FOLLOW-1203 builders (one definition of a conversion); the per-arm conditions sit inside the
  // columns. FOLLOW-1303: the same FOLLOW-371 contamination predicate as the lift route (one shared
  // constant), so a holdout row with a non-control variant never enters any count — sessions,
  // holdout, or the conversion counts `ctaLift` is computed from.
  const query = `
    SELECT
      countDistinct(ad.session_id)                                          AS sessions,
      countDistinctIf(ad.session_id, ad.holdout_group = 0)                  AS adapted,
      countDistinctIf(ad.session_id, ad.holdout_group = 1)                  AS holdout,
      countDistinctIf(ad.session_id, ad.holdout_group = 0)                  AS adapted_n,
      countDistinctIf(ad.session_id, ad.holdout_group = 1)                  AS holdout_n,
      ${conversionCountColumns({ callerClass, prefix: 'all_', arm: null })},
      ${conversionCountColumns({ callerClass, prefix: 'adapted_', arm: 'ad.holdout_group = 0' })},
      ${conversionCountColumns({ callerClass, prefix: 'holdout_', arm: 'ad.holdout_group = 1' })}
    FROM adaptation_decisions AS ad
    LEFT JOIN (${conversionEventsSubquery({
      callerClass,
      tenantFence: 'tenant_id = {tenant_id:String}',
      windowDays: String(WINDOW_DAYS),
    })}
    ) AS ev
      ON ad.tenant_id = ev.tenant_id AND ad.session_id = ev.session_id
    WHERE ad.tenant_id = {tenant_id:String}
      AND ad.ts >= now() - toIntervalDay(${String(WINDOW_DAYS)})
      AND ${CLEAN_HOLDOUT_PREDICATE}
    FORMAT JSONEachRow
  `.trim();

  // An empty answer reads as the all-zero row ClickHouse itself returns for an empty aggregate.
  const row = jsonRows(await chSelect(query, tenantId, 'rollup'))[0] ?? {};
  return {
    sessions: Number(row.sessions ?? 0),
    adapted: Number(row.adapted ?? 0),
    holdout: Number(row.holdout ?? 0),
    adapted_n: Number(row.adapted_n ?? 0),
    holdout_n: Number(row.holdout_n ?? 0),
    all: readConversionCounts(row, 'all_', callerClass),
    adaptedArm: readConversionCounts(row, 'adapted_', callerClass),
    holdoutArm: readConversionCounts(row, 'holdout_', callerClass),
  };
}

/**
 * Lift in percent — null (not 0) when there is no holdout baseline yet, and null when the
 * conversion counts are (FOLLOW-1203: caller class disabled → no numerator → no lift). Delegates to
 * the single lift computation in `@/lib/pilot-stats` (FOLLOW-1289) so this rollup can never disagree
 * with the lift route on the same counts. Unrounded, exactly as before (the FOLLOW-819 harness reads
 * it).
 */
function computeLift(
  adaptedN: number,
  adaptedConv: number | null,
  holdoutN: number,
  holdoutConv: number | null,
): number | null {
  if (adaptedConv === null || holdoutConv === null) return null;
  return computeArmLift({
    adaptedN,
    adaptedConversions: adaptedConv,
    holdoutN,
    holdoutConversions: holdoutConv,
  }).relativeLiftPct;
}

// ─── quiz_completions (Postgres — degrades independently) ──────────────────

/** THROWS on a configured-but-failed query — caller degrades ONLY this field (Rule K.2). */
async function fetchQuizCompletionCount(tenantId: string): Promise<number> {
  const db = createAdminClient();
  const rows = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(quizCompletions)
    .where(eq(quizCompletions.tenantId, tenantId));
  return rows[0]?.cnt ?? 0;
}

// ─── scoring_path split (ClickHouse — degrades independently) ───────────────

const SCORING_PATHS: readonly ScoringPath[] = [
  'cosine',
  'djb2_fallback',
  'djb2_guard',
  'not_applicable',
];

/** Zero-filled split, so a path with no rows renders as 0 rather than vanishing. */
function emptySplit(): Record<ScoringPath, number> {
  return { cosine: 0, djb2_fallback: 0, djb2_guard: 0, not_applicable: 0 };
}

/**
 * FOLLOW-560 (audit A3-F-09/F-10): the cosine-vs-djb2 split over the same window.
 *
 * Gated on the SAME `SCORING_PATH_COLUMN_ENABLED` flag that gates the WRITER in
 * `api/adapt/route.ts` `logDecisionAsync`, and for the mirror-image reason: naming a column
 * ClickHouse does not have is an error, not a null. On the write side that error is swallowed
 * (ESC-031: 80 minutes of silent loss); here it would surface as a 500 on a staff page whose
 * other numbers are fine. Since the flag is only ever set where migration 0022 has been applied,
 * it is the correct gate for both halves — the read is simply never attempted otherwise.
 *
 * THROWS on a configured-but-failed query — caller degrades ONLY this field (Rule K.2).
 */
async function fetchScoringPathSplit(tenantId: string): Promise<Record<ScoringPath, number>> {
  const query = `
    SELECT scoring_path AS scoring_path, count() AS n
    FROM adaptation_decisions
    WHERE tenant_id = {tenant_id:String}
      AND ts >= now() - toIntervalDay(${String(WINDOW_DAYS)})
    GROUP BY scoring_path
    FORMAT JSONEachRow
  `.trim();

  const split = emptySplit();
  for (const row of jsonRows(await chSelect(query, tenantId, 'scoring_path split'))) {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- row is Record<string,unknown>; String() coerces safely for primitive JSON values
    const path = String(row.scoring_path ?? '');
    // An unrecognised value means route.ts grew a path this page does not know about; drop it
    // rather than widening the typed record with an arbitrary key.
    if ((SCORING_PATHS as readonly string[]).includes(path)) {
      split[path as ScoringPath] = Number(row.n ?? 0);
    }
  }
  return split;
}

// ─── reorder_withheld counts (ClickHouse — degrades independently) ──────────

const REORDER_WITHHELD_REASONS: readonly ReorderWithheldReason[] = [
  'embeddings_missing',
  'embeddings_not_attempted',
  'embeddings_lookup_failed',
];

/**
 * FOLLOW-1220: per-reason count of withheld reorders over the same window. Reads the key out of the
 * existing `features_snapshot` JSON column, so it works wherever `adaptation_decisions` exists.
 *
 * THROWS on a configured-but-failed query — caller degrades ONLY this field (Rule K.2).
 */
async function fetchReorderWithheldCounts(
  tenantId: string,
): Promise<Record<ReorderWithheldReason, number>> {
  const query = `
    SELECT JSONExtractString(features_snapshot, 'reorder_withheld') AS reason, count() AS n
    FROM adaptation_decisions
    WHERE tenant_id = {tenant_id:String}
      AND ts >= now() - toIntervalDay(${String(WINDOW_DAYS)})
      AND JSONExtractString(features_snapshot, 'reorder_withheld') != ''
    GROUP BY reason
    FORMAT JSONEachRow
  `.trim();

  const counts: Record<ReorderWithheldReason, number> = {
    embeddings_missing: 0,
    embeddings_not_attempted: 0,
    embeddings_lookup_failed: 0,
  };
  for (const row of jsonRows(await chSelect(query, tenantId, 'reorder_withheld'))) {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- row is Record<string,unknown>; String() coerces safely for primitive JSON values
    const reason = String(row.reason ?? '');
    // An unrecognised reason means route.ts grew one this page does not know about; drop it.
    if ((REORDER_WITHHELD_REASONS as readonly string[]).includes(reason)) {
      counts[reason as ReorderWithheldReason] = Number(row.n ?? 0);
    }
  }
  return counts;
}

// ─── Mock data (dev/CI fallback — stores unconfigured) ──────────────────────

function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + (s.charCodeAt(i) | 0)) | 0;
  }
  return Math.abs(h);
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

function buildMockRollup(tenantId: string): TenantAnalyticsRollup {
  const seed = hash(tenantId);
  const sessions = 200 + Math.floor(seededRandom(seed) * 3000);
  const adapted = Math.floor(sessions * (0.85 + seededRandom(seed + 1) * 0.1));
  const holdout = sessions - adapted;
  const adaptedConversions = Math.floor(adapted * 0.03);
  const holdoutConversions = Math.floor(holdout * 0.025);

  return {
    tenant_id: tenantId,
    window_days: WINDOW_DAYS,
    generated_at: new Date().toISOString(),
    rollup: {
      sessions,
      adapted,
      holdout,
      ctaLift: computeLift(adapted, adaptedConversions, holdout, holdoutConversions),
      conversions: {
        adaptedN: adapted,
        holdoutN: holdout,
        adaptedConversions,
        holdoutConversions,
        preExposureConversions: Math.floor(adaptedConversions * 0.05),
        unsignedConversions: Math.floor(adaptedConversions * 0.1),
        ctaClickedSessions: Math.floor(sessions * 0.12),
      },
      quizCompletions: Math.floor(sessions * (0.1 + seededRandom(seed + 2) * 0.15)),
    },
    data_source: 'mock',
    conversion_source: 'mock',
    quiz_data_source: 'mock',
    scoringPathSplit: {
      cosine: 0,
      djb2_fallback: Math.floor(adapted * 0.6),
      djb2_guard: Math.floor(adapted * 0.4),
      not_applicable: holdout,
    },
    scoring_path_source: 'mock',
    reorderWithheld: {
      embeddings_missing: Math.floor(adapted * 0.6),
      embeddings_not_attempted: Math.floor(adapted * 0.4),
      embeddings_lookup_failed: 0,
    },
    reorder_withheld_source: 'mock',
  };
}

// ─── Public entry point ─────────────────────────────────────────────────────

/**
 * Build the analytics rollup for one tenant. The caller decides which tenant may be asked for:
 * `route.ts` allows only `ESTALARA_TENANT_ID`; the staff hub page passes its validated `[id]`.
 *
 * @returns `{ ok: true, data }` on success (live or mock — see `data_source`).
 * @returns `{ ok: false, status: 500, error }` when ClickHouse is configured and the PRIMARY
 *   rollup query fails. Rule K.2 — the route handler maps this to HTTP 500; NEVER fabricated.
 */
export async function getTenantAnalyticsRollup(tenantId: string): Promise<RollupResult> {
  if (!clickhouseConfigured() || !postgresConfigured()) {
    // Dependency not configured (dev/CI) — legitimate, observable mock.
    return { ok: true, data: buildMockRollup(tenantId) };
  }

  // FOLLOW-1203: with the flag off the query does not name `events.caller_signed` and every
  // conversion-derived number below is null — 'disabled', never a lift without the caller class.
  const callerClass = callerSignedColumnEnabled();

  let ch: ChRollupRow;
  try {
    ch = await fetchChRollup(tenantId, callerClass);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, { tags: { route: 'admin/analytics/rollup' } });
    return { ok: false, status: 500, error: message };
  }

  // Secondary metric — degrades independently (Rule K.2: 200 + explicit flag,
  // never a fabricated 0 for a store that is configured but threw).
  let quizCount: number | null = null;
  let quizDataSource: 'live' | 'error' = 'live';
  try {
    quizCount = await fetchQuizCompletionCount(tenantId);
  } catch (err: unknown) {
    quizDataSource = 'error';
    Sentry.captureException(err, {
      tags: { route: 'admin/analytics/rollup', field: 'quizCompletions' },
    });
  }

  // FOLLOW-560 — third secondary metric, degrading independently of both the primary group and
  // quizCompletions. 'disabled' is the ordinary state wherever migration 0022 is not applied yet
  // (production, until FOLLOW-820) and must not be conflated with 'error'.
  let scoringPathSplit: Record<ScoringPath, number> | null = null;
  let scoringPathSource: 'live' | 'disabled' | 'error' = 'disabled';
  if (process.env.SCORING_PATH_COLUMN_ENABLED === 'true') {
    try {
      scoringPathSplit = await fetchScoringPathSplit(tenantId);
      scoringPathSource = 'live';
    } catch (err: unknown) {
      scoringPathSource = 'error';
      Sentry.captureException(err, {
        tags: { route: 'admin/analytics/rollup', field: 'scoringPathSplit' },
      });
    }
  }

  // FOLLOW-1220 — fourth secondary metric, independent of the flag above: the key lives in the
  // existing JSON column, so it is attempted wherever the primary group is.
  let reorderWithheld: Record<ReorderWithheldReason, number> | null = null;
  let reorderWithheldSource: 'live' | 'error' = 'live';
  try {
    reorderWithheld = await fetchReorderWithheldCounts(tenantId);
  } catch (err: unknown) {
    reorderWithheldSource = 'error';
    Sentry.captureException(err, {
      tags: { route: 'admin/analytics/rollup', field: 'reorderWithheld' },
    });
  }

  const conversions: RollupConversionCounts = {
    adaptedN: ch.adapted_n,
    holdoutN: ch.holdout_n,
    adaptedConversions: ch.adaptedArm.conversions,
    holdoutConversions: ch.holdoutArm.conversions,
    preExposureConversions: ch.all.pre_exposure_conversions,
    unsignedConversions: ch.all.unsigned_conversions,
    ctaClickedSessions: ch.all.cta_sessions,
  };

  return {
    ok: true,
    data: {
      tenant_id: tenantId,
      window_days: WINDOW_DAYS,
      generated_at: new Date().toISOString(),
      rollup: {
        sessions: ch.sessions,
        adapted: ch.adapted,
        holdout: ch.holdout,
        ctaLift: computeLift(
          conversions.adaptedN,
          conversions.adaptedConversions,
          conversions.holdoutN,
          conversions.holdoutConversions,
        ),
        conversions,
        quizCompletions: quizCount,
      },
      data_source: 'clickhouse',
      conversion_source: callerClass ? 'signed_events' : 'disabled',
      quiz_data_source: quizDataSource,
      scoringPathSplit,
      scoring_path_source: scoringPathSource,
      reorderWithheld,
      reorder_withheld_source: reorderWithheldSource,
    },
  };
}
