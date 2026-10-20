'use client';

/**
 * QuizAccuracyView — the staff quiz accuracy report (FOLLOW-1363), fed by
 * `GET /api/admin/tenants/quiz-accuracy?tenant_id=`. The response type is the route's own
 * (`QuizAccuracyResponse`), never redeclared here.
 *
 * Rule K.2 consumer side: a failed GET renders a `role="alert"` + Retry, never an empty report; a
 * database without `quiz_runs` (H002 not applied) renders an explicit "not set up" state.
 * A subset (language / date filter) shows the numbers as descriptive only, not as the verdict.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-accuracy/quiz-accuracy-view
 */

import { useEffect, useState } from 'react';
import type { QuizAccuracyResponse } from '@/app/api/admin/tenants/quiz-accuracy/route';

type Report = Extract<QuizAccuracyResponse, { available: true }>;

const pct = (v: number | null): string => (v === null ? '—' : `${(v * 100).toFixed(1)} %`);
const interval = (b: { lo: number; hi: number }): string =>
  `${(b.lo * 100).toFixed(1)}–${(b.hi * 100).toFixed(1)} %`;

const VERDICT_STYLE: Record<Report['headline']['verdict'], string> = {
  PASS: 'bg-green-100 text-green-800',
  FAIL: 'bg-red-100 text-red-800',
  FUTILE: 'bg-red-100 text-red-800',
  INSUFFICIENT_N: 'bg-gray-100 text-gray-700',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}

