'use client';

/**
 * DetectionPreview — real implementation for the Magic Link onboarding wizard.
 *
 * Delivered by TICKET-AUTO-006-POLISH. Replaces the stub that rendered a
 * placeholder `<div data-testid="detection-preview">Detection preview coming soon</div>`.
 *
 * Responsibilities:
 *   - Render a header summary (detection source + overall confidence).
 *   - Render a field table (Field Name, Selector, Sample Value, Confidence badge).
 *   - Provide a "Save & Activate" button that calls POST /api/schema/activate.
 *   - On activation success: render a copyable SDK snippet.
 *
 * Props come from the TICKET-033 API response as forwarded by the DetectWizard.
 *
 * @module apps/control-plane/src/components/onboarding/DetectionPreview
 */

import { useState } from 'react';
import type { TenantSiteSchema } from '@estalara/shared';
import type { DetectField } from '@estalara/shared';
import { CONTROL_PLANE_URL, SDK_SERVE_URL } from '@estalara/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DetectionPreviewProps {
  /** Full TenantSiteSchema object returned by the detection engine. */
  schema: TenantSiteSchema;
  /** Flattened list of detected field definitions. */
  fields: DetectField[];
  /** Detection technique identifier, e.g. 'data_estalara'. */
  detection_source: string | null;
  /** Overall detection confidence 0–1. */
  detection_confidence: number;
  /**
   * Tenant identifier — forwarded to the activate endpoint via JWT, displayed in snippet.
   * Optional here because the activate response always returns the authoritative tenant_id;
   * if provided it is used as a display hint before activation.
   */
  tenantId?: string;
  /**
   * Whether the quiz widget is enabled for this tenant (from tenants.quiz_enabled).
   * Rule L (FOLLOW-102): this is the production producer of data-quiz-enabled in the
   * generated snippet. When false, buildSnippet emits data-quiz-enabled="false".
   * When true (default), the attribute is omitted — smaller snippet, SDK defaults to enabled.
   */
  quizEnabled?: boolean;
  /**
   * Whether micro-poll bottom-toast prompts are enabled for this tenant,
   * sourced from quiz_config.micro_polls_enabled (JSONB blob, GET /api/quiz/config).
   * Rule L (FOLLOW-274): this is the production producer of data-micro-polls-enabled.
   * When true, buildSnippet emits data-micro-polls-enabled="true".
   * When false or omitted, the attribute is absent — SDK defaults to disabled (opt-in).
   */
  microPollsEnabled?: boolean;
}

