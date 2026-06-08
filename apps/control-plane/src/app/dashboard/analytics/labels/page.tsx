'use client';

/**
 * /dashboard/analytics/labels — Conversion Label Management page (FOLLOW-174).
 *
 * Two panels:
 *   1. Joined Prediction + Outcome table  — filterable by outcome_class, date range,
 *      model_version, pagination; each row has a "Reclassify" inline action that
 *      opens a modal to set a new outcome_class + notes (writes label_source=manual_admin).
 *   2. Calibration / Aggregate panel — renders the CalibrationResponse from
 *      GET /api/pilot/calibration (FOLLOW-173): conversion aggregates per
 *      (outcome_class, model_version) + the reliability curve decile table.
 *
 * Rule K.2 — fail loud:
 *   Both panels show a visible error banner on non-2xx responses; they do NOT
 *   coerce error bodies to zeros. The provenance field (data_source) is read and
 *   an observable "MOCK DATA" badge is shown when the server returns mock data.
 *
 * Canonical types imported from route-helpers — never redeclared inline
 * (prevents the drift that caused RETRO-005/008/013/015).
 *
 * @module apps/control-plane/src/app/dashboard/analytics/labels/page
 */

import { useEffect, useState, useCallback } from 'react';

// ─── Canonical types from route-helpers (FOLLOW-174 — no inline redeclaration) ─

import type { AdminLabelsResponse, JoinedLabelRow } from '../../../api/admin/labels/route-helpers';
import type {
  CalibrationResponse,
  CalibrationRow,
  ConversionAggRow,
} from '../../../api/pilot/calibration/route-helpers';

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

