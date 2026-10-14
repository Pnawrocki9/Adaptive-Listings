/**
 * Platform-wide (cross-brand) analytics rollup — data access layer.
 *
 * FOLLOW-638 (CEO per-brand ruling, 2026-07-24; see memory
 * `project_single_tenant_rebrand_model`). Every client brand is a white-label
 * deployment of app.estalara.com on its own domain, backed by ONE `tenants`
 * row and ONE shared data pool (ClickHouse + Postgres). Per-tenant analytics
 * already exist (`/api/dashboard/analytics/summary|lift`, tenant-fenced). This
 * module is the GAP they close: a deliberately UNFENCED rollup across every
 * tenant, for Estalara staff only.
 *
 * This is NOT the parked cross-tenant DP-MOAT epic — plain rollup, no
 * differential privacy, single first-party data pool (source_retro note in
 * `backlog/FOLLOW_UPS.md` FOLLOW-638).
 *
 * Query-builder patterns are reused from the existing per-tenant routes:
 *   - sessions/adapted/holdout counts: `dashboard/analytics/summary/route.ts`
 *   - the adaptation_decisions ⋈ events join for the conversion counts: the SAME three builders
 *     the lift route uses (`conversionEventsSubquery`, `conversionCountColumns`,
 *     `readConversionCounts` in `dashboard/analytics/lift/route-helpers.ts`). Since FOLLOW-1203 a
 *     conversion is a server-confirmed `inquiry.completed` / `live.signup` after the session's
 *     first decision; `cta.clicked` is a reported funnel stage and never the numerator.
 * The only structural difference: no `tenant_id = {tenant_id:String}` filter
 * (deliberately unfenced) and `GROUP BY tenant_id` instead.
 *
 * ─── Rule K.2 (fail loud) — TWO independent backing stores ─────────────────
 * This route depends on BOTH ClickHouse (session/adaptation/CTA metrics) AND
 * Postgres (tenant roster + quiz_completions). Mixing "ClickHouse configured,
 * Postgres not" (or vice versa) is not a real deployment shape — both stores
 * are provisioned together in every environment that has either — so the two
 * are treated as ONE configuration gate for the top-level `data_source`
 * ('clickhouse' | 'mock'): when NEITHER `CLICKHOUSE_URL` nor
 * `DATABASE_URL_ADMIN`/`DATABASE_URL_DIRECT` is set (dev/CI), the whole
 * response is deterministic mock data, clearly tagged. When BOTH are
 * configured, every query is live and a failure of ClickHouse OR the tenant
 * roster Postgres query is a hard failure (`ok: false`, mapped to HTTP 500 by
 * the route handler) — never fabricated.
 *
 * The `quiz_completions` Postgres query (secondary metric, not the primary
 * go/no-go numbers) degrades independently: if it throws while the tenant
 * roster and ClickHouse queries succeed, the response still returns 200 but
 * `quiz_data_source: 'error'` and every `quizCompletions` field is `null`
 * (never a fabricated 0) — this is the explicit "200 carrying a degraded
 * flag" path the guardrails allow for a non-primary metric.
 *
 * @module apps/control-plane/src/app/api/admin/analytics/rollup/data
 */

import { isNull, sql } from 'drizzle-orm';
import * as Sentry from '@sentry/nextjs';

import { createAdminClient, tenants, quizCompletions } from '@estalara/db';
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

export interface BrandBreakdownRow {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  sessions: number;
  adapted: number;
  holdout: number;
  /**
   * (adaptedRate - holdoutRate) / holdoutRate * 100, over SERVER-CONFIRMED conversions
   * (FOLLOW-1203; the field name predates the ruling and is kept). null when holdoutN is 0, when
   * no holdout session converted, or when `conversion_source` is 'disabled'.
   */
  ctaLift: number | null;
  conversions: RollupConversionCounts;
  /** null only when quiz_data_source is 'error' (Postgres configured but query threw). */
  quizCompletions: number | null;
}

export interface RollupTotals {
  tenantCount: number;
  sessions: number;
  adapted: number;
  holdout: number;
  /**
   * Platform-wide lift, computed from summed adapted/holdout SERVER-CONFIRMED conversion counts
   * (FOLLOW-1203). null under the same conditions as the per-brand field.
   */
  ctaLift: number | null;
  conversions: RollupConversionCounts;
  /** null only when quiz_data_source is 'error'. */
  quizCompletions: number | null;
}

