'use client';

/**
 * Pilot dashboard — /dashboard/pilot
 *
 * Four panels displaying adapted vs holdout group performance for the
 * app.estalara.com pilot:
 *
 *   1. SummaryPanel — CTA click rate: adapted sessions vs 10% holdout, absolute
 *      + relative lift, two-proportion z-test p-value, confidence badge.
 *      (TICKET-PILOT-003)
 *   2. InquiryStartsPanel — total inquiry starts, adapted vs holdout rates,
 *      daily trend table, lift % badge (when n ≥ 30).
 *      (TICKET-PILOT-004)
 *   3. FunnelPanel — page.view → listing.viewed → cta.clicked → inquiry.started
 *      → inquiry.completed, per-stage rates in each arm, delta.
 *      (TICKET-PILOT-003)
 *   4. ArchetypePanel — top archetypes by adapted volume with individual CTA lift
 *      and statistical significance.
 *      (TICKET-PILOT-003)
 *
 * Data sources:
 *   GET /api/pilot/cta-lift?window_days=<7|14|30>  (panels 1, 3, 4)
 *   GET /api/pilot/inquiry-starts?window_days=<7|14|30>  (panel 2)
 * A shared window selector controls both endpoints simultaneously.
 *
 * @module apps/control-plane/src/app/dashboard/pilot/page
 */

import { useEffect, useState } from 'react';

// ─── Types (InquiryStartsPanel — TICKET-PILOT-004) ────────────────────────────

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

// ─── Types (CTA lift panels — TICKET-PILOT-003) ───────────────────────────────

type PilotConfidence = '95%' | '90%' | 'not_significant';

interface PilotSummary {
  adapted_sessions: number;
  holdout_sessions: number;
  adapted_cta_rate: number;
  holdout_cta_rate: number;
  absolute_lift: number;
  relative_lift_pct: number | null;
  p_value: number;
  is_significant: boolean;
  confidence: PilotConfidence;
}

interface FunnelRow {
  stage: string;
  adapted_count: number;
  holdout_count: number;
  adapted_rate: number;
  holdout_rate: number;
}

interface ArchetypeRow {
  archetype: string;
  adapted_cta_rate: number;
  holdout_cta_rate: number;
  lift_pct: number | null;
  n_adapted: number;
  n_holdout: number;
  p_value: number;
}

