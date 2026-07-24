'use client';

/**
 * Analytics dashboard — /dashboard/analytics
 *
 * Five panels (TICKET-AB-004 AC 2–6):
 *   Panel 1 — Traffic summary KPIs (sessions, adapted, holdout, p95 latency)
 *   Panel 2 — Buyer archetype breakdown (table + CSS bar — recharts not present)
 *   Panel 3 — Conversion lift vs holdout (per-archetype A/B z-test table)
 *   Panel 4 — Top adaptation types (fallback: top-5 archetypes by adapted volume)
 *   Panel 5 — Anomaly feed (paused archetypes with Resume button)
 *
 * All panels show loading skeletons while fetching and an empty state when
 * ClickHouse returns 0 rows.
 *
 * FOLLOW-453: Panels 1 and 3 (and the panels derived from the same lift fetch —
 * Panel 2, Panel 4) now track {loading, data, error} per fetch and check
 * `res.ok` before parsing. A non-2xx response sets an explicit error state and
 * renders an ErrorBanner instead of coercing the error body to `Number(x ?? 0)`,
 * which previously rendered a fabricated all-zeros panel (Rule K.2; audit F-07).
 * A MockDataBadge is shown whenever the backing route reports
 * `data_source === 'mock'`, mirroring /dashboard/pilot (FOLLOW-122).
 *
 * @module apps/control-plane/src/app/dashboard/analytics/page
 */

import { useEffect, useState } from 'react';

// ─── Canonical types from route modules (FOLLOW-453, parity with FOLLOW-122) ──
// Import canonical response types from the route modules to avoid local
// duplicate interface drift.

import type { SummaryResponse } from '../../api/dashboard/analytics/summary/route';
import type { LiftResponse, LiftRow } from '../../api/dashboard/analytics/lift/route';

// ─── Local state types ────────────────────────────────────────────────────────

/**
 * Wrapper that tracks the HTTP-level outcome of a fetch alongside the parsed
 * payload. A non-2xx response sets `error` and leaves `data` null so callers
 * can distinguish "server error" from "no data yet" (FOLLOW-453).
 */
interface FetchState<T> {
  loading: boolean;
  /** Populated when res.ok was true and the payload parsed successfully. */
  data: T | null;
  /** Populated when res.ok was false (e.g. HTTP 500). */
  error: string | null;
}

interface ArchetypeBreakdownRow {
  archetype: string;
  count: number;
  pct: number;
}

interface BanditRow {
  archetype: string;
  variant: string;
  paused: boolean;
  updated_at: string;
  /** Reason field not yet in mock — rendered as "—" when absent. */
  pause_reason?: string;
}

