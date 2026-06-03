'use client';

/**
 * /dashboard/settings — Admin Settings
 *
 * Global admin settings panel. Currently surfaces the global LLM generation
 * model selector (FOLLOW-161). Visible to agency:admin and agency:owner only.
 *
 * The generation model is the model used for async long-form description
 * generation (description.requested Modal job). It is a GLOBAL default —
 * no per-tenant override (CEO decision 2026-06-01).
 *
 * Chat/intent classifier model is NOT shown here. Its <500ms latency
 * budget locks it to a Haiku-class model (FOLLOW-087); it is not selectable.
 *
 * @module apps/control-plane/src/app/dashboard/settings/page
 */

import { useEffect, useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface GenerationModelState {
  generation_model: string;
  allowed_models: string[];
  is_default: boolean;
  updated_at: string | null;
}

// ─── Cost/latency hints per model (AC2) ──────────────────────────────────────

const MODEL_HINTS: Record<string, { label: string; hint: string }> = {
  'claude-haiku-4-5-20251001': {
    label: 'Haiku 4.5',
    hint: 'Fast · Low cost (~$0.01–0.02/description)',
  },
  'claude-sonnet-4-6': {
    label: 'Sonnet 4.6',
    hint: 'Balanced · Default (~$0.01–0.03/description)',
  },
  'claude-opus-4-8': {
    label: 'Opus 4.8',
    hint: 'Max quality · Slower (~$0.05–0.15/description)',
  },
};

const DEFAULT_MODELS = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-8'];

// ─── Page component ───────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [state, setState] = useState<GenerationModelState>({
    generation_model: 'claude-sonnet-4-6',
    allowed_models: DEFAULT_MODELS,
    is_default: true,
    updated_at: null,
  });
  const [status, setStatus] = useState<'idle' | 'loading' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Load current global config on mount.
  useEffect(() => {
    void fetch('/api/admin/generation-model')
      .then((r) => r.json())
      .then((data: unknown) => {
        if (data && typeof data === 'object') {
          const d = data as Partial<GenerationModelState>;
          setState({
            generation_model: d.generation_model ?? 'claude-sonnet-4-6',
            allowed_models:
              Array.isArray(d.allowed_models) && d.allowed_models.length > 0
                ? d.allowed_models
                : DEFAULT_MODELS,
            is_default: d.is_default ?? true,
            updated_at: d.updated_at ?? null,
          });
        }
      })
      .catch(() => {
        // Load silently — defaults already set.
      });
  }, []);

  async function handleSave(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setStatus('loading');
    setErrorMsg('');

    try {
      const res = await fetch('/api/admin/generation-model', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generation_model: state.generation_model }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        setErrorMsg(body.error?.message ?? 'Failed to save.');
        setStatus('error');
        return;
      }

      const saved = (await res.json()) as Partial<GenerationModelState>;
      setState((prev) => ({
        ...prev,
        generation_model: saved.generation_model ?? prev.generation_model,
        is_default: saved.is_default ?? prev.is_default,
        updated_at: saved.updated_at ?? prev.updated_at,
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

  const modelList = state.allowed_models.length > 0 ? state.allowed_models : DEFAULT_MODELS;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Admin Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Global configuration for your Estalara workspace. Changes take effect for new content
          generations immediately. Cached content will regenerate on the next request after a model
          switch.
        </p>
      </div>

      {/* Generation model section */}
      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-base font-semibold text-gray-900">Content Generation Model</h2>
        <p className="mt-1 text-sm text-gray-500">
          The AI model used to generate buyer-adapted listing descriptions (async, cached). This is
          a <strong>global default</strong> — applies to all tenants. Changing it busts the
          description cache so new copy regenerates with the selected model.
        </p>

        {/* Note about classifier model — AC4 */}
        <p className="mt-2 text-xs text-gray-400">
          Note: the real-time chat/intent classifier model is not selectable — it stays Haiku-class
          for its &lt;500ms latency budget and is managed separately.
        </p>

        {state.updated_at && (
          <p className="mt-2 text-xs text-gray-400">
            Last updated:{' '}
            {new Date(state.updated_at).toLocaleString('en-GB', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </p>
        )}

        <form onSubmit={(e) => void handleSave(e)} className="mt-6 space-y-4">
          {/* Model picker */}
          <div>
            <label htmlFor="generation_model" className="block text-sm font-medium text-gray-700">
              Generation Model
            </label>
            <select
              id="generation_model"
              value={state.generation_model}
              onChange={(e) => {
                setState((prev) => ({ ...prev, generation_model: e.target.value }));
              }}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {modelList.map((m) => {
                const info = MODEL_HINTS[m];
                return (
                  <option key={m} value={m}>
                    {info ? `${info.label} — ${info.hint}` : m}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Cost/latency hints table */}
          <div className="rounded-md border border-gray-100 bg-gray-50 p-4">
            <p className="mb-2 text-xs font-medium text-gray-600">Model comparison</p>
            <table className="w-full text-xs text-gray-600">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="pb-1 font-medium">Model</th>
                  <th className="pb-1 font-medium">Speed</th>
                  <th className="pb-1 font-medium">Cost / description</th>
                  <th className="pb-1 font-medium">Quality</th>
                </tr>
              </thead>
              <tbody className="space-y-1">
                <tr>
                  <td className="py-0.5 pr-4 font-medium">Haiku 4.5</td>
                  <td className="py-0.5 pr-4">Fast (~3–5s)</td>
                  <td className="py-0.5 pr-4">~$0.01–0.02</td>
                  <td className="py-0.5">Good</td>
                </tr>
                <tr>
                  <td className="py-0.5 pr-4 font-medium">Sonnet 4.6</td>
                  <td className="py-0.5 pr-4">Balanced (~8–12s)</td>
                  <td className="py-0.5 pr-4">~$0.01–0.03</td>
                  <td className="py-0.5">
                    <span className="font-medium text-blue-700">Default — best value</span>
                  </td>
                </tr>
                <tr>
                  <td className="py-0.5 pr-4 font-medium">Opus 4.8</td>
                  <td className="py-0.5 pr-4">Slower (~20–40s)</td>
                  <td className="py-0.5 pr-4">~$0.05–0.15</td>
                  <td className="py-0.5">Highest quality</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Save button */}
          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={status === 'loading'}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === 'loading' ? 'Saving...' : 'Save Settings'}
            </button>

            {status === 'saved' && (
              <span className="text-sm font-medium text-green-600">Saved.</span>
            )}
            {status === 'error' && (
              <span className="text-sm font-medium text-red-600">{errorMsg}</span>
            )}
          </div>
        </form>
      </section>
    </main>
  );
}
