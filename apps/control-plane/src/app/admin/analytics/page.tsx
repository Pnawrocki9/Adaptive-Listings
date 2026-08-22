/**
 * /admin/analytics — Cross-Brand Analytics (FOLLOW-638, CEO per-brand ruling
 * 2026-07-24).
 *
 * Server Component: calls `getPlatformAnalyticsRollup()` directly (same
 * data-access function `GET /api/admin/analytics/rollup` uses — single
 * source of truth, no self-fetch loopback). Already staff-gated by
 * `middleware.ts` (`/admin/*`), so no additional client-side auth wiring is
 * needed here (mirrors `/admin/tenants/page.tsx`).
 *
 * Rule K.2: a configured-but-failing ClickHouse/Postgres query renders a
 * visible error banner and NO fabricated table — never silently substitutes
 * mock numbers. The secondary quiz-completions metric can degrade
 * independently (`quiz_data_source: 'error'`) while the rest of the page
 * still renders — shown per-row as "—".
 *
 * FOLLOW-560: the Scoring Path panel is the human-readable half of the
 * cosine-vs-djb2 telemetry (`adaptation_decisions.scoring_path`, migration
 * 0022). It reads `scoring_path_source` and renders a REASON, not a zero,
 * whenever the split is unavailable — 'disabled' (the flag is off because
 * migration 0022 is not applied on this instance, the expected production
 * state until FOLLOW-820) is a different statement from 'error'.
 *
 * @module apps/control-plane/src/app/admin/analytics/page
 */

/**
 * FOLLOW-1001: this page MUST render at request time, never be statically
 * prerendered. Two independent reasons:
 * (1) the Vercel build runs through `turbo run build` with NO `env` declared in
 *     turbo.json, so Turborepo's strict env mode STRIPS `DATABASE_URL_ADMIN` /
 *     `DATABASE_URL_DIRECT` (and every other non-NEXT_PUBLIC var) from the build
 *     — a build-time prerender therefore always sees "DB unconfigured" and BAKES
 *     the mock/unconfigured state into static HTML that runtime env can never
 *     fix. Observed live on the /admin list pages [MP-009].
 * (2) even with build-time env, a staff fleet page frozen at build time would
 *     show stale data until the next deploy — wrong for an operator surface.
 */
export const dynamic = 'force-dynamic';

import Link from 'next/link';

import { getPlatformAnalyticsRollup } from '@/app/api/admin/analytics/rollup/data';
import type {
  BrandBreakdownRow,
  PlatformAnalyticsRollup,
} from '@/app/api/admin/analytics/rollup/data';

