'use client';

/**
 * GenerationModelSettings — shared "Content Generation Model" panel.
 *
 * Rendered by BOTH settings surfaces:
 *   - /admin/settings      (Estalara staff — the only accounts that can PUT, FOLLOW-456)
 *   - /dashboard/settings  (agency:admin/owner — read + save attempt; PUT is rejected
 *                           server-side for non-staff, surfaced via the error state)
 *
 * Extracted from /dashboard/settings/page.tsx (FOLLOW-161) when the /admin surface
 * was added (Phase 0 of the superadmin-access work, 2026-07-20) — one component,
 * two thin page wrappers, so the two zones cannot drift apart (the same
 * hand-maintained-copy failure class RETRO-179..186 closed for archetype IDs).
 *
 * Talks to GET/PUT /api/admin/generation-model; auth is entirely server-side
 * (session cookies ride the fetch). The generation model is the model used for
 * async long-form description generation (description.requested Modal job).
 * It is a GLOBAL default — no per-tenant override (CEO decision 2026-06-01;
 * potential per-tenant override is an open question in the superadmin-access ADR).
 *
 * Chat/intent classifier model is NOT shown here. Its <500ms latency budget
 * locks it to a Haiku-class model (FOLLOW-087); it is not selectable.
 *
 * @module apps/control-plane/src/components/generation-model-settings
 */

import { useEffect, useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface GenerationModelState {
  generation_model: string;
  allowed_models: string[];
  is_default: boolean;
  updated_at: string | null;
}

// ─── Cost/latency hints per model (FOLLOW-161 AC2) ───────────────────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

export default function GenerationModelSettings() {
  const [state, setState] = useState<GenerationModelState>({
    generation_model: 'claude-sonnet-4-6',
    allowed_models: DEFAULT_MODELS,
    is_default: true,
    updated_at: null,
  });
  const [status, setStatus] = useState<'idle' | 'loading' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  // FOLLOW-630 (RETRO-206, mirrors FOLLOW-624/ESC-039): tracked SEPARATELY from
  // `status` (which is save-only). A failed GET — including a non-2xx body that
  // was previously parsed as config because there was NO `!r.ok` guard — must
  // render its own visible error and disable Save. Otherwise a staff Save would
  // PUT the `claude-sonnet-4-6` default, resetting the GLOBAL generation model
  // and busting the description cache. Shared by /admin/settings AND
  // /dashboard/settings, so the guard covers both zones from one file.
  const [loadStatus, setLoadStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [loadErrorMsg, setLoadErrorMsg] = useState('');
  const [retryNonce, setRetryNonce] = useState(0);

  // Load current global config on mount.
  useEffect(() => {
    setLoadStatus('loading');
    setLoadErrorMsg('');
    void fetch('/api/admin/generation-model')
      .then((r) => {
        // FOLLOW-630: the missing guard. Without it a non-2xx body was parsed as
        // config, silently rendering the default model as if it were stored.
        if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
        return r.json();
      })
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
        setLoadStatus('loaded');
      })
      .catch((err: unknown) => {
        // Rule K.2 consumer-side clause (FOLLOW-630): do NOT silently keep the
        // default model looking like the real stored global config — a Save from
        // this state would clobber it.
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
    <section className="rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="text-base font-semibold text-gray-900">Content Generation Model</h2>
      <p className="mt-1 text-sm text-gray-500">
        The AI model used to generate buyer-adapted listing descriptions (async, cached). This is a{' '}
        <strong>global default</strong> — applies to all tenants. Changing it busts the description
        cache so new copy regenerates with the selected model.
      </p>

      {/* Note about classifier model — FOLLOW-161 AC4 */}
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

      {loadStatus === 'error' && (
        <div role="alert" className="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>Failed to load the generation model setting: {loadErrorMsg}</p>
          <p className="mt-1 text-xs">
            Saving is disabled until it loads successfully — this prevents overwriting the stored
            global model with the blank default.
          </p>
          <button
            type="button"
            onClick={() => {
              setRetryNonce((n) => n + 1);
            }}
            className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
          >
            Retry
          </button>
        </div>
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
            disabled={status === 'loading' || loadStatus !== 'loaded'}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === 'loading' ? 'Saving...' : 'Save Settings'}
          </button>

          {status === 'saved' && <span className="text-sm font-medium text-green-600">Saved.</span>}
          {status === 'error' && (
            <span className="text-sm font-medium text-red-600">{errorMsg}</span>
          )}
        </div>
      </form>
    </section>
  );
}
