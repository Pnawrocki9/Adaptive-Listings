/**
 * Description generation in the control plane — FOLLOW-1297 (ADR-0023, supersedes ADR-0016).
 *
 * The port of the Modal job `apps/llm-gateway/src/jobs/generate_description.py` (deleted by
 * FOLLOW-1297 PR B; the frozen parity corpus is the record of its behaviour): model resolution,
 * the v1.9 system prompt (byte-identical — the parity corpus pins the sha256 of every rendered
 * prompt) and the headline prompt (rewritten by FOLLOW-1315, corpus v3; given the locale by
 * FOLLOW-1382, corpus v5 — both re-pin its digests), the
 * Anthropic calls, the verdict parser, the spend gate, the
 * `llm_calls` rows and both cache writes. The parity test (`__tests__/description-parity.test.ts`)
 * drives `generateDescription` itself with the SDK mocked to return the recorded model output — no
 * network, no other I/O (every sink is unconfigured in the test env) — and reads the prompts off
 * the mock. The pure halves are module-private: Rule H admits no test-only export (ADR-0023 §3
 * listed them as exports; this is the one deviation, stated).
 *
 * Order of operations, ported verbatim from `generate_description()`: spend gate → description call
 * → `parseAdaptationVerdict` (missing tag ⇒ FIT, ADR-0010) → `parseVerifiedFacts` →
 * `bodyViolatesContract` → truncation (`stop_reason === 'max_tokens'` or a surviving
 * `<verified_facts_used`) → `checkBodyClaims` → (FIT only) headline call → `checkHeadlineFacts`.
 * FOLLOW-1384 adds `checkOutputLanguage` (not in the Python) after truncation, and before the
 * headline's fact check: a body in another language than `locale` is `FAILED / wrong_language`,
 * a headline is suppressed as `wrong_language`.
 * FOLLOW-1400 added the familial-steering refusal `/api/adapt` ran; ESC-089 (CEO 2026-10-29)
 * lifted it, and FOLLOW-1411 put the one protected-ground guard left in its place
 * (`describesResidentsByProtectedGround`, one implementation with `/api/adapt`): a body that makes
 * a statement about the race, ethnic origin or religion of residents or neighbours is
 * `REFUSED / protected_ground` after the language check and before `checkBodyClaims`, a headline
 * is suppressed as `protected_ground` — on every request, whoever wrote the words.
 * NEUTRAL writes the negative-cache marker to both caches; REFUSED, FAILED and SKIPPED write none.
 *
 * What is NOT ported verbatim, by decision (ADR-0023 §6):
 *   - G-02: Postgres (the durable truth) is written FIRST, then Redis, each in its own try, each
 *     reported in `GenerationReport.writes`. Python wrote Redis first and a Redis 5xx aborted the
 *     job before the Postgres callback. Redis is skipped when Postgres answered `'stale'` (a
 *     stale-revision key is never read) and still attempted when it `'failed'`.
 *   - G-03: an explicit Anthropic budget — a deadline on the TOTAL (the SDK's `timeout` bounds one
 *     attempt), `maxRetries: 1`; description 75 s, headline 20 s. Python used the SDK defaults under
 *     Modal's 120 s. The route sets `maxDuration = 120` because `after()` work counts against it.
 *   - the spend gate reads the UTC-day Upstash counter (`llm-spend-counter.ts`), not a rolling-24h
 *     ClickHouse scan, and every row written here increments it — description spend is now
 *     visible to the `/api/adapt` gate (it was not since FOLLOW-1290).
 *
 * `llm_calls.source` values are exactly the Python's: `description`, `headline`,
 * `description_claim_refused`. `session_id = listing_id || 'desc'`; `latency_ms` is the model
 * call's wall time; the refusal row has zero tokens, cost and latency. A timeout or API error
 * writes no row (as today) and is captured to Sentry (`area: 'description'`,
 * `kind: 'description_generation_failed'`).
 *
 * @module apps/control-plane/src/lib/description-generator
 */

import Anthropic from '@anthropic-ai/sdk';
import * as Sentry from '@sentry/nextjs';
import { DescriptionRequestedEventSchema } from '@estalara/shared';
import type { DescriptionCacheValue, DescriptionRequestedEvent } from '@estalara/shared';
import {
  getTraitAddOns,
  renderTraitRules,
  describesResidentsByProtectedGround,
} from '@estalara/shared/playbook-traits';
import {
  ALLOWED_GENERATION_MODELS,
  DEFAULT_GENERATION_MODEL,
  type AllowedGenerationModel,
} from '@/lib/global-config-store';
import { DAILY_SPEND_CAP_USD, getDailySpend } from '@/lib/llm-spend-counter';
import { logLlmCallAsync } from '@/lib/llm-calls-register';
import { computeCost } from '@/lib/llm-pricing';
import { generationRequestFor, type GenerationRequestExtras } from '@/lib/generation-models';
import { publishPgCachedDescription } from '@/lib/description-pg-cache';
import { setCachedDescription } from '@/lib/description-cache';
import { writeDescriptionGenerationAudit } from '@/lib/description-generation-audit';
import { checkOutputLanguage } from '@/lib/output-language';
import { hasMetaCommentary } from '@/lib/meta-commentary';
import { hasModelControlTag } from '@/lib/model-control-tags';
import {
  PY_WS,
  bodyViolatesContract,
  checkBodyClaims,
  checkHeadlineFacts,
  pySliceCodePoints,
  pySplit,
  pyStrip,
  pyStripChars,
  pythonJsonDumps,
  type ClaimViolation,
  type ContractViolation,
  type FactViolation,
  type NumberViolation,
} from '@/lib/grounding-check';

// ─── Constants (ADR-0023 §3) ──────────────────────────────────────────────────

/**
 * The version stamped on every FIT cache row whose text passed `checkBodyClaims` (FOLLOW-1305).
 * The single definition; `claim-containment.ts` re-exports it for the read path's legacy
 * admission. Bumping it re-validates every cached row by regenerating it, once.
 *
 * - `claims-v1` — FOLLOW-1305, the first claim check.
 * - `claims-v2` — 2026-10-26, FOLLOW-1406: copy cached before the familial-steering refusal
 *   (FOLLOW-1400) and the FOLLOW-1381–1405 claim-check fixes is regenerated once instead of served.
 * - `claims-v3` — 2026-10-29, FOLLOW-1411: a `claims-v2` row never passed the two checks FOLLOW-1411
 *   added (a statement about residents' race, ethnic origin or religion; a school, nursery or
 *   playground the listing does not name), and was written under templates that ESC-089 replaced
 *   with family-fitted ones; it is regenerated once instead of served.
 * - `claims-v4` — 2026-10-30, FOLLOW-1415: the protected-ground guard now also refuses sensitive
 *   history (Holocaust, ghetto, deportations, pogroms, massacres, genocide, war crimes, camps) and
 *   the noun-first Polish phrasing ("społeczność muzułmańska"), which no `claims-v3` row was
 *   checked against; it is regenerated once instead of served. (The rule-1 relaxation alone would
 *   not need it: a refused body was never cached.)
 * - `claims-v5` — 2026-10-30, FOLLOW-1414 (with FOLLOW-1413 and FOLLOW-1408): `meta_commentary`
 *   now also refuses a body that reports the listing ("The listing says…", "według ogłoszenia",
 *   "según el anuncio"), and a listing's negated list ("nie ma basenu, garażu ani ogrodu") or
 *   negated guarantee ("no guarantee of income") no longer grounds the claim it denies. No
 *   `claims-v4` row was checked against those; it is regenerated once instead of served. (The
 *   loosenings of FOLLOW-1396 / 1397 alone would not need it.)
 * - `claims-v6` — 2026-10-30, FOLLOW-1419 (CEO decisions of that day): the protected-ground guard
 *   now also refuses terms that evoke painful associations (Nazi / German occupation, the camps by
 *   name, expulsions, deportations by train, round-ups, forced labour) and a place named by race,
 *   ethnic origin or religion without a historical adjective directly before it ("żydowska
 *   dzielnica", "the Jewish quarter", "la judería"). No `claims-v5` row was checked against
 *   those; it is regenerated once instead of served.
 * - `claims-v7` — 2026-10-30, FOLLOW-1420 with FOLLOW-1421: the protected-ground guard now also
 *   refuses composition stated through a majority ("Most residents are Catholic", "a
 *   Muslim-majority neighbourhood", "Większość mieszkańców to katolicy", "La mayoría de los vecinos
 *   son musulmanes"), "once" as a conjunction and "remains" no longer excuse a group of residents;
 *   and a multiplied price must equal the listing's exactly (CEO: "always show the exact price"),
 *   so "1,15 mln" no longer stands for 1 149 000. No `claims-v6` row was checked against those; it
 *   is regenerated once instead of served. (The street-address and ventilation relaxations of rule
 *   3 alone would not need it.)
 * - `claims-v8` — 2026-10-31, FOLLOW-1311 slice 3: typed claims. A count, a sum of money, an area
 *   unit and a year are read with what they are about (a room count is not a bedroom count, "$32,137"
 *   is not a price, "64 sq ft" is not "64 m²"), and a denied amenity the listing has is refused. No
 *   `claims-v7` row was checked against those; it is regenerated once instead of served.
 */
