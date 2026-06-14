'use client';

/**
 * K.3.6.3 — Weight Editor (global intent weight config)
 *
 * Consumes:
 *   GET  /api/admin/intent/config              (read current active config)
 *   PUT  /api/admin/intent/config/[id]         (update an existing row)
 *   POST /api/admin/intent/config              (create a new active row)
 *
 * Simulation: stub only (D-3 deferred — FOLLOW-282).
 *
 * Rule K.2: data_source:'error' or non-2xx → visible error banner, never silent.
 *
 * @module apps/control-plane/src/app/admin/tracer/weights/page
 */

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import type { IntentConfigResponse, IntentWeights } from '@estalara/shared';
import { ARCHETYPE_KEYS, INTENT_SIGNAL_KEYS } from '@estalara/shared';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAdminToken(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('estalara_admin_token') ?? '';
}

function headers(): Record<string, string> {
  const token = getAdminToken();
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
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
  // Current live config (from GET /api/admin/intent/config)
  const [configId, setConfigId] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<string | null>(null);
  const [effectiveAt, setEffectiveAt] = useState<string | null>(null);
  const [isTenantSpecific, setIsTenantSpecific] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadLoading, setLoadLoading] = useState(true);

  // Editor state
  const [behavioralDamping, setBehavioralDamping] = useState(0.3);
  const [priors, setPriors] = useState<Record<string, number>>(() => {
    const p: Record<string, number> = {};
    for (const k of ARCHETYPE_KEYS) p[k] = 1 / ARCHETYPE_KEYS.length;
    return p;
  });
  const [signalLikelihoods, setSignalLikelihoods] = useState<
    Record<string, Record<string, number>>
  >({});

  // Save state
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Load current config ──────────────────────────────────────────────────────
  const loadConfig = useCallback(async () => {
    setLoadLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/intent/config', {
        headers: headers(),
      });
      const json = (await res.json()) as IntentConfigResponse & {
        id?: string;
        error?: { message?: string };
      };

      // Rule K.2: visible error on data_source:'error'
      if (json.data_source === 'error') {
        setLoadError(
          `Backend error loading config (data_source: error). ${json.error?.message ?? 'See Sentry.'}`,
        );
        setDataSource('error');
        return;
      }

      if (!res.ok) {
        setLoadError(`API error [${res.status.toString()}]: ${json.error?.message ?? 'unknown'}`);
        return;
      }

      setDataSource(json.data_source);
      setEffectiveAt(json.effective_at ?? null);
      setIsTenantSpecific(json.is_tenant_specific ?? null);
      if (json.id) setConfigId(json.id);

      // Populate editor from live weights (or leave defaults if empty/mock)
      const w = json.weights;
      if (w) {
        if (typeof w.behavioral_damping === 'number') {
          setBehavioralDamping(w.behavioral_damping);
        }
        if (w.priors) {
          setPriors((prev) => ({ ...prev, ...w.priors }));
        }
        if (w.signal_likelihoods) {
          setSignalLikelihoods(w.signal_likelihoods);
        }
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
        // Update existing active row
        res = await fetch(`/api/admin/intent/config/${encodeURIComponent(configId)}`, {
          method: 'PUT',
          headers: headers(),
          body: JSON.stringify({ weights }),
        });
      } else {
        // Create new active row (no existing id — e.g. data_source was 'mock')
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
      // Reload to reflect live data_source
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
          </p>
        </div>
        <div className="flex items-center gap-3">
          {dataSource && <DataSourceBadge source={dataSource} />}
          <Link
            href="/admin/tracer/weights"
            onClick={() => {
              void loadConfig();
            }}
            className="text-xs text-blue-600 underline hover:text-blue-800"
          >
            Reload
          </Link>
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
          {effectiveAt && (
            <p>
              <strong>Effective at:</strong> {new Date(effectiveAt).toLocaleString()}
            </p>
          )}
          {isTenantSpecific !== null && (
            <p>
              <strong>Scope:</strong>{' '}
              {isTenantSpecific ? 'Tenant-specific override' : 'Global default'}
            </p>
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
          {saveLoading ? 'Saving…' : 'Save config'}
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
      </div>
    </div>
  );
}
