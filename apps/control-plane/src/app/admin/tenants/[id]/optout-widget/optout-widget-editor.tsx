'use client';

/**
 * StaffOptOutWidgetEditor — Estalara-staff editor for a tenant's per-brand profiling opt-out
 * toggle widget config (FOLLOW-641 / ADR-0019 D2 + D7).
 *
 * Edits the placement (corner + px offsets) and the on/off/aria label texts of the EXISTING
 * opt-out toggle (`packages/sdk/src/ui/profiling-toggle.ts`, mounted since PR #337). Reads/writes
 * via the staff-fenced `GET`/`PUT /api/admin/tenants/optout-widget?tenant_id=<id>` route, which
 * validates + audits + writes atomically (ADR-0018 §3a). Every fetch carries `?tenant_id=<id>`
 * so the route fences its `createAdminClient()` query to that tenant (invariant 5).
 *
 * Label MVP scope: the wire schema (`OptOutWidgetConfigSchema`) carries full i18n bags, but this
 * minimal staff surface edits the `en` texts only (the SDK resolves any language with an `'en'`
 * fallback). Empty fields are OMITTED so the SDK falls back to its hardcoded per-locale copy.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/optout-widget/optout-widget-editor
 */

import { useEffect, useState } from 'react';

import type { OptOutWidgetConfig, WidgetCorner } from '@estalara/shared';
import { DEFAULT_OPTOUT_PLACEMENT } from '@estalara/shared';

const CORNERS: { value: WidgetCorner; label: string }[] = [
  { value: 'bottom-left', label: 'Bottom-left' },
  { value: 'bottom-right', label: 'Bottom-right' },
  { value: 'top-left', label: 'Top-left' },
  { value: 'top-right', label: 'Top-right' },
];

/** Editor-local form state (flattened for simple inputs; en labels only). */
interface EditorState {
  corner: WidgetCorner;
  offsetX: number;
  offsetY: number;
  onLabel: string;
  offLabel: string;
  ariaLabel: string;
}

const DEFAULTS: EditorState = {
  corner: DEFAULT_OPTOUT_PLACEMENT.corner,
  offsetX: DEFAULT_OPTOUT_PLACEMENT.offset_x,
  offsetY: DEFAULT_OPTOUT_PLACEMENT.offset_y,
  onLabel: '',
  offLabel: '',
  ariaLabel: '',
};

/** Map a stored config into flat editor state (placement falls back to the default). */
function toState(config: OptOutWidgetConfig): EditorState {
  const p = config.placement ?? DEFAULT_OPTOUT_PLACEMENT;
  return {
    corner: p.corner,
    offsetX: p.offset_x,
    offsetY: p.offset_y,
    onLabel: config.labels?.on?.en ?? '',
    offLabel: config.labels?.off?.en ?? '',
    ariaLabel: config.labels?.aria?.en ?? '',
  };
}

/** Build the wire config from editor state; empty labels are omitted (SDK falls back). */
function toConfig(s: EditorState): OptOutWidgetConfig {
  const labels: NonNullable<OptOutWidgetConfig['labels']> = {};
  if (s.onLabel.trim() !== '') labels.on = { en: s.onLabel.trim() };
  if (s.offLabel.trim() !== '') labels.off = { en: s.offLabel.trim() };
  if (s.ariaLabel.trim() !== '') labels.aria = { en: s.ariaLabel.trim() };
  const config: OptOutWidgetConfig = {
    placement: { corner: s.corner, offset_x: s.offsetX, offset_y: s.offsetY },
  };
  if (Object.keys(labels).length > 0) config.labels = labels;
  return config;
}

export function StaffOptOutWidgetEditor({ tenantId }: { tenantId: string }): React.JSX.Element {
  const [state, setState] = useState<EditorState>(DEFAULTS);
  const [status, setStatus] = useState<'idle' | 'loading' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  // Tracked separately from `status` (save-only). A failed GET disables Save so a blank-default
  // form can never clobber the tenant's real config (FOLLOW-624 pattern).
  const [loadStatus, setLoadStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [loadErrorMsg, setLoadErrorMsg] = useState('');
  const [retryNonce, setRetryNonce] = useState(0);

  const url = `/api/admin/tenants/optout-widget?tenant_id=${encodeURIComponent(tenantId)}`;

  useEffect(() => {
    setLoadStatus('loading');
    setLoadErrorMsg('');
    void fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
        return r.json();
      })
      .then((data: unknown) => {
        const d = data as { config?: OptOutWidgetConfig };
        setState(toState(d.config ?? {}));
        setLoadStatus('loaded');
      })
      .catch((err: unknown) => {
        setLoadErrorMsg(err instanceof Error ? err.message : 'Failed to load settings.');
        setLoadStatus('error');
      });
  }, [url, retryNonce]);

  async function handleSave(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (loadStatus !== 'loaded') return;
    setStatus('loading');
    setErrorMsg('');
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: toConfig(state) }),
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

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
      {loadStatus === 'error' && (
        <div role="alert" className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>Failed to load opt-out widget settings: {loadErrorMsg}</p>
          <p className="mt-1 text-xs">
            Saving is disabled until settings load successfully — this prevents overwriting the
            tenant&apos;s real config with blank defaults.
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
      <form onSubmit={(e) => void handleSave(e)} className="space-y-6">
        {/* Placement corner */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Corner</label>
          <select
            data-testid="optout-corner"
            value={state.corner}
            onChange={(e) => {
              setState((s) => ({ ...s, corner: e.target.value as WidgetCorner }));
            }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            {CORNERS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        {/* Offsets */}
        <div className="flex gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Offset X (px)</label>
            <input
              type="number"
              min={0}
              max={200}
              data-testid="optout-offset-x"
              value={state.offsetX}
              onChange={(e) => {
                setState((s) => ({ ...s, offsetX: Number(e.target.value) }));
              }}
              className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Offset Y (px)</label>
            <input
              type="number"
              min={0}
              max={200}
              data-testid="optout-offset-y"
              value={state.offsetY}
              onChange={(e) => {
                setState((s) => ({ ...s, offsetY: Number(e.target.value) }));
              }}
              className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Labels (en; empty = SDK default) */}
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Label overrides (English; leave blank to use the SDK&apos;s built-in copy).
          </p>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              &ldquo;On&rdquo; label
            </label>
            <input
              type="text"
              data-testid="optout-label-on"
              value={state.onLabel}
              placeholder="active"
              onChange={(e) => {
                setState((s) => ({ ...s, onLabel: e.target.value }));
              }}
              className="w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              &ldquo;Off&rdquo; label
            </label>
            <input
              type="text"
              data-testid="optout-label-off"
              value={state.offLabel}
              placeholder="disabled"
              onChange={(e) => {
                setState((s) => ({ ...s, offLabel: e.target.value }));
              }}
              className="w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">ARIA label</label>
            <input
              type="text"
              data-testid="optout-label-aria"
              value={state.ariaLabel}
              placeholder="Personalization: active"
              onChange={(e) => {
                setState((s) => ({ ...s, ariaLabel: e.target.value }));
              }}
              className="w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {status === 'error' && (
          <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMsg}
          </div>
        )}

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={status === 'loading' || loadStatus !== 'loaded'}
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