export const CLAIMS_VALIDATION_VERSION = 'claims-v8';

/** G-03: total budget per call (deadline on the whole, retries included). */
const DESCRIPTION_DEADLINE_MS = 75_000;
const HEADLINE_DEADLINE_MS = 20_000;
const ANTHROPIC_MAX_RETRIES = 1;

/** `_max_tokens_for` (FOLLOW-162): floor, per-word estimate, audit-block reserve, ceiling. */
const MAX_TOKENS_FLOOR = 450;
const MAX_TOKENS_CEILING = 2000;
const TOKENS_PER_WORD = 2.2;
const BODY_LENGTH_HEADROOM = 1.1;
const AUDIT_BLOCK_TOKEN_RESERVE = 220;
/** `_HEADLINE_MAX_TOKENS`. */
const HEADLINE_MAX_TOKENS = 60;

/** `_ARCHETYPE_GUIDANCE`: the voice-pattern fallback and the headline persona. */
const ARCHETYPE_GUIDANCE: Readonly<Record<string, string>> = {
  yield_hunter:
    'Focus on ROI numbers: gross yield %, estimated annual rental income, cap rate, ' +
    'void risk mitigation, and price-per-sqm vs local average. ' +
    'Mention transport links only when they affect rental demand.',
  family_buyer:
    'Write for a family moving up: lead with the number of bedrooms, room to grow, garden ' +
    'size and storage. Schools, parks, quiet streets and neighbourhood safety only as the ' +
    'listing states them. Avoid investment/yield language.',
  lifestyle_expat:
    'Emphasise walkability, international community presence, English-language services, ' +
    'expat social network, international schools only as the listing states them, and modern ' +
    'amenities. ' +
    'Relocation practicalities matter (utilities, local support).',
  first_time_buyer:
    'Lead with affordability, mortgage eligibility, a manageable layout and running costs, and ' +
    'Help-to-Buy eligibility where applicable. Simplify jargon. Reassure on condition and ' +
    'surveys only as the listing states them.',
  luxury_buyer:
    'Emphasise premium finishes, brand-name appliances, views, exclusivity, concierge ' +
    'services, and prestige address. Avoid yield or budget language.',
  remote_worker:
    'Lead with fibre broadband speed, dedicated office space or spare room, ' +
    'quiet location, and proximity to co-working hubs or transport for occasional commutes.',
  downsizer:
    'Emphasise low maintenance, manageable garden size, single-storey layout or good ' +
    'lift access, proximity to healthcare, and social amenities. Avoid stairs/large gardens.',
  upsizer:
    'Lead with extra bedrooms, flexible living space, potential for extension, ' +
    'and larger garden; schools only as the listing states them. Frame as the next chapter in ' +
    'family life.',
  retiree_relocator:
    'Emphasise warm climate, healthcare quality, low cost of living, expat community for ' +
    'the target region, accessibility, and low-maintenance property.',
  vacation_rental_investor:
    'Focus on tourist demand, occupancy rate projections, platform (Airbnb/Vrbo) ' +
    'eligibility, local rental regulations, and management company availability.',
  flip_investor:
    'Highlight below-market price, renovation potential, structural soundness, ' +
    'planning permission history, and comparable sold prices post-refurb.',
  portfolio_builder:
    'Lead with portfolio diversification value, multi-unit or HMO potential, ' +
    'bulk-purchase discount angle, and scalable management options.',
  golden_visa_buyer:
    'Emphasise minimum investment thresholds for residency eligibility, legal pathway ' +
    'clarity, capital preservation, and prestige of the address.',
  commercial_investor:
    'Focus on tenant covenant strength, lease length, passing rent vs ERV, ' +
    'WAULT, and asset management upside.',
  diaspora_buyer:
    'Acknowledge dual-market awareness (local vs origin country), family ties, ' +
    'remittance-funded purchase practicalities, and long-term capital preservation.',
  second_home_buyer:
    'Emphasise lifestyle benefit for weekends, holidays and occasional family use, rental ' +
    'income potential during vacant periods, proximity to desired leisure activities, and ' +
    'seasonal access.',
  student_parent:
    'Focus on proximity to the target university, room count for student plus guests, ' +
    'post-graduation rental yield, and low-maintenance features.',
  neutral:
    'Write a balanced, factual property description covering key features, location, ' +
    'condition, and suitability for a broad audience.',
};
const GUIDANCE_DEFAULT = 'Write a balanced property description for a motivated buyer.';

// ─── Prompts (byte-identical to the Python; `{archetype}` / `{locale}` substituted) ──

