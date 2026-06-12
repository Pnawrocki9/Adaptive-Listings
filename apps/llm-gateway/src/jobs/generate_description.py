"""
Modal async job: generate archetype-adapted listing description AND headline using Sonnet 4.6.

Flow:
  1. A description.requested event arrives on the estalara.descriptions Redpanda topic.
  2. consume_description_requests() polls the topic every 30s and calls
     generate_description.spawn() for each message (fire-and-forget).
  3. generate_description() calls Anthropic Sonnet 4.6 directly (NOT via llm-gateway.ts —
     this is Python, independent of the TypeScript control-plane).
  4. On success, writes {"text": "...", "headline": "...", "generated_at": "<ISO>",
     "verified_facts_used": [...]} as a JSON string to Upstash Redis at key
     desc:{tenant_id}:{listing_id}:{archetype}:{locale}:{model}
     (for DEMO MODE: desc:{tenant_id}:{listing_id}:{archetype}:{locale}:demo:{model}).
     Key format includes the model suffix added by FOLLOW-161 (DG-1 / FOLLOW-169).
     The headline field is optional — if headline generation fails the description write
     still proceeds (headline omitted / null in that case).
  5. On empty description response or exception, does NOT write to Redis; the next HTTP
     request will trigger another attempt (idempotent by design).

v1.8 — adaptive-listing prompt (CEO 2026-06-01):
  Same anti-hallucination contract as v1.7.x — the Sonnet system prompt enforces a strict
  fact whitelist that prevents the model from inventing numbers, names, percentages,
  distances or other quantitative facts not present in either (a) original_description
  (agent's text) or (b) listing_context (structured property data), and Sonnet still emits
  a <verified_facts_used> JSON block we strip out, store in Redis, and forward to ClickHouse
  for the audit trail (description_generations.verified_facts_used Array(String)).
  What changed in v1.8: the prompt is now a full XML-structured template (objective /
  context / inputs / instructions / fact_whitelist_rules / voice_adaptation / style_guide /
  output_format / examples / exceptions / guardrails / priority / output_validation);
  output length now TRACKS original_description (+/- 10% by word count) instead of a fixed
  ~140 words; richer voice-adaptation + style guidance; worked multilingual examples.
  Full rationale: docs/specs/TICKET-DESC-PIVOT-001-v1.8.md.

v1.9 — archetype-fit gate (ADR-0010):
  The system prompt now runs an <archetype_fit_gate> BEFORE writing and opens its output with
  an <adaptation_verdict>FIT|NEUTRAL</adaptation_verdict> tag. NEUTRAL means the verified facts
  fundamentally contradict the archetype's core needs (the property is genuinely the wrong
  buyer) — the model refuses to reframe/"rescue" it and returns ONLY the verdict (plus an
  optional <neutral_reason> snake_case code for analytics). We parse that verdict
  (_parse_adaptation_verdict): on NEUTRAL we generate NO description (and therefore no
  headline) so the DOM stays in its neutral, unmodified state and the endpoint serves the
  agent's original copy — handled exactly like an empty response (no Redis write, idempotent
  retry-safe). On FIT we strip the verdict tag and parse the body + <verified_facts_used> as
  before. A missing verdict tag defaults to FIT (backward-safe). The anti-hallucination fact
  whitelist and the length policy are unchanged from v1.8.

Redis source values (defined in backend's DescriptionResponseSchema):
  - "template_fallback" — returned by the HTTP endpoint on cache miss (no write here).
  - "ai_cached"         — returned by the HTTP endpoint on cache hit (after this job writes).
  Note: "ai_generated" is NOT a valid source value per Master Design E.7.3 clarification.
        The endpoint always returns template_fallback (miss) or ai_cached (hit).

Per-listing headline (ADR-0009):
  After the description is generated, a second small LLM call produces ONE headline (~max 90
  chars, grounded strictly in original_description + listing_context, archetype-framed). The
  headline is written into the SAME Redis cache entry as "headline": "<text>" alongside the
  description. On HTTP cache hit the /api/adapt/description endpoint returns it as
  headline: string | null; the SDK applies it to [data-estalara-slot="headline"] elements,
  superseding the playbook headline directive (the cold-start fallback) once warmed.
  Headline generation failure is non-fatal: the description is still written, headline is null.

TTL:
  - Tier 2: TTL 72h (259200s).
  - Tier 3: TTL 48h (172800s).

max_tokens (v1.8): no longer a fixed 450/600. Because v1.8 sizes the body to ±10% of
  original_description, max_tokens scales with the original's word count via
  _max_tokens_for() — a tier floor (450/600) for short originals up to a ceiling
  (_MAX_TOKENS_CEILING) — so the trailing <verified_facts_used> block is never starved
  for long listings (FOLLOW-162). A response truncated at max_tokens is discarded (no
  Redis write) and retried.

Cost: ~$0.01–$0.03 per Sonnet 4.6 call for typical originals; bounded above by the
  _MAX_TOKENS_CEILING budget for very long originals.
"""

# This module is dominated by a large XML-structured LLM system prompt held in a single
# triple-quoted string. Its lines are intentionally long, unwrapped prose: inserting line
# breaks to satisfy E501 would alter the text the model actually receives. ruff is not a CI
# gate here (CI runs pytest only); we silence E501 file-wide rather than reflow the prompt.
# ruff: noqa: E501

from __future__ import annotations

import json
import logging
import os
import re
import time
from datetime import UTC, datetime
from math import ceil
from pathlib import Path
from typing import Any

import httpx
import modal

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# REQUIRED_FIELDS — single source of truth for description.requested required keys.
#
# Loaded from the shared JSON fixture at module import time so that both the
# TypeScript publisher test and this Python consumer test assert against the same
# artifact (packages/shared/contracts/description-event.required.json).
#
# Cross-language contract gate: FOLLOW-198 / FOLLOW-168.
# If the fixture diverges from either runtime, CI fails — see:
#   packages/shared/src/__tests__/cross-runtime/description-event-contract.test.ts
#   apps/llm-gateway/src/jobs/test_description_event_contract.py
# ---------------------------------------------------------------------------

_CONTRACT_FIXTURE = (
    Path(__file__).parent / "../../../../packages/shared/contracts/description-event.required.json"
)
REQUIRED_FIELDS: frozenset[str] = frozenset(json.loads(_CONTRACT_FIXTURE.read_text()))

# ---------------------------------------------------------------------------
# Archetype-specific copywriting guidance injected into the Sonnet prompt.
# Each entry surfaces the top buyer motivations for that archetype.
# Keep in sync with packages/sdk/src/core/playbooks/archetypes/*.ts descriptions.
# ---------------------------------------------------------------------------

