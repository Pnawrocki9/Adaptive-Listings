# ADR-0024 — Adapt-route decision record: the history the code comments used to carry

**Status:** Accepted on merge (2026-10-12) — a record, not a new decision · **Author:**
backend-engineer (FOLLOW-1295, WP-2.10a of `docs/PLAN-AUDIT-REMEDIATION-2026-09-24.md`, epic
FOLLOW-1257) · **Baseline:** `main` at `22af3f7f` (all line numbers below refer to it)

---

## Why this document exists

The five files on the `/api/adapt` path — `apps/control-plane/src/app/api/adapt/route.ts`,
`apps/control-plane/src/lib/llm-gateway.ts`, `packages/sdk/src/index.ts`,
`packages/sdk/src/core/intent.ts`, `packages/sdk/src/core/adapt.ts` — had accumulated comment blocks
that narrated ticket history ("FOLLOW-xxx: previously…", RETRO/ESC findings, measurements, rejected
alternatives) rather than stating why the code is the way it is. FOLLOW-1296 (#993) split the former
`init()` body of `index.ts` into `packages/sdk/src/core/boot.ts`, `consent-flow.ts`,
`intent-loop.ts` and `adapt-loop.ts`, so those four modules carry the comments that used to live in
`index.ts` and are part of this record's scope.

Measured on the baseline with the TypeScript parser (real comment ranges, so prompt text inside
template literals is never miscounted): **3,830 comment lines in 659 blocks** across the nine files.
The code needs the "why"; the history belongs in a decision record where it can be read in one
place.

## Decision

1. Each history-carrying comment block in those nine files is reduced to **one "why" sentence plus
   the ticket id(s)** — the id stays in the code because humans and `scripts/check-rule-i.sh` grep
   for it.
2. **Kept in the code, deliberately:** TSDoc contracts on exported APIs (`@param` / `@returns` /
   `@internal` / `@deprecated`), every ESC-076 / MASTER_DESIGN §E.7.0 grounding-rule reference, and
   invariants no test enforces — the `migration-contract-test.sh` single-line column-list rule and
   its `OPTIONAL_COLUMN` marker in `route.ts`, the "judge budgets derive from the slot count" rule
   in `llm-gateway.ts` and the "cold-start priors go inside this one gate" rule in `boot.ts`. The
   ADR-0021 §D5 consent-text ordering and fail-closed rule in `consent-flow.ts` is tested
   (`follow-915.test.ts`) but also stays, because its scope is easy to over-generalise into "no
   fetch before consent". Every `[MP-NNN]` citation a file carried also stays, because
   `scripts/check-measured-premises.mjs` requires each file named in a premise's `relied_on_by` to
   cite it.
3. **Moved here, verbatim:** every original block that was rewritten, below, one section per file,
   each entry naming the file, its baseline line, the nearest enclosing top-level declaration and
   the first code line after the comment, followed by the original text exactly as it stood. Blocks
   that were already one or two lines and carried no history were left untouched and do not appear.
4. No code change. The one exception is a Rule I correction, recorded next.

## The Rule I finding this exposed

`scripts/check-rule-i.sh` counts any `\bsymbol\b` mention in a non-test file as an importer, so a
comment can keep an export "alive". Removing the comments surfaced exactly one such case:

- `classifyFromProbabilities` (`packages/sdk/src/core/intent.ts`) — its only non-test "importer" was
  a comment in `packages/sdk/src/core/adapt-loop.ts` (the neutral-decay restore note, entry
  `adapt-loop.ts:331` below); all real callers are inside `intent.ts`, and the export existed for
  tests. The export was removed. The three test files that imported it (`intent.test.ts`,
  `intent-switch-margin.test.ts`, `follow-380.test.ts`) now drive the same production classifier
  through its public call sites via `packages/sdk/src/__tests__/classify-via-public-api.ts`
  (`initIntentState()` for the free cold-start path, `applyBehavioralSignal()` with a no-information
  likelihood for the guarded path).

Rule I's violation set is otherwise unchanged against the baseline.

## Consequences

- The nine files fall from 3,830 to under 1,000 comment lines; a reader of the code sees the reason,
  and a reader who needs the story searches this file for the ticket id.
- Line numbers in older RETRO / FOLLOW entries that point into these files are stale against the new
  code; the baseline line numbers below resolve them.
- This record is not updated by later tickets. New history goes into the ticket, the PR and, when it
  is a decision, a new ADR — not back into comment blocks.

## Later decision: the tweak band's model (FOLLOW-1426, CEO 2026-10-31)

The `The record` below quotes the comments as they stood on the baseline date; where it says the
tweak band "stays Haiku", that is history. Since FOLLOW-1426 `callLlmGateway` decides the band from
`similarity` once (`bandFor`) and passes it on: the band picks the `source` (`llm_tweaked` vs
`llm_full`), the prompt (tweak vs generation) and the judge call budget. The model is `forceModel`,
else `getGlobalGenerationModel()` for BOTH bands. The band is never inferred from the model. The
fact-check judge stays on Haiku 4.5 (it writes nothing buyers read). Local data over two days that
motivated it: Haiku p50 2.6 s, p95 3.6 s, USD 0.0023 per call; Sonnet p50 2.3 s, p95 3.6 s, USD
0.0045 per call.

## The record

Format of each entry: `#### <file>:<baseline line> — <enclosing declaration>`, the first code line
after the comment ("Anchor"), the sentence that replaced it, then the original block.

### `apps/control-plane/src/app/api/adapt/route.ts`

#### route.ts:1 — module header

Anchor (first code line after the comment): `import { NextResponse } from 'next/server';`

Kept in the code as: POST /api/adapt — the Decision API (Master Design E.1); decision history in
ADR-0024. @module apps/control-plane/src/app/api/adapt/route

```text
/**
 * POST /api/adapt
 *
 * Decision API — returns personalized adaptation directives for the given session. POST is the
 * only method: `GET /api/adapt` was retired by FOLLOW-1287 (ADR-0004 amendment) — it had no
 * caller, and the SDK, the FOLLOW-819 harness and the FOLLOW-1022 canary all POST. A GET now gets
 * Next.js's 405.
 *
 * Implements the decision tree from Master Design E.1:
 *   1. confidence <= 0.6  → default (no adaptation)
 *   2. similarity > 0.85  → use pre-computed archetype playbook  (source: 'playbook')
 *   3. 0.6 < similarity <= 0.85 → Haiku LLM tweak  (source: 'llm_tweaked', ADP-002)
 *   4. similarity <= 0.6, conf > 0.6 → Sonnet full gen (source: 'llm_full', ADP-002)
 *
 * Sprint 7 Phase 2: LLM gateway wired for branches 3 and 4 (ADP-002). Since FOLLOW-1287 the two
 * branches share ONE gateway call; the band only picks the `source` label and the null fallback.
 * On gateway failure (null return), falls back to:
 *   - llm_tweaked: playbook directives + source 'playbook_fallback_llm_unavailable'
 *   - llm_full: empty directives + source 'playbook_fallback_llm_unavailable'
 *   - cap hit: source 'playbook_fallback_llm_capped'
 * Every fallback response also carries `fallback_reason` (FOLLOW-1056) — 'llm_unavailable' or
 * 'fact_check_refused'. The `source` above cannot separate those two, and they are opposites:
 * one is an incident, the other is the fact check working. NOTE, unchanged by that ticket and
 * verified while writing this line: no return site in this file emits
 * 'playbook_fallback_llm_capped' — the cap path returns 'playbook_fallback_llm_unavailable'
 * like the others.
 *
 * Request: a JSON body with archetype hint, confidence,
 * similarity, and session context. Accepts a real tenant API key resolved via
 * the shared ADR-0015 `resolveApiKey()` (FOLLOW-451 — closes audit F-05). Under
 * `DEMO_MODE=1` only (FOLLOW-1288), also the ops caller and a valid HS256 demo
 * JWT (FOLLOW-205), and the per-tenant archetype override applies — all in
 * `lib/demo/adapt-demo-context.ts`.
 *
 * ClickHouse logging is fire-and-forget — the response is returned immediately
 * and the analytics insert happens asynchronously.
 *
 * @module apps/control-plane/src/app/api/adapt/route
 */
```

#### route.ts:112 — `AdaptPostBodySchema`

Anchor (first code line after the comment):
`intent_vector: z.array(z.number()).max(2048).optional(),`

Kept in the code as: Session intent vector (1536-dim) for RAG lookup; absent → RAG skipped.

```text
/**
 * Session intent vector (1536-dim). Passed by the intent engine for RAG similarity lookup.
 * When absent, RAG step is skipped and listingContext defaults to {}.
 */
```

#### route.ts:117 — `AdaptPostBodySchema`

Anchor (first code line after the comment): `holdout_group: z.boolean().optional(),`

Kept in the code as: Caller's A/B holdout assignment, logged to ClickHouse [TICKET-AB-001].

```text
/**
 * A/B holdout assignment result from the caller (SDK; formerly also the retired Worker).
 * When provided, this value is logged to ClickHouse adaptation_decisions.
 * Populated from assignHoldout() — see TICKET-AB-001 (PR #80).
 */
```

#### route.ts:123 — `AdaptPostBodySchema`

Anchor (first code line after the comment): `holdout_pct: z.number().min(0).max(1).optional(),`

Kept in the code as: Holdout rate; honoured only for the ops caller [TICKET-AB-010, FOLLOW-1201].

```text
/**
 * Holdout percentage used at assignment time. Used with holdout_group for
 * context in ClickHouse analytics and for server-side assignHoldout().
 * [TICKET-AB-010]
 */
```

#### route.ts:129 — `AdaptPostBodySchema`

Anchor (first code line after the comment): `consent_state: z.string().optional(),`

Kept in the code as: Session consent state, for holdout consent gating [TICKET-AB-010].

```text
/**
 * Consent state from the session. Used for A/B holdout consent gating.
 * [TICKET-AB-010]
 */
```

#### route.ts:134 — `AdaptPostBodySchema`

Anchor (first code line after the comment): `consent_mode_enabled: z.boolean().optional(),`

Kept in the code as: When true, non-granted consent skips A/B assignment [TICKET-AB-010].

```text
/**
 * Whether the tenant has consent mode enabled.
 * When true, sessions with non-granted consent states are skipped for A/B assignment.
 * [TICKET-AB-010]
 */
```

#### route.ts:140 — `AdaptPostBodySchema`

Anchor (first code line after the comment): `locale: z.enum(['en', 'pl', 'es']).optional(),`

Kept in the code as: Content locale for slot copy; falls back to English per slot [F-09].

```text
/**
 * Content locale for slot copy selection [F-09].
 * Defaults to 'en'; slot falls back to English when no override exists for the locale.
 */
```

#### route.ts:152 — `AdaptPostBodySchema`

Anchor (first code line after the comment): `async function runDecisionTree(`

Kept in the code as: Run the adaptation decision tree (Master Design E.1); branches 3 and 4 call the
LLM gateway. @param archetypeId - Archetype matched by the intent engine. @param confidence - Intent
confidence 0–1. @param similarity - Cosine similarity to the matched archetype 0–1. @param
sessionId - Session ID threaded to the LLM gateway for cost attribution. @param tenantId - Tenant ID
threaded to the LLM gateway for cost attribution. @param locale - Content locale; slot copy falls
back to 'en'. @param listingContext - Listing facts + agency FAQ answers (may be empty). @param
forceModel - Optional Anthropic model ID to force (DEMO MODE, DEMO-001). @param variant - Bandit
variant; MUST be 'control' for holdout sessions [FOLLOW-360]. @returns Directives + source, plus
`fallback_reason` on a fallback [FOLLOW-1056].

```text
/**
 * Run the adaptation decision tree per Master Design E.1.
 * Now async: branches 3 and 4 call the LLM gateway (ADP-002).
 * TICKET-AGENCY-001: accepts precomputed `listingContext` for RAG injection.
 * FOLLOW-342: accepts `variant` so the bandit selection reaches copy selection.
 *
 * @param archetypeId    - Archetype matched by the intent engine.
 * @param confidence     - Intent confidence 0–1.
 * @param similarity     - Cosine similarity to the matched archetype 0–1.
 * @param sessionId      - Session ID threaded to LLM gateway for cost attribution.
 * @param tenantId       - Tenant ID threaded to LLM gateway for cost attribution.
 * @param locale         - Content locale; slot copy falls back to 'en' when locale override absent.
 * @param listingContext - Agency FAQ answers from RAG retrieval (may be empty).
 * @param forceModel     - Optional Anthropic model ID to force (DEMO MODE, DEMO-001).
 * @param variant        - Bandit variant (one of SEED_VARIANTS in bandit-query.ts). Defaults to
 *                         'control' for backwards compat. Selects from
 *                         `SlotDirective.variants.en` when present.
 *                         HOLDOUT RULE (FOLLOW-360 / RETRO-095): callers MUST pass 'control' when
 *                         the session is in the holdout group. Bandit sampling must be bypassed
 *                         entirely for holdout sessions so the counterfactual baseline stays
 *                         control-only and is not contaminated by v1/v2 arm selections.
 * @returns Partial adaptation result (directives + source, plus `fallback_reason` on the two
 *          branches that can fall back — FOLLOW-1056).
 */
```

#### route.ts:186 — `runDecisionTree`

Anchor (first code line after the comment): `groundingMissing = false,`

Kept in the code as: Listing facts were requested but did not arrive [FOLLOW-1120].

```text
/**
 * FOLLOW-1120. The caller asked to ground this generation in a specific listing and the facts
 * did not arrive, so the prompt below carries the grounding RULE with no grounding BLOCK.
 * Passed in rather than derived here because this function never sees the requested
 * `listing_id`, and "no facts" without "facts were asked for" is not a fault.
 */
```

#### route.ts:193 — `runDecisionTree`

Anchor (first code line after the comment): `listingId?: string,`

Kept in the code as: Facts for playbook `{token}`s on the no-model branches [FOLLOW-1140, ESC-074].

```text
/**
 * FOLLOW-1140 / ESC-074 (b). The listing whose facts fill playbook `{token}` placeholders.
 * Distinct from `listingContext`, which is prose for the model: this one is the structured
 * facts a TEMPLATE substitutes, on the two branches that serve playbook copy verbatim and
 * therefore never reach the model at all. Absent → no token resolves and every directive
 * carrying one is discarded, which is FOLLOW-1018's rule applied one layer earlier.
 */
```

#### route.ts:206 — `runDecisionTree`

Anchor (first code line after the comment): `variant_suppressed?: true;`

Kept in the code as: No served slot differs between arms, so the arm gets no credit [FOLLOW-1163].

```text
/**
 * FOLLOW-1163 / ESC-077 option 2. Set when this response carries NO served slot that differs
 * between bandit arms, so the sampled arm MUST NOT be credited with it.
 *
 * Note the predicate is about the SERVED set, not about the withhold: an arm earns credit when
 * something the buyer actually received could have differed because of it. Those coincide today
 * only because `headline` is the sole slot carrying `variants.en` anywhere in the shipped
 * playbooks.
 *
 * WHY THIS EXISTS AT ALL. Only `headline` carries `variants.en` — `cta` and `feature` have
 * none, across all 18 playbooks. Withhold the headline and control / v1 / v2 serve byte-identical
 * copy, while the arm is still sampled, still logged and still echoed into
 * `POST /api/adapt/feedback`, which updates the `(tenant_id, archetype, variant)` posteriors in
 * `ab_bandit_weights`. The experiment would keep accruing evidence for a difference no buyer
 * could see, and would eventually declare a winner on noise.
 *
 * This is EXACTLY the mismatch FOLLOW-362 already ruled on for non-`en` locales — "every
 * non-`en` slot carries a single locale string … a variant/copy mismatch that corrupts A/B
 * analytics" — and the remedy is the same one: record `control`. It is not a white lie: the
 * copy actually served on a withheld response IS the control copy, because `cta` has no
 * variants and therefore falls through to `s.en` for every arm.
 *
 * Reported here rather than decided at sampling time because only one of the two withholding
 * paths is predictable before the call: branch 2 is (`similarity > HIGH_SIMILARITY_THRESHOLD`),
 * but branch 3's fallback depends on whether the gateway returns null, which is not knowable
 * until it has.
 */
```

#### route.ts:244 — `runDecisionTree`

Anchor (first code line after the comment):
`const variantIndex: number | undefined = VARIANT_INDEX[variant];`

Kept in the code as: A stray variant is served `s.en` but logged raw, so a bad bandit table stays
visible [FOLLOW-405].

```text
// FOLLOW-342 / FOLLOW-397 / FOLLOW-405: resolve the variant index once per call.
// VARIANT_INDEX is derived from SEED_VARIANTS (Rule K.1). Unknown variant names
// (e.g. a stray 'v3' not yet in SEED_VARIANTS) yield undefined.
//
// STRAY-ARM CONTRACT (FOLLOW-405 AC-3):
//   served copy  → s.en (base English copy)
//     The value chain is:
//       locale-override ?? (variantIndex !== undefined ? s.variants?.en[idx] : undefined) ?? s.en
//     When variantIndex is undefined the middle branch short-circuits to undefined,
//     so the final ?? s.en fallback fires. No variant copy is served.
//   logged value → the RAW sampled arm string (e.g. 'v3') is written to
//     param_p_variant / adaptation_decisions.variant via logDecisionAsync. The
//     logged string is intentionally NOT resolved to 'control' so analytics can
//     distinguish "arm exists and was selected" from "arm was sampled but
//     unrecognised" — useful for detecting a misconfigured bandit table that
//     seeds arms not present in SEED_VARIANTS.
//
// The FOLLOW-405 parity test (variant-index.parity.test.ts) ensures this stray-arm
// path is never exercised in steady-state: it reds CI if SEED_VARIANTS gains an arm
// without a matching variants.en entry in every non-neutral playbook.
```

#### route.ts:266 — `runDecisionTree`

Anchor (first code line after the comment):
`// FOLLOW-1163 / ESC-077 option 2: which slots actually DIFFER between bandit arms.`

Kept in the code as: Playbook slots → TextDirectives: locale override, then bandit variant, then
`s.en` [F-09].

```text
// Convert playbook slots → TextDirectives; prefer locale override, fall back to English [F-09].
// FOLLOW-342: when a slot carries `variants.en`, use the bandit-selected index.
// Falls back to `s.en` when variants are absent or the index is out of range.
```

#### route.ts:270 — `runDecisionTree`

Anchor (first code line after the comment): `const variantBearingSlots = new Set(`

Kept in the code as: Keyed on SERVED slots, so variants on a surviving slot still earn credit
[FOLLOW-1163].

```text
// FOLLOW-1163 / ESC-077 option 2: which slots actually DIFFER between bandit arms.
//
// The predicate below is deliberately about the SERVED set, not about the withhold. An arm may
// be credited only when something the buyer received could have differed because of it. Today
// `headline` is the only slot carrying `variants.en` in any shipped playbook, so once §E.7.0
// withholds it nothing served differs — but a future playbook (FOLLOW-1164) could put variants
// on a slot that survives the withhold, and then the arm HAS earned the credit. Keying on the
// served slots rather than on "did we withhold" is what makes that work without another edit.
```

#### route.ts:297 — `runDecisionTree`

Anchor (first code line after the comment): `const playbookTokenDrop = { dropped: false };`

Kept in the code as: Token fill on the verbatim-template branches only; an object for eslint
narrowing [FOLLOW-1140].

```text
// FOLLOW-1140 / ESC-074 (b): fill `{token}` placeholders from the listing's own facts before
// any playbook copy leaves the route. Applied to the two branches that serve the template
// VERBATIM — branch 2 below and branch 3's fallback — because those are the ones no model ever
// sees. On the `llm_*` branches the generation prompt already carries the substitution
// instruction and FOLLOW-457's fact check governs the result, so re-processing them here would
// duplicate one contract with another. Returns the directives unchanged, and performs no
// fetch, whenever the selected copy carries no placeholder at all.
//
// An object and not a bare `let` for the reason recorded on `gatewayFallback` below: eslint's
// flow analysis over-narrows a `let` reassigned only inside a closure to its initial literal.
```

#### route.ts:326 — `runDecisionTree`

Anchor (first code line after the comment): `if (similarity > HIGH_SIMILARITY_THRESHOLD) {`

Kept in the code as: Branch 2: playbook, no LLM; property-fact slots withheld per §E.7.0 (ESC-076)
[FOLLOW-1163].

```text
// Branch 2: high similarity — use playbook directly (no LLM)
//
// FOLLOW-1163 / MASTER_DESIGN §E.7.0. This branch never read the listing — `withListingFacts`
// skips the fetch above its ceiling, deliberately, because no model runs here. `similarity` is
// confidence about the BUYER's archetype and says nothing about the PROPERTY, so it cannot
// license `'Golden Visa Eligible'` about THIS one. Everything that asserts a property fact is
// therefore withheld and only the `cta` — an offer we make, true whatever the listing says —
// is served. See `lib/ungrounded-directives.ts` for the classification and the enumeration of
// shipped copy behind it.
```

#### route.ts:352 — `runDecisionTree`

Anchor (first code line after the comment): `...(withheldSlots.length > 0`

Kept in the code as: Withhold beats the token signal: no token-bearing slot survives §E.7.0 here
[FOLLOW-1163].

```text
// The only branch where `fallback_reason` was previously always absent, so it is the only
// one where these signals can reach the wire without displacing the LLM diagnosis the
// FOLLOW-1022 canary reads. See the field's docblock in `@estalara/shared`.
//
// The withhold WINS over the token signal, and not by preference: after the withhold no
// token-bearing directive survives to have dropped one — every shipped `{token}` is on a
// `headline` (RETRO-315) — so `unresolved_placeholder_tokens` is unreachable here. That is
// a real consequence of §E.7.0, recorded rather than discovered: FOLLOW-1140's server-side
// resolution keeps running and no longer has a SERVED consumer on this path.
```

#### route.ts:369 — `runDecisionTree`

Anchor (first code line after the comment): `const llmSource: 'llm_full' | 'llm_tweaked' =`

Kept in the code as: Branches 3 and 4: ONE gateway call, the band picks `source` only [FOLLOW-1287];
no route budget [FOLLOW-1040, MP-013, MP-014].

```text
// ── ROUTE-LEVEL WALL-CLOCK BUDGET: decided NOT NOW, and here is the reason [FOLLOW-1040] ──
//
// The `await callLlmGateway(...)` call below is bare (one call since FOLLOW-1287; there were two
// when this was written). That is now a DECISION rather than an omission, which is the whole
// point of writing it here.
//
// What was rejected, and why:
//   1. `export const maxDuration` — a platform kill switch, not a budget. It answers with a
//      504 and NO body: the SDK gets no directives AND no `source`, which is strictly worse
//      for the buyer than a slow-but-good answer, and it blinds the FOLLOW-1022 canary,
//      whose only assertion is on `source`.
//   2. A graceful `Promise.race` returning playbook copy — the right shape, but it must
//      report itself, i.e. a NEW `source` value (`playbook_fallback_llm_timeout`) read by
//      the SDK, the canary and ClickHouse `adaptation_decisions`. Rules H/AJ say a new
//      emitted value ships with its consumers; that is a contract change with three
//      consumers, and it belongs to Track LATENCY (FOLLOW-1037/1038/1039), not to a
//      deadline ticket.
//
// What made "not now" defensible rather than lazy: the term that was UNBOUNDED — the
// fact-check judge, up to one serial LLM round trip per directive — is bounded as of this
// ticket (`JUDGE_DEADLINE_MS` × `judgeCallBudget(model)` in `llm-gateway.ts`; FOLLOW-1178
// made that budget per-band — 4 s on Haiku, 6 s on Sonnet — and FOLLOW-1180 then re-derived
// the Haiku half across locales, so the bound is 6 s on BOTH bands. The two constants are
// still separate: they coincide by two independent derivations, not one premise). What
// remains is the generation call, whose latency band is measured, not open-ended, and the
// route's own tail, which [MP-013] shows is dominated by something OUTSIDE the LLM calls
// (an outlier route round trip an order of magnitude above the model call inside it). A budget
// set today would therefore fire mostly on that tail, and cutting a request without knowing
// what is slow buys a worse answer, not a faster one. Diagnose first, then budget.
//
// FOLLOW-1061 / FOLLOW-1290: the tail is spent BEFORE this function is ever reached, in the
// POST handler's pre-LLM dependencies ([MP-014]). The per-segment timer that reported it was
// removed by FOLLOW-1290; a stall is now read from p95 of the `POST /api/adapt` transaction in
// Sentry performance. The budget decision above is UNCHANGED — the remedy belongs on the
// dependency (FOLLOW-1063), not on a ceiling that would cut a request the moment its Postgres
// connection is slow to acquire.
//
// Branches 3 and 4: ONE gateway call [FOLLOW-1287]. The similarity band decides only the
// `source` label the response and the decision row carry, and what a null falls back to; the
// call itself, its input and its fallback-reason plumbing are the same on both bands. The model
// is NOT chosen here — `callLlmGateway` routes on the same `similarity` (Haiku for the tweak band,
// the global generation model below it), which is why one call with the same input reproduces
// both former calls exactly. `route.llm-call.test.ts` pins that byte for byte.
//
//   - `llm_full`    — similarity <= LOW_SIMILARITY_THRESHOLD (branch 4: full generation).
//   - `llm_tweaked` — LOW < similarity <= HIGH (branch 3: Haiku tweak of the playbook; the
//                     band the FOLLOW-1022 canary probes).
```

#### route.ts:419 — `runDecisionTree`

Anchor (first code line after the comment):
`const gatewayFallback: { reason: NonNullable<AdaptationDirectives['fallback_reason']> } = {`

Kept in the code as: An object, not a `let`: eslint over-narrows closure-reassigned lets
[FOLLOW-1056].

```text
// FOLLOW-1056: an object, not a bare `let`, for the reason recorded on `deadlineState` in
// llm-gateway.ts — eslint's flow analysis over-narrows a `let` reassigned only inside a
// closure to its initial literal, which would make the read below look like a constant.
```

#### route.ts:445 — `runDecisionTree`

Anchor (first code line after the comment): `if (llmSource === 'llm_full') {`

Kept in the code as: `fallback_reason` names the null; `source` stays (SDK strict enum); branch 4
serves nothing [FOLLOW-1056].

```text
// Gateway returned null. `fallback_reason` says WHICH null this was — an unavailable LLM or
// a generation the fact check correctly refused. The `source` stays as it was: it is a
// strict `z.enum` in the SDK's response schema, so a new value there would fail validation
// in every deployed bundle and drop the whole response (FOLLOW-1056; see the field's
// docblock in `@estalara/shared`).
//
// Branch 4 serves nothing on a null: its emptiness is about archetype FIT (the buyer is far
// from every playbook), not about grounding, so there is no template worth falling back to.
```

#### route.ts:460 — `runDecisionTree`

Anchor (first code line after the comment):
`const { served, withheldSlots } = withholdUngroundedDirectives(await resolvePlaybook());`

Kept in the code as: Branch 3 null → playbook with branch 2's token fill and §E.7.0 withhold
[FOLLOW-1056, FOLLOW-1163].

```text
// Branch 3 (`llm_tweaked`), gateway returned null — fall back to playbook directives. This is
// the branch the FOLLOW-1022 canary probes, and `fallback_reason` is what lets it stay red for an
// unavailable LLM without going red for a correct fail-closed refusal [FOLLOW-1056].
//
// FOLLOW-1140: the fallback copy is the same template as branch 2's, so it gets the same
// placeholder resolution. `fallback_reason` is NOT overwritten with the token signal here —
// the LLM diagnosis is why this response is on the playbook path at all, and the canary reads
// it. The drop is still reported through `reportDroppedPlaceholderDirectives`.
// FOLLOW-1163 / §E.7.0: a model outage is not a licence to assert. This copy is the same
// template branch 2 serves and no model read the listing on this path either, so the same
// withhold applies. `fallback_reason` is NOT overwritten — it carries the LLM diagnosis the
// FOLLOW-1022 canary reads, and the withhold is reported through Sentry and the log instead,
// exactly as FOLLOW-1140's token drop is on this branch.
```

#### route.ts:495 — `runDecisionTree`

Anchor (first code line after the comment): `function logDecisionAsync(`

Kept in the code as: Log a decision to `adaptation_decisions` (fire-and-forget); never on
opt-out/consent-skip [FOLLOW-358].

```text
/**
 * Log an adaptation decision to ClickHouse adaptation_decisions table (fire-and-forget).
 *
 * CALLERS AND page_context_source VALUES (FOLLOW-358 / Rule K.1):
 *   POST /api/adapt is the only caller since FOLLOW-1287 retired GET:
 *      pageContext   = pageContextFromPageType(body.page_type) → 1 or 2 (internal derivation).
 *      pageContextSource = 'page_type_derived' — server derived from the page_type field.
 *      This is the canonical page-context signal per MASTER_DESIGN §E.7 / FOLLOW-357.
 *   Historical rows also carry 'caller_supplied' — written by the retired GET handler from its
 *   caller-supplied `tier` URL param — and nothing writes that value any more.
 *
 * The page_context_source column (migration 0019) makes the provenance of each
 * page_context value observable to analysts, closing the Rule K.1 divergence.
 * Rows written before migration 0019 carry the DEFAULT value 'legacy'.
 *
 * NOTE: logDecisionAsync is NOT called on profiling_opt_out or consent-skip paths —
 * those early-return gates suppress ClickHouse logging entirely (FOLLOW-372/369).
 */
```

#### route.ts:522 — `logDecisionAsync`

Anchor (first code line after the comment): `holdoutGroup = false,`

Kept in the code as: A/B holdout assignment; false when the caller sent none [TICKET-AB-001].

```text
/**
 * A/B holdout assignment result.
 * Populated from assignHoldout() — see TICKET-AB-001 (PR #80).
 * Defaults to false when the caller did not include a holdout assignment
 * (e.g. opted-out sessions, or routes not yet wired to assignHoldout).
 */
```

#### route.ts:529 — `logDecisionAsync`

Anchor (first code line after the comment): `variant = 'control',`

Kept in the code as: Bandit variant; 'control' when the bandit was not consulted [FOLLOW-007].

```text
/**
 * Thompson sampling bandit variant selected for this request.
 * Defaults to 'control' when bandit was not consulted (e.g. confidence below
 * threshold, holdout/consent skip path). See FOLLOW-007.
 */
```

#### route.ts:535 — `logDecisionAsync`

Anchor (first code line after the comment): `adaptDecisionId = '',`

Kept in the code as: Per-decision UUID = the response's `adapt_decision_id` [FOLLOW-105, ADR-0006].

```text
/**
 * Stable per-decision UUID (FOLLOW-105 / ADR-0006 §Decision 4C). Logged so a
 * response body's `adapt_decision_id` can be cross-correlated with this row.
 * Defaults to '' for legacy callers (matches the migration 0012 column default).
 */
```

#### route.ts:541 — `logDecisionAsync`

Anchor (first code line after the comment): `demoOverride = false,`

Kept in the code as: DEMO MODE override, so analytics can exclude demo decisions [DEMO-001].

```text
/**
 * Whether this decision was driven by DEMO MODE operator override (DEMO-001).
 * Logged so pilot analytics can exclude demo-driven decisions from measurements.
 * Defaults to false (normal path).
 */
```

#### route.ts:547 — `logDecisionAsync`

Anchor (first code line after the comment): `modelVersion = 'rulebased-bandit-v1',`

Kept in the code as: Scorer that made this decision, so labels stay calibratable [FOLLOW-170].

```text
/**
 * Conversion Label Loop (FOLLOW-170, §T): the scorer that produced this decision.
 * `rulebased-bandit-v1` today; later `lora-tenant-{id}-v*`. Stamped on every row so
 * labels from different scorers stay distinguishable and calibratable.
 */
```

#### route.ts:553 — `logDecisionAsync`

Anchor (first code line after the comment): `leadId = '',`

Kept in the code as: Durable pseudonymous lead key; empty until wired through [FOLLOW-170].

```text
/**
 * Conversion Label Loop (FOLLOW-170, §T): durable pseudonymous lead key, distinct from
 * the anonymous `session_id`. Empty until a durable id is wired through the adapt request
 * (follow-up); the column exists from day one so the field is never lost.
 */
```

#### route.ts:559 — `logDecisionAsync`

Anchor (first code line after the comment):
`pageContextSource: 'page_type_derived' | 'legacy' = 'legacy',`

Kept in the code as: `page_context` provenance; 'caller_supplied' is pre-FOLLOW-1287 only
[FOLLOW-358].

```text
/**
 * FOLLOW-358 / Rule K.1 — provenance discriminator for the page_context column.
 *
 * Makes the origin of each row's page_context value observable to analysts:
 *
 *   'page_type_derived' — POST /api/adapt: derived from page_type via pageContextFromPageType().
 *   'legacy'            — rows written before migration 0019 (source indeterminate).
 *
 * Rows from before FOLLOW-1287 may also read 'caller_supplied' (the retired GET handler's
 * caller-supplied `tier` URL param). No caller can write it any more, so the parameter no
 * longer accepts it.
 *
 * See migration 0019_adaptation_decisions_page_context_source.sql.
 */
```

#### route.ts:574 — `logDecisionAsync`

Anchor (first code line after the comment): `holdoutPct = 0,`

Kept in the code as: Holdout rate at assignment; 0 = migration 0021's default [FOLLOW-988,
ADR-0022].

```text
/**
 * Holdout percentage in force when this session was assigned. [FOLLOW-988 / ADR-0022]
 *
 * The retired A/B publisher carried this and `adaptation_decisions` did not, so it was the ONE
 * field a field-by-field comparison found missing — every other field of that event was already
 * a column here. Note it was captured NOWHERE before this: the publisher returned early on the
 * empty event-bus URL, so this is a net-new capability rather than a restoration.
 *
 * Defaults to 0 to match migration 0021's column default, so a caller that does not pass it
 * writes the same value a pre-migration row reads as.
 */
```

#### route.ts:586 — `logDecisionAsync`

Anchor (first code line after the comment): `scoringPath: ScoringPath = 'not_applicable',`

Kept in the code as: Reorder scoring path; only 'cosine' means a reorder was served [FOLLOW-560,
FOLLOW-1202].

```text
/**
 * FOLLOW-560 (audit A3-F-09/F-10): which scoring path this decision's reorder took — see the
 * `ScoringPath` type below and migration 0022's header comment for the full value semantics.
 * Since FOLLOW-1202 only 'cosine' means a reorder was served. Defaults to 'not_applicable',
 * matching the column's DEFAULT and every call site that never attempts a reorder (the
 * A/B-holdout branch).
 */
```

#### route.ts:594 — `logDecisionAsync`

Anchor (first code line after the comment): `reorderWithheld: ReorderWithheldReason | null = null,`

Kept in the code as: Why a reorder-capable request got no `reorder`, or null [FOLLOW-1202].

```text
/**
 * FOLLOW-1202 (CEO decision #3): why a reorder-capable request got no `reorder`, or null. Goes
 * into `features_snapshot` as `reorder_withheld` (absent when null), so the withholding is
 * countable on every deployment without the flag-gated `scoring_path` column, e.g.
 * `countIf(JSONExtractString(features_snapshot, 'reorder_withheld') != '')`.
 */
```

#### route.ts:602 — `logDecisionAsync`

Anchor (first code line after the comment): `const clickhouseUrl = process.env.CLICKHOUSE_URL;`

Kept in the code as: Returns a promise for `after()`; no-op without CLICKHOUSE_URL [FOLLOW-431].

```text
// Returns a promise so callers can register it via after() and guarantee
// completion after the response is sent (FOLLOW-431 / ESC-033).
// No-op when CLICKHOUSE_URL is not configured.
```

#### route.ts:608 — `logDecisionAsync`

Anchor (first code line after the comment):
`const scoringPathColumnEnabled = process.env.SCORING_PATH_COLUMN_ENABLED === 'true';`

Kept in the code as: Column written only once migration 0022 is live (flag), or every INSERT fails
silently [ESC-031].

```text
// FOLLOW-560: `scoring_path` is gated behind SCORING_PATH_COLUMN_ENABLED (default unset/false
// everywhere, including prod Doppler) rather than always appearing in the column list.
//
// ESC-031 is the reason: migration 0019 (page_context_source) shipped in the SAME PR as its
// unconditional column reference, landed unapplied in prod, and every adaptation_decisions
// write failed SILENTLY for 80 minutes (this INSERT's .catch() below only console.error's a
// rejected 4xx — NO_SUCH_COLUMN_IN_BLOCK never surfaces to a caller or an alert). Migration
// 0021 avoided a repeat only by shipping its writer in a SEPARATE PR, ~8.5h after an operator
// confirmed the DDL was live in prod (RETRO-275).
//
// FOLLOW-560's prod apply is explicitly DEFERRED to FOLLOW-820 (the CEO go/no-go gate), whose
// own dependency chain (FOLLOW-819, FOLLOW-815) will not close same-day — so the 0021
// same-day choreography isn't available here. With the flag off, this INSERT is byte-identical
// to the pre-FOLLOW-560 statement and cannot hit NO_SUCH_COLUMN_IN_BLOCK no matter when this
// deploys relative to the migration. An operator flips the flag in Doppler `prd` only after
// confirming migration 0022 is live there (see that migration's header for the full note).
```

#### route.ts:630 — `logDecisionAsync`

Anchor (first code line after the comment): `const featuresSnapshot = JSON.stringify({`

Kept in the code as: PII-free scorer snapshot for later label replay [FOLLOW-170, FOLLOW-358].

```text
// Conversion Label Loop (FOLLOW-170, §T): PII-free snapshot of the scorer inputs/outputs
// the server saw at decision time, so a stored label can later be replayed against a future
// model. Only non-PII signals — no session/lead identifiers go in the snapshot.
// FOLLOW-358: include page_context_source so replayed labels know which derivation was used.
```

#### route.ts:646 — `logDecisionAsync`

Anchor (first code line after the comment): `const baseQuery =`

Kept in the code as: Invariant: the column list stays one literal line and is never quoted in a
comment here — migration-contract-test.sh greps it [FOLLOW-560, FOLLOW-261].

