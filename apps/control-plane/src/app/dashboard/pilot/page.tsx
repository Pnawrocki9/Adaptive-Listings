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
 * FOLLOW-122: Honest rendering — surfaces data_source badge and HTTP 500 errors.
 *
 * @module apps/control-plane/src/app/dashboard/pilot/page
 */

import { useEffect, useState } from 'react';

// ─── Canonical types from route modules (FOLLOW-122) ─────────────────────────
// Import canonical response types from route-helpers to avoid local duplicate
// interface drift (the root cause tracked by FOLLOW-122).

import type { CtaLiftResponse } from '../../api/pilot/cta-lift/route-helpers';
import type {
  InquiryStartsResponse,
  DailyBreakdownRow,
} from '../../api/pilot/inquiry-starts/route-helpers';

// Re-export the PilotConfidence type for use in sub-components without re-importing.
type PilotConfidence = 'not_significant' | '90%' | '95%';

// ─── Local state types (FOLLOW-122) ──────────────────────────────────────────

/**
 * Wrapper that tracks the HTTP-level outcome of a fetch alongside the parsed
 * payload.  A non-2xx response sets `error` and leaves `data` undefined so
 * callers can distinguish "server error" from "no data yet".
 */
interface FetchState<T> {
  loading: boolean;
  /** Populated when res.ok was true and the payload parsed successfully. */
  data: T | null;
  /** Populated when res.ok was false (e.g. HTTP 500). */
  error: string | null;
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

// ─── Shared UI primitives ─────────────────────────────────────────────────────

/** Confidence badge: 95% / 90% / not significant. */
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

/** Lift badge — shown on InquiryStartsPanel. */
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

/** KPI card — a single labelled metric tile. */
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

/**
 * Error banner — shown when an API call returns non-2xx (FOLLOW-122).
 *
 * Rendered in place of metric numbers so the operator cannot mistake a
 * 500 response for real data.
 */
function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      aria-label="ClickHouse unavailable"
      className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
    >
      <strong>ClickHouse unavailable — data invalid.</strong>{' '}
      <span className="text-red-700">{message}</span>
    </div>
  );
}

/**
 * Mock-data badge — shown when data_source is not 'clickhouse' (FOLLOW-122).
 *
 * Gives the operator an unambiguous signal that numbers are synthetic.
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

// ─── Summary Panel ────────────────────────────────────────────────────────────

function SummaryPanel({ state }: { state: FetchState<CtaLiftResponse> }) {
  const { loading, data, error } = state;
  const summary = data?.summary ?? null;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">CTA Lift — Adapted vs Holdout</h2>
        <div className="flex items-center gap-2">
          {!loading && data?.data_source !== 'clickhouse' && <MockDataBadge />}
          {!loading && summary && <ConfidenceBadge confidence={summary.confidence} />}
        </div>
      </div>

      {!loading && error && <ErrorBanner message={error} />}

      {!error && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              {
                label: 'Adapted Sessions',
                value: summary?.adapted_sessions.toLocaleString() ?? '—',
              },
              {
                label: 'Holdout Sessions',
                value: summary?.holdout_sessions.toLocaleString() ?? '—',
              },
              { label: 'Adapted CTA Rate', value: summary ? pct(summary.adapted_cta_rate) : '—' },
              { label: 'Holdout CTA Rate', value: summary ? pct(summary.holdout_cta_rate) : '—' },
            ].map(({ label, value }) => (
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
                <div className="text-lg font-semibold text-gray-900">
                  {summary.p_value.toFixed(4)}
                </div>
              </div>
            </div>
          )}

          {!loading && !summary && (
            <p className="mt-4 text-sm text-gray-400">
              No pilot data yet — start adapting listings to see CTA lift here.
            </p>
          )}
        </>
      )}
    </section>
  );
}

// ─── Inquiry Starts Panel ─────────────────────────────────────────────────────

function InquiryStartsPanel({ state }: { state: FetchState<InquiryStartsResponse> }) {
  const { loading, data, error } = state;

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
        <div className="flex items-center gap-2">
          {!loading && data?.data_source !== 'clickhouse' && <MockDataBadge />}
          {!loading && data && <LiftBadge liftPct={data.lift_pct} />}
        </div>
      </div>

      {!loading && error && <ErrorBanner message={error} />}

      {!error && (
        <>
          {/* KPI row */}
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[
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
            ].map(({ label, value }) => (
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
                    {data.daily_breakdown.map((row: DailyBreakdownRow) => (
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
        </>
      )}
    </section>
  );
}

// ─── Funnel table ─────────────────────────────────────────────────────────────

function FunnelPanel({ state }: { state: FetchState<CtaLiftResponse> }) {
  const { loading, data, error } = state;
  const rows = data?.funnel ?? [];

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold text-gray-700">Conversion Funnel</h2>
      <p className="mb-4 text-xs text-gray-400">
        Unique sessions reaching each stage, as a share of all sessions in each arm.
      </p>

      {!loading && error && <ErrorBanner message={error} />}

      {!error && (
        <>
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
        </>
      )}
    </section>
  );
}

