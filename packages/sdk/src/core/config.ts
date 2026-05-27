/**
 * SDK configuration — read from data-* attributes on the <script> tag.
 *
 * @module @estalara/sdk/core/config
 */

export interface SdkConfig {
  apiKey: string;
  /** Derived from API key prefix (optional override via data-tenant-id). */
  tenantId?: string;
  ingestUrl: string;
  /** Decision API base URL — read from data-decision-url. Omit to disable directives. */
  decisionApiUrl?: string;
  tier: 'observer' | 'augment' | 'native';
  debug: boolean;
  consentState: 'consented' | 'legitimate_interest' | 'opted_out';
  /**
   * UI language for the consent banner and quiz widget.
   * Read from data-language attribute. Defaults to 'en'.
   */
  language: 'en' | 'pl' | 'es';
  /**
   * URL for the tenant's privacy policy — shown as a "Learn more" link in the consent banner.
   * Read from data-privacy-url attribute. Optional.
   */
  privacyPolicyUrl?: string;
  /**
   * Brand accent color for consent banner and quiz widget buttons.
   * Read from data-accent-color attribute. Defaults to '#6c5ce7'.
   */
  accentColor: string;
  /**
   * CSS selector for the inquiry form submit button detected from the tenant site schema.
   * Sourced from `inquiry_submit_selector` in the activated tenant config.
   * When present, a click on the matched element emits an `inquiry.started` event.
   * Read from data-inquiry-submit-selector attribute on the script tag.
   */
  inquirySubmitSelector?: string;
  /**
   * Outcome event names that trigger a feedback ping to the bandit.
   * Defaults to `['inquiry.completed']`. Configure via data-feedback-events (comma-separated).
   */
  feedbackEvents?: string[];
  /**
   * When true, also post `converted: false` on session expiry (page hidden after ≥30s dwell).
   * Increases noise but helps cold archetypes learn faster. Default: false (opt-in only).
   * Configure via data-feedback-converted-false="true".
   */
  feedbackConvertedFalse?: boolean;
  /**
   * Explicit feedback endpoint URL. Derived automatically from decisionApiUrl if absent.
   * Format: `https://<host>/api/adapt/feedback`.
   */
  feedbackUrl?: string;
}

export const DEFAULT_CONFIG: Omit<SdkConfig, 'apiKey'> = {
  ingestUrl: 'https://ingest.estalara.com/v1/events',
  tier: 'observer',
  debug: false,
  consentState: 'legitimate_interest',
  language: 'en',
  accentColor: '#6c5ce7',
};

/**
 * Read SDK configuration from a <script> element's data-* attributes.
 * @throws {Error} if data-api-key is missing.
 */
export function readConfig(script: { dataset: Record<string, string | undefined> }): SdkConfig {
  const apiKey = script.dataset.apiKey ?? script.dataset['api-key'] ?? '';
  if (!apiKey) {
    throw new Error('[Estalara] data-api-key is required on the Estalara script tag');
  }

  const rawTier = script.dataset.tier;
  const tier: SdkConfig['tier'] =
    rawTier === 'augment' || rawTier === 'native' ? rawTier : DEFAULT_CONFIG.tier;

  const rawConsent = script.dataset.consentState;
  const consentState: SdkConfig['consentState'] =
    rawConsent === 'consented' || rawConsent === 'opted_out'
      ? rawConsent
      : DEFAULT_CONFIG.consentState;

  const tenantId = script.dataset.tenantId;
  const decisionApiUrl = script.dataset.decisionUrl;

  const rawLanguage = script.dataset.language;
  const language: SdkConfig['language'] =
    rawLanguage === 'pl' ? 'pl' : rawLanguage === 'es' ? 'es' : DEFAULT_CONFIG.language;

  const privacyPolicyUrl = script.dataset.privacyUrl;

  const accentColor = script.dataset.accentColor ?? DEFAULT_CONFIG.accentColor;

  // CSS selector for the inquiry form submit button — sourced from the tenant site schema
  // (inquiry_submit_selector field) and surfaced via data-inquiry-submit-selector attribute.
  const inquirySubmitSelector = script.dataset.inquirySubmitSelector;

  return {
    apiKey,
    ...(tenantId !== undefined ? { tenantId } : {}),
    ...(decisionApiUrl !== undefined ? { decisionApiUrl } : {}),
    ...(privacyPolicyUrl !== undefined ? { privacyPolicyUrl } : {}),
    ...(inquirySubmitSelector !== undefined ? { inquirySubmitSelector } : {}),
    ingestUrl: script.dataset.ingestUrl ?? DEFAULT_CONFIG.ingestUrl,
    tier,
    debug: script.dataset.debug === 'true',
    consentState,
    language,
    accentColor,
  };
}