```text
// FOLLOW-261 (F-30): parameterized INSERT — {name:Type} placeholders eliminate string
// interpolation; values passed as ?param_name= URL query params (ClickHouse HTTP interface).
// FOLLOW-358: page_context_source column added (migration 0019).
//
// FOLLOW-560: `baseQuery` below is the statement as it stood before this ticket, and its column
// list MUST stay a single parenthesised literal line directly under the INSERT-INTO line.
// infra/clickhouse/scripts/migration-contract-test.sh greps that pair of lines and runs a sed
// that requires a closing `)` on the second one; interpolating the flag-gated column into that
// line makes the extraction silently unparseable and disarms the ESC-031 ordering guard. (The
// grep is a plain substring match, which is also why no comment in this file may quote the
// INSERT statement's first line verbatim.) So scoring_path is appended by two exact string
// replacements instead — see the OPTIONAL_COLUMN marker below.
```

#### route.ts:666 — `logDecisionAsync`

Anchor (first code line after the comment): `const query = scoringPathColumnEnabled`

Kept in the code as: migration-contract-test:OPTIONAL_COLUMN scoring_path ^ machine-readable marker
read by migration-contract-test.sh; both targets are unique.

```text
// migration-contract-test:OPTIONAL_COLUMN scoring_path
// ^ machine-readable marker: migration-contract-test.sh appends every column named this way to
// the column list it exercises, so a flag-gated column is still covered by the ordering
// contract (its migration must exist and must be the boundary) even though it is absent from
// the default INSERT. Both replacement targets are unique in `baseQuery`.
```

#### route.ts:730 — `logDecisionAsync`

Anchor (first code line after the comment): `/**`

Kept in the code as: ── ReorderDirective helpers (this route is the only copy, FOLLOW-1262) ──

```text
// ─── ReorderDirective helpers ─────────────────────────────────────────────────
//
// This route IS the canonical implementation (ADR-0004 §1 / ADR-0006 —
// CEO-ratified 2026-05-25, the only production adapt path). It historically
// had a sibling copy in the Decision API Cloudflare Worker's `lib/reorder.ts`,
// duplicated because cross-app TypeScript imports are not supported. That
// Worker's POST /api/adapt returned 410 Gone from ADR-0006 on, the pair was
// de-registered from scripts/mirror-files.json (FOLLOW-1073), and the whole
// Worker was removed 2026-09-24 (FOLLOW-1262, discharging FOLLOW-107). This
// file is the only copy.
//
// getTenantSchema() is now provided by @/lib/tenant-schema (TICKET-AB-011):
//   - Redis cache at `schema:{tenantId}` (5-min TTL)
//   - Falls back to tenant_site_schemas DB table
//   - Demo tenant still returns hard-coded DEMO_SCHEMA for backward compat
```

#### route.ts:746 — `logDecisionAsync`

Anchor (first code line after the comment): `interface TenantSchema {`

Kept in the code as: Minimal per-tenant reorder schema; mirrors TenantSiteSchemaMin.

```text
/**
 * Minimal per-tenant schema for reorder capability.
 * Mirrors TenantSiteSchemaMin from @/lib/tenant-schema.
 */
```

#### route.ts:756 — `TenantSchema`

Anchor (first code line after the comment): `type UnscorableReason =`

Kept in the code as: Why one listing has no cosine score [FOLLOW-1202].

```text
/**
 * Why one listing in a batch could not be scored by cosine [FOLLOW-1202]. Log-only detail behind
 * the batch-level {@link ReorderWithheldReason}.
 */
```

#### route.ts:766 — `UnscorableReason`

Anchor (first code line after the comment): `function affinityScore(`

Kept in the code as: Raw cosine in [-1, 1] for (archetype, listing), or why there is none
[FOLLOW-1202].

```text
/**
 * Cosine affinity for a single (archetype, listing) pair, or the reason there is none.
 *
 * The score is `computeCosineSimilarity()` as computed: a value in `[-1, 1]`, NOT clamped or
 * rescaled to `[0, 1]`. Ranking only needs the order, and every score in a served batch comes from
 * this one function, so the scale is shared by construction.
 *
 * FOLLOW-1202 (CEO decision #3): there is no hash fallback any more. Before this ticket a listing
 * without an embedding was scored with a djb2 hash (`deterministicScore()`, uniform on `[0, 1)`)
 * and sorted in the same array as cosine values, so un-embedded listings outranked embedded ones
 * more often than not (audit 2026-09-13 E-3). An un-scorable listing now makes the whole batch
 * un-rankable — see `buildReorderDirective()`.
 *
 * Historical origin: the retired Decision API Worker's `reorder.ts` affinityScore() (FOLLOW-019)
 * — that Worker was removed by FOLLOW-1262.
 */
```

#### route.ts:801 — `affinityScore`

Anchor (first code line after the comment):
`export type ScoringPath = 'cosine' | 'djb2_fallback' | 'djb2_guard' | 'not_applicable';`

Kept in the code as: `adaptation_decisions.scoring_path`; djb2 names are historical, both mean
withheld [FOLLOW-1202].

```text
/**
 * FOLLOW-560 (audit A3-F-09/F-10): decision-level discriminator between a real cosine/embedding
 * ranking and a batch that could not be ranked by cosine, logged to
 * `adaptation_decisions.scoring_path` (migration 0022). This is the field FOLLOW-819's
 * differentiator E2E reads to tell the two apart — see that migration's header comment.
 *
 * THE djb2 NAMES ARE HISTORICAL (FOLLOW-1202). `djb2_fallback` and `djb2_guard` were named when
 * those batches were ranked by a djb2 hash and served. Since FOLLOW-1202 no hash is computed and
 * no `reorder` is served for either: `djb2_fallback` = embeddings fetched, but at least one listing
 * (or the archetype) had no usable cosine score; `djb2_guard` = embeddings never fetched (batch
 * size guard, or the lookup threw). Both now mean "reorder withheld" (see
 * {@link ReorderWithheldReason}). The values are kept because they are persisted in ClickHouse and
 * read by the staff rollup and the FOLLOW-819 harness.
 *
 * Exported for the staff analytics rollup (`api/admin/analytics/rollup/data.ts`), which renders
 * the split as a panel on `/admin/analytics`. Type-only export; the route's runtime shape is
 * unchanged.
 */
```

#### route.ts:821 — `ScoringPath`

Anchor (first code line after the comment):
`type ReorderWithheldReason = 'embeddings_missing' | 'embeddings_not_attempted';`

Kept in the code as: Countable reason a reorder-capable request got no `reorder` [FOLLOW-1202].

```text
/**
 * Countable reason a reorder-capable request got NO `reorder` directive [FOLLOW-1202; CEO decision
 * #3, 2026-09-13: `reorder` fails closed, text directives stay fail-open]. Written to the decision
 * row's `features_snapshot` as `reorder_withheld`, which every deployment writes (unlike the
 * flag-gated `scoring_path` column).
 *
 *   - `embeddings_missing`       — the lookup ran, but at least one listing (or the archetype) had
 *                                  no usable embedding. Pairs with `scoring_path = djb2_fallback`.
 *   - `embeddings_not_attempted` — the lookup never ran: `listing_ids` over
 *                                  `LISTING_EMBEDDING_BATCH_LIMIT`, or the lookup threw. Pairs
 *                                  with `scoring_path = djb2_guard`.
 */
```

#### route.ts:835 — `ReorderWithheldReason`

Anchor (first code line after the comment): `function buildReorderDirective(`

Kept in the code as: Cosine-sorted reorder, or none: a partial ranking still moves cards
[FOLLOW-1202].

```text
/**
 * Build a ReorderDirective from a tenant schema + listing IDs, or withhold it.
 *
 * FOLLOW-1202 (CEO decision #3, 2026-09-13): a batch is ALL-COSINE or it gets no reorder. When the
 * embeddings were never fetched, or any listing in the batch has no usable cosine score, the
 * directive is `null`, `withheldReason` says why, and one `console.warn` names the reason code and
 * the per-listing causes. A partial ranking is not served either: ranking only the scorable
 * listings would still move the page's cards around the ones we could not place.
 *
 * Sorted descending by cosine (highest first). `directive` is also null, with no withheld reason,
 * when the schema is not reorder-capable or has no container_selector.
 *
 * Also returns the aggregated `scoringPath` for the batch (see {@link ScoringPath}).
 *
 * Historical origin: the retired Decision API Worker's `reorder.ts` buildReorderDirective() —
 * that Worker was removed by FOLLOW-1262.
 */
```

#### route.ts:915 — `buildReorderDirective`

Anchor (first code line after the comment): `function pageContextFromPageType(`

Kept in the code as: Page context from page type (not a Tier, §E.7): detail → 2, else 1
[FOLLOW-357].

```text
/**
 * Derive the page context value from the page type reported by the SDK (FOLLOW-357).
 *
 * This is a page-context axis — NOT an integration Tier. The product has no Tiers
 * (CEO ruling 2026-06-05, MASTER_DESIGN §E.7). The returned value signals which page
 * type this request originates from and controls how many directive slots are sent:
 *
 * - `listing_detail` → 2: full per-listing directives (headline, cta, feature)
 * - `listing_list` / `search` / `home` → 1: lighter directives (cta, feature, reorder)
 *
 * Context 2 applies on the detail page where a single listing is in focus — per-listing
 * headline rewrites are appropriate there. On list/search/home pages many listings appear
 * simultaneously, so only higher-level slots (cta, feature badge, reorder) are sent.
 *
 * The value is stored in the `adaptation_decisions.page_context` ClickHouse column
 * (renamed from `tier` in migration 0018, FOLLOW-357).
 */
```

#### route.ts:938 — `pageContextFromPageType`

Anchor (first code line after the comment): `function filterDirectivesByPageType(`

Kept in the code as: Drop `headline` directives off detail pages [FOLLOW-345].

```text
/**
 * Filter text directives by page type.
 *
 * On detail pages: all slots are returned (headline + cta + feature).
 * On list/search/home pages: `headline` slots are suppressed — a headline rewrite
 * targeting a single listing card is not meaningful across a multi-listing grid.
 * The reorder directive (type !== 'text') is always passed through unchanged by
 * the caller, so this function only needs to gate `TextDirective` slots.
 */
```

#### route.ts:957 — `filterDirectivesByPageType`

Anchor (first code line after the comment):
`export async function POST(req: NextRequest): Promise<NextResponse> {`

Kept in the code as: POST /api/adapt: tenant API key via `resolveApiKey()` (ADR-0015); demo
credentials only under DEMO_MODE=1 [FOLLOW-451, FOLLOW-1288]. @returns 200 AdaptationDirectives
JSON. @returns 400 on Zod validation failure. @returns 401 on a missing or unknown credential.
@returns 403 when `body.tenant_id` names a different tenant than the resolved key. @returns 500
under DEMO_MODE=1 when the demo secrets are not configured.

```text
/**
 * POST /api/adapt
 *
 * Adaptation endpoint. Accepts a JSON body and returns AdaptationDirectives.
 * Credential in the `Authorization: Bearer <token>` header:
 *
 *   - A real tenant API key resolved via the shared `resolveApiKey()`
 *     (ADR-0015, SHA-256(bearer) → `api_keys` lookup, constant-time
 *     compare). `tenant_id` is the resolved row's tenant — never taken from
 *     the body. If `body.tenant_id` is present and does not match, the
 *     request is rejected 403 (parity with `POST /api/adapt/feedback`).
 *   - Under `DEMO_MODE=1` only (FOLLOW-1288), tried first: the ops caller
 *     (`ADAPT_API_KEY`, pinned to `OPS_TENANT_ID`) and a valid HS256 demo
 *     JWT (FOLLOW-205; its `tenant_id` claim supersedes `body.tenant_id`,
 *     FOLLOW-260). See `lib/demo/adapt-demo-context.ts`. With the flag unset
 *     those bearers are ordinary unknown keys.
 *
 * The SDK always sends `Authorization: Bearer ${config.apiKey}`
 * (`packages/sdk/src/core/adapt.ts`), whichever kind of credential it holds.
 *
 * Body:
 *   tenant_id      — required, string
 *   session_id     — required, string
 *   page_type      — required, 'listing_list'|'listing_detail'|'home'|'search'
 *   archetype_hint — optional, ArchetypeId (defaults to 'neutral')
 *   confidence     — optional, float 0–1 (defaults to 0.5)
 *   similarity     — optional, float 0–1 (defaults to 0.5)
 *
 * @returns 200 AdaptationDirectives JSON.
 * @returns 400 on Zod validation failure.
 * @returns 401 if Authorization header is missing, or the token is not a
 *   valid/registered tenant API key (nor, under DEMO_MODE=1, a demo credential).
 * @returns 403 if the API-key path authenticated the request AND
 *   `body.tenant_id` names a different tenant than the resolved key.
 * @returns 500 under DEMO_MODE=1 if DEMO_MODE_JWT_SECRET (or, for the ops key,
 *   OPS_TENANT_ID) is not configured (deployment misconfiguration).
 */
```

#### route.ts:995 — `POST`

Anchor (first code line after the comment):
`const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');`

Kept in the code as: Auth: API key always, demo variants only under DEMO_MODE=1 [FOLLOW-1288,
ADR-0015].

```text
// ── Auth — tenant API key; plus, under DEMO_MODE=1 only, the ops caller and the demo JWT ──
//
// FOLLOW-1288 (WP-2.3): the demo-mode variants (ops caller `ADAPT_API_KEY`, demo-session HS256
// JWT, its runtime revocation) live in `lib/demo/adapt-demo-context.ts` and run only when
// `isDemoModeEnabled()`. With the flag unset every bearer goes straight to `resolveApiKey()`
// (ADR-0015, SHA-256(bearer) → api_keys lookup, constant-time compare — the SAME helper
// adapt/feedback uses; audit F-05 / FOLLOW-451), and `DEMO_MODE_JWT_SECRET` is not read.
//
// Replay/crypto posture: API-key path — bearer confidentiality carried by TLS, revocation via
// `api_keys.revoked_at` (ADR-0015 §Replay protection defers per-request nonces). Demo variants —
// see the module docblock of `adapt-demo-context.ts`.
```

#### route.ts:1038 — `POST`

Anchor (first code line after the comment): `if (keyAuth.status === 403) {`

Kept in the code as: Origin refusal keeps its 403; runs only after the key is valid [FOLLOW-943].

```text
// An ORIGIN refusal keeps its 403 and its reason. [FOLLOW-943 AC(1)]
//
// `invalid_demo_token` on an origin verdict is the most misleading of the four collapses:
// the caller may hold a perfectly valid API key and be refused for its DOMAIN, and the
// answer names a JWT it never presented. The origin check inside `resolveApiKey` runs only
// AFTER the key is found and valid, so this branch cannot leak key existence.
```

#### route.ts:1075 — `POST`

Anchor (first code line after the comment):
`const postProfilingOptOut = req.nextUrl.searchParams.get('profiling_opt_out') === '1';`

Kept in the code as: Profiling opt-out: neutral directives, no decision log [FOLLOW-383, §H.9].

```text
// FOLLOW-383 / §H.9: per-user profiling opt-out gate for POST path.
// The SDK appends ?profiling_opt_out=1 to the URL when the user has opted out.
// Next.js exposes this via req.nextUrl.searchParams regardless of HTTP method.
// Return neutral directives and SUPPRESS variant logging (logDecisionAsync is NOT called on
// this path).
```

#### route.ts:1099 — `POST`

Anchor (first code line after the comment):
`const pageCtx = pageContextFromPageType(body.page_type);`

Kept in the code as: page_context from page_type, not a Tier [FOLLOW-357].

```text
// FOLLOW-345/357: derive page_context from page_type — listing_detail gets context 2
// (full directives); all other page types get context 1 (lighter directive set, no
// per-listing headline). This is a page-type signal, NOT an integration Tier (§E.7).
```

#### route.ts:1104 — `POST`

Anchor (first code line after the comment):
`const jwtTenantId = demoAuth?.kind === 'demo_jwt' ? demoAuth.claims.tenant_id : undefined;`

Kept in the code as: Demo JWT tenant supersedes the body; API-key tenant is authoritative
[FOLLOW-260, FOLLOW-451].

```text
// FOLLOW-260 (F-26): JWT tenant_id is authoritative — supersedes body.tenant_id.
// Prevents cross-tenant escalation: a caller with a valid demo JWT for tenant A
// cannot access tenant B's data by sending tenant_id: B in the body.
// FOLLOW-451: when the API-key path authenticated the request, the resolved
// tenant (from api_keys, never from the body) is authoritative instead.
```

#### route.ts:1112 — `POST`

Anchor (first code line after the comment):
`if (apiKeyTenantId && body.tenant_id !== apiKeyTenantId) {`

Kept in the code as: API key path: a mismatching body.tenant_id → 403, parity with feedback
[FOLLOW-451].

```text
// FOLLOW-451 / ADR-0015 parity: on the API-key path, a caller-supplied
// body.tenant_id that does not match the resolved tenant is rejected — the
// same cross-tenant enforcement adapt/feedback/route.ts applies (Step 7).
// The demo-JWT path keeps its existing supersede-only behavior (FOLLOW-260,
// route.demo-auth.test.ts) — it already ignores body.tenant_id entirely
// when the JWT carries a tenant_id claim, so no additional check is added
// there to avoid regressing that locked-in behavior.
```

#### route.ts:1129 — `POST`

Anchor (first code line after the comment): `const alState = await resolveAlEnablement(tenantId);`

Kept in the code as: Tenant AL OFF: neutral 200 with provenance, no decision row [FOLLOW-633].

```text
// ── FOLLOW-633: per-tenant Adaptive Listings ON/OFF enforcement ──────────
// Single shared point (resolveAlEnablement). When al_enabled=false OR status IN ('suspended','canceled'), serve a
// valid neutral / pass-through 200 (no adaptation — the tenant's page still
// works), NEVER an error. No ClickHouse row is written (no decision made). The
// response carries `adaptive_listings_off`/`al_off_reason` provenance. Checked
// BEFORE the demo-override read and A/B holdout gate so an OFF tenant does no
// further work. `pending`/`active` stay ON.
```

#### route.ts:1154 — `POST`

Anchor (first code line after the comment): `const adaptDecisionId = crypto.randomUUID();`

Kept in the code as: One UUID per decision, in every response arm and the log [FOLLOW-105].

```text
// FOLLOW-105 / ADR-0006 §Decision 4C: stable per-decision UUID. Generated once
// per request and returned in EVERY response arm (skip, holdout, treatment) and
// logged to ClickHouse so a response body can be cross-correlated with its row.
```

#### route.ts:1159 — `POST`

Anchor (first code line after the comment):
`const demoOverride = demoMode ? await resolveDemoArchetypeOverride(tenantId) : null;`

Kept in the code as: Demo override (DEMO_MODE=1) before the holdout gate, to log would-be values
[FOLLOW-452].

```text
// ── DEMO MODE archetype override (DEMO-001 / AC4; DEMO_MODE=1 only, FOLLOW-1288) ──────────
// When enabled for the tenant, the operator's archetype replaces the SDK's hint at high
// confidence / medium similarity, and the LLM call is forced to the operator's model
// (`resolveDemoArchetypeOverride`, which also degrades to the hint when the store throws).
//
// FOLLOW-452 (audit F-08): this resolution MUST happen BEFORE the A/B holdout
// gate below — not after, as it previously did — so that a held-out session's
// WOULD-BE archetype/confidence (what it would have received had it not been
// held out) is available to log on the holdout adaptation_decisions row.
// Without this, every holdout row was logged with a hardcoded 'neutral'/0.5,
// starving the per-archetype lift query's holdout arm for every real archetype.
// The RESPONSE BODY returned to a held-out caller is unaffected — it stays
// hardcoded 'neutral'/empty directives (locked-in product behavior); only the
// ClickHouse-logged row uses the resolved values below.
```

#### route.ts:1181 — `POST`

Anchor (first code line after the comment): `let effectiveHoldoutPct: number;`

Kept in the code as: Holdout gate: rate and arm key are configuration, fail loud when unset
[FOLLOW-1201].

```text
// ── A/B holdout gate (TICKET-AB-010) ─────────────────────────────────────
// Run before any directive building. Returns early with empty directives
// when the session is held-out or consent-skipped.
//
// FOLLOW-1201 / FOLLOW-1102 (audit SEC-4): the rate is CONFIGURATION, not a body field. A
// caller-supplied `holdout_pct` was persisted as if configured, so anyone with the public key
// could set the assignment rate to 0 or 1; it is now honoured only for the ops caller above.
// The arm is keyed on `HOLDOUT_ASSIGNMENT_SECRET` (never on the page-visible tenant_id). Both
// fail LOUD when unset/invalid — there is no safe default for a key (Rule K.2).
```

#### route.ts:1233 — `POST`

Anchor (first code line after the comment):
`// FOLLOW-442 (AUD-04 / F-05): holdout decisions were never written to`

Kept in the code as: Holdout → no adaptation; the old ab.assignment fields live in the decision row
[ADR-0022].

```text
// AC-2: holdout → no adaptation.
//
// The ab.assignment publish that used to sit here is GONE — ADR-0022 (Accepted 2026-08-15),
// FOLLOW-988 stage B. It had emitted nothing since ADR-0016: the event-bus URL was `""` in
// every env block, so the publisher returned on its first line. Every field it carried is now
// written directly to `adaptation_decisions` by the `logDecisionAsync` call below —
// `holdout_pct` included, since FOLLOW-988 step 5.
```

#### route.ts:1241 — `POST`

Anchor (first code line after the comment): `afterResponse(() =>`

Kept in the code as: Holdout rows log the would-be archetype, or the lift holdout arm starves
[FOLLOW-452].

```text
// FOLLOW-442 (AUD-04 / F-05): holdout decisions were never written to
// adaptation_decisions, so the lift query's holdout denominator counted zero
// sessions. Mirrors the treatment-arm call below (line ~1417) with
// holdoutGroup=true, variant='control' (no bandit consulted on the holdout
// path), and directiveCount=0
// (no directives are built on this branch).
//
// FOLLOW-452 (audit F-08): log the WOULD-BE archetype/confidence/similarity
// (archetypeId/confidence/similarity, resolved above BEFORE the holdout gate
// from body.archetype_hint/body.confidence/the demo-override) instead of a
// hardcoded 'neutral'/0.5 — otherwise the per-archetype lift query's holdout
// arm is starved for every real archetype and lift is unmeasurable. The
// RESPONSE returned to the caller below is unaffected — still 'neutral'.
// FOLLOW-431 / ESC-033: registered via after() so the async write (and its
// fail-loud .then/.catch → Sentry) completes after the response is sent
// before instance suspension.
```

#### route.ts:1293 — `POST`

Anchor (first code line after the comment):
`// NOTE (FOLLOW-452): demoOverride/archetypeId/confidence/similarity`

Kept in the code as: Treatment arm: continue building directives [ADR-0022].

```text
// Treatment arm: continue building directives.
//
// The ab.assignment publish that used to sit here is GONE — ADR-0022 / FOLLOW-988 stage B. See
// the holdout arm above for why: the publisher had been a no-op since ADR-0016, and
// `logDecisionAsync` already writes every field it carried.
```

#### route.ts:1299 — `POST`

Anchor (first code line after the comment):
`// TICKET-AGENCY-001: RAG retrieval — fetch top-3 FAQ answers for this listing.`

Kept in the code as: RAG: top-3 FAQ answers for this listing [TICKET-AGENCY-001].

```text
// NOTE (FOLLOW-452): demoOverride/archetypeId/confidence/similarity
// are resolved earlier, BEFORE the A/B holdout gate above — see the "DEMO MODE
// override" block preceding `assignHoldout()` — so the holdout branch can log
// the would-be values. Nothing to resolve here for the treatment arm.
```

#### route.ts:1312 — `POST`

Anchor (first code line after the comment): `const listingContext = await withListingFacts(`

Kept in the code as: The listing's facts join the context: prompt and fact check share one source
[FOLLOW-1022, MP-010].

```text
// FOLLOW-1022: add the listing's OWN facts to the same context object.
//
// Until now the only thing that ever reached `listingContext` was the agency FAQ table, and
// only for a caller that sent BOTH `listing_id` and a 1536-dim `intent_vector` — which the
// SDK does not. So in production the LLM was asked to rewrite copy for a listing it had never
// been shown, while the base directives it must "improve upon" are playbook templates that
// demand figures. Every number it produced was therefore ungrounded, and FOLLOW-457's
// post-generation check discarded the whole batch — see [MP-010] for the production
// measurement that establishes the scale of that fallback.
//
// The facts flow into BOTH halves of the loop by construction, because `listingContext` is
// already read by the prompt builders AND by `buildDirectiveGroundingText` — so what the
// model is allowed to say and what it is checked against can no longer drift apart.
```

#### route.ts:1332 — `POST`

Anchor (first code line after the comment):
`const groundingMissing = Boolean(body.listing_id) && !hasListingFacts(listingContext);`

Kept in the code as: Facts requested but missing: say so, don't read as "LLM down" [FOLLOW-1120].

```text
// FOLLOW-1120: the caller asked to ground this generation in a specific listing and the facts
// did not arrive. `withListingFacts` fails open on purpose, so without this flag the prompt goes
// out carrying the grounding RULE and no grounding BLOCK, the model answers with prose instead
// of a JSON array, and the parse failure surfaces as an undifferentiated `llm_unavailable` —
// which reads as "the LLM is down" when the fault is an HTTP status in a different service.
// Computed here because this is the only layer that sees both the requested id and the resolved
// context.
```

#### route.ts:1341 — `POST`

Anchor (first code line after the comment):
`const postLocale: 'en' | 'pl' | 'es' = body.locale ?? 'en';`

Kept in the code as: Bandit variant: `en` only, frozen unless BANDIT_ENABLED=true [FOLLOW-362,
FOLLOW-1286].

```text
// ── FOLLOW-007 / FOLLOW-342: Thompson sampling variant selection ─────────
// Query bandit arms for (tenant_id, archetype) and sample a variant BEFORE
// running the decision tree so the selected variant can reach copy selection.
// Auto-seeds 3 arms (control, v1, v2) with Beta(1, 1) on first request.
// When all arms are paused (or DB unavailable), defaults to 'control'.
//
// FOLLOW-362: suppress bandit sampling for non-`en` locales.
// No playbook populates `variants.pl` or `variants.es` arrays — every non-`en`
// slot carries a single locale string (identical for all bandit arms, equivalent
// to control). If thompsonSample returns v1/v2 for a `pl` or `es` session,
// `runDecisionTree` still serves the single `s.pl`/`s.es` string while ClickHouse
// records v1/v2 — a variant/copy mismatch that corrupts A/B analytics. Suppress
// sampling for non-`en` locales until `variants.pl/es` arrays are added to the
// playbooks.
//
// FOLLOW-1286 (D3): the bandit is frozen. Unless BANDIT_ENABLED=true (lib/bandit-flag.ts)
// no arm is read or drawn and the decision is 'control'; the `variant` column keeps being
// written. The `bandit_arms` segment mark stays so the pre-LLM breakdown keeps its shape.
```

#### route.ts:1383 — `POST`

Anchor (first code line after the comment):
`const recordedVariant = variantSuppressed ? 'control' : selectedVariant;`

Kept in the code as: Credited arm: 'control' when the §E.7.0 withhold left nothing variant-bearing
[FOLLOW-1163].

```text
// FOLLOW-1163 / ESC-077 option 2: the arm that gets CREDITED for this response.
//
// FOLLOW-359 threaded one variable through copy selection, the response body and the
// ClickHouse log, and said so, because using the same variable is what proves the three agree.
// That invariant is preserved here and the split is deliberate and narrow: copy selection above
// still receives the SAMPLED arm, while the response and the log below both read this ONE
// variable. They differ only when §E.7.0's withhold left the response carrying no
// variant-differentiated slot — in which case the copy actually served IS the control copy
// (`cta` has no `variants.en`, so every arm falls through to `s.en`), and recording the sampled
// arm would credit v1/v2 for a difference the buyer never saw. Same remedy FOLLOW-362 already
// applies to non-`en` locales, for the same reason.
```

#### route.ts:1396 — `POST`

Anchor (first code line after the comment):
`const filteredTextDirectives = filterDirectivesByPageType(textDirectives, body.page_type);`

Kept in the code as: No per-listing headline off detail pages [FOLLOW-345].

```text
// FOLLOW-345: filter text directives by page_type before building the response.
// On list/search/home pages, suppress per-listing headline rewrites — they are
// only meaningful on detail pages where a single listing is in focus.
```

#### route.ts:1401 — `POST`

Anchor (first code line after the comment):
`const allDirectives: (TextDirective | ReorderDirective)[] = [...filteredTextDirectives];`

Kept in the code as: Reorder fails CLOSED (`reorderWithheld` says why); text stays fail-open
[FOLLOW-1202].

```text
// Append ReorderDirective for tenants with reorder_capable + listing_ids present.
// TICKET-AB-011: getTenantSchema now does real DB lookup + Redis cache.
// FOLLOW-019: real affinity via cosine(archetype_embedding, listing_embedding). Batched
// lookups are skipped when listing_ids exceeds LISTING_EMBEDDING_BATCH_LIMIT (latency guard).
// FOLLOW-1202 (CEO decision #3): `reorder` fails CLOSED — if the lookup is skipped or any
// listing has no usable embedding, no reorder is appended and `reorderWithheld` records why.
// Text directives above are untouched (they stay fail-open).
// Historical origin: the retired Decision API Worker's `reorder.ts`
// buildReorderDirective() — that Worker was removed by FOLLOW-1262.
```

#### route.ts:1422 — `POST`

Anchor (first code line after the comment): `let embeddingsAttempted = false;`

Kept in the code as: True only when the embedding fetch ran: djb2_guard vs djb2_fallback
[FOLLOW-560].

```text
// FOLLOW-560: true only when the embedding fetch was actually attempted AND succeeded
// (i.e. neither the latency guard nor the catch below fired). Distinguishes 'djb2_guard'
// (never attempted) from 'djb2_fallback' (attempted, some listing un-scorable).
```

#### route.ts:1466 — `POST`

Anchor (first code line after the comment):
`let chatIntentDimensions: Record<string, string> | null = null;`

Kept in the code as: Chat-intent prior bridge: live-influencing, fail-open on Redis errors
[FOLLOW-346, FOLLOW-635].

```text
// ── FOLLOW-346 / FOLLOW-101 / FOLLOW-635: chat-intent prior bridge ──────────
// Read the Modal NLP shadow key for this (tenant, session) pair and flatten
// intent_dimensions into a Record<string,string> for the SDK's applyChatIntentPrior.
//
// Failure posture: any Redis error is fail-open — we log at console.warn and set
// chatIntentDimensions to null. The adapt response is NEVER blocked by this read.
//
// FOLLOW-635 (CEO ruling, option A, 2026-07-24): this is a LIVE-INFLUENCING path,
// not shadow-only. `chat_intent_dimensions` is attached unconditionally (no
// server-side gate) and the SDK client prior loop folds it into `intentState`
// via `applyChatIntentPrior`; the resulting `archetype` is sent back as
// `archetype_hint` on the NEXT adapt call, which drives `archetypeId` and
// therefore the directives served. There is no `CHAT_NLP_LIVE` flag anymore —
// it never gated this read/response, only a log line, and has been removed.
// Chat only actually influences prod decisions once `apps/intent-engine`'s
// write path is deployed (tracked as ESC-042); until then the shadow key is
// never populated and this read is a no-op fail-open null.
```

#### route.ts:1484 — `POST`

Anchor (first code line after the comment): `let chatIntentDetectedAt: string | null = null;`

Kept in the code as: Stamp travels with the dimensions: one fold per message [FOLLOW-1024].

```text
// FOLLOW-1024: the extraction stamp travels WITH the dimensions. It is what lets the SDK
// fold one buyer message exactly once instead of one session exactly once — see
// `chat_intent_detected_at` in `@estalara/shared`.
```

#### route.ts:1517 — `POST`

Anchor (first code line after the comment): `const slotSelectors =`

Kept in the code as: Curated slot_selectors for no-code pages; omitted when absent [FOLLOW-340].

```text
// FOLLOW-340: include resolved slot_selectors from the tenant site schema when
// present and non-empty. The SDK uses these to self-annotate DOM nodes BEFORE the
// first applyDirectives() call so pages without hand-coded data-estalara-slot
// attributes (e.g. app.estalara.com no-code) can receive visible adaptation.
//
// Fail-safe: tenantSchema may be null (schema lookup failed) or may not have
// slot_selectors (tenant has no curated detail schema). In either case the field
// is simply omitted — the adapt response is never blocked or degraded.
```

#### route.ts:1539 — `POST`

Anchor (first code line after the comment):
`...(fallbackReason ? { fallback_reason: fallbackReason } : {}),`

Kept in the code as: Only on a fallback: tells an LLM outage from a refusal [FOLLOW-1056].

```text
// FOLLOW-1056: present only when the decision tree fell back. This is the field the
// FOLLOW-1022 canary reads to stay red for an unavailable LLM without going red for a
// correct fail-closed refusal.
```

#### route.ts:1554 — `POST`

Anchor (first code line after the comment): `afterResponse(() =>`

Kept in the code as: page_context_source='page_type_derived'; registered via after() [FOLLOW-358,
FOLLOW-431].

```text
// FOLLOW-357: writing pageCtx into the `page_context` ClickHouse column
// (renamed from `tier` in migration 0018).
// FOLLOW-358 (Rule K.1): page_context_source='page_type_derived' marks the row as
// server-derived via pageContextFromPageType (historical GET rows read 'caller_supplied').
//
// FOLLOW-431 / ESC-033: registered via after() so the async write (and its fail-loud
// .then/.catch → Sentry) completes after the response is sent before instance suspension.
```

### `apps/control-plane/src/lib/llm-gateway.ts`

#### llm-gateway.ts:1 — module header

Anchor (first code line after the comment): `import Anthropic from '@anthropic-ai/sdk';`

Kept in the code as: LLM Gateway: Haiku tweak band, else the generation model; history in ADR-0024
[ADP-002]. @module apps/control-plane/src/lib/llm-gateway

```text
/**
 * LLM Gateway — routes adaptation decisions through Claude Haiku or Sonnet.
 *
 * Routing policy (per ADP-002 spec):
 *   similarity > 0.85       → no LLM call (playbook path, not this module)
 *   0.6 < similarity ≤ 0.85 → Haiku 4.5: tweak 1-2 directives (low-latency path; stays Haiku)
 *   similarity ≤ 0.6, conf > 0.6 → global default model: full directive generation (FOLLOW-161)
 *   confidence ≤ 0.6        → no LLM call (default path, not this module)
 *
 * Model precedence for the full-generation path (similarity ≤ 0.6):
 *   1. forceModel (DEMO MODE, DEMO-001) — highest precedence, bypasses all routing.
 *   2. getGlobalGenerationModel() (FOLLOW-161) — admin-configured global default.
 *   3. SONNET_MODEL constant — static fallback when DB returns the default.
 *
 * The Haiku tweak path (0.6 < similarity ≤ 0.85) always stays Haiku regardless of
 * forceModel or the global config. It is the low-latency path and its model is not
 * user-selectable.
 *
 * Chat/intent classifier note (AC4 / FOLLOW-087):
 *   The real-time chat/intent classifier model is NOT user-selectable and stays
 *   Haiku-class. Its <500ms latency budget constrains it to a Haiku-class model.
 *   It is not wired through this gateway.
 *
 * Circuit breaker: $100/UTC-day spend cap via the Upstash counter (`llm-spend-counter.ts`); `llm_calls` stays the log.
 * Returns null on: missing API key, cap hit, an unusable reply, a fact-check rejection, or any
 * Anthropic API error. Which of those it was is reported through `input.onFallback` and booked
 * on the call's own `llm_calls` row (`GenerationOutcome`) — FOLLOW-1056.
 *
 * @module apps/control-plane/src/lib/llm-gateway
 */
```

#### llm-gateway.ts:51 — module header

Anchor (first code line after the comment): `export interface LlmGatewayInput {`

Kept in the code as: ── Types ──

```text
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
```

#### llm-gateway.ts:64 — `LlmGatewayInput`

Anchor (first code line after the comment): `listingContext?: Record<string, string>;`

Kept in the code as: Listing facts + FAQ answers; non-empty → a "Listing context" block
[TICKET-AGENCY-001].

```text
/**
 * Agency-curated listing metadata, keyed by field name.
 * Populated by RAG retrieval in the adapt route (TICKET-AGENCY-001).
 * When non-empty, prompt builders append a "Listing context" block that
 * instructs the LLM to substitute placeholder tokens (e.g. `{yield}`).
 */
```

#### llm-gateway.ts:75 — `LlmGatewayInput`

Anchor (first code line after the comment): `forceModel?: string;`

Kept in the code as: Force a DEMO_ALLOWED_MODELS model, bypassing routing [DEMO-001].

```text
/**
 * Force a specific Anthropic model ID, bypassing the similarity-based routing
 * policy. Used by DEMO MODE (DEMO-001) when the operator selects a model from
 * the admin UI. Must be one of the curated DEMO_ALLOWED_MODELS.
 * When null/undefined, the standard routing policy applies.
 */
```

#### llm-gateway.ts:82 — `LlmGatewayInput`

Anchor (first code line after the comment):
`onFallback?: (reason: NonNullable<AdaptationDirectives['fallback_reason']>) => void;`

Kept in the code as: Why the call returns `null`; once per null exit, never on success
[FOLLOW-1056].