interface AbWeightsData {
  rows: BanditRow[];
  /**
   * FOLLOW-637: mirrors `AbWeightsResponse.learning_state` from the route —
   * 'paused' means the bandit rows are real but frozen (feedback endpoint
   * disabled and/or every arm still at the Beta(1,1) prior). Defaults to
   * 'paused' when the field is absent from an older/mocked payload so the
   * indicator fails toward "don't imply learning" rather than the reverse.
   */
  learning_state: 'active' | 'paused';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format snake_case → Title Case, e.g. yield_hunter → Yield Hunter. */
function formatArchetype(label: string): string {
  return label
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Format ISO timestamp to locale date string. */
function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

/** Derive the top-10 archetype breakdown from lift rows (adapted + holdout n). */
function deriveArchetypeRows(rows: LiftRow[]): ArchetypeBreakdownRow[] {
  const total = rows.reduce((s, r) => s + r.adaptedN + r.holdoutN, 0);
  return rows
    .map((r) => ({
      archetype: r.archetype,
      count: r.adaptedN + r.holdoutN,
      pct: total > 0 ? ((r.adaptedN + r.holdoutN) / total) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

/** Status badge for lift table. */
function LiftStatusBadge({ status }: { status: LiftRow['status'] }) {
  if (status === 'significant') {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
        Significant
      </span>
    );
  }
  if (status === 'trending') {
    return (
      <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-800">
        Trending
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
      Not significant
    </span>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 ${className ?? ''}`} />;
}

/**
 * Error banner — shown when an API call returns non-2xx (FOLLOW-453).
 *
 * Rendered in place of metric numbers so the operator cannot mistake a
 * 500 response for real (zeroed) data.
 */
function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      aria-label="Analytics data unavailable"
      className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
    >
      <strong>Analytics data unavailable.</strong> <span className="text-red-700">{message}</span>
    </div>
  );
}

/**
 * Mock-data badge — shown when data_source is 'mock' (FOLLOW-453).
 *
 * Gives the operator an unambiguous signal that numbers are synthetic
 * (CLICKHOUSE_URL is unset in this environment).
 */
function MockDataBadge() {
  return (
    <span
      aria-label="MOCK DATA"
      className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-amber-800"
    >
      MOCK DATA
    </span>
  );
}

/**
 * Learning-paused badge — shown when `learning_state === 'paused'` (FOLLOW-637).
 *
 * The Anomaly Feed's bandit rows are REAL (not mocked), but the feedback
 * endpoint that would move them off the Beta(1,1) prior is 503-gated in prod
 * (`FEEDBACK_ENDPOINT_ENABLED`), so `estimated_rate` is stuck at 0.5 for every
 * arm. Without this badge the panel looks like live adaptive analytics when
 * it is actually inert (audit F-02). Weights are NOT hidden — only labeled.
 */
function LearningPausedBadge() {
  return (
    <span
      aria-label="LEARNING PAUSED"
      className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-amber-800"
    >
      Learning Paused
    </span>
  );
}

// ─── Panel 1 — Traffic Summary ────────────────────────────────────────────────

function Panel1({ state }: { state: FetchState<SummaryResponse> }) {
  const { loading, data, error } = state;
  const kpis = [
    { label: 'Tracked Sessions', value: data?.sessions.toLocaleString() ?? '—' },
    { label: 'Adapted Impressions', value: data?.adapted.toLocaleString() ?? '—' },
    { label: 'Holdout Impressions', value: data?.holdout.toLocaleString() ?? '—' },
    {
      label: 'p95 Adapt Latency',
      value: data && data.p95Latency !== null ? `${data.p95Latency.toString()} ms` : '—',
    },
  ];

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">
          Traffic Summary — Last {data?.window_days ?? 7} Days
        </h2>
        {!loading && data?.data_source === 'mock' && <MockDataBadge />}
      </div>

      {!loading && error && <ErrorBanner message={error} />}

      {!error && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {kpis.map(({ label, value }) => (
              <div key={label} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                {loading ? (
                  <>
                    <Skeleton className="mb-2 h-7 w-20" />
                    <Skeleton className="h-3 w-28" />
                  </>
                ) : (
                  <>
                    <div className="text-2xl font-bold text-gray-900">{value}</div>
                    <div className="mt-0.5 text-xs text-gray-500">{label}</div>
                  </>
                )}
              </div>
            ))}
          </div>
          {!loading && !data && (
            <p className="mt-4 text-sm text-gray-400">
              No data yet — start adapting listings to see results here.
            </p>
          )}
        </>
      )}
    </section>
  );
}

// ─── Panel 2 — Archetype Breakdown ────────────────────────────────────────────

function Panel2({ state }: { state: FetchState<LiftResponse> }) {
  const { loading, data, error } = state;
  const rows = deriveArchetypeRows(data?.rows ?? []);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold text-gray-700">
        Buyer Archetype Breakdown — Top 10 (Last 7 Days)
      </h2>

      {!loading && error && <ErrorBanner message={error} />}

      {!error && (
        <>
          {loading && (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          )}

          {!loading && rows.length === 0 && (
            <p className="text-sm text-gray-400">
              No data yet — start adapting listings to see results here.
            </p>
          )}

          {!loading && rows.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="pb-2 font-medium">Archetype</th>
                  <th className="pb-2 font-medium">Sessions</th>
                  <th className="pb-2 font-medium">% of Total</th>
                  <th className="pb-2 font-medium w-40">Distribution</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((row) => (
                  <tr key={row.archetype}>
                    <td className="py-2 font-medium text-gray-800">
                      {formatArchetype(row.archetype)}
                    </td>
                    <td className="py-2 text-gray-600">{row.count.toLocaleString()}</td>
                    <td className="py-2 text-gray-600">{row.pct.toFixed(1)}%</td>
                    <td className="py-2">
                      <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-blue-500"
                          style={{ width: `${row.pct.toFixed(1)}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

// ─── Panel 3 — Conversion Lift ────────────────────────────────────────────────

function Panel3({ state }: { state: FetchState<LiftResponse> }) {
  const { loading, data, error } = state;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">
          Conversion Lift vs Holdout (Last 7 Days)
        </h2>
        {!loading && data?.data_source === 'mock' && <MockDataBadge />}
      </div>
      <p className="mb-4 text-xs text-gray-400">
        Primary metric: CTA click rate. Two-proportion z-test, p &lt; 0.05, N ≥ 200 per arm.
      </p>

      {!loading && error && <ErrorBanner message={error} />}

      {!error && (
        <>
          {loading && (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}

          {!loading && data?.dqsUnavailable && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Conversion lift data not available — requires DQS integration. Will auto-populate when
              DQS events flow.
            </div>
          )}

          {!loading && !data?.dqsUnavailable && (data?.rows.length ?? 0) === 0 && (
            <p className="text-sm text-gray-400">
              No data yet — start adapting listings to see results here.
            </p>
          )}

          {!loading && !data?.dqsUnavailable && (data?.rows.length ?? 0) > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                    <th className="pb-2 font-medium">Archetype</th>
                    <th className="pb-2 font-medium">Adapted Rate</th>
                    <th className="pb-2 font-medium">Holdout Rate</th>
                    <th className="pb-2 font-medium">Lift %</th>
                    <th className="pb-2 font-medium">p-value</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data?.rows.map((row) => (
                    <tr key={row.archetype}>
                      <td className="py-2 font-medium text-gray-800">
                        {formatArchetype(row.archetype)}
                      </td>
                      <td className="py-2 text-gray-600">{(row.adaptedRate * 100).toFixed(2)}%</td>
                      <td className="py-2 text-gray-600">{(row.holdoutRate * 100).toFixed(2)}%</td>
                      <td
                        className={`py-2 font-semibold ${row.lift >= 0 ? 'text-green-700' : 'text-red-600'}`}
                      >
                        {row.lift >= 0 ? '+' : ''}
                        {row.lift.toFixed(1)}%
                      </td>
                      <td className="py-2 text-gray-600">{row.pValue.toFixed(4)}</td>
                      <td className="py-2">
                        <LiftStatusBadge status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ─── Panel 4 — Top Adaptation Types ──────────────────────────────────────────

/**
 * Panel 4 — top adaptation types.
 * Uses top-5 archetypes by adapted volume as the fallback (directives_json not yet
 * in ClickHouse schema per spec note). Derived from the same lift data rows.
 */
function Panel4({ state }: { state: FetchState<LiftResponse> }) {
  const { loading, data, error } = state;
  const liftRows = data?.rows ?? [];
  const top5 = [...liftRows].sort((a, b) => b.adaptedN - a.adaptedN).slice(0, 5);

  const totalAdapted = top5.reduce((s, r) => s + r.adaptedN, 0);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold text-gray-700">Top Adaptation Types</h2>
      <p className="mb-4 text-xs text-gray-400">
        Showing top 5 archetypes by adapted session volume (directive breakdown requires
        directives_json column — not yet stored).
      </p>

      {!loading && error && <ErrorBanner message={error} />}

      {!error && (
        <>
          {loading && (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          )}

          {!loading && top5.length === 0 && (
            <p className="text-sm text-gray-400">
              No data yet — start adapting listings to see results here.
            </p>
          )}

          {!loading && top5.length > 0 && (
            <ol className="space-y-2">
              {top5.map((row, idx) => {
                const pct = totalAdapted > 0 ? (row.adaptedN / totalAdapted) * 100 : 0;
                return (
                  <li key={row.archetype} className="flex items-center gap-3">
                    <span className="w-4 text-right text-xs font-bold text-gray-400">
                      {idx + 1}
                    </span>
                    <span className="w-32 truncate text-sm font-medium text-gray-800">
                      {formatArchetype(row.archetype)}
                    </span>
                    <div className="flex-1">
                      <div className="h-3 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-indigo-500"
                          style={{ width: `${pct.toFixed(1)}%` }}
                        />
                      </div>
                    </div>
                    <span className="w-12 text-right text-xs text-gray-500">{pct.toFixed(1)}%</span>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

// ─── Panel 5 — Anomaly Feed ───────────────────────────────────────────────────

function Panel5({
  loading,
  data,
  onResume,
  resuming,
}: {
  loading: boolean;
  data: AbWeightsData | null;
  onResume: (archetype: string) => void;
  resuming: Set<string>;
}) {
  const pausedRows = data?.rows.filter((r) => r.paused) ?? [];
  const learningPaused = !loading && data?.learning_state === 'paused';

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Anomaly Feed</h2>
        {learningPaused && <LearningPausedBadge />}
      </div>
      <p className="mb-4 text-xs text-gray-400">
        Archetypes auto-paused by regression detection (p &lt; 0.05, ≥ 200 sessions per arm).
      </p>

      {learningPaused && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Learning paused — bandit not yet receiving conversions. Arm weights below are real rows,
          but stuck at the Beta(1,1) prior until the feedback endpoint is enabled and conversions
          start landing.
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {!loading && pausedRows.length === 0 && (
        <p className="text-sm text-gray-500">No anomalies detected — all archetypes active.</p>
      )}

      {!loading && pausedRows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="pb-2 font-medium">Archetype</th>
                <th className="pb-2 font-medium">Paused Since</th>
                <th className="pb-2 font-medium">Reason</th>
                <th className="pb-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {pausedRows.map((row) => (
                <tr key={`${row.archetype}:${row.variant}`}>
                  <td className="py-2">
                    <span className="font-medium text-gray-800">
                      {formatArchetype(row.archetype)}
                    </span>
                    <span className="ml-2 text-xs text-gray-400">({row.variant})</span>
                  </td>
                  <td className="py-2 text-gray-600">{formatDate(row.updated_at)}</td>
                  <td className="py-2 text-gray-500">{row.pause_reason ?? '—'}</td>
                  <td className="py-2">
                    <button
                      type="button"
                      disabled={resuming.has(row.archetype)}
                      onClick={() => {
                        onResume(row.archetype);
                      }}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                    >
                      {resuming.has(row.archetype) ? 'Resuming…' : 'Resume'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function AnalyticsDashboardPage() {
  // Panel 1 — Summary
  const [summaryState, setSummaryState] = useState<FetchState<SummaryResponse>>({
    loading: true,
    data: null,
    error: null,
  });

  // Panel 2/3/4 — Lift (Panel 2 and Panel 4 are derived from the same fetch)
  const [liftState, setLiftState] = useState<FetchState<LiftResponse>>({
    loading: true,
    data: null,
    error: null,
  });

  // Panel 5 — Anomaly feed (bandit weights)
  const [weightsLoading, setWeightsLoading] = useState(true);
  const [weightsData, setWeightsData] = useState<AbWeightsData | null>(null);
  const [resuming, setResuming] = useState<Set<string>>(new Set());

  // ── Fetch Panel 1 (FOLLOW-453: check res.ok before parsing) ────────────────
  useEffect(() => {
    let cancelled = false;
    setSummaryState({ loading: true, data: null, error: null });

    fetch('/api/dashboard/analytics/summary')
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          // Fail loud: HTTP 500 (or any non-2xx) becomes an error state.
          // Never set data when the server reported a failure.
          let errorMessage = `HTTP ${String(res.status)}`;
          try {
            const body = (await res.json()) as { error?: { message?: string } };
            if (body.error?.message) errorMessage = body.error.message;
          } catch {
            // JSON parse failure — stick with the status string.
          }
          setSummaryState({ loading: false, data: null, error: errorMessage });
          return;
        }
        const raw = (await res.json()) as unknown;
        if (raw && typeof raw === 'object' && 'sessions' in raw) {
          setSummaryState({ loading: false, data: raw as SummaryResponse, error: null });
        } else {
          setSummaryState({ loading: false, data: null, error: null });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Network error';
          setSummaryState({ loading: false, data: null, error: message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // ── Fetch Panel 2/3/4 lift data (FOLLOW-453: check res.ok before parsing) ──
  useEffect(() => {
    let cancelled = false;
    setLiftState({ loading: true, data: null, error: null });

    fetch('/api/dashboard/analytics/lift')
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          let errorMessage = `HTTP ${String(res.status)}`;
          try {
            const body = (await res.json()) as { error?: { message?: string } };
            if (body.error?.message) errorMessage = body.error.message;
          } catch {
            // JSON parse failure — stick with the status string.
          }
          setLiftState({ loading: false, data: null, error: errorMessage });
          return;
        }
        const raw = (await res.json()) as unknown;
        if (raw && typeof raw === 'object' && 'rows' in raw) {
          setLiftState({ loading: false, data: raw as LiftResponse, error: null });
        } else {
          setLiftState({ loading: false, data: null, error: null });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Network error';
          setLiftState({ loading: false, data: null, error: message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // ── Fetch Panel 5 bandit weights ──────────────────────────────────────────
  useEffect(() => {
    setWeightsLoading(true);
    fetch('/api/ab/weights')
      .then((r) => r.json())
      .then((raw: unknown) => {
        if (raw && typeof raw === 'object') {
          const d = raw as Record<string, unknown>;
          const rows = Array.isArray(d.rows) ? (d.rows as BanditRow[]) : [];
          // FOLLOW-637: default to 'paused' (don't imply learning) if the
          // field is unexpectedly absent from the payload.
          const learningState = d.learning_state === 'active' ? 'active' : 'paused';
          setWeightsData({ rows, learning_state: learningState });
        }
      })
      .catch(() => {
        // Panel shows empty state
      })
      .finally(() => {
        setWeightsLoading(false);
      });
  }, []);

  // ── Resume paused archetype ───────────────────────────────────────────────
  function handleResume(archetype: string) {
    setResuming((prev) => new Set([...prev, archetype]));

    // Derive tenant_id from the weights data (rows carry tenant_id from API)
    // The API is tenant-scoped so we POST to the current user's tenant.
    // We read tenant_id from the first row or fall back to re-fetching from /api/ab/weights.
    const tenantId = weightsData?.rows[0]?.['tenant_id' as keyof BanditRow] as string | undefined;
    if (!tenantId) {
      setResuming((prev) => {
        const next = new Set(prev);
        next.delete(archetype);
        return next;
      });
      return;
    }

    fetch(`/api/tenants/${tenantId}/bandit/weights/${archetype}`, { method: 'PATCH' })
      .then((r) => {
        if (r.ok) {
          // Update local state: un-pause matching rows
          setWeightsData((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              rows: prev.rows.map((row) =>
                row.archetype === archetype ? { ...row, paused: false } : row,
              ),
            };
          });
        }
      })
      .catch(() => {
        // Resume failed silently — user can retry
      })
      .finally(() => {
        setResuming((prev) => {
          const next = new Set(prev);
          next.delete(archetype);
          return next;
        });
      });
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">A/B Analytics Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Rolling 7-day window — Thompson sampling bandit performance + conversion lift.
        </p>
      </div>

      <div className="space-y-6">
        {/* Panel 1 — Traffic Summary */}
        <Panel1 state={summaryState} />

        {/* Panel 2 — Archetype Breakdown */}
        <Panel2 state={liftState} />

        {/* Panel 3 — Conversion Lift */}
        <Panel3 state={liftState} />

        {/* Panel 4 — Top Adaptation Types */}
        <Panel4 state={liftState} />

        {/* Panel 5 — Anomaly Feed */}
        <Panel5
          loading={weightsLoading}
          data={weightsData}
          onResume={handleResume}
          resuming={resuming}
        />
      </div>
    </div>
  );
}
