/**
 * SDK configuration — read from data-* attributes on the <script> tag.
 *
 * FOLLOW-273 (2026-06-11): `SdkConfig.language` now uses `QuizLanguage` from `@estalara/shared`
 * instead of the inline `'en'|'pl'|'es'` literal. The local `SUPPORTED_LANGUAGES` array now
 * derives from `QUIZ_LANGUAGE_VALUES` so there is a single canonical source of truth.
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

import type { QuizDefinition, QuizLanguage } from '@estalara/shared';
import { QUIZ_LANGUAGE_VALUES } from '@estalara/shared';

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
   * Uses `QuizLanguage` from `@estalara/shared` — the canonical `['en','pl','es']` union
   * (FOLLOW-273). Never repeat the literal set in SDK files.
   */
  language: QuizLanguage;
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
   *
   * ADR-0011 (FOLLOW-275): `enabled` is now resolved at runtime via
   * `fetchQuizConfig()` → `mergeQuizConfig()` in `init()`, NOT from the
   * `data-quiz-enabled` snippet attribute.  The attribute is retired as a
   * primary transport; `readConfig()` no longer reads it.  Any value set here
   * by `readConfig()` is a hardcoded SDK default that `mergeQuizConfig()` will
   * override with the server-fetched value once the fetch resolves.
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
   *
   * ADR-0011 (FOLLOW-275): this field is now resolved at runtime via
   * `fetchQuizConfig()` → `mergeQuizConfig()` in `init()`, NOT from the
   * `data-micro-polls-enabled` snippet attribute.  The attribute is retired as a
   * primary transport; `readConfig()` no longer reads it.  Any value set here
   * by `readConfig()` is a hardcoded SDK default that `mergeQuizConfig()` will
   * override with the server-fetched value once the fetch resolves.
   */
  microPollsEnabled?: boolean;

  /**
   * Per-tenant brand configuration (FOLLOW-623 / ADR-0019).
   *
   * Resolved at runtime from the `brand` slice of the `GET /api/quiz/public-config`
   * response (`mergeQuizConfig()`), keyed by tenant identity via the API key
   * (DOMAIN-INDEPENDENT — never from the serving host). Never read from a snippet
   * attribute or `readConfig()`.
   *
   * ABSENT when the tenant configured no `brand_config` — the SDK then uses hardcoded
   * widget colors/logo (byte-identical to pre-ADR-0019, ADR-0019 D4). `logoUrl` is
   * `string | null`, NEVER `undefined` (ADR-0019 D-nullability).
   *
   * Consumed by the widget renderers per the ADR-0019 D4 precedence
   * (`quiz_config.accent_color` > `brand.primary_color` > SDK default):
   *   - `primaryColor` → the quiz sticky-trigger background (a widget with no per-widget
   *     color; falls back to the hardcoded `#ef4444` when absent).
   *   - `logoUrl`      → the brand logo shown atop the quiz card (none when absent).
   *   - `whiteLabel`   → parsed and exposed but NOT consumed by this ticket (colors/logo
   *     only); its consumer is unspecified by ADR-0019 D4 (PR-noted deviation).
   */
  brand?: {
    primaryColor: string;
    logoUrl: string | null;
    whiteLabel: boolean;
  };

  /**
   * Per-tenant editable quiz definition (FOLLOW-639 / ADR-0019 D5).
   *
   * Resolved at runtime from the `quiz_definition` slice of the `GET /api/quiz/public-config`
   * response (`mergeQuizConfig()`), keyed by tenant identity via the API key
   * (DOMAIN-INDEPENDENT — never from the serving host). Never read from a snippet attribute.
   *
   * ABSENT when the tenant configured no quiz tree — the SDK then walks its built-in
   * `DEFAULT_QUIZ_DEFINITION` (byte-identical to pre-ADR-0019, ADR-0019 D4/D5).
   */
  quizDefinition?: QuizDefinition;
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

/**
 * Supported quiz/UI locales — aliased from the canonical `QUIZ_LANGUAGE_VALUES` tuple.
 * Add new locales to `packages/shared/src/schemas/quiz-config.ts` only; this alias
 * and `isSupportedLanguage` update automatically (FOLLOW-273).
 */
const SUPPORTED_LANGUAGES = QUIZ_LANGUAGE_VALUES;
type SupportedLanguage = QuizLanguage;

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

  // Quiz widget configuration — defaults only (ADR-0011, FOLLOW-275).
  //
  // `data-quiz-enabled` and `data-micro-polls-enabled` are RETIRED as primary
  // transports. The authoritative values are fetched at runtime via
  // `fetchQuizConfig()` in `init()` and merged via `mergeQuizConfig()`.
  //
  // `readConfig()` sets the hardcoded SDK defaults here; they are overridden by
  // the server-fetched values in `mergeQuizConfig()` before the quiz/micro-poll
  // schedulers run.
  //
  // DEPRECATED_FALLBACK: the two attributes below are read ONLY as a legacy
  // fallback path for tenants whose snippets pre-date ADR-0011 and whose
  // `decisionApiUrl` is unreachable (i.e. `fetchQuizConfig()` returns null).
  // In that edge case the snippet-attribute values serve as the second-level
  // fallback before the hardcoded defaults.  `mergeQuizConfig()` applies the
  // server value first; these fallbacks are never used when the fetch succeeds.
  //
  // Rule L: data-quiz-trigger removed (FOLLOW-257, Option A). No producer
  // (buildSnippet never emitted it) and no runtime consumer (the timer uses the
  // hardcoded QUIZ_TRIGGER_DELAY_MS constant). Per-tenant timer configurability is
  // tracked separately in FOLLOW-199.

  // DEPRECATED_FALLBACK reads — used only when fetchQuizConfig() returns null.
  const quizEnabledFallback = script.dataset.quizEnabled !== 'false';
  const microPollsEnabledFallback = script.dataset.microPollsEnabled === 'true';

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
      // Default: enabled=true (overridden by mergeQuizConfig if fetch succeeds).
      // DEPRECATED_FALLBACK: quizEnabledFallback used only when fetch returns null.
      enabled: quizEnabledFallback,
    },
    // DEPRECATED_FALLBACK: microPollsEnabledFallback used only when fetch returns null.
    ...(microPollsEnabledFallback ? { microPollsEnabled: true } : {}),
  };
}