```text
/**
 * Why this call is about to return `null`, reported to the caller before it does
 * [FOLLOW-1056].
 *
 * WHY A CALLBACK AND NOT A RICHER RETURN TYPE. `null` is this function's failure contract and
 * 23 assertions across four other tickets' test blocks encode it (`expect(result).toBeNull()`
 * on the fact-check path is FOLLOW-457's, FOLLOW-1034's, FOLLOW-1041's and FOLLOW-1042's
 * statement about rejection semantics). Widening the return to a union would rewrite tests
 * this ticket does not own, for a value only one caller reads. The callback adds the missing
 * channel without touching the existing one.
 *
 * WHY IT IS NEEDED AT ALL. Two opposite conditions — the LLM was unavailable (an incident)
 * and the model wrote ungrounded copy that the pipeline correctly refused (the system
 * working) — both make the route answer `playbook_fallback_llm_unavailable`. The route cannot
 * tell them apart from `null`, so neither can the FOLLOW-1022 canary, which went red for each
 * of them on 2026-08-20 (runs `32370637849`, `32372181392`).
 *
 * Fires exactly once per call, on every `null` exit, and never on success. The cap-hit exit
 * reports `llm_unavailable` because that is what the route's `source` already says on that
 * path; `playbook_fallback_llm_capped` exists in the response union and is written by no
 * route return site — pre-existing, deliberately not changed here.
 */
```

#### llm-gateway.ts:105 — `LlmGatewayInput`

Anchor (first code line after the comment): `groundingMissing?: boolean;`

Kept in the code as: Facts were requested but none arrived → `listing_context_unavailable`
[FOLLOW-1120].

```text
/**
 * FOLLOW-1120. True when the caller asked for a listing's facts and none reached
 * `listingContext` — i.e. the prompt below carries the grounding RULE with no grounding BLOCK
 * for it to refer to. The route computes it (it is the only layer that sees both the requested
 * `listing_id` and the resolved context); this module only reports it, by narrowing the
 * `llm_unavailable` fallback to `listing_context_unavailable`.
 */
```

#### llm-gateway.ts:125 — `LlmGatewayOutput`

Anchor (first code line after the comment): `const HAIKU_MODEL = 'claude-haiku-4-5' as const;`

Kept in the code as: ── Constants ──

```text
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
```

#### llm-gateway.ts:145 — `DAILY_WARN_USD`

Anchor (first code line after the comment): `const JUDGE_DEADLINE_MS = 2000;`

Kept in the code as: Deadline for ONE judge round trip, ~2× the slowest measured [MP-013,
FOLLOW-1040].

```text
/**
 * Wall-clock deadline for ONE fact-check judge round trip [FOLLOW-1040].
 *
 * Not guessed: chosen against the judge's own measured latency band in **[MP-013]**, at
 * roughly twice the slowest judge round trip in that premise's sample, which is itself far
 * below the same model's generation-call band (the judge is capped at `max_tokens: 50`, so
 * it is structurally the cheaper call).
 *
 * The asymmetry that sets the value: expiry costs a RECOVERY (the token rejection stands
 * and the caller falls back to playbook copy — the pre-#787 behaviour), while waiting costs
 * the buyer, on a path where the host anti-flicker cloak has already expired. A judge call
 * slower than this deadline is worth less than the seconds it spends.
 */
```

#### llm-gateway.ts:160 — `JUDGE_DEADLINE_MS`

Anchor (first code line after the comment): `const JUDGE_CALL_BUDGET_TWEAK_BAND = 3;`

Kept in the code as: Tweak-band judge budget: worst case across locales [FOLLOW-1178, FOLLOW-1180].
Invariant: derived from the 3 playbook slots — a 4th slot must raise this in the same change.

```text
/**
 * Judge round trips one `/adapt` request may spend on the **Haiku tweak band**
 * (`0.6 < similarity <= 0.85`) [FOLLOW-1040, band-split by FOLLOW-1178, re-derived across
 * locales by FOLLOW-1180].
 *
 * Three, because three is how many flags a benign batch can carry here **once the derivation
 * stops silently assuming the listing is in English**.
 *
 * The derivation this replaces read: `buildHaikuPrompt` puts the archetype's own slots into the
 * prompt as `Current directives`, including the authored `cta`; #873 measured the model
 * reproducing that string verbatim on 12 of 12 live runs and #875/#877 exempt it on PROVENANCE;
 * three slots minus the one the prompt makes exempt-able leaves two adjudicable flags. Every
 * step of that is true — **in English, and only there.** `buildHaikuPrompt` renders `value:
 * s.en` and `isTemplateAuthoredValue` compares against `[s.en, ...(s.variants?.en ?? [])]`, and
 * no playbook carries a non-English slot string at all (RETRO-321 §4a LG-1 census, two
 * independent strategies: 17 `slot: 'cta'` entries, every one of the form `{ slot, en }`). So
 * the exemption fires only when the model answers in English.
 *
 * **It needs nothing authored to stop firing.** `GROUNDING_RULE` tells the model, a few lines
 * above the schema, that the context may be in another language and to quote its nouns as
 * written; the estate serves EU/UK/UAE; and [MP-012]'s third act is a fully obedient FRENCH
 * headline dying on `Potentiel`. On a French listing the model writes a French `cta`,
 * provenance cannot match it, and this band carries exactly the three adjudicable flags the
 * generation band carries.
 *
 * **MEASURED, paired, on this band** (RETRO-321 §4a LG-1, re-executed as FOLLOW-1180's
 * red-first — `__tests__/llm-gateway.follow1180.test.ts`): with a judge that grounds everything
 * it is asked, the batch `[cta, headline, feature]` was SERVED with the shipped English `cta`
 * and REFUSED — one Anthropic call, zero judge rows — with a French one. The only difference
 * between the two rows is the CTA's LANGUAGE, and on branch 4 that refusal is a ZERO-directive
 * response: §E.7.0 removed the template fallback.
 *
 * **So the number is the worst case ACROSS LOCALES, not the English case** — for the same
 * reason {@link JUDGE_CALL_BUDGET_GENERATION_BAND} is: a module constant cannot know the
 * listing's language, and the exemption's firing rate is a function of it. The two bands now
 * coincide at 3. They are kept separate because they are derived separately and would diverge
 * again the day `buildHaikuPrompt` renders a LOCALISED authored `cta` — which is FOLLOW-1164's
 * territory and a grounding-corpus question, not a matching one. Widening
 * `isTemplateAuthoredValue` to match across languages is explicitly NOT the lever (FOLLOW-1179):
 * it would exempt an invented name.
 *
 * **The price, named (Rule AV).** This band's judge worst case rises from 4 s to 6 s
 * (`3 × JUDGE_DEADLINE_MS`), and it is paid only by a batch that flags all three slots — in
 * English a batch that has already invented a CTA, in French the ordinary case. The English
 * happy path is unchanged at two flags and two round trips. For scale: `CLOAK_MAX_MS` is
 * 1500 ms and [MP-013] clause 2 puts the generation call ALONE at p95 3358 ms, so the host
 * cloak has expired on this path either way; what the extra 2 s buys is the difference between
 * adapted copy and none.
 *
 * **What this number is now derived FROM, so that adding a slot cannot silently starve it.**
 * `buildSonnetPrompt` carries the same warning against its hardcoded `Available slots:` line;
 * this band's list is not hardcoded — it is `PlaybookEntry.slots`, rendered straight into the
 * prompt by `buildHaikuPrompt`. All 17 shipped playbooks carry exactly THREE slots, and after
 * the re-derivation above none of them is reliably exempt, so a fourth slot on any playbook
 * makes a benign four-flag batch unservable on this band. Raise this constant in the same
 * change, or the new slot costs the archetype its whole batch on the listings that flag it.
 */
```

#### llm-gateway.ts:219 — `JUDGE_CALL_BUDGET_TWEAK_BAND`

Anchor (first code line after the comment): `const JUDGE_CALL_BUDGET_GENERATION_BAND = 3;`

Kept in the code as: Generation-band budget: 3 slots, none exempt; equal to the tweak band by
coincidence [FOLLOW-1178].

```text
/**
 * Judge round trips one `/adapt` request may spend on the **Sonnet full-generation band**
 * (every `similarity` outside the tweak window, which is where a behaviour-only buyer lands)
 * [FOLLOW-1178].
 *
 * Three, because on this band nothing is exempt-able. `buildSonnetPrompt` says
 * `Available slots: headline, cta, feature` and never shows the model the authored CTA, so
 * `isTemplateAuthoredValue` is satisfiable only by coincidence and the `cta` is an ordinary
 * flag. Three slots, none exempt, three adjudicable flags.
 *
 * FOLLOW-1180 brought the tweak band to the same number by a DIFFERENT route — there the
 * exemption exists but is locale-bound — so the equality of the two constants is a coincidence
 * of two derivations, not one shared premise. Read each docblock before moving either.
 *
 * **This number replaces a 2 that was measured to discard a batch the judge would have
 * grounded (RETRO-320 §4a LG-1).** The measured batch — `cta: Book a Viewing with Knight
 * Frank`, `headline: Riverside Quarter apartment`, `feature: Investment Performance`, with a
 * judge that answered `grounded` to everything it was asked — spent both budgeted calls on the
 * `cta` and the `headline` and then rejected the `feature` deterministically, taking the whole
 * batch with it. On branch 4 that is a ZERO-directive response: §E.7.0 removed the template
 * fallback, so `fact_check_refused` there is `directives: []`, not degraded copy.
 */
```

#### llm-gateway.ts:243 — `JUDGE_CALL_BUDGET_GENERATION_BAND`

Anchor (first code line after the comment): `function judgeCallBudget(model: string): number {`

Kept in the code as: Judge budget for this band (same split as `generationSource`); over budget
stays rejected [FOLLOW-1178].

```text
/**
 * The judge budget for the band this request is being served on [FOLLOW-1178].
 *
 * Deliberately the SAME band split `generationSource` uses (`model === HAIKU_MODEL`), so the
 * budget, the `llm_calls.source` label and the prompt builder can never disagree about which
 * band a request is on. A `forceModel` (DEMO MODE) that is not Haiku is a generation-band call
 * and gets the generation-band budget.
 *
 * **Read this before quoting a worst case, and name the band when you do (Rule AV).** The
 * judge's contribution to one `/adapt` response is `budget × JUDGE_DEADLINE_MS`: **6 s on both
 * bands since FOLLOW-1180** (it was 4 s on the tweak band, on a derivation that held only for
 * an English listing) — and only in the case where every flag is adjudicated and the batch is
 * SERVED, because of the futility rule below. Before FOLLOW-1178 the generation band paid 4 s
 * to arrive at a refusal it was already guaranteed to reach.
 *
 * **The two branches return the same number today, and that is not a licence to drop the
 * dispatch.** They are separate derivations over separate prompts (see each constant's
 * docblock), and a band-silent restatement of "the judge budget is 3" is the exact defect
 * FOLLOW-1178 was opened to correct.
 *
 * Exceeding the budget does NOT skip the fact check: an unadjudicated flag keeps its
 * deterministic rejection, so the budget can only ever make the gateway stricter.
 *
 * **What is still unmeasured, stated so the number is not read as validated by traffic
 * [FOLLOW-1165].** Both numbers above are derived from the SLOT COUNT and from which slots
 * each prompt makes exempt-able — a structural argument, and a deterministic one: a batch
 * carrying more flags than its band's budget dies every time, at any rate. (Until FOLLOW-1180
 * the tweak band's budget was two and a three-flag batch died there deterministically; that is
 * what a locale-conditional derivation cost.) What no measurement here answers is how OFTEN a
 * benign batch flags every slot, nor how that rate varies with the listing's LANGUAGE, because
 * `overrides ÷ flags` needs production `fact_check_judge*` rows and FOLLOW-820 has not read
 * GO. FOLLOW-1165 still owns that ratio, and after this change it must report it PER BAND —
 * a single number without the word Haiku or Sonnet beside it answers nothing.
 */
```

#### llm-gateway.ts:281 — `judgeCallBudget`

Anchor (first code line after the comment): `const JUDGE_VERDICT_SOURCE = {`

Kept in the code as: `llm_calls.source` per judge verdict, so `overrides ÷ flags` is a query
[FOLLOW-1041, MP-012].

```text
/**
 * `llm_calls.source` values for the judge's OWN ClickHouse row, one per verdict [FOLLOW-1041].
 *
 * Rule AJ, not Rule K.2 (K.2 governs the fire-and-forget `console.info` at the override call
 * site below — a producer-side obligation it already satisfied; AJ is what makes the signal
 * COUNTABLE). This widens the SAME row `judgeNameGrounding` already wrote per invocation
 * (`source: 'fact_check_judge'`, pre-#1041) rather than adding a new column — `source` is
 * `LowCardinality(String)` (`infra/clickhouse/migrations/0004_create_llm_calls.sql`), so new
 * values need no DDL. `overrides ÷ flags` is now `countIf(source = override) / count()` over
 * `source LIKE 'fact_check_judge%'` — see docs/ops/MEASURED_PREMISES.md MP-012's saved query,
 * the consumer of record.
 *
 * A flag left unadjudicated because the batch carried more of them than `judgeCallBudget`
 * allows never calls `judgeNameGrounding` and so never writes a row here — a fourth outcome
 * that must NOT count as a judge verdict. FOLLOW-1178 widened that outcome from "the flags
 * after the budget ran out" to "every flag in an over-budget batch", so such a batch now
 * writes ZERO judge rows instead of `budget` of them; see MP-012's denominator caveat.
 * **It writes a row in `FACT_CHECK_UNJUDGED_SOURCE` below instead** [FOLLOW-1183] — deliberately
 * under a different prefix, so `source LIKE 'fact_check_judge%'` still returns adjudications and
 * only adjudications.
 * Timeout and API error are indistinguishable to the CALLER by design (FOLLOW-1040: both land
 * in the same catch and return `'unavailable'`), but that split is exactly what a counter
 * needs, so it happens HERE, inside `judgeNameGrounding`'s own catch — not at the call site.
 */
```

#### llm-gateway.ts:318 — `JUDGE_VERDICT_SOURCE`

Anchor (first code line after the comment): `const UNJUDGED_OVER_BUDGET_FLAG_CEILING = 9;`

Kept in the code as: Over-budget source cardinality cap: above it the value says `_9_or_more`
[FOLLOW-1183].

```text
/**
 * Above this many flags, the over-budget row stops claiming an exact count.
 *
 * A cardinality guard on a `LowCardinality(String)` column, not a limit on anything the gateway
 * does. `max_tokens: 512` bounds a generation to roughly a dozen directives, so production
 * should never reach it; if it does, `..._9_or_more` is the honest label and a ClickHouse
 * `extract(source, 'flags_(\\d+)$')` returns NULL for it rather than a number that would be
 * wrong. Ten values is the whole budget this register spends on the column.
 */
```

#### llm-gateway.ts:329 — `UNJUDGED_OVER_BUDGET_FLAG_CEILING`

Anchor (first code line after the comment): `const FACT_CHECK_UNJUDGED_SOURCE = {`

Kept in the code as: Source for flags the judge never saw; completes MP-012's partition
[FOLLOW-1183, MP-014].

```text
/**
 * `llm_calls.source` for a `hallucinated_proper_name` flag the judge NEVER SAW, one value per
 * reason it did not [FOLLOW-1177 / FOLLOW-1183].
 *
 * ## The two silent populations this closes, and which value covers which
 *
 * Both are branches of `callLlmGateway` that change the outcome and, until now, wrote nothing
 * countable anywhere:
 *
 *   - `exemptAuthored` — **FOLLOW-1177.** The provenance exemption fired: the slot asserts
 *     nothing about the property (`isNonAssertiveSlot`, today `cta` alone) AND the value is this
 *     archetype's own authored copy (`isTemplateAuthoredValue`). The flag is cleared without a
 *     round trip. Before this it wrote no row of any kind, so MP-012's `overrides ÷ flags`
 *     silently became a rate over the non-exempt slots only.
 *   - `overBudget(n)` — **FOLLOW-1183.** The batch carried more proper-name flags than
 *     `judgeCallBudget` allows, so `overJudgeBudget` refused its flags without adjudicating
 *     anything. Before this it wrote one `console.warn`, which made it byte-identical in
 *     ClickHouse to a `hallucinated_number` reject, and made "how often does the budget bind"
 *     unanswerable after the fact.
 *
 * The two never describe the same flag: an exempted flag is removed from the population BEFORE
 * `flaggedSlots` is counted, so it can never also be reported as unadjudicated.
 *
 * ## Why this is a complete partition, which is the point
 *
 * Every `hallucinated_proper_name` flag now ends in exactly one register: this one (cleared by
 * provenance, or never adjudicated because the batch was already doomed) or `JUDGE_VERDICT_SOURCE`
 * (adjudicated, whatever the verdict). So the flag population MP-012's ratio divides by is
 * recoverable in full — `count(exempt) + count(judge_*) + sum(n over over-budget rows)` — and the
 * ratio stops being one CONDITIONED on `flags <= budget`. That conditioning is what biased it
 * upward: the excluded batches are the ones with the most flags, where an override is least
 * likely. MP-012's `measure_with` (2) carries the query; it is this register's consumer of record
 * (Rule AJ).
 *
 * **`hallucinated_number` is NOT in the partition.** A number flag is returned before the
 * proper-name scan and is never routed to the judge by design (FOLLOW-1034 — no model gets to
 * overrule a figure), so it belongs to no bucket here and none of these rows count it. If
 * FOLLOW-1181 generalises `overJudgeBudget` to that class, the class needs its OWN value:
 * booking a number-doomed batch as `over_budget` would name a row after a computation it did not
 * perform.
 *
 * ## Why a `source` on `llm_calls`, and why these rows are free
 *
 * The shape FOLLOW-1041 established for judge verdicts, FOLLOW-1056 for generation outcomes and
 * FOLLOW-1061 for `route_pre_llm`: `source` is `LowCardinality(String)`
 * (`infra/clickhouse/migrations/0004_create_llm_calls.sql`), so a new value needs no DDL — which
 * is decisive rather than merely convenient, because the control plane's ClickHouse role holds no
 * column-DDL grant at all ([MP-014]). A second table for two counters would be a parallel store
 * for a question the register already answers, and the tickets rule it out by name.
 *
 * `tokens_in`, `tokens_out`, `cost_usd` and `latency_ms` are ZERO on these rows, and unlike
 * FOLLOW-1049's zeros they do not mean UNKNOWN: no API call was made, nothing was billed, and no
 * round trip was waited on — that is what the skip and the exemption ARE. The rolling-24h $100
 * breaker (the Upstash daily counter, fed only by billed rows) is therefore unmoved.
 *
 * ## Why the flag count lives in the value
 *
 * The band is the row's own `model` column, where every other row in this register already keeps
 * it (Rule AV — after the per-band budget split, a count without a band answers nothing). The
 * flag COUNT has no such column, and putting it in `tokens_in` would be a field named for a
 * computation it does not perform. With no column-DDL grant the honest remaining place is the
 * discriminator itself, which already carries compound facts (`llm_tweaked_fact_check_rejected`
 * is a band plus an outcome). `LowCardinality` bounds how many values that may be, so the count
 * is bounded too — see `UNJUDGED_OVER_BUDGET_FLAG_CEILING`.
 */
```

#### llm-gateway.ts:395 — `FACT_CHECK_UNJUDGED_SOURCE`

Anchor (first code line after the comment): `exemptAuthored: 'fact_check_unjudged_exempt_authored',`

Kept in the code as: Provenance exemption cleared the flag; no judge call [FOLLOW-1177,
FOLLOW-1251].

```text
/**
 * A provenance exemption cleared the flag; the judge was never asked [FOLLOW-1177]. Since
 * FOLLOW-1251 this covers both authored populations: the archetype's own `cta` and its
 * reviewed `feature` section label (`isAuthoredSectionLabel`).
 */
```

#### llm-gateway.ts:401 — `FACT_CHECK_UNJUDGED_SOURCE`

Anchor (first code line after the comment): `overBudget: (flagCount: number): string =>`

Kept in the code as: Batch over the band's budget; one row per batch with the count [FOLLOW-1183].

```text
/**
 * The batch carried more flags than the band's budget could cover, so none was adjudicated
 * [FOLLOW-1183]; since FOLLOW-1312 every flagged slot is refused and the unflagged slots are
 * still served. One row per BATCH — the skip is a property of the batch, not of a directive —
 * carrying how many flags went unadjudicated.
 */
```

#### llm-gateway.ts:413 — `FACT_CHECK_UNJUDGED_SOURCE`

Anchor (first code line after the comment): `function factCheckSlotRefusedSource(`

Kept in the code as: Source for ONE refused slot; unknown slot names → `other` [FOLLOW-1312].

```text
/**
 * `llm_calls.source` for ONE refused slot [FOLLOW-1312]:
 * `fact_check_slot_refused_<slot>_<violation>`.
 *
 * Since the slot is the unit of refusal (`slotRefusal`, `claim-containment.ts`), the generation
 * row alone no longer says what was refused: a batch with one refused slot and two served ones
 * books its generation row as SERVED (`llm_tweaked` / `llm_full` — the spend bought copy a buyer
 * saw), and `<band>_fact_check_rejected` is written only when EVERY slot is refused. These rows
 * carry the slot names on both paths, one per refused slot, beside that unchanged generation row.
 *
 * Same shape and argument as `FACT_CHECK_UNJUDGED_SOURCE`: `source` is `LowCardinality(String)`
 * and the control plane holds no column-DDL grant ([MP-014]), so the fact lives in the
 * discriminator, the band in `model`, and tokens/cost/latency are a measured ZERO (nothing was
 * called for the row; the generation's own cost is on its own row). The slot name is
 * model-written and unbounded, so it is kept only when it is one of this playbook's own slots,
 * else `other`; the violation set is closed. MP-012 `measure_with` (3) is the consumer of record.
 */
```

#### llm-gateway.ts:439 — `factCheckSlotRefusedSource`

Anchor (first code line after the comment): `type GenerationOutcome =`

Kept in the code as: Generation outcome on its own `llm_calls` row; `llm_*` alone means served
[FOLLOW-1056, MP-010].

```text
/**
 * What happened to the GENERATION call, as recorded on its own `llm_calls` row [FOLLOW-1056].
 *
 * Rule AJ, same adjudication as `JUDGE_VERDICT_SOURCE` above: `source` is
 * `LowCardinality(String)` (`infra/clickhouse/migrations/0004_create_llm_calls.sql:17`), so new
 * values need no DDL, and the consumer of record is `docs/ops/MEASURED_PREMISES.md` MP-010 /
 * MP-012, whose saved queries are updated in the same PR.
 *
 * TWO defects this closes, both MEASURED on production before the change (RETRO-290 §9/§9b):
 *
 *   1. Four of this function's six exits wrote NOTHING. The `catch` that produces the
 *      `playbook_fallback_llm_unavailable` the FOLLOW-1022 canary asserts on, and the three
 *      in-`try` early returns for an unusable reply, were all outside the two `logLlmCallAsync`
 *      call sites. So the one failure mode [MP-010] names and [MP-012] watches for was
 *      answerable only from a CI canary that happened to fire in the same minute or a Vercel
 *      log line inside a retention window — never from the register, never after the fact.
 *   2. Both exits that DID write used the same value, so a batch that was GENERATED AND SERVED
 *      and one that was GENERATED AND REFUSED by the fact check were indistinguishable.
 *
 * SEMANTICS CHANGE, stated rather than made silently — RETRO-290's own finding is that
 * `llm_calls.source` was redefined once with no value change. `llm_tweaked` / `llm_full` are
 * NARROWED here to mean "served" only; rejections move to a NEW value rather than the reverse,
 * so `WHERE source = 'llm_tweaked'` keeps meaning something true and merely stops over-counting.
 * Rows written before this deploys keep the old ambiguity and no backfill can resolve them —
 * date the cut-over from the first production row carrying any `_fact_check_rejected` or
 * `_unavailable_*` suffix.
 *
 * The model band stays in the value (`llm_tweaked_*` / `llm_full_*`) because per-band cost
 * attribution is what the $100/day breaker reads, and a failed call's spend belongs to the band
 * that made it.
 */
```

#### llm-gateway.ts:480 — `GenerationOutcome`

Anchor (first code line after the comment):
`function generationSource(model: string, outcome: GenerationOutcome): string {`

Kept in the code as: The single place a generation `source` is picked [FOLLOW-1041].

```text
/**
 * The single place a generation `source` is picked, so it can never be chosen in one place and
 * applied in another — the same containment `logVerdict` gives the judge (FOLLOW-1041).
 */
```

#### llm-gateway.ts:489 — `generationSource`

Anchor (first code line after the comment): `/**`

Kept in the code as: ── Zod schema for LLM response validation ──

```text
// ---------------------------------------------------------------------------
// Zod schema for LLM response validation
// ---------------------------------------------------------------------------
```

#### llm-gateway.ts:493 — `generationSource`

Anchor (first code line after the comment): `const TextDirectiveSchema = z.object({`

Kept in the code as: One directive. Invariant: judge budgets derive from the slot count
[FOLLOW-1178].

```text
/**
 * The shape of one directive the model may return.
 *
 * SLOT COUNT → LATENCY, read this before adding a slot [FOLLOW-1040]. Every directive the
 * model returns is fact-checked individually, and a `hallucinated_proper_name` flag is
 * adjudicated by a SERIAL judge round trip (`judgeNameGrounding`). Adding a slot therefore
 * used to add a round trip to the worst case of a request a buyer is waiting on. It no
 * longer does: `judgeCallBudget` bounds the judge per request regardless of slot count. What
 * still scales with the slot count is the GENERATION call's output length — the term Track
 * LATENCY (FOLLOW-1037/1038/1039) owns.
 *
 * FOLLOW-1178 — but the budget is now DERIVED from the slot count ("slots the band's prompt
 * can produce, minus the slots that band's prompt makes exempt-able"), so adding a slot still
 * moves a number: it raises how many flags a benign batch can carry, and a budget one short of
 * that discards the batch every time all of them flag. Add a slot, re-derive both budgets.
 */
```

#### llm-gateway.ts:517 — `TextDirectiveSchema`

Anchor (first code line after the comment):
`function buildListingContextBlock(listingContext: Record<string, string>): string {`

Kept in the code as: ── Prompt builders ──

```text
// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------
```

#### llm-gateway.ts:534 — `buildListingContextBlock`

Anchor (first code line after the comment): `const GROUNDING_RULE =`

Kept in the code as: Grounding rule over the checker's own sources, never the playbook (ESC-076,
§E.7.0) [FOLLOW-1166].

```text
/**
 * The grounding rule that `checkDirectiveFacts` (FOLLOW-457) enforces, stated TO the model —
 * and, since FOLLOW-1166, stated over the SAME sources the checker actually grounds against.
 *
 * FOLLOW-1022: the guardrail was enforced but never communicated, and in production every
 * generated directive was discarded for `hallucinated_number` or `hallucinated_proper_name`
 * — the measurement is registered as [MP-010]. The model was doing exactly what it was asked:
 * the base directives it is told to "improve upon" are playbook templates that DEMAND figures
 * (`"Rental Yield: {yield}% | Gross Income: {income}/yr"`), while nothing in the prompt said
 * those figures must come from the listing. Stating the rule costs a few tokens; leaving it
 * unstated cost 100% of the LLM path.
 *
 * FOLLOW-1166 — the sentence above had stopped being true, and in MP-010's own direction with
 * the polarity flipped. FOLLOW-1162 (#869) removed the playbook from `buildDirectiveGroundingText`
 * under MASTER_DESIGN §E.7.0 — a template cannot know a property, so template text is not
 * evidence about one — and left this rule saying "Reuse the wording of the context AND THE
 * CURRENT DIRECTIVES". The prompt therefore ordered the model to reuse the exact vocabulary the
 * checker had just stopped accepting. Measured, not reasoned (RETRO-316 §4a):
 * `yield_hunter`'s own shipped headline is flagged `hallucinated_proper_name` — `Rental`,
 * `Yield` and `Profile` are in neither `FACT_CHECK_STOP_CAPS` nor any listing — so AL's own copy
 * did not survive AL's own fact check while the prompt was asking for it. That costs a judge
 * round trip when a judge is available and the whole batch when one is not.
 *
 * The second source is therefore cut, and the base directives are labelled in
 * {@link buildHaikuPrompt} as framing rather than evidence. The playbook stays IN the prompt:
 * it is where the archetype's angle comes from, and removing it is FOLLOW-1164's decision, not
 * this one's. Note also that only the Haiku builder ever supplied a `Current directives` block,
 * so on the Sonnet path the cut clause named something the prompt did not contain.
 */
```

#### llm-gateway.ts:571 — `GROUNDING_RULE`

Anchor (first code line after the comment):
`'- Copy every figure and unit EXACTLY as the context writes it, character for character.\n' +`

Kept in the code as: Token-level rule; never spell a forbidden example — a primed token is suggested
[MP-012].

```text
// FOLLOW-1034 second half (ESC-063 residue): the enforcement is a TOKEN check, so the rule
// must state its token-level consequences or the model keeps failing it in good faith. The
// three constraints below map one-to-one onto the three false-positive classes measured in
// [MP-012] (abbreviation, Title-Case coinage, translation). The checker cannot see semantic
// equivalence; the model CAN avoid needing it. Stating typography and vocabulary constraints
// costs tokens; not stating them costs the LLM path, which was [MP-010].
// No negative examples in the rule text: the first deploy quoted two forbidden coinages
// verbatim and the model promptly wrote one of them into a headline — a primed token is a
// suggested token. State the rule; never spell the counterexample. [MP-012]
```

#### llm-gateway.ts:582 — `GROUNDING_RULE`

Anchor (first code line after the comment):
`'- Reuse the wording of the context. Do not coin new capitalised\n' +`

Kept in the code as: The context ONLY: the checker no longer grounds on directives [FOLLOW-1166].

```text
// FOLLOW-1166: the context, and ONLY the context. This sentence used to read "the context and
// the current directives", which named a source `buildDirectiveGroundingText` stopped carrying
// at FOLLOW-1162 — so the prompt was inducing the exact token the checker would then reject.
```

#### llm-gateway.ts:621 — `buildHaikuPrompt`

Anchor (first code line after the comment):
`'Current directives — the archetype's existing framing (JSON): ${baseDirectivesJson}\n' +`

Kept in the code as: Framing, not evidence [FOLLOW-1166].

```text
// FOLLOW-1166: the block keeps its place — it is where the archetype's angle comes from —
// but it is named for what it is, so `GROUNDING_RULE`'s "any directives shown above" has an
// unambiguous referent and the model is not left inferring which half of the prompt is
// evidence.
```

#### llm-gateway.ts:652 — `buildSonnetPrompt`

Anchor (first code line after the comment): `'Available slots: headline, cta, feature\n' +`

Kept in the code as: Invariant: JUDGE_CALL_BUDGET_GENERATION_BAND derives from this list
[FOLLOW-1178].

```text
// Adding a slot to this list adds a directive to fact-check, and a flagged directive
// costs a SERIAL judge round trip on a request the buyer is waiting on. The judge is
// bounded (`JUDGE_DEADLINE_MS`, `judgeCallBudget` — see their doc comments), so a fourth
// slot no longer widens the worst case per FLAG; it does lengthen the generation call
// itself. FOLLOW-1178 — but this band's budget is DERIVED from this very slot list (three
// slots, none of them exempt-able here, because this prompt never shows the model the
// authored `cta`), so adding a slot here without raising
// `JUDGE_CALL_BUDGET_GENERATION_BAND` makes a benign four-flag batch unservable. Do not
// add one without reading [FOLLOW-1040], [FOLLOW-1178] and [MP-013].
```

#### llm-gateway.ts:672 — `buildSonnetPrompt`

Anchor (first code line after the comment): `function parseDirectivesFromResponse(`

Kept in the code as: ── Parse and validate LLM response ──

```text
// ---------------------------------------------------------------------------
// Parse and validate LLM response
// ---------------------------------------------------------------------------
```

#### llm-gateway.ts:705 — `parseDirectivesFromResponse`

Anchor (first code line after the comment):
`const FACT_CHECK_STOP_CAPS: ReadonlySet<string> = new Set([`

Kept in the code as: Fact whitelist: listing facts + session events only, never playbook copy
(ESC-076) [FOLLOW-457].

```text
// ---------------------------------------------------------------------------
// Fact-whitelist grounding check (FOLLOW-457 AC2)
// ---------------------------------------------------------------------------
//
// The description/headline generation path already suppresses any headline
// asserting a specific number or proper name absent from its grounding
// sources (apps/llm-gateway/src/jobs/generate_description.py
// _check_headline_facts, FOLLOW-169/FOLLOW-272). This directive path
// (buildHaikuPrompt / buildSonnetPrompt) had no equivalent — an LLM-returned
// directive could assert a hallucinated price, area, or named entity and it
// would ship unchecked.
//
// Grounding sources for the directive path — there is no original_description
// here (LlmGatewayInput has none), so the whitelist is built from the inputs
// that are evidence ABOUT THIS PROPERTY, which is not the same set as the
// inputs the prompt builders pass to the model:
//   - listingContext — agency-provided per-listing facts (RAG retrieval).
//   - sessionContext.recentEvents — behavioural event labels; evidence of what
//     the buyer asked, never of the property.
// Any number or capitalised word in a returned directive value that cannot be
// traced to one of these is treated as a hallucination. The whole gateway
// call is failed (returns null) so the caller falls back to playbook copy —
// same fail-safe contract runDecisionTree already applies on any null return.
//
// FOLLOW-1162 / MASTER_DESIGN §E.7.0 removed `basePlaybook.description`,
// `.signals`, `slots[].en`, every `variants.en[]` and `copy_template.en` from
// that list. This paragraph still described them as "curated seed copy, safe by
// construction" for two merges afterwards (RETRO-316 §4b CI-1), which is the
// documentation half of the same asymmetry FOLLOW-1166 fixed in the prompt.
// They are author-approved, and that is exactly why they are not evidence: an
// author approving a sentence about properties in general says nothing about
// THIS one. The corpus is deliberately narrower than the prompt, and the prompt
// now says so — see `GROUNDING_RULE`.
```

#### llm-gateway.ts:819 — `FACT_CHECK_STOP_CAPS`

Anchor (first code line after the comment): `'Get',`

Kept in the code as: Words that never assert a fact; consulted before the judge, so keep them
[FOLLOW-1042].

```text
// FOLLOW-1034 / ESC-063: generic imperatives and generic property-marketing nouns.
// Production logs showed grounded batches dying on words like "Get" — a Title-Case
// verb is not a proper name. This list stays bounded to words that can never assert
// an entity or a figure; places, schools, developers and brands are still caught.
//
// FOLLOW-1042 AC(4), re-checked and KEPT IN FULL — nothing removed. The question was
// whether the #787 judge tier makes these redundant. It does not, and cannot: this set
// is consulted BEFORE a violation is raised, and the judge only ever runs AFTER one, so
// deleting an entry does not hand the word to the judge — it converts a free pass into a
// paid model call whose failure mode drops the whole gateway response to playbook copy.
// Measured after the tokeniser fix, with this set emptied and each word probed
// mid-segment through callLlmGateway against the pilot's French listing: 28 of the 30
// (the stub says 31; there are 30) are LOAD-BEARING — they are flagged without the entry.
// The 2 that are not ("View", "Maximize") are grounded only via THIS playbook's own
// `signals`/`description` ("views_yield_data", "maximizing"), which differ per archetype,
// so their redundancy is a property of one fixture and not a reason to delete them.
```

#### llm-gateway.ts:876 — `escapeRegExpToken`

Anchor (first code line after the comment):
`function buildDirectiveGroundingText(input: LlmGatewayInput): string {`

Kept in the code as: Grounding text a directive value must trace to.

```text
/**
 * Build the combined grounding text a directive value must be traceable to.
 * Mirrors the description path's (original_description + listing_context)
 * grounding pair — see the section docstring above.
 */
```

#### llm-gateway.ts:883 — `buildDirectiveGroundingText`

Anchor (first code line after the comment): `const parts = [`

Kept in the code as: Listing facts + the buyer's own events; templates are not evidence (ESC-076)
[FOLLOW-1162].

```text
// FOLLOW-1162 / MASTER_DESIGN §E.7.0. This list used to also carry
// `basePlaybook.description`, `.signals`, `slots[].en`, every `variants.en[]` and
// `copy_template.en` — added by FOLLOW-1034 on the reasoning that authored copy is
// authored text and must therefore ground. Under the ESC-076 ruling that is inverted: a
// template cannot know a property, so template text is not evidence about one, and
// leaving it here let a claim authorise itself ("Triple Net Lease" passed because the
// template said it, not because the listing did).
//
// What remains is the listing's own facts, plus the session's recent events — the
// buyer's own words, which are evidence of what the buyer asked, never of the property.
```

#### llm-gateway.ts:900 — `buildDirectiveGroundingText`

Anchor (first code line after the comment): `/**`

Kept in the code as: Fact check for one directive value: canonical digits, then capitalised words
[FOLLOW-457]. @returns A violation reason code, or null when the value is fully grounded.

```text
/**
 * Post-generation fact check for a single directive value (FOLLOW-457 AC2).
 * Descended from generate_description.py `_check_headline_facts`
 * (FOLLOW-169/FOLLOW-272) but DIVERGED by FOLLOW-1034 / ESC-063: numbers are
 * compared by canonical digits rather than typography, and inflection of
 * grounded vocabulary is tolerated via a loose stem applied to BOTH sides. The
 * python sibling carries both corrections as of FOLLOW-1036 (`dc580fdf`) —
 * `_canon_number` / `_stem_loose` in `apps/llm-gateway/src/jobs/generate_description.py`
 * (`:1674`, `:1690`); the divergence this sentence used to record is closed
 * [FOLLOW-1056 AC(9)]. What has NOT been ported, and is deliberately not implied
 * closed here, is the `FACT_CHECK_STOP_CAPS` word-list difference — FOLLOW-1057.
 *
 * 1. Digit tokens are canonicalised (digits + decimal point) on both sides, and
 *    the grounding side is tokenised with the SAME regex before canonicalising —
 *    so a short token like "5" is still never "verified" by matching inside
 *    "425000" or "1,500": those enter the comparison set whole.
 * 2. Capitalised words (including the first word) are checked for a
 *    whole-token match in the grounding text; the stop-caps set filters
 *    generic sentence-starters so they are not falsely flagged.
 *
 * @returns A violation reason code, or null when the value is fully grounded.
 */
```

