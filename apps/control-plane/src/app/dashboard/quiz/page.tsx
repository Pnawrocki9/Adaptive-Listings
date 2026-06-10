'use client';

/**
 * Quiz settings dashboard page.
 *
 * FOLLOW-102 (AC5): Adds the quiz ON/OFF toggle backed by tenants.quiz_enabled
 * (the dedicated boolean column). The toggle optimistically updates local state,
 * PATCHes PATCH /api/tenants/:id on change, and rolls back on error.
 *
 * Quiz widget configuration (language, accent_color, sticky_widget, etc.)
 * is persisted to tenants.quiz_config JSONB via POST /api/quiz/config.
 *
 * AC2 / AC5 (FOLLOW-264 / Rule L / RETRO-050): "Show quiz after N listing views"
 * was removed from this page and from the API schema. The SDK consumer
 * (trigger_after_n_listings) was removed in FOLLOW-257; this removes the orphaned
 * producer that surfaced false configurability to paying tenants (HALF_WIRE_P).
 * Per-tenant timer control is re-planned under FOLLOW-199 (Quiz v2.0) and will
 * rebuild all three limbs (DB, API, SDK) together.
 *
 * §B.1 rationale displayed in the toggle description:
 *   Tenants with high-quality chat coverage may disable the quiz and rely on
 *   behavioral + chat NLP signals only. Tenants without chat need the quiz as a
 *   primary archetype signal source.
 *
 * @module apps/control-plane/src/app/dashboard/quiz/page
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface QuizConfig {
  enabled: boolean;
  // trigger_after_n_listings removed — Rule L / RETRO-050 HALF_WIRE_P (FOLLOW-264).
  // The SDK consumer was deleted in FOLLOW-257; this removes the orphaned producer.
  // Re-add under FOLLOW-199 (Quiz v2.0) with a matching SDK consumer.
  sticky_widget: boolean;
  language: 'en' | 'pl';
  accent_color: string;
  /** FOLLOW-102: dedicated boolean column SoT for the quiz ON/OFF toggle. */
  quiz_enabled: boolean;
  /** Tenant ID returned by /api/quiz/config for use in PATCH /api/tenants/:id. */
  tenant_id?: string;
}

const DEFAULTS: QuizConfig = {
  enabled: false,
  sticky_widget: false,
  language: 'en',
  accent_color: '#2563EB',
  quiz_enabled: true,
};