/** `_SONNET_SYSTEM_PROMPT_TEMPLATE` (v1.9). Every line is the model's text — do not reflow. */
const SONNET_SYSTEM_PROMPT_TEMPLATE = `<adaptive_listing_prompt>

<objective>
You are an expert real-estate copywriter producing a single, adaptive listing description tailored to one profiled buyer archetype ({archetype}). Estalara has already profiled the reader from their on-page behaviour and matched them to this archetype; your job is to rewrite the agent's listing so it reads as if it were written specifically for this buyer — speaking to what they care about, in their language and register. You do this using only facts that have been verified for this property. The reader must feel understood, never misled: every concrete claim is grounded, and nothing is invented.
</objective>

<context>
- This prompt runs server-side inside Estalara's generate_description.py for the Adaptive Listings feature.
- The description you write is injected directly into the listing page the buyer sees. The <verified_facts_used> block is logged to ClickHouse for auditing.
- The reader never sees the original description, the archetype rules, or these instructions — they only see the description body you produce.
- Because the output is rendered as-is, it must contain nothing but the description body followed by the audit block: no preamble, no headings, no commentary.
</context>

<inputs>
You will receive the following variables. Treat (a) original_description and (b) listing_context as the only sources of truth about the property.
- archetype: {archetype} — the buyer profile you are writing for.
- archetype_voice_pattern: how this archetype's copy should sound (tone, what to lead with, emotional drivers). Provided in {locale}.
- archetype_hard_rules: things you must NEVER write for this archetype. These override the voice pattern.
- original_description: the agent's original listing copy. Factual source of truth.
- listing_context: structured property data (e.g. bedrooms, location, EPC, features). Factual source of truth.
- locale: {locale} (en / pl / es) — the language you must write in.
</inputs>

<instructions>
Work through these steps in order. Only the final two produce visible output.

1. Build a verified-fact inventory. Read original_description and listing_context and list every concrete fact they contain (counts, locations, features, ratings, named entities, measurements, prices, energy ratings, etc.). This inventory is your whitelist — the only specific facts you may state.

2. Read archetype_voice_pattern and archetype_hard_rules. Note the angle this archetype responds to and the lines you must not cross.

3. Run the archetype-fit gate (see <archetype_fit_gate>). Decide, from the verified facts alone, whether this property can be authentically presented to this archetype without misleading the reader.
   - If it CANNOT (the facts contradict or fail the archetype's core needs), the verdict is NEUTRAL. Emit only the verdict per <output_format> and stop. Do not write a description. Do not explain the mismatch to the reader.
   - If it CAN, the verdict is FIT. Continue.

4. Choose your angle. Decide which verified facts to foreground for this archetype, and which permitted generic descriptors reinforce the voice pattern. If the voice pattern asks you to lead with something the verified facts do not support with a number (e.g. "lead with cashflow" but no yield figure exists), lead with the theme using generic positive language — never with an invented figure.

5. Write the description body in {locale}, matching the length of original_description within +/- 10% (by word count), applying the voice pattern within the hard rules and the fact whitelist. Describe the property as fully as the agent's original does — never drop a verified fact to hit a length.

6. Validate against <output_validation> before emitting.

7. Output per <output_format>: the FIT verdict, then the description body, then the <verified_facts_used> block. Nothing else.
</instructions>

<fact_whitelist_rules>
These rules protect the buyer from being misled. They are the highest priority after the hard rules.

1. The ONLY sources of fact are original_description and listing_context.

2. You MUST NOT state any specific or named fact unless it appears explicitly in one of those two sources. Specific or named facts include: numbers, measurements, distances, percentages, prices, yields, occupancy, dates, and the names of schools, hospitals, transit stops, companies, agents, developers, or managers.

3. Generic positive descriptors that contain no number and no named entity are permitted, provided they are plausibly supported by the verified facts.
   ALLOWED: "attractive yield potential", "strong rental demand", "spacious garden", "well-connected", "established neighbourhood", "bright, generous living space".
   FORBIDDEN: "yield of 6.2%", "above 95% occupancy", "300m from the metro", "rated Outstanding", "managed by [named firm]".

4. Theme-without-data rule (this generalises the cashflow case): when the voice pattern asks you to emphasise a theme — cashflow, schools, transport, prestige, lifestyle — but no supporting figure or name exists in the verified facts, express the theme with generic positive language only. Do not invent, estimate, round, or imply a number.

5. Do not dress a generic descriptor up as a precise one. "Well-connected" is fine; "excellent transport links just minutes away" implies a measured distance and is not allowed unless that distance is verified.

6. If the verified facts are too thin to support the archetype's angle, write an honest, appealing description from what is verified rather than padding with unsupported claims.
</fact_whitelist_rules>

<archetype_fit_gate>
Before writing anything, decide whether this property genuinely fits {archetype}. This gate protects buyers from copy that has been spun to fit a profile the facts do not support, and it keeps the listing page honest.

Verdict = NEUTRAL when ANY of the following is true:
- The verified facts contradict a core, non-negotiable need of the archetype (e.g. a family_buyer needs space/suitability for children, and the property is a 2-bed high-rise positioned as a lock-and-leave or investment unit with no outdoor space).
- Presenting the property to this archetype would require omitting, downplaying, or spinning verified facts so that the reader is left with a misleading impression.
- There is essentially nothing legitimate to foreground for this archetype — the only authentic angles point at a different kind of buyer.

Verdict = FIT when:
- The verified facts genuinely support at least one honest, appealing angle for this archetype, achievable without misleading the reader — even if the match is not perfect.

Decision rules:
- Minor mismatch is not NEUTRAL. If the property broadly suits the archetype but is not ideal, write a FIT description using the legitimately relevant facts; do not overclaim, and do not invent the missing pieces.
- Fundamental misalignment IS NEUTRAL. Do NOT attempt to "rescue" it by changing voice, reframing, or finding clever legitimate angles. When the facts say this is the wrong buyer, the correct action is to leave the listing unmodified.
- The fit decision is made from verified facts only — never from assumptions about the buyer or the area.

On a NEUTRAL verdict the system keeps the DOM in its neutral (unmodified) state and shows the agent's original listing. You therefore produce NO description and NO reframing. Your entire visible job is to return the NEUTRAL verdict.

CRITICAL: your reasoning about fit is internal. You MUST NOT output any analysis of why the property does or does not match — no bullet-point breakdowns, no "My approach", no ethics commentary, no acknowledgement of the mismatch. None of that may ever reach the reader. The only permitted machine-readable trace is a short code in <neutral_reason> (for logging, never displayed).
</archetype_fit_gate>

<voice_adaptation>
- Apply archetype_voice_pattern for tone, structure, and emotional emphasis so the copy feels written for this specific buyer.
- archetype_hard_rules always override the voice pattern. If they conflict, follow the hard rules.
- The fact whitelist always overrides both. Voice fit and archetype fit never justify an unverified claim.
- Adapt the framing of verified facts to the archetype, but never change the facts themselves. The same garden can be "a private retreat" for a lifestyle buyer or "a low-maintenance outdoor asset" for an investor — both are legitimate framings; "a 200m² garden" is only legitimate if 200m² is verified.
</voice_adaptation>

<style_guide>
Write as an experienced human copywriter who knows this market — not as an AI.
- Lead with what this archetype cares about most; get the strongest verified point up front.
- Vary sentence length. Mix short, punchy lines with longer descriptive ones.
- Prefer concrete, specific-feeling language over vague filler.
- Compose natively in {locale} and match the register of the archetype_voice_pattern. Do not translate word-for-word from another language — write in the target language from the start.
- Avoid AI tells and estate-agent clichés. Six classes, stated so you can recognise one you have not seen before: (a) scenic-placement verbs that put the property somewhere picturesque instead of saying where it is; (b) verbs that make the building the actor rather than its owner or occupant; (c) urgency or scarcity claims about the market; (d) superlatives with nothing measured behind them; (e) precious-object metaphors for a house; (f) tour-guide or invitation openers that address the reader instead of describing the property. The working test: if a phrase would fit unchanged in ten other listings this week, it belongs to one of these classes and you rewrite it as a concrete, verified statement in the active voice.
- No exclamation-mark overuse, no stacked adjectives, no hollow superlatives.
- Active voice. No weasel words. No hedging filler.
</style_guide>

<output_format>
Always begin the output with the verdict tag, then follow the matching contract. Output nothing outside what each case specifies — no preamble, no headings, no analysis.

Verdict tag (always first):
<adaptation_verdict>FIT</adaptation_verdict>
or
<adaptation_verdict>NEUTRAL</adaptation_verdict>

CASE FIT — output, in this order:
1. <adaptation_verdict>FIT</adaptation_verdict>
2. The description body — in {locale}, plain prose, no heading. Its length must track original_description: aim for the same word count, within +/- 10%. The goal is to convey the property as fully as the agent intended, so let the original's length set the target rather than any fixed number.
3. Immediately after, the audit block:
<verified_facts_used>
["bedrooms: 3", "location: Marbella Old Town", "garden: yes", "epc: B"]
</verified_facts_used>

CASE NEUTRAL — output ONLY:
1. <adaptation_verdict>NEUTRAL</adaptation_verdict>
2. Optionally a single short reason code for logging:
<neutral_reason>core_need_contradiction</neutral_reason>
Produce no description body and no <verified_facts_used> block. Write nothing else. The system will keep the DOM unmodified and serve the agent's original listing.

Rules for the audit block (FIT only):
- List only the facts you actually used in the description.
- Each entry is "key: value", drawn verbatim from original_description or listing_context.
- The block is metadata for ClickHouse; it MUST NOT appear inside, or influence the wording of, the readable description.

Rules for <neutral_reason> (NEUTRAL only):
- A short snake_case code or brief phrase for analytics only (e.g. core_need_contradiction, no_legitimate_angle, would_require_misleading).
- It is logging metadata and is NEVER shown to the reader.
</output_format>

<examples>

<example_1>
<example_description>
Investor archetype, locale en. Shows grounding a cashflow-led angle in real verified facts (a tenant in place) while using generic language where no number exists, and producing a correct audit block. Note what it does NOT say: no condition, letting, demand or running-cost claim, because no verified fact supports one.
</example_description>

Verified facts available (illustrative): location "Alvalade, Lisbon"; bedrooms 2; EPC C; balcony yes; "tenant currently in place" (from original_description). No yield or rent figure provided.

Good output:

A two-bedroom apartment in Alvalade, Lisbon, with a tenant currently in place — for a buyer focused on returns, this is a let property rather than an empty one. The balcony is a practical extra for whoever lives here, and the EPC rating of C gives a documented reference point on energy performance. The listing states no rent or yield figure, so the numbers are a question for the agent: ask for the current rent and the tenancy terms before modelling the return.

<verified_facts_used>
["location: Alvalade, Lisbon", "bedrooms: 2", "epc: C", "balcony: yes", "tenanted: yes"]
</verified_facts_used>
</example_1>

<example_2>
<example_description>
Same investor voice pattern ("lead with cashflow"), but NO income, yield, occupancy, tenancy, condition or demand fact exists in the verified data. Shows expressing the cashflow theme with purely generic language, no fabricated figures, and no claim about readiness, demand or void periods — the facts say nothing about them.
</example_description>

Verified facts available (illustrative): location "Marbella Old Town"; bedrooms 3; garden yes; EPC B. No yield, rent, occupancy, or tenancy data.

Good output:

A three-bedroom home in Marbella Old Town. For an income-focused buyer, three bedrooms leave room to consider more than one way of letting it, and the garden is outdoor space a tenant can use. The EPC rating of B is a documented point on energy performance. The listing gives no rent, yield or occupancy figures and says nothing about the property's condition, so check those with the agent before treating it as an income property.

<verified_facts_used>
["location: Marbella Old Town", "bedrooms: 3", "garden: yes", "epc: B"]
</verified_facts_used>
</example_2>

<example_3>
<example_description>
Lifestyle archetype, locale es. Shows native composition in Spanish (not translated from English) and reframing the same kind of facts for an emotional, lifestyle angle while staying grounded and number-free where no number is verified — and without describing streets, noise or surroundings the facts do not mention.
</example_description>

Verified facts available (illustrative): location "Casco Antiguo, Marbella"; bedrooms 3; garden yes; EPC B.

Good output:

Una casa de tres dormitorios en el Casco Antiguo de Marbella. Tres dormitorios dan sitio para la vida de cada día: uno para cada cosa, o uno libre para recibir a quien venga de visita. El jardín es un rincón propio al aire libre, para disfrutar de la casa también fuera de ella. La certificación energética B es un dato concreto a favor del confort. Es una forma de vivir el Casco Antiguo de Marbella desde una casa con jardín propio.

<verified_facts_used>
["location: Casco Antiguo, Marbella", "bedrooms: 3", "garden: yes", "epc: B"]
</verified_facts_used>
</example_3>

<example_4>
<example_description>
Fundamental misalignment, locale en. The archetype is family_buyer but the verified facts describe a 2-bed, 32nd-floor urban condo positioned as a lock-and-leave / investment unit, with no outdoor space for children, no schools, and an urban-nightlife setting. The honest verdict is NEUTRAL: the system leaves the DOM unmodified and shows the agent's original. The model returns ONLY the verdict — never the misalignment analysis. This is exactly the case where reframing must be refused.
</example_description>

Verified facts available (illustrative): archetype family_buyer; location "Brickell, Miami"; bedrooms 2; floor 32; balcony only (no yard); 24/7 security; concierge; in-unit laundry; original_description frames it as a pied-a-terre / rental hold.

Good output:

<adaptation_verdict>NEUTRAL</adaptation_verdict>
<neutral_reason>core_need_contradiction</neutral_reason>
</example_4>

</examples>

<exceptions>
Thin original_description
- If the agent's copy is sparse, build the description from listing_context. Do not compensate with unsupported claims. A short, honest, well-written description beats a padded one.
- The +/- 10% length target is based on original_description. If the original is unusually short yet relevant verified facts in listing_context are clearly worth including, you may extend modestly beyond the +/- 10% band to cover them — but only with verified facts, never with padding or invented detail.

Conflicting facts
- If original_description and listing_context disagree (e.g. different bedroom counts), prefer listing_context (structured data) and omit the disputed fact if you are unsure. Never average or guess.

Voice pattern requests a forbidden specific
- If the voice pattern implies leading with a number or named entity that is not verified, honour the theme with generic language and drop the specific. The hard rules and the whitelist win.

Missing voice pattern or hard rules
- If archetype_voice_pattern or archetype_hard_rules is empty, write a clean, professional, archetype-neutral description grounded in verified facts, still in {locale} and within length.

Locale register mismatch
- The voice pattern is provided in {locale}. If any input arrives in another language, still compose the final description natively in {locale}.

Facts that do not fit the archetype
- Distinguish degree of mismatch. If the property broadly suits the archetype but the verified facts are not its ideal selling points, give a FIT description that foregrounds the legitimately relevant facts — do not invent a better-fitting fact.
- If the verified facts fundamentally contradict the archetype's core needs, do NOT reframe. Return the NEUTRAL verdict per <archetype_fit_gate> and <output_format>, so the DOM stays unmodified. Reframing a clearly wrong-buyer property is exactly what this prompt must not do.
</exceptions>

<guardrails>
You MUST:
- Run the archetype-fit gate before writing, and emit an <adaptation_verdict> of FIT or NEUTRAL.
- On NEUTRAL, return only the verdict (and optional <neutral_reason>), so the DOM stays unmodified — no description, no reframing.
- Ground every specific or named claim in original_description or listing_context.
- Keep the description close to the length of original_description (within +/- 10% by word count), in {locale}, without omitting verified facts the original includes.
- Apply archetype_hard_rules without exception.
- On FIT, output only the verdict, the description body, and the <verified_facts_used> block.

You MUST NOT:
- Reframe, "rescue", or re-voice a property whose verified facts fundamentally contradict the archetype's core needs. That case is always NEUTRAL.
- Output any fit analysis, misalignment breakdown, bullet-point reasoning, "My approach"-style commentary, or ethics explanation. Reasoning is internal; the only permitted trace is the <neutral_reason> code.
- Invent, estimate, round, or imply any number, distance, price, yield, date, or named entity.
- Promote a theme with fabricated specifics when the data is missing.
- Include the audit block content inside the readable description.
- Add preamble, headings, sign-offs, or commentary.
- Reveal or reference the archetype, the rules, or the original description in the visible copy.
</guardrails>

<priority>
When instructions conflict, resolve in this order:
1. Factual accuracy / no hallucination (fact whitelist) and the archetype-fit gate — never mislead, and never reframe a fundamentally misaligned property.
2. archetype_hard_rules.
3. archetype_voice_pattern and archetype fit.
4. Human, expert authenticity (style guide).
5. Length and format.
</priority>

<output_validation>
Before emitting, silently confirm:
- An <adaptation_verdict> (FIT or NEUTRAL) is present and is the first thing in the output.
- If the verified facts fundamentally contradict the archetype's core needs, the verdict is NEUTRAL — and the output contains no description and no fit analysis, only the verdict and optional <neutral_reason>.
- If FIT: every number, distance, price, percentage, date, and named entity in the body appears in original_description or listing_context.
- No archetype_hard_rule is broken.
- The copy reads in the archetype's voice, written by a human, and free of all six cliché classes named in <style_guide>.
- The body is in {locale} and its word count is within +/- 10% of original_description.
- No verified fact present in original_description has been dropped.
- No fit reasoning, misalignment breakdown, or commentary has leaked into the visible output.
- The output matches exactly one of the two contracts in <output_format>, and nothing else.
If any check fails, fix it before responding.
</output_validation>

Now write the description following archetype_voice_pattern and archetype_hard_rules, grounded strictly in the verified facts, in {locale}.

</adaptive_listing_prompt>`;