export interface PlatformAnalyticsRollup {
  window_days: number;
  generated_at: string;
  rollup: RollupTotals;
  brands: BrandBreakdownRow[];
  /**
   * Provenance for the primary metric group (sessions/adapted/holdout/ctaLift
   * + the tenant roster itself).
   * 'clickhouse' — live data from ClickHouse + the Postgres tenant roster.
   * 'mock'       — CLICKHOUSE_URL AND the admin Postgres connection are both
   *                unset (dev/CI); deterministic stub data.
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
  | { ok: true; data: PlatformAnalyticsRollup }
  | { ok: false; status: 500; error: string };

const WINDOW_DAYS = 7;

// ─── Config gates ───────────────────────────────────────────────────────────

function clickhouseConfigured(): boolean {
  return Boolean(process.env.CLICKHOUSE_URL);
}

function postgresConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT);
}

// ─── Tenant roster (Postgres, unfenced — staff-only) ───────────────────────

interface TenantMeta {
  id: string;
  name: string;
  slug: string;
}

/** THROWS on a configured-but-failed query (Rule K.2 — caller maps to 500). */
async function fetchTenantRoster(): Promise<TenantMeta[]> {
  const db = createAdminClient();
  const rows = await db
    .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
    .from(tenants)
    .where(isNull(tenants.deletedAt));
  return rows;
}

// ─── ClickHouse: per-tenant sessions/adapted/holdout/CTA conversion counts ──

interface ChTenantRow {
  tenant_id: string;
  sessions: number;
  adapted: number;
  holdout: number;
  adapted_n: number;
  holdout_n: number;
  /** All sessions of the tenant (both arms) — the reported, uncounted classes. */
  all: ConversionCounts;
  adaptedArm: ConversionCounts;
  holdoutArm: ConversionCounts;
}

/**
 * Deliberately UNFENCED — no `tenant_id = {...}` filter, `GROUP BY ad.tenant_id`
 * instead. Staff-only route (verifyTracerAdminAuth in route.ts); every other
 * consumer of adaptation_decisions/events fences on tenant_id.
 *
 * THROWS on a configured-but-failed query (Rule K.2 — caller maps to 500).
 */
async function fetchChRollupByTenant(callerClass: boolean): Promise<ChTenantRow[]> {
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  if (!clickhouseUrl) {
    throw new Error('fetchChRollupByTenant called without CLICKHOUSE_URL configured');
  }

  const user = process.env.CLICKHOUSE_USER ?? 'default';
  const password = process.env.CLICKHOUSE_PASSWORD ?? '';

  // The same join as dashboard/analytics/lift/route-helpers.ts, built from the same three
  // FOLLOW-1203 builders (one definition of a conversion), but unfenced and GROUP BY ad.tenant_id
  // instead of a single tenant_id filter, so the per-arm conditions sit inside the columns.
  // FOLLOW-1303: the same FOLLOW-371 contamination predicate as the lift route (one shared
  // constant), so a holdout row with a non-control variant never enters any count — sessions,
  // holdout, or the conversion counts `ctaLift` is computed from.
  const query = `
    SELECT
      ad.tenant_id                                                          AS tenant_id,
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
      tenantFence: null,
      windowDays: String(WINDOW_DAYS),
    })}
    ) AS ev
      ON ad.tenant_id = ev.tenant_id AND ad.session_id = ev.session_id
    WHERE ad.ts >= now() - toIntervalDay(${String(WINDOW_DAYS)})
      AND ${CLEAN_HOLDOUT_PREDICATE}
    GROUP BY ad.tenant_id
    FORMAT JSONEachRow
  `.trim();

  const url = new URL(clickhouseUrl);
  url.searchParams.set('query', query);

  const headers: Record<string, string> = {
    'Content-Type': 'text/plain',
    ...clickhouseAuthHeaders({ user, password }),
  };

  const res = await fetch(url.toString(), { method: 'GET', headers });
  if (!res.ok) {
    throw new Error(
      `ClickHouse cross-brand rollup query failed: HTTP ${String(res.status)} ${res.statusText}`,
    );
  }

  const text = await res.text();
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const row = JSON.parse(line) as Record<string, unknown>;
      return {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- row is Record<string,unknown>; String() coerces safely for primitive JSON values
        tenant_id: String(row.tenant_id ?? ''),
        sessions: Number(row.sessions ?? 0),
        adapted: Number(row.adapted ?? 0),
        holdout: Number(row.holdout ?? 0),
        adapted_n: Number(row.adapted_n ?? 0),
        holdout_n: Number(row.holdout_n ?? 0),
        all: readConversionCounts(row, 'all_', callerClass),
        adaptedArm: readConversionCounts(row, 'adapted_', callerClass),
        holdoutArm: readConversionCounts(row, 'holdout_', callerClass),
      };
    });
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

