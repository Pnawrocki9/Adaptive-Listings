"""
Modal async job: consume listing-embed-seed.requested events and call POST /api/listings/embed.

Flow:
  1. A listing-embed-seed.requested event arrives on the estalara.listing-embeddings
     Redpanda topic (published by publishListingEmbeddingSeed in the control-plane when
     the activation overflow path exceeds MAX_INLINE_SEED listings — FOLLOW-435 LEG 1).
  2. consume_embed_seed_requests() polls the topic every 30s (mirroring
     consume_description_requests() in generate_description.py).
  3. For each message, iterates over event.listing_ids and calls
     POST /api/listings/embed (INTERNAL_API_SECRET auth) for each listing_id.
  4. The embed endpoint is idempotent (upsert) — re-processing the same listing_id
     is always safe.
  5. Per-listing failures are captured to Sentry with structured tags and logged;
     they do NOT abort remaining listings in the batch.

Cross-language contract gate (FOLLOW-435):
  REQUIRED_FIELDS is derived at module load time from the shared JSON fixture at:
    packages/shared/contracts/listing-embed-seed-event.required.json
  Both the TypeScript publisher test and this Python consumer test assert against
  the same artifact.  See test_listing_embed_seed_event_contract.py.

Environment variables (from estalara-secrets Modal secret):
  Required for Redpanda:
    REDPANDA_BROKERS                  — comma-separated broker list
    REDPANDA_SASL_USERNAME            — SASL username
    REDPANDA_SASL_PASSWORD            — SASL password
    REDPANDA_SASL_MECHANISM           — SCRAM-SHA-256 or PLAIN (default: SCRAM-SHA-256)
    REDPANDA_TLS                      — "true" or "false" (default: "true")
    REDPANDA_TOPIC_LISTING_EMBEDDINGS — topic name (default: estalara.listing-embeddings)
    REDPANDA_EMBED_GROUP              — consumer group (default: llm-gateway-embed-seed)
  Required for the embed endpoint:
    EMBED_API_BASE_URL    — control-plane base URL (e.g. https://admin.estalara.com)
    INTERNAL_API_SECRET   — shared secret for x-internal-api-secret header
  Optional:
    SENTRY_DSN            — Sentry DSN for error capture

Placement decision: extended apps/llm-gateway (not a new Modal app) because:
  - llm-gateway already owns the Redpanda consumer pattern (consume_description_requests)
    and the Modal app/image/secrets configuration.
  - Adding a second consumer here re-uses the same estalara-secrets Modal secret,
    the same image, and the same deploy command — zero new infra.
  - The consumer logic is lightweight (HTTP POST per listing_id) — no reason for
    a dedicated app.
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any

import httpx
import modal

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# REQUIRED_FIELDS — single source of truth for listing-embed-seed required keys.
#
# Loaded from the shared JSON fixture at module import time so that both the
# TypeScript publisher test and this Python consumer test assert against the
# same artifact (packages/shared/contracts/listing-embed-seed-event.required.json).
#
# Cross-language contract gate: FOLLOW-435.
# If the fixture diverges from either runtime, CI fails — see:
#   packages/shared/src/__tests__/cross-runtime/listing-embed-seed-event-contract.test.ts
#   apps/llm-gateway/src/jobs/test_listing_embed_seed_event_contract.py
# ---------------------------------------------------------------------------

_CONTRACT_FIXTURE = (
    Path(__file__).parent
    / "../../../../packages/shared/contracts/listing-embed-seed-event.required.json"
)
REQUIRED_FIELDS: frozenset[str] = frozenset(json.loads(_CONTRACT_FIXTURE.read_text()))

# ---------------------------------------------------------------------------
# Modal app definition — reuses the llm-gateway app and image
# ---------------------------------------------------------------------------

app = modal.App("estalara-description-generator")

_image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "httpx>=0.27",
    "confluent-kafka>=2.4",
    "sentry-sdk>=2.0",
    "structlog>=24.0",
)


# ---------------------------------------------------------------------------
# Embed one listing via the control-plane internal endpoint
# ---------------------------------------------------------------------------


def _embed_one_listing(
    base_url: str,
    secret: str,
    tenant_id: str,
    listing_id: str,
) -> None:
    """
    POST a single listing to POST /api/listings/embed.

    The endpoint is idempotent (upsert) — calling twice for the same listing_id
    is safe and will not create duplicate rows.

    Args:
        base_url:   Control-plane base URL (no trailing slash), e.g. https://admin.estalara.com.
        secret:     Value for x-internal-api-secret header.
        tenant_id:  Tenant UUID (RLS scope).
        listing_id: Listing ID to embed.

    Raises:
        httpx.HTTPStatusError: on a non-2xx response.
        httpx.RequestError:    on a network-level failure.
    """
    response = httpx.post(
        f"{base_url.rstrip('/')}/api/listings/embed",
        headers={
            "Content-Type": "application/json",
            "x-internal-api-secret": secret,
        },
        json={
            "tenant_id": tenant_id,
            "listing_id": listing_id,
            # text_fields is intentionally omitted — the endpoint fetches listing
            # text from its own DB when text_fields is absent.
        },
        timeout=30.0,
    )
    response.raise_for_status()


# ---------------------------------------------------------------------------
# Modal cron — polls estalara.listing-embeddings topic every 30 seconds
# ---------------------------------------------------------------------------


@app.function(
    image=_image,
    secrets=[modal.Secret.from_name("estalara-secrets")],
    schedule=modal.Period(seconds=30),
    timeout=120,
)
def consume_embed_seed_requests() -> None:
    """
    Poll the estalara.listing-embeddings Redpanda topic for embed-seed events.

    Reads messages during a 25-second window (leaving headroom within the 30s schedule),
    validates each message against REQUIRED_FIELDS (derived from the shared contract
    fixture), then for each listing_id in event.listing_ids calls POST /api/listings/embed.

    Per-listing embed failures are captured to Sentry and logged; they do NOT abort the
    remaining listings in the batch. The overall message is committed regardless so
    malformed or permanently-failing messages do not block the consumer group.

    Environment variables (from estalara-secrets):
        REDPANDA_BROKERS                  — comma-separated broker list
        REDPANDA_SASL_USERNAME            — SASL username
        REDPANDA_SASL_PASSWORD            — SASL password
        REDPANDA_SASL_MECHANISM           — SCRAM-SHA-256 or PLAIN (default: SCRAM-SHA-256)
        REDPANDA_TLS                      — "true" or "false" (default: "true")
        REDPANDA_TOPIC_LISTING_EMBEDDINGS — topic name (default: estalara.listing-embeddings)
        REDPANDA_EMBED_GROUP              — consumer group (default: llm-gateway-embed-seed)
        EMBED_API_BASE_URL                — control-plane base URL
        INTERNAL_API_SECRET               — x-internal-api-secret header value
    """
    import sentry_sdk  # imported inside function for Modal image compatibility

    from confluent_kafka import Consumer as KafkaConsumer  # type: ignore[import-untyped]

    sentry_dsn = os.environ.get("SENTRY_DSN")
    if sentry_dsn:
        sentry_sdk.init(dsn=sentry_dsn, traces_sample_rate=0.0)

    topic = os.environ.get("REDPANDA_TOPIC_LISTING_EMBEDDINGS", "estalara.listing-embeddings")
    group_id = os.environ.get("REDPANDA_EMBED_GROUP", "llm-gateway-embed-seed")
    brokers = os.environ["REDPANDA_BROKERS"]
    sasl_username = os.environ["REDPANDA_SASL_USERNAME"]
    sasl_password = os.environ["REDPANDA_SASL_PASSWORD"]
    sasl_mechanism = os.environ.get("REDPANDA_SASL_MECHANISM", "SCRAM-SHA-256")
    use_tls = os.environ.get("REDPANDA_TLS", "true").lower() == "true"

    embed_base_url: str = os.environ["EMBED_API_BASE_URL"]
    internal_secret: str = os.environ["INTERNAL_API_SECRET"]

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

    processed = 0
    embed_ok = 0
    embed_fail = 0
    poll_deadline = 25.0
    start = time.monotonic()

    try:
        while time.monotonic() - start < poll_deadline:
            msg = consumer.poll(timeout=1.0)
            if msg is None:
                continue
            if msg.error():
                log.error(
                    "consume_embed_seed_requests.kafka_error error=%s",
                    str(msg.error()),
                )
                continue

            raw = msg.value()
            if not isinstance(raw, bytes):
                consumer.commit(asynchronous=False)
                continue

            try:
                event: dict[str, Any] = json.loads(raw.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError) as exc:
                log.warning(
                    "consume_embed_seed_requests.parse_error error=%s offset=%s",
                    str(exc),
                    msg.offset(),
                )
                consumer.commit(asynchronous=False)
                continue

            # Validate required fields (derived from shared contract fixture — not hardcoded).
            missing = REQUIRED_FIELDS - set(event.keys())
            if missing:
                log.warning(
                    "consume_embed_seed_requests.missing_fields fields=%s offset=%s",
                    list(missing),
                    msg.offset(),
                )
                consumer.commit(asynchronous=False)
                continue

            tenant_id: str = event["tenant_id"]
            listing_ids: list[str] = event["listing_ids"]

            if not listing_ids:
                log.warning(
                    "consume_embed_seed_requests.empty_listing_ids tenant=%s offset=%s",
                    tenant_id,
                    msg.offset(),
                )
                consumer.commit(asynchronous=False)
                continue

            log.info(
                "consume_embed_seed_requests.processing tenant=%s listing_count=%d",
                tenant_id,
                len(listing_ids),
            )

            for listing_id in listing_ids:
                try:
                    _embed_one_listing(embed_base_url, internal_secret, tenant_id, listing_id)
                    log.info(
                        "consume_embed_seed_requests.embed_ok tenant=%s listing=%s",
                        tenant_id,
                        listing_id,
                    )
                    embed_ok += 1
                except Exception as exc:  # noqa: BLE001
                    embed_fail += 1
                    log.error(
                        "consume_embed_seed_requests.embed_failed tenant=%s listing=%s error=%s",
                        tenant_id,
                        listing_id,
                        str(exc),
                    )
                    sentry_sdk.capture_exception(
                        exc if isinstance(exc, Exception) else Exception(str(exc)),
                        tags={
                            "area": "onboarding",
                            "sink": "modal-embed-seed",
                            "kind": "embed_failed",
                        },
                        extras={
                            "tenant_id": tenant_id,
                            "listing_id": listing_id,
                        },
                    )

            consumer.commit(asynchronous=False)
            processed += 1

    finally:
        consumer.close()
        log.info(
            "consume_embed_seed_requests.done processed=%d embed_ok=%d embed_fail=%d",
            processed,
            embed_ok,
            embed_fail,
        )
