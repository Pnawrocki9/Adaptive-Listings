/**
 * Cold-start DOM-adaptation floor constants (FOLLOW-343, AUDIT-2026-06-19 F-01).
 *
 * These constants gate `applyDirectives()` inside `refreshDirectives()` to prevent
 * the wrong-archetype cold-start reshuffle: at cold start the Bayesian prior is
 * BASE_PRIOR (~0.37) + device/referrer hints, which can push argmax to a non-neutral
 * archetype at ~0.05–0.10 effective confidence. Holding DOM mutations until we have
 * either sufficient confidence OR enough behavioral signals eliminates that reshuffle.
 *
 * ── THE GATE IS A DISJUNCTION (FOLLOW-877, corrected 2026-08-07) ─────────────
 *
 * The two constants below are consulted with `||`, never `&&`. `index.ts:827-829`:
 *
 *   const aboveFloor =
 *     resp.confidence >= DOM_ADAPT_CONFIDENCE_FLOOR ||
 *     currentIntentState.signal_count >= DOM_ADAPT_MIN_SIGNAL_COUNT;
 *
 * Everything the floor protects sits inside that ONE `if (aboveFloor)` block
 * (`index.ts:831-859`): `applyDirectives()` AND the fire-and-forget
 * `applyDescriptionAdaptation()`. Consequently **`DOM_ADAPT_CONFIDENCE_FLOOR` is
 * not a gate at all once `signal_count >= 2`** — on either axis.
 *
 * How fast is "once"? Faster than it reads. The `device_type.<desktop|mobile>`
 * prior at `index.ts:1031-1036` goes through `applyBehavioralSignal()`, which
 * increments `signal_count`, so a session starts its first `refreshDirectives()`
 * at `signal_count = 1`; the FIRST real behavioral event (a scroll depth
 * milestone, a `listing.viewed`) makes it 2. Locked by `follow-877.test.ts`.
 *
 * This docblock previously claimed the 0.5 floor was the "SOLE" gate of the
 * description axis. It was never true in shipped code — see FOLLOW-877 / RETRO-259
 * §4b CB-1. Whether the disjunction SHOULD hold on the description axis is an open
 * product decision (ESC-054); this module only describes what the code does.
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
 * Confidence gating ladder (FOLLOW-354, corrected by FOLLOW-875/877):
 *   0.5 = DOM_ADAPT_CONFIDENCE_FLOOR (this constant) — ONE OF TWO disjunctive SDK
 *         gates for BOTH directive mutations AND the /adapt/description fetch.
 *         The other is DOM_ADAPT_MIN_SIGNAL_COUNT below; either alone opens both.
 *   0.6 = CONFIDENCE_THRESHOLD in `apps/control-plane/src/app/api/adapt/route.ts:86`
 *         — server-side gate for /api/adapt directives. The comparison is
 *         `if (confidence <= CONFIDENCE_THRESHOLD) return { directives: [] }`
 *         (`route.ts:275`), so the real bar is **strictly greater than 0.6**;
 *         exactly 0.6 returns []. Boundary locked by
 *         `apps/control-plane/src/app/api/adapt/route.test.ts:267`.
 *         It is evaluated over the CLIENT-SENT `body.confidence ?? 0.5`
 *         (`route.ts:1224,1278`) — i.e. over this SDK's own intent state.
 *         No SDK constant gates sidebar visibility — the buyer-facing sidebar is
 *         admin-only (`index.ts:1080` — sidebar stays null, `show()` is a no-op).
 *
 * Asymmetry (real, and narrower than previously documented): /api/adapt has a
 * server-side gate at `> 0.6`, so on the DIRECTIVE axis the SDK floor can only ever
 * suppress a response the server already emptied. /adapt/description has NO
 * server-side confidence parameter (grep `confidence` in
 * `apps/control-plane/src/app/api/adapt/description/route.ts` → 0 hits), so the
 * description axis is gated ONLY client-side. Its full guard set is:
 *   1. the `aboveFloor` disjunction above (index.ts:827-829);
 *   2. `archetype !== 'neutral'` (`core/adapt-description.ts:390`);
 *   3. a `[data-estalara-slot="description"]` element AND a
 *      `[data-estalara-listing-id]` on the page (`adapt-description.ts:403-411`);
 *   4. `source === 'ai_cached'` with a non-null description in `fetchDescription`.
 * At confidence 0.5–0.59 the server returns [] for directives while the SDK still
 * fetches and applies a description — and below 0.5 it does so too, as soon as
 * `signal_count >= 2`. FOLLOW-344 blending and any future tuning of this constant
 * must be aware of this.
 */
export const DOM_ADAPT_CONFIDENCE_FLOOR = 0.5;

/**
 * Alternative DOM-adaptation gate: apply mutations when at least this many
 * behavioral signals have accumulated, regardless of confidence level.
 *
 * Lets adaptation proceed when the user has demonstrated real behavioral intent
 * (e.g. scrolled + filtered) even if the probability distribution is still
 * somewhat wide, ensuring experienced in-session users see personalised content.
 *
 * SCOPE (FOLLOW-877): "regardless of confidence level" is literal, and it covers
 * the /adapt/description fetch as well as directive mutations — both live inside
 * the same `if (aboveFloor)` block. Two signals is a low bar: the init-time
 * `device_type.*` prior already consumes one (`index.ts:1031-1036`), so a single
 * scroll-depth milestone reaches it. Whether LLM-generated long-form copy should
 * ride this escape hatch is the open question in ESC-054 — it is NOT settled by
 * this constant's existence, which predates the description axis (FOLLOW-159).
 */
export const DOM_ADAPT_MIN_SIGNAL_COUNT = 2;
