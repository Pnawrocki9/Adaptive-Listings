"""
Modal async job: generate archetype-adapted listing description using Sonnet 4.6.

Flow:
  1. A description.requested event arrives on the estalara.descriptions Redpanda topic.
  2. consume_description_requests() polls the topic every 30s and calls
     generate_description.spawn() for each message (fire-and-forget).
  3. generate_description() calls Anthropic Sonnet 4.6 directly (NOT via llm-gateway.ts —
     this is Python, independent of the TypeScript control-plane).
  4. On success, writes {"text": "...", "generated_at": "<ISO>"} as a JSON string to Upstash
     Redis at key desc:{tenant_id}:{listing_id}:{archetype}:{locale} with tier-specific TTL.
  5. On empty response or exception, does NOT write to Redis; the next HTTP request will
     trigger another attempt (idempotent by design).

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

_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "anthropic>=0.28",
        "httpx>=0.27",
        "confluent-kafka>=2.4",
        "sentry-sdk>=2.0",
        "structlog>=24.0",
    )
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
            tenant_id (str)        — required
            listing_id (str)       — required
            archetype (str)        — required
            cache_key (str)        — required; Redis key to write
            locale (str)           — optional, default "en"
            tier (int)             — optional, default 2
            copy_template (str)    — optional; seed text from PlaybookEntry.copy_template.en
            listing_context (dict) — optional; listing key-value pairs for factual grounding
            ttl_seconds (int)      — optional; overrides tier-derived default
    """
    tenant_id: str = event["tenant_id"]
    listing_id: str = event["listing_id"]
    archetype: str = event["archetype"]
    locale: str = event.get("locale", "en")
    tier: int = int(event.get("tier", 2))
    copy_template: str = event.get("copy_template", "")
    listing_context: dict[str, Any] = event.get("listing_context", {})
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
        description = _generate_with_sonnet(archetype, copy_template, listing_context, tier, locale)
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

    _write_to_redis(cache_key, description, ttl_seconds)
    log.info("generate_description.done cache_key=%s ttl=%d", cache_key, ttl_seconds)


# ---------------------------------------------------------------------------
# Sonnet 4.6 generation
# ---------------------------------------------------------------------------


def _generate_with_sonnet(
    archetype: str,
    copy_template: str,
    listing_context: dict[str, Any],
    tier: int,
    locale: str,
) -> str:
    """
    Call Anthropic Sonnet 4.6 to generate a buyer-adapted listing description.

    Tier 2 targets ~100 words (max_tokens=450).
    Tier 3 targets ~150 words (max_tokens=600).

    Args:
        archetype:       One of the 18 archetype IDs (e.g. "yield_hunter").
        copy_template:   Seed text from PlaybookEntry.copy_template.en.
        listing_context: Key-value pairs from the listing (bedrooms, price, etc.).
        tier:            Integration tier (2 or 3).
        locale:          Target locale code (e.g. "en", "pl", "es").

    Returns:
        Generated description text, stripped of leading/trailing whitespace.
        Empty string if Anthropic returns an empty or whitespace-only content block.

    Raises:
        anthropic.APIError: on API-level errors (rate limit, auth, server error).
    """
    import anthropic  # imported inside function for Modal image compatibility

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    max_tokens = 600 if tier >= 3 else 450
    target_words = 150 if tier >= 3 else 100

    archetype_guidance = _ARCHETYPE_GUIDANCE.get(
        archetype,
        "Write a balanced property description for a motivated buyer.",
    )

    system_prompt = (
        "You are a real estate copywriter specialising in buyer-persona-adapted descriptions. "
        "Write compelling property descriptions tailored to a specific buyer archetype. "
        "Be specific, vivid, and highlight features most relevant to the archetype. "
        "Output ONLY the description text — no introductory phrases, no meta-commentary, "
        "no labels, no quotation marks."
    )

    user_prompt_parts: list[str] = [
        f"Archetype: {archetype}",
        f"Locale: {locale}",
        "",
        f"Copywriting focus for this archetype:\n{archetype_guidance}",
    ]

    if copy_template:
        user_prompt_parts += [
            "",
            "Seed description (refine and adapt for this buyer persona — keep factual details, "
            "reshape framing and emphasis):",
            copy_template,
        ]

    if listing_context:
        user_prompt_parts += [
            "",
            "Property context (use these facts; do NOT invent facts not present here):",
            json.dumps(listing_context, indent=2),
        ]

    user_prompt_parts += [
        "",
        f"Write a ~{target_words}-word property description for a {archetype} buyer.",
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

    return raw_text.strip()


# ---------------------------------------------------------------------------
# Redis write via Upstash REST pipeline API
# ---------------------------------------------------------------------------


def _write_to_redis(cache_key: str, description: str, ttl_seconds: int) -> None:
    """
    Write a generated description to Upstash Redis via the REST pipeline endpoint.

    Uses POST /pipeline (JSON array of commands) rather than the URL-path format
    to avoid URL-encoding issues with long description text containing special chars.

    Stored value format (JSON string):
        {"text": "<description>", "generated_at": "<ISO 8601 UTC>"}

    The backend HTTP endpoint reads this JSON on cache hit:
      - Returns "text" as the description field in the API response.
      - Returns "generated_at" as the generated_at timestamp.
      - Sets source: "ai_cached" (NOT "ai_generated" — see module docstring).

    Args:
        cache_key:   Redis key, e.g. "desc:tenant123:listing456:yield_hunter:en".
        description: AI-generated description text.
        ttl_seconds: Key expiry in seconds (259200 for Tier 2, 172800 for Tier 3).

    Raises:
        httpx.HTTPStatusError: if the Upstash REST API returns a non-2xx response.
    """
    redis_url: str = os.environ["UPSTASH_REDIS_URL"].rstrip("/")
    redis_token: str = os.environ["UPSTASH_REDIS_TOKEN"]

    payload_value = json.dumps(
        {
            "text": description,
            "generated_at": datetime.now(UTC).isoformat(),
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

            # Validate required fields before dispatching
            required = {"tenant_id", "listing_id", "archetype", "cache_key"}
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