// ─── quiz_completions (Postgres, unfenced — degrades independently) ────────

interface QuizCountRow {
  tenantId: string;
  cnt: number;
}

/** THROWS on a configured-but-failed query — caller degrades ONLY this field (Rule K.2). */
async function fetchQuizCompletionCounts(): Promise<QuizCountRow[]> {
  const db = createAdminClient();
  const rows = await db
    .select({
      tenantId: quizCompletions.tenantId,
      cnt: sql<number>`count(*)::int`,
    })
    .from(quizCompletions)
    .groupBy(quizCompletions.tenantId);
  return rows;
}

// ─── scoring_path split (ClickHouse, unfenced — degrades independently) ────

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
async function fetchScoringPathSplit(): Promise<Record<ScoringPath, number>> {
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  if (!clickhouseUrl) {
    throw new Error('fetchScoringPathSplit called without CLICKHOUSE_URL configured');
  }

  const user = process.env.CLICKHOUSE_USER ?? 'default';
  const password = process.env.CLICKHOUSE_PASSWORD ?? '';

  const query = `
    SELECT scoring_path AS scoring_path, count() AS n
    FROM adaptation_decisions
    WHERE ts >= now() - toIntervalDay(${String(WINDOW_DAYS)})
    GROUP BY scoring_path
    FORMAT JSONEachRow
  `.trim();

  const url = new URL(clickhouseUrl);
  url.searchParams.set('query', query);

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'text/plain',
      ...clickhouseAuthHeaders({ user, password }),
    },
  });
  if (!res.ok) {
    throw new Error(
      `ClickHouse scoring_path split query failed: HTTP ${String(res.status)} ${res.statusText}`,
    );
  }

  const split = emptySplit();
  const text = await res.text();
  for (const line of text.trim().split('\n').filter(Boolean)) {
    const row = JSON.parse(line) as Record<string, unknown>;
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

// ─── reorder_withheld counts (ClickHouse, unfenced — degrades independently) ──

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
async function fetchReorderWithheldCounts(): Promise<Record<ReorderWithheldReason, number>> {
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  if (!clickhouseUrl) {
    throw new Error('fetchReorderWithheldCounts called without CLICKHOUSE_URL configured');
  }

  const query = `
    SELECT JSONExtractString(features_snapshot, 'reorder_withheld') AS reason, count() AS n
    FROM adaptation_decisions
    WHERE ts >= now() - toIntervalDay(${String(WINDOW_DAYS)})
      AND JSONExtractString(features_snapshot, 'reorder_withheld') != ''
    GROUP BY reason
    FORMAT JSONEachRow
  `.trim();

  const url = new URL(clickhouseUrl);
  url.searchParams.set('query', query);

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
      `ClickHouse reorder_withheld query failed: HTTP ${String(res.status)} ${res.statusText}`,
    );
  }

  const counts: Record<ReorderWithheldReason, number> = {
    embeddings_missing: 0,
    embeddings_not_attempted: 0,
    embeddings_lookup_failed: 0,
  };
  const text = await res.text();
  for (const line of text.trim().split('\n').filter(Boolean)) {
    const row = JSON.parse(line) as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- row is Record<string,unknown>; String() coerces safely for primitive JSON values
    const reason = String(row.reason ?? '');
    // An unrecognised reason means route.ts grew one this page does not know about; drop it.
    if ((REORDER_WITHHELD_REASONS as readonly string[]).includes(reason)) {
      counts[reason as ReorderWithheldReason] = Number(row.n ?? 0);
    }
  }
  return counts;
}

// ─── Mock data (dev/CI fallback — both stores unconfigured) ───────────────

const MOCK_BRANDS: readonly { id: string; name: string; slug: string }[] = [
  { id: '00000000-0000-0000-0000-0000000a0001', name: 'Estalara (first-party)', slug: 'estalara' },
  { id: '00000000-0000-0000-0000-0000000a0002', name: 'Costa Sol Properties', slug: 'costa-sol' },
  {
    id: '00000000-0000-0000-0000-0000000a0003',
    name: 'Marbella Premium',
    slug: 'marbella-premium',
  },
];

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

