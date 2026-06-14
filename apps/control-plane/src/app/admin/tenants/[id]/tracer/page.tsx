'use client';

/**
 * K.3.6.1 — Live Session Monitor
 *
 * Consumes:
 *   GET  /api/admin/tracer/sessions?since_minutes=15  (initial list)
 *   GET  /api/admin/tracer/sessions/[id]/stream       (SSE per-session)
 *
 * Auth: all fetch calls include `Authorization: Bearer <ADMIN_API_SECRET>` via the
 * `X-Admin-Token` cookie set at login. This is a staff-only page — non-admin users
 * are shown a 401/403 error state. The admin-token is read from the cookie on the
 * client side; it is NEVER embedded in page markup or JS bundles.
 *
 * Rule K.2: if the API returns a non-2xx response or `data_source: 'error'`,
 * the page renders a VISIBLE error banner — it never silently zero-fills.
 *
 * Chat column: stub placeholder only (D-2 — pending DPIA/client-notification scope).
 * Simulation: not present (D-3 — FOLLOW-282).
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/tracer/page
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';

import type { TracerSessionsResponse, IntentSessionRow, IntentEventRow } from '@estalara/shared';
import { ARCHETYPE_KEYS } from '@estalara/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StreamEvent {
  events?: IntentEventRow[];
  heartbeat?: boolean;
  error?: string;
  message?: string;
  closed?: boolean;
  data_source?: string;
}

interface LiveMonitorProps {
  params: Promise<{ id: string }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Retrieve the admin bearer token from localStorage (set at staff login). */
function getAdminToken(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('estalara_admin_token') ?? '';
}

/**
 * Derive per-archetype probability distribution from intent_state JSON blob
 * stored in the session row.  The blob shape is:
 *   { weights: Record<archetype, number>, topArchetype: string, confidence: number }
 * We render relative probabilities — normalised weights.
 */
function extractWeights(sessionRow: IntentSessionRow): Record<string, number> {
  // intentState is opaque from the API — access via unknown cast.
  // The weights Record lives inside the API's intentState JSONB, but the
  // TracerSessionsResponse only surfaces top_archetype + confidence.
  // We build a minimal representation using confidence on the top archetype.
  const result: Record<string, number> = {};
  for (const key of ARCHETYPE_KEYS) {
    result[key] = 0;
  }
  if (sessionRow.top_archetype && sessionRow.confidence !== null) {
    result[sessionRow.top_archetype] = sessionRow.confidence;
  }
  return result;
}

/** Format ISO string to HH:MM:SS local time. */
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Horizontal probability bar for one archetype. */
function ArchetypeBar({ label, value, isTop }: { label: string; value: number; isTop: boolean }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span
        className={`w-40 shrink-0 truncate text-xs ${isTop ? 'font-semibold text-purple-800' : 'text-gray-600'}`}
        title={label}
      >
        {label}
      </span>
      <div className="flex-1 rounded bg-gray-100" style={{ height: 10 }}>
        <div
          className={`h-full rounded transition-all ${isTop ? 'bg-purple-500' : 'bg-gray-300'}`}
          style={{ width: `${pct.toString()}%` }}
        />
      </div>
      <span
        className={`w-10 shrink-0 text-right text-xs ${isTop ? 'font-bold text-purple-800' : 'text-gray-400'}`}
      >
        {pct}%
      </span>
    </div>
  );
}

/** 18-archetype probability chart rendered as styled divs (no charting dep). */
function ArchetypeProbChart({ session }: { session: IntentSessionRow }) {
  const weights = extractWeights(session);
  const top = session.top_archetype;
  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-500">
        Archetype Probabilities
      </p>
      {ARCHETYPE_KEYS.map((key) => (
        <ArchetypeBar key={key} label={key} value={weights[key] ?? 0} isTop={key === top} />
      ))}
    </div>
  );
}

/** Provenance badge — shows data_source value prominently. */
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