_ARCHETYPE_GUIDANCE: dict[str, str] = {
    "yield_hunter": (
        "Focus on ROI numbers: gross yield %, estimated annual rental income, cap rate, "
        "void risk mitigation, and price-per-sqm vs local average. "
        "Mention transport links only when they affect rental demand."
    ),
    "family_buyer": (
        "Lead with school catchment quality, number of bedrooms, garden size, and "
        "neighbourhood safety. Highlight proximity to parks and quiet streets. "
        "Avoid investment/yield language."
    ),
    "lifestyle_expat": (
        "Emphasise walkability, international community presence, English-language services, "
        "expat social network, proximity to international schools, and modern amenities. "
        "Relocation practicalities matter (utilities, local support)."
    ),
    "first_time_buyer": (
        "Lead with affordability, mortgage eligibility, move-in readiness, and Help-to-Buy "
        "eligibility where applicable. Simplify jargon. Reassure on condition/surveys."
    ),
    "luxury_buyer": (
        "Emphasise premium finishes, brand-name appliances, views, exclusivity, concierge "
        "services, and prestige address. Avoid yield or budget language."
    ),
    "remote_worker": (
        "Lead with fibre broadband speed, dedicated office space or spare room, "
        "quiet location, and proximity to co-working hubs or transport for occasional commutes."
    ),
    "downsizer": (
        "Emphasise low maintenance, manageable garden size, single-storey layout or good "
        "lift access, proximity to healthcare, and social amenities. Avoid stairs/large gardens."
    ),
    "upsizer": (
        "Lead with extra bedrooms, flexible living space, potential for extension, "
        "good school catchment, and larger garden. Frame as the next chapter in family life."
    ),
    "retiree_relocator": (
        "Emphasise warm climate, healthcare quality, low cost of living, expat community for "
        "the target region, accessibility, and low-maintenance property."
    ),
    "vacation_rental_investor": (
        "Focus on tourist demand, occupancy rate projections, platform (Airbnb/Vrbo) "
        "eligibility, local rental regulations, and management company availability."
    ),
    "flip_investor": (
        "Highlight below-market price, renovation potential, structural soundness, "
        "planning permission history, and comparable sold prices post-refurb."
    ),
    "portfolio_builder": (
        "Lead with portfolio diversification value, multi-unit or HMO potential, "
        "bulk-purchase discount angle, and scalable management options."
    ),
    "golden_visa_buyer": (
        "Emphasise minimum investment thresholds for residency eligibility, legal pathway "
        "clarity, capital preservation, and prestige of the address."
    ),
    "commercial_investor": (
        "Focus on tenant covenant strength, lease length, passing rent vs ERV, "
        "WAULT, and asset management upside."
    ),
    "diaspora_buyer": (
        "Acknowledge dual-market awareness (local vs origin country), family ties, "
        "remittance-funded purchase practicalities, and long-term capital preservation."
    ),
    "second_home_buyer": (
        "Emphasise lifestyle benefit, rental income potential during vacant periods, "
        "proximity to desired leisure activities, and seasonal access."
    ),
    "student_parent": (
        "Focus on proximity to the target university, room count for student plus guests, "
        "post-graduation rental yield, and low-maintenance features."
    ),
    "neutral": (
        "Write a balanced, factual property description covering key features, location, "
        "condition, and suitability for a broad audience."
    ),
}

# TTL constants (seconds) — must match the backend's Redis client
TTL_TIER_2: int = 259200  # 72 hours
TTL_TIER_3: int = 172800  # 48 hours

# ---------------------------------------------------------------------------
# Modal app definition
# ---------------------------------------------------------------------------

app = modal.App("estalara-description-generator")

_image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "anthropic>=0.28",
    "httpx>=0.27",
    "confluent-kafka>=2.4",
    "sentry-sdk>=2.0",
    "structlog>=24.0",
)


# ---------------------------------------------------------------------------
# Core job function
# ---------------------------------------------------------------------------


@app.function(
    image=_image,
    secrets=[modal.Secret.from_name("estalara-secrets")],
    timeout=120,
)
def generate_description(event: dict[str, Any]) -> None:
    """
    Process a description.requested event from Redpanda.

    Accepts the payload forwarded by consume_description_requests(). Generates
    a buyer-persona-adapted description via Sonnet 4.6 and writes it to Upstash
    Redis. On failure (empty response or exception), exits cleanly without
    writing; the next HTTP request will retry.

    The job is idempotent: calling twice for the same cache_key is safe —
    the Redis SET overwrites the previous value (last-write-wins).

    Args:
        event: Payload dict with fields:
            tenant_id (str)            — required
            listing_id (str)           — required
            archetype (str)            — required
            cache_key (str)            — required; Redis key to write
            original_description (str) — required (v1.7.1); agent's original copy
                                         (may be empty string but the key must be present)
            locale (str)               — optional, default "en"
            tier (int)                 — optional, default 2
            copy_template (str)        — optional; seed text from
                                         PlaybookEntry.copy_template.en. Now parsed for
                                         "VOICE PATTERN:" / "HARD RULES:" sections.
            listing_context (dict)     — optional; listing key-value pairs for factual
                                         grounding
            ttl_seconds (int)          — optional; overrides tier-derived default
    """
    tenant_id: str = event["tenant_id"]
    listing_id: str = event["listing_id"]
    archetype: str = event["archetype"]
    locale: str = event.get("locale", "en")
    tier: int = int(event.get("tier", 2))
    copy_template: str = event.get("copy_template", "")
    listing_context: dict[str, Any] = event.get("listing_context", {})
    # v1.7.1: original_description is the agent's factual source. Required key (may be "").
    original_description: str = event["original_description"]
    cache_key: str = event["cache_key"]
    default_ttl = TTL_TIER_2 if tier == 2 else TTL_TIER_3
    ttl_seconds: int = int(event.get("ttl_seconds", default_ttl))
    # Precedence chain (FOLLOW-166 / FOLLOW-161):
    #   override_model (DEMO MODE) > generation_model (global admin default) > static default.
    # Both are validated against the allow-list by _resolve_generation_model.
    model: str = _resolve_generation_model(
        event.get("override_model"),
        event.get("generation_model"),
    )

    log.info(
        "generate_description.start tenant=%s listing=%s archetype=%s locale=%s tier=%d model=%s",
        tenant_id,
        listing_id,
        archetype,
        locale,
        tier,
        model,
    )

    try:
        description, verified_facts = _generate_with_sonnet(
            archetype=archetype,
            copy_template=copy_template,
            listing_context=listing_context,
            tier=tier,
            locale=locale,
            original_description=original_description,
            model=model,
        )
    except Exception as exc:
        log.error(
            "generate_description.sonnet_error tenant=%s listing=%s error=%s",
            tenant_id,
            listing_id,
            str(exc),
        )
        # Do not write to Redis; next request triggers a new attempt.
        return

    if not description:
        log.warning(
            "generate_description.empty_response tenant=%s listing=%s archetype=%s",
            tenant_id,
            listing_id,
            archetype,
        )
        # Do not write to Redis.
        return

    # ADR-0009 / FOLLOW-169: generate a per-listing headline alongside the description.
    # This is a second small LLM call using the SAME resolved model.
    # Failure is non-fatal — description is still written; headline will be null.
    # FOLLOW-169: pass the description's verified_facts so the headline model can use
    # the already-extracted whitelist instead of re-grounding from raw text (AC1).
    headline = _generate_headline(
        archetype=archetype,
        original_description=original_description,
        listing_context=listing_context,
        model=model,
        verified_facts=verified_facts if verified_facts else None,
    )
    if headline:
        log.info(
            "generate_description.headline_generated cache_key=%s headline_len=%d",
            cache_key,
            len(headline),
        )
    else:
        log.warning(
            "generate_description.headline_missing cache_key=%s — writing description without headline",
            cache_key,
        )

    _write_to_redis(cache_key, description, ttl_seconds, verified_facts, headline)
    log.info(
        "generate_description.done cache_key=%s ttl=%d verified_facts_count=%d has_headline=%s",
        cache_key,
        ttl_seconds,
        len(verified_facts),
        headline is not None,
    )