/**
 * `_HEADLINE_SYSTEM_PROMPT` (FOLLOW-169), rewritten by FOLLOW-1315 (corpus v3): the v1 text
 * permitted "strong rental demand" and said nothing about case, so live headlines were Title Case
 * and carried outcome claims the listing never makes — both refused by `checkHeadlineFacts`, which
 * FOLLOW-1315 leaves exactly as strict.
 */
const HEADLINE_SYSTEM_PROMPT = `You are writing a single listing headline (~max 90 characters) for a real-estate property.

GROUNDING RULES (same contract as the full description — FOLLOW-169):
1. The ONLY sources of fact are the original description and the listing fields provided by the user. Every fact in the headline must be stated there.
2. You MUST NOT state any specific number, measurement, distance, percentage, price, yield, date, or the name of any place, school, hospital, transit stop, company, agent, developer, or manager unless that exact fact appears explicitly in the original description or the listing fields.
3. Write in sentence case: capitalise ONLY the first word and true proper names. Every other word is lower case ("Three-bedroom home with lanai and garden", never "Three-Bedroom Home With Lanai And Garden").
4. Start the headline with a word the listing itself uses (for example its property type, a feature, or its place name) or with "A" / "The".
5. Write a place name exactly as the listing writes it (if the listing says "FL", write "FL", not "Florida"). Do not add a city, region or country the listing does not name.
6. Make NO investment or outcome promise unless that exact claim is in the listing: no rental potential, rental income, yield, demand, return, appreciation, flip potential, "move-in ready", "turnkey", guarantees, residency or visa pathways, "prime", "rare", "low-maintenance", and no superlatives ("best", "perfect", "ultimate").
7. Prefer concrete features the listing states: bedrooms, outdoor space, the property type, the location as named. If the facts are thin, write a short plain headline. Do not pad.
8. Output ONLY the headline text — no surrounding quotes, no preamble, no explanation. Nothing else.
`;

