'use client';

/**
 * StaffQuizStateToggle — Estalara-staff editor for a tenant's quiz ON/OFF switch
 * (`tenants.quiz_enabled`), FOLLOW-998.
 *
 * Reads/writes via `/api/admin/tenants/quiz-state?tenant_id=<id>` (staff-only,
 * audited — mirrors the `al-state` sibling). Every fetch carries
 * `?tenant_id=<tenantId>` so the route fences its `createAdminClient()` query to
 * that tenant (ADR-0018 §2 invariant 5).
 *
 * Rule K.2 consumer-side clause (FOLLOW-624/625/630): load status is tracked
 * SEPARATELY from save status. A failed GET renders a `role="alert"` + Retry and
 * DISABLES Save — it is NEVER silently absorbed into a default (which, here, could
 * flip a live tenant's quiz ON/OFF by writing a blank default back).
 * `scripts/check-k2-consumer-swallow.cjs` enforces this shape.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz/quiz-state-toggle
 */

import { useEffect, useState } from 'react';

interface StaffQuizState {
  quiz_enabled: boolean;
}

export function StaffQuizStateToggle({ tenantId }: { tenantId: string }): React.JSX.Element {
  const [quizEnabled, setQuizEnabled] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'loading' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  // FOLLOW-624 (ESC-039): tracked SEPARATELY from `saveStatus`. A failed GET must
  // render its own visible error and disable Save — it must never be silently
  // absorbed into a default looking like real stored state (worst case here:
  // clobbering a live tenant's quiz_enabled with a blank default).
  const [loadStatus, setLoadStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [loadErrorMsg, setLoadErrorMsg] = useState('');
  const [retryNonce, setRetryNonce] = useState(0);

  // Every call is fenced to this tenant via ?tenant_id — the staff-only API path.
  const url = `/api/admin/tenants/quiz-state?tenant_id=${encodeURIComponent(tenantId)}`;

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
          const d = data as Partial<StaffQuizState>;
          setQuizEnabled(d.quiz_enabled ?? false);
        }
        setLoadStatus('loaded');
      })
      .catch((err: unknown) => {
        // Rule K.2 consumer-side clause (FOLLOW-624): do NOT silently keep a default
        // looking like real stored state — a Save from this state would clobber the
        // tenant's real quiz_enabled value.
        setLoadErrorMsg(err instanceof Error ? err.message : 'Failed to load quiz state.');
        setLoadStatus('error');
      });
  }, [url, retryNonce]);

  async function handleSave(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    // Defense in depth: even if the disabled Save button is bypassed (e.g. an implicit
    // form submit), never PUT from un-loaded state.
    if (loadStatus !== 'loaded') return;
    setSaveStatus('loading');
    setErrorMsg('');
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quiz_enabled: quizEnabled }),
      });
      if (!res.ok) {
        const bodyUnknown: unknown = await res.json().catch(() => ({}));
        const body = bodyUnknown as { error?: string | { message?: string } };
        const msg =
          typeof body.error === 'string' ? body.error : (body.error?.message ?? 'Failed to save.');
        setErrorMsg(msg);
        setSaveStatus('error');
        return;
      }
      const saved = (await res.json()) as StaffQuizState;
      setQuizEnabled(saved.quiz_enabled);
      setSaveStatus('saved');
      setTimeout(() => {
        setSaveStatus('idle');
      }, 2500);
    } catch {
      setErrorMsg('Network error. Please try again.');
      setSaveStatus('error');
    }
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
      {loadStatus === 'error' && (
        <div role="alert" className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>Failed to load quiz state: {loadErrorMsg}</p>
          <p className="mt-1 text-xs">
            Saving is disabled until the state loads successfully — this prevents overwriting the
            tenant&apos;s real on/off setting with a blank default.
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
        {/* quiz_enabled toggle */}
        <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4">
          <div>
            <p className="text-sm font-medium text-gray-900">Quiz Enabled</p>
            <p className="text-xs text-gray-500">
              When off, the SDK quiz widget does not render on the tenant&apos;s pages (served via{' '}
              <code className="text-xs">GET /api/quiz/public-config</code> — takes effect on the
              next page load, no snippet re-install). Behavioral + chat signals keep flowing either
              way.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            data-testid="quiz-enabled-toggle"
            aria-checked={quizEnabled}
            aria-label={quizEnabled ? 'Disable quiz' : 'Enable quiz'}
            disabled={loadStatus !== 'loaded'}
            onClick={() => {
              setQuizEnabled((v) => !v);
            }}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
              quizEnabled ? 'bg-blue-600' : 'bg-gray-200'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                quizEnabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {saveStatus === 'error' && (
          <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMsg}
          </div>
        )}

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={saveStatus === 'loading' || loadStatus !== 'loaded'}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {saveStatus === 'loading' ? 'Saving…' : 'Save'}
          </button>
          {saveStatus === 'saved' && (
            <span className="text-sm font-medium text-green-600">Saved!</span>
          )}
        </div>
      </form>
    </div>
  );
}
