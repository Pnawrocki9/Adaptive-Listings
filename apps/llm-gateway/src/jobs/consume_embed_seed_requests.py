"""
Modal async job: consume listing-embed-seed.requested events and call POST /api/listings/embed.

Flow (ADR-0016 / FOLLOW-485 — direct Modal invocation, current):
  1. The control-plane POSTs a listing-embed-seed.requested event directly to
     listing_embed_seed_requested_endpoint (an authenticated Modal web endpoint below),
     which validates the payload and calls process_embed_seed_request.spawn() (fire-and-forget).
  2. process_embed_seed_request() iterates over event.listing_ids and calls
     POST /api/listings/embed (INTERNAL_API_SECRET auth) for each listing_id.
  3. The embed endpoint is idempotent (upsert) — re-processing the same listing_id
     is always safe.
  4. Per-listing failures are captured to Sentry with structured tags and logged;
     they do NOT abort remaining listings in the batch.

Historical flow (pre-ADR-0016): a listing-embed-seed.requested event arrived on the
estalara.listing-embeddings Redpanda topic (published by publishListingEmbeddingSeed in
the control-plane when the activation overflow path exceeds MAX_INLINE_SEED listings —
FOLLOW-435 LEG 1) and consume_embed_seed_requests() polled it every 30s, processing each
message's listing_ids inline. That poller is retained below (unscheduled) for reference /
possible Redpanda re-adoption at scale — see its docstring.

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

import hmac
import json
import logging
import os
import time
from pathlib import Path
from typing import Any

import httpx
import modal
from fastapi import Body, Header, HTTPException
from fastapi.responses import JSONResponse

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
# Modal app definition — shared with all llm-gateway consumers (FOLLOW-437)
#
# ``app`` and ``_image`` are imported from jobs._app so that a single
# modal.App object owns every @app.function across the gateway.  Previously
# this module declared its own modal.App("estalara-description-generator"),
# which caused deploying this file directly to silently wipe
# generate_description + consume_description_requests from the live app
# (BUG 2, ESC-034).  The shared _app.py module is the single source of truth.
# ---------------------------------------------------------------------------

from jobs._app import _image, app  # noqa: E402


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
#
# Superseded by ADR-0016 direct web endpoint (FOLLOW-485) — retained for
# reference / possible Redpanda re-adoption at scale; not scheduled. The prod
# Redpanda cluster is Serverless, whose HTTP Proxy is BYOC/Dedicated-only (out of
# pilot budget), so the control-plane now dispatches directly to
# listing_embed_seed_requested_endpoint below instead of publishing to this topic.
# ---------------------------------------------------------------------------


@app.function(
    image=_image,
    secrets=[modal.Secret.from_name("estalara-secrets")],
    timeout=120,
)
def consume_embed_seed_requests() -> None:
    """
    Poll the estalara.listing-embeddings Redpanda topic for embed-seed events.

    Superseded by ADR-0016 direct web endpoint (FOLLOW-485) — not scheduled (the
    `schedule=modal.Period(seconds=30)` kwarg was removed from the decorator above).
    Retained for reference / possible Redpanda re-adoption at scale.

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


# ---------------------------------------------------------------------------
# ADR-0016 / FOLLOW-485 — direct Modal HTTPS web endpoint
#
# Replaces the Redpanda poller above as the listing-embed-seed.requested dispatch
# path. The prod Redpanda cluster is Serverless, whose HTTP Proxy is BYOC/
# Dedicated-only (~$500/mo, out of pilot budget), so the control-plane now POSTs
# the event JSON directly to this authenticated endpoint instead of publishing to
# Redpanda.
# ---------------------------------------------------------------------------


def _valid_bearer(authorization: str | None) -> bool:
    """
    Validate an ``Authorization: Bearer <token>`` header against INTERNAL_API_SECRET.

    Uses ``hmac.compare_digest`` for a constant-time comparison so response timing
    cannot be used to guess the secret.

    Args:
        authorization: The raw ``Authorization`` header value, or None if absent.

    Returns:
        True when authorization is exactly ``Bearer <INTERNAL_API_SECRET>`` and the
        secret is configured (non-empty). False on a missing header, wrong scheme,
        empty token, or unset/empty secret (fails closed).
    """
    expected = os.environ.get("INTERNAL_API_SECRET", "")
    if not expected or not authorization:
        return False
    scheme, _, token = authorization.partition(" ")
    if scheme != "Bearer" or not token:
        return False
    return hmac.compare_digest(token, expected)