function buildMockRollup(): PlatformAnalyticsRollup {
  const brands: BrandBreakdownRow[] = MOCK_BRANDS.map((b, i) => {
    const seed = hash(b.id) + i;
    const sessions = 200 + Math.floor(seededRandom(seed) * 3000);
    const adapted = Math.floor(sessions * (0.85 + seededRandom(seed + 1) * 0.1));
    const holdout = sessions - adapted;
    const quizCompletionsN = Math.floor(sessions * (0.1 + seededRandom(seed + 2) * 0.15));
    const liftPct = -5 + seededRandom(seed + 3) * 30;
    const adaptedConversions = Math.floor(adapted * 0.03);
    return {
      tenant_id: b.id,
      tenant_name: b.name,
      tenant_slug: b.slug,
      sessions,
      adapted,
      holdout,
      ctaLift: Math.round(liftPct * 100) / 100,
      conversions: {
        adaptedN: adapted,
        holdoutN: holdout,
        adaptedConversions,
        holdoutConversions: Math.floor(holdout * 0.025),
        preExposureConversions: Math.floor(adaptedConversions * 0.05),
        unsignedConversions: Math.floor(adaptedConversions * 0.1),
        ctaClickedSessions: Math.floor(sessions * 0.12),
      },
      quizCompletions: quizCompletionsN,
    };
  });
  const sumConv = (pick: (c: RollupConversionCounts) => number | null): number =>
    brands.reduce((sum, b) => sum + (pick(b.conversions) ?? 0), 0);

  const rollup: RollupTotals = {
    tenantCount: brands.length,
    sessions: brands.reduce((sum, b) => sum + b.sessions, 0),
    adapted: brands.reduce((sum, b) => sum + b.adapted, 0),
    holdout: brands.reduce((sum, b) => sum + b.holdout, 0),
    ctaLift:
      Math.round((brands.reduce((sum, b) => sum + (b.ctaLift ?? 0), 0) / brands.length) * 100) /
      100,
    conversions: {
      adaptedN: sumConv((c) => c.adaptedN),
      holdoutN: sumConv((c) => c.holdoutN),
      adaptedConversions: sumConv((c) => c.adaptedConversions),
      holdoutConversions: sumConv((c) => c.holdoutConversions),
      preExposureConversions: sumConv((c) => c.preExposureConversions),
      unsignedConversions: sumConv((c) => c.unsignedConversions),
      ctaClickedSessions: sumConv((c) => c.ctaClickedSessions),
    },
    quizCompletions: brands.reduce((sum, b) => sum + (b.quizCompletions ?? 0), 0),
  };

  return {
    window_days: WINDOW_DAYS,
    generated_at: new Date().toISOString(),
    rollup,
    brands,
    data_source: 'mock',
    conversion_source: 'mock',
    quiz_data_source: 'mock',
    scoringPathSplit: {
      cosine: 0,
      djb2_fallback: Math.floor(rollup.adapted * 0.6),
      djb2_guard: Math.floor(rollup.adapted * 0.4),
      not_applicable: rollup.holdout,
    },
    scoring_path_source: 'mock',
    reorderWithheld: {
      embeddings_missing: Math.floor(rollup.adapted * 0.6),
      embeddings_not_attempted: Math.floor(rollup.adapted * 0.4),
      embeddings_lookup_failed: 0,
    },
    reorder_withheld_source: 'mock',
  };
}

// ─── Public entry point ─────────────────────────────────────────────────────

/**
 * Build the platform-wide cross-brand analytics rollup.
 *
 * @returns `{ ok: true, data }` on success (live or mock — see `data_source`).
 * @returns `{ ok: false, status: 500, error }` when a configured store fails
 *   on the PRIMARY metric group (tenant roster or ClickHouse). Rule K.2 — the
 *   route handler maps this to HTTP 500 and captures Sentry; NEVER fabricated.
 */
