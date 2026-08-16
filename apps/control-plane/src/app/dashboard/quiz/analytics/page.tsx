'use client';

/**
 * Quiz analytics dashboard page — REAL data from `quiz_completions` via
 * `GET /api/quiz/analytics` (FOLLOW-1000).
 *
 * Replaces the mock this page shipped with since Sprint 4.5 ("Mock data — real
 * data available in Sprint 5", which was never built). Every number rendered
 * here is now a Postgres aggregate over the tenant's actual quiz completions.
 *
 * WHAT THE MOCK SHOWED THAT THIS PAGE DELIBERATELY DOES NOT:
 * "Impressions", "Completion Rate" and "Inquiry Lift". The SDK emits
 * `quiz.event` ONLY at completion — there is no quiz-shown/impression event in
 * the schema, so an impression count has no data source and a completion rate
 * has no denominator (recorded as an explicit gap in FOLLOW-1000; adding the
 * event is a public ingest-schema change needing its own escalation). Lift
 * belongs to the A/B analytics surfaces. Honest absence beats a fabricated
 * number — the note below the stats row says exactly this to the tenant.
 *
 * Rule K.2 consumer-side clause: a failed GET renders a visible error + Retry,
 * never zeroes that read as "no quiz activity".
 *
 * @module apps/control-plane/src/app/dashboard/quiz/analytics/page
 */

import { useEffect, useState } from 'react';

interface QuizAnalytics {
  total_completions: number;
  completions_30d: number;
  daily: { day: string; count: number }[];
  by_archetype: { archetype: string; count: number }[];
  by_branch: { branch: string | null; count: number }[];
}

const DAILY_WINDOW_DAYS = 14;

/**
 * Fill the rolling window with zero-count days the API omits (Postgres has no
 * rows to group for them), so the chart always shows a continuous 14-day axis.
 */
function fillDaily(daily: { day: string; count: number }[]): { day: string; count: number }[] {
  const byDay = new Map(daily.map((d) => [d.day, d.count]));
  const out: { day: string; count: number }[] = [];
  const today = new Date();
  for (let i = DAILY_WINDOW_DAYS - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, count: byDay.get(key) ?? 0 });
  }
  return out;
}

const BRANCH_LABELS: Record<string, string> = {
  INWESTOR: 'Investor',
  OWN_USE: 'Own use',
  CROSS_BORDER: 'Cross-border',
};

export default function QuizAnalyticsPage() {
  const [data, setData] = useState<QuizAnalytics | null>(null);
  const [loadStatus, setLoadStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [loadErrorMsg, setLoadErrorMsg] = useState('');
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    setLoadStatus('loading');
    setLoadErrorMsg('');
    void fetch('/api/quiz/analytics')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
        return r.json();
      })
      .then((body: unknown) => {
        setData(body as QuizAnalytics);
        setLoadStatus('loaded');
      })
      .catch((err: unknown) => {
        // Rule K.2 consumer-side clause: a failed load must be visibly an error,
        // never zeroes that read as "no quiz activity".
        setLoadErrorMsg(err instanceof Error ? err.message : 'Failed to load analytics.');
        setLoadStatus('error');
      });
  }, [retryNonce]);

  if (loadStatus === 'error') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>Failed to load quiz analytics: {loadErrorMsg}</p>
          <p className="mt-1 text-xs">
            Zeroes are shown only for a successful read — this error means the data could not be
            loaded, not that there is no quiz activity.
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
      </div>
    );
  }

  if (loadStatus === 'loading' || data === null) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 text-center text-sm text-gray-500">
        Loading quiz analytics…
      </div>
    );
  }

  const daily = fillDaily(data.daily);
  const maxDaily = Math.max(1, ...daily.map((d) => d.count));
  const branchTotal = data.by_branch.reduce((sum, b) => sum + b.count, 0);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Quiz Analytics</h1>
        <p className="mt-1 text-sm text-gray-500">
          Live data from recorded quiz completions (FOLLOW-1000).
        </p>
      </div>

      {/* Stats row */}
      <div className="mb-2 grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-2xl font-bold text-gray-900">{data.total_completions}</div>
          <div className="mt-0.5 text-xs text-gray-500">Completions (all time)</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-2xl font-bold text-blue-600">{data.completions_30d}</div>
          <div className="mt-0.5 text-xs text-gray-500">Completions (last 30 days)</div>
        </div>
      </div>
      <p className="mb-8 text-xs text-gray-400">
        Impressions and completion rate are not shown: the SDK records quiz completions only — there
        is no quiz-shown event to count impressions from, so a rate would have no denominator.
      </p>

      {/* Daily completions chart */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold text-gray-700">
          Daily Completions — Last {DAILY_WINDOW_DAYS} Days
        </h2>
        <div className="flex h-32 items-end gap-1">
          {daily.map(({ day, count }) => (
            <div key={day} className="flex flex-1 flex-col items-center gap-1" title={day}>
              <span className="text-[10px] text-gray-600">{count}</span>
              <div
                className={`w-full rounded-t ${count > 0 ? 'bg-blue-500' : 'bg-gray-100'}`}
                style={{ height: `${String(Math.max(2, (count / maxDaily) * 100))}%` }}
              />
              <span className="text-[9px] text-gray-400">{day.slice(5)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Distributions */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Resolved Archetypes</h2>
          {data.by_archetype.length === 0 ? (
            <p className="text-sm text-gray-400">No completions yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.by_archetype.map((a) => (
                <li key={a.archetype} className="flex items-center justify-between text-sm">
                  <span className="font-mono text-xs text-gray-700">{a.archetype}</span>
                  <span className="tabular-nums font-medium text-gray-900">{a.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Branch Split</h2>
          {branchTotal === 0 ? (
            <p className="text-sm text-gray-400">No completions yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.by_branch.map((b) => (
                <li key={b.branch ?? 'null'} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">
                    {b.branch === null
                      ? 'Neutral (Q1 skip)'
                      : (BRANCH_LABELS[b.branch] ?? b.branch)}
                  </span>
                  <span className="tabular-nums font-medium text-gray-900">
                    {b.count}{' '}
                    <span className="text-xs text-gray-400">
                      ({Math.round((b.count / branchTotal) * 100)}%)
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
