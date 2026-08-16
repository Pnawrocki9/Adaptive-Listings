'use client';

/**
 * StaffQuizConfigEditor — minimal Estalara-staff editor for a tenant's quiz-widget
 * configuration (ADR-0018 §6 Phase 2 / FOLLOW-595).
 *
 * SURFACE DECISION (ticket FOLLOW-595): the agency editor
 * (`apps/control-plane/src/app/dashboard/quiz/page.tsx`) is NOT extracted into a
 * shared `tenantId`-prop component the way FOLLOW-594 did with `AnalyticsView`.
 * Reason: that page is tightly coupled to the agency session AND its quiz ON/OFF
 * toggle writes through a DIFFERENT route (`PATCH /api/tenants/:id`) that has no
 * staff-override port yet — extracting it would drag an out-of-scope route into this
 * ticket. So this is a MINIMAL staff surface that only reads/writes the JSONB config
 * (language, accent_color, micro_polls_enabled) via `/api/quiz/config?tenant_id=<id>`,
 * which IS staff-ported here.
 *
 * RESOLVED FOLLOW-UP (FOLLOW-998): the ON/OFF toggle IS now surfaced to staff — not by
 * staff-porting `PATCH /api/tenants/:id` as originally sketched, but via the dedicated
 * staff-only audited route `/api/admin/tenants/quiz-state` (mirroring `al-state`),
 * rendered by {@link ../quiz/quiz-state-toggle!StaffQuizStateToggle} above this editor
 * on the same page. The two editors remain deliberately separate components: this one
 * writes the JSONB blob via `/api/quiz/config`, the toggle writes the
 * `tenants.quiz_enabled` column via `quiz-state` — different routes, different audit
 * actions, no shared state.
 *
 * Every fetch carries `?tenant_id=<tenantId>` so the staff-override API path fences
 * its `createAdminClient()` query to that tenant (ADR-0018 §2 invariant 5).
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz/quiz-config-editor
 */

import { useEffect, useState } from 'react';

import type { QuizLanguage, WidgetCorner, WidgetPlacement } from '@estalara/shared';
import {
  DEFAULT_QUIZ_PLACEMENT,
  QUIZ_DEFAULT_CONFIG,
  QUIZ_LANGUAGE_VALUES,
} from '@estalara/shared';

/**
 * The JSONB-blob config fields this staff surface can edit (no quiz_enabled column).
 * FOLLOW-640: `placement` (corner + offsets) is now editable — it persists into
 * `quiz_config.placement` via the same POST /api/quiz/config write and is served to the SDK
 * as the `quiz_placement` slice.
 */
interface StaffQuizConfig {
  language: QuizLanguage;
  accent_color: string;
  micro_polls_enabled: boolean;
  placement: WidgetPlacement;
}

const CORNERS: { value: WidgetCorner; label: string }[] = [
  { value: 'bottom-left', label: 'Bottom-left' },
  { value: 'bottom-right', label: 'Bottom-right' },
  { value: 'top-left', label: 'Top-left' },
  { value: 'top-right', label: 'Top-right' },
];

const DEFAULTS: StaffQuizConfig = {
  language: QUIZ_DEFAULT_CONFIG.language,
  accent_color: QUIZ_DEFAULT_CONFIG.accent_color,
  micro_polls_enabled: QUIZ_DEFAULT_CONFIG.micro_polls_enabled,
  placement: DEFAULT_QUIZ_PLACEMENT,
};

const LANGUAGE_LABELS: Record<QuizLanguage, string> = {
  en: 'English',
  pl: 'Polish',
  es: 'Español',
};

