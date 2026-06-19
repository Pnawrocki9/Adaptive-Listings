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
