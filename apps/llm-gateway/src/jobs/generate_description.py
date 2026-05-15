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

v1.7.1 — WHITELIST guard-rails:
  The Sonnet system prompt enforces a strict WHITELIST rule set that prevents the model
  from inventing numbers, names, percentages, distances or other quantitative facts that
  are not present in either (a) original_description (agent's text) or (b) listing_context
  (structured property data). Sonnet emits a <verified_facts_used> JSON block at the end
  of its output; we strip it out, store it alongside the description in Redis, and
  forward it to ClickHouse for the anti-hallucination audit trail
  (description_generations.verified_facts_used Array(String)).

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
# Sonnet 4.6 generation — v1.7.1 WHITELIST anti-hallucination prompt
# ---------------------------------------------------------------------------
#
# The system prompt is parameterised on {archetype} and {locale}. It enforces
# that Sonnet may only emit facts present in either original_description
# (agent's text) or listing_context (structured data). It also requires Sonnet
# to emit a trailing <verified_facts_used> JSON block so we can persist the
# audit trail to ClickHouse.

_SONNET_SYSTEM_PROMPT_TEMPLATE: str = """\
You are an expert real-estate copywriter writing adaptive listing descriptions
for a specific buyer archetype: {archetype}.

You will receive:
- archetype_voice_pattern: instructions on how this archetype's copy should sound
- archetype_hard_rules: what you must NEVER write for this archetype
- original_description: agent's original listing copy (factual source of truth)
- listing_context: structured property data (also factual source of truth)
- locale: {locale} (en/pl/es)

WHITELIST RULES — DO NOT VIOLATE:

1. The ONLY sources of facts you may write about are:
   (a) original_description — agent's text
   (b) listing_context — structured property data

2. You MUST NOT mention numbers, ratings, distances, percentages, prices, dates,
   names of schools/hospitals/companies, or any specific quantitative or named
   facts unless they appear explicitly in (a) or (b).

3. Generic positive descriptors WITHOUT numbers are permitted:
   ALLOWED:  "attractive yield", "strong rental demand", "spacious garden",
             "well-connected", "established neighbourhood"
   FORBIDDEN: "yield of 6.2%", "above 95% occupancy", "300m from Tube",
             "Ofsted Outstanding", "Knight Frank managed"

4. If voice_pattern asks you to "lead with cashflow" but no yield/income data
   exists in verified facts, use generic positive cashflow language. Do not
   invent numbers.

5. At the end of your response, output a separate JSON block listing the verified
   facts you actually used:

   <verified_facts_used>
   ["bedrooms: 3", "location: Marbella Old Town", "garden: yes", "epc: B"]
   </verified_facts_used>

6. Do not include the <verified_facts_used> block in the description text. The
   description text and audit block are returned separately.

7. Target length: ~140 words for the description body.

8. Write in {locale} (en/pl/es). Match the linguistic register of the
   archetype_voice_pattern, which is provided in {locale}.

Now write the description following archetype_voice_pattern and archetype_hard_rules,
respecting the WHITELIST RULES above."""


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

    system_prompt = _SONNET_SYSTEM_PROMPT_TEMPLATE.format(
        archetype=archetype,
        locale=locale,
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
