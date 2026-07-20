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
 * FOLLOW-UP: unify the agency and staff quiz editors into one shared
 * `tenantId`-prop component once `PATCH /api/tenants/:id` also gains a staff-override
 * port (so the ON/OFF toggle can be surfaced to staff too). Tracked as a Phase-2
 * unification follow-up under ADR-0018 §6.
 *
 * Every fetch carries `?tenant_id=<tenantId>` so the staff-override API path fences
 * its `createAdminClient()` query to that tenant (ADR-0018 §2 invariant 5).
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz/quiz-config-editor
 */

import { useEffect, useState } from 'react';

import type { QuizLanguage } from '@estalara/shared';
import { QUIZ_DEFAULT_CONFIG, QUIZ_LANGUAGE_VALUES } from '@estalara/shared';

/** The JSONB-blob config fields this staff surface can edit (no quiz_enabled column). */
interface StaffQuizConfig {
  language: QuizLanguage;
  accent_color: string;
  micro_polls_enabled: boolean;
}

const DEFAULTS: StaffQuizConfig = {
  language: QUIZ_DEFAULT_CONFIG.language,
  accent_color: QUIZ_DEFAULT_CONFIG.accent_color,
  micro_polls_enabled: QUIZ_DEFAULT_CONFIG.micro_polls_enabled,
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

  // Every call is fenced to this tenant via ?tenant_id — the staff-override API path.
  const url = `/api/quiz/config?tenant_id=${encodeURIComponent(tenantId)}`;

  useEffect(() => {
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
