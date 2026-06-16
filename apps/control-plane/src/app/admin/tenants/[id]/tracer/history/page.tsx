'use client';

/**
 * K.3.6.2 — Session History
 *
 * Consumes:
 *   GET  /api/admin/tracer/history          (paginated event list, filterable)
 *   GET  /api/admin/tracer/history/[id]     (session replay)
 *
 * Rule K.2: non-2xx or data_source:'error' → visible error banner; never zero-fill.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/tracer/history/page
 */

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import type {
  TracerHistoryResponse,
  TracerSessionReplayResponse,
  IntentEventRow,
} from '@estalara/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

interface HistoryPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    session_id?: string;
    from?: string;
    to?: string;
    archetype?: string;
    page?: string;
  }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAdminToken(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('estalara_admin_token') ?? '';
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function pct(v: number): string {
  return `${Math.round(v * 100).toString()}%`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DataSourceBadge({ source }: { source: string }) {
  const color =
    source === 'live'
      ? 'bg-green-100 text-green-800'
      : source === 'mock'
        ? 'bg-yellow-100 text-yellow-800'
        : 'bg-red-100 text-red-800';
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${color}`}>
      data_source: {source}
    </span>
  );
}

function EventRow({ ev }: { ev: IntentEventRow }) {
  const [expanded, setExpanded] = useState(false);
  const toggle = () => {
    setExpanded((v) => !v);
  };
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-2 text-xs text-gray-500">{fmtTime(ev.event_at)}</td>
      <td className="px-4 py-2 font-mono text-xs text-gray-700">{ev.session_id.slice(0, 12)}…</td>
      <td className="px-4 py-2 text-xs">{ev.event_type}</td>
      <td className="px-4 py-2 text-xs">
        <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-800">
          {ev.top_archetype}
        </span>
      </td>
      <td className="px-4 py-2 text-xs text-gray-600">
        {pct(ev.confidence_before)} → {pct(ev.confidence_after)}
      </td>
      <td className="px-4 py-2 text-xs">
        <button onClick={toggle} className="text-blue-600 underline hover:text-blue-800">
          {expanded ? 'hide' : 'deltas'}
        </button>
        {expanded && (
          <pre className="mt-1 max-w-xs overflow-auto rounded bg-gray-100 p-1 text-xs">
            {ev.archetype_deltas}
          </pre>
        )}
      </td>
    </tr>
  );
}

function ReplayModal({
  replay,
  onClose,
}: {
  replay: TracerSessionReplayResponse;
  onClose: () => void;
}) {
  const confidenceStr =
    replay.session?.confidence !== null && replay.session?.confidence !== undefined
      ? pct(replay.session.confidence)
      : '—';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="relative max-h-[80vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-6 shadow-xl">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
        >
          ✕
        </button>
        <h3 className="mb-2 text-lg font-bold text-gray-900">Session Replay</h3>
        {replay.session && (
          <div className="mb-4 rounded bg-gray-50 p-3 text-xs text-gray-600">
            <strong>Session:</strong>{' '}
            <span className="font-mono">{replay.session.session_id.slice(0, 24)}…</span>
            {' | '}
            <strong>Top:</strong> {replay.session.top_archetype ?? '—'}
            {' | '}
            <strong>Confidence:</strong> {confidenceStr}
          </div>
        )}
        <DataSourceBadge source={replay.data_source} />
        {replay.data_source !== 'live' && replay.data_source !== 'mock' && (
          <div className="mt-2 rounded bg-yellow-50 p-2 text-xs text-yellow-700">
            Data source: {replay.data_source}. ClickHouse events may be unavailable.
          </div>
        )}
        <table className="mt-3 min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-gray-200">
              {['Time', 'Type', 'Top Archetype', 'Confidence'].map((h) => (
                <th key={h} className="px-2 py-1 text-gray-500">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {replay.events.map((ev, i) => (
              <tr key={i} className="border-b border-gray-100">
                <td className="px-2 py-1">{fmtTime(ev.event_at)}</td>
                <td className="px-2 py-1">{ev.event_type}</td>
                <td className="px-2 py-1">{ev.top_archetype}</td>
                <td className="px-2 py-1">
                  {pct(ev.confidence_before)} → {pct(ev.confidence_after)}
                </td>
              </tr>
            ))}
            {replay.events.length === 0 && (
              <tr>
                <td colSpan={4} className="px-2 py-4 text-center text-gray-400">
                  No events recorded for this session.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export default function SessionHistoryPage({ params, searchParams }: HistoryPageProps) {
  const [tenantId, setTenantId] = useState('');
  const [initialSessionId, setInitialSessionId] = useState<string | undefined>();

  // Filters
  const [filterSessionId, setFilterSessionId] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [filterArchetype, setFilterArchetype] = useState('');
  const [page, setPage] = useState(0);

  // Results
  const [events, setEvents] = useState<IntentEventRow[]>([]);
  const [total, setTotal] = useState(0);
  const [dataSource, setDataSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Replay modal
  const [replayData, setReplayData] = useState<TracerSessionReplayResponse | null>(null);
  const [replayLoading, setReplayLoading] = useState<string | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);

  // Resolve params
  useEffect(() => {
    void Promise.all([params, searchParams]).then(([p, sp]) => {
      setTenantId(p.id);
      if (sp.session_id) {
        setInitialSessionId(sp.session_id);
        setFilterSessionId(sp.session_id);
      }
      if (sp.from) setFilterFrom(sp.from);
      if (sp.to) setFilterTo(sp.to);
      if (sp.archetype) setFilterArchetype(sp.archetype);
      if (sp.page) setPage(Number(sp.page));
    });
  }, [params, searchParams]);

  const fetchHistory = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const token = getAdminToken();
      const url = new URL('/api/admin/tracer/history', window.location.origin);
      url.searchParams.set('tenant_id', tenantId);
      url.searchParams.set('limit', String(PAGE_SIZE));
      url.searchParams.set('offset', String(page * PAGE_SIZE));
      if (filterSessionId) url.searchParams.set('session_id', filterSessionId);
      if (filterFrom) url.searchParams.set('from', filterFrom);
      if (filterTo) url.searchParams.set('to', filterTo);
      if (filterArchetype) url.searchParams.set('archetype', filterArchetype);

      const res = await fetch(url.toString(), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      // Cast to loose type so we can check for 'error' data_source on failure paths
      // (the API can emit data_source:'error' on 500s which is not in the Zod schema enum).
      const json = (await res.json()) as {
        events?: TracerHistoryResponse['events'];
        total?: number;
        data_source?: string;
        error?: { message?: string };
      };

      if (!res.ok || json.data_source === 'error') {
        setErrorMsg(
          `API error [${res.status.toString()}]: ${json.error?.message ?? 'unknown'} (data_source: ${json.data_source ?? 'missing'})`,
        );
        return;
      }

      setEvents(json.events ?? []);
      setTotal(json.total ?? 0);
      setDataSource(json.data_source ?? null);
    } catch (err) {
      setErrorMsg(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [tenantId, page, filterSessionId, filterFrom, filterTo, filterArchetype]);

  useEffect(() => {
    if (tenantId) void fetchHistory();
  }, [fetchHistory, tenantId, initialSessionId]);

  const handleReplay = async (sessionId: string) => {
    setReplayLoading(sessionId);
    setReplayError(null);
    try {
      const token = getAdminToken();
      const url = `/api/admin/tracer/history/${encodeURIComponent(sessionId)}?tenant_id=${encodeURIComponent(tenantId)}`;
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      // Use loose type so we can compare data_source to 'error' on failure paths.
      const json = (await res.json()) as {
        session?: TracerSessionReplayResponse['session'];
        events?: TracerSessionReplayResponse['events'];
        data_source?: string;
        error?: { message?: string };
      };
      if (!res.ok || json.data_source === 'error') {
        setReplayError(
          `Replay error [${res.status.toString()}]: ${json.error?.message ?? 'unknown'}`,
        );
        return;
      }
      if (json.data_source && json.events) {
        setReplayData(json as TracerSessionReplayResponse);
      }
    } catch (err) {
      setReplayError(`Replay fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setReplayLoading(null);
    }
  };

  // Build the JSONL export URL for the <a download> link (no Accept header required for JSONL).
  // Relative URL (no window.location.origin) so this is safe to call during SSR — a 'use client'
  // page is still server-rendered for the initial HTML, and `window` is undefined there. Calling
  // the previous `new URL(path, window.location.origin)` form at render time threw
  // `ReferenceError: window is not defined`, crashing the whole history page with a 500.
  const buildJsonlExportUrl = () => {
    const qs = new URLSearchParams({
      tenant_id: tenantId,
      from: filterFrom || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      to: filterTo || new Date().toISOString(),
    });
    return `/api/admin/tracer/export/decisions?${qs.toString()}`;
  };

  // CSV export must use fetch() with Accept: text/csv — the route selects CSV from the
  // Accept header only; a bare <a href download> cannot set headers (FOLLOW-312 / RETRO-077 LG-2).
  const [csvExporting, setCsvExporting] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);

  const handleExportCsv = async () => {
    setCsvExporting(true);
    setCsvError(null);
    try {
      const url = new URL('/api/admin/tracer/export/decisions', window.location.origin);
      url.searchParams.set('tenant_id', tenantId);
      url.searchParams.set(
        'from',
        filterFrom || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      );
      url.searchParams.set('to', filterTo || new Date().toISOString());

      const res = await fetch(url.toString(), {
        headers: { Accept: 'text/csv' },
      });

      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: { message?: string; code?: string };
        };
        setCsvError(
          `CSV export failed: ${json.error?.message ?? json.error?.code ?? `HTTP ${res.status.toString()}`}`,
        );
        return;
      }

      const blob = await res.blob();
      const from = filterFrom || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const to = filterTo || new Date().toISOString();
      const filename = `tracer-decisions-${tenantId.slice(0, 8)}-${from.replace('T', '_')}-${to.replace('T', '_')}.csv`;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch (err) {
      setCsvError(`CSV export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCsvExporting(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const applyFilters = () => {
    setPage(0);
    void fetchHistory();
  };

  const clearFilters = () => {
    setFilterSessionId('');
    setFilterFrom('');
    setFilterTo('');
    setFilterArchetype('');
    setPage(0);
  };

  const closeReplay = () => {
    setReplayData(null);
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Session History</h2>
          <p className="mt-1 text-sm text-gray-500">
            K.3.6.2 — Paginated intent event history. Tenant:{' '}
            <span className="font-mono text-xs">{tenantId}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          {dataSource && <DataSourceBadge source={dataSource} />}
          <Link
            href={`/admin/tenants/${tenantId}/tracer`}
            className="text-sm text-blue-600 underline hover:text-blue-800"
          >
            Live Monitor
          </Link>
        </div>
      </div>

      {/* Error banner — Rule K.2 */}
      {errorMsg && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <strong>Error:</strong> {errorMsg}
        </div>
      )}

      {replayError && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <strong>Replay error:</strong> {replayError}
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
          Filters
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs text-gray-500">Session ID</label>
            <input
              type="text"
              value={filterSessionId}
              onChange={(e) => {
                setFilterSessionId(e.target.value);
              }}
              placeholder="sha256 hex…"
              className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">From (ISO 8601)</label>
            <input
              type="datetime-local"
              value={filterFrom}
              onChange={(e) => {
                setFilterFrom(e.target.value);
              }}
              className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">To (ISO 8601)</label>
            <input
              type="datetime-local"
              value={filterTo}
              onChange={(e) => {
                setFilterTo(e.target.value);
              }}
              className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Archetype</label>
            <input
              type="text"
              value={filterArchetype}
              onChange={(e) => {
                setFilterArchetype(e.target.value);
              }}
              placeholder="yield_hunter…"
              className="w-full rounded border border-gray-200 px-2 py-1 text-xs"
            />
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={applyFilters}
            disabled={loading}
            className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Apply filters'}
          </button>
          <button
            onClick={clearFilters}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Export buttons — CSV uses fetch(Accept: text/csv); JSONL uses <a download> */}
      <div className="mb-4 flex flex-wrap gap-2">
        {/* CSV: must use fetch + Accept header — bare <a> navigation cannot set Accept (FOLLOW-312) */}
        <button
          onClick={() => void handleExportCsv()}
          disabled={csvExporting || !tenantId}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {csvExporting ? 'Exporting…' : 'Export CSV (decisions)'}
        </button>
        {/* JSONL: route default is JSONL — no Accept header needed; <a download> works */}
        <a
          href={buildJsonlExportUrl()}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          download
        >
          Export JSONL (decisions)
        </a>
        <Link
          href={`/admin/tenants/${tenantId}/tracer/export`}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Full Export Dashboard →
        </Link>
      </div>
      {csvError && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-800">
          <strong>Export error:</strong> {csvError}
        </div>
      )}

      {/* Event table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-left">
          <thead className="bg-gray-50">
            <tr>
              {['Time', 'Session', 'Type', 'Top Archetype', 'Confidence', 'Deltas / Replay'].map(
                (h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {events.map((ev, i) => (
              <React.Fragment key={i}>
                <EventRow ev={ev} />
                <tr>
                  <td colSpan={6} className="px-4 py-0.5">
                    <button
                      onClick={() => {
                        void handleReplay(ev.session_id);
                      }}
                      disabled={replayLoading === ev.session_id}
                      className="text-xs text-blue-600 underline hover:text-blue-800 disabled:opacity-50"
                    >
                      {replayLoading === ev.session_id ? 'Loading replay…' : 'Replay session'}
                    </button>
                  </td>
                </tr>
              </React.Fragment>
            ))}
            {!loading && events.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                  No events match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center gap-3 text-sm">
          <button
            onClick={() => {
              setPage((p) => Math.max(0, p - 1));
            }}
            disabled={page === 0}
            className="rounded border border-gray-200 px-3 py-1 text-gray-600 disabled:opacity-40"
          >
            Prev
          </button>
          <span className="text-gray-500">
            Page {(page + 1).toString()} / {totalPages.toString()} ({total.toString()} events)
          </span>
          <button
            onClick={() => {
              setPage((p) => Math.min(totalPages - 1, p + 1));
            }}
            disabled={page >= totalPages - 1}
            className="rounded border border-gray-200 px-3 py-1 text-gray-600 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      {/* Replay modal */}
      {replayData && <ReplayModal replay={replayData} onClose={closeReplay} />}
    </div>
  );
}