interface ActivateResponse {
  api_key: string;
  tenant_id: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Humanise the detection source identifier for display.
 *
 *   data_estalara  → "data-estalara"
 *   ai_vision      → "AI Vision"
 *   json_ld        → "JSON-LD"
 *   others         → replace underscores with spaces, capitalise first word
 */
function humaniseSource(source: string | null): string {
  if (source === null) return 'Unknown';
  if (source === 'data_estalara') return 'data-estalara';
  if (source === 'ai_vision') return 'AI Vision';
  if (source === 'json_ld') return 'JSON-LD';
  // Default: replace underscores with spaces, capitalise first word
  const words = source.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Convert a 0–1 confidence float to a percentage string.
 * e.g. 0.99 → "99%"
 */
function formatConfidence(confidence: number): string {
  return String(Math.round(confidence * 100)) + '%';
}

/**
 * Return the CSS class name for a confidence badge based on the score.
 *
 *   ≥ 0.80 → green
 *   0.50–0.79 → yellow
 *   < 0.50 → red
 */
function confidenceBadgeClass(confidence: number): string {
  if (confidence >= 0.8) {
    return 'bg-green-100 text-green-800';
  }
  if (confidence >= 0.5) {
    return 'bg-yellow-100 text-yellow-800';
  }
  return 'bg-red-100 text-red-800';
}

/**
 * Build the SDK snippet string from a tenant ID, API key, and optional inquiry selector.
 *
 * Emits `data-decision-url` pointing at the canonical control-plane host
 * (`CONTROL_PLANE_URL` = https://admin.estalara.com). This is REQUIRED: the SDK
 * treats a missing `data-decision-url` as "directives disabled" and never calls
 * the adapt endpoint (see packages/sdk/src/core/adapt.ts guard `if (!config.decisionApiUrl) return null`).
 * Omitting it silently disables adaptation for every onboarded tenant — the
 * [BLOCKER] found in FOLLOW-105 substep 1a audit (§A / §F.1).
 *
 * We use `CONTROL_PLANE_URL` (NOT `DECISION_API_URL`, which names the deprecated
 * Cloudflare Worker `decision.estalara.com`).
 *
 * IMPORTANT (path convention): the SDK appends `/adapt` itself
 * (`fetch(\`${'$'}{config.decisionApiUrl}/adapt\`)` in core/adapt.ts), and the canonical
 * route lives at `/api/adapt`. We therefore emit `${'$'}{CONTROL_PLANE_URL}/api` so the
 * final fetch target resolves to `https://admin.estalara.com/api/adapt` — the same
 * convention the demo mockup uses (`data-decision-url="/api"` → `/api/adapt`).
 * Emitting the bare host (`https://admin.estalara.com`) would resolve to
 * `https://admin.estalara.com/adapt`, which 404s. [FOLLOW-105]
 *
 * @param inquirySubmitSelector - CSS selector for the inquiry form submit button,
 *   sourced from `TenantSiteSchema.inquiry_submit_selector`. When null / undefined the
 *   `data-inquiry-submit-selector` attribute is omitted entirely from the snippet so
 *   that tenants who copy-paste the tag don't get a blank attribute value. [FOLLOW-114]
 *
 * @param quizEnabled - Whether the quiz widget is enabled for this tenant, sourced from
 *   `tenants.quiz_enabled`. When explicitly `false`, emits `data-quiz-enabled="false"`.
 *   When `true` (default), the attribute is omitted — the SDK defaults to enabled, so
 *   omitting produces a smaller snippet with no behavior change. [FOLLOW-102 Rule L]
 *
 * @param microPollsEnabled - Whether the micro-poll bottom-toast prompts are enabled,
 *   sourced from `quiz_config.micro_polls_enabled`. When `true`, emits
 *   `data-micro-polls-enabled="true"`. When `false` or omitted, the attribute is absent —
 *   the SDK defaults to disabled (opt-in only, smaller snippet). [FOLLOW-274 Rule L]
 */
export function buildSnippet(
  tenantId: string,
  apiKey: string,
  inquirySubmitSelector?: string | null,
  quizEnabled?: boolean,
  microPollsEnabled?: boolean,
): string {
  const inquiryAttr: string =
    inquirySubmitSelector != null
      ? `\n  data-inquiry-submit-selector="${inquirySubmitSelector}"`
      : '';
  // Rule L (FOLLOW-102): emit data-quiz-enabled ONLY when the tenant has explicitly
  // disabled the quiz. Omitting the attribute when true keeps the snippet smaller and
  // avoids a half-wire (the SDK consumer in config.ts defaults to enabled=true).
  const quizAttr: string = quizEnabled === false ? `\n  data-quiz-enabled="false"` : '';
  // Rule L (FOLLOW-274): emit data-micro-polls-enabled ONLY when explicitly enabled.
  // The SDK defaults to disabled (opt-in); omitting the attribute is equivalent to false.
  const microPollsAttr: string =
    microPollsEnabled === true ? `\n  data-micro-polls-enabled="true"` : '';
  return `<script\n  src="${SDK_SERVE_URL}"\n  data-tenant-id="${tenantId}"\n  data-api-key="${apiKey}"\n  data-decision-url="${CONTROL_PLANE_URL}/api"${inquiryAttr}${quizAttr}${microPollsAttr}\n></script>`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Inline spinner used inside the Save & Activate button while the call is in-flight. */
function ButtonSpinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * DetectionPreview renders the "trust moment" screen for the Magic Link
 * onboarding wizard.
 *
 * Shown when `DetectWizard` transitions to the `detected` state (i.e. the
 * detection engine returned a non-null schema). The admin can review the
 * detected fields and click "Save & Activate" to persist the schema and
 * generate the SDK snippet.
 */
export function DetectionPreview({
  schema,
  fields,
  detection_source,
  detection_confidence,
  tenantId = '',
  quizEnabled,
  microPollsEnabled,
}: DetectionPreviewProps) {
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);
  const [activated, setActivated] = useState<ActivateResponse | null>(null);
  const [copied, setCopied] = useState(false);

  // Use tenant_id from the activate response (authoritative), falling back to the prop.
  const snippetTenantId = activated !== null ? activated.tenant_id : tenantId;
  // Pass inquiry_submit_selector from the detected schema so tenants who copy this snippet
  // get a script tag that already wires up the inquiry click observer. [FOLLOW-114]
  // Pass quizEnabled from the tenant record so the snippet emits data-quiz-enabled="false"
  // when the quiz is disabled for this tenant. [FOLLOW-102 Rule L]
  // Pass microPollsEnabled from quiz_config so the snippet emits data-micro-polls-enabled="true"
  // when micro-polls are enabled for this tenant. [FOLLOW-274 Rule L]
  const snippet =
    activated !== null
      ? buildSnippet(
          snippetTenantId,
          activated.api_key,
          schema.inquiry_submit_selector,
          quizEnabled,
          microPollsEnabled,
        )
      : '';

  async function handleActivate(): Promise<void> {
    setActivating(true);
    setActivateError(null);

    try {
      const res = await fetch('/api/schema/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        const message = body.error?.message ?? `Activation failed (HTTP ${String(res.status)})`;
        setActivateError(message);
        return;
      }

      const data = (await res.json()) as ActivateResponse;
      setActivated(data);
    } catch (err) {
      setActivateError(err instanceof Error ? err.message : 'Unexpected network error');
    } finally {
      setActivating(false);
    }
  }

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      // Clipboard API not available — silently ignore
    }
  }