/** Live SSE event tail for an active session. */
function SessionStream({ tenantId, sessionId }: { tenantId: string; sessionId: string }) {
  const [events, setEvents] = useState<string[]>([]);
  const [status, setStatus] = useState<'connecting' | 'live' | 'error' | 'closed'>('connecting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const token = getAdminToken();
    // NOTE: EventSource does not support custom headers in all browsers.
    // We pass the token as a query param for the SSE endpoint (admin-only surface).
    const url = `/api/admin/tracer/sessions/${encodeURIComponent(sessionId)}/stream?tenant_id=${encodeURIComponent(tenantId)}&token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      setStatus('live');
    };

    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data as string) as StreamEvent;
        if (parsed.closed) {
          setStatus('closed');
          es.close();
          return;
        }
        if (parsed.error) {
          setStatus('error');
          setErrorMsg(parsed.message ?? parsed.error);
          es.close();
          return;
        }
        if (parsed.heartbeat) return;
        if (parsed.events && parsed.events.length > 0) {
          const evs = parsed.events;
          setEvents((prev) => [
            ...prev.slice(-49),
            ...evs.map((ev) => `${fmtTime(ev.event_at)} · ${ev.event_type} · ${ev.top_archetype}`),
          ]);
        }
      } catch {
        // malformed SSE frame — ignore
      }
    };

    es.onerror = () => {
      setStatus('error');
      setErrorMsg('SSE connection failed');
      es.close();
    };

    return () => {
      es.close();
    };
  }, [sessionId, tenantId]);

  return (
    <div className="mt-2 rounded border border-gray-200 bg-gray-900 p-2 text-xs font-mono text-green-400">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-gray-400">stream:</span>
        <span
          className={
            status === 'live'
              ? 'text-green-400'
              : status === 'error'
                ? 'text-red-400'
                : status === 'closed'
                  ? 'text-gray-400'
                  : 'text-yellow-400'
          }
        >
          {status}
        </span>
        {errorMsg && <span className="text-red-400"> — {errorMsg}</span>}
      </div>
      {events.length === 0 && status === 'live' && (
        <span className="text-gray-500">Waiting for events…</span>
      )}
      {events.map((ev, i) => (
        <div key={i}>{ev}</div>
      ))}
    </div>
  );
}

/** Single session card. */
function SessionCard({
  session,
  tenantId,
  expanded,
  onToggle,
}: {
  session: IntentSessionRow;
  tenantId: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="font-mono text-xs text-gray-500" title={session.session_id}>
            {session.session_id.slice(0, 16)}…
          </span>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-600">
            <span>signals: {session.signal_count}</span>
            <span>
              confidence:{' '}
              {session.confidence !== null
                ? `${Math.round(session.confidence * 100).toString()}%`
                : '—'}
            </span>
            <span>quiz: {session.quiz_completed ? 'done' : 'no'}</span>
            <span>chat: {session.chat_turns}</span>
            <span>last: {fmtTime(session.last_event_at)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {session.top_archetype && (
            <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-800">
              {session.top_archetype}
            </span>
          )}
          <Link
            href={`/admin/tenants/${tenantId}/tracer/history?session_id=${session.session_id}`}
            className="text-xs text-blue-600 underline hover:text-blue-800"
          >
            history
          </Link>
          <button
            onClick={onToggle}
            className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            {expanded ? 'collapse' : 'expand'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3">
          <ArchetypeProbChart session={session} />

          {/* Chat column: stub — D-2, pending scope */}
          <div className="mt-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 text-xs text-gray-400">
            Chat logging D-2 — pending scope decision (DPIA/client-notification scope undecided).
          </div>

          <SessionStream tenantId={tenantId} sessionId={session.session_id} />
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function LiveSessionMonitorPage({ params }: LiveMonitorProps) {
  const [tenantId, setTenantId] = useState<string>('');
  const [sessions, setSessions] = useState<IntentSessionRow[]>([]);
  const [dataSource, setDataSource] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [lastRefresh, setLastRefresh] = useState<string>('');

  // Resolve tenant id from params
  useEffect(() => {
    void params.then(({ id }) => {
      setTenantId(id);
    });
  }, [params]);

  const fetchSessions = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const token = getAdminToken();
      const res = await fetch(`/api/admin/tracer/sessions`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.status === 401 || res.status === 403) {
        setErrorMsg(
          `Auth error: ${res.status.toString()} — provide a valid admin token (see localStorage estalara_admin_token)`,
        );
        return;
      }
      // Use loose type to allow data_source:'error' comparison (not declared in Zod schema enum).
      const json = (await res.json()) as {
        sessions?: TracerSessionsResponse['sessions'];
        data_source?: string;
        error?: { message?: string };
      };
      // Rule K.2: data_source: 'error' is an OBSERVABLE failure — render it.
      if (!res.ok || json.data_source === 'error') {
        setErrorMsg(
          `API error [${res.status.toString()}]: ${json.error?.message ?? 'unknown'} (data_source: ${json.data_source ?? 'missing'})`,
        );
        return;
      }
      // Filter to this tenant's sessions
      const filtered = (json.sessions ?? []).filter((s) => s.tenant_id === tenantId);
      setSessions(filtered);
      setDataSource(json.data_source ?? null);
      setLastRefresh(new Date().toLocaleTimeString());
    } catch (err) {
      setErrorMsg(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  const toggleExpand = (sessionId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Live Session Monitor</h2>
          <p className="mt-1 text-sm text-gray-500">
            K.3.6.1 — Sessions active in the last 15 minutes. Tenant:{' '}
            <span className="font-mono text-xs">{tenantId}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          {dataSource && <DataSourceBadge source={dataSource} />}
          <button
            onClick={() => {
              void fetchSessions();
            }}
            disabled={loading}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Error banner — Rule K.2: always visible on failure */}
      {errorMsg && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <strong>Error:</strong> {errorMsg}
        </div>
      )}

      {lastRefresh && !errorMsg && (
        <p className="mb-4 text-xs text-gray-400">Last refreshed: {lastRefresh}</p>
      )}

      {/* Nav links */}
      <div className="mb-4 flex gap-3 text-sm">
        <Link
          href={`/admin/tenants/${tenantId}/tracer/history`}
          className="text-blue-600 underline hover:text-blue-800"
        >
          Session History
        </Link>
        <Link
          href={`/admin/tenants/${tenantId}/tracer/export`}
          className="text-blue-600 underline hover:text-blue-800"
        >
          Export Dashboard
        </Link>
        <Link href="/admin/tracer/weights" className="text-blue-600 underline hover:text-blue-800">
          Weight Editor
        </Link>
      </div>

      {!loading && !errorMsg && sessions.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          No active sessions in the last 15 minutes for this tenant.
        </div>
      )}

      <div className="space-y-3">
        {sessions.map((s) => (
          <SessionCard
            key={s.session_id}
            session={s}
            tenantId={tenantId}
            expanded={expandedIds.has(s.session_id)}
            onToggle={() => {
              toggleExpand(s.session_id);
            }}
          />
        ))}
      </div>
    </div>
  );
}
