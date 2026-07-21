'use client';

/**
 * StaffLabelsEditor — minimal Estalara-staff editor for a tenant's conversion labels
 * (ADR-0018 §6 Phase 2 / FOLLOW-597).
 *
 * SURFACE DECISION (mirrors FOLLOW-595's `StaffQuizConfigEditor`): the agency labels
 * page (`dashboard/analytics/labels/page.tsx`) also renders a Calibration/Aggregate
 * panel backed by `GET /api/pilot/calibration`, which has NO staff-override port yet —
 * pulling it in would drag an out-of-scope route into this ticket. This is a MINIMAL
 * staff surface: the first page of joined label rows for the tenant, with inline
 * reclassify (no filters/pagination — a follow-up if staff need to page past 25 rows).
 *
 * Canonical types imported from route-helpers — never redeclared inline (Rule H /
 * the pattern RETRO-005/008/013/015 flagged).
 *
 * Every GET carries `?tenant_id=<tenantId>` so the staff-override API path fences its
 * `createAdminClient()` query to that tenant (ADR-0018 §2 invariant 5).
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/labels/labels-editor
 */

import { useEffect, useState } from 'react';

import type {
  AdminLabelsResponse,
  JoinedLabelRow,
} from '../../../../api/admin/labels/route-helpers';

const OUTCOME_CLASSES = [
  'viewing_booked',
  'offer_made',
  'contract_signed',
  'purchased',
  'lost',
  'no_response',
] as const;

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

interface RowEditState {
  outcomeClass: string;
  notes: string;
  saving: boolean;
  error: string | null;
}

export function StaffLabelsEditor({ tenantId }: { tenantId: string }): React.JSX.Element {
  const [data, setData] = useState<AdminLabelsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowState, setRowState] = useState<Record<string, RowEditState>>({});

  // Every call is fenced to this tenant via ?tenant_id — the staff-override API path.
  const listUrl = `/api/admin/labels?tenant_id=${encodeURIComponent(tenantId)}&page=1&page_size=25`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void fetch(listUrl)
      .then(async (r) => {
        const json = (await r.json()) as AdminLabelsResponse & { error?: { message?: string } };
        if (!r.ok) throw new Error(json.error?.message ?? `HTTP ${String(r.status)}`);
        if (cancelled) return;
        setData(json);
        const nextState: Record<string, RowEditState> = {};
        for (const row of json.rows) {
          nextState[row.label.id] = {
            outcomeClass: row.label.outcome_class,
            notes: row.label.notes ?? '',
            saving: false,
            error: null,
          };
        }
        setRowState(nextState);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load labels.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [listUrl]);

  async function handleReclassify(labelId: string): Promise<void> {
    const current = rowState[labelId];
    if (!current) return;
    setRowState((prev) => ({ ...prev, [labelId]: { ...current, saving: true, error: null } }));

    try {
      const res = await fetch(`/api/admin/labels/${encodeURIComponent(labelId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome_class: current.outcomeClass,
          ...(current.notes.trim() ? { notes: current.notes.trim() } : {}),
        }),
      });
      const json = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        setRowState((prev) => ({
          ...prev,
          [labelId]: { ...current, saving: false, error: json.error?.message ?? 'Save failed.' },
        }));
        return;
      }

      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          rows: prev.rows.map((row: JoinedLabelRow) =>
            row.label.id === labelId
              ? {
                  ...row,
                  label: {
                    ...row.label,
                    outcome_class: current.outcomeClass,
                    label_source: 'manual_admin',
                    updated_at: new Date().toISOString(),
                  },
                }
              : row,
          ),
        };
      });
      setRowState((prev) => ({ ...prev, [labelId]: { ...current, saving: false, error: null } }));
    } catch (err: unknown) {
      setRowState((prev) => ({
        ...prev,
        [labelId]: {
          ...current,
          saving: false,
          error: err instanceof Error ? err.message : 'Network error.',
        },
      }));
    }
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Prediction + Outcome Labels</h2>
        {!loading && data?.data_source !== 'real' && <MockDataBadge />}
      </div>

      {loadError && (
        <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
      )}

      {loading && <p className="text-sm text-gray-400">Loading labels…</p>}

      {!loading && !loadError && (data?.rows.length ?? 0) === 0 && (
        <p className="text-sm text-gray-400">No labels found for this tenant.</p>
      )}

      {!loading && !loadError && (data?.rows.length ?? 0) > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="pb-2 font-medium">Labeled At</th>
                <th className="pb-2 font-medium">Archetype</th>
                <th className="pb-2 font-medium">Source</th>
                <th className="pb-2 font-medium">Outcome</th>
                <th className="pb-2 font-medium">Notes</th>
                <th className="pb-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(data?.rows ?? []).map((row: JoinedLabelRow) => {
                const state = rowState[row.label.id];
                if (!state) return null;
                return (
                  <tr key={row.label.id}>
                    <td className="py-2 text-xs text-gray-500">
                      {new Date(row.label.labeled_at).toLocaleDateString()}
                    </td>
                    <td className="py-2 text-gray-700">{row.prediction?.archetype ?? '—'}</td>
                    <td className="py-2 text-xs text-gray-500">{row.label.label_source}</td>
                    <td className="py-2">
                      <select
                        aria-label={`Outcome class for ${row.label.id}`}
                        value={state.outcomeClass}
                        onChange={(e) => {
                          setRowState((prev) => ({
                            ...prev,
                            [row.label.id]: { ...state, outcomeClass: e.target.value },
                          }));
                        }}
                        className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800 focus:outline-none"
                      >
                        {OUTCOME_CLASSES.map((cls) => (
                          <option key={cls} value={cls}>
                            {cls.replace(/_/g, ' ')}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2">
                      <input
                        type="text"
                        aria-label={`Notes for ${row.label.id}`}
                        value={state.notes}
                        maxLength={2000}
                        onChange={(e) => {
                          setRowState((prev) => ({
                            ...prev,
                            [row.label.id]: { ...state, notes: e.target.value },
                          }));
                        }}
                        className="w-40 rounded-lg border border-gray-300 px-2 py-1 text-xs text-gray-800 focus:outline-none"
                      />
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        disabled={state.saving}
                        onClick={() => {
                          void handleReclassify(row.label.id);
                        }}
                        className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                      >
                        {state.saving ? 'Saving…' : 'Reclassify'}
                      </button>
                      {state.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