#### llm-gateway.ts:922 — `buildDirectiveGroundingText`

Anchor (first code line after the comment): `function canonNumber(token: string): string {`

Kept in the code as: Canonical digits of a token: compare facts, not typography [ESC-063].

```text
/**
 * Canonicalise a digit token to what it ASSERTS: digits and the decimal point.
 * "€97,200" and "97200 EUR" both canonicalise to "97200"; "158m²" and "158 m²"
 * to "158"; "6.5%" to "6.5". The check compares facts, not typography —
 * production was discarding grounded prices because the model wrote the
 * thousands separator the context did not have (ESC-063).
 */
```

#### llm-gateway.ts:933 — `canonNumber`

Anchor (first code line after the comment): `function stemLoose(word: string): string {`

Kept in the code as: Case-folded one-suffix English stem, applied to both sides [FOLLOW-1042].

```text
/**
 * Loose stem for grounding comparison: strips one common English suffix so
 * "Maximize" grounds against the playbook description's "maximizing".
 *
 * What is guaranteed [FOLLOW-1042]: this function is applied to both sides, and
 * it is case-folding, so the comparison is case-insensitive and one English
 * suffix deep. What is NOT guaranteed — the previous docblock claimed it, and
 * the claim is what hid the bug through three PRs — is that a value absent from
 * the grounding matches nothing. Identical STEMMING does not imply a safe
 * comparison; that depends on how each side is TOKENISED, and the grounding side
 * used to be split on `[^a-z0-9-]+`, which shredded every accented word into
 * fragments a fabricated name could match. Both sides are now tokenised on the
 * same Unicode word class (see `checkDirectiveFacts`). The residual is narrower
 * but real: this stemmer is English-only, so `pièce`/`pièces` collapse by luck
 * of a shared suffix letter while e.g. `rénover`/`rénovée` do not — a French
 * inflection can still be flagged, and the judge tier exists for that.
 */
```

#### llm-gateway.ts:960 — `stemLoose`

Anchor (first code line after the comment):
`function isTemplateAuthoredValue(playbook: PlaybookEntry, slot: string, value: string): boolean {`

Kept in the code as: Is the value this archetype's own authored copy? Exact, English-only,
fail-closed [FOLLOW-1176]. @param playbook - The archetype's playbook entry, as handed to this
request. @param slot - The directive's slot name. @param value - The directive's value, as the model
returned it. @returns `true` when the value is this archetype's shipped copy for that slot.

```text
/**
 * Is this value the archetype's OWN authored copy for this slot? [FOLLOW-1176]
 *
 * The provenance half of the non-assertive-slot exemption. `isNonAssertiveSlot` answers "may a
 * slot of this KIND assert a property fact", and its answer is evidence about the seventeen CTA
 * strings enumerated in `lib/ungrounded-directives.ts`. This answers the question that predicate
 * cannot: is the string in front of us one of ours, or one the model wrote? Only the first is
 * inside the enumerated population, so only the first inherits its exemption.
 *
 * Matching is trimmed and case-folded and NOTHING else. A paraphrase, an appended clause or a
 * smuggled proper name is a different string and falls through to `judgeNameGrounding`, which is
 * the control designed to adjudicate exactly that. The direction of the looseness is deliberate:
 * a false NEGATIVE here costs one judge round trip, a false positive would ship an unchecked
 * invented name.
 *
 * `variants.en` counts as authored — the bandit's arms are our copy too (`SlotDirective`).
 *
 * **Locale reach, stated because a constant used to be derived from it [FOLLOW-1180].** `en` is
 * the whole population on both sides: the prompt shows the model `s.en` and this compares
 * against `[s.en, ...variants.en]`, and no playbook carries a non-English slot string. So on a
 * non-English listing — where `GROUNDING_RULE` asks the model to quote the context's nouns as
 * written — this predicate returns `false` for a `cta` that is ours in every sense except its
 * language, and the value goes to the judge. That is FAIL-CLOSED and stays: a looser
 * cross-language match would exempt an invented name (FOLLOW-1179), and a localised authored
 * string is a grounding-corpus decision (FOLLOW-1164). What FOLLOW-1180 fixed is the
 * `JUDGE_CALL_BUDGET_TWEAK_BAND` derivation that assumed this returns `true`.
 *
 * @param playbook - The archetype's playbook entry, as handed to this request.
 * @param slot - The directive's slot name.
 * @param value - The directive's value, as the model returned it.
 * @returns `true` when the value is this archetype's shipped copy for that slot.
 */
```

#### llm-gateway.ts:1002 — `checkDirectiveFacts`

Anchor (first code line after the comment): `const groundingNumbers = new Set(`

Kept in the code as: Same regex both sides: "5" never matches inside "425000" [FOLLOW-457].

```text
// Numbers: every digit token in the value must canonicalise to a digit token
// of the grounding. Tokenising the grounding with the SAME regex preserves the
// FOLLOW-457 poisoned-context property: "5" is never verified by the inside of
// "425000", because "425000" enters the set whole.
```

#### llm-gateway.ts:1016 — `checkDirectiveFacts`

Anchor (first code line after the comment):
`const groundingStems = new Set(grounding.split(/[^\p{L}\p{N}-]+/u).map(stemLoose));`

Kept in the code as: Unicode word class: accented words enter whole [FOLLOW-1042].

```text
// FOLLOW-1042: the grounding is tokenised on a UNICODE word class. The previous
// `[^a-z0-9-]+` made every character outside lower-ASCII a delimiter, so each
// accented grounded word entered the set as fragments — `caractère` → `caract` +
// `re`, `propriété` → `propri` + `t` — on exactly the languages this estate serves.
// That broke the check in both directions at once: grounded French/Spanish/Polish
// vocabulary stopped matching its own stem (the ESC-063 false-rejection class), and
// a fabricated name that IS a grounded name minus its accented first letter
// (`Évian` → `Vian`) matched a fragment and passed. `\p{L}` also covers upper-case,
// which the only in-repo caller pre-lower-cases (`buildDirectiveGroundingText`) —
// that half changes nothing today and is deliberate: the property now belongs to
// this function rather than to its caller, so the FOLLOW-1036 Python port inherits
// the property and not the coupling. `-` stays a word character so hyphenated names
// ("Saint-Dizier-les-Domaines") enter whole.
```

#### llm-gateway.ts:1030 — `checkDirectiveFacts`

Anchor (first code line after the comment): `let segmentInitial = true;`

Kept in the code as: Segment-initial capitals carry no proper-name signal [MP-012].

```text
// Segment/sentence-INITIAL capitals carry no proper-name signal: in "X | Y | Z" headlines
// every segment starts capitalised, in any language — [MP-012]'s third act was a fully
// obedient French headline dying on "Potentiel" straight after a "|". A capital is
// name-evidence only MID-segment ("…in Santa Maria's boutique…" is still caught; so are
// "Redland Primary" and "Beaumont Academy", whose second word is mid-segment). Residual,
// accepted and stated: a single-word entity opening a segment is no longer catchable.
```

#### llm-gateway.ts:1041 — `checkDirectiveFacts`

Anchor (first code line after the comment): `if (`

Kept in the code as: `\p{Lu}`, not `[A-Z]`, so accented capitals are checked [FOLLOW-1054].

```text
// FOLLOW-1054: the candidate selector tests `\p{Lu}`, not the ASCII range `[A-Z]`.
//
// What is guaranteed: a word whose first character is an upper-case letter in ANY
// cased script is now compared against the grounding. `É`/`Á`/`Ł`/`Ö` are upper-case
// letters; `[A-Z]` is a 26-codepoint range, so every one of them failed the test and
// the word was `continue`d BEFORE any grounding comparison ran — not "checked and
// passed", never checked. That failed OPEN in a safety check, and the judge tier
// cannot recover it because `judgeNameGrounding` only ever adjudicates values the scan
// REJECTS. This is the value side of the comparison whose GROUNDING side FOLLOW-1042
// moved to Unicode word semantics; both sides now use the same character model.
//
// What is NOT guaranteed, stated rather than implied:
//   1. Case-LESS scripts still contribute no candidates. `\p{Lu}` is empty for Arabic,
//      Hebrew, Chinese, Japanese and Korean, so in those languages the proper-name half
//      of this check is inert. That is a property of the design — a capital IS the
//      proper-name signal here — not of this change, and widening to `\p{L}` would make
//      every word of such a listing a candidate. The number half still applies.
//   2. Title-case digraphs (`\p{Lt}`: `ǅ`, `ǈ`, `ǋ`, `ǲ`) are not candidates. They are
//      31 codepoints that no Latin-script listing writes in practice — the digraph is
//      normally spelled as two characters, whose first IS `\p{Lu}`.
//   3. `FACT_CHECK_STOP_CAPS` is an ASCII English/marketing list, so a generic accented
//      adjective (`Élégant`, `Único`, `Świetny`) is now flaggable mid-segment where it
//      used to be skipped. Measured on the pilot's French listing [FOLLOW-1054 AC(3)]:
//      the set is NOT grown for it. Growing it would start an unbounded per-language
//      word list, which [MP-012] `falsified_means` rules out by name ("a designed
//      ticket, not a bigger word list"), and the two controls that already cover the
//      class are the segment-initial exemption above (an adjective opening a segment is
//      exempt) and the judge tier below (register vocabulary is exactly what it
//      adjudicates).
```

#### llm-gateway.ts:1078 — `checkDirectiveFacts`

Anchor (first code line after the comment): `const boundary = new RegExp(`

Kept in the code as: Unicode lookarounds, not `\b`: no match inside accented words [FOLLOW-1042].

```text
// Exact token match first (pre-1034 behaviour), then the stemmed fallback so
// inflection of grounded vocabulary is not read as an invented entity.
//
// FOLLOW-1042: the delimiters are asserted with `\p{L}\p{N}` lookarounds rather
// than `\b`, for the same reason as the stem tokeniser above — `\b` is ASCII, so
// `\bVian\b` MATCHED inside `évian` (the `é` reads as a word boundary) and the
// fabricated name passed the scan. The judge cannot recover that: it only ever
// adjudicates values the scan REJECTS. This is the only tightening in the change,
// and it bites in exactly one case — the value is a fragment of a longer accented
// grounded word — because every other former `\b` boundary (space, punctuation,
// `-`, string edge) is also a non-`\p{L}\p{N}` position. `_` moves the other way
// (it is a `\b` word character but not a letter), which loosens nothing in
// practice: underscore-delimited fragments — the `signals` names and the
// `listingContext` JSON keys — are already in the stem set either way.
```

#### llm-gateway.ts:1104 — `checkDirectiveFacts`

Anchor (first code line after the comment): `async function judgeNameGrounding(`

Kept in the code as: Judge a proper-name flag; any failure → 'unavailable', rejection stands
[FOLLOW-1034]. @returns 'grounded' | 'ungrounded' | 'unavailable'

```text
/**
 * Semantic adjudication of a `hallucinated_proper_name` flag (FOLLOW-1034 judge tier).
 *
 * The token scan is the high-recall sieve; this is the precision filter on its
 * rejections. It answers one question — does the flagged copy assert a SPECIFIC
 * fact the context does not support — with the whole context in view, which is
 * exactly what a token comparison cannot do (translations, register vocabulary,
 * segment-position capitals; the measured classes are [MP-012]).
 *
 * Authority boundary: numbers are NEVER routed here — `hallucinated_number` is a
 * deterministic reject upstream. Failure posture: any error or unparseable
 * verdict returns 'unavailable' and the caller keeps the rejection (fail closed).
 *
 * Time posture [FOLLOW-1040]: bounded by `JUDGE_DEADLINE_MS`. Expiry is not a new
 * outcome to the CALLER — it lands in the SAME catch as an API error and returns
 * 'unavailable', so a slow judge and a broken judge are indistinguishable to the caller
 * by design. Internally, this function DOES split them — see `JUDGE_VERDICT_SOURCE`.
 *
 * @returns 'grounded' | 'ungrounded' | 'unavailable'
 */
```

#### llm-gateway.ts:1145 — `judgeNameGrounding`

Anchor (first code line after the comment): `const controller = new AbortController();`

Kept in the code as: This race bounds the total; the abort stops spend [FOLLOW-1040].

```text
// FOLLOW-1040: enforce the deadline HERE rather than delegating to the Anthropic
// SDK's `timeout` request option. That option bounds one ATTEMPT and the SDK retries
// by default, so it bounds no total; this race does. The AbortController is not
// decoration — it cancels the in-flight HTTP request, so a judge call this gateway
// has stopped waiting for also stops burning tokens.
```

#### llm-gateway.ts:1152 — `judgeNameGrounding`

Anchor (first code line after the comment): `const deadlineState = { exceeded: false };`

Kept in the code as: Only place a timeout is distinguishable; object for eslint [FOLLOW-1041].

```text
// FOLLOW-1041: only the deadline timer can tell a timeout apart from any other
// rejection of the raced promise — by the time `catch` runs below, both look like
// an ordinary thrown error. This flag is the sole place that distinction survives.
// An object property, not a bare `let`: a bare boolean reassigned only inside the
// setTimeout closure below gets over-narrowed by eslint's flow analysis to its
// initial literal, which makes the ternary in `catch` read as "always falsy".
```

#### llm-gateway.ts:1169 — `judgeNameGrounding`

Anchor (first code line after the comment):
`const logVerdict = (source: string, tokensIn: number, tokensOut: number, latencyMs: number) => {`

Kept in the code as: One logging point for every judge outcome [FOLLOW-1041].

```text
// FOLLOW-1041: one shared logging point for every outcome this function can reach —
// success (any verdict, including a malformed reply) and failure (timeout or error)
// all funnel through here so `JUDGE_VERDICT_SOURCE` can never be picked in one place
// and applied in another.
```

#### llm-gateway.ts:1208 — `judgeNameGrounding`

Anchor (first code line after the comment): `let parsed: unknown = null;`

Kept in the code as: Unparseable reply = `_unavailable_malformed`, real tokens [FOLLOW-1049].

```text
// FOLLOW-1049: the regex above matches shapes `JSON.parse` rejects — a python-style
// `True`, a trailing comma, a bare word — and all three are things a model actually
// emits. Unguarded (as #793 shipped it) that throw escaped to the outer catch and was
// booked as `_unavailable_error`, the NETWORK bucket, with `0, 0` tokens: two wrong
// facts about a call the API had answered and Anthropic had billed. A reply that
// arrives and does not parse is `_unavailable_malformed` by that constant's own
// docblock, and its spend is real. Swallowing to `null` reaches both, because the
// `grounded === undefined` path below already logs the malformed verdict with the
// tokens and latency still in hand.
```

#### llm-gateway.ts:1230 — `judgeNameGrounding`

Anchor (first code line after the comment): `if (grounded === true) {`

Kept in the code as: Judge rows carry their own source and verdict [FOLLOW-1041].

```text
// Spend is spend (FOLLOW-431): the judge's ClickHouse row carries its own source so
// nobody mistakes adjudication cost for generation cost — and, as of FOLLOW-1041,
// the verdict itself, so `overrides ÷ flags` is a query (see JUDGE_VERDICT_SOURCE).
```

#### llm-gateway.ts:1248 — `judgeNameGrounding`

Anchor (first code line after the comment): `logVerdict(`

Kept in the code as: Timeout vs error split; `0, 0` means UNKNOWN [FOLLOW-1041, FOLLOW-1049].

```text
// FOLLOW-1041: the split the caller deliberately does not get (FOLLOW-1040 — both
// land in the same 'unavailable' return) happens here instead, because this is the
// only place `deadlineState.exceeded` is still known.
//
// The `0, 0` below means UNKNOWN, not zero [FOLLOW-1049]. We never received a usage
// block on this path, so this client cannot know what was billed — and on the timeout
// branch it probably was: `controller.abort()` closes our socket, it does not un-bill a
// completion the provider already generated. Reading these rows as free is therefore
// wrong in the one direction that matters to the rolling-24h $100 breaker
// (the Upstash daily counter), which under-counts by exactly this amount. It is left at zero
// rather than estimated because an invented number is worse than a known-absent one; if
// the judge's timeout rate ever becomes material, the fix is to bound the estimate from
// the prompt size, not to guess. Parse failures are NOT in this bucket any more — they
// carry their real cost via the malformed branch above.
```

#### llm-gateway.ts:1276 — `judgeNameGrounding`

Anchor (first code line after the comment):
`function computeCost(model: string, tokensIn: number, tokensOut: number): number {`

Kept in the code as: ── Compute cost ──

```text
// ---------------------------------------------------------------------------
// Compute cost
// ---------------------------------------------------------------------------
```

#### llm-gateway.ts:1286 — `computeCost`

Anchor (first code line after the comment): `let _client: Anthropic | null = null;`

Kept in the code as: ── Main gateway function ──

```text
// ---------------------------------------------------------------------------
// Main gateway function
// ---------------------------------------------------------------------------
```

#### llm-gateway.ts:1311 — `getClient`

Anchor (first code line after the comment):
`export async function callLlmGateway(input: LlmGatewayInput): Promise<LlmGatewayOutput | null> {`

Kept in the code as: Generate or tweak directives; null on any failure, reason via
`input.onFallback` [FOLLOW-1056].

```text
/**
 * Call the LLM gateway to generate or tweak adaptation directives.
 *
 * Returns null on: missing API key, circuit breaker triggered ($100/day cap),
 * an unusable reply, a FOLLOW-457 fact-check rejection, or any Anthropic API error.
 *
 * The caller is responsible for falling back to playbook directives on null. `null` alone does
 * not say WHICH of those happened, and two of them are opposites — pass `input.onFallback` to
 * receive the reason (FOLLOW-1056). Every exit also writes its own `llm_calls` row: before that
 * ticket only two of six did, and they shared one `source`.
 */
```

#### llm-gateway.ts:1323 — `callLlmGateway`

Anchor (first code line after the comment): `const fallback = (`

Kept in the code as: Every null exit reports its reason here [FOLLOW-1056].

```text
// FOLLOW-1056: every `null` exit below goes through here, so the reason cannot be reported at
// one exit and forgotten at the next five. Returns `null` so each call site stays a one-liner
// and no exit can report a reason without also returning.
```

#### llm-gateway.ts:1329 — `callLlmGateway`

Anchor (first code line after the comment): `const effective =`

Kept in the code as: An ungroundable prompt is not an LLM outage [FOLLOW-1120, MP-017].

```text
// FOLLOW-1120: an ungroundable prompt is not an LLM outage, and collapsing the two is what
// sent a session's diagnosis at the Anthropic key while the key was healthy — the production
// signature that established it is [MP-017]. Narrow ONLY the
// `llm_unavailable` arm: `fact_check_refused` means the model produced parseable directives
// that the grounding check then rejected, which is the pipeline working and is a different
// fact about a different failure.
```

#### llm-gateway.ts:1348 — `callLlmGateway`

Anchor (first code line after the comment): `let model: string;`

Kept in the code as: Model: forceModel, then Haiku on the tweak band, then the admin model
[FOLLOW-161].

```text
// Select model using precedence chain:
//   1. forceModel (DEMO MODE, DEMO-001) — bypasses all routing.
//   2. Haiku (low-latency tweak path) — when 0.6 < similarity ≤ 0.85.
//      This path is NOT affected by the global config (FOLLOW-161):
//      it is the real-time latency-sensitive path; its model is not selectable.
//   3. getGlobalGenerationModel() (FOLLOW-161) — admin-configured global default
//      for the full-generation path (similarity ≤ 0.6).
```

#### llm-gateway.ts:1363 — `callLlmGateway`

Anchor (first code line after the comment): `model = await getGlobalGenerationModel();`

Kept in the code as: Returns the default when the config DB is down [FOLLOW-161].

```text
// Full-generation path — use admin-configured global default (FOLLOW-161).
// getGlobalGenerationModel() returns the default on DB absence/error, so
// this path never hard-fails even when config DB is unavailable.
```

#### llm-gateway.ts:1376 — `callLlmGateway`

Anchor (first code line after the comment): `return fallback('llm_unavailable');`

Kept in the code as: No call, no row; mirrors the route's `source` on this path.

```text
// No Anthropic call was made, so there is no spend to book and no `llm_calls` row to
// write. `llm_unavailable` mirrors the `source` the route already returns on this path
// (see `onFallback`'s docblock on the unwired `playbook_fallback_llm_capped`).
```

#### llm-gateway.ts:1407 — `callLlmGateway`

Anchor (first code line after the comment):
`const logGeneration = (outcome: GenerationOutcome) => {`

Kept in the code as: One logging point for every outcome below [FOLLOW-1056].

```text
// FOLLOW-1056: one shared logging point for every outcome reachable from here, the same
// containment `logVerdict` gives the judge. Before this, two of the five exits below wrote a
// row and three wrote nothing at all, while the model had been called and billed on all five.
```

#### llm-gateway.ts:1426 — `callLlmGateway`

Anchor (first code line after the comment): `const logFreeRow = (source: string) => {`

Kept in the code as: Zero-cost row: these zeros are measured, not unknown [FOLLOW-1183,
FOLLOW-1312].

```text
/**
 * Book one zero-cost row: a `FACT_CHECK_UNJUDGED_SOURCE` row, a proper-name flag the judge
 * never saw [FOLLOW-1177 / FOLLOW-1183], or a `factCheckSlotRefusedSource` row, one refused
 * slot [FOLLOW-1312].
 *
 * Separate from `logGeneration` because it must NOT inherit the generation call's tokens,
 * cost or latency: this row's zeros are measured, not unknown. Nothing was called, so
 * nothing was billed and nothing was waited on — see `FACT_CHECK_UNJUDGED_SOURCE`.
 */
```

#### llm-gateway.ts:1455 — `callLlmGateway`

Anchor (first code line after the comment): `logGeneration('unavailable_malformed');`

Kept in the code as: Billed and unusable: tokens are real here [FOLLOW-1049].

```text
// Billed and unusable. The tokens here are REAL (the usage block arrived), unlike the
// `catch` below — that distinction is the whole of FOLLOW-1049 and it applies to this
// path too: record what is known, say UNKNOWN only where it is not.
```

#### llm-gateway.ts:1476 — `callLlmGateway`

Anchor (first code line after the comment): `const grounding = buildDirectiveGroundingText(input);`

Kept in the code as: Refuse ungrounded slots, serve the rest; numbers final, names judged
[FOLLOW-1034, FOLLOW-1312].

```text
// FOLLOW-457 AC2/AC3: refuse any directive whose value asserts a specific fact (number,
// proper name) absent from the trusted grounding sources. Rule K.2: log + Sentry so the
// suppression is observable. The cost was still incurred (Anthropic was called), so the
// ClickHouse spend log below still runs. FOLLOW-1312 (CEO ruling 2026-10-11): the refused
// SLOT is dropped and the grounded slots are served (`slotRefusal`); only when every slot is
// refused does this return null and the caller (runDecisionTree) take its fallback.
//
// FOLLOW-1034 judge tier: [MP-012]'s falsification condition fired — three
// token-level fixes and two prompt passes took the prod pass rate from 0% to
// only ~33%, because generic-vocabulary false positives are an unbounded set
// (any language, any register). The split of authority is deliberate:
//   - `hallucinated_number` stays a DETERMINISTIC reject. Figures are the
//     compliance-critical half (a wrong area or an invented yield), their
//     semantics are exact, and the canonical-digit check has no false-positive
//     class left — no model gets to overrule it.
//   - `hallucinated_proper_name` becomes a high-recall FLAG adjudicated by a
//     Haiku judge that sees the whole context and the flagged copy. The judge
//     runs ONLY on the path that today ends in a fallback anyway, so its cost
//     and latency price a recovery, not the happy path. Any judge failure —
//     API error, malformed verdict — fails CLOSED to the pre-judge behaviour.
//
// FOLLOW-1040 — the judge is awaited SERIALLY inside the loop below, so its cost is
// per-flagged-directive, not per-request. Two bounds make that cost finite and
// independent of the schema: `JUDGE_DEADLINE_MS` per call and `judgeCallBudget(model)`
// calls per request. Both fail CLOSED.
```

#### llm-gateway.ts:1503 — `callLlmGateway`

Anchor (first code line after the comment):
`const claimGrounding = buildClaimGrounding(input.listingContext);`

Kept in the code as: Deterministic scan first; exemptions by PROVENANCE only; numbers/claims never
exempt [FOLLOW-1176, FOLLOW-1305].

```text
// FOLLOW-1178 — the DETERMINISTIC half runs first, over every directive, before any judge
// call. It is pure and cheap (a token scan plus a lookup in this request's own playbook),
// and running it up front is what lets the loop below know how many adjudications this
// batch actually needs before it spends the first one.
//
// Rule BC: this MOVES the exemption's call site, it does not add one. `isNonAssertiveSlot`
// and `isTemplateAuthoredValue` still have exactly one consumer between them, fed by
// exactly the population #877 bounded (this request's model output against this request's
// playbook), so #877's enumeration argument still covers everything the predicates see.
//
// FOLLOW-1173 — a slot that asserts nothing about the property cannot assert a hallucinated
// proper name about it. `isNonAssertiveSlot` is `ungrounded-directives.ts`'s own predicate,
// the one #871's withhold rule uses to serve a `cta` ungrounded on the template paths; the
// two controls used to disagree about that slot in opposite directions and the disagreement
// cost a judge round trip on EVERY request. Deliberately NOT a `FACT_CHECK_STOP_CAPS` entry:
// [MP-012] rules out treating an open class as a word list, and `Pack` would not survive the
// next playbook re-authoring. Numbers are untouched for every slot — `Get 6.2% Yield Report`
// is a CTA that DOES assert a property fact, and the canonical-digit check keeps it.
//
// FOLLOW-1176 — and the slot alone is not enough to earn it. `isNonAssertiveSlot` is
// justified by an ENUMERATION of the seventeen CTA strings WE authored, while this is
// the predicate's only consumer and every value it sees is written by the MODEL: two
// populations that do not intersect (Rule BC). Post-#873 the model reproduces the
// archetype's own CTA verbatim, which is what made the exemption look total — but
// `Book a Viewing with Knight Frank` and `Download the Marina Heights Yield Report` are
// also CTAs, and #875 served them unchecked because the exemption skipped the judge tier
// as well as the scan. So the exemption is keyed on PROVENANCE, which is the distinction
// the evidence actually supports: authored copy keeps it, anything else is adjudicated by
// `judgeNameGrounding` rather than assumed safe. On the Sonnet band that is nearly every
// `cta`, because `buildSonnetPrompt` never shows the model the authored string.
//
// FOLLOW-1180 — and on a NON-ENGLISH listing it is nearly every `cta` on the Haiku band
// too. Both halves of the exemption are English-only by construction (`buildHaikuPrompt`
// shows `s.en`; this predicate matches `[s.en, ...variants.en]`), so a model obeying
// `GROUNDING_RULE`'s "do not translate its nouns — quote them as written" writes a `cta`
// no authored string can match. That is a property of the grounding CORPUS, not of this
// predicate, and it is deliberately left here: matching a French output loosely against an
// English template would exempt an invented name (FOLLOW-1179). What it changed is the
// BUDGET above, which no longer assumes the exemption fires.
//
// FOLLOW-1251 — the second provenance exemption: our own reviewed `feature` section label
// (`yield_hunter` → `Investment Performance`). `buildHaikuPrompt` shows it to the model as a
// base directive, the model repeats it, neither word is in any listing, and the judge then
// correctly finds it ungrounded in the LISTING — so one heading WE wrote discarded the whole
// batch (README §5.15 run 2). A label comes from us, not from the model or the seller, so it
// is grounded by construction. It clears ONLY a proper-name flag on the exact reviewed string
// (`isAuthoredSectionLabel`): a figure is never exempt, a label with anything appended is
// model copy and is judged, and the label never enters `grounding`, so it cannot vouch for
// any other directive's words. The four `feature` strings that ARE property claims are not
// in the reviewed map and stay ordinary copy. Since FOLLOW-1312 a rejection refuses its own
// slot only; the exempt label is still served beside it.
//
// FOLLOW-1305 (FOLLOW-820 condition 1c, Codex F-02) — the claim classes the digit rule
// cannot see: an amenity, a guarantee or a unit the LISTING does not support
// (`claim-containment.ts`). Deterministic like `hallucinated_number`: no judge can clear it,
// and no provenance exemption reaches it — an authored label or CTA that names a pool on a
// listing without one asserts a pool. Precedence per slot: number, then claim, then the
// (judgeable) proper-name flag.
```

#### llm-gateway.ts:1581 — `callLlmGateway`

Anchor (first code line after the comment): `const refuseSlot = (`

Kept in the code as: One refusal path per refused slot [FOLLOW-1312].

```text
// One refusal path for every refused SLOT below — deterministic or judge-confirmed — so the
// warn line, the Sentry event and the slot's `fact_check_slot_refused_*` row cannot drift
// apart [FOLLOW-1312]. The generation row is booked once, after the policy has decided.
```

#### llm-gateway.ts:1600 — `callLlmGateway`

Anchor (first code line after the comment): `for (const { exempt } of scanned) {`

Kept in the code as: An exemption books a row, only where the scan flagged [FOLLOW-1177].

```text
// FOLLOW-1177 — the exemption is a DISPOSITION of a flag, so it books one. Before this the
// branch cleared the flag and wrote nothing anywhere: no judge row, no rejection row, no
// warn, no Sentry event. The flag simply left MP-012's denominator, which turned
// `overrides ÷ flags` into a rate over the non-exempt slots only, and made a green
// FOLLOW-1022 canary weaker evidence about the CTA axis than the same green had been
// before — a change in what a green MEANS, recorded nowhere.
//
// The row is written only where `exempt` is true, which is a conjunction that INCLUDES the
// scan having flagged the value. That is the whole design constraint: "the scan flagged it
// and the slot is exempt" and "the scan never flagged it" are the two worlds a served batch
// cannot distinguish, and a counter that could not separate them would restate the problem
// rather than close it (MP-012's `watch_status`). A row means the first; no row means the
// second. It also makes FOLLOW-1179 visible: an archetype whose authored `cta` carries a
// `{token}` can never satisfy `isTemplateAuthoredValue`, and its flags show up in the
// judge's register instead of here.
```

#### llm-gateway.ts:1619 — `callLlmGateway`

Anchor (first code line after the comment): `const judgeBudget = judgeCallBudget(model);`

Kept in the code as: Over budget: flagged slots refused unjudged, others served [FOLLOW-1178,
FOLLOW-1312].

```text
// FOLLOW-1178 — a flag the judge never sees keeps its rejection. When a batch carries more
// proper-name flags than the budget can adjudicate, adjudication is skipped for ALL of them:
// the cost is bounded at zero round trips instead of `budget × JUDGE_DEADLINE_MS` of a buyer's
// wait — the shape RETRO-320 measured. Before FOLLOW-1312 that skip was outcome-neutral (one
// surviving flag discarded the whole batch anyway). Under the per-slot policy it is a stated
// LATENCY choice, not a neutral one: every flagged slot is refused unjudged, and the unflagged
// slots of the same batch are still served.
```

#### llm-gateway.ts:1640 — `callLlmGateway`

Anchor (first code line after the comment):
`logFreeRow(FACT_CHECK_UNJUDGED_SOURCE.overBudget(flaggedSlots.length));`

Kept in the code as: A row, not just a log: budget binding is a query [FOLLOW-1183].

```text
// FOLLOW-1183 — and not a log-only skip either. The line above lives inside a retention
// window and names slots; this row makes "how often does the budget bind, per band" a
// ClickHouse query, which is what FOLLOW-1165 AC(2) asks for and what #880 removed by
// taking the last judge row an over-budget batch used to leave. It carries the count of
// flags that go unadjudicated, so MP-012's denominator can be re-opened rather than
// merely caveated — see `FACT_CHECK_UNJUDGED_SOURCE`.
```

#### llm-gateway.ts:1649 — `callLlmGateway`

Anchor (first code line after the comment): `const verdicts: {`

Kept in the code as: Deterministic verdicts are final; judge the rest within budget [FOLLOW-1305,
FOLLOW-1312].

```text
// FOLLOW-1305 — the DETERMINISTIC verdicts (number, amenity, guarantee, unit) are final: no
// judge call is ever made for a slot that carries one. FOLLOW-1312 — and they no longer
// short-circuit the batch: the judge still runs for the OTHER slots' proper-name flags,
// because under the per-slot policy a cleared flag is a served slot. The judge runs ONLY for
// flagged slots, serially, within `judgeBudget`.
```

#### llm-gateway.ts:1667 — `callLlmGateway`

Anchor (first code line after the comment): `console.info(`

Kept in the code as: Debugging aid only; the override row is already written [FOLLOW-1041].

```text
// Rule AJ, not Rule K.2 [FOLLOW-1041] — K.2 only requires this console.info to
// fire at all (a producer-side obligation it already met); it does not make the
// override COUNTABLE. `judgeNameGrounding` already wrote the countable signal —
// a `fact_check_judge_override` row (`JUDGE_VERDICT_SOURCE`) — before returning
// this verdict, so `overrides ÷ flags` answers from ClickHouse. This line is a
// human-debugging aid only; see docs/ops/MEASURED_PREMISES.md MP-012.
```

#### llm-gateway.ts:1691 — `callLlmGateway`

Anchor (first code line after the comment): `logGeneration('fact_check_rejected');`

Kept in the code as: Every slot refused: own generation source [FOLLOW-1312, FOLLOW-1056].

```text
// Every slot refused: the request is refused exactly as before FOLLOW-1312. FOLLOW-1056:
// its OWN generation source, so the whole-batch refusal rate stays a query ([MP-012]
// `measure_with` (1)); the slot names are on the `fact_check_slot_refused_*` rows above.
```

#### llm-gateway.ts:1707 — `callLlmGateway`

Anchor (first code line after the comment): `logGeneration('served');`

Kept in the code as: 'served' even with refused slots; after() keeps the write alive [FOLLOW-431,
FOLLOW-1312].

```text
// Log to ClickHouse (fire-and-forget).
// FOLLOW-431 / ESC-033: registered via after() so the async write (and its
// fail-loud .then/.catch → Sentry) completes after the response is sent.
// afterResponse() is called here (inside the awaited callLlmGateway) rather than at
// the route call site — the async context flows from the route handler through
// callLlmGateway, so the request scope is still active here. Outside a request scope
// (unit tests calling callLlmGateway directly) afterResponse falls back to fire-and-forget.
// FOLLOW-1312: 'served' also when some slots were refused — the spend bought served copy;
// the refused slots are on their own rows.
```

#### llm-gateway.ts:1728 — `callLlmGateway`

Anchor (first code line after the comment): `afterResponse(() =>`

Kept in the code as: API-error exit writes its own row; `0, 0` = UNKNOWN [FOLLOW-1056, FOLLOW-1049].

```text
// FOLLOW-1056: the exit that produced `playbook_fallback_llm_unavailable` and wrote NOTHING,
// so the failure mode [MP-010] names could be seen only by a CI canary firing in the same
// minute or a Vercel log line inside a retention window. The production counterfactual that
// established this is [MP-010]'s 2026-08-20 addendum — it is not restated here.
//
// `logGeneration` is not in scope here — it closes over a usage block this path never
// received — so the row is written directly, and the argument for the zeros is FOLLOW-1049's
// verbatim: **`0, 0` means UNKNOWN, not zero.** No usage block arrived, so this client cannot
// know what was billed, and on a request the API had already started answering it probably
// was billed something. Reading these rows as free under-counts the rolling-24h $100 breaker
// (the Upstash daily counter) by exactly that amount. Left at zero rather than estimated because
// an invented number is worse than a known-absent one; if this error rate ever becomes
// material the fix is to bound the estimate from the prompt size, not to guess. The LATENCY
// is known and is recorded — a failed call still consumed the buyer's wait.
```

### `packages/sdk/src/core/intent.ts`

#### intent.ts:1 — module header

Anchor (first code line after the comment): `import type { IntentWeights } from '@estalara/shared';`

Kept in the code as: Intent Engine — pure, never-throwing Bayesian archetype classifier; history in
ADR-0024. @module @estalara/sdk/core/intent

```text
/**
 * Intent Engine — Bayesian archetype classifier.
 *
 * Archetypes: 18 fine-grained buyer/investor personas
 *
 * Prior sources (in decreasing strength):
 *   1. Quiz answers (explicit self-declaration, full likelihood applied)
 *   2. Behavioral signals (implicit, multiplied by BEHAVIORAL_DAMPING)
 *      - Scroll depth, listing views, CTA clicks, etc.
 *
 * Decay: probabilities move toward the uniform distribution (1/18 each) at the
 * configured rate per minute. Without new evidence the classifier loses
 * confidence and returns to neutral over time.
 *
 * All public functions are pure: they return a new state without mutating
 * the input. Functions never throw — degenerate input (NaN, zero sum) is
 * sanitized to the uniform distribution.
 *
 * @module @estalara/sdk/core/intent
 */
```

#### intent.ts:103 — `IntentState`

Anchor (first code line after the comment): `dwell_ticks_applied?: number;`

Kept in the code as: Dwell ticks already applied, persisted so rehydration never re-boosts (Rule R)
[FOLLOW-227].

```text
/**
 * Number of dwell-time threshold ticks whose boost has already been folded into
 * this state (FOLLOW-227 Rule R idempotency field).
 *
 * This field is persisted to sessionStorage via `persistIntentState` and
 * rehydrated on the next listing page in the same tab.  `startDwellTimer` reads
 * it on every tick and skips any boost that has already been applied, so a
 * rehydrated state is never re-boosted and the total cross-session contribution
 * cannot exceed `DWELL_MAX_SESSION_CONTRIBUTION`.
 *
 * Optional / defaults to 0 so that states persisted before FOLLOW-227 remain
 * valid — `isValidIntentState` does not require this field.
 */
```

#### intent.ts:117 — `IntentState`

Anchor (first code line after the comment): `chatPriorApplied?: boolean;`

Kept in the code as: Chat ever folded; fallback gate for unstamped records (Rule R) [FOLLOW-252,
FOLLOW-1024].

