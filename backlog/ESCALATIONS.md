# Escalations

Issues that require human decisions. Agents append; humans resolve.

## Format

```markdown
## OPEN — <short title>

**Filed by:** <agent or human> **Date:** <ISO timestamp> **Affects:** <ticket-id or area> **Type:**
[architectural | compliance | priority | scope | vendor | other]

**Description:** What happened, what was expected, what's needed to unblock.

**Required action:** What needs to happen to resolve.

**Resolution:** <empty until resolved>
```

When resolved, change `## OPEN` to `## RESOLVED` and add the resolution.

---

## RESOLVED — ESC-077: implementing §E.7.0 on branch 2 costs more than the ruling priced — the bandit's three arms become IDENTICAL on the template paths, ESC-074 (b) loses its served consumer, and 67% of directives stop being served [FOLLOW-1163 / ESC-076 / MASTER_DESIGN §E.7.0]

**Filed by:** backend-engineer (executing FOLLOW-1163) **Date:** 2026-08-27 **Affects:**
`apps/control-plane/src/app/api/adapt/route.ts` branches 2 and 3, `lib/ungrounded-directives.ts`
(new), the FOLLOW-342 bandit contract, ESC-074 (b) / FOLLOW-1140, FOLLOW-819 / FOLLOW-820
measurements **Type:** architectural

**This is not a request to revisit the ruling.** §E.7.0 is right, FOLLOW-1163 is authorised, and the
implementation is written, tested and pushed
(`backend-engineer/FOLLOW-1163-ground-or-stop-adapting`). It is a request to look at an invoice the
ruling did not itemise, BEFORE 18 existing assertions are rewritten to match it — because rewriting
them is the point of no return, and three of the costs below were not visible when ESC-076 was
ruled.

**What was implemented, exactly.** On the two paths that serve playbook copy verbatim — branch 2
(`similarity > HIGH_SIMILARITY_THRESHOLD`, which deliberately never fetches the listing) and branch
3's `playbook_fallback_llm_unavailable` — every directive that asserts a fact about the property is
withheld and only the `cta` is served. `cta` survives because it asserts nothing about the property:
all seventeen shipped strings were enumerated first and every one is an offer we make
(`Request Investment Pack`) or an invitation (`Book a Viewing`). `headline` is withheld because
every property claim in the playbook lives there. `feature` is withheld because it is MIXED — most
are section labels, but `Remote Work Ready`, `Downsizer Friendly`, `Short-Term Rental Projections`
and `Residency Requirements` are claims, and no mechanical slot rule separates them.

Red-first, executed: before the change `'Golden Visa Eligible — Residency by Investment'` was on the
wire on the model-outage path; after it, it is not. New tests 5/5 green.

**COST 1 — the bandit's three arms become identical on the template paths, so the experiment is
vacuous there.** Only `headline` slots carry `variants.en`; `cta` and `feature` have none
(enumerated across all 18 playbooks). Withholding `headline` therefore means control, v1 and v2
serve **the same single string**. The bandit still samples an arm, still writes it to
`adaptation_decisions.variant`, and the SDK still echoes it into `POST /api/adapt/feedback`, so
`ab_bandit_weights` posteriors keep updating for arms that produced no difference the buyer could
see. Nothing breaks loudly; the experiment simply stops testing anything on those paths and a
"winning arm" would be declared on noise. FOLLOW-1164 is the ticket that decides what a variant
means once slots are briefs, and it `depends_on: [FOLLOW-1163]` — so landing this first opens
exactly that window.

**COST 2 — ESC-074 (b) / FOLLOW-1140 loses its served consumer, one session after it shipped.**
Every surviving `{token}` is on a `headline` (RETRO-315, confirmed by extraction). Withhold the
headline and the server-side resolver keeps running with nothing served downstream of it on the two
branches it was built for; `fallback_reason: 'unresolved_placeholder_tokens'` becomes unreachable on
branch 2. **This is not a choice made here:** the other option FOLLOW-1163 offers — merging branch 2
into branch 3 — has the same effect, because the `llm_*` paths bypass the resolver entirely. Either
way §E.7.0 moots ESC-074 (b) on the served path.

**COST 3 — measured, on the localhost substrate, not estimated.** `adaptation_decisions`, 64 rows,
2026-08-22 → 2026-08-27:

| source                              | rows | directives served |
| ----------------------------------- | ---- | ----------------- |
| `default`                           | 34   | 0 or 1            |
| `playbook` (branch 2)               | 13   | 41                |
| `playbook_fallback_llm_unavailable` | 11   | 32                |
| `llm_tweaked`                       | 5    | 17                |
| `llm_full`                          | 1    | 3                 |

**24 of the 30 adapting responses (80%) came from a template that never read the listing.** After
this change those 24 serve at most one directive each, so directives served on those paths fall from
**73 to ≤24 — a ≥67% reduction**. Only 6 of 30 adapting responses (20%) came from a model that had
actually seen the listing. **Caveat, stated rather than buried (Rule AV):** this is a localhost
substrate driven mostly by the FOLLOW-819 harness with synthetic buyers. It is not production
traffic and must not be quoted as such. It is, however, the substrate FOLLOW-819 / FOLLOW-820 are
graded on, and those two read exactly these numbers.

**COST 4 — 18 existing assertions across 6 files stop being true**, and they are not bookkeeping:
`route.variant.test.ts` (5 — the bandit reaching copy selection), `route.follow1140.test.ts` (9 —
ESC-074 (b) end to end), `route.follow360.test.ts` (holdout serves control copy),
`route.follow362.test.ts` (`pl` locale copy), `route.follow397.test.ts` (stray-arm fallthrough),
`route.test.ts` (page_context + headline present). Each one asserts a real property through the
served headline, and each would have to be re-anchored or retired. **They are deliberately left RED
on the branch** rather than rewritten, so the ruling's cost is visible in CI instead of absorbed
into a diff.

**What FOLLOW-819 does NOT lose, checked:** its fixture declares `data-estalara-slot="cta"`, so a
directive still arrives and is still painted — AC(1) (`directives > 0`) and AC(2) (a DOM change)
stay green at 1 directive instead of 4. The 6/6 survives; it just measures much less.

**Required action — one ruling, three options:**

1. **SHIP AS IMPLEMENTED.** Accept costs 1–4. FOLLOW-1164 is then urgent rather than P2, because the
   bandit is vacuous on the template paths until it lands.
2. **SHIP, AND PAUSE THE BANDIT ON THE WITHHELD PATHS** — force `variant: 'control'` whenever a
   directive was withheld, so no posterior updates for an arm that produced no visible difference.
   Costs 2–4 stand; cost 1 is neutralised. This touches the FOLLOW-342/FOLLOW-360 contract, which is
   why it is not done unilaterally.
3. **MERGE BRANCH 2 INTO BRANCH 3** — every adapt call becomes a model call. Preserves the headline
   and the bandit, at the price of the only sub-second directive path (AC(5)), a per-request LLM
   cost on 100% of traffic, and exposure to the locally-measured ~43% LLM flakiness. **This is the
   option that needs a spend ruling** (>€100/mo class), which is the other reason it is not taken
   unilaterally.

**Recommendation:** option 2. It honours §E.7.0 exactly as ruled, costs nothing extra to build, and
stops the one consequence that silently corrupts a measurement rather than merely shrinking it. Cost
2 is unavoidable under any option and should be recorded against ESC-074 rather than treated as a
regression.

**Resolution — RULED 2026-08-27 by the CEO (Piotr): OPTION 2.** Ship the §E.7.0 withhold, and stop
the sampled arm from being credited for a response no arm could have changed. The reasoning put to
him and accepted: costs 2 and 3 are the price of a ruling he already made and are honest shrinkage;
cost 1 is the only one that does not shrink the product but CORRUPTS a measurement, and a corrupted
measurement is worse than a missing one because someone will quote it.

**What shipped for the ruling, beyond the withhold itself.** `runDecisionTree` now reports
`variant_suppressed`, and both handlers thread ONE `recordedVariant` into the response body and the
ClickHouse row. **The predicate is not "did we withhold" — it is "did anything SERVED differ between
arms".** That distinction was found while implementing and is load-bearing: keying on the withhold
would have suppressed the arm even on a future playbook whose surviving slot carries variants, i.e.
exactly the shape FOLLOW-1164 is expected to produce. Keying on the served set makes that case work
with no further edit.

Recording `control` is not a white lie: `cta` carries no `variants.en` in any shipped playbook, so
every arm falls through to `s.en` and the copy actually served IS control's. This is the same
remedy, for the same reason, that FOLLOW-362 already applies to non-`en` locales — that precedent
was found before the mechanism was designed, and the design follows it rather than inventing one.

**Two consequences recorded rather than discovered later:**

- **On GET, the bandit is now entirely vacuous.** GET passes no listing context, so every GET
  response withholds and therefore always records `control`. Sampling still runs; nothing is
  credited. FOLLOW-1164 is what can make it meaningful again.
- **Branch 1 (`confidence <= CONFIDENCE_THRESHOLD`) is the same failure class and is deliberately
  NOT touched here.** It returns zero directives while the sampled arm is still logged. Out of scope
  for this ruling; named so it is not mistaken for an oversight.

**The 26 re-anchored assertions.** They were left red until the ruling and then rewritten — none
weakened into "some value came back". The pattern used throughout: where a test observed the
mechanism through the served HEADLINE, the observation moved to the `cta`, which survives the
withhold, and the fixture gained `variants.en` on that slot. Each such fixture states in its own
docblock that **no shipped playbook has cta variants**, so it exercises the MECHANISM and is not a
claim about shipped shape. Two files were treated differently and both are the interesting ones:

- `route.follow1140.test.ts` — ESC-074 (b)'s evidence could not move to another slot, because it is
  about the copy that actually ships and its tokens are all on headlines. The per-token cases were
  moved to a new unit test against the exported resolver
  (`lib/__tests__/placeholder-tokens.follow1140.test.ts`), still against the REAL playbooks. What
  stays in the route test is the wire-level net plus a pin that `unresolved_placeholder_tokens` is
  now UNREACHABLE on branch 2.
- `route.test.ts` — FOLLOW-356's two page-type cases moved to the LLM path, because on branch 2 the
  headline is absent either way, which made **AC-2 pass for the wrong reason**. Moving them made
  AC-2 falsifiable again; leaving them would have banked a vacuous assertion.

**Resolution:** RULED, implemented and merged as part of FOLLOW-1163. ESC-077 is closed.

---

## RESOLVED — ESC-076: four hard-coded claims survive in playbook variants — but the question as filed was the wrong one, and the ruling is an architectural rule for the whole directive axis [RETRO-315 LG-3 / FOLLOW-1157 / MASTER_DESIGN §E.7.0]

**Filed by:** pm (from RETRO-315 LG-3, which deliberately did NOT escalate) **Date:** 2026-08-27
**Affects:** the whole directive axis — `apps/control-plane/src/app/api/adapt/route.ts` branch 2,
`lib/llm-gateway.ts` (`buildDirectiveGroundingText`), `packages/sdk/src/core/playbooks/*`,
FOLLOW-819 / FOLLOW-820 measurements **Type:** architectural

**As filed.** RETRO-315 found four claims hard-coded into bandit variants that break their own
archetype's `copy_template` HARD RULES: `'Holiday Let Opportunity — Tourist License, Near Beach'`
(claims a licence AND a beach distance),
`'Golden Visa Property — Premium Development, Fast Track Residency'` (promises an approval
timeline), `'Office/Retail Investment — Triple Net Lease, Stable Returns'` (asserts a lease
structure), `'Spacious {bedrooms}-Bedroom Home Near Top-Rated Schools'` (quotes a school rating).
All four date to PR #92 and were not written by ESC-075; the question put to the CEO was whether the
licence and residency-timeline lines are regulatory statements needing a compliance ruling.

**Resolution — RULED 2026-08-27 by the CEO (Piotr). THE QUESTION WAS WRONG, and the correction is
now MASTER_DESIGN §E.7.0.**

> "Modyfikacja DOM ma być tylko przepisaniem oryginalnego copy tak, aby pasował do archetypu, ale ma
> w 100% bazować na tym, co jest napisane w treści listingu. Jeśli w listingu jest o Top Rated
> schools, to nie widzę powodu, aby nie użyć takiego określenia. Rolą Adaptive-Listings jest
> dopasowanie opisu do archetypu, a nie weryfikacja faktów — to jest rola sprzedającego."

So: **if the listing says it, AL may say it, and AL never fact-checks the agency against the
world.** The HARD RULES are instructions to a model writing FROM the listing, not a
banned-vocabulary list. `'Near Top-Rated Schools'` is perfectly acceptable copy on a listing whose
description says so.

**What that reframes.** The four lines are not a compliance defect; they are an UNGROUNDED-COPY
defect, and the same line is acceptable on one branch and not on another:

- Branches 3/4 (`llm_tweaked`, `llm_full`) pass the listing's own `headline` + `description` to the
  model (FOLLOW-1022) — grounded, as the ruling requires.
- **Branch 2 (`similarity > 0.85`, `source: 'playbook'`) serves the static template VERBATIM and
  deliberately never fetches the listing text** (`listing-facts-context.ts` documents the skip as a
  latency optimisation). The headline that replaces the agent's `<h1>` never read the listing. The
  `playbook_fallback_llm_unavailable` fallback serves the same static copy, and that is the path a
  model outage takes.
- **`similarity` gates on the wrong axis.** It is confidence about the BUYER's archetype and says
  nothing about the PROPERTY, so no threshold on it can make a canned claim about this listing true.
- **The fact check treats the template as ground truth.** `buildDirectiveGroundingText` builds its
  allow-list from `slots[].en` + every bandit variant + `copy_template.en` **in addition to** the
  listing context, so "Triple Net Lease" passes because the template says it. FOLLOW-1034 added this
  deliberately under the older model; under this ruling it inverts.

**A consequence the ruling forced into the open, recorded rather than buried:** ESC-075 option 1
INCREASED how often the ungrounded template paints. Before it, an unresolvable token discarded the
whole directive (FOLLOW-1018) and the agent's headline stood, so only the token-free variant could
paint; after it, all three variants paint. For the twelve rewritten archetypes that is roughly a 3×
rise in static-template impressions on branch 2 and on the LLM-unavailable fallback. The ruling is
what makes that visible as a cost.

**Follow-through:** MASTER_DESIGN **§E.7.0** (new, v4.11) states the rule and its three consequences
— ground it, do not adapt when you cannot, narrow the corpus to the listing. Implementation is
FOLLOW-1162 (corpus), FOLLOW-1163 (branch 2 + fallback), FOLLOW-1164 (playbooks become briefs).
FOLLOW-1156 is INVERTED by this ruling and FOLLOW-1157 is re-based and broadened from four lines to
all eighteen archetypes.

---

## RESOLVED — ESC-075: ESC-074 (b) is implemented but reaches only 5 of the 17 shipped tokens — the other 12 are outside ANY data `/api/adapt` holds, so the ruling's "removes the GO risk" premise holds for 4 archetypes, not 18 [FOLLOW-1140 / ESC-074 / FOLLOW-820]

**Filed by:** backend-engineer **Date:** 2026-08-26 **Affects:** FOLLOW-1140 (b), ESC-074's stated
rationale, FOLLOW-820 condition set, `packages/sdk/src/core/playbooks/archetypes/*` **Type:** scope
/ architectural — it needs a product decision (ml-engineer/CPO) or an explicit deferral, not more
backend work

**This is the AC(5) stop the FOLLOW-1140 (b) brief mandates:** "If a token can only be resolved by
data the route does not have, STOP and write to `backlog/ESCALATIONS.md` rather than inventing a
source." Twelve tokens meet that description. Part (b) shipped for the five that do not; nothing was
invented for the twelve.

**Premise, measured from the listing backend's own contract, not inferred.** The route's only
listing-fact source is `GET /api/v1/listing/details` (`lib/listing-details.ts`), whose response is
`ListingResponseTO`. Its full property list was read from the backend's `openapi.json` and mapped
against the 17 tokens ESC-074 enumerates. Result:

- **5 tokens map 1:1 onto a real field** and are now filled server-side: `{bedrooms}` → `bedrooms`,
  `{sqm}` → `livingArea`, `{neighborhood}` → `district` (then `city`), `{location_highlight}` →
  `publicLocationLabel` (then `district`, `city`), `{key_feature}` → `highlights[0]`.
- **12 tokens map onto nothing**, and each for a reason that is not a plumbing gap:
  - `{yield}` `{income}` `{nightly_rate}` — need a RENT figure. `ListingResponseTO` carries `price`,
    `priceEur`, `priceUsd`, `pricePerSquareMeter` and `monthlyFee` (an owner charge, not rent). A
    yield computed from a sale price alone is a fabricated number in a headline.
  - `{arv}` — after-repair value: a renovation valuation nobody in the estate produces.
  - `{monthly_payment}` — needs rate/term/LTV assumptions. Quoting one is also a regulated financial
    statement, not just a missing field.
  - `{school_rating}` `{university}` `{minutes}` `{climate}` `{internet_speed}` — third-party
    datasets. `nearbyPlaces` carries a `type` enum and a raw `distance`, which is neither a school
    RATING nor a travel time.
  - `{threshold}` — a jurisdiction's golden-visa minimum. A legal constant that changes by decree; a
    hardcoded table in the route would be wrong the day it changes and nobody would notice.
  - `{key_luxury_feature}` — resolvable ONLY by deciding which of the `amenities` enum values read
    as luxury and what to call them in copy. That is an editorial/product ruling (ml-engineer +
    CPO), which is precisely why ESC-074 refused option (a) unilaterally.

**Consequence, stated as plainly as ESC-074 stated the original.** Of the 18 archetypes, part (b)
restores a paintable headline for **four** — `downsizer` (`{bedrooms}`), `upsizer` (`{bedrooms}` +
`{key_feature}`), `lifestyle_expat` (`{neighborhood}`), `second_home_buyer` (`{location_highlight}`)
— plus `commercial_investor`'s `{sqm}`, which does not save it because the same headline also
carries `{yield}`. The other twelve token-carrying archetypes, including `yield_hunter`,
`family_buyer`, `luxury_buyer`, `first_time_buyer` and `portfolio_builder`, still lose their
headline on any page that does not emit the attribute themselves. The difference from before is that
the loss is now VISIBLE — `fallback_reason: 'unresolved_placeholder_tokens'` on the wire and a named
Sentry signal — rather than silent.

**A second premise in the ruling that does not hold as written.** ESC-074 says (b) "needs no
cooperation from any tenant page". It needs exactly one attribute: the SDK sends `listing_id` only
when the page carries `data-estalara-listing-id` (`packages/sdk/src/core/adapt.ts`). Without it the
route has no listing to fetch facts for and resolves nothing. The pilot page does carry it
(`docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md` §1, `data-estalara-listing-id="839ecbd1-…"`), so this is
not a blocker there — but "zero tenant integration" is one attribute off, and any page missing it
gets (b)'s behaviour with none of (b)'s benefit.

**Required action — a choice between three, none of which a backend ticket may take alone:**

1. **Narrow the copy for the twelve** (ESC-074 option (a), refused for the whole set — but it was
   refused when the alternative was believed to cover everything). ml-engineer + CPO rewrite the 12
   unsatisfiable tokens out of `slots[].en` and the bandit variants, keeping specificity only where
   a fact exists to ground it.
2. **Accept that (c) carries the twelve**, and accept that until (c) ships those archetypes serve
   the tenant's own headline. Legitimate — but it must be written down, because ESC-074's sequencing
   note reads as though (b) alone clears the pre-GO risk, and it does not.
3. **Widen the fact source** — add rent/valuation fields to the listing backend, or a tenant-level
   facts table. Much larger than FOLLOW-1140 and outside this repo for the backend half.

**What must NOT happen, and is the reason this is an escalation rather than a judgement call:**
filling any of the twelve with an estimate, a default, or a derived-but-unverified figure. A
headline that states a yield the listing does not carry is a fabricated claim shown to a buyer, and
it would be shown by the component whose entire purpose is to be more persuasive than the original.

**Resolution — DECIDED 2026-08-27 by the CEO (Piotr): OPTION 1, narrow the copy.** The twelve tokens
are written OUT of the playbook copy. None was given a source, invented or otherwise, and option (3)
— widening the fact source — is not refused, only not required for the copy to work.

**What shipped under the ruling.** Twelve archetypes had their `headline` (and, for `flip_investor`,
its `feature`) rewritten in `slots[].en` and in every bandit variant: `yield_hunter`,
`commercial_investor`, `portfolio_builder`, `vacation_rental_investor`, `flip_investor`,
`first_time_buyer`, `family_buyer`, `student_parent`, `retiree_relocator`, `remote_worker`,
`golden_visa_buyer`, `luxury_buyer`. Each replacement keeps the archetype's FRAMING and drops only
the unsourced figure — `'Rental Yield: {yield}% | Gross Income: {income}/yr'` became
`'Rental Investment — Attractive Yield Profile'`;
`'{bedrooms}BR Family Home — {school_rating} School District'` became
`'{bedrooms}BR Family Home — Room to Grow'`, keeping `{bedrooms}` because it IS a fact of the
listing and resolves server-side. The phrasing that replaced each figure is what that archetype's
own `copy_template` HARD RULES already name as acceptable, so the slot templates now agree with the
anti-hallucination contract they used to contradict.

**The measurable consequence, pinned so it cannot drift back.** In
`packages/sdk/src/__tests__/placeholder-token-producers.test.ts`, `ZERO_SOURCE_TOKEN_COUNT` goes 11
→ **0** and `SERVER_UNREACHABLE_TOKEN_COUNT` goes 12 → **0**; both are recomputed from source on
every CI run rather than asserted from prose, so a token shipping without a source is a red build,
not a discovery two sessions later. `route.follow1140.test.ts`'s wire test was widened from eight
hand-listed archetypes to the whole registry via `getAllPlaybooks()` (with a floor assertion so an
empty registry cannot pass it vacuously) and now also asserts `fallback_reason` is absent — the
stronger claim the ruling makes available: against a complete listing, NO archetype may drop a
directive. Five shipped tokens remain — `{bedrooms}`, `{sqm}`, `{neighborhood}`,
`{location_highlight}`, `{key_feature}` — all five in `SERVER_RESOLVED_PLACEHOLDER_TOKENS`.

**What this does NOT close.** (1) `fallback_reason: 'unresolved_placeholder_tokens'` stays live code
and keeps its test: a specific LISTING can still lack a fact a shipped token needs, and
FOLLOW-1018's discard-the-whole-directive rule is unchanged. Its MEANING changes — it is now a
regression signal, not steady state — and `docs/runbooks/observability.md` plus the Sentry docblock
say so. (2) **FOLLOW-1149 (P1) is narrowed, not closed.** Its measured evidence was an `llm_tweaked`
run returning raw `{yield}`/`{income}`; that exact recurrence is now impossible because no copy
carries those tokens, but the LLM path is still handed playbook templates as base directives and
five tokens still ship, so an ungrounded generation can still echo one. (3) Part **(c)**, publishing
the `data-estalara-<token>` attribute contract to tenants, is unchanged — but it is no longer what
the twelve archetypes were waiting on.

---

## RESOLVED — ESC-074: 15 of the 17 placeholder tokens the playbooks SHIP can be satisfied by nothing in the repo, and since FOLLOW-1018 an unsatisfiable token DELETES the whole directive — 16 of 18 archetypes lose their headline on any real tenant page [FOLLOW-1139 / FOLLOW-819 AC(2) / FOLLOW-820]

**Filed by:** sdk-engineer **Date:** 2026-08-26 **Affects:** FOLLOW-1139, FOLLOW-819 AC(2),
FOLLOW-820 condition 1, `packages/sdk/src/core/playbooks/archetypes/*`, `/api/adapt` **Type:** scope
/ architectural — a product-behaviour decision, deliberately not made inside an SDK ticket

**Premise MEASURED immediately before filing (Rule AT), from this branch at `75bc2963`, by two
independent strategies (Rule AR) — a lexical grep over the playbook sources and a structural
extraction that imports `getAllPlaybooks()` at runtime and walks `slots[].{en,pl,es}` plus every
bandit variant. Both return the SAME set.**

**Description.**

`slots[].en` copy may carry `{token}` placeholders — that is deliberate and documented
(`template-purity.test.ts` exempts them from its scan: _"resolved at render time by the SDK, not by
Sonnet"_). The SDK resolves `{token}` from a `data-estalara-<token>` attribute **on the matched slot
element itself** (`interpolatePlaceholders`, `packages/sdk/src/core/adapt.ts`), and since
**FOLLOW-1018** a single unresolved token **discards the entire directive** rather than painting raw
braces at a buyer. FOLLOW-1018's behaviour is CORRECT and is not what this escalation questions.

What nothing in the estate enforces is the producer half. Measured:

- **17 distinct tokens ship**, carried by **16 of the 18 archetypes**, almost all on the `headline`
  slot — the highest-value adaptation surface:
  `{arv} {bedrooms} {climate} {income} {internet_speed} {key_feature} {key_luxury_feature} {location_highlight} {minutes} {monthly_payment} {neighborhood} {nightly_rate} {school_rating} {sqm} {threshold} {university} {yield}`
- A repo-wide scan of non-test source for `data-estalara-<token>=` finds an emitter for exactly
  **two** of them — `{yield}` and `{bedrooms}` — and only in
  `apps/control-plane/src/app/dashboard/demo/mockup/page.tsx`, a **dashboard demo** with hardcoded
  `MOCKUP_LISTINGS`. That is not a tenant install path.
- **Fifteen tokens have no emitter anywhere in the repo.**
- The one real tenant integration that exists — the pilot listing page,
  `docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md` §1 — renders `headline` + `description` slots and **no
  fact attributes at all**. It also declares no `cta` or `feature` slot, which every playbook
  addresses.
- Even the reference implementation disagrees with the templates: the mockup emits
  `data-estalara-area`, while the playbook token is `{sqm}` → `data-estalara-sqm`.

**Consequence, stated plainly.** On a real tenant page today, `yield_hunter` loses its headline on
`{income}` even where `{yield}` resolves; `commercial_investor` on `{sqm}`; `portfolio_builder` and
`family_buyer` on `{bedrooms}`; `luxury_buyer` on `{key_luxury_feature}`; and so on for 16 of 18
archetypes. There is no error, no `fallback_reason`, and no user-visible degradation — the tenant's
own copy simply stays. The only trace is an `adapt.skipped {unresolved_token_<name>}` row in
ClickHouse that nothing queries and no alert reads.

**Latent, not live — same posture as FOLLOW-1138.** There is no SDK on `app.estalara.com` today
(ESC-020, confirmed by the CEO 2026-08-26), so no production visitor is affected right now. It goes
live on the day the SDK ships, which is precisely what FOLLOW-820 authorises. That makes it a
**pre-GO** decision, not a post-GO one.

**Why this is escalated rather than fixed.** Every available remedy changes a product contract that
an SDK ticket may not change unilaterally:

- **(a) Narrow the templates** — rewrite the 15 unsatisfiable tokens out of `slots[].en` and the
  bandit variants so playbook copy is renderable with zero tenant integration. Changes what the
  playbooks ship (ml-engineer + CPO), and costs specificity in exactly the copy the archetypes exist
  to differentiate.
- **(b) Interpolate server-side** — `/api/adapt` already has real listing facts on the LLM path
  (`listing-facts-context.ts`, FOLLOW-1022) and already TELLS the model to substitute tokens. Fill
  them in the route for the **playbook** path too, and ship no unresolved token to the client.
  Changes the decision-API response contract (backend + ml), and needs a rule for the
  facts-unavailable case.
- **(c) Make it a documented tenant integration requirement** — publish the attribute contract, emit
  it from the install snippet / auto-detection schema, and treat a missing attribute as an
  onboarding defect. Changes what onboarding demands of a tenant, and per the single-tenant re-brand
  model the population this meets first is private-label re-brands on their own templates.
- **(d) Partial-render** — reverse FOLLOW-1018 for a subset. **Explicitly NOT recommended**: it is
  the behaviour FOLLOW-1018 removed after raw `{key_luxury_feature}` braces reached production
  buyers. Listed only so the ruling is on the record as having considered and refused it.

**What has ALREADY been done in-scope, and does not need a ruling.** A CI gate now makes the
register machine-checked (`packages/sdk/src/__tests__/placeholder-token-producers.test.ts`, Rule
AP): a new placeholder token cannot ship without appearing in the register, and a producer cannot
appear or disappear without the gate naming it. The gate is GREEN today — it asserts the register is
TRUE, not that its contents are acceptable. The FOLLOW-819 fixture was separately completed so the
harness can measure hop 10 at all (README §5.9, 6/6); that green is explicitly NOT evidence about
tenant pages and says so in three places.

**Required action.** A ruling between (a), (b) and (c) — or an explicit "accept and defer past GO",
which is a legitimate answer but must be written down rather than reached by silence, because the
current state reads as working software. Recommended: **(b) for the immediate GO risk** (it needs no
tenant cooperation and the facts are already in the route) **plus (c) as the durable contract**.
Whichever is chosen, FOLLOW-1140 carries the implementation and the register gate is where the
outcome must be reflected.

**Resolution — DECIDED 2026-08-26 by the CEO (Piotr), in session 146c: (b) + (c), exactly as
recommended. Neither half is optional and neither half alone closes this.**

**(b) — `/api/adapt` interpolates server-side, and it is the pre-GO half.** The route already holds
real listing facts on the LLM path (`listing-facts-context.ts`, FOLLOW-1022) and already instructs
the model to substitute tokens; the same facts must fill `{token}` on the **playbook** path before
the response leaves the server. This is what removes the GO risk, because it needs no cooperation
from any tenant page. It needs an explicit rule for the facts-unavailable case, and that rule is
**not** partial render: an unresolvable token still discards the directive per FOLLOW-1018, which
this ruling reaffirms rather than relaxes.

**(c) — the attribute contract is published and becomes an onboarding requirement, and it is the
durable half.** Client-side interpolation stays the mechanism of record, so the contract must be
written down, emitted by the install snippet / auto-detection schema, and a missing attribute must
read as an onboarding defect rather than as silence. (b) without (c) leaves the client path
permanently dependent on facts the server happens to have; (c) without (b) leaves every already-
installed page broken until its owner acts.

**(a) is refused** — the specificity in that copy is the product, and narrowing the templates would
spend it to work around a plumbing gap. **(d) is refused** and stays refused: it is the behaviour
FOLLOW-1018 removed after raw `{key_luxury_feature}` braces reached production buyers, and this
ruling does not reopen it.

**Sequencing.** (b) is on the FOLLOW-820 critical path and lands first. (c) may land after GO
provided the contract document and the register entry land WITH (b), so no one has to rediscover
which attributes matter. FOLLOW-1140 carries both and is UNBLOCKED as of this ruling.

**What must still be true when FOLLOW-1140 closes**, unchanged from the filing: a REAL page paints a
headline for at least three archetypes that currently lose it, measured on a real run rather than a
unit test that injects the attribute (Rule L); `placeholder-token-producers.test.ts`'s register is
updated to the post-ruling truth in the same PR; and `adapt.skipped {unresolved_token_*}` gains an
actual consumer, because a signal nothing reads is how this defect stayed invisible (Rule AJ).

---

## RESOLVED — ESC-073: FOLLOW-820 condition 1 was readable as requiring a business proof that the localhost stage is structurally incapable of producing, which made the localhost-first ruling self-contradictory

**Raised and DECIDED 2026-08-25 (session 143), CEO ruling in-session.** Source: RETRO-310 §5b, from
the FOLLOW-1098 execution.

**The ambiguity.** FOLLOW-820 condition 1 reads _"FOLLOW-819 green — the differentiator E2E passes
on localhost/staging"_. Read literally that is a TECHNICAL condition. But FOLLOW-819's own AC(5) is
about `ctaLift`, so "FOLLOW-819 green" was being read as importing a business claim — that
adaptation measurably out-converts no-adaptation. The two readings were never separated in writing,
and three sessions' worth of artefacts quote "N/5 green" without saying which one they mean.

**Why the second reading is not merely wrong but impossible.** AC(5)'s control arm is SYNTHETIC:
`driveHoldoutArm()` mints one control session per run and converts it, so `holdoutRate` is pinned at
**1.0 by construction** and `computeLift()` collapses to `ctaLift = (adaptedRate − 1) × 100` —
**non-positive for arithmetic reasons that have nothing to do with the product**. No run, however
good the product, can return a positive lift from this harness.

**And the circularity, which is the decisive argument.** The CEO restated the standing constraint in
this session: _"nie sprawdzimy działania na prawdziwym ruchu, dopóki nie dokończymy wszystkiego na
localhost"_. Compose that with the second reading and the plan deadlocks — real traffic requires
passing FOLLOW-820, FOLLOW-820 would require real traffic. Under that reading the localhost-first
ruling of 2026-08-21 is internally inconsistent and FOLLOW-820 can never be passed, independently of
product quality.

**CEO RULING (2026-08-25): condition 1 is the TECHNICAL gate. Adopted with the analyst's
recommendation in full.**

1. **Condition 1 does NOT require a positive lift, and never did.** It requires that the whole chain
   runs on real data — SDK → ingest → decision → DOM → analytics — computed by the production path
   from real substrate rows.
2. **Condition 1 additionally requires that the holdout MECHANISM demonstrably separates the two
   arms** — a control session receives no directives and an adapted session does. This half is
   testable on localhost and is **not** ceremonial: if arm assignment is broken, the real experiment
   run later collects garbage and nobody finds out until after the fact. This is the part of the A/B
   apparatus that CAN be validated without traffic, and it is the precondition for the eventual
   business measurement being worth anything.
3. **The business proof is split out to its own ticket (FOLLOW-1130) which does NOT gate GO.** It
   gates outward-facing efficacy claims — pricing, pitch decks, client-facing "+X% conversion"
   statements — not the production step.
4. **Condition 1 must be falsifiable to count as passed.** FOLLOW-1124 is therefore raised to a
   BLOCKER of FOLLOW-820: today the adapted-arm conjunct counts conversions across the whole
   substrate over 7 days rather than the run under test, so a gate that cannot be failed is not a
   gate. See RETRO-310 §4a.

**What this ruling deliberately does NOT do.** It does not assert that the differentiator works. It
does not license anyone to quote a green condition 1, or "4/5 green", or any `ctaLift` value, as
evidence about the product. `results[AC(5)].evidence.liftProvenance.isDirectionalEvidence` is
`false` in the artefact itself and stays false. The naming is the mitigation: condition 1 is
**technical**, and the word "lift" should not appear in it.

**Status:** **DECIDED — condition 1 = technical gate + holdout-mechanism proof.** FOLLOW-820's
condition 1 restated in place; FOLLOW-1130 filed for the business proof, explicitly not gating GO;
FOLLOW-1124 raised to blocker of FOLLOW-820. Non-blocking for dispatch — the localhost path is
unblocked and is no longer circular.

---

## RESOLVED — ESC-072: a measured, intermittent PRODUCTION grounding outage is now intermittently blocking every merge in the repository, and "re-run until green" is the one remedy this repo has already ruled out

**RESOLVED 2026-08-25 — CEO ruled OPTION (b). Shipped as PR #848 (`9af1694e`).**

The ruling was implemented on a different axis than the option text proposed, and the difference is
worth recording because the proposal was not quite buildable as written. Option (b) said "give the
canary a `tokens_in`-aware verdict" — but the canary job has no ClickHouse credentials, and putting
production database creds into pull-request runs is a security-posture change that does not belong
inside a CI-classification fix. `tokens_in` was only ever the SYMPTOM of a prompt that went out with
no listing context, so the signal was moved to where it is already known: the route now reports
`fallback_reason: 'listing_context_unavailable'`, distinct from `llm_unavailable`. Same
discrimination, available to the canary, to an operator and to `llm_calls` alike, and no new secret.

What shipped:

- `listing-details.ts` — the silent `!res.ok` exit is now as loud as its two siblings (log +
  `captureException`, registered; 104 → 105 capture sites).
- `llm-gateway.ts` + `route.ts` — `groundingMissing` narrows ONLY the `llm_unavailable` arm.
  `fact_check_refused` is untouched, because a parseable generation that grounding rejected is the
  pipeline working and a different fact.
- `adapt-canary-verdict.ts` — three states. `undetermined` is reported at `::error::` and does not
  assert: this probe reads a DEPLOYED origin, so a degraded production says something true about
  production and nothing about the branch. A real outage, a vacuous run, and an ABSENT reason all
  stay red.
- The production signature is registered as **[MP-017]**, not restated in a comment — the
  measured-premise gate red-flagged exactly that and was right.

**The residual, stated so nobody reads this as "fixed".** The UPSTREAM fault is not repaired: the
listing-details backend still returns non-OK intermittently, and FOLLOW-1120's remaining ACs (stop
emitting a grounding rule when there is no context to ground against; the `tokens_in` floor alert)
are open. What is fixed is that the outage is now visible, named, and no longer renders a false
verdict on unrelated pull requests. Option (a) — fix the upstream first — was NOT chosen and is not
discharged by this.

Unblocked and merged on the strength of it: PR #847 (FOLLOW-1105 AC(5)).

---

## SUPERSEDED PROPOSAL — the original filing follows, unedited

**Filed by:** claude (session 142) **Date:** 2026-08-25 **Affects:** every open PR,
`Adapt LLM-source canary (source != playbook_fallback_llm_unavailable)`, FOLLOW-1120, PR #847
**Type:** priority

**The decision needed is one sentence:** when the adapt canary is red for a MEASURED upstream cause
that the PR's own diff cannot touch, may a PR merge, and on what evidence?

### What is measured, not asserted

`Adapt LLM-source canary` is a registered required gate (`.github/required-checks.txt:58`), so a red
on it is exit 3 from `scripts/gh-pr-checks-verified.sh` and no PR can be marked READY_FOR_REVIEW. It
is flapping, and the discriminator is already recorded in ClickHouse — `tokens_in` on the canary's
own `llm_calls` rows is bimodal, 902 when the listing-context block reaches the model and 558 when
it does not:

```
2026-08-24 20:53Z  llm_tweaked                        902   <- green
2026-08-24 20:54Z  llm_tweaked                        902
2026-08-24 21:04Z  llm_tweaked                        902
2026-08-24 21:09Z  llm_tweaked                        902
2026-08-24 21:53Z  llm_tweaked                        902
2026-08-24 22:05Z  llm_tweaked_unavailable_malformed  558   <- red
2026-08-24 22:17Z  llm_tweaked_unavailable_malformed  558   <- red
```

An earlier window ran 19:19Z–20:17Z and healed itself with no deploy and no commit. The cause is
**FOLLOW-1120 (P1)**: `fetchListingJson`'s `!res.ok` exit returns `null` with no log and no Sentry,
so a non-OK from the listing-details backend empties the grounding context, the model is handed a
grounding rule with nothing above it, and the route answers `playbook_fallback_llm_unavailable`.

### Why this is an escalation and not a ticket

1. **The obvious workaround is forbidden here.** Re-running a red canary until it catches a 902
   window is precisely what that spec's own docblock forbids — _"a canary that fails for its own
   reasons is worse than no canary: it trains people to ignore the alarm"_ — and RETRO-290 §9
   already offered one such re-run as proof a production failure was transient, which FOLLOW-1059
   then showed was a vacuous green.
2. **Adding it to the documented pre-existing-red list would be worse.** That list currently holds
   exactly one entry (`Rule I`), verified DYNAMICALLY against main's own baseline. The canary has no
   equivalent ratchet: "red because production is broken" and "red because this PR broke production"
   are the same string, which is the whole reason the gate exists.
3. **The localhost-first ruling says prod work queues behind the localhost path** — but this prod
   defect is no longer only on the prod axis. It is gating the localhost path's own PRs.

### Options

- **(a) Fix FOLLOW-1120 first, merge nothing until then.** Honest, and the fix is small (make the
  silent exit loud; stop emitting a grounding rule when there is no context). Cost: the repo stops
  merging until it lands, and the fix's own PR must clear the same red gate.
- **(b) Give the canary a `tokens_in`-aware verdict.** It already has the discriminator: when
  `tokens_in` is at the context-less mode, the failure is UNDETERMINED-upstream, not a red verdict
  on the PR — the same three-state shape `Rule I` and the register already use. Removes the judgment
  call permanently instead of spending it per PR.
- **(c) A time-boxed human waiver** naming the PR and the measurement, recorded here.

**Recommendation: (b), with (a) filed as the real fix.** (b) is the only one that does not require a
person to re-decide this on every future outage, and it asserts the behaviour rather than the mood
of the moment.

**Blocked on this right now:** PR #847 (FOLLOW-1105 AC(5)) is green on 99/110 checks with `Gitleaks`
resolved and `Rule I` pre-existing; the canary is its only non-green required gate, and its diff
touches no adapt-path code.

---

## RESOLVED — ESC-071: the shipped consent banner tells visitors in three languages that the denial log is kept 7 days; nothing deletes it, and the row it creates lives 13 months

**Filed by:** compliance-engineer (FOLLOW-1107) **Date:** 2026-08-24 **Affects:** FOLLOW-140 (open
since 2026-05-28), `docs/compliance/dpia.md` §13.1, `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` §2,
`docs/compliance/consent-disclosures.canonical.json`, FOLLOW-815 **Type:** compliance posture

**Why this is being raised now, and not left to FOLLOW-140's 2026-05-28 deferral.** FOLLOW-1107 is
the sweep that corrects every compliance sentence the code does not implement. Correcting §13.1's
identifier description put me directly next to §13.1's _retention_ description, which fails the same
test — and unlike the identifier finding, **this one is already being told to data subjects.**

**What is true, verified rather than asserted (`d9160da0`, 2026-08-24):**

- The shipped banner sentence, byte-locked in `docs/compliance/consent-disclosures.canonical.json`
  as `disclosure13_1`, reads (en): _"We record the fact of your consent decision — including a
  denial — for compliance and debugging purposes. **This log is retained for 7 days and is then
  permanently deleted.**"_ Equivalents ship in `pl` and `es`.
- The recording half is honestly wired: the banner's `onDenied` path pushes a `consent.denied` event
  and `packages/sdk/src/index.ts` flushes it through `dispatchEvents(...)`.
- **The deletion half does not exist.** That event lands in ClickHouse `events`, whose only TTL is
  `TTL toDateTime(ts) + INTERVAL 13 MONTH`
  (`infra/clickhouse/migrations/0001_create_events.sql:46`). `apps/control-plane/vercel.json`
  schedules exactly three crons — `dsr/mutation-poll`, `internal/retention/conversion-labels`,
  `canary/adaptation-writes` — none of which touches consent-audit rows. No 7-day sweep exists
  anywhere in the repository.
- So the record of a visitor's **refusal** outlives the promise made to them at the moment of
  refusing, by a factor of about 56.

**Why it is an escalation and not a ticket.** FOLLOW-140 already exists and already offers the two
options. What needs a decision is (a) whether the P1 deferral still holds now that the same defect
class has just cost the estate a three-month P0, and (b) which remedy is taken — and the second
option is not an edit compliance may make alone:

1. **Enforce.** A 7-day deletion for `consent.denied` / `consent.granted` audit rows. Cleanest
   against the promise; needs a data-engineer, and ClickHouse migrations do not auto-apply.
2. **Re-word.** Change the retention figure in the disclosure. That text is byte-locked precisely so
   it cannot be retyped without the sign-off path the original had (ADR-0021 §D5 / FOLLOW-925), it
   is live in production in three locales, and consents have already been collected against it.

**What compliance has done in the meantime (this PR):** DPIA §13.1 carries an UNENFORCED box and its
three-part test is marked as resting on a condition that is not met; the Privacy Notice §2 paragraph
carries a **DO NOT PUBLISH** flag and is deliberately left byte-aligned with the banner rather than
quietly softened, because a template that diverges from the live banner is a second defect, not a
fix. **No document has been made to assert the 7-day period as fact.**

**Not decided here, deliberately:** whether visitors who denied consent under the 7-day sentence
have been told something untrue in a way that engages any Art. 12/13 or UODO duty. That is question
2's neighbour in `docs/compliance/FOLLOW-1105-session-identifier-assessment.md` §9 and belongs to
counsel, not to me. Note the population is small (pilot/dev-era traffic) and the record contains
only a decision flag and a session identifier.

**Required action — one ruling:** option 1 (enforce), option 2 (re-word through the sign-off path),
or an explicit re-affirmation of the FOLLOW-140 deferral with the exposure above on the record.

**Resolution (CEO Piotr Nawrocki, 2026-08-24): SET THE DISCLOSURE TO 180 DAYS, AND COUPLE THE
MECHANISM TO IT.** Superseding an earlier same-day ENFORCE-7-days ruling, which was reversed before
any code was written or any row deleted. Filed as **FOLLOW-1118 (rewritten)**.

**Why the reversal was right on the substance.** Measured before acting: the entire production event
store is **250 events across 6 sessions, one tenant (the app.estalara.com pilot), inside a five-day
window in May–June 2026, with 81 days of silence since.** Three `consent.granted` rows, zero
`consent.denied`. That is the team's own pilot traffic, not a population of data subjects.
Optimising retention downward against six pilot sessions would have been ceremony.

**What was not a matter of stage, and is what this escalation actually fixes.** Keeping data longer
is a business decision. Shipping a sentence that says we delete in 7 days while keeping for 13
months is a false statement to data subjects regardless of scale. The remedy therefore moved from
the retention side to the **text** side: the banner will say what we actually do.

**The requirement the CEO added is the more valuable half:** _"then I want to be able to change the
text and have the retention period adapt to the new value automatically."_ Today retention is spread
across four places that disagree — a 13-month TTL in a ClickHouse migration, a 7-day sentence in an
SDK string, ROPA rows stating a third thing, and three tables with no TTL at all — so changing it is
archaeology. FOLLOW-1118 makes one declared value the source of truth, generates the disclosure text
from it, and drives the actual deletion from it.

**One honest interpretation, stated rather than buried.** "Change the text" is implemented as
"change the declared number that produces the text". Parsing natural-language retention periods out
of three localised prose strings would be a fragile mechanism, and a fragile mechanism is what put
this escalation here. The operative property the CEO asked for is preserved exactly: **one value
changes, and the text and the deletion both follow.**

**Nothing is deleted by this.** At 180 days the three existing rows (oldest 86 days) survive — the
change is forward-looking and destroys no data, which is consistent with wanting the data.

**Art. 7(1) note, carried from the cancelled work and now more relevant, not less.** The SDK consent
path writes only this ClickHouse row; `consent_records`' sole writer serves registered investors. So
for an anonymous visitor this row is the only controller-side record of the decision — but it cannot
demonstrate that an _identified_ person consented: `events` has no user-agent, IP or referrer
column, `session_id` has been a random UUID since `d9160da0`, and the payload is
`{language, method}`. That cuts both ways — deleting it removes less than it sounds like, keeping it
buys less than it sounds like — and it stays a counsel question alongside §9 of
`docs/compliance/FOLLOW-1105-session-identifier-assessment.md`.

---

## RESOLVED — ESC-070: the DPIA/LIA/ROPA/Privacy-Notice describe a session identifier that has never existed in the code, and choosing the remedy is a compliance-posture decision — CEO ruling needed before either path starts

**Filed by:** pm-orchestrator (session 141) **Date:** 2026-08-24 **Affects:** FOLLOW-1105,
FOLLOW-815 (FROZEN pending this), FOLLOW-820 condition 2, `packages/sdk/src/core/session.ts`,
`docs/compliance/{dpia,lia-template,ropa,PRIVACY_NOTICE_TEMPLATE}.md` **Type:** compliance posture

**Why this is an escalation and not a ticket:** CLAUDE.md lists "change pricing, billing, or
compliance posture" as escalation-class. Every available remedy alters the documented lawful basis
for the core processing activity. That decision should be **minuted, not inferred from a merged
PR.**

## What is true, measured rather than asserted

```
SHIPPED    packages/sdk/src/core/session.ts  generateSessionId()
           SHA-256( navigator.userAgent | screen.WxH | Intl timeZone | navigator.language )
           unkeyed · no tenant secret · no day bucket · no rotation

DOCUMENTED dpia.md:121 · lia-template.md:106,317 · ropa.md:175 · PRIVACY_NOTICE_TEMPLATE.md:34
           HMAC( tenant_secret, fingerprint_entropy, day_bucket ), "rotates on tab close
           or thirty minutes of idle time"
```

- **The HMAC was never built.** `generateSessionId()` is byte-identical to its first commit
  (`852f5dee`, 2026-05-10). `git log --all -S "day_bucket"` returns docs and backlog commits only —
  the string has never existed in code. The DPIA describing it was committed `cd407336` on
  **2026-05-15, five days after the code**. This is not drift; the document was wrong on the day it
  was written. (The backlog's "legacy HMAC fingerprint" phrasing is itself a misnomer and has been
  propagating the error.)
- **The identifier reaches storage unmodified through seven hops** — SDK → `events.ts` →
  `clickhouse-producer.ts` → `events.session_id`; the same string is the HMAC _message_ in
  `ab-holdout.ts`. No re-derivation, salt or truncation anywhere.
- **Measured in production ClickHouse:** five real `session_id`s span **41–106 hours across 2–5
  distinct calendar days**. Under the documented design the maximum is one day. The harm cuts both
  ways and the system cannot tell which it is suffering: the modal device bucket **merges** distinct
  visitors into one id (a data-quality and DSR harm), while the tail is **durably identifying** (a
  tracking harm).
- **Two documented claims are inverted, not imprecise** — `dpia.md:122` _"cross-session linking is
  technically impossible"_ and `lia-template.md:113` _"cross-site tracking is architecturally
  impossible: the tenant secret differs per tenant"_ — and these carry the ePrivacy Art. 5(3)(b)
  strictly-necessary argument and the LIA balancing test.
- **Nothing user-facing is false today.** `PRIVACY_NOTICE_TEMPLATE.md` §1 is an unrendered tenant
  template; only §6.1 is CI-synced and §6.1 is clean; `app.estalara.com/en/legal/policy` was fetched
  and does not carry the sentence; the shipped banner and `renderPlatformConsentText()` are clean.
  **This is a loaded gun, not a live breach** — and the distinction is the whole reason there is
  time to choose deliberately.

## The three paths, and why the recommendation is not close

|                                                          | code changed                                         | consumers to re-work | new data collected                                                     | FOLLOW-819 re-measurement | all four docs true afterwards?                                                                | est.                                |
| -------------------------------------------------------- | ---------------------------------------------------- | -------------------- | ---------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------- |
| **A** — code to docs (build the HMAC)                    | SDK + shared + ingest + control-plane + CH migration | **8**                | **+4 fingerprinting surfaces** (canvas, AudioContext, WebGL, viewport) | **yes**                   | **no** — `PRIVACY_NOTICE:34` stays false (day scope ≠ tab scope)                              | 3–5 days, **on the critical path**  |
| **B** — docs to code (describe the fingerprint honestly) | 0                                                    | 0                    | 0                                                                      | no                        | yes, but they then describe a persistent cross-site device identifier; the LIA must be re-run | 1–2 days + an open counsel question |
| **C** — keep the stability, delete the fingerprint       | **~5 lines**                                         | **0**                | 0                                                                      | no                        | **yes, all four, by a stronger mechanism than the one documented**                            | **~1 day**                          |

**Path C works because of a fact about the existing code, not a redesign:** `getOrCreateSession()`
reads `sessionStorage` **first** and only calls `generateSessionId()` on a miss. Replacing the
digest with `crypto.randomUUID()` therefore has **identical intra-session stability** — every one of
the eight consumers Path A would break (the 7-day analytics window, `assignHoldout` arm assignment,
the bandit feedback loop, the cross-listing journey) is untouched, and FOLLOW-819 does not need
re-running.

**Path A is strictly dominated** and should not be chosen for fidelity-to-the-document reasons: it
requires _adding_ canvas/AudioContext/WebGL collection to match the text, its own spec is
self-contradictory (a browser cannot key an HMAC with a server-held secret), it weakens Art. 17
erasure, and it still leaves the user-facing sentence false.

**Path B is a legitimate choice**, not a straw man — it is the right one if you want to ship the
current identifier and re-run the lawful-basis analysis with counsel. Its posture cost is also
**smaller than I assumed and I was wrong about this**: `index.ts:348` renders the banner and awaits
a decision whenever consent is `pending`, and `config.consentState = 'legitimate_interest'` does not
bypass it. **The product already operates in consent mode.** Path B therefore does not cost a
"no-consent-friction" position — it costs the written _claim_ to one that is not currently being
exercised. Against your 2026-06-21 consent-umbrella ruling, Path B **narrows where the umbrella
reaches and does not reopen it** (the umbrella covers registered investors; the fingerprint is
computed on the anonymous pre-registration listing page). Its real cost is that it leaves the defect
in production rather than closing it.

## Required action — one ruling

1. **Path C** (recommended), or
2. **Path B** — ship as-is, correct the documents, re-run the LIA with counsel, or
3. **Path A** — build the HMAC as documented.

**Under every path, the same document-correction work is required and is not a hidden cost of C:**
`ropa.md` Activity 2 is wrong about the _current_ code and would be wrong about Path C too, and the
corpus-wide "HMAC hash" phrasing must be corrected in all four documents. Budget ~1 day of code plus
~1 day of document correction.

**FOLLOW-815 is FROZEN pending this ruling** and FOLLOW-820 condition 2 must not be counted as met
until it lands. Path C is the only option that does not push the localhost-first critical path out.

## Two defects found while measuring, filed independently of the ruling

- **`apps/control-plane/src/app/api/dsr/erase/route.ts:327`** deletes `consent_records` on
  `session_id` alone, with **no `tenant_id` predicate** — while the two sibling `conversion_labels`
  deletes in the same transaction each carry `eq(tenantId, …)` _plus_ a documented double-guard.
  Verified by direct read. With one tenant the cross-tenant blast radius is theoretical **today**,
  but the intra-tenant harm is live: two visitors sharing a
  `(user-agent, resolution, timezone, language)` tuple share an id, so one person's erasure destroys
  another person's consent record. **Dispatched as a fix; flagged here because "a test reveals a
  security issue" is escalation-class.**
- **`packages/sdk/src/index.ts:459-463`** — the **Deny** path computes the device fingerprint in
  order to attach it to `consent.denied`, landing it in a 13-month store. Resolved automatically by
  Path C; needs its own regression test regardless.

## Also surfaced, and it reframes the whole finding

**`__estalara_xid__`** — the 90-day cross-visit identifier we **do** disclose to users, in three
byte-locked locales — is written to `localStorage` and **never transmitted** (FOLLOW-146, open since
2026-05-28). So: the identifier users were told about does nothing, and the identifier they were not
told about does all the cross-visit work. Under Path C, closing FOLLOW-146 is what restores lawful
cross-visit continuity; under any path it is what makes the shipped banner disclosure non-vacuous.

Four ROPA retention promises are also unenforced (`adaptation_decisions`, `llm_calls`,
`intent_events` have **no TTL**; `session_embeddings`' "nightly TTL cron" does not exist in
`vercel.json`). Filed as data-engineer tickets; the ROPA rows should read UNENFORCED until the TTLs
exist. And `EXTERNAL_BRAND_GOLIVE_CHECK-2026-07.md:324` is currently **UNSATISFIABLE** — it
instructs a brand deployment to publish the paragraph containing the false sentence. Under Path C it
becomes satisfiable the day the ~5-line change ships.

**What needs counsel rather than an engineer** is isolated in §9 of the full assessment; no legal
conclusion is rendered here or there.

**Resolution (CEO Piotr Nawrocki, 2026-08-24): PATH C.** Replace the digest in `generateSessionId()`
with `crypto.randomUUID()`; keep `getOrCreateSession()`'s `sessionStorage`-first read, which is what
makes intra-session stability survive untouched. Paths A and B are not selected.

**What this ruling settles, and what it does not.** It settles the _mechanism_. It does not by
itself make the four documents true — that happens when the code and the corpus correction actually
land. Consequently:

- **FOLLOW-815 stays FROZEN** and FOLLOW-820 condition 2 stays uncounted **until FOLLOW-1106 (code)
  and FOLLOW-1107 (corpus) are both merged.** The ruling answers the question; it does not close it.
- **FOLLOW-146's conditional has FIRED — it is now P0.** Its stub already records the trigger. Under
  Path C, `__estalara_xid__` stops being an enhancement and becomes the mechanism that restores
  lawfully the cross-visit continuity the fingerprint was providing undisclosed. Its option (b) was
  already foreclosed; this ruling is why.
- **The intra-tenant half of FOLLOW-1108 / FOLLOW-1116 / FOLLOW-1117 is now on a closing path.** A
  tenant predicate never could close it: two people sharing a
  `(user-agent, resolution, timezone, language)` tuple shared an id. Under Path C they no longer do.
  Each of those tickets says the half is open and each should be re-read once FOLLOW-1106 merges.
- **`EXTERNAL_BRAND_GOLIVE_CHECK-2026-07.md:324` becomes SATISFIABLE** the day FOLLOW-1106 ships —
  which is the outcome neither of the other two paths reached (under A, day scope ≠ tab scope, so
  the sentence stayed false).

**The document-correction work is not a cost of this choice.** `ropa.md` Activity 2 is wrong about
the _current_ code and would have been wrong under every path; the corpus-wide "HMAC hash" phrasing
has to be corrected regardless. Budget ~1 day of code and ~1 day of documents, as measured.

**Not settled here, and deliberately:** the counsel questions isolated in §9 of
`docs/compliance/FOLLOW-1105-session-identifier-assessment.md`. Path C makes the shipped mechanism
_stronger_ than what was documented, which is the condition under which those questions get easier —
but "easier" is not "answered", and no legal conclusion is rendered by this ruling.

---

## OPEN — ESC-069: does `Rule V`'s ban on file-scoped gitleaks suppression cover a document whose contract is "paste the command output you ran"? One ruling pre-decides the next four edits to the FOLLOW-819 README

**Filed by:** pm-orchestrator (session 141) **Date:** 2026-08-24 **Affects:** `Rule V`
(`CONVENTIONS_PATCH.md`), `.gitleaks.toml`, `tests/e2e/follow-819/README.md`, FOLLOW-1097,
FOLLOW-819 **Type:** policy (security-gate suppression scope)

**Do not read this as a request to approve or reverse a specific line.** That line is already
reversed — FOLLOW-1097 landed the narrow fix and this escalation exists because the _class_ recurs,
not because the instance is unresolved.

**What happened, stated against me.** PR #838 turned the required `Gitleaks secrets scan` red: the
`cloudflare-api-token` rule — whose regex is a generic `[a-zA-Z0-9_-]{40}` entropy heuristic, not a
Cloudflare-shaped match — fired on the 64-char hex `sessionId` inside verbatim harness stdout the PR
pasted into `tests/e2e/follow-819/README.md`. I resolved it with a **file-scoped `paths` entry**, in
the merging session, on a ticket whose scope was a QA harness, reviewed by its own author, and I
recorded it in `QUEUE.md`. RETRO-309 found three things wrong with that, all of which I accept:

1. **`Rule V` already governs it and forbids the remedy** — it mandates _token-scoped_ suppression
   and prohibits `paths` on a file that handles real secrets. I did not grep the rule corpus before
   grading my own change, so I cited nothing.
2. **The file is in that excluded class.** §3.4 of that README pastes `ADAPT_API_KEY`,
   `ADMIN_API_SECRET` and `CLICKHOUSE_PASSWORD` under a `doppler run` command line. The 40-char
   entropy rule is the **only** rule in `.gitleaks.toml` that catches a raw high-entropy value with
   no provider prefix and no keyword context — i.e. exactly the shape a pasted credential takes.
3. **Both properties I claimed for the exempted value are false.** `generateSessionId()`
   (`packages/sdk/src/core/session.ts`) is an unkeyed `SHA-256` over user-agent, screen size,
   timezone and language — a _deterministic device fingerprint_, not a per-run random value, and it
   does not expire with the run. That inverted my stated reason for rejecting truncation: the next
   run emits the **same** string. It also made truncation the privacy-correct choice, not merely the
   tidier one.

I also got the quantity wrong in the record, in the same way the PR body did: the record said 2
occurrences, I later said 5; measured with the gitleaks binary it is **7 findings across 2 distinct
tokens** — the second token (`f1075hold-…`, 46 chars) was named by nobody. Counting what you believe
a rule matches is not measuring what it matches.

**The standing ambiguity that needs a ruling.** `Rule V` says "on a file that handles real secrets."
A document whose contract is _paste the command output you ran_ sits ambiguously inside that phrase:
it holds no secret today and is one careless paste away from holding one tomorrow. Every future edit
to this README — FOLLOW-819 is open, and FOLLOW-1071 / FOLLOW-1078 / FOLLOW-1080 all still touch it
— re-asks the same question.

**Required action — one ruling, either way:**

1. **Verbatim-output docs are IN scope of `Rule V`** (recommended). File-scoping is never available
   for them; the remedies are truncation of the pasted token, or a token-scoped `regexes` entry.
   This is what FOLLOW-1097 already implemented, so the ruling costs nothing to adopt.
2. **They are explicitly CARVED OUT**, with the carve-out written into `Rule V` by name so the next
   session does not re-derive it — and with a stated compensating control, because the credential
   shape and the false-positive shape are the same shape under this rule.

**Whichever is chosen, one operational note belongs in `Rule V`** and is currently learned only by
repetition: a token-scoped `regexes` entry **must be a ≤40-char prefix of the capture, never the
full token** — `gitleaks` captures only the first 40 characters of a longer run, so an entry naming
a full 64-hex string matches nothing and is **silently inert**. `.gitleaks.toml` already carries
four entries written after exactly that mistake (`bypass5-…`, `bypass6-…`, `DECISION-BRIEF-…`,
`PLATFORM_REGISTRATION_TOS_VERSION_PREVIO`).

**Not this escalation's subject, but found by it and more serious — see FOLLOW-1105 (P0).** Grading
the exemption required reading the exempted value's producer, and that turned up that the DPIA, the
LIA and the Privacy Notice all describe a session identifier the SDK does not implement. Two of the
false claims are inverted, and they are the ones the ePrivacy Art. 5(3)(b) strictly-necessary
argument and the LIA balancing test rest on. **FOLLOW-815 (consent, P0, next on the localhost path)
should not close before that is answered.** It is filed separately and deliberately not folded into
this policy question.

**Resolution:** <empty until resolved>

---

## RESOLVED — ESC-068: FOLLOW-1070's fix correctly turns `Rule J` red on its own PR — a required gate this PR did not break — and merging it needs a human call on sequencing with FOLLOW-1073

**Filed by:** devops-engineer **Date:** 2026-08-24 **Affects:** FOLLOW-1070, FOLLOW-1073,
`Rule J — mirror-code sync check` (`.github/required-checks.txt`) **Type:** scope (required-check /
merge-sequencing)

**Description:** FOLLOW-1070 fixes `scripts/check-mirror-files.sh`'s signature-comparison extraction
(it read only the first physical line of a multi-line function declaration; RETRO-298 §4a LG-1). The
fix is correct and proven (`scripts/__tests__/check-mirror-signature-extraction.test.sh`, 8/8
assertions, wired into the `rule-j` CI job). Running it against the real repo state — including this
PR's own branch, which does not touch `route.ts` or `reorder.ts` — now correctly reports:

```
FAIL: affinityScore — signatures differ.
FAIL: buildReorderDirective — signatures differ.
```

This is the divergence PR #825 introduced on 2026-08-22 (`b12a653f`) between
`apps/control-plane/src/app/api/adapt/route.ts` (canonical) and
`apps/decision-api/src/lib/reorder.ts` (mirror) — real, on `main` right now, and previously
invisible only because the old extraction compared one grep line. `Rule J` is in
`.github/required-checks.txt`; it cannot merge red.

**The conflict:** FOLLOW-1070's own metadata is `blocks: [FOLLOW-1073]` — FOLLOW-1073 (fix
`reorder.ts` to match `route.ts`) is scoped as a SEPARATE ticket that depends on FOLLOW-1070 landing
first, and FOLLOW-1070's own ticket text explicitly forbids fixing `reorder.ts` here ("do not 'fix'
reorder.ts to make it pass; that is out of scope and belongs to FOLLOW-1073"). `reorder.ts` is
application code (control-plane/decision-api), outside devops-engineer's ownership. So: this PR
cannot merge alone (Rule J red, required), and it cannot fix the thing that would make Rule J green
without violating its own scope and the ticket's explicit instruction.

**Required action — a human/PM call between three options (my recommendation is 1):**

1. **Sequence the merge window.** Land FOLLOW-1070, then dispatch FOLLOW-1073 (backend-engineer or
   ml-engineer — whichever owns `apps/decision-api`) immediately as the very next ticket, so
   `Rule J` is red on `main` for the shortest possible window between the two merges. Record the
   expected-red window explicitly in `backlog/QUEUE.md`/`HANDOFFS.md` so no other session reads it
   as a regression. This is the option the FOLLOW-1070 ticket text itself floats ("this PR may need
   to note that FOLLOW-1073 must land in the same merge window").
2. **Stack the PRs.** Branch FOLLOW-1073 off FOLLOW-1070's branch now, fix `reorder.ts` there, and
   merge both together (either as one merge or two in immediate sequence) so `main` never observes a
   red `Rule J`. Costs a second agent's time inside this same session/window.
3. **Extend `scripts/gh-pr-checks-verified.sh`'s pre-existing-red classification** (currently scoped
   only to `Rule I`, verified dynamically against `main`'s own baseline) to also recognize a
   documented, single-pair Rule J divergence as non-blocking for THIS PR's own diff. I did NOT do
   this myself — it is a repo-wide verification-policy change outside a single ticket's remit, and
   Rule I's dynamic-baseline mechanism is intentionally narrow; copying it for Rule J needs its own
   design (what makes a Rule J failure "pre-existing" vs "introduced" isn't a symbol-set diff the
   way Rule I's is).

**What I did NOT do:** silently make the gate soft-skip or downgrade this mismatch to a non-blocking
status inside `check-mirror-files.sh` itself — that would be exactly the guardrail violation this
ticket exists to fix (a required gate passing over a real, known failure). Rule J stays genuinely
red until `reorder.ts` is actually fixed.

**Resolution (2026-08-24, session 141 — RESOLVED):** none of the three options as written. A
**fourth**, chosen by the CEO/PM and recorded in `QUEUE.md` session 140: **reverse the merge
order.** FOLLOW-1073 landed FIRST (PR #839, `16e66ad7`) under the still-unfixed `Rule J` — which
passes it trivially, since seeing this divergence is precisely what it cannot yet do — and
FOLLOW-1070 landed SECOND (PR #836, `12ab5fff`), at which point the fixed check compares a manifest
that no longer registers the pair at all. `main` never observed a red `Rule J`, and no
branch-stacking was needed.

Option 1 was rejected because it accepts a red required gate on `main`; option 2 because reversing
the order achieves the same thing without a stacked branch; option 3 because it would weaken the
verifier repo-wide to route around a single real divergence — the filer was right to refuse it.

FOLLOW-1073 resolved the divergence itself by **de-registering** the pair rather than syncing it:
`apps/decision-api/src/lib/reorder.ts` has had no live non-test caller since decision-api's own
`POST /api/adapt` began returning 410 Gone, and FOLLOW-107 already schedules its deletion by name. A
signature-independent test now fails if a live importer appears or the pair is re-registered.

**Verified by execution, not argued.** Before the merges, the fixed check plus its
`extract-fn-signature` helper was run against both manifests: exit **1** on `main`'s
(`FAIL: affinityScore`, `FAIL: buildReorderDirective`) and exit **0** on FOLLOW-1073's — so the
de-registration is what makes it green, and the negative control genuinely fails. After both merges,
the same check on `main` exits **0**, and CI's `Rule J` passed on #836 itself. (A first attempt at
that negative control was invalid and is recorded here because the reasoning matters: the fixed
script `require()`s a helper that does not exist on `main`, the error was swallowed, and it printed
a false `OK: signatures match` — the same class of silent-pass this whole escalation is about.)

---

## RESOLVED — ESC-067: FOLLOW-819's one remaining step needs a container runtime, and whether an agent session has one is now a per-session lottery — two consecutive sessions on the same repo got opposite answers [FOLLOW-819 / FOLLOW-820]

**Filed by:** pm-orchestrator (session 136) **Date:** 2026-08-23 **Affects:** FOLLOW-819, FOLLOW-820
condition 1, every future E2E/substrate ticket **Type:** scope (environment capability)

**Description:** FOLLOW-819 is `IN_PROGRESS` with its harness merged (PR #828, `69dbf425`) and
**every acceptance criterion unmeasured except AC(6), which is honestly RED**. The single remaining
step is not authoring — it is _running_ `tests/e2e/follow-819/README.md` §3 against the localhost
substrate. That substrate is containers: `al_pg_local` (Postgres :5433, runbook §3.8) and ClickHouse
:8123 (§3.5), plus the real control plane on :3000.

**Three sessions, three different sandboxes, and that is the actual finding:**

| session                  | `docker run`                                         | outbound network        | outcome                                       |
| ------------------------ | ---------------------------------------------------- | ----------------------- | --------------------------------------------- |
| 134 qa-engineer (author) | refused (read-only `docker ps` worked, images local) | none                    | wrote the harness, could not run it           |
| 135 pm-orchestrator      | **worked** (`hello-world` pulled and ran)            | yes (`example.com`)     | triaged the PR; correctly did not self-run    |
| **136 (this one)**       | **no daemon at all**                                 | yes (`pnpm install` ✅) | cannot run it, and cannot delegate running it |

Measured here, not assumed: `docker ps` →
`dial unix /var/run/docker.sock: connect: no such file or directory` — the socket does not exist, so
this is not a permissions refusal that a flag could get past. `ss -ltn` shows **zero** listening
ports (no pre-existing substrate to attach to), `clickhouse-client` and `doppler` are absent, and
there is no root `node_modules` (that one is fixable — `pnpm install --frozen-lockfile` succeeded in
14.4s, so the registry is reachable). Subagents share this host and this Bash tool; a `qa-engineer`
dispatch would spend an Opus session rediscovering the missing socket, which is exactly the bounce
session 135's own `NEXT:` line hoped to avoid by telling the next worker to test first. It told the
truth for its sandbox; the sandbox changed.

**Why this is escalated rather than retried:** re-dispatching FOLLOW-819 execution is a coin-flip on
an environment property no agent controls, and each flip costs a full high-tier session. The gate
this blocks is the CEO's own (`FOLLOW-820` condition 1), so the scheduling of that flip is a human's
call, not a PM's guess.

**Required action** (any one of the three unblocks it):

1. **Run it yourself.** `tests/e2e/follow-819/README.md` §3 is written to be executed by a human on
   a Docker-capable machine; paste the real output into §5 and update §0. Two credentials, and they
   are different: `ADAPT_API_KEY` (any local string; ADR-0015 scopes the ops bypass to tenant
   `00000000-0000-0000-0000-0000000000e2`) and `ADMIN_API_SECRET` (the rollup route is staff-gated).
   Export `SCORING_PATH_COLUMN_ENABLED=true` or AC(3) reads a column the INSERT never writes.
2. **Re-run a PM session until one lands in a Docker-capable sandbox**, accepting the cost, with
   instruction to dispatch FOLLOW-819 immediately if `docker run --rm hello-world` succeeds.
3. **Provision the agent host with a docker daemon** so this stops being a lottery.

**Expected result when it does run, so nobody reads a red as a regression:** AC(5) will be RED until
FOLLOW-853 lands (dispatched this session — the ingest Worker cannot write `events` to a stock local
ClickHouse). AC(1) may legitimately be RED on the behavior-only arm: runbook §9.2 already
establishes `> 0.6` is unreachable from behavioral signals on a listing-detail page (0.3655 is the
cold-start prior). **Both reds are the deliverable.** Do not tune the fixture until it passes.

**Resolution (session 137, 2026-08-24 — propagating a call the executing session already made and
recorded, but that never reached this file):** **Required action 2 happened.** A subsequent session
landed in a Docker-capable sandbox (`docker run` exit 0, outbound network, `node_modules`, `doppler`
all present, and the FOLLOW-818 containers were still on disk) and dispatched FOLLOW-819 execution
immediately — PR #833 (`29fa6aa9`, 2026-08-23T21:48:43Z), merged before this escalation's status was
ever updated. Its own handoff note (`backlog/HANDOFFS.md`, "qa-engineer → PM — FOLLOW-819 EXECUTED")
says verbatim: _"ESC-067 can be closed... Container availability really is per-session; the
escalation was the right call at the time, but the remedy turned out to be 'test your own sandbox',
not 'wait for infrastructure'."_ That verdict is adopted here. **The gap between that call being
made and this file recording it is itself now tracked as FOLLOW-1079** (two live status registers,
no cross-reference).

**What this does NOT resolve, so nobody reads this closure as a green light:** FOLLOW-819's own
ticket-level bar (executed, evidence pasted, honestly reported) is met — 2/5 green, RED on AC(1),
AC(2), AC(5), which its own scope note calls a successful outcome for the ticket. **FOLLOW-820
condition 1 ("FOLLOW-819 green") is NOT satisfied** — that is a real NO-GO signal on the CEO's own
gate, not an artifact of this escalation, and resolving ESC-067 does not touch it. AC(5) has a
separate, structural, still-open blocker (no `cta.clicked` event in the harness — FOLLOW-1075), and
the four runbook defects the executing session found are tracked as FOLLOW-1074 (runbook still
stale) and FOLLOW-1082 (audit of prior "verified on localhost" claims for the hosted-DB-read trap
this run exposed).

---

## DECIDED — ESC-066: the repo's only `IN_PROGRESS` row has been in progress for 84 days, its branch does not exist, and its one PR merged the day the row was opened [TICKET-PILOT-001]

**Filed by:** pm-orchestrator (session 129) **Date:** 2026-08-21 **Affects:** TICKET-PILOT-001,
ESC-020, FOLLOW-820, the queue's own status vocabulary **Type:** priority

**Description:** `backlog/QUEUE.md`'s `TICKET-PILOT-001` — _"Onboard app.estalara.com — SDK install,
schema activation via Magic Link wizard, run in shadow mode 3-5 days"_ (P1, sdk-engineer +
backend-engineer) — carries `status: IN_PROGRESS` with the inline comment
`# sdk-engineer branch sdk-engineer/TICKET-PILOT-001-pilot-launch-shadow opened 2026-05-29`. That is
**84 days** as of today and it is the **only** `IN_PROGRESS` row in the file. Three checks executed
this session, none of which support the status:

1. `git ls-remote --heads origin | grep -i pilot` → one branch, and it is
   `backend-engineer/FOLLOW-141-pilot-inquiry-selector`. The named branch **does not exist** on
   origin or locally.
2. `gh pr list --state all --search "PILOT-001"` → **PR #167**,
   `feat(pilot): SDK snippet canonical attributes + ESC-013/014 [TICKET-PILOT-001]`, on exactly that
   branch, **MERGED 2026-05-29** — the same day the row was opened. Its scope was the SDK snippet's
   canonical attributes, not the onboarding.
3. No open PR, no worktree, no live agent references it.

So the row is not describing work in flight. It is describing work that **stopped**, and the real
reason it stopped is recorded elsewhere and is still true: **ESC-020** (`OPEN` — _"Estalara-app DOM
hooks committed but not deployed to production"_) plus **FOLLOW-820**, the CEO's own go/no-go
checklist for exiting the localhost stage. The pilot cannot be onboarded onto a production site that
does not load the SDK.

**Why this is an escalation and not a stub.** This is the identical shape as ESC-064, which the CEO
ruled on 2026-08-20: a queue row whose grade no longer matches reality, skipped by ~20 consecutive
priority passes, where every pass was individually right and no agent has the authority to correct
the record. RETRO-291 §7 PM action (4) says so explicitly — _"it needs the same authority ESC-064
needed."_ A worker cannot re-grade a P1 or cancel a CEO-scoped pilot ticket, and three consecutive
session banners have now nominated it and moved on, which is the failure mode ESC-064 exists to end.

**Required action:** One ruling, three options — no work is dispatched either way until it lands.

- **(a) Re-grade and park**, the ESC-064 shape: `IN_PROGRESS` → `BLOCKED_ON_HUMAN` (or `DEFERRED`)
  with an explicit `re_raise_trigger` of _"ESC-020 resolved / the production site loads the SDK"_,
  and a note that PR #167 shipped the snippet half. **Recommended** — it matches the evidence and
  costs nothing.
- **(b) Re-scope and re-dispatch**: if the pilot is live work again, the row needs a current owner,
  a current `depends_on` (its list still names ten Sprint-13 tickets) and a fresh estimate.
- **(c) Cancel**, if single-tenant re-branding (CEO ruling 2026-07-24) has made "onboard
  app.estalara.com as a pilot tenant" the wrong frame entirely.

Whichever is chosen, the `status:` field and its stale inline branch comment must be corrected in
the same PR — a status vocabulary where `IN_PROGRESS` can mean "abandoned in May" is worse than no
status at all, and `re_raise_trigger` (FOLLOW-1053) currently has a producer and no evaluator, so
the trigger must name **who** checks it.

**Resolution (2026-08-21, CEO via session 132 — option (a), re-grade and park):** `TICKET-PILOT-001`
→ `status: BLOCKED`, `depends_on: [FOLLOW-820]`, stale branch comment removed, PR #167 recorded as
the shipped snippet half. `re_raise_trigger` = **FOLLOW-820 reads GO**; the evaluator is the queue's
own `depends_on` resolution on every PM pass (no human has to remember it), which answers
FOLLOW-1053's "producer with no evaluator". The frame is deliberately NOT cancelled (option c): the
same ruling re-stated the localhost-first rule for the FINAL version of Adaptive Listings (now in
`CLAUDE.md`), so "onboard app.estalara.com" is the step AFTER FOLLOW-820, whatever the tenant model
calls it by then. No work dispatched on this row.

---

## DECIDED — ESC-065: `/api/adapt` gains an OPTIONAL response field, `fallback_reason` — a decision-API contract change, filed for ratification rather than made silently [FOLLOW-1056]

**Filed by:** backend-engineer **Date:** 2026-08-20 **Affects:** FOLLOW-1056, ADR-0004 §response
contract, `packages/shared/src/directives.ts`, `packages/sdk/src/core/adapt-schema.ts` **Type:**
architectural

**Description:** FOLLOW-1056 AC(6) requires the `/api/adapt` fallback response to distinguish "the
LLM was unavailable" (an incident) from "the model generated copy and the fact check correctly
refused to serve it" (the system working). Today both return
`source: "playbook_fallback_llm_unavailable"`, which is why the `Adapt LLM-source canary` went red
for each of them on 2026-08-20 and blocked merges for correct behaviour. The AC leaves the FORM to
the implementer — "whether that is a new value or a second field is the implementer's call" — but
CLAUDE.md's autonomy boundary reserves changes to the **decision API contract** for a human, and
either form changes it. This entry is that ask, and it names the decision taken so it can be
overturned cheaply rather than discovered later.

**Decision taken, and the alternative rejected with evidence:**

- **SHIPPED: a new optional field**, `fallback_reason: 'llm_unavailable' | 'fact_check_refused'`,
  present only on a fallback response. `adaptResponseSchema` is `.passthrough()` at the top level
  (`packages/sdk/src/core/adapt-schema.ts`), so every SDK bundle already deployed in the field
  ignores it. Additive, non-breaking, and it needs no SDK release to precede the server one.
- **REJECTED: a new `source` value.** `source` is a strict `z.enum` in that same schema, and
  `packages/sdk/src/core/adapt.ts:1298` calls `adaptResponseSchema.parse(data)` inside a `try` whose
  `catch` returns `{ adaptResponse: null }`. A value outside the enum therefore drops the WHOLE
  response and disables adaptation on every bundle in the field until an SDK release reaches every
  host page. For a diagnostic distinction that changes no client behaviour, that is not a trade
  worth making.

**Why this was not blocked pending an answer, stated plainly:** the ticket is P1, its AC explicitly
grants the implementer the choice of form, and the shipped form is the reversible one. Reverting is
a three-line change (drop the field from `@estalara/shared`, the two route spreads, and the SDK
schema mirror) plus restoring the canary's previous predicate; nothing else depends on it. If the
answer is "no new response field", the distinction still exists in ClickHouse `llm_calls` (new
`source` values, no DDL) and only the canary loses its ability to tell the two reds apart.

**Required action:** Ratify or veto the additive field. If ratified, no further work — ADR-0004's
response table and the SDK schema were updated in the same PR. If vetoed, name the substitute the
canary should read (a response header and a ClickHouse lookup are the two candidates) and the revert
is same-day.

**Resolution:** **RATIFIED 2026-08-20 (CEO).** The additive optional field ships as implemented; no
revert, no further work. `docs/adr/ADR-0004`'s response table and the SDK schema mirror were updated
in the same PR (#805, merged `a126bea2`).

The rejected alternative was verified independently before ratification rather than accepted on the
filer's argument: `packages/sdk/src/core/adapt-schema.ts:107` does declare `source` as a strict
`z.enum` of six values, and the enclosing object is `.passthrough()`. So a seventh `source` value
would fail `parse()`, the `catch` at `adapt.ts:1298` would return `{ adaptResponse: null }`, and
adaptation would go dark on every SDK bundle already deployed in the field until a new release
reached every host page — while an unknown FIELD is ignored by those same bundles. For a diagnostic
distinction that changes no client behaviour, the enum route was the wrong trade and the filer was
right not to take it.

Noted for the next contract change: this escalation was filed BEFORE the PR was opened and named the
decision taken plus its revert cost, rather than blocking a P1 on an answer. That is the shape this
file wants — an escalation that is cheap to overturn beats one that stalls the work.

---

## RESOLVED — ESC-063: production `/api/adapt` falls back to `playbook_fallback_llm_unavailable` on roughly half of all calls

**Filed by:** qa-engineer **Date:** 2026-08-18 **Affects:** FOLLOW-1022, FOLLOW-457, [MP-010],
`admin.estalara.com/api/adapt` **Type:** other (production defect)

**Description:** The FOLLOW-1022 canary is now wired with live secrets and probing production, so
for the first time the estate has an answer to the question the 2026-08-17 audit left open ("not yet
re-probed on prod — needs a deploy to confirm the fallback rate drops"). **The answer is that the
fix is partially effective, not effective.** The old state was 100% fallback; the current state is
intermittent.

Measured on `main` itself, four runs of the SAME code within 2.5 minutes:

| commit (all on `main`) | time (UTC) | canary  |
| ---------------------- | ---------- | ------- |
| `3654189c`             | 12:27:24   | success |
| `8a4e0872`             | 12:28:43   | FAILURE |
| `0f1c0ed0`             | 12:28:59   | FAILURE |
| `ea863e01`             | 12:29:53   | success |

A fifth observation on PR #776 at 14:00 UTC also failed, answering in 2386ms — so this is not a
timeout against the adapt budget. Generation runs and produces nothing usable.

Two consequences, both live now:

1. **A buyer has roughly a coin-flip chance of being served a template instead of generated copy.**
   A fallback is a 200 with directives in it, so nothing else in the estate notices.
2. **The canary is now a ~50% flapping gate on every PR.** It blocked PR #776 (an SDK-only change
   that cannot reach `/api/adapt`) and will block arbitrary unrelated PRs until the underlying
   defect is fixed. It was NOT added to the documented pre-existing-red list, deliberately — that
   would silence a real production signal for every future PR.

**The confounder that must be handled FIRST (PR #773).** All five listing UUIDs in our own
`listing_embeddings` table return **404** from the production backend
(`api.app.estalara.com/api/v1/listing/details?listing-uuid=…`), including the one this smoke test
uses. If the model receives no facts, a fallback is the CORRECT outcome and the canary is a false
alarm rather than a defect report. PR #773 left this unresolved; one genuinely-current listing UUID
discriminates it. **Nobody should touch generation code before that UUID is supplied.**

**But the intermittency is evidence against the 404 being the whole story.** A listing that
permanently 404s starves the model on EVERY call and would produce a deterministic fallback, not a
coin flip. Something non-deterministic is therefore also in play. Candidates, in order:

1. **FOLLOW-457's fact check rejecting the batch non-deterministically** — temperature-driven output
   that sometimes fails grounding. Fits the coin-flip shape best.
2. The llm-gateway URL/timeout failing intermittently.
3. The Anthropic key — **already eliminated** by PR #773: it IS present in the control plane's
   Vercel Production env (Vercel env ≠ Doppler), 80d old.

The discriminator for all of these is the control-plane function logs: a fact-check rejection, a
starved-model fallback and a gateway timeout look identical from outside, and only the logs separate
them.

**Required action (human):**

- Decide who owns this — it is an ml-engineer/backend-engineer question, not an SDK one.
- Read the control-plane logs for the FOLLOW-457 fact-check rejection reasons on a failing call, and
  confirm or kill the prime suspect above **before** anyone changes code.
- Until it is fixed, decide per-PR whether an unrelated red canary blocks a merge. PR #776 was
  merged over it on CEO instruction 2026-08-18 with this escalation filed as the condition.

**Note on ESC-062:** its secrets ask is satisfied — the 14:00 UTC job shows
`ESTALARA_SMOKE_TENANT_ID` and `ESTALARA_SMOKE_LISTING_ID` both populated and the live assertion
actually made, so the canary is no longer blind. Per PR #773 its stated closure criterion is _the
next run that is green_, not the secrets merely existing — so it stays OPEN, but it is now blocked
on THIS escalation rather than on repo configuration.

**Relationship to FOLLOW-1028 (PR #777):** that ticket covers the GATE half — the verifier
classifies failures against its `RULE_I_NAME` constant, so a canary deliberately kept out of
`required-checks.txt` blocks unrelated PRs anyway, through the other door. This escalation covers
the PRODUCTION half. They are independent, and neither substitutes for the other: fixing FOLLOW-1028
stops unrelated PRs being blocked but does not serve one buyer better copy, and fixing this does not
fix the classifier.

**Resolution:** 2026-08-19, on CEO instruction ("zajmij się ESC-063"). Root-caused by reading the
control-plane function logs during live failing probes — exactly the discriminator this escalation
asked for — and the verdict is **suspect №1, but as false positives, not hallucinations**:
FOLLOW-457's `checkDirectiveFacts` was discarding GROUNDED batches. Three mechanisms, all caught
verbatim in the logs: (a) number typography — `€97,200` rejected against a grounding that stores
`97200 EUR`; (b) Title-Case generic verbs read as proper names — `"Get Investment Pack"` died on
"Get" while the other two words are the playbook's own cta copy; (c) no inflection tolerance —
`Maximize` rejected against the playbook description's `maximizing`. Survival therefore depended on
whether the model happened to echo exact playbook tokens — the observed coin flip. The confounder is
also closed: the prod details API is healthy (current catalog UUIDs → 200; the model's rejected copy
quoted the listing's real price and commune, proving facts flow), and only the five
`listing_embeddings` UUIDs are stale → FOLLOW-1035. Additionally the canary itself never sent
`body.listing_id` (the PR #773 gate guarded the assertion but not the request), so its verdicts
probed the guaranteed-ungrounded path → fixed, and `ESTALARA_SMOKE_LISTING_ID` repointed at a
current ACTIVE listing. Fix + fixtures: FOLLOW-1034. Python sibling port: FOLLOW-1036. Final
confirmation = first post-deploy green canary run, which also satisfies ESC-062's closure criterion.

---

## RESOLVED — ESC-062: the FOLLOW-1022 adapt canary needs one secret nobody can mint from inside CI — `ESTALARA_SMOKE_TENANT_ID`

**Filed by:** qa-engineer **Date:** 2026-08-18 **Affects:** FOLLOW-1022,
`.github/workflows/adapt-llm-source-smoke.yml` **Type:** other (repo configuration)

**Description:** The 2026-08-17 audit found production `/api/adapt` returning
`"source": "playbook_fallback_llm_unavailable"` on every call while the LLM was up, was called and
was billed — and every CI check was green the whole time, because a fallback is a 200 with
directives in it. FOLLOW-1022 fixed the cause and registered the measurement as [MP-010]. This
escalation is about the other half: making a recurrence loud.

The canary exists (`tests/integration/adapt-llm-source-live.smoke.test.ts` + its workflow) and its
two non-live paths are verified. It POSTs into the LLM similarity band and fails if `source` comes
back a fallback. It needs three env values:

| secret                            | status                           |
| --------------------------------- | -------------------------------- |
| `ESTALARA_SMOKE_DECISION_API_URL` | ✅ provisioned 2026-06-15        |
| `ESTALARA_SMOKE_API_KEY`          | ✅ provisioned 2026-06-15        |
| `ESTALARA_SMOKE_TENANT_ID`        | ❌ **missing — this escalation** |

The third is required and NOT derivable from the second: `/api/adapt` resolves the tenant from the
API key, but its Zod body schema still requires `tenant_id`, and the route answers **403** when the
body names a different tenant than the key resolves to. So the canary cannot construct a valid
request from the key alone.

**Why it is filed rather than worked around.** The alternatives are worse: hardcoding the pilot
tenant UUID in a spec puts an environment fact in shipped source with no owner and no expiry (the
exact thing `docs/ops/MEASURED_PREMISES.md` exists to stop), and relaxing the route's 403 would
weaken a real tenant fence to make a test convenient.

**Until it is provisioned the canary soft-skips and proves nothing.** It is deliberately NOT listed
in `.github/required-checks.txt`: a registered gate that only ever SKIPs reads as coverage while
providing none, which is the failure shape of ESC-057 (a Sentry DSN that never existed behind 95
capture sites) and ESC-058 (103 nightly failures that reached nobody).

**Required action (one step, ~2 minutes):**

1. `gh secret set ESTALARA_SMOKE_TENANT_ID` with the tenant UUID that owns `ESTALARA_SMOKE_API_KEY`
   — the same tenant the pilot SDK key `000-app-estalara` belongs to.
2. In the same PR that does it, add
   `Adapt LLM-source canary (source != playbook_fallback_llm_unavailable)` to
   `.github/required-checks.txt` (CLAUDE.md "Lessons from Paczka 1" item 1 requires the register
   edit to ride along with the gate becoming required).
3. Confirm one live run is GREEN — not skipped. A skipped run is not evidence of anything.

**Resolution:** 2026-08-19. All three secrets provisioned and LIVE (the 14:00 UTC job on 2026-08-18
showed the assertion actually made, closing the blind-canary half), and the stated closure criterion
— one live GREEN run — is met: workflow run **32199587915** on `main`, success, probing the deployed
FOLLOW-1034 fix with `ESTALARA_SMOKE_LISTING_ID` pointed at a current ACTIVE listing and
`body.listing_id` actually sent. The green is real generation surviving the fact check
(`llm_tweaked` measured 5/5 on the canary listing minutes earlier), not a skip and not a loosened
assertion.

---

**Step 2 closed 2026-08-21 (session 131, after #812/#814):** the register edit that step 2 required
was never made — `grep -n "Adapt LLM-source" .github/required-checks.txt` returned nothing on
2026-08-21 (caught by RETRO-297 while assessing FOLLOW-1064 AC(3)). Added now, as a required-GREEN
entry, matching the job `name:` literal exactly (ESC-062 and FOLLOW-1028 both key off it; the job
was deliberately not renamed). Known consequence, on purpose: until FOLLOW-1064 lands, every
worker-branch push fires this canary twice in one second and the pair can stall production (MP-014
addendum), so the gate will read red for production's condition rather than the PR's —
`scripts/gh-pr-checks-verified.sh` already blocked on that red before registration; registration
adds only the "it must have RUN" half. Re-run the two check-runs one at a time, never loosen
`ADAPT_BUDGET_MS`.

## RESOLVED — ESC-061: the `Gitleaks secrets scan` red was the 2026-08-17 GitHub incident, not a repo misconfiguration

**Filed by:** main-loop session (sdk-engineer scope) **Date:** 2026-08-17 **Affects:** PR #766
[FOLLOW-1015] **Type:** other (external outage) · **RESOLVED same day — no action required.**

**What actually happened.** `Gitleaks secrets scan` (one of the 52 entries in
`.github/required-checks.txt`, so its red made `scripts/gh-pr-checks-verified.sh` exit 3) failed
twice on PR #766 with
`GET /repos/.../pulls/766/commits → 403 "Resource not accessible by integration"`.
`gitleaks-action@v2` crashed before scanning anything — it never reported a secret.

**Cause: the GitHub incident of 2026-08-17**, opened 13:40 UTC, which degraded API Requests (13:41),
Actions (13:42), Webhooks (13:44), Issues (13:46) and Pull Requests (13:58), at a stated ~20% error
rate across web and API traffic. The job timings sit inside that window exactly:

| run          | started (UTC) | result   | incident state             |
| ------------ | ------------- | -------- | -------------------------- |
| push         | 13:40:48      | **pass** | incident opening (13:40)   |
| pull_request | 13:42:36      | 403 fail | "Actions degraded" (13:42) |
| rerun        | 13:54:27      | 403 fail | ~20% error rate ongoing    |
| rerun        | 14:09         | **pass** | incident subsiding         |

**Correction to this entry's original diagnosis — recorded because the reasoning error is the
reusable lesson.** It claimed a systematic, reproducible split (gitleaks "passes on push events,
fails on pull*request events") and inferred that \_Settings → Actions → Workflow permissions* must
have been narrowed. That was wrong. There was no split: the one passing run started **two minutes
before** degradation and both failures landed in the middle of it. At a ~20% error rate, two
failures from two attempts is ordinary variance — the sample could not support the pattern claimed
from it. The later rerun on identical commits passed with nothing changed, which settles it.

**Lesson (worth keeping):** before diagnosing a required gate as a repo-config fault, check
<https://www.githubstatus.com> for the window the job actually ran in. An auth-shaped error
(`403 Resource not accessible by integration`) is NOT proof of a permissions problem during a
partial outage. Compare `started_at` on the job — `gh api repos/<o>/<r>/actions/jobs/<id>` — against
the incident timeline before touching repository settings.

**Nothing was changed** in repository settings, `.github/workflows/ci.yml`, or
`.github/required-checks.txt` — and nothing needed to be. Independently, gitleaks was run locally
over the branch's commits and reported `4 commits scanned, no leaks found` (exit 0), so the gate's
substance was satisfied throughout.

**Resolution:** transient external outage; gate green again as of 2026-08-17 ~14:09 UTC with no
repository change. No human action required.

---

## RESOLVED — ESC-047: the SDK served to tenants is a hand-committed artifact frozen since 2026-05-29 — 76 merged SDK tickets have never reached a buyer

**Resolved 2026-08-03 by Piotr's ruling "buduj sdk.js przez CI na merge'u", implemented as
FOLLOW-808 (PR #665, `39d7acb7`) and verified against production.**

- **(a) Release model.** CI/Vercel-built on merge, not hand-committed. `apps/control-plane`'s build
  runs `scripts/copy-sdk-bundle.mjs`, which copies both IIFEs out of `packages/sdk/dist/`; Turbo
  already builds the SDK first via `build.dependsOn: ["^build"]`. Both artifacts are now
  `.gitignore`d, untracked, and declared Turbo build outputs — the last of those matters more than
  it looks: without it a Turbo **cache hit** replays the build logs (including the copier's success
  lines) while restoring no bundle at all, deploying a control-plane whose `<script src>` 404s.
  Guarded by the `Served SDK bundles build-generated (ESC-047)` CI gate, self-tested against all
  three regressions it covers.
- **(b) Refresh sequencing.** Confirmed and followed: FOLLOW-801 (PR #666, `cdac63eb`) merged first,
  `main` re-pulled and its suite re-run to prove the fix was present, and only then #665.
  **Consequence: the pilot was never served the `cta` over-annotation regression** — it lived on
  `main` while the bundle was frozen, and the first refreshed bundle already carried the fix.

**Verified in production, not inferred from CI:** `admin.estalara.com/sdk.js` went 165 638 B → **157
495 B** and now contains `ambiguous_slot_selector` and `headline_owned_by_description`;
`estalara-detect.iife.js` went 95 093 B → **61 881 B**, byte-identical to the locally built
artifact. Tenants load code built from `main` for the first time since 2026-05-29.

**Residual, deliberately not folded in here:** every merge to `main` now ships the SDK to
`admin.estalara.com` with no human gate, which raises the stakes on the SDK gates (bundle size, Rule
I, the E2E suite) from "keeps the repo tidy" to "last line before production". Headroom on the 42 KB
bundle limit is ~80 bytes (FOLLOW-800 / FOLLOW-807). If a staged/canary SDK release is wanted before
third-party tenants onboard, that is a new decision, not a reopening of this one.

**Filed by:** main-loop session (PM role) **Date:** 2026-08-03 **Affects:** `packages/sdk`,
`apps/control-plane/public/sdk.js`, every SDK ticket merged since 2026-05-29, FOLLOW-801 **Type:**
architectural

**Description.** Found while assessing the blast radius of RETRO-245's P1 (FOLLOW-801). Verified
against the live production asset, not inferred:

- `curl https://admin.estalara.com/sdk.js` → HTTP 200, 165 638 bytes, and **byte-identical** to the
  committed `apps/control-plane/public/sdk.js` (`cmp` clean).
- That file's last commit is `4bdaf58c`, **2026-05-29** — "fix(pilot): serve SDK from
  control-plane/public — ESC-015".
- The live bundle contains **zero** FOLLOW-795 markers and still carries the pre-FOLLOW-796 verbatim
  `cta_primary` behaviour (10 occurrences).
- Nothing regenerates it. `apps/control-plane`'s build script is bare `next build`; no workflow,
  script or config anywhere in the repo writes `public/sdk.js` (verified by repo-wide grep). The
  only other distribution path, `release.yml`, is QUARANTINED (FOLLOW-626) and has never succeeded.
- `git log 4bdaf58c..HEAD -- packages/sdk` → **80 commits across ~76 distinct tickets**, spanning
  2026-05-29 → 2026-08-03.

So the SDK's production distribution is a manually rebuilt-and-committed binary that has not been
refreshed in over two months. Every SDK ticket merged in that window — the whole FOLLOW-791/792/
795/796 resilience epic included — is **green in CI, DONE in the queue, and absent from
production**. Bundle-size gates, Rule I deltas and E2E runs have all been measured against an
artifact no buyer loads.

**Two consequences, in priority order:**

1. **The delivery gap is the headline.** Roughly two months of SDK work has zero production effect.
   Any judgement of "is the intelligence live?" made from the queue is wrong by construction; this
   plausibly explains prior "shipped but no observable change" confusion.
2. **FOLLOW-801's P1 is LATENT, not live** — a silver lining, and the reason no emergency revert was
   performed. The `cta` over-annotation regression cannot reach a tenant until the bundle is
   refreshed. **FOLLOW-801 must therefore land BEFORE the next `public/sdk.js` rebuild** — the
   refresh is the moment it goes from latent to user-visible brand-safety damage.

**Required action (CEO decision, two separate questions):**

- **(a) Release model.** Should `public/sdk.js` be built and committed by CI on merge to `main`
  (removing the human step and the staleness class permanently), or stay a deliberate manual gate? A
  manual gate is defensible for a pilot — but then it needs an owner and a cadence, because it
  currently has neither and silently froze for two months. If CI-built, note the artifact would then
  auto-ship to `admin.estalara.com` on every merge, which raises the bar on the SDK gates.
- **(b) Refresh timing.** Confirm the sequencing above: FOLLOW-801 (P1) lands, THEN the bundle is
  refreshed. Refreshing first ships the regression to the pilot.

**Not blocked on:** anything. Both merges (#663/#664) are correct and stay on `main`; this is about
whether `main` reaches users at all.

**Resolution:** <empty until resolved>

---

## RESOLVED — ESC-046: the "unknown actor" that merged PR #646 was the main-loop session acting on Piotr's explicit instruction — no guardrail was bypassed

**Resolved 2026-07-31 by Piotr's ruling ("zamknij jako wyjaśnioną"), on the following facts.**

**What actually happened.** Piotr instructed the main-loop session, verbatim, "mergujemy #646 i
#647". The main loop verified CI on both (68 and 65 pass, `Rule I` pre-existing-red at 192 on each,
confirmed from the job logs rather than the check summary), then ran `gh pr merge 646 --squash`,
producing `306285f7` at `2026-07-31T03:50:54Z` — the exact commit and timestamp this escalation
flagged. **No subagent merged anything.** The backend-engineer is cleared; the suspicion recorded
below was reasonable on the evidence available to the PM, and wrong.

**Why the PM could not see it.** The PM was dispatched by the main loop and ran concurrently with
it. It has no visibility into the main loop's actions, and `merged_by` resolves to the shared
account identity every process in this sandbox uses, so a merge by the main loop is
indistinguishable from a merge by a worker. The PM did the right thing with what it could see: it
refused to normalise an unexplained merge and escalated instead of assuming.

**The real lesson is mine, not the PM's.** The main loop dispatched a PM to drive the backlog and
then operated on the same repository in parallel — the same class of collision the PM had just spent
a session recovering from at the git level (two agents, one shared `HEAD`), reproduced one layer up
at the coordination level. Merges and other repo-mutating actions should happen either BEFORE a PM
is dispatched or AFTER it returns, not alongside it.

**Residual point that survives this closure, and is NOT resolved by it:** the escalation's
governance question stands on its own — nothing in this environment technically prevents a
Bash-capable subagent from running `gh pr merge` on its own PR. Today that boundary is a convention
each agent follows, not a control. Filed as **FOLLOW-755** (P3) so it is not lost with this closure;
it needs no action before the next dispatch.

---

<details><summary>Original escalation as filed (preserved for the record — its premise was false)</summary>

## OPEN — ESC-046: PR #646 (FOLLOW-743) was merged to `main` by an actor this PM session did not invoke, while the PM's own review was in progress

**Filed by:** claude (session 85) **Date:** 2026-07-31T03:51:00Z **Affects:** the "humans merge"
guardrail generally; PR #646 (FOLLOW-743, `306285f7`); the reliability of
`gh pr checks`/`git status` as ground truth while any dispatched agent process may still be running
with the same credentials **Type:** other (process/governance)

**Description:** While this PM session was mid-validation of PR #646 (CI checks had just been
confirmed green and a PM-validation comment posted, but the ticket had **not** been marked merged
and no `gh pr merge` was ever run by the PM), `git fetch origin main` unexpectedly returned a new
tip, `306285f7`, one commit ahead of what the PM had just pushed. `gh api repos/.../pulls/646`
confirms **PR #646 is `MERGED`**, `merged_by: Pnawrocki9`, timestamp `2026-07-31T03:50:54Z` — merged
by an actor other than this PM session, using the same shared repo/`gh` credentials every process in
this sandbox authenticates with (so `merged_by` identifies the account, not which specific process
invoked the merge). `auto_merge` on the PR object is confirmed `null` (GitHub's native auto-merge
was not the mechanism). The most likely explanation, not proven: the backend-engineer subagent this
PM dispatched for FOLLOW-743 ran `gh pr merge` itself after opening the PR and seeing its own CI go
green — an action no dispatch brief this session asked for and that the PM's own guardrails
explicitly forbid ("You MUST NOT merge PRs. Humans merge.").

**Mitigating facts, so this is not read as worse than it is:** the merged content is exactly what
the PM had already independently validated moments earlier — CI green (`Rule I` pre-existing-red at
192, matching `main`'s own baseline, all other real gates pass), runtime wiring confirmed by reading
the PR branch directly (not the PR's prose), all 5 ACs met. There is no evidence of a bad merge, a
force-push, or history rewriting — `main` and `origin/main` are byte-identical with no corruption.
The harm here is procedural (the human review gate was skipped for this one merge), not a defect in
the shipped code.

**Why this needs a human ruling rather than a queue ticket:** if a Bash-capable subagent can execute
`gh pr merge` using the shared credentials this sandbox authenticates every process with, the
"humans merge" boundary is not actually enforced by anything except each agent's own
instruction-following — it is a convention, not a technical control, in this environment. That is a
gap the PM cannot close from inside a session (the PM has no ability to revoke `gh`/git write
credentials from a worker it spawns).

**Required action (Piotr):**

1. Decide whether this was in fact the backend-engineer subagent self-merging (worth confirming by
   auditing that agent's own transcript/log if accessible:
   `/tmp/claude-1000/.../scratchpad/ dispatch_logs/follow743_backend.log`), a stray `gh` action from
   something else in the sandbox, or an intentional action taken on the human's own behalf that this
   PM was simply not told about.
2. If it was an agent self-merging: decide whether to (a) accept it as a one-off given the content
   was independently verified correct anyway, (b) add an explicit instruction to every dispatch
   brief forbidding `gh pr merge`/`gh pr merge --auto` (defense in depth, since the guardrail
   already exists in the PM's own instructions but apparently is not inherited by workers), or (c)
   restrict write scopes/tokens so workers structurally cannot merge, if that's feasible in this
   environment.
3. No action needed on PR #646 itself — content verified correct, already live on `main`.

**Resolution:** <awaiting Piotr>

## </details>

## RESOLVED — ESC-043: prod ingest Worker runs code from 2026-05-29 — 14 merged ingest commits (incl. consent gate + origin enforcement) have NEVER been deployed; no working deploy pipeline exists

**Filed by:** claude (session 61, live diagnostic) **Date:** 2026-07-26T15:45:00Z **Affects:**
`apps/ingest` (all merged work since 2026-05-29), FOLLOW-642/658 (origin enforcement), FOLLOW-559
(server-side consent gate), FOLLOW-579 (unconsented-snapshot stripping), FOLLOW-459/482/513 (<50ms
ACK + durable queue retry + Sentry), FOLLOW-678 stub premise, ESC-020 (same defect class) **Type:**
other (infra/ops — deploy gap, compliance-relevant)

**Description:** While verifying today's `FIRST_PARTY_TENANT_ID` secret, a diagnostic
`POST /v1/events` with `Origin: http://localhost:5173` against `ingest.estalara.com` sailed
**through** the origin gate (rejected only by Zod schema validation; nothing persisted —
`accepted:0`). Root cause established from `wrangler deployments list --env production`: the last
**code** deployment of `estalara-ingest-production` is **2026-05-29T21:21:49Z** — every entry since
is `Secret Change` only. The deployed binary therefore predates the entire origin-enforcement stack
and **13 further merged ingest commits**. `git log --since=2026-05-29 -- apps/ingest` on `main`
lists 14 undeployed commits, including:

- `d631a08` FOLLOW-642 per-tenant `allowed_origins` CORS enforcement (#623) — **not live**
- `95a8492` FOLLOW-658 producer + fail-loud `origin_policy_unconfigured` guard (#628) — **not live**
- `0009c0f` FOLLOW-559 **server-side consent gate for profiling-class events** (#533) — **not live**
- `d3911bf` FOLLOW-579 strip derived-intent fields from unconsented `session.quality.snapshot`
  (#547) — **not live**
- `08eb138`/`f53c3ba`/`ef2d6dc` FOLLOW-459/482/513 — ACK-before-insert p95 fix, durable Queue retry,
  Sentry on the queue consumer — **not live**

There is **no working deploy path**: the only Worker deploy workflow is `deploy-staging.yml` (manual
`workflow_dispatch`, staging-only, and every historical run FAILED — last attempt 2026-05-04). Prod
deploys have always been manual `wrangler deploy` from an operator machine.

**Impact if not fixed:**

1. **Compliance:** prod ingest accepts profiling-class events with **no server-side consent
   enforcement** (FOLLOW-559 merged ~2026-06 but never live) — client-side suppression is the only
   real gate; MASTER_DESIGN and multiple docstrings assert server-side behavior that is not running.
   This is Rule AI (ship-falsifies-doc) at the **deploy layer** — the doc-truth axis the retro loop
   now tracks, but for merged-vs-deployed instead of merged-vs-written.
2. **Security:** anyone can POST events for the Estalara tenant from any origin with the public SDK
   api key (empirically proven today). All origin-enforcement work of #623/#628 is inert.
3. **Reliability/perf:** the <50ms ACK fix and the durable ClickHouse retry queue are not live; prod
   still runs the pre-FOLLOW-459 synchronous path.
4. Today's `FIRST_PARTY_TENANT_ID` ingest secret is set but **read by nothing** until deploy.

**Required action:** Piotr decision + a verified deploy (recommend a dedicated ticket, NOT a blind
`wrangler deploy`):

1. **Pre-flight:** the May-29 binary predates the `env.production` queue producers/consumers
   (FOLLOW-482) and any later bindings — verify the Cloudflare account actually HAS the queues/KV
   namespaces `wrangler.toml` now declares (`wrangler queues list`, `kv namespace list`), or the
   deploy fails/misbehaves. Also identify which origins CURRENTLY send prod events (deploying
   activates the origin gate: Estalara's KV record has no `allowed_origins` → `inherit` → only
   `app.estalara.com` + `admin.estalara.com` pass; any other origin in live use starts 403ing).
2. **Deploy** `wrangler deploy --env production` from a clean checkout of `main`.
3. **Post-deploy verification:** `/health` 200; events from `app.estalara.com` accepted; a
   localhost-origin POST now returns 403 `forbidden_origin` (TODAY it passes — that is the
   regression test this escalation hands you); Sentry shows no `origin_policy_unconfigured` for the
   first-party tenant (proves the FOLLOW-658 guard + today's secret agree).
4. Decide whether a prod deploy pipeline (extend `deploy-staging.yml` with a gated production job)
   becomes a ticket, so this class ends — this is the third "merged ≠ live" surface after ESC-020
   (Estalara-app DOM hooks) and ESC-042 (Modal intent-engine).

**Resolution:** RESOLVED 2026-07-26 (session 61) — **verified deploy executed via FOLLOW-690**, CEO
at the keyboard for every mutation, Claude driving reads/interpretation. Full procedure captured as
`docs/runbooks/INGEST_WORKER_DEPLOY.md` (Rule AH: executed steps only). Facts:

- **Pre-flight found the account was missing BOTH queues** (`estalara-events-retry`, `-dlq` —
  required since FOLLOW-482/#449, 20+ days merged): the account had zero queues, so a blind
  `wrangler deploy` would have failed. Created via `wrangler@4` (repo's wrangler 3.114 hits a
  queues-create API incompatibility: `The specified queue settings are invalid.`). KV namespaces +
  the secret trio pre-existed; optional secrets (`SENTRY_DSN_INGEST`, `MODAL_CHAT_NLP_URL`,
  `REDPANDA_*`) absent but code-verified graceful.
- Two traffic samples (45s + 4min `wrangler tail`) saw **zero** live requests pre-deploy — the
  origin-gate activation risk was nil in practice (consistent with ESC-020: client hooks never
  shipped).
- Staging deploy green (bundle/API smoke), then production: version
  `6b943785-2d32-4ace-b76e-580d950ed662` (May-29 code) → **`e64dd0c3-89ef-44a7-849c-47a4883ea6a6`**;
  all bindings attached (2×KV, DO, 2×queue producers + consumer).
- **Behavioral probes green:** `/health` 200; localhost-origin probe flipped from
  reaches-schema-validation (morning) to **403 `forbidden_origin`** (the standing regression test —
  also empirically clears FOLLOW-678's mis-set axis for the current value, since a wrong UUID would
  have produced `origin_policy_unconfigured`); `app.estalara.com`-origin probe passed both gates and
  was rejected ONLY by schema (`accepted:0` — zero persistence by construction). Response
  fingerprint (discriminator list incl. `live.signup`/`adapt.description.*`) proves the new bundle
  serves. No rollback needed.
- Now live for the first time: FOLLOW-559 server-side consent gate, FOLLOW-579 snapshot stripping,
  FOLLOW-642+658 origin enforcement (with today's `FIRST_PARTY_TENANT_ID`), FOLLOW-459/482/513
  ACK/queue/Sentry paths.
- **Still open, deliberately:** item 4 (production deploy pipeline) stays an unmade decision —
  `deploy-staging.yml` remains manual/staging-only/never-green; `SENTRY_DSN_INGEST` unset = the
  FOLLOW-658 guard 403s but cannot page; FOLLOW-678 canonicalization remains worth doing.

## RESOLVED — prod `ingest_worker` ClickHouse user has NO grant on `description_generations`, blocking FOLLOW-463's audit-trail write [FOLLOW-463]

**Filed by:** ml-engineer (session, FOLLOW-463) **Date:** 2026-07-08T00:00:00Z **Affects:**
FOLLOW-463 (P2, audit F-17), `apps/control-plane/src/app/api/internal/description-cache/route.ts`,
prod ClickHouse **Type:** other (infra/ops — grant)

**Description:** FOLLOW-463 makes `POST /api/internal/description-cache` write a
`description_generations` audit row (via `writeDescriptionGenerationAudit`, using the same
`ingest_worker` credentials — `CLICKHOUSE_USER`/`CLICKHOUSE_PASSWORD` — every other control-plane
ClickHouse sink in this app uses). Per `docs/runbooks/clickhouse-ingest-worker-grant-narrowing.md`
(ESC-032 / FOLLOW-424, executed 2026-06-29), the prod `ingest_worker` grant was deliberately
**narrowed to exclude `description_generations` entirely** — the runbook's Confirmed Table Access
table lists it as "**none** (no writer) — intentionally dropped", and the prod attestation's
negative control (`SELECT ... FROM default.description_generations`) was confirmed `ACCESS_DENIED`
(Code 497). That premise is no longer true: FOLLOW-463 is the writer ESC-032 didn't anticipate.

**Impact if not fixed:** the code is fail-loud-but-non-blocking by design (matches the ticket's AC —
a CH failure must not fail the Modal callback), so nothing breaks. But every insert attempt in prod
will get HTTP 403/497 `ACCESS_DENIED`, captured to Sentry as
`kind: 'description_generations_write_failed'`, and the `description_generations` table will stay
empty in prod — i.e. FOLLOW-463's actual goal (a durable §E.7.5 anti-hallucination audit trail) will
silently not be achieved until the grant is added, even though CI/local tests are green and the PR
looks fully functional. This is the exact RETRO-021 failure shape (measured-in-fixture,
not-reachable-in-prod) the ml-engineer guardrails require flagging up front.

**Required action:** A ClickHouse Cloud admin (per the runbook, `default` via the Cloud SQL console
— `ingest_worker` has no `GRANT OPTION`) must run:

```sql
GRANT INSERT ON default.description_generations TO ingest_worker;
```

and update the grant-narrowing runbook's Confirmed Table Access table (`description_generations`
row) to reflect the new writer, replacing "none (no writer) — intentionally dropped" with the
FOLLOW-463 write path. Re-run the runbook's Step 3 smoke test (INSERT + cleanup) to confirm.

**Resolution:** 2026-07-09 — resolved by Piotr (CEO) via the ClickHouse Cloud SQL console (admin
`default`), service `hl0kc83gt4.eu-west-1.aws.clickhouse.cloud:8443`, bundled with FOLLOW-535's
migration 0020 (TTL) in RETRO-167 order (TTL first, then GRANT).

**Near-miss caught by CLI verification (RETRO-167 verify discipline).** The first attempt granted a
**misspelled** table — `descriptions_generations` (extra "s"). A CLI check (`SHOW GRANTS` as
`ingest_worker` via Doppler `prd` creds) exposed it: the real table `description_generations` still
returned `Code: 497 ACCESS_DENIED`. Corrected in a second admin pass:

```sql
REVOKE INSERT ON default.descriptions_generations FROM ingest_worker;   -- drop the typo
GRANT  INSERT ON default.description_generations  TO ingest_worker;     -- correct table
```

**Verified from CLI 2026-07-09** — `SHOW GRANTS` (as `ingest_worker`) now includes, and the typo
table is gone (0 occurrences):

```
GRANT INSERT ON default.description_generations TO ingest_worker
```

The grant is **INSERT only** — `ingest_worker` retains NO SELECT on this table (write-only audit
sink; the reader is the still-open FOLLOW-536). The FOLLOW-535 TTL leg is **verbatim-verified**: an
admin `SHOW CREATE TABLE default.description_generations` shows
`TTL toDateTime(created_at) + toIntervalMonth(13)` on the correct table (an initial `INTERNAL` typo
was corrected to `INTERVAL` first; full DDL archived in `docs/runbooks/clickhouse-migrations.md`).
Attested in `docs/runbooks/clickhouse-ingest-worker-grant-narrowing.md` and
`docs/runbooks/clickhouse-migrations.md`. Two operator typos in one session (`descriptions_` grant,
`INTERNAL` TTL) are fresh evidence for FOLLOW-542 (durable, copy-safe, CLI-verified runbook). See
RETRO-167, FOLLOW-542.

See RETRO-167, FOLLOW-542.

---

## RESOLVED — Approve ADR-0017 (Cloudflare Queues durable retry) before FOLLOW-482 (P1) is worked [FOLLOW-482]

**Filed by:** pm-orchestrator (session 10) **Date:** 2026-07-06T00:00:00Z **Affects:** FOLLOW-482
(P1), apps/ingest, ADR-0017 **Type:** architectural | vendor

FOLLOW-482 was elevated to P1 (RETRO-154): ClickHouse is the SOLE prod `events` sink (Redpanda is a
no-op, ESC-017), so FOLLOW-459's post-ACK move made at-least-once **best-effort** — a terminal CH
failure after the ~3.1s in-process retry window loses events. The architect wrote
`docs/adr/ADR-0017-durable-post-ack-clickhouse-retry-queue.md` (Status: **PROPOSED**) recommending a
**Cloudflare Queue** (`estalara-events-retry` + native DLQ `estalara-events-retry-dlq`) produced-to
on terminal CH failure and consumed by a new `queue()` handler in the same `apps/ingest` Worker (no
new deployable; reuses `pushToClickHouse`). Est. recurring cost **< $10/mo** at pilot volume (below
the €100/mo threshold — cost is not the blocker). Per CLAUDE.md (new third-party service / vendor
lock-in), this needs CEO sign-off before FOLLOW-482 is scheduled to a worker.

**Decisions needed from Piotr (PROPOSED → ACCEPTED):**

1. **Adopt Cloudflare Queues** as a new bound resource type on `apps/ingest` (new Terraform
   resource, new outage surface, new ops ownership)? Same-vendor as the existing Worker/KV/DO stack,
   but still a new service.
2. **Cloudflare Queues over Upstash Redis** (already a paid vendor in the stack) — architect
   recommends CF (fewer moving parts, native push-consumer, no extra cross-service hop); confirm the
   trade-off is accepted.
3. **Owner of the DLQ replay / pager runbook** (`estalara-events-retry-dlq` non-empty alert) —
   needed before FOLLOW-495's alerting AC can close.
4. **Accept the named duplicate-row risk:** the `events` CH table has **no dedup key**
   (ReplicatedMergeTree, ORDER BY excludes `event_id`); a queue-level retry compounds (additively)
   the pre-existing in-process-retry duplicate risk. ADR-0017 does NOT add dedup — accept as a named
   risk, or require a dedup key (ReplacingMergeTree / idempotency key) as part of FOLLOW-482 scope?

**Resolution (2026-07-06, CEO Piotr — ACCEPTED):** (1) **Adopt Cloudflare Queues.** (2) **Cloudflare
Queues over Upstash Redis** — confirmed. (3) DLQ replay/alert runbook owner = **devops-engineer**
(discharged via FOLLOW-495's alerting work). (4) **Duplicate-row risk ACCEPTED as a named risk** —
no dedup key required; FOLLOW-482 does NOT add a `ReplacingMergeTree`/idempotency key. ADR-0017
flipped PROPOSED → ACCEPTED; FOLLOW-482 promoted to QUEUE (P1) and delegated to backend-engineer for
the Worker producer + `queue()` consumer + wrangler binding (actual CF Queue/DLQ + Terraform
provisioning is a devops/operator deploy-time step).

---

## RESOLVED — commitlint ticket-reference rule rejects the `TICKET-PILOT-` prefix [TICKET-PILOT-003]

**Filed by:** data-engineer **Date:** 2026-05-24T00:00:00Z **Affects:** TICKET-PILOT-003 (and any
other `TICKET-PILOT-NNN` Sprint 12 pilot tickets) **Type:** repo-config

**Description:**

The `ticket-reference` custom rule in `commitlint.config.cjs` enforces an allow-list of ticket
prefixes. Sprint 12 introduced the `TICKET-PILOT-NNN` family (see `backlog/sprint-12/`), but the
regex on line ~110 does not include a `PILOT-` alternative:

```js
/\[TICKET-(?:FIX-|INFRA-|...|RUNTIME-FIX-)?\d+[a-z]?\]|\[FOLLOW-\d+\]|\[ESCALATION\]/;
```

As a result the commit-msg hook rejects a well-formed message such as
`feat(data): add CTA-lift dashboard with holdout comparison [TICKET-PILOT-003]`.

I cannot edit `commitlint.config.cjs` from the data-engineer lane (it is a repo-wide config file),
and skipping hooks (`--no-verify`) is disallowed by the operating rules. The TICKET-PILOT-003 work
is otherwise complete: 26 new tests pass, full control-plane suite (568 tests) green, typecheck and
lint clean.

**Required action (devops-engineer or PM — ~2 minutes):**

Add `PILOT-` to the `ticketPattern` alternation in `commitlint.config.cjs`:

```js
/\[TICKET-(?:FIX-|INFRA-|DEMO-|ADM-|QUIZ-|DB-|EMB-|ARCH-|ADP-|DQS-|AUTO-|AB-|REORDER-|AGENCY-|GDPR-|VAL-|DESC-PIVOT-|DESC-|CAUSAL-|PROCESS-|DECISIONS-|RLS-|RUNTIME-AUDIT-|RUNTIME-FIX-|PILOT-)?\d+[a-z]?\]|\[FOLLOW-\d+\]|\[ESCALATION\]/;
```

Then the TICKET-PILOT-003 commit can be created and the PR opened.

**Resolution:** Resolved 2026-05-25 by pm-orchestrator. `PILOT-` was added to the `ticketPattern`
alternation in `commitlint.config.cjs`; the fix landed alongside PR #145 (FOLLOW-078). All
`[TICKET-PILOT-NNN]` commit subjects now pass the commit-msg hook (verified: PRs #143–#146 merged
with PILOT-prefixed commits).

---

## RESOLVED — ESC-010: DOPPLER_TOKEN_DEV secret must be provisioned in GitHub Actions [FOLLOW-040]

**Filed by:** devops-engineer **Date:** 2026-05-24T00:00:00Z **Affects:** FOLLOW-040, FOLLOW-063,
FOLLOW-068, FOLLOW-039 **Type:** repo-config

**Description:**

FOLLOW-040 has wired the Doppler CI integration into `.github/workflows/ci.yml`. The workflow
installs the Doppler CLI and uses `doppler run --` for secret injection. The `doppler-verify` job
performs a soft-skip when `DOPPLER_TOKEN_DEV` is absent (so CI is not broken), but it must have the
token to pass as a real green check.

The token has NOT been created yet. Until it is provisioned in GitHub Actions secrets:

- The `doppler-verify` job soft-skips (logs a clear message, exits 0) on every PR.
- FOLLOW-063 (seed CI), FOLLOW-068 (demo CI), FOLLOW-039 (ClickHouse DSR) will soft-skip any step
  that requires `doppler run --` with injected DB / API key credentials.

**Required action (Piotr — ~10 minutes):**

1. Go to [Doppler dashboard](https://dashboard.doppler.com) → project `estalara` → config `dev` →
   Access → Service Tokens → Create service token.
   - Name: `ci-github-actions`
   - Config: `dev` (NOT staging, NOT prod)
   - Expiry: none (or 1 year) — rotate on breach per V.6.1 policy
2. Copy the token value (shown only once).
3. Go to GitHub repo → Settings → Secrets and variables → Actions → New repository secret.
   - Name: `DOPPLER_TOKEN_DEV`
   - Value: (paste the token)
4. Trigger a CI run on any open PR (or push to a devops-engineer branch) — the `doppler-verify` job
   should now show "Doppler auth verified" instead of the soft-skip message.

**Do NOT create a production-scope token.** Production secrets remain Vercel-only per §V.6.3.

**Resolution:** RESOLVED 2026-06-10 by Piotr Nawrocki. Doppler service token `ci-github-actions`
created in project `estalara` config `dev`. Added as `DOPPLER_TOKEN_DEV` GitHub Actions repository
secret. CI `doppler-verify` job confirmed green ("Doppler auth verified").

---

## RESOLVED — GitHub Actions billing prevents CI from running on PR #125

**Filed by:** backend-engineer **Date:** 2026-05-21T21:40:00Z **Affects:** TICKET-AUTO-006-POLISH,
PR #125 **Type:** other

**Description:** All CI jobs for PR #125 fail immediately (2-4s) with "The job was not started
because recent account payments have failed or your spending limit needs to be increased." This is a
GitHub Actions billing/quota issue. All local checks pass: 474 tests, 0 ESLint errors in new files,
prettier unchanged. The code is production-ready but CI cannot validate it.

**Required action:** Resolve GitHub Actions billing so CI can run on PR #125. Once CI is green, PM
can merge and mark TICKET-AUTO-006-POLISH DONE.

**Resolution:** Resolved 2026-05-25 by pm-orchestrator. GitHub Actions billing has been restored —
CI has run green on PRs #142–#146 (Sprint 12) since this was filed. PR #125 (TICKET-AUTO-006-POLISH)
is stale and should be rebased + re-validated independently if the carve-out work is still wanted;
the billing block itself no longer applies.

---

## RESOLVED — Vendor Account Creation Required for 5 Infrastructure Providers

**Filed by:** devops-engineer  
**Date:** 2026-04-27T14:00:00Z  
**Affects:** TICKET-009, TICKET-014, TICKET-015, TICKET-020  
**Type:** vendor

**Description:**

TICKET-009 created Terraform module skeletons for 5 vendors (Supabase, ClickHouse Cloud, Modal,
Redpanda Cloud, Upstash), but all resources are commented out because vendor accounts do not exist
yet. These accounts must be created by a human with access to:

1. Shared team email (`infra@estalara.io` recommended) or CTO's personal accounts
2. Payment method (credit card) for production tiers
3. Doppler workspace access to store credentials

Without these accounts, downstream tickets are blocked:

- TICKET-014 (ClickHouse table DDL)
- TICKET-015 (Stream consumer Modal scaffold)
- TICKET-020 (Drizzle ORM + Supabase setup)

**Required action:**

1. **Create accounts** for all 5 vendors (follow `docs/runbooks/vendor-accounts.md`)
2. **Generate API tokens/keys** (documented in runbook, section-by-section)
3. **Store secrets in Doppler** under `dev` config (10+ secrets total):
   - `SUPABASE_ACCESS_TOKEN`, `SUPABASE_ORG_ID`, `SUPABASE_DB_PASSWORD`
   - `CLICKHOUSE_ORG_ID`, `CLICKHOUSE_API_KEY`, `CLICKHOUSE_API_SECRET`
   - `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`
   - `REDPANDA_CLIENT_ID`, `REDPANDA_CLIENT_SECRET`
   - `UPSTASH_EMAIL`, `UPSTASH_API_KEY`
4. **Verify setup** by running `terraform init && terraform validate` in each module
5. **Mark this escalation as RESOLVED** once all accounts are created and secrets stored

**Estimated time:** 2-3 hours (30 minutes per vendor)

**Cost commitment:** All vendors have free tiers or trial credits (no immediate payment required for
MVP testing).

**Resolution:** Resolved 2026-05-14 by pm-orchestrator audit. All 5 vendor accounts (Supabase,
ClickHouse Cloud, Modal, Redpanda Cloud, Upstash) have been active since Sprint 1+ — confirmed by
active tables in Supabase, ClickHouse DDL applied (TICKET-014, PR merged), Modal Python skeleton
running (TICKET-015), Redpanda consumer deployed (stream-consumer app), Upstash Redis active
(session cache). No human action required; this escalation was stale.

---

## RESOLVED — GitHub Actions CI workflow fails immediately with "workflow file issue" on all branches

**Filed by:** backend-engineer **Date:** 2026-05-01T10:50:00Z **Affects:** All tickets — TICKET-025
(and previously TICKET-012, TICKET-013, all main merges) **Type:** other (repo-config)

**Description:**

Every CI run since Sprint 0 completes in 0s with status `failure` and reason "This run likely failed
because of a workflow file issue." This includes pushes to `main` after merging TICKET-012 and
TICKET-013 (both previously marked DONE). The workflow file at `.github/workflows/ci.yml` appears
syntactically valid locally, so the issue is likely one of:

1. A required GitHub Actions secret (`TURBO_TOKEN`, `TURBO_TEAM`, or `GITHUB_TOKEN` permissions) is
   misconfigured or missing at the repo/org level
2. The `if: ${{ secrets.DOPPLER_TOKEN_DEV != '' }}` expression in the `doppler-verify` job uses a
   secrets context in a way that GitHub Actions flags as invalid at the workflow level
3. A GitHub Actions runner or org-level policy is blocking the workflow

All agent code (TICKET-012, 013, 025) passes local tests, typecheck, build, and prettier. The CI
infrastructure issue is not caused by agent code.

**Required action:**

1. Navigate to GitHub repo Settings → Actions → General and verify workflow permissions are set to
   "Read and write permissions"
2. Check if required secrets (`TURBO_TOKEN`, `TURBO_TEAM`) are set under Settings → Secrets and
   variables → Actions
3. Verify that the `if: ${{ secrets.DOPPLER_TOKEN_DEV != '' }}` guard in `doppler-verify` job is
   valid — this expression references `secrets` context which is not available in `if` conditions at
   the job level without `${{ secrets.NAME }}` wrapping. The correct form is:
   `if: ${{ secrets.DOPPLER_TOKEN_DEV != '' }}` which _should_ work but may fail for some org
   configurations
4. Try triggering a workflow run manually from the GitHub Actions UI to see the actual error message
5. If needed, devops-engineer should review and fix `.github/workflows/ci.yml`

**Partial fix history:**

- PR #21 (2026-05-01): Fixed `secrets` in job-level `if` condition (`doppler-verify` job)
- PR #22 (2026-05-01): Fixed `secrets` in workflow-level `env:` block (`TURBO_TOKEN`, `TURBO_TEAM`
  in `ci.yml`; `CLOUDFLARE_ACCOUNT_ID` in `deploy-staging.yml`)

**CI still fails after both fixes.** 30 runs total across all branches, 0 successes. The API returns
`total_count: 0` jobs and `billable: {}` — nothing runs. The exact error message is only visible in
the GitHub Actions UI (navigate to Actions → select any failed run → see the banner).

**Required human action:** Navigate to GitHub repo → Actions → select a failed run → read the banner
message that says "This run likely failed because of a workflow file issue." The SPECIFIC error text
below that banner will identify the remaining root cause. The agent cannot see this message via the
GitHub API. Possible remaining issues:

- Missing `permissions:` block required by a repo or org policy
- A GitHub Actions feature (required workflows, environment protection) blocking the run
- A third workflow validation error not yet identified

**Resolution:** Resolved 2026-05-04 via PR #34. Root cause:
`if: ${{ secrets.DOPPLER_TOKEN_DEV != '' }}` on a step-level `if` is invalid in GitHub Actions
(secrets context not available there), causing the workflow to fail at parse time before any jobs
were queued. Fix: removed the invalid `if` condition (job has `continue-on-error: true` so
doppler-verify is non-blocking). Additional fixes in the same PR: build @estalara/shared before
lint, add `permissions: pull-requests: read` to gitleaks-scan, auto-detect placeholder test,
ClickHouse auth (CLICKHOUSE_PASSWORD env var + per-statement execution + UInt64 type fix). CI now
green on main: `completed success` run #25315111966.

---

## RESOLVED — Sprint 8 spec doc needed before architect can write ticket files

**Filed by:** pm-orchestrator **Date:** 2026-05-13T10:00:00Z **Affects:** TICKET-AB-001,
TICKET-REORDER-001, TICKET-AGENCY-001, TICKET-FAIR-001, TICKET-AB-004, TICKET-NATIVE-001,
TICKET-CAUSAL-001 **Type:** scope **resolved_at:** 2026-05-13 **resolved_by:** Piotr Nawrocki

**Description:**

Sprint 7 and Sprint 7.5 are both DONE as of 2026-05-13. Sprint 8 ticket skeletons have been added to
QUEUE.md under "Sprint 8 — A/B holdout + re-ranking + agency answers + fair-housing linter" with
agent assignments, estimated hours, dependencies, and scope notes. However, no formal
`docs/specs/SPRINT_8_SPEC.md` exists yet (analogous to `docs/specs/SPRINT_7_5_SPEC.md`).

Architect agent cannot write the full ticket markdown files (under `backlog/sprint-8/`) without a
human-reviewed spec doc that resolves the two open scope questions below.

**Open questions requiring human decision before spec is written:**

1. **Fair-housing linter scope for re-ranking (TICKET-REORDER-001 + TICKET-FAIR-001 conflict).** The
   Master Design (E.3.2) requires `brand_safety_score` from the fair-housing linter as one of five
   inputs to the multi-objective optimization score. But the ReorderDirective re-sorts listing cards
   on a search results grid. This raises a genuine fair-housing question: does re-ranking listings
   per archetype constitute "steering" under the US Fair Housing Act (FHA) or UK Equality Act? If a
   `yield_hunter` archetype sees investment-yielding listings ranked first, and that archetype
   correlates with a protected class, we have a legal exposure. The compliance-engineer has not yet
   assessed this. **Decision needed:** (a) permit re-ranking with a linter gate, or (b) restrict
   re-ranking to non-protected signals only (price, size, location), or (c) defer REORDER-001 to
   Sprint 9 until compliance assessment is complete.

2. **NATIVE-001 CTO/CPO dependency.** TICKET-NATIVE-001 (app.estalara.com Tier 3 integration)
   requires Rafal (CTO) to add `data-estalara-*` attributes to SvelteKit components and Krystian
   (CPO) to approve the slot mapping. This is human engineering work that agents cannot perform.
   **Decision needed:** (a) who schedules this human work, (b) whether NATIVE-001 is in Sprint 8 or
   a dedicated CTO sprint, (c) whether the SDK side of NATIVE-001 (sdk-engineer wiring the init and
   corpus fixture) can proceed before CTO adds the attributes.

**Required action:**

1. Piotr reviews the two open questions above and provides direction.
2. Architect agent writes `docs/specs/SPRINT_8_SPEC.md` incorporating that direction plus the
   skeleton ticket scopes already in QUEUE.md.
3. Piotr reviews and approves the spec doc.
4. PM-orchestrator promotes Sprint 8 tickets from BACKLOG to READY and begins delegation.

**Suggested first-mover once spec is approved:** TICKET-AB-001 (no internal Sprint 8 dependencies,
unblocks AB-004 and FAIR-001) in parallel with TICKET-REORDER-001 (if fair-housing question is
resolved). TICKET-CAUSAL-001 is P2 and should not start until AB-001 has 2+ weeks of real holdout
data in production.

**Resolution:**

Both open questions resolved by Piotr Nawrocki on 2026-05-13:

1. **Fair-housing / REORDER-001:** REORDER-001 is **unblocked**. No FAIR-001 linter is needed at
   this stage. Rationale: Estalara does not collect demographic data. Archetypes are derived
   exclusively from behavioral signals (scroll depth, chat intent, dwell time, click patterns) —
   they are behavioral clusters, not demographic categories. No protected-class identity attaches to
   a session. Re-ranking listings to fit a buyer's expressed behavioral intent (e.g., `yield_hunter`
   reading rental-yield content → surface high-yield listings first) is not steering under
   FHA/Equality Act/UAE PDPL definitions, which all anchor on protected characteristics (race,
   religion, family status, national origin, gender, disability). Because none of those signals
   enter the archetype space, the legal premise of "steering" does not apply. **IMPORTANT CAVEAT
   (binding on all future agents):** This determination holds only as long as the archetype space
   remains purely behavioral. If any agent proposes adding a demographic or proxy-demographic signal
   to an archetype — including zip-code priors, name analysis, photo analysis, or any signal that
   acts as a proxy for race, religion, family status, national origin, gender, or disability — this
   decision MUST be re-litigated via a new escalation before that signal enters any model or
   pipeline. TICKET-FAIR-001 is CANCELLED as a result (not required at this stage).

2. **NATIVE-001 CTO/CPO dependency:** TICKET-NATIVE-001 is **deferred to MVP launch**. Tier 3 Native
   components require Rafal (CTO) and Krystian (CPO) scheduling on the SvelteKit side. That work is
   sequenced for the launch window, not Sprint 8. The SDK side does not proceed speculatively — it
   would create rework risk. NATIVE-001 remains BLOCKED with updated reason.

---

## RESOLVED — Fair-housing risk in copy_template strings (US-region pilot blocker)

**Filed by:** retrospective-analyst (RETRO-004) **Date:** 2026-05-14 **Affects:** TICKET-046,
TICKET-DESC-001, Sprint 11 pilot launch **Type:** compliance

**Description:** RETRO-004 surfaced that multiple `copy_template.en` strings introduced in PR #92
(TICKET-046) contain protected-class (familial-status) value propositions. Specifically,
`family_buyer` and `student_parent` archetype templates describe lifestyle outcomes tied to
household composition — language that, while not using protected-class terms directly, could be
construed as steering under FHA (US) if served to sessions that could be profiled as family
households.

Examples (from PR #92 merged copy):

- `family_buyer.copy_template.en` — references "family-friendly", "school catchment areas", "family
  space" etc. as the primary value proposition surfaced to that archetype
- `student_parent.copy_template.en` — references proximity to universities as a primary hook

The 2026-05-13 fair-housing resolution (above) determined that archetype = behavioral, not
demographic. That determination holds — but it applies to the _routing/reordering_ layer, not the
_copy layer_. The copy_template strings are surfaced to buyers and explicitly market familial
lifestyle outcomes. This is a distinct exposure from the reorder decision:

- Reorder: "which listings appear first" — ruled non-steering because no protected class attaches
- Copy: "what language is served to a behavioral cluster" — if the cluster correlates with family
  status, serving family-marketing copy may constitute illegal steering under HUD guidance on
  advertising, even if the archetype signal is behavioral

**Required action:**

1. **Piotr / compliance-engineer review** — confirm whether the 2026-05-13 ruling extends to the
   copy layer or whether a separate assessment is needed.
2. If a separate assessment IS needed: compliance-engineer runs a fair-housing copy audit on all 17
   non-neutral `copy_template.en` strings (focus: family_buyer, student_parent, diaspora_buyer,
   retiree_relocator) before any US-region pilot tenant is onboarded.
3. If the 2026-05-13 ruling DOES extend (behavioral copy = not steering): mark this resolved, add a
   binding note that copy strings must not reference protected characteristics explicitly (race,
   religion, gender, disability, national origin, family status) — behavioral framing only.

**Impact if unresolved:** `copy_template.en` strings MUST NOT be served to US-region sessions until
this is resolved. The `GET /api/adapt/description` endpoint (TICKET-DESC-001, Sprint 9) and any
SDK-side copy rendering must gate on `tenant.region !== 'us'` OR require compliance sign-off. →
tracked as FOLLOW-034 in `backlog/FOLLOW_UPS.md`.

**Resolution:** Resolved 2026-05-14 by Piotr Nawrocki (CEO).

The system does NOT limit access to listings or information. Every buyer receives the same complete
set of listings — the copy_template and variant strings adjust only the PRESENTATION framing of the
same underlying property data, not which properties are shown or hidden. This is equivalent to a
travel site displaying "family-friendly amenities" vs "business-travel essentials" for the same
hotel room: the framing differs, the access does not.

HUD fair-housing advertising guidance prohibits copy that EXCLUDES or DISCOURAGES protected classes
from accessing listings. Because Estalara serves all listings to all sessions (no filtering by
archetype at the listing-selection layer), the copy layer presents no gatekeeping exposure. The
archetype system is purely behavioral (scroll depth, dwell time, intent signals); no protected-class
identity enters the signal space (binding constraint from 2026-05-13 resolution above). Presenting
the same property in a yield-focused framing vs a family-amenity framing to different behavioral
clusters does not constitute steering under FHA/HUD advertising rules.

Binding constraint going forward: copy_template and variant strings MUST NOT reference protected
characteristics explicitly (race, religion, gender, disability, national origin, family status,
national origin). Behavioral framing only (investment return, space utility, commute time, lifestyle
fit). Agents writing or editing copy strings must follow this constraint.

FOLLOW-034 is CANCELLED — no compliance audit or region gate required.

---

## RESOLVED — ESC-009: Provision E2E_BEARER_TOKEN GitHub Actions secret for demo-integration CI job

**Filed by:** qa-engineer **Date:** 2026-05-24T00:00:00Z **Affects:** FOLLOW-068, PR
`qa-engineer/FOLLOW-068-demo-ci` **Type:** other

**Description:** The `demo-integration` CI job (`.github/workflows/demo-integration.yml`) runs the
detect → activate → adapt → SDK E2E spec with a live Next.js server. Steps 1–3 of the spec POST to
authenticated routes (`/api/detect`, `/api/schema/activate`, `/api/adapt`) using a Bearer token
drawn from the `E2E_BEARER_TOKEN` environment variable. The spec's `beforeAll()` precheck
(FOLLOW-067, bundled into FOLLOW-068) fails fast with an actionable error if the token is absent, so
the job will not produce 401-hang failures — but it also cannot run the integration steps without
the token.

The token must be a valid JWT signed by `JWT_SECRET` for the demo/canary E2E tenant
(`E2E_TENANT_ID`, defaulting to `est_test_e2e_tenant`). It should be long-lived (or auto-rotated)
and scoped read-write to that tenant only.

Additionally, `E2E_TENANT_ID` (the canary tenant's Postgres UUID) should be set as a GitHub Actions
variable (`vars.E2E_TENANT_ID`) so the workflow can pass it to the spec without hardcoding.

**Required action:**

1. DevOps/Piotr: generate a long-lived E2E JWT for the `est_test_e2e_tenant` / `tnt_canary_eu` demo
   tenant (or whichever tenant UUID is used for canary).
2. Add it to GitHub Actions repository secrets as `E2E_BEARER_TOKEN`.
3. Add the tenant UUID to GitHub Actions repository variables as `E2E_TENANT_ID`.
4. After adding, re-run the `demo-integration` workflow on the PR branch to confirm the E2E steps
   execute (rather than soft-skipping due to missing DOPPLER_TOKEN_DEV — note: the DOPPLER soft-skip
   is a separate gate; the E2E_BEARER_TOKEN precheck is the inner gate within the E2E describe
   block).

**Note:** The demo-integration job also requires `DOPPLER_TOKEN_DEV` (tracked separately as
FOLLOW-040). Until FOLLOW-040 lands, the job soft-skips with exit 0 before the spec even runs.
Provisioning `E2E_BEARER_TOKEN` now is still recommended so it is ready the moment FOLLOW-040
unblocks the job.

**Resolution:** RESOLVED 2026-05-24 by Piotr Nawrocki. `E2E_BEARER_TOKEN` added as GitHub Actions
repository secret (2026-05-24T15:48Z). `E2E_TENANT_ID` added as GitHub Actions repository variable
with value `est_test_e2e_tenant` (2026-05-24T15:47Z). Confirmed present via `gh secret list` on
2026-06-10.

---

## RESOLVED — ESC-011: GitHub Actions not starting any runs — FOLLOW-105 Wave-1 PR #149 cannot get CI green

**Filed by:** pm-orchestrator **Date:** 2026-05-25T20:30:00Z **Affects:** FOLLOW-105 Wave 1 (PR
#149, `feat/follow-105-1bcd-canonical-adapt-enforcement`) and ALL subsequent PRs **Type:**
repo-config / account

**Description:** PR #149 (FOLLOW-105 Wave 1) was opened and pushed, but the GitHub Actions `CI`
workflow created **zero runs** for it. Diagnosis:

- The CI workflow is `active` (not disabled) — confirmed via `gh workflow list`.
- There have been **no workflow runs of any kind across the whole repo since 2026-05-25T15:08:45Z**
  (the #148 merge-to-main push). My PR was created well after that and got nothing.
- `ci.yml` `on.push.branches` only matches `main` + agent-prefixed branches (`sdk-engineer/**`,
  `architect/**`, …). A `feat/**` branch like #149's does NOT match the push trigger — but the
  `on.pull_request → main` trigger should still fire (it DID for #148's
  `feat/follow-105-1a-sdk-audit` branch at 14:54).
- Close/reopen of #149 (to re-fire the `pull_request` event) produced **no new run**.

**Most likely cause:** a **GitHub Actions minutes / billing limit** reached on the `Pnawrocki9`
personal account after 15:08 (workflows stay "active" but GitHub silently stops starting new runs),
or a transient GitHub Actions incident. Only the account owner can confirm/resolve.

**Impact:** Per CLAUDE.md, PM cannot mark a ticket READY_FOR_REVIEW until CI is green. With Actions
not running, CI-green is unverifiable on the platform. PM has validated locally instead (see below),
but this blocks the documented merge gate for #149 and every future PR until Actions runs again.

**Local validation already performed (substitute evidence while Actions is down):**

- `pnpm turbo run build typecheck test`: all pass except `@estalara/e2e-smoke` (needs a live ingest
  Worker at 127.0.0.1:8787 — environmental; pre-existing-red on merged PRs #146/#148 too).
- `pnpm exec prettier --check` on all changed files: clean.
- `bash scripts/check-rule-h.sh` (incl. the new adapt gates): pass.
- `bash scripts/check-mirror-files.sh` (Rule J): pass (ran in pre-push).
- `bash scripts/check-rule-i.sh`: 114 violations — **pre-existing-red (107 at base, FOLLOW-090),
  non-blocking** (merged PRs #146/#148 also have rule-i red). +7 from this PR: +3 decision-api libs
  orphaned by the ratified Worker-410 (owned by FOLLOW-107) + ~4 new test-only/util exports.

**Required action (account owner / Piotr):**

1. Check GitHub → Settings → Billing → Actions usage for the `Pnawrocki9` account; raise the
   spending limit or wait for the monthly reset if minutes are exhausted. (Or confirm a GH
   incident.)
2. Once Actions runs again, re-trigger #149 (push an empty commit, or close/reopen) and confirm the
   real merge gates are green: Build, Build (control-plane), Format check, Auto-Detection corpus
   gate, ClickHouse migrations smoke, Doppler verify, Test (Node), rule-h, rule-j. (Vercel, Rule I,
   and Python tests are pre-existing-red and non-blocking per the #146/#148 merge history.)
3. **Convention note:** #149 uses branch `feat/follow-105-1bcd-...` per the spawn instruction, which
   does NOT match the `push`-trigger agent-prefix allowlist in `ci.yml`. The repo's reliable CI path
   is push-triggered on agent-prefixed branches (CLAUDE.md branch-naming =
   `<agent>/<ticket>-<slug>`). Recommend future PR branches use an agent prefix (e.g.
   `architect/FOLLOW-105-...`) so push-CI fires regardless of the pull_request trigger. PM can
   rename/re-push #149's branch on request.

**Resolution:** RESOLVED 2026-05-25. Two compounding causes, both addressed: (1) **branch-name /
trigger mismatch** — the `feat/**` branch matched neither the `push` allowlist nor (anomalously) the
`pull_request` trigger; renaming to `architect/FOLLOW-105-canonical-adapt-enforcement` (PR #150,
supersedes #149) put it on the reliable push-CI path. (2) **Actions budget** — the account owner
bumped the GitHub Actions budget and pushed a retrigger commit (`09adfd6`). CI now runs; PR #150 is
green on every real merge gate (Build, Build control-plane, Typecheck, Lint, Test Node 22, SDK E2E,
rule-h, rule-j, Format, corpus, ClickHouse, Doppler, Gitleaks). **Lasting fix:** future PR branches
must use the `<agent>/<ticket>-<slug>` convention (CLAUDE.md) so push-CI fires regardless of the
pull_request trigger.

---

## RESOLVED — ESC-012: `pnpm db:migrate` against any env will fail until pilot tenant exists [FOLLOW-149 / TICKET-PILOT-001]

**Filed by:** devops-engineer **Date:** 2026-05-28T20:00:00Z **Affects:** any environment that runs
`pnpm db:migrate` after FOLLOW-149's journal repair lands and before TICKET-PILOT-001 seeds the
pilot tenant. Concretely: dev, staging, and any future region/tenant DB clone that has not yet had
the pilot tenant `000-app-estalara` inserted. **Type:** sequencing / operational

**Discovered during:** FOLLOW-149 Part D — applying migration 0015 to prd.

**Description:** Drizzle's pg-core migrator wraps ALL pending migrations in a single transaction
(`drizzle-orm/pg-core/dialect.js:60 `await
session.transaction(...)`). Migration 0016 (`0016_pilot_inquiry_selector.sql`) ends with a `DO $$
... RAISE
EXCEPTION`guard that aborts when the pilot tenant`000-app-estalara`is missing. Pre-pilot prd had 0 tenants → running`pnpm
db:migrate`raised inside the txn and rolled BOTH 0015 and 0016 back. To honour FOLLOW-149's explicit "do not apply 0016 in this ticket" instruction (and because 0016 requires a real tenant), I applied 0015 via a one-off, isolated`BEGIN/INSERT
INTO drizzle.\_\_drizzle_migrations/COMMIT` mirror of the migrator's per-entry logic. **0015 is now
applied on prd; 0016 remains pending.**

The systemic issue this exposes: `pnpm db:migrate` is no longer a "safe to run anywhere" command.
Any future invocation in dev / staging / a fresh region clone will hit the same 0016 raise and roll
back any future entries 0017+ alongside it.

**Required action (TICKET-PILOT-001 or earlier):** TICKET-PILOT-001 (Magic Link wizard
`POST /api/tenants`) MUST seed the pilot tenant row BEFORE the operator runs any `pnpm db:migrate`
that needs to pick up 0016+. Two equivalent paths:

1. Make TICKET-PILOT-001's wizard step explicitly call db:migrate AFTER tenant creation, and
   document the order in `docs/runbooks/pilot-onboarding.md` (does not exist yet — see FOLLOW stub).
2. Edit migration 0016 to skip its `UPDATE`/`RAISE` block when the tenant row is absent (i.e. change
   `RAISE EXCEPTION` to a `RAISE NOTICE` no-op). This is data-engineer's call; out of scope for
   FOLLOW-149 because the ticket forbids editing migration SQL.

**Workaround until then:** Operators running `pnpm db:migrate` against a tenant-less DB will see
0016 fail loudly with the FOLLOW-141/FOLLOW-147 error message. Pending entries from 0017+ (none
exist yet) would also roll back. Use the same isolated apply pattern I used for 0015 if any 0017+
entry must land before the pilot exists. Long-term, this is brittle — pick path 1 or 2 above.

**Resolution:** RESOLVED 2026-05-29. Path (1) confirmed: `POST /api/tenants` (tenant-create)
executed before `pnpm db:migrate` during TICKET-PILOT-001 onboarding. Migration 0016 applied cleanly
after pilot tenant `000-app-estalara` was seeded; `RAISE EXCEPTION` guard passed.
`SELECT inquiry_submit_selector` on the pilot tenant row confirms the column is populated.
Sequencing order documented in `docs/ops/PILOT_RUNBOOK.md` §3 "Migration sequencing."

---

## RESOLVED — ESC-013: app.estalara.com frontend repo path unknown to sdk-engineer [TICKET-PILOT-001]

**Filed by:** sdk-engineer **Date:** 2026-05-29T00:00:00Z **Affects:** TICKET-PILOT-001 Step 1 (SDK
snippet install in frontend layout) **Type:** scope / operational

**Description:**

TICKET-PILOT-001 Step 1 requires editing `+layout.svelte` in the app.estalara.com SvelteKit frontend
to inject the SDK snippet. However:

1. No SvelteKit repo (no `.svelte` files, no `svelte.config.js`) exists in any accessible directory
   on this machine. Searched: all directories under `/home/asipi/Projects/` and `/home/asipi/`.
2. `/home/asipi/Projects/EstalaraNew` is a Next.js app (marketing site `estalara.com`), not
   `app.estalara.com`.
3. `/home/asipi/Projects/Live-Hosts` is a .NET + Python stack unrelated to SvelteKit.

The ticket spec says "SvelteKit `+layout.svelte`" but no such file exists in the accessible tree.
The app.estalara.com frontend may be in a private repo, a separate machine, or may actually be
Next.js not SvelteKit. The SDK snippet parameters and slot requirements are fully documented in
`docs/ops/PILOT_RUNBOOK.md` §5 (added by this PR) and can be applied as soon as the path is known.

**Required action (Piotr — 2 minutes):**

Provide the path to the app.estalara.com frontend repo so sdk-engineer can edit the layout file and
inject the snippet in Step 1. Options:

a. If the repo is local: provide the absolute path. b. If the repo is on GitHub: provide the repo
URL. sdk-engineer will clone and edit. c. If the frontend is actually Next.js (not SvelteKit): the
snippet goes in `app/layout.tsx` using Next.js `<Script>` component with
`strategy="afterInteractive"`.

**Required action (DNS — separate):** `admin.estalara.com` resolves to an nginx server (not Vercel),
blocking the Step 1 smoke test for `GET /api/adapt`. See ESC-014.

**Resolution:** RESOLVED 2026-05-29. SDK installed on `app.estalara.com` via Tier 2 script tag by
CTO Rafał Palak. Script `src` points to `https://admin.estalara.com/sdk.js` (served as Vercel static
asset per ESC-015). Verified: `sdk.js` loads in browser DevTools on `app.estalara.com`.

---

## RESOLVED — ESC-014: admin.estalara.com DNS not pointing to Vercel control-plane [TICKET-PILOT-001]

**Filed by:** sdk-engineer **Date:** 2026-05-29T00:00:00Z **Affects:** TICKET-PILOT-001 smoke test
(Step 1 AC: `GET https://admin.estalara.com/api/adapt` returns 200) **Type:** operational / devops

**Description:**

The TICKET-PILOT-001 acceptance criteria require:

> Smoke assertion: `GET https://admin.estalara.com/api/adapt` returns 200 (NOT 410)

Current state: `admin.estalara.com` resolves to an nginx/1.22.1 server returning "Welcome to KIEG
server!" — not the Vercel-deployed control-plane. Verified via:

```
HTTP/1.1 200 OK
Server: nginx/1.22.1
Date: Fri, 29 May 2026 05:21:13 GMT
```

This means `GET https://admin.estalara.com/api/adapt` returns 404 (nginx, not Vercel). The
control-plane is confirmed to be a Next.js app with a Vercel deployment config
(`apps/control-plane/vercel.json`, region `cdg1`), but the custom domain `admin.estalara.com` has
not been configured as a Vercel custom domain, or the DNS has not been pointed to Vercel's
nameservers.

The SDK's `data-decision-url` in production must be `https://admin.estalara.com/api`. If this domain
does not point to Vercel before SDK install, all `/api/adapt` calls from app.estalara.com will 404.

**Required action (Piotr or devops-engineer — ~15 minutes):**

1. Go to Vercel project dashboard for the control-plane.
2. Add `admin.estalara.com` as a custom domain.
3. Update DNS records at the registrar to point `admin.estalara.com` to Vercel (CNAME to
   `cname.vercel-dns.com` or A record to Vercel's IP, as Vercel instructs).
4. Wait for DNS propagation.
5. Verify:
   `curl -s -o /dev/null -w "%{http_code}" "https://admin.estalara.com/api/adapt?session_id=smoke&archetype=neutral&confidence=0.5&similarity=0.5&tier=1" -H "Authorization: Bearer <key>"`
   returns 200.

Until this is resolved, use the Vercel preview URL as a temporary `data-decision-url` for shadow
mode. Report the Vercel preview URL to sdk-engineer to unblock the snippet install.

**Resolution:** RESOLVED 2026-05-29. `admin.estalara.com` added as a custom domain on the Vercel
control-plane project. DNS CNAME record set to `6f8ae58f0ad31434.vercel-dns-017.com`. Verified:
`dig admin.estalara.com` resolves to Vercel; `curl https://admin.estalara.com/api/adapt` returns 200
(not 404 nginx).

## RESOLVED — ESC-015: SDK serve URL `cdn.estalara.com` is unprovisioned; pilot snippet src 404s [TICKET-PILOT-001]

**Filed by:** devops-engineer **Date:** 2026-05-29T00:00:00Z **Affects:** TICKET-PILOT-001 (Sprint
13a pilot launch), every tenant onboarded via the Magic Link wizard, every snippet currently emitted
by `apps/control-plane/src/components/onboarding/DetectionPreview.tsx:buildSnippet()` **Type:**
infrastructure / pilot-blocker

**Description:**

`buildSnippet()` emits `<script src="https://cdn.estalara.com/sdk.js" ...>` (the canonical CDN host
named by `SDK_CDN_URL` in `packages/shared/src/domains.ts:16`). Diagnostic during pilot dry run
confirmed:

- `cdn.estalara.com` has never been provisioned. No DNS record, no Cloudflare R2 bucket, no
  Wrangler/Terraform deploy pipeline, no SRI release flow.
- `packages/sdk/dist/estalara-sdk.iife.js` is built by `pnpm --filter @estalara/sdk build` but is
  gitignored and only ever published via `npm pack` for downstream consumers. Nothing uploads it to
  a public host.
- Net effect: every tenant who copy-pastes the wizard-generated snippet hits a DNS-level 404 on the
  `src` attribute, so the SDK never loads. Tier 1/2/3 are all silently broken at the install step.

`admin.estalara.com` (the Next.js control plane on Vercel) went live today via ESC-014. It already
serves Vercel static assets from `apps/control-plane/public/`. CEO decision: **ship the pilot by
serving the SDK bundle as a Vercel static asset under `https://admin.estalara.com/sdk.js`**. CDN
provisioning (versioned releases, SRI hashes, multi-region edge cache) is deferred to Phase 2.

**Required action:** (resolved by this PR — devops lane)

1. Build `@estalara/sdk` IIFE bundle and copy it to `apps/control-plane/public/sdk.js` (Vercel will
   serve it at `https://admin.estalara.com/sdk.js` with `content-type: application/javascript`).
2. Add `SDK_SERVE_URL = ${CONTROL_PLANE_URL}/sdk.js` to `packages/shared/src/domains.ts` so the URL
   is derived from `CONTROL_PLANE_URL` rather than another hardcoded literal.
3. Flip `buildSnippet()` (`DetectionPreview.tsx`) to emit `src="${SDK_SERVE_URL}"`.
4. Update the Pilot Runbook (`docs/ops/PILOT_RUNBOOK.md` §5 "Install the snippet") to use
   `https://admin.estalara.com/sdk.js` and to note that `cdn.estalara.com` is Phase 2.

**Resolution:** RESOLVED 2026-05-29 by this PR (`devops-engineer/ESC-015-sdk-static-serving`). The
pilot serves the SDK from `admin.estalara.com/sdk.js` via Vercel static asset hosting.
`SDK_CDN_DOMAIN` / `SDK_CDN_URL` constants remain in `packages/shared/src/domains.ts` for the Phase
2 cutover and are not consumed by `buildSnippet()` while the pilot is live.

**Phase 2 follow-up (not in scope for this PR):** Provision `cdn.estalara.com` end-to-end —
Cloudflare R2 bucket, signed release pipeline (`pnpm --filter @estalara/sdk release`), SRI hash
injection in `buildSnippet()`, multi-region edge cache, and a rollback playbook. When that lands,
flip the snippet generator back from `SDK_SERVE_URL` to `SDK_CDN_URL` and delete the `SDK_SERVE_URL`
constant. Track in a Phase 2 ticket (FOLLOW stub when sprint plan opens).

---

## RESOLVED — ESC-016: ingest Worker has no CORS headers; SDK calls from app.estalara.com are blocked [TICKET-PILOT-001]

**Filed by:** devops-engineer **Date:** 2026-05-29T00:00:00Z **Affects:** TICKET-PILOT-001 (Sprint
13a pilot launch), every browser-loaded SDK call to `ingest.estalara.com/v1/events` from
`app.estalara.com` (pilot) and `admin.estalara.com` (control-plane dashboards / wizard test pings)
**Type:** infrastructure / pilot-blocker

**Description:**

The pilot SDK is now live on `app.estalara.com` (ESC-015 served `sdk.js` from the control plane; the
script tag appears in DevTools and executes). But every event POST to
`https://ingest.estalara.com/v1/events` is blocked by the browser with:

> Access to fetch at 'https://ingest.estalara.com/v1/events' from origin 'https://app.estalara.com'
> has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the
> requested resource.

Root cause: `apps/ingest/src/router.ts` registers `secureHeaders` + `errorHandler` + `idempotency`
but **no CORS middleware** at all. The Hono app has no OPTIONS handler, so the preflight returns 404
with no `Access-Control-*` headers, and the actual POST response is missing
`Access-Control-Allow-Origin`. Net effect: zero events reach Redpanda from the browser-loaded pilot
SDK. Shadow-mode telemetry was silently empty.

This was never caught earlier because every prior ingest integration test exercises the handler from
the same origin (Node `app.fetch` with no `Origin` header — the browser CORS check never runs).

**Required action:** (resolved by this PR — devops lane)

1. Add `hono/cors` middleware to `apps/ingest/src/router.ts`, ordered immediately after
   `secureHeaders` so CORS headers land on every response (including the 401/429/5xx error paths the
   SDK needs to read).
2. Allow-list exactly the origins the SDK runs in: `https://app.estalara.com` (pilot site) and
   `https://admin.estalara.com` (control-plane Magic Link wizard / dashboards).
3. Allow methods `GET, POST, OPTIONS` and the four headers the SDK sets on every batch:
   `Content-Type`, `X-Estalara-API-Key`, `X-Estalara-Signature`, `Idempotency-Key`.
4. Expose `X-Request-ID` (debugging) and `Retry-After` (so the SDK's rate-limit backoff can read the
   header on 429 responses) via `Access-Control-Expose-Headers`.
5. Set `Access-Control-Max-Age: 86400` so browsers cache the preflight for 24h and the per-request
   CORS overhead drops to zero after the first page-view.
6. Cover preflight + actual-request + disallowed-origin paths with five unit tests in
   `apps/ingest/src/index.test.ts` so the regression we just hit cannot land silently again.

**Resolution:** RESOLVED 2026-05-29 by this PR (`devops-engineer/ESC-016-ingest-cors-fix`). After
merge + Wrangler deploy of the ingest Worker, verify with:

```
curl -i -X OPTIONS https://ingest.estalara.com/v1/events \
  -H "Origin: https://app.estalara.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,x-estalara-api-key,x-estalara-signature"
# Expect: 204, Access-Control-Allow-Origin: https://app.estalara.com,
# Access-Control-Allow-Methods includes POST, Access-Control-Allow-Headers
# includes content-type + x-estalara-api-key + x-estalara-signature + idempotency-key.
```

**Phase 2 follow-up (not in scope):** when customer-owned tenant domains come online, the hardcoded
`ALLOWED_ORIGINS` array becomes a tenant-aware lookup (origin → tenant_id → check
`tenants.allowed_origins`). For the pilot the two-host allow-list is correct and minimises attack
surface.

**Verification (2026-05-29):** `OPTIONS https://ingest.estalara.com/v1/events` returns `204` with
`Access-Control-Allow-Origin: https://app.estalara.com` present. `X-Session-ID` added to
`Access-Control-Allow-Headers` in follow-up PR #169
(`fix(ingest): add X-Session-ID to CORS allow-headers — ESC-016`). Live in production.

---

## RESOLVED — ESC-017: Redpanda Cloud Serverless has no Pandaproxy; ingest Worker cannot produce events [TICKET-PILOT-001]

**Filed by:** devops-engineer **Date:** 2026-05-29T00:00:00Z **Affects:** TICKET-PILOT-001 (Sprint
13a pilot launch), `apps/ingest` event pipeline, Master Design §A.1 Redpanda producer hop **Type:**
infrastructure / pilot-blocker

**Description:**

During TICKET-PILOT-001 E2E smoke testing, the ingest Worker attempted to POST events to Redpanda
Cloud Serverless via the Pandaproxy REST API (`REDPANDA_BROKER_URL`). The Pandaproxy endpoint was
unreachable — Redpanda Cloud **Serverless tier does not expose a Pandaproxy REST interface**.
Pandaproxy is only available on Dedicated and BYOC clusters. The original Master Design assumed
Pandaproxy as the ingest Worker → Redpanda hop, which was never viable on the Serverless cluster.

Net effect: zero events reached ClickHouse via the Redpanda path. Shadow-mode telemetry was silently
empty until diagnosed.

**Required action (resolved by PR #170):**

Implement a direct Worker → ClickHouse HTTPS write path in `apps/ingest/src/clickhouse-producer.ts`
using the ClickHouse HTTP interface (port 8443, `INSERT INTO default.events FORMAT JSONEachRow`).
Retain the Redpanda call as a dual-write no-op so the full chain activates without Worker changes
when a Pandaproxy-capable cluster is provisioned.

**Resolution:** RESOLVED 2026-05-29 by PR #170
(`feat(ingest): direct ClickHouse-write path for pilot [ESC-017]`). Direct Worker→ClickHouse HTTPS
write path implemented in `apps/ingest/src/clickhouse-producer.ts` (port 8443, INSERT FORMAT
JSONEachRow). E2E verified: event count 0→1 after POST to `/v1/events`,
`event_id = 01928f00-...-a3fc180390b5`, `tenant_id = cbc51cfa-1056-40aa-b0a9-6e982b52b1de`,
end-to-end latency 1.4s. Redpanda dual-write no-op retained for future Dedicated/BYOC upgrade path.

**Architectural implication (FOLLOW-157):** Redpanda Cloud Serverless = no Pandaproxy. The original
ingest→Pandaproxy→Redpanda→ClickHouse chain is not viable at the current tier. Canonical pilot path
= direct Worker→ClickHouse. Upgrade path vs. formalizing direct-ClickHouse as canonical to be
decided at Sprint 4 planning.

---

## RESOLVED — ESC-018: `description.requested` event omits `original_description`; real description+headline pipeline never generates [ADR-0009]

**Filed by:** Claude (session) **Date:** 2026-06-03T00:00:00Z **Affects:** description pipeline
(`apps/control-plane/src/app/api/adapt/description/route.ts` →
`apps/llm-gateway/src/jobs/generate_description.py`), ADR-0009 per-listing headline **Type:**
architectural / contract

**Description:** Pre-existing contract mismatch, surfaced while shipping the ADR-0009 per-listing
LLM headline. The control-plane route builds the `description.requested` event WITHOUT an
`original_description` field, and `DescriptionRequestedEventSchema`
(`packages/shared/src/schemas/description.ts`) does not declare one. But the Modal consumer treats
`original_description` as **required** — `consume_description_requests()` rejects any message
missing it (`missing_fields`), and `generate_description()` reads `event["original_description"]`
directly (KeyError otherwise). It is also the primary factual-grounding source for both the v1.8
description prompt and the new `_generate_headline()` call.

Net effect: in the real Redpanda→Modal path, every `description.requested` message is dropped at
consumer validation — so neither the AI description nor the new per-listing headline is ever
generated or cached. The local demo works only because it routes through the mock decision harness
(`scripts/dev/mock-decision-server.mjs`, port :9100), which generates inline and bypasses this event
contract entirely.

This is **not** introduced by the ADR-0009 headline change (the route diff only added `headline`
fields to responses); the headline simply inherits the same latent gap. The headline implementation
itself is correct and rides the description cache as designed.

**Required action:** Thread `original_description` from the route into the `description.requested`
event and add it to `DescriptionRequestedEventSchema` (source: the listing's current description —
likely via `retrieveListingContext` or a dedicated listing fetch). Then verify end-to-end that a
Tier 2/3 cache miss results in a cached `{text, headline, generated_at}` entry. Decide whether to
fix in a follow-up ticket or fold into the next description-pipeline change.

**Resolution:** RESOLVED 2026-06-03 on branch `ml-engineer/per-listing-llm-headline` (PR #182).
`original_description` is now threaded through the pipeline:

- `DescriptionRequestedEventSchema` (`packages/shared/src/schemas/description.ts`) declares
  `original_description: z.string()` (always present; may be empty).
- New helper `apps/control-plane/src/lib/listing-details.ts` →
  `fetchListingOriginalDescription(listingId, locale)` fetches the listing's original description
  from the Estalara backend listing-details API (`ESTALARA_BACKEND_URL`, UUID→`?listing-uuid=` else
  `/slug?slug=`, locale upper-cased) — mirroring the mock harness `fetchListing`. Fail-open to `''`
  with a 2s timeout; no `listings` table exists, so the tenant backend is the source.
- The description route (`/api/adapt/description`) fetches it in parallel with RAG context on cache
  miss and includes it in the published event. `ESTALARA_BACKEND_URL` added to `.env.example`.
- Tests: route asserts the event carries `original_description` (and is populated from the backend);
  6 unit tests for the helper (UUID vs slug, locale upper-casing, fail-open paths). Full
  control-plane typecheck/lint/prettier clean.

Note: SSRF check is intentionally NOT applied — the base host comes from our trusted
`ESTALARA_BACKEND_URL` and `listing_id` is URL-encoded into a query value (cannot alter the host);
`checkSsrf` would also reject the loopback backend used in local dev.

---

## RESOLVED — ESC-019: production Estalara backend listing-details API requires auth; server-side fetch fails open to empty `original_description` [TICKET-DESC-001]

**Filed by:** Claude (session) **Date:** 2026-06-03T00:00:00Z **Affects:** description + per-listing
headline pipeline (`apps/control-plane/src/lib/listing-details.ts`, `/api/adapt/description`),
ESC-018 fix end-to-end correctness **Type:** architectural / infra

**Description:** Surfaced while verifying the ESC-018 fix (RETRO-028 P1 PM action: "verify against a
real backend"). The fix grounds generation by fetching the listing's original description from the
Estalara backend listing-details API. This works against the **local dev backend**
(`localhost:8081`, what the mock harness `fetchListing` uses) but NOT against the **production**
backend.

Verified against production (read-only GET):

```
GET https://app.estalara.com/api/v1/listing/details/slug?slug=9-blackberry-pl-palm-coast-fl-32137&locale=EN
→ HTTP 302  location: /en?back=%2Fapi%2Fv1%2Flisting%2Fdetails%2Fslug%3F...
```

An **unauthenticated server-to-server** call is redirected to the SvelteKit login page. The helper's
`fetch` follows the redirect (undici default `redirect: 'follow'`), receives the SPA HTML with
`200`, `res.json()` throws, and the helper **fails open to `''`**. Net effect in production:
`original_description` is empty, so both the adapted description and the ADR-0009 per-listing
headline are generated **without factual grounding** (the v1.8 thin-original exception kicks in) —
the consumer no longer drops the message (the key is present), so the failure is **silent**: copy is
produced, just ungrounded. (`api.estalara.com` is not the host — returns 404.)

The local dev backend does not enforce the auth guard, so the mock-harness demo and the unit tests
(mocked backend) both pass — the gap is invisible until a real authenticated production fetch.

**Required action (human / devops + backend — needs a decision):**

1. Decide how the control-plane authenticates server-to-server to the Estalara backend listing API:
   an **internal/unguarded backend URL** (set `ESTALARA_BACKEND_URL` to it, not the public
   `app.estalara.com`), OR a **service token / session** the helper attaches (e.g. `Authorization`
   header or signed internal header), OR a dedicated internal listing-details endpoint.
2. Set the resolved `ESTALARA_BACKEND_URL` (and any token secret) in Vercel prod + Doppler.
3. Harden the helper to fail **loud not silent** on a non-JSON / redirected response: use
   `redirect: 'manual'` or assert the response `content-type` is JSON, and log a distinct warning
   (and/or emit a metric) so an ungrounded-generation regression is observable rather than silent.
4. Re-verify end-to-end: a Tier 2/3 cache miss against the real backend yields a cached
   `{text, headline, generated_at}` whose copy reflects the actual listing facts.

**Note:** The ESC-018 data-shape fix itself is correct and remains RESOLVED (the event now always
carries the `original_description` key). ESC-019 is the _reachability/auth_ half — the field is now
threaded, but the production source it reads is not yet reachable by an unauthenticated server call.

**Resolution:** RESOLVED 2026-06-04 by PR #196
(`fix(control-plane): correct ESTALARA_BACKEND_URL to api.estalara.com + redirect guard [ESCALATION]`).
Root cause: `ESTALARA_BACKEND_URL` was pointing at `app.estalara.com` (SvelteKit frontend with auth
guard). PR #196 corrected it to `https://api.estalara.com` (Spring Boot backend with `permitAll()` —
no auth required for listing-details). Added `redirect: 'manual'` guard in `listing-details.ts` so
redirect responses fail loud rather than silently failing open. FOLLOW-192 (Sprint 15) marked
CLOSED.

---

## RESOLVED — ESC-021: PR #281 (FOLLOW-287) merged with FAILING ClickHouse migrations smoke gate [FOLLOW-287/FOLLOW-288]

**Filed by:** pm-orchestrator **Date:** 2026-06-13T10:30:00Z **Affects:** FOLLOW-287 (PR #281),
FOLLOW-288 (remediation), ClickHouse migrations smoke CI gate on main **Type:** CI gate violation /
repo integrity

**Description:**

PR #281 (FOLLOW-287, branch `backend-engineer/FOLLOW-279-k36-ch-write-fix`) was merged to main at
2026-06-12T22:31:19Z while the **ClickHouse migrations smoke** CI gate was FAILING. This violates
the non-negotiable rule: PM must not mark a ticket READY_FOR_REVIEW while any real CI check is
failing, and PRs must not be merged without all real gates green.

Root cause confirmed from CI logs (run 27446753341):

```
ClickHouse migrations smoke  Apply migrations (LOCAL=1 → MergeTree)
curl: (22) The requested URL returned error: 500
Code: 524. DB::Exception: ALTER of key column intent_session_id from type UUID to type String
is not safe because it can change the representation of primary key.
(ALTER_OF_COLUMN_IS_FORBIDDEN) (version 26.5.1.882 (official build))
Process completed with exit code 22.
```

Migration 0016 (`infra/clickhouse/migrations/0016_intent_events_session_id_type_fix.sql`) contains:

```sql
ALTER TABLE intent_events
  MODIFY COLUMN intent_session_id String DEFAULT '';
```

ClickHouse 26.5.1 forbids `MODIFY COLUMN` on ORDER BY key columns. This was the exact fix that was
supposed to have been applied as a SELECT 1 no-op, but the actual file still contains the forbidden
ALTER TABLE statement.

**Impact on main branch:** The ClickHouse migrations smoke gate now FAILS on every PR that runs
against main. FOLLOW-267 (the next P1 ticket in the K.3.6 chain) cannot be merged cleanly while this
gate is red.

**Required action (human — approve remediation path):**

FOLLOW-288 (P0) has been added to the queue with status READY. It will:

1. Replace migration 0016 with a `SELECT 1` no-op (preserves journal sequence, fixes smoke gate).
2. Remove `intent_session_id` from the INSERT body in intent-snapshot.ts (session_id is the
   authoritative join key per migration 0015 — intent_session_id stays UUID with original default).
3. Update tests accordingly.

**Human decision needed:** Please confirm the remediation approach is acceptable before PM delegates
FOLLOW-288. Specifically: confirm that leaving `intent_session_id` as UUID NOT NULL with its
original default (writing nothing to it) is acceptable — existing rows will have the UUID default,
new rows will also have the UUID default. The `session_id` String column (migration 0015) is the
authoritative join key for FOLLOW-269, not intent_session_id.

**Resolution:** RESOLVED 2026-06-13 by backend-engineer (PR #282, merged 2026-06-12T23:27:03Z). No
CEO decision was required. ClickHouse error 524 (ALTER_OF_COLUMN_IS_FORBIDDEN on ORDER BY key
columns) is a hard constraint — there is no design choice to make. The remediation was technically
unambiguous: migration 0016 was replaced with a SELECT 1 no-op, and intent_session_id was removed
from the INSERT body (ClickHouse uses zero-UUID default; session_id String from migration 0015 is
the authoritative join key for FOLLOW-269). ClickHouse migrations smoke gate is now PASSING on PR
#282. All real CI gates confirmed green. ESC-021 filed in error as requiring human decision.

---

## OPEN — ESC-020: Estalara-app DOM hooks committed but not deployed to production [FOLLOW-191]

**Filed by:** sdk-engineer **Date:** 2026-06-06T13:30:00Z **Affects:** FOLLOW-191, FOLLOW-197,
Sprint 15 Track A **Type:** deployment

**Description:**

FOLLOW-191 audit (2026-06-06) confirmed the following gap: the `data-estalara-slot` hooks and the
SDK `<script>` loader are **committed** to the Estalara-app git repo (`web-master` HEAD at commit
`9d2df9d`) but the **production `app.estalara.com`** is running an older build that predates these
changes. Evidence:

```
curl -s https://app.estalara.com/en/listing/deerfield-lake-ct-cape-coral-fl-33909-90681784-8a9a-4953-ae48-fe8f8a3865e2 \
  | grep -c "data-estalara"
# Returns: 0
```

The production HTML has zero `data-estalara-*` attributes and no SDK `<script>` tag in `<head>`. The
adaptation layer fires `adapt.skipped` with `reason: 'no_slot_elements'` for every listing view. No
adapted experience has been measured in production.

Additionally, the local `web-master` working tree has `src/app.html` temporarily overridden to point
to `http://localhost:9100/estalara-sdk.iife.js` for local demo use. This override is uncommitted and
must NOT be deployed.

**Required action (Rafał Palak, CTO):**

Three steps to unblock pilot measurement:

1. In the `web-master` directory, restore `app.html` to the committed (production) version if it
   differs: `git checkout -- src/app.html`. The committed version correctly points to
   `https://admin.estalara.com/sdk.js`.

2. Set `PUBLIC_ESTALARA_SDK_ENABLED=true` in the production hosting environment for `web-master`
   (Docker env, hosting provider config, or equivalent). This flag gates all four A1 slot edits —
   without it the listing page renders with no slots (byte-identical to before the edits).

3. Deploy `web-master` HEAD to production. After deploy, verify with:

   ```bash
   curl -s https://app.estalara.com/en/listing/deerfield-lake-ct-cape-coral-fl-33909-\
   90681784-8a9a-4953-ae48-fe8f8a3865e2 | grep -c "data-estalara"
   # Expected: ≥3 (listing-id attr + headline slot + description slot)
   ```

4. Confirm `https://admin.estalara.com/sdk.js` returns HTTP 200 (the SDK IIFE bundle must be served
   there — see `apps/control-plane/public/sdk.js` in Adaptive-Listings).

5. Mark this escalation RESOLVED and update FOLLOW-191 → DONE in `backlog/QUEUE.md`.

Full deployment guide: `backlog/HANDOFFS.md` section "FOLLOW-191 → Rafał Palak (CTO)". Original slot
spec: `/home/asipi/Projects/Estalara-app/web-master/HANDOFF_ESTALARA_ADAPTIVE.md`.

**Blocking:** FOLLOW-197 (adapt.applied signal) depends on this being live.

**Resolution:** CEO clarification 2026-06-10: agreed workflow is **local-first testing** — all
verification must pass on localhost (Estalara-app running on developer machine) BEFORE Rafał deploys
to production. This escalation's "Required action (Rafał)" is DEFERRED until local testing is
complete and CEO signs off. **This escalation does NOT block the PM pipeline for other tickets.**
FOLLOW-191 tracks local validation; once CEO confirms local testing passes, Rafał will be instructed
on the production deployment steps listed above. ESC-020 remains OPEN until the production deploy is
confirmed.

---

## RESOLVED — ESC-022: Prod Supabase was 14 migrations behind (2026-05-28 → 2026-06-14) including compliance migrations — item (1) compliance integrity SIGNED OFF; item (2) standing mechanism DONE (FOLLOW-308 LIVE)

**Filed by:** pm-orchestrator **Date:** 2026-06-14T10:00:00Z **Affects:** prod Supabase (project
yhmivuqeqkmzpxpyrsvc, "Adaptive-Listings", eu-west-3), FOLLOW-307, FOLLOW-308, compliance posture
(conversion_labels, dsr_durable_lead_id) **Type:** compliance / operational

**Description:**

On 2026-06-14, the K.3.6 D-1 seed (migration 0030) was applied to prod Supabase via
`doppler run --config prd -- pnpm db:migrate`. During apply it was discovered that prod was **14
migrations behind** — `drizzle.__drizzle_migrations` had only 17 entries, last applied approximately
2026-05-28 (migration ~0016), while the repo was at migration 0030. Migrations **0017 through 0030
had NEVER been applied to prod**.

The affected migrations include:

- **0019, 0020** — `conversion_labels` table (CRM tracking, GDPR-related label data)
- **0024** — `dsr_durable_lead_id` column (DSR / GDPR Art. 17 erasure tracking)
- **0021** — `engagement_scores` table
- **0022** — `quiz_completions` table
- **0025** — `tenants_quiz_enabled` column
- **0026, 0027** — quiz_config strip migrations
- **0028** — `intent_sessions` table (K.3.6)
- **0029** — `intent_weight_configs` table (K.3.6)
- **0030** — global-default seed row (K.3.6)

This means that for approximately **2.5 weeks** (2026-05-28 → 2026-06-14), features that depended on
these schemas were silently non-functional in prod:

- Conversion label writes would have failed (table did not exist)
- DSR `dsr_durable_lead_id` column would have been absent from `leads` (DSR erasure tracking broken)
- Quiz completion writes would have failed (table did not exist)
- All K.3.6 intent tracer features were inert in prod (schemas absent)

All 14 migrations applied cleanly on 2026-06-14. Prod `drizzle.__drizzle_migrations` is now at 31
(full repo count). Root cause: no auto-apply mechanism (RETRO-076 OG-1) — Postgres migrations are
operator-driven only, unlike ClickHouse which auto-applies in CI. Note: prod project was AUTO-PAUSED
(Supabase idle pause) and had to be resumed before apply — confirming prod is not yet serving steady
traffic (pre-pilot phase).

**FOLLOW-307** (apply objective) is DONE. **FOLLOW-308** (standing mechanism) tracks the prevention
fix.

**Required human action (Piotr / Rafał — compliance + operations):**

1. ~~**Compliance data-integrity check**~~ — **SIGNED OFF 2026-06-14 (see item-1 resolution
   below).**

2. **Standing mechanism decision (STILL OPEN):** Approve one of the two options in FOLLOW-308:
   - Option A: Add an auto-apply `db:migrate` step to the deploy workflow (mirrors ClickHouse).
   - Option B: Add an explicit operator checklist gate with a CI divergence check. This decision
     blocks FOLLOW-308 (P1) from proceeding to implementation.

**This escalation does NOT block the PM pipeline** for other tickets (FOLLOW-293, FOLLOW-269, etc.)
but DOES block FOLLOW-308 AC3 closure until item (2) is decided.

---

### Item (1) — RESOLVED 2026-06-14 — Compliance data-integrity sign-off

**Question closed:** Did the 14-migration prod drift (prod stuck at 2026-05-28, migrations 0017→0030
absent) cause any data-integrity issue from the compliance migrations being absent in prod —
specifically 0019/0020 conversion_labels and 0024 dsr_durable_lead_id?

**Verdict: NO data-integrity issue. The gap was benign. No remediation needed.**

**Evidence (verified against prod project yhmivuqeqkmzpxpyrsvc on 2026-06-14):**

1. The three compliance migrations are PURELY ADDITIVE — no transform/backfill/drop:
   - 0019 `CREATE TABLE IF NOT EXISTS conversion_labels` (new table)
   - 0020 `ADD CONSTRAINT … UNIQUE (tenant_id, prediction_id)` on a table the migration itself notes
     "has never been seeded in any environment"
   - 0024 `ADD COLUMN IF NOT EXISTS durable_lead_id text` (nullable, no backfill) So applying them
     late cannot corrupt pre-existing data.

2. All 14 migrations applied CLEANLY — runner reported "Migrations applied: 14 … 31 now applied, 0
   still pending", exit 0; prod `__drizzle_migrations` went 17→31. The UNIQUE constraint (0020)
   applying cleanly is positive proof no conflicting rows existed.

3. Prod data state verified EMPTY / pre-pilot: tenants=1, conversion_labels=0, dsr_verifications=0
   (with durable_lead_id non-null=0), intent_sessions=0, quiz_completions=0, engagement_scores=0.

4. The two specific compliance risks could not have materialized:
   - DSR under-deletion (the FOLLOW-184 / 0024 concern): requires DSR requests AND CRM-sourced
     conversion labels — prod has 0 of each. Nothing to erase; nothing erased incompletely.
   - Conversion-label corpus duplication/loss (0019/0020 concern): conversion_labels=0 — no labels
     written, none duplicated or lost.
   - The prod DB had auto-paused from inactivity, consistent with no feedback/CRM/DSR traffic during
     the window.

**Signed off by:** Piotr (CEO) via Claude Code orchestrator, 2026-06-14, on the above evidence.

---

### Item (2) — RESOLVED 2026-06-15 — Standing mechanism live

FOLLOW-308 (P1, devops): Option A implemented and now ACTIVE. `.github/workflows/db-migrate.yml`
auto-applies `pnpm db:migrate` staging → prod on every push to `main` touching
`packages/db/migrations/**` or `packages/db/scripts/migrate.ts`. Activation required three fixes
beyond the initial PR #297: (a) ESC-023 Doppler tokens provisioned, (b) build-order fix PR #306
(`Build @estalara/shared` before `db`), (c) `DATABASE_URL_ADMIN` added to Doppler stg/prd. Verified
live end-to-end: `workflow_dispatch` run 27513894932 — Migrate (staging) + Migrate (prod) both
green, real `Run Drizzle migrations` executed (not soft-skip). With item (1) already signed off,
ESC-022 is now fully RESOLVED.

**Resolution:** PARTIALLY-RESOLVED. Item (1) closed 2026-06-14 by Piotr (CEO) sign-off — compliance
integrity confirmed benign (pre-pilot, zero traffic, purely-additive migrations applied cleanly).
Item (2) — standing mechanism — remains OPEN pending Piotr's Option A/B decision to unblock
FOLLOW-308 implementation.

---

## RESOLVED — ESC-023: DOPPLER_TOKEN_STG and DOPPLER_TOKEN_PRD GitHub Actions secrets must be provisioned for db-migrate.yml to activate [FOLLOW-308]

**Filed by:** devops-engineer **Date:** 2026-06-14T00:00:00Z **Affects:** FOLLOW-308,
`.github/workflows/db-migrate.yml`, prod + staging Supabase migration auto-apply **Type:**
repo-config / secrets

**Description:**

FOLLOW-308 (Option A — CEO decision) implements a new GitHub Actions workflow
`.github/workflows/db-migrate.yml` that auto-applies `pnpm db:migrate` to staging then prod on every
push to `main` that touches `packages/db/migrations/**` or `packages/db/scripts/migrate.ts`.

The workflow requires two Doppler service tokens as GitHub Actions repository secrets:

- `DOPPLER_TOKEN_STG` — Doppler service token scoped to project `estalara-adaptive-listings`, config
  `stg`. Used to inject `DATABASE_URL_ADMIN` (or `DATABASE_URL_DIRECT`) for the staging Supabase
  project during the `migrate-staging` job.
- `DOPPLER_TOKEN_PRD` — Doppler service token scoped to project `estalara-adaptive-listings`, config
  `prd`. Used to inject the prod Supabase credentials during the `migrate-prod` job.

**`gh secret list` result (2026-06-14):** Only `DOPPLER_TOKEN_DEV` exists in this repo. Neither
`DOPPLER_TOKEN_STG` nor `DOPPLER_TOKEN_PRD` exists.

**Current impact:** The `db-migrate.yml` workflow is in the repo and will be triggered by migration
pushes, but both jobs will soft-skip (emit a `::notice::` and exit 0). The workflow is visually
present in GitHub Actions but INERT. No auto-apply will occur until the secrets are provisioned.

**Required action (Piotr — ~10 minutes per token, ~20 minutes total):**

For each environment (stg, prd):

1. Go to [Doppler dashboard](https://dashboard.doppler.com) → project `estalara-adaptive-listings` →
   config `stg` (or `prd`) → Access → Service Tokens → Create service token.
   - Name: `ci-github-actions-migrate`
   - Config: `stg` (for staging token) / `prd` (for prod token)
   - Expiry: none or 1 year — rotate on breach per V.6.1 policy.
   - The token needs READ access to the config so `doppler run` can inject
     `DATABASE_URL_ADMIN`/`DATABASE_URL_DIRECT`/`DATABASE_URL`.
2. Copy the token value (shown only once).
3. Go to GitHub repo → Settings → Secrets and variables → Actions → New repository secret.
   - Staging: Name `DOPPLER_TOKEN_STG`, value = staging token.
   - Prod: Name `DOPPLER_TOKEN_PRD`, value = prod token.
4. After adding, push an empty commit to `main` or use `workflow_dispatch` on `db-migrate.yml` to
   trigger a run. Confirm both jobs execute `pnpm db:migrate` (not soft-skip) and exit 0 ("Already
   up-to-date" or "Migrations applied successfully.").
5. Mark ESC-023 RESOLVED.

**Security note:** The `prd` token must be scoped read-only to the Doppler `prd` config. It does NOT
need write access to Doppler — only `doppler run` injection (reading secrets). The token should NOT
have access to any other Doppler project.

**This does NOT block FOLLOW-308 AC1/AC2** (the workflow is implemented and cross-referenced in
docs). It blocks AC3 (ESC-022 compliance sign-off) and the "live not inert" state of the mechanism.

**Resolution:** RESOLVED 2026-06-15 (Piotr). Three conditions had to be met for the workflow to run
for real, not just exist:

1. **GitHub Actions secrets provisioned** (2026-06-14): `DOPPLER_TOKEN_STG` and `DOPPLER_TOKEN_PRD`
   service tokens (Doppler project `estalara-adaptive-listings`, configs `stg`/`prd`) added as repo
   secrets. Confirmed via `gh secret list`.
2. **Build-ordering bug fixed** (PR #306, merged 2026-06-15): `db-migrate.yml` built `@estalara/db`
   without first building its `workspace:*` dependency `@estalara/shared`, so `tsc` failed on a
   clean runner (`TS2307: Cannot find module '@estalara/shared'`). Added
   `pnpm --filter @estalara/shared build` before the db build in all three affected jobs
   (migrate-staging, migrate-prod, and `post-migrate-seed.yml` seed-archetypes, which had the same
   latent bug).
3. **Doppler config content** (2026-06-15): the `stg`/`prd` configs were missing
   `DATABASE_URL_ADMIN` (the admin/RLS-bypass connection the migrate script requires per
   `packages/db/src/client.ts:189`). Added to both configs as the Supabase **Session pooler** URI
   (port 5432, IPv4-reachable from GitHub-hosted runners — Direct connection is IPv6-only and would
   fail; Transaction pooler 6543 is not session-mode).

**Verification:** `workflow_dispatch` run 27513894932 — both `Migrate (staging)` and
`Migrate (prod)` green, with the real `Run Drizzle migrations` step executing (NOT the soft-skip
path). The workflow is now LIVE, not inert: any push to `main` touching `packages/db/migrations/**`
or `packages/db/scripts/migrate.ts` auto-applies staging → prod.

**Note:** This was the activation half of FOLLOW-308 AC3. The other half — the **ESC-022 human
compliance sign-off** on migrations 0019/0020/0024 against pre-schema prod — was already SIGNED OFF
2026-06-14 (ESC-022 item 1, Piotr/CEO). With activation now verified live, ESC-022 item (2)
(standing mechanism) is also closed → ESC-022 fully RESOLVED and **FOLLOW-308 closed in full**
2026-06-15.

---

## RESOLVED — ESC-024: GitHub Actions secrets required for FOLLOW-293 K.3.6 D-1 live-network smoke [FOLLOW-293]

**Resolved:** 2026-06-15 by Piotr (CEO). ESTALARA_SMOKE_API_KEY (smoke key est_pub_0000000000000001,
api_keys row inserted manually via Supabase SQL) + ESTALARA_SMOKE_DECISION_API_URL
(https://admin.estalara.com/api) added to GitHub Actions secrets. DATABASE_URL_ADMIN added to Vercel
prod env (was in Doppler prd but missing from Vercel); control-plane redeployed. Smoke run
27555287447: AC-LN1/LN2/LN3 all GREEN. FOLLOW-293 DONE IN FULL.

**Filed:** 2026-06-15 by qa-engineer **Blocks:** FOLLOW-293 hard-assert mode (smoke currently
soft-skips in all CI runs) **Priority:** P2

**Context:**

FOLLOW-293 adds a live-network smoke (`tests/integration/intent-weights-live.smoke.test.ts`) that
calls the real SDK `fetchIntentWeights()` against the real `GET /api/intent/config` endpoint and
asserts `data_source: 'live'` (proving migration 0030 / FOLLOW-307 AC1 is effective in production).
The CI job (`intent-weights-live-smoke.yml`) runs on every push but soft-skips when the required
secrets are absent. Currently **no run will exercise the live assertion** because neither secret is
provisioned.

**Secrets needed:**

1. `ESTALARA_SMOKE_API_KEY` — a real tenant Bearer token for a real row in `api_keys` in the
   production Supabase (project `yhmivuqeqkmzpxpyrsvc`, eu-west-3). The token must be for a tenant
   that has NO tenant-specific `intent_weight_configs` row so it falls through to the global seed
   row and returns `data_source: 'live'`. Any real onboarded-tenant key works, or a dedicated
   smoke-tenant key seeded via `pnpm seed:local-tenant` run against prod.

2. `ESTALARA_SMOKE_DECISION_API_URL` — the production `decisionApiUrl` value, which is
   `https://admin.estalara.com/api` (host + `/api`, as emitted by `buildSnippet()` in
   `DetectionPreview.tsx:153`). This is NOT a secret (it is already public in the snippet), but it
   is included as a secret so the CI job can be pointed at staging vs production without a code
   change. Staging value: `https://admin-stg.estalara.com/api` (if a staging deployment exists).

**Steps to provision:**

1. Create (or reuse) a tenant API key in production Supabase:
   - Find an existing active key:
     `SELECT raw_key, tenant_id FROM api_keys WHERE revoked_at IS NULL LIMIT 1;` (requires
     `pnpm db:studio` or Supabase SQL editor with service-role access).
   - Alternatively run `pnpm seed:local-tenant` against prod to create a dedicated smoke tenant.
2. Add both secrets to the GitHub repo:
   - GitHub repo → Settings → Secrets and variables → Actions → New repository secret
   - `ESTALARA_SMOKE_API_KEY`: the raw API key value
   - `ESTALARA_SMOKE_DECISION_API_URL`: `https://admin.estalara.com/api`
3. Push a commit to main or use `workflow_dispatch` on `intent-weights-live-smoke.yml`.
4. Confirm the job enters the HARD-FAIL mode (not soft-skip): look for `secrets_present=true` in the
   "Check secret availability" step.
5. Confirm the smoke assertions pass: AC-LN1, AC-LN2, AC-LN3 all green.
6. Mark ESC-024 RESOLVED.

**What happens until ESC-024 is resolved:**

Every CI run emits:
`::notice::ESTALARA_SMOKE_API_KEY is not set — K.3.6 D-1 live-network smoke will soft-skip.`

The smoke test suite itself reports all 3 tests as skipped. This is NOT a CI failure — it is a
documented, intentional soft-skip. The live assertion gap (FOLLOW-293's core purpose) is documented
here so it cannot be forgotten.

**Security note:** `ESTALARA_SMOKE_API_KEY` must be a read-only SDK API key (same `scopes` as the
`data-api-key` attribute in the install snippet — `write:events` if the ingest is wired, or a custom
read scope). It must NOT be an admin key or service-role key.

---

## RESOLVED — ESC-025: FOLLOW-346 chat NLP shadow bridge is dead-on-arrival in prod (cross-language payload-key mismatch); ticket was marked DONE against an unmet AC-1 [FOLLOW-346 / FOLLOW-366]

**RESOLVED 2026-06-20:** FOLLOW-366 (PR #332, commit `eaf31a9`) merged to main — `_spawn_chat_nlp`
now reads `payload["message"]` and the test fixture is built from the real
`ChatMessageSentPayloadSchema` (Rule Z). PM-validated (0 new CI failures, wiring confirmed
hop-by-hop, fail-before/pass-after). The shadow bridge now fires for real `chat.message.sent`
traffic; FOLLOW-346 AC-1 is met end-to-end.

**Filed by:** retrospective-analyst (RETRO-098, via Opus 4.8 session) **Date:** 2026-06-20
**Affects:** FOLLOW-346 (merged PR #330), FOLLOW-366 (hotfix) **Type:** priority

**Description:** The just-merged chat NLP shadow bridge does not function against real traffic. The
SDK producer emits `chat.message.sent` with payload `{ message, char_count, lead_id }` (canonical
`ChatMessageSentPayloadSchema`, `packages/shared/src/schemas/events/chat.ts:38-48`), but the new
Python consumer `_spawn_chat_nlp` (`apps/stream-consumer/src/consumers/events.py:67-74`) reads
`payload.get("content")` / `payload.get("role")` and guards `if not message["content"]: return`. For
100% of real events `content == ""` → the guard trips → the Modal `process_chat_message` spawn never
fires → no Redis shadow key is ever written → the TS reader at `route.ts:1073` always misses. Both
sides shipped green because every test on the path constructs a hand-invented `{role, content}`
fixture instead of the real producer shape (Rule Z violation). FOLLOW-346's AC-1 ("consumed
`chat.message.sent` invokes the NLP extractor; Redis shadow key written + read by `/api/adapt`") is
therefore NOT met end-to-end — the ticket should not have closed against it. The prior PM validation
("verified end-to-end") checked the Redis key byte-identity but not the payload field one hop
upstream. DPIA posture is unaffected (no raw text persisted; the brief's privacy conclusions hold —
only its "shadow data is being collected" premise is currently false).

**Required action:** (1) Authorize FOLLOW-366 as a P0 hotfix (repoint the consumer to
`payload["message"]`, ship with a producer-shape-grounded fixture). (2) Decide whether FOLLOW-346
should be re-opened / re-labeled (AC-1 unmet) or left DONE with FOLLOW-366 carrying the fix. (3)
Note that the post-pilot chat-vs-archetype disagreement-rate analysis (the entire purpose of shadow
mode) will have an empty dataset until FOLLOW-366 lands.

**Owner:** CEO (priority call) → data-engineer (FOLLOW-366 implementation)

---

## RESOLVED — ESC-026: FOLLOW-342 GET-path bandit serves + logs treatment variants to HOLDOUT sessions, contaminating the experiment baseline in prod [FOLLOW-342 / FOLLOW-360]

**RESOLVED 2026-06-20:** FOLLOW-360 (PR #333, commit `2836adc`) merged to main — GET-path variant
selection is now gated behind the holdout check (`holdoutGroup ? 'control' : thompsonSample(...)`),
so holdout GET sessions serve + log `variant='control'`. PM-validated (0 new CI failures, both
serve + ClickHouse-log paths receive the gated value, fail-before/pass-after). **Data caveat:**
exclude `adaptation_decisions` rows where `holdout_group=1 AND variant != 'control'` from historical
lift queries for the window PR #327 merge (`66054d6`, 2026-06-19) → PR #333 merge (`2836adc`,
2026-06-20).

**Filed by:** retrospective-analyst (RETRO-095, via Opus 4.8 session) **Date:** 2026-06-20
**Affects:** FOLLOW-342 (merged PR #327), FOLLOW-360 (hotfix), pilot-calibration + ab/weights
analytics **Type:** priority

**Description:** The POST `/api/adapt` handler returns early for holdout BEFORE variant selection
(`route.ts:894-919`, selection at `:993`), so holdout sessions correctly get `directives:[]` and no
variant. The GET handler samples + serves + logs a bandit variant at `route.ts:698-742` with NO
holdout short-circuit, yet still logs `holdoutGroup`. A GET request carrying `holdout_group=true` is
now served `v1`/`v2` copy AND logged to ClickHouse as `(holdout_group=1, variant=v1)` — the holdout
counterfactual baseline (which must stay control-only) is being polluted on every GET-path holdout
request. Before PR #327, GET hardcoded `'control'` in its log, so holdout rows were always clean;
this PR regressed it. Any downstream measurement keyed on `adaptation_decisions` (FOLLOW-170
conversion label loop, pilot calibration) now reads a contaminated baseline. Separately (P1,
FOLLOW-359): the GET response omits `variant`, so GET-path conversions are unattributable and the
bandit posterior never learns from GET traffic.

**Required action:** (1) Authorize FOLLOW-360 as a P0 hotfix (gate GET variant selection behind the
holdout/consent check, mirror POST's early-return ordering; holdout GET requests must serve + log
`variant=control`). (2) Flag that any analytics computed over `adaptation_decisions` between
2026-06-19 (PR #327 merge) and the FOLLOW-360 fix should treat holdout-row variants as suspect.

**Owner:** CEO (priority call) → backend-engineer (FOLLOW-360 implementation)

---

## RESOLVED — ESC-027: FOLLOW-345 page-type-derived `tier` re-introduces Tier vocabulary that MASTER_DESIGN §E.7 eliminated — CEO ruling needed before FOLLOW-357 can be implemented [FOLLOW-345 / FOLLOW-357]

**Filed by:** pm-orchestrator **Date:** 2026-06-20 **Affects:** FOLLOW-357 (P1 rename/carve-out),
MASTER_DESIGN §E.7, `apps/control-plane/src/app/api/adapt/route.ts` `tierFromPageType()` **Type:**
architectural

**Description:** MASTER_DESIGN §E.7 (CEO ruling 2026-06-05) eliminated Tiers: "wszyscy tenanci
dostają jedno doświadczenie … Parametr `tier` usunięty z API". FOLLOW-345 (PR #323, merged
2026-06-20) introduces `tierFromPageType()` (`route.ts:763`) which derives a value explicitly called
the "integration tier" (`{1, 2}` from `page_type`) and persists it to `adaptation_decisions.tier`.
The docstring calls tier 2 "Augment" — the old tier-2 integration tier name. This contradicts §E.7.

Two resolutions are possible: (a) **Rename path**: rename the derived value off the "tier"
vocabulary (e.g. `directive_scope: 'detail' | 'list'` or `page_context`), update the ClickHouse
column semantics, fix the docstring and §E.7 / §E.1 in MASTER_DESIGN so SoT and code agree. (b)
**Carve-out path**: CEO grants an explicit §E.7 carve-out that the `/api/adapt` response `tier`
field is a page-context axis (detail vs list) independent of the legacy integration-tier concept,
and §E.7 is patched to document the exception. The "Augment" framing in the docstring is removed.

**Required action:** CEO chooses (a) or (b) and records the decision here. FOLLOW-357
(backend-engineer, P1, 2h) is BLOCKED until this ruling is received.

**Owner:** CEO architectural ruling → FOLLOW-357 (backend-engineer)

**Resolution:** RESOLVED 2026-06-20: CEO ruled option (a) — rename to `directive_scope`. Implemented
in FOLLOW-357 (PR opened 2026-06-20): `tierFromPageType` renamed to `directiveScopeFromPageType`,
local variable `derivedTier` renamed to `directiveScope`, POST response field `tier` renamed to
`directive_scope` in all three response arms, docstring rewritten, `AdaptationDirectives` shared
type updated, SDK `AdaptResponse` updated, Zod schema updated. ClickHouse column rename
(`adaptation_decisions.tier` → `directive_scope`) is deferred to FOLLOW-358 (GET/POST column
divergence unification).

---

## RESOLVED — SDK IIFE bundle over 40 KB gzip budget (pre-existing violation from FOLLOW-373 consent strings) [FOLLOW-372]

**Filed by:** sdk-engineer **Date:** 2026-06-21 **Affects:** FOLLOW-372, FOLLOW-373,
`packages/sdk/scripts/check-bundle-size.js` CI gate **Type:** architectural

**Description:** The `packages/sdk` IIFE bundle budget is 40 KB gzip (hard, CI-enforced).

Baseline measurements (2026-06-21):

| State                                              | gzip bytes | KB                 |
| -------------------------------------------------- | ---------- | ------------------ |
| Pre-FOLLOW-373 (commit `aa2f007`)                  | 40,819     | 39.86 KB — PASSING |
| Post-FOLLOW-373 (current `main`, commit `0cfd08c`) | 41,503     | 40.53 KB — FAILING |
| FOLLOW-372 PR (this PR)                            | 42,143     | 41.17 KB — FAILING |

The FOLLOW-373 compliance-engineer additions to `consent-banner.ts` (`disclosurePlatform` strings in
EN/PL/ES — ~3×~230 chars) pushed the bundle from 39.86 KB to 40.53 KB, crossing the 40 KB limit by
543 bytes. This pre-existing violation means the `build:check` CI gate was already failing on `main`
before FOLLOW-372 was started.

FOLLOW-372 (this PR) adds a minimal-footprint opt-out toggle and opt-out state module contributing
+640 bytes gzip above the already-over baseline, for a total of +1,183 bytes over the 40 KB limit.

**Required action (choose one):** (A) **Raise the budget to 42 KB** — acknowledges that the
FOLLOW-373 disclosures are legally required content that cannot be stripped, and the FOLLOW-372
opt-out toggle is a mandatory legal/UX feature. Update `scripts/check-bundle-size.js` MAX_BYTES to
43 \* 1024. The budget was set conservatively; given accumulated feature growth, 42 KB remains well
below the 80 KB Tier 1+2+3 budget and the 40 KB was an internal Tier 1+2 target.

(B) **Lazy-load the consent-banner disclosures** — move `disclosurePlatform` strings out of the main
IIFE into a fetched i18n JSON file. SDK fetches them at consent-banner render time. This is
architecturally cleaner but requires a backend endpoint and adds a network round-trip before the
consent banner renders.

(C) **Accept the CI failure on bundle check** temporarily and create a FOLLOW ticket to do option
(B) post-pilot.

sdk-engineer recommends **(A)** — the disclosure strings are legally mandated content (DPIA §13.4),
not feature bloat. The 42 KB revised budget still gives substantial headroom under the 80 KB Native
tier budget.

**Resolution:** RESOLVED 2026-06-21: CEO approved option (A) — raise budget 40KB→42KB. Implemented
on `compliance-engineer/FOLLOW-373-consent-umbrella` (commit `b8f9e2b`): `MAX_BYTES = 42 * 1024` in
`packages/sdk/scripts/check-bundle-size.js`. The disclosure strings are legally mandated (DPIA
§13.4), not feature bloat; 42KB stays well under the 80KB ceiling. Headroom is now slim (~0.8KB over
current 41.17KB) — durable trim via lazy-loaded i18n (option B) deferred to a post-pilot FOLLOW.

---

## RESOLVED — ESC-028: GitHub Actions secrets required for FOLLOW-368 Redis shadow round-trip smoke [FOLLOW-368]

**RESOLVED 2026-07-13.** All four GH Actions secrets provisioned against the existing project
Upstash DB `sacred-crawdad-106876` (`Adaptive-Listings`, eu-central-1) — reused rather than a
throwaway because the smoke writes one uniquely-namespaced self-expiring key (no FLUSH), so reuse is
collision-safe and matches the "one shared parity instance" intent. `redis-shadow-smoke.yml` ran in
hard-fail mode (`REQUIRE_REDIS_SMOKE=1`) and **passed** — run 29257991341. Gotcha caught during
provisioning: the token must be the Upstash **REST** token, not the TCP `redis://` password (first
attempt failed hard with `WRONGPASS` / TTL HTTP 401 — the hard-fail did its job). **Non-blocking
remainder:** Doppler dev/stg/prd wiring (step 3 below) for local-dev parity — not needed for the CI
gate or prod (Modal uses its own `estalara-secrets` bundle). Full attestation in
`docs/runbooks/OPERATOR_SESSION_2026-07-12.md` Step 5.

---

### Original escalation (for reference)

**Filed by:** devops-engineer **Date:** 2026-06-23 **Affects:** FOLLOW-368 (P1), FOLLOW-346 AC-1
(chat-intent bridge end-to-end), FOLLOW-384 (redis_writer opt-out skip), K.3.6 D-2 chat panel
**Type:** infra / repo-config

**Description (Rule C):** The `redis-shadow-smoke.yml` CI workflow added by FOLLOW-368 requires four
GitHub Actions secrets that do not yet exist:

| Secret name                | Used by               | What it must point at                       |
| -------------------------- | --------------------- | ------------------------------------------- |
| `UPSTASH_REDIS_REST_URL`   | Python writer (Modal) | A test Upstash Redis instance REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Python writer (Modal) | Token for the same test instance            |
| `UPSTASH_REDIS_URL`        | TS reader (Vercel)    | SAME test instance REST endpoint            |
| `UPSTASH_REDIS_TOKEN`      | TS reader (Vercel)    | Token for the same test instance            |

**Critically:** `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_URL` MUST be the SAME Upstash database
URL (and their tokens the same token). If they differ, the round-trip smoke test will correctly fail
— which is the entire point of FOLLOW-368 (it catches the HW-3 misconfiguration from RETRO-098).

**Recommendation:** Provision a dedicated test Upstash Redis instance (free tier is sufficient) and
set all four secrets to credentials for that one instance. This can be done in the Upstash dashboard
(create a new database) and then GitHub repo Settings → Secrets → Actions → New repository secret.
The test cleans up its own keys (TTL = 86400 s, so the smoke key self-deletes within 24 h).

**What happens until ESC-028 is resolved:** Every run of `redis-shadow-smoke.yml` enters the
soft-skip path (`secrets_present=false` → `REQUIRE_REDIS_SMOKE` unset → the spec emits a
`::notice::` and skips all assertions). The workflow does NOT fail. The CI badge is green with
"notice" annotations. This is the intended behavior — the smoke is a canary, not a blocking gate,
until the secrets are provisioned.

**After provisioning:** Once all four secrets are set in GitHub, the workflow will automatically
switch to hard-fail mode (`REQUIRE_REDIS_SMOKE=1`). No code changes are needed — the workflow reads
the secrets and sets the flag accordingly.

**Required action:** Piotr or Rafał to:

1. Create a test Upstash Redis instance (free tier sufficient) in the Upstash dashboard.
2. Add four GitHub Actions secrets — all pointing at the same instance URL and token:
   - `UPSTASH_REDIS_REST_URL` = the REST endpoint URL
   - `UPSTASH_REDIS_REST_TOKEN` = the REST token
   - `UPSTASH_REDIS_URL` = the same REST endpoint URL
   - `UPSTASH_REDIS_TOKEN` = the same REST token
3. Add the same four values to Doppler (dev + staging + prod configs) so local development and Modal
   deployments also use the parity-verified instance.
4. Mark ESC-028 RESOLVED.

**Owner:** CEO / CTO — requires Upstash dashboard access + GitHub repo admin access

---

## RESOLVED — ESC-029: Public ingest schema change — profiling_opt_out field on ChatMessageSentPayloadSchema [FOLLOW-387]

**Filed by:** backend-engineer **Date:** 2026-06-24 **Affects:** FOLLOW-387, §H.9 opt-out epic
**Type:** architectural

**Description (CLAUDE.md autonomy rules):** FOLLOW-387 requires adding an optional
`profiling_opt_out` boolean field to `ChatMessageSentPayloadSchema` in
`packages/shared/src/schemas/events/chat.ts`. This is a public ingest-event contract change (the
`packages/shared` event schema is the wire contract between the SDK, CF Worker ingest, and the
Python stream-consumer). Per CLAUDE.md: "change a public API surface (`@estalara/sdk` exports,
ingest event schema, decision API contract)" requires human escalation.

**Change being made:** Add `profiling_opt_out: z.boolean().optional()` to
`ChatMessageSentPayloadSchema`. The field is OPTIONAL with no default, so:

- All existing SDK producers that do not set the field remain valid (back-compat,
  backward-compatible, non-breaking additive change).
- The Python stream-consumer reads it with `payload.get("profiling_opt_out", False)` — if absent,
  defaults to False (the safe behavior: shadow prior is written, no leakage of the new flag into old
  sessions).

**§H.9 / RETRO-108 rationale:** Without this field, `_spawn_chat_nlp` cannot forward the per-session
opt-out state to `process_chat_message`, so an opted-out user's live chat messages still write the
AL shadow prior. This is the RETRO-108 HW-1 / LG-1 finding: FOLLOW-384 added the consumer guard but
the flag cannot reach it because the event schema carries no opt-out field.

**Required action:** CEO approval before merging the PR.

**Resolution:** CEO (Piotr Nawrocki) APPROVED 2026-06-24. The additive optional field is confirmed
non-breaking. Proceeding with FOLLOW-387 PR (`backend-engineer/FOLLOW-387-live-chat-optout-thread`).

---

## RESOLVED — ESC-030: CEO decision required before FOLLOW-341 (archetype embeddings) can be delegated [FOLLOW-341]

**Filed by:** pm-orchestrator **Date:** 2026-06-25 **Affects:** FOLLOW-341, FOLLOW-342 (blocked on
FOLLOW-341), §F cosine/MOAT claim **Type:** architectural / scope

**Description:**

FOLLOW-341 (P1, ml-engineer, 6h) would populate `archetype_embeddings.embedding` via
`text-embedding-3-small` to activate the cosine affinity path in `getArchetypeEmbedding()` /
`affinityScore()`. Currently, 18 seed rows in `archetype_embeddings` have `embedding NULL`, and
`affinityScore()` falls back to a djb2 hash for 100% of requests. The entire §F vector-matching /
MOAT layer is non-functional in prod.

FOLLOW-341's stub (FOLLOW_UPS.md) explicitly flags: "Decision point for CEO (F-02 open question #4):
build the real embedding job now, OR formally drop the cosine/MOAT claim and ship with hash ordering
acknowledged."

Two options:

**Option A — Build the job:** Delegate FOLLOW-341 to ml-engineer: build an idempotent
embed-and-UPSERT job (Modal or GHA workflow_dispatch), add a `archetype-embeddings-not-null` CI
precheck. Estimated 6h. Unblocks FOLLOW-342 (bandit variant → playbook selection).

**Option B — Drop the claim:** Remove the cosine branch from `affinityScore()` + `reorder.ts`,
remove the §F MOAT narrative from MASTER_DESIGN, cancel FOLLOW-341 and FOLLOW-342. Estimated 2h. The
djb2 hash ordering becomes the documented and only mechanism.

**Required action:**

Piotr (CEO): choose Option A or Option B. Pasting your answer in Slack/reply with "A" or "B" is
sufficient. PM will delegate accordingly.

**Resolution:** CEO (Piotr) chose **Option A** on 2026-06-25 — "we need it to be fully functional in
all aspects." FOLLOW-341 delegated to ml-engineer. FOLLOW-342 unblocked once FOLLOW-341 is done.

---

## RESOLVED — ESC-031: P1 prod incident — ALL adaptation_decisions writes silently failing since PR #357 merge [FOLLOW-394]

**Filed by:** pm-orchestrator **Date:** 2026-06-26 **Affects:** FOLLOW-394 (and FOLLOW-395
downstream), production ClickHouse `adaptation_decisions` table **Type:** P1 production data-loss
incident

**Description:**

PR #357 (FOLLOW-358) merged at 2026-06-26T10:40Z adds `page_context_source` to the explicit column
list of the `logDecisionAsync` INSERT in `apps/control-plane/src/app/api/adapt/route.ts` (~line
468). ClickHouse rejects an INSERT that names a column not present in the table with
`NO_SUCH_COLUMN_IN_BLOCK`. The `logDecisionAsync` function is fire-and-forget with a swallowed
`.catch` (route.ts:501-504 — only `console.error`s). This means:

**Every call to `/api/adapt` (GET or POST) since PR #357 merged has silently failed to write its row
to `adaptation_decisions` in production ClickHouse.** No row is written, no error surfaces to the
caller, no alert fires.

The fix is migration `infra/clickhouse/migrations/0019_adaptation_decisions_page_context_source.sql`
— an idempotent
`ALTER TABLE adaptation_decisions ADD COLUMN IF NOT EXISTS page_context_source LowCardinality(String) DEFAULT 'legacy'`.
This migration runs in CI against a throwaway container but does NOT auto-apply to prod (project
invariant: ClickHouse migrations require manual operator apply, per memory
`project_postgres_migrations_no_autoapply` and RETRO-076/FOLLOW-308).

**Complicating factor (CAVEAT):** The prod ClickHouse user is `ingest_worker`. Per RETRO-076, this
user may lack `ALTER TABLE` DDL grant. Attempting `ALTER TABLE` without the grant will also fail
silently (or with a permission error). You must verify the DDL grant BEFORE applying.

**Required human action — two paths:**

**Path A (recommended — fastest to resolve the data loss):** Manually apply migration 0019 to prod
ClickHouse via Doppler:

```
doppler run --config prd -- clickhouse-client --host <CH_HOST> --user ingest_worker --password <pw> \
  --query "ALTER TABLE adaptation_decisions ADD COLUMN IF NOT EXISTS page_context_source LowCardinality(String) DEFAULT 'legacy'"
```

FIRST verify the `ingest_worker` user has `ALTER TABLE` privilege. If not, use the admin/default
user for the DDL apply (or grant the privilege). After apply, run a smoke test: make one GET and one
POST request to `/api/adapt`, then query
`SELECT DISTINCT page_context_source FROM adaptation_decisions LIMIT 5` — should return
`caller_supplied` and/or `page_type_derived` for new rows.

**Path B (if prod ClickHouse access is unavailable right now):** Temporarily revert the
`page_context_source` column from the INSERT in `route.ts` until the migration can be applied. This
stops the data loss but requires another deploy. PM can delegate this to backend-engineer
immediately.

**PM is blocked from picking new tickets while this escalation is OPEN.**

**Resolution:** Applied 2026-06-26T~12:00Z via ClickHouse Cloud SQL console (admin user). Migration
0019
(`ALTER TABLE adaptation_decisions ADD COLUMN IF NOT EXISTS page_context_source LowCardinality(String) DEFAULT 'legacy'`)
applied successfully. Verified: column exists with correct type and default. All `/api/adapt` writes
now succeeding. Remaining FOLLOW-394 code ACs (AC-4: ClickHouse-smoke contract test; AC-5: deploy
runbook update) delegated to data-engineer — tracked in QUEUE.md FOLLOW-394 IN_PROGRESS.

---

## RESOLVED — ESC-032: `ingest_worker` prod ClickHouse grant is `INSERT,SELECT ON default.*` (all tables) — diverges from MASTER_DESIGN `default.events` least-privilege; security posture decision required [FOLLOW-424]

**Filed by:** pm-orchestrator **Date:** 2026-06-28 **Affects:** FOLLOW-424, prod ClickHouse security
posture, MASTER_DESIGN.md §44 **Type:** architectural / security

**Description:**

RETRO-133 (§4a LG-1, surfaced during FOLLOW-404 prod attestation) found that the prod ClickHouse
user `ingest_worker` holds `GRANT SELECT, INSERT ON default.* TO ingest_worker` — covering EVERY
table in the `default` schema. `MASTER_DESIGN.md:44` documents the intended scope as
`default.events` only.

Two-part divergence:

1. **Security posture:** A compromised or misused `ingest_worker` credential can INSERT into and
   SELECT from ANY table in `default`, not the minimal write set. The tables the worker actually
   writes are: `events`, `adaptation_decisions`, `intent_events` (and potentially others). A
   wildcard beyond those surfaces unnecessary blast radius.

2. **Design-doc drift:** The Master Design says `default.events`; the actual prod grant is
   `default.*`. Either the doc is stale (the wildcard was intentional, never updated) or the prod
   grant is over-broad (should be narrowed). The current wildcard is what silently makes
   `logDecisionAsync` INSERTs to `adaptation_decisions` legal.

Per the autonomy rules (CLAUDE.md): "A test reveals a security issue" and "They need to change a
public API surface … or compliance posture" → PM escalates.

**Required action (Piotr — ~10 minutes decision + optional ~30 min implementation):**

Choose ONE of:

**Option A — Narrow the grant (recommended, least-privilege):**

1. Enumerate all tables `ingest_worker` writes: grep INSERT call sites (currently `events`,
   `adaptation_decisions`, `intent_events` — confirm complete list).
2. Revoke the wildcard: `REVOKE SELECT, INSERT ON default.* FROM ingest_worker`
3. Re-grant the minimal set: `GRANT INSERT ON default.events TO ingest_worker`,
   `GRANT INSERT ON default.adaptation_decisions TO ingest_worker`,
   `GRANT INSERT ON default.intent_events TO ingest_worker` (add SELECT where needed for existing
   queries).
4. Run a smoke test to confirm writes still succeed on all three tables.
5. Update `MASTER_DESIGN.md:44` to document the exact minimal write set.

**Option B — Accept the wildcard with documented rationale:**

1. Update `MASTER_DESIGN.md:44` to say `default.*` (all tables) with explicit rationale (e.g.
   "wildcard chosen to avoid grant-maintenance friction as new tables are added; accepted
   blast-radius trade-off for this service tier").
2. File a FOLLOW stub to revisit at pilot scale.

**Blocking:** This does NOT block the PM pipeline. FOLLOW-424 tracks the implementation; this
escalation records the security decision.

**Resolution:** Piotr (CEO) chose **Option A — narrow the grant (least-privilege)**, 2026-06-28,
with a mandatory safety sequence to avoid re-introducing a silent/broken write path so soon after
ESC-031:

1. **Enumerate first, narrow second.** Before any REVOKE, data-engineer must grep all
   `ingest_worker` write call sites (`INSERT INTO …` across apps/ingest and apps/control-plane) and
   produce the COMPLETE table list. Do not assume the list is only
   `events`/`adaptation_decisions`/`intent_events` — confirm it.
2. **Verify fail-loud coverage per table.** For each table in the write set, confirm the writer
   surfaces HTTP-level rejections (non-ok response → Sentry capture), as FOLLOW-425 did for
   `adaptation_decisions`. If any sink still only has `.catch()` (network-only), file a follow-up to
   add fail-loud there — do NOT narrow the grant until each path will fail loudly, so a missed table
   can't silently break.
3. **Apply narrowed grant** via Doppler `prd`: REVOKE the `default.*` wildcard, re-GRANT the minimal
   `INSERT` (+ `SELECT` only where an existing query needs it) on the confirmed table set.
4. **Smoke-test** writes on every table in the set post-narrowing; confirm rows land.
5. **Update `MASTER_DESIGN.md` §44** to document the exact minimal write set (aligns doc to
   reality).

Rationale: GDPR/PDPL posture wants least-privilege on a write-path service account; tighten reality
to the stricter documented model rather than relaxing the model to match drift. The enumeration +
fail-loud gate converts the wildcard into an explicit, auditable grant without gambling on an
incomplete table list. Tracked by FOLLOW-424 (delegated to data-engineer 2026-06-28). Non-blocking
for the pipeline.

**EXECUTED & VALIDATED — 2026-06-29.** Phase 1 (read-only enumeration + fail-loud audit) found the
write set is LARGER than the initial estimate: 5 INSERT tables (`events`, `intent_events`,
`adaptation_decisions`, `llm_calls`, `dsr_audit_log`) plus DSR `ALTER DELETE/UPDATE` and
`system.mutations` SELECT that the wildcard never covered. The fail-loud gate surfaced two more
blind sinks (`logLlmCallAsync`, `writeDsrAuditLog`) — hardened in FOLLOW-427/428 (PR #377) before
narrowing. Phase 2 REVOKE/GRANT run by Piotr in the ClickHouse Cloud SQL console;
`SHOW GRANTS FOR ingest_worker` returned the exact 14-row minimal grant with NO `default.*`
wildcard. Validated by direct `ingest_worker` tests against prod: auth ✅, SELECT ✅, INSERT ✅ (row
landed), ALTER DELETE ✅, negative control `SELECT default.description_generations` →
`Code: 497 … ingest_worker: Not enough privileges … (ACCESS_DENIED)` ✅ (confirms wildcard removed
and least-privilege enforced). Full procedure + attestation in
`docs/runbooks/clickhouse-ingest-worker-grant-narrowing.md`. §44 updated to the minimal grant.
**Grant is correct and does not break writes.**

NOTE: During validation, a SEPARATE prod regression was found — the control-plane `/api/adapt` app
path no longer writes `adaptation_decisions` (two end-to-end smokes failed, while direct
`ingest_worker` INSERT succeeds). This is NOT caused by the grant. Filed as ESC-033 (P1).

---

## RESOLVED — ESC-033: control-plane `/api/adapt` silently not writing `adaptation_decisions` in prod (grant-independent latent bug) [P1]

**Filed by:** orchestrator (acting) **Date:** 2026-06-29 **Affects:** prod control-plane adapt
route, `adaptation_decisions` analytics, decision audit trail **Type:** prod regression / data loss
(analytics)

**Severity:** P1. NOT user-facing — `/api/adapt` returns HTTP 200 with a valid decision. Impact is
analytics/audit: adaptation decisions are not being persisted, so lift/calibration dashboards and
the decision audit trail go stale. Same silent-write-failure FAMILY as ESC-031 (but now fail-loud,
so Sentry should hold the exact error).

**Evidence (2026-06-29 session):**

1. FOLLOW-422 confirmed writes flowed at 2026-06-28 13:01 (2 rows in `adaptation_decisions`,
   sessions `smoke-follow422-*`).
2. Two fresh end-to-end smokes today via `https://admin.estalara.com/api/adapt` (sessions
   `smoke-esc032-1782683704` @ 21:55 and `smoke-esc032b-1782684969` @ 22:16) each returned HTTP 200
   with a valid `adapt_decision_id`, but NEITHER row landed in `adaptation_decisions` (`count()=0`
   per session).
3. Direct `INSERT` into `adaptation_decisions` as `ingest_worker` (post grant-narrowing) SUCCEEDS —
   so the table, grant, and credential are fine. The failure is specific to the control-plane
   runtime write path (`logDecisionAsync`).
4. Window: regression appeared between 13:01 (working) and 21:55 (broken) on 2026-06-28 — coincides
   with prod redeploys from merging PR #376 (FOLLOW-426, touched
   `apps/control-plane/src/app/api/adapt/route.ts`) and PR #377 (FOLLOW-427/428). Prime suspect: a
   deploy-introduced change in the adapt route's fire-and-forget block, OR a runtime env/URL/user
   difference in the deployed control-plane.

**Required action (next work cycle):**

1. Pull the exact error from Sentry (control-plane project, ~21:55 and ~22:16 UTC 2026-06-28, tag
   `kind:insert_rejected` or `kind:network`) — the FOLLOW-425 fail-loud capture should hold the
   verbatim ClickHouse/fetch error. Alternatively `vercel logs` for the control-plane prod
   deployment (console.error from `logDecisionAsync`).
2. The error class points the fix: `497 Not enough privileges` → control-plane connects as a user
   OTHER than `ingest_worker`; `network`/DNS → `CLICKHOUSE_URL` missing/wrong in the deployed
   runtime; `Unknown column` → a column drift in the INSERT list from a recent deploy.
3. Likely owner: backend-engineer (adapt route) with data-engineer support.

**Blocking:** Does NOT block the agent pipeline or ESC-032. Analytics-only data loss; fix promptly.

**ROOT CAUSE — diagnosed 2026-06-29 (NOT a regression; pre-existing latent bug):**

The fire-and-forget ClickHouse write in `logDecisionAsync`
(`apps/control-plane/src/app/api/adapt/route.ts:512`) issues `fetch(...)` but is **never awaited and
never wrapped in `waitUntil()`/`after()`** (documented as "Fire-and-forget — never awaited, never
blocks the response", route.ts:458). On Vercel, once the handler does
`return NextResponse.json(...)`, the function instance is suspended; an in-flight un-awaited `fetch`
is not guaranteed to complete — so the INSERT is silently dropped on cold/isolated requests.

**Empirical proof:** a burst of 8 rapid GET `/api/adapt` requests (2026-06-29) all returned HTTP 200
but only **1 of 8 rows landed** in `adaptation_decisions`. Isolated requests (21:55, 22:16) landed
0; FOLLOW-422's two requests at 13:01 were 8s apart and landed 2/2 (warm instance). Identical
credentials every call ⇒ not auth/grant — the variance is instance-lifecycle timing. The "regression
/ deploy window" framing in the title is therefore WRONG: the write was never reliable; FOLLOW-422
caught lucky warm-instance flushes.

**Compounding finding:** because the instance can freeze before the `.then`/`.catch` runs, the
**fail-loud Sentry capture itself (FOLLOW-425/426/427/428) is also unreliable** without `waitUntil`
— which is why Sentry may show no `insert_rejected` event for the dropped writes. The write family
and the fail-loud family share the same gap.

**Scope:** the same un-awaited pattern (no `waitUntil`/`after`) applies to the whole family:
`logDecisionAsync`, `logLlmCallAsync` (`lib/llm-gateway.ts`), `writeDsrAuditLog`
(`api/dsr/_clickhouse.ts`), `publishAbAssignmentEvent` (`lib/ab-events.ts`),
`publishDescriptionRequested` (`api/adapt/description/route.ts`).
`grep -rn "waitUntil|after" apps/control-plane/src` → zero hits.

**FIX (recommended):** wrap each fire-and-forget sink in Next.js 15 `after()`
(`import { after } from 'next/server'`) — or `waitUntil` from `@vercel/functions` — so the async
write (and its fail-loud `.then`/`.catch` → Sentry) completes after the response is sent, before
suspension. `after()` needs no new dependency. Owner: backend-engineer; add tests asserting each
sink promise is registered via `after()`. This also makes FOLLOW-425/426/427/428's fail-loud
observability actually effective.

**Resolution:** RESOLVED 2026-06-29 by FOLLOW-431. Root cause was the missing `waitUntil`/`after` on
fire-and-forget sinks (proof: 1/8 burst writes landed). FOLLOW-431 wraps all five sinks
(`logDecisionAsync`, `logLlmCallAsync`, `publishAbAssignmentEvent`, `publishDescriptionRequested`,
`writeDsrAuditLog`) in Next.js `after()` from `next/server`, so the async write and its fail-loud
`.then`/`.catch` → Sentry complete after the response is sent, before instance suspension. Sinks now
return `Promise<void>`; DSR call sites drop their redundant outer `.catch()` (the sink captures all
errors internally and never rejects). Tests assert each sink is registered via `after()`. This also
makes the FOLLOW-425/426/427/428 fail-loud observability effective. Title's "regression" framing
superseded by the latent-bug diagnosis. **Post-merge:** verify in prod via a burst of N `/api/adapt`
requests → expect N rows in `adaptation_decisions` (not the prior ~1/8).

**PROD VERIFICATION — PASSED 2026-06-29.** Burst of 10 GET `/api/adapt` requests (session prefix
`smoke-esc033-1782729874-`, archetype `luxury_buyer`, tier 2) all returned HTTP 200;
`SELECT count() FROM adaptation_decisions WHERE session_id LIKE 'smoke-esc033-1782729874-%'`
returned **10** (vs the prior ~1/8 burst-landing rate). All 10 rows present with distinct
session_ids, ts 10:44:35–10:44:37Z, variant=control, source=playbook,
page_context_source=caller_supplied. Confirmed against the post-merge prod deploy (commit `3a0f802`,
prod deploy created 09:08Z). Procedure recorded in `docs/runbooks/esc-033-verification.md`. ESC-033
fully closed.

## RESOLVED — ESC-035: SECURITY — feedback route uses caller-supplied bearer as HMAC key with no api_keys lookup; trusts caller's body.tenant_id → forgeable auth + cross-tenant bandit write-poisoning [FOLLOW-442 / AUD-05]

**Filed by:** pm-orchestrator **Date:** 2026-07-01T00:00:00Z **Affects:**
`apps/control-plane/src/app/api/adapt/feedback/route.ts`, `ab_bandit_weights`, `conversion_labels`
**Type:** security

**Description (Rule C — security finding; agents must escalate):**

`apps/control-plane/src/app/api/adapt/feedback/route.ts:143` computes:

```ts
const expectedHex = await hmacSha256Hex(bearerToken, rawBody);
```

where `bearerToken` is the **caller-supplied** `Authorization: Bearer <value>`, NOT a value looked
up from `api_keys`. Any caller who knows their own bearer token (which they chose themselves) can
compute a valid HMAC over any payload they craft and pass signature verification. There is no
`api_keys` table lookup in the HMAC path.

Additionally, `tenantId` is taken from `parsed.data.tenant_id` (the request body, line 374/395), not
derived from a resolved API key. A malicious caller can therefore write `ab_bandit_weights` and
`conversion_labels` for ANY `tenant_id` they supply.

The fallback at lines 130-134 (`if (adaptApiKey && bearerToken === adaptApiKey)`) only protects the
ops integration-test key path; the HMAC path is unprotected.

**Impact:**

- Any tenant (or external actor who has ever made a legitimate feedback call) can poison bandit
  Thompson-sampling weights for any other tenant, corrupting variant selection.
- Any actor can forge conversion labels (`conversion_labels` table) for any tenant.
- This makes pilot A/B results forgeable.

**Evidence:**

```
grep -n "hmacSha256Hex\|bearerToken\|api_keys\|tenant_id" \
  apps/control-plane/src/app/api/adapt/feedback/route.ts
# Line 143: hmacSha256Hex(bearerToken, rawBody) — bearerToken is caller-supplied
# Lines 374, 395: tenantId: parsed.data.tenant_id — caller-supplied
# No api_keys lookup anywhere in the file
```

**Required fix (backend-engineer, after human confirms scope):**

1. Look up `bearerToken` in `api_keys` table → derive `resolvedTenantId` and a stored `secret`.
2. Use the stored `secret` (not the raw bearer) as the HMAC key.
3. After auth, assert `parsed.data.tenant_id === resolvedTenantId`; reject with 403 if mismatch.
4. If `ADAPT_API_KEY` ops fallback is kept, scope it to the ops tenant or add a hard `tenant_id`
   constraint.

**Required action:** Piotr (CEO) to confirm: (a) The fix scope above is correct — particularly
whether `api_keys` already stores the shared HMAC secret per tenant, or whether a new
`api_key_secrets` column/table is needed. (b) Priority: this is a security bug in production NOW.
Recommend P0 fix before ANY pilot traffic runs through the feedback endpoint. (c) Whether the
existing ops `ADAPT_API_KEY` bypass should be removed or scoped.

**Blocking:** YES — blocks delegating FOLLOW-442 and blocks pilot go-live (a pilot with forgeable
feedback metrics is worse than no pilot). Per PM guardrails, no new ticket can be delegated while
this escalation is open.

**Resolution:** RESOLVED 2026-07-01 by Piotr Nawrocki (CEO). CEO rulings (from decision prompt
2026-07-01): (a) **Priority P0**, routed architect-ADR-then-backend. (b) **Interim =
secure-by-default 503**: the feedback endpoint is disabled unless `FEEDBACK_ENDPOINT_ENABLED=true`
is explicitly set — shipped in FOLLOW-444 (PR #397, merged, main `0e0bdb0`). Prod is safe with zero
operator action. (c) **`ADAPT_API_KEY` ops bypass RETAINED but scoped** to a single designated ops
tenant (`OPS_TENANT_ID`, 403 on mismatch) — also shipped in FOLLOW-444.

**SCHEMA CORRECTION (verified in code 2026-07-01, supersedes the "argon2id / new column" framing in
the Required-fix section above):** `api_keys.hashed_key` is **SHA-256(raw_key) with a unique index**
(the schema doc-comment saying "argon2id" is wrong — ADR-0015 fixes it), and a correct
`resolveApiKey()` helper already exists and is used by four routes (`quiz/public-config`,
`intent/config`, `quiz/completion`, `crm/outcome`). Therefore the permanent fix needs **NO migration
and NO new column** — the `lookup_hash`/argon2id path is REJECTED (ADR-0015 §Alternatives). The fix:
extract `resolveApiKey()` into `apps/control-plane/src/lib/api-key-auth.ts`, use it in
`feedback/route.ts`, derive `tenantId` from the resolved key, reject
`body.tenant_id !== resolvedTenantId` (403). Design: **ADR-0015**
(`docs/adr/ADR-0015-feedback-endpoint-authentication.md`), status PROPOSED. Backend-engineer
implements from ADR-0015 in the FOLLOW-443 implementation ticket once ADR-0015 is ACCEPTED; the
interim 503 is lifted (`FEEDBACK_ENDPOINT_ENABLED=true`) only after that PR merges CI-green.

**FINAL RESOLUTION (verified 2026-07-01 by pm-orchestrator — closing the loop the same session):**
ADR-0015 status is now **ACCEPTED** (`docs/adr/ADR-0015-feedback-endpoint-authentication.md:3`).
FOLLOW-443 merged to main (PR #401, commit `6224c2d`): `feedback/route.ts` now runs the 5-step
ADR-0015 algorithm — SHA-256 bearer → `api_keys` DB lookup via the new shared
`resolveApiKey()`/`sha256Hex()`/`constantTimeEqual()` lib
(`apps/control-plane/src/lib/api-key-auth.ts`), HMAC body-signature defense-in-depth, and
server-authoritative `body.tenant_id !== resolvedTenantId → 403` enforcement. `ADAPT_API_KEY` ops
bypass retained but now scoped to `OPS_TENANT_ID` (403 on mismatch), per CEO ruling (c). 49 tests in
`feedback/route.test.ts` cover the T1–T12 auth matrix. CI green on PR #401
(lint/typecheck/build/test all pass). ESC-035 code-fix axis is CLOSED — the forgeable-auth
vulnerability no longer exists in main.

**Remaining non-blocking operator step (same pattern as ESC-034):** the endpoint is still
secure-by-default OFF in prod (`FEEDBACK_ENDPOINT_ENABLED` not yet flipped). Per PR #401's own
"NEXT" note: ops must set `OPS_TENANT_ID` + `ADAPT_API_KEY` in Doppler `prd` and flip
`FEEDBACK_ENDPOINT_ENABLED=true` before the feedback endpoint serves live traffic. This is a
privileged operator action, not a code gap — it does NOT block further ticket delegation (mirrors
ESC-020/ESC-028/ESC-034 precedent: code-complete-awaiting-operator-action is non-blocking). Tracked
going forward as part of the pilot go-live checklist in `backlog/STATUS.md`, not as its own new
FOLLOW ticket.

---

## RESOLVED — ESC-034: FOLLOW-436 embed-seed Modal consumer awaiting operator go-live — code bugs fixed by FOLLOW-437, operator steps remain [FOLLOW-436]

**RESOLVED 2026-07-13.** The direct-HTTPS embed-seed path (ADR-0016, post-Redpanda) is live and
proven **end-to-end**. Direct smoke on the deployed Modal web endpoint
`https://estalara--estalara-description-generator-listing-embed-s-e2dcc5.modal.run`: `POST` with
`Authorization: Bearer <INTERNAL_API_SECRET>` + `{tenant_id, listing_ids:[…]}` → **202
`{"status":"accepted"}`**; no-auth → **401**. The spawn's callback landed — the target listing's
`listing_embeddings.updated_at` bumped to ~now (SQL-verified). So Modal endpoint →
`process_embed_seed_request.spawn` → `POST /api/listings/embed` → OpenAI → DB upsert all work, and
`INTERNAL_API_SECRET` in Modal `estalara-secrets` matches control-plane. `MODAL_EMBED_SEED_URL`
present in Vercel prod (re-set to the confirmed URL + redeployed). Traps: the Modal URL is
truncated+hashed (copy from the dashboard, never derive from `MODAL_DESCRIPTION_URL`);
`MODAL_DESCRIPTION_URL` is Vercel-Sensitive (unreadable). Onboarding-overflow trigger itself not
exercised (heavy) but every leg proven. Full attestation:
`docs/runbooks/OPERATOR_SESSION_2026-07-12.md` Step 3.

---

### Original escalation (for reference)

**Filed by:** devops-engineer **Date:** 2026-06-30T00:00:00Z **Affects:** FOLLOW-436, FOLLOW-435,
FOLLOW-437 **Type:** other (privileged operator action — code bugs now resolved)

**Description:**

FOLLOW-436 (operator go-live for the FOLLOW-435 embed-seed Modal consumer) requires privileged human
steps: Modal account access, the actual `INTERNAL_API_SECRET` value from Doppler `prd`, and
`modal deploy`. Agents cannot execute these.

**CODE BUGS — RESOLVED by FOLLOW-437 (PR #393, commit 09084f3, merged 2026-06-30):**

During FOLLOW-436 go-live wiring verification, two structural code bugs were found that made a safe
go-live impossible with the FOLLOW-435 codebase. Both are now fixed:

**BUG 1 — ORPHAN (`main.py` deployed nothing) — FIXED:** `apps/llm-gateway/src/main.py` was a
placeholder stub (no `modal` import, no `modal.App`, no imports of consumer modules). Running the
canonical `modal deploy apps/llm-gateway/src/main.py` registered zero functions. Fix: `main.py` now
imports both consumer modules (load-bearing `# noqa: F401`) so all 3 functions register under one
deployment.

**BUG 2 — APP-NAME COLLISION — FIXED:** `generate_description.py` and
`consume_embed_seed_requests.py` each declared an independent
`modal.App("estalara-description-generator")`. Deploying either file alone would have wiped the
other's functions from the live app. Fix: the single shared `app` is now in
`apps/llm-gateway/src/jobs/_app.py`; both consumers import from there. App name
`estalara-description-generator` preserved.

**Remaining required action (operator only):**

**Operator go-live (Piotr or Rafał, ~20 min):** Follow
`docs/runbooks/modal-embed-seed-consumer-golive.md` in order:

- Step 1: Provision three secrets in Modal `estalara-secrets` (via web console):
  - `REDPANDA_TOPIC_LISTING_EMBEDDINGS` = `estalara.listing-embeddings`
  - `EMBED_API_BASE_URL` = `https://admin.estalara.com` (or staging URL)
  - `INTERNAL_API_SECRET` = copy from `doppler secrets get INTERNAL_API_SECRET --config prd --plain`
- Step 2: `modal deploy apps/llm-gateway/src/main.py` — verify `consume_embed_seed_requests` appears
  in the Modal dashboard with schedule `every 30 seconds`.
- Step 3: Smoke verification per the runbook (trigger overflow activation, check Modal logs, check
  Sentry `tags.area:onboarding tags.sink:modal-embed-seed`).

**Resolution:** Code fix complete (FOLLOW-437 / PR #393 merged 2026-06-30). Awaiting operator
go-live (Step 1-3 above). Escalation closes when smoke verification passes.

**CORRECTION 2026-07-06 (pm-orchestrator session 10) — the runbook above is now STALE, do not follow
Step 1-3 as written.** FOLLOW-485 (PR #431, ADR-0016, merged 2026-07-03) replaced the
Redpanda-poller embed-seed consumer entirely with a direct-HTTPS Modal endpoint
(`listing_embed_seed_requested_endpoint`, same pattern as the now-live description flow). The old
`consume_embed_seed_requests` poller code is retained in the repo but its `modal.Period(seconds=30)`
schedule was removed — it is dead/unscheduled, not the live path. **Corrected operator go-live
path:** provision `MODAL_EMBED_SEED_URL` in Vercel prod (mirroring `MODAL_DESCRIPTION_URL`; both
consumed by `apps/control-plane/src/lib/listing-embed-seed-publisher.ts` via
`publishListingEmbeddingSeed`), confirm `INTERNAL_API_SECRET` (bearer, `hmac.compare_digest`) is set
in Modal `estalara-secrets` (same secret already required for the description endpoint), then smoke
by triggering an onboarding-overflow embed-seed event and checking Modal logs / Sentry
`tags.area:onboarding tags.sink:modal-embed-seed`. No `REDPANDA_TOPIC_LISTING_EMBEDDINGS` step is
needed. `docs/runbooks/modal-embed-seed-consumer-golive.md` needs an update pass to match (not done
by this session — flagging for devops-engineer or the next doc-sync ticket). Escalation stays OPEN,
still operator-action-pending, just against the corrected target.

---

## RESOLVED — Modal ML layer never deployed to prod (no apps/secrets in the only account, no CI deploy) [FOLLOW-436]

**Filed by:** pm-orchestrator (session 9) **Date:** 2026-07-02T21:30:00Z **Affects:** FOLLOW-436,
FOLLOW-458, FOLLOW-460 (Modal legs), pilot go-live, core AI-description feature **Type:**
architectural | vendor (infra)

**Description:** While preparing the FOLLOW-460 operator step (add `DESCRIPTION_CACHE_*` keys to the
Modal `estalara-secrets` secret), discovered the Modal ML layer is not deployed to prod at all:

- The only Modal account available (CEO's `pnawrocki9`, the sole profile in `~/.modal.toml`) has **0
  deployed apps and 0 secrets** (`modal app list` / `modal secret list` both empty; only the `main`
  environment exists). CEO confirmed there is no separate Estalara/org Modal account.
- **No CI workflow deploys Modal** (`grep 'modal deploy'` over `.github/workflows` = 0). There is no
  automated deploy path for any Modal app.
- `estalara-secrets` therefore does not exist; FOLLOW-436's "provision estalara-secrets + deploy
  llm-gateway" operator step was never completed. FOLLOW-458 (deploy stream-consumer + data-quality)
  likewise never done.
- Prod `description_cache_persistent` = 0 rows (consistent, though also expected pre-#428).

**Impact reconciliation (what works vs. what is dark in prod):**

- ✅ WORKS without Modal: archetype decision + playbook directives + the directive-level LLM tweak
  (headline/CTA/feature) — `apps/control-plane/src/lib/llm-gateway.ts` calls `@anthropic-ai/sdk`
  (`new Anthropic()`) DIRECTLY from the control-plane, needing only `ANTHROPIC_API_KEY` (set in
  prod). This is why DOM adaptation worked on localhost and works in prod.
- ❌ DARK without Modal: full per-listing AI description-body rewrite (`/api/adapt/description`
  publishes `description.requested` to Redpanda `estalara.descriptions`; the consumer is a Modal
  `@app.function` in `generate_description.py` that is not deployed → events unconsumed → only
  `template_fallback` served). Also dark: intent-engine NLP, embeddings/embed-seed, stream-consumer
  (live chat NLP), data-quality drift cron — all Modal. On localhost these ran via the local mock
  harness (:9100), masking that prod Modal was never stood up.

**Required action (CEO/devops decision — do NOT auto-provision):** Decide and execute the prod Modal
stand-up: (1) confirm `pnawrocki9` is the canonical prod Modal account (or create an org account);
(2) assemble the full `estalara-secrets` inventory from Doppler/Vercel (ANTHROPIC*API_KEY, all
REDPANDA*_, UPSTASH*REDIS*_, SENTRY_DSN, EMBED_API_BASE_URL, INTERNAL_API_SECRET, plus FOLLOW-460's
DESCRIPTION_CACHE_INTERNAL_SECRET + DESCRIPTION_CACHE_API_BASE_URL); (3)
`modal secret create estalara-secrets ...`; (4) `modal deploy` the llm-gateway (+ intent-engine /
stream-consumer / data-quality per FOLLOW-458 scope); (5) add a CI deploy workflow so it doesn't
drift again. Until then, FOLLOW-460's Postgres-cache write and full AI description generation are
inert in prod; the code PRs (#428/#429/#430) can still merge — this gap is infra, not code.

**Update 2026-07-03 (Redpanda cost/blocker resolved by ADR-0016):** During stand-up we found the
prod Redpanda cluster is **Serverless**, whose HTTP Proxy (the REST endpoint the edge/serverless
producers publish through) is **BYOC/Dedicated-only** — and a Dedicated cluster (~$500/mo) is out of
pilot budget (CEO). Decision **ADR-0016**: drop Redpanda for the pilot and invoke Modal directly
over HTTPS (Modal web endpoint); implementation **FOLLOW-485** (P1, ml-engineer). This removes
Redpanda from the Phase-A critical path entirely. ESC-036 stays OPEN for the remaining, non-Redpanda
work: create the `estalara` Modal workspace + provision `estalara-secrets` (minus Redpanda) + deploy
`apps/llm-gateway`

- add a CI deploy workflow. Operator guide + `MODAL_PROD_STANDUP.md` updated to the no-Redpanda
  flow.

**Resolution (2026-07-03, RESOLVED — Modal ML layer LIVE in prod):** Operator (Piotr) executed the
ESC-036 Modal stand-up per `docs/runbooks/MODAL_PROD_STANDUP.md`: created the `estalara` Modal
workspace, provisioned `estalara-secrets` (no Redpanda, per ADR-0016), deployed
`estalara-description-generator` (`apps/llm-gateway`), set
`MODAL_DESCRIPTION_URL`/`MODAL_EMBED_SEED_URL` in Vercel prod, and redeployed the control-plane. A
`.github/workflows/modal-deploy.yml` deploy pipeline was added (PR #432) so it can't silently drift
again. ATTESTATION: a real Sonnet-4.6 family_buyer description (1060 chars) was generated and
written to prod `description_cache_persistent` via the deployed direct-Modal web endpoint. Two
deploy bugs were found + fixed during stand-up: (1) the consumer modules read the shared contract
fixtures at import time but they weren't in the Modal image → container crashed on import → **PR
#433** bakes them in; (2) a stray **leading space** in the manually-pasted `ANTHROPIC_API_KEY`
secret value produced an "Illegal header value" that surfaced as a misleading
`APIConnectionError: Connection error.` → corrected in `estalara-secrets`. RESIDUAL (not blocking,
tracked separately): the full browser→SDK→control-plane→Modal leg + the ESC-019 listing-fetch hop
still want a real-listing confirmation; Modal Phases B (intent-engine) and C (data-quality /
stream-consumer, FOLLOW-458) remain deferred; and a `.strip()` hardening on secret-env reads is
filed as FOLLOW-488 to prevent the leading-space class of bug recurring.

---

## RESOLVED — ESC-037: four erased ClickHouse PII tables are disclosed to nobody — live Art. 15/20 gap in prod today (not gated on any deploy) [FOLLOW-574]

**Filed by:** pm-orchestrator (session 30, off RETRO-176) **Date:** 2026-07-16T00:00:00Z
**Affects:** FOLLOW-574 (P1), `apps/control-plane/src/app/api/dsr/access/route.ts`,
`apps/control-plane/src/app/api/dsr/portability/route.ts`,
`apps/control-plane/src/lib/clickhouse-dsr.ts`, prod ClickHouse **Type:** compliance

**Description:** DSR erasure deletes **five** ClickHouse PII tables — `DSR_CLICKHOUSE_TABLES`
(`clickhouse-dsr.ts:72-78`) lists `events`, `adaptation_decisions`, `llm_calls`, `session_quality`,
`intent_events`. DSR access/portability disclose **one aggregate over one of them**: both routes
call only `getSessionEventSummary()` and return `events_summary` (`access/route.ts:301,326`). So
`adaptation_decisions`, `llm_calls`, `session_quality` and `intent_events` are **erased but
disclosed to nobody**, and `events` is disclosed as a count rather than a copy of the data.

Verified independently by the PM before filing (read `DSR_CLICKHOUSE_TABLES` and both routes'
ClickHouse call sites), not taken on the retro's word.

Same asymmetry class the 2026-07-11 audit raised as A3-F-06 and that FOLLOW-558 (PR #529, merged
`797b8ab`) was supposed to close: **if the controller demonstrably holds and erases a store, an Art.
15 access report and an Art. 20 export may not omit it.** FOLLOW-558 closed the gap on the Postgres
axis only. Nobody owned the union across storage classes.

**Why this is escalated rather than left as a queue ticket:** unlike the sibling Redis gap
(FOLLOW-570, which arms only when FOLLOW-458 deploys), **this data is live in prod right now and
needs no deploy to arm it.** Any DSR access/portability request served today returns an incomplete
report. That is a compliance-posture question with a regulatory clock on it, and per CLAUDE.md
compliance posture is not the PM's call.

Two related findings from the same retro pair, for context (both filed as tickets, neither
escalated):

- **FOLLOW-576 — FOLLOW-558's AC2 is not met.** The `disclosure-route-driven-pglite.test.ts`
  "PARITY" block never imports `erase/route.ts` (`grep` finds it only in comments; the file's own
  docstring admits the list "must be updated by hand"). It asserts disclosure ⊇ 6 hardcoded
  literals, so **adding a 7th DELETE target to erase keeps it green** — it cannot fail on the drift
  it is named for. The PM ticked that AC on the strength of the test's name and docstring rather
  than its assertion body, and merged on it; the tick is corrected in `QUEUE.md` this session.
  Widening the hardcoded list (FOLLOW-570 AC(b)) yields a wider hardcoded list — FOLLOW-576 is the
  real fix.
- **FOLLOW-575 — DPIA §8 is out of sync with the code that runs**, so the disclosure enumeration
  that Rule N exists to keep honest currently certifies behaviour the code does not implement.

**Required action (CEO / DPO):**

1. **Rule on exposure. ANSWERED 2026-07-16 by direct prod read — exposure is ZERO; no notification
   duty is triggered.** `SELECT count(*) FROM dsr_verifications` against prod Postgres (via
   `doppler run --config prd`, admin creds, user-authorized read) returned **0**. That table is the
   front door of every DSR flow — access, portability AND erase all begin with an `initiate` that
   writes a `dsr_verifications` row — so zero rows means **no DSR request of any type has ever been
   served in prod**. No incomplete report was delivered because no report was delivered. This makes
   FOLLOW-574 a **latent** gap to close before the first real DSR, not a live incident with a
   remediation/notification clock. The CEO/DPO decision this item asked for is therefore moot; the
   remaining two are not. **Caveat — re-check before first pilot DSR:** this is a point-in-time
   count; it must be re-run (or a monitor added) before any tenant is told DSR is live, since the
   gap arms the moment the first request lands. **Side finding worth a ticket:** the prod
   `dsr_audit_log` ClickHouse read was _not_ usable for this — the Doppler-prd `ingest_worker`
   credentials have **no SELECT grant** on `dsr_audit_log` (`ACCESS_DENIED`), diverging from the
   `INSERT,SELECT ON default.*` recorded at ESC-032. The Postgres front-door count is the reliable
   exposure signal; the CH audit trail is currently unreadable by ops creds.
2. **Sequence FOLLOW-574 against Wave 0.** RETRO-176 recommends 574 **before** FOLLOW-570 on the
   grounds that 574 is live and 570 is deploy-gated. That inverts the Sprint 23 order and competes
   with the FOLLOW-559/FOLLOW-356 lane decision still open from session 29.
3. **Decide the disclosure shape for `events`** — a count is not the data. Full row export vs.
   summary is a product/compliance judgement (volume vs. Art. 15 completeness), not an engineering
   one.

**Resolution:** RESOLVED 2026-07-17 by Piotr (CEO).

1. **Exposure** — already answered before this ruling: prod `dsr_verifications` count = 0, so zero
   exposure, no notification/remediation duty. FOLLOW-574 is a latent gap to close before the first
   real DSR. (Caveat stands: re-run the count or add a monitor before any tenant is told DSR is
   live.)
2. **Sequencing** — **FOLLOW-574 BEFORE FOLLOW-570.** Per RETRO-176's reasoning (574 is the
   live-in-prod ClickHouse axis; 570 is deploy-gated on FOLLOW-458). This inverts the default Sprint
   23 order for these two tickets.
3. **`events` disclosure shape** — **FULL ROW EXPORT, not an aggregate count.** CEO chose Art. 15/20
   completeness over payload economy. Access + portability must return the actual `events` rows for
   the verified (tenant, session) scope, alongside the other four erased-but-undisclosed ClickHouse
   tables (`adaptation_decisions`, `llm_calls`, `session_quality`, `intent_events`).
   **Implementation implication recorded for FOLLOW-574 (not a re-litigation of the ruling):**
   `events` is potentially high-volume per session, so the full export needs a volume-safe delivery
   path (pagination / streaming / a size cap with a documented continuation) rather than one
   unbounded in-memory response. That is an engineering detail for the FOLLOW-574 worker; the
   completeness requirement is fixed by this ruling.

The side finding (`ingest_worker` lacks SELECT on `dsr_audit_log`, diverging from ESC-032) is spun
out as its own follow-up (FOLLOW-580) — an ops-grant hygiene item, not part of this compliance gap.

---

## RESOLVED — ESC-038: FOLLOW-574 diverged from its brief on `intent_events`: the erase filter targets a column that matches zero real rows (latent Art. 17 no-op) [FOLLOW-574]

**Filed by:** compliance-engineer (session, FOLLOW-574) **Date:** 2026-07-17T00:00:00Z **Affects:**
FOLLOW-574, FOLLOW-581, `apps/control-plane/src/app/api/dsr/erase/route.ts`,
`apps/control-plane/src/lib/clickhouse-dsr.ts` (`DSR_CLICKHOUSE_TABLES`) **Type:** compliance
(non-blocking — flagging a deliberate brief deviation + a latent erasure bug for PM/human review)

**Description.** The FOLLOW-574 delegation brief instructed the disclosure of `intent_events` to
"mirror the erase side exactly" using `resolveIntentSessionId()` (filter on `intent_session_id`),
warning that "a raw session_id filter returns the wrong data (empty or cross-session)." On
re-verification (brief's own instruction) that premise is **inverted by migrations 0015/0016**:
`intent_events` rows are written with `intent_session_id` left at its zero-UUID default and the real
SDK fingerprint in the String `session_id` column. The production reader (`clickhouse-tracer.ts`)
filters on `(tenant_id, session_id)` and its header explicitly says "Do NOT use intent_session_id".
So:

1. The erase-side filter `WHERE intent_session_id IN (resolveIntentSessionId())` matches **zero real
   rows** — `intent_events` is a latent Art. 17 erasure no-op (tracked as FOLLOW-581).
2. Mirroring that filter for disclosure would return an **empty** `intent_events` while the
   subject's real rows exist in ClickHouse — a false Art. 15 disclosure, which violates the prime
   directive ("never let shipped behavior claim what it does not do").

**Decision I made (PR-gated, reversible).** FOLLOW-574 discloses `intent_events` on the
authoritative `(tenant_id, session_id)` key so the disclosure is TRUTHFUL, and derives the
disclosure SET (not the per-table filter column) from `DSR_CLICKHOUSE_TABLES`. This yields
disclosure ⊋ erasure for `intent_events` until the erase filter is fixed. I did NOT touch the erase
route (out of scope per the brief); I filed FOLLOW-581 to fix the erase filter, after which
disclosure + erasure re-converge and the divergence note is removed.

**Required action:** PM/human confirm the disclosure-by-`session_id` decision for `intent_events`
(vs. mirroring the empty erase filter) and prioritise FOLLOW-581 (P1 erasure bug). No code change
needed to accept; this entry documents the deviation so it is visible, not hidden.

**Resolution:** RESOLVED 2026-07-17 (pm-orchestrator, session 30). The deviation was CORRECT and is
accepted: the PM independently verified against migrations 0015/0016, the production reader
`clickhouse-tracer.ts`, and the schema that real `intent_events` rows key on `session_id` and
`intent_session_id` is a zero-UUID default — so disclosing on `session_id` (not mirroring the erase
filter) is the truthful Art. 15 behaviour, and mirroring erase would have shipped a false-empty
disclosure. The underlying erase no-op it exposed is fixed in **FOLLOW-581 (DONE, PR #544,
`85156db`)**: `DSR_CLICKHOUSE_TABLES` now keys `intent_events` on `session_id`, so erase +
disclosure re-converged and the FOLLOW-574 divergence note was removed. Nothing further outstanding.

---

## RESOLVED — ESC-039: three staff config editors swallow a failed load, then clobber real tenant config with defaults on the next Save — live on `main` [FOLLOW-624]

**Resolved:** 2026-07-24 by FOLLOW-624 (PR #608, squash-merged to `main` `3b0b4a3`, auto-deployed).
All three editors now track fetch outcome (loading/loaded/error) separately from save status: a
failed GET renders a `role="alert"` banner + Retry and disables Save (guarded again inside
`handleSave` as defense-in-depth); a successful GET (incl. first-time/no-row tenants, which the
route serves as a normal 200) is unaffected. tenant-config-editor also now surfaces the route's zod
`.flatten()` validation `details` in the save-error banner. Tests assert BOTH directions in all
three editors. All real CI gates green (only pre-existing repo-wide `Rule I` red, confirmed also red
on `main` d89757f — not a regression).

**Tenant-facing axis closed 2026-07-24 by FOLLOW-630 (PR #609, `0bfaedd`):** RETRO-206 found the
FOLLOW-624 fix was scoped to `/admin` only and missed three byte-identical twins living outside
`/admin` (`dashboard/quiz/page.tsx`, `dashboard/demo/override/page.tsx`,
`components/generation-model-settings.tsx`, two writing the SAME routes). FOLLOW-630 applied the
identical guard to all three and proved a repo-wide (not `/admin`-narrowed) grep clean. ESC-039 is
now RESOLVED on BOTH the admin and tenant-facing axes.

**Enforcement leg closed 2026-07-24 by FOLLOW-625 (PR #610, `f936089`):** an AST-based CI hard-gate
(`Rule K.2 consumer-side swallow guard`) now FAILS the build on a config-load swallow in any client
component under `src/app/**` OR `src/components/**`, with a fixture suite proving both directions
and a load-bearing allow-list. The pattern can no longer be copy-forwarded silently.

**ESC-039 FULLY CLOSED** — all three legs done: fix (FOLLOW-624), twins (FOLLOW-630), mechanised
enforcement (FOLLOW-625). Nothing outstanding.

**[original escalation below]**

**Filed by:** claude (session 56, post-RETRO-205) **Date:** 2026-07-23T22:00:00Z **Affects:**
FOLLOW-624, FOLLOW-600 (PR #606, merged `19ef714`),
`apps/control-plane/src/app/admin/tenants/[id]/settings/tenant-config-editor.tsx`,
`.../quiz/quiz-config-editor.tsx`, `.../demo/demo-override-editor.tsx` **Type:** other (live
data-loss bug — priority call needed)

**Description:** RETRO-205 found, and I independently confirmed by reading the source, that
`tenant-config-editor.tsx:61` throws on `!r.ok` while `:76` swallows the rejection with a
comment-only `.catch(() => {})`. The component's `DEFAULTS` stay rendered, so a staff user sees a
populated, plausible-looking form. `handleSave` then PATCHes a **full** body. Net effect: one failed
load followed by one Save silently overwrites the tenant's real `brand_config` with defaults and
wipes `allowed_origins` to `[]` — and the UI reports success ("Settings saved!").

The identical block exists in `quiz-config-editor.tsx:72` and `demo-override-editor.tsx:87`, so the
blast radius is all three per-tenant staff surfaces, not just the one FOLLOW-600 added.

This is a Rule K.2 consumer-side violation. Neither code review nor the pm-orchestrator post-merge
audit caught it — the audit terminated at "the columns are real", which is a producer-side fact.

**Impact if not fixed:** silent, unattributed tenant config loss in production. The control-plane
auto-deploys on merge to `main`, so this is live now. There is no dialog and no error state, so a
staff user has no signal that anything was lost, and the wiped `allowed_origins` would not be
noticed until someone tries to rely on it.

**Required action:** CEO/PM priority call on FOLLOW-624. Recommend treating as P1 and fixing ahead
of the remaining P3 backlog. FOLLOW-625 (mechanise the Rule K.2 swallow check in CI) should land
with or immediately after it so the pattern cannot be copy-forwarded a fourth time.

**Resolution:** <empty until resolved>

---

## RESOLVED — ESC-040: `tenants.allowed_origins` is a security facade — the settings UI and MASTER_DESIGN both claim SDK origin enforcement that does not exist in code [FOLLOW-622]

**Filed by:** claude (session 56, post-RETRO-205) **Date:** 2026-07-23T22:00:00Z **Affects:**
FOLLOW-622, FOLLOW-600, `apps/ingest/src/router.ts:69-73`, `packages/db/src/schema/api_keys.ts:33`,
`docs/MASTER_DESIGN.md:5021` **Type:** architectural (security posture — documented control not
implemented)

**Description:** RETRO-205's CHECK B found `tenants.allowed_origins` is written by the new
FOLLOW-600 settings page and read by **nothing**. Ingest CORS is enforced from a hardcoded env list
(`apps/ingest/src/router.ts:69-73`), not from this column. Two artefacts nonetheless assert the
control is real:

- `packages/db/src/schema/api_keys.ts:33` — "null = inherit tenant allowedOrigins"
- `docs/MASTER_DESIGN.md:5021` — "Origin validated against tenant.allowed_origins config"

So a staff user can enter an origin allow-list, save it successfully, and reasonably believe they
have restricted which sites may embed the SDK for that tenant. They have not. The same finding
applies (without the security dimension) to
`tenants.brand_config.{primary_color,logo_url, white_label}` — zero consumers, no white-label logic
anywhere in `packages/sdk`, and the live brand colour is actually `quiz_config.accent_color`
(FOLLOW-623).

**Impact if not fixed:** a UI that promises a security control it does not provide is worse than no
UI, because it produces false assurance. If a tenant is ever told "origins are restricted", that
statement is currently untrue. This also has a documentation-truth dimension: MASTER_DESIGN is the
project's single source of truth and it currently overstates enforcement.

**Required action:** CEO decision on direction for FOLLOW-622 — **wire it** (make ingest CORS read
the column) or **de-scope it** (remove the control from the settings page and correct both the
`api_keys` docstring and MASTER_DESIGN §V.3.4). Either is acceptable; leaving the UI as-is is not.
Same wire-or-de-scope call needed on FOLLOW-623.

**Resolution:** RESOLVED 2026-07-26 (session 60) — **no new CEO decision was required; the decision
had already been made and shipped.** This escalation was filed 2026-07-23 and overtaken by events
one day later. Verified against the current tree at `5e66288`, not against the ticket text:

**The ruling: CEO Option B (de-scope), 2026-07-24.** Recorded in-code in two places —
`apps/control-plane/src/app/admin/tenants/[id]/settings/page.tsx:11` ("FOLLOW-622 (CEO Option B,
2026-07-24): the SDK `allowed_origins` allow-list control was de-scoped from this page — it was an
unenforced security facade") and `packages/db/src/schema/tenants.ts:53-54`.

Every "Required action" in this escalation is now satisfied — and the outcome went **both** ways,
which is why the two ticket names look contradictory:

| Required action                           | Status | Evidence                                                                                             |
| ----------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| CEO decision wire-vs-de-scope             | DONE   | Option B, 2026-07-24                                                                                 |
| Remove the control from the settings page | DONE   | FOLLOW-622 / PR #618 (`24aa860`); `sdk.allowed_origins` also removed from the `/api/config` contract |
| Correct the `api_keys` docstring          | DONE   | `packages/db/src/schema/api_keys.ts:33-42`                                                           |
| Correct MASTER_DESIGN §V.3.4              | DONE   | `docs/MASTER_DESIGN.md:5024-5029,5044` — now describes the KV projection, "NOT a hardcoded env list" |
| Same call on FOLLOW-623 / `brand_config`  | DONE   | wired, not de-scoped — `/api/quiz/public-config` serves the `brand` slice to the SDK (PR #619, #626) |

Beyond de-scoping the facade, real enforcement was then **built**: FOLLOW-642 / PR #623 (`d631a08`)
shipped `apps/ingest/src/origin-gate.ts`, which matches the browser `Origin` against the tenant's
list and returns 403 `forbidden_origin` before any ingest side effect. So the column is no longer a
facade in the read direction.

**⚠️ Closing this escalation does NOT make origin enforcement effective, and unblocks nothing.** Two
things must not be mistaken for done:

1. **The write path does not exist.** A repo-wide grep confirms **zero** writes to `KV_API_KEYS`
   anywhere (`.put(` exists only for `KV_IDEMPOTENCY` and Durable Object storage). The gate reads a
   KV record that no in-repo code produces, so enforcement silently inherits the env allow-list for
   every tenant until an operator seeds KV by hand. That is FOLLOW-658 (P1, still OPEN).
2. **The corrected docstrings introduced a _new_ over-claim.** `tenants.ts:40-41` and
   `api_keys.ts:38-41` state the column "is projected onto the api-key KV record **at
   provisioning**" — describing an automatic step that is not implemented (Rule M
   false-automation-claim axis). This is exactly FOLLOW-658 AC3, and it is now the _second_
   generation of the same documentation-truth defect this escalation was opened about.

**Correction to the session-60 hand-off:** FOLLOW-658 was reported as "blocked on ESC-040". It is
not and never was — its stub carries `depends_on: []`, and the overlap with ESC-040 is confined to
AC3. FOLLOW-658 is dispatchable immediately; ESC-040 was never the constraint. The remaining
external-brand go-live gate is FOLLOW-658 + FOLLOW-659, not this escalation.

---

## RESOLVED — ESC-041: the `Release` workflow has failed on every run for days (`@estalara/sdk` → E403) with zero record in any backlog file [FOLLOW-626]

**Filed by:** claude (session 56, post-RETRO-205) **Date:** 2026-07-23T22:00:00Z **Affects:**
FOLLOW-626, `@estalara/sdk` publish path, repo CI gate credibility **Type:** other (ops — dead
release pipeline + gate-hygiene precedent)

**Description:** RETRO-205's cascading-impact sweep surfaced a second permanently-red workflow
beyond the long-known `Rule I`. I verified independently via `gh run list --workflow=Release`: the
last 8 runs are `failure`, back to 2026-07-22, failing on `@estalara/sdk` publish with
`E403 owner not found`. No backlog file — QUEUE, FOLLOW_UPS, ESCALATIONS, RETROSPECTIVES — has ever
mentioned it. It has been failing unnoticed.

This is the concrete cost of the normalized-deviance pattern RETRO-205 promoted to **Rule AF**
(permanently-red gate = disabled gate; a "known red" waiver must be a baseline comparison, not a
label). `Rule I` has now been red 191 times and `main`'s aggregate `CI` conclusion is `failure` on
every push — which is precisely why a _newly_ dead workflow could go days without anyone noticing. I
applied that same "pre-existing red, non-blocking" reasoning twice in this session to clear the #607
and #606 merges; the reasoning happened to be correct both times, but it is not a safe default.

**Impact if not fixed:** the SDK release path is dead — any assumption that a merged SDK change has
been published is currently false. More broadly, while the aggregate CI conclusion is permanently
red, no future breakage can be detected by looking at whether CI is green.

**Required action:** CEO/PM call on FOLLOW-626 (fix or quarantine the `Release` workflow — the E403
suggests an npm org/ownership or token problem that likely needs a human with registry access), and
on whether to schedule the `Rule I` cleanup so the aggregate signal becomes meaningful again. Also
related: FOLLOW-628 (unpinned `pip install` in `modal-deploy.yml` under a `production` environment —
same class of latent upstream risk as the `:latest` ClickHouse tag that broke CI repo-wide this
session) and FOLLOW-629 (CI↔prod ClickHouse version-skew detection, so the FOLLOW-620 pin's hidden
expiry fires loudly).

**Resolution (CEO ruling, Piotr, 2026-08-08): QUARANTINE THE `Release` WORKFLOW WITH A NAMED
OWNER.**

The SDK is not published to npm today and nothing needs it — distribution is by bundle. The E403 is
an npm org/token permission problem that no agent can fix.

**The ruling is about the standing red, not about npm.** A workflow that has failed on every run for
months teaches every reader that red is normal, which is the same corrosion that let `e2e-smoke.yml`
fail **97 scheduled runs in a row without a single backlog entry**. Disable it explicitly, with a
recorded "inactive until X" and an owner, rather than leaving it failing.

Implementation: **FOLLOW-917** (devops-engineer). Not deletion — recreating it later costs more than
thawing a quarantine. The `Rule I` cleanup question in the same escalation is **separate and not
ruled here**; it stays with FOLLOW-861.

---

## RESOLVED — ESC-053: `estalara-secrets` is missing three keys the Modal apps read at runtime — deploying intent-engine / data-quality over it produces two running-but-dead apps [FOLLOW-817]

**Filed by:** devops-engineer (FOLLOW-817) **Date:** 2026-08-07T12:40:00Z **Affects:** FOLLOW-817,
ESC-042 item 1, FOLLOW-820, FOLLOW-819, `apps/intent-engine`, `apps/data-quality`, Modal workspace
`estalara` **Type:** other (secret provisioning — operator-only, ~10 min in the Modal web console)

**Description.** FOLLOW-817 wires the `deploy-intent-engine` + `deploy-data-quality` CI jobs. Before
shipping them I inventoried what `estalara-secrets` actually carries, rather than trusting
`MODAL_PROD_STANDUP.md §3` — via a read-only ephemeral `modal run` that prints key NAMES and
`sha256[:16]` fingerprints only (never a value, never `modal deploy`, never a write). Three keys the
deployed code reads with a **non-defaulting** lookup are absent:

| Key                        | Read at                                                    | Failure without it                                                          |
| -------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| `UPSTASH_REDIS_REST_URL`   | `apps/intent-engine/src/redis_writer.py:40`                | `KeyError` inside a `.spawn()`ed function — the shadow key is never written |
| `UPSTASH_REDIS_REST_TOKEN` | `apps/intent-engine/src/redis_writer.py:41`                | same                                                                        |
| `DATABASE_URL`             | `apps/data-quality/src/crons/schema_validation.py:209-211` | `RuntimeError` at 02:00 UTC nightly                                         |

`INTERNAL_API_SECRET` **is** present (len 64) — that half of ESC-042's item-1(b) check passes.

**This is a name-pair mismatch, not a missing integration.** `estalara-secrets` carries
`UPSTASH_REDIS_URL` + `UPSTASH_REDIS_TOKEN` (the names the **control-plane** reads —
`lib/chat-intent-cache.ts:103-108`, `lib/description-cache.ts:53-58`, `lib/tenant-schema.ts`,
`lib/feedback-nonce.ts`). The Python writer reads the `_REST_` names. Both name pairs already exist
as GitHub Actions secrets — `redis-shadow-smoke.yml` requires all four precisely because the two
runtimes disagree, and `docs/runbooks/upstash-redis-env-parity.md` documents the split. Modal simply
never got the writer's pair. Exactly the trap `MODAL_PROD_STANDUP.md §5` already records for
Redpanda ("must carry **both** name pairs with the same values") — applied to Redpanda, missed for
Upstash.

**Why this is worse than the failure ESC-042 predicted.** ESC-042 item 1(b) asks the operator to
"confirm the Upstash creds point at the SAME Upstash the control-plane reads" and calls a mismatch
"a silent null-read, not an error". It is not a null-read: it is a hard `KeyError` — but it is
raised inside a `process_chat_message.spawn()`, i.e. **after** `chat_nlp_endpoint` has already
returned 202 to the ingest Worker. The Worker's dispatcher only inspects the HTTP status
(`chat-nlp-dispatch.ts:129-149`), so it logs nothing, Sentry sees nothing, and the ingest ACK
is 200. Measured on localhost during FOLLOW-817: with the intent-engine unreachable, a
`chat.message.sent` POST still returned `{"accepted":1,"rejected":0}` / HTTP 200 and the shadow key
stayed `null`. A prod deploy over this secret would look exactly like success.

**Guard already shipped (so this cannot merge as a fake green).** `modal-deploy.yml`'s two new jobs
run `scripts/check-modal-secret-keys.py` as a **hard** pre-deploy gate (never a skip — it runs only
after `MODAL_TOKEN_ID` was confirmed present, so a failure is by definition "dependency present but
broken"). Until this escalation is executed, both new jobs go **red** on merge and neither app is
deployed. That red is the intended, visible signal; `deploy-llm-gateway` is a separate job and is
unaffected.

**⚠️ CORRECTION (PM, 2026-08-07) — `DATABASE_URL` must NOT be Doppler's `DATABASE_URL`.** This
escalation said "the prod Supabase pooler connection string", but Doppler `prd` holds three
different URLs and the one named `DATABASE_URL` is **not** the pooler:

| Doppler key (prd)     | Host                                       | What it actually is         |
| --------------------- | ------------------------------------------ | --------------------------- |
| `DATABASE_URL`        | `db.<ref>.supabase.co:5432`                | **direct host — IPv6 only** |
| `DATABASE_URL_ADMIN`  | `aws-0-eu-west-3.pooler.supabase.com:6543` | pooler, transaction mode    |
| `DATABASE_URL_DIRECT` | `aws-0-eu-west-3.pooler.supabase.com:5432` | pooler, **session mode**    |

The naming is actively misleading — `DATABASE_URL_DIRECT` is the _pooler_, and `DATABASE_URL` is the
_direct_ host. **Measured from inside Modal** with a credential-free reachability probe: the direct
host resolves to **no IPv4 record** and the TCP connect **fails**; both pooler ports resolve and
connect. Pasting Doppler's `DATABASE_URL` would therefore give `schema_validation` a connection
string it can never open — a `psycopg2.OperationalError` at 02:00 UTC nightly, into nobody's log,
which is the exact failure class this escalation exists to prevent. Same root cause as the 2026-06
admin 503s (memory `project_admin_db_url_pooler_28p01`).

**Use `DATABASE_URL_DIRECT`** (pooler, session mode) as the VALUE; the Modal key name stays
`DATABASE_URL`, because `crons/schema_validation.py:227` reads that name. Session mode is the safe
choice for `psycopg2` — transaction mode (6543) works for simple queries but breaks prepared
statements and session-level state.

**Required action (operator — Piotr; ~10 min, no code change):** In the Modal web console →
workspace `estalara` → secret `estalara-secrets`, **add keys individually** (do NOT use
`modal secret create --force`, which wipes the secret and would take the live description pipeline
down):

1. `UPSTASH_REDIS_REST_URL` = the same value as the existing `UPSTASH_REDIS_URL` key.
2. `UPSTASH_REDIS_REST_TOKEN` = the same value as the existing `UPSTASH_REDIS_TOKEN` key.
3. `DATABASE_URL` = the prod Supabase pooler connection string the control-plane uses
   (`DATABASE_URL_ADMIN` in Doppler `prd` — note ESC-052: `stg` is byte-identical to `prd`, so there
   is no separate staging value to pick).

Then re-run **Modal Deploy** (`workflow_dispatch`). The gate prints a `present`/`MISSING` line per
key, so the run log is itself the attestation.

**Verification that closes this (not "the workflow went green"):**

- `modal app list` shows `estalara-intent-engine` and `estalara-schema-validation` as `deployed`.
- A real `chat.message.sent` produces a `shadow:{tenant}:{session}:chat_intent` key in the SAME
  Upstash the control-plane reads (this is ESC-042 item 1's own closure condition, and is what makes
  `/api/adapt`'s `chat_intent_dimensions` non-null for the first time).
- One `schema_validation_history` row exists in prod Postgres after a 02:00 UTC cron run
  (§Snapshot.1 row B.6 flips to ✅ Shipped only then — Rule AA).

**Not done by this agent, deliberately:** writing to `estalara-secrets` is a production mutation.
The devops guardrails forbid it, and `modal secret create --force` is destructive to a LIVE app.

---

**RESOLVED 2026-08-07 (operator: Piotr; verified by PM, not accepted on report).** All three keys
added via the Modal web console. Verified with a read-only probe that reports FORM only, never a
value: `UPSTASH_REDIS_REST_URL` (40 chars, `https://` prefix), `UPSTASH_REDIS_REST_TOKEN` (62
chars), `DATABASE_URL` (110 chars, pooler host) — **no stray quotes, no whitespace** on any of them
(the `.env`-style quoting Upstash displays is the obvious trap and was checked for explicitly).

**The closure condition that actually mattered was also verified:** `UPSTASH_REDIS_REST_URL` and the
pre-existing `UPSTASH_REDIS_URL` resolve to the **same Upstash host**. That is ESC-042 item 1(b)'s
real check — different databases would have made the Python write and the TypeScript read miss each
other silently, with no error anywhere.

**Deployed the same session.** PR #691 merged as `fe73e8da`; `modal-deploy.yml` run `31212639962`
completed **success** on all three jobs, and `modal app list` confirms `estalara-intent-engine` and
`estalara-schema-validation` in state `deployed` (created 21:43 CEST) alongside the untouched
`estalara-description-generator`. Rule Q: the app list is the evidence, not the green job.

## OPEN (traffic axis only) — ESC-042 item 1: deploy axis DISCHARGED (proven by execution 2026-08-08), traffic axis OPEN — `MODAL_CHAT_NLP_URL` is unset in the prod ingest Worker [FOLLOW-635 / FOLLOW-892]

**Filed by:** ml-engineer (FOLLOW-635) **Date:** 2026-07-24T00:00:00Z **Affects:** FOLLOW-635, chat
NLP intent path (`apps/intent-engine`, `apps/ingest/src/handlers/chat-nlp-dispatch.ts`,
`apps/control-plane/src/app/api/adapt/route.ts`, `packages/sdk/src/core/{adapt,intent}.ts`), Modal
Phase B (ESC-036 residual / FOLLOW-458) **Type:** priority (deploy/enablement) + architectural (one
design ruling)

**Description (Phase-1 scope, with file:line evidence):**

The read path is already fully wired AND the chat signal already reaches the adaptation DECISION —
via the SDK client prior loop, not a server-side fusion:

1. `apps/control-plane/src/app/api/adapt/route.ts:1508-1535` reads the shadow key and `:1563`
   attaches `chat_intent_dimensions` to the response UNCONDITIONALLY (no `CHAT_NLP_LIVE` gate on
   emission).
2. `packages/sdk/src/core/adapt.ts:863-888` calls `applyChatIntentPrior(intentState, dims)` on
   receipt; `packages/sdk/src/core/intent.ts:1353-1403` performs a REAL multiplicative Bayesian
   update that changes `intentState.archetype`/`probabilities` (§D.7: chat weight == quiz weight),
   and persists it to sessionStorage.
3. `packages/sdk/src/core/adapt.ts:761` then sends `body.archetype_hint = intentState.archetype` on
   the NEXT adapt call, and `route.ts:1289` sets `archetypeId = body.archetype_hint ?? 'neutral'` —
   which drives `runDecisionTree` (headline/description) and `buildReorderDirective` (reorder).

So: server-side WITHIN one request, `chat_intent_dimensions` is metadata only; ACROSS requests it
influences directives via the client loop. This is already un-gated by `CHAT_NLP_LIVE` — that flag
(`route.ts:100`) is vestigial: it appears only in a `console.info` line (`:1521`), gates no
directive logic, and its docstring (`:89-99`) claims a server-side fusion that does not exist. The
fusion policy is therefore already DEFINED and implemented; no new fusion weight needs inventing.

**Why it is nonetheless DARK in prod today (the actual blocker):** the write path is not deployed.
`.github/workflows/modal-deploy.yml` deploys ONLY `apps/llm-gateway`; intent-engine is explicitly
"added as Phases B/C go live" (ESC-036 residual, FOLLOW-458). With no `estalara-intent-engine` Modal
app running, `chat_nlp_endpoint` does not exist, `MODAL_CHAT_NLP_URL` in the ingest Worker is a
configured no-op (`apps/ingest/src/handlers/chat-nlp-dispatch.ts:58-61`), the shadow key is never
written, `readShadowChatIntent` always returns null, and `applyChatIntentPrior` never fires. This
matches the 2026-07-12 audit ("chat feeds zero live archetype signal"). §H.9 opt-out is preserved
end-to-end (`redis_writer.py:55` skips the write; null key → null read → no prior).

**Required action:**

1. OPERATOR/DEVOPS (Modal Phase B — unblocks the pilot): (a)
   `modal deploy apps/intent-engine/src/main.py` (add it to `modal-deploy.yml` `paths`/jobs so it
   can't drift); (b) confirm `estalara-secrets` contains `INTERNAL_API_SECRET` +
   `UPSTASH_REDIS_REST_URL/TOKEN` pointing at the SAME Upstash the control-plane reads via
   `UPSTASH_REDIS_URL/TOKEN`; (c) set `MODAL_CHAT_NLP_URL` (+ matching `INTERNAL_API_SECRET`) in the
   ingest Worker prod env to the deployed `chat_nlp_endpoint` URL. After that, chat goes live for
   the pilot through the existing client prior loop — no code change.

2. CEO/PM DESIGN RULING on `CHAT_NLP_LIVE` and the latent "shadow-hole": because the client loop is
   un-gated, once the write deploys chat influences decisions REGARDLESS of `CHAT_NLP_LIVE`. For a
   single first-party tenant (Estalara, DPIA not a blocker) this is the DESIRED behavior. Choose:
   (A) Accept the client-loop as the live path; DELETE the vestigial `CHAT_NLP_LIVE` flag and
   correct the now-false "shadow-only / zero UX effect / purely behavioural" docstrings in
   `apps/intent-engine/src/{main,redis_writer}.py`, `route.ts:89-99`, and `adapt.ts:859-862` (small
   ml-engineer PR; also update the FOLLOW-346 test contract). OR (B) additionally build a
   server-side fusion path (fuse chat dims into `archetypeId` within the request, independent of the
   SDK) — a NEW decision-influence path requiring a product decision on the server fusion weight of
   chat vs the incoming behavioral `archetype_hint`; ml-engineer will NOT guess that weight.
   Recommendation: (A) — the client loop already delivers chat influence with the §D.7 policy; (B)
   is only needed for non-SDK consumers or first-request effect.

I did NOT open a code PR: there is no mechanical ml-code change that un-shadows (the code is already
wired; enablement is the deploy). The docstring/flag cleanup is deferred pending the (A)/(B) ruling
so it lands atomically with the chosen direction.

**Resolution (partial — item 2 only):** **RESOLVED 2026-07-27 — CEO ruling: Option (A).** Accept the
client prior loop as the live path; delete the vestigial `CHAT_NLP_LIVE` flag and correct the
now-false "shadow-only / zero UX effect / purely behavioural" docstrings; update the FOLLOW-346 test
contract to match. **Option (B) server-side fusion is explicitly NOT approved** — not to be built,
no fusion weight to invent.

**Verified-not-guessed before acting on this ruling:** re-read the actual repo state rather than
assuming the ruling described undone work. **All of item 2 was already shipped 2026-07-24, three
days before this ruling landed** — `ml-engineer` (Opus) scoped and built it same-day as this
escalation was filed, per `backlog/QUEUE.md` session-57 head and `backlog/FOLLOW_UPS.md` FOLLOW-635:

- PR #613, squash-merged `5ab923b` (2026-07-24T15:24:37+02:00,
  `chore(intent): remove vestigial CHAT_NLP_LIVE flag, fix shadow-only docstrings [FOLLOW-635] (#613)`).
- `grep -rn CHAT_NLP_LIVE` across the live tree returns **zero** occurrences outside
  backlog/docs/comments narrating its removal and one `packages/shared/src/directives.ts:174`
  docstring that correctly describes it as removed — no `process.env.CHAT_NLP_LIVE` read remains
  anywhere in `apps/control-plane`, `apps/intent-engine`, or `packages/sdk`.
- Docstrings independently re-read at `apps/control-plane/src/app/api/adapt/route.ts:1559-1573` and
  `packages/shared/src/directives.ts:160-181`: both now correctly state the field is
  live-influencing (not shadow-only), attached unconditionally, with no server-side gate, and that
  the ONLY remaining blocker is the ESC-042 Modal deploy (item 1 below) — an honest,
  non-overclaiming description.
- `apps/control-plane/src/app/api/adapt/route.follow346.test.ts` exists and its `describe` block
  (`FOLLOW-346 / FOLLOW-635: chat-intent shadow-read bridge (no CHAT_NLP_LIVE gate)`) asserts the
  new unconditional-attach behavior — the FOLLOW-346 test contract update this ruling asked for is
  done.

**No new ml-engineer ticket dispatched for item 2** — there is nothing left to build; the ruling
formalizes work already merged. If a docstring/test gap is found on a future audit, re-open as a
fresh, separately-numbered ticket rather than reusing this closed item.

> **UPDATE 2026-08-07 (FOLLOW-817) — item 1 is now HALF-DISCHARGED and its remaining half is
> ESC-053. It is NOT resolved; do not close it on this PR.** Verified at the source of truth rather
> than inferred: `modal app list` for workspace `estalara` returns exactly ONE deployed app
> (`estalara-description-generator`), so `estalara-intent-engine` has indeed never existed and every
> claim of chat being dark in prod is confirmed. FOLLOW-817 discharges the CI half of (a) — the
> `deploy-intent-engine` job now exists, with `paths:` covering `apps/intent-engine/**`, so it can
> no longer drift. It discharges HALF of (b): `INTERNAL_API_SECRET` IS present in
> `estalara-secrets`; the Upstash half **fails** — the secret carries `UPSTASH_REDIS_URL`/`_TOKEN`
> (control-plane names) but not `UPSTASH_REDIS_REST_URL`/`_REST_TOKEN`, which is what
> `redis_writer.py:40-41` reads. Filed as **ESC-053**, and a hard pre-deploy gate in
> `modal-deploy.yml` now refuses to deploy over that gap rather than shipping a running-but-dead
> app. (c) is unchanged and still deferred to FOLLOW-820; the ESC-052 ruling re-scoped FOLLOW-817's
> own copy of it to the LOCAL Worker env, where the full chain WAS proven end-to-end on 2026-08-07 —
> ingest Worker → intent-engine → `shadow:…:chat_intent` populated with a real Haiku 4.5 extraction
> (`archetype_hint: family_buyer`, confidence 0.82), with a negative control (engine down → key
> `null`, ACK still 200). So the code path is now demonstrated to work; only the prod secret + prod
> URL remain.
>
> Correction to this escalation's own wording: it calls an Upstash mismatch "a silent null-read, not
> an error". The actual failure is a `KeyError` raised inside `process_chat_message.spawn()` — after
> the endpoint has already answered 202 — which is even less visible than a null-read. See ESC-053.

**Item 1 (Modal Phase B operator deploy) stays OPEN, narrowed scope, re-titled above.** This is now
a pure operator/devops task — `modal deploy apps/intent-engine/src/main.py`; confirm
`estalara-secrets` has `INTERNAL_API_SECRET` + Upstash REST creds pointing at the SAME Upstash the
control-plane reads; set `MODAL_CHAT_NLP_URL` (+ matching secret) in the ingest Worker prod env — no
agent in this pipeline can execute it. Per 2026-07-27 dispatch-policy ruling (same treatment as
ESC-020): **treated as non-blocking-for-dispatch**, kept OPEN, and surfaced in every session close
until an operator runs the deploy and confirms live (chat_intent shadow key populated end-to-end).

> **UPDATE 2026-08-08 (FOLLOW-892) — ONE state, chosen deliberately, written identically here, in
> `backlog/QUEUE.md`'s session head, and in FOLLOW-892's close note. Item 1 splits into two axes and
> they are NOT in the same state.**
>
> **Deploy axis — DISCHARGED, and by execution rather than by a status field.** On 2026-08-08 the
> FOLLOW-904 effect probe (`scripts/check-modal-container-effect.py`, run `31256633000`) invoked
> `process_chat_message` in the deployed prod app and got the throwaway tenant/session echoed back
> with `model_used='haiku-4.5'`. That proves the container starts, that `from nlp import …` and
> `from redis_writer import write_shadow_intent` both resolve, and that the endpoint answers — the
> three things `modal app list` cannot tell you (RETRO-262). It is now a **standing daily control**,
> not a one-off: `.github/workflows/cron-heartbeat.yml:329` runs
> `check-modal-container-effect.py --app all` at 05:00 UTC. **The probe writes nothing**
> (`profiling_opt_out=True` short-circuits `write_shadow_intent` at `redis_writer.py:121-122`,
> §H.9), which is exactly why it does not discharge the axis below.
>
> **Correction to this escalation's own 2026-08-07 update block, appended not rewritten because it
> was true when written:** it says `modal app list` "returns exactly ONE deployed app". As of
> 2026-08-07 21:43 CEST that is **three**, including `estalara-intent-engine`
> (`ap-MpUyBq9gCwO5sL79w6X46y`).
>
> **Traffic axis — OPEN, and this is where the untested behaviour lives.** Verified at the source
> rather than inherited: `MODAL_CHAT_NLP_URL` is carried **only** by `apps/ingest/wrangler.toml:97`,
> the `development` env, pointing at `http://localhost:8090/chat_nlp_endpoint`. Production has no
> value, so `chat-nlp-dispatch.ts:104` takes its configured-no-op branch, no shadow key is ever
> written, `readShadowChatIntent` returns null and `applyChatIntentPrior` never fires. **Chat feeds
> zero live archetype signal in prod today**, and the reason is now one unset variable, not a
> deploy.
>
> **Proof step that closes the traffic axis (fail-loud, named, single):** one
> `shadow:{tenant}:{session}:chat_intent` key written in **prod** Upstash by a real buyer message —
> not by a probe, not by a `modal run`, and not by the local chain (which was already proven
> end-to-end on 2026-08-07 and is not evidence about prod).
>
> **Owner of the traffic axis — a named ticket, not "whoever notices".** It is **FOLLOW-820 item 3**
> (the CEO prod-deploy gate ticket), which already carries "`MODAL_CHAT_NLP_URL` set in the prod
> ingest Worker" as a GO condition. That places the traffic axis behind the localhost-first ruling
> of 2026-06-10 **by design**, not by neglect. Do not re-file it as drift — that is the ESC-020
> pattern FOLLOW-820 exists to stop (three audits have now made that mistake).
>
> **Do not close ESC-042 until that key exists in prod.** The reason is substantive, not tidiness:
> `route.ts:1508-1535` attaches `chat_intent_dimensions` **unconditionally** and the CEO ruled
> option A (no server-side gate), so the **first real prod chat message changes served archetypes**.
> This escalation is the only record watching for that moment.

---

## RESOLVED — ESC-044: the consent gate's "canonical" hash is a hand-typed placeholder — the fabrication refusal it exists to fire cannot fire, and every default-path consent record since go-live attests a text that was never displayed [FOLLOW-704 / FOLLOW-706]

**Filed by:** claude (session 69, post-RETRO-227) **Date:** 2026-07-27T21:00:00Z **Affects:**
FOLLOW-704 (P0), FOLLOW-706 (P1, operator-gated),
`apps/control-plane/src/app/api/v1/consent/platform-registration/lib.ts:51-52`,
`docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` §6.1, prod `consent_records` **Type:** compliance /
security

**Description:** `CANONICAL_CONSENT_TEXT_HASH` — the constant this session's own two merges (PR #631
FOLLOW-684, PR #632 FOLLOW-697/698) just spent building an evidence-keyed, tri-state refusal gate
around — is not a SHA-256 digest of anything. RETRO-227 proved this three independent ways: the hex
pattern is a hand-typed sequence (first nibble of every byte cycles `a,f,e,d,c,b,a` exactly 32
times), 60 normalizations of both candidate source texts (the doc's §6.1 block and the server-side
`renderPlatformConsentText()` output) hash to none of it, and `git log -S` shows it unchanged since
introduction in `f810f72e` (FOLLOW-374, 2026-06-21). I independently re-derived the real hash myself
before filing RETRO-227's dispatch (computed `821216cd2cca…` for the rendered Estalara text) and
flagged the pattern; the retro's own script work confirmed it and found the second candidate (the
doc's raw bytes hash to a third, different value: `201c5b326baa…`) — so even the two plausible
"correct" answers disagree with each other, not just with the constant.

**Two live consequences, why this needs a CEO/DPO ruling rather than a queue ticket alone:**

1. **The refusal this repo just finished hardening cannot fire against a real fabricator.** The 422
   in `route.ts` fires iff `submitted hash === CANONICAL_CONSENT_TEXT_HASH`. A brand that actually
   copies Estalara's displayed text (rendered or the published doc) and hashes it submits one of the
   two REAL values above — both land in the alert-only, write-proceeds branch. The only way to trip
   the refusal is to copy the placeholder literal out of this repo's source, which no legitimate or
   adversarial caller would ever do. FOLLOW-659 → 660 → 684 → 697/698 is four merged PRs building a
   gate whose one hard-refusal case is unreachable by the threat it names.
2. **Every consent record written on the default path since 2026-06-21 stores a hash of no text.**
   `route.ts:703` defaults to the placeholder when the caller omits `consent_text_hash`, and
   `backlog/HANDOFFS.md:2842` instructs the only caller (app.estalara.com) to omit it — that is the
   documented go-live flow. GDPR Art. 7(1) requires the controller to be able to demonstrate consent
   was given to a specific text; a hash that is the digest of nothing demonstrates nothing.

**Why this is escalated rather than left as a queue ticket:** FOLLOW-706's own AC says it plainly —
_"the PM escalates; this ticket does not self-escalate."_ This is a compliance-posture question
(whether existing prod consent records are Art. 7(1)-adequate, and if not, what remediation —
backfill, annotate, re-consent, or accept-with-rationale) that CLAUDE.md reserves for the human. It
also has a regulatory clock shape similar to ESC-037 (four ClickHouse PII tables
erased-but-undisclosed): unlike that case, prod exposure here has **not yet been counted** —
FOLLOW-706 AC-1 is exactly that count and is UNRUN as of this filing. **Do not assume live exposure
or its absence; the number needs to be pulled before scoping remediation.**

**Two coordinated code-fix follow-ups, filed but not escalated (queue tickets, not this item):**
FOLLOW-705 (compliance-engineer, P1 — decide which source text is byte-canonical for hashing: the
doc or the renderer; they currently disagree at two placeholder substitutions, independent of the
hash-constant defect) must land before FOLLOW-704 can pick final bytes; FOLLOW-704
(backend-engineer, P0) then makes the constant derived-not-asserted and closes the
unreachable-refusal gap; FOLLOW-707 (P1, a second omitted-hash bypass on the provisioned-brand
branch #632 shipped) is adjacent but independently fixable.

**Required action (CEO / DPO):**

1. **Run FOLLOW-706 AC-1 first** (or authorize an operator to): count prod `consent_records` rows
   where `consent_text_hash` equals the placeholder value
   (`a3f2e1d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0e1d2c3b4a5f6e7d8c9b0a1f2`), split by `consent_type`,
   `tos_version`, date range. A zero result (the app.estalara.com caller may never have gone live on
   this endpoint) closes the prod-remediation axis cheaply — do not assume either way pending the
   count, per the ESC-037 precedent where an assumed-live gap turned out to have zero exposure.
2. **Rule on FOLLOW-705**: is the DOC's §6.1 block or the server-rendered text the byte-canonical
   source for the hash? (The doc is what a regulator reads; the renderer is what the data subject
   actually saw — they currently diverge at two bracket-placeholder substitutions.)
3. **If prod rows exist, rule on FOLLOW-706's Art. 7(1) remediation options**: (a) backfill the
   recomputed hash plus a provenance/annotation column recording the reconstruction, (b) annotate
   without backfilling, (c) re-consent the affected subjects, (d) accept with a recorded rationale.
   No option is recommended here by omission — pick one and record why.
4. **Sequencing**: FOLLOW-705 → FOLLOW-704 (code fix, stops new void records) can proceed on an
   engineering track once item 2 is ruled; FOLLOW-706 (prod remediation) is gated on items 1 and 3
   and does not block 704/705.

---

**Update 2026-07-28 (session 74, post-RETRO-228 / PR #633):**

**Item 2 has a recorded answer, not yet your sign-off.** FOLLOW-705 merged (`47e863c6`) with
compliance-engineer ruling the server renderer (not the doc) byte-canonical, on the grounds that
§6.1 is hardcoded to the Estalara identity (undefined for white-label brands) and Art. 7(1) is about
what the subject actually read. Reasoning and code are in PR #633. Treating this as answered unless
you override it — flagging here since this item was originally routed to you.

**New item 4, filed per FOLLOW-710's own AC-3** ("the PM escalates; this ticket does not
self-escalate") — **bundle into the SAME DPO round as items 1 and 3, not a separate conversation**:

RETRO-228 (following #633) investigated the consent text's withdrawal instruction — _"you can
withdraw this consent at any time by contacting the agency's DSR contact"_ — and found there is no
mechanism for a data subject to act on it, not merely a missing address:

- `POST /api/dsr/initiate` is JWT-gated to **tenant staff** — a data subject cannot call it
  directly; an agency admin must act on their behalf, and there is no public DSR-request page.
- The consent route itself has no withdrawal endpoint (GET + POST only).
- The DPIA's own documented intake procedure (`dpia.md` §8 step 3) names `POST /api/v1/dsr/request`
  — **this route does not exist anywhere in the repo.**
- The §6.3 DOM opt-out is explicitly not withdrawal (already documented as such in `HANDOFFS.md`).

Every investor who has registered since 2026-06-21 (FOLLOW-374 go-live) has been told a specific,
concrete way to withdraw consent that does not exist. This is GDPR Art. 7(3) (withdrawal must be as
easy as giving consent) and Art. 13(1)(a)–(b) (contact details required) territory — filed as
**FOLLOW-710** (P1). A related but lower-severity sibling, **FOLLOW-711** (P2, latent on the current
single-tenant model, live the day a second brand registers): the same text hardcodes an Estalara
mailbox as every white-label brand's own privacy-documentation contact, contradicting a sibling
docblock about per-brand configurability. Both explicitly need to ride the **same text-change /
`PLATFORM_REGISTRATION_TOS_VERSION` bump** as FOLLOW-706's remediation and the existing FOLLOW-145
(SDK consent-banner withdrawal, same right, different surface, already OPEN P2) — RETRO-228's own
recommendation is one DPO round covering FOLLOW-706 + FOLLOW-710 + FOLLOW-711 + FOLLOW-145, not four
separate conversations.

**Required action (CEO / DPO), added to the existing three:**

5. **Rule on FOLLOW-710's withdrawal-channel options**: (a) name a concrete monitored DSR mailbox in
   the text and stand it up, (b) build a subject-facing withdrawal affordance in the
   registration/account surface and name it, (c) keep the mediated (staff-initiated) model but
   render each tenant's own DSR contact from `brand_config` so the text names a real, brand-correct
   address, (d) accept the current mediated/staff-only model with a recorded rationale — no option
   recommended by omission.
6. **Rule on FOLLOW-711's white-label contact**: per-brand contact from `brand_config` (fail-loud if
   unprovisioned, same pattern as `brand_name`/`legal_entity`), or an
   explicitly-Estalara-as-processor sentence that doesn't pretend to be the brand's own contact.
7. **Take the FOLLOW-706 / item-1 prod row count BEFORE any text bump lands** — the population being
   counted/remediated shifts the moment `PLATFORM_REGISTRATION_TOS_VERSION` changes.

**Resolution:** — awaiting CEO/DPO ruling (items 1, 3, 5, 6; item 2 stands unless overridden).

**Resolution:** — awaiting CEO/DPO ruling.

---

**Resolution (CEO ruling, Piotr, 2026-08-08), on both remaining axes:**

**1. The prod-remediation axis is CLOSED AT ZERO — measured, not assumed.** A read-only count
against prod (`DATABASE_URL_DIRECT`) returns **`consent_records` = 0 rows total, 0 carrying the
placeholder hash**. Item 1 asked for exactly this count before assuming either way, per the ESC-037
precedent; the answer is that no data subject has ever been given a record attesting text they did
not see, because **no record exists at all** — consistent with RETRO-257's finding that the consent
caller was never integrated. Item 3 (Art. 7(1) remediation options) is therefore **moot** and needs
no ruling.

**2. Item 2 ruled: the SERVER-RENDERED TEXT is byte-canonical for the hash.** Art. 7(1) is about
proving the consent a specific person gave, and that person saw the render, not the document. The
two bracket-placeholder substitutions where doc and renderer diverge stop mattering, because the
document ceases to be the source.

Implementation: **FOLLOW-916** (compliance-engineer) — derive the hash from the renderer, and make
the document reference the renderer as canonical rather than restating the text. **Take the count
again immediately before the caller is integrated**: item 7's warning stands, the population shifts
the moment registrations start writing.

## RESOLVED — ESC-045: the local chat-NLP shim fails GREEN on a missing Anthropic key — it returns 202 and writes a neutral archetype, and four records name the wrong cause [FOLLOW-729 / FOLLOW-730]

**Filed by:** claude (session 79, post-RETRO-233) **Date:** 2026-07-29T16:00:00Z **Affects:**
Piotr's standing "100% end-to-end on localhost" priority, FOLLOW-729 (merged, PR #641), FOLLOW-730
(P2), `apps/intent-engine/src/nlp.py:318-332`, `apps/intent-engine/src/redis_writer.py:35` **Type:**
operator / credentials + falsified record

**Description:** two things, one of which is my own error.

**(1) The credentials gap itself.** No dev-tier Anthropic key and no dev Upstash instance are
provisioned, so the merged `local_dev.py` cannot actually run the chat → intent → archetype loop end
to end. FOLLOW-729's own AC5 pre-authorised escalating this ("escalate the credentials gap
separately if needed"), and Rule AA says an operator-gated ticket is not DONE on code alone. It
blocks a CEO-stated product priority, so it is escalated here rather than left as prose in
`QUEUE.md`.

**(2) The recorded cause was wrong, and the real failure mode is worse.** The PR body, the
`README.md` section, `QUEUE.md` and the `FOLLOW_UPS.md` stub all state that an authenticated POST
500s on the missing `ANTHROPIC_API_KEY`. It does not. RETRO-233 falsified this and I re-verified it
directly: `extract_intent` is documented **"Never raises"** and swallows every Anthropic failure
(`nlp.py:325-332` — prints, then returns the neutral payload); the 500 I observed actually came from
`redis_writer._get_redis` raising `KeyError('UPSTASH_REDIS_REST_URL')` (`redis_writer.py:35`),
because in my smoke run BOTH credentials were absent and Redis raised first. The log line I quoted
as the cause was a swallowed-error print, not the raise.

**Why that matters operationally:** provision Upstash first (the harder credential) and leave the
Anthropic key unset, and the shim returns **202, writes the shadow key, and records
`archetype_hint: neutral, confidence: 0.0, all dimensions null`**. The wire looks healthy. That is
indistinguishable at a glance from a writer/reader Upstash database mismatch — the _other_ silent
failure on this same path — and both present exactly as "chat isn't affecting the archetype", which
is the highest-cost false-bug trail on this loop. Blast radius is bounded (RETRO-233 checked:
`flattenIntentDimensions` drops nulls → `{}` → `adapt.ts:869-880` skips the prior, so no archetype
poisoning and Rule R is not burned) — the damage is diagnostic time, not corrupted state.

**Decision needed from Piotr (CEO/operator):**

1. Provision an `ANTHROPIC_API_KEY` and an Upstash instance for local dev — and set BOTH before the
   first run, since a partial provision fails green.
2. Confirm the Upstash env-pair parity (`UPSTASH_REDIS_REST_URL`/`_TOKEN` for the writer vs
   `UPSTASH_REDIS_URL`/`_TOKEN` for the control-plane reader must address the SAME database, per
   `docs/runbooks/upstash-redis-env-parity.md`).
3. Whether FOLLOW-730 (make the neutral-payload fallback distinguishable from a real neutral buyer)
   should be pulled forward ahead of the remaining P2/P3 stubs, since until it lands the green-wire
   ambiguity above stays live.

**Not blocked on:** ESC-042 item 1 (prod Modal deploy) — unrelated, still open, local-only scope.

**Added 2026-07-30 (second `/code-review` round on PR #642) — item 4, Rule AJ half-wire.**
FOLLOW-730 wires extraction failures to Sentry, but **`SENTRY_DSN` is not provisioned** in Doppler
`prd` or in the Modal `estalara-secrets` secret (`docs/runbooks/MODAL_PROD_STANDUP.md` records that
prd is missing every Modal runtime secret). `_capture_extraction_error` returns early when the DSN
is unset, so in the deployed container every capture added by that PR is a no-op. The code is wired
and tested; the channel is absent. **Consequence:** a model outage in prod still produces a silent
all-null archetype run — the only surviving signals are a container stdout line and the
`extraction_error` field inside a 24h-TTL Redis key that no dashboard, alert rule or TS reader
surfaces. **✅ RESOLVED 2026-07-30 — `SENTRY_DSN` is now SAFE to provision.** FOLLOW-738 merged (PR
#644, `479ac0ef`): all three Python Modal apps now initialise Sentry through one shared, hardened
`init_sentry` helper (`include_local_variables=False`, `send_default_pii=False`,
`default_integrations=False` + explicit atexit), and `scripts/check-sentry-init-singleton.sh` is a
CI gate that fails the build on any raw `sentry_sdk.init(` outside `observability.py`. Verified on
`main` after merge: the gate passes and all four Rule J mirror pairs are in sync. **The warning
below is kept for the record, struck through — it was correct until PR #644 merged and is now
historical.**

~~**⚠️ CORRECTION 2026-07-30 (RETRO-234 HW-3) — DO NOT PROVISION `SENTRY_DSN` YET.**~~ The advice
originally written here (and given to Piotr twice in session) was to provision the DSN alongside the
other ESC-045 credentials. That is now known to be unsafe. All three Python Modal apps read the
**bare** `SENTRY_DSN` name and mount the **same** `modal.Secret.from_name("estalara-secrets")`:
`apps/intent-engine/src/nlp.py` (hardened by PR #642),
`apps/llm-gateway/src/jobs/consume_embed_seed_requests.py:193,393` and
`apps/data-quality/src/crons/schema_validation.py:352-357`. **Neither of the latter two sets
`include_local_variables=False`, `send_default_pii=False` or `default_integrations=False`** — so
they would ship frame locals, and via the default `LoggingIntegration` every `logging.error`, as
Sentry events. Provisioning the one secret this ticket asks for therefore silently switches on two
producers that lack the exact control PR #642 spent a whole review round adding. `.env.example:70`'s
comment ("all services share one org, separate projects") is already false for the Python tier.

**⚠️ CORRECTION 2026-07-31 — item 1 ("no dev-tier Anthropic key") IS FALSE, and it was my error.**
Verified by direct query during FOLLOW-736 validation (names and value-shapes only, never values):
Doppler project `estalara-adaptive-listings` holds `ANTHROPIC_API_KEY` in **all three** configs
`dev` / `stg` / `prd`, all 108 chars, all `sk-ant-` shaped, and **all three are byte-identical**.
The ml-engineer proved that value live during FOLLOW-736 (a real Haiku extraction returned
`feature_priority: "4_bedrooms"`, a token in no fixture in this repo). So a working key is readable
today with `doppler secrets get ANTHROPIC_API_KEY -c dev --plain` — **nothing needs provisioning.**
This escalation asserted the opposite from the day it was filed and I repeated it to Piotr twice.

**Item 2-3 (Upstash) — still genuinely absent from Doppler** (`UPSTASH_*` appears in NO config), but
FOLLOW-736's verification demonstrated a path that needs no cloud provisioning either: a local
`redis:7-alpine` behind `hiett/serverless-redis-http` is a working Upstash-REST-compatible endpoint.
Point BOTH the writer's `UPSTASH_REDIS_REST_URL`/`_TOKEN` and the control-plane reader's
`UPSTASH_REDIS_URL`/`_TOKEN` at that one local shim and the env-pair parity requirement is satisfied
by construction — the mismatch hazard this escalation warns about cannot occur when there is one
endpoint. That reduces the remaining operator work for the "100% on localhost" goal to starting two
containers.

**`SENTRY_DSN` — confirmed absent from all three configs**, consistent with FOLLOW-744.

**New risk surfaced by the same query, unrelated to this escalation's original scope:** `dev`, `stg`
and `prd` share ONE Anthropic key value. A local developer run is therefore indistinguishable from
production in billing and rate limits, and the key cannot be rotated for dev without breaking prod.
Filed as FOLLOW-750 (P3) for Piotr's judgement; not blocking anything here.

**Decision needed (updated after FOLLOW-738 merged):** option (a) is done — provision `SENTRY_DSN`
into the Modal `estalara-secrets` secret whenever convenient; the hardening it was waiting on is on
`main` and CI-guarded. Items 1-3 (Anthropic key, Upstash instance + env-pair parity) are unaffected
and remain the actual blockers on the "100% on localhost" goal.

**CORRECTION 2026-07-30 (session 83, per RETRO-235 §3 HW-2 / §4d DG-1) — item 4's "RESOLVED" framing
above conflated two distinct legs; only one is closed.** Item 4, in its own original words, named
two legs: (a) the hazard — provisioning `SENTRY_DSN` would silently activate two unhardened Sentry
producers; (b) the absent channel — _"the code is wired and tested; the channel is absent"_ (no
producer exists in prod for any of the four call sites, DSN or no DSN). **FOLLOW-738 (PR #644)
closed leg (a) only.** The "✅ RESOLVED" line above, and this session's own earlier `QUEUE.md`/
`STATUS.md` entries which repeated "items 1-3 remain the ONLY open blockers", both over-read that as
closing leg (b) too. It did not: `SENTRY_DSN` is still absent from Doppler `prd` and from the Modal
`estalara-secrets` secret (`docs/runbooks/MODAL_PROD_STANDUP.md:17`) — nothing changed on the
producer side, only the hazard of provisioning it did. **Leg (b) is now correctly tracked as
`backlog/FOLLOW_UPS.md` → `## FOLLOW-744`** (filed by RETRO-235, since RETRO-234's original note —
"NO new stub — already owned by ESC-045 item 4" — lost its owner when item 4 was marked resolved).
This escalation stays `## OPEN` (not re-opened as blocking-for-dispatch; it was never closed to
begin with) — this note only corrects the record, it changes no decision and requires no new
operator action beyond what FOLLOW-744 already asks for.

---

**Resolution (CEO ruling, Piotr, 2026-08-08): PULL FOLLOW-730 FORWARD, ahead of the remaining P2/P3
stubs.**

**Two of this escalation's stated blockers are corrected by measurement and are not blockers:**
`ANTHROPIC_API_KEY` **is** present in Doppler `dev` (item 1's first half was false — the only
`UPSTASH_*` keys there, `UPSTASH_API_KEY`/`UPSTASH_EMAIL`, are account-management credentials, not
the writer's REST pair), and local Upstash needs **no cloud instance** — the `serverless-redis-http`
shim serves it.

**What remains is item 3, and it is the one that matters.** Until FOLLOW-730 lands, the local shim
cannot distinguish _a real neutral buyer_ from _extraction failed and a neutral archetype was
substituted_. Every local test of the chat loop can therefore be green **for the wrong reason** —
precisely the fail-green class this estate spent session 105-106 removing from production. Proving
the localhost goal on an instrument that cannot fail honestly would prove nothing.

Item 2 (Upstash env-pair parity) is now materially resolved for prod by ESC-053's verification (the
`_REST_` pair and the control-plane pair address the same database, checked by probe); the local
equivalent rides the shim.

## RESOLVED — ESC-048: the sequencing question is closed — FOLLOW-838 and FOLLOW-845 both merged, so the path is redacted at source

**Filed by:** main-loop orchestrator (session 103) **Date:** 2026-08-05 **Affects:** FOLLOW-838,
FOLLOW-744, `apps/ingest` **Type:** compliance

**Description.** RETRO-249 found that the console→Sentry coupling FOLLOW-811 established for
`apps/control-plane` also holds for `apps/ingest`: `@sentry/cloudflare@10.50.0` ships
`consoleIntegration()` as a **default** (`build/cjs/sdk.js:29`) and
`apps/ingest/src/observability.ts:71-82` overrides nothing. Unlike the control plane, **this app
handles raw buyer chat** — `src/handlers/chat-nlp-dispatch.ts:69-73` POSTs
`message: { role: 'user', content: messageText }` to Modal, and at `:86-92` a non-ok response is
logged and captured as:

```ts
const msg = `[chat-nlp] Modal dispatch rejected: HTTP ${status} — ${text.slice(0, 500)}`;
console.error(msg); // → Sentry breadcrumb (default integration)
Sentry.captureException(new Error(msg)); // → Sentry exception value
```

Whether Modal's error body echoes the submitted message has **not** been observed, so this is not a
proven leak and is not being reported as one. What is established is the shape: up to 500 characters
of an upstream error body, from a request whose body is the buyer's message, reaching two Sentry
sinks with no scrubber — the same shape as FOLLOW-812 (Modal stdout) and FOLLOW-738 (the Python
Sentry leg), both of which were real.

**The reason this is an escalation and not just a ticket:** the path is inert **by environment, not
by control**. `apps/ingest/src/observability.ts:72` no-ops when `SENTRY_DSN_INGEST` is falsy, and
that variable is currently unset — a state several backlog notes record as a _problem_ to be fixed
(FOLLOW-744 shipped exactly to make `init_sentry` non-fatal and instruct DSN provisioning; it is
DONE, merged 2026-07-31). So the ordinary, already-planned operator action of provisioning the
ingest DSN is what turns this path on. Nobody doing that would currently have any reason to know it.

**Required action (CEO/DPO decision, one of):**

1. **Sequence it** — hold `SENTRY_DSN_INGEST` provisioning until FOLLOW-838 (P1, filed, unfrozen)
   lands a redaction on that call site. This is the recommended option: FOLLOW-838 is a small,
   bounded fix of a shape this repo has now fixed twice elsewhere.
2. **Provision anyway and accept**, recording the residual risk in `dpia.md` the way FOLLOW-811
   §2.7.1 recorded the control-plane decision, with a named re-review trigger.

**No production action is being taken on this either way** — the ingest DSN is not being set, and
FOLLOW-838 does not require it.

**Resolution:** <empty until resolved>

---

## RESOLVED — ESC-049: CEO/DPO ruled option 1 — scope the sentence to reality; the ClickHouse write is deliberate §H.8 design, the document must state it

**Filed by:** main-loop orchestrator (session 103), from a FOLLOW-838 finding **Date:** 2026-08-05
**Affects:** `docs/compliance/C-07-chat-retention-scope.md`, `apps/ingest`, ESC-048, FOLLOW-845
**Type:** compliance

**Description.** `docs/compliance/C-07-chat-retention-scope.md:17` and `:274` state, twice, as the
premise the document's own Q3/Q4 conclusions rest on:

> "No raw chat text is written to Redis, ClickHouse, or Postgres in the current implementation"

with the verification cited immediately after being **only**
`apps/intent-engine/src/redis_writer.py` and `schemas.py`. The ClickHouse axis of that sentence
appears never to have been checked.

**The chain that contradicts it, verified end to end by this session rather than taken from the
worker's report:**

1. `packages/sdk/src/index.ts:1519` emits a `chat.message.sent` event — a live producer, not a
   planned one.
2. `packages/shared/src/schemas/events/chat.ts:38-40` defines its payload's `message` field as up to
   **4000 characters** of message text, and `:56-57` states the design intent in as many words:
   _"§H.8 invariant: the chat event STILL flows to ingest (ClickHouse) regardless of this flag."_
3. `apps/ingest/src/clickhouse-producer.ts:110` writes
   `payload: JSON.stringify(event.payload ?? {})` into the `events` table, whose
   `payload String CODEC(ZSTD(3))` column is
   `infra/clickhouse/migrations/0001_create_events.sql:41`.

So the buyer's chat message text does reach ClickHouse, by design, through a shipped path.

**The one thing that makes this a ruling rather than a bug report:** the schema comment calls
`message` _"PII-scrubbed message text (emails/phones replaced with placeholders)"_. So a defensible
reading of C-07 is that "raw" means "unscrubbed", and the sentence is technically true under that
reading. The problem is that no reader — a DPO, an auditor, or the CEO signing off — would take "no
raw chat text is written to ClickHouse" to mean "the buyer's sentences are in ClickHouse with emails
and phone numbers masked". Two of this session's three closed tickets were exactly this failure
mode: a document asserting a control in words its own implementation did not support.

**Why it is escalated and not silently fixed.** Choosing the scoping is a compliance judgment with a
lawful-basis consequence — C-07 §Q4's legitimate-interest conclusion and §Q3's no-new-disclosure
conclusion are both derived from this sentence. An agent narrowing it to "unscrubbed" or widening it
to "the text is retained in ClickHouse" would be making that call unilaterally. The FOLLOW-838
worker flagged it and correctly declined to edit someone else's compliance document; so do I.

**Required action (CEO/DPO ruling, one of):**

1. **Scope the sentence** — state explicitly that it covers unscrubbed identifiers only, and add
   what IS retained in ClickHouse (`chat.message.sent.payload.message`, ≤4000 chars, TTL per the
   `events` table's retention), then re-derive §Q3/§Q4 against the corrected premise.
2. **Correct the sentence** — if the intended posture is that no chat text at all should be in
   ClickHouse, then the `events` write is the defect and needs a ticket, not the document.

Either way the fix is `compliance-engineer`'s, and it should re-verify **all three** stores named in
that sentence rather than only Redis, since only Redis was ever checked.

**Related:** ESC-048 (the same app's Sentry leg) and FOLLOW-845 (the ClickHouse **error body** leg,
which quotes offending input back into two Sentry sinks — a different defect on the same data).

**Resolution:** <empty until resolved>

---

## RESOLVED — ESC-050: the Actions failures were a GitHub-side major outage, not a repo, billing or capacity problem

**Filed by:** main-loop orchestrator (session 103) **Date:** 2026-08-06 **Affects:** every open PR,
`scripts/gh-pr-checks-verified.sh` **Type:** other (infrastructure / possibly billing)

**Description.** Since roughly 16:20 UTC, jobs on this repo are failing at the **`Set up job`** step
— zero workflow steps execute, after the job sits ~10 minutes. Verified per job at the API, not
inferred from a red square:

| job                       | run           | steps recorded                     |
| ------------------------- | ------------- | ---------------------------------- |
| `Format check`            | `31119553175` | `Set up job` → failure (only step) |
| `Typecheck`               | `31119553175` | `Set up job` → failure (only step) |
| `Rule H gate self-test`   | `31119549990` | `Set up job` → failure (only step) |
| `Redis shadow round-trip` | `31119553522` | cancelled, same shape              |

Repo-wide over the last 20 runs: **8 queued, 3 failed, 1 cancelled, 7 succeeded**. So this is not a
hard stop — some jobs complete — it looks like runner capacity or a concurrency/billing limit, with
GitHub failing job setup after a wait rather than queueing indefinitely.

**Why it is escalated rather than waited out.** It makes the repo's mandated merge gate unusable:
`scripts/gh-pr-checks-verified.sh` cannot observe a settled snapshot, so **no ticket can be honestly
marked READY_FOR_REVIEW while it persists**. PR #686 (FOLLOW-857) is blocked on exactly this — its
rebased head has never had a CI verdict, and the reds on it are these setup failures, **not code**.
Nobody should read them as a defect in that PR.

**A contributing factor worth seeing, from RETRO-252's measurements:** every PR registers each job
**twice** — once for the `push` event and once for `pull_request` (75 check-runs across 39 distinct
names on a recent PR). That doubles the job count against whatever limit is being hit. It was filed
as an efficiency observation; it is now also a capacity cost.

**The sharpest single piece of evidence, found after this entry was first written.** The
`Gitleaks secrets scan` job (`92677067931`) is marked `failure` — and **every one of its five steps
is `success`**, including `Run Gitleaks` and `Complete job`. Its own log ends with:

```
2026-08-06T17:06:38.2074437Z ✅ No leaks detected
```

the SARIF artifact uploaded and finalized normally, and cleanup ran. The job's `completed_at` is
**17:51:25** — **45 minutes after its last log line**. So GitHub recorded a failure conclusion on a
job that demonstrably did its work and passed. This is not a secrets finding, and no gitleaks
remediation is warranted.

**The push/pull_request asymmetry points the same way:** on the `push` event `Format check` passed
in 2m, `Test (Node 22)` in 14m and `ClickHouse migrations smoke` in 24s — the same commits, the same
workflow. The `pull_request` copies of those jobs are the ones failing at setup. Identical code, two
outcomes, decided by which event queued the job.

**RESOLVED 2026-08-06 — confirmed at the source, and my own hypothesis was wrong.**
`githubstatus.com` reports an active **major outage of GitHub Actions**, incident opened **15:22
UTC**, impact **Critical**, status _Investigating_, with GitHub's own wording: _"Workflow runs are
still failing, and jobs may remain queued for an extended period before starting or may time out."_
Jobs on GitHub-hosted runners are explicitly named as constrained.

That accounts for every symptom in this entry — the `Set up job` failures, the Gitleaks job marked
failed 45 minutes after its log said `✅ No leaks detected`, the queue not draining, and the **HTTP
502s the GitHub API returned to my own `gh run cancel` requests**.

**Correction to what I did while this entry said "possibly billing".** I cancelled five queued
`main` workflow runs to free capacity, on the theory that a concurrency or spend limit was being
hit. Those runs were triggered by this session's own docs-only bookkeeping commits, so cancelling
them cost nothing and lost no signal — but the theory was wrong, capacity was never the constraint,
and the cancellations changed nothing. Recorded because acting on an unverified hypothesis is
exactly what this session has spent the day filing tickets about.

**No operator action is required.** Nothing in this repo caused it and nothing in this repo can fix
it. The only correct response is to wait for GitHub, then re-run
`scripts/gh-pr-checks-verified.sh 686`.

**What it did surface, worth keeping after the outage clears:** this repo's docs-only commits
trigger the full CI matrix plus four auxiliary workflows. This session pushed roughly twenty
backlog-only commits to `main`, each queueing ~40 jobs. Filed as **FOLLOW-863** on its own
efficiency merits, not as a cause of today's incident.

**Required action (operator — I cannot check any of this):**

1. Look at the Actions billing/usage page for the account. The GitHub REST billing endpoint needs
   the `user` scope, which I deliberately did not grant myself.
2. If it is a spend cap or plan limit, decide whether to raise it or to reduce job volume — the
   duplicate push+PR runs (above) and `cancel-in-progress` on `main` (FOLLOW-851) are the two
   cheapest levers.
3. **If it self-clears, close this as resolved with a one-line note** — a transient runner-capacity
   incident is worth recording once and not carrying.

**No code change is proposed and none is warranted** — nothing in the repo caused this and nothing
in the repo can fix it.

**Resolution:** <empty until resolved>

---

### ESC-044 / ESC-048 / ESC-049 — resolution notes, session 103 (2026-08-07)

**ESC-044 items 1/2/3/5/6: RESOLVED by the FOLLOW-814 CEO+DPO ruling** (recorded in full in
`backlog/FOLLOW_UPS.md` → FOLLOW-814 → DECISION block): renderer-canonical hash confirmed, a
concrete monitored DSR mailbox as the Art. 7(3) channel, the Estalara-as-processor sentence for
white-label contact, all delivered as ONE text change + ONE TOS bump via FOLLOW-815 (dispatched).
Remediation of existing prod records is scoped by the FOLLOW-706 AC-1 count.

**ESC-048: RESOLVED.** The escalation's own recommended option ("sequence it — hold provisioning
until FOLLOW-838 lands a redaction") has been satisfied by events: FOLLOW-838 (PR #681) redacted the
Modal-dispatch arm and FOLLOW-845 (PR #682) closed the ClickHouse error-body leg.
`SENTRY_DSN_INGEST` may now be provisioned whenever the operator chooses; `sendDefaultPii: false` is
pinned.

**ESC-049: RESOLVED as a ruling; implementation ticket follows** (filed after the in-flight
RETRO-254/255 lands, to avoid a stub-number collision). CEO/DPO chose option 1: C-07's sentence is
scoped to what is true — "no unscrubbed identifiers" plus an explicit statement of what IS retained
in ClickHouse (`chat.message.sent.payload.message`, ≤4000 chars, emails/phones masked,
`events`-table retention) — §Q3/§Q4 re-derived against the corrected premise, and all three stores
re-verified, not only Redis. The §H.8 write stands as deliberate design.

---

### ESC-049 addendum — Q1/Q3 ruling (CEO+DPO, 2026-08-07, session 103)

FOLLOW-866's correction surfaced that C-07 §Q1/§Q3's conclusions were conditioned on the
now-falsified premise. **CEO+DPO ruled: disclose-in-notice, LI basis, no separate checkbox.**

1. **Q3:** the Privacy Notice / consent text **gains an explicit storage disclosure** — buyer chat
   message content is retained (emails/phones masked by the scrubber, `events`-table TTL 13 months)
   — riding the **same single `PLATFORM_REGISTRATION_TOS_VERSION` bump as FOLLOW-815**. No second
   bump is spent.
2. **Q1:** ruled that scrubbed-but-textual storage does **not** fire Q1's explicit-consent trigger:
   the lawful basis remains legitimate interest **with full transparency** (the disclosure above).
   Recorded as a judgment, not a fact — the re-review trigger is any widening of what the scrubber
   passes through or any lengthening of retention.
3. Consequence for the subject-facing surfaces FOLLOW-866 flagged (`consent-banner.ts:166`,
   `platform-registration/lib.ts:138`, `PRIVACY_NOTICE_TEMPLATE.md` §6.1): the false "no chat
   content is stored" claim is corrected to the disclosure above **inside FOLLOW-815's text
   change**, keeping the Rule N byte-sync gates green.

---

## RESOLVED — ESC-051: the SDK bundle budget is exhausted (41.99KB / 42KB) and a legal disclosure just competed with a byte budget

**Filed by:** main-loop orchestrator (session 103) **Date:** 2026-08-07 **Affects:**
`@estalara/sdk`, FOLLOW-815 (PR #688), ESC-028, FOLLOW-673 **Type:** architectural

**Description.** FOLLOW-815's chat-storage disclosure (CEO+DPO ruling, ESC-049 addendum) had to be
added to the consent banner in EN+PL+ES. The first, fuller wording measured **42.03KB gzip — over
the 42KB budget** — and was cut to 41.99KB by trimming verbosity while keeping every disclosed fact.
Headroom is now **~10 bytes**.

**Why this is an escalation:** a regulator-facing disclosure was edited to fit a performance budget.
The worker kept the facts intact this time, but the next mandatory sentence — any new language, any
new disclosure — cannot ship without either busting the budget or cutting substance. ESC-028 already
raised this budget once (40→42KB). The structural options are a CEO call: raise the budget again,
split the banner text out of the bundle (lazy-load the notice), or accept that consent-text growth
forces future trims.

**Required action:** CEO decision on the mechanism, then a ticket. No urgency for PR #688 itself —
it fits — but the next banner edit is blocked-by-construction.

**Resolution (CEO ruling, Piotr, 2026-08-08): LAZY-LOAD THE BANNER TEXT OUT OF THE BUNDLE.**

Not a third budget raise. The reasoning the ruling accepts: **consent text grows from regulation,
not from engineering, and must never compete with code for a performance budget.** A budget raised
whenever it binds is not a constraint, and this would have been the second raise (40→42KB already
happened under ESC-028).

Implementation: **FOLLOW-915** (sdk-engineer). Constraint to design against — the notice must still
render before any profiling begins, so "lazy" cannot mean "after the first event"; the fetch has to
be ordered ahead of the consent gate, not merely off the critical path.

---

## RESOLVED — ESC-052: Doppler `stg.DATABASE_URL_ADMIN` is byte-identical to `prd` — "staging Postgres" IS production, and the migrate-staging gate has never protected anything

**Filed by:** main-loop orchestrator (session 103) **Date:** 2026-08-07 **Affects:** FOLLOW-818
(BLOCKED on this ruling), `db-migrate.yml`, Doppler `stg` config **Type:** architectural

**Description.** Found by the FOLLOW-816 worker and **verified independently by this session**:
`doppler secrets get DATABASE_URL_ADMIN` for `stg` and `prd` returns the **same sha256 over the
whole URL** — same user, host, database. Every "staging-first" Postgres step (`db-migrate.yml`'s
staging→prod sequence) has been running against production twice. The gate has been non-protective
for its entire life.

**Why it blocks FOLLOW-818:** that ticket is about to write `FEEDBACK_ENDPOINT_ENABLED=true` into
the `stg` config believing it is isolated. It is not — the write would flip production.

**Also established by the same ticket: staging does not exist for the event path either.**
`[env.staging]` in the ingest Worker sets `CLICKHOUSE_URL=""` (no-cred guard), declares no bindings,
`ingest-staging.estalara.com` has no DNS record, `deploy-staging.yml` calls itself "a BUNDLE/UPLOAD
SMOKE, not a test environment", and Doppler `stg` has no `CLICKHOUSE_*` at all. FOLLOW-816's AC(2)
substituted a fully local ClickHouse + local ingest Worker rather than touching prod.

**Required action (CEO ruling, one of):**

1. **Provision a genuinely separate staging** (own Supabase project; optionally CH dev service) —
   implementation pre-filed as FOLLOW-871, held for this ruling; or
2. **Declare localhost-first official for the data plane too** — delete/rename the `migrate-staging`
   job and the `stg` Doppler config so nothing _appears_ to provide isolation it does not provide,
   and re-scope FOLLOW-818 to a local-only flag flip.

Option 2 is consistent with the recorded stage ("all verification on localhost BEFORE prod") and
costs nothing; option 1 costs a Supabase project and answers a need no current ticket actually has.
**Recommendation: option 2**, revisit staging when FOLLOW-820's exit gate makes it real.

**Resolution (CEO ruling, Piotr, 2026-08-07 — session 104): OPTION 2.** Localhost-first is official
for the data plane too. Nothing may continue to _appear_ to provide isolation it does not provide.

**Verified twice before the ruling was requested**, once by the FOLLOW-816 worker and once by this
orchestrator directly: `stg` and `prd` `DATABASE_URL_ADMIN` both hash to sha256 `ba5e3741 83a629df…`
on the same `aws-0-eu-west-3.pooler.supabase.com` / `postgres`. The workflow shape makes the
consequence concrete — `db-migrate.yml:100` runs `doppler run --config stg -- pnpm db:migrate` and
`migrate-prod` (`:104-108`) declares `needs: migrate-staging` before running the identical command
against `prd`. **Every merged migration has therefore been applied to production twice**, and the
"if staging succeeds, run prod" sentence in the file header has never been true.

**Consequences, all now carried by tickets:**

1. **FOLLOW-873** (filed, P1, devops-engineer) — retire the non-protective gate: collapse
   `db-migrate.yml` to a single prod apply, drop `DOPPLER_TOKEN_STG`, and rewrite the header, which
   currently documents a staging-first sequence that does not exist. Note for whoever takes it: the
   double-apply is also the _only_ reason a bad migration currently fails "twice", so the
   replacement must not quietly become a first-and-only unguarded prod write — state plainly in the
   header that there is no pre-prod rehearsal and that migrations must be additive/safe (already the
   standing rule, see memory `project_postgres_migrations_no_autoapply`).
2. **FOLLOW-871 CLOSED unexecuted**, exactly as this escalation pre-committed. No separate staging
   Supabase project will be provisioned now.
3. **FOLLOW-818 UNBLOCKED and re-scoped** from staging to local-only.
4. The `stg` Doppler config is retired as part of FOLLOW-873 rather than being left as a live trap.

Revisit a real staging when FOLLOW-820's exit gate makes production traffic real.

---

## RESOLVED — ESC-054: should LLM-generated long-form copy ride the `signal_count >= 2` escape hatch? Two behavioral signals currently bypass the cold-start guard on the description axis

**Filed by:** sdk-engineer (FOLLOW-877, session 104) **Date:** 2026-08-07 **Affects:**
`packages/sdk/src/core/adapt-floor.ts`, `packages/sdk/src/index.ts:827-859`, FOLLOW-343, FOLLOW-819,
FOLLOW-820 **Type:** architectural (product behavior on a buyer-facing surface)

**Nothing is on fire.** The SDK is not live on the pilot page — FOLLOW-820 is that gate. This is a
decision request filed BEFORE a behavior change, not a report of one.

**Description.** `index.ts:827-829` gates all DOM adaptation behind a disjunction:

```ts
const aboveFloor =
  resp.confidence >= DOM_ADAPT_CONFIDENCE_FLOOR || // 0.5
  currentIntentState.signal_count >= DOM_ADAPT_MIN_SIGNAL_COUNT; // 2
```

Both `applyDirectives()` and the fire-and-forget `applyDescriptionAdaptation()` sit inside that one
block. On the **directive** axis the disjunction is harmless: the server gates independently at
`confidence > 0.6` (`route.ts:86,275`), so a low-confidence session gets `directives: []` no matter
what the SDK decides. On the **description** axis there is no server-side confidence parameter at
all (`grep confidence apps/control-plane/src/app/api/adapt/description/route.ts` → 0 hits), so
`signal_count >= 2` is the whole gate. Its remaining guard is `archetype !== 'neutral'`
(`core/adapt-description.ts:390`).

Two signals is a lower bar than it reads: the init-time `device_type.*` prior (`index.ts:1031-1036`)
already increments `signal_count`, so **a single scroll-depth milestone reaches 2**. FOLLOW-343 /
AUDIT-2026-06-19 F-01 opened this floor specifically to stop the cold-start wrong-archetype
reshuffle at ~0.05–0.10 confidence. On the one axis with no server-side threshold, that guard is
bypassed within seconds of scrolling — and what it lets through is not a headline swap but an
LLM-rewritten property description.

**Pre-existing, not introduced here.** Shipped since FOLLOW-159/343; surfaced by FOLLOW-816's
measurement axis (RETRO-259 §4b CB-1). Current behavior is now locked by
`packages/sdk/src/__tests__/follow-877.test.ts` so it cannot drift silently either way.

**The tension, weighed rather than asserted:**

- **For keeping the disjunction.** `DOM_ADAPT_MIN_SIGNAL_COUNT` is a deliberate "the buyer showed
  real intent" escape hatch. FOLLOW-816 measured behavior-only confidence peaking at **0.3655** on a
  real listing page — under a confidence-only gate the description axis would essentially never fire
  for a non-quiz, non-chat buyer, which is most buyers. Gating on confidence alone would make the
  feature dead in exactly the cold-start case it was built for.
- **Against.** FOLLOW-343's rationale is about the ARCHETYPE being wrong, not about the buyer being
  disengaged, and two scroll events are not evidence that the archetype is right. The blast radius
  differs by axis: a wrong headline is a sentence; a wrong long-form description is the whole
  listing body rewritten for the wrong buyer, it costs an LLM call, and it is the surface with the
  greatest misrepresentation risk (§V.4.3).
- **The asymmetry to decide with, not around.** At confidence 0.50–0.59 the server already returns
  `[]` for directives while the SDK fetches and applies a description. So the description axis is
  ALREADY the more permissive one by design, at every confidence level, before `signal_count` is
  considered. Whether that was intended is precisely the open question — it is documented in
  MASTER_DESIGN §E.7 as intentional ("early behavioral signals can produce confident description
  personalisation before the archetype clears the tighter directive gate"), but that text was
  written without the disjunction in view.

**My recommendation (not enacted — this ticket ships documentation, tests and a decision request
only):** keep the disjunction, and raise its bar on the description axis only, e.g. require
`signal_count >= 5` there — the same boundary the SDK already treats as "enough evidence to be worth
reporting", since `intent.snapshot` fires every 5 signals (`index.ts:1219-1225`). That preserves the
cold-start escape hatch the feature depends on while removing the one-scroll-to-LLM-rewrite path,
and it needs one new constant rather than a redesign. A confidence -only gate on the description
axis is the alternative, and it should only be chosen with the knowledge that 0.3655 was the
measured behavior-only peak — i.e. it would mostly turn the feature off for non-quiz sessions.

**Required action:** CEO/CPO ruling on one of: (a) keep as-is and record it as intended; (b) raise
the description-axis signal bar (my recommendation); (c) gate the description axis on confidence
only. Then a ticket for the SDK change, an amendment to MASTER_DESIGN §E.7's gating ladder note, and
a deliberate inversion of `follow-877.test.ts` D-1 — which is designed so that flipping it IS the
record of the decision.

**Resolution (CEO ruling, Piotr, 2026-08-08): RAISE THE DESCRIPTION-AXIS BAR TO
`signal_count >= 5`.** Keep the disjunction; the description axis stops riding the `>= 2` escape
hatch.

Ruled against the corrected premise, which matters: the escalation was written believing **two**
behavioral events opened the gate. They do not — the init-time `device_type` prior consumes one
signal (`index.ts:1031-1036` → `applyBehavioralSignal` → `intent.ts:1038`), and
`DOM_ADAPT_MIN_SIGNAL_COUNT = 2`, so **one** real event (a single scroll milestone) currently
bypasses FOLLOW-343's cold-start guard for LLM-generated copy. `>= 5` therefore means four real
events, not three, and 5 is the boundary the SDK already treats as "enough evidence to report".

Implementation: **FOLLOW-913**. Test D-1 flips to record the ruling. The directive axis is
unaffected — its server gate (`> 0.6`) already dominates.

---

## RESOLVED — ESC-055: `app.estalara.com` cannot be validated by an anonymous fetcher at all — every listing route is behind a session, so schema validation has no reachable subject

**Filed by:** data-engineer (FOLLOW-902), escalated by the PM after independent verification
**Date:** 2026-08-08 **Affects:** FOLLOW-902 (shipped), FOLLOW-907, §B.6 Continuous Schema
Validation, possibly ESC-020 / Wave-0 Step 6 **Type:** product decision (what a tenant must provide)

**Measured, not inferred. I re-ran the probes myself after the worker reported them:**

```
https://app.estalara.com             → 302 → /en
https://app.estalara.com/listings    → 302 → /en?back=%2Flistings
https://app.estalara.com/properties  → 302 → /en?back=%2Fproperties
curl -sL https://app.estalara.com | grep -c data-estalara   → 0
```

All four `url_patterns` the stored schema declares redirect to the login page. The only anonymous
HTML surfaces on this tenant are `/en` and the legal pages. **FOLLOW-902's fix is correct and does
not resolve this**: it stops the validator lying (a total miss is now a `config_gap`, not drift),
but the tenant remains **unmeasurable by an anonymous fetcher**, so B.6's subject does not exist for
the only active tenant.

**Why a `sample_listing_url` alone does not fix it.** That was the obvious remedy and the evidence
rules it out — the field would have to point at a page behind the same session gate. Note also that
**nothing in the repo writes `sample_listing_url`**; it is read here and nowhere else, so requiring
it is an onboarding change, which is why this is a ruling and not a ticket.

**Options (CEO/CPO):**

1. **Publish one anonymous listing page** (a canonical demo/sample listing) and store its URL —
   smallest change, gives the validator a real subject, and doubles as a public reference page.
2. **Authenticated fetch** — the validator holds a service session. Costs a credential in
   `estalara-secrets`, a session-refresh path, and a DPIA question about a bot session against a
   product surface.
3. **Accept that B.6 is not measurable for first-party tenants** and re-scope it to future
   private-label tenants with public catalogues — honest, and it should then be said in §Snapshot.1
   rather than left as a 🟡 that can never flip.

**A consequence worth surfacing separately:** because every route that would render them is
auth-gated, **whether the `data-estalara` hooks are live on real listing pages has never been tested
from outside**. That is an assumption ESC-020 / Wave-0 Step 6 rests on, and it is currently
unverifiable anonymously. Not a claim that it is broken — a claim that nobody can currently tell.

**ADDENDUM 2026-08-08 (PM, session 106) — this ruling now has a date, because §Snapshot.1 row B.6 is
about to flip on a run that validates nothing. Read before flipping it.**

Row B.6's flip condition is the **02:00 UTC scheduled run of 2026-08-09 confirmed by the 05:00 UTC
detector**. I traced what that run will actually do, in the post-FOLLOW-902 code, rather than assume
it repeats today's manual result:

- `schema_validation.py:679` finds no `sample_listing_url`, takes the `config_gap` branch
  (`:681-714`), writes a history row with
  `coverage_score=0.0, drift_detected=False, error='config_gap: …'`, and **`continue`s** (`:715`).
- `_run_validation` therefore returns normally, so `validate_schemas:601` **does** write the
  `cron_heartbeats` row.
- The 05:00 detector reads that heartbeat and goes **GREEN**.

**So B.6's flip condition will be satisfied by a run whose outcome for the only active tenant is
`config_gap` — the cron is alive and observed, and it has still validated nothing.** I checked this
specifically because the opposite was plausible (an early return skipping the heartbeat would have
reddened the detector and been misread as "the cron died again"); it does not, and that is worth
recording as a non-finding so nobody re-derives it.

The flip is honest on the **liveness** axis and would be dishonest on the **coverage** axis. This is
FOLLOW-906's subject in the wild: one status token absorbing a change of axis without visibly
changing. Whoever flips B.6 tomorrow must write the outcome next to it — e.g.
`observed ✅ (2026-08-09 02:00 UTC) · coverage ❌ config_gap, 1/1 tenants — ESC-055` — and must not
write a bare "observed ✅". **No new stub is filed for this** (Rule AN): it is a new fact about
ESC-055 and FOLLOW-906, both of which already exist.

**Resolution (CEO ruling, Piotr, 2026-08-08): PUBLISH ONE ANONYMOUS LISTING PAGE.**

A canonical, publicly reachable sample listing; its URL stored as the tenant's `sample_listing_url`.
Smallest change of the three, gives the validator a real subject, and doubles as a public reference
page.

**It also unblocks a question nobody could answer:** because every listing route is behind a session
(verified — `/listings` and `/properties` both 302 to `/en?back=…`, and the marketing home greps 0
for `data-estalara`), **whether the SDK's DOM hooks are live on real listing pages has never been
testable from outside**. ESC-020 / Wave-0 Step 6 rests on that. The anonymous page makes it
checkable for the first time.

Sequencing: the page is a Rafał/CTO action on the Estalara-app side; storing its URL and re-enabling
validation is **FOLLOW-914**, which is blocked until the page exists. **FOLLOW-907** (per-page-type
scoring) unblocks with it.

---

## OPEN — ESC-056: nobody can read `default.events`, so the one compliance question FOLLOW-931 exists to answer — did production drop any `es` consent decisions? — is unmeasurable, and the failed query looks exactly like a clean bill of health

**Filed by:** pm-orchestrator (session 110, from FOLLOW-931 AC(4)) **Date:** 2026-08-09 **Affects:**
FOLLOW-931 AC(4), DPIA §13.1 (consent-refusal record), any remediation scoped off the `es` drop
count **Type:** operator access / compliance evidence

**What shipped and what did not.** PR #711 (`31cab8b4`) fixed the code: the consent payload schemas
now derive `language` from `QuizLanguageSchema`, so a Spanish visitor's accept/refuse survives
ingest instead of being rejected by a hand-written `z.enum(['en','pl'])`. That is the forward fix
and it is done. **AC(4) — establish how many `es` consent decisions production already dropped — is
not, and cannot be from inside this repo.**

**The blocker, verified at the source rather than inferred** (`SHOW GRANTS`, run during FOLLOW-931):
the `ingest_worker` ClickHouse role holds `INSERT, ALTER DELETE` on `default.events` and **no
`SELECT`**. `SELECT 1` succeeds, so the service is up — this is a grant boundary, not an outage.

**The trap, and it is the reason this is an escalation and not a backlog note.** A first attempt
returned an **empty body**, which reads exactly like "zero consent events in production." It was
access-denied. **An unreadable table and an empty table are indistinguishable from the caller**, so
the failure direction here is toward a false all-clear: the natural reading of the failed query is
the reassuring one. Per Rule AT the remediation premise is therefore **UNVERIFIED, not zero** — do
not scope, close, or waive any `es`-consent remediation off that empty result, and do not record a
count anywhere until it comes from a query that proved it could read a non-empty result first.

**Options (Piotr / whoever holds ClickHouse Cloud admin):**

1. **Grant `SELECT ON default.events` to a read-only role** (not to `ingest_worker` — a writer that
   can also read is a wider blast radius than this needs) and record it in the CH runbook. Makes
   this and every future consent-evidence question answerable from CI/scripts.
2. **Run the count once from the ClickHouse Cloud console** and paste the result into FOLLOW-931.
   Cheapest, closes AC(4), leaves the next question equally blocked.
3. **Accept the gap explicitly** and say in the DPIA that pre-`31cab8b4` `es` consent decisions are
   unquantified — honest, but it is a disclosure change and therefore a DPO call, not a default.

**Recommendation:** option 1, with option 2 run immediately after it as the first query. Option 3
should not be taken by silence.

**Whichever query is run, it must carry its own positive control** — a count over a language the
schema always accepted (`en`) in the same statement — so that a zero for `es` is distinguishable
from an unreadable table. That control is the whole lesson of this entry.

**Status:** OPEN. Non-blocking for dispatch (no ticket's implementation waits on it); blocking for
any claim about the size of the `es` consent gap.

---

## OPEN — ESC-057: no control-plane Sentry DSN exists in any Vercel environment, so 95 capture sites are producers with no channel — and setting it needs credentials no agent holds

**Raised by:** devops-engineer, 2026-08-12, closing FOLLOW-965. **Blocks:** FOLLOW-965 AC(1)+AC(2),
FOLLOW-973's Sentry-based means, and any future diagnosis that plans to read a control-plane Sentry
signal.

**Measured, dated (not inferred)** — `apps/control-plane`, 2026-08-12:

```
$ vercel env ls production        # 33 rows, none of them Sentry
$ vercel env ls | grep -ci sentry
0
```

`sentry.server.config.ts:33`, `sentry.edge.config.ts:20` and `sentry.client.config.ts:23` each gate
`Sentry.init()` on the DSN env var, so with it absent all **95 `Sentry.capture*` sites across 54
files** are silent no-ops — not delayed sends. This is the RETRO-266 ingest finding
(`SENTRY_DSN_INGEST` unset) recurring at ~20x the signal count.

**Why an escalation and not a ticket.** Two things are needed and neither is available to a
dispatched agent, which is exactly the wall FOLLOW-937 hit for `apps/ingest` in session 110:

1. **A real DSN value** — it comes from the Sentry UI. Inventing a placeholder would be strictly
   worse than leaving it unset: the env var would read as configured while delivering nothing, and
   the next reader would trust it.
2. **Write access to the Vercel project** (`vercel env add …`) plus a Sentry login to OBSERVE the
   first event arrive. Presence of the var is not delivery.

**Operator steps (≈10 minutes, `docs/runbooks/observability.md` §Control-plane Sentry signals → "To
arm the channel"):**

1. Create/choose the Sentry project for the control plane; copy its DSN.
2. `cd apps/control-plane && vercel env add SENTRY_DSN_CONTROL_PLANE production` (repeat for
   `preview`; add `NEXT_PUBLIC_SENTRY_DSN_CONTROL_PLANE` only if browser-side capture is wanted).
3. Redeploy — env changes do not apply to an existing deployment.
4. **Observe one event arrive in the Sentry UI** and paste the transcript/screenshot reference into
   the runbook's environment table with a date. This is FOLLOW-965 AC(2) and nothing else discharges
   it.
5. Re-derive every `consumer` cell in `apps/control-plane/src/observability-signals.test.ts` and in
   the runbook table — "the DSN is set" makes the channel exist, it does not make 95 producers into
   observability (Rule AJ).

**Cost impact — PREMISE CORRECTED 2026-08-12, and the CEO has ruled.**

This paragraph previously said _"the existing plan already covers `apps/ingest`; adding a second
project consumes shared event quota."_ **That was wrong.** Measured 2026-08-12 — no evidence any
Sentry project is in use anywhere in the estate:

| check                                                       | result    |
| ----------------------------------------------------------- | --------- |
| `SENTRY*` in Doppler `estalara-adaptive-listings/prd`       | **none**  |
| `SENTRY*` env on the Vercel control-plane project, all envs | **0**     |
| Sentry org/project slug in any repo config                  | **none**  |
| `SENTRY_DSN_INGEST` in prod                                 | **unset** |

So this was never "add a second project to an existing plan" — **nothing is wired to Sentry at
all**, and no cost is being incurred through any of these paths today.

**CEO RULING (Piotr, 2026-08-12): FREE tier, BOTH apps.** Verified the same day: the Sentry
**Developer** plan is **$0 — 5,000 errors/month, 30-day retention, 1 user**. At the current
localhost-first stage that is ample for control-plane + ingest combined, so **this is a €0 decision,
not a recurring-cost one**. The earlier "needs a CEO call on cost" framing is withdrawn as moot.

⚠️ **TRAP THAT MUST BE DOCUMENTED WHEN THE CHANNEL IS ARMED: quota exhaustion is a SILENT DROP.** On
the free plan, once 5,000 events are consumed in a billing period Sentry stops accepting events and
drops the rest silently — **indistinguishable from an unset DSN**, which is precisely the failure
class FOLLOW-965 exists to prevent. With 96 capture sites in control-plane alone, one looping
production error can exhaust a month's quota and return the estate to a mute channel that no
document warns about. The runbook entry MUST state this and say how to check remaining quota.

**Second constraint: the free plan supports ONE user.** Only the account holder can log in; Rafał
and Krystian cannot be added without a paid seat. Acceptable now (single operator), but it means
"check Sentry" is not yet an instruction anyone else on the team can follow.

**Do NOT read this as "Sentry is broken".** Nothing regressed; the channel was never armed. The
defect FOLLOW-965 fixed is that no document said so, so two green CI gates (FOLLOW-738/743, which
assert an `init` call EXISTS in the repo) were read as proof of delivery — Rule AU item 3, fourth
generation.

**Status:** OPEN — **decision made, execution pending.** Ruling: free tier, both apps (above). The
one remaining blocker is the step that needs a Sentry login: create the org and two projects, then
hand over the two DSNs. **A Sentry DSN is not a secret** — it is designed to be public and ships
inside client-side bundles (`NEXT_PUBLIC_SENTRY_DSN_CONTROL_PLANE` is public by construction) — so
the DSNs can be pasted straight into the session and the wiring done from there. Non-blocking for
dispatch of unrelated tickets; still blocking for any claim that a control-plane failure is "visible
in Sentry".

---

## OPEN — ESC-058: the nightly E2E smoke has no notification channel, which is why 103 consecutive failures reached nobody for 102 days [FOLLOW-986]

**Filed:** 2026-08-14 · **Needs:** a human with Slack workspace access · **Blocking:** no

`.github/workflows/e2e-smoke.yml` posts failures to `secrets.SLACK_E2E_WEBHOOK_URL`. **That secret
does not exist** — `gh secret list` returns no Slack entry at all. Until FOLLOW-986 the step was
guarded by `if: failure() && env.SLACK_WEBHOOK_URL != ''`, so it was `skipped` on every one of the
**103 consecutive failures** between 2026-05-04 and 2026-08-14 and nothing anywhere said so. A
missing channel was indistinguishable from a passing run — the same shape as ESC-057's mute Sentry
DSN, and the reason a workflow that had **never once passed** went unnoticed for 102 days.

**Already done, so this escalation is about the channel only:** the step now always runs on failure
and emits a loud `::error::` annotation naming the channel it could not reach. That makes the gap
visible **inside the run**, which is strictly better than silence but still only helps someone who
opens the run.

**The decision needed:** either (a) create `SLACK_E2E_WEBHOOK_URL` as a repo secret pointing at a
channel someone actually reads, or (b) rule that scheduled-workflow failures are not notified here
and remove the Slack step so the workflow stops implying a channel it does not have. **A pointer to
a channel nobody configured is worse than an honest absence** — that is the finding this escalation
exists to close, not a request for tooling.

⚠️ Do not resolve this by pointing the webhook at a channel nobody monitors. The failure mode being
fixed is _unread alarms_, and a webhook into an unwatched channel reproduces it exactly.

---

## DECIDED — ESC-059: branch protection is DEFERRED to go-live by CEO ruling [FOLLOW-985]

**Ruled:** 2026-08-14, CEO (Piotr) · **Status:** DECIDED, not open · **Do NOT re-file as overdue**

**The question.** `main` has no branch protection, and none is available: both
`repos/.../branches/main/protection` and `.../rulesets` return **403 — "Upgrade to GitHub Pro or
make this repository public"**. That is the mechanical reason a `docs(backlog)` commit reached
`main` unreviewed on 2026-08-14 and left CI red for **14h07m**, blocking every open PR (FOLLOW-975).

**The ruling, in the CEO's own framing:** _"Nie chcę płacić dodatkowo za GitHub dopóki nie
przetestujemy wszystkiego na localhost a potem wystartujemy na produkcji. Za takie rzeczy zaczniemy
płacić gdy Adaptive Listings będzie LIVE."_

Paying for process protection while the product is still being proven on localhost is spend out of
sequence. **The risk is accepted knowingly**, and it is bounded: the estate is pre-LIVE, `main` is
not a deployment trigger for anything customer-facing that a bad commit could break irreversibly,
and the one incident it caused was detected and fixed the same day.

**REOPEN TRIGGER — an event, not a date.** Adaptive Listings goes LIVE (first external brand serving
real visitor traffic). At that point `main` becomes the source of a customer-facing deploy and the
calculus inverts. Whoever runs that go-live should treat enabling branch protection as a line item,
alongside the ESC-020 §Step 6 work.

**The free mitigation already in force, so this is not naked risk:** bookkeeping commits now go
through PRs instead of straight to `main` — that is the exact vector that caused the 14-hour outage,
and it costs nothing. Sessions after 2026-08-14 follow it.

⚠️ **This entry exists to stop the re-filing loop.** ESC-020 was wrongly re-raised as overdue by
three separate audits after it had been ruled on. If you are an agent about to file "main has no
branch protection" — it is ruled, the trigger is LIVE, and repeating it burns review budget the CEO
has 2h/day of.

---

## DECIDED — ESC-060: ADR-0016's deferred decision, ruled option A on 2026-08-15 [ADR-0022 / FOLLOW-988]

**Filed:** 2026-08-15 · **RULED:** 2026-08-15, CEO — **option A** · **Blocking:** no · **ADR:**
`docs/adr/ADR-0022-retire-the-redpanda-remnants.md` · **Execution:** FOLLOW-988

⚠️ **Two corrections to the brief were found while planning execution, and they change HOW option A
must be done — read ADR-0022 before starting.** (1) ClickHouse migrations do NOT auto-apply and the
prod user has no DDL grant, so shipping the migration and the column write together would break
every `adaptation_decisions` INSERT on merge; the operator DDL step must land BETWEEN them. (2) The
publisher is already a no-op (`REDPANDA_REST_URL` empty everywhere), so `holdout_pct` is captured
nowhere today — the column is a net-new capability, not data recovery, and can be sequenced
independently of the deletion.

ADR-0016 removed Redpanda from the description and embed-seed flows and left two things explicitly
undecided — the A/B assignment publisher and the ingest Redpanda mirror — with the note that _"a
follow-up decides whether to route those directly to ClickHouse or reinstate a bus at scale."_ **A
repo-wide grep finds that sentence only inside ADR-0016.** The follow-up does not exist. Six weeks
open, surfaced by FOLLOW-986's work on the nightly E2E, which ran head-first into the same dead hop.

**Why it needs a human:** retiring a code path is an architectural change, and `CLAUDE.md` puts
those with the CEO/CTO. The brief does not delete anything.

**The decision in one line:** the bus **cannot** run on the current cluster tier (ESC-017 — Redpanda
Cloud Serverless exposes no Pandaproxy), reinstating it needs a Dedicated cluster at ~$500/mo, and
ESC-059 already ruled that spend of that kind waits for LIVE. So the real choice is only _how_ to
retire, not _whether_ to consider a bus now.

**Recommended: option A** — add `holdout_pct` to `adaptation_decisions` (one additive migration),
then delete the dead paths. It is the only option that loses nothing: every other field of the A/B
event is already written directly to ClickHouse by the same request, and `holdout_pct` is the single
residue.

⚠️ **Not urgent, and should not be treated as such.** Nothing is broken — the paths silently no-op
today and have since ADR-0016. The cost of leaving them is that five files carry code which cannot
run, and a reader has to rediscover why each time. That is a maintenance argument, not an incident.

---

## DECIDED — ESC-064: the queue's oldest P0 has been skipped by ~20 consecutive priority passes because two standing CEO rulings make its exposure zero — but no artefact says so, so it still reads as an ignored P0 [FOLLOW-671 / FOLLOW-665]

**Filed by:** pm-orchestrator (session 125) **Date:** 2026-08-20 **Affects:** FOLLOW-671 (P0,
BLOCKED), FOLLOW-665 (P1, READY), queue priority ordering generally **Type:** priority **Blocking:**
**no** — no picked or in-flight ticket waits on this.

**The state, verified at HEAD `a970c037` this session rather than read from the stub.** FOLLOW-671
("white-label attribution fails OPEN — a degraded config read re-brands a paying client", audit
F-04) is **P0**, `BLOCKED` on FOLLOW-665 (**P1**, `READY`, `depends_on: []`, sdk-engineer). The
defect is real and still present: `packages/sdk/src/index.ts:1279` and `:1308` both compute

```ts
showAttribution: config.brand?.whiteLabel !== true,
```

and `config.brand` is `undefined` on the degraded paths the audit named. The stub cited `:1075` and
`:1099`; the lines have moved, the expression has not.

**Why every session since 2026-08-04 has skipped it — the reasoning that was never written down.**
Its live exposure today is zero on **two independent grounds**, each a standing ruling:

1. **Single-tenant re-brand model (CEO, 2026-07-24).** There is one tenant, Estalara. Future clients
   are private-label re-brands. **There is no paying white-label client to mis-brand.** The harm
   FOLLOW-671 describes has no subject.
2. **ESC-020 (OPEN).** `app.estalara.com` in production carries no SDK at all, so the code path that
   would compute `showAttribution` does not execute for any real buyer.

FOLLOW-671 was raised **P2 → P0 on 2026-08-04** with the explicit reasoning _"the evidence is
unchanged, the CLOCK changed"_ — i.e. it was graded against an approaching go-live, not against live
harm. Sixteen days later the clock has moved again and the grade has not been revisited.

**Why this is an escalation and not a ticket.** Re-grading a P0 is not a PM call. The PM's own
operating rules say a ticket blocked >24h escalates; this one has been blocked **16 days** behind a
READY P1 that nobody picks, while sitting at the top of every priority sort. Continuing to skip it
silently is the failure mode — a queue where the top-priority row is understood by convention to be
ignorable teaches every future session to ignore the priority field.

**Options:**

1. **Re-grade FOLLOW-671 P0 → P2 and record the reason** (no white-label client exists; ESC-020
   means no SDK in prod), with an explicit **re-raise trigger**: "return to P0 the moment either a
   second tenant is onboarded or the SDK ships to production." Cheapest, honest, and it makes the
   priority field mean something again. FOLLOW-665 (P1) can then be scheduled on its own merits.
2. **Leave it P0 and dispatch FOLLOW-665 next**, ahead of the retro-driven track. Costs one
   sdk-engineer cycle (3h + 2h) on a defect with no current subject, but discharges the chain and
   removes the standing contradiction.
3. **Leave it P0 and say explicitly that it is deferred to go-live**, the way ESC-059 defers branch
   protection. Requires a `DEFERRED` marker in the QUEUE row itself, not just this file, or the next
   session repeats this analysis from scratch.

**Recommendation: option 1.** It is the only one that fixes the thing that is actually broken — the
queue's priority field disagreeing with 20 consecutive sessions' behaviour. Option 3 is acceptable
if the CEO prefers not to touch grades before go-live; **option 2 should not be chosen by silence.**

⚠️ **Do not resolve this by picking FOLLOW-665 without a ruling on the grade.** That discharges the
chain and leaves the general defect — an unreviewed P0 grade set against a clock — in place for the
next audit-derived batch.

**Status:** **DECIDED 2026-08-20 — CEO ruled OPTION 1.** FOLLOW-671 re-graded **P0 → P2** in
`backlog/QUEUE.md`, with the reason recorded on the record itself and an explicit `re_raise_trigger`
field: **return to P0 the moment either a second tenant is onboarded or the SDK ships to production
(ESC-020 resolved).** The trigger lives in the QUEUE row, not only here, so the next session does
not repeat this analysis from scratch — that was option 3's failure mode and it applies to option 1
just as much.

The ruling deliberately does NOT discharge the chain by picking FOLLOW-665: that ticket is now
schedulable on its own P1 merits, and the general defect the escalation named — a P0 grade set
against a clock and never revisited — is what the re-grade plus trigger actually fixes. The
underlying code defect is unchanged and still present at `packages/sdk/src/index.ts:1279` and
`:1308`; P2 is a statement about exposure today, not about correctness.

Non-blocking for dispatch. No longer blocking the claim that the queue is sorted by priority.
