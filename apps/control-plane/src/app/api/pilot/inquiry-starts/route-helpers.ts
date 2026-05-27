/**
 * Shared types for GET /api/pilot/inquiry-starts.
 *
 * Extracted from route.ts so that Next.js 15 App Router does not reject the
 * route segment for exporting non-handler functions (build error: "Route does
 * not match the required types of a Next.js Route"), and so that client
 * components can import the canonical types without pulling in the
 * @estalara/auth workspace package (which is only built in CI).
 *
 * @module apps/control-plane/src/app/api/pilot/inquiry-starts/route-helpers
 */

// ─── Response types ────────────────────────────────────────────────────────────

export interface DailyBreakdownRow {
  date: string;
  adapted: number;
  holdout: number;
}

export interface InquiryStartsResponse {
  tenant_id: string;
  total_inquiry_starts: number;
  adapted_count: number;
  holdout_count: number;
  /** Inquiry start rate for adapted arm (inquiry_starts / sessions). 0 when no adapted sessions. */
  adapted_rate: number;
  /** Inquiry start rate for holdout arm. 0 when no holdout sessions. */
  holdout_rate: number;
  /**
   * Lift percentage: (adapted_rate - holdout_rate) / holdout_rate * 100.
   * null when either arm has fewer than 30 inquiry starts (insufficient data).
   */
  lift_pct: number | null;
  daily_breakdown: DailyBreakdownRow[];
  window_days: number;
  generated_at: string;
  /**
   * Provenance field (Rule K.2). 'clickhouse' when data came from a live
   * ClickHouse query; 'mock' when CLICKHOUSE_URL is not set (dev / CI).
   */
  data_source: 'clickhouse' | 'mock';
}