```text
/**
 * Rule R: chat-intent prior idempotency marker (FOLLOW-252).
 *
 * Set to `true` by `applyChatIntentPrior` (via `fetchDirectives`) once a chat-intent
 * dimension map has been folded into this distribution. Persisted to sessionStorage so it
 * survives a hard page reload within the 24h Redis shadow-key window.
 *
 * ⚠️ **Since FOLLOW-1024 this flag no longer BLOCKS a fold on its own.** It used to: once
 * true, chat evidence was ignored for the rest of the session. The watermark below is the
 * real gate now; this field remains as the fallback for a shadow record that carries no
 * `detected_at` (pre-FOLLOW-1024 writer), where the old once-per-session behaviour is still
 * the only safe reading, and as the "has chat ever spoken here" signal for analytics.
 *
 * Cleared to `false` (or absent) by `resetAdaptState()` / session teardown.
 *
 * Optional / defaults to `false` so states persisted before FOLLOW-252 remain
 * valid — `isValidIntentState` does not require this field.
 */
```

#### intent.ts:136 — `IntentState`

Anchor (first code line after the comment): `chatPriorAppliedAt?: string;`

Kept in the code as: `detected_at` of the last folded chat extraction (Rule R) [FOLLOW-1024].

```text
/**
 * Per-message chat-prior watermark: the `detected_at` of the last extraction folded in
 * (FOLLOW-1024, CEO ruling 2026-08-18).
 *
 * **Why this replaced a boolean.** A buyer clicks through the quiz without reading it, or
 * answers it with the property they *think* they want. Their real need surfaces in the
 * questions they then ask. Sampling that conversation at message one — which is what
 * `chatPriorApplied` did — throws away exactly the evidence that is worth the most. Folding
 * every message instead lets the posterior move as the conversation reveals intent.
 *
 * Rule R still holds, because the requirement was never "fold once per session" — it was
 * "never count the SAME extraction twice", which a stamp enforces precisely. The shadow key
 * is returned on EVERY adapt call for 24h, so without a watermark the same evidence would
 * be multiplied in on every page view and the posterior would saturate on one message.
 *
 * Advances only for a signal-bearing message: `write_shadow_intent` replaces the record
 * only when the extraction carried a usable dimension (ADR-0020 D3), so "hi" and failed
 * extractions never move it.
 *
 * Optional — absent on states persisted before FOLLOW-1024 and whenever the server sent no
 * stamp; `isValidIntentState` does not require it.
 */
```

#### intent.ts:159 — `IntentState`

Anchor (first code line after the comment):
`chat_mismatch?: { quiz_archetype: Archetype; chat_archetype: Archetype };`

Kept in the code as: Confident quiz-vs-chat disagreement; metadata, not an override [FOLLOW-100].

```text
/**
 * Quiz-vs-chat archetype disagreement metadata (FOLLOW-100).
 *
 * Set by `applyChatIntentPrior` when the chat-derived leading archetype differs
 * from the quiz-declared archetype and BOTH sources are confident
 * (chat_confidence > 0.7 AND state.quiz_answered). Consumed downstream (FOLLOW-101
 * bridge) to surface a quiz/chat conflict signal. Absent when there is no mismatch.
 *
 * This is observable metadata, not a silent override — `applyChatIntentPrior` still
 * returns the chat-updated distribution; the field merely records the disagreement.
 */
```

#### intent.ts:175 — `IntentState`

Anchor (first code line after the comment): `export const SWITCH_MARGIN = 0.05;`

Kept in the code as: Hysteresis margin against near-tie churn; not raised before calibration
[FOLLOW-344].

```text
/**
 * Hysteresis margin for archetype switching (FOLLOW-344).
 *
 * The current archetype is retained unless the new leading archetype beats it
 * by at least this margin in the posterior distribution:
 *   posterior[newLeader] - posterior[currentArchetype] >= SWITCH_MARGIN
 *
 * Rationale: argmax flips on near-ties produce adaptation churn when the
 * distribution is flat (e.g. two archetypes at 0.14 vs 0.13). A small Δ
 * prevents cycle-to-cycle flipping without materially delaying a genuine shift.
 *
 * Starting value: 0.05. Calibrate post-pilot once ≥500 labelled sessions are
 * available (FOLLOW-212 — BEHAVIORAL_DAMPING + SIGNAL_LIKELIHOODS calibration).
 * Do NOT increase before calibrated likelihoods cover all 17 archetypes.
 */
```

#### intent.ts:192 — `SWITCH_MARGIN`

Anchor (first code line after the comment): `export const BASE_PRIOR: ArchetypeProbabilities = {`

Kept in the code as: Prior before any evidence; exported for the drift gate, readonly [FOLLOW-331].

```text
/**
 * Base prior — before any evidence is observed.
 *
 * Distribution rationale:
 *   6 investor archetypes × 0.04 = 0.24
 *   6 own-use archetypes  × 0.04 = 0.24
 *   5 special archetypes  × 0.03 = 0.15
 *   neutral                       = 0.37 (default before signals)
 *   Total                         = 1.00
 *
 * Exported for the cross-package drift gate in
 * `packages/sdk/src/__tests__/intent-weights-drift.test.ts` (FOLLOW-331).
 * Runtime behavior is unchanged — this constant remains the SDK's SoT.
 * Do NOT mutate; treat as readonly.
 */
```

#### intent.ts:232 — `BASE_PRIOR`

Anchor (first code line after the comment):
`function makeLikelihood(overrides: Partial<ArchetypeProbabilities>): ArchetypeProbabilities {`

Kept in the code as: Likelihood at 1.0 (no information) except the overrides.

```text
/**
 * Build a likelihood object with all archetypes at 1.0 (no information),
 * overriding specific archetypes for targeted behavioral signals.
 */
```

#### intent.ts:243 — `makeLikelihood`

Anchor (first code line after the comment):
`const SIGNAL_LIKELIHOODS: Record<string, ArchetypeProbabilities> = {`

Kept in the code as: Behavioural likelihoods, damped: > 1 favours, < 1 disfavours.

```text
/**
 * Behavioral signal likelihoods — multiplicative weights applied (after damping).
 * Values > 1.0 favor the archetype; < 1.0 disfavor it; 1.0 = no information.
 */
```

#### intent.ts:263 — `SIGNAL_LIKELIHOODS`

Anchor (first code line after the comment):
`'listing.bookmarked': makeLikelihood({ neutral: 0.7 }),`

Kept in the code as: High intent; payload boosts live in applyBehavioralSignal().

```text
// listing.bookmarked — saving a listing = high intent; strongly pushes away from neutral.
// Payload-conditional boosts (bedroomCount, listingType) are applied additively in
// applyBehavioralSignal() — they cannot be encoded in a static likelihood table.
```

#### intent.ts:311 — `SIGNAL_LIKELIHOODS`

Anchor (first code line after the comment): `'photo.dwell': makeLikelihood({`

Kept in the code as: Lifestyle signal (luxury, second home, expat), damped [FOLLOW-100].

```text
// photo.dwell — sustained dwell on listing photos (gallery hover/zoom). Soft behavioral
// signal: over-indexes for buyers who shop on lifestyle/aesthetics (luxury, second home,
// expat). Full BEHAVIORAL_DAMPING treatment per §D.7 — not a quiz-equivalent (FOLLOW-100).
```

#### intent.ts:320 — `SIGNAL_LIKELIHOODS`

Anchor (first code line after the comment): `'feature.expanded': makeLikelihood({ neutral: 0.85 }),`

Kept in the code as: Base neutral push; payload.feature boosts are in applyBehavioralSignal().

```text
// feature.expanded — base neutral-push entry (FOLLOW-100). The discriminating boosts are
// payload-conditional (payload.feature) and applied in applyBehavioralSignal(); they cannot
// be encoded in a static table. An unrecognized feature value gets this base push only.
```

#### intent.ts:324 — `SIGNAL_LIKELIHOODS`

Anchor (first code line after the comment): `'mortgage_calc.used': makeLikelihood({`

Kept in the code as: Own-use financing signal (first-time, family) [FOLLOW-100].

```text
// mortgage_calc.used — engagement with the mortgage calculator. Strong own-use financing
// signal: first-time and family buyers run affordability numbers; investors rarely do
// (cash / commercial finance) (FOLLOW-100).
```

#### intent.ts:341 — `SIGNAL_LIKELIHOODS`

Anchor (first code line after the comment): `'inquiry.started': makeLikelihood({ neutral: 0.7 }),`

Kept in the code as: General intent, no discriminator: pushes away from neutral [FOLLOW-100].

```text
// inquiry.started — began filling an inquiry/contact form. High general intent but no
// archetype discriminator on its own: it pushes the whole distribution away from neutral
// without favouring any single persona (FOLLOW-100).
```

#### intent.ts:347 — `SIGNAL_LIKELIHOODS`

Anchor (first code line after the comment): `const CHAT_REST_LIKELIHOOD = 0.05;`

Kept in the code as: Floor for unnamed archetypes, so named ones dominate (§D.1.1) [FOLLOW-100].

```text
/**
 * Likelihood assigned to every archetype NOT named in a `CHAT_INTENT_LIKELIHOODS` entry.
 *
 * Master Design §D.1.1 lists chat intent likelihoods P(dimension=value | archetype) only for
 * the archetypes a dimension discriminates. For a proper Bayesian posterior update those listed
 * values must dominate the *complement* — the unnamed archetypes (including the high-prior
 * `neutral`) must take a LOW likelihood, (favored ≈ 0.8,
 * unfavored ≈ 0.05). A `makeLikelihood`-style 1.0 default would instead PENALISE the named
 * archetypes (every listed value is < 1.0), so a single strong dimension could never make its
 * archetype dominant — contradicting §D.1.1 ("strong prior") and FOLLOW-100 AC-7. We therefore
 * default unnamed archetypes to this low floor so chat intent behaves like the quiz prior.
 */
```

#### intent.ts:361 — `CHAT_REST_LIKELIHOOD`

Anchor (first code line after the comment):
`function makeChatLikelihood(overrides: Partial<ArchetypeProbabilities>): ArchetypeProbabilities {`

Kept in the code as: Named archetypes keep their §D.1.1 value; others get the floor.

```text
/**
 * Build a chat-intent likelihood: named archetypes keep their §D.1.1 value; every other
 * archetype takes the low `CHAT_REST_LIKELIHOOD` floor (NOT 1.0 — see CHAT_REST_LIKELIHOOD).
 */
```

#### intent.ts:372 — `makeChatLikelihood`

Anchor (first code line after the comment):
`export const CHAT_INTENT_LIKELIHOODS: Record<string, ArchetypeProbabilities> = {`

Kept in the code as: §D.1.1 chat likelihoods keyed "dimension=value", undamped [FOLLOW-087].

```text
/**
 * Chat-intent likelihoods — P(dimension=value | archetype) for the 12-dimension chat
 * intent vector produced by the chat NLP path (FOLLOW-087 / Master Design §D.1.1).
 *
 * Keyed by `"dimension=value"` strings. Named archetypes carry the literal §D.1.1 value;
 * unnamed archetypes default to `CHAT_REST_LIKELIHOOD` (low floor) so the named archetypes
 * dominate the posterior, mirroring the quiz prior. Applied multiplicatively and NOT damped —
 * chat intent carries the same weight as quiz answers per §D.7 (the QUIZ_CONFIDENCE_BONUS
 * applies in `applyChatIntentPrior`).
 *
 * Compound D.1.1 cases (e.g. `urgency=0-3mo + purchase_purpose=investment`) are decomposed
 * into single-dimension keys that each apply when present (see `urgency=0-3mo` below); the
 * compound boost maps to the dominant archetype of the compound case.
 *
 * Exported for the FOLLOW-101 chat-intent bridge.
 */
```

#### intent.ts:446 — `CHAT_INTENT_LIKELIHOODS`

Anchor (first code line after the comment): `'urgency=0-3mo': makeChatLikelihood({`

Kept in the code as: Decomposed from urgency=0-3mo + purchase_purpose=investment.

```text
// Compound case `urgency=0-3mo + purchase_purpose=investment` → flip_investor:0.8.
// Decomposed: urgency alone leans flip_investor; purchase_purpose=investment applies
// separately when present, so the combination compounds toward flip_investor.
```

#### intent.ts:476 — `CHAT_INTENT_LIKELIHOODS`

Anchor (first code line after the comment): `export const BEHAVIORAL_DAMPING = 0.3;`

Kept in the code as: Behavioural damping (30%); exported for the drift gate [FOLLOW-331].

```text
/**
 * Damping scalar applied to behavioral likelihoods before the multiplicative
 * Bayesian update.  Value 0.3 = 30% of the raw likelihood signal is used.
 *
 * Exported for the cross-package drift gate in
 * `packages/sdk/src/__tests__/intent-weights-drift.test.ts` (FOLLOW-331).
 * Runtime behavior is unchanged.
 */
```

#### intent.ts:488 — `BEHAVIORAL_DAMPING`

Anchor (first code line after the comment): `export interface IntentEngineOverrides {`

Kept in the code as: Per-session intent parameters from `resolveIntentOverrides()`.

```text
/**
 * Resolved intent engine parameters for one browser session.
 *
 * Computed once at session start (after consent, before the first behavioral
 * signal) by `resolveIntentOverrides()`. Callers pass this bundle into
 * `initIntentState()` and `applyBehavioralSignal()` so the intent engine uses
 * server-supplied parameters when available, falling back to module-level
 * constants when weights are null.
 *
 * Pure value type — no mutation, no hidden state.
 */
```

#### intent.ts:504 — `IntentEngineOverrides`

Anchor (first code line after the comment):
`signalLikelihoods: Record<string, ArchetypeProbabilities>;`

Kept in the code as: Server rows over SIGNAL_LIKELIHOODS; missing archetypes = 1.0.

```text
/**
 * Resolved signal likelihoods. Merged over SIGNAL_LIKELIHOODS: server-supplied values
 * for specified signal types replace SDK defaults; unspecified signal types retain
 * SDK-internal defaults. Missing archetypes within a given signal entry default to 1.0.
 */
```

#### intent.ts:512 — `IntentEngineOverrides`

Anchor (first code line after the comment): `function defaultOverrides(): IntentEngineOverrides {`

Kept in the code as: Defaults from module constants, so callers never branch on null. @internal

```text
/**
 * Build the default IntentEngineOverrides from module-level constants.
 * Returned when `weights` is null so callers never need to branch.
 *
 * @internal
 */
```

#### intent.ts:526 — `defaultOverrides`

Anchor (first code line after the comment):
`export function resolveIntentOverrides(weights: IntentWeights | null): IntentEngineOverrides {`

Kept in the code as: Merge server weights over the defaults (ADR-0012 §3); null weights = default
behaviour. @param weights - Parsed IntentWeights from the server, or null on failure. @returns
IntentEngineOverrides for this session.

```text
/**
 * Apply server-supplied weight overrides to the intent engine's defaults.
 *
 * Called once at session start (after consent is resolved, before behavioral
 * signals are processed). Returns an overrides bundle that callers pass to
 * `applyBehavioralSignal` and `initIntentState` instead of the module-level
 * constants. Pure function — does not mutate module state.
 *
 * Merge semantics (ADR-0012 §3):
 *   - `priors`: each server-supplied archetype value is merged WITH BASE_PRIOR
 *     (unspecified archetypes keep their BASE_PRIOR value), then the merged
 *     distribution is normalized to sum to 1.0.  This prevents unspecified
 *     archetypes from collapsing to 0 (the "uniform distribution collapse" risk
 *     documented in ADR-0012 §Risks).
 *   - `behavioral_damping`: replaces BEHAVIORAL_DAMPING scalar directly.
 *   - `signal_likelihoods`: each server entry overrides the full archetype row
 *     for that signal type (merged over SIGNAL_LIKELIHOODS; unspecified signal
 *     types retain their SDK defaults; missing archetypes within a server entry
 *     default to 1.0 — no information).
 *
 * Fallback contract: if `weights` is null (fetch failed, returned mock, or
 * returned error), the returned bundle contains the SDK's internal defaults
 * unchanged.  The intent engine MUST behave identically to the no-server-weights
 * path when weights is null.
 *
 * @param weights - Parsed IntentWeights from the server, or null on failure.
 * @returns IntentEngineOverrides — resolved values for behavioral_damping,
 *          initial priors, and signal_likelihoods to use for this session.
 */
```

#### intent.ts:561 — `resolveIntentOverrides`

Anchor (first code line after the comment): `let basePrior: ArchetypeProbabilities;`

Kept in the code as: Merge over BASE_PRIOR, then normalise: no collapse on partial overrides
(ADR-0012).

```text
// ── basePrior ──────────────────────────────────────────────────────────────
// Merge: start with BASE_PRIOR, overlay server priors for specified archetypes,
// then normalize so probabilities sum to 1.0.  Unspecified archetypes keep
// their BASE_PRIOR value — prevents uniform distribution collapse on partial
// overrides (ADR-0012 §Risks: "Partial priors divergence").
```

#### intent.ts:579 — `resolveIntentOverrides`

Anchor (first code line after the comment):
`let signalLikelihoods: Record<string, ArchetypeProbabilities>;`

Kept in the code as: Server rows over SDK defaults; missing archetypes = 1.0.

```text
// ── signalLikelihoods ──────────────────────────────────────────────────────
// Start with the SDK defaults; overlay server-supplied rows.
// Within a server-supplied row, missing archetypes default to 1.0 (no
// information — mirrors makeLikelihood() semantics).
```

#### intent.ts:641 — `applyLikelihood`

Anchor (first code line after the comment): `function carry(state: IntentState): IntentState {`

Kept in the code as: Bookkeeping every rebuild must carry, so no evidence counts twice (Rule R)
[FOLLOW-1306].

```text
/**
 * FOLLOW-1306 (F-05): the bookkeeping every state rebuild carries forward — the chat-prior markers
 * (`chatPriorApplied`, `chatPriorAppliedAt`) and `dwell_ticks_applied`. Transforms that rebuilt
 * the state field by field dropped them, so the next adapt call re-folded an already-folded chat
 * extraction and the dwell timer re-applied exhausted ticks — the same evidence counted twice
 * (Rule R). `chat_mismatch` is not carried: it describes only the fold that produced it.
 */
```

#### intent.ts:661 — `withConfidenceBonus`

Anchor (first code line after the comment):
`export function normalize(probs: ArchetypeProbabilities): ArchetypeProbabilities {`

Kept in the code as: Normalise to 1.0; degenerate input → uniform.

```text
/**
 * Normalize probabilities to sum to 1.0.
 * Degenerate inputs (NaN, zero sum, negatives) fall back to the uniform distribution.
 */
```

#### intent.ts:677 — `normalize`

Anchor (first code line after the comment): `export function classifyFromProbabilities(`

Kept in the code as: Archetype + confidence from a distribution; 'neutral' wins ties, hysteresis via
currentArchetype [FOLLOW-363]. @param probs - Normalized posterior distribution. @param
currentArchetype - The current archetype; omit only on cold-start/one-shot paths.

```text
/**
 * Derive archetype and confidence from a probability distribution.
 *
 * Tie-break: 'neutral' wins equal-probability contests so fully-decayed
 * states classify as 'neutral' rather than an arbitrary archetype.
 *
 * Hysteresis (FOLLOW-344): when `currentArchetype` is provided, the new leader
 * must beat it by at least `SWITCH_MARGIN` to trigger a switch. This prevents
 * cycle-to-cycle archetype flipping on near-ties without delaying genuine shifts.
 * Pass `undefined` (or omit) at session init so the first classification runs freely.
 *
 * @param probs            - Normalized posterior distribution.
 * @param currentArchetype - The archetype currently held by the session, or undefined
 *                           when classifying from scratch (init / cold-start paths).
 *
 * ── Call-site inventory (Rule S — FOLLOW-363) ────────────────────────────────────
 * 11 call sites in intent.ts. Each is classified as either:
 *   • GUARDED   — passes `state.archetype`; hysteresis active.
 *   • FREE-CLASSIFY — omits `currentArchetype`; guard intentionally inactive.
 *
 * FREE-CLASSIFY sites (omit currentArchetype — cold-start or one-shot):
 *   1. initIntentState (line ~807)         — session cold-start; no prior archetype exists.
 *   2. applyChatIntentPrior (line ~1341)   — one-shot per session (guarded by chatPriorApplied
 *                                            idempotency flag in fetchDirectives); not a repeated
 *                                            ongoing classification path.
 *   3. applyReferrerHints (line ~1445)     — session-init prior applied once before any behavioral
 *                                            signal; no established archetype at call time.
 *
 * GUARDED sites (pass `state.archetype`; `state.quiz_answered`; hysteresis active):
 *   5.  applyBehavioralSignal — listing.bookmarked intercept (line ~995)
 *   7.  applyBehavioralSignal — feature.expanded intercept    (line ~1097)
 *   8.  applyBehavioralSignal — filter.applied intercept      (line ~1119)
 *   9.  applyBehavioralSignal — generic path                  (line ~1143)
 *   10. applyListingViewRate  (line ~1601) — fires on every listing.viewed after the 2nd view;
 *                                            ongoing, repeated per-session classify — GUARDED
 *                                            by FOLLOW-363 to prevent near-tie churn.
 *   11. applyDwellSignal      (line ~1660) — fires on a setInterval dwell tick; ongoing,
 *                                            repeated per-session classify — GUARDED by
 *                                            FOLLOW-363 to prevent near-tie churn.
 * ─────────────────────────────────────────────────────────────────────────────────
 */
```

#### intent.ts:745 — `classifyFromProbabilities`

Anchor (first code line after the comment): `if (`

Kept in the code as: A neutral-led drift must not unseat a quiz archetype (§D.6, ADR-0014)
[FOLLOW-344].

```text
// Quiz stickiness: once the quiz has explicitly resolved a non-neutral archetype, routine
// behavioral signals (scroll, listing.viewed, …) push probability mass toward `neutral`,
// and after enough signals neutral overtakes the quiz archetype and the resolved archetype
// decays back to `neutral` — silently turning off cross-listing adaptation mid-session.
// The quiz is the source of truth (§D.6 / FOLLOW-344 "switch-margin not blending"): a drift
// whose argmax is `neutral` must NOT unseat it. Only a genuine contrary *non-neutral* leader
// (handled by the SWITCH_MARGIN hysteresis above) may switch the quiz archetype.
```

#### intent.ts:765 — `classifyFromProbabilities`

Anchor (first code line after the comment):
`export function initIntentState(overrides?: IntentEngineOverrides): IntentState {`

Kept in the code as: Initial state from BASE_PRIOR or `overrides.basePrior`. @param overrides -
Resolved session-level overrides from `resolveIntentOverrides()`, or undefined.

```text
/**
 * Initialize intent state with BASE_PRIOR probabilities (or server-supplied priors).
 *
 * When `overrides` is provided (non-null), the initial probabilities are taken
 * from `overrides.basePrior` — which is the server-supplied prior merged with
 * BASE_PRIOR and normalized (see `resolveIntentOverrides`).  When `overrides`
 * is absent or null, BASE_PRIOR is used unchanged (backward-compatible default).
 *
 * @param overrides - Resolved session-level overrides from `resolveIntentOverrides()`,
 *   or undefined for the default BASE_PRIOR (backward-compatible).
 */
```

#### intent.ts:789 — `initIntentState`

Anchor (first code line after the comment): `function applyFilterBoosts(`

Kept in the code as: Facet-conditional boosts for `filter.applied` (Master Design C.1) [FOLLOW-211].

```text
/**
 * Facet-conditional intent boosts for `filter.applied`.
 *
 * Returns a new ArchetypeProbabilities with additive boosts applied and
 * re-normalized to sum to 1.0. If the facet does not warrant a targeted
 * boost (e.g. `price_range`), the input probabilities are returned unchanged.
 *
 * Boost values are smaller than quiz likelihoods (behavioral evidence only),
 * consistent with BEHAVIORAL_DAMPING applied on other signal types.
 *
 * Boost rules (Master Design C.1 + FOLLOW-211 + FOLLOW-100 spec):
 *   commercial                       → commercial_investor +0.15
 *   investment_yield                 → yield_hunter +0.12, portfolio_builder +0.08
 *   bedrooms ≥ 3                     → family_buyer +0.10
 *   renovation                       → flip_investor +0.15
 *   type = holiday / vacation        → vacation_rental_investor +0.18
 *   price_max ≤ 300_000 (or 'low')   → first_time_buyer +0.12
 *   bedrooms_min ≥ 4                 → upsizer +0.12
 *   bedrooms_max ≤ 2                 → downsizer +0.12
 *   near_university / school_district→ student_parent +0.15, family_buyer +0.08
 *   price_range                      → no archetype-specific boost (generic signal)
 *   all other facets                 → no boost (ignored)
 */
```

#### intent.ts:869 — `applyFilterBoosts`

Anchor (first code line after the comment): `export function applyBehavioralSignal(`

Kept in the code as: Update intent state from a behavioural event; unknown events return the same
reference. @param state - Current intent state. @param eventType - The behavioral event type string.
@param payload - Optional event payload (used by payload-conditional intercepts). @param overrides -
Optional session-level weight overrides from `resolveIntentOverrides()`.

```text
/**
 * Update intent state from a behavioral event.
 *
 * For `filter.applied`, facet-conditional additive boosts are applied directly
 * to the probability distribution (see `applyFilterBoosts`). This path bypasses
 * the multiplicative SIGNAL_LIKELIHOODS table because the boost magnitude depends
 * on runtime payload values that cannot be encoded in a static table.
 *
 * For all other known event types, the raw signal likelihood from
 * SIGNAL_LIKELIHOODS (or `overrides.signalLikelihoods` when provided) is dampened
 * by BEHAVIORAL_DAMPING (or `overrides.behavioralDamping` when provided) and applied
 * multiplicatively. Unknown event types return the state unchanged (same
 * reference, signal_count is NOT incremented).
 *
 * @param state     - Current intent state.
 * @param eventType - The behavioral event type string.
 * @param payload   - Optional event payload (used by payload-conditional intercepts).
 * @param overrides - Optional session-level weight overrides from `resolveIntentOverrides()`.
 *   When absent the module-level constants BEHAVIORAL_DAMPING and SIGNAL_LIKELIHOODS are used.
 *   Backward-compatible: callers that do not pass overrides are unaffected.
 */
```

#### intent.ts:900 — `applyBehavioralSignal`

Anchor (first code line after the comment): `if (eventType === 'listing.bookmarked') {`

Kept in the code as: Static neutral push, then payload boosts [FOLLOW-210].

```text
// Intercept listing.bookmarked before the static SIGNAL_LIKELIHOODS lookup.
// The static table handles the neutral→0.70 push; here we apply payload-conditional additive
// boosts on top of the multiplicative update (FOLLOW-210 spec step 3).
```

#### intent.ts:946 — `applyBehavioralSignal`

Anchor (first code line after the comment): `if (eventType === 'feature.expanded') {`

Kept in the code as: Static neutral push, then payload.feature boosts [FOLLOW-100].

```text
// Intercept feature.expanded before the static SIGNAL_LIKELIHOODS lookup (FOLLOW-100).
// Mirrors the listing.bookmarked intercept: apply the static damped neutral-push first,
// then payload-conditional multiplicative boosts keyed on payload.feature. An unrecognized
// (or absent) feature value gets the base neutral-push only — no targeted boost.
```

#### intent.ts:1065 — `MismatchEvent`

Anchor (first code line after the comment): `export function detectMismatch(`

Kept in the code as: Quiz vs behaviour contradiction; needs ≥3 signals.

```text
/**
 * Detect if quiz-declared archetype contradicts behavioral signals.
 *
 * Returns null when:
 *   - signal_count < 3 (insufficient evidence)
 *   - quiz and behavioral archetypes agree
 *
 * Mismatch fires when:
 *   1. Quiz says investor group but behavioral signals favour own-use group (sum > 0.4)
 *   2. Quiz says own-use group but behavioral signals favour investor group (sum > 0.4)
 *   3. Confidence gap (behavioral_confidence − quiz_archetype_prob) > 0.3
 */
```

#### intent.ts:1120 — `detectMismatch`

Anchor (first code line after the comment):
`export function applyQuizLeaf(state: IntentState, archetype: Archetype): IntentState {`

Kept in the code as: v2 quiz leaf: target at 0.85, others share 0.15, quiz_answered set. @param
state - Current intent state (signal_count and last_updated_at are preserved). @param archetype -
The leaf archetype resolved by the decision tree.

```text
/**
 * Update intent state from a v2 quiz leaf resolution (direct archetype assignment).
 *
 * Called by quiz-widget v2.0 on leaf resolution. Sets the target archetype to 0.85
 * probability; all others share the remaining 0.15 uniformly. Confidence is capped
 * at 1.0 and includes the QUIZ_CONFIDENCE_BONUS. quiz_answered is set to true.
 *
 * @param state - Current intent state (signal_count and last_updated_at are preserved).
 * @param archetype - The leaf archetype resolved by the decision tree.
 */
```

#### intent.ts:1150 — `applyQuizLeaf`

Anchor (first code line after the comment): `export function applyChatIntentPrior(`

Kept in the code as: Fold chat dimensions (§D.1.1) once per message; the caller's watermark dedupes
[FOLLOW-1024]. @param state - Current intent state (typically post-quiz). @param intentDimensions -
Flat chat-intent dimension → value map.

```text
/**
 * Update intent state from chat-derived intent dimensions (FOLLOW-100 / §D.1.1).
 *
 * `intentDimensions` is a flat `dimension → value` map (e.g.
 * `{ purchase_purpose: 'investment', urgency: '0-3mo', tax_aware: 'true' }`). For each pair,
 * `CHAT_INTENT_LIKELIHOODS["<dimension>=<value>"]` is looked up; matched likelihoods are applied
 * multiplicatively in iteration order. Chat intent is NOT damped — it carries the same weight as
 * quiz answers per §D.7, so the QUIZ_CONFIDENCE_BONUS is applied to the resulting confidence.
 *
 * Behaviour:
 *   - Empty `intentDimensions` → returns `state` unchanged (same reference).
 *   - Dimension values with no matching entry are skipped (no boost).
 *   - Does NOT set `quiz_answered` — chat is a separate evidence source.
 *   - Mismatch detection: when chat confidence > 0.7 AND `state.quiz_answered` is true AND the
 *     chat-derived leading archetype differs from the incoming `state.archetype` by more than
 *     MISMATCH_GAP_THRESHOLD (in probability), the returned state carries `chat_mismatch`
 *     metadata `{ quiz_archetype, chat_archetype }`. This is observable, not a silent override —
 *     the chat-updated distribution is still returned.
 *
 * Pure function — the input `state` is never mutated. `signal_count` is preserved.
 *
 * ## FOLLOW-1024 — this is now called once per MESSAGE, not once per session
 *
 * Until 2026-08-18 `fetchDirectives` folded chat evidence exactly once and then set a boolean
 * that suppressed it for the rest of the session. Two consequences of calling it repeatedly
 * had to be handled here, and both were latent bugs even under the old one-shot regime:
 *
 * 1. **Hysteresis is now applied.** The call below used to be
 *    `classifyFromProbabilities(probabilities)` with no current archetype, which bypasses
 *    SWITCH_MARGIN entirely — any lead, however slight, re-labelled the buyer. Harmless when
 *    it happened once; a source of visible copy churn when it happens every message. The
 *    current archetype and `quiz_answered` are now passed, which also restores the ADR-0014
 *    anti-neutral-decay guard on this path (it was unreachable in practice, because every chat
 *    likelihood floors `neutral` at CHAT_REST_LIKELIHOOD while boosting named archetypes — but
 *    it held by arithmetic rather than by a guard, and that is not a property to rely on).
 * 2. **Accumulation is intended, not a leak.** Each signal-bearing message multiplies its
 *    likelihood into the posterior, so a conversation that keeps pointing one way overtakes a
 *    quiz answer (which enters at p=0.85). Measured: one contrary dimension does not flip a
 *    quiz leaf, two do. That is the point — a buyer who clicked through the quiz without
 *    reading it, or who asked for the wrong thing, is re-classified by what they actually ask.
 *
 * Double-counting is prevented by the caller's `chatPriorAppliedAt` watermark, not here: this
 * function folds whatever it is given, every time it is called.
 *
 * @param state            - Current intent state (typically post-quiz).
 * @param intentDimensions - Flat chat-intent dimension → value map.
 */
```

#### intent.ts:1219 — `applyChatIntentPrior`

Anchor (first code line after the comment):
`const { archetype, confidence: rawConfidence } = classifyFromProbabilities(`

Kept in the code as: Hysteresis + quiz stickiness on every message [FOLLOW-1024].

```text
// FOLLOW-1024: hysteresis + the quiz-stickiness guard. See the docblock — passing these two
// arguments is the whole difference between "re-label on any lead" and "re-label on a lead
// that beats SWITCH_MARGIN", which matters once this runs on every buyer message.
```

#### intent.ts:1229 — `applyChatIntentPrior`

Anchor (first code line after the comment):
`let chat_mismatch: { quiz_archetype: Archetype; chat_archetype: Archetype } | undefined;`

Kept in the code as: Confident chat leader vs the quiz archetype's updated probability.

```text
// Mismatch detection: confident chat result disagreeing with a confident quiz result.
// Gap is measured in probability between the chat-leading archetype and the quiz archetype's
// probability under the chat-updated distribution.
```

#### intent.ts:1254 — `applyChatIntentPrior`

Anchor (first code line after the comment): `export function calculateBehavioralOnlyState(`

Kept in the code as: Behavioural-only state from BASE_PRIOR.

```text
/**
 * Calculate behavioral-only intent state from a signal history.
 * Starts from BASE_PRIOR and applies only behavioral signals — no quiz prior.
 */
```

#### intent.ts:1270 — `calculateBehavioralOnlyState`

Anchor (first code line after the comment):
`const INVESTMENT_KEYWORDS = ['investment', 'rental', 'yield', 'inwestycja', 'wynajem'] as const;`

Kept in the code as: Investment keywords in referrer / UTM term.

```text
/**
 * Investment-intent keywords matched against the full referrer URL and UTM term.
 * A match boosts investor archetypes by weak additive priors.
 */
```

#### intent.ts:1276 — `INVESTMENT_KEYWORDS`

Anchor (first code line after the comment):
`const OWN_USE_KEYWORDS = ['family', 'apartment', 'mieszkanie', 'dom'] as const;`

Kept in the code as: Own-use keywords in referrer / UTM term.

```text
/**
 * Own-use-intent keywords matched against the full referrer URL and UTM term.
 * A match boosts own-use archetypes by weak additive priors.
 */
```

#### intent.ts:1282 — `OWN_USE_KEYWORDS`

Anchor (first code line after the comment): `export function applyReferrerHints(`

Kept in the code as: Referrer + UTM term as weak cold-session priors [FOLLOW-207]. @param state -
Current intent state (typically the result of `initIntentState()`). @param referrer -
`document.referrer` value (may be empty string). @param utmTerm - Value of the `utm_term` query
parameter (may be empty string).

```text
/**
 * Apply referrer URL + UTM term as cold-session intent priors (FOLLOW-207).
 *
 * Rules:
 *   - Investment keywords in `referrer` OR `utmTerm` → portfolio_builder +0.05,
 *     yield_hunter +0.04, commercial_investor +0.03
 *   - Own-use keywords in `referrer` OR `utmTerm` → family_buyer +0.05,
 *     first_time_buyer +0.03
 *   - No matching keywords → return `state` unchanged (same reference)
 *   - When both groups match, both sets of boosts are applied simultaneously
 *   - Result is always renormalized so probabilities sum to 1.0
 *
 * This is a pure function — the input `state` is never mutated.
 * `signal_count` and `quiz_answered` are preserved unchanged.
 *
 * @param state  - Current intent state (typically the result of `initIntentState()`).
 * @param referrer - `document.referrer` value (may be empty string).
 * @param utmTerm  - Value of the `utm_term` query parameter (may be empty string).
 */
```

#### intent.ts:1343 — `applyReferrerHints`

Anchor (first code line after the comment): `export function applyListingViewRate(`

Kept in the code as: Listing views per minute as an investor/own-use discriminator; pure. @param
state - Current intent state. @param viewCount - Total listing views recorded this session. @param
elapsedMs - Milliseconds elapsed since session start (must be > 0).

```text
/**
 * Apply listing-view rate as a portfolio_builder / flip_investor behavioral discriminator.
 *
 * Rate is computed as `viewCount / (elapsedMs / 60_000)` (views per minute).
 *
 * Boost rules:
 *   - rate ≥ 3 views/min AND viewCount ≥ 2 → portfolio_builder +0.12, flip_investor +0.08,
 *     neutral −0.10 (floored at 0 before renormalization)
 *   - rate ≤ 0.5 views/min AND viewCount ≥ 2 → family_buyer +0.06, first_time_buyer +0.06,
 *     upsizer +0.04
 *   - viewCount < 2 → return `state` unchanged (no-op — first view is baseline)
 *   - elapsedMs ≤ 0 → return `state` unchanged (guard against division by zero)
 *   - Otherwise (0.5 < rate < 3) → return `state` unchanged
 *
 * The result is always renormalized so probabilities sum to 1.0.
 * This is a pure function — the input `state` is never mutated.
 * `signal_count` and `quiz_answered` are preserved.
 *
 * @param state     - Current intent state.
 * @param viewCount - Total listing views recorded this session.
 * @param elapsedMs - Milliseconds elapsed since session start (must be > 0).
 */
```

#### intent.ts:1398 — `applyListingViewRate`

Anchor (first code line after the comment):
`const { archetype, confidence: rawConfidence } = classifyFromProbabilities(`

Kept in the code as: Guarded: runs on every view [FOLLOW-363].

```text
// FOLLOW-363: pass state.archetype so the hysteresis guard is active.
// applyListingViewRate fires on every listing.viewed after the 2nd view (index.ts:953-963)
// — an ongoing, repeated classification path where near-tie distributions can flip the
// archetype on every call.  The guard prevents churn without blocking genuine shifts.
```

#### intent.ts:1427 — `DWELL_UNIT_MS`

Anchor (first code line after the comment):
`export const DWELL_MAX_SESSION_CONTRIBUTION = 3 as const;`