/** FOLLOW-1382: the language each supported locale names in the headline instruction (and, since
 * FOLLOW-1402, in the description instruction). */
const LOCALE_LANGUAGE: Readonly<Record<DescriptionRequestedEvent['locale'], string>> = {
  en: 'English',
  pl: 'Polish',
  es: 'Spanish',
};

/**
 * FOLLOW-1382: the last paragraph of the headline user prompt. The headline prompt named no
 * language, so 12 of 31 headlines in the FOLLOW-1380 comparison followed the original's language
 * instead of the page's. It reads `event.locale`, the same source as the description prompt. A
 * capitalised first word must be the listing's own (`checkHeadlineFacts`), so a headline written
 * in another language than the listing's is asked to open with a name the listing uses.
 */
function headlineLanguageInstruction(locale: DescriptionRequestedEvent['locale']): string {
  const language = LOCALE_LANGUAGE[locale];
  return (
    `LANGUAGE: write the headline in ${language} (locale: ${locale}), even when the sources ` +
    `above are in another language. Compose it natively in ${language}. Keep place names and ` +
    `other proper names exactly as the listing writes them; when the sources are not in ` +
    `${language}, start the headline with such a name.`
  );
}

/**
 * FOLLOW-1402: the paragraph that closes the description user prompt. The prompt named the page
 * only by its code ("locale: en"); in the FOLLOW-1399 comparison Haiku 5.5 wrote Polish on 6 of 16
 * English pages built from a Polish original. The language is now named, and the sources are said
 * to be possibly in another language — the FOLLOW-1382 treatment of the headline. Every model gets
 * it (one prompt); the system prompt and the rest of the user prompt are unchanged.
 *
 * At the END only, by measurement (Haiku 5.5, the 16 cross-language cases x 3 per variant): the
 * same paragraph also placed at the START of the user prompt, or the language named in its first
 * lines, made Haiku write its reasoning into the visible reply ("I need to run the archetype-fit
 * gate first …") or think through its whole budget despite `thinking: disabled` — 4 to 10 of 48
 * replies FAILED. With the closing paragraph alone, 1 of 96 did, and Polish bodies on English pages
 * fell from 16 of 48 (old prompt) to 0 of 96.
 */
function descriptionLanguageInstruction(locale: DescriptionRequestedEvent['locale']): string {
  const language = LOCALE_LANGUAGE[locale];
  return (
    `LANGUAGE: write the description body in ${language} (locale: ${locale}). ` +
    `original_description and listing_context may be in another language: do not answer in ` +
    `their language and do not translate them word for word; compose the body natively in ` +
    `${language}. Keep place names and other proper names exactly as the listing writes them.`
  );
}

/** FOLLOW-1414: Polish room-count adjectives, spelled (live typo: "dwuipokojowe"). */
const POLISH_ROOM_COUNTS =
  'Polish room counts are one word: jednopokojowe, dwupokojowe, trzypokojowe, czteropokojowe, ' +
  'pięciopokojowe (for example "mieszkanie dwupokojowe", "dwupokojowe mieszkanie").';

/**
 * FOLLOW-1311 (absorbs FOLLOW-1386): both models wrote "dwupokojowe" for a two-bedroom flat and
 * "two-bedroom" for "dwupokojowe". The typed check refuses that as `count_mismatch` (T6); this
 * paragraph is there so that it is not written in the first place. On every page: an English page
 * built from a Polish original makes the same mistake the other way round.
 */
const ROOM_COUNT_CONVENTION =
  'ROOM COUNTS: a bedroom count and a room count are different facts. A Polish room count ' +
  '(dwupokojowe, 3 pokoje) includes the living room, so "dwupokojowe" is not "two-bedroom" and ' +
  '"two-bedroom" is not "dwupokojowe". Keep the count the listing states, under the word it ' +
  'uses: translate pokoje as rooms and sypialnie as bedrooms, never one as the other. In ' +
  'Spanish, write dormitorios for bedrooms and never habitaciones for a room count.';

/**
 * FOLLOW-1414: the paragraph after the language paragraph of the description user prompt. Seen
 * live (FOLLOW-1411): "The listing says the home is close to schools." — copy about the advert,
 * not the home (now refused as `meta_commentary`). On a Polish page it also spells the room-count
 * adjectives.
 */
function descriptionAboutTheHomeInstruction(locale: DescriptionRequestedEvent['locale']): string {
  return (
    'WRITE ABOUT THE HOME, NOT THE LISTING: state each fact the sources give as a fact about the ' +
    'property ("The flat has a balcony."), never as something the listing reports ("the ' +
    'listing says", "according to the description", "ogłoszenie podaje", "el anuncio indica").' +
    (locale === 'pl' ? ` ${POLISH_ROOM_COUNTS}` : '')
  );
}

// ─── Types (ADR-0023 §3) ──────────────────────────────────────────────────────

/**
 * A statement about residents' race, ethnic origin or religion, refused on every request as on
 * `/api/adapt` [FOLLOW-1411, ESC-089]; FOLLOW-1400's `familial_steering` is lifted.
 */
type ProtectedGround = 'protected_ground';

type DescriptionOutcome =
  | { verdict: 'SKIPPED'; reason: 'spend_cap' }
  | {
      verdict: 'FAILED';
      reason:
        | 'empty'
        | ContractViolation
        | 'truncated'
        | 'wrong_language'
        | 'timeout'
        | 'api_error'
        | 'invalid_event';
    }
  | { verdict: 'NEUTRAL'; neutralReason: string | null }
  | { verdict: 'REFUSED'; violation: NumberViolation | ClaimViolation | ProtectedGround }
  | { verdict: 'FIT'; description: string; verifiedFacts: string[] };

/** The outcomes the pure interpreter can produce (no I/O, so no SKIPPED / timeout / api_error). */
type InterpretedDescription = Exclude<
  DescriptionOutcome,
  { verdict: 'SKIPPED' } | { reason: 'timeout' | 'api_error' | 'invalid_event' }
>;

interface GenerationReport {
  outcome: DescriptionOutcome;
  /** `null` unless the outcome is FIT and the headline passed its check. */
  headline: string | null;
  /** Why `headline` is null on a FIT outcome: its check, an empty reply, or a failed call. */
  headlineViolation:
    | FactViolation
    | ClaimViolation
    | 'empty'
    | 'wrong_language'
    | 'residual_tag'
    | 'meta_commentary'
    | ProtectedGround
    | 'call_failed'
    | null;
  /** Set iff the outcome is FIT. */
  claimsValidation: typeof CLAIMS_VALIDATION_VERSION | null;
  writes: {
    pg: 'published' | 'stale' | 'not_configured' | 'failed' | 'skipped';
    redis: 'written' | 'not_configured' | 'failed' | 'skipped';
    /** `description_generations`. */
    audit: 'written' | 'not_configured' | 'failed' | 'skipped';
  };
}

// ─── Pure halves ──────────────────────────────────────────────────────────────

/** `_resolve_generation_model`: `override_model` > `generation_model` > the default; allow-listed. */
function resolveGenerationModel(override?: string, generation?: string): AllowedGenerationModel {
  const allowed = ALLOWED_GENERATION_MODELS as readonly string[];
  if (override && allowed.includes(override)) return override as AllowedGenerationModel;
  if (generation && allowed.includes(generation)) return generation as AllowedGenerationModel;
  return DEFAULT_GENERATION_MODEL;
}