function LabelSourceBadge({ source }: { source: string }) {
  if (source === 'manual_admin') {
    return (
      <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800">
        manual admin
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
      system
    </span>
  );
}

// ─── Reclassify modal ─────────────────────────────────────────────────────────

const OUTCOME_CLASSES = [
  'viewing_booked',
  'offer_made',
  'contract_signed',
  'purchased',
  'lost',
  'no_response',
] as const;

interface ReclassifyModalProps {
  labelId: string;
  currentClass: string;
  onClose: () => void;
  onSuccess: (id: string, newClass: string) => void;
}

function ReclassifyModal({ labelId, currentClass, onClose, onSuccess }: ReclassifyModalProps) {
  const [outcomeClass, setOutcomeClass] = useState(currentClass);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/labels/${labelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome_class: outcomeClass,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      });
      if (!res.ok) {
        let msg = `HTTP ${String(res.status)}`;
        try {
          const body = (await res.json()) as {
            error?: { message?: string };
          };
          if (body.error?.message) msg = body.error.message;
        } catch {
          // keep the HTTP status string
        }
        setError(msg);
        return;
      }
      onSuccess(labelId, outcomeClass);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Reclassify label"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-base font-semibold text-gray-900">Reclassify Label</h2>
        {error && <ErrorBanner message={error} />}
        <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-4">
          <div>
            <label htmlFor="outcome-class" className="mb-1 block text-xs font-medium text-gray-700">
              Outcome class
            </label>
            <select
              id="outcome-class"
              value={outcomeClass}
              onChange={(e) => {
                setOutcomeClass(e.target.value);
              }}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none"
            >
              {OUTCOME_CLASSES.map((cls) => (
                <option key={cls} value={cls}>
                  {cls.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="notes" className="mb-1 block text-xs font-medium text-gray-700">
              Notes (optional)
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
              }}
              rows={3}
              maxLength={2000}
              placeholder="Rationale for reclassification…"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Filters bar ──────────────────────────────────────────────────────────────

interface Filters {
  outcome_class: string;
  model_version: string;
  date_from: string;
  date_to: string;
  page: number;
  page_size: number;
}

const DEFAULT_FILTERS: Filters = {
  outcome_class: '',
  model_version: '',
  date_from: '',
  date_to: '',
  page: 1,
  page_size: 25,
};

// ─── Panel 1 — Joined prediction + outcome table ─────────────────────────────

interface TablePanelProps {
  loading: boolean;
  data: AdminLabelsResponse | null;
  error: string | null;
  filters: Filters;
  onFilterChange: (next: Partial<Filters>) => void;
  onReclassify: (id: string, currentClass: string) => void;
}

function TablePanel({
  loading,
  data,
  error,
  filters,
  onFilterChange,
  onReclassify,
}: TablePanelProps) {
  const rows = data?.rows ?? [];

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">Prediction + Outcome Labels</h2>
          <p className="mt-0.5 text-xs text-gray-400">
            Joined adaptation_decisions (ClickHouse) and conversion_labels (Postgres). Manual
            reclassification writes label_source = manual_admin.
          </p>
        </div>
        {!loading && data?.data_source !== 'real' && <MockDataBadge />}
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <select
          aria-label="Filter by outcome class"
          value={filters.outcome_class}
          onChange={(e) => {
            onFilterChange({ outcome_class: e.target.value, page: 1 });
          }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 focus:outline-none"
        >
          <option value="">All outcome classes</option>
          {OUTCOME_CLASSES.map((cls) => (
            <option key={cls} value={cls}>
              {cls.replace(/_/g, ' ')}
            </option>
          ))}
        </select>

        <input
          type="text"
          aria-label="Filter by model version"
          placeholder="Model version filter…"
          value={filters.model_version}
          onChange={(e) => {
            onFilterChange({ model_version: e.target.value, page: 1 });
          }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none"
        />

        <input
          type="date"
          aria-label="Date from"
          value={filters.date_from}
          onChange={(e) => {
            onFilterChange({
              date_from: e.target.value ? new Date(e.target.value).toISOString() : '',
              page: 1,
            });
          }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 focus:outline-none"
        />

        <input
          type="date"
          aria-label="Date to"
          value={filters.date_to}
          onChange={(e) => {
            onFilterChange({
              date_to: e.target.value ? new Date(e.target.value).toISOString() : '',
              page: 1,
            });
          }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 focus:outline-none"
        />
      </div>

      {/* Error state */}
      {!loading && error && <ErrorBanner message={error} />}

      {/* Loading */}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && rows.length === 0 && (
        <p className="text-sm text-gray-400">No labels found for the selected filters.</p>
      )}

      {/* Table */}
      {!loading && !error && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="pb-2 font-medium">Labeled At</th>
                <th className="pb-2 font-medium">Prediction ID</th>
                <th className="pb-2 font-medium">Archetype</th>
                <th className="pb-2 font-medium">Model Version</th>
                <th className="pb-2 font-medium">Confidence</th>
                <th className="pb-2 font-medium">Outcome</th>
                <th className="pb-2 font-medium">Source</th>
                <th className="pb-2 font-medium">Notes</th>
                <th className="pb-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((row: JoinedLabelRow) => (
                <tr key={row.label.id}>
                  <td className="py-2 text-xs text-gray-500">
                    {new Date(row.label.labeled_at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="py-2 font-mono text-xs text-gray-500">
                    {row.label.prediction_id.slice(0, 12)}…
                  </td>
                  <td className="py-2 text-gray-700">
                    {row.prediction?.archetype ?? <span className="text-gray-400">—</span>}
                  </td>
                  <td className="py-2 text-xs text-gray-500">
                    {row.prediction?.model_version ?? <span className="text-gray-400">—</span>}
                  </td>
                  <td className="py-2 tabular-nums text-gray-700">
                    {row.prediction != null
                      ? (row.prediction.confidence * 100).toFixed(0) + '%'
                      : '—'}
                  </td>
                  <td className="py-2">
                    <OutcomeClassBadge cls={row.label.outcome_class} />
                  </td>
                  <td className="py-2">
                    <LabelSourceBadge source={row.label.label_source} />
                  </td>
                  <td className="max-w-[180px] truncate py-2 text-xs text-gray-400">
                    {row.label.notes ?? '—'}
                  </td>
                  <td className="py-2">
                    <button
                      type="button"
                      onClick={() => {
                        onReclassify(row.label.id, row.label.outcome_class);
                      }}
                      className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      Reclassify
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {!loading && data && data.total > data.page_size && (
        <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
          <span>
            Page {data.page} of {Math.ceil(data.total / data.page_size)} ({data.total} total)
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={data.page <= 1}
              onClick={() => {
                onFilterChange({ page: data.page - 1 });
              }}
              className="rounded-lg border border-gray-300 px-3 py-1 font-medium hover:bg-gray-50 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={data.page >= Math.ceil(data.total / data.page_size)}
              onClick={() => {
                onFilterChange({ page: data.page + 1 });
              }}
              className="rounded-lg border border-gray-300 px-3 py-1 font-medium hover:bg-gray-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Panel 2 — Calibration / aggregate view ───────────────────────────────────

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

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function LabelManagementPage() {
  // ── Labels table state ────────────────────────────────────────────────────
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [labelsLoading, setLabelsLoading] = useState(true);
  const [labelsData, setLabelsData] = useState<AdminLabelsResponse | null>(null);
  const [labelsError, setLabelsError] = useState<string | null>(null);

  // ── Calibration state ─────────────────────────────────────────────────────
  const [calibWindowDays, setCalibWindowDays] = useState<number>(7);
  const [calibLoading, setCalibLoading] = useState(true);
  const [calibData, setCalibData] = useState<CalibrationResponse | null>(null);
  const [calibError, setCalibError] = useState<string | null>(null);

  // ── Reclassify modal state ─────────────────────────────────────────────────
  const [modalOpen, setModalOpen] = useState(false);
  const [modalLabelId, setModalLabelId] = useState<string | null>(null);
  const [modalCurrentClass, setModalCurrentClass] = useState<string>('');

  // ── Fetch labels ──────────────────────────────────────────────────────────
  const fetchLabels = useCallback((f: Filters) => {
    setLabelsLoading(true);
    setLabelsError(null);

    const params = new URLSearchParams();
    if (f.outcome_class) params.set('outcome_class', f.outcome_class);
    if (f.model_version) params.set('model_version', f.model_version);
    if (f.date_from) params.set('date_from', f.date_from);
    if (f.date_to) params.set('date_to', f.date_to);
    params.set('page', String(f.page));
    params.set('page_size', String(f.page_size));

    fetch(`/api/admin/labels?${params.toString()}`)
      .then(async (res) => {
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
          setLabelsError(msg);
          setLabelsLoading(false);
          return;
        }
        const raw = (await res.json()) as unknown;
        if (raw && typeof raw === 'object' && 'rows' in raw) {
          setLabelsData(raw as AdminLabelsResponse);
        }
        setLabelsLoading(false);
      })
      .catch((err: unknown) => {
        setLabelsError(err instanceof Error ? err.message : 'Network error');
        setLabelsLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchLabels(filters);
  }, [filters, fetchLabels]);

  // ── Fetch calibration ─────────────────────────────────────────────────────
  useEffect(() => {
    setCalibLoading(true);
    setCalibError(null);

    fetch(`/api/pilot/calibration?window_days=${String(calibWindowDays)}`)
      .then(async (res) => {
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
          setCalibError(msg);
          setCalibLoading(false);
          return;
        }
        const raw = (await res.json()) as unknown;
        if (raw && typeof raw === 'object' && 'calibration' in raw) {
          setCalibData(raw as CalibrationResponse);
        }
        setCalibLoading(false);
      })
      .catch((err: unknown) => {
        setCalibError(err instanceof Error ? err.message : 'Network error');
        setCalibLoading(false);
      });
  }, [calibWindowDays]);

  // ── Filter change handler ─────────────────────────────────────────────────
  function handleFilterChange(next: Partial<Filters>) {
    setFilters((prev) => ({ ...prev, ...next }));
  }

  // ── Reclassify actions ────────────────────────────────────────────────────
  function openReclassify(id: string, currentClass: string) {
    setModalLabelId(id);
    setModalCurrentClass(currentClass);
    setModalOpen(true);
  }

  function handleReclassifySuccess(id: string, newClass: string) {
    // Optimistically update the local row so the user sees the change immediately.
    setLabelsData((prev: AdminLabelsResponse | null) => {
      if (!prev) return prev;
      return {
        ...prev,
        rows: prev.rows.map((row: JoinedLabelRow) =>
          row.label.id === id
            ? {
                ...row,
                label: {
                  ...row.label,
                  outcome_class: newClass,
                  label_source: 'manual_admin',
                  updated_at: new Date().toISOString(),
                },
              }
            : row,
        ),
      };
    });
  }

  return (
    <>
      {modalOpen && modalLabelId && (
        <ReclassifyModal
          labelId={modalLabelId}
          currentClass={modalCurrentClass}
          onClose={() => {
            setModalOpen(false);
            setModalLabelId(null);
          }}
          onSuccess={handleReclassifySuccess}
        />
      )}

      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Conversion Label Management</h1>
          <p className="mt-1 text-sm text-gray-500">
            Audit prediction vs outcome. Manually reclassify labels (label_source = manual_admin).
            Review calibration reliability curve.
          </p>
        </div>

        <div className="space-y-6">
          <TablePanel
            loading={labelsLoading}
            data={labelsData}
            error={labelsError}
            filters={filters}
            onFilterChange={handleFilterChange}
            onReclassify={openReclassify}
          />

          <CalibrationPanel
            loading={calibLoading}
            data={calibData}
            error={calibError}
            windowDays={calibWindowDays}
            onWindowChange={setCalibWindowDays}
          />
        </div>
      </div>
    </>
  );
}
