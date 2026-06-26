/**
 * Cold-start DOM-adaptation floor constants (FOLLOW-343, AUDIT-2026-06-19 F-01).
 *
 * These constants gate `applyDirectives()` inside `refreshDirectives()` to prevent
 * the wrong-archetype cold-start reshuffle: at cold start the Bayesian prior is
 * BASE_PRIOR (~0.37) + device/referrer hints, which can push argmax to a non-neutral
 * archetype at ~0.05–0.10 effective confidence. Holding DOM mutations until we have
 * either sufficient confidence OR enough behavioral signals eliminates that reshuffle.
 *
 * @module @estalara/sdk/core/adapt-floor
 */

/**
 * Minimum confidence a Decision API response must carry before any DOM mutation
 * (text, class, or reorder directive) is applied to the page.
 *
 * Value rationale: 0.5 is the mid-point of [0, 1]; at this level the argmax
 * archetype has clearly separated from the neutral baseline. Quiz leaf resolves at
 * 0.85 (well above this floor), so the quiz/drift path is never gated out (AC-3).
 *
 * Confidence gating ladder (FOLLOW-354):
 *   0.5 = DOM_ADAPT_CONFIDENCE_FLOOR (this constant) — SDK gate for BOTH directive
 *         mutations AND the /adapt/description fetch.
 *   0.6 = CONFIDENCE_THRESHOLD in route.ts — server-side gate for /api/adapt
 *         directives (returns [] below it), AND SIDEBAR_SHOW_THRESHOLD in index.ts.
 *
 * Asymmetry: /api/adapt has a server-side gate at 0.6, making the SDK floor
 * redundant on the DIRECTIVE axis. But /adapt/description has NO server-side
 * confidence parameter — this floor (0.5) is its SOLE gate. At confidence 0.5–0.59
 * the server returns [] for directives while the SDK may still fetch a description.
 * FOLLOW-344 blending and any future tuning of this constant must be aware of this.
 */
export const DOM_ADAPT_CONFIDENCE_FLOOR = 0.5;

/**
 * Alternative DOM-adaptation gate: apply mutations when at least this many
 * behavioral signals have accumulated, regardless of confidence level.
 *
 * Lets adaptation proceed when the user has demonstrated real behavioral intent
 * (e.g. scrolled + filtered) even if the probability distribution is still
 * somewhat wide, ensuring experienced in-session users see personalised content.
 */
export const DOM_ADAPT_MIN_SIGNAL_COUNT = 2;