export function QuizAccuracyView({ tenantId }: { tenantId: string }): React.JSX.Element {
  const [data, setData] = useState<QuizAccuracyResponse | null>(null);
  const [hash, setHash] = useState('');
  const [language, setLanguage] = useState('');
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [retryNonce, setRetryNonce] = useState(0);

  const params = new URLSearchParams({ tenant_id: tenantId });
  if (hash) params.set('definition_hash', hash);
  if (language) params.set('language', language);
  const url = `/api/admin/tenants/quiz-accuracy?${params.toString()}`;

  useEffect(() => {
    setStatus('loading');
    void fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
        return r.json();
      })
      .then((body: unknown) => {
        setData(body as QuizAccuracyResponse);
        setStatus('loaded');
      })
      .catch((err: unknown) => {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to load the report.');
        setStatus('error');
      });
  }, [url, retryNonce]);

  if (status === 'error') {
    return (
      <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
        <p>Failed to load the quiz accuracy report: {errorMsg}</p>
        <p className="mt-1 text-xs">
          This error means the data could not be read, not that there are no quiz runs.
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
  if (status === 'loading' || data === null) {
    return <div className="py-8 text-center text-sm text-gray-500">Loading report…</div>;
  }
  if (!data.available) {
    return (
      <div role="status" className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <p className="font-medium">Quiz run recording is not set up in this database.</p>
        <p className="mt-1 text-xs">{data.message}</p>
      </div>
    );
  }

  const r = data;
  const h = r.headline;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-4 text-sm">
        <label className="flex flex-col text-xs text-gray-500">
          Definition hash
          <select
            aria-label="Definition hash"
            value={hash || (r.definition_hash ?? '')}
            onChange={(e) => {
              setHash(e.target.value);
            }}
            className="mt-1 rounded border border-gray-300 px-2 py-1 font-mono text-xs text-gray-900"
          >
            {r.definition_hashes.length === 0 && <option value="">(none yet)</option>}
            {r.definition_hashes.map((d) => (
              <option key={d.hash} value={d.hash}>
                {d.hash.slice(0, 12)}… · v{d.version ?? 'built-in'} · n={d.n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-gray-500">
          Language
          <select
            aria-label="Language"
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value);
            }}
            className="mt-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-900"
          >
            <option value="">All (pooled)</option>
            <option value="en">en</option>
            <option value="pl">pl</option>
          </select>
        </label>
      </div>

      {r.rows_truncated && (
        <p role="alert" className="mb-4 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
          More runs than the report reads: the splits below cover only the oldest runs. The verdict
          is unaffected (it needs the first 400).
        </p>
      )}

      <Section title="Headline (PREREG §3)">
        <div data-testid="headline" className="flex flex-wrap items-center gap-6">
          <div>
            <div className="text-3xl font-bold text-gray-900">{pct(h.accuracy)}</div>
            <div className="text-xs text-gray-500">
              {h.correct} / {h.analysed_n} confirmed
            </div>
          </div>
          <div className="text-sm text-gray-700">
            Wilson 95 %: <span className="font-mono">{interval(h.wilson95)}</span>
            <div className="text-xs text-gray-500">
              needs lower bound ≥ 90 % ({h.pass_threshold ?? '—'} / {h.n_required} confirmed)
            </div>
          </div>
          <span
            data-testid="verdict"
            className={`rounded px-3 py-1 text-sm font-semibold ${VERDICT_STYLE[h.verdict]}`}
          >
            {h.verdict}
          </span>
          <div className="text-sm text-gray-700">
            n = {h.decided} of {h.n_required} required
          </div>
        </div>
        {!h.verdict_binding && (
          <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
            A language or date filter is applied: these numbers describe a subset and are NOT the
            pre-registered analysis.
          </p>
        )}
        <ul className="mt-3 text-xs text-gray-600">
          {h.futility_looks.map((l) => (
            <li key={l.n}>
              Futility look at n = {l.n}:{' '}
              {l.reached
                ? `${String(l.correct)} correct, upper bound ${pct(l.hi)} — ${l.futile ? 'FUTILE (stop, fix the tree)' : 'continue'}`
                : 'not reached'}
            </li>
          ))}
        </ul>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-xs text-gray-700 md:grid-cols-3">
          <div data-testid="pessimistic">
            <dt className="font-medium">Pessimistic (unconfirmed = wrong)</dt>
            <dd>
              {pct(r.pessimistic.accuracy)} ({r.pessimistic.correct}/{r.pessimistic.n}), Wilson{' '}
              {interval(r.pessimistic.wilson95)}
            </dd>
          </div>
          <div data-testid="response-rate">
            <dt className="font-medium">Response rate (decided / asked)</dt>
            <dd>
              {pct(r.response_rate.rate)} ({r.response_rate.decided}/{r.response_rate.asked}){' '}
              {r.response_rate.valid === false && (
                <span className="font-semibold text-red-700">
                  below {pct(r.response_rate.min_rate)}: the claim is void
                </span>
              )}
              {r.response_rate.valid === true && (
                <span>valid (≥ {pct(r.response_rate.min_rate)})</span>
              )}
            </dd>
          </div>
          <div data-testid="fast-yes">
            <dt className="font-medium">Fast “yes” (&lt; {r.fast_yes.threshold_ms} ms)</dt>
            <dd>
              {pct(r.fast_yes.share)} of {r.fast_yes.confirmed_with_timing} timed confirmations
              (reported, never excluded)
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-gray-500">
          All decided rows so far (monitoring, not a verdict): {pct(r.all_decided.accuracy)} (
          {r.all_decided.correct}/{r.all_decided.n}), Wilson {interval(r.all_decided.wilson95)}.
          Macro recall (classes with ≥ {r.macro_recall.min_true} true labels):{' '}
          {pct(r.macro_recall.value)} over {r.macro_recall.classes.length} classes.
        </p>
      </Section>

      <Section title="Funnel">
        <dl data-testid="funnel" className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          {(
            [
              ['Shown', r.funnel.shown],
              ['Completed', r.funnel.completed],
              ['  of which neutral', r.funnel.completed_neutral],
              ['Confirmed', r.funnel.confirmed],
              ['Corrected', r.funnel.corrected],
              ['Unconfirmed', r.funnel.unconfirmed],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-gray-500">{label.trim()}</dt>
              <dd className="font-semibold text-gray-900">{value}</dd>
            </div>
          ))}
        </dl>
        {r.funnel.dismissed_by_step.length > 0 && (
          <p className="mt-2 text-xs text-gray-600">
            Dismissed by step:{' '}
            {r.funnel.dismissed_by_step
              .map(
                (d) => `${d.step === null ? 'n/r' : `step ${String(d.step)}`}: ${String(d.count)}`,
              )
              .join(' · ')}
          </p>
        )}
      </Section>

      <Section title="Per leaf (reported, not gated; claims need n_true ≥ 100)">
        <table data-testid="per-leaf" className="w-full text-left text-xs">
          <thead className="text-gray-500">
            <tr>
              <th>Archetype</th>
              <th>Predicted</th>
              <th>Precision</th>
              <th>True</th>
              <th>Recall</th>
              <th>Recall 95 %</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {r.per_leaf.map((p) => (
              <tr key={p.archetype} className="border-t border-gray-100">
                <td className="font-mono">{p.archetype}</td>
                <td>{p.predicted_n}</td>
                <td>
                  {pct(p.precision)}{' '}
                  <span className="text-gray-400">({interval(p.precision_ci)})</span>
                </td>
                <td>{p.true_n}</td>
                <td>{pct(p.recall)}</td>
                <td>{interval(p.recall_ci)}</td>
                <td>
                  {p.flagged ? (
                    <span className="font-semibold text-red-700">flagged (LB &lt; 80 %)</span>
                  ) : p.claimable ? (
                    'claimable'
                  ) : (
                    <span className="text-gray-400">n &lt; 100</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Confusion matrix (rows = quiz leaf, columns = buyer’s true label)">
        <div className="overflow-x-auto">
          <table data-testid="confusion" className="text-xs">
            <thead className="text-gray-500">
              <tr>
                <th />
                {r.confusion.columns.map((c) => (
                  <th key={c} className="px-2 font-mono">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.confusion.labels.map((label, i) => (
                <tr key={label} className="border-t border-gray-100">
                  <th className="pr-2 text-left font-mono">{label}</th>
                  {(r.confusion.matrix[i] ?? []).map((v, j) => (
                    <td
                      key={r.confusion.columns[j]}
                      className={`px-2 text-center ${j === i ? 'font-semibold text-green-700' : ''}`}
                    >
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="By language">
        <ul data-testid="by-language" className="text-xs text-gray-700">
          {r.by_language.map((l) => (
            <li key={l.language}>
              {l.language}: {pct(l.accuracy)} ({l.correct}/{l.n}), Wilson {interval(l.wilson95)}
            </li>
          ))}
          {r.by_language.length === 0 && <li className="text-gray-400">no decided runs</li>}
        </ul>
      </Section>

      <Section title="By speed tertile (summed step time)">
        <ul data-testid="by-speed" className="text-xs text-gray-700">
          {r.by_speed_tertile.map((t) => (
            <li key={t.tertile}>
              T{t.tertile}
              {t.step_ms_range
                ? ` (${String(t.step_ms_range[0])}–${String(t.step_ms_range[1])} ms)`
                : ''}
              : {pct(t.accuracy)} ({t.correct}/{t.n}), fast “yes” {pct(t.fast_yes_share)}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Monthly (warning: ≥ 100 decided and upper bound < 90 % or response rate < 60 %)">
        <table data-testid="monthly" className="w-full text-left text-xs">
          <thead className="text-gray-500">
            <tr>
              <th>Month</th>
              <th>Decided</th>
              <th>Accuracy</th>
              <th>Wilson 95 %</th>
              <th>Response rate</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {r.monthly.map((m) => (
              <tr key={m.month} className="border-t border-gray-100">
                <td>{m.month}</td>
                <td>{m.decided}</td>
                <td>{pct(m.accuracy)}</td>
                <td>{interval(m.wilson95)}</td>
                <td>{pct(m.response_rate)}</td>
                <td className="font-semibold text-red-700">
                  {m.warn.upper_bound_below_target || m.warn.response_rate_below_min ? 'WARN' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
