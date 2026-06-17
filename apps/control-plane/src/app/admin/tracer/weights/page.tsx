'use client';

/**
 * K.3.6.3 — Weight Editor (global intent weight config)
 *
 * Consumes:
 *   GET  /api/admin/intent/config              (ADR-0013 — read current active global config)
 *   PUT  /api/admin/intent/config/[id]         (update an existing row — when id non-null)
 *   POST /api/admin/intent/config              (create a new active row — when no active row)
 *
 * Auth: Supabase session cookie (sb-access-token) sent automatically for same-origin fetch.
 * The admin middleware already gates /admin/* on a valid staff JWT cookie, so no explicit
 * Bearer token is needed here (ADR-0013 §Decision 2).
 *
 * Scope: global-only in v1 (CEO decision 2026-06-14). No per-tenant selector. The GET
 * route returns 400 if ?tenant_id= is supplied.
 *
 * Simulation: stub only (D-3 deferred — FOLLOW-282).
 *
 * Rule K.2: non-2xx or error field → visible error banner, never silent.
 *
 * @module apps/control-plane/src/app/admin/tracer/weights/page
 */

import React, { useCallback, useEffect, useState } from 'react';

import type { AdminIntentConfigResponse, IntentWeights } from '@estalara/shared';
import { ARCHETYPE_KEYS, INTENT_SIGNAL_KEYS, DEFAULT_INTENT_WEIGHTS } from '@estalara/shared';

// ─── Canonical defaults ─────────────────────────────────────────────────────────

/** behavioral_damping default (0.3) — DEFAULT_INTENT_WEIGHTS is the single source of truth. */
const DEFAULT_DAMPING = DEFAULT_INTENT_WEIGHTS.behavioral_damping ?? 0.3;

/**
 * Default priors keyed by archetype, derived from the canonical DEFAULT_INTENT_WEIGHTS
 * (SDK BASE_PRIOR). Every ARCHETYPE_KEYS entry is present; fall back to the neutral
 * floor only if a key were ever missing (it isn't — DEFAULT-3 test guards this).
 */