# ---------------------------------------------------------------------------
# Sonnet 4.6 generation — v1.9 adaptive-listing prompt + archetype-fit gate (ADR-0010)
# ---------------------------------------------------------------------------
#
# Full XML-structured system prompt (objective / context / inputs / instructions /
# fact_whitelist_rules / archetype_fit_gate / voice_adaptation / style_guide / output_format /
# examples / exceptions / guardrails / priority / output_validation). Parameterised on
# {archetype} and {locale} (substituted via str.replace — the body contains literal braces).
#
# v1.9 adds the <archetype_fit_gate>: the output opens with
# <adaptation_verdict>FIT|NEUTRAL</adaptation_verdict>. NEUTRAL ⇒ no description (DOM stays
# neutral); FIT ⇒ verdict tag stripped, body + <verified_facts_used> parsed as in v1.8.
# See _parse_adaptation_verdict.
#
# Same anti-hallucination contract as v1.7.x: the model may only state facts present in
# original_description or listing_context, and must emit a trailing <verified_facts_used>
# JSON block (logged to ClickHouse). New in v1.8: length now TRACKS original_description
# (±10% by word count) instead of a fixed ~140 words; richer voice-adaptation + style
# guidance (human register, banned clichés); worked multilingual examples (en/es).

_SONNET_SYSTEM_PROMPT_TEMPLATE: str = """\
<adaptive_listing_prompt>

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
- Avoid AI tells and estate-agent clichés, including: "nestled", "boasts", "stunning", "a true gem", "won't last long", "perfect blend of", "elevate", "unparalleled", "discover", "welcome to".
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
Investor archetype, locale en. Shows grounding a cashflow-led angle in real verified facts (a tenant in place) while using generic language where no number exists, and producing a correct audit block.
</example_description>

Verified facts available (illustrative): location "Alvalade, Lisbon"; bedrooms 2; EPC C; balcony yes; "tenant currently in place" (from original_description). No yield or rent figure provided.

Good output:

A two-bedroom apartment in Alvalade, one of Lisbon's steadier residential districts, with a tenant already in place — so the income starts on day one, not after months of marketing. The layout is efficient and easy to re-let when the time comes, and the balcony adds the kind of everyday appeal that keeps good tenants renewing. Energy performance is sound for the building, which keeps running costs predictable. For a buyer focused on returns rather than renovation, this is a low-friction hold: occupied, well-located, and ready to fold straight into a portfolio with no works and no waiting.

<verified_facts_used>
["location: Alvalade, Lisbon", "bedrooms: 2", "epc: C", "balcony: yes", "tenanted: yes"]
</verified_facts_used>
</example_1>

<example_2>
<example_description>
Same investor voice pattern ("lead with cashflow"), but NO income, yield, occupancy, or tenancy fact exists in the verified data. Shows expressing the cashflow theme with purely generic language and no fabricated figures.
</example_description>

Verified facts available (illustrative): location "Marbella Old Town"; bedrooms 3; garden yes; EPC B. No yield, rent, occupancy, or tenancy data.

Good output:

A three-bedroom home in Marbella Old Town — a part of the coast that holds its appeal year-round, which matters when you are thinking about long-term rental demand rather than a quick flip. Three bedrooms give you options: family lets, seasonal rentals, or a steady single tenancy all work here. The garden is a real draw in this market and tends to shorten void periods. Energy performance is strong, so running costs stay sensible. Nothing here needs work before it earns. For an income-focused buyer, the fundamentals are the story: a sound, well-placed property in a location that keeps demand consistent.

<verified_facts_used>
["location: Marbella Old Town", "bedrooms: 3", "garden: yes", "epc: B"]
</verified_facts_used>
</example_2>

<example_3>
<example_description>
Lifestyle archetype, locale es. Shows native composition in Spanish (not translated from English) and reframing the same kind of facts for an emotional, lifestyle angle while staying grounded and number-free where no number is verified.
</example_description>

Verified facts available (illustrative): location "Casco Antiguo, Marbella"; bedrooms 3; garden yes; EPC B.

Good output:

Una casa de tres dormitorios en el Casco Antiguo de Marbella, donde las calles estrechas y la piedra cálida todavía marcan el ritmo del día. Hay espacio de sobra para vivir sin agobios: tres dormitorios que se adaptan a una familia que crece o a quien quiere sitio para recibir. El jardín es el corazón de la casa, un rincón propio al aire libre para las tardes largas del sur. La eficiencia energética es buena, así que el confort no se paga caro. No es solo una propiedad bien situada: es una forma de vivir Marbella desde dentro, lejos del ruido y cerca de todo lo que importa.

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
- The copy reads in the archetype's voice, written by a human, free of the banned clichés.
- The body is in {locale} and its word count is within +/- 10% of original_description.
- No verified fact present in original_description has been dropped.
- No fit reasoning, misalignment breakdown, or commentary has leaked into the visible output.
- The output matches exactly one of the two contracts in <output_format>, and nothing else.
If any check fails, fix it before responding.
</output_validation>

Now write the description following archetype_voice_pattern and archetype_hard_rules, grounded strictly in the verified facts, in {locale}.

</adaptive_listing_prompt>"""


# ---------------------------------------------------------------------------
# FOLLOW-188: leak/format fail-safe — second line of defence on the FIT path
# ---------------------------------------------------------------------------
#
# Even on a FIT verdict Sonnet can break character and emit reasoning text, markdown
# formatting, or residual XML tags into the description body. This guard catches those
# cases AFTER _parse_verified_facts strips the audit block and BEFORE the description
# is returned to the caller (which would write it to Redis and serve it to users).
#
# On any violation _generate_with_sonnet returns ("", []) — identical to a NEUTRAL
# verdict or a truncated generation — so the caller skips the Redis write and the HTTP
# endpoint serves the agent's original copy (DOM unmodified, no Redis entry for this key
# until the next attempt regenerates cleanly).
#
# Marker-list rationale:
#   INCLUDED — high-precision English reasoning-leak phrases. These are Sonnet breaking
#   character; they would NEVER appear in legitimate real-estate listing prose.
#   Defensive against English leaks even when the target locale is es/pl (Sonnet sometimes
#   reverts to English mid-reasoning).
#     "my approach"        — self-referential preamble
#     "as an ai"           — model identifying itself
#     "i cannot"           — refusal preamble
#     "i will not"         — refusal preamble
#     "i will write"       — reasoning about its own output
#     "misalign"           — analysis of archetype fit (NEUTRAL reasoning leaked into FIT body)
#     "ethically"          — ethics commentary
#     "the facts do not support" — misalignment analysis
#     "archetype"          — prompt explicitly forbids referencing the archetype in visible copy
#
#   EXCLUDED (deliberately) — phrases that are FALSE-POSITIVE-PRONE in real estate copy:
#     "non-negotiable" — a common English real-estate phrase for a firm asking price
#                        ("the asking price is non-negotiable"); occurs naturally in listing prose.
#     "honest description" — agents legitimately say they are giving an honest account.
#     "key family priorities" — natural lifestyle copy ("ticks all the key family priorities").
#
# Locale caveat: the marker list is English-only. Spanish/Polish description bodies are
# unlikely to trigger any marker (the phrases are English idioms), so false positives in
# es/pl are near-zero. True reasoning leaks in non-English locales must be caught by the
# residual-tag and markdown checks above, or handled by a future locale-aware extension.

_BODY_LEAK_MARKERS: tuple[str, ...] = (
    "my approach",
    "as an ai",
    "i cannot",
    "i will not",
    "i will write",
    "misalign",
    "ethically",
    "the facts do not support",
    "archetype",
)


