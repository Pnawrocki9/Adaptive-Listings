/**
 * Shared types and assembly helpers for GET /api/pilot/cta-lift.
 *
 * Extracted from route.ts so that Next.js 15 App Router does not reject the
 * route segment for exporting non-handler functions (build error: "Route does
 * not match the required types of a Next.js Route").
 *
 * @module apps/control-plane/src/app/api/pilot/cta-lift/route-helpers
 */

import {
  twoProportionZTest,
  classifyConfidence,
  relativeLiftPct,
  type PilotConfidence,
} from '@/lib/pilot-stats';

// ─── Response types ──────────────────────────────────────────────────────────

/** Funnel stages, ordered top → bottom. */
export const FUNNEL_STAGES = [
  'page.view',
  'listing.viewed',
  'cta.clicked',
  'inquiry.started',
  'inquiry.completed',
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export interface PilotSummary {
  adapted_sessions: number;
  holdout_sessions: number;
  /** cta.clicked sessions / total adapted sessions, in [0, 1]. */
  adapted_cta_rate: number;
  holdout_cta_rate: number;
  /** adapted_cta_rate - holdout_cta_rate. */
  absolute_lift: number;
  /** (adapted - holdout) / holdout * 100. null when holdout_cta_rate === 0. */
  relative_lift_pct: number | null;
  /** Two-proportion z-test two-tailed p-value. */
  p_value: number;
  /** True only when p_value < 0.05 AND both arms meet the minimum sample. */
  is_significant: boolean;
  confidence: PilotConfidence;
}

export interface FunnelRow {
  stage: FunnelStage;
  adapted_count: number;
  holdout_count: number;
  /** adapted_count / adapted_sessions, in [0, 1]. */
  adapted_rate: number;
  holdout_rate: number;
}

export interface ArchetypeRow {
  archetype: string;
  adapted_cta_rate: number;
  holdout_cta_rate: number;
  /** Relative lift %. null when holdout_cta_rate === 0. */
  lift_pct: number | null;
  n_adapted: number;
  n_holdout: number;
  p_value: number;
}

export interface CtaLiftResponse {
  window_days: number;
  tenant_id: string;
  summary: PilotSummary;
  funnel: FunnelRow[];
  by_archetype: ArchetypeRow[];
  generated_at: string;
  /** Indicates whether data came from ClickHouse or the deterministic dev/CI mock. */
  data_source: 'clickhouse' | 'mock';
}

// ─── Internal ClickHouse row shapes (re-exported for route.ts) ───────────────

export interface ChGroupCounts {
  holdout: number;
  sessions: number;
  cta_sessions: number;
}

export interface ChArchetypeCounts {
  archetype: string;
  holdout: number;
  sessions: number;
  cta_sessions: number;
}

export interface ChFunnelCounts {
  stage: string;
  holdout: number;
  sessions: number;
}

export interface ChRawData {
  groups: ChGroupCounts[];
  archetypes: ChArchetypeCounts[];
  funnel: ChFunnelCounts[];
}

// ─── Query param parsing ──────────────────────────────────────────────────────

const ALLOWED_WINDOWS = [7, 14, 30] as const;
type WindowDays = (typeof ALLOWED_WINDOWS)[number];

/** Parse window_days; defaults to 7 when missing or out of the allowed set. */
export function parseWindowDays(raw: string | null): WindowDays {
  const n = Number(raw);
  return (ALLOWED_WINDOWS as readonly number[]).includes(n) ? (n as WindowDays) : 7;
}

// ─── Assembly: raw counts → response ─────────────────────────────────────────

/** Pick the arm row for the given holdout flag (0=adapted, 1=holdout). */
function armRow<T extends { holdout: number }>(rows: T[], holdout: 0 | 1): T | undefined {
  return rows.find((r) => r.holdout === holdout);
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Transform raw ClickHouse counts into the public response shape, applying the
 * z-test, minimum-sample guard, and division-by-zero guard.
 */
export function buildResponseFromRaw(
  tenantId: string,
  windowDays: number,
  raw: ChRawData,
  dataSource: 'clickhouse' | 'mock' = 'clickhouse',
): CtaLiftResponse {
  // ── Summary ──
  const adaptedGroup = armRow(raw.groups, 0);
  const holdoutGroup = armRow(raw.groups, 1);
  const adaptedSessions = adaptedGroup?.sessions ?? 0;
  const holdoutSessions = holdoutGroup?.sessions ?? 0;
  const adaptedCta = adaptedGroup?.cta_sessions ?? 0;
  const holdoutCta = holdoutGroup?.cta_sessions ?? 0;

  const adaptedRate = adaptedSessions > 0 ? adaptedCta / adaptedSessions : 0;
  const holdoutRate = holdoutSessions > 0 ? holdoutCta / holdoutSessions : 0;

  const pValue = twoProportionZTest(adaptedRate, adaptedSessions, holdoutRate, holdoutSessions);
  const confidence = classifyConfidence(pValue, adaptedSessions, holdoutSessions);
  const relLift = relativeLiftPct(adaptedRate, holdoutRate);

  const summary: PilotSummary = {
    adapted_sessions: adaptedSessions,
    holdout_sessions: holdoutSessions,
    adapted_cta_rate: round4(adaptedRate),
    holdout_cta_rate: round4(holdoutRate),
    absolute_lift: round4(adaptedRate - holdoutRate),
    relative_lift_pct: relLift === null ? null : Math.round(relLift * 100) / 100,
    p_value: round4(pValue),
    is_significant: confidence === '95%',
    confidence,
  };

  // ── Funnel ──
  const funnel: FunnelRow[] = FUNNEL_STAGES.map((stage) => {
    const stageRows = raw.funnel.filter((r) => r.stage === stage);
    const adaptedCount = armRow(stageRows, 0)?.sessions ?? 0;
    const holdoutCount = armRow(stageRows, 1)?.sessions ?? 0;
    return {
      stage,
      adapted_count: adaptedCount,
      holdout_count: holdoutCount,
      adapted_rate: round4(adaptedSessions > 0 ? adaptedCount / adaptedSessions : 0),
      holdout_rate: round4(holdoutSessions > 0 ? holdoutCount / holdoutSessions : 0),
    };
  });

  // ── By archetype ──
  const archetypeNames = Array.from(new Set(raw.archetypes.map((r) => r.archetype))).filter(
    (a) => a !== '',
  );
  const byArchetype: ArchetypeRow[] = archetypeNames
    .map((archetype) => {
      const rows = raw.archetypes.filter((r) => r.archetype === archetype);
      const a = armRow(rows, 0);
      const h = armRow(rows, 1);
      const nAdapted = a?.sessions ?? 0;
      const nHoldout = h?.sessions ?? 0;
      const aRate = nAdapted > 0 ? (a?.cta_sessions ?? 0) / nAdapted : 0;
      const hRate = nHoldout > 0 ? (h?.cta_sessions ?? 0) / nHoldout : 0;
      const p = twoProportionZTest(aRate, nAdapted, hRate, nHoldout);
      const lift = relativeLiftPct(aRate, hRate);
      return {
        archetype,
        adapted_cta_rate: round4(aRate),
        holdout_cta_rate: round4(hRate),
        lift_pct: lift === null ? null : Math.round(lift * 100) / 100,
        n_adapted: nAdapted,
        n_holdout: nHoldout,
        p_value: round4(p),
      };
    })
    // Top archetypes by adapted volume first.
    .sort((x, y) => y.n_adapted - x.n_adapted);

  return {
    window_days: windowDays,
    tenant_id: tenantId,
    summary,
    funnel,
    by_archetype: byArchetype,
    generated_at: new Date().toISOString(),
    data_source: dataSource,
  };
}
