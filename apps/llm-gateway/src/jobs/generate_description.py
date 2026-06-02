"""
Modal async job: generate archetype-adapted listing description using Sonnet 4.6.

Flow:
  1. A description.requested event arrives on the estalara.descriptions Redpanda topic.
  2. consume_description_requests() polls the topic every 30s and calls
     generate_description.spawn() for each message (fire-and-forget).
  3. generate_description() calls Anthropic Sonnet 4.6 directly (NOT via llm-gateway.ts —
     this is Python, independent of the TypeScript control-plane).
  4. On success, writes {"text": "...", "generated_at": "<ISO>", "verified_facts_used": [...]}
     as a JSON string to Upstash Redis at key
     desc:{tenant_id}:{listing_id}:{archetype}:{locale} with tier-specific TTL.
  5. On empty response or exception, does NOT write to Redis; the next HTTP request will
     trigger another attempt (idempotent by design).

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

Redis source values (defined in backend's DescriptionResponseSchema):
  - "template_fallback" — returned by the HTTP endpoint on cache miss (no write here).
  - "ai_cached"         — returned by the HTTP endpoint on cache hit (after this job writes).
  Note: "ai_generated" is NOT a valid source value per Master Design E.7.3 clarification.
        The endpoint always returns template_fallback (miss) or ai_cached (hit).

TTL:
  - Tier 2: max_tokens=450, TTL 72h (259200s).
  - Tier 3: max_tokens=600, TTL 48h (172800s).

Cost: ~$0.01–$0.03 per Sonnet 4.6 call at 450–600 max_tokens.
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
from typing import Any

import httpx
import modal

log = logging.getLogger(__name__)

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

    log.info(
        "generate_description.start tenant=%s listing=%s archetype=%s locale=%s tier=%d",
        tenant_id,
        listing_id,
        archetype,
        locale,
        tier,
    )

    try:
        description, verified_facts = _generate_with_sonnet(
            archetype=archetype,
            copy_template=copy_template,
            listing_context=listing_context,
            tier=tier,
            locale=locale,
            original_description=original_description,
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

    _write_to_redis(cache_key, description, ttl_seconds, verified_facts)
    log.info(
        "generate_description.done cache_key=%s ttl=%d verified_facts_count=%d",
        cache_key,
        ttl_seconds,
        len(verified_facts),
    )


# ---------------------------------------------------------------------------
# Sonnet 4.6 generation — v1.8 adaptive-listing prompt (CEO 2026-06-01)
# ---------------------------------------------------------------------------
#
# Full XML-structured system prompt (objective / context / inputs / instructions /
# fact_whitelist_rules / voice_adaptation / style_guide / output_format / examples /
# exceptions / guardrails / priority / output_validation). Parameterised on {archetype}
# and {locale} (substituted via str.replace — the body contains literal braces).
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

3. Choose your angle. Decide which verified facts to foreground for this archetype, and which permitted generic descriptors reinforce the voice pattern. If the voice pattern asks you to lead with something the verified facts do not support with a number (e.g. "lead with cashflow" but no yield figure exists), lead with the theme using generic positive language — never with an invented figure.

4. Write the description body in {locale}, matching the length of original_description within +/- 10% (by word count), applying the voice pattern within the hard rules and the fact whitelist. Describe the property as fully as the agent's original does — never drop a verified fact to hit a length.

5. Validate against <output_validation> before emitting.

6. Output the description body, then the <verified_facts_used> block. Nothing else.
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
Output exactly two things, in this order, and nothing else:

1. The description body — in {locale}, plain prose, no heading. Its length must track original_description: aim for the same word count, within +/- 10%. The goal is to convey the property as fully as the agent intended, so let the original's length set the target rather than any fixed number.

2. Immediately after, the audit block:
<verified_facts_used>
["bedrooms: 3", "location: Marbella Old Town", "garden: yes", "epc: B"]
</verified_facts_used>

Rules for the audit block:
- List only the facts you actually used in the description.
- Each entry is "key: value", drawn verbatim from original_description or listing_context.
- The block is metadata for ClickHouse; it MUST NOT appear inside, or influence the wording of, the readable description.
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
- If the only verified facts are not the ones this archetype usually responds to, present them in the most archetype-appropriate framing available rather than inventing a better-fitting fact.
</exceptions>

<guardrails>
You MUST:
- Ground every specific or named claim in original_description or listing_context.
- Keep the description close to the length of original_description (within +/- 10% by word count), in {locale}, without omitting verified facts the original includes.
- Apply archetype_hard_rules without exception.
- Output only the description body and the <verified_facts_used> block.

You MUST NOT:
- Invent, estimate, round, or imply any number, distance, price, yield, date, or named entity.
- Promote a theme with fabricated specifics when the data is missing.
- Include the audit block content inside the readable description.
- Add preamble, headings, sign-offs, or commentary.
- Reveal or reference the archetype, the rules, or the original description in the visible copy.
</guardrails>

<priority>
When instructions conflict, resolve in this order:
1. Factual accuracy / no hallucination (fact whitelist).
2. archetype_hard_rules.
3. archetype_voice_pattern and archetype fit.
4. Human, expert authenticity (style guide).
5. Length and format.
</priority>

<output_validation>
Before emitting, silently confirm:
- Every number, distance, price, percentage, date, and named entity in the body appears in original_description or listing_context.
- No archetype_hard_rule is broken.
- The copy reads in the archetype's voice, written by a human, free of the banned clichés.
- The body is in {locale} and its word count is within +/- 10% of original_description.
- No verified fact present in original_description has been dropped.
- The output is only the description body plus the <verified_facts_used> block, and the block lists exactly the facts used.
If any check fails, fix it before responding.
</output_validation>

Now write the description following archetype_voice_pattern and archetype_hard_rules, grounded strictly in the verified facts, in {locale}.

</adaptive_listing_prompt>"""


