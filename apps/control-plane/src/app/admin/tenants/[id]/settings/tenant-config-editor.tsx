'use client';

/**
 * StaffTenantConfigEditor — Estalara-staff editor for a tenant's per-tenant
 * settings (ADR-0018 §5/§6 / FOLLOW-600).
 *
 * Reads/writes `plan` (display-only — plan changes are a billing concern, not
 * editable here), `brand.{primary_color,logo_url,white_label}`, and
 * `sdk.allowed_origins` via `/api/config?tenant_id=<id>` — the staff-override API
 * path FOLLOW-614/615 already ported. Every fetch carries `?tenant_id=<tenantId>`
 * so the route fences its `createAdminClient()` query to that tenant (ADR-0018 §2
 * invariant 5).
 *
 * DELIBERATELY ABSENT (CEO Q1, ADR-0018 §5 — binding): no `generation_model`
 * control. That setting is GLOBAL-only, owned by `/admin/settings`. Do not add one
 * here — `page.test.tsx` asserts its absence directly.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/settings/tenant-config-editor
 */

import { useEffect, useState } from 'react';

interface StaffTenantConfig {
  plan: string;
  brand: {
    primary_color: string;
    logo_url: string | null;
    white_label: boolean;
  };
  sdk: {
    allowed_origins: string[];
  };
}

const DEFAULTS: StaffTenantConfig = {
  plan: '',
  brand: { primary_color: '#1a73e8', logo_url: null, white_label: false },
  sdk: { allowed_origins: [] },
};

/** Splits the allow-list textarea into a trimmed, non-empty origin array. */
function parseOriginsInput(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function StaffTenantConfigEditor({ tenantId }: { tenantId: string }): React.JSX.Element {
  const [config, setConfig] = useState<StaffTenantConfig>(DEFAULTS);
  const [originsInput, setOriginsInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Every call is fenced to this tenant via ?tenant_id — the staff-override API path.
  const url = `/api/config?tenant_id=${encodeURIComponent(tenantId)}`;

  useEffect(() => {
    void fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
        return r.json();
      })
      .then((data: unknown) => {
        if (data && typeof data === 'object') {
          const d = data as Partial<StaffTenantConfig>;
          const merged: StaffTenantConfig = {
            plan: d.plan ?? DEFAULTS.plan,
            brand: { ...DEFAULTS.brand, ...d.brand },
            sdk: { ...DEFAULTS.sdk, ...d.sdk },
          };
          setConfig(merged);
          setOriginsInput(merged.sdk.allowed_origins.join('\n'));
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
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand: config.brand,
          sdk: { allowed_origins: parseOriginsInput(originsInput) },
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
      const saved = (await res.json()) as StaffTenantConfig;
      setConfig((c) => ({ ...c, brand: saved.brand }));
      setOriginsInput(saved.sdk.allowed_origins.join('\n'));
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
      <form onSubmit={(e) => void handleSave(e)} className="space-y-6">
        {/* Plan — display only; billing concern, not editable here */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Plan</label>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
            {config.plan || '—'}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Plan changes are managed via billing, not this settings page.
          </p>
        </div>

        {/* White label */}
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium text-gray-900">White Label</label>
            <p className="text-xs text-gray-500">Hide Estalara branding from the SDK widget.</p>
          </div>
          <button
            type="button"
            data-testid="white-label-toggle"
            aria-label={config.brand.white_label ? 'Disable white label' : 'Enable white label'}
            aria-pressed={config.brand.white_label}
            onClick={() => {
              setConfig((c) => ({
                ...c,
                brand: { ...c.brand, white_label: !c.brand.white_label },
              }));
            }}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              config.brand.white_label ? 'bg-blue-600' : 'bg-gray-200'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                config.brand.white_label ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* Primary color */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Primary Color</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={config.brand.primary_color}
              onChange={(e) => {
                setConfig((c) => ({ ...c, brand: { ...c.brand, primary_color: e.target.value } }));
              }}
              className="h-9 w-16 cursor-pointer rounded border border-gray-300"
            />
            <span className="text-sm text-gray-500">{config.brand.primary_color}</span>
          </div>
        </div>

        {/* Logo URL */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Logo URL</label>
          <input
            type="text"
            value={config.brand.logo_url ?? ''}
            onChange={(e) => {
              setConfig((c) => ({
                ...c,
                brand: { ...c.brand, logo_url: e.target.value.length > 0 ? e.target.value : null },
              }));
            }}
            placeholder="https://…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Allowed origins */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            SDK Allowed Origins
          </label>
          <p className="mb-1 text-xs text-gray-500">One origin URL per line.</p>
          <textarea
            data-testid="allowed-origins-textarea"
            value={originsInput}
            onChange={(e) => {
              setOriginsInput(e.target.value);
            }}
            rows={4}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
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
