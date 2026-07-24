'use client';

/**
 * /dashboard/demo/override — DEMO MODE Archetype Simulator
 *
 * Lets an admin toggle DEMO MODE on/off and choose which archetype + LLM model
 * to force for ALL visitors to their listing pages. When DEMO MODE is ON, the
 * server-side adapt endpoint ignores the SDK's detected archetype and uses the
 * chosen one instead — making it easy to show a client how the DOM adapts for
 * a specific buyer persona.
 *
 * This is the in-product equivalent of scripts/dev/mock-decision-server.mjs.
 *
 * @module apps/control-plane/src/app/dashboard/demo/override/page
 */

import { useEffect, useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface OverrideState {
  enabled: boolean;
  override_archetype: string | null;
  override_model: string;
  archetypes: readonly string[];
  models: readonly string[];
}

// ─── Labels ──────────────────────────────────────────────────────────────────

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

const DEFAULT_ARCHETYPES = [
  'yield_hunter',
  'vacation_rental_investor',
  'flip_investor',
  'portfolio_builder',
  'family_buyer',
  'first_time_buyer',
  'upsizer',
  'downsizer',
  'luxury_buyer',
  'remote_worker',
  'lifestyle_expat',
  'second_home_buyer',
  'neutral',
] as const;

const DEFAULT_MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-8',
] as const;

// ─── Page component ───────────────────────────────────────────────────────────