def _body_violates_contract(body: str) -> str | None:
    """
    Check whether a FIT description body breaks the output contract.

    This is the second line of defence (FOLLOW-188): applied AFTER verdict parsing and
    <verified_facts_used> stripping, BEFORE the description is returned to the Redis writer.
    On any violation the caller suppresses the result with return ("", []) so the DOM stays
    neutral and no bad copy reaches the user.

    Checks, in order:
      1. Residual control tags — any of <adaptation_verdict, <verified_facts_used,
         <neutral_reason remaining in the body (case-insensitive).  → "residual_tag"
      2. Markdown / structural formatting — **bold** or a line starting with # (heading).
         → "formatted_body"
      3. Leaked reasoning markers — substring match (case-insensitive) against
         _BODY_LEAK_MARKERS.  → "leak_marker"

    Args:
        body: The stripped description text (audit block already removed by
              _parse_verified_facts; verdict tags already removed by
              _parse_adaptation_verdict).

    Returns:
        A short reason code string if a violation is found, else None.
    """
    body_lower = body.lower()

    # 1. Residual control tags — the production pipeline already discards a dangling
    #    <verified_facts_used opening tag (truncation guard). This generalises it to
    #    all three gate/audit tags that must NEVER appear in buyer-visible copy.
    residual_tags = ("<adaptation_verdict", "<verified_facts_used", "<neutral_reason")
    for tag in residual_tags:
        if tag in body_lower:
            return "residual_tag"

    # 2. Markdown/structural leak — bold markers (**) or a heading line (# at line start).
    if "**" in body:
        return "formatted_body"
    for line in body.splitlines():
        if line.lstrip().startswith("#"):
            return "formatted_body"

    # 3. Leaked reasoning markers (English-only, high-precision; see module comment for
    #    rationale and deliberate exclusions — e.g. "non-negotiable", "honest description").
    for marker in _BODY_LEAK_MARKERS:
        if marker in body_lower:
            return "leak_marker"

    return None


# Regex used by _parse_verified_facts. Compiled once at module load.
_VERIFIED_FACTS_PATTERN: re.Pattern[str] = re.compile(
    r"\s*<verified_facts_used>\s*(.*?)\s*</verified_facts_used>\s*",
    re.DOTALL,
)

# v1.9 archetype-fit gate (ADR-0010): the model now opens its output with an
# <adaptation_verdict>FIT|NEUTRAL</adaptation_verdict> tag. On NEUTRAL the property
# fundamentally does not fit the archetype, so we generate NO description and the DOM
# stays in its neutral (unmodified) state — the caller skips the Redis write exactly as
# for an empty response. An optional <neutral_reason> short code is logged for analytics.
_ADAPTATION_VERDICT_PATTERN: re.Pattern[str] = re.compile(
    r"<adaptation_verdict>\s*(FIT|NEUTRAL)\s*</adaptation_verdict>",
    re.IGNORECASE,
)
_NEUTRAL_REASON_PATTERN: re.Pattern[str] = re.compile(
    r"<neutral_reason>\s*(.*?)\s*</neutral_reason>",
    re.DOTALL | re.IGNORECASE,
)


def _parse_adaptation_verdict(raw: str) -> tuple[str, str | None, str]:
    """
    Parse the v1.9 <adaptation_verdict> gate from the model output (ADR-0010).

    Returns:
        Tuple of (verdict, neutral_reason, body).

        - verdict is "FIT" or "NEUTRAL". When no verdict tag is present (e.g. a
          truncated or non-compliant response) we default to "FIT" so the existing
          downstream parsing/validation still runs — a missing tag is treated as a
          normal description, not a silent neutral.
        - neutral_reason is the short snake_case code inside <neutral_reason> when
          present (NEUTRAL only), else None.
        - body is the model output with the <adaptation_verdict> and <neutral_reason>
          tags removed and stripped, ready for _parse_verified_facts on the FIT path.
    """
    verdict_match = _ADAPTATION_VERDICT_PATTERN.search(raw)
    verdict = verdict_match.group(1).upper() if verdict_match else "FIT"

    reason_match = _NEUTRAL_REASON_PATTERN.search(raw)
    neutral_reason = reason_match.group(1) if reason_match else None

    body = _ADAPTATION_VERDICT_PATTERN.sub("", raw)
    body = _NEUTRAL_REASON_PATTERN.sub("", body).strip()

    return verdict, neutral_reason, body


def _parse_copy_template_sections(copy_template: str) -> tuple[str, str]:
    """
    Parse a structured copy_template string into (voice_pattern, hard_rules).

    The v1.7.1 copy_template format is:

        VOICE PATTERN:
        <how this archetype's copy should sound>

        HARD RULES:
        <what to never write for this archetype>

    If the markers are not present, the entire copy_template is returned as the
    voice_pattern and hard_rules is empty (backwards compatible with older
    playbook entries).

    Args:
        copy_template: Raw seed text from PlaybookEntry.copy_template.en.

    Returns:
        Tuple of (voice_pattern, hard_rules), each stripped of whitespace.
    """
    if "VOICE PATTERN:" in copy_template and "HARD RULES:" in copy_template:
        parts = copy_template.split("HARD RULES:", 1)
        voice = parts[0].replace("VOICE PATTERN:", "").strip()
        rules = parts[1].strip()
        return voice, rules
    return copy_template.strip(), ""


def _parse_verified_facts(sonnet_output: str) -> tuple[str, list[str]]:
    """
    Strip the <verified_facts_used>...</verified_facts_used> block from Sonnet output.

    Returns:
        Tuple of (description_text, verified_facts_list).

        - description_text is sonnet_output with the audit block removed, stripped.
        - verified_facts_list is the parsed JSON array of strings inside the block.

        If no audit block is found, returns (sonnet_output.strip(), []).
        If the audit block exists but contains malformed JSON or a non-list value,
        returns the cleaned description and an empty facts list.
    """
    match = _VERIFIED_FACTS_PATTERN.search(sonnet_output)
    if not match:
        return sonnet_output.strip(), []

    description = sonnet_output[: match.start()] + sonnet_output[match.end() :]
    description = description.strip()

    facts_raw = match.group(1).strip()
    try:
        facts = json.loads(facts_raw)
        if not isinstance(facts, list):
            facts = []
    except (json.JSONDecodeError, ValueError):
        facts = []

    return description, facts


# ---------------------------------------------------------------------------
# Output-token budget (FOLLOW-162 / RETRO-027)
# ---------------------------------------------------------------------------
#
# v1.8 tells Sonnet to keep the description body within ±10% of original_description
# by word count, so a long agent original needs a correspondingly larger output budget.
# A fixed budget (the pre-v1.8 450/600) truncates the trailing <verified_facts_used>
# audit block for long originals — leaving a dangling tag in the buyer-visible copy and
# an empty audit trail in ClickHouse. We therefore size max_tokens from the original's
# word count: a tier floor (so short originals keep the historical budget) plus a per-word
# estimate plus a fixed reserve for the audit block, all bounded by a ceiling that caps
# worst-case cost.
_MAX_TOKENS_FLOOR_TIER_2 = 450
_MAX_TOKENS_FLOOR_TIER_3 = 600
_MAX_TOKENS_CEILING = 2000
# Conservative across en/es/pl (non-English tokenizes to more tokens/word) + Sonnet's
# tendency to run slightly long. The body targets ~110% of the original word count.
_TOKENS_PER_WORD = 2.2
_BODY_LENGTH_HEADROOM = 1.1
# Headroom for the <verified_facts_used> JSON block (~10-20 short "key: value" entries).
_AUDIT_BLOCK_TOKEN_RESERVE = 220


