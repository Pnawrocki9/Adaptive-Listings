'use client';

/**
 * StaffIntentWeightsEditor — minimal Estalara-staff editor for a tenant's intent
 * weight override (ADR-0018 §6 Phase 2 / FOLLOW-597).
 *
 * SURFACE DECISION (mirrors FOLLOW-595's `StaffQuizConfigEditor`): rather than
 * reproduce the full per-archetype slider UI of the GLOBAL Weight Editor
 * (`admin/tracer/weights/page.tsx`), this is a MINIMAL staff surface — a single
 * JSON textarea for the `IntentWeights` blob (`priors`/`behavioral_damping`/
 * `signal_likelihoods`), all fields optional. This keeps the PR proportionate to
 * ticket scope; unifying with the global editor's richer widget UI is a follow-up.
 *
 * Every fetch carries `?tenant_id=<tenantId>` so the staff-override API path fences
 * its `createAdminClient()` query to that tenant (ADR-0018 §2 invariant 5).
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/intent/intent-weights-editor
 */

import { useEffect, useState } from 'react';

import type { AdminIntentConfigResponse } from '@estalara/shared';

export function StaffIntentWeightsEditor({ tenantId }: { tenantId: string }): React.JSX.Element {
  const [weightsText, setWeightsText] = useState('{}');
  const [isActive, setIsActive] = useState(false);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadLoading, setLoadLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');

  // Every call is fenced to this tenant via ?tenant_id — the staff-override API path.
  const url = `/api/admin/intent-weights?tenant_id=${encodeURIComponent(tenantId)}`;

  useEffect(() => {
    let cancelled = false;
    setLoadLoading(true);
    setLoadError(null);
    void fetch(url)
      .then(async (r) => {
        const json = (await r.json()) as AdminIntentConfigResponse & {
          error?: { message?: string };
        };
        if (!r.ok) {
          throw new Error(json.error?.message ?? `HTTP ${String(r.status)}`);
        }
        if (cancelled) return;
        setIsActive(json.is_active);
        setCreatedAt(json.created_at);
        setWeightsText(JSON.stringify(json.weights, null, 2));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load intent weights.');
      })
      .finally(() => {
        if (!cancelled) setLoadLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  async function handleSave(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();

    let weights: unknown;
    try {
      weights = JSON.parse(weightsText);
    } catch {
      setSaveStatus('error');
      setSaveError('Weights must be valid JSON.');
      return;
    }

    setSaveStatus('saving');
    setSaveError('');
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weights }),
      });
      const json = (await res.json()) as AdminIntentConfigResponse & {
        error?: { message?: string };
      };
      if (!res.ok) {
        setSaveError(json.error?.message ?? `HTTP ${String(res.status)}`);
        setSaveStatus('error');
        return;
      }
      setIsActive(json.is_active);
      setCreatedAt(json.created_at);
      setWeightsText(JSON.stringify(json.weights, null, 2));
      setSaveStatus('saved');
      setTimeout(() => {
        setSaveStatus('idle');
      }, 2500);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Network error. Please try again.');
      setSaveStatus('error');
    }
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
      {loadLoading && <p className="text-sm text-gray-400">Loading current override…</p>}

      {loadError && (
        <div role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
      )}

      {!loadLoading && !loadError && (
        <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
          <p className="text-xs text-gray-500">
            {isActive ? (
              <>
                Override active{createdAt ? ` since ${new Date(createdAt).toLocaleString()}` : ''}.
              </>
            ) : (
              'No override set — this tenant currently follows the global default weights.'
            )}
          </p>

          <div>
            <label
              htmlFor="intent-weights-json"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Weights (JSON — priors / behavioral_damping / signal_likelihoods)
            </label>
            <textarea
              id="intent-weights-json"
              rows={12}
              value={weightsText}
              onChange={(e) => {
                setWeightsText(e.target.value);
              }}
              className="w-full rounded-lg border border-gray-300 p-3 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {saveStatus === 'error' && (
            <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              {saveError}
            </div>
          )}

          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={saveStatus === 'saving'}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {saveStatus === 'saving' ? 'Saving…' : 'Save override'}
            </button>
            {saveStatus === 'saved' && (
              <span className="text-sm font-medium text-green-600">Saved!</span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
