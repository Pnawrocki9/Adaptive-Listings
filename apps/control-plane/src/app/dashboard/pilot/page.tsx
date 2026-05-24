'use client';

/**
 * Pilot dashboard — /dashboard/pilot
 *
 * Panels:
 *   Inquiry Starts Panel — total inquiry starts, adapted vs holdout rates,
 *                          daily trend table, lift % badge (when n >= 30).
 *
 * TICKET-PILOT-004: Inquiry starts panel (this file).
 * TICKET-PILOT-003: CTA lift panel will be added to this page.
 *
 * @module apps/control-plane/src/app/dashboard/pilot/page
 */

import { useEffect, useState } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface DailyBreakdownRow {
  date: string;
  adapted: number;
  holdout: number;
}

interface InquiryStartsData {
  total_inquiry_starts: number;
  adapted_count: number;
  holdout_count: number;
  adapted_rate: number;
  holdout_rate: number;
  lift_pct: number | null;
  daily_breakdown: DailyBreakdownRow[];
  window_days: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format a rate as a percentage string, e.g. 0.0312 → "3.12%". */
function fmtRate(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

/** Format ISO date string to short locale date, e.g. "2026-05-24" → "May 24". */
function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 ${className ?? ''}`} />;
}

// ─── Lift badge ───────────────────────────────────────────────────────────────

function LiftBadge({ liftPct }: { liftPct: number | null }) {
  if (liftPct === null) {
    return (
      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
        Insufficient data (n &lt; 30)
      </span>
    );
  }
  const isPositive = liftPct >= 0;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
        isPositive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'
      }`}
    >
      {isPositive ? '+' : ''}
      {liftPct.toFixed(1)}% lift
    </span>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
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
  );
}

// ─── Inquiry Starts Panel ─────────────────────────────────────────────────────

function InquiryStartsPanel({
  loading,
  data,
}: {
  loading: boolean;
  data: InquiryStartsData | null;
}) {
  const kpis = [
    {
      label: `Total Inquiry Starts (Last ${String(data?.window_days ?? 30)}d)`,
      value: data?.total_inquiry_starts.toLocaleString() ?? '—',
    },
    {
      label: 'Adapted Rate',
      value: data ? fmtRate(data.adapted_rate) : '—',
    },
    {
      label: 'Holdout Rate',
      value: data ? fmtRate(data.holdout_rate) : '—',
    },
  ];

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">Inquiry Starts — Pilot Metric</h2>
          <p className="mt-0.5 text-xs text-gray-400">
            Secondary pilot metric. Triggered when a visitor clicks the inquiry form submit button.
            Lift % shown when n &ge; 30 per group.
          </p>
        </div>
        {!loading && data && <LiftBadge liftPct={data.lift_pct} />}
      </div>

      {/* KPI row */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {kpis.map(({ label, value }) => (
          <KpiCard key={label} label={label} value={value} loading={loading} />
        ))}
      </div>

      {/* Daily breakdown table */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Daily Trend
        </h3>

        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        )}

        {!loading && (!data || data.daily_breakdown.length === 0) && (
          <p className="text-sm text-gray-400">
            No data yet — inquiry starts will appear here once events are flowing.
          </p>
        )}

        {!loading && data && data.daily_breakdown.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium">Adapted</th>
                  <th className="pb-2 font-medium">Holdout</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.daily_breakdown.map((row) => (
                  <tr key={row.date}>
                    <td className="py-2 text-gray-700">{fmtDate(row.date)}</td>
                    <td className="py-2 tabular-nums text-gray-800">{row.adapted}</td>
                    <td className="py-2 tabular-nums text-gray-600">{row.holdout}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function PilotDashboardPage() {
  const [inquiryLoading, setInquiryLoading] = useState(true);
  const [inquiryData, setInquiryData] = useState<InquiryStartsData | null>(null);

  useEffect(() => {
    setInquiryLoading(true);
    fetch('/api/pilot/inquiry-starts?window_days=30')
      .then((r) => r.json())
      .then((raw: unknown) => {
        if (raw && typeof raw === 'object') {
          const d = raw as Record<string, unknown>;
          setInquiryData({
            total_inquiry_starts: Number(d.total_inquiry_starts ?? 0),
            adapted_count: Number(d.adapted_count ?? 0),
            holdout_count: Number(d.holdout_count ?? 0),
            adapted_rate: Number(d.adapted_rate ?? 0),
            holdout_rate: Number(d.holdout_rate ?? 0),
            lift_pct: d.lift_pct !== null && d.lift_pct !== undefined ? Number(d.lift_pct) : null,
            daily_breakdown: Array.isArray(d.daily_breakdown)
              ? (d.daily_breakdown as DailyBreakdownRow[])
              : [],
            window_days: Number(d.window_days ?? 30),
          });
        }
      })
      .catch(() => {
        // Panel shows empty state
      })
      .finally(() => {
        setInquiryLoading(false);
      });
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Pilot Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          app.estalara.com pilot metrics — adapted vs holdout group performance.
        </p>
      </div>

      <div className="space-y-6">
        {/* Inquiry Starts Panel — TICKET-PILOT-004 */}
        <InquiryStartsPanel loading={inquiryLoading} data={inquiryData} />

        {/* CTA Lift Panel — TICKET-PILOT-003 will add a panel here */}
      </div>
    </div>
  );
}