def _max_tokens_for(original_description: str, tier: int) -> int:
    """
    Size the Sonnet output budget so the body AND the trailing <verified_facts_used>
    block both fit, scaling with the agent original (FOLLOW-162).

    Returns the tier floor for short/empty originals, scales up with word count, and is
    clamped to a ceiling to bound cost.
    """
    floor = _MAX_TOKENS_FLOOR_TIER_3 if tier >= 3 else _MAX_TOKENS_FLOOR_TIER_2
    word_count = len(original_description.split())
    estimated = (
        ceil(word_count * _BODY_LENGTH_HEADROOM * _TOKENS_PER_WORD) + _AUDIT_BLOCK_TOKEN_RESERVE
    )
    return max(floor, min(estimated, _MAX_TOKENS_CEILING))


# ---------------------------------------------------------------------------
# Generation model selection (FOLLOW-166 — DEMO MODE override; FOLLOW-161 — global default)
# ---------------------------------------------------------------------------
#
# Precedence chain (highest to lowest):
#   1. override_model  — DEMO MODE (DEMO-001): operator-chosen model per tenant, threaded
#                        through the event as `override_model`. Validated against allow-list.
#   2. generation_model — FOLLOW-161: admin-configured global default threaded by the
#                        control-plane route on cache miss for standard (non-DEMO) requests.
#                        Validated against allow-list.
#   3. _DEFAULT_GENERATION_MODEL — static Sonnet 4.6 fallback when neither field is present
#                        or both fail allow-list validation.
#
# Both values are validated against the curated allow-list (mirrors
# apps/control-plane/src/lib/global-config-store.ts ALLOWED_GENERATION_MODELS) so an
# unexpected/unsafe model string can never reach the Anthropic API call.
_DEFAULT_GENERATION_MODEL = "claude-sonnet-4-6"
_ALLOWED_GENERATION_MODELS: frozenset[str] = frozenset(
    {
        "claude-haiku-4-5-20251001",
        "claude-sonnet-4-6",
        "claude-opus-4-8",
    }
)


def _resolve_generation_model(
    override_model: str | None,
    generation_model: str | None = None,
) -> str:
    """
    Resolve the generation model using the FOLLOW-161 / FOLLOW-166 precedence chain.

    Precedence (highest first):
      1. override_model (DEMO-001) — per-tenant DEMO MODE model chosen in the admin UI.
      2. generation_model (FOLLOW-161) — global admin-configured default threaded via event.
      3. _DEFAULT_GENERATION_MODEL — static fallback.

    Both values are validated against _ALLOWED_GENERATION_MODELS. An unknown value is
    treated as absent (defensive — never forward an arbitrary string to the Anthropic API).

    Args:
        override_model:   DEMO MODE per-tenant model (event["override_model"]).
        generation_model: Global admin-configured model (event["generation_model"]).

    Returns:
        An allow-listed model id string, always non-empty.
    """
    if override_model and override_model in _ALLOWED_GENERATION_MODELS:
        return override_model
    if generation_model and generation_model in _ALLOWED_GENERATION_MODELS:
        return generation_model
    return _DEFAULT_GENERATION_MODEL


def _generate_with_sonnet(
    archetype: str,
    copy_template: str,
    listing_context: dict[str, Any],
    tier: int,
    locale: str = "en",
    original_description: str = "",
    model: str = _DEFAULT_GENERATION_MODEL,
) -> tuple[str, list[str]]:
    """
    Call the Anthropic generation model to produce a buyer-adapted listing description.

    The model defaults to the Sonnet 4.6 workhorse but is overridable per call (FOLLOW-166 /
    DEMO-001 — the operator-chosen model in admin.estalara.com), already validated by the caller
    against the curated allow-list.

    v1.8 — Uses the XML-structured adaptive-listing system prompt that forbids
    Sonnet from inventing any number, name, or quantitative fact not present in
    either original_description or listing_context. Sonnet appends a
    <verified_facts_used> JSON block that we strip out and return separately.

    v1.8 tells Sonnet to keep the body within ±10% of original_description by word
    count (rather than a fixed ~140 words), so max_tokens scales with the original
    via _max_tokens_for: a tier floor (450 for Tier 2, 600 for Tier 3) for short
    originals, scaling up with word count and capped at _MAX_TOKENS_CEILING. A
    response truncated at max_tokens (or carrying an unclosed audit tag) is treated
    as a failed/empty response so the caller skips the Redis write and retries.

    Args:
        archetype:            One of the 18 archetype IDs (e.g. "yield_hunter").
        copy_template:        Seed text from PlaybookEntry.copy_template.en.
                              May contain "VOICE PATTERN:" / "HARD RULES:" sections.
        listing_context:      Key-value pairs from the listing (bedrooms, price, etc.).
                              Factual source of truth for Sonnet.
        tier:                 Integration tier (2 or 3).
        locale:               Target locale code (e.g. "en", "pl", "es").
        original_description: Agent's original listing copy. Factual source of truth.
                              May be an empty string when no agent copy exists.
        model:                Anthropic model id to generate with. Defaults to the Sonnet 4.6
                              workhorse; callers pass an allow-listed override (DEMO-001).

    Returns:
        Tuple of (description_text, verified_facts_used).

        - description_text is the body of the description, stripped of the audit
          block. Empty string if Anthropic returns no content; in that case the
          caller MUST NOT write to Redis.
        - verified_facts_used is a list of strings parsed from the
          <verified_facts_used> JSON block. Empty list if the block is missing
          or malformed.

    Raises:
        anthropic.APIError: on API-level errors (rate limit, auth, server error).
    """
    import anthropic  # imported inside function for Modal image compatibility

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    max_tokens = _max_tokens_for(original_description, tier)

    voice_pattern, hard_rules = _parse_copy_template_sections(copy_template)

    # Fall back to the archetype guidance dictionary when the playbook does not
    # provide a structured voice pattern. This keeps older playbook entries
    # working until they are migrated to the VOICE PATTERN / HARD RULES format.
    if not voice_pattern:
        voice_pattern = _ARCHETYPE_GUIDANCE.get(
            archetype,
            "Write a balanced property description for a motivated buyer.",
        )

    # Use .replace (not .format): the templated prompt body contains many literal braces/
    # XML-ish tokens, and str.format would raise on any brace that is not a named field.
    # {archetype} and {locale} are the only placeholders.
    system_prompt = _SONNET_SYSTEM_PROMPT_TEMPLATE.replace("{archetype}", archetype).replace(
        "{locale}", locale
    )

    user_prompt_parts: list[str] = [
        f"archetype: {archetype}",
        f"locale: {locale}",
        "",
        "archetype_voice_pattern:",
        voice_pattern,
        "",
        "archetype_hard_rules:",
        hard_rules if hard_rules else "(none provided)",
        "",
        "original_description:",
        original_description if original_description else "(empty)",
        "",
        "listing_context (JSON):",
        json.dumps(listing_context, indent=2) if listing_context else "{}",
        "",
        (
            "Write the description for this archetype following the WHITELIST RULES. "
            "Remember: do not invent numbers, ratings, distances, percentages, prices, "
            "dates, or proper names that are not in original_description or "
            "listing_context. Finish with the <verified_facts_used> JSON block."
        ),
    ]

    user_prompt = "\n".join(user_prompt_parts)

    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )

    raw_text: str = ""
    if response.content and hasattr(response.content[0], "text"):
        raw_text = response.content[0].text

    if not raw_text.strip():
        return "", []

    # v1.9 archetype-fit gate (ADR-0010): read the <adaptation_verdict> first.
    # NEUTRAL = the property fundamentally does not fit this archetype → produce NO
    # description so the DOM stays neutral (caller skips the Redis write, the endpoint
    # serves the agent's original copy). This also suppresses the per-listing headline,
    # because the caller early-returns on an empty description before _generate_headline.
    verdict, neutral_reason, body = _parse_adaptation_verdict(raw_text)
    if verdict == "NEUTRAL":
        log.info(
            "generate_description.neutral_verdict archetype=%s tier=%d reason=%s",
            archetype,
            tier,
            neutral_reason or "(none)",
        )
        return "", []

    description, facts = _parse_verified_facts(body)

    # FOLLOW-188: leak/format fail-safe — second line of defence on the FIT path.
    # After _parse_verified_facts strips the audit block, guard the body against residual
    # XML tags, markdown formatting, and leaked reasoning text before storing anything.
    # Any violation → suppress (return "", []) so no bad copy reaches Redis or the user.
    contract_violation = _body_violates_contract(description)
    if contract_violation:
        log.warning(
            "generate_description.body_contract_violation archetype=%s reason=%s",
            archetype,
            contract_violation,
        )
        return "", []

    # FOLLOW-162 / RETRO-027: a generation truncated at max_tokens drops the trailing
    # <verified_facts_used> block (and may cut the body mid-sentence). Two truncation
    # tells: stop_reason == "max_tokens", or an opening "<verified_facts_used" tag that
    # _parse_verified_facts could not close (so it survived in the description). Either
    # way the response is untrustworthy — never store a description with a dangling audit
    # tag or an empty audit trail for what should be an audited generation. Returning
    # ("", []) makes the caller skip the Redis write so the next request retries
    # (idempotent by design), now with a larger max_tokens via _max_tokens_for.
    stop_reason = getattr(response, "stop_reason", None)
    if stop_reason == "max_tokens" or "<verified_facts_used" in description:
        log.warning(
            "generate_description.truncated archetype=%s tier=%d stop_reason=%s max_tokens=%d",
            archetype,
            tier,
            stop_reason,
            max_tokens,
        )
        return "", []

    return description, facts