export function StaffQuizConfigEditor({ tenantId }: { tenantId: string }): React.JSX.Element {
  const [config, setConfig] = useState<StaffQuizConfig>(DEFAULTS);
  const [status, setStatus] = useState<'idle' | 'loading' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  // FOLLOW-624 (ESC-039): tracked SEPARATELY from `status` (which is save-only).
  // A failed GET must render its own visible error and disable Save — it must
  // never be silently absorbed into DEFAULTS looking like real stored config.
  const [loadStatus, setLoadStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [loadErrorMsg, setLoadErrorMsg] = useState('');
  const [retryNonce, setRetryNonce] = useState(0);

  // Every call is fenced to this tenant via ?tenant_id — the staff-override API path.
  const url = `/api/quiz/config?tenant_id=${encodeURIComponent(tenantId)}`;

  useEffect(() => {
    setLoadStatus('loading');
    setLoadErrorMsg('');
    void fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
        return r.json();
      })
      .then((data: unknown) => {
        if (data && typeof data === 'object') {
          const d = data as Partial<StaffQuizConfig>;
          setConfig({ ...DEFAULTS, ...d });
        }
        setLoadStatus('loaded');
      })
      .catch((err: unknown) => {
        // Rule K.2 consumer-side clause (FOLLOW-624): do NOT silently keep
        // DEFAULTS looking like real stored config — a Save from this state
        // would clobber the tenant's real quiz config.
        setLoadErrorMsg(err instanceof Error ? err.message : 'Failed to load settings.');
        setLoadStatus('error');
      });
  }, [url, retryNonce]);

  async function handleSave(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    // Defense in depth: even if the disabled Save button is bypassed (e.g.
    // an implicit form submit), never POST from un-loaded state.
    if (loadStatus !== 'loaded') return;
    setStatus('loading');
    setErrorMsg('');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
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
          <p>Failed to load quiz settings: {loadErrorMsg}</p>
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
        {/* Micro-polls */}
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium text-gray-900">Micro-Poll Prompts</label>
            <p className="text-xs text-gray-500">
              Show brief single-question bottom-toast prompts after 90 seconds on a listing page.
            </p>
          </div>
          <button
            type="button"
            data-testid="micro-polls-toggle"
            aria-label={
              config.micro_polls_enabled
                ? 'Disable micro-poll prompts'
                : 'Enable micro-poll prompts'
            }
            aria-pressed={config.micro_polls_enabled}
            onClick={() => {
              setConfig((c) => ({ ...c, micro_polls_enabled: !c.micro_polls_enabled }));
            }}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              config.micro_polls_enabled ? 'bg-blue-600' : 'bg-gray-200'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                config.micro_polls_enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* Language */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Language</label>
          <select
            value={config.language}
            onChange={(e) => {
              setConfig((c) => ({ ...c, language: e.target.value as QuizLanguage }));
            }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            {QUIZ_LANGUAGE_VALUES.map((lang) => (
              <option key={lang} value={lang}>
                {LANGUAGE_LABELS[lang]}
              </option>
            ))}
          </select>
        </div>

        {/* Accent color */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Accent Color</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={config.accent_color}
              onChange={(e) => {
                setConfig((c) => ({ ...c, accent_color: e.target.value }));
              }}
              className="h-9 w-16 cursor-pointer rounded border border-gray-300"
            />
            <span className="text-sm text-gray-500">{config.accent_color}</span>
          </div>
        </div>

        {/* Sticky-trigger placement (FOLLOW-640) */}
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Sticky Trigger Placement
          </label>
          <p className="mb-2 text-xs text-gray-500">
            Where the quiz trigger button anchors on the brand&apos;s pages. Defaults to bottom-left
            at 24/24 px — the position every brand used before this control existed.
          </p>
          <select
            data-testid="quiz-corner"
            value={config.placement.corner}
            onChange={(e) => {
              setConfig((c) => ({
                ...c,
                placement: { ...c.placement, corner: e.target.value as WidgetCorner },
              }));
            }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            {CORNERS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <div className="mt-3 flex gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Offset X (px)</label>
              <input
                type="number"
                min={0}
                max={200}
                data-testid="quiz-offset-x"
                value={config.placement.offset_x}
                onChange={(e) => {
                  setConfig((c) => ({
                    ...c,
                    placement: { ...c.placement, offset_x: Number(e.target.value) },
                  }));
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
                data-testid="quiz-offset-y"
                value={config.placement.offset_y}
                onChange={(e) => {
                  setConfig((c) => ({
                    ...c,
                    placement: { ...c.placement, offset_y: Number(e.target.value) },
                  }));
                }}
                className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
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