interface CtaLiftResponse {
  window_days: number;
  tenant_id: string;
  summary: PilotSummary;
  funnel: FunnelRow[];
  by_archetype: ArchetypeRow[];
  generated_at: string;
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

/** snake_case / dot.case → Title Case. */
function formatLabel(label: string): string {
  return label
    .split(/[._]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

function signedPct(n: number | null): string {
  if (n === null) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

/** Confidence badge: 🟢 95% / 🟡 90% / ⚪ not significant. */
function ConfidenceBadge({ confidence }: { confidence: PilotConfidence }) {
  if (confidence === '95%') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800">
        <span aria-hidden="true">🟢</span> Significant (p &lt; 0.05)
      </span>
    );
  }
  if (confidence === '90%') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-semibold text-yellow-800">
        <span aria-hidden="true">🟡</span> Trending (p &lt; 0.10)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">
      <span aria-hidden="true">⚪</span> Not significant
    </span>
  );
}

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

// ─── Summary Panel ────────────────────────────────────────────────────────────

function SummaryPanel({ loading, summary }: { loading: boolean; summary: PilotSummary | null }) {
  const kpis = [
    { label: 'Adapted Sessions', value: summary?.adapted_sessions.toLocaleString() ?? '—' },
    { label: 'Holdout Sessions', value: summary?.holdout_sessions.toLocaleString() ?? '—' },
    { label: 'Adapted CTA Rate', value: summary ? pct(summary.adapted_cta_rate) : '—' },
    { label: 'Holdout CTA Rate', value: summary ? pct(summary.holdout_cta_rate) : '—' },
  ];

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">CTA Lift — Adapted vs Holdout</h2>
        {!loading && summary && <ConfidenceBadge confidence={summary.confidence} />}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {kpis.map(({ label, value }) => (
          <div key={label} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            {loading ? (
              <>
                <Skeleton className="mb-2 h-7 w-20" />
                <Skeleton className="h-3 w-24" />
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

      {!loading && summary && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-gray-100 p-3">
            <div className="text-xs text-gray-500">Absolute Lift</div>
            <div
              className={`text-lg font-semibold ${
                summary.absolute_lift >= 0 ? 'text-green-700' : 'text-red-600'
              }`}
            >
              {summary.absolute_lift >= 0 ? '+' : ''}
              {(summary.absolute_lift * 100).toFixed(2)} pp
            </div>
          </div>
          <div className="rounded-lg border border-gray-100 p-3">
            <div className="text-xs text-gray-500">Relative Lift</div>
            <div
              className={`text-lg font-semibold ${
                (summary.relative_lift_pct ?? 0) >= 0 ? 'text-green-700' : 'text-red-600'
              }`}
            >
              {summary.relative_lift_pct === null
                ? 'No holdout conversions yet'
                : signedPct(summary.relative_lift_pct)}
            </div>
          </div>
          <div className="rounded-lg border border-gray-100 p-3">
            <div className="text-xs text-gray-500">p-value (z-test)</div>
            <div className="text-lg font-semibold text-gray-900">{summary.p_value.toFixed(4)}</div>
          </div>
        </div>
      )}

      {!loading && !summary && (
        <p className="mt-4 text-sm text-gray-400">
          No pilot data yet — start adapting listings to see CTA lift here.
        </p>
      )}
    </section>
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

// ─── Funnel table ─────────────────────────────────────────────────────────────

function FunnelPanel({ loading, rows }: { loading: boolean; rows: FunnelRow[] }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold text-gray-700">Conversion Funnel</h2>
      <p className="mb-4 text-xs text-gray-400">
        Unique sessions reaching each stage, as a share of all sessions in each arm.
      </p>

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {!loading && rows.length === 0 && (
        <p className="text-sm text-gray-400">No funnel data yet.</p>
      )}

      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="pb-2 font-medium">Stage</th>
                <th className="pb-2 font-medium">Adapted Rate</th>
                <th className="pb-2 font-medium">Holdout Rate</th>
                <th className="pb-2 font-medium">Delta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((row) => {
                const delta = row.adapted_rate - row.holdout_rate;
                return (
                  <tr key={row.stage}>
                    <td className="py-2 font-medium text-gray-800">{formatLabel(row.stage)}</td>
                    <td className="py-2 text-gray-600">{pct(row.adapted_rate)}</td>
                    <td className="py-2 text-gray-600">{pct(row.holdout_rate)}</td>
                    <td
                      className={`py-2 font-semibold ${
                        delta >= 0 ? 'text-green-700' : 'text-red-600'
                      }`}
                    >
                      {delta >= 0 ? '+' : ''}
                      {(delta * 100).toFixed(2)} pp
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── By-archetype table ───────────────────────────────────────────────────────

function ArchetypePanel({ loading, rows }: { loading: boolean; rows: ArchetypeRow[] }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold text-gray-700">CTA Lift by Archetype</h2>
      <p className="mb-4 text-xs text-gray-400">
        Top archetypes by adapted session volume. Significance requires ≥ 30 sessions per arm.
      </p>

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {!loading && rows.length === 0 && (
        <p className="text-sm text-gray-400">No archetype data yet.</p>
      )}

      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="pb-2 font-medium">Archetype</th>
                <th className="pb-2 font-medium">Adapted CTA%</th>
                <th className="pb-2 font-medium">Holdout CTA%</th>
                <th className="pb-2 font-medium">Lift%</th>
                <th className="pb-2 font-medium">n (adapted)</th>
                <th className="pb-2 font-medium">Significance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((row) => {
                const significant =
                  row.p_value < 0.05 && row.n_adapted >= 30 && row.n_holdout >= 30;
                const trending =
                  !significant && row.p_value < 0.1 && row.n_adapted >= 30 && row.n_holdout >= 30;
                return (
                  <tr key={row.archetype}>
                    <td className="py-2 font-medium text-gray-800">{formatLabel(row.archetype)}</td>
                    <td className="py-2 text-gray-600">{pct(row.adapted_cta_rate)}</td>
                    <td className="py-2 text-gray-600">{pct(row.holdout_cta_rate)}</td>
                    <td
                      className={`py-2 font-semibold ${
                        (row.lift_pct ?? 0) >= 0 ? 'text-green-700' : 'text-red-600'
                      }`}
                    >
                      {signedPct(row.lift_pct)}
                    </td>
                    <td className="py-2 text-gray-600">{row.n_adapted.toLocaleString()}</td>
                    <td className="py-2">
                      {significant ? (
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
                          🟢 p&lt;0.05
                        </span>
                      ) : trending ? (
                        <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-800">
                          🟡 p&lt;0.10
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                          ⚪ n.s.
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

const WINDOW_OPTIONS = [7, 14, 30] as const;

export default function PilotDashboardPage() {
  const [windowDays, setWindowDays] = useState<number>(7);
  const [inquiryLoading, setInquiryLoading] = useState(true);
  const [inquiryData, setInquiryData] = useState<InquiryStartsData | null>(null);
  const [ctaLoading, setCtaLoading] = useState(true);
  const [ctaData, setCtaData] = useState<CtaLiftResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    setInquiryLoading(true);
    setCtaLoading(true);

    fetch(`/api/pilot/inquiry-starts?window_days=${String(windowDays)}`)
      .then((r) => r.json())
      .then((raw: unknown) => {
        if (cancelled) return;
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
            window_days: Number(d.window_days ?? windowDays),
          });
        }
      })
      .catch(() => {
        if (!cancelled) setInquiryData(null);
      })
      .finally(() => {
        if (!cancelled) setInquiryLoading(false);
      });

    fetch(`/api/pilot/cta-lift?window_days=${String(windowDays)}`)
      .then((r) => r.json())
      .then((raw: unknown) => {
        if (cancelled) return;
        if (raw && typeof raw === 'object' && 'summary' in raw) {
          setCtaData(raw as CtaLiftResponse);
        } else {
          setCtaData(null);
        }
      })
      .catch(() => {
        if (!cancelled) setCtaData(null);
      })
      .finally(() => {
        if (!cancelled) setCtaLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [windowDays]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pilot Dashboard — app.estalara.com</h1>
          <p className="mt-1 text-sm text-gray-500">
            Adapted vs holdout group performance. Primary metric: CTA lift. Secondary: inquiry
            starts.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          Window
          <select
            value={windowDays}
            onChange={(e) => {
              setWindowDays(Number(e.target.value));
            }}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800 focus:border-blue-500 focus:outline-none"
          >
            {WINDOW_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-6">
        {/* CTA lift summary — TICKET-PILOT-003 */}
        <SummaryPanel loading={ctaLoading} summary={ctaData?.summary ?? null} />
        {/* Inquiry starts — TICKET-PILOT-004 */}
        <InquiryStartsPanel loading={inquiryLoading} data={inquiryData} />
        {/* Conversion funnel — TICKET-PILOT-003 */}
        <FunnelPanel loading={ctaLoading} rows={ctaData?.funnel ?? []} />
        {/* Lift by archetype — TICKET-PILOT-003 */}
        <ArchetypePanel loading={ctaLoading} rows={ctaData?.by_archetype ?? []} />
      </div>
    </div>
  );
}