/** Provenance badge — mirrors the DataSourceBadge used by the Tracer/Tenants pages. */
function DataSourceBadge({ source, label }: { source: string; label: string }) {
  const color =
    source === 'clickhouse' || source === 'live'
      ? 'bg-green-100 text-green-800'
      : source === 'mock'
        ? 'bg-yellow-100 text-yellow-800'
        : // FOLLOW-560: 'disabled' is a configuration fact (the column is not live on this
          // instance yet), not a failure — red would misread as an incident.
          source === 'disabled'
          ? 'bg-gray-100 text-gray-700'
          : 'bg-red-100 text-red-800';
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${color}`}>
      {label}: {source}
    </span>
  );
}

function LiftCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-gray-400">—</span>;
  const color = value >= 0 ? 'text-green-700' : 'text-red-700';
  return (
    <span className={color}>
      {value >= 0 ? '+' : ''}
      {value.toFixed(1)}%
    </span>
  );
}

function QuizCell({ value }: { value: number | null }) {
  if (value === null) return <span className="text-gray-400">—</span>;
  return <>{value}</>;
}

function BrandRow({ row }: { row: BrandBreakdownRow }) {
  return (
    <tr key={row.tenant_id} className="hover:bg-gray-50">
      <td className="px-4 py-3 text-sm font-medium text-gray-900">{row.tenant_name}</td>
      <td className="px-4 py-3 text-sm text-gray-500">{row.tenant_slug}</td>
      <td className="px-4 py-3 text-sm text-gray-700">{row.sessions}</td>
      <td className="px-4 py-3 text-sm text-gray-700">{row.adapted}</td>
      <td className="px-4 py-3 text-sm text-gray-700">{row.holdout}</td>
      <td className="px-4 py-3 text-sm">
        <LiftCell value={row.ctaLift} />
      </td>
      <td className="px-4 py-3 text-sm text-gray-700">
        <QuizCell value={row.quizCompletions} />
      </td>
      <td className="px-4 py-3 text-xs">
        <Link
          href={`/admin/tenants/${row.tenant_id}`}
          className="text-blue-600 underline hover:text-blue-800"
        >
          Tenant details
        </Link>
      </td>
    </tr>
  );
}

function RollupCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="mt-0.5 text-xs text-gray-500">{label}</div>
    </div>
  );
}

/**
 * FOLLOW-560 (audit A3-F-09/F-10) — cosine vs. djb2 reorder ranking over the same window.
 *
 * `cosine: 0` alongside a large `djb2_*` count is the finding this panel exists to make
 * visible: reorders are running on a session-stable hash, not on embeddings.
 */
function ScoringPathPanel({ data }: { data: PlatformAnalyticsRollup }) {
  const split = data.scoringPathSplit;

  if (split === null) {
    const reason =
      data.scoring_path_source === 'disabled'
        ? 'SCORING_PATH_COLUMN_ENABLED is not set on this deployment — adaptation_decisions.scoring_path is not queried here. Expected until ClickHouse migration 0022 is applied (FOLLOW-820).'
        : 'The scoring_path query failed on this instance. No number is shown rather than a fabricated zero split.';
    return (
      <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Scoring Path (cosine vs. djb2)
        </div>
        <p className="mt-1 text-sm text-gray-500">{reason}</p>
      </div>
    );
  }

  const total = split.cosine + split.djb2_fallback + split.djb2_guard + split.not_applicable;
  const ranked = split.cosine + split.djb2_fallback + split.djb2_guard;
  const cosinePct = ranked > 0 ? (split.cosine / ranked) * 100 : null;

  return (
    <div className="mb-6">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Scoring Path (cosine vs. djb2) · {total} decisions
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <RollupCard label="cosine" value={split.cosine} />
        <RollupCard label="djb2 fallback" value={split.djb2_fallback} />
        <RollupCard label="djb2 guard" value={split.djb2_guard} />
        <RollupCard label="no reorder" value={split.not_applicable} />
        <RollupCard
          label="Real ranking share"
          value={cosinePct === null ? '—' : `${cosinePct.toFixed(1)}%`}
        />
      </div>
    </div>
  );
}

export default async function AdminAnalyticsPage() {
  const result = await getPlatformAnalyticsRollup();

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Cross-Brand Analytics</h2>
          <p className="mt-1 text-sm text-gray-500">
            Platform-wide rollup across every brand (white-label deployment), plus a per-brand
            breakdown. Staff-only — plain rollup, no differential privacy (FOLLOW-638).
          </p>
        </div>
        {result.ok && (
          <div className="flex items-center gap-2">
            <DataSourceBadge source={result.data.data_source} label="data_source" />
            <DataSourceBadge source={result.data.quiz_data_source} label="quiz" />
            <DataSourceBadge source={result.data.scoring_path_source} label="scoring_path" />
          </div>
        )}
      </div>

      {/* Error banner — Rule K.2: a configured-but-failing store never renders fabricated rows. */}
      {!result.ok && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <strong>Error loading cross-brand analytics:</strong> {result.error}
        </div>
      )}

      {result.ok && <RollupBody data={result.data} />}
    </div>
  );
}

function RollupBody({ data }: { data: PlatformAnalyticsRollup }) {
  return (
    <>
      <p className="mb-4 text-xs text-gray-400">
        Window: last {data.window_days} days · Generated{' '}
        {new Date(data.generated_at).toLocaleString()}
      </p>

      {/* Platform-wide rollup — computed from the same per-brand rows rendered below. */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
        <RollupCard label="Brands" value={data.rollup.tenantCount} />
        <RollupCard label="Sessions" value={data.rollup.sessions} />
        <RollupCard label="Adapted" value={data.rollup.adapted} />
        <RollupCard label="Holdout" value={data.rollup.holdout} />
        <RollupCard
          label="CTA Lift"
          value={data.rollup.ctaLift === null ? '—' : `${data.rollup.ctaLift.toFixed(1)}%`}
        />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
        <RollupCard label="Quiz Completions" value={data.rollup.quizCompletions ?? '—'} />
      </div>

      <ScoringPathPanel data={data} />

      {data.brands.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white py-16 text-center text-gray-400">
          No brands yet
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {[
                  'Brand',
                  'Slug',
                  'Sessions',
                  'Adapted',
                  'Holdout',
                  'CTA Lift',
                  'Quiz Completions',
                  '',
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.brands.map((row) => (
                <BrandRow key={row.tenant_id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
