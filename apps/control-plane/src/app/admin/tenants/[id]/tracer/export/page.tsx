'use client';

/**
 * K.3.6.4 — Export Dashboard
 *
 * Consumes:
 *   GET  /api/admin/tracer/export/decisions  (CSV or JSONL)
 *   GET  /api/admin/tracer/export/events     (JSONL with full event_payload)
 *
 * Rule K.2: if ClickHouse is not configured, the API returns 503. We surface that
 * as a visible error banner — never silently hide the unavailability.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/tracer/export/page
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExportPageProps {
  params: Promise<{ id: string }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAdminToken(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('estalara_admin_token') ?? '';
}

/** ISO 8601 string for `now - days`. */
function isoAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DownloadCard({
  title,
  description,
  tenantId,
  from,
  to,
  format,
  endpoint,
}: {
  title: string;
  description: string;
  tenantId: string;
  from: string;
  to: string;
  format: 'csv' | 'jsonl';
  endpoint: 'decisions' | 'events';
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleDownload = async () => {
    setStatus('loading');
    setErrorMsg(null);
    try {
      const token = getAdminToken();
      const url = new URL(`/api/admin/tracer/export/${endpoint}`, window.location.origin);
      url.searchParams.set('tenant_id', tenantId);
      url.searchParams.set('from', from);
      url.searchParams.set('to', to);

      const res = await fetch(url.toString(), {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(format === 'csv' ? { Accept: 'text/csv' } : {}),
        },
      });

      // Rule K.2: 503 (ClickHouse unconfigured) or 500 (error) → visible error.
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: { message?: string; code?: string };
          data_source?: string;
        };
        const msg = json.error?.message ?? json.error?.code ?? `HTTP ${res.status.toString()}`;
        const src = json.data_source ? ` (data_source: ${json.data_source})` : '';
        setErrorMsg(`Export unavailable: ${msg}${src}`);
        setStatus('error');
        return;
      }

      // Trigger browser download
      const blob = await res.blob();
      const ext = format === 'csv' ? 'csv' : 'ndjson';
      const filename = `tracer-${endpoint}-${tenantId.slice(0, 8)}-${from.replace('T', '_')}-${to.replace('T', '_')}.${ext}`;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      setStatus('idle');
    } catch (err) {
      setErrorMsg(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
      setStatus('error');
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="mb-1 text-sm font-semibold text-gray-900">{title}</h3>
      <p className="mb-3 text-xs text-gray-500">{description}</p>
      <div className="mb-3 flex gap-2 text-xs text-gray-400">
        <span>from: {from || '—'}</span>
        <span>to: {to || '—'}</span>
        <span>format: {format.toUpperCase()}</span>
      </div>
      {errorMsg && (
        <div className="mb-3 rounded bg-red-50 p-2 text-xs text-red-700">
          <strong>Error:</strong> {errorMsg}
        </div>
      )}
      <button
        onClick={() => void handleDownload()}
        disabled={status === 'loading' || !from || !to}
        className="rounded-lg bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
      >
        {status === 'loading' ? 'Preparing…' : `Download ${format.toUpperCase()}`}
      </button>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ExportDashboardPage({ params }: ExportPageProps) {
  const [tenantId, setTenantId] = useState('');
  const [from, setFrom] = useState(isoAgo(7));
  const [to, setTo] = useState(isoAgo(0));

  useEffect(() => {
    void params.then(({ id }) => {
      setTenantId(id);
    });
  }, [params]);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Export Dashboard</h2>
          <p className="mt-1 text-sm text-gray-500">
            K.3.6.4 — Download intent event data from ClickHouse. Tenant:{' '}
            <span className="font-mono text-xs">{tenantId}</span>
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href={`/admin/tenants/${tenantId}/tracer`}
            className="text-sm text-blue-600 underline hover:text-blue-800"
          >
            Live Monitor
          </Link>
          <Link
            href={`/admin/tenants/${tenantId}/tracer/history`}
            className="text-sm text-blue-600 underline hover:text-blue-800"
          >
            Session History
          </Link>
        </div>
      </div>

      {/* Date range picker */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
          Date range
        </p>
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="mb-1 block text-xs text-gray-500">From</label>
            <input
              type="datetime-local"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
              }}
              className="rounded border border-gray-200 px-2 py-1 text-xs"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">To</label>
            <input
              type="datetime-local"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
              }}
              className="rounded border border-gray-200 px-2 py-1 text-xs"
            />
          </div>
        </div>
        <div className="mt-3 flex gap-2 text-xs">
          {[
            { label: 'Last 24h', days: 1 },
            { label: 'Last 7d', days: 7 },
            { label: 'Last 30d', days: 30 },
          ].map(({ label, days }) => (
            <button
              key={days}
              onClick={() => {
                setFrom(isoAgo(days));
                setTo(isoAgo(0));
              }}
              className="rounded border border-gray-200 px-2 py-0.5 text-gray-600 hover:bg-gray-50"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Download cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DownloadCard
          title="Decisions — CSV"
          description="intent_events rows (without full event_payload). Suitable for spreadsheet analysis."
          tenantId={tenantId}
          from={from}
          to={to}
          format="csv"
          endpoint="decisions"
        />
        <DownloadCard
          title="Decisions — JSONL"
          description="intent_events rows in NDJSON format (without full event_payload)."
          tenantId={tenantId}
          from={from}
          to={to}
          format="jsonl"
          endpoint="decisions"
        />
        <DownloadCard
          title="Events — JSONL (full payload)"
          description="intent_events with full event_payload JSON column. Use for ML pipeline input."
          tenantId={tenantId}
          from={from}
          to={to}
          format="jsonl"
          endpoint="events"
        />
      </div>

      <div className="mt-6 rounded-lg border border-gray-100 bg-gray-50 p-4 text-xs text-gray-500">
        <strong>Note:</strong> Export requires ClickHouse to be configured. If the download button
        shows an error, verify that <code>CLICKHOUSE_URL</code> and <code>CLICKHOUSE_PASSWORD</code>{' '}
        are set in Doppler for this environment. Exports include only events within the selected
        date range for this tenant.
      </div>
    </div>
  );
}