@app.function(
    image=_image,
    secrets=[modal.Secret.from_name("estalara-secrets")],
    timeout=120,
)
def process_embed_seed_request(event: dict[str, Any]) -> None:
    """
    Process one listing-embed-seed.requested event (ADR-0016 / FOLLOW-485).

    Dispatched via ``.spawn()`` from listing_embed_seed_requested_endpoint (the direct
    Modal web endpoint below). Iterates event["listing_ids"] and calls
    POST /api/listings/embed for each — the same per-listing processing the retired
    consume_embed_seed_requests() poller ran inline per message, extracted here so it
    is spawn()-able as a standalone fire-and-forget job (generate_description() plays
    the analogous role for the description pipeline).

    Per-listing failures are captured to Sentry and logged; they do NOT abort the
    remaining listings in the batch.

    Args:
        event: Payload dict with fields tenant_id (str) and listing_ids (list[str]) —
               already validated against REQUIRED_FIELDS by the caller (the endpoint).

    Environment variables (from estalara-secrets):
        EMBED_API_BASE_URL — control-plane base URL
        INTERNAL_API_SECRET — x-internal-api-secret header value
        SENTRY_DSN          — optional, Sentry DSN for error capture
    """
    import sentry_sdk  # imported inside function for Modal image compatibility

    sentry_dsn = os.environ.get("SENTRY_DSN")
    if sentry_dsn:
        sentry_sdk.init(dsn=sentry_dsn, traces_sample_rate=0.0)

    embed_base_url: str = os.environ["EMBED_API_BASE_URL"]
    internal_secret: str = os.environ["INTERNAL_API_SECRET"]

    tenant_id: str = event["tenant_id"]
    listing_ids: list[str] = event["listing_ids"]

    embed_ok = 0
    embed_fail = 0
    for listing_id in listing_ids:
        try:
            _embed_one_listing(embed_base_url, internal_secret, tenant_id, listing_id)
            log.info(
                "process_embed_seed_request.embed_ok tenant=%s listing=%s",
                tenant_id,
                listing_id,
            )
            embed_ok += 1
        except Exception as exc:  # noqa: BLE001
            embed_fail += 1
            log.error(
                "process_embed_seed_request.embed_failed tenant=%s listing=%s error=%s",
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

    log.info(
        "process_embed_seed_request.done tenant=%s embed_ok=%d embed_fail=%d",
        tenant_id,
        embed_ok,
        embed_fail,
    )


@app.function(
    image=_image,
    secrets=[modal.Secret.from_name("estalara-secrets")],
    timeout=30,
)
@modal.fastapi_endpoint(method="POST")
async def listing_embed_seed_requested_endpoint(
    body: dict[str, Any] = Body(...),
    authorization: str | None = Header(default=None),
) -> JSONResponse:
    """
    POST — direct-invocation replacement for the estalara.listing-embeddings Redpanda topic.

    Validates the same payload shape consume_embed_seed_requests() validated
    (REQUIRED_FIELDS, derived from the shared contract fixture — see module docstring),
    then dispatches process_embed_seed_request.spawn(body) fire-and-forget.

    Auth: requires ``Authorization: Bearer <INTERNAL_API_SECRET>`` (constant-time
    compare via _valid_bearer). INTERNAL_API_SECRET is read from the estalara-secrets
    Modal secret — no REDPANDA_* environment variables are required by this endpoint.

    Args:
        body:          The listing-embed-seed.requested event payload (tenant_id + listing_ids).
        authorization: The raw Authorization header value.

    Returns:
        202 JSONResponse on accept (spawn dispatched).

    Raises:
        fastapi.HTTPException: 401 on a missing/invalid bearer token; 400 when
            body is missing any REQUIRED_FIELDS key.
    """
    if not _valid_bearer(authorization):
        raise HTTPException(status_code=401, detail="unauthorized")

    missing = REQUIRED_FIELDS - set(body.keys())
    if missing:
        raise HTTPException(status_code=400, detail=f"missing required fields: {sorted(missing)}")

    # Fire-and-forget: spawn does not block; Modal manages concurrency.
    process_embed_seed_request.spawn(body)
    return JSONResponse(status_code=202, content={"status": "accepted"})
