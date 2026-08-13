/**
 * Cold-start DOM-adaptation floor constants (FOLLOW-343, AUDIT-2026-06-19 F-01).
 *
 * These constants gate DOM mutation inside `refreshDirectives()` to prevent the
 * wrong-archetype cold-start reshuffle: at cold start the Bayesian prior is
 * BASE_PRIOR (~0.37) + device/referrer hints, which can push argmax to a non-neutral
 * archetype at ~0.05–0.10 effective confidence. Holding DOM mutations until we have
 * either sufficient confidence OR enough behavioral signals eliminates that reshuffle.
 *
 * ── TWO AXES, TWO SIGNAL-COUNT THRESHOLDS (ESC-054 ruled 2026-08-08, FOLLOW-913) ──
 *
 * `index.ts` computes TWO disjunctions, not one. Both still OR the SAME confidence
 * floor with a signal-count alternative, but the signal-count alternative differs
 * per axis:
 *
 *   const aboveFloor =                                  // directive axis
 *     resp.confidence >= DOM_ADAPT_CONFIDENCE_FLOOR ||
 *     currentIntentState.signal_count >= DOM_ADAPT_MIN_SIGNAL_COUNT;             // 2
 *
 *   const aboveDescriptionFloor =                        // description axis
 *     resp.confidence >= DOM_ADAPT_CONFIDENCE_FLOOR ||
 *     currentIntentState.signal_count >= DOM_ADAPT_DESCRIPTION_MIN_SIGNAL_COUNT; // 5
 *
 * `applyDirectives()` is gated by `aboveFloor`; the fire-and-forget
 * `applyDescriptionAdaptation()` is gated by `aboveDescriptionFloor` — two separate
 * `if` blocks, not one shared block. Before FOLLOW-913 there was a single `aboveFloor`
 * disjunction covering both, which meant the SAME two real behavioral events that
 * opened the directive axis also opened the description axis — CEO ruling (ESC-054)
 * kept the disjunction shape but raised the description axis's signal-count bar so
 * LLM-generated long-form copy requires more accumulated behavioral evidence than a
 * text/class/reorder directive swap.
 *
 * The directive axis is effectively redundant in production: the server already gates
 * `/api/adapt` at `confidence > 0.6` (see `DOM_ADAPT_CONFIDENCE_FLOOR`'s own docblock
 * below), so `DOM_ADAPT_MIN_SIGNAL_COUNT` mostly matters for the case the server gate
 * cannot reach — see that docblock for the asymmetry. This is why ESC-054 left the
 * directive axis untouched and only raised the description axis.
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
 * Confidence gating ladder (FOLLOW-354, corrected by FOLLOW-875/877, axis split by
 * FOLLOW-913 / ESC-054):
 *   0.5 = DOM_ADAPT_CONFIDENCE_FLOOR (this constant) — the confidence arm of BOTH
 *         disjunctions below: `aboveFloor` (directives) and `aboveDescriptionFloor`
 *         (the `/adapt/description` fetch). Each disjunction also has its OWN
 *         signal-count arm: `DOM_ADAPT_MIN_SIGNAL_COUNT` (2, directives) and
 *         `DOM_ADAPT_DESCRIPTION_MIN_SIGNAL_COUNT` (5, description).
 *   0.6 = CONFIDENCE_THRESHOLD in `apps/control-plane/src/app/api/adapt/route.ts:86`
 *         — server-side gate for /api/adapt directives. The comparison is
 *         `if (confidence <= CONFIDENCE_THRESHOLD) return { directives: [] }`
 *         (`route.ts:275`), so the real bar is **strictly greater than 0.6**;
 *         exactly 0.6 returns []. Boundary locked by
 *         `apps/control-plane/src/app/api/adapt/route.test.ts:267`.
 *         It is evaluated over the CLIENT-SENT `body.confidence ?? 0.5`
 *         (`route.ts:1224,1278`) — i.e. over this SDK's own intent state.
 *         No SDK constant gates sidebar visibility — the buyer-facing sidebar is
 *         admin-only (`index.ts:1137` — sidebar stays null, `show()` is a no-op).
 *
 * Asymmetry (real, and narrower than previously documented): /api/adapt has a
 * server-side gate at `> 0.6`, so on the DIRECTIVE axis the SDK floor can only ever
 * suppress a response the server already emptied. /adapt/description has NO
 * server-side confidence parameter (grep `confidence` in
 * `apps/control-plane/src/app/api/adapt/description/route.ts` → 0 hits), so the
 * description axis is gated ONLY client-side. Its full guard set is:
 *   1. the `aboveDescriptionFloor` disjunction above (index.ts, `refreshDirectives`);
 *   2. `archetype !== 'neutral'` (`core/adapt-description.ts:390`);
 *   3. a `[data-estalara-slot="description"]` element AND a
 *      `[data-estalara-listing-id]` on the page (`adapt-description.ts:403-411`);
 *   4. `source === 'ai_cached'` with a non-null description in `fetchDescription`.
 * At confidence 0.5–0.59 the server returns [] for directives while the SDK still
 * fetches and applies a description — and below 0.5 it does so too, once
 * `signal_count >= DOM_ADAPT_DESCRIPTION_MIN_SIGNAL_COUNT` (5, not 2 — FOLLOW-913).
 * FOLLOW-344 blending and any future tuning of this constant must be aware of this.
 */
