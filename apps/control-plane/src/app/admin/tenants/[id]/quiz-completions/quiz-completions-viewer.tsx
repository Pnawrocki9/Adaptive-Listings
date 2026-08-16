'use client';

/**
 * QuizCompletionsViewer — read-only staff table over a tenant's `quiz_completions`
 * rows (FOLLOW-999), fed by `GET /api/admin/tenants/quiz-completions?tenant_id=`.
 *
 * Shows the all-time archetype/branch distributions (computed server-side over
 * every completion, not just the visible page) above a newest-first paged table.
 * Offset paging via Prev/Next — a staff inspection surface, not an infinite feed.
 *
 * Rule K.2 consumer-side clause (FOLLOW-624/630): a failed GET renders a
 * `role="alert"` + Retry rather than an empty table — an empty table must only
 * ever mean "this tenant genuinely has zero completions". There are no writes
 * here, so unlike the editor siblings there is no Save to disable; the guarded
 * failure mode is silent-empty, not clobber-on-save.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-completions/quiz-completions-viewer
 */

import { useEffect, useState } from 'react';

interface CompletionRow {
  id: string;
  session_id: string;
  resolved_archetype: string;
  branch: string | null;
  q1_answer: number | null;
  q2_answer: number | null;
  q3_answer: number | null;
  language: string;
  created_at: string;
}

interface ViewerData {
  total: number;
  limit: number;
  offset: number;
  aggregates: {
    by_archetype: { archetype: string; count: number }[];
    by_branch: { branch: string | null; count: number }[];
  };
  completions: CompletionRow[];
}

const PAGE_SIZE = 50;

function formatAnswer(v: number | null): string {
  return v === null ? '—' : String(v);
}

export function QuizCompletionsViewer({ tenantId }: { tenantId: string }): React.JSX.Element {
  const [data, setData] = useState<ViewerData | null>(null);
  const [offset, setOffset] = useState(0);
  const [loadStatus, setLoadStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [loadErrorMsg, setLoadErrorMsg] = useState('');
  const [retryNonce, setRetryNonce] = useState(0);

  // Every call is fenced to this tenant via ?tenant_id — the staff-only API path.
  const url = `/api/admin/tenants/quiz-completions?tenant_id=${encodeURIComponent(
    tenantId,
  )}&limit=${String(PAGE_SIZE)}&offset=${String(offset)}`;

  useEffect(() => {
    setLoadStatus('loading');
    setLoadErrorMsg('');
    void fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
        return r.json();
      })
      .then((body: unknown) => {
        setData(body as ViewerData);
        setLoadStatus('loaded');
      })
      .catch((err: unknown) => {
        // Rule K.2 consumer-side clause: a failed load must be visibly an error,
        // never an empty table that reads as "zero completions".
        setLoadErrorMsg(err instanceof Error ? err.message : 'Failed to load completions.');
        setLoadStatus('error');
      });
  }, [url, retryNonce]);

  if (loadStatus === 'error') {
    return (
      <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
        <p>Failed to load quiz completions: {loadErrorMsg}</p>
        <p className="mt-1 text-xs">
          An empty table is shown only for a successful load — this error means the data could not
          be read, not that there are no completions.
        </p>
        <button
          type="button"
          onClick={() => {
            setRetryNonce((n) => n + 1);
          }}
          className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
        >
          Retry
        </button>
      </div>
    );
  }

  if (loadStatus === 'loading' || data === null) {
    return <div className="py-8 text-center text-sm text-gray-500">Loading completions…</div>;
  }

  const showingFrom = data.total === 0 ? 0 : data.offset + 1;
  const showingTo = Math.min(data.offset + data.completions.length, data.total);
  const hasPrev = data.offset > 0;
  const hasNext = data.offset + data.completions.length < data.total;

  return (
    <div className="space-y-6">
      {/* All-time distributions (server-side aggregates over EVERY completion) */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">
            Archetype Distribution (all time)
          </h2>
          {data.aggregates.by_archetype.length === 0 ? (
            <p className="text-sm text-gray-400">No completions yet.</p>
          ) : (
            <ul className="space-y-1">
              {data.aggregates.by_archetype.map((a) => (
                <li key={a.archetype} className="flex justify-between text-sm">
                  <span className="font-mono text-xs text-gray-700">{a.archetype}</span>
                  <span className="tabular-nums text-gray-900">{a.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Branch Split (all time)</h2>
          {data.aggregates.by_branch.length === 0 ? (
            <p className="text-sm text-gray-400">No completions yet.</p>
          ) : (
            <ul className="space-y-1">
              {data.aggregates.by_branch.map((b) => (
                <li key={b.branch ?? 'null'} className="flex justify-between text-sm">
                  <span className="font-mono text-xs text-gray-700">
                    {b.branch ?? 'neutral (Q1 skip)'}
                  </span>
                  <span className="tabular-nums text-gray-900">{b.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Completions table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Completed</th>
              <th className="px-4 py-3">Session</th>
              <th className="px-4 py-3">Archetype</th>
              <th className="px-4 py-3">Branch</th>
              <th className="px-4 py-3 text-center">Q1</th>
              <th className="px-4 py-3 text-center">Q2</th>
              <th className="px-4 py-3 text-center">Q3</th>
              <th className="px-4 py-3">Lang</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.completions.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                  No quiz completions recorded for this tenant.
                </td>
              </tr>
            ) : (
              data.completions.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-2 text-gray-700">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td
                    className="max-w-[10rem] truncate px-4 py-2 font-mono text-xs text-gray-500"
                    title={row.session_id}
                  >
                    {row.session_id}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-900">
                    {row.resolved_archetype}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-700">
                    {row.branch ?? 'neutral'}
                  </td>
                  <td className="px-4 py-2 text-center tabular-nums text-gray-700">
                    {formatAnswer(row.q1_answer)}
                  </td>
                  <td className="px-4 py-2 text-center tabular-nums text-gray-700">
                    {formatAnswer(row.q2_answer)}
                  </td>
                  <td className="px-4 py-2 text-center tabular-nums text-gray-700">
                    {formatAnswer(row.q3_answer)}
                  </td>
                  <td className="px-4 py-2 text-gray-700">{row.language}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Paging */}
      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>
          Showing {showingFrom}–{showingTo} of {data.total}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!hasPrev}
            onClick={() => {
              setOffset((o) => Math.max(0, o - PAGE_SIZE));
            }}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← Prev
          </button>
          <button
            type="button"
            disabled={!hasNext}
            onClick={() => {
              setOffset((o) => o + PAGE_SIZE);
            }}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
