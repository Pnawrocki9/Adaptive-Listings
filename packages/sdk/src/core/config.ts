/**
 * SDK configuration — read from data-* attributes on the <script> tag.
 *
 * @module @estalara/sdk/core/config
 */

/**
 * Bot user-agent pattern used to gate event emission in `init()`.
 *
 * Matches the seven crawlers named in FOLLOW-099 AC7 (CEO-ratified).
 * Case-insensitive. Accessed via `BOT_UA_RE.test(navigator.userAgent)`.
 *
 * Note: this list covers major SEO/audit crawlers only.  Exotic crawlers not
 * in this list will pass through — the cost of mis-classifying a real buyer as
 * a bot is higher than the cost of allowing an unknown crawler through.
 */
export const BOT_UA_RE = /Googlebot|bingbot|Slurp|DuckDuckBot|AhrefsBot|SemrushBot|MJ12bot/i;

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

  /**
   * Quiz widget configuration.
   * Read from data-quiz-enabled attribute.
   * Default: { enabled: true }.
   * Added in FOLLOW-102.
   *
   * Rule L: data-quiz-trigger attribute removed — no producer or runtime consumer
   * existed. `buildSnippet()` in DetectionPreview.tsx never emitted it, and the SDK
   * timer (QUIZ_TRIGGER_DELAY_MS) never read the parsed value. FOLLOW-257 (Option A).
   */
  quiz?: {
    /** Whether the quiz widget is active for this tenant. Default true. */
    enabled: boolean;
  };

  /**
   * Whether to show micro-poll bottom-toast prompts as a quiz supplement.
   * Read from `data-micro-polls-enabled="true"` attribute on the script tag.
   * Default: false (opt-in only — emitting the attribute without "true" is a no-op).
   * Wired in FOLLOW-274 (Rule L): `buildSnippet` emits the attribute when the tenant's
   * `quiz_config.micro_polls_enabled` is true; this field reads it back.
   */
  microPollsEnabled?: boolean;
}

export const DEFAULT_CONFIG: Omit<SdkConfig, 'apiKey'> = {
  ingestUrl: 'https://ingest.estalara.com/v1/events',
  tier: 'observer',
  debug: false,
  consentState: 'legitimate_interest',
  language: 'en',
  accentColor: '#6c5ce7',
  quiz: { enabled: true },
};

/** Supported quiz/UI locales. Extend this tuple when adding a new language. */
const SUPPORTED_LANGUAGES = ['en', 'pl', 'es'] as const;
type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

function isSupportedLanguage(v: string): v is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(v);
}

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

  /**
   * Language resolution — 4-level priority chain (Master_Design v4.0 §E.4.6):
   *   1. quizConfig.language — admin-set per-tenant (from DB via /api/quiz/config).
   *      Applied by the quiz widget after init; not resolved here.
   *   2. data-language attribute — embed-time attribute on the <script> tag.
   *   3. navigator.language — browser's declared locale (e.g. 'pl-PL' → 'pl').
   *      Only the BCP-47 primary subtag (first 2 chars) is used.
   *      Unsupported locales fall through to level 4.
   *   4. 'en' — hardcoded fallback (lowest priority).
   *
   * navigator is accessed via globalThis.navigator (property access) rather than
   * the bare identifier `navigator`, because esbuild's Node-target transform
   * replaces `typeof navigator` with the string "undefined" as a constant-folding
   * optimisation, making the check permanently false in compiled modules even after
   * vi.stubGlobal('navigator', ...) in tests. globalThis property accesses are
   * not constant-folded and remain live in both browser and test environments.
   * MDN: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/language
   */
  const rawLanguage = script.dataset.language;
  let language: SdkConfig['language'];
  if (rawLanguage !== undefined && isSupportedLanguage(rawLanguage)) {
    // Level 2: explicit data-language attribute
    language = rawLanguage;
  } else {
    // Level 3: browser navigator.language (primary subtag only)
    const nav = (globalThis as { navigator?: { language: string } }).navigator;
    const browserPrimary = nav !== undefined ? nav.language.slice(0, 2) : undefined;
    language =
      browserPrimary !== undefined && isSupportedLanguage(browserPrimary)
        ? browserPrimary
        : DEFAULT_CONFIG.language; // Level 4: hardcoded 'en' fallback
  }

  const privacyPolicyUrl = script.dataset.privacyUrl;

  const accentColor = script.dataset.accentColor ?? DEFAULT_CONFIG.accentColor;

  // CSS selector for the inquiry form submit button — sourced from the tenant site schema
  // (inquiry_submit_selector field) and surfaced via data-inquiry-submit-selector attribute.
  const inquirySubmitSelector = script.dataset.inquirySubmitSelector;

  // Quiz widget configuration (FOLLOW-102).
  // data-quiz-enabled="false" disables the quiz entirely for this tenant.
  // Any value other than the string "false" resolves to enabled=true (safe default).
  // Rule L: buildSnippet() in DetectionPreview.tsx is the production producer of
  // data-quiz-enabled; it emits the attribute only when quiz_enabled === false.
  //
  // Rule L: data-quiz-trigger removed (FOLLOW-257, Option A). No producer
  // (buildSnippet never emitted it) and no runtime consumer (the timer uses the
  // hardcoded QUIZ_TRIGGER_DELAY_MS constant). Per-tenant timer configurability is
  // tracked separately in FOLLOW-199.
  const quizEnabled = script.dataset.quizEnabled !== 'false';

  // Micro-polls configuration (FOLLOW-274, Rule L).
  // data-micro-polls-enabled="true" opts this tenant into micro-poll bottom-toast prompts.
  // buildSnippet() in DetectionPreview.tsx is the production producer — it emits the
  // attribute only when quiz_config.micro_polls_enabled === true.
  // Only the exact string "true" enables micro-polls; any other value (absent, "false",
  // empty) resolves to false (safe opt-in default).
  const microPollsEnabled = script.dataset.microPollsEnabled === 'true';

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
    quiz: {
      enabled: quizEnabled,
    },
    ...(microPollsEnabled ? { microPollsEnabled: true } : {}),
  };
}
