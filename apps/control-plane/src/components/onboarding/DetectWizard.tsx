'use client';

/**
 * DetectWizard — Magic Link onboarding wizard UI.
 *
 * Implements the URL → detect → preview state machine for the Magic Link
 * onboarding flow (TICKET-030).
 *
 * State machine:
 *   idle → (submit valid URL) → analyzing
 *   analyzing → (200 + schema != null)  → detected
 *   analyzing → (200 + schema == null)  → needs_review
 *   analyzing → (non-2xx or network err) → failed
 *   failed → (click "Try again") → idle
 *   needs_review → (static message, no retry)
 *
 * Auth: reads the `sb-access-token` cookie — the browser sends it automatically
 * for same-origin requests. The cookie is extracted server-side by getAuthClaims()
 * in the /api/detect route handler (TICKET-033).
 *
 * No mock data, no NODE_ENV forks. All data flows from the real API.
 * Tests mock at the fetch level.
 *
 * @module apps/control-plane/src/components/onboarding/DetectWizard
 */

import { useState } from 'react';
import type { DetectField, TenantSiteSchema } from '@estalara/shared';
import { DetectionPreview } from './DetectionPreview';

// ─── Types ────────────────────────────────────────────────────────────────────

/** API error shape returned by POST /api/detect on non-2xx responses. */
interface ApiError {
  code: string;
  message: string;
}

/** Shape of the POST /api/detect success response (mirrors DetectResponse). */
interface DetectApiResponse {
  schema: unknown;
  detection_source: string | null;
  detection_confidence: number;
  fields: DetectField[];
  cached: boolean;
  request_id: string;
}

/** Shape of the POST /api/detect error response. */
interface DetectApiErrorResponse {
  error: ApiError;
}

/** Wizard state machine discriminated union. */
type WizardState =
  | { status: 'idle' }
  | { status: 'analyzing' }
  | {
      status: 'detected';
      schema: unknown;
      fields: DetectField[];
      detection_source: string | null;
      detection_confidence: number;
    }
  | { status: 'needs_review' }
  | { status: 'failed'; message: string };

// ─── URL validation ───────────────────────────────────────────────────────────

/**
 * Returns true if the string is a syntactically valid http:// or https:// URL.
 * Uses the browser-native URL API — no Zod on the client input.
 */
function isValidHttpUrl(value: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Animated spinner with accessible label for the analyzing state. */
function AnalyzingSpinner() {
  return (
    <div
      role="status"
      aria-label="Detecting your site schema"
      className="flex items-center justify-center gap-3 py-16"
    >
      <svg
        className="h-6 w-6 animate-spin text-blue-600"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
      <span className="text-sm font-medium text-gray-700">Detecting your site schema…</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * DetectWizard — URL input + state machine for the Magic Link onboarding flow.
 *
 * Renders inline — parent page is responsible for layout/chrome.
 */
export function DetectWizard() {
  const [url, setUrl] = useState('');
  const [state, setState] = useState<WizardState>({ status: 'idle' });

  const isAnalyzing = state.status === 'analyzing';
  const isUrlValid = isValidHttpUrl(url);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();

    // Guard: no-op if already analyzing (double-submit prevention) or URL invalid
    if (isAnalyzing || !isUrlValid) return;

    setState({ status: 'analyzing' });

    try {
      const res = await fetch('/api/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Same-origin request: the browser sends the @supabase/ssr session cookie
        // (chunked `sb-<ref>-auth-token`) automatically. The route reads it via
        // getSessionAuthClaims() (FOLLOW-555) — the legacy `sb-access-token` /
        // getAuthClaims() path did NOT read this cookie, which is why logged-in
        // SSR sessions previously 401'd here.
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        const body = (await res.json()) as DetectApiErrorResponse;
        setState({
          status: 'failed',
          message: body.error.message,
        });
        return;
      }

      const data = (await res.json()) as DetectApiResponse;

      if (data.schema === null) {
        setState({ status: 'needs_review' });
        return;
      }

      setState({
        status: 'detected',
        schema: data.schema,
        fields: data.fields,
        detection_source: data.detection_source,
        detection_confidence: data.detection_confidence,
      });
    } catch (err) {
      setState({
        status: 'failed',
        message: err instanceof Error ? err.message : 'Unexpected network error',
      });
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* URL input form */}
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
        <div>
          <label
            htmlFor="detect-url-input"
            className="mb-1.5 block text-sm font-medium text-gray-700"
          >
            Your listing site URL
          </label>
          <div className="flex gap-2">
            <input
              id="detect-url-input"
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
              }}
              disabled={isAnalyzing}
              placeholder="https://www.example.com/properties"
              autoComplete="url"
              className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm outline-none placeholder:text-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!isUrlValid || isAnalyzing}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isAnalyzing ? (
                <>
                  <svg
                    className="h-4 w-4 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    />
                  </svg>
                  Detecting…
                </>
              ) : (
                <>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-4 w-4"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Detect
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* State: analyzing */}
      {state.status === 'analyzing' && <AnalyzingSpinner />}

      {/* State: detected — render DetectionPreview (TICKET-AUTO-006-POLISH).
           ADR-0011 (FOLLOW-275): quizEnabled and microPollsEnabled are NOT passed here.
           Quiz/widget config is fetched by the SDK at runtime via GET /api/quiz/public-config
           rather than threaded through the snippet data-attributes. */}
      {state.status === 'detected' && (
        <DetectionPreview
          schema={state.schema as TenantSiteSchema}
          fields={state.fields}
          detection_source={state.detection_source}
          detection_confidence={state.detection_confidence}
        />
      )}

      {/* State: needs_review — static message, no retry */}
      {state.status === 'needs_review' && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 px-5 py-4">
          <p className="text-sm text-yellow-800">
            We couldn&apos;t automatically detect your site&apos;s schema. Please contact{' '}
            <a
              href="mailto:support@estalara.com"
              className="font-medium underline hover:text-yellow-900"
            >
              support@estalara.com
            </a>{' '}
            for manual setup.
          </p>
        </div>
      )}

      {/* State: failed — error message in aria-live region + retry button */}
      {state.status === 'failed' && (
        <div aria-live="polite" className="space-y-3">
          <div className="rounded-lg border border-red-300 bg-red-50 px-5 py-4">
            <p className="text-sm font-semibold text-red-800">Detection failed</p>
            <p className="mt-1 text-sm text-red-700">{state.message}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setState({ status: 'idle' });
            }}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