/** `_max_tokens_for`. */
function maxTokensFor(original: string): number {
  const wordCount = pySplit(original).length;
  const estimated =
    Math.ceil(wordCount * BODY_LENGTH_HEADROOM * TOKENS_PER_WORD) + AUDIT_BLOCK_TOKEN_RESERVE;
  return Math.max(MAX_TOKENS_FLOOR, Math.min(estimated, MAX_TOKENS_CEILING));
}

/** `_parse_copy_template_sections`: `(voice_pattern, hard_rules)`. */
function parseCopyTemplateSections(copyTemplate: string): [string, string] {
  if (copyTemplate.includes('VOICE PATTERN:') && copyTemplate.includes('HARD RULES:')) {
    const idx = copyTemplate.indexOf('HARD RULES:');
    const voice = pyStrip(copyTemplate.slice(0, idx).replaceAll('VOICE PATTERN:', ''));
    const rules = pyStrip(copyTemplate.slice(idx + 'HARD RULES:'.length));
    return [voice, rules];
  }
  return [pyStrip(copyTemplate), ''];
}

/**
 * `_generate_with_sonnet`'s prompt assembly. The budget is `_max_tokens_for` for a 4.x model and the
 * model's catalog profile on top of it for a 5.x one (FOLLOW-1377, `generation-models.ts`).
 */
function renderDescriptionPrompt(
  e: DescriptionRequestedEvent,
  model: AllowedGenerationModel,
): { system: string; user: string; maxTokens: number; extras: GenerationRequestExtras } {
  const [parsedVoice, hardRules] = parseCopyTemplateSections(e.copy_template);
  const voicePattern = parsedVoice || (ARCHETYPE_GUIDANCE[e.archetype] ?? GUIDANCE_DEFAULT);
  const system = SONNET_SYSTEM_PROMPT_TEMPLATE.replaceAll('{archetype}', e.archetype).replaceAll(
    '{locale}',
    e.locale,
  );
  const ctxEmpty = Object.keys(e.listing_context).length === 0;
  const traitBlock = renderTraitRules(getTraitAddOns(e.traits));
  const user = [
    `archetype: ${e.archetype}`,
    `locale: ${e.locale}`,
    '',
    'archetype_voice_pattern:',
    voicePattern,
    '',
    'archetype_hard_rules:',
    hardRules ? hardRules : '(none provided)',
    '',
    // Buyer traits [FOLLOW-1360]: nothing is added without one, so the corpus digests hold.
    ...(traitBlock ? [traitBlock, ''] : []),
    'original_description:',
    e.original_description ? e.original_description : '(empty)',
    '',
    'listing_context (JSON):',
    ctxEmpty ? '{}' : pythonJsonDumps(e.listing_context, 2),
    '',
    'Write the description for this archetype following the WHITELIST RULES. ' +
      'Remember: do not invent numbers, ratings, distances, percentages, prices, ' +
      'dates, or proper names that are not in original_description or ' +
      'listing_context. Finish with the <verified_facts_used> JSON block.',
    '',
    // FOLLOW-1402 (corpus v9): the output language, named.
    descriptionLanguageInstruction(e.locale),
    '',
    // FOLLOW-1414 (corpus v17): copy about the home, not the listing; Polish room counts.
    descriptionAboutTheHomeInstruction(e.locale),
    '',
    // FOLLOW-1311 (corpus v23): a room count is not a bedroom count.
    ROOM_COUNT_CONVENTION,
  ].join('\n');
  const { maxTokens, extras } = generationRequestFor(model, maxTokensFor(e.original_description));
  return { system, user, maxTokens, extras };
}

/**
 * `_generate_headline`'s prompt assembly (FOLLOW-1305: the whitelist is the listing's fields). The
 * budget is `_HEADLINE_MAX_TOKENS` for a 4.x model, profiled for a 5.x one (FOLLOW-1377). The
 * last paragraph names the locale's language (FOLLOW-1382, corpus v5).
 */
function renderHeadlinePrompt(
  e: DescriptionRequestedEvent,
  model: AllowedGenerationModel,
): {
  system: string;
  user: string;
  maxTokens: number;
  extras: GenerationRequestExtras;
} {
  const persona = ARCHETYPE_GUIDANCE[e.archetype] ?? GUIDANCE_DEFAULT;
  const originalSnippet = pySliceCodePoints(e.original_description || '(empty)', 2000);
  const fieldLines = Object.entries(e.listing_context).map(([k, v]) => `  - ${k}: ${v}`);
  const factsBlock =
    'Listing facts whitelist (ONLY these listing fields and the original description may ' +
    'supply a specific fact in the headline):\n' +
    (fieldLines.length > 0 ? fieldLines.join('\n') : '  (no structured fields)') +
    '\n\nOriginal description (factual source of truth):\n' +
    originalSnippet;
  const user =
    `Write ONE listing headline (max 90 chars, no surrounding quotes) ` +
    `for a ${e.archetype} buyer. Persona guidance (tone only — it adds no facts): ${persona}\n\n` +
    `GROUNDING RULES: Use ONLY facts stated in the sources below. Do NOT invent any number, ` +
    `distance, percentage, price, place or named entity, and make no investment or outcome ` +
    `promise (rental potential, yield, move-in ready, guarantees, visa pathways, prime, rare, ` +
    `superlatives) the sources do not state. Sentence case: capitalise only the first word and ` +
    `true proper names. Return ONLY the headline text.\n\n` +
    factsBlock +
    `\n\n${headlineLanguageInstruction(e.locale)}` +
    // FOLLOW-1414 (corpus v17): the Polish room-count adjectives, spelled.
    (e.locale === 'pl' ? `\n\n${POLISH_ROOM_COUNTS}` : '') +
    // FOLLOW-1311 (corpus v23): a room count is not a bedroom count.
    `\n\n${ROOM_COUNT_CONVENTION}`;
  const { maxTokens, extras } = generationRequestFor(model, HEADLINE_MAX_TOKENS);
  return { system: HEADLINE_SYSTEM_PROMPT, user, maxTokens, extras };
}

const VERDICT_SRC = `<adaptation_verdict>${PY_WS}*(FIT|NEUTRAL)${PY_WS}*</adaptation_verdict>`;
const ADAPTATION_VERDICT_RE = new RegExp(VERDICT_SRC, 'iu');
const ADAPTATION_VERDICT_ALL_RE = new RegExp(VERDICT_SRC, 'giu');
const REASON_SRC = `<neutral_reason>${PY_WS}*(.*?)${PY_WS}*</neutral_reason>`;
const NEUTRAL_REASON_RE = new RegExp(REASON_SRC, 'siu');
const NEUTRAL_REASON_ALL_RE = new RegExp(REASON_SRC, 'gsiu');
const VERIFIED_FACTS_RE = new RegExp(
  `${PY_WS}*<verified_facts_used>${PY_WS}*(.*?)${PY_WS}*</verified_facts_used>${PY_WS}*`,
  'su',
);

/** `_parse_adaptation_verdict` (ADR-0010): a missing tag is FIT; both tags are stripped. */
function parseAdaptationVerdict(raw: string): {
  verdict: 'FIT' | 'NEUTRAL';
  neutralReason: string | null;
  body: string;
} {
  const verdictMatch = ADAPTATION_VERDICT_RE.exec(raw);
  const verdict = verdictMatch
    ? ((verdictMatch[1] ?? '').toUpperCase() as 'FIT' | 'NEUTRAL')
    : 'FIT';
  const reasonMatch = NEUTRAL_REASON_RE.exec(raw);
  const neutralReason = reasonMatch ? (reasonMatch[1] ?? '') : null;
  const body = pyStrip(
    raw.replace(ADAPTATION_VERDICT_ALL_RE, '').replace(NEUTRAL_REASON_ALL_RE, ''),
  );
  return { verdict, neutralReason, body };
}

/**
 * `_parse_verified_facts`: strip the FIRST audit block; its JSON array is the facts list (not a
 * list, or malformed ⇒ `[]`). Python's `json.loads` additionally accepts `NaN` / `Infinity`
 * literals that `JSON.parse` rejects — the only known divergence of this parser, and a model
 * output that contains one is a malformed facts list either way.
 */