  return (
    <div data-testid="detection-preview" className="space-y-6">
      {/* ── Header summary ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 text-sm text-gray-700">
        <span>Detected via</span>
        <strong className="font-semibold">{humaniseSource(detection_source)}</strong>
        <span aria-hidden="true">·</span>
        <strong className="font-semibold">
          {formatConfidence(detection_confidence)} confidence
        </strong>
      </div>

      {/* ── Field table ────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
              >
                Field Name
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
              >
                Selector
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
              >
                Sample Value
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
              >
                Confidence
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {fields.map((field) => (
              <tr key={field.name}>
                <td className="px-4 py-3 font-mono text-xs text-gray-900">{field.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-gray-600">{field.selector}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{field.sample_value ?? '—'}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${confidenceBadgeClass(field.confidence)}`}
                    data-confidence={field.confidence}
                  >
                    {formatConfidence(field.confidence)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Activation error ───────────────────────────────────────────────── */}
      {activateError !== null && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {activateError}
        </div>
      )}

      {/* ── Save & Activate button ─────────────────────────────────────────── */}
      {activated === null && (
        <button
          type="button"
          disabled={activating}
          onClick={() => {
            void handleActivate();
          }}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {activating && <ButtonSpinner />}
          {activating ? 'Activating…' : 'Save & Activate'}
        </button>
      )}

      {/* ── SDK snippet ────────────────────────────────────────────────────── */}
      {activated !== null && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-700">
            Your site is active. Add this snippet to your site:
          </p>
          <div className="relative rounded-lg border border-gray-200 bg-gray-50">
            <pre className="overflow-x-auto p-4 text-xs text-gray-800">
              <code>{snippet}</code>
            </pre>
            <button
              type="button"
              onClick={() => {
                void handleCopy();
              }}
              className="absolute right-3 top-3 rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              {copied ? 'Copied!' : 'Copy snippet'}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            This API key is shown once and stored securely. Save it now.
          </p>
        </div>
      )}
    </div>
  );
}