export default function QuizSettingsPage() {
  const [config, setConfig] = useState<QuizConfig>(DEFAULTS);
  const [status, setStatus] = useState<'idle' | 'loading' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // FOLLOW-102 AC5: separate state for the quiz ON/OFF toggle so optimistic updates
  // can be rolled back independently of the rest of the form.
  const [quizEnabled, setQuizEnabled] = useState<boolean>(true);
  const [quizToggleStatus, setQuizToggleStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const [quizToggleError, setQuizToggleError] = useState('');

  useEffect(() => {
    void fetch('/api/quiz/config')
      .then((r) => {
        if (!r.ok) {
          throw new Error(`HTTP ${String(r.status)}`);
        }
        return r.json();
      })
      .then((data: unknown) => {
        if (data && typeof data === 'object') {
          const d = data as Partial<QuizConfig>;
          setConfig({ ...DEFAULTS, ...d });
          // FOLLOW-102: initialise quiz ON/OFF toggle from the dedicated column
          setQuizEnabled(typeof d.quiz_enabled === 'boolean' ? d.quiz_enabled : true);
        }
      })
      .catch(() => {
        // load silently — defaults already set
      });
  }, []);

  /**
   * FOLLOW-102 AC5: Toggle the quiz ON/OFF by PATCHing PATCH /api/tenants/:id.
   * Optimistic: local state is updated immediately; rolled back on error.
   *
   * §B.1 rationale: tenants with chat coverage may disable the quiz;
   * those without chat need it for archetype signal coverage.
   */
  async function handleQuizEnabledToggle(): Promise<void> {
    const tenantId = config.tenant_id;
    if (!tenantId) {
      setQuizToggleError('Tenant ID not loaded. Please refresh the page.');
      setQuizToggleStatus('error');
      return;
    }

    const newValue = !quizEnabled;
    // Optimistic update
    setQuizEnabled(newValue);
    setQuizToggleStatus('saving');
    setQuizToggleError('');

    try {
      const res = await fetch(`/api/tenants/${tenantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quiz_enabled: newValue }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        // Rollback optimistic update
        setQuizEnabled(!newValue);
        setQuizToggleError(body.error ?? 'Failed to update quiz setting.');
        setQuizToggleStatus('error');
        return;
      }

      setQuizToggleStatus('idle');
    } catch {
      // Rollback optimistic update on network error
      setQuizEnabled(!newValue);
      setQuizToggleError('Network error. Please try again.');
      setQuizToggleStatus('error');
    }
  }

  async function handleSave(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setStatus('loading');
    setErrorMsg('');

    try {
      const res = await fetch('/api/quiz/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setErrorMsg(body.error ?? 'Failed to save settings.');
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
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Investor Quiz Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure the decision-tree intent quiz widget embedded on your listings page.
        </p>
      </div>

      {/* ── FOLLOW-102 AC5: Quiz ON/OFF toggle ───────────────────────────────── */}
      <div className="mb-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">Quiz widget</p>
            <p className="mt-1 text-xs text-gray-500">
              Enable the investor intent quiz on your listings pages. Tenants with high-quality chat
              coverage may disable the quiz and rely on behavioral and chat NLP signals only.
              Tenants without chat need the quiz as a primary archetype signal source (e.g. for
              student_parent, retiree_relocator, diaspora_buyer archetypes — §B.1 / §D.6).
            </p>
            {quizToggleStatus === 'error' && (
              <p
                role="alert"
                data-testid="quiz-toggle-error"
                className="mt-2 text-xs font-medium text-red-600"
              >
                {quizToggleError}
              </p>
            )}
          </div>
          <button
            type="button"
            data-testid="quiz-enabled-toggle"
            aria-label={quizEnabled ? 'Disable quiz widget' : 'Enable quiz widget'}
            aria-pressed={quizEnabled}
            disabled={quizToggleStatus === 'saving'}
            onClick={() => {
              void handleQuizEnabledToggle();
            }}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              quizEnabled ? 'bg-blue-600' : 'bg-gray-200'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                quizEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* ── Quiz widget configuration form ───────────────────────────────────── */}
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
        <form onSubmit={(e) => void handleSave(e)} className="space-y-6">
          {/* Trigger threshold — REMOVED (FOLLOW-264 / Rule L / RETRO-050):
              "Show quiz after N listing views" had no SDK consumer after FOLLOW-257.
              Surfacing an input that can never affect runtime is false configurability
              (HALF_WIRE_P). Per-tenant timer control planned for FOLLOW-199 (Quiz v2.0). */}

          {/* Sticky widget */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-900">Sticky Widget</label>
              <p className="text-xs text-gray-500">
                Keep the quiz button always visible (not just after N views)
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setConfig((c) => ({ ...c, sticky_widget: !c.sticky_widget }));
              }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                config.sticky_widget ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  config.sticky_widget ? 'translate-x-6' : 'translate-x-1'
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
                setConfig((c) => ({ ...c, language: e.target.value as 'en' | 'pl' }));
              }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            >
              <option value="en">English</option>
              <option value="pl">Polish</option>
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

          {/* Error */}
          {status === 'error' && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{errorMsg}</div>
          )}

          {/* Submit */}
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

      {/* Link to analytics */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">Quiz Analytics</p>
            <p className="text-xs text-gray-500">
              View completion rates and archetype distribution
            </p>
          </div>
          <Link
            href="/dashboard/quiz/analytics"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            View Analytics →
          </Link>
        </div>
      </div>
    </div>
  );
}
