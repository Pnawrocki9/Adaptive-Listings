'use client';

/**
 * History panel of the Pilot tab (FOLLOW-1338, ruling D-K): the newest 90 rows of
 * `lift_daily_snapshots`, written daily by `api/cron/lift-snapshot`, read through
 * `GET /api/dashboard/analytics/lift/history`.
 *
 * Honest states (Rule K.2): a failed read is an error banner (never an empty table); an empty table
 * says so, and says the table is filled by the daily job; `data_source: 'not_configured'` is its
 * own message. Staff only - the parent mounts it only when it has a `tenantId`.
 *
 * @module apps/control-plane/src/components/analytics/lift-history-panel
 */

import { useEffect, useState } from 'react';
import type { LiftHistoryResponse } from '@/lib/lift-snapshots';

interface State {
  loading: boolean;
  data: LiftHistoryResponse | null;
  /** `code: message` of a non-2xx answer, or the network error. */
  error: string | null;
}

function fmtLift(v: number | null): string {
  return v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function fmtComputed(iso: string): string {
  return iso.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

export function LiftHistoryPanel({ tenantId }: { tenantId: string }) {
  const [state, setState] = useState<State>({ loading: true, data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, data: null, error: null });
    fetch(`/api/dashboard/analytics/lift/history?tenant_id=${encodeURIComponent(tenantId)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          let message = `HTTP ${String(res.status)}`;
          try {
            const body = (await res.json()) as { error?: { code?: string; message?: string } };
            if (body.error?.code) {
              message = `${body.error.code}${body.error.message ? `: ${body.error.message}` : ''}`;
            }
          } catch {
            // Not JSON - keep the status string.
          }
          setState({ loading: false, data: null, error: message });
          return;
        }
        setState({ loading: false, data: (await res.json()) as LiftHistoryResponse, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            loading: false,
            data: null,
            error: err instanceof Error ? err.message : 'Network error',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const { loading, data, error } = state;
  const rows = data?.rows ?? [];

  return (
    <section
      aria-label="Lift history"
      className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
    >
      <h2 className="mb-1 text-sm font-semibold text-gray-700">History — daily snapshots</h2>
      <p className="mb-4 text-xs text-gray-400">
        One row per UTC day and arm, written by the daily snapshot job (last 90 days). Independent
        of the window above.
      </p>

      {loading && <p className="text-sm text-gray-400">Loading history…</p>}

      {!loading && error && (
        <div
          role="alert"
          aria-label="History unavailable"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <strong>History unavailable.</strong> <span className="text-red-700">{error}</span>
        </div>
      )}

      {!loading && !error && data?.data_source === 'not_configured' && (
        <p className="text-sm text-gray-500">
          The snapshot store is not configured on this deployment (no admin database URL).
        </p>
      )}

      {!loading && !error && data?.data_source === 'postgres' && rows.length === 0 && (
        <p className="text-sm text-gray-400">
          No snapshots yet — the first row appears after the daily job has run for a day with
          traffic.
        </p>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="pb-2 font-medium">Day (UTC)</th>
                <th className="pb-2 font-medium">Arm</th>
                <th className="pb-2 font-medium">Sessions</th>
                <th className="pb-2 font-medium">Conversions</th>
                <th className="pb-2 font-medium">LIVE signups</th>
                <th className="pb-2 font-medium">Agent contacts</th>
                <th className="pb-2 font-medium">Lift</th>
                <th className="pb-2 font-medium">p-value</th>
                <th className="pb-2 font-medium">Confidence</th>
                <th className="pb-2 font-medium">Computed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((r) => (
                <tr key={`${r.day}-${r.arm}`}>
                  <td className="py-2 text-gray-700">{r.day}</td>
                  <td className="py-2 text-gray-700">{r.arm}</td>
                  <td className="py-2 tabular-nums text-gray-800">{r.sessions.toLocaleString()}</td>
                  <td className="py-2 tabular-nums text-gray-800">{r.conversions}</td>
                  <td className="py-2 tabular-nums text-gray-600">{r.live_signups}</td>
                  <td className="py-2 tabular-nums text-gray-600">{r.agent_contacts}</td>
                  <td className="py-2 tabular-nums text-gray-800">
                    {fmtLift(r.relative_lift_pct)}
                  </td>
                  <td className="py-2 tabular-nums text-gray-600">{r.p_value.toFixed(4)}</td>
                  <td className="py-2 text-gray-600">{r.confidence}</td>
                  <td className="py-2 text-xs text-gray-400">{fmtComputed(r.computed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