# ---------------------------------------------------------------------------
# Redis write via Upstash REST pipeline API
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Headline generation (ADR-0009 / FOLLOW-169) — one small LLM call per listing+archetype
# ---------------------------------------------------------------------------
#
# The headline is a single line (~max 90 chars), strictly grounded in
# original_description + listing_context (same anti-hallucination contract as
# the description path — FOLLOW-169 closes the gap). It uses the SAME resolved
# model as the description generation so demo mode / global model switch applies
# to both.
#
# FOLLOW-169 changes:
#   1. A system prompt (_HEADLINE_SYSTEM_PROMPT) now enforces the same fact-whitelist
#      hard rules as the description's system prompt — the model MUST NOT invent
#      any number, named entity, percentage, price, or distance not present in
#      original_description or listing_context.
#   2. When the description's verified_facts inventory is passed in, the user prompt
#      uses it as the explicit whitelist instead of asking the model to re-ground
#      from raw inputs — tighter and cheaper.
#   3. A post-generation fact check (_check_headline_facts) detects any specific
#      number, URL-like word, or percentage in the headline that does not appear
#      verbatim in the grounding sources. On any violation the call returns None
#      (suppressed, no Redis write for the headline field) and logs a warning
#      (Rule K.2: grounding failures must be observable).

# Max tokens for the headline call: 60 is generous for a single line of ≤90
# chars even in non-English locales.
_HEADLINE_MAX_TOKENS = 60

# ---------------------------------------------------------------------------
# FOLLOW-169: Headline system prompt — same fact-whitelist hard rules as the
# description path (mirrors _SONNET_SYSTEM_PROMPT_TEMPLATE's fact_whitelist_rules
# and guardrails sections, condensed for a single-line output).
# ---------------------------------------------------------------------------

_HEADLINE_SYSTEM_PROMPT: str = """\
You are writing a single listing headline (~max 90 characters) for a real-estate property.

GROUNDING RULES (same contract as the full description — FOLLOW-169):
1. The ONLY sources of fact are the original_description and listing_context provided by the user.
2. You MUST NOT state any specific number, measurement, distance, percentage, price, yield, date, \
or the name of any school, hospital, transit stop, company, agent, developer, or manager unless \
that exact fact appears explicitly in original_description or listing_context.
3. Generic positive descriptors containing no number and no named entity are permitted when \
plausibly supported by the verified facts (e.g. "well-connected", "strong rental demand", \
"spacious layout").
4. If the verified facts are thin, write a short honest headline from what is verified. \
Do not pad with unsupported claims.
5. Output ONLY the headline text — no surrounding quotes, no preamble, no explanation. \
Nothing else.
"""


# ---------------------------------------------------------------------------
# FOLLOW-169: Post-generation fact check for the headline.
# ---------------------------------------------------------------------------
#
# After the headline is generated, scan it for tokens that look like specific facts
# (numbers, percentages, words starting with a capital letter that are not stop-words).
# For each suspicious token, check whether it appears verbatim in the combined grounding
# text (original_description + listing_context JSON). If any token is absent, suppress
# the headline (return a violation reason code so the caller can log and discard it).
#
# This is a conservative detector: it checks only digits and standalone capitalised words
# (potential proper names). Generic capitalised words that appear in the listing inputs
# pass through. A hallucinated proper name or number is caught.
#
# Why not rely on the system prompt alone?
#   The system prompt is a first line of defence. The post-generation check is a fast,
#   deterministic second line — the same pattern as _body_violates_contract for the
#   description body (FOLLOW-188 precedent).

_HEADLINE_DIGIT_RE: re.Pattern[str] = re.compile(r"\d")
# Proper nouns heuristic: capitalised words that are NOT likely proper names.
# Covers: common articles / prepositions / conjunctions (original set) PLUS
# common real-estate descriptive adjectives / archetypes that routinely open or
# appear mid-headline and are generic, not place/person names.
# FOLLOW-272: the set is now applied to ALL words (including words[0]) so it
# must include the most common generic headline openers to avoid false positives.
_HEADLINE_STOP_CAPS: frozenset[str] = frozenset(
    {
        # Articles, prepositions, conjunctions
        "A", "An", "The", "In", "On", "At", "Of", "For", "To", "And", "Or", "But",
        "With", "From", "By", "As", "Its", "Is", "Are", "Was", "Be", "Has", "Have",
        "This", "That", "These", "Those", "Your", "Our", "Their",
        # Common real-estate descriptive adjectives / openers (NOT proper names)
        "Ideal", "Prime", "Strong", "Stunning", "Spacious", "Modern", "Elegant",
        "Bright", "Charming", "Impressive", "Exceptional", "Superb", "Excellent",
        "Beautiful", "Luxury", "Luxurious", "Attractive", "Unique", "Rare",
        "Perfect", "Classic", "Contemporary", "Traditional", "Cosy", "Cozy",
        "Quiet", "Peaceful", "Vibrant", "Sought", "Desirable", "Prestigious",
        "Newly", "Well", "Fully", "Tastefully", "Beautifully", "Recently",
        "Lovingly", "Generously", "Conveniently",
        # Archetype framing words that open adapted headlines
        "Investor", "Family", "Investment", "Lifestyle", "Portfolio",
    }
)
_HEADLINE_CAPS_WORD_RE: re.Pattern[str] = re.compile(r"\b([A-Z][a-z]+)\b")