Kept in the code as: Max dwell ticks per session, enforced via `dwell_ticks_applied` (Rule R)
[FOLLOW-227].

```text
/**
 * Maximum number of dwell-time threshold ticks whose boost may be applied
 * across the entire session (including resumption after cross-listing navigation).
 *
 * Rule R compliance (FOLLOW-227): persisted `IntentState.dwell_ticks_applied`
 * carries the already-applied count across the rehydrate boundary.  The
 * `startDwellTimer` call site in index.ts checks this field before every tick
 * and skips boosts that have already been counted, so the total contribution
 * is bounded by this constant and cannot compound without limit.
 *
 * Value = 3 (one per threshold in DWELL_THRESHOLDS_MS: 30 s / 90 s / 180 s).
 */
```

#### intent.ts:1441 — `DWELL_MAX_SESSION_CONTRIBUTION`

Anchor (first code line after the comment):
`export function applyDwellSignal(state: IntentState, elapsed_ms: number): IntentState {`

Kept in the code as: Dwell boost to the leader; the caller checks the session cap first
[FOLLOW-190]. @returns Same state reference when archetype==="neutral", elapsed_ms<=0, or boost<=1.

```text
/**
 * Apply a dwell-time confidence boost to the current leading archetype (FOLLOW-190).
 *
 * Reinforces the currently leading archetype proportional to log2(elapsed_ms / DWELL_UNIT_MS).
 * All other archetypes receive a likelihood of 1.0 (no information).
 *
 * signal_count is NOT incremented (dwell is continuous, not a discrete event).
 * Pure function: no DOM access, no globals, no side effects.
 *
 * Rule R compliance (FOLLOW-227): increments `dwell_ticks_applied` in the returned
 * state so the boost count survives the sessionStorage rehydrate boundary.  The
 * call site in `startDwellTimer` (index.ts) is responsible for checking
 * `DWELL_MAX_SESSION_CONTRIBUTION` BEFORE calling this function.
 *
 * @returns Same state reference when archetype==="neutral", elapsed_ms<=0, or boost<=1.
 */
```

#### intent.ts:1466 — `applyDwellSignal`

Anchor (first code line after the comment):
`const { archetype, confidence: rawConfidence } = classifyFromProbabilities(`

Kept in the code as: Guarded: runs on every dwell tick [FOLLOW-363].

```text
// FOLLOW-363: pass state.archetype so the hysteresis guard is active.
// applyDwellSignal fires on a setInterval tick (index.ts:581-604) — an ongoing,
// repeated classification path where a near-tie distribution can flip the archetype
// on every tick.  The guard prevents churn without blocking genuine shifts.
```

### `packages/sdk/src/core/adapt.ts`

#### adapt.ts:1 — module header

Anchor (first code line after the comment): `import type { SessionState } from './session.js';`

Kept in the code as: Adaptation client: fetches and applies directives; never throws. @module
@estalara/sdk/core/adapt

```text
/**
 * Adaptation client — fetches personalization directives from Decision API.
 *
 * Called once per session init, results cached for ttl_seconds.
 * Never throws — returns null on any error.
 *
 * @module @estalara/sdk/core/adapt
 */
```

#### adapt.ts:27 — module header

Anchor (first code line after the comment): `/**`

Kept in the code as: ── Signed-ping helper (quiz completion; bandit ping removed by FOLLOW-1286) ──

```text
// ---------------------------------------------------------------------------
// Signed-ping helper (used by the quiz completion ping)
// ---------------------------------------------------------------------------
//
// FOLLOW-1286 (D3, bandit frozen): the session variant cache and the HMAC-signed bandit
// feedback ping to /api/adapt/feedback were removed here. The signature was keyed with the
// tenant's PUBLIC api key, so it proved nothing about integrity (audit 2026-09-24 report A §2),
// and /api/adapt now serves `variant: 'control'` for every request while BANDIT_ENABLED is off.
```

#### adapt.ts:36 — module header

Anchor (first code line after the comment):
`async function computeHmacSha256Hex(secret: string, message: string): Promise<string | null> {`

Kept in the code as: HMAC-SHA256 hex, or null without SubtleCrypto. @internal

```text
/**
 * Compute HMAC-SHA256(key=secret, data=message) and return the lower-case hex digest.
 *
 * Uses the Web Crypto API available in modern browsers. Returns null in
 * environments where SubtleCrypto is unavailable (e.g. very old browsers or SSR
 * without polyfill) so callers can fall back gracefully.
 *
 * @internal
 */
```

#### adapt.ts:64 — `computeHmacSha256Hex`

Anchor (first code line after the comment): `/**`

Kept in the code as: ── Quiz completion ping ──

```text
// ---------------------------------------------------------------------------
// Quiz completion ping (fire-and-forget POST to /api/quiz/completion)
// ---------------------------------------------------------------------------
```

#### adapt.ts:68 — `computeHmacSha256Hex`

Anchor (first code line after the comment):
`function deriveQuizCompletionUrl(config: SdkConfig): string | null {`

Kept in the code as: decisionApiUrl already ends in `/api` [FOLLOW-305]. @internal

```text
/**
 * Derive the quiz completion URL from the decision API base URL.
 *
 * Convention (FOLLOW-305): decisionApiUrl = host + `/api` (e.g. "https://admin.estalara.com/api").
 * buildEndpoint appends `/quiz/completion` → "https://admin.estalara.com/api/quiz/completion".
 * DO NOT prepend `/api` here — it is already in decisionApiUrl.
 *
 * @internal
 */
```

#### adapt.ts:82 — `deriveQuizCompletionUrl`

Anchor (first code line after the comment): `export interface QuizAnswerPath {`

Kept in the code as: The buyer's root→leaf quiz walk, ids paired with answers (ADR-0019)
[FOLLOW-1020].

```text
/**
 * The walk the buyer actually took, root→leaf (FOLLOW-1020).
 *
 * `question_ids[i]` is the question that was ON SCREEN when the buyer picked
 * `answer_indexes[i]`, so the two arrays are the same length and pair positionally. The ids
 * matter as much as the indexes: the tree is tenant-editable data (ADR-0019), so an index
 * alone cannot be reconstructed into an answer once an operator reorders a question.
 *
 * A quiz can only be completed by walking from `definition.root`, so a reported path is never
 * empty — which is what lets a stored row distinguish "the buyer skipped at Q1" (a path of
 * length 1 whose answer is a leaf) from "this row predates reporting" (no path at all).
 */
```

#### adapt.ts:99 — `QuizAnswerPath`

Anchor (first code line after the comment):
`function quizPathFields(path: QuizAnswerPath): Record<string, unknown> {`

Kept in the code as: Quiz walk → completion-row fields [FOLLOW-1020]. @param path - The root→leaf
walk from the quiz widget. @returns The subset of completion-row fields the path determines.
@internal

```text
/**
 * Flatten a walked quiz path into the completion-row fields (FOLLOW-1020).
 *
 * `branch` is the question the ROOT answer led to — `question_ids[1]`. That is the generic
 * form of the fixed `INWESTOR` / `OWN_USE` / `CROSS_BORDER` split the column was created for,
 * and it keeps working when a tenant edits the tree, which a hardcoded name would not. A root
 * answer that is itself a leaf (the "just browsing" skip) has no second question and therefore
 * no branch — `null`, exactly the case the column documents.
 *
 * `q1_answer` is always present in a reported path (a quiz cannot be completed without
 * answering the root), which is what makes it the discriminator between a genuine skip and a
 * row written before this reporting existed.
 *
 * @param path - The root→leaf walk from the quiz widget.
 * @returns The subset of completion-row fields the path determines.
 * @internal
 */
```

#### adapt.ts:130 — `quizPathFields`

Anchor (first code line after the comment): `export function postQuizCompletionPing(`

Kept in the code as: POST /api/quiz/completion, HMAC-signed, fire-and-forget, never throws
[FOLLOW-051]. @param config - SDK configuration (needs apiKey + decisionApiUrl). @param sessionId -
Current session identifier. @param resolvedArchetype - Quiz leaf archetype (or 'neutral'). @param
language - Quiz locale (`QuizLanguage` from `@estalara/shared`). @param profilingOptedOut - When
true, appends `?profiling_opt_out=1` (§H.9). @param answerPath - The root→leaf walk (FOLLOW-1020);
omitted when there is none.

```text
/**
 * Post a quiz completion record to POST /api/quiz/completion. Fire-and-forget —
 * never awaited, never throws. The quiz dismiss UI must not be blocked.
 *
 * Auth: HMAC-SHA256 tenant-scoped (FOLLOW-051):
 *   Authorization: Bearer {apiKey}
 *   X-Estalara-Signature: HMAC-SHA256(apiKey, bodyText)
 *
 * When SubtleCrypto is unavailable the ping is skipped rather than sending an
 * unsigned request that the server will reject.
 *
 * Failures are caught and logged to console.warn — they must never propagate to the
 * caller or affect the quiz dismiss flow.
 *
 * §H.9 defense-in-depth (FOLLOW-389 HW-1): when `profilingOptedOut=true` the query
 * param `profiling_opt_out=1` is appended so the server gate at
 * `apps/control-plane/src/app/api/quiz/completion/route.ts:363` can skip
 * persistence even if the primary Guard 1 (`showQuizTrigger` early return at
 * `index.ts:1103`) is somehow bypassed. This branch is reachable ONLY as
 * defense-in-depth if Guard 1 regresses — NOT under normal production traffic
 * (Guard 1 returns before `renderQuizTrigger`, so `postQuizCompletionPing` is
 * never called for opted-out sessions under normal conditions).
 *
 * @param config           - SDK configuration (needs apiKey + decisionApiUrl).
 * @param sessionId        - Current session identifier.
 * @param resolvedArchetype - Quiz leaf archetype (or 'neutral').
 * @param language         - Quiz locale (canonical `QuizLanguage` from `@estalara/shared`, FOLLOW-273).
 * @param profilingOptedOut - When true, appends `?profiling_opt_out=1` to signal
 *                            server-side persistence skip (§H.9 defense-in-depth).
 * @param answerPath       - The root→leaf walk the buyer took (FOLLOW-1020). Omitted only by
 *                           callers that have no path to report; the row is then stored
 *                           without one and the staff viewer renders it as "not reported"
 *                           rather than inventing a Q1 skip.
 */
```

#### adapt.ts:175 — `postQuizCompletionPing`

Anchor (first code line after the comment):
`const completionUrl = profilingOptedOut ? '${baseUrl}?profiling_opt_out=1' : baseUrl;`

Kept in the code as: §H.9 defence-in-depth behind the quiz-trigger guard [FOLLOW-389].

```text
// §H.9 defense-in-depth: mirror the /adapt pattern (adapt.ts:744) — append the
// opt-out flag so the route gate at route.ts:363 is reachable ONLY if Guard 1
// regresses — NOT under normal production traffic (Guard 1 returns before
// postQuizCompletionPing is called for opted-out sessions).
```

#### adapt.ts:185 — `postQuizCompletionPing`

Anchor (first code line after the comment):
`...(answerPath !== undefined ? quizPathFields(answerPath) : {}),`

Kept in the code as: Omitted without a path, so "not reported" stays distinct [FOLLOW-1020].

```text
// FOLLOW-1020: report HOW the archetype was reached. Before this the row carried only the
// leaf, and the staff viewer rendered every completion as a Q1 skip against columns the
// SDK never populated — the Branch Split card counted a full Investment→Rental→Steady walk
// as a skip. Omitted entirely when there is no path, so a missing walk stays distinguishable
// from a reported one rather than being flattened into a default.
```

#### adapt.ts:229 — `AdaptResponse`

Anchor (first code line after the comment): `adapt_decision_id: string;`

Kept in the code as: Per-decision UUID, mirrors `AdaptationDirectives.adapt_decision_id`
[FOLLOW-105].

```text
/**
 * Stable per-decision UUID returned by the canonical `/api/adapt` route
 * (FOLLOW-105 / ADR-0006 §Decision 4C). Mirrors `AdaptationDirectives.adapt_decision_id`.
 */
```

#### adapt.ts:239 — `AdaptResponse`

Anchor (first code line after the comment): `page_context?: 1 | 2;`

Kept in the code as: Page context (not a Tier): 2 = detail, 1 = list/search/home [FOLLOW-357].

```text
/**
 * Page context derived from `page_type` in the POST /api/adapt response (FOLLOW-357).
 * NOT an integration Tier (CEO ruling 2026-06-05, §E.7).
 * 2 = listing_detail (full directive set), 1 = list/search/home pages (lighter set).
 * Optional — absent on legacy GET responses.
 */
```

#### adapt.ts:252 — `AdaptResponse`

Anchor (first code line after the comment): `variant?: string;`

Kept in the code as: Recorded bandit variant; 'control' while frozen [FOLLOW-1286].

```text
/**
 * Bandit variant the server recorded for this decision. Always `'control'` while the bandit
 * is frozen (FOLLOW-1286, D3); the SDK does not read it.
 * Optional — absent when the session is in the holdout arm or the server is legacy.
 */
```

#### adapt.ts:258 — `AdaptResponse`

Anchor (first code line after the comment): `ttl_seconds?: number;`

Kept in the code as: @deprecated Not returned by `/api/adapt` [FOLLOW-105].

```text
/**
 * @deprecated The live canonical `/api/adapt` route does not return `ttl_seconds`
 * (FOLLOW-105 §D.4). Kept optional for backward compatibility with any legacy
 * caller that still reads it; do not rely on it being present.
 */
```

#### adapt.ts:264 — `AdaptResponse`

Anchor (first code line after the comment):
`chat_intent_dimensions?: Record<string, string> | null;`

Kept in the code as: Chat-intent dimensions to fold, when the server has them [FOLLOW-101].

```text
/**
 * Flattened chat-intent dimension map from the Modal NLP pipeline (FOLLOW-101).
 *
 * Present when the `/api/adapt` route found a shadow Redis key for this
 * `(tenant_id, session_id)` pair. The SDK calls `applyChatIntentPrior` with
 * this map to update the local IntentState for disagreement-rate analysis.
 *
 * Absent (undefined / null) when no shadow data exists for the session.
 */
```

#### adapt.ts:276 — `AdaptResponse`

Anchor (first code line after the comment): `slot_selectors?: Record<string, string>;`

Kept in the code as: Slot selectors to annotate before applyDirectives() [FOLLOW-340].

```text
/**
 * Resolved slot selector map from detail_schema.slot_selectors (FOLLOW-340).
 *
 * When present, the SDK calls `annotateSlots(slot_selectors)` BEFORE the first
 * `applyDirectives()` so that pages without hand-coded `data-estalara-slot`
 * attributes receive self-annotation. Additive optional — absent when the tenant
 * has no curated slot selectors or when the schema lookup fails on the server.
 */
```

#### adapt.ts:292 — `ApplyContext`

Anchor (first code line after the comment): `isStale: () => boolean;`

Kept in the code as: Latest-wins predicate before every DOM write; REQUIRED, no default
[FOLLOW-791].

```text
/**
 * FOLLOW-791 / Rule AB: latest-wins staleness predicate for the MutationObserver-backed
 * directive-resilience mechanism (see `attachResilience` below). Mirrors
 * `applyDescriptionAdaptation`'s `isStale` parameter (FOLLOW-548): consulted at the LAST
 * synchronous instant before every DOM write the mechanism performs, including the
 * rAF-deferred `reapply` write that fires LATER — so a rapid cross-listing navigation
 * that supersedes this adaptation cannot repaint the stale archetype's directive onto the
 * newer listing (and the watchdog disconnects instead of fighting forever).
 *
 * REQUIRED, no never-stale default: FOLLOW-548 LG-2 found that a never-stale default for
 * this exact class of guard is a latent footgun — a future prod call site that omitted it
 * would silently lose cross-listing-navigation protection with no compile-time signal.
 * The sole prod call site (index.ts) passes `() => myRefreshId !== latestRefreshId`;
 * test call sites pass an explicit `() => false` to opt out (matches the
 * adapt-description.test.ts convention).
 */
```

#### adapt.ts:311 — `ApplyContext`

Anchor (first code line after the comment):
`/** Fingerprints of directives already applied in this session (idempotency). */`

Kept in the code as: ── Module-level state ──

```text
// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------
```

#### adapt.ts:318 — `appliedFingerprints`

Anchor (first code line after the comment): `interface ResilienceState {`

Kept in the code as: Resilience observers per directive type, on top of the fingerprints
[FOLLOW-791].

```text
// ---------------------------------------------------------------------------
// FOLLOW-791 — MutationObserver-backed resilience for the generic directive pipeline
// (text / class / reorder). Modeled on adapt-description.ts's
// applyAndObserveSlot / applyAndObserveHeadlineSlot (see that file's module docstring
// for the disconnect → write → reconnect loop-guard rationale).
//
// Interaction with `appliedFingerprints` (kept exactly as-is, per ticket AC2): the
// fingerprint guard still gates whether a REPEAT applyXDirective() call (same
// slot/selector + archetype) re-enters this setup at all — it suppresses redundant
// re-application while the write is still holding. This mechanism is layered ON TOP:
// once armed, the MutationObserver's own `reapply()` closure detects and repairs a
// framework revert completely independently of any future applyXDirective() call — it
// does not go through, and cannot be blocked by, the fingerprint check. The two
// bookkeeping mechanisms answer different questions ("should THIS call redo the work?"
// vs. "does the DOM still hold what we wrote?") and are deliberately not merged.
//
// Separate maps per directive type (not one shared map keyed by element) so that a
// text, class, and reorder directive can independently track the SAME DOM element
// without one type's disconnect() clobbering another's state — mirrors adapt-
// description.ts's own separation of `_slotMap` (description) from `_headlineSlotMap`
// (headline), which exists for the identical reason.
// ---------------------------------------------------------------------------
```

#### adapt.ts:352 — `_reorderResilienceMap`

Anchor (first code line after the comment): `function attachResilience(`

Kept in the code as: Write once, then repair framework reverts until superseded [FOLLOW-791]. @param
map Per-directive-type state map. @param el Element (text/class directives) or container (reorder)
to observe. @param observerInit MutationObserverInit appropriate to what this directive mutates.
@param matches True when the DOM currently reflects the desired state — re-evaluated live. @param
write Performs the mutation. @param isStale Latest-wins predicate; a stale repair disconnects and
emits `adapt.skipped`. @param slotOrSelector Slot name / selector being tracked, for event payloads.
@param archetypeId Archetype ID for the `adapt.reapplied` event payload. @param confidence
Confidence for the `adapt.reapplied` event payload. @returns `true` if the initial write happened,
`false` if declined as stale [FOLLOW-793].

```text
/**
 * Attach MutationObserver-backed resilience to `el`: write the desired state once, then
 * watch for a framework revert and repair it, converging (never fighting forever).
 *
 * @param map            Per-directive-type state map — see module docstring above for
 *                       why text/class/reorder each get their own.
 * @param el             Element (text/class directives) or container (reorder) to observe.
 * @param observerInit   MutationObserverInit appropriate to what this directive mutates.
 * @param matches        Returns true when the DOM currently reflects the desired state
 *                       (no repair needed) — re-evaluated live, not memoized.
 * @param write          Performs the mutation.
 * @param isStale        FOLLOW-791 / Rule AB latest-wins predicate (ApplyContext.isStale).
 *                       Consulted before the initial write AND inside the rAF-deferred
 *                       `reapply` — a supersession disconnects the watchdog rather than
 *                       repainting stale content, and emits `adapt.skipped` (reason:
 *                       'stale') so the discard is observable, never silent (guardrail K.2).
 * @param slotOrSelector The slot name / CSS selector / container selector being tracked —
 *                       used for both the `adapt.skipped` (stale) and `adapt.reapplied`
 *                       event payloads.
 * @param archetypeId    Archetype ID for the `adapt.reapplied` event payload.
 * @param confidence     Confidence for the `adapt.reapplied` event payload.
 * @returns `true` if the initial write happened, `false` if it was declined as stale
 *   (FOLLOW-793). Callers use this to decide whether the directive actually took effect —
 *   `adapt.applied` and the idempotency fingerprint must both hang off a real write.
 */
```

#### adapt.ts:400 — `attachResilience`

Anchor (first code line after the comment): `map.delete(el);`

Kept in the code as: A disconnected entry leaves the map too [FOLLOW-793].

```text
// FOLLOW-793 AC2: the entry disconnected above must also LEAVE the map. Without this
// the map keeps a `ResilienceState` whose observer is dead and whose element is
// strongly referenced — it falsely asserts the element is watched, and (post-FOLLOW-795)
// `teardownAdaptObservers` would clear ownership for an element nothing is defending.
// The deferred `reapply` path below already does this correctly.
```

#### adapt.ts:412 — `attachResilience`

Anchor (first code line after the comment): `if (isStale()) {`

Kept in the code as: Re-check staleness before the deferred write (Rule AB).

```text
// FOLLOW-791 / Rule AB: re-consult staleness at the LAST synchronous instant before
// this deferred write — a rapid cross-listing nav that supersedes us while this
// repair was pending must not repaint the stale archetype's directive.
```

#### adapt.ts:452 — `attachResilience`

Anchor (first code line after the comment):
`export function evictGenericHeadlineObserver(el: HTMLElement): void {`

Kept in the code as: Evict the generic headline watchdog on hand-off: never two observers
[FOLLOW-795].

```text
/**
 * Disconnect and remove the generic pipeline's resilience watchdog for `el`, if one is
 * currently armed (FOLLOW-795 / RETRO-244 §4a LG-5(a)).
 *
 * Called by `adapt-description.ts`'s `applyAndObserveHeadlineSlot` the instant a
 * per-listing headline becomes available, so ownership hands off cleanly BEFORE the
 * description module arms its own observer on the same element — two independent
 * MutationObservers on one headline element must never coexist.
 */
```

#### adapt.ts:470 — `evictGenericHeadlineObserver`

Anchor (first code line after the comment): `export function teardownAdaptObservers(): void {`

Kept in the code as: Disconnect all resilience observers and their headline ownership [FOLLOW-791].

```text
/**
 * Disconnect and clear all FOLLOW-791 resilience observers (text / class / reorder).
 * Mirrors `teardownDescriptionObservers()` (adapt-description.ts) — called from
 * `resetAdaptState()` so cross-listing navigation (ADR-0014) and same-page archetype
 * changes never leave a stale observer watching a superseded/removed DOM node.
 *
 * FOLLOW-795: also releases headline-ownership bookkeeping for every element torn down
 * here — a no-op for non-headline elements (they never claim a registry entry), and the
 * matching half of the hand-off for any headline element the generic pipeline currently
 * owns.
 */
```

#### adapt.ts:496 — `_eventQueue`

Anchor (first code line after the comment):
`export function setEventQueueRef(queue: CollectedEvent[]): void {`

Kept in the code as: Wire the SDK event queue in; call once at init.

```text
/**
 * Wire the SDK event queue into this module so adapt events flow through
 * the standard 5s batch flush. Call this once from src/index.ts.
 */
```

#### adapt.ts:504 — `setEventQueueRef`

Anchor (first code line after the comment): `export function resetAdaptState(): void {`

Kept in the code as: Clear idempotency state on a new session.

```text
/**
 * Clear idempotency state. Call on new session initialization so directives
 * from a previous session are not considered already-applied.
 */
```

#### adapt.ts:510 — `resetAdaptState`

Anchor (first code line after the comment): `teardownAdaptObservers();`

Kept in the code as: Also disconnect resilience observers [FOLLOW-791].

```text
// FOLLOW-791 AC5: disconnect any armed resilience observers too — otherwise a
// cross-listing navigation (ADR-0014) or a same-page archetype change would leave a
// stale watchdog referencing a superseded/removed DOM node.
```

#### adapt.ts:516 — `resetAdaptState`

Anchor (first code line after the comment): `/**`

Kept in the code as: ── Internal helpers ──

```text
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
```

#### adapt.ts:520 — `resetAdaptState`

Anchor (first code line after the comment):
`export function pushEvent(event: CollectedEvent): void {`

Kept in the code as: Push onto the SDK event queue; no-op before init [FOLLOW-801].

```text
/**
 * Push onto the SDK's collected-event queue (set by `setEventQueueRef` at init).
 *
 * Exported for `annotate-slots.ts` (FOLLOW-801), which must make an ambiguous-selector
 * skip observable but has no queue of its own. Sharing this one keeps annotation skips in
 * the same stream as the `adapt.skipped` events they precede, rather than adding a third
 * queue-ref setter. No-ops before init — a skip emitted with no queue is dropped, not thrown.
 */
```

#### adapt.ts:532 — `pushEvent`

Anchor (first code line after the comment):
`function interpolatePlaceholders(value: string, el: HTMLElement, slotName: string): string | null {`

Kept in the code as: Resolve `{token}`s from attributes; null if ANY is unresolved [FOLLOW-1018].

```text
/**
 * Resolve `{token}` placeholders in a directive value string.
 * Maps `{school_rating}` → `data-estalara-school-rating` attribute on the element.
 *
 * FOLLOW-1018: returns `null` when ANY token is unresolved, and the caller then leaves the
 * element ALONE. The previous behaviour — paint the value with unresolved tokens left
 * literal, emitting only an `adapt.skipped` — put raw braces in front of buyers: the playbook
 * fallback then served `"Exceptional Residence — {key_luxury_feature}"`, and a tenant page
 * carrying no `data-estalara-key-luxury-feature` attribute rendered exactly that. That copy no
 * longer ships — ESC-075 removed `{key_luxury_feature}` and eleven siblings from the playbooks
 * — but this guard is not thereby redundant: the five tokens that DO ship still reach here
 * whenever the server could not fill them, and it is the second line of defence behind
 * `apps/control-plane/src/lib/placeholder-tokens.ts`. Partial resolution is still a failure (one missing token poisons the whole value),
 * so the resolved siblings are discarded with it. The skip event per unresolved token is
 * unchanged, so the diagnostic stream still names which token was missing.
 */
```

#### adapt.ts:582 — `applyTextDirective`

Anchor (first code line after the comment): `if (directive.value.trim() === '') {`

Kept in the code as: Never blank a slot: empty means "no adaptation" (ADR-0010).

```text
// Defensive: never blank a slot. An empty/whitespace directive value means "no
// adaptation for this archetype on this listing" (e.g. the decision API's archetype-fit
// gate, ADR-0010, declines to adapt a listing the archetype does not fit). Applying it
// would erase the original copy instead of leaving it. Skip — the slot keeps whatever it
// currently holds; cross-listing navigation separately restores the original (index.ts).
```

#### adapt.ts:596 — `applyTextDirective`

Anchor (first code line after the comment):
`const fingerprint = 'text:${slotName}:${context?.archetypeId ?? 'unknown'}';`

Kept in the code as: Fingerprint recorded only after a real write [FOLLOW-793, FOLLOW-802].

```text
// FOLLOW-793 AC1/AC4 + FOLLOW-802 AC1: the fingerprint is CHECKED here but recorded only
// after the loop, and only if at least one element was actually written. Recording it up
// front meant any early return inside the loop (stale-at-arm, or FOLLOW-795's
// headline-owned hand-off) permanently blocked the later correct write for this
// (slot, archetype) pair while ALSO emitting a false `adapt.applied`.
//
// The guard's purpose — suppressing redundant repeat writes — is unchanged: a call that
// writes still records the fingerprint, so an identical follow-up call still short-circuits
// here. What changes is only the failed case, which previously poisoned the guard with a
// write that never happened. Counting rather than flagging keeps this correct when a
// directive matches several elements and only some of them are written.
```

#### adapt.ts:614 — `applyTextDirective`

Anchor (first code line after the comment): `if (resolved === null) return;`

Kept in the code as: Unresolved token here: keep the tenant's copy [FOLLOW-1018].

```text
// FOLLOW-1018: an unresolved token means we cannot render this value truthfully on
// THIS element — leave it holding the tenant's own copy rather than painting braces.
// Per-element, because token sources are per-element attributes: a directive can be
// applicable to one matching slot and not another.
```

#### adapt.ts:628 — `applyTextDirective`

Anchor (first code line after the comment): `if (slotName === 'headline') {`

Kept in the code as: Headline hand-off: arm unless the description module owns it (ADR-0009)
[FOLLOW-795].

```text
// FOLLOW-795 (RETRO-244 §4a LG-5(a)): ownership HAND-OFF, not an unconditional
// exclusion. ADR-0009's per-listing headline pipeline (adapt-description.ts's
// applyAndObserveHeadlineSlot) is the correct owner of [data-estalara-slot="headline"]
// once a per-listing LLM headline exists — arming a second, independent observer here
// would fight it. But that ownership is CONDITIONAL (only once fetchDescription
// resolves a non-empty per-listing headline), while the OLD exclusion here was
// unconditional — leaving the MAJORITY case (cold start, generation failure, uncached
// listing, neutral archetype, opt-out) with NO observer at all, and the playbook
// headline permanently unrecoverable on any framework revert.
//
// Fix: arm the generic watchdog here UNLESS `adapt-description.ts` has already
// claimed ownership (checked live via the shared `headline-ownership.ts` registry,
// never memoized — so a hand-off that already happened on an earlier call is
// respected) — and record 'generic' as the owner so `adapt-description.ts` can evict
// us cleanly (`evictGenericHeadlineObserver`) the instant a per-listing headline
// arrives. Skip setting ownership when stale — a superseded call must not claim an
// element it is about to be denied writing to anyway (attachResilience below
// re-checks `isStale` itself and will no-op).
```

#### adapt.ts:728 — `applyClassDirective`

Anchor (first code line after the comment): `const ok = attachResilience(`

Kept in the code as: Desired state: `add` classes present, `remove` classes absent.

```text
// FOLLOW-791: desired end state is "every `add` class present AND every `remove`
// class absent" — a framework revert could either strip a class we added or
// re-add a class we removed, and either counts as a mismatch to repair.
```

#### adapt.ts:765 — `applyClassDirective`

Anchor (first code line after the comment):
`function applyReorderDirective(directive: ReorderDirective, context?: ApplyContext): void {`

Kept in the code as: Reorder cards by affinity score, optionally pinning the top N; idempotent.

```text
/**
 * Apply a single ReorderDirective — reorders child card elements within a container
 * by archetype affinity score (highest first). Optionally pins the top N cards.
 *
 * Fail-safe: missing container or empty card list emits adapt.skipped and returns.
 * Idempotent: same container+archetype fingerprint is skipped on repeat calls.
 */
```

#### adapt.ts:801 — `applyReorderDirective`

Anchor (first code line after the comment):
`const sortByScore = (list: HTMLElement[]): HTMLElement[] =>`

Kept in the code as: Sort by score, unscored last; reused by every repair [FOLLOW-792].

```text
// Sort by score, descending; cards with no listing-id match go to end (-Infinity).
// Extracted as a helper (rather than a one-off closure) because FOLLOW-792 requires
// this sort to run again, against freshly-queried live nodes, on every repair — see
// `applyOrder` below.
```

#### adapt.ts:814 — `applyReorderDirective`

Anchor (first code line after the comment):
`// FOLLOW-792: 'applyOrder' must NOT close over 'sorted'/'cards' — those are the specific`

Kept in the code as: `cards` is kept only for the empty-container check [FOLLOW-803].

```text
// FOLLOW-803: the first-apply snapshot (`const sorted = sortByScore(cards)`) is gone —
// its only consumer was the frozen `desiredOrder` the new set-independent predicate
// replaces. `cards` is still used above for the empty-container check.
```

#### adapt.ts:818 — `applyReorderDirective`

Anchor (first code line after the comment): `const applyOrder = (): void => {`

Kept in the code as: Re-query LIVE nodes and sort by listing id, never node identity [FOLLOW-792].

