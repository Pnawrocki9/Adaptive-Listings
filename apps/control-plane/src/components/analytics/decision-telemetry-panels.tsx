/**
 * DecisionTelemetryPanels — the scoring-path (FOLLOW-560) and reorder-withheld (FOLLOW-1220) panels
 * for one tenant, rendered on the staff hub's Analytics page (`/admin/tenants/[id]/analytics`).
 *
 * Moved here by FOLLOW-1330 from the removed cross-brand page (`/admin/analytics`, FOLLOW-638;
 * single tenant per ESC-085). A Server Component: it takes the rollup RESULT from the page, which
 * calls the same data-access function `GET /api/admin/analytics/rollup` uses
 * (`getTenantAnalyticsRollup`) — no self-fetch loopback, one source of truth.
 *
 * Rule K.2: a failed rollup renders its error and no number; a field whose own source is
 * 'disabled' or 'error' renders a REASON, never a fabricated zero. 'disabled' (scoring_path: the
 * flag is off because ClickHouse migration 0022 is not applied, the expected production state until
 * FOLLOW-820) is a different statement from 'error'.
 *
 * @module apps/control-plane/src/components/analytics/decision-telemetry-panels
 */

import type { RollupResult, TenantAnalyticsRollup } from '@/app/api/admin/analytics/rollup/data';

/** Provenance badge — 'disabled' is a configuration fact, not a failure, so it is not red. */
function SourceBadge({ source, label }: { source: string; label: string }) {
  const color =
    source === 'clickhouse' || source === 'live'
      ? 'bg-green-100 text-green-800'
      : source === 'mock'
        ? 'bg-yellow-100 text-yellow-800'
        : source === 'disabled'
          ? 'bg-gray-100 text-gray-700'
          : 'bg-red-100 text-red-800';
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${color}`}>
      {label}: {source}
    </span>
  );
}

function Card({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="mt-0.5 text-xs text-gray-500">{label}</div>
    </div>
  );
}

function Unavailable({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</div>
      <p className="mt-1 text-sm text-gray-500">{reason}</p>
    </div>
  );
}

/**
 * FOLLOW-560 (audit A3-F-09/F-10) — cosine vs. djb2 reorder ranking over the window.
 *
 * `cosine: 0` alongside a large `djb2_*` count is the finding this panel exists to make visible:
 * reorder-capable requests are not being ranked on embeddings. Before FOLLOW-1202 those batches
 * were served a session-stable hash order; since FOLLOW-1202 they get no reorder at all (CEO
 * decision #3), so the `djb2_*` cards are labelled by what both eras share — no cosine.
 */
function ScoringPathPanel({ data }: { data: TenantAnalyticsRollup }) {
  const split = data.scoringPathSplit;
  const title = 'Scoring Path (cosine vs. djb2)';

  if (split === null) {
    return (
      <Unavailable
        title={title}
        reason={
          data.scoring_path_source === 'disabled'
            ? 'SCORING_PATH_COLUMN_ENABLED is not set on this deployment — adaptation_decisions.scoring_path is not queried here. Expected until ClickHouse migration 0022 is applied (FOLLOW-820).'
            : 'The scoring_path query failed on this instance. No number is shown rather than a fabricated zero split.'
        }
      />
    );
  }

  const total = split.cosine + split.djb2_fallback + split.djb2_guard + split.not_applicable;
  const ranked = split.cosine + split.djb2_fallback + split.djb2_guard;
  const cosinePct = ranked > 0 ? (split.cosine / ranked) * 100 : null;

  return (
    <div className="mb-6">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {title} · {total} decisions
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Card label="cosine" value={split.cosine} />
        <Card label="no cosine: embeddings missing" value={split.djb2_fallback} />
        <Card label="no cosine: not attempted" value={split.djb2_guard} />
        <Card label="no reorder" value={split.not_applicable} />
        <Card
          label="Real ranking share"
          value={cosinePct === null ? '—' : `${cosinePct.toFixed(1)}%`}
        />
      </div>
    </div>
  );
}

/**
 * FOLLOW-1220 — withheld reorders by reason, from `features_snapshot.reorder_withheld` (no flag).
 * Counts only rows written by a plane at `e78146fe` or later; an 'error' source renders a reason,
 * never a zero.
 */
function ReorderWithheldPanel({ data }: { data: TenantAnalyticsRollup }) {
  const counts = data.reorderWithheld;
  const title = 'Reorder withheld (by reason)';

  if (counts === null) {
    return (
      <Unavailable
        title={title}
        reason="The reorder_withheld query failed on this instance. No number is shown rather than a fabricated zero."
      />
    );
  }

  return (
    <div className="mb-6">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {title}
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Card label="withheld: embeddings missing" value={counts.embeddings_missing} />
        <Card label="withheld: not attempted" value={counts.embeddings_not_attempted} />
        <Card label="withheld: lookup failed" value={counts.embeddings_lookup_failed} />
      </div>
    </div>
  );
}

/** Both panels for the tenant the page resolved, or the rollup's error — never invented numbers. */
export function DecisionTelemetryPanels({ result }: { result: RollupResult }) {
  return (
    <section aria-labelledby="decision-telemetry-heading" className="mt-10">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 id="decision-telemetry-heading" className="text-lg font-semibold text-gray-900">
            Decision telemetry
          </h2>
          {result.ok && (
            <p className="mt-1 text-xs text-gray-400">
              Window: last {result.data.window_days} days · Generated{' '}
              {new Date(result.data.generated_at).toLocaleString()}
            </p>
          )}
        </div>
        {result.ok && (
          <div className="flex items-center gap-2">
            <SourceBadge source={result.data.scoring_path_source} label="scoring_path" />
            <SourceBadge source={result.data.reorder_withheld_source} label="reorder_withheld" />
          </div>
        )}
      </div>

      {/* Rule K.2: a configured-but-failing store renders its error, never fabricated panels. */}
      {!result.ok && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <strong>Error loading decision telemetry:</strong> {result.error}
        </div>
      )}

      {result.ok && (
        <>
          <ScoringPathPanel data={result.data} />
          <ReorderWithheldPanel data={result.data} />
        </>
      )}
    </section>
  );
}
