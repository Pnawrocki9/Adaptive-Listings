'use client';

/**
 * StaffDemoOverrideEditor — minimal Estalara-staff editor for a tenant's DEMO MODE
 * archetype + model override (ADR-0018 §6 Phase 2 / FOLLOW-596).
 *
 * SURFACE DECISION (ticket FOLLOW-596, mirrors FOLLOW-595): the agency editor
 * (`apps/control-plane/src/app/dashboard/demo/override/page.tsx`) is NOT extracted into
 * a shared `tenantId`-prop component. Reason: that page is tightly coupled to the agency
 * session and carries a lot of explanatory chrome; a MINIMAL staff surface that only
 * reads/writes the override via `/api/demo/override?tenant_id=<id>` (which IS staff-
 * ported) keeps this ticket small. Both surfaces share the same route + response shape.
 *
 * Every fetch carries `?tenant_id=<tenantId>` so the staff-override API path fences its
 * `createAdminClient()` query to that tenant (ADR-0018 §2 invariant 5).
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/demo/demo-override-editor
 */

import { useEffect, useState } from 'react';

/** The override fields this staff surface can edit. */
interface StaffDemoOverride {
  enabled: boolean;
  override_archetype: string | null;
  override_model: string;
  archetypes: readonly string[];
  models: readonly string[];
}

const ARCHETYPE_LABELS: Record<string, string> = {
  yield_hunter: 'Yield Hunter',
  vacation_rental_investor: 'Vacation Rental Investor',
  flip_investor: 'Flip Investor',
  portfolio_builder: 'Portfolio Builder',
  family_buyer: 'Family Buyer',
  first_time_buyer: 'First-Time Buyer',
  upsizer: 'Upsizer',
  downsizer: 'Downsizer',
  luxury_buyer: 'Luxury Buyer',
  remote_worker: 'Remote Worker',
  lifestyle_expat: 'Lifestyle Expat',
  second_home_buyer: 'Second-Home Buyer',
  neutral: 'Neutral (no adaptation)',
};

const MODEL_LABELS: Record<string, string> = {
  'claude-haiku-4-5-20251001': 'Haiku 4.5 — fast / low cost',
  'claude-sonnet-4-6': 'Sonnet 4.6 — balanced (default)',
  'claude-opus-4-8': 'Opus 4.8 — max quality',
};

const DEFAULTS: StaffDemoOverride = {
  enabled: false,
  override_archetype: null,
  override_model: 'claude-sonnet-4-6',
  archetypes: [],
  models: [],
};

export function StaffDemoOverrideEditor({ tenantId }: { tenantId: string }): React.JSX.Element {
  const [state, setState] = useState<StaffDemoOverride>(DEFAULTS);
  const [status, setStatus] = useState<'idle' | 'loading' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Every call is fenced to this tenant via ?tenant_id — the staff-override API path.
  const url = `/api/demo/override?tenant_id=${encodeURIComponent(tenantId)}`;

  useEffect(() => {
    void fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
        return r.json();
      })
      .then((data: unknown) => {
        if (data && typeof data === 'object') {
          const d = data as Partial<StaffDemoOverride>;
          setState((prev) => ({
            enabled: d.enabled ?? false,
            override_archetype: d.override_archetype ?? null,
            override_model: d.override_model ?? prev.override_model,
            archetypes: d.archetypes ?? prev.archetypes,
            models: d.models ?? prev.models,
          }));
        }
      })
      .catch(() => {
        // Load silently — defaults already set; a save still fails loud below.
      });
  }, [url]);

  async function handleSave(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setStatus('loading');
    setErrorMsg('');
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: state.enabled,
          override_archetype: state.enabled ? state.override_archetype : null,
          override_model: state.override_model,
        }),
      });
      if (!res.ok) {
        const bodyUnknown: unknown = await res.json().catch(() => ({}));
        const body = bodyUnknown as { error?: string | { message?: string } };
        const msg =
          typeof body.error === 'string' ? body.error : (body.error?.message ?? 'Failed to save.');
        setErrorMsg(msg);
        setStatus('error');
        return;
      }
      setStatus('saved');
      setTimeout(() => {
        setStatus('idle');
      }, 2500);
    } catch {
      setErrorMsg('Network error. Please try again.');
      setStatus('error');
    }
  }

  const archetypeList = [...state.archetypes];
  const modelList = [...state.models];

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
      {state.enabled && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>DEMO MODE is ON.</strong> Every visitor to this tenant&apos;s listing pages will
          see the{' '}
          <strong>
            {ARCHETYPE_LABELS[state.override_archetype ?? 'neutral'] ?? state.override_archetype}
          </strong>{' '}
          persona, generated with{' '}
          <strong>{MODEL_LABELS[state.override_model] ?? state.override_model}</strong>. Decisions
          are tagged <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">demo_override</code>{' '}
          and excluded from pilot analytics.
        </div>
      )}

      <form onSubmit={(e) => void handleSave(e)} className="space-y-6">
        {/* Enable toggle */}
        <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4">
          <div>
            <p className="text-sm font-medium text-gray-900">Enable DEMO MODE</p>
            <p className="text-xs text-gray-500">
              Overrides all archetype detection for this tenant.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={state.enabled}
            aria-label={state.enabled ? 'Disable DEMO MODE' : 'Enable DEMO MODE'}
            onClick={() => {
              setState((s) => ({ ...s, enabled: !s.enabled }));
            }}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
              state.enabled ? 'bg-blue-600' : 'bg-gray-200'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                state.enabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Archetype dropdown */}
        <div className={state.enabled ? '' : 'pointer-events-none opacity-50'}>
          <label htmlFor="archetype" className="mb-1 block text-sm font-medium text-gray-700">
            Buyer Archetype
          </label>
          <select
            id="archetype"
            value={state.override_archetype ?? ''}
            onChange={(e) => {
              setState((s) => ({ ...s, override_archetype: e.target.value }));
            }}
            disabled={!state.enabled}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-50"
          >
            <option value="" disabled>
              Select an archetype…
            </option>
            {archetypeList.map((a) => (
              <option key={a} value={a}>
                {ARCHETYPE_LABELS[a] ?? a}
              </option>
            ))}
          </select>
        </div>

        {/* Model dropdown */}
        <div className={state.enabled ? '' : 'pointer-events-none opacity-50'}>
          <label htmlFor="model" className="mb-1 block text-sm font-medium text-gray-700">
            Generation Model
          </label>
          <select
            id="model"
            value={state.override_model}
            onChange={(e) => {
              setState((s) => ({ ...s, override_model: e.target.value }));
            }}
            disabled={!state.enabled}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-50"
          >
            {modelList.map((m) => (
              <option key={m} value={m}>
                {MODEL_LABELS[m] ?? m}
              </option>
            ))}
          </select>
        </div>

        {status === 'error' && (
          <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMsg}
          </div>
        )}

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={status === 'loading'}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {status === 'loading' ? 'Saving…' : 'Save Settings'}
          </button>
          {status === 'saved' && (
            <span className="text-sm font-medium text-green-600">Settings saved!</span>
          )}
        </div>
      </form>
    </div>
  );
}