// ─── By-archetype table ───────────────────────────────────────────────────────

function ArchetypePanel({ state }: { state: FetchState<CtaLiftResponse> }) {
  const { loading, data, error } = state;
  const rows = data?.by_archetype ?? [];

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold text-gray-700">CTA Lift by Archetype</h2>
      <p className="mb-4 text-xs text-gray-400">
        Top archetypes by adapted session volume. Significance requires ≥ 30 sessions per arm.
      </p>

      {!loading && error && <ErrorBanner message={error} />}

      {!error && (
        <>
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
                      !significant &&
                      row.p_value < 0.1 &&
                      row.n_adapted >= 30 &&
                      row.n_holdout >= 30;
                    return (
                      <tr key={row.archetype}>
                        <td className="py-2 font-medium text-gray-800">
                          {formatLabel(row.archetype)}
                        </td>
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
        </>
      )}
    </section>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

const WINDOW_OPTIONS = [7, 14, 30] as const;

export default function PilotDashboardPage() {
  const [windowDays, setWindowDays] = useState<number>(7);

  const [ctaState, setCtaState] = useState<FetchState<CtaLiftResponse>>({
    loading: true,
    data: null,
    error: null,
  });

  const [inquiryState, setInquiryState] = useState<FetchState<InquiryStartsResponse>>({
    loading: true,
    data: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    setCtaState({ loading: true, data: null, error: null });
    setInquiryState({ loading: true, data: null, error: null });

    // ── cta-lift fetch (FOLLOW-122: check res.ok before parsing) ──────────
    fetch(`/api/pilot/cta-lift?window_days=${String(windowDays)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          // Fail loud: HTTP 500 (or any non-2xx) becomes an error state.
          // Never set data when the server reported a failure (FOLLOW-122 AC-b).
          let errorMessage = `HTTP ${String(res.status)}`;
          try {
            const body = (await res.json()) as { error?: { message?: string } };
            if (body.error?.message) errorMessage = body.error.message;
          } catch {
            // JSON parse failure — stick with the status string.
          }
          setCtaState({ loading: false, data: null, error: errorMessage });
          return;
        }
        const raw = (await res.json()) as unknown;
        if (raw && typeof raw === 'object' && 'summary' in raw) {
          setCtaState({ loading: false, data: raw as CtaLiftResponse, error: null });
        } else {
          setCtaState({ loading: false, data: null, error: null });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Network error';
          setCtaState({ loading: false, data: null, error: message });
        }
      });

    // ── inquiry-starts fetch (FOLLOW-122: check res.ok before parsing) ────
    fetch(`/api/pilot/inquiry-starts?window_days=${String(windowDays)}`)
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
          setInquiryState({ loading: false, data: null, error: errorMessage });
          return;
        }
        const raw = (await res.json()) as unknown;
        if (raw && typeof raw === 'object' && 'total_inquiry_starts' in raw) {
          setInquiryState({
            loading: false,
            data: raw as InquiryStartsResponse,
            error: null,
          });
        } else {
          setInquiryState({ loading: false, data: null, error: null });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Network error';
          setInquiryState({ loading: false, data: null, error: message });
        }
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
        <SummaryPanel state={ctaState} />
        {/* Inquiry starts — TICKET-PILOT-004 */}
        <InquiryStartsPanel state={inquiryState} />
        {/* Conversion funnel — TICKET-PILOT-003 */}
        <FunnelPanel state={ctaState} />
        {/* Lift by archetype — TICKET-PILOT-003 */}
        <ArchetypePanel state={ctaState} />
      </div>
    </div>
  );
}