def _check_headline_facts(
    headline: str,
    original_description: str,
    listing_context: dict[str, Any],
) -> str | None:
    """
    Post-generation fact check for the headline (FOLLOW-169 AC2; tightened by
    FOLLOW-272).

    Scans the headline for tokens that look like specific, named facts (digits,
    capitalised words that may be proper names) and verifies each is grounded in the
    combined grounding text (original_description + serialised listing_context).

    FOLLOW-272 precision improvements over the original substring containment:

    1. **Digit tokens** — previously used bare `token.lower() in grounding` (substring),
       which admitted false negatives such as a hallucinated "5" matching "425000" or
       a hallucinated "7%" matching "17%" in the serialised JSON.  The tightened check
       uses a numeric-boundary lookaround so the token must appear as a complete numeric
       unit: `(?<![0-9.,])<token>(?![0-9.,])`.  This prevents "$1,200" from being
       "verified" by a grounding that only contains "$1,500".

    2. **Proper-name detection extended to the first word** — previously `words[1:]`
       skipped the first word entirely (designed to ignore sentence-start
       capitalisation), which allowed a hallucinated proper name opening the headline
       (e.g. "Reston Heights is a great buy") to escape detection.  The updated scan
       covers ALL words; for the first word the stop-caps guard still applies (generic
       sentence-starters like "Prime", "Stunning", "Ideal" will not be in grounding but
       also will not be flagged because they are common enough to reach the stop-caps
       set — see _HEADLINE_STOP_CAPS).  If a first-word proper name IS in the stop-caps
       set it passes; if it is NOT in the set and NOT in grounding, it is flagged.

    Args:
        headline:             The stripped headline text (one line, ≤120 chars).
        original_description: Agent's original copy — factual source of truth.
        listing_context:      Structured property data — factual source of truth.

    Returns:
        A short violation reason code ("hallucinated_number", "hallucinated_proper_name")
        if a specific fact in the headline cannot be found in the grounding sources.
        None if the headline passes the check (all specific tokens are grounded).
    """
    grounding = (original_description + " " + json.dumps(listing_context)).lower()

    # 1. Check any digit sequence (numbers, prices, percentages, dates, etc.).
    #    FOLLOW-272: use numeric-boundary lookaround instead of bare substring so that
    #    a short token like "5" does not match "425000" or "1,500" as a substring.
    #    The pattern (?<![0-9.,])<token>(?![0-9.,]) requires the token to be surrounded
    #    by non-numeric, non-decimal characters — i.e. it is a complete numeric unit.
    for token in re.findall(r"\d[\d.,/%m²sqftftm-]*", headline, re.IGNORECASE):
        token_lower = token.lower()
        boundary_pattern = re.compile(
            r"(?<![0-9.,])" + re.escape(token_lower) + r"(?![0-9.,])"
        )
        if not boundary_pattern.search(grounding):
            return "hallucinated_number"

    # 2. Check capitalised words for possible proper names.
    #    FOLLOW-272: extended to ALL words (including words[0]) so a hallucinated
    #    proper name at the start of the headline is also caught.
    #    The stop-caps guard prevents generic sentence-starters from being flagged.
    words = headline.split()
    for word in words:
        # Strip trailing punctuation for lookup
        clean = word.rstrip(".,;:!?\"')")
        if not clean:
            continue
        # Only flag standalone capitalised words (≥2 chars, not in stop-caps set)
        if len(clean) >= 2 and clean[0].isupper() and clean not in _HEADLINE_STOP_CAPS:
            # FOLLOW-272: use word-boundary match so "est" does not match "Reston"
            # in the grounding — re.search with \b ensures whole-token containment.
            if not re.search(r"\b" + re.escape(clean) + r"\b", grounding, re.IGNORECASE):
                return "hallucinated_proper_name"

    return None