function defaultPriors(): Record<string, number> {
  const p: Record<string, number> = {};
  for (const k of ARCHETYPE_KEYS) p[k] = DEFAULT_INTENT_WEIGHTS.priors?.[k] ?? 0.04;
  return p;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function headers(): Record<string, string> {
  // Same-origin fetch — Supabase session cookie is sent automatically.
  // No explicit Authorization header needed for browser-session admin pages (ADR-0013).
  return { 'Content-Type': 'application/json' };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DataSourceBadge({ source }: { source: string }) {
  const color =
    source === 'live'
      ? 'bg-green-100 text-green-800'
      : source === 'mock'
        ? 'bg-yellow-100 text-yellow-800'
        : 'bg-red-100 text-red-800';
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${color}`}>
      data_source: {source}
    </span>
  );
}

/**
 * Slider row for a numeric value, constrained to [min, max].
 */
function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="w-44 shrink-0 text-xs text-gray-600" title={label}>
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          onChange(parseFloat(e.target.value));
        }}
        className="flex-1"
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v) && v >= min && v <= max) onChange(v);
        }}
        className="w-20 rounded border border-gray-200 px-1 py-0.5 text-xs"
      />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function WeightEditorPage() {
  // Current live config id — set from GET /api/admin/intent/config response.
  // Non-null when an active global row exists; null when no row (data_source 'false').
  const [configId, setConfigId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState<boolean>(false);
  const [dataSource, setDataSource] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadLoading, setLoadLoading] = useState(true);

  // Editor state — initialized to the canonical project defaults (BASE_PRIOR + 0.3
  // damping), NOT a uniform distribution. loadConfig overlays the live row on top.
  const [behavioralDamping, setBehavioralDamping] = useState(DEFAULT_DAMPING);
  const [priors, setPriors] = useState<Record<string, number>>(defaultPriors);
  const [signalLikelihoods, setSignalLikelihoods] = useState<
    Record<string, Record<string, number>>
  >({});

  // Save state
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Reset to canonical defaults ────────────────────────────────────────────────
  // Restores the project-agreed starting point (DEFAULT_INTENT_WEIGHTS): BASE_PRIOR
  // priors, 0.3 damping, and clears any signal_likelihood overrides (empty = SDK
  // internal SIGNAL_LIKELIHOODS table). Does NOT persist — operator must Save/Update.
  const resetToDefaults = useCallback(() => {
    setBehavioralDamping(DEFAULT_DAMPING);
    setPriors(defaultPriors());
    setSignalLikelihoods({});
    setSaveSuccess(false);
    setSaveError(null);
  }, []);

  // ── Load current config ──────────────────────────────────────────────────────
  const loadConfig = useCallback(async () => {
    setLoadLoading(true);
    setLoadError(null);
    try {
      // GET /api/admin/intent/config (ADR-0013 Contract 2).
      // Auth via Supabase session cookie — no token header needed for browser sessions.
      const res = await fetch('/api/admin/intent/config');
      const json = (await res.json()) as AdminIntentConfigResponse & {
        error?: { message?: string };
      };

      if (!res.ok) {
        setLoadError(`API error [${res.status.toString()}]: ${json.error?.message ?? 'unknown'}`);
        return;
      }

      // ADR-0013: all fields are always present. Set config id (uuid or null).
      setConfigId(json.id);
      setIsActive(json.is_active);
      setCreatedAt(json.created_at);
      // is_active true → data_source 'live'; false → no active row ('no_active_row').
      setDataSource(json.is_active ? 'live' : 'no_active_row');

      // Populate editor from live weights (or leave defaults if no active row).
      // json.weights is always an object (AdminIntentConfigResponseSchema guarantees it).
      const w = json.weights;
      if (typeof w.behavioral_damping === 'number') {
        setBehavioralDamping(w.behavioral_damping);
      }
      if (w.priors) {
        setPriors((prev) => ({ ...prev, ...w.priors }));
      }
      if (w.signal_likelihoods) {
        setSignalLikelihoods(w.signal_likelihoods);
      }
    } catch (err) {
      setLoadError(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  // ── Save ─────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaveLoading(true);
    setSaveSuccess(false);
    setSaveError(null);

    // priors and signalLikelihoods shapes match IntentWeights — the state type already
    // satisfies the Zod-inferred IntentWeights interface.
    const weights: IntentWeights = {
      behavioral_damping: behavioralDamping,
      priors,
      signal_likelihoods: Object.keys(signalLikelihoods).length > 0 ? signalLikelihoods : undefined,
    };

    try {
      let res: Response;
      if (configId) {
        // Active row exists — update it via PUT (fixes LG-1: was always POST-creating).
        res = await fetch(`/api/admin/intent/config/${encodeURIComponent(configId)}`, {
          method: 'PUT',
          headers: headers(),
          body: JSON.stringify({ weights }),
        });
      } else {
        // No active global row — create one.
        res = await fetch('/api/admin/intent/config', {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ weights }),
        });
      }

      const json = (await res.json()) as {
        id?: string;
        error?: { code?: string; message?: string };
      };

      if (!res.ok) {
        setSaveError(
          `Save error [${res.status.toString()}]: ${json.error?.message ?? json.error?.code ?? 'unknown'}`,
        );
        return;
      }

      if (json.id) setConfigId(json.id);
      setSaveSuccess(true);
      // Reload to reflect live data_source and updated configId.
      await loadConfig();
    } catch (err) {
      setSaveError(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaveLoading(false);
    }
  };

  const updatePrior = (key: string, value: number) => {
    setPriors((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Weight Editor</h2>
          <p className="mt-1 text-sm text-gray-500">
            K.3.6.3 — Edit global intent weight config (priors, damping, signal likelihoods).
            Global-only v1.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {dataSource && <DataSourceBadge source={dataSource} />}
          <button
            onClick={() => {
              void loadConfig();
            }}
            disabled={loadLoading}
            className="text-xs text-blue-600 underline hover:text-blue-800 disabled:opacity-50"
          >
            Reload
          </button>
        </div>
      </div>

      {/* Load error — Rule K.2 */}
      {loadError && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <strong>Error loading config:</strong> {loadError}
        </div>
      )}

      {/* Provenance info */}
      {!loadError && !loadLoading && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4 text-xs text-gray-600">
          <p>
            <strong>Scope:</strong> Global default (v1 — no per-tenant editing)
          </p>
          {isActive && createdAt && (
            <p>
              <strong>Active since:</strong> {new Date(createdAt).toLocaleString()}
            </p>
          )}
          {!isActive && (
            <p className="text-yellow-700">No active global row — saving will create one.</p>
          )}
          {configId && (
            <p>
              <strong>Config ID:</strong> <span className="font-mono">{configId}</span>
            </p>
          )}
        </div>
      )}

      {loadLoading && <div className="mb-4 text-sm text-gray-400">Loading current config…</div>}

      {/* Save feedback */}
      {saveSuccess && (
        <div className="mb-4 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800">
          Config saved successfully.
        </div>
      )}
      {saveError && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          <strong>Save error:</strong> {saveError}
        </div>
      )}

      {/* ── Behavioral damping ─────────────────────────────────────────────── */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-800">
          Behavioral Damping{' '}
          <span className="text-xs font-normal text-gray-400">(0.0–1.0; SDK default 0.3)</span>
        </h3>
        <SliderRow
          label="behavioral_damping"
          value={behavioralDamping}
          min={0.01}
          max={1}
          step={0.01}
          onChange={setBehavioralDamping}
        />
        <p className="mt-2 text-xs text-gray-400">
          1.0 = no damping (raw likelihood applied). 0.3 = SDK default.
        </p>
      </div>

      {/* ── Priors ─────────────────────────────────────────────────────────── */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-800">
          Priors{' '}
          <span className="text-xs font-normal text-gray-400">
            (relative — SDK normalises to sum-to-1)
          </span>
        </h3>
        <div className="max-h-80 overflow-y-auto">
          {ARCHETYPE_KEYS.map((key) => (
            <SliderRow
              key={key}
              label={key}
              value={priors[key] ?? 0.05}
              min={0.001}
              max={1}
              step={0.001}
              onChange={(v) => {
                updatePrior(key, v);
              }}
            />
          ))}
        </div>
      </div>

      {/* ── Signal likelihoods — simplified view ───────────────────────────── */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-800">
          Signal Likelihoods{' '}
          <span className="text-xs font-normal text-gray-400">(per-signal, per-archetype)</span>
        </h3>
        <p className="mb-3 text-xs text-gray-500">
          Overrides only — leave blank to use SDK defaults (1.0 = no information for that archetype
          from this signal).
        </p>
        <div className="max-h-60 overflow-y-auto rounded border border-gray-100 bg-gray-50 p-2">
          <pre className="text-xs text-gray-600">
            {JSON.stringify(signalLikelihoods, null, 2) || '{}'}
          </pre>
        </div>
        <p className="mt-2 text-xs text-gray-400">
          Valid signal keys: {INTENT_SIGNAL_KEYS.join(', ')}
        </p>
        <p className="mt-1 text-xs text-gray-400">Edit via direct JSON below (advanced):</p>
        <textarea
          rows={5}
          className="mt-1 w-full rounded border border-gray-200 p-2 font-mono text-xs"
          value={JSON.stringify(signalLikelihoods, null, 2)}
          onChange={(e) => {
            try {
              const parsed = JSON.parse(e.target.value) as Record<string, Record<string, number>>;
              setSignalLikelihoods(parsed);
            } catch {
              // ignore invalid JSON while typing
            }
          }}
        />
      </div>

      {/* ── Simulation stub (D-3) ───────────────────────────────────────────── */}
      <div className="mb-4 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-400">
        Simulation coming soon — FOLLOW-282 (D-3, CEO deferred). This section will let you preview
        archetype distribution shifts before saving.
      </div>

      {/* Save button */}
      <div className="flex gap-3">
        <button
          onClick={() => {
            void handleSave();
          }}
          disabled={saveLoading || loadLoading || !!loadError}
          className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {saveLoading ? 'Saving…' : configId ? 'Update config' : 'Create config'}
        </button>
        <button
          onClick={() => {
            void loadConfig();
          }}
          disabled={loadLoading}
          className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Reload
        </button>
        <button
          onClick={resetToDefaults}
          disabled={saveLoading || loadLoading}
          title="Restore project-agreed defaults (BASE_PRIOR + 0.3 damping, clears signal overrides). Save to persist."
          className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