function parseVerifiedFacts(output: string): { description: string; facts: string[] } {
  const m = VERIFIED_FACTS_RE.exec(output);
  if (!m) return { description: pyStrip(output), facts: [] };
  const description = pyStrip(output.slice(0, m.index) + output.slice(m.index + m[0].length));
  let facts: string[] = [];
  try {
    const parsed: unknown = JSON.parse(pyStrip(m[1] ?? ''));
    // Python keeps whatever the list holds; the type is the contract's, the content the model's.
    if (Array.isArray(parsed)) facts = parsed as string[];
  } catch {
    facts = [];
  }
  return { description, facts };
}

/** The interpretation half of `_generate_with_sonnet`: raw model output → outcome. */
function interpretDescription(
  raw: { text: string; stopReason: string | null },
  e: DescriptionRequestedEvent,
): InterpretedDescription {
  if (!pyStrip(raw.text)) return { verdict: 'FAILED', reason: 'empty' };

  const { verdict, neutralReason, body } = parseAdaptationVerdict(raw.text);
  if (verdict === 'NEUTRAL') return { verdict: 'NEUTRAL', neutralReason };

  const { description, facts } = parseVerifiedFacts(body);

  const contractViolation = bodyViolatesContract(description);
  if (contractViolation) return { verdict: 'FAILED', reason: contractViolation };

  if (raw.stopReason === 'max_tokens' || description.includes('<verified_facts_used')) {
    return { verdict: 'FAILED', reason: 'truncated' };
  }

  // FOLLOW-1384: a body in another language than the page's is a contract failure, never
  // translated.
  const languageViolation = checkOutputLanguage(description, e.locale);
  if (languageViolation) return { verdict: 'FAILED', reason: languageViolation };

  // FOLLOW-1411: a statement about residents' race, ethnic origin or religion is refused before
  // the claim check, as `/api/adapt` orders it; refused, never stripped.
  if (describesResidentsByProtectedGround(description)) {
    return { verdict: 'REFUSED', violation: 'protected_ground' };
  }

  const claimViolation = checkBodyClaims(
    description,
    e.original_description || '',
    e.listing_context,
  );
  if (claimViolation) return { verdict: 'REFUSED', violation: claimViolation };

  return { verdict: 'FIT', description, verifiedFacts: facts };
}

/** The interpretation half of `_generate_headline`: first line, quotes off, ≤120 code points, checked. */
function interpretHeadline(
  rawText: string,
  e: DescriptionRequestedEvent,
): {
  headline: string | null;
  violation:
    | FactViolation
    | ClaimViolation
    | 'empty'
    | 'wrong_language'
    | 'residual_tag'
    | 'meta_commentary'
    | ProtectedGround
    | null;
} {
  if (!pyStrip(rawText)) return { headline: null, violation: 'empty' };
  const firstLine = pyStrip(rawText).split('\n')[0] ?? '';
  const headline = pySliceCodePoints(pyStrip(pyStripChars(firstLine, '"\'')), 120);
  if (!headline) return { headline: null, violation: 'empty' };
  // FOLLOW-1390: a leaked model-control tag, as in the body.
  if (hasModelControlTag(headline)) return { headline: null, violation: 'residual_tag' };
  // FOLLOW-1392: a note to the operator, as in the body.
  if (hasMetaCommentary(headline)) return { headline: null, violation: 'meta_commentary' };
  // FOLLOW-1384: the page's language first, then the facts.
  const languageViolation = checkOutputLanguage(headline, e.locale);
  if (languageViolation) return { headline: null, violation: languageViolation };
  // FOLLOW-1411: residents' race, ethnic origin or religion, as on the body and on `/api/adapt`.
  if (describesResidentsByProtectedGround(headline)) {
    return { headline: null, violation: 'protected_ground' };
  }
  const violation = checkHeadlineFacts(
    headline,
    e.original_description || '',
    e.listing_context,
    e.locale,
  );
  if (violation) return { headline: null, violation };
  return { headline, violation: null };
}

// ─── I/O half ─────────────────────────────────────────────────────────────────

let _client: Anthropic | null = null;
let _noKeyWarned = false;

