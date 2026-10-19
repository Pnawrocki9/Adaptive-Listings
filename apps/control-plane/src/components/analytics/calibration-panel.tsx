'use client';

/**
 * CalibrationSection — the "Calibration + Conversion Aggregates" panel (FOLLOW-173/FOLLOW-174):
 * conversion rate per (outcome_class, model_version) and the score-vs-actual reliability curve,
 * read from `GET /api/pilot/calibration`.
 *
 * Mounted by `/admin/tenants/[id]/labels` (Estalara staff, tenant from the URL — FOLLOW-1334; this
 * is the panel `labels-editor.tsx` used to list as "not ported to staff"; the agency
 * `/dashboard/analytics/labels` page that also mounted it was deleted by FOLLOW-1335). ADR-0018 §1:
 * the section takes `tenantId` as a PROP and sends `&tenant_id=<id>` (the route opts into
 * `resolveTenantAccess` with `allowStaffOverride`).
 *
 * Rule K.2 — fail loud: a non-2xx response renders a visible error banner, never zeros; a
 * non-ClickHouse `data_source` renders an observable "MOCK DATA" badge.
 *
 * Canonical types imported from route-helpers — never redeclared inline.
 *
 * @module apps/control-plane/src/components/analytics/calibration-panel
 */

import { useEffect, useState } from 'react';

import type {
  CalibrationResponse,
  CalibrationRow,
  ConversionAggRow,
} from '@/app/api/pilot/calibration/route-helpers';

// ─── Shared UI primitives ─────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-200 ${className ?? ''}`} />;
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
    >
      <strong>Data unavailable.</strong> <span className="text-red-700">{message}</span>
    </div>
  );
}

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

function OutcomeClassBadge({ cls }: { cls: string }) {
  const colours: Record<string, string> = {
    viewing_booked: 'bg-blue-100 text-blue-800',
    offer_made: 'bg-indigo-100 text-indigo-800',
    contract_signed: 'bg-purple-100 text-purple-800',
    purchased: 'bg-green-100 text-green-800',
    lost: 'bg-red-100 text-red-700',
    no_response: 'bg-gray-100 text-gray-600',
  };
  const colour = colours[cls] ?? 'bg-gray-100 text-gray-600';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${colour}`}
    >
      {cls.replace(/_/g, ' ')}
    </span>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

interface CalibrationPanelProps {
  loading: boolean;
  data: CalibrationResponse | null;
  error: string | null;
  windowDays: number;
  onWindowChange: (d: number) => void;
}

const WINDOW_OPTIONS = [7, 14, 30] as const;

function CalibrationPanel({
  loading,
  data,
  error,
  windowDays,
  onWindowChange,
}: CalibrationPanelProps) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">
            Calibration + Conversion Aggregates
          </h2>
          <p className="mt-0.5 text-xs text-gray-400">
            Score-vs-actual reliability curve and per-outcome-class conversion rates by model
            version (FOLLOW-173).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!loading && data?.data_source !== 'clickhouse' && <MockDataBadge />}
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            Window
            <select
              value={windowDays}
              onChange={(e) => {
                onWindowChange(Number(e.target.value));
              }}
              className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800 focus:outline-none"
            >
              {WINDOW_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d}d
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {!loading && error && <ErrorBanner message={error} />}

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Conversion aggregates sub-panel */}
          {(data?.conversion_aggregates.length ?? 0) > 0 && (
            <div className="mb-6">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Conversion Aggregates
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                      <th className="pb-2 font-medium">Outcome Class</th>
                      <th className="pb-2 font-medium">Model Version</th>
                      <th className="pb-2 font-medium">Count</th>
                      <th className="pb-2 font-medium">Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(data?.conversion_aggregates ?? []).map((row: ConversionAggRow) => (
                      <tr key={`${row.model_version}::${row.outcome_class}`}>
                        <td className="py-2">
                          <OutcomeClassBadge cls={row.outcome_class} />
                        </td>
                        <td className="py-2 text-xs text-gray-500">{row.model_version}</td>
                        <td className="py-2 tabular-nums text-gray-700">
                          {row.count.toLocaleString()}
                        </td>
                        <td className="py-2 tabular-nums text-gray-700">
                          {row.rate !== null ? (row.rate * 100).toFixed(1) + '%' : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Reliability curve sub-panel */}
          {(data?.calibration.length ?? 0) > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Reliability Curve (score vs actual)
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                      <th className="pb-2 font-medium">Decile</th>
                      <th className="pb-2 font-medium">Predicted Rate</th>
                      <th className="pb-2 font-medium">Actual Rate</th>
                      <th className="pb-2 font-medium">Sample n</th>
                      <th className="pb-2 font-medium">Model</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(data?.calibration ?? []).map((row: CalibrationRow) => {
                      const gap = Math.abs(row.predicted_rate - row.actual_conversion_rate);
                      const wellCalibrated = gap < 0.1;
                      return (
                        <tr key={`${row.model_version}::${String(row.confidence_decile)}`}>
                          <td className="py-2 tabular-nums text-gray-700">
                            {(row.confidence_decile * 100).toFixed(0)}–
                            {(row.confidence_decile * 100 + 10).toFixed(0)}%
                          </td>
                          <td className="py-2 tabular-nums text-gray-600">
                            {(row.predicted_rate * 100).toFixed(1)}%
                          </td>
                          <td
                            className={`py-2 tabular-nums font-semibold ${
                              wellCalibrated ? 'text-green-700' : 'text-amber-700'
                            }`}
                          >
                            {(row.actual_conversion_rate * 100).toFixed(1)}%
                          </td>
                          <td className="py-2 tabular-nums text-gray-500">{row.sample_size}</td>
                          <td className="py-2 text-xs text-gray-400">{row.model_version}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(data?.calibration.length ?? 0) === 0 &&
            (data?.conversion_aggregates.length ?? 0) === 0 && (
              <p className="text-sm text-gray-400">
                No calibration data yet — labels and adaptation decisions will appear here once data
                flows.
              </p>
            )}
        </>
      )}
    </section>
  );
}

// ─── Section — owns the window selector and the fetch ─────────────────────────

interface CalibrationSectionProps {
  /** The tenant to read (sent as `&tenant_id=`). Absent → no `tenant_id` is sent, which the staff-only route answers 400 since FOLLOW-1335. */
  tenantId?: string;
}

export function CalibrationSection({ tenantId }: CalibrationSectionProps = {}) {
  const [windowDays, setWindowDays] = useState<number>(7);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CalibrationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tenantQuery = tenantId ? `&tenant_id=${encodeURIComponent(tenantId)}` : '';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/pilot/calibration?window_days=${String(windowDays)}${tenantQuery}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          let msg = `HTTP ${String(res.status)}`;
          try {
            const body = (await res.json()) as {
              error?: { message?: string };
            };
            if (body.error?.message) msg = body.error.message;
          } catch {
            // keep status string
          }
          setError(msg);
          setLoading(false);
          return;
        }
        const raw = (await res.json()) as unknown;
        if (raw && typeof raw === 'object' && 'calibration' in raw) {
          setData(raw as CalibrationResponse);
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Network error');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [windowDays, tenantQuery]);

  return (
    <CalibrationPanel
      loading={loading}
      data={data}
      error={error}
      windowDays={windowDays}
      onWindowChange={setWindowDays}
    />
  );
}