# Regex used by _parse_verified_facts. Compiled once at module load.
_VERIFIED_FACTS_PATTERN: re.Pattern[str] = re.compile(
    r"\s*<verified_facts_used>\s*(.*?)\s*</verified_facts_used>\s*",
    re.DOTALL,
)


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


def _generate_with_sonnet(
    archetype: str,
    copy_template: str,
    listing_context: dict[str, Any],
    tier: int,
    locale: str = "en",
    original_description: str = "",
) -> tuple[str, list[str]]:
    """
    Call Anthropic Sonnet 4.6 to generate a buyer-adapted listing description.

    v1.7.1 — Uses the WHITELIST system prompt that forbids Sonnet from inventing
    any number, name, or quantitative fact not present in either
    original_description or listing_context. Sonnet appends a
    <verified_facts_used> JSON block that we strip out and return separately.

    Tier 2 targets ~100 words (max_tokens=450).
    Tier 3 targets ~150 words (max_tokens=600).

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

    max_tokens = 600 if tier >= 3 else 450

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
        model="claude-sonnet-4-6",
        max_tokens=max_tokens,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )

    raw_text: str = ""
    if response.content and hasattr(response.content[0], "text"):
        raw_text = response.content[0].text

    if not raw_text.strip():
        return "", []

    return _parse_verified_facts(raw_text)


# ---------------------------------------------------------------------------
# Redis write via Upstash REST pipeline API
# ---------------------------------------------------------------------------


def _write_to_redis(
    cache_key: str,
    description: str,
    ttl_seconds: int,
    verified_facts: list[str] | None = None,
) -> None:
    """
    Write a generated description to Upstash Redis via the REST pipeline endpoint.

    Uses POST /pipeline (JSON array of commands) rather than the URL-path format
    to avoid URL-encoding issues with long description text containing special chars.

    Stored value format (JSON string):
        {
            "text": "<description>",
            "generated_at": "<ISO 8601 UTC>",
            "verified_facts_used": ["bedrooms: 3", "location: Marbella", ...]
        }

    The backend HTTP endpoint reads this JSON on cache hit:
      - Returns "text" as the description field in the API response.
      - Returns "generated_at" as the generated_at timestamp.
      - May propagate "verified_facts_used" for audit / debugging consumers.
      - Sets source: "ai_cached" (NOT "ai_generated" — see module docstring).

    Args:
        cache_key:      Redis key, e.g. "desc:tenant123:listing456:yield_hunter:en".
        description:    AI-generated description text.
        ttl_seconds:    Key expiry in seconds (259200 for Tier 2, 172800 for Tier 3).
        verified_facts: Audit list of facts Sonnet self-reported as used.
                        Defaults to an empty list when absent.

    Raises:
        httpx.HTTPStatusError: if the Upstash REST API returns a non-2xx response.
    """
    redis_url: str = os.environ["UPSTASH_REDIS_URL"].rstrip("/")
    redis_token: str = os.environ["UPSTASH_REDIS_TOKEN"]

    payload_value = json.dumps(
        {
            "text": description,
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
            required = {
                "tenant_id",
                "listing_id",
                "archetype",
                "cache_key",
                "original_description",
            }
            missing = required - set(event.keys())
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