```text
// FOLLOW-792: `applyOrder` must NOT close over `sorted`/`cards` — those are the specific
// DOM node objects captured at first-apply time, and that's fine for a framework
// re-render that merely re-ORDERS the same nodes in place, but wrong for one that
// RE-MOUNTS them (React key change, Svelte `{#each}` re-key, any destroy+recreate
// re-render): the captured references become detached orphans, and re-attaching them via
// `container.prepend/append` puts them back in the DOM ALONGSIDE the framework's fresh
// replacement cards — duplicate listing cards, and because the duplicate count then
// permanently fails the length check below, every later mutation repeats the bug and
// appends yet another orphan (RETRO-244 §4a LG-1).
//
// Fix: re-query `container` for whatever `item_selector` nodes are LIVE right now, and
// sort THOSE by score (keyed by `data-estalara-listing-id`, i.e. data identity, never
// node identity). This is correct for a re-order (same nodes, re-sorted) and a re-mount
// (fresh nodes, same ids, re-sorted) alike, and it can never re-attach a node that is not
// currently a descendant of `container` — `container.append`/`prepend` only ever move
// nodes this exact query just found live.
//
// FOLLOW-792 / explicit choice for AC2: when the live id set differs from the set
// captured in `directive.scores` (a card was removed, or a new one appeared that we
// never scored), we converge on the intersection rather than disconnecting the watchdog
// and emitting `adapt.skipped`: an id that vanished from the live DOM has nothing to
// reinsert (it's simply absent from the re-sorted output), and a live id with no score
// falls to the end via the same -Infinity fallback the initial sort already uses for
// score-less cards. Both are ordinary host re-render outcomes, not a decision or
// telemetry failure — the existing `adapt.reapplied` event (emitted by `attachResilience`
// on every completed repair) is the observable signal, so no additional event is needed.
```

#### adapt.ts:862 — `applyReorderDirective`

Anchor (first code line after the comment): `const ok = attachResilience(`

Kept in the code as: "Is the live set in score order?" — independent of the card count [FOLLOW-803].

```text
// FOLLOW-803: the predicate is SET-INDEPENDENT — "is the live set currently in score
// order?", not "does the live set equal the sequence captured at first apply?".
//
// The previous version closed over `desiredOrder`, the id sequence frozen from the nodes
// present at first apply, and short-circuited on `current.length !== desiredOrder.length`.
// FOLLOW-792 made the WRITE converge on the intersection, but left this check comparing
// against the frozen sequence — so any host change to the card COUNT (a filter, a
// "load more", a sold listing removed, infinite scroll: all ordinary on a listing grid)
// made `matches()` PERMANENTLY false. The write being idempotent meant nothing
// duplicated, but every later mutation inside the container re-entered `reapply`,
// re-appended the same nodes in the same order and emitted another `adapt.reapplied`,
// without bound — an event producer that never terminates (no sampling policy fixes
// that), plus a detach/re-insert of every card on each host mutation, which resets
// scroll anchoring, drops focus and cancels in-flight CSS transitions.
//
// Comparing the live list against `sortByScore(live)` is true exactly when the order is
// already correct, for ANY live set. `pin_top_n` needs no special case: both branches of
// `applyOrder` leave the ITEMS in `sortByScore` order (the pinned branch differs only in
// where non-item children end up), and this predicate only ever inspects `item_selector`
// nodes.
```

#### adapt.ts:943 — `runApply`

Anchor (first code line after the comment): `/**`

Kept in the code as: ── Public API ──

```text
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
```

#### adapt.ts:947 — `runApply`

Anchor (first code line after the comment): `export interface FetchDirectivesResult {`

Kept in the code as: `fetchDirectives` result; commits nothing, the caller does [FOLLOW-1306].

```text
/**
 * Result envelope returned by `fetchDirectives` (FOLLOW-101).
 *
 * `adaptResponse` is the standard adapt API response (null on network failure).
 * `updatedIntentState` is set when `chat_intent_dimensions` in the response
 * triggered an `applyChatIntentPrior` call — callers should replace their local
 * `currentIntentState` with this value and persist it to sessionStorage.
 *
 * FOLLOW-1306 (F-25): this function COMMITS NOTHING — no sessionStorage write, no in-memory
 * fold key, no `quiz.mismatch` event. A response can still lose the caller's latest-wins check
 * (`refreshDirectives`), and a fold committed before that check made a discarded reply's
 * evidence permanent (and, through the old in-memory key, blocked the accepted reply from
 * folding the same stamp). The caller commits only a result it accepts.
 */
```

#### adapt.ts:966 — `FetchDirectivesResult`

Anchor (first code line after the comment): `export async function fetchDirectives(`

Kept in the code as: Fetch adaptation directives; null when unavailable or unconfigured. @param
intentState - Current intent state (archetype_hint, confidence, similarity).

```text
/**
 * Fetch adaptation directives from the Decision API.
 * Returns null if Decision API is unavailable, config.decisionApiUrl is not set,
 * or config.tenantId is not set (tenant_id is required by the Decision API).
 *
 * @param intentState - Current Bayesian intent state; threads archetype_hint, confidence,
 *   and similarity (raw archetype probability) into the request body so the Decision API
 *   can skip its own classification and serve directives immediately.
 */
```

#### adapt.ts:1009 — `fetchDirectives`

Anchor (first code line after the comment): `if (listingId !== undefined) {`

Kept in the code as: Detail pages send listing_id [FOLLOW-194].

```text
// F-13 (FOLLOW-194): include single-listing context on detail pages.
// When listingId is provided (caller detected data-estalara-listing-id on the page),
// set body.listing_id so the Decision API can activate per-listing RAG context.
```

#### adapt.ts:1026 — `fetchDirectives`

Anchor (first code line after the comment): `const sdkConsent = getConsentState();`

Kept in the code as: 'pending' never reaches here; 'unknown' is the safe mapping.

```text
// Map SDK consent state to the Decision API enum ('granted' | 'denied' | 'unknown').
// 'pending' has no equivalent — the SDK gate in index.ts halts before calling
// fetchDirectives when consent is pending, so this branch is unreachable in practice.
// Sending 'unknown' for 'pending' is the safe conservative default.
```

#### adapt.ts:1033 — `fetchDirectives`

Anchor (first code line after the comment):
`const adaptPath = profilingOptedOut ? '/adapt?profiling_opt_out=1' : '/adapt';`

Kept in the code as: Opt-out rides the URL query (§H.9) [FOLLOW-383].

```text
// FOLLOW-383 / §H.9: append profiling_opt_out=1 as a URL query param so the
// server-side GET handler gate (req.nextUrl.searchParams) fires and returns
// neutral directives without logging any variant row.
// This is the correct approach because Next.js reads searchParams from the URL,
// not the POST body — appending to the URL works regardless of HTTP method.
```

#### adapt.ts:1052 — `fetchDirectives`

Anchor (first code line after the comment): `let response: AdaptResponse;`

Kept in the code as: Validate the response shape; Sentry + null on failure [FOLLOW-105].

```text
// FOLLOW-105 §F.5 / ADR-0006 §Decision 5A: validate the response against the
// canonical AdaptationDirectives shape instead of an unchecked cast. On parse
// failure (missing required field, type mismatch, out-of-enum archetype, …),
// report to Sentry when available and return null gracefully — never throw.
```

#### adapt.ts:1068 — `fetchDirectives`

Anchor (first code line after the comment): `const dims = response.chat_intent_dimensions;`

Kept in the code as: Chat prior: once per message via the persisted stamp (Rule R) [FOLLOW-1024,
FOLLOW-635].

```text
// ── FOLLOW-101 / FOLLOW-252 / FOLLOW-1024: chat-intent Bayesian prior bridge ──
//
// When the control-plane found a shadow chat-intent key for this session,
// `chat_intent_dimensions` is a non-empty Record<string,string>.
//
// FOLLOW-1024 (CEO ruling 2026-08-18) — fold once per MESSAGE, not once per session.
// The old gate applied the prior exactly once and then ignored chat for the rest of the
// session. The reasoning against that: buyers click through the quiz without reading it,
// or answer it with the property they THINK they want, and their real need only surfaces
// in the questions they go on to ask. Sampling that conversation at message one throws
// away the evidence that is worth the most.
//
// Rule R is unchanged in substance. Its requirement was never "once per session" — it was
// "never count the SAME extraction twice", which matters because the shadow key is
// returned on EVERY adapt call for 24h; without a gate the same evidence would be
// multiplied in on every page view until the posterior pinned at 1.0. The gate is now the
// extraction's own stamp instead of a boolean.
//
// THE GUARD (a double guard until FOLLOW-1306):
//
//   1. `intentState.chatPriorAppliedAt !== detectedAt` — PRIMARY, persisted in the
//      sessionStorage IntentState envelope, so it survives a hard reload inside the 24h
//      shadow-key window (RETRO-047 LG-1).
//
//   2. (removed by FOLLOW-1306) an in-memory module key — it was set BEFORE the caller's
//      latest-wins check, so a discarded stale reply could block the accepted one. The
//      caller's in-memory `currentIntentState` carries the stamp once a fold is accepted.
//
// NO STAMP → LEGACY BEHAVIOUR. A shadow record written before `detected_at` was read here
// yields `hasStamp === false`, and the guard falls back to the boolean — i.e. exactly the
// pre-FOLLOW-1024 once-per-session semantics. Re-folding an unstamped record on every call would be the saturation bug, so the fallback is the safe
// direction, not the convenient one.
//
// FOLLOW-635 (CEO ruling, option A, 2026-07-24): this update DOES change
// which directives are served, just not on this call. `applyChatIntentPrior`
// updates `intentState.archetype`, which is persisted and sent as
// `body.archetype_hint` on the NEXT adapt() call (see `archetype_hint`
// usage below) — the control-plane uses that hint to pick `archetypeId`,
// which drives the decision tree and reorder directive. So chat intent is
// live-influencing across calls via this client loop, not "purely
// behavioural." The IntentState update also still feeds disagreement-rate
// analysis and quiz.mismatch detection (unchanged).
```

#### adapt.ts:1126 — `fetchDirectives`

Anchor (first code line after the comment): `const markedIntentState = {`

Kept in the code as: `chatPriorAppliedAt` gates the next fold (Rule R) [FOLLOW-1024].

```text
// Persisted markers (Rule R / FOLLOW-252 / FOLLOW-1024). `chatPriorApplied` stays for
// the unstamped fallback and for "has chat ever spoken in this session" analytics;
// `chatPriorAppliedAt` is the marker that actually gates the next fold.
```

#### adapt.ts:1144 — `fetchDirectives`

Anchor (first code line after the comment): `export function applyDirectives(`

Kept in the code as: Apply directives to the DOM; never throws, idempotent, emits adapt events.
@param directives - TextDirective, ClassDirective or ReorderDirective from @estalara/shared @param
context - Optional session context for event attribution

```text
/**
 * Apply adaptation directives to the page DOM.
 *
 * Accepts the shared TextDirective | ClassDirective | ReorderDirective union from @estalara/shared.
 * Never throws — designed to be resilient on third-party host pages.
 *
 * Features:
 * - TextDirective: replaces textContent with optional {token} placeholder interpolation
 * - ClassDirective: adds/removes CSS classes; selector must match [data-estalara-*]
 * - ReorderDirective: reorders listing card elements by archetype affinity score
 * - Idempotency: same directive fingerprint is skipped on repeat calls
 * - DOM-ready guard: if DOM is still loading, defers application to DOMContentLoaded
 * - Event logging: emits adapt.applied / adapt.skipped into the SDK event queue
 *
 * @param directives - Array of TextDirective, ClassDirective, or ReorderDirective from @estalara/shared
 * @param context    - Optional session context for event attribution
 */
```

### `packages/sdk/src/index.ts`

#### index.ts:1 — module header

Anchor (first code line after the comment): `import { boot } from './core/boot.js';`

Kept in the code as: Estalara Adaptive Listings SDK; NEVER throws on a host page. @module
@estalara/sdk

```text
/**
 * Estalara Adaptive Listings SDK — Tier 1 Observer
 *
 * Initialized by a <script> tag with data-api-key attribute.
 * Collects behavioral signals and sends them to the Ingest Worker.
 *
 * NEVER throws — designed to be resilient on third-party websites.
 * All errors are caught and silenced (debug mode logs to console).
 *
 * @module @estalara/sdk
 */
```

#### index.ts:28 — module header

Anchor (first code line after the comment): `export { mergeQuizConfig } from './core/boot.js';`

Kept in the code as: init() phases live in core/\*; re-exported to keep the public surface
[FOLLOW-1296].

```text
// FOLLOW-1296: `init()` is composed from four phases — `core/boot.ts` (config, session, consent
// gate), `core/consent-flow.ts` (banner + opt-out toggle), `core/intent-loop.ts` and
// `core/adapt-loop.ts`. These symbols were defined in this file before the split; re-exported so
// the public surface is unchanged.
```

#### index.ts:50 — `BATCH_INTERVAL_MS`

Anchor (first code line after the comment): `async function init(): Promise<IntentState | null> {`

Kept in the code as: Main SDK init, never breaks the host; returns state for `_initForTest` only
[FOLLOW-1296].

```text
/**
 * Main SDK initialization — called automatically when DOM is ready.
 * Wraps everything in try/catch to ensure the host page is never broken.
 *
 * Returns the final resolved IntentState after all priors and rehydration have
 * been applied, or `null` when init exits early (no script tag, consent denied,
 * or an unrecoverable error). This return value is used ONLY by `_initForTest`.
 *
 * FOLLOW-1296: the phases run in the order the former single body ran them; every piece of
 * state they share is on the boot context (`ctx`) or in a closure one phase hands the next.
 */
```

#### index.ts:74 — `init`

Anchor (first code line after the comment): `const flush = (force?: boolean): Promise<void> =>`

Kept in the code as: 7. Flush on interval and unload; failed batches are retried [FOLLOW-1242].

```text
// 7. Flush events on interval and page unload.
// FOLLOW-1242: a failed send no longer loses the batch — retryable failures are held in
// pendingBatches (per SDK instance) and re-sent with the same Idempotency-Key; see
// dispatchEvents().
```

#### index.ts:111 — `init`

Anchor (first code line after the comment): `ctx.on(window, 'beforeunload', () => {`

Kept in the code as: Final intent.snapshot on unload, bound to the instance lifetime [FOLLOW-266].

```text
// K.3.6 FOLLOW-266 Phase 3: emit a final intent.snapshot on beforeunload so the
// ingest pipeline always receives the session-end archetype state.
// Bound to the instance lifetime so teardown removes it — avoids a memory leak on SPA
// navigations where destroy() is called without a page reload.
```

#### index.ts:132 — `init`

Anchor (first code line after the comment): `teardownAdaptObservers();`

Kept in the code as: destroy() does not call resetAdaptState() [FOLLOW-791].

```text
// FOLLOW-791 AC5: disconnect the generic directive pipeline's resilience observers
// too, mirroring teardownDescriptionObservers() above — resetAdaptState() (called on
// cross-listing nav / archetype change) already covers those cases; this covers the
// explicit SDK destroy() / SPA-teardown path, which does not call resetAdaptState().
```

#### index.ts:139 — `init`

Anchor (first code line after the comment): `ctx.lifetime.abort();`

Kept in the code as: Detach listeners and invalidate in-flight replies on teardown [FOLLOW-1306].

```text
// FOLLOW-1306 (F-24): detach every host listener bound to the instance lifetime (chat,
// live.signup, inquiry.completed, favorites, visibilitychange, and K.3.6 FOLLOW-266's
// beforeunload), then cancel a pending chat refresh (FOLLOW-1026) and invalidate the
// current generation so a reply still in flight cannot apply to a torn-down page.
```

#### index.ts:172 — `init`

Anchor (first code line after the comment):
`export type { DetectionResult } from './auto-detect/pipeline.js';`

Kept in the code as: Auto-detect stays on its own sub-path, out of the IIFE bundle [FOLLOW-324].

```text
// ─── Auto-detect sub-module ────────────────────────────────────────────────────
// detectSiteSchema is available via the '@estalara/sdk/auto-detect' sub-path export.
// It is NOT re-exported from the top-level index to keep the IIFE (Tier 1+2) bundle
// under the 40KB gzip limit. All production consumers (apps/control-plane/src/app/api/detect)
// already import from '@estalara/sdk/auto-detect' directly. (FOLLOW-324)
// DetectionResult is re-exported from pipeline.ts directly (not via index.ts) to avoid
// pulling auto-detect/index.ts into the bundle chain — index.ts exports value symbols
// (detectInquirySubmitSelector etc.) that would be bundled otherwise.
```

#### index.ts:182 — `init`

Anchor (first code line after the comment):
`export async function _initForTest(): Promise<IntentState | null> {`

Kept in the code as: Test-only seam running the real `init()` (Rule Q); never call from production.
@internal — exported for test infrastructure only.

```text
/**
 * Test-only seam: invoke the real `init()` body from jsdom integration tests.
 *
 * Returns the final resolved `IntentState` after all priors, rehydration, and
 * cold-start gates have been applied — giving tests direct in-memory access to
 * the state without re-implementing any logic. Returns `null` on early-exit paths
 * (no script tag, consent denied, banner denied, unrecoverable error).
 *
 * This export exists so tests can drive the PRODUCTION wiring (rehydration gate,
 * cold-start prior gate, LG-2 persist gate) without reimplementing its logic
 * locally. It MUST NOT be called from production code.
 *
 * Rule Q (amended 2026-06-08): acceptance tests must import + invoke the real
 * entrypoint, never re-implement its body. This seam satisfies that requirement:
 * mutating a gate in `init()` (e.g. dropping a `!`) will turn any test that
 * calls `_initForTest()` RED, because the test drives the real gate. The returned
 * state makes ALL four gates catchable — including referrer/device priors that only
 * live in-memory and are never written back to sessionStorage on a rehydrated session.
 *
 * @internal — exported for test infrastructure only. Tree-shaken in production
 * by the loader (the loader never imports from the SDK entry point directly;
 * it `import()`s the tier bundle, which does not call _initForTest).
 */
```

### `packages/sdk/src/core/boot.ts`

#### boot.ts:1 — module header

Anchor (first code line after the comment): `import { readConfig, BOT_UA_RE } from './config.js';`

Kept in the code as: Boot phase of `init()`: everything up to the initial intent state
[FOLLOW-1296]. @module

```text
/**
 * Boot phase of `init()` (FOLLOW-1296): bot gate, script tag and config, the consent gate,
 * the anonymous session, the per-user opt-out read, the first two queued events, intent-state
 * rehydration, the parallel server-config fetch and the cold-start priors — i.e. everything up
 * to the initial intent state the intent and adapt loops start from.
 *
 * Returns the {@link BootContext} every later phase works on, or `null` when init must stop
 * (bot, no script tag, consent denied / not obtained). Nothing here is module-level state: the
 * context is created per `init()` call (RETRO-006 LG-2).
 *
 * @module
 */
```

#### boot.ts:44 — module header

Anchor (first code line after the comment): `export interface BootContext {`

Kept in the code as: Per-`init()` state; only `state` and `optedOut` change after boot.

```text
/**
 * Per-`init()` state shared by the boot, consent-flow, intent-loop and adapt-loop phases.
 *
 * `state` and `optedOut` are the only fields written after boot: the intent loop and the adapt
 * loop both read and write the live intent state, and the opt-out toggle flips `optedOut`. Every
 * other field is fixed once boot returns.
 */
```

#### boot.ts:78 — `BootContext`

Anchor (first code line after the comment): `export function mergeQuizConfig(`

Kept in the code as: Overlay fetched quiz config onto SdkConfig; null → unchanged (ADR-0011)
[FOLLOW-275]. @internal exported for tests only

```text
/**
 * Merge server-fetched quiz config into SdkConfig (ADR-0011, FOLLOW-275).
 *
 * Overlays `{ quiz_enabled, language, accent_color }` from the
 * `GET /api/quiz/public-config` response onto the already-parsed SdkConfig.
 *
 * When `fetched` is `null` (network error / timeout / parse failure) the original
 * config is returned unchanged — callers already hold snippet-attribute fallback values
 * from `readConfig()`, which are themselves a fallback to hardcoded defaults.
 *
 * Called in `init()` AFTER `resolveConsent()` and BEFORE `scheduleQuizTrigger()`
 * (ADR-0011 init sequence step 4).
 *
 * @internal exported for tests only
 */
```

#### boot.ts:103 — `mergeQuizConfig`

Anchor (first code line after the comment): `...(fetched.brand`

Kept in the code as: Absent brand → key omitted, unbranded tenants byte-identical [FOLLOW-623].

```text
// FOLLOW-623 / ADR-0019: overlay the optional brand slice. Absent → key omitted
// (conditional spread for exactOptionalPropertyTypes) so an unbranded tenant is
// byte-identical to pre-ADR-0019. `logo_url` stays `string | null`, never undefined.
```

#### boot.ts:127 — `mergeQuizConfig`

Anchor (first code line after the comment):
`function isValidIntentState(raw: unknown): raw is IntentState {`

Kept in the code as: Structural guard for a persisted IntentState [FOLLOW-176].

```text
/**
 * Structural type guard for a persisted IntentState envelope.
 *
 * Validates that a rehydrated `unknown` value from sessionStorage has the
 * required fields of IntentState before it is used as one. Intentionally
 * permissive on the `probabilities` sub-object — a full per-archetype check
 * would be expensive and adds no safety beyond the top-level fields.
 *
 * FOLLOW-176: called once per `init()` during rehydration; never called on
 * the hot path.
 */
```

#### boot.ts:159 — `boot`

Anchor (first code line after the comment):
`const navGlobal = (globalThis as { navigator?: { userAgent?: string } }).navigator;`

Kept in the code as: Bot gate before any session or data work [FOLLOW-099].

```text
// FOLLOW-099 AC7 (CEO-ratified): Bot detection gate.
// Any known crawler UA short-circuits init before session creation, DOM mutation,
// or any data collection.  Uses globalThis.navigator to avoid esbuild constant-folding
// of `typeof navigator` checks (same pattern as language detection in config.ts).
```

#### boot.ts:168 — `boot`

Anchor (first code line after the comment): `const sessionStartedAt = Date.now();`

Kept in the code as: Set before any await: one origin for view rates [FOLLOW-208].

```text
// FOLLOW-208: Record session start time for listing-view-rate computation.
// Must be set before any async await so all listing.viewed callbacks reference
// the same origin timestamp for rate = viewCount / (elapsedMs / 60_000).
```

#### boot.ts:177 — `boot`

Anchor (first code line after the comment): `let config = readConfig({ dataset: script.dataset });`

Kept in the code as: 2. Config from data-\* (`let`: mergeQuizConfig replaces it).

```text
// 2. Read configuration from data-* attributes
// `config` is declared with `let` because mergeQuizConfig() may replace it later
// (ADR-0011 step 4: fetchQuizConfig → mergeQuizConfig overlays server values).
```

#### boot.ts:192 — `boot`

Anchor (first code line after the comment): `try {`

Kept in the code as: Lead id = SHA-256 prefix of the `sub`, sessionStorage only (Rule L)
[FOLLOW-197].

```text
// FOLLOW-197 / CHAT-003: Registered user lead_id derivation.
// If a Keycloak JWT is present in localStorage ('kc_token'), derive a pseudonymous
// lead_id from the 'sub' claim and store it in sessionStorage (tab-lifetime only).
// Rule L: the raw user_uuid is NEVER stored — only the SHA-256 16-char hex prefix.
// Mode A compliance: sessionStorage only, never localStorage for this identifier.
// Failures are silently swallowed — anonymous users continue with xid-based tracking.
```

#### boot.ts:223 — `boot`

Anchor (first code line after the comment): `let storedLeadId: string | undefined;`

Kept in the code as: Per-user profiling opt-out; AL DOM adaptation only (§H.9) [FOLLOW-372].

```text
// FOLLOW-372 / §H.9: Read per-user profiling opt-out state.
// Read after lead_id derivation so the opt-out key can be scoped to the user.
// The userId used here is the same SHA-256 lead_id prefix stored in sessionStorage —
// it is not raw PII (Rule L). For anonymous sessions the unscoped key is used.
//
// Scope boundary: this flag suspends AL DOM adaptation only. It does NOT affect
// app.estalara.com buying-intent identification, lead ranking, or agent-facing
// chat summaries (those ride the mandatory registration consent per §H.8).
```

#### boot.ts:242 — `boot`

Anchor (first code line after the comment): `let intentStateRehydrated = false;`

Kept in the code as: 4a. Rehydrate first, so cold-start priors never apply twice [FOLLOW-176].

```text
// 4a. Initialize Bayesian intent state.
// FOLLOW-176: attempt to rehydrate a previously persisted intent state before
// cold-start. A successful rehydrate means the visitor already accumulated
// signals on a prior listing page in this tab — skip cold-start hints so the
// prior archetype is not diluted by site-level priors applied a second time.
//
// Consent gate: we only reach this line when consent is 'granted' (all denial
// paths return early above). No re-check needed here.
//
// ADR-0012 Ticket C: the state starts as `initIntentState()` (no overrides yet) as a
// temporary placeholder for the rehydration check. The server-supplied priors
// (intentOverrides) are applied by the cold-start gate below, AFTER the parallel fetch
// completes.
```

#### boot.ts:266 — `boot`

Anchor (first code line after the comment):
`const referrer = (globalThis as { document?: { referrer?: string } }).document?.referrer ?? '';`

Kept in the code as: Needed by session.started either way [FOLLOW-202].

```text
// Read referrer, UTM, and device width unconditionally — required by session.started
// below regardless of whether state was rehydrated.
// globalThis property access prevents esbuild dead-code elimination (FOLLOW-202 pattern).
```

#### boot.ts:308 — `boot`

Anchor (first code line after the comment):
`let intentOverrides: IntentEngineOverrides = resolveIntentOverrides(null);`

Kept in the code as: 3a quiz config + 3b intent weights in parallel, 1 s each (ADR-0011, ADR-0012).

```text
// ADR-0012 Ticket C (FOLLOW-268-sdk) + ADR-0011 (FOLLOW-275):
// Steps 3a + 3b run IN PARALLEL — both fetches are bounded to 1000ms each
// and must both complete (or timeout) before steps 5–8 run.
//
//   3a. fetchQuizConfig  — GET /api/quiz/public-config (ADR-0011)
//   3b. fetchIntentWeights — GET /api/intent/config (ADR-0012)
//
// Rule R gate: `intentStateRehydrated` is passed to `fetchQuizConfig()` so that
// cross-listing navigations within the same tab reuse the sessionStorage-cached
// quiz config instead of re-fetching. Intent weights are NOT cached because they
// are applied once to initIntentState and the resulting IntentState is rehydrated
// from sessionStorage on subsequent navigations (see session.ts / Rule R comment).
//
// `config` is reassigned here (declared `let` above for exactly this purpose).
// On any failure either fetch returns null; mergeQuizConfig / resolveIntentOverrides
// fall back to snippet-attribute values / SDK internal defaults respectively.
```

#### boot.ts:335 — `boot`

Anchor (first code line after the comment):
`fetchIntentWeights(config.decisionApiUrl, config.apiKey, 1_000, config.debug),`

Kept in the code as: 3b: fetched even when rehydrated; not applied then.

```text
// Step 3b: fetch intent weight overrides (ADR-0012 Ticket C).
// On a rehydrated session, the intent state is already persisted with the
// cold-start priors applied — refetching weights would not affect the
// rehydrated distribution. We still fetch so any weight config change is
// observable in debug mode; the result is passed to resolveIntentOverrides
// which is a no-op when intentStateRehydrated=true (overrides are not applied
// to the already-rehydrated state — see the cold-start gate below).
```

#### boot.ts:354 — `boot`

Anchor (first code line after the comment): `if (!intentStateRehydrated && !profilingOptedOut) {`

Kept in the code as: Single cold-start gate: add new cold-start priors INSIDE it [FOLLOW-219,
FOLLOW-372].

```text
// FOLLOW-219 / ADR-0012 Ticket C: Single cold-start gate.
// ALL init-time priors and the LG-2 persist live inside this one block so the
// guard cannot be partially applied.
//
// Placed AFTER the parallel fetch (step 3a/3b) so that `initIntentState` can
// be called with server-supplied `intentOverrides` (ADR-0012 §3 init sequence step 6).
//
// Why each step is skipped on rehydration:
//   - initIntentState(overrides): rehydrated state already has all cold-start priors
//     baked in; applying overrides again would double-count and perturb the distribution.
//   - Archetype hints (4a-f02): already folded in on the first listing page (FOLLOW-176).
//   - Referrer + device (FOLLOW-207, FOLLOW-216 LG-1): already applied on the first page;
//     re-applying would perturb the archetype and inflate signal_count by +1 per nav.
//   - LG-2 persist (FOLLOW-216): the persisted entry is already current; a second write is
//     a no-op in terms of state but would be caught as a double-write by follow-217 tests.
//
// Adding a new cold-start prior: add it INSIDE this block. A prior added outside this block
// without its own guard would be caught by the follow-217 integration tests (signal_count
// is asserted unchanged on every rehydrated-session test).
// FOLLOW-372 / §H.9: When opted out, skip ALL profiling cold-start priors.
// Accumulated archetype/intent state in sessionStorage is preserved (reversible suspend).
// The toggle resumes full adaptation with no data loss when flipped back ON.
```

#### boot.ts:377 — `boot`

Anchor (first code line after the comment): `currentIntentState = initIntentState(intentOverrides);`

Kept in the code as: Step 6 (ADR-0012): re-init with server priors.

```text
// Step 6 (ADR-0012): re-initialize with server-supplied priors now that the fetch
// has completed. `intentOverrides` contains server values (or SDK defaults on null).
// This replaces the temporary `initIntentState()` placeholder from step 4a above.
```

#### boot.ts:395 — `boot`

Anchor (first code line after the comment):
`persistIntentState(currentSession.sessionId, currentIntentState);`

Kept in the code as: Persist cold-start state once for the first navigation [FOLLOW-216].

```text
// FOLLOW-216 (LG-2): Persist the cold-start intent state (after all init-time priors have
// been applied) once, before the first refreshDirectives(). This ensures the very first
// cross-listing navigation in the same tab can rehydrate the cold-start archetype even if
// no behavioral signal has fired yet (the intent loop's persist is the only other persist
// site, but it fires only after a behavioral event).
```

#### boot.ts:403 — `boot`

Anchor (first code line after the comment): `const lifetime = new AbortController();`

Kept in the code as: Instance lifetime; teardown aborts every listener [FOLLOW-1306].

```text
// FOLLOW-1306 (F-24): this instance's lifetime. Every host listener registered by init() goes
// through `on()` and is bound to it; teardown aborts it, so a torn-down SDK no longer answers
// host events with requests.
```

### `packages/sdk/src/core/consent-flow.ts`

#### consent-flow.ts:1 — module header

Anchor (first code line after the comment): `import type { SdkConfig } from './config.js';`

Kept in the code as: Consent gate and §H.9 opt-out toggle (ADR-0021) [FOLLOW-1296, FOLLOW-372].
@module

```text
/**
 * Consent flow (FOLLOW-1296): the consent gate run by `boot()` (TICKET-041, ADR-0021) and the
 * §H.9 per-user profiling opt-out toggle mounted after the first decision cycle (FOLLOW-372).
 *
 * @module
 */
```

#### consent-flow.ts:64 — `resolveConsent`

Anchor (first code line after the comment):
`const consentCopy = await fetchConsentText(config.language);`

Kept in the code as: No TENANT-data fetch before consent, but the consent-text GET MUST precede the
banner (ADR-0021 §D5).

```text
// Show banner and wait for the user's decision.
// Returns true if consent was granted, false if denied.
//
// FOLLOW-278 / ADR-0011 (§Consent-banner locale) — Accepted constraint, SCOPED by
// ADR-0021 §D5 (FOLLOW-915, compliance-countersigned 2026-08-09):
// The consent banner renders here, BEFORE fetchQuizConfig() resolves (step 3
// in the ADR-0011 init sequence).  By design, THAT fetch runs AFTER consent is
// resolved — the consent gate must precede any network call that reads TENANT
// DATA, so the banner can never receive the server-fetched language/accentColor.
//
// READ THE SCOPE CAREFULLY. ADR-0011's addendum sentence "the consent banner
// cannot wait for the fetch" denotes fetchQuizConfig() and is superseded as a
// general claim by ADR-0021 §D5: the banner DOES wait for one fetch — the
// identifier-free consent-text GET immediately below — and under ADR-0021 it
// MUST. The tenant-data prohibition above is re-affirmed byte-intact (§D1); what
// fell was an ordering consequence that carried no compliance rationale of its
// own. Do not re-generalise it: a future reader who reads the paragraph above as
// "no fetch may precede consent" will delete a legally required disclosure fetch.
//
// `config.language` at this point is sourced from the `data-language` snippet
// attribute (level 2) or the browser's navigator.language (level 3) or the
// hardcoded 'en' default (level 4).  `buildSnippet()` has NEVER emitted
// `data-language` or `data-accent-color` — these attributes were not part of
// the snippet transport and were not retired by ADR-0011 (ADR-0011 only retired
// `data-quiz-enabled` and the since-removed micro-poll attribute).  As a result, for tenants
// who do not hand-code those attributes, the banner always uses the
// navigator.language or 'en' fallback.
//
// Decision: this constraint is accepted (option iii of FOLLOW-278 AC1):
//   - Compliance confirmed no locale-specific legal text in the banner that
//     would make an 'en' banner a legal defect in a pl/es jurisdiction.
//   - The quiz widget (rendered AFTER mergeQuizConfig()) correctly uses the
//     server-fetched language; only the pre-consent banner is affected.
//   - If a locale-specific consent banner becomes a compliance requirement,
//     the fix is to ADD `data-language` to buildSnippet() for the first time
//     (a new feature, not a re-introduction) and update ADR-0011 accordingly.
//     See the "Consent-banner locale" addendum section added to
//     docs/adr/ADR-0011-quiz-config-transport.md by FOLLOW-278.
// ADR-0021 §D2 — the banner copy is fetched, not bundled (ESC-051 / FOLLOW-915).
// Identifier-free static GET, awaited HERE so that everything capable of profiling
// is sequenced behind it: a slow fetch delays the banner and the product equally,
// never the banner alone. Skipped entirely on the granted/denied paths above, so a
// returning visitor pays no extra request.
```

#### consent-flow.ts:110 — `resolveConsent`

Anchor (first code line after the comment): `earlyHost.destroy();`

Kept in the code as: §D4 fail closed: no banner, no events, NO fallback text (ADR-0021 §D5)
[ESC-051].

```text
// §D4 FAIL CLOSED — no banner, no events, no storage writes, no tenant-identified
// request; consent remains 'pending' (NOT recorded as denied) and the fetch is
// retried naturally on the next page load.
//
// There is deliberately NO built-in fallback text. A trimmed fallback recreates
// the ESC-051 defect — disclosure content degraded by an engineering constraint —
// and consent obtained on an incomplete disclosure is not "informed" under GDPR
// Art. 4(11)/Art. 7, which would invalidate the lawful basis of everything
// downstream. Compliance ruled this fail-closed path COMPLIANCE-SUPERIOR, not
// merely engineering-preferable (ADR-0021 §D5 countersign, item 3): the visitor
// who is not noticed is also not profiled, and GDPR does not require notifying
// people about processing that does not occur.
//
// Availability cost accepted per §D4: if the control-plane origin cannot serve a
// static file, the adapt endpoint on that same origin is down too.
```

#### consent-flow.ts:186 — `resolveConsent`

Anchor (first code line after the comment): `if (consentState === 'granted') {`

Kept in the code as: Returning visitor: ensure the xid before session init (DPIA §13.2)
[FOLLOW-139].

```text
// DPIA §13.2 / FOLLOW-139: ensure cross-session xid exists when consent is already granted
// on this init call (returning visitor). Fire-and-forget — FOLLOW-146 will attach xid to
// event payloads. Must run before session init so the key is populated before any events fire.
```

#### consent-flow.ts:195 — `resolveConsent`

Anchor (first code line after the comment): `export function mountOptOutToggle(`

Kept in the code as: 5b. §H.9 opt-out toggle; AL DOM adaptation only [FOLLOW-372]. @returns The
toggle controller, or `null` when there is no shadow host.

```text
/**
 * 5b. Mount the per-user profiling opt-out toggle (FOLLOW-372 / §H.9).
 * Visible to logged-in users; renders at bottom-left fixed in Shadow DOM.
 * The toggle controls AL DOM adaptation only — NOT buying-intent / lead-ranking /
 * agent chat-summaries (those ride mandatory registration consent per §H.8).
 *
 * @returns The toggle controller, or `null` when there is no shadow host.
 */
```

### `packages/sdk/src/core/intent-loop.ts`

#### intent-loop.ts:1 — module header

Anchor (first code line after the comment):
`import { emitIntentSnapshot } from './intent-snapshot.js';`

Kept in the code as: Intent loop: persistence, dwell, observers, quiz, favorites [FOLLOW-1296].
@module

```text
/**
 * Intent loop (FOLLOW-1296): everything in `init()` that moves the Bayesian intent state from
 * the page after boot — persistence, the dwell timer, the behavioral observers, the quiz and the
 * favorites bridge (the cold-start priors are the last step of `boot()`). Directive fetching lives in the adapt loop; this module calls it
 * through the {@link AdaptLoop} handed to {@link IntentLoop.wire}.
 *
 * The live state is `ctx.state` on the shared {@link BootContext}; nothing here is module-level.
 *
 * @module
 */
```

#### intent-loop.ts:80 — `createIntentLoop`

Anchor (first code line after the comment):
`persistIntentState(currentSession.sessionId, ctx.state);`

Kept in the code as: Persist for later pages in this tab [FOLLOW-176].

```text
// FOLLOW-176: persist the latest intent state to sessionStorage so subsequent
// listing page loads in this tab can rehydrate immediately.
// Consent is guaranteed at this point — all denial paths return early in boot().
```

#### intent-loop.ts:94 — `createIntentLoop`

Anchor (first code line after the comment): `const snapshotCtx: IntentSnapshotContext = {`

Kept in the code as: Per-instance snapshot context (RETRO-006 LG-2) [FOLLOW-266].

```text
// K.3.6 FOLLOW-266 Phase 3 — intent.snapshot emission context.
// A mutable object so quizCompleted / quizLeaf / chatTurns can be updated in-place
// by the quiz and chat-message callbacks without redeclaring.
// Per-instance (not module-level) to satisfy RETRO-006 LG-2.
```

#### intent-loop.ts:111 — `createIntentLoop`

Anchor (first code line after the comment): `function startDwellTimer(): void {`

Kept in the code as: Dwell timer; ticks stop at the persisted session cap (Rule R) [FOLLOW-227].

```text
/**
 * Start (or restart) the dwell-time boost timer for the current listing page.
 *
 * Rehydrate strategy (Rule R / FOLLOW-227):
 *   `IntentState.dwell_ticks_applied` is persisted to sessionStorage and carried
 *   across the rehydrate boundary on every cross-listing navigation.  Each tick
 *   below checks whether `(ctx.state.dwell_ticks_applied ?? 0)` has
 *   already reached `DWELL_MAX_SESSION_CONTRIBUTION` before calling
 *   `applyDwellSignal` — so a rehydrated state that already received all three
 *   threshold boosts on listing A will NOT receive them again on listing B.
 *
 *   The timer itself is always started when the Decision API returns a non-neutral
 *   archetype (including on a rehydrated session), because the elapsed-time clock
 *   resets per page.  What changes is whether each tick is allowed to apply a boost.
 */
```

#### intent-loop.ts:163 — `createIntentLoop`

Anchor (first code line after the comment): `logoUrl: config.brand?.logoUrl ?? null,`

Kept in the code as: Brand logo; null renders none (ADR-0019) [FOLLOW-623].

```text
// FOLLOW-623 / ADR-0019: brand logo atop the quiz card. `string | null` (never
// undefined) — null renders no logo (byte-identical to pre-ADR-0019). D4 color
// precedence keeps the card accent on `accent_color`. FOLLOW-1015 deleted the sticky
// trigger, so the opt-out toggle is brand.primary_color's only SDK consumer now.
```

#### intent-loop.ts:171 — `createIntentLoop`

Anchor (first code line after the comment):
`...(config.quizPlacement ? { placement: config.quizPlacement } : {}),`

Kept in the code as: Per-brand card placement (ADR-0019 D2) [FOLLOW-640].

```text
// FOLLOW-640 / ADR-0019 D2: per-brand placement. This used to position the sticky
// trigger; FOLLOW-1015 deleted that and anchored the auto-opening CARD instead, so the
// served slice keeps a real consumer. Absent → DEFAULT_QUIZ_PLACEMENT (bottom-left
// 24/96, clearing the opt-out toggle).
```

#### intent-loop.ts:180 — `createIntentLoop`

Anchor (first code line after the comment): `const cleanupObservers = setupObservers(`

Kept in the code as: 6. Observers; pass the inquiry selector or inquiry.started never fires
[FOLLOW-097].

```text
// 6. Set up behavioral observers, wiring listing view count for quiz.
//    Pass inquirySubmitSelector from config so the inquiry click observer
//    actually registers — fixes the RETRO-008/RETRO-009 bug where
//    inquiry.started never fired in production because the options argument
//    was omitted at the call site (FOLLOW-097).
```

#### intent-loop.ts:189 — `createIntentLoop`

Anchor (first code line after the comment): `if (ctx.optedOut) return;`

Kept in the code as: §H.9 opt-out: drop behavioural events entirely [FOLLOW-383].

```text
// FOLLOW-383 / §H.9: When opted out, drop behavioral events entirely.
// Do NOT push to the event queue — opted-out events would be sent to ingest and
// could contaminate archetype training data. The FOLLOW-372 spec states that
// profiling opt-out SUPPRESSES variant logging entirely; sending behavioral
// events to the training pipeline would violate that boundary.
```

#### intent-loop.ts:201 — `createIntentLoop`

Anchor (first code line after the comment): `const prevSignalCount = ctx.state.signal_count;`

Kept in the code as: Server damping/likelihoods apply (ADR-0012).

```text
// Update Bayesian intent state from this behavioral signal.
// Pass intentOverrides so server-supplied damping and likelihoods are used
// for all ongoing behavioral signals (ADR-0012 Ticket C).
```

#### intent-loop.ts:208 — `createIntentLoop`

Anchor (first code line after the comment): `if (event.type === 'listing.viewed') {`

Kept in the code as: View rate from the second view [FOLLOW-208].

```text
// FOLLOW-208: Apply listing-view rate signal after the second view.
// Rate = viewCount / (elapsedMs / 60_000). Only fires when viewCount >= 2
// (first view is baseline). applyListingViewRate is a pure function — it
// returns state unchanged for any case that does not match a boost bracket.
```

#### intent-loop.ts:233 — `createIntentLoop`

Anchor (first code line after the comment): `if (`

Kept in the code as: intent.snapshot every 5 signals [FOLLOW-266].

```text
// K.3.6 FOLLOW-266 Phase 3: emit intent.snapshot every 5 behavioral signals.
// Fire-and-forget — emitIntentSnapshot is synchronous (queue push only).
// Condition: signal_count crossed a 5-multiple boundary on THIS signal.
```

#### intent-loop.ts:246 — `createIntentLoop`

Anchor (first code line after the comment): `config.inquirySubmitSelector !== undefined`

Kept in the code as: Selector required for inquiry.started [FOLLOW-097].

```text
// Thread inquiry_submit_selector from tenant site schema → SdkConfig → observer options.
// This was the root cause of inquiry.started never firing in production (FOLLOW-097).
// Build options object conditionally to satisfy exactOptionalPropertyTypes strictness.
```

#### intent-loop.ts:254 — `createIntentLoop`

Anchor (first code line after the comment): `function openQuiz(): void {`

Kept in the code as: Quiz auto-opens; `quiz.enabled === false` disables it [FOLLOW-1015,
FOLLOW-102].

```text
// FOLLOW-1015: the quiz OPENS ITSELF as soon as consent + config have resolved — there is
// no sticky trigger button to click any more (the old 30s "Find your match →" prompt is
// gone). The visitor closes the card if they do not want to answer; that sets the 24h
// dismissal cooldown so it does not reappear on the next page view.
//
// FOLLOW-102: config.quiz?.enabled === false suppresses the quiz entirely for
// tenants that rely on behavioral + chat NLP signals only (§B.1 / §D.6).
// No prompt, no widget, no quiz events are emitted when the quiz is disabled.
```

#### intent-loop.ts:263 — `createIntentLoop`

Anchor (first code line after the comment): `if (ctx.optedOut) return;`

Kept in the code as: §H.9: suppresses the completion event too [FOLLOW-409].

```text
// §H.9 opt-out: suppress AL profiling. NOTE: unlike the favorites handler (where
// listing.bookmarked is pushed BEFORE its guard), the quiz.event step:'completed'
// push below is INSIDE the quiz completion callback — DOWNSTREAM of this early return.
// opted-out sessions never reach it: the ingest event IS suppressed here (FOLLOW-409).
```

#### intent-loop.ts:279 — `createIntentLoop`

Anchor (first code line after the comment): `markQuizCompleted();`

Kept in the code as: Apply the quiz leaf; never show the quiz again [FOLLOW-199].

```text
// Apply v2 quiz leaf result to intent state (applyQuizLeaf — FOLLOW-199).
// Note: full mismatch detection wiring is FOLLOW-201.
// Permanently suppress the quiz trigger across future sessions.
```

#### intent-loop.ts:288 — `createIntentLoop`

Anchor (first code line after the comment): `if (resolvedArchetype !== 'neutral') {`

Kept in the code as: Seed the SoT from a NON-neutral leaf only (ADR-0014) [FOLLOW-554].

```text
// Seed the session source-of-truth archetype with the quiz answer so
// refreshDirectives() can restore it if behavioral drift later decays the live
// archetype to neutral. Chat / sustained behavioral evidence may later overwrite
// this SoT with a different non-neutral archetype (see refreshDirectives).
// FOLLOW-380 bug (c): persist the (high) quiz-leaf confidence alongside the
// archetype so the neutral-decay restore re-pins both above the DOM floor.
//
// FOLLOW-554 (A3-F-03): a quiz SKIP (Q1 option D) resolves to `neutral`. Persisting
// that would WIPE an already-established non-neutral SoT, violating the ADR-0014
// invariant "never to neutral" (session.ts). Only seed the SoT from a non-neutral
// quiz leaf — mirror the refreshDirectives() guard. Rule R: idempotent across
// rehydrate (a skip is a no-op on the SoT key, so an existing SoT survives).
```

#### intent-loop.ts:314 — `createIntentLoop`

Anchor (first code line after the comment): `postQuizCompletionPing(`

Kept in the code as: Persist completion with opt-out flag and path [FOLLOW-200, FOLLOW-1020].

```text
// FOLLOW-200: persist quiz completion to Postgres for MOAT training data.
// Fire-and-forget — must never block the quiz dismiss UI.
// Fails silently (postQuizCompletionPing catches all errors internally).
// FOLLOW-389 HW-1: thread the opt-out flag so the server-side §H.9 gate
// at route.ts:363 is reachable (defense-in-depth alongside Guard 1).
// FOLLOW-1020: `answerPath` records the walk, so the staff viewer's BRANCH / Q1-Q3
// columns reflect what the buyer actually answered instead of defaulting to a skip.
```

#### intent-loop.ts:334 — `createIntentLoop`

Anchor (first code line after the comment): `trigger: 'auto_open',`

Kept in the code as: The quiz opens itself [FOLLOW-1015].

```text
// FOLLOW-1015: the quiz opens itself now, so the old 'prompt_after_30s'
// provenance no longer describes anything real. Free-form string field
// (QuizEventPayloadSchema), no downstream consumer filtered on the old value.
```

#### intent-loop.ts:368 — `createIntentLoop`

Anchor (first code line after the comment): `markQuizDismissed();`

Kept in the code as: 24h cooldown after closing [FOLLOW-1015].

```text
// Closed or skipped without completing. FOLLOW-1015: start the 24h cooldown —
// the quiz auto-opens now, so without this it would reappear on the very next
// page view and the close button would feel broken.
```

#### intent-loop.ts:379 — `createIntentLoop`

Anchor (first code line after the comment):
`ctx.on(window, 'estalara:listing:favorited', (e: Event) => {`

Kept in the code as: Favorites bridge: favorited → signal; unfavorited logged only [FOLLOW-210].

```text
// FOLLOW-210: Favorites/bookmark signal bridge.
// Listens for estalara:listing:favorited / estalara:listing:unfavorited CustomEvents
// dispatched by app.estalara.com (window) on successful save/unsave.
//
// On favorited: (a) queue listing.bookmarked ingest event, (b) apply listing.bookmarked
// behavioral signal (with payload-conditional boosts handled inside applyBehavioralSignal).
// On unfavorited: log only — no intent signal (removal is ambiguous).
```

#### intent-loop.ts:409 — `createIntentLoop`

Anchor (first code line after the comment): `if (ctx.optedOut) return;`

Kept in the code as: §H.9: listing.bookmarked was pushed above on purpose (§H.8) [FOLLOW-384].

```text
// (b) Apply behavioral signal with payload-conditional boosts
// §H.9 opt-out: suppress AL profiling. Ingest stream left flowing (§H.8/CEO 2026-06-23/FOLLOW-384).
// NOTE: this asymmetry vs showQuizTrigger is intentional — listing.bookmarked (§H.8 protected)
// is pushed BEFORE this guard, so the ingest event reaches the pipeline for opted-out users.
```

### `packages/sdk/src/core/adapt-loop.ts`

#### adapt-loop.ts:1 — module header

Anchor (first code line after the comment):
`import { fetchDirectives, applyDirectives, resetAdaptState } from './adapt.js';`

Kept in the code as: Adapt loop: intent state → DOM adaptation, latest-wins [FOLLOW-1296]. @module

```text
/**
 * Adapt loop (FOLLOW-1296): everything in `init()` that turns the live intent state into DOM
 * adaptation — `refreshDirectives()` with its latest-wins guard, the chat prior fold and its
 * follow-up draw (FOLLOW-1301/1306), the cross-listing slot revert, the first decision cycle and
 * its `estalara:adapt:settled` signal, the chat → refresh bridge and the conversion listeners.
 *
 * State is per-instance: the shared fields live on the {@link BootContext}, the rest in this
 * factory's closure (RETRO-006 LG-2).
 *
 * @module
 */
```

#### adapt-loop.ts:38 — module header

Anchor (first code line after the comment): `export const DRIFT_HOLD_COUNT = 3;`

Kept in the code as: Cycles a drift must hold before overriding the quiz (§E.4.5) [FOLLOW-201].

```text
/**
 * Number of consecutive refreshDirectives() cycles a drift archetype must be confirmed
 * before overriding the quiz-assigned session state (FOLLOW-201 / Master_Design §E.4.5).
 * Anti-thrash guard: 3 cycles prevents transient behavioral noise from flipping the archetype.
 */
```

#### adapt-loop.ts:45 — `DRIFT_HOLD_COUNT`

Anchor (first code line after the comment): `const CHAT_REFRESH_DEBOUNCE_MS = 2_500;`

Kept in the code as: Chat refresh debounce; bounded retries until the watermark moves [FOLLOW-1026].

```text
/**
 * Chat-triggered directive refresh (FOLLOW-1026).
 *
 * FOLLOW-1024 made every buyer message ELIGIBLE to move the archetype. It did not give the
 * evidence a way to arrive: the chat prior rides on an `/api/adapt` RESPONSE, and a buyer who
 * stays on one listing and talks never triggers another adapt call. Measured on the local
 * stack — a full session with two chat questions produced exactly TWO adapt calls, both before
 * the chat, so the archetype could not move however many questions were asked.
 *
 * The debounce collapses a burst of typing into one cycle. The retries exist because the
 * evidence is not ready when the message is sent: it has to reach ingest, then the NLP
 * extraction (a live model call), then the shadow key, before an adapt response can carry it.
 * Refreshing once would reliably read the PREVIOUS stamp and burn the call for nothing.
 *
 * Bounded on purpose — at most `CHAT_REFRESH_MAX_ATTEMPTS` extra adapt calls per burst,
 * stopping the moment the watermark advances. A message that yields no usable dimension (a
 * greeting) never advances it, so it costs the full budget; that is the price of not polling
 * indefinitely, and it is why the budget is small.
 */
```

#### adapt-loop.ts:73 — `PageType`

Anchor (first code line after the comment):
`type PageTypeProvenance = 'attribute' | 'url' | 'dom_signal' | 'default';`

Kept in the code as: Which branch produced a {@link PageTypeResolution} [FOLLOW-1138].

```text
/**
 * Which detection branch produced a {@link PageTypeResolution} (FOLLOW-1138 observability):
 * `attribute` (explicit `data-page-type`), `url` (`/listing/` in the pathname), `dom_signal`
 * (widened heuristic -- exactly one `[data-estalara-listing-id]` element on the page, see
 * {@link resolvePageType}), or `default`.
 */
```

#### adapt-loop.ts:81 — `PageTypeProvenance`

Anchor (first code line after the comment): `interface PageTypeResolution {`

Kept in the code as: Page type + provenance; two fields only (bundle budget, ESC-028).

```text
/** Page type plus which branch produced it -- {@link resolvePageType}'s return shape. Kept to
 * two fields deliberately: this sits inside the 42KB-gzip-gated IIFE bundle
 * (`scripts/check-bundle-size.js`, ESC-028). */
```

#### adapt-loop.ts:89 — `PageTypeResolution`

Anchor (first code line after the comment):
`function resolvePageType(scriptDataset: DOMStringMap): PageTypeResolution {`

Kept in the code as: Page type: attribute, `/listing/` URL, exactly one listing id, else list
[FOLLOW-1138]. @param scriptDataset - The dataset of the Estalara <script> tag (may include
pageType).

```text
/**
 * Resolve the page type from the current URL, an optional data-page-type attribute, and a DOM
 * detail-page signal, with provenance for observability (FOLLOW-1138).
 *
 * Detection order:
 *   1. `data-page-type` attribute on the <script> tag -- explicit override; takes precedence.
 *   2. URL pathname contains '/listing/' -> 'listing_detail'.
 *   3. Exactly one `[data-estalara-listing-id]` element on the page -> 'listing_detail'
 *      (FOLLOW-1138 widened heuristic -- a tenant whose detail-page URLs don't contain
 *      '/listing/' and who never sets `data-page-type` was silently losing headline
 *      adaptation; `detectListingId()` already reads this attribute elsewhere in this module
 *      but the page-type heuristic never consulted it). "Exactly one" -- not "any" -- because a
 *      real listing GRID page renders ONE such element PER CARD (the same attribute
 *      `tenant-schema.ts`'s default `item_selector` targets), so "any" would misfire on a grid.
 *   4. Default -> 'listing_list'.
 *
 * Module-local, together with {@link PageTypeResolution}/{@link PageTypeProvenance}: nothing
 * outside this file consumes them, and exporting a symbol whose only importer is a test is a
 * Rule I (wired-or-dead) violation. {@link detectPageType} is the exported surface.
 *
 * @param scriptDataset - The dataset of the Estalara <script> tag (may include pageType).
 */
```

#### adapt-loop.ts:133 — `resolvePageType`

Anchor (first code line after the comment):
`export function detectPageType(scriptDataset: DOMStringMap): PageType {`

Kept in the code as: Page type literal; wraps {@link resolvePageType}. @param scriptDataset - The
dataset of the Estalara <script> tag (may include pageType). @returns The resolved page type
literal.

```text
/**
 * Detect the page type from the current URL and an optional data-page-type attribute.
 *
 * Thin wrapper over {@link resolvePageType} kept for callers that only need the literal (unit
 * tests) -- see that function's doc for detection order and FOLLOW-1138 context.
 *
 * @param scriptDataset - The dataset of the Estalara <script> tag (may include pageType).
 * @returns The resolved page type literal.
 */
```

#### adapt-loop.ts:146 — `detectPageType`

Anchor (first code line after the comment):
`export function detectListingId(): string | undefined {`

Kept in the code as: First `[data-estalara-listing-id]` value on the page [FOLLOW-194]. @internal
exported for unit testing only

```text
/**
 * Read the current listing ID from the page DOM.
 *
 * Looks for `[data-estalara-listing-id]` in the document. Returns the first
 * non-empty value found, or undefined if no such attribute exists.
 *
 * Used by F-13 (FOLLOW-194) to wire per-listing RAG context into the adapt request.
 *
 * @internal exported for unit testing only
 */
```

#### adapt-loop.ts:195 — `createAdaptLoop`

Anchor (first code line after the comment): `let previousArchetype: string | null = null;`

Kept in the code as: resetAdaptState() only on archetype change: no flicker [FOLLOW-194].

```text
// F-15 (FOLLOW-194): track the last archetype returned by the Decision API.
// resetAdaptState() is called ONLY when the archetype changes, preventing the
// text-flicker that occurred every ~30s when resetAdaptState() was called
// unconditionally on every refreshDirectives() cycle.
```

#### adapt-loop.ts:203 — `createAdaptLoop`

Anchor (first code line after the comment): `let driftCandidateArchetype: Archetype | null = null;`

Kept in the code as: Drift state; overrides after DRIFT_HOLD_COUNT cycles [FOLLOW-201].

```text
// FOLLOW-201: per-session drift detection state (per-instance — RETRO-006 LG-2).
// Tracks consecutive refreshDirectives() cycles where detectMismatch() fires for
// the same suggested archetype. Only overrides quiz state when driftCandidateCount
// reaches DRIFT_HOLD_COUNT (anti-thrash guard per Master_Design §E.4.5).
```

#### adapt-loop.ts:210 — `createAdaptLoop`

Anchor (first code line after the comment): `let previousListingEl: HTMLElement | null = null;`

Kept in the code as: With the id, so a remount of the same listing re-adapts.

```text
// The listing-root node we last adapted. Tracked alongside the id so a remount of the SAME
// listing (navigate listing → browse → same listing back) — a NEW node carrying the same id —
// is still detected as a fresh listing that needs re-adaptation.
```

#### adapt-loop.ts:214 — `createAdaptLoop`

Anchor (first code line after the comment):
`const originalHeadlineByListing = new Map<string, string>();`

Kept in the code as: Original headline per listing, restored on navigation [FOLLOW-380].

```text
// FOLLOW-380 bug (b) / RETRO-105 LG-2: captured original (pre-adaptation) headline text,
// keyed PER LISTING. Real listings have DIFFERENT titles, so a single global capture would
// stamp listing-1's title onto listing-2 on cross-listing navigation. Each listing's
// original is captured the first time that listing id is seen (before any adaptation
// touches its headline) and restored on cross-listing navigation so a listing the archetype
// does not fit (neutral / archetype-fit gate) shows ITS OWN original copy — never the
// previous listing's adapted (or original) headline.
```

#### adapt-loop.ts:222 — `createAdaptLoop`

Anchor (first code line after the comment):
`const originalDescriptionByListing = new Map<string, string>();`

Kept in the code as: Original description, for opt-out restore [FOLLOW-1019].

```text
// FOLLOW-1019: the description's original copy, captured on the same schedule and for the
// same reason. Cross-listing navigation never needed it (the framework re-renders the new
// listing's own description, and `teardownDescriptionObservers()` lets that text stand), but
// an in-session opt-out has no re-render to lean on — without a captured original there is
// nothing to put back, and the visitor keeps reading profiled copy.
```

#### adapt-loop.ts:228 — `createAdaptLoop`

Anchor (first code line after the comment):
`function captureOriginalHeadline(listingId: string | undefined): void {`

Kept in the code as: Capture originals on first sight; observer order is load-bearing [FOLLOW-380].

```text
/**
 * Capture the current headline- and description-slot text for `listingId` the FIRST time it
 * is seen.
 *
 * Ordering note (bug (b)): the `listing.viewed` handler runs synchronously inside the
 * `navMutObs` MutationObserver callback, which was created at init — BEFORE the per-listing
 * headline loop-guard observers (created during adaptation). MutationObserver callbacks fire
 * in creation order, so at capture time the framework's freshly-rendered per-listing title
 * is still present (the stale loop-guard has not yet re-asserted the previous listing's
 * adapted copy), and `teardownDescriptionObservers()` in the handler then disconnects that
 * loop-guard before it can clobber. Idempotent per listing (skips if already captured), so
 * a later view of the same listing never overwrites its true pre-adaptation original.
 */
```

#### adapt-loop.ts:260 — `createAdaptLoop`

Anchor (first code line after the comment):
`function restoreOriginalSlots(listingId: string | null | undefined): void {`

Kept in the code as: Restore tenant copy: teardown first, then reset fingerprints [FOLLOW-1019].

```text
/**
 * Put the tenant's own copy back on every adapted slot for `listingId` (FOLLOW-1019).
 *
 * Ordering mirrors the cross-listing restore below: observers are torn down FIRST, because
 * both the description loop-guard and the generic headline watchdog treat an external write
 * as a revert to fight — restoring before teardown would have them re-assert the adapted
 * copy within a frame. `resetAdaptState()` clears the applied-fingerprints so that opting
 * back IN re-applies the same (slot, archetype) pair instead of short-circuiting on a
 * fingerprint recorded before the revert.
 */
```

#### adapt-loop.ts:288 — `createAdaptLoop`

Anchor (first code line after the comment): `let latestRefreshId = 0;`

Kept in the code as: Latest-wins refresh id: the last navigation wins [FOLLOW-380].

```text
// FOLLOW-380 bug (a) / RETRO-105 LG-1: monotonic in-flight guard for overlapping
// `refreshDirectives()` calls. Rapid SPA navigation fires `void refreshDirectives()`
// fire-and-forget (`onListingViewed` below) with no lock or AbortController, so two
// invocations can interleave on the shared mutable `ctx.state` / SoT. Each invocation claims
// the next id; after its async fetch resolves it commits state ONLY if it is still the
// latest — so a stale in-flight call whose fetch arrives after a newer navigation started can
// never clobber the newer navigation's state/DOM. The LAST navigation always wins.
```

#### adapt-loop.ts:316 — `createAdaptLoop`

Anchor (first code line after the comment): `if (pageTypeResolution.provenance === 'dom_signal') {`

Kept in the code as: Observable only when a DOM signal decided [FOLLOW-1138].

```text
// FOLLOW-1138: make the widened heuristic's use observable -- fires only when neither an
// explicit data-page-type attribute nor the /listing/ URL convention decided the page
// type, i.e. a DOM signal did. Not on every cycle -- that would just be noise on every
// ordinary grid-page load, and this sits inside the 42KB-gzip-gated IIFE bundle.
```

#### adapt-loop.ts:331 — `createAdaptLoop`

Anchor (first code line after the comment): `if (ctx.state.archetype === 'neutral') {`

Kept in the code as: Neutral decay re-pins the SoT; not quiz-gated (§D.6, ADR-0014) [FOLLOW-344].

```text
// Source-of-truth archetype restore (§D.6 / FOLLOW-344; CEO 2026-06-22): routine
// behavioral signals (rapid listing views via applyListingViewRate, scroll, dwell) push
// probability mass toward `neutral` and can decay the live archetype to `neutral`
// mid-session, which would silently stop cross-listing adaptation. When that happens,
// re-pin the archetype to the persisted SoT (seeded by the quiz, later updated by chat /
// sustained behavioral evidence) so every subsequent listing keeps adapting. A genuine
// *non-neutral* switch (e.g. chat reveals investor intent → yield_hunter) is left
// untouched — drift away from the declared archetype is legitimate, but ONLY toward
// another non-neutral archetype, never to `neutral`. Works with OR without the quiz.
//
// FOLLOW-380 doc gap (RETRO-105 CB-1) — quiz vs quiz-disabled stickiness asymmetry:
// For a QUIZ tenant there are TWO layers of anti-neutral-decay protection: (1) intent.ts
// hysteresis (`classifyFromProbabilities`, gated in part on `state.quiz_answered`,
// intent.ts:~747-779) PREVENTS `neutral` from overtaking the argmax mid-classify, and
// (2) this restore-after-decay. For a QUIZ-DISABLED tenant there is no quiz answer, so
// layer (1) does not engage — the archetype can freely decay all the way to `neutral`
// and the ONLY protection is THIS restore. Net: quiz-disabled tenants get a weaker
// guarantee (decay-then-restore) than quiz tenants (prevent-decay + restore). This is
// acceptable per the CEO cross-listing SoT ruling (quiz-disabled stays functional) — the
// restore below is deliberately NOT gated on `quiz_answered` so it works for both.
```

#### adapt-loop.ts:354 — `createAdaptLoop`

Anchor (first code line after the comment): `ctx.state = {`

Kept in the code as: Re-pin confidence too, or the server gate drops directives [FOLLOW-380].

```text
// FOLLOW-380 bug (c) / RETRO-105 LG-3: re-pin the archetype AND the confidence it
// was resolved at. `body.confidence = currentIntentState.confidence` (adapt.ts:762)
// is sent to the Decision API, which BOTH gates directives server-side
// (`confidence <= 0.6 → no directives`, route.ts) AND echoes the value into
// `resp.confidence` — the value the FOLLOW-343 DOM floor checks (below). If we
// pinned only the archetype and left the neutral-era low confidence in place, the
// server would return no directives and the floor would suppress the restored
// adaptation, silently defeating the restore. Pinning `sot.confidence` keeps
// cross-listing re-adaptation working.
```

#### adapt-loop.ts:382 — `createAdaptLoop`

Anchor (first code line after the comment): `if (myRefreshId !== latestRefreshId) return;`

Kept in the code as: Superseded in flight: discard [FOLLOW-380].

```text
// FOLLOW-380 bug (a): a newer navigation superseded this call while the fetch was in
// flight — discard this stale result so it cannot clobber the newer navigation's state
// or re-apply stale directives/description onto the newer listing's DOM.
```

#### adapt-loop.ts:387 — `createAdaptLoop`

Anchor (first code line after the comment): `if (updatedIntentState !== undefined) {`

Kept in the code as: Accept the chat fold only after the latest-wins check [FOLLOW-1306].

```text
// FOLLOW-101: if the chat-intent prior was applied, update the live intent state.
// FOLLOW-1306 (F-25): the fold is accepted only here, after
// the latest-wins check above — `onIntentUpdate` persists it and the mismatch event is
// queued here, so a discarded stale reply leaves neither storage nor telemetry behind.
```

#### adapt-loop.ts:410 — `createAdaptLoop`

Anchor (first code line after the comment):
`const stamp = currentIntentState.chatPriorAppliedAt ?? '';`

Kept in the code as: Fold moved a decision input → one follow-up call per stamp [FOLLOW-1301].

```text
// FOLLOW-1301: the fold lands on THIS response, but the folded state only reaches the
// server on the NEXT call — and a buyer who just chats makes none. So when the fold
// changed a decision input, draw that call once, through the chat-refresh path.
// FOLLOW-1306 (F-04): "changed a decision input" is the hint OR the confidence crossing
// the server's directive gate. Hint-only missed a second message that lifted the SAME
// archetype from 0.37 to 0.66 — the server never saw it. A confidence move that stays
// on one side of the gate (0.37 -> 0.48) changes nothing the server serves: no call.
// Once per stamp (Rule R); a call whose stamp is already folded folds nothing and so
// schedules nothing (no loop); a pending chat refresh already carries the new state.
```

#### adapt-loop.ts:432 — `createAdaptLoop`

Anchor (first code line after the comment): `if (ctx.state.archetype !== 'neutral') {`

Kept in the code as: SoT tracks the latest non-neutral archetype.

```text
// Update the session source-of-truth archetype to the latest non-neutral resolution
// (post chat-intent prior). This is how chat / sustained behavioral evidence overrides
// the quiz answer when the buyer's true need becomes evident: the SoT always tracks the
// most recent non-neutral archetype, and the neutral-decay restore above pins to it.
```

#### adapt-loop.ts:449 — `createAdaptLoop`

Anchor (first code line after the comment): `teardownDescriptionObservers();`

Kept in the code as: Archetype change: drop description observers (ADR-0009) [FOLLOW-802].

```text
// FOLLOW-802 AC2 (option 2 of the two the ticket offered — see the PR for why this
// one). `resetAdaptState()` releases headline ownership only for elements still in
// `_textResilienceMap`, but a hand-off to the description module DELETES the element
// from that map, so ownership would survive an archetype change and make the generic
// pipeline skip the headline forever.
//
// Tearing the description observers down here is right on the merits, not merely a
// means to release ownership: the applied description/headline is generated PER
// ARCHETYPE (ADR-0009), so on an archetype change the old copy is stale content, and
// leaving its observer armed makes it defend that stale copy against the new
// archetype's directives. `applyDescriptionAdaptation` is re-invoked with the new
// archetype a few lines below and re-arms. This mirrors what the cross-listing path
// already does.
```

#### adapt-loop.ts:470 — `createAdaptLoop`

Anchor (first code line after the comment): `if (resp.slot_selectors) {`

Kept in the code as: Annotate curated slots first, regardless of confidence [FOLLOW-340].

```text
// FOLLOW-340: Self-annotate DOM nodes from curated slot_selectors BEFORE
// applyDirectives() so pages without hand-coded data-estalara-slot attributes
// (incl. app.estalara.com no-code) can receive directive mutations.
// Runs unconditionally (outside the aboveFloor gate) so annotation is done
// once regardless of confidence — directives themselves are still gated below.
// annotateSlots is idempotent and never throws onto the host page.
```

#### adapt-loop.ts:480 — `createAdaptLoop`

Anchor (first code line after the comment): `const aboveFloor =`

Kept in the code as: Confidence/signal floors; description has its own bar [FOLLOW-343, ESC-054].

```text
// FOLLOW-343: gate DOM mutation (text, class, reorder, description) behind a
// confidence/signal floor.  At cold start the Bayesian prior is ~0.37; a single
// device or referrer hint can tip argmax above neutral at ~0.05–0.10 confidence
// and reshuffle the page.  We hold off until we have either:
//   (a) confidence ≥ DOM_ADAPT_CONFIDENCE_FLOOR (0.5), or
//   (b) signal_count ≥ a per-axis minimum — sufficient behavioral evidence.
// Quiz leaf resolves at 0.85 → always above the floor (no regression, AC-3).
//
// FOLLOW-913 / ESC-054 (CEO ruled 2026-08-08): the directive axis and the
// description axis are now TWO SEPARATE disjunctions with two separate `if`
// blocks, not one shared `aboveFloor` gating both. Before this ruling both axes
// shared DOM_ADAPT_MIN_SIGNAL_COUNT (2), so a single real behavioral event
// (device_type prior at init + one scroll-depth milestone) opened LLM-generated
// long-form description copy at any confidence. The ruling kept the disjunction
// shape but raised the description axis's signal-count arm to
// DOM_ADAPT_DESCRIPTION_MIN_SIGNAL_COUNT (5); the directive axis is unchanged.
```

#### adapt-loop.ts:503 — `createAdaptLoop`

Anchor (first code line after the comment):
`const descriptionSlotDirectives = resp.directives.filter(`

Kept in the code as: Description slot waits for the description bar [FOLLOW-948].

```text
// FOLLOW-948: the ESC-054 ruling raised the bar on the DESCRIPTION COPY, not on the
// `/adapt/description` fetch mechanism. `aboveDescriptionFloor` gated only the fetch,
// while `TextDirective.slot` is an open string and `SlotSelectors.description` is a
// curated slot that `annotateSlots()` marks unconditionally above — so a `text`
// directive naming `description` would rewrite the very copy the ruling protects, at
// the DIRECTIVE bar (2 signals) instead of the description bar (5).
//
// Split by SLOT, not by directive type, so both axes keep their own bar:
// `aboveDescriptionFloor` strictly implies `aboveFloor` (identical confidence arm,
// 5 >= 2 on the signal arm), so this can only ever withhold the description slot
// longer — never apply anything the previous code would not have applied.
//
// This is a bar, not a ban: the ruling raised the threshold for description copy, it
// did not remove the capability, so excluding the slot outright would over-correct.
```

#### adapt-loop.ts:524 — `createAdaptLoop`

Anchor (first code line after the comment): `const directiveContext = {`

Kept in the code as: Same latest-wins predicate for deferred repairs (Rule AB) [FOLLOW-791].

```text
// FOLLOW-791 / Rule AB: propagate the same latest-wins staleness predicate used
// by applyDescriptionAdaptation below into the generic directive pipeline's
// MutationObserver-backed resilience mechanism, so a rapid cross-listing nav that
// supersedes this adaptation cannot repaint a stale archetype's directive onto the
// newer listing via a deferred repair.
```

#### adapt-loop.ts:545 — `createAdaptLoop`

Anchor (first code line after the comment): `void applyDescriptionAdaptation(`

Kept in the code as: Description adaptation, fire-and-forget, latest-wins [FOLLOW-159, FOLLOW-546].

```text
// Fetch + apply long-form description adaptation (FOLLOW-159).
// Fire-and-forget — description errors are observable via adapt.description.error events;
// a failure here must never block the directive/headline path or sidebar update.
// FOLLOW-546 / RETRO-169: the latestRefreshId checkpoint above ran synchronously
// and cannot catch a supersession that lands while applyDescriptionAdaptation awaits its
// own fetchDescription. Propagate the same latest-wins predicate so the description tail
// bails before mutating any slot on the newer listing when a rapid nav supersedes us.
```

#### adapt-loop.ts:566 — `createAdaptLoop`

Anchor (first code line after the comment): `if (ctx.state.quiz_answered) {`

Kept in the code as: Drift detection after a quiz only [FOLLOW-201].

```text
// FOLLOW-201: Post-directive drift detection.
// Only runs when the quiz has been answered — no quiz means no quiz-vs-behavioral
// discrepancy to detect. AC5: description_cache_persistent is NOT modified here;
// applyQuizLeaf() is session-only (no DB write).
```

#### adapt-loop.ts:590 — `createAdaptLoop`

Anchor (first code line after the comment): `ctx.state = applyQuizLeaf(ctx.state, candidate);`

Kept in the code as: Sustained drift: override the quiz archetype.

```text
// Anti-thrash guard satisfied: override quiz archetype with behavioral evidence.
// applyQuizLeaf() sets high confidence (0.85) for the drift archetype — same
// mechanism as quiz leaf but triggered by sustained behavioral mismatch.
// `candidate` is the confirmed drift archetype (Archetype, never null).
```

#### adapt-loop.ts:611 — `createAdaptLoop`

Anchor (first code line after the comment): `captureOriginalHeadline(detectListingId());`

Kept in the code as: Capture the first listing's original [FOLLOW-380].

```text
// FOLLOW-380 bug (b): capture the FIRST listing's original headline text BEFORE the first
// adaptation (refreshDirectives below), keyed by its listing id, so cross-listing
// navigation can restore each listing's OWN original on a non-fitting (neutral) listing.
```

#### adapt-loop.ts:623 — `createAdaptLoop`

Anchor (first code line after the comment): `try {`

Kept in the code as: Release the host cloak even when nothing adapted [FOLLOW-1027].

```text
// FOLLOW-1027: tell the host page's anti-flicker cloak it may reveal the slots. Dispatched
// unconditionally once the first decision cycle has settled — including when nothing was
// adapted, because a page that will never change must not stay masked for the full
// fail-safe timeout. The host snippet also has its own timeout; this is the fast path.
```

#### adapt-loop.ts:629 — `createAdaptLoop`

Anchor (first code line after the comment): `const timings = bootTimings();`

Kept in the code as: Boot timings ride on the settled event [FOLLOW-1033].

```text
// FOLLOW-1033: carry the boot decomposition on the event the cloak already listens for,
// so measuring costs a listener rather than a debug build. Consumers that only want the
// reveal signal ignore `detail` and are unaffected.
```

#### adapt-loop.ts:636 — `createAdaptLoop`

Anchor (first code line after the comment):
`if (timings.preInit !== undefined && timings.total !== undefined) {`

Kept in the code as: Boot timings to ClickHouse, once per init, behind consent [FOLLOW-1037,
MP-011].

```text
// FOLLOW-1037 / MP-011: land the SAME decomposition in ClickHouse through the existing
// ingest event queue/dispatch path (no new transport) — the console/CustomEvent route
// above is the only place these numbers went before this ticket. Shape matches
// BootTimingPayloadSchema (packages/shared/src/schemas/events/boot-timing.ts): preInit
// and total required, the rest best-effort spans. Guarded on both because
// `bootTimings()` only omits `total` in the same failure mode it omits `preInit`
// (Performance API unavailable) — never send a payload the ingest schema will reject.
// Operational latency telemetry, not profiling (§H.9) — it rides the SAME consent gate
// as every other queued event because this code only runs past the consent gate in
// boot() (denied/pending-declined sessions return from init() before reaching this
// line); no separate opt-out check is needed, mirroring collectPageView()'s push.
// Exactly one `boot_timing` push per init() call — mark('settled') has a single call
// site — so no additional per-session/per-tenant guard is needed (YAGNI, no kill
// switch: at most one event per page load is a structural property of this call site,
// not a runtime flag to maintain).
```

#### adapt-loop.ts:669 — `createAdaptLoop`

Anchor (first code line after the comment): `captureOriginalHeadline(viewedListingId);`

Kept in the code as: Capture this listing's original first [FOLLOW-380].

```text
// FOLLOW-380 bug (b): capture THIS listing's own original headline (before teardown
// and before refreshDirectives adapts it) so the restore below uses the correct
// per-listing title. See captureOriginalHeadline's ordering note.
```

#### adapt-loop.ts:674 — `createAdaptLoop`

Anchor (first code line after the comment): `teardownDescriptionObservers();`

Kept in the code as: Revert adapted slots before re-adapting the new listing.

```text
// Revert adapted slots to their original copy before re-adapting, so a listing the
// archetype does NOT fit (the decision API returns neutral / no directive) shows the
// tenant's original text — not the previous listing's adapted copy left on the reused
// DOM node. Description: disconnect the per-slot observers FIRST so the framework's
// freshly-rendered per-listing text stands. Headline: restore the captured placeholder
// AFTER teardown — the headline loop-guard observer would otherwise treat the restore
// as a revert and re-assert the previous listing's adapted copy. refreshDirectives()
// re-applies + re-observes if the new listing IS a fit.
```

#### adapt-loop.ts:695 — `createAdaptLoop`

Anchor (first code line after the comment): `latestRefreshId++;`

Kept in the code as: Invalidate in-flight replies [FOLLOW-1306].

```text
// FOLLOW-1306 (F-12): invalidate the current generation. A personalised reply still in
// flight (or a deferred description/directive repair holding its `isStale` predicate)
// would otherwise repaint profiled copy over the revert below.
```

#### adapt-loop.ts:699 — `createAdaptLoop`

Anchor (first code line after the comment):
`restoreOriginalSlots(previousListingId ?? detectListingId());`

Kept in the code as: Opt-out reverts the DOM (§H.9) [FOLLOW-1019].

```text
// FOLLOW-1019: opting OUT actively reverts the DOM. The previous note here claimed
// "the tenant-default DOM is already visible", which is only true before the first
// adaptation — mid-session it is the ADAPTED copy on screen, and merely suppressing
// future directives left a visitor who had just declined profiling still reading
// profiled copy until a full reload. §H.9's "reversible suspend" is what this does:
// it suspends the adaptation AND puts the tenant's own copy back, and opting in again
// re-adapts (the opt-out toggle's other branch).
```

#### adapt-loop.ts:709 — `createAdaptLoop`

Anchor (first code line after the comment): `function scheduleChatRefresh(followUp = false): void {`

Kept in the code as: Debounced chat re-fetch: flush first, retry until the stamp moves
[FOLLOW-1026].

```text
/**
 * Debounced, bounded re-fetch of directives after the buyer says something.
 *
 * Flushes first: the event queue is on a 5s timer, so without this the message would still
 * be sitting in the browser when the refresh fires, and the adapt response could not
 * possibly carry it.
 *
 * Retries only while `chatPriorAppliedAt` has NOT moved — the watermark advancing is proof
 * the evidence arrived and was folded, and is the signal to stop.
 *
 * FOLLOW-1301: `followUp` is the one call that carries a just-folded hint to the server. It
 * gets no retries (its attempt counter starts at the last slot): it waits for no evidence.
 */
```

#### adapt-loop.ts:755 — `createAdaptLoop`

Anchor (first code line after the comment): `// Chat: estalara:chat:message-sent`

Kept in the code as: Chat bridge on `document`; lead_id only (Rule L) [FOLLOW-197].

```text
// FOLLOW-197 / CHAT-003: Chat signal bridge.
// Listens for chat and live-signup CustomEvents dispatched by Estalara-app on `document`.
// Using document (not window) per RETRO-033 — Estalara-app dispatches on document.
//
// Rule L: raw user_uuid is NEVER stored — only the SHA-256-derived lead_id is stored.
// Agent activity (is_agent === true) is silently filtered — investor signals only.
```

#### adapt-loop.ts:792 — `createAdaptLoop`

Anchor (first code line after the comment): `queue.push({`

Kept in the code as: Opt-out flag rides along; event still reaches ingest (§H.8) [FOLLOW-387].

```text
// §H.9/FOLLOW-387: attach the per-session opt-out flag so the ingest chat-NLP
// dispatch can forward it to process_chat_message and skip the AL shadow-prior write.
// §H.8 invariant: the event STILL flows to ingest regardless of the flag.
```

#### adapt-loop.ts:858 — `createAdaptLoop`

Anchor (first code line after the comment): `ctx.on(document, 'inquiry.completed', (e: Event) => {`

Kept in the code as: inquiry.completed to ingest for conversion lift [FOLLOW-569].

```text
// F-01 (audit 2026-07-12, FOLLOW-569): inquiry.completed ingest listener.
// Mirrors the live.signup listener above. Before FOLLOW-1286 the SDK sent only a bandit
// feedback ping on inquiry.completed, and nothing ever queued it for INGEST — so the
// cta-lift conversion-analytics leg that JOINs on inquiry.completed was permanently empty for
// holdout AND variant sessions alike (audit finding F-01). This queues the ingest telemetry
// event for every session so conversion lift can actually be measured. Payload is limited to
// InquiryCompletedPayloadSchema (no PII); session/variant attribution rides the event
// envelope's session_id, not the payload.
```
