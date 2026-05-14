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
 * @module apps/control-plane/src/app/dashboard/analytics/page
 */

import { useEffect, useState } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface SummaryData {
  sessions: number;
  adapted: number;
  holdout: number;
  p95Latency: number;
  window_days: number;
}

interface ArchetypeBreakdownRow {
  archetype: string;
  count: number;
  pct: number;
}

interface LiftRow {
  archetype: string;
  adaptedRate: number;
  holdoutRate: number;
  adaptedN: number;
  holdoutN: number;
  lift: number;
  pValue: number;
  status: 'significant' | 'trending' | 'not_significant';
}

interface LiftData {
  rows: LiftRow[];
  dqsUnavailable: boolean;
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

// ─── Panel 1 — Traffic Summary ────────────────────────────────────────────────

function Panel1({ loading, data }: { loading: boolean; data: SummaryData | null }) {
  const kpis = [
    { label: 'Tracked Sessions', value: data?.sessions.toLocaleString() ?? '—' },
    { label: 'Adapted Impressions', value: data?.adapted.toLocaleString() ?? '—' },
    { label: 'Holdout Impressions', value: data?.holdout.toLocaleString() ?? '—' },
    { label: 'p95 Adapt Latency', value: data ? `${data.p95Latency.toString()} ms` : '—' },
  ];

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold text-gray-700">
        Traffic Summary — Last {data?.window_days ?? 7} Days
      </h2>
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
    </section>
  );
}

// ─── Panel 2 — Archetype Breakdown ────────────────────────────────────────────

function Panel2({ loading, rows }: { loading: boolean; rows: ArchetypeBreakdownRow[] }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold text-gray-700">
        Buyer Archetype Breakdown — Top 10 (Last 7 Days)
      </h2>

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
                <td className="py-2 font-medium text-gray-800">{formatArchetype(row.archetype)}</td>
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
    </section>
  );
}

// ─── Panel 3 — Conversion Lift ────────────────────────────────────────────────

function Panel3({ loading, data }: { loading: boolean; data: LiftData | null }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold text-gray-700">
        Conversion Lift vs Holdout (Last 7 Days)
      </h2>
      <p className="mb-4 text-xs text-gray-400">
        Primary metric: CTA click rate. Two-proportion z-test, p &lt; 0.05, N ≥ 200 per arm.
      </p>

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}

      {!loading && data?.dqsUnavailable && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Conversion lift data not available — requires DQS integration. Will auto-populate when DQS
          events flow.
        </div>
      )}

      {!loading && !data?.dqsUnavailable && data?.rows.length === 0 && (
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
    </section>
  );
}

// ─── Panel 4 — Top Adaptation Types ──────────────────────────────────────────

/**
 * Panel 4 — top adaptation types.
 * Uses top-5 archetypes by adapted volume as the fallback (directives_json not yet
 * in ClickHouse schema per spec note). Derived from the same lift data rows.
 */
function Panel4({ loading, liftRows }: { loading: boolean; liftRows: LiftRow[] }) {
  const top5 = [...liftRows].sort((a, b) => b.adaptedN - a.adaptedN).slice(0, 5);

  const totalAdapted = top5.reduce((s, r) => s + r.adaptedN, 0);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold text-gray-700">Top Adaptation Types</h2>
      <p className="mb-4 text-xs text-gray-400">
        Showing top 5 archetypes by adapted session volume (directive breakdown requires
        directives_json column — not yet stored).
      </p>

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
                <span className="w-4 text-right text-xs font-bold text-gray-400">{idx + 1}</span>
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

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold text-gray-700">Anomaly Feed</h2>
      <p className="mb-4 text-xs text-gray-400">
        Archetypes auto-paused by regression detection (p &lt; 0.05, ≥ 200 sessions per arm).
      </p>

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
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryData, setSummaryData] = useState<SummaryData | null>(null);

  // Panel 2 — Archetype breakdown (derived from ab/weights)
  const [archetypeRows, setArchetypeRows] = useState<ArchetypeBreakdownRow[]>([]);

  // Panel 3 — Lift
  const [liftLoading, setLiftLoading] = useState(true);
  const [liftData, setLiftData] = useState<LiftData | null>(null);

  // Panel 5 — Anomaly feed (bandit weights)
  const [weightsLoading, setWeightsLoading] = useState(true);
  const [weightsData, setWeightsData] = useState<AbWeightsData | null>(null);
  const [resuming, setResuming] = useState<Set<string>>(new Set());

  // ── Fetch Panel 1 ────────────────────────────────────────────────────────
  useEffect(() => {
    setSummaryLoading(true);
    fetch('/api/dashboard/analytics/summary')
      .then((r) => r.json())
      .then((raw: unknown) => {
        if (raw && typeof raw === 'object') {
          const d = raw as Record<string, unknown>;
          setSummaryData({
            sessions: Number(d.sessions ?? 0),
            adapted: Number(d.adapted ?? 0),
            holdout: Number(d.holdout ?? 0),
            p95Latency: Number(d.p95Latency ?? 0),
            window_days: Number(d.window_days ?? 7),
          });
        }
      })
      .catch(() => {
        // Panel shows null / empty state
      })
      .finally(() => {
        setSummaryLoading(false);
      });
  }, []);

  // ── Fetch Panel 3 lift data ───────────────────────────────────────────────
  useEffect(() => {
    setLiftLoading(true);
    fetch('/api/dashboard/analytics/lift')
      .then((r) => r.json())
      .then((raw: unknown) => {
        if (raw && typeof raw === 'object') {
          const d = raw as Record<string, unknown>;
          const rows = Array.isArray(d.rows) ? (d.rows as LiftRow[]) : [];
          setLiftData({
            rows,
            dqsUnavailable: Boolean(d.dqsUnavailable),
          });
          // Derive Panel 2 from lift rows (archetype + adaptedN as count proxy)
          const total = rows.reduce((s, r) => s + r.adaptedN + r.holdoutN, 0);
          const breakdownRows: ArchetypeBreakdownRow[] = rows
            .map((r) => ({
              archetype: r.archetype,
              count: r.adaptedN + r.holdoutN,
              pct: total > 0 ? ((r.adaptedN + r.holdoutN) / total) * 100 : 0,
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);
          setArchetypeRows(breakdownRows);
        }
      })
      .catch(() => {
        // Panels show empty state
      })
      .finally(() => {
        setLiftLoading(false);
      });
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
          setWeightsData({ rows });
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
        <Panel1 loading={summaryLoading} data={summaryData} />

        {/* Panel 2 — Archetype Breakdown */}
        <Panel2 loading={liftLoading} rows={archetypeRows} />

        {/* Panel 3 — Conversion Lift */}
        <Panel3 loading={liftLoading} data={liftData} />

        {/* Panel 4 — Top Adaptation Types */}
        <Panel4 loading={liftLoading} liftRows={liftData?.rows ?? []} />

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