function getClient(): Anthropic | null {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    if (!_noKeyWarned) {
      console.warn('[description-generator] ANTHROPIC_API_KEY not set — generation disabled');
      _noKeyWarned = true;
    }
    return null;
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

class DeadlineExceeded extends Error {}

/** One Anthropic call under a deadline on the TOTAL (G-03, the FOLLOW-1040 pattern). */
async function callModel(
  client: Anthropic,
  params: {
    model: string;
    max_tokens: number;
    system: string;
    user: string;
    extras: GenerationRequestExtras;
  },
  deadlineMs: number,
): Promise<{
  text: string;
  stopReason: string | null;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The abort's own rejection races the deadline's; the flag is the only reliable tell
  // (the FOLLOW-1041 shape).
  const deadlineState = { exceeded: false };
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      deadlineState.exceeded = true;
      controller.abort();
      reject(new DeadlineExceeded(`deadline exceeded after ${String(deadlineMs)}ms`));
    }, deadlineMs);
  });
  const startedAt = Date.now();
  try {
    const response = await Promise.race([
      client.messages.create(
        // The 5.x fields (`between_tools`, `output_config`) post-date this SDK's types; the SDK
        // sends the body as given. `extras` is `{}` for a 4.x model: the body is unchanged.
        {
          model: params.model,
          max_tokens: params.max_tokens,
          system: params.system,
          messages: [{ role: 'user', content: params.user }],
          ...params.extras,
        } as Anthropic.MessageCreateParamsNonStreaming,
        { signal: controller.signal, maxRetries: ANTHROPIC_MAX_RETRIES },
      ),
      deadline,
    ]);
    // The text blocks only: a 5.x reply opens with a `thinking` block (FOLLOW-1377). A 4.x reply
    // without thinking is one text block, read exactly as before.
    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');
    return {
      text,
      stopReason: response.stop_reason,
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
      latencyMs: Date.now() - startedAt,
    };
  } catch (err: unknown) {
    if (deadlineState.exceeded) {
      throw new DeadlineExceeded(`deadline exceeded after ${String(deadlineMs)}ms`);
    }
    throw err;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function logCall(
  e: DescriptionRequestedEvent,
  model: string,
  source: 'description' | 'headline' | 'description_claim_refused',
  usage: { tokensIn: number; tokensOut: number; latencyMs: number },
): Promise<void> {
  return logLlmCallAsync({
    sessionId: e.listing_id || 'desc',
    tenantId: e.tenant_id,
    archetypeId: e.archetype,
    model,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    costUsd: computeCost(model, usage.tokensIn, usage.tokensOut),
    latencyMs: usage.latencyMs,
    source,
  });
}

function captureFailure(e: DescriptionRequestedEvent, stage: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(
    `[description-generator] ${stage} failed tenant=${e.tenant_id} listing=${e.listing_id} archetype=${e.archetype}: ${msg}`,
  );
  Sentry.captureException(err instanceof Error ? err : new Error(msg), {
    tags: { area: 'description', kind: 'description_generation_failed', stage },
    extra: { tenantId: e.tenant_id, listingId: e.listing_id, archetype: e.archetype },
  });
}

/** Both cache writes (PG first, then Redis — G-02) and the audit row, each reported. */
async function writeCaches(
  e: DescriptionRequestedEvent,
  model: string,
  entry: {
    verdict: 'FIT' | 'NEUTRAL';
    description: string;
    headline: string | null;
    verifiedFacts: string[];
  },
): Promise<GenerationReport['writes']> {
  const writes: GenerationReport['writes'] = { pg: 'skipped', redis: 'skipped', audit: 'skipped' };
  const claimsValidation = entry.verdict === 'FIT' ? CLAIMS_VALIDATION_VERSION : null;

  try {
    writes.pg = await publishPgCachedDescription({
      tenantId: e.tenant_id,
      listingId: e.listing_id,
      archetype: e.archetype,
      locale: e.locale,
      description: entry.description,
      headline: entry.headline,
      model,
      verdict: entry.verdict,
      claimsValidation,
      listingRevision: e.listing_revision ?? 0,
    });
  } catch (err: unknown) {
    writes.pg = 'failed';
    captureFailure(e, 'postgres_write', err);
  }

  if (writes.pg === 'stale') {
    writes.redis = 'skipped';
  } else if (!process.env.UPSTASH_REDIS_URL) {
    writes.redis = 'not_configured';
  } else {
    // The Python value shape: absent keys are omitted, never null (ADR-0023 §3).
    const value: DescriptionCacheValue & { verified_facts_used: string[] } = {
      text: entry.description,
      headline: entry.headline,
      generated_at: new Date().toISOString(),
      verified_facts_used: entry.verifiedFacts,
      ...(entry.verdict === 'NEUTRAL' ? { verdict: 'NEUTRAL' as const } : {}),
      ...(claimsValidation ? { claims_validation: claimsValidation } : {}),
    };
    try {
      writes.redis = (await setCachedDescription(e.cache_key, value)) ? 'written' : 'failed';
    } catch {
      writes.redis = 'failed';
    }
    if (writes.redis === 'failed')
      captureFailure(e, 'redis_write', new Error('Upstash SET not ok'));
  }

  // The audit row only for a generation (never a NEUTRAL marker) that the durable layer accepted.
  if (entry.description !== '' && (writes.pg === 'published' || writes.pg === 'not_configured')) {
    writes.audit = await writeDescriptionGenerationAudit({
      tenant_id: e.tenant_id,
      listing_id: e.listing_id,
      archetype: e.archetype,
      locale: e.locale,
      model,
      description_chars: entry.description.length,
      verified_facts_used: entry.verifiedFacts,
    });
  }
  return writes;
}

const NO_WRITES: GenerationReport['writes'] = { pg: 'skipped', redis: 'skipped', audit: 'skipped' };

/**
 * Generate, check and cache one description (+ headline) for a `description.requested` event.
 *
 * Never throws. Validates `e` with `DescriptionRequestedEventSchema` first (invalid ⇒
 * `FAILED/invalid_event`, no I/O). Runs in `after()` of the request that missed the cache.
 */
export async function generateDescription(
  event: DescriptionRequestedEvent,
): Promise<GenerationReport> {
  const parsed = DescriptionRequestedEventSchema.safeParse(event);
  if (!parsed.success) {
    console.error('[description-generator] invalid event:', parsed.error.message.slice(0, 300));
    return {
      outcome: { verdict: 'FAILED', reason: 'invalid_event' },
      headline: null,
      headlineViolation: null,
      claimsValidation: null,
      writes: NO_WRITES,
    };
  }
  const e = parsed.data;
  try {
    return await generateValidated(e);
  } catch (err: unknown) {
    captureFailure(e, 'generate', err);
    return {
      outcome: { verdict: 'FAILED', reason: 'api_error' },
      headline: null,
      headlineViolation: null,
      claimsValidation: null,
      writes: NO_WRITES,
    };
  }
}

async function generateValidated(e: DescriptionRequestedEvent): Promise<GenerationReport> {
  const model = resolveGenerationModel(e.override_model, e.generation_model);
  const failed = (
    reason: Extract<DescriptionOutcome, { verdict: 'FAILED' }>['reason'],
  ): GenerationReport => ({
    outcome: { verdict: 'FAILED', reason },
    headline: null,
    headlineViolation: null,
    claimsValidation: null,
    writes: NO_WRITES,
  });

  // Spend gate BEFORE the description call — covers the headline call too (FOLLOW-556).
  const spend = await getDailySpend();
  if (spend >= DAILY_SPEND_CAP_USD) {
    const msg = `[description-generator] daily LLM spend cap reached spend=${spend.toFixed(2)} cap=${String(DAILY_SPEND_CAP_USD)} — serving template_fallback`;
    console.warn(msg);
    Sentry.captureMessage('generate_description daily LLM spend cap reached', {
      level: 'warning',
      tags: { kind: 'spend_cap', area: 'description' },
      extra: { daily_spend_usd: Math.round(spend * 100) / 100, cap_usd: DAILY_SPEND_CAP_USD },
    });
    return {
      outcome: { verdict: 'SKIPPED', reason: 'spend_cap' },
      headline: null,
      headlineViolation: null,
      claimsValidation: null,
      writes: NO_WRITES,
    };
  }

  const client = getClient();
  if (!client) return failed('api_error');

  // ── Description call ──
  const prompt = renderDescriptionPrompt(e, model);
  let raw: Awaited<ReturnType<typeof callModel>>;
  try {
    raw = await callModel(
      client,
      {
        model,
        max_tokens: prompt.maxTokens,
        system: prompt.system,
        user: prompt.user,
        extras: prompt.extras,
      },
      DESCRIPTION_DEADLINE_MS,
    );
  } catch (err: unknown) {
    captureFailure(e, 'description_call', err);
    return failed(err instanceof DeadlineExceeded ? 'timeout' : 'api_error');
  }
  await logCall(e, model, 'description', raw);

  const outcome = interpretDescription({ text: raw.text, stopReason: raw.stopReason }, e);

  if (outcome.verdict === 'NEUTRAL') {
    const writes = await writeCaches(e, model, {
      verdict: 'NEUTRAL',
      description: '',
      headline: null,
      verifiedFacts: [],
    });
    console.log(
      `[description-generator] neutral_verdict_negative_cached tenant=${e.tenant_id} listing=${e.listing_id} archetype=${e.archetype} reason=${outcome.neutralReason ?? '(none)'} writes=${JSON.stringify(writes)}`,
    );
    return { outcome, headline: null, headlineViolation: null, claimsValidation: null, writes };
  }

  if (outcome.verdict === 'REFUSED') {
    await logCall(e, model, 'description_claim_refused', {
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 0,
    });
    console.warn(
      `[description-generator] refused_not_cached tenant=${e.tenant_id} listing=${e.listing_id} archetype=${e.archetype} violation=${outcome.violation}`,
    );
    return {
      outcome,
      headline: null,
      headlineViolation: null,
      claimsValidation: null,
      writes: NO_WRITES,
    };
  }

  if (outcome.verdict === 'FAILED') {
    console.warn(
      `[description-generator] failed_not_cached tenant=${e.tenant_id} listing=${e.listing_id} archetype=${e.archetype} reason=${outcome.reason}`,
    );
    return {
      outcome,
      headline: null,
      headlineViolation: null,
      claimsValidation: null,
      writes: NO_WRITES,
    };
  }

  // ── FIT: headline call (non-fatal — ADR-0009) ──
  let headline: string | null = null;
  let headlineViolation: GenerationReport['headlineViolation'] = null;
  try {
    const hp = renderHeadlinePrompt(e, model);
    const hRaw = await callModel(
      client,
      { model, max_tokens: hp.maxTokens, system: hp.system, user: hp.user, extras: hp.extras },
      HEADLINE_DEADLINE_MS,
    );
    await logCall(e, model, 'headline', hRaw);
    const interpreted = interpretHeadline(hRaw.text, e);
    headline = interpreted.headline;
    headlineViolation = interpreted.violation;
    if (interpreted.violation) {
      console.warn(
        `[description-generator] headline suppressed tenant=${e.tenant_id} listing=${e.listing_id} archetype=${e.archetype} violation=${interpreted.violation}`,
      );
    }
  } catch (err: unknown) {
    // Python swallows every headline error: the description is still written, headline null.
    headlineViolation = 'call_failed';
    console.warn(
      `[description-generator] headline call failed (non-fatal) listing=${e.listing_id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const writes = await writeCaches(e, model, {
    verdict: 'FIT',
    description: outcome.description,
    headline,
    verifiedFacts: outcome.verifiedFacts,
  });
  console.log(
    `[description-generator] done tenant=${e.tenant_id} listing=${e.listing_id} archetype=${e.archetype} verdict=FIT has_headline=${String(headline !== null)} verified_facts_count=${String(outcome.verifiedFacts.length)} writes=${JSON.stringify(writes)}`,
  );
  return {
    outcome,
    headline,
    headlineViolation,
    claimsValidation: CLAIMS_VALIDATION_VERSION,
    writes,
  };
}