export const DOM_ADAPT_CONFIDENCE_FLOOR = 0.5;

/**
 * Directive-axis alternative DOM-adaptation gate: apply text/class/reorder
 * directives when at least this many behavioral signals have accumulated,
 * regardless of confidence level.
 *
 * Lets adaptation proceed when the user has demonstrated real behavioral intent
 * (e.g. scrolled + filtered) even if the probability distribution is still
 * somewhat wide, ensuring experienced in-session users see personalised content.
 *
 * SCOPE (FOLLOW-913 / ESC-054, corrected — previously this constant's scope
 * covered the description axis too): this constant now gates the DIRECTIVE axis
 * ONLY (`applyDirectives()`, via the `aboveFloor` disjunction). The description
 * axis (`applyDescriptionAdaptation()`) has its own, higher bar —
 * `DOM_ADAPT_DESCRIPTION_MIN_SIGNAL_COUNT` (5) — because LLM-generated long-form
 * copy has no server-side confidence gate of its own (see
 * `DOM_ADAPT_CONFIDENCE_FLOOR`'s docblock), so it warrants more accumulated
 * behavioral evidence than a directive swap the server can independently veto.
 *
 * Two signals is a low bar on the directive axis: the init-time `device_type.*`
 * prior already consumes one (`index.ts:1089-1094`), so a single scroll-depth
 * milestone reaches it. This was judged acceptable for directives specifically
 * because the server's own `> 0.6` gate (see above) already dominates that axis in
 * production — this constant mostly matters for the confidence-vs-signal_count
 * asymmetry the docblock above describes, not as the primary directive gate.
 */
export const DOM_ADAPT_MIN_SIGNAL_COUNT = 2;

/**
 * Description-axis alternative DOM-adaptation gate: fetch and apply the
 * `/adapt/description` long-form copy when at least this many behavioral signals
 * have accumulated, regardless of confidence level.
 *
 * **CEO ruling (ESC-054, 2026-08-08, FOLLOW-913): keep the disjunction, raise the
 * description axis to `signal_count >= 5`.** Before this ruling the description
 * axis shared `DOM_ADAPT_MIN_SIGNAL_COUNT` (2) with the directive axis — see
 * FOLLOW-877 / ESC-054 for the original finding: because the init-time
 * `device_type.*` prior already consumes one signal (`index.ts:1089-1094`), a
 * SINGLE real behavioral event (one scroll-depth milestone) was enough to put
 * LLM-generated, ungrounded-risk long-form copy on the page at any confidence,
 * including the ~0.05–0.10 cold-start band FOLLOW-343 was opened to guard against.
 * `>= 5` means FOUR real behavioral events are required (the device_type prior
 * still consumes the first of the five).
 *
 * Deliberately NOT reused as `DOM_ADAPT_MIN_SIGNAL_COUNT` — the two axes now hold
 * different values, and giving them one shared name would re-create exactly the
 * confusion FOLLOW-875 spent a P1 untangling (a single constant silently governing
 * two different code paths with different risk profiles).
 */
export const DOM_ADAPT_DESCRIPTION_MIN_SIGNAL_COUNT = 5;

/**
 * The curated slot name carrying long-form listing description copy. [FOLLOW-948]
 *
 * Lives here, with the gating constants, because its only purpose is gating: it names the ONE
 * slot whose `text` directives must clear `DOM_ADAPT_DESCRIPTION_MIN_SIGNAL_COUNT` rather than
 * `DOM_ADAPT_MIN_SIGNAL_COUNT`.
 *
 * **Why the split exists.** The ESC-054 ruling (CEO, 2026-08-08) raised the bar on LLM-generated
 * long-form description COPY. `aboveDescriptionFloor` gated the `/adapt/description` FETCH — but
 * `TextDirective.slot` is an unconstrained `string`, `SlotSelectors.description` is a real curated
 * slot, and `annotateSlots()` marks it on the page unconditionally. So a `text` directive naming
 * this slot would rewrite the protected copy through the DIRECTIVE path at 2 signals, bypassing
 * the ruling's 5. That was an omission, not a design decision: nothing in the repo recorded a
 * choice to allow it, and it contradicts the ruling's own object.
 *
 * **Not reachable in production as of 2026-08-13**, and this constant is what keeps it that way:
 * no shipped playbook defines a `description` slot (the only `slot: 'description'` in the estate
 * is a test fixture), and the server empties `directives` at `confidence <= 0.6`. The exposure
 * ARMS the moment `CONFIDENCE_THRESHOLD` becomes per-tenant tunable — the live question in
 * FOLLOW-889 / FOLLOW-906 — or as soon as any playbook gains the slot. Both are changes somebody
 * would make for unrelated reasons, which is exactly why this is pinned by a test rather than by
 * an arithmetic argument that holds only at today's threshold.
 */
export const DESCRIPTION_SLOT = 'description';