def _generate_headline(
    archetype: str,
    original_description: str,
    listing_context: dict[str, Any],
    model: str,
    verified_facts: list[str] | None = None,
) -> str | None:
    """
    Generate a single per-listing headline (~max 90 chars) grounded in the
    listing's factual data, framed for the given archetype.

    FOLLOW-169: Now uses a system prompt (_HEADLINE_SYSTEM_PROMPT) enforcing the
    same fact-whitelist hard rules as the description path, and a post-generation
    fact check (_check_headline_facts) that suppresses any headline containing a
    specific number or proper name absent from the grounding sources.

    When verified_facts is provided (the description's already-extracted whitelist),
    the user prompt uses it as the explicit grounding inventory instead of asking
    the model to re-derive it from raw text — tighter and cheaper (AC1).

    Uses the same model as the description generation (FOLLOW-166 / FOLLOW-161
    precedence chain already resolved by the caller).

    Args:
        archetype:            Buyer archetype ID (e.g. "yield_hunter").
        original_description: Agent's original copy. Factual source of truth.
        listing_context:      Structured listing data. Factual source of truth.
        model:                Allow-listed Anthropic model id.
        verified_facts:       Optional list of "key: value" strings already extracted
                              from the description generation's <verified_facts_used>
                              block. When present, passed as the explicit whitelist to
                              the headline prompt so the model does not need to re-derive
                              verified facts from the raw inputs (AC1).

    Returns:
        A stripped headline string (≤120 chars after trim), or None on any
        error (empty response, API error, fact-check violation). None causes the
        caller to omit the headline from the cache entry — description write
        proceeds normally.
    """
    import anthropic  # imported inside function for Modal image compatibility

    persona = _ARCHETYPE_GUIDANCE.get(
        archetype,
        "Write a balanced property description for a motivated buyer.",
    )

    listing_json = json.dumps(listing_context) if listing_context else "{}"
    original_snippet = (original_description or "(empty)")[:2000]

    # Build the grounding section of the user prompt.
    # When the description's verified_facts are available, pass them as an explicit
    # whitelist so the model does not need to re-ground from raw text (AC1).
    if verified_facts:
        facts_block = (
            "Verified facts whitelist (ONLY these specific facts may appear in the headline):\n"
            + "\n".join(f"  - {f}" for f in verified_facts)
        )
    else:
        facts_block = (
            "Original description (factual source of truth):\n"
            + original_snippet
            + "\n\nListing data (JSON) (factual source of truth):\n"
            + listing_json
        )

    user_prompt = (
        f"Write ONE compelling listing headline (max 90 chars, no surrounding quotes) "
        f"for a {archetype} buyer. Persona guidance: {persona}\n\n"
        f"GROUNDING RULES: Do NOT invent any number, distance, percentage, price, or named "
        f"entity not present in the sources below. Return ONLY the headline text.\n\n"
        f"{facts_block}"
    )

    try:
        client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        response = client.messages.create(
            model=model,
            max_tokens=_HEADLINE_MAX_TOKENS,
            system=_HEADLINE_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
        raw: str = ""
        if response.content and hasattr(response.content[0], "text"):
            raw = response.content[0].text

        if not raw.strip():
            return None

        # Take only the first line, strip surrounding quotes, cap at 120 chars.
        headline = raw.strip().split("\n")[0].strip("\"'").strip()[:120]
        if not headline:
            return None

        # FOLLOW-169 AC2: post-generation fact check — suppress any headline
        # asserting a specific fact (number, proper name) absent from grounding sources.
        # Rule K.2: log the suppression so it is observable.
        violation = _check_headline_facts(headline, original_description or "", listing_context)
        if violation:
            log.warning(
                "generate_headline.fact_check_violation archetype=%s violation=%s headline=%r",
                archetype,
                violation,
                headline,
            )
            return None

        return headline

    except Exception as exc:  # noqa: BLE001
        log.warning("generate_headline.error archetype=%s error=%s", archetype, str(exc))
        return None


def _write_to_redis(
    cache_key: str,
    description: str,
    ttl_seconds: int,
    verified_facts: list[str] | None = None,
    headline: str | None = None,
) -> None:
    """
    Write a generated description (and optional headline) to Upstash Redis via
    the REST pipeline endpoint.

    Uses POST /pipeline (JSON array of commands) rather than the URL-path format
    to avoid URL-encoding issues with long description text containing special chars.

    Stored value format (JSON string):
        {
            "text": "<description>",
            "headline": "<headline>" | null,
            "generated_at": "<ISO 8601 UTC>",
            "verified_facts_used": ["bedrooms: 3", "location: Marbella", ...]
        }

    The backend HTTP endpoint reads this JSON on cache hit:
      - Returns "text" as the description field in the API response.
      - Returns "headline" as the headline field (null when absent).
      - Returns "generated_at" as the generated_at timestamp.
      - May propagate "verified_facts_used" for audit / debugging consumers.
      - Sets source: "ai_cached" (NOT "ai_generated" — see module docstring).

    Args:
        cache_key:      Redis key, e.g. "desc:tenant123:listing456:yield_hunter:en:claude-sonnet-4-6"
                        (format: desc:{tenant_id}:{listing_id}:{archetype}:{locale}:{model};
                        FOLLOW-161 / FOLLOW-169 DG-1 — includes :{model} suffix).
        description:    AI-generated description text.
        ttl_seconds:    Key expiry in seconds (259200 for Tier 2, 172800 for Tier 3).
        verified_facts: Audit list of facts Sonnet self-reported as used.
                        Defaults to an empty list when absent.
        headline:       AI-generated per-listing headline (ADR-0009). None when headline
                        generation failed or was skipped — written as null in the JSON.

    Raises:
        httpx.HTTPStatusError: if the Upstash REST API returns a non-2xx response.
    """
    redis_url: str = os.environ["UPSTASH_REDIS_URL"].rstrip("/")
    redis_token: str = os.environ["UPSTASH_REDIS_TOKEN"]

    payload_value = json.dumps(
        {
            "text": description,
            "headline": headline,  # None serialises to JSON null
            "generated_at": datetime.now(UTC).isoformat(),
            "verified_facts_used": verified_facts if verified_facts is not None else [],
        }
    )

    # Upstash pipeline: POST /pipeline with [[cmd, ...args], ...]
    # Docs: https://upstash.com/docs/redis/features/restapi#pipeline
    response = httpx.post(
        f"{redis_url}/pipeline",
        headers={
            "Authorization": f"Bearer {redis_token}",
            "Content-Type": "application/json",
        },
        json=[["SET", cache_key, payload_value, "EX", ttl_seconds]],
        timeout=10.0,
    )
    response.raise_for_status()


# ---------------------------------------------------------------------------
# Redpanda consumer — polls estalara.descriptions topic every 30 seconds
# ---------------------------------------------------------------------------


@app.function(
    image=_image,
    secrets=[modal.Secret.from_name("estalara-secrets")],
    schedule=modal.Period(seconds=30),
    timeout=120,
)
def consume_description_requests() -> None:
    """
    Poll the estalara.descriptions Redpanda topic for description.requested events.

    Reads messages during a 25-second window (leaving headroom within the 30s schedule),
    dispatches each valid message to generate_description.spawn() as a fire-and-forget call.
    Modal manages downstream concurrency; we do not await the spawned calls.

    Invalid messages (parse errors, missing required fields) are committed and skipped.

    Environment variables (from estalara-secrets):
        REDPANDA_BROKERS                — comma-separated broker list
        REDPANDA_SASL_USERNAME          — SASL username
        REDPANDA_SASL_PASSWORD          — SASL password
        REDPANDA_SASL_MECHANISM         — SCRAM-SHA-256 or PLAIN (default: SCRAM-SHA-256)
        REDPANDA_TLS                    — "true" or "false" (default: "true")
        REDPANDA_DESCRIPTIONS_TOPIC     — topic name (default: estalara.descriptions)
        REDPANDA_DESCRIPTIONS_GROUP     — consumer group (default: llm-gateway-descriptions)
    """
    from confluent_kafka import Consumer as KafkaConsumer  # type: ignore[import-untyped]

    topic = os.environ.get("REDPANDA_DESCRIPTIONS_TOPIC", "estalara.descriptions")
    group_id = os.environ.get("REDPANDA_DESCRIPTIONS_GROUP", "llm-gateway-descriptions")
    brokers = os.environ["REDPANDA_BROKERS"]
    sasl_username = os.environ["REDPANDA_SASL_USERNAME"]
    sasl_password = os.environ["REDPANDA_SASL_PASSWORD"]
    sasl_mechanism = os.environ.get("REDPANDA_SASL_MECHANISM", "SCRAM-SHA-256")
    use_tls = os.environ.get("REDPANDA_TLS", "true").lower() == "true"

    consumer_conf: dict[str, Any] = {
        "bootstrap.servers": brokers,
        "group.id": group_id,
        "auto.offset.reset": "earliest",
        "enable.auto.commit": False,
        "sasl.mechanism": sasl_mechanism,
        "sasl.username": sasl_username,
        "sasl.password": sasl_password,
        "security.protocol": "SASL_SSL" if use_tls else "SASL_PLAINTEXT",
    }

    consumer = KafkaConsumer(consumer_conf)
    consumer.subscribe([topic])

    dispatched = 0
    poll_deadline = 25.0
    start = time.monotonic()

    try:
        while time.monotonic() - start < poll_deadline:
            msg = consumer.poll(timeout=1.0)
            if msg is None:
                continue
            if msg.error():
                log.error("consume_description_requests.kafka_error error=%s", str(msg.error()))
                continue

            raw = msg.value()
            if not isinstance(raw, bytes):
                consumer.commit(asynchronous=False)
                continue

            try:
                event: dict[str, Any] = json.loads(raw.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError) as exc:
                log.warning(
                    "consume_description_requests.parse_error error=%s offset=%s",
                    str(exc),
                    msg.offset(),
                )
                consumer.commit(asynchronous=False)
                continue

            # Validate required fields before dispatching.
            # v1.7.1: original_description is required (may be "" but the key must
            # be present) so Sonnet can apply the WHITELIST rules with a known
            # factual source.
            # v1.9.1 (FOLLOW-198): REQUIRED_FIELDS is now derived from the shared
            # JSON fixture at module load time — not hardcoded here. See REQUIRED_FIELDS
            # above. Both the TS publisher test and this module read the same artifact.
            missing = REQUIRED_FIELDS - set(event.keys())
            if missing:
                log.warning(
                    "consume_description_requests.missing_fields fields=%s offset=%s",
                    list(missing),
                    msg.offset(),
                )
                consumer.commit(asynchronous=False)
                continue

            # Fire-and-forget: spawn does not block; Modal manages concurrency.
            generate_description.spawn(event)
            consumer.commit(asynchronous=False)
            dispatched += 1

    finally:
        consumer.close()
        log.info("consume_description_requests.done dispatched=%d", dispatched)