export async function getPlatformAnalyticsRollup(): Promise<RollupResult> {
  if (!clickhouseConfigured() || !postgresConfigured()) {
    // Dependency not configured (dev/CI) — legitimate, observable mock.
    return { ok: true, data: buildMockRollup() };
  }

  // FOLLOW-1203: with the flag off the query does not name `events.caller_signed` and every
  // conversion-derived number below is null — 'disabled', never a lift without the caller class.
  const callerClass = callerSignedColumnEnabled();

  let tenantRoster: TenantMeta[];
  let chRows: ChTenantRow[];
  try {
    [tenantRoster, chRows] = await Promise.all([
      fetchTenantRoster(),
      fetchChRollupByTenant(callerClass),
    ]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, { tags: { route: 'admin/analytics/rollup' } });
    return { ok: false, status: 500, error: message };
  }

  // Secondary metric — degrades independently (Rule K.2: 200 + explicit flag,
  // never a fabricated 0 for a store that is configured but threw).
  let quizRows: QuizCountRow[] = [];
  let quizDataSource: 'live' | 'error' = 'live';
  try {
    quizRows = await fetchQuizCompletionCounts();
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
      scoringPathSplit = await fetchScoringPathSplit();
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
    reorderWithheld = await fetchReorderWithheldCounts();
  } catch (err: unknown) {
    reorderWithheldSource = 'error';
    Sentry.captureException(err, {
      tags: { route: 'admin/analytics/rollup', field: 'reorderWithheld' },
    });
  }

  const chByTenant = new Map(chRows.map((r) => [r.tenant_id, r]));
  const quizByTenant = new Map(quizRows.map((r) => [r.tenantId, r.cnt]));

  let totalSessions = 0;
  let totalAdapted = 0;
  let totalHoldout = 0;
  let totalQuiz = 0;
  // Null stays null: a class-dependent total is a number only when the caller class was read.
  const zeroOrNull = callerClass ? 0 : null;
  const add = (total: number | null, n: number | null): number | null =>
    total === null || n === null ? null : total + n;
  const totalConversions: RollupConversionCounts = {
    adaptedN: 0,
    holdoutN: 0,
    adaptedConversions: zeroOrNull,
    holdoutConversions: zeroOrNull,
    preExposureConversions: zeroOrNull,
    unsignedConversions: zeroOrNull,
    ctaClickedSessions: 0,
  };

  const brands: BrandBreakdownRow[] = tenantRoster.map((t) => {
    const ch = chByTenant.get(t.id);
    const sessions = ch?.sessions ?? 0;
    const adapted = ch?.adapted ?? 0;
    const holdout = ch?.holdout ?? 0;
    const conversions: RollupConversionCounts = {
      adaptedN: ch?.adapted_n ?? 0,
      holdoutN: ch?.holdout_n ?? 0,
      adaptedConversions: ch ? ch.adaptedArm.conversions : zeroOrNull,
      holdoutConversions: ch ? ch.holdoutArm.conversions : zeroOrNull,
      preExposureConversions: ch ? ch.all.pre_exposure_conversions : zeroOrNull,
      unsignedConversions: ch ? ch.all.unsigned_conversions : zeroOrNull,
      ctaClickedSessions: ch?.all.cta_sessions ?? 0,
    };
    const ctaLift = ch
      ? computeLift(
          conversions.adaptedN,
          conversions.adaptedConversions,
          conversions.holdoutN,
          conversions.holdoutConversions,
        )
      : null;
    const quizCount = quizDataSource === 'error' ? null : (quizByTenant.get(t.id) ?? 0);

    totalSessions += sessions;
    totalAdapted += adapted;
    totalHoldout += holdout;
    totalConversions.adaptedN += conversions.adaptedN;
    totalConversions.holdoutN += conversions.holdoutN;
    totalConversions.ctaClickedSessions += conversions.ctaClickedSessions;
    totalConversions.adaptedConversions = add(
      totalConversions.adaptedConversions,
      conversions.adaptedConversions,
    );
    totalConversions.holdoutConversions = add(
      totalConversions.holdoutConversions,
      conversions.holdoutConversions,
    );
    totalConversions.preExposureConversions = add(
      totalConversions.preExposureConversions,
      conversions.preExposureConversions,
    );
    totalConversions.unsignedConversions = add(
      totalConversions.unsignedConversions,
      conversions.unsignedConversions,
    );
    if (quizCount !== null) totalQuiz += quizCount;

    return {
      tenant_id: t.id,
      tenant_name: t.name,
      tenant_slug: t.slug,
      sessions,
      adapted,
      holdout,
      ctaLift,
      conversions,
      quizCompletions: quizCount,
    };
  });

  const rollup: RollupTotals = {
    tenantCount: tenantRoster.length,
    sessions: totalSessions,
    adapted: totalAdapted,
    holdout: totalHoldout,
    ctaLift: computeLift(
      totalConversions.adaptedN,
      totalConversions.adaptedConversions,
      totalConversions.holdoutN,
      totalConversions.holdoutConversions,
    ),
    conversions: totalConversions,
    quizCompletions: quizDataSource === 'error' ? null : totalQuiz,
  };

  return {
    ok: true,
    data: {
      window_days: WINDOW_DAYS,
      generated_at: new Date().toISOString(),
      rollup,
      brands,
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