export default function DemoOverridePage() {
  const [state, setState] = useState<OverrideState>({
    enabled: false,
    override_archetype: DEFAULT_ARCHETYPES[0],
    override_model: 'claude-sonnet-4-6',
    archetypes: DEFAULT_ARCHETYPES,
    models: DEFAULT_MODELS,
  });
  const [status, setStatus] = useState<'idle' | 'loading' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  // FOLLOW-630 (RETRO-206, mirrors FOLLOW-624/ESC-039): tracked SEPARATELY from
  // `status` (which is save-only). A failed GET — including a non-2xx body that
  // was previously parsed as config because there was NO `!r.ok` guard — must
  // render its own visible error and disable Save. Otherwise a 500 renders DEMO
  // MODE OFF silently, and a Save PUTs that fabricated state, clobbering the
  // tenant's real live demo override.
  const [loadStatus, setLoadStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [loadErrorMsg, setLoadErrorMsg] = useState('');
  const [retryNonce, setRetryNonce] = useState(0);

  // Load current override state on mount.
  useEffect(() => {
    setLoadStatus('loading');
    setLoadErrorMsg('');
    void fetch('/api/demo/override')
      .then((r) => {
        // FOLLOW-630: the missing guard. Without it a 500 error body was parsed
        // as config, silently rendering DEMO MODE OFF.
        if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
        return r.json();
      })
      .then((data: unknown) => {
        if (data && typeof data === 'object') {
          const d = data as Partial<OverrideState>;
          setState((prev) => ({
            enabled: d.enabled ?? false,
            override_archetype:
              d.override_archetype ?? prev.override_archetype ?? DEFAULT_ARCHETYPES[0],
            override_model: d.override_model ?? 'claude-sonnet-4-6',
            archetypes: d.archetypes ?? DEFAULT_ARCHETYPES,
            models: d.models ?? DEFAULT_MODELS,
          }));
        }
        setLoadStatus('loaded');
      })
      .catch((err: unknown) => {
        // Rule K.2 consumer-side clause (FOLLOW-630): do NOT silently keep
        // DEFAULTS looking like real stored config — a Save from this state
        // would clobber the tenant's real demo override.
        setLoadErrorMsg(err instanceof Error ? err.message : 'Failed to load settings.');
        setLoadStatus('error');
      });
  }, [retryNonce]);

  async function handleSave(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    // Defense in depth (FOLLOW-630): even if the disabled Save button is bypassed
    // (e.g. an implicit form submit), never PUT from un-loaded/errored state.
    if (loadStatus !== 'loaded') return;
    setStatus('loading');
    setErrorMsg('');

    try {
      const res = await fetch('/api/demo/override', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: state.enabled,
          override_archetype: state.enabled ? state.override_archetype : null,
          override_model: state.override_model,
        }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        setErrorMsg(body.error?.message ?? 'Failed to save.');
        setStatus('error');
        return;
      }

      const saved = (await res.json()) as Partial<OverrideState>;
      setState((prev) => ({
        ...prev,
        enabled: saved.enabled ?? prev.enabled,
        override_archetype: saved.override_archetype ?? prev.override_archetype,
        override_model: saved.override_model ?? prev.override_model,
      }));
      setStatus('saved');
      setTimeout(() => {
        setStatus('idle');
      }, 2500);
    } catch {
      setErrorMsg('Network error — please try again.');
      setStatus('error');
    }
  }

  function handleToggle() {
    setState((prev) => ({ ...prev, enabled: !prev.enabled }));
  }

  const archetypeList =
    (state.archetypes as string[]).length > 0
      ? (state.archetypes as string[])
      : [...DEFAULT_ARCHETYPES];

  const modelList =
    (state.models as string[]).length > 0 ? (state.models as string[]) : [...DEFAULT_MODELS];

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Archetype Simulator</h1>
        <p className="mt-1 text-sm text-gray-500">
          Force a specific buyer archetype + LLM model for ALL visitors. Use this to show a client
          how their listing page adapts in real time. When DEMO MODE is ON, the server ignores the
          SDK&apos;s detected archetype and uses your chosen persona instead — exactly like the
          local{' '}
          <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">mock-decision-server.mjs</code>.
        </p>
      </div>

      {/* Load-failure banner — FOLLOW-630 */}
      {loadStatus === 'error' && (
        <div role="alert" className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>Failed to load demo override settings: {loadErrorMsg}</p>
          <p className="mt-1 text-xs">
            Saving is disabled until settings load successfully — this prevents overwriting your
            real DEMO MODE override with blank defaults.
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
      )}

      {/* Status banner */}
      {state.enabled && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>DEMO MODE is ON.</strong> Every visitor to your listing pages will see the{' '}
          <strong>
            {ARCHETYPE_LABELS[state.override_archetype ?? 'neutral'] ?? state.override_archetype}
          </strong>{' '}
          persona, generated with{' '}
          <strong>{MODEL_LABELS[state.override_model] ?? state.override_model}</strong>. Decisions
          are tagged{' '}
          <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">demo_override=true</code> and
          excluded from pilot analytics.
        </div>
      )}

      {!state.enabled && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
          DEMO MODE is off. The SDK&apos;s detected archetype drives all decisions normally.
        </div>
      )}

      {/* Form */}
      <form onSubmit={(e) => void handleSave(e)} className="space-y-6">
        {/* Toggle */}
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
            onClick={handleToggle}
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
              setState((prev) => ({ ...prev, override_archetype: e.target.value }));
            }}
            disabled={!state.enabled}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-50"
          >
            {archetypeList.map((a) => (
              <option key={a} value={a}>
                {ARCHETYPE_LABELS[a] ?? a}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            The headline, feature copy, and long-form description will be generated for this
            persona.
          </p>
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
              setState((prev) => ({ ...prev, override_model: e.target.value }));
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
          <p className="mt-1 text-xs text-gray-500">
            Switching models clears the description cache so fresh copy regenerates.
          </p>
        </div>

        {/* Save button */}
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={status === 'loading' || loadStatus !== 'loaded'}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === 'loading' ? 'Saving...' : 'Save'}
          </button>

          {status === 'saved' && <span className="text-sm font-medium text-green-600">Saved.</span>}
          {status === 'error' && (
            <span className="text-sm font-medium text-red-600">{errorMsg}</span>
          )}
        </div>
      </form>

      {/* Info footer */}
      <div className="mt-8 rounded-lg border border-gray-200 bg-white p-4 text-xs text-gray-500">
        <p className="font-medium text-gray-700">How it works</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>
            When ON, the server ignores the archetype the SDK detects and forces your chosen persona
            at high confidence.
          </li>
          <li>
            The headline slot and feature copy change immediately. The long-form description uses a
            cached AI generation per archetype + model combination (populated asynchronously on
            first request).
          </li>
          <li>
            Switching model clears the description cache so copy regenerates with the new model.
          </li>
          <li>
            Decisions made while DEMO MODE is on are tagged{' '}
            <code className="rounded bg-gray-100 px-1">demo_override=true</code> and excluded from
            pilot analytics.
          </li>
          <li>Turn DEMO MODE off before real traffic measurements to avoid contamination.</li>
        </ul>
      </div>
    </main>
  );
}
